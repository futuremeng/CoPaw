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
            active_model=providers_router_module.ModelSlotConfig(
                provider_id="custom",
                model="model-a",
            ),
        ),
    )

    manager = MagicMock()
    manager.get_active_model.return_value = providers_router_module.ModelSlotConfig(
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


def test_set_active_model_agent_scope_uses_agent_context(monkeypatch):
    app = FastAPI()
    app.include_router(providers_router_module.router)

    async def _fake_get_agent_for_request(request, agent_id=None):
        _ = request
        return SimpleNamespace(agent_id=agent_id or "default")

    monkeypatch.setattr(
        providers_router_module,
        "get_agent_for_request",
        _fake_get_agent_for_request,
    )

    monkeypatch.setattr(
        providers_router_module,
        "load_agent_config",
        lambda agent_id: SimpleNamespace(agent_id=agent_id, active_model=None),
    )

    saved = {}

    def _fake_save_agent_config(agent_id, config):
        saved["agent_id"] = agent_id
        saved["config"] = config

    monkeypatch.setattr(
        providers_router_module,
        "save_agent_config",
        _fake_save_agent_config,
    )

    scheduled = {}

    def _fake_schedule_agent_reload(request, agent_id):
        _ = request
        scheduled["agent_id"] = agent_id

    monkeypatch.setattr(
        providers_router_module,
        "schedule_agent_reload",
        _fake_schedule_agent_reload,
    )

    manager = MagicMock()
    manager.get_provider.return_value = SimpleNamespace(
        has_model=lambda model_id: True,
        support_connection_check=False,
    )
    manager.maybe_probe_multimodal.return_value = None
    app.state.provider_manager = manager

    client = TestClient(app)
    response = client.put(
        "/models/active",
        json={
            "provider_id": "dashscope",
            "model": "qwen-plus",
            "scope": "agent",
            "agent_id": "agent-a",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["active_llm"] == {
        "provider_id": "dashscope",
        "model": "qwen-plus",
    }
    assert saved["agent_id"] == "agent-a"
    assert saved["config"].active_model.provider_id == "dashscope"
    assert saved["config"].active_model.model == "qwen-plus"
    assert scheduled["agent_id"] == "agent-a"
    manager.maybe_probe_multimodal.assert_called_once_with(
        "dashscope",
        "qwen-plus",
    )