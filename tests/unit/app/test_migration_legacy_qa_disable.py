# -*- coding: utf-8 -*-
"""Legacy CoPaw builtin QA profile must be retired when the current builtin
QA slot is first created, and ``active_agent`` must not be left pointing at it.

Upstream ships this in ``app/migration.py``; a fork merge dropped it, so the
constant ``LEGACY_QA_AGENT_ID`` had no readers left in the tree.
"""
from types import SimpleNamespace

import pytest

from qwenpaw.app import migration
from qwenpaw.constant import BUILTIN_QA_AGENT_ID, LEGACY_QA_AGENT_ID


def _ref(agent_id: str, enabled: bool = True) -> SimpleNamespace:
    return SimpleNamespace(id=agent_id, enabled=enabled)


def _config(profiles: dict, active_agent: str = "default"):
    agents = SimpleNamespace(profiles=profiles, active_agent=active_agent)
    return SimpleNamespace(agents=agents)


def test_no_legacy_profile_is_a_noop() -> None:
    config = _config({BUILTIN_QA_AGENT_ID: _ref(BUILTIN_QA_AGENT_ID)})
    migration._apply_legacy_qa_disable_for_migration(config)
    assert config.agents.active_agent == "default"


def test_legacy_profile_is_disabled_once() -> None:
    legacy = _ref(LEGACY_QA_AGENT_ID)
    config = _config(
        {LEGACY_QA_AGENT_ID: legacy, BUILTIN_QA_AGENT_ID: _ref(BUILTIN_QA_AGENT_ID)},
    )
    migration._apply_legacy_qa_disable_for_migration(config)
    assert legacy.enabled is False


def test_active_agent_moves_off_disabled_legacy_profile() -> None:
    config = _config(
        {
            LEGACY_QA_AGENT_ID: _ref(LEGACY_QA_AGENT_ID),
            BUILTIN_QA_AGENT_ID: _ref(BUILTIN_QA_AGENT_ID),
            "default": _ref("default"),
        },
        active_agent=LEGACY_QA_AGENT_ID,
    )
    migration._apply_legacy_qa_disable_for_migration(config)
    assert config.agents.active_agent == BUILTIN_QA_AGENT_ID


def test_fallback_skips_disabled_candidates() -> None:
    config = _config(
        {
            BUILTIN_QA_AGENT_ID: _ref(BUILTIN_QA_AGENT_ID, enabled=False),
            "default": _ref("default"),
            "custom": _ref("custom"),
        },
    )
    assert (
        migration._fallback_active_agent_id(config, LEGACY_QA_AGENT_ID) == "default"
    )


def test_fallback_returns_default_when_nothing_else_usable() -> None:
    config = _config({LEGACY_QA_AGENT_ID: _ref(LEGACY_QA_AGENT_ID)})
    assert migration._fallback_active_agent_id(config, LEGACY_QA_AGENT_ID) == "default"


def test_fallback_never_returns_the_excluded_id() -> None:
    config = _config({}, active_agent=LEGACY_QA_AGENT_ID)
    assert (
        migration._fallback_active_agent_id(config, LEGACY_QA_AGENT_ID) != LEGACY_QA_AGENT_ID
    )


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
