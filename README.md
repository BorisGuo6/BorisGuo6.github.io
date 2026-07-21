This is the source code for Jingxiang Guo's academic website: https://jingxiangguo.com

## Vercel Dashboard Backend

The dashboard can run as static JSON or through Vercel Functions under `api/dashboard/`.

Required Vercel environment variables for hosted writes:

- `BLOB_READ_WRITE_TOKEN`: Vercel Blob read/write token.
- `DASHBOARD_WRITE_TOKEN`: bootstrap token for the code-reserved `jingxiang` administrator; it is the only credential
  with the `admin` role.
- `DASHBOARD_SESSION_SECRET`: independent random secret used to sign HttpOnly dashboard sessions.
- `DASHBOARD_PRIVATE_BLOB_PATH`: private dashboard snapshot path; defaults to
  `dashboard-state-private/embodied-ai-dashboard.json`.
- `DASHBOARD_ACCESS_BLOB_PATH`: private token registry path; defaults to
  `dashboard-access/access-control.json`.
- `DASHBOARD_WRITE_TOKEN_USERS`: optional JSON map from private random tokens to viewer names; use this for Vercel-managed
  viewer credentials instead of standalone per-user variables.
- `DASHBOARD_WRITE_TOKEN_<VIEWER>`: legacy sensitive per-user token compatibility only. Do not create new standalone
  per-user variables.
- `DASHBOARD_BLOB_PATH`: legacy public snapshot path used only while migrating existing state.

Without those variables, `/api/dashboard/state` falls back to bundled JSON and the dashboard stays read-only.

Hosted dashboard reads and writes are token-gated. The `jingxiang` administrator receives the full state and can open
the Settings dialog to create, rotate, copy, delete, disable, and scope viewer tokens. Environment-managed viewer tokens
are copied only through an authenticated, non-cached administrator request that reads the Vercel Function runtime; their
values are never written to dashboard state or browser storage. Dashboard-managed tokens remain one-time values because
the private registry stores only salted hashes and fingerprints. Viewer names are unique across both credential sources.
Viewers can read and mutate only their visible cards: Research cards are visible by default, and per-card
includes/excludes are enforced on both state reads and every mutation.

Production builds intentionally omit `dashboard/state/**`. The `?json=1` static fallback is restricted to localhost,
so production visibility cannot be bypassed through the bundled JSON mirror. The source repository still contains the
local mirror; do not treat cards committed to a public repository as confidential data.

`DASHBOARD_WRITE_TOKEN_USERS` credentials remain login-compatible and are scoped to the same Research-default visibility
as Settings-created viewers. Legacy `DASHBOARD_WRITE_TOKEN_<VIEWER>` variables are still accepted by the runtime only for
backward compatibility; prefer the administrator Settings dialog for new viewers, and use `DASHBOARD_WRITE_TOKEN_USERS`
if a Vercel environment credential is still needed.

Initial setup order:

1. Create or link the Vercel project.
2. Add a Vercel Blob store and expose `BLOB_READ_WRITE_TOKEN` to production and preview.
3. Add private `DASHBOARD_WRITE_TOKEN` and `DASHBOARD_SESSION_SECRET` values to production and preview, with
   no per-user token aliases for the administrator.
4. Seed the hosted dashboard snapshot once, only if no Blob snapshot exists yet:

```bash
BLOB_READ_WRITE_TOKEN=... npm run vercel:seed-blob:force
```

5. Deploy the site. Open `/dashboard/`; use the `Unlock` field with `DASHBOARD_WRITE_TOKEN`, then open Settings to
   provision viewer tokens.

Daily dashboard workflow is remote-first. Vercel Blob is the mutable source of truth; local JSON is a mirror for Git
history and static fallback. Before editing `dashboard/state/*.json`, pull the hosted snapshot:

```bash
npm run vercel:pull-blob
```

Do not run `npm run vercel:seed-blob` for normal task/status/comment work. That command intentionally refuses to run
without `--force`/`DASHBOARD_ALLOW_BLOB_SEED=1` because it overwrites the hosted Blob from local JSON. Hosted task edits
should go through `/api/dashboard/*` first, then pull Blob back into local files before committing.

Useful checks:

```bash
npm run test:dashboard
node --check scripts/dashboard-vercel-api.mjs
npm run vercel:pull-blob -- --dry-run
```

Supported hosted mutations:

- `POST /api/dashboard/task-create`
- `POST /api/dashboard/task-status`
- `POST /api/dashboard/task-comment`
- `POST /api/dashboard/task-comment-delete`
- `GET|POST|PATCH|DELETE /api/dashboard/access-users` (administrator only)
