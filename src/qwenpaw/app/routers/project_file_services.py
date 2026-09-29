# -*- coding: utf-8 -*-
"""Project file operation service helpers for router-layer delegation."""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Literal

from fastapi import UploadFile

from . import project_file_ops


ResolveProjectDir = Callable[[Path, str], Path]
UpdateMonitoringState = Callable[[Path, str], bool]
RecordRealtimePaths = Callable[[str | None, list[Path]], None]


def upload_project_file_for_workspace(
    *,
    workspace_dir: Path,
    project_id: str,
    file: UploadFile,
    target_dir: str,
    relative_path: str,
    resolve_project_dir: ResolveProjectDir,
    update_monitoring_state: UpdateMonitoringState,
    record_realtime_paths: RecordRealtimePaths,
    monitoring_active: str,
) -> dict[str, object]:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    uploaded = project_file_ops.upload_project_file(
        project_dir,
        file,
        target_dir,
        relative_path,
    )
    update_monitoring_state(project_dir, monitoring_active)
    record_realtime_paths(
        str(workspace_dir),
        [project_dir / str(uploaded["path"])],
    )
    return uploaded


def delete_project_path_for_workspace(
    *,
    workspace_dir: Path,
    project_id: str,
    target_path: str,
    resolve_project_dir: ResolveProjectDir,
    update_monitoring_state: UpdateMonitoringState,
    record_realtime_paths: RecordRealtimePaths,
    monitoring_active: str,
) -> dict[str, object]:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    deleted = project_file_ops.delete_project_path(project_dir, target_path)
    update_monitoring_state(project_dir, monitoring_active)
    record_realtime_paths(
        str(workspace_dir),
        [project_dir / str(deleted["path"])],
    )
    return deleted


def create_project_directory_for_workspace(
    *,
    workspace_dir: Path,
    project_id: str,
    directory_path: str,
    resolve_project_dir: ResolveProjectDir,
    update_monitoring_state: UpdateMonitoringState,
    record_realtime_paths: RecordRealtimePaths,
    monitoring_active: str,
) -> dict[str, object]:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    created = project_file_ops.create_project_directory(project_dir, directory_path)
    update_monitoring_state(project_dir, monitoring_active)
    record_realtime_paths(
        str(workspace_dir),
        [project_dir / str(created["path"])],
    )
    return created


def move_project_path_for_workspace(
    *,
    workspace_dir: Path,
    project_id: str,
    source_path: str,
    target_path: str,
    conflict_strategy: Literal["fail_if_exists", "overwrite"],
    resolve_project_dir: ResolveProjectDir,
    update_monitoring_state: UpdateMonitoringState,
    record_realtime_paths: RecordRealtimePaths,
    monitoring_active: str,
) -> dict[str, object]:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    moved = project_file_ops.move_project_path(
        project_dir,
        source_path,
        target_path,
        conflict_strategy=conflict_strategy,
    )
    update_monitoring_state(project_dir, monitoring_active)
    record_realtime_paths(
        str(workspace_dir),
        [
            project_dir / str(moved["source_path"]),
            project_dir / str(moved["target_path"]),
        ],
    )
    return moved
