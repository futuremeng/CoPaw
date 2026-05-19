# -*- coding: utf-8 -*-

import json
import sys
import types
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

from copaw.config.config import Config, KnowledgeSourceSpec
from copaw.knowledge import project_sync_dispatch
from copaw.knowledge.project_sync_manager import ProjectKnowledgeSyncManager


def test_run_sync_loop_failure_preserves_l2_snapshot(tmp_path: Path, monkeypatch):
    project_id = "project-sync-failure-preserve"
    source_id = "project-source-1"
    manager = ProjectKnowledgeSyncManager(tmp_path, knowledge_dirname="knowledge")

    state = manager._default_state(project_id)
    state["latest_source_id"] = source_id
    state["l2_progress"] = {
        "total_chunks": 8,
        "cor_done_chunks": 3,
        "ner_done_chunks": 6,
        "syntax_done_chunks": 4,
    }
    state["l2_metrics"] = {
        "cor_ready_chunk_count": 3,
        "ner_ready_chunk_count": 6,
        "ner_entity_count": 17,
        "syntax_ready_chunk_count": 4,
        "syntax_relation_count": 9,
    }
    manager._save_state(state)

    fake_workflow_module = types.ModuleType("qwenpaw.app.knowledge_workflow")

    class _FailingOrchestrator:
        def __init__(self, *args, **kwargs):
            pass

        def run(self, **kwargs):
            raise RuntimeError("boom")

    fake_workflow_module.KnowledgeWorkflowOrchestrator = _FailingOrchestrator
    monkeypatch.setitem(sys.modules, "qwenpaw.app.knowledge_workflow", fake_workflow_module)

    source = KnowledgeSourceSpec(
        id=source_id,
        name="Project Workspace",
        type="directory",
        location=str(tmp_path),
        content="",
        enabled=True,
        recursive=True,
        tags=["project"],
        summary="",
    )

    manager._run_sync_loop(
        project_id=project_id,
        config=Config().knowledge,
        running_config=None,
        source=source,
        processing_mode="agentic",
    )

    failed_state = manager._load_state(project_id, hydrate=False)
    assert failed_state["status"] == "failed"
    assert failed_state["l2_progress"] == {
        "total_chunks": 8,
        "cor_done_chunks": 3,
        "ner_done_chunks": 6,
        "syntax_done_chunks": 4,
    }
    assert failed_state["l2_metrics"]["ner_entity_count"] == 17
    assert failed_state["l2_metrics"]["syntax_relation_count"] == 9
    assert str(failed_state.get("failed_stage") or "").strip() == "pending"


def test_build_pipeline_trace_includes_stage_artifacts(tmp_path: Path):
    manager = ProjectKnowledgeSyncManager(tmp_path, knowledge_dirname="knowledge")

    trace = manager._build_pipeline_trace(  # type: ignore[attr-defined]
        {
            "latest_source_id": "project-source-1",
            "updated_at": "2026-05-10T10:00:00Z",
        },
        [
            {"mode": "fast", "status": "ready", "available": True, "summary": "L1 ready"},
            {"mode": "nlp", "status": "ready", "available": True, "summary": "L2 ready"},
            {"mode": "agentic", "status": "blocked", "available": False, "summary": "L3 pending"},
        ],
        {
            "fast": {
                "mode": "fast",
                "source": "indexed-preview",
                "summary_lines": ["Documents: 2", "Chunks: 4"],
                "artifacts": [{"kind": "index", "label": "Index", "path": "projects/p1/.knowledge/index.json"}],
            },
            "nlp": {
                "mode": "nlp",
                "source": "graph-artifacts",
                "summary_lines": ["Document graphify payloads: 1"],
                "artifacts": [
                    {"kind": "ner_stats", "label": "NER stats", "path": "projects/p1/.knowledge/ner-stats.json"},
                ],
            },
            "agentic": {
                "mode": "agentic",
                "source": "pipeline-artifacts",
                "summary_lines": ["Run: run-1"],
                "artifacts": [],
            },
        },
        {"document_count": 2, "chunk_count": 4, "snapshot_count": 1},
        {
            "total_chunks": 4,
            "ner_ready_chunk_count": 3,
            "syntax_ready_chunk_count": 2,
            "cor_ready_chunk_count": 1,
            "ner_entity_count": 8,
            "syntax_token_count": 21,
            "syntax_pos_count": 19,
            "syntax_pos_tag_type_count": 7,
            "pos_coverage_on_syntax_tokens": 0.9048,
            "pos_coverage_on_document_tokens": 0.76,
            "syntax_relation_count": 5,
        },
        {"entity_count": 10, "relation_count": 4, "quality_score": 0.8},
    )

    assert trace["source_id"] == "project-source-1"
    assert len(trace["stages"]) == 3
    assert trace["stages"][1]["label"] == "L2 · NLP"
    assert trace["stages"][1]["metrics"]["ner_entity_count"] == 8
    assert trace["stages"][1]["metrics"]["syntax_pos_count"] == 19
    assert trace["stages"][1]["metrics"]["syntax_pos_tag_type_count"] == 7
    assert trace["stages"][1]["metrics"]["pos_coverage_on_syntax_tokens"] == 0.9048
    assert trace["stages"][1]["artifacts"][0]["kind"] == "ner_stats"


