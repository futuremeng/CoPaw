# -*- coding: utf-8 -*-

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from copaw.app.routers import agents as agents_router_module
from copaw.app.routers.agents import (
    CreateProjectRequest,
    _create_project,
    _load_project_summary,
    _write_project_frontmatter,
)


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
    _write_project_frontmatter(
        project_dir / "PROJECT.md", metadata, "# Demo Project\n"
    )
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


def test_update_artifact_distill_mode_endpoint(
    project_artifact_router_client: tuple[TestClient, Path, str],
):
    client, workspace_dir, project_id = project_artifact_router_client

    updated = client.put(
        f"/agents/default/projects/{project_id}/artifact-distill-mode",
        json={"artifact_distill_mode": "conversation_evidence"},
    )
    assert updated.status_code == 200
    payload = updated.json()
    assert payload["artifact_distill_mode"] == "conversation_evidence"

    summary = _load_project_summary(workspace_dir / "projects" / project_id)
    assert summary is not None
    assert summary.artifact_distill_mode == "conversation_evidence"


def test_update_project_knowledge_sink_endpoint(
    project_artifact_router_client: tuple[TestClient, Path, str],
):
    client, workspace_dir, project_id = project_artifact_router_client

    before = _load_project_summary(workspace_dir / "projects" / project_id)
    assert before is not None
    assert before.project_auto_knowledge_sink is True

    updated = client.put(
        f"/agents/default/projects/{project_id}/knowledge-sink",
        json={"project_auto_knowledge_sink": False},
    )
    assert updated.status_code == 200
    payload = updated.json()
    assert payload["project_auto_knowledge_sink"] is False

    after = _load_project_summary(workspace_dir / "projects" / project_id)
    assert after is not None
    assert after.project_auto_knowledge_sink is False


