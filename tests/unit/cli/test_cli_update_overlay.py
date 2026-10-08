# -*- coding: utf-8 -*-
"""``copaw update`` must not hand the install over to upstream.

``src/copaw/cli/main.py`` re-uses ``qwenpaw.cli.main:cli`` as its command
group, so ``copaw update`` used to resolve to upstream ``update_cmd``, which
pip-installs ``qwenpaw==<latest>`` -- i.e. it replaced CoPaw with upstream
QwenPaw.  The overlay shadows that command the same way it shadows ``app``.

Because the group object is *shared*, the shadow may only change what the
``copaw`` program does: running the same group under any other program name
(``qwenpaw``, or a bare ``import qwenpaw.cli.main``) must keep upstream's
behaviour.  The overlay therefore checks the program name it was invoked as.
"""

from __future__ import annotations

import json
import runpy
import subprocess
import sys
from pathlib import Path

import click
import pytest
from click.testing import CliRunner

import copaw.cli.main as copaw_cli_module
import qwenpaw.cli.update_cmd as core_update
from copaw.cli.main import cli as copaw_cli
from copaw.cli.update_cmd import make_overlay_update_command

_REPO_ROOT = Path(__file__).resolve().parents[3]


def _fact_releases_url() -> str:
    fact = json.loads(
        (_REPO_ROOT / "src/copaw/release_channel.json").read_text(
            encoding="utf-8"
        )
    )
    return f"https://github.com/{fact['github_repository']}/releases"


def _resolve(name: str) -> click.Command:
    with click.Context(copaw_cli) as ctx:
        command = copaw_cli.get_command(ctx, name)
    assert command is not None
    return command


def test_copaw_update_resolves_to_the_overlay_command() -> None:
    resolved = _resolve("update")
    assert resolved.callback is not core_update.update_cmd.callback


def test_overlay_update_reuses_the_upstream_option_names() -> None:
    overlay = make_overlay_update_command()
    assert {p.name for p in overlay.params} == {
        p.name for p in core_update.update_cmd.params
    }


def test_overlay_update_leaves_the_upstream_command_untouched() -> None:
    module = core_update.update_cmd.callback.__module__
    assert module == "qwenpaw.cli.update_cmd"


@pytest.fixture
def no_installer(monkeypatch) -> list:
    calls: list = []

    def _record(kind):
        def _fail(*args, **kwargs):
            calls.append((kind, args, kwargs))
            raise AssertionError(f"{kind} must not be called by copaw update")

        return _fail

    monkeypatch.setattr(subprocess, "run", _record("subprocess.run"))
    monkeypatch.setattr(subprocess, "Popen", _record("subprocess.Popen"))
    monkeypatch.setattr(core_update, "_fetch_latest_version", _record("pypi"))
    return calls


@pytest.fixture
def up_to_date(monkeypatch):
    """Steer the upstream updater to its harmless 'already current' branch."""
    from qwenpaw.cli.update_cmd import InstallInfo

    info = InstallInfo(
        package_dir="/tmp/site-packages/qwenpaw",
        python_executable="/tmp/venv/bin/python",
        environment_root="/tmp/venv",
        environment_kind="virtualenv",
        installer="pip",
        source_type="pypi",
        source_url=None,
    )
    monkeypatch.setattr(core_update, "_detect_installation", lambda: info)
    monkeypatch.setattr(
        core_update,
        "_fetch_latest_version",
        lambda: core_update.__version__,
    )
    return info


def test_copaw_program_refuses_and_points_to_releases(no_installer) -> None:
    result = CliRunner().invoke(
        copaw_cli,
        ["update"],
        prog_name="copaw",
    )

    assert result.exit_code != 0
    assert no_installer == []
    assert "not published to PyPI" in result.output
    assert _fact_releases_url() in result.output


def test_copaw_refusal_names_no_upstream_install_target(no_installer) -> None:
    result = CliRunner().invoke(
        copaw_cli,
        ["update"],
        prog_name="copaw",
    )

    assert result.exit_code != 0
    assert no_installer == []
    for marker in (
        "agentscope-ai/QwenPaw",
        "agentscope/qwenpaw",
        "pypi.org/pypi/qwenpaw",
        "qwenpaw==",
    ):
        assert marker not in result.output


def test_copaw_program_still_refuses_with_yes(no_installer) -> None:
    result = CliRunner().invoke(
        copaw_cli,
        ["update", "--yes"],
        prog_name="copaw",
    )

    assert result.exit_code != 0
    assert no_installer == []


def test_other_program_names_keep_the_upstream_updater(up_to_date) -> None:
    """Importing the overlay must not steal ``qwenpaw``'s own update."""
    result = CliRunner().invoke(copaw_cli, ["update", "--yes"])

    assert "not published to PyPI" not in result.output
    assert result.exit_code == 0
    assert "QwenPaw is already up to date." in result.output


def test_qwenpaw_program_name_keeps_the_upstream_updater(
    up_to_date,
) -> None:
    result = CliRunner().invoke(
        copaw_cli,
        ["update", "--yes"],
        prog_name="qwenpaw",
    )

    assert "not published to PyPI" not in result.output
    assert result.exit_code == 0
    assert "QwenPaw is already up to date." in result.output


def test_copaw_entry_point_runs_under_the_copaw_name(monkeypatch) -> None:
    """``python -m copaw.cli.main`` must also be recognised as copaw."""
    seen: dict = {}

    def _fake_cli(*args, **kwargs):
        seen.update(kwargs)
        return 0

    monkeypatch.setattr(copaw_cli_module, "cli", _fake_cli)
    copaw_cli_module.main()

    assert seen.get("prog_name") == "copaw"


def test_module_entry_point_runs_under_the_copaw_name(monkeypatch) -> None:
    """``python -m copaw`` reaches the same Copaw CLI, not upstream's."""
    seen: dict = {}

    def _fake_cli(*args, **kwargs):
        seen.update(kwargs)
        return 0

    monkeypatch.setattr(copaw_cli_module, "cli", _fake_cli)
    monkeypatch.setattr(sys, "argv", ["copaw", "update"])
    runpy.run_module("copaw", run_name="__main__")

    assert seen.get("prog_name") == "copaw"
