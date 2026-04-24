# -*- coding: utf-8 -*-

import asyncio
import json
from pathlib import Path

import pytest

from copaw.config.config import Config
from qwenpaw.app import project_knowledge_watcher as watcher_module


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
        "qwenpaw.config.utils.save_config",
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
async def test_project_knowledge_watcher_skips_idle_projects_before_first_file_activity(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    project_dir = tmp_path / "projects" / "project-idle"
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "PROJECT.md").write_text(
        "---\n"
        "id: project-idle\n"
        "name: Project Idle\n"
        "project_auto_knowledge_sink: true\n"
        "file_monitoring_state: idle\n"
        "---\n",
        encoding="utf-8",
    )
    (project_dir / "original" / "brief.md").parent.mkdir(parents=True, exist_ok=True)
    (project_dir / "original" / "brief.md").write_text("hello", encoding="utf-8")

    config = Config()
    config.knowledge.enabled = True
    config.knowledge.memify_enabled = True

    calls: list[dict] = []

    monkeypatch.setattr(watcher_module, "load_config", lambda: config)
    monkeypatch.setattr(
        watcher_module,
        "load_agent_config",
        lambda _agent_id: type("AgentCfg", (), {"running": config.agents.running})(),
    )
    monkeypatch.setattr("qwenpaw.config.utils.save_config", lambda _config: None)
    monkeypatch.setattr(
        watcher_module.ProjectKnowledgeSyncManager,
        "start_sync",
        lambda self, **kwargs: calls.append(kwargs),
    )

    watcher = watcher_module.ProjectKnowledgeWatcher(
        agent_id="default",
        workspace_dir=tmp_path,
        poll_interval=0.01,
    )
    current = watcher._collect_snapshots()
    await watcher._handle_snapshot_changes(current)

    assert calls == []


