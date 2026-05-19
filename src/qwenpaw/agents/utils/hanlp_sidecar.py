# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from copaw.knowledge.hanlp_nlp_runtime import NLPRuntime

from ...config import load_config, save_config
from ...constant import WORKING_DIR

_STATUS_CACHE: dict | None = None
_STATUS_CACHE_TIME = 0.0
_STATUS_CACHE_TTL_SEC = 60.0
_STATUS_SNAPSHOT_CACHE: dict | None = None
_STATUS_SNAPSHOT_CACHE_TIME = 0.0
_STATUS_SNAPSHOT_CACHE_TTL_SEC = 20.0
_HANLP_READY_SNAPSHOT: dict | None = None
_HANLP_READY_SNAPSHOT_TIME = 0.0
_HANLP_READY_SNAPSHOT_TTL_SEC = 300.0
_STATUS_CACHE_LOCK = threading.Lock()
_PRELOAD_STATE_LOCK = threading.Lock()
_PRELOAD_THREAD: threading.Thread | None = None
_PRELOAD_STATE: dict[str, object] = {
    "enabled": False,
    "scope": "critical",
    "status": "idle",
    "reason": "Startup preload is disabled.",
    "started_at": None,
    "finished_at": None,
    "model_result": {},
    "preloaded_models": [],
    "task_results": {},
}
_SUPPORTED_HANLP_PYTHON_VERSIONS = ("3.10", "3.9", "3.8", "3.7", "3.6")
_DEFAULT_TASK_MODEL_IDS = {
    "ner_msra": "MSRA_NER_ELECTRA_SMALL_ZH",
}
_CRITICAL_PRELOAD_TASKS = ("ner_msra",)
_PRELOAD_SAMPLE_TEXTS = {
    "ner_msra": "微软在北京发布Copaw。",
    "dep": "微软发布新模型。",
    "sdp": "他们在上海召开会议。",
    "con": "这个系统运行稳定。",
}


def _managed_root() -> Path:
    return WORKING_DIR / "hanlp_sidecar"


def _managed_home() -> Path:
    return _managed_root() / "home"


def _managed_venv() -> Path:
    return _managed_root() / "venv"


def _managed_python_path(venv_dir: Path) -> Path:
    if os.name == "nt":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def _common_uv_locations() -> list[Path]:
    home = Path.home()
    if os.name == "nt":
        return [
            home / ".local" / "bin" / "uv.exe",
            home / ".cargo" / "bin" / "uv.exe",
        ]
    return [
        home / ".local" / "bin" / "uv",
        home / ".cargo" / "bin" / "uv",
    ]


def _find_uv_executable() -> str:
    from_path = shutil.which("uv")
    if from_path:
        return from_path

    current_python = Path(sys.executable).resolve()
    candidate_names = ["uv.exe", "uv"] if os.name == "nt" else ["uv"]
    for candidate_name in candidate_names:
        sibling = current_python.parent / candidate_name
        if sibling.is_file():
            return str(sibling)

    for candidate in _common_uv_locations():
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)

    return ""


def _run_command(command: list[str]) -> dict:
    command_str = " ".join(command)
    try:
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            check=False,
        )
    except OSError as exc:
        return {
            "command": command_str,
            "ok": False,
            "output": str(exc),
            "returncode": None,
        }
    return {
        "command": command_str,
        "ok": result.returncode == 0,
        "output": (result.stdout or "").strip(),
        "returncode": result.returncode,
    }


def _parse_python_version(output: str) -> tuple[int, int] | None:
    match = re.search(r"(\d+)\.(\d+)", output)
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def _python_version_supported(python_executable: str) -> bool:
    result = _run_command(
        [python_executable, "-c", "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')"],
    )
    if not result["ok"]:
        return False
    version = _parse_python_version(result["output"])
    if version is None:
        return False
    return (3, 6) <= version <= (3, 10)


def _python_version(python_executable: str) -> tuple[int, int] | None:
    result = _run_command(
        [python_executable, "-c", "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')"],
    )
    if not result["ok"]:
        return None
    return _parse_python_version(result["output"])


def _is_python_310(python_executable: str) -> bool:
    version = _python_version(python_executable)
    return version == (3, 10)


