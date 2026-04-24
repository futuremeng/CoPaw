from __future__ import annotations

from pathlib import Path
from typing import Any

from .project_realtime_events import record_project_realtime_paths

PROJECT_FILE_MONITORING_IDLE = "idle"
PROJECT_FILE_MONITORING_ACTIVE = "active"
_PROJECT_METADATA_RELATIVE_PATHS = (
    ".agent/PROJECT.md",
    ".agent/project.md",
    "PROJECT.md",
    "project.md",
)


def normalize_project_file_monitoring_state(raw_value: Any) -> str:
    text = str(raw_value or "").strip().lower()
    if text == PROJECT_FILE_MONITORING_IDLE:
        return PROJECT_FILE_MONITORING_IDLE
    return PROJECT_FILE_MONITORING_ACTIVE


def _iter_project_metadata_files(project_dir: Path):
    for relative_path in _PROJECT_METADATA_RELATIVE_PATHS:
        candidate = project_dir / relative_path
        if candidate.exists() and candidate.is_file():
            yield candidate


def _parse_markdown_frontmatter(
    metadata_file: Path,
) -> tuple[dict[str, Any], str] | None:
    raw = metadata_file.read_text(encoding="utf-8", errors="ignore")
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

    import yaml

    header = "\n".join(lines[1:end])
    metadata = yaml.safe_load(header) or {}
    if not isinstance(metadata, dict):
        metadata = {}

    body = "\n".join(lines[end + 1 :]).strip()
    return metadata, body


def read_project_metadata_with_body(
    project_dir: Path,
) -> tuple[Path | None, dict[str, Any], str]:
    metadata_file = next(_iter_project_metadata_files(project_dir), None)
    if metadata_file is None:
        return None, {}, ""
    parsed = _parse_markdown_frontmatter(metadata_file)
    if parsed is not None:
        metadata, body = parsed
        return metadata_file, metadata, body
    return (
        metadata_file,
        {},
        metadata_file.read_text(encoding="utf-8", errors="ignore"),
    )


def write_project_metadata(
    metadata_file: Path,
    metadata: dict[str, Any],
    body: str,
    *,
    record_realtime: bool = True,
) -> None:
    import yaml

    serialized = yaml.safe_dump(
        metadata,
        allow_unicode=True,
        sort_keys=False,
    ).strip()
    text = f"---\n{serialized}\n---\n\n{(body or '').strip()}\n"
    metadata_file.parent.mkdir(parents=True, exist_ok=True)
    metadata_file.write_text(text, encoding="utf-8")
    if record_realtime:
        record_project_realtime_paths(None, [metadata_file])


def update_project_file_monitoring_state(
    project_dir: Path,
    next_state: str,
) -> bool:
    metadata_file, metadata, body = read_project_metadata_with_body(project_dir)
    if metadata_file is None:
        return False
    normalized = normalize_project_file_monitoring_state(next_state)
    current = normalize_project_file_monitoring_state(
        metadata.get("file_monitoring_state"),
    )
    if current == normalized:
        return False
    metadata["file_monitoring_state"] = normalized
    write_project_metadata(metadata_file, metadata, body)
    return True


def activate_project_file_monitoring_for_path(file_path: str | Path) -> bool:
    target = Path(file_path).expanduser().resolve(strict=False)
    project_dir: Path | None = None

    for candidate in target.parents:
        if candidate.parent.name == "projects":
            project_dir = candidate
            break

    if project_dir is None:
        return False

    return update_project_file_monitoring_state(
        project_dir,
        PROJECT_FILE_MONITORING_ACTIVE,
    )