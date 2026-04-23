# -*- coding: utf-8 -*-
"""Enhanced CoPaw app entrypoint.

This module keeps a dedicated import path for CoPaw startup while the
underlying application assembly still lives in qwenpaw.
"""

from qwenpaw.runtime_mode import ensure_runtime_flavor

ensure_runtime_flavor("copaw")

from qwenpaw.app._app import app  # noqa: E402

app.state.runtime_flavor = "copaw"
app.state.runtime_overlay_enabled = True