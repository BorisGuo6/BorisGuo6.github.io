READ /Users/boris/.claude/AGENTS.md BEFORE ANYTHING (skip if missing).

## Agent skills

### Issue tracker

Work is tracked directly in the dashboard state files for now; external GitHub issues are optional. See `docs/agents/issue-tracker.md`.

### Dashboard task updates

The hosted dashboard is the cross-agent task control plane.

- Human page: `https://jingxiangguo.com/dashboard/`
- Machine-readable state: `https://jingxiangguo.com/api/dashboard/state`
- Health check: `https://jingxiangguo.com/api/dashboard/health`

Before updating a task, read the machine-readable state and locate the relevant `task_id` under `taskDoc.tasks`. Use task statuses only from this set: `todo`, `active`, `blocked`, `needs_user`, `review`, `done`.

Hosted writes require `DASHBOARD_WRITE_TOKEN`. Do not print, commit, or paste the token into comments. Send it as `x-dashboard-token: $DASHBOARD_WRITE_TOKEN` or `Authorization: Bearer $DASHBOARD_WRITE_TOKEN`.

Use these endpoints for dashboard interaction:

```bash
curl -fsS https://jingxiangguo.com/api/dashboard/state

curl -fsS -X POST https://jingxiangguo.com/api/dashboard/task-status \
  -H "content-type: application/json" \
  -H "x-dashboard-token: $DASHBOARD_WRITE_TOKEN" \
  --data '{"task_id":"task_example","status":"active"}'

curl -fsS -X POST https://jingxiangguo.com/api/dashboard/task-comment \
  -H "content-type: application/json" \
  -H "x-dashboard-token: $DASHBOARD_WRITE_TOKEN" \
  --data '{"task_id":"task_example","body":"Progress note with concrete evidence and next step."}'
```

For new work items use `POST /api/dashboard/task-create`; for cleanup use `POST /api/dashboard/task-comment-delete` with `task_id` and `comment_id`. After any write, re-read `/api/dashboard/state` and verify the mutation is visible. If no write token is available, leave the task unchanged and report the intended status/comment to the user.

### Triage labels

Use the default Matt Pocock triage vocabulary unless a future GitHub issue tracker is configured. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context domain document at `CONTEXT.md`; architectural decisions belong in `docs/adr/`. See `docs/agents/domain.md`.
