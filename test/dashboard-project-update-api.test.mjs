import assert from "node:assert/strict";
import {
  handleDashboardPortfolioUpdate,
  handleDashboardProjectCreate,
  handleDashboardProjectDelete,
  handleDashboardProjectUpdate,
  withDashboardApiErrors,
} from "../scripts/dashboard-vercel-api.mjs";

const baseSnapshot = {
  schema_version: "dashboard-state.v1",
  source: "test",
  updated_at: "2026-07-23T00:00:00.000Z",
  portfolio: {
    schema_version: "portfolio.v1",
    portfolio_id: "test-dashboard",
    title: "Test dashboard",
    project_buckets: [
      { bucket: "research", label: "Research" },
      { bucket: "engineering", label: "Engineering" },
    ],
    projects: [
      { project_id: "research-a", title: "Research A", bucket: "research", status: "ongoing" },
      { project_id: "engineering-a", title: "Engineering A", bucket: "engineering", status: "ongoing" },
    ],
  },
  projects: [
    {
      project_id: "research-a",
      title: "Research A",
      bucket: "research",
      status: "ongoing",
      summary: "Original summary",
      task_ids: [],
    },
    {
      project_id: "engineering-a",
      title: "Engineering A",
      bucket: "engineering",
      status: "ongoing",
      summary: "Hidden summary",
      task_ids: [],
    },
  ],
  taskDoc: {
    schema_version: "tasks.v1",
    tasks: [],
  },
  audit_log: [],
};

function responseProbe() {
  const headers = new Map();
  return {
    headers,
    statusCode: null,
    body: null,
    setHeader(name, value) {
      headers.set(String(name).toLocaleLowerCase("en-US"), value);
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    },
  };
}

async function invoke(request, options = {}) {
  const response = responseProbe();
  const handler = withDashboardApiErrors(
    (nextRequest, nextResponse) => handleDashboardProjectUpdate(nextRequest, nextResponse, options),
  );
  await handler({ headers: {}, ...request }, response);
  return response;
}

async function invokeCreate(request, options = {}) {
  const response = responseProbe();
  const handler = withDashboardApiErrors(
    (nextRequest, nextResponse) => handleDashboardProjectCreate(nextRequest, nextResponse, options),
  );
  await handler({ headers: {}, ...request }, response);
  return response;
}

