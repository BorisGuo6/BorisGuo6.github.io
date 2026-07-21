import { randomBytes } from "node:crypto";
import { normalizeBlobEtag } from "./dashboard-vercel-store.mjs";

export const dashboardPasskeysSchemaVersion = "dashboard-passkeys.v1";
export const defaultDashboardPasskeyBlobPath = "dashboard-access/passkeys.json";
export const dashboardPasskeyChallengeLimit = 16;
export const dashboardPasskeyChallengeTtlMs = 5 * 60 * 1000;
export const dashboardPasskeyTransports = Object.freeze([
  "usb",
  "nfc",
  "ble",
  "cable",
  "smart-card",
  "hybrid",
  "internal",
]);

const ceremonies = new Set(["registration", "authentication"]);
const deviceTypes = new Set(["singleDevice", "multiDevice"]);
const transportSet = new Set(dashboardPasskeyTransports);

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function nowDate(options = {}) {
  const now = options.now || new Date();
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("Invalid current time");
  return now;
}

function requireIsoDate(value, fieldName, options = {}) {
  if (value === null && options.nullable) return null;
  const text = optionalString(value);
  const timestamp = Date.parse(text);
  if (!text || !Number.isFinite(timestamp)) throw new Error(`Invalid ${fieldName}`);
  return new Date(timestamp).toISOString();
}

function requireBase64url(value, fieldName) {
  const text = optionalString(value);
  if (!text || !/^[A-Za-z0-9_-]+$/.test(text)) throw new Error(`Invalid ${fieldName}`);
  const decoded = Buffer.from(text, "base64url");
  if (decoded.length === 0 || decoded.toString("base64url") !== text) throw new Error(`Invalid ${fieldName}`);
  return text;
}

function requireCeremony(value) {
  const ceremony = optionalString(value);
  if (!ceremonies.has(ceremony)) throw new Error("Invalid Passkey ceremony");
  return ceremony;
}

function requireLabel(value) {
  const label = optionalString(value);
  if (!label) throw new Error("Missing Passkey label");
  if (label.length > 80) throw new Error("Invalid Passkey label: maximum length is 80 characters");
  if (/\p{C}/u.test(label)) throw new Error("Invalid Passkey label: control characters are not allowed");
  return label;
}

function requireCounter(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid Passkey counter");
  return value;
}

function normalizeTransports(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Invalid Passkey transports");
  const transports = [...new Set(value.map(optionalString))];
  if (transports.some((transport) => !transportSet.has(transport))) {
    throw new Error("Invalid Passkey transport");
  }
  return transports;
}

function requireDeviceType(value) {
  const deviceType = optionalString(value);
  if (!deviceTypes.has(deviceType)) throw new Error("Invalid Passkey device_type");
  return deviceType;
}

function requireBackedUp(value) {
  if (typeof value !== "boolean") throw new Error("Invalid Passkey backed_up");
  return value;
}

function randomBase64url(length, options = {}) {
  const random = options.randomBytes || randomBytes;
  const bytes = random(length);
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new Error("Invalid random byte source");
  }
  if (bytes.length !== length) throw new Error("Invalid random byte source");
  return Buffer.from(bytes).toString("base64url");
}

function normalizeCredential(raw) {
  const createdAt = requireIsoDate(raw?.created_at, "Passkey created_at");
  const lastUsedAt = raw?.last_used_at === null || raw?.last_used_at === undefined
    ? null
    : requireIsoDate(raw.last_used_at, "Passkey last_used_at");
  if (lastUsedAt && Date.parse(lastUsedAt) < Date.parse(createdAt)) {
    throw new Error("Invalid Passkey last_used_at");
  }
  return {
    credential_id: requireBase64url(raw?.credential_id, "Passkey credential_id"),
    public_key: requireBase64url(raw?.public_key, "Passkey public_key"),
    counter: requireCounter(raw?.counter),
    transports: normalizeTransports(raw?.transports),
    device_type: requireDeviceType(raw?.device_type),
    backed_up: requireBackedUp(raw?.backed_up),
    label: requireLabel(raw?.label),
    created_at: createdAt,
    last_used_at: lastUsedAt,
  };
}

function normalizeChallenge(raw) {
  const createdAt = requireIsoDate(raw?.created_at, "Passkey challenge created_at");
  const expiresAt = requireIsoDate(raw?.expires_at, "Passkey challenge expires_at");
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) throw new Error("Invalid Passkey challenge expiry");
  return {
    challenge_id: requireBase64url(raw?.challenge_id, "Passkey challenge_id"),
    ceremony: requireCeremony(raw?.ceremony),
    challenge: requireBase64url(raw?.challenge, "Passkey challenge"),
    created_at: createdAt,
    expires_at: expiresAt,
  };
}

function publicCredential(credential) {
  const { public_key: _publicKey, ...publicFields } = credential;
  return cloneJson(publicFields);
}

