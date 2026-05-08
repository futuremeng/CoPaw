# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import os
import subprocess
import sys
from collections import deque
from pathlib import Path
from unittest.mock import patch

import copaw.knowledge.hanlp_runtime as hanlp_runtime_module

from copaw.config.config import Config
from copaw.knowledge.hanlp_runtime import HanLPSidecarRuntime


class _FakeStdout:
    def __init__(self, buffer: deque[str]) -> None:
        self._buffer = buffer

    def readline(self) -> str:
        if self._buffer:
            return self._buffer.popleft()
        return ""


class _FakeStdin:
    def __init__(self, buffer: deque[str], mode_payloads: dict[str, dict[str, object]]) -> None:
        self._buffer = buffer
        self._mode_payloads = mode_payloads

    def write(self, text: str) -> int:
        request = json.loads(text.strip() or "{}")
        mode = str(request.get("mode") or "probe")
        payload = self._mode_payloads.get(mode) or self._mode_payloads.get("*") or {
            "engine": "hanlp2",
            "status": "unavailable",
            "reason_code": "HANLP2_WORKER_PROTOCOL_ERROR",
            "reason": f"Unexpected mode: {mode}",
        }
        self._buffer.append(json.dumps(payload, ensure_ascii=False) + "\n")
        return len(text)

    def flush(self) -> None:
        return


class _BrokenStdin:
    def write(self, text: str) -> int:
        _ = text
        raise BrokenPipeError("broken pipe")

    def flush(self) -> None:
        return


class _FakePopen:
    def __init__(self, mode_payloads: dict[str, dict[str, object]], *, pid: int = 43210) -> None:
        self.pid = pid
        self._alive = True
        self._buffer: deque[str] = deque()
        self.stdin = _FakeStdin(self._buffer, mode_payloads)
        self.stdout = _FakeStdout(self._buffer)
        self.stderr = _FakeStdout(deque())

    def poll(self):
        return None if self._alive else 0

    def terminate(self) -> None:
        self._alive = False

    def wait(self, timeout: float | None = None) -> int:
        _ = timeout
        self._alive = False
        return 0

    def kill(self) -> None:
        self._alive = False


class _BrokenPopen:
    def __init__(self) -> None:
        self.pid = 43111
        self._alive = True
        self.stdin = _BrokenStdin()
        self.stdout = _FakeStdout(deque())
        self.stderr = _FakeStdout(deque())

    def poll(self):
        return None if self._alive else 1

    def terminate(self) -> None:
        self._alive = False

    def wait(self, timeout: float | None = None) -> int:
        _ = timeout
        self._alive = False
        return 1

    def kill(self) -> None:
        self._alive = False


def test_probe_reports_unconfigured_sidecar_by_default() -> None:
    runtime = HanLPSidecarRuntime()

    state = runtime.probe(Config().knowledge)

    assert state["status"] == "unavailable"
    assert state["reason_code"] == "HANLP2_SIDECAR_UNCONFIGURED"


def test_probe_reports_missing_python_executable(tmp_path: Path) -> None:
    runtime = HanLPSidecarRuntime()
    config = Config().knowledge
    config.hanlp.enabled = True
    config.hanlp.python_executable = str(tmp_path / "missing-python")

    state = runtime.probe(config)

    assert state["status"] == "unavailable"
    assert state["reason_code"] == "HANLP2_SIDECAR_PYTHON_MISSING"


def test_probe_uses_sidecar_bridge_json() -> None:
    runtime = HanLPSidecarRuntime()
    config = Config().knowledge
    config.hanlp.enabled = True
    config.hanlp.python_executable = "/bin/python3"

    mode_payloads = {
        "probe": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
        },
    }

    with patch("pathlib.Path.exists", return_value=True), patch(
        "subprocess.Popen",
        return_value=_FakePopen(mode_payloads),
    ):
        state = runtime.probe(config)

    assert state["status"] == "ready"
    assert state["reason_code"] == "HANLP2_READY"


