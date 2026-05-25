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
_TASK_MODEL_DEFAULTS = {
    "ner_msra": "MSRA_NER_ELECTRA_SMALL_ZH",
    "dep": "CTB9_DEP_ELECTRA_SMALL",
    "sdp": "SEMEVAL16_ALL_ELECTRA_SMALL_ZH",
    "con": "CTB9_CON_ELECTRA_SMALL",
    "srl": "CPB3_SRL_ELECTRA_SMALL",
    "pos_ctb": "CTB9_POS_ELECTRA_SMALL",
    "pos_pku": "PKU_POS_ELECTRA_SMALL",
    "pos_863": "C863_POS_ELECTRA_SMALL",
}


def _normalize_siamese_python_executable(path: str) -> str:
    normalized = str(path or "").strip()
    if normalized.replace("\\", "/").endswith("/.venv-hanlp/bin/python") or not normalized:
        project_root = Path(__file__).resolve().parents[4]
        return str(project_root / ".venv-senta" / "bin" / "python")
    return normalized


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
    subdirs = (
        "",
        "tok",
        "mtl",
        "ner",
        "dep",
        "pos",
        "sdp",
        "srl",
        "con",
        "constituency",
        "classification",
        "transformers",
    )
    for home in _model_cache_homes(hanlp_home):
        for subdir in subdirs:
            base = os.path.join(home, subdir) if subdir else home
            for key in keys:
                path = os.path.join(base, key)
                if os.path.isdir(path) or os.path.isfile(path):
                    return True
    return False


def _classical_local_item(config) -> dict[str, Any]:
    model_home = str(getattr(config.nlp, "model_home", "") or "")
    return {
        "scope": "classical",
        "task_key": "lzh_tok_fine",
        "task_name": "tok/fine",
        "model_id": _CLASSICAL_SINGLE_MODEL_ID,
        "local_available": bool(_host_has_local_model_artifact(_CLASSICAL_SINGLE_MODEL_ID, model_home)),
    }


def _require_local_models() -> bool:
    value = str(os.environ.get("COPAW_HANLP_REQUIRE_LOCAL_MODELS", "1") or "1").strip().lower()
    return value not in {"0", "false", "no", "off"}


def _effective_task_model_id(task_key: str, task_cfg, default_model_id: str) -> str:
    configured = str(getattr(task_cfg, "model_id", "") or "").strip() if task_cfg is not None else ""
    if configured:
        return configured
    fallback = str(_TASK_MODEL_DEFAULTS.get(str(task_key or "").strip(), "") or "").strip()
    if fallback:
        return fallback
    return default_model_id


