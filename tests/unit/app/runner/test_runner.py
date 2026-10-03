# -*- coding: utf-8 -*-
from __future__ import annotations
import pytest


import asyncio
from types import SimpleNamespace
from typing import Any, AsyncIterator, cast

import httpx
from agentscope.message import Msg, TextBlock
from agentscope_runtime.engine.schemas.agent_schemas import AgentRequest

from qwenpaw.app.runner.runner import AgentRunner
from qwenpaw.app.runner.session import SafeJSONSession


class _Retryable503Error(Exception):
    status_code = 503


class _DummyAgent:
    last_instance = None

    def __init__(self, *args, **kwargs) -> None:
        _ = args, kwargs
        self.interrupted = False
        self.toolkit = SimpleNamespace(skills={})
        self.model = SimpleNamespace(model_name="dummy-model")
        _DummyAgent.last_instance = self

    async def register_mcp_clients(self) -> None:
        return None

    def set_console_output_enabled(self, enabled: bool) -> None:
        _ = enabled

    def rebuild_sys_prompt(self) -> None:
        return None

    def clear_focus_dir(self) -> None:
        return None

    def set_focus_dir(self, focus_dir) -> None:
        _ = focus_dir

    def set_flow_memory_path(self, path) -> None:
        _ = path

    def update_env_context(self, env_context: str) -> None:
        _ = env_context

    def __call__(self, msgs):
        _ = msgs
        return object()

    async def interrupt(self) -> None:
        self.interrupted = True


class _DummySession(SafeJSONSession):
    def __init__(self) -> None:
        super().__init__(save_dir=".")
        self.saved = False

    async def load_session_state(
        self,
        session_id: str,
        user_id: str = "",
        allow_not_exist: bool = True,
        **state_modules_mapping,
    ) -> None:
        _ = session_id, user_id, allow_not_exist, state_modules_mapping

    async def save_session_state(
        self,
        session_id: str,
        user_id: str = "",
        **state_modules_mapping,
    ) -> None:
        _ = session_id, user_id, state_modules_mapping
        self.saved = True


async def test_query_handler_returns_retryable_error_msg(
    monkeypatch,
) -> None:
    from qwenpaw.app.runner import runner as runner_module

    async def _no_approval(session_id: str, query: str | None):
        _ = session_id, query
        return None, False, None

    async def _failing_stream_printing_messages(*args, **kwargs):
        _ = args, kwargs
        raise _Retryable503Error("Error code: 503")
        yield  # pragma: no cover

    runner = AgentRunner()
    runner.session = _DummySession()
    cast(Any, runner)._resolve_pending_approval = _no_approval

    monkeypatch.setattr(runner_module, "QwenPawAgent", _DummyAgent)
    monkeypatch.setattr(runner_module, "build_env_context", lambda **kwargs: kwargs)
    monkeypatch.setattr(
        runner_module,
        "load_agent_config",
        lambda _agent_id: _fake_agent_config(),
    )
    monkeypatch.setattr(
        runner_module,
        "_stream_printing_messages_interruptible",
        _failing_stream_printing_messages,
    )
    monkeypatch.setattr(
        runner_module,
        "write_query_error_dump",
        lambda **kwargs: "/tmp/copaw_query_error.json",
    )

    msgs = [
        Msg(
            name="user",
            role="user",
            content=[TextBlock(type="text", text="继续")],
        ),
    ]
    request = cast(
        AgentRequest,
        SimpleNamespace(
            session_id="session-1",
            user_id="user-1",
            channel="console",
        ),
    )

    results = []
    stream = cast(
        AsyncIterator[tuple[Msg, bool]],
        cast(Any, runner).query_handler(msgs, request=request),
    )
    async for msg, last in stream:
        results.append((msg, last))

    assert len(results) == 1
    msg, last = results[0]
    text = cast(str, msg.get_text_content() or "")
    assert last is True
    assert "503" in text
    assert "稍后再试" in text
    assert cast(_DummySession, runner.session).saved is True


