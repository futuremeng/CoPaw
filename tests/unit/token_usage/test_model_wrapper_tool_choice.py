# -*- coding: utf-8 -*-
"""The wrapper must drop ``tool_choice="auto"`` before hitting the model.

vLLM without ``--enable-auto-tool-choice`` rejects any request that carries
``tool_choice="auto"``, even when tools are present.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from qwenpaw.token_usage.model_wrapper import TokenRecordingModelWrapper


def _wrapper() -> tuple[TokenRecordingModelWrapper, AsyncMock]:
    model = AsyncMock()
    model.model_name = "qwen2.5"
    model.return_value = MagicMock(usage=None)
    return TokenRecordingModelWrapper("vllm", model), model


@pytest.mark.parametrize(
    ("tool_choice", "expected"),
    [("auto", None), ("required", "required"), ("none", "none"), (None, None)],
)
def test_tool_choice_passed_through_except_auto(
    tool_choice: str | None,
    expected: object,
) -> None:
    wrapper, model = _wrapper()

    asyncio.run(
        wrapper(
            messages=[{"role": "user", "content": "ping"}],
            tools=[{"type": "function", "function": {"name": "f"}}],
            tool_choice=tool_choice,
        ),
    )

    _, kwargs = model.call_args
    assert kwargs["tool_choice"] == expected
    assert kwargs["tools"] == [{"type": "function", "function": {"name": "f"}}]
