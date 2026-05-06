# -*- coding: utf-8 -*-

import sys
import types
from pathlib import Path

from copaw.config.config import Config, KnowledgeSourceSpec
from copaw.knowledge.project_sync import ProjectKnowledgeSyncManager


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