async def test_query_handler_remote_protocol_error_gets_friendly_msg(
    monkeypatch,
) -> None:
    from qwenpaw.app.runner import runner as runner_module

    async def _no_approval(session_id: str, query: str | None):
        _ = session_id, query
        return None, False, None

    async def _failing_stream_printing_messages(*args, **kwargs):
        _ = args, kwargs
        raise httpx.RemoteProtocolError(
            "peer closed connection without sending complete message body "
            "(incomplete chunked read)",
        )
        yield  # pragma: no cover

    runner = AgentRunner()
    runner.session = _DummySession()
    cast(Any, runner)._resolve_pending_approval = _no_approval

    monkeypatch.setattr(runner_module, "QwenPawAgent", _DummyAgent)
    monkeypatch.setattr(runner_module, "build_env_context", lambda **kwargs: kwargs)
    monkeypatch.setattr(
        runner_module,
        "load_agent_config",
        lambda _agent_id: _fake_agent_config(),
    )
    monkeypatch.setattr(
        runner_module,
        "_stream_printing_messages_interruptible",
        _failing_stream_printing_messages,
    )
    monkeypatch.setattr(
        runner_module,
        "write_query_error_dump",
        lambda **kwargs: "/tmp/copaw_query_error.json",
    )

    msgs = [
        Msg(
            name="user",
            role="user",
            content=[TextBlock(type="text", text="继续")],
        ),
    ]
    request = cast(
        AgentRequest,
        SimpleNamespace(
            session_id="session-1",
            user_id="user-1",
            channel="console",
        ),
    )

    results = []
    stream = cast(
        AsyncIterator[tuple[Msg, bool]],
        cast(Any, runner).query_handler(msgs, request=request),
    )
    async for msg, last in stream:
        results.append((msg, last))

    assert len(results) == 1
    msg, last = results[0]
    text = cast(str, msg.get_text_content() or "")
    assert last is True
    assert "HTTP unknown" in text
    assert "模型服务暂时不可用" in text
    assert cast(_DummySession, runner.session).saved is True


def _fake_agent_config():
    """Minimal agent config shape query_handler reads before running."""
    return SimpleNamespace(
        running=SimpleNamespace(shell_command_executable=None),
        coding_mode=None,
        plan=None,
        language="zh",
    )


@pytest.mark.xfail(strict=True, reason="P1-BEHAVIOR-LOST（可中断 stream 取消收尾）：fork 版在 cancel 时静默 return，v2 现抛 AgentException('Task has been cancelled!')（runner.py 的 CancelledError 分支）；推翻上游这条属产品决策，未单方面改；丢失点是 deca2612a（2026-05-13 merge upstream/main 取了 upstream 侧），不是 bcaeb9062 rebrand")
async def test_query_handler_cancelled_stops_gracefully(monkeypatch) -> None:
    from qwenpaw.app.runner import runner as runner_module

    async def _no_approval(session_id: str, query: str | None):
        _ = session_id, query
        return None, False, None

    async def _cancelled_stream_printing_messages(*args, **kwargs):
        _ = args, kwargs
        raise asyncio.CancelledError()
        yield  # pragma: no cover

    runner = AgentRunner()
    runner.session = _DummySession()
    cast(Any, runner)._resolve_pending_approval = _no_approval

    monkeypatch.setattr(runner_module, "QwenPawAgent", _DummyAgent)
    monkeypatch.setattr(runner_module, "build_env_context", lambda **kwargs: kwargs)
    monkeypatch.setattr(
        runner_module,
        "load_agent_config",
        lambda _agent_id: _fake_agent_config(),
    )
    monkeypatch.setattr(
        runner_module,
        "_stream_printing_messages_interruptible",
        _cancelled_stream_printing_messages,
    )

    msgs = [
        Msg(
            name="user",
            role="user",
            content=[TextBlock(type="text", text="继续")],
        ),
    ]
    request = cast(
        AgentRequest,
        SimpleNamespace(
            session_id="session-1",
            user_id="user-1",
            channel="console",
        ),
    )

    results = []
    stream = cast(
        AsyncIterator[tuple[Msg, bool]],
        cast(Any, runner).query_handler(msgs, request=request),
    )
    async for msg, last in stream:
        results.append((msg, last))

    assert results == []
    assert cast(_DummySession, runner.session).saved is True
    assert _DummyAgent.last_instance is not None
    assert cast(_DummyAgent, _DummyAgent.last_instance).interrupted is True


