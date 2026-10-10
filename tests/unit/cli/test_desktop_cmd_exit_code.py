# -*- coding: utf-8 -*-
"""Desktop backend teardown and exit-code contract.

Regression cover for two defects the fork's desktop rewrite introduced into
``src/qwenpaw/cli/desktop_cmd.py``: the ``manually_terminated`` guard and the
POSIX ``128 + signum`` translation were dropped, so closing the window made
``qwenpaw desktop`` exit with a negative status; and teardown lived only in
``Popen.__exit__``, which waits but never terminates.
"""
from __future__ import annotations

import signal
from typing import Any

import pytest
from click.testing import CliRunner

from qwenpaw.cli import desktop_cmd as desktop_cmd_module


class FakeProc:
    """Minimal subprocess.Popen stand-in recording the process state."""

    def __init__(self, returncode: int | None = None) -> None:
        self.pid = 4242
        self.returncode = returncode
        self.stdin = None
        self.stdout = None
        self.stderr = None

    def poll(self) -> int | None:
        return self.returncode

    def wait(self, timeout: float | None = None) -> int | None:
        return self.returncode


class FakeWebview:
    def __init__(self) -> None:
        self.started = False

    def create_window(self, *_args: Any, **_kwargs: Any) -> None:
        return None

    def start(self, *_args: Any, **_kwargs: Any) -> None:
        self.started = True


def _patch_desktop(
    monkeypatch,
    proc: FakeProc,
    *,
    ready: bool = True,
) -> list[tuple[int, object]]:
    """Patch the desktop command's seams and return the recorded signals.

    ``qwenpaw.cli.shutdown_cmd._signal_process_tree_unix`` is the seam the
    shared teardown uses to signal a process tree; stubbing it (the same seam
    upstream's own ``test_cli_shutdown.py`` uses) keeps the case from sending
    real signals to ``FakeProc.pid`` and keeps the stdlib ``subprocess``
    module out of the patch set.
    """
    monkeypatch.setattr(desktop_cmd_module, "setup_logger", lambda *_a: None)
    monkeypatch.setattr(
        desktop_cmd_module,
        "_cleanup_stale_desktop_backends",
        lambda: [],
    )
    monkeypatch.setattr(
        desktop_cmd_module,
        # Upstream replaced the free-port probe with a helper that also hands
        # back the socket it keeps open until the backend spawns.
        "get_stable_port",
        lambda *_a: (5599, None),
    )
    monkeypatch.setattr(
        desktop_cmd_module, "_wait_for_http", lambda *_a, **_k: ready
    )
    monkeypatch.setattr(
        desktop_cmd_module.subprocess,
        "Popen",
        lambda *_a, **_k: proc,
    )
    monkeypatch.setattr(desktop_cmd_module, "webview", FakeWebview())

    signals: list[tuple[int, object]] = []
    monkeypatch.setattr(
        "qwenpaw.cli.shutdown_cmd._signal_process_tree_unix",
        lambda pid, sig: signals.append((pid, sig)),
    )
    return signals


def _exit_code(result) -> int:
    if isinstance(result.exception, SystemExit):
        code = result.exception.code
        return 0 if code is None else int(code)
    return result.exit_code


def test_closing_the_window_exits_zero(monkeypatch) -> None:
    proc = FakeProc()
    signals = _patch_desktop(monkeypatch, proc)

    result = CliRunner().invoke(desktop_cmd_module.desktop_cmd, [])

    assert signals == [(proc.pid, signal.SIGTERM)]
    assert _exit_code(result) == 0


def test_webview_failure_still_terminates_the_backend(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    proc = FakeProc()
    signals = _patch_desktop(monkeypatch, proc)
    monkeypatch.setattr(desktop_cmd_module, "webview", None)

    result = CliRunner().invoke(desktop_cmd_module.desktop_cmd, [])

    assert signals == [(proc.pid, signal.SIGTERM)]
    assert _exit_code(result) != 0


def test_startup_failure_propagates_the_backend_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    proc = FakeProc(returncode=3)
    signals = _patch_desktop(monkeypatch, proc, ready=False)

    result = CliRunner().invoke(desktop_cmd_module.desktop_cmd, [])

    assert signals == []
    assert _exit_code(result) == 3


def test_backend_killed_by_a_signal_uses_the_posix_code(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    proc = FakeProc(returncode=-9)
    signals = _patch_desktop(monkeypatch, proc)

    result = CliRunner().invoke(desktop_cmd_module.desktop_cmd, [])

    assert signals == []
    assert _exit_code(result) == 137
