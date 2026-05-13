# -*- coding: utf-8 -*-

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from ..config.config import KnowledgeConfig, KnowledgeSourceSpec


def start_worker(manager: Any, **kwargs) -> None:
	manager._run_sync_loop(**kwargs)


def resume_sync_if_needed(
	manager: Any,
	*,
	project_id: str,
	config: KnowledgeConfig,
	running_config: Any,
	source: KnowledgeSourceSpec,
) -> dict[str, Any]:
	with manager._lock:
		state = manager._load_state(project_id, hydrate=False)
		status = str(state.get("status") or "").strip()
		if status not in manager._resumable_statuses and not bool(state.get("dirty_after_run")):
			return {"accepted": False, "reason": "NOOP", "deduplicated": True}
		changed_paths = list(dict.fromkeys([*list(state.get("changed_paths") or []), *list(state.get("pending_changed_paths") or [])]))
		state.update({
			"status": "pending",
			"current_stage": "pending",
			"stage": "pending",
			"last_trigger": "resume",
			"dirty_after_run": False,
			"pending_changed_paths": [],
			"changed_paths": changed_paths,
			"changed_count": len(changed_paths),
			"latest_source_id": source.id,
			"semantic_engine": manager._capture_semantic_engine_state(config),
			"updated_at": manager._now_iso(),
		})
		manager._save_state(state)
		processing_mode = str(state.get("latest_requested_mode") or "agentic")
		manager._start_worker(
			project_id=project_id,
			config=config,
			running_config=running_config,
			source=source,
			processing_mode=processing_mode,
		)
		return {"accepted": True, "reason": "RESUMED", "state": manager._load_state(project_id)}


def check_needs_reindex(
	manager: Any,
	*,
	project_id: str,
	config: KnowledgeConfig,
	running_config: Any,
) -> bool:
	state = manager._load_state(project_id, hydrate=False)
	recorded = str(state.get("indexed_processing_fingerprint") or "").strip()
	if not recorded:
		return True
	compute = getattr(manager._knowledge_manager, "compute_processing_fingerprint", None)
	if not callable(compute):
		return False
	return str(compute(config, running_config) or "").strip() != recorded


def run_sync_loop(
	manager: Any,
	*,
	project_id: str,
	config: KnowledgeConfig,
	running_config: Any,
	source: KnowledgeSourceSpec,
	processing_mode: str = "agentic",
	quantization_stage: str | None = None,
) -> None:
	with manager._lock:
		state = manager._load_state(project_id, hydrate=False)
		preserved_l2_metrics = dict(state.get("l2_metrics") or {}) if isinstance(state.get("l2_metrics"), dict) else {}
		preserved_l2_progress = dict(state.get("l2_progress") or {}) if isinstance(state.get("l2_progress"), dict) else {}
		state.update({
			"status": "pending",
			"current_stage": "pending",
			"stage": "pending",
			"last_error": "",
			"latest_source_id": source.id,
			"latest_requested_mode": processing_mode,
			"semantic_engine": manager._capture_semantic_engine_state(config),
			"updated_at": manager._now_iso(),
		})
		manager._save_state(state)
	try:
		from qwenpaw.app.knowledge_workflow import KnowledgeWorkflowOrchestrator

		orchestrator = KnowledgeWorkflowOrchestrator(
			workspace_dir=manager.working_dir,
			project_id=project_id,
			knowledge_dirname=manager.knowledge_dirname,
		)
		result = orchestrator.run(
			config=config,
			running_config=running_config,
			source=source,
			trigger="project-sync",
			changed_paths=list(state.get("changed_paths") or []),
			processing_mode=processing_mode,
			quantization_stage=quantization_stage,
		)
		normalized_result = dict(result or {})
		workflow_run = normalized_result.get("workflow_run")
		if not isinstance(workflow_run, dict):
			workflow_run = {
				"run_id": str(normalized_result.get("run_id") or ""),
				"status": str(
					normalized_result.get("run_status")
					or normalized_result.get("status")
					or ""
				).strip().lower(),
				"mode": str(
					normalized_result.get("processing_mode")
					or processing_mode
					or "agentic"
				).strip().lower() or "agentic",
				"template_id": str(normalized_result.get("template_id") or ""),
				"processing_fingerprint": str(normalized_result.get("processing_fingerprint") or ""),
				"artifacts": list(normalized_result.get("artifacts") or []),
			}
			normalized_result["workflow_run"] = workflow_run
		with manager._lock:
			state = manager._load_state(project_id, hydrate=False)
			fingerprint = str(normalized_result.get("processing_fingerprint") or "").strip()
			if not fingerprint:
				compute = getattr(manager._knowledge_manager, "compute_processing_fingerprint", None)
				if callable(compute):
					fingerprint = str(compute(config, running_config) or "").strip()
			now = manager._now_iso()
			state.update({
				"status": "succeeded",
				"current_stage": "completed",
				"stage": "completed",
				"stage_message": "Project sync completed",
				"updated_at": now,
				"last_finished_at": now,
				"last_success_at": now,
				"latest_workflow_run_id": str(normalized_result.get("run_id") or ""),
				"latest_job_id": str(normalized_result.get("latest_job_id") or ""),
				"last_result": normalized_result,
				"indexed_processing_fingerprint": fingerprint,
			})
			follow_up_paths = list(state.get("pending_changed_paths") or [])
			if bool(state.get("dirty_after_run")) or follow_up_paths:
				changed_paths = list(dict.fromkeys([*list(state.get("changed_paths") or []), *follow_up_paths]))
				state.update({
					"status": "queued",
					"current_stage": "debouncing",
					"stage": "debouncing",
					"dirty": True,
					"dirty_after_run": False,
					"pending_changed_paths": [],
					"changed_paths": changed_paths,
					"changed_count": len(changed_paths),
				})
				manager._save_state(state)
				run_at = datetime.now(manager.UTC) + timedelta(seconds=max(0.0, manager._normalize_seconds(state.get("debounce_seconds"))))
				manager._schedule_dispatch(run_at, project_id=project_id)
			else:
				manager._save_state(state)
	except Exception as exc:
		with manager._lock:
			state = manager._load_state(project_id, hydrate=False)
			state.update({
				"status": "failed",
				"current_stage": "failed",
				"stage": "failed",
				"failed_stage": str(state.get("current_stage") or "pending") or "pending",
				"last_error": str(exc),
				"updated_at": manager._now_iso(),
				"last_finished_at": manager._now_iso(),
				"l2_metrics": preserved_l2_metrics,
				"l2_progress": preserved_l2_progress,
			})
			manager._save_state(state)


__all__ = ["check_needs_reindex", "resume_sync_if_needed", "run_sync_loop", "start_worker"]