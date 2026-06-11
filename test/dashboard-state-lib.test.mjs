import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  dashboardHash,
  dashboardTaskComments,
  isNoisyHarnessComment,
  loadDashboardState,
  normalizeCommentKind,
} from "../scripts/dashboard-state-lib.mjs";
import {
  buildSyncPlan,
  eventHash,
} from "../scripts/dashboard-sync-plan.mjs";
import {
  appendLocalTaskComment,
  applyTaskStatus,
  createLocalTask,
  makeTask,
  makeTaskComment,
  makeTaskId,
  updateLocalTaskStatus,
  validateTaskPriority,
} from "../scripts/dashboard-task-store.mjs";

assert.equal(normalizeCommentKind("host_verified"), "verification");
assert.equal(normalizeCommentKind("route"), "comment");
assert.equal(normalizeCommentKind(""), "comment");

assert.equal(isNoisyHarnessComment({
  kind: "conductor_note",
  body: "本机主控已向远端 session 发送继续指令",
}), true);
assert.equal(isNoisyHarnessComment({
  kind: "result",
  body: "VBench summary is ready",
}), false);

const comments = dashboardTaskComments({
  task_id: "task_demo",
  result: "final result",
  updated_at: "2026-05-25T00:00:00Z",
  comments: [
    { comment_id: "noise", kind: "conductor_note", body: "本机主控已向远端 session ping" },
    { comment_id: "keep", kind: "host_verified", author: "Host", body: "verified" },
  ],
});
assert.deepEqual(comments.map((comment) => comment.comment_id), ["task_demo_result", "keep"]);
assert.equal(comments[1].kind, "verification");

const state = await loadDashboardState();
assert.ok(state.portfolio.portfolio_id);
assert.ok(state.projects.length > 0);
assert.ok(state.tasks.length > 0);
assert.match(await dashboardHash(state), /^[a-f0-9]{64}$/);

const projectBucketNames = new Set((state.portfolio.project_buckets || []).map((bucket) => bucket.bucket));
assert.deepEqual(projectBucketNames, new Set(["research", "engineering", "survey", "archive"]));
for (const project of state.projects) {
  assert.ok(projectBucketNames.has(project.doc.bucket), `Unexpected project bucket ${project.doc.bucket}`);
  assert.notEqual(project.doc.bucket, "active", `Project bucket must not use TODO status name: ${project.doc.project_id}`);
}

