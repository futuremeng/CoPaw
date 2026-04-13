# -*- coding: utf-8 -*-

import json
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from copaw.config.config import Config, GraphifyConfig, KnowledgeSourceSpec
from copaw.knowledge import GraphOpsManager, KnowledgeManager
from copaw.knowledge.enrichment_pipeline import run_system_knowledge_enrichment
from copaw.knowledge.graphify_provider import GraphifyNotConfiguredError


def _build_graphify_text_source() -> KnowledgeSourceSpec:
    return KnowledgeSourceSpec(
        id="graphify-source",
        name="Graphify Source",
        type="text",
        location="",
        content="Agent uses graph tool for relationship search.",
        enabled=True,
        recursive=False,
        tags=["graphify"],
        summary="",
    )


def _write_graph_json(path, nodes, edges):
    data = {"directed": False, "multigraph": False, "nodes": nodes, "links": edges}
    path.write_text(json.dumps(data), encoding="utf-8")


def _await_terminal_memify_status(
    graph_ops: GraphOpsManager,
    job_id: str,
    timeout_sec: float = 3.0,
) -> dict:
    deadline = time.time() + timeout_sec
    last_job: dict | None = None
    while time.time() < deadline:
        job = graph_ops.get_memify_status(job_id)
        if job is not None:
            last_job = job
            if job.get("status") in {"succeeded", "failed"}:
                return job
        time.sleep(0.05)
    if last_job is None:
        raise AssertionError(f"memify job {job_id} not found")
    raise AssertionError(
        f"memify job {job_id} did not reach terminal status, got {last_job.get('status')}"
    )


def _await_terminal_quality_status(
    graph_ops: GraphOpsManager,
    job_id: str,
    timeout_sec: float = 5.0,
) -> dict:
    deadline = time.time() + timeout_sec
    last_job: dict | None = None
    while time.time() < deadline:
        job = graph_ops.get_quality_loop_status(job_id)
        if job is not None:
            last_job = job
            if job.get("status") in {"succeeded", "failed"}:
                return job
        time.sleep(0.05)
    if last_job is None:
        raise AssertionError(f"quality job {job_id} not found")
    raise AssertionError(
        f"quality job {job_id} did not reach terminal status, got {last_job.get('status')}"
    )


# ---------------------------------------------------------------------------
# graph_query — graphify with real provider (graph.json available)
# ---------------------------------------------------------------------------


def test_graph_query_graphify_with_real_provider(tmp_path):
    """When graph_path is set and graph.json is valid, records are returned."""
    graph_json = tmp_path / "graph.json"
    _write_graph_json(
        graph_json,
        nodes=[
            {"id": "n1", "label": "AgentRunner_graphtool", "source_file": "runner.py"},
            {"id": "n2", "label": "ToolDispatcher", "source_file": "tools.py"},
        ],
        edges=[{"source": "n1", "target": "n2", "relation": "calls", "confidence": "EXTRACTED"}],
    )
    knowledge_config = Config().knowledge
    knowledge_config.enabled = True
    knowledge_config.engine = "graphify"
    knowledge_config.graphify.graph_path = str(graph_json)
    knowledge_config.graphify.fallback_to_local = False  # surface errors explicitly

    graph_ops = GraphOpsManager(tmp_path)
    result = graph_ops.graph_query(
        config=knowledge_config,
        query_mode="template",
        query_text="agent runner graphtool",
        dataset_scope=[],
        project_scope=None,
        include_global=True,
        top_k=5,
        timeout_sec=30,
    )

    assert len(result.records) >= 1
    assert result.provenance.get("engine") == "graphify"
    assert "GRAPHIFY_FALLBACK_TO_LOCAL_LEXICAL" not in result.warnings


# ---------------------------------------------------------------------------
# graph_query — graphify not configured, fallback_to_local=True
# ---------------------------------------------------------------------------


