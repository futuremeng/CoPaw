# -*- coding: utf-8 -*-
"""Graphify knowledge graph provider adapter.

Supports two modes:

Local file mode (primary)
  config.graph_path points to a ``graphify-out/graph.json`` file previously
  built with ``graphify <dataset_dir>``.  Query traversal is done in-process
  using NetworkX BFS — no subprocess, no network call.

Remote / future hosted mode
  When ``config.endpoint`` is set the adapter will delegate to a hosted
  Graphify service via HTTP.  This path is stubbed with a clear error so it
  can be wired in a later PR without touching the rest of the stack.

Memify (graph build)
  Runs ``graphify <dataset_dir>`` in a subprocess to build / update the graph.
  The job runs synchronously with a configurable timeout; callers are
  responsible for spinning it into a background task if needed.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import httpx

from ..config.config import GraphifyConfig


# ---------------------------------------------------------------------------
# Custom exception types
# ---------------------------------------------------------------------------


class GraphifyError(RuntimeError):
    """Base class for Graphify provider errors."""


class GraphifyNotConfiguredError(GraphifyError):
    """Raised when required config fields are missing."""


class GraphifyLoadError(GraphifyError):
    """Raised when graph.json cannot be loaded or parsed."""


class GraphifyRemoteError(GraphifyError):
    """Raised when remote Graphify endpoint returns an error."""


# ---------------------------------------------------------------------------
# Internal graph helpers (mirrors graphify/serve.py logic)
# ---------------------------------------------------------------------------


def _load_graph_json(graph_path: str) -> Any:
    """Load graph.json and return a networkx.Graph.

    Raises GraphifyLoadError on any file / parse / import failure.
    """
    try:
        import networkx as nx
        from networkx.readwrite import json_graph
    except ImportError as exc:
        raise GraphifyLoadError(
            "networkx is not installed. Run: pip install networkx"
        ) from exc

    path = Path(graph_path)
    if not path.is_file():
        raise GraphifyLoadError(
            f"graph.json not found at '{graph_path}'. "
            "Run 'graphify <dataset_dir>' to build it first."
        )
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise GraphifyLoadError(
            f"Failed to read graph.json at '{graph_path}': {exc}"
        ) from exc

    try:
        try:
            return json_graph.node_link_graph(data, edges="links")
        except TypeError:
            return json_graph.node_link_graph(data)
    except Exception as exc:
        raise GraphifyLoadError(
            f"Failed to parse graph.json: {exc}"
        ) from exc


def _score_nodes(G: Any, terms: list[str]) -> list[tuple[float, str]]:
    scored = []
    for nid, data in G.nodes(data=True):
        label = data.get("label", "").lower()
        source = data.get("source_file", "").lower()
        score = sum(1 for t in terms if t in label) + sum(
            0.5 for t in terms if t in source
        )
        if score > 0:
            scored.append((score, nid))
    return sorted(scored, reverse=True)


def _bfs(G: Any, start_nodes: list[str], depth: int) -> tuple[set[str], list[tuple]]:
    visited: set[str] = set(start_nodes)
    frontier = set(start_nodes)
    edges_seen: list[tuple] = []
    for _ in range(depth):
        next_frontier: set[str] = set()
        for n in frontier:
            for neighbor in G.neighbors(n):
                if neighbor not in visited:
                    next_frontier.add(neighbor)
                    edges_seen.append((n, neighbor))
        visited.update(next_frontier)
        frontier = next_frontier
    return visited, edges_seen


def _subgraph_to_records(
    G: Any,
    nodes: set[str],
    edges: list[tuple],
    top_k: int,
) -> list[dict[str, Any]]:
    """Convert a BFS subgraph into GraphOpsResult-compatible record dicts."""
    # Build edge index for quick lookup
    edge_index: dict[tuple[str, str], dict[str, Any]] = {}
    for u, v in edges:
        if u in nodes and v in nodes:
            edge_index[(u, v)] = G.edges[u, v]

    # Sort by degree so highest-degree nodes come first
    sorted_nodes = sorted(nodes, key=lambda n: G.degree(n), reverse=True)[:top_k]

    records: list[dict[str, Any]] = []
    for nid in sorted_nodes:
        d = G.nodes[nid]
        label = d.get("label", nid)
        source_file = d.get("source_file") or d.get("source_id") or ""
        source_loc = d.get("source_location", "")

        # Gather outgoing edges as "snippet"
        out_edges = []
        for neighbor in G.neighbors(nid):
            if neighbor in nodes:
                edata = G.edges[nid, neighbor]
                rel = edata.get("relation", "")
                conf = edata.get("confidence", "")
                tgt = G.nodes[neighbor].get("label", neighbor)
                if rel:
                    out_edges.append(
                        f"{label} --{rel}[{conf}]--> {tgt}"
                    )

        snippet = "; ".join(out_edges) if out_edges else label
        records.append(
            {
                "subject": label,
                "predicate": "graph_node",
                "object": snippet,
                "score": float(G.degree(nid)),
                "source_id": source_file,
                "source_type": d.get("file_type") or "graph",
                "document_path": source_file,
                "document_title": f"{label} @ {source_loc}" if source_loc else label,
            }
        )
    return records


# ---------------------------------------------------------------------------
# Public query API
# ---------------------------------------------------------------------------


def _build_remote_base_url(endpoint: str) -> str:
    return endpoint.strip().rstrip("/")


def _build_remote_headers(api_key: str) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    token = (api_key or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _normalize_remote_query_records(payload: Any) -> list[dict[str, Any]]:
    """Normalize remote response payload into GraphOps-compatible records."""
    if isinstance(payload, dict):
        if isinstance(payload.get("records"), list):
            raw_records = payload.get("records")
        elif isinstance(payload.get("data"), list):
            raw_records = payload.get("data")
        else:
            raise GraphifyRemoteError(
                "Graphify remote query response missing records/data list."
            )
    elif isinstance(payload, list):
        raw_records = payload
    else:
        raise GraphifyRemoteError("Graphify remote query response is invalid JSON.")

    records: list[dict[str, Any]] = []
    for idx, item in enumerate(raw_records):
        if not isinstance(item, dict):
            continue
        subject = item.get("subject") or item.get("node") or f"node-{idx}"
        predicate = item.get("predicate") or item.get("relation") or "graph_node"
        obj = item.get("object") or item.get("snippet") or item.get("text") or ""
        records.append(
            {
                "subject": str(subject),
                "predicate": str(predicate),
                "object": str(obj),
                "score": float(item.get("score", 0) or 0),
                "source_id": item.get("source_id") or item.get("source") or "",
                "source_type": item.get("source_type") or "graph",
                "document_path": item.get("document_path") or "",
                "document_title": item.get("document_title") or str(subject),
            }
        )
    return records


def _graphify_query_remote(
    config: GraphifyConfig,
    query_text: str,
    top_k: int,
    dataset_scope: list[str] | None,
) -> list[dict[str, Any]]:
    base_url = _build_remote_base_url(config.endpoint)
    if not base_url:
        raise GraphifyNotConfiguredError("Graphify endpoint is empty.")

    payload = {
        "query": query_text,
        "top_k": max(1, int(top_k)),
        "dataset": config.dataset,
        "dataset_scope": dataset_scope or [],
        "bfs_depth": config.bfs_depth,
        "token_budget": config.token_budget,
    }
    headers = _build_remote_headers(config.api_key)
    timeout_sec = max(1.0, float(getattr(config, "request_timeout_sec", 15.0)))

    last_error: Exception | None = None
    for path in ("/query", "/graph/query"):
        url = f"{base_url}{path}"
        try:
            response = httpx.post(url, json=payload, headers=headers, timeout=timeout_sec)
            response.raise_for_status()
            return _normalize_remote_query_records(response.json())
        except httpx.TimeoutException as exc:
            last_error = exc
            continue
        except httpx.HTTPStatusError as exc:
            detail = (exc.response.text or "")[:300]
            raise GraphifyRemoteError(
                f"Graphify remote query failed ({exc.response.status_code}): {detail}"
            ) from exc
        except httpx.HTTPError as exc:
            last_error = exc
            continue
        except ValueError as exc:
            raise GraphifyRemoteError(
                "Graphify remote query returned invalid JSON payload."
            ) from exc

    raise GraphifyRemoteError(
        f"Graphify remote query request failed: {last_error}"
    )


def _graphify_memify_remote(
    config: GraphifyConfig,
    pipeline_type: str,
    dataset_scope: list[str] | None,
    dry_run: bool,
) -> dict[str, Any]:
    base_url = _build_remote_base_url(config.endpoint)
    if not base_url:
        raise GraphifyNotConfiguredError("Graphify endpoint is empty.")

    payload = {
        "dataset": config.dataset,
        "dataset_scope": dataset_scope or [],
        "pipeline_type": pipeline_type,
        "dry_run": bool(dry_run),
    }
    headers = _build_remote_headers(config.api_key)
    timeout_sec = max(1.0, float(getattr(config, "request_timeout_sec", 15.0)))

    last_error: Exception | None = None
    for path in ("/memify", "/graph/memify"):
        url = f"{base_url}{path}"
        try:
            response = httpx.post(url, json=payload, headers=headers, timeout=timeout_sec)
            response.raise_for_status()
            body = response.json()
            if isinstance(body, dict):
                if "status" in body and isinstance(body["status"], str):
                    status = body["status"]
                elif body.get("accepted") is True:
                    status = "running"
                else:
                    status = "succeeded" if dry_run else "running"
                warnings = body.get("warnings") if isinstance(body.get("warnings"), list) else []
                error = body.get("error") if isinstance(body.get("error"), str) else None
                if status == "running":
                    warnings = [*warnings, "GRAPHIFY_REMOTE_MEMIFY_ACCEPTED"]
                return {
                    "status": status,
                    "error": error,
                    "warnings": warnings,
                }
            raise GraphifyRemoteError("Graphify remote memify returned invalid JSON payload.")
        except httpx.TimeoutException as exc:
            last_error = exc
            continue
        except httpx.HTTPStatusError as exc:
            detail = (exc.response.text or "")[:300]
            return {
                "status": "failed",
                "error": f"Graphify remote memify failed ({exc.response.status_code}): {detail}",
                "warnings": ["GRAPHIFY_REMOTE_MEMIFY_HTTP_ERROR"],
            }
        except httpx.HTTPError as exc:
            last_error = exc
            continue
        except ValueError:
            return {
                "status": "failed",
                "error": "Graphify remote memify returned invalid JSON payload.",
                "warnings": ["GRAPHIFY_REMOTE_MEMIFY_BAD_JSON"],
            }

    return {
        "status": "failed",
        "error": f"Graphify remote memify request failed: {last_error}",
        "warnings": ["GRAPHIFY_REMOTE_MEMIFY_REQUEST_FAILED"],
    }


def graphify_query(
    config: GraphifyConfig,
    query_text: str,
    top_k: int,
    dataset_scope: list[str] | None,
) -> list[dict[str, Any]]:
    """Query the Graphify knowledge graph and return records.

    Args:
        config:        GraphifyConfig (graph_path or endpoint must be set).
        query_text:    Natural language query.
        top_k:         Maximum number of records to return.
        dataset_scope: Ignored in local file mode; reserved for remote mode.

    Returns:
        List of record dicts compatible with GraphOpsResult.records.

    Raises:
        GraphifyNotConfiguredError: graph_path and endpoint are both empty.
        GraphifyLoadError:          graph.json cannot be loaded or parsed.
        GraphifyRemoteError:        remote endpoint returned an error.
    """
    if config.endpoint:
        return _graphify_query_remote(
            config=config,
            query_text=query_text,
            top_k=top_k,
            dataset_scope=dataset_scope,
        )

    if not config.graph_path:
        raise GraphifyNotConfiguredError(
            "GraphifyConfig.graph_path is empty. "
            "Set it to the path of your graphify-out/graph.json file, "
            "or set COPAW_GRAPHIFY_GRAPH_PATH environment variable."
        )

    G = _load_graph_json(config.graph_path)

    terms = [t.lower() for t in query_text.split() if len(t) > 2]
    if not terms:
        return []

    scored = _score_nodes(G, terms)
    start_nodes = [nid for _, nid in scored[:3]]
    if not start_nodes:
        return []

    visited, edges = _bfs(G, start_nodes, depth=config.bfs_depth)
    return _subgraph_to_records(G, visited, edges, top_k=top_k)


# ---------------------------------------------------------------------------
# Public memify API
# ---------------------------------------------------------------------------


def graphify_memify(
    config: GraphifyConfig,
    pipeline_type: str,
    dataset_scope: list[str] | None,
    dry_run: bool,
) -> dict[str, Any]:
    """Build / update the Graphify knowledge graph.

    Runs ``graphify <dataset_dir> --no-viz`` as a subprocess using the same
    Python interpreter (so the installed ``graphifyy`` package is found).

    Args:
        config:        GraphifyConfig (dataset_dir must be set).
        pipeline_type: Informational tag stored in the result.
        dataset_scope: Subdirectory filtering hint (reserved, not yet used).
        dry_run:       When True, validates config but does not run graphify.

    Returns:
        Dict with keys: status ("succeeded" | "failed"), error, warnings.

    Raises:
        GraphifyNotConfiguredError: dataset_dir is empty.
    """
    if config.endpoint:
        return _graphify_memify_remote(
            config=config,
            pipeline_type=pipeline_type,
            dataset_scope=dataset_scope,
            dry_run=dry_run,
        )

    if not config.dataset_dir:
        raise GraphifyNotConfiguredError(
            "GraphifyConfig.dataset_dir is empty. "
            "Set it to the directory you want graphify to index, "
            "or set COPAW_GRAPHIFY_DATASET_DIR environment variable."
        )

    dataset_path = Path(config.dataset_dir)
    if not dataset_path.is_dir():
        return {
            "status": "failed",
            "error": f"dataset_dir '{config.dataset_dir}' does not exist.",
            "warnings": ["GRAPHIFY_DATASET_DIR_NOT_FOUND"],
        }

    if dry_run:
        return {
            "status": "succeeded",
            "error": None,
            "warnings": ["GRAPHIFY_MEMIFY_DRY_RUN"],
        }

    cmd = [sys.executable, "-m", "graphify", str(dataset_path), "--no-viz"]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=config.token_budget,  # repurpose as rough time cap in seconds
        )
    except FileNotFoundError as exc:
        return {
            "status": "failed",
            "error": f"graphify CLI not found: {exc}. Run: pip install graphifyy",
            "warnings": ["GRAPHIFY_CLI_NOT_FOUND"],
        }
    except subprocess.TimeoutExpired:
        return {
            "status": "failed",
            "error": "graphify memify timed out.",
            "warnings": ["GRAPHIFY_MEMIFY_TIMEOUT"],
        }

    if result.returncode != 0:
        stderr_snippet = (result.stderr or "")[:500]
        return {
            "status": "failed",
            "error": f"graphify exited with code {result.returncode}: {stderr_snippet}",
            "warnings": ["GRAPHIFY_MEMIFY_NONZERO_EXIT"],
        }

    return {
        "status": "succeeded",
        "error": None,
        "warnings": [],
    }
