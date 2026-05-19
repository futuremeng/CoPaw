# -*- coding: utf-8 -*-
"""Unified project file classification and query helpers.

This module centralizes file-path classification, filtering and aggregation so
routers can consume one consistent rule set.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

StageValue = Literal["original", "intermediate", "artifact", "builtin", "other"]
ContentTypeValue = Literal["markdown", "text", "script", "other"]
SortByValue = Literal["path", "modified_time", "size"]
SortOrderValue = Literal["asc", "desc"]

IGNORED_FILE_NAMES = {
    ".ds_store",
    ".gitkeep",
    "thumbs.db",
}

MARKDOWN_EXTENSIONS = {"md", "mdx"}
TEXT_EXTENSIONS = {
    "txt",
    "csv",
    "json",
    "yaml",
    "yml",
    "xml",
    "html",
    "htm",
    "rtf",
    "toml",
    "ini",
    "sql",
}
SCRIPT_EXTENSIONS = {"py"}

INTERMEDIATE_PREFIXES = (
    "intermediate",
    "data",
    "metadata",
    "cross-book",
    "term-candidates",
    "review",
)


@dataclass(slots=True)
class ProjectFileRecord:
    filename: str
    path: str
    size: int
    modified_time: str
    stage: StageValue
    content_type: ContentTypeValue
    builtin: bool
    ignored: bool

    def to_payload(self) -> dict[str, Any]:
        return {
            "filename": self.filename,
            "path": self.path,
            "size": self.size,
            "modified_time": self.modified_time,
            "stage": self.stage,
            "content_type": self.content_type,
            "builtin": self.builtin,
            "ignored": self.ignored,
        }


def normalize_path(path: str) -> str:
    normalized = str(path or "").replace("\\", "/")
    if normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def normalize_path_lower(path: str) -> str:
    return normalize_path(path).lower()


def has_hidden_directory_segment(rel_path: str) -> bool:
    normalized = normalize_path(rel_path).strip("/")
    if not normalized:
        return False
    segments = [segment for segment in normalized.split("/") if segment]
    if not segments:
        return False
    last_index = len(segments) - 1
    for index, segment in enumerate(segments):
        if segment.startswith(".") and index < last_index:
            return True
    return False


def extension_of_path(rel_path: str) -> str:
    normalized = normalize_path_lower(rel_path)
    file_name = normalized.split("/")[-1] if normalized else ""
    if "." not in file_name:
        return ""
    return file_name.rsplit(".", 1)[-1]


def classify_content_type(rel_path: str) -> ContentTypeValue:
    extension = extension_of_path(rel_path)
    if extension in MARKDOWN_EXTENSIONS:
        return "markdown"
    if extension in TEXT_EXTENSIONS:
        return "text"
    if extension in SCRIPT_EXTENSIONS:
        return "script"
    return "other"


def classify_stage(rel_path: str, *, builtin: bool) -> StageValue:
    if builtin:
        return "builtin"

    normalized = normalize_path_lower(rel_path)
    if normalized == "original" or normalized.startswith("original/"):
        return "original"
    if any(
        normalized.startswith(f"{prefix}/")
        for prefix in INTERMEDIATE_PREFIXES
    ):
        return "intermediate"
    if normalized == "output" or normalized.startswith("output/"):
        return "artifact"
    return "other"


def is_ignored_file(rel_path: str) -> bool:
    file_name = normalize_path_lower(rel_path).split("/")[-1] or ""
    if file_name in IGNORED_FILE_NAMES:
        return True
    normalized = normalize_path_lower(rel_path)
    if normalized.startswith(".git/") or "/.git/" in normalized:
        return True
    return False


def classify_project_file(
    project_root: Path,
    absolute_path: Path,
) -> ProjectFileRecord | None:
    try:
        if not absolute_path.is_file():
            return None
        rel_path = absolute_path.relative_to(project_root).as_posix()
        stat = absolute_path.stat()
    except (OSError, ValueError):
        return None

    builtin = has_hidden_directory_segment(rel_path)
    ignored = is_ignored_file(rel_path)
    stage = classify_stage(rel_path, builtin=builtin)
    content_type = classify_content_type(rel_path)

    return ProjectFileRecord(
        filename=absolute_path.name,
        path=rel_path,
        size=int(stat.st_size),
        modified_time=datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds"),
        stage=stage,
        content_type=content_type,
        builtin=builtin,
        ignored=ignored,
    )


def scan_project_file_records(project_dir: Path) -> list[ProjectFileRecord]:
    project_root = project_dir.resolve()
    records: list[ProjectFileRecord] = []
    for path in sorted(
        project_root.rglob("*"),
        key=lambda item: item.as_posix().lower(),
    ):
        record = classify_project_file(project_root, path)
        if record is None:
            continue
        records.append(record)
    return records


def _parse_iso(value: str | None) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _matches_filters(
    record: ProjectFileRecord,
    *,
    search: str,
    path_prefix: str,
    stages: set[str],
    content_types: set[str],
    include_builtin: bool | None,
    include_ignored: bool,
    size_min: int | None,
    size_max: int | None,
    modified_after: datetime | None,
    modified_before: datetime | None,
) -> bool:
    if not include_ignored and record.ignored:
        return False
    if include_builtin is not None and record.builtin is not include_builtin:
        return False
    if stages and record.stage not in stages:
        return False
    if content_types and record.content_type not in content_types:
        return False
    if path_prefix and not normalize_path_lower(record.path).startswith(path_prefix):
        return False
    if search and search not in normalize_path_lower(record.path):
        return False
    if size_min is not None and record.size < size_min:
        return False
    if size_max is not None and record.size > size_max:
        return False

    modified_time = _parse_iso(record.modified_time)
    if modified_after is not None and modified_time is not None and modified_time < modified_after:
        return False
    if modified_before is not None and modified_time is not None and modified_time > modified_before:
        return False
    return True


def _sort_records(
    records: list[ProjectFileRecord],
    *,
    sort_by: SortByValue,
    sort_order: SortOrderValue,
) -> list[ProjectFileRecord]:
    reverse = sort_order == "desc"
    if sort_by == "size":
        return sorted(records, key=lambda item: (item.size, item.path.lower()), reverse=reverse)
    if sort_by == "modified_time":
        return sorted(
            records,
            key=lambda item: (_parse_iso(item.modified_time) or datetime.min, item.path.lower()),
            reverse=reverse,
        )
    return sorted(records, key=lambda item: item.path.lower(), reverse=reverse)


def query_project_file_records(
    project_dir: Path,
    *,
    search: str = "",
    path_prefix: str = "",
    stages: list[str] | None = None,
    content_types: list[str] | None = None,
    include_builtin: bool | None = None,
    include_ignored: bool = False,
    size_min: int | None = None,
    size_max: int | None = None,
    modified_after: str | None = None,
    modified_before: str | None = None,
    sort_by: SortByValue = "path",
    sort_order: SortOrderValue = "asc",
    offset: int = 0,
    limit: int = 200,
) -> dict[str, Any]:
    records = scan_project_file_records(project_dir)
    normalized_search = str(search or "").strip().lower()
    normalized_prefix = normalize_path_lower(path_prefix).strip("/")
    if normalized_prefix:
        normalized_prefix = f"{normalized_prefix}/" if not normalized_prefix.endswith("/") else normalized_prefix
    stage_set = {str(item or "").strip().lower() for item in (stages or []) if str(item or "").strip()}
    content_type_set = {
        str(item or "").strip().lower()
        for item in (content_types or [])
        if str(item or "").strip()
    }
    modified_after_value = _parse_iso(modified_after)
    modified_before_value = _parse_iso(modified_before)

    filtered = [
        record
        for record in records
        if _matches_filters(
            record,
            search=normalized_search,
            path_prefix=normalized_prefix,
            stages=stage_set,
            content_types=content_type_set,
            include_builtin=include_builtin,
            include_ignored=include_ignored,
            size_min=size_min,
            size_max=size_max,
            modified_after=modified_after_value,
            modified_before=modified_before_value,
        )
    ]

    sorted_records = _sort_records(filtered, sort_by=sort_by, sort_order=sort_order)
    safe_offset = max(0, int(offset))
    safe_limit = max(1, min(1000, int(limit)))
    items = sorted_records[safe_offset : safe_offset + safe_limit]

    stage_counts: dict[str, int] = {
        "original": 0,
        "intermediate": 0,
        "artifact": 0,
        "builtin": 0,
        "other": 0,
    }
    content_type_counts: dict[str, int] = {
        "markdown": 0,
        "text": 0,
        "script": 0,
        "other": 0,
    }
    builtin_count = 0
    ignored_count = 0
    for record in filtered:
        stage_counts[record.stage] = stage_counts.get(record.stage, 0) + 1
        content_type_counts[record.content_type] = content_type_counts.get(record.content_type, 0) + 1
        if record.builtin:
            builtin_count += 1
        if record.ignored:
            ignored_count += 1

    return {
        "items": [item.to_payload() for item in items],
        "summary": {
            "total_matched": len(filtered),
            "offset": safe_offset,
            "limit": safe_limit,
            "returned": len(items),
            "builtin_count": builtin_count,
            "ignored_count": ignored_count,
            "stage_counts": stage_counts,
            "content_type_counts": content_type_counts,
        },
        "query_meta": {
            "search": normalized_search,
            "path_prefix": normalized_prefix,
            "stages": sorted(stage_set),
            "content_types": sorted(content_type_set),
            "include_builtin": include_builtin,
            "include_ignored": include_ignored,
            "sort_by": sort_by,
            "sort_order": sort_order,
        },
    }
