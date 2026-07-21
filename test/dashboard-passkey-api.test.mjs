import assert from "node:assert/strict";
import {
  createDashboardSession,
  dashboardPasskeyRpConfig,
  dashboardSessionAuth,
  handleDashboardPasskeyOptions,
  handleDashboardPasskeys,
  handleDashboardPasskeyVerify,
} from "../scripts/dashboard-vercel-api.mjs";
import {
  emptyDashboardPasskeyStore,
  findDashboardPasskeyCredential,
} from "../scripts/dashboard-passkeys.mjs";

function b64(value) {
  return Buffer.from(String(value)).toString("base64url");
}

function deterministicRandom(start = 0) {
  let call = start;
  return (length) => {
    call += 1;
    return Buffer.alloc(length, call);
  };
}

function responseProbe() {
  const headers = new Map();
  return {
    headers,
    statusCode: null,
    body: null,
    setHeader(name, value) {
      headers.set(String(name).toLocaleLowerCase("en-US"), value);
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return body;
    },
  };
}

async function invoke(handler, request, options) {
  const response = responseProbe();
  await handler({ headers: {}, ...request }, response, options);
  return response;
}

function cookieRequest(session, method, body) {
  return {
    method,
    headers: { cookie: `dashboard_session=${encodeURIComponent(session)}` },
    ...(body === undefined ? {} : { body }),
  };
}

assert.deepEqual(dashboardPasskeyRpConfig({}), {
  rpID: "jingxiangguo.com",
  origin: "https://jingxiangguo.com",
  rpName: "Jingxiang Guo Dashboard",
});
assert.deepEqual(dashboardPasskeyRpConfig({
  DASHBOARD_PASSKEY_RP_ID: "localhost",
  DASHBOARD_PASSKEY_ORIGIN: "http://localhost:3000",
  NODE_ENV: "development",
}), {
  rpID: "localhost",
  origin: "http://localhost:3000",
  rpName: "Jingxiang Guo Dashboard",
});
assert.throws(() => dashboardPasskeyRpConfig({
  DASHBOARD_PASSKEY_RP_ID: "example.com",
  DASHBOARD_PASSKEY_ORIGIN: "https://attacker.example",
}), /relying-party configuration/);
assert.throws(() => dashboardPasskeyRpConfig({
  DASHBOARD_PASSKEY_RP_ID: "localhost",
  DASHBOARD_PASSKEY_ORIGIN: "http://localhost:3000",
  VERCEL_ENV: "production",
}), /relying-party configuration/);

const now = new Date("2026-07-21T04:00:00.000Z");
const env = {
  BLOB_READ_WRITE_TOKEN: "mock-blob-token",
  DASHBOARD_SESSION_SECRET: "test-session-secret",
  DASHBOARD_WRITE_TOKEN: "admin-recovery-token",
  DASHBOARD_PASSKEY_RP_ID: "dashboard.example.com",
  DASHBOARD_PASSKEY_ORIGIN: "https://dashboard.example.com",
  VERCEL_ENV: "production",
};
let storedDocument = emptyDashboardPasskeyStore({
  now,
  randomBytes: deterministicRandom(),
});
let etagVersion = 0;
const storeCalls = [];
const loadPasskeyStore = async (options) => {
  storeCalls.push({ type: "load", options });
  return {
    document: structuredClone(storedDocument),
    meta: {
      storage: "vercel-blob-private",
      pathname: "dashboard-access/passkeys.json",
      etag: `\"etag-${etagVersion}\"`,
    },
  };
};
const writePasskeyStore = async (document, options) => {
  storeCalls.push({ type: "write", options });
  assert.equal(options.env, env);
  assert.equal(options.ifMatch, `\"etag-${etagVersion}\"`);
  storedDocument = structuredClone(document);
  etagVersion += 1;
  return {
    pathname: "dashboard-access/passkeys.json",
    etag: `\"etag-${etagVersion}\"`,
  };
};

