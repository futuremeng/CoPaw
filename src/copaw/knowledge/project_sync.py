# -*- coding: utf-8 -*-

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
from datetime import datetime, timedelta, timezone

UTC = timezone.utc
from pathlib import Path
from typing import Any, Callable, Literal

from ..config.config import KnowledgeConfig, KnowledgeSourceSpec
from .graph_ops import GraphOpsManager
from .manager import KnowledgeManager

logger = logging.getLogger(__name__)

DEFAULT_PROJECT_SYNC_DEBOUNCE_SECONDS = 3.0
DEFAULT_PROJECT_SYNC_COOLDOWN_SECONDS = 10.0
DEFAULT_PROJECT_SYNC_STALE_AFTER_SECONDS = 120.0
DEFAULT_PROJECT_SYNC_QUALITY_LOOP_ROUNDS = 3
KNOWLEDGE_PROCESSING_FALLBACK_CHAIN = ["agentic", "nlp", "fast"]
KNOWLEDGE_OUTPUT_FALLBACK_CHAIN = ["agentic", "nlp"]
KNOWLEDGE_PROCESSING_SUPPORTED_MODES = {"fast", "nlp", "agentic"}
KNOWLEDGE_PROCESSING_MODE_STATUSES = {"idle", "queued", "running", "ready", "failed", "blocked"}


class ProjectSyncCommand:
    """Typed command envelope for project-scoped sync orchestration."""

    def __init__(
        self,
        *,
        action: Literal["start_sync", "resume_sync", "check_reindex"],
        project_id: str,
        config: KnowledgeConfig,
        running_config: Any = None,
        source: KnowledgeSourceSpec | None = None,
        trigger: str = "",
        changed_paths: list[str] | None = None,
        auto_enabled: bool = True,
        force: bool = False,
        debounce_seconds: float | None = None,
        cooldown_seconds: float | None = None,
        processing_mode: str | None = None,
        quantization_stage: str | None = None,
        idempotency_key: str | None = None,
    ) -> None:
        self.action = action
        self.project_id = project_id
        self.config = config
        self.running_config = running_config
        self.source = source
        self.trigger = trigger
        self.changed_paths = list(changed_paths or [])
        self.auto_enabled = auto_enabled
        self.force = force
        self.debounce_seconds = debounce_seconds
        self.cooldown_seconds = cooldown_seconds
        self.processing_mode = (processing_mode or "").strip() or None
        self.quantization_stage = (quantization_stage or "").strip().lower() or None
        self.idempotency_key = self._normalize_idempotency_key(idempotency_key)
        self.operation_id = self._build_operation_id()

    def _normalize_idempotency_key(self, raw: str | None) -> str:
        text = str(raw or "").strip()
        if text:
            return text
        payload = {
            "action": self.action,
            "project_id": self.project_id,
            "trigger": self.trigger,
            "changed_paths": sorted(self.changed_paths),
            "force": bool(self.force),
            "processing_mode": self.processing_mode or "",
            "quantization_stage": self.quantization_stage or "",
            "source_id": str(getattr(self.source, "id", "") or ""),
        }
        encoded = json.dumps(payload, ensure_ascii=True, sort_keys=True).encode("utf-8")
        return hashlib.sha1(encoded).hexdigest()

    def _build_operation_id(self) -> str:
        seed = f"{self.action}:{self.project_id}:{self.idempotency_key}".encode("utf-8")
        return f"ps-{hashlib.sha1(seed).hexdigest()[:16]}"

    @classmethod
    def start(
        cls,
        *,
        project_id: str,
        config: KnowledgeConfig,
        running_config: Any,
        source: KnowledgeSourceSpec,
        trigger: str,
        changed_paths: list[str] | None,
        auto_enabled: bool,
        force: bool,
        debounce_seconds: float | None = None,
        cooldown_seconds: float | None = None,
        processing_mode: str | None = None,
        quantization_stage: str | None = None,
        idempotency_key: str | None = None,
    ) -> "ProjectSyncCommand":
        return cls(
            action="start_sync",
            project_id=project_id,
            config=config,
            running_config=running_config,
            source=source,
            trigger=trigger,
            changed_paths=changed_paths,
            auto_enabled=auto_enabled,
            force=force,
            debounce_seconds=debounce_seconds,
            cooldown_seconds=cooldown_seconds,
            processing_mode=processing_mode,
            quantization_stage=quantization_stage,
            idempotency_key=idempotency_key,
        )

        logger.debug("ProjectSyncCommand created with operation_id: %s", cls._build_operation_id())
        logger.debug("Debounce seconds: %s, Cooldown seconds: %s", debounce_seconds, cooldown_seconds)
        logger.debug("Processing mode: %s, Auto enabled: %s", processing_mode, auto_enabled)
        logger.debug("Changed paths: %s", changed_paths)
        logger.debug("Force sync: %s", force)

    @classmethod
    def resume(
        cls,
        *,
        project_id: str,
        config: KnowledgeConfig,
        running_config: Any,
        source: KnowledgeSourceSpec,
        idempotency_key: str | None = None,
    ) -> "ProjectSyncCommand":
        return cls(
            action="resume_sync",
            project_id=project_id,
            config=config,
            running_config=running_config,
            source=source,
            idempotency_key=idempotency_key,
        )

    @classmethod
    def check_reindex(
        cls,
        *,
        project_id: str,
        config: KnowledgeConfig,
        running_config: Any,
        idempotency_key: str | None = None,
    ) -> "ProjectSyncCommand":
        return cls(
            action="check_reindex",
            project_id=project_id,
            config=config,
            running_config=running_config,
            idempotency_key=idempotency_key,
        )


class ProjectSyncEvent:
    """Execution event returned by the coordinator dispatch boundary."""

    def __init__(
        self,
        *,
        action: str,
        project_id: str,
        payload: Any,
        accepted: bool,
        reason: str,
        operation_id: str,
        idempotency_key: str,
        deduplicated: bool = False,
    ) -> None:
        self.action = action
        self.project_id = project_id
        self.payload = payload
        self.accepted = accepted
        self.reason = reason
        self.operation_id = operation_id
        self.idempotency_key = idempotency_key
        self.deduplicated = deduplicated


