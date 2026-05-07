# -*- coding: utf-8 -*-

from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_module():
    repo_root = Path(__file__).resolve().parents[3]
    script_path = repo_root / "scripts" / "check_namespace_boundaries.py"
    spec = importlib.util.spec_from_file_location("check_namespace_boundaries", script_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_is_thin_copaw_shim_accepts_qwenpaw_reexport_with_noqa():
    mod = _load_module()
    content = "# -*- coding: utf-8 -*-\n\nfrom qwenpaw.knowledge.manager import *  # noqa: F401,F403\n"
    assert mod._is_thin_copaw_shim(content) is True


def test_is_thin_copaw_shim_rejects_reverse_import():
    mod = _load_module()
    content = "from copaw.knowledge.manager import *\n"
    assert mod._is_thin_copaw_shim(content) is False


def test_compute_local_report_has_expected_shape():
    mod = _load_module()
    report = mod.compute_local_report()
    assert isinstance(report, dict)
    assert set(report.keys()) == {
        "shared_count",
        "copaw_only_count",
        "reverse_imports",
        "non_thin_shared",
        "non_extension_copaw_only",
    }
    assert isinstance(report["reverse_imports"], list)
    assert isinstance(report["non_thin_shared"], list)
