# -*- coding: utf-8 -*-
"""Fixtures for the desktop entry tests.

``entry._install_desktop_runtime()`` asserts that ``qwenpaw.app._app`` has not
been imported yet, because the FastAPI app freezes its CORS origins at import
time. That holds in a desktop process, but the unit suite runs in a single
interpreter, so any earlier test that imports the app makes every test here
fail. Hide the module for the duration of these tests and put it back after.
"""

from __future__ import annotations

import sys

import pytest

_APP_MODULE = "qwenpaw.app._app"


@pytest.fixture(autouse=True)
def hide_loaded_app_module():
    previously_loaded = sys.modules.pop(_APP_MODULE, None)
    try:
        yield
    finally:
        if previously_loaded is not None:
            sys.modules[_APP_MODULE] = previously_loaded
        else:
            sys.modules.pop(_APP_MODULE, None)
