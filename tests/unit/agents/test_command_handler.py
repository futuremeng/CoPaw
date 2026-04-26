# -*- coding: utf-8 -*-
import pytest

from qwenpaw.agents.command_handler import CommandHandler


class DummyMemory:
    def __init__(self) -> None:
        self.clear_content_called = 0
        self.clear_summary_called = 0

    async def clear_content(self) -> None:
        self.clear_content_called += 1

    def clear_compressed_summary(self) -> None:
        self.clear_summary_called += 1

    async def get_memory(self, prepend_summary: bool = False) -> list:
        assert prepend_summary is False
        return []


def test_constructor_accepts_legacy_enable_memory_manager_flag() -> None:
    memory = DummyMemory()
    sentinel_manager = object()

    disabled_handler = CommandHandler(
        agent_name="QwenPaw",
        memory=memory,
        memory_manager=sentinel_manager,
        enable_memory_manager=False,
    )
    enabled_handler = CommandHandler(
        agent_name="QwenPaw",
        memory=memory,
        memory_manager=sentinel_manager,
        enable_memory_manager=True,
    )

    assert disabled_handler.memory_manager is None
    assert enabled_handler.memory_manager is sentinel_manager


@pytest.mark.asyncio
async def test_process_clear_returns_clear_history_metadata() -> None:
    memory = DummyMemory()
    handler = CommandHandler(agent_name="QwenPaw", memory=memory)

    msg = await handler.handle_command("/clear")

    assert memory.clear_content_called == 1
    assert memory.clear_summary_called == 1
    assert msg.metadata == {"clear_history": True, "clear_plan": True}
