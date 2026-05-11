# -*- coding: utf-8 -*-
"""Sidecar status API routes."""

import asyncio
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query

from ...config import load_config
from copaw.knowledge.hanlp_nlp_runtime import NLPRuntime, _HANLP_PRETRAINED_URLS
from .agent import (
    _build_hanlp_api_snapshot,
    _build_nlp_strategy_payload,
    _detect_python_version,
)

router = APIRouter(prefix="/sidecar", tags=["sidecar"])

_CLASSICAL_SINGLE_MODEL_ID = "KYOTO_EVAHAN_TOK_LEM_POS_UDEP_LZH"


def _extract_model_cache_keys(model_id: str) -> list[str]:
    raw = str(model_id or "").strip()
    if not raw:
        return []
    keys: list[str] = []
    name = raw
    if name.lower().endswith(".zip"):
        name = name[:-4]
    if name.startswith("http://") or name.startswith("https://"):
        name = name.rstrip("/").split("/")[-1]
        if name.lower().endswith(".zip"):
            name = name[:-4]
        keys.append(name)
    else:
        keys.append(name)
    dedup: list[str] = []
    for key in keys:
        if key not in dedup:
            dedup.append(key)
    return dedup


def _model_cache_homes(hanlp_home: str = "") -> list[str]:
    homes: list[str] = []
    custom = str(hanlp_home or "").strip()
    if custom:
        homes.append(custom)
    default = os.path.join(str(Path.home()), ".hanlp")
    if default not in homes:
        homes.append(default)
    return homes


def _resolve_hanlp_constant_url(model_id: str) -> str | None:
    raw = str(model_id or "").strip()
    if not raw or raw.startswith("http://") or raw.startswith("https://"):
        return None
    url = _HANLP_PRETRAINED_URLS.get(raw)
    return url if isinstance(url, str) and url else None


def _host_has_local_model_artifact(model_id: str, hanlp_home: str = "") -> bool:
    keys = _extract_model_cache_keys(model_id)
    resolved_url = _resolve_hanlp_constant_url(model_id)
    if resolved_url:
        for key in _extract_model_cache_keys(resolved_url):
            if key not in keys:
                keys.append(key)
    if not keys:
        return False
    subdirs = ("", "tok", "mtl", "ner", "dep", "pos", "sdp", "con", "classification", "transformers")
    for home in _model_cache_homes(hanlp_home):
        for subdir in subdirs:
            base = os.path.join(home, subdir) if subdir else home
            for key in keys:
                path = os.path.join(base, key)
                if os.path.isdir(path) or os.path.isfile(path):
                    return True
    return False


def _classical_local_item(config) -> dict[str, Any]:
    model_home = str(getattr(config.knowledge.nlp, "model_home", "") or "")
    return {
        "scope": "classical",
        "task_key": "lzh_tok_fine",
        "task_name": "tok/fine",
        "model_id": _CLASSICAL_SINGLE_MODEL_ID,
        "local_available": bool(_host_has_local_model_artifact(_CLASSICAL_SINGLE_MODEL_ID, model_home)),
    }


def _augment_local_models_payload(payload: dict[str, Any], config) -> dict[str, Any]:
    result = dict(payload or {})
    items = [dict(item) for item in list(result.get("items") or [])]
    seen_ids = {
        str(item.get("model_id") or "").strip()
        for item in items
        if str(item.get("model_id") or "").strip()
    }
    if _CLASSICAL_SINGLE_MODEL_ID not in seen_ids:
        items.append(_classical_local_item(config))

    all_local = all(bool(item.get("local_available")) for item in items) if items else True
    result["items"] = items
    result["status"] = "ready" if all_local else "unavailable"
    result["reason_code"] = "HANLP2_LOCAL_MODELS_READY" if all_local else "HANLP2_MODEL_NOT_LOCAL"
    result["reason"] = (
        "All required HanLP models are present in local cache."
        if all_local
        else "Some HanLP models are missing from local cache."
    )
    return result


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


@router.get(
    "/nlp-local-models",
    summary="Check local model availability for NLP sidecar",
    description=(
        "Return local cache availability for configured NLP default model and "
        "all enabled task models."
    ),
)
async def get_sidecar_nlp_local_models() -> dict:
    """Return local model readiness for current NLP configuration."""
    config = load_config()
    nlp_cfg = config.knowledge.nlp
    provider = str(getattr(nlp_cfg, "provider", "hanlp") or "hanlp").strip().lower()

    runtime = NLPRuntime()
    payload = await asyncio.to_thread(runtime.local_models_status, config.knowledge)
    payload = _augment_local_models_payload(payload, config)
    payload["provider"] = provider
    payload["model_cache_path"] = str(getattr(nlp_cfg, "model_home", "") or "")
    return payload


@router.post(
    "/nlp-local-models/download-missing",
    summary="Download missing local models for NLP sidecar",
    description=(
        "Download all models reported as missing by nlp-local-models and "
        "re-check local availability after download attempts."
    ),
)
async def download_missing_local_models() -> dict:
    """Download all currently missing local models in sequence."""
    config = load_config()
    nlp_cfg = config.knowledge.nlp
    provider = str(getattr(nlp_cfg, "provider", "hanlp") or "hanlp").strip().lower()

    runtime = NLPRuntime()
    before = await asyncio.to_thread(runtime.local_models_status, config.knowledge)
    before = _augment_local_models_payload(before, config)
    before_items = list(before.get("items") or [])
    missing_items = [item for item in before_items if not bool(item.get("local_available", False))]

    model_ids: list[str] = []
    for item in missing_items:
        model_id = str(item.get("model_id") or "").strip()
        if model_id and model_id not in model_ids:
            model_ids.append(model_id)

    attempts: list[dict] = []
    for model_id in model_ids:
        local_config = config.knowledge.model_copy(deep=True)
        local_config.nlp.model_id = model_id
        result = await asyncio.to_thread(runtime.ensure_model, local_config, allow_download=True)
        attempts.append(
            {
                "model_id": model_id,
                "status": str(result.get("status") or "unavailable"),
                "reason_code": str(result.get("reason_code") or "HANLP2_MODEL_LOAD_FAILED"),
                "reason": str(result.get("reason") or "Model ensure failed."),
            }
        )

    after = await asyncio.to_thread(runtime.local_models_status, config.knowledge)
    after = _augment_local_models_payload(after, config)
    remaining = [item for item in list(after.get("items") or []) if not bool(item.get("local_available", False))]

    return {
        "provider": provider,
        "success": len(remaining) == 0,
        "requested": model_ids,
        "attempts": attempts,
        "before": {
            "status": str(before.get("status") or "unavailable"),
            "reason_code": str(before.get("reason_code") or "HANLP2_LOCAL_MODELS_STATUS_FAILED"),
            "missing_count": len(missing_items),
        },
        "after": {
            "status": str(after.get("status") or "unavailable"),
            "reason_code": str(after.get("reason_code") or "HANLP2_LOCAL_MODELS_STATUS_FAILED"),
            "missing_count": len(remaining),
        },
        "remaining": remaining,
        "model_cache_path": str(getattr(nlp_cfg, "model_home", "") or ""),
    }
