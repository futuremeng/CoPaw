# -*- coding: utf-8 -*-
"""Project lifecycle service helpers for router-level delegation."""

from __future__ import annotations

import shutil
import time
from pathlib import Path
from typing import Any, Callable

CreateProject = Callable[[Path, Any], Any]
CloneProject = Callable[[Path, str, Any], Any]
DeleteProject = Callable[[Path, str], Any]
EnsureProjectsLayout = Callable[[Path], None]
BuildUniqueProjectName = Callable[[Path, str], str]
BuildUniqueProjectId = Callable[[Path, str], str]
BuildRandomProjectId = Callable[[Path], str]
SafeProjectDataSubdir = Callable[[str], str]
EnsureProjectArtifactLayout = Callable[[Path], None]
DefaultProjectMetadataFile = Callable[[Path], Path]
NormalizeProjectArtifactProfileStorage = Callable[[Any], Any]
NormalizeProjectArtifactDistillMode = Callable[[Any], str]
FormatIsoTime = Callable[[float], str]
WriteProjectFrontmatter = Callable[[Path, dict[str, Any], str], None]
ScaffoldProjectGovernanceFiles = Callable[[Path, str], None]
CopyBuiltinPipelineTemplateToProject = Callable[[Path], None]
LoadProjectSummary = Callable[[Path], Any | None]
HttpExceptionFactory = Callable[..., Exception]
ResolveProjectDir = Callable[[Path, str], Path]
IterProjectMetadataFiles = Callable[[Path], Any]
ParseMarkdownFrontmatter = Callable[[Path], tuple[dict[str, Any], str] | None]
ParseProjectTags = Callable[[Any], list[str]]
RecordProjectRealtimePaths = Callable[[str | None, list[Path]], None]


def create_project_for_workspace(
    *,
    workspace_dir: Path,
    body: Any,
    create_project: CreateProject,
) -> Any:
    return create_project(workspace_dir, body)


def clone_project_for_workspace(
    *,
    workspace_dir: Path,
    project_id: str,
    body: Any,
    clone_project: CloneProject,
) -> Any:
    return clone_project(workspace_dir, project_id, body)


def delete_project_for_workspace(
    *,
    workspace_dir: Path,
    project_id: str,
    delete_project: DeleteProject,
) -> Any:
    return delete_project(workspace_dir, project_id)


def create_project(
    *,
    workspace_dir: Path,
    body: Any,
    projects_dirname: str,
    project_file_monitoring_idle: str,
    ensure_projects_layout: EnsureProjectsLayout,
    build_unique_project_name: BuildUniqueProjectName,
    build_unique_project_id: BuildUniqueProjectId,
    build_random_project_id: BuildRandomProjectId,
    safe_project_data_subdir: SafeProjectDataSubdir,
    ensure_project_artifact_layout: EnsureProjectArtifactLayout,
    default_project_metadata_file: DefaultProjectMetadataFile,
    normalize_project_artifact_profile_storage: NormalizeProjectArtifactProfileStorage,
    normalize_project_artifact_distill_mode: NormalizeProjectArtifactDistillMode,
    format_iso_time: FormatIsoTime,
    write_project_frontmatter: WriteProjectFrontmatter,
    scaffold_project_governance_files: ScaffoldProjectGovernanceFiles,
    copy_builtin_pipeline_template_to_project: CopyBuiltinPipelineTemplateToProject,
    load_project_summary: LoadProjectSummary,
    http_exception_factory: HttpExceptionFactory,
) -> Any:
    ensure_projects_layout(workspace_dir)

    project_name_seed = (body.name or "").strip() or "New Project"
    project_name = build_unique_project_name(workspace_dir, project_name_seed)
    if (body.id or "").strip():
        project_id_seed = body.id or "project"
        project_id = build_unique_project_id(workspace_dir, project_id_seed)
    else:
        project_id = build_random_project_id(workspace_dir)

    projects_dir = workspace_dir / projects_dirname
    project_dir = projects_dir / project_id
    project_dir.mkdir(parents=True, exist_ok=False)

    data_subdir = safe_project_data_subdir(body.data_dir)
    (project_dir / ".pipelines" / "templates").mkdir(parents=True, exist_ok=True)
    ensure_project_artifact_layout(project_dir)

    metadata_file = default_project_metadata_file(project_dir)
    metadata_file.parent.mkdir(parents=True, exist_ok=True)
    normalized_profile = normalize_project_artifact_profile_storage(
        body.artifact_profile,
    )
    metadata = {
        "id": project_id,
        "name": project_name,
        "description": (body.description or "").strip(),
        "status": (body.status or "active").strip() or "active",
        "created_time": format_iso_time(time.time()),
        "workspacePath": str(project_dir.resolve()),
        "data_dir": data_subdir,
        "tags": [item.strip() for item in body.tags if str(item).strip()],
        "artifact_distill_mode": normalize_project_artifact_distill_mode(
            body.artifact_distill_mode,
        ),
        "project_auto_knowledge_sink": bool(body.project_auto_knowledge_sink),
        "project_agent_knowledge_registered": bool(
            body.project_agent_knowledge_registered,
        ),
        "file_monitoring_state": project_file_monitoring_idle,
        "artifact_profile": normalized_profile.model_dump(
            mode="json",
            exclude_none=True,
        ),
    }
    body_text = (body.description or "").strip() or (
        f"# {project_name}\n\n"
        "## Goal\n\nDescribe the project goal here.\n\n"
        "## Status\n\nActive.\n\n"
        "## Notes\n\nKey decisions, constraints, and context go here.\n"
    )
    write_project_frontmatter(metadata_file, metadata, body_text)
    scaffold_project_governance_files(project_dir, data_subdir)
    copy_builtin_pipeline_template_to_project(project_dir)

    summary = load_project_summary(project_dir)
    if summary is None:
        raise http_exception_factory(
            status_code=500,
            detail="Failed to load created project summary",
        )
    return summary


