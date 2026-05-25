import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const repoRoot = path.resolve(import.meta.dirname, "..");
export const dashboardDir = path.join(repoRoot, "dashboard");
export const stateDir = path.join(dashboardDir, "state");
export const envPath = path.join(repoRoot, ".env");
export const tasksPath = path.join(stateDir, "tasks.json");
export const maxCommentLength = 4000;
export const managedTaskSource = "dashboard/state/tasks.json";
export const managedAuthorTypes = new Set(["seed", "system"]);

export function loadEnv(text) {
  const env = {};
  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    env[key.trim()] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
  }
  return env;
}

export async function readEnvFile(filePath = envPath) {
  return loadEnv(await readFile(filePath, "utf8"));
}

export async function readJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function writeJsonFile(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

export function statePathToFile(statePath) {
  return path.join(repoRoot, statePath);
}

export function normalizeCommentKind(kind) {
  const value = String(kind || "comment").trim();
  const aliases = {
    progress: "comment",
    conductor_reply: "comment",
    conductor_note: "comment",
    blocker_resolved: "comment",
    host_progress: "comment",
    review: "comment",
    artifact: "comment",
    host_verified: "verification",
    route: "comment",
  };
  return aliases[value] || value || "comment";
}

export function isNoisyHarnessComment(comment) {
  const kind = String(comment?.kind || "").trim();
  const body = String(comment?.body || "").trim();
  if (["conductor_reply", "conductor_note"].includes(kind)) return true;
  if (body.startsWith("本机主控已向远端 session")) return true;
  if (body.startsWith("本机主控拦截到疑似危险输入请求")) return true;
  if (body.includes("session_") && (body.includes("本机主控") || body.includes("ClawCross"))) return true;
  return false;
}

export function boundedComment(body) {
  const text = String(body || "").trim();
  if (text.length <= maxCommentLength) return text;
  return `${text.slice(0, maxCommentLength - 32)}\n[truncated for dashboard sync]`;
}

export function dashboardTaskComments(task) {
  const comments = Array.isArray(task.comments) ? [...task.comments] : [];
  if (task.result && !comments.some((comment) => String(comment.body || "").trim() === String(task.result).trim())) {
    comments.unshift({
      comment_id: `${task.task_id}_result`,
      author: "Result",
      body: task.result,
      created_at: task.completed_at || task.updated_at || null,
      kind: "result",
    });
  }
  return comments
    .filter((comment) => comment && String(comment.body || "").trim())
    .filter((comment) => !isNoisyHarnessComment(comment))
    .map((comment, index) => ({
      comment_id: String(comment.comment_id || `${task.task_id}_comment_${index}`),
      task_id: task.task_id,
      author: String(comment.author || "Seed"),
      kind: normalizeCommentKind(comment.kind),
      body: boundedComment(comment.body),
      created_at: comment.created_at || null,
    }));
}

export async function loadDashboardState() {
  const portfolio = await readJsonFile(path.join(stateDir, "portfolio.json"));
  const projectRefs = Array.isArray(portfolio.projects) ? portfolio.projects : [];
  const projects = await Promise.all(projectRefs.map(async (project, index) => ({
    ref: project,
    doc: await readJsonFile(statePathToFile(project.state_path)),
    sort_order: index,
  })));
  const taskDoc = await readJsonFile(tasksPath);
  const tasks = Array.isArray(taskDoc.tasks) ? taskDoc.tasks : [];
  return { portfolio, projects, taskDoc, tasks };
}

export async function dashboardHash(state) {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(state.portfolio));
  hash.update(JSON.stringify(state.projects.map((project) => project.doc)));
  hash.update(JSON.stringify(state.taskDoc));
  return hash.digest("hex");
}

export function requireEnvKeys(env, keys) {
  for (const key of keys) {
    if (!env[key]) throw new Error(`Missing ${key} in .env`);
  }
}

export function makeAgentEventSender({ supabaseUrl, agentWriteToken, agentId, eventType = "" }) {
  const baseUrl = supabaseUrl.replace(/\/$/, "");
  return async function agentEvent(payload) {
    const response = await fetch(`${baseUrl}/functions/v1/agent-event`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-token": agentWriteToken,
      },
      body: JSON.stringify({
        agent_id: agentId,
        ...(eventType ? { event_type: eventType } : {}),
        ...payload,
      }),
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!response.ok || parsed.error) {
      throw new Error(parsed.error || `agent-event ${response.status}: ${text}`);
    }
    return parsed;
  };
}

export function makeSupabaseSyncClient(env) {
  requireEnvKeys(env, ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "AGENT_WRITE_TOKEN"]);
  const baseUrl = env.SUPABASE_URL.replace(/\/$/, "");
  const restHeaders = {
    apikey: env.SUPABASE_PUBLISHABLE_KEY,
    authorization: `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}`,
  };
  const event = makeAgentEventSender({
    supabaseUrl: env.SUPABASE_URL,
    agentWriteToken: env.AGENT_WRITE_TOKEN,
    agentId: "dashboard-supabase-sync",
  });
  return {
    event,
    async rest(pathname) {
      const response = await fetch(`${baseUrl}/rest/v1/${pathname}`, { headers: restHeaders });
      if (!response.ok) throw new Error(`rest ${response.status}: ${await response.text()}`);
      return response.json();
    },
  };
}
