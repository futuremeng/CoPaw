# -*- coding: utf-8 -*-

from pathlib import Path
from types import SimpleNamespace
from typing import cast

import pytest

from copaw.app.mcp import watcher as watcher_module
from copaw.app.mcp import MCPClientManager


@pytest.mark.asyncio
async def test_mcp_config_watcher_start_offloads_snapshot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    fake_manager = cast(MCPClientManager, object())
    watcher = watcher_module.MCPConfigWatcher(
        mcp_manager=fake_manager,
        config_loader=lambda: SimpleNamespace(mcp={}),
        poll_interval=0.01,
        config_path=tmp_path / "config.json",
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
async def test_mcp_config_watcher_check_offloads_stat_and_load(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    config_path = tmp_path / "config.json"
    config_path.write_text("{}", encoding="utf-8")

    fake_manager = cast(MCPClientManager, object())
    watcher = watcher_module.MCPConfigWatcher(
        mcp_manager=fake_manager,
        config_loader=lambda: SimpleNamespace(mcp=SimpleNamespace(model_dump=lambda mode="json": {})),
        poll_interval=0.01,
        config_path=config_path,
    )
    watcher._last_mtime_ns = 1
    watcher._last_mcp_hash = None

    original_to_thread = watcher_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    async def fake_reload_wrapper(new_mcp):
        watcher._last_mcp_hash = watcher._mcp_hash(new_mcp)

    monkeypatch.setattr(watcher_module.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(watcher, "_reload_changed_clients_wrapper", fake_reload_wrapper)
    monkeypatch.setattr(watcher, "_load_mcp_config", lambda: SimpleNamespace(model_dump=lambda mode="json": {"clients": {}}))

    await watcher._check()

    assert len(calls) >= 2
    assert calls[0][1] == (config_path,)
    assert calls[1][1] == ()