# -*- coding: utf-8 -*-

from pathlib import Path

import pytest
from fastapi import HTTPException

from qwenpaw.app.routers.agents import (
    _auto_distill_project_skills_to_draft,
    _confirm_project_skill_stable,
    ProjectArtifactItem,
    PromoteProjectArtifactRequest,
    _load_project_summary,
    _promote_project_skill_to_agent,
    _write_project_frontmatter,
)


def _build_workspace_with_project(
    workspace_dir: Path,
    *,
    status: str,
    artifact_id: str = "skill-alpha",
) -> tuple[str, Path]:
    project_id = "project-demo"
    project_dir = workspace_dir / "projects" / project_id
    source_rel_path = f".skills/{artifact_id}.md"

    (project_dir / ".skills").mkdir(parents=True, exist_ok=True)
    (project_dir / source_rel_path).write_text(
        "# Distilled notes\n\nUse this skill carefully.\n",
        encoding="utf-8",
    )

    metadata = {
        "id": project_id,
        "name": "Demo Project",
        "description": "For artifact promotion tests",
        "status": "active",
        "data_dir": ".data",
        "artifact_profile": {
            "skills": [
                {
                    "id": artifact_id,
                    "name": "Skill Alpha",
                    "kind": "skill",
                    "status": status,
                    "version": "v1.0.0",
                    "artifact_file_path": source_rel_path,
                    "distillation_note": "alpha distilled",
                    "tags": ["demo"],
                    "derived_from_ids": ["run-1"],
                }
            ],
            "scripts": [],
            "flows": [],
            "cases": [],
        },
    }

    _write_project_frontmatter(
        project_dir / "PROJECT.md",
        metadata,
        "# Demo Project\n",
    )

    return project_id, project_dir


def _build_workspace_with_empty_artifacts(workspace_dir: Path) -> tuple[str, Path]:
    project_id = "project-demo"
    project_dir = workspace_dir / "projects" / project_id
    (project_dir / ".skills").mkdir(parents=True, exist_ok=True)
    (project_dir / ".skills" / "quick_start.md").write_text(
        "# Quick Start\n\nCollect requirements and constraints first.\n",
        encoding="utf-8",
    )
    (project_dir / ".skills" / "legacy_tooling.md").write_text(
        "# Legacy Tooling\n\nWrap old scripts with guard rails.\n",
        encoding="utf-8",
    )

    metadata = {
        "id": project_id,
        "name": "Demo Project",
        "description": "For auto draft tests",
        "status": "active",
        "data_dir": ".data",
        "artifact_profile": {
            "skills": [],
            "scripts": [],
            "flows": [],
            "cases": [],
        },
    }
    _write_project_frontmatter(
        project_dir / "PROJECT.md",
        metadata,
        "# Demo Project\n",
    )
    return project_id, project_dir


def test_promote_project_skill_requires_stable_status(tmp_path: Path) -> None:
    workspace_dir = tmp_path
    project_id, _ = _build_workspace_with_project(
        workspace_dir,
        status="draft",
    )

    with pytest.raises(HTTPException) as exc_info:
        _promote_project_skill_to_agent(
            workspace_dir,
            project_id,
            "skill-alpha",
            PromoteProjectArtifactRequest(),
        )

    assert exc_info.value.status_code == 400
    assert "Only stable skill artifacts can be promoted" in str(
        exc_info.value.detail,
    )


def test_promote_project_skill_writes_target_and_updates_profile(
    tmp_path: Path,
) -> None:
    workspace_dir = tmp_path
    project_id, _ = _build_workspace_with_project(
        workspace_dir,
        status="stable",
    )

    result = _promote_project_skill_to_agent(
        workspace_dir,
        project_id,
        "skill-alpha",
        PromoteProjectArtifactRequest(
            target_name="team_skill_alpha",
            enable=False,
        ),
    )

    assert result.promoted is True
    assert result.target_name == "team_skill_alpha"

    target_md = workspace_dir / "skills" / "team_skill_alpha" / "SKILL.md"
    assert target_md.exists()
    content = target_md.read_text(encoding="utf-8")
    assert "project_id: project-demo" in content
    assert "artifact_id: skill-alpha" in content

    updated = _load_project_summary(workspace_dir / "projects" / project_id)
    assert updated is not None
    promoted_item = next(
        item for item in updated.artifact_profile.skills if item.id == "skill-alpha"
    )
    assert isinstance(promoted_item, ProjectArtifactItem)
    assert promoted_item.origin == "project-promoted"
    assert promoted_item.market_item_id == "team_skill_alpha"


def test_auto_distill_project_skills_creates_draft_entries(tmp_path: Path) -> None:
    workspace_dir = tmp_path
    project_id, _ = _build_workspace_with_empty_artifacts(workspace_dir)

    result = _auto_distill_project_skills_to_draft(workspace_dir, project_id)

    assert result.drafted_count == 2
    assert result.skipped_count == 0
    assert sorted(result.drafted_ids) == ["legacy_tooling", "quick_start"]

    updated = _load_project_summary(workspace_dir / "projects" / project_id)
    assert updated is not None
    ids = sorted(item.id for item in updated.artifact_profile.skills)
    assert ids == ["legacy_tooling", "quick_start"]
    for item in updated.artifact_profile.skills:
        assert item.status == "draft"
        assert item.origin == "project-distilled"


def test_confirm_project_skill_stable_updates_status(tmp_path: Path) -> None:
    workspace_dir = tmp_path
    project_id, _ = _build_workspace_with_project(
        workspace_dir,
        status="draft",
    )

    result = _confirm_project_skill_stable(
        workspace_dir,
        project_id,
        "skill-alpha",
    )

    assert result.confirmed is True
    assert result.status == "stable"

    updated = _load_project_summary(workspace_dir / "projects" / project_id)
    assert updated is not None
    item = next(
        entry for entry in updated.artifact_profile.skills if entry.id == "skill-alpha"
    )
    assert item.status == "stable"
