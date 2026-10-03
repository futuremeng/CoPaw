# -*- coding: utf-8 -*-
"""Runtime-status probe route for MCP clients.

Lives outside ``mcp.py`` on purpose: the console's "probe statuses" action
needs a POST endpoint that upstream never had, and adding it there would pin
the whole upstream router file (which 2.x rewrites) onto the conflict surface.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Path, Request
from pydantic import Field

from ...config.config import MCPClientConfig
from .mcp import MCPClientInfo, _build_client_info

router = APIRouter(prefix="/mcp", tags=["mcp-runtime-status"])


class MCPRuntimeStatusInfo(MCPClientInfo):
    """MCP client config plus the live connection flag the console renders."""

    active: bool = Field(
        ...,
        description="Whether the client is connected right now",
    )


def _build_runtime_info(
    key: str,
    client: MCPClientConfig,
    active: bool,
) -> MCPRuntimeStatusInfo:
    return MCPRuntimeStatusInfo(
        **_build_client_info(key, client).model_dump(),
        active=active,
    )


@router.post(
    "/{client_key:path}/refresh-status",
    response_model=MCPRuntimeStatusInfo,
    summary="Refresh MCP client runtime status",
)
async def refresh_mcp_client_status(
    request: Request,
    client_key: str = Path(...),
) -> MCPRuntimeStatusInfo:
    """Probe one MCP client, reconnecting it when it is not connected.

    Raises:
        HTTPException: 404 when the key is unknown, 503 when the agent has
            no MCP manager attached yet.
    """
    from ..agent_context import get_agent_for_request

    agent = await get_agent_for_request(request)
    mcp_config = agent.config.mcp
    client = (mcp_config.clients or {}).get(client_key) if mcp_config else None
    if client is None:
        raise HTTPException(404, detail=f"MCP client '{client_key}' not found")

    manager = agent.mcp_manager
    if manager is None:
        raise HTTPException(503, detail="MCP manager is unavailable")

    await manager.refresh_client_status(client_key, client)
    return _build_runtime_info(
        client_key,
        client,
        manager.is_active(client_key),
    )
