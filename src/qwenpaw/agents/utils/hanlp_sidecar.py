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

from copaw.knowledge.hanlp_runtime import HanLPSidecarRuntime

from ...config import load_config, save_config
from ...constant import WORKING_DIR

_STATUS_CACHE: dict | None = None
_STATUS_CACHE_TIME = 0.0
_STATUS_CACHE_TTL_SEC = 10.0
_STATUS_CACHE_LOCK = threading.Lock()
_SUPPORTED_HANLP_PYTHON_VERSIONS = ("3.10", "3.9", "3.8", "3.7", "3.6")


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


def _runtime() -> HanLPSidecarRuntime:
    return HanLPSidecarRuntime()


def _task_specs(config) -> dict[str, object]:
    task_matrix = getattr(getattr(config.knowledge, "nlp", None), "task_matrix", None)
    tasks = getattr(task_matrix, "tasks", None)
    if not isinstance(tasks, dict):
        return {}
    return {str(task_key): task_cfg for task_key, task_cfg in tasks.items() if str(task_key).strip()}


def _build_task_status(runtime: HanLPSidecarRuntime, config) -> dict[str, dict]:
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
                    "reason_code": "HANLP2_TASK_DISABLED",
                    "reason": "HanLP task is disabled in the task matrix.",
                }
            )
        else:
            state = runtime.task_status(task_key, config.knowledge)
            task_entry.update(
                {
                    "status": state.get("status") or "unavailable",
                    "reason_code": state.get("reason_code") or "HANLP2_TASK_LOAD_FAILED",
                    "reason": state.get("reason") or "HanLP task is unavailable.",
                }
            )
        task_states[task_key] = task_entry
    return task_states


def _invalidate_cache() -> None:
    global _STATUS_CACHE  # noqa: PLW0603
    global _STATUS_CACHE_TIME  # noqa: PLW0603
    with _STATUS_CACHE_LOCK:
        _STATUS_CACHE = None
        _STATUS_CACHE_TIME = 0.0


def _build_status(config) -> dict:
    runtime = _runtime()
    probe_state = runtime.probe(config.knowledge)
    model_state = runtime.model_status(config.knowledge)
    task_states = _build_task_status(runtime, config)
    python_executable = str(config.knowledge.nlp.python_executable or "").strip()
    managed_python = str(_managed_python_path(_managed_venv()))
    uv_executable = _find_uv_executable()
    return {
        "sidecar": {
            "status": probe_state.get("status") or "unavailable",
            "reason_code": probe_state.get("reason_code") or "HANLP2_SIDECAR_UNCONFIGURED",
            "reason": probe_state.get("reason") or "HanLP2 sidecar is not configured.",
            "enabled": bool(config.knowledge.nlp.enabled),
            "provider": str(config.knowledge.nlp.provider or "hanlp").strip(),
            "python_executable": python_executable,
            "managed": python_executable == managed_python,
            "uv_available": bool(uv_executable),
            "uv_executable": uv_executable,
            "model_home": str(config.knowledge.nlp.model_home or "").strip(),
        },
        "model": {
            "status": model_state.get("status") or "unavailable",
            "reason_code": model_state.get("reason_code") or "HANLP2_MODEL_LOAD_FAILED",
            "reason": model_state.get("reason") or "HanLP2 tokenizer model is unavailable.",
            "model_id": str(config.knowledge.nlp.model_id or "").strip(),
        },
        "tasks": task_states,
    }


def get_hanlp_sidecar_status(*, force_refresh: bool = False) -> dict:
    global _STATUS_CACHE  # noqa: PLW0603
    global _STATUS_CACHE_TIME  # noqa: PLW0603

    now = time.monotonic()
    with _STATUS_CACHE_LOCK:
        if (
            not force_refresh
            and _STATUS_CACHE is not None
            and (now - _STATUS_CACHE_TIME) < _STATUS_CACHE_TTL_SEC
        ):
            return dict(_STATUS_CACHE)

    config = load_config()
    status = _build_status(config)

    with _STATUS_CACHE_LOCK:
        _STATUS_CACHE = status
        _STATUS_CACHE_TIME = now
    return dict(status)


def _persist_hanlp_runtime_config(
    config,
    *,
    python_executable: Path,
    model_home: Path | None = None,
) -> None:
    config.knowledge.nlp.provider = "hanlp"
    config.knowledge.nlp.enabled = True
    config.knowledge.nlp.python_executable = str(python_executable)
    if model_home is not None:
        config.knowledge.nlp.model_home = str(model_home)
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
            model_home=Path(str(config.knowledge.nlp.model_home or "").strip()) if str(config.knowledge.nlp.model_home or "").strip() else None,
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
                "reason_code": "HANLP2_TASK_DISABLED",
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
            "reason_code": task_state.get("reason_code") or "HANLP2_TASK_LOAD_FAILED",
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
            "reason_code": model_state.get("reason_code") or "HANLP2_MODEL_LOAD_FAILED",
            "reason": model_state.get("reason") or "HanLP2 tokenizer model is unavailable.",
            "model_id": str(config.knowledge.nlp.model_id or "").strip(),
        },
        "task_results": task_results,
        "manual_steps": manual_steps,
    }
