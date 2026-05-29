# -*- coding: utf-8 -*-
"""Project artifact/metadata normalization helpers for router delegation."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Callable

NormalizeProjectCreatedTime = Callable[[Any], str]
FormatIsoTime = Callable[[float], str]
Slugify = Callable[[str], str]


def normalize_project_artifact_distill_mode(
    raw_value: Any,
    *,
    artifact_distill_modes: set[str],
) -> str:
    mode = str(raw_value or "").strip().lower()
    if mode in artifact_distill_modes:
        return mode
    return "file_scan"


def normalize_project_auto_knowledge_sink(raw_value: Any) -> bool:
    if isinstance(raw_value, bool):
        return raw_value
    if isinstance(raw_value, (int, float)):
        return bool(raw_value)
    text = str(raw_value or "").strip().lower()
    if not text:
        return True
    if text in {"1", "true", "yes", "on", "enabled"}:
        return True
    if text in {"0", "false", "no", "off", "disabled"}:
        return False
    return True


def normalize_project_agent_knowledge_registered(raw_value: Any) -> bool:
    if isinstance(raw_value, bool):
        return raw_value
    if isinstance(raw_value, (int, float)):
        return bool(raw_value)
    text = str(raw_value or "").strip().lower()
    if not text:
        return False
    if text in {"1", "true", "yes", "on", "enabled"}:
        return True
    if text in {"0", "false", "no", "off", "disabled"}:
        return False
    return False


def normalize_project_created_time(raw_value: Any) -> str:
    created_time = str(raw_value or "").strip()
    if not created_time:
        return ""
    try:
        normalized = datetime.fromisoformat(created_time.replace("Z", "+00:00"))
    except ValueError:
        return created_time
    return normalized.isoformat(timespec="seconds")


def resolve_project_created_time(
    metadata: dict[str, Any],
    metadata_file: Path,
    *,
    normalize_project_created_time: NormalizeProjectCreatedTime,
    format_iso_time: FormatIsoTime,
) -> str:
    created_time = normalize_project_created_time(
        metadata.get("created_time") or metadata.get("createdAt")
    )
    if created_time:
        return created_time

    stat_result = metadata_file.stat()
    birthtime = getattr(stat_result, "st_birthtime", 0.0) or 0.0
    if birthtime > 0:
        return format_iso_time(birthtime)

    fallback_ts = min(stat_result.st_ctime, stat_result.st_mtime)
    return format_iso_time(fallback_ts)


def safe_project_data_subdir(raw_value: str) -> str:
    candidate = (raw_value or "").strip() or "output"
    path = Path(candidate)
    if path.is_absolute() or ".." in path.parts:
        return "output"
    normalized = path.as_posix().strip("/")
    return normalized or "output"


def parse_project_tags(raw_tags: Any) -> list[str]:
    if isinstance(raw_tags, list):
        return [str(item).strip() for item in raw_tags if str(item).strip()]
    if isinstance(raw_tags, str):
        return [item.strip() for item in raw_tags.split(",") if item.strip()]
    return []


def safe_artifact_slug(
    raw_value: str,
    fallback: str,
    *,
    slugify: Slugify,
) -> str:
    slug = slugify(raw_value)
    if not slug or slug == "agent":
        return fallback
    return slug


def build_project_artifact_file_path(
    kind: str,
    artifact_id: str,
    version: str,
    *,
    project_artifact_dir_by_kind: dict[str, str],
    safe_artifact_slug: Callable[[str, str], str],
) -> str:
    kind_dir = project_artifact_dir_by_kind.get(kind, "artifacts")
    artifact_slug = safe_artifact_slug(artifact_id, f"{kind}-item")
    version_slug = safe_artifact_slug(version, "v0-draft")
    return f"{kind_dir}/{artifact_slug}/{version_slug}.md"


def parse_project_artifact_version_history(raw_value: Any) -> list[dict[str, str]]:
    if not isinstance(raw_value, list):
        return []

    history: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in raw_value:
        version = ""
        file_path = ""
        note = ""
        if isinstance(item, str):
            version = item.strip()
        elif isinstance(item, dict):
            version = str(item.get("version") or "").strip()
            file_path = str(item.get("file_path") or "").strip()
            note = str(item.get("note") or "").strip()
        if not version:
            continue
        key = (version, file_path)
        if key in seen:
            continue
        seen.add(key)
        payload: dict[str, str] = {"version": version}
        if file_path:
            payload["file_path"] = file_path
        if note:
            payload["note"] = note
        history.append(payload)
    return history


def normalize_project_artifact_storage(
    item: Any,
    kind: str,
    *,
    build_project_artifact_file_path: Callable[[str, str, str], str],
    parse_project_artifact_version_history: Callable[[Any], list[dict[str, str]]],
) -> Any:
    file_path = item.artifact_file_path.strip() or build_project_artifact_file_path(
        kind,
        item.id,
        item.version,
    )
    history = parse_project_artifact_version_history(item.version_history)

    current_version = item.version.strip() or "v0-draft"
    current_entry = {
        "version": current_version,
        "file_path": file_path,
    }
    current_key = (
        current_entry["version"],
        current_entry["file_path"],
    )
    existing_keys = {
        (
            str(entry.get("version") or "").strip(),
            str(entry.get("file_path") or "").strip(),
        )
        for entry in history
    }
    if current_key not in existing_keys:
        history.append(current_entry)

    return item.model_copy(
        update={
            "artifact_file_path": file_path,
            "version_history": history,
        },
    )


def normalize_project_artifact_profile_storage(
    profile: Any,
    *,
    normalize_project_artifact_storage: Callable[[Any, str], Any],
    project_artifact_profile_factory: Callable[..., Any],
) -> Any:
    return project_artifact_profile_factory(
        skills=[
            normalize_project_artifact_storage(item, "skill")
            for item in profile.skills
        ],
        scripts=[
            normalize_project_artifact_storage(item, "script")
            for item in profile.scripts
        ],
        flows=[
            normalize_project_artifact_storage(item, "flow")
            for item in profile.flows
        ],
        cases=[
            normalize_project_artifact_storage(item, "case")
            for item in profile.cases
        ],
    )


def ensure_project_artifact_layout(
    project_dir: Path,
    *,
    project_precreated_artifact_dirs: tuple[str, ...],
) -> None:
    for dirname in project_precreated_artifact_dirs:
        (project_dir / dirname).mkdir(parents=True, exist_ok=True)


def normalize_project_artifact_item(
    raw_item: Any,
    kind: str,
    *,
    project_artifact_item_factory: Callable[..., Any],
    parse_project_artifact_version_history: Callable[[Any], list[dict[str, str]]],
    parse_project_tags: Callable[[Any], list[str]],
    normalize_project_artifact_storage: Callable[[Any, str], Any],
) -> Any | None:
    if isinstance(raw_item, str):
        normalized = raw_item.strip()
        if not normalized:
            return None
        return project_artifact_item_factory(
            id=normalized,
            name=normalized,
            kind=kind,
        )

    if not isinstance(raw_item, dict):
        return None

    item_id = str(raw_item.get("id") or raw_item.get("name") or "").strip()
    if not item_id:
        return None

    item_name = str(raw_item.get("name") or item_id).strip() or item_id
    origin = str(raw_item.get("origin") or "project-distilled").strip() or "project-distilled"
    status = str(raw_item.get("status") or "draft").strip() or "draft"
    version = str(raw_item.get("version") or "").strip()
    artifact_file_path = str(raw_item.get("artifact_file_path") or "").strip()
    version_history = parse_project_artifact_version_history(
        raw_item.get("version_history"),
    )
    tags = parse_project_tags(raw_item.get("tags"))
    derived_from_ids = parse_project_tags(raw_item.get("derived_from_ids"))
    distillation_note = str(raw_item.get("distillation_note") or "").strip()
    market_source_id = str(raw_item.get("market_source_id") or "").strip() or None
    market_item_id = str(raw_item.get("market_item_id") or "").strip() or None

    item = project_artifact_item_factory(
        id=item_id,
        name=item_name,
        kind=kind,
        origin=origin,
        status=status,
        version=version,
        artifact_file_path=artifact_file_path,
        version_history=version_history,
        tags=tags,
        derived_from_ids=derived_from_ids,
        distillation_note=distillation_note,
        market_source_id=market_source_id,
        market_item_id=market_item_id,
    )
    return normalize_project_artifact_storage(item, kind)


def parse_project_artifact_list(
    raw_value: Any,
    kind: str,
    *,
    normalize_project_artifact_item: Callable[[Any, str], Any | None],
) -> list[Any]:
    if raw_value is None:
        return []

    if isinstance(raw_value, list):
        raw_list = raw_value
    elif isinstance(raw_value, str):
        raw_list = [raw_value]
    else:
        return []

    result: list[Any] = []
    seen: set[str] = set()
    for raw_item in raw_list:
        normalized = normalize_project_artifact_item(raw_item, kind)
        if normalized is None or normalized.id in seen:
            continue
        seen.add(normalized.id)
        result.append(normalized)
    return result


def parse_project_artifact_profile(
    metadata: dict[str, Any],
    *,
    parse_project_artifact_list: Callable[[Any, str], list[Any]],
    project_artifact_profile_factory: Callable[..., Any],
) -> Any:
    raw_profile = metadata.get("artifact_profile")
    if not isinstance(raw_profile, dict):
        raw_profile = metadata.get("artifacts")
    if not isinstance(raw_profile, dict):
        raw_profile = {}

    skills_raw = raw_profile.get("skills")
    if skills_raw is None:
        skills_raw = raw_profile.get("skill")
    if skills_raw is None:
        skills_raw = metadata.get("skills")

    scripts_raw = raw_profile.get("scripts")
    if scripts_raw is None:
        scripts_raw = raw_profile.get("script")
    if scripts_raw is None:
        scripts_raw = metadata.get("scripts")

    flows_raw = raw_profile.get("flows")
    if flows_raw is None:
        flows_raw = raw_profile.get("flow")
    if flows_raw is None:
        flows_raw = metadata.get("flows")

    cases_raw = raw_profile.get("cases")
    if cases_raw is None:
        cases_raw = raw_profile.get("case")
    if cases_raw is None:
        cases_raw = metadata.get("cases")

    return project_artifact_profile_factory(
        skills=parse_project_artifact_list(skills_raw, "skill"),
        scripts=parse_project_artifact_list(scripts_raw, "script"),
        flows=parse_project_artifact_list(flows_raw, "flow"),
        cases=parse_project_artifact_list(cases_raw, "case"),
    )
