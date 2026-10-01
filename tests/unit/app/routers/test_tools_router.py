# -*- coding: utf-8 -*-

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from qwenpaw.app.routers import tools as tools_router_module
from copaw.config.config import (
    AgentProfileConfig,
    BuiltinToolConfig,
    ToolsConfig,
)


@pytest.fixture
def tools_api_client(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[TestClient, AgentProfileConfig]:
    agent_config = AgentProfileConfig(
        id="default",
        name="Default Agent",
        workspace_dir="/tmp/default",
        tools=ToolsConfig(
            builtin_tools={
                "skill_market_search": BuiltinToolConfig(
                    name="skill_market_search",
                    enabled=True,
                    description=(
                        "Search enabled skill markets for installable skills"
                    ),
                ),
                "execute_shell_command": BuiltinToolConfig(
                    name="execute_shell_command",
                    enabled=True,
                    description="Execute shell commands",
                    async_execution=False,
                    icon="💻",
                ),
            },
        ),
    )
    assert agent_config.tools is not None
    agent_config.tools.builtin_tools["skill_market_search"].icon = None

    async def _mock_get_agent_for_request(_request):
        return SimpleNamespace(agent_id="default", workspace_dir="/tmp/default")

    def _mock_load_agent_config(_agent_id: str) -> AgentProfileConfig:
        return agent_config

    def _mock_save_agent_config(_agent_id: str, config: AgentProfileConfig) -> None:
        nonlocal agent_config
        agent_config = config

    monkeypatch.setattr(
        "qwenpaw.app.agent_context.get_agent_for_request",
        _mock_get_agent_for_request,
    )
    monkeypatch.setattr(
        "qwenpaw.config.config.load_agent_config",
        _mock_load_agent_config,
    )
    monkeypatch.setattr(
        "qwenpaw.config.config.save_agent_config",
        _mock_save_agent_config,
    )
    monkeypatch.setattr(
        tools_router_module,
        "schedule_agent_reload",
        lambda *_args, **_kwargs: None,
    )

    app = FastAPI()
    app.include_router(tools_router_module.router)
    return TestClient(app), agent_config


def test_list_tools_falls_back_to_empty_icon_for_missing_config(
    tools_api_client: tuple[TestClient, AgentProfileConfig],
) -> None:
    client, _agent_config = tools_api_client

    response = client.get("/tools")

    assert response.status_code == 200
    payload = response.json()
    search_tool = next(
        item for item in payload if item["name"] == "skill_market_search"
    )
    assert search_tool["icon"] == ""


def test_toggle_tool_returns_empty_icon_when_config_icon_is_missing(
    tools_api_client: tuple[TestClient, AgentProfileConfig],
) -> None:
    client, agent_config = tools_api_client

    response = client.patch("/tools/skill_market_search/toggle")

    assert response.status_code == 200
    assert response.json()["icon"] == ""
    assert agent_config.tools is not None
    assert (
        agent_config.tools.builtin_tools["skill_market_search"].enabled
        is False
    )


def test_update_async_execution_returns_the_configured_icon(
    tools_api_client: tuple[TestClient, AgentProfileConfig],
) -> None:
    client, agent_config = tools_api_client

    response = client.patch(
        "/tools/execute_shell_command/async-execution",
        json={"async_execution": True},
    )

    assert response.status_code == 200
    assert response.json()["icon"] == "\U0001F4BB"
    assert agent_config.tools is not None
    assert (
        agent_config.tools.builtin_tools[
            "execute_shell_command"
        ].async_execution is True
    )


class _FakePluginRegistry:
    """Stand in for the plugin manifest source used by _build_tool_info."""

    _manifest = {
        "meta": {
            "tools": [
                {
                    "name": "skill_market_search",
                    "requires_config": True,
                    "config_fields": [
                        {
                            "name": "api_key",
                            "label": "API key",
                            "type": "password",
                        },
                    ],
                },
            ],
        },
    }

    def get_plugin_id_for_tool(self, tool_name: str) -> str | None:
        if tool_name == "skill_market_search":
            return "skill_market"
        return None

    def get_plugin_manifest(self, plugin_id: str) -> dict | None:
        if plugin_id == "skill_market":
            return dict(self._manifest)
        return None


def _patch_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "qwenpaw.plugins.registry.PluginRegistry",
        _FakePluginRegistry,
    )


def test_toggle_tool_returns_manifest_config_metadata(
    tools_api_client: tuple[TestClient, AgentProfileConfig],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, agent_config = tools_api_client
    assert agent_config.tools is not None
    agent_config.tools.builtin_tools["skill_market_search"].config = {
        "api_key": "secret-value",
    }
    _patch_registry(monkeypatch)

    response = client.patch("/tools/skill_market_search/toggle")

    assert response.status_code == 200
    payload = response.json()
    assert payload["requires_config"] is True
    assert [field["name"] for field in payload["config_fields"]] == ["api_key"]
    assert payload["config_values"] == {"api_key": "***"}


def test_update_async_execution_returns_manifest_config_metadata(
    tools_api_client: tuple[TestClient, AgentProfileConfig],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, _agent_config = tools_api_client
    _patch_registry(monkeypatch)

    response = client.patch(
        "/tools/skill_market_search/async-execution",
        json={"async_execution": True},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["requires_config"] is True
    assert [field["name"] for field in payload["config_fields"]] == ["api_key"]
