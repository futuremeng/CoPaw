from pathlib import Path
from types import SimpleNamespace

from qwenpaw.agents.utils import hanlp_sidecar as hanlp_sidecar_module


class _StatusSequence:
    def __init__(self, states):
        self._states = list(states)

    def __call__(self, _config):
        if len(self._states) > 1:
            return self._states.pop(0)
        return self._states[0]


def _make_config():
    hanlp = SimpleNamespace(
        enabled=False,
        python_executable="",
        hanlp_home="",
        model_id="FINE_ELECTRA_SMALL_ZH",
    )
    return SimpleNamespace(knowledge=SimpleNamespace(hanlp=hanlp))


def test_ensure_uv_available_bootstraps_with_pip(monkeypatch):
    operations = []
    uv_results = iter(["", "", "/tmp/uv"])

    monkeypatch.setattr(
        hanlp_sidecar_module,
        "_find_uv_executable",
        lambda: next(uv_results),
    )
    monkeypatch.setattr(
        hanlp_sidecar_module,
        "_python_candidate_executables",
        lambda: ["/usr/bin/python3.10"],
    )
    monkeypatch.setattr(
        hanlp_sidecar_module,
        "_run_command",
        lambda command: {
            "command": " ".join(command),
            "ok": True,
            "output": "installed",
            "returncode": 0,
        },
    )

    uv_executable = hanlp_sidecar_module._ensure_uv_available(operations)

    assert uv_executable == "/tmp/uv"
    assert operations == [
        {
            "name": "install-uv",
            "attempted": True,
            "installer": "pip",
            "command": "/usr/bin/python3.10 -m pip install -U uv",
            "ok": True,
            "output": "installed",
            "returncode": 0,
        },
        {
            "name": "install-uv",
            "attempted": True,
            "installer": "pip",
            "command": "/usr/bin/python3.10 -m pip install --user -U uv",
            "ok": True,
            "output": "installed",
            "returncode": 0,
        },
    ]


def test_auto_install_hanlp_sidecar_uses_python_fallback(monkeypatch, tmp_path):
    config = _make_config()
    python_path = tmp_path / "hanlp_sidecar" / "venv" / "bin" / "python"
    status_sequence = _StatusSequence(
        [
            {
                "sidecar": {"status": "unavailable"},
                "model": {"status": "unavailable"},
            },
            {
                "sidecar": {"status": "unavailable"},
                "model": {"status": "unavailable"},
            },
        ],
    )

    monkeypatch.setattr(hanlp_sidecar_module, "WORKING_DIR", tmp_path)
    monkeypatch.setattr(hanlp_sidecar_module, "load_config", lambda: config)
    monkeypatch.setattr(hanlp_sidecar_module, "save_config", lambda _config: None)
    monkeypatch.setattr(hanlp_sidecar_module, "_build_status", status_sequence)
    monkeypatch.setattr(
        hanlp_sidecar_module,
        "get_hanlp_sidecar_status",
        lambda force_refresh=False: {
            "sidecar": {"status": "ready"},
            "model": {"status": "unavailable"},
        },
    )
    monkeypatch.setattr(hanlp_sidecar_module, "_ensure_uv_available", lambda operations: "")
    monkeypatch.setattr(
        hanlp_sidecar_module,
        "_find_supported_python_executable",
        lambda: "/usr/bin/python3.9",
    )

    def fake_run_command(command):
        command_text = " ".join(command)
        if command[-2:] == ["install", "hanlp"]:
            return {
                "command": command_text,
                "ok": True,
                "output": "installed",
                "returncode": 0,
            }
        if command[1:3] == ["-m", "venv"]:
            python_path.parent.mkdir(parents=True, exist_ok=True)
            python_path.write_text("#!/usr/bin/env python\n", encoding="utf-8")
            return {
                "command": command_text,
                "ok": True,
                "output": "created",
                "returncode": 0,
            }
        raise AssertionError(f"unexpected command: {command}")

    monkeypatch.setattr(hanlp_sidecar_module, "_run_command", fake_run_command)

    result = hanlp_sidecar_module.auto_install_hanlp_sidecar()

    assert result["success"] is True
    assert result["operations"] == [
        {
            "name": "create-venv",
            "attempted": True,
            "installer": "python",
            "command": f"/usr/bin/python3.9 -m venv {tmp_path / 'hanlp_sidecar' / 'venv'}",
            "ok": True,
            "output": "created",
            "returncode": 0,
        },
        {
            "name": "install-hanlp",
            "attempted": True,
            "installer": "pip",
            "command": f"{python_path} -m pip install hanlp",
            "ok": True,
            "output": "installed",
            "returncode": 0,
        },
    ]
    assert config.knowledge.hanlp.enabled is True
    assert config.knowledge.hanlp.python_executable == str(python_path)
    assert config.knowledge.hanlp.hanlp_home == str(tmp_path / "hanlp_sidecar" / "home")


