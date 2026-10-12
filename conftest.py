# -*- coding: utf-8 -*-
"""Keep the test suite out of the developer's real working directory.

``qwenpaw.constant`` resolves ``WORKING_DIR`` once, at import time, and
roughly forty production modules then bind that value themselves with
``from ..constant import WORKING_DIR``.  A fixture cannot reach those
bindings -- ``monkeypatch`` on ``qwenpaw.config.utils`` only moves the one
module it patches -- so the escape hatch has to be in place before the
package is first imported.  This file is that place: pytest loads a
conftest at the repository root before the ones under ``tests/``.

``tests/unit/conftest.py`` still rotates a per-test directory for the config
reader; this one only has to be somewhere that is not ``~/.copaw``.
"""

import atexit
import os
import shutil
import tempfile
from pathlib import Path

_SUITE_WORKING_DIR = Path(tempfile.mkdtemp(prefix="copaw-test-working-"))

# setdefault, not assignment: an explicitly exported directory wins.
os.environ.setdefault("QWENPAW_WORKING_DIR", str(_SUITE_WORKING_DIR))

atexit.register(shutil.rmtree, _SUITE_WORKING_DIR, ignore_errors=True)
