# -*- coding: utf-8 -*-

from __future__ import annotations

import asyncio
import hashlib
import io
import json
import re
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Optional
from types import SimpleNamespace

from fastapi import APIRouter, Body, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

from ...config import load_config, save_config
from ...config.config import KnowledgeConfig, KnowledgeSourceSpec, load_agent_config, save_agent_config
from ...constant import WORKING_DIR
from ...knowledge import (
    GraphOpsManager,
    KnowledgeManager,
)
from copaw.app.flow_engine import (
    FlowRunNotFoundError,
    FlowTransitionConflictError,
    FlowTransitionNotAllowedError,
)
from copaw.knowledge.knowledge_quantization_facade import QuantizationFacade
from copaw.knowledge.project_pipeline_manager import (
    ProjectKnowledgePipelineManager,
    ProjectPipelineCommand,
    ProjectPipelineCoordinator,
    build_project_source_spec,
)
from ...knowledge.module_skills import sync_knowledge_module_skills
from ..knowledge_workflow_steps import KNOWLEDGE_WORKFLOW_STEP_IDS
from ..flow_engine_runtime import get_flow_engine_service
from .knowledge_models import (
    ProjectPipelineCommandResponse,
    ProjectPipelineSourceCandidatesResponse,
    ProjectPipelineSourcesResponse,
    ProjectPipelineRunResponse,
    ProjectPipelineStatusResponse,
)
from ..agent_context import (
    get_loaded_agent_for_request,
    resolve_agent_id_for_request,
)

router = APIRouter(prefix="/knowledge", tags=["knowledge"])
nlp_router = APIRouter(prefix="/nlp", tags=["knowledge"])

_PROJECT_PIPELINE_RUNTIME_LOCK = Lock()
_PROJECT_PIPELINE_RUNTIME_META: dict[str, dict[str, object]] = {}
_PROJECT_PIPELINE_ERROR_SOURCES = {"", "workflow_step", "execution_loop", "flow_control"}
_PROJECT_PIPELINE_COMMAND_CONFLICT = "PROJECT_PIPELINE_COMMAND_CONFLICT"
_PROJECT_PIPELINE_FLOW_RUN_NOT_FOUND = "PROJECT_PIPELINE_FLOW_RUN_NOT_FOUND"
_SUPPORTED_PROJECT_STEP_STATS = frozenset(
    {
        *KNOWLEDGE_WORKFLOW_STEP_IDS,
        "file_analysis",
        "source_scan",
        "domain_graph_build",
    }
)


def _normalize_project_step_id(step_id: str) -> str:
    """Normalize step id by accepting hyphen/underscore variants."""
    raw = str(step_id or "").strip()
    if not raw:
        return ""
    underscore = raw.replace("-", "_")
    hyphen = raw.replace("_", "-")
    for candidate in (underscore, hyphen, raw):
        if candidate in _SUPPORTED_PROJECT_STEP_STATS:
            return candidate
    return ""


def _project_pipeline_runtime_key(workspace_dir: str | Path, project_id: str) -> str:
    return f"{Path(workspace_dir).resolve().as_posix()}::{project_id}"


_PROJECT_PIPELINE_RUNTIME_STATE_FIELDS = (
    "operation_id",
    "idempotency_key",
    "deduplicated",
    "last_action",
    "flow_run_id",
    "recent_control_command",
    "control_updated_at",
    "recent_error_code",
    "recent_error_source",
    "updated_at",
)


def _project_pipeline_state_path(workspace_dir: str | Path, project_id: str) -> Path:
    return Path(workspace_dir) / _knowledge_dirname_for_project(project_id) / "project-pipeline-state.json"


