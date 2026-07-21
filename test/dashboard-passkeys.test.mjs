import assert from "node:assert/strict";
import {
  completeDashboardPasskeyAuthentication,
  completeDashboardPasskeyRegistration,
  createDashboardPasskeyChallenge,
  dashboardPasskeyChallengeLimit,
  dashboardPasskeysSchemaVersion,
  defaultDashboardPasskeyBlobPath,
  deleteDashboardPasskeyCredential,
  emptyDashboardPasskeyStore,
  findDashboardPasskeyCredential,
  listDashboardPasskeyCredentials,
  loadDashboardPasskeyStore,
  normalizeDashboardPasskeyStore,
  readDashboardPasskeyChallenge,
  renameDashboardPasskeyCredential,
  writeDashboardPasskeyStore,
} from "../scripts/dashboard-passkeys.mjs";

function deterministicRandom(start = 0) {
  let call = start;
  return (length) => {
    call += 1;
    return Buffer.alloc(length, call);
  };
}

function b64(value) {
  return Buffer.from(String(value)).toString("base64url");
}

const start = new Date("2026-07-21T03:00:00.000Z");
const empty = emptyDashboardPasskeyStore({ now: start, randomBytes: deterministicRandom() });
assert.equal(empty.schema_version, dashboardPasskeysSchemaVersion);
assert.equal(Buffer.from(empty.admin_user_id, "base64url").length, 32);
assert.equal(empty.updated_at, start.toISOString());
assert.deepEqual(empty.credentials, []);
assert.deepEqual(empty.challenges, []);
assert.equal(normalizeDashboardPasskeyStore(empty, { now: start }).admin_user_id, empty.admin_user_id);

const registration = createDashboardPasskeyChallenge(empty, { ceremony: "registration" }, {
  now: start,
  randomBytes: deterministicRandom(10),
  ttlMs: 60_000,
});
assert.equal(registration.challenge.ceremony, "registration");
assert.equal(Buffer.from(registration.challenge.challenge_id, "base64url").length, 16);
assert.equal(Buffer.from(registration.challenge.challenge, "base64url").length, 32);
assert.equal(registration.challenge.expires_at, "2026-07-21T03:01:00.000Z");
assert.equal(registration.document.admin_user_id, empty.admin_user_id);
assert.equal(empty.challenges.length, 0, "mutations must not modify their input document");
assert.deepEqual(
  readDashboardPasskeyChallenge(
    registration.document,
    registration.challenge.challenge_id,
    "registration",
    { now: new Date("2026-07-21T03:00:30.000Z") },
  ),
  registration.challenge,
);
assert.throws(
  () => readDashboardPasskeyChallenge(
    registration.document,
    registration.challenge.challenge_id,
    "authentication",
    { now: new Date("2026-07-21T03:00:30.000Z") },
  ),
  /challenge ceremony/,
);
assert.throws(
  () => readDashboardPasskeyChallenge(
    registration.document,
    registration.challenge.challenge_id,
    "registration",
    { now: new Date("2026-07-21T03:01:00.000Z") },
  ),
  /Expired Passkey challenge/,
);

const registered = completeDashboardPasskeyRegistration(
  registration.document,
  registration.challenge.challenge_id,
  {
    credential_id: b64("credential-1"),
    public_key: b64("cose-public-key-1"),
    counter: 3,
    transports: ["internal", "hybrid", "internal"],
    device_type: "multiDevice",
    backed_up: true,
    label: "Boris’s iPhone",
  },
  { now: new Date("2026-07-21T03:00:45.000Z") },
);
assert.equal(registered.document.challenges.length, 0, "registration completion consumes its challenge");
assert.equal(registered.document.credentials.length, 1);
assert.deepEqual(registered.credential.transports, ["internal", "hybrid"]);
assert.equal(registered.credential.last_used_at, null);
assert.equal(Object.hasOwn(registered.credential, "public_key"), false, "public credential lists omit verification keys");
assert.equal(
  findDashboardPasskeyCredential(registered.document, b64("credential-1")).public_key,
  b64("cose-public-key-1"),
);
assert.equal(Object.hasOwn(listDashboardPasskeyCredentials(registered.document)[0], "public_key"), false);
assert.throws(
  () => completeDashboardPasskeyRegistration(
    registered.document,
    registration.challenge.challenge_id,
    {
      credential_id: b64("credential-2"),
      public_key: b64("key-2"),
      counter: 0,
      transports: [],
      device_type: "singleDevice",
      backed_up: false,
      label: "Replay",
    },
    { now: new Date("2026-07-21T03:00:50.000Z") },
  ),
  /challenge not found/,
);

