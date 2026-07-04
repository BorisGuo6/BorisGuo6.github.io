import {
  applySnapshotTaskComment,
  applySnapshotTaskCommentDelete,
  applySnapshotTaskCreate,
  applySnapshotTaskStatus,
  applySnapshotTaskUpdate,
  toDashboardStateResponse,
} from "./dashboard-state-snapshot.mjs";
import { makeTaskComment } from "./dashboard-task-store.mjs";
import {
  isVercelBlobConfigured,
  loadVercelDashboardSnapshot,
  writeVercelBlobSnapshot,
} from "./dashboard-vercel-store.mjs";

function methodNotAllowed(response, allowed) {
  response.setHeader("allow", allowed.join(", "));
  return sendJson(response, 405, { ok: false, error: "Method not allowed" });
}

export function sendJson(response, status, body) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
  return response.status(status).json(body);
}

export function dashboardProvidedWriteToken(request) {
  const authorization = request.headers.authorization || "";
  const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  const headerToken = request.headers["x-dashboard-token"];
  return Array.isArray(headerToken) ? headerToken[0] : (headerToken || bearerToken);
}

export function dashboardViewerForWriteToken(providedToken, env = process.env) {
  if (!providedToken) {
    return "";
  }
  const userMap = optionalString(env.DASHBOARD_WRITE_TOKEN_USERS || env.DASHBOARD_USER_TOKENS);
  if (userMap) {
    try {
      const parsed = JSON.parse(userMap);
      const mappedViewer = optionalString(parsed?.[providedToken]);
      if (mappedViewer) {
        return mappedViewer;
      }
    } catch (error) {
      // Fall back to the single-token viewer below; health checks should not
      // expose token-map parse details to clients.
    }
  }
  if (providedToken === env.DASHBOARD_WRITE_TOKEN) {
    return optionalString(env.DASHBOARD_WRITE_USER) || "boris";
  }
  return "";
}

export function dashboardWriteAuth(request, env = process.env) {
  const expectedToken = env.DASHBOARD_WRITE_TOKEN;
  if (!expectedToken) {
    return {
      ok: false,
      status: 503,
      error: "DASHBOARD_WRITE_TOKEN is not configured",
    };
  }
  const providedToken = dashboardProvidedWriteToken(request);
  if (providedToken !== expectedToken) {
    return {
      ok: false,
      status: 401,
      error: "Invalid dashboard write token",
    };
  }
  return {
    ok: true,
    viewer: dashboardViewerForWriteToken(providedToken, env),
  };
}

