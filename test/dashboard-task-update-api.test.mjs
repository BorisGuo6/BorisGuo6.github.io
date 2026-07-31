import assert from "node:assert/strict";
import {
  handleDashboardTaskUpdate,
  withDashboardApiErrors,
} from "../scripts/dashboard-vercel-api.mjs";

const baseSnapshot = {
  schema_version: "dashboard-state.v1",
  source: "test",
  updated_at: "2026-07-29T00:00:00.000Z",
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
      task_ids: ["task-move"],
    },
    {
      project_id: "engineering-a",
      title: "Engineering A",
      bucket: "engineering",
      status: "ongoing",
      task_ids: [],
    },
  ],
  taskDoc: {
    schema_version: "tasks.v1",
    tasks: [{
      task_id: "task-move",
      project_id: "research-a",
      title: "Move me",
      status: "todo",
      priority: "medium",
      comments: [],
      created_at: "2026-07-29T00:00:00.000Z",
      updated_at: "2026-07-29T00:00:00.000Z",
    }],
  },
  audit_log: [],
};

function responseProbe() {
  return {
    statusCode: null,
    body: null,
    setHeader() {},
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
    (nextRequest, nextResponse) => handleDashboardTaskUpdate(
      nextRequest,
      nextResponse,
      options,
    ),
  );
  await handler({ headers: {}, ...request }, response);
  return response;
}

function inMemoryStore() {
  let current = structuredClone(baseSnapshot);
  const audits = [];
  return {
    audits,
    snapshot: () => structuredClone(current),
    async persistMutation(mutation, auditOptions) {
      const result = mutation(current);
      current = result.snapshot;
      audits.push({
        action: auditOptions.action,
        payload: typeof auditOptions.payload === "function"
          ? auditOptions.payload(result)
          : auditOptions.payload,
      });
      return {
        ...result,
        meta: { storage: "test", audit_id: `audit-${audits.length}` },
      };
    },
  };
}

const scopedStore = inMemoryStore();
const outOfScope = await invoke({
  method: "POST",
  headers: { "x-dashboard-token": "viewer-token" },
  body: {
    task_id: "task-move",
    project_id: "engineering-a",
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
assert.equal(scopedStore.snapshot().taskDoc.tasks[0].project_id, "research-a");
assert.equal(scopedStore.audits.length, 0);

const adminStore = inMemoryStore();
const moved = await invoke({
  method: "POST",
  headers: { "x-dashboard-token": "admin-token" },
  body: {
    task_id: "task-move",
    project_id: "engineering-a",
  },
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN: "admin-token",
  },
  persistMutation: adminStore.persistMutation,
});
assert.equal(moved.statusCode, 200);
assert.equal(moved.body.ok, true);
assert.deepEqual(moved.body.update.changed_fields, ["project_id"]);
assert.equal(adminStore.snapshot().taskDoc.tasks[0].project_id, "engineering-a");
assert.deepEqual(adminStore.snapshot().projects[0].task_ids, []);
assert.deepEqual(adminStore.snapshot().projects[1].task_ids, ["task-move"]);
assert.deepEqual(adminStore.audits, [{
  action: "task-update",
  payload: {
    task_id: "task-move",
    changed_fields: ["project_id"],
  },
}]);

console.log("dashboard task update API tests passed");
