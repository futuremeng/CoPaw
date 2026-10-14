# -*- coding: utf-8 -*-
"""A ratchet gate that cannot read its baseline is not a gate.

``scripts/check_p1_invariants.py`` resolves the fork point with
``git ls-tree`` / ``git diff`` on ``DEFAULT_BASE_REF``, so it needs the
ancestor commit's objects.  ``actions/checkout@v4`` defaults to
``fetch-depth: 1``, which downloads only HEAD.

Measured on 2026-10-14 in CI (run 38517772699, job ``Unit Tests - py3.11``)
and in the three completed runs before it (2026-10-09 at the previous
baseline ``e111ec6fb``, 2026-10-13 twice): the gate step aborts with
``subprocess.CalledProcessError: Command '['git', 'ls-tree', '-r',
'--name-only', '2744a976b']' returned non-zero exit status 128``, and every
step after it in that job -- the unit leg, the "fail loudly if nothing was
collected" check and the L1 hard gate -- reports ``-`` and never runs.  The
check has exactly one enforcement point in the repository, this workflow, so
the ratchet currently has no working guard rail anywhere but a developer's
full clone.
"""

from __future__ import annotations

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = REPO_ROOT / ".github/workflows/unit-tests.yml"
BASELINE_SCRIPT = "check_p1_invariants.py"


def _jobs_running(script: str) -> list[tuple[str, dict]]:
    document = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    jobs = []
    for name, job in (document.get("jobs") or {}).items():
        for step in job.get("steps") or []:
            run = step.get("run")
            if isinstance(run, str) and script in run:
                jobs.append((name, job))
                break
    return jobs


def test_gate_that_reads_the_baseline_checks_out_full_history():
    jobs = _jobs_running(BASELINE_SCRIPT)
    assert jobs, f"no job runs {BASELINE_SCRIPT}; revisit this guard"
    for name, job in jobs:
        checkouts = [
            step
            for step in job.get("steps") or []
            if str(step.get("uses", "")).startswith("actions/checkout@")
        ]
        assert checkouts, f"{name} has no checkout step"
        depths = [
            str((step.get("with") or {}).get("fetch-depth"))
            for step in checkouts
        ]
        assert "0" in depths, (
            f"{name} checks out at {depths}: {BASELINE_SCRIPT} cannot "
            "resolve the fork point from a shallow clone"
        )
