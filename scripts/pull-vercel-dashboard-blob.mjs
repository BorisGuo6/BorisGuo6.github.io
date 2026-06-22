import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  loadEnv,
  repoRoot,
  statePathToFile,
} from "./dashboard-state-lib.mjs";
import {
  normalizeDashboardSnapshot,
} from "./dashboard-state-snapshot.mjs";
import {
  loadVercelDashboardSnapshot,
} from "./dashboard-vercel-store.mjs";

const execFileAsync = promisify(execFile);
const backupRoot = path.join(repoRoot, "tmp", "dashboard-state-local-backups");

function hasFlag(name) {
  return process.argv.includes(name);
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

async function dashboardStateIsDirty() {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain", "--", "dashboard/state"], {
      cwd: repoRoot,
    });
    return Boolean(stdout.trim());
  } catch {
    return false;
  }
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeIfChanged(filePath, value, options = {}) {
  const next = jsonText(value);
  let previous = "";
  try {
    previous = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (previous === next) return false;
  if (options.backupDir && previous) {
    const relative = path.relative(repoRoot, filePath);
    const backupPath = path.join(options.backupDir, relative);
    await mkdir(path.dirname(backupPath), { recursive: true });
    await writeFile(backupPath, previous);
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, next);
  return true;
}

function projectStatePathMap(portfolio) {
  const refs = Array.isArray(portfolio.projects) ? portfolio.projects : [];
  const result = new Map();
  for (const ref of refs) {
    if (ref?.project_id && ref?.state_path) {
      result.set(ref.project_id, ref.state_path);
    }
  }
  return result;
}

async function main() {
  const dryRun = hasFlag("--dry-run");
  const force = hasFlag("--force");
  if (!force && await dashboardStateIsDirty()) {
    throw new Error("dashboard/state has uncommitted changes. Commit/stash them or rerun with --force.");
  }

  const env = await loadLocalEnv();
  if (!env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("Missing BLOB_READ_WRITE_TOKEN. Run `vercel env pull .env.local --yes` first.");
  }

  const { snapshot, meta } = await loadVercelDashboardSnapshot({ env });
  if (meta.storage !== "vercel-blob") {
    throw new Error(`Hosted dashboard state is not backed by Vercel Blob (storage=${meta.storage}). Refusing to mirror fallback JSON.`);
  }
  const normalized = normalizeDashboardSnapshot(snapshot);
  const backupDir = path.join(backupRoot, new Date().toISOString().replace(/[:.]/g, "-"));
  const projectPaths = projectStatePathMap(normalized.portfolio);
  const plannedFiles = [
    "dashboard/state/portfolio.json",
    "dashboard/state/tasks.json",
    ...normalized.projects.map((project) => (
      projectPaths.get(project.project_id) || `dashboard/state/projects/${project.project_id}.json`
    )),
  ];

  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      storage: meta.storage,
      blob_path: meta.blob_path,
      files: plannedFiles,
      projects: normalized.projects.length,
      tasks: normalized.taskDoc.tasks.length,
      updated_at: normalized.updated_at,
    }, null, 2));
    return;
  }

  let changed = 0;
  changed += await writeIfChanged(statePathToFile("dashboard/state/portfolio.json"), normalized.portfolio, { backupDir }) ? 1 : 0;
  changed += await writeIfChanged(statePathToFile("dashboard/state/tasks.json"), normalized.taskDoc, { backupDir }) ? 1 : 0;
  for (const project of normalized.projects) {
    const statePath = projectPaths.get(project.project_id) || `dashboard/state/projects/${project.project_id}.json`;
    changed += await writeIfChanged(statePathToFile(statePath), project, { backupDir }) ? 1 : 0;
  }

  console.log(JSON.stringify({
    ok: true,
    storage: meta.storage,
    blob_path: meta.blob_path,
    projects: normalized.projects.length,
    tasks: normalized.taskDoc.tasks.length,
    updated_at: normalized.updated_at,
    changed_files: changed,
    backup_dir: changed ? path.relative(repoRoot, backupDir) : null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
