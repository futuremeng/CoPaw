# -*- coding: utf-8 -*-
"""Tests for the runner's one-shot forced context compaction helper."""
from types import SimpleNamespace

import pytest
from agentscope.message import Msg, TextBlock

from qwenpaw.app.runner import query_error_resilience
from qwenpaw.app.runner.query_error_resilience import (
    force_context_compaction,
    retry_on_context_overflow,
)


def _msg(text: str) -> Msg:
    return Msg(
        name="Friday",
        role="assistant",
        content=[TextBlock(type="text", text=text)],
    )


class _Memory:
    def __init__(self, messages, summary=""):
        self._messages = list(messages)
        self.summary = summary

    def get_compressed_summary(self):
        return self.summary

    async def get_memory(self, prepend_summary=False):
        _ = prepend_summary
        return list(self._messages)


class _ContextManager:
    """Stands in for LightContextManager.pre_reasoning's observable effect."""

    def __init__(self, *, drop=0, summary=None, raises=False):
        self.calls = 0
        self.drop = drop
        self.summary = summary
        self.raises = raises

    async def pre_reasoning(self, agent, kwargs):
        _ = kwargs
        self.calls += 1
        if self.raises:
            raise RuntimeError("compaction backend unavailable")
        if self.drop:
            del agent.memory._messages[: self.drop]
        if self.summary is not None:
            agent.memory.summary = self.summary
        return None


def _agent(memory, context_manager):
    return SimpleNamespace(memory=memory, context_manager=context_manager)


async def test_missing_managers_skip_compaction_attempt():
    manager = _ContextManager(summary="new")

    assert await force_context_compaction(SimpleNamespace()) is False
    assert (
        await force_context_compaction(
            SimpleNamespace(context_manager=manager),
        )
        is False
    )
    assert (
        await force_context_compaction(
            _agent(_Memory(["a"]), None),
        )
        is False
    )
    assert manager.calls == 0


async def test_returns_true_when_summary_changes():
    memory = _Memory(["a", "b", "c"], summary="old")
    manager = _ContextManager(summary="compact summary of a b c")

    assert await force_context_compaction(_agent(memory, manager)) is True
    assert manager.calls == 1


async def test_returns_true_when_history_shrinks_without_new_summary():
    memory = _Memory(["a", "b", "c"])
    manager = _ContextManager(drop=2)

    assert await force_context_compaction(_agent(memory, manager)) is True


async def test_noop_compaction_reports_false_so_the_turn_is_not_retried():
    memory = _Memory(["a", "b", "c"], summary="same")
    manager = _ContextManager()

    assert await force_context_compaction(_agent(memory, manager)) is False
    assert manager.calls == 1


async def test_compaction_failure_reports_false():
    memory = _Memory(["a", "b", "c"])
    manager = _ContextManager(raises=True)

    assert await force_context_compaction(_agent(memory, manager)) is False


async def test_unreadable_memory_reports_false():
    class _BrokenMemory(_Memory):
        async def get_memory(self, prepend_summary=False):
            _ = prepend_summary
            raise RuntimeError("session file unreadable")

    memory = _BrokenMemory(["a"])
    manager = _ContextManager(summary="new")

    assert await force_context_compaction(_agent(memory, manager)) is False
    assert manager.calls == 0


def _overflow() -> RuntimeError:
    return RuntimeError("APIError: Context size has been exceeded")


def _agent_stub():
    return SimpleNamespace(memory=_Memory(["a"]), context_manager=None)


async def _stream(
    state,
    *,
    fail_first=True,
    yields_before_failure=False,
    always_fail=False,
):
    state["calls"] += 1
    if yields_before_failure:
        yield _msg("partial"), False
    if always_fail or (fail_first and state["calls"] == 1):
        raise _overflow()
    yield _msg("ok"), True


async def _collect(state, *, agent=None, **stream_kwargs):
    out = []
    async for msg, last in retry_on_context_overflow(
        agent=agent if agent is not None else _agent_stub(),
        channel="console",
        session_id="session-1",
        stream_factory=lambda: _stream(state, **stream_kwargs),
        user_id="user-1",
    ):
        out.append((msg.get_text_content(), last))
    return out


async def test_overflow_replays_the_turn_once_after_compaction(monkeypatch):
    compactions = {"count": 0}

    async def _compact(_agent):
        compactions["count"] += 1
        return True

    monkeypatch.setattr(
        query_error_resilience,
        "force_context_compaction",
        _compact,
    )
    state = {"calls": 0}

    assert await _collect(state) == [("ok", True)]
    assert state["calls"] == 2
    assert compactions["count"] == 1


async def test_partial_output_disqualifies_the_replay(monkeypatch):
    async def _compact(_agent):
        raise AssertionError("must not compact after output was streamed")

    monkeypatch.setattr(
        query_error_resilience,
        "force_context_compaction",
        _compact,
    )
    state = {"calls": 0}

    with pytest.raises(RuntimeError):
        await _collect(state, yields_before_failure=True)
    assert state["calls"] == 1


async def test_noop_compaction_does_not_cost_a_second_request(monkeypatch):
    async def _compact(_agent):
        return False

    monkeypatch.setattr(
        query_error_resilience,
        "force_context_compaction",
        _compact,
    )
    state = {"calls": 0}

    with pytest.raises(RuntimeError):
        await _collect(state)
    assert state["calls"] == 1


async def test_retry_budget_is_one(monkeypatch):
    async def _compact(_agent):
        return True

    monkeypatch.setattr(
        query_error_resilience,
        "force_context_compaction",
        _compact,
    )
    state = {"calls": 0}

    with pytest.raises(RuntimeError):
        await _collect(state, always_fail=True)
    assert state["calls"] == 2


async def test_other_stream_errors_are_not_retried(monkeypatch):
    async def _compact(_agent):
        raise AssertionError("must not compact a non-overflow error")

    monkeypatch.setattr(
        query_error_resilience,
        "force_context_compaction",
        _compact,
    )

    async def _fails_with_value_error():
        raise ValueError("boom")
        yield  # pragma: no cover

    out = []
    with pytest.raises(ValueError):
        async for item in retry_on_context_overflow(
            agent=_agent_stub(),
            channel="console",
            session_id="session-1",
            stream_factory=_fails_with_value_error,
            user_id="user-1",
        ):
            out.append(item)
    assert out == []