def test_graph_query_graphify_fallback_when_not_configured(tmp_path):
    """When graph_path is empty and fallback_to_local=True, falls back to local_lexical."""
    knowledge_config = Config().knowledge
    knowledge_config.enabled = True
    knowledge_config.engine = "graphify"
    knowledge_config.graphify.graph_path = ""  # not configured
    knowledge_config.graphify.fallback_to_local = True

    # Index something so local fallback has results
    manager = KnowledgeManager(tmp_path)
    source = _build_graphify_text_source()
    knowledge_config.sources.append(source)
    manager.index_source(
        source,
        knowledge_config,
        SimpleNamespace(knowledge_chunk_size=knowledge_config.index.chunk_size),
    )

    graph_ops = GraphOpsManager(tmp_path)
    result = graph_ops.graph_query(
        config=knowledge_config,
        query_mode="template",
        query_text="Agent uses graph tool",
        dataset_scope=[],
        project_scope=None,
        include_global=True,
        top_k=5,
        timeout_sec=30,
    )

    assert "GRAPHIFY_NOT_CONFIGURED" in result.warnings
    assert "GRAPHIFY_FALLBACK_TO_LOCAL_LEXICAL" in result.warnings
    # local_lexical should still return records for the indexed text
    assert len(result.records) >= 1


def test_graph_query_graphify_no_fallback_raises_when_not_configured(tmp_path):
    """When fallback_to_local=False and graph_path empty, raises GraphifyNotConfiguredError."""
    knowledge_config = Config().knowledge
    knowledge_config.enabled = True
    knowledge_config.engine = "graphify"
    knowledge_config.graphify.graph_path = ""
    knowledge_config.graphify.fallback_to_local = False

    graph_ops = GraphOpsManager(tmp_path)
    with pytest.raises(GraphifyNotConfiguredError):
        graph_ops.graph_query(
            config=knowledge_config,
            query_mode="template",
            query_text="something",
            dataset_scope=[],
            project_scope=None,
            include_global=True,
            top_k=5,
            timeout_sec=30,
        )


def test_graph_query_graphify_fallback_on_runtime_error(tmp_path):
    """When the provider raises GraphifyError and fallback_to_local=True, falls back."""
    from copaw.knowledge.graphify_provider import GraphifyError

    knowledge_config = Config().knowledge
    knowledge_config.enabled = True
    knowledge_config.engine = "graphify"
    knowledge_config.graphify.graph_path = str(tmp_path / "ghost.json")  # file will exist but is corrupt
    knowledge_config.graphify.fallback_to_local = True

    # Write a corrupt graph.json to trigger GraphifyLoadError
    (tmp_path / "ghost.json").write_text("not valid json", encoding="utf-8")

    manager = KnowledgeManager(tmp_path)
    source = _build_graphify_text_source()
    knowledge_config.sources.append(source)
    manager.index_source(
        source,
        knowledge_config,
        SimpleNamespace(knowledge_chunk_size=knowledge_config.index.chunk_size),
    )

    graph_ops = GraphOpsManager(tmp_path)
    result = graph_ops.graph_query(
        config=knowledge_config,
        query_mode="template",
        query_text="Agent uses graph tool",
        dataset_scope=[],
        project_scope=None,
        include_global=True,
        top_k=5,
        timeout_sec=30,
    )

    assert "GRAPHIFY_RUNTIME_ERROR" in result.warnings
    assert "GRAPHIFY_FALLBACK_TO_LOCAL_LEXICAL" in result.warnings


# ---------------------------------------------------------------------------
# graph_query — cypher mode (unchanged)
# ---------------------------------------------------------------------------


def test_graph_query_graphify_cypher_mvp_translation(tmp_path):
    knowledge_config = Config().knowledge
    knowledge_config.enabled = True
    knowledge_config.engine = "graphify"

    graph_ops = GraphOpsManager(tmp_path)
    result = graph_ops.graph_query(
        config=knowledge_config,
        query_mode="cypher",
        query_text="MATCH (node)-[:RELATES_TO]->(tool) RETURN node LIMIT 5",
        dataset_scope=[],
        project_scope=None,
        include_global=True,
        top_k=5,
        timeout_sec=30,
    )

    assert "CYPHER_MVP_TRANSLATED" in result.warnings


# ---------------------------------------------------------------------------
# run_memify — graphify
# ---------------------------------------------------------------------------


