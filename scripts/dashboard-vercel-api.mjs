import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  appendSnapshotAuditEvent,
  applySnapshotProjectTableRowUpdate,
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
  isBlobPreconditionFailedError,
  loadVercelDashboardSnapshot,
  writeVercelBlobSnapshot,
} from "./dashboard-vercel-store.mjs";

let mutationQueue = Promise.resolve();
export const dashboardSessionCookieName = "dashboard_session";
export const dashboardSessionMaxAgeSeconds = 7 * 24 * 60 * 60;

function methodNotAllowed(response, allowed) {
  response.setHeader("allow", allowed.join(", "));
  return sendJson(response, 405, { ok: false, error: "Method not allowed" });
}

export function sendJson(response, status, body) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("x-content-type-options", "nosniff");
  return response.status(status).json(body);
}

export function dashboardErrorResponse(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (error instanceof SyntaxError) {
    return { status: 400, error: "Invalid JSON request body" };
  }
  if (isBlobPreconditionFailedError(error)) {
    return { status: 409, error: "Dashboard state changed; retry the request" };
  }
  if (message === "Request body is too large") {
    return { status: 413, error: message };
  }
  if (/^(Task|Project|Table row|Comment) not found:/.test(message)) {
    return { status: 404, error: message };
  }
  if (/^(Missing |Invalid |URL must |Comment .* belongs to )/.test(message)) {
    return { status: 400, error: message };
  }
  if (
    message.includes("is not configured")
    || message.includes("remained stale after retries")
    || message.includes("mutation retries exhausted")
  ) {
    return { status: 503, error: "Dashboard storage is unavailable" };
  }
  return { status: 500, error: "Dashboard request failed" };
}

export function withDashboardApiErrors(handler) {
  return async function guardedDashboardHandler(request, response) {
    try {
      return await handler(request, response);
    } catch (error) {
      console.error("Dashboard API failure", {
        name: error?.name || "Error",
        message: error instanceof Error ? error.message : String(error),
        method: request?.method || "UNKNOWN",
        path: requestPath(request || {}),
      });
      if (response.headersSent) return undefined;
      const mapped = dashboardErrorResponse(error);
      return sendJson(response, mapped.status, { ok: false, error: mapped.error });
    }
  };
}

