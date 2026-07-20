import {
  loadDashboardState,
  readJsonFile,
  statePathToFile,
} from "./dashboard-state-lib.mjs";
import {
  allowedTaskPriorities,
  allowedTaskStatuses,
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

function requiredId(value, label) {
  const id = String(value || "").trim();
  if (!id) throw new Error(`Missing ${label}`);
  return id;
}

function addUniqueId(ids, id, label) {
  if (ids.has(id)) throw new Error(`Duplicate ${label}: ${id}`);
  ids.add(id);
}

export function validateDashboardSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("Dashboard snapshot must be an object");
  }
  const container = snapshot.data && typeof snapshot.data === "object" ? snapshot.data : snapshot;
  const portfolio = container.portfolio;
  const projects = container.projects || container.projectDocs;
  const taskDoc = container.taskDoc || container.tasksDoc;
  if (!portfolio || typeof portfolio !== "object" || Array.isArray(portfolio)) {
    throw new Error("Dashboard snapshot is missing portfolio");
  }
  if (!Array.isArray(projects)) {
    throw new Error("Dashboard snapshot is missing projects");
  }
  if (!taskDoc || !Array.isArray(taskDoc.tasks)) {
    throw new Error("Dashboard snapshot is missing taskDoc.tasks");
  }

  const projectIds = new Set();
  for (const project of projects) {
    const projectId = requiredId(project?.project_id, "project_id");
    addUniqueId(projectIds, projectId, "project_id");
  }
  const portfolioProjectIds = new Set();
  for (const projectRef of Array.isArray(portfolio.projects) ? portfolio.projects : []) {
    const projectId = requiredId(projectRef?.project_id, "portfolio project_id");
    addUniqueId(portfolioProjectIds, projectId, "portfolio project_id");
    if (!projectIds.has(projectId)) {
      throw new Error(`Portfolio references missing project_id ${projectId}`);
    }
  }
  for (const projectId of projectIds) {
    if (portfolioProjectIds.size && !portfolioProjectIds.has(projectId)) {
      throw new Error(`Project ${projectId} is missing from portfolio.projects`);
    }
  }

  const taskIds = new Set();
  const commentIds = new Set();
  for (const task of taskDoc.tasks) {
    const taskId = requiredId(task?.task_id, "task_id");
    addUniqueId(taskIds, taskId, "task_id");
    const projectId = requiredId(task?.project_id, `project_id for task ${taskId}`);
    if (!projectIds.has(projectId)) {
      throw new Error(`Task ${taskId} references missing project_id ${projectId}`);
    }
    if (!String(task?.title || "").trim()) {
      throw new Error(`Task ${taskId} is missing title`);
    }
    if (!allowedTaskStatuses.has(task?.status)) {
      throw new Error(`Task ${taskId} has invalid status ${task?.status}`);
    }
    if (!allowedTaskPriorities.has(task?.priority)) {
      throw new Error(`Task ${taskId} has invalid priority ${task?.priority}`);
    }
    for (const comment of Array.isArray(task.comments) ? task.comments : []) {
      const commentId = requiredId(comment?.comment_id || comment?.id, `comment_id for task ${taskId}`);
      addUniqueId(commentIds, commentId, "comment_id");
      if (comment?.task_id && comment.task_id !== taskId) {
        throw new Error(`Comment ${commentId} belongs to ${comment.task_id}, not ${taskId}`);
      }
      if (!String(comment?.body || "").trim()) {
        throw new Error(`Comment ${commentId} is missing body`);
      }
    }
  }
  for (const project of projects) {
    const projectId = String(project.project_id);
    const referencedTaskIds = new Set();
    for (const taskIdValue of Array.isArray(project.task_ids) ? project.task_ids : []) {
      const taskId = requiredId(taskIdValue, `task_id in project ${projectId}`);
      addUniqueId(referencedTaskIds, taskId, `task_id in project ${projectId}`);
      if (!taskIds.has(taskId)) {
        throw new Error(`Project ${projectId} references missing task_id ${taskId}`);
      }
    }
    const rowIds = new Set();
    for (const row of Array.isArray(project.intro_table?.rows) ? project.intro_table.rows : []) {
      const rowId = String(row?.row_id || "").trim();
      if (!rowId && project.intro_table?.kind !== "procurement_table") continue;
      requiredId(rowId, `row_id in project ${projectId}`);
      addUniqueId(rowIds, rowId, `row_id in project ${projectId}`);
    }
  }
  return snapshot;
}

export function dashboardStateToSnapshot(state, options = {}) {
  const now = options.now || new Date();
  const updatedAt = options.updatedAt
    || state.taskDoc?.updated_at
    || state.portfolio?.updated_at
    || now.toISOString();
  const snapshot = {
    schema_version: dashboardSnapshotSchemaVersion,
    source: options.source || "dashboard/state",
    updated_at: updatedAt,
    portfolio: cloneJson(state.portfolio),
    projects: cloneJson(state.projects.map((project) => project.doc)),
    taskDoc: cloneJson(state.taskDoc),
    audit_log: Array.isArray(options.auditLog) ? cloneJson(options.auditLog) : [],
  };
  validateDashboardSnapshot(snapshot);
  return snapshot;
}

async function loadGeneratedBundledDashboardSnapshot(options = {}) {
  try {
    const module = await import("./dashboard-bundled-state.generated.mjs");
    const snapshot = normalizeDashboardSnapshot(module.default);
    return {
      ...snapshot,
      source: options.source || snapshot.source || "bundled-json-generated",
    };
  } catch {
    return null;
  }
}

