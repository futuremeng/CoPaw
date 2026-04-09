# -*- coding: utf-8 -*-

from types import SimpleNamespace

from copaw.config.config import Config, KnowledgeSourceSpec
from copaw.knowledge import GraphOpsManager, KnowledgeManager


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


def test_graph_query_graphify_template_falls_back_to_local_lexical(tmp_path):
    knowledge_config = Config().knowledge
    knowledge_config.enabled = True
    knowledge_config.engine = "graphify"

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
        top_k=5,
        timeout_sec=30,
    )

    assert len(result.records) >= 1
    assert result.provenance.get("engine") == "graphify"
    assert "GRAPHIFY_FALLBACK_TO_LOCAL_LEXICAL" in result.warnings


def test_graph_query_graphify_cypher_not_ready(tmp_path):
    knowledge_config = Config().knowledge
    knowledge_config.enabled = True
    knowledge_config.engine = "graphify"

    graph_ops = GraphOpsManager(tmp_path)
    result = graph_ops.graph_query(
        config=knowledge_config,
        query_mode="cypher",
        query_text="MATCH (n) RETURN n LIMIT 5",
        dataset_scope=[],
        top_k=5,
        timeout_sec=30,
    )

    assert result.records == []
    assert "GRAPHIFY_CYPHER_NOT_READY" in result.warnings


def test_run_memify_graphify_provider_not_ready(tmp_path):
    knowledge_config = Config().knowledge
    knowledge_config.enabled = True
    knowledge_config.engine = "graphify"

    graph_ops = GraphOpsManager(tmp_path)
    payload = graph_ops.run_memify(
        config=knowledge_config,
        pipeline_type="default",
        dataset_scope=[],
        idempotency_key="graphify-memify-not-ready",
        dry_run=False,
    )

    assert payload["accepted"] is True
    job = graph_ops.get_memify_status(payload["job_id"])
    assert job is not None
    assert job["status"] == "failed"
    assert job["error"] == "Graphify memify provider is not wired yet."
    assert "GRAPHIFY_PROVIDER_NOT_READY" in job["warnings"]
