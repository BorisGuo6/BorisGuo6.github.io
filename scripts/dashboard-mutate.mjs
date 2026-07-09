import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  loadEnv,
  repoRoot,
} from "./dashboard-state-lib.mjs";
import {
  makeTaskComment,
} from "./dashboard-task-store.mjs";
import {
  applySnapshotTaskComment,
  applySnapshotTaskCommentDelete,
  applySnapshotTaskCreate,
  applySnapshotTaskStatus,
  applySnapshotTaskUpdate,
  normalizeDashboardSnapshot,
} from "./dashboard-state-snapshot.mjs";
import {
  isBlobPreconditionFailedError,
  loadVercelDashboardSnapshot,
  writeVercelBlobSnapshot,
} from "./dashboard-vercel-store.mjs";

const execFileAsync = promisify(execFile);

function usage() {
  return [
    "Usage:",
    "  npm run dashboard:mutate -- status --task-id ID --status done [--pull] [--force-pull]",
    "  npm run dashboard:mutate -- comment --task-id ID --body TEXT [--author NAME] [--pull]",
    "  npm run dashboard:mutate -- update --task-id ID [--title TEXT] [--description TEXT] [--priority P] [--assignee NAME] [--due-at YYYY-MM-DD] [--pull]",
    "  npm run dashboard:mutate -- create --project-id ID --title TEXT [--description TEXT] [--priority P] [--status S] [--assignee NAME] [--due-at YYYY-MM-DD] [--pull]",
    "  npm run dashboard:mutate -- delete-comment --task-id ID --comment-id ID [--pull]",
  ].join("\n");
}

function takeValue(args, index, name) {
  const current = args[index];
  if (current.includes("=")) return [current.split("=", 2)[1], index + 1];
  if (index + 1 >= args.length) throw new Error(`${name} requires a value`);
  return [args[index + 1], index + 2];
}

