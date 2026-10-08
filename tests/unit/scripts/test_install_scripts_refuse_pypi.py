# -*- coding: utf-8 -*-
"""The installers must not be able to hand a CoPaw user upstream."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ("scripts/install.sh", "scripts/install.ps1", "scripts/install.bat")
UPSTREAM_MARKERS = (
    "agentscope-ai/QwenPaw",
    "agentscope/qwenpaw",
    "pypi.org/pypi/qwenpaw",
    "qwenpaw==",
    "--refresh-package qwenpaw",
)


def _fact():
    return json.loads(
        (REPO_ROOT / "src/copaw/release_channel.json").read_text(
            encoding="utf-8"
        )
    )


@pytest.mark.parametrize("rel", SCRIPTS)
def test_clone_source_is_ours(rel):
    text = (REPO_ROOT / rel).read_text(encoding="utf-8")
    assert "https://github.com/futuremeng/CoPaw.git" in text


@pytest.mark.parametrize("rel", SCRIPTS)
def test_refusal_points_at_our_releases_page(rel):
    fact = _fact()
    text = (REPO_ROOT / rel).read_text(encoding="utf-8")
    assert (
        f"https://github.com/{fact['github_repository']}/releases" in text
    )
    assert "not published to PyPI yet" in text


@pytest.mark.parametrize("rel", SCRIPTS)
def test_no_upstream_distribution_identity(rel):
    text = (REPO_ROOT / rel).read_text(encoding="utf-8")
    for marker in UPSTREAM_MARKERS:
        assert marker not in text, f"{rel} still names {marker!r}"


def test_install_sh_still_parses():
    path = REPO_ROOT / "scripts/install.sh"
    subprocess.run(
        ["bash", "-n", str(path)], check=True, capture_output=True, text=True
    )
