import {
  loadDashboardState,
  readJsonFile,
  statePathToFile,
} from "./dashboard-state-lib.mjs";
import {
  applyTaskPatch,
  applyTaskStatus,
  findTask,
  makeTask,
} from "./dashboard-task-store.mjs";

export const dashboardSnapshotSchemaVersion = "dashboard-state.v1";
export const maxDashboardAuditEvents = 1000;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function dashboardStateToSnapshot(state, options = {}) {
  const now = options.now || new Date();
  const updatedAt = options.updatedAt || now.toISOString();
  return {
    schema_version: dashboardSnapshotSchemaVersion,
    source: options.source || "dashboard/state",
    updated_at: updatedAt,
    portfolio: cloneJson(state.portfolio),
    projects: cloneJson(state.projects.map((project) => project.doc)),
    taskDoc: cloneJson(state.taskDoc),
    audit_log: Array.isArray(options.auditLog) ? cloneJson(options.auditLog) : [],
  };
}

export async function loadBundledDashboardSnapshot(options = {}) {
  const state = await loadDashboardState();
  return dashboardStateToSnapshot(state, {
    ...options,
    source: options.source || "bundled-json",
  });
}

export async function loadDashboardSnapshotFromFiles(options = {}) {
  const portfolio = await readJsonFile(options.portfolioPath || statePathToFile("dashboard/state/portfolio.json"));
  const projectRefs = Array.isArray(portfolio.projects) ? portfolio.projects : [];
  const projects = await Promise.all(projectRefs.map((projectRef) => readJsonFile(statePathToFile(projectRef.state_path))));
  const taskDoc = await readJsonFile(options.tasksPath || statePathToFile("dashboard/state/tasks.json"));
  return normalizeDashboardSnapshot({
    schema_version: dashboardSnapshotSchemaVersion,
    source: "dashboard/state",
    updated_at: options.updatedAt || taskDoc.updated_at || new Date().toISOString(),
    portfolio,
    projects,
    taskDoc,
  });
}

export function normalizeDashboardSnapshot(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("Dashboard snapshot must be an object");
  }
  const container = raw.data && typeof raw.data === "object" ? raw.data : raw;
  const portfolio = container.portfolio;
  const projects = container.projects || container.projectDocs;
  const taskDoc = container.taskDoc || container.tasksDoc;
  if (!portfolio || typeof portfolio !== "object") {
    throw new Error("Dashboard snapshot is missing portfolio");
  }
  if (!Array.isArray(projects)) {
    throw new Error("Dashboard snapshot is missing projects");
  }
  if (!taskDoc || !Array.isArray(taskDoc.tasks)) {
    throw new Error("Dashboard snapshot is missing taskDoc.tasks");
  }
  return {
    schema_version: raw.schema_version || dashboardSnapshotSchemaVersion,
    source: raw.source || "unknown",
    updated_at: raw.updated_at || taskDoc.updated_at || new Date().toISOString(),
    portfolio: cloneJson(portfolio),
    projects: cloneJson(projects),
    taskDoc: cloneJson(taskDoc),
    audit_log: Array.isArray(container.audit_log) ? cloneJson(container.audit_log) : [],
  };
}

export function serializeDashboardSnapshot(snapshot) {
  const normalized = normalizeDashboardSnapshot(snapshot);
  return JSON.stringify(normalized, null, 2) + "\n";
}

export function toDashboardStateResponse(snapshot, meta = {}) {
  const normalized = normalizeDashboardSnapshot(snapshot);
  return {
    ok: true,
    schema_version: normalized.schema_version,
    portfolio: normalized.portfolio,
    projects: normalized.projects,
    taskDoc: normalized.taskDoc,
    meta: {
      source: normalized.source,
      updated_at: normalized.updated_at,
      ...meta,
    },
  };
}

function cloneMutableSnapshot(snapshot) {
  return normalizeDashboardSnapshot(snapshot);
}

