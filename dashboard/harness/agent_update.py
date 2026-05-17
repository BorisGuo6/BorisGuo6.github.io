#!/usr/bin/env python3
"""Update dashboard state for local agent workers.

By default this writes local JSON fallback files. With --remote it posts the
same intent to the Supabase agent-event API.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any


DASHBOARD_DIR = Path(__file__).resolve().parents[1]
STATE_DIR = DASHBOARD_DIR / "state"
AGENTS_DIR = STATE_DIR / "agents"
RUNS_DIR = STATE_DIR / "runs"
TASKS_PATH = STATE_DIR / "tasks.json"
REPO_ROOT = DASHBOARD_DIR.parent
SAFE_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$")
SAFE_RUN_ID = re.compile(r"^run_[0-9]{8}_[a-zA-Z0-9_]+$")
SAFE_COMMENT_ID = re.compile(r"^comment_[a-zA-Z0-9_-]+$")


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def today_iso() -> str:
    return datetime.now().astimezone().date().isoformat()


def require_safe_id(value: str, label: str) -> str:
    if not SAFE_ID.fullmatch(value):
        raise SystemExit(f"{label} contains unsafe characters: {value!r}")
    return value


def require_safe_run_id(value: str) -> str:
    if not SAFE_RUN_ID.fullmatch(value):
        raise SystemExit(f"run_id must look like run_YYYYMMDD_name: {value!r}")
    return value


def require_safe_comment_id(value: str) -> str:
    if not SAFE_COMMENT_ID.fullmatch(value):
        raise SystemExit(f"comment_id must look like comment_name: {value!r}")
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


def load_env_file() -> None:
    env_path = REPO_ROOT / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'\"")
        if key and key not in os.environ:
            os.environ[key] = value


def agent_event_url(args: argparse.Namespace) -> str:
    if args.api_url:
        return args.api_url
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    if not supabase_url:
        raise SystemExit("Set SUPABASE_URL or pass --api-url for --remote updates")
    return f"{supabase_url}/functions/v1/agent-event"


def post_agent_event(args: argparse.Namespace, payload: dict[str, Any]) -> None:
    token = args.agent_token or os.environ.get("AGENT_WRITE_TOKEN")
    if not token:
        raise SystemExit("Set AGENT_WRITE_TOKEN or pass --agent-token for --remote updates")

    request = urllib.request.Request(
        agent_event_url(args),
        data=json.dumps({key: value for key, value in payload.items() if value is not None}).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-agent-token": token,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        response_body = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"remote update failed: HTTP {exc.code} {response_body}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"remote update failed: {exc}") from exc

    try:
        parsed = json.loads(response_body)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"remote update returned non-JSON response: {response_body}") from exc
    if not parsed.get("ok"):
        raise SystemExit(f"remote update failed: {response_body}")


def remote_payloads(args: argparse.Namespace) -> list[dict[str, Any]]:
    command = args.subcommand
    if command == "heartbeat":
        return [{
            "action": "heartbeat",
            "agent_id": args.agent_id,
            "project_id": args.project_id,
            "task_id": args.task_id,
            "status": args.status,
            "summary": args.message,
        }]
    if command in {"needs_user", "blocked", "task_started", "task_completed"}:
        status_by_command = {
            "needs_user": "needs_user",
            "blocked": "blocked",
            "task_started": "running",
            "task_completed": "review",
        }
        return [{
            "action": "heartbeat",
            "agent_id": args.agent_id,
            "project_id": args.project_id,
            "task_id": args.task_id,
            "status": status_by_command[command],
            "summary": args.message,
            "payload": {"run_id": getattr(args, "run_id", None)},
        }]
    if command == "task_status":
        payloads = [{
            "action": "task_status",
            "agent_id": args.agent_id,
            "task_id": args.task_id,
            "status": args.status,
            "payload": {
                "assignee": args.assignee,
                "due_at": args.due_at,
                "completed_at": args.completed_at,
                "run_id": args.run_id,
            },
        }]
        if args.message:
            payloads.append({
                "action": "task_comment",
                "agent_id": args.agent_id,
                "task_id": args.task_id,
                "kind": "status_change",
                "comment": args.message,
            })
        return payloads
    if command == "task_comment":
        return [{
            "action": "task_comment",
            "agent_id": args.agent_id,
            "task_id": args.task_id,
            "kind": args.kind,
            "comment": args.message,
            "payload": {"author": args.author},
        }]
    if command == "verified":
        return [
            {
                "action": "run",
                "agent_id": args.agent_id,
                "project_id": args.project_id,
                "task_id": args.task_id,
                "run_id": args.run_id,
                "status": args.status,
                "git_sha": args.git_sha,
                "command": args.command,
                "exit_code": args.exit_code,
                "log_path": args.log_path,
                "metrics_path": args.metrics_path,
                "verifier": {
                    "command": args.verifier_command,
                    "exit_code": args.verifier_exit_code,
                    "status": args.verifier_status,
                },
                "payload": {
                    "started_at": args.started_at,
                    "ended_at": args.ended_at or now_iso(),
                    "metrics_sha256": args.metrics_sha256,
                    "summary": args.message,
                },
            },
            {
                "action": "heartbeat",
                "agent_id": args.agent_id,
                "project_id": args.project_id,
                "task_id": args.task_id,
                "status": "done" if args.verifier_status == "passed" else "error",
                "summary": args.message,
                "payload": {"run_id": args.run_id},
            },
        ]
    raise SystemExit(f"--remote is not implemented for command: {command}")


def agent_path(agent_id: str) -> Path:
    return AGENTS_DIR / f"{require_safe_id(agent_id, 'agent_id')}.json"


def run_path(run_id: str) -> Path:
    return RUNS_DIR / f"{require_safe_run_id(run_id)}.json"


def load_tasks_doc() -> dict[str, Any]:
    return read_json(TASKS_PATH, {"schema_version": "tasks.v1", "tasks": []})


def find_task(task_doc: dict[str, Any], task_id: str) -> dict[str, Any]:
    for task in task_doc.get("tasks", []):
        if task.get("task_id") == task_id:
            return task
    raise SystemExit(f"unknown task_id: {task_id}")


def update_tasks_doc(task_doc: dict[str, Any]) -> None:
    task_doc["updated_at"] = now_iso()
    write_json(TASKS_PATH, task_doc)
    print(f"updated {TASKS_PATH}")


def build_comment(
    *,
    task_id: str,
    author: str,
    body: str,
    source_agent_id: str | None,
    kind: str = "comment",
    comment_id: str | None = None,
) -> dict[str, Any]:
    now = now_iso()
    if not body or not body.strip():
        raise SystemExit("comment body cannot be empty")
    safe_author = re.sub(r"[^a-zA-Z0-9_-]+", "_", source_agent_id or author).strip("_") or "comment"
    generated_id = f"comment_{datetime.now().astimezone().strftime('%Y%m%d_%H%M%S_%f')}_{safe_author}"
    comment = {
        "comment_id": require_safe_comment_id(comment_id or generated_id),
        "author": author,
        "body": body,
        "created_at": now,
        "source_agent_id": source_agent_id,
        "kind": kind,
    }
    if not task_id:
        raise SystemExit("task_id is required for comments")
    return comment


def append_task_comment(
    task: dict[str, Any],
    *,
    task_id: str,
    author: str,
    body: str,
    source_agent_id: str | None,
    kind: str = "comment",
    comment_id: str | None = None,
) -> None:
    comments = task.setdefault("comments", [])
    if not isinstance(comments, list):
        raise SystemExit(f"{task_id}: comments must be an array")
    comment = build_comment(
        task_id=task_id,
        author=author,
        body=body,
        source_agent_id=source_agent_id,
        kind=kind,
        comment_id=comment_id,
    )
    if any(existing.get("comment_id") == comment["comment_id"] for existing in comments if isinstance(existing, dict)):
        raise SystemExit(f"{task_id}: duplicate comment_id {comment['comment_id']}")
    comments.append(comment)


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


def command_task_status(args: argparse.Namespace) -> None:
    task_doc = load_tasks_doc()
    task = find_task(task_doc, args.task_id)
    old_status = task.get("status")
    new_status = args.status
    if old_status == new_status and not args.message:
        print(f"{args.task_id}: status already {new_status}")
        return

    if new_status == "active" and not (args.due_at or task.get("due_at")):
        raise SystemExit(f"{args.task_id}: active task needs --due-at or existing due_at")

    task["status"] = new_status
    task["updated_at"] = now_iso()
    if args.assignee is not None:
        task["assignee"] = args.assignee
    if args.due_at is not None:
        task["due_at"] = args.due_at
    if args.run_id is not None:
        task["run_id"] = args.run_id

    if new_status == "active":
        task.setdefault("started_at", today_iso())
    if new_status == "done":
        task["completed_at"] = args.completed_at or today_iso()
    elif old_status == "done":
        task["completed_at"] = None

    status_body = args.message or f"Status changed from {old_status or 'unknown'} to {new_status}."
    append_task_comment(
        task,
        task_id=args.task_id,
        author=args.agent_id,
        body=status_body,
        source_agent_id=args.agent_id,
        kind="status_change",
    )
    update_tasks_doc(task_doc)


def command_task_comment(args: argparse.Namespace) -> None:
    task_doc = load_tasks_doc()
    task = find_task(task_doc, args.task_id)
    append_task_comment(
        task,
        task_id=args.task_id,
        author=args.author or args.agent_id,
        body=args.message,
        source_agent_id=args.agent_id,
        kind=args.kind,
        comment_id=args.comment_id,
    )
    task["updated_at"] = now_iso()
    update_tasks_doc(task_doc)


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
    parser.add_argument("--remote", action="store_true", help="POST the update to the Supabase agent-event API instead of writing local JSON.")
    parser.add_argument("--api-url", help="Override the agent-event API URL. Defaults to $SUPABASE_URL/functions/v1/agent-event.")
    parser.add_argument("--agent-token", help="Override $AGENT_WRITE_TOKEN for remote updates.")
    subcommands = parser.add_subparsers(dest="subcommand", required=True)

    heartbeat = subcommands.add_parser("heartbeat")
    add_agent_args(heartbeat)
    heartbeat.add_argument("--status", default="idle")
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

    task_status = subcommands.add_parser("task_status")
    add_agent_args(task_status, require_task=True)
    task_status.add_argument("--status", choices=["todo", "active", "blocked", "needs_user", "review", "done"], required=True)
    task_status.add_argument("--assignee")
    task_status.add_argument("--due-at")
    task_status.add_argument("--completed-at")
    task_status.add_argument("--run-id")
    task_status.set_defaults(func=command_task_status)

    task_comment = subcommands.add_parser("task_comment")
    add_agent_args(task_comment, require_task=True)
    task_comment.add_argument("--author")
    task_comment.add_argument("--comment-id")
    task_comment.add_argument(
        "--kind",
        choices=["comment", "result", "status_change", "needs_user", "blocker", "verification"],
        default="comment",
    )
    task_comment.set_defaults(func=command_task_comment)

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
    if args.remote:
        load_env_file()
        for payload in remote_payloads(args):
            post_agent_event(args, payload)
        print("remote update ok")
        return
    args.func(args)


if __name__ == "__main__":
    main()
