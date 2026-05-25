# -*- coding: utf-8 -*-
"""Siamese UniNLU runtime wrapper for provider-specific NLP tasks."""

from __future__ import annotations

import json
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

_DEFAULT_MODEL_ID = "iic/nlp_structbert_siamese-uninlu_chinese-base"
_DEFAULT_MODEL_REVISION = "master"


def _default_siamese_python_path() -> str:
    project_root = Path(__file__).resolve().parents[3]
    return str(project_root / ".venv-senta" / "bin" / "python")


def _looks_like_hanlp_venv(path: str) -> bool:
    normalized = str(path or "").strip().replace("\\", "/")
    return normalized.endswith("/.venv-hanlp/bin/python")


def _resolve_siamese_python_executable(config: Any) -> str:
    nlp_cfg = getattr(config, "nlp", config)
    raw = str(getattr(nlp_cfg, "siamese_python_executable", "") or "").strip()
    if not raw or _looks_like_hanlp_venv(raw):
        return _default_siamese_python_path()
    return raw


_SIAMESE_METHODS: dict[str, dict[str, Any]] = {
    "named_entity_recognition": {
        "title": "命名实体识别",
        "description": "识别人名、地名、机构名等实体。",
        "default_schema": {"人物": None, "地点": None, "组织": None},
    },
    "relation_extraction": {
        "title": "关系抽取",
        "description": "识别实体间关系。",
        "default_schema": {"人物": {"所属组织": None, "职位": None}},
    },
    "event_extraction": {
        "title": "事件抽取",
        "description": "识别事件及论元。",
        "default_schema": {"事件": {"时间": None, "地点": None, "参与方": None}},
    },
    "aspect_sentiment_extraction": {
        "title": "方面级情感",
        "description": "抽取方面词并判断情感倾向。",
        "default_schema": {"方面": {"情感": None, "观点": None}},
    },
    "coreference_resolution": {
        "title": "指代消解",
        "description": "抽取可能的指代链线索。",
        "default_schema": {"实体": {"别称": None, "代词": None}},
    },
    "sentiment_classification": {
        "title": "情感分类",
        "description": "文本级情感极性分类。",
        "default_labels": ["正向", "负向", "中性"],
    },
    "text_classification": {
        "title": "文本分类",
        "description": "按给定标签进行文本分类。",
        "default_labels": ["科技", "财经", "体育", "娱乐"],
    },
    "text_matching": {
        "title": "文本匹配",
        "description": "判断两段文本语义是否匹配。",
        "default_labels": ["匹配", "不匹配"],
    },
    "natural_language_inference": {
        "title": "自然语言推断",
        "description": "判断蕴含、矛盾或中立。",
        "default_labels": ["蕴含", "矛盾", "中立"],
    },
    "reading_comprehension_choice": {
        "title": "阅读理解（选择）",
        "description": "多项选择式阅读理解。",
        "default_labels": ["A", "B", "C", "D"],
    },
    "reading_comprehension_extractive": {
        "title": "阅读理解（抽取）",
        "description": "从文本中抽取答案。",
        "default_schema": {"答案": None},
    },
}


