# -*- coding: utf-8 -*-

from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_module():
    repo_root = Path(__file__).resolve().parents[3]
    path = repo_root / "scripts" / "check_p1_invariants.py"
    spec = importlib.util.spec_from_file_location("check_p1_invariants", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_brand_rename_is_paired_as_naming():
    mod = _load_module()
    removed = ['click.echo("Starting QwenPaw update...")']
    added = ['click.echo("Starting CoPaw update...")']
    assert mod.pair_rename_lines(removed, added) == [(removed[0], added[0])]


def test_moved_identical_line_is_not_paired_as_a_rename():
    """A line deleted in one place and re-added unchanged is a move, not a rename.

    Pairing it inflated naming_lines with entries strip could never replay.
    """
    mod = _load_module()
    line = '<img src="https://cdn/qwenpaw.svg" alt="QwenPaw Logo" width="120">'
    assert mod.pair_rename_lines([line], [line, line]) == []
