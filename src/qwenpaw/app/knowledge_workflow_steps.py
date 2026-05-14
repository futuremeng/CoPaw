# -*- coding: utf-8 -*-

from __future__ import annotations

import json
from pathlib import Path

# ---------------------------------------------------------------------------
# Authoritative JSON source – single source of truth for the built-in
# knowledge-processing pipeline step definitions.
# ---------------------------------------------------------------------------

_BUILTIN_PIPELINE_JSON_PATH = Path(__file__).parent / "pipelines" / "builtin-knowledge-processing-v1.json"


def _load_builtin_pipeline_doc() -> dict:
    """Load and return the authoritative builtin pipeline JSON document."""
    if not _BUILTIN_PIPELINE_JSON_PATH.exists():
        raise RuntimeError(
            f"Authoritative pipeline definition not found: {_BUILTIN_PIPELINE_JSON_PATH}"
        )
    return json.loads(_BUILTIN_PIPELINE_JSON_PATH.read_text(encoding="utf-8"))


def _load_builtin_step_specs() -> tuple[dict, ...]:
    """Return step specs loaded from the authoritative JSON file."""
    doc = _load_builtin_pipeline_doc()
    steps = doc.get("steps")
    if not isinstance(steps, list) or not steps:
        raise RuntimeError(
            f"Pipeline JSON contains no steps: {_BUILTIN_PIPELINE_JSON_PATH}"
        )
    return tuple(steps)


# ---------------------------------------------------------------------------
# Public constants – consumed throughout the knowledge workflow stack.
# ---------------------------------------------------------------------------

KNOWLEDGE_WORKFLOW_STEP_SPECS: tuple[dict, ...] = _load_builtin_step_specs()

KNOWLEDGE_WORKFLOW_STEP_IDS: tuple[str, ...] = tuple(
    spec["id"]
    for spec in KNOWLEDGE_WORKFLOW_STEP_SPECS
)