export async function readJsonBody(request) {
  if (request.body && typeof request.body === "object" && !Buffer.isBuffer(request.body)) {
    return request.body;
  }
  if (typeof request.body === "string") {
    return request.body ? JSON.parse(request.body) : {};
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 128 * 1024) {
      throw new Error("Request body is too large");
    }
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${name}`);
  }
  return value.trim();
}

async function loadWritableSnapshot() {
  if (!isVercelBlobConfigured()) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  }
  return loadVercelDashboardSnapshot();
}

async function persistMutation(mutation) {
  const { snapshot, meta } = await loadWritableSnapshot();
  const result = mutation(snapshot);
  const blob = await writeVercelBlobSnapshot(result.snapshot);
  return {
    ...result,
    meta: {
      ...meta,
      storage: "vercel-blob",
      blob_path: blob.pathname,
      blob_url: blob.url,
      updated_at: result.snapshot.updated_at,
    },
  };
}

export async function handleDashboardHealth(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  const providedToken = dashboardProvidedWriteToken(request);
  const writeAuth = providedToken
    ? dashboardWriteAuth(request)
    : null;
  return sendJson(response, 200, {
    ok: true,
    mode: "vercel-dashboard-api",
    storage: isVercelBlobConfigured() ? "vercel-blob" : "bundled-json",
    writable: Boolean(process.env.DASHBOARD_WRITE_TOKEN && process.env.BLOB_READ_WRITE_TOKEN),
    write_auth: writeAuth
      ? { ok: Boolean(writeAuth.ok), status: writeAuth.status || 200, error: writeAuth.error || null, viewer: writeAuth.viewer || null }
      : null,
  });
}

export async function handleDashboardState(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  const { snapshot, meta } = await loadVercelDashboardSnapshot();
  return sendJson(response, 200, toDashboardStateResponse(snapshot, {
    ...meta,
    writable: Boolean(process.env.DASHBOARD_WRITE_TOKEN && process.env.BLOB_READ_WRITE_TOKEN),
  }));
}

export async function handleDashboardTaskStatus(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const auth = dashboardWriteAuth(request);
  if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });
  const body = await readJsonBody(request);
  const taskId = requireString(body.task_id, "task_id");
  const status = requireString(body.status, "status");
  const result = await persistMutation((snapshot) => applySnapshotTaskStatus(snapshot, taskId, status, {
    source: "vercel-blob",
  }));
  return sendJson(response, 200, {
    ok: true,
    task_id: taskId,
    status,
    update: result.update,
    meta: result.meta,
  });
}

export async function handleDashboardTaskCreate(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const auth = dashboardWriteAuth(request);
  if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });
  const body = await readJsonBody(request);
  const payload = {
    task_id: optionalString(body.task_id),
    project_id: requireString(body.project_id, "project_id"),
    title: requireString(body.title, "title"),
    description: optionalString(body.description),
    status: optionalString(body.status) || "todo",
    priority: optionalString(body.priority) || "medium",
    due_at: optionalString(body.due_at),
    assignee: optionalString(body.assignee) || null,
  };
  const result = await persistMutation((snapshot) => applySnapshotTaskCreate(snapshot, payload, {
    source: "vercel-blob",
  }));
  return sendJson(response, 200, {
    ok: true,
    task: result.task,
    meta: result.meta,
  });
}

export async function handleDashboardTaskUpdate(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const auth = dashboardWriteAuth(request);
  if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });
  const body = await readJsonBody(request);
  const taskId = requireString(body.task_id, "task_id");
  const patch = {};
  for (const field of ["title", "description", "priority", "assignee", "due_at"]) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      patch[field] = body[field];
    }
  }
  if (!Object.keys(patch).length) {
    throw new Error("Missing update fields");
  }
  const result = await persistMutation((snapshot) => applySnapshotTaskUpdate(snapshot, taskId, patch, {
    source: "vercel-blob",
  }));
  return sendJson(response, 200, {
    ok: true,
    task_id: taskId,
    task: result.task,
    update: result.update,
    meta: result.meta,
  });
}

export async function handleDashboardTaskComment(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const auth = dashboardWriteAuth(request);
  if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });
  const body = await readJsonBody(request);
  const taskId = requireString(body.task_id, "task_id");
  const author = optionalString(body.author) || "Vercel dashboard";
  const comment = makeTaskComment(taskId, requireString(body.body, "body"), author);
  const result = await persistMutation((snapshot) => applySnapshotTaskComment(snapshot, taskId, comment, {
    source: "vercel-blob",
  }));
  return sendJson(response, 200, {
    ok: true,
    comment,
    meta: result.meta,
  });
}

export async function handleDashboardTaskCommentDelete(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const auth = dashboardWriteAuth(request);
  if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });
  const body = await readJsonBody(request);
  const taskId = requireString(body.task_id, "task_id");
  const commentId = requireString(body.comment_id, "comment_id");
  const result = await persistMutation((snapshot) => applySnapshotTaskCommentDelete(snapshot, taskId, commentId, {
    source: "vercel-blob",
  }));
  return sendJson(response, 200, {
    ok: true,
    task_id: taskId,
    comment_id: commentId,
    deleted_comment: result.comment,
    meta: result.meta,
  });
}
