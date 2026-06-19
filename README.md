This is the source code for Jingxiang Guo's academic website: https://jingxiangguo.com

## Vercel Dashboard Backend

The dashboard can run as static JSON or through Vercel Functions under `api/dashboard/`.

Required Vercel environment variables for hosted writes:

- `BLOB_READ_WRITE_TOKEN`: Vercel Blob read/write token.
- `DASHBOARD_WRITE_TOKEN`: private token entered in the dashboard UI to unlock writes.
- `DASHBOARD_BLOB_PATH`: optional, defaults to `dashboard-state/embodied-ai-dashboard.json`.

Without those variables, `/api/dashboard/state` falls back to bundled JSON and the dashboard stays read-only.

Hosted dashboard writes are token-gated. Human users unlock writes in `/dashboard/`; agents can use the same
`DASHBOARD_WRITE_TOKEN` through the Vercel API. Public agents can read `/api/dashboard/state`, but they cannot mutate
tasks or comments without that token.

Initial setup order:

1. Create or link the Vercel project.
2. Add a Vercel Blob store and expose `BLOB_READ_WRITE_TOKEN` to production and preview.
3. Add a private `DASHBOARD_WRITE_TOKEN` value to production and preview.
4. Seed the hosted dashboard snapshot:

```bash
BLOB_READ_WRITE_TOKEN=... npm run vercel:seed-blob
```

5. Deploy the site. Open `/dashboard/`; use the `Unlock` field with `DASHBOARD_WRITE_TOKEN` for hosted edits.

Useful checks:

```bash
npm run test:dashboard
node --check scripts/dashboard-vercel-api.mjs
```

Supported hosted mutations:

- `POST /api/dashboard/task-create`
- `POST /api/dashboard/task-status`
- `POST /api/dashboard/task-comment`
- `POST /api/dashboard/task-comment-delete`
