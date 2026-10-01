# -*- coding: utf-8 -*-
"""Copaw-owned repair for leaked reasoning text in OpenAI-compatible streams.

Local models occasionally put a finished markdown answer into the ``thinking``
channel, or leak an internal "Thinking" heading into visible text.  These
helpers used to live inside upstream's ``openai_chat_model_compat``; they moved
out so that file stays additive at two call sites.
"""
from __future__ import annotations

import re

from agentscope.model._model_response import ChatResponse


_LEAKED_THINKING_PREFIX_RE = re.compile(
    r"^\s*(?:Thinking|Reasoning|思考|推理)\s*:?\s*(?:\r?\n)+",
    re.IGNORECASE,
)
_THINKING_REPORT_SIGNAL_RE = re.compile(
    r"(?:^|\n)(?:#{1,6}\s|[-*]\s\[[ xX]\]\s|\d+\.\s|\|.+\|)",
    re.MULTILINE,
)
_THINKING_INTERNAL_PREFIX_RE = re.compile(
    r"^\s*(?:让我|我需要|我应该|先\s|let me\b|i need to\b|i should\b|i'?ll\b)",
    re.IGNORECASE,
)
_THINKING_FINAL_ANSWER_CUE_RE = re.compile(
    r"(?:当前进展|下一步|关键确认|可选行动|总结|结论|状态|建议|您可以|你可以|可以继续|"
    r"next steps?|summary|status|recommend(?:ation)?s?)",
    re.IGNORECASE,
)


def strip_leaked_thinking_prefix(text: str) -> str:
    """Drop leaked reasoning title lines from user-visible text.

    Some models emit an internal heading like "Thinking" into the final text
    when reasoning delimiters are malformed or truncated. We only strip this
    prefix when the following line looks like formatted answer content.
    """
    if not isinstance(text, str) or not text:
        return text

    match = _LEAKED_THINKING_PREFIX_RE.match(text)
    if not match:
        return text

    remainder = text[match.end() :]
    if not remainder.strip():
        return text

    first_line = remainder.lstrip().splitlines()[0].strip()
    looks_like_answer = bool(
        re.match(r"^(#{1,6}\s|[-*]\s|\d+\.\s|---|[✅📊📁🎯🚀])", first_line),
    )
    if not looks_like_answer:
        return text

    return remainder.lstrip()


def sanitize_visible_text_blocks(parsed: ChatResponse) -> None:
    """Normalize user-visible text blocks in-place for common leakage cases."""
    for block in parsed.content:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "text":
            raw_text = block.get("text")
            if isinstance(raw_text, str):
                block["text"] = strip_leaked_thinking_prefix(raw_text)
        elif block.get("type") == "refusal":
            raw_refusal = block.get("refusal")
            if isinstance(raw_refusal, str):
                block["refusal"] = strip_leaked_thinking_prefix(raw_refusal)


def promote_thinking_only_answer(parsed: ChatResponse) -> None:
    """Promote thinking-only formatted answers into visible text blocks.

    Some model streams occasionally end with only ``thinking`` content even
    when the text is clearly a final structured answer. In that case, move it
    into a ``text`` block so UI/history can render it consistently.
    """
    if not isinstance(parsed.content, list) or not parsed.content:
        return

    if any(
        isinstance(block, dict) and block.get("type") != "thinking"
        for block in parsed.content
    ):
        return

    think_chunks = []
    for block in parsed.content:
        if not isinstance(block, dict) or block.get("type") != "thinking":
            return
        chunk = block.get("thinking")
        if isinstance(chunk, str) and chunk.strip():
            think_chunks.append(chunk.strip())

    if not think_chunks:
        return

    merged = strip_leaked_thinking_prefix("\n\n".join(think_chunks).strip())
    if not merged:
        return

    if len(merged) < 60:
        return

    if _THINKING_INTERNAL_PREFIX_RE.match(merged):
        return

    if not _THINKING_REPORT_SIGNAL_RE.search(merged):
        return

    # Avoid promoting raw markdown/file excerpts that happen to include
    # headings/lists/tables but are not user-facing final answers.
    if not _THINKING_FINAL_ANSWER_CUE_RE.search(merged):
        return

    parsed.content = [{"type": "text", "text": merged}]