def _python_candidate_executables() -> list[str]:
    candidates = [sys.executable]
    candidate_names = [f"python{version}" for version in _SUPPORTED_HANLP_PYTHON_VERSIONS]
    candidate_names.extend(["python3", "python"])

    for candidate_name in candidate_names:
        candidate_path = shutil.which(candidate_name)
        if candidate_path:
            candidates.append(candidate_path)

    pyenv_path = shutil.which("pyenv")
    if pyenv_path:
        result = _run_command([pyenv_path, "which", "python"])
        if result["ok"]:
            pyenv_python = result["output"].splitlines()[-1].strip()
            if pyenv_python:
                candidates.append(pyenv_python)

    unique: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        normalized = str(candidate).strip()
        if normalized and normalized not in seen:
            unique.append(normalized)
            seen.add(normalized)
    return unique


def _find_supported_python_executable() -> str:
    for candidate in _python_candidate_executables():
        if _python_version_supported(candidate):
            return candidate
    return ""


def _record_operation(
    operations: list[dict],
    *,
    name: str,
    installer: str | None,
    command: list[str],
) -> dict:
    operation = {
        "name": name,
        "attempted": True,
        "installer": installer,
        **_run_command(command),
    }
    operations.append(operation)
    return operation


def _ensure_uv_available(operations: list[dict]) -> str:
    uv_executable = _find_uv_executable()
    if uv_executable:
        return uv_executable

    python_candidates = _python_candidate_executables()
    for python_executable in python_candidates:
        for command_suffix in (
            ["-m", "pip", "install", "-U", "uv"],
            ["-m", "pip", "install", "--user", "-U", "uv"],
        ):
            _record_operation(
                operations,
                name="install-uv",
                installer="pip",
                command=[python_executable, *command_suffix],
            )
            uv_executable = _find_uv_executable()
            if uv_executable:
                return uv_executable

    if os.name != "nt":
        sh_executable = shutil.which("sh")
        curl_executable = shutil.which("curl")
        if sh_executable and curl_executable:
            _record_operation(
                operations,
                name="install-uv",
                installer="astral",
                command=[sh_executable, "-c", f"{curl_executable} -LsSf https://astral.sh/uv/install.sh | sh"],
            )
            uv_executable = _find_uv_executable()
            if uv_executable:
                return uv_executable

    return ""


def _create_managed_venv(
    *,
    uv_executable: str,
    fallback_python: str,
    venv_dir: Path,
    operations: list[dict],
) -> str:
    if uv_executable:
        _record_operation(
            operations,
            name="install-python",
            installer="uv",
            command=[uv_executable, "python", "install", _SUPPORTED_HANLP_PYTHON_VERSIONS[0]],
        )
        preferred_python_args = [_SUPPORTED_HANLP_PYTHON_VERSIONS[0]]
        if fallback_python:
            preferred_python_args.append(fallback_python)

        for python_arg in preferred_python_args:
            operation = _record_operation(
                operations,
                name="create-venv",
                installer="uv",
                command=[uv_executable, "venv", "--python", python_arg, str(venv_dir)],
            )
            if operation["ok"]:
                return "uv"

    if fallback_python:
        operation = _record_operation(
            operations,
            name="create-venv",
            installer="python",
            command=[fallback_python, "-m", "venv", str(venv_dir)],
        )
        if operation["ok"]:
            return "python"

    return ""


def _install_hanlp_package(
    *,
    uv_executable: str,
    python_path: Path,
    operations: list[dict],
    preserve_qwenpaw_runtime: bool = False,
) -> bool:
    install_attempts: list[tuple[str | None, list[str]]] = []
    if uv_executable:
        install_attempts.append(
            (
                "uv",
                [uv_executable, "pip", "install", "--python", str(python_path), "hanlp[full]"],
            ),
        )
    install_attempts.append(
        (
            "pip",
            [str(python_path), "-m", "pip", "install", "hanlp[full]"],
        ),
    )

    for installer, command in install_attempts:
        operation = _record_operation(
            operations,
            name="install-hanlp",
            installer=installer,
            command=command,
        )
        if operation["ok"]:
            if preserve_qwenpaw_runtime:
                repair_operation = _record_operation(
                    operations,
                    name="repair-qwenpaw-runtime",
                    installer="uv" if uv_executable else "pip",
                    command=(
                        [
                            uv_executable,
                            "pip",
                            "install",
                            "--python",
                            str(python_path),
                            "--no-deps",
                            "typing-extensions>=4.15.0",
                            "protobuf>=6.33.6",
                        ]
                        if uv_executable
                        else [
                            str(python_path),
                            "-m",
                            "pip",
                            "install",
                            "--no-deps",
                            "typing-extensions>=4.15.0",
                            "protobuf>=6.33.6",
                        ]
                    ),
                )
                if not repair_operation["ok"]:
                    return False
            return True
    return False


