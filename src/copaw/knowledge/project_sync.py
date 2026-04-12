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
            "updated_at": self._now_iso(),
            "latest_job_id": "",
            "latest_source_id": "",
            "last_result": {},
        }

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
            return self._default_state(project_id)
        try:
            payload = json.loads(self.state_path.read_text(encoding="utf-8"))
        except Exception:
            return self._default_state(project_id)
        if not isinstance(payload, dict):
            return self._default_state(project_id)
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
        return state

    def _save_state(self, state: dict[str, Any]) -> None:
        self.knowledge_root.mkdir(parents=True, exist_ok=True)
        state["updated_at"] = self._now_iso()
        state["changed_count"] = len(state.get("changed_paths") or [])
        self.state_path.write_text(
            json.dumps(state, ensure_ascii=False, indent=2),
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
    ) -> None:
        delay = max((run_at - datetime.now(UTC)).total_seconds(), 0.05)

        def _callback() -> None:
            try:
                self._dispatch_scheduled_sync(
                    project_id=project_id,
                    config=config,
                    running_config=running_config,
                    source=source,
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
    ) -> None:
        worker = threading.Thread(
            target=self._run_sync_loop,
            kwargs={
                "project_id": project_id,
                "config": config,
                "running_config": running_config,
                "source": source,
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
            state["scheduled_for"] = run_at.isoformat()
            state["queued_at"] = state.get("queued_at") or self._now_iso()
            self._save_state(state)
            self._schedule_dispatch(
                run_at,
                project_id=project_id,
                config=config,
                running_config=running_config,
                source=source,
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
            )

        if should_start:
            self._start_worker(
                project_id=project_id,
                config=config,
                running_config=running_config,
                source=source,
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
    ) -> dict[str, Any]:
        should_start = False
        with self._lock:
            state = self._load_state(project_id)
            state = self._recover_stale_active_state(state)
            state["auto_enabled"] = bool(auto_enabled)
            state["debounce_seconds"] = self._normalize_seconds(debounce_seconds)
            state["cooldown_seconds"] = self._normalize_seconds(cooldown_seconds)
            active = self._is_active_state(state)
            if active:
                state["dirty_after_run"] = True
                state["last_trigger"] = (trigger or "manual").strip() or "manual"
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
            )

        if should_start:
            self._start_worker(
                project_id=project_id,
                config=config,
                running_config=running_config,
                source=source,
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
    ) -> None:
        while True:
            try:
                self._patch_state(
                    project_id,
                    self._normalize_sync_patch({
                        "status": "indexing",
                        "stage": "indexing",
                        "stage_message": "Indexing project source",
                        "progress": 20,
                        "current": 1,
                        "total": 3,
                        "eta_seconds": 5,
                        "last_started_at": self._now_iso(),
                        "last_error": "",
                    }),
                )
                index_result = self._knowledge_manager.index_source(
                    source,
                    config,
                    running_config,
                )

                self._patch_state(
                    project_id,
                    self._normalize_sync_patch({
                        "status": "graphifying",
                        "stage": "graphifying",
                        "stage_message": "Building knowledge graph",
                        "progress": 70,
                        "current": 2,
                        "total": 3,
                        "eta_seconds": 3,
                        "last_result": {
                            "index": index_result,
                        },
                    }),
                )

                def _on_memify_progress(payload: dict[str, Any]) -> None:
                    stage = str(payload.get("stage") or "graphifying").strip() or "graphifying"
                    stage_message = str(payload.get("stage_message") or "").strip()
                    raw_progress = payload.get("progress", payload.get("percent", 70))
                    try:
                        progress = int(float(raw_progress or 70))
                    except (TypeError, ValueError):
                        progress = 70
                    self._patch_state(
                        project_id,
                        self._normalize_sync_patch(
                            {
                                "status": "graphifying",
                                "stage": f"graphify_{stage}",
                                "stage_message": stage_message or "Graph building in progress",
                                "progress": max(20, min(95, progress)),
                                "current": payload.get("current") if isinstance(payload.get("current"), (int, float)) else 0,
                                "total": payload.get("total") if isinstance(payload.get("total"), (int, float)) else 0,
                                "eta_seconds": payload.get("eta_seconds") if isinstance(payload.get("eta_seconds"), (int, float)) else None,
                            }
                        ),
                    )

                memify_result = self._graph_ops.execute_memify_once(
                    config=config,
                    pipeline_type="project-auto",
                    dataset_scope=[source.id],
                    dry_run=False,
                    progress_callback=_on_memify_progress,
                )
                succeeded = str(memify_result.get("status") or "") == "succeeded"
                now = self._now_iso()
                self._patch_state(
                    project_id,
                    self._normalize_sync_patch({
                        "status": "succeeded" if succeeded else "failed",
                        "stage": "completed" if succeeded else "failed",
                        "stage_message": "Project sync completed" if succeeded else "Project sync failed",
                        "progress": 100 if succeeded else 0,
                        "current": 3,
                        "total": 3,
                        "eta_seconds": 0,
                        "last_finished_at": now,
                        "last_success_at": now if succeeded else None,
                        "last_error": str(memify_result.get("error") or "").strip(),
                        "latest_job_id": str(memify_result.get("job_id") or "").strip(),
                        "last_result": {
                            "index": index_result,
                            "memify": memify_result,
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
                )

            if should_start:
                self._start_worker(
                    project_id=project_id,
                    config=config,
                    running_config=running_config,
                    source=source,
                )
            return

    def _patch_state(self, project_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            state = self._load_state(project_id)
            state.update(self._normalize_sync_patch(patch))
            self._save_state(state)
            return dict(state)