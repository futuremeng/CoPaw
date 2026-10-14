# -*- coding: utf-8 -*-
"""The fork's unit-test workflow must install what the suite actually needs.

Two accidents this closes, both measured on 2026-10-14 in a fresh 3.12 venv
built from the CI install command alone (``pip install -e ".[dev,test]"``):

* ``tests/unit/hub/test_docker_provisioner.py`` (upstream-owned, no
  ``importorskip``) failed with ``ModuleNotFoundError: No module named
  'docker'``.  ``docker`` is declared in the ``hub`` extra, and upstream's own
  nightly leg installs ``.[dev,test,full]`` (``full`` pulls ``hub``).  Adding
  ``docker`` made those 23 cases pass.
* ``pip install "mcp<1.28"`` forced 1.27.2, which is below the floor
  ``pyproject.toml`` declares (``mcp>=1.28,<2.0``, upstream commit
  ``f3046db66``).  CI therefore never tested the range the package sells.
  The pin's stated reason no longer holds: ``streamablehttp_client`` exists in
  both 1.27.2 and 1.30.0, ``agentscope`` is pinned to 2.0.9, and the
  mcp-focused subset reads 527 passed / 1 skipped under either version.
"""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = REPO_ROOT / ".github/workflows/unit-tests.yml"


def _run_commands() -> list[str]:
    document = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    commands: list[str] = []
    for job in document.get("jobs", {}).values():
        for step in job.get("steps", []):
            run = step.get("run")
            if isinstance(run, str):
                commands.extend(line.strip() for line in run.splitlines())
    return commands


def _pip_install_commands() -> list[str]:
    return [c for c in _run_commands() if c.startswith("pip install")]


def test_unit_suite_installs_the_extra_hub_tests_import():
    installs = _pip_install_commands()
    editable = [c for c in installs if '-e ".[' in c]
    assert editable, "no editable install command found in the workflow"
    for command in editable:
        match = re.search(r"\.\[([^\]]*)\]", command)
        assert match is not None, command
        extras = {name.strip() for name in match.group(1).split(",")}
        assert "hub" in extras, command


def _package_name(requirement: str) -> str:
    return re.split(r"[<>=!\[]", requirement.strip())[0].strip()


def test_workflow_does_not_pin_a_dependency_pyproject_already_bounds():
    dependencies = tomllib.loads(
        (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8"),
    )["project"]["dependencies"]
    specifiers = [
        requirement
        for requirement in dependencies
        if _package_name(requirement) == "mcp"
    ]
    # The rule is only meaningful while pyproject sells an mcp range.
    assert specifiers, "pyproject no longer bounds mcp; revisit this guard"

    installs = _pip_install_commands()
    pinned = [c for c in installs if re.search(r"\bmcp[<>=]", c)]
    assert pinned == [], f"CI overrides the declared mcp range: {pinned}"