def _persist_project_pipeline_runtime_meta_to_state(
    *,
    workspace_dir: str | Path,
    project_id: str,
    payload: dict[str, object],
) -> None:
    state_path = _project_pipeline_state_path(workspace_dir, project_id)
    state_payload: dict[str, object] = {}
    if state_path.exists():
        try:
            loaded = json.loads(state_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                state_payload = dict(loaded)
        except Exception:
            state_payload = {}
    for field in _PROJECT_PIPELINE_RUNTIME_STATE_FIELDS:
        if field == "updated_at":
            state_payload["operation_updated_at"] = payload.get(field)
        else:
            state_payload[field] = payload.get(field)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    state_path.write_text(json.dumps(state_payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_project_pipeline_runtime_meta_from_state(
    *,
    workspace_dir: str | Path,
    project_id: str,
) -> dict[str, object]:
    state_path = _project_pipeline_state_path(workspace_dir, project_id)
    if not state_path.exists():
        return {}
    try:
        payload = json.loads(state_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(payload, dict):
        return {}
    normalized: dict[str, object] = {}
    for field in _PROJECT_PIPELINE_RUNTIME_STATE_FIELDS:
        if field == "updated_at":
            normalized[field] = payload.get("operation_updated_at")
        else:
            normalized[field] = payload.get(field)
    if not any(normalized.values()):
        return {}
    return normalized


def _record_project_pipeline_runtime_event(
    *,
    workspace_dir: str | Path,
    project_id: str,
    operation_id: str,
    idempotency_key: str,
    deduplicated: bool,
    action: str,
    flow_run_id: str = "",
    control_command: str = "",
    recent_error_code: str | None = None,
    recent_error_source: str | None = None,
) -> None:
    key = _project_pipeline_runtime_key(workspace_dir, project_id)
    existing_flow_run_id = ""
    existing_control_command = ""
    existing_control_updated_at = ""
    existing_recent_error_code = ""
    existing_recent_error_source = ""
    with _PROJECT_PIPELINE_RUNTIME_LOCK:
        existing_payload = _PROJECT_PIPELINE_RUNTIME_META.get(key) or {}
        existing_flow_run_id = str(existing_payload.get("flow_run_id") or "")
        existing_control_command = str(existing_payload.get("recent_control_command") or "")
        existing_control_updated_at = str(existing_payload.get("control_updated_at") or "")
        existing_recent_error_code = str(existing_payload.get("recent_error_code") or "")
        existing_recent_error_source = str(existing_payload.get("recent_error_source") or "")
    now_iso = datetime.now(timezone.utc).isoformat()
    normalized_control_command = str(control_command or "").strip().lower()
    normalized_recent_error_code = (
        existing_recent_error_code
        if recent_error_code is None
        else str(recent_error_code or "").strip()
    )
    if recent_error_source is None:
        normalized_recent_error_source = _normalize_project_pipeline_error_source(existing_recent_error_source)
    else:
        normalized_recent_error_source = _normalize_project_pipeline_error_source(recent_error_source)
    payload = {
        "operation_id": operation_id,
        "idempotency_key": idempotency_key,
        "deduplicated": bool(deduplicated),
        "last_action": action,
        "flow_run_id": str(flow_run_id or existing_flow_run_id),
        "recent_control_command": normalized_control_command or existing_control_command,
        "control_updated_at": now_iso if normalized_control_command else existing_control_updated_at,
        "recent_error_code": normalized_recent_error_code,
        "recent_error_source": normalized_recent_error_source,
        "updated_at": now_iso,
    }
    with _PROJECT_PIPELINE_RUNTIME_LOCK:
        _PROJECT_PIPELINE_RUNTIME_META[key] = payload
    _persist_project_pipeline_runtime_meta_to_state(
        workspace_dir=workspace_dir,
        project_id=project_id,
        payload=payload,
    )


def _get_project_pipeline_runtime_meta(
    *,
    workspace_dir: str | Path,
    project_id: str,
) -> dict[str, object]:
    key = _project_pipeline_runtime_key(workspace_dir, project_id)
    with _PROJECT_PIPELINE_RUNTIME_LOCK:
        cached = dict(_PROJECT_PIPELINE_RUNTIME_META.get(key) or {})
    if cached:
        return cached
    persisted = _load_project_pipeline_runtime_meta_from_state(
        workspace_dir=workspace_dir,
        project_id=project_id,
    )
    if not persisted:
        return {}
    with _PROJECT_PIPELINE_RUNTIME_LOCK:
        _PROJECT_PIPELINE_RUNTIME_META[key] = dict(persisted)
    return dict(persisted)


def _normalize_project_pipeline_error_source(value: object) -> str:
    source = str(value or "").strip().lower()
    return source if source in _PROJECT_PIPELINE_ERROR_SOURCES else ""


def _project_pipeline_command_error_detail(
    *,
    command_type: str,
    error_code: str,
    message: str,
    flow_run_id: str = "",
) -> dict[str, str]:
    normalized_command = str(command_type or "").strip().lower()
    normalized_message = str(message or "").strip() or error_code
    recovery_hint = (
        "Check flow run id/state and retry the command."
        if error_code == _PROJECT_PIPELINE_FLOW_RUN_NOT_FOUND
        else "Check flow command transition/state, then retry with a valid command sequence."
    )
    return {
        "error_code": error_code,
        "error_source": "flow_control",
        "command_type": normalized_command,
        "flow_run_id": str(flow_run_id or ""),
        "message": normalized_message,
        "recovery_hint": recovery_hint,
    }


def _project_pipeline_state_with_runtime_meta(
    *,
    workspace_dir: str | Path,
    project_id: str,
    state: dict[str, object],
) -> dict[str, object]:
    merged = dict(state)
    normalized_state_error_source = _normalize_project_pipeline_error_source(
        merged.get("recent_error_source")
    )
    if normalized_state_error_source:
        merged["recent_error_source"] = normalized_state_error_source
    else:
        merged.pop("recent_error_source", None)
    last_result = merged.get("last_result")
    if isinstance(last_result, dict):
        pipeline_run = last_result.get("pipeline_run")
        if isinstance(pipeline_run, dict):
            step_outputs = pipeline_run.get("step_outputs")
            if isinstance(step_outputs, dict):
                merged.setdefault("step_outputs", step_outputs)
            recent_error_code = str(pipeline_run.get("recent_error_code") or "").strip()
            if recent_error_code:
                merged.setdefault("recent_error_code", recent_error_code)
            recent_error_source = _normalize_project_pipeline_error_source(
                pipeline_run.get("recent_error_source")
            )
            if recent_error_source:
                merged.setdefault("recent_error_source", recent_error_source)
    merged.setdefault("step_outputs", {})

    runtime_meta = _get_project_pipeline_runtime_meta(
        workspace_dir=workspace_dir,
        project_id=project_id,
    )
    if not runtime_meta:
        merged.setdefault("recent_error_code", "")
        merged.setdefault("recent_error_source", "")
        return merged
    merged.setdefault("operation_id", runtime_meta.get("operation_id"))
    merged.setdefault("idempotency_key", runtime_meta.get("idempotency_key"))
    merged.setdefault("deduplicated", runtime_meta.get("deduplicated"))
    merged.setdefault("last_action", runtime_meta.get("last_action"))
    merged.setdefault("flow_run_id", runtime_meta.get("flow_run_id"))
    merged.setdefault("recent_control_command", runtime_meta.get("recent_control_command"))
    merged.setdefault("control_updated_at", runtime_meta.get("control_updated_at"))
    merged.setdefault("operation_updated_at", runtime_meta.get("updated_at"))
    runtime_recent_error_code = str(runtime_meta.get("recent_error_code") or "").strip()
    if not str(merged.get("recent_error_code") or "").strip() and runtime_recent_error_code:
        merged["recent_error_code"] = runtime_recent_error_code
    runtime_recent_error_source = _normalize_project_pipeline_error_source(
        runtime_meta.get("recent_error_source")
    )
    if not str(merged.get("recent_error_source") or "").strip() and runtime_recent_error_source:
        merged["recent_error_source"] = runtime_recent_error_source
    merged.setdefault("recent_error_code", "")
    merged.setdefault("recent_error_source", "")
    return merged


def _map_project_pipeline_status_to_flow_target(status: str) -> str:
    normalized = str(status or "").strip().lower()
    if normalized in {"queued", "pending", "indexing", "graphifying", "running"}:
        return "running"
    if normalized in {"succeeded", "failed", "cancelled"}:
        return normalized
    return ""


def _sync_project_pipeline_flow_state(
    *,
    agent_id: str,
    project_id: str,
    state: dict[str, object],
) -> None:
    flow_run_id = str(state.get("flow_run_id") or "").strip()
    if not flow_run_id:
        return

    target = _map_project_pipeline_status_to_flow_target(str(state.get("status") or ""))
    if not target:
        return

    try:
        service = get_flow_engine_service()
        current_run = service.get_run(agent_id=agent_id, run_id=flow_run_id)
    except Exception:
        return
    if current_run is None:
        return

    current = str(getattr(current_run, "status", "") or "")
    if current == target:
        return

    def _try_transition(next_status: str) -> None:
        nonlocal current
        try:
            updated = service.transition_run(
                agent_id=agent_id,
                run_id=flow_run_id,
                status=next_status,
                payload={
                    "project_id": project_id,
                    "project_pipeline_status": str(state.get("status") or ""),
                },
            )
            current = str(updated.status or "")
        except Exception:
            return

    if target in {"succeeded", "failed", "cancelled"} and current in {"queued", "paused"}:
        _try_transition("running")
    if current != target:
        _try_transition(target)


def _sync_project_pipeline_flow_resume_command(
    *,
    agent_id: str,
    project_id: str,
    flow_run_id: str,
    operation_id: str,
    idempotency_key: str,
    deduplicated: bool,
) -> None:
    normalized_flow_run_id = str(flow_run_id or "").strip()
    if not normalized_flow_run_id:
        return
    try:
        service = get_flow_engine_service()
        current_run = service.get_run(agent_id=agent_id, run_id=normalized_flow_run_id)
    except Exception:
        return
    if current_run is None:
        return

    payload = {
        "project_id": project_id,
        "operation_id": operation_id,
        "idempotency_key": idempotency_key,
        "deduplicated": bool(deduplicated),
        "action": "resume_sync",
    }
    if not bool(deduplicated):
        try:
            service.request_command(
                agent_id=agent_id,
                run_id=normalized_flow_run_id,
                command_type="resume_sync",
                payload=payload,
            )
        except Exception:
            pass

    current_status = str(getattr(current_run, "status", "") or "")
    if current_status == "paused":
        try:
            service.resume_run(
                agent_id=agent_id,
                run_id=normalized_flow_run_id,
                payload=payload,
            )
            return
        except Exception:
            pass

    if current_status == "queued":
        try:
            service.transition_run(
                agent_id=agent_id,
                run_id=normalized_flow_run_id,
                status="running",
                payload=payload,
            )
        except Exception:
            pass


def _task_sort_key(payload: dict[str, object]) -> tuple[int, str]:
    status = str(payload.get("status") or "")
    active_rank = 0 if status in {"pending", "running", "queued", "indexing", "graphifying"} else 1
    return (active_rank, str(payload.get("updated_at") or ""))


def _coerce_int(value: object, default: int = 0) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def _collect_knowledge_tasks_snapshot(
    workspace_dir: str | Path,
    *,
    project_id: str | None = None,
) -> dict[str, object]:
    tasks: list[dict[str, object]] = []

    graph_ops = _graph_ops_for_workspace(
        workspace_dir,
        project_id=project_id,
    )
    active_memify_jobs = graph_ops.list_memify_jobs(active_only=True, limit=5)
    tasks.extend(active_memify_jobs)
    active_quality_jobs = graph_ops.list_quality_loop_jobs(active_only=True, limit=3)
    tasks.extend(active_quality_jobs)
    recent_memify_jobs = graph_ops.list_memify_jobs(active_only=False, limit=10)
    latest_terminal_memify = next(
        (
            job
            for job in recent_memify_jobs
            if str(job.get("status") or "") in {"succeeded", "failed"}
        ),
        None,
    )
    if latest_terminal_memify is not None:
        latest_job_id = str(latest_terminal_memify.get("job_id") or "")
        if all(str(item.get("job_id") or "") != latest_job_id for item in active_memify_jobs):
            tasks.append(latest_terminal_memify)

    knowledge_manager = _manager_for_workspace(
        workspace_dir,
        project_id=project_id,
    )
    backfill_progress = knowledge_manager.get_history_backfill_progress()
    if bool(backfill_progress.get("running")):
        tasks.append(
            {
                "task_id": "history-backfill",
                "job_id": "history-backfill",
                "status": "running",
                **backfill_progress,
            }
        )

    if project_id:
        project_pipeline_raw = _project_pipeline_for_workspace(
            workspace_dir,
            project_id=project_id,
        ).get_state(project_id)
        project_pipeline = _project_pipeline_state_with_runtime_meta(
            workspace_dir=workspace_dir,
            project_id=project_id,
            state=dict(project_pipeline_raw),
        )
        if str(project_pipeline.get("status") or "") in {
            "queued",
            "pending",
            "indexing",
            "graphifying",
        }:
            tasks.append(
                {
                    "task_id": f"project-pipeline:{project_id}",
                    **project_pipeline,
                }
            )

    normalized_tasks = []
    for index, task in enumerate(tasks):
        payload = dict(task)
        payload.setdefault("task_id", str(payload.get("job_id") or f"knowledge-task-{index}"))
        payload.setdefault("task_type", "knowledge")
        payload.setdefault("status", "running")
        payload.setdefault("stage", str(payload.get("current_stage") or "running"))
        payload.setdefault("current_stage", str(payload.get("stage") or payload.get("current_stage") or "running"))
        payload.setdefault("stage_message", "")
        payload.setdefault("percent", _coerce_int(payload.get("progress") or payload.get("percent") or 0))
        payload.setdefault("progress", _coerce_int(payload.get("percent") or payload.get("progress") or 0))
        payload.setdefault("current", 0)
        payload.setdefault("total", 0)
        normalized_tasks.append(payload)

    normalized_tasks.sort(key=_task_sort_key)
    return {
        "tasks": normalized_tasks,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "project_id": project_id or "",
    }


def _ensure_knowledge_enabled_flag(enabled: bool) -> None:
    if not bool(enabled):
        raise HTTPException(status_code=400, detail="KNOWLEDGE_DISABLED")


def _zip_path(path) -> io.BytesIO:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for entry in sorted(path.rglob("*")):
            arcname = entry.relative_to(path).as_posix()
            if entry.is_file():
                zf.write(entry, arcname)
            elif entry.is_dir():
                zf.write(entry, arcname + "/")
    buf.seek(0)
    return buf


def _zip_files(root: Path, files: list[Path]) -> io.BytesIO:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(files, key=lambda item: item.as_posix()):
            if not file_path.exists() or not file_path.is_file():
                continue
            try:
                arcname = file_path.relative_to(root).as_posix()
            except ValueError:
                arcname = file_path.name
            zf.write(file_path, arcname)
    buf.seek(0)
    return buf


def _validate_zip_data(data: bytes) -> None:
    if not zipfile.is_zipfile(io.BytesIO(data)):
        raise HTTPException(
            status_code=400,
            detail="Uploaded file is not a valid zip archive",
        )
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        for name in zf.namelist():
            p = Path(name)
            if p.is_absolute() or ".." in p.parts:
                raise HTTPException(
                    status_code=400,
                    detail=f"Zip contains unsafe path: {name}",
                )


def _extract_zip_to_temp(data: bytes) -> Path:
    tmp_dir = Path(tempfile.mkdtemp(prefix="copaw_knowledge_import_"))
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        zf.extractall(tmp_dir)
    return tmp_dir


def _detect_extract_root(tmp_dir: Path) -> Path:
    entries = [entry for entry in tmp_dir.iterdir() if not entry.name.startswith(".__")]
    if len(entries) == 1 and entries[0].is_dir() and (entries[0] / "sources").exists():
        return entries[0]
    return tmp_dir


def _restore_backup_tree(
    manager: KnowledgeManager,
    extract_root: Path,
    *,
    replace_existing: bool,
) -> list[KnowledgeSourceSpec]:
    if replace_existing and manager.root_dir.exists():
        shutil.rmtree(manager.root_dir, ignore_errors=True)

    manager.root_dir.mkdir(parents=True, exist_ok=True)
    for item in extract_root.iterdir():
        dest = manager.root_dir / item.name
        if item.is_file():
            shutil.copy2(item, dest)
        else:
            if dest.exists() and dest.is_file():
                dest.unlink()
            shutil.copytree(item, dest, dirs_exist_ok=True)

    legacy_sources_dir = manager.root_dir / "sources"
    if legacy_sources_dir.exists() and legacy_sources_dir.is_dir():
        for source_dir in sorted(legacy_sources_dir.iterdir(), key=lambda item: item.name):
            if not source_dir.is_dir():
                continue
            source_id = source_dir.name
            source_json_path = source_dir / "source.json"
            index_json_path = source_dir / "index.json"
            if source_json_path.exists() and source_json_path.is_file():
                try:
                    source_payload = json.loads(source_json_path.read_text(encoding="utf-8"))
                    source_obj = source_payload.get("source") if isinstance(source_payload, dict) else None
                    if isinstance(source_obj, dict):
                        source_id = str(source_obj.get("id") or source_id).strip() or source_id
                except Exception:
                    pass
            elif index_json_path.exists() and index_json_path.is_file():
                try:
                    index_payload = json.loads(index_json_path.read_text(encoding="utf-8"))
                    source_obj = index_payload.get("source") if isinstance(index_payload, dict) else None
                    if isinstance(source_obj, dict):
                        source_id = str(source_obj.get("id") or source_id).strip() or source_id
                except Exception:
                    pass

            for file_item in source_dir.iterdir():
                if not file_item.is_file():
                    continue
                flat_path = manager._source_storage_flat_path(source_id, file_item.name)
                flat_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(file_item, flat_path)

        shutil.rmtree(legacy_sources_dir, ignore_errors=True)

    manager.uploads_dir.mkdir(parents=True, exist_ok=True)
    manager.remote_blob_dir.mkdir(parents=True, exist_ok=True)
    manager.remote_meta_dir.mkdir(parents=True, exist_ok=True)

    return manager.list_sources_from_storage()


def _clamp_int(value: str | None, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int((value or "").strip())
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _manager() -> KnowledgeManager:
    return KnowledgeManager(WORKING_DIR)


def _normalize_project_id(project_id: str | None) -> str | None:
    normalized = (project_id or "").strip()
    if not normalized:
        return None
    safe = re.sub(r"[^A-Za-z0-9_-]+", "-", normalized)
    safe = re.sub(r"-+", "-", safe).strip("-")
    return safe or None


def _resolve_project_id(
    request: Request | None,
    explicit_project_id: str | None = None,
) -> str | None:
    return _normalize_project_id(
        explicit_project_id
        or (request.query_params.get("project_id") if request is not None else None)
        or (request.headers.get("X-Project-Id") if request is not None else None)
    )


def _knowledge_dirname_for_project(project_id: str | None) -> str:
    normalized = _normalize_project_id(project_id)
    if not normalized:
        return "knowledge"
    return f"projects/{normalized}/.knowledge"


def _manager_for_workspace(
    workspace_dir: Path | str,
    *,
    project_id: str | None = None,
) -> KnowledgeManager:
    return KnowledgeManager(
        workspace_dir,
        knowledge_dirname=_knowledge_dirname_for_project(project_id),
    )


async def _project_step_stats_response(
    request: Request,
    *,
    step_id: str,
    limit: int,
) -> dict[str, object]:
    normalized_step_id = _normalize_project_step_id(step_id)
    if not normalized_step_id:
        raise HTTPException(status_code=404, detail="PROJECT_STEP_STATS_NOT_FOUND")
    _, _, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    project_id = _resolve_project_id(request)
    if not project_id:
        raise HTTPException(status_code=400, detail="PROJECT_ID_REQUIRED")
    project_workspace_dir = (Path(workspace_dir) / "projects" / project_id).resolve()
    manager = _manager_for_workspace(
        workspace_dir,
        project_id=project_id,
    )
    latest = await asyncio.to_thread(
        manager.load_project_step_stats,
        project_id=project_id,
        project_workspace_dir=project_workspace_dir,
        step_id=normalized_step_id,
    )
    history = await asyncio.to_thread(
        manager.load_project_step_history,
        project_id=project_id,
        project_workspace_dir=project_workspace_dir,
        step_id=normalized_step_id,
        limit=int(limit),
    )
    return {
        "project_id": project_id,
        "step_id": normalized_step_id,
        "latest": latest,
        "history": history,
    }


def _resolve_project_workspace_dir(
    workspace_dir: Path | str,
    project_id: str | None,
) -> Path:
    root = Path(workspace_dir).expanduser().resolve()
    normalized_project_id = _normalize_project_id(project_id)
    if not normalized_project_id:
        return root
    return (root / "projects" / normalized_project_id).resolve()


def _resolve_ner_target_file_path(
    *,
    workspace_dir: Path | str,
    project_id: str | None,
    file_path: str,
) -> Path:
    text = str(file_path or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="NER_FILE_PATH_REQUIRED")

    project_workspace = _resolve_project_workspace_dir(workspace_dir, project_id)
    if not project_workspace.exists() or not project_workspace.is_dir():
        raise HTTPException(status_code=404, detail="PROJECT_WORKSPACE_NOT_FOUND")

    candidate = Path(text).expanduser()
    resolved = candidate.resolve() if candidate.is_absolute() else (project_workspace / candidate).resolve()

    try:
        resolved.relative_to(project_workspace)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="NER_FILE_PATH_OUT_OF_SCOPE") from exc

    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=404, detail="NER_FILE_NOT_FOUND")

    return resolved


def _build_manual_ner_source_id(file_path: Path) -> str:
    digest = hashlib.sha1(file_path.as_posix().encode("utf-8")).hexdigest()[:16]
    return f"manual-ner-{digest}"


def _build_project_file_source_spec(
    *,
    project_id: str,
    file_path: Path,
) -> KnowledgeSourceSpec:
    digest = hashlib.sha1(file_path.as_posix().encode("utf-8")).hexdigest()[:16]
    source_id = f"project-file-{digest}"
    return KnowledgeSourceSpec(
        id=source_id,
        name=f"Project Source File: {file_path.name}",
        type="file",
        location=file_path.as_posix(),
        content="",
        enabled=True,
        recursive=False,
        project_id=project_id,
        tags=["project", "source-file", f"project:{project_id}"],
        summary=f"Project-scoped source file for {file_path.name}",
    )


def _normalize_manual_source_paths(paths: list[str] | None) -> list[str]:
    normalized: list[str] = []
    for item in list(paths or []):
        value = str(item or "").strip().replace("\\", "/")
        if not value:
            continue
        normalized.append(value)
    return list(dict.fromkeys(normalized))


def _load_manual_source_paths(
    *,
    manager: ProjectKnowledgePipelineManager,
    project_id: str,
) -> list[str]:
    state = manager.get_state(project_id)
    return _normalize_manual_source_paths(list(state.get("manual_source_paths") or []))


def _persist_manual_source_paths(
    *,
    manager: ProjectKnowledgePipelineManager,
    project_id: str,
    manual_source_paths: list[str],
) -> list[str]:
    normalized = _normalize_manual_source_paths(manual_source_paths)
    with manager._lock:
        state = manager._load_state(project_id, hydrate=False)
        state["manual_source_paths"] = normalized
        state["updated_at"] = manager._now_iso()
        manager._save_state(state)
    return normalized


def _resolve_project_manual_source_files(
    *,
    workspace_dir: Path | str,
    project_id: str,
    manual_source_paths: list[str],
) -> list[tuple[str, Path]]:
    resolved: list[tuple[str, Path]] = []
    for rel_path in _normalize_manual_source_paths(manual_source_paths):
        try:
            resolved_file = _resolve_ner_target_file_path(
                workspace_dir=workspace_dir,
                project_id=project_id,
                file_path=rel_path,
            )
        except HTTPException:
            continue
        resolved.append((rel_path, resolved_file))
    return resolved


def _collect_project_source_candidates(
    *,
    project_workspace_dir: Path,
) -> list[str]:
    if not project_workspace_dir.exists() or not project_workspace_dir.is_dir():
        return []
    filter_config = KnowledgeConfig()
    candidates: list[str] = []
    for path in sorted(project_workspace_dir.glob("**/*"), key=lambda item: item.as_posix().lower()):
        if not path.is_file():
            continue
        try:
            rel_path = path.relative_to(project_workspace_dir).as_posix()
        except ValueError:
            continue
        if KnowledgeManager._is_allowed_path(rel_path, filter_config):
            candidates.append(rel_path)
    return candidates


def _graph_ops_for_workspace(
    workspace_dir: Path | str,
    *,
    project_id: str | None = None,
) -> GraphOpsManager:
    return GraphOpsManager(
        workspace_dir,
        knowledge_dirname=_knowledge_dirname_for_project(project_id),
    )


def _project_pipeline_for_workspace(
    workspace_dir: Path | str,
    *,
    project_id: str | None = None,
) -> ProjectKnowledgePipelineManager:
    return ProjectKnowledgePipelineManager(
        workspace_dir,
        knowledge_dirname=_knowledge_dirname_for_project(project_id),
    )


def _quantization_facade_for_workspace(
    workspace_dir: Path | str,
    *,
    project_id: str | None = None,
) -> QuantizationFacade:
    return QuantizationFacade(
        workspace_dir,
        knowledge_dirname=_knowledge_dirname_for_project(project_id),
    )


def _normalize_quant_stage(stage: str) -> str:
    normalized = (stage or "").strip().lower()
    if normalized not in {"l1", "l2", "l3"}:
        raise HTTPException(status_code=400, detail="QUANTIZATION_STAGE_INVALID")
    return normalized


def _project_pipeline_coordinator_for_workspace(
    workspace_dir: Path | str,
    *,
    project_id: str | None = None,
) -> ProjectPipelineCoordinator:
    normalized_project_id = _normalize_project_id(project_id)

    def _factory(_requested_project_id: str) -> ProjectKnowledgePipelineManager:
        resolved_project_id = _normalize_project_id(_requested_project_id) or normalized_project_id
        return _project_pipeline_for_workspace(
            workspace_dir,
            project_id=resolved_project_id,
        )

    return ProjectPipelineCoordinator(
        workspace_dir,
        manager_factory=_factory,
    )


def _effective_knowledge_config(
    knowledge_config: KnowledgeConfig,
    running_config,
) -> KnowledgeConfig:
    """Build request-scoped effective knowledge config.

    Runtime flags that are now agent-specific are projected from running config,
    while structural knowledge settings remain in root config.knowledge.
    """
    effective = knowledge_config.model_copy(deep=True)
    effective.enabled = bool(getattr(running_config, "knowledge_enabled", effective.enabled))
    effective.automation.knowledge_auto_collect_chat_files = bool(
        getattr(
            running_config,
            "knowledge_auto_collect_chat_files",
            effective.automation.knowledge_auto_collect_chat_files,
        ),
    )
    effective.automation.knowledge_auto_collect_chat_urls = bool(
        getattr(
            running_config,
            "knowledge_auto_collect_chat_urls",
            effective.automation.knowledge_auto_collect_chat_urls,
        ),
    )
    effective.automation.knowledge_auto_collect_long_text = bool(
        getattr(
            running_config,
            "knowledge_auto_collect_long_text",
            effective.automation.knowledge_auto_collect_long_text,
        ),
    )
    effective.automation.knowledge_long_text_min_chars = int(
        getattr(
            running_config,
            "knowledge_long_text_min_chars",
            effective.automation.knowledge_long_text_min_chars,
        ),
    )
    effective.index.chunk_size = int(
        getattr(
            running_config,
            "knowledge_chunk_size",
            effective.index.chunk_size,
        ),
    )
    return effective


def _attach_runtime_nlp(knowledge_config: KnowledgeConfig, root_config) -> KnowledgeConfig:
    """Attach top-level nlp config to runtime knowledge payload."""
    effective = knowledge_config.model_copy(deep=True)
    setattr(effective, "nlp", root_config.nlp.model_copy(deep=True))
    return effective


async def _resolve_knowledge_request_context(request: Request | None):
    """Resolve root config + optional agent-scoped runtime/workspace context."""
    config = load_config()
    running_config = config.agents.running
    workspace_dir = WORKING_DIR
    agent_id: str | None = None

    if request is not None:
        try:
            explicit_agent_requested = bool(
                getattr(request.state, "agent_id", None)
                or request.headers.get("X-Agent-Id")
            )
            agent_id = resolve_agent_id_for_request(request)
            workspace = get_loaded_agent_for_request(request, agent_id=agent_id)
            if workspace is not None:
                running_config = workspace.config.running
                workspace_dir = workspace.workspace_dir
            elif explicit_agent_requested:
                agent_ref = config.agents.profiles.get(agent_id)
                if agent_ref is not None:
                    workspace_dir = Path(agent_ref.workspace_dir).expanduser()
                running_config = load_agent_config(agent_id).running
        except HTTPException:
            # Backward compatibility for tests/legacy call sites without
            # initialized MultiAgentManager.
            pass

    knowledge_config = _effective_knowledge_config(config.knowledge, running_config)
    knowledge_config = _attach_runtime_nlp(knowledge_config, config)
    return config, knowledge_config, running_config, workspace_dir, agent_id


async def _resolve_knowledge_ws_context(websocket: WebSocket):
    """Resolve workspace for websocket calls using header/active agent fallback."""
    config = load_config()
    running_config = config.agents.running
    workspace_dir = WORKING_DIR
    agent_id = (
        websocket.headers.get("X-Agent-Id")
        or config.agents.active_agent
        or "default"
    )
    manager = getattr(websocket.app.state, "multi_agent_manager", None)
    if manager is not None:
        try:
            workspace = await manager.get_agent(agent_id)
            if workspace is not None:
                running_config = workspace.config.running
                workspace_dir = workspace.workspace_dir
        except Exception:
            pass

    knowledge_config = _effective_knowledge_config(config.knowledge, running_config)
    knowledge_config = _attach_runtime_nlp(knowledge_config, config)
    return config, knowledge_config, running_config, workspace_dir


def _find_source(config: KnowledgeConfig, source_id: str) -> Optional[KnowledgeSourceSpec]:
    for source in config.sources:
        if source.id == source_id:
            return source
    return None


@router.get("/config", response_model=KnowledgeConfig)
async def get_knowledge_config(request: Request) -> KnowledgeConfig:
    _, effective_knowledge, _, _, _ = await _resolve_knowledge_request_context(request)
    return effective_knowledge


@router.put("/config", response_model=KnowledgeConfig)
async def put_knowledge_config(
    request: Request,
    knowledge_config: KnowledgeConfig = Body(...),
) -> KnowledgeConfig:
    config, _, running_config, _, agent_id = await _resolve_knowledge_request_context(request)
    previous_enabled = bool(getattr(running_config, "knowledge_enabled", False))

    # Persist structural knowledge config in root config.
    config.knowledge = knowledge_config

    # Runtime knowledge toggles belong to the current agent in multi-agent mode.
    if hasattr(running_config, "knowledge_enabled"):
        running_config.knowledge_enabled = knowledge_config.enabled
    if hasattr(running_config, "knowledge_auto_collect_chat_files"):
        running_config.knowledge_auto_collect_chat_files = (
            knowledge_config.automation.knowledge_auto_collect_chat_files
        )
    if hasattr(running_config, "knowledge_auto_collect_chat_urls"):
        running_config.knowledge_auto_collect_chat_urls = (
            knowledge_config.automation.knowledge_auto_collect_chat_urls
        )
    if hasattr(running_config, "knowledge_auto_collect_long_text"):
        running_config.knowledge_auto_collect_long_text = (
            knowledge_config.automation.knowledge_auto_collect_long_text
        )
    if hasattr(running_config, "knowledge_long_text_min_chars"):
        running_config.knowledge_long_text_min_chars = (
            knowledge_config.automation.knowledge_long_text_min_chars
        )
    if hasattr(running_config, "knowledge_chunk_size"):
        running_config.knowledge_chunk_size = knowledge_config.index.chunk_size

    # Keep deprecated root automation fields in sync for backward compatibility.
    config.knowledge.enabled = bool(
        getattr(running_config, "knowledge_enabled", knowledge_config.enabled),
    )
    config.knowledge.automation.knowledge_auto_collect_chat_files = (
        bool(
            getattr(
                running_config,
                "knowledge_auto_collect_chat_files",
                knowledge_config.automation.knowledge_auto_collect_chat_files,
            ),
        )
    )
    config.knowledge.automation.knowledge_auto_collect_chat_urls = (
        bool(
            getattr(
                running_config,
                "knowledge_auto_collect_chat_urls",
                knowledge_config.automation.knowledge_auto_collect_chat_urls,
            ),
        )
    )
    config.knowledge.automation.knowledge_auto_collect_long_text = (
        bool(
            getattr(
                running_config,
                "knowledge_auto_collect_long_text",
                knowledge_config.automation.knowledge_auto_collect_long_text,
            ),
        )
    )
    config.knowledge.automation.knowledge_long_text_min_chars = (
        int(
            getattr(
                running_config,
                "knowledge_long_text_min_chars",
                knowledge_config.automation.knowledge_long_text_min_chars,
            ),
        )
    )
    config.knowledge.index.chunk_size = int(
        getattr(
            running_config,
            "knowledge_chunk_size",
            knowledge_config.index.chunk_size,
        ),
    )

    if agent_id:
        agent_config = load_agent_config(agent_id)
        agent_config.running = running_config
        save_agent_config(agent_id, agent_config)
    else:
        config.agents.running = running_config

    if previous_enabled != knowledge_config.enabled:
        try:
            sync_knowledge_module_skills(knowledge_config.enabled)
        except Exception:
            # Module skills are optional runtime assets; config writes should
            # still succeed when those assets are unavailable.
            pass
    save_config(config)
    return _effective_knowledge_config(config.knowledge, running_config)



@router.get("/sources")
async def list_sources(
    request: Request,
    include_semantic: bool = Query(default=False),
):
    _, knowledge_config, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    project_id = _resolve_project_id(request)
    manager = _manager_for_workspace(
        workspace_dir,
        project_id=project_id,
    )
    sources = await asyncio.to_thread(
        manager.list_sources,
        knowledge_config,
        bool(include_semantic),
    )
    if project_id:
        sources = [
            item
            for item in list(sources or [])
            if str((item or {}).get("project_id") or "").strip() == project_id
        ]
    return {
        "enabled": bool(knowledge_config.enabled),
        "sources": sources,
    }


@router.get("/project-stats/{step_id}")
async def get_project_step_stats(
    step_id: str,
    request: Request,
    limit: int = Query(default=20, ge=1, le=200),
):
    return await _project_step_stats_response(
        request,
        step_id=step_id,
        limit=limit,
    )


@router.put("/sources", response_model=KnowledgeSourceSpec)
async def upsert_source(
    request: Request,
    source: KnowledgeSourceSpec = Body(...),
) -> KnowledgeSourceSpec:
    config, knowledge_config, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    manager = _manager_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request, source.project_id),
    )
    source = await asyncio.to_thread(
        manager.normalize_source_name,
        source,
        knowledge_config,
    )
    existing = _find_source(config.knowledge, source.id)
    project_id_is_explicit = "project_id" in source.model_fields_set
    if existing is not None and not project_id_is_explicit:
        source = source.model_copy(
            update={"project_id": (existing.project_id or "").strip()}
        )
    if existing is None:
        config.knowledge.sources.append(source)
    else:
        index = config.knowledge.sources.index(existing)
        config.knowledge.sources[index] = source
    save_config(config)
    return source


@router.post("/upload/file")
async def upload_knowledge_file(
    request: Request,
    source_id: str = Form(...),
    file: UploadFile = File(...),
):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    _, _, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    manager = _manager_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    saved_path = await asyncio.to_thread(
        manager.save_uploaded_file,
        source_id=source_id,
        filename=file.filename or "knowledge-upload",
        data=data,
    )
    return {
        "location": str(saved_path),
        "filename": saved_path.name,
    }


@router.post("/upload/directory")
async def upload_knowledge_directory(
    request: Request,
    source_id: str = Form(...),
    relative_paths: list[str] = Form(...),
    files: list[UploadFile] = File(...),
):
    if len(files) != len(relative_paths):
        raise HTTPException(
            status_code=400,
            detail="files and relative_paths length mismatch",
        )
    saved_pairs = []
    for relative_path, upload in zip(relative_paths, files):
        saved_pairs.append((relative_path, await upload.read()))
    _, _, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    manager = _manager_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    saved_root = await asyncio.to_thread(
        manager.save_uploaded_directory,
        source_id,
        saved_pairs,
    )
    return {
        "location": str(saved_root),
        "file_count": len(saved_pairs),
    }


@router.delete("/sources/{source_id}")
async def delete_source(source_id: str, request: Request):
    config, knowledge_config, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)
    source = _find_source(config.knowledge, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="KNOWLEDGE_SOURCE_NOT_FOUND")
    config.knowledge.sources = [
        item for item in config.knowledge.sources if item.id != source_id
    ]
    save_config(config)
    manager = _manager_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    await asyncio.to_thread(manager.delete_index, source_id)
    return {"deleted": True, "source_id": source_id}


