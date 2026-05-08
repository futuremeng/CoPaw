# -*- coding: utf-8 -*-

from __future__ import annotations

import time
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ...config import load_config
from ...config.config import KnowledgeConfig
from ...knowledge.hanlp_runtime import NLPRuntime
from qwenpaw.app.agent_context import get_agent_for_request

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


class HanLPTaskRunRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Input text to process.")
    request_id: str | None = Field(default=None, description="Optional caller request id.")


class HanLPTaskRunResponse(BaseModel):
    task_key: str
    request_id: str
    status: str
    reason_code: str
    reason: str
    result: object | None
    resolved_model: str
    duration_ms: int


def _normalize_ner_result(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or item.get("surface") or "").strip()
        label = str(item.get("label") or item.get("type") or "").strip()
        span = item.get("span")
        start = item.get("start")
        end = item.get("end")
        if isinstance(span, (list, tuple)) and len(span) >= 2:
            try:
                start = int(span[0])
                end = int(span[1])
            except (TypeError, ValueError):
                start, end = None, None
        else:
            try:
                start = int(start) if start is not None else None
                end = int(end) if end is not None else None
            except (TypeError, ValueError):
                start, end = None, None
        if not text and (start is None or end is None):
            continue
        normalized.append(
            {
                "text": text,
                "label": label,
                "start": start,
                "end": end,
                "score": item.get("score") if isinstance(item.get("score"), (int, float)) else None,
            }
        )
    return normalized


def _normalize_dep_result(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        token = str(item.get("token") or item.get("text") or item.get("word") or "").strip()
        deprel = str(item.get("deprel") or item.get("relation") or "").strip()
        try:
            head = int(item.get("head")) if item.get("head") is not None else 0
        except (TypeError, ValueError):
            head = 0
        if not token and not deprel and head == 0:
            continue
        normalized.append({"token": token, "head": head, "deprel": deprel})
    return normalized


def _effective_request_id(candidate: str | None) -> str:
    request_id = str(candidate or "").strip()
    if request_id:
        return request_id
    return f"copaw-hanlp-{uuid.uuid4().hex[:16]}"


def _effective_knowledge_config(knowledge_config: KnowledgeConfig, running_config) -> KnowledgeConfig:
    effective = knowledge_config.model_copy(deep=True)
    effective.enabled = bool(getattr(running_config, "knowledge_enabled", effective.enabled))
    effective.automation.knowledge_auto_collect_chat_files = bool(
        getattr(
            running_config,
            "knowledge_auto_collect_chat_files",
            effective.automation.knowledge_auto_collect_chat_files,
        ),
    )
    effective.automation.knowledge_auto_collect_chat_urls = bool(
        getattr(
            running_config,
            "knowledge_auto_collect_chat_urls",
            effective.automation.knowledge_auto_collect_chat_urls,
        ),
    )
    effective.automation.knowledge_auto_collect_long_text = bool(
        getattr(
            running_config,
            "knowledge_auto_collect_long_text",
            effective.automation.knowledge_auto_collect_long_text,
        ),
    )
    effective.automation.knowledge_long_text_min_chars = int(
        getattr(
            running_config,
            "knowledge_long_text_min_chars",
            effective.automation.knowledge_long_text_min_chars,
        ),
    )
    effective.index.chunk_size = int(
        getattr(
            running_config,
            "knowledge_chunk_size",
            effective.index.chunk_size,
        ),
    )
    return effective


async def _resolve_knowledge_config(request: Request) -> KnowledgeConfig:
    config = load_config()
    knowledge_config = getattr(config, "knowledge", None)
    if not isinstance(knowledge_config, KnowledgeConfig):
        return config.knowledge

    running_config = getattr(getattr(config, "agents", None), "running", None)
    if running_config is None:
        return knowledge_config

    try:
        workspace = await get_agent_for_request(request)
        workspace_running = getattr(getattr(workspace, "config", None), "running", None)
        if workspace_running is not None:
            running_config = workspace_running
    except HTTPException:
        pass
    return _effective_knowledge_config(knowledge_config, running_config)


async def _run_hanlp_task(task_key: str, request: HanLPTaskRunRequest, http_request: Request) -> HanLPTaskRunResponse:
    knowledge_config = await _resolve_knowledge_config(http_request)
    runtime = NLPRuntime()
    request_id = _effective_request_id(request.request_id)
    started = time.perf_counter()

    if task_key == "ner":
        result, state = runtime.run_ner(request.text, knowledge_config)
        normalized_result = _normalize_ner_result(result)
    elif task_key == "dep":
        result, state = runtime.run_dep(request.text, knowledge_config)
        normalized_result = _normalize_dep_result(result)
    else:
        raise HTTPException(status_code=400, detail="HANLP_TASK_UNSUPPORTED")

    duration_ms = int((time.perf_counter() - started) * 1000)
    status = str(state.get("status") or "unavailable")
    reason_code = str(state.get("reason_code") or "HANLP_TASK_FAILED")
    reason = str(state.get("reason") or "HanLP task failed.")
    response_result: object | None = normalized_result if status == "ready" else None

    return HanLPTaskRunResponse(
        task_key=task_key,
        request_id=request_id,
        status=status,
        reason_code=reason_code,
        reason=reason,
        result=response_result,
        resolved_model=str(getattr(knowledge_config.hanlp, "model_id", "") or ""),
        duration_ms=duration_ms,
    )


@router.post("/tasks/ner:run", response_model=HanLPTaskRunResponse)
async def run_ner_task(request: HanLPTaskRunRequest, http_request: Request) -> HanLPTaskRunResponse:
    return await _run_hanlp_task("ner", request, http_request)


@router.post("/tasks/dep:run", response_model=HanLPTaskRunResponse)
async def run_dep_task(request: HanLPTaskRunRequest, http_request: Request) -> HanLPTaskRunResponse:
    return await _run_hanlp_task("dep", request, http_request)