function normalizedStore(raw, options = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw
    : emptyDashboardPasskeyStore(options);
  if (source.schema_version !== dashboardPasskeysSchemaVersion) {
    throw new Error("Invalid dashboard Passkey schema_version");
  }
  const credentials = Array.isArray(source.credentials) ? source.credentials.map(normalizeCredential) : [];
  const credentialIds = new Set();
  for (const credential of credentials) {
    if (credentialIds.has(credential.credential_id)) {
      throw new Error(`Duplicate Passkey credential: ${credential.credential_id}`);
    }
    credentialIds.add(credential.credential_id);
  }
  const challenges = Array.isArray(source.challenges) ? source.challenges.map(normalizeChallenge) : [];
  const challengeIds = new Set();
  for (const challenge of challenges) {
    if (challengeIds.has(challenge.challenge_id)) {
      throw new Error(`Duplicate Passkey challenge: ${challenge.challenge_id}`);
    }
    challengeIds.add(challenge.challenge_id);
  }
  const nowMs = nowDate(options).getTime();
  const retainedChallenges = challenges
    .filter((challenge) => options.trimExpired === false || Date.parse(challenge.expires_at) > nowMs)
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at))
    .slice(-dashboardPasskeyChallengeLimit);
  return {
    schema_version: dashboardPasskeysSchemaVersion,
    admin_user_id: requireBase64url(source.admin_user_id, "Passkey admin_user_id"),
    credentials,
    challenges: retainedChallenges,
    updated_at: requireIsoDate(source.updated_at, "dashboard Passkey updated_at"),
  };
}

export function emptyDashboardPasskeyStore(options = {}) {
  return {
    schema_version: dashboardPasskeysSchemaVersion,
    admin_user_id: randomBase64url(32, options),
    credentials: [],
    challenges: [],
    updated_at: nowDate(options).toISOString(),
  };
}

export function normalizeDashboardPasskeyStore(raw, options = {}) {
  return normalizedStore(raw, options);
}

export function listDashboardPasskeyCredentials(document, options = {}) {
  return normalizedStore(document, options).credentials.map(publicCredential);
}

export function findDashboardPasskeyCredential(document, credentialId, options = {}) {
  const targetId = requireBase64url(credentialId, "Passkey credential_id");
  const credential = normalizedStore(document, options).credentials
    .find((candidate) => candidate.credential_id === targetId);
  return credential ? cloneJson(credential) : null;
}

export function createDashboardPasskeyChallenge(document, input, options = {}) {
  const now = nowDate(options);
  const normalized = normalizedStore(document, { ...options, now });
  const ceremony = requireCeremony(input?.ceremony);
  const ttlMs = options.ttlMs === undefined ? dashboardPasskeyChallengeTtlMs : options.ttlMs;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new Error("Invalid Passkey challenge TTL");
  const challenge = {
    challenge_id: input?.challenge_id
      ? requireBase64url(input.challenge_id, "Passkey challenge_id")
      : randomBase64url(16, options),
    ceremony,
    challenge: input?.challenge
      ? requireBase64url(input.challenge, "Passkey challenge")
      : randomBase64url(32, options),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMs).toISOString(),
  };
  if (normalized.challenges.some((candidate) => candidate.challenge_id === challenge.challenge_id)) {
    throw new Error(`Duplicate Passkey challenge: ${challenge.challenge_id}`);
  }
  const challenges = [...normalized.challenges, challenge].slice(-dashboardPasskeyChallengeLimit);
  return {
    document: {
      ...normalized,
      challenges,
      updated_at: now.toISOString(),
    },
    challenge: cloneJson(challenge),
  };
}

export function readDashboardPasskeyChallenge(document, challengeId, ceremony, options = {}) {
  const now = nowDate(options);
  const targetId = requireBase64url(challengeId, "Passkey challenge_id");
  const expectedCeremony = requireCeremony(ceremony);
  const normalized = normalizedStore(document, { ...options, now, trimExpired: false });
  const challenge = normalized.challenges.find((candidate) => candidate.challenge_id === targetId);
  if (!challenge) throw new Error(`Passkey challenge not found: ${targetId}`);
  if (challenge.ceremony !== expectedCeremony) throw new Error("Invalid Passkey challenge ceremony");
  if (Date.parse(challenge.expires_at) <= now.getTime()) throw new Error("Expired Passkey challenge");
  return cloneJson(challenge);
}

function consumeChallenge(document, challengeId, ceremony, options = {}) {
  const now = nowDate(options);
  const challenge = readDashboardPasskeyChallenge(document, challengeId, ceremony, { ...options, now });
  const normalized = normalizedStore(document, { ...options, now, trimExpired: false });
  return {
    normalized,
    challenge,
    challenges: normalized.challenges.filter((candidate) => (
      candidate.challenge_id !== challenge.challenge_id
      && Date.parse(candidate.expires_at) > now.getTime()
    )),
    now,
  };
}