<<<<<<< Updated upstream
async function invokePortfolio(request, options = {}) {
  const response = responseProbe();
  const handler = withDashboardApiErrors(
    (nextRequest, nextResponse) => handleDashboardPortfolioUpdate(nextRequest, nextResponse, options),
=======
async function invokeDelete(request, options = {}) {
  const response = responseProbe();
  const handler = withDashboardApiErrors(
    (nextRequest, nextResponse) => handleDashboardProjectDelete(nextRequest, nextResponse, options),
>>>>>>> Stashed changes
  );
  await handler({ headers: {}, ...request }, response);
  return response;
}

function inMemoryStore(snapshot = baseSnapshot) {
  let current = structuredClone(snapshot);
  const audits = [];
  return {
    audits,
    snapshot: () => structuredClone(current),
    async persistMutation(mutation, auditOptions) {
      const result = mutation(current);
      current = result.snapshot;
      const payload = typeof auditOptions.payload === "function"
        ? auditOptions.payload(result)
        : auditOptions.payload;
      audits.push({ action: auditOptions.action, payload });
      return {
        ...result,
        meta: { storage: "test", audit_id: `audit-${audits.length}` },
      };
    },
  };
}

function projectDeleteSnapshot() {
  const snapshot = structuredClone(baseSnapshot);
  snapshot.projects[0].task_ids = ["task-listed"];
  snapshot.projects[1].task_ids = ["task-target", "task-listed"];
  snapshot.taskDoc.tasks = [
    {
      task_id: "task-listed",
      project_id: "research-a",
      title: "Listed source task",
      status: "done",
      priority: "medium",
      comments: [],
    },
    {
      task_id: "task-unlisted",
      project_id: "research-a",
      title: "Unlisted source task",
      status: "done",
      priority: "medium",
      comments: [],
    },
    {
      task_id: "task-target",
      project_id: "engineering-a",
      title: "Existing target task",
      status: "todo",
      priority: "high",
      comments: [],
    },
  ];
  return snapshot;
}

const noToken = await invoke({
  method: "POST",
  body: {
    project_id: "research-a",
    patch: { summary: "Updated" },
  },
}, {
  env: { BLOB_READ_WRITE_TOKEN: "blob-token" },
});
assert.equal(noToken.statusCode, 401);
assert.equal(noToken.body.ok, false);
assert.match(noToken.body.error, /authentication required/i);

const scopedStore = inMemoryStore();
const outOfScope = await invoke({
  method: "POST",
  headers: { "x-dashboard-token": "viewer-token" },
  body: {
    project_id: "engineering-a",
    patch: { summary: "Must not change" },
  },
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN_USERS: JSON.stringify({ "viewer-token": "Research Viewer" }),
  },
  authOptions: {
    loadAccess: async () => {
      throw new Error("No access override in this test");
    },
  },
  persistMutation: scopedStore.persistMutation,
});
assert.equal(outOfScope.statusCode, 403);
assert.match(outOfScope.body.error, /outside the viewer's visible scope/);
assert.equal(scopedStore.snapshot().projects[1].summary, "Hidden summary");
assert.equal(scopedStore.audits.length, 0);

const validStore = inMemoryStore();
const sensitiveSummary = "Updated framing that must not be copied into the audit payload";
const valid = await invoke({
  method: "POST",
  headers: { "x-dashboard-token": "admin-token" },
  body: {
    project_id: "research-a",
    patch: {
      title: "Research A Updated",
      summary: sensitiveSummary,
      hide_intro: true,
    },
  },
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN: "admin-token",
  },
  persistMutation: validStore.persistMutation,
});
assert.equal(valid.statusCode, 200);
assert.equal(valid.body.ok, true);
assert.equal(valid.body.project.summary, sensitiveSummary);
assert.equal(valid.body.project.hide_intro, true);
assert.equal(validStore.snapshot().portfolio.projects[0].title, "Research A Updated");
assert.deepEqual(validStore.audits, [{
  action: "project-update",
  payload: {
    project_id: "research-a",
    changed_fields: ["title", "summary", "hide_intro"],
    changed_ref_fields: ["title"],
  },
}]);
assert.equal(JSON.stringify(validStore.audits).includes(sensitiveSummary), false);

const missingPatch = await invoke({
  method: "POST",
  headers: { "x-dashboard-token": "admin-token" },
  body: { project_id: "research-a" },
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN: "admin-token",
  },
  persistMutation: inMemoryStore().persistMutation,
});
assert.equal(missingPatch.statusCode, 400);
assert.match(missingPatch.body.error, /Missing project patch/);

const invalidStore = inMemoryStore();
const invalidField = await invoke({
  method: "POST",
  headers: { "x-dashboard-token": "admin-token" },
  body: {
    project_id: "research-a",
    patch: {
      summary: "Would otherwise be valid",
      private_token: "must-not-be-accepted",
    },
  },
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN: "admin-token",
  },
  persistMutation: invalidStore.persistMutation,
});
assert.equal(invalidField.statusCode, 400);
assert.match(invalidField.body.error, /Invalid project update field: private_token/);
assert.equal(invalidStore.snapshot().projects[0].summary, "Original summary");
assert.equal(invalidStore.audits.length, 0);

const nonAdminCreateStore = inMemoryStore();
const nonAdminCreate = await invokeCreate({
  method: "POST",
  headers: { "x-dashboard-token": "viewer-token" },
  body: {
    project: {
      project_id: "survey-new",
      title: "Survey New",
      bucket: "research",
      status: "survey",
    },
  },
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN_USERS: JSON.stringify({ "viewer-token": "Research Viewer" }),
  },
  authOptions: {
    loadAccess: async () => {
      throw new Error("No access override in this test");
    },
  },
  persistMutation: nonAdminCreateStore.persistMutation,
});
assert.equal(nonAdminCreate.statusCode, 403);
assert.match(nonAdminCreate.body.error, /administrator role/i);
assert.equal(nonAdminCreateStore.snapshot().projects.length, 2);

const createStore = inMemoryStore();
const sensitiveCreateSummary = "Create framing that must not appear in the audit payload";
const created = await invokeCreate({
  method: "POST",
  headers: { "x-dashboard-token": "admin-token" },
  body: {
    insert_after: "research-a",
    project: {
      project_id: "survey-new",
      title: "Survey New",
      bucket: "research",
      status: "survey",
      summary: sensitiveCreateSummary,
      task_ids: [],
    },
  },
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN: "admin-token",
  },
  persistMutation: createStore.persistMutation,
});
assert.equal(created.statusCode, 201);
assert.equal(created.body.ok, true);
assert.equal(created.body.project.project_id, "survey-new");
assert.deepEqual(
  createStore.snapshot().portfolio.projects.map((project) => project.project_id),
  ["research-a", "survey-new", "engineering-a"],
);
assert.deepEqual(createStore.audits, [{
  action: "project-create",
  payload: {
    project_id: "survey-new",
    bucket: "research",
    inserted_after: "research-a",
  },
}]);
assert.equal(JSON.stringify(createStore.audits).includes(sensitiveCreateSummary), false);

