# -*- coding: utf-8 -*-
"""Provider-specific NLP demo routes for Siamese UniNLU."""

from __future__ import annotations

import time
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ...knowledge.siamese_uninlu_runtime import SiameseUniNLURuntime
from ...config import load_config

router = APIRouter(prefix="/nlp/siamese", tags=["nlp", "siamese"])


class SiameseTaskRunRequest(BaseModel):
    """Request payload for Siamese UniNLU task demo."""

    text: str = Field(default="")
    text_a: str = Field(default="")
    text_b: str = Field(default="")
    context: str = Field(default="")
    question: str = Field(default="")
    choices: list[str] = Field(default_factory=list)
    labels: list[str] = Field(default_factory=list)
    schema_payload: Any = Field(default=None, alias="schema")
    request_id: str = Field(default="")

    model_config = {
        "populate_by_name": True,
    }


class SiameseTaskRunResponse(BaseModel):
    """Response payload for Siamese UniNLU task demo."""

    provider: str = "siamese_uninlu"
    task_key: str
    request_id: str
    status: str
    reason_code: str
    reason: str
    result: Any = None
    raw_result: Any = None
    pretty_print: str = ""
    resolved_model: str = ""
    duration_ms: float = 0.0


@router.post("/tasks/{task_key}/run", response_model=SiameseTaskRunResponse)
async def run_siamese_task(task_key: str, body: SiameseTaskRunRequest) -> SiameseTaskRunResponse:
    """Execute a Siamese UniNLU task via provider-specific route."""
    config = load_config()
    request_id = str(body.request_id or uuid.uuid4())
    payload = body.model_dump(by_alias=True)

    started = time.perf_counter()
    result = SiameseUniNLURuntime.run_task(config, task_key=task_key, payload=payload)
    elapsed_ms = float(result.get("duration_ms") or ((time.perf_counter() - started) * 1000.0))

    if str(result.get("status") or "") == "invalid":
        raise HTTPException(status_code=400, detail=str(result.get("reason") or "Invalid task"))

    raw = result.get("result")
    pretty = ""
    if raw is not None:
        try:
            import json

            pretty = json.dumps(raw, ensure_ascii=False, indent=2)
        except Exception:
            pretty = str(raw)

    return SiameseTaskRunResponse(
        task_key=task_key,
        request_id=request_id,
        status=str(result.get("status") or "unavailable"),
        reason_code=str(result.get("reason_code") or "SIAMESE_TASK_EXECUTION_FAILED"),
        reason=str(result.get("reason") or "Siamese task failed."),
        result=raw,
        raw_result=raw,
        pretty_print=pretty,
        resolved_model=str(result.get("resolved_model") or ""),
        duration_ms=elapsed_ms,
    )
