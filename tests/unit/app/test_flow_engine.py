# -*- coding: utf-8 -*-

from pathlib import Path

import pytest

from copaw.app.flow_engine import (
    FLOW_ENGINE_SCHEMA_VERSION,
    FlowDefinition,
    FlowEngineService,
    FlowStepDefinition,
    SQLiteFlowEngineRepository,
)


def _build_definition() -> FlowDefinition:
    return FlowDefinition(
        id="builtin-knowledge-processing-v1",
        name="Knowledge Processing Workflow",
        version="2.0.0",
        description="Minimal test definition for the global flow engine.",
        system_owned=True,
        tags=["builtin", "knowledge"],
        steps=[
            FlowStepDefinition(
                id="snapshot_raw",
                name="Raw Snapshot",
                kind="ingest",
                executor="builtin:knowledge.snapshot_raw",
            ),
            FlowStepDefinition(
                id="tokenize",
                name="Tokenize",
                kind="transform",
                executor="builtin:knowledge.tokenize",
                depends_on=["snapshot_raw"],
            ),
        ],
    )


def test_sqlite_flow_engine_repository_ensures_schema(tmp_path: Path):
    repo = SQLiteFlowEngineRepository(tmp_path / "flow-engine" / "flow_engine.sqlite3")

    db_path = repo.ensure_schema()

    assert db_path.exists()
    assert repo.get_schema_version() == FLOW_ENGINE_SCHEMA_VERSION


def test_flow_engine_service_registers_and_loads_definition(tmp_path: Path):
    service = FlowEngineService(tmp_path / "flow-engine.sqlite3")
    definition = _build_definition()

    service.register_definition(definition)
    loaded = service.get_definition(definition.id)

    assert loaded is not None
    assert loaded.id == definition.id
    assert [step.executor for step in loaded.steps] == [
        "builtin:knowledge.snapshot_raw",
        "builtin:knowledge.tokenize",
    ]


def test_flow_engine_service_enqueues_run_and_records_event(tmp_path: Path):
    service = FlowEngineService(tmp_path / "flow-engine.sqlite3")
    definition = _build_definition()
    service.register_definition(definition)

    run = service.enqueue_run(
        agent_id="agent-a",
        definition_id=definition.id,
        scope_kind="project",
        scope_id="project-123",
        priority=50,
        idempotency_key="project-123:knowledge",
    )

    runs = service.repo.list_runs(agent_id="agent-a", scope_kind="project", scope_id="project-123")
    events = service.repo.list_events(run.id, agent_id="agent-a")

    assert run.status == "queued"
    assert run.agent_id == "agent-a"
    assert len(runs) == 1
    assert runs[0].id == run.id
    assert events[0].event_type == "run.enqueued"
    assert events[0].agent_id == "agent-a"
    assert events[0].payload["definition_id"] == definition.id


def test_flow_engine_service_records_commands_and_transitions(tmp_path: Path):
    service = FlowEngineService(tmp_path / "flow-engine.sqlite3")
    definition = _build_definition()
    service.register_definition(definition)
    run = service.enqueue_run(
        agent_id="agent-a",
        definition_id=definition.id,
        scope_kind="project",
        scope_id="project-456",
    )

    command = service.request_command(
        agent_id="agent-a",
        run_id=run.id,
        command_type="pause",
        payload={"reason": "user-request"},
    )
    updated = service.transition_run(
        agent_id="agent-a",
        run_id=run.id,
        status="paused",
        step_id="snapshot_raw",
        payload={"reason": "user-request"},
    )

    commands = service.repo.list_commands(run.id, agent_id="agent-a")
    events = service.repo.list_events(run.id, agent_id="agent-a")

    assert command.command_type == "pause"
    assert command.agent_id == "agent-a"
    assert commands[0].payload["reason"] == "user-request"
    assert updated.status == "paused"
    assert updated.current_step_id == "snapshot_raw"
    assert events[-1].event_type == "run.paused"


