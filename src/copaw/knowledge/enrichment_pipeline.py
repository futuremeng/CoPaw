# -*- coding: utf-8 -*-
"""System-level knowledge enrichment pipeline (L2).

This module performs a lightweight post-processing pass on top of a base graph
(L1) and emits an enriched graph plus a quality report. The first version keeps
structure-compatible payloads and only adds metadata fields for safer rollout.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


@dataclass
class EnrichmentResult:
    status: str
    warnings: list[str]
    enriched_graph_path: str
    quality_report_path: str
    metrics: dict[str, Any]


_RELATION_NORMALIZATION_MAP = {
    "mention": "mentions",
    "mentioned": "mentions",
    "mentions": "mentions",
    "co_occurs": "co_occurs_with",
    "co_occurs_with": "co_occurs_with",
    "co-occurs-with": "co_occurs_with",
    "related": "related_to",
    "related_to": "related_to",
    "depends": "depends_on",
    "depends_on": "depends_on",
    "calls": "calls",
    "uses": "uses",
}


def _now_iso() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _normalize_relation(raw_relation: str) -> str:
    relation = str(raw_relation or "").strip().lower()
    relation = relation.replace(" ", "_")
    if not relation:
        return "related_to"
    return _RELATION_NORMALIZATION_MAP.get(relation, relation)


def _parse_confidence(raw: Any) -> float:
    if isinstance(raw, (int, float)):
        value = float(raw)
        if value > 1:
            value = value / 100.0
        return max(0.0, min(1.0, value))

    text = str(raw or "").strip().lower()
    if not text:
        return 0.5

    matched = re.search(r"\d+(?:\.\d+)?", text)
    if matched:
        value = float(matched.group(0))
        if "%" in text or value > 1:
            value = value / 100.0
        return max(0.0, min(1.0, value))

    symbolic = {
        "derived": 0.45,
        "inferred": 0.6,
        "extracted": 0.8,
        "high": 0.85,
        "medium": 0.6,
        "low": 0.35,
    }
    return symbolic.get(text, 0.5)


def _canonical_key(raw_label: Any) -> str:
    label = str(raw_label or "").strip().lower()
    label = re.sub(r"\s+", " ", label)
    label = re.sub(r"[^a-z0-9\u4e00-\u9fff _.-]+", "", label)
    return label.strip(" ._-")


def run_system_knowledge_enrichment(
    *,
    source_graph_path: Path,
    enriched_graph_path: Path,
    quality_report_path: Path,
    pipeline_id: str,
) -> EnrichmentResult:
    """Run system-level graph enrichment and write enriched artifacts."""
    payload = json.loads(source_graph_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("graph payload must be a JSON object")

    nodes = payload.get("nodes") or []
    links = payload.get("links") or []
    if not isinstance(nodes, list) or not isinstance(links, list):
        raise ValueError("graph payload must contain nodes[] and links[]")

    relation_normalized_count = 0
    low_confidence_edges = 0
    missing_evidence_edges = 0
    canonicalized_nodes = 0

    for node in nodes:
        if not isinstance(node, dict):
            continue
        canonical = _canonical_key(node.get("label"))
        if canonical and canonical != str(node.get("label") or "").strip().lower():
            canonicalized_nodes += 1
        node["canonical_key"] = canonical
        node["canonical_label"] = str(node.get("label") or "").strip()

    for edge in links:
        if not isinstance(edge, dict):
            continue
        original_relation = str(edge.get("relation") or "")
        normalized_relation = _normalize_relation(original_relation)
        if normalized_relation != original_relation:
            relation_normalized_count += 1
        edge["relation_original"] = original_relation
        edge["relation"] = normalized_relation

        calibrated = _parse_confidence(edge.get("confidence"))
        edge["confidence_calibrated"] = round(calibrated, 4)
        if calibrated < 0.35:
            low_confidence_edges += 1

        evidence = {
            "document_path": str(edge.get("document_path") or "").strip(),
            "document_title": str(edge.get("document_title") or "").strip(),
            "source_id": str(edge.get("source_id") or "").strip(),
        }
        edge["evidence"] = evidence
        if not (evidence["document_path"] or evidence["document_title"]):
            missing_evidence_edges += 1

    metrics = {
        "node_count": len([n for n in nodes if isinstance(n, dict)]),
        "edge_count": len([e for e in links if isinstance(e, dict)]),
        "relation_normalized_count": relation_normalized_count,
        "entity_canonicalized_count": canonicalized_nodes,
        "low_confidence_edges": low_confidence_edges,
        "missing_evidence_edges": missing_evidence_edges,
    }

    payload["_copaw_enrichment"] = {
        "pipeline_id": pipeline_id,
        "version": "0.1.0",
        "generated_at": _now_iso(),
        "source_graph_path": str(source_graph_path),
        "metrics": metrics,
    }

    enriched_graph_path.parent.mkdir(parents=True, exist_ok=True)
    quality_report_path.parent.mkdir(parents=True, exist_ok=True)

    enriched_graph_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    quality_report_path.write_text(
        json.dumps(
            {
                "pipeline_id": pipeline_id,
                "generated_at": payload["_copaw_enrichment"]["generated_at"],
                "status": "succeeded",
                "metrics": metrics,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    warnings: list[str] = []
    if missing_evidence_edges > 0:
        warnings.append("ENRICHMENT_MISSING_EDGE_EVIDENCE")
    if low_confidence_edges > 0:
        warnings.append("ENRICHMENT_LOW_CONFIDENCE_EDGES")

    return EnrichmentResult(
        status="succeeded",
        warnings=warnings,
        enriched_graph_path=str(enriched_graph_path),
        quality_report_path=str(quality_report_path),
        metrics=metrics,
    )