const duplicateChallenge = createDashboardPasskeyChallenge(registered.document, {
  ceremony: "registration",
  challenge_id: b64("duplicate-challenge"),
  challenge: b64("duplicate-random-value"),
}, { now: new Date("2026-07-21T03:02:00.000Z") });
assert.throws(
  () => completeDashboardPasskeyRegistration(
    duplicateChallenge.document,
    duplicateChallenge.challenge.challenge_id,
    {
      credential_id: b64("credential-1"),
      public_key: b64("replacement-key"),
      counter: 0,
      transports: [],
      device_type: "singleDevice",
      backed_up: false,
      label: "Duplicate",
    },
    { now: new Date("2026-07-21T03:02:01.000Z") },
  ),
  /Duplicate Passkey credential/,
);
assert.equal(
  duplicateChallenge.document.challenges.length,
  1,
  "a failed completion cannot consume the caller's immutable source document",
);

const authentication = createDashboardPasskeyChallenge(registered.document, {
  ceremony: "authentication",
  challenge_id: b64("authentication-1"),
  challenge: b64("authentication-random-value"),
}, { now: new Date("2026-07-21T03:03:00.000Z") });
assert.throws(
  () => completeDashboardPasskeyRegistration(
    authentication.document,
    authentication.challenge.challenge_id,
    {
      credential_id: b64("credential-wrong-ceremony"),
      public_key: b64("wrong-key"),
      counter: 0,
      transports: [],
      device_type: "singleDevice",
      backed_up: false,
      label: "Wrong ceremony",
    },
    { now: new Date("2026-07-21T03:03:01.000Z") },
  ),
  /challenge ceremony/,
);
const authenticated = completeDashboardPasskeyAuthentication(
  authentication.document,
  authentication.challenge.challenge_id,
  {
    credential_id: b64("credential-1"),
    counter: 4,
    transports: ["internal"],
    device_type: "multiDevice",
    backed_up: false,
  },
  { now: new Date("2026-07-21T03:03:02.000Z") },
);
assert.equal(authenticated.document.challenges.length, 0);
assert.equal(authenticated.credential.counter, 4);
assert.equal(authenticated.credential.last_used_at, "2026-07-21T03:03:02.000Z");
assert.equal(authenticated.credential.device_type, "multiDevice");
assert.equal(authenticated.credential.backed_up, false);
assert.deepEqual(authenticated.credential.transports, ["internal"]);
assert.throws(
  () => completeDashboardPasskeyAuthentication(
    authenticated.document,
    authentication.challenge.challenge_id,
    { credential_id: b64("credential-1"), counter: 5 },
    { now: new Date("2026-07-21T03:03:03.000Z") },
  ),
  /challenge not found/,
);

const rollbackChallenge = createDashboardPasskeyChallenge(authenticated.document, {
  ceremony: "authentication",
  challenge_id: b64("authentication-rollback"),
  challenge: b64("rollback-random-value"),
}, { now: new Date("2026-07-21T03:04:00.000Z") });
assert.throws(
  () => completeDashboardPasskeyAuthentication(
    rollbackChallenge.document,
    rollbackChallenge.challenge.challenge_id,
    { credential_id: b64("credential-1"), counter: 4 },
    { now: new Date("2026-07-21T03:04:01.000Z") },
  ),
  /counter progression/,
);

const renamed = renameDashboardPasskeyCredential(
  authenticated.document,
  b64("credential-1"),
  "Travel phone",
  { now: new Date("2026-07-21T03:05:00.000Z") },
);
assert.equal(renamed.credential.label, "Travel phone");
assert.equal(findDashboardPasskeyCredential(renamed.document, b64("credential-1")).public_key, b64("cose-public-key-1"));
assert.throws(
  () => renameDashboardPasskeyCredential(renamed.document, b64("credential-1"), `bad\u0000label`, { now: start }),
  /control characters/,
);
const deleted = deleteDashboardPasskeyCredential(
  renamed.document,
  b64("credential-1"),
  { now: new Date("2026-07-21T03:06:00.000Z") },
);
assert.equal(deleted.credential.label, "Travel phone");
assert.equal(deleted.document.credentials.length, 0);
assert.equal(findDashboardPasskeyCredential(deleted.document, b64("credential-1")), null);
assert.throws(
  () => deleteDashboardPasskeyCredential(deleted.document, b64("credential-1"), { now: start }),
  /credential not found/,
);

