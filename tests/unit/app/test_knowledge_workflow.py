# -*- coding: utf-8 -*-

from pathlib import Path
from types import SimpleNamespace

from copaw.config.config import KnowledgeConfig, KnowledgeSourceSpec
from copaw.knowledge.project_sync import ProjectKnowledgeSyncManager
from qwenpaw.app.knowledge_workflow import (
    KNOWLEDGE_WORKFLOW_TEMPLATE_ID,
    KnowledgeWorkflowOrchestrator,
)
from qwenpaw.app.routers.agents_pipeline_core import _load_project_pipeline_run


def _write_project_metadata(project_dir: Path, project_id: str) -> None:
    metadata_dir = project_dir / ".agent"
    metadata_dir.mkdir(parents=True, exist_ok=True)
    (metadata_dir / "PROJECT.md").write_text(
        "\n".join(
            [
                "---",
                f"id: {project_id}",
                "name: Knowledge Project",
                "description: Project for testing knowledge workflow",
                "---",
                "",
                "# Knowledge Project",
            ]
        ),
        encoding="utf-8",
    )


def _build_source(project_dir: Path, project_id: str) -> KnowledgeSourceSpec:
    return KnowledgeSourceSpec(
        id=f"project-{project_id}-workspace",
        name="Project Workspace",
        type="directory",
        location=str(project_dir),
        content="",
        enabled=True,
        recursive=True,
        project_id=project_id,
        tags=["project"],
        summary="",
    )


