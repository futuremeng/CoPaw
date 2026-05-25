# -*- coding: utf-8 -*-
"""Enhanced CoPaw app entrypoint.

This module keeps a dedicated import path for CoPaw startup while the
underlying application assembly still lives in qwenpaw.
"""

from qwenpaw.runtime_mode import ensure_runtime_flavor

ensure_runtime_flavor("copaw")

from qwenpaw.app._app import app  # noqa: E402
from .routers.knowledge_hanlp_tasks import router as knowledge_hanlp_tasks_router  # noqa: E402
from .routers.knowledge_siamese_tasks import router as knowledge_siamese_tasks_router  # noqa: E402

app.state.runtime_flavor = "copaw"
app.state.runtime_overlay_enabled = True
app.include_router(knowledge_hanlp_tasks_router, prefix="/api")
app.include_router(knowledge_siamese_tasks_router, prefix="/api")