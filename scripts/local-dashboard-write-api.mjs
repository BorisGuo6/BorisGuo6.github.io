import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const envPath = path.join(repoRoot, ".env");
const tasksPath = path.join(repoRoot, "dashboard", "state", "tasks.json");
const allowedTaskStatuses = new Set(["todo", "active", "blocked", "needs_user", "review", "done"]);
const allowedTaskPriorities = new Set(["low", "medium", "high"]);
const maxCommentLength = 4000;

function loadEnv(text) {
  const env = {};
  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    env[key.trim()] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
  }
  return env;
}

function sendJson(response, status, body, origin = "") {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "cache-control": "no-store",
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify(body));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJsonFile(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function makeTaskId(projectId, title, existingIds) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const base = `task_${slugify(projectId) || "project"}_${slugify(title) || "todo"}_${date}`;
  let taskId = base;
  let suffix = 2;
  while (existingIds.has(taskId)) {
    taskId = `${base}_${suffix}`;
    suffix += 1;
  }
  return taskId;
}

async function createLocalTask(input) {
  const doc = await readJsonFile(tasksPath);
  if (!Array.isArray(doc.tasks)) {
    throw new Error("tasks.json does not contain a tasks array");
  }
  const existingIds = new Set(doc.tasks.map((task) => task?.task_id).filter(Boolean));
  const updatedAt = new Date().toISOString();
  const status = input.status || "todo";
  const task = {
    task_id: input.task_id && !existingIds.has(input.task_id) ? input.task_id : makeTaskId(input.project_id, input.title, existingIds),
    project_id: input.project_id,
    title: input.title,
    description: input.description || "",
    status,
    priority: input.priority || "medium",
    assignee: input.assignee || null,
    result: null,
    comments: [],
    updated_at: updatedAt,
  };
  if (input.due_at) task.due_at = input.due_at;
  if (status === "done") task.completed_at = updatedAt.slice(0, 10);
  doc.updated_at = updatedAt;
  doc.tasks.push(task);
  await writeJsonFile(tasksPath, doc);
  return task;
}

async function updateLocalTaskStatus(taskId, status) {
  const doc = await readJsonFile(tasksPath);
  const task = Array.isArray(doc.tasks) ? doc.tasks.find((candidate) => candidate.task_id === taskId) : null;
  if (!task) {
    throw new Error(`Task not found in local tasks.json: ${taskId}`);
  }
  const updatedAt = new Date().toISOString();
  task.status = status;
  task.completed_at = status === "done" ? updatedAt.slice(0, 10) : null;
  task.updated_at = updatedAt;
  await writeJsonFile(tasksPath, doc);
  return {
    updated_at: updatedAt,
    completed_at: task.completed_at,
  };
}

async function appendLocalTaskComment(taskId, comment) {
  const doc = await readJsonFile(tasksPath);
  const task = Array.isArray(doc.tasks) ? doc.tasks.find((candidate) => candidate.task_id === taskId) : null;
  if (!task) {
    throw new Error(`Task not found in local tasks.json: ${taskId}`);
  }
  task.comments = Array.isArray(task.comments) ? task.comments : [];
  if (!task.comments.some((existing) => existing.comment_id === comment.comment_id)) {
    task.comments.push(comment);
  }
  task.updated_at = comment.created_at || new Date().toISOString();
  await writeJsonFile(tasksPath, doc);
}

