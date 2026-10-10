# -*- coding: utf-8 -*-
"""Pins for the builtin agent metadata backfill.

The upstream-owned migration tests reach the backfill through its failure
path only: ``load_agent_config`` raises for them (the profile exists in the
fixture's Config but on no disk), so the ``agent.json`` half of the loop is
never exercised. These cases hold that branch open on its own, with the
config half already satisfied, which is the arrangement that proves it does
something.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from qwenpaw.app import migration
from qwenpaw.config.config import (
    AgentProfileConfig,
    AgentProfileRef,
    Config,
)
from qwenpaw.constant import BUILTIN_QA_AGENT_ID

QA_SPEC = next(
    spec
    for spec in migration.BUILTIN_AGENT_SPECS
    if spec.id == BUILTIN_QA_AGENT_ID
)


def _marked_ref(workspace_dir: Path) -> AgentProfileRef:
    """A profile that needs nothing from the config-side backfill."""
    return AgentProfileRef(
        id=BUILTIN_QA_AGENT_ID,
        workspace_dir=str(workspace_dir),
        is_builtin=True,
        builtin_kind=QA_SPEC.builtin_kind,
        builtin_label=QA_SPEC.builtin_label,
        system_protected=QA_SPEC.system_protected,
    )


def _unmarked_agent(workspace_dir: Path) -> AgentProfileConfig:
    """An agent.json as an upgrade from before builtin metadata leaves it."""
    return AgentProfileConfig(
        id=BUILTIN_QA_AGENT_ID,
        name="My QA helper",
        description="copy the user chose",
        workspace_dir=str(workspace_dir),
    )


def _marked_agent(workspace_dir: Path) -> AgentProfileConfig:
    return AgentProfileConfig(
        id=BUILTIN_QA_AGENT_ID,
        name="My QA helper",
        description="copy the user chose",
        workspace_dir=str(workspace_dir),
        is_builtin=True,
        builtin_kind=QA_SPEC.builtin_kind,
        builtin_label=QA_SPEC.builtin_label,
        system_protected=QA_SPEC.system_protected,
    )


def _satisfied_config(agent_ref: AgentProfileRef) -> Config:
    cfg = Config()
    cfg.agents.profiles = {BUILTIN_QA_AGENT_ID: agent_ref}
    cfg.agents.active_agent = BUILTIN_QA_AGENT_ID
    cfg.agents.agent_order = [BUILTIN_QA_AGENT_ID]
    return cfg


@pytest.fixture()
def env(tmp_path, monkeypatch):
    """Redirect the builtin loop and record everything it writes."""
    wd = tmp_path / "wd"
    (wd / "workspaces").mkdir(parents=True)
    monkeypatch.setattr(migration, "WORKING_DIR", str(wd))
    saved_configs: list = []
    saved_agents: list = []
    monkeypatch.setattr(migration, "save_config", saved_configs.append)
    monkeypatch.setattr(
        migration,
        "save_agent_config",
        lambda agent_id, agent_config: saved_agents.append(
            (agent_id, agent_config)
        ),
    )
    monkeypatch.setattr(
        "qwenpaw.app.routers.agents._initialize_agent_workspace",
        lambda ws, skill_names, md_template_id: None,
    )
    return wd, saved_configs, saved_agents


def test_unmarked_agent_json_is_backfilled_without_a_config_write(
    env,
    monkeypatch,
):
    wd, saved_configs, saved_agents = env
    workspace = wd / "existing_qa"
    cfg = _satisfied_config(_marked_ref(workspace))
    monkeypatch.setattr(migration, "load_config", lambda: cfg)
    monkeypatch.setattr(
        migration,
        "load_agent_config",
        lambda agent_id: _unmarked_agent(workspace),
    )

    migration._do_ensure_qa_agent()

    assert saved_configs == []
    assert [agent_id for agent_id, _ in saved_agents] == [
        BUILTIN_QA_AGENT_ID,
    ]
    written = saved_agents[0][1]
    assert written.is_builtin is True
    assert written.builtin_kind == QA_SPEC.builtin_kind
    assert written.builtin_label == QA_SPEC.builtin_label
    assert written.system_protected is QA_SPEC.system_protected
    # the backfill only fills the metadata slots
    assert written.name == "My QA helper"
    assert written.description == "copy the user chose"


def test_fully_marked_profile_writes_nothing_at_all(env, monkeypatch):
    wd, saved_configs, saved_agents = env
    workspace = wd / "existing_qa"
    cfg = _satisfied_config(_marked_ref(workspace))
    monkeypatch.setattr(migration, "load_config", lambda: cfg)
    monkeypatch.setattr(
        migration,
        "load_agent_config",
        lambda agent_id: _marked_agent(workspace),
    )

    migration._do_ensure_qa_agent()

    assert saved_configs == []
    assert saved_agents == []
