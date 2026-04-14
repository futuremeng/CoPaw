# -*- coding: utf-8 -*-
"""
Heartbeat: run agent with HEARTBEAT.md as query at interval.
Uses config functions (get_heartbeat_config, get_heartbeat_query_path,
load_config) for paths and settings.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, time, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from typing import Any, Dict, Optional

from ...agents.utils.file_handling import read_text_file_with_encoding_fallback
from ...config import (
    get_heartbeat_config,
    get_heartbeat_query_path,
    load_config,
)
from ...constant import HEARTBEAT_FILE, HEARTBEAT_TARGET_LAST
from ...knowledge.graph_ops import GraphOpsManager
from ..crons.models import _crontab_dow_to_name

logger = logging.getLogger(__name__)

_QUALITY_LOOP_ACTIVE_STATUSES = {"pending", "running"}
_QUALITY_LOOP_REVIEW_STOP_REASONS = {"REVIEW_REQUIRED", "QUALITY_STAGNATED"}
_QUALITY_LOOP_ACTIONABLE_STOP_REASONS = {
    "MAX_ROUNDS_REACHED",
    "QUALITY_STAGNATED",
}
_HEARTBEAT_QUALITY_LOOP_AUTORUN_MAX_ROUNDS = 3

# Pattern for "30m", "1h", "2h30m", "90s"
_EVERY_PATTERN = re.compile(
    r"^(?:(?P<hours>\d+)h)?(?:(?P<minutes>\d+)m)?(?:(?P<seconds>\d+)s)?$",
    re.IGNORECASE,
)

# 5-field cron: minute hour day month day_of_week
_CRON_FIELD_PATTERN = re.compile(
    r"^[\d\*\-/,]+$",
)


def is_cron_expression(every: str) -> bool:
    """Return True if *every* looks like a 5-field cron expression."""
    parts = (every or "").strip().split()
    if len(parts) != 5:
        return False
    return all(_CRON_FIELD_PATTERN.match(p) for p in parts)


def parse_heartbeat_cron(every: str) -> tuple:
    """Parse and normalize a 5-field cron string.

    Returns (minute, hour, day, month, dow).
    """
    parts = every.strip().split()
    if len(parts) == 5:
        parts[4] = _crontab_dow_to_name(parts[4])
    return tuple(parts)


def parse_heartbeat_every(every: str) -> int:
    """Parse interval string (e.g. '30m', '1h') to total seconds.

    Note: cron expressions should be detected via ``is_cron_expression``
    *before* calling this function.
    """
    every = (every or "").strip()
    if not every:
        return 30 * 60  # default 30 min
    m = _EVERY_PATTERN.match(every)
    if not m:
        logger.warning("heartbeat every=%r invalid, using 30m", every)
        return 30 * 60
    hours = int(m.group("hours") or 0)
    minutes = int(m.group("minutes") or 0)
    seconds = int(m.group("seconds") or 0)
    total = hours * 3600 + minutes * 60 + seconds
    if total <= 0:
        return 30 * 60
    return total


def _in_active_hours(active_hours: Any) -> bool:
    """Return True if the current time in user timezone is within
    [start, end].
    """
    if (
        not active_hours
        or not hasattr(active_hours, "start")
        or not hasattr(active_hours, "end")
    ):
        return True
    try:
        start_parts = active_hours.start.strip().split(":")
        end_parts = active_hours.end.strip().split(":")
        start_t = time(
            int(start_parts[0]),
            int(start_parts[1]) if len(start_parts) > 1 else 0,
        )
        end_t = time(
            int(end_parts[0]),
            int(end_parts[1]) if len(end_parts) > 1 else 0,
        )
    except (ValueError, IndexError, AttributeError):
        return True
    user_tz = load_config().user_timezone or "UTC"
    try:
        now = datetime.now(ZoneInfo(user_tz)).time()
    except (ZoneInfoNotFoundError, KeyError):
        logger.warning(
            "Invalid timezone %r in config, falling back to UTC"
            " for heartbeat active hours check.",
            user_tz,
        )
        now = datetime.now(timezone.utc).time()
    if start_t <= end_t:
        return start_t <= now <= end_t
    return now >= start_t or now <= end_t


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
            f"- {project_name}: observe active quality loop and wait for the current round to finish before planning follow-up."
        )
        return actions

    reflection_artifacts = latest_job.get("reflection_artifacts")
    artifact_paths = (
        reflection_artifacts if isinstance(reflection_artifacts, dict) else {}
    )
    lessons_path = str(artifact_paths.get("lessons_path") or "").strip()
    params_path = str(artifact_paths.get("params_path") or "").strip()
    rounds_dir = str(artifact_paths.get("rounds_dir") or "").strip()

    if stop_reason == "REVIEW_REQUIRED":
        actions.append(
            f"- {project_name}: review the latest quality-loop evidence, explain why the gate rejected continuation, and update the next-step plan before any rerun."
        )
    elif stop_reason in _QUALITY_LOOP_ACTIONABLE_STOP_REASONS:
        actions.append(
            f"- {project_name}: inspect the latest round evidence and decide whether to revise skills/params before scheduling another quality-loop round."
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


def _is_quality_loop_autorun_enabled(knowledge_config: Any) -> bool:
    if knowledge_config is None:
        return False
    return bool(
        getattr(knowledge_config, "enabled", False)
        and getattr(knowledge_config, "memify_enabled", False)
    )


def _collect_project_quality_loop_digest(
    workspace_dir: Path,
    *,
    knowledge_config: Any = None,
) -> str:
    projects_dir = Path(workspace_dir) / "projects"
    if not projects_dir.exists() or not projects_dir.is_dir():
        return ""

    autorun_enabled = _is_quality_loop_autorun_enabled(knowledge_config)
    active_lines: list[str] = []
    review_lines: list[str] = []
    action_lines: list[str] = []
    orchestration_lines: list[str] = []
    for project_dir in sorted(projects_dir.iterdir(), key=lambda item: item.name.lower()):
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
        score_after = latest.get("score_after")
        current = latest.get("current")
        total = latest.get("total")
        if status in _QUALITY_LOOP_ACTIVE_STATUSES:
            active_lines.append(
                f"- {project_dir.name}: active ({current}/{total}), stage={latest.get('stage') or latest.get('current_stage') or 'unknown'}"
            )
        elif stop_reason in _QUALITY_LOOP_REVIEW_STOP_REASONS:
            review_lines.append(
                f"- {project_dir.name}: stop_reason={stop_reason}, score_after={score_after}"
            )
        action_lines.extend(
            _build_quality_loop_recommended_actions(
                project_name=project_dir.name,
                latest_job=latest,
            )
        )

        if not autorun_enabled:
            continue
        if status in _QUALITY_LOOP_ACTIVE_STATUSES:
            continue
        if stop_reason not in _QUALITY_LOOP_ACTIONABLE_STOP_REASONS:
            continue

        try:
            orchestrate_result = graph_ops.maybe_start_quality_self_drive(
                config=knowledge_config,
                dataset_scope=None,
                project_id=project_dir.name,
                max_rounds=_HEARTBEAT_QUALITY_LOOP_AUTORUN_MAX_ROUNDS,
                dry_run=False,
            )
        except Exception as exc:  # pragma: no cover - defensive branch
            logger.exception(
                "heartbeat quality-loop orchestration failed for project %s",
                project_dir.name,
            )
            orchestration_lines.append(
                f"- {project_dir.name}: orchestration_error={str(exc)}"
            )
            continue

        accepted = bool(orchestrate_result.get("accepted"))
        reason = str(orchestrate_result.get("reason") or "")
        job_id = str(orchestrate_result.get("job_id") or "").strip()
        status_text = "started" if accepted else "skipped"
        suffix = f", job_id={job_id}" if job_id else ""
        orchestration_lines.append(
            f"- {project_dir.name}: {status_text} ({reason or 'NO_REASON'}){suffix}"
        )

    sections: list[str] = []
    if active_lines:
        sections.extend([
            "Active project quality loops:",
            *active_lines,
        ])
    if review_lines:
        sections.extend([
            "Projects needing quality-loop review:",
            *review_lines,
        ])
    if action_lines:
        sections.extend([
            "Recommended heartbeat actions:",
            *action_lines,
        ])
    if orchestration_lines:
        sections.extend([
            "Heartbeat orchestration attempts:",
            *orchestration_lines,
        ])
    return "\n".join(sections).strip()


async def _build_heartbeat_query_text(
    base_text: str,
    *,
    workspace_dir: Optional[Path],
    knowledge_config: Any = None,
) -> str:
    normalized = str(base_text or "").strip()
    if not normalized or workspace_dir is None:
        return normalized

    digest = await asyncio.to_thread(
        _collect_project_quality_loop_digest,
        Path(workspace_dir),
        knowledge_config=knowledge_config,
    )
    if not digest:
        return normalized
    return f"{normalized}\n\n[Project Quality Loop Digest]\n{digest}"


async def run_heartbeat_once(
    *,
    runner: Any,
    channel_manager: Any,
    agent_id: Optional[str] = None,
    workspace_dir: Optional[Path] = None,
) -> None:
    """
    Run one heartbeat: read HEARTBEAT.md from workspace, run agent,
    optionally dispatch to last channel (target=last).

    Args:
        runner: Agent runner instance
        channel_manager: Channel manager instance
        agent_id: Agent ID for loading config
        workspace_dir: Workspace directory for reading HEARTBEAT.md
    """
    from ...config.config import load_agent_config

    hb = get_heartbeat_config(agent_id)
    if not _in_active_hours(hb.active_hours):
        logger.debug("heartbeat skipped: outside active hours")
        return

    # Use workspace_dir if provided, otherwise fall back to global path
    if workspace_dir:
        path = Path(workspace_dir) / HEARTBEAT_FILE
    else:
        path = get_heartbeat_query_path()

    if not path.is_file():
        logger.debug("heartbeat skipped: no file at %s", path)
        return

    query_text = read_text_file_with_encoding_fallback(path).strip()
    if not query_text:
        logger.debug("heartbeat skipped: empty query file")
        return
    knowledge_config = None
    try:
        knowledge_config = load_config().knowledge
    except Exception:
        knowledge_config = None

    query_text = await _build_heartbeat_query_text(
        query_text,
        workspace_dir=Path(workspace_dir) if workspace_dir else None,
        knowledge_config=knowledge_config,
    )

    # Build request: single user message with query text
    req: Dict[str, Any] = {
        "input": [
            {
                "role": "user",
                "content": [{"type": "text", "text": query_text}],
            },
        ],
        "session_id": "main",
        "user_id": "main",
    }

    # Get last_dispatch from agent config if agent_id provided
    last_dispatch = None
    if agent_id:
        try:
            agent_config = load_agent_config(agent_id)
            last_dispatch = agent_config.last_dispatch
        except Exception:
            pass
    else:
        # Legacy: try root config
        config = load_config()
        last_dispatch = config.last_dispatch

    target = (hb.target or "").strip().lower()
    heartbeat_ran = False
    if target == HEARTBEAT_TARGET_LAST and last_dispatch:
        ld = last_dispatch
        if ld.channel and (ld.user_id or ld.session_id):

            async def _run_and_dispatch() -> None:
                async for event in runner.stream_query(req):
                    await channel_manager.send_event(
                        channel=ld.channel,
                        user_id=ld.user_id,
                        session_id=ld.session_id,
                        event=event,
                        meta={},
                    )

            try:
                await asyncio.wait_for(_run_and_dispatch(), timeout=120)
                heartbeat_ran = True
            except asyncio.TimeoutError:
                logger.warning("heartbeat run timed out")
                heartbeat_ran = True

    # target main or no last_dispatch: run agent only, no dispatch
    if not heartbeat_ran:
        async def _run_only() -> None:
            async for _ in runner.stream_query(req):
                pass

        try:
            await asyncio.wait_for(_run_only(), timeout=120)
        except asyncio.TimeoutError:
            logger.warning("heartbeat run timed out")
