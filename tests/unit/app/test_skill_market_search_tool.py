# -*- coding: utf-8 -*-
from __future__ import annotations

import importlib
from types import SimpleNamespace

from copaw.app.routers.skills import MarketError, MarketplaceItem


async def test_skill_market_search_filters_by_query_and_tags(monkeypatch) -> None:
    module = importlib.import_module("copaw.agents.tools.skill_market_search")

    monkeypatch.setattr(
        module,
        "_load_current_market_config",
        lambda: SimpleNamespace(
            markets=[SimpleNamespace(id="editor", trust="community")],
        ),
    )
    monkeypatch.setattr(
        module,
        "_aggregate_marketplace",
        lambda *_args, **_kwargs: (
            [
                MarketplaceItem(
                    market_id="editor",
                    skill_id="proofread-single",
                    name="Proofread Single",
                    description="Single file proofreading skill",
                    version="1.0.0",
                    source_url="https://github.com/futuremeng/editor-skills.git",
                    install_url="https://github.com/futuremeng/editor-skills/tree/main/skills/proofread-single",
                    tags=["proofread", "editor"],
                ),
                MarketplaceItem(
                    market_id="editor",
                    skill_id="numeric-unit-consistency",
                    name="Numeric Unit Consistency",
                    description="Check numeric unit consistency",
                    version="1.0.0",
                    source_url="https://github.com/futuremeng/editor-skills.git",
                    install_url="https://github.com/futuremeng/editor-skills/tree/main/skills/numeric-unit-consistency",
                    tags=["consistency", "numbers"],
                ),
            ],
            [
                MarketError(
                    market_id="editor",
                    code="MARKET_WARNING",
                    message="using fallback index",
                    retryable=False,
                ),
            ],
            {
                "enabled_market_count": 1,
                "success_market_count": 1,
                "item_count": 2,
            },
        ),
    )

    result = await module.skill_market_search(
        query="proof",
        tags=["editor"],
        limit=5,
        refresh=True,
    )

    text = result.content[0]["text"]
    assert "Skill marketplace search candidates: 1 (matched=1)" in text
    assert "query=proof" in text
    assert "tags=editor" in text
    assert "refresh=true" in text
    assert "Proofread Single (proofread-single)" in text
    assert "market=editor trust=community" in text
    assert "Numeric Unit Consistency" not in text
    assert "[MARKET_WARNING] editor: using fallback index" in text


async def test_skill_market_search_returns_no_matches_message(monkeypatch) -> None:
    module = importlib.import_module("copaw.agents.tools.skill_market_search")

    monkeypatch.setattr(
        module,
        "_load_current_market_config",
        lambda: SimpleNamespace(markets=[]),
    )
    monkeypatch.setattr(
        module,
        "_aggregate_marketplace",
        lambda *_args, **_kwargs: (
            [],
            [],
            {
                "enabled_market_count": 0,
                "success_market_count": 0,
                "item_count": 0,
            },
        ),
    )

    result = await module.skill_market_search(query="", tags=None, limit=10)
    text = result.content[0]["text"]
    assert "No matching skills found in enabled markets." in text


async def test_skill_market_search_returns_error_message_on_exception(monkeypatch) -> None:
    module = importlib.import_module("copaw.agents.tools.skill_market_search")

    monkeypatch.setattr(
        module,
        "_load_current_market_config",
        lambda: SimpleNamespace(markets=[]),
    )

    def _raise(*_args, **_kwargs):
        raise RuntimeError("market backend unavailable")

    monkeypatch.setattr(module, "_aggregate_marketplace", _raise)

    result = await module.skill_market_search(query="proofread")
    text = result.content[0]["text"]
    assert "skill market search failed" in text
    assert "market backend unavailable" in text