def _failure_result(
    *,
    config,
    status_before: dict,
    operations: list[dict],
    manual_steps: list[str],
) -> dict:
    return {
        "success": False,
        "already_available": False,
        "status_before": status_before,
        "status_after": _build_status(config),
        "operations": operations,
        "manual_steps": manual_steps,
    }


def _runtime() -> NLPRuntime:
    return NLPRuntime()


def _nlp_config(config):
    knowledge = getattr(config, "knowledge", None)
    if knowledge is None:
        return None
    return getattr(knowledge, "nlp", None) or getattr(knowledge, "hanlp", None)


def _task_specs(config) -> dict[str, object]:
    task_matrix = getattr(_nlp_config(config), "task_matrix", None)
    tasks = getattr(task_matrix, "tasks", None)
    if not isinstance(tasks, dict):
        return {}
    return {str(task_key): task_cfg for task_key, task_cfg in tasks.items() if str(task_key).strip()}


def _normalized_model_home(config) -> str:
    nlp_cfg = _nlp_config(config)
    if nlp_cfg is None:
        return str(Path.home() / ".hanlp")
    model_home = str(getattr(nlp_cfg, "model_home", "") or "").strip()
    if model_home:
        return model_home
    legacy_home = str(getattr(nlp_cfg, "hanlp_home", "") or "").strip()
    if legacy_home:
        return legacy_home
    return str(Path.home() / ".hanlp")


def _preload_settings(config) -> tuple[bool, str]:
    nlp_cfg = _nlp_config(config)
    if nlp_cfg is None:
        return False, "critical"
    enabled = bool(getattr(nlp_cfg, "preload_on_startup", False))
    scope = str(getattr(nlp_cfg, "preload_scope", "critical") or "critical")
    if scope not in {"critical", "all_enabled_tasks"}:
        scope = "critical"
    return enabled, scope


def _effective_task_model_id(config, task_key: str, task_cfg) -> str:
    configured = str(getattr(task_cfg, "model_id", "") or "").strip()
    if configured:
        return configured
    fallback = str(_DEFAULT_TASK_MODEL_IDS.get(task_key, "") or "").strip()
    if fallback:
        return fallback
    nlp_cfg = _nlp_config(config)
    return str(getattr(nlp_cfg, "model_id", "") or "").strip() if nlp_cfg is not None else ""


def _preload_task_keys(config, scope: str) -> list[str]:
    task_specs = _task_specs(config)
    if scope == "critical":
        return [task_key for task_key in _CRITICAL_PRELOAD_TASKS if task_key in task_specs]

    task_keys: list[str] = []
    for task_key, task_cfg in task_specs.items():
        if not bool(getattr(task_cfg, "enabled", True)):
            continue
        normalized = str(task_key or "").strip().replace("/", "_").replace("-", "_")
        if normalized in {"cor", "coref", "coreference", "coreference_resolution"}:
            continue
        task_keys.append(task_key)
    return sorted(task_keys, key=lambda task_key: str(task_key))


def _copy_preload_state() -> dict:
    with _PRELOAD_STATE_LOCK:
        return {
            **_PRELOAD_STATE,
            "model_result": dict(_PRELOAD_STATE.get("model_result") or {}),
            "preloaded_models": list(_PRELOAD_STATE.get("preloaded_models") or []),
            "task_results": dict(_PRELOAD_STATE.get("task_results") or {}),
        }


def _set_preload_state(**updates) -> dict:
    with _PRELOAD_STATE_LOCK:
        _PRELOAD_STATE.update(updates)
    return _copy_preload_state()


def get_hanlp_model_cache_path(config=None) -> str:
    if config is None:
        config = load_config()
    return _normalized_model_home(config)


def get_hanlp_preload_status(config=None) -> dict:
    if config is None:
        config = load_config()
    enabled, scope = _preload_settings(config)
    state = _copy_preload_state()
    state["enabled"] = enabled
    state["scope"] = scope
    state["model_cache_path"] = _normalized_model_home(config)
    if not enabled and state.get("status") in {"idle", "disabled"}:
        state["status"] = "disabled"
        state["reason"] = "Startup preload is disabled."
    return state