def test_bridge_probe_accepts_model_loader_without_top_level_tokenizer(tmp_path: Path) -> None:
    hanlp_pkg = tmp_path / "hanlp"
    hanlp_pkg.mkdir()
    (hanlp_pkg / "__init__.py").write_text(
        """
class _Tok:
    FINE_ELECTRA_SMALL_ZH = \"dummy-model\"


class _Pretrained:
    tok = _Tok()


pretrained = _Pretrained()


def load(name):
    def _tokenizer(text):
        return text.split()

    return _tokenizer
""".strip(),
        encoding="utf-8",
    )

    bridge_code = hanlp_runtime_module._BRIDGE_CODE.replace(
        "return (3, 6) <= current <= (3, 10)",
        "return True",
    )
    payload = {
        "model_id": "FINE_ELECTRA_SMALL_ZH",
        "hanlp_home": str(tmp_path / "hanlp-home"),
    }
    env = {
        **os.environ,
        "PYTHONPATH": str(tmp_path),
    }

    completed = subprocess.run(
        [sys.executable, "-c", bridge_code, "probe"],
        input=json.dumps(payload, ensure_ascii=False),
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )

    assert completed.returncode == 0
    parsed = json.loads(completed.stdout)
    assert parsed["status"] == "ready"
    assert parsed["reason_code"] == "HANLP2_READY"
    assert parsed["resolved_model"] == "FINE_ELECTRA_SMALL_ZH"
    assert parsed["tokens"] == []


def test_tokenize_returns_tokens_from_sidecar() -> None:
    runtime = HanLPSidecarRuntime()
    config = Config().knowledge
    config.hanlp.enabled = True
    config.hanlp.python_executable = "/bin/python3"

    mode_payloads = {
        "probe": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
        },
        "tokenize": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
            "tokens": ["Agent", "关系抽取"],
        },
    }

    with patch("pathlib.Path.exists", return_value=True), patch(
        "subprocess.Popen",
        return_value=_FakePopen(mode_payloads),
    ):
        tokens, state = runtime.tokenize("Agent 关系抽取", config)

    assert tokens == ["Agent", "关系抽取"]
    assert state["status"] == "ready"


def test_model_status_returns_ready_when_sidecar_reports_model_ready() -> None:
    runtime = HanLPSidecarRuntime()
    config = Config().knowledge
    config.hanlp.enabled = True
    config.hanlp.python_executable = "/bin/python3"

    mode_payloads = {
        "probe": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
        },
        "model_status": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_MODEL_READY",
            "reason": "HanLP2 tokenizer model is ready.",
        },
    }

    with patch("pathlib.Path.exists", return_value=True), patch(
        "subprocess.Popen",
        return_value=_FakePopen(mode_payloads),
    ):
        state = runtime.model_status(config)

    assert state["status"] == "ready"
    assert state["reason_code"] == "HANLP2_MODEL_READY"


def test_ensure_model_returns_unavailable_when_sidecar_reports_model_failure() -> None:
    runtime = HanLPSidecarRuntime()
    config = Config().knowledge
    config.hanlp.enabled = True
    config.hanlp.python_executable = "/bin/python3"

    mode_payloads = {
        "probe": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
        },
        "ensure_model": {
            "engine": "hanlp2",
            "status": "unavailable",
            "reason_code": "HANLP2_MODEL_LOAD_FAILED",
            "reason": "HanLP2 model load failed: RuntimeError.",
        },
    }

    with patch("pathlib.Path.exists", return_value=True), patch(
        "subprocess.Popen",
        return_value=_FakePopen(mode_payloads),
    ):
        state = runtime.ensure_model(config)

    assert state["status"] == "unavailable"
    assert state["reason_code"] == "HANLP2_MODEL_LOAD_FAILED"


def test_default_task_matrix_contains_l2_baseline_tasks() -> None:
    config = Config().knowledge

    tasks = config.hanlp.task_matrix.tasks

    assert set(tasks) >= {"cor", "ner_msra", "dep", "sdp", "con"}
    assert tasks["cor"].task_name == "coreference_resolution"
    assert tasks["ner_msra"].task_name == "ner/msra"
    assert tasks["ner_msra"].eval_role == "primary"
    assert tasks["con"].eval_role == "auxiliary"


