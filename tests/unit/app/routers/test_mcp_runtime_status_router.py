# -*- coding: utf-8 -*-
"""Console "probe statuses" needs POST /mcp/{client_key}/refresh-status.

The route is fork-owned. Upstream 2.x replaced the MCP client manager with the
Driver layer, so the probe runs through ``DriverManager.refresh_driver`` and
reports ``DriverRuntimeInfo.status == "active"``.
"""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from qwenpaw.app.driver_config_service import DriverConfigService
from qwenpaw.drivers.capabilities import DriverRuntimeInfo
from qwenpaw.drivers.constants import PROTOCOL_MCP
from qwenpaw.drivers.contracts import DriverCard
from qwenpaw.drivers.storage import dump_card

CLIENT_KEY = "demo"
MCP_URL = "https://mcp.example.com/coop/mcp"


class _DriverManagerStub:
    """Stands in for ``DriverManager``; records which key was probed."""

    def __init__(self, status: str) -> None:
        self.status = status
        self.calls: list[str] = []

    async def refresh_driver(self, name: str) -> DriverRuntimeInfo:
        self.calls.append(name)
        return DriverRuntimeInfo(
            name=name,
            protocol=PROTOCOL_MCP,
            enabled=True,
            status=self.status,
        )


class _WorkspaceStub:
    """Minimal workspace: a real temp dir holding one DriverCard."""

    def __init__(self, root: Path, manager: object) -> None:
        self.workspace_dir = root
        self.driver_manager = manager


def _seed_card(workspace: _WorkspaceStub) -> None:
    config = DriverConfigService(workspace)
    dump_card(
        DriverCard(
            name=CLIENT_KEY,
            protocol=PROTOCOL_MCP,
            endpoint={"url": MCP_URL, "transport": "sse"},
        ),
        config.card_path(CLIENT_KEY, protocol=PROTOCOL_MCP),
    )


@pytest.fixture
def client_factory(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> callable:
    from qwenpaw.app.routers.mcp_runtime_status import router

    def _build(
        manager: object,
        *,
        seed: bool = True,
    ) -> TestClient:
        workspace = _WorkspaceStub(tmp_path, manager)
        if seed:
            _seed_card(workspace)

        async def _mock_get_agent_for_request(_request):
            return workspace

        monkeypatch.setattr(
            "qwenpaw.app.agent_context.get_agent_for_request",
            _mock_get_agent_for_request,
        )
        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    return _build


def test_refresh_route_probes_and_reports_active(client_factory) -> None:
    manager = _DriverManagerStub(status="active")
    client = client_factory(manager)

    response = client.post(f"/mcp/{CLIENT_KEY}/refresh-status")

    assert response.status_code == 200
    assert manager.calls == [CLIENT_KEY]
    body = response.json()
    assert body["key"] == CLIENT_KEY
    assert body["active"] is True


def test_refresh_route_reports_dropped_client(client_factory) -> None:
    client = client_factory(_DriverManagerStub(status="inactive"))

    response = client.post(f"/mcp/{CLIENT_KEY}/refresh-status")

    assert response.status_code == 200
    assert response.json()["active"] is False


def test_refresh_route_404_for_unknown_key(client_factory) -> None:
    client = client_factory(_DriverManagerStub(status="active"), seed=False)

    assert client.post("/mcp/nope/refresh-status").status_code == 404


def test_refresh_route_503_without_manager(client_factory) -> None:
    client = client_factory(None)

    assert client.post(f"/mcp/{CLIENT_KEY}/refresh-status").status_code == 503


def _route_pairs(routes) -> set:
    """Flatten a router tree to (path, method) pairs.

    Newer FastAPI keeps an included router as a lazy wrapper instead of
    flattening it into APIRoute objects, so the walk has to follow it.
    """
    pairs = set()
    stack = list(routes)
    while stack:
        route = stack.pop()
        path = getattr(route, "path", None)
        methods = getattr(route, "methods", None)
        if path and methods:
            pairs.update((path, method) for method in methods)
        for nested in ("routes", "original_router"):
            child = getattr(route, nested, None)
            if child is not None:
                stack.extend(getattr(child, "routes", None) or [])
    return pairs


def test_refresh_route_registered_on_shared_router() -> None:
    """Guards the registration itself: the defect was a half-landed feature."""
    from qwenpaw.app.routers import router as shared_router

    assert (
        "/mcp/{client_key:path}/refresh-status",
        "POST",
    ) in _route_pairs(shared_router.routes)
