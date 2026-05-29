# -*- coding: utf-8 -*-
"""Project scaffold and identity helpers for router-level delegation."""

from __future__ import annotations

import importlib.resources
import json
from pathlib import Path
from typing import Any, Callable

LoadProjectSummary = Callable[[Path], Any | None]
LoadProjectTemplateText = Callable[[str, dict[str, str] | None], str]
LoadBuiltinPipelineDoc = Callable[[], dict[str, Any]]
HttpExceptionFactory = Callable[..., Exception]
Slugify = Callable[[str], str]
GenerateShortAgentId = Callable[[], str]
ListAgentProjects = Callable[[Path], list[Any]]
ReadProjectMetadataWithBody = Callable[[Path], tuple[Path | None, dict[str, Any], str]]
WriteProjectMetadata = Callable[[Path, dict[str, Any], str], None]


def load_project_template_text(
    *,
    relative_path: str,
    replacements: dict[str, str] | None,
    project_template_path_aliases: dict[str, str],
    project_templates_dir: Path,
    default_project_templates: dict[str, str],
    logger: Any,
) -> str:
    content: str | None = None

    candidate_paths = [relative_path]
    alias_path = project_template_path_aliases.get(relative_path)
    if alias_path and alias_path not in candidate_paths:
        candidate_paths.append(alias_path)

    for package_name in ("qwenpaw", "copaw"):
        if content is not None:
            break
        for candidate in candidate_paths:
            try:
                template_resource = importlib.resources.files(package_name).joinpath(
                    "app"
                ).joinpath("project_templates")
                for part in candidate.split("/"):
                    template_resource = template_resource.joinpath(part)
                if template_resource.is_file():
                    content = template_resource.read_text(encoding="utf-8")
                    break
            except Exception:
                continue

    if content is None:
        for candidate in candidate_paths:
            template_path = project_templates_dir / candidate
            if template_path.is_file():
                content = template_path.read_text(encoding="utf-8")
                break

    if content is None:
        content = default_project_templates.get(relative_path)
        if content is None:
            raise FileNotFoundError(
                f"Project template not found: {relative_path}"
            )
        logger.warning(
            "Project template missing from package and source tree; using builtin fallback: %s",
            relative_path,
        )

    for key, value in (replacements or {}).items():
        content = content.replace(f"{{{{{key}}}}}", value)
    return content


def scaffold_project_governance_files(
    *,
    project_dir: Path,
    data_subdir: str,
    project_agent_config_dir: str,
    load_project_template_text: LoadProjectTemplateText,
) -> None:
    agent_config_dir = project_dir / project_agent_config_dir
    agent_config_dir.mkdir(parents=True, exist_ok=True)

    agents_md = agent_config_dir / "AGENTS.md"
    if not agents_md.exists():
        agents_md.write_text(
            load_project_template_text(
                "project/AGENTS.md",
                {"DATA_DIR": data_subdir},
            ),
            encoding="utf-8",
        )

    plan_md = agent_config_dir / "PLAN.md"
    if not plan_md.exists():
        plan_md.write_text(
            "# Project Plan\n\n"
            "Track milestones, risks, and next actions here.\n",
            encoding="utf-8",
        )

    scripts_readme = project_dir / ".scripts" / "README.md"
    scripts_readme.parent.mkdir(parents=True, exist_ok=True)
    if not scripts_readme.exists():
        scripts_readme.write_text(
            load_project_template_text("project/.scripts/README.md", None),
            encoding="utf-8",
        )

    templates_readme = project_dir / ".pipelines" / "templates" / "README.md"
    if not templates_readme.exists():
        templates_readme.write_text(
            load_project_template_text(
                "project/.pipelines/templates/README.md",
                None,
            ),
            encoding="utf-8",
        )

    runs_readme = project_dir / ".pipelines" / "runs" / "README.md"
    runs_readme.parent.mkdir(parents=True, exist_ok=True)
    if not runs_readme.exists():
        runs_readme.write_text(
            load_project_template_text("project/.pipelines/runs/README.md", None),
            encoding="utf-8",
        )

    skill_md = project_dir / ".skills" / "project-artifact-governor" / "SKILL.md"
    skill_md.parent.mkdir(parents=True, exist_ok=True)
    if not skill_md.exists():
        skill_md.write_text(
            load_project_template_text(
                "project/.skills/project-artifact-governor/SKILL.md",
                {"DATA_DIR": data_subdir},
            ),
            encoding="utf-8",
        )


