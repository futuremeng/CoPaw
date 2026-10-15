# -*- coding: utf-8 -*-
"""The unit-suite leg must install the binary the isolation cases shell out to.

``tests/unit/hub/test_process_isolation.py`` runs a real sandboxed child
process.  On Linux that needs ``bubblewrap``, and when the binary is missing
the provisioner raises instead of skipping:

    ProcessIsolationError: Local isolation requires bubblewrap on Linux.

That test file is upstream-owned and byte-identical to it in our tree (``git
diff 2744a976b --`` it prints nothing), so the red is not a fork regression --
it is a gap in our own workflow.  Measured in CI (run 38556878592, job ``Unit
Tests - py3.11``): ``2 failed, 15847 passed``, both cases being
``test_linux_runtime_filesystem_is_shared_and_persistent[/data/member]`` and
``[/workspace]``.  The older run 38538655054 carried the same two plus a third
failure that was a real defect, since fixed.  Upstream's ``Tests`` workflow
does not have this gap because ``tests.yml`` installs the dependency before
setting up Python, which is why those legs read green.

The assertions are lower bounds (the step exists, is gated to Linux, and runs
before the suite) rather than the exact apt invocation: an install placed after
the tests would still leave the leg red.
"""

from __future__ import annotations

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = REPO_ROOT / ".github/workflows/unit-tests.yml"
FULL_UNIT_LEG = "Run all unit tests"
REQUIRED_BINARY = "bubblewrap"


def _document() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def _unit_suite_legs() -> list[list[dict]]:
    legs = []
    for job in (_document().get("jobs") or {}).values():
        steps = job.get("steps") or []
        if any(
            str(step.get("name", "")).startswith(FULL_UNIT_LEG)
            for step in steps
        ):
            legs.append(steps)
    assert legs, "no job runs the whole unit suite; revisit this guard"
    return legs


def _first_index(items: list, matches) -> int | None:
    for index, item in enumerate(items):
        if matches(item):
            return index
    return None


def test_unit_suite_leg_installs_the_linux_isolation_binary():
    for steps in _unit_suite_legs():
        installers = [
            step
            for step in steps
            if REQUIRED_BINARY in str(step.get("run", ""))
        ]
        assert installers, (
            f"no step installs {REQUIRED_BINARY}, so the isolation cases fail "
            "with 'Local isolation requires bubblewrap (bwrap) on Linux'"
        )
        gated = [
            step
            for step in installers
            if "Linux" in str(step.get("if", ""))
            or "runner.os" in str(step.get("if", ""))
        ]
        assert gated, (
            f"{REQUIRED_BINARY} is installed without a Linux condition; the "
            "macOS and Windows legs of the matrix would run apt-get and red "
            "out"
        )


def test_isolation_binary_is_installed_before_the_suite_runs():
    for steps in _unit_suite_legs():
        binary_at = _first_index(
            steps,
            lambda step: REQUIRED_BINARY in str(step.get("run", "")),
        )
        suite_at = _first_index(
            steps,
            lambda step: str(step.get("name", "")).startswith(FULL_UNIT_LEG),
        )
        assert binary_at is not None, "no installer step in this leg"
        assert suite_at is not None, "no step runs the suite in this leg"
        assert binary_at < suite_at, (
            f"{REQUIRED_BINARY} lands at step {binary_at}, after the suite at "
            f"{suite_at} -- the isolation cases still run without it"
        )
