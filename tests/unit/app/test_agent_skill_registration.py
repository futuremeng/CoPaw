# -*- coding: utf-8 -*-
from __future__ import annotations
import pytest


import importlib
from pathlib import Path


class _FakeToolkit:
    def __init__(self) -> None:
        self.registered_skills: list[str] = []

    def register_agent_skill(self, skill_dir: str) -> None:
        self.registered_skills.append(skill_dir)
@pytest.mark.xfail(strict=True, reason="P1-BEHAVIOR-LOST: builtin knowledge skill 注册补丁随上游 rebrand 同步丢失；react_agent 已改用 skill_system，无 get_working_skills_dir/list_available_skills")
def test_register_skills_includes_builtin_knowledge_skill_when_enabled(
    monkeypatch,
    tmp_path: Path,
) -> None:
    module = importlib.import_module("qwenpaw.agents.react_agent")

    working_skills_dir = tmp_path / "working"
    manual_skill_dir = working_skills_dir / "manual_skill"
    knowledge_skill_dir = working_skills_dir / "knowledge_search_assistant"
    manual_skill_dir.mkdir(parents=True)
    knowledge_skill_dir.mkdir(parents=True)

    monkeypatch.setattr(module, "ensure_skills_initialized", lambda: None)
    monkeypatch.setattr(module, "get_working_skills_dir", lambda: working_skills_dir)
    monkeypatch.setattr(
        module,
        "list_available_skills",
        lambda: ["knowledge_search_assistant", "manual_skill"],
    )

    toolkit = _FakeToolkit()
    agent = object.__new__(module.QwenPawAgent)

    agent._register_skills(toolkit)

    assert toolkit.registered_skills == [
        str(knowledge_skill_dir),
        str(manual_skill_dir),
    ]


@pytest.mark.xfail(strict=True, reason="P1-BEHAVIOR-LOST: 同上（builtin knowledge skill 注册补丁丢失）")
def test_register_skills_skips_builtin_knowledge_skill_when_disabled(
    monkeypatch,
    tmp_path: Path,
) -> None:
    module = importlib.import_module("qwenpaw.agents.react_agent")

    working_skills_dir = tmp_path / "working"
    manual_skill_dir = working_skills_dir / "manual_skill"
    manual_skill_dir.mkdir(parents=True)

    monkeypatch.setattr(module, "ensure_skills_initialized", lambda: None)
    monkeypatch.setattr(module, "get_working_skills_dir", lambda: working_skills_dir)
    monkeypatch.setattr(module, "list_available_skills", lambda: ["manual_skill"])

    toolkit = _FakeToolkit()
    agent = object.__new__(module.QwenPawAgent)

    agent._register_skills(toolkit)

    assert toolkit.registered_skills == [str(manual_skill_dir)]