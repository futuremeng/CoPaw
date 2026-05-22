#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any
from urllib import error, parse, request


@dataclass
class VerificationResult:
    ok: bool
    status: str
    project_id: str
    api_base: str
    required_artifacts: list[str]
    optional_artifacts: list[str]
    missing_required: list[str]
    missing_optional: list[str]
    created_input_file: str | None
    status_payload: dict[str, Any]
    run_payload: dict[str, Any]


def _http_json(
    method: str,
    url: str,
    payload: dict[str, Any] | None,
    headers: dict[str, str],
    timeout: float,
) -> dict[str, Any]:
    data = None
    req_headers = {
        "Content-Type": "application/json",
        **headers,
    }
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = request.Request(url=url, method=method.upper(), data=data, headers=req_headers)
    try:
        with request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            if not raw.strip():
                return {}
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {"raw": parsed}
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace") if exc.fp is not None else ""
        detail: dict[str, Any]
        try:
            parsed = json.loads(body)
            detail = parsed if isinstance(parsed, dict) else {"raw": parsed}
        except Exception:
            detail = {"raw": body}
        raise RuntimeError(f"HTTP {exc.code} {url}: {detail}") from exc


def _exists_any(project_dir: Path, pattern: str) -> bool:
    return any(project_dir.glob(pattern))


def _collect_artifact_state(project_dir: Path) -> tuple[list[str], list[str], list[str], list[str]]:
    required = [
        ".knowledge/sources/*/index.json",
        ".knowledge/graphify-out/graph.json",
        ".knowledge/graphify-out/graph.enriched.json",
        ".knowledge/graphify-out/enrichment-quality-report.json",
        ".knowledge/stats/source_scan/latest.json",
        ".knowledge/stats/domain_graph_build/latest.json",
        ".knowledge/stats/quality_review/latest.json",
    ]
    optional = [
        ".knowledge/stats/file_analysis/latest.json",
        ".knowledge/stats/source_scan/history.jsonl",
        ".knowledge/stats/domain_graph_build/history.jsonl",
        ".knowledge/stats/quality_review/history.jsonl",
    ]
    missing_required = [item for item in required if not _exists_any(project_dir, item)]
    missing_optional = [item for item in optional if not _exists_any(project_dir, item)]
    return required, optional, missing_required, missing_optional


def _ensure_minimal_input(project_dir: Path, relative_path: str) -> str | None:
    target = (project_dir / relative_path).resolve()
    if not str(target).startswith(str(project_dir.resolve())):
        raise ValueError("--input-relative-path escapes project directory")
    if target.exists():
        return None

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        "# Project Knowledge Input\n\n"
        "This is a minimal source file for Project Knowledge Pipeline end-to-end verification.\n",
        encoding="utf-8",
    )
    return target.relative_to(project_dir).as_posix()


def _wait_for_status(
    *,
    api_base: str,
    project_id: str,
    agent_id: str,
    timeout_sec: float,
    poll_interval_sec: float,
) -> dict[str, Any]:
    start = time.monotonic()
    status_url = f"{api_base.rstrip('/')}/knowledge/project-pipeline/status?project_id={parse.quote(project_id)}"
    headers = {"X-Agent-Id": agent_id}

    last_payload: dict[str, Any] = {}
    while True:
        payload = _http_json("GET", status_url, None, headers=headers, timeout=20)
        last_payload = payload
        status = str(payload.get("status") or "").strip().lower()
        if status in {"succeeded", "failed"}:
            return payload

        # Some deployments may quickly fall back to idle after finishing.
        if status == "idle" and payload.get("last_finished_at"):
            return payload

        if (time.monotonic() - start) >= timeout_sec:
            return payload
        time.sleep(max(0.2, poll_interval_sec))


def run_verification(args: argparse.Namespace) -> VerificationResult:
    workspace = Path(args.workspace).expanduser().resolve()
    project_dir = (workspace / "projects" / args.project_id).resolve()
    if not project_dir.exists() or not project_dir.is_dir():
        raise RuntimeError(f"Project directory not found: {project_dir}")

    created_input = _ensure_minimal_input(project_dir, args.input_relative_path)

    run_url = f"{args.api_base.rstrip('/')}/knowledge/project-pipeline/run?project_id={parse.quote(args.project_id)}"
    headers = {"X-Agent-Id": args.agent_id}
    run_payload = _http_json(
        "POST",
        run_url,
        {
            "trigger": args.trigger,
            "force": bool(args.force),
            "processing_mode": args.processing_mode,
        },
        headers=headers,
        timeout=30,
    )

    status_payload = _wait_for_status(
        api_base=args.api_base,
        project_id=args.project_id,
        agent_id=args.agent_id,
        timeout_sec=float(args.timeout_sec),
        poll_interval_sec=float(args.poll_interval_sec),
    )

    required, optional, missing_required, missing_optional = _collect_artifact_state(project_dir)
    final_status = str(status_payload.get("status") or "").strip().lower()

    ok = final_status in {"succeeded", "idle"} and not missing_required
    return VerificationResult(
        ok=ok,
        status=final_status,
        project_id=args.project_id,
        api_base=args.api_base,
        required_artifacts=required,
        optional_artifacts=optional,
        missing_required=missing_required,
        missing_optional=missing_optional,
        created_input_file=created_input,
        status_payload=status_payload,
        run_payload=run_payload,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Verify Project Knowledge Pipeline end-to-end on one raw file.",
    )
    parser.add_argument("--workspace", default=".", help="Workspace root path")
    parser.add_argument("--project-id", required=True, help="Project id under projects/<project-id>")
    parser.add_argument("--api-base", default="http://127.0.0.1:8088", help="Backend API base URL")
    parser.add_argument("--agent-id", default="default", help="Agent id sent in X-Agent-Id header")
    parser.add_argument(
        "--input-relative-path",
        default="data/e2e-raw-input.md",
        help="Create this file when missing before triggering sync",
    )
    parser.add_argument("--processing-mode", default="agentic", choices=["fast", "nlp", "agentic"])
    parser.add_argument("--trigger", default="manual-e2e-verify")
    parser.add_argument("--force", action="store_true", default=True, help="Force project pipeline run")
    parser.add_argument("--no-force", action="store_false", dest="force", help="Do not force project pipeline run")
    parser.add_argument("--timeout-sec", type=float, default=300.0)
    parser.add_argument("--poll-interval-sec", type=float, default=2.0)
    parser.add_argument(
        "--report-path",
        default=".knowledge/e2e-project-knowledge-report.json",
        help="Report path relative to project dir",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        result = run_verification(args)
    except Exception as exc:
        print(f"[verify] ERROR: {exc}", file=sys.stderr)
        return 2

    workspace = Path(args.workspace).expanduser().resolve()
    project_dir = (workspace / "projects" / args.project_id).resolve()
    report_path = (project_dir / args.report_path).resolve()
    if not str(report_path).startswith(str(project_dir)):
        print("[verify] ERROR: --report-path escapes project directory", file=sys.stderr)
        return 2

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(asdict(result), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    print(f"[verify] project={result.project_id} status={result.status} ok={result.ok}")
    if result.created_input_file:
        print(f"[verify] created input: {result.created_input_file}")
    if result.missing_required:
        print("[verify] missing required artifacts:")
        for item in result.missing_required:
            print(f"  - {item}")
    if result.missing_optional:
        print("[verify] missing optional artifacts:")
        for item in result.missing_optional:
            print(f"  - {item}")
    print(f"[verify] report: {report_path}")

    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
