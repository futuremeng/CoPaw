# -*- coding: utf-8 -*-
"""Project detail realtime snapshots.

Provides a lightweight project-scoped WebSocket stream so the console can react
to file tree and pipeline changes without polling full payloads on every tick.
"""

from __future__ import annotations

import asyncio
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

from ..project_realtime_events import collect_project_realtime_changes
from . import agents as agents_router_impl

router = APIRouter(prefix="/agents", tags=["agents"])

_IGNORED_PROJECT_PARTS = {".git", ".knowledge", "__pycache__"}
_MAX_CHANGED_PATHS = 32


def _clamp_int(
    raw: str | None,
    *,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    try:
        value = int(raw or default)
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _hash_entries(entries: list[str]) -> str:
    payload = "\n".join(entries)
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def _collect_changed_paths(
    previous_entries: dict[str, str] | None,
    current_entries: dict[str, str],
    *,
    limit: int = _MAX_CHANGED_PATHS,
) -> list[str]:
    if previous_entries is None:
        return []

    changed = [
        path
        for path in sorted(set(previous_entries) | set(current_entries))
        if previous_entries.get(path) != current_entries.get(path)
    ]
    return changed[:limit]


def _collect_all_changed_paths(
    previous_entries: dict[str, str] | None,
    current_entries: dict[str, str],
) -> list[str]:
    if previous_entries is None:
        return []

    return [
        path
        for path in sorted(set(previous_entries) | set(current_entries))
        if previous_entries.get(path) != current_entries.get(path)
    ]


def _build_changed_dirs(changed_paths: list[str]) -> list[str]:
    next_dirs: set[str] = set()
    for raw_path in changed_paths:
        normalized = str(raw_path or "").strip().replace("\\", "/").strip("/")
        if not normalized:
            continue
        parts = [part for part in normalized.split("/") if part]
        if len(parts) <= 1:
            continue
        for index in range(1, len(parts)):
            next_dirs.add("/".join(parts[:index]))
    return sorted(next_dirs)


def _build_file_tree_signal(
    project_dir: Path,
) -> tuple[dict[str, Any], dict[str, str]]:
    entries: dict[str, str] = {}
    file_count = 0
    latest_mtime_ns = 0
    builtin_files = 0
    visible_files = 0
    original_files = 0
    derived_files = 0
    knowledge_candidate_files = 0
    markdown_files = 0
    text_like_files = 0
    recently_updated_files = 0

    for path in sorted(project_dir.rglob("*"), key=lambda item: item.as_posix().lower()):
        try:
            if not path.is_file():
                continue
            rel = path.relative_to(project_dir).as_posix()
            if any(part in _IGNORED_PROJECT_PARTS for part in Path(rel).parts):
                continue
            if agents_router_impl._is_ignored_project_metric_file(rel):
                continue
            stat = path.stat()
        except (OSError, ValueError):
            continue

        file_count += 1
        latest_mtime_ns = max(latest_mtime_ns, stat.st_mtime_ns)
        entries[rel] = f"{stat.st_mtime_ns}:{stat.st_size}"

        extension = agents_router_impl._extension_of_project_path(rel)
        is_builtin = agents_router_impl._is_builtin_project_metric_file(rel)
        if is_builtin:
            builtin_files += 1
        else:
            visible_files += 1
            if agents_router_impl._is_original_project_metric_file(rel):
                original_files += 1
            elif (
                agents_router_impl._is_intermediate_project_metric_file(rel)
                or agents_router_impl._is_artifact_project_metric_file(rel)
            ):
                derived_files += 1

        if extension in agents_router_impl._PROJECT_KNOWLEDGE_EXTENSIONS:
            knowledge_candidate_files += 1
        if extension in agents_router_impl._PROJECT_MARKDOWN_EXTENSIONS:
            markdown_files += 1
        if extension in agents_router_impl._PROJECT_TEXT_LIKE_EXTENSIONS:
            text_like_files += 1
        if agents_router_impl._is_recent_project_metric_file(stat.st_mtime):
            recently_updated_files += 1

    signal = {
        "fingerprint": _hash_entries(
            [f"{path}:{fingerprint}" for path, fingerprint in entries.items()]
        ),
        "file_count": file_count,
        "latest_mtime_ns": latest_mtime_ns,
        "summary": {
            "total_files": file_count,
            "builtin_files": builtin_files,
            "visible_files": visible_files,
            "original_files": original_files,
            "derived_files": derived_files,
            "knowledge_candidate_files": knowledge_candidate_files,
            "markdown_files": markdown_files,
            "text_like_files": text_like_files,
            "recently_updated_files": recently_updated_files,
        },
    }
    return signal, entries


def _build_pipeline_signal(
    project_dir: Path,
) -> tuple[dict[str, Any], dict[str, str]]:
    runs_dir = project_dir / ".pipelines" / "runs"
    entries: dict[str, str] = {}
    run_count = 0
    latest_mtime_ns = 0

    if runs_dir.exists() and runs_dir.is_dir():
        for path in sorted(runs_dir.rglob("*.json"), key=lambda item: item.as_posix().lower()):
            try:
                if not path.is_file():
                    continue
                rel = path.relative_to(project_dir).as_posix()
                stat = path.stat()
            except (OSError, ValueError):
                continue

            latest_mtime_ns = max(latest_mtime_ns, stat.st_mtime_ns)
            if path.name == "run_manifest.json":
                run_count += 1
            entries[rel] = f"{stat.st_mtime_ns}:{stat.st_size}"

    signal = {
        "fingerprint": _hash_entries(
            [f"{path}:{fingerprint}" for path, fingerprint in entries.items()]
        ),
        "run_count": run_count,
        "latest_mtime_ns": latest_mtime_ns,
    }
    return signal, entries


def _build_project_realtime_snapshot(
    project_dir: Path,
    project_id: str,
) -> dict[str, Any]:
    file_tree_signal, file_tree_entries = _build_file_tree_signal(project_dir)
    pipeline_signal, pipeline_entries = _build_pipeline_signal(project_dir)
    snapshot = {
        "project_id": project_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "file_tree": file_tree_signal,
        "pipeline": pipeline_signal,
    }
    return {
        "snapshot": snapshot,
        "fingerprint": _hash_entries(
            [
                file_tree_signal["fingerprint"],
                pipeline_signal["fingerprint"],
            ]
        ),
        "file_tree_entries": file_tree_entries,
        "pipeline_entries": pipeline_entries,
    }


@router.websocket("/{agentId}/projects/{projectId}/realtime/ws")
async def stream_project_realtime(
    websocket: WebSocket,
    agentId: str,
    projectId: str,
):
    """Stream lightweight realtime snapshots for one project details page."""
    await websocket.accept()
    interval_ms = _clamp_int(
        websocket.query_params.get("interval_ms"),
        default=1500,
        minimum=750,
        maximum=5000,
    )
    heartbeat_ms = _clamp_int(
        websocket.query_params.get("heartbeat_ms"),
        default=15000,
        minimum=5000,
        maximum=60000,
    )

    manager = getattr(websocket.app.state, "multi_agent_manager", None)
    if manager is None:
        await websocket.send_json(
            {"type": "error", "detail": "MultiAgentManager not initialized"}
        )
        await websocket.close(code=1011)
        return

    try:
        workspace = await manager.get_agent(agentId)
        project_dir = await asyncio.to_thread(
            agents_router_impl._resolve_project_dir,
            Path(workspace.workspace_dir),
            projectId,
        )
    except HTTPException as exc:
        await websocket.send_json({"type": "error", "detail": str(exc.detail)})
        await websocket.close(code=1008)
        return
    except Exception as exc:
        await websocket.send_json({"type": "error", "detail": str(exc)})
        await websocket.close(code=1011)
        return

    loop = asyncio.get_running_loop()
    event_id = 0
    last_explicit_event_id = 0
    previous_state: dict[str, Any] | None = None
    last_emit_at = loop.time()
    try:
        while True:
            current_state = await asyncio.to_thread(
                _build_project_realtime_snapshot,
                project_dir,
                projectId,
            )
            explicit_event_id, explicit_changed_paths = await asyncio.to_thread(
                collect_project_realtime_changes,
                project_dir,
                projectId,
                last_explicit_event_id,
            )
            current_fingerprint = current_state["fingerprint"]
            reason = "change"
            changed_paths: list[str] = []

            if previous_state is None:
                should_emit_snapshot = True
                reason = "initial_sync"
                changed_dirs = []
                changed_paths_truncated = False
                changed_count = 0
            else:
                fingerprint_changed = current_fingerprint != previous_state["fingerprint"]
                explicit_event_changed = explicit_event_id > last_explicit_event_id
                should_emit_snapshot = fingerprint_changed or explicit_event_changed
                if should_emit_snapshot:
                    file_tree_changed: list[str] = []
                    pipeline_changed: list[str] = []
                    if fingerprint_changed:
                        file_tree_changed = _collect_all_changed_paths(
                            previous_state.get("file_tree_entries"),
                            current_state["file_tree_entries"],
                        )
                        pipeline_changed = _collect_all_changed_paths(
                            previous_state.get("pipeline_entries"),
                            current_state["pipeline_entries"],
                        )
                    if explicit_event_changed and not fingerprint_changed:
                        reason = "explicit_event"
                    all_changed_paths = sorted(
                        set(file_tree_changed + pipeline_changed + explicit_changed_paths)
                    )
                    changed_paths = all_changed_paths[:_MAX_CHANGED_PATHS]
                    changed_dirs = _build_changed_dirs(all_changed_paths)
                    changed_paths_truncated = len(all_changed_paths) > _MAX_CHANGED_PATHS
                    changed_count = len(all_changed_paths)
                else:
                    changed_dirs = []
                    changed_paths_truncated = False
                    changed_count = 0

            if should_emit_snapshot:
                event_id += 1
                await websocket.send_json(
                    {
                        "type": "snapshot",
                        "event_id": event_id,
                        "project_id": projectId,
                        "reason": reason,
                        "changed_paths": changed_paths,
                        "changed_dirs": changed_dirs,
                        "changed_paths_truncated": changed_paths_truncated,
                        "changed_count": changed_count,
                        "snapshot": current_state["snapshot"],
                    }
                )
                last_emit_at = loop.time()
            elif (loop.time() - last_emit_at) * 1000 >= heartbeat_ms:
                event_id += 1
                await websocket.send_json(
                    {
                        "type": "heartbeat",
                        "event_id": event_id,
                        "project_id": projectId,
                        "generated_at": datetime.now(timezone.utc).isoformat(),
                    }
                )
                last_emit_at = loop.time()

            previous_state = current_state
            last_explicit_event_id = explicit_event_id
            await asyncio.sleep(interval_ms / 1000)
    except WebSocketDisconnect:
        return