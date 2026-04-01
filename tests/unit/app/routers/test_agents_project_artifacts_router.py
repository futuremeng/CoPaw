# -*- coding: utf-8 -*-

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from copaw.app.routers import agents as agents_router_module
from copaw.app.routers.agents import _load_project_summary, _write_project_frontmatter


class _FakeAgentWorkspace:
    def __init__(self, workspace_dir: str):
        self.workspace_dir = workspace_dir


class _FakeManager:
    def __init__(self, workspace_dir: str):
        self._workspace = _FakeAgentWorkspace(workspace_dir)

    async def get_agent(self, _agent_id: str):
        return self._workspace


def _seed_project(workspace_dir: Path) -> str:
    project_id = "project-demo"
    project_dir = workspace_dir / "projects" / project_id
    skills_dir = project_dir / "skills"
    skills_dir.mkdir(parents=True, exist_ok=True)

    (skills_dir / "quick_start.md").write_text(
        "# Quick Start\n\nCollect requirements and constraints first.\n",
        encoding="utf-8",
    )
    (skills_dir / "legacy_tooling.md").write_text(
        "# Legacy Tooling\n\nWrap old scripts with guard rails.\n",
        encoding="utf-8",
    )

    metadata = {
        "id": project_id,
        "name": "Demo Project",
        "description": "For router artifact tests",
        "status": "active",
        "data_dir": "data",
        "artifact_profile": {
            "skills": [],
            "scripts": [],
            "flows": [],
            "cases": [],
        },
    }
    _write_project_frontmatter(project_dir / "PROJECT.md", metadata, "# Demo Project\n")
    return project_id


@pytest.fixture
def project_artifact_router_client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[TestClient, Path, str]:
    manager = _FakeManager(str(tmp_path))
    monkeypatch.setattr(
        agents_router_module,
        "_get_multi_agent_manager",
        lambda _request: manager,
    )

    project_id = _seed_project(tmp_path)

    app = FastAPI()
    app.include_router(agents_router_module.router)
    return TestClient(app), tmp_path, project_id


def test_distill_draft_endpoint_is_idempotent(
    project_artifact_router_client: tuple[TestClient, Path, str],
):
    client, workspace_dir, project_id = project_artifact_router_client

    first = client.post(
        f"/agents/default/projects/{project_id}/artifacts/skills/distill-draft",
    )
    assert first.status_code == 200
    first_body = first.json()
    assert first_body["drafted_count"] == 2
    assert first_body["skipped_count"] == 0

    second = client.post(
        f"/agents/default/projects/{project_id}/artifacts/skills/distill-draft",
    )
    assert second.status_code == 200
    second_body = second.json()
    assert second_body["drafted_count"] == 0
    assert second_body["skipped_count"] == 2

    summary = _load_project_summary(workspace_dir / "projects" / project_id)
    assert summary is not None
    assert len(summary.artifact_profile.skills) == 2
    for item in summary.artifact_profile.skills:
        assert item.status == "draft"


def test_confirm_stable_endpoint_returns_404_for_missing_artifact(
    project_artifact_router_client: tuple[TestClient, Path, str],
):
    client, _workspace_dir, project_id = project_artifact_router_client

    resp = client.post(
        f"/agents/default/projects/{project_id}/artifacts/skills/not-found/confirm-stable",
    )
    assert resp.status_code == 404
    assert "not found" in str(resp.json().get("detail", "")).lower()


def test_confirm_stable_endpoint_updates_status(
    project_artifact_router_client: tuple[TestClient, Path, str],
):
    client, workspace_dir, project_id = project_artifact_router_client

    distill = client.post(
        f"/agents/default/projects/{project_id}/artifacts/skills/distill-draft",
    )
    assert distill.status_code == 200
    drafted_ids = distill.json().get("drafted_ids") or []
    assert drafted_ids

    artifact_id = drafted_ids[0]
    confirm = client.post(
        f"/agents/default/projects/{project_id}/artifacts/skills/{artifact_id}/confirm-stable",
    )
    assert confirm.status_code == 200
    confirm_body = confirm.json()
    assert confirm_body["confirmed"] is True
    assert confirm_body["artifact_id"] == artifact_id
    assert confirm_body["status"] == "stable"

    summary = _load_project_summary(workspace_dir / "projects" / project_id)
    assert summary is not None
    item = next(skill for skill in summary.artifact_profile.skills if skill.id == artifact_id)
    assert item.status == "stable"
