# -*- coding: utf-8 -*-
"""Console "probe statuses" needs POST /mcp/{client_key}/refresh-status.

The manager method and the UI call site both landed on trunk, but the route
only ever existed on feat/upstream/mcp-runtime-status-v2, so every click was a
swallowed 404 behind a success toast.
"""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from qwenpaw.config.config import MCPClientConfig


class _FakeManager:
    def __init__(self, active: bool) -> None:
        self.active = active
        self.calls: list[str] = []

    async def refresh_client_status(self, key, _config, timeout: float = 15.0):
        self.calls.append(key)
        return self.active

    def is_active(self, key: str) -> bool:
        return self.active


def _agent(manager) -> SimpleNamespace:
    config = MCPClientConfig(
        name="Demo",
        transport="streamable_http",
        url="http://demo.invalid/mcp",
    )
    return SimpleNamespace(
        config=SimpleNamespace(mcp=SimpleNamespace(clients={"demo": config})),
        mcp_manager=manager,
    )


@pytest.fixture
def client_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> callable:
    from qwenpaw.app.routers.mcp_runtime_status import router

    def _build(agent) -> TestClient:
        async def _mock_get_agent_for_request(_request):
            return agent

        monkeypatch.setattr(
            "qwenpaw.app.agent_context.get_agent_for_request",
            _mock_get_agent_for_request,
        )
        app = FastAPI()
        app.include_router(router)
        return TestClient(app)

    return _build


def test_refresh_route_probes_and_reports_active(client_factory) -> None:
    manager = _FakeManager(active=True)
    client = client_factory(_agent(manager))

    response = client.post("/mcp/demo/refresh-status")

    assert response.status_code == 200
    assert manager.calls == ["demo"]
    body = response.json()
    assert body["key"] == "demo"
    assert body["active"] is True


def test_refresh_route_reports_dropped_client(client_factory) -> None:
    client = client_factory(_agent(_FakeManager(active=False)))

    response = client.post("/mcp/demo/refresh-status")

    assert response.status_code == 200
    assert response.json()["active"] is False


def test_refresh_route_404_for_unknown_key(client_factory) -> None:
    client = client_factory(_agent(_FakeManager(active=True)))

    assert client.post("/mcp/nope/refresh-status").status_code == 404


def test_refresh_route_503_without_manager(client_factory) -> None:
    client = client_factory(_agent(None))

    assert client.post("/mcp/demo/refresh-status").status_code == 503


def test_refresh_route_registered_on_shared_router() -> None:
    """Guards the registration itself: the defect was a half-landed feature."""
    from qwenpaw.app.routers import router as shared_router

    paths = {
        (route.path, method)
        for route in shared_router.routes
        for method in getattr(route, "methods", ())
    }
    assert ("/mcp/{client_key:path}/refresh-status", "POST") in paths
