#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Trigger and optionally wait for a CoPaw project pipeline run.

This script is designed for the 24h multi-book terminology reproducibility sprint.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

TERMINAL_RUN_STATUSES = {"succeeded", "failed", "cancelled", "blocked"}


def _headers_from_env() -> dict[str, str]:
    token = os.getenv("COPAW_API_TOKEN", "").strip()
    if not token:
        return {}
    return {"Authorization": f"Bearer {token}"}


def _build_client(base_url: str, timeout: float) -> httpx.Client:
    return httpx.Client(
        base_url=base_url.rstrip("/"),
        headers=_headers_from_env(),
        timeout=timeout,
    )


def _get_templates(client: httpx.Client, agent_id: str, project_id: str) -> list[dict[str, Any]]:
    resp = client.get(
        f"/agents/{agent_id}/projects/{project_id}/pipelines/templates",
    )
    resp.raise_for_status()
    data = resp.json()
    return data if isinstance(data, list) else []


def _create_run(
    client: httpx.Client,
    agent_id: str,
    project_id: str,
    template_id: str,
    parameters: dict[str, Any],
) -> dict[str, Any]:
    resp = client.post(
        f"/agents/{agent_id}/projects/{project_id}/pipelines/runs",
        json={"template_id": template_id, "parameters": parameters},
    )
    resp.raise_for_status()
    payload = resp.json()
    if not isinstance(payload, dict):
        raise RuntimeError("Unexpected create run response")
    return payload


def _get_run_detail(
    client: httpx.Client,
    agent_id: str,
    project_id: str,
    run_id: str,
) -> dict[str, Any]:
    resp = client.get(
        f"/agents/{agent_id}/projects/{project_id}/pipelines/runs/{run_id}",
    )
    resp.raise_for_status()
    payload = resp.json()
    if not isinstance(payload, dict):
        raise RuntimeError("Unexpected run detail response")
    return payload


def _step_status_brief(detail: dict[str, Any]) -> str:
    steps = detail.get("steps")
    if not isinstance(steps, list):
        return "steps=0"
    counts: dict[str, int] = {}
    for item in steps:
        if not isinstance(item, dict):
            continue
        status = str(item.get("status") or "unknown").lower()
        counts[status] = counts.get(status, 0) + 1
    parts = [f"{k}:{counts[k]}" for k in sorted(counts)]
    return ", ".join(parts) if parts else "steps=0"


def _load_parameters(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if not text:
        return {}

    path = Path(text)
    if path.exists():
        content = path.read_text(encoding="utf-8")
        obj = json.loads(content)
    else:
        obj = json.loads(text)

    if not isinstance(obj, dict):
        raise ValueError("Parameters must be a JSON object")
    return obj


def _save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Start and monitor one project pipeline run for multibook reproducibility.",
    )
    parser.add_argument("--base-url", default="http://127.0.0.1:8088", help="CoPaw API base url")
    parser.add_argument("--agent-id", required=True, help="Agent ID")
    parser.add_argument("--project-id", required=True, help="Project ID")
    parser.add_argument("--template-id", default="books-alignment-v1", help="Pipeline template ID")
    parser.add_argument(
        "--parameters",
        default="{}",
        help="Run parameters JSON text or path to JSON file",
    )
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout seconds")
    parser.add_argument("--wait", action="store_true", help="Poll until terminal status")
    parser.add_argument("--poll-interval", type=float, default=5.0, help="Polling interval seconds")
    parser.add_argument("--wait-timeout", type=float, default=7200.0, help="Max wait seconds")
    parser.add_argument(
        "--output",
        default="",
        help="Output path for final run detail JSON (default: logs/multibook-run-<run_id>.json)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        parameters = _load_parameters(args.parameters)
    except Exception as exc:
        print(f"[error] Invalid --parameters: {exc}", file=sys.stderr)
        return 2

    with _build_client(args.base_url, timeout=args.timeout) as client:
        try:
            templates = _get_templates(client, args.agent_id, args.project_id)
        except Exception as exc:
            print(f"[error] Failed to fetch templates: {exc}", file=sys.stderr)
            return 2

        template_ids = {str(item.get("id")) for item in templates if isinstance(item, dict)}
        if args.template_id not in template_ids:
            print(
                f"[error] Template '{args.template_id}' not found. Available: {sorted(template_ids)}",
                file=sys.stderr,
            )
            return 2

        try:
            created = _create_run(
                client,
                args.agent_id,
                args.project_id,
                args.template_id,
                parameters,
            )
        except Exception as exc:
            print(f"[error] Failed to create run: {exc}", file=sys.stderr)
            return 2

        run_id = str(created.get("id") or "")
        run_status = str(created.get("status") or "pending")
        if not run_id:
            print("[error] Missing run id in create response", file=sys.stderr)
            return 2

        print(f"[ok] Created run: {run_id}")
        print(f"[info] Initial status: {run_status}")

        final_detail = created
        if args.wait:
            start = time.time()
            last_status = ""
            while True:
                try:
                    detail = _get_run_detail(client, args.agent_id, args.project_id, run_id)
                except Exception as exc:
                    print(f"[warn] Poll failed: {exc}")
                    time.sleep(args.poll_interval)
                    continue

                status = str(detail.get("status") or "pending").lower()
                if status != last_status:
                    brief = _step_status_brief(detail)
                    print(f"[poll] status={status} | {brief}")
                    last_status = status
                final_detail = detail

                if status in TERMINAL_RUN_STATUSES:
                    break
                if time.time() - start > args.wait_timeout:
                    print(
                        f"[error] Wait timeout after {args.wait_timeout:.0f}s",
                        file=sys.stderr,
                    )
                    return 3
                time.sleep(args.poll_interval)

        if args.output.strip():
            out_path = Path(args.output)
        else:
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            out_path = Path("logs") / f"multibook-run-{run_id}-{stamp}.json"

        _save_json(out_path, final_detail)
        print(f"[ok] Run detail saved: {out_path}")

        final_status = str(final_detail.get("status") or "pending").lower()
        print(f"[result] run_id={run_id} status={final_status}")
        return 0 if final_status in {"pending", "running", "succeeded"} else 1


if __name__ == "__main__":
    raise SystemExit(main())
