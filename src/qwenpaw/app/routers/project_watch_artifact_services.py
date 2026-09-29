# -*- coding: utf-8 -*-
"""Project watch lease and skill artifact service helpers for router delegation."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

ResolveProjectDir = Callable[[Path, str], Path]
AcquireProjectWatchLease = Callable[[Path], dict[str, Any]]
ReleaseProjectWatchLease = Callable[[Path, str], dict[str, Any]]
AutoDistillProjectSkillsToDraft = Callable[[Path, str, str | None], Any]
ConfirmProjectSkillStable = Callable[[Path, str, str], Any]
PromoteProjectSkillToAgent = Callable[[Path, str, str, Any], Any]
ScheduleAgentReload = Callable[[Any, str], None]


def acquire_project_knowledge_watch_lease_for_workspace(
    *,
    workspace_dir: Path,
    project_id: str,
    resolve_project_dir: ResolveProjectDir,
    acquire_watch_lease: AcquireProjectWatchLease,
) -> dict[str, Any]:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    return acquire_watch_lease(project_dir)


def release_project_knowledge_watch_lease_for_workspace(
    *,
    workspace_dir: Path,
    project_id: str,
    lease_id: str,
    resolve_project_dir: ResolveProjectDir,
    release_watch_lease: ReleaseProjectWatchLease,
) -> dict[str, Any]:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    return release_watch_lease(project_dir, lease_id)


def auto_distill_project_skills_draft_for_workspace(
    *,
    workspace_dir: Path,
    project_id: str,
    run_id: str | None,
    auto_distill: AutoDistillProjectSkillsToDraft,
) -> Any:
    return auto_distill(workspace_dir, project_id, run_id)


def confirm_project_skill_stable_for_workspace(
    *,
    workspace_dir: Path,
    project_id: str,
    artifact_id: str,
    confirm_skill_stable: ConfirmProjectSkillStable,
) -> Any:
    return confirm_skill_stable(workspace_dir, project_id, artifact_id)


def promote_project_skill_artifact_for_workspace(
    *,
    workspace_dir: Path,
    project_id: str,
    artifact_id: str,
    body: Any,
    request: Any,
    agent_id: str,
    promote_project_skill: PromoteProjectSkillToAgent,
    schedule_agent_reload: ScheduleAgentReload,
) -> Any:
    result = promote_project_skill(
        workspace_dir,
        project_id,
        artifact_id,
        body,
    )
    if body.enable:
        schedule_agent_reload(request, agent_id)
    return result
