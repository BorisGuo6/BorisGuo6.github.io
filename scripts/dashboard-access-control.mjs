import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export const dashboardAccessSchemaVersion = "dashboard-access.v1";
export const defaultDashboardAccessBlobPath = "dashboard-access/access-control.json";
export const defaultDashboardVisibility = Object.freeze({
  bucket_ids: ["research"],
  include_project_ids: [],
  exclude_project_ids: [],
});

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizedViewerKey(value) {
  return optionalString(value).toLocaleLowerCase("en-US");
}

function requireViewerName(value) {
  const viewer = optionalString(value);
  if (!viewer) throw new Error("Missing viewer");
  if (viewer.length > 80) throw new Error("Invalid viewer: maximum length is 80 characters");
  if (/\p{C}/u.test(viewer)) throw new Error("Invalid viewer: control characters are not allowed");
  return viewer;
}

function requireUserId(value) {
  const userId = optionalString(value);
  if (!/^user_[a-z0-9][a-z0-9_-]{5,80}$/.test(userId)) {
    throw new Error("Invalid user_id");
  }
  return userId;
}

function normalizeProjectIds(values) {
  if (!Array.isArray(values)) return [];
  const projectIds = [...new Set(values.map(optionalString).filter(Boolean))];
  if (projectIds.length > 200) throw new Error("Invalid visibility: too many project_ids");
  if (projectIds.some((projectId) => projectId.length > 160 || !/^[a-z0-9][a-z0-9_-]*$/i.test(projectId))) {
    throw new Error("Invalid visibility project_id");
  }
  return projectIds;
}

export function normalizeDashboardVisibility(value = defaultDashboardVisibility) {
  const legacyMode = optionalString(value?.mode);
  const bucketIds = legacyMode === "custom"
    ? []
    : [...new Set((Array.isArray(value?.bucket_ids) ? value.bucket_ids : ["research"])
      .map(optionalString)
      .filter(Boolean))];
  if (bucketIds.some((bucketId) => !new Set(["research", "engineering", "survey", "archive"]).has(bucketId))) {
    throw new Error("Invalid visibility bucket_id");
  }
  return {
    bucket_ids: bucketIds,
    include_project_ids: normalizeProjectIds(value?.include_project_ids || value?.project_ids),
    exclude_project_ids: normalizeProjectIds(value?.exclude_project_ids),
  };
}

export function emptyDashboardAccessControl(options = {}) {
  return {
    schema_version: dashboardAccessSchemaVersion,
    updated_at: (options.now || new Date()).toISOString(),
    users: [],
  };
}

export function normalizeDashboardAccessControl(raw, options = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw
    : emptyDashboardAccessControl(options);
  const users = Array.isArray(source.users) ? source.users.map((user) => {
    const userId = requireUserId(user?.user_id);
    const viewer = requireViewerName(user?.viewer);
    const tokenId = optionalString(user?.token_id);
    const tokenSalt = optionalString(user?.token_salt);
    const tokenHash = optionalString(user?.token_hash);
    if (!/^[a-f0-9]{16,64}$/.test(tokenId) || !tokenSalt || !tokenHash) {
      throw new Error(`Invalid token record for ${userId}`);
    }
    return {
      user_id: userId,
      viewer,
      role: "viewer",
      enabled: user?.enabled !== false,
      session_version: Number.isSafeInteger(user?.session_version) && user.session_version > 0
        ? user.session_version
        : 1,
      visibility: normalizeDashboardVisibility(user?.visibility),
      token_id: tokenId,
      token_salt: tokenSalt,
      token_hash: tokenHash,
      token_fingerprint: optionalString(user?.token_fingerprint) || "sha256:unknown",
      token_hint: optionalString(user?.token_hint) || `dash_${tokenId.slice(0, 6)}...`,
      created_at: optionalString(user?.created_at) || optionalString(source.updated_at) || new Date(0).toISOString(),
      updated_at: optionalString(user?.updated_at) || optionalString(source.updated_at) || new Date(0).toISOString(),
      rotated_at: optionalString(user?.rotated_at) || null,
    };
  }) : [];
  const ids = new Set();
  const viewers = new Set();
  for (const user of users) {
    const viewerKey = normalizedViewerKey(user.viewer);
    if (ids.has(user.user_id)) throw new Error(`Duplicate access user_id: ${user.user_id}`);
    if (viewers.has(viewerKey)) throw new Error(`Duplicate access viewer: ${user.viewer}`);
    ids.add(user.user_id);
    viewers.add(viewerKey);
  }
  return {
    schema_version: dashboardAccessSchemaVersion,
    updated_at: optionalString(source.updated_at) || (options.now || new Date()).toISOString(),
    users,
  };
}

