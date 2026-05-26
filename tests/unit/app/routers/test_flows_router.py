# -*- coding: utf-8 -*-

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from copaw.app.flow_engine import FlowDefinition, FlowEngineService, FlowStepDefinition
from qwenpaw.app.routers import flows as flows_router_module
from qwenpaw.app.routers import flows_global as flows_global_router_module


@pytest.fixture
def flow_api_client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[TestClient, FlowEngineService]:
    service = FlowEngineService(tmp_path / "flow-engine.sqlite3")
    definition = FlowDefinition(
        id="builtin-knowledge-processing-v1",
        name="Knowledge Processing Workflow",
        version="2.0.0",
        description="Router tests definition",
        system_owned=True,
        steps=[
            FlowStepDefinition(
                id="snapshot_raw",
                name="Raw Snapshot",
                kind="ingest",
                executor="builtin:knowledge.snapshot_raw",
            )
        ],
    )
    service.register_definition(definition)

    monkeypatch.setattr(
        flows_router_module,
        "get_flow_engine_service",
        lambda: service,
    )
    monkeypatch.setattr(
        flows_global_router_module,
        "get_flow_engine_service",
        lambda: service,
    )
    monkeypatch.setattr(
        flows_router_module,
        "resolve_agent_id_for_request",
        lambda _request: "agent-a",
    )

    app = FastAPI()
    app.include_router(flows_router_module.router)
    app.include_router(flows_global_router_module.router)
    return TestClient(app), service


def test_scoped_flows_create_run_and_pause_resume(
    flow_api_client: tuple[TestClient, FlowEngineService],
) -> None:
    client, _service = flow_api_client

    create_resp = client.post(
        "/flows/runs",
        json={
            "definition_id": "builtin-knowledge-processing-v1",
            "scope_kind": "project",
            "scope_id": "project-100",
        },
    )
    assert create_resp.status_code == 200
    run_id = create_resp.json()["id"]

    pause_resp = client.post(
        f"/flows/runs/{run_id}/commands",
        json={"command_type": "pause", "payload": {"reason": "manual"}},
    )
    assert pause_resp.status_code == 200
    assert pause_resp.json()["run"]["status"] == "paused"

    pause_again_resp = client.post(
        f"/flows/runs/{run_id}/commands",
        json={"command_type": "pause", "payload": {}},
    )
    assert pause_again_resp.status_code == 409

    resume_resp = client.post(
        f"/flows/runs/{run_id}/commands",
        json={"command_type": "resume", "payload": {}},
    )
    assert resume_resp.status_code == 200
    assert resume_resp.json()["run"]["status"] == "running"

    detail_resp = client.get(f"/flows/runs/{run_id}")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["run"]["agent_id"] == "agent-a"
    assert len(detail["commands"]) == 2


def test_global_flow_routes_can_filter_by_agent(
    flow_api_client: tuple[TestClient, FlowEngineService],
) -> None:
    client, service = flow_api_client

    service.enqueue_run(
        agent_id="agent-a",
        definition_id="builtin-knowledge-processing-v1",
        scope_kind="project",
        scope_id="project-100",
    )
    service.enqueue_run(
        agent_id="agent-b",
        definition_id="builtin-knowledge-processing-v1",
        scope_kind="project",
        scope_id="project-200",
    )

    all_resp = client.get("/flows/global/runs")
    assert all_resp.status_code == 200
    assert len(all_resp.json()) == 2

    agent_a_resp = client.get("/flows/global/runs", params={"agent_id": "agent-a"})
    assert agent_a_resp.status_code == 200
    payload = agent_a_resp.json()
    assert len(payload) == 1
    assert payload[0]["agent_id"] == "agent-a"

    summary_resp = client.get("/flows/global/agents/agent-b/summary")
    assert summary_resp.status_code == 200
    assert summary_resp.json()["agent_id"] == "agent-b"
    assert summary_resp.json()["total_runs"] == 1