const projectTableRowPatchFields = new Set([
  "item",
  "status",
  "route",
  "notes",
  "url",
  "updated_at",
  "owner",
  "source",
]);

function findProject(snapshot, projectId) {
  const targetProjectId = String(projectId || "").trim();
  return snapshot.projects.find((project) => String(project?.project_id || "") === targetProjectId) || null;
}

function findProjectTableRow(project, tableKind, rowId) {
  const table = project?.intro_table;
  if (!table || !Array.isArray(table.rows)) {
    return { table: null, row: null };
  }
  if (tableKind && table.kind !== tableKind) {
    throw new Error(`Project ${project.project_id} does not have table kind ${tableKind}`);
  }
  const targetRowId = String(rowId || "").trim();
  const row = table.rows.find((candidate) => String(candidate?.row_id || "") === targetRowId) || null;
  return { table, row };
}

function sanitizeProjectTableRowPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Missing row patch");
  }
  const nextPatch = {};
  for (const [field, value] of Object.entries(patch)) {
    if (!projectTableRowPatchFields.has(field)) {
      continue;
    }
    nextPatch[field] = typeof value === "string" ? value.trim() : value;
  }
  if (!Object.keys(nextPatch).length) {
    throw new Error("Missing row update fields");
  }
  return nextPatch;
}

function normalizeProcurementStatusForSort(status) {
  const value = String(status || "").trim().toLowerCase();
  if (!value || value === "requested" || value.includes("pending") || value.includes("romoya") || value.includes("canceled")) {
    return "";
  }
  if (value.startsWith("archive") || value.includes("arrived") || value.includes("received") || value === "done" || value.includes("交易成功")) {
    return "Arrived";
  }
  if (value.includes("ordered") || value.includes("shipped") || value.includes("buyer paid") || value.includes("presale")) {
    return "Ordered";
  }
  return "Ordered";
}

function procurementStatusRank(row) {
  const status = normalizeProcurementStatusForSort(row?.status);
  if (status === "") return 0;
  if (status === "Ordered") return 1;
  if (status === "Arrived") return 2;
  return 3;
}

function compareProcurementRows(a, b) {
  const statusDiff = procurementStatusRank(a) - procurementStatusRank(b);
  if (statusDiff) return statusDiff;
  const aTime = Date.parse(a?.updated_at || "");
  const bTime = Date.parse(b?.updated_at || "");
  if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
    return bTime - aTime;
  }
  return String(a?.item || "").localeCompare(String(b?.item || ""), "en", { numeric: true });
}

function sortProjectTableRows(table) {
  if (table?.kind === "procurement_table" && Array.isArray(table.rows)) {
    table.rows.sort(compareProcurementRows);
  }
}

export function appendSnapshotAuditEvent(snapshot, event, options = {}) {
  const next = cloneMutableSnapshot(snapshot);
  const limit = Number.isFinite(options.limit) && options.limit > 0
    ? Math.floor(options.limit)
    : maxDashboardAuditEvents;
  next.audit_log = [
    ...(Array.isArray(next.audit_log) ? next.audit_log : []),
    cloneJson(event),
  ].slice(-limit);
  return next;
}

export function applySnapshotTaskCreate(snapshot, input, options = {}) {
  const next = cloneMutableSnapshot(snapshot);
  const now = options.now || new Date();
  const existingIds = new Set(next.taskDoc.tasks.map((task) => task?.task_id).filter(Boolean));
  const task = makeTask(input, existingIds, now);
  next.taskDoc.tasks.push(task);
  next.taskDoc.updated_at = task.updated_at;
  next.updated_at = task.updated_at;
  next.source = options.source || next.source;
  return { snapshot: next, task };
}

