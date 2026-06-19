import http from "node:http";
import {
  makeAgentEventSender,
  readEnvFile,
} from "./dashboard-state-lib.mjs";
import {
  appendLocalTaskComment,
  createLocalTask,
  deleteLocalTaskComment,
  makeTaskComment,
  optionalString,
  updateLocalTaskStatus,
  validateDueDate,
  validateTaskPriority,
  validateTaskStatus,
} from "./dashboard-task-store.mjs";

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

async function tryAgentEvent(agentEvent, event) {
  try {
    await agentEvent(event);
    return { remote_sync: true };
  } catch (error) {
    return { remote_sync: false, remote_error: errorMessage(error) };
  }
}

async function main() {
  const env = {
    ...await readEnvFile(),
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

  const agentEvent = makeAgentEventSender({
    supabaseUrl,
    agentWriteToken,
    agentId: "local-dashboard",
    eventType: "local_dashboard_write",
  });

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
        const status = validateTaskStatus(requireString(body.status, "status"));
        const localUpdate = await updateLocalTaskStatus(taskId, status);
        const syncResult = await tryAgentEvent(agentEvent, {
          action: "task_status",
          task_id: taskId,
          status,
          payload: { source: "local-dashboard" },
        });
        return sendJson(response, 200, { ok: true, task_id: taskId, status, ...localUpdate, ...syncResult }, origin);
      }

      if (request.method === "POST" && url.pathname === "/task-create") {
        const body = await readRequestJson(request);
        const projectId = requireString(body.project_id, "project_id");
        const title = requireString(body.title, "title");
        const description = optionalString(body.description);
        const status = optionalString(body.status) || "todo";
        const priority = optionalString(body.priority) || "medium";
        const dueAt = validateDueDate(optionalString(body.due_at));
        const assignee = optionalString(body.assignee);
        validateTaskStatus(status);
        validateTaskPriority(priority);
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
        const syncResult = await tryAgentEvent(agentEvent, {
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
        return sendJson(response, 200, { ok: true, task, ...syncResult }, origin);
      }

      if (request.method === "POST" && url.pathname === "/task-comment") {
        const body = await readRequestJson(request);
        const taskId = requireString(body.task_id, "task_id");
        const commentBody = requireString(body.body, "body");
        const comment = makeTaskComment(taskId, commentBody, author);
        await appendLocalTaskComment(taskId, comment);
        const syncResult = await tryAgentEvent(agentEvent, {
          action: "task_comment",
          task_id: taskId,
          comment_id: comment.comment_id,
          kind: comment.kind,
          comment: comment.body,
          payload: {
            author,
            created_at: comment.created_at,
            source: "local-dashboard",
          },
        });
        return sendJson(response, 200, { ok: true, comment, ...syncResult }, origin);
      }

      if (request.method === "POST" && url.pathname === "/task-comment-delete") {
        const body = await readRequestJson(request);
        const taskId = requireString(body.task_id, "task_id");
        const commentId = requireString(body.comment_id, "comment_id");
        const comment = await deleteLocalTaskComment(taskId, commentId);
        const syncResult = await tryAgentEvent(agentEvent, {
          action: "task_comment_delete",
          task_id: taskId,
          comment_id: commentId,
          payload: {
            source: "local-dashboard",
          },
        });
        return sendJson(response, 200, { ok: true, task_id: taskId, comment_id: commentId, deleted_comment: comment, ...syncResult }, origin);
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
