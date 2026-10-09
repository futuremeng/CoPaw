# -*- coding: utf-8 -*-
"""Tests for non-blocking tool configuration routes."""

from __future__ import annotations

import asyncio
import threading
import time
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel, ValidationError
import pytest

import qwenpaw.app.agent_context as agent_context_module
import qwenpaw.app.routers.tools as tools_router_module
import qwenpaw.browser.runtime.managed_playwright as managed_playwright_module
import qwenpaw.plugins.registry as registry_module
from qwenpaw.app.routers.tools import (
    ToolConfigUpdate,
    get_tool_config,
    update_tool_config,
)
from qwenpaw.utils.io_utils import run_sync_io
from copaw.config.config import (
    AgentProfileConfig,
    BuiltinToolConfig,
    ToolsConfig,
)


def _agent_config(tool_name: str, config: dict) -> SimpleNamespace:
    """Build the minimal agent config needed by the route updater."""
    tool = SimpleNamespace(config=dict(config))
    tools = SimpleNamespace(builtin_tools={tool_name: tool})
    return SimpleNamespace(tools=tools)


def _patch_workspace(monkeypatch, agent_id: str = "default") -> None:
    async def get_agent_for_request(_request):
        return SimpleNamespace(agent_id=agent_id)

    monkeypatch.setattr(
        agent_context_module,
        "get_agent_for_request",
        get_agent_for_request,
    )
    monkeypatch.setattr(
        tools_router_module,
        "schedule_agent_reload",
        lambda _request, _agent_id: None,
    )


@pytest.mark.asyncio
async def test_browser_config_starts_download_on_event_loop(
    monkeypatch,
) -> None:
    """Browser download task creation must stay on the event loop."""
    _patch_workspace(monkeypatch)
    loop_thread = threading.get_ident()
    update_threads = []
    mutate_threads = []
    start_threads = []
    download_tasks = []
    agent_config = _agent_config("browser", {})
    registry = SimpleNamespace(
        get_plugin_id_for_tool=lambda _tool_name: None,
    )
    application_config = SimpleNamespace(
        browser=SimpleNamespace(experimental=False),
    )

    async def update_config(_agent_id, updater):
        def update_sync():
            update_threads.append(threading.get_ident())
            updater(agent_config)
            return agent_config

        return await run_sync_io(update_sync)

    def mutate_config(mutator):
        mutate_threads.append(threading.get_ident())
        mutator(application_config)
        return application_config

    def start_download():
        start_threads.append(threading.get_ident())
        asyncio.get_running_loop()
        task = asyncio.create_task(asyncio.sleep(0))
        download_tasks.append(task)
        return False, ""

    monkeypatch.setattr(registry_module, "PluginRegistry", lambda: registry)
    monkeypatch.setattr(
        tools_router_module,
        "update_agent_config_async",
        update_config,
    )
    monkeypatch.setattr(tools_router_module, "mutate_config", mutate_config)
    monkeypatch.setattr(
        managed_playwright_module,
        "start_managed_chromium_download",
        start_download,
    )

    response = await update_tool_config(
        tool_name="browser",
        body=ToolConfigUpdate(config={"experimental": True}),
        request=SimpleNamespace(),
    )
    await download_tasks[0]

    assert response["status"] == "success"
    assert agent_config.tools.builtin_tools["browser"].config == {
        "experimental": True,
    }
    assert application_config.browser.experimental is True
    assert update_threads and update_threads[0] != loop_thread
    assert mutate_threads and mutate_threads[0] != loop_thread
    assert start_threads == [loop_thread]


