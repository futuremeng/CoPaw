#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Validate a CoPaw multibook reproducibility run result.

Checks include:
- 8 pipeline steps status coverage
- required artifact patterns
- optional concept tree depth >= target depth
- optional pairwise contrast file count (for 4 books => 6)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from fnmatch import fnmatch
from pathlib import Path
from typing import Any

import httpx

REQUIRED_STEPS = [
    "ingest",
    "normalize",
    "extract",
    "align",
    "build_concept_tree",
    "build_relation_matrix",
    "review_pack",
    "report",
]

REQUIRED_ARTIFACT_PATTERNS = [
    "data/term-workbench-*/manifest.json",
    "data/term-workbench-*/terms.normalized.json",
    "data/term-workbench-*/terms.reviewed.json",
    "data/contrast-*.json",
    "data/concept-trees/*/concept-alignment*.json",
    "data/book-relation-matrix*.json",
    "data/review.dashboard*.json",
    "data/review.ui-payload*.json",
]


def _headers_from_env() -> dict[str, str]:
    token = os.getenv("COPAW_API_TOKEN", "").strip()
    if not token:
        return {}
    return {"Authorization": f"Bearer {token}"}


def _load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("JSON root must be an object")
    return payload


def _fetch_run_detail(
    base_url: str,
    timeout: float,
    agent_id: str,
    project_id: str,
    run_id: str,
) -> dict[str, Any]:
    with httpx.Client(
        base_url=base_url.rstrip("/"),
        headers=_headers_from_env(),
        timeout=timeout,
    ) as client:
        resp = client.get(
            f"/agents/{agent_id}/projects/{project_id}/pipelines/runs/{run_id}",
        )
        resp.raise_for_status()
        payload = resp.json()
        if not isinstance(payload, dict):
            raise ValueError("Run detail payload must be an object")
        return payload


def _collect_artifacts(detail: dict[str, Any]) -> list[str]:
    artifacts = detail.get("artifacts")
    if not isinstance(artifacts, list):
        return []
    return [str(x) for x in artifacts if isinstance(x, str)]


def _validate_steps(detail: dict[str, Any], strict_status: bool) -> list[str]:
    failures: list[str] = []
    steps_raw = detail.get("steps")
    if not isinstance(steps_raw, list):
        return ["Missing steps list"]

    by_id: dict[str, dict[str, Any]] = {}
    for item in steps_raw:
        if isinstance(item, dict):
            step_id = str(item.get("id") or "").strip()
            if step_id:
                by_id[step_id] = item

    missing = [step for step in REQUIRED_STEPS if step not in by_id]
    if missing:
        failures.append(f"Missing required steps: {missing}")

    if strict_status:
        for step_id in REQUIRED_STEPS:
            item = by_id.get(step_id)
            if not item:
                continue
            status = str(item.get("status") or "").lower()
            if status != "succeeded":
                failures.append(f"Step {step_id} not succeeded (status={status})")

    return failures


def _validate_artifacts(artifacts: list[str]) -> list[str]:
    failures: list[str] = []
    for pattern in REQUIRED_ARTIFACT_PATTERNS:
        if not any(fnmatch(path, pattern) for path in artifacts):
            failures.append(f"Missing artifact pattern: {pattern}")
    return failures


def _find_concept_tree_files(project_dir: Path) -> list[Path]:
    data_dir = project_dir / "data"
    if not data_dir.exists():
        return []
    return sorted(data_dir.glob("concept-trees/*/concept-tree*.json"))


def _max_depth_from_tree(node: Any, level: int = 1) -> int:
    if isinstance(node, list):
        if not node:
            return level
        return max(_max_depth_from_tree(item, level) for item in node)

    if isinstance(node, dict):
        child_levels = [level]
        for key in (
            "children",
            "nodes",
            "items",
            "subtopics",
            "concepts",
            "descendants",
        ):
            val = node.get(key)
            if isinstance(val, (dict, list)):
                child_levels.append(_max_depth_from_tree(val, level + 1))
        return max(child_levels)

    return level


def _validate_depth(project_dir: Path, min_depth: int) -> tuple[list[str], int]:
    files = _find_concept_tree_files(project_dir)
    if not files:
        return (["No concept-tree*.json files found for depth validation"], 0)

    max_depth = 0
    failures: list[str] = []
    for path in files:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            depth = _max_depth_from_tree(payload, level=1)
            max_depth = max(max_depth, depth)
        except Exception as exc:
            failures.append(f"Failed to parse {path}: {exc}")

    if max_depth < min_depth:
        failures.append(f"Concept tree depth too shallow: max_depth={max_depth}, required>={min_depth}")

    return failures, max_depth


def _count_pairwise_contrast(artifacts: list[str]) -> int:
    return len([path for path in artifacts if fnmatch(path, "data/contrast-*.json")])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate multibook reproducibility run outputs")
    parser.add_argument("--run-detail", default="", help="Path to run detail JSON")
    parser.add_argument("--base-url", default="http://127.0.0.1:8088", help="CoPaw API base url")
    parser.add_argument("--agent-id", default="", help="Agent ID (when fetching from API)")
    parser.add_argument("--project-id", default="", help="Project ID (when fetching from API)")
    parser.add_argument("--run-id", default="", help="Run ID (when fetching from API)")
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout seconds")
    parser.add_argument("--project-dir", default="", help="Project directory for depth validation")
    parser.add_argument("--min-depth", type=int, default=8, help="Minimum concept tree depth")
    parser.add_argument("--strict-status", action="store_true", help="Require each required step status == succeeded")
    parser.add_argument(
        "--require-pairwise-count",
        type=int,
        default=6,
        help="Expected minimum count of data/contrast-*.json files",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        if args.run_detail.strip():
            detail = _load_json(Path(args.run_detail))
        else:
            if not (args.agent_id and args.project_id and args.run_id):
                print(
                    "[error] Use --run-detail or provide --agent-id --project-id --run-id",
                    file=sys.stderr,
                )
                return 2
            detail = _fetch_run_detail(
                args.base_url,
                args.timeout,
                args.agent_id,
                args.project_id,
                args.run_id,
            )
    except Exception as exc:
        print(f"[error] Unable to read run detail: {exc}", file=sys.stderr)
        return 2

    failures: list[str] = []
    artifacts = _collect_artifacts(detail)

    run_status = str(detail.get("status") or "").lower()
    print(f"[info] run_status={run_status}")
    print(f"[info] artifacts={len(artifacts)}")

    failures.extend(_validate_steps(detail, strict_status=args.strict_status))
    failures.extend(_validate_artifacts(artifacts))

    pairwise_count = _count_pairwise_contrast(artifacts)
    print(f"[info] contrast_json_count={pairwise_count}")
    if pairwise_count < args.require_pairwise_count:
        failures.append(
            "Pairwise contrast count too low: "
            f"found={pairwise_count}, required>={args.require_pairwise_count}"
        )

    max_depth = 0
    if args.project_dir.strip():
        depth_failures, max_depth = _validate_depth(Path(args.project_dir), args.min_depth)
        failures.extend(depth_failures)
        print(f"[info] concept_tree_max_depth={max_depth}")
    else:
        print("[warn] --project-dir not provided, skipped concept tree depth validation")

    if failures:
        print("[result] FAILED")
        for item in failures:
            print(f"  - {item}")
        return 1

    print("[result] PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
