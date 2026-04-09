# -*- coding: utf-8 -*-
"""Unit tests for the Graphify knowledge provider adapter."""

import json
import os

import pytest

from copaw.config.config import GraphifyConfig
from copaw.knowledge.graphify_provider import (
    GraphifyLoadError,
    GraphifyNotConfiguredError,
    GraphifyRemoteNotImplementedError,
    graphify_memify,
    graphify_query,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_graph_json(path, nodes, edges):
    """Write a minimal node-link graph.json compatible with NetworkX."""
    data = {"directed": False, "multigraph": False, "nodes": nodes, "links": edges}
    path.write_text(json.dumps(data), encoding="utf-8")


# ---------------------------------------------------------------------------
# graphify_query — local file mode
# ---------------------------------------------------------------------------


def test_graphify_query_not_configured_raises():
    cfg = GraphifyConfig(graph_path="", endpoint="")
    with pytest.raises(GraphifyNotConfiguredError):
        graphify_query(cfg, "agent uses graph", top_k=5, dataset_scope=[])


def test_graphify_query_remote_endpoint_raises():
    cfg = GraphifyConfig(endpoint="http://localhost:9000")
    with pytest.raises(GraphifyRemoteNotImplementedError):
        graphify_query(cfg, "test query", top_k=5, dataset_scope=[])


def test_graphify_query_missing_graph_file_raises(tmp_path):
    cfg = GraphifyConfig(graph_path=str(tmp_path / "nonexistent.json"))
    with pytest.raises(GraphifyLoadError, match="not found"):
        graphify_query(cfg, "anything", top_k=5, dataset_scope=[])


def test_graphify_query_returns_records(tmp_path):
    graph_json = tmp_path / "graph.json"
    _write_graph_json(
        graph_json,
        nodes=[
            {"id": "n1", "label": "AgentRunner", "source_file": "runner.py", "source_location": "L1"},
            {"id": "n2", "label": "ToolDispatcher", "source_file": "tools.py", "source_location": "L5"},
            {"id": "n3", "label": "KnowledgeManager", "source_file": "knowledge.py", "source_location": "L10"},
        ],
        edges=[
            {"source": "n1", "target": "n2", "relation": "calls", "confidence": "EXTRACTED"},
            {"source": "n2", "target": "n3", "relation": "queries", "confidence": "INFERRED"},
        ],
    )
    cfg = GraphifyConfig(graph_path=str(graph_json))
    records = graphify_query(cfg, "agent runner tool", top_k=10, dataset_scope=[])
    assert len(records) >= 1
    assert any(r["subject"] == "AgentRunner" for r in records)


def test_graphify_query_no_matching_terms_returns_empty(tmp_path):
    graph_json = tmp_path / "graph.json"
    _write_graph_json(
        graph_json,
        nodes=[{"id": "n1", "label": "AgentRunner", "source_file": "runner.py"}],
        edges=[],
    )
    cfg = GraphifyConfig(graph_path=str(graph_json))
    # Very short terms (< 3 chars each) are filtered — returns empty
    records = graphify_query(cfg, "ab xy", top_k=5, dataset_scope=[])
    assert records == []


def test_graphify_query_respects_top_k(tmp_path):
    graph_json = tmp_path / "graph.json"
    nodes = [
        {"id": f"n{i}", "label": f"concept_{i}_knowledge",
         "source_file": f"file{i}.py"}
        for i in range(20)
    ]
    edges = [
        {"source": f"n{i}", "target": f"n{i+1}",
         "relation": "relates_to", "confidence": "EXTRACTED"}
        for i in range(19)
    ]
    _write_graph_json(graph_json, nodes, edges)
    cfg = GraphifyConfig(graph_path=str(graph_json))
    records = graphify_query(cfg, "knowledge concept", top_k=3, dataset_scope=[])
    assert len(records) <= 3


# ---------------------------------------------------------------------------
# graphify_query — env injection into GraphifyConfig
# ---------------------------------------------------------------------------


def test_graphify_config_env_injection(tmp_path, monkeypatch):
    graph_json = tmp_path / "env_graph.json"
    _write_graph_json(
        graph_json,
        nodes=[{"id": "n1", "label": "Scheduler_knowledge", "source_file": "sched.py"}],
        edges=[],
    )
    monkeypatch.setenv("COPAW_GRAPHIFY_GRAPH_PATH", str(graph_json))
    monkeypatch.setenv("COPAW_GRAPHIFY_FALLBACK", "false")

    cfg = GraphifyConfig()  # env should override empty defaults
    assert cfg.graph_path == str(graph_json)
    assert cfg.fallback_to_local is False


def test_graphify_config_env_not_set_leaves_defaults(monkeypatch):
    for key in (
        "COPAW_GRAPHIFY_GRAPH_PATH",
        "COPAW_GRAPHIFY_DATASET_DIR",
        "COPAW_GRAPHIFY_ENDPOINT",
        "COPAW_GRAPHIFY_API_KEY",
        "COPAW_GRAPHIFY_FALLBACK",
    ):
        monkeypatch.delenv(key, raising=False)

    cfg = GraphifyConfig()
    assert cfg.graph_path == ""
    assert cfg.fallback_to_local is True
    assert cfg.dataset == "copaw"


# ---------------------------------------------------------------------------
# graphify_memify
# ---------------------------------------------------------------------------


def test_graphify_memify_not_configured_raises():
    cfg = GraphifyConfig(dataset_dir="")
    with pytest.raises(GraphifyNotConfiguredError):
        graphify_memify(cfg, pipeline_type="default", dataset_scope=[], dry_run=False)


def test_graphify_memify_dataset_dir_not_found(tmp_path):
    cfg = GraphifyConfig(dataset_dir=str(tmp_path / "nonexistent"))
    result = graphify_memify(cfg, pipeline_type="default", dataset_scope=[], dry_run=False)
    assert result["status"] == "failed"
    assert "GRAPHIFY_DATASET_DIR_NOT_FOUND" in result["warnings"]


def test_graphify_memify_dry_run(tmp_path):
    cfg = GraphifyConfig(dataset_dir=str(tmp_path))
    result = graphify_memify(cfg, pipeline_type="default", dataset_scope=[], dry_run=True)
    assert result["status"] == "succeeded"
    assert "GRAPHIFY_MEMIFY_DRY_RUN" in result["warnings"]


def test_graphify_memify_cli_not_installed(tmp_path, monkeypatch):
    """When graphify CLI is not installed the result should be a failed status."""
    import sys
    cfg = GraphifyConfig(dataset_dir=str(tmp_path))

    # Patch subprocess.run to simulate FileNotFoundError
    import subprocess
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **kw: (_ for _ in ()).throw(FileNotFoundError("graphify not found")),
    )
    result = graphify_memify(cfg, pipeline_type="default", dataset_scope=[], dry_run=False)
    assert result["status"] == "failed"
    assert "GRAPHIFY_CLI_NOT_FOUND" in result["warnings"]


