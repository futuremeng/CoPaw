# -*- coding: utf-8 -*-

from __future__ import annotations

import builtins

import httpcore
import httpx

from qwenpaw.app.mcp import stateful_client as stateful_client_module


def _group_of(*exceptions: BaseException) -> BaseException:
    """Build a grouped exception the way anyio and mcp raise one.

    ``ExceptionGroup`` is a builtin from Python 3.11; on 3.10 the groups that
    reach this code come from anyio's ``exceptiongroup`` dependency instead.
    """
    group_type = getattr(builtins, "ExceptionGroup", None)
    if group_type is None:
        import exceptiongroup

        group_type = exceptiongroup.ExceptionGroup

    return group_type("mcp lifecycle failure", list(exceptions))


def test_summarize_exception_chain_includes_nested_causes() -> None:
    request = httpx.Request("GET", "http://example.test/mcp")
    root = httpcore.ReadError("socket closed")
    outer = httpx.ReadError("", request=request)
    outer.__cause__ = root

    summary = stateful_client_module._summarize_exception_chain(outer)

    assert "ReadError" in summary
    assert "socket closed" in summary
    assert "<-" in summary


def test_iter_leaf_exceptions_yields_a_plain_exception() -> None:
    exc = httpx.ReadError("connection dropped")

    assert list(stateful_client_module._iter_leaf_exceptions(exc)) == [exc]


def test_iter_leaf_exceptions_unwraps_nested_groups() -> None:
    first = httpx.ReadError("first")
    second = httpcore.ReadError("second")

    leaves = list(stateful_client_module._iter_leaf_exceptions(
        _group_of(first, _group_of(second)),
    ))

    assert leaves == [first, second]


def test_extract_http_status_error_finds_nested_group_member() -> None:
    request = httpx.Request("POST", "http://example.test/mcp")
    status_error = httpx.HTTPStatusError(
        "unauthorized",
        request=request,
        response=httpx.Response(401, request=request),
    )
    dropped = httpx.ReadError("dropped", request=request)

    exc = _group_of(dropped, _group_of(status_error))

    assert (
        stateful_client_module._extract_http_status_error(exc) is status_error
    )
    assert (
        stateful_client_module._extract_request_url(exc) == str(request.url)
    )


def test_log_http_lifecycle_exception_for_status_error(monkeypatch) -> None:
    request = httpx.Request("POST", "http://example.test/mcp")
    response = httpx.Response(401, request=request)
    exc = httpx.HTTPStatusError(
        "unauthorized",
        request=request,
        response=response,
    )
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


def test_log_http_lifecycle_exception_for_grouped_status_error(
    monkeypatch,
) -> None:
    request = httpx.Request("POST", "http://example.test/mcp")
    status_error = httpx.HTTPStatusError(
        "server busy",
        request=request,
        response=httpx.Response(503, request=request),
    )
    warnings: list[str] = []

    def fake_warning(message, *args, **kwargs):
        _ = kwargs
        warnings.append(message % args if args else message)

    monkeypatch.setattr(stateful_client_module.logger, "warning", fake_warning)
    retry_delay = stateful_client_module._log_http_lifecycle_exception(
        name="superset_mcp",
        transport="streamable_http",
        url="http://example.test/mcp",
        headers={},
        exc=_group_of(status_error),
    )

    assert retry_delay == 5.0
    assert any("HTTP 503" in message for message in warnings)


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

    # Transport errors read no response, so no reconnect gets scheduled.
    assert retry_delay == 0.0
    assert any(
        "MCP HTTP transport error for superset_mcp" in message
        for message in warnings
    )
    assert any("http://example.test/mcp" in message for message in warnings)
    assert any("connection dropped" in message for message in warnings)
