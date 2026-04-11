# -*- coding: utf-8 -*-

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

from copaw.app import agent_config_watcher as watcher_module


@pytest.mark.asyncio
async def test_agent_config_watcher_start_offloads_snapshot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    watcher = watcher_module.AgentConfigWatcher(
        agent_id="default",
        workspace_dir=tmp_path,
        channel_manager=None,
        poll_interval=0.01,
    )

    original_to_thread = watcher_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(watcher, "_snapshot", lambda: None)
    monkeypatch.setattr(watcher_module.asyncio, "to_thread", fake_to_thread)

    await watcher.start()
    await watcher.stop()

    assert calls
    assert calls[0][1] == ()


@pytest.mark.asyncio
async def test_agent_config_watcher_check_offloads_stat_and_load(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    config_path = tmp_path / "agent.json"
    config_path.write_text("{}", encoding="utf-8")

    watcher = watcher_module.AgentConfigWatcher(
        agent_id="default",
        workspace_dir=tmp_path,
        channel_manager=None,
        poll_interval=0.01,
    )
    watcher._last_mtime_ns = 1

    original_to_thread = watcher_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(watcher_module.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(watcher_module, "load_agent_config", lambda _agent_id: SimpleNamespace(channels=None, heartbeat=None))

    await watcher._check()

    assert len(calls) >= 2
    assert calls[0][1] == (config_path,)
    assert calls[1][1] == ("default",)


@pytest.mark.asyncio
async def test_agent_config_watcher_poll_loop_preserves_cancelled_error(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    watcher = watcher_module.AgentConfigWatcher(
        agent_id="default",
        workspace_dir=tmp_path,
        channel_manager=None,
        poll_interval=0,
    )

    async def fake_check():
        raise asyncio.CancelledError()

    monkeypatch.setattr(watcher, "_check", fake_check)

    with pytest.raises(asyncio.CancelledError):
        await watcher._poll_loop()