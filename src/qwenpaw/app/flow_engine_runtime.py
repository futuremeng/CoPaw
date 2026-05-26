# -*- coding: utf-8 -*-

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from copaw.app.flow_engine import FlowEngineService

from ..constant import WORKING_DIR


@lru_cache(maxsize=1)
def get_flow_engine_service() -> FlowEngineService:
    db_path = Path(WORKING_DIR).expanduser() / ".flow_engine" / "flow_engine.sqlite3"
    return FlowEngineService(db_path)
