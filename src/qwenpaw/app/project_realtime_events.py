# -*- coding: utf-8 -*-
"""Project realtime event persistence helpers.

This module stores lightweight per-project file change hints so realtime
consumers can react to tool-driven writes without waiting for full directory
diff scans to infer changed paths.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from collections.abc import Sequence
from threading import Lock
from typing import Any

_STATE_DIR_NAME = ".knowledge"
_STATE_FILE_NAME = "project-realtime-events.json"
_MAX_EVENTS = 64
_MAX_PATHS_PER_EVENT = 32
_state_lock = Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _state_path(project_dir: Path) -> Path:
    return project_dir / _STATE_DIR_NAME / _STATE_FILE_NAME


def _default_state(project_id: str) -> dict[str, Any]:
    return {
        "project_id": project_id,
        "next_event_id": 1,
        "events": [],
        "updated_at": _now_iso(),
    }


def _normalize_paths(paths: list[str] | None) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw_path in paths or []:
        value = str(raw_path or "").strip().replace("\\", "/")
        if not value or value.startswith(".knowledge/") or value in seen:
            continue
        seen.add(value)
        normalized.append(value)
        if len(normalized) >= _MAX_PATHS_PER_EVENT:
            break
    return normalized


def _load_state(project_dir: Path, project_id: str) -> dict[str, Any]:
    state_path = _state_path(project_dir)
    if not state_path.exists():
        return _default_state(project_id)

    try:
        payload = json.loads(state_path.read_text(encoding="utf-8"))
    except Exception:
        return _default_state(project_id)

    if not isinstance(payload, dict):
        return _default_state(project_id)

    state = _default_state(project_id)
    state.update(payload)
    state["project_id"] = project_id
    try:
        state["next_event_id"] = max(1, int(state.get("next_event_id") or 1))
    except (TypeError, ValueError):
        state["next_event_id"] = 1

    events: list[dict[str, Any]] = []
    for raw_event in list(state.get("events") or [])[-_MAX_EVENTS:]:
        if not isinstance(raw_event, dict):
            continue
        try:
            event_id = int(raw_event.get("event_id") or 0)
        except (TypeError, ValueError):
            continue
        if event_id <= 0:
            continue
        changed_paths = _normalize_paths(list(raw_event.get("changed_paths") or []))
        if not changed_paths:
            continue
        events.append(
            {
                "event_id": event_id,
                "changed_paths": changed_paths,
                "updated_at": str(raw_event.get("updated_at") or state.get("updated_at") or _now_iso()),
            }
        )
    state["events"] = events[-_MAX_EVENTS:]
    return state


def _save_state(project_dir: Path, state: dict[str, Any]) -> None:
    state_path = _state_path(project_dir)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state["updated_at"] = _now_iso()
    tmp_path = state_path.with_suffix(".tmp")
    tmp_path.write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    tmp_path.replace(state_path)


def _resolve_project_path_context(
    workspace_dir: Path | str | None,
    target_path: Path | str,
) -> tuple[str, Path, str] | None:
    target = Path(target_path).expanduser().resolve(strict=False)

    if workspace_dir is not None:
        workspace_path = Path(workspace_dir).expanduser().resolve()
        projects_dir = workspace_path / "projects"

        try:
            relative_to_projects = target.relative_to(projects_dir)
        except Exception:
            return None

        parts = relative_to_projects.parts
        if len(parts) < 2:
            return None

        project_id = str(parts[0] or "").strip()
        if not project_id:
            return None

        relative_path = Path(*parts[1:]).as_posix()
        if not relative_path or relative_path.startswith(".knowledge/"):
            return None

        return project_id, projects_dir / project_id, relative_path

    for projects_dir in target.parents:
        if projects_dir.name != "projects":
            continue
        try:
            relative_to_projects = target.relative_to(projects_dir)
        except Exception:
            continue

        parts = relative_to_projects.parts
        if len(parts) < 2:
            continue

        project_id = str(parts[0] or "").strip()
        if not project_id:
            continue

        relative_path = Path(*parts[1:]).as_posix()
        if not relative_path or relative_path.startswith(".knowledge/"):
            continue

        return project_id, projects_dir / project_id, relative_path

    return None


def record_project_realtime_paths(
    workspace_dir: Path | str | None,
    absolute_paths: Sequence[str | Path],
) -> None:
    grouped: dict[tuple[str, str], list[str]] = {}

    for raw_path in absolute_paths:
        resolved = _resolve_project_path_context(workspace_dir, raw_path)
        if resolved is None:
            continue
        project_id, project_dir, relative_path = resolved
        key = (project_id, str(project_dir))
        paths = grouped.get(key) or []
        paths.append(relative_path)
        grouped[key] = paths

    if not grouped:
        return

    with _state_lock:
        for (project_id, project_dir_raw), raw_paths in grouped.items():
            project_dir = Path(project_dir_raw)
            normalized_paths = _normalize_paths(raw_paths)
            if not normalized_paths:
                continue
            state = _load_state(project_dir, project_id)
            event_id = int(state.get("next_event_id") or 1)
            state["events"] = [
                *(state.get("events") or []),
                {
                    "event_id": event_id,
                    "changed_paths": normalized_paths,
                    "updated_at": _now_iso(),
                },
            ][-_MAX_EVENTS:]
            state["next_event_id"] = event_id + 1
            _save_state(project_dir, state)


def collect_project_realtime_changes(
    project_dir: Path,
    project_id: str,
    after_event_id: int,
) -> tuple[int, list[str]]:
    with _state_lock:
        state = _load_state(project_dir, project_id)

    latest_event_id = 0
    merged_paths: list[str] = []
    seen: set[str] = set()

    for event in state.get("events") or []:
        event_id = int(event.get("event_id") or 0)
        latest_event_id = max(latest_event_id, event_id)
        if event_id <= after_event_id:
            continue
        for raw_path in event.get("changed_paths") or []:
            normalized = str(raw_path or "").strip().replace("\\", "/")
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            merged_paths.append(normalized)
            if len(merged_paths) >= _MAX_PATHS_PER_EVENT:
                return latest_event_id, merged_paths

    return latest_event_id, merged_paths