def copy_builtin_pipeline_template_to_project(
    *,
    project_dir: Path,
    load_builtin_pipeline_doc: LoadBuiltinPipelineDoc,
) -> None:
    templates_dir = project_dir / ".pipelines" / "templates"
    templates_dir.mkdir(parents=True, exist_ok=True)

    try:
        source_doc = load_builtin_pipeline_doc()
    except Exception:
        return

    template_id = str(source_doc.get("id") or "").strip()
    if not template_id:
        return

    target_path = templates_dir / f"{template_id}.json"
    new_version = str(source_doc.get("version") or "").strip()

    if target_path.exists():
        try:
            existing = json.loads(target_path.read_text(encoding="utf-8"))
            existing_version = str(existing.get("version") or "").strip()
            if existing_version == new_version:
                return
        except Exception:
            pass

    target_path.write_text(
        json.dumps(source_doc, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def resolve_project_dir(
    *,
    workspace_dir: Path,
    project_id: str,
    projects_dirname: str,
    load_project_summary: LoadProjectSummary,
    http_exception_factory: HttpExceptionFactory,
) -> Path:
    projects_dir = workspace_dir / projects_dirname
    if not projects_dir.exists() or not projects_dir.is_dir():
        raise http_exception_factory(
            status_code=404, detail="Projects directory not found"
        )

    for project_dir in sorted(projects_dir.iterdir(), key=lambda item: item.name.lower()):
        if not project_dir.is_dir():
            continue
        summary = load_project_summary(project_dir)
        if summary is None:
            continue
        if summary.id == project_id or project_dir.name == project_id:
            return project_dir

    raise http_exception_factory(
        status_code=404, detail=f"Project '{project_id}' not found"
    )


def build_unique_project_id(
    *,
    workspace_dir: Path,
    base_id: str,
    list_agent_projects: ListAgentProjects,
    slugify: Slugify,
) -> str:
    projects = list_agent_projects(workspace_dir)
    existing = {item.id for item in projects}
    candidate = slugify(base_id).replace("agent", "project")
    if candidate not in existing:
        return candidate
    index = 2
    while f"{candidate}-{index}" in existing:
        index += 1
    return f"{candidate}-{index}"


def build_random_project_id(
    *,
    workspace_dir: Path,
    list_agent_projects: ListAgentProjects,
    generate_short_agent_id: GenerateShortAgentId,
) -> str:
    projects = list_agent_projects(workspace_dir)
    existing = {item.id for item in projects}
    while True:
        candidate = f"project-{generate_short_agent_id()}"
        if candidate not in existing:
            return candidate


def build_unique_project_name(
    *,
    workspace_dir: Path,
    base_name: str,
    list_agent_projects: ListAgentProjects,
) -> str:
    projects = list_agent_projects(workspace_dir)
    existing = {item.name for item in projects}
    name = (base_name or "").strip() or "Project Clone"
    if name not in existing:
        return name
    index = 2
    while f"{name} ({index})" in existing:
        index += 1
    return f"{name} ({index})"


def iter_project_metadata_files(
    *,
    project_dir: Path,
    project_metadata_relative_paths: tuple[str, ...],
):
    for rel_path in project_metadata_relative_paths:
        candidate = project_dir / rel_path
        if candidate.is_file():
            yield candidate


def default_project_metadata_file(
    *,
    project_dir: Path,
    project_metadata_relative_paths: tuple[str, ...],
) -> Path:
    return project_dir / project_metadata_relative_paths[0]


def read_project_frontmatter_with_body(
    *,
    metadata_file: Path,
    read_project_metadata_with_body: ReadProjectMetadataWithBody,
) -> tuple[dict[str, Any], str]:
    project_dir = metadata_file.parent
    if project_dir.name == ".agent":
        project_dir = project_dir.parent
    resolved_file, metadata, body = read_project_metadata_with_body(project_dir)
    if resolved_file is not None:
        return metadata, body
    if metadata_file.exists():
        return {}, metadata_file.read_text(encoding="utf-8", errors="ignore")
    return {}, ""


def write_project_frontmatter(
    *,
    metadata_file: Path,
    metadata: dict[str, Any],
    body: str,
    write_project_metadata: WriteProjectMetadata,
) -> None:
    write_project_metadata(metadata_file, metadata, body)


def parse_markdown_frontmatter(path: Path) -> tuple[dict[str, Any], str] | None:
    raw = path.read_text(encoding="utf-8", errors="ignore")
    if not raw.startswith("---\n"):
        return None
    lines = raw.splitlines()
    end = -1
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            end = idx
            break
    if end == -1:
        return None

    header = "\n".join(lines[1:end])
    body = "\n".join(lines[end + 1 :]).strip()
    try:
        import yaml

        data = yaml.safe_load(header) or {}
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    return data, body