def test_run_memify_graphify_dry_run_succeeds(tmp_path):
    """Dry-run memify with a valid dataset_dir should succeed immediately."""
    knowledge_config = Config().knowledge
    knowledge_config.enabled = True
    knowledge_config.engine = "graphify"
    knowledge_config.graphify.dataset_dir = str(tmp_path)

    graph_ops = GraphOpsManager(tmp_path)
    payload = graph_ops.run_memify(
        config=knowledge_config,
        pipeline_type="default",
        dataset_scope=[],
        idempotency_key="graphify-memify-dry-run",
        dry_run=True,
    )

    assert payload["accepted"] is True
    job = _await_terminal_memify_status(graph_ops, payload["job_id"])
    assert job["status"] == "succeeded"
    assert "GRAPHIFY_MEMIFY_DRY_RUN" in job["warnings"]


def test_run_memify_graphify_no_dataset_dir_gives_failed_status(tmp_path):
    """When dataset_dir is empty, memify should record a failed job."""
    knowledge_config = Config().knowledge
    knowledge_config.enabled = True
    knowledge_config.engine = "graphify"
    knowledge_config.graphify.dataset_dir = ""  # not set

    graph_ops = GraphOpsManager(tmp_path)
    payload = graph_ops.run_memify(
        config=knowledge_config,
        pipeline_type="default",
        dataset_scope=[],
        idempotency_key="graphify-memify-no-dir",
        dry_run=False,
    )

    assert payload["accepted"] is True
    job = _await_terminal_memify_status(graph_ops, payload["job_id"])
    assert job["status"] == "failed"


def test_local_memify_builds_queryable_graph(tmp_path):
    knowledge_config = Config().knowledge
    knowledge_config.enabled = True
    knowledge_config.engine = "local_lexical"

    manager = KnowledgeManager(tmp_path)
    source = KnowledgeSourceSpec(
        id="local-graph-source",
        name="Local Graph Source",
        type="text",
        location="",
        content=(
            "AgentRunner uses ToolDispatcher. "
            "ToolDispatcher calls FileSearch. "
            "FileSearch indexes ProjectKnowledgePanel."
        ),
        enabled=True,
        recursive=False,
        tags=["graph"],
        summary="",
    )
    knowledge_config.sources.append(source)
    manager.index_source(
        source,
        knowledge_config,
        SimpleNamespace(knowledge_chunk_size=knowledge_config.index.chunk_size),
    )

    graph_ops = GraphOpsManager(tmp_path)
    memify_result = graph_ops.execute_memify_once(
        config=knowledge_config,
        pipeline_type="project-auto",
        dataset_scope=[source.id],
        dry_run=False,
    )

    assert memify_result["status"] == "succeeded"
    assert memify_result["engine"] == "local_graph"
    assert memify_result["relation_count"] > 0

    result = graph_ops.graph_query(
        config=knowledge_config,
        query_mode="template",
        query_text="ToolDispatcher FileSearch",
        dataset_scope=[source.id],
        project_scope=None,
        include_global=True,
        top_k=5,
        timeout_sec=30,
    )

    assert result.provenance.get("engine") == "local_graph"
    assert len(result.records) >= 1


def test_local_memify_runs_enrichment_pipeline_and_query_prefers_l2(tmp_path):
    knowledge_config = Config().knowledge
    knowledge_config.enabled = True
    knowledge_config.engine = "local_lexical"
    knowledge_config.enrichment_pipeline_enabled = True

    manager = KnowledgeManager(tmp_path)
    source = KnowledgeSourceSpec(
        id="local-enrich-source",
        name="Local Enrich Source",
        type="text",
        location="",
        content=(
            "ToolDispatcher mentions FileSearch. "
            "FileSearch co_occurs_with KnowledgeGraph."
        ),
        enabled=True,
        recursive=False,
        tags=["graph", "enrich"],
        summary="",
    )
    knowledge_config.sources.append(source)
    manager.index_source(
        source,
        knowledge_config,
        SimpleNamespace(knowledge_chunk_size=knowledge_config.index.chunk_size),
    )

    graph_ops = GraphOpsManager(tmp_path)
    memify_result = graph_ops.execute_memify_once(
        config=knowledge_config,
        pipeline_type="system-enrichment",
        dataset_scope=[source.id],
        dry_run=False,
    )

    assert memify_result["status"] == "succeeded"
    assert memify_result.get("enrichment_status") == "succeeded"
    assert Path(memify_result["enriched_graph_path"]).exists()
    assert Path(memify_result["enrichment_quality_report_path"]).exists()

    result = graph_ops.graph_query(
        config=knowledge_config,
        query_mode="template",
        query_text="ToolDispatcher FileSearch",
        dataset_scope=[source.id],
        project_scope=None,
        include_global=True,
        top_k=5,
        timeout_sec=30,
    )

    assert result.provenance.get("engine") == "local_graph"
    assert result.provenance.get("layer") == "l2_enriched"
    assert len(result.records) >= 1