const generatedRegistrationChallenge = b64("registration-server-challenge");
const generatedAuthenticationChallenge = b64("authentication-server-challenge");
let registrationGenerationInput;
let registrationVerificationInput;
let authenticationGenerationInput;
let authenticationVerificationInput;
let authenticationVerificationCount = 0;
const handlerOptions = {
  env,
  now,
  passkeyStoreOptions: { randomBytes: deterministicRandom(20), ttlMs: 60_000 },
  loadPasskeyStore,
  writePasskeyStore,
  async generateRegistrationOptions(input) {
    registrationGenerationInput = input;
    return {
      challenge: generatedRegistrationChallenge,
      rp: { id: input.rpID, name: input.rpName },
      user: { id: b64("public-user-id"), name: input.userName, displayName: input.userDisplayName },
      pubKeyCredParams: [],
      timeout: input.timeout,
    };
  },
  async verifyRegistrationResponse(input) {
    registrationVerificationInput = input;
    return {
      verified: true,
      registrationInfo: {
        credential: {
          id: b64("iphone-passkey-credential"),
          publicKey: new Uint8Array(Buffer.from("credential-public-key")),
          counter: 0,
          transports: ["internal", "hybrid"],
        },
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
      },
    };
  },
  async generateAuthenticationOptions(input) {
    authenticationGenerationInput = input;
    return {
      challenge: generatedAuthenticationChallenge,
      rpId: input.rpID,
      allowCredentials: input.allowCredentials,
      timeout: input.timeout,
      userVerification: input.userVerification,
    };
  },
  async verifyAuthenticationResponse(input) {
    authenticationVerificationCount += 1;
    authenticationVerificationInput = input;
    return {
      verified: true,
      authenticationInfo: {
        newCounter: 1,
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
      },
    };
  },
};

const adminSession = createDashboardSession({
  viewer: "jingxiang",
  role: "admin",
  source: "environment",
}, env, { now });
const viewerSession = createDashboardSession({
  viewer: "viewer",
  role: "viewer",
  source: "environment",
}, env, { now });

const unavailable = await invoke(
  handleDashboardPasskeyOptions,
  { method: "GET" },
  handlerOptions,
);
assert.equal(unavailable.statusCode, 200);
assert.deepEqual(unavailable.body, { ok: true, available: false });
assert.equal(unavailable.headers.get("cache-control"), "no-store");

const anonymousRegistration = await invoke(handleDashboardPasskeyOptions, {
  method: "POST",
  body: { ceremony: "registration" },
}, handlerOptions);
assert.equal(anonymousRegistration.statusCode, 401);
assert.equal(anonymousRegistration.body.ok, false);

const viewerRegistration = await invoke(
  handleDashboardPasskeyOptions,
  cookieRequest(viewerSession, "POST", { ceremony: "registration" }),
  handlerOptions,
);
assert.equal(viewerRegistration.statusCode, 403);
assert.equal(viewerRegistration.body.ok, false);

const registrationOptionsResponse = await invoke(
  handleDashboardPasskeyOptions,
  cookieRequest(adminSession, "POST", { ceremony: "registration" }),
  handlerOptions,
);
assert.equal(registrationOptionsResponse.statusCode, 200);
assert.equal(registrationOptionsResponse.body.ok, true);
assert.equal(registrationOptionsResponse.body.options.challenge, generatedRegistrationChallenge);
assert.ok(registrationOptionsResponse.body.ceremony_id);
assert.equal(registrationGenerationInput.rpID, "dashboard.example.com");
assert.equal(registrationGenerationInput.rpName, "Jingxiang Guo Dashboard");
assert.equal(registrationGenerationInput.userName, "jingxiang");
assert.equal(registrationGenerationInput.authenticatorSelection.residentKey, "required");
assert.equal(registrationGenerationInput.authenticatorSelection.userVerification, "required");
assert.equal(registrationGenerationInput.attestationType, "none");
assert.deepEqual(registrationGenerationInput.excludeCredentials, []);
assert.deepEqual(
  Buffer.from(registrationGenerationInput.userID),
  Buffer.from(storedDocument.admin_user_id, "base64url"),
);
assert.equal(storedDocument.challenges.length, 1);

