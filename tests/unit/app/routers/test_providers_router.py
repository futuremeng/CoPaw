# -*- coding: utf-8 -*-

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
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

    async def _fake_update_agent_config(agent_id, mutator):
        agent_config = SimpleNamespace(
            agent_id=agent_id,
            active_model=None,
        )
        mutator(agent_config)
        saved["agent_id"] = agent_id
        saved["config"] = agent_config

    monkeypatch.setattr(
        providers_router_module,
        "update_agent_config_async",
        _fake_update_agent_config,
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
        get_model_info=lambda model_id: None,
        get_context_size=lambda model_id: None,
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


async def test_set_active_model_probes_checkable_provider_before_activating():
    """The fork probes before saving, so an unreachable model never lands.

    Upstream-owned activation cases declare the provider uncheckable, which
    makes the hook return early; this pins the other branch -- a provider that
    does advertise the connection check and answers that the model is gone.
    """
    manager = MagicMock()
    provider = MagicMock()
    provider.has_model.return_value = True
    provider.get_model_info.return_value = None
    provider.support_connection_check = True
    provider.check_model_connection = AsyncMock(
        return_value=(False, "model is gone"),
    )
    manager.get_provider.return_value = provider
    manager.activate_model = AsyncMock()

    with pytest.raises(HTTPException) as exc_info:
        await providers_router_module.set_active_model(
            request=MagicMock(),
            manager=manager,
            body=providers_router_module.ModelSlotRequest(
                provider_id="dashscope",
                model="qwen-plus",
                scope="global",
            ),
        )

    assert exc_info.value.status_code == 400
    assert "model is gone" in exc_info.value.detail
    provider.check_model_connection.assert_awaited_once_with(
        model_id="qwen-plus",
    )
    manager.activate_model.assert_not_called()