@pytest.mark.asyncio
async def test_update_tool_config_preserves_password_off_event_loop(
    monkeypatch,
) -> None:
    """The locked worker transaction must retain masked passwords."""
    _patch_workspace(monkeypatch)
    loop_thread = threading.get_ident()
    update_threads = []
    agent_config = _agent_config(
        "secret_tool",
        {"token": "stored-secret", "region": "old"},
    )
    registry = SimpleNamespace(
        get_plugin_id_for_tool=lambda _tool_name: "secret-plugin",
        get_plugin_manifest=lambda _plugin_id: {
            "meta": {
                "tools": [
                    {
                        "name": "secret_tool",
                        "config_fields": [
                            {"name": "token", "type": "password"},
                        ],
                    },
                ],
            },
        },
        get_tool_config=MagicMock(
            side_effect=AssertionError("synchronous read used"),
        ),
        set_tool_config=MagicMock(
            side_effect=AssertionError("synchronous write used"),
        ),
    )

    async def update_config(_agent_id, updater):
        def update_sync():
            update_threads.append(threading.get_ident())
            time.sleep(0.1)
            updater(agent_config)
            return agent_config

        return await run_sync_io(update_sync)

    monkeypatch.setattr(registry_module, "PluginRegistry", lambda: registry)
    monkeypatch.setattr(
        tools_router_module,
        "update_agent_config_async",
        update_config,
    )

    update_task = asyncio.create_task(
        update_tool_config(
            tool_name="secret_tool",
            body=ToolConfigUpdate(
                config={"token": "***", "region": "new"},
            ),
            request=SimpleNamespace(),
        ),
    )
    await asyncio.sleep(0.02)

    assert update_task.done() is False
    response = await update_task
    saved = agent_config.tools.builtin_tools["secret_tool"].config
    assert response["status"] == "success"
    assert saved == {"token": "stored-secret", "region": "new"}
    assert update_threads and update_threads[0] != loop_thread
    registry.get_tool_config.assert_not_called()
    registry.set_tool_config.assert_not_called()


@pytest.mark.asyncio
async def test_get_tool_config_reads_off_event_loop(monkeypatch) -> None:
    """A slow tool config read must not block other coroutines."""
    _patch_workspace(monkeypatch)
    loop_thread = threading.get_ident()
    read_threads = []

    def read_config(_tool_name, _agent_id):
        read_threads.append(threading.get_ident())
        time.sleep(0.1)
        return {"region": "test"}

    registry = SimpleNamespace(
        get_tool_config=read_config,
        get_plugin_id_for_tool=lambda _tool_name: None,
    )
    monkeypatch.setattr(registry_module, "PluginRegistry", lambda: registry)

    read_task = asyncio.create_task(
        get_tool_config(
            tool_name="slow_tool",
            request=SimpleNamespace(),
        ),
    )
    await asyncio.sleep(0.02)

    assert read_task.done() is False
    assert await read_task == {"region": "test"}
    assert read_threads and read_threads[0] != loop_thread


@pytest.mark.asyncio
async def test_update_tool_config_unknown_tool_returns_404(
    monkeypatch,
) -> None:
    """A missing tool name is a client 404, not an internal 500."""
    _patch_workspace(monkeypatch)
    agent_config = _agent_config("read_file", {})
    registry = SimpleNamespace(
        get_plugin_id_for_tool=lambda _tool_name: None,
    )

    async def update_config(_agent_id, updater):
        def update_sync():
            updater(agent_config)
            return agent_config

        return await run_sync_io(update_sync)

    monkeypatch.setattr(registry_module, "PluginRegistry", lambda: registry)
    monkeypatch.setattr(
        tools_router_module,
        "update_agent_config_async",
        update_config,
    )

    with pytest.raises(HTTPException) as exc_info:
        await update_tool_config(
            tool_name="integ-unknown-xyz",
            body=ToolConfigUpdate(config={}),
            request=SimpleNamespace(),
        )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Tool 'integ-unknown-xyz' not found"


