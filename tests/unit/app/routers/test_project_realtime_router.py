# -*- coding: utf-8 -*-

import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from copaw.app.project_realtime_events import record_project_realtime_paths
from copaw.app.routers import project_realtime as project_realtime_module
from copaw.app.routers.agents import _write_project_frontmatter


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
    project_dir.mkdir(parents=True, exist_ok=True)
    _write_project_frontmatter(
        project_dir / "PROJECT.md",
        {
            "id": project_id,
            "name": "Demo Project",
            "description": "project realtime test",
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


def test_project_realtime_ws_emits_file_tree_updates(tmp_path: Path):
    manager = _FakeManager(str(tmp_path))
    project_id = _seed_project(tmp_path)

    app = FastAPI()
    app.state.multi_agent_manager = manager
    app.include_router(project_realtime_module.router)

    with TestClient(app) as client:
        with client.websocket_connect(
            f"/agents/default/projects/{project_id}/realtime/ws?interval_ms=750"
        ) as websocket:
            first = websocket.receive_json()
            assert first["type"] == "snapshot"
            assert first["event_id"] == 1
            assert first["reason"] == "initial_sync"
            assert first["changed_paths"] == []
            assert first["snapshot"]["file_tree"]["summary"]["builtin_files"] >= 1
            first_fingerprint = first["snapshot"]["file_tree"]["fingerprint"]

            target_file = tmp_path / "projects" / project_id / "original" / "note.md"
            target_file.parent.mkdir(parents=True, exist_ok=True)
            target_file.write_text("hello realtime", encoding="utf-8")

            second = websocket.receive_json()
            assert second["type"] == "snapshot"
            assert second["event_id"] == 2
            assert second["reason"] == "change"
            assert "original/note.md" in second["changed_paths"]
            assert second["snapshot"]["file_tree"]["fingerprint"] != first_fingerprint
            assert second["snapshot"]["file_tree"]["file_count"] >= 2
            assert second["snapshot"]["file_tree"]["summary"]["original_files"] == 1
            assert second["snapshot"]["file_tree"]["summary"]["visible_files"] >= 1


def test_project_realtime_ws_emits_pipeline_updates(tmp_path: Path):
    manager = _FakeManager(str(tmp_path))
    project_id = _seed_project(tmp_path)

    app = FastAPI()
    app.state.multi_agent_manager = manager
    app.include_router(project_realtime_module.router)

    with TestClient(app) as client:
        with client.websocket_connect(
            f"/agents/default/projects/{project_id}/realtime/ws?interval_ms=750"
        ) as websocket:
            first = websocket.receive_json()
            assert first["type"] == "snapshot"
            assert first["event_id"] == 1
            first_fingerprint = first["snapshot"]["pipeline"]["fingerprint"]

            manifest_path = (
                tmp_path
                / "projects"
                / project_id
                / ".pipelines"
                / "runs"
                / "run-1"
                / "run_manifest.json"
            )
            manifest_path.parent.mkdir(parents=True, exist_ok=True)
            manifest_path.write_text(
                json.dumps({"run_id": "run-1", "status": "running"}),
                encoding="utf-8",
            )

            second = websocket.receive_json()
            assert second["type"] == "snapshot"
            assert second["event_id"] == 2
            assert second["reason"] == "change"
            assert ".pipelines/runs/run-1/run_manifest.json" in second["changed_paths"]
            assert second["snapshot"]["pipeline"]["fingerprint"] != first_fingerprint
            assert second["snapshot"]["pipeline"]["run_count"] == 1


def test_project_realtime_ws_emits_heartbeat_when_idle(tmp_path: Path):
    manager = _FakeManager(str(tmp_path))
    project_id = _seed_project(tmp_path)

    app = FastAPI()
    app.state.multi_agent_manager = manager
    app.include_router(project_realtime_module.router)

    with TestClient(app) as client:
        with client.websocket_connect(
            f"/agents/default/projects/{project_id}/realtime/ws?interval_ms=750&heartbeat_ms=750"
        ) as websocket:
            first = websocket.receive_json()
            assert first["type"] == "snapshot"

            second = websocket.receive_json()
            assert second["type"] == "heartbeat"
            assert second["event_id"] == 2


def test_project_realtime_ws_emits_explicit_tool_event_without_fingerprint_change(
    tmp_path: Path,
):
    manager = _FakeManager(str(tmp_path))
    project_id = _seed_project(tmp_path)
    target_file = tmp_path / "projects" / project_id / "original" / "note.md"
    target_file.parent.mkdir(parents=True, exist_ok=True)
    target_file.write_text("hello realtime", encoding="utf-8")

    app = FastAPI()
    app.state.multi_agent_manager = manager
    app.include_router(project_realtime_module.router)

    with TestClient(app) as client:
        with client.websocket_connect(
            f"/agents/default/projects/{project_id}/realtime/ws?interval_ms=750"
        ) as websocket:
            first = websocket.receive_json()
            assert first["type"] == "snapshot"

            record_project_realtime_paths(tmp_path, [target_file])

            second = websocket.receive_json()
            assert second["type"] == "snapshot"
            assert second["reason"] == "explicit_event"
            assert "original/note.md" in second["changed_paths"]