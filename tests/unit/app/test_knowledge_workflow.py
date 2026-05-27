# -*- coding: utf-8 -*-

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from copaw.config.config import KnowledgeConfig, KnowledgeSourceSpec
from copaw.knowledge.project_pipeline_manager import ProjectKnowledgePipelineManager
from qwenpaw.app.knowledge_workflow import (
    KNOWLEDGE_WORKFLOW_TEMPLATE_ID,
    KnowledgeWorkflowOrchestrator,
    _build_initial_run,
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


def _stub_semantic_materialization(monkeypatch) -> None:
    monkeypatch.setattr(
        "copaw.knowledge.manager.KnowledgeManager.materialize_semantic_artifacts_for_source",
        lambda self, *args, **kwargs: None,
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
    _stub_semantic_materialization(monkeypatch)

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

    template_path = project_dir / ".pipelines" / "templates" / f"{KNOWLEDGE_WORKFLOW_TEMPLATE_ID}.json"
    assert template_path.exists()

    run = _load_project_pipeline_run(project_dir, result["run_id"])
    assert run.status == "succeeded"
    assert run.template_id == KNOWLEDGE_WORKFLOW_TEMPLATE_ID
    # The 7-step NLP pipeline: all steps must have completed.
    run_step_ids = [step.id for step in run.steps]
    assert run_step_ids == [
        "snapshot_raw",
        "build_chunks",
        "build_interlinear",
        "tokenize",
        "pos_tagging",
        "syntax_parse",
        "semantic_role_labeling",
    ]
    assert all(step.status == "succeeded" for step in run.steps)
    assert run.steps[0].artifact_schema_ref == "knowledge/snapshot-manifest.v1"
    assert run.steps[0].outputs["snapshot_manifest_path"].endswith("snapshot-manifest.json")
    assert run.steps[1].metrics["resolved_inputs"]["snapshot_manifest_path"] == run.steps[0].outputs["snapshot_manifest_path"]
    assert run.steps[1].outputs["chunk_manifest_path"].endswith("chunk-manifest.json")
    assert run.steps[2].metrics["resolved_inputs"]["snapshot_manifest_path"] == run.steps[0].outputs["snapshot_manifest_path"]
    assert run.steps[2].outputs["interlinear_manifest_path"].endswith("interlinear-manifest.json")
    assert run.steps[3].metrics["resolved_inputs"]["interlinear_manifest_path"] == run.steps[2].outputs["interlinear_manifest_path"]
    assert run.steps[3].outputs["tokenize_manifest_path"].endswith("tokenize-manifest.json")
    assert run.steps[4].metrics["resolved_inputs"]["tokenize_manifest_path"] == run.steps[3].outputs["tokenize_manifest_path"]
    assert run.steps[5].metrics["resolved_inputs"]["tokenize_manifest_path"] == run.steps[3].outputs["tokenize_manifest_path"]
    assert run.steps[6].metrics["resolved_inputs"]["tokenize_manifest_path"] == run.steps[3].outputs["tokenize_manifest_path"]
    assert any(path.endswith("graphify-out/graph.enriched.json") for path in run.artifacts)
    assert (project_dir / ".knowledge" / "content.md").exists()
    assert (project_dir / ".knowledge" / "chunk-manifest.json").exists()
    assert not (project_dir / ".knowledge" / f"{source.id}--content.md").exists()
    assert not (project_dir / ".knowledge" / f"{source.id}--chunk-manifest.json").exists()


def test_project_pipeline_manager_records_pipeline_run_metadata(
    tmp_path: Path,
    monkeypatch,
):
    project_id = "project-xyz"
    project_dir = tmp_path / "projects" / project_id
    (project_dir / "data").mkdir(parents=True, exist_ok=True)
    _write_project_metadata(project_dir, project_id)
    (project_dir / "data" / "sample.md").write_text("# Sample", encoding="utf-8")

    manager = ProjectKnowledgePipelineManager(
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
    monkeypatch.setattr(
        manager._knowledge_manager,
        "get_semantic_engine_state",
        lambda *_args, **_kwargs: {
            "engine": "hanlp",
            "status": "ready",
            "reason_code": "HANLP_READY",
            "reason": "HanLP semantic engine is ready.",
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
    assert state["latest_pipeline_run_id"] == "run-knowledge-123"
    assert state["indexed_processing_fingerprint"] == "fp-123"
    assert state["last_result"]["pipeline_run"]["template_id"] == KNOWLEDGE_WORKFLOW_TEMPLATE_ID
    assert state["last_result"]["pipeline_run"]["mode"] == "agentic"
    assert [item["mode"] for item in state["processing_modes"]] == ["fast", "nlp", "agentic"]
    assert state["processing_modes"][0]["available"] is True
    assert state["processing_modes"][1]["available"] is False
    assert state["processing_modes"][2]["available"] is False
    assert state["output_resolution"]["active_mode"] == "agentic"
    assert state["output_resolution"]["fallback_chain"] == ["agentic", "nlp"]
    assert state["output_resolution"]["reason_code"] == "HIGH_ORDER_PENDING"
    assert state["output_resolution"]["skipped_modes"] == []
    assert state["output_scheduler"]["strategy"] == "parallel"
    assert state["output_scheduler"]["consumption_mode"] == "agentic"
    assert state["output_scheduler"]["ready_modes"] == ["fast"]
    assert state["output_scheduler"]["next_mode"] == "agentic"
    assert state["mode_outputs"]["fast"]["source"] == "indexed-preview"
    assert state["mode_outputs"]["nlp"]["source"] == "graph-artifacts"
    assert state["mode_outputs"]["agentic"]["source"] == "pipeline-artifacts"
    assert state["mode_metrics"]["fast"]["document_count"] == 0
    assert state["mode_metrics"]["nlp"]["entity_count"] == 0
    assert state["mode_metrics"]["agentic"].get("artifact_count", 0) == 0
    assert state["global_metrics"]["document_count"] == 0
    assert state["global_metrics"]["chunk_count"] == 0


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


def test_knowledge_workflow_quantization_stage_l2_runs_nlp_slice(
    tmp_path: Path,
    monkeypatch,
):
    project_id = "project-quant-l2"
    project_dir = tmp_path / "projects" / project_id
    data_dir = project_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    _write_project_metadata(project_dir, project_id)
    (data_dir / "sample.md").write_text("# Sample\n\nKnowledge workflow content.", encoding="utf-8")

    called = {"memify": False, "quality": False}

    def fake_execute_memify_once(self, **kwargs):
        called["memify"] = True
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
        lambda self, **kwargs: called.__setitem__("quality", True),
    )
    _stub_semantic_materialization(monkeypatch)

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
        quantization_stage="l2",
    )

    assert result["processing_mode"] == "nlp"
    assert result["quantization_stage"] == "l2"
    # nlp mode does NOT run graph ops; memify is agentic-only in the 7-step design.
    assert result["memify"] == {}
    assert called["memify"] is False


def test_knowledge_workflow_orchestrator_rejects_executor_drift_in_project_template(
    tmp_path: Path,
):
    project_id = "project-executor-drift"
    project_dir = tmp_path / "projects" / project_id
    data_dir = project_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    _write_project_metadata(project_dir, project_id)
    (data_dir / "sample.md").write_text("# Sample\n\nKnowledge workflow content.", encoding="utf-8")

    template_dir = project_dir / ".pipelines" / "templates"
    template_dir.mkdir(parents=True, exist_ok=True)
    template_path = template_dir / f"{KNOWLEDGE_WORKFLOW_TEMPLATE_ID}.json"
    template_doc = json.loads(
        (
            Path(__file__).resolve().parents[3]
            / "src"
            / "qwenpaw"
            / "app"
            / "pipelines"
            / f"{KNOWLEDGE_WORKFLOW_TEMPLATE_ID}.json"
        ).read_text(encoding="utf-8")
    )
    template_doc["steps"][0]["executor"] = "builtin:knowledge.invalid"
    template_path.write_text(json.dumps(template_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    with pytest.raises(RuntimeError, match="executor mismatch"):
        KnowledgeWorkflowOrchestrator(
            workspace_dir=tmp_path,
            project_id=project_id,
            knowledge_dirname=f"projects/{project_id}/.knowledge",
        )


def test_knowledge_workflow_quantization_stage_l1_stays_fast_slice(
    tmp_path: Path,
    monkeypatch,
):
    project_id = "project-quant-l1"
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
        processing_mode="agentic",
        quantization_stage="l1",
    )

    assert result["processing_mode"] == "fast"
    assert result["quantization_stage"] == "l1"
    assert result["memify"] == {}
    assert called["memify"] is False


def test_knowledge_workflow_rerun_tokenize_skips_snapshot_slice(
    tmp_path: Path,
    monkeypatch,
):
    project_id = "project-rerun-tokenize"
    project_dir = tmp_path / "projects" / project_id
    data_dir = project_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    _write_project_metadata(project_dir, project_id)
    (data_dir / "sample.md").write_text("# Sample\n\nKnowledge workflow content.", encoding="utf-8")

    orchestrator = KnowledgeWorkflowOrchestrator(
        workspace_dir=tmp_path,
        project_id=project_id,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    source = _build_source(project_dir, project_id)
    config = KnowledgeConfig(enabled=True, memify_enabled=True)
    running_config = SimpleNamespace(knowledge_chunk_size=500)

    _stub_semantic_materialization(monkeypatch)
    monkeypatch.setattr(
        "copaw.knowledge.graph_ops.GraphOpsManager.execute_memify_once",
        lambda self, **kwargs: {
            "status": "succeeded",
            "relation_count": 0,
            "node_count": 0,
            "document_count": 0,
        },
    )
    monkeypatch.setattr(
        "copaw.knowledge.graph_ops.GraphOpsManager.maybe_start_quality_self_drive",
        lambda self, **kwargs: {"accepted": False, "reason": "QUALITY_TARGET_MET"},
    )

    # Warm once to ensure index payload exists; rerun should then skip snapshot slice.
    orchestrator.run(
        config=config,
        running_config=running_config,
        source=source,
        trigger="manual-panel",
        changed_paths=["data/sample.md"],
        processing_mode="fast",
    )

    monkeypatch.setattr(
        "copaw.knowledge.manager.KnowledgeManager.index_source",
        lambda self, *args, **kwargs: (_ for _ in ()).throw(AssertionError("index_source should be skipped")),
    )

    result = orchestrator.run(
        config=config,
        running_config=running_config,
        source=source,
        trigger="manual-rerun",
        changed_paths=["data/sample.md"],
        processing_mode="fast",
        execution_context={"rerun_step_id": "tokenize"},
    )

    assert result["processing_mode"] == "nlp"
    run = _load_project_pipeline_run(project_dir, result["run_id"])
    status_by_step = {step.id: step.status for step in run.steps}
    assert status_by_step["snapshot_raw"] == "skipped"
    assert status_by_step["build_chunks"] == "skipped"
    assert status_by_step["build_interlinear"] == "skipped"
    assert status_by_step["tokenize"] == "succeeded"


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
    _stub_semantic_materialization(monkeypatch)

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


def test_execute_source_scan_writes_project_step_stats(tmp_path: Path):
    project_id = "project-source-scan"
    project_dir = tmp_path / "projects" / project_id
    data_dir = project_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    _write_project_metadata(project_dir, project_id)
    (data_dir / "sample.md").write_text("# Sample\n", encoding="utf-8")

    orchestrator = KnowledgeWorkflowOrchestrator(
        workspace_dir=tmp_path,
        project_id=project_id,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    source = _build_source(project_dir, project_id)
    config = KnowledgeConfig(enabled=True, memify_enabled=True)
    running_config = SimpleNamespace(knowledge_chunk_size=500)
    index_path = project_dir / ".knowledge" / "content.md"

    result = orchestrator._execute_snapshot_raw(
        source=source,
        config=config,
        running_config=running_config,
        changed_paths=["output/sample.md"],
        index_path=index_path,
    )

    assert result["metrics"]["data_file_count"] == 1
    latest_path = project_dir / ".knowledge" / "stats" / "snapshot_raw" / "latest.json"
    history_path = project_dir / ".knowledge" / "stats" / "snapshot_raw" / "history.jsonl"
    assert latest_path.exists()
    assert history_path.exists()
    payload = json.loads(latest_path.read_text(encoding="utf-8"))
    assert payload["project_id"] == project_id
    assert payload["step_id"] == "snapshot_raw"
    assert payload["metrics"]["changed_path_count"] == 1
    assert payload["metrics"]["data_file_count"] == 1
    assert payload["changed_paths"] == ["output/sample.md"]


def test_execute_source_scan_counts_project_root_files_and_skips_builtin_hidden_dirs(tmp_path: Path):
    project_id = "project-root-source-scan"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    _write_project_metadata(project_dir, project_id)
    (project_dir / "sample.md").write_text("# Sample\n", encoding="utf-8")
    (project_dir / ".cache").mkdir(parents=True, exist_ok=True)
    (project_dir / ".cache" / "README.md").write_text("builtin\n", encoding="utf-8")

    orchestrator = KnowledgeWorkflowOrchestrator(
        workspace_dir=tmp_path,
        project_id=project_id,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    source = _build_source(project_dir, project_id)

    config = KnowledgeConfig(enabled=True, memify_enabled=True)
    running_config = SimpleNamespace(knowledge_chunk_size=500)
    index_path = project_dir / ".knowledge" / "content.md"

    result = orchestrator._execute_snapshot_raw(
        source=source,
        config=config,
        running_config=running_config,
        changed_paths=["sample.md"],
        index_path=index_path,
    )

    assert result["metrics"]["data_file_count"] == 1
    latest_path = project_dir / ".knowledge" / "stats" / "snapshot_raw" / "latest.json"
    payload = json.loads(latest_path.read_text(encoding="utf-8"))
    assert payload["data_files"] == ["sample.md"]


def test_run_memify_creates_graph_files(tmp_path: Path, monkeypatch):
    """Replaces test_execute_domain_graph_build_writes_project_step_stats for 7-step design."""
    project_id = "project-domain-graph"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    _write_project_metadata(project_dir, project_id)

    orchestrator = KnowledgeWorkflowOrchestrator(
        workspace_dir=tmp_path,
        project_id=project_id,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    source = _build_source(project_dir, project_id)
    quality_report_path = orchestrator.graph_ops.enrichment_quality_report_path

    def fake_execute_memify_once(**kwargs):
        orchestrator.graph_ops.local_graph_path.parent.mkdir(parents=True, exist_ok=True)
        orchestrator.graph_ops.local_graph_path.write_text('{"nodes": [], "edges": []}', encoding="utf-8")
        orchestrator.graph_ops.enriched_graph_path.write_text('{"nodes": [], "edges": []}', encoding="utf-8")
        quality_report_path.write_text('{"quality_score": 0.95}', encoding="utf-8")
        return {
            "status": "succeeded",
            "relation_count": 3,
            "node_count": 2,
            "document_count": 1,
        }

    monkeypatch.setattr(orchestrator.graph_ops, "execute_memify_once", fake_execute_memify_once)

    result = orchestrator._run_memify(
        config=KnowledgeConfig(enabled=True, memify_enabled=True),
        source=source,
        quality_report_path=quality_report_path,
    )

    assert result["status"] == "succeeded"
    assert result["relation_count"] == 3
    assert orchestrator.graph_ops.local_graph_path.exists()
    assert orchestrator.graph_ops.enriched_graph_path.exists()


def test_run_quality_loop_returns_result(tmp_path: Path, monkeypatch):
    """Replaces test_execute_quality_review_writes_project_step_stats for 7-step design."""
    project_id = "project-quality-review"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    _write_project_metadata(project_dir, project_id)

    orchestrator = KnowledgeWorkflowOrchestrator(
        workspace_dir=tmp_path,
        project_id=project_id,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    source = _build_source(project_dir, project_id)
    quality_report_path = orchestrator.graph_ops.enrichment_quality_report_path
    quality_report_path.parent.mkdir(parents=True, exist_ok=True)
    quality_report_path.write_text('{"quality_score": 0.95}', encoding="utf-8")

    monkeypatch.setattr(
        orchestrator.graph_ops,
        "maybe_start_quality_self_drive",
        lambda **kwargs: {
            "accepted": False,
            "status": "succeeded",
            "score_before": 0.95,
            "score_after": 0.95,
            "delta": 0.0,
            "rounds": [],
        },
    )

    result = orchestrator._run_quality_loop(
        config=KnowledgeConfig(enabled=True, memify_enabled=True),
        source=source,
        memify_result={"status": "succeeded"},
        quality_report_path=quality_report_path,
    )

    assert result["accepted"] is False
    assert result["score_before"] == 0.95
    assert result["score_after"] == 0.95


def test_extract_recent_error_code_prefers_step_reason_code(tmp_path: Path):
    project_id = "project-recent-error-code"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    _write_project_metadata(project_dir, project_id)

    orchestrator = KnowledgeWorkflowOrchestrator(
        workspace_dir=tmp_path,
        project_id=project_id,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    run = _build_initial_run(
        project_id=project_id,
        source_id=f"project-{project_id}-workspace",
        trigger="unit-test",
        changed_paths=[],
    )
    tokenize_step = next(step for step in run.steps if step.id == "tokenize")
    tokenize_step.status = "failed"
    tokenize_step.metrics = {
        "reason_code": "TOKENIZE_ENGINE_TIMEOUT",
        "error_count": 1,
    }

    code, source = orchestrator._extract_recent_error_details(run)
    assert code == "TOKENIZE_ENGINE_TIMEOUT"
    assert source == "workflow_step"
    assert orchestrator._extract_recent_error_code(run) == "TOKENIZE_ENGINE_TIMEOUT"


def test_patch_step_failure_sets_reason_code_from_contract(tmp_path: Path):
    project_id = "project-step-failure-reason"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    _write_project_metadata(project_dir, project_id)

    orchestrator = KnowledgeWorkflowOrchestrator(
        workspace_dir=tmp_path,
        project_id=project_id,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    run = _build_initial_run(
        project_id=project_id,
        source_id=f"project-{project_id}-workspace",
        trigger="unit-test",
        changed_paths=[],
    )

    with pytest.raises(RuntimeError, match="boom"):
        orchestrator._patch_step(
            run,
            "snapshot_raw",
            actor="unit-test",
            status_callback=None,
            sync_patch={},
            completed_sync_patch=None,
            executor=lambda _step: (_ for _ in ()).throw(RuntimeError("boom")),
        )

    step = next(item for item in run.steps if item.id == "snapshot_raw")
    assert step.status == "failed"
    assert step.metrics["reason_code"] == "SNAPSHOT_SOURCE_NOT_FOUND"
    code, source = orchestrator._extract_recent_error_details(run)
    assert code == "SNAPSHOT_SOURCE_NOT_FOUND"
    assert source == "workflow_step"
    assert orchestrator._extract_recent_error_code(run) == "SNAPSHOT_SOURCE_NOT_FOUND"