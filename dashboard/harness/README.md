# Dashboard Harness

This harness keeps GitHub Pages static while giving agents a machine-readable control plane.

## Files

- `dashboard/state/portfolio.json`: global portfolio context, owned by the conductor.
- `dashboard/state/tasks.json`: task queue, owned by the conductor.
- `dashboard/state/projects/*.json`: per-project context.
- `dashboard/state/agents/*.json`: per-worker heartbeat and status.
- `dashboard/state/runs/*.json`: one verified result file per experiment run.

## Control Plane Contract

The HTML dashboard is for humans. Agents should read and write the JSON files, not parse rendered HTML.

- Task status lives in `tasks.json`.
- Task conclusions, discussion, blockers, and review notes live in `tasks[].comments[]`.
- Worker liveness and permission/blocker state lives in `agents/{agent_id}.json`.
- Experiment claims must point to a `runs/{run_id}.json` file with verifier status.

This repository-backed version is the static MVP. For cross-computer real-time sync, mirror the same JSON shapes behind a small API such as Supabase, Cloudflare D1/KV, Postgres, or a private service. The dashboard can keep rendering the same state contract.

## Worker Commands

By default these commands update the local JSON fallback files. Add `--remote` before the
subcommand to write through the Supabase `agent-event` API instead:

```bash
python3 dashboard/harness/agent_update.py --remote heartbeat \
  --agent-id claude-umi-01 \
  --project-id umi-world-model \
  --status running \
  --task-id task_umi_base_model_decision \
  --message "Running UMI base-model comparison"
```

Remote mode reads `SUPABASE_URL` and `AGENT_WRITE_TOKEN` from the shell or local `.env`.
Never commit the token.

Heartbeat:

```bash
python3 dashboard/harness/agent_update.py heartbeat \
  --agent-id claude-umi-01 \
  --project-id umi-world-model \
  --status running \
  --task-id task_umi_base_model_decision \
  --message "Comparing TI2V base models"
```

Needs user:

```bash
python3 dashboard/harness/agent_update.py needs_user \
  --agent-id claude-umi-01 \
  --project-id umi-world-model \
  --task-id task_umi_base_model_decision \
  --message "Need approval before launching long inference"
```

Update task status:

```bash
python3 dashboard/harness/agent_update.py task_status \
  --agent-id codex-conductor \
  --task-id task_real_robot_infra_wuji_glove \
  --status active \
  --due-at 2026-05-23 \
  --message "Claimed for Wuji glove bring-up"
```

Add a task comment:

```bash
python3 dashboard/harness/agent_update.py task_comment \
  --agent-id claude-umi-01 \
  --task-id task_umi_base_model_decision \
  --kind comment \
  --message "WAN2.2-TI2V launches cleanly; waiting on first qualitative samples."
```

Verified run:

```bash
python3 dashboard/harness/agent_update.py verified \
  --agent-id claude-umi-01 \
  --project-id umi-world-model \
  --task-id task_umi_base_model_decision \
  --run-id run_20260516_umi_001 \
  --started-at 2026-05-16T13:00:00+08:00 \
  --command "python scripts/eval.py --run-id run_20260516_umi_001" \
  --exit-code 0 \
  --git-sha abc123 \
  --metrics-path runs/run_20260516_umi_001/metrics.json \
  --verifier-command "python scripts/verify_run.py --run-id run_20260516_umi_001" \
  --verifier-exit-code 0 \
  --verifier-status passed \
  --message "Evaluation passed verifier"
```

Validate before commit:

```bash
python3 dashboard/harness/verify_state.py
```

## Ownership

Workers should not edit `dashboard/index.html` during normal harness updates. They should write only their own `agents/{agent_id}.json`, `runs/{run_id}.json`, and task comments/status updates through the harness. The conductor owns task assignment, `portfolio.json`, and broad dashboard summary edits.

For a GitHub Pages-only deployment, workers should commit/push state updates carefully or let a conductor merge them. For an API deployment, replace these file writes with equivalent authenticated API calls.