@router.delete("/clear")
async def clear_knowledge(
    request: Request,
    confirm: bool = Query(default=False),
    remove_sources: bool = Query(default=True),
):
    """Clear all persisted knowledge data and optionally remove source configs."""
    if not confirm:
        raise HTTPException(status_code=400, detail="KNOWLEDGE_CLEAR_CONFIRM_REQUIRED")

    config, knowledge_config, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)
    manager = _manager_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    result = await asyncio.to_thread(
        manager.clear_knowledge,
        config.knowledge,
        remove_sources=remove_sources,
    )
    save_config(config)
    return result


@router.post("/sources/{source_id}/index")
async def index_source(source_id: str, request: Request):
    config, knowledge_config, running_config, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)
    source = _find_source(config.knowledge, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="KNOWLEDGE_SOURCE_NOT_FOUND")
    try:
        manager = _manager_for_workspace(
            workspace_dir,
            project_id=_resolve_project_id(request),
        )
        result = await asyncio.to_thread(
            manager.index_source,
            source,
            knowledge_config,
            running_config,
        )
    except (FileNotFoundError, ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return result


@router.get("/sources/{source_id}/content")
async def get_source_content(source_id: str, request: Request):
    config, _, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    source = _find_source(config.knowledge, source_id)
    if source is None:
        raise HTTPException(status_code=404, detail="KNOWLEDGE_SOURCE_NOT_FOUND")
    manager = _manager_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    return await asyncio.to_thread(manager.get_source_documents, source_id)


@router.post("/index")
async def index_all_sources(request: Request):
    config, knowledge_config, running_config, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)
    try:
        manager = _manager_for_workspace(
            workspace_dir,
            project_id=_resolve_project_id(request),
        )
        return await asyncio.to_thread(
            manager.index_all,
            knowledge_config,
            running_config,
        )
    except (FileNotFoundError, ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/ner/process-file")
async def process_ner_for_file(
    request: Request,
    file_path: str = Body(...),
    overwrite: bool = Body(default=True),
    source_id: str | None = Body(default=None),
    source_name: str | None = Body(default=None),
):
    """Run NER processing for a single file path.

    - `file_path` accepts an absolute path or a project/workspace-relative path.
    - `overwrite` defaults to `True` and will replace previous results for the same source id.
    """
    _, knowledge_config, running_config, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)

    project_id = _resolve_project_id(request)
    resolved_file = _resolve_ner_target_file_path(
        workspace_dir=workspace_dir,
        project_id=project_id,
        file_path=file_path,
    )

    normalized_source_id = str(source_id or "").strip() or _build_manual_ner_source_id(resolved_file)
    normalized_source_name = str(source_name or "").strip() or f"Manual NER: {resolved_file.name}"

    manager = _manager_for_workspace(
        workspace_dir,
        project_id=project_id,
    )

    existing_status = await asyncio.to_thread(manager.get_source_status, normalized_source_id)
    if bool(existing_status.get("indexed")) and not bool(overwrite):
        raise HTTPException(status_code=409, detail="NER_RESULT_ALREADY_EXISTS")

    if bool(overwrite):
        await asyncio.to_thread(manager.delete_index, normalized_source_id)

    source = KnowledgeSourceSpec(
        id=normalized_source_id,
        name=normalized_source_name,
        type="file",
        location=resolved_file.as_posix(),
        content="",
        enabled=True,
        recursive=False,
        tags=["manual", "ner", "single-file"],
        summary="Manual NER processing request",
        project_id=project_id or "",
    )

    try:
        index_result = await asyncio.to_thread(
            manager.index_source,
            source,
            knowledge_config,
            running_config,
        )
        documents_payload = await asyncio.to_thread(manager.get_source_documents, normalized_source_id)
    except (FileNotFoundError, ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "accepted": True,
        "source_id": normalized_source_id,
        "source_name": normalized_source_name,
        "file_path": resolved_file.as_posix(),
        "overwrite": bool(overwrite),
        "index": index_result,
        "documents": list((documents_payload or {}).get("documents") or []),
    }


