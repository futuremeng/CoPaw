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

The second case guards the same job's other invisible contract, its time
budget: a step that finally gets to run can still be killed by
``timeout-minutes``, which turns the must-pass steps after it into ``skipped``
rather than green.
"""

from __future__ import annotations

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = REPO_ROOT / ".github/workflows/unit-tests.yml"
BASELINE_SCRIPT = "check_p1_invariants.py"
FULL_UNIT_LEG = "Run all unit tests"
# Measured in CI (run 38526622361) from the per-step timestamps: on the
# slower leg the suite was at 93% after 807 s when the 15-minute cap killed
# it, so the whole leg needs about 870 s; plus install 87 s, the three gates
# 7 s, checkout/setup 11 s, the collect check 16 s and the L1 gate 10 s --
# roughly 1,000 s, i.e. 17 minutes.  30 is that worst path with room for
# runner variance.
MIN_UNIT_LEG_MINUTES = 30


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


def test_leg_running_the_whole_unit_suite_has_a_time_budget():
    document = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    legs = [
        (name, job)
        for name, job in (document.get("jobs") or {}).items()
        if any(
            str(step.get("name", "")).startswith(FULL_UNIT_LEG)
            for step in job.get("steps") or []
        )
    ]
    assert legs, "no job runs the whole unit suite; revisit this guard"
    for name, job in legs:
        budget = job.get("timeout-minutes")
        assert isinstance(budget, int) and budget >= MIN_UNIT_LEG_MINUTES, (
            f"{name} budgets {budget} minutes for a leg measured at about "
            "17 minutes of work in CI; the cap kills it mid-suite and the "
            "must-pass steps after it report skipped"
        )