const anonymousRegistrationVerify = await invoke(handleDashboardPasskeyVerify, {
  method: "POST",
  body: {
    ceremony: "registration",
    ceremony_id: registrationOptionsResponse.body.ceremony_id,
    label: "Phone",
    response: { id: b64("iphone-passkey-credential") },
  },
}, handlerOptions);
assert.equal(anonymousRegistrationVerify.statusCode, 401);

const registrationResponse = await invoke(
  handleDashboardPasskeyVerify,
  cookieRequest(adminSession, "POST", {
    ceremony: "registration",
    ceremony_id: registrationOptionsResponse.body.ceremony_id,
    label: "Boris iPhone",
    response: { id: b64("iphone-passkey-credential"), type: "public-key" },
  }),
  handlerOptions,
);
assert.equal(registrationResponse.statusCode, 201);
assert.equal(registrationResponse.body.ok, true);
assert.equal(registrationResponse.body.passkey.label, "Boris iPhone");
assert.equal(Object.hasOwn(registrationResponse.body.passkey, "public_key"), false);
assert.equal(storedDocument.challenges.length, 0, "registration verification consumes the stored challenge");
assert.equal(storedDocument.credentials.length, 1);
assert.equal(registrationVerificationInput.expectedChallenge, generatedRegistrationChallenge);
assert.equal(registrationVerificationInput.expectedOrigin, "https://dashboard.example.com");
assert.equal(registrationVerificationInput.expectedRPID, "dashboard.example.com");
assert.equal(registrationVerificationInput.expectedType, "webauthn.create");
assert.equal(registrationVerificationInput.requireUserPresence, true);
assert.equal(registrationVerificationInput.requireUserVerification, true);

const available = await invoke(
  handleDashboardPasskeyOptions,
  { method: "GET" },
  handlerOptions,
);
assert.deepEqual(available.body, { ok: true, available: true });

const authenticationOptionsResponse = await invoke(handleDashboardPasskeyOptions, {
  method: "POST",
  body: { ceremony: "authentication" },
}, handlerOptions);
assert.equal(authenticationOptionsResponse.statusCode, 200);
assert.equal(authenticationOptionsResponse.body.options.challenge, generatedAuthenticationChallenge);
assert.equal(authenticationGenerationInput.rpID, "dashboard.example.com");
assert.equal(authenticationGenerationInput.userVerification, "required");
assert.deepEqual(authenticationGenerationInput.allowCredentials, [{
  id: b64("iphone-passkey-credential"),
  transports: ["internal", "hybrid"],
}]);
assert.equal(storedDocument.challenges.length, 1);

const authenticationRequest = {
  method: "POST",
  headers: { host: "dashboard.example.com", "x-forwarded-proto": "https" },
  body: {
    ceremony: "authentication",
    ceremony_id: authenticationOptionsResponse.body.ceremony_id,
    response: { id: b64("iphone-passkey-credential"), type: "public-key" },
  },
};
const unknownCredentialResponse = await invoke(
  handleDashboardPasskeyVerify,
  {
    ...authenticationRequest,
    body: {
      ...authenticationRequest.body,
      response: { id: b64("unknown-passkey-credential"), type: "public-key" },
    },
  },
  handlerOptions,
);
assert.equal(unknownCredentialResponse.statusCode, 401);
assert.equal(unknownCredentialResponse.body.error, "Passkey authentication failed");
assert.equal(authenticationVerificationCount, 0, "unknown credentials are rejected before WebAuthn verification");
assert.equal(storedDocument.challenges.length, 1, "an unknown credential does not mutate the ceremony");
const authenticationResponse = await invoke(
  handleDashboardPasskeyVerify,
  authenticationRequest,
  handlerOptions,
);
assert.equal(authenticationResponse.statusCode, 200);
assert.equal(authenticationResponse.body.ok, true);
assert.equal(authenticationResponse.body.write_auth.role, "admin");
assert.equal(authenticationResponse.body.write_auth.viewer, "jingxiang");
assert.equal(Object.hasOwn(authenticationResponse.body, "token"), false);
assert.equal(storedDocument.challenges.length, 0, "authentication verification consumes the stored challenge");
assert.equal(findDashboardPasskeyCredential(storedDocument, b64("iphone-passkey-credential")).counter, 1);
assert.equal(authenticationVerificationInput.expectedChallenge, generatedAuthenticationChallenge);
assert.equal(authenticationVerificationInput.expectedOrigin, "https://dashboard.example.com");
assert.equal(authenticationVerificationInput.expectedRPID, "dashboard.example.com");
assert.equal(authenticationVerificationInput.expectedType, "webauthn.get");
assert.equal(authenticationVerificationInput.requireUserVerification, true);
assert.deepEqual(
  Buffer.from(authenticationVerificationInput.credential.publicKey),
  Buffer.from("credential-public-key"),
);
const setCookie = authenticationResponse.headers.get("set-cookie");
assert.match(setCookie, /^dashboard_session=/);
assert.match(setCookie, /Path=\/api\/dashboard/);
assert.match(setCookie, /HttpOnly/);
assert.match(setCookie, /SameSite=Strict/);
assert.match(setCookie, /Secure/);
assert.match(setCookie, /Max-Age=604800/);
const cookieValue = decodeURIComponent(/^dashboard_session=([^;]+)/.exec(setCookie)[1]);
const passkeySessionAuth = dashboardSessionAuth({
  headers: { cookie: `dashboard_session=${encodeURIComponent(cookieValue)}` },
}, env, { now: new Date(now.getTime() + 1_000) });
assert.equal(passkeySessionAuth.ok, true);
assert.equal(passkeySessionAuth.role, "admin");
assert.equal(passkeySessionAuth.source, "passkey");