function tokenFingerprint(token) {
  return `sha256:${createHash("sha256").update(token).digest("hex").slice(0, 16)}`;
}

function tokenHash(token, salt) {
  return scryptSync(token, salt, 32).toString("base64url");
}

function makeTokenMaterial(options = {}) {
  const random = options.randomBytes || randomBytes;
  const tokenId = random(12).toString("hex");
  const secret = random(32).toString("base64url");
  const token = `dash_${tokenId}_${secret}`;
  const salt = random(16).toString("base64url");
  return {
    token,
    token_id: tokenId,
    token_salt: salt,
    token_hash: tokenHash(token, salt),
    token_fingerprint: tokenFingerprint(token),
    token_hint: `dash_${tokenId.slice(0, 6)}...`,
  };
}

function userIdFor(viewer, options = {}) {
  const slug = viewer
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "viewer";
  const random = options.randomBytes || randomBytes;
  return `user_${slug}_${random(5).toString("hex")}`;
}

function publicAccessUser(user) {
  return {
    user_id: user.user_id,
    viewer: user.viewer,
    role: "viewer",
    enabled: user.enabled !== false,
    session_version: user.session_version,
    visibility: cloneJson(user.visibility),
    token_fingerprint: user.token_fingerprint,
    token_hint: user.token_hint,
    created_at: user.created_at,
    updated_at: user.updated_at,
    rotated_at: user.rotated_at,
    managed_by: "dashboard",
    editable: true,
  };
}

export function listDashboardAccessUsers(document) {
  return normalizeDashboardAccessControl(document).users.map(publicAccessUser);
}

export function createDashboardAccessUser(document, input, options = {}) {
  const now = options.now || new Date();
  const normalized = normalizeDashboardAccessControl(document, { now });
  const viewer = requireViewerName(input?.viewer);
  if (normalizedViewerKey(viewer) === normalizedViewerKey(options.adminViewer || "jingxiang")) {
    throw new Error("Invalid viewer: the administrator identity is reserved");
  }
  if (normalized.users.some((user) => normalizedViewerKey(user.viewer) === normalizedViewerKey(viewer))) {
    throw new Error(`Access user already exists: ${viewer}`);
  }
  const material = makeTokenMaterial(options);
  const { token, ...storedMaterial } = material;
  const createdAt = now.toISOString();
  const user = {
    user_id: userIdFor(viewer, options),
    viewer,
    role: "viewer",
    enabled: true,
    session_version: 1,
    visibility: normalizeDashboardVisibility(input?.visibility),
    ...storedMaterial,
    created_at: createdAt,
    updated_at: createdAt,
    rotated_at: createdAt,
  };
  const next = {
    ...normalized,
    updated_at: createdAt,
    users: [...normalized.users, user],
  };
  return {
    document: next,
    user: publicAccessUser(user),
    token,
  };
}

