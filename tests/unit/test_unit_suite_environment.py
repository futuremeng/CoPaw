# -*- coding: utf-8 -*-
"""Contracts this suite keeps against the developer's own machine."""

import os
import subprocess
import sys

from qwenpaw.security.secret_store import _should_skip_keyring


def test_unit_tests_never_reach_the_os_keyring():
    """``qwenpaw`` must resolve its master key from the file fallback here.

    ``import qwenpaw`` decrypts the persisted env vars at import time
    (``__init__`` -> ``load_envs_into_environ`` -> ``secret_store.decrypt``),
    which asks the OS keyring for the master key first. When the keychain
    item waits for authorization that never arrives, the read is abandoned
    after ``_KEYRING_TIMEOUT`` (10s) and the write-back of the file-fallback
    key is abandoned after another 10s, so importing the package costs ~20s
    of wall time for 0.2s of CPU. CI escapes via ``CI=true``; a developer's
    desktop has no such flag.
    """
    assert _should_skip_keyring() is True


def test_reimport_in_a_subprocess_beats_the_suite_deadline():
    """Helpers that re-import the package give it 10s, so it must fit.

    ``tests/unit/app/test_multi_agent_manager_startup.py`` reads an
    import-time constant through ``subprocess.run(..., timeout=10)``. Those
    cases pass in CI and fail on any machine whose keychain blocks, which is
    the same hang as above seen from the caller's side.
    """
    code = "from qwenpaw.constant import CUSTOM_AGENT_STARTUP_CONCURRENCY"
    completed = subprocess.run(
        [sys.executable, "-c", code],
        env=os.environ.copy(),
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    assert completed.stdout == ""
