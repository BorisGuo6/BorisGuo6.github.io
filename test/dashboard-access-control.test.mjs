import assert from "node:assert/strict";
import {
  allowedDashboardProjectIds,
  applyDashboardEnvironmentOverride,
  assertDashboardProjectWriteScope,
  assertDashboardTaskWriteScope,
  createDashboardAccessUser,
  dashboardEnvironmentOverrideForViewer,
  defaultDashboardVisibility,
  deleteDashboardAccessUser,
  emptyDashboardAccessControl,
  filterDashboardSnapshotForAuth,
  listDashboardAccessUsers,
  loadDashboardAccessControl,
  rotateDashboardAccessToken,
  updateDashboardEnvironmentOverride,
  updateDashboardAccessUser,
  verifyDashboardAccessToken,
  writeDashboardAccessControl,
} from "../scripts/dashboard-access-control.mjs";
import {
  createDashboardSession,
  dashboardEnvironmentAccessUsers,
  dashboardEnvironmentTokenForAdminCopy,
  dashboardRequestAuth,
  sendJson,
} from "../scripts/dashboard-vercel-api.mjs";

function deterministicRandom(start = 0) {
  let call = start;
  return (length) => {
    call += 1;
    return Buffer.alloc(length, call);
  };
}

const baseSnapshot = {
  schema_version: "dashboard-state.v1",
  source: "test",
  updated_at: "2026-07-18T00:00:00.000Z",
  portfolio: {
    schema_version: "portfolio.v1",
    portfolio_id: "test-dashboard",
    title: "Test dashboard",
    summary: { focus: "private overview", progress: "", blockers: "", next: "" },
    storyline: { summary: "private storyline", flows: [{ title: "Hidden context" }] },
    visual_references: [{ src: "dashboard/assets/private.png" }],
    weekly_briefs: [{ title: "Private brief" }],
    rules: ["Private rule"],
    project_buckets: [
      { bucket: "research", label: "Research" },
      { bucket: "engineering", label: "Engineering" },
      { bucket: "survey", label: "Survey" },
    ],
    projects: [
      { project_id: "research-a", title: "Research A", bucket: "research" },
      { project_id: "research-b", title: "Research B", bucket: "research" },
      { project_id: "engineering-a", title: "Engineering A", bucket: "engineering" },
      { project_id: "survey-a", title: "Survey A", bucket: "survey" },
    ],
  },
  projects: [
    { project_id: "research-a", title: "Research A", bucket: "research", task_ids: ["task-ra"] },
    { project_id: "research-b", title: "Research B", bucket: "research", task_ids: ["task-rb"] },
    { project_id: "engineering-a", title: "Engineering A", bucket: "engineering", task_ids: ["task-ea"] },
    { project_id: "survey-a", title: "Survey A", bucket: "survey", task_ids: ["task-sa"] },
  ],
  taskDoc: {
    schema_version: "tasks.v1",
    tasks: [
      { task_id: "task-ra", project_id: "research-a", title: "RA", status: "todo", priority: "medium", comments: [] },
      { task_id: "task-rb", project_id: "research-b", title: "RB", status: "todo", priority: "medium", comments: [] },
      { task_id: "task-ea", project_id: "engineering-a", title: "EA", status: "todo", priority: "medium", comments: [] },
      { task_id: "task-sa", project_id: "survey-a", title: "SA", status: "todo", priority: "medium", comments: [] },
    ],
  },
  audit_log: [{ audit_id: "private-audit" }],
};

const now = new Date("2026-07-18T08:00:00.000Z");
const responseHeaders = new Map();
const responseProbe = {
  setHeader(name, value) { responseHeaders.set(name.toLocaleLowerCase("en-US"), value); },
  status(value) { this.statusCode = value; return this; },
  json(value) { this.body = value; return value; },
};
sendJson(responseProbe, 200, { ok: true });
assert.equal(responseHeaders.get("cache-control"), "no-store");
assert.equal(responseProbe.statusCode, 200);
const created = createDashboardAccessUser(emptyDashboardAccessControl({ now }), {
  viewer: "Ada Lovelace",
}, {
  now,
  randomBytes: deterministicRandom(),
});

