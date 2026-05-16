#!/usr/bin/env python3
"""Validate the static dashboard state graph without third-party packages."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


DASHBOARD_DIR = Path(__file__).resolve().parents[1]
STATE_DIR = DASHBOARD_DIR / "state"


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise ValueError(f"{path}: cannot read JSON: {exc}") from exc


def require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def main() -> int:
    errors: list[str] = []
    portfolio = load_json(STATE_DIR / "portfolio.json")
    task_doc = load_json(STATE_DIR / "tasks.json")

    projects = {item["project_id"]: item for item in portfolio.get("projects", [])}
    require(bool(projects), "portfolio.json must list projects", errors)

    for project_id, project_ref in projects.items():
      project_path = DASHBOARD_DIR.parent / project_ref["state_path"]
      require(project_path.exists(), f"missing project state file for {project_id}: {project_path}", errors)
      if project_path.exists():
          project = load_json(project_path)
          require(project.get("project_id") == project_id, f"{project_path}: project_id mismatch", errors)

    tasks = task_doc.get("tasks", [])
    task_ids: set[str] = set()
    for task in tasks:
        task_id = task.get("task_id")
        project_id = task.get("project_id")
        require(isinstance(task_id, str) and task_id.startswith("task_"), f"bad task_id: {task_id!r}", errors)
        require(task_id not in task_ids, f"duplicate task_id: {task_id}", errors)
        task_ids.add(task_id)
        require(project_id in projects, f"{task_id}: unknown project_id {project_id!r}", errors)
        require(task.get("status") in {"todo", "active", "blocked", "needs_user", "review", "done"}, f"{task_id}: invalid status", errors)
        if task.get("status") == "active":
            require(bool(task.get("due_at")), f"{task_id}: active task needs due_at", errors)
        if task.get("status") == "done":
            require(bool(task.get("completed_at")), f"{task_id}: done task needs completed_at", errors)

    agent_count = 0
    for agent_path in sorted((STATE_DIR / "agents").glob("*.json")):
        agent_count += 1
        agent = load_json(agent_path)
        agent_id = agent.get("agent_id")
        project_id = agent.get("project_id")
        current_task_id = agent.get("current_task_id")
        require(agent_path.stem == agent_id, f"{agent_path}: filename must match agent_id", errors)
        require(project_id in projects, f"{agent_path}: unknown project_id {project_id!r}", errors)
        if current_task_id:
            require(current_task_id in task_ids, f"{agent_path}: unknown current_task_id {current_task_id!r}", errors)

    run_count = 0
    for run_path in sorted((STATE_DIR / "runs").glob("*.json")):
        run_count += 1
        run = load_json(run_path)
        run_id = run.get("run_id")
        require(run_path.stem == run_id, f"{run_path}: filename must match run_id", errors)
        require(run.get("project_id") in projects, f"{run_path}: unknown project_id", errors)
        require(run.get("task_id") in task_ids, f"{run_path}: unknown task_id", errors)
        verifier = run.get("verifier") or {}
        require(verifier.get("status") in {"not_run", "passed", "failed"}, f"{run_path}: invalid verifier.status", errors)
        if run.get("status") in {"passed", "verified"}:
            require(verifier.get("status") == "passed", f"{run_path}: passed/verified run needs passed verifier", errors)
            require(run.get("git_sha") is not None, f"{run_path}: verified run needs git_sha", errors)
            require(run.get("command") is not None, f"{run_path}: verified run needs command", errors)
            require(run.get("exit_code") == 0, f"{run_path}: verified run needs exit_code 0", errors)

    if errors:
        print("dashboard state validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1

    print(
        "dashboard state validation passed: "
        f"{len(projects)} projects, {len(tasks)} tasks, {agent_count} agents, {run_count} runs"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
