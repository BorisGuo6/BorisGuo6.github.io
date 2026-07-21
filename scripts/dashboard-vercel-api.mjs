import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  generateAuthenticationOptions as defaultGenerateAuthenticationOptions,
  generateRegistrationOptions as defaultGenerateRegistrationOptions,
  verifyAuthenticationResponse as defaultVerifyAuthenticationResponse,
  verifyRegistrationResponse as defaultVerifyRegistrationResponse,
} from "@simplewebauthn/server";
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
import {
  assertDashboardProjectWriteScope,
  assertDashboardTaskWriteScope,
  createDashboardAccessUser,
  deleteDashboardAccessUser,
  applyDashboardEnvironmentOverride,
  dashboardEnvironmentOverrideForViewer,
  dashboardProjectOptions,
  defaultDashboardVisibility,
  filterDashboardSnapshotForAuth,
  listDashboardAccessUsers,
  loadDashboardAccessControl,
  normalizeDashboardVisibility,
  rotateDashboardAccessToken,
  updateDashboardAccessUser,
  updateDashboardEnvironmentOverride,
  verifyDashboardAccessToken,
  writeDashboardAccessControl,
} from "./dashboard-access-control.mjs";
import {
  completeDashboardPasskeyAuthentication,
  completeDashboardPasskeyRegistration,
  createDashboardPasskeyChallenge,
  deleteDashboardPasskeyCredential,
  findDashboardPasskeyCredential,
  listDashboardPasskeyCredentials,
  loadDashboardPasskeyStore,
  readDashboardPasskeyChallenge,
  renameDashboardPasskeyCredential,
  writeDashboardPasskeyStore,
} from "./dashboard-passkeys.mjs";