assert.match(created.token, /^dash_[a-f0-9]{24}_[A-Za-z0-9_-]{32,}$/);
assert.equal(JSON.stringify(created.document).includes(created.token), false, "access registry must not persist plaintext tokens");
assert.equal(verifyDashboardAccessToken(created.document, created.token)?.viewer, "Ada Lovelace");
assert.equal(verifyDashboardAccessToken(created.document, `${created.token}x`), null);
const publicUsers = listDashboardAccessUsers(created.document);
assert.equal(publicUsers.length, 1);
assert.equal(Object.hasOwn(publicUsers[0], "token_hash"), false);
assert.equal(Object.hasOwn(publicUsers[0], "token_salt"), false);
assert.deepEqual(publicUsers[0].visibility, {
  bucket_ids: ["research"],
  include_project_ids: [],
  exclude_project_ids: [],
});
const deletedAccessUser = deleteDashboardAccessUser(created.document, created.user.user_id, {
  now: new Date("2026-07-18T08:01:00.000Z"),
});
assert.equal(deletedAccessUser.document.users.length, 0);
assert.equal(deletedAccessUser.user.viewer, "Ada Lovelace");
assert.equal(verifyDashboardAccessToken(deletedAccessUser.document, created.token), null);
assert.throws(
  () => deleteDashboardAccessUser(deletedAccessUser.document, created.user.user_id, { now }),
  /Access user not found/,
);
assert.throws(
  () => createDashboardAccessUser(created.document, { viewer: "Yanxiang" }, {
    now,
    randomBytes: deterministicRandom(),
    reservedViewers: ["YANXIANG"],
  }),
  /Access user already exists: Yanxiang/,
);
assert.throws(
  () => updateDashboardAccessUser(created.document, created.user.user_id, { viewer: "Yanxiang" }, {
    now,
    reservedViewers: ["yanxiang"],
  }),
  /Access user already exists: Yanxiang/,
);
assert.doesNotThrow(() => updateDashboardAccessUser(created.document, created.user.user_id, {
  visibility: defaultDashboardVisibility,
}, {
  now,
  reservedViewers: ["Ada Lovelace"],
}));

const environmentOverride = updateDashboardEnvironmentOverride(created.document, "Ziyang", {
  visibility: {
    bucket_ids: ["engineering"],
    include_project_ids: ["survey-a"],
    exclude_project_ids: [],
  },
}, { now: new Date("2026-07-18T08:05:00.000Z") });
assert.deepEqual(dashboardEnvironmentOverrideForViewer(environmentOverride.document, "ziyang")?.visibility, {
  bucket_ids: ["engineering"],
  include_project_ids: ["survey-a"],
  exclude_project_ids: [],
});
assert.deepEqual(applyDashboardEnvironmentOverride(environmentOverride.document, {
  viewer: "ziyang",
  role: "viewer",
  source: "environment",
  visibility: { bucket_ids: ["research"], include_project_ids: [], exclude_project_ids: [] },
})?.visibility, {
  bucket_ids: ["engineering"],
  include_project_ids: ["survey-a"],
  exclude_project_ids: [],
});
const disabledEnvironmentOverride = updateDashboardEnvironmentOverride(environmentOverride.document, "Ziyang", {
  enabled: false,
}, { now: new Date("2026-07-18T08:06:00.000Z") });
assert.equal(applyDashboardEnvironmentOverride(disabledEnvironmentOverride.document, {
  viewer: "ziyang",
  role: "viewer",
  source: "environment",
}), null);
assert.throws(
  () => updateDashboardEnvironmentOverride(created.document, "jingxiang", { enabled: false }, { now }),
  /administrator identity is reserved/,
);