def test_graphify_query_prefers_enriched_graph_when_enabled(tmp_path):
    knowledge_config = Config().knowledge
    knowledge_config.enabled = True
    knowledge_config.engine = "graphify"
    knowledge_config.enrichment_pipeline_enabled = True

    raw_graph_path = tmp_path / "raw_graph.json"
    _write_graph_json(
        raw_graph_path,
        nodes=[{"id": "n1", "label": "RawNode", "source_file": "raw.md"}],
        edges=[],
    )
    knowledge_config.graphify.graph_path = str(raw_graph_path)

    graph_ops = GraphOpsManager(tmp_path)
    graph_ops.enriched_graph_path.parent.mkdir(parents=True, exist_ok=True)
    _write_graph_json(
        graph_ops.enriched_graph_path,
        nodes=[{"id": "n2", "label": "EnrichedNode", "source_file": "enriched.md"}],
        edges=[],
    )

    called_graph_path = ""

    def _fake_graphify_query(config, query_text, top_k, dataset_scope):
        nonlocal called_graph_path
        _ = query_text, top_k, dataset_scope
        called_graph_path = str(getattr(config, "graph_path", "") or "")
        return [
            {
                "subject": "EnrichedNode",
                "predicate": "related_to",
                "object": "Other",
                "score": 1.0,
                "source_id": "graphify-source",
                "source_type": "graph",
                "document_path": "enriched.md",
                "document_title": "enriched",
            }
        ]

    with patch("copaw.knowledge.graph_ops.graphify_query", _fake_graphify_query):
        result = graph_ops.graph_query(
            config=knowledge_config,
            query_mode="template",
            query_text="enriched",
            dataset_scope=[],
            project_scope=None,
            include_global=True,
            top_k=5,
            timeout_sec=30,
        )

    assert called_graph_path == str(graph_ops.enriched_graph_path)
    assert result.provenance.get("engine") == "graphify"
    assert result.provenance.get("layer") == "l2_enriched"
    assert result.provenance.get("graph_path") == str(graph_ops.enriched_graph_path)
    assert len(result.records) == 1


def test_run_memify_job_exposes_enrichment_fields(tmp_path):
    knowledge_config = Config().knowledge
    knowledge_config.enabled = True
    knowledge_config.engine = "local_lexical"
    knowledge_config.enrichment_pipeline_enabled = True

    manager = KnowledgeManager(tmp_path)
    source = KnowledgeSourceSpec(
        id="job-enrich-source",
        name="Job Enrich Source",
        type="text",
        location="",
        content="ToolDispatcher uses FileSearch in project knowledge graph.",
        enabled=True,
        recursive=False,
        tags=["graph", "job"],
        summary="",
    )
    knowledge_config.sources.append(source)
    manager.index_source(
        source,
        knowledge_config,
        SimpleNamespace(knowledge_chunk_size=knowledge_config.index.chunk_size),
    )

    graph_ops = GraphOpsManager(tmp_path)
    payload = graph_ops.run_memify(
        config=knowledge_config,
        pipeline_type="system-enrichment",
        dataset_scope=[source.id],
        idempotency_key="job-enrichment-visible",
        dry_run=False,
    )

    assert payload["accepted"] is True
    job = _await_terminal_memify_status(graph_ops, payload["job_id"])
    assert job["status"] == "succeeded"
    assert job.get("enrichment_status") == "succeeded"
    assert Path(str(job.get("enriched_graph_path") or "")).exists()
    assert Path(str(job.get("enrichment_quality_report_path") or "")).exists()
    assert isinstance(job.get("enrichment_metrics"), dict)


