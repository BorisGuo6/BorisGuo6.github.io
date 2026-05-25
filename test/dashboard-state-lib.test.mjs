import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  dashboardHash,
  dashboardTaskComments,
  isNoisyHarnessComment,
  loadDashboardState,
  normalizeCommentKind,
} from "../scripts/dashboard-state-lib.mjs";

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

console.log("dashboard-state-lib tests passed");