assert.deepEqual(
  [...allowedDashboardProjectIds(baseSnapshot, { role: "viewer", visibility: publicUsers[0].visibility })],
  ["research-a", "research-b"],
);
const customized = updateDashboardAccessUser(created.document, created.user.user_id, {
  visibility: {
    bucket_ids: ["research"],
    include_project_ids: ["engineering-a", "missing-project"],
    exclude_project_ids: ["research-b"],
  },
}, { now: new Date("2026-07-18T08:10:00.000Z") });
const customAuth = { role: "viewer", visibility: customized.user.visibility };
assert.deepEqual([...allowedDashboardProjectIds(baseSnapshot, customAuth)], ["research-a", "engineering-a"]);
assert.doesNotThrow(() => assertDashboardProjectWriteScope(baseSnapshot, customAuth, "research-a"));
assert.doesNotThrow(() => assertDashboardProjectWriteScope(baseSnapshot, customAuth, "engineering-a"));
assert.throws(
  () => assertDashboardProjectWriteScope(baseSnapshot, customAuth, "research-b"),
  /outside the viewer's visible scope/,
);
assert.doesNotThrow(() => assertDashboardTaskWriteScope(baseSnapshot, customAuth, "task-ra"));
assert.doesNotThrow(() => assertDashboardTaskWriteScope(baseSnapshot, customAuth, "task-ea"));
assert.throws(
  () => assertDashboardTaskWriteScope(baseSnapshot, customAuth, "task-rb"),
  /outside the viewer's visible scope/,
);
assert.doesNotThrow(() => assertDashboardTaskWriteScope(baseSnapshot, customAuth, "missing-task"));
assert.doesNotThrow(() => assertDashboardProjectWriteScope(baseSnapshot, { role: "admin" }, "missing-project"));
const filtered = filterDashboardSnapshotForAuth(baseSnapshot, customAuth);
assert.deepEqual(filtered.portfolio.projects.map((project) => project.project_id), ["research-a", "engineering-a"]);
assert.deepEqual(filtered.projects.map((project) => project.project_id), ["research-a", "engineering-a"]);
assert.deepEqual(filtered.taskDoc.tasks.map((task) => task.task_id), ["task-ra", "task-ea"]);
assert.deepEqual(filtered.portfolio.project_buckets.map((bucket) => bucket.bucket), ["research", "engineering"]);
assert.equal(filtered.portfolio.storyline.flows.length, 0);
assert.equal(filtered.portfolio.visual_references.length, 0);
assert.equal(filtered.audit_log.length, 0);

const rotated = rotateDashboardAccessToken(customized.document, created.user.user_id, {
  now: new Date("2026-07-18T08:20:00.000Z"),
  randomBytes: deterministicRandom(10),
});
assert.equal(verifyDashboardAccessToken(rotated.document, created.token), null);
assert.equal(verifyDashboardAccessToken(rotated.document, rotated.token)?.viewer, "Ada Lovelace");
assert.equal(rotated.user.session_version, created.user.session_version + 1);