def test_knowledge_workflow_orchestrator_persists_pipeline_run(
    tmp_path: Path,
    monkeypatch,
):
    project_id = "project-abc"
    project_dir = tmp_path / "projects" / project_id
    data_dir = project_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    _write_project_metadata(project_dir, project_id)
    (data_dir / "sample.md").write_text("# Sample\n\nKnowledge workflow content.", encoding="utf-8")

    def fake_execute_memify_once(self, **kwargs):
        if kwargs.get("progress_callback") is not None:
            kwargs["progress_callback"](
                {
                    "progress": 76,
                    "stage_message": "Building graph",
                    "current": 1,
                    "total": 2,
                }
            )
        self.local_graph_path.parent.mkdir(parents=True, exist_ok=True)
        self.local_graph_path.write_text('{"nodes": [], "edges": []}', encoding="utf-8")
        self.enriched_graph_path.write_text('{"nodes": [], "edges": []}', encoding="utf-8")
        self.enrichment_quality_report_path.write_text('{"quality_score": 0.95}', encoding="utf-8")
        return {
            "status": "succeeded",
            "relation_count": 3,
            "node_count": 2,
            "document_count": 1,
            "graph_path": str(self.local_graph_path),
            "enriched_graph_path": str(self.enriched_graph_path),
            "enrichment_quality_report_path": str(self.enrichment_quality_report_path),
        }

    monkeypatch.setattr(
        "copaw.knowledge.graph_ops.GraphOpsManager.execute_memify_once",
        fake_execute_memify_once,
    )
    monkeypatch.setattr(
        "copaw.knowledge.graph_ops.GraphOpsManager.maybe_start_quality_self_drive",
        lambda self, **kwargs: {
            "accepted": False,
            "reason": "QUALITY_TARGET_MET",
            "score_before": 0.95,
            "score_after": 0.95,
            "delta": 0.0,
            "rounds": [],
        },
    )

    orchestrator = KnowledgeWorkflowOrchestrator(
        workspace_dir=tmp_path,
        project_id=project_id,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    source = _build_source(project_dir, project_id)
    config = KnowledgeConfig(enabled=True, memify_enabled=True)
    running_config = SimpleNamespace(knowledge_chunk_size=500)

    result = orchestrator.run(
        config=config,
        running_config=running_config,
        source=source,
        trigger="manual-panel",
        changed_paths=["data/sample.md"],
    )

    template_path = project_dir / "pipelines" / "templates" / f"{KNOWLEDGE_WORKFLOW_TEMPLATE_ID}.json"
    assert template_path.exists()

    run = _load_project_pipeline_run(project_dir, result["run_id"])
    assert run.status == "succeeded"
    assert run.template_id == KNOWLEDGE_WORKFLOW_TEMPLATE_ID
    assert any(step.id == "quality_review" and step.status == "succeeded" for step in run.steps)
    assert ".knowledge/graphify-out/graph.json" in run.artifacts
    assert ".knowledge/graphify-out/graph.enriched.json" in run.artifacts


def test_project_sync_manager_records_workflow_run_metadata(
    tmp_path: Path,
    monkeypatch,
):
    project_id = "project-xyz"
    project_dir = tmp_path / "projects" / project_id
    (project_dir / "data").mkdir(parents=True, exist_ok=True)
    _write_project_metadata(project_dir, project_id)
    (project_dir / "data" / "sample.md").write_text("# Sample", encoding="utf-8")

    manager = ProjectKnowledgeSyncManager(
        tmp_path,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    source = _build_source(project_dir, project_id)
    config = KnowledgeConfig(enabled=True, memify_enabled=True)

    monkeypatch.setattr(
        manager,
        "_start_worker",
        lambda **kwargs: manager._run_sync_loop(**kwargs),
    )
    monkeypatch.setattr(
        "qwenpaw.app.knowledge_workflow.KnowledgeWorkflowOrchestrator.run",
        lambda self, **kwargs: {
            "run_id": "run-knowledge-123",
            "run_status": "succeeded",
            "processing_mode": kwargs.get("processing_mode") or "agentic",
            "template_id": KNOWLEDGE_WORKFLOW_TEMPLATE_ID,
            "processing_fingerprint": "fp-123",
            "latest_job_id": "job-123",
            "index": {"document_count": 1},
            "memify": {"status": "succeeded"},
            "quality_loop": {"accepted": False, "reason": "QUALITY_TARGET_MET"},
        },
    )

    response = manager.start_sync(
        project_id=project_id,
        config=config,
        running_config=SimpleNamespace(knowledge_chunk_size=500),
        source=source,
        trigger="manual-panel",
        changed_paths=["data/sample.md"],
        auto_enabled=True,
        force=True,
    )

    assert response["accepted"] is True
    state = manager.get_state(project_id)
    assert state["status"] == "succeeded"
    assert state["latest_workflow_run_id"] == "run-knowledge-123"
    assert state["indexed_processing_fingerprint"] == "fp-123"
    assert state["last_result"]["workflow_run"]["template_id"] == KNOWLEDGE_WORKFLOW_TEMPLATE_ID
    assert state["last_result"]["workflow_run"]["mode"] == "agentic"
    assert [item["mode"] for item in state["processing_modes"]] == ["fast", "nlp", "agentic"]
    assert state["processing_modes"][0]["available"] is True
    assert state["processing_modes"][1]["available"] is False
    assert state["processing_modes"][2]["available"] is True
    assert state["active_output_resolution"]["active_mode"] == "agentic"
    assert state["active_output_resolution"]["fallback_chain"] == ["agentic", "nlp", "fast"]
    assert state["active_output_resolution"]["reason_code"] == "HIGHEST_LAYER_READY"
    assert state["active_output_resolution"]["skipped_modes"] == []
    assert state["processing_scheduler"]["strategy"] == "parallel"
    assert state["processing_scheduler"]["consumption_mode"] == "agentic"
    assert state["processing_scheduler"]["ready_modes"] == ["agentic", "fast"]
    assert state["processing_scheduler"]["next_mode"] == "nlp"
    assert state["mode_outputs"]["fast"]["source"] == "indexed-preview"
    assert state["mode_outputs"]["nlp"]["source"] == "graph-artifacts"
    assert state["mode_outputs"]["agentic"]["source"] == "workflow-artifacts"


def test_knowledge_workflow_orchestrator_fast_mode_stops_before_memify(
    tmp_path: Path,
    monkeypatch,
):
    project_id = "project-fast-only"
    project_dir = tmp_path / "projects" / project_id
    data_dir = project_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    _write_project_metadata(project_dir, project_id)
    (data_dir / "sample.md").write_text("# Sample\n\nKnowledge workflow content.", encoding="utf-8")

    called = {"memify": False}

    def fake_execute_memify_once(self, **kwargs):
        called["memify"] = True
        return {"status": "succeeded"}

    monkeypatch.setattr(
        "copaw.knowledge.graph_ops.GraphOpsManager.execute_memify_once",
        fake_execute_memify_once,
    )

    orchestrator = KnowledgeWorkflowOrchestrator(
        workspace_dir=tmp_path,
        project_id=project_id,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    source = _build_source(project_dir, project_id)
    config = KnowledgeConfig(enabled=True, memify_enabled=True)
    running_config = SimpleNamespace(knowledge_chunk_size=500)

    result = orchestrator.run(
        config=config,
        running_config=running_config,
        source=source,
        trigger="manual-panel",
        changed_paths=["data/sample.md"],
        processing_mode="fast",
    )

    assert result["processing_mode"] == "fast"
    assert result["memify"] == {}
    assert result["quality_loop"] == {}
    assert called["memify"] is False


def test_knowledge_workflow_status_callback_emits_lane_ready_transitions(
    tmp_path: Path,
    monkeypatch,
):
    project_id = "project-callbacks"
    project_dir = tmp_path / "projects" / project_id
    data_dir = project_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    _write_project_metadata(project_dir, project_id)
    (data_dir / "sample.md").write_text("# Sample\n\nKnowledge workflow content.", encoding="utf-8")

    def fake_execute_memify_once(self, **kwargs):
        if kwargs.get("progress_callback") is not None:
            kwargs["progress_callback"](
                {
                    "progress": 76,
                    "stage_message": "Building graph",
                    "current": 1,
                    "total": 2,
                }
            )
        self.local_graph_path.parent.mkdir(parents=True, exist_ok=True)
        self.local_graph_path.write_text('{"nodes": [], "edges": []}', encoding="utf-8")
        self.enriched_graph_path.write_text('{"nodes": [], "edges": []}', encoding="utf-8")
        self.enrichment_quality_report_path.write_text('{"quality_score": 0.95}', encoding="utf-8")
        return {
            "status": "succeeded",
            "relation_count": 3,
            "node_count": 2,
            "document_count": 1,
        }

    monkeypatch.setattr(
        "copaw.knowledge.graph_ops.GraphOpsManager.execute_memify_once",
        fake_execute_memify_once,
    )
    monkeypatch.setattr(
        "copaw.knowledge.graph_ops.GraphOpsManager.maybe_start_quality_self_drive",
        lambda self, **kwargs: {
            "accepted": False,
            "reason": "QUALITY_TARGET_MET",
            "score_before": 0.95,
            "score_after": 0.95,
            "delta": 0.0,
            "rounds": [],
        },
    )

    orchestrator = KnowledgeWorkflowOrchestrator(
        workspace_dir=tmp_path,
        project_id=project_id,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    source = _build_source(project_dir, project_id)
    config = KnowledgeConfig(enabled=True, memify_enabled=True)
    running_config = SimpleNamespace(knowledge_chunk_size=500)
    patches: list[dict] = []

    orchestrator.run(
        config=config,
        running_config=running_config,
        source=source,
        trigger="manual-panel",
        changed_paths=["data/sample.md"],
        status_callback=lambda patch: patches.append(dict(patch)),
    )

    assert any(
        patch.get("processing_mode_overrides", {}).get("fast", {}).get("status") == "ready"
        for patch in patches
    )
    assert any(
        patch.get("processing_mode_overrides", {}).get("nlp", {}).get("status") == "ready"
        for patch in patches
    )
    assert any(
        patch.get("processing_mode_overrides", {}).get("agentic", {}).get("status") == "ready"
        for patch in patches
    )