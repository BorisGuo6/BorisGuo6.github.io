import {
  dashboardHash,
  dashboardTaskComments,
  loadDashboardState,
  managedAuthorTypes,
  managedTaskSource,
  makeSupabaseSyncClient,
  readEnvFile,
} from "./dashboard-state-lib.mjs";

function parseArgs(argv) {
  const options = {
    watch: false,
    interval: 60,
    once: false,
    deleteStale: true,
    projectId: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--watch") options.watch = true;
    else if (arg === "--once") options.once = true;
    else if (arg === "--no-delete-stale") options.deleteStale = false;
    else if (arg === "--interval") options.interval = Number(argv[++index] || options.interval);
    else if (arg.startsWith("--interval=")) options.interval = Number(arg.split("=", 2)[1] || options.interval);
    else if (arg === "--project-id") options.projectId = argv[++index] || "";
    else if (arg.startsWith("--project-id=")) options.projectId = arg.split("=", 2)[1] || "";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  options.interval = Number.isFinite(options.interval) && options.interval > 0 ? options.interval : 60;
  return options;
}

async function syncOnce(client, options) {
  const state = await loadDashboardState();
  const tasks = options.projectId
    ? state.tasks.filter((task) => task.project_id === options.projectId)
    : state.tasks;

  await client.event({
    action: "portfolio_update",
    agent_id: "dashboard-supabase-sync",
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
  });

  for (const project of state.projects) {
    const doc = project.doc;
    await client.event({
      action: "project_upsert",
      agent_id: "dashboard-supabase-sync",
      project_id: doc.project_id,
      title: doc.title,
      description: doc.description,
      status: doc.status,
      payload: {
        title: doc.title,
        bucket: doc.bucket || project.ref.bucket || "active",
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
    });
  }

  let commentsUpserted = 0;
  let commentsDeleted = 0;
  let tasksDeleted = 0;
  for (const [sortOrder, task] of tasks.entries()) {
    await client.event({
      action: "task_upsert",
      agent_id: "dashboard-supabase-sync",
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
    });

    const comments = dashboardTaskComments(task);
    const localCommentIds = new Set(comments.map((comment) => comment.comment_id));
    if (options.deleteStale) {
      const remoteComments = await client.rest(`task_comments?select=comment_id,author_type&task_id=eq.${encodeURIComponent(task.task_id)}`);
      for (const remoteComment of remoteComments) {
        if (managedAuthorTypes.has(remoteComment.author_type) && !localCommentIds.has(remoteComment.comment_id)) {
          await client.event({
            action: "comment_delete",
            agent_id: "dashboard-supabase-sync",
            task_id: task.task_id,
            comment_id: remoteComment.comment_id,
          });
          commentsDeleted += 1;
        }
      }
    }

    for (const comment of comments) {
      await client.event({
        action: "task_comment",
        agent_id: "dashboard-supabase-sync",
        task_id: comment.task_id,
        comment_id: comment.comment_id,
        kind: comment.kind,
        comment: comment.body,
        payload: {
          author: comment.author,
          created_at: comment.created_at,
        },
      });
      commentsUpserted += 1;
    }
  }

  if (options.deleteStale) {
    const projectIds = options.projectId
      ? [options.projectId]
      : state.projects.map((project) => project.doc.project_id);
    const localTaskIds = new Set(tasks.map((task) => task.task_id));
    for (const projectId of projectIds) {
      const remoteTasks = await client.rest(`tasks?select=task_id,payload&project_id=eq.${encodeURIComponent(projectId)}`);
      for (const remoteTask of remoteTasks) {
        if (
          !localTaskIds.has(remoteTask.task_id)
          && remoteTask.payload?.source === managedTaskSource
        ) {
          await client.event({
            action: "task_delete",
            task_id: remoteTask.task_id,
          });
          tasksDeleted += 1;
        }
      }
    }
  }

  return {
    portfolio: state.portfolio.portfolio_id,
    projects: state.projects.length,
    tasks: tasks.length,
    tasks_deleted: tasksDeleted,
    comments_upserted: commentsUpserted,
    comments_deleted: commentsDeleted,
    hash: await dashboardHash(state),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = await readEnvFile();
  const client = makeSupabaseSyncClient(env);
  let previousHash = "";

  while (true) {
    const state = await loadDashboardState();
    const currentHash = await dashboardHash(state);
    if (currentHash !== previousHash) {
      const summary = await syncOnce(client, options);
      previousHash = summary.hash;
      console.log(JSON.stringify({ ok: true, synced_at: new Date().toISOString(), ...summary }));
    } else {
      console.log(JSON.stringify({ ok: true, skipped: "unchanged", checked_at: new Date().toISOString(), hash: currentHash }));
    }
    if (options.once || !options.watch) break;
    await new Promise((resolve) => setTimeout(resolve, options.interval * 1000));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
