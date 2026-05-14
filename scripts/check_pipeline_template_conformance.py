#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Scan pipeline template JSON files and report conformance issues.

What it checks:
1) JSON parse and shape validity
2) Template parsing with backend canonical parser
3) Structured validation errors attached to templates

Default behavior exits non-zero when issues are found.
Use --allow-invalid for informational scanning.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from qwenpaw.app.routers.agents_pipeline_core import (  # noqa: E402
    PipelineValidationError,
    _parse_pipeline_template_doc,
)


def _collect_template_files(scan_root: Path) -> list[Path]:
    patterns = [
        "**/.pipelines/templates/*.json",
        "**/pipelines/templates/*.json",
        "**/pipelines/platform-templates/*.json",
        "src/qwenpaw/agents/skills/pipeline/example-*.json",
    ]
    found: dict[str, Path] = {}
    for pattern in patterns:
        for path in scan_root.glob(pattern):
            if not path.is_file():
                continue
            found[str(path.resolve())] = path
    return sorted(found.values(), key=lambda p: p.as_posix())


def _classify_template_scope(path: Path) -> str:
    p = path.as_posix()
    if "/src/qwenpaw/agents/skills/pipeline/example-" in p:
        return "skill-example"
    if "/.pipelines/templates/" in p:
        return "project"
    if "/pipelines/platform-templates/" in p:
        return "platform"
    if "/pipelines/templates/" in p:
        return "agent"
    return "unknown"


def _normalize_error(err: PipelineValidationError) -> dict[str, Any]:
    return {
        "error_code": err.error_code,
        "field_path": err.field_path,
        "step_id": err.step_id,
        "message": err.message,
        "expected": err.expected,
        "actual": err.actual,
        "suggestion": err.suggestion,
    }


def scan_templates(scan_root: Path) -> dict[str, Any]:
    files = _collect_template_files(scan_root)
    issues: list[dict[str, Any]] = []
    scanned: list[dict[str, Any]] = []

    for path in files:
        rel = path.relative_to(scan_root).as_posix()
        scope = _classify_template_scope(path)
        entry = {"path": rel, "scope": scope, "template_id": path.stem}

        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            issues.append(
                {
                    **entry,
                    "severity": "error",
                    "category": "json_parse",
                    "message": str(exc),
                }
            )
            continue

        if not isinstance(raw, dict):
            issues.append(
                {
                    **entry,
                    "severity": "error",
                    "category": "json_shape",
                    "message": "Template document must be a JSON object.",
                }
            )
            continue

        parsed = _parse_pipeline_template_doc(raw, fallback_id=path.stem)
        if parsed is None:
            issues.append(
                {
                    **entry,
                    "severity": "error",
                    "category": "template_parse",
                    "message": "Template cannot be parsed to PipelineTemplateInfo.",
                }
            )
            continue

        parsed_entry = {
            **entry,
            "template_id": parsed.id,
            "name": parsed.name,
            "version": parsed.version,
            "compilation_status": parsed.compilation_status,
        }
        scanned.append(parsed_entry)

        if parsed.validation_errors:
            issues.append(
                {
                    **parsed_entry,
                    "severity": "error",
                    "category": "validation",
                    "message": "Template has validation errors.",
                    "errors": [_normalize_error(item) for item in parsed.validation_errors],
                }
            )

    report = {
        "scan_root": scan_root.as_posix(),
        "summary": {
            "files_discovered": len(files),
            "templates_parsed": len(scanned),
            "templates_with_issues": len(
                {item["path"] for item in issues if item.get("category") == "validation"}
            ),
            "issues_total": len(issues),
        },
        "templates": scanned,
        "issues": issues,
    }
    return report


def _print_text_report(report: dict[str, Any]) -> None:
    summary = report["summary"]
    print("Pipeline Template Conformance Scan")
    print(f"scan_root: {report['scan_root']}")
    print(f"files_discovered: {summary['files_discovered']}")
    print(f"templates_parsed: {summary['templates_parsed']}")
    print(f"templates_with_issues: {summary['templates_with_issues']}")
    print(f"issues_total: {summary['issues_total']}")

    if not report["issues"]:
        print("\nNo conformance issues found.")
        return

    print("\nIssues:")
    for item in report["issues"]:
        print(
            f"- [{item.get('severity', 'error')}] {item['category']} "
            f"{item['path']} ({item.get('template_id', '-')})"
        )
        print(f"  message: {item['message']}")
        for detail in item.get("errors", []):
            print(
                "  - "
                f"{detail['error_code']} @ {detail['field_path']} "
                f"(step={detail.get('step_id') or '-'})"
            )
            print(f"    {detail['message']}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan pipeline template conformance.")
    parser.add_argument(
        "--root",
        default=".",
        help="Workspace root to scan (default: current directory).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print machine-readable JSON report.",
    )
    parser.add_argument(
        "--allow-invalid",
        action="store_true",
        help="Always return exit code 0 even when issues are found.",
    )
    args = parser.parse_args()

    scan_root = Path(args.root).resolve()
    report = scan_templates(scan_root)

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        _print_text_report(report)

    has_issues = bool(report["issues"])
    if has_issues and not args.allow_invalid:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