const authEnv = {
  BLOB_READ_WRITE_TOKEN: "blob",
  DASHBOARD_SESSION_SECRET: "independent-session-secret",
};
const dynamicAuth = await dashboardRequestAuth({
  headers: { "x-dashboard-token": rotated.token },
}, authEnv, {
  loadAccess: async () => ({ document: rotated.document }),
});
assert.equal(dynamicAuth.ok, true);
assert.equal(dynamicAuth.role, "viewer");
assert.equal(dynamicAuth.permissions.can_write, true);
assert.equal(dynamicAuth.permissions.can_manage_access, false);
const dynamicSession = createDashboardSession(dynamicAuth, authEnv, {
  now: new Date("2099-07-18T00:00:00.000Z"),
  maxAgeSeconds: 60,
});
const sessionRequest = {
  headers: { cookie: `dashboard_session=${encodeURIComponent(dynamicSession)}` },
};
assert.equal((await dashboardRequestAuth(sessionRequest, authEnv, {
  now: new Date("2099-07-18T00:00:30.000Z"),
  loadAccess: async () => ({ document: rotated.document }),
})).ok, true);
const envMappedAuthEnv = {
  ...authEnv,
  DASHBOARD_WRITE_TOKEN_USERS: JSON.stringify({ "mapped-token": "Agent A" }),
};
const envOverride = updateDashboardEnvironmentOverride(rotated.document, "Agent A", {
  visibility: {
    bucket_ids: ["engineering"],
    include_project_ids: [],
    exclude_project_ids: [],
  },
}, { now: new Date("2026-07-18T08:25:00.000Z") });
const environmentUsers = dashboardEnvironmentAccessUsers(envMappedAuthEnv, envOverride.document);
const copyableEnvironmentUser = environmentUsers.find((user) => user.viewer === "Agent A");
assert.ok(copyableEnvironmentUser);
assert.equal(copyableEnvironmentUser.token_copy_mode, "environment-copyable");
assert.equal(JSON.stringify(copyableEnvironmentUser).includes("mapped-token"), false);
const copiedEnvironmentCredential = dashboardEnvironmentTokenForAdminCopy(
  copyableEnvironmentUser.user_id,
  envMappedAuthEnv,
  envOverride.document,
);
assert.equal(copiedEnvironmentCredential.token, "mapped-token");
assert.equal(copiedEnvironmentCredential.user.viewer, "Agent A");
const ambiguousEnvironment = {
  ...envMappedAuthEnv,
  DASHBOARD_WRITE_TOKEN_AGENT_A: "second-mapped-token",
};
assert.equal(
  dashboardEnvironmentAccessUsers(ambiguousEnvironment, envOverride.document)
    .find((user) => user.viewer === "Agent A")?.token_copy_mode,
  "environment-ambiguous",
);
assert.throws(
  () => dashboardEnvironmentTokenForAdminCopy(
    copyableEnvironmentUser.user_id,
    ambiguousEnvironment,
    envOverride.document,
  ),
  /ambiguous environment credential/,
);
const crossViewerAliasEnvironment = {
  ...envMappedAuthEnv,
  DASHBOARD_WRITE_TOKEN_AGENT_B: "mapped-token",
};
const aliasedEnvironmentUsers = dashboardEnvironmentAccessUsers(
  crossViewerAliasEnvironment,
  envOverride.document,
);
assert.equal(
  aliasedEnvironmentUsers.find((user) => user.viewer === "Agent A")?.token_copy_mode,
  "environment-ambiguous",
);
assert.equal(
  aliasedEnvironmentUsers.find((user) => user.viewer === "agent b")?.token_copy_mode,
  "environment-ambiguous",
);
assert.throws(
  () => dashboardEnvironmentTokenForAdminCopy(
    aliasedEnvironmentUsers.find((user) => user.viewer === "Agent A")?.user_id,
    crossViewerAliasEnvironment,
    envOverride.document,
  ),
  /ambiguous environment credential/,
);
const environmentWithAdmin = {
  ...envMappedAuthEnv,
  DASHBOARD_WRITE_TOKEN: "administrator-token",
};
const environmentAdmin = dashboardEnvironmentAccessUsers(environmentWithAdmin, envOverride.document)
  .find((user) => user.role === "admin");
assert.ok(environmentAdmin);
assert.throws(
  () => dashboardEnvironmentTokenForAdminCopy(
    environmentAdmin.user_id,
    environmentWithAdmin,
    envOverride.document,
  ),
  /Invalid access token copy target/,
);
const adminAliasEnvironment = {
  ...envMappedAuthEnv,
  DASHBOARD_WRITE_TOKEN: "mapped-token",
};
const adminAliasedViewer = dashboardEnvironmentAccessUsers(adminAliasEnvironment, envOverride.document)
  .find((user) => user.viewer === "Agent A");