def _run_hanlp_preload(force: bool = False) -> None:
    global _PRELOAD_THREAD  # noqa: PLW0603
    config = load_config()
    enabled, scope = _preload_settings(config)
    if not enabled and not force:
        _set_preload_state(
            enabled=False,
            scope=scope,
            status="disabled",
            reason="Startup preload is disabled.",
            started_at=None,
            finished_at=None,
            model_result={},
            preloaded_models=[],
            task_results={},
        )
        return

    task_keys = _preload_task_keys(config, scope)
    total_tasks = len(task_keys)
    completed_tasks = 0
    failed_tasks = 0
    model_result: dict[str, str] = {}
    preloaded_models: list[dict[str, str]] = []
    task_results: dict[str, dict[str, str]] = {}
    _set_preload_state(
        enabled=enabled,
        scope=scope,
        status="warming",
        reason="Preloading HanLP models in background.",
        started_at=time.time(),
        finished_at=None,
        current_task_key=None,
        current_task_index=0,
        total_tasks=total_tasks,
        completed_tasks=completed_tasks,
        failed_tasks=failed_tasks,
        model_result=model_result,
        preloaded_models=preloaded_models,
        task_results=task_results,
    )

    runtime = _runtime()
    model_state = runtime.ensure_model(config.knowledge)
    model_ready = model_state.get("status") == "ready"
    nlp_cfg = _nlp_config(config)
    model_result = {
        "status": str(model_state.get("status") or "unavailable"),
        "reason_code": str(model_state.get("reason_code") or "HANLP_MODEL_LOAD_FAILED"),
        "reason": str(model_state.get("reason") or "HanLP model preload failed."),
        "model_id": str(getattr(nlp_cfg, "model_id", "") or "").strip() if nlp_cfg is not None else "",
    }
    default_model_id = str(getattr(nlp_cfg, "model_id", "") or "").strip() if nlp_cfg is not None else ""
    if default_model_id:
        preloaded_models.append(
            {
                "task_key": "tokenize",
                "model_id": default_model_id,
                "status": str(model_state.get("status") or "unavailable"),
            }
        )

    _set_preload_state(
        enabled=enabled,
        scope=scope,
        status="warming",
        reason="Preloading HanLP models in background.",
        started_at=_copy_preload_state().get("started_at"),
        finished_at=None,
        current_task_key=None,
        current_task_index=0,
        total_tasks=total_tasks,
        completed_tasks=completed_tasks,
        failed_tasks=failed_tasks,
        model_result=model_result,
        preloaded_models=preloaded_models,
        task_results=task_results,
    )

    for task_index, task_key in enumerate(task_keys, start=1):
        task_cfg = _task_specs(config).get(task_key)
        task_model_id = _effective_task_model_id(config, task_key, task_cfg)
        sample_text = _PRELOAD_SAMPLE_TEXTS.get(task_key, "微软发布新模型。")
        _set_preload_state(
            enabled=enabled,
            scope=scope,
            status="warming",
            reason="Preloading HanLP models in background.",
            started_at=_copy_preload_state().get("started_at"),
            finished_at=None,
            current_task_key=task_key,
            current_task_index=task_index,
            total_tasks=total_tasks,
            completed_tasks=completed_tasks,
            failed_tasks=failed_tasks,
            model_result=model_result,
            preloaded_models=preloaded_models,
            task_results=task_results,
        )
        _result, task_state = runtime.run_task(task_key, sample_text, config.knowledge)
        task_status = str(task_state.get("status") or "unavailable")
        model_ready = model_ready and task_status == "ready"
        if task_status == "ready":
            completed_tasks += 1
        else:
            failed_tasks += 1
        task_results[task_key] = {
            "status": task_status,
            "reason_code": str(task_state.get("reason_code") or "HANLP_TASK_LOAD_FAILED"),
            "reason": str(task_state.get("reason") or "HanLP task preload failed."),
            "model_id": task_model_id,
        }
        preloaded_models.append(
            {
                "task_key": task_key,
                "model_id": task_model_id,
                "status": task_status,
            }
        )
        _set_preload_state(
            enabled=enabled,
            scope=scope,
            status="warming",
            reason="Preloading HanLP models in background.",
            started_at=_copy_preload_state().get("started_at"),
            finished_at=None,
            current_task_key=task_key,
            current_task_index=task_index,
            total_tasks=total_tasks,
            completed_tasks=completed_tasks,
            failed_tasks=failed_tasks,
            model_result=model_result,
            preloaded_models=preloaded_models,
            task_results=task_results,
        )

    _set_preload_state(
        enabled=enabled,
        scope=scope,
        status="ready" if model_ready else "failed",
        reason="HanLP preload completed." if model_ready else "HanLP preload completed with failures.",
        finished_at=time.time(),
        current_task_key=None,
        current_task_index=total_tasks,
        total_tasks=total_tasks,
        completed_tasks=completed_tasks,
        failed_tasks=failed_tasks,
        model_result={**model_result, "model_id": default_model_id},
        preloaded_models=preloaded_models,
        task_results=task_results,
    )
    with _PRELOAD_STATE_LOCK:
        _PRELOAD_THREAD = None


