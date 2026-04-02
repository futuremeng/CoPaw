# -*- coding: utf-8 -*-
from __future__ import annotations

import importlib
from types import SimpleNamespace

from copaw.app.routers.skills import MarketplaceItem


async def test_skill_market_install_requires_explicit_confirmation(monkeypatch) -> None:
    module = importlib.import_module("copaw.agents.tools.skill_market_install")

    result = await module.skill_market_install(
        market_id="editor",
        skill_id="proofread-single",
        confirm=False,
        confirmation_token="",
    )

    text = result.content[0]["text"]
    assert "requires explicit confirmation" in text


async def test_skill_market_install_returns_not_found(monkeypatch) -> None:
    module = importlib.import_module("copaw.agents.tools.skill_market_install")

    monkeypatch.setattr(module, "_load_current_market_config", lambda: object())
    monkeypatch.setattr(module, "_aggregate_marketplace", lambda *_a, **_k: ([], [], {}))

    result = await module.skill_market_install(
        market_id="editor",
        skill_id="missing",
        confirm=True,
        confirmation_token="INSTALL_CONFIRMED",
    )

    text = result.content[0]["text"]
    assert "skill not found in enabled markets" in text


async def test_skill_market_install_succeeds(monkeypatch, tmp_path) -> None:
    module = importlib.import_module("copaw.agents.tools.skill_market_install")

    monkeypatch.setattr(module, "_load_current_market_config", lambda: SimpleNamespace(install=SimpleNamespace(overwrite_default=False)))
    monkeypatch.setattr(
        module,
        "_aggregate_marketplace",
        lambda *_a, **_k: (
            [
                MarketplaceItem(
                    market_id="editor",
                    skill_id="proofread-single",
                    name="Proofread Single",
                    description="",
                    version="1.0.0",
                    source_url="https://github.com/futuremeng/editor-skills.git",
                    install_url="https://github.com/futuremeng/editor-skills/tree/main/skills/proofread-single",
                    tags=["proofread"],
                ),
            ],
            [],
            {},
        ),
    )
    monkeypatch.setattr(module, "get_current_workspace_dir", lambda: str(tmp_path))

    captured = {}

    def _mock_install_skill_from_hub(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(name="proofread-single", enabled=True)

    monkeypatch.setattr(module, "install_skill_from_hub", _mock_install_skill_from_hub)

    reconciled = {"called": False}

    def _mock_reconcile_workspace_manifest(workspace_dir):
        reconciled["called"] = True
        assert str(workspace_dir) == str(tmp_path)

    monkeypatch.setattr(module, "reconcile_workspace_manifest", _mock_reconcile_workspace_manifest)

    result = await module.skill_market_install(
        market_id="editor",
        skill_id="proofread-single",
        confirm=True,
        confirmation_token="INSTALL_CONFIRMED",
        enable=True,
        overwrite=False,
    )

    text = result.content[0]["text"]
    assert "Skill installed successfully" in text
    assert "name=proofread-single" in text
    assert captured["bundle_url"].endswith("/skills/proofread-single")
    assert captured["overwrite"] is False
    assert captured["enable"] is True
    assert reconciled["called"] is True