assert.equal(adminAliasedViewer?.token_copy_mode, "environment-ambiguous");
assert.throws(
  () => dashboardEnvironmentTokenForAdminCopy(
    adminAliasedViewer.user_id,
    adminAliasEnvironment,
    envOverride.document,
  ),
  /ambiguous environment credential/,
);
const environmentAuth = await dashboardRequestAuth({
  headers: { "x-dashboard-token": "mapped-token" },
}, envMappedAuthEnv, {
  loadAccess: async () => ({ document: envOverride.document }),
});
assert.equal(environmentAuth.ok, true);
assert.equal(environmentAuth.source, "environment");
assert.deepEqual(environmentAuth.visibility, {
  bucket_ids: ["engineering"],
  include_project_ids: [],
  exclude_project_ids: [],
});
const environmentSession = createDashboardSession(environmentAuth, envMappedAuthEnv, {
  now: new Date("2099-07-18T00:00:00.000Z"),
  maxAgeSeconds: 60,
});
const environmentSessionRequest = {
  headers: { cookie: `dashboard_session=${encodeURIComponent(environmentSession)}` },
};
assert.deepEqual((await dashboardRequestAuth(environmentSessionRequest, envMappedAuthEnv, {
  now: new Date("2099-07-18T00:00:30.000Z"),
  loadAccess: async () => ({ document: envOverride.document }),
})).visibility, {
  bucket_ids: ["engineering"],
  include_project_ids: [],
  exclude_project_ids: [],
});
const disabledEnvOverride = updateDashboardEnvironmentOverride(envOverride.document, "Agent A", {
  enabled: false,
}, { now: new Date("2026-07-18T08:26:00.000Z") });
assert.throws(
  () => dashboardEnvironmentTokenForAdminCopy(
    copyableEnvironmentUser.user_id,
    envMappedAuthEnv,
    disabledEnvOverride.document,
  ),
  /Invalid access token copy target/,
);
assert.deepEqual(await dashboardRequestAuth(environmentSessionRequest, envMappedAuthEnv, {
  now: new Date("2099-07-18T00:00:30.000Z"),
  loadAccess: async () => ({ document: disabledEnvOverride.document }),
}), {
  ok: false,
  status: 401,
  error: "Dashboard access has been revoked",
});
const rotatedAgain = rotateDashboardAccessToken(rotated.document, created.user.user_id, {
  now: new Date("2026-07-18T08:30:00.000Z"),
  randomBytes: deterministicRandom(20),
});
assert.deepEqual(await dashboardRequestAuth(sessionRequest, authEnv, {
  now: new Date("2099-07-18T00:00:30.000Z"),
  loadAccess: async () => ({ document: rotatedAgain.document }),
}), {
  ok: false,
  status: 401,
  error: "Dashboard access has been revoked",
});

const privateBlobWrites = [];
await writeDashboardAccessControl(rotated.document, {
  env: { BLOB_READ_WRITE_TOKEN: "blob" },
  ifMatch: 'W/"access-etag"',
  blobApi: {
    async put(pathname, body, options) {
      privateBlobWrites.push({ pathname, body, options });
      return { pathname, etag: '"access-etag"' };
    },
  },
});
assert.equal(privateBlobWrites[0].options.access, "private");
assert.equal(privateBlobWrites[0].options.ifMatch, '"access-etag"');
assert.equal(privateBlobWrites[0].body.includes(rotated.token), false);
const loaded = await loadDashboardAccessControl({
  env: { BLOB_READ_WRITE_TOKEN: "blob" },
  blobApi: {
    async get() {
      return {
        stream: new Response(JSON.stringify(rotated.document)).body,
        blob: { pathname: "dashboard-access/access-control.json", etag: '"access-etag"' },
      };
    },
  },
});
assert.equal(loaded.document.users[0].viewer, "Ada Lovelace");
assert.equal(loaded.meta.storage, "vercel-blob-private");

assert.throws(
  () => createDashboardAccessUser(created.document, { viewer: "Jingxiang" }, {
    now,
    randomBytes: deterministicRandom(),
  }),
  /administrator identity is reserved/,
);

console.log("dashboard access-control tests passed");