export function applySnapshotTaskStatus(snapshot, taskId, status, options = {}) {
  const next = cloneMutableSnapshot(snapshot);
  const task = findTask(next.taskDoc, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  const update = applyTaskStatus(task, status, options.now || new Date());
  next.taskDoc.updated_at = update.updated_at;
  next.updated_at = update.updated_at;
  next.source = options.source || next.source;
  return { snapshot: next, task, update };
}

export function applySnapshotTaskUpdate(snapshot, taskId, patch, options = {}) {
  const next = cloneMutableSnapshot(snapshot);
  const task = findTask(next.taskDoc, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  const update = applyTaskPatch(task, patch, options.now || new Date());
  if (update.changed_fields.length) {
    next.taskDoc.updated_at = update.updated_at;
    next.updated_at = update.updated_at;
  }
  next.source = options.source || next.source;
  return { snapshot: next, task, update };
}

export function applySnapshotProjectTableRowUpdate(snapshot, input, options = {}) {
  const next = cloneMutableSnapshot(snapshot);
  const projectId = String(input?.project_id || "").trim();
  const rowId = String(input?.row_id || "").trim();
  if (!projectId) {
    throw new Error("Missing project_id");
  }
  if (!rowId) {
    throw new Error("Missing row_id");
  }
  const project = findProject(next, projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  const { table, row } = findProjectTableRow(project, input?.table_kind || input?.kind || "", rowId);
  if (!table || !row) {
    throw new Error(`Table row not found: ${rowId}`);
  }
  const patch = sanitizeProjectTableRowPatch(input.patch);
  const changedFields = [];
  for (const [field, value] of Object.entries(patch)) {
    if (row[field] !== value) {
      row[field] = value;
      changedFields.push(field);
    }
  }
  const updatedAt = patch.updated_at || (options.now || new Date()).toISOString();
  if (changedFields.length && row.updated_at !== updatedAt) {
    row.updated_at = updatedAt;
    if (!changedFields.includes("updated_at")) {
      changedFields.push("updated_at");
    }
  }
  if (changedFields.length) {
    sortProjectTableRows(table);
    project.updated_at = updatedAt;
    next.updated_at = updatedAt;
  }
  next.source = options.source || next.source;
  return {
    snapshot: next,
    project,
    table,
    row,
    update: {
      project_id: projectId,
      row_id: rowId,
      changed_fields: changedFields,
      updated_at: updatedAt,
    },
  };
}

export function applySnapshotTaskComment(snapshot, taskId, comment, options = {}) {
  const next = cloneMutableSnapshot(snapshot);
  const task = findTask(next.taskDoc, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  if (comment?.task_id && comment.task_id !== taskId) {
    throw new Error(`Comment ${comment.comment_id || ""} belongs to ${comment.task_id}, not ${taskId}`);
  }
  task.comments = Array.isArray(task.comments) ? task.comments : [];
  if (!task.comments.some((existing) => existing.comment_id === comment.comment_id)) {
    task.comments.push(comment);
    task.updated_at = comment.created_at || (options.now || new Date()).toISOString();
    next.taskDoc.updated_at = task.updated_at;
    next.updated_at = task.updated_at;
  }
  next.source = options.source || next.source;
  return { snapshot: next, task, comment };
}

export function applySnapshotTaskCommentDelete(snapshot, taskId, commentId, options = {}) {
  const next = cloneMutableSnapshot(snapshot);
  const task = findTask(next.taskDoc, taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  const targetCommentId = String(commentId || "").trim();
  if (!targetCommentId) {
    throw new Error("Missing comment_id");
  }
  task.comments = Array.isArray(task.comments) ? task.comments : [];
  const index = task.comments.findIndex((comment) => (
    String(comment?.comment_id || comment?.id || "") === targetCommentId
  ));
  if (index < 0) {
    throw new Error(`Comment not found: ${targetCommentId}`);
  }
  const [comment] = task.comments.splice(index, 1);
  const updatedAt = (options.now || new Date()).toISOString();
  task.updated_at = updatedAt;
  next.taskDoc.updated_at = updatedAt;
  next.updated_at = updatedAt;
  next.source = options.source || next.source;
  return { snapshot: next, task, comment };
}
