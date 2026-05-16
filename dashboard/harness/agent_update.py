#!/usr/bin/env python3
"""Update static dashboard state files for local agent workers.

This writes only local JSON files. A worker still needs a separate git commit/push
or conductor step to publish the update through GitHub Pages.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any


DASHBOARD_DIR = Path(__file__).resolve().parents[1]
STATE_DIR = DASHBOARD_DIR / "state"
AGENTS_DIR = STATE_DIR / "agents"
RUNS_DIR = STATE_DIR / "runs"
SAFE_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$")
SAFE_RUN_ID = re.compile(r"^run_[0-9]{8}_[a-zA-Z0-9_]+$")


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def require_safe_id(value: str, label: str) -> str:
    if not SAFE_ID.fullmatch(value):
        raise SystemExit(f"{label} contains unsafe characters: {value!r}")
    return value


def require_safe_run_id(value: str) -> str:
    if not SAFE_RUN_ID.fullmatch(value):
        raise SystemExit(f"run_id must look like run_YYYYMMDD_name: {value!r}")
    return value


def read_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return dict(default)
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2, sort_keys=False) + "\n",
        encoding="utf-8",
    )


def agent_path(agent_id: str) -> Path:
    return AGENTS_DIR / f"{require_safe_id(agent_id, 'agent_id')}.json"


def run_path(run_id: str) -> Path:
    return RUNS_DIR / f"{require_safe_run_id(run_id)}.json"


def load_agent(args: argparse.Namespace) -> dict[str, Any]:
    default = {
        "schema_version": "agent.v1",
        "agent_id": args.agent_id,
        "agent_type": "claude-code-worker",
        "project_id": args.project_id,
        "status": "idle",
        "capabilities": [],
        "current_task_id": None,
        "last_heartbeat_at": now_iso(),
        "needs_user": False,
        "message": None,
        "worktree": None,
        "branch": None,
        "git_sha": None,
        "last_run_id": None,
        "updated_at": now_iso(),
    }
    agent = read_json(agent_path(args.agent_id), default)
    if args.project_id:
        agent["project_id"] = args.project_id
    return agent


def apply_common_agent_fields(agent: dict[str, Any], args: argparse.Namespace) -> None:
    if getattr(args, "task_id", None):
        agent["current_task_id"] = args.task_id
    if getattr(args, "message", None) is not None:
        agent["message"] = args.message
    for field in ("worktree", "branch", "git_sha"):
        value = getattr(args, field, None)
        if value is not None:
            agent[field] = value
    if getattr(args, "run_id", None):
        agent["last_run_id"] = args.run_id
    agent["last_heartbeat_at"] = now_iso()
    agent["updated_at"] = now_iso()


def write_agent_status(args: argparse.Namespace, status: str, needs_user: bool) -> None:
    agent = load_agent(args)
    agent["status"] = status
    agent["needs_user"] = needs_user
    apply_common_agent_fields(agent, args)
    write_json(agent_path(args.agent_id), agent)
    print(f"updated {agent_path(args.agent_id)}")


def command_heartbeat(args: argparse.Namespace) -> None:
    write_agent_status(args, args.status, False)


def command_needs_user(args: argparse.Namespace) -> None:
    write_agent_status(args, "needs_user", True)


def command_blocked(args: argparse.Namespace) -> None:
    write_agent_status(args, "blocked", True)


def command_task_started(args: argparse.Namespace) -> None:
    write_agent_status(args, "running", False)


def command_task_completed(args: argparse.Namespace) -> None:
    write_agent_status(args, "review", False)


def command_verified(args: argparse.Namespace) -> None:
    ended_at = args.ended_at or now_iso()
    run = {
        "schema_version": "run.v1",
        "run_id": args.run_id,
        "project_id": args.project_id,
        "task_id": args.task_id,
        "agent_id": args.agent_id,
        "status": args.status,
        "git_sha": args.git_sha,
        "worktree": args.worktree,
        "command": args.command,
        "started_at": args.started_at,
        "ended_at": ended_at,
        "exit_code": args.exit_code,
        "log_path": args.log_path,
        "metrics_path": args.metrics_path,
        "metrics_sha256": args.metrics_sha256,
        "verifier": {
            "command": args.verifier_command,
            "exit_code": args.verifier_exit_code,
            "status": args.verifier_status,
        },
        "summary": args.message,
        "updated_at": now_iso(),
    }
    write_json(run_path(args.run_id), run)

    agent = load_agent(args)
    agent["status"] = "done" if args.verifier_status == "passed" else "error"
    agent["needs_user"] = False
    agent["last_run_id"] = args.run_id
    apply_common_agent_fields(agent, args)
    write_json(agent_path(args.agent_id), agent)
    print(f"updated {run_path(args.run_id)}")
    print(f"updated {agent_path(args.agent_id)}")


def add_agent_args(
    parser: argparse.ArgumentParser,
    require_project: bool = False,
    require_task: bool = False,
) -> None:
    parser.add_argument("--agent-id", required=True)
    parser.add_argument("--project-id", required=require_project)
    parser.add_argument("--task-id", required=require_task)
    parser.add_argument("--message")
    parser.add_argument("--worktree")
    parser.add_argument("--branch")
    parser.add_argument("--git-sha")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Update dashboard agent/run state.")
    subcommands = parser.add_subparsers(dest="command", required=True)

    heartbeat = subcommands.add_parser("heartbeat")
    add_agent_args(heartbeat)
    heartbeat.add_argument(
        "--status",
        choices=["idle", "running", "blocked", "needs_user", "review", "error", "done"],
        default="idle",
    )
    heartbeat.set_defaults(func=command_heartbeat)

    needs_user = subcommands.add_parser("needs_user")
    add_agent_args(needs_user)
    needs_user.set_defaults(func=command_needs_user)

    blocked = subcommands.add_parser("blocked")
    add_agent_args(blocked)
    blocked.set_defaults(func=command_blocked)

    task_started = subcommands.add_parser("task_started")
    add_agent_args(task_started, require_project=True, require_task=True)
    task_started.set_defaults(func=command_task_started)

    task_completed = subcommands.add_parser("task_completed")
    add_agent_args(task_completed, require_project=True, require_task=True)
    task_completed.add_argument("--run-id")
    task_completed.set_defaults(func=command_task_completed)

    verified = subcommands.add_parser("verified")
    add_agent_args(verified, require_project=True, require_task=True)
    verified.add_argument("--run-id", required=True)
    verified.add_argument("--status", choices=["started", "failed", "passed", "verified"], default="verified")
    verified.add_argument("--started-at", required=True)
    verified.add_argument("--ended-at")
    verified.add_argument("--command", required=True)
    verified.add_argument("--exit-code", type=int, required=True)
    verified.add_argument("--log-path")
    verified.add_argument("--metrics-path")
    verified.add_argument("--metrics-sha256")
    verified.add_argument("--verifier-command")
    verified.add_argument("--verifier-exit-code", type=int)
    verified.add_argument("--verifier-status", choices=["not_run", "passed", "failed"], required=True)
    verified.set_defaults(func=command_verified)

    return parser


def main() -> None:
    args = build_parser().parse_args()
    require_safe_id(args.agent_id, "agent_id")
    if getattr(args, "run_id", None):
        require_safe_run_id(args.run_id)
    args.func(args)


if __name__ == "__main__":
    main()
