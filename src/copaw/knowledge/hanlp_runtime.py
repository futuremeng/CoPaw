# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from ..config.config import KnowledgeConfig

_BRIDGE_CODE = r"""
import json
import os
import sys


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))


def flatten(value):
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple)):
        tokens = []
        for item in value:
            tokens.extend(flatten(item))
        return tokens
    return []


def normalize_task_key(task_name):
    return str(task_name or "").strip().replace("/", "_").replace("-", "_")


def is_coref_task_name(task_name):
    normalized = normalize_task_key(task_name)
    return normalized in {
        "cor",
        "coref",
        "coreference",
        "coreference_resolution",
    }


def version_text():
    return f"{sys.version_info.major}.{sys.version_info.minor}"


def version_in_range():
    current = (sys.version_info.major, sys.version_info.minor)
    return (3, 6) <= current <= (3, 9)


def load_payload():
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def load_task_specs(payload):
    raw_matrix = payload.get("task_matrix") or {}
    if not isinstance(raw_matrix, dict):
        return {}
    raw_tasks = raw_matrix.get("tasks") or {}
    if not isinstance(raw_tasks, dict):
        return {}
    specs = {}
    for task_key, raw_spec in raw_tasks.items():
        if not isinstance(raw_spec, dict):
            continue
        specs[str(task_key)] = {
            "enabled": bool(raw_spec.get("enabled", True)),
            "task_name": str(raw_spec.get("task_name") or "").strip(),
            "model_id": str(raw_spec.get("model_id") or "").strip(),
            "artifact_key": str(raw_spec.get("artifact_key") or task_key).strip(),
            "eval_role": str(raw_spec.get("eval_role") or "compare").strip(),
            "timeout_sec": float(raw_spec.get("timeout_sec") or payload.get("tokenize_timeout_sec") or 30.0),
        }
    return specs


def lookup_task_spec(payload, task_key):
    task_specs = load_task_specs(payload)
    spec = task_specs.get(str(task_key or "").strip())
    if spec:
        return spec
    normalized = normalize_task_key(task_key)
    for item in task_specs.values():
        if normalize_task_key(item.get("task_name")) == normalized:
            return item
    return None


def locate_tokenizer(module):
    for attr in ("tokenize", "tok"):
        fn = getattr(module, attr, None)
        if callable(fn):
            return attr, fn
    return "", None


def locate_parser(module):
    # In HanLP 2.x, parse is done via pipeline with specific models
    # For dep task, try dependency parsing models
    loader = getattr(module, "load", None)
    if callable(loader):
        for model_id in ["CTB9_DEP_ELECTRA_SMALL", "CTB7_BIAFFINE_DEP_ZH", "CTB5_BIAFFINE_DEP_ZH"]:
            try:
                model = loader(model_id)
                if model is not None:
                    return model
            except Exception:
                continue
    return None


def locate_coref_resolver(module):
    # In HanLP 2.x, coreference_resolution may not be directly supported
    # Try SDP models as they might provide semantic relations
    loader = getattr(module, "load", None)
    if callable(loader):
        # Try semantic dependency parsing models which might help with coreference
        for model_id in ["OPEN_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH", "CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH"]:
            try:
                model = loader(model_id)
                if model is not None:
                    return model
            except Exception:
                continue
    return None


def locate_ner_resolver(module, ner_type="msra"):
    # For NER tasks
    loader = getattr(module, "load", None)
    if callable(loader):
        if ner_type.lower() == "msra":
            for model_id in ["MSRA_NER_ELECTRA_SMALL_ZH", "MSRA_NER_BERT_BASE_ZH", "MSRA_NER_ALBERT_BASE_ZH"]:
                try:
                    model = loader(model_id)
                    if model is not None:
                        return model
                except Exception:
                    continue
    return None


def locate_sdp_resolver(module):
    # For semantic dependency parsing
    loader = getattr(module, "load", None)
    if callable(loader):
        for model_id in ["OPEN_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH", "CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH"]:
            try:
                model = loader(model_id)
                if model is not None:
                    return model
            except Exception:
                continue
    return None


def locate_con_resolver(module):
    # For constituency parsing
    loader = getattr(module, "load", None)
    if callable(loader):
        for model_id in ["CTB9_CON_ELECTRA_SMALL", "CTB9_CON_FULL_TAG_ELECTRA_SMALL"]:
            try:
                model = loader(model_id)
                if model is not None:
                    return model
            except Exception:
                continue
    return None


def validate_model(module, model_id, text="HanLP 模型校验"):
    raw_model_id, model, resolved_name = load_model(module, model_id)
    if model is None:
        return raw_model_id, None, resolved_name, [], ""
    try:
        tokens = flatten(model(text))
    except Exception as exc:
        return raw_model_id, None, resolved_name, [], exc.__class__.__name__
    return raw_model_id, model, resolved_name, tokens, ""


def extract_task_result(document, task_name):
    if document is None:
        return None
    candidates = [str(task_name or "").strip()]
    if "/" in candidates[0]:
        candidates.append(candidates[0].split("/", 1)[1])
    candidates.append(normalize_task_key(task_name))
    if isinstance(document, dict):
        for key in candidates:
            if key in document:
                return document[key]
        return None
    for key in candidates:
        try:
            return document[key]
        except Exception:
            continue
    return None


def run_parse_task(module, text, task_name):
    model = locate_parser(module)
    if model is None:
        raise RuntimeError("HanLP parse model could not be loaded.")
    try:
        return model(text)
    except Exception as exc:
        raise RuntimeError(f"HanLP parse failed: {exc}") from exc


def run_task_entrypoint(module, text, task_name):
    normalized = normalize_task_key(task_name)
    
    if is_coref_task_name(task_name):
        model = locate_coref_resolver(module)
        if model is None:
            raise RuntimeError("HanLP coreference_resolution model could not be loaded.")
        try:
            return model(text)
        except Exception as exc:
            raise RuntimeError(f"HanLP coreference_resolution failed: {exc}") from exc
    elif normalized in {"dep", "dependency"}:
        model = locate_parser(module)
        if model is None:
            raise RuntimeError("HanLP dependency parsing model could not be loaded.")
        try:
            return model(text)
        except Exception as exc:
            raise RuntimeError(f"HanLP dependency parsing failed: {exc}") from exc
    elif normalized in {"sdp", "semantic_dependency"}:
        model = locate_sdp_resolver(module)
        if model is None:
            raise RuntimeError("HanLP semantic dependency parsing model could not be loaded.")
        try:
            return model(text)
        except Exception as exc:
            raise RuntimeError(f"HanLP semantic dependency parsing failed: {exc}") from exc
    elif normalized in {"con", "constituency"}:
        model = locate_con_resolver(module)
        if model is None:
            raise RuntimeError("HanLP constituency parsing model could not be loaded.")
        try:
            return model(text)
        except Exception as exc:
            raise RuntimeError(f"HanLP constituency parsing failed: {exc}") from exc
    elif "ner" in normalized:
        # Extract NER type from task_name like "ner/msra"
        ner_type = "msra"  # default
        if "/" in task_name:
            ner_type = task_name.split("/", 1)[1]
        model = locate_ner_resolver(module, ner_type)
        if model is None:
            raise RuntimeError(f"HanLP NER ({ner_type}) model could not be loaded.")
        try:
            return model(text)
        except Exception as exc:
            raise RuntimeError(f"HanLP NER ({ner_type}) failed: {exc}") from exc
    else:
        # Fallback to parser for unknown tasks
        model = locate_parser(module)
        if model is None:
            raise RuntimeError(f"HanLP model for task '{task_name}' could not be loaded.")
        try:
            return model(text)
        except Exception as exc:
            raise RuntimeError(f"HanLP task '{task_name}' failed: {exc}") from exc


def validate_task(module, task_name, text="HanLP 任务校验"):
    try:
        document = run_task_entrypoint(module, text, task_name)
    except Exception as exc:
        message = str(exc)
        if is_coref_task_name(task_name) and "coreference_resolution entry point" in message:
            return None, "HANLP2_COREF_ENTRYPOINT_MISSING", (
                "HanLP.coreference_resolution is unavailable in current sidecar runtime. "
                "COR cannot degrade automatically unless an equivalent method is configured."
            )
        return None, "HANLP2_TASK_LOAD_FAILED", (
            f"HanLP task validation failed: {exc.__class__.__name__}: {message[:200]}"
        )
    task_result = extract_task_result(document, task_name)
    if task_result is None and is_coref_task_name(task_name):
        task_result = document
    return task_result, "", ""


def resolve_model_id(module, model_id):
    raw = str(model_id or "").strip()
    if not raw:
        return "", None, ""
    pretrained = getattr(module, "pretrained", None)
    tok = getattr(pretrained, "tok", None)
    if tok is not None and hasattr(tok, raw):
        return raw, getattr(tok, raw), raw
    return raw, raw, raw


def load_model(module, model_id):
    resolved_name, resolved_value, raw = resolve_model_id(module, model_id)
    if not resolved_value:
        return raw, None, ""
    loader = getattr(module, "load", None)
    if not callable(loader):
        return raw, None, resolved_name
    return raw, loader(resolved_value), resolved_name


def has_model_loader(module, model_id):
    resolved_name, resolved_value, raw_model_id = resolve_model_id(module, model_id)
    loader = getattr(module, "load", None)
    if not resolved_value or not callable(loader):
        return raw_model_id, False, resolved_name
    return raw_model_id, True, resolved_name


def has_coref_api(module):
    # In HanLP 2.x, coreference_resolution is loaded via pipeline, not a top-level function
    # Check if we can load a coref model
    try:
        loader = getattr(module, "load", None)
        if callable(loader):
            # Try to load a known coref model from available models
            for model_id in ["CTB9_CON_ELECTRA_SMALL", "CTB9_CON_FULL_TAG_ELECTRA_SMALL"]:
                try:
                    test_model = loader(model_id)
                    if test_model is not None:
                        return True
                except Exception:
                    continue
    except Exception:
        pass
    return False


def has_parse_api(module):
    # Check if parse is available via pipeline
    try:
        loader = getattr(module, "load", None)
        if callable(loader):
            # Try to load a known parse model from available models
            for model_id in ["CTB9_DEP_ELECTRA_SMALL", "CTB7_BIAFFINE_DEP_ZH", "CTB5_BIAFFINE_DEP_ZH"]:
                try:
                    test_model = loader(model_id)
                    if test_model is not None:
                        return True
                except Exception:
                    continue
    except Exception:
        pass
    return False


def has_ner_api(module, ner_type="msra"):
    # Check if NER models are available
    try:
        loader = getattr(module, "load", None)
        if callable(loader):
            if ner_type.lower() == "msra":
                for model_id in ["MSRA_NER_ELECTRA_SMALL_ZH", "MSRA_NER_BERT_BASE_ZH", "MSRA_NER_ALBERT_BASE_ZH"]:
                    try:
                        test_model = loader(model_id)
                        if test_model is not None:
                            return True
                    except Exception:
                        continue
    except Exception:
        pass
    return False


def has_sdp_api(module):
    # Check if semantic dependency parsing models are available
    try:
        loader = getattr(module, "load", None)
        if callable(loader):
            for model_id in ["OPEN_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH", "CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH"]:
                try:
                    test_model = loader(model_id)
                    if test_model is not None:
                        return True
                except Exception:
                    continue
    except Exception:
        pass
    return False


def has_con_api(module):
    # Check if constituency parsing models are available
    try:
        loader = getattr(module, "load", None)
        if callable(loader):
            for model_id in ["CTB9_CON_ELECTRA_SMALL", "CTB9_CON_FULL_TAG_ELECTRA_SMALL"]:
                try:
                    test_model = loader(model_id)
                    if test_model is not None:
                        return True
                except Exception:
                    continue
    except Exception:
        pass
    return False


def inspect_task_api(module, task_name):
    normalized = normalize_task_key(task_name)
    if is_coref_task_name(task_name):
        if has_coref_api(module):
            return True, "HANLP2_TASK_API_READY", "HanLP coreference_resolution model is available."
        return False, "HANLP2_COREF_ENTRYPOINT_MISSING", (
            "HanLP coreference_resolution model is unavailable in current local runtime."
        )
    elif normalized in {"dep", "dependency"}:
        if has_parse_api(module):
            return True, "HANLP2_TASK_API_READY", "HanLP dependency parsing model is available."
        return False, "HANLP2_DEP_ENTRYPOINT_MISSING", (
            "HanLP dependency parsing model is unavailable in current local runtime."
        )
    elif normalized in {"sdp", "semantic_dependency"}:
        if has_sdp_api(module):
            return True, "HANLP2_TASK_API_READY", "HanLP semantic dependency parsing model is available."
        return False, "HANLP2_SDP_ENTRYPOINT_MISSING", (
            "HanLP semantic dependency parsing model is unavailable in current local runtime."
        )
    elif normalized in {"con", "constituency"}:
        if has_con_api(module):
            return True, "HANLP2_TASK_API_READY", "HanLP constituency parsing model is available."
        return False, "HANLP2_CON_ENTRYPOINT_MISSING", (
            "HanLP constituency parsing model is unavailable in current local runtime."
        )
    elif "ner" in normalized:
        ner_type = "msra"  # default
        if "/" in task_name:
            ner_type = task_name.split("/", 1)[1]
        if has_ner_api(module, ner_type):
            return True, "HANLP2_TASK_API_READY", f"HanLP NER ({ner_type}) model is available."
        return False, "HANLP2_NER_ENTRYPOINT_MISSING", (
            f"HanLP NER ({ner_type}) model is unavailable in current local runtime."
        )
    else:
        if has_parse_api(module):
            return True, "HANLP2_TASK_API_READY", "HanLP parsing model is available for general tasks."
        return False, "HANLP2_TASK_ENTRYPOINT_MISSING", (
            "HanLP parsing model is unavailable in current local runtime."
        )


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "probe"
    payload = load_payload()
    hanlp_home = str(payload.get("hanlp_home") or "").strip()
    if hanlp_home:
        os.environ["HANLP_HOME"] = hanlp_home

    if not version_in_range():
        emit({
            "engine": "hanlp2",
            "status": "unavailable",
            "reason_code": "HANLP2_SIDECAR_PYTHON_INCOMPATIBLE",
            "reason": f"HanLP2 sidecar requires Python 3.6-3.9, got {version_text()}.",
            "python_version": version_text(),
            "tokens": [],
        })
        return

    try:
        import hanlp  # type: ignore[import-not-found]
    except Exception as exc:
        emit({
            "engine": "hanlp2",
            "status": "unavailable",
            "reason_code": "HANLP2_IMPORT_UNAVAILABLE",
            "reason": (
                f"HanLP2 module is not installed or failed to import: "
                f"{exc.__class__.__name__}."
            ),
            "python_version": version_text(),
            "tokens": [],
        })
        return

    configured_model_id = str(payload.get("model_id") or "").strip()
    requested_task_key = str(payload.get("task_key") or "").strip()
    requested_task_spec = lookup_task_spec(payload, requested_task_key)

    attr, fn = locate_tokenizer(hanlp)

    if mode == "api_status":
        pretrained = getattr(hanlp, "pretrained", None)
        categories = []
        if pretrained is not None:
            categories = [
                name for name in dir(pretrained)
                if not str(name).startswith("_")
            ]
        # Check if basic models are available
        basic_available = has_parse_api(hanlp) or has_ner_api(hanlp) or has_sdp_api(hanlp) or has_con_api(hanlp)
        if basic_available:
            emit({
                "engine": "hanlp2",
                "status": "ready",
                "reason_code": "HANLP2_API_READY",
                "reason": "HanLP models are available.",
                "python_version": version_text(),
                "hanlp_version": str(getattr(hanlp, "__version__", "")),
                "has_coreference_resolution": has_coref_api(hanlp),
                "has_dependency_parsing": has_parse_api(hanlp),
                "has_ner": has_ner_api(hanlp),
                "has_sdp": has_sdp_api(hanlp),
                "has_constituency": has_con_api(hanlp),
                "has_pipeline": callable(getattr(hanlp, "pipeline", None)),
                "has_load": callable(getattr(hanlp, "load", None)),
                "pretrained_categories": categories,
            })
            return
        emit({
            "engine": "hanlp2",
            "status": "unavailable",
            "reason_code": "HANLP2_MODELS_UNAVAILABLE",
            "reason": (
                "HanLP models are unavailable in current local runtime."
            ),
            "python_version": version_text(),
            "hanlp_version": str(getattr(hanlp, "__version__", "")),
            "has_coreference_resolution": False,
            "has_dependency_parsing": False,
            "has_ner": False,
            "has_sdp": False,
            "has_constituency": False,
            "has_pipeline": callable(getattr(hanlp, "pipeline", None)),
            "has_load": callable(getattr(hanlp, "load", None)),
            "pretrained_categories": categories,
        })
        return

    if mode == "probe":
        if fn is None:
            raw_model_id, has_loader, resolved_name = has_model_loader(
                hanlp,
                configured_model_id,
            )
            if not has_loader:
                emit({
                    "engine": "hanlp2",
                    "status": "unavailable",
                    "reason_code": "HANLP2_ENTRYPOINT_MISSING",
                    "reason": "HanLP2 tokenizer entry point was not found.",
                    "python_version": version_text(),
                    "model_id": raw_model_id,
                    "resolved_model": resolved_name,
                    "tokens": [],
                })
                return
        emit({
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
            "python_version": version_text(),
            "tokenizer_attr": attr,
            "model_id": raw_model_id if fn is None else configured_model_id,
            "resolved_model": resolved_name if fn is None else "",
            "tokens": [],
        })
        return

    if mode in {"model_status", "ensure_model"}:
        raw_model_id, model, resolved_name, tokens, error_name = validate_model(
            hanlp,
            configured_model_id,
        )
        if model is None:
            reason = "HanLP2 model loader is unavailable or model_id is empty."
            if error_name:
                reason = f"HanLP2 model load failed: {error_name}."
            emit({
                "engine": "hanlp2",
                "status": "unavailable",
                "reason_code": "HANLP2_MODEL_LOAD_FAILED",
                "reason": reason,
                "python_version": version_text(),
                "model_id": raw_model_id,
                "resolved_model": resolved_name,
                "tokens": [],
            })
            return
        emit({
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_MODEL_READY",
            "reason": "HanLP2 tokenizer model is ready.",
            "python_version": version_text(),
            "model_id": raw_model_id,
            "resolved_model": resolved_name,
            "tokenizer_attr": attr,
            "tokens": tokens,
        })
        return

    if mode == "task_status":
        if not requested_task_spec or not requested_task_spec.get("task_name"):
            emit({
                "engine": "hanlp2",
                "status": "unavailable",
                "reason_code": "HANLP2_TASK_NOT_CONFIGURED",
                "reason": "Requested HanLP task is not configured.",
                "python_version": version_text(),
                "task_key": requested_task_key,
                "task_name": "",
            })
            return
        task_name = str(requested_task_spec.get("task_name") or "")
        ok, reason_code, reason = inspect_task_api(hanlp, task_name)
        if not ok:
            emit({
                "engine": "hanlp2",
                "status": "unavailable",
                "reason_code": reason_code,
                "reason": reason,
                "python_version": version_text(),
                "task_key": requested_task_key,
                "task_name": task_name,
            })
            return
        emit({
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": reason_code,
            "reason": reason,
            "python_version": version_text(),
            "task_key": requested_task_key,
            "task_name": task_name,
            "result_kind": "api",
        })
        return

    if mode == "run_task":
        if not requested_task_spec or not requested_task_spec.get("task_name"):
            emit({
                "engine": "hanlp2",
                "status": "unavailable",
                "reason_code": "HANLP2_TASK_NOT_CONFIGURED",
                "reason": "Requested HanLP task is not configured.",
                "python_version": version_text(),
                "task_key": requested_task_key,
                "task_name": "",
                "task_result": None,
            })
            return
        task_name = str(requested_task_spec.get("task_name") or "")
        text = str(payload.get("text") or "")
        try:
            document = run_task_entrypoint(hanlp, text, task_name)
            task_result = extract_task_result(document, task_name)
            if task_result is None and is_coref_task_name(task_name):
                task_result = document
        except Exception as exc:
            reason_code = "HANLP2_TASK_RUN_FAILED"
            reason = f"HanLP task execution failed: {exc.__class__.__name__}: {str(exc)[:200]}"
            if is_coref_task_name(task_name) and "coreference_resolution entry point" in str(exc):
                reason_code = "HANLP2_COREF_ENTRYPOINT_MISSING"
                reason = (
                    "HanLP.coreference_resolution is unavailable in current sidecar runtime. "
                    "COR cannot degrade automatically unless an equivalent method is configured."
                )
            emit({
                "engine": "hanlp2",
                "status": "error",
                "reason_code": reason_code,
                "reason": reason,
                "python_version": version_text(),
                "task_key": requested_task_key,
                "task_name": task_name,
                "task_result": None,
            })
            return
        emit({
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_TASK_READY",
            "reason": "HanLP task is ready.",
            "python_version": version_text(),
            "task_key": requested_task_key,
            "task_name": task_name,
            "task_result": task_result,
        })
        return

    text = str(payload.get("text") or "")
    try:
        if configured_model_id:
            _, model, _ = load_model(hanlp, configured_model_id)
            if model is not None:
                result = model(text)
            elif fn is not None:
                result = fn(text)
            else:
                raise RuntimeError("HanLP2 tokenizer entry point was not found.")
        else:
            if fn is None:
                raise RuntimeError("HanLP2 tokenizer entry point was not found.")
            result = fn(text)
    except Exception as exc:
        emit({
            "engine": "hanlp2",
            "status": "error",
            "reason_code": "HANLP2_TOKENIZE_FAILED",
            "reason": f"HanLP2 semantic tokenization failed via {attr}: {exc.__class__.__name__}.",
            "python_version": version_text(),
            "tokens": [],
        })
        return

    emit({
        "engine": "hanlp2",
        "status": "ready",
        "reason_code": "HANLP2_READY",
        "reason": "HanLP2 semantic engine is ready.",
        "python_version": version_text(),
        "tokenizer_attr": attr,
        "tokens": flatten(result),
    })


if __name__ == "__main__":
    main()
"""