def _build_local_models_payload(config) -> dict[str, Any]:
    nlp_cfg = config.nlp
    model_home = str(getattr(nlp_cfg, "model_home", "") or "")
    default_model_id = str(getattr(nlp_cfg, "model_id", "") or "").strip()
    task_matrix = getattr(nlp_cfg, "task_matrix", None)
    tasks = getattr(task_matrix, "tasks", {}) if task_matrix is not None else {}

    items: list[dict[str, Any]] = []
    if default_model_id:
        items.append(
            {
                "scope": "default",
                "task_key": "tokenize",
                "task_name": "tokenize",
                "model_id": default_model_id,
                "local_available": bool(_host_has_local_model_artifact(default_model_id, model_home)),
            }
        )

    if isinstance(tasks, dict):
        for task_key, task_cfg in tasks.items():
            if not bool(getattr(task_cfg, "enabled", True)):
                continue
            model_id = _effective_task_model_id(str(task_key), task_cfg, default_model_id)
            if not model_id:
                continue
            task_name = str(getattr(task_cfg, "task_name", task_key) or task_key).strip()
            items.append(
                {
                    "scope": "task",
                    "task_key": str(task_key),
                    "task_name": task_name,
                    "model_id": model_id,
                    "local_available": bool(_host_has_local_model_artifact(model_id, model_home)),
                }
            )

    # Ensure classical single-model availability is always represented.
    classical_item = _classical_local_item(config)
    if not any(
        str(item.get("task_key") or "").strip() == str(classical_item.get("task_key") or "").strip()
        for item in items
    ):
        items.append(classical_item)

    all_local = all(bool(item.get("local_available")) for item in items) if items else True
    return {
        "engine": "hanlp",
        "status": "ready" if all_local else "unavailable",
        "reason_code": "HANLP_LOCAL_MODELS_READY" if all_local else "HANLP_MODEL_NOT_LOCAL",
        "reason": (
            "All required HanLP models are present in local cache."
            if all_local
            else "Some HanLP models are missing from local cache."
        ),
        "require_local_models": _require_local_models(),
        "hanlp_home": model_home,
        "model_cache_path": model_home,
        "items": items,
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
    result["reason_code"] = "HANLP_LOCAL_MODELS_READY" if all_local else "HANLP_MODEL_NOT_LOCAL"
    result["reason"] = (
        "All required HanLP models are present in local cache."
        if all_local
        else "Some HanLP models are missing from local cache."
    )
    return result


def _runtime_knowledge_config(config) -> Any:
    """Build runtime knowledge config and attach top-level nlp settings."""
    knowledge_cfg = config.knowledge.model_copy(deep=True)
    setattr(knowledge_cfg, "nlp", config.nlp.model_copy(deep=True))
    return knowledge_cfg


def _build_hanlp_status_payload(config, include_runtime_api: bool, strategy_payload: dict[str, Any]) -> dict[str, Any]:
    from ...agents.utils.hanlp_sidecar import get_hanlp_sidecar_status

    payload = get_hanlp_sidecar_status(include_task_status=False)
    sidecar_payload = payload.get("sidecar") if isinstance(payload.get("sidecar"), dict) else {}
    if isinstance(sidecar_payload, dict):
        python_version = str(sidecar_payload.get("python_version") or "").strip()
        if not python_version:
            python_version = _detect_python_version(str(sidecar_payload.get("python_executable") or ""))
        sidecar_payload["python_version"] = python_version
    payload["provider"] = "hanlp"
    payload["strategy"] = strategy_payload
    if include_runtime_api:
        payload["api"] = NLPRuntime().api_status(_runtime_knowledge_config(config))
    else:
        payload["api"] = _build_hanlp_api_snapshot(payload)
    return payload


def _build_siamese_status_payload(config, strategy_payload: dict[str, Any]) -> dict[str, Any]:
    nlp_cfg = config.nlp
    model_home = str(getattr(nlp_cfg, "model_home", "") or "")
    siamese_python = _normalize_siamese_python_executable(
        str(getattr(nlp_cfg, "siamese_python_executable", "") or "")
    )
    try:
        from copaw.knowledge.siamese_uninlu_runtime import SiameseUniNLURuntime

        probe = SiameseUniNLURuntime.probe(config)
        probe_status = str(probe.get("status") or "unavailable")
        model_id = str(probe.get("model_id") or getattr(nlp_cfg, "siamese_model_id", "") or "")
        task_status = "ready" if probe_status == "ready" else ("disabled" if probe_status == "disabled" else "unavailable")
        tasks = {
            item["task_key"]: {
                "enabled": probe_status != "disabled",
                "status": task_status,
                "reason_code": str(probe.get("reason_code") or "SIAMESE_UNAVAILABLE"),
                "reason": str(probe.get("reason") or "Siamese UniNLU unavailable."),
            }
            for item in SiameseUniNLURuntime.methods_catalog()
        }
        return {
            "provider": "siamese_uninlu",
            "strategy": strategy_payload,
            "sidecar": {
                "status": probe_status,
                "reason_code": str(probe.get("reason_code") or "SIAMESE_UNAVAILABLE"),
                "reason": str(probe.get("reason") or "Siamese UniNLU unavailable."),
                "enabled": bool(getattr(nlp_cfg, "siamese_sidecar_enabled", False)),
                "python_executable": siamese_python,
                "python_version": _detect_python_version(siamese_python),
                "managed": False,
                "uv_available": False,
                "uv_executable": "",
                "model_home": model_home,
                "model_cache_path": model_home,
            },
            "model": {
                "status": "ready" if probe_status == "ready" else probe_status,
                "reason_code": str(probe.get("reason_code") or "SIAMESE_UNAVAILABLE"),
                "reason": str(probe.get("reason") or "Siamese UniNLU unavailable."),
                "model_id": model_id,
            },
            "tasks": tasks,
            "api": {
                "status": "ready" if probe_status == "ready" else probe_status,
                "reason_code": str(probe.get("reason_code") or "SIAMESE_UNAVAILABLE"),
                "reason": str(probe.get("reason") or "Siamese API unavailable."),
            },
            "preload": {
                "enabled": False,
                "scope": "critical",
                "status": "disabled",
                "reason": "Startup preload is only available for HanLP.",
                "model_cache_path": model_home,
                "preloaded_models": [],
                "task_results": {},
            },
        }
    except Exception as exc:
        return {
            "provider": "siamese_uninlu",
            "strategy": strategy_payload,
            "sidecar": {
                "status": "unavailable",
                "reason_code": "SIAMESE_RUNTIME_IMPORT_FAILED",
                "reason": str(exc),
                "enabled": bool(getattr(nlp_cfg, "siamese_sidecar_enabled", False)),
                "python_executable": siamese_python,
                "python_version": _detect_python_version(siamese_python),
                "managed": False,
                "uv_available": False,
                "uv_executable": "",
                "model_home": model_home,
                "model_cache_path": model_home,
            },
            "model": {
                "status": "unavailable",
                "reason_code": "SIAMESE_RUNTIME_IMPORT_FAILED",
                "reason": str(exc),
                "model_id": str(getattr(nlp_cfg, "siamese_model_id", "") or ""),
            },
            "tasks": {},
            "api": {
                "status": "unavailable",
                "reason_code": "SIAMESE_RUNTIME_IMPORT_FAILED",
                "reason": str(exc),
            },
            "preload": {
                "enabled": False,
                "scope": "critical",
                "status": "disabled",
                "reason": "Startup preload is only available for HanLP.",
                "model_cache_path": model_home,
                "preloaded_models": [],
                "task_results": {},
            },
        }


def _build_hanlp_methods_catalog(config) -> list[dict[str, Any]]:
    names = {
        "tokenize": "智能分词",
        "ner": "实体识别",
        "pos_ctb": "词性分析（CTB）",
        "pos_pku": "词性分析（PKU）",
        "pos_863": "词性分析（863）",
        "dep": "句法依存",
        "sdp": "语义依存",
        "srl": "语义角色",
        "con": "短语结构",
        "lzh_tok_fine": "古汉语分词（细分）",
        "lzh_tok_coarse": "古汉语分词（粗分）",
        "lzh_lem": "古汉语词形还原",
        "lzh_pos_upos": "古汉语词性（UPOS）",
        "lzh_pos_xpos": "古汉语词性（XPOS）",
        "lzh_pos_pku": "古汉语词性（PKU）",
        "lzh_dep": "古汉语依存句法",
    }
    nlp_cfg = config.nlp
    task_matrix = getattr(nlp_cfg, "task_matrix", None)
    task_cfgs = getattr(task_matrix, "tasks", {}) if task_matrix is not None else {}

    keys: list[str] = ["tokenize"]
    if isinstance(task_cfgs, dict):
        keys.extend(str(key) for key in task_cfgs.keys())
    for item in ["lzh_tok_fine", "lzh_tok_coarse", "lzh_lem", "lzh_pos_upos", "lzh_pos_xpos", "lzh_pos_pku", "lzh_dep"]:
        if item not in keys:
            keys.append(item)

    dedup: list[str] = []
    for key in keys:
        if key not in dedup:
            dedup.append(key)

    return [
        {
            "provider": "hanlp",
            "task_key": task_key,
            "title": names.get(task_key, task_key),
            "description": "HanLP task demo",
            "input_mode": "text",
            "route_path": f"/api/nlp/hanlp/tasks/{task_key}/run",
        }
        for task_key in dedup
    ]


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
    nlp_cfg = config.nlp
    provider = str(getattr(nlp_cfg, "provider", "hanlp") or "hanlp").strip().lower()

    strategy_payload = _build_nlp_strategy_payload(nlp_cfg)

    hanlp_payload = await asyncio.to_thread(
        _build_hanlp_status_payload,
        config,
        include_runtime_api,
        strategy_payload,
    )
    siamese_payload = await asyncio.to_thread(
        _build_siamese_status_payload,
        config,
        strategy_payload,
    )

    providers_payload = {
        "hanlp": hanlp_payload,
        "siamese_uninlu": siamese_payload,
    }
    active_provider = provider if provider in providers_payload else "hanlp"
    active_payload = dict(providers_payload.get(active_provider) or {})
    active_payload["provider"] = active_provider
    active_payload["providers"] = providers_payload
    return active_payload


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
    nlp_cfg = config.nlp
    provider = str(getattr(nlp_cfg, "provider", "hanlp") or "hanlp").strip().lower()

    if provider != "hanlp":
        return {
            "provider": provider,
            "engine": provider,
            "status": "ready",
            "reason_code": "NLP_LOCAL_MODELS_NOT_REQUIRED",
            "reason": "Local model cache probing is currently only required for HanLP.",
            "require_local_models": False,
            "model_cache_path": str(getattr(nlp_cfg, "model_home", "") or ""),
            "items": [],
        }

    payload = _build_local_models_payload(config)
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
    nlp_cfg = config.nlp
    provider = str(getattr(nlp_cfg, "provider", "hanlp") or "hanlp").strip().lower()

    if provider != "hanlp":
        return {
            "provider": provider,
            "success": True,
            "requested": [],
            "attempts": [],
            "before": {
                "status": "ready",
                "reason_code": "NLP_LOCAL_MODELS_NOT_REQUIRED",
                "missing_count": 0,
            },
            "after": {
                "status": "ready",
                "reason_code": "NLP_LOCAL_MODELS_NOT_REQUIRED",
                "missing_count": 0,
            },
            "remaining": [],
            "model_cache_path": str(getattr(nlp_cfg, "model_home", "") or ""),
        }

    runtime = NLPRuntime()
    before = _build_local_models_payload(config)
    before_items = list(before.get("items") or [])
    missing_items = [item for item in before_items if not bool(item.get("local_available", False))]

    model_ids: list[str] = []
    for item in missing_items:
        model_id = str(item.get("model_id") or "").strip()
        if model_id and model_id not in model_ids:
            model_ids.append(model_id)

    attempts: list[dict] = []
    for model_id in model_ids:
        local_config = _runtime_knowledge_config(config)
        local_config.nlp.model_id = model_id
        result = await asyncio.to_thread(runtime.ensure_model, local_config)
        attempts.append(
            {
                "model_id": model_id,
                "status": str(result.get("status") or "unavailable"),
                "reason_code": str(result.get("reason_code") or "HANLP_MODEL_LOAD_FAILED"),
                "reason": str(result.get("reason") or "Model ensure failed."),
            }
        )

    after = _build_local_models_payload(config)
    remaining = [item for item in list(after.get("items") or []) if not bool(item.get("local_available", False))]

    return {
        "provider": provider,
        "success": len(remaining) == 0,
        "requested": model_ids,
        "attempts": attempts,
        "before": {
            "status": str(before.get("status") or "unavailable"),
            "reason_code": str(before.get("reason_code") or "HANLP_LOCAL_MODELS_STATUS_FAILED"),
            "missing_count": len(missing_items),
        },
        "after": {
            "status": str(after.get("status") or "unavailable"),
            "reason_code": str(after.get("reason_code") or "HANLP_LOCAL_MODELS_STATUS_FAILED"),
            "missing_count": len(remaining),
        },
        "remaining": remaining,
        "model_cache_path": str(getattr(nlp_cfg, "model_home", "") or ""),
    }


@router.get(
    "/nlp-methods/catalog",
    summary="List NLP methods by provider",
    description="Return method catalogs for HanLP and SiameseUniNLU provider-specific routes.",
)
async def get_sidecar_nlp_methods_catalog() -> dict[str, Any]:
    """Return provider-scoped NLP method catalog used by the settings UI."""
    config = load_config()
    nlp_cfg = config.nlp
    selected_provider = str(getattr(nlp_cfg, "provider", "hanlp") or "hanlp").strip().lower()
    hanlp_methods = _build_hanlp_methods_catalog(config)
    try:
        from copaw.knowledge.siamese_uninlu_runtime import SiameseUniNLURuntime

        siamese_methods = SiameseUniNLURuntime.methods_catalog()
    except Exception:
        siamese_methods = []

    return {
        "selected_provider": selected_provider,
        "providers": {
            "hanlp": hanlp_methods,
            "siamese_uninlu": siamese_methods,
        },
    }
