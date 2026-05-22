import { readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const stateDir = path.join(repoRoot, "dashboard/state");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function sql(value) {
  if (value === null || value === undefined) {
    return "null";
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonb(value) {
  return `${sql(JSON.stringify(value ?? null))}::jsonb`;
}

function timestamp(value) {
  return value ? `${sql(value)}::timestamptz` : "null";
}

function date(value) {
  return value ? `${sql(value)}::date` : "null";
}

function normalizeCommentKind(kind) {
  const value = String(kind || "comment").trim();
  const aliases = {
    progress: "comment",
    conductor_reply: "comment",
    conductor_note: "comment",
    blocker_resolved: "comment",
    review: "comment",
    artifact: "comment",
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

const portfolio = await readJson(path.join(stateDir, "portfolio.json"));
const tasks = await readJson(path.join(stateDir, "tasks.json"));
const projectDocs = await Promise.all((portfolio.projects || []).map((project) => (
  readJson(path.join(repoRoot, project.state_path))
)));

const lines = [
  "begin;",
  "",
  "insert into public.portfolio_snapshots (portfolio_id, title, subtitle, week, report_date, summary, storyline, visual_references, weekly_briefs, project_buckets, rules, timeline_policy, source_updated_at)",
  "values (",
  `  ${sql(portfolio.portfolio_id)},`,
  `  ${sql(portfolio.title)},`,
  `  ${sql(portfolio.subtitle)},`,
  `  ${sql(portfolio.week)},`,
  `  ${date(portfolio.date)},`,
  `  ${jsonb(portfolio.summary)},`,
  `  ${jsonb(portfolio.storyline)},`,
  `  ${jsonb(portfolio.visual_references)},`,
  `  ${jsonb(portfolio.weekly_briefs)},`,
  `  ${jsonb(portfolio.project_buckets)},`,
  `  ${jsonb(portfolio.rules)},`,
  `  ${jsonb(portfolio.timeline_policy)},`,
  `  ${timestamp(portfolio.updated_at)}`,
  ")",
  "on conflict (portfolio_id) do update set",
  "  title = excluded.title,",
  "  subtitle = excluded.subtitle,",
  "  week = excluded.week,",
  "  report_date = excluded.report_date,",
  "  summary = excluded.summary,",
  "  storyline = excluded.storyline,",
  "  visual_references = excluded.visual_references,",
  "  weekly_briefs = excluded.weekly_briefs,",
  "  project_buckets = excluded.project_buckets,",
  "  rules = excluded.rules,",
  "  timeline_policy = excluded.timeline_policy,",
  "  source_updated_at = excluded.source_updated_at;",
  "",
];

projectDocs.forEach((project, index) => {
  lines.push(
    "insert into public.projects (project_id, title, bucket, status, description, summary, asset, asset_alt, asset_caption, visual, details, timeline, risks_decisions, sort_order, source_updated_at)",
    "values (",
    `  ${sql(project.project_id)},`,
    `  ${sql(project.title)},`,
    `  ${sql(project.bucket)},`,
    `  ${sql(project.status)},`,
    `  ${sql(project.description)},`,
    `  ${sql(project.summary)},`,
    `  ${sql(project.asset)},`,
    `  ${sql(project.asset_alt)},`,
    `  ${sql(project.asset_caption)},`,
    `  ${project.visual ? jsonb(project.visual) : "null"},`,
    `  ${jsonb(project.details || [])},`,
    `  ${project.timeline ? jsonb(project.timeline) : "null"},`,
    `  ${jsonb(project.risks_decisions || [])},`,
    `  ${index},`,
    `  ${timestamp(project.updated_at)}`,
    ")",
    "on conflict (project_id) do update set",
    "  title = excluded.title,",
    "  bucket = excluded.bucket,",
    "  status = excluded.status,",
    "  description = excluded.description,",
    "  summary = excluded.summary,",
    "  asset = excluded.asset,",
    "  asset_alt = excluded.asset_alt,",
    "  asset_caption = excluded.asset_caption,",
    "  visual = excluded.visual,",
    "  details = excluded.details,",
    "  timeline = excluded.timeline,",
    "  risks_decisions = excluded.risks_decisions,",
    "  sort_order = excluded.sort_order,",
    "  source_updated_at = excluded.source_updated_at;",
    "",
  );

  (project.references || []).forEach((reference, referenceIndex) => {
    lines.push(
      "insert into public.project_references (project_id, title, url, arxiv_id, submitted_at, notes, sort_order)",
      "values (",
      `  ${sql(project.project_id)},`,
      `  ${sql(reference.title || reference.arxiv_id || reference.url)},`,
      `  ${sql(reference.url)},`,
      `  ${sql(reference.arxiv_id)},`,
      `  ${date(reference.submitted_at)},`,
      `  ${sql(reference.notes)},`,
      `  ${referenceIndex}`,
      ")",
      "on conflict (project_id, title) do update set",
      "  url = excluded.url,",
      "  arxiv_id = excluded.arxiv_id,",
      "  submitted_at = excluded.submitted_at,",
      "  notes = excluded.notes,",
      "  sort_order = excluded.sort_order;",
      "",
    );
  });
});

(tasks.tasks || []).forEach((task, index) => {
  lines.push(
    "insert into public.tasks (task_id, project_id, title, description, status, priority, assignee, due_at, completed_at, sort_order, payload, source_updated_at)",
    "values (",
    `  ${sql(task.task_id)},`,
    `  ${sql(task.project_id)},`,
    `  ${sql(task.title)},`,
    `  ${sql(task.description)},`,
    `  ${sql(task.status)},`,
    `  ${sql(task.priority || "medium")},`,
    `  ${sql(task.assignee)},`,
    `  ${date(task.due_at)},`,
    `  ${date(task.completed_at)},`,
    `  ${index},`,
    "  '{\"source\":\"dashboard/state/tasks.json\"}'::jsonb,",
    `  ${timestamp(task.updated_at)}`,
    ")",
    "on conflict (task_id) do update set",
    "  project_id = excluded.project_id,",
    "  title = excluded.title,",
    "  description = excluded.description,",
    "  status = excluded.status,",
    "  priority = excluded.priority,",
    "  assignee = excluded.assignee,",
    "  due_at = excluded.due_at,",
    "  completed_at = excluded.completed_at,",
    "  sort_order = excluded.sort_order,",
    "  payload = excluded.payload,",
    "  source_updated_at = excluded.source_updated_at;",
    "",
  );

  (task.comments || []).filter((comment) => !isNoisyHarnessComment(comment)).forEach((comment) => {
    lines.push(
      "insert into public.task_comments (comment_id, task_id, author, author_type, kind, body, created_at)",
      "values (",
      `  ${sql(comment.comment_id)},`,
      `  ${sql(task.task_id)},`,
      `  ${sql(comment.author)},`,
      "  'seed',",
      `  ${sql(normalizeCommentKind(comment.kind))},`,
      `  ${sql(comment.body)},`,
      `  ${timestamp(comment.created_at)}`,
      ")",
      "on conflict (comment_id) do update set",
      "  task_id = excluded.task_id,",
      "  author = excluded.author,",
      "  author_type = excluded.author_type,",
      "  kind = excluded.kind,",
      "  body = excluded.body;",
      "",
    );
  });
});

lines.push("commit;", "");
process.stdout.write(lines.join("\n"));
