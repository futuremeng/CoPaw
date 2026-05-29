# -*- coding: utf-8 -*-
"""Project file operation helpers extracted from qwenpaw agents router.

These helpers are intentionally framework-agnostic and return plain dict payloads
so qwenpaw router wrappers can keep existing response-model contracts.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Literal, NoReturn

from fastapi import HTTPException, UploadFile


def _raise(status_code: int, code: str, message: str) -> NoReturn:
    raise HTTPException(
        status_code=status_code,
        detail={"code": code, "message": message},
    )


def _is_safe_relative_path(rel_path: str) -> bool:
    if not rel_path:
        return False
    candidate = Path(rel_path)
    if candidate.is_absolute() or ".." in candidate.parts:
        return False
    return True


def _format_iso_time(ts: float) -> str:
    from datetime import datetime

    return datetime.fromtimestamp(ts).isoformat(timespec="seconds")


def upload_project_file(
    project_dir: Path,
    upload: UploadFile,
    target_dir: str,
    relative_path: str = "",
) -> dict[str, object]:
    if not upload.filename:
        _raise(400, "PROJECT_UPLOAD_FILENAME_REQUIRED", "Uploaded file must have a filename")

    safe_dir = (target_dir or "").strip().strip("/")
    if safe_dir:
        path = Path(safe_dir)
        if path.is_absolute() or ".." in path.parts:
            _raise(400, "PROJECT_TARGET_DIRECTORY_INVALID", "Invalid target directory")
        safe_dir = path.as_posix().strip("/")
    raw_relative_path = str(relative_path or "").strip().replace("\\", "/")

    if raw_relative_path:
        normalized_relative = Path(raw_relative_path)
        if normalized_relative.is_absolute() or ".." in normalized_relative.parts:
            _raise(400, "PROJECT_RELATIVE_PATH_INVALID", "Invalid relative path")
        normalized_parts = [part for part in normalized_relative.parts if part and part != "."]
        if not normalized_parts:
            _raise(400, "PROJECT_RELATIVE_PATH_INVALID", "Invalid relative path")
        filename = normalized_parts[-1].strip()
        if not filename:
            _raise(400, "PROJECT_FILENAME_INVALID", "Invalid filename")
        relative_tail = Path(*normalized_parts)
    else:
        filename = Path(upload.filename).name.strip()
        if not filename:
            _raise(400, "PROJECT_FILENAME_INVALID", "Invalid filename")
        relative_tail = Path(filename)

    destination_dir = (project_dir / safe_dir).resolve() if safe_dir else project_dir.resolve()
    project_root = project_dir.resolve()
    if not str(destination_dir).startswith(str(project_root)):
        _raise(400, "PROJECT_TARGET_DIRECTORY_INVALID", "Invalid target directory")
    destination_dir.mkdir(parents=True, exist_ok=True)

    destination_path = (destination_dir / relative_tail).resolve()
    if not str(destination_path).startswith(str(project_root)):
        _raise(400, "PROJECT_DESTINATION_PATH_INVALID", "Invalid destination path")
    destination_path.parent.mkdir(parents=True, exist_ok=True)

    content = upload.file.read()
    destination_path.write_bytes(content)

    stat = destination_path.stat()
    rel = destination_path.relative_to(project_root).as_posix()
    return {
        "filename": destination_path.name,
        "path": rel,
        "size": stat.st_size,
        "modified_time": _format_iso_time(stat.st_mtime),
    }


def delete_project_path(
    project_dir: Path,
    rel_path: str,
) -> dict[str, object]:
    normalized = str(rel_path or "").strip().replace("\\", "/")
    if not normalized or normalized in {".", "/"}:
        _raise(400, "PROJECT_FILE_PATH_INVALID", "Invalid file path")
    if not _is_safe_relative_path(normalized):
        _raise(400, "PROJECT_FILE_PATH_INVALID", "Invalid file path")

    project_root = project_dir.resolve()
    target = (project_dir / normalized).resolve()
    if not str(target).startswith(str(project_root)):
        _raise(400, "PROJECT_FILE_PATH_INVALID", "Invalid file path")
    if not target.exists():
        _raise(404, "PROJECT_PATH_NOT_FOUND", f"File or directory '{normalized}' not found")

    if target.is_dir():
        shutil.rmtree(target)
        is_directory = True
    else:
        target.unlink()
        is_directory = False

    return {
        "success": True,
        "path": normalized,
        "is_directory": is_directory,
    }


def create_project_directory(
    project_dir: Path,
    rel_path: str,
) -> dict[str, object]:
    normalized = str(rel_path or "").strip().replace("\\", "/")
    if not normalized or normalized in {".", "/"}:
        _raise(400, "PROJECT_DIRECTORY_PATH_INVALID", "Invalid directory path")
    if not _is_safe_relative_path(normalized):
        _raise(400, "PROJECT_DIRECTORY_PATH_INVALID", "Invalid directory path")

    project_root = project_dir.resolve()
    target = (project_dir / normalized).resolve()
    if not str(target).startswith(str(project_root)):
        _raise(400, "PROJECT_DIRECTORY_PATH_INVALID", "Invalid directory path")

    if target.exists() and not target.is_dir():
        _raise(409, "PROJECT_DIRECTORY_PATH_CONFLICT", "Target path exists as file")

    existed = target.exists() and target.is_dir()
    target.mkdir(parents=True, exist_ok=True)
    return {
        "success": True,
        "path": normalized,
        "existed": existed,
    }


def move_project_path(
    project_dir: Path,
    source_path: str,
    target_path: str,
    *,
    conflict_strategy: Literal["fail_if_exists", "overwrite"] = "fail_if_exists",
) -> dict[str, object]:
    normalized_source = str(source_path or "").strip().replace("\\", "/")
    normalized_target = str(target_path or "").strip().replace("\\", "/")
    if not normalized_source or not normalized_target:
        _raise(400, "PROJECT_MOVE_PATH_INVALID", "Invalid source or target path")
    if not _is_safe_relative_path(normalized_source) or not _is_safe_relative_path(normalized_target):
        _raise(400, "PROJECT_MOVE_PATH_INVALID", "Invalid source or target path")
    if normalized_source == normalized_target:
        _raise(400, "PROJECT_MOVE_IDENTICAL_PATH", "Source and target path are identical")

    project_root = project_dir.resolve()
    source = (project_dir / normalized_source).resolve()
    target = (project_dir / normalized_target).resolve()
    if not str(source).startswith(str(project_root)) or not str(target).startswith(str(project_root)):
        _raise(400, "PROJECT_MOVE_PATH_INVALID", "Invalid source or target path")
    if not source.exists():
        _raise(404, "PROJECT_MOVE_SOURCE_NOT_FOUND", f"Path '{normalized_source}' not found")

    is_directory = source.is_dir()
    if is_directory:
        source_prefix = f"{source.as_posix()}/"
        if target.as_posix().startswith(source_prefix):
            _raise(400, "PROJECT_MOVE_DIRECTORY_INTO_ITSELF", "Cannot move a directory into itself")

    if target.exists():
        if conflict_strategy == "fail_if_exists":
            _raise(409, "PROJECT_MOVE_TARGET_CONFLICT", "Target path already exists")
        if target.is_dir():
            shutil.rmtree(target, ignore_errors=True)
        else:
            target.unlink(missing_ok=True)

    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(target))

    return {
        "success": True,
        "source_path": normalized_source,
        "target_path": normalized_target,
        "is_directory": is_directory,
    }
