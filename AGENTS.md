READ /Users/boris/.claude/AGENTS.md BEFORE ANYTHING (skip if missing).

## Agent skills

### Issue tracker

Work is tracked directly in the dashboard state files for now; external GitHub issues are optional. See `docs/agents/issue-tracker.md`.

### Dashboard task updates

The hosted dashboard is the cross-agent task control plane.

- Human page: `https://jingxiangguo.com/dashboard/`
- Machine-readable state: `https://jingxiangguo.com/api/dashboard/state`
- Health check: `https://jingxiangguo.com/api/dashboard/health`

Vercel Blob is the mutable source of truth. Local `dashboard/state/*.json` files are a Git/static fallback mirror, not the primary write target. Before editing local dashboard state files, sync from the hosted Blob:

```bash
set -a; source .env.local; set +a
HTTP_PROXY=http://127.0.0.1:7993 HTTPS_PROXY=http://127.0.0.1:7993 NODE_USE_ENV_PROXY=1 npm run vercel:pull-blob
```

Do not use `npm run vercel:seed-blob` for normal work. It overwrites the hosted Blob from local JSON and is guarded for disaster recovery only. Prefer hosted API writes, then run `npm run vercel:pull-blob` and commit the mirrored local state if a Git backup is needed.

Before updating a task, read the machine-readable state and locate the relevant `task_id` under `taskDoc.tasks`. Use task statuses only from this set: `todo`, `active`, `blocked`, `needs_user`, `review`, `done`.

Dashboard project intros are for durable architecture and status framing only.
Do not use a project intro, `intro_table`, timeline, or `details` array as an
execution log. If a note has an owner, due date, next step, next gate, command
to run, verification result, resource request, live training/download
telemetry, or decision that changes execution, put it in a new TODO or in a
comment on the existing relevant TODO. Keep project intros short enough to scan
before the task list; for UMI-style project cards, prefer a short stage summary
plus durable acceptance guardrails, and route all meeting action items into
`tasks.json`.
For the UMI card specifically, `npm run test:dashboard` enforces the guardrail:
summary <= 700 characters, details <= 12 entries, intro table <= 8 rows, and no
execution-field keys such as `owner`, `due`, `next_step`, `command`, `result`,
`verification`, `resource`, or telemetry-style fields in intro surfaces. If a
meeting note does not fit that budget, create or update a TODO instead of
expanding the intro.
DaiMeng/Daimon operational gates belong under `tactile-wam`, not
`umi-world-model`: causal_robot_daimon checkpoints, DaiMeng materialized
robot189/Gamma roots, `/mnt/data/datasets/daimon` materialization, post-2000
smoke/eval gates, and 10Kh-vs-Daimon queue/load decisions should be tracked on
the DaiMeng VTAM / Tactile-WAM project. UMI may reference their summarized
evidence as Stage 1 input, but should not own those operational TODOs.

Hosted writes require `DASHBOARD_WRITE_TOKEN`. Do not print, commit, or paste the token into comments. Send it as `x-dashboard-token: $DASHBOARD_WRITE_TOKEN` or `Authorization: Bearer $DASHBOARD_WRITE_TOKEN`.

Use these endpoints for dashboard interaction:

```bash
curl -fsS https://jingxiangguo.com/api/dashboard/state

curl -fsS -X POST https://jingxiangguo.com/api/dashboard/task-update \
  -H "content-type: application/json" \
  -H "x-dashboard-token: $DASHBOARD_WRITE_TOKEN" \
  --data '{"task_id":"task_example","title":"Updated title","description":"Updated acceptance criteria."}'

curl -fsS -X POST https://jingxiangguo.com/api/dashboard/task-status \
  -H "content-type: application/json" \
  -H "x-dashboard-token: $DASHBOARD_WRITE_TOKEN" \
  --data '{"task_id":"task_example","status":"active"}'

curl -fsS -X POST https://jingxiangguo.com/api/dashboard/task-comment \
  -H "content-type: application/json" \
  -H "x-dashboard-token: $DASHBOARD_WRITE_TOKEN" \
  --data '{"task_id":"task_example","body":"Progress note with concrete evidence and next step."}'
```

For routine hosted dashboard mutations, prefer the local wrapper instead of
hand-writing curl and mirror-pull commands:

```bash
npm run dashboard:mutate -- status --task-id task_example --status done --pull
npm run dashboard:mutate -- comment --task-id task_example --body "Progress note with concrete evidence and next step." --pull
npm run dashboard:mutate -- update --task-id task_example --title "Updated title" --description "Updated acceptance criteria." --pull
```

The wrapper reads Vercel Blob, applies the mutation, writes Vercel Blob,
re-reads and verifies the mutation, and only mirrors local JSON when `--pull`
is present. Use `--force-pull` only when the dashboard mirror has known
uncommitted generated drift and the hosted Blob has been verified as the source
of truth.

For existing work items use `POST /api/dashboard/task-update` for title, description, priority, assignee, or due-date edits; use `POST /api/dashboard/task-status` only for status transitions. For new work items use `POST /api/dashboard/task-create`; for cleanup use `POST /api/dashboard/task-comment-delete` with `task_id` and `comment_id`. After any write, re-read `/api/dashboard/state` and verify the mutation is visible. If no write token is available, leave the task unchanged and report the intended status/comment/update to the user.

### Triage labels

Use the default Matt Pocock triage vocabulary unless a future GitHub issue tracker is configured. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain document at `CONTEXT.md`; architectural decisions belong in `docs/adr/`. See `docs/agents/domain.md`.