def kickoff_hanlp_preload(force: bool = False) -> dict:
    global _PRELOAD_THREAD  # noqa: PLW0603
    config = load_config()
    with _PRELOAD_STATE_LOCK:
        if _PRELOAD_THREAD is not None and _PRELOAD_THREAD.is_alive():
            return get_hanlp_preload_status(config)
        _PRELOAD_THREAD = threading.Thread(
            target=_run_hanlp_preload,
            kwargs={"force": force},
            daemon=True,
        )
        _PRELOAD_THREAD.start()
    return get_hanlp_preload_status(config)


def _build_task_status(runtime: NLPRuntime, config) -> dict[str, dict]:
    task_states: dict[str, dict] = {}
    for task_key, task_cfg in _task_specs(config).items():
        enabled = bool(getattr(task_cfg, "enabled", True))
        task_name = str(getattr(task_cfg, "task_name", task_key) or task_key).strip()
        task_entry = {
            "enabled": enabled,
            "task_name": task_name,
            "artifact_key": str(getattr(task_cfg, "artifact_key", task_key) or task_key).strip(),
            "eval_role": str(getattr(task_cfg, "eval_role", "compare") or "compare").strip(),
            "model_id": str(getattr(task_cfg, "model_id", "") or "").strip(),
        }
        if not enabled:
            task_entry.update(
                {
                    "status": "disabled",
                    "reason_code": "HANLP_TASK_DISABLED",
                    "reason": "HanLP task is disabled in the task matrix.",
                }
            )
        else:
            state = runtime.task_status(task_key, config.knowledge)
            task_entry.update(
                {
                    "status": state.get("status") or "unavailable",
                    "reason_code": state.get("reason_code") or "HANLP_TASK_LOAD_FAILED",
                    "reason": state.get("reason") or "HanLP task is unavailable.",
                }
            )
        task_states[task_key] = task_entry
    return task_states


def _build_task_status_snapshot(config, *, sidecar_state: dict, model_state: dict) -> dict[str, dict]:
    """Build a lightweight task matrix snapshot without active runtime probing."""
    task_states: dict[str, dict] = {}
    sidecar_ready = str(sidecar_state.get("status") or "") == "ready"
    model_ready = str(model_state.get("status") or "") == "ready"
    for task_key, task_cfg in _task_specs(config).items():
        enabled = bool(getattr(task_cfg, "enabled", True))
        task_name = str(getattr(task_cfg, "task_name", task_key) or task_key).strip()
        normalized_task = str(task_key or "").strip().replace("/", "_").replace("-", "_")
        task_entry = {
            "enabled": enabled,
            "task_name": task_name,
            "artifact_key": str(getattr(task_cfg, "artifact_key", task_key) or task_key).strip(),
            "eval_role": str(getattr(task_cfg, "eval_role", "compare") or "compare").strip(),
            "model_id": str(getattr(task_cfg, "model_id", "") or "").strip(),
        }
        if not enabled:
            task_entry.update(
                {
                    "status": "disabled",
                    "reason_code": "HANLP_TASK_DISABLED",
                    "reason": "HanLP task is disabled in the task matrix.",
                }
            )
        elif normalized_task in {"cor", "coref", "coreference", "coreference_resolution"}:
            task_entry.update(
                {
                    "status": "unavailable",
                    "reason_code": "HANLP_COREF_NOT_OPEN_SOURCE",
                    "reason": "HanLP coreference_resolution is not open-source and is disabled in CoPaw runtime.",
                }
            )
        elif not sidecar_ready:
            task_entry.update(
                {
                    "status": "unavailable",
                    "reason_code": str(sidecar_state.get("reason_code") or "HANLP_SIDECAR_UNCONFIGURED"),
                    "reason": str(sidecar_state.get("reason") or "HanLP sidecar is not configured."),
                }
            )
        elif not model_ready:
            task_entry.update(
                {
                    "status": "unavailable",
                    "reason_code": str(model_state.get("reason_code") or "HANLP_MODEL_LOAD_FAILED"),
                    "reason": str(model_state.get("reason") or "HanLP tokenizer model is unavailable."),
                }
            )
        else:
            task_entry.update(
                {
                    "status": "ready",
                    "reason_code": "HANLP_TASK_READY_UNVERIFIED",
                    "reason": "HanLP task is configured. Run task demo to verify model availability.",
                }
            )
        task_states[task_key] = task_entry
    return task_states


