# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from unittest.mock import patch

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