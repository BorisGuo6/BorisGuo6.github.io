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
  deleteLocalTaskComment,
  makeTask,
  makeTaskComment,
  makeTaskId,
  updateLocalTaskStatus,
  validateTaskPriority,
} from "../scripts/dashboard-task-store.mjs";
import {
  appendSnapshotAuditEvent,
  applySnapshotTaskComment,
  applySnapshotTaskCommentDelete,
  applySnapshotTaskCreate,
  applySnapshotTaskStatus,
  applySnapshotTaskUpdate,
  dashboardStateToSnapshot,
  normalizeDashboardSnapshot,
  serializeDashboardSnapshot,
  toDashboardStateResponse,
} from "../scripts/dashboard-state-snapshot.mjs";
import {
  dashboardCanWrite,
  dashboardProvidedWriteToken,
  dashboardTokenFingerprint,
  dashboardViewerForWriteToken,
  dashboardWriteTokenIsAllowed,
  dashboardWriteAuth,
  makeDashboardAuditEvent,
} from "../scripts/dashboard-vercel-api.mjs";
import {
  vercelBlobReadUrl,
} from "../scripts/dashboard-vercel-store.mjs";

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

const bundledSnapshot = dashboardStateToSnapshot(state, {
  now: new Date("2026-06-18T00:00:00.000Z"),
});
const bundledResponse = toDashboardStateResponse(bundledSnapshot);
assert.equal(bundledResponse.ok, true);
assert.equal(bundledResponse.portfolio.portfolio_id, state.portfolio.portfolio_id);
assert.equal(bundledResponse.projects.length, state.projects.length);
assert.equal(bundledResponse.taskDoc.tasks.length, state.tasks.length);
assert.equal(
  Object.prototype.hasOwnProperty.call(bundledResponse, "audit_log"),
  false,
  "normal dashboard state responses should not expose the write audit log",
);
assert.deepEqual(
  normalizeDashboardSnapshot({ data: bundledResponse }).taskDoc.tasks.length,
  state.tasks.length,
);
const auditEvent = makeDashboardAuditEvent({
  request: {
    method: "POST",
    url: "https://jingxiangguo.com/api/dashboard/task-status",
    headers: { "user-agent": "dashboard-test-agent" },
  },
  auth: { viewer: "Ziyang Meng" },
  token: "secret-dashboard-token",
  action: "task-status",
  payload: { task_id: "task_demo", status: "done" },
  now: new Date("2026-06-18T00:30:00.000Z"),
});
assert.equal(auditEvent.viewer, "Ziyang Meng");
assert.equal(auditEvent.action, "task-status");
assert.match(auditEvent.token_fingerprint, /^sha256:[a-f0-9]{16}$/);
assert.equal(JSON.stringify(auditEvent).includes("secret-dashboard-token"), false);
const auditedSnapshot = appendSnapshotAuditEvent(bundledSnapshot, auditEvent, { limit: 2 });
assert.equal(auditedSnapshot.audit_log.length, 1);
const serializedAuditSnapshot = normalizeDashboardSnapshot(JSON.parse(serializeDashboardSnapshot(auditedSnapshot)));
assert.equal(serializedAuditSnapshot.audit_log[0].audit_id, auditEvent.audit_id);
assert.equal(
  toDashboardStateResponse(serializedAuditSnapshot).audit_log,
  undefined,
  "audit_log should survive snapshot storage without leaking through public state",
);
const patchedSnapshot = applySnapshotTaskUpdate(bundledSnapshot, state.tasks[0].task_id, {
  title: "Updated dashboard task title",
  description: "Updated dashboard task description",
  priority: "high",
}, {
  now: new Date("2026-06-18T01:00:00.000Z"),
  source: "test",
});
assert.deepEqual(patchedSnapshot.update.changed_fields, ["title", "description", "priority"]);
assert.equal(patchedSnapshot.task.title, "Updated dashboard task title");
assert.equal(patchedSnapshot.task.description, "Updated dashboard task description");
assert.equal(patchedSnapshot.task.priority, "high");
assert.equal(patchedSnapshot.snapshot.taskDoc.updated_at, "2026-06-18T01:00:00.000Z");
assert.deepEqual(
  dashboardWriteAuth({ headers: {} }, {}),
  {
    ok: false,
    status: 503,
    error: "DASHBOARD_WRITE_TOKEN is not configured",
  },
);
assert.deepEqual(
  dashboardWriteAuth({ headers: { "x-dashboard-token": "wrong" } }, { DASHBOARD_WRITE_TOKEN: "right" }),
  {
    ok: false,
    status: 401,
    error: "Invalid dashboard write token",
  },
);
assert.deepEqual(
  dashboardWriteAuth({ headers: { authorization: "Bearer right" } }, { DASHBOARD_WRITE_TOKEN: "right" }),
  { ok: true, viewer: "boris" },
);
assert.deepEqual(
  dashboardWriteAuth(
    { headers: { "x-dashboard-token": "mapped-token" } },
    { DASHBOARD_WRITE_TOKEN_USERS: JSON.stringify({ "mapped-token": "jiahao chen" }) },
  ),
  { ok: true, viewer: "jiahao chen" },
);
assert.equal(
  dashboardViewerForWriteToken("mapped-token", {
    DASHBOARD_WRITE_TOKEN_USERS: JSON.stringify({ "mapped-token": "agent-a" }),
    DASHBOARD_WRITE_TOKEN: "right",
  }),
  "agent-a",
);
assert.equal(
  dashboardWriteTokenIsAllowed("mapped-token", {
    DASHBOARD_WRITE_TOKEN_USERS: JSON.stringify({ "mapped-token": "jiahao chen" }),
    DASHBOARD_WRITE_TOKEN: "right",
  }),
  true,
);
assert.equal(
  dashboardCanWrite({
    DASHBOARD_WRITE_TOKEN_USERS: JSON.stringify({ "mapped-token": "jiahao chen" }),
    BLOB_READ_WRITE_TOKEN: "blob",
  }),
  true,
  "mapped dashboard write tokens should make the hosted dashboard writable without the legacy single-token env",
);
assert.equal(dashboardCanWrite({ DASHBOARD_WRITE_TOKEN_USERS: "{}", BLOB_READ_WRITE_TOKEN: "blob" }), false);
assert.match(dashboardTokenFingerprint("mapped-token"), /^sha256:[a-f0-9]{16}$/);
assert.notEqual(dashboardTokenFingerprint("mapped-token"), dashboardTokenFingerprint("other-token"));
assert.equal(
  dashboardViewerForWriteToken("right", { DASHBOARD_WRITE_TOKEN: "right", DASHBOARD_WRITE_USER: "boris" }),
  "boris",
);
assert.equal(
  dashboardProvidedWriteToken({ headers: { "x-dashboard-token": "abc" } }),
  "abc",
);
assert.equal(
  dashboardProvidedWriteToken({ headers: { authorization: "Bearer abc" } }),
  "abc",
);
assert.equal(
  vercelBlobReadUrl({
    url: "https://example.com/current-dashboard.json",
    downloadUrl: "https://example.com/stale-signed-dashboard.json",
  }),
  "https://example.com/current-dashboard.json",
  "dashboard Blob reads should prefer the public pathname URL after overwrite writes",
);
assert.equal(
  vercelBlobReadUrl({
    downloadUrl: "https://example.com/private-dashboard.json",
  }),
  "https://example.com/private-dashboard.json",
  "dashboard Blob reads should still fall back to downloadUrl when no public URL exists",
);

