# -*- coding: utf-8 -*-

from pathlib import Path

import pytest

from copaw.app import project_knowledge_watcher as watcher_module
from copaw.config.config import Config


@pytest.mark.asyncio
async def test_project_knowledge_watcher_triggers_bootstrap_sync(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    project_dir = tmp_path / "projects" / "project-a"
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "PROJECT.md").write_text(
        "---\nid: project-a\nname: Project A\nproject_auto_knowledge_sink: true\n---\n",
        encoding="utf-8",
    )
    (project_dir / "original" / "brief.md").parent.mkdir(parents=True, exist_ok=True)
    (project_dir / "original" / "brief.md").write_text("hello", encoding="utf-8")

    config = Config()
    config.knowledge.enabled = True
    config.knowledge.memify_enabled = True

    saved = {"called": 0}
    calls: list[dict] = []

    monkeypatch.setattr(watcher_module, "load_config", lambda: config)
    monkeypatch.setattr(
        watcher_module,
        "load_agent_config",
        lambda _agent_id: type("AgentCfg", (), {"running": config.agents.running})(),
    )
    monkeypatch.setattr(
        "copaw.config.utils.save_config",
        lambda _config: saved.__setitem__("called", saved["called"] + 1),
    )

    def fake_start_sync(self, **kwargs):
        calls.append(kwargs)
        return {"accepted": True, "reason": "STARTED", "state": {"project_id": kwargs["project_id"]}}

    monkeypatch.setattr(
        watcher_module.ProjectKnowledgeSyncManager,
        "start_sync",
        fake_start_sync,
    )

    watcher = watcher_module.ProjectKnowledgeWatcher(
        agent_id="default",
        workspace_dir=tmp_path,
        poll_interval=0.01,
    )
    current = watcher._collect_snapshots()
    await watcher._handle_snapshot_changes(current)

    assert len(calls) == 1
    assert calls[0]["project_id"] == "project-a"
    assert calls[0]["trigger"] == "project_watcher_bootstrap"
    assert calls[0]["force"] is True
    assert calls[0]["debounce_seconds"] == watcher_module.DEFAULT_CHANGE_DEBOUNCE_SECONDS
    assert calls[0]["cooldown_seconds"] == watcher_module.DEFAULT_SYNC_COOLDOWN_SECONDS
    assert saved["called"] == 1


@pytest.mark.asyncio
async def test_project_knowledge_watcher_triggers_on_file_change(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    project_dir = tmp_path / "projects" / "project-b"
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "PROJECT.md").write_text(
        "---\nid: project-b\nname: Project B\nproject_auto_knowledge_sink: true\n---\n",
        encoding="utf-8",
    )
    note_path = project_dir / "original" / "note.md"
    note_path.parent.mkdir(parents=True, exist_ok=True)
    note_path.write_text("v1", encoding="utf-8")

    config = Config()
    config.knowledge.enabled = True
    config.knowledge.memify_enabled = True
    monkeypatch.setattr(watcher_module, "load_config", lambda: config)
    monkeypatch.setattr(
        watcher_module,
        "load_agent_config",
        lambda _agent_id: type("AgentCfg", (), {"running": config.agents.running})(),
    )
    monkeypatch.setattr("copaw.config.utils.save_config", lambda _config: None)

    calls: list[dict] = []

    def fake_start_sync(self, **kwargs):
        calls.append(kwargs)
        return {"accepted": True, "reason": "STARTED", "state": {"project_id": kwargs["project_id"]}}

    monkeypatch.setattr(
        watcher_module.ProjectKnowledgeSyncManager,
        "start_sync",
        fake_start_sync,
    )

    watcher = watcher_module.ProjectKnowledgeWatcher(
        agent_id="default",
        workspace_dir=tmp_path,
        poll_interval=0.01,
    )
    initial = watcher._collect_snapshots()
    watcher._snapshots = initial

    note_path.write_text("v2", encoding="utf-8")
    current = watcher._collect_snapshots()
    await watcher._handle_snapshot_changes(current)

    assert len(calls) == 1
    assert calls[0]["project_id"] == "project-b"
    assert calls[0]["trigger"] == "project_watcher_change"
    assert calls[0]["force"] is False
    assert calls[0]["debounce_seconds"] == watcher_module.DEFAULT_CHANGE_DEBOUNCE_SECONDS
    assert calls[0]["cooldown_seconds"] == watcher_module.DEFAULT_SYNC_COOLDOWN_SECONDS
    assert "original/note.md" in calls[0]["changed_paths"]