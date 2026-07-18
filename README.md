This is the source code for Jingxiang Guo's academic website: https://jingxiangguo.com

## Vercel Dashboard Backend

The dashboard can run as static JSON or through Vercel Functions under `api/dashboard/`.

Required Vercel environment variables for hosted writes:

- `BLOB_READ_WRITE_TOKEN`: Vercel Blob read/write token.
- `DASHBOARD_WRITE_TOKEN`: legacy private token entered in the dashboard UI to unlock writes.
- `DASHBOARD_WRITE_TOKEN_USERS`: optional JSON map from private random tokens to viewer names.
- `DASHBOARD_WRITE_TOKEN_<VIEWER>`: optional sensitive per-user token, for example
  `DASHBOARD_WRITE_TOKEN_YANXIANG`; the suffix becomes the lowercase viewer name.
- `DASHBOARD_BLOB_PATH`: optional, defaults to `dashboard-state/embodied-ai-dashboard.json`.

Without those variables, `/api/dashboard/state` falls back to bundled JSON and the dashboard stays read-only.

Hosted dashboard writes are token-gated. Human users unlock writes in `/dashboard/`; agents can use the same
`DASHBOARD_WRITE_TOKEN` through the Vercel API. Public agents can read `/api/dashboard/state`, but they cannot mutate
tasks or comments without that token.

For new users, prefer a separate sensitive `DASHBOARD_WRITE_TOKEN_<VIEWER>` variable so provisioning does not replace
or expose the existing sensitive token map. Generate at least 32 random bytes, keep the value outside Git, and deploy
after adding the variable because Vercel environment changes apply to new deployments.

Initial setup order:

1. Create or link the Vercel project.
2. Add a Vercel Blob store and expose `BLOB_READ_WRITE_TOKEN` to production and preview.
3. Add a private `DASHBOARD_WRITE_TOKEN` value to production and preview.
4. Seed the hosted dashboard snapshot once, only if no Blob snapshot exists yet:

```bash
BLOB_READ_WRITE_TOKEN=... npm run vercel:seed-blob:force
```

5. Deploy the site. Open `/dashboard/`; use the `Unlock` field with `DASHBOARD_WRITE_TOKEN` for hosted edits.

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
