import { createHash } from "node:crypto";
import {
  dashboardTaskComments,
  managedTaskSource,
} from "./dashboard-state-lib.mjs";

export function stableHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function eventHash(event) {
  const { skip_event_log, ...hashableEvent } = event;
  return stableHash(hashableEvent);
}

export function emptyRowHashes() {
  return {
    portfolio: {},
    projects: {},
    tasks: {},
    comments: {},
  };
}

export function changed(cache, section, key, hash, force = false) {
  if (force) {
    return true;
  }
  return cache?.row_hashes?.[section]?.[key] !== hash;
}

export function buildPortfolioEvent(state) {
  return {
    action: "portfolio_update",
    agent_id: "dashboard-supabase-sync",
    skip_event_log: true,
    portfolio_id: state.portfolio.portfolio_id,
    title: state.portfolio.title,
    payload: {
      portfolio_id: state.portfolio.portfolio_id,
      title: state.portfolio.title,
      subtitle: state.portfolio.subtitle || null,
      week: state.portfolio.week,
      report_date: state.portfolio.date || null,
      summary: state.portfolio.summary || {},
      storyline: state.portfolio.storyline || {},
      visual_references: state.portfolio.visual_references || [],
      weekly_briefs: state.portfolio.weekly_briefs || [],
      project_buckets: state.portfolio.project_buckets || [],
      rules: state.portfolio.rules || [],
      timeline_policy: state.portfolio.timeline_policy || {},
      source_updated_at: state.portfolio.updated_at || null,
    },
  };
}

export function buildProjectEvent(project) {
  const doc = project.doc;
  return {
    action: "project_upsert",
    agent_id: "dashboard-supabase-sync",
    skip_event_log: true,
    project_id: doc.project_id,
    title: doc.title,
    description: doc.description,
    status: doc.status,
    payload: {
      title: doc.title,
      bucket: doc.bucket || project.ref.bucket || "research",
      status: doc.status || project.ref.status || "ongoing",
      description: doc.description || "",
      summary: doc.summary || "",
      asset: doc.asset || null,
      asset_alt: doc.asset_alt || null,
      asset_caption: doc.asset_caption || null,
      visual: doc.visual || null,
      details: doc.details || [],
      timeline: doc.timeline || null,
      risks_decisions: doc.risks_decisions || [],
      sort_order: project.sort_order,
      source_updated_at: doc.updated_at || null,
    },
  };
}

export function buildTaskEvent(task, sortOrder) {
  return {
    action: "task_upsert",
    agent_id: "dashboard-supabase-sync",
    skip_event_log: true,
    project_id: task.project_id,
    task_id: task.task_id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority || "medium",
    payload: {
      assignee: task.assignee,
      due_at: task.due_at,
      completed_at: task.completed_at,
      source_updated_at: task.updated_at,
      sort_order: sortOrder,
      payload: { source: managedTaskSource },
    },
  };
}

export function buildCommentEvent(comment) {
  return {
    action: "task_comment",
    agent_id: "dashboard-supabase-sync",
    skip_event_log: true,
    task_id: comment.task_id,
    comment_id: comment.comment_id,
    kind: comment.kind,
    comment: comment.body,
    payload: {
      author: comment.author,
      created_at: comment.created_at,
    },
  };
}

function rememberEvent(plan, section, key, event, force) {
  const hash = eventHash(event);
  plan.row_hashes[section][key] = hash;
  if (changed(plan.cache, section, key, hash, force)) {
    plan.events.push(event);
    plan.counts[`${section}_upserted`] += 1;
  }
}

export function buildSyncPlan(state, options = {}, cache = {}) {
  const projectFilter = options.projectId || "";
  const tasks = projectFilter
    ? state.tasks.filter((task) => task.project_id === projectFilter)
    : state.tasks;
  const plan = {
    cache,
    events: [],
    row_hashes: emptyRowHashes(),
    tasks,
    counts: {
      portfolio_upserted: 0,
      projects_upserted: 0,
      tasks_upserted: 0,
      comments_upserted: 0,
    },
  };

  rememberEvent(plan, "portfolio", state.portfolio.portfolio_id, buildPortfolioEvent(state), options.force);
  for (const project of state.projects) {
    rememberEvent(plan, "projects", project.doc.project_id, buildProjectEvent(project), options.force);
  }
  tasks.forEach((task, sortOrder) => {
    rememberEvent(plan, "tasks", task.task_id, buildTaskEvent(task, sortOrder), options.force);
    dashboardTaskComments(task).forEach((comment) => {
      rememberEvent(plan, "comments", comment.comment_id, buildCommentEvent(comment), options.force);
    });
  });

  delete plan.cache;
  return plan;
}
