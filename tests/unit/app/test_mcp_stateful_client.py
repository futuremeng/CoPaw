# -*- coding: utf-8 -*-

from __future__ import annotations

import httpcore
import httpx

from copaw.app.mcp import stateful_client as stateful_client_module


def test_summarize_exception_chain_includes_nested_causes() -> None:
    root = httpcore.ReadError("socket closed")
    outer = httpx.ReadError("", request=httpx.Request("POST", "http://example.test/mcp"))
    outer.__cause__ = root

    summary = stateful_client_module._summarize_exception_chain(outer)

    assert "ReadError" in summary
    assert "socket closed" in summary
    assert "<-" in summary


def test_log_http_lifecycle_exception_for_status_error(monkeypatch) -> None:
    request = httpx.Request("POST", "http://example.test/mcp")
    response = httpx.Response(401, request=request)
    exc = httpx.HTTPStatusError("unauthorized", request=request, response=response)
    warnings: list[str] = []

    def fake_warning(message, *args, **kwargs):
        _ = kwargs
        warnings.append(message % args if args else message)

    monkeypatch.setattr(stateful_client_module.logger, "warning", fake_warning)
    retry_delay = stateful_client_module._log_http_lifecycle_exception(
        name="superset_mcp",
        transport="streamable_http",
        url="http://example.test/mcp",
        headers={"Authorization": "Bearer token"},
        exc=exc,
    )

    assert retry_delay == 15.0
    assert any("superset_mcp" in message for message in warnings)
    assert any("HTTP 401" in message for message in warnings)
    assert any("transport=streamable_http" in message for message in warnings)
    assert any(
        "Authorization header is configured but rejected" in message
        for message in warnings
    )


def test_log_http_lifecycle_exception_for_read_error(monkeypatch) -> None:
    request = httpx.Request("POST", "http://example.test/mcp")
    exc = httpx.ReadError("", request=request)
    exc.__cause__ = httpcore.ReadError("connection dropped")
    warnings: list[str] = []

    def fake_warning(message, *args, **kwargs):
        _ = kwargs
        warnings.append(message % args if args else message)

    monkeypatch.setattr(stateful_client_module.logger, "warning", fake_warning)
    retry_delay = stateful_client_module._log_http_lifecycle_exception(
        name="superset_mcp",
        transport="streamable_http",
        url="http://example.test/mcp",
        headers={"Authorization": "Bearer token"},
        exc=exc,
    )

    assert retry_delay == 2.0
    assert any(
        "MCP HTTP transport error for superset_mcp" in message
        for message in warnings
    )
    assert any("http://example.test/mcp" in message for message in warnings)
    assert any("connection dropped" in message for message in warnings)