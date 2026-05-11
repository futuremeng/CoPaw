# -*- coding: utf-8 -*-

from __future__ import annotations

import hashlib
import importlib
import json
import logging
import re
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Literal

from ..config.config import KnowledgeConfig, KnowledgeSourceSpec
from .graph_ops import GraphOpsManager
from .knowledge_quantization_metrics import (
	build_l1_metrics,
	build_l2_metrics,
	build_l3_metrics,
	build_nlp_progress,
	resolve_nlp_stage_status,
)
from . import project_sync_dispatch as sync_dispatch
from . import project_sync_execution as sync_execution
from . import project_sync_projection as sync_projection
from . import project_sync_runtime_state as sync_runtime_state

logger = logging.getLogger(__name__)
UTC = timezone.utc

DEFAULT_PROJECT_SYNC_DEBOUNCE_SECONDS = 3.0
DEFAULT_PROJECT_SYNC_COOLDOWN_SECONDS = 10.0
DEFAULT_PROJECT_SYNC_STALE_AFTER_SECONDS = 120.0
DEFAULT_PROJECT_SYNC_QUALITY_LOOP_ROUNDS = 3
KNOWLEDGE_PROCESSING_FALLBACK_CHAIN = ["agentic", "nlp", "fast"]
KNOWLEDGE_OUTPUT_FALLBACK_CHAIN = ["agentic", "nlp"]
KNOWLEDGE_PROCESSING_SUPPORTED_MODES = {"fast", "nlp", "agentic"}
KNOWLEDGE_PROCESSING_MODE_STATUSES = {"idle", "queued", "running", "ready", "failed", "blocked"}


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


def _as_dict(value: Any) -> dict[str, Any]:
	return value if isinstance(value, dict) else {}


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
		if current.model_dump(mode="json") != expected.model_dump(mode="json"):
			config.sources[existing_index] = expected
			changed = True
	if changed and persist is not None:
		persist()
	return expected, changed


class ProjectSyncCommand:
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
	def start(cls, **kwargs) -> "ProjectSyncCommand":
		return cls(action="start_sync", **kwargs)

	@classmethod
	def resume(cls, **kwargs) -> "ProjectSyncCommand":
		return cls(action="resume_sync", **kwargs)

	@classmethod
	def check_reindex(cls, **kwargs) -> "ProjectSyncCommand":
		return cls(action="check_reindex", **kwargs)


@dataclass
class ProjectSyncEvent:
	action: str
	project_id: str
	payload: Any
	accepted: bool
	reason: str
	operation_id: str
	idempotency_key: str
	deduplicated: bool = False


class ProjectSyncCoordinator:
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
		if manager is None:
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
				reason="REINDEX_REQUIRED" if payload else "NOOP",
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
				accepted=bool(payload.get("accepted")),
				reason=str(payload.get("reason") or ""),
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
				force=bool(command.force),
				debounce_seconds=float(command.debounce_seconds or 0),
				cooldown_seconds=float(command.cooldown_seconds or 0),
				processing_mode=str(command.processing_mode or "agentic"),
				quantization_stage=command.quantization_stage,
			)
			payload = dict(payload or {})
			payload.setdefault("operation_id", command.operation_id)
			payload.setdefault("idempotency_key", command.idempotency_key)
			payload.setdefault("deduplicated", False)
			return ProjectSyncEvent(
				action=command.action,
				project_id=command.project_id,
				payload=payload,
				accepted=bool(payload.get("accepted")),
				reason=str(payload.get("reason") or ""),
				operation_id=command.operation_id,
				idempotency_key=command.idempotency_key,
				deduplicated=bool(payload.get("deduplicated")),
			)
		raise ValueError(f"Unsupported project sync command: {command.action}")


