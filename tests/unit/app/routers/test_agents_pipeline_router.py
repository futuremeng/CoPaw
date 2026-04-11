# -*- coding: utf-8 -*-

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from copaw.app.routers import agents_pipeline as pipeline_router_module
from copaw.app.routers.agents import _write_project_frontmatter
from copaw.app.routers.agents_pipeline_core import (
    PipelineRunDetail,
    PipelineRunSummary,
    PipelineTemplateInfo,
    _pipeline_md_path,
)


class _FakeAgentWorkspace:
    def __init__(self, workspace_dir: str):
        self.workspace_dir = workspace_dir


class _FakeManager:
    def __init__(self, workspace_dir: str):
        self._workspace = _FakeAgentWorkspace(workspace_dir)

    async def get_agent(self, _agent_id: str):
        return self._workspace


@pytest.fixture
def pipeline_router_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    manager = _FakeManager(str(tmp_path))
    monkeypatch.setattr(
        pipeline_router_module.agents_router_impl,
        "_get_multi_agent_manager",
        lambda _request: manager,
    )

    app = FastAPI()
    app.include_router(pipeline_router_module.router)
    return TestClient(app)


def _sample_payload(template_id: str = "router-pipeline") -> dict:
    return {
        "id": template_id,
        "name": "Router Pipeline",
        "version": "0.1.0",
        "description": "router-level test",
        "steps": [
            {
                "id": "step-1",
                "name": "Collect",
                "kind": "ingest",
                "description": "collect",
                "prompt": "Collect inputs and summarize them.",
            }
        ],
    }


def _seed_project(tmp_path: Path) -> str:
    project_id = "project-demo"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    _write_project_frontmatter(
        project_dir / "PROJECT.md",
        {
            "id": project_id,
            "name": "Demo Project",
            "description": "router pipeline test",
            "status": "active",
            "data_dir": "data",
            "artifact_profile": {
                "skills": [],
                "scripts": [],
                "flows": [],
                "cases": [],
            },
        },
        "# Demo Project\n",
    )
    return project_id


def test_put_pipeline_template_returns_conflict_on_expected_revision_mismatch(
    pipeline_router_client: TestClient,
):
    payload = _sample_payload()
    first = pipeline_router_client.put(
        "/agents/default/pipelines/templates/router-pipeline",
        json=payload,
    )
    assert first.status_code == 200

    conflict = pipeline_router_client.put(
        "/agents/default/pipelines/templates/router-pipeline?expectedRevision=999",
        json=payload,
    )
    assert conflict.status_code == 409
    detail = conflict.json().get("detail", {})
    assert detail.get("code") == "pipeline_revision_conflict"


def test_stream_save_pipeline_emits_validation_failed_event(
    pipeline_router_client: TestClient,
    tmp_path: Path,
):
    payload = _sample_payload("stream-pipeline")
    created = pipeline_router_client.put(
        "/agents/default/pipelines/templates/stream-pipeline",
        json=payload,
    )
    assert created.status_code == 200

    md_path = _pipeline_md_path(tmp_path, "stream-pipeline")
    md_path.write_text(
        "---\n"
        "pipeline_id: stream-pipeline\n"
        "name: Broken\n"
        "version: 0.1.0\n"
        "---\n\n"
        "# Broken\n\n"
        "No valid step headings.\n",
        encoding="utf-8",
    )

    stream_resp = pipeline_router_client.post(
        "/agents/default/pipelines/templates/stream-pipeline/save/stream?expectedRevision=1",
        json=payload,
    )
    assert stream_resp.status_code == 200
    assert "text/event-stream" in stream_resp.headers.get("content-type", "")
    body = stream_resp.text
    assert "validation_failed" in body
    assert "pipeline_md_validation_failed" in body


def test_list_project_pipeline_templates_offloads_to_thread(
    pipeline_router_client: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    project_id = _seed_project(tmp_path)
    original_to_thread = pipeline_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(pipeline_router_module.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(
        pipeline_router_module,
        "_list_project_pipeline_templates",
        lambda _project_dir: [PipelineTemplateInfo(**_sample_payload("tpl-1"))],
    )

    response = pipeline_router_client.get(
        f"/agents/default/projects/{project_id}/pipelines/templates"
    )

    assert response.status_code == 200
    assert calls
    assert calls[0][0] is pipeline_router_module._list_project_pipeline_templates_for_workspace


def test_list_project_pipeline_runs_offloads_to_thread(
    pipeline_router_client: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    project_id = _seed_project(tmp_path)
    original_to_thread = pipeline_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(pipeline_router_module.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(
        pipeline_router_module,
        "_list_project_pipeline_runs",
        lambda _project_dir: [
            PipelineRunSummary(
                id="run-1",
                template_id="tpl-1",
                status="succeeded",
                created_at="2026-01-01T00:00:00",
                updated_at="2026-01-01T00:00:01",
            )
        ],
    )

    response = pipeline_router_client.get(
        f"/agents/default/projects/{project_id}/pipelines/runs"
    )

    assert response.status_code == 200
    assert calls
    assert calls[0][0] is pipeline_router_module._list_project_pipeline_runs_for_workspace


def test_get_project_pipeline_run_offloads_to_thread(
    pipeline_router_client: TestClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    project_id = _seed_project(tmp_path)
    original_to_thread = pipeline_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(pipeline_router_module.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(
        pipeline_router_module,
        "_load_project_pipeline_run",
        lambda _project_dir, run_id: PipelineRunDetail(
            id=run_id,
            template_id="tpl-1",
            project_id=project_id,
            status="succeeded",
            created_at="2026-01-01T00:00:00",
            updated_at="2026-01-01T00:00:01",
            parameters={},
            steps=[],
            artifacts=[],
            focus_chat_id="",
            focus_type="",
            focus_path="",
            source_platform_template_id="",
            source_platform_template_version="",
            flow_version="0.1.0",
            collaboration_events=[],
            artifact_records=[],
            next_actions=[],
        ),
    )

    response = pipeline_router_client.get(
        f"/agents/default/projects/{project_id}/pipelines/runs/run-1"
    )

    assert response.status_code == 200
    assert response.json()["id"] == "run-1"
    assert calls
    assert calls[0][0] is pipeline_router_module._load_project_pipeline_run_for_workspace