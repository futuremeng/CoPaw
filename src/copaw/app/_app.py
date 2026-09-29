# -*- coding: utf-8 -*-
"""CoPaw application overlay.

The qwenpaw assembly stays untouched; this module is the Copaw entry point that
extends qwenpaw's FastAPI object with Copaw-owned routers.  ``qwenpaw`` running
without ``src/copaw`` therefore keeps its complete upstream behaviour, and
deleting ``src/copaw`` cannot break it.
"""

from qwenpaw.app._app import app

from qwenpaw.app.routers.knowledge_hanlp_tasks import router as knowledge_hanlp_tasks_router
from qwenpaw.app.routers.knowledge_siamese_tasks import router as knowledge_siamese_tasks_router

app.state.runtime_overlay_enabled = True
app.include_router(knowledge_hanlp_tasks_router, prefix="/api")
app.include_router(knowledge_siamese_tasks_router, prefix="/api")
