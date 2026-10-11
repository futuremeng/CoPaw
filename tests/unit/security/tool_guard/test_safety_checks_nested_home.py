# -*- coding: utf-8 -*-
"""Nested-``HOME`` cases for the home-tree branch of ``safety_checks``.

Upstream's own ``test_safety_checks.py`` only ever runs with a three-segment
home (``/home/runner``, ``/Users/alice``), so its ``len(parts) <= 3`` shape
assumption is never exercised against a deeper home.  These cases pin that a
nested real home root is still recognised as a wipe target, while its
workspace subpaths stay allowed.
"""

from __future__ import annotations

import os

import pytest

from qwenpaw.security.tool_guard.safety_checks import is_command_catastrophic


def _require_posix_home() -> None:
    if os.name == "nt":
        pytest.skip("POSIX-only: HOME spelling of the home tree")


def _use_nested_home(monkeypatch, home: str) -> None:
    monkeypatch.setenv("HOME", home)
    monkeypatch.delenv("HOMEPATH", raising=False)
    monkeypatch.delenv("USERPROFILE", raising=False)


def test_home_content_wipe_hits_when_home_is_deeper_than_three_segments(
    monkeypatch,
) -> None:
    if os.name == "nt":
        return
    home = "/Users/alice/.isolatedhome"
    _use_nested_home(monkeypatch, home)
    # ``../*`` from ``<home>/project`` collapses to ``<home>/*``.
    assert (
        is_command_catastrophic(
            "rm -rf ../*",
            cwd=f"{home}/project",
        )
        is True
    )
    # The same target spelled absolutely must hit too.
    assert is_command_catastrophic(f"rm -rf {home}/*") is True
    # Walking one level up from a nested workspace also lands on home.
    assert (
        is_command_catastrophic(
            "rm -rf ../../*",
            cwd=f"{home}/project/build",
        )
        is True
    )


def test_home_subpath_wipe_still_allowed_when_home_is_deeper(
    monkeypatch,
) -> None:
    if os.name == "nt":
        return
    home = "/Users/alice/.isolatedhome"
    _use_nested_home(monkeypatch, home)
    assert (
        is_command_catastrophic(
            "rm -rf ../*",
            cwd=f"{home}/project/build",
        )
        is False
    )
    assert (
        is_command_catastrophic(
            f"rm -rf {home}/project/build",
        )
        is False
    )


def test_relative_wipe_outside_home_is_unaffected(monkeypatch) -> None:
    if os.name == "nt":
        return
    _use_nested_home(monkeypatch, "/Users/alice/.isolatedhome")
    assert (
        is_command_catastrophic(
            "rm -rf ../*",
            cwd="/tmp/unrelated/project",
        )
        is False
    )
