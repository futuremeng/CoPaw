# -*- coding: utf-8 -*-
"""Query-error resilience for the chat runner.

The fork shipped this behaviour on top of the runner's error path before an
upstream sync dropped it.  Transient provider failures, transport errors, MCP
connectivity noise, rejected tool-call formats and context overflow each end
the turn with a readable bilingual chat message (or silently, for MCP noise)
instead of surfacing as an unknown-agent failure.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from agentscope.message import Msg, TextBlock

from ...constant import LLM_MAX_RETRIES

_TRANSIENT_UPSTREAM_STATUS_CODES = {429, 500, 502, 503, 504}

_RETRYABLE_STATUS_PATTERN = re.compile(
    r"(?:error\s*code|status)\s*[:=]?\s*(\d{3})",
    re.IGNORECASE,
)

_CONTEXT_OVERFLOW_PATTERNS = (
    "context size has been exceeded",
    "maximum context length",
    "max context length",
    "context_length_exceeded",
    "context window",
    "too many tokens",
    "input is too long",
)

_TRANSIENT_ERROR_CLASS_NAMES = frozenset(
    {
        "InternalServerError",
        "RateLimitError",
        "APITimeoutError",
        "APIConnectionError",
        "ServiceUnavailableError",
        "OverloadedError",
    },
)

_TRANSPORT_ERROR_NAMES = frozenset(
    {
        "TransportError",
        "ReadError",
        "ReadTimeout",
        "ConnectError",
        "ConnectTimeout",
        "RemoteProtocolError",
    },
)

_TRANSPORT_ERROR_MARKERS = (
    "peer closed connection",
    "incomplete chunked read",
    "server disconnected",
    "connection reset",
    "broken pipe",
)

_MCP_ERROR_MARKERS = (
    "not connected",
    "connect() method first",
    "session terminated",
    "closed resource",
    "closedresourceerror",
)

# Markers naming an XML-style tool call the provider refused to parse.
_TOOL_CALL_PARSE_MARKERS = ("tool_call", "function=", "parameter=")


def iter_exception_chain(exc: BaseException):
    """Yield the exception plus its chained causes/contexts exactly once."""
    seen: set[int] = set()
    current: Optional[BaseException] = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current
        current = (
            current.__cause__
            if current.__cause__ is not None
            else current.__context__
        )


def extract_status_code(exc: BaseException) -> Optional[int]:
    """Read an HTTP status code off a provider exception, if it carries one."""
    for item in iter_exception_chain(exc):
        status = getattr(item, "status_code", None)
        if isinstance(status, int):
            return status
        response = getattr(item, "response", None)
        response_status = getattr(response, "status_code", None)
        if isinstance(response_status, int):
            return response_status
    return None


def extract_status_code_from_message(exc: BaseException) -> Optional[int]:
    """Recover a status code that the provider only wrote into the text."""
    match = _RETRYABLE_STATUS_PATTERN.search(str(exc))
    if not match:
        return None
    try:
        return int(match.group(1))
    except (TypeError, ValueError):
        return None


def resolve_status_code(exc: BaseException) -> Optional[int]:
    """Read the status code off the exception, or out of its message."""
    status = extract_status_code(exc)
    if status is None:
        return extract_status_code_from_message(exc)
    return status


def is_transient_transport_error(exc: BaseException) -> bool:
    """Whether the failure is a retryable HTTP transport interruption."""
    for item in iter_exception_chain(exc):
        name = item.__class__.__name__
        module = item.__class__.__module__
        text = str(item).lower()
        if (
            module.startswith(("httpx", "httpcore"))
            and name in _TRANSPORT_ERROR_NAMES
        ):
            return True
        if name == "RemoteProtocolError" and any(
            marker in text for marker in _TRANSPORT_ERROR_MARKERS
        ):
            return True
    return False


def is_transient_upstream_error(exc: BaseException) -> bool:
    """Whether the failure comes from a temporarily sick model backend."""
    if resolve_status_code(exc) in _TRANSIENT_UPSTREAM_STATUS_CODES:
        return True
    if is_transient_transport_error(exc):
        return True
    # Some OpenAI-compatible providers answer a generic
    # "APIError: Compute error." without any HTTP status; treat it as
    # transient so the user gets a provider-failure hint instead of the
    # unknown-agent fallback.
    for item in iter_exception_chain(exc):
        if (
            item.__class__.__name__ == "APIError"
            and "compute error" in str(item).lower()
        ):
            return True
        if item.__class__.__name__ in _TRANSIENT_ERROR_CLASS_NAMES:
            return True
    return False


def is_tool_call_parse_input_error(exc: BaseException) -> bool:
    """Whether the provider rejected a malformed tool-call payload.

    Backends that do not support function calling refuse XML-style tool
    calls before producing a response; without a dedicated check those
    surface as unknown agent errors.
    """
    text = str(exc).lower()
    if "failed to parse input" not in text:
        return False
    return any(marker in text for marker in _TOOL_CALL_PARSE_MARKERS)


def is_mcp_connection_error(exc: BaseException) -> bool:
    """Whether the failure is MCP connectivity or session teardown noise."""
    for item in iter_exception_chain(exc):
        text = f"{item.__class__.__name__}: {item}".lower()
        if "mcp client is not connected to the server" in text:
            return True
        if "mcp" in text and any(
            marker in text for marker in _MCP_ERROR_MARKERS
        ):
            return True
    return False


def is_context_overflow_error(exc: BaseException) -> bool:
    """Whether the failure is a context-window overflow."""
    for item in iter_exception_chain(exc):
        text = f"{item.__class__.__name__}: {item}".lower()
        if any(pattern in text for pattern in _CONTEXT_OVERFLOW_PATTERNS):
            return True
    return False


def _detail_suffix(debug_dump_path: Optional[str]) -> str:
    if not debug_dump_path:
        return ""
    return f"\n(Details:  {debug_dump_path})"


def _build_msg(agent_name: str, text: str) -> Msg:
    return Msg(
        name=agent_name,
        role="assistant",
        content=[TextBlock(type="text", text=text)],
    )


@dataclass(frozen=True)
class QueryErrorDisposition:
    """How the runner should end the turn after raising ``exc``.

    ``suppress`` drops the error from the chat output entirely; ``message``
    replaces it with a user-readable turn; neither is set when the runner
    should keep its own failure handling.
    """

    kind: str
    message: Optional[Msg] = None
    suppress: bool = False


def classify_query_error(
    exc: Exception,
    *,
    agent_name: str,
    debug_dump_path: Optional[str] = None,
) -> QueryErrorDisposition:
    """Map a query failure onto the CoPaw chat-visible error policy."""
    detail = _detail_suffix(debug_dump_path)

    if is_mcp_connection_error(exc):
        return QueryErrorDisposition("mcp_connection", suppress=True)

    if is_transient_upstream_error(exc):
        status = resolve_status_code(exc)
        status_text = str(status) if status is not None else "unknown"
        text = (
            "⚠️ Model service is temporarily unavailable "
            f"(HTTP {status_text}). "
            f"Retried {LLM_MAX_RETRIES} times but still failed. "
            "Please try again shortly.\n"
            "⚠️ 模型服务暂时不可用"
            f"（HTTP {status_text}）。"
            f"已重试 {LLM_MAX_RETRIES} 次仍失败，"
            f"请稍后再试。{detail}"
        )
        return QueryErrorDisposition(
            "transient_upstream",
            message=_build_msg(agent_name, text),
        )

    if is_tool_call_parse_input_error(exc):
        text = (
            "⚠️ Model tool-call format is not accepted by the current "
            "provider/runtime. Please retry, or switch to a model/runtime "
            "with function-calling compatibility.\n"
            "⚠️ 当前模型/运行时不接受工具调用格式。"
            "请重试，或切换到支持 function calling 的模型/运行时。"
            f"{detail}"
        )
        return QueryErrorDisposition(
            "tool_call_parse",
            message=_build_msg(agent_name, text),
        )

    if is_context_overflow_error(exc):
        text = (
            "⚠️ Context window is full. Please run /compact (or start a "
            "new thread) and retry.\n"
            "⚠️ 上下文窗口已满。请执行 /compact（或新开对话）后重试。"
            f"{detail}"
        )
        return QueryErrorDisposition(
            "context_overflow",
            message=_build_msg(agent_name, text),
        )

    return QueryErrorDisposition("unhandled")