let capped = empty;
for (let index = 0; index < dashboardPasskeyChallengeLimit + 3; index += 1) {
  capped = createDashboardPasskeyChallenge(capped, {
    ceremony: index % 2 === 0 ? "registration" : "authentication",
    challenge_id: b64(`cap-id-${index}`),
    challenge: b64(`cap-value-${index}`),
  }, {
    now: new Date(start.getTime() + index * 1_000),
    ttlMs: 60 * 60 * 1000,
  }).document;
}
assert.equal(capped.challenges.length, dashboardPasskeyChallengeLimit);
assert.equal(capped.challenges[0].challenge_id, b64("cap-id-3"), "oldest excess challenges are trimmed");
const expiredTrimmed = normalizeDashboardPasskeyStore(capped, {
  now: new Date(start.getTime() + 2 * 60 * 60 * 1000),
});
assert.equal(expiredTrimmed.challenges.length, 0);

assert.throws(
  () => normalizeDashboardPasskeyStore({ ...empty, schema_version: "wrong" }, { now: start }),
  /schema_version/,
);
assert.throws(
  () => normalizeDashboardPasskeyStore({
    ...empty,
    credentials: [{
      credential_id: b64("bad-transport"),
      public_key: b64("key"),
      counter: 0,
      transports: ["telepathy"],
      device_type: "singleDevice",
      backed_up: false,
      label: "Bad transport",
      created_at: start.toISOString(),
      last_used_at: null,
    }],
  }, { now: start }),
  /Invalid Passkey transport/,
);
assert.throws(
  () => normalizeDashboardPasskeyStore({
    ...empty,
    credentials: [{
      credential_id: b64("bad-counter"),
      public_key: b64("key"),
      counter: -1,
      transports: [],
      device_type: "singleDevice",
      backed_up: false,
      label: "Bad counter",
      created_at: start.toISOString(),
      last_used_at: null,
    }],
  }, { now: start }),
  /Invalid Passkey counter/,
);

const blobReads = [];
const loaded = await loadDashboardPasskeyStore({
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_PASSKEY_BLOB_PATH: "custom/passkeys.json",
  },
  now: new Date("2026-07-21T03:03:03.000Z"),
  blobApi: {
    async get(pathname, options) {
      blobReads.push({ pathname, options });
      return {
        stream: new Response(JSON.stringify(authenticated.document)).body,
        blob: { pathname, etag: 'W/"passkey-read-etag"' },
      };
    },
  },
});
assert.equal(blobReads[0].pathname, "custom/passkeys.json");
assert.deepEqual(blobReads[0].options, {
  access: "private",
  useCache: false,
  token: "blob-token",
});
assert.equal(loaded.document.credentials[0].credential_id, b64("credential-1"));
assert.equal(loaded.meta.storage, "vercel-blob-private");
assert.equal(loaded.meta.etag, 'W/"passkey-read-etag"');

const blobWrites = [];
await writeDashboardPasskeyStore(loaded.document, {
  env: {
    BLOB_READ_WRITE_TOKEN: "blob-token",
    DASHBOARD_PASSKEY_BLOB_PATH: "custom/passkeys.json",
  },
  now: new Date("2026-07-21T03:03:03.000Z"),
  ifMatch: 'W/"passkey-read-etag"',
  blobApi: {
    async put(pathname, body, options) {
      blobWrites.push({ pathname, body, options });
      return { pathname, etag: '"passkey-write-etag"' };
    },
  },
});
assert.equal(blobWrites[0].pathname, "custom/passkeys.json");
assert.equal(blobWrites[0].options.access, "private");
assert.equal(blobWrites[0].options.addRandomSuffix, false);
assert.equal(blobWrites[0].options.allowOverwrite, true);
assert.equal(blobWrites[0].options.ifMatch, '"passkey-read-etag"');
assert.equal(JSON.parse(blobWrites[0].body).schema_version, dashboardPasskeysSchemaVersion);

const missing = await loadDashboardPasskeyStore({
  env: { BLOB_READ_WRITE_TOKEN: "blob-token" },
  now: start,
  randomBytes: deterministicRandom(30),
  blobApi: { async get() { return null; } },
});
assert.equal(missing.meta.pathname, defaultDashboardPasskeyBlobPath);
assert.equal(missing.meta.etag, null);
assert.equal(Buffer.from(missing.document.admin_user_id, "base64url").length, 32);
await assert.rejects(
  loadDashboardPasskeyStore({ env: {} }),
  /BLOB_READ_WRITE_TOKEN is not configured/,
);
await assert.rejects(
  writeDashboardPasskeyStore(empty, { env: {} }),
  /BLOB_READ_WRITE_TOKEN is not configured/,
);

console.log("dashboard passkey store tests passed");
