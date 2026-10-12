# -*- coding: utf-8 -*-
"""Fixtures applied to every test under tests/unit."""

import pytest

from qwenpaw.browser.control_link.chrome import ws_handler as _chrome_ws
from qwenpaw.config import config as _config_module
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

    ``qwenpaw.config.config`` binds the constant for itself and builds the
    default agent's workspace path from that binding, so it is moved together
    with the reader; one ``load_config()`` writing to a different directory
    than the ``AgentsConfig`` it returns would hand the next test a stale
    ``agent.json``.

    The chrome bridge resolves its Native Messaging config from ``Path.home()``
    rather than from the working dir, and the app lifespan primes the token on
    startup -- so a test that enters the real lifespan would create
    ``~/.qwenpaw/nm-bridge.json`` on the machine running the suite. Both of its
    bindings move with the rest: the module constant is the default argument of
    ``configure_nm_bridge`` and the singleton's field is what
    ``_expected_token`` passes.
    """
    working_dir = tmp_path_factory.mktemp("copaw-config")
    bridge_config = working_dir / "nm-bridge.json"
    monkeypatch.setattr(_config_utils, "WORKING_DIR", working_dir)
    monkeypatch.setattr(_config_module, "WORKING_DIR", working_dir)
    monkeypatch.setattr(_config_utils, "_config_cache", None)
    monkeypatch.setattr(_config_utils, "_config_mtime", None)
    monkeypatch.setattr(_chrome_ws, "DEFAULT_CONFIG_PATH", bridge_config)
    bridge_state = _chrome_ws.get_nm_bridge_route_state()
    monkeypatch.setattr(bridge_state, "config_path", bridge_config)
    return working_dir


@pytest.fixture(autouse=True)
def isolated_os_keyring(monkeypatch: pytest.MonkeyPatch):
    """Keep every unit test off the developer's keychain.

    ``qwenpaw`` decrypts its persisted env vars through the OS keyring at
    import time, and each keyring call is abandoned only after its own
    10s timeout. CI skips the keyring through ``CI=true``; this is the same
    escape hatch the hub provisioners already hand their child processes,
    set explicitly so the suite does not depend on where it runs.
    """
    monkeypatch.setenv("QWENPAW_DISABLE_KEYRING", "1")