def test_graphify_memify_nonzero_exit(tmp_path, monkeypatch):
    """Nonzero exit code from graphify CLI should produce a failed status."""
    import subprocess
    from types import SimpleNamespace

    cfg = GraphifyConfig(dataset_dir=str(tmp_path))
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **kw: SimpleNamespace(
            returncode=1,
            stderr="fatal: cannot read directory",
            stdout="",
        ),
    )
    result = graphify_memify(cfg, pipeline_type="default", dataset_scope=[], dry_run=False)
    assert result["status"] == "failed"
    assert "GRAPHIFY_MEMIFY_NONZERO_EXIT" in result["warnings"]
    assert "fatal: cannot read directory" in (result["error"] or "")


def test_graphify_memify_timeout(tmp_path, monkeypatch):
    """Subprocess timeout should produce a failed status with TIMEOUT warning."""
    import subprocess

    cfg = GraphifyConfig(dataset_dir=str(tmp_path))
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *a, **kw: (_ for _ in ()).throw(subprocess.TimeoutExpired(cmd="graphify", timeout=60)),
    )
    result = graphify_memify(cfg, pipeline_type="default", dataset_scope=[], dry_run=False)
    assert result["status"] == "failed"
    assert "GRAPHIFY_MEMIFY_TIMEOUT" in result["warnings"]
