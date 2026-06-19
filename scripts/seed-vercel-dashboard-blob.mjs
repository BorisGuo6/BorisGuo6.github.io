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
  requireEnv("BLOB_READ_WRITE_TOKEN");
  const pathname = process.env.DASHBOARD_BLOB_PATH || defaultDashboardBlobPath;
  const snapshot = await loadBundledDashboardSnapshot({
    source: "seed-vercel-dashboard-blob",
  });
  const blob = await writeVercelBlobSnapshot(snapshot, { pathname });
  console.log(JSON.stringify({
    ok: true,
    blob_path: blob.pathname,
    blob_url: blob.url,
    projects: snapshot.projects.length,
    tasks: snapshot.taskDoc.tasks.length,
    updated_at: snapshot.updated_at,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