const duplicateCreate = await invokeCreate({
  method: "POST",
  headers: { "x-dashboard-token": "admin-token" },
  body: {
    project: {
      project_id: "research-a",
      title: "Duplicate",
      bucket: "research",
      status: "survey",
    },
  },
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN: "admin-token",
  },
  persistMutation: inMemoryStore().persistMutation,
});
assert.equal(duplicateCreate.statusCode, 409);
assert.match(duplicateCreate.body.error, /already exists/i);

const invalidCreateStore = inMemoryStore();
const invalidCreate = await invokeCreate({
  method: "POST",
  headers: { "x-dashboard-token": "admin-token" },
  body: {
    project: {
      project_id: "survey-new",
      title: "Survey New",
      bucket: "research",
      status: "survey",
      private_token: "must-not-be-accepted",
    },
  },
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN: "admin-token",
  },
  persistMutation: invalidCreateStore.persistMutation,
});
assert.equal(invalidCreate.statusCode, 400);
assert.match(invalidCreate.body.error, /Invalid project update field: private_token/);
assert.equal(invalidCreateStore.snapshot().projects.length, 2);
assert.equal(invalidCreateStore.audits.length, 0);

<<<<<<< Updated upstream
const nonAdminPortfolioStore = inMemoryStore();
const nonAdminPortfolio = await invokePortfolio({
  method: "POST",
  headers: { "x-dashboard-token": "viewer-token" },
  body: {
    visual_references: [{ src: "dashboard/assets/private.png" }],
=======
const nonAdminDeleteStore = inMemoryStore(projectDeleteSnapshot());
const nonAdminDelete = await invokeDelete({
  method: "POST",
  headers: { "x-dashboard-token": "viewer-token" },
  body: {
    project_id: "research-a",
    task_action: "delete",
    expected_task_ids: ["task-listed", "task-unlisted"],
>>>>>>> Stashed changes
  },
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN_USERS: JSON.stringify({ "viewer-token": "Research Viewer" }),
  },
  authOptions: {
    loadAccess: async () => {
      throw new Error("No access override in this test");
    },
  },
<<<<<<< Updated upstream
  persistMutation: nonAdminPortfolioStore.persistMutation,
});
assert.equal(nonAdminPortfolio.statusCode, 403);
assert.match(nonAdminPortfolio.body.error, /administrator role/i);
assert.equal(nonAdminPortfolioStore.audits.length, 0);

const portfolioStore = inMemoryStore();
const portfolioReferences = [{
  src: "dashboard/assets/robot4robot-overview.jpg",
  caption: "Sensitive caption stays out of the audit payload.",
  fit: "landscape-contain",
}];
const portfolioUpdate = await invokePortfolio({
  method: "POST",
  headers: { "x-dashboard-token": "admin-token" },
  body: { visual_references: portfolioReferences },
=======
  persistMutation: nonAdminDeleteStore.persistMutation,
});
assert.equal(nonAdminDelete.statusCode, 403);
assert.match(nonAdminDelete.body.error, /administrator role/i);
assert.equal(nonAdminDeleteStore.snapshot().projects.length, 2);
assert.equal(nonAdminDeleteStore.audits.length, 0);

const taskSetChangedStore = inMemoryStore(projectDeleteSnapshot());
const taskSetChanged = await invokeDelete({
  method: "POST",
  headers: { "x-dashboard-token": "admin-token" },
  body: {
    project_id: "research-a",
    task_action: "delete",
    expected_task_ids: ["task-listed"],
  },
>>>>>>> Stashed changes
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN: "admin-token",
  },
<<<<<<< Updated upstream
  persistMutation: portfolioStore.persistMutation,
});
assert.equal(portfolioUpdate.statusCode, 200);
assert.equal(portfolioUpdate.body.ok, true);
assert.deepEqual(portfolioStore.snapshot().portfolio.visual_references, portfolioReferences);
assert.deepEqual(portfolioStore.audits, [{
  action: "portfolio-update",
  payload: {
    changed_fields: ["visual_references"],
    visual_reference_count: 1,
  },
}]);
assert.equal(JSON.stringify(portfolioStore.audits).includes("Sensitive caption"), false);

const missingPortfolioPatch = await invokePortfolio({
  method: "POST",
  headers: { "x-dashboard-token": "admin-token" },
  body: {},
=======
  persistMutation: taskSetChangedStore.persistMutation,
});
assert.equal(taskSetChanged.statusCode, 409);
assert.match(taskSetChanged.body.error, /Project task set changed: research-a/);
assert.equal(taskSetChangedStore.snapshot().projects.length, 2);
assert.equal(taskSetChangedStore.audits.length, 0);

const deleteStore = inMemoryStore(projectDeleteSnapshot());
const deleted = await invokeDelete({
  method: "POST",
  headers: { "x-dashboard-token": "admin-token" },
  body: {
    project_id: "research-a",
    task_action: "delete",
    expected_task_ids: ["task-unlisted", "task-listed"],
  },
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN: "admin-token",
  },
  persistMutation: deleteStore.persistMutation,
});
assert.equal(deleted.statusCode, 200);
assert.equal(deleted.body.ok, true);
assert.equal(deleted.body.deleted, true);
assert.deepEqual(deleted.body.affected_task_ids, ["task-listed", "task-unlisted"]);
assert.deepEqual(
  deleteStore.snapshot().projects.map((project) => project.project_id),
  ["engineering-a"],
);
assert.deepEqual(
  deleteStore.snapshot().portfolio.projects.map((project) => project.project_id),
  ["engineering-a"],
);
assert.deepEqual(
  deleteStore.snapshot().taskDoc.tasks.map((task) => task.task_id),
  ["task-target"],
);
assert.deepEqual(deleteStore.snapshot().projects[0].task_ids, ["task-target"]);
assert.deepEqual(deleteStore.audits, [{
  action: "project-delete",
  payload: {
    project_id: "research-a",
    task_action: "delete",
    target_project_id: null,
    task_count: 2,
  },
}]);

