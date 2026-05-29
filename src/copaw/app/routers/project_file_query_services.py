# -*- coding: utf-8 -*-
"""Project file query/read service helpers for router-level delegation."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

ResolveProjectDir = Callable[[Path, str], Path]
BuildProjectFileSummary = Callable[[Path], Any]
ListProjectFiles = Callable[[Path], Any]
QueryProjectFileRecords = Callable[..., dict[str, Any]]
ResponseModelValidate = Callable[[dict[str, Any]], Any]
ListProjectFileTreeNodes = Callable[[Path, str], Any]
IsSafeRelativePath = Callable[[str], bool]
FormatIsoTime = Callable[[float], str]
RewriteOriginalToDataPath = Callable[[str], str | None]
FileInfoFactory = Callable[..., Any]
HttpExceptionFactory = Callable[..., Exception]
HasHiddenDirectorySegment = Callable[[str], bool]
ScanProjectFileRecords = Callable[[Path], Any]
CollectRecentProjectUpdates = Callable[[Path, str], list[dict[str, Any]]]
ExtensionOfPath = Callable[[str], str]


def build_project_file_summary_for_workspace(
    workspace_dir: Path,
    project_id: str,
    *,
    resolve_project_dir: ResolveProjectDir,
    build_project_file_summary: BuildProjectFileSummary,
) -> Any:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    return build_project_file_summary(project_dir)


def list_project_files_for_workspace(
    workspace_dir: Path,
    project_id: str,
    *,
    resolve_project_dir: ResolveProjectDir,
    list_project_files: ListProjectFiles,
) -> Any:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    return list_project_files(project_dir)


def query_project_files_for_workspace(
    workspace_dir: Path,
    project_id: str,
    payload: Any,
    *,
    resolve_project_dir: ResolveProjectDir,
    query_project_file_records: QueryProjectFileRecords,
    response_model_validate: ResponseModelValidate,
) -> Any:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    result = query_project_file_records(
        project_dir,
        search=payload.search,
        path_prefix=payload.path_prefix,
        stages=list(payload.stages or []),
        content_types=list(payload.content_types or []),
        include_builtin=payload.include_builtin,
        include_ignored=bool(payload.include_ignored),
        size_min=payload.size_min,
        size_max=payload.size_max,
        modified_after=payload.modified_after,
        modified_before=payload.modified_before,
        sort_by=payload.sort_by,
        sort_order=payload.sort_order,
        offset=payload.offset,
        limit=payload.limit,
    )
    return response_model_validate(result)


def list_project_file_tree_nodes_for_workspace(
    workspace_dir: Path,
    project_id: str,
    dir_path: str,
    *,
    resolve_project_dir: ResolveProjectDir,
    list_project_file_tree_nodes: ListProjectFileTreeNodes,
) -> Any:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    return list_project_file_tree_nodes(project_dir, dir_path)


def get_project_files_metadata(
    project_dir: Path,
    rel_paths: list[str],
    *,
    is_safe_relative_path: IsSafeRelativePath,
    format_iso_time: FormatIsoTime,
    file_info_factory: FileInfoFactory,
    http_exception_factory: HttpExceptionFactory,
) -> list[Any]:
    project_root = project_dir.resolve()
    results: list[Any] = []
    seen_paths: set[str] = set()

    for rel_path in rel_paths:
        normalized_rel_path = str(rel_path or "").replace("\\", "/").strip()
        if not normalized_rel_path or normalized_rel_path in seen_paths:
            continue
        if not is_safe_relative_path(normalized_rel_path):
            raise http_exception_factory(status_code=400, detail="Invalid file path")
        target = (project_dir / normalized_rel_path).resolve()
        if not str(target).startswith(str(project_root)):
            raise http_exception_factory(status_code=400, detail="Invalid file path")
        if not target.exists() or not target.is_file():
            continue
        try:
            stat = target.stat()
        except OSError:
            continue
        results.append(
            file_info_factory(
                filename=target.name,
                path=normalized_rel_path,
                size=stat.st_size,
                modified_time=format_iso_time(stat.st_mtime),
            )
        )
        seen_paths.add(normalized_rel_path)

    return results


def get_project_files_metadata_for_workspace(
    workspace_dir: Path,
    project_id: str,
    rel_paths: list[str],
    *,
    resolve_project_dir: ResolveProjectDir,
    get_project_files_metadata: Callable[[Path, list[str]], list[Any]],
) -> list[Any]:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    return get_project_files_metadata(project_dir, rel_paths)


def resolve_project_file_path(
    project_dir: Path,
    rel_path: str,
    *,
    is_safe_relative_path: IsSafeRelativePath,
    rewrite_original_to_data_path: RewriteOriginalToDataPath,
    http_exception_factory: HttpExceptionFactory,
) -> Path:
    if not is_safe_relative_path(rel_path):
        raise http_exception_factory(status_code=400, detail="Invalid file path")

    target_rel_path = rel_path
    target = (project_dir / target_rel_path).resolve()
    project_root = project_dir.resolve()
    if not str(target).startswith(str(project_root)):
        raise http_exception_factory(status_code=400, detail="Invalid file path")
    if not target.exists() or not target.is_file():
        fallback_rel_path = rewrite_original_to_data_path(target_rel_path)
        if fallback_rel_path and is_safe_relative_path(fallback_rel_path):
            fallback_target = (project_dir / fallback_rel_path).resolve()
            if (
                str(fallback_target).startswith(str(project_root))
                and fallback_target.exists()
                and fallback_target.is_file()
            ):
                target_rel_path = fallback_rel_path
                target = fallback_target
    if not target.exists() or not target.is_file():
        raise http_exception_factory(
            status_code=404, detail=f"File '{rel_path}' not found"
        )
    return target


def resolve_project_file_path_for_workspace(
    workspace_dir: Path,
    project_id: str,
    rel_path: str,
    *,
    resolve_project_dir: ResolveProjectDir,
    resolve_project_file_path: Callable[[Path, str], Path],
) -> Path:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    return resolve_project_file_path(project_dir, rel_path)


def read_project_text_file(
    project_dir: Path,
    rel_path: str,
    *,
    resolve_project_file_path: Callable[[Path, str], Path],
    http_exception_factory: HttpExceptionFactory,
) -> str:
    target = resolve_project_file_path(project_dir, rel_path)
    raw = target.read_bytes()
    if b"\x00" in raw[:4096]:
        raise http_exception_factory(
            status_code=400, detail="Binary file preview is not supported"
        )
    return raw.decode("utf-8", errors="replace")


def read_project_text_file_for_workspace(
    workspace_dir: Path,
    project_id: str,
    rel_path: str,
    *,
    resolve_project_dir: ResolveProjectDir,
    read_project_text_file: Callable[[Path, str], str],
) -> str:
    project_dir = resolve_project_dir(workspace_dir, project_id)
    return read_project_text_file(project_dir, rel_path)


def is_safe_relative_path(rel_path: str) -> bool:
    if not rel_path:
        return False
    candidate = Path(rel_path)
    if candidate.is_absolute() or ".." in candidate.parts:
        return False
    return True


def rewrite_original_to_data_path(rel_path: str) -> str | None:
    normalized = rel_path.strip().replace("\\", "/")
    if not normalized.startswith("original/"):
        return None
    remainder = normalized[len("original/") :]
    if not remainder:
        return None
    return f"data/{remainder}"


def normalize_project_tree_dir_path(raw_value: str) -> str:
    candidate = str(raw_value or "").strip().replace("\\", "/")
    if not candidate or candidate == ".":
        return ""
    normalized = Path(candidate).as_posix().strip("/")
    if normalized == ".":
        return ""
    return normalized


def is_visible_project_tree_path(
    rel_path: str,
    *,
    project_tree_ignored_names: set[str],
) -> bool:
    if not rel_path:
        return True
    parts = Path(rel_path).parts
    if any(part in project_tree_ignored_names for part in parts):
        return False
    return True


def count_visible_project_tree_children(
    target_dir: Path,
    *,
    is_visible_project_tree_path: Callable[[str], bool],
) -> int:
    count = 0
    for child in target_dir.iterdir():
        candidate = f"{child.name}/" if child.is_dir() else child.name
        if not is_visible_project_tree_path(candidate):
            continue
        count += 1
    return count


def count_visible_project_tree_direct_files(
    target_dir: Path,
    *,
    is_visible_project_tree_path: Callable[[str], bool],
) -> int:
    count = 0
    try:
        for path in target_dir.iterdir():
            if not path.is_file():
                continue
            rel_path = path.relative_to(target_dir).as_posix()
            if not is_visible_project_tree_path(rel_path):
                continue
            count += 1
    except OSError:
        return 0
    return count


def has_visible_project_tree_child_directories(
    target_dir: Path,
    *,
    is_visible_project_tree_path: Callable[[str], bool],
) -> bool:
    try:
        for path in target_dir.iterdir():
            if not path.is_dir():
                continue
            rel_path = path.relative_to(target_dir).as_posix()
            if not is_visible_project_tree_path(rel_path):
                continue
            return True
    except OSError:
        return False
    return False


def list_project_file_tree_nodes(
    project_dir: Path,
    dir_path: str,
    *,
    normalize_project_tree_dir_path: Callable[[str], str],
    is_safe_relative_path: IsSafeRelativePath,
    is_visible_project_tree_path: Callable[[str], bool],
    format_iso_time: FormatIsoTime,
    count_visible_project_tree_children: Callable[[Path], int],
    count_visible_project_tree_direct_files: Callable[[Path], int],
    has_visible_project_tree_child_directories: Callable[[Path], bool],
    project_file_tree_node_factory: Callable[..., Any],
    http_exception_factory: HttpExceptionFactory,
) -> list[Any]:
    project_root = project_dir.resolve()
    normalized_dir_path = normalize_project_tree_dir_path(dir_path)
    if normalized_dir_path and not is_safe_relative_path(normalized_dir_path):
        raise http_exception_factory(status_code=400, detail="Invalid directory path")
    if normalized_dir_path and not is_visible_project_tree_path(
        f"{normalized_dir_path}/"
    ):
        raise http_exception_factory(status_code=404, detail="Directory not found")

    target_dir = (
        project_root
        if not normalized_dir_path
        else (project_root / normalized_dir_path).resolve()
    )
    if not str(target_dir).startswith(str(project_root)):
        raise http_exception_factory(status_code=400, detail="Invalid directory path")
    if not target_dir.exists() or not target_dir.is_dir():
        raise http_exception_factory(status_code=404, detail="Directory not found")

    nodes: list[Any] = []
    try:
        children = sorted(
            target_dir.iterdir(),
            key=lambda item: (not item.is_dir(), item.name.lower()),
        )
    except OSError as exc:
        raise http_exception_factory(status_code=500, detail=str(exc)) from exc

    for child in children:
        rel_path = child.relative_to(project_root).as_posix()
        candidate = f"{rel_path}/" if child.is_dir() else rel_path
        if not is_visible_project_tree_path(candidate):
            continue
        try:
            stat = child.stat()
        except OSError:
            continue
        is_directory = child.is_dir()
        nodes.append(
            project_file_tree_node_factory(
                filename=child.name,
                path=rel_path,
                size=0 if is_directory else stat.st_size,
                modified_time=format_iso_time(stat.st_mtime),
                is_directory=is_directory,
                child_count=(
                    count_visible_project_tree_children(child)
                    if is_directory
                    else 0
                ),
                descendant_file_count=(
                    count_visible_project_tree_direct_files(child)
                    if is_directory
                    else 0
                ),
                direct_file_count=(
                    count_visible_project_tree_direct_files(child)
                    if is_directory
                    else 0
                ),
                has_child_directories=(
                    has_visible_project_tree_child_directories(child)
                    if is_directory
                    else False
                ),
            )
        )

    return nodes


def list_project_files(
    project_dir: Path,
    *,
    scan_project_file_records: ScanProjectFileRecords,
    project_file_info_factory: Callable[..., Any],
) -> list[Any]:
    files: list[Any] = []
    for record in scan_project_file_records(project_dir):
        if record.path.startswith(".git/") or "/.git/" in record.path:
            continue
        files.append(
            project_file_info_factory(
                filename=record.filename,
                path=record.path,
                size=record.size,
                modified_time=record.modified_time,
            ),
        )
    return files


def normalize_project_metric_path(rel_path: str) -> str:
    normalized = str(rel_path or "").replace("\\", "/")
    if normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized.lower()


def has_hidden_directory_segment(
    rel_path: str,
    *,
    assume_last_segment_is_dir: bool = False,
    allow_managed_hidden_dirs: bool = False,
    project_managed_visible_hidden_dirs: set[str],
) -> bool:
    normalized = str(rel_path or "").replace("\\", "/").strip("/")
    if not normalized:
        return False
    segments = [segment for segment in normalized.split("/") if segment]
    if not segments:
        return False
    last_index = len(segments) - 1
    for index, segment in enumerate(segments):
        if not segment.startswith("."):
            continue
        if (
            allow_managed_hidden_dirs
            and segment in project_managed_visible_hidden_dirs
        ):
            continue
        if index < last_index or assume_last_segment_is_dir:
            return True
    return False


def extension_of_project_path(rel_path: str) -> str:
    normalized = normalize_project_metric_path(rel_path)
    file_name = normalized.split("/")[-1] if normalized else ""
    if "." not in file_name:
        return ""
    return file_name.rsplit(".", 1)[-1]


def is_ignored_project_metric_file(
    rel_path: str,
    *,
    project_ignored_file_names: set[str],
) -> bool:
    file_name = normalize_project_metric_path(rel_path).split("/")[-1] or ""
    return file_name in project_ignored_file_names


def is_builtin_project_metric_file(
    rel_path: str,
    *,
    has_hidden_directory_segment: HasHiddenDirectorySegment,
) -> bool:
    normalized = normalize_project_metric_path(rel_path)
    return has_hidden_directory_segment(normalized)


def is_original_project_metric_file(rel_path: str) -> bool:
    normalized = normalize_project_metric_path(rel_path)
    return normalized == "original" or normalized.startswith("original/")


def is_intermediate_project_metric_file(rel_path: str) -> bool:
    normalized = normalize_project_metric_path(rel_path)
    return any(
        normalized.startswith(f"{prefix}/")
        for prefix in (
            "intermediate",
            "data",
            "metadata",
            "cross-book",
            "term-candidates",
            "review",
        )
    )


def is_artifact_project_metric_file(rel_path: str) -> bool:
    normalized = normalize_project_metric_path(rel_path)
    return normalized == "output" or normalized.startswith("output/")


def is_agent_project_metric_file(rel_path: str) -> bool:
    normalized = normalize_project_metric_path(rel_path)
    return normalized.startswith(".agent/")


def is_skill_project_metric_file(rel_path: str) -> bool:
    normalized = normalize_project_metric_path(rel_path)
    return normalized.startswith(".skills/")


def is_flow_project_metric_file(rel_path: str) -> bool:
    normalized = normalize_project_metric_path(rel_path)
    parts = [part for part in normalized.split("/") if part]
    return len(parts) >= 4 and parts[0] == "pipelines" and parts[2] == "pipeline"


def is_case_project_metric_file(rel_path: str) -> bool:
    normalized = normalize_project_metric_path(rel_path)
    parts = [part for part in normalized.split("/") if part]
    return len(parts) >= 4 and parts[0] == "pipelines" and parts[2] == "runs"


def build_project_file_summary(
    project_dir: Path,
    *,
    scan_project_file_records: ScanProjectFileRecords,
    extension_of_path: ExtensionOfPath,
    is_agent_project_metric_file: Callable[[str], bool],
    is_skill_project_metric_file: Callable[[str], bool],
    is_flow_project_metric_file: Callable[[str], bool],
    is_case_project_metric_file: Callable[[str], bool],
    project_knowledge_extensions: set[str],
    collect_recent_project_updates: CollectRecentProjectUpdates,
    format_iso_time: FormatIsoTime,
    project_file_info_factory: Callable[..., Any],
    project_file_summary_factory: Callable[..., Any],
) -> Any:
    project_root = project_dir.resolve()
    project_id = project_root.name
    total_files = 0
    builtin_files = 0
    visible_files = 0
    original_files = 0
    intermediate_files = 0
    artifact_files = 0
    derived_files = 0
    knowledge_candidate_files = 0
    markdown_files = 0
    text_files = 0
    script_files = 0
    other_type_files = 0
    text_like_files = 0
    agent_files = 0
    skill_files = 0
    flow_files = 0
    case_files = 0

    for record in scan_project_file_records(project_root):
        rel_path = record.path
        if record.ignored:
            continue
        total_files += 1
        extension = extension_of_path(rel_path)
        is_builtin = record.builtin
        is_markdown = record.content_type == "markdown"
        is_text_file = record.content_type == "text"
        is_script_file = record.content_type == "script"
        is_text_like = is_markdown or is_text_file or is_script_file
        if is_builtin:
            builtin_files += 1
        else:
            visible_files += 1
            if record.stage == "original":
                original_files += 1
            elif record.stage == "intermediate":
                intermediate_files += 1
            elif record.stage == "artifact":
                artifact_files += 1

        if not is_builtin:
            if is_agent_project_metric_file(rel_path):
                agent_files += 1
            elif is_skill_project_metric_file(rel_path):
                skill_files += 1
            elif is_flow_project_metric_file(rel_path):
                flow_files += 1
            elif is_case_project_metric_file(rel_path):
                case_files += 1

            if extension in project_knowledge_extensions:
                knowledge_candidate_files += 1
            if is_markdown:
                markdown_files += 1
            if is_text_file:
                text_files += 1
            if is_script_file:
                script_files += 1
            if not is_markdown and not is_text_file and not is_script_file:
                other_type_files += 1
            if is_text_like:
                text_like_files += 1

    derived_files = intermediate_files
    recent_update_records = collect_recent_project_updates(project_root, project_id)
    recent_updates: list[Any] = []
    for item in recent_update_records:
        path = str(item.get("path") or "").strip()
        if not path:
            continue
        target = project_root / path
        try:
            stat = target.stat()
        except OSError:
            continue
        recent_updates.append(
            project_file_info_factory(
                filename=target.name,
                path=path,
                size=stat.st_size,
                modified_time=str(item.get("modified_time") or format_iso_time(stat.st_mtime)),
            )
        )

    return project_file_summary_factory(
        total_files=total_files,
        builtin_files=builtin_files,
        visible_files=visible_files,
        original_files=original_files,
        intermediate_files=intermediate_files,
        artifact_files=artifact_files,
        derived_files=derived_files,
        knowledge_candidate_files=knowledge_candidate_files,
        markdown_files=markdown_files,
        text_files=text_files,
        script_files=script_files,
        other_type_files=other_type_files,
        text_like_files=text_like_files,
        agent_files=agent_files,
        skill_files=skill_files,
        flow_files=flow_files,
        case_files=case_files,
        recently_updated_files=len(recent_updates),
        recent_updates=recent_updates,
    )
