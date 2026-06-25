import {
  loadBundledDashboardSnapshot,
  normalizeDashboardSnapshot,
  serializeDashboardSnapshot,
} from "./dashboard-state-snapshot.mjs";

export const defaultDashboardBlobPath = "dashboard-state/embodied-ai-dashboard.json";
export const defaultDashboardBlobBackupPrefix = "dashboard-state/backups";

function dashboardBlobPath(env = process.env) {
  return env.DASHBOARD_BLOB_PATH || defaultDashboardBlobPath;
}

export function isVercelBlobConfigured(env = process.env) {
  return Boolean(env.BLOB_READ_WRITE_TOKEN);
}

async function blobClient() {
  return import("@vercel/blob");
}

export function vercelBlobReadUrl(blob) {
  return blob?.url || blob?.downloadUrl;
}

function timestampForPath(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

function backupPathForBlob(pathname, now = new Date()) {
  const leaf = pathname.split("/").pop() || "dashboard-state.json";
  const baseName = leaf.replace(/\.json$/i, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${defaultDashboardBlobBackupPrefix}/${baseName}-${timestampForPath(now)}-${suffix}.json`;
}

export async function readVercelBlobSnapshot(options = {}) {
  const env = options.env || process.env;
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) return null;
  const pathname = options.pathname || dashboardBlobPath(env);
  const { BlobNotFoundError, head } = await blobClient();
  let blob = null;
  try {
    blob = await head(pathname, { token });
  } catch (error) {
    if (error instanceof BlobNotFoundError || error?.name === "BlobNotFoundError") {
      return null;
    }
    throw error;
  }
  const downloadUrl = vercelBlobReadUrl(blob);
  if (!downloadUrl) {
    throw new Error(`Dashboard blob ${pathname} does not expose a readable URL`);
  }
  const cacheBustSeparator = downloadUrl.includes("?") ? "&" : "?";
  const response = await fetch(`${downloadUrl}${cacheBustSeparator}dashboardBust=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to read dashboard blob ${pathname}: ${response.status}`);
  }
  const snapshot = normalizeDashboardSnapshot(await response.json());
  return {
    snapshot: {
      ...snapshot,
      source: "vercel-blob",
    },
    blob,
  };
}

export async function writeVercelBlobSnapshot(snapshot, options = {}) {
  const env = options.env || process.env;
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  }
  const pathname = options.pathname || dashboardBlobPath(env);
  const { put } = await blobClient();
  let backup = null;
  const shouldBackup = options.backupBeforeWrite !== false
    && env.DASHBOARD_DISABLE_BLOB_BACKUP !== "1"
    && !pathname.includes("/backups/");
  if (shouldBackup) {
    const previous = await readVercelBlobSnapshot({ env, pathname });
    if (previous?.snapshot) {
      const backupPath = options.backupPath || backupPathForBlob(pathname, options.now || new Date());
      backup = await put(backupPath, serializeDashboardSnapshot({
        ...previous.snapshot,
        source: "vercel-blob-backup",
      }), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 0,
        token,
      });
    }
  }
  const blob = await put(pathname, serializeDashboardSnapshot({
    ...snapshot,
    source: "vercel-blob",
  }), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 0,
    token,
  });
  return backup ? { ...blob, backup } : blob;
}

export async function loadVercelDashboardSnapshot(options = {}) {
  const blobResult = await readVercelBlobSnapshot(options);
  if (blobResult?.snapshot) {
    return {
      snapshot: blobResult.snapshot,
      meta: {
        storage: "vercel-blob",
        blob_path: blobResult.blob.pathname,
        blob_url: blobResult.blob.url,
      },
    };
  }
  return {
    snapshot: await loadBundledDashboardSnapshot({
      source: isVercelBlobConfigured(options.env || process.env) ? "bundled-json-seed" : "bundled-json",
    }),
    meta: {
      storage: isVercelBlobConfigured(options.env || process.env) ? "bundled-json-seed" : "bundled-json",
      blob_path: dashboardBlobPath(options.env || process.env),
    },
  };
}
