# -*- coding: utf-8 -*-
"""Fixtures applied to every test under tests/unit."""

import pytest

from qwenpaw.config import utils as _config_utils


@pytest.fixture(autouse=True)
def isolated_config_file(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path_factory: pytest.TempPathFactory,
):
    """Point config reads/writes at a directory of this test's own.

    Without this, any unit test that reaches load_config()/save_config()
    touches the developer's live ~/.copaw/config.json, and the module-level
    mtime cache hands one test's Config object to the next.

    The directory has to live outside the test's own ``tmp_path``: tests that
    build a workspace in ``tmp_path`` and then list it would otherwise see
    ``copaw-config`` among their own fixtures' files.
    """
    working_dir = tmp_path_factory.mktemp("copaw-config")
    monkeypatch.setattr(_config_utils, "WORKING_DIR", working_dir)
    monkeypatch.setattr(_config_utils, "_config_cache", None)
    monkeypatch.setattr(_config_utils, "_config_mtime", None)
    return working_dir
