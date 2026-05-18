# -*- coding: utf-8 -*-

from __future__ import annotations

import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from ..config import load_config
from ..config.config import KnowledgeConfig, KnowledgeSourceSpec, load_agent_config


def _effective_knowledge_config(knowledge_config: KnowledgeConfig, running_config: Any) -> KnowledgeConfig:
	effective = knowledge_config.model_copy(deep=True)
	effective.enabled = bool(getattr(running_config, "knowledge_enabled", effective.enabled))
	effective.automation.knowledge_auto_collect_chat_files = bool(
		getattr(running_config, "knowledge_auto_collect_chat_files", effective.automation.knowledge_auto_collect_chat_files)
	)
	effective.automation.knowledge_auto_collect_chat_urls = bool(
		getattr(running_config, "knowledge_auto_collect_chat_urls", effective.automation.knowledge_auto_collect_chat_urls)
	)
	effective.automation.knowledge_auto_collect_long_text = bool(
		getattr(running_config, "knowledge_auto_collect_long_text", effective.automation.knowledge_auto_collect_long_text)
	)
	effective.automation.knowledge_long_text_min_chars = int(
		getattr(running_config, "knowledge_long_text_min_chars", effective.automation.knowledge_long_text_min_chars)
	)
	effective.index.chunk_size = int(getattr(running_config, "knowledge_chunk_size", effective.index.chunk_size))
	return effective


def _resolve_scheduled_sync_config(manager: Any) -> tuple[KnowledgeConfig, Any]:
	root_config = load_config()
	running_config = root_config.agents.running
	workspace_dir = Path(manager.working_dir).resolve()
	for agent_id, profile in (root_config.agents.profiles or {}).items():
		profile_workspace = Path(str(getattr(profile, "workspace_dir", "") or "")).expanduser()
		try:
			if profile_workspace.resolve() != workspace_dir:
				continue
		except Exception:
			continue
		try:
			running_config = load_agent_config(agent_id).running
		except Exception:
			running_config = root_config.agents.running
		break
	return _effective_knowledge_config(root_config.knowledge, running_config), running_config


def schedule_dispatch(manager: Any, run_at: datetime, *, project_id: str) -> None:
	key = str(manager.state_path.resolve())
	with manager._timers_guard:
		existing = manager._timers.pop(key, None)
		if existing is not None:
			existing.cancel()
		delay = max(0.0, (run_at - datetime.now(manager.UTC)).total_seconds())
		timer = threading.Timer(delay, manager._dispatch_scheduled_sync, kwargs={"project_id": project_id})
		timer.daemon = True
		manager._timers[key] = timer
		timer.start()


def dispatch_scheduled_sync(manager: Any, *, project_id: str) -> None:
	from .project_sync_manager import build_project_source_spec

	state = manager._load_state(project_id, hydrate=False)
	project_dir = manager.working_dir / "projects" / project_id
	config, running_config = _resolve_scheduled_sync_config(manager)
	source = build_project_source_spec(
		project_id=project_id,
		project_name=project_id,
		project_workspace_dir=str(project_dir),
	)
	manager._start_worker(
		project_id=project_id,
		config=config,
		running_config=running_config,
		source=source,
		processing_mode=str(state.get("latest_requested_mode") or "agentic"),
		quantization_stage=str(state.get("quantization_stage") or "").strip() or None,
	)