const replayResponse = await invoke(
  handleDashboardPasskeyVerify,
  authenticationRequest,
  handlerOptions,
);
assert.equal(replayResponse.statusCode, 401);
assert.equal(replayResponse.body.error, "Passkey authentication failed");
assert.equal(authenticationVerificationCount, 1, "a replay is rejected before WebAuthn verification");

const anonymousList = await invoke(handleDashboardPasskeys, { method: "GET" }, handlerOptions);
assert.equal(anonymousList.statusCode, 401);
const viewerList = await invoke(
  handleDashboardPasskeys,
  cookieRequest(viewerSession, "GET"),
  handlerOptions,
);
assert.equal(viewerList.statusCode, 403);
const adminList = await invoke(
  handleDashboardPasskeys,
  cookieRequest(adminSession, "GET"),
  handlerOptions,
);
assert.equal(adminList.statusCode, 200);
assert.equal(adminList.body.passkeys.length, 1);
assert.equal(Object.hasOwn(adminList.body.passkeys[0], "public_key"), false);
assert.equal(adminList.body.recovery.token_login_available, true);

const anonymousRename = await invoke(handleDashboardPasskeys, {
  method: "PATCH",
  body: { credential_id: b64("iphone-passkey-credential"), label: "Nope" },
}, handlerOptions);
assert.equal(anonymousRename.statusCode, 401);
const renamed = await invoke(
  handleDashboardPasskeys,
  cookieRequest(adminSession, "PATCH", {
    credential_id: b64("iphone-passkey-credential"),
    label: "Main phone",
  }),
  handlerOptions,
);
assert.equal(renamed.statusCode, 200);
assert.equal(renamed.body.passkey.label, "Main phone");
assert.equal(Object.hasOwn(renamed.body.passkey, "public_key"), false);

const viewerDelete = await invoke(
  handleDashboardPasskeys,
  cookieRequest(viewerSession, "DELETE", {
    credential_id: b64("iphone-passkey-credential"),
  }),
  handlerOptions,
);
assert.equal(viewerDelete.statusCode, 403);
const deleted = await invoke(
  handleDashboardPasskeys,
  cookieRequest(adminSession, "DELETE", {
    credential_id: b64("iphone-passkey-credential"),
  }),
  handlerOptions,
);
assert.equal(deleted.statusCode, 200);
assert.equal(deleted.body.deleted, true);
assert.equal(Object.hasOwn(deleted.body.passkey, "public_key"), false);
assert.equal(storedDocument.credentials.length, 0);
assert.match(deleted.body.recovery_notice, /administrator token remains available/);
assert.ok(storeCalls.some((call) => call.type === "write"));

console.log("dashboard passkey API tests passed");
