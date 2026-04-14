# -*- coding: utf-8 -*-

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from copaw.app.routers import tools as tools_router_module
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
        "copaw.app.agent_context.get_agent_for_request",
        _mock_get_agent_for_request,
    )
    monkeypatch.setattr(
        "copaw.config.config.load_agent_config",
        _mock_load_agent_config,
    )
    monkeypatch.setattr(
        "copaw.config.config.save_agent_config",
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


def test_list_tools_falls_back_to_default_icon_for_missing_config(
    tools_api_client: tuple[TestClient, AgentProfileConfig],
) -> None:
    client, _agent_config = tools_api_client

    response = client.get("/tools")

    assert response.status_code == 200
    payload = response.json()
    search_tool = next(
        item for item in payload if item["name"] == "skill_market_search"
    )
    assert search_tool["icon"] == "🔧"


def test_toggle_tool_returns_default_icon_when_config_icon_is_missing(
    tools_api_client: tuple[TestClient, AgentProfileConfig],
) -> None:
    client, agent_config = tools_api_client

    response = client.patch("/tools/skill_market_search/toggle")

    assert response.status_code == 200
    assert response.json()["icon"] == "🔧"
    assert agent_config.tools is not None
    assert agent_config.tools.builtin_tools["skill_market_search"].enabled is False


def test_update_async_execution_returns_default_icon_when_missing(
    tools_api_client: tuple[TestClient, AgentProfileConfig],
) -> None:
    client, agent_config = tools_api_client

    response = client.patch(
        "/tools/execute_shell_command/async-execution",
        json={"async_execution": True},
    )

    assert response.status_code == 200
    assert response.json()["icon"] == "💻"
    assert agent_config.tools is not None
    assert (
        agent_config.tools.builtin_tools[
            "execute_shell_command"
        ].async_execution is True
    )


def test_update_async_execution_returns_default_icon_for_missing_icon(
    tools_api_client: tuple[TestClient, AgentProfileConfig],
) -> None:
    client, agent_config = tools_api_client

    response = client.patch(
        "/tools/skill_market_search/async-execution",
        json={"async_execution": True},
    )

    assert response.status_code == 200
    assert response.json()["icon"] == "🔧"
    assert agent_config.tools is not None
    assert agent_config.tools.builtin_tools["skill_market_search"].async_execution is True