const projectBucketNames = new Set((state.portfolio.project_buckets || []).map((bucket) => bucket.bucket));
assert.deepEqual(projectBucketNames, new Set(["research", "engineering", "survey", "archive"]));
for (const project of state.projects) {
  assert.ok(projectBucketNames.has(project.doc.bucket), `Unexpected project bucket ${project.doc.bucket}`);
  assert.notEqual(project.doc.bucket, "active", `Project bucket must not use TODO status name: ${project.doc.project_id}`);
}
const knownTaskIds = new Set(state.tasks.map((task) => task.task_id));
for (const project of state.projects) {
  for (const taskId of project.doc.task_ids || []) {
    assert.ok(knownTaskIds.has(taskId), `Project ${project.doc.project_id} references missing task_id ${taskId}`);
  }
}
assert.deepEqual(
  state.projects
    .filter((project) => (project.doc.task_ids || []).length > 0 && project.doc.hide_workstream)
    .map((project) => project.doc.project_id),
  [],
  "projects with explicit task_ids must keep their task workstream visible",
);

const dashboardSource = await readFile(new URL("../dashboard/index.html", import.meta.url), "utf8");
const agentsSource = await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");
const vercelApiSource = await readFile(new URL("../scripts/dashboard-vercel-api.mjs", import.meta.url), "utf8");
assert.match(
  dashboardSource,
  /function projectTasksFor\(/,
  "dashboard should resolve project tasks through a helper that can include explicit task_ids",
);
assert.match(
  dashboardSource,
  /const tasks = projectTasksFor\(projectDoc, taskDoc\.tasks\)/,
  "bucket task stats should include explicit project task_ids",
);
assert.match(
  dashboardSource,
  /sortTasks\(projectTasksFor\(projectDoc \|\| \{ project_id: projectId \}, tasks\)\)/,
  "project rendering should include explicit project task_ids",
);
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
assert.doesNotMatch(
  dashboardSource,
  /<script src="supabase-config\.js"><\/script>/,
  "dashboard must not load legacy Supabase config unless ?supabase=1 is requested",
);
assert.match(
  dashboardSource,
  /<base href="\/dashboard\/">[\s\S]+<link rel="stylesheet" href="print\.css">/,
  "dashboard must set a /dashboard/ base URL so Vercel clean URL /dashboard still resolves CSS, state, images, and legacy config under /dashboard/",
);
assert.match(
  dashboardSource,
  /function loadLegacySupabaseConfig\(\)/,
  "legacy Supabase mode should dynamically load its config",
);
assert.doesNotMatch(
  dashboardSource,
  /function (?:setSupabaseSyncStatus|isSupabaseWritable|insertSupabaseTask|updateSupabaseTaskStatus|insertSupabaseComment)\b/,
  "generic dashboard backend helpers should not keep Supabase-prefixed names",
);
assert.match(
  dashboardSource,
  /function setDashboardBackendSyncStatus\(\)/,
  "dashboard should expose generic backend sync status naming",
);
assert.match(
  dashboardSource,
  /task-update/,
  "dashboard should include task-update in the copied agent prompt",
);
assert.match(
  dashboardSource,
  /task-comment-delete/,
  "dashboard should route comment deletion through a hosted/local API endpoint",
);
assert.match(
  vercelApiSource,
  /handleDashboardAuditLog/,
  "Vercel dashboard API should expose a token-protected audit log endpoint",
);
assert.match(
  vercelApiSource,
  /appendSnapshotAuditEvent\(result\.snapshot, auditEvent\)/,
  "Vercel dashboard writes should append an audit event before writing the Blob snapshot",
);
assert.match(
  vercelApiSource,
  /const author = optionalString\(auth\.viewer\) \|\| "Vercel dashboard"/,
  "dashboard comment authors should come from the token-bound viewer, not a client-provided author field",
);
assert.match(
  dashboardSource,
  /let vercelMutationQueue = Promise\.resolve\(\);/,
  "dashboard should keep hosted writes in a client-side queue so rapid TODO updates do not race the Blob snapshot",
);
assert.match(
  dashboardSource,
  /function enqueueVercelMutation\(operation\)/,
  "dashboard should expose a helper for serializing hosted write operations",
);
assert.match(
  dashboardSource,
  /return enqueueVercelMutation\(async \(\) => \{/,
  "dashboard hosted POSTs should be queued instead of sent in parallel",
);
assert.match(
  vercelApiSource,
  /let mutationQueue = Promise\.resolve\(\);/,
  "Vercel dashboard API should serialize same-instance Blob mutations",
);
assert.match(
  vercelApiSource,
  /mutationQueue = run\.catch\(\(\) => undefined\);/,
  "Vercel dashboard API mutation queue should continue after failed writes",
);
assert.doesNotMatch(
  dashboardSource,
  /page-agent|PageAgent|pageAgent|data-page-agent/i,
  "dashboard should not expose Page Agent controls or load the Page Agent bundle",
);
assert.match(
  dashboardSource,
  /milestone\.title, milestone\.label, milestone\.name, milestone\.summary, milestone\.note/,
  "dashboard timeline chips should support current milestone label/name/summary/note fields, not only legacy title fields",
);
assert.match(
  dashboardSource,
  /subproject\.title, subproject\.name, subproject\.id[\s\S]+subproject\.body, subproject\.summary, subproject\.note[\s\S]+subproject\.output, subproject\.deliverable, subproject\.status/,
  "dashboard subproject cards should support current name/summary/status fields, not only legacy title/body/output fields",
);
assert.match(
  dashboardSource,
  /function createReferenceItem\(reference, index\)/,
  "dashboard should render project-level knowledge-base reference links",
);
assert.match(
  dashboardSource,
  /function renderProjectReferences\(projectElement, references\)/,
  "dashboard should expose a project reference panel renderer",
);
assert.match(
  dashboardSource,
  /renderProjectReferences\(projectElement, projectDoc\.references\)/,
  "project rendering should bind projectDoc.references into the reference panel",
);
assert.match(
  dashboardSource,
  /reference\.title, reference\.label, reference\.url[\s\S]+reference\.notes, reference\.summary, reference\.reason/,
  "reference links should support title/label/url and notes/summary/reason fields",
);
assert.match(
  dashboardSource,
  /data-agent-prompt-copy/,
  "dashboard should expose a copy button for agent task-update prompts",
);
assert.match(
  dashboardSource,
  /function dashboardAgentPromptText\(\)/,
  "dashboard should generate the agent task-update prompt client-side",
);
assert.match(
  dashboardSource,
  /class="dashboard-locked"/,
  "dashboard should start behind a locked pre-read access gate",
);
assert.match(
  dashboardSource,
  /data-dashboard-access-form[\s\S]+DASHBOARD_WRITE_TOKEN[\s\S]+auth\.viewer[\s\S]+validateDashboardAccess/,
  "dashboard should validate the token and use the token-bound viewer before loading readable state",
);
assert.match(
  dashboardSource,
  /vercelTokenStorageKey = "dashboard\.vercel-write-token\.v2"[\s\S]+function readVercelWriteToken\(\)[\s\S]+initDashboardAccessGate\(\)/,
  "dashboard should persist successful token login and retry it on the next visit",
);
assert.doesNotMatch(
  dashboardSource,
  /name="viewer"|elements\.viewer/,
  "dashboard viewer identity must be bound to the token, not entered by the visitor",
);
assert.match(
  dashboardSource,
  /dashboard-access-icon[\s\S]+Dashboard Token[\s\S]+Paste token[\s\S]+Unlock/,
  "dashboard access gate should be a compact token login form",
);
assert.doesNotMatch(
  dashboardSource,
  /Vercel Dashboard Access|输入写入 Token 后读取 Dashboard|验证通过后才加载项目状态|Unlock Dashboard/,
  "dashboard access gate should not include long explanatory login copy",
);
assert.match(
  dashboardSource,
  /data-dashboard-watermark[\s\S]+function updateDashboardWatermark\(\)/,
  "dashboard should render a user-specific full-screen watermark after unlock",
);
assert.match(
  dashboardSource,
  /# Dashboard Backend Write Token[\s\S]+更新时间：2026-06-18 20:30 Asia\/Shanghai[\s\S]+删除评论 endpoint[\s\S]+访问者身份由后端根据 token 绑定返回/,
  "dashboard copied agent prompt should use the requested Chinese write-token prompt and token-bound viewer rule",
);
assert.doesNotMatch(
  dashboardSource,
  /每个 agent\/user 使用自己的 token|不要复用 boris token/,
  "dashboard copied agent prompt should not include multi-user token language for a private single-user token",
);
assert.match(
  dashboardSource,
  /localStorage\.setItem\(vercelTokenStorageKey, vercelWriteToken\)[\s\S]+localStorage\.removeItem\(vercelTokenStorageKey\)/,
  "dashboard should persist the token locally and clear it on lock or invalidation",
);
assert.doesNotMatch(
  dashboardSource,
  /\b[a-f0-9]{64}\b/i,
  "dashboard source must not hardcode a long write-token-like secret",
);
assert.match(
  dashboardSource,
  /function selectionIntersectsElement\(/,
  "dashboard collapsible text should detect active text selection before toggling",
);
assert.match(
  dashboardSource,
  /function shouldIgnoreTextToggleClick\(/,
  "dashboard collapsible text should ignore selection/drag clicks so copying expanded text does not collapse it",
);
assert.match(
  dashboardSource,
  /pointerMovedDuringTextToggle\(event, element\) \|\| selectionIntersectsElement\(element\)/,
  "dashboard text collapse click guard should treat pointer drag and selected text as non-toggle interactions",
);
assert.match(
  dashboardSource,
  /function sortCompletedTasks\(tasks\)[\s\S]+completedTaskSortValue\(b\) - completedTaskSortValue\(a\)/,
  "dashboard archive task list should sort completed tasks by latest completion time first",
);
assert.match(
  dashboardSource,
  /const completedTasks = sortCompletedTasks\(projectTasks\.filter\(\(task\) => getEffectiveStatus\(task\) === "done"\)\)/,
  "project archive should render completed tasks through the completion-time sorter",
);
assert.match(
  dashboardSource,
  /api\/dashboard\/state/,
  "dashboard agent prompt should point agents at the machine-readable state endpoint",
);
assert.match(
  agentsSource,
  /https:\/\/jingxiangguo\.com\/api\/dashboard\/state/,
  "AGENTS.md should tell agents where to read dashboard task state",
);
assert.match(
  agentsSource,
  /DASHBOARD_WRITE_TOKEN[\s\S]+task-update[\s\S]+task-status[\s\S]+task-comment/,
  "AGENTS.md should document token-gated task update, status, and comment writes",
);
assert.match(
  JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).scripts["vercel:seed-blob"],
  /seed-vercel-dashboard-blob\.mjs/,
  "Vercel Blob seed script should be available",
);
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
assert.match(
  packageJson.scripts["vercel:pull-blob"],
  /pull-vercel-dashboard-blob\.mjs/,
  "Vercel Blob pull script should be available so local state mirrors hosted state",
);
assert.match(
  await readFile(new URL("../scripts/seed-vercel-dashboard-blob.mjs", import.meta.url), "utf8"),
  /Refusing to overwrite Vercel Blob from local JSON without --force/,
  "Vercel Blob seed script should refuse accidental local-to-remote overwrites",
);
assert.match(
  agentsSource,
  /Vercel Blob is the mutable source of truth[\s\S]+vercel:pull-blob[\s\S]+Do not use `npm run vercel:seed-blob`/,
  "AGENTS.md should document remote-first dashboard sync",
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
  "clock/index.html",
  "assets/img/clock/embodied-clock-rail-train.png",
  "assets/img/clock/embodied-clock-rail-train-v2.png",
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

const timelineSource = await readFile(new URL("../content/timeline.json", import.meta.url), "utf8");
const homepageSource = await readFile(new URL("../index.html", import.meta.url), "utf8");
const mainJsSource = await readFile(new URL("../assets/js/main.js", import.meta.url), "utf8");
const latexSource = await readFile(new URL("../latex/main.tex", import.meta.url), "utf8");
const legacyReferenceSources = [
  dashboardSource,
  timelineSource,
  latexSource,
  homepageSource,
  mainJsSource,
].join("\n");
assert.doesNotMatch(
  legacyReferenceSources,
  /Max Planck|Human Computer Interaction|HCI Lab|hci\.cs|clock\/|assets\/img\/clock\/|assets\/img\/timeline\/(?:hci-lab|mpi)\.png|assets\/pdf\/education\/mpi-|main(?:-full)?\.pdf|dashboard\/weekly-briefs\/20\d{2}/,
  "legacy portfolio paths and removed MPI/HCI content must not be referenced",
);
assert.match(
  homepageSource,
  /assets\/js\/main\.js\?v=robot-link-removed-20260703/,
  "homepage must version main.js so removed timeline items are not revived by browser cache",
);
assert.match(
  homepageSource,
  /<li id="news-phd-offer" style="display:none;">/,
  "PhD offer news must be hidden in initial minimal-mode HTML, not only after JavaScript runs",
);
assert.match(
  homepageSource,
  /id="visitor-map-fallback"[\s\S]*?hidden/,
  "visitor map fallback must start hidden so it does not flash beside the injected map",
);
assert.doesNotMatch(
  homepageSource,
  /clustrmaps|clustrmap/i,
  "homepage must not keep old ClustrMaps embeds after switching visitor map providers",
);
assert.doesNotMatch(
  homepageSource,
  /<script src="assets\/js\/main\.js"><\/script>/,
  "homepage must not load an unversioned main.js",
);
assert.match(
  mainJsSource,
  /SITE_ASSET_VERSION = 'robot-link-removed-20260703'[\s\S]+fetch\(versionedUrl\)/,
  "main.js must version JSON content fetches so stale timeline data is not reused",
);
assert.doesNotMatch(
  mainJsSource,
  /page-agent|PageAgent|pageAgent/i,
  "homepage main.js must not load Page Agent",
);
assert.doesNotMatch(
  homepageSource,
  /Page Agent|page-agent/i,
  "homepage must not expose Page Agent controls",
);
const timelineDoc = JSON.parse(timelineSource);
const nusPhdItem = timelineDoc.edu.find((item) => item.id === "tl-nus-phd");
const lvLabItem = timelineDoc.res.find((item) => item.id === "tl-lv-lab");
assert.deepEqual(
  { sy: nusPhdItem.sy, sm: nusPhdItem.sm, dates: timelineDoc.details["tl-nus-phd"].dates },
  { sy: 2026, sm: 5, dates: "2026.05 - Present" },
  "NUS PhD should fill the removed MPI timeline gap from 2026.05 onward",
);
assert.deepEqual(
  { sy: lvLabItem.sy, sm: lvLabItem.sm, dates: timelineDoc.details["tl-lv-lab"].dates },
  { sy: 2026, sm: 5, dates: "2026.05 - Present" },
  "LV-Lab should fill the removed HCI Lab timeline gap from 2026.05 onward",
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
assert.equal(madeTask.completed_at_time, "2026-05-26T00:00:00.000Z");
assert.equal(madeTask.priority, "high");
assert.equal(validateTaskPriority("urgent"), "urgent");
const localUpdate = applyTaskStatus(madeTask, "active", new Date("2026-05-26T01:00:00.000Z"));
assert.equal(madeTask.status, "active");
assert.equal(localUpdate.completed_at, null);
assert.equal(localUpdate.completed_at_time, null);

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
  assert.equal(statusDoc.tasks[0].completed_at_time, "2026-05-26T02:00:00.000Z");

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

  const deletedLocalComment = await deleteLocalTaskComment(
    "task_demo_existing",
    commentDoc.tasks[0].comments[0].comment_id,
    {
      filePath: tempTasksPath,
      now: new Date("2026-05-26T03:15:00.000Z"),
    },
  );
  const deletedLocalDoc = JSON.parse(await readFile(tempTasksPath, "utf8"));
  assert.equal(deletedLocalComment.body, "Comment");
  assert.equal(deletedLocalDoc.updated_at, "2026-05-26T03:15:00.000Z");
  assert.equal(deletedLocalDoc.tasks[0].comments.length, 0);

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
const syncSnapshot = normalizeDashboardSnapshot({
  portfolio: syncFixture.portfolio,
  projects: syncFixture.projects.map((project) => project.doc),
  taskDoc: {
    schema_version: "tasks.v1",
    updated_at: "2026-05-25T00:00:00.000Z",
    tasks: structuredClone(syncFixture.tasks),
  },
});
const statusSnapshot = applySnapshotTaskStatus(
  syncSnapshot,
  "task_demo",
  "done",
  { now: new Date("2026-06-18T01:00:00.000Z") },
).snapshot;
assert.equal(statusSnapshot.taskDoc.tasks[0].status, "done");
assert.equal(statusSnapshot.taskDoc.tasks[0].completed_at, "2026-06-18");
assert.equal(statusSnapshot.taskDoc.tasks[0].completed_at_time, "2026-06-18T01:00:00.000Z");
assert.equal(statusSnapshot.taskDoc.updated_at, "2026-06-18T01:00:00.000Z");

const comment = makeTaskComment("task_demo", "Vercel comment", "Vercel dashboard", new Date("2026-06-18T02:00:00.000Z"));
const commentSnapshot = applySnapshotTaskComment(statusSnapshot, "task_demo", comment).snapshot;
assert.equal(commentSnapshot.taskDoc.tasks[0].comments.length, 2);
assert.equal(commentSnapshot.taskDoc.updated_at, "2026-06-18T02:00:00.000Z");

const deletedCommentSnapshot = applySnapshotTaskCommentDelete(commentSnapshot, "task_demo", comment.comment_id, {
  now: new Date("2026-06-18T02:30:00.000Z"),
}).snapshot;
assert.deepEqual(
  deletedCommentSnapshot.taskDoc.tasks[0].comments.map((candidate) => candidate.comment_id),
  ["comment_demo"],
);
assert.equal(deletedCommentSnapshot.taskDoc.updated_at, "2026-06-18T02:30:00.000Z");
await assert.rejects(
  async () => applySnapshotTaskCommentDelete(deletedCommentSnapshot, "task_demo", comment.comment_id),
  /Comment not found/,
);

const createdSnapshot = applySnapshotTaskCreate(commentSnapshot, {
  project_id: "demo",
  title: "Vercel TODO",
  priority: "urgent",
}, {
  now: new Date("2026-06-18T03:00:00.000Z"),
}).snapshot;
assert.equal(createdSnapshot.taskDoc.tasks.at(-1).task_id, "task_demo_vercel_todo_20260618");
assert.equal(createdSnapshot.taskDoc.tasks.at(-1).priority, "urgent");

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