def clone_project(
    *,
    workspace_dir: Path,
    source_project_id: str,
    body: Any,
    projects_dirname: str,
    resolve_project_dir: ResolveProjectDir,
    load_project_summary: LoadProjectSummary,
    build_unique_project_id: BuildUniqueProjectId,
    build_unique_project_name: BuildUniqueProjectName,
    ensure_project_artifact_layout: EnsureProjectArtifactLayout,
    iter_project_metadata_files: IterProjectMetadataFiles,
    default_project_metadata_file: DefaultProjectMetadataFile,
    parse_markdown_frontmatter: ParseMarkdownFrontmatter,
    parse_project_tags: ParseProjectTags,
    format_iso_time: FormatIsoTime,
    write_project_frontmatter: WriteProjectFrontmatter,
    record_project_realtime_paths: RecordProjectRealtimePaths,
    http_exception_factory: HttpExceptionFactory,
) -> Any:
    source_dir = resolve_project_dir(workspace_dir, source_project_id)
    source_summary = load_project_summary(source_dir)
    if source_summary is None:
        raise http_exception_factory(
            status_code=404,
            detail=f"Project '{source_project_id}' metadata not found",
        )

    cloned_id_seed = body.target_id or f"{source_summary.id}-clone"
    cloned_id = build_unique_project_id(workspace_dir, cloned_id_seed)
    cloned_name_seed = body.target_name or f"{source_summary.name} (Clone)"
    cloned_name = build_unique_project_name(workspace_dir, cloned_name_seed)

    projects_dir = workspace_dir / projects_dirname
    projects_dir.mkdir(parents=True, exist_ok=True)
    target_dir = projects_dir / cloned_id
    shutil.copytree(source_dir, target_dir)

    if not body.include_pipeline_runs:
        runs_dir = target_dir / "pipelines" / "runs"
        if runs_dir.exists() and runs_dir.is_dir():
            shutil.rmtree(runs_dir)

    ensure_project_artifact_layout(target_dir)

    metadata_file = next(
        iter_project_metadata_files(target_dir),
        default_project_metadata_file(target_dir),
    )

    parsed = parse_markdown_frontmatter(metadata_file)
    metadata: dict[str, Any] = {}
    content_body = ""
    if parsed is not None:
        metadata, content_body = parsed
    elif metadata_file.exists():
        content_body = metadata_file.read_text(encoding="utf-8", errors="ignore")

    metadata["id"] = cloned_id
    metadata["name"] = cloned_name
    metadata["created_time"] = format_iso_time(time.time())
    metadata["workspacePath"] = str(target_dir.resolve())
    tags = parse_project_tags(metadata.get("tags"))
    if "cloned" not in tags:
        tags.append("cloned")
    metadata["tags"] = tags
    write_project_frontmatter(metadata_file, metadata, content_body)
    record_project_realtime_paths(
        None,
        [path for path in target_dir.rglob("*") if path.is_file()],
    )

    summary = load_project_summary(target_dir)
    if summary is None:
        raise http_exception_factory(
            status_code=500,
            detail="Failed to load cloned project summary",
        )
    return summary


def delete_project(
    *,
    workspace_dir: Path,
    project_id: str,
    resolve_project_dir: ResolveProjectDir,
    delete_project_response_factory: Callable[..., Any],
) -> Any:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    shutil.rmtree(project_dir)
    return delete_project_response_factory(success=True, project_id=project_id)
