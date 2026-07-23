import assert from "node:assert/strict";
import {
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
assert.equal(validStore.snapshot().portfolio.projects[0].title, "Research A Updated");
assert.deepEqual(validStore.audits, [{
  action: "project-update",
  payload: {
    project_id: "research-a",
    changed_fields: ["title", "summary"],
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

console.log("dashboard project-update API tests passed");
