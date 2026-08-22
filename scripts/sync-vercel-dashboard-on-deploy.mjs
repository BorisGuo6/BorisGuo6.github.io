import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  loadEnv,
  repoRoot,
} from "./dashboard-state-lib.mjs";
import {
  loadDashboardSnapshotFromFiles,
  maxDashboardAuditEvents,
  normalizeDashboardSnapshot,
  validateDashboardSnapshot,
} from "./dashboard-state-snapshot.mjs";
import {
  isBlobPreconditionFailedError,
  readVercelBlobSnapshot,
  writeVercelBlobSnapshot,
} from "./dashboard-vercel-store.mjs";

const syncPolicyPath = path.join(repoRoot, "dashboard", "state", "sync-policy.json");

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function timestampValue(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function latestTimestamp(values, fallback) {
  let latest = 0;
  for (const value of values) {
    latest = Math.max(latest, timestampValue(value));
  }
  return latest > 0 ? new Date(latest).toISOString() : fallback;
}

function documentTimestamp(document) {
  return document?.updated_at || document?.created_at || "";
}

function documentKey(document, fallbackPrefix) {
  return String(
    document?.audit_id
      || document?.event_id
      || document?.comment_id
      || document?.id
      || `${fallbackPrefix}:${JSON.stringify(document)}`,
  );
}

function chooseLatest(localDocument, remoteDocument) {
  if (!localDocument) return cloneJson(remoteDocument);
  if (!remoteDocument) return cloneJson(localDocument);
  return timestampValue(documentTimestamp(localDocument)) > timestampValue(documentTimestamp(remoteDocument))
    ? cloneJson(localDocument)
    : cloneJson(remoteDocument);
}

function mergeComments(localComments = [], remoteComments = []) {
  const localMap = new Map(localComments.map((comment) => [documentKey(comment, "local-comment"), comment]));
  const remoteMap = new Map(remoteComments.map((comment) => [documentKey(comment, "remote-comment"), comment]));
  const order = [
    ...localMap.keys(),
    ...[...remoteMap.keys()].filter((key) => !localMap.has(key)),
  ];
  return order.map((key) => chooseLatest(localMap.get(key), remoteMap.get(key)));
}

function mergeTasks(localTasks, remoteTasks, projectMigrations) {
  const localMap = new Map(localTasks.map((task) => [task.task_id, task]));
  const remoteMap = new Map(remoteTasks.map((task) => [task.task_id, task]));
  const order = [
    ...localMap.keys(),
    ...[...remoteMap.keys()].filter((taskId) => !localMap.has(taskId)),
  ];
  return order.map((taskId) => {
    const localTask = localMap.get(taskId);
    const remoteTask = remoteMap.get(taskId);
    const merged = chooseLatest(localTask, remoteTask);
    merged.comments = mergeComments(localTask?.comments, remoteTask?.comments);
    merged.project_id = projectMigrations.get(merged.project_id) || merged.project_id;
    merged.updated_at = latestTimestamp([
      localTask?.updated_at,
      remoteTask?.updated_at,
      ...merged.comments.flatMap((comment) => [comment?.updated_at, comment?.created_at]),
    ], merged.updated_at || new Date().toISOString());
    return merged;
  });
}

function orderedProjectIds(localSnapshot, remoteSnapshot, tombstones) {
  const ids = [];
  const seen = new Set();
  const append = (projectId) => {
    const normalized = String(projectId || "").trim();
    if (!normalized || seen.has(normalized) || tombstones.has(normalized)) return;
    seen.add(normalized);
    ids.push(normalized);
  };
  for (const ref of localSnapshot.portfolio.projects || []) append(ref?.project_id);
  for (const ref of remoteSnapshot?.portfolio?.projects || []) append(ref?.project_id);
  for (const project of localSnapshot.projects || []) append(project?.project_id);
  for (const project of remoteSnapshot?.projects || []) append(project?.project_id);
  return ids;
}

function mergeProjects(localSnapshot, remoteSnapshot, tombstones) {
  const localMap = new Map(localSnapshot.projects.map((project) => [project.project_id, project]));
  const remoteMap = new Map((remoteSnapshot?.projects || []).map((project) => [project.project_id, project]));
  const ids = orderedProjectIds(localSnapshot, remoteSnapshot, tombstones);
  return ids.map((projectId) => cloneJson(localMap.get(projectId) || remoteMap.get(projectId)));
}

function mergePortfolio(localSnapshot, remoteSnapshot, projects, tombstones) {
  const portfolio = cloneJson(localSnapshot.portfolio);
  const localRefs = new Map((localSnapshot.portfolio.projects || []).map((ref) => [ref.project_id, ref]));
  const remoteRefs = new Map((remoteSnapshot?.portfolio?.projects || []).map((ref) => [ref.project_id, ref]));
  const projectMap = new Map(projects.map((project) => [project.project_id, project]));
  portfolio.projects = orderedProjectIds(localSnapshot, remoteSnapshot, tombstones).map((projectId) => {
    const project = projectMap.get(projectId);
    const ref = cloneJson(localRefs.get(projectId) || remoteRefs.get(projectId) || {});
    return {
      ...ref,
      project_id: projectId,
      title: project.title,
      bucket: project.bucket,
      status: project.status,
      state_path: ref.state_path || `dashboard/state/projects/${projectId}.json`,
      ...(project.summary ? { summary: project.summary } : {}),
    };
  });
  return portfolio;
}

function rebuildProjectTaskIds(projects, tasks, localSnapshot, remoteSnapshot) {
  const taskMap = new Map(tasks.map((task) => [task.task_id, task]));
  const localProjects = new Map(localSnapshot.projects.map((project) => [project.project_id, project]));
  const remoteProjects = new Map((remoteSnapshot?.projects || []).map((project) => [project.project_id, project]));
  for (const project of projects) {
    const orderedIds = [
      ...(localProjects.get(project.project_id)?.task_ids || []),
      ...(remoteProjects.get(project.project_id)?.task_ids || []),
      ...tasks.filter((task) => task.project_id === project.project_id).map((task) => task.task_id),
    ];
    project.task_ids = [...new Set(orderedIds)].filter((taskId) => (
      taskMap.get(taskId)?.project_id === project.project_id
    ));
  }
}

function mergeAuditLog(localAudit, remoteAudit) {
  const byId = new Map();
  for (const event of [...(remoteAudit || []), ...(localAudit || [])]) {
    const key = documentKey(event, "audit");
    byId.set(key, chooseLatest(byId.get(key), event));
  }
  return [...byId.values()]
    .sort((left, right) => timestampValue(left?.created_at) - timestampValue(right?.created_at))
    .slice(-maxDashboardAuditEvents);
}

function snapshotContent(snapshot) {
  return JSON.stringify({
    portfolio: snapshot.portfolio,
    projects: snapshot.projects,
    taskDoc: snapshot.taskDoc,
  });
}

function deployAuditEvent(env, now, summary) {
  const commit = String(env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || "manual").trim();
  const uniqueSuffix = commit === "manual" ? `-${now.replace(/[:.]/g, "-")}` : "";
  return {
    audit_id: `git-deploy-sync-${commit}${uniqueSuffix}`,
    action: "git-deploy-sync",
    viewer: "vercel-build",
    created_at: now,
    payload: {
      git_commit: commit,
      git_ref: env.VERCEL_GIT_COMMIT_REF || env.GITHUB_REF_NAME || null,
      ...summary,
    },
  };
}

function mergeSnapshots(localSnapshot, remoteSnapshot, policy, env, now) {
  const tombstoneRows = Array.isArray(policy.project_tombstones) ? policy.project_tombstones : [];
  const tombstones = new Set(tombstoneRows.map((row) => row.project_id));
  const projectMigrations = new Map(tombstoneRows
    .filter((row) => row.project_id && row.migrate_tasks_to)
    .map((row) => [row.project_id, row.migrate_tasks_to]));
  const projects = mergeProjects(localSnapshot, remoteSnapshot, tombstones);
  const portfolio = mergePortfolio(localSnapshot, remoteSnapshot, projects, tombstones);
  const tasks = mergeTasks(
    localSnapshot.taskDoc.tasks,
    remoteSnapshot?.taskDoc?.tasks || [],
    projectMigrations,
  );
  const projectIds = new Set(projects.map((project) => project.project_id));
  for (const task of tasks) {
    if (!projectIds.has(task.project_id)) {
      throw new Error(`Merged task ${task.task_id} references missing project ${task.project_id}`);
    }
  }
  rebuildProjectTaskIds(projects, tasks, localSnapshot, remoteSnapshot);
  const contentCandidate = normalizeDashboardSnapshot({
    schema_version: localSnapshot.schema_version,
    source: "git-blob-merged",
    updated_at: latestTimestamp([
      localSnapshot.updated_at,
      remoteSnapshot?.updated_at,
    ], now),
    portfolio,
    projects,
    taskDoc: {
      ...cloneJson(localSnapshot.taskDoc),
      tasks,
      updated_at: latestTimestamp([
        localSnapshot.taskDoc.updated_at,
        remoteSnapshot?.taskDoc?.updated_at,
        ...tasks.map((task) => task.updated_at),
      ], now),
    },
    audit_log: mergeAuditLog(localSnapshot.audit_log, remoteSnapshot?.audit_log),
  });
  const contentChanged = !remoteSnapshot
    || snapshotContent(contentCandidate) !== snapshotContent(remoteSnapshot);
  const commit = String(env.VERCEL_GIT_COMMIT_SHA || env.GITHUB_SHA || "manual").trim();
  const alreadyRecorded = commit !== "manual" && (remoteSnapshot?.audit_log || []).some((event) => (
    event?.action === "git-deploy-sync" && event?.payload?.git_commit === commit
  ));
  if (!contentChanged && alreadyRecorded) {
    return { snapshot: contentCandidate, contentChanged, shouldWrite: false };
  }
  const event = deployAuditEvent(env, now, {
    local_projects: localSnapshot.projects.length,
    remote_projects: remoteSnapshot?.projects?.length || 0,
    merged_projects: projects.length,
    merged_tasks: tasks.length,
    tombstones: [...tombstones],
  });
  contentCandidate.audit_log = [...contentCandidate.audit_log, event].slice(-maxDashboardAuditEvents);
  if (contentChanged) {
    contentCandidate.updated_at = now;
    contentCandidate.portfolio.updated_at = now;
    contentCandidate.taskDoc.updated_at = now;
  }
  validateDashboardSnapshot(contentCandidate);
  return { snapshot: contentCandidate, contentChanged, shouldWrite: true, event };
}

async function loadRuntimeEnv() {
  const env = { ...process.env };
  for (const fileName of [".env.local", ".env"]) {
    try {
      const values = loadEnv(await readFile(path.join(repoRoot, fileName), "utf8"));
      for (const [key, value] of Object.entries(values)) {
        if (!env[key]) env[key] = value;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return env;
}

async function loadSyncPolicy() {
  return JSON.parse(await readFile(syncPolicyPath, "utf8"));
}

async function main() {
  const env = await loadRuntimeEnv();
  if (hasFlag("--deploy") && env.VERCEL_ENV !== "production") {
    console.log("dashboard Blob sync skipped outside a production Vercel deployment");
    return;
  }
  if (!env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is required for Dashboard deployment sync");
  }
  const localSnapshot = await loadDashboardSnapshotFromFiles({ source: "git-deploy" });
  const policy = await loadSyncPolicy();
  const dryRun = hasFlag("--dry-run");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const remoteResult = await readVercelBlobSnapshot({ env });
    const remoteSnapshot = remoteResult?.snapshot || null;
    const now = new Date().toISOString();
    const merged = mergeSnapshots(localSnapshot, remoteSnapshot, policy, env, now);
    if (!merged.shouldWrite || dryRun) {
      console.log(JSON.stringify({
        ok: true,
        dry_run: dryRun,
        changed: merged.contentChanged,
        written: false,
        projects: merged.snapshot.projects.length,
        tasks: merged.snapshot.taskDoc.tasks.length,
        updated_at: merged.snapshot.updated_at,
      }, null, 2));
      return;
    }
    const legacyPublicBlob = remoteResult?.blob?.legacy_public === true;
    try {
      const blob = await writeVercelBlobSnapshot(merged.snapshot, {
        env,
        ifMatch: remoteResult?.blob?.etag,
        ...(legacyPublicBlob ? {
          access: "public",
          pathname: remoteResult.blob.legacy_public_pathname || remoteResult.blob.pathname,
        } : {}),
        previousSnapshot: remoteSnapshot,
        backupBeforeWrite: Boolean(remoteSnapshot),
      });
      console.log(JSON.stringify({
        ok: true,
        changed: merged.contentChanged,
        written: true,
        attempt,
        blob_path: blob.pathname,
        blob_etag: blob.etag,
        backup_path: blob.backup?.pathname || null,
        projects: merged.snapshot.projects.length,
        tasks: merged.snapshot.taskDoc.tasks.length,
        updated_at: merged.snapshot.updated_at,
        git_commit: merged.event?.payload?.git_commit || null,
      }, null, 2));
      return;
    } catch (error) {
      if (!isBlobPreconditionFailedError(error) || attempt === 3) throw error;
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