@router.get("/search")
async def search_knowledge(
    request: Request,
    q: str = Query(..., min_length=1),
    limit: int = Query(default=10, ge=1, le=50),
    source_ids: Optional[str] = Query(default=None),
    source_types: Optional[str] = Query(default=None),
    project_scope: Optional[str] = Query(default=None),
    include_global: bool = Query(default=True),
    scope_type: Optional[str] = Query(default=None),
    scope_id: Optional[str] = Query(default=None),
):
    config, knowledge_config, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)
    ids = [item for item in (source_ids or "").split(",") if item]
    types = [item for item in (source_types or "").split(",") if item]
    projects = [item.strip() for item in (project_scope or "").split(",") if item.strip()]
    normalized_scope_type = (scope_type or "").strip().lower()
    if normalized_scope_type and normalized_scope_type not in {"agent", "project"}:
        raise HTTPException(status_code=400, detail="INVALID_SCOPE_TYPE")
    normalized_scope_id = (scope_id or "").strip()
    manager = _manager_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    search_config = knowledge_config
    if not projects and not normalized_scope_type and not _resolve_project_id(request):
        search_config = knowledge_config.model_copy(deep=True)
        search_config.sources = [
            source
            for source in list(search_config.sources or [])
            if "visibility:sync-only" not in {
                str(tag).strip().lower() for tag in list(getattr(source, "tags", []) or [])
            }
        ]
    return await asyncio.to_thread(
        manager.search,
        query=q,
        config=search_config,
        limit=limit,
        source_ids=ids or None,
        source_types=types or None,
        project_scope=projects or None,
        include_global=include_global,
        scope_type=normalized_scope_type or None,
        scope_id=normalized_scope_id or None,
    )


