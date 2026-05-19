# -*- coding: utf-8 -*-

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from qwenpaw.app.routers import agents as agents_router_module
from qwenpaw.app.routers.agents import CreateProjectRequest, _create_project


@pytest.fixture
def project_files_query_client(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[TestClient, Path]:
    monkeypatch.setattr(
        agents_router_module,
        "_resolve_agent_workspace_dir",
        lambda _agent_id: tmp_path,
    )

    app = FastAPI()
    app.include_router(agents_router_module.router)
    return TestClient(app), tmp_path


def _write(path: Path, content: str = "x") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_query_project_files_endpoint_returns_filtered_records(
    project_files_query_client: tuple[TestClient, Path],
):
    client, workspace_dir = project_files_query_client
    project = _create_project(
        workspace_dir,
        CreateProjectRequest(name="query-project-a"),
    )
    project_dir = workspace_dir / "projects" / project.id
    _write(project_dir / "original" / "a.md", "a")
    _write(project_dir / "output" / "b.json", "{}")
    _write(project_dir / ".agent" / "PROJECT.md", "meta")

    response = client.post(
        f"/agents/default/projects/{project.id}/files/query",
        json={
            "stages": ["original", "artifact"],
            "include_builtin": False,
            "sort_by": "path",
            "sort_order": "asc",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["total_matched"] == 2
    assert [item["path"] for item in payload["items"]] == [
        "original/a.md",
        "output/b.json",
    ]
    assert payload["summary"]["stage_counts"]["original"] == 1
    assert payload["summary"]["stage_counts"]["artifact"] == 1


def test_query_project_files_endpoint_supports_search_and_pagination(
    project_files_query_client: tuple[TestClient, Path],
):
    client, workspace_dir = project_files_query_client
    project = _create_project(
        workspace_dir,
        CreateProjectRequest(name="query-project-b"),
    )
    project_dir = workspace_dir / "projects" / project.id
    for index in range(4):
        _write(project_dir / "original" / f"note-{index}.txt", str(index))

    response = client.post(
        f"/agents/default/projects/{project.id}/files/query",
        json={
            "search": "note",
            "offset": 1,
            "limit": 2,
            "sort_by": "path",
            "sort_order": "asc",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["summary"]["total_matched"] == 4
    assert payload["summary"]["returned"] == 2
    assert [item["path"] for item in payload["items"]] == [
        "original/note-1.txt",
        "original/note-2.txt",
    ]