class ProjectKnowledgeSyncManager:
	_locks_guard = threading.Lock()
	_locks: dict[str, Any] = {}
	_timers_guard = threading.Lock()
	_timers: dict[str, threading.Timer] = {}
	_active_statuses = {"pending", "indexing", "graphifying", "running"}
	_resumable_statuses = {"queued", "pending", "indexing", "graphifying", "running"}
	UTC = UTC
	DEFAULT_PROJECT_SYNC_STALE_AFTER_SECONDS = DEFAULT_PROJECT_SYNC_STALE_AFTER_SECONDS

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
		knowledge_manager_cls = getattr(importlib.import_module("copaw.knowledge.manager"), "KnowledgeManager")
		self._knowledge_manager = knowledge_manager_cls(
			self.working_dir,
			knowledge_dirname=knowledge_dirname,
		)
		self._graph_ops = GraphOpsManager(
			self.working_dir,
			knowledge_dirname=knowledge_dirname,
		)

	@classmethod
	def _get_lock(cls, key: str):
		with cls._locks_guard:
			lock = cls._locks.get(key)
			if lock is None:
				lock = threading.RLock()
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
			"output_resolution": {},
			"output_scheduler": {},
			"mode_outputs": {},
			"mode_metrics": {},
			"global_metrics": {},
			"l1_metrics": {},
			"l2_metrics": {},
			"nlp_progress": {},
			"l3_metrics": {},
			"lanes": {},
			"quantization_stages": {},
			"semantic_engine": {
				"engine": "hanlp2",
				"status": "idle",
				"reason_code": "SOURCE_NOT_READY",
				"reason": "Project source has not been prepared for semantic extraction yet.",
				"summary": "Semantic engine waiting for project source preparation.",
				"updated_at": None,
			},
		}

	def _build_semantic_engine_summary(self, engine_state: dict[str, Any]) -> str:
		return sync_projection.build_semantic_engine_summary(self, engine_state)

	def _merge_stage_message_with_semantic_summary(
		self,
		stage_message: str,
		semantic_engine: dict[str, Any],
		*,
		include_reason_code: bool = False,
	) -> str:
		return sync_projection.merge_stage_message_with_semantic_summary(
			self,
			stage_message,
			semantic_engine,
			include_reason_code=include_reason_code,
		)

	def _build_semantic_engine_state(self, state: dict[str, Any]) -> dict[str, Any]:
		return sync_projection.build_semantic_engine_state(self, state)

	def _relative_workspace_path(self, value: Any) -> str:
		return sync_projection.relative_workspace_path(self, value)

	def _resolve_document_graph_artifacts(self, memify_result: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
		return sync_projection.resolve_document_graph_artifacts(self, memify_result)

	def _collect_source_document_sample_paths(self, source_id: str) -> list[str]:
		return sync_projection.collect_source_document_sample_paths(self, source_id)

	def _build_mode_outputs(
		self,
		state: dict[str, Any],
		processing_modes: list[dict[str, Any]],
	) -> dict[str, Any]:
		return sync_projection.build_mode_outputs(self, state, processing_modes)

	def _build_global_metrics(
		self,
		state: dict[str, Any],
		*,
		mode_metrics: dict[str, Any],
		source_status: dict[str, Any] | None,
	) -> dict[str, Any]:
		return sync_projection.build_global_metrics(self, state, mode_metrics=mode_metrics, source_status=source_status)

	def _build_processing_modes(
		self,
		state: dict[str, Any],
		index_result: dict[str, Any],
		semantic_engine: dict[str, Any],
		l2_metrics: dict[str, Any],
	) -> list[dict[str, Any]]:
		return sync_projection.build_processing_modes(self, state, index_result, semantic_engine, l2_metrics)

	def _build_output_resolution(
		self,
		processing_modes: list[dict[str, Any]],
		semantic_engine: dict[str, Any],
	) -> dict[str, Any]:
		return sync_projection.build_output_resolution(processing_modes, semantic_engine)

	def _build_output_scheduler(self, processing_modes: list[dict[str, Any]]) -> dict[str, Any]:
		return sync_projection.build_output_scheduler(processing_modes)

	def _build_mode_metrics(
		self,
		state: dict[str, Any],
		processing_modes: list[dict[str, Any]],
		mode_outputs: dict[str, Any],
		l1_metrics: dict[str, Any],
		l2_metrics: dict[str, Any],
		l3_metrics: dict[str, Any],
	) -> dict[str, Any]:
		return sync_projection.build_mode_metrics(self, state, processing_modes, mode_outputs, l1_metrics, l2_metrics, l3_metrics)

	def _build_pipeline_trace(
		self,
		state: dict[str, Any],
		processing_modes: list[dict[str, Any]],
		mode_outputs: dict[str, Any],
		l1_metrics: dict[str, Any],
		l2_metrics: dict[str, Any],
		l3_metrics: dict[str, Any],
	) -> dict[str, Any]:
		return sync_projection.build_pipeline_trace(state, processing_modes, mode_outputs, l1_metrics, l2_metrics, l3_metrics)

	def _resolve_index_result(self, state: dict[str, Any]) -> dict[str, Any]:
		return sync_projection.resolve_index_result(state)

	def _hydrate_processing_view(self, state: dict[str, Any]) -> dict[str, Any]:
		return sync_projection.hydrate_processing_view(self, state)

	def _build_nlp_progress(self, processing_modes: list[dict[str, Any]], l2_metrics: dict[str, Any]) -> dict[str, Any]:
		return sync_projection.build_nlp_progress_view(self, processing_modes, l2_metrics)

	def _load_state(self, project_id: str, *, hydrate: bool = True) -> dict[str, Any]:
		return sync_runtime_state.load_state(self, project_id, hydrate=hydrate)

	def _save_state(self, state: dict[str, Any]) -> None:
		sync_runtime_state.save_state(self, state)

	def get_state(self, project_id: str) -> dict[str, Any]:
		return sync_runtime_state.get_state(self, project_id)

	def _schedule_dispatch(self, run_at: datetime, *, project_id: str) -> None:
		sync_dispatch.schedule_dispatch(self, run_at, project_id=project_id)

	def _dispatch_scheduled_sync(self, *, project_id: str) -> None:
		sync_dispatch.dispatch_scheduled_sync(self, project_id=project_id)

	def _start_worker(self, **kwargs) -> None:
		sync_execution.start_worker(self, **kwargs)

	def _queue_or_start_locked(
		self,
		state: dict[str, Any],
		*,
		project_id: str,
		config: KnowledgeConfig,
		running_config: Any,
		source: KnowledgeSourceSpec,
		trigger: str,
		processing_mode: str,
		quantization_stage: str | None,
		force: bool,
	) -> dict[str, Any]:
		return sync_dispatch.queue_or_start_locked(
			self,
			state,
			project_id=project_id,
			config=config,
			running_config=running_config,
			source=source,
			trigger=trigger,
			processing_mode=processing_mode,
			quantization_stage=quantization_stage,
			force=force,
		)

	def start_sync(
		self,
		*,
		project_id: str,
		config: KnowledgeConfig,
		running_config: Any,
		source: KnowledgeSourceSpec,
		trigger: str,
		changed_paths: list[str] | None = None,
		auto_enabled: bool = True,
		force: bool = False,
		debounce_seconds: float | None = None,
		cooldown_seconds: float | None = None,
		processing_mode: str = "agentic",
		quantization_stage: str | None = None,
	) -> dict[str, Any]:
		return sync_dispatch.start_sync(
			self,
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
		)

	def resume_sync_if_needed(
		self,
		*,
		project_id: str,
		config: KnowledgeConfig,
		running_config: Any,
		source: KnowledgeSourceSpec,
	) -> dict[str, Any]:
		return sync_execution.resume_sync_if_needed(
			self,
			project_id=project_id,
			config=config,
			running_config=running_config,
			source=source,
		)

	def check_needs_reindex(
		self,
		*,
		project_id: str,
		config: KnowledgeConfig,
		running_config: Any,
	) -> bool:
		return sync_execution.check_needs_reindex(
			self,
			project_id=project_id,
			config=config,
			running_config=running_config,
		)

	def _run_sync_loop(
		self,
		*,
		project_id: str,
		config: KnowledgeConfig,
		running_config: Any,
		source: KnowledgeSourceSpec,
		processing_mode: str = "agentic",
		quantization_stage: str | None = None,
	) -> None:
		sync_execution.run_sync_loop(
			self,
			project_id=project_id,
			config=config,
			running_config=running_config,
			source=source,
			processing_mode=processing_mode,
			quantization_stage=quantization_stage,
		)
