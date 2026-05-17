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
    require(isinstance(portfolio.get("summary"), dict), "portfolio.json must contain summary object", errors)
    require(isinstance(portfolio.get("storyline", {}).get("flows"), list), "portfolio.json must contain storyline.flows", errors)
    require(isinstance(portfolio.get("visual_references"), list), "portfolio.json must contain visual_references array", errors)
    require(isinstance(portfolio.get("project_buckets"), list), "portfolio.json must contain project_buckets array", errors)

    for project_id, project_ref in projects.items():
      project_path = DASHBOARD_DIR.parent / project_ref["state_path"]
      require(project_path.exists(), f"missing project state file for {project_id}: {project_path}", errors)
      if project_path.exists():
          project = load_json(project_path)
          require(project.get("project_id") == project_id, f"{project_path}: project_id mismatch", errors)
          require(isinstance(project.get("title"), str) and bool(project.get("title")), f"{project_path}: missing title", errors)
          require(isinstance(project.get("description"), str) and bool(project.get("description")), f"{project_path}: missing description", errors)
          require(isinstance(project.get("summary"), str) and bool(project.get("summary")), f"{project_path}: missing summary", errors)
          require(isinstance(project.get("details"), list), f"{project_path}: details must be an array", errors)
          require(isinstance(project.get("risks_decisions"), list), f"{project_path}: risks_decisions must be an array", errors)
          if project.get("asset"):
              require(isinstance(project.get("asset_alt"), str) and bool(project.get("asset_alt")), f"{project_path}: asset needs asset_alt", errors)
              require(isinstance(project.get("asset_caption"), str) and bool(project.get("asset_caption")), f"{project_path}: asset needs asset_caption", errors)
          else:
              require(isinstance(project.get("visual"), dict), f"{project_path}: assetless project needs visual object", errors)

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
        require(task.get("result") in {None, ""}, f"{task_id}: result should be stored as a comment", errors)
        if task.get("status") == "active":
            require(bool(task.get("due_at")), f"{task_id}: active task needs due_at", errors)
        if task.get("status") == "done":
            require(bool(task.get("completed_at")), f"{task_id}: done task needs completed_at", errors)
        comment_ids: set[str] = set()
        comments = task.get("comments", [])
        require(isinstance(comments, list), f"{task_id}: comments must be an array", errors)
        if isinstance(comments, list):
            for index, comment in enumerate(comments):
                label = f"{task_id}.comments[{index}]"
                require(isinstance(comment, dict), f"{label}: comment must be an object", errors)
                if not isinstance(comment, dict):
                    continue
                comment_id = comment.get("comment_id")
                require(isinstance(comment_id, str) and comment_id.startswith("comment_"), f"{label}: bad comment_id", errors)
                require(comment_id not in comment_ids, f"{task_id}: duplicate comment_id {comment_id}", errors)
                comment_ids.add(comment_id)
                require(isinstance(comment.get("author"), str) and bool(comment.get("author")), f"{label}: missing author", errors)
                require(isinstance(comment.get("body"), str) and bool(comment.get("body")), f"{label}: missing body", errors)
                require(isinstance(comment.get("created_at"), str) and bool(comment.get("created_at")), f"{label}: missing created_at", errors)
                require(
                    comment.get("kind") in {None, "comment", "result", "status_change", "needs_user", "blocker", "verification"},
                    f"{label}: invalid kind",
                    errors,
                )

    agent_count = 0
    for agent_path in sorted((STATE_DIR / "agents").glob("*.json")):
        agent_count += 1
        agent = load_json(agent_path)
        agent_id = agent.get("agent_id")
        project_id = agent.get("project_id")
        current_task_id = agent.get("current_task_id")
        require(agent_path.stem == agent_id, f"{agent_path}: filename must match agent_id", errors)
        require(project_id in projects, f"{agent_path}: unknown project_id {project_id!r}", errors)
        require(isinstance(agent.get("status"), str) and bool(agent.get("status")), f"{agent_path}: missing status", errors)
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
        require(run.get("status") in {"started", "running", "failed", "passed", "verified"}, f"{run_path}: invalid status", errors)
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
