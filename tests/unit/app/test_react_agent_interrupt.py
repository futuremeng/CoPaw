# -*- coding: utf-8 -*-
from __future__ import annotations

import importlib
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


@pytest.mark.asyncio
async def test_handle_interrupt_uses_stored_agent_config_language() -> None:
    module = importlib.import_module("copaw.agents.react_agent")

    agent = object.__new__(module.CoPawAgent)
    agent.name = "copaw"
    agent._agent_config = SimpleNamespace(language="zh")
    agent.print = AsyncMock()
    agent.memory = SimpleNamespace(add=AsyncMock())

    response = await agent.handle_interrupt()

    assert response.role == "assistant"
    assert response.metadata["_is_interrupted"] is True
    assert "已停止上一条回复" in response.content
    agent.print.assert_awaited_once()
    agent.memory.add.assert_awaited_once_with(response)