def _invalidate_cache() -> None:
    global _STATUS_CACHE  # noqa: PLW0603
    global _STATUS_CACHE_TIME  # noqa: PLW0603
    global _STATUS_SNAPSHOT_CACHE  # noqa: PLW0603
    global _STATUS_SNAPSHOT_CACHE_TIME  # noqa: PLW0603
    global _HANLP_READY_SNAPSHOT  # noqa: PLW0603
    global _HANLP_READY_SNAPSHOT_TIME  # noqa: PLW0603
    with _STATUS_CACHE_LOCK:
        _STATUS_CACHE = None
        _STATUS_CACHE_TIME = 0.0
        _STATUS_SNAPSHOT_CACHE = None
        _STATUS_SNAPSHOT_CACHE_TIME = 0.0
        _HANLP_READY_SNAPSHOT = None
        _HANLP_READY_SNAPSHOT_TIME = 0.0


def _build_status(config, *, include_task_status: bool = True) -> dict:
    runtime = _runtime()
    probe_state = runtime.probe(config.knowledge)
    model_state = runtime.model_status(config.knowledge)
    task_states = (
        _build_task_status(runtime, config)
        if include_task_status
        else _build_task_status_snapshot(config, sidecar_state=probe_state, model_state=model_state)
    )
    nlp_cfg = _nlp_config(config)
    python_executable = str(getattr(nlp_cfg, "python_executable", "") or "").strip()
    python_version_tuple = _python_version(python_executable) if python_executable else None
    python_version = (
        f"{python_version_tuple[0]}.{python_version_tuple[1]}"
        if python_version_tuple is not None
        else ""
    )
    managed_python = str(_managed_python_path(_managed_venv()))
    uv_executable = _find_uv_executable()
    return {
        "sidecar": {
            "status": probe_state.get("status") or "unavailable",
            "reason_code": probe_state.get("reason_code") or "HANLP_SIDECAR_UNCONFIGURED",
            "reason": probe_state.get("reason") or "HanLP sidecar is not configured.",
            "enabled": bool(getattr(nlp_cfg, "enabled", False)),
            "provider": str(getattr(nlp_cfg, "provider", "hanlp") or "hanlp").strip(),
            "python_executable": python_executable,
            "python_version": python_version,
            "managed": python_executable == managed_python,
            "uv_available": bool(uv_executable),
            "uv_executable": uv_executable,
            "model_home": str(getattr(nlp_cfg, "model_home", "") or "").strip(),
            "model_cache_path": _normalized_model_home(config),
        },
        "model": {
            "status": model_state.get("status") or "unavailable",
            "reason_code": model_state.get("reason_code") or "HANLP_MODEL_LOAD_FAILED",
            "reason": model_state.get("reason") or "HanLP tokenizer model is unavailable.",
            "model_id": str(getattr(nlp_cfg, "model_id", "") or "").strip(),
        },
        "tasks": task_states,
        "preload": get_hanlp_preload_status(config),
    }


