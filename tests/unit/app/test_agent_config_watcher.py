# -*- coding: utf-8 -*-
"""Guard the graceful-reload behaviour of ``AgentConfigWatcher``.

The watcher must delegate to ``MultiAgentManager.reload_agent`` (which
drains in-flight tasks) instead of swapping managers in place.
"""

import asyncio
import os
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from qwenpaw.app import agent_config_watcher as watcher_module


class _Section:
    def __init__(self, payload):
        self._payload = payload

    def model_dump(self, mode="python"):
        return dict(self._payload)


class _Config:
    def __init__(self, channels, heartbeat):
        self.channels = channels
        self.heartbeat = heartbeat


class _FakeManager:
    def __init__(self):
        self.reloaded: list[str] = []

    async def reload_agent(self, agent_id: str) -> bool:
        self.reloaded.append(agent_id)
        return True


def _make_watcher(tmp_path: Path, manager):
    return watcher_module.AgentConfigWatcher(
        agent_id="default",
        workspace_dir=tmp_path,
        workspace=SimpleNamespace(_manager=manager),
        poll_interval=0.01,
    )


def _patch_config_loader(monkeypatch, configs):
    monkeypatch.setattr(
        watcher_module,
        "load_agent_config",
        lambda _: next(configs),
    )


def _touch(config_path: Path) -> None:
    stamp = time.time() + 5.0
    os.utime(config_path, (stamp, stamp))


@pytest.mark.asyncio
async def test_watcher_delegates_change_to_graceful_reload(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    config_path = tmp_path / "agent.json"
    config_path.write_text("{}", encoding="utf-8")
    manager = _FakeManager()
    watcher = _make_watcher(tmp_path, manager)

    configs = iter(
        [
            _Config(_Section({"a": 1}), _Section({"every": "1h"})),
            _Config(_Section({"a": 2}), _Section({"every": "1h"})),
        ],
    )
    _patch_config_loader(monkeypatch, configs)

    watcher._snapshot()
    assert manager.reloaded == []

    _touch(config_path)
    await watcher._check()

    assert manager.reloaded == ["default"]
    assert watcher._disabled is True


@pytest.mark.asyncio
async def test_watcher_ignores_rewrite_of_same_sections(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    config_path = tmp_path / "agent.json"
    config_path.write_text("{}", encoding="utf-8")
    manager = _FakeManager()
    watcher = _make_watcher(tmp_path, manager)

    def _config():
        return _Config(_Section({"a": 1}), _Section({"every": "1h"}))

    monkeypatch.setattr(
        watcher_module,
        "load_agent_config",
        lambda _: _config(),
    )

    watcher._snapshot()
    _touch(config_path)
    await watcher._check()

    assert manager.reloaded == []
    assert watcher._disabled is False


@pytest.mark.asyncio
async def test_watcher_skips_reload_without_manager(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    config_path = tmp_path / "agent.json"
    config_path.write_text("{}", encoding="utf-8")
    watcher = _make_watcher(tmp_path, None)

    configs = iter(
        [
            _Config(_Section({"a": 1}), _Section({"every": "1h"})),
            _Config(_Section({"a": 2}), _Section({"every": "1h"})),
        ],
    )
    _patch_config_loader(monkeypatch, configs)

    watcher._snapshot()
    _touch(config_path)
    await watcher._check()

    assert watcher._disabled is False


@pytest.mark.asyncio
async def test_poll_loop_preserves_cancelled_error(
    tmp_path: Path,
    monkeypatch,
):
    watcher = _make_watcher(tmp_path, _FakeManager())

    async def fake_check():
        raise asyncio.CancelledError()

    monkeypatch.setattr(watcher, "_check", fake_check)

    with pytest.raises(asyncio.CancelledError):
        await watcher._poll_loop()
