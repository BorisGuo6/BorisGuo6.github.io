import assert from "node:assert/strict";
import {
  allowedDashboardProjectIds,
  createDashboardAccessUser,
  emptyDashboardAccessControl,
  filterDashboardSnapshotForAuth,
  listDashboardAccessUsers,
  loadDashboardAccessControl,
  rotateDashboardAccessToken,
  updateDashboardAccessUser,
  verifyDashboardAccessToken,
  writeDashboardAccessControl,
} from "../scripts/dashboard-access-control.mjs";
import {
  createDashboardSession,
  dashboardRequestAuth,
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
assert.equal(dynamicAuth.permissions.can_write, false);
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
  blobApi: {
    async put(pathname, body, options) {
      privateBlobWrites.push({ pathname, body, options });
      return { pathname, etag: '"access-etag"' };
    },
  },
});
assert.equal(privateBlobWrites[0].options.access, "private");
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