def test_maybe_start_quality_self_drive_skips_when_quality_target_met(tmp_path):
    knowledge_config = Config().knowledge
    knowledge_config.enabled = True
    knowledge_config.memify_enabled = True

    graph_ops = GraphOpsManager(tmp_path)
    baseline_result = {
        "status": "succeeded",
        "document_count": 4,
        "relation_count": 100,
        "node_count": 40,
        "enrichment_metrics": {
            "edge_count": 100,
            "node_count": 40,
            "relation_normalized_count": 100,
            "entity_canonicalized_count": 40,
            "low_confidence_edges": 0,
            "missing_evidence_edges": 0,
        },
    }

    result = graph_ops.maybe_start_quality_self_drive(
        config=knowledge_config,
        dataset_scope=["project-demo-workspace"],
        project_id="project-demo",
        max_rounds=3,
        dry_run=False,
        baseline_result=baseline_result,
    )

    assert result["accepted"] is False
    assert result["reason"] == "QUALITY_TARGET_MET"
    assert isinstance(result.get("snapshot"), dict)


def test_pick_latest_memify_result_respects_dataset_scope(tmp_path):
    graph_ops = GraphOpsManager(tmp_path)

    graph_ops._save_memify_jobs(  # pylint: disable=protected-access
        {
            "job-a": {
                "job_id": "job-a",
                "status": "succeeded",
                "relation_count": 10,
                "node_count": 5,
                "dataset_scope": ["project-a-workspace"],
                "updated_at": "2026-04-13T10:00:00+00:00",
            },
            "job-b": {
                "job_id": "job-b",
                "status": "succeeded",
                "relation_count": 12,
                "node_count": 6,
                "dataset_scope": ["project-b-workspace"],
                "updated_at": "2026-04-13T11:00:00+00:00",
            },
        }
    )

    picked = graph_ops._pick_latest_memify_result(  # pylint: disable=protected-access
        dataset_scope=["project-a-workspace"],
        project_id="project-a",
    )

    assert picked is not None
    assert picked["job_id"] == "job-a"


def test_quality_loop_persists_reflection_artifacts(tmp_path):
    knowledge_config = Config().knowledge
    knowledge_config.enabled = True
    knowledge_config.memify_enabled = True

    graph_ops = GraphOpsManager(tmp_path)
    project_id = "project-reflection"
    dataset_scope = ["project-reflection-workspace"]

    graph_ops._save_memify_jobs(  # pylint: disable=protected-access
        {
            "seed-job": {
                "job_id": "seed-job",
                "status": "succeeded",
                "relation_count": 24,
                "node_count": 12,
                "document_count": 4,
                "dataset_scope": dataset_scope,
                "updated_at": "2026-04-13T09:00:00+00:00",
                "enrichment_metrics": {
                    "edge_count": 24,
                    "node_count": 12,
                    "relation_normalized_count": 0,
                    "entity_canonicalized_count": 0,
                    "low_confidence_edges": 8,
                    "missing_evidence_edges": 0,
                },
            }
        }
    )

    with patch.object(
        graph_ops,
        "execute_memify_once",
        return_value={
            "status": "succeeded",
            "relation_count": 24,
            "node_count": 12,
            "document_count": 4,
            "enrichment_metrics": {
                "edge_count": 24,
                "node_count": 12,
                "relation_normalized_count": 1,
                "entity_canonicalized_count": 1,
                "low_confidence_edges": 8,
                "missing_evidence_edges": 0,
            },
            "warnings": [],
            "error": None,
            "engine": "local_graph",
        },
    ):
        response = graph_ops.run_quality_self_drive(
            config=knowledge_config,
            dataset_scope=dataset_scope,
            project_id=project_id,
            max_rounds=1,
            dry_run=False,
        )

    assert response["accepted"] is True
    status = _await_terminal_quality_status(graph_ops, response["job_id"], timeout_sec=5.0)
    assert status["status"] == "succeeded"
    artifacts = status.get("reflection_artifacts") or {}
    assert artifacts.get("lessons_path")
    assert artifacts.get("params_path")
    assert artifacts.get("rounds_dir")
    assert Path(artifacts["lessons_path"]).exists()
    assert Path(artifacts["params_path"]).exists()
    rounds_dir = Path(artifacts["rounds_dir"])
    assert rounds_dir.exists()
    round_files = sorted(rounds_dir.glob("round-*.json"))
    assert len(round_files) == 1
    round_payload = json.loads(round_files[0].read_text(encoding="utf-8"))
    assert round_payload["round"] == 1
    assert isinstance(round_payload.get("agent_gate"), dict)