export function updateDashboardAccessUser(document, userId, patch, options = {}) {
  const now = options.now || new Date();
  const normalized = normalizeDashboardAccessControl(document, { now });
  const targetId = requireUserId(userId);
  const index = normalized.users.findIndex((user) => user.user_id === targetId);
  if (index < 0) throw new Error(`Access user not found: ${targetId}`);
  const current = normalized.users[index];
  const viewer = Object.hasOwn(patch || {}, "viewer") ? requireViewerName(patch.viewer) : current.viewer;
  if (normalizedViewerKey(viewer) === normalizedViewerKey(options.adminViewer || "jingxiang")) {
    throw new Error("Invalid viewer: the administrator identity is reserved");
  }
  if (normalized.users.some((user, candidateIndex) => (
    candidateIndex !== index && normalizedViewerKey(user.viewer) === normalizedViewerKey(viewer)
  ))) {
    throw new Error(`Access user already exists: ${viewer}`);
  }
  const updated = {
    ...current,
    viewer,
    enabled: Object.hasOwn(patch || {}, "enabled") ? patch.enabled === true : current.enabled,
    session_version: Object.hasOwn(patch || {}, "enabled") && (patch.enabled === true) !== current.enabled
      ? current.session_version + 1
      : current.session_version,
    visibility: Object.hasOwn(patch || {}, "visibility")
      ? normalizeDashboardVisibility(patch.visibility)
      : current.visibility,
    updated_at: now.toISOString(),
  };
  const users = [...normalized.users];
  users[index] = updated;
  return {
    document: { ...normalized, updated_at: now.toISOString(), users },
    user: publicAccessUser(updated),
  };
}

export function rotateDashboardAccessToken(document, userId, options = {}) {
  const now = options.now || new Date();
  const normalized = normalizeDashboardAccessControl(document, { now });
  const targetId = requireUserId(userId);
  const index = normalized.users.findIndex((user) => user.user_id === targetId);
  if (index < 0) throw new Error(`Access user not found: ${targetId}`);
  const material = makeTokenMaterial(options);
  const { token, ...storedMaterial } = material;
  const updated = {
    ...normalized.users[index],
    ...storedMaterial,
    enabled: true,
    session_version: normalized.users[index].session_version + 1,
    updated_at: now.toISOString(),
    rotated_at: now.toISOString(),
  };
  const users = [...normalized.users];
  users[index] = updated;
  return {
    document: { ...normalized, updated_at: now.toISOString(), users },
    user: publicAccessUser(updated),
    token,
  };
}

export function verifyDashboardAccessToken(document, providedToken) {
  const token = optionalString(providedToken);
  const match = /^dash_([a-f0-9]{24})_([A-Za-z0-9_-]{32,})$/.exec(token);
  if (!match) return null;
  const normalized = normalizeDashboardAccessControl(document);
  const user = normalized.users.find((candidate) => candidate.token_id === match[1]);
  if (!user || user.enabled === false) return null;
  const actual = Buffer.from(tokenHash(token, user.token_salt));
  const expected = Buffer.from(user.token_hash);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return publicAccessUser(user);
}

export function dashboardProjectOptions(snapshot) {
  const projectsById = new Map((Array.isArray(snapshot?.projects) ? snapshot.projects : [])
    .map((project) => [project?.project_id, project]));
  return (Array.isArray(snapshot?.portfolio?.projects) ? snapshot.portfolio.projects : [])
    .map((reference) => ({
      project_id: optionalString(reference?.project_id),
      title: optionalString(reference?.title) || optionalString(projectsById.get(reference?.project_id)?.title) || optionalString(reference?.project_id),
      bucket: optionalString(reference?.bucket) || optionalString(projectsById.get(reference?.project_id)?.bucket) || "research",
    }))
    .filter((project) => project.project_id);
}

export function allowedDashboardProjectIds(snapshot, auth) {
  const options = dashboardProjectOptions(snapshot);
  if (auth?.role === "admin") return new Set(options.map((project) => project.project_id));
  const visibility = normalizeDashboardVisibility(auth?.visibility);
  const knownIds = new Set(options.map((project) => project.project_id));
  const excludedIds = new Set(visibility.exclude_project_ids);
  return new Set(options
    .filter((project) => (
      visibility.bucket_ids.includes(project.bucket)
      || visibility.include_project_ids.includes(project.project_id)
    ))
    .map((project) => project.project_id)
    .filter((projectId) => knownIds.has(projectId) && !excludedIds.has(projectId)));
}