let mutationQueue = Promise.resolve();
let accessMutationQueue = Promise.resolve();
let passkeyMutationQueue = Promise.resolve();
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
  if (message === "Invalid dashboard Passkey relying-party configuration") {
    return { status: 503, error: "Dashboard Passkey is unavailable" };
  }
  if (/^Duplicate Passkey credential:/.test(message)) {
    return { status: 409, error: "Passkey credential already exists" };
  }
  if (/^Passkey credential not found:/.test(message)) {
    return { status: 404, error: "Passkey not found" };
  }
  if (/^(Passkey challenge not found:|Expired Passkey challenge|Invalid Passkey challenge ceremony)/.test(message)) {
    return { status: 400, error: "Passkey ceremony is invalid or expired" };
  }
  if (/^(Invalid Passkey label|Missing Passkey label)/.test(message)) {
    return { status: 400, error: message };
  }
  if (/^Invalid Passkey/.test(message)) {
    return { status: 400, error: "Invalid Passkey request" };
  }
  if (message === "Request body is too large") {
    return { status: 413, error: message };
  }
  if (message === "Dashboard write is outside the viewer's visible scope") {
    return { status: 403, error: message };
  }
  if (/^(Task|Project|Table row|Comment|Access user) not found:/.test(message)) {
    return { status: 404, error: message };
  }
  if (/^(Missing |Invalid |Access user already exists:|URL must |Comment .* belongs to )/.test(message)) {
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

const dashboardIndividualTokenPrefix = "DASHBOARD_WRITE_TOKEN_";

function dashboardIndividualWriteTokens(env = process.env) {
  return Object.entries(env)
    .filter(([key]) => key.startsWith(dashboardIndividualTokenPrefix) && key !== "DASHBOARD_WRITE_TOKEN_USERS")
    .map(([key, value]) => {
      const suffix = key.slice(dashboardIndividualTokenPrefix.length);
      const token = optionalString(value);
      if (!token || !/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/.test(suffix)) return null;
      return {
        token,
        viewer: suffix.toLowerCase().replaceAll("_", " "),
      };
    })
    .filter(Boolean);
}

function dashboardMappedWriteTokens(env = process.env) {
  const userMap = optionalString(env.DASHBOARD_WRITE_TOKEN_USERS || env.DASHBOARD_USER_TOKENS);
  if (!userMap) return [];
  try {
    return Object.entries(JSON.parse(userMap) || {})
      .map(([token, viewer]) => ({ token: optionalString(token), viewer: optionalString(viewer) }))
      .filter(({ token, viewer }) => token && viewer);
  } catch (error) {
    return [];
  }
}

function dashboardEnvironmentCredentialForToken(providedToken, env = process.env) {
  if (!providedToken) return null;
  if (optionalString(env.DASHBOARD_WRITE_TOKEN) && safeEqual(providedToken, env.DASHBOARD_WRITE_TOKEN)) {
    return {
      viewer: dashboardAdminViewer(),
      role: "admin",
      source: "environment",
    };
  }
  const mapped = dashboardMappedWriteTokens(env).find(({ token }) => safeEqual(providedToken, token));
  if (mapped) return { viewer: mapped.viewer, role: "viewer", source: "environment" };
  const individual = dashboardIndividualWriteTokens(env).find(({ token }) => safeEqual(providedToken, token));
  if (individual) return { viewer: individual.viewer, role: "viewer", source: "environment" };
  return null;
}

function dashboardSessionSecret(env = process.env) {
  return optionalString(
    env.DASHBOARD_SESSION_SECRET
      || env.DASHBOARD_WRITE_TOKEN,
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

function dashboardAdminViewer() {
  return "jingxiang";
}

export function dashboardRoleForViewer(viewer, env = process.env) {
  return optionalString(viewer).toLocaleLowerCase("en-US") === dashboardAdminViewer().toLocaleLowerCase("en-US")
    ? "admin"
    : "viewer";
}

function dashboardAuthEnvelope(viewer, options = {}) {
  const normalizedViewer = optionalString(viewer) || "unknown";
  const role = options.role === "admin" ? "admin" : "viewer";
  const visibility = role === "admin"
    ? { bucket_ids: ["research", "engineering", "survey", "archive"], include_project_ids: [], exclude_project_ids: [] }
    : normalizeDashboardVisibility(options.visibility || defaultDashboardVisibility);
  return {
    ok: true,
    viewer: normalizedViewer,
    user_id: optionalString(options.user_id) || null,
    session_version: Number.isSafeInteger(options.session_version) && options.session_version > 0
      ? options.session_version
      : 1,
    role,
    source: optionalString(options.source) || "environment",
    visibility,
    permissions: {
      can_write: true,
      can_manage_access: role === "admin",
    },
  };
}

function publicDashboardAuth(auth) {
  if (!auth) return null;
  if (!auth.ok) {
    return {
      ok: false,
      status: auth.status || 401,
      error: auth.error || "Dashboard authentication failed",
    };
  }
  return {
    ok: true,
    status: 200,
    error: null,
    viewer: auth.viewer,
    user_id: auth.user_id || null,
    session_version: auth.session_version || 1,
    role: auth.role,
    visibility: auth.visibility,
    permissions: auth.permissions,
  };
}

export function createDashboardSession(viewerOrAuth, env = process.env, options = {}) {
  const secret = dashboardSessionSecret(env);
  if (!secret) {
    throw new Error("Dashboard session secret is not configured");
  }
  const now = options.now || new Date();
  const maxAgeSeconds = Number(options.maxAgeSeconds || dashboardSessionMaxAgeSeconds);
  const input = viewerOrAuth && typeof viewerOrAuth === "object"
    ? viewerOrAuth
    : dashboardAuthEnvelope(viewerOrAuth, {
      role: dashboardRoleForViewer(viewerOrAuth, env),
      source: "environment",
    });
  const payload = Buffer.from(JSON.stringify({
    v: 2,
    viewer: optionalString(input.viewer) || "unknown",
    user_id: optionalString(input.user_id) || null,
    session_version: Number.isSafeInteger(input.session_version) && input.session_version > 0
      ? input.session_version
      : 1,
    role: input.role === "admin" ? "admin" : "viewer",
    source: optionalString(input.source) || "environment",
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
    if (![1, 2].includes(parsed?.v) || !viewer || !Number.isFinite(parsed?.exp) || parsed.exp <= nowSeconds) {
      return { ok: false, status: 401, error: "Expired dashboard session" };
    }
    return dashboardAuthEnvelope(viewer, {
      user_id: parsed?.v === 2 ? parsed.user_id : null,
      session_version: parsed?.v === 2 ? parsed.session_version : 1,
      role: parsed?.v === 2 ? parsed.role : dashboardRoleForViewer(viewer, env),
      source: parsed?.v === 2 ? parsed.source : "environment",
    });
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
  return dashboardEnvironmentCredentialForToken(providedToken, env)?.viewer || "";
}

export function dashboardWriteTokenIsAllowed(providedToken, env = process.env) {
  return Boolean(dashboardEnvironmentCredentialForToken(providedToken, env));
}

export function dashboardWriteAuth(request, env = process.env) {
  const expectedToken = env.DASHBOARD_WRITE_TOKEN;
  const userMap = optionalString(env.DASHBOARD_WRITE_TOKEN_USERS || env.DASHBOARD_USER_TOKENS);
  const individualTokens = dashboardIndividualWriteTokens(env);
  if (!expectedToken && !userMap && individualTokens.length === 0) {
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
  const credential = dashboardEnvironmentCredentialForToken(providedToken, env);
  return dashboardAuthEnvelope(credential.viewer, credential);
}

export async function dashboardRequestAuth(request, env = process.env, options = {}) {
  const providedToken = dashboardProvidedWriteToken(request);
  if (!providedToken) {
    const sessionAuth = dashboardSessionAuth(request, env, options);
    if (!sessionAuth?.ok) return sessionAuth;
    if (sessionAuth.source !== "dashboard") {
      if (sessionAuth.role === "admin") return sessionAuth;
      try {
        const loadAccess = options.loadAccess || loadDashboardAccessControl;
        const { document } = await loadAccess({ env, ...options.accessOptions });
        const scopedCredential = applyDashboardEnvironmentOverride(document, sessionAuth);
        if (!scopedCredential) return { ok: false, status: 401, error: "Dashboard access has been revoked" };
        return dashboardAuthEnvelope(scopedCredential.viewer, scopedCredential);
      } catch (error) {
        return sessionAuth;
      }
    }
    const loadAccess = options.loadAccess || loadDashboardAccessControl;
    const { document } = await loadAccess({ env, ...options.accessOptions });
    const user = listDashboardAccessUsers(document)
      .find((candidate) => (
        candidate.user_id === sessionAuth.user_id
        && candidate.enabled
        && candidate.session_version === sessionAuth.session_version
      ));
    if (!user) return { ok: false, status: 401, error: "Dashboard access has been revoked" };
    return dashboardAuthEnvelope(user.viewer, {
      user_id: user.user_id,
      role: "viewer",
      source: "dashboard",
      visibility: user.visibility,
      session_version: user.session_version,
    });
  }

  const environmentCredential = dashboardEnvironmentCredentialForToken(providedToken, env);
  if (environmentCredential) {
    if (environmentCredential.role === "admin") {
      return dashboardAuthEnvelope(environmentCredential.viewer, environmentCredential);
    }
    try {
      const loadAccess = options.loadAccess || loadDashboardAccessControl;
      const { document } = await loadAccess({ env, ...options.accessOptions });
      const scopedCredential = applyDashboardEnvironmentOverride(document, environmentCredential);
      if (!scopedCredential) return { ok: false, status: 401, error: "Dashboard access has been revoked" };
      return dashboardAuthEnvelope(scopedCredential.viewer, scopedCredential);
    } catch (error) {
      return dashboardAuthEnvelope(environmentCredential.viewer, environmentCredential);
    }
  }
  if (!providedToken.startsWith("dash_")) {
    return dashboardWriteAuth(request, env);
  }
  const loadAccess = options.loadAccess || loadDashboardAccessControl;
  const { document } = await loadAccess({ env, ...options.accessOptions });
  const user = verifyDashboardAccessToken(document, providedToken);
  if (!user) return { ok: false, status: 401, error: "Invalid dashboard access token" };
  return dashboardAuthEnvelope(user.viewer, {
    user_id: user.user_id,
    role: "viewer",
    source: "dashboard",
    visibility: user.visibility,
    session_version: user.session_version,
  });
}

export function dashboardCanWrite(env = process.env) {
  return Boolean(
    optionalString(env.DASHBOARD_WRITE_TOKEN)
      && optionalString(env.BLOB_READ_WRITE_TOKEN),
  );
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

const dashboardPasskeyDefaultRpId = "jingxiangguo.com";
const dashboardPasskeyDefaultOrigin = "https://jingxiangguo.com";
const dashboardPasskeyRpName = "Jingxiang Guo Dashboard";
const dashboardPasskeyAllowedTransports = new Set([
  "usb",
  "nfc",
  "ble",
  "cable",
  "smart-card",
  "hybrid",
  "internal",
]);

function dashboardPasskeyLoopbackHost(hostname) {
  const normalized = optionalString(hostname).toLocaleLowerCase("en-US");
  return normalized === "localhost"
    || normalized === "::1"
    || normalized === "[::1]"
    || /^127(?:\.[0-9]{1,3}){3}$/.test(normalized);
}

function dashboardPasskeyValidRpId(value) {
  const normalized = optionalString(value).toLocaleLowerCase("en-US");
  if (dashboardPasskeyLoopbackHost(normalized)) return true;
  if (!normalized || normalized.length > 253 || /^\d+(?:\.\d+){3}$/.test(normalized)) return false;
  return normalized.split(".").every((label) => (
    label.length > 0
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ));
}

export function dashboardPasskeyRpConfig(env = process.env) {
  const rpID = optionalString(env.DASHBOARD_PASSKEY_RP_ID) || dashboardPasskeyDefaultRpId;
  const configuredOrigin = optionalString(env.DASHBOARD_PASSKEY_ORIGIN) || dashboardPasskeyDefaultOrigin;
  let rpUrl;
  let origin;
  try {
    rpUrl = new URL(`https://${rpID}`);
    origin = new URL(configuredOrigin);
  } catch (error) {
    throw new Error("Invalid dashboard Passkey relying-party configuration");
  }
  const normalizedRpID = rpID.toLocaleLowerCase("en-US");
  const originHost = origin.hostname.toLocaleLowerCase("en-US");
  const validRpID = rpID === normalizedRpID
    && dashboardPasskeyValidRpId(normalizedRpID)
    && rpUrl.hostname === normalizedRpID
    && rpUrl.host === normalizedRpID
    && rpUrl.pathname === "/"
    && !rpUrl.username
    && !rpUrl.password
    && !rpUrl.search
    && !rpUrl.hash;
  const exactOrigin = configuredOrigin === origin.origin
    && origin.pathname === "/"
    && !origin.username
    && !origin.password
    && !origin.search
    && !origin.hash;
  const rpMatchesOrigin = originHost === normalizedRpID || originHost.endsWith(`.${normalizedRpID}`);
  const productionEnvironment = env.VERCEL_ENV === "production" || env.NODE_ENV === "production";
  const insecureDevelopmentOrigin = origin.protocol === "http:"
    && dashboardPasskeyLoopbackHost(origin.hostname)
    && !productionEnvironment;
  if (
    !validRpID
    || !exactOrigin
    || !rpMatchesOrigin
    || (productionEnvironment && dashboardPasskeyLoopbackHost(normalizedRpID))
    || (origin.protocol !== "https:" && !insecureDevelopmentOrigin)
  ) {
    throw new Error("Invalid dashboard Passkey relying-party configuration");
  }
  return {
    rpID: normalizedRpID,
    origin: origin.origin,
    rpName: dashboardPasskeyRpName,
  };
}

function dashboardPasskeyTransports(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((transport) => dashboardPasskeyAllowedTransports.has(transport)))];
}

function dashboardPasskeyStoreOptions(options = {}, env = process.env) {
  return {
    ...(options.passkeyStoreOptions || {}),
    env,
    ...(options.now ? { now: options.now } : {}),
  };
}

function dashboardPasskeyWebAuthn(options = {}) {
  return {
    generateAuthenticationOptions: options.generateAuthenticationOptions || defaultGenerateAuthenticationOptions,
    generateRegistrationOptions: options.generateRegistrationOptions || defaultGenerateRegistrationOptions,
    verifyAuthenticationResponse: options.verifyAuthenticationResponse || defaultVerifyAuthenticationResponse,
    verifyRegistrationResponse: options.verifyRegistrationResponse || defaultVerifyRegistrationResponse,
  };
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

async function persistAccessMutation(mutation, options = {}) {
  const run = accessMutationQueue.catch(() => undefined).then(async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const { document, meta } = await loadDashboardAccessControl(options);
      const result = mutation(document);
      try {
        const blob = await writeDashboardAccessControl(result.document, {
          ...options,
          ifMatch: meta.etag || undefined,
          allowOverwrite: false,
        });
        return {
          ...result,
          meta: {
            storage: "vercel-blob-private",
            blob_path: blob.pathname,
            blob_etag: blob.etag,
            updated_at: result.document.updated_at,
            mutation_attempt: attempt,
          },
        };
      } catch (error) {
        const isConflict = isBlobPreconditionFailedError(error)
          || error?.name === "BlobAlreadyExistsError"
          || error?.constructor?.name === "BlobAlreadyExistsError";
        if (!isConflict || attempt === 3) throw error;
      }
    }
    throw new Error("Dashboard access mutation retries exhausted");
  });
  accessMutationQueue = run.catch(() => undefined);
  return run;
}

async function persistPasskeyMutation(mutation, options = {}) {
  const env = options.env || process.env;
  const loadPasskeyStore = options.loadPasskeyStore || loadDashboardPasskeyStore;
  const writePasskeyStore = options.writePasskeyStore || writeDashboardPasskeyStore;
  const storeOptions = dashboardPasskeyStoreOptions(options, env);
  const run = passkeyMutationQueue.catch(() => undefined).then(async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const { document, meta } = await loadPasskeyStore(storeOptions);
      const result = await mutation(document);
      try {
        const blob = await writePasskeyStore(result.document, {
          ...storeOptions,
          ifMatch: meta.etag || undefined,
          allowOverwrite: false,
        });
        return {
          ...result,
          meta: {
            storage: "vercel-blob-private",
            blob_path: blob.pathname,
            blob_etag: blob.etag,
            updated_at: result.document.updated_at,
            mutation_attempt: attempt,
          },
        };
      } catch (error) {
        const isConflict = isBlobPreconditionFailedError(error)
          || error?.name === "BlobAlreadyExistsError"
          || error?.constructor?.name === "BlobAlreadyExistsError";
        if (!isConflict || attempt === 3) throw error;
      }
    }
    throw new Error("Dashboard Passkey mutation retries exhausted");
  });
  passkeyMutationQueue = run.catch(() => undefined);
  return run;
}

function dashboardWriteAuthorization(auth) {
  if (!auth?.ok) return auth || { ok: false, status: 401, error: "Dashboard authentication required" };
  if (!auth.permissions?.can_write) {
    return { ok: false, status: 403, error: "Dashboard write access is unavailable" };
  }
  return auth;
}

function dashboardAdminAuthorization(auth) {
  if (!auth?.ok) return auth || { ok: false, status: 401, error: "Dashboard authentication required" };
  if (!auth.permissions?.can_manage_access) {
    return { ok: false, status: 403, error: "Dashboard access settings require the administrator role" };
  }
  return auth;
}

export async function handleDashboardHealth(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  const providedToken = dashboardProvidedWriteToken(request);
  const providedSession = dashboardProvidedSession(request);
  const accessAuth = providedToken || providedSession
    ? await dashboardRequestAuth(request)
    : null;
  const health = await getDashboardHealth();
  return sendJson(response, health.ok ? 200 : 503, {
    ...health,
    write_auth: accessAuth
      ? publicDashboardAuth(accessAuth)
      : null,
  });
}

export async function getDashboardHealth(options = {}) {
  const env = options.env || process.env;
  const loadSnapshot = options.loadSnapshot || loadVercelDashboardSnapshot;
  const configuredStorage = isVercelBlobConfigured(env) ? "vercel-blob" : "bundled-json";
  try {
    const { snapshot, meta } = await loadSnapshot({ env });
    const storage = meta?.storage || configuredStorage;
    const blobBackedRead = storage === "vercel-blob"
      || storage === "bundled-json-newer-than-blob"
      || storage === "bundled-json-blob-read-failed";
    if (configuredStorage === "vercel-blob" && !blobBackedRead) {
      throw new Error("Configured dashboard Blob is missing");
    }
    return {
      ok: true,
      mode: "vercel-dashboard-api",
      storage,
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
  const auth = await dashboardRequestAuth({ ...request, headers: { ...request.headers, cookie: "" } });
  if (!auth?.ok) {
    return sendJson(response, auth?.status || 401, { ok: false, error: auth?.error || "Invalid dashboard access token" });
  }
  const session = createDashboardSession(auth);
  response.setHeader("set-cookie", dashboardSessionCookie(request, session, dashboardSessionMaxAgeSeconds));
  return sendJson(response, 200, {
    ok: true,
    write_auth: publicDashboardAuth(auth),
  });
}

function requireDashboardPasskeyCeremony(value) {
  const ceremony = optionalString(value);
  if (!new Set(["registration", "authentication"]).has(ceremony)) {
    throw new Error("Invalid Passkey ceremony");
  }
  return ceremony;
}

function requireDashboardPasskeyResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Missing Passkey response");
  }
  return value;
}

function dashboardPasskeyAdminSessionAuth(request, env = process.env, options = {}) {
  return dashboardAdminAuthorization(dashboardSessionAuth(request, env, options));
}

function dashboardPasskeyCeremonyFailed(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /^(Passkey challenge not found:|Expired Passkey challenge|Invalid Passkey challenge ceremony|Invalid Passkey counter progression)/.test(message);
}

export async function handleDashboardPasskeyOptions(request, response, options = {}) {
  const env = options.env || process.env;
  const loadPasskeyStore = options.loadPasskeyStore || loadDashboardPasskeyStore;
  const storeOptions = dashboardPasskeyStoreOptions(options, env);
  if (request.method === "GET") {
    try {
      const { document } = await loadPasskeyStore(storeOptions);
      return sendJson(response, 200, {
        ok: true,
        available: listDashboardPasskeyCredentials(document, storeOptions).length > 0,
      });
    } catch (error) {
      return sendJson(response, 200, { ok: true, available: false });
    }
  }
  if (request.method !== "POST") return methodNotAllowed(response, ["GET", "POST"]);
  const body = await readJsonBody(request);
  const ceremony = requireDashboardPasskeyCeremony(body.ceremony);
  const rp = dashboardPasskeyRpConfig(env);
  const webauthn = dashboardPasskeyWebAuthn(options);

  if (ceremony === "registration") {
    const auth = dashboardPasskeyAdminSessionAuth(request, env, options);
    if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });
    const result = await persistPasskeyMutation(async (document) => {
      const credentials = listDashboardPasskeyCredentials(document, storeOptions);
      const registrationOptions = await webauthn.generateRegistrationOptions({
        rpName: rp.rpName,
        rpID: rp.rpID,
        userName: dashboardAdminViewer(),
        userDisplayName: "Jingxiang Guo",
        userID: Buffer.from(document.admin_user_id, "base64url"),
        timeout: 5 * 60 * 1000,
        attestationType: "none",
        excludeCredentials: credentials.map((credential) => ({
          id: credential.credential_id,
          transports: dashboardPasskeyTransports(credential.transports),
        })),
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
      });
      const created = createDashboardPasskeyChallenge(document, {
        ceremony,
        challenge: registrationOptions.challenge,
      }, storeOptions);
      return { ...created, options: registrationOptions };
    }, options);
    return sendJson(response, 200, {
      ok: true,
      ceremony_id: result.challenge.challenge_id,
      options: result.options,
    });
  }

  try {
    const result = await persistPasskeyMutation(async (document) => {
      const credentials = listDashboardPasskeyCredentials(document, storeOptions);
      if (!credentials.length) throw new Error("Passkey sign-in is unavailable");
      const authenticationOptions = await webauthn.generateAuthenticationOptions({
        rpID: rp.rpID,
        timeout: 5 * 60 * 1000,
        userVerification: "required",
        allowCredentials: credentials.map((credential) => ({
          id: credential.credential_id,
          transports: dashboardPasskeyTransports(credential.transports),
        })),
      });
      const created = createDashboardPasskeyChallenge(document, {
        ceremony,
        challenge: authenticationOptions.challenge,
      }, storeOptions);
      return { ...created, options: authenticationOptions };
    }, options);
    return sendJson(response, 200, {
      ok: true,
      ceremony_id: result.challenge.challenge_id,
      options: result.options,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    const status = message === "Passkey sign-in is unavailable" ? 404 : 503;
    return sendJson(response, status, { ok: false, error: "Passkey sign-in is unavailable" });
  }
}

export async function handleDashboardPasskeyVerify(request, response, options = {}) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const env = options.env || process.env;
  const body = await readJsonBody(request);
  const ceremony = requireDashboardPasskeyCeremony(body.ceremony);
  const ceremonyId = requireString(body.ceremony_id, "ceremony_id");
  const credentialResponse = requireDashboardPasskeyResponse(body.response);
  const rp = dashboardPasskeyRpConfig(env);
  const webauthn = dashboardPasskeyWebAuthn(options);
  const loadPasskeyStore = options.loadPasskeyStore || loadDashboardPasskeyStore;
  const storeOptions = dashboardPasskeyStoreOptions(options, env);

  if (ceremony === "registration") {
    const auth = dashboardPasskeyAdminSessionAuth(request, env, options);
    if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });
    const { document } = await loadPasskeyStore(storeOptions);
    let verification;
    try {
      const challenge = readDashboardPasskeyChallenge(document, ceremonyId, ceremony, storeOptions);
      verification = await webauthn.verifyRegistrationResponse({
        response: credentialResponse,
        expectedChallenge: challenge.challenge,
        expectedOrigin: rp.origin,
        expectedRPID: rp.rpID,
        expectedType: "webauthn.create",
        requireUserPresence: true,
        requireUserVerification: true,
      });
    } catch (error) {
      return sendJson(response, 400, { ok: false, error: "Passkey registration failed" });
    }
    if (!verification?.verified || !verification.registrationInfo) {
      return sendJson(response, 400, { ok: false, error: "Passkey registration failed" });
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    try {
      const result = await persistPasskeyMutation((document) => completeDashboardPasskeyRegistration(
        document,
        ceremonyId,
        {
          credential_id: credential.id,
          public_key: Buffer.from(credential.publicKey).toString("base64url"),
          counter: credential.counter,
          transports: dashboardPasskeyTransports(credential.transports),
          device_type: credentialDeviceType,
          backed_up: credentialBackedUp,
          label: optionalString(body.label) || "Passkey",
        },
        storeOptions,
      ), options);
      return sendJson(response, 201, { ok: true, passkey: result.credential });
    } catch (error) {
      if (dashboardPasskeyCeremonyFailed(error)) {
        return sendJson(response, 400, { ok: false, error: "Passkey registration failed" });
      }
      throw error;
    }
  }

  let document;
  try {
    ({ document } = await loadPasskeyStore(storeOptions));
  } catch (error) {
    return sendJson(response, 503, { ok: false, error: "Passkey sign-in is unavailable" });
  }
  let storedCredential;
  let verification;
  try {
    const challenge = readDashboardPasskeyChallenge(document, ceremonyId, ceremony, storeOptions);
    storedCredential = findDashboardPasskeyCredential(document, credentialResponse.id, storeOptions);
    if (!storedCredential) throw new Error("Passkey credential not found");
    verification = await webauthn.verifyAuthenticationResponse({
      response: credentialResponse,
      expectedChallenge: challenge.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      expectedType: "webauthn.get",
      credential: {
        id: storedCredential.credential_id,
        publicKey: Buffer.from(storedCredential.public_key, "base64url"),
        counter: storedCredential.counter,
        transports: dashboardPasskeyTransports(storedCredential.transports),
      },
      requireUserVerification: true,
    });
  } catch (error) {
    return sendJson(response, 401, { ok: false, error: "Passkey authentication failed" });
  }
  if (!verification?.verified || !verification.authenticationInfo) {
    return sendJson(response, 401, { ok: false, error: "Passkey authentication failed" });
  }
  try {
    await persistPasskeyMutation((document) => completeDashboardPasskeyAuthentication(
      document,
      ceremonyId,
      {
        credential_id: storedCredential.credential_id,
        counter: verification.authenticationInfo.newCounter,
        transports: storedCredential.transports,
        device_type: verification.authenticationInfo.credentialDeviceType,
        backed_up: verification.authenticationInfo.credentialBackedUp,
      },
      storeOptions,
    ), options);
  } catch (error) {
    if (dashboardPasskeyCeremonyFailed(error) || /^Passkey credential not found:/.test(error?.message || "")) {
      return sendJson(response, 401, { ok: false, error: "Passkey authentication failed" });
    }
    throw error;
  }
  const auth = dashboardAuthEnvelope(dashboardAdminViewer(), {
    role: "admin",
    source: "passkey",
  });
  const session = createDashboardSession(auth, env, options);
  response.setHeader("set-cookie", dashboardSessionCookie(request, session, dashboardSessionMaxAgeSeconds));
  return sendJson(response, 200, {
    ok: true,
    write_auth: publicDashboardAuth(auth),
  });
}

export async function handleDashboardPasskeys(request, response, options = {}) {
  if (!["GET", "PATCH", "DELETE"].includes(request.method)) {
    return methodNotAllowed(response, ["GET", "PATCH", "DELETE"]);
  }
  const env = options.env || process.env;
  const auth = dashboardAdminAuthorization(await dashboardRequestAuth(request, env, options.authOptions || {}));
  if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });
  const loadPasskeyStore = options.loadPasskeyStore || loadDashboardPasskeyStore;
  const storeOptions = dashboardPasskeyStoreOptions(options, env);

  if (request.method === "GET") {
    const { document, meta } = await loadPasskeyStore(storeOptions);
    return sendJson(response, 200, {
      ok: true,
      passkeys: listDashboardPasskeyCredentials(document, storeOptions),
      recovery: {
        token_login_available: Boolean(optionalString(env.DASHBOARD_WRITE_TOKEN)),
      },
      meta: {
        storage: meta.storage,
        updated_at: document.updated_at,
        viewer: auth.viewer,
      },
    });
  }

  const body = await readJsonBody(request);
  const credentialId = requireString(body.credential_id, "credential_id");
  if (request.method === "PATCH") {
    const label = requireString(body.label, "label");
    const result = await persistPasskeyMutation(
      (document) => renameDashboardPasskeyCredential(document, credentialId, label, storeOptions),
      options,
    );
    return sendJson(response, 200, { ok: true, passkey: result.credential });
  }

  const result = await persistPasskeyMutation(
    (document) => deleteDashboardPasskeyCredential(document, credentialId, storeOptions),
    options,
  );
  return sendJson(response, 200, {
    ok: true,
    passkey: result.credential,
    deleted: true,
    recovery_notice: "The administrator token remains available as the recovery sign-in method.",
  });
}