def test_upload_project_file_triggers_auto_knowledge_sync(
    project_artifact_router_client: tuple[TestClient, Path, str],
    monkeypatch: pytest.MonkeyPatch,
):
    client, _workspace_dir, project_id = project_artifact_router_client
    calls: list[tuple[str, list[str] | None, str]] = []

    monkeypatch.setattr(
        agents_router_module,
        "_maybe_start_project_auto_knowledge_sync",
        lambda workspace, target_project_id, changed_paths, *, trigger: calls.append(
            (target_project_id, changed_paths, trigger)
        ),
    )

    response = client.post(
        f"/agents/default/projects/{project_id}/files/upload",
        data={"target_dir": "original"},
        files={"file": ("brief.txt", b"hello knowledge", "text/plain")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["path"] == "original/brief.txt"
    assert calls == [(project_id, ["original/brief.txt"], "project_upload")]


def test_create_project_uses_builtin_template_fallbacks(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    empty_templates_dir = tmp_path / "missing-project-templates"
    empty_templates_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(
        agents_router_module,
        "_PROJECT_TEMPLATES_DIR",
        empty_templates_dir,
    )
    monkeypatch.setattr(
        agents_router_module.importlib.resources,
        "files",
        lambda _package: empty_templates_dir,
    )

    project = _create_project(
        tmp_path,
        CreateProjectRequest(
            name="Fallback Project",
            description="Created without packaged templates",
        ),
    )

    project_dir = tmp_path / "projects" / project.id
    assert (tmp_path / "projects" / "README.md").exists()
    assert (project_dir / "AGENTS.md").exists()
    assert (project_dir / "data" / "README.md").exists()
    assert (project_dir / "pipelines" / "templates" / "README.md").exists()
    assert (project_dir / "pipelines" / "runs" / "README.md").exists()
    assert (
        project_dir
        / "skills"
        / "project-artifact-governor"
        / "SKILL.md"
    ).exists()


def test_create_project_defaults_auto_knowledge_sink_enabled(tmp_path: Path):
    project = _create_project(
        tmp_path,
        CreateProjectRequest(
            name="Auto Sink Default",
            description="Default auto sink should be on",
        ),
    )

    summary = _load_project_summary(tmp_path / "projects" / project.id)
    assert summary is not None
    assert summary.project_auto_knowledge_sink is True


def test_distill_draft_uses_conversation_evidence_mode(
    project_artifact_router_client: tuple[TestClient, Path, str],
):
    client, workspace_dir, project_id = project_artifact_router_client

    runs_dir = (
        workspace_dir
        / "projects"
        / project_id
        / "pipelines"
        / "runs"
        / "run-demo-1"
    )
    runs_dir.mkdir(parents=True, exist_ok=True)
    (runs_dir / "run_manifest.json").write_text(
        "{\n"
        '  "run_id": "run-demo-1",\n'
        '  "collaboration_events": [\n'
        '    {"event": "step.completed", "step_id": "collect-context", "message": "Summarize repeated troubleshooting operation into reusable skill."}\n'
        "  ]\n"
        "}\n",
        encoding="utf-8",
    )

    updated = client.put(
        f"/agents/default/projects/{project_id}/artifact-distill-mode",
        json={"artifact_distill_mode": "conversation_evidence"},
    )
    assert updated.status_code == 200

    distill = client.post(
        f"/agents/default/projects/{project_id}/artifacts/skills/distill-draft",
    )
    assert distill.status_code == 200
    body = distill.json()
    assert body["artifact_distill_mode"] == "conversation_evidence"
    assert body["drafted_count"] == 1
    drafted_ids = body.get("drafted_ids") or []
    assert drafted_ids == ["run-demo-1-collect-context"]

    summary = _load_project_summary(workspace_dir / "projects" / project_id)
    assert summary is not None
    skill_item = next(
        item
        for item in summary.artifact_profile.skills
        if item.id == "run-demo-1-collect-context"
    )
    assert "conversation-evidence" in skill_item.tags
    assert skill_item.artifact_file_path.endswith("run_manifest.json")


def test_distill_draft_can_target_specific_run_id(
    project_artifact_router_client: tuple[TestClient, Path, str],
):
    client, workspace_dir, project_id = project_artifact_router_client

    run_a_dir = (
        workspace_dir / "projects" / project_id / "pipelines" / "runs" / "run-a"
    )
    run_a_dir.mkdir(parents=True, exist_ok=True)
    (run_a_dir / "run_manifest.json").write_text(
        "{\n"
        '  "run_id": "run-a",\n'
        '  "collaboration_events": [\n'
        '    {"event": "step.completed", "step_id": "step-a", "message": "Summarize A."}\n'
        "  ]\n"
        "}\n",
        encoding="utf-8",
    )

    run_b_dir = (
        workspace_dir / "projects" / project_id / "pipelines" / "runs" / "run-b"
    )
    run_b_dir.mkdir(parents=True, exist_ok=True)
    (run_b_dir / "run_manifest.json").write_text(
        "{\n"
        '  "run_id": "run-b",\n'
        '  "collaboration_events": [\n'
        '    {"event": "step.completed", "step_id": "step-b", "message": "Summarize B."}\n'
        "  ]\n"
        "}\n",
        encoding="utf-8",
    )

    updated = client.put(
        f"/agents/default/projects/{project_id}/artifact-distill-mode",
        json={"artifact_distill_mode": "conversation_evidence"},
    )
    assert updated.status_code == 200

    distill = client.post(
        f"/agents/default/projects/{project_id}/artifacts/skills/distill-draft",
        json={"run_id": "run-b"},
    )
    assert distill.status_code == 200
    body = distill.json()
    assert body["drafted_ids"] == ["run-b-step-b"]

    summary = _load_project_summary(workspace_dir / "projects" / project_id)
    assert summary is not None
    assert len(summary.artifact_profile.skills) == 1
    assert summary.artifact_profile.skills[0].id == "run-b-step-b"


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
    item = next(
        skill
        for skill in summary.artifact_profile.skills
        if skill.id == artifact_id
    )
    assert item.status == "stable"


def test_full_artifact_chain_distill_confirm_and_promote(
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
    assert confirm.json().get("status") == "stable"

    promote = client.post(
        f"/agents/default/projects/{project_id}/artifacts/skills/{artifact_id}/promote",
        json={
            "target_name": "auto_chain_skill",
            "enable": False,
        },
    )
    assert promote.status_code == 200
    promote_body = promote.json()
    assert promote_body.get("promoted") is True
    assert promote_body.get("target_name") == "auto_chain_skill"

    target_md = workspace_dir / "skills" / "auto_chain_skill" / "SKILL.md"
    assert target_md.exists()
    assert "project_id: project-demo" in target_md.read_text(encoding="utf-8")

    summary = _load_project_summary(workspace_dir / "projects" / project_id)
    assert summary is not None
    item = next(
        skill
        for skill in summary.artifact_profile.skills
        if skill.id == artifact_id
    )
    assert item.origin == "project-promoted"
    assert item.market_item_id == "auto_chain_skill"