const migrateStore = inMemoryStore(projectDeleteSnapshot());
const migrated = await invokeDelete({
  method: "POST",
  headers: { "x-dashboard-token": "admin-token" },
  body: {
    project_id: "research-a",
    task_action: "migrate",
    target_project_id: "engineering-a",
    expected_task_ids: ["task-listed", "task-unlisted"],
  },
>>>>>>> Stashed changes
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN: "admin-token",
  },
<<<<<<< Updated upstream
  persistMutation: inMemoryStore().persistMutation,
});
assert.equal(missingPortfolioPatch.statusCode, 400);
assert.match(missingPortfolioPatch.body.error, /Missing portfolio patch/);
=======
  persistMutation: migrateStore.persistMutation,
});
assert.equal(migrated.statusCode, 200);
assert.equal(migrated.body.task_action, "migrate");
assert.equal(migrated.body.target_project_id, "engineering-a");
assert.deepEqual(
  migrateStore.snapshot().taskDoc.tasks.map((task) => task.project_id),
  ["engineering-a", "engineering-a", "engineering-a"],
);
assert.deepEqual(
  migrateStore.snapshot().projects[0].task_ids,
  ["task-target", "task-listed", "task-unlisted"],
);
assert.deepEqual(migrateStore.audits, [{
  action: "project-delete",
  payload: {
    project_id: "research-a",
    task_action: "migrate",
    target_project_id: "engineering-a",
    task_count: 2,
  },
}]);

const missingExpectedTaskIds = await invokeDelete({
  method: "POST",
  headers: { "x-dashboard-token": "admin-token" },
  body: {
    project_id: "research-a",
    task_action: "delete",
  },
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN: "admin-token",
  },
  persistMutation: inMemoryStore(projectDeleteSnapshot()).persistMutation,
});
assert.equal(missingExpectedTaskIds.statusCode, 400);
assert.match(missingExpectedTaskIds.body.error, /Missing expected_task_ids/);

const deleteWithTargetStore = inMemoryStore(projectDeleteSnapshot());
const deleteWithTarget = await invokeDelete({
  method: "POST",
  headers: { "x-dashboard-token": "admin-token" },
  body: {
    project_id: "research-a",
    task_action: "delete",
    target_project_id: "engineering-a",
    expected_task_ids: ["task-listed", "task-unlisted"],
  },
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN: "admin-token",
  },
  persistMutation: deleteWithTargetStore.persistMutation,
});
assert.equal(deleteWithTarget.statusCode, 400);
assert.match(deleteWithTarget.body.error, /Invalid target_project_id/);
assert.equal(deleteWithTargetStore.snapshot().projects.length, 2);
assert.equal(deleteWithTargetStore.audits.length, 0);
>>>>>>> Stashed changes

console.log("dashboard project-update API tests passed");
