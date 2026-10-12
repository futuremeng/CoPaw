# -*- coding: utf-8 -*-
"""The unit suite must not resolve config paths through the developer's home.

``tests/unit/conftest.py`` installs an autouse fixture that redirects config
reads and writes to a directory of each test's own.  ``qwenpaw.config.utils``
was not the only module holding that path: ``qwenpaw.config.config`` imports
``WORKING_DIR`` for itself, and a model default built from that second binding
lands in ``~/.copaw`` (or ``~/.qwenpaw``) no matter what the fixture did.
"""

from pathlib import Path

from qwenpaw.config import config as _config_module
from qwenpaw.config import utils as _utils_module


def test_config_module_and_utils_agree_on_the_working_dir() -> None:
    """Both bindings of the working dir point at the fixture's directory.

    A module that keeps the real-home value would make every test that builds
    a default config object read, and in some paths write, the developer's own
    agent files -- and two tests running concurrently would then fight over
    the same ``agent.json`` on disk.
    """
    isolated = Path(_utils_module.WORKING_DIR).expanduser().resolve()
    bound = Path(_config_module.WORKING_DIR).expanduser().resolve()
    assert bound == isolated, (
        "qwenpaw.config.config still resolves WORKING_DIR to "
        f"{bound}, outside the per-test directory {isolated} installed by "
        "the autouse isolated_config_file fixture"
    )


def test_default_agent_workspace_is_under_the_isolated_working_dir() -> None:
    isolated = Path(_utils_module.WORKING_DIR).expanduser().resolve()
    agents = _config_module.AgentsConfig()
    default = agents.profiles["default"].workspace_dir
    inside = Path(default).expanduser().is_relative_to(isolated)
    assert inside, f"default agent workspace {default} is not under {isolated}"
