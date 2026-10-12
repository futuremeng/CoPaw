# -*- coding: utf-8 -*-
"""Priming the chrome bridge must not write into the developer's home.

``app/_app.py`` calls ``prime_bridge_token()`` from the application lifespan,
and the chrome control link resolves its config path from ``Path.home()``
instead of the working directory the rest of the suite is moved off.  So every
unit test that enters the real lifespan creates ``~/.qwenpaw/nm-bridge.json``
on the machine running the suite, and two concurrent pytest processes write the
same file.
"""

from pathlib import Path

import pytest

from qwenpaw.browser.control_link.chrome import ws_handler


def test_nm_bridge_config_path_is_under_the_isolated_working_dir(
    isolated_config_file: Path,
) -> None:
    """Both bindings of the bridge path sit inside the fixture's directory.

    The module constant is the default argument of ``configure_nm_bridge`` and
    the singleton's field is what ``_expected_token`` actually passes -- both
    are set at import time from the same ``Path.home()`` expression, so moving
    only one of them leaves the writer and the reader pointing at different
    places.
    """
    working_dir = Path(isolated_config_file).expanduser().resolve()
    bridge_state = ws_handler.get_nm_bridge_route_state()
    for label, bound in (
        ("ws_handler.DEFAULT_CONFIG_PATH", ws_handler.DEFAULT_CONFIG_PATH),
        ("bridge_state.config_path", bridge_state.config_path),
    ):
        resolved = Path(bound).expanduser().resolve()
        assert resolved.is_relative_to(working_dir), (
            f"{label} still resolves to {resolved}, outside the per-test "
            f"directory {working_dir} installed by isolated_config_file"
        )


def test_priming_the_bridge_token_writes_inside_the_isolated_dir(
    isolated_config_file: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The lifespan entry point lands its config file under the test directory.

    Existence alone is not the assertion: with the path still at the real home,
    this call reads the token already stored there and passes, while the suite
    keeps writing the developer's own file.
    """
    state = ws_handler.get_nm_bridge_route_state()
    monkeypatch.setattr(state, "token", None)
    ws_handler.prime_bridge_token()
    written = Path(state.config_path).expanduser().resolve()
    working_dir = Path(isolated_config_file).expanduser().resolve()
    assert written.is_relative_to(working_dir), (
        f"prime_bridge_token() resolved the bridge config to {written}, "
        f"outside the per-test directory {working_dir}"
    )
    assert written.exists()
    assert state.token
