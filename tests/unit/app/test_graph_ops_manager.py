# -*- coding: utf-8 -*-

import json
import time
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from copaw.config.config import Config, GraphifyConfig, KnowledgeSourceSpec
from copaw.knowledge import GraphOpsManager, KnowledgeManager
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
