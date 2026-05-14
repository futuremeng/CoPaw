# -*- coding: utf-8 -*-

from __future__ import annotations

KNOWLEDGE_WORKFLOW_STEP_SPECS: tuple[dict[str, str], ...] = (
    {
        "id": "source_scan",
        "name": "Source Scan",
        "kind": "analysis",
        "description": "Inventory project sources and confirm the project-scoped knowledge input boundary.",
        "prompt": "Inventory project sources, confirm input boundary, and output source manifest with counts.",
    },
    {
        "id": "file_analysis",
        "name": "File Analysis",
        "kind": "transform",
        "description": "Parse and index project files into the project-scoped knowledge store.",
        "prompt": "Parse project files, build index records, and emit indexing diagnostics.",
    },
    {
        "id": "domain_graph_build",
        "name": "Domain Graph Build",
        "kind": "transform",
        "description": "Build graph artifacts and domain-level enrichment from indexed project knowledge.",
        "prompt": "Construct domain graph artifacts from indexed data and output enrichment summaries.",
    },
    {
        "id": "quality_review",
        "name": "Quality Review",
        "kind": "validation",
        "description": "Review graph quality, run the quality loop when needed, and summarize next actions.",
        "prompt": "Evaluate quality gates, run remediation loop when needed, and summarize next actions.",
    },
)

KNOWLEDGE_WORKFLOW_STEP_IDS: tuple[str, ...] = tuple(
    spec["id"]
    for spec in KNOWLEDGE_WORKFLOW_STEP_SPECS
)