export function filterDashboardSnapshotForAuth(snapshot, auth) {
  if (auth?.role === "admin") return cloneJson(snapshot);
  const allowedIds = allowedDashboardProjectIds(snapshot, auth);
  const portfolio = cloneJson(snapshot.portfolio);
  portfolio.projects = (Array.isArray(portfolio.projects) ? portfolio.projects : [])
    .filter((project) => allowedIds.has(project?.project_id));
  const visibleBuckets = new Set(portfolio.projects.map((project) => project.bucket));
  portfolio.project_buckets = (Array.isArray(portfolio.project_buckets) ? portfolio.project_buckets : [])
    .filter((bucket) => visibleBuckets.has(bucket?.bucket));
  portfolio.summary = { focus: "", progress: "", blockers: "", next: "" };
  portfolio.storyline = { summary: "", flows: [] };
  portfolio.visual_references = [];
  portfolio.weekly_briefs = [];
  portfolio.rules = [];
  const projects = (Array.isArray(snapshot.projects) ? snapshot.projects : [])
    .filter((project) => allowedIds.has(project?.project_id))
    .map((project) => cloneJson(project));
  const taskDoc = cloneJson(snapshot.taskDoc);
  taskDoc.tasks = (Array.isArray(taskDoc.tasks) ? taskDoc.tasks : [])
    .filter((task) => allowedIds.has(task?.project_id));
  const allowedTaskIds = new Set(taskDoc.tasks.map((task) => task.task_id));
  projects.forEach((project) => {
    if (Array.isArray(project.task_ids)) {
      project.task_ids = project.task_ids.filter((taskId) => allowedTaskIds.has(taskId));
    }
  });
  return {
    ...cloneJson(snapshot),
    portfolio,
    projects,
    taskDoc,
    audit_log: [],
  };
}

function dashboardAccessBlobPath(env = process.env) {
  return optionalString(env.DASHBOARD_ACCESS_BLOB_PATH) || defaultDashboardAccessBlobPath;
}

async function blobClient() {
  return import("@vercel/blob");
}

export async function loadDashboardAccessControl(options = {}) {
  const env = options.env || process.env;
  const token = optionalString(env.BLOB_READ_WRITE_TOKEN);
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  const pathname = options.pathname || dashboardAccessBlobPath(env);
  const blobApi = options.blobApi || await blobClient();
  const result = await blobApi.get(pathname, {
    access: "private",
    useCache: false,
    token,
  });
  if (!result) {
    return {
      document: emptyDashboardAccessControl(options),
      meta: { storage: "vercel-blob-private", pathname, etag: null },
    };
  }
  const text = await new Response(result.stream).text();
  return {
    document: normalizeDashboardAccessControl(JSON.parse(text), options),
    meta: {
      storage: "vercel-blob-private",
      pathname: result.blob.pathname,
      etag: result.blob.etag,
    },
  };
}

export async function writeDashboardAccessControl(document, options = {}) {
  const env = options.env || process.env;
  const token = optionalString(env.BLOB_READ_WRITE_TOKEN);
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  const pathname = options.pathname || dashboardAccessBlobPath(env);
  const blobApi = options.blobApi || await blobClient();
  const normalized = normalizeDashboardAccessControl(document, options);
  return blobApi.put(pathname, `${JSON.stringify(normalized, null, 2)}\n`, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: options.ifMatch ? true : options.allowOverwrite === true,
    cacheControlMaxAge: 60,
    contentType: "application/json",
    ...(options.ifMatch ? { ifMatch: options.ifMatch } : {}),
    token,
  });
}