class SiameseUniNLURuntime:
    """Lazy-loaded wrapper around ModelScope Siamese UniNLU pipeline."""

    _model = None
    _lock = threading.Lock()

    @classmethod
    def methods_catalog(cls) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for task_key, meta in _SIAMESE_METHODS.items():
            items.append(
                {
                    "provider": "siamese_uninlu",
                    "task_key": task_key,
                    "title": str(meta.get("title") or task_key),
                    "description": str(meta.get("description") or ""),
                    "input_mode": "text",
                    "route_path": f"/api/nlp/siamese/tasks/{task_key}/run",
                }
            )
        return items

    @staticmethod
    def _nlp_config(config: Any) -> Any:
        if hasattr(config, "nlp"):
            return getattr(config, "nlp")
        return config

    @classmethod
    def _is_enabled(cls, config: Any) -> bool:
        nlp_cfg = cls._nlp_config(config)
        enabled = getattr(nlp_cfg, "siamese_sidecar_enabled", None)
        if enabled is None:
            provider = str(getattr(nlp_cfg, "provider", "") or "").strip().lower()
            return provider == "siamese_uninlu"
        return bool(enabled)

    @classmethod
    def _model_id(cls, config: Any) -> str:
        nlp_cfg = cls._nlp_config(config)
        return str(getattr(nlp_cfg, "siamese_model_id", "") or _DEFAULT_MODEL_ID).strip() or _DEFAULT_MODEL_ID

    @classmethod
    def _model_revision(cls, config: Any) -> str:
        nlp_cfg = cls._nlp_config(config)
        return str(getattr(nlp_cfg, "siamese_model_revision", "") or _DEFAULT_MODEL_REVISION).strip() or _DEFAULT_MODEL_REVISION

    @classmethod
    def _load_model(cls, config: Any):
        if cls._model is not None:
            return cls._model
        with cls._lock:
            if cls._model is not None:
                return cls._model
            from modelscope.pipelines import pipeline
            from modelscope.utils.constant import Tasks

            cls._model = pipeline(
                task=Tasks.siamese_uie,
                model=cls._model_id(config),
                model_revision=cls._model_revision(config),
            )
            return cls._model

    @classmethod
    def probe(cls, config: Any) -> dict[str, Any]:
        if not cls._is_enabled(config):
            return {
                "status": "disabled",
                "reason_code": "SIAMESE_SIDE_CAR_DISABLED",
                "reason": "Siamese UniNLU sidecar is disabled.",
                "model_id": cls._model_id(config),
            }
        # If model is already loaded in-process, we are definitely ready.
        if cls._model is not None:
            return {
                "status": "ready",
                "reason_code": "SIAMESE_MODEL_READY",
                "reason": "Siamese UniNLU model is ready.",
                "model_id": cls._model_id(config),
            }

        # Probe dependencies from the dedicated Siamese environment.
        target_python = _resolve_siamese_python_executable(config)
        if not Path(target_python).exists():
            return {
                "status": "unavailable",
                "reason_code": "SIAMESE_PYTHON_NOT_FOUND",
                "reason": f"Siamese python executable not found: {target_python}",
                "model_id": cls._model_id(config),
            }

        try:
            probe_cmd = [
                target_python,
                "-c",
                "import importlib;"
                "importlib.import_module('torch');"
                "importlib.import_module('modelscope.pipelines');"
                "importlib.import_module('modelscope.utils.constant')",
            ]
            probe_res = subprocess.run(
                probe_cmd,
                capture_output=True,
                text=True,
                timeout=20,
                check=False,
            )
        except Exception as exc:
            return {
                "status": "unavailable",
                "reason_code": "SIAMESE_PROBE_EXEC_FAILED",
                "reason": str(exc),
                "model_id": cls._model_id(config),
            }

        if probe_res.returncode != 0:
            stderr_text = (probe_res.stderr or probe_res.stdout or "").strip()
            if "No module named" in stderr_text:
                return {
                    "status": "unavailable",
                    "reason_code": "SIAMESE_DEPENDENCY_MISSING",
                    "reason": f"Missing dependency: {stderr_text}",
                    "model_id": cls._model_id(config),
                }
            return {
                "status": "unavailable",
                "reason_code": "SIAMESE_PROBE_EXEC_FAILED",
                "reason": stderr_text or "Siamese dependency probe failed.",
                "model_id": cls._model_id(config),
            }

        return {
            "status": "ready",
            "reason_code": "SIAMESE_MODEL_READY",
            "reason": "Siamese UniNLU dependencies available in dedicated environment.",
            "model_id": cls._model_id(config),
        }

    @classmethod
    def _coerce_schema(cls, payload: dict[str, Any], task_key: str) -> Any:
        schema = payload.get("schema")
        if isinstance(schema, str):
            raw = schema.strip()
            if raw:
                try:
                    return json.loads(raw)
                except Exception:
                    return raw
        if schema is not None:
            return schema
        meta = _SIAMESE_METHODS.get(task_key) or {}
        if "default_schema" in meta:
            return meta.get("default_schema")
        return None

    @classmethod
    def _coerce_labels(cls, payload: dict[str, Any], task_key: str) -> list[str]:
        labels = payload.get("labels")
        if isinstance(labels, list):
            values = [str(item).strip() for item in labels if str(item).strip()]
            if values:
                return values
        meta = _SIAMESE_METHODS.get(task_key) or {}
        defaults = meta.get("default_labels")
        if isinstance(defaults, list):
            return [str(item).strip() for item in defaults if str(item).strip()]
        return []

    @classmethod
    def _compose_input(cls, payload: dict[str, Any], task_key: str) -> str:
        text = str(payload.get("text") or "").strip()
        text_a = str(payload.get("text_a") or "").strip()
        text_b = str(payload.get("text_b") or "").strip()
        question = str(payload.get("question") or "").strip()
        context = str(payload.get("context") or text or "").strip()
        choices = payload.get("choices")
        labels = cls._coerce_labels(payload, task_key)

        if task_key == "text_matching":
            left = text_a or text
            right = text_b
            return f"{','.join(labels)}|{left}&{right}" if labels else f"{left}&{right}"

        if task_key == "natural_language_inference":
            premise = text_a or context
            hypothesis = text_b or text
            body = f"段落1：{premise}；段落2：{hypothesis}"
            return f"{','.join(labels)}|{body}" if labels else body

        if task_key == "reading_comprehension_choice":
            options = []
            if isinstance(choices, list):
                options = [str(item).strip() for item in choices if str(item).strip()]
            if not options:
                options = labels
            option_text = ",".join(options)
            body = f"问题：{question or '请选择正确选项'}；上下文：{context}"
            return f"{option_text}|{body}" if option_text else body

        if task_key in {"sentiment_classification", "text_classification"}:
            body = text or context
            return f"{','.join(labels)}|{body}" if labels else body

        if task_key == "reading_comprehension_extractive":
            return context or text

        return text or context

    @classmethod
    def run_task(cls, config: Any, task_key: str, payload: dict[str, Any]) -> dict[str, Any]:
        normalized = str(task_key or "").strip().lower()
        if normalized not in _SIAMESE_METHODS:
            return {
                "status": "invalid",
                "reason_code": "SIAMESE_TASK_UNSUPPORTED",
                "reason": f"Unsupported Siamese task: {task_key}",
                "result": None,
                "duration_ms": 0.0,
                "resolved_model": cls._model_id(config),
            }

        started = time.perf_counter()
        probe = cls.probe(config)
        if str(probe.get("status") or "") != "ready":
            return {
                "status": str(probe.get("status") or "unavailable"),
                "reason_code": str(probe.get("reason_code") or "SIAMESE_MODEL_LOAD_FAILED"),
                "reason": str(probe.get("reason") or "Siamese runtime unavailable."),
                "result": None,
                "duration_ms": (time.perf_counter() - started) * 1000.0,
                "resolved_model": cls._model_id(config),
            }

        try:
            request_input = cls._compose_input(payload, normalized)
            schema = cls._coerce_schema(payload, normalized)
            target_python = _resolve_siamese_python_executable(config)
            if not Path(target_python).exists():
                raise RuntimeError(f"Siamese python executable not found: {target_python}")

            marker = "__COPAW_SIAMESE_JSON__"
            runner_code = f"""
import json
import sys

from modelscope.pipelines import pipeline
from modelscope.utils.constant import Tasks

data = json.loads(sys.stdin.read())
resp = {{"ok": False}}

try:
    model = pipeline(
        task=Tasks.siamese_uie,
        model=data["model_id"],
        model_revision=data["model_revision"],
    )
    kwargs = {{"input": data["input"]}}
    schema = data.get("schema")
    if schema is not None:
        kwargs["schema"] = schema
    result = model(**kwargs)
    resp = {{"ok": True, "result": result}}
except Exception as exc:
    resp = {{"ok": False, "error": str(exc)}}

print({marker!r} + json.dumps(resp, ensure_ascii=False, default=str))
"""
            runner_input = json.dumps(
                {
                    "model_id": cls._model_id(config),
                    "model_revision": cls._model_revision(config),
                    "input": request_input,
                    "schema": schema,
                },
                ensure_ascii=False,
            )
            proc = subprocess.run(
                [target_python, "-c", runner_code],
                input=runner_input,
                capture_output=True,
                text=True,
                timeout=300,
                check=False,
            )

            stdout_text = proc.stdout or ""
            stderr_text = proc.stderr or ""
            payload_line = ""
            for line in reversed(stdout_text.splitlines()):
                if line.startswith(marker):
                    payload_line = line[len(marker) :]
                    break

            if not payload_line:
                message = (stderr_text or stdout_text or "Siamese task runner returned no payload.").strip()
                raise RuntimeError(message)

            decoded = json.loads(payload_line)
            if not bool(decoded.get("ok", False)):
                raise RuntimeError(str(decoded.get("error") or "Siamese task execution failed."))

            elapsed_ms = (time.perf_counter() - started) * 1000.0
            return {
                "status": "ready",
                "reason_code": "SIAMESE_TASK_OK",
                "reason": "Siamese task completed.",
                "result": decoded.get("result"),
                "duration_ms": elapsed_ms,
                "resolved_model": cls._model_id(config),
            }
        except Exception as exc:  # pragma: no cover - runtime environment dependent
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            return {
                "status": "unavailable",
                "reason_code": "SIAMESE_TASK_EXECUTION_FAILED",
                "reason": str(exc),
                "result": None,
                "duration_ms": elapsed_ms,
                "resolved_model": cls._model_id(config),
            }