def test_quality_loop_stops_when_agent_gate_requires_review(tmp_path):
    knowledge_config = Config().knowledge
    knowledge_config.enabled = True
    knowledge_config.memify_enabled = True

    graph_ops = GraphOpsManager(tmp_path)
    project_id = "project-gate-review"
    dataset_scope = ["project-gate-review-workspace"]

    graph_ops._save_memify_jobs(  # pylint: disable=protected-access
        {
            "seed-job": {
                "job_id": "seed-job",
                "status": "succeeded",
                "relation_count": 24,
                "node_count": 12,
                "document_count": 4,
                "dataset_scope": dataset_scope,
                "updated_at": "2026-04-13T09:00:00+00:00",
                "enrichment_metrics": {
                    "edge_count": 24,
                    "node_count": 12,
                    "relation_normalized_count": 1,
                    "entity_canonicalized_count": 1,
                    "low_confidence_edges": 8,
                    "missing_evidence_edges": 0,
                },
            }
        }
    )

    with patch.object(
        graph_ops,
        "execute_memify_once",
        return_value={
            "status": "succeeded",
            "relation_count": 24,
            "node_count": 12,
            "document_count": 4,
            "enrichment_metrics": {
                "edge_count": 24,
                "node_count": 12,
                "relation_normalized_count": 1,
                "entity_canonicalized_count": 1,
                "low_confidence_edges": 8,
                "missing_evidence_edges": 0,
            },
            "warnings": [],
            "error": None,
            "engine": "local_graph",
        },
    ), patch.object(
        graph_ops,
        "_run_quality_agent_gate",
        return_value={
            "status": "review_required",
            "reason": "MISSING_ACTION_PLAN",
            "summary": "missing",
            "next_round_hints": {},
        },
    ):
        response = graph_ops.run_quality_self_drive(
            config=knowledge_config,
            dataset_scope=dataset_scope,
            project_id=project_id,
            max_rounds=2,
            dry_run=False,
        )
        status = _await_terminal_quality_status(graph_ops, response["job_id"], timeout_sec=5.0)

    assert response["accepted"] is True
    assert status["status"] == "succeeded"
    assert status["stop_reason"] == "REVIEW_REQUIRED"
    warnings = status.get("warnings") or []
    assert "MISSING_ACTION_PLAN" in warnings


def test_enrichment_policy_prunes_low_confidence_edges(tmp_path):
    source_graph = tmp_path / "source.json"
    enriched_graph = tmp_path / "enriched.json"
    quality_report = tmp_path / "quality.json"
    source_graph.write_text(
        json.dumps(
            {
                "nodes": [
                    {"id": "n1", "label": "NodeA"},
                    {"id": "n2", "label": "NodeB"},
                ],
                "links": [
                    {
                        "source": "n1",
                        "target": "n2",
                        "relation": "mentions",
                        "confidence": 0.2,
                        "document_path": "",
                        "document_title": "",
                    },
                    {
                        "source": "n2",
                        "target": "n1",
                        "relation": "mentions",
                        "confidence": 0.9,
                        "document_path": "doc.md",
                        "document_title": "Doc",
                    },
                ],
            }
        ),
        encoding="utf-8",
    )

    result = run_system_knowledge_enrichment(
        source_graph_path=source_graph,
        enriched_graph_path=enriched_graph,
        quality_report_path=quality_report,
        pipeline_id="quality-policy-test",
        quality_policy={
            "prune_low_confidence": True,
            "min_confidence_to_keep": 0.35,
        },
    )

    assert result.status == "succeeded"
    assert result.metrics["pruned_low_confidence_edges"] == 1
    assert result.metrics["edge_count"] == 1
    assert "ENRICHMENT_PRUNED_LOW_CONFIDENCE_EDGES" in result.warnings
