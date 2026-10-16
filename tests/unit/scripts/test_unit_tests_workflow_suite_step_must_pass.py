# -*- coding: utf-8 -*-
"""The whole unit suite must be able to redden the job it runs in.

``.github/workflows/unit-tests.yml`` runs the whole ``tests/unit`` selection
under ``continue-on-error: true`` and a step name announcing "pre-existing
failures tolerated".  That flag was written while the leg really was red, and
it makes every later failure invisible: the job reports success and only the
log knows.

Measured on 2026-10-15 (run ``38768155922``, knife 132's tree): both matrix
legs of this workflow's suite step report **0 failed / 15,851 passed /
23 skipped / 4 xfailed**, and the upstream ``Tests`` workflow (run
``38768155886``) reports **0 failed / 17,870 passed** on the same branch.
Reading back every failure the tolerated step has ever swallowed on this fork:
run ``38538655054`` = 3 (two ``bubblewrap`` cases plus one extras literal),
run ``38556878592`` = 2 (the same two).  All three were deterministic, all
three were ours, and knife 130 plus knife 132 closed them -- so no flake has
ever been observed in this leg.

The guard below is a bound, not a copy of today's YAML: it forbids both ways
this step can be neutralised -- the ``continue-on-error`` key and a shell-level
``|| true`` on pytest itself.
"""

from __future__ import annotations

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = REPO_ROOT / ".github/workflows/unit-tests.yml"
FULL_UNIT_LEG = "Run all unit tests"
SUITE_SELECTION = "pytest tests/unit"


def _suite_steps() -> list[dict]:
    document = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    steps = []
    for job in (document.get("jobs") or {}).values():
        for step in job.get("steps") or []:
            name = str(step.get("name", ""))
            run = step.get("run")
            if (
                name.startswith(FULL_UNIT_LEG)
                and isinstance(run, str)
                and SUITE_SELECTION in run
            ):
                steps.append(step)
    assert steps, "no step runs the whole unit suite; revisit this guard"
    return steps


def test_unit_suite_step_fails_the_job_when_a_test_fails():
    for step in _suite_steps():
        tolerated = bool(step.get("continue-on-error"))
        swallowed = "|| true" in str(step.get("run", ""))
        assert not (tolerated or swallowed), (
            f"{step.get('name')!r} cannot redden its job "
            f"(continue-on-error={step.get('continue-on-error')!r}, "
            f"'|| true' in run={swallowed}); a suite this size is only a "
            "gate if its failures are visible"
        )
