import {
  dashboardHash,
  dashboardTaskComments,
  loadDashboardState,
  managedAuthorTypes,
  managedTaskSource,
  makeSupabaseSyncClient,
  readEnvFile,
} from "./dashboard-state-lib.mjs";
import {
  buildSyncPlan,
} from "./dashboard-sync-plan.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const cachePath = path.join(import.meta.dirname, "..", "tmp", "dashboard-supabase-sync-cache.json");

function parseArgs(argv) {
  const options = {
    watch: false,
    interval: 3600,
    once: false,
    deleteStale: false,
    force: false,
    projectId: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--watch") options.watch = true;
    else if (arg === "--once") options.once = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--delete-stale") options.deleteStale = true;
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

async function readSyncCache() {
  try {
    return JSON.parse(await readFile(cachePath, "utf8"));
  } catch {
    return {};
  }
}

async function writeSyncCache(cache) {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
}

async function syncOnce(client, options, cache = {}) {
  const state = await loadDashboardState();
  const plan = buildSyncPlan(state, options, cache);
  for (const event of plan.events) {
    await client.event(event);
  }

  let commentsDeleted = 0;
  let tasksDeleted = 0;
  for (const task of plan.tasks) {
    const comments = dashboardTaskComments(task);
    const localCommentIds = new Set(comments.map((comment) => comment.comment_id));
    if (options.deleteStale) {
      const remoteComments = await client.rest(`task_comments?select=comment_id,author_type&task_id=eq.${encodeURIComponent(task.task_id)}`);
      for (const remoteComment of remoteComments) {
        if (managedAuthorTypes.has(remoteComment.author_type) && !localCommentIds.has(remoteComment.comment_id)) {
          await client.event({
            action: "comment_delete",
            agent_id: "dashboard-supabase-sync",
            skip_event_log: true,
            task_id: task.task_id,
            comment_id: remoteComment.comment_id,
          });
          commentsDeleted += 1;
        }
      }
    }
  }

  if (options.deleteStale) {
    const projectIds = options.projectId
      ? [options.projectId]
      : state.projects.map((project) => project.doc.project_id);
    const localTaskIds = new Set(plan.tasks.map((task) => task.task_id));
    for (const projectId of projectIds) {
      const remoteTasks = await client.rest(`tasks?select=task_id,payload&project_id=eq.${encodeURIComponent(projectId)}`);
      for (const remoteTask of remoteTasks) {
        if (
          !localTaskIds.has(remoteTask.task_id)
          && remoteTask.payload?.source === managedTaskSource
        ) {
          await client.event({
            action: "task_delete",
            agent_id: "dashboard-supabase-sync",
            skip_event_log: true,
            task_id: remoteTask.task_id,
          });
          tasksDeleted += 1;
        }
      }
    }
  }

  return {
    portfolio: state.portfolio.portfolio_id,
    portfolio_upserted: plan.counts.portfolio_upserted,
    projects_checked: state.projects.length,
    projects_upserted: plan.counts.projects_upserted,
    tasks_checked: plan.tasks.length,
    tasks_upserted: plan.counts.tasks_upserted,
    tasks_deleted: tasksDeleted,
    comments_upserted: plan.counts.comments_upserted,
    comments_deleted: commentsDeleted,
    row_hashes: plan.row_hashes,
    hash: await dashboardHash(state),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cache = await readSyncCache();
  let previousHash = cache.last_hash || "";

  while (true) {
    const state = await loadDashboardState();
    const currentHash = await dashboardHash(state);
    if (!options.force && !previousHash) {
      previousHash = currentHash;
      const summary = await syncOnce({ event: async () => {}, rest: async () => [] }, { ...options, force: false, deleteStale: false }, {});
      cache.last_hash = currentHash;
      cache.row_hashes = summary.row_hashes;
      await writeSyncCache({ ...cache, primed_at: new Date().toISOString() });
      console.log(JSON.stringify({ ok: true, skipped: "cache_primed", checked_at: new Date().toISOString(), hash: currentHash }));
    } else if (options.force || currentHash !== previousHash) {
      const env = await readEnvFile();
      const client = makeSupabaseSyncClient(env);
      const summary = await syncOnce(client, options, cache);
      previousHash = summary.hash;
      cache.last_hash = summary.hash;
      cache.row_hashes = summary.row_hashes;
      await writeSyncCache({ ...cache, synced_at: new Date().toISOString() });
      delete summary.row_hashes;
      console.log(JSON.stringify({ ok: true, synced_at: new Date().toISOString(), ...summary }));
    } else {
      if (!cache.row_hashes) {
        const summary = await syncOnce({ event: async () => {}, rest: async () => [] }, { ...options, force: false, deleteStale: false }, {});
        cache.last_hash = currentHash;
        cache.row_hashes = summary.row_hashes;
        await writeSyncCache({ ...cache, checked_at: new Date().toISOString() });
      }
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
