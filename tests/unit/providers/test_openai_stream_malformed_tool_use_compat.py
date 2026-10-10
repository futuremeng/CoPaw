# -*- coding: utf-8 -*-
"""Where malformed streaming tool-calls get dropped today.

Before the agentscope 2.0.9 bump an empty ``name`` reached ``parsed.content``
and the issue #4185 filter in ``OpenAIChatModelCompat`` dropped it.  That arm
is now inert: the library parser substitutes ``name="unknown"`` for a missing
tool name, and a non-string ``id`` fails ``ToolCallBlock`` validation before
the filter ever sees the block.  The drops that still happen are
``_sanitize_tool_call``'s -- a tool-call delta without ``index`` or without
``function`` never reaches the parser at all.
"""
from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from typing import Any

from agentscope.credential import OpenAICredential

from qwenpaw.providers.openai_chat_model_compat import OpenAIChatModelCompat


class _HarnessModel(OpenAIChatModelCompat):
    async def parse_stream(self, stream: Any) -> list[Any]:
        responses = []
        async for response in self._parse_stream_response(
            datetime.now(),
            stream,
        ):
            responses.append(response)
        return responses


class _FakeAsyncStream:
    def __init__(self, items: list[Any]):
        self._items = items
        self._iter = None

    async def __aenter__(self) -> "_FakeAsyncStream":
        self._iter = iter(self._items)
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:
        return False

    def __aiter__(self) -> "_FakeAsyncStream":
        return self

    async def __anext__(self) -> Any:
        assert self._iter is not None
        try:
            return next(self._iter)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


def _chunk(tool_calls: list[Any]) -> Any:
    delta = SimpleNamespace(
        reasoning_content=None,
        content=None,
        tool_calls=tool_calls,
    )
    return SimpleNamespace(usage=None, choices=[SimpleNamespace(delta=delta)])


def _model() -> _HarnessModel:
    return _HarnessModel(
        credential=OpenAICredential(api_key="sk-test"),
        model="dummy",
        stream=True,
    )


def _tool_blocks(responses: list[Any]) -> list[Any]:
    return [
        block
        for response in responses
        for block in response.content
        if getattr(block, "type", None) in ("tool_use", "tool_call")
    ]


async def test_tool_call_without_index_is_dropped() -> None:
    no_index = SimpleNamespace(
        id="call_orphan",
        function=SimpleNamespace(name="ping", arguments="{}"),
    )

    responses = await _model().parse_stream(
        _FakeAsyncStream([_chunk([no_index])]),
    )

    assert _tool_blocks(responses) == []


async def test_tool_call_without_function_is_dropped() -> None:
    no_function = SimpleNamespace(index=0, id="call_empty")

    responses = await _model().parse_stream(
        _FakeAsyncStream([_chunk([no_function])]),
    )

    assert _tool_blocks(responses) == []


async def test_nameless_tool_call_is_renamed_not_dropped() -> None:
    """Records the inert #4185 arm: the parser fills the name in for us."""
    nameless = SimpleNamespace(
        index=0,
        id="call_no_name",
        function=SimpleNamespace(arguments='{"x": 1}'),
    )

    responses = await _model().parse_stream(
        _FakeAsyncStream([_chunk([nameless])]),
    )
    blocks = _tool_blocks(responses)

    assert [b.name for b in blocks] == ["unknown"]
    assert [b.input for b in blocks] == ['{"x": 1}']


async def test_valid_tool_call_survives() -> None:
    valid = SimpleNamespace(
        index=0,
        id="call_ok",
        function=SimpleNamespace(name="ping", arguments='{"x": 1}'),
    )

    responses = await _model().parse_stream(
        _FakeAsyncStream([_chunk([valid])]),
    )
    blocks = _tool_blocks(responses)

    assert blocks
    assert blocks[-1].name == "ping"
    assert blocks[-1].input == '{"x": 1}'
