# -*- coding: utf-8 -*-

import sys
import types
from pathlib import Path

from copaw.config.config import Config, KnowledgeSourceSpec
from copaw.knowledge.project_knowledge_sync import ProjectKnowledgeSyncManager


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
                "source": "workflow-artifacts",
                "summary_lines": ["Run: run-1"],
                "artifacts": [],
            },
        },
        {
            "fast": {"mode": "fast", "document_count": 2, "chunk_count": 4, "artifact_count": 1, "quality_score": 0.5},
            "nlp": {"mode": "nlp", "document_count": 2, "chunk_count": 4, "entity_count": 8, "relation_count": 5, "artifact_count": 2},
            "agentic": {"mode": "agentic", "document_count": 2, "chunk_count": 4, "entity_count": 10, "relation_count": 4, "quality_score": 0.8},
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
            "cor_reason_code": "HANLP2_TASK_READY",
            "cor_reason": "optional",
        },
    )

    phrase_stage = (payload.get("stages") or {}).get("phrase")
    assert isinstance(phrase_stage, dict)
    assert phrase_stage.get("status") == "unavailable"
    assert phrase_stage.get("reason_code") == "PHRASE_LAYER_NOT_IMPLEMENTED"