export function dashboardProvidedWriteToken(request) {
  const authorization = request.headers.authorization || "";
  const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  const headerToken = request.headers["x-dashboard-token"];
  return Array.isArray(headerToken) ? headerToken[0] : (headerToken || bearerToken);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function dashboardSessionSecret(env = process.env) {
  return optionalString(
    env.DASHBOARD_SESSION_SECRET
      || env.DASHBOARD_WRITE_TOKEN
      || env.DASHBOARD_WRITE_TOKEN_USERS
      || env.DASHBOARD_USER_TOKENS,
  );
}

function requestCookie(request, name) {
  const cookieHeader = request.headers?.cookie || "";
  for (const part of String(cookieHeader).split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return "";
}

export function dashboardProvidedSession(request) {
  return requestCookie(request, dashboardSessionCookieName);
}

export function createDashboardSession(viewer, env = process.env, options = {}) {
  const secret = dashboardSessionSecret(env);
  if (!secret) {
    throw new Error("Dashboard session secret is not configured");
  }
  const now = options.now || new Date();
  const maxAgeSeconds = Number(options.maxAgeSeconds || dashboardSessionMaxAgeSeconds);
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    viewer: optionalString(viewer) || "unknown",
    exp: Math.floor(now.getTime() / 1000) + maxAgeSeconds,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function dashboardSessionAuth(request, env = process.env, options = {}) {
  const session = dashboardProvidedSession(request);
  if (!session) return null;
  const secret = dashboardSessionSecret(env);
  const separator = session.lastIndexOf(".");
  if (!secret || separator < 1) {
    return { ok: false, status: 401, error: "Invalid dashboard session" };
  }
  const payload = session.slice(0, separator);
  const signature = session.slice(separator + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(signature, expected)) {
    return { ok: false, status: 401, error: "Invalid dashboard session" };
  }
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const nowSeconds = Math.floor((options.now || new Date()).getTime() / 1000);
    const viewer = optionalString(parsed?.viewer);
    if (parsed?.v !== 1 || !viewer || !Number.isFinite(parsed?.exp) || parsed.exp <= nowSeconds) {
      return { ok: false, status: 401, error: "Expired dashboard session" };
    }
    return { ok: true, viewer };
  } catch (error) {
    return { ok: false, status: 401, error: "Invalid dashboard session" };
  }
}

function dashboardSessionCookie(request, value, maxAgeSeconds) {
  const forwardedProto = optionalString(request.headers?.["x-forwarded-proto"]);
  const host = optionalString(request.headers?.host);
  const secure = forwardedProto === "https" || (!host.startsWith("localhost") && !host.startsWith("127.0.0.1"));
  return [
    `${dashboardSessionCookieName}=${encodeURIComponent(value)}`,
    "Path=/api/dashboard",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
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

export function dashboardWriteTokenIsAllowed(providedToken, env = process.env) {
  if (!providedToken) {
    return false;
  }
  if (providedToken === env.DASHBOARD_WRITE_TOKEN) {
    return true;
  }
  return Boolean(dashboardViewerForWriteToken(providedToken, env));
}

export function dashboardWriteAuth(request, env = process.env) {
  const expectedToken = env.DASHBOARD_WRITE_TOKEN;
  const userMap = optionalString(env.DASHBOARD_WRITE_TOKEN_USERS || env.DASHBOARD_USER_TOKENS);
  if (!expectedToken && !userMap) {
    return {
      ok: false,
      status: 503,
      error: "DASHBOARD_WRITE_TOKEN is not configured",
    };
  }
  const providedToken = dashboardProvidedWriteToken(request);
  if (!providedToken) {
    const sessionAuth = dashboardSessionAuth(request, env);
    if (sessionAuth) return sessionAuth;
  }
  if (!dashboardWriteTokenIsAllowed(providedToken, env)) {
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

export function dashboardCanWrite(env = process.env) {
  const userMap = optionalString(env.DASHBOARD_WRITE_TOKEN_USERS || env.DASHBOARD_USER_TOKENS);
  let hasMappedToken = false;
  if (userMap) {
    try {
      const parsed = JSON.parse(userMap);
      hasMappedToken = Boolean(Object.entries(parsed || {}).some(([token, viewer]) => (
        optionalString(token) && optionalString(viewer)
      )));
    } catch (error) {
      hasMappedToken = false;
    }
  }
  const hasWriteToken = Boolean(optionalString(env.DASHBOARD_WRITE_TOKEN) || hasMappedToken);
  return Boolean(hasWriteToken && optionalString(env.BLOB_READ_WRITE_TOKEN));
}

export function dashboardTokenFingerprint(token) {
  const tokenText = optionalString(token);
  if (!tokenText) {
    return "sha256:unknown";
  }
  return `sha256:${createHash("sha256").update(tokenText).digest("hex").slice(0, 16)}`;
}

function shortHash(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function requestHeader(request, name) {
  const value = request.headers?.[name] || request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function requestPath(request) {
  try {
    return new URL(request.url || "/", "https://jingxiangguo.com").pathname;
  } catch (error) {
    return "/";
  }
}

export function makeDashboardAuditEvent({ request, auth, token, action, payload = {}, now = new Date() }) {
  const createdAt = now.toISOString();
  const safeAction = optionalString(action) || "unknown";
  return {
    audit_id: `audit_${createdAt.replace(/[^0-9]/g, "").slice(0, 14)}_${safeAction.replace(/[^a-z0-9_-]/gi, "_")}_${shortHash(`${createdAt}:${token}:${safeAction}`).slice(0, 8)}`,
    created_at: createdAt,
    viewer: optionalString(auth?.viewer) || "unknown",
    token_fingerprint: dashboardTokenFingerprint(token),
    action: safeAction,
    payload,
    request: {
      method: optionalString(request?.method) || "UNKNOWN",
      path: requestPath(request || {}),
      user_agent_fingerprint: dashboardTokenFingerprint(requestHeader(request || {}, "user-agent") || ""),
    },
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

async function persistMutation(mutation, auditOptions = {}) {
  const run = mutationQueue.catch(() => undefined).then(async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const { snapshot, meta } = await loadWritableSnapshot();
      const result = mutation(snapshot);
      const payload = typeof auditOptions.payload === "function"
        ? auditOptions.payload(result)
        : (auditOptions.payload || {});
      const auditEvent = makeDashboardAuditEvent({
        request: auditOptions.request,
        auth: auditOptions.auth,
        token: auditOptions.token,
        action: auditOptions.action,
        payload,
      });
      const auditedSnapshot = appendSnapshotAuditEvent(result.snapshot, auditEvent);
      try {
        const blob = await writeVercelBlobSnapshot(auditedSnapshot, {
          ifMatch: meta.blob_etag,
          previousSnapshot: snapshot,
        });
        return {
          ...result,
          audit: auditEvent,
          meta: {
            ...meta,
            storage: "vercel-blob",
            blob_path: blob.pathname,
            blob_url: blob.url,
            blob_etag: blob.etag,
            updated_at: auditedSnapshot.updated_at,
            audit_id: auditEvent.audit_id,
            audit_viewer: auditEvent.viewer,
            mutation_attempt: attempt,
          },
        };
      } catch (error) {
        const isConflict = isBlobPreconditionFailedError(error);
        if (!isConflict || attempt === 3) {
          throw error;
        }
      }
    }
    throw new Error("Dashboard mutation retries exhausted");
  });
  mutationQueue = run.catch(() => undefined);
  return run;
}

export async function handleDashboardHealth(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  const providedToken = dashboardProvidedWriteToken(request);
  const providedSession = dashboardProvidedSession(request);
  const writeAuth = providedToken || providedSession
    ? dashboardWriteAuth(request)
    : null;
  const health = await getDashboardHealth();
  return sendJson(response, health.ok ? 200 : 503, {
    ...health,
    write_auth: writeAuth
      ? { ok: Boolean(writeAuth.ok), status: writeAuth.status || 200, error: writeAuth.error || null, viewer: writeAuth.viewer || null }
      : null,
  });
}

export async function getDashboardHealth(options = {}) {
  const env = options.env || process.env;
  const loadSnapshot = options.loadSnapshot || loadVercelDashboardSnapshot;
  const configuredStorage = isVercelBlobConfigured(env) ? "vercel-blob" : "bundled-json";
  try {
    const { snapshot, meta } = await loadSnapshot({ env });
    if (configuredStorage === "vercel-blob" && meta?.storage !== "vercel-blob") {
      throw new Error("Configured dashboard Blob is missing");
    }
    return {
      ok: true,
      mode: "vercel-dashboard-api",
      storage: meta?.storage || configuredStorage,
      writable: dashboardCanWrite(env),
      state: {
        ok: true,
        projects: Array.isArray(snapshot?.projects) ? snapshot.projects.length : 0,
        tasks: Array.isArray(snapshot?.taskDoc?.tasks) ? snapshot.taskDoc.tasks.length : 0,
        updated_at: snapshot?.updated_at || null,
        blob_etag: meta?.blob_etag || null,
      },
    };
  } catch (error) {
    return {
      ok: false,
      mode: "vercel-dashboard-api",
      storage: configuredStorage,
      writable: false,
      state: { ok: false, error: "Dashboard state unavailable" },
    };
  }
}

export async function handleDashboardSession(request, response) {
  if (request.method === "DELETE") {
    response.setHeader("set-cookie", dashboardSessionCookie(request, "", 0));
    return sendJson(response, 200, { ok: true });
  }
  if (request.method !== "POST") return methodNotAllowed(response, ["POST", "DELETE"]);
  const token = dashboardProvidedWriteToken(request);
  const viewer = dashboardViewerForWriteToken(token);
  if (!viewer) {
    const auth = dashboardWriteAuth({ ...request, headers: { ...request.headers, cookie: "" } });
    return sendJson(response, auth.status || 401, { ok: false, error: auth.error || "Invalid dashboard write token" });
  }
  const session = createDashboardSession(viewer);
  response.setHeader("set-cookie", dashboardSessionCookie(request, session, dashboardSessionMaxAgeSeconds));
  return sendJson(response, 200, {
    ok: true,
    write_auth: { ok: true, status: 200, error: null, viewer },
  });
}

export async function handleDashboardState(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  const { snapshot, meta } = await loadVercelDashboardSnapshot();
  return sendJson(response, 200, toDashboardStateResponse(snapshot, {
    ...meta,
    writable: dashboardCanWrite(),
  }));
}

export async function handleDashboardTaskStatus(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const providedToken = dashboardProvidedWriteToken(request);
  const auth = dashboardWriteAuth(request);
  if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });
  const body = await readJsonBody(request);
  const taskId = requireString(body.task_id, "task_id");
  const status = requireString(body.status, "status");
  const result = await persistMutation((snapshot) => applySnapshotTaskStatus(snapshot, taskId, status, {
    source: "vercel-blob",
  }), {
    request,
    auth,
    token: providedToken,
    action: "task-status",
    payload: { task_id: taskId, status },
  });
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
  const providedToken = dashboardProvidedWriteToken(request);
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
  }), {
    request,
    auth,
    token: providedToken,
    action: "task-create",
    payload: (mutationResult) => ({
      task_id: mutationResult.task?.task_id || payload.task_id || null,
      project_id: payload.project_id,
      status: payload.status,
      priority: payload.priority,
      assignee: payload.assignee,
      title_hash: shortHash(payload.title),
      title_length: payload.title.length,
    }),
  });
  return sendJson(response, 200, {
    ok: true,
    task: result.task,
    meta: result.meta,
  });
}

export async function handleDashboardTaskUpdate(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const providedToken = dashboardProvidedWriteToken(request);
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
  }), {
    request,
    auth,
    token: providedToken,
    action: "task-update",
    payload: (mutationResult) => ({
      task_id: taskId,
      changed_fields: mutationResult.update?.changed_fields || Object.keys(patch),
    }),
  });
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
  const providedToken = dashboardProvidedWriteToken(request);
  const auth = dashboardWriteAuth(request);
  if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });
  const body = await readJsonBody(request);
  const taskId = requireString(body.task_id, "task_id");
  const commentBody = requireString(body.body, "body");
  const author = optionalString(auth.viewer) || "Vercel dashboard";
  const comment = makeTaskComment(taskId, commentBody, author);
  const result = await persistMutation((snapshot) => applySnapshotTaskComment(snapshot, taskId, comment, {
    source: "vercel-blob",
  }), {
    request,
    auth,
    token: providedToken,
    action: "task-comment",
    payload: {
      task_id: taskId,
      comment_id: comment.comment_id,
      body_hash: shortHash(commentBody),
      body_length: commentBody.length,
    },
  });
  return sendJson(response, 200, {
    ok: true,
    comment,
    meta: result.meta,
  });
}

