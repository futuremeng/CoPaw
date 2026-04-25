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


def locate_tokenizer(module):
    for attr in ("tokenize", "tok"):
        fn = getattr(module, attr, None)
        if callable(fn):
            return attr, fn
    return "", None


def validate_model(module, model_id, text="HanLP 模型校验"):
    raw_model_id, model, resolved_name = load_model(module, model_id)
    if model is None:
        return raw_model_id, None, resolved_name, [], ""
    try:
        tokens = flatten(model(text))
    except Exception as exc:
        return raw_model_id, None, resolved_name, [], exc.__class__.__name__
    return raw_model_id, model, resolved_name, tokens, ""


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

    attr, fn = locate_tokenizer(hanlp)

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
        return {
            "enabled": bool(getattr(hanlp_cfg, "enabled", False)),
            "python_executable": str(getattr(hanlp_cfg, "python_executable", "") or "").strip(),
            "model_id": str(getattr(hanlp_cfg, "model_id", "") or "").strip(),
            "probe_timeout_sec": float(getattr(hanlp_cfg, "probe_timeout_sec", 5.0) or 5.0),
            "tokenize_timeout_sec": float(getattr(hanlp_cfg, "tokenize_timeout_sec", 15.0) or 15.0),
            "hanlp_home": str(getattr(hanlp_cfg, "hanlp_home", "") or "").strip(),
        }

    def _cache_key(self, payload: dict[str, Any]) -> str:
        return json.dumps(
            {
                "enabled": payload["enabled"],
                "python_executable": payload["python_executable"],
                "model_id": payload["model_id"],
                "hanlp_home": payload["hanlp_home"],
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