def queue_or_start_locked(
	manager: Any,
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
	now = datetime.now(manager.UTC)
	last_finished = manager._parse_iso(state.get("last_finished_at"))
	debounce_seconds = manager._normalize_seconds(state.get("debounce_seconds"))
	cooldown_seconds = manager._normalize_seconds(state.get("cooldown_seconds"))
	scheduled_for: datetime | None = None
	stage = "pending"
	reason = "STARTED"
	if not force and debounce_seconds > 0:
		scheduled_for = now + timedelta(seconds=debounce_seconds)
		stage = "debouncing"
		reason = "QUEUED"
	elif not force and cooldown_seconds > 0 and last_finished is not None and (now - last_finished).total_seconds() < cooldown_seconds:
		scheduled_for = last_finished + timedelta(seconds=cooldown_seconds)
		stage = "cooldown"
		reason = "QUEUED"

	state.update({
		"status": "queued" if scheduled_for is not None else "pending",
		"current_stage": stage,
		"stage": stage,
		"progress": 0,
		"last_started_at": now.isoformat() if scheduled_for is None else state.get("last_started_at"),
		"last_error": "",
		"updated_at": now.isoformat(),
		"latest_source_id": source.id,
		"last_trigger": trigger,
		"latest_requested_mode": processing_mode,
		"quantization_stage": quantization_stage,
		"semantic_engine": manager._capture_semantic_engine_state(config),
		"scheduled_for": scheduled_for.isoformat() if scheduled_for is not None else None,
		"stage_message": manager._merge_stage_message_with_semantic_summary(
			"Project sync queued" if scheduled_for is not None else "Project sync pending",
			manager._build_semantic_engine_state(state),
		),
		"changed_files": _build_changed_files_list(
			list(state.get("changed_paths") or []),
			trigger,
			"queued" if scheduled_for is not None else "pending",
			now.isoformat(),
		),
	})
	manager._save_state(state)
	if scheduled_for is not None:
		manager._schedule_dispatch(scheduled_for, project_id=project_id)
	else:
		manager._start_worker(
			project_id=project_id,
			config=config,
			running_config=running_config,
			source=source,
			processing_mode=processing_mode,
			quantization_stage=quantization_stage,
		)
	return {"accepted": True, "reason": reason, "state": manager._load_state(project_id)}


def _build_changed_files_list(
	merged_paths: list[str],
	trigger: str,
	status: str,
	now: str,
) -> list[dict[str, Any]]:
	"""Build file-level metadata from merged paths list."""
	# Determine trigger mode from trigger value
	trigger_mode = "automatic" if any(t in str(trigger or "") for t in ["watcher", "resume"]) else "manual"
	
	# Map sync status to processing status
	status_mapping = {
		"idle": "idle",
		"queued": "queued",
		"pending": "pending",
		"indexing": "indexing",
		"graphifying": "graphifying",
		"succeeded": "succeeded",
		"failed": "failed",
	}
	processing_status = status_mapping.get(str(status or "idle"), "idle")
	
	return [
		{
			"path": path,
			"trigger_mode": trigger_mode,
			"processing_status": processing_status,
			"detected_at": now,
			"scope": "original",  # Default scope; can be refined based on path patterns later
		}
		for path in merged_paths
	]


def start_sync(
	manager: Any,
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
	with manager._lock:
		state = manager._load_state(project_id, hydrate=False)
		now = manager._now_iso()
		merged_paths = list(dict.fromkeys([*list(state.get("changed_paths") or []), *list(changed_paths or [])]))
		changed_files = _build_changed_files_list(merged_paths, trigger, "pending", now)
		state.update({
			"project_id": project_id,
			"auto_enabled": auto_enabled,
			"changed_paths": merged_paths,
			"changed_count": len(merged_paths),
			"changed_files": changed_files,
			"dirty": bool(merged_paths),
			"last_change_at": now,
			"debounce_seconds": manager._normalize_seconds(debounce_seconds),
			"cooldown_seconds": manager._normalize_seconds(cooldown_seconds),
			"latest_source_id": source.id,
		})
		updated_at = manager._parse_iso(state.get("updated_at"))
		stale_active = str(state.get("status") or "") in manager._active_statuses and updated_at is not None and (datetime.now(manager.UTC) - updated_at).total_seconds() >= manager.DEFAULT_PROJECT_SYNC_STALE_AFTER_SECONDS
		if str(state.get("status") or "") in manager._active_statuses and not force and not stale_active:
			pending = list(dict.fromkeys([*list(state.get("pending_changed_paths") or []), *list(changed_paths or [])]))
			state.update({
				"dirty_after_run": True,
				"pending_changed_paths": pending,
				"updated_at": now,
			})
			manager._save_state(state)
			return {"accepted": True, "reason": "QUEUED", "state": manager._load_state(project_id)}
		return manager._queue_or_start_locked(
			state,
			project_id=project_id,
			config=config,
			running_config=running_config,
			source=source,
			trigger=trigger,
			processing_mode=processing_mode,
			quantization_stage=quantization_stage,
			force=bool(force or stale_active),
		)


__all__ = ["dispatch_scheduled_sync", "queue_or_start_locked", "schedule_dispatch", "start_sync"]