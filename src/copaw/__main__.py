# -*- coding: utf-8 -*-
"""Allow running CoPaw via `python -m copaw`."""

from qwenpaw.runtime_mode import ensure_runtime_flavor
from qwenpaw.cli.main import cli

ensure_runtime_flavor("copaw")


if __name__ == "__main__":
    cli()  # pylint: disable=no-value-for-parameter