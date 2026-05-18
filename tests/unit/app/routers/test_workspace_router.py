# -*- coding: utf-8 -*-

import io
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from copaw.app.project_realtime_events import collect_project_realtime_changes
from copaw.app.routers import workspace as workspace_router_module


@pytest.fixture
def workspace_api_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, Path]:
    def _mock_load_config():
        return SimpleNamespace(
            agents=SimpleNamespace(
                profiles={
                    "default": SimpleNamespace(workspace_dir=str(tmp_path)),
                },
            ),
        )

    monkeypatch.setattr(
        workspace_router_module,
        "get_loaded_agent_for_request",
        lambda _request: None,
    )
    monkeypatch.setattr(
        workspace_router_module,
        "resolve_agent_id_for_request",
        lambda _request: "default",
    )
    monkeypatch.setattr(
        workspace_router_module,
        "load_config",
        _mock_load_config,
    )

    app = FastAPI()
    app.include_router(workspace_router_module.router)
    return TestClient(app), tmp_path


def test_workspace_upload_records_project_realtime_event(
    workspace_api_client: tuple[TestClient, Path],
):
    client, workspace_dir = workspace_api_client

    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("projects/project-a/original/note.md", "hello from upload")
        zf.writestr("README.md", "workspace root")
    archive.seek(0)

    response = client.post(
        "/workspace/upload",
        files={"file": ("workspace.zip", archive.getvalue(), "application/zip")},
    )

    assert response.status_code == 200
    assert response.json() == {"success": True}

    project_dir = workspace_dir / "projects" / "project-a"
    latest_event_id, changed_paths = collect_project_realtime_changes(
        project_dir,
        "project-a",
        0,
    )

    assert latest_event_id >= 1
    assert "original/note.md" in changed_paths
    assert (project_dir / "original" / "note.md").read_text(encoding="utf-8") == "hello from upload"


def test_workspace_files_preserves_agent_http_exception(
    monkeypatch: pytest.MonkeyPatch,
):
    def _mock_resolve_agent_id_for_request(_request):
        raise HTTPException(status_code=404, detail="Agent 'missing' not found")

    monkeypatch.setattr(
        workspace_router_module,
        "get_loaded_agent_for_request",
        lambda _request: None,
    )
    monkeypatch.setattr(
        workspace_router_module,
        "resolve_agent_id_for_request",
        _mock_resolve_agent_id_for_request,
    )

    app = FastAPI()
    app.include_router(workspace_router_module.router)
    client = TestClient(app)

    response = client.get("/workspace/files")

    assert response.status_code == 404
    assert response.json() == {"detail": "Agent 'missing' not found"}