def test_task_status_returns_ready_when_sidecar_reports_task_ready() -> None:
    runtime = HanLPSidecarRuntime()
    config = Config().knowledge
    config.hanlp.enabled = True
    config.hanlp.python_executable = "/bin/python3"

    mode_payloads = {
        "probe": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
        },
        "task_status": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_TASK_READY",
            "reason": "HanLP task is ready.",
        },
    }

    with patch("pathlib.Path.exists", return_value=True), patch(
        "subprocess.Popen",
        return_value=_FakePopen(mode_payloads),
    ):
        state = runtime.task_status("ner_msra", config)

    assert state["status"] == "ready"
    assert state["reason_code"] == "HANLP2_TASK_READY"


def test_run_task_returns_structured_result_from_sidecar() -> None:
    runtime = HanLPSidecarRuntime()
    config = Config().knowledge
    config.hanlp.enabled = True
    config.hanlp.python_executable = "/bin/python3"

    mode_payloads = {
        "probe": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
        },
        "run_task": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_TASK_READY",
            "reason": "HanLP task is ready.",
            "task_result": [{"span": [0, 5], "label": "组织名"}],
        },
    }

    with patch("pathlib.Path.exists", return_value=True), patch(
        "subprocess.Popen",
        return_value=_FakePopen(mode_payloads),
    ):
        result, state = runtime.run_task("ner_msra", "微软发布新模型", config)

    assert state["status"] == "ready"
    assert result == [{"span": [0, 5], "label": "组织名"}]


def test_run_ner_returns_structured_result_from_sidecar() -> None:
    runtime = HanLPSidecarRuntime()
    config = Config().knowledge
    config.hanlp.enabled = True
    config.hanlp.python_executable = "/bin/python3"

    mode_payloads = {
        "probe": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
        },
        "run_task": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_TASK_READY",
            "reason": "HanLP task is ready.",
            "task_result": [{"text": "微软", "label": "ORG", "span": [0, 2]}],
        },
    }

    with patch("pathlib.Path.exists", return_value=True), patch(
        "subprocess.Popen",
        return_value=_FakePopen(mode_payloads),
    ):
        result, state = runtime.run_ner("微软发布新模型", config)

    assert state["status"] == "ready"
    assert result == [{"text": "微软", "label": "ORG", "span": [0, 2]}]


def test_run_dep_returns_structured_result_from_sidecar() -> None:
    runtime = HanLPSidecarRuntime()
    config = Config().knowledge
    config.hanlp.enabled = True
    config.hanlp.python_executable = "/bin/python3"

    mode_payloads = {
        "probe": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
        },
        "run_task": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_TASK_READY",
            "reason": "HanLP task is ready.",
            "task_result": [
                {"token": "微软", "head": 2, "deprel": "nsubj"},
                {"token": "发布", "head": 0, "deprel": "root"},
            ],
        },
    }

    with patch("pathlib.Path.exists", return_value=True), patch(
        "subprocess.Popen",
        return_value=_FakePopen(mode_payloads),
    ):
        result, state = runtime.run_dep("微软发布新模型", config)

    assert state["status"] == "ready"
    assert result == [
        {"token": "微软", "head": 2, "deprel": "nsubj"},
        {"token": "发布", "head": 0, "deprel": "root"},
    ]


def test_bridge_run_task_uses_parse_entrypoint_for_configured_task(tmp_path: Path) -> None:
    hanlp_pkg = tmp_path / "hanlp"
    hanlp_pkg.mkdir()
    torch_pkg = tmp_path / "torch"
    torch_pkg.mkdir()
    (hanlp_pkg / "__init__.py").write_text(
        """
def parse(text, tasks=None):
    return {"ner/msra": [{"text": text, "label": "ORG"}]}
""".strip(),
        encoding="utf-8",
    )
    (torch_pkg / "__init__.py").write_text("__version__='0.test'", encoding="utf-8")

    bridge_code = hanlp_runtime_module._BRIDGE_CODE.replace(
        "return (3, 6) <= current <= (3, 10)",
        "return True",
    )
    payload = {
        "task_key": "ner_msra",
        "task_matrix": {
            "tasks": {
                "ner_msra": {
                    "enabled": True,
                    "task_name": "ner/msra",
                    "artifact_key": "ner_msra",
                    "eval_role": "primary",
                    "timeout_sec": 30,
                },
            },
        },
        "text": "微软发布新模型",
    }
    env = {
        **os.environ,
        "PYTHONPATH": str(tmp_path),
    }

    completed = subprocess.run(
        [sys.executable, "-c", bridge_code, "run_task"],
        input=json.dumps(payload, ensure_ascii=False),
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )

    assert completed.returncode == 0
    parsed = json.loads(completed.stdout)
    assert parsed["status"] == "ready"
    assert parsed["reason_code"] == "HANLP2_TASK_READY"
    assert parsed["task_result"] == [{"text": "微软发布新模型", "label": "ORG"}]