export async function loadBundledDashboardSnapshot(options = {}) {
  const generatedSnapshot = await loadGeneratedBundledDashboardSnapshot(options);
  if (generatedSnapshot) return generatedSnapshot;
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
  const normalized = {
    schema_version: raw.schema_version || dashboardSnapshotSchemaVersion,
    source: raw.source || "unknown",
    updated_at: raw.updated_at || taskDoc.updated_at || new Date().toISOString(),
    portfolio: cloneJson(portfolio),
    projects: cloneJson(projects),
    taskDoc: cloneJson(taskDoc),
    audit_log: Array.isArray(container.audit_log) ? cloneJson(container.audit_log) : [],
  };
  validateDashboardSnapshot(normalized);
  return normalized;
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

const projectPatchFields = new Set([
  "title",
  "bucket",
  "status",
  "description",
  "summary",
  "details",
  "subprojects",
  "timeline",
  "references",
  "risks_decisions",
  "task_ids",
  "intro_table",
  "layer_utility",
  "visual",
  "asset",
  "asset_alt",
  "asset_caption",
  "asset_added_at",
]);

const portfolioPatchFields = new Set([
  "visual_references",
]);

function findProject(snapshot, projectId) {
  const targetProjectId = String(projectId || "").trim();
  return snapshot.projects.find((project) => String(project?.project_id || "") === targetProjectId) || null;
}

function sanitizeProjectPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Missing project patch");
  }
  const nextPatch = {};
  for (const [field, value] of Object.entries(patch)) {
    if (!projectPatchFields.has(field)) continue;
    const normalizedValue = typeof value === "string" ? value.trim() : cloneJson(value);
    if (["title", "bucket", "status"].includes(field) && !normalizedValue) {
      throw new Error(`Missing project ${field}`);
    }
    nextPatch[field] = normalizedValue;
  }
  if (!Object.keys(nextPatch).length) {
    throw new Error("Missing project update fields");
  }
  return nextPatch;
}

function sanitizePortfolioPatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Missing portfolio patch");
  }
  const nextPatch = {};
  for (const [field, value] of Object.entries(patch)) {
    if (!portfolioPatchFields.has(field)) continue;
    nextPatch[field] = cloneJson(value);
  }
  if (!Object.keys(nextPatch).length) {
    throw new Error("Missing portfolio update fields");
  }
  return nextPatch;
}

function jsonValuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
    const normalizedValue = typeof value === "string" ? value.trim() : value;
    if (field === "url" && normalizedValue) {
      let parsed;
      try {
        parsed = new URL(normalizedValue);
      } catch (error) {
        throw new Error("URL must be an absolute http or https URL");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("URL must use http or https");
      }
    }
    nextPatch[field] = normalizedValue;
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

export function applySnapshotProjectUpdate(snapshot, projectId, patch, options = {}) {
  const next = cloneMutableSnapshot(snapshot);
  const targetProjectId = String(projectId || "").trim();
  if (!targetProjectId) {
    throw new Error("Missing project_id");
  }
  const project = findProject(next, targetProjectId);
  if (!project) {
    throw new Error(`Project not found: ${targetProjectId}`);
  }
  const nextPatch = sanitizeProjectPatch(patch);
  if (nextPatch.bucket) {
    const buckets = new Set((next.portfolio.project_buckets || []).map((entry) => entry?.bucket));
    if (!buckets.has(nextPatch.bucket)) {
      throw new Error(`Invalid project bucket: ${nextPatch.bucket}`);
    }
  }

  const changedFields = [];
  for (const [field, value] of Object.entries(nextPatch)) {
    if (!jsonValuesEqual(project[field], value)) {
      project[field] = cloneJson(value);
      changedFields.push(field);
    }
  }

  const projectRef = (next.portfolio.projects || []).find((entry) => entry?.project_id === targetProjectId);
  if (!projectRef) {
    throw new Error(`Portfolio project not found: ${targetProjectId}`);
  }
  const changedRefFields = [];
  for (const field of ["title", "bucket", "status"]) {
    if (
      Object.prototype.hasOwnProperty.call(nextPatch, field)
      && !jsonValuesEqual(projectRef[field], nextPatch[field])
    ) {
      projectRef[field] = nextPatch[field];
      changedRefFields.push(field);
    }
  }

  const updatedAt = (options.now || new Date()).toISOString();
  if (changedFields.length || changedRefFields.length) {
    project.updated_at = updatedAt;
    next.updated_at = updatedAt;
  }
  next.source = options.source || next.source;
  return {
    snapshot: next,
    project,
    projectRef,
    update: {
      project_id: targetProjectId,
      changed_fields: changedFields,
      changed_ref_fields: changedRefFields,
      updated_at: changedFields.length || changedRefFields.length ? updatedAt : project.updated_at,
    },
  };
}

export function applySnapshotPortfolioUpdate(snapshot, patch, options = {}) {
  const next = cloneMutableSnapshot(snapshot);
  const nextPatch = sanitizePortfolioPatch(patch);
  const changedFields = [];
  for (const [field, value] of Object.entries(nextPatch)) {
    if (!jsonValuesEqual(next.portfolio[field], value)) {
      next.portfolio[field] = cloneJson(value);
      changedFields.push(field);
    }
  }

  const updatedAt = (options.now || new Date()).toISOString();
  if (changedFields.length) {
    next.portfolio.updated_at = updatedAt;
    next.updated_at = updatedAt;
  }
  next.source = options.source || next.source;
  return {
    snapshot: next,
    portfolio: next.portfolio,
    update: {
      changed_fields: changedFields,
      updated_at: changedFields.length ? updatedAt : next.portfolio.updated_at,
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
