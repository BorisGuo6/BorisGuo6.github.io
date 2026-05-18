# Dashboard Agent Instructions

This repository is a public project dashboard. Treat it as the source of truth
for project summaries, TODOs, progress notes, blockers, and human-readable task
comments. Runtime agent/session control belongs outside this repository.

## Operating Loop

At the start of every session, and again before making edits:

1. Read `dashboard/state/portfolio.json`.
2. Read `dashboard/state/tasks.json`.
3. Read the relevant `dashboard/state/projects/<project_id>.json` files.
4. Identify the active TODOs by `status`, `priority`, `due_at`, and project
   context before choosing what to update.

For long-running work, update the dashboard whenever task state changes, and
before going idle or stopping:

- Mark a task `active` only when you are actually working on it.
- Mark a task `blocked` only when the blocker is concrete and actionable.
- Mark a task `done` only when the result is already reflected in the project
  state or in a task comment.
- Add concise comments for meaningful progress, blockers, decisions, and final
  results.
- Use absolute dates when a date matters.

## Allowed Dashboard Edits

Normal maintenance should be limited to:

- `dashboard/state/tasks.json`
- `dashboard/state/portfolio.json`
- `dashboard/state/projects/*.json`

Only edit `dashboard/index.html`, styles, scripts, Supabase migrations, or
schema files when the user explicitly asks for dashboard UI/schema/database
work.

## Task Comment Contract

When appending a task comment:

- Use a stable `comment_id` such as `comment_<task_id>_<short_slug>`.
- Use `author` values like `Progress`, `Result`, `Blocker`, or `Decision`.
- Use `kind` values already supported by `dashboard/schemas/task.schema.json`.
- Keep `body` focused on project/TODO facts and evidence.
- Do not include session URLs, local hostnames, remote host IPs, tool tokens,
  API keys, private paths, or agent runtime configuration.

When completing a task:

- Set `status` to `done`.
- Set `completed_at` to the exact date.
- Add a `result` comment that states what changed and where the evidence lives.
- Update any affected project summary, details, risks, or decisions if the task
  outcome changes the project state.

## Boundaries

Never store these in this repository:

- Claude Code session IDs or remote-control links.
- ClawCross runtime state, harness state, worker heartbeats, or CLI config.
- API keys, service-role keys, tokens, passwords, or secret-bearing logs.
- Machine-specific paths unless they are part of a public project artifact.

Do not recreate `dashboard/harness`, `dashboard/state/agents`,
`dashboard/state/runs`, agent-event Edge Functions, or agent/run schemas. Those
runtime concerns belong in ClawCross or another private control plane.

## Behavioral Guardrails

Use Karpathy-style coding discipline:

- Think before editing. State assumptions when the task is ambiguous.
- Keep changes simple. Do not add new systems when a small JSON update solves
  the problem.
- Make surgical edits. Every changed line must trace back to the requested
  dashboard/TODO update.
- Verify the result. At minimum, parse changed JSON files and run the dashboard
  seed SQL generator after task-state edits.

Suggested verification commands:

```bash
node -e "for (const f of ['dashboard/state/portfolio.json','dashboard/state/tasks.json']) JSON.parse(require('fs').readFileSync(f,'utf8')); console.log('json ok')"
npm run supabase:seed-sql >/tmp/dashboard-seed.sql
git diff --check
```

