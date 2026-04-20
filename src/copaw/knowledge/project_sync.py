# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import logging
import re
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Callable

from ..config.config import KnowledgeConfig, KnowledgeSourceSpec
from .graph_ops import GraphOpsManager
from .manager import KnowledgeManager

logger = logging.getLogger(__name__)

DEFAULT_PROJECT_SYNC_DEBOUNCE_SECONDS = 3.0
DEFAULT_PROJECT_SYNC_COOLDOWN_SECONDS = 10.0
DEFAULT_PROJECT_SYNC_STALE_AFTER_SECONDS = 120.0
DEFAULT_PROJECT_SYNC_QUALITY_LOOP_ROUNDS = 3
KNOWLEDGE_PROCESSING_FALLBACK_CHAIN = ["agentic", "nlp", "fast"]
KNOWLEDGE_PROCESSING_SUPPORTED_MODES = {"fast", "nlp", "agentic"}


def build_project_source_id(project_id: str) -> str:
    safe_id = re.sub(r"[^a-z0-9_-]+", "-", (project_id or "").strip().lower())
    safe_id = re.sub(r"-+", "-", safe_id).strip("-")
    return f"project-{safe_id or 'default'}-workspace"


def build_project_source_spec(
    *,
    project_id: str,
    project_name: str,
    project_workspace_dir: str,
) -> KnowledgeSourceSpec:
    return KnowledgeSourceSpec(
        id=build_project_source_id(project_id),
        name=f"Project Workspace: {project_name or project_id}",
        type="directory",
        location=(project_workspace_dir or "").strip(),
        content="",
        enabled=True,
        recursive=True,
        project_id=(project_id or "").strip(),
        tags=["project", f"project:{project_id}", "scope:project"],
        summary=f"Project-scoped knowledge source for {project_name or project_id}",
    )


def ensure_project_source_registered(
    config: KnowledgeConfig,
    *,
    project_id: str,
    project_name: str,
    project_workspace_dir: str,
    persist: Callable[[], None] | None = None,
) -> tuple[KnowledgeSourceSpec, bool]:
    expected = build_project_source_spec(
        project_id=project_id,
        project_name=project_name,
        project_workspace_dir=project_workspace_dir,
    )
    changed = False
    existing_index = -1
    for index, source in enumerate(config.sources):
        if source.id == expected.id:
            existing_index = index
            break

    if existing_index < 0:
        config.sources.append(expected)
        changed = True
    else:
        current = config.sources[existing_index]
        desired_payload = expected.model_dump(mode="json")
        current_payload = current.model_dump(mode="json")
        if current_payload != desired_payload:
            config.sources[existing_index] = expected
            changed = True

    if changed and persist is not None:
        persist()
    return expected, changed


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


