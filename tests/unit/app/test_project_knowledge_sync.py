# -*- coding: utf-8 -*-

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from copaw.config.config import Config, KnowledgeSourceSpec
from copaw.knowledge.project_sync import ProjectKnowledgeSyncManager


def _build_source(project_id: str, project_dir: Path) -> KnowledgeSourceSpec:
    return KnowledgeSourceSpec(
        id=f"project-{project_id}-workspace",
        name=f"Project Workspace: {project_id}",
        type="directory",
        location=str(project_dir),
        content="",
        enabled=True,
        recursive=True,
        project_id=project_id,
        tags=["project"],
        summary="test source",
    )


def test_project_sync_queues_until_debounce_window(tmp_path: Path, monkeypatch):
    project_id = "project-a"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    manager = ProjectKnowledgeSyncManager(
        tmp_path,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    config = Config().knowledge
    source = _build_source(project_id, project_dir)

    scheduled: list[datetime] = []
    started: list[dict] = []

    monkeypatch.setattr(
        manager,
        "_schedule_dispatch",
        lambda run_at, **_: scheduled.append(run_at),
    )
    monkeypatch.setattr(
        manager,
        "_start_worker",
        lambda **kwargs: started.append(kwargs),
    )

    result = manager.start_sync(
        project_id=project_id,
        config=config,
        running_config=None,
        source=source,
        trigger="project_watcher_change",
        changed_paths=["original/a.md"],
        auto_enabled=True,
        force=False,
        debounce_seconds=5,
        cooldown_seconds=0,
    )

    state = manager.get_state(project_id)
    assert result["accepted"] is True
    assert result["reason"] == "QUEUED"
    assert state["status"] == "queued"
    assert state["current_stage"] == "debouncing"
    assert "Semantic engine waiting for project source registration." in state["stage_message"]
    assert "original/a.md" in state["changed_paths"]
    assert state["scheduled_for"]
    assert len(scheduled) == 1
    assert not started


def test_project_sync_queues_until_cooldown_expires(tmp_path: Path, monkeypatch):
    project_id = "project-b"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    manager = ProjectKnowledgeSyncManager(
        tmp_path,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    config = Config().knowledge
    source = _build_source(project_id, project_dir)

    state = manager.get_state(project_id)
    state["last_finished_at"] = datetime.now(UTC).isoformat()
    manager._save_state(state)

    scheduled: list[datetime] = []
    started: list[dict] = []

    monkeypatch.setattr(
        manager,
        "_schedule_dispatch",
        lambda run_at, **_: scheduled.append(run_at),
    )
    monkeypatch.setattr(
        manager,
        "_start_worker",
        lambda **kwargs: started.append(kwargs),
    )

    result = manager.start_sync(
        project_id=project_id,
        config=config,
        running_config=None,
        source=source,
        trigger="project_upload",
        changed_paths=["upload/file.md"],
        auto_enabled=True,
        force=False,
        debounce_seconds=0,
        cooldown_seconds=10,
    )

    state = manager.get_state(project_id)
    assert result["accepted"] is True
    assert result["reason"] == "QUEUED"
    assert state["status"] == "queued"
    assert state["current_stage"] == "cooldown"
    assert state["scheduled_for"]
    assert len(scheduled) == 1
    assert not started


def test_project_sync_queues_follow_up_after_active_run(tmp_path: Path, monkeypatch):
    project_id = "project-c"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    manager = ProjectKnowledgeSyncManager(
        tmp_path,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    config = Config().knowledge
    source = _build_source(project_id, project_dir)

    state = manager.get_state(project_id)
    state.update(
        {
            "status": "pending",
            "current_stage": "pending",
            "dirty_after_run": True,
            "pending_changed_paths": ["original/note.md"],
            "debounce_seconds": 4,
            "cooldown_seconds": 0,
            "last_change_at": datetime.now(UTC).isoformat(),
        }
    )
    manager._save_state(state)

    scheduled: list[datetime] = []
    restarted: list[dict] = []

    monkeypatch.setattr(
        manager,
        "_schedule_dispatch",
        lambda run_at, **_: scheduled.append(run_at),
    )
    monkeypatch.setattr(
        manager,
        "_start_worker",
        lambda **kwargs: restarted.append(kwargs),
    )
    monkeypatch.setattr(
        manager._knowledge_manager,
        "index_source",
        lambda *_args, **_kwargs: {"indexed": True},
    )
    monkeypatch.setattr(
        manager._graph_ops,
        "execute_memify_once",
        lambda **_kwargs: {"status": "succeeded", "job_id": "job-1"},
    )

    manager._run_sync_loop(
        project_id=project_id,
        config=config,
        running_config=None,
        source=source,
    )

    state = manager.get_state(project_id)
    assert state["status"] == "queued"
    assert state["current_stage"] == "debouncing"
    assert state["dirty"] is True
    assert state["dirty_after_run"] is False
    assert state["pending_changed_paths"] == []
    assert "original/note.md" in state["changed_paths"]
    assert len(scheduled) == 1
    assert not restarted


def test_project_sync_recovers_stale_active_state_and_restarts(tmp_path: Path, monkeypatch):
    project_id = "project-d"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    manager = ProjectKnowledgeSyncManager(
        tmp_path,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    config = Config().knowledge
    source = _build_source(project_id, project_dir)

    stale_time = (datetime.now(UTC) - timedelta(seconds=300)).isoformat()
    state = manager.get_state(project_id)
    state.update(
        {
            "status": "indexing",
            "current_stage": "indexing",
            "progress": 20,
            "updated_at": stale_time,
            "last_started_at": stale_time,
            "last_error": "",
        }
    )
    manager.state_path.parent.mkdir(parents=True, exist_ok=True)
    manager.state_path.write_text(json.dumps(state), encoding="utf-8")

    started: list[dict] = []
    monkeypatch.setattr(
        manager,
        "_start_worker",
        lambda **kwargs: started.append(kwargs),
    )

    result = manager.start_sync(
        project_id=project_id,
        config=config,
        running_config=None,
        source=source,
        trigger="manual-restart",
        changed_paths=["original/restart.md"],
        auto_enabled=True,
        force=True,
    )

    state = manager.get_state(project_id)
    assert result["accepted"] is True
    assert result["reason"] == "STARTED"
    assert state["status"] == "pending"
    assert state["last_error"] == ""
    assert started


def test_project_sync_auto_triggers_quality_loop_after_memify_success(tmp_path: Path, monkeypatch):
    project_id = "project-e"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    manager = ProjectKnowledgeSyncManager(
        tmp_path,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    config = Config().knowledge
    config.memify_enabled = True
    source = _build_source(project_id, project_dir)

    orchestrator_calls: list[dict] = []

    monkeypatch.setattr(
        "qwenpaw.app.knowledge_workflow.KnowledgeWorkflowOrchestrator.run",
        lambda self, **kwargs: orchestrator_calls.append(kwargs) or {
            "run_id": "run-quality-1",
            "run_status": "succeeded",
            "template_id": "builtin-knowledge-processing-v1",
            "processing_fingerprint": "fp-quality-1",
            "latest_job_id": "quality-job-1",
            "index": {"document_count": 4, "chunk_count": 8},
            "memify": {
                "status": "succeeded",
                "job_id": "memify-job-1",
                "relation_count": 24,
                "node_count": 12,
                "document_count": 4,
                "enrichment_metrics": {
                    "edge_count": 24,
                    "node_count": 12,
                },
            },
            "quality_loop": {
                "accepted": True,
                "job_id": "quality-job-1",
                "status_url": "/knowledge/quality-loop/jobs/quality-job-1",
            },
        },
    )

    manager._run_sync_loop(
        project_id=project_id,
        config=config,
        running_config=None,
        source=source,
    )

    state = manager.get_state(project_id)
    assert state["status"] == "succeeded"
    assert orchestrator_calls
    assert orchestrator_calls[0]["source"].id == source.id
    assert orchestrator_calls[0]["trigger"] == "project-sync"
    assert state["last_result"]["quality_loop"]["accepted"] is True
    assert state["last_result"]["quality_loop"]["job_id"] == "quality-job-1"


def test_check_needs_reindex_true_when_no_recorded_fingerprint(tmp_path: Path):
    project_id = "project-f"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    manager = ProjectKnowledgeSyncManager(
        tmp_path,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    config = Config().knowledge

    # No completed run yet: recorded fingerprint is empty.
    assert manager.check_needs_reindex(
        project_id=project_id,
        config=config,
        running_config=None,
    ) is True


def test_check_needs_reindex_false_after_fingerprint_recorded(tmp_path: Path, monkeypatch):
    project_id = "project-g"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    manager = ProjectKnowledgeSyncManager(
        tmp_path,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    config = Config().knowledge
    source = _build_source(project_id, project_dir)

    monkeypatch.setattr(
        manager._knowledge_manager,
        "index_source",
        lambda *_args, **_kwargs: {"indexed": True},
    )
    monkeypatch.setattr(
        manager._graph_ops,
        "execute_memify_once",
        lambda **_kwargs: {
            "status": "succeeded",
            "job_id": "memify-job-fp",
        },
    )

    manager._run_sync_loop(
        project_id=project_id,
        config=config,
        running_config=None,
        source=source,
    )

    assert manager.check_needs_reindex(
        project_id=project_id,
        config=config,
        running_config=None,
    ) is False


def test_processing_mode_overrides_take_precedence_during_active_run(tmp_path: Path):
    project_id = "project-h"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    manager = ProjectKnowledgeSyncManager(
        tmp_path,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )

    state = manager.get_state(project_id)
    state.update(
        {
            "status": "graphifying",
            "current_stage": "graphifying",
            "last_result": {
                "index": {"document_count": 3, "chunk_count": 7},
                "memify": {"relation_count": 12, "node_count": 5},
                "workflow_run": {"run_id": "run-h", "status": "pending"},
            },
            "processing_mode_overrides": {
                "fast": {
                    "status": "ready",
                    "available": True,
                    "stage": "Fast preview ready",
                },
                "nlp": {
                    "status": "running",
                    "available": False,
                    "progress": 62,
                    "stage": "Building NLP graph artifacts",
                },
                "agentic": {
                    "status": "queued",
                    "available": False,
                    "stage": "Waiting for review stage",
                },
            },
        }
    )
    manager._save_state(state)

    hydrated = manager.get_state(project_id)
    modes = {item["mode"]: item for item in hydrated["processing_modes"]}

    assert modes["fast"]["status"] == "ready"
    assert modes["nlp"]["status"] == "running"
    assert modes["nlp"]["progress"] == 62
    assert modes["agentic"]["status"] == "queued"
    assert hydrated["output_scheduler"]["running_modes"] == ["nlp"]
    assert hydrated["output_scheduler"]["queued_modes"] == ["agentic"]
    assert hydrated["mode_metrics"]["fast"]["document_count"] == 3
    assert hydrated["mode_metrics"]["nlp"]["relation_count"] == 12
    assert hydrated["global_metrics"]["document_count"] == 3


def test_project_sync_state_exposes_idle_semantic_engine_before_source_ready(tmp_path: Path):
    project_id = "project-i"
    manager = ProjectKnowledgeSyncManager(
        tmp_path,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )

    state = manager.get_state(project_id)

    assert state["semantic_engine"]["engine"] == "hanlp2"
    assert state["semantic_engine"]["status"] == "idle"
    assert state["semantic_engine"]["reason_code"] == "SOURCE_NOT_READY"
    assert state["semantic_engine"]["summary"] == "Semantic engine waiting for project source registration."


def test_project_sync_state_mirrors_semantic_engine_after_source_selected(tmp_path: Path, monkeypatch):
    project_id = "project-j"
    manager = ProjectKnowledgeSyncManager(
        tmp_path,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )

    monkeypatch.setattr(
        manager._knowledge_manager,
        "get_semantic_engine_state",
        lambda: {
            "engine": "hanlp2",
            "status": "error",
            "reason_code": "HANLP2_TOKENIZE_FAILED",
            "reason": "HanLP2 semantic tokenization failed via tok: RuntimeError.",
        },
    )

    state = manager.get_state(project_id)
    state["latest_source_id"] = f"project-{project_id}-workspace"
    manager._save_state(state)

    hydrated = manager.get_state(project_id)

    assert hydrated["semantic_engine"]["status"] == "error"
    assert hydrated["semantic_engine"]["reason_code"] == "HANLP2_TOKENIZE_FAILED"
    assert hydrated["semantic_engine"]["summary"] == "Semantic engine error: HanLP2 tokenization failed."


def test_project_sync_stage_message_merges_semantic_summary(tmp_path: Path, monkeypatch):
    project_id = "project-k"
    manager = ProjectKnowledgeSyncManager(
        tmp_path,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )

    monkeypatch.setattr(
        manager._knowledge_manager,
        "get_semantic_engine_state",
        lambda: {
            "engine": "hanlp2",
            "status": "unavailable",
            "reason_code": "HANLP2_IMPORT_UNAVAILABLE",
            "reason": "HanLP2 module is not installed or failed to import.",
        },
    )

    state = manager.get_state(project_id)
    state["latest_source_id"] = f"project-{project_id}-workspace"
    state["stage_message"] = "Project sync pending"
    manager._save_state(state)

    hydrated = manager.get_state(project_id)

    assert hydrated["stage_message"] == (
        "Project sync pending · Semantic engine unavailable: HanLP2 module is not installed."
    )


def test_project_sync_processing_modes_block_when_semantic_engine_unavailable(tmp_path: Path, monkeypatch):
    project_id = "project-l"
    manager = ProjectKnowledgeSyncManager(
        tmp_path,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )

    monkeypatch.setattr(
        manager._knowledge_manager,
        "get_semantic_engine_state",
        lambda: {
            "engine": "hanlp2",
            "status": "unavailable",
            "reason_code": "HANLP2_SIDECAR_UNCONFIGURED",
            "reason": "HanLP2 sidecar is not configured.",
        },
    )

    state = manager.get_state(project_id)
    state["latest_source_id"] = f"project-{project_id}-workspace"
    state["last_result"] = {
        "index": {"document_count": 1, "chunk_count": 4},
        "memify": {"node_count": 12, "relation_count": 18},
        "workflow_run": {"status": "succeeded", "mode": "agentic", "run_id": "run-blocked"},
    }
    manager._save_state(state)

    hydrated = manager.get_state(project_id)
    modes = {item["mode"]: item for item in hydrated["processing_modes"]}

    assert modes["fast"]["status"] == "ready"
    assert modes["nlp"]["status"] == "blocked"
    assert modes["nlp"]["available"] is False
    assert "HanLP sidecar is not configured" in modes["nlp"]["summary"]
    assert modes["agentic"]["status"] == "blocked"
    assert modes["agentic"]["available"] is False
    assert hydrated["output_resolution"]["available_modes"] == []
    assert hydrated["output_resolution"]["reason_code"] == "SEMANTIC_ENGINE_UNAVAILABLE"
    assert hydrated["output_scheduler"]["ready_modes"] == ["fast"]