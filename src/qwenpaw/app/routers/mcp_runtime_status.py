# -*- coding: utf-8 -*-
"""Runtime-status probe route for MCP clients.

Lives outside ``mcp.py`` on purpose: the console's "probe statuses" action
needs a POST endpoint that upstream never had, and adding it there would pin
the whole upstream router file onto the conflict surface.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Path, Request
from pydantic import Field

from ..mcp.config_service import MCPConfigService
from ..mcp.schemas import MCPClientInfo

router = APIRouter(prefix="/mcp", tags=["mcp-runtime-status"])


class MCPRuntimeStatusInfo(MCPClientInfo):
    """MCP client config plus the live connection flag the console renders."""

    active: bool = Field(
        ...,
        description="Whether the client is connected right now",
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
    """Probe one MCP client, reloading it when its saved card changed.

    Raises:
        HTTPException: 503 when the agent has no driver manager attached yet,
            404 when the key has no saved card.
    """
    from ..agent_context import get_agent_for_request

    agent = await get_agent_for_request(request)
    manager = getattr(agent, "driver_manager", None)
    if manager is None:
        raise HTTPException(503, detail="MCP manager is unavailable")

    service = MCPConfigService(agent)
    card = await service.load_card(client_key)
    runtime = await manager.refresh_driver(client_key)
    info = await service.build_info_from_card(card)
    return MCPRuntimeStatusInfo(
        **info.model_dump(),
        active=runtime is not None and runtime.status == "active",
    )
