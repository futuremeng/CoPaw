# -*- coding: utf-8 -*-
"""Tests for disk-gated agent configuration reloads."""

# pylint: disable=protected-access

import asyncio
import os
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from qwenpaw.app import agent_config_watcher as watcher_module
from qwenpaw.config.config import (
    AgentProfileConfig,
    ChannelConfig,
    ConsoleConfig,
)


def _agent_config(*, console_enabled: bool) -> AgentProfileConfig:
    """Build a minimal config with one observable channel setting."""
    return AgentProfileConfig(
        id="agent",
        name="Agent",
        channels=ChannelConfig(
            console=ConsoleConfig(enabled=console_enabled),
        ),
    )


@pytest.mark.asyncio
async def test_watcher_ignores_mutated_cache_without_disk_change(
    tmp_path,
    monkeypatch,
) -> None:
    """An in-memory mutation alone cannot trigger a workspace reload."""
    config_path = tmp_path / "agent.json"
    config_path.write_text("{}", encoding="utf-8")
    config = _agent_config(console_enabled=True)
    manager = SimpleNamespace(reload_agent=AsyncMock())
    workspace = SimpleNamespace(_manager=manager)
    watcher = watcher_module.AgentConfigWatcher(
        "agent",
        tmp_path,
        workspace,
    )
    monkeypatch.setattr(
        watcher_module,
        "load_agent_config",
        lambda _agent_id: config,
    )

    await watcher._snapshot()
    config.channels.console.enabled = False
    await watcher._check()

    manager.reload_agent.assert_not_awaited()


@pytest.mark.asyncio
async def test_watcher_reloads_after_disk_and_channel_change(
    tmp_path,
    monkeypatch,
) -> None:
    """A changed file and observable config section trigger a reload."""
    config_path = tmp_path / "agent.json"
    config_path.write_text("{}", encoding="utf-8")
    config = _agent_config(console_enabled=True)
    manager = SimpleNamespace(
        note_agent_config_changed=Mock(),
        reload_agent=AsyncMock(return_value=True),
    )
    workspace = SimpleNamespace(_manager=manager)
    watcher = watcher_module.AgentConfigWatcher(
        "agent",
        tmp_path,
        workspace,
    )
    monkeypatch.setattr(
        watcher_module,
        "load_agent_config",
        lambda _agent_id: config,
    )

    await watcher._snapshot()
    config.channels.console.enabled = False
    config_path.write_text('{"changed": true}', encoding="utf-8")
    await watcher._check()

    manager.note_agent_config_changed.assert_called_once_with("agent")
    manager.reload_agent.assert_awaited_once_with("agent")


# Fork guard tests: graceful reload delegation and poll-loop semantics.


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
        self.noted: list[str] = []

    def note_agent_config_changed(self, agent_id: str) -> int:
        self.noted.append(agent_id)
        return len(self.noted)

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

    await watcher._snapshot()
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

    await watcher._snapshot()
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

    await watcher._snapshot()
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