class ProjectKnowledgeSyncManager:
    """Project-scoped background synchronization for knowledge indexing + memify."""

    _locks_guard = threading.Lock()
    _locks: dict[str, threading.Lock] = {}
    _timers_guard = threading.Lock()
    _timers: dict[str, threading.Timer] = {}
    _active_statuses = {"pending", "indexing", "graphifying", "running"}

    def __init__(
        self,
        working_dir: Path | str,
        *,
        knowledge_dirname: str = "knowledge",
    ) -> None:
        self.working_dir = Path(working_dir)
        self.knowledge_dirname = knowledge_dirname
        self.knowledge_root = self.working_dir / knowledge_dirname
        self.state_path = self.knowledge_root / "project-sync-state.json"
        self._lock = self._get_lock(str(self.state_path.resolve()))
        self._knowledge_manager = KnowledgeManager(
            self.working_dir,
            knowledge_dirname=knowledge_dirname,
        )
        self._graph_ops = GraphOpsManager(
            self.working_dir,
            knowledge_dirname=knowledge_dirname,
        )

    @classmethod
    def _get_lock(cls, key: str) -> threading.Lock:
        with cls._locks_guard:
            lock = cls._locks.get(key)
            if lock is None:
                lock = threading.Lock()
                cls._locks[key] = lock
            return lock

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(UTC).isoformat()

    @staticmethod
    def _parse_iso(value: Any) -> datetime | None:
        text = str(value or "").strip()
        if not text:
            return None
        try:
            return datetime.fromisoformat(text)
        except ValueError:
            return None

    @staticmethod
    def _normalize_seconds(value: Any) -> float:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return 0.0
        return max(0.0, parsed)

    def _default_state(self, project_id: str) -> dict[str, Any]:
        return {
            "project_id": project_id,
            "task_type": "project_sync",
            "status": "idle",
            "current_stage": "idle",
            "stage": "idle",
            "stage_message": "Idle",
            "progress": 0,
            "percent": 0,
            "current": 0,
            "total": 0,
            "eta_seconds": None,
            "auto_enabled": True,
            "dirty": False,
            "dirty_after_run": False,
            "last_trigger": "",
            "changed_paths": [],
            "pending_changed_paths": [],
            "changed_count": 0,
            "scheduled_for": None,
            "queued_at": None,
            "last_change_at": None,
            "debounce_seconds": 0,
            "cooldown_seconds": 0,
            "last_error": "",
            "last_started_at": None,
            "last_finished_at": None,
            "last_success_at": None,
            "indexed_processing_fingerprint": "",
            "updated_at": self._now_iso(),
            "latest_job_id": "",
            "latest_workflow_run_id": "",
            "latest_requested_mode": "agentic",
            "latest_source_id": "",
            "last_result": {},
            "processing_modes": [],
            "processing_mode_overrides": {},
            "active_output_resolution": {
                "active_mode": "fast",
                "available_modes": [],
                "fallback_chain": KNOWLEDGE_PROCESSING_FALLBACK_CHAIN[:],
                "reason_code": "FALLBACK_TO_FAST",
                "reason": "High-order outputs are not ready yet; using fast preview.",
                "skipped_modes": [],
            },
            "processing_scheduler": {
                "strategy": "parallel",
                "mode_order": KNOWLEDGE_PROCESSING_FALLBACK_CHAIN[:],
                "running_modes": [],
                "queued_modes": [],
                "ready_modes": [],
                "failed_modes": [],
                "next_mode": "fast",
                "consumption_mode": "fast",
                "reason": "Scheduler is waiting for the fast preview lane to start.",
            },
            "mode_outputs": {},
        }

    def _relative_workspace_path(self, value: str | Path | None) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        candidate = Path(text)
        try:
            resolved = candidate.resolve()
        except Exception:
            return text.replace("\\", "/")
        try:
            return resolved.relative_to(self.working_dir.resolve()).as_posix()
        except Exception:
            return resolved.as_posix()

    def _build_mode_outputs(self, state: dict[str, Any]) -> dict[str, Any]:
        last_result = state.get("last_result") or {}
        if not isinstance(last_result, dict):
            last_result = {}
        index_result = last_result.get("index") or {}
        memify_result = last_result.get("memify") or {}
        quality_loop_result = last_result.get("quality_loop") or {}
        workflow_run = last_result.get("workflow_run") or {}
        if not isinstance(index_result, dict):
            index_result = {}
        if not isinstance(memify_result, dict):
            memify_result = {}
        if not isinstance(quality_loop_result, dict):
            quality_loop_result = {}
        if not isinstance(workflow_run, dict):
            workflow_run = {}
        workflow_mode = str(
            workflow_run.get("mode") or state.get("latest_requested_mode") or ""
        ).strip().lower()

        latest_source_id = str(state.get("latest_source_id") or "").strip()
        fast_artifacts: list[dict[str, str]] = []
        if latest_source_id:
            index_path = self._knowledge_manager._source_index_path(latest_source_id)
            content_path = self._knowledge_manager._source_content_md_path(latest_source_id)
            if index_path.exists():
                fast_artifacts.append(
                    {
                        "kind": "index",
                        "label": "Indexed source payload",
                        "path": self._relative_workspace_path(index_path),
                    }
                )
            if content_path.exists():
                fast_artifacts.append(
                    {
                        "kind": "preview",
                        "label": "Rendered source preview",
                        "path": self._relative_workspace_path(content_path),
                    }
                )

        nlp_artifacts: list[dict[str, str]] = []
        for kind, label, raw_path in [
            ("graph", "Raw knowledge graph", memify_result.get("graph_path") or self._graph_ops.local_graph_path),
            ("enriched_graph", "Enriched knowledge graph", memify_result.get("enriched_graph_path") or self._graph_ops.enriched_graph_path),
            (
                "quality_report",
                "Knowledge quality report",
                memify_result.get("enrichment_quality_report_path")
                or quality_loop_result.get("enrichment_quality_report_path")
                or self._graph_ops.enrichment_quality_report_path,
            ),
        ]:
            rel_path = self._relative_workspace_path(raw_path)
            if rel_path:
                nlp_artifacts.append(
                    {
                        "kind": kind,
                        "label": label,
                        "path": rel_path,
                    }
                )

        agentic_artifacts: list[dict[str, str]] = []
        workflow_artifacts = workflow_run.get("artifacts")
        if isinstance(workflow_artifacts, list):
            for raw_path in workflow_artifacts:
                rel_path = self._relative_workspace_path(raw_path)
                if not rel_path:
                    continue
                agentic_artifacts.append(
                    {
                        "kind": "workflow_artifact",
                        "label": Path(rel_path).name,
                        "path": rel_path,
                    }
                )
        return {
            "fast": {
                "mode": "fast",
                "source": "indexed-preview",
                "summary_lines": [
                    f"Documents: {_safe_int(index_result.get('document_count'))}",
                    f"Chunks: {_safe_int(index_result.get('chunk_count'))}",
                ],
                "artifacts": fast_artifacts,
            },
            "nlp": {
                "mode": "nlp",
                "source": "graph-artifacts",
                "summary_lines": [
                    f"Entities: {_safe_int(memify_result.get('node_count'))}",
                    f"Relations: {_safe_int(memify_result.get('relation_count'))}",
                ],
                "artifacts": nlp_artifacts,
            },
            "agentic": {
                "mode": "agentic",
                "source": "workflow-artifacts",
                "summary_lines": [
                    f"Run: {str(workflow_run.get('run_id') or '').strip()}",
                    f"Status: {str(workflow_run.get('status') or '').strip()}",
                    f"Mode: {workflow_mode or 'agentic'}",
                ],
                "artifacts": agentic_artifacts,
            },
        }

    def _build_processing_modes(self, state: dict[str, Any]) -> list[dict[str, Any]]:
        last_result = state.get("last_result") or {}
        if not isinstance(last_result, dict):
            last_result = {}
        index_result = last_result.get("index") or {}
        memify_result = last_result.get("memify") or {}
        quality_loop_result = last_result.get("quality_loop") or {}
        workflow_run = last_result.get("workflow_run") or {}
        if not isinstance(index_result, dict):
            index_result = {}
        if not isinstance(memify_result, dict):
            memify_result = {}
        if not isinstance(quality_loop_result, dict):
            quality_loop_result = {}
        if not isinstance(workflow_run, dict):
            workflow_run = {}

        sync_status = str(state.get("status") or "").strip().lower()
        sync_stage = str(state.get("current_stage") or state.get("stage") or "").strip().lower()
        sync_percent = _safe_int(state.get("percent") if state.get("percent") is not None else state.get("progress"))
        latest_updated_at = str(
            state.get("last_finished_at")
            or state.get("last_success_at")
            or state.get("updated_at")
            or ""
        ).strip()

        document_count = max(
            _safe_int(index_result.get("document_count")),
            _safe_int(memify_result.get("document_count")),
        )
        chunk_count = _safe_int(index_result.get("chunk_count"))
        entity_count = max(
            _safe_int(memify_result.get("node_count")),
            _safe_int((memify_result.get("enrichment_metrics") or {}).get("node_count"))
            if isinstance(memify_result.get("enrichment_metrics"), dict)
            else 0,
        )
        relation_count = max(
            _safe_int(memify_result.get("relation_count")),
            _safe_int((memify_result.get("enrichment_metrics") or {}).get("edge_count"))
            if isinstance(memify_result.get("enrichment_metrics"), dict)
            else 0,
        )
        workflow_status = str(workflow_run.get("status") or "").strip().lower()
        workflow_mode = str(
            workflow_run.get("mode") or state.get("latest_requested_mode") or ""
        ).strip().lower()
        workflow_run_id = str(
            workflow_run.get("run_id") or state.get("latest_workflow_run_id") or ""
        ).strip()
        quality_score = _safe_float(
            quality_loop_result.get("score_after")
            or quality_loop_result.get("score_before")
            or quality_loop_result.get("quality_score_after")
            or quality_loop_result.get("quality_score")
        )

        fast_available = document_count > 0 or chunk_count > 0
        nlp_available = entity_count > 0 or relation_count > 0
        agentic_available = workflow_status in {"succeeded", "completed"} and workflow_mode in {"", "agentic"}

        fast_running = sync_status in {"pending", "indexing"} or sync_stage in {"pending", "indexing"}
        nlp_running = sync_status == "graphifying" or sync_stage == "graphifying" or sync_stage.startswith("graphify")
        agentic_running = workflow_status in {"running", "pending"} or (
            sync_status in {"pending", "indexing", "graphifying"} and bool(workflow_run_id)
        )
        agentic_queued = workflow_status == "queued"

        fast_status = (
            "failed"
            if sync_status == "failed" and not fast_available
            else "running"
            if fast_running
            else "ready"
            if fast_available
            else "queued"
            if str(state.get("latest_source_id") or "").strip()
            else "idle"
        )
        nlp_status = (
            "failed"
            if sync_status == "failed" and not nlp_available
            else "running"
            if nlp_running
            else "ready"
            if nlp_available
            else "queued"
            if fast_available
            else "idle"
        )
        agentic_status = (
            "failed"
            if workflow_status in {"failed", "blocked", "cancelled"} or (sync_status == "failed" and not agentic_available)
            else "queued"
            if agentic_queued
            else "running"
            if agentic_running
            else "ready"
            if agentic_available
            else "queued"
            if nlp_available or bool(workflow_run_id)
            else "idle"
        )

        modes = [
            {
                "mode": "fast",
                "status": fast_status,
                "available": fast_available,
                "progress": sync_percent if fast_status == "running" else None,
                "stage": (
                    str(state.get("stage_message") or state.get("current_stage") or "Building fast preview")
                    if fast_status == "running"
                    else "Fast preview ready"
                    if fast_available
                    else "Waiting for source indexing"
                ),
                "summary": (
                    "Fast preview is ready for quick consumption."
                    if fast_available
                    else "Fast preview is waiting for the base index."
                ),
                "last_updated_at": latest_updated_at,
                "run_id": "",
                "job_id": str(state.get("latest_job_id") or "").strip(),
                "document_count": document_count,
                "chunk_count": chunk_count,
                "entity_count": 0,
                "relation_count": 0,
                "quality_score": None,
            },
            {
                "mode": "nlp",
                "status": nlp_status,
                "available": nlp_available,
                "progress": sync_percent if nlp_status == "running" else None,
                "stage": (
                    str(state.get("stage_message") or state.get("current_stage") or "Building NLP artifacts")
                    if nlp_status == "running"
                    else "NLP graph artifacts ready"
                    if nlp_available
                    else "Waiting for graph extraction"
                ),
                "summary": (
                    "Structured graph artifacts are available as the fallback layer."
                    if nlp_available
                    else "Structured graph artifacts are not ready yet."
                ),
                "last_updated_at": latest_updated_at,
                "run_id": "",
                "job_id": str(state.get("latest_job_id") or "").strip(),
                "document_count": document_count,
                "chunk_count": chunk_count,
                "entity_count": entity_count,
                "relation_count": relation_count,
                "quality_score": quality_score,
            },
            {
                "mode": "agentic",
                "status": agentic_status,
                "available": agentic_available,
                "progress": sync_percent if agentic_status == "running" else None,
                "stage": (
                    str(state.get("stage_message") or state.get("current_stage") or "Running multi-agent workflow")
                    if agentic_status == "running"
                    else "Multi-agent outputs ready"
                    if agentic_available
                    else "Workflow run exists but outputs are incomplete"
                    if workflow_run_id
                    else "Waiting for multi-agent workflow scheduling"
                ),
                "summary": (
                    "Multi-agent knowledge outputs are ready and preferred for consumption."
                    if agentic_available
                    else "High-quality long-running processing continues in the background."
                ),
                "last_updated_at": str(workflow_run.get("updated_at") or latest_updated_at or "").strip(),
                "run_id": workflow_run_id,
                "job_id": str(state.get("latest_job_id") or "").strip(),
                "document_count": document_count,
                "chunk_count": chunk_count,
                "entity_count": entity_count,
                "relation_count": relation_count,
                "quality_score": quality_score,
            },
        ]

        overrides = state.get("processing_mode_overrides") or {}
        if isinstance(overrides, dict):
            for item in modes:
                mode_key = str(item.get("mode") or "").strip()
                override = overrides.get(mode_key)
                if not isinstance(override, dict):
                    continue
                if override.get("status") in {"idle", "queued", "running", "ready", "failed"}:
                    item["status"] = override.get("status")
                if "available" in override:
                    item["available"] = bool(override.get("available"))
                if override.get("progress") is not None:
                    item["progress"] = _safe_int(override.get("progress"))
                if str(override.get("stage") or "").strip():
                    item["stage"] = str(override.get("stage") or "").strip()
                if str(override.get("summary") or "").strip():
                    item["summary"] = str(override.get("summary") or "").strip()
                if str(override.get("run_id") or "").strip():
                    item["run_id"] = str(override.get("run_id") or "").strip()
                if str(override.get("job_id") or "").strip():
                    item["job_id"] = str(override.get("job_id") or "").strip()

        return modes

    def _build_output_resolution(self, processing_modes: list[dict[str, Any]]) -> dict[str, Any]:
        status_by_mode = {
            str(item.get("mode") or "").strip(): str(item.get("status") or "idle").strip()
            for item in processing_modes
        }
        available_by_mode = {
            str(item.get("mode") or "").strip(): bool(item.get("available"))
            for item in processing_modes
        }

        available_modes = [
            str(item.get("mode") or "").strip()
            for item in processing_modes
            if bool(item.get("available"))
        ]

        def build_skip_reason(mode: str) -> dict[str, str]:
            status = status_by_mode.get(mode, "idle")
            available = available_by_mode.get(mode, False)
            if status == "failed":
                return {
                    "mode": mode,
                    "status": status,
                    "reason_code": "MODE_FAILED",
                    "reason": "Processing failed for this mode.",
                }
            if status == "running":
                return {
                    "mode": mode,
                    "status": status,
                    "reason_code": "MODE_RUNNING",
                    "reason": "Processing is still running for this mode.",
                }
            if status == "queued":
                return {
                    "mode": mode,
                    "status": status,
                    "reason_code": "MODE_QUEUED",
                    "reason": "Processing is still queued for this mode.",
                }
            if not available:
                return {
                    "mode": mode,
                    "status": status,
                    "reason_code": "OUTPUT_NOT_READY",
                    "reason": "Outputs are not ready for this mode.",
                }
            return {
                "mode": mode,
                "status": status,
                "reason_code": "MODE_NOT_SELECTED",
                "reason": "Mode is available but not selected as the active output layer.",
            }

        active_mode = "fast"
        reason_code = "FALLBACK_TO_FAST"
        reason = "High-order outputs are not ready yet; using fast preview."
        if "agentic" in available_modes:
            active_mode = "agentic"
            reason_code = "HIGHEST_LAYER_READY"
            reason = "Multi-agent outputs are available and selected as the highest-quality layer."
        elif "nlp" in available_modes:
            active_mode = "nlp"
            reason_code = "FALLBACK_TO_NLP"
            reason = "Multi-agent outputs are unavailable, automatically downgraded to NLP outputs."

        skipped_modes: list[dict[str, str]] = []
        for mode in KNOWLEDGE_PROCESSING_FALLBACK_CHAIN:
            if mode == active_mode:
                break
            skipped_modes.append(build_skip_reason(mode))

        return {
            "active_mode": active_mode,
            "available_modes": available_modes,
            "fallback_chain": KNOWLEDGE_PROCESSING_FALLBACK_CHAIN[:],
            "reason_code": reason_code,
            "reason": reason,
            "skipped_modes": skipped_modes,
        }

    def _build_processing_scheduler(
        self,
        processing_modes: list[dict[str, Any]],
        output_resolution: dict[str, Any],
    ) -> dict[str, Any]:
        status_by_mode = {
            str(item.get("mode") or "").strip(): str(item.get("status") or "idle").strip()
            for item in processing_modes
        }
        running_modes = [
            mode for mode in KNOWLEDGE_PROCESSING_FALLBACK_CHAIN
            if status_by_mode.get(mode) == "running"
        ]
        queued_modes = [
            mode for mode in KNOWLEDGE_PROCESSING_FALLBACK_CHAIN
            if status_by_mode.get(mode) == "queued"
        ]
        ready_modes = [
            mode for mode in KNOWLEDGE_PROCESSING_FALLBACK_CHAIN
            if status_by_mode.get(mode) == "ready"
        ]
        failed_modes = [
            mode for mode in KNOWLEDGE_PROCESSING_FALLBACK_CHAIN
            if status_by_mode.get(mode) == "failed"
        ]

        next_mode = next(
            (
                mode
                for mode in KNOWLEDGE_PROCESSING_FALLBACK_CHAIN
                if status_by_mode.get(mode) in {"queued", "idle"}
            ),
            "",
        )
        consumption_mode = str(output_resolution.get("active_mode") or "fast").strip() or "fast"

        if running_modes:
            reason = (
                f"Scheduler is actively advancing {', '.join(running_modes)} while consuming {consumption_mode} outputs."
            )
        elif queued_modes:
            reason = (
                f"Scheduler is waiting to start {queued_modes[0]} and will continue consuming {consumption_mode} outputs meanwhile."
            )
        elif failed_modes and ready_modes:
            reason = (
                f"Scheduler detected failed lanes ({', '.join(failed_modes)}) and is serving the best ready output from {consumption_mode}."
            )
        elif ready_modes:
            reason = f"Scheduler has no active work and is serving the best available output from {consumption_mode}."
        else:
            reason = "Scheduler is waiting for the fast preview lane to start."

        return {
            "strategy": "parallel",
            "mode_order": KNOWLEDGE_PROCESSING_FALLBACK_CHAIN[:],
            "running_modes": running_modes,
            "queued_modes": queued_modes,
            "ready_modes": ready_modes,
            "failed_modes": failed_modes,
            "next_mode": next_mode or None,
            "consumption_mode": consumption_mode,
            "reason": reason,
        }

    def _hydrate_processing_view(self, state: dict[str, Any]) -> dict[str, Any]:
        hydrated = dict(state)
        processing_modes = self._build_processing_modes(hydrated)
        output_resolution = self._build_output_resolution(processing_modes)
        hydrated["processing_modes"] = processing_modes
        hydrated["active_output_resolution"] = output_resolution
        hydrated["processing_scheduler"] = self._build_processing_scheduler(
            processing_modes,
            output_resolution,
        )
        hydrated["mode_outputs"] = self._build_mode_outputs(hydrated)
        return hydrated

    def check_needs_reindex(
        self,
        *,
        project_id: str,
        config: KnowledgeConfig,
        running_config: Any | None = None,
    ) -> bool:
        with self._lock:
            state = self._load_state(project_id)
            current_fingerprint = self._knowledge_manager.compute_processing_fingerprint(
                config,
                running_config,
            )
            indexed_fingerprint = str(state.get("indexed_processing_fingerprint") or "")
            return current_fingerprint != indexed_fingerprint

    @staticmethod
    def _merge_paths(
        existing: list[str] | None,
        incoming: list[str] | None,
        *,
        limit: int = 50,
    ) -> list[str]:
        merged: list[str] = []
        seen: set[str] = set()
        for raw_path in [*(existing or []), *(incoming or [])]:
            normalized = str(raw_path or "").strip().replace("\\", "/")
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            merged.append(normalized)
            if len(merged) >= limit:
                break
        return merged

    def _load_state(self, project_id: str) -> dict[str, Any]:
        if not self.state_path.exists():
            return self._hydrate_processing_view(self._default_state(project_id))
        try:
            payload = json.loads(self.state_path.read_text(encoding="utf-8"))
        except Exception:
            return self._hydrate_processing_view(self._default_state(project_id))
        if not isinstance(payload, dict):
            return self._hydrate_processing_view(self._default_state(project_id))
        state = self._default_state(project_id)
        state.update(payload)
        state["project_id"] = project_id
        state["changed_paths"] = self._merge_paths(state.get("changed_paths"), [])
        state["pending_changed_paths"] = self._merge_paths(
            state.get("pending_changed_paths"),
            [],
        )
        state["debounce_seconds"] = self._normalize_seconds(
            state.get("debounce_seconds"),
        )
        state["cooldown_seconds"] = self._normalize_seconds(
            state.get("cooldown_seconds"),
        )
        state["changed_count"] = len(state["changed_paths"])
        return self._hydrate_processing_view(state)

    def _save_state(self, state: dict[str, Any]) -> None:
        self.knowledge_root.mkdir(parents=True, exist_ok=True)
        normalized = self._hydrate_processing_view(state)
        normalized["updated_at"] = self._now_iso()
        normalized["changed_count"] = len(normalized.get("changed_paths") or [])
        self.state_path.write_text(
            json.dumps(normalized, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @staticmethod
    def _normalize_sync_patch(patch: dict[str, Any]) -> dict[str, Any]:
        stage = str(patch.get("stage") or patch.get("current_stage") or "idle").strip() or "idle"
        raw_progress = patch.get("progress", patch.get("percent", 0))
        try:
            progress = int(float(raw_progress or 0))
        except (TypeError, ValueError):
            progress = 0
        progress = max(0, min(100, progress))

        current = patch.get("current")
        total = patch.get("total")
        eta_seconds = patch.get("eta_seconds")
        if not isinstance(current, (int, float)):
            current = 0
        if not isinstance(total, (int, float)):
            total = 0
        if not isinstance(eta_seconds, (int, float)):
            eta_seconds = None

        return {
            **patch,
            "task_type": "project_sync",
            "stage": stage,
            "current_stage": stage,
            "progress": progress,
            "percent": progress,
            "current": int(current),
            "total": int(total),
            "eta_seconds": int(eta_seconds) if eta_seconds is not None else None,
        }

    def get_state(self, project_id: str) -> dict[str, Any]:
        with self._lock:
            return self._load_state(project_id)

    def _timer_key(self) -> str:
        return str(self.state_path.resolve())

    def _is_active_state(self, state: dict[str, Any]) -> bool:
        return str(state.get("status") or "").strip() in self._active_statuses

    def _is_stale_active_state(self, state: dict[str, Any]) -> bool:
        if not self._is_active_state(state):
            return False
        reference = self._parse_iso(state.get("updated_at")) or self._parse_iso(
            state.get("last_started_at"),
        )
        if reference is None:
            return False
        return (
            datetime.now(UTC) - reference
        ).total_seconds() >= DEFAULT_PROJECT_SYNC_STALE_AFTER_SECONDS

    def _recover_stale_active_state(self, state: dict[str, Any]) -> dict[str, Any]:
        if not self._is_stale_active_state(state):
            return state
        state.update(
            self._normalize_sync_patch(
                {
                    "status": "failed",
                    "stage": "failed",
                    "stage_message": "Recovered from stale project sync state",
                    "progress": 0,
                    "current": 0,
                    "total": 0,
                    "eta_seconds": None,
                }
            )
        )
        state["dirty"] = False
        state["dirty_after_run"] = False
        state["pending_changed_paths"] = []
        state["scheduled_for"] = None
        state["queued_at"] = None
        state["last_finished_at"] = self._now_iso()
        state["last_error"] = "STALE_PROJECT_SYNC_RECOVERED"
        self._cancel_timer()
        self._save_state(state)
        return state

    def _cancel_timer(self) -> None:
        with self._timers_guard:
            timer = self._timers.pop(self._timer_key(), None)
        if timer is not None:
            timer.cancel()

    def _schedule_dispatch(
        self,
        run_at: datetime,
        *,
        project_id: str,
        config: KnowledgeConfig,
        running_config: Any | None,
        source: KnowledgeSourceSpec,
        processing_mode: str = "agentic",
    ) -> None:
        delay = max((run_at - datetime.now(UTC)).total_seconds(), 0.05)

        def _callback() -> None:
            try:
                self._dispatch_scheduled_sync(
                    project_id=project_id,
                    config=config,
                    running_config=running_config,
                    source=source,
                    processing_mode=processing_mode,
                )
            except Exception:
                logger.exception(
                    "Scheduled project knowledge sync failed for project %s",
                    project_id,
                )

        timer = threading.Timer(delay, _callback)
        timer.daemon = True
        with self._timers_guard:
            previous = self._timers.get(self._timer_key())
            self._timers[self._timer_key()] = timer
        if previous is not None:
            previous.cancel()
        timer.start()

    def _start_worker(
        self,
        *,
        project_id: str,
        config: KnowledgeConfig,
        running_config: Any | None,
        source: KnowledgeSourceSpec,
        processing_mode: str = "agentic",
    ) -> None:
        worker = threading.Thread(
            target=self._run_sync_loop,
            kwargs={
                "project_id": project_id,
                "config": config,
                "running_config": running_config,
                "source": source,
                "processing_mode": processing_mode,
            },
            daemon=True,
        )
        worker.start()

    def _calculate_run_at(self, state: dict[str, Any]) -> tuple[datetime | None, str | None]:
        run_at: datetime | None = None
        stage: str | None = None
        debounce_seconds = self._normalize_seconds(state.get("debounce_seconds"))
        cooldown_seconds = self._normalize_seconds(state.get("cooldown_seconds"))

        if debounce_seconds > 0:
            last_change_at = self._parse_iso(state.get("last_change_at"))
            if last_change_at is not None:
                run_at = last_change_at + timedelta(seconds=debounce_seconds)
                stage = "debouncing"

        if cooldown_seconds > 0:
            last_finished_at = self._parse_iso(state.get("last_finished_at"))
            if last_finished_at is not None:
                cooldown_at = last_finished_at + timedelta(seconds=cooldown_seconds)
                if run_at is None or cooldown_at >= run_at:
                    run_at = cooldown_at
                    stage = "cooldown"

        if run_at is None:
            return None, None
        if run_at <= datetime.now(UTC):
            return None, None
        return run_at, stage

    def _queue_or_start_locked(
        self,
        *,
        project_id: str,
        state: dict[str, Any],
        config: KnowledgeConfig,
        running_config: Any | None,
        source: KnowledgeSourceSpec,
        trigger: str,
        force: bool,
        processing_mode: str,
    ) -> tuple[dict[str, Any], bool, str]:
        run_at, queued_stage = (None, None) if force else self._calculate_run_at(state)
        if run_at is not None:
            state["dirty"] = True
            state["status"] = "queued"
            state.update(
                self._normalize_sync_patch(
                    {
                        "stage": queued_stage or "queued",
                        "stage_message": "Waiting for debounce/cooldown window",
                        "progress": 1,
                        "current": 0,
                        "total": 2,
                    }
                )
            )
            state["last_trigger"] = trigger
            state["latest_requested_mode"] = processing_mode
            state["scheduled_for"] = run_at.isoformat()
            state["queued_at"] = state.get("queued_at") or self._now_iso()
            self._save_state(state)
            self._schedule_dispatch(
                run_at,
                project_id=project_id,
                config=config,
                running_config=running_config,
                source=source,
                processing_mode=processing_mode,
            )
            return dict(state), False, "QUEUED"

        self._cancel_timer()
        state["dirty"] = False
        state["status"] = "pending"
        state.update(
            self._normalize_sync_patch(
                {
                    "stage": "pending",
                    "stage_message": "Project sync pending",
                    "progress": 1,
                    "current": 0,
                    "total": 2,
                }
            )
        )
        state["last_trigger"] = trigger
        state["last_error"] = ""
        state["latest_source_id"] = source.id
        state["latest_requested_mode"] = processing_mode
        state["scheduled_for"] = None
        state["queued_at"] = None
        self._save_state(state)
        return dict(state), True, "STARTED"

    def _dispatch_scheduled_sync(
        self,
        *,
        project_id: str,
        config: KnowledgeConfig,
        running_config: Any | None,
        source: KnowledgeSourceSpec,
        processing_mode: str = "agentic",
    ) -> None:
        should_start = False
        with self._lock:
            with self._timers_guard:
                self._timers.pop(self._timer_key(), None)

            state = self._load_state(project_id)
            state = self._recover_stale_active_state(state)
            active = self._is_active_state(state)
            if active:
                self._save_state(state)
                return

            scheduled_for = self._parse_iso(state.get("scheduled_for"))
            if scheduled_for is not None and scheduled_for > datetime.now(UTC):
                self._schedule_dispatch(
                    scheduled_for,
                    project_id=project_id,
                    config=config,
                    running_config=running_config,
                    source=source,
                    processing_mode=processing_mode,
                )
                self._save_state(state)
                return

            if not state.get("dirty") and str(state.get("status") or "") != "queued":
                self._save_state(state)
                return

            state, should_start, _ = self._queue_or_start_locked(
                project_id=project_id,
                state=state,
                config=config,
                running_config=running_config,
                source=source,
                trigger=str(state.get("last_trigger") or "auto"),
                force=True,
                processing_mode=str(state.get("latest_requested_mode") or processing_mode or "agentic"),
            )

        if should_start:
            self._start_worker(
                project_id=project_id,
                config=config,
                running_config=running_config,
                source=source,
                processing_mode=str(state.get("latest_requested_mode") or processing_mode or "agentic"),
            )

    def mark_dirty(
        self,
        *,
        project_id: str,
        trigger: str,
        changed_paths: list[str] | None = None,
        auto_enabled: bool | None = None,
        debounce_seconds: float = 0,
        cooldown_seconds: float = 0,
    ) -> dict[str, Any]:
        with self._lock:
            state = self._load_state(project_id)
            state = self._recover_stale_active_state(state)
            if auto_enabled is not None:
                state["auto_enabled"] = bool(auto_enabled)
            state["last_trigger"] = (trigger or "manual").strip() or "manual"
            state["debounce_seconds"] = self._normalize_seconds(debounce_seconds)
            state["cooldown_seconds"] = self._normalize_seconds(cooldown_seconds)
            active = self._is_active_state(state)
            if active:
                state["dirty_after_run"] = True
                state["pending_changed_paths"] = self._merge_paths(
                    state.get("pending_changed_paths"),
                    changed_paths,
                )
            else:
                state["dirty"] = True
                state["changed_paths"] = self._merge_paths(
                    state.get("changed_paths"),
                    changed_paths,
                )
            if changed_paths:
                state["last_change_at"] = self._now_iso()
            self._save_state(state)
            return dict(state)

    def start_sync(
        self,
        *,
        project_id: str,
        config: KnowledgeConfig,
        running_config: Any | None,
        source: KnowledgeSourceSpec,
        trigger: str,
        changed_paths: list[str] | None = None,
        auto_enabled: bool = True,
        force: bool = False,
        debounce_seconds: float = 0,
        cooldown_seconds: float = 0,
        processing_mode: str = "agentic",
    ) -> dict[str, Any]:
        normalized_mode = str(processing_mode or "agentic").strip().lower() or "agentic"
        if normalized_mode not in KNOWLEDGE_PROCESSING_SUPPORTED_MODES:
            raise ValueError(f"Unsupported knowledge processing mode: {normalized_mode}")
        should_start = False
        with self._lock:
            state = self._load_state(project_id)
            state = self._recover_stale_active_state(state)
            state["auto_enabled"] = bool(auto_enabled)
            state["latest_requested_mode"] = normalized_mode
            state["debounce_seconds"] = self._normalize_seconds(debounce_seconds)
            state["cooldown_seconds"] = self._normalize_seconds(cooldown_seconds)
            active = self._is_active_state(state)
            if active:
                state["dirty_after_run"] = True
                state["last_trigger"] = (trigger or "manual").strip() or "manual"
                state["latest_requested_mode"] = normalized_mode
                state["pending_changed_paths"] = self._merge_paths(
                    state.get("pending_changed_paths"),
                    changed_paths,
                )
                if changed_paths:
                    state["last_change_at"] = self._now_iso()
                self._save_state(state)
                return {
                    "accepted": False,
                    "reason": "RUN_ALREADY_ACTIVE",
                    "state": dict(state),
                }

            if not force and changed_paths:
                state["changed_paths"] = self._merge_paths(
                    state.get("changed_paths"),
                    changed_paths,
                )
            elif force and changed_paths:
                state["changed_paths"] = self._merge_paths([], changed_paths)
            if changed_paths:
                state["last_change_at"] = self._now_iso()

            state, should_start, reason = self._queue_or_start_locked(
                project_id=project_id,
                state=state,
                config=config,
                running_config=running_config,
                source=source,
                trigger=(trigger or "manual").strip() or "manual",
                force=bool(force),
                processing_mode=normalized_mode,
            )

        if should_start:
            self._start_worker(
                project_id=project_id,
                config=config,
                running_config=running_config,
                source=source,
                processing_mode=normalized_mode,
            )
        return {
            "accepted": True,
            "reason": reason,
            "state": state,
        }

    def _run_sync_loop(
        self,
        *,
        project_id: str,
        config: KnowledgeConfig,
        running_config: Any | None,
        source: KnowledgeSourceSpec,
        processing_mode: str = "agentic",
    ) -> None:
        while True:
            try:
                from qwenpaw.app.knowledge_workflow import KnowledgeWorkflowOrchestrator

                normalized_mode = str(processing_mode or "agentic").strip().lower() or "agentic"

                self._patch_state(
                    project_id,
                    self._normalize_sync_patch({
                        "status": "pending",
                        "stage": "pending",
                        "stage_message": "Starting knowledge workflow",
                        "progress": 1,
                        "current": 0,
                        "total": 4,
                        "eta_seconds": 5,
                        "last_started_at": self._now_iso(),
                        "last_error": "",
                    }),
                )

                orchestrator = KnowledgeWorkflowOrchestrator(
                    workspace_dir=self.working_dir,
                    project_id=project_id,
                    knowledge_dirname=self.knowledge_dirname,
                )
                current_state = self.get_state(project_id)
                workflow_result = orchestrator.run(
                    config=config,
                    running_config=running_config,
                    source=source,
                    trigger=str(current_state.get("last_trigger") or "project-sync"),
                    changed_paths=list(current_state.get("changed_paths") or []),
                    processing_mode=normalized_mode,
                    status_callback=lambda patch: self._patch_state(
                        project_id,
                        self._normalize_sync_patch(patch),
                    ),
                )

                now = self._now_iso()
                self._patch_state(
                    project_id,
                    self._normalize_sync_patch({
                        "status": "succeeded",
                        "stage": "completed",
                        "stage_message": "Project sync completed",
                        "progress": 100,
                        "current": 4,
                        "total": 4,
                        "eta_seconds": 0,
                        "last_finished_at": now,
                        "last_success_at": now,
                        "indexed_processing_fingerprint": str(workflow_result.get("processing_fingerprint") or ""),
                        "last_error": "",
                        "latest_job_id": str(workflow_result.get("latest_job_id") or "").strip(),
                        "latest_workflow_run_id": str(workflow_result.get("run_id") or "").strip(),
                        "latest_requested_mode": normalized_mode,
                        "processing_mode_overrides": {},
                        "last_result": {
                            "index": workflow_result.get("index") or {},
                            "memify": workflow_result.get("memify") or {},
                            "quality_loop": workflow_result.get("quality_loop") or {},
                            "workflow_run": {
                                "run_id": workflow_result.get("run_id") or "",
                                "template_id": workflow_result.get("template_id") or "",
                                "status": workflow_result.get("run_status") or "",
                                "mode": workflow_result.get("processing_mode") or normalized_mode,
                                "artifacts": workflow_result.get("artifacts") or [],
                            },
                        },
                    }),
                )
            except Exception as exc:
                logger.exception(
                    "Project knowledge sync failed for project %s",
                    project_id,
                )
                self._patch_state(
                    project_id,
                    self._normalize_sync_patch({
                        "status": "failed",
                        "stage": "failed",
                        "stage_message": "Project sync exception",
                        "progress": 0,
                        "current": 0,
                        "total": 3,
                        "eta_seconds": None,
                        "last_finished_at": self._now_iso(),
                        "last_error": str(exc),
                        "processing_mode_overrides": {},
                    }),
                )

            should_start = False
            with self._lock:
                state = self._load_state(project_id)
                if not state.get("dirty_after_run"):
                    self._save_state(state)
                    return
                state["dirty_after_run"] = False
                state["dirty"] = True
                state["changed_paths"] = self._merge_paths(
                    state.get("changed_paths"),
                    state.get("pending_changed_paths"),
                )
                state["pending_changed_paths"] = []
                state, should_start, _ = self._queue_or_start_locked(
                    project_id=project_id,
                    state=state,
                    config=config,
                    running_config=running_config,
                    source=source,
                    trigger=str(state.get("last_trigger") or "auto"),
                    force=False,
                    processing_mode=str(state.get("latest_requested_mode") or processing_mode or "agentic"),
                )

            if should_start:
                self._start_worker(
                    project_id=project_id,
                    config=config,
                    running_config=running_config,
                    source=source,
                    processing_mode=str(state.get("latest_requested_mode") or processing_mode or "agentic"),
                )
            return

    def _patch_state(self, project_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            state = self._load_state(project_id)
            state.update(self._normalize_sync_patch(patch))
            self._save_state(state)
            return dict(state)