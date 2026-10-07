# -*- coding: utf-8 -*-
"""Take over upstream's ``update`` command for the ``copaw`` program only.

``qwenpaw.cli.update_cmd`` reads the newest release of the upstream PyPI
project and pip-installs ``qwenpaw==<latest>`` into the current environment.
The Copaw entry point shares that very command object, so ``copaw update``
replaced a CoPaw install with upstream QwenPaw.  CoPaw has no PyPI channel
yet, so the honest behaviour for CoPaw is to refuse and point at our own
releases.

The command is registered on the *shared* core group, so the refusal is
keyed on the program name it was invoked as: every other program (``qwenpaw``
included) keeps the upstream updater, and the upstream command object is
never mutated.
"""

from __future__ import annotations

import os

import click

from qwenpaw.__version__ import __version__
from qwenpaw.cli.update_cmd import update_cmd as _core_update_cmd

COPAW_RELEASES_URL = "https://github.com/futuremeng/CoPaw/releases"
COPAW_PROGRAM_NAME = "copaw"


def invoked_as_copaw(ctx: click.Context) -> bool:
    """True when the running program is the ``copaw`` console script."""
    program = os.path.basename(ctx.find_root().info_name or "")
    return os.path.splitext(program)[0] == COPAW_PROGRAM_NAME


@click.pass_context
def overlay_update_callback(ctx: click.Context, *, yes: bool = False) -> None:
    """Refuse for CoPaw, hand any other program back to upstream."""
    if not invoked_as_copaw(ctx):
        ctx.invoke(_core_update_cmd, yes=yes)
        return

    click.echo(f"CoPaw {__version__}")
    click.echo(
        "CoPaw is not published to PyPI yet, so this command installs "
        "nothing: the upstream updater would pip-install qwenpaw and "
        "replace this CoPaw install.",
    )
    click.echo(f"Releases: {COPAW_RELEASES_URL}")
    raise SystemExit(1)


def make_overlay_update_command() -> click.Command:
    """Copaw ``update`` command: upstream options, CoPaw-aware body."""
    return click.Command(
        name="update",
        callback=overlay_update_callback,
        params=list(_core_update_cmd.params),
        help="Refuse to upgrade: CoPaw is not on PyPI yet.",
        short_help=_core_update_cmd.short_help,
        epilog=_core_update_cmd.epilog,
    )


def attach_overlay_update_command(group: click.Group) -> None:
    """Register Copaw's ``update`` command (shadows the lazy core one)."""
    group.add_command(make_overlay_update_command(), "update")
