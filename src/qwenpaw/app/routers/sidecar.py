# -*- coding: utf-8 -*-
"""Sidecar status API routes."""

import asyncio

from fastapi import APIRouter, Query

from ...config import load_config
from ...knowledge.hanlp_runtime import NLPRuntime
from .agent import (
    _build_hanlp_api_snapshot,
    _build_nlp_strategy_payload,
    _detect_python_version,
)

router = APIRouter(prefix="/sidecar", tags=["sidecar"])


@router.get(
    "/nlp-status",
    summary="Check NLP sidecar runtime availability",
    description=(
        "Check whether the generic NLP sidecar runtime is configured. "
        "HanLP has been removed and RexUniNLU integration is pending."
    ),
)
async def get_sidecar_nlp_status(
    include_runtime_api: bool = Query(
        default=False,
        description="When true, run full runtime api probe (slower).",
    ),
) -> dict:
    """Return provider-aware NLP sidecar runtime status."""
    config = load_config()
    nlp_cfg = config.knowledge.nlp
    provider = str(getattr(nlp_cfg, "provider", "hanlp") or "hanlp").strip().lower()

    strategy_payload = _build_nlp_strategy_payload(nlp_cfg)

    if provider == "hanlp":
        from ...agents.utils.hanlp_sidecar import get_hanlp_sidecar_status

        payload = await asyncio.to_thread(get_hanlp_sidecar_status, include_task_status=False)
        sidecar_payload = payload.get("sidecar") if isinstance(payload.get("sidecar"), dict) else {}
        if isinstance(sidecar_payload, dict):
            python_version = str(sidecar_payload.get("python_version") or "").strip()
            if not python_version:
                python_version = _detect_python_version(str(sidecar_payload.get("python_executable") or ""))
            sidecar_payload["python_version"] = python_version
        payload["provider"] = "hanlp"
        payload["strategy"] = strategy_payload
        if include_runtime_api:
            payload["api"] = await asyncio.to_thread(NLPRuntime().api_status, config.knowledge)
        else:
            payload["api"] = _build_hanlp_api_snapshot(payload)
        return payload

    runtime = NLPRuntime()
    sidecar_state = runtime.probe(config.knowledge)
    model_state = runtime.model_status(config.knowledge)
    api_payload = runtime.api_status(config.knowledge)
    model_home = str(getattr(nlp_cfg, "model_home", "") or "")
    return {
        "provider": provider,
        "sidecar": {
            "status": str(sidecar_state.get("status") or "unavailable"),
            "reason_code": str(sidecar_state.get("reason_code") or "NLP_ENGINE_UNAVAILABLE"),
            "reason": str(sidecar_state.get("reason") or "NLP runtime is unavailable."),
            "enabled": bool(getattr(nlp_cfg, "enabled", False)),
            "python_executable": str(getattr(nlp_cfg, "python_executable", "") or ""),
            "python_version": _detect_python_version(str(getattr(nlp_cfg, "python_executable", "") or "")),
            "managed": False,
            "uv_available": False,
            "uv_executable": "",
            "model_home": model_home,
            "model_cache_path": model_home,
        },
        "model": {
            "status": str(model_state.get("status") or "unavailable"),
            "reason_code": str(model_state.get("reason_code") or "NLP_ENGINE_UNAVAILABLE"),
            "reason": str(model_state.get("reason") or "NLP model is unavailable."),
            "model_id": str(getattr(nlp_cfg, "model_id", "") or ""),
        },
        "strategy": strategy_payload,
        "api": api_payload,
        "preload": {
            "enabled": bool(getattr(nlp_cfg, "preload_on_startup", False)),
            "scope": str(getattr(nlp_cfg, "preload_scope", "critical") or "critical"),
            "status": "disabled",
            "reason": "Startup preload is only available for HanLP.",
            "model_cache_path": model_home,
            "preloaded_models": [],
            "task_results": {},
        },
    }