@pytest.mark.asyncio
async def test_project_knowledge_watcher_bootstrap_writes_project_chunks_automatically(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    project_dir = tmp_path / "projects" / "project-auto-chunks"
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "PROJECT.md").write_text(
        "---\nid: project-auto-chunks\nname: Project Auto Chunks\nproject_auto_knowledge_sink: true\n---\n",
        encoding="utf-8",
    )
    brief_path = project_dir / "original" / "brief.md"
    brief_path.parent.mkdir(parents=True, exist_ok=True)
    brief_path.write_text("第一句。第二句!", encoding="utf-8")

    config = Config()
    config.knowledge.enabled = True
    config.knowledge.memify_enabled = True

    monkeypatch.setattr(watcher_module, "load_config", lambda: config)
    monkeypatch.setattr(
        watcher_module,
        "load_agent_config",
        lambda _agent_id: type("AgentCfg", (), {"running": config.agents.running})(),
    )
    monkeypatch.setattr("qwenpaw.config.utils.save_config", lambda _config: None)

    def run_worker_inline(self, **kwargs):
        self._run_sync_loop(**kwargs)

    monkeypatch.setattr(
        watcher_module.ProjectKnowledgeSyncManager,
        "_start_worker",
        run_worker_inline,
    )
    monkeypatch.setattr(
        "qwenpaw.app.knowledge_workflow.KnowledgeWorkflowOrchestrator.run",
        lambda self, **kwargs: {
            "run_id": "run-project-auto-chunks",
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

    watcher = watcher_module.ProjectKnowledgeWatcher(
        agent_id="default",
        workspace_dir=tmp_path,
        poll_interval=0.01,
    )

    current = watcher._collect_snapshots()
    await watcher._handle_snapshot_changes(current)

    chunk_path = (
        tmp_path
        / "projects"
        / "project-auto-chunks"
        / ".knowledge"
        / "chunks"
        / "original"
        / "brief.md.0.txt"
    )
    index_path = (
        tmp_path
        / "projects"
        / "project-auto-chunks"
        / ".knowledge"
        / "sources"
        / "project-project-auto-chunks-workspace"
        / "index.json"
    )

    assert chunk_path.exists()
    assert chunk_path.read_text(encoding="utf-8") == "第一句。\n第二句!"
    payload = json.loads(index_path.read_text(encoding="utf-8"))
    chunk_paths = [item.get("chunk_path") for item in payload.get("chunks") or []]
    assert "chunks/original/brief.md.0.txt" in chunk_paths
    brief_chunk = next(
        item
        for item in payload.get("chunks") or []
        if item.get("chunk_path") == "chunks/original/brief.md.0.txt"
    )
    assert "text" not in brief_chunk


@pytest.mark.asyncio
async def test_project_knowledge_watcher_change_updates_project_chunks_automatically(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    project_dir = tmp_path / "projects" / "project-change-chunks"
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "PROJECT.md").write_text(
        "---\nid: project-change-chunks\nname: Project Change Chunks\nproject_auto_knowledge_sink: true\n---\n",
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
    monkeypatch.setattr("qwenpaw.config.utils.save_config", lambda _config: None)
    monkeypatch.setattr(watcher_module, "DEFAULT_CHANGE_DEBOUNCE_SECONDS", 0)
    monkeypatch.setattr(watcher_module, "DEFAULT_SYNC_COOLDOWN_SECONDS", 0)

    def run_worker_inline(self, **kwargs):
        self._run_sync_loop(**kwargs)

    monkeypatch.setattr(
        watcher_module.ProjectKnowledgeSyncManager,
        "_start_worker",
        run_worker_inline,
    )
    monkeypatch.setattr(
        "qwenpaw.app.knowledge_workflow.KnowledgeWorkflowOrchestrator.run",
        lambda self, **kwargs: {
            "run_id": "run-project-change-chunks",
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

    watcher = watcher_module.ProjectKnowledgeWatcher(
        agent_id="default",
        workspace_dir=tmp_path,
        poll_interval=0.01,
    )

    initial = watcher._collect_snapshots()
    await watcher._handle_snapshot_changes(initial)
    watcher._snapshots = initial

    chunk_path = (
        tmp_path
        / "projects"
        / "project-change-chunks"
        / ".knowledge"
        / "chunks"
        / "original"
        / "note.md.0.txt"
    )
    index_path = (
        tmp_path
        / "projects"
        / "project-change-chunks"
        / ".knowledge"
        / "sources"
        / "project-project-change-chunks-workspace"
        / "index.json"
    )

    assert chunk_path.exists()
    assert chunk_path.read_text(encoding="utf-8") == "v1"

    note_path.write_text("v2", encoding="utf-8")
    current = watcher._collect_snapshots()
    await watcher._handle_snapshot_changes(current)

    assert chunk_path.read_text(encoding="utf-8") == "v2"
    payload = json.loads(index_path.read_text(encoding="utf-8"))
    note_chunk = next(
        item
        for item in payload.get("chunks") or []
        if item.get("chunk_path") == "chunks/original/note.md.0.txt"
    )
    assert "text" not in note_chunk


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
    monkeypatch.setattr("qwenpaw.config.utils.save_config", lambda _config: None)

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


@pytest.mark.asyncio
async def test_project_knowledge_watcher_start_offloads_snapshot_collection(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    watcher = watcher_module.ProjectKnowledgeWatcher(
        agent_id="default",
        workspace_dir=tmp_path,
        poll_interval=0.01,
    )

    original_to_thread = watcher_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(
        watcher,
        "_collect_snapshots",
        lambda: {"project-a": {"project_id": "project-a"}},
    )
    monkeypatch.setattr(watcher_module.asyncio, "to_thread", fake_to_thread)

    await watcher.start()
    await watcher.stop()

    assert watcher._snapshots == {"project-a": {"project_id": "project-a"}}
    assert calls
    assert callable(calls[0][0])
    assert calls[0][1] == ()


@pytest.mark.asyncio
async def test_project_knowledge_watcher_poll_loop_offloads_snapshot_collection(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    watcher = watcher_module.ProjectKnowledgeWatcher(
        agent_id="default",
        workspace_dir=tmp_path,
        poll_interval=0,
    )

    snapshots = iter(
        [
            {"project-a": {"project_id": "project-a", "files": {}, "auto_enabled": True}},
            {"project-a": {"project_id": "project-a", "files": {}, "auto_enabled": True}},
        ]
    )
    original_to_thread = watcher_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(watcher, "_collect_snapshots", lambda: next(snapshots))

    handled: list[dict[str, dict]] = []

    async def fake_handle(current):
        handled.append(current)
        raise asyncio.CancelledError()

    monkeypatch.setattr(watcher, "_handle_snapshot_changes", fake_handle)
    monkeypatch.setattr(watcher_module.asyncio, "to_thread", fake_to_thread)
    watcher._snapshots = {}

    with pytest.raises(asyncio.CancelledError):
        await watcher._poll_loop()

    assert handled
    assert calls
    assert callable(calls[0][0])
    assert calls[0][1] == ()


@pytest.mark.asyncio
async def test_project_knowledge_watcher_triggers_on_processing_config_change(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    project_dir = tmp_path / "projects" / "project-c"
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "PROJECT.md").write_text(
        "---\nid: project-c\nname: Project C\nproject_auto_knowledge_sink: true\n---\n",
        encoding="utf-8",
    )
    note_path = project_dir / "original" / "note.md"
    note_path.parent.mkdir(parents=True, exist_ok=True)
    note_path.write_text("stable", encoding="utf-8")

    config = Config()
    config.knowledge.enabled = True
    config.knowledge.memify_enabled = True
    monkeypatch.setattr(watcher_module, "load_config", lambda: config)
    monkeypatch.setattr(
        watcher_module,
        "load_agent_config",
        lambda _agent_id: type("AgentCfg", (), {"running": config.agents.running})(),
    )
    monkeypatch.setattr("qwenpaw.config.utils.save_config", lambda _config: None)

    calls: list[dict] = []

    def fake_start_sync(self, **kwargs):
        calls.append(kwargs)
        return {"accepted": True, "reason": "STARTED", "state": {"project_id": kwargs["project_id"]}}

    monkeypatch.setattr(
        watcher_module.ProjectKnowledgeSyncManager,
        "start_sync",
        fake_start_sync,
    )
    monkeypatch.setattr(
        watcher_module.ProjectKnowledgeSyncManager,
        "check_needs_reindex",
        lambda self, **_kwargs: True,
    )

    watcher = watcher_module.ProjectKnowledgeWatcher(
        agent_id="default",
        workspace_dir=tmp_path,
        poll_interval=0.01,
    )
    initial = watcher._collect_snapshots()
    watcher._snapshots = initial

    # Keep file snapshot unchanged; trigger should come from processing config check.
    current = watcher._collect_snapshots()
    await watcher._handle_snapshot_changes(current)

    assert len(calls) == 1
    assert calls[0]["project_id"] == "project-c"
    assert calls[0]["trigger"] == "project_watcher_config_change"
    assert calls[0]["force"] is False
    assert calls[0]["changed_paths"] == []


@pytest.mark.asyncio
async def test_runtime_context_load_is_offloaded_and_cached(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    config = Config()
    config.knowledge.enabled = True
    config.knowledge.memify_enabled = True
    load_config_calls = {"count": 0}
    load_agent_calls = {"count": 0}

    def fake_load_config():
        load_config_calls["count"] += 1
        return config

    def fake_load_agent_config(_agent_id: str):
        load_agent_calls["count"] += 1
        return type("AgentCfg", (), {"running": config.agents.running})()

    original_to_thread = watcher_module.asyncio.to_thread
    to_thread_calls: list[str] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        to_thread_calls.append(getattr(func, "__name__", str(func)))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(watcher_module, "load_config", fake_load_config)
    monkeypatch.setattr(watcher_module, "load_agent_config", fake_load_agent_config)
    monkeypatch.setattr(watcher_module.asyncio, "to_thread", fake_to_thread)

    watcher = watcher_module.ProjectKnowledgeWatcher(
        agent_id="default",
        workspace_dir=tmp_path,
        poll_interval=0.01,
    )

    ctx1 = await watcher._load_runtime_context()
    ctx2 = await watcher._load_runtime_context()

    assert ctx1[0] is ctx2[0]
    assert load_config_calls["count"] == 1
    assert load_agent_calls["count"] == 1
    assert len(to_thread_calls) == 2