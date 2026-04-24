# -*- coding: utf-8 -*-

from __future__ import annotations

import asyncio
import hashlib
import logging
from pathlib import Path
from typing import Any

from ..config.config import load_agent_config
from ..config.utils import get_config_path, load_config
from ..knowledge import ProjectKnowledgeSyncManager
from ..knowledge.project_sync import (
    DEFAULT_PROJECT_SYNC_COOLDOWN_SECONDS,
    DEFAULT_PROJECT_SYNC_DEBOUNCE_SECONDS,
    ensure_project_source_registered,
)
from .project_monitoring_state import (
    PROJECT_FILE_MONITORING_ACTIVE,
    normalize_project_file_monitoring_state,
)

logger = logging.getLogger(__name__)

DEFAULT_POLL_INTERVAL = 2.0
DEFAULT_CHANGE_DEBOUNCE_SECONDS = DEFAULT_PROJECT_SYNC_DEBOUNCE_SECONDS
DEFAULT_SYNC_COOLDOWN_SECONDS = DEFAULT_PROJECT_SYNC_COOLDOWN_SECONDS
_PROJECT_METADATA_RELATIVE_PATHS = (
    ".agent/PROJECT.md",
    ".agent/project.md",
    "PROJECT.md",
    "project.md",
)
_IGNORED_DIRS = {
    ".knowledge",
    ".git",
    "__pycache__",
    "node_modules",
    ".pytest_cache",
    ".mypy_cache",
}


def _has_hidden_directory_segment(relative_path: str) -> bool:
    normalized = relative_path.strip("/")
    path_parts = Path(normalized).parts
    if not path_parts:
        return False
    last_index = len(path_parts) - 1
    for index, part in enumerate(path_parts):
        if not part.startswith("."):
            continue
        if index < last_index:
            return True
    return False


