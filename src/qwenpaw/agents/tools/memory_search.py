# -*- coding: utf-8 -*-
"""Memory search tool factory for agent memory managers."""

from agentscope.message import TextBlock
from agentscope.tool import ToolResponse


def create_memory_search_tool(memory_manager):
    """Create a bound memory_search tool function for the given manager."""

    async def memory_search(
        query: str,
        max_results: int = 5,
        min_score: float = 0.1,
    ) -> ToolResponse:
        if memory_manager is None:
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text="Error: Memory manager is not enabled.",
                    ),
                ],
            )

        try:
            return await memory_manager.memory_search(
                query=query,
                max_results=max_results,
                min_score=min_score,
            )
        except Exception as exc:  # pylint: disable=broad-except
            return ToolResponse(
                content=[
                    TextBlock(
                        type="text",
                        text=f"Error: Memory search failed due to\n{exc}",
                    ),
                ],
            )

    return memory_search