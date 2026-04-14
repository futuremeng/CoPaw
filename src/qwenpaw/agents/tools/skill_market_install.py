# -*- coding: utf-8 -*-
"""Tool to install a skill from enabled skill markets."""

from __future__ import annotations

import json
from pathlib import Path

from agentscope.message import TextBlock
from agentscope.tool import ToolResponse

from ...agents.skills_hub import install_skill_from_hub
from ...agents.skills_manager import reconcile_workspace_manifest
from ...app.routers.skills import _aggregate_marketplace, _load_current_market_config
from ...config.context import get_current_workspace_dir
from ...constant import WORKING_DIR
from ...security.skill_scanner import SkillScanError

_CONFIRM_TOKEN = "INSTALL_CONFIRMED"
_TRUSTED_MARKET_LEVELS = {"official", "community"}


def _confirmation_valid(confirm: bool, confirmation_token: str) -> bool:
    return bool(confirm) and (confirmation_token or "").strip() == _CONFIRM_TOKEN


async def skill_market_install(
    market_id: str,
    skill_id: str,
    confirm: bool = False,
    confirmation_token: str = "",
    allow_untrusted: bool = False,
    enable: bool = True,
    overwrite: bool = False,
) -> ToolResponse:
    """Install a skill from enabled skill markets into current workspace.

    This tool always requires explicit confirmation to reduce accidental
    installations triggered by model planning mistakes.

    Args:
        market_id: Marketplace id of the skill source.
        skill_id: Skill id inside the marketplace index.
        confirm: Must be true to proceed.
        confirmation_token: Must equal INSTALL_CONFIRMED to proceed.
        allow_untrusted: Whether to allow install from non-trusted markets.
        enable: Whether to enable the installed skill.
        overwrite: Whether to overwrite existing skill if present.

    Returns:
        ToolResponse containing installation result or error details.
    """
    market_key = (market_id or "").strip()
    skill_key = (skill_id or "").strip()
    if not market_key or not skill_key:
        payload = {
            "ok": False,
            "error": {
                "code": "INVALID_INPUT",
                "message": "market_id and skill_id are required",
            },
        }
        return ToolResponse(
            content=[
                TextBlock(
                    type="text",
                    text=(
                        "Error: market_id and skill_id are required.\n"
                        "JSON_RESULT_START\n"
                        f"{json.dumps(payload, ensure_ascii=False)}\n"
                        "JSON_RESULT_END"
                    ),
                ),
            ],
        )

    if not _confirmation_valid(confirm, confirmation_token):
        payload = {
            "ok": False,
            "error": {
                "code": "CONFIRMATION_REQUIRED",
                "message": (
                    "Set confirm=true and "
                    "confirmation_token=INSTALL_CONFIRMED"
                ),
            },
            "required_confirmation_token": _CONFIRM_TOKEN,
        }
        return ToolResponse(
            content=[
                TextBlock(
                    type="text",
                    text=(
                        "Installation requires explicit confirmation. "
                        "Set confirm=true and confirmation_token=INSTALL_CONFIRMED.\n"
                        "JSON_RESULT_START\n"
                        f"{json.dumps(payload, ensure_ascii=False)}\n"
                        "JSON_RESULT_END"
                    ),
                ),
            ],
        )

    try:
        cfg = _load_current_market_config()
        items, _errors, _meta = _aggregate_marketplace(cfg, refresh=True)
        market_trust = {
            market.id: (market.trust or "custom")
            for market in (cfg.markets or [])
        }
        selected = next(
            (
                item
                for item in items
                if item.market_id == market_key and item.skill_id == skill_key
            ),
            None,
        )
        if selected is None:
            payload = {
                "ok": False,
                "error": {
                    "code": "MARKET_ITEM_NOT_FOUND",
                    "message": "skill not found in enabled markets",
                },
                "market_id": market_key,
                "skill_id": skill_key,
            }
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            "Error: skill not found in enabled markets. "
                            f"market_id={market_key} skill_id={skill_key}\n"
                            "JSON_RESULT_START\n"
                            f"{json.dumps(payload, ensure_ascii=False)}\n"
                            "JSON_RESULT_END"
                        ),
                    ),
                ],
            )

        trust_level = market_trust.get(market_key, "custom")
        if trust_level not in _TRUSTED_MARKET_LEVELS and not allow_untrusted:
            payload = {
                "ok": False,
                "error": {
                    "code": "UNTRUSTED_MARKET",
                    "message": "installation blocked by trust policy",
                },
                "market_id": market_key,
                "skill_id": skill_key,
                "trust": trust_level,
                "allow_untrusted": False,
            }
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            "Error: installation blocked by trust policy. "
                            "reason=UNTRUSTED_MARKET "
                            f"market_id={market_key} trust={trust_level}. "
                            "Set allow_untrusted=true to override.\n"
                            "JSON_RESULT_START\n"
                            f"{json.dumps(payload, ensure_ascii=False)}\n"
                            "JSON_RESULT_END"
                        ),
                    ),
                ],
            )

        workspace_dir = Path(get_current_workspace_dir() or WORKING_DIR)
        effective_overwrite = bool(overwrite or cfg.install.overwrite_default)
        result = install_skill_from_hub(
            workspace_dir=workspace_dir,
            bundle_url=selected.install_url,
            enable=enable,
            overwrite=effective_overwrite,
        )

        reconcile_workspace_manifest(workspace_dir)

        payload = {
            "ok": True,
            "market_id": market_key,
            "skill_id": skill_key,
            "name": result.name,
            "enabled": bool(result.enabled),
            "trust": trust_level,
            "workspace_dir": str(workspace_dir),
        }
        return ToolResponse(
            content=[
                TextBlock(
                    type="text",
                    text=(
                        "Skill installed successfully. "
                        f"name={result.name}, enabled={str(result.enabled).lower()}, "
                        f"market_id={market_key}, skill_id={skill_key}, "
                        f"trust={trust_level}, "
                        f"workspace_dir={workspace_dir}\n"
                        "JSON_RESULT_START\n"
                        f"{json.dumps(payload, ensure_ascii=False)}\n"
                        "JSON_RESULT_END"
                    ),
                ),
            ],
        )
    except SkillScanError as exc:
        payload = {
            "ok": False,
            "error": {
                "code": "SECURITY_SCAN_FAILED",
                "message": str(exc),
            },
            "market_id": market_key,
            "skill_id": skill_key,
        }
        return ToolResponse(
            content=[
                TextBlock(
                    type="text",
                    text=(
                        "Error: skill installation blocked by security scanner. "
                        f"{exc}\n"
                        "JSON_RESULT_START\n"
                        f"{json.dumps(payload, ensure_ascii=False)}\n"
                        "JSON_RESULT_END"
                    ),
                ),
            ],
        )
    except Exception as exc:
        payload = {
            "ok": False,
            "error": {
                "code": "SKILL_MARKET_INSTALL_FAILED",
                "message": str(exc),
            },
            "market_id": market_key,
            "skill_id": skill_key,
        }
        return ToolResponse(
            content=[
                TextBlock(
                    type="text",
                    text=(
                        f"Error: skill installation failed due to\n{exc}\n"
                        "JSON_RESULT_START\n"
                        f"{json.dumps(payload, ensure_ascii=False)}\n"
                        "JSON_RESULT_END"
                    ),
                ),
            ],
        )