@router.post("/quantization/stages/{stage}/run")
async def run_quantization_stage(
    stage: str,
    request: Request,
    source_id: str = Body(...),
    snapshot_id: str = Body(default="latest"),
    metrics: dict[str, object] | None = Body(default=None),
    metadata: dict[str, object] | None = Body(default=None),
):
    _, knowledge_config, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)
    normalized_stage = _normalize_quant_stage(stage)
    if not bool(getattr(knowledge_config, "memify_enabled", False)):
        raise HTTPException(status_code=400, detail="MEMIFY_DISABLED")
    facade = _quantization_facade_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    try:
        payload = await asyncio.to_thread(
            facade.run_stage,
            stage=normalized_stage,
            source_id=(source_id or "").strip(),
            snapshot_id=(snapshot_id or "latest").strip() or "latest",
            metrics=dict(metrics or {}),
            metadata=dict(metadata or {}),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return payload


@router.get("/quantization/stages/{stage}/stats")
async def get_quantization_stage_stats(
    stage: str,
    request: Request,
    source_id: str = Query(default=""),
    snapshot_id: str = Query(default=""),
    limit: int = Query(default=50, ge=1, le=200),
):
    _, knowledge_config, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)
    normalized_stage = _normalize_quant_stage(stage)
    if not bool(getattr(knowledge_config, "memify_enabled", False)):
        raise HTTPException(status_code=400, detail="MEMIFY_DISABLED")
    facade = _quantization_facade_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    source_text = (source_id or "").strip()
    snapshot_text = (snapshot_id or "").strip()
    if source_text and snapshot_text:
        payload = await asyncio.to_thread(
            facade.get_stage_stats,
            stage=normalized_stage,
            source_id=source_text,
            snapshot_id=snapshot_text,
        )
        if payload is None:
            raise HTTPException(status_code=404, detail="QUANTIZATION_STAGE_RESULT_NOT_FOUND")
        return payload
    return await asyncio.to_thread(
        facade.list_stage_stats,
        stage=normalized_stage,
        source_id=source_text or None,
        limit=limit,
    )


@router.get("/quantization/compare/stages")
async def compare_quantization_stages(
    request: Request,
    source_id: str = Query(...),
    snapshot_id: str = Query(...),
):
    _, knowledge_config, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)
    if not bool(getattr(knowledge_config, "memify_enabled", False)):
        raise HTTPException(status_code=400, detail="MEMIFY_DISABLED")
    facade = _quantization_facade_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    return await asyncio.to_thread(
        facade.compare_stages,
        source_id=(source_id or "").strip(),
        snapshot_id=(snapshot_id or "").strip(),
    )


@router.get("/quantization/compare/versions")
async def compare_quantization_versions(
    request: Request,
    source_id: str = Query(...),
    snapshot_a: str = Query(...),
    snapshot_b: str = Query(...),
    stage: str = Query(default="l2"),
):
    _, knowledge_config, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)
    normalized_stage = _normalize_quant_stage(stage)
    if not bool(getattr(knowledge_config, "memify_enabled", False)):
        raise HTTPException(status_code=400, detail="MEMIFY_DISABLED")
    facade = _quantization_facade_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    return await asyncio.to_thread(
        facade.compare_versions,
        source_id=(source_id or "").strip(),
        snapshot_a=(snapshot_a or "").strip(),
        snapshot_b=(snapshot_b or "").strip(),
        stage=normalized_stage,
    )


@router.get("/quantization/compare/sources")
async def compare_quantization_sources(
    request: Request,
    source_a: str = Query(...),
    source_b: str = Query(...),
    stage: str = Query(default="l1"),
    snapshot_id: str | None = Query(default=None),
):
    _, knowledge_config, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)
    normalized_stage = _normalize_quant_stage(stage)
    if not bool(getattr(knowledge_config, "memify_enabled", False)):
        raise HTTPException(status_code=400, detail="MEMIFY_DISABLED")
    facade = _quantization_facade_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    return await asyncio.to_thread(
        facade.compare_sources,
        source_a=(source_a or "").strip(),
        source_b=(source_b or "").strip(),
        stage=normalized_stage,
        snapshot_id=(snapshot_id or "").strip() or None,
    )


