# -*- coding: utf-8 -*-
"""CoPaw CLI entrypoint: the qwenpaw core CLI plus the Copaw overlay.

``qwenpaw`` and ``copaw`` share every core command.  What makes the Copaw
entry point the Copaw product is registered *here*: the overlay ASGI target
for ``copaw app``, the CoPaw-only ``copaw update``, the Copaw-only commands,
and the Copaw-only doctor self-checks.
Nothing in ``src/qwenpaw`` knows about this module, so ``src/copaw`` can be
removed and ``qwenpaw`` still starts with its full feature set.
"""

from __future__ import annotations

from qwenpaw.cli.main import cli

from .app_command import attach_overlay_app_command
from .doctor_hanlp import register as register_hanlp_doctor
from .nlp_cmd import nlp_group
from .update_cmd import attach_overlay_update_command

attach_overlay_app_command(cli)
attach_overlay_update_command(cli)
cli.add_command(nlp_group, "nlp")
register_hanlp_doctor()


def main() -> None:
    """Run the Copaw CLI as ``copaw`` (``python -m copaw.cli.main``)."""
    cli(prog_name="copaw")  # pylint: disable=no-value-for-parameter


if __name__ == "__main__":
    main()
