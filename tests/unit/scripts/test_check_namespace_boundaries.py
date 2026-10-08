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


def test_flow_engine_lives_in_the_engine_package():
    """D-16: the flow engine implementation was sunk into ``src/qwenpaw``."""
    mod = _load_module()
    repo_root = Path(__file__).resolve().parents[3]
    assert "app/flow_engine/" not in mod.ALLOWED_COPAW_ONLY_PREFIXES
    assert (repo_root / "src" / "qwenpaw" / "app" / "flow_engine" / "__init__.py").is_file()
    sink_dir = repo_root / "src" / "copaw" / "app" / "flow_engine"
    # A stale, gitignored __pycache__/ from before the sink is not a module.
    assert not list(sink_dir.glob("*.py"))


def test_copaw_keeps_no_router_level_exceptions():
    """D-16: both Copaw task routers were sunk into ``qwenpaw.app.routers``."""
    mod = _load_module()
    repo_root = Path(__file__).resolve().parents[3]
    # ``release_channel.py`` is the only registered copaw-only file (阶段 1);
    # the router-level table D-16 emptied stays empty.
    registered = mod.ALLOWED_COPAW_ONLY_FILES
    assert registered == {"release_channel.py"}
    assert not [f for f in registered if f.startswith("app/routers/")]
    assert not (repo_root / "src" / "copaw" / "app" / "routers" / "knowledge_hanlp_tasks.py").exists()
    assert (repo_root / "src" / "qwenpaw" / "app" / "routers" / "knowledge_hanlp_tasks.py").is_file()


def test_allowed_non_thin_shared_includes_copaw_app_overlay():
    mod = _load_module()
    assert "app/_app.py" in mod.ALLOWED_NON_THIN_SHARED


def test_release_channel_files_do_not_trip_the_gate():
    """阶段 1: ``copaw update``'s overlay and the fact-source loader are both
    legitimately copaw-owned, so the live tree must read clean."""
    mod = _load_module()
    assert "cli/update_cmd.py" in mod.ALLOWED_NON_THIN_SHARED
    report = mod.compute_local_report()
    assert report["non_thin_shared"] == []
    assert report["non_extension_copaw_only"] == []