export function completeDashboardPasskeyRegistration(document, challengeId, input, options = {}) {
  const consumed = consumeChallenge(document, challengeId, "registration", options);
  const credentialId = requireBase64url(input?.credential_id, "Passkey credential_id");
  if (consumed.normalized.credentials.some((credential) => credential.credential_id === credentialId)) {
    throw new Error(`Duplicate Passkey credential: ${credentialId}`);
  }
  const credential = normalizeCredential({
    credential_id: credentialId,
    public_key: input?.public_key,
    counter: input?.counter,
    transports: input?.transports,
    device_type: input?.device_type,
    backed_up: input?.backed_up,
    label: input?.label,
    created_at: consumed.now.toISOString(),
    last_used_at: null,
  });
  return {
    document: {
      ...consumed.normalized,
      credentials: [...consumed.normalized.credentials, credential],
      challenges: consumed.challenges,
      updated_at: consumed.now.toISOString(),
    },
    credential: publicCredential(credential),
  };
}

export function completeDashboardPasskeyAuthentication(document, challengeId, input, options = {}) {
  const consumed = consumeChallenge(document, challengeId, "authentication", options);
  const credentialId = requireBase64url(input?.credential_id, "Passkey credential_id");
  const index = consumed.normalized.credentials
    .findIndex((credential) => credential.credential_id === credentialId);
  if (index < 0) throw new Error(`Passkey credential not found: ${credentialId}`);
  const current = consumed.normalized.credentials[index];
  const counter = requireCounter(input?.counter);
  if (!(current.counter === 0 && counter === 0) && counter <= current.counter) {
    throw new Error("Invalid Passkey counter progression");
  }
  const updated = normalizeCredential({
    ...current,
    counter,
    transports: Object.hasOwn(input || {}, "transports") ? input.transports : current.transports,
    device_type: Object.hasOwn(input || {}, "device_type") ? input.device_type : current.device_type,
    backed_up: Object.hasOwn(input || {}, "backed_up") ? input.backed_up : current.backed_up,
    last_used_at: consumed.now.toISOString(),
  });
  const credentials = [...consumed.normalized.credentials];
  credentials[index] = updated;
  return {
    document: {
      ...consumed.normalized,
      credentials,
      challenges: consumed.challenges,
      updated_at: consumed.now.toISOString(),
    },
    credential: publicCredential(updated),
  };
}

export function renameDashboardPasskeyCredential(document, credentialId, label, options = {}) {
  const now = nowDate(options);
  const normalized = normalizedStore(document, { ...options, now });
  const targetId = requireBase64url(credentialId, "Passkey credential_id");
  const index = normalized.credentials.findIndex((credential) => credential.credential_id === targetId);
  if (index < 0) throw new Error(`Passkey credential not found: ${targetId}`);
  const updated = { ...normalized.credentials[index], label: requireLabel(label) };
  const credentials = [...normalized.credentials];
  credentials[index] = updated;
  return {
    document: { ...normalized, credentials, updated_at: now.toISOString() },
    credential: publicCredential(updated),
  };
}

export function deleteDashboardPasskeyCredential(document, credentialId, options = {}) {
  const now = nowDate(options);
  const normalized = normalizedStore(document, { ...options, now });
  const targetId = requireBase64url(credentialId, "Passkey credential_id");
  const index = normalized.credentials.findIndex((credential) => credential.credential_id === targetId);
  if (index < 0) throw new Error(`Passkey credential not found: ${targetId}`);
  const [deleted] = normalized.credentials.splice(index, 1);
  return {
    document: { ...normalized, updated_at: now.toISOString() },
    credential: publicCredential(deleted),
  };
}

function dashboardPasskeyBlobPath(env = process.env) {
  return optionalString(env.DASHBOARD_PASSKEY_BLOB_PATH) || defaultDashboardPasskeyBlobPath;
}

async function blobClient() {
  return import("@vercel/blob");
}

export async function loadDashboardPasskeyStore(options = {}) {
  const env = options.env || process.env;
  const token = optionalString(env.BLOB_READ_WRITE_TOKEN);
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  const pathname = options.pathname || dashboardPasskeyBlobPath(env);
  const blobApi = options.blobApi || await blobClient();
  const result = await blobApi.get(pathname, {
    access: "private",
    useCache: false,
    token,
  });
  if (!result) {
    return {
      document: emptyDashboardPasskeyStore(options),
      meta: { storage: "vercel-blob-private", pathname, etag: null },
    };
  }
  const text = await new Response(result.stream).text();
  return {
    document: normalizedStore(JSON.parse(text), options),
    meta: {
      storage: "vercel-blob-private",
      pathname: result.blob.pathname,
      etag: result.blob.etag,
    },
  };
}

export async function writeDashboardPasskeyStore(document, options = {}) {
  const env = options.env || process.env;
  const token = optionalString(env.BLOB_READ_WRITE_TOKEN);
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  const pathname = options.pathname || dashboardPasskeyBlobPath(env);
  const blobApi = options.blobApi || await blobClient();
  const normalized = normalizedStore(document, options);
  const ifMatch = normalizeBlobEtag(options.ifMatch);
  return blobApi.put(pathname, `${JSON.stringify(normalized, null, 2)}\n`, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: ifMatch ? true : options.allowOverwrite === true,
    cacheControlMaxAge: 60,
    contentType: "application/json",
    ...(ifMatch ? { ifMatch } : {}),
    token,
  });
}