def test_build_nlp_progress_contains_phrase_placeholder_stage(tmp_path: Path):
    manager = ProjectKnowledgeSyncManager(tmp_path, knowledge_dirname="knowledge")

    payload = manager._build_nlp_progress(  # type: ignore[attr-defined]
        [
            {
                "mode": "nlp",
                "status": "ready",
                "stage": "Extraction done",
                "summary": "NLP complete",
            },
        ],
        {
            "metrics_updated_at": "2026-05-10T10:00:00Z",
            "total_chunks": 6,
            "ner_done_chunks": 6,
            "ner_ready_chunk_count": 6,
            "ner_entity_count": 12,
            "syntax_done_chunks": 6,
            "syntax_ready_chunk_count": 6,
            "syntax_sentence_count": 18,
            "syntax_token_count": 120,
            "syntax_pos_count": 118,
            "syntax_relation_count": 42,
            "cor_done_chunks": 0,
            "cor_ready_chunk_count": 0,
            "cor_reason_code": "HANLP_TASK_READY",
            "cor_reason": "optional",
        },
    )

    phrase_stage = (payload.get("stages") or {}).get("phrase")
    assert isinstance(phrase_stage, dict)
    assert phrase_stage.get("status") == "unavailable"
    assert phrase_stage.get("reason_code") == "PHRASE_LAYER_NOT_IMPLEMENTED"


