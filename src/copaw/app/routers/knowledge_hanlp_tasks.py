# -*- coding: utf-8 -*-

from __future__ import annotations

import asyncio
import re
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
    raw_result: object | None = None
    resolved_model: str
    strategy_mode: str
    detected_style: str
    detection_score: float
    matched_rules: list[str]
    fallback_used: bool
    duration_ms: int
    model_cache_path: str = ""
    runtime_python_executable: str = ""
    effective_task_model_id: str = ""
    preload_status: str = "idle"


_CLASSICAL_HINT_CHARS = frozenset("之乎者也焉矣其乃若夫盖兮耳哉")
_CLASSICAL_HINT_PATTERNS = (
    re.compile(r"[吾余予汝尔卿]"),
    re.compile(r"[不无未弗毋勿]\w?"),
)
_MODERN_HINT_TOKENS = (
    "我们",
    "你们",
    "他们",
    "这个",
    "那个",
    "因为",
    "所以",
    "以及",
)
_SUPPORTED_TASK_KEYS = {"tokenize", "ner", "dep", "sdp", "con", "cor"}
_TASK_ALIASES = {
    "ner_msra": "ner",
}
_TASK_MATRIX_KEY_MAP = {
    "tokenize": "tok",
    "ner": "ner_msra",
    "dep": "dep",
    "sdp": "sdp",
    "con": "con",
    "cor": "coref",
}
_TASK_MODEL_DEFAULTS = {
    "ner_msra": "MSRA_NER_BERT_BASE_ZH",
}
_TASK_TIMEOUT_DEFAULTS = {
    "ner_msra": 90.0,
}
_TASK_TIMEOUT_MIN_FOR_BERT = {
    "ner_msra": 60.0,
}
_NER_NOISE_TOKENS = {
    "在",
    "发布",
    "召开",
    "进行",
    "以及",
    "并且",
}


def _entity_quality_score(item: dict[str, Any]) -> int:
    mention = str(item.get("text") or "")
    label = str(item.get("label") or "").upper()
    score = 0
    length = len(mention)
    if length >= 2:
        score += 2
    else:
        score -= 2
    if length <= 8:
        score += 1
    else:
        score -= 1
    if any(token in mention for token in _NER_NOISE_TOKENS):
        score -= 3
    if re.search(r"[，。！？、；：\s]", mention):
        score -= 2
    if label == "PERSON" and length <= 1:
        score -= 3
    return score


