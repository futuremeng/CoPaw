# -*- coding: utf-8 -*-
"""Quality-loop digest injection for the heartbeat query text.

The heartbeat is the unattended channel: nobody is looking at the
Knowledge page, so the stalled quality loops have to be named in the
query text for the agent to act on them.
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any

from ...config import load_config
from ...knowledge.graph_ops import GraphOpsManager

logger = logging.getLogger(__name__)

_QUALITY_LOOP_ACTIVE_STATUSES = {"pending", "running"}
_QUALITY_LOOP_REVIEW_STOP_REASONS = {"REVIEW_REQUIRED", "QUALITY_STAGNATED"}
_QUALITY_LOOP_ACTIONABLE_STOP_REASONS = {
    "MAX_ROUNDS_REACHED",
    "QUALITY_STAGNATED",
}
_HEARTBEAT_QUALITY_LOOP_AUTORUN_MAX_ROUNDS = 3


def _load_knowledge_config() -> Any:
    try:
        return load_config().knowledge
    except Exception:  # pylint: disable=broad-except
        return None


def _is_quality_loop_autorun_enabled(knowledge_config: Any) -> bool:
    if knowledge_config is None:
        return False
    return bool(
        getattr(knowledge_config, "enabled", False)
        and getattr(knowledge_config, "memify_enabled", False),
    )


def _build_quality_loop_recommended_actions(
    *,
    project_name: str,
    latest_job: dict[str, Any],
) -> list[str]:
    status = str(latest_job.get("status") or "").strip()
    stop_reason = str(latest_job.get("stop_reason") or "").strip()
    actions: list[str] = []
    if status in _QUALITY_LOOP_ACTIVE_STATUSES:
        actions.append(
            f"- {project_name}: observe active quality loop and wait for the"
            " current round to finish before planning follow-up.",
        )
        return actions

    reflection_artifacts = latest_job.get("reflection_artifacts")
    artifact_paths = (
        reflection_artifacts
        if isinstance(reflection_artifacts, dict)
        else {}
    )
    lessons_path = str(artifact_paths.get("lessons_path") or "").strip()
    params_path = str(artifact_paths.get("params_path") or "").strip()
    rounds_dir = str(artifact_paths.get("rounds_dir") or "").strip()

    if stop_reason == "REVIEW_REQUIRED":
        actions.append(
            f"- {project_name}: review the latest quality-loop evidence,"
            " explain why the gate rejected continuation, and update the"
            " next-step plan before any rerun.",
        )
    elif stop_reason in _QUALITY_LOOP_ACTIONABLE_STOP_REASONS:
        actions.append(
            f"- {project_name}: inspect the latest round evidence and decide"
            " whether to revise skills/params before scheduling another"
            " quality-loop round.",
        )

    if lessons_path or params_path or rounds_dir:
        references = ", ".join(
            path
            for path in [lessons_path, params_path, rounds_dir]
            if path
        )
        if references:
            actions.append(f"  References: {references}")
    return actions


def _describe_active_job(project_name: str, latest: dict[str, Any]) -> str:
    stage = str(
        latest.get("stage") or latest.get("current_stage") or "unknown",
    )
    return (
        f"- {project_name}: active"
        f" ({latest.get('current')}/{latest.get('total')}), stage={stage}"
    )


def _attempt_quality_self_drive(
    graph_ops: GraphOpsManager,
    *,
    project_name: str,
    knowledge_config: Any,
) -> str:
    try:
        result = graph_ops.maybe_start_quality_self_drive(
            config=knowledge_config,
            dataset_scope=None,
            project_id=project_name,
            max_rounds=_HEARTBEAT_QUALITY_LOOP_AUTORUN_MAX_ROUNDS,
            dry_run=False,
        )
    except Exception as exc:  # pragma: no cover - defensive branch
        logger.exception(
            "heartbeat quality-loop orchestration failed for project %s",
            project_name,
        )
        return f"- {project_name}: orchestration_error={exc}"
    accepted = bool(result.get("accepted"))
    job_id = str(result.get("job_id") or "").strip()
    reason = str(result.get("reason") or "") or "NO_REASON"
    suffix = f", job_id={job_id}" if job_id else ""
    state = "started" if accepted else "skipped"
    return f"- {project_name}: {state} ({reason}){suffix}"


def _collect_project_quality_loop_digest(
    workspace_dir: Path,
    *,
    knowledge_config: Any = None,
) -> str:
    projects_dir = Path(workspace_dir) / "projects"
    if not projects_dir.is_dir():
        return ""

    autorun_enabled = _is_quality_loop_autorun_enabled(knowledge_config)
    active_lines: list[str] = []
    review_lines: list[str] = []
    action_lines: list[str] = []
    orchestration_lines: list[str] = []
    for project_dir in sorted(
        projects_dir.iterdir(),
        key=lambda item: item.name.lower(),
    ):
        if not project_dir.is_dir():
            continue

        graph_ops = GraphOpsManager(
            workspace_dir,
            knowledge_dirname=f"projects/{project_dir.name}/.knowledge",
        )
        jobs = graph_ops.list_quality_loop_jobs(active_only=False, limit=1)
        if not jobs:
            continue
        latest = jobs[0]
        status = str(latest.get("status") or "").strip()
        stop_reason = str(latest.get("stop_reason") or "").strip()

        if status in _QUALITY_LOOP_ACTIVE_STATUSES:
            active_lines.append(
                _describe_active_job(project_dir.name, latest),
            )
        elif stop_reason in _QUALITY_LOOP_REVIEW_STOP_REASONS:
            review_lines.append(
                f"- {project_dir.name}: stop_reason={stop_reason},"
                f" score_after={latest.get('score_after')}",
            )
        action_lines.extend(
            _build_quality_loop_recommended_actions(
                project_name=project_dir.name,
                latest_job=latest,
            ),
        )

        if not autorun_enabled:
            continue
        if status in _QUALITY_LOOP_ACTIVE_STATUSES:
            continue
        if stop_reason not in _QUALITY_LOOP_ACTIONABLE_STOP_REASONS:
            continue
        orchestration_lines.append(
            _attempt_quality_self_drive(
                graph_ops,
                project_name=project_dir.name,
                knowledge_config=knowledge_config,
            ),
        )

    sections: list[str] = []
    if active_lines:
        sections.extend(["Active project quality loops:", *active_lines])
    if review_lines:
        sections.extend(
            ["Projects needing quality-loop review:", *review_lines],
        )
    if action_lines:
        sections.extend(["Recommended heartbeat actions:", *action_lines])
    if orchestration_lines:
        sections.extend(
            ["Heartbeat orchestration attempts:", *orchestration_lines],
        )
    return "\n".join(sections).strip()


async def append_quality_loop_digest(
    query_text: str,
    *,
    workspace_dir: Path | str | None = None,
) -> str:
    """Append the per-project quality-loop digest to a heartbeat query."""
    normalized = str(query_text or "").strip()
    if not normalized or workspace_dir is None:
        return normalized

    digest = await asyncio.to_thread(
        _collect_project_quality_loop_digest,
        Path(workspace_dir),
        knowledge_config=_load_knowledge_config(),
    )
    if not digest:
        return normalized
    return f"{normalized}\n\n[Project Quality Loop Digest]\n{digest}"
