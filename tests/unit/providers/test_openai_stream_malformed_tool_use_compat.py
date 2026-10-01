# -*- coding: utf-8 -*-
"""Upstream issue #4185 guard must stay in the stream parser.

``_sanitize_tool_call`` deliberately keeps a tool call that has no ``name``
(see the upstream-owned ``test_openai_stream_toolcall_compat.py``), so the
``parsed.content`` filter is the only thing that stops such blocks from being
yielded and persisted into session history.
"""
from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from typing import Any

from qwenpaw.providers.openai_chat_model_compat import OpenAIChatModelCompat


class _HarnessModel(OpenAIChatModelCompat):
    async def parse_stream(self, stream: Any) -> list[Any]:
        responses = []
        async for response in self._parse_openai_stream_response(
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
    return _HarnessModel("dummy", api_key="sk-test", stream=True)


def _tool_blocks(responses: list[Any]) -> list[dict]:
    return [
        block
        for response in responses
        for block in response.content
        if block.get("type") == "tool_use"
    ]


async def test_nameless_tool_use_block_is_dropped() -> None:
    nameless = SimpleNamespace(
        index=0,
        id="call_no_name",
        function=SimpleNamespace(arguments='{"x": 1}'),
    )

    responses = await _model().parse_stream(
        _FakeAsyncStream([_chunk([nameless])]),
    )
    blocks = _tool_blocks(responses)

    assert [b for b in blocks if not b.get("name")] == []


async def test_valid_tool_use_block_survives_the_filter() -> None:
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
    assert blocks[-1]["name"] == "ping"
    assert blocks[-1]["input"] == {"x": 1}