def test_project_sync_start_captures_task_aware_semantic_engine_state(tmp_path: Path, monkeypatch):
    project_id = "project-semantic-state"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    manager = ProjectKnowledgeSyncManager(
        tmp_path,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    config = Config().knowledge
    source = KnowledgeSourceSpec(
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

    monkeypatch.setattr(
        manager._knowledge_manager,
        "get_semantic_engine_state",
        lambda _config=None: {
            "engine": "hanlp2",
            "status": "unavailable",
            "reason_code": "HANLP_TASK_UNAVAILABLE",
            "reason": "NER model is unavailable.",
        },
    )
    monkeypatch.setattr(
        manager._knowledge_manager,
        "get_semantic_task_state",
        lambda task_key, _config=None: {
            "engine": "hanlp2",
            "task_key": task_key,
            "status": "ready" if task_key == "tokenize" else "unavailable",
            "reason_code": "HANLP_TASK_READY" if task_key == "tokenize" else "HANLP_TASK_UNAVAILABLE",
            "reason": "tokenize ready" if task_key == "tokenize" else "NER model is unavailable.",
        },
    )

    scheduled: list[datetime] = []
    monkeypatch.setattr(manager, "_schedule_dispatch", lambda run_at, **_: scheduled.append(run_at))
    monkeypatch.setattr(manager, "_start_worker", lambda **_: None)

    manager.start_sync(
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
    semantic_engine = state.get("semantic_engine") or {}
    assert semantic_engine.get("status") == "unavailable"
    assert semantic_engine.get("task_states", {}).get("tokenize", {}).get("status") == "ready"
    assert scheduled


def test_build_processing_modes_keeps_nlp_queued_when_tokenize_task_is_ready(tmp_path: Path):
    manager = ProjectKnowledgeSyncManager(tmp_path, knowledge_dirname="knowledge")

    semantic_engine = {
        "engine": "hanlp2",
        "status": "unavailable",
        "reason_code": "HANLP_TASK_UNAVAILABLE",
        "reason": "NER model is unavailable.",
        "summary": "Semantic engine unavailable: NER model is unavailable.",
        "task_states": {
            "tokenize": {
                "engine": "hanlp2",
                "task_key": "tokenize",
                "status": "ready",
                "reason_code": "HANLP_TASK_READY",
                "reason": "Tokenize task ready.",
            }
        },
    }

    processing_modes = manager._build_processing_modes(  # type: ignore[attr-defined]
        {"progress": 0, "last_result": {}},
        {"document_count": 1, "chunk_count": 1},
        semantic_engine,
        {
            "tokenize_ready_chunk_count": 0,
            "ner_ready_chunk_count": 0,
            "syntax_ready_chunk_count": 0,
            "ner_entity_count": 0,
            "syntax_relation_count": 0,
        },
    )
    nlp_mode = next(item for item in processing_modes if item.get("mode") == "nlp")
    agentic_mode = next(item for item in processing_modes if item.get("mode") == "agentic")
    resolution = manager._build_output_resolution(processing_modes, semantic_engine)  # type: ignore[attr-defined]

    assert nlp_mode["status"] == "queued"
    assert agentic_mode["status"] == "queued"
    assert resolution["reason_code"] == "HIGH_ORDER_PENDING"


def test_build_semantic_engine_state_prefers_current_snapshot(tmp_path: Path, monkeypatch):
    manager = ProjectKnowledgeSyncManager(tmp_path, knowledge_dirname="knowledge")

    monkeypatch.setattr(
        manager._knowledge_manager,
        "get_semantic_engine_state",
        lambda *_args, **_kwargs: {
            "engine": "hanlp2",
            "status": "unavailable",
            "reason_code": "NLP_ENGINE_UNAVAILABLE",
            "reason": "NLP semantic engine is not configured.",
        },
    )

    payload = manager._build_semantic_engine_state(
        {
            "project_id": "project-current-semantic",
            "latest_source_id": "project-source-1",
            "updated_at": "2026-05-12T10:00:00Z",
            "semantic_engine": {
                "engine": "hanlp2",
                "status": "ready",
                "reason_code": "HANLP_TASK_READY",
                "reason": "HanLP task is ready.",
                "task_states": {
                    "tokenize": {
                        "engine": "hanlp2",
                        "status": "ready",
                        "reason_code": "HANLP_TASK_READY",
                        "reason": "HanLP task is ready.",
                    }
                },
            },
        }
    )

    assert payload["status"] == "ready"
    assert payload["task_states"]["tokenize"]["status"] == "ready"


def test_dispatch_scheduled_sync_uses_workspace_agent_config(tmp_path: Path, monkeypatch):
    project_id = "project-scheduled-config"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    manager = ProjectKnowledgeSyncManager(
        tmp_path,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )

    state = manager.get_state(project_id)
    state.update({
        "latest_requested_mode": "nlp",
        "quantization_stage": "l2",
    })
    manager._save_state(state)

    started: list[dict[str, object]] = []
    monkeypatch.setattr(manager, "_start_worker", lambda **kwargs: started.append(kwargs))

    root_config = Config()
    root_config.knowledge.hanlp.enabled = False
    root_config.knowledge.hanlp.python_executable = ""
    root_config.agents.profiles = {
        "default": SimpleNamespace(workspace_dir=str(tmp_path)),
    }
    agent_running = SimpleNamespace(
        knowledge_enabled=True,
        knowledge_chunk_size=1200,
    )
    agent_config = SimpleNamespace(running=agent_running)

    monkeypatch.setattr(project_sync_dispatch, "load_config", lambda: root_config)
    monkeypatch.setattr(project_sync_dispatch, "load_agent_config", lambda _agent_id: agent_config)

    project_sync_dispatch.dispatch_scheduled_sync(manager, project_id=project_id)

    assert started
    scheduled_config = started[0]["config"]
    assert getattr(scheduled_config.hanlp, "enabled", None) is False
    assert getattr(scheduled_config, "index").chunk_size == 1200
    assert started[0]["running_config"] is agent_running


def test_hydrate_processing_view_uses_project_file_analysis_stats(tmp_path: Path):
    project_id = "project-file-analysis-stats"
    project_root = tmp_path / "projects" / project_id
    project_root.mkdir(parents=True, exist_ok=True)
    stats_dir = project_root / ".knowledge" / "stats" / "file_analysis"
    stats_dir.mkdir(parents=True, exist_ok=True)
    (stats_dir / "latest.json").write_text(
        json.dumps(
            {
                "project_id": project_id,
                "source_id": "project-source-1",
                "step_id": "file_analysis",
                "indexed_at": "2026-05-12T10:00:00Z",
                "updated_at": "2026-05-12T10:00:01Z",
                "metrics": {
                    "document_count": 3,
                    "snapshot_count": 3,
                    "chunk_count": 5,
                    "sentence_count": 8,
                    "char_count": 21,
                    "token_count": 13,
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    manager = ProjectKnowledgeSyncManager(tmp_path, knowledge_dirname="knowledge")
    manager._knowledge_manager.get_source_status = lambda *args, **kwargs: {}  # type: ignore[method-assign]

    hydrated = manager._hydrate_processing_view(
        {
            "project_id": project_id,
            "latest_source_id": "project-source-1",
            "status": "idle",
            "updated_at": "2026-05-12T10:00:02Z",
            "last_result": {},
        }
    )

    assert hydrated["file_analysis_stats"]["project_id"] == project_id
    assert hydrated["l1_metrics"]["document_count"] == 3
    assert hydrated["global_metrics"]["snapshot_count"] == 3
    assert hydrated["mode_metrics"]["fast"]["chunk_count"] == 5
