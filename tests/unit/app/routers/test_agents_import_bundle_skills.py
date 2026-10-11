# -*- coding: utf-8 -*-
"""Bundle activation installs the bundle's skills through the async hub API.

``install_skill_from_hub`` is an ``async def`` at the fork point, so the
skill loop in ``_activate_import_bundle`` has to await it.  Until it did,
every bundle import recorded a ``skill_errors`` entry instead of installing
a skill, because the coroutine's ``.name`` raised ``AttributeError`` and the
bare ``except Exception`` in the loop swallowed it.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest


async def test_activate_import_bundle_awaits_skill_install(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    from qwenpaw.app.routers.agents import _activate_import_bundle

    calls: list[dict[str, object]] = []

    async def _install_skill_from_hub(
        *,
        workspace_dir,
        bundle_url,
        version="",
        enable=False,
        target_name=None,
        cancel_checker=None,
    ):
        calls.append(
            {
                "workspace_dir": str(workspace_dir),
                "bundle_url": bundle_url,
                "enable": enable,
            },
        )
        skill_id = bundle_url.rsplit("/", 1)[-1]
        return SimpleNamespace(name=skill_id, enabled=True)

    monkeypatch.setattr(
        "qwenpaw.app.routers.agents.install_skill_from_hub",
        _install_skill_from_hub,
    )

    summary = await _activate_import_bundle(
        workspace_dir=tmp_path,
        local_agent_id="local-agent",
        source_id="source-1",
        original_agent_id="original-1",
        bundle={
            "skills": {"install_urls": ["https://example.test/skill-alpha"]},
            "import": {"tools": False, "flow_descriptions": False},
        },
        overwrite=False,
    )

    assert calls == [
        {
            "workspace_dir": str(tmp_path),
            "bundle_url": "https://example.test/skill-alpha",
            "enable": True,
        },
    ]
    assert summary["skills_installed"] == ["skill-alpha"]
    assert summary["skill_errors"] == []
