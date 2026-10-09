# -*- coding: utf-8 -*-
"""Guards for the unit suite's own config isolation.

`qwenpaw.config.utils.WORKING_DIR` is resolved at import time, so a unit test
that does not redirect it reads and writes the developer's live config file
(measured: one run of tests/unit/app/routers/rewrote ~/.copaw/config.json).
`load_config()` also keeps a process-global cache keyed by mtime alone, with no
path in the key, so a later test can receive an earlier test's Config object.
"""

from pathlib import Path

import pytest
from qwenpaw.config import utils as config_utils

pytestmark = pytest.mark.unit


def test_config_path_is_redirected_away_from_live_file(
    tmp_path_factory: pytest.TempPathFactory,
) -> None:
    path = config_utils.get_config_path()
    # The fixture deliberately keeps the config dir out of the test's own
    # tmp_path (workspace-listing tests would see it), so the guard is the
    # session-wide throwaway root rather than one test's subdirectory.
    assert path.is_relative_to(tmp_path_factory.getbasetemp()), path
    assert path != Path.home() / ".copaw" / "config.json"


def test_each_unit_test_starts_with_no_config_on_disk() -> None:
    assert not config_utils.get_config_path().exists()
