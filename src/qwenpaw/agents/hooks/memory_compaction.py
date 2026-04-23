# -*- coding: utf-8 -*-
"""Compatibility memory compaction hook.

Restores the legacy ``MemoryCompactionHook`` interface expected by the
runner and agent startup paths after the hook implementation moved during
merge resolution.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from agentscope.agent import ReActAgent
from agentscope.message import Msg, TextBlock

from qwenpaw.constant import MEMORY_COMPACT_KEEP_RECENT

from ..utils import check_valid_messages
from ..utils.estimate_token_counter import EstimatedTokenCounter
from ...config.config import load_agent_config

if TYPE_CHECKING:
    from ..memory import BaseMemoryManager

logger = logging.getLogger(__name__)

_TOOL_RESULT_CONTEXT_CAP_RATIO = 0.5
_TOOL_RESULT_CONTEXT_SAFETY_FACTOR = 0.8
_TOOL_RESULT_MIN_THRESHOLD = 1000


class MemoryCompactionHook:
    """Legacy pre-reasoning hook for automatic context compaction."""

    _REENTRANCY_ATTR = "_memory_compact_hook_running"

    def __init__(self, memory_manager: "BaseMemoryManager"):
        self.memory_manager = memory_manager

    @staticmethod
    def _get_dynamic_tool_result_threshold(
        max_input_length: int,
        token_count_estimate_divisor: float,
        configured_threshold: int,
    ) -> int:
        context_projected_chars = int(
            max_input_length
            * _TOOL_RESULT_CONTEXT_CAP_RATIO
            * token_count_estimate_divisor
            * _TOOL_RESULT_CONTEXT_SAFETY_FACTOR,
        )
        context_projected_chars = max(
            _TOOL_RESULT_MIN_THRESHOLD,
            context_projected_chars,
        )
        return min(configured_threshold, context_projected_chars)

    @staticmethod
    async def _print_status_message(agent: ReActAgent, text: str) -> None:
        msg = Msg(
            name=agent.name,
            role="assistant",
            content=[TextBlock(type="text", text=text)],
        )
        await agent.print(msg)

    async def __call__(
        self,
        agent: ReActAgent,
        kwargs: dict[str, Any],
    ) -> dict[str, Any] | None:
        if getattr(agent, self._REENTRANCY_ATTR, False):
            return None
        setattr(agent, self._REENTRANCY_ATTR, True)

        try:
            agent_config = load_agent_config(self.memory_manager.agent_id)
            running_config = agent_config.running
            divisor = running_config.context_compact.token_count_estimate_divisor
            token_counter = EstimatedTokenCounter(estimate_divisor=divisor)

            memory = agent.memory

            system_prompt = agent.sys_prompt
            compressed_summary = memory.get_compressed_summary()
            str_token_count = await token_counter.count(
                text=(system_prompt or "") + (compressed_summary or ""),
            )

            left_compact_threshold = (
                running_config.memory_compact_threshold - str_token_count
            )

            if left_compact_threshold <= 0:
                logger.warning(
                    "The memory_compact_threshold is set too low; the "
                    "combined token length of system_prompt and "
                    "compressed_summary exceeds the configured threshold.",
                )
                return None

            messages = await memory.get_memory(prepend_summary=False)

            trc = running_config.tool_result_compact
            if trc.enabled and hasattr(self.memory_manager, "compact_tool_result"):
                recent_max_bytes = self._get_dynamic_tool_result_threshold(
                    max_input_length=running_config.max_input_length,
                    token_count_estimate_divisor=divisor,
                    configured_threshold=trc.recent_max_bytes,
                )
                old_max_bytes = min(
                    trc.old_max_bytes,
                    max(_TOOL_RESULT_MIN_THRESHOLD, recent_max_bytes // 2),
                )
                await self.memory_manager.compact_tool_result(
                    messages=messages,
                    recent_n=trc.recent_n,
                    old_max_bytes=old_max_bytes,
                    recent_max_bytes=recent_max_bytes,
                    retention_days=trc.retention_days,
                )

            messages_to_compact, _, is_valid = await self.memory_manager.check_context(
                messages=messages,
                memory_compact_threshold=left_compact_threshold,
                memory_compact_reserve=running_config.memory_compact_reserve,
                as_token_counter=token_counter,
            )

            if not messages_to_compact:
                return None

            if not is_valid:
                logger.warning("Invalid messages encountered during context compaction")
                keep_length = MEMORY_COMPACT_KEEP_RECENT
                messages_length = len(messages)
                while keep_length > 0 and not check_valid_messages(
                    messages[max(messages_length - keep_length, 0) :],
                ):
                    keep_length -= 1

                if keep_length > 0:
                    messages_to_compact = messages[
                        : max(messages_length - keep_length, 0)
                    ]
                else:
                    messages_to_compact = messages

            if not messages_to_compact:
                return None

            if running_config.memory_summary.memory_summary_enabled:
                self.memory_manager.add_summarize_task(messages=messages_to_compact)

            await self._print_status_message(agent, "🔄 Context compaction started...")

            compact_content = ""
            if running_config.context_compact.context_compact_enabled:
                compact_content = await self.memory_manager.compact_memory(
                    messages=messages_to_compact,
                    previous_summary=memory.get_compressed_summary(),
                )
                if compact_content:
                    await self._print_status_message(
                        agent,
                        "✅ Context compaction completed",
                    )
                else:
                    await self._print_status_message(
                        agent,
                        "⚠️ Context compaction failed.",
                    )
            else:
                await self._print_status_message(
                    agent,
                    "✅ Context compaction skipped",
                )

            updated_count = await memory.mark_messages_compressed(messages_to_compact)
            logger.info("Marked %s messages as compacted", updated_count)
            await memory.update_compressed_summary(compact_content)
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception(
                "Failed to compact memory in pre_reasoning hook: %s",
                exc,
            )
        finally:
            setattr(agent, self._REENTRANCY_ATTR, False)

        return None