def initialize_siamese_sidecar(config: Any) -> dict[str, Any]:
    """Initialize Siamese sidecar settings and perform a warm probe."""
    nlp_cfg = getattr(config, "nlp", config)

    def _status_payload() -> dict[str, Any]:
        probe = SiameseUniNLURuntime.probe(config)
        status = str(probe.get("status") or "unavailable")
        reason_code = str(probe.get("reason_code") or "SIAMESE_UNAVAILABLE")
        reason = str(probe.get("reason") or "Siamese sidecar is unavailable.")
        model_id = str(probe.get("model_id") or getattr(nlp_cfg, "siamese_model_id", "") or _DEFAULT_MODEL_ID)
        return {
            "sidecar": {
                "status": status,
                "reason_code": reason_code,
                "reason": reason,
                "enabled": bool(getattr(nlp_cfg, "siamese_sidecar_enabled", False)),
                "python_executable": str(getattr(nlp_cfg, "siamese_python_executable", "") or ""),
            },
            "model": {
                "status": "ready" if status == "ready" else status,
                "reason_code": reason_code,
                "reason": reason,
                "model_id": model_id,
            },
        }

    status_before = _status_payload()
    operations: list[dict[str, Any]] = []
    manual_steps: list[str] = []
    changed = False

    target_python = str(getattr(nlp_cfg, "siamese_python_executable", "") or "").strip()
    if not target_python or _looks_like_hanlp_venv(target_python):
        # Keep Siamese isolated from HanLP by pinning to its dedicated .venv-senta path.
        target_python = _default_siamese_python_path()
        setattr(nlp_cfg, "siamese_python_executable", target_python)
        changed = True
        operations.append(
            {
                "name": "set-python-executable",
                "attempted": True,
                "installer": "config",
                "command": target_python,
                "ok": True,
                "output": "Configured Siamese python executable.",
                "returncode": 0,
            }
        )

    if not bool(getattr(nlp_cfg, "siamese_sidecar_enabled", False)):
        setattr(nlp_cfg, "siamese_sidecar_enabled", True)
        changed = True
        operations.append(
            {
                "name": "enable-siamese-sidecar",
                "attempted": True,
                "installer": "config",
                "command": "siamese_sidecar_enabled=true",
                "ok": True,
                "output": "Enabled Siamese sidecar in config.",
                "returncode": 0,
            }
        )

    status_after = _status_payload()
    already_available = status_before.get("sidecar", {}).get("status") == "ready"
    success = status_after.get("sidecar", {}).get("status") == "ready"

    if not success:
        manual_steps.append(
            "Siamese sidecar probe failed. Ensure `modelscope` is installed and network access is available for model download.",
        )

    return {
        "success": bool(success),
        "already_available": bool(already_available and not changed),
        "status_before": status_before,
        "status_after": status_after,
        "operations": operations,
        "manual_steps": manual_steps,
    }
