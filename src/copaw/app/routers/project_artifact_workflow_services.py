# -*- coding: utf-8 -*-
"""Project artifact workflow helpers for router-level delegation."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Callable

ResolveProjectDir = Callable[[Path, str], Path]
LoadProjectSummary = Callable[[Path], Any | None]
ReadProjectFrontmatterWithBody = Callable[[Path], tuple[dict[str, Any], str]]
ParseProjectArtifactProfile = Callable[[dict[str, Any]], Any]
NormalizeProjectArtifactStorage = Callable[[Any, str], Any]
NormalizeProjectArtifactProfileStorage = Callable[[Any], Any]
EnsureProjectArtifactLayout = Callable[[Path], None]
WriteProjectFrontmatter = Callable[[Path, dict[str, Any], str], None]
SafeArtifactSlug = Callable[[str, str], str]
GenerateShortAgentId = Callable[[], str]
ReadTextFileWithEncodingFallback = Callable[[Path], str]
BuildPromotedSkillMarkdown = Callable[[Any, str, str], str]
EnablePromotedSkill = Callable[[Path, str], None]
WarnEnablePromotedSkill = Callable[[Exception], None]
HttpExceptionFactory = Callable[..., Exception]


def build_promoted_skill_markdown(
    item: Any,
    project_id: str,
    source_body: str,
) -> str:
    skill_name = item.name.strip() or item.id
    description = item.distillation_note.strip() or (
        f"Promoted from project '{project_id}' skill artifact '{item.id}'."
    )
    version = item.version.strip() or "v0-draft"
    tags = [*item.tags, "project-promoted", f"project:{project_id}"]
    deduped_tags = [tag for tag in dict.fromkeys(tags) if tag]
    tags_text = ", ".join(deduped_tags)
    source_text = source_body.strip()
    if not source_text:
        source_text = item.distillation_note.strip()
    source_block = source_text or "No additional project notes provided."
    return (
        "---\n"
        f"name: {skill_name}\n"
        f"description: {description}\n"
        f"version: {version}\n"
        f"tags: [{tags_text}]\n"
        "---\n\n"
        "## Origin\n"
        f"- project_id: {project_id}\n"
        f"- artifact_id: {item.id}\n"
        f"- source_path: {item.artifact_file_path}\n\n"
        "## Distilled Skill\n\n"
        f"{source_block}\n"
    )


def extract_project_conversation_skill_candidates(
    project_dir: Path,
    *,
    safe_artifact_slug: SafeArtifactSlug,
    generate_short_agent_id: GenerateShortAgentId,
    limit: int = 50,
    run_id: str | None = None,
) -> list[dict[str, str]]:
    runs_dir = project_dir / ".pipelines" / "runs"
    if not runs_dir.exists() or not runs_dir.is_dir():
        return []

    candidates: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    expected_run_id = str(run_id or "").strip().lower()

    for run_dir in sorted(runs_dir.iterdir(), key=lambda item: item.name.lower()):
        if not run_dir.is_dir():
            continue
        manifest_file = run_dir / "run_manifest.json"
        if not manifest_file.exists() or not manifest_file.is_file():
            continue
        try:
            raw_doc = json.loads(manifest_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(raw_doc, dict):
            continue

        current_run_id = str(raw_doc.get("run_id") or run_dir.name).strip() or run_dir.name
        if expected_run_id and current_run_id.lower() != expected_run_id:
            continue
        events = raw_doc.get("collaboration_events") or []
        if not isinstance(events, list):
            continue

        for event in events:
            if not isinstance(event, dict):
                continue
            event_name = str(event.get("event") or "").strip().lower()
            if event_name not in {"step.completed", "run.completed"}:
                continue

            message = str(event.get("message") or "").strip()
            if not message:
                continue

            step_id = str(event.get("step_id") or event_name).strip() or event_name
            artifact_id = safe_artifact_slug(
                f"{current_run_id}-{step_id}",
                f"skill-{generate_short_agent_id()}",
            )
            if artifact_id in seen_ids:
                continue
            seen_ids.add(artifact_id)

            name_seed = message.split(".")[0].strip() or message
            name_tokens = [token for token in name_seed.split() if token]
            if len(name_tokens) > 8:
                name_seed = " ".join(name_tokens[:8])

            rel_manifest_path = manifest_file.resolve().relative_to(project_dir.resolve())
            candidates.append(
                {
                    "id": artifact_id,
                    "name": name_seed,
                    "note": f"[{current_run_id}] {message}",
                    "source_path": rel_manifest_path.as_posix(),
                },
            )
            if len(candidates) >= limit:
                return candidates

    return candidates


def auto_distill_project_skills_to_draft(
    *,
    workspace_dir: Path,
    project_id: str,
    run_id: str | None,
    resolve_project_dir: ResolveProjectDir,
    load_project_summary: LoadProjectSummary,
    read_project_frontmatter_with_body: ReadProjectFrontmatterWithBody,
    parse_project_artifact_profile: ParseProjectArtifactProfile,
    extract_project_conversation_skill_candidates: Callable[[Path, str | None], list[dict[str, str]]],
    safe_artifact_slug: SafeArtifactSlug,
    generate_short_agent_id: GenerateShortAgentId,
    read_text_file_with_encoding_fallback: ReadTextFileWithEncodingFallback,
    project_artifact_item_factory: Callable[..., Any],
    normalize_project_artifact_profile_storage: NormalizeProjectArtifactProfileStorage,
    ensure_project_artifact_layout: EnsureProjectArtifactLayout,
    write_project_frontmatter: WriteProjectFrontmatter,
    distill_project_skills_draft_response_factory: Callable[..., Any],
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
    metadata, content_body = read_project_frontmatter_with_body(metadata_file)
    profile = parse_project_artifact_profile(metadata)
    existing_ids = {item.id for item in profile.skills}

    drafted_ids: list[str] = []
    skipped_count = 0

    if summary.artifact_distill_mode == "conversation_evidence":
        candidates = extract_project_conversation_skill_candidates(project_dir, run_id)
        for candidate in candidates:
            artifact_id = candidate["id"]
            if artifact_id in existing_ids:
                skipped_count += 1
                continue

            profile.skills.append(
                project_artifact_item_factory(
                    id=artifact_id,
                    name=candidate["name"],
                    kind="skill",
                    origin="project-distilled",
                    status="draft",
                    version="v0-draft",
                    artifact_file_path=candidate["source_path"],
                    tags=["auto-draft", "conversation-evidence"],
                    derived_from_ids=[],
                    distillation_note=candidate["note"],
                    market_source_id=None,
                    market_item_id=None,
                ),
            )
            existing_ids.add(artifact_id)
            drafted_ids.append(artifact_id)
    else:
        skills_dir = project_dir / ".skills"
        if not skills_dir.exists() or not skills_dir.is_dir():
            return distill_project_skills_draft_response_factory(
                drafted_count=0,
                skipped_count=0,
                drafted_ids=[],
                artifact_distill_mode=summary.artifact_distill_mode,
                project=summary,
            )

        for md_file in sorted(skills_dir.rglob("*.md"), key=lambda item: item.as_posix()):
            if not md_file.is_file():
                continue
            rel_path = md_file.resolve().relative_to(project_dir.resolve()).as_posix()
            if rel_path.lower().endswith("/skill.md"):
                skipped_count += 1
                continue

            artifact_seed = md_file.relative_to(skills_dir).with_suffix("").as_posix()
            artifact_id = safe_artifact_slug(
                artifact_seed.replace("/", "-"),
                f"skill-{generate_short_agent_id()}",
            )
            if artifact_id in existing_ids:
                skipped_count += 1
                continue

            raw_text = read_text_file_with_encoding_fallback(md_file)
            lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
            heading = next((line.lstrip("#").strip() for line in lines if line.startswith("#")), "")
            name = heading or md_file.stem.replace("-", " ").replace("_", " ").strip()
            if not name:
                name = artifact_id

            note_lines: list[str] = []
            for line in lines:
                if line.startswith("#"):
                    continue
                note_lines.append(line)
                if len(" ".join(note_lines)) >= 240:
                    break
            distillation_note = " ".join(note_lines).strip() or f"Auto drafted from {rel_path}."

            profile.skills.append(
                project_artifact_item_factory(
                    id=artifact_id,
                    name=name,
                    kind="skill",
                    origin="project-distilled",
                    status="draft",
                    version="v0-draft",
                    artifact_file_path=rel_path,
                    tags=["auto-draft"],
                    derived_from_ids=[],
                    distillation_note=distillation_note,
                    market_source_id=None,
                    market_item_id=None,
                ),
            )
            existing_ids.add(artifact_id)
            drafted_ids.append(artifact_id)

    normalized_profile = normalize_project_artifact_profile_storage(profile)
    ensure_project_artifact_layout(project_dir)
    metadata["artifact_profile"] = normalized_profile.model_dump(mode="json", exclude_none=True)
    write_project_frontmatter(metadata_file, metadata, content_body)

    updated_summary = load_project_summary(project_dir)
    if updated_summary is None:
        raise http_exception_factory(
            status_code=500,
            detail="Failed to load project after auto distillation",
        )

    return distill_project_skills_draft_response_factory(
        drafted_count=len(drafted_ids),
        skipped_count=skipped_count,
        drafted_ids=drafted_ids,
        artifact_distill_mode=updated_summary.artifact_distill_mode,
        project=updated_summary,
    )


def confirm_project_skill_stable(
    *,
    workspace_dir: Path,
    project_id: str,
    artifact_id: str,
    resolve_project_dir: ResolveProjectDir,
    load_project_summary: LoadProjectSummary,
    read_project_frontmatter_with_body: ReadProjectFrontmatterWithBody,
    parse_project_artifact_profile: ParseProjectArtifactProfile,
    normalize_project_artifact_storage: NormalizeProjectArtifactStorage,
    write_project_frontmatter: WriteProjectFrontmatter,
    confirm_project_skill_stable_response_factory: Callable[..., Any],
    http_exception_factory: HttpExceptionFactory,
) -> Any:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    summary = load_project_summary(project_dir)
    if summary is None:
        raise http_exception_factory(
            status_code=404,
            detail=f"Project '{project_id}' metadata not found",
        )

    skill_item = next((item for item in summary.artifact_profile.skills if item.id == artifact_id), None)
    if skill_item is None:
        raise http_exception_factory(
            status_code=404,
            detail=f"Skill artifact '{artifact_id}' not found in project",
        )

    metadata_file = Path(summary.metadata_file)
    metadata, content_body = read_project_frontmatter_with_body(metadata_file)
    normalized_profile = parse_project_artifact_profile(metadata)
    for idx, item in enumerate(normalized_profile.skills):
        if item.id != artifact_id:
            continue
        normalized_profile.skills[idx] = normalize_project_artifact_storage(
            item.model_copy(update={"status": "stable"}),
            "skill",
        )
        break

    metadata["artifact_profile"] = normalized_profile.model_dump(mode="json", exclude_none=True)
    write_project_frontmatter(metadata_file, metadata, content_body)

    updated_summary = load_project_summary(project_dir)
    if updated_summary is None:
        raise http_exception_factory(
            status_code=500,
            detail="Failed to load project after confirming stable",
        )

    confirmed_item = next((item for item in updated_summary.artifact_profile.skills if item.id == artifact_id), None)
    if confirmed_item is None:
        raise http_exception_factory(
            status_code=500,
            detail="Failed to read updated skill artifact",
        )

    return confirm_project_skill_stable_response_factory(
        confirmed=True,
        artifact_id=artifact_id,
        status=confirmed_item.status,
        project=updated_summary,
    )


def promote_project_skill_to_agent(
    *,
    workspace_dir: Path,
    project_id: str,
    artifact_id: str,
    body: Any,
    resolve_project_dir: ResolveProjectDir,
    load_project_summary: LoadProjectSummary,
    safe_artifact_slug: SafeArtifactSlug,
    generate_short_agent_id: GenerateShortAgentId,
    build_promoted_skill_markdown: BuildPromotedSkillMarkdown,
    enable_promoted_skill: EnablePromotedSkill,
    warn_enable_promoted_skill: WarnEnablePromotedSkill,
    read_project_frontmatter_with_body: ReadProjectFrontmatterWithBody,
    parse_project_artifact_profile: ParseProjectArtifactProfile,
    normalize_project_artifact_storage: NormalizeProjectArtifactStorage,
    write_project_frontmatter: WriteProjectFrontmatter,
    promote_project_artifact_response_factory: Callable[..., Any],
    http_exception_factory: HttpExceptionFactory,
) -> Any:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    summary = load_project_summary(project_dir)
    if summary is None:
        raise http_exception_factory(
            status_code=404,
            detail=f"Project '{project_id}' metadata not found",
        )

    skill_item = next((item for item in summary.artifact_profile.skills if item.id == artifact_id), None)
    if skill_item is None:
        raise http_exception_factory(
            status_code=404,
            detail=f"Skill artifact '{artifact_id}' not found in project",
        )
    if (skill_item.status or "").strip().lower() != "stable":
        raise http_exception_factory(
            status_code=400,
            detail=(
                "Only stable skill artifacts can be promoted. "
                f"Current status: '{skill_item.status or 'draft'}'."
            ),
        )

    skill_dir_name = safe_artifact_slug(
        body.target_name or skill_item.id,
        f"skill-{generate_short_agent_id()}",
    )
    target_skill_dir = workspace_dir / "skills" / skill_dir_name
    target_skill_md = target_skill_dir / "SKILL.md"
    if target_skill_dir.exists() and not body.overwrite:
        raise http_exception_factory(
            status_code=409,
            detail=(
                f"Target skill '{skill_dir_name}' already exists. "
                "Set overwrite=true to replace it."
            ),
        )

    source_body = ""
    source_path = skill_item.artifact_file_path.strip()
    if source_path:
        source_file = (project_dir / source_path).resolve()
        try:
            source_file.relative_to(project_dir.resolve())
        except ValueError:
            source_file = project_dir / ".skills" / f"{skill_item.id}.md"
        if source_file.exists() and source_file.is_file():
            source_body = source_file.read_text(encoding="utf-8", errors="ignore")

    target_skill_dir.mkdir(parents=True, exist_ok=True)
    promoted_md = build_promoted_skill_markdown(skill_item, project_id, source_body)
    target_skill_md.write_text(promoted_md, encoding="utf-8")

    if body.enable:
        try:
            enable_promoted_skill(workspace_dir, skill_dir_name)
        except Exception as exc:  # pragma: no cover - best effort enable
            warn_enable_promoted_skill(exc)

    metadata_file = Path(summary.metadata_file)
    metadata, content_body = read_project_frontmatter_with_body(metadata_file)
    normalized_profile = parse_project_artifact_profile(metadata)
    for idx, item in enumerate(normalized_profile.skills):
        if item.id != artifact_id:
            continue
        updated_item = item.model_copy(
            update={
                "origin": "project-promoted",
                "market_item_id": skill_dir_name,
            },
        )
        normalized_profile.skills[idx] = normalize_project_artifact_storage(updated_item, "skill")
        break
    metadata["artifact_profile"] = normalized_profile.model_dump(mode="json", exclude_none=True)
    write_project_frontmatter(metadata_file, metadata, content_body)

    updated_summary = load_project_summary(project_dir)
    if updated_summary is None:
        raise http_exception_factory(
            status_code=500,
            detail="Failed to load project after promote",
        )

    return promote_project_artifact_response_factory(
        promoted=True,
        artifact_kind="skill",
        artifact_id=artifact_id,
        target_name=skill_dir_name,
        target_path=str(target_skill_md),
        project=updated_summary,
    )