async function readRequestJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 128 * 1024) {
      throw new Error("Request body is too large");
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${name}`);
  }
  return value.trim();
}

async function main() {
  const env = {
    ...loadEnv(await readFile(envPath, "utf8")),
    ...process.env,
  };
  const supabaseUrl = requireString(env.SUPABASE_URL, "SUPABASE_URL").replace(/\/$/, "");
  const agentWriteToken = requireString(env.AGENT_WRITE_TOKEN, "AGENT_WRITE_TOKEN");
  const host = env.LOCAL_DASHBOARD_WRITE_API_HOST || "127.0.0.1";
  const port = Number(env.LOCAL_DASHBOARD_WRITE_API_PORT || 8766);
  const dashboardPort = env.LOCAL_DASHBOARD_PORT || 8765;
  const author = env.LOCAL_DASHBOARD_AUTHOR || "Local dashboard";
  const allowedOrigins = new Set([
    `http://127.0.0.1:${dashboardPort}`,
    `http://localhost:${dashboardPort}`,
  ]);

  async function agentEvent(payload) {
    const response = await fetch(`${supabaseUrl}/functions/v1/agent-event`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-token": agentWriteToken,
      },
      body: JSON.stringify({
        agent_id: "local-dashboard",
        event_type: "local_dashboard_write",
        ...payload,
      }),
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!response.ok || parsed.error) {
      throw new Error(parsed.error || `agent-event ${response.status}: ${text}`);
    }
    return parsed;
  }

  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin || "";
    const url = new URL(request.url || "/", `http://${host}:${port}`);
    const isAllowedOrigin = !origin || allowedOrigins.has(origin);

    if (request.method === "OPTIONS") {
      return sendJson(response, isAllowedOrigin ? 200 : 403, { ok: isAllowedOrigin }, isAllowedOrigin ? origin : "");
    }
    if (!isAllowedOrigin) {
      return sendJson(response, 403, { error: "Origin not allowed" });
    }

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, { ok: true, mode: "local-dashboard-write-api" }, origin);
      }

      if (request.method === "POST" && url.pathname === "/task-status") {
        const body = await readRequestJson(request);
        const taskId = requireString(body.task_id, "task_id");
        const status = requireString(body.status, "status");
        if (!allowedTaskStatuses.has(status)) {
          throw new Error(`Invalid status: ${status}`);
        }
        await agentEvent({
          action: "task_status",
          task_id: taskId,
          status,
          payload: { source: "local-dashboard" },
        });
        const localUpdate = await updateLocalTaskStatus(taskId, status);
        return sendJson(response, 200, { ok: true, task_id: taskId, status, ...localUpdate }, origin);
      }

      if (request.method === "POST" && url.pathname === "/task-create") {
        const body = await readRequestJson(request);
        const projectId = requireString(body.project_id, "project_id");
        const title = requireString(body.title, "title");
        const description = optionalString(body.description);
        const status = optionalString(body.status) || "todo";
        const priority = optionalString(body.priority) || "medium";
        const dueAt = optionalString(body.due_at);
        const assignee = optionalString(body.assignee);
        if (!allowedTaskStatuses.has(status)) {
          throw new Error(`Invalid status: ${status}`);
        }
        if (!allowedTaskPriorities.has(priority)) {
          throw new Error(`Invalid priority: ${priority}`);
        }
        if (dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) {
          throw new Error("Invalid due_at date");
        }
        const task = await createLocalTask({
          project_id: projectId,
          title,
          description,
          status,
          priority,
          due_at: dueAt,
          assignee,
          task_id: optionalString(body.task_id),
        });
        await agentEvent({
          action: "task_upsert",
          project_id: task.project_id,
          task_id: task.task_id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          payload: {
            assignee: task.assignee,
            due_at: task.due_at || null,
            completed_at: task.completed_at || null,
            source_updated_at: task.updated_at,
            payload: { source: "dashboard/state/tasks.json" },
          },
        });
        return sendJson(response, 200, { ok: true, task }, origin);
      }

      if (request.method === "POST" && url.pathname === "/task-comment") {
        const body = await readRequestJson(request);
        const taskId = requireString(body.task_id, "task_id");
        const commentBody = requireString(body.body, "body");
        if (commentBody.length > maxCommentLength) {
          throw new Error(`Comment must be ${maxCommentLength} characters or fewer`);
        }
        const createdAt = new Date().toISOString();
        const comment = {
          comment_id: `comment_${randomUUID()}`,
          task_id: taskId,
          author,
          author_type: "system",
          kind: "comment",
          body: commentBody,
          created_at: createdAt,
        };
        await agentEvent({
          action: "task_comment",
          task_id: taskId,
          comment_id: comment.comment_id,
          kind: comment.kind,
          comment: comment.body,
          payload: {
            author,
            created_at: createdAt,
            source: "local-dashboard",
          },
        });
        await appendLocalTaskComment(taskId, comment);
        return sendJson(response, 200, { ok: true, comment }, origin);
      }

      return sendJson(response, 404, { error: "Not found" }, origin);
    } catch (error) {
      return sendJson(response, 400, { error: errorMessage(error) }, origin);
    }
  });

  server.listen(port, host, () => {
    console.log(`Local dashboard write API listening at http://${host}:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
