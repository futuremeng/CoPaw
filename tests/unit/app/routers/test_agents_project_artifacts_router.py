# -*- coding: utf-8 -*-

import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from copaw.config.config import Config
from qwenpaw.app.project_realtime_events import collect_project_realtime_changes
from qwenpaw.app.routers import agents as agents_router_module
from qwenpaw.app.routers.agents import (
    CreateProjectRequest,
    _create_project,
    _build_project_file_summary,
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
    project_dir = workspace_dir / "projects" / project_id
    baseline_event_id, _ = collect_project_realtime_changes(
        project_dir,
        project_id,
        0,
    )

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

    latest_event_id, changed_paths = collect_project_realtime_changes(
        project_dir,
        project_id,
        baseline_event_id,
    )
    assert latest_event_id > baseline_event_id
    assert "PROJECT.md" in changed_paths


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
    client, workspace_dir, project_id = project_artifact_router_client
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

    latest_event_id, changed_paths = collect_project_realtime_changes(
        workspace_dir / "projects" / project_id,
        project_id,
        0,
    )
    assert latest_event_id >= 1
    assert "original/brief.txt" in changed_paths


def test_upload_project_file_activates_idle_monitoring_and_sync(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    manager = _FakeManager(str(tmp_path))
    monkeypatch.setattr(
        agents_router_module,
        "_get_multi_agent_manager",
        lambda _request: manager,
    )

    app = FastAPI()
    app.include_router(agents_router_module.router)
    client = TestClient(app)

    project = _create_project(
        tmp_path,
        CreateProjectRequest(
            name="Idle Upload Activation",
            description="First upload should activate monitoring",
        ),
    )

    before = _load_project_summary(tmp_path / "projects" / project.id)
    assert before is not None
    assert before.file_monitoring_state == "idle"

    calls: list[tuple[str, list[str] | None, str]] = []
    monkeypatch.setattr(
        agents_router_module,
        "_maybe_start_project_auto_knowledge_sync",
        lambda workspace, target_project_id, changed_paths, *, trigger: calls.append(
            (target_project_id, changed_paths, trigger)
        ),
    )

    response = client.post(
        f"/agents/default/projects/{project.id}/files/upload",
        data={"target_dir": "original"},
        files={"file": ("brief.txt", b"hello activation", "text/plain")},
    )

    assert response.status_code == 200
    after = _load_project_summary(tmp_path / "projects" / project.id)
    assert after is not None
    assert after.file_monitoring_state == "active"
    assert calls == [(project.id, ["original/brief.txt"], "project_upload")]


def test_upload_project_file_auto_sync_writes_project_chunks(
    project_artifact_router_client: tuple[TestClient, Path, str],
    monkeypatch: pytest.MonkeyPatch,
):
    client, workspace_dir, project_id = project_artifact_router_client
    config = Config()
    config.knowledge.enabled = True
    config.knowledge.memify_enabled = True

    monkeypatch.setattr(agents_router_module, "load_config", lambda: config)
    monkeypatch.setattr(agents_router_module, "save_config", lambda _config: None)
    monkeypatch.setattr(agents_router_module, "DEFAULT_PROJECT_SYNC_DEBOUNCE_SECONDS", 0)
    monkeypatch.setattr(agents_router_module, "DEFAULT_PROJECT_SYNC_COOLDOWN_SECONDS", 0)

    def run_worker_inline(self, **kwargs):
        self._run_sync_loop(**kwargs)

    monkeypatch.setattr(
        agents_router_module.ProjectKnowledgeSyncManager,
        "_start_worker",
        run_worker_inline,
    )
    monkeypatch.setattr(
        "qwenpaw.app.knowledge_workflow.KnowledgeWorkflowOrchestrator.run",
        lambda self, **kwargs: {
            "run_id": "run-project-upload-auto-chunks",
            "run_status": "succeeded",
            "template_id": "builtin-knowledge-processing-v1",
            "processing_mode": kwargs.get("processing_mode") or "agentic",
            "processing_fingerprint": self.knowledge_manager.compute_processing_fingerprint(
                kwargs["config"],
                kwargs.get("running_config"),
            ),
            "latest_job_id": "",
            "index": self.knowledge_manager.index_source(
                kwargs["source"],
                kwargs["config"],
                kwargs.get("running_config"),
            ),
            "memify": {},
            "quality_loop": {},
            "artifacts": [],
        },
    )

    response = client.post(
        f"/agents/default/projects/{project_id}/files/upload",
        data={"target_dir": "original"},
        files={"file": ("brief.txt", b"hello knowledge", "text/plain")},
    )

    assert response.status_code == 200

    chunk_path = (
        workspace_dir
        / "projects"
        / project_id
        / ".knowledge"
        / "chunks"
        / "original"
        / "brief.txt.0.txt"
    )
    index_path = (
        workspace_dir
        / "projects"
        / project_id
        / ".knowledge"
        / "sources"
        / f"project-{project_id}-workspace"
        / "index.json"
    )

    assert chunk_path.exists()
    assert chunk_path.read_text(encoding="utf-8") == "hello knowledge"

    payload = json.loads(index_path.read_text(encoding="utf-8"))
    chunk_paths = [item.get("chunk_path") for item in payload.get("chunks") or []]
    assert "chunks/original/brief.txt.0.txt" in chunk_paths
    uploaded_chunk = next(
        item
        for item in payload.get("chunks") or []
        if item.get("chunk_path") == "chunks/original/brief.txt.0.txt"
    )
    assert "text" not in uploaded_chunk


def test_list_project_files_endpoint_offloads_to_thread(
    project_artifact_router_client: tuple[TestClient, Path, str],
    monkeypatch: pytest.MonkeyPatch,
):
    client, _workspace_dir, project_id = project_artifact_router_client
    original_to_thread = agents_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(agents_router_module.asyncio, "to_thread", fake_to_thread)

    response = client.get(f"/agents/default/projects/{project_id}/files")

    assert response.status_code == 200
    assert calls
    assert calls[0][0] is agents_router_module._list_project_files_for_workspace


def test_list_project_file_tree_endpoint_returns_shallow_nodes(
    project_artifact_router_client: tuple[TestClient, Path, str],
):
    client, workspace_dir, project_id = project_artifact_router_client
    project_dir = workspace_dir / "projects" / project_id
    nested_dir = project_dir / "original" / "batch-a"
    nested_dir.mkdir(parents=True, exist_ok=True)
    (nested_dir / "note.txt").write_text("hello", encoding="utf-8")

    root_response = client.get(
        f"/agents/default/projects/{project_id}/file-tree"
    )
    assert root_response.status_code == 200
    root_paths = [item["path"] for item in root_response.json()]
    assert "PROJECT.md" in root_paths
    assert "original" in root_paths

    original_response = client.get(
        f"/agents/default/projects/{project_id}/file-tree",
        params={"dir_path": "original"},
    )
    assert original_response.status_code == 200
    payload = original_response.json()
    assert payload == [
        {
            "filename": "batch-a",
            "path": "original/batch-a",
            "size": 0,
            "modified_time": payload[0]["modified_time"],
            "is_directory": True,
            "child_count": 1,
            "descendant_file_count": 1,
        }
    ]


def test_list_project_file_tree_endpoint_offloads_to_thread(
    project_artifact_router_client: tuple[TestClient, Path, str],
    monkeypatch: pytest.MonkeyPatch,
):
    client, _workspace_dir, project_id = project_artifact_router_client
    original_to_thread = agents_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(agents_router_module.asyncio, "to_thread", fake_to_thread)

    response = client.get(
        f"/agents/default/projects/{project_id}/file-tree",
        params={"dir_path": "skills"},
    )

    assert response.status_code == 200
    assert calls
    assert calls[0][0] is agents_router_module._list_project_file_tree_nodes_for_workspace


def test_project_file_summary_endpoint_returns_aggregated_counts(
    project_artifact_router_client: tuple[TestClient, Path, str],
):
    client, workspace_dir, project_id = project_artifact_router_client
    project_dir = workspace_dir / "projects" / project_id
    (project_dir / "original").mkdir(parents=True, exist_ok=True)
    (project_dir / "data").mkdir(parents=True, exist_ok=True)
    (project_dir / "scripts").mkdir(parents=True, exist_ok=True)
    (project_dir / ".cache").mkdir(parents=True, exist_ok=True)
    (project_dir / "original" / "brief.md").write_text("brief", encoding="utf-8")
    (project_dir / "data" / "notes.txt").write_text("notes", encoding="utf-8")
    (project_dir / "scripts" / "run.py").write_text("print('ok')", encoding="utf-8")
    (project_dir / ".cache" / "session.log").write_text("noop", encoding="utf-8")
    (project_dir / ".gitkeep").write_text("", encoding="utf-8")
    (project_dir / "AGENTS.md").write_text("# agent", encoding="utf-8")

    response = client.get(f"/agents/default/projects/{project_id}/summary")

    assert response.status_code == 200
    payload = response.json()
    assert payload["builtin_files"] >= 1
    assert payload["visible_files"] >= 6
    assert payload["original_files"] == 1
    assert payload["derived_files"] >= 1
    assert payload["knowledge_candidate_files"] >= 5
    assert payload["markdown_files"] >= 4
    assert payload["text_like_files"] >= 6
    assert payload["recently_updated_files"] == payload["total_files"]

    summary = _build_project_file_summary(project_dir)
    assert payload == summary.model_dump()


def test_project_file_summary_endpoint_offloads_to_thread(
    project_artifact_router_client: tuple[TestClient, Path, str],
    monkeypatch: pytest.MonkeyPatch,
):
    client, _workspace_dir, project_id = project_artifact_router_client
    original_to_thread = agents_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(agents_router_module.asyncio, "to_thread", fake_to_thread)

    response = client.get(f"/agents/default/projects/{project_id}/summary")

    assert response.status_code == 200
    assert calls
    assert calls[0][0] is agents_router_module._build_project_file_summary_for_workspace


def test_project_file_metadata_endpoint_returns_existing_files_only(
    project_artifact_router_client: tuple[TestClient, Path, str],
):
    client, workspace_dir, project_id = project_artifact_router_client
    project_dir = workspace_dir / "projects" / project_id
    (project_dir / "original").mkdir(parents=True, exist_ok=True)
    (project_dir / "data").mkdir(parents=True, exist_ok=True)
    (project_dir / "original" / "brief.md").write_text("brief", encoding="utf-8")
    (project_dir / "data" / "notes.txt").write_text("notes", encoding="utf-8")

    response = client.post(
        f"/agents/default/projects/{project_id}/files/metadata",
        json={
            "paths": [
                "original/brief.md",
                "data/notes.txt",
                "data/missing.txt",
                "original/brief.md",
            ]
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["path"] for item in payload] == [
        "original/brief.md",
        "data/notes.txt",
    ]


def test_project_file_metadata_endpoint_offloads_to_thread(
    project_artifact_router_client: tuple[TestClient, Path, str],
    monkeypatch: pytest.MonkeyPatch,
):
    client, _workspace_dir, project_id = project_artifact_router_client
    original_to_thread = agents_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(agents_router_module.asyncio, "to_thread", fake_to_thread)

    response = client.post(
        f"/agents/default/projects/{project_id}/files/metadata",
        json={"paths": ["PROJECT.md"]},
    )

    assert response.status_code == 200
    assert calls
    assert calls[0][0] is agents_router_module._get_project_files_metadata_for_workspace


def test_read_project_file_endpoint_offloads_to_thread(
    project_artifact_router_client: tuple[TestClient, Path, str],
    monkeypatch: pytest.MonkeyPatch,
):
    client, workspace_dir, project_id = project_artifact_router_client
    project_dir = workspace_dir / "projects" / project_id
    target_file = project_dir / "original" / "notes.md"
    target_file.parent.mkdir(parents=True, exist_ok=True)
    target_file.write_text("hello", encoding="utf-8")

    original_to_thread = agents_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(agents_router_module.asyncio, "to_thread", fake_to_thread)

    response = client.get(
        f"/agents/default/projects/{project_id}/files/original/notes.md"
    )

    assert response.status_code == 200
    assert response.json()["content"] == "hello"
    assert calls
    assert calls[0][0] is agents_router_module._read_project_text_file_for_workspace


def test_list_project_files_avoids_per_file_resolve(
    project_artifact_router_client: tuple[TestClient, Path, str],
    monkeypatch: pytest.MonkeyPatch,
):
    _client, workspace_dir, project_id = project_artifact_router_client
    project_dir = workspace_dir / "projects" / project_id
    nested_file = project_dir / "original" / "nested.txt"
    nested_file.parent.mkdir(parents=True, exist_ok=True)
    nested_file.write_text("nested", encoding="utf-8")

    path_type = type(project_dir)
    original_resolve = path_type.resolve

    def fake_resolve(self, *args, **kwargs):
        if self != project_dir:
            raise AssertionError("per-file resolve should not be called")
        return original_resolve(self, *args, **kwargs)

    monkeypatch.setattr(path_type, "resolve", fake_resolve)

    files = agents_router_module._list_project_files(project_dir)

    assert any(item.path == "original/nested.txt" for item in files)


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
    assert (project_dir / ".agent" / "AGENTS.md").exists()
    assert (project_dir / ".agent" / "PLAN.md").exists()
    assert (project_dir / ".agent" / "PROJECT.md").exists()
    assert (project_dir / "data" / "README.md").exists()
    assert (project_dir / "pipelines" / "templates" / "README.md").exists()
    assert (project_dir / "pipelines" / "runs" / "README.md").exists()
    assert (
        project_dir
        / "skills"
        / "project-artifact-governor"
        / "SKILL.md"
    ).exists()

    latest_event_id, changed_paths = collect_project_realtime_changes(
        project_dir,
        project.id,
        0,
    )
    assert latest_event_id >= 1
    assert ".agent/PROJECT.md" in changed_paths
    assert ".agent/AGENTS.md" not in changed_paths
    assert ".agent/PLAN.md" not in changed_paths
    assert "data/README.md" not in changed_paths


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
    assert summary.file_monitoring_state == "idle"


def test_clone_project_records_realtime_event(
    project_artifact_router_client: tuple[TestClient, Path, str],
):
    client, workspace_dir, project_id = project_artifact_router_client

    response = client.post(
        f"/agents/default/projects/{project_id}/clone",
        json={"target_name": "Project Demo Clone"},
    )

    assert response.status_code == 200
    payload = response.json()
    cloned_project_id = payload["id"]
    cloned_project_dir = workspace_dir / "projects" / cloned_project_id

    latest_event_id, changed_paths = collect_project_realtime_changes(
        cloned_project_dir,
        cloned_project_id,
        0,
    )

    assert latest_event_id >= 1
    assert "PROJECT.md" in changed_paths
    assert "skills/quick_start.md" in changed_paths
    assert (cloned_project_dir / "skills" / "quick_start.md").exists()


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
