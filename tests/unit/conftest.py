# -*- coding: utf-8 -*-
"""Fixtures applied to every test under tests/unit."""

import pytest

from qwenpaw.config import utils as _config_utils


@pytest.fixture(autouse=True)
def isolated_config_file(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
):
    """Point config reads/writes at this test's own directory.

    Without this, any unit test that reaches load_config()/save_config()
    touches the developer's live ~/.copaw/config.json, and the module-level
    mtime cache hands one test's Config object to the next.
    """
    working_dir = tmp_path / "copaw-config"
    working_dir.mkdir()
    monkeypatch.setattr(_config_utils, "WORKING_DIR", working_dir)
    monkeypatch.setattr(_config_utils, "_config_cache", None)
    monkeypatch.setattr(_config_utils, "_config_mtime", None)
    return working_dir
