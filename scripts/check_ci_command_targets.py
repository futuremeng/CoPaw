#!/usr/bin/env python
"""Fail when a GitHub workflow runs a package.json script that does not exist.

Conflict-surface judgment 20: the fork can edit its own ``console/package.json``
and thereby break an upstream-owned workflow entry.  ``frontend-tests.yml`` kept
calling ``npm run test:run`` / ``npm run test:coverage`` after a merge had already
dropped those two scripts, so the frontend job died with "Missing script" and none
of the console tests ran.  This guard turns that into a failing check.

Usage:
    python scripts/check_ci_command_targets.py                  # check this repo
    python scripts/check_ci_command_targets.py --repo-root DIR   # check a fixture
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

import yaml

RUN_COMMAND_RE = re.compile(r"\b(?:npm|pnpm|yarn)\s+run\s+([A-Za-z0-9:@._-]+)")
CD_RE = re.compile(r"\bcd\s+([^\s&;|]+)")
SEGMENT_RE = re.compile(r"&&|[;\n]")


def _run_defaults(container: dict) -> str | None:
    defaults = container.get("defaults")
    if not isinstance(defaults, dict):
        return None
    run = defaults.get("run")
    return run.get("working-directory") if isinstance(run, dict) else None


def resolve_working_directory(step: dict, job_default: str | None) -> str | None:
    return step.get("working-directory") or _run_defaults(step) or job_default


def commands_in_run(script: str) -> list[tuple[str | None, str]]:
    """Pair each ``npm run <script>`` with the ``cd`` that precedes it, if any."""
    found: list[tuple[str | None, str]] = []
    pending_dir: str | None = None
    for segment in SEGMENT_RE.split(script):
        cd_match = CD_RE.search(segment)
        if cd_match:
            pending_dir = cd_match.group(1)
        for match in RUN_COMMAND_RE.finditer(segment):
            found.append((pending_dir, match.group(1)))
    return found


def load_scripts(package_json: Path) -> dict[str, Any]:
    with package_json.open("r", encoding="utf-8") as handle:
        return json.load(handle).get("scripts", {}) or {}


def collect(repo_root: Path) -> list[tuple[str, str, str]]:
    """Return (workflow:job, package directory, script name) per run command."""
    entries: list[tuple[str, str, str]] = []
    workflows = sorted((repo_root / ".github" / "workflows").glob("*.y*ml"))
    for workflow in workflows:
        document = yaml.safe_load(workflow.read_text(encoding="utf-8"))
        jobs = document.get("jobs") if isinstance(document, dict) else None
        if not isinstance(jobs, dict):
            continue
        for job_name, job in jobs.items():
            if not isinstance(job, dict) or job.get("uses"):
                continue
            job_default = _run_defaults(job)
            for step in job.get("steps") or []:
                if not isinstance(step, dict) or not isinstance(step.get("run"), str):
                    continue
                directory = resolve_working_directory(step, job_default) or "."
                for cd_target, script_name in commands_in_run(step["run"]):
                    entries.append(
                        (f"{workflow.name}:{job_name}", cd_target or directory, script_name)
                    )
    return entries


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
    )
    args = parser.parse_args(argv)
    repo_root = args.repo_root.resolve()

    errors: list[str] = []
    checked = 0
    packages: dict[str, dict[str, Any]] = {}
    for location, directory, script_name in collect(repo_root):
        checked += 1
        if directory not in packages:
            package_json = repo_root / directory / "package.json"
            if not package_json.exists():
                errors.append(
                    f"{location} runs '{script_name}' in {directory}, "
                    f"which has no package.json"
                )
                continue
            packages[directory] = load_scripts(package_json)
        available = packages.get(directory, {})
        if script_name not in available:
            errors.append(
                f"{location} runs 'npm run {script_name}' in {directory}, "
                f"but {directory}/package.json has no such script"
            )

    if errors:
        for item in errors:
            print(f"ERROR: {item}")
        return 1

    print(
        f"CI command target check passed ({checked} run commands across "
        f"{len(packages)} package dirs)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