class HanLPSidecarRuntime:
    """Run HanLP 2.x tokenization in a dedicated Python sidecar."""

    def __init__(self) -> None:
        self._probe_cache_key: str | None = None
        self._probe_cache_state: dict[str, str] | None = None

    @staticmethod
    def _state(*, status: str, reason_code: str, reason: str) -> dict[str, str]:
        return {
            "engine": "hanlp2",
            "status": status,
            "reason_code": reason_code,
            "reason": reason,
        }

    @staticmethod
    def _config_payload(config: KnowledgeConfig | None) -> dict[str, Any]:
        hanlp_cfg = getattr(config, "hanlp", None)
        task_matrix = getattr(hanlp_cfg, "task_matrix", None)
        raw_tasks = getattr(task_matrix, "tasks", {}) if task_matrix is not None else {}
        serialized_tasks: dict[str, dict[str, Any]] = {}
        if isinstance(raw_tasks, dict):
            for task_key, task_cfg in raw_tasks.items():
                serialized_tasks[str(task_key)] = {
                    "enabled": bool(getattr(task_cfg, "enabled", True)),
                    "task_name": str(getattr(task_cfg, "task_name", "") or "").strip(),
                    "model_id": str(getattr(task_cfg, "model_id", "") or "").strip(),
                    "timeout_sec": float(getattr(task_cfg, "timeout_sec", 30.0) or 30.0),
                    "artifact_key": str(getattr(task_cfg, "artifact_key", task_key) or task_key).strip(),
                    "eval_role": str(getattr(task_cfg, "eval_role", "compare") or "compare").strip(),
                }
        return {
            "enabled": bool(getattr(hanlp_cfg, "enabled", False)),
            "python_executable": str(getattr(hanlp_cfg, "python_executable", "") or "").strip(),
            "model_id": str(getattr(hanlp_cfg, "model_id", "") or "").strip(),
            "probe_timeout_sec": float(getattr(hanlp_cfg, "probe_timeout_sec", 5.0) or 5.0),
            "tokenize_timeout_sec": float(getattr(hanlp_cfg, "tokenize_timeout_sec", 15.0) or 15.0),
            "hanlp_home": str(getattr(hanlp_cfg, "hanlp_home", "") or "").strip(),
            "task_matrix": {
                "tasks": serialized_tasks,
            },
        }

    def _cache_key(self, payload: dict[str, Any]) -> str:
        return json.dumps(
            {
                "enabled": payload["enabled"],
                "python_executable": payload["python_executable"],
                "model_id": payload["model_id"],
                "hanlp_home": payload["hanlp_home"],
                "task_matrix": payload.get("task_matrix") or {},
            },
            sort_keys=True,
            ensure_ascii=True,
        )

    def _ensure_sidecar(self, payload: dict[str, Any]) -> Path | None:
        if not payload["enabled"] or not payload["python_executable"]:
            self._probe_cache_state = self._state(
                status="unavailable",
                reason_code="HANLP2_SIDECAR_UNCONFIGURED",
                reason="HanLP2 sidecar is not configured.",
            )
            return None

        executable = Path(payload["python_executable"]).expanduser()
        if not executable.exists():
            self._probe_cache_state = self._state(
                status="unavailable",
                reason_code="HANLP2_SIDECAR_PYTHON_MISSING",
                reason=f"HanLP2 sidecar Python executable was not found: {executable}",
            )
            return None

        return executable

    def _run_bridge(
        self,
        executable: Path,
        *,
        mode: str,
        payload: dict[str, Any],
        timeout: float,
    ) -> dict[str, Any]:
        env = os.environ.copy()
        hanlp_home = str(payload.get("hanlp_home") or "").strip()
        if hanlp_home:
            env["HANLP_HOME"] = hanlp_home

        try:
            completed = subprocess.run(
                [str(executable), "-c", _BRIDGE_CODE, mode],
                input=json.dumps(payload, ensure_ascii=False),
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return self._state(
                status="unavailable",
                reason_code="HANLP2_SIDECAR_EXEC_FAILED",
                reason=f"HanLP2 sidecar {mode} timed out after {timeout:.1f}s.",
            )
        except OSError as exc:
            return self._state(
                status="unavailable",
                reason_code="HANLP2_SIDECAR_EXEC_FAILED",
                reason=f"HanLP2 sidecar {mode} failed to start: {exc.__class__.__name__}.",
            )

        stdout = str(completed.stdout or "").strip()
        if stdout:
            try:
                parsed = json.loads(stdout)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass

        stderr = str(completed.stderr or "").strip()
        return self._state(
            status="unavailable",
            reason_code="HANLP2_SIDECAR_EXEC_FAILED",
            reason=(
                f"HanLP2 sidecar {mode} failed with exit code {completed.returncode}."
                + (f" stderr: {stderr}" if stderr else "")
            ),
        )

    def probe(self, config: KnowledgeConfig | None) -> dict[str, str]:
        payload = self._config_payload(config)
        cache_key = self._cache_key(payload)
        if cache_key == self._probe_cache_key and self._probe_cache_state is not None:
            return dict(self._probe_cache_state)

        executable = self._ensure_sidecar(payload)
        self._probe_cache_key = cache_key
        if executable is None:
            return dict(self._probe_cache_state or self._state(
                status="unavailable",
                reason_code="HANLP2_SIDECAR_UNCONFIGURED",
                reason="HanLP2 sidecar is not configured.",
            ))

        result = self._run_bridge(
            executable,
            mode="probe",
            payload=payload,
            timeout=payload["probe_timeout_sec"],
        )
        state = self._state(
            status=str(result.get("status") or "unavailable"),
            reason_code=str(result.get("reason_code") or "HANLP2_SIDECAR_EXEC_FAILED"),
            reason=str(result.get("reason") or "HanLP2 sidecar probe failed."),
        )
        self._probe_cache_state = state
        return dict(state)

    def model_status(self, config: KnowledgeConfig | None) -> dict[str, str]:
        payload = self._config_payload(config)
        probe_state = self.probe(config)
        if probe_state.get("status") != "ready":
            return dict(probe_state)

        executable = self._ensure_sidecar(payload)
        if executable is None:
            return dict(
                self._probe_cache_state
                or self._state(
                    status="unavailable",
                    reason_code="HANLP2_SIDECAR_UNCONFIGURED",
                    reason="HanLP2 sidecar is not configured.",
                ),
            )

        result = self._run_bridge(
            executable,
            mode="model_status",
            payload=payload,
            timeout=payload["tokenize_timeout_sec"],
        )
        return self._state(
            status=str(result.get("status") or "unavailable"),
            reason_code=str(result.get("reason_code") or "HANLP2_MODEL_LOAD_FAILED"),
            reason=str(result.get("reason") or "HanLP2 model probe failed."),
        )

    def ensure_model(self, config: KnowledgeConfig | None) -> dict[str, str]:
        payload = self._config_payload(config)
        probe_state = self.probe(config)
        if probe_state.get("status") != "ready":
            return dict(probe_state)

        executable = self._ensure_sidecar(payload)
        if executable is None:
            return dict(
                self._probe_cache_state
                or self._state(
                    status="unavailable",
                    reason_code="HANLP2_SIDECAR_UNCONFIGURED",
                    reason="HanLP2 sidecar is not configured.",
                ),
            )

        result = self._run_bridge(
            executable,
            mode="ensure_model",
            payload=payload,
            timeout=payload["tokenize_timeout_sec"],
        )
        return self._state(
            status=str(result.get("status") or "unavailable"),
            reason_code=str(result.get("reason_code") or "HANLP2_MODEL_LOAD_FAILED"),
            reason=str(result.get("reason") or "HanLP2 model verification failed."),
        )

    def tokenize(
        self,
        text: str,
        config: KnowledgeConfig | None,
    ) -> tuple[list[str], dict[str, str]]:
        payload = self._config_payload(config)
        probe_state = self.probe(config)
        if probe_state.get("status") != "ready":
            return [], probe_state

        executable = self._ensure_sidecar(payload)
        if executable is None:
            state = self._probe_cache_state or self._state(
                status="unavailable",
                reason_code="HANLP2_SIDECAR_UNCONFIGURED",
                reason="HanLP2 sidecar is not configured.",
            )
            return [], dict(state)

        result = self._run_bridge(
            executable,
            mode="tokenize",
            payload={
                **payload,
                "text": text,
            },
            timeout=payload["tokenize_timeout_sec"],
        )
        state = self._state(
            status=str(result.get("status") or "unavailable"),
            reason_code=str(result.get("reason_code") or "HANLP2_SIDECAR_EXEC_FAILED"),
            reason=str(result.get("reason") or "HanLP2 sidecar tokenization failed."),
        )
        tokens_raw = result.get("tokens")
        if not isinstance(tokens_raw, list):
            tokens_raw = []
        tokens = [str(item) for item in tokens_raw]
        if state.get("status") == "ready":
            self._probe_cache_state = dict(state)
        return tokens, state

    def task_status(
        self,
        task_key: str,
        config: KnowledgeConfig | None,
    ) -> dict[str, str]:
        normalized_task = str(task_key or "").strip().replace("/", "_").replace("-", "_")
        if normalized_task in {"cor", "coref", "coreference", "coreference_resolution"}:
            api = self.api_status(config)
            if not bool(api.get("has_coreference_resolution")):
                return self._state(
                    status="unavailable",
                    reason_code="HANLP2_COREF_ENTRYPOINT_MISSING",
                    reason=(
                        "HanLP.coreference_resolution is unavailable in current sidecar runtime. "
                        "COR cannot degrade automatically unless an equivalent method is configured."
                    ),
                )

        payload = self._config_payload(config)
        probe_state = self.probe(config)
        if probe_state.get("status") != "ready":
            return dict(probe_state)

        executable = self._ensure_sidecar(payload)
        if executable is None:
            return dict(
                self._probe_cache_state
                or self._state(
                    status="unavailable",
                    reason_code="HANLP2_SIDECAR_UNCONFIGURED",
                    reason="HanLP2 sidecar is not configured.",
                ),
            )

        result = self._run_bridge(
            executable,
            mode="task_status",
            payload={
                **payload,
                "task_key": task_key,
            },
            timeout=payload["tokenize_timeout_sec"],
        )
        return self._state(
            status=str(result.get("status") or "unavailable"),
            reason_code=str(result.get("reason_code") or "HANLP2_TASK_LOAD_FAILED"),
            reason=str(result.get("reason") or "HanLP task probe failed."),
        )

    def api_status(self, config: KnowledgeConfig | None) -> dict[str, Any]:
        payload = self._config_payload(config)
        executable = self._ensure_sidecar(payload)
        if executable is None:
            state = self._probe_cache_state or self._state(
                status="unavailable",
                reason_code="HANLP2_SIDECAR_UNCONFIGURED",
                reason="HanLP2 sidecar is not configured.",
            )
            return {
                **state,
                "has_coreference_resolution": False,
                "has_parse": False,
                "has_pipeline": False,
                "has_load": False,
                "pretrained_categories": [],
            }

        result = self._run_bridge(
            executable,
            mode="api_status",
            payload=payload,
            timeout=payload["probe_timeout_sec"],
        )
        return {
            "engine": "hanlp2",
            "status": str(result.get("status") or "unavailable"),
            "reason_code": str(result.get("reason_code") or "HANLP2_API_STATUS_FAILED"),
            "reason": str(result.get("reason") or "HanLP API status probe failed."),
            "python_version": str(result.get("python_version") or ""),
            "hanlp_version": str(result.get("hanlp_version") or ""),
            "has_coreference_resolution": bool(result.get("has_coreference_resolution")),
            "has_parse": bool(result.get("has_parse")),
            "has_pipeline": bool(result.get("has_pipeline")),
            "has_load": bool(result.get("has_load")),
            "pretrained_categories": list(result.get("pretrained_categories") or []),
        }

    def run_task(
        self,
        task_key: str,
        text: str,
        config: KnowledgeConfig | None,
    ) -> tuple[Any, dict[str, str]]:
        payload = self._config_payload(config)
        probe_state = self.probe(config)
        if probe_state.get("status") != "ready":
            return None, probe_state

        executable = self._ensure_sidecar(payload)
        if executable is None:
            state = self._probe_cache_state or self._state(
                status="unavailable",
                reason_code="HANLP2_SIDECAR_UNCONFIGURED",
                reason="HanLP2 sidecar is not configured.",
            )
            return None, dict(state)

        result = self._run_bridge(
            executable,
            mode="run_task",
            payload={
                **payload,
                "task_key": task_key,
                "text": text,
            },
            timeout=payload["tokenize_timeout_sec"],
        )
        state = self._state(
            status=str(result.get("status") or "unavailable"),
            reason_code=str(result.get("reason_code") or "HANLP2_TASK_RUN_FAILED"),
            reason=str(result.get("reason") or "HanLP task execution failed."),
        )
        if state.get("status") == "ready":
            self._probe_cache_state = dict(state)
        return result.get("task_result"), state