def test_flow_engine_service_isolates_runs_by_agent_id(tmp_path: Path):
    service = FlowEngineService(tmp_path / "flow-engine.sqlite3")
    definition = _build_definition()
    service.register_definition(definition)

    run_a = service.enqueue_run(
        agent_id="agent-a",
        definition_id=definition.id,
        scope_kind="project",
        scope_id="shared-project",
    )
    run_b = service.enqueue_run(
        agent_id="agent-b",
        definition_id=definition.id,
        scope_kind="project",
        scope_id="shared-project",
    )

    runs_a = service.list_runs(agent_id="agent-a", scope_kind="project", scope_id="shared-project")
    runs_b = service.list_runs(agent_id="agent-b", scope_kind="project", scope_id="shared-project")

    assert [item.id for item in runs_a] == [run_a.id]
    assert [item.id for item in runs_b] == [run_b.id]

    assert service.get_run(agent_id="agent-a", run_id=run_b.id) is None
    assert service.get_run(agent_id="agent-b", run_id=run_a.id) is None


def test_flow_engine_service_rejects_illegal_transition(tmp_path: Path):
    service = FlowEngineService(tmp_path / "flow-engine.sqlite3")
    definition = _build_definition()
    service.register_definition(definition)

    run = service.enqueue_run(
        agent_id="agent-a",
        definition_id=definition.id,
        scope_kind="project",
        scope_id="project-789",
    )

    service.pause_run(agent_id="agent-a", run_id=run.id)

    with pytest.raises(ValueError):
        service.pause_run(agent_id="agent-a", run_id=run.id)

    events = service.repo.list_events(run.id, agent_id="agent-a")
    failed_events = [event for event in events if event.event_type == "run.transition_failed"]
    assert len(failed_events) == 1
    assert failed_events[0].payload["reason"] == "transition_not_allowed"
    assert failed_events[0].payload["target_status"] == "paused"


def test_flow_engine_service_enqueues_idempotently_by_key(tmp_path: Path):
    service = FlowEngineService(tmp_path / "flow-engine.sqlite3")
    definition = _build_definition()
    service.register_definition(definition)

    first = service.enqueue_run(
        agent_id="agent-a",
        definition_id=definition.id,
        scope_kind="project",
        scope_id="project-idempotent",
        idempotency_key="project-idempotent:knowledge",
    )
    second = service.enqueue_run(
        agent_id="agent-a",
        definition_id=definition.id,
        scope_kind="project",
        scope_id="project-idempotent",
        idempotency_key="project-idempotent:knowledge",
    )

    assert second.id == first.id
    runs = service.repo.list_runs(
        agent_id="agent-a",
        scope_kind="project",
        scope_id="project-idempotent",
    )
    assert len(runs) == 1

    events = service.repo.list_events(first.id, agent_id="agent-a")
    event_types = [event.event_type for event in events]
    assert event_types.count("run.enqueued") == 1
    assert "run.enqueue_deduplicated" in event_types


def test_flow_engine_service_transition_rejects_concurrent_status_conflict(tmp_path: Path):
    service = FlowEngineService(tmp_path / "flow-engine.sqlite3")
    definition = _build_definition()
    service.register_definition(definition)
    run = service.enqueue_run(
        agent_id="agent-a",
        definition_id=definition.id,
        scope_kind="project",
        scope_id="project-conflict",
    )

    original = service.repo.update_run_status_if_current_status

    def _simulate_concurrent_change(*args, **kwargs):
        service.repo.update_run_status(
            run.id,
            agent_id="agent-a",
            status="paused",
            updated_at=run.updated_at,
        )
        return original(*args, **kwargs)

    service.repo.update_run_status_if_current_status = _simulate_concurrent_change  # type: ignore[assignment]

    with pytest.raises(ValueError, match="transition conflicted"):
        service.transition_run(
            agent_id="agent-a",
            run_id=run.id,
            status="running",
            payload={"reason": "concurrency-test"},
        )

    events = service.repo.list_events(run.id, agent_id="agent-a")
    failed_events = [event for event in events if event.event_type == "run.transition_failed"]
    assert len(failed_events) == 1
    assert failed_events[0].payload["reason"] == "transition_conflict"
    assert failed_events[0].payload["target_status"] == "running"
    assert failed_events[0].payload["expected_status"] == "queued"
    assert failed_events[0].payload["actual_status"] == "paused"