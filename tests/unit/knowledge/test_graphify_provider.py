# -*- coding: utf-8 -*-
"""Unit tests for the Graphify knowledge provider adapter."""

import json
from pathlib import Path

import pytest

from copaw.config.config import GraphifyConfig
from copaw.knowledge.graphify_provider import (
    GraphifyLoadError,
    GraphifyNotConfiguredError,
    GraphifyRemoteError,
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


def test_graphify_query_remote_endpoint_success(monkeypatch):
    class _DummyResponse:
        status_code = 200
        text = ""

        def raise_for_status(self):
            return None

        def json(self):
            return {
                "records": [
                    {
                        "subject": "RemoteNode",
                        "predicate": "relates_to",
                        "object": "OtherNode",
                        "score": 0.9,
                        "source_id": "remote",
                    }
                ]
            }

    def _fake_post(url, json, headers, timeout):
        _ = json, headers, timeout
        assert url in {
            "https://graph.example.com/query",
            "https://graph.example.com/graph/query",
        }
        return _DummyResponse()

    import httpx

    monkeypatch.setattr(httpx, "post", _fake_post)
    cfg = GraphifyConfig(endpoint="https://graph.example.com", api_key="secret")
    records = graphify_query(cfg, "test query", top_k=5, dataset_scope=["repo"])
    assert len(records) == 1
    assert records[0]["subject"] == "RemoteNode"


def test_graphify_query_remote_endpoint_http_error(monkeypatch):
    import httpx

    req = httpx.Request("POST", "https://graph.example.com/query")
    resp = httpx.Response(500, request=req, text="boom")

    class _DummyResponse:
        status_code = 500
        text = "boom"

        def raise_for_status(self):
            raise httpx.HTTPStatusError("server error", request=req, response=resp)

        def json(self):
            return {}

    monkeypatch.setattr(httpx, "post", lambda *a, **kw: _DummyResponse())

    cfg = GraphifyConfig(endpoint="https://graph.example.com")
    with pytest.raises(GraphifyRemoteError, match=r"failed \(500\)"):
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
    monkeypatch.setenv("COPAW_GRAPHIFY_REQUEST_TIMEOUT_SEC", "22")

    cfg = GraphifyConfig()  # env should override empty defaults
    assert cfg.graph_path == str(graph_json)
    assert cfg.fallback_to_local is False
    assert cfg.request_timeout_sec == 22.0


def test_graphify_config_env_not_set_leaves_defaults(monkeypatch):
    for key in (
        "COPAW_GRAPHIFY_GRAPH_PATH",
        "COPAW_GRAPHIFY_DATASET_DIR",
        "COPAW_GRAPHIFY_ENDPOINT",
        "COPAW_GRAPHIFY_API_KEY",
        "COPAW_GRAPHIFY_FALLBACK",
        "COPAW_GRAPHIFY_REQUEST_TIMEOUT_SEC",
    ):
        monkeypatch.delenv(key, raising=False)

    cfg = GraphifyConfig()
    assert cfg.graph_path == ""
    assert cfg.fallback_to_local is True
    assert cfg.dataset == "copaw"
    assert cfg.request_timeout_sec == 15.0


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


def test_graphify_memify_internal_success(tmp_path):
    corpus = tmp_path / "corpus"
    corpus.mkdir(parents=True, exist_ok=True)
    (corpus / "sample.py").write_text(
        "AgentRunner calls ToolDispatcher and FileSearch.\nToolDispatcher builds graph output.",
        encoding="utf-8",
    )
    cfg = GraphifyConfig(dataset_dir=str(corpus))
    progress_events = []

    result = graphify_memify(
        cfg,
        pipeline_type="default",
        dataset_scope=[],
        dry_run=False,
        progress_callback=lambda payload: progress_events.append(dict(payload)),
    )

    assert result["status"] == "succeeded"
    assert result["engine"] == "graphify_internal"
    assert result["node_count"] > 0
    assert result["relation_count"] > 0
    assert Path(result["graph_path"]).exists()
    assert any(evt.get("stage") == "extract" for evt in progress_events)
    assert any(evt.get("stage") == "finalize" for evt in progress_events)


def test_graphify_memify_internal_no_eligible_files(tmp_path):
    corpus = tmp_path / "corpus"
    corpus.mkdir(parents=True, exist_ok=True)
    (corpus / "image.bin").write_bytes(b"\x00\x01")
    cfg = GraphifyConfig(dataset_dir=str(corpus))

    result = graphify_memify(cfg, pipeline_type="default", dataset_scope=[], dry_run=False)
    assert result["status"] == "failed"
    assert "GRAPHIFY_MEMIFY_NO_ELIGIBLE_FILES" in result["warnings"]


def test_graphify_memify_remote_success(monkeypatch):
    class _DummyResponse:
        status_code = 200
        text = ""

        def raise_for_status(self):
            return None

        def json(self):
            return {"accepted": True}

    import httpx

    monkeypatch.setattr(httpx, "post", lambda *a, **kw: _DummyResponse())
    cfg = GraphifyConfig(endpoint="https://graph.example.com")
    result = graphify_memify(cfg, pipeline_type="default", dataset_scope=["repo"], dry_run=False)
    assert result["status"] == "running"
    assert "GRAPHIFY_REMOTE_MEMIFY_ACCEPTED" in result["warnings"]


def test_graphify_memify_remote_http_error(monkeypatch):
    import httpx

    req = httpx.Request("POST", "https://graph.example.com/memify")
    resp = httpx.Response(502, request=req, text="bad gateway")

    class _DummyResponse:
        status_code = 502
        text = "bad gateway"

        def raise_for_status(self):
            raise httpx.HTTPStatusError("bad gateway", request=req, response=resp)

        def json(self):
            return {}

    monkeypatch.setattr(httpx, "post", lambda *a, **kw: _DummyResponse())
    cfg = GraphifyConfig(endpoint="https://graph.example.com")
    result = graphify_memify(cfg, pipeline_type="default", dataset_scope=[], dry_run=False)
    assert result["status"] == "failed"
    assert "GRAPHIFY_REMOTE_MEMIFY_HTTP_ERROR" in result["warnings"]
