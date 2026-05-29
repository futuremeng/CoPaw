# -*- coding: utf-8 -*-
"""Project summary service helpers for router-level delegation."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

ReadProjectMetadataWithBody = Callable[[Path], tuple[Path | None, dict[str, Any], str]]
SafeProjectDataSubdir = Callable[[str], str]
FirstNonemptyLine = Callable[[str], str]
ParseProjectTags = Callable[[Any], list[str]]
NormalizeProjectArtifactDistillMode = Callable[[Any], str]
ParseProjectArtifactProfile = Callable[[dict[str, Any]], Any]
NormalizeProjectAutoKnowledgeSink = Callable[[Any], bool]
NormalizeProjectAgentKnowledgeRegistered = Callable[[Any], bool]
NormalizeProjectFileMonitoringState = Callable[[Any], str]
ResolveProjectCreatedTime = Callable[[dict[str, Any], Path], str]
FormatIsoTime = Callable[[float], str]
ProjectSummaryFactory = Callable[..., Any]
LoadProjectSummary = Callable[[Path], Any]
LoadProjectTemplateText = Callable[[str], str]


def load_project_summary(
    *,
    project_dir: Path,
    read_project_metadata_with_body: ReadProjectMetadataWithBody,
    safe_project_data_subdir: SafeProjectDataSubdir,
    first_nonempty_line: FirstNonemptyLine,
    parse_project_tags: ParseProjectTags,
    normalize_project_artifact_distill_mode: NormalizeProjectArtifactDistillMode,
    parse_project_artifact_profile: ParseProjectArtifactProfile,
    normalize_project_auto_knowledge_sink: NormalizeProjectAutoKnowledgeSink,
    normalize_project_agent_knowledge_registered: NormalizeProjectAgentKnowledgeRegistered,
    normalize_project_file_monitoring_state: NormalizeProjectFileMonitoringState,
    resolve_project_created_time: ResolveProjectCreatedTime,
    format_iso_time: FormatIsoTime,
    project_summary_factory: ProjectSummaryFactory,
) -> Any | None:
    metadata_file, metadata, body = read_project_metadata_with_body(project_dir)
    if metadata_file is None:
        return None

    data_subdir = safe_project_data_subdir(
        str(metadata.get("data_dir") or metadata.get("dataDir") or "output"),
    )
    project_id = (
        str(metadata.get("id") or project_dir.name).strip() or project_dir.name
    )
    project_name = (
        str(metadata.get("name") or project_dir.name).strip() or project_dir.name
    )
    description = str(
        metadata.get("description") or first_nonempty_line(body)
    ).strip()
    status = str(metadata.get("status") or "active").strip() or "active"
    tags = parse_project_tags(metadata.get("tags"))
    artifact_distill_mode = normalize_project_artifact_distill_mode(
        metadata.get("artifact_distill_mode") or metadata.get("distill_mode"),
    )
    artifact_profile = parse_project_artifact_profile(metadata)
    project_auto_knowledge_sink = normalize_project_auto_knowledge_sink(
        metadata.get("project_auto_knowledge_sink"),
    )
    project_agent_knowledge_registered = normalize_project_agent_knowledge_registered(
        metadata.get("project_agent_knowledge_registered"),
    )
    file_monitoring_state = normalize_project_file_monitoring_state(
        metadata.get("file_monitoring_state"),
    )
    preferred_workspace_chat_id = str(
        metadata.get("preferred_workspace_chat_id")
        or metadata.get("preferred_workspace_chat")
        or "",
    ).strip()
    created_time = resolve_project_created_time(metadata, metadata_file)
    updated_time = format_iso_time(metadata_file.stat().st_mtime)

    return project_summary_factory(
        id=project_id,
        name=project_name,
        description=description,
        status=status,
        workspace_dir=str(project_dir),
        data_dir=str(project_dir / data_subdir),
        metadata_file=str(metadata_file),
        tags=tags,
        artifact_distill_mode=artifact_distill_mode,
        artifact_profile=artifact_profile,
        project_auto_knowledge_sink=project_auto_knowledge_sink,
        project_agent_knowledge_registered=project_agent_knowledge_registered,
        file_monitoring_state=file_monitoring_state,
        preferred_workspace_chat_id=preferred_workspace_chat_id,
        created_time=created_time,
        updated_time=updated_time,
    )


def list_agent_projects(
    *,
    workspace_dir: Path,
    projects_dirname: str,
    load_project_summary: LoadProjectSummary,
) -> list[Any]:
    projects_dir = workspace_dir / projects_dirname
    if not projects_dir.exists() or not projects_dir.is_dir():
        return []

    projects: list[Any] = []
    for project_dir in sorted(
        projects_dir.iterdir(), key=lambda item: item.name.lower()
    ):
        if not project_dir.is_dir():
            continue
        summary = load_project_summary(project_dir)
        if summary is not None:
            projects.append(summary)
    return projects


def ensure_projects_layout(
    *,
    workspace_dir: Path,
    projects_dirname: str,
    load_project_template_text: LoadProjectTemplateText,
) -> None:
    projects_dir = workspace_dir / projects_dirname
    projects_dir.mkdir(parents=True, exist_ok=True)
    readme_path = projects_dir / "README.md"
    if readme_path.exists():
        return

    readme_path.write_text(
        load_project_template_text("projects/README.md"),
        encoding="utf-8",
    )


def first_nonempty_line(text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip().lstrip("#").strip()
        if stripped:
            return stripped
    return ""