def _parse_frontmatter(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return {}
    if not raw.startswith("---\n"):
        return {}
    lines = raw.splitlines()
    end = -1
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            end = idx
            break
    if end == -1:
        return {}
    header = "\n".join(lines[1:end])
    try:
        import yaml

        data = yaml.safe_load(header) or {}
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _normalize_auto_sink(raw_value: Any) -> bool:
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


class ProjectKnowledgeWatcher:
    """Poll project workspaces and trigger automatic knowledge sync on changes."""

    def __init__(
        self,
        *,
        agent_id: str,
        workspace_dir: Path,
        poll_interval: float = DEFAULT_POLL_INTERVAL,
    ) -> None:
        self._agent_id = agent_id
        self._workspace_dir = workspace_dir
        self._projects_dir = workspace_dir / "projects"
        self._poll_interval = poll_interval
        self._task: asyncio.Task | None = None
        self._snapshots: dict[str, dict[str, Any]] = {}
        self._sync_managers: dict[str, ProjectKnowledgeSyncManager] = {}
        self._runtime_context_cache: dict[str, Any] = {
            "global_mtime_ns": None,
            "agent_mtime_ns": None,
            "global_config": None,
            "running_config": None,
        }

    @staticmethod
    def _safe_mtime_ns(path: Path) -> int | None:
        try:
            if not path.exists() or not path.is_file():
                return None
            return path.stat().st_mtime_ns
        except OSError:
            return None

    async def _load_runtime_context(self) -> tuple[Any, Any, Any]:
        global_config_path = get_config_path()
        agent_config_path = self._workspace_dir / "agent.json"
        global_mtime_ns = self._safe_mtime_ns(global_config_path)
        agent_mtime_ns = self._safe_mtime_ns(agent_config_path)
        cache = self._runtime_context_cache

        if (
            cache.get("global_config") is not None
            and cache.get("running_config") is not None
            and cache.get("global_mtime_ns") == global_mtime_ns
            and cache.get("agent_mtime_ns") == agent_mtime_ns
        ):
            global_config = cache["global_config"]
            return global_config, global_config.knowledge, cache["running_config"]

        global_config, agent_config = await asyncio.gather(
            asyncio.to_thread(load_config),
            asyncio.to_thread(load_agent_config, self._agent_id),
        )
        running_config = agent_config.running
        self._runtime_context_cache = {
            "global_mtime_ns": global_mtime_ns,
            "agent_mtime_ns": agent_mtime_ns,
            "global_config": global_config,
            "running_config": running_config,
        }
        return global_config, global_config.knowledge, running_config

    def _get_project_sync_manager(self, project_id: str) -> ProjectKnowledgeSyncManager:
        manager = self._sync_managers.get(project_id)
        if manager is not None:
            return manager
        manager = ProjectKnowledgeSyncManager(
            self._workspace_dir,
            knowledge_dirname=f"projects/{project_id}/.knowledge",
        )
        self._sync_managers[project_id] = manager
        return manager

    async def _collect_snapshots_async(self) -> dict[str, dict[str, Any]]:
        return await asyncio.to_thread(self._collect_snapshots)

    async def start(self) -> None:
        self._snapshots = await self._collect_snapshots_async()
        self._task = asyncio.create_task(
            self._poll_loop(),
            name=f"project_knowledge_watcher_{self._agent_id}",
        )
        logger.info(
            "ProjectKnowledgeWatcher started for %s (poll=%ss)",
            self._agent_id,
            self._poll_interval,
        )

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("ProjectKnowledgeWatcher stopped for %s", self._agent_id)

    async def _poll_loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(self._poll_interval)
                current = await self._collect_snapshots_async()
                await self._handle_snapshot_changes(current)
                self._snapshots = current
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception(
                    "ProjectKnowledgeWatcher poll failed for %s",
                    self._agent_id,
                )

    async def _handle_snapshot_changes(
        self,
        current: dict[str, dict[str, Any]],
    ) -> None:
        global_config, knowledge_config, running_config = await self._load_runtime_context()
        if not knowledge_config.enabled or not bool(getattr(knowledge_config, "memify_enabled", False)):
            return

        persist_needed = False

        for project_id, snapshot in current.items():
            if not snapshot.get("auto_enabled"):
                continue
            if (
                normalize_project_file_monitoring_state(
                    snapshot.get("file_monitoring_state"),
                )
                != PROJECT_FILE_MONITORING_ACTIVE
            ):
                continue
            previous = self._snapshots.get(project_id)
            changed_paths = self._diff_paths(previous, snapshot)
            should_bootstrap = previous is None
            manager = self._get_project_sync_manager(project_id)
            should_config_reindex = False
            if not should_bootstrap and not changed_paths:
                should_config_reindex = manager.check_needs_reindex(
                    project_id=project_id,
                    config=knowledge_config,
                    running_config=running_config,
                )
                if not should_config_reindex:
                    continue

            source, source_changed = ensure_project_source_registered(
                global_config.knowledge,
                project_id=project_id,
                project_name=str(snapshot.get("project_name") or project_id),
                project_workspace_dir=str(snapshot.get("project_dir") or ""),
                persist=lambda: None,
            )
            persist_needed = persist_needed or source_changed
            trigger = (
                "project_watcher_bootstrap"
                if should_bootstrap
                else ("project_watcher_config_change" if should_config_reindex else "project_watcher_change")
            )
            result = manager.start_sync(
                project_id=project_id,
                config=knowledge_config,
                running_config=running_config,
                source=source,
                trigger=trigger,
                changed_paths=changed_paths,
                auto_enabled=True,
                force=should_bootstrap,
                debounce_seconds=DEFAULT_CHANGE_DEBOUNCE_SECONDS,
                cooldown_seconds=DEFAULT_SYNC_COOLDOWN_SECONDS,
            )
            if result.get("accepted"):
                logger.info(
                    "ProjectKnowledgeWatcher triggered sync for %s (%s, %s paths)",
                    project_id,
                    "bootstrap" if should_bootstrap else ("config-change" if should_config_reindex else "change"),
                    len(changed_paths),
                )

        if persist_needed:
            from ..config.utils import save_config

            save_config(global_config)

    def _collect_snapshots(self) -> dict[str, dict[str, Any]]:
        if not self._projects_dir.exists():
            return {}
        snapshots: dict[str, dict[str, Any]] = {}
        for project_dir in sorted(self._projects_dir.iterdir(), key=lambda item: item.name.lower()):
            if not project_dir.is_dir():
                continue
            snapshot = self._build_project_snapshot(project_dir)
            if snapshot is None:
                continue
            snapshots[snapshot["project_id"]] = snapshot
        return snapshots

    def _build_project_snapshot(self, project_dir: Path) -> dict[str, Any] | None:
        metadata_file = next(
            (
                project_dir / rel_path
                for rel_path in _PROJECT_METADATA_RELATIVE_PATHS
                if (project_dir / rel_path).exists()
            ),
            None,
        )
        if metadata_file is None:
            return None
        meta = _parse_frontmatter(metadata_file)
        project_id = str(meta.get("id") or project_dir.name).strip() or project_dir.name
        project_name = str(meta.get("name") or project_id).strip() or project_id
        auto_enabled = _normalize_auto_sink(meta.get("project_auto_knowledge_sink"))

        file_map: dict[str, str] = {}
        for path in sorted(project_dir.rglob("*"), key=lambda item: item.as_posix().lower()):
            if not path.is_file():
                continue
            rel = path.relative_to(project_dir).as_posix()
            if _has_hidden_directory_segment(rel):
                continue
            if any(part in _IGNORED_DIRS for part in Path(rel).parts):
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            file_map[rel] = f"{stat.st_mtime_ns}:{stat.st_size}"

        fingerprint_source = "\n".join(
            f"{key}:{value}" for key, value in sorted(file_map.items())
        )
        fingerprint = hashlib.sha1(fingerprint_source.encode("utf-8")).hexdigest()
        return {
            "project_id": project_id,
            "project_name": project_name,
            "project_dir": str(project_dir),
            "metadata_file": str(metadata_file),
            "auto_enabled": auto_enabled,
            "file_monitoring_state": normalize_project_file_monitoring_state(
                meta.get("file_monitoring_state"),
            ),
            "fingerprint": fingerprint,
            "files": file_map,
        }

    @staticmethod
    def _diff_paths(
        previous: dict[str, Any] | None,
        current: dict[str, Any],
        *,
        limit: int = 50,
    ) -> list[str]:
        if previous is None:
            return []
        previous_files = previous.get("files") or {}
        current_files = current.get("files") or {}
        changed: list[str] = []
        for path in sorted(set(previous_files) | set(current_files)):
            if previous_files.get(path) == current_files.get(path):
                continue
            changed.append(path)
            if len(changed) >= limit:
                break
        return changed