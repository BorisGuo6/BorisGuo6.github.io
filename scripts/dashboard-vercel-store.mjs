import {
  loadBundledDashboardSnapshot,
  normalizeDashboardSnapshot,
  serializeDashboardSnapshot,
} from "./dashboard-state-snapshot.mjs";

export const defaultDashboardBlobPath = "dashboard-state-private/embodied-ai-dashboard.json";
export const legacyPublicDashboardBlobPath = "dashboard-state/embodied-ai-dashboard.json";
export const defaultDashboardBlobBackupPrefix = "dashboard-state/backups";

function dashboardBlobPath(env = process.env) {
  return env.DASHBOARD_PRIVATE_BLOB_PATH || defaultDashboardBlobPath;
}

function legacyDashboardBlobPath(env = process.env) {
  return env.DASHBOARD_BLOB_PATH || legacyPublicDashboardBlobPath;
}

export function isVercelBlobConfigured(env = process.env) {
  return Boolean(env.BLOB_READ_WRITE_TOKEN);
}

async function blobClient() {
  return import("@vercel/blob");
}

export function vercelBlobReadUrl(blob) {
  return blob?.downloadUrl || blob?.url;
}

function normalizeBlobEtag(etag) {
  return String(etag || "").trim().replace(/^W\//i, "");
}

export function blobEtagsMatch(left, right) {
  const normalizedLeft = normalizeBlobEtag(left);
  const normalizedRight = normalizeBlobEtag(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

export function isBlobPreconditionFailedError(error) {
  return error?.name === "BlobPreconditionFailedError"
    || error?.constructor?.name === "BlobPreconditionFailedError"
    || /Precondition failed: ETag mismatch/i.test(String(error?.message || ""));
}

function timestampValue(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function bundledSnapshotIsNewer(bundledSnapshot, blobSnapshot) {
  return timestampValue(bundledSnapshot?.updated_at) > timestampValue(blobSnapshot?.updated_at);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  let legacyReadPathname = pathname;
  const blobApi = options.blobApi || await blobClient();
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || wait;
  const retryDelays = options.retryDelays || [0, 150, 350, 750, 1500, 3000, 6000];
  let lastObserved = "unknown";

  if (typeof blobApi.get === "function") {
    try {
      const privateResult = await blobApi.get(pathname, {
        access: "private",
        useCache: false,
        token,
      });
      if (privateResult?.stream) {
        const snapshot = normalizeDashboardSnapshot(await new Response(privateResult.stream).json());
        return {
          snapshot: { ...snapshot, source: "vercel-blob" },
          blob: privateResult.blob,
        };
      }
      if (privateResult === null) {
        legacyReadPathname = options.legacyPathname || legacyDashboardBlobPath(env);
        if (legacyReadPathname === pathname) return null;
      }
    } catch (error) {
      const isMissingPrivateBlob = error?.name === "BlobNotFoundError"
        || error?.constructor?.name === "BlobNotFoundError";
      const isPrivateAccessMismatch = error?.name === "BlobAccessError"
        || error?.constructor?.name === "BlobAccessError"
        || /Failed to fetch blob:\s*400 Bad Request/i.test(String(error?.message || ""));
      const canFallBackToLegacyPublicBlob = isPrivateAccessMismatch
        || isMissingPrivateBlob;
      if (!canFallBackToLegacyPublicBlob) throw error;
      legacyReadPathname = options.legacyPathname || legacyDashboardBlobPath(env);
      if (legacyReadPathname === pathname && !isPrivateAccessMismatch) return null;
    }
  }

  for (const delay of retryDelays) {
    if (delay > 0) await sleep(delay);
    let blob;
    try {
      blob = await blobApi.head(legacyReadPathname, { token });
    } catch (error) {
      if (error instanceof blobApi.BlobNotFoundError || error?.name === "BlobNotFoundError") {
        return null;
      }
      throw error;
    }
    const readUrls = [...new Set([blob.downloadUrl, blob.url].filter(Boolean))];
    if (!readUrls.length) {
      throw new Error(`Dashboard blob ${pathname} does not expose a readable URL`);
    }
    for (const readUrl of readUrls) {
      const url = new URL(readUrl);
      url.searchParams.set("dashboardBust", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const response = await fetchImpl(url, {
        cache: "no-store",
        headers: { "cache-control": "no-cache" },
      });
      if (!response.ok) {
        lastObserved = `HTTP ${response.status}`;
        continue;
      }
      const responseEtag = response.headers.get("etag");
      if (blob.etag && !blobEtagsMatch(responseEtag, blob.etag)) {
        lastObserved = `head=${blob.etag || "none"}, content=${responseEtag || "none"}`;
        continue;
      }
      const snapshot = normalizeDashboardSnapshot(await response.json());
      return {
        snapshot: {
          ...snapshot,
          source: "vercel-blob",
        },
        blob: {
          ...blob,
          legacy_public: true,
          legacy_public_pathname: legacyReadPathname,
        },
      };
    }
  }
  throw new Error(`Dashboard blob ${pathname} remained stale after retries (${lastObserved})`);
}

export async function writeVercelBlobSnapshot(snapshot, options = {}) {
  const env = options.env || process.env;
  const token = env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  }
  const pathname = options.pathname || dashboardBlobPath(env);
  const blobApi = options.blobApi || await blobClient();
  let backup = null;
  let backupError = null;
  const backupRequested = options.backupBeforeWrite === true
    || (options.backupBeforeWrite !== false && env.DASHBOARD_ENABLE_BLOB_BACKUP === "1");
  const shouldBackup = backupRequested
    && env.DASHBOARD_DISABLE_BLOB_BACKUP !== "1"
    && !pathname.includes("/backups/");
  const previousSnapshot = options.previousSnapshot || (shouldBackup
    ? (await readVercelBlobSnapshot({ env, pathname, blobApi }))?.snapshot
    : null);
  const blob = await blobApi.put(pathname, serializeDashboardSnapshot({
    ...snapshot,
    source: "vercel-blob",
  }), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
    ...(options.ifMatch ? { ifMatch: normalizeBlobEtag(options.ifMatch) } : {}),
    token,
  });
  if (shouldBackup && previousSnapshot) {
    const backupPath = options.backupPath || backupPathForBlob(pathname, options.now || new Date());
    try {
      backup = await blobApi.put(backupPath, serializeDashboardSnapshot({
        ...previousSnapshot,
        audit_log: [],
        source: "vercel-blob-backup",
      }), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 60,
        token,
      });
    } catch (error) {
      backupError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    ...blob,
    ...(backup ? { backup } : {}),
    ...(backupError ? { backup_error: backupError } : {}),
  };
}

export async function loadVercelDashboardSnapshot(options = {}) {
  const env = options.env || process.env;
  let blobReadError = null;
  let blobResult = null;
  try {
    blobResult = await readVercelBlobSnapshot(options);
  } catch (error) {
    blobReadError = error;
  }
  if (blobResult?.snapshot) {
    const bundledSnapshot = await loadBundledDashboardSnapshot({
      source: "bundled-json",
    });
    if (bundledSnapshotIsNewer(bundledSnapshot, blobResult.snapshot)) {
      return {
        snapshot: {
          ...bundledSnapshot,
          source: "bundled-json-newer-than-blob",
        },
        meta: {
          storage: "bundled-json-newer-than-blob",
          blob_path: blobResult.blob.pathname,
          blob_etag: blobResult.blob.legacy_public ? null : blobResult.blob.etag,
          legacy_public_blob_path: blobResult.blob.legacy_public_pathname || null,
          superseded_blob_updated_at: blobResult.snapshot.updated_at || null,
        },
      };
    }
    return {
      snapshot: blobResult.snapshot,
      meta: {
        storage: "vercel-blob",
        blob_path: blobResult.blob.pathname,
        blob_etag: blobResult.blob.legacy_public ? null : blobResult.blob.etag,
        legacy_public_blob_path: blobResult.blob.legacy_public_pathname || null,
      },
    };
  }
  if (blobReadError) {
    return {
      snapshot: await loadBundledDashboardSnapshot({
        source: isVercelBlobConfigured(env) ? "bundled-json-blob-read-failed" : "bundled-json",
      }),
      meta: {
        storage: isVercelBlobConfigured(env) ? "bundled-json-blob-read-failed" : "bundled-json",
        blob_path: dashboardBlobPath(env),
        blob_read_error: blobReadError instanceof Error ? blobReadError.message : String(blobReadError || ""),
      },
    };
  }
  return {
    snapshot: await loadBundledDashboardSnapshot({
      source: isVercelBlobConfigured(env) ? "bundled-json-seed" : "bundled-json",
    }),
    meta: {
      storage: isVercelBlobConfigured(env) ? "bundled-json-seed" : "bundled-json",
      blob_path: dashboardBlobPath(env),
    },
  };
}
