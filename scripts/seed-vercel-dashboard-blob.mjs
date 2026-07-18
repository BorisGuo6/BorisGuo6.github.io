import {
  loadBundledDashboardSnapshot,
} from "./dashboard-state-snapshot.mjs";
import {
  defaultDashboardBlobPath,
  writeVercelBlobSnapshot,
} from "./dashboard-vercel-store.mjs";

function requireEnv(name) {
  if (!process.env[name]) {
    throw new Error(`Missing ${name}`);
  }
  return process.env[name];
}

async function main() {
  const force = process.argv.includes("--force") || process.env.DASHBOARD_ALLOW_BLOB_SEED === "1";
  if (!force) {
    throw new Error(
      "Refusing to overwrite Vercel Blob from local JSON without --force. "
      + "Daily workflow is remote-first: run `npm run vercel:pull-blob` to sync local state from Blob, "
      + "or use hosted dashboard APIs for task edits. For explicit disaster recovery only, run "
      + "`DASHBOARD_ALLOW_BLOB_SEED=1 npm run vercel:seed-blob` or `npm run vercel:seed-blob:force`.",
    );
  }
  requireEnv("BLOB_READ_WRITE_TOKEN");
  const pathname = process.env.DASHBOARD_PRIVATE_BLOB_PATH || defaultDashboardBlobPath;
  const snapshot = await loadBundledDashboardSnapshot({
    source: "seed-vercel-dashboard-blob",
  });
  const blob = await writeVercelBlobSnapshot(snapshot, { pathname });
  console.log(JSON.stringify({
    ok: true,
    blob_path: blob.pathname,
    projects: snapshot.projects.length,
    tasks: snapshot.taskDoc.tasks.length,
    updated_at: snapshot.updated_at,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
