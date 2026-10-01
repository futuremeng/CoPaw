# -*- coding: utf-8 -*-
"""Copaw-owned coverage: leaked-thinking repair in the OpenAI stream compat.

``strip_leaked_thinking_prefix`` and ``promote_thinking_only_answer`` live in
the fork-owned ``qwenpaw.providers.visible_text_compat`` (local models put a
finished markdown answer into the ``thinking`` channel).  The cases live
here so
``test_openai_stream_toolcall_compat.py`` stays at upstream bytes.
"""

from __future__ import annotations

from types import SimpleNamespace

from qwenpaw.providers.visible_text_compat import (
    promote_thinking_only_answer,
    strip_leaked_thinking_prefix,
)


def test_strip_leaked_thinking_prefix_for_structured_answer() -> None:
    leaked = (
        "Thinking\n"
        "## ✅ 当前进展确认 - 没有丢失！\n"
        "根据我刚才的读取验证，所有成果都已保存。"
    )

    cleaned = strip_leaked_thinking_prefix(leaked)

    assert cleaned.startswith("## ✅ 当前进展确认 - 没有丢失！")
    assert "Thinking\n" not in cleaned


def test_strip_leaked_thinking_prefix_keeps_normal_text() -> None:
    normal = "Thinking\nI will compare A and B before deciding."

    cleaned = strip_leaked_thinking_prefix(normal)

    assert cleaned == normal


def test_promote_thinking_only_structured_answer_to_text() -> None:
    parsed = SimpleNamespace(
        content=[
            {
                "type": "thinking",
                "thinking": (
                    "## ✅ 当前进展确认\n\n"
                    "- [x] Pipeline schema 完成\n"
                    "- [x] Script 标准化完成\n\n"
                    "| 项目 | 状态 |\n|------|------|\n| P0 | ✅ |"
                ),
            },
        ],
    )

    promote_thinking_only_answer(parsed)

    assert parsed.content
    assert parsed.content[0]["type"] == "text"
    assert "当前进展确认" in parsed.content[0]["text"]


def test_promote_thinking_only_keeps_internal_draft() -> None:
    parsed = SimpleNamespace(
        content=[
            {
                "type": "thinking",
                "thinking": (
                    "让我先检查三个点再决定怎么回复用户。"
                    "接下来我会读取文件并核对日志，然后再给结论。"
                    "最后再决定是否调用工具。"
                ),
            },
        ],
    )

    promote_thinking_only_answer(parsed)

    assert parsed.content
    assert parsed.content[0]["type"] == "thinking"
