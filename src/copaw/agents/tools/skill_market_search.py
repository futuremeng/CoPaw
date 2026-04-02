# -*- coding: utf-8 -*-
"""Tool to search skills from enabled skill markets."""

from __future__ import annotations

from agentscope.message import TextBlock
from agentscope.tool import ToolResponse

from ...app.routers.skills import _aggregate_marketplace, _load_current_market_config


def _matches_query(name: str, description: str, tags: list[str], query: str) -> bool:
    if not query:
        return True
    haystack = " ".join([name, description, " ".join(tags)]).lower()
    return query in haystack


async def skill_market_search(
    query: str = "",
    limit: int = 10,
    tags: list[str] | None = None,
    refresh: bool = False,
) -> ToolResponse:
    """Search enabled skill markets and return candidate skills.

    Use this tool when you need to find available skills from configured
    marketplace sources before asking user to install one.

    Args:
        query: Optional keyword query across skill name/description/tags.
        limit: Maximum number of skills to return.
        tags: Optional list of tag filters (AND semantics).
        refresh: Whether to bypass marketplace cache.

    Returns:
        ToolResponse with formatted candidate list and market metadata.
    """
    query_text = (query or "").strip().lower()
    normalized_tags = [t.strip().lower() for t in (tags or []) if t and t.strip()]

    try:
        cfg = _load_current_market_config()
        items, errors, meta = _aggregate_marketplace(cfg, refresh=refresh)

        filtered = []
        for item in items:
            item_tags = [str(tag).strip().lower() for tag in item.tags]
            if normalized_tags and not all(tag in item_tags for tag in normalized_tags):
                continue
            if not _matches_query(item.name, item.description, item.tags, query_text):
                continue
            filtered.append(item)

        filtered.sort(key=lambda it: (it.market_id, it.name.lower(), it.skill_id.lower()))
        capped = filtered[: max(1, min(int(limit), 50))]

        lines = [
            f"Skill marketplace search candidates: {len(capped)} (matched={len(filtered)})",
            (
                "filters: "
                f"query={query_text or '(none)'}, "
                f"tags={','.join(normalized_tags) or '(none)'}, "
                f"refresh={'true' if refresh else 'false'}"
            ),
            (
                "markets: "
                f"enabled={meta.get('enabled_market_count', 0)}, "
                f"success={meta.get('success_market_count', 0)}, "
                f"items={meta.get('item_count', len(items))}"
            ),
            "",
        ]

        if errors:
            lines.append("market warnings/errors:")
            for err in errors[:5]:
                lines.append(f"- [{err.code}] {err.market_id}: {err.message}")
            lines.append("")

        if not capped:
            lines.append("No matching skills found in enabled markets.")
        else:
            for idx, item in enumerate(capped, start=1):
                lines.append(
                    f"[{idx}] {item.name} ({item.skill_id}) "
                    f"market={item.market_id} version={item.version or 'n/a'}"
                )
                if item.tags:
                    lines.append(f"tags: {', '.join(item.tags)}")
                if item.description:
                    lines.append(f"description: {item.description}")
                lines.append(f"install_ref: market_id={item.market_id} skill_id={item.skill_id}")
                lines.append("")

        return ToolResponse(content=[TextBlock(type="text", text="\n".join(lines).strip())])
    except Exception as exc:
        return ToolResponse(
            content=[
                TextBlock(
                    type="text",
                    text=f"Error: skill market search failed due to\n{exc}",
                ),
            ],
        )