def test_bridge_run_task_returns_unavailable_for_cor_task(tmp_path: Path) -> None:
    hanlp_pkg = tmp_path / "hanlp"
    hanlp_pkg.mkdir()
    torch_pkg = tmp_path / "torch"
    torch_pkg.mkdir()
    (hanlp_pkg / "__init__.py").write_text("__version__='2.x'", encoding="utf-8")
    (torch_pkg / "__init__.py").write_text("__version__='0.test'", encoding="utf-8")

    bridge_code = hanlp_runtime_module._BRIDGE_CODE.replace(
        "return (3, 6) <= current <= (3, 10)",
        "return True",
    )
    payload = {
        "task_key": "cor",
        "task_matrix": {
            "tasks": {
                "cor": {
                    "enabled": True,
                    "task_name": "coreference_resolution",
                    "artifact_key": "cor",
                    "eval_role": "primary",
                    "timeout_sec": 30,
                },
            },
        },
        "text": "我姐喜欢它",
    }
    env = {
        **os.environ,
        "PYTHONPATH": str(tmp_path),
    }

    completed = subprocess.run(
        [sys.executable, "-c", bridge_code, "run_task"],
        input=json.dumps(payload, ensure_ascii=False),
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )

    assert completed.returncode == 0
    parsed = json.loads(completed.stdout)
    assert parsed["status"] == "error"
    assert parsed["reason_code"] == "HANLP2_COREF_NOT_OPEN_SOURCE"
    assert parsed["task_result"] is None


def test_bridge_run_task_falls_back_to_parse_when_ner_model_fails(tmp_path: Path) -> None:
    hanlp_pkg = tmp_path / "hanlp"
    hanlp_pkg.mkdir()
    torch_pkg = tmp_path / "torch"
    torch_pkg.mkdir()
    (hanlp_pkg / "__init__.py").write_text(
        """
class _BrokenModel:
    def __call__(self, text):
        raise IndexError("too many indices for tensor of dimension 2")


def load(model_id):
    return _BrokenModel()


def parse(text, tasks=None):
    return {"ner/msra": [{"text": "微软", "label": "ORG"}]}
""".strip(),
        encoding="utf-8",
    )
    (torch_pkg / "__init__.py").write_text("__version__='0.test'", encoding="utf-8")

    bridge_code = hanlp_runtime_module._BRIDGE_CODE.replace(
        "return (3, 6) <= current <= (3, 10)",
        "return True",
    )
    payload = {
        "task_key": "ner_msra",
        "task_matrix": {
            "tasks": {
                "ner_msra": {
                    "enabled": True,
                    "task_name": "ner/msra",
                    "artifact_key": "ner_msra",
                    "eval_role": "primary",
                    "timeout_sec": 30,
                },
            },
        },
        "text": "微软发布新模型",
    }
    env = {
        **os.environ,
        "PYTHONPATH": str(tmp_path),
    }

    completed = subprocess.run(
        [sys.executable, "-c", bridge_code, "run_task"],
        input=json.dumps(payload, ensure_ascii=False),
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )

    assert completed.returncode == 0
    parsed = json.loads(completed.stdout)
    assert parsed["status"] == "ready"
    assert parsed["reason_code"] == "HANLP2_TASK_READY"
    assert parsed["task_result"] == [{"text": "微软", "label": "ORG"}]