export async function handleDashboardState(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  const auth = await dashboardRequestAuth(request);
  if (!auth?.ok) return sendJson(response, auth?.status || 401, { ok: false, error: auth?.error || "Dashboard authentication required" });
  const { snapshot, meta } = await loadVercelDashboardSnapshot();
  const filteredSnapshot = filterDashboardSnapshotForAuth(snapshot, auth);
  return sendJson(response, 200, toDashboardStateResponse(filteredSnapshot, {
    ...meta,
    writable: Boolean(auth.permissions?.can_write && dashboardCanWrite()),
    auth: publicDashboardAuth(auth),
  }));
}

export async function handleDashboardTaskStatus(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  const providedToken = dashboardProvidedWriteToken(request);
  const auth = dashboardWriteAuthorization(await dashboardRequestAuth(request));
  if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });
  const body = await readJsonBody(request);
  const taskId = requireString(body.task_id, "task_id");
  const status = requireString(body.status, "status");
  const result = await persistMutation((snapshot) => {
    assertDashboardTaskWriteScope(snapshot, auth, taskId);
    return applySnapshotTaskStatus(snapshot, taskId, status, {
      source: "vercel-blob",
    });
  }, {
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
  const auth = dashboardWriteAuthorization(await dashboardRequestAuth(request));
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
  const result = await persistMutation((snapshot) => {
    assertDashboardProjectWriteScope(snapshot, auth, payload.project_id);
    return applySnapshotTaskCreate(snapshot, payload, {
      source: "vercel-blob",
    });
  }, {
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
  const auth = dashboardWriteAuthorization(await dashboardRequestAuth(request));
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
  const result = await persistMutation((snapshot) => {
    assertDashboardTaskWriteScope(snapshot, auth, taskId);
    return applySnapshotTaskUpdate(snapshot, taskId, patch, {
      source: "vercel-blob",
    });
  }, {
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
  const auth = dashboardWriteAuthorization(await dashboardRequestAuth(request));
  if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });
  const body = await readJsonBody(request);
  const taskId = requireString(body.task_id, "task_id");
  const commentBody = requireString(body.body, "body");
  const author = optionalString(auth.viewer) || "Vercel dashboard";
  const comment = makeTaskComment(taskId, commentBody, author);
  const result = await persistMutation((snapshot) => {
    assertDashboardTaskWriteScope(snapshot, auth, taskId);
    return applySnapshotTaskComment(snapshot, taskId, comment, {
      source: "vercel-blob",
    });
  }, {
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
  const auth = dashboardWriteAuthorization(await dashboardRequestAuth(request));
  if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });
  const body = await readJsonBody(request);
  const taskId = requireString(body.task_id, "task_id");
  const commentId = requireString(body.comment_id, "comment_id");
  const result = await persistMutation((snapshot) => {
    assertDashboardTaskWriteScope(snapshot, auth, taskId);
    return applySnapshotTaskCommentDelete(snapshot, taskId, commentId, {
      source: "vercel-blob",
    });
  }, {
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
  const auth = dashboardWriteAuthorization(await dashboardRequestAuth(request));
  if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });
  const body = await readJsonBody(request);
  const projectId = requireString(body.project_id, "project_id");
  const rowId = requireString(body.row_id, "row_id");
  const tableKind = optionalString(body.table_kind || body.kind) || "procurement_table";
  const patch = body.patch && typeof body.patch === "object" ? body.patch : {};
  const result = await persistMutation((snapshot) => {
    assertDashboardProjectWriteScope(snapshot, auth, projectId);
    return applySnapshotProjectTableRowUpdate(snapshot, {
      project_id: projectId,
      table_kind: tableKind,
      row_id: rowId,
      patch,
    }, {
      source: "vercel-blob",
    });
  }, {
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
  const auth = dashboardAdminAuthorization(await dashboardRequestAuth(request));
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

function dashboardEnvironmentAccessCredentials(env = process.env, document = null) {
  const credentials = [];
  const adminToken = optionalString(env.DASHBOARD_WRITE_TOKEN);
  if (adminToken) {
    credentials.push({
      token: adminToken,
      viewer: dashboardAdminViewer(),
      role: "admin",
    });
  }
  dashboardMappedWriteTokens(env).forEach((credential) => credentials.push({ ...credential, role: "viewer" }));
  dashboardIndividualWriteTokens(env).forEach((credential) => credentials.push({ ...credential, role: "viewer" }));
  const principalsByToken = new Map();
  credentials.forEach((credential) => {
    const principalKey = `${credential.role}:${credential.viewer.toLocaleLowerCase("en-US")}`;
    const principals = principalsByToken.get(credential.token) || new Set();
    principals.add(principalKey);
    principalsByToken.set(credential.token, principals);
  });
  const users = new Map();
  credentials.forEach((credential) => {
    const key = `${credential.role}:${credential.viewer.toLocaleLowerCase("en-US")}`;
    const override = credential.role === "viewer" && document
      ? dashboardEnvironmentOverrideForViewer(document, credential.viewer)
      : null;
    const existing = users.get(key);
    if (existing) {
      existing.user.credential_count += 1;
      return;
    }
    const authCredential = override
      ? { ...credential, visibility: override.visibility }
      : credential;
    users.set(key, {
      token: credential.token,
      user: {
        user_id: `env_${shortHash(key)}`,
        viewer: credential.viewer,
        role: credential.role,
        enabled: override ? override.enabled !== false : true,
        visibility: dashboardAuthEnvelope(credential.viewer, authCredential).visibility,
        token_fingerprint: dashboardTokenFingerprint(credential.token),
        token_hint: override ? "Environment credential · Settings scope" : "Environment credential",
        created_at: null,
        updated_at: override?.updated_at || null,
        rotated_at: null,
        managed_by: "environment",
        editable: credential.role !== "admin",
        token_copy_mode: credential.role === "admin" ? "none" : "environment-copyable",
        credential_count: 1,
      },
    });
  });
  return [...users.values()].map((credential) => {
    const principalKey = `${credential.user.role}:${credential.user.viewer.toLocaleLowerCase("en-US")}`;
    const resolvedCredential = dashboardEnvironmentCredentialForToken(credential.token, env);
    const resolvedPrincipalKey = resolvedCredential
      ? `${resolvedCredential.role}:${resolvedCredential.viewer.toLocaleLowerCase("en-US")}`
      : "";
    const tokenPrincipals = principalsByToken.get(credential.token);
    if (
      credential.user.role !== "admin"
      && (
        credential.user.credential_count !== 1
        || tokenPrincipals?.size !== 1
        || resolvedPrincipalKey !== principalKey
      )
    ) {
      credential.user.token_copy_mode = "environment-ambiguous";
    }
    return credential;
  });
}

export function dashboardEnvironmentAccessUsers(env = process.env, document = null) {
  return dashboardEnvironmentAccessCredentials(env, document).map(({ user }) => user);
}

export function dashboardEnvironmentTokenForAdminCopy(userId, env = process.env, document = null) {
  const targetId = optionalString(userId);
  const credential = dashboardEnvironmentAccessCredentials(env, document)
    .find(({ user }) => user.user_id === targetId);
  if (!credential) throw new Error(`Access user not found: ${targetId}`);
  if (credential.user.role === "admin" || credential.user.enabled === false) {
    throw new Error("Invalid access token copy target");
  }
  if (credential.user.token_copy_mode !== "environment-copyable") {
    throw new Error("Invalid access token copy target: ambiguous environment credential");
  }
  return credential;
}

export async function handleDashboardAccessUsers(request, response) {
  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
    return methodNotAllowed(response, ["GET", "POST", "PATCH", "DELETE"]);
  }
  const auth = dashboardAdminAuthorization(await dashboardRequestAuth(request));
  if (!auth.ok) return sendJson(response, auth.status, { ok: false, error: auth.error });

  if (request.method === "GET") {
    const [{ document, meta }, { snapshot }] = await Promise.all([
      loadDashboardAccessControl(),
      loadVercelDashboardSnapshot(),
    ]);
    return sendJson(response, 200, {
      ok: true,
      users: [...dashboardEnvironmentAccessUsers(process.env, document), ...listDashboardAccessUsers(document)],
      projects: dashboardProjectOptions(snapshot),
      meta: {
        storage: meta.storage,
        updated_at: document.updated_at,
        viewer: auth.viewer,
      },
    });
  }

  const body = await readJsonBody(request);
  if (request.method === "POST" && optionalString(body.action) === "copy") {
    const userId = requireString(body.user_id, "user_id");
    if (!userId.startsWith("env_")) throw new Error("Invalid access token copy target");
    const { document, meta } = await loadDashboardAccessControl();
    const result = dashboardEnvironmentTokenForAdminCopy(userId, process.env, document);
    return sendJson(response, 200, {
      ok: true,
      user: result.user,
      token: result.token,
      token_notice: "Copied from the Vercel runtime environment for this administrator request only.",
      meta: {
        storage: meta.storage,
        updated_at: document.updated_at,
        viewer: auth.viewer,
      },
    });
  }
  if (request.method === "POST" && optionalString(body.action) === "rotate") {
    const userId = requireString(body.user_id, "user_id");
    const result = await persistAccessMutation((document) => rotateDashboardAccessToken(document, userId));
    return sendJson(response, 200, {
      ok: true,
      user: result.user,
      token: result.token,
      token_notice: "Copy this token now. It will not be shown again.",
      meta: result.meta,
    });
  }
  if (request.method === "POST" && optionalString(body.action) === "delete") {
    const userId = requireString(body.user_id, "user_id");
    if (userId.startsWith("env_")) throw new Error("Invalid access user deletion target");
    const result = await persistAccessMutation((document) => deleteDashboardAccessUser(document, userId));
    return sendJson(response, 200, {
      ok: true,
      user: result.user,
      deleted: true,
      meta: result.meta,
    });
  }
  if (request.method === "POST") {
    const viewer = requireString(body.viewer, "viewer");
    const result = await persistAccessMutation((document) => createDashboardAccessUser(document, {
      viewer,
      visibility: body.visibility,
    }, {
      reservedViewers: dashboardEnvironmentAccessUsers(process.env, document).map((user) => user.viewer),
    }));
    return sendJson(response, 201, {
      ok: true,
      user: result.user,
      token: result.token,
      token_notice: "Copy this token now. It will not be shown again.",
      meta: result.meta,
    });
  }
  if (request.method === "PATCH") {
    const userId = requireString(body.user_id, "user_id");
    const patch = {};
    for (const field of ["viewer", "enabled", "visibility"]) {
      if (Object.hasOwn(body, field)) patch[field] = body[field];
    }
    if (!Object.keys(patch).length) throw new Error("Missing access user update fields");
    if (userId.startsWith("env_")) {
      const { document } = await loadDashboardAccessControl();
      const envUser = dashboardEnvironmentAccessUsers(process.env, document)
        .find((candidate) => candidate.user_id === userId);
      if (!envUser) throw new Error(`Access user not found: ${userId}`);
      if (envUser.role === "admin") throw new Error("The administrator bootstrap credential cannot be scoped here");
      const result = await persistAccessMutation((accessDocument) => (
        updateDashboardEnvironmentOverride(accessDocument, envUser.viewer, {
          enabled: Object.hasOwn(patch, "enabled") ? patch.enabled : envUser.enabled,
          visibility: Object.hasOwn(patch, "visibility") ? patch.visibility : envUser.visibility,
        })
      ));
      const updatedUser = dashboardEnvironmentAccessUsers(process.env, result.document)
        .find((candidate) => candidate.user_id === userId);
      return sendJson(response, 200, { ok: true, user: updatedUser, meta: result.meta });
    }
    const result = await persistAccessMutation((document) => updateDashboardAccessUser(document, userId, patch, {
      reservedViewers: dashboardEnvironmentAccessUsers(process.env, document).map((user) => user.viewer),
    }));
    return sendJson(response, 200, { ok: true, user: result.user, meta: result.meta });
  }

  const userId = requireString(body.user_id, "user_id");
  if (userId.startsWith("env_")) {
    const { document } = await loadDashboardAccessControl();
    const envUser = dashboardEnvironmentAccessUsers(process.env, document)
      .find((candidate) => candidate.user_id === userId);
    if (!envUser) throw new Error(`Access user not found: ${userId}`);
    if (envUser.role === "admin") throw new Error("The administrator bootstrap credential cannot be revoked here");
    const result = await persistAccessMutation((accessDocument) => (
      updateDashboardEnvironmentOverride(accessDocument, envUser.viewer, {
        enabled: false,
        visibility: envUser.visibility,
      })
    ));
    const updatedUser = dashboardEnvironmentAccessUsers(process.env, result.document)
      .find((candidate) => candidate.user_id === userId);
    return sendJson(response, 200, {
      ok: true,
      user: updatedUser,
      revoked: true,
      meta: result.meta,
    });
  }
  const result = await persistAccessMutation((document) => updateDashboardAccessUser(document, userId, { enabled: false }));
  return sendJson(response, 200, {
    ok: true,
    user: result.user,
    revoked: true,
    meta: result.meta,
  });
}
