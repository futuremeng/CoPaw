# -*- coding: utf-8 -*-
"""Serve the CoPaw overlay through qwenpaw's own ``app`` command.

``qwenpaw.cli.app_cmd`` runs uvicorn on ``qwenpaw.app._app:app``.  The Copaw
overlay (``copaw.app._app``) extends that very same FastAPI object with Copaw
routers, so an in-process run is already complete.  ``--reload`` is different:
uvicorn starts a fresh interpreter that resolves the target *by string*, so the
Copaw entry point swaps the import path for the duration of the call.  The swap
is scoped (restored in ``finally``) and the upstream command object is never
mutated: Copaw's ``app`` command is a new click command reusing the upstream
parameter set.
"""

from __future__ import annotations

import contextlib
import functools
from collections.abc import Iterator
from typing import Any, Callable

import click
import uvicorn

from qwenpaw.cli.app_cmd import app_cmd as _core_app_cmd

CORE_APP_TARGET = "qwenpaw.app._app:app"
OVERLAY_APP_TARGET = "copaw.app._app:app"


def _uvicorn_target_swapped(target: str) -> contextlib.AbstractContextManager:
    """Replace the core ASGI import string with ``target`` while inside."""

    @contextlib.contextmanager
    def _swap() -> Iterator[Callable[..., Any]]:
        original = uvicorn.run
        if getattr(original, "_copaw_overlay_proxy", False):
            yield original
            return

        def proxy(app: Any, *args: Any, **kwargs: Any) -> Any:
            if app == CORE_APP_TARGET:
                app = target
            return original(app, *args, **kwargs)

        proxy._copaw_overlay_proxy = True  # type: disable[attr-defined]
        uvicorn.run = proxy
        try:
            yield proxy
        finally:
            uvicorn.run = original

    return _swap()


def make_overlay_app_command() -> click.Command:
    """Copaw ``app`` command: upstream options, upstream body, overlay target."""
    core_callback = _core_app_cmd.callback

    @functools.wraps(core_callback)
    def overlay_app_callback(*args: Any, **kwargs: Any) -> Any:
        with _uvicorn_target_swapped(OVERLAY_APP_TARGET):
            return core_callback(*args, **kwargs)

    return click.Command(
        name="app",
        callback=overlay_app_callback,
        params=list(_core_app_cmd.params),
        help=_core_app_cmd.help or (core_callback.__doc__ or ""),
        short_help=_core_app_cmd.short_help,
        epilog=_core_app_cmd.epilog,
    )


def attach_overlay_app_command(group: click.Group) -> None:
    """Register Copaw's ``app`` command (shadows the lazy core one)."""
    group.add_command(make_overlay_app_command(), "app")