def test_bridge_run_task_keeps_direct_list_result_from_ner_model(tmp_path: Path) -> None:
    hanlp_pkg = tmp_path / "hanlp"
    hanlp_pkg.mkdir()
    torch_pkg = tmp_path / "torch"
    torch_pkg.mkdir()
    (hanlp_pkg / "__init__.py").write_text(
        """
class _NERModel:
    def __call__(self, text):
        return [{"text": "微软", "label": "ORG", "span": [0, 2]}]


def load(model_id):
    return _NERModel()
""".strip(),
        encoding="utf-8",
    )
    (torch_pkg / "__init__.py").write_text("__version__='0.test'", encoding="utf-8")

    bridge_code = hanlp_runtime_module._BRIDGE_CODE.replace(
        "return (3, 6) <= current <= (3, 10)",
        "return True",
    )
    payload = {
        "task_key": "ner_msra",
        "task_matrix": {
            "tasks": {
                "ner_msra": {
                    "enabled": True,
                    "task_name": "ner/msra",
                    "artifact_key": "ner_msra",
                    "eval_role": "primary",
                    "timeout_sec": 30,
                },
            },
        },
        "text": "微软发布新模型",
    }
    env = {
        **os.environ,
        "PYTHONPATH": str(tmp_path),
    }

    completed = subprocess.run(
        [sys.executable, "-c", bridge_code, "run_task"],
        input=json.dumps(payload, ensure_ascii=False),
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )

    assert completed.returncode == 0
    parsed = json.loads(completed.stdout)
    assert parsed["status"] == "ready"
    assert parsed["reason_code"] == "HANLP2_TASK_READY"
    assert parsed["task_result"] == [{"text": "微软", "label": "ORG", "span": [0, 2]}]


def test_persistent_worker_reuses_same_pid_between_calls() -> None:
    runtime = HanLPSidecarRuntime()
    config = Config().knowledge
    config.hanlp.enabled = True
    config.hanlp.python_executable = "/bin/python3"

    mode_payloads = {
        "probe": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
        },
        "tokenize": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
            "tokens": ["微软", "发布"],
        },
    }

    with patch("pathlib.Path.exists", return_value=True), patch(
        "subprocess.Popen",
        return_value=_FakePopen(mode_payloads),
    ):
        probe_state = runtime.probe(config)
        _, first_state = runtime.tokenize("微软发布", config)
        _, second_state = runtime.tokenize("微软发布", config)

    assert first_state["worker_pid"] == second_state["worker_pid"]
    assert bool(probe_state["cold_start"]) is True
    assert bool(second_state["cold_start"]) is False


def test_persistent_worker_restarts_on_channel_failure() -> None:
    runtime = HanLPSidecarRuntime()
    config = Config().knowledge
    config.hanlp.enabled = True
    config.hanlp.python_executable = "/bin/python3"

    mode_payloads = {
        "probe": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
        },
        "tokenize": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
            "tokens": ["微软", "发布"],
        },
    }

    payload = runtime._config_payload(config)
    cache_key = runtime._cache_key(payload)
    runtime._probe_cache_key = cache_key
    runtime._probe_cache_state = {
        "engine": "hanlp2",
        "status": "ready",
        "reason_code": "HANLP2_READY",
        "reason": "HanLP2 semantic engine is ready.",
    }
    runtime._worker_process = _BrokenPopen()
    runtime._worker_cache_key = cache_key

    with patch("pathlib.Path.exists", return_value=True), patch(
        "subprocess.Popen",
        return_value=_FakePopen(mode_payloads),
    ):
        tokens, state = runtime.tokenize("微软发布", config)

    assert tokens == ["微软", "发布"]
    assert state["status"] == "ready"
    assert bool(state["worker_restarted"]) is True
    assert int(state["worker_pid"]) == 43210


def test_persistent_worker_restarts_when_config_cache_key_changes() -> None:
    runtime = HanLPSidecarRuntime()
    config = Config().knowledge
    config.hanlp.enabled = True
    config.hanlp.python_executable = "/bin/python3"

    mode_payloads = {
        "probe": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
        },
        "tokenize": {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
            "tokens": ["微软", "发布"],
        },
    }

    with patch("pathlib.Path.exists", return_value=True), patch(
        "subprocess.Popen",
        side_effect=[_FakePopen(mode_payloads, pid=50101), _FakePopen(mode_payloads, pid=50202)],
    ):
        probe_state = runtime.probe(config)
        _, first_state = runtime.tokenize("微软发布", config)
        config.hanlp.model_id = "MSRA_NER_BERT_BASE_ZH"
        _, second_state = runtime.tokenize("微软发布", config)

    assert int(probe_state["worker_pid"]) == 50101
    assert int(first_state["worker_pid"]) == 50101
    assert int(second_state["worker_pid"]) == 50202
    assert bool(second_state["cold_start"]) is False