async def test_query_handler_suppresses_mcp_connection_error(
    monkeypatch,
) -> None:
    from qwenpaw.app.runner import runner as runner_module

    async def _no_approval(session_id: str, query: str | None):
        _ = session_id, query
        return None, False, None

    async def _failing_stream_printing_messages(*args, **kwargs):
        _ = args, kwargs
        raise RuntimeError(
            "The MCP client is not connected to the server. "
            "Use the connect() method first.",
        )
        yield  # pragma: no cover

    runner = AgentRunner()
    runner.session = _DummySession()
    cast(Any, runner)._resolve_pending_approval = _no_approval

    monkeypatch.setattr(runner_module, "QwenPawAgent", _DummyAgent)
    monkeypatch.setattr(runner_module, "build_env_context", lambda **kwargs: kwargs)
    monkeypatch.setattr(
        runner_module,
        "load_agent_config",
        lambda _agent_id: _fake_agent_config(),
    )
    monkeypatch.setattr(
        runner_module,
        "_stream_printing_messages_interruptible",
        _failing_stream_printing_messages,
    )

    msgs = [
        Msg(
            name="user",
            role="user",
            content=[TextBlock(type="text", text="继续")],
        ),
    ]
    request = cast(
        AgentRequest,
        SimpleNamespace(
            session_id="session-1",
            user_id="user-1",
            channel="console",
        ),
    )

    results = []
    stream = cast(
        AsyncIterator[tuple[Msg, bool]],
        cast(Any, runner).query_handler(msgs, request=request),
    )
    async for msg, last in stream:
        results.append((msg, last))

    assert results == []
    assert cast(_DummySession, runner.session).saved is True


@pytest.mark.xfail(strict=True, reason="P1-BEHAVIOR-LOST（stream_query 取消收尾）：cancel 现在冒出 3 个 failed 事件，fork 版把它收成 completed；与上一条同源：随 deca2612a（2026-05-13）一起丢失")
async def test_stream_query_cancelled_finishes_without_failed_event(
    monkeypatch,
) -> None:
    from qwenpaw.app.runner import runner as runner_module

    async def _no_approval(session_id: str, query: str | None):
        _ = session_id, query
        return None, False, None

    async def _cancelled_stream_printing_messages(*args, **kwargs):
        _ = args, kwargs
        raise asyncio.CancelledError()
        yield  # pragma: no cover

    runner = AgentRunner()
    runner.session = _DummySession()
    runner._health = True  # pylint: disable=protected-access
    cast(Any, runner)._resolve_pending_approval = _no_approval

    monkeypatch.setattr(runner_module, "QwenPawAgent", _DummyAgent)
    monkeypatch.setattr(runner_module, "build_env_context", lambda **kwargs: kwargs)
    monkeypatch.setattr(
        runner_module,
        "load_agent_config",
        lambda _agent_id: _fake_agent_config(),
    )
    monkeypatch.setattr(
        runner_module,
        "_stream_printing_messages_interruptible",
        _cancelled_stream_printing_messages,
    )

    request = {
        "input": [
            {
                "role": "user",
                "type": "message",
                "content": [{"type": "text", "text": "继续"}],
            },
        ],
        "session_id": "session-1",
        "user_id": "user-1",
        "channel": "console",
        "stream": True,
    }

    events = []
    async for event in cast(Any, runner).stream_query(request):
        events.append(event)

    assert len(events) >= 3
    statuses = [getattr(event, "status", None) for event in events]
    assert "completed" in statuses
    assert statuses[-1] == "completed"
    assert "failed" not in statuses
    assert all(getattr(event, "error", None) is None for event in events)


async def test_query_handler_context_overflow_retries_once(
    monkeypatch,
) -> None:
    from qwenpaw.app.runner import query_error_resilience
    from qwenpaw.app.runner import runner as runner_module

    async def _no_approval(session_id: str, query: str | None):
        _ = session_id, query
        return None, False, None

    state = {"calls": 0}

    async def _stream_with_one_overflow(*args, **kwargs):
        _ = args, kwargs
        state["calls"] += 1
        if state["calls"] == 1:
            raise RuntimeError("APIError: Context size has been exceeded")
        yield (
            Msg(
                name="Friday",
                role="assistant",
                content=[TextBlock(type="text", text="ok")],
            ),
            True,
        )

    compact_calls = {"count": 0}

    async def _force_compact(_agent):
        compact_calls["count"] += 1
        return True

    runner = AgentRunner()
    runner.session = _DummySession()
    cast(Any, runner)._resolve_pending_approval = _no_approval
    monkeypatch.setattr(
        query_error_resilience,
        "force_context_compaction",
        _force_compact,
    )

    monkeypatch.setattr(runner_module, "QwenPawAgent", _DummyAgent)
    monkeypatch.setattr(runner_module, "build_env_context", lambda **kwargs: kwargs)
    monkeypatch.setattr(
        runner_module,
        "load_agent_config",
        lambda _agent_id: _fake_agent_config(),
    )
    monkeypatch.setattr(
        runner_module,
        "_stream_printing_messages_interruptible",
        _stream_with_one_overflow,
    )

    msgs = [
        Msg(
            name="user",
            role="user",
            content=[TextBlock(type="text", text="继续")],
        ),
    ]
    request = cast(
        AgentRequest,
        SimpleNamespace(
            session_id="session-1",
            user_id="user-1",
            channel="console",
        ),
    )

    results = []
    stream = cast(
        AsyncIterator[tuple[Msg, bool]],
        cast(Any, runner).query_handler(msgs, request=request),
    )
    async for msg, last in stream:
        results.append((msg, last))

    assert len(results) == 1
    assert cast(str, results[0][0].get_text_content() or "") == "ok"
    assert results[0][1] is True
    assert compact_calls["count"] == 1
    assert state["calls"] == 2