@router.get("/graph-query")
async def query_knowledge_graph(
    request: Request,
    q: str = Query(..., min_length=1),
    mode: str = Query(default="template"),
    output_mode: str = Query(default=""),
    dataset_scope: Optional[str] = Query(default=None),
    project_scope: Optional[str] = Query(default=None),
    include_global: bool = Query(default=True),
    scope_type: Optional[str] = Query(default=None),
    scope_id: Optional[str] = Query(default=None),
    top_k: int = Query(default=10, ge=1),
    timeout_sec: int = Query(default=20, ge=1, le=120),
):
    config, knowledge_config, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)

    query_text = (q or "").strip()
    if not query_text:
        raise HTTPException(status_code=400, detail="GRAPH_QUERY_TEXT_REQUIRED")

    query_mode = (mode or "template").strip().lower()
    if query_mode not in {"template", "cypher"}:
        raise HTTPException(status_code=400, detail="GRAPH_QUERY_MODE_INVALID")

    requested_output_mode = (output_mode or "").strip().lower()
    graph_query_enabled = bool(
        getattr(knowledge_config, "graph_query_enabled", False)
    )
    effective_output_mode = requested_output_mode or None
    downgraded_to_fast = False

    if not graph_query_enabled:
        if query_mode == "template":
            # Keep template queries available on cold-start projects by
            # forcing fast preview mode when graph query is disabled.
            effective_output_mode = "fast"
            downgraded_to_fast = (
                requested_output_mode not in {"", "fast"}
            )
        else:
            raise HTTPException(status_code=400, detail="GRAPH_QUERY_DISABLED")

    if query_mode == "cypher" and not bool(getattr(knowledge_config, "allow_cypher_query", False)):
        raise HTTPException(status_code=400, detail="GRAPH_CYPHER_DISABLED")

    normalized_scope_type = (scope_type or "").strip().lower()
    if normalized_scope_type and normalized_scope_type not in {"agent", "project"}:
        raise HTTPException(status_code=400, detail="INVALID_SCOPE_TYPE")
    normalized_scope_id = (scope_id or "").strip()

    scope_items = [item for item in (dataset_scope or "").split(",") if item.strip()]
    project_scope_items = [
        item.strip() for item in (project_scope or "").split(",") if item.strip()
    ]
    try:
        graph_ops = _graph_ops_for_workspace(
            workspace_dir,
            project_id=_resolve_project_id(request),
        )
        result = await asyncio.to_thread(
            graph_ops.graph_query,
            config=knowledge_config,
            query_mode=query_mode,
            query_text=query_text,
            dataset_scope=scope_items or None,
            project_scope=project_scope_items or None,
            include_global=include_global,
            scope_type=normalized_scope_type or None,
            scope_id=normalized_scope_id or None,
            top_k=top_k,
            timeout_sec=timeout_sec,
            preferred_output_mode=effective_output_mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    warnings = list(result.warnings or [])
    provenance = dict(result.provenance or {})
    if downgraded_to_fast:
        warnings.append("AUTO_DOWNGRADED_TO_FAST")
        provenance["requested_output_mode"] = requested_output_mode
        provenance["effective_output_mode"] = effective_output_mode

    return {
        "records": result.records,
        "summary": result.summary,
        "provenance": provenance,
        "warnings": warnings,
    }


@router.get("/history-backfill/status")
async def get_history_backfill_status(request: Request):
    """Get history backfill status for knowledge enable flow and CTA display."""
    _, _, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    manager = _manager_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    return await asyncio.to_thread(manager.history_backfill_status)


@router.get("/tasks/snapshot")
async def get_knowledge_tasks_snapshot(request: Request):
    _, _, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    return await asyncio.to_thread(
        _collect_knowledge_tasks_snapshot,
        workspace_dir,
        project_id=_resolve_project_id(request),
    )


@nlp_router.post("/tasks/{task_key}/run")
async def run_knowledge_nlp_task(
    task_key: str,
    request: Request,
    body: dict = Body(...),
):
    """Run NLP task demo (compat endpoint for settings /nlp page)."""
    payload = body or {}
    text = str(payload.get("text") or "").strip()
    texts_raw = payload.get("texts")
    tokens_raw = payload.get("tokens")
    tokens_batch_raw = payload.get("tokens_batch")

    has_text = bool(text)
    has_texts = isinstance(texts_raw, list) and len(texts_raw) > 0
    has_tokens = isinstance(tokens_raw, list) and len(tokens_raw) > 0
    has_tokens_batch = isinstance(tokens_batch_raw, list) and len(tokens_batch_raw) > 0
    if not (has_text or has_texts or has_tokens or has_tokens_batch):
        raise HTTPException(status_code=422, detail="text, texts, tokens or tokens_batch is required")

    request_id_raw = payload.get("request_id")
    request_id = str(request_id_raw).strip() if request_id_raw is not None else None

    try:
        from copaw.app.routers.knowledge_hanlp_tasks import (
            HanLPTaskRunRequest,
            _run_hanlp_task,
        )
    except Exception as exc:  # pragma: no cover - compatibility guard
        raise HTTPException(
            status_code=501,
            detail="NLP task demo runtime is unavailable in current deployment.",
        ) from exc

    return await _run_hanlp_task(
        task_key,
        HanLPTaskRunRequest(
            text=text if has_text else None,
            texts=texts_raw if has_texts else None,
            tokens=tokens_raw if has_tokens else None,
            tokens_batch=tokens_batch_raw if has_tokens_batch else None,
            request_id=request_id,
        ),
        request,
    )


@router.post("/history-backfill/run")
async def run_history_backfill_now(request: Request):
    """Run history backfill immediately regardless of runtime auto-backfill toggle."""
    config, knowledge_config, running, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)
    manager = _manager_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    force_running = SimpleNamespace(
        knowledge_auto_collect_chat_files=running.knowledge_auto_collect_chat_files,
        knowledge_auto_collect_chat_urls=running.knowledge_auto_collect_chat_urls,
        knowledge_auto_collect_long_text=running.knowledge_auto_collect_long_text,
        knowledge_long_text_min_chars=running.knowledge_long_text_min_chars,
        knowledge_chunk_size=running.knowledge_chunk_size,
    )
    result = await asyncio.to_thread(
        manager.auto_backfill_history_data,
        knowledge_config,
        force_running,
    )
    if result.get("changed"):
        save_config(config)
    status = await asyncio.to_thread(manager.history_backfill_status)
    return {
        "result": result,
        "status": status,
    }


@router.get("/memify/jobs/{job_id}")
async def get_memify_job_status(job_id: str, request: Request):
    """Get status of a memify enrichment job."""
    normalized_job_id = (job_id or "").strip()
    if not normalized_job_id:
        raise HTTPException(status_code=400, detail="MEMIFY_JOB_ID_REQUIRED")

    config, knowledge_config, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)
    if not knowledge_config.enabled:
        raise HTTPException(status_code=400, detail="KNOWLEDGE_DISABLED")
    if not bool(getattr(knowledge_config, "memify_enabled", False)):
        raise HTTPException(status_code=400, detail="MEMIFY_DISABLED")

    manager = _graph_ops_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    payload = await asyncio.to_thread(manager.get_memify_status, normalized_job_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="MEMIFY_JOB_NOT_FOUND")
    return payload


@router.post("/quality-loop/run")
async def run_quality_loop(
    request: Request,
    max_rounds: int = Body(default=3),
    dry_run: bool = Body(default=False),
    dataset_scope: list[str] | None = Body(default=None),
):
    config, knowledge_config, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)
    if not bool(getattr(knowledge_config, "memify_enabled", False)):
        raise HTTPException(status_code=400, detail="MEMIFY_DISABLED")

    manager = _graph_ops_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    return await asyncio.to_thread(
        manager.run_quality_self_drive,
        config=knowledge_config,
        dataset_scope=dataset_scope,
        project_id=_resolve_project_id(request),
        max_rounds=max_rounds,
        dry_run=bool(dry_run),
    )


@router.get("/quality-loop/jobs")
async def list_quality_loop_jobs(
    request: Request,
    active_only: bool = Query(default=False),
    limit: int = Query(default=10, ge=1, le=50),
):
    _, _, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    manager = _graph_ops_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    jobs = await asyncio.to_thread(
        manager.list_quality_loop_jobs,
        active_only=bool(active_only),
        limit=limit,
    )
    return {
        "items": jobs,
        "count": len(jobs),
    }


@router.get("/quality-loop/jobs/{job_id}")
async def get_quality_loop_job_status(job_id: str, request: Request):
    normalized_job_id = (job_id or "").strip()
    if not normalized_job_id:
        raise HTTPException(status_code=400, detail="QUALITY_LOOP_JOB_ID_REQUIRED")

    _, knowledge_config, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)
    manager = _graph_ops_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    payload = await asyncio.to_thread(manager.get_quality_loop_status, normalized_job_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="QUALITY_LOOP_JOB_NOT_FOUND")
    return payload


