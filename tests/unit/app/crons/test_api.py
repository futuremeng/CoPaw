# -*- coding: utf-8 -*-
from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from qwenpaw.app.crons import api as cron_api_module


def _build_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(cron_api_module.router)
    manager = MagicMock()
    manager.get_agent.side_effect = AssertionError("workspace should not start")
    app.state.multi_agent_manager = manager
    return app


def _mock_agent_resolution(monkeypatch, workspace_dir: Path) -> None:
    monkeypatch.setattr(
        cron_api_module,
        "resolve_agent_id_for_request",
        lambda request: "default",
    )
    monkeypatch.setattr(
        cron_api_module,
        "get_loaded_agent_for_request",
        lambda request: None,
    )
    monkeypatch.setattr(
        cron_api_module,
        "load_config",
        lambda: SimpleNamespace(
            agents=SimpleNamespace(
                profiles={
                    "default": SimpleNamespace(
                        workspace_dir=str(workspace_dir),
                    ),
                },
            ),
        ),
    )


def test_list_jobs_reads_repo_without_loading_workspace(
    tmp_path: Path,
    monkeypatch,
) -> None:
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()

    jobs_path = workspace_dir / "jobs.json"
    jobs_path.write_text(
        json.dumps(
            {
                "version": 1,
                "jobs": [
                    {
                        "id": "job-1",
                        "name": "Quick Job",
                        "enabled": True,
                        "schedule": {
                            "type": "cron",
                            "cron": "0 9 * * *",
                            "timezone": "UTC",
                        },
                        "task_type": "text",
                        "text": "hello",
                        "dispatch": {
                            "type": "channel",
                            "channel": "console",
                            "target": {
                                "user_id": "admin",
                                "session_id": "default",
                            },
                            "mode": "final",
                            "meta": {},
                        },
                        "runtime": {
                            "max_concurrency": 1,
                            "timeout_seconds": 120,
                            "misfire_grace_seconds": 60,
                            "share_session": True,
                        },
                        "meta": {},
                    }
                ],
            },
        ),
        encoding="utf-8",
    )

    _mock_agent_resolution(monkeypatch, workspace_dir)

    app = _build_test_app()
    client = TestClient(app)

    response = client.get("/cron/jobs")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["id"] == "job-1"
    assert body[0]["name"] == "Quick Job"
    app.state.multi_agent_manager.get_agent.assert_not_called()


def test_dispatch_targets_reads_chat_repo_without_loading_workspace(
    tmp_path: Path,
    monkeypatch,
) -> None:
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()

    chats_path = workspace_dir / "chats.json"
    chats_path.write_text(
        json.dumps(
            {
                "version": 1,
                "chats": [
                    {
                        "id": "chat-1",
                        "name": "Chat One",
                        "session_id": "console:user-1",
                        "user_id": "user-1",
                        "channel": "console",
                        "created_at": "2025-01-01T00:00:00Z",
                        "updated_at": "2025-01-01T00:00:00Z",
                        "meta": {},
                        "status": "idle",
                        "pinned": False,
                    },
                    {
                        "id": "chat-2",
                        "name": "Chat Two",
                        "session_id": "wechat:user-2",
                        "user_id": "user-2",
                        "channel": "wechat",
                        "created_at": "2025-01-01T00:00:00Z",
                        "updated_at": "2025-01-01T00:00:00Z",
                        "meta": {},
                        "status": "idle",
                        "pinned": False,
                    },
                ],
            },
        ),
        encoding="utf-8",
    )

    _mock_agent_resolution(monkeypatch, workspace_dir)

    app = _build_test_app()
    client = TestClient(app)

    response = client.get("/cron/dispatch-targets", params={"limit": 10})

    assert response.status_code == 200
    body = response.json()
    assert {item["channel"] for item in body["items"]} == {"console", "wechat"}
    assert "console" in body["channels"]
    app.state.multi_agent_manager.get_agent.assert_not_called()


def test_create_job_writes_repo_without_loading_workspace(
    tmp_path: Path,
    monkeypatch,
) -> None:
    workspace_dir = tmp_path / "workspace"
    workspace_dir.mkdir()

    jobs_path = workspace_dir / "jobs.json"
    jobs_path.write_text(
        json.dumps({"version": 1, "jobs": []}),
        encoding="utf-8",
    )

    _mock_agent_resolution(monkeypatch, workspace_dir)

    app = _build_test_app()
    client = TestClient(app)

    payload = {
        "name": "Created via Fast Path",
        "enabled": True,
        "schedule": {
            "type": "cron",
            "cron": "0 9 * * *",
            "timezone": "UTC",
        },
        "task_type": "text",
        "text": "probe",
        "dispatch": {
            "type": "channel",
            "channel": "console",
            "target": {
                "user_id": "admin",
                "session_id": "default",
            },
            "mode": "final",
        },
        "runtime": {
            "max_concurrency": 1,
            "timeout_seconds": 120,
            "misfire_grace_seconds": 60,
            "share_session": True,
        },
    }

    response = client.post("/cron/jobs", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Created via Fast Path"
    assert body["id"]
    app.state.multi_agent_manager.get_agent.assert_not_called()

    persisted = json.loads(jobs_path.read_text(encoding="utf-8"))
    assert len(persisted["jobs"]) == 1
    assert persisted["jobs"][0]["id"] == body["id"]
    assert persisted["jobs"][0]["name"] == "Created via Fast Path"
