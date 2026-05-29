# -*- coding: utf-8 -*-
"""Project metadata service helpers for router-level delegation."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

GetProjectArtifactProfile = Callable[[Path, str], Any]
UpdateProjectArtifactProfile = Callable[[Path, str, Any], Any]
UpdateProjectArtifactDistillMode = Callable[[Path, str, str], Any]
UpdateProjectWorkspaceChatBinding = Callable[[Path, str, str], Any]
UpdateProjectKnowledgeSink = Callable[[Path, str, bool], Any]
UpdateProjectKnowledgeRegistration = Callable[[Path, str, bool], Any]
ResolveProjectDir = Callable[[Path, str], Path]
LoadProjectSummary = Callable[[Path], Any | None]
ReadProjectFrontmatterWithBody = Callable[[Path], tuple[dict[str, Any], str]]
NormalizeProjectArtifactProfileStorage = Callable[[Any], Any]
EnsureProjectArtifactLayout = Callable[[Path], None]
WriteProjectFrontmatter = Callable[[Path, dict[str, Any], str], None]
WriteProjectMetadata = Callable[[Path, dict[str, Any], str], None]
NormalizeProjectArtifactDistillMode = Callable[[Any], str]
HttpExceptionFactory = Callable[..., Exception]
LoadConfig = Callable[[], Any]
EnsureProjectSourceRegistered = Callable[..., tuple[Any, bool]]
BuildProjectSourceSpec = Callable[..., Any]
SaveConfig = Callable[[Any], None]
ProjectKnowledgePipelineManagerFactory = Callable[..., Any]


def get_project_artifact_profile_for_workspace(
    *,
    workspace_dir: Path,
    project_id: str,
    get_profile: GetProjectArtifactProfile,
) -> Any:
    return get_profile(workspace_dir, project_id)


def update_project_artifact_profile_for_workspace(
    *,
    workspace_dir: Path,
    project_id: str,
    body: Any,
    update_profile: UpdateProjectArtifactProfile,
) -> Any:
    return update_profile(workspace_dir, project_id, body)


def update_project_artifact_distill_mode_for_workspace(
    *,
    workspace_dir: Path,
    project_id: str,
    artifact_distill_mode: str,
    update_distill_mode: UpdateProjectArtifactDistillMode,
) -> Any:
    return update_distill_mode(workspace_dir, project_id, artifact_distill_mode)


def update_project_workspace_chat_binding_for_workspace(
    *,
    workspace_dir: Path,
    project_id: str,
    preferred_workspace_chat_id: str | None,
    update_binding: UpdateProjectWorkspaceChatBinding,
) -> Any:
    return update_binding(
        workspace_dir,
        project_id,
        preferred_workspace_chat_id,
    )


def update_project_knowledge_sink_for_workspace(
    *,
    workspace_dir: Path,
    project_id: str,
    project_auto_knowledge_sink: bool,
    update_knowledge_sink: UpdateProjectKnowledgeSink,
) -> Any:
    return update_knowledge_sink(
        workspace_dir,
        project_id,
        project_auto_knowledge_sink,
    )


def update_project_knowledge_registration_for_workspace(
    *,
    workspace_dir: Path,
    project_id: str,
    project_agent_knowledge_registered: bool,
    update_knowledge_registration: UpdateProjectKnowledgeRegistration,
) -> Any:
    return update_knowledge_registration(
        workspace_dir,
        project_id,
        project_agent_knowledge_registered,
    )


def get_project_artifact_profile(
    *,
    workspace_dir: Path,
    project_id: str,
    resolve_project_dir: ResolveProjectDir,
    load_project_summary: LoadProjectSummary,
    http_exception_factory: HttpExceptionFactory,
) -> Any:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    summary = load_project_summary(project_dir)
    if summary is None:
        raise http_exception_factory(
            status_code=404,
            detail=f"Project '{project_id}' metadata not found",
        )
    return summary.artifact_profile


def update_project_artifact_profile(
    *,
    workspace_dir: Path,
    project_id: str,
    profile: Any,
    resolve_project_dir: ResolveProjectDir,
    load_project_summary: LoadProjectSummary,
    read_project_frontmatter_with_body: ReadProjectFrontmatterWithBody,
    normalize_project_artifact_profile_storage: NormalizeProjectArtifactProfileStorage,
    ensure_project_artifact_layout: EnsureProjectArtifactLayout,
    write_project_frontmatter: WriteProjectFrontmatter,
    http_exception_factory: HttpExceptionFactory,
) -> Any:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    summary = load_project_summary(project_dir)
    if summary is None:
        raise http_exception_factory(
            status_code=404,
            detail=f"Project '{project_id}' metadata not found",
        )

    metadata_file = Path(summary.metadata_file)
    metadata, body = read_project_frontmatter_with_body(metadata_file)
    normalized_profile = normalize_project_artifact_profile_storage(profile)
    ensure_project_artifact_layout(project_dir)
    metadata["artifact_profile"] = normalized_profile.model_dump(
        mode="json",
        exclude_none=True,
    )
    write_project_frontmatter(metadata_file, metadata, body)

    updated = load_project_summary(project_dir)
    if updated is None:
        raise http_exception_factory(
            status_code=500,
            detail="Failed to load updated project summary",
        )
    return updated


def update_project_artifact_distill_mode(
    *,
    workspace_dir: Path,
    project_id: str,
    artifact_distill_mode: str,
    resolve_project_dir: ResolveProjectDir,
    load_project_summary: LoadProjectSummary,
    read_project_frontmatter_with_body: ReadProjectFrontmatterWithBody,
    normalize_project_artifact_distill_mode: NormalizeProjectArtifactDistillMode,
    write_project_frontmatter: WriteProjectFrontmatter,
    http_exception_factory: HttpExceptionFactory,
) -> Any:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    summary = load_project_summary(project_dir)
    if summary is None:
        raise http_exception_factory(
            status_code=404,
            detail=f"Project '{project_id}' metadata not found",
        )

    metadata_file = Path(summary.metadata_file)
    metadata, body = read_project_frontmatter_with_body(metadata_file)
    metadata["artifact_distill_mode"] = normalize_project_artifact_distill_mode(
        artifact_distill_mode,
    )
    write_project_frontmatter(metadata_file, metadata, body)

    updated = load_project_summary(project_dir)
    if updated is None:
        raise http_exception_factory(
            status_code=500,
            detail="Failed to load updated project summary",
        )
    return updated


def update_project_workspace_chat_binding(
    *,
    workspace_dir: Path,
    project_id: str,
    preferred_workspace_chat_id: str,
    resolve_project_dir: ResolveProjectDir,
    load_project_summary: LoadProjectSummary,
    read_project_frontmatter_with_body: ReadProjectFrontmatterWithBody,
    write_project_metadata: WriteProjectMetadata,
    http_exception_factory: HttpExceptionFactory,
) -> Any:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    summary = load_project_summary(project_dir)
    if summary is None:
        raise http_exception_factory(
            status_code=404,
            detail=f"Project '{project_id}' metadata not found",
        )

    metadata_file = Path(summary.metadata_file)
    metadata, body = read_project_frontmatter_with_body(metadata_file)
    metadata["preferred_workspace_chat_id"] = preferred_workspace_chat_id.strip()
    write_project_metadata(metadata_file, metadata, body)

    updated = load_project_summary(project_dir)
    if updated is None:
        raise http_exception_factory(
            status_code=500,
            detail="Failed to load updated project summary",
        )
    return updated


def update_project_auto_knowledge_sink(
    *,
    workspace_dir: Path,
    project_id: str,
    project_auto_knowledge_sink: bool,
    resolve_project_dir: ResolveProjectDir,
    load_project_summary: LoadProjectSummary,
    read_project_frontmatter_with_body: ReadProjectFrontmatterWithBody,
    write_project_metadata: WriteProjectMetadata,
    http_exception_factory: HttpExceptionFactory,
) -> Any:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    summary = load_project_summary(project_dir)
    if summary is None:
        raise http_exception_factory(
            status_code=404,
            detail=f"Project '{project_id}' metadata not found",
        )

    metadata_file = Path(summary.metadata_file)
    metadata, body = read_project_frontmatter_with_body(metadata_file)
    metadata["project_auto_knowledge_sink"] = bool(project_auto_knowledge_sink)
    write_project_metadata(metadata_file, metadata, body)

    updated = load_project_summary(project_dir)
    if updated is None:
        raise http_exception_factory(
            status_code=500,
            detail="Failed to load updated project summary",
        )
    return updated


def sync_project_agent_knowledge_registration(
    *,
    summary: Any,
    enabled: bool,
    load_config: LoadConfig,
    ensure_project_source_registered: EnsureProjectSourceRegistered,
    build_project_source_spec: BuildProjectSourceSpec,
    save_config: SaveConfig,
) -> None:
    config = load_config()
    changed = False

    if enabled:
        _, changed = ensure_project_source_registered(
            config.knowledge,
            project_id=summary.id,
            project_name=summary.name,
            project_workspace_dir=summary.workspace_dir,
            persist=None,
        )
    else:
        expected_source = build_project_source_spec(
            project_id=summary.id,
            project_name=summary.name,
            project_workspace_dir=summary.workspace_dir,
        )
        filtered_sources = [
            source for source in config.knowledge.sources if source.id != expected_source.id
        ]
        if len(filtered_sources) != len(config.knowledge.sources):
            config.knowledge.sources = filtered_sources
            changed = True

    if changed:
        save_config(config)


def update_project_agent_knowledge_registration(
    *,
    workspace_dir: Path,
    project_id: str,
    project_agent_knowledge_registered: bool,
    resolve_project_dir: ResolveProjectDir,
    load_project_summary: LoadProjectSummary,
    sync_project_agent_knowledge_registration: Callable[[Any, bool], None],
    read_project_frontmatter_with_body: ReadProjectFrontmatterWithBody,
    write_project_metadata: WriteProjectMetadata,
    http_exception_factory: HttpExceptionFactory,
) -> Any:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    summary = load_project_summary(project_dir)
    if summary is None:
        raise http_exception_factory(
            status_code=404,
            detail=f"Project '{project_id}' metadata not found",
        )

    enabled = bool(project_agent_knowledge_registered)
    sync_project_agent_knowledge_registration(summary, enabled)

    metadata_file = Path(summary.metadata_file)
    metadata, body = read_project_frontmatter_with_body(metadata_file)
    metadata["project_agent_knowledge_registered"] = enabled
    write_project_metadata(metadata_file, metadata, body)

    updated = load_project_summary(project_dir)
    if updated is None:
        raise http_exception_factory(
            status_code=500,
            detail="Failed to load updated project summary",
        )
    return updated


def maybe_start_project_auto_knowledge_sync(
    *,
    workspace: Any,
    project_id: str,
    changed_paths: list[str] | None,
    trigger: str,
    project_file_monitoring_active: str,
    default_trigger: str,
    default_project_pipeline_debounce_seconds: int,
    default_project_pipeline_cooldown_seconds: int,
    resolve_project_dir: ResolveProjectDir,
    load_project_summary: LoadProjectSummary,
    load_config: LoadConfig,
    build_project_source_spec: BuildProjectSourceSpec,
    project_knowledge_pipeline_manager_factory: ProjectKnowledgePipelineManagerFactory,
) -> dict[str, Any] | None:
    workspace_dir = Path(str(getattr(workspace, "workspace_dir", "") or "")).resolve()
    if not workspace_dir.exists():
        return None

    project_dir = resolve_project_dir(workspace_dir, project_id)
    summary = load_project_summary(project_dir)
    if (
        summary is None
        or not summary.project_auto_knowledge_sink
        or not summary.project_agent_knowledge_registered
        or summary.file_monitoring_state != project_file_monitoring_active
    ):
        return None

    config = load_config()
    knowledge_config = config.knowledge.model_copy(deep=True)
    setattr(knowledge_config, "nlp", config.nlp.model_copy(deep=True))
    if not knowledge_config.enabled or not bool(
        getattr(knowledge_config, "memify_enabled", False)
    ):
        return None

    source = build_project_source_spec(
        project_id=project_id,
        project_name=summary.name or project_id,
        project_workspace_dir=str(project_dir),
    )
    running_config = (
        getattr(getattr(workspace, "config", None), "running", None)
        or config.agents.running
    )
    manager = project_knowledge_pipeline_manager_factory(
        workspace_dir,
        knowledge_dirname=f"projects/{project_id}/.knowledge",
    )
    return manager.start_sync(
        project_id=project_id,
        config=knowledge_config,
        running_config=running_config,
        source=source,
        trigger=(trigger or default_trigger).strip() or default_trigger,
        changed_paths=changed_paths,
        auto_enabled=True,
        force=False,
        debounce_seconds=default_project_pipeline_debounce_seconds,
        cooldown_seconds=default_project_pipeline_cooldown_seconds,
    )