def get_hanlp_sidecar_status(*, force_refresh: bool = False, include_task_status: bool = True) -> dict:
    global _STATUS_CACHE  # noqa: PLW0603
    global _STATUS_CACHE_TIME  # noqa: PLW0603
    global _STATUS_SNAPSHOT_CACHE  # noqa: PLW0603
    global _STATUS_SNAPSHOT_CACHE_TIME  # noqa: PLW0603
    global _HANLP_READY_SNAPSHOT  # noqa: PLW0603
    global _HANLP_READY_SNAPSHOT_TIME  # noqa: PLW0603

    now = time.monotonic()
    with _STATUS_CACHE_LOCK:
        if not force_refresh and include_task_status:
            if _STATUS_CACHE is not None and (now - _STATUS_CACHE_TIME) < _STATUS_CACHE_TTL_SEC:
                return dict(_STATUS_CACHE)

        if not force_refresh and not include_task_status:
            # Fast path: if HanLP was recently confirmed ready, return the
            # in-memory ready snapshot without running runtime probes.
            if (
                _HANLP_READY_SNAPSHOT is not None
                and (now - _HANLP_READY_SNAPSHOT_TIME) < _HANLP_READY_SNAPSHOT_TTL_SEC
            ):
                return dict(_HANLP_READY_SNAPSHOT)

            # Fallback to lightweight snapshot cache.
            if (
                _STATUS_SNAPSHOT_CACHE is not None
                and (now - _STATUS_SNAPSHOT_CACHE_TIME) < _STATUS_SNAPSHOT_CACHE_TTL_SEC
            ):
                return dict(_STATUS_SNAPSHOT_CACHE)

    config = load_config()
    status = _build_status(config, include_task_status=include_task_status)

    sidecar_ready = str((status.get("sidecar") or {}).get("status") or "") == "ready"
    model_ready = str((status.get("model") or {}).get("status") or "") == "ready"

    with _STATUS_CACHE_LOCK:
        # Record cache time after status build; build itself can take seconds.
        built_at = time.monotonic()
        if include_task_status:
            _STATUS_CACHE = status
            _STATUS_CACHE_TIME = built_at
        else:
            _STATUS_SNAPSHOT_CACHE = status
            _STATUS_SNAPSHOT_CACHE_TIME = built_at

        if sidecar_ready and model_ready and not include_task_status:
            _HANLP_READY_SNAPSHOT = status
            _HANLP_READY_SNAPSHOT_TIME = built_at

    return dict(status)


def _persist_hanlp_runtime_config(
    config,
    *,
    python_executable: Path,
    model_home: Path | None = None,
) -> None:
    nlp_cfg = _nlp_config(config)
    if nlp_cfg is None:
        raise RuntimeError("Missing knowledge NLP config")
    nlp_cfg.provider = "hanlp"
    nlp_cfg.enabled = True
    nlp_cfg.python_executable = str(python_executable)
    if model_home is not None:
        if hasattr(nlp_cfg, "model_home"):
            nlp_cfg.model_home = str(model_home)
        elif hasattr(nlp_cfg, "hanlp_home"):
            nlp_cfg.hanlp_home = str(model_home)
    save_config(config)


def auto_install_hanlp_sidecar() -> dict:
    config = load_config()
    status_before = _build_status(config)
    operations: list[dict] = []
    manual_steps: list[str] = []

    if status_before["sidecar"]["status"] == "ready":
        return {
            "success": True,
            "already_available": True,
            "status_before": status_before,
            "status_after": status_before,
            "operations": operations,
            "manual_steps": manual_steps,
        }

    # Strategy:
    # 1) If main runtime is Python 3.10, install hanlp[full] directly in main env.
    # 2) Otherwise, provision sidecar as fallback isolation path.
    main_python = Path(sys.executable).expanduser().resolve()
    if _is_python_310(str(main_python)):
        uv_executable = _ensure_uv_available(operations)
        if not _install_hanlp_package(
            uv_executable=uv_executable,
            python_path=main_python,
            operations=operations,
            preserve_qwenpaw_runtime=True,
        ):
            manual_steps.append(
                "Main Python is 3.10, but hanlp[full] installation failed in the current environment.",
            )
            manual_steps.append(
                "Retry with: python -m pip install 'hanlp[full]' and verify network access.",
            )
            return _failure_result(
                config=config,
                status_before=status_before,
                operations=operations,
                manual_steps=manual_steps,
            )

        _persist_hanlp_runtime_config(
            config,
            python_executable=main_python,
            model_home=Path(_normalized_model_home(config)) if _normalized_model_home(config).strip() else None,
        )
        _invalidate_cache()
        status_after = get_hanlp_sidecar_status(force_refresh=True)
        if status_after["sidecar"]["status"] != "ready":
            manual_steps.append(
                "HanLP was installed in main Python 3.10, but runtime probe still failed. Verify import hanlp/torch in current environment.",
            )
        return {
            "success": status_after["sidecar"]["status"] == "ready",
            "already_available": False,
            "status_before": status_before,
            "status_after": status_after,
            "operations": operations,
            "manual_steps": manual_steps,
        }

    root = _managed_root()
    root.mkdir(parents=True, exist_ok=True)
    home = _managed_home()
    home.mkdir(parents=True, exist_ok=True)
    venv = _managed_venv()
    python_path = _managed_python_path(venv)

    uv_executable = _ensure_uv_available(operations)
    fallback_python = _find_supported_python_executable()
    if not uv_executable and not fallback_python:
        manual_steps.append(
            "Automatic HanLP bootstrap could not find or install uv, and no compatible Python 3.6-3.10 interpreter was found.",
        )
        manual_steps.append(
            "Install uv or provide a Python 3.10 executable, then retry HanLP sidecar setup.",
        )
        return _failure_result(
            config=config,
            status_before=status_before,
            operations=operations,
            manual_steps=manual_steps,
        )

    created_by = _create_managed_venv(
        uv_executable=uv_executable,
        fallback_python=fallback_python,
        venv_dir=venv,
        operations=operations,
    )
    if not created_by or not python_path.is_file():
        manual_steps.append(
            "HanLP sidecar environment creation failed. Ensure network access is available for uv, or install Python 3.10 locally and retry.",
        )
        return _failure_result(
            config=config,
            status_before=status_before,
            operations=operations,
            manual_steps=manual_steps,
        )

    if not _install_hanlp_package(
        uv_executable=uv_executable,
        python_path=python_path,
        operations=operations,
    ):
        manual_steps.append(
            "HanLP full package installation failed in the managed sidecar environment.",
        )
        return _failure_result(
            config=config,
            status_before=status_before,
            operations=operations,
            manual_steps=manual_steps,
        )

    _persist_hanlp_runtime_config(config, python_executable=python_path, model_home=home)
    _invalidate_cache()
    status_after = get_hanlp_sidecar_status(force_refresh=True)
    if status_after["sidecar"]["status"] != "ready":
        manual_steps.append(
            "HanLP was installed, but the sidecar probe still failed. Review the operation log and verify the managed Python can import hanlp and torch.",
        )
    return {
        "success": status_after["sidecar"]["status"] == "ready",
        "already_available": False,
        "status_before": status_before,
        "status_after": status_after,
        "operations": operations,
        "manual_steps": manual_steps,
    }