class ProjectSyncCoordinator:
    """Phase-1 orchestration shell delegating to existing sync manager behavior."""

    def __init__(
        self,
        working_dir: Path | str,
        *,
        manager_factory: Callable[[str], "ProjectKnowledgeSyncManager"] | None = None,
    ) -> None:
        self.working_dir = Path(working_dir)
        self._manager_factory = manager_factory
        self._sync_managers: dict[str, ProjectKnowledgeSyncManager] = {}

    def _build_manager(self, project_id: str) -> "ProjectKnowledgeSyncManager":
        if self._manager_factory is not None:
            return self._manager_factory(project_id)
        return ProjectKnowledgeSyncManager(
            self.working_dir,
            knowledge_dirname=f"projects/{project_id}/.knowledge",
        )

    def _manager(self, project_id: str) -> "ProjectKnowledgeSyncManager":
        manager = self._sync_managers.get(project_id)
        if manager is not None:
            return manager
        manager = self._build_manager(project_id)
        self._sync_managers[project_id] = manager
        return manager

    def dispatch(self, command: ProjectSyncCommand) -> ProjectSyncEvent:
        manager = self._manager(command.project_id)
        if command.action == "check_reindex":
            payload = manager.check_needs_reindex(
                project_id=command.project_id,
                config=command.config,
                running_config=command.running_config,
            )
            return ProjectSyncEvent(
                action=command.action,
                project_id=command.project_id,
                payload=payload,
                accepted=bool(payload),
                reason="REINDEX_REQUIRED" if bool(payload) else "NOOP",
                operation_id=command.operation_id,
                idempotency_key=command.idempotency_key,
                deduplicated=not bool(payload),
            )

        if command.action == "resume_sync":
            if command.source is None:
                raise ValueError("ProjectSyncCommand.resume_sync requires source")
            payload = manager.resume_sync_if_needed(
                project_id=command.project_id,
                config=command.config,
                running_config=command.running_config,
                source=command.source,
            )
            payload = dict(payload or {})
            payload.setdefault("operation_id", command.operation_id)
            payload.setdefault("idempotency_key", command.idempotency_key)
            payload.setdefault("deduplicated", not bool(payload.get("accepted")))
            return ProjectSyncEvent(
                action=command.action,
                project_id=command.project_id,
                payload=payload,
                accepted=bool((payload or {}).get("accepted")),
                reason=str((payload or {}).get("reason") or ""),
                operation_id=command.operation_id,
                idempotency_key=command.idempotency_key,
                deduplicated=bool(payload.get("deduplicated")),
            )

        if command.action == "start_sync":
            if command.source is None:
                raise ValueError("ProjectSyncCommand.start_sync requires source")
            payload = manager.start_sync(
                project_id=command.project_id,
                config=command.config,
                running_config=command.running_config,
                source=command.source,
                trigger=command.trigger,
                changed_paths=command.changed_paths,
                auto_enabled=command.auto_enabled,
                force=bool(getattr(command, "force", False)),
                debounce_seconds=float(command.debounce_seconds or 0),
                cooldown_seconds=float(command.cooldown_seconds or 0),
                processing_mode=str(command.processing_mode or "agentic"),
                quantization_stage=getattr(command, "quantization_stage", None),
            )
            payload = dict(payload or {})
            payload.setdefault("operation_id", command.operation_id)
            payload.setdefault("idempotency_key", command.idempotency_key)
            payload.setdefault("deduplicated", False)
            return ProjectSyncEvent(
                action=command.action,
                project_id=command.project_id,
                payload=payload,
                accepted=bool((payload or {}).get("accepted")),
                reason=str((payload or {}).get("reason") or ""),
                operation_id=command.operation_id,
                idempotency_key=command.idempotency_key,
                deduplicated=bool(payload.get("deduplicated")),
            )

        raise ValueError(f"Unsupported project sync command: {command.action}")


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
    _resumable_statuses = {"queued", "pending", "indexing", "graphifying", "running"}

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
            "output_resolution": {
                "active_mode": "agentic",
                "available_modes": [],
                "fallback_chain": KNOWLEDGE_OUTPUT_FALLBACK_CHAIN[:],
                "reason_code": "HIGH_ORDER_PENDING",
                "reason": "High-order outputs are not ready yet; keeping the L2/L3 output view warm.",
                "skipped_modes": [],
            },
            "output_scheduler": {
                "strategy": "parallel",
                "mode_order": KNOWLEDGE_PROCESSING_FALLBACK_CHAIN[:],
                "running_modes": [],
                "queued_modes": [],
                "ready_modes": [],
                "failed_modes": [],
                "next_mode": "agentic",
                "consumption_mode": "agentic",
                "reason": "Scheduler is waiting for the high-order output lanes to start.",
            },
            "mode_outputs": {},
            "mode_metrics": {},
            "global_metrics": {},
            "l1_metrics": {},
            "l2_metrics": {},
            "l3_metrics": {},
            "lanes": {
                "retrieval": {
                    "lane": "retrieval",
                    "mode": "fast",
                    "status": "idle",
                    "summary": "Retrieval lane idle.",
                },
                "quantization": {
                    "lane": "quantization",
                    "mode": "nlp",
                    "status": "idle",
                    "summary": "Quantization lane idle.",
                },
            },
            "quantization_stages": {
                "l1": {
                    "stage": "l1",
                    "status": "idle",
                    "summary": "L1 quick scale statistics pending.",
                },
                "l2": {
                    "stage": "l2",
                    "status": "idle",
                    "summary": "L2 NLP extraction statistics pending.",
                },
                "l3": {
                    "stage": "l3",
                    "status": "idle",
                    "summary": "L3 multi-agent quality statistics pending.",
                },
            },
            "semantic_engine": {
                "engine": "hanlp2",
                "status": "idle",
                "reason_code": "SOURCE_NOT_READY",
                "reason": "Project source has not been prepared for semantic extraction yet.",
                "summary": "Semantic engine waiting for project source registration.",
                "updated_at": None,
            },
        }

    @staticmethod
    def _build_semantic_engine_summary(payload: dict[str, Any]) -> str:
        status = str(payload.get("status") or "").strip().lower()
        reason_code = str(payload.get("reason_code") or "").strip().upper()
        if reason_code == "SOURCE_NOT_READY":
            return "Semantic engine waiting for project source registration."
        if reason_code == "HANLP2_SIDECAR_UNCONFIGURED":
            return "Semantic engine unavailable: HanLP sidecar is not configured."
        if reason_code == "HANLP2_SIDECAR_PYTHON_MISSING":
            return "Semantic engine unavailable: HanLP sidecar Python executable was not found."
        if reason_code == "HANLP2_SIDECAR_PYTHON_INCOMPATIBLE":
            return "Semantic engine unavailable: HanLP sidecar must use Python 3.6-3.10."
        if reason_code == "HANLP2_SIDECAR_EXEC_FAILED":
            return "Semantic engine unavailable: HanLP sidecar health check failed."
        if reason_code == "HANLP2_IMPORT_UNAVAILABLE":
            return "Semantic engine unavailable: HanLP2 module is not installed."
        if reason_code == "HANLP2_ENTRYPOINT_MISSING":
            return "Semantic engine unavailable: HanLP2 tokenizer entry point is missing."
        if reason_code == "HANLP2_TOKENIZE_FAILED":
            return "Semantic engine error: HanLP2 tokenization failed."
        if reason_code == "SEMANTIC_STATE_INVALID":
            return "Semantic engine error: invalid runtime state payload."
        if status == "ready":
            return "Semantic engine ready."
        if status == "error":
            return "Semantic engine error."
        if status == "unavailable":
            return "Semantic engine unavailable."
        return "Semantic engine status pending."

    @staticmethod
    def _merge_stage_message_with_semantic_summary(
        stage_message: str | None,
        semantic_summary: str | None,
    ) -> str:
        primary = str(stage_message or "").strip()
        summary = str(semantic_summary or "").strip()
        if not primary:
            return summary
        if not summary:
            return primary
        if summary in primary:
            return primary
        return f"{primary} · {summary}"

    def _build_semantic_engine_state(
        self,
        state: dict[str, Any],
        *,
        config: KnowledgeConfig | None = None,
        use_persisted: bool = True,
    ) -> dict[str, Any]:
        updated_at = str(state.get("updated_at") or "").strip() or None
        latest_source_id = str(state.get("latest_source_id") or "").strip()
        if not latest_source_id:
            payload = {
                "engine": "hanlp2",
                "status": "idle",
                "reason_code": "SOURCE_NOT_READY",
                "reason": "Project source has not been prepared for semantic extraction yet.",
                "updated_at": updated_at,
            }
            payload["summary"] = self._build_semantic_engine_summary(payload)
            return payload

        persisted = state.get("semantic_engine")
        if use_persisted and isinstance(persisted, dict) and persisted:
            payload = {
                "engine": str(persisted.get("engine") or "hanlp2"),
                "status": str(persisted.get("status") or "idle"),
                "reason_code": str(persisted.get("reason_code") or "SEMANTIC_STATE_UNKNOWN"),
                "reason": str(persisted.get("reason") or "Semantic engine state is unavailable."),
                "updated_at": str(persisted.get("updated_at") or updated_at or "").strip() or None,
            }
            payload["summary"] = self._build_semantic_engine_summary(payload)
            return payload

        semantic_state = self._knowledge_manager.get_semantic_engine_state(config)
        if not isinstance(semantic_state, dict):
            payload = {
                "engine": "hanlp2",
                "status": "error",
                "reason_code": "SEMANTIC_STATE_INVALID",
                "reason": "Semantic engine state returned an invalid payload.",
                "updated_at": updated_at,
            }
            payload["summary"] = self._build_semantic_engine_summary(payload)
            return payload
        payload = {
            "engine": str(semantic_state.get("engine") or "hanlp2"),
            "status": str(semantic_state.get("status") or "idle"),
            "reason_code": str(semantic_state.get("reason_code") or "SEMANTIC_STATE_UNKNOWN"),
            "reason": str(semantic_state.get("reason") or "Semantic engine state is unavailable."),
            "updated_at": updated_at,
        }
        payload["summary"] = self._build_semantic_engine_summary(payload)
        return payload

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

    def _resolve_document_graph_artifacts(
        self,
        memify_result: dict[str, Any],
    ) -> tuple[str, str, int]:
        manifest_path = str(memify_result.get("document_graph_manifest_path") or "").strip()
        document_graph_dir = str(memify_result.get("document_graph_dir") or "").strip()
        document_graph_count = _safe_int(memify_result.get("document_graph_count"))

        graph_path_text = str(memify_result.get("graph_path") or "").strip()
        graph_path = Path(graph_path_text) if graph_path_text else self._graph_ops.local_graph_path
        graphify_dir = graph_path.parent.parent / "graphify"
        inferred_manifest_path = graphify_dir / "manifest.json"

        if not document_graph_dir and graphify_dir.exists():
            document_graph_dir = str(graphify_dir)
        if not manifest_path and inferred_manifest_path.exists():
            manifest_path = str(inferred_manifest_path)

        if document_graph_count > 0:
            return manifest_path, document_graph_dir, document_graph_count

        manifest_candidate = Path(manifest_path) if manifest_path else inferred_manifest_path
        if not manifest_candidate.exists():
            return manifest_path, document_graph_dir, document_graph_count

        try:
            manifest_payload = json.loads(manifest_candidate.read_text(encoding="utf-8"))
        except Exception:
            return manifest_path, document_graph_dir, document_graph_count

        if not isinstance(manifest_payload, dict):
            return manifest_path, document_graph_dir, document_graph_count

        derived_count = max(
            _safe_int(manifest_payload.get("document_count")),
            len(manifest_payload.get("documents") or [])
            if isinstance(manifest_payload.get("documents"), list)
            else 0,
        )
        return manifest_path, document_graph_dir, derived_count

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
        (
            document_graph_manifest_path,
            document_graph_dir_path,
            document_graph_count,
        ) = self._resolve_document_graph_artifacts(memify_result)
        l2_entity_count = _safe_int(index_result.get("ner_entity_count"))
        l2_relation_count = _safe_int(index_result.get("syntax_relation_count"))

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
            (
                "document_graph_manifest",
                "Document graphify manifest",
                document_graph_manifest_path,
            ),
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

        document_graph_dir = self._relative_workspace_path(document_graph_dir_path)
        if document_graph_dir:
            nlp_artifacts.append(
                {
                    "kind": "document_graph_dir",
                    "label": "Document graphify payloads",
                    "path": document_graph_dir,
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
                    f"Document graphify payloads: {document_graph_count}",
                    f"Entities (NER): {l2_entity_count}",
                    f"Relations (Syntax): {l2_relation_count}",
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

    @staticmethod
    def _build_mode_metrics(
        processing_modes: list[dict[str, Any]],
        mode_outputs: dict[str, Any],
        index_result: dict[str, Any],
    ) -> dict[str, Any]:
        metrics: dict[str, Any] = {}
        for item in processing_modes:
            mode = str(item.get("mode") or "").strip()
            if not mode:
                continue
            output = mode_outputs.get(mode)
            artifacts = output.get("artifacts") if isinstance(output, dict) else []
            quality_score = _safe_float(item.get("quality_score"))
            metrics[mode] = {
                "mode": mode,
                "document_count": _safe_int(item.get("document_count")),
                "chunk_count": _safe_int(item.get("chunk_count")),
                "entity_count": _safe_int(item.get("entity_count")),
                "relation_count": _safe_int(item.get("relation_count")),
                "artifact_count": len(artifacts) if isinstance(artifacts, list) else 0,
                "quality_score": quality_score,
            }
            if mode == "nlp":
                metrics[mode]["entity_count"] = _safe_int(index_result.get("ner_entity_count"))
                metrics[mode]["relation_count"] = _safe_int(index_result.get("syntax_relation_count"))
                metrics[mode].update(
                    {
                        "cor_ready_chunk_count": _safe_int(index_result.get("cor_ready_chunk_count")),
                        "cor_cluster_count": _safe_int(index_result.get("cor_cluster_count")),
                        "cor_replacement_count": _safe_int(index_result.get("cor_replacement_count")),
                        "cor_effective_chunk_count": _safe_int(index_result.get("cor_effective_chunk_count")),
                        "cor_ready_chunk_ratio": _safe_float(index_result.get("cor_ready_chunk_ratio")),
                        "cor_effective_chunk_ratio": _safe_float(index_result.get("cor_effective_chunk_ratio")),
                        "cor_reason_code": str(index_result.get("cor_reason_code") or "").strip(),
                        "cor_reason": str(index_result.get("cor_reason") or "").strip(),
                        "ner_ready_chunk_count": _safe_int(index_result.get("ner_ready_chunk_count")),
                        "ner_entity_count": _safe_int(index_result.get("ner_entity_count")),
                        "syntax_ready_chunk_count": _safe_int(index_result.get("syntax_ready_chunk_count")),
                        "syntax_sentence_count": _safe_int(index_result.get("syntax_sentence_count")),
                        "syntax_token_count": _safe_int(index_result.get("syntax_token_count")),
                        "syntax_relation_count": _safe_int(index_result.get("syntax_relation_count")),
                    }
                )
            if mode == "agentic":
                metrics[mode]["entity_count"] = 0
                metrics[mode]["relation_count"] = 0
                metrics[mode]["quality_score"] = None
        return metrics

    def _build_l1_metrics(
        self,
        state: dict[str, Any],
        source_status: dict[str, Any] | None,
    ) -> dict[str, Any]:
        if not isinstance(source_status, dict):
            source_status = {}
        latest_source_id = str(state.get("latest_source_id") or "").strip()
        metrics_updated_at = str(
            source_status.get("stats_updated_at")
            or source_status.get("indexed_at")
            or source_status.get("raw_last_ingested_at")
            or state.get("updated_at")
            or ""
        ).strip()
        raw_document_count = _safe_int(source_status.get("raw_document_count"))
        indexed_document_count = _safe_int(source_status.get("document_count"))
        return {
            "source_id": latest_source_id or None,
            "metrics_source": "project_sync_l1_raw",
            "metrics_updated_at": metrics_updated_at or None,
            "raw_document_count": raw_document_count,
            "indexed_document_count": indexed_document_count,
            "chunk_count": _safe_int(source_status.get("chunk_count")),
            "sentence_count": _safe_int(source_status.get("sentence_count")),
            "char_count": _safe_int(source_status.get("char_count")),
            "token_count": _safe_int(source_status.get("token_count")),
            "raw_total_bytes": _safe_int(source_status.get("raw_total_bytes")),
            "raw_last_ingested_at": str(source_status.get("raw_last_ingested_at") or "").strip() or None,
            "source_stats_updated_at": str(source_status.get("stats_updated_at") or "").strip() or None,
        }

    def _build_l2_metrics(
        self,
        state: dict[str, Any],
        index_result: dict[str, Any],
    ) -> dict[str, Any]:
        live_l2 = state.get("l2_metrics") if isinstance(state.get("l2_metrics"), dict) else {}
        l2_progress = state.get("l2_progress") if isinstance(state.get("l2_progress"), dict) else {}
        index_result = index_result or {}
        total_chunks = max(
            _safe_int(l2_progress.get("total_chunks")),
            _safe_int(index_result.get("chunk_count")),
        )
        return {
            "metrics_source": "project_sync_l2_nlp",
            "metrics_updated_at": str(state.get("updated_at") or state.get("last_finished_at") or "").strip() or None,
            "total_chunks": total_chunks,
            "cor_done_chunks": max(_safe_int(l2_progress.get("cor_done_chunks")), _safe_int(index_result.get("cor_ready_chunk_count"))),
            "ner_done_chunks": max(_safe_int(l2_progress.get("ner_done_chunks")), _safe_int(index_result.get("ner_ready_chunk_count"))),
            "syntax_done_chunks": max(_safe_int(l2_progress.get("syntax_done_chunks")), _safe_int(index_result.get("syntax_ready_chunk_count"))),
            "cor_ready_chunk_count": max(_safe_int(live_l2.get("cor_ready_chunk_count")), _safe_int(index_result.get("cor_ready_chunk_count"))),
            "cor_cluster_count": max(_safe_int(live_l2.get("cor_cluster_count")), _safe_int(index_result.get("cor_cluster_count"))),
            "cor_replacement_count": max(_safe_int(live_l2.get("cor_replacement_count")), _safe_int(index_result.get("cor_replacement_count"))),
            "cor_effective_chunk_count": max(_safe_int(live_l2.get("cor_effective_chunk_count")), _safe_int(index_result.get("cor_effective_chunk_count"))),
            "ner_ready_chunk_count": max(_safe_int(live_l2.get("ner_ready_chunk_count")), _safe_int(index_result.get("ner_ready_chunk_count"))),
            "ner_entity_count": max(_safe_int(live_l2.get("ner_entity_count")), _safe_int(index_result.get("ner_entity_count"))),
            "syntax_ready_chunk_count": max(_safe_int(live_l2.get("syntax_ready_chunk_count")), _safe_int(index_result.get("syntax_ready_chunk_count"))),
            "syntax_sentence_count": max(_safe_int(live_l2.get("syntax_sentence_count")), _safe_int(index_result.get("syntax_sentence_count"))),
            "syntax_token_count": max(_safe_int(live_l2.get("syntax_token_count")), _safe_int(index_result.get("syntax_token_count"))),
            "syntax_relation_count": max(_safe_int(live_l2.get("syntax_relation_count")), _safe_int(index_result.get("syntax_relation_count"))),
            "entity_count": max(_safe_int(live_l2.get("ner_entity_count")), _safe_int(index_result.get("ner_entity_count"))),
            "relation_count": max(_safe_int(live_l2.get("syntax_relation_count")), _safe_int(index_result.get("syntax_relation_count"))),
        }

    def _build_l3_metrics(self, state: dict[str, Any]) -> dict[str, Any]:
        return {
            "metrics_source": "project_sync_l3_placeholder",
            "metrics_updated_at": str(state.get("updated_at") or state.get("last_finished_at") or "").strip() or None,
            "status": "empty",
            "reason_code": "L3_NOT_READY",
            "reason": "L3 agentic metrics are intentionally empty until independent outputs are ready.",
            "entity_count": 0,
            "relation_count": 0,
            "quality_score": None,
        }

    def _resolve_index_result(self, state: dict[str, Any]) -> dict[str, Any]:
        """Resolve the best-available index result for UI hydration.

        Prefer current run `last_result.index`; if missing, fall back to persisted
        source index payload so NLP stage metrics stay visible while fast indexing
        is running in parallel.
        """
        last_result = state.get("last_result") or {}
        index_result = last_result.get("index") if isinstance(last_result, dict) else {}
        if not isinstance(index_result, dict):
            index_result = {}

        source_id = str(state.get("latest_source_id") or "").strip()
        fallback_payload: dict[str, Any] = {}
        if source_id:
            try:
                payload = self._knowledge_manager._load_index_payload_safe(source_id)
            except Exception:
                payload = None
            fallback_payload = payload if isinstance(payload, dict) else {}

        if not index_result:
            return fallback_payload

        # Merge stage metrics from persisted index payload if the current run
        # snapshot is missing (or still zeroed during indexing).
        merged = dict(index_result)
        nlp_metric_keys = (
            "cor_ready_chunk_count",
            "cor_cluster_count",
            "cor_replacement_count",
            "cor_effective_chunk_count",
            "ner_ready_chunk_count",
            "ner_entity_count",
            "syntax_ready_chunk_count",
            "syntax_sentence_count",
            "syntax_token_count",
            "syntax_relation_count",
        )
        for key in nlp_metric_keys:
            current_value = _safe_int(merged.get(key))
            fallback_value = _safe_int(fallback_payload.get(key))
            if fallback_value > current_value:
                merged[key] = fallback_value

        if not str(merged.get("cor_reason_code") or "").strip() and str(
            fallback_payload.get("cor_reason_code") or ""
        ).strip():
            merged["cor_reason_code"] = str(fallback_payload.get("cor_reason_code") or "").strip()
        if not str(merged.get("cor_reason") or "").strip() and str(
            fallback_payload.get("cor_reason") or ""
        ).strip():
            merged["cor_reason"] = str(fallback_payload.get("cor_reason") or "").strip()

        if _safe_float(merged.get("cor_ready_chunk_ratio")) is None and _safe_float(
            fallback_payload.get("cor_ready_chunk_ratio")
        ) is not None:
            merged["cor_ready_chunk_ratio"] = _safe_float(fallback_payload.get("cor_ready_chunk_ratio"))
        if _safe_float(merged.get("cor_effective_chunk_ratio")) is None and _safe_float(
            fallback_payload.get("cor_effective_chunk_ratio")
        ) is not None:
            merged["cor_effective_chunk_ratio"] = _safe_float(
                fallback_payload.get("cor_effective_chunk_ratio")
            )

        live_l2_metrics = state.get("l2_metrics")
        if isinstance(live_l2_metrics, dict):
            for key in (
                "cor_ready_chunk_count",
                "cor_cluster_count",
                "cor_replacement_count",
                "cor_effective_chunk_count",
                "ner_ready_chunk_count",
                "ner_entity_count",
                "syntax_ready_chunk_count",
                "syntax_sentence_count",
                "syntax_token_count",
                "syntax_relation_count",
            ):
                live_value = _safe_int(live_l2_metrics.get(key))
                current_value = _safe_int(merged.get(key))
                if live_value > current_value:
                    merged[key] = live_value

        return merged

    def _build_global_metrics(
        self,
        state: dict[str, Any],
        mode_metrics: dict[str, Any],
        source_status: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        last_result = state.get("last_result") or {}
        if not isinstance(last_result, dict):
            last_result = {}
        index_result = last_result.get("index") or {}
        memify_result = last_result.get("memify") or {}
        if not isinstance(index_result, dict):
            index_result = {}
        if not isinstance(memify_result, dict):
            memify_result = {}

        latest_source_id = str(state.get("latest_source_id") or "").strip()
        if not isinstance(source_status, dict):
            source_status = {}
        if latest_source_id and not source_status:
            try:
                source_status = self._knowledge_manager.get_source_status(
                    latest_source_id,
                    lightweight=True,
                )
            except Exception:
                source_status = {}

        source_stats_updated_at = str(
            source_status.get("stats_updated_at")
            or source_status.get("indexed_at")
            or source_status.get("raw_last_ingested_at")
            or "",
        ).strip()

        metrics_updated_at = ""
        candidate_timestamps = [
            state.get("updated_at"),
            state.get("last_finished_at"),
            index_result.get("indexed_at"),
            source_stats_updated_at,
        ]
        latest_dt = None
        for candidate in candidate_timestamps:
            parsed = self._parse_iso(candidate)
            if parsed is None:
                continue
            if latest_dt is None or parsed > latest_dt:
                latest_dt = parsed
        if latest_dt is not None:
            metrics_updated_at = latest_dt.isoformat()

        l1_metrics = self._build_l1_metrics(state, source_status)

        document_count = _safe_int(l1_metrics.get("raw_document_count"))
        chunk_count = _safe_int(l1_metrics.get("chunk_count"))
        sentence_count = _safe_int(l1_metrics.get("sentence_count"))
        char_count = _safe_int(l1_metrics.get("char_count"))
        token_count = _safe_int(l1_metrics.get("token_count"))

        return {
            "document_count": document_count,
            "chunk_count": chunk_count,
            "sentence_count": sentence_count,
            "char_count": char_count,
            "token_count": token_count,
            "metrics_source": "project_sync_l1_raw",
            "metrics_updated_at": metrics_updated_at or None,
            "source_id": latest_source_id or None,
            "source_stats_updated_at": source_stats_updated_at or None,
        }

    def _build_processing_modes(self, state: dict[str, Any]) -> list[dict[str, Any]]:
        last_result = state.get("last_result") or {}
        if not isinstance(last_result, dict):
            last_result = {}
        index_result = self._resolve_index_result(state)
        memify_result = last_result.get("memify") or {}
        quality_loop_result = last_result.get("quality_loop") or {}
        workflow_run = last_result.get("workflow_run") or {}
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
        entity_count = _safe_int(index_result.get("ner_entity_count"))
        relation_count = _safe_int(index_result.get("syntax_relation_count"))
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

        agentic_snapshot: dict[str, Any] = {}
        rounds = quality_loop_result.get("rounds")
        if isinstance(rounds, list) and rounds:
            latest_round = rounds[-1]
            if isinstance(latest_round, dict):
                after_snapshot = latest_round.get("after")
                if isinstance(after_snapshot, dict):
                    agentic_snapshot = after_snapshot
        if not agentic_snapshot:
            snapshot = quality_loop_result.get("snapshot")
            if isinstance(snapshot, dict):
                agentic_snapshot = snapshot

        agentic_entity_count = 0
        agentic_relation_count = 0
        agentic_quality_score = None

        semantic_state = state.get("semantic_engine")
        if not isinstance(semantic_state, dict):
            semantic_state = self._build_semantic_engine_state(state)
        semantic_status = str(semantic_state.get("status") or "idle").strip().lower()
        semantic_ready = semantic_status == "ready"
        semantic_summary = str(
            semantic_state.get("summary")
            or semantic_state.get("reason")
            or "Semantic engine unavailable."
        ).strip()

        fast_available = document_count > 0 or chunk_count > 0
        ner_stage_ready = any(
            _safe_int(index_result.get(metric_key)) > 0
            for metric_key in (
                "ner_ready_chunk_count",
                "ner_entity_count",
            )
        )
        syntax_stage_ready = any(
            _safe_int(index_result.get(metric_key)) > 0
            for metric_key in (
                "syntax_ready_chunk_count",
                "syntax_sentence_count",
                "syntax_token_count",
                "syntax_relation_count",
            )
        )
        cor_stage_ready = any(
            _safe_int(index_result.get(metric_key)) > 0
            for metric_key in (
                "cor_ready_chunk_count",
                "cor_cluster_count",
                "cor_replacement_count",
                "cor_effective_chunk_count",
            )
        )
        required_stage_ready = ner_stage_ready and syntax_stage_ready
        nlp_available = required_stage_ready
        agentic_available = False

        fast_running = sync_status in {"pending", "indexing"} or sync_stage in {"pending", "indexing"}
        nlp_running = semantic_ready and (sync_status == "graphifying" or sync_stage == "graphifying" or sync_stage.startswith("graphify"))
        agentic_running = workflow_status in {"running", "pending"} or (
            semantic_ready and sync_status in {"pending", "indexing", "graphifying"} and bool(workflow_run_id)
        )
        agentic_queued = semantic_ready and workflow_status == "queued"
        semantic_blocked = fast_available and not semantic_ready and not nlp_available

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
            else "blocked"
            if semantic_blocked
            else "queued"
            if fast_available
            else "idle"
        )
        agentic_status = (
            "failed"
            if workflow_status in {"failed", "blocked", "cancelled"} or (sync_status == "failed" and not agentic_available)
            else "ready"
            if agentic_available
            else "blocked"
            if semantic_blocked and not agentic_available
            else "queued"
            if agentic_queued
            else "running"
            if agentic_running
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
                    else semantic_summary
                    if nlp_status == "blocked"
                    else "NLP required stages ready (NER + Syntax); COR remains optional"
                    if nlp_available
                    else "Waiting for graph extraction"
                ),
                "summary": (
                    semantic_summary
                    if nlp_status == "blocked"
                    else
                    "Structured graph artifacts are available. Required stages (NER + Syntax) are complete; COR is a best-effort optional stage."
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
                    else semantic_summary
                    if agentic_status == "blocked"
                    else "Multi-agent outputs ready"
                    if agentic_available
                    else "Workflow run exists but outputs are incomplete"
                    if workflow_run_id
                    else "Waiting for multi-agent workflow scheduling"
                ),
                "summary": (
                    semantic_summary
                    if agentic_status == "blocked"
                    else
                    "Multi-agent knowledge outputs are ready and preferred for consumption."
                    if agentic_available
                    else "High-quality long-running processing continues in the background."
                ),
                "last_updated_at": str(workflow_run.get("updated_at") or latest_updated_at or "").strip(),
                "run_id": workflow_run_id,
                "job_id": str(state.get("latest_job_id") or "").strip(),
                "document_count": document_count,
                "chunk_count": chunk_count,
                "entity_count": agentic_entity_count,
                "relation_count": agentic_relation_count,
                "quality_score": agentic_quality_score,
            },
        ]

        overrides = state.get("processing_mode_overrides") or {}
        if isinstance(overrides, dict):
            for item in modes:
                mode_key = str(item.get("mode") or "").strip()
                override = overrides.get(mode_key)
                if not isinstance(override, dict):
                    continue
                if override.get("status") in KNOWLEDGE_PROCESSING_MODE_STATUSES:
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
            if bool(item.get("available")) and str(item.get("mode") or "").strip() in KNOWLEDGE_OUTPUT_FALLBACK_CHAIN
        ]

        def build_skip_reason(mode: str) -> dict[str, str]:
            status = status_by_mode.get(mode, "idle")
            available = available_by_mode.get(mode, False)
            if status == "blocked":
                return {
                    "mode": mode,
                    "status": status,
                    "reason_code": "MODE_BLOCKED",
                    "reason": "Processing is blocked by an unmet prerequisite.",
                }
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

        active_mode = "agentic"
        reason_code = "HIGH_ORDER_PENDING"
        reason = "High-order outputs are not ready yet; keeping the L2/L3 output view warm."
        if status_by_mode.get("nlp") == "blocked" and status_by_mode.get("agentic") == "blocked":
            reason_code = "SEMANTIC_ENGINE_UNAVAILABLE"
            reason = "Semantic engine is unavailable, so structured L2/L3 outputs are blocked."
        elif "agentic" in available_modes:
            active_mode = "agentic"
            reason_code = "HIGHEST_LAYER_READY"
            reason = "Multi-agent outputs are available and selected as the highest-quality layer."
        elif "nlp" in available_modes:
            active_mode = "nlp"
            reason_code = "FALLBACK_TO_NLP"
            reason = "Multi-agent outputs are unavailable, automatically downgraded to NLP outputs."

        skipped_modes: list[dict[str, str]] = []
        for mode in KNOWLEDGE_OUTPUT_FALLBACK_CHAIN:
            if mode == active_mode:
                break
            skipped_modes.append(build_skip_reason(mode))

        return {
            "active_mode": active_mode,
            "available_modes": available_modes,
            "fallback_chain": KNOWLEDGE_OUTPUT_FALLBACK_CHAIN[:],
            "reason_code": reason_code,
            "reason": reason,
            "skipped_modes": skipped_modes,
        }

    def _build_output_scheduler(
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
        consumption_mode = str(output_resolution.get("active_mode") or "agentic").strip() or "agentic"

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
            reason = "Scheduler is waiting for the high-order output lanes to start."

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

    @staticmethod
    def _lane_status_from_mode_status(mode_status: str) -> str:
        status = str(mode_status or "").strip().lower()
        if status in {"running", "queued", "pending", "indexing", "graphifying"}:
            return "active"
        if status == "ready":
            return "ready"
        if status in {"failed", "blocked"}:
            return status
        return "idle"

    def _build_lane_state(
        self,
        processing_modes: list[dict[str, Any]],
    ) -> dict[str, Any]:
        mode_map = {
            str(item.get("mode") or "").strip(): item
            for item in processing_modes
            if isinstance(item, dict)
        }
        fast_item = mode_map.get("fast") or {}
        nlp_item = mode_map.get("nlp") or {}
        return {
            "retrieval": {
                "lane": "retrieval",
                "mode": "fast",
                "status": self._lane_status_from_mode_status(str(fast_item.get("status") or "idle")),
                "summary": str(fast_item.get("summary") or "Retrieval lane status pending.").strip(),
            },
            "quantization": {
                "lane": "quantization",
                "mode": "nlp",
                "status": self._lane_status_from_mode_status(str(nlp_item.get("status") or "idle")),
                "summary": str(nlp_item.get("summary") or "Quantization lane status pending.").strip(),
            },
        }

    @staticmethod
    def _stage_status_from_metric(value: Any) -> str:
        if _safe_int(value) > 0:
            return "ready"
        return "idle"

    def _build_quantization_stage_state(
        self,
        l1_metrics: dict[str, Any],
        l2_metrics: dict[str, Any],
        l3_metrics: dict[str, Any],
    ) -> dict[str, Any]:
        l1_status = self._stage_status_from_metric(l1_metrics.get("chunk_count"))
        l2_status = self._stage_status_from_metric(
            max(
                _safe_int(l2_metrics.get("entity_count")),
                _safe_int(l2_metrics.get("relation_count")),
            )
        )
        l3_reason_code = str(l3_metrics.get("reason_code") or "").strip().upper()
        l3_status = "idle" if l3_reason_code == "L3_NOT_READY" else "ready"
        return {
            "l1": {
                "stage": "l1",
                "status": l1_status,
                "summary": "L1 quick scale statistics ready." if l1_status == "ready" else "L1 quick scale statistics pending.",
            },
            "l2": {
                "stage": "l2",
                "status": l2_status,
                "summary": "L2 NLP extraction statistics ready." if l2_status == "ready" else "L2 NLP extraction statistics pending.",
            },
            "l3": {
                "stage": "l3",
                "status": l3_status,
                "summary": "L3 multi-agent quality statistics ready." if l3_status == "ready" else "L3 multi-agent quality statistics pending.",
            },
        }

    def _hydrate_processing_view(self, state: dict[str, Any]) -> dict[str, Any]:
        hydrated = dict(state)
        hydrated["semantic_engine"] = self._build_semantic_engine_state(hydrated)
        index_result = self._resolve_index_result(hydrated)
        latest_source_id = str(hydrated.get("latest_source_id") or "").strip()
        source_status: dict[str, Any] = {}
        if latest_source_id:
            try:
                source_status = self._knowledge_manager.get_source_status(
                    latest_source_id,
                    lightweight=True,
                )
            except Exception:
                source_status = {}
        processing_modes = self._build_processing_modes(hydrated)
        output_resolution = self._build_output_resolution(processing_modes)
        mode_outputs = self._build_mode_outputs(hydrated)
        mode_metrics = self._build_mode_metrics(processing_modes, mode_outputs, index_result)
        l1_metrics = self._build_l1_metrics(hydrated, source_status)
        l2_metrics = self._build_l2_metrics(hydrated, index_result)
        l3_metrics = self._build_l3_metrics(hydrated)
        output_scheduler = self._build_output_scheduler(
            processing_modes,
            output_resolution,
        )
        hydrated["processing_modes"] = processing_modes
        hydrated["output_resolution"] = output_resolution
        hydrated["output_scheduler"] = output_scheduler
        hydrated["mode_outputs"] = mode_outputs
        hydrated["mode_metrics"] = mode_metrics
        hydrated["l1_metrics"] = l1_metrics
        hydrated["l2_metrics"] = l2_metrics
        hydrated["l3_metrics"] = l3_metrics
        hydrated["lanes"] = self._build_lane_state(processing_modes)
        hydrated["quantization_stages"] = self._build_quantization_stage_state(
            l1_metrics,
            l2_metrics,
            l3_metrics,
        )
        hydrated["global_metrics"] = self._build_global_metrics(hydrated, mode_metrics, source_status)
        hydrated["stage_message"] = self._merge_stage_message_with_semantic_summary(
            str(hydrated.get("stage_message") or "").strip(),
            str((hydrated.get("semantic_engine") or {}).get("summary") or "").strip(),
        )
        return hydrated

    def check_needs_reindex(
        self,
        *,
        project_id: str,
        config: KnowledgeConfig,
        running_config: Any | None = None,
    ) -> bool:
        with self._lock:
            state = self._load_state(project_id, hydrate=False)
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

    def _load_state(self, project_id: str, *, hydrate: bool = True) -> dict[str, Any]:
        if not self.state_path.exists():
            state = self._default_state(project_id)
            return self._hydrate_processing_view(state) if hydrate else state
        try:
            payload = json.loads(self.state_path.read_text(encoding="utf-8"))
        except Exception:
            state = self._default_state(project_id)
            return self._hydrate_processing_view(state) if hydrate else state
        if not isinstance(payload, dict):
            state = self._default_state(project_id)
            return self._hydrate_processing_view(state) if hydrate else state
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
        return self._hydrate_processing_view(state) if hydrate else state

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
        quantization_stage: str | None = None,
    ) -> None:
        worker = threading.Thread(
            target=self._run_sync_loop,
            kwargs={
                "project_id": project_id,
                "config": config,
                "running_config": running_config,
                "source": source,
                "processing_mode": processing_mode,
                "quantization_stage": quantization_stage,
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
                state["dirty_after_run"] = True
                state["last_trigger"] = str(state.get("last_trigger") or "auto").strip() or "auto"
                state["latest_requested_mode"] = processing_mode
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

            state, should_start, reason = self._queue_or_start_locked(
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
                processing_mode=processing_mode,
                quantization_stage=state.get("quantization_stage"),
            )
        return

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
            return self._hydrate_processing_view(state)

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
        quantization_stage: str | None = None,  # 新增参数
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
            if quantization_stage:
                state["quantization_stage"] = str(quantization_stage).strip().lower()
            else:
                state.pop("quantization_stage", None)
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
                    "state": self._hydrate_processing_view(state),
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
                quantization_stage=state.get("quantization_stage"),
            )
        return {
            "accepted": True,
            "reason": reason,
            "state": self._hydrate_processing_view(state),
        }

    def resume_sync_if_needed(
        self,
        *,
        project_id: str,
        config: KnowledgeConfig,
        running_config: Any | None,
        source: KnowledgeSourceSpec,
    ) -> dict[str, Any]:
        should_start = False
        normalized_mode = "agentic"
        with self._lock:
            state = self._load_state(project_id)
            status = str(state.get("status") or "").strip().lower()
            has_resumable_work = (
                status in self._resumable_statuses
                or bool(state.get("dirty"))
                or bool(state.get("dirty_after_run"))
            )
            if not has_resumable_work:
                return {
                    "accepted": False,
                    "reason": "NO_RESUMABLE_SYNC",
                    "state": self._hydrate_processing_view(state),
                }

            normalized_mode = str(state.get("latest_requested_mode") or "agentic").strip().lower() or "agentic"
            if normalized_mode not in KNOWLEDGE_PROCESSING_SUPPORTED_MODES:
                normalized_mode = "agentic"

            scheduled_for = self._parse_iso(state.get("scheduled_for"))
            if status == "queued" and scheduled_for is not None and scheduled_for > datetime.now(UTC):
                self._schedule_dispatch(
                    scheduled_for,
                    project_id=project_id,
                    config=config,
                    running_config=running_config,
                    source=source,
                    processing_mode=normalized_mode,
                )
                self._save_state(state)
                return {
                    "accepted": True,
                    "reason": "RESCHEDULED",
                    "state": self._hydrate_processing_view(state),
                }

            if state.get("dirty_after_run"):
                state["dirty"] = True
                state["changed_paths"] = self._merge_paths(
                    state.get("changed_paths"),
                    state.get("pending_changed_paths"),
                )
                state["pending_changed_paths"] = []
                state["dirty_after_run"] = False

            previous_stage = str(state.get("stage") or state.get("current_stage") or "pending").strip().lower()
            state["auto_enabled"] = True
            state["latest_source_id"] = source.id
            state["latest_requested_mode"] = normalized_mode
            state["last_trigger"] = "resume"
            state["last_error"] = ""
            state["scheduled_for"] = None
            state["queued_at"] = None
            state.update(
                self._normalize_sync_patch(
                    {
                        "status": "pending",
                        "stage": "pending",
                        "stage_message": f"Resuming knowledge workflow from {previous_stage or 'pending'}",
                        "progress": max(1, _safe_int(state.get("progress") or 0)),
                        "current": _safe_int(state.get("current") or 0),
                        "total": max(_safe_int(state.get("total") or 0), 4),
                        "eta_seconds": state.get("eta_seconds"),
                        "last_started_at": self._now_iso(),
                    }
                )
            )
            self._save_state(state)
            should_start = True

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
            "reason": "RESUMED",
            "state": self.get_state(project_id),
        }

    def _run_sync_loop(
        self,
        *,
        project_id: str,
        config: KnowledgeConfig,
        running_config: Any | None,
        source: KnowledgeSourceSpec,
        processing_mode: str = "agentic",
        quantization_stage: str | None = None,  # 新增参数
    ) -> None:
        while True:
            try:
                from qwenpaw.app.knowledge_workflow import KnowledgeWorkflowOrchestrator

                normalized_mode = str(processing_mode or "agentic").strip().lower() or "agentic"
                current_state = self.get_state(project_id)
                quant_stage = quantization_stage or current_state.get("quantization_stage")
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
                        "semantic_engine": self._build_semantic_engine_state(
                            self._load_state(project_id),
                            config=config,
                            use_persisted=False,
                        ),
                    }),
                )

                orchestrator = KnowledgeWorkflowOrchestrator(
                    workspace_dir=self.working_dir,
                    project_id=project_id,
                    knowledge_dirname=self.knowledge_dirname,
                )
                workflow_result = orchestrator.run(
                    config=config,
                    running_config=running_config,
                    source=source,
                    trigger=str(current_state.get("last_trigger") or "project-sync"),
                    changed_paths=list(current_state.get("changed_paths") or []),
                    processing_mode=normalized_mode,
                    quantization_stage=quant_stage,  # 传递参数
                    status_callback=status_callback_wrapper,
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
                        "l2_progress": {
                            "total_chunks": _safe_int((workflow_result.get("index") or {}).get("chunk_count")),
                            "cor_done_chunks": _safe_int((workflow_result.get("index") or {}).get("cor_ready_chunk_count")),
                            "ner_done_chunks": _safe_int((workflow_result.get("index") or {}).get("ner_ready_chunk_count")),
                            "syntax_done_chunks": _safe_int((workflow_result.get("index") or {}).get("syntax_ready_chunk_count")),
                        },
                        "l2_metrics": {
                            "cor_ready_chunk_count": _safe_int((workflow_result.get("index") or {}).get("cor_ready_chunk_count")),
                            "cor_cluster_count": _safe_int((workflow_result.get("index") or {}).get("cor_cluster_count")),
                            "cor_replacement_count": _safe_int((workflow_result.get("index") or {}).get("cor_replacement_count")),
                            "cor_effective_chunk_count": _safe_int((workflow_result.get("index") or {}).get("cor_effective_chunk_count")),
                            "ner_ready_chunk_count": _safe_int((workflow_result.get("index") or {}).get("ner_ready_chunk_count")),
                            "ner_entity_count": _safe_int((workflow_result.get("index") or {}).get("ner_entity_count")),
                            "syntax_ready_chunk_count": _safe_int((workflow_result.get("index") or {}).get("syntax_ready_chunk_count")),
                            "syntax_sentence_count": _safe_int((workflow_result.get("index") or {}).get("syntax_sentence_count")),
                            "syntax_token_count": _safe_int((workflow_result.get("index") or {}).get("syntax_token_count")),
                            "syntax_relation_count": _safe_int((workflow_result.get("index") or {}).get("syntax_relation_count")),
                        },
                        "semantic_engine": self._build_semantic_engine_state(
                            self._load_state(project_id),
                            config=config,
                            use_persisted=False,
                        ),
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
                        "l2_progress": {},
                        "l2_metrics": {},
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

    def _patch_state(self, project_id: str, state_patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            state = self._load_state(project_id)
            state.update(self._normalize_sync_patch(state_patch))
            self._save_state(state)
            return self._hydrate_processing_view(state)


def status_callback_wrapper(patch: dict[str, Any]) -> None:
    project_id = patch.get("project_id")
    if project_id:
        manager = ProjectSyncCoordinator(
            working_dir=Path("workspace"),
            manager_factory=None,
        )
        manager._patch_state(project_id, patch)