def _filter_overlapping_ner_entities(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered = sorted(
        items,
        key=lambda row: (
            int(row.get("start") or 0),
            int(row.get("end") or 0),
        ),
    )
    picked: list[dict[str, Any]] = []
    for item in ordered:
        start = item.get("start")
        end = item.get("end")
        if not isinstance(start, int) or not isinstance(end, int) or end <= start:
            continue
        if _entity_quality_score(item) < 0:
            continue
        if not picked:
            picked.append(item)
            continue
        prev = picked[-1]
        prev_start = int(prev.get("start") or 0)
        prev_end = int(prev.get("end") or 0)
        overlaps = start < prev_end and prev_start < end
        if not overlaps:
            picked.append(item)
            continue
        prev_score = _entity_quality_score(prev)
        item_score = _entity_quality_score(item)
        if item_score > prev_score:
            picked[-1] = item
            continue
        if item_score == prev_score:
            prev_len = len(str(prev.get("text") or ""))
            item_len = len(str(item.get("text") or ""))
            if item_len < prev_len:
                picked[-1] = item
    return picked


def _normalize_ner_result(raw: Any, source_text: str = "") -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    normalized: list[dict[str, Any]] = []
    pending: list[Any] = list(raw)
    while pending:
        item = pending.pop(0)
        if isinstance(item, list):
            if len(item) >= 4 and not any(isinstance(part, (list, dict, tuple)) for part in item[:4]):
                text = str(item[0] or "").strip()
                label = str(item[1] or "").strip()
                try:
                    start = int(item[2]) if item[2] is not None else None
                    end = int(item[3]) if item[3] is not None else None
                except (TypeError, ValueError):
                    start, end = None, None
                if text or (start is not None and end is not None):
                    normalized.append(
                        {
                            "text": text,
                            "label": label,
                            "start": start,
                            "end": end,
                            "score": None,
                        }
                    )
                continue
            pending[0:0] = list(item)
            continue
        if isinstance(item, tuple):
            pending.insert(0, list(item))
            continue
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
    text = str(source_text or "")
    cursor = 0
    for item in normalized:
        mention = str(item.get("text") or "")
        start = item.get("start")
        end = item.get("end")
        invalid_span = (
            start is None
            or end is None
            or int(start) < 0
            or int(end) < int(start)
            or (text and text[int(start):int(end)] != mention)
        )
        if mention and text and invalid_span:
            index = text.find(mention, cursor)
            if index < 0:
                index = text.find(mention)
            if index >= 0:
                item["start"] = index
                item["end"] = index + len(mention)
                cursor = index + len(mention)

    # Merge adjacent fragments (e.g. "北" + "京") for a cleaner demo view.
    merged: list[dict[str, Any]] = []
    for item in normalized:
        if not merged:
            merged.append(item)
            continue
        prev = merged[-1]
        same_label = str(prev.get("label") or "") == str(item.get("label") or "")
        prev_text = str(prev.get("text") or "")
        item_text = str(item.get("text") or "")
        prev_end = prev.get("end")
        item_start = item.get("start")
        if (
            same_label
            and prev_text
            and item_text
            and isinstance(prev_end, int)
            and isinstance(item_start, int)
            and item_start == prev_end
        ):
            prev["text"] = prev_text + item_text
            prev["end"] = item.get("end")
            continue
        merged.append(item)
    return _filter_overlapping_ner_entities(merged)


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


def _extract_hanlp_model_id(knowledge_config: Any) -> str:
    nlp_cfg = getattr(knowledge_config, "nlp", None)
    if nlp_cfg is None:
        nlp_cfg = getattr(knowledge_config, "hanlp", None)
    return str(getattr(nlp_cfg, "model_id", "") or "").strip()


def _clone_effective_config(knowledge_config: Any) -> Any:
    clone = getattr(knowledge_config, "model_copy", None)
    if callable(clone):
        return clone(deep=True)
    return knowledge_config


def _task_matrix_model_override(task_key: str, selected_model: str, effective_config: KnowledgeConfig) -> None:
    if not selected_model:
        return
    matrix_key = _TASK_MATRIX_KEY_MAP.get(task_key)
    if not matrix_key:
        return
    task_matrix = getattr(getattr(effective_config, "nlp", None), "task_matrix", None)
    tasks = getattr(task_matrix, "tasks", None) if task_matrix is not None else None
    if not isinstance(tasks, dict):
        return
    task_cfg = tasks.get(matrix_key)
    if task_cfg is None:
        return
    try:
        task_cfg.model_id = selected_model
    except Exception:
        return


def _task_matrix_model_id(task_key: str, effective_config: KnowledgeConfig) -> str:
    matrix_key = _TASK_MATRIX_KEY_MAP.get(task_key)
    if not matrix_key:
        return ""
    task_matrix = getattr(getattr(effective_config, "nlp", None), "task_matrix", None)
    tasks = getattr(task_matrix, "tasks", None) if task_matrix is not None else None
    if not isinstance(tasks, dict):
        return ""
    task_cfg = tasks.get(matrix_key)
    if task_cfg is None:
        return str(_TASK_MODEL_DEFAULTS.get(matrix_key, "") or "").strip()
    configured = str(getattr(task_cfg, "model_id", "") or "").strip()
    if configured:
        return configured
    return str(_TASK_MODEL_DEFAULTS.get(matrix_key, "") or "").strip()


def _ensure_runtime_task_model_defaults(task_key: str, effective_config: KnowledgeConfig) -> None:
    matrix_key = _TASK_MATRIX_KEY_MAP.get(task_key)
    if not matrix_key:
        return
    default_model = str(_TASK_MODEL_DEFAULTS.get(matrix_key, "") or "").strip()
    if not default_model:
        return
    task_matrix = getattr(getattr(effective_config, "nlp", None), "task_matrix", None)
    tasks = getattr(task_matrix, "tasks", None) if task_matrix is not None else None
    if not isinstance(tasks, dict):
        return
    task_cfg = tasks.get(matrix_key)
    if task_cfg is None:
        return

    def _safe_float(value: Any) -> float | None:
        try:
            if value is None:
                return None
            parsed = float(value)
            if parsed <= 0:
                return None
            return parsed
        except (TypeError, ValueError):
            return None

    def _set_timeout(value: float) -> None:
        try:
            task_cfg.timeout_sec = float(value)
        except Exception:
            return

    configured = str(getattr(task_cfg, "model_id", "") or "").strip()
    if configured:
        effective_model = configured
    else:
        try:
            task_cfg.model_id = default_model
        except Exception:
            pass
        effective_model = str(getattr(task_cfg, "model_id", "") or default_model).strip()

    default_timeout = float(_TASK_TIMEOUT_DEFAULTS.get(matrix_key, 0.0) or 0.0)
    timeout_sec = _safe_float(getattr(task_cfg, "timeout_sec", None))
    if default_timeout > 0 and timeout_sec is None:
        _set_timeout(default_timeout)
        timeout_sec = default_timeout

    bert_min_timeout = float(_TASK_TIMEOUT_MIN_FOR_BERT.get(matrix_key, 0.0) or 0.0)
    if bert_min_timeout > 0 and "BERT" in str(effective_model or "").upper():
        if timeout_sec is None or timeout_sec < bert_min_timeout:
            _set_timeout(max(default_timeout, bert_min_timeout))


def _should_override_task_matrix(decision: dict[str, Any]) -> bool:
    rules = [str(item or "") for item in decision.get("matched_rules", [])]
    return any(
        rule.startswith("strategy.task_overrides.") or rule == "strategy.auto_classical_chinese"
        for rule in rules
    )


def _classical_detection_score(text: str) -> float:
    normalized = str(text or "").strip()
    if not normalized:
        return 0.0
    classical_hits = sum(1 for ch in normalized if ch in _CLASSICAL_HINT_CHARS)
    for pattern in _CLASSICAL_HINT_PATTERNS:
        classical_hits += len(pattern.findall(normalized))
    modern_hits = 0
    for token in _MODERN_HINT_TOKENS:
        modern_hits += normalized.count(token)
    density_score = min(1.0, (classical_hits / max(len(normalized), 1)) * 10.0)
    contrast_score = max(0.0, (classical_hits - modern_hits) / max(classical_hits + modern_hits, 1))
    score = (density_score * 0.65) + (contrast_score * 0.35)
    return max(0.0, min(score, 1.0))


def _resolve_model_decision(task_key: str, text: str, knowledge_config: KnowledgeConfig) -> dict[str, Any]:
    normalized_task_key = _normalize_task_key(task_key)
    nlp_cfg = getattr(knowledge_config, "nlp", None)
    strategy = getattr(nlp_cfg, "strategy", None)
    base_model = _extract_hanlp_model_id(knowledge_config)
    selected_model = base_model
    detected_style = "modern"
    detection_score = 0.0
    matched_rules: list[str] = []
    mode = str(getattr(strategy, "mode", "auto") or "auto").strip().lower() or "auto"

    default_model = str(getattr(strategy, "default_model_id", "") or "").strip() if strategy else ""
    if default_model:
        selected_model = default_model
        matched_rules.append("strategy.default_model_id")

    task_overrides = getattr(strategy, "task_overrides", {}) if strategy is not None else {}
    if isinstance(task_overrides, dict):
        override_model = str(task_overrides.get(normalized_task_key) or "").strip()
        if override_model:
            selected_model = override_model
            matched_rules.append(f"strategy.task_overrides.{normalized_task_key}")

    auto_cfg = getattr(strategy, "auto_classical_chinese", None)
    auto_enabled = bool(getattr(auto_cfg, "enabled", False)) if auto_cfg is not None else False
    if mode in {"auto", "hybrid"} and auto_enabled:
        detection_score = _classical_detection_score(text)
        threshold = float(getattr(auto_cfg, "threshold", 0.22) or 0.22)
        if detection_score >= max(0.0, min(threshold, 1.0)):
            detected_style = "classical_chinese"
            classical_model = str(getattr(auto_cfg, "model_id", "") or "").strip()
            if classical_model:
                selected_model = classical_model
                matched_rules.append("strategy.auto_classical_chinese")

    if not selected_model:
        selected_model = base_model
        if base_model:
            matched_rules.append("knowledge.nlp.model_id")

    return {
        "strategy_mode": mode,
        "detected_style": detected_style,
        "detection_score": round(detection_score, 4),
        "selected_model": selected_model,
        "matched_rules": matched_rules,
        "fallback_used": False,
    }


def _normalize_task_key(task_key: str) -> str:
    normalized = str(task_key or "").strip().lower()
    if normalized in _TASK_ALIASES:
        return _TASK_ALIASES[normalized]
    return normalized


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
    normalized_task_key = _normalize_task_key(task_key)
    if normalized_task_key not in _SUPPORTED_TASK_KEYS:
        raise HTTPException(status_code=400, detail="HANLP_TASK_UNSUPPORTED")

    knowledge_config = await _resolve_knowledge_config(http_request)
    decision = _resolve_model_decision(normalized_task_key, request.text, knowledge_config)
    effective_config = _clone_effective_config(knowledge_config)
    _ensure_runtime_task_model_defaults(normalized_task_key, effective_config)
    if decision["selected_model"]:
        nlp_cfg = getattr(effective_config, "nlp", None)
        if nlp_cfg is not None:
            nlp_cfg.model_id = str(decision["selected_model"])
            if _should_override_task_matrix(decision):
                _task_matrix_model_override(normalized_task_key, str(decision["selected_model"]), effective_config)
    runtime = NLPRuntime()
    request_id = _effective_request_id(request.request_id)
    started = time.perf_counter()

    if normalized_task_key == "tokenize":
        result, state = await asyncio.to_thread(runtime.tokenize, request.text, effective_config)
        raw_result = result
        normalized_result = list(result) if isinstance(result, list) else []
    elif normalized_task_key == "ner":
        result, state = await asyncio.to_thread(runtime.run_ner, request.text, effective_config)
        raw_result = result
        normalized_result = _normalize_ner_result(result, request.text)
    elif normalized_task_key == "dep":
        result, state = await asyncio.to_thread(runtime.run_dep, request.text, effective_config)
        raw_result = result
        normalized_result = _normalize_dep_result(result)
    else:
        result, state = await asyncio.to_thread(
            runtime.run_task,
            normalized_task_key,
            request.text,
            effective_config,
        )
        raw_result = result
        normalized_result = result

    duration_ms = int((time.perf_counter() - started) * 1000)
    status = str(state.get("status") or "unavailable")
    reason_code = str(state.get("reason_code") or "HANLP_TASK_FAILED")
    reason = str(state.get("reason") or "HanLP task failed.")
    response_result: object | None = normalized_result if status == "ready" else None
    response_raw_result: object | None = raw_result if status == "ready" else None
    if status != "ready":
        decision["fallback_used"] = True

    nlp_cfg = getattr(effective_config, "nlp", None)
    model_cache_path = str(getattr(nlp_cfg, "model_home", "") or "").strip()
    runtime_python_executable = str(getattr(nlp_cfg, "python_executable", "") or "").strip()
    effective_task_model_id = str(
        _task_matrix_model_id(normalized_task_key, effective_config)
        or decision["selected_model"]
        or _extract_hanlp_model_id(knowledge_config)
    )
    preload_status = "idle"
    try:
        from qwenpaw.agents.utils.hanlp_sidecar import get_hanlp_model_cache_path, get_hanlp_preload_status

        if not model_cache_path:
            model_cache_path = str(get_hanlp_model_cache_path() or "")
        preload_status = str(get_hanlp_preload_status().get("status") or "idle")
    except Exception:
        pass

    return HanLPTaskRunResponse(
        task_key=normalized_task_key,
        request_id=request_id,
        status=status,
        reason_code=reason_code,
        reason=reason,
        result=response_result,
        raw_result=response_raw_result,
        resolved_model=str(
            _task_matrix_model_id(normalized_task_key, effective_config)
            or decision["selected_model"]
            or _extract_hanlp_model_id(knowledge_config)
        ),
        strategy_mode=str(decision["strategy_mode"]),
        detected_style=str(decision["detected_style"]),
        detection_score=float(decision["detection_score"]),
        matched_rules=list(decision["matched_rules"]),
        fallback_used=bool(decision["fallback_used"]),
        duration_ms=duration_ms,
        model_cache_path=model_cache_path,
        runtime_python_executable=runtime_python_executable,
        effective_task_model_id=effective_task_model_id,
        preload_status=preload_status,
    )


@router.post("/tasks/{task_key}/run", response_model=HanLPTaskRunResponse)
async def run_generic_task(
    task_key: str,
    request: HanLPTaskRunRequest,
    http_request: Request,
) -> HanLPTaskRunResponse:
    return await _run_hanlp_task(task_key, request, http_request)