@pytest.mark.asyncio
async def test_update_tool_config_transaction_value_error_stays_500(
    monkeypatch,
) -> None:
    """Load/save ValueError is an internal failure, not a missing tool."""
    _patch_workspace(monkeypatch)
    registry = SimpleNamespace(
        get_plugin_id_for_tool=lambda _tool_name: None,
    )

    async def update_config(_agent_id, _updater):
        raise ValueError("invalid cron expression")

    monkeypatch.setattr(registry_module, "PluginRegistry", lambda: registry)
    monkeypatch.setattr(
        tools_router_module,
        "update_agent_config_async",
        update_config,
    )

    with pytest.raises(HTTPException) as exc_info:
        await update_tool_config(
            tool_name="read_file",
            body=ToolConfigUpdate(config={}),
            request=SimpleNamespace(),
        )

    assert exc_info.value.status_code == 500
    assert "invalid cron expression" in str(exc_info.value.detail)


@pytest.mark.asyncio
async def test_update_tool_config_validation_error_stays_500(
    monkeypatch,
) -> None:
    """Pydantic ValidationError subclasses ValueError and must stay 500."""

    class _ProfileStub(BaseModel):
        timeout: int

    with pytest.raises(ValidationError) as verr:
        _ProfileStub.model_validate({"timeout": "broken"})
    validation_error = verr.value

    _patch_workspace(monkeypatch)
    registry = SimpleNamespace(
        get_plugin_id_for_tool=lambda _tool_name: None,
    )

    async def update_config(_agent_id, _updater):
        raise validation_error

    monkeypatch.setattr(registry_module, "PluginRegistry", lambda: registry)
    monkeypatch.setattr(
        tools_router_module,
        "update_agent_config_async",
        update_config,
    )

    with pytest.raises(HTTPException) as exc_info:
        await update_tool_config(
            tool_name="read_file",
            body=ToolConfigUpdate(config={}),
            request=SimpleNamespace(),
        )

    assert exc_info.value.status_code == 500
    assert isinstance(validation_error, ValueError)


@pytest.mark.parametrize(f"category", [None, f"media", f"unknown", 123])
def test_plugin_tool_metadata(monkeypatch, category) -> None:
    """Only explicit per-tool categories are exposed; text stays original."""
    tool = SimpleNamespace(
        name=f"generate_image_qwen",
        enabled=True,
        description=f"Plugin original description",
        async_execution=False,
        icon=f"",
        config={},
    )
    manifest = {
        f"name": f"Image plugin",
        f"meta": {
            f"category": f"web",
            f"tools": [{f"name": tool.name, f"category": category}],
        },
    }
    registry = SimpleNamespace(
        get_plugin_id_for_tool=lambda name: f"image-plugin",
        get_plugin_manifest=lambda plugin_id: manifest,
    )
    monkeypatch.setattr(registry_module, f"PluginRegistry", lambda: registry)
    monkeypatch.setattr(
        tools_router_module,
        f"DEFAULT_REGISTRY",
        SimpleNamespace(get_owner=lambda name: None),
    )
    # pylint: disable-next=protected-access
    result = tools_router_module._build_tool_info(tool, tool.name)
    assert result.source_plugin_id == f"image-plugin"
    assert result.source_plugin_name == f"Image plugin"
    assert result.description == tool.description
    assert result.category == (category if isinstance(category, str) else None)


def test_dynamic_plugin_tool_source(monkeypatch) -> None:
    """Runtime ownership identifies tools absent from manifest declarations."""
    tool = SimpleNamespace(
        name=f"dynamic_tool",
        enabled=True,
        description=f"Original",
        async_execution=False,
        icon=f"",
        config={},
    )
    registry = SimpleNamespace(
        get_plugin_id_for_tool=lambda name: None,
        get_plugin_manifest=lambda plugin_id: None,
    )
    monkeypatch.setattr(registry_module, f"PluginRegistry", lambda: registry)
    monkeypatch.setattr(
        tools_router_module,
        f"DEFAULT_REGISTRY",
        SimpleNamespace(get_owner=lambda name: f"dynamic-plugin"),
    )
    # pylint: disable-next=protected-access
    result = tools_router_module._build_tool_info(tool, tool.name)
    assert result.source_plugin_id == f"dynamic-plugin"
    assert result.category is None


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