def test_auto_install_hanlp_sidecar_reports_missing_bootstrap_prereqs(monkeypatch):
    config = _make_config()
    status = {
        "sidecar": {"status": "unavailable"},
        "model": {"status": "unavailable"},
    }

    monkeypatch.setattr(hanlp_sidecar_module, "load_config", lambda: config)
    monkeypatch.setattr(hanlp_sidecar_module, "_build_status", lambda _config: status)
    monkeypatch.setattr(hanlp_sidecar_module, "_ensure_uv_available", lambda operations: "")
    monkeypatch.setattr(hanlp_sidecar_module, "_find_supported_python_executable", lambda: "")

    result = hanlp_sidecar_module.auto_install_hanlp_sidecar()

    assert result["success"] is False
    assert result["manual_steps"] == [
        "Automatic HanLP bootstrap could not find or install uv, and no compatible Python 3.6-3.9 interpreter was found.",
        "Install uv or provide a Python 3.9 executable, then retry HanLP sidecar setup.",
    ]
    assert result["operations"] == []


def test_auto_install_hanlp_sidecar_uses_uv_managed_environment(monkeypatch, tmp_path):
    config = _make_config()
    python_path = tmp_path / "hanlp_sidecar" / "venv" / "bin" / "python"
    status_sequence = _StatusSequence(
        [
            {
                "sidecar": {"status": "unavailable"},
                "model": {"status": "unavailable"},
            },
            {
                "sidecar": {"status": "unavailable"},
                "model": {"status": "unavailable"},
            },
        ],
    )

    monkeypatch.setattr(hanlp_sidecar_module, "WORKING_DIR", tmp_path)
    monkeypatch.setattr(hanlp_sidecar_module, "load_config", lambda: config)
    monkeypatch.setattr(hanlp_sidecar_module, "save_config", lambda _config: None)
    monkeypatch.setattr(hanlp_sidecar_module, "_build_status", status_sequence)
    monkeypatch.setattr(
        hanlp_sidecar_module,
        "get_hanlp_sidecar_status",
        lambda force_refresh=False: {
            "sidecar": {"status": "ready"},
            "model": {"status": "unavailable"},
        },
    )
    monkeypatch.setattr(
        hanlp_sidecar_module,
        "_ensure_uv_available",
        lambda operations: "/tmp/uv",
    )
    monkeypatch.setattr(
        hanlp_sidecar_module,
        "_find_supported_python_executable",
        lambda: "/usr/bin/python3.9",
    )

    def fake_run_command(command):
        command_text = " ".join(command)
        if command[:3] == ["/tmp/uv", "python", "install"]:
            return {
                "command": command_text,
                "ok": True,
                "output": "python installed",
                "returncode": 0,
            }
        if command[:3] == ["/tmp/uv", "venv", "--python"]:
            python_path.parent.mkdir(parents=True, exist_ok=True)
            python_path.write_text("#!/usr/bin/env python\n", encoding="utf-8")
            return {
                "command": command_text,
                "ok": True,
                "output": "venv created",
                "returncode": 0,
            }
        if command[:4] == ["/tmp/uv", "pip", "install", "--python"]:
            return {
                "command": command_text,
                "ok": True,
                "output": "hanlp installed",
                "returncode": 0,
            }
        raise AssertionError(f"unexpected command: {command}")

    monkeypatch.setattr(hanlp_sidecar_module, "_run_command", fake_run_command)

    result = hanlp_sidecar_module.auto_install_hanlp_sidecar()

    assert result["success"] is True
    assert [operation["name"] for operation in result["operations"]] == [
        "install-python",
        "create-venv",
        "install-hanlp",
    ]
    assert [operation["installer"] for operation in result["operations"]] == [
        "uv",
        "uv",
        "uv",
    ]
    assert config.knowledge.hanlp.python_executable == str(python_path)