const dashboardSource = await readFile(new URL("../dashboard/index.html", import.meta.url), "utf8");
const projectIds = new Set(state.projects.map((project) => project.doc.project_id));
for (const projectId of projectIds) {
  assert.equal(
    dashboardSource.includes(`"${projectId}"`) || dashboardSource.includes(`'${projectId}'`),
    false,
    `dashboard/index.html should not embed literal project_id ${projectId}`,
  );
}
assert.doesNotMatch(
  dashboardSource,
  /project(?:Doc|Ref)?\.project_id\s*[!=]==?\s*["']/,
  "dashboard/index.html should not branch on literal project_id values",
);

let dashboardWeeklyBriefEntries = [];
try {
  dashboardWeeklyBriefEntries = await readdir(
    new URL("../dashboard/weekly-briefs/", import.meta.url),
    { withFileTypes: true },
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
assert.deepEqual(
  dashboardWeeklyBriefEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  [],
  "dashboard/weekly-briefs must not contain dated archive directories; overwrite weekly-briefs/index.html instead",
);
assert.match(
  await readFile(new URL("../weekly-briefs/index.html", import.meta.url), "utf8"),
  /Weekly Brief/i,
  "weekly brief must have a single canonical root entry at weekly-briefs/index.html",
);

const legacyDeletedPaths = [
  "assets/img/clock/embodied-clock-rail-train.png",
  "assets/img/timeline/hci-lab.png",
  "assets/img/timeline/mpi.png",
  "assets/pdf/education/mpi-cert.pdf",
  "assets/pdf/education/mpi-invitation.pdf",
  "latex/main.pdf",
  "latex/main-full.pdf",
];
for (const legacyPath of legacyDeletedPaths) {
  await assert.rejects(
    readFile(new URL(`../${legacyPath}`, import.meta.url)),
    (error) => error.code === "ENOENT",
    `${legacyPath} is a deleted legacy artifact and should not be restored`,
  );
}

const legacyReferenceSources = [
  dashboardSource,
  await readFile(new URL("../content/timeline.json", import.meta.url), "utf8"),
  await readFile(new URL("../latex/main.tex", import.meta.url), "utf8"),
  await readFile(new URL("../index.html", import.meta.url), "utf8"),
  await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8"),
  await readFile(new URL("../clock/index.html", import.meta.url), "utf8"),
].join("\n");
assert.doesNotMatch(
  legacyReferenceSources,
  /Max Planck|Human Computer Interaction|HCI Lab|hci\.cs|assets\/img\/timeline\/(?:hci-lab|mpi)\.png|assets\/pdf\/education\/mpi-|main(?:-full)?\.pdf|dashboard\/weekly-briefs\/20\d{2}/,
  "legacy portfolio paths and removed MPI/HCI content must not be referenced",
);
const homepageSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
assert.match(
  homepageSource,
  /assets\/js\/main\.js\?v=20260612-legacy-cleanup/,
  "homepage must version main.js so removed timeline items are not revived by browser cache",
);
assert.doesNotMatch(
  homepageSource,
  /<script src="assets\/js\/main\.js"><\/script>/,
  "homepage must not load an unversioned main.js",
);
assert.match(
  await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8"),
  /SITE_ASSET_VERSION = '20260612-legacy-cleanup'[\s\S]+fetch\(versionedUrl\)/,
  "main.js must version JSON content fetches so stale timeline data is not reused",
);

const fixedDate = new Date("2026-05-26T00:00:00.000Z");
assert.equal(makeTaskId("Demo Project", "Add TODO", new Set(), fixedDate), "task_demo_project_add_todo_20260526");
assert.equal(
  makeTaskId("Demo Project", "Add TODO", new Set(["task_demo_project_add_todo_20260526"]), fixedDate),
  "task_demo_project_add_todo_20260526_2",
);
const madeTask = makeTask({
  project_id: "demo",
  title: "Done task",
  status: "done",
  priority: "high",
}, new Set(), fixedDate);
assert.equal(madeTask.completed_at, "2026-05-26");
assert.equal(madeTask.priority, "high");
assert.equal(validateTaskPriority("urgent"), "urgent");
const localUpdate = applyTaskStatus(madeTask, "active", new Date("2026-05-26T01:00:00.000Z"));
assert.equal(madeTask.status, "active");
assert.equal(localUpdate.completed_at, null);

const tempDir = await mkdtemp(path.join(tmpdir(), "dashboard-task-store-"));
try {
  const tempTasksPath = path.join(tempDir, "tasks.json");
  await writeFile(tempTasksPath, `${JSON.stringify({
    schema_version: "tasks.v1",
    updated_at: "2026-05-25T00:00:00.000Z",
    tasks: [{
      task_id: "task_demo_existing",
      project_id: "demo",
      title: "Existing",
      description: "",
      status: "todo",
      priority: "medium",
      assignee: null,
      result: null,
      comments: [],
      updated_at: "2026-05-25T00:00:00.000Z",
    }],
  }, null, 2)}\n`);

  await updateLocalTaskStatus("task_demo_existing", "done", {
    filePath: tempTasksPath,
    now: new Date("2026-05-26T02:00:00.000Z"),
  });
  const statusDoc = JSON.parse(await readFile(tempTasksPath, "utf8"));
  assert.equal(statusDoc.updated_at, "2026-05-26T02:00:00.000Z");
  assert.equal(statusDoc.tasks[0].completed_at, "2026-05-26");

  await appendLocalTaskComment(
    "task_demo_existing",
    makeTaskComment("task_demo_existing", "Comment", "Test", new Date("2026-05-26T03:00:00.000Z")),
    { filePath: tempTasksPath },
  );
  const commentDoc = JSON.parse(await readFile(tempTasksPath, "utf8"));
  assert.equal(commentDoc.updated_at, "2026-05-26T03:00:00.000Z");
  assert.equal(commentDoc.tasks[0].comments.length, 1);

  await appendLocalTaskComment(
    "task_demo_existing",
    {
      comment_id: commentDoc.tasks[0].comments[0].comment_id,
      task_id: "task_demo_existing",
      author: "Test",
      kind: "comment",
      body: "Duplicate",
      created_at: "2026-05-26T02:30:00.000Z",
    },
    { filePath: tempTasksPath },
  );
  const duplicateDoc = JSON.parse(await readFile(tempTasksPath, "utf8"));
  assert.equal(duplicateDoc.updated_at, "2026-05-26T03:00:00.000Z");
  assert.equal(duplicateDoc.tasks[0].comments.length, 1);

  await assert.rejects(
    appendLocalTaskComment(
      "task_demo_existing",
      {
        comment_id: "comment_wrong_task",
        task_id: "task_other",
        author: "Test",
        kind: "comment",
        body: "Wrong task",
        created_at: "2026-05-26T03:30:00.000Z",
      },
      { filePath: tempTasksPath },
    ),
    /belongs to task_other, not task_demo_existing/,
  );

  const urgentTask = await createLocalTask({
    project_id: "demo",
    title: "Urgent task",
    priority: "urgent",
  }, {
    filePath: tempTasksPath,
    now: new Date("2026-05-26T04:00:00.000Z"),
  });
  assert.equal(urgentTask.priority, "urgent");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

const syncFixture = {
  portfolio: {
    portfolio_id: "demo-dashboard",
    title: "Demo",
    project_buckets: [{ bucket: "research" }],
  },
  projects: [{
    ref: { project_id: "demo", bucket: "research", status: "ongoing" },
    sort_order: 0,
    doc: {
      project_id: "demo",
      title: "Demo",
      bucket: "research",
      status: "ongoing",
      description: "Demo project",
    },
  }],
  tasks: [{
    task_id: "task_demo",
    project_id: "demo",
    title: "Demo task",
    description: "Task",
    status: "todo",
    priority: "medium",
    comments: [{ comment_id: "comment_demo", body: "Keep this", kind: "comment" }],
  }],
};
const firstPlan = buildSyncPlan(syncFixture, {}, {});
assert.equal(firstPlan.events.length, 4);
assert.deepEqual(firstPlan.counts, {
  portfolio_upserted: 1,
  projects_upserted: 1,
  tasks_upserted: 1,
  comments_upserted: 1,
});
const secondPlan = buildSyncPlan(syncFixture, {}, { row_hashes: firstPlan.row_hashes });
assert.equal(secondPlan.events.length, 0);
const changedFixture = structuredClone(syncFixture);
changedFixture.tasks[0].status = "active";
const changedPlan = buildSyncPlan(changedFixture, {}, { row_hashes: firstPlan.row_hashes });
assert.deepEqual(changedPlan.events.map((event) => event.action), ["task_upsert"]);
assert.equal(
  eventHash({ action: "task_upsert", skip_event_log: true, payload: { value: 1 } }),
  eventHash({ action: "task_upsert", skip_event_log: false, payload: { value: 1 } }),
);

console.log("dashboard-state-lib tests passed");
