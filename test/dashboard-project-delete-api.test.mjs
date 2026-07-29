import assert from "node:assert/strict";
import {
  applySnapshotProjectDelete,
  normalizeDashboardSnapshot,
} from "../scripts/dashboard-state-snapshot.mjs";
import {
  handleDashboardProjectDelete,
  withDashboardApiErrors,
} from "../scripts/dashboard-vercel-api.mjs";

const baseSnapshot = normalizeDashboardSnapshot({
  schema_version: "dashboard-state.v1",
  source: "test",
  updated_at: "2026-07-29T00:00:00.000Z",
  portfolio: {
    schema_version: "portfolio.v1",
    portfolio_id: "project-delete-test",
    project_buckets: [
      { bucket: "survey", label: "Survey" },
      { bucket: "archive", label: "Archive" },
    ],
    projects: [
      { project_id: "source", title: "Source", bucket: "archive", status: "archived" },
      { project_id: "target", title: "Target", bucket: "survey", status: "survey" },
    ],
  },
  projects: [
    {
      project_id: "source",
      title: "Source",
      bucket: "archive",
      status: "archived",
      task_ids: ["task-listed"],
    },
    {
      project_id: "target",
      title: "Target",
      bucket: "survey",
      status: "survey",
      task_ids: ["task-target", "task-listed"],
    },
  ],
  taskDoc: {
    schema_version: "tasks.v1",
    updated_at: "2026-07-29T00:00:00.000Z",
    tasks: [
      {
        task_id: "task-listed",
        project_id: "source",
        title: "Listed source task",
        status: "done",
        priority: "medium",
        comments: [],
      },
      {
        task_id: "task-unlisted",
        project_id: "source",
        title: "Unlisted source task",
        status: "done",
        priority: "medium",
        comments: [],
      },
      {
        task_id: "task-target",
        project_id: "target",
        title: "Target task",
        status: "todo",
        priority: "high",
        comments: [],
      },
    ],
  },
  audit_log: [],
});

assert.throws(
  () => applySnapshotProjectDelete(baseSnapshot, "source", {
    task_action: "migrate",
    target_project_id: "target",
    expected_task_ids: ["task-listed"],
  }),
  /Project task set changed: source/,
);

const directResult = applySnapshotProjectDelete(baseSnapshot, "source", {
  task_action: "migrate",
  target_project_id: "target",
  expected_task_ids: ["task-unlisted", "task-listed"],
}, {
  now: new Date("2026-07-29T01:00:00.000Z"),
  source: "test",
});
assert.equal(directResult.snapshot.projects.some((project) => project.project_id === "source"), false);
assert.equal(directResult.snapshot.portfolio.projects.some((project) => project.project_id === "source"), false);
assert.deepEqual(
  directResult.snapshot.taskDoc.tasks.map((task) => task.project_id),
  ["target", "target", "target"],
);
assert.deepEqual(
  directResult.snapshot.projects[0].task_ids,
  ["task-target", "task-listed", "task-unlisted"],
);

function responseProbe() {
  const headers = new Map();
  return {
    headers,
    statusCode: null,
    body: null,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), value);
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

async function invoke(request, options = {}) {
  const response = responseProbe();
  const handler = withDashboardApiErrors(
    (nextRequest, nextResponse) => handleDashboardProjectDelete(
      nextRequest,
      nextResponse,
      options,
    ),
  );
  await handler({ headers: {}, ...request }, response);
  return response;
}

const viewerStore = inMemoryStore();
const viewerResponse = await invoke({
  method: "POST",
  headers: { "x-dashboard-token": "viewer-token" },
  body: {
    project_id: "source",
    task_action: "migrate",
    target_project_id: "target",
    expected_task_ids: ["task-listed", "task-unlisted"],
  },
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN_USERS: JSON.stringify({ "viewer-token": "Viewer" }),
  },
  authOptions: {
    loadAccess: async () => {
      throw new Error("No access override in this test");
    },
  },
  persistMutation: viewerStore.persistMutation,
});
assert.equal(viewerResponse.statusCode, 403);
assert.equal(viewerStore.audits.length, 0);

const staleStore = inMemoryStore();
const staleResponse = await invoke({
  method: "POST",
  headers: { "x-dashboard-token": "admin-token" },
  body: {
    project_id: "source",
    task_action: "delete",
    expected_task_ids: ["task-listed"],
  },
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN: "admin-token",
  },
  persistMutation: staleStore.persistMutation,
});
assert.equal(staleResponse.statusCode, 409);
assert.equal(staleStore.audits.length, 0);

const migrateStore = inMemoryStore();
const migrateResponse = await invoke({
  method: "POST",
  headers: { "x-dashboard-token": "admin-token" },
  body: {
    project_id: "source",
    task_action: "migrate",
    target_project_id: "target",
    expected_task_ids: ["task-unlisted", "task-listed"],
  },
}, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_WRITE_TOKEN: "admin-token",
  },
  persistMutation: migrateStore.persistMutation,
});
assert.equal(migrateResponse.statusCode, 200);
assert.equal(migrateResponse.body.deleted, true);
assert.deepEqual(migrateResponse.body.affected_task_ids, ["task-listed", "task-unlisted"]);
assert.deepEqual(migrateStore.audits, [{
  action: "project-delete",
  payload: {
    project_id: "source",
    task_action: "migrate",
    target_project_id: "target",
    task_count: 2,
  },
}]);

console.log("dashboard project-delete API tests passed");