def ensure_hanlp_model() -> dict:
    config = load_config()
    status_before = _build_status(config)
    runtime = _runtime()
    model_state = runtime.ensure_model(config.knowledge)
    task_results: dict[str, dict] = {}
    all_enabled_tasks_ready = True
    for task_key, task_cfg in _task_specs(config).items():
        if not bool(getattr(task_cfg, "enabled", True)):
            task_results[task_key] = {
                "status": "disabled",
                "reason_code": "HANLP_TASK_DISABLED",
                "reason": "HanLP task is disabled in the task matrix.",
                "task_name": str(getattr(task_cfg, "task_name", task_key) or task_key).strip(),
                "artifact_key": str(getattr(task_cfg, "artifact_key", task_key) or task_key).strip(),
                "eval_role": str(getattr(task_cfg, "eval_role", "compare") or "compare").strip(),
                "model_id": str(getattr(task_cfg, "model_id", "") or "").strip(),
            }
            continue
        task_state = runtime.task_status(task_key, config.knowledge)
        task_ready = task_state.get("status") == "ready"
        all_enabled_tasks_ready = all_enabled_tasks_ready and task_ready
        task_results[task_key] = {
            "status": task_state.get("status") or "unavailable",
            "reason_code": task_state.get("reason_code") or "HANLP_TASK_LOAD_FAILED",
            "reason": task_state.get("reason") or "HanLP task is unavailable.",
            "task_name": str(getattr(task_cfg, "task_name", task_key) or task_key).strip(),
            "artifact_key": str(getattr(task_cfg, "artifact_key", task_key) or task_key).strip(),
            "eval_role": str(getattr(task_cfg, "eval_role", "compare") or "compare").strip(),
            "model_id": str(getattr(task_cfg, "model_id", "") or "").strip(),
        }
    _invalidate_cache()
    status_after = get_hanlp_sidecar_status(force_refresh=True)
    manual_steps: list[str] = []
    if model_state.get("status") != "ready":
        manual_steps.append(
            "Verify network access or pre-populate HANLP_HOME, then retry model download.",
        )
    if not all_enabled_tasks_ready:
        manual_steps.append(
            "Verify the configured HanLP task matrix models are available in HANLP_HOME, then retry task verification.",
        )
    return {
        "success": model_state.get("status") == "ready" and all_enabled_tasks_ready,
        "status_before": status_before,
        "status_after": status_after,
        "model_result": {
            "status": model_state.get("status") or "unavailable",
            "reason_code": model_state.get("reason_code") or "HANLP_MODEL_LOAD_FAILED",
            "reason": model_state.get("reason") or "HanLP tokenizer model is unavailable.",
            "model_id": str(getattr(_nlp_config(config), "model_id", "") or "").strip(),
        },
        "task_results": task_results,
        "manual_steps": manual_steps,
    }
