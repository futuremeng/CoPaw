# -*- coding: utf-8 -*-
"""Compatibility package for legacy CoPaw entrypoints.

Keep this package minimal so user-facing `copaw` commands continue to work
while the canonical implementation remains under `qwenpaw`.
"""

from qwenpaw import *  # noqa: F401,F403
