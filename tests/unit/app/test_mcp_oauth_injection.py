# -*- coding: utf-8 -*-

from __future__ import annotations

import time

from qwenpaw.app.mcp.manager import MCPClientManager
from qwenpaw.config.config import MCPClientConfig, MCPOAuthConfig


def _remote_client_config(
    *,
    headers: dict | None = None,
    access_token: str = "token-from-oauth-flow",
    expires_at: float | None = None,
) -> MCPClientConfig:
    if expires_at is None:
        expires_at = time.time() + 3600
    return MCPClientConfig(
        name="remote-mcp",
        transport="streamable_http",
        url="https://mcp.example.test/mcp",
        headers=headers or {},
        oauth=MCPOAuthConfig(
            access_token=access_token,
            expires_at=expires_at,
        ),
    )


def test_oauth_token_reaches_http_client_headers_with_no_manual_headers():
    """An OAuth-only remote server has empty headers, so injection must not
    depend on a non-empty header dict."""
    client = MCPClientManager._build_client(_remote_client_config())

    assert client.headers == {"Authorization": "Bearer token-from-oauth-flow"}


def test_oauth_token_overrides_manually_set_authorization():
    config = _remote_client_config(headers={"Authorization": "Bearer manual"})
    client = MCPClientManager._build_client(config)

    assert client.headers["Authorization"] == "Bearer token-from-oauth-flow"
    # The stored config must not be mutated while building the client.
    assert config.headers == {"Authorization": "Bearer manual"}


def test_expired_oauth_token_is_not_injected():
    config = _remote_client_config(
        headers={"X-Tenant": "acme"},
        expires_at=time.time() - 1,
    )
    client = MCPClientManager._build_client(config)

    assert client.headers == {"X-Tenant": "acme"}


def test_header_env_expansion_survives_oauth_injection(monkeypatch):
    monkeypatch.setenv("QWENPAW_TEST_MCP_TENANT", "acme")
    config = _remote_client_config(
        headers={"X-Tenant": "$QWENPAW_TEST_MCP_TENANT"},
    )
    client = MCPClientManager._build_client(config)

    assert client.headers == {
        "X-Tenant": "acme",
        "Authorization": "Bearer token-from-oauth-flow",
    }
