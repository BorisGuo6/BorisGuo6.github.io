import assert from "node:assert/strict";
import {
  applyDashboardMutationToSnapshot,
  parseMutationArgs,
  verifyDashboardMutation,
} from "../scripts/dashboard-mutate.mjs";

const baseSnapshot = {
  schema_version: "dashboard-state.v1",
  source: "test",
  updated_at: "2026-06-18T00:00:00.000Z",
  portfolio: {
    portfolio_id: "demo-dashboard",
    title: "Demo",
    projects: [{ project_id: "demo" }],
    project_buckets: [{ bucket: "research" }],
  },
  projects: [{ project_id: "demo", task_ids: ["task_demo"] }],
  taskDoc: {
    schema_version: "tasks.v1",
    updated_at: "2026-06-18T00:00:00.000Z",
    tasks: [{
      task_id: "task_demo",
      project_id: "demo",
      title: "Demo task",
      description: "Task",
      status: "todo",
      priority: "medium",
      assignee: null,
      result: null,
      comments: [],
      updated_at: "2026-06-18T00:00:00.000Z",
    }],
  },
};

assert.deepEqual(
  parseMutationArgs(["status", "--task-id", "task_demo", "--status", "done"]),
  {
    action: "status",
    pull: false,
    forcePull: false,
    taskId: "task_demo",
    status: "done",
  },
);

assert.deepEqual(
  parseMutationArgs(["comment", "--task-id=task_demo", "--body", "Progress note", "--author", "Codex"]),
  {
    action: "comment",
    pull: false,
    forcePull: false,
    taskId: "task_demo",
    body: "Progress note",
    author: "Codex",
  },
);

assert.deepEqual(
  parseMutationArgs(["project-update", "--project-id", "demo", "--patch-file", "tmp/project-patch.json", "--pull"]),
  {
    action: "project-update",
    pull: true,
    forcePull: false,
    projectId: "demo",
    patchFile: "tmp/project-patch.json",
  },
);

const fixedNow = new Date("2026-06-18T01:00:00.000Z");
const statusResult = applyDashboardMutationToSnapshot(baseSnapshot, {
  action: "status",
  taskId: "task_demo",
  status: "done",
}, {
  now: fixedNow,
});

assert.equal(statusResult.task.status, "done");
assert.equal(statusResult.snapshot.taskDoc.updated_at, "2026-06-18T01:00:00.000Z");
assert.deepEqual(verifyDashboardMutation(statusResult.snapshot, statusResult), {
  ok: true,
  task_id: "task_demo",
  status: "done",
});

const commentResult = applyDashboardMutationToSnapshot(baseSnapshot, {
  action: "comment",
  taskId: "task_demo",
  body: "Progress note",
  author: "Codex",
}, {
  now: fixedNow,
});

assert.equal(commentResult.comment.body, "Progress note");
assert.equal(commentResult.comment.author, "Codex");
assert.equal(commentResult.snapshot.taskDoc.tasks[0].comments.length, 1);
assert.deepEqual(verifyDashboardMutation(commentResult.snapshot, commentResult), {
  ok: true,
  task_id: "task_demo",
  comment_id: commentResult.comment.comment_id,
});

const updateResult = applyDashboardMutationToSnapshot(baseSnapshot, {
  action: "update",
  taskId: "task_demo",
  patch: {
    title: "Updated title",
    priority: "high",
  },
}, {
  now: fixedNow,
});

assert.equal(updateResult.task.title, "Updated title");
assert.equal(updateResult.task.priority, "high");
assert.deepEqual(verifyDashboardMutation(updateResult.snapshot, updateResult), {
  ok: true,
  task_id: "task_demo",
  changed_fields: ["title", "priority"],
});

const projectUpdateResult = applyDashboardMutationToSnapshot(baseSnapshot, {
  action: "project-update",
  projectId: "demo",
  patch: {
    title: "Research demo",
    bucket: "research",
    status: "ongoing",
    description: "Explicit project update",
  },
}, {
  now: fixedNow,
});

assert.equal(projectUpdateResult.project.title, "Research demo");
assert.equal(projectUpdateResult.project.status, "ongoing");
assert.equal(projectUpdateResult.projectRef.title, "Research demo");
assert.equal(projectUpdateResult.projectRef.bucket, "research");
assert.equal(projectUpdateResult.projectRef.status, "ongoing");
assert.deepEqual(projectUpdateResult.update.changed_ref_fields, ["title", "bucket", "status"]);
assert.deepEqual(verifyDashboardMutation(projectUpdateResult.snapshot, projectUpdateResult), {
  ok: true,
  project_id: "demo",
  changed_fields: ["title", "bucket", "status", "description"],
});

assert.throws(
  () => parseMutationArgs(["status", "--task-id", "task_demo"]),
  /Missing --status/,
);
assert.throws(
  () => applyDashboardMutationToSnapshot(baseSnapshot, {
    action: "status",
    taskId: "missing",
    status: "done",
  }),
  /Task not found: missing/,
);
assert.throws(
  () => parseMutationArgs(["project-update", "--project-id", "demo"]),
  /Missing --patch-file/,
);
assert.throws(
  () => applyDashboardMutationToSnapshot(baseSnapshot, {
    action: "project-update",
    projectId: "demo",
    patch: { bucket: "missing" },
  }),
  /Invalid project bucket: missing/,
);