async def test_query_handler_context_overflow_returns_friendly_msg(
    monkeypatch,
) -> None:
    from qwenpaw.app.runner import runner as runner_module

    async def _no_approval(session_id: str, query: str | None):
        _ = session_id, query
        return None, False, None

    async def _always_overflow_stream(*args, **kwargs):
        _ = args, kwargs
        raise RuntimeError("APIError: Context size has been exceeded")
        yield  # pragma: no cover

    async def _compact_fail(_agent):
        return False

    runner = AgentRunner()
    runner.session = _DummySession()
    cast(Any, runner)._resolve_pending_approval = _no_approval
    cast(Any, runner)._force_context_compaction = _compact_fail

    monkeypatch.setattr(runner_module, "QwenPawAgent", _DummyAgent)
    monkeypatch.setattr(runner_module, "build_env_context", lambda **kwargs: kwargs)
    monkeypatch.setattr(
        runner_module,
        "load_agent_config",
        lambda _agent_id: _fake_agent_config(),
    )
    monkeypatch.setattr(
        runner_module,
        "_stream_printing_messages_interruptible",
        _always_overflow_stream,
    )
    monkeypatch.setattr(
        runner_module,
        "write_query_error_dump",
        lambda **kwargs: "/tmp/copaw_query_error_overflow.json",
    )

    msgs = [
        Msg(
            name="user",
            role="user",
            content=[TextBlock(type="text", text="继续")],
        ),
    ]
    request = cast(
        AgentRequest,
        SimpleNamespace(
            session_id="session-1",
            user_id="user-1",
            channel="console",
        ),
    )

    results = []
    stream = cast(
        AsyncIterator[tuple[Msg, bool]],
        cast(Any, runner).query_handler(msgs, request=request),
    )
    async for msg, last in stream:
        results.append((msg, last))

    assert len(results) == 1
    msg, last = results[0]
    text = cast(str, msg.get_text_content() or "")
    assert last is True
    assert "上下文窗口已满" in text
    assert "/compact" in text
    assert "copaw_query_error_overflow.json" in text


async def test_query_handler_tool_call_parse_error_gets_friendly_msg(
    monkeypatch,
) -> None:
    from qwenpaw.app.runner import runner as runner_module

    async def _no_approval(session_id: str, query: str | None):
        _ = session_id, query
        return None, False, None

    async def _failing_stream(*args, **kwargs):
        _ = args, kwargs
        raise RuntimeError(
            "Failed to parse input, parameters cannot be extracted: "
            'the model emitted an XML-style tool_call payload"',
        )
        yield  # pragma: no cover

    runner = AgentRunner()
    runner.session = _DummySession()
    cast(Any, runner)._resolve_pending_approval = _no_approval

    monkeypatch.setattr(runner_module, "QwenPawAgent", _DummyAgent)
    monkeypatch.setattr(
        runner_module, "build_env_context", lambda **kwargs: kwargs
    )
    monkeypatch.setattr(
        runner_module,
        "load_agent_config",
        lambda _agent_id: _fake_agent_config(),
    )
    monkeypatch.setattr(
        runner_module,
        "_stream_printing_messages_interruptible",
        _failing_stream,
    )
    monkeypatch.setattr(
        runner_module,
        "write_query_error_dump",
        lambda **kwargs: "/tmp/copaw_query_error_parse.json",
    )

    msgs = [
        Msg(
            name="user",
            role="user",
            content=[TextBlock(type="text", text="继续")],
        ),
    ]
    request = cast(
        AgentRequest,
        SimpleNamespace(
            session_id="session-1",
            user_id="user-1",
            channel="console",
        ),
    )

    results = []
    stream = cast(
        AsyncIterator[tuple[Msg, bool]],
        cast(Any, runner).query_handler(msgs, request=request),
    )
    async for msg, last in stream:
        results.append((msg, last))

    assert len(results) == 1
    msg, last = results[0]
    text = cast(str, msg.get_text_content() or "")
    assert last is True
    assert "不接受工具调用格式" in text
    assert "copaw_query_error_parse.json" in text
