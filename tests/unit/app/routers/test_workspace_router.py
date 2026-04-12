# -*- coding: utf-8 -*-

import io
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from copaw.app.project_realtime_events import collect_project_realtime_changes
from copaw.app.routers import workspace as workspace_router_module


@pytest.fixture
def workspace_api_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, Path]:
    async def _mock_get_agent_for_request(_request):
        return SimpleNamespace(workspace_dir=tmp_path)

    monkeypatch.setattr(
        "copaw.app.agent_context.get_agent_for_request",
        _mock_get_agent_for_request,
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