@router.post("/memify/jobs")
async def start_memify_job(
    request: Request,
    pipeline_type: str = Body(default="full"),
    dataset_scope: list[str] | None = Body(default=None),
    idempotency_key: str = Body(default=""),
    dry_run: bool = Body(default=False),
    project_id: str | None = Body(default=None),
):
    """Start a memify enrichment job asynchronously."""
    _, knowledge_config, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)
    if not bool(getattr(knowledge_config, "memify_enabled", False)):
        raise HTTPException(status_code=400, detail="MEMIFY_DISABLED")

    normalized_pipeline_type = (pipeline_type or "full").strip() or "full"
    normalized_scope = [
        item.strip()
        for item in (dataset_scope or [])
        if isinstance(item, str) and item.strip()
    ]
    manager = _graph_ops_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request, project_id),
    )
    try:
        return await asyncio.to_thread(
            manager.run_memify,
            config=knowledge_config,
            pipeline_type=normalized_pipeline_type,
            dataset_scope=normalized_scope or None,
            idempotency_key=(idempotency_key or "").strip(),
            dry_run=bool(dry_run),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/project-pipeline/sources", response_model=ProjectPipelineSourcesResponse)
async def get_project_pipeline_sources(request: Request):
    """Get manually curated source file paths for project pipeline."""
    _, _, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    project_id = _resolve_project_id(request)
    if not project_id:
        raise HTTPException(status_code=400, detail="PROJECT_ID_REQUIRED")

    manager = _project_pipeline_for_workspace(
        workspace_dir,
        project_id=project_id,
    )
    manual_source_paths = await asyncio.to_thread(
        _load_manual_source_paths,
        manager=manager,
        project_id=project_id,
    )
    return {
        "project_id": project_id,
        "manual_source_paths": manual_source_paths,
    }


@router.put("/project-pipeline/sources", response_model=ProjectPipelineSourcesResponse)
async def update_project_pipeline_sources(
    request: Request,
    manual_source_paths: list[str] = Body(default_factory=list),
):
    """Replace manual source file paths for project pipeline."""
    _, _, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    project_id = _resolve_project_id(request)
    if not project_id:
        raise HTTPException(status_code=400, detail="PROJECT_ID_REQUIRED")

    project_workspace_dir = (Path(workspace_dir) / "projects" / project_id).resolve()
    if not project_workspace_dir.exists() or not project_workspace_dir.is_dir():
        raise HTTPException(status_code=404, detail="PROJECT_WORKSPACE_NOT_FOUND")

    normalized_paths = _normalize_manual_source_paths(manual_source_paths)
    resolved_paths: list[str] = []
    for path in normalized_paths:
        resolved_file = _resolve_ner_target_file_path(
            workspace_dir=workspace_dir,
            project_id=project_id,
            file_path=path,
        )
        resolved_paths.append(resolved_file.relative_to(project_workspace_dir).as_posix())

    manager = _project_pipeline_for_workspace(
        workspace_dir,
        project_id=project_id,
    )
    persisted = await asyncio.to_thread(
        _persist_manual_source_paths,
        manager=manager,
        project_id=project_id,
        manual_source_paths=resolved_paths,
    )
    return {
        "project_id": project_id,
        "manual_source_paths": persisted,
    }


@router.get("/project-pipeline/source-candidates", response_model=ProjectPipelineSourceCandidatesResponse)
async def get_project_pipeline_source_candidates(request: Request):
    """List auto-discovered project files as candidate sources for manual selection."""
    _, _, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    project_id = _resolve_project_id(request)
    if not project_id:
        raise HTTPException(status_code=400, detail="PROJECT_ID_REQUIRED")

    project_workspace_dir = (Path(workspace_dir) / "projects" / project_id).resolve()
    if not project_workspace_dir.exists() or not project_workspace_dir.is_dir():
        raise HTTPException(status_code=404, detail="PROJECT_WORKSPACE_NOT_FOUND")

    candidates = await asyncio.to_thread(
        _collect_project_source_candidates,
        project_workspace_dir=project_workspace_dir,
    )
    return {
        "project_id": project_id,
        "candidates": candidates,
    }


@router.get("/project-pipeline/status", response_model=ProjectPipelineStatusResponse)
async def get_project_pipeline_status(request: Request):
    """Get project-scoped automatic knowledge pipeline status."""
    config, knowledge_config, running_config, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    agent_id = resolve_agent_id_for_request(request)
    project_id = _resolve_project_id(request)
    if not project_id:
        raise HTTPException(status_code=400, detail="PROJECT_ID_REQUIRED")

    manager = _project_pipeline_for_workspace(
        workspace_dir,
        project_id=project_id,
    )
    project_workspace_dir = (Path(workspace_dir) / "projects" / project_id).resolve()
    state_snapshot = await asyncio.to_thread(manager.get_state, project_id)
    manual_source_paths = _normalize_manual_source_paths(list(state_snapshot.get("manual_source_paths") or []))
    execution_context = dict(state_snapshot.get("execution_context") or {})
    preferred_path = str(execution_context.get("source_file_path") or "").strip()
    if preferred_path and preferred_path in manual_source_paths:
        resolved_sources = _resolve_project_manual_source_files(
            workspace_dir=workspace_dir,
            project_id=project_id,
            manual_source_paths=[preferred_path],
        )
    else:
        resolved_sources = _resolve_project_manual_source_files(
            workspace_dir=workspace_dir,
            project_id=project_id,
            manual_source_paths=manual_source_paths,
        )
    if resolved_sources:
        _, source_file = resolved_sources[0]
        source = _build_project_file_source_spec(
            project_id=project_id,
            file_path=source_file,
        )
    else:
        source = build_project_source_spec(
            project_id=project_id,
            project_name=project_id,
            project_workspace_dir=str(project_workspace_dir),
        )
    coordinator = _project_pipeline_coordinator_for_workspace(
        workspace_dir,
        project_id=project_id,
    )
    try:
        resume_event = None
        resume_event = await asyncio.to_thread(
            coordinator.dispatch,
            ProjectPipelineCommand.resume(
                project_id=project_id,
                config=knowledge_config,
                running_config=running_config,
                source=source,
                idempotency_key=f"route-status-resume:{project_id}",
            ),
        )
        _record_project_pipeline_runtime_event(
            workspace_dir=workspace_dir,
            project_id=project_id,
            operation_id=str(getattr(resume_event, "operation_id", "") or ""),
            idempotency_key=str(getattr(resume_event, "idempotency_key", "") or ""),
            deduplicated=bool(getattr(resume_event, "deduplicated", False)),
            action=str(getattr(resume_event, "action", "") or "resume_sync"),
        )

        runtime_meta = _get_project_pipeline_runtime_meta(
            workspace_dir=workspace_dir,
            project_id=project_id,
        )
        _sync_project_pipeline_flow_resume_command(
            agent_id=agent_id,
            project_id=project_id,
            flow_run_id=str(runtime_meta.get("flow_run_id") or ""),
            operation_id=str(getattr(resume_event, "operation_id", "") or ""),
            idempotency_key=str(getattr(resume_event, "idempotency_key", "") or ""),
            deduplicated=bool(getattr(resume_event, "deduplicated", False)),
        )
    except AttributeError:
        pass

    state = await asyncio.to_thread(manager.get_state, project_id)
    payload = _project_pipeline_state_with_runtime_meta(
        workspace_dir=workspace_dir,
        project_id=project_id,
        state=dict(state),
    )
    _sync_project_pipeline_flow_state(
        agent_id=agent_id,
        project_id=project_id,
        state=payload,
    )
    lanes = dict(payload.get("lanes") or {})
    lanes.setdefault("retrieval", {"mode": "fast"})
    lanes.setdefault("quantization", {"mode": "nlp"})
    payload["lanes"] = lanes
    quantization_stages = dict(payload.get("quantization_stages") or {})
    quantization_stages.setdefault("l1", {})
    quantization_stages.setdefault("l2", {})
    quantization_stages.setdefault("l3", {})
    payload["quantization_stages"] = quantization_stages
    return payload


@router.post("/project-pipeline/run", response_model=ProjectPipelineRunResponse)
async def run_project_pipeline(
    request: Request,
    trigger: str = Body(default="manual"),
    changed_paths: list[str] | None = Body(default=None),
    force: bool = Body(default=False),
    processing_mode: str | None = Body(default=None),
    quantization_stage: str | None = Body(default=None),
    source_file_path: str | None = Body(default=None),
    rerun_layer: str | None = Body(default=None),
    rerun_step_id: str | None = Body(default=None),
    overwrite: bool = Body(default=True),
    idempotency_key: str = Body(default=""),
):
    """Start project-scoped automatic knowledge pipeline."""
    config, knowledge_config, running_config, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    _ensure_knowledge_enabled_flag(knowledge_config.enabled)
    processing_mode_explicit = processing_mode is not None
    normalized_mode = (processing_mode or "agentic").strip().lower() or "agentic"
    normalized_stage = (quantization_stage or "").strip().lower() or None
    if normalized_mode not in {"fast", "nlp", "agentic"}:
        raise HTTPException(status_code=400, detail="PROCESSING_MODE_INVALID")
    if normalized_stage is not None and normalized_stage not in {"l1", "l2", "l3"}:
        raise HTTPException(status_code=400, detail="QUANTIZATION_STAGE_INVALID")
    if normalized_mode in {"nlp", "agentic"} and not bool(getattr(knowledge_config, "memify_enabled", False)):
        raise HTTPException(status_code=400, detail="MEMIFY_DISABLED")

    project_id = _resolve_project_id(request)
    if not project_id:
        raise HTTPException(status_code=400, detail="PROJECT_ID_REQUIRED")

    semantic_engine = _manager_for_workspace(
        workspace_dir,
        project_id=project_id,
    ).get_semantic_engine_state(knowledge_config)
    semantic_status = str(semantic_engine.get("status") or "").strip().lower()
    if (
        not processing_mode_explicit
        and normalized_mode in {"nlp", "agentic"}
        and semantic_status in {"unavailable", "error"}
    ):
        normalized_mode = "fast"
        normalized_stage = "l1"

    project_workspace_dir = (Path(workspace_dir) / "projects" / project_id).resolve()
    if not project_workspace_dir.exists() or not project_workspace_dir.is_dir():
        raise HTTPException(status_code=404, detail="PROJECT_WORKSPACE_NOT_FOUND")

    manager = _project_pipeline_for_workspace(
        workspace_dir,
        project_id=project_id,
    )
    manual_source_paths = _load_manual_source_paths(
        manager=manager,
        project_id=project_id,
    )
    resolved_source_file_path = ""
    normalized_rerun_layer = str(rerun_layer or "").strip().lower()
    normalized_rerun_step_id = str(rerun_step_id or "").strip().lower()
    if source_file_path and str(source_file_path).strip():
        resolved_file = _resolve_ner_target_file_path(
            workspace_dir=workspace_dir,
            project_id=project_id,
            file_path=str(source_file_path),
        )
        resolved_source_file_path = resolved_file.relative_to(project_workspace_dir).as_posix()
        source = _build_project_file_source_spec(
            project_id=project_id,
            file_path=resolved_file,
        )
        if not changed_paths:
            changed_paths = [resolved_source_file_path]
    else:
        resolved_sources = _resolve_project_manual_source_files(
            workspace_dir=workspace_dir,
            project_id=project_id,
            manual_source_paths=manual_source_paths,
        )
        if not resolved_sources:
            raise HTTPException(status_code=400, detail="PROJECT_PIPELINE_MANUAL_SOURCE_REQUIRED")
        resolved_source_file_path, resolved_file = resolved_sources[0]
        source = _build_project_file_source_spec(
            project_id=project_id,
            file_path=resolved_file,
        )
        if not changed_paths:
            changed_paths = [resolved_source_file_path]

    execution_context = {
        "scope": "source_file" if resolved_source_file_path else "project",
        "source_file_path": resolved_source_file_path,
        "rerun_layer": normalized_rerun_layer,
        "rerun_step_id": normalized_rerun_step_id,
        "overwrite": bool(overwrite),
    }
    coordinator = _project_pipeline_coordinator_for_workspace(
        workspace_dir,
        project_id=project_id,
    )
    try:
        event = await asyncio.to_thread(
            coordinator.dispatch,
            ProjectPipelineCommand.start(
                project_id=project_id,
                config=knowledge_config,
                running_config=running_config,
                source=source,
                trigger=(trigger or "manual").strip() or "manual",
                changed_paths=changed_paths,
                auto_enabled=True,
                force=bool(force),
                processing_mode=normalized_mode,
                quantization_stage=normalized_stage,
                execution_context=execution_context,
                idempotency_key=(idempotency_key or "").strip() or None,
            ),
        )

        flow_run_id = ""
        if bool(getattr(event, "deduplicated", False)):
            runtime_meta = _get_project_pipeline_runtime_meta(
                workspace_dir=workspace_dir,
                project_id=project_id,
            )
            flow_run_id = str(runtime_meta.get("flow_run_id") or "")
        if not flow_run_id:
            try:
                from ..knowledge_workflow import ensure_project_flow_run_bridge

                flow_run_id = await asyncio.to_thread(
                    ensure_project_flow_run_bridge,
                    agent_id=resolve_agent_id_for_request(request),
                    project_id=project_id,
                    trigger=(trigger or "manual").strip() or "manual",
                    processing_mode=normalized_mode,
                    idempotency_key=str(getattr(event, "idempotency_key", "") or ""),
                )
            except Exception:
                flow_run_id = ""

        _record_project_pipeline_runtime_event(
            workspace_dir=workspace_dir,
            project_id=project_id,
            operation_id=event.operation_id,
            idempotency_key=event.idempotency_key,
            deduplicated=event.deduplicated,
            action=event.action,
            flow_run_id=flow_run_id,
        )

        payload = dict(getattr(event, "payload", {}) or {})
        if flow_run_id:
            payload["flow_run_id"] = flow_run_id
            _sync_project_pipeline_flow_state(
                agent_id=resolve_agent_id_for_request(request),
                project_id=project_id,
                state={
                    "flow_run_id": flow_run_id,
                    "status": str(payload.get("status") or payload.get("reason") or "pending"),
                },
            )
        return payload
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/project-pipeline/commands", response_model=ProjectPipelineCommandResponse)
async def command_project_pipeline(
    request: Request,
    command_type: str = Body(default="pause"),
    payload: dict[str, object] | None = Body(default=None),
):
    """Issue a control command (pause/resume/cancel) for the bridged flow run."""
    _, _, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    agent_id = resolve_agent_id_for_request(request)
    project_id = _resolve_project_id(request)
    if not project_id:
        raise HTTPException(status_code=400, detail="PROJECT_ID_REQUIRED")

    normalized_command = str(command_type or "").strip().lower()
    if normalized_command not in {"pause", "resume", "cancel"}:
        raise HTTPException(status_code=400, detail="PROJECT_PIPELINE_COMMAND_INVALID")

    runtime_meta = _get_project_pipeline_runtime_meta(
        workspace_dir=workspace_dir,
        project_id=project_id,
    )
    flow_run_id = str(runtime_meta.get("flow_run_id") or "").strip()
    if not flow_run_id:
        _record_project_pipeline_runtime_event(
            workspace_dir=workspace_dir,
            project_id=project_id,
            operation_id=f"manual-flow-{normalized_command}-error:{project_id}",
            idempotency_key=f"manual-flow-{normalized_command}-error:{project_id}",
            deduplicated=False,
            action=f"flow_{normalized_command}_failed",
            recent_error_code=_PROJECT_PIPELINE_FLOW_RUN_NOT_FOUND,
            recent_error_source="flow_control",
        )
        raise HTTPException(
            status_code=404,
            detail=_project_pipeline_command_error_detail(
                command_type=normalized_command,
                error_code=_PROJECT_PIPELINE_FLOW_RUN_NOT_FOUND,
                message=_PROJECT_PIPELINE_FLOW_RUN_NOT_FOUND,
            ),
        )

    flow_service = get_flow_engine_service()
    command_payload = {
        "project_id": project_id,
        "source": "knowledge.project-pipeline.commands",
        **dict(payload or {}),
    }
    try:
        if normalized_command == "pause":
            updated = flow_service.pause_run(
                agent_id=agent_id,
                run_id=flow_run_id,
                payload=command_payload,
            )
        elif normalized_command == "resume":
            updated = flow_service.resume_run(
                agent_id=agent_id,
                run_id=flow_run_id,
                payload=command_payload,
            )
        else:
            updated = flow_service.cancel_run(
                agent_id=agent_id,
                run_id=flow_run_id,
                payload=command_payload,
            )
    except FlowRunNotFoundError as exc:
        _record_project_pipeline_runtime_event(
            workspace_dir=workspace_dir,
            project_id=project_id,
            operation_id=f"manual-flow-{normalized_command}-error:{project_id}",
            idempotency_key=f"manual-flow-{normalized_command}-error:{flow_run_id}",
            deduplicated=False,
            action=f"flow_{normalized_command}_failed",
            flow_run_id=flow_run_id,
            control_command=normalized_command,
            recent_error_code=_PROJECT_PIPELINE_FLOW_RUN_NOT_FOUND,
            recent_error_source="flow_control",
        )
        raise HTTPException(
            status_code=404,
            detail=_project_pipeline_command_error_detail(
                command_type=normalized_command,
                error_code=_PROJECT_PIPELINE_FLOW_RUN_NOT_FOUND,
                message=str(exc),
                flow_run_id=flow_run_id,
            ),
        ) from exc
    except (FlowTransitionNotAllowedError, FlowTransitionConflictError) as exc:
        _record_project_pipeline_runtime_event(
            workspace_dir=workspace_dir,
            project_id=project_id,
            operation_id=f"manual-flow-{normalized_command}-error:{project_id}",
            idempotency_key=f"manual-flow-{normalized_command}-error:{flow_run_id}",
            deduplicated=False,
            action=f"flow_{normalized_command}_failed",
            flow_run_id=flow_run_id,
            control_command=normalized_command,
            recent_error_code=_PROJECT_PIPELINE_COMMAND_CONFLICT,
            recent_error_source="flow_control",
        )
        raise HTTPException(
            status_code=409,
            detail=_project_pipeline_command_error_detail(
                command_type=normalized_command,
                error_code=_PROJECT_PIPELINE_COMMAND_CONFLICT,
                message=str(exc),
                flow_run_id=flow_run_id,
            ),
        ) from exc

    _record_project_pipeline_runtime_event(
        workspace_dir=workspace_dir,
        project_id=project_id,
        operation_id=f"manual-flow-{normalized_command}:{project_id}",
        idempotency_key=f"manual-flow-{normalized_command}:{flow_run_id}",
        deduplicated=False,
        action=f"flow_{normalized_command}",
        flow_run_id=flow_run_id,
        control_command=normalized_command,
        recent_error_code="",
        recent_error_source="",
    )
    updated_runtime_meta = _get_project_pipeline_runtime_meta(
        workspace_dir=workspace_dir,
        project_id=project_id,
    )
    return {
        "project_id": project_id,
        "flow_run_id": flow_run_id,
        "command_type": normalized_command,
        "run": updated.model_dump(mode="json"),
        "runtime_meta": {
            "operation_id": str(updated_runtime_meta.get("operation_id") or ""),
            "idempotency_key": str(updated_runtime_meta.get("idempotency_key") or ""),
            "last_action": str(updated_runtime_meta.get("last_action") or ""),
            "recent_control_command": str(updated_runtime_meta.get("recent_control_command") or ""),
            "control_updated_at": str(updated_runtime_meta.get("control_updated_at") or ""),
            "flow_run_id": str(updated_runtime_meta.get("flow_run_id") or ""),
            "deduplicated": bool(updated_runtime_meta.get("deduplicated", False)),
        },
    }


@router.websocket("/history-backfill/progress/ws")
async def stream_history_backfill_progress(websocket: WebSocket):
    """Stream history backfill progress to console with WebSocket."""
    await websocket.accept()
    interval_ms = _clamp_int(
        websocket.query_params.get("interval_ms"),
        default=1000,
        minimum=300,
        maximum=3000,
    )

    _, _, _, workspace_dir = await _resolve_knowledge_ws_context(websocket)
    manager = _manager_for_workspace(
        workspace_dir,
        project_id=_normalize_project_id(
            websocket.query_params.get("project_id")
            or websocket.headers.get("X-Project-Id")
        ),
    )

    last_fingerprint: str | None = None
    try:
        while True:
            progress = await asyncio.to_thread(manager.get_history_backfill_progress)
            fingerprint = json.dumps(
                progress,
                ensure_ascii=False,
                sort_keys=True,
                default=str,
            )
            if fingerprint != last_fingerprint:
                await websocket.send_json(
                    {
                        "type": "snapshot",
                        "progress": progress,
                    }
                )
                last_fingerprint = fingerprint
            await asyncio.sleep(interval_ms / 1000)
    except WebSocketDisconnect:
        return


@router.websocket("/project-pipeline/ws")
async def stream_project_pipeline(websocket: WebSocket):
    """Stream project-scoped knowledge pipeline snapshots with WebSocket."""
    await websocket.accept()
    interval_ms = _clamp_int(
        websocket.query_params.get("interval_ms"),
        default=1000,
        minimum=300,
        maximum=3000,
    )

    project_id = _normalize_project_id(
        websocket.query_params.get("project_id")
        or websocket.headers.get("X-Project-Id")
    )
    if not project_id:
        await websocket.send_json({"type": "error", "detail": "PROJECT_ID_REQUIRED"})
        await websocket.close(code=1008)
        return

    _, _, _, workspace_dir = await _resolve_knowledge_ws_context(websocket)
    manager = _project_pipeline_for_workspace(
        workspace_dir,
        project_id=project_id,
    )

    last_fingerprint: str | None = None
    try:
        while True:
            snapshot_raw = await asyncio.to_thread(manager.get_state, project_id)
            snapshot = _project_pipeline_state_with_runtime_meta(
                workspace_dir=workspace_dir,
                project_id=project_id,
                state=dict(snapshot_raw),
            )
            fingerprint = json.dumps(
                snapshot,
                ensure_ascii=False,
                sort_keys=True,
                default=str,
            )
            if fingerprint != last_fingerprint:
                await websocket.send_json({"type": "snapshot", "state": snapshot})
                last_fingerprint = fingerprint
            await asyncio.sleep(interval_ms / 1000)
    except WebSocketDisconnect:
        return


@router.websocket("/tasks/ws")
async def stream_knowledge_tasks(websocket: WebSocket):
    """Stream aggregated knowledge task snapshots with WebSocket."""
    await websocket.accept()
    interval_ms = _clamp_int(
        websocket.query_params.get("interval_ms"),
        default=1000,
        minimum=300,
        maximum=3000,
    )

    project_id = _normalize_project_id(
        websocket.query_params.get("project_id")
        or websocket.headers.get("X-Project-Id")
    )
    _, _, _, workspace_dir = await _resolve_knowledge_ws_context(websocket)

    last_fingerprint: str | None = None
    try:
        while True:
            snapshot = await asyncio.to_thread(
                _collect_knowledge_tasks_snapshot,
                workspace_dir,
                project_id=project_id,
            )
            fingerprint = json.dumps(
                snapshot,
                ensure_ascii=False,
                sort_keys=True,
                default=str,
            )
            if fingerprint != last_fingerprint:
                await websocket.send_json({"type": "snapshot", "snapshot": snapshot})
                last_fingerprint = fingerprint
            await asyncio.sleep(interval_ms / 1000)
    except WebSocketDisconnect:
        return


@router.get("/backup")
async def backup_knowledge(request: Request):
    _, _, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    manager = _manager_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    if not manager.root_dir.exists():
        raise HTTPException(status_code=404, detail="KNOWLEDGE_NOT_FOUND")

    buf = await asyncio.to_thread(_zip_path, manager.root_dir)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"copaw_knowledge_{timestamp}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.get("/backup/{source_id}")
async def backup_knowledge_source(source_id: str, request: Request):
    _, _, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    manager = _manager_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    source_files = manager.get_source_storage_files(source_id)
    if not source_files:
        raise HTTPException(status_code=404, detail="KNOWLEDGE_SOURCE_NOT_FOUND")

    buf = await asyncio.to_thread(_zip_files, manager.root_dir, source_files)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    safe_name = manager._safe_name(source_id)
    filename = f"copaw_knowledge_{safe_name}_{timestamp}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )


@router.post("/restore")
async def restore_knowledge_backup(
    request: Request,
    file: UploadFile = File(...),
    replace_existing: bool = Query(default=True),
):
    if file.content_type and file.content_type not in {
        "application/zip",
        "application/x-zip-compressed",
        "application/octet-stream",
    }:
        raise HTTPException(
            status_code=400,
            detail=f"Expected a zip file, got content-type: {file.content_type}",
        )

    data = await file.read()
    _validate_zip_data(data)

    config, _, _, workspace_dir, _ = await _resolve_knowledge_request_context(request)
    manager = _manager_for_workspace(
        workspace_dir,
        project_id=_resolve_project_id(request),
    )
    tmp_dir: Path | None = None
    try:
        tmp_dir = await asyncio.to_thread(_extract_zip_to_temp, data)
        extract_root = await asyncio.to_thread(_detect_extract_root, tmp_dir)
        if not extract_root.exists() or not extract_root.is_dir():
            raise HTTPException(
                status_code=400,
                detail="Invalid knowledge backup: empty archive",
            )

        config.knowledge.sources = await asyncio.to_thread(
            _restore_backup_tree,
            manager,
            extract_root,
            replace_existing=replace_existing,
        )
        save_config(config)

        return {
            "success": True,
            "replace_existing": replace_existing,
            "restored_sources": len(config.knowledge.sources),
        }
    finally:
        if tmp_dir and tmp_dir.exists():
            shutil.rmtree(tmp_dir, ignore_errors=True)