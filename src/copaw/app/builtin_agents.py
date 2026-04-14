# -*- coding: utf-8 -*-
"""Definitions for system-managed builtin agent profiles."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from ..config.config import (
    ToolsConfig,
    build_qa_agent_tools_config,
    build_understand_builtin_tools_config,
)
from ..constant import (
    BUILTIN_QA_AGENT_ID,
    BUILTIN_QA_AGENT_NAME,
    BUILTIN_QA_AGENT_SKILL_NAMES,
    WORKING_DIR,
)


@dataclass(frozen=True)
class BuiltinAgentSpec:
    """Static specification for one builtin agent."""

    id: str
    name: str
    description: str
    builtin_kind: str
    builtin_label: str
    template_key: str | None
    skill_names: tuple[str, ...]
    tools_builder: Callable[[], ToolsConfig]
    visible_in_ui: bool = True
    system_protected: bool = True

    @property
    def workspace_dir(self) -> Path:
        return (WORKING_DIR / "workspaces" / self.id).expanduser()


BUILTIN_UNDERSTAND_PROJECT_SCANNER_ID = "CoPaw_Understand_ProjectScanner_0.1beta1"
BUILTIN_UNDERSTAND_FILE_ANALYZER_ID = "CoPaw_Understand_FileAnalyzer_0.1beta1"
BUILTIN_UNDERSTAND_ARCHITECTURE_ANALYZER_ID = (
    "CoPaw_Understand_ArchitectureAnalyzer_0.1beta1"
)
BUILTIN_UNDERSTAND_TOUR_BUILDER_ID = "CoPaw_Understand_TourBuilder_0.1beta1"
BUILTIN_UNDERSTAND_GRAPH_REVIEWER_ID = "CoPaw_Understand_GraphReviewer_0.1beta1"
BUILTIN_UNDERSTAND_DOMAIN_ANALYZER_ID = "CoPaw_Understand_DomainAnalyzer_0.1beta1"


_UNDERSTAND_AGENT_SKILL_NAMES: tuple[str, ...] = (
    "guidance",
    "copaw_source_index",
    "multi-agent-collaboration",
)


BUILTIN_AGENT_SPECS: tuple[BuiltinAgentSpec, ...] = (
    BuiltinAgentSpec(
        id=BUILTIN_QA_AGENT_ID,
        name=BUILTIN_QA_AGENT_NAME,
        description=(
            "Builtin Q&A helper for CoPaw setup, documentation, and local "
            "configuration support."
        ),
        builtin_kind="qa",
        builtin_label="QA",
        template_key="qa",
        skill_names=BUILTIN_QA_AGENT_SKILL_NAMES,
        tools_builder=build_qa_agent_tools_config,
    ),
    BuiltinAgentSpec(
        id=BUILTIN_UNDERSTAND_PROJECT_SCANNER_ID,
        name="Project Scanner",
        description=(
            "System analysis agent for repository inventory, language "
            "detection, and framework discovery."
        ),
        builtin_kind="understand-project-scanner",
        builtin_label="Understand",
        template_key="understand-project-scanner",
        skill_names=_UNDERSTAND_AGENT_SKILL_NAMES,
        tools_builder=build_understand_builtin_tools_config,
    ),
    BuiltinAgentSpec(
        id=BUILTIN_UNDERSTAND_FILE_ANALYZER_ID,
        name="File Analyzer",
        description=(
            "System analysis agent for extracting file structure, symbols, "
            "and dependency relationships."
        ),
        builtin_kind="understand-file-analyzer",
        builtin_label="Understand",
        template_key="understand-file-analyzer",
        skill_names=_UNDERSTAND_AGENT_SKILL_NAMES,
        tools_builder=build_understand_builtin_tools_config,
    ),
    BuiltinAgentSpec(
        id=BUILTIN_UNDERSTAND_ARCHITECTURE_ANALYZER_ID,
        name="Architecture Analyzer",
        description=(
            "System analysis agent for identifying architectural layers, "
            "subsystems, and high-level boundaries."
        ),
        builtin_kind="understand-architecture-analyzer",
        builtin_label="Understand",
        template_key="understand-architecture-analyzer",
        skill_names=_UNDERSTAND_AGENT_SKILL_NAMES,
        tools_builder=build_understand_builtin_tools_config,
    ),
    BuiltinAgentSpec(
        id=BUILTIN_UNDERSTAND_TOUR_BUILDER_ID,
        name="Tour Builder",
        description=(
            "System analysis agent for building guided learning paths and "
            "progressive codebase tours."
        ),
        builtin_kind="understand-tour-builder",
        builtin_label="Understand",
        template_key="understand-tour-builder",
        skill_names=_UNDERSTAND_AGENT_SKILL_NAMES,
        tools_builder=build_understand_builtin_tools_config,
    ),
    BuiltinAgentSpec(
        id=BUILTIN_UNDERSTAND_GRAPH_REVIEWER_ID,
        name="Graph Reviewer",
        description=(
            "System analysis agent for validating graph completeness, "
            "referential integrity, and review findings."
        ),
        builtin_kind="understand-graph-reviewer",
        builtin_label="Understand",
        template_key="understand-graph-reviewer",
        skill_names=_UNDERSTAND_AGENT_SKILL_NAMES,
        tools_builder=build_understand_builtin_tools_config,
    ),
    BuiltinAgentSpec(
        id=BUILTIN_UNDERSTAND_DOMAIN_ANALYZER_ID,
        name="Domain Analyzer",
        description=(
            "System analysis agent for extracting domains, flows, and process "
            "steps from code and project artifacts."
        ),
        builtin_kind="understand-domain-analyzer",
        builtin_label="Understand",
        template_key="understand-domain-analyzer",
        skill_names=_UNDERSTAND_AGENT_SKILL_NAMES,
        tools_builder=build_understand_builtin_tools_config,
    ),
)


BUILTIN_AGENT_SPEC_BY_ID = {spec.id: spec for spec in BUILTIN_AGENT_SPECS}


def get_builtin_agent_spec(agent_id: str) -> BuiltinAgentSpec | None:
    """Return builtin spec for one agent id when available."""
    return BUILTIN_AGENT_SPEC_BY_ID.get(agent_id)


def is_builtin_agent_id(agent_id: str) -> bool:
    """Return whether the agent id belongs to a builtin agent."""
    return agent_id in BUILTIN_AGENT_SPEC_BY_ID