export async function handleDashboardTaskCommentDelete(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const providedToken = dashboardProvidedWriteToken(request);
  const auth = dashboardWriteAuth(request);
  if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });
  const body = await readJsonBody(request);
  const taskId = requireString(body.task_id, "task_id");
  const commentId = requireString(body.comment_id, "comment_id");
  const result = await persistMutation((snapshot) => applySnapshotTaskCommentDelete(snapshot, taskId, commentId, {
    source: "vercel-blob",
  }), {
    request,
    auth,
    token: providedToken,
    action: "task-comment-delete",
    payload: { task_id: taskId, comment_id: commentId },
  });
  return sendJson(response, 200, {
    ok: true,
    task_id: taskId,
    comment_id: commentId,
    deleted_comment: result.comment,
    meta: result.meta,
  });
}

export async function handleDashboardProjectTableRowUpdate(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const providedToken = dashboardProvidedWriteToken(request);
  const auth = dashboardWriteAuth(request);
  if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });
  const body = await readJsonBody(request);
  const projectId = requireString(body.project_id, "project_id");
  const rowId = requireString(body.row_id, "row_id");
  const tableKind = optionalString(body.table_kind || body.kind) || "procurement_table";
  const patch = body.patch && typeof body.patch === "object" ? body.patch : {};
  const result = await persistMutation((snapshot) => applySnapshotProjectTableRowUpdate(snapshot, {
    project_id: projectId,
    table_kind: tableKind,
    row_id: rowId,
    patch,
  }, {
    source: "vercel-blob",
  }), {
    request,
    auth,
    token: providedToken,
    action: "project-table-row-update",
    payload: (mutationResult) => ({
      project_id: projectId,
      table_kind: tableKind,
      row_id: rowId,
      changed_fields: mutationResult.update?.changed_fields || Object.keys(patch),
    }),
  });
  return sendJson(response, 200, {
    ok: true,
    project_id: projectId,
    table_kind: tableKind,
    row_id: rowId,
    row: result.row,
    update: result.update,
    meta: result.meta,
  });
}

export async function handleDashboardAuditLog(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  const auth = dashboardWriteAuth(request);
  if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });
  const url = new URL(request.url || "/", "https://jingxiangguo.com");
  const requestedLimit = Number.parseInt(url.searchParams.get("limit") || "100", 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), 200)
    : 100;
  const { snapshot, meta } = await loadVercelDashboardSnapshot();
  const auditLog = Array.isArray(snapshot.audit_log) ? snapshot.audit_log : [];
  return sendJson(response, 200, {
    ok: true,
    audit_log: auditLog.slice(-limit).reverse(),
    meta: {
      ...meta,
      viewer: auth.viewer || null,
      returned: Math.min(limit, auditLog.length),
      total: auditLog.length,
    },
  });
}
