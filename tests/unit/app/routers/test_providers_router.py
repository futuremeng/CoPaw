# -*- coding: utf-8 -*-

from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from qwenpaw.app.routers import providers as providers_router_module


def test_get_active_models_effective_uses_agent_config_without_workspace(monkeypatch):
    app = FastAPI()
    app.include_router(providers_router_module.router)

    monkeypatch.setattr(
        providers_router_module,
        "resolve_agent_id_for_request",
        lambda request: "default",
    )
    monkeypatch.setattr(
        providers_router_module,
        "load_agent_config",
        lambda agent_id: SimpleNamespace(
            active_model=SimpleNamespace(
                provider_id="custom",
                model="model-a",
            ),
        ),
    )

    manager = MagicMock()
    manager.get_active_model.return_value = SimpleNamespace(
        provider_id="global",
        model="model-global",
    )
    app.state.provider_manager = manager

    workspace_manager = MagicMock()
    workspace_manager.get_agent.side_effect = AssertionError(
        "workspace should not start",
    )
    app.state.multi_agent_manager = workspace_manager

    client = TestClient(app)
    response = client.get("/models/active?scope=effective")

    assert response.status_code == 200
    payload = response.json()
    assert payload["active_llm"] == {
        "provider_id": "custom",
        "model": "model-a",
    }
    workspace_manager.get_agent.assert_not_called()