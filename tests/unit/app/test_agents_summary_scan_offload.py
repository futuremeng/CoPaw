# -*- coding: utf-8 -*-
"""Copaw-owned coverage: agent list builds summaries off the event loop.

``_collect_agent_summaries`` is a fork addition to the upstream agents router,
so this case lives outside ``test_agents_ordering.py`` (which is kept at
upstream bytes as the regression judge).
"""

import pytest

from qwenpaw.config.config import (
    AgentProfileConfig,
    AgentProfileRef,
    Config,
)
from qwenpaw.app.routers import agents as agents_router


def _build_config(
    profile_ids: list[str],
    agent_order: list[str] | None = None,
) -> Config:
    config = Config()
    config.agents.profiles = {
        agent_id: AgentProfileRef(
            id=agent_id,
            workspace_dir=f"/tmp/{agent_id}",
        )
        for agent_id in profile_ids
    }
    config.agents.agent_order = agent_order or []
    return config


def _agent_config(agent_id: str) -> AgentProfileConfig:
    return AgentProfileConfig(
        id=agent_id,
        name=agent_id.upper(),
        description=f"{agent_id} description",
        workspace_dir=f"/tmp/{agent_id}",
    )


@pytest.mark.asyncio
async def test_list_agents_offloads_summary_scan_to_thread(monkeypatch):
    """Agent list should build disk-backed summaries outside the event loop."""
    config = _build_config(["default"], agent_order=["default"])
    calls: list[tuple[object, tuple[object, ...]]] = []
    original_to_thread = agents_router.asyncio.to_thread

    monkeypatch.setattr(agents_router, "load_config", lambda: config)
    monkeypatch.setattr(agents_router, "load_agent_config", _agent_config)
    monkeypatch.setattr(agents_router, "_ensure_projects_layout", lambda _path: None)
    monkeypatch.setattr(agents_router, "_list_agent_projects", lambda _path: [])

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(agents_router.asyncio, "to_thread", fake_to_thread)

    response = await agents_router.list_agents()

    assert [agent.id for agent in response.agents] == ["default"]
    assert calls
    assert calls[0][0] is agents_router._collect_agent_summaries
