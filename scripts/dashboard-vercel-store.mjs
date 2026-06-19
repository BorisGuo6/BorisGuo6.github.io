import {
  loadBundledDashboardSnapshot,
  normalizeDashboardSnapshot,
  serializeDashboardSnapshot,
} from "./dashboard-state-snapshot.mjs";

export const defaultDashboardBlobPath = "dashboard-state/embodied-ai-dashboard.json";

function dashboardBlobPath(env = process.env) {
  return env.DASHBOARD_BLOB_PATH || defaultDashboardBlobPath;
}

export function isVercelBlobConfigured(env = process.env) {
  return Boolean(env.BLOB_READ_WRITE_TOKEN);
}

async function blobClient() {
  return import("@vercel/blob");
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
  const downloadUrl = blob.downloadUrl || blob.url;
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
  return blob;
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
