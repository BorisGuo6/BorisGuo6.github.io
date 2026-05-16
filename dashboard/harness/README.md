# Dashboard Harness

This harness keeps GitHub Pages static while giving agents a machine-readable control plane.

## Files

- `dashboard/state/portfolio.json`: global portfolio context, owned by the conductor.
- `dashboard/state/tasks.json`: task queue, owned by the conductor.
- `dashboard/state/projects/*.json`: per-project context.
- `dashboard/state/agents/*.json`: per-worker heartbeat and status.
- `dashboard/state/runs/*.json`: one verified result file per experiment run.

## Worker Commands

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

Workers should not edit `dashboard/index.html` during normal harness updates. They should write only their own `agents/{agent_id}.json` and `runs/{run_id}.json` files. The conductor owns `tasks.json` and `portfolio.json`.
