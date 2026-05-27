# -*- coding: utf-8 -*-

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from .errors import (
    FlowDefinitionNotFoundError,
    FlowRunNotFoundError,
    FlowTransitionConflictError,
    FlowTransitionNotAllowedError,
)
from .models import (
    FlowCommandRecord,
    FlowDefinition,
    FlowEventRecord,
    FlowRunRecord,
    flow_now_iso,
)
from .sqlite_repo import SQLiteFlowEngineRepository


class FlowEngineService:
    """Minimal global flow engine service backed by SQLite."""

    def __init__(self, database_path: Path | str) -> None:
        self.repo = SQLiteFlowEngineRepository(database_path)
        self.repo.ensure_schema()

    def register_definition(self, definition: FlowDefinition) -> FlowDefinition:
        now = flow_now_iso()
        definition.updated_at = now
        if not definition.created_at:
            definition.created_at = now
        return self.repo.upsert_definition(definition)

    def get_definition(self, definition_id: str) -> FlowDefinition | None:
        return self.repo.get_definition(definition_id)

    def list_definitions(self) -> list[FlowDefinition]:
        return self.repo.list_definitions()

    def list_runs(
        self,
        *,
        agent_id: str | None = None,
        scope_kind: str | None = None,
        scope_id: str | None = None,
    ) -> list[FlowRunRecord]:
        return self.repo.list_runs(
            agent_id=agent_id,
            scope_kind=scope_kind,
            scope_id=scope_id,
        )

    def get_run_any_agent(self, *, run_id: str) -> FlowRunRecord | None:
        return self.repo.get_run(run_id, agent_id=None)

    def get_run(self, *, agent_id: str | None, run_id: str) -> FlowRunRecord | None:
        return self.repo.get_run(run_id, agent_id=agent_id)

    def get_run_timeline(
        self,
        *,
        run_id: str,
        agent_id: str | None,
    ) -> dict[str, Any] | None:
        run = self.repo.get_run(run_id, agent_id=agent_id)
        if run is None:
            return None
        return {
            "run": run,
            "events": self.repo.list_events(run_id, agent_id=run.agent_id),
            "commands": self.repo.list_commands(run_id, agent_id=run.agent_id),
        }

    @staticmethod
    def _allowed_target_statuses(current_status: str) -> set[str]:
        transitions = {
            "queued": {"running", "paused", "cancelled"},
            "running": {"paused", "succeeded", "failed", "cancelled"},
            "paused": {"running", "cancelled"},
            "failed": {"running"},
        }
        return transitions.get(current_status, set())

    def _ensure_transition_allowed(self, *, run: FlowRunRecord, target_status: str) -> None:
        allowed = self._allowed_target_statuses(run.status)
        if target_status not in allowed:
            raise FlowTransitionNotAllowedError(
                f"flow run transition not allowed: {run.status} -> {target_status}"
            )

    def _append_transition_failure_event(
        self,
        *,
        agent_id: str,
        run_id: str,
        current_status: str,
        target_status: str,
        reason: str,
        payload: dict[str, Any] | None = None,
    ) -> None:
        event_payload = {
            "reason": reason,
            "target_status": target_status,
            **(payload or {}),
        }
        self.repo.append_event(
            FlowEventRecord(
                id=f"flow-event-{uuid.uuid4().hex[:12]}",
                agent_id=agent_id,
                run_id=run_id,
                event_type="run.transition_failed",
                status=current_status,
                payload=event_payload,
                created_at=flow_now_iso(),
            )
        )

    def _ensure_transition_allowed_with_audit(
        self,
        *,
        agent_id: str,
        run: FlowRunRecord,
        target_status: str,
    ) -> None:
        try:
            self._ensure_transition_allowed(run=run, target_status=target_status)
        except ValueError:
            self._append_transition_failure_event(
                agent_id=agent_id,
                run_id=run.id,
                current_status=run.status,
                target_status=target_status,
                reason="transition_not_allowed",
            )
            raise

    def enqueue_run(
        self,
        *,
        agent_id: str,
        definition_id: str,
        scope_kind: str,
        scope_id: str,
        priority: int = 100,
        idempotency_key: str = "",
    ) -> FlowRunRecord:
        if self.repo.get_definition(definition_id) is None:
            raise FlowDefinitionNotFoundError(f"Flow definition '{definition_id}' not found")
        normalized_idempotency_key = str(idempotency_key or "").strip()
        if normalized_idempotency_key:
            existing = self.repo.get_run_by_idempotency_key(
                agent_id=agent_id,
                definition_id=definition_id,
                scope_kind=scope_kind,
                scope_id=scope_id,
                idempotency_key=normalized_idempotency_key,
            )
            if existing is not None:
                self.repo.append_event(
                    FlowEventRecord(
                        id=f"flow-event-{uuid.uuid4().hex[:12]}",
                        agent_id=agent_id,
                        run_id=existing.id,
                        event_type="run.enqueue_deduplicated",
                        status=existing.status,
                        payload={
                            "idempotency_key": normalized_idempotency_key,
                            "definition_id": definition_id,
                            "scope_kind": scope_kind,
                            "scope_id": scope_id,
                        },
                        created_at=flow_now_iso(),
                    )
                )
                return existing
        now = flow_now_iso()
        run = FlowRunRecord(
            id=f"flow-run-{uuid.uuid4().hex[:12]}",
            agent_id=agent_id,
            definition_id=definition_id,
            scope_kind=scope_kind,
            scope_id=scope_id,
            status="queued",
            priority=priority,
            idempotency_key=normalized_idempotency_key,
            created_at=now,
            updated_at=now,
        )
        self.repo.insert_run(run)
        self.repo.append_event(
            FlowEventRecord(
                id=f"flow-event-{uuid.uuid4().hex[:12]}",
                agent_id=agent_id,
                run_id=run.id,
                event_type="run.enqueued",
                status="queued",
                payload={
                    "definition_id": definition_id,
                    "scope_kind": scope_kind,
                    "scope_id": scope_id,
                    "priority": priority,
                },
                created_at=now,
            )
        )
        return run

    def request_command(
        self,
        *,
        agent_id: str,
        run_id: str,
        command_type: str,
        payload: dict[str, Any] | None = None,
    ) -> FlowCommandRecord:
        if self.repo.get_run(run_id, agent_id=agent_id) is None:
            raise FlowRunNotFoundError(f"Flow run '{run_id}' not found")
        now = flow_now_iso()
        command = FlowCommandRecord(
            id=f"flow-cmd-{uuid.uuid4().hex[:12]}",
            agent_id=agent_id,
            run_id=run_id,
            command_type=command_type,
            payload=payload or {},
            status="pending",
            created_at=now,
            updated_at=now,
        )
        return self.repo.insert_command(command)

    def transition_run(
        self,
        *,
        agent_id: str,
        run_id: str,
        status: str,
        step_id: str = "",
        payload: dict[str, Any] | None = None,
    ) -> FlowRunRecord:
        current = self.repo.get_run(run_id, agent_id=agent_id)
        if current is None:
            raise FlowRunNotFoundError(f"Flow run '{run_id}' not found")
        self._ensure_transition_allowed_with_audit(
            agent_id=agent_id,
            run=current,
            target_status=status,
        )

        now = flow_now_iso()
        run = self.repo.update_run_status_if_current_status(
            run_id,
            agent_id=agent_id,
            expected_current_status=current.status,
            status=status,
            current_step_id=step_id,
            updated_at=now,
        )
        if run is None:
            latest = self.repo.get_run(run_id, agent_id=agent_id)
            if latest is None:
                raise FlowRunNotFoundError(f"Flow run '{run_id}' not found")
            self._append_transition_failure_event(
                agent_id=agent_id,
                run_id=run_id,
                current_status=latest.status,
                target_status=status,
                reason="transition_conflict",
                payload={"expected_status": current.status, "actual_status": latest.status},
            )
            raise FlowTransitionConflictError(
                "flow run transition conflicted due to concurrent status change: "
                f"expected {current.status}, actual {latest.status}, target {status}"
            )
        self.repo.append_event(
            FlowEventRecord(
                id=f"flow-event-{uuid.uuid4().hex[:12]}",
                agent_id=agent_id,
                run_id=run_id,
                event_type=f"run.{status}",
                status=status,
                step_id=step_id,
                payload=payload or {},
                created_at=now,
            )
        )
        return run

    def pause_run(
        self,
        *,
        agent_id: str,
        run_id: str,
        payload: dict[str, Any] | None = None,
    ) -> FlowRunRecord:
        current = self.repo.get_run(run_id, agent_id=agent_id)
        if current is None:
            raise FlowRunNotFoundError(f"Flow run '{run_id}' not found")
        self._ensure_transition_allowed_with_audit(
            agent_id=agent_id,
            run=current,
            target_status="paused",
        )

        self.request_command(
            agent_id=agent_id,
            run_id=run_id,
            command_type="pause",
            payload=payload or {},
        )
        return self.transition_run(
            agent_id=agent_id,
            run_id=run_id,
            status="paused",
            payload={"command_type": "pause", **(payload or {})},
        )

    def resume_run(
        self,
        *,
        agent_id: str,
        run_id: str,
        payload: dict[str, Any] | None = None,
    ) -> FlowRunRecord:
        current = self.repo.get_run(run_id, agent_id=agent_id)
        if current is None:
            raise FlowRunNotFoundError(f"Flow run '{run_id}' not found")
        self._ensure_transition_allowed_with_audit(
            agent_id=agent_id,
            run=current,
            target_status="running",
        )

        self.request_command(
            agent_id=agent_id,
            run_id=run_id,
            command_type="resume",
            payload=payload or {},
        )
        return self.transition_run(
            agent_id=agent_id,
            run_id=run_id,
            status="running",
            payload={"command_type": "resume", **(payload or {})},
        )

    def cancel_run(
        self,
        *,
        agent_id: str,
        run_id: str,
        payload: dict[str, Any] | None = None,
    ) -> FlowRunRecord:
        current = self.repo.get_run(run_id, agent_id=agent_id)
        if current is None:
            raise FlowRunNotFoundError(f"Flow run '{run_id}' not found")
        self._ensure_transition_allowed_with_audit(
            agent_id=agent_id,
            run=current,
            target_status="cancelled",
        )

        self.request_command(
            agent_id=agent_id,
            run_id=run_id,
            command_type="cancel",
            payload=payload or {},
        )
        return self.transition_run(
            agent_id=agent_id,
            run_id=run_id,
            status="cancelled",
            payload={"command_type": "cancel", **(payload or {})},
        )