import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dashboardDir = path.join(repoRoot, "dashboard");
const stateDir = path.join(dashboardDir, "state");
const supabaseUrl = process.env.SUPABASE_URL || "https://xhdvhixwbkfsgvgkmgmu.supabase.co";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceRoleKey) {
  throw new Error("Set SUPABASE_SERVICE_ROLE_KEY in your shell before importing state.");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function upsert(table, rows, conflictKey) {
  if (!rows.length) {
    return;
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?on_conflict=${conflictKey}`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    throw new Error(`${table} import failed: ${response.status} ${await response.text()}`);
  }
  console.log(`imported ${rows.length} ${table}`);
}

function normalizeCommentKind(kind) {
  const value = String(kind || "comment").trim();
  const aliases = {
    progress: "comment",
    conductor_reply: "comment",
    conductor_note: "comment",
    blocker_resolved: "comment",
    host_verified: "verification",
  };
  return aliases[value] || value || "comment";
}

function isNoisyHarnessComment(comment) {
  const kind = String(comment.kind || "").trim();
  const body = String(comment.body || "").trim();
  if (["conductor_reply", "conductor_note"].includes(kind)) return true;
  if (body.startsWith("本机主控已向远端 session")) return true;
  if (body.startsWith("本机主控拦截到疑似危险输入请求")) return true;
  if (body.includes("session_") && (body.includes("本机主控") || body.includes("ClawCross"))) return true;
  return false;
}

function statePathToFile(statePath) {
  return path.join(repoRoot, statePath);
}

const portfolio = await readJson(path.join(stateDir, "portfolio.json"));
const projectRefs = portfolio.projects || [];
const projectDocs = await Promise.all(projectRefs.map((project) => readJson(statePathToFile(project.state_path))));
const taskDoc = await readJson(path.join(stateDir, "tasks.json"));

await upsert("portfolio_snapshots", [{
  portfolio_id: portfolio.portfolio_id,
  title: portfolio.title,
  subtitle: portfolio.subtitle || null,
  week: portfolio.week,
  report_date: portfolio.date || null,
  summary: portfolio.summary || {},
  storyline: portfolio.storyline || {},
  visual_references: portfolio.visual_references || [],
  weekly_briefs: portfolio.weekly_briefs || [],
  project_buckets: portfolio.project_buckets || [],
  rules: portfolio.rules || [],
  timeline_policy: portfolio.timeline_policy || {},
  source_updated_at: portfolio.updated_at || null,
}], "portfolio_id");

await upsert("projects", projectDocs.map((project, index) => ({
  project_id: project.project_id,
  title: project.title,
  bucket: project.bucket,
  status: project.status,
  description: project.description,
  summary: project.summary,
  asset: project.asset || null,
  asset_alt: project.asset_alt || null,
  asset_caption: project.asset_caption || null,
  visual: project.visual || null,
  details: project.details || [],
  timeline: project.timeline || null,
  risks_decisions: project.risks_decisions || [],
  sort_order: index,
  source_updated_at: project.updated_at || null,
})), "project_id");

await upsert("project_references", projectDocs.flatMap((project) => (
  (project.references || []).map((reference, index) => ({
    project_id: project.project_id,
    title: reference.title || reference.arxiv_id || reference.url,
    url: reference.url || null,
    arxiv_id: reference.arxiv_id || null,
    submitted_at: reference.submitted_at || null,
    notes: reference.notes || null,
    sort_order: index,
  }))
)), "project_id,title");

await upsert("tasks", taskDoc.tasks.map((task, index) => ({
  task_id: task.task_id,
  project_id: task.project_id,
  title: task.title,
  description: task.description || null,
  status: task.status,
  priority: task.priority || "medium",
  assignee: task.assignee || null,
  due_at: task.due_at || null,
  completed_at: task.completed_at || null,
  sort_order: index,
  payload: {
    source: "dashboard/state/tasks.json",
  },
  source_updated_at: task.updated_at || null,
})), "task_id");

await upsert("task_comments", taskDoc.tasks.flatMap((task) => (
  (task.comments || []).filter((comment) => !isNoisyHarnessComment(comment)).map((comment) => ({
    comment_id: comment.comment_id,
    task_id: task.task_id,
    author: comment.author,
    author_type: "seed",
    kind: normalizeCommentKind(comment.kind),
    body: comment.body,
    created_at: comment.created_at,
  }))
)), "comment_id");