function requireValue(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${name}`);
  }
  return value.trim();
}

export function parseMutationArgs(argv) {
  const args = [...argv];
  const action = String(args.shift() || "").trim();
  if (!action || action === "--help" || action === "-h") {
    throw new Error(usage());
  }
  const mutation = {
    action,
    pull: false,
    forcePull: false,
  };
  const patch = {};
  let createInput = null;
  let idx = 0;
  while (idx < args.length) {
    const arg = args[idx];
    const normalized = arg.replace(/_/g, "-");
    if (normalized === "--pull") {
      mutation.pull = true;
      idx += 1;
      continue;
    }
    if (normalized === "--force-pull") {
      mutation.forcePull = true;
      idx += 1;
      continue;
    }
    if (normalized === "--task-id" || normalized.startsWith("--task-id=")) {
      const [value, next] = takeValue(args, idx, "--task-id");
      mutation.taskId = value;
      idx = next;
      continue;
    }
    if (normalized === "--comment-id" || normalized.startsWith("--comment-id=")) {
      const [value, next] = takeValue(args, idx, "--comment-id");
      mutation.commentId = value;
      idx = next;
      continue;
    }
    if (normalized === "--status" || normalized.startsWith("--status=")) {
      const [value, next] = takeValue(args, idx, "--status");
      mutation.status = value;
      if (action === "create") {
        createInput = { ...(createInput || {}), status: value };
      }
      idx = next;
      continue;
    }
    if (normalized === "--body" || normalized.startsWith("--body=")) {
      const [value, next] = takeValue(args, idx, "--body");
      mutation.body = value;
      idx = next;
      continue;
    }
    if (normalized === "--body-file" || normalized.startsWith("--body-file=")) {
      const [value, next] = takeValue(args, idx, "--body-file");
      mutation.bodyFile = value;
      idx = next;
      continue;
    }
    if (normalized === "--author" || normalized.startsWith("--author=")) {
      const [value, next] = takeValue(args, idx, "--author");
      mutation.author = value;
      idx = next;
      continue;
    }
    if (normalized === "--title" || normalized.startsWith("--title=")) {
      const [value, next] = takeValue(args, idx, "--title");
      patch.title = value;
      createInput = { ...(createInput || {}), title: value };
      idx = next;
      continue;
    }
    if (normalized === "--description" || normalized.startsWith("--description=")) {
      const [value, next] = takeValue(args, idx, "--description");
      patch.description = value;
      createInput = { ...(createInput || {}), description: value };
      idx = next;
      continue;
    }
    if (normalized === "--priority" || normalized.startsWith("--priority=")) {
      const [value, next] = takeValue(args, idx, "--priority");
      patch.priority = value;
      createInput = { ...(createInput || {}), priority: value };
      idx = next;
      continue;
    }
    if (normalized === "--assignee" || normalized.startsWith("--assignee=")) {
      const [value, next] = takeValue(args, idx, "--assignee");
      patch.assignee = value;
      createInput = { ...(createInput || {}), assignee: value };
      idx = next;
      continue;
    }
    if (normalized === "--due-at" || normalized.startsWith("--due-at=")) {
      const [value, next] = takeValue(args, idx, "--due-at");
      patch.due_at = value;
      createInput = { ...(createInput || {}), due_at: value };
      idx = next;
      continue;
    }
    if (normalized === "--project-id" || normalized.startsWith("--project-id=")) {
      const [value, next] = takeValue(args, idx, "--project-id");
      createInput = { ...(createInput || {}), project_id: value };
      idx = next;
      continue;
    }
    throw new Error(`Unknown option: ${arg}\n${usage()}`);
  }

  if (action === "status") {
    mutation.taskId = requireValue(mutation.taskId, "--task-id");
    mutation.status = requireValue(mutation.status, "--status");
    return mutation;
  }
  if (action === "comment") {
    mutation.taskId = requireValue(mutation.taskId, "--task-id");
    if (!mutation.bodyFile) mutation.body = requireValue(mutation.body, "--body");
    return mutation;
  }
  if (action === "update") {
    mutation.taskId = requireValue(mutation.taskId, "--task-id");
    if (!Object.keys(patch).length) throw new Error("Missing update fields");
    mutation.patch = patch;
    return mutation;
  }
  if (action === "create") {
    createInput = createInput || {};
    createInput.project_id = requireValue(createInput.project_id, "--project-id");
    createInput.title = requireValue(createInput.title, "--title");
    mutation.input = createInput;
    return mutation;
  }
  if (action === "delete-comment") {
    mutation.taskId = requireValue(mutation.taskId, "--task-id");
    mutation.commentId = requireValue(mutation.commentId, "--comment-id");
    return mutation;
  }
  throw new Error(`Unknown action: ${action}\n${usage()}`);
}

export function applyDashboardMutationToSnapshot(snapshot, mutation, options = {}) {
  const now = options.now || new Date();
  if (mutation.action === "status") {
    const result = applySnapshotTaskStatus(snapshot, mutation.taskId, mutation.status, {
      now,
      source: "vercel-blob",
    });
    return { action: mutation.action, ...result };
  }
  if (mutation.action === "comment") {
    const comment = makeTaskComment(
      mutation.taskId,
      mutation.body,
      mutation.author || "Codex dashboard",
      now,
    );
    const result = applySnapshotTaskComment(snapshot, mutation.taskId, comment, {
      now,
      source: "vercel-blob",
    });
    return { action: mutation.action, ...result };
  }
  if (mutation.action === "update") {
    const result = applySnapshotTaskUpdate(snapshot, mutation.taskId, mutation.patch, {
      now,
      source: "vercel-blob",
    });
    return { action: mutation.action, ...result };
  }
  if (mutation.action === "create") {
    const result = applySnapshotTaskCreate(snapshot, mutation.input, {
      now,
      source: "vercel-blob",
    });
    return { action: mutation.action, ...result };
  }
  if (mutation.action === "delete-comment") {
    const result = applySnapshotTaskCommentDelete(snapshot, mutation.taskId, mutation.commentId, {
      now,
      source: "vercel-blob",
    });
    return { action: mutation.action, ...result, comment_id: mutation.commentId };
  }
  throw new Error(`Unknown action: ${mutation.action}`);
}

function findTask(snapshot, taskId) {
  const normalized = normalizeDashboardSnapshot(snapshot);
  return normalized.taskDoc.tasks.find((task) => task.task_id === taskId) || null;
}

export function verifyDashboardMutation(snapshot, result) {
  if (result.action === "create") {
    const created = findTask(snapshot, result.task.task_id);
    if (!created) throw new Error(`Created task not found after write: ${result.task.task_id}`);
    return { ok: true, task_id: created.task_id };
  }
  const taskId = result.task?.task_id || result.task_id;
  const task = findTask(snapshot, taskId);
  if (!task) throw new Error(`Task not found after write: ${taskId}`);
  if (result.action === "status") {
    if (task.status !== result.task.status) {
      throw new Error(`Verified task ${taskId} has status ${task.status}, expected ${result.task.status}`);
    }
    return { ok: true, task_id: taskId, status: task.status };
  }
  if (result.action === "comment") {
    const commentId = result.comment?.comment_id;
    const found = (task.comments || []).some((comment) => comment.comment_id === commentId);
    if (!found) throw new Error(`Comment not found after write: ${commentId}`);
    return { ok: true, task_id: taskId, comment_id: commentId };
  }
  if (result.action === "update") {
    for (const field of result.update.changed_fields || []) {
      if ((task[field] ?? null) !== (result.task[field] ?? null)) {
        throw new Error(`Verified task ${taskId} field ${field} did not match`);
      }
    }
    return { ok: true, task_id: taskId, changed_fields: result.update.changed_fields || [] };
  }
  if (result.action === "delete-comment") {
    const commentId = result.comment_id || result.comment?.comment_id;
    const found = (task.comments || []).some((comment) => comment.comment_id === commentId);
    if (found) throw new Error(`Deleted comment still exists after write: ${commentId}`);
    return { ok: true, task_id: taskId, comment_id: commentId };
  }
  throw new Error(`Unknown action: ${result.action}`);
}

async function maybeLoadEnvFile(filePath) {
  try {
    return loadEnv(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function loadLocalEnv() {
  const env = { ...process.env };
  for (const fileName of [".env.local", ".env"]) {
    const values = await maybeLoadEnvFile(path.join(repoRoot, fileName));
    for (const [key, value] of Object.entries(values)) {
      if (!env[key]) env[key] = value;
    }
  }
  return env;
}

async function loadBodyFromFile(mutation) {
  if (!mutation.bodyFile) return mutation;
  const filePath = mutation.bodyFile === "-"
    ? null
    : path.resolve(repoRoot, mutation.bodyFile);
  const body = filePath
    ? await readFile(filePath, "utf8")
    : await new Promise((resolve, reject) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        data += chunk;
      });
      process.stdin.on("end", () => resolve(data));
      process.stdin.on("error", reject);
    });
  return { ...mutation, body: requireValue(body, "--body-file") };
}

async function pullMirror(forcePull) {
  const args = ["scripts/pull-vercel-dashboard-blob.mjs"];
  if (forcePull) args.push("--force");
  const { stdout, stderr } = await execFileAsync(process.execPath, args, {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024,
  });
  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

async function main() {
  if (process.argv.length <= 2 || process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(usage());
    return;
  }
  const env = await loadLocalEnv();
  if (!env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Missing BLOB_READ_WRITE_TOKEN. Run `vercel env pull .env.local --yes` first.");
  }
  const parsed = await loadBodyFromFile(parseMutationArgs(process.argv.slice(2)));
  let result;
  let blob;
  let verification;
  let mutationAttempt = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    mutationAttempt = attempt;
    const { snapshot, meta } = await loadVercelDashboardSnapshot({ env });
    if (meta.storage !== "vercel-blob") {
      throw new Error(`Hosted dashboard state is not backed by Vercel Blob (storage=${meta.storage}).`);
    }
    result = applyDashboardMutationToSnapshot(snapshot, parsed);
    try {
      blob = await writeVercelBlobSnapshot(result.snapshot, {
        env,
        ifMatch: meta.blob_etag,
        previousSnapshot: snapshot,
      });
      const verifiedSnapshot = await loadVercelDashboardSnapshot({ env });
      verification = verifyDashboardMutation(verifiedSnapshot.snapshot, result);
      break;
    } catch (error) {
      const isConflict = isBlobPreconditionFailedError(error);
      if (!isConflict || attempt === 3) throw error;
    }
  }
  const response = {
    ok: true,
    action: parsed.action,
    verification,
    blob_path: blob.pathname,
    blob_url: blob.url,
    updated_at: result.snapshot.updated_at,
    mutation_attempt: mutationAttempt,
  };
  if (parsed.pull) {
    response.pull = await pullMirror(parsed.forcePull);
  }
  console.log(JSON.stringify(response, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
