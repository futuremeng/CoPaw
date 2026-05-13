# -*- coding: utf-8 -*-
"""Skill system exports."""

from pathlib import Path

from .models import (
    SkillConflictError,
    SkillInfo,
)
from .pool_service import SkillPoolService
from .registry import (
    apply_skill_config_env_overrides,
    ensure_skill_pool_initialized,
    ensure_skills_initialized,
    reconcile_pool_manifest,
    reconcile_workspace_manifest,
    resolve_effective_skills,
)
from .store import (
    get_skill_pool_dir,
    get_workspace_skills_dir,
    read_skill_manifest,
    read_skill_pool_manifest,
)
from .workspace_service import SkillService
from ...constant import WORKING_DIR


def get_working_skills_dir(workspace_dir: Path | None = None) -> Path:
    """Backward-compatible alias for workspace skill directory."""
    base_dir = Path(workspace_dir) if workspace_dir is not None else WORKING_DIR
    return get_workspace_skills_dir(base_dir)


def list_available_skills(
    workspace_dir: Path | None = None,
) -> list[str]:
    """Return available skill names for compatibility with legacy callers."""
    base_dir = Path(workspace_dir) if workspace_dir is not None else WORKING_DIR
    service = SkillService(base_dir)
    return [skill.name for skill in service.list_available_skills()]

__all__ = [
    "SkillConflictError",
    "SkillInfo",
    "SkillPoolService",
    "SkillService",
    "apply_skill_config_env_overrides",
    "ensure_skill_pool_initialized",
    "ensure_skills_initialized",
    "get_skill_pool_dir",
    "get_working_skills_dir",
    "get_workspace_skills_dir",
    "list_available_skills",
    "read_skill_manifest",
    "read_skill_pool_manifest",
    "reconcile_pool_manifest",
    "reconcile_workspace_manifest",
    "resolve_effective_skills",
]
