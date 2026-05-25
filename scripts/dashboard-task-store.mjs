import { randomUUID } from "node:crypto";
import { maxCommentLength, readJsonFile, tasksPath, writeJsonFile } from "./dashboard-state-lib.mjs";

export const allowedTaskStatuses = new Set(["todo", "active", "blocked", "needs_user", "review", "done"]);
export const allowedTaskPriorities = new Set(["low", "medium", "high"]);

export function slugifyTaskPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function validateTaskStatus(status) {
  if (!allowedTaskStatuses.has(status)) {
    throw new Error(`Invalid status: ${status}`);
  }
  return status;
}

export function validateTaskPriority(priority) {
  if (!allowedTaskPriorities.has(priority)) {
    throw new Error(`Invalid priority: ${priority}`);
  }
  return priority;
}

export function validateDueDate(dueAt) {
  if (dueAt && !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) {
    throw new Error("Invalid due_at date");
  }
  return dueAt || "";
}

export function makeTaskId(projectId, title, existingIds, now = new Date()) {
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const base = `task_${slugifyTaskPart(projectId) || "project"}_${slugifyTaskPart(title) || "todo"}_${date}`;
  let taskId = base;
  let suffix = 2;
  while (existingIds.has(taskId)) {
    taskId = `${base}_${suffix}`;
    suffix += 1;
  }
  return taskId;
}

export function makeTask(input, existingIds, now = new Date()) {
  const updatedAt = now.toISOString();
  const status = validateTaskStatus(input.status || "todo");
  const priority = validateTaskPriority(input.priority || "medium");
  const dueAt = validateDueDate(input.due_at || "");
  const requestedTaskId = optionalString(input.task_id);
  const task = {
    task_id: requestedTaskId && !existingIds.has(requestedTaskId)
      ? requestedTaskId
      : makeTaskId(input.project_id, input.title, existingIds, now),
    project_id: input.project_id,
    title: input.title,
    description: input.description || "",
    status,
    priority,
    assignee: input.assignee || null,
    result: null,
    comments: [],
    updated_at: updatedAt,
  };
  if (dueAt) task.due_at = dueAt;
  if (status === "done") task.completed_at = updatedAt.slice(0, 10);
  return task;
}

export function applyTaskStatus(task, status, now = new Date()) {
  validateTaskStatus(status);
  const updatedAt = now.toISOString();
  task.status = status;
  task.completed_at = status === "done" ? updatedAt.slice(0, 10) : null;
  task.updated_at = updatedAt;
  return {
    updated_at: updatedAt,
    completed_at: task.completed_at,
  };
}

export function makeTaskComment(taskId, body, author = "Local dashboard", now = new Date()) {
  const commentBody = String(body || "").trim();
  if (!commentBody) {
    throw new Error("Missing body");
  }
  if (commentBody.length > maxCommentLength) {
    throw new Error(`Comment must be ${maxCommentLength} characters or fewer`);
  }
  return {
    comment_id: `comment_${randomUUID()}`,
    task_id: taskId,
    author,
    author_type: "system",
    kind: "comment",
    body: commentBody,
    created_at: now.toISOString(),
  };
}

export function findTask(doc, taskId) {
  return Array.isArray(doc.tasks) ? doc.tasks.find((candidate) => candidate.task_id === taskId) : null;
}

async function readTaskDocument(filePath = tasksPath) {
  const doc = await readJsonFile(filePath);
  if (!Array.isArray(doc.tasks)) {
    throw new Error("tasks.json does not contain a tasks array");
  }
  return doc;
}

export async function createLocalTask(input, options = {}) {
  const filePath = options.filePath || tasksPath;
  const now = options.now || new Date();
  const doc = await readTaskDocument(filePath);
  const existingIds = new Set(doc.tasks.map((task) => task?.task_id).filter(Boolean));
  const task = makeTask(input, existingIds, now);
  doc.updated_at = task.updated_at;
  doc.tasks.push(task);
  await writeJsonFile(filePath, doc);
  return task;
}

export async function updateLocalTaskStatus(taskId, status, options = {}) {
  const filePath = options.filePath || tasksPath;
  const now = options.now || new Date();
  const doc = await readTaskDocument(filePath);
  const task = findTask(doc, taskId);
  if (!task) {
    throw new Error(`Task not found in local tasks.json: ${taskId}`);
  }
  const update = applyTaskStatus(task, status, now);
  await writeJsonFile(filePath, doc);
  return update;
}

export async function appendLocalTaskComment(taskId, comment, options = {}) {
  const filePath = options.filePath || tasksPath;
  const doc = await readTaskDocument(filePath);
  const task = findTask(doc, taskId);
  if (!task) {
    throw new Error(`Task not found in local tasks.json: ${taskId}`);
  }
  task.comments = Array.isArray(task.comments) ? task.comments : [];
  if (!task.comments.some((existing) => existing.comment_id === comment.comment_id)) {
    task.comments.push(comment);
  }
  task.updated_at = comment.created_at || new Date().toISOString();
  await writeJsonFile(filePath, doc);
  return comment;
}
