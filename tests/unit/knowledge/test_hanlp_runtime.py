# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import copaw.knowledge.hanlp_runtime as hanlp_runtime_module

from copaw.config.config import Config
from copaw.knowledge.hanlp_runtime import HanLPSidecarRuntime


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

    completed = subprocess.CompletedProcess(
        args=["/bin/python3"],
        returncode=0,
        stdout=json.dumps({
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
        }),
        stderr="",
    )

    with patch("pathlib.Path.exists", return_value=True), patch(
        "subprocess.run",
        return_value=completed,
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
        "return (3, 6) <= current <= (3, 9)",
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

    def fake_run(*args, **kwargs):
        mode = args[0][-1]
        if mode == "probe":
            return subprocess.CompletedProcess(
                args=args[0],
                returncode=0,
                stdout=json.dumps({
                    "engine": "hanlp2",
                    "status": "ready",
                    "reason_code": "HANLP2_READY",
                    "reason": "HanLP2 semantic engine is ready.",
                }),
                stderr="",
            )
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout=json.dumps({
                "engine": "hanlp2",
                "status": "ready",
                "reason_code": "HANLP2_READY",
                "reason": "HanLP2 semantic engine is ready.",
                "tokens": ["Agent", "关系抽取"],
            }),
            stderr="",
        )

    with patch("pathlib.Path.exists", return_value=True), patch(
        "subprocess.run",
        side_effect=fake_run,
    ):
        tokens, state = runtime.tokenize("Agent 关系抽取", config)

    assert tokens == ["Agent", "关系抽取"]
    assert state["status"] == "ready"


def test_model_status_returns_ready_when_sidecar_reports_model_ready() -> None:
    runtime = HanLPSidecarRuntime()
    config = Config().knowledge
    config.hanlp.enabled = True
    config.hanlp.python_executable = "/bin/python3"

    def fake_run(*args, **kwargs):
        mode = args[0][-1]
        if mode == "probe":
            return subprocess.CompletedProcess(
                args=args[0],
                returncode=0,
                stdout=json.dumps({
                    "engine": "hanlp2",
                    "status": "ready",
                    "reason_code": "HANLP2_READY",
                    "reason": "HanLP2 semantic engine is ready.",
                }),
                stderr="",
            )
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout=json.dumps({
                "engine": "hanlp2",
                "status": "ready",
                "reason_code": "HANLP2_MODEL_READY",
                "reason": "HanLP2 tokenizer model is ready.",
            }),
            stderr="",
        )

    with patch("pathlib.Path.exists", return_value=True), patch(
        "subprocess.run",
        side_effect=fake_run,
    ):
        state = runtime.model_status(config)

    assert state["status"] == "ready"
    assert state["reason_code"] == "HANLP2_MODEL_READY"


def test_ensure_model_returns_unavailable_when_sidecar_reports_model_failure() -> None:
    runtime = HanLPSidecarRuntime()
    config = Config().knowledge
    config.hanlp.enabled = True
    config.hanlp.python_executable = "/bin/python3"

    def fake_run(*args, **kwargs):
        mode = args[0][-1]
        if mode == "probe":
            return subprocess.CompletedProcess(
                args=args[0],
                returncode=0,
                stdout=json.dumps({
                    "engine": "hanlp2",
                    "status": "ready",
                    "reason_code": "HANLP2_READY",
                    "reason": "HanLP2 semantic engine is ready.",
                }),
                stderr="",
            )
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout=json.dumps({
                "engine": "hanlp2",
                "status": "unavailable",
                "reason_code": "HANLP2_MODEL_LOAD_FAILED",
                "reason": "HanLP2 model load failed: RuntimeError.",
            }),
            stderr="",
        )

    with patch("pathlib.Path.exists", return_value=True), patch(
        "subprocess.run",
        side_effect=fake_run,
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

    def fake_run(*args, **kwargs):
        mode = args[0][-1]
        if mode == "probe":
            return subprocess.CompletedProcess(
                args=args[0],
                returncode=0,
                stdout=json.dumps({
                    "engine": "hanlp2",
                    "status": "ready",
                    "reason_code": "HANLP2_READY",
                    "reason": "HanLP2 semantic engine is ready.",
                }),
                stderr="",
            )
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout=json.dumps({
                "engine": "hanlp2",
                "status": "ready",
                "reason_code": "HANLP2_TASK_READY",
                "reason": "HanLP task is ready.",
            }),
            stderr="",
        )

    with patch("pathlib.Path.exists", return_value=True), patch(
        "subprocess.run",
        side_effect=fake_run,
    ):
        state = runtime.task_status("ner_msra", config)

    assert state["status"] == "ready"
    assert state["reason_code"] == "HANLP2_TASK_READY"


def test_run_task_returns_structured_result_from_sidecar() -> None:
    runtime = HanLPSidecarRuntime()
    config = Config().knowledge
    config.hanlp.enabled = True
    config.hanlp.python_executable = "/bin/python3"

    def fake_run(*args, **kwargs):
        mode = args[0][-1]
        if mode == "probe":
            return subprocess.CompletedProcess(
                args=args[0],
                returncode=0,
                stdout=json.dumps({
                    "engine": "hanlp2",
                    "status": "ready",
                    "reason_code": "HANLP2_READY",
                    "reason": "HanLP2 semantic engine is ready.",
                }),
                stderr="",
            )
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout=json.dumps({
                "engine": "hanlp2",
                "status": "ready",
                "reason_code": "HANLP2_TASK_READY",
                "reason": "HanLP task is ready.",
                "task_result": [{"span": [0, 5], "label": "组织名"}],
            }),
            stderr="",
        )

    with patch("pathlib.Path.exists", return_value=True), patch(
        "subprocess.run",
        side_effect=fake_run,
    ):
        result, state = runtime.run_task("ner_msra", "微软发布新模型", config)

    assert state["status"] == "ready"
    assert result == [{"span": [0, 5], "label": "组织名"}]


def test_bridge_run_task_uses_parse_entrypoint_for_configured_task(tmp_path: Path) -> None:
    hanlp_pkg = tmp_path / "hanlp"
    hanlp_pkg.mkdir()
    (hanlp_pkg / "__init__.py").write_text(
        """
def parse(text, tasks=None):
    return {"ner/msra": [{"text": text, "label": "ORG"}]}
""".strip(),
        encoding="utf-8",
    )

    bridge_code = hanlp_runtime_module._BRIDGE_CODE.replace(
        "return (3, 6) <= current <= (3, 9)",
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


def test_bridge_run_task_uses_coreference_entrypoint_for_cor_task(tmp_path: Path) -> None:
    hanlp_pkg = tmp_path / "hanlp"
    hanlp_pkg.mkdir()
    (hanlp_pkg / "__init__.py").write_text(
        """
def parse(text, tasks=None):
    raise RuntimeError("parse should not be used for cor")


def coreference_resolution(text):
    return {
        "tokens": ["我", "姐", "喜欢", "它"],
        "clusters": [
            [["我姐", 0, 2], ["她", 2, 3]],
            [["她的猫", 2, 4], ["它", 3, 4]],
        ],
    }
""".strip(),
        encoding="utf-8",
    )

    bridge_code = hanlp_runtime_module._BRIDGE_CODE.replace(
        "return (3, 6) <= current <= (3, 9)",
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
    assert parsed["status"] == "ready"
    assert parsed["reason_code"] == "HANLP2_TASK_READY"
    assert parsed["task_result"]["tokens"] == ["我", "姐", "喜欢", "它"]
