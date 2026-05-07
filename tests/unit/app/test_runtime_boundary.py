# -*- coding: utf-8 -*-

from __future__ import annotations

import ast
from pathlib import Path

from qwenpaw import runtime_mode


def _parse_module(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"))


def _has_ensure_runtime_flavor_call(module: ast.Module, expected: str) -> bool:
    for node in ast.walk(module):
        if not isinstance(node, ast.Call):
            continue
        if not isinstance(node.func, ast.Name):
            continue
        if node.func.id != "ensure_runtime_flavor":
            continue
        if not node.args:
            continue
        first = node.args[0]
        if isinstance(first, ast.Constant) and first.value == expected:
            return True
    return False


def test_runtime_mode_detects_copaw_from_program_name() -> None:
    assert runtime_mode.detect_runtime_flavor("copaw") == runtime_mode.ENHANCED_RUNTIME_FLAVOR
    assert runtime_mode.detect_runtime_flavor("copaw.exe") == runtime_mode.ENHANCED_RUNTIME_FLAVOR
    assert runtime_mode.detect_runtime_flavor("qwenpaw") == runtime_mode.CORE_RUNTIME_FLAVOR


def test_runtime_mode_app_import_path_routes_by_flavor() -> None:
    assert runtime_mode.get_runtime_app_import_path("copaw") == "copaw.app._app:app"
    assert runtime_mode.get_runtime_app_import_path("qwenpaw") == "qwenpaw.app._app:app"


def test_copaw_main_keeps_brand_entry_boundary() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    module = _parse_module(repo_root / "src" / "copaw" / "__main__.py")

    assert _has_ensure_runtime_flavor_call(module, "copaw")


def test_copaw_app_entry_keeps_overlay_boundary() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    source_path = repo_root / "src" / "copaw" / "app" / "_app.py"
    source_text = source_path.read_text(encoding="utf-8")
    module = _parse_module(source_path)

    assert _has_ensure_runtime_flavor_call(module, "copaw")
    assert "from qwenpaw.app._app import app" in source_text
    assert 'app.state.runtime_flavor = "copaw"' in source_text
    assert "app.state.runtime_overlay_enabled = True" in source_text
