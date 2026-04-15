# -*- coding: utf-8 -*-

from __future__ import annotations

import asyncio

import pytest

from qwenpaw.app.mcp.manager import MCPClientManager
from qwenpaw.app.mcp.stateful_client import HttpStatefulClient, StdIOStatefulClient
from qwenpaw.config.config import MCPClientConfig


@pytest.mark.asyncio
async def test_http_close_stops_retrying_lifecycle_when_disconnected() -> None:
    client = HttpStatefulClient(
        name="superset_mcp",
        transport="streamable_http",
        url="http://example.test/mcp",
    )

    async def wait_for_stop() -> None:
        await client._stop_event.wait()

    client._lifecycle_task = asyncio.create_task(wait_for_stop())

    await client.close()

    assert client._stop_event.is_set()
    assert client._lifecycle_task is None
    assert client.is_connected is False


@pytest.mark.asyncio
async def test_stdio_close_stops_retrying_lifecycle_when_disconnected() -> None:
    client = StdIOStatefulClient(
        name="local_mcp",
        command="python",
        args=["-m", "example"],
    )

    async def wait_for_stop() -> None:
        await client._stop_event.wait()

    client._lifecycle_task = asyncio.create_task(wait_for_stop())

    await client.close()

    assert client._stop_event.is_set()
    assert client._lifecycle_task is None
    assert client.is_connected is False


@pytest.mark.asyncio
async def test_replace_client_clears_failed_key_after_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manager = MCPClientManager()
    old_client_closed = False

    class OldClient:
        is_connected = False

        async def close(self) -> None:
            nonlocal old_client_closed
            old_client_closed = True

    class NewClient:
        is_connected = True

        async def connect(self) -> None:
            return None

    async def fake_wait_for(awaitable, timeout=None):
        return await awaitable

    monkeypatch.setattr(asyncio, "wait_for", fake_wait_for)
    monkeypatch.setattr(manager, "_build_client", lambda _cfg: NewClient())

    manager._clients["superset_mcp"] = OldClient()
    manager._failed_keys.add("superset_mcp")

    await manager.replace_client(
        "superset_mcp",
        MCPClientConfig(
            name="Superset",
            transport="streamable_http",
            url="http://new.example.test/mcp",
        ),
    )

    assert old_client_closed is True
    assert "superset_mcp" not in manager.failed_keys()
