# -*- coding: utf-8 -*-
"""WP-01 boundary: ``src/copaw`` must stay removable as a whole directory.

The allow-list below is a ratchet: it may only shrink.  Growing it re-introduces
an invasive dependency from the upstream-owned package onto fork-private code
(P1-行为), which is exactly what WP-01 exists to remove.
"""

from __future__ import annotations

import re
from pathlib import Path

import click
import uvicorn

from copaw.cli.app_command import (
    CORE_APP_TARGET,
    OVERLAY_APP_TARGET,
    _uvicorn_target_swapped,
    make_overlay_app_command,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
QWENPAW_SRC = REPO_ROOT / "src" / "qwenpaw"

_INVASIVE_RE = re.compile(
    r"^[ \t]*(from|import) (copaw|\S*runtime_mode)\b",
    re.M,
)

# Files inside ``src/qwenpaw`` still holding a top-level ``from copaw`` import.
# This is the WP-01 relocation queue.  Every entry has two possible resolutions:
# the importing module moves into ``src/copaw`` behind the overlay, or the
# copaw-resident dependency it needs moves into ``src/qwenpaw``.  Which one
# applies per module is pending the desktop-entry ruling; ``app/routers/agents.py``
# is upstream-owned, so it must lose the import rather than move.
INVASIVE_COPAW_IMPORT_ALLOWLIST: frozenset[str] = frozenset(
    {
        "src/qwenpaw/app/flow_engine_runtime.py",
        "src/qwenpaw/app/knowledge_workflow.py",
        "src/qwenpaw/app/project_knowledge_watcher.py",
        "src/qwenpaw/app/routers/agent.py",
        "src/qwenpaw/app/routers/agents.py",
        "src/qwenpaw/app/routers/agents_pipeline_core.py",
        "src/qwenpaw/app/routers/flows.py",
        "src/qwenpaw/app/routers/knowledge.py",
        "src/qwenpaw/app/routers/sidecar.py",
        "src/qwenpaw/knowledge/enrichment_pipeline.py",
        "src/qwenpaw/knowledge/graphify_provider.py",
    },
)


def _python_files() -> list[Path]:
    return [
        path
        for path in sorted(QWENPAW_SRC.rglob("*.py"))
        if "__pycache__" not in path.parts
    ]


def _invasive_files() -> set[str]:
    return {
        path.relative_to(REPO_ROOT).as_posix()
        for path in _python_files()
        if _INVASIVE_RE.search(path.read_text(encoding="utf-8"))
    }


def test_qwenpaw_reaches_into_copaw_only_where_recorded() -> None:
    unrecorded = sorted(_invasive_files() - INVASIVE_COPAW_IMPORT_ALLOWLIST)
    assert unrecorded == []


def test_invasive_allow_list_is_a_ratchet() -> None:
    """Every recorded file must still be invasive; stale entries must be dropped."""
    resolved = INVASIVE_COPAW_IMPORT_ALLOWLIST - _invasive_files()
    assert resolved == set()
    stale_refs = INVASIVE_COPAW_MODULE_REF_ALLOWLIST - _dynamic_invasive_files()
    assert stale_refs == set()


# ``import_module("<copaw…>")`` and lazy ``_EXPORTS`` tables reach copaw without
# an import statement, so the regex above cannot see them.  Only strings that map
# onto a real module file count; brand/log/entry-point names such as
# ``copaw.dingtalk.stream`` and ``copaw.doctor`` resolve to nothing and are skipped.
_MODULE_STRING_RE = re.compile(r"""['"](copaw(?:\.\w+)+)['"]""")
COPAW_SRC = REPO_ROOT / "src" / "copaw"

INVASIVE_COPAW_MODULE_REF_ALLOWLIST: frozenset[str] = frozenset(
    {
        "src/qwenpaw/knowledge/__init__.py",
    },
)


def _copaw_module_exists(dotted: str) -> bool:
    parts = dotted.split(".")
    if parts[0] != "copaw":
        return False
    relative = "/".join(parts[1:])
    return (COPAW_SRC / f"{relative}.py").is_file() or (
        COPAW_SRC / relative / "__init__.py"
    ).is_file()


def _dynamic_invasive_files() -> set[str]:
    out: set[str] = set()
    for path in _python_files():
        text = path.read_text(encoding="utf-8")
        if any(
            _copaw_module_exists(dotted)
            for dotted in _MODULE_STRING_RE.findall(text)
        ):
            out.add(path.relative_to(REPO_ROOT).as_posix())
    return out


def test_qwenpaw_does_not_import_copaw_modules_dynamically() -> None:
    unrecorded = sorted(
        _dynamic_invasive_files() - INVASIVE_COPAW_MODULE_REF_ALLOWLIST
    )
    assert unrecorded == []


def test_runtime_mode_module_is_gone() -> None:
    assert not (QWENPAW_SRC / "runtime_mode.py").exists()
    assert not (REPO_ROOT / "src" / "copaw" / "runtime_mode.py").exists()


def test_core_cli_source_does_not_know_copaw_commands() -> None:
    source = (QWENPAW_SRC / "cli" / "main.py").read_text(encoding="utf-8")
    assert '"nlp":' not in source
    assert "ensure_runtime_flavor" not in source
    assert "_is_copaw_entry" not in source


def test_core_app_cmd_keeps_the_upstream_asgi_target() -> None:
    source = (QWENPAW_SRC / "cli" / "app_cmd.py").read_text(encoding="utf-8")
    assert f'"{CORE_APP_TARGET}"' in source
    assert "runtime_mode" not in source


def test_copaw_entry_registers_overlay_app_and_nlp() -> None:
    from copaw.cli.main import cli

    commands = cli.list_commands(click.Context(cli))
    assert "nlp" in commands
    assert "app" in commands
    assert len(commands) == len(set(commands))


def test_overlay_app_command_reuses_upstream_options() -> None:
    from qwenpaw.cli.app_cmd import app_cmd as core_app_cmd

    overlay_cmd = make_overlay_app_command()
    assert {p.name for p in overlay_cmd.params} == {
        p.name for p in core_app_cmd.params
    }
    assert overlay_cmd.callback is not core_app_cmd.callback


def test_uvicorn_target_swap_is_scoped(monkeypatch) -> None:
    seen: dict[str, object] = {}

    def fake_run(app, *args, **kwargs):  # noqa: ARG001
        seen["target"] = app
        return "ok"

    monkeypatch.setattr(uvicorn, "run", fake_run)

    with _uvicorn_target_swapped(OVERLAY_APP_TARGET) as proxy:
        assert proxy(CORE_APP_TARGET) == "ok"
        assert seen["target"] == OVERLAY_APP_TARGET

        seen["target"] = None
        assert proxy("some.other:app") == "ok"
        assert seen["target"] == "some.other:app"

    assert uvicorn.run is fake_run


def test_copaw_app_entry_extends_qwenpaw_app_object() -> None:
    source_text = (
        REPO_ROOT / "src" / "copaw" / "app" / "_app.py"
    ).read_text(encoding="utf-8")

    assert "from qwenpaw.app._app import app" in source_text
    assert "app.include_router(" in source_text
    assert "runtime_mode" not in source_text
