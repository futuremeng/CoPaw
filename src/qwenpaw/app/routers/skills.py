# -*- coding: utf-8 -*-
"""Workspace and skill-pool APIs."""

from __future__ import annotations

import asyncio
import copy
import json
import logging
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from enum import Enum
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, Body, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from qwenpaw.exceptions import (
    AppBaseException,
)

from ...agents.skill_system.hub import (
    SkillImportCancelled,
    search_hub_skills,
    import_pool_skill_from_hub,
    install_skill_from_hub,
)
from ...agents.skill_system import (
    SkillConflictError,
    SkillPoolService,
    SkillService,
    refresh_pool_automation,
    run_pool_auto_sync,
)
from ...agents.skill_system.registry import (
    BUILTIN_SKILL_LANGUAGES,
    get_pool_builtin_sync_status,
    get_pool_builtin_update_notice,
    import_builtin_skills,
    list_builtin_import_candidates,
    list_workspaces,
    reconcile_workspace_manifest,
    update_single_builtin,
)
from ...agents.skill_system.models import SkillRequirements
from ...agents.skill_system.store import (
    build_skill_metadata,
    default_workspace_manifest,
    get_workspace_skill_manifest_path,
    get_workspace_skills_dir,
    mutate_json,
    mutate_pool_manifest,
    normalize_skill_manifest_entry,
    read_pool_skill_automation,
    read_skill_content_and_metadata_from_dir,
    read_skill_manifest,
    read_skill_pool_manifest,
    resolve_pool_skill_dir,
    safe_skill_dir,
    suggest_conflict_name,
)
from ...config import load_config, save_config
from ...config.config import (
    SkillMarketSpec,
    SkillsMarketCacheConfig,
    SkillsMarketConfig,
    SkillsMarketInstallConfig,
)
from ...security.skill_scanner import SkillScanError
from ..inbox_store import append_event as append_inbox_event
from ..utils import check_upload_size, schedule_agent_reload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/skills", tags=["skills"])

MAX_TAGS = 8
MAX_TAG_LENGTH = 16
# Existing Inbox filters use this released source value.
SKILL_AUTOMATION_INBOX_SOURCE = "skill_autoupdate"


async def _append_automation_event(
    *,
    event_type: str,
    status: str,
    severity: str,
    title: str,
    body: str,
    payload: dict[str, Any],
) -> bool:
    try:
        await append_inbox_event(
            agent_id="default",
            source_type=SKILL_AUTOMATION_INBOX_SOURCE,
            source_id="",
            event_type=event_type,
            status=status,
            severity=severity,
            title=title,
            body=body,
            payload=payload,
        )
        return True
    except Exception:  # pylint: disable=broad-except
        logger.exception("Failed to append Skill Pool automation event")
        return False


async def post_auto_sync_inbox(result: dict[str, Any] | None) -> bool:
    if not result:
        return False
    synced = [
        item for item in (result.get("synced") or []) if item.get("agents")
    ]
    failed = result.get("failed") or []
    if not synced and not failed:
        return False

    lines = [
        f"{item['skill']} → {', '.join(item.get('agents') or [])}"
        for item in synced
    ]
    lines.extend(
        f"{item['skill']} (failed) → "
        f"{', '.join(item.get('agents') or []) or 'unknown'}"
        for item in failed
    )
    failure_count = len(failed)
    title = (
        f"Auto Sync: {len(synced)} synced, {failure_count} failed"
        if failure_count
        else f"Auto Sync: {len(synced)} skill(s) synced"
    )
    return await _append_automation_event(
        event_type="auto_sync",
        status="error" if failure_count else "success",
        severity="error" if failure_count else "info",
        title=title,
        body="; ".join(lines),
        payload={"synced": synced, "failed": failed},
    )


async def post_pool_automation_inbox(
    result: dict[str, Any] | None,
) -> bool:
    if not result:
        return False
    pool_updated = result.get("pool_updated") or []
    pool_failed = result.get("pool_failed") or []
    synced = result.get("synced") or []
    sync_failed = result.get("sync_failed") or []
    if not pool_updated and not pool_failed:
        return await post_auto_sync_inbox(
            {"synced": synced, "failed": sync_failed},
        )

    lines = [
        f"{item['skill']}: {item.get('from_version') or '-'} → "
        f"{item.get('to_version') or '-'}"
        for item in pool_updated
    ]
    lines.extend(
        f"{item.get('skill', 'unknown')} (pool update failed)"
        for item in pool_failed
    )
    lines.extend(
        f"{item['skill']} → {', '.join(item.get('agents') or [])}"
        for item in synced
        if item.get("agents")
    )
    lines.extend(
        f"{item['skill']} (sync failed) → "
        f"{', '.join(item.get('agents') or []) or 'unknown'}"
        for item in sync_failed
    )
    failure_count = len(pool_failed) + len(sync_failed)
    return await _append_automation_event(
        event_type="auto_update",
        status="error" if failure_count else "success",
        severity="error" if failure_count else "info",
        title=(
            f"Auto Update: {len(pool_updated)} updated, "
            f"{failure_count} failed"
        ),
        body="; ".join(lines),
        payload={
            "pool_updated": pool_updated,
            "pool_failed": pool_failed,
            "synced": synced,
            "sync_failed": sync_failed,
        },
    )


async def _follow_auto_sync(skill_name: str | None = None) -> None:
    try:
        result = await asyncio.to_thread(
            run_pool_auto_sync,
            skill_name=skill_name,
        )
        await post_auto_sync_inbox(result)
    except Exception:
        logger.warning("Auto Sync follow-up failed", exc_info=True)


def _scan_error_payload(exc: SkillScanError) -> dict[str, Any]:
    """Normalize scanner exceptions into a stable API payload.

    Example response body:
        {
            "type": "security_scan_failed",
            "skill_name": "blocked_skill",
            "max_severity": "high",
            "findings": [...]
        }
    """
    result = exc.result
    return {
        "type": "security_scan_failed",
        "detail": str(exc),
        "skill_name": result.skill_name,
        "max_severity": result.max_severity.value,
        "findings": [
            {
                "severity": f.severity.value,
                "title": f.title,
                "description": f.description,
                "file_path": f.file_path,
                "line_number": f.line_number,
                "rule_id": f.rule_id,
            }
            for f in result.findings
        ],
    }


def _scan_error_response(exc: SkillScanError) -> JSONResponse:
    """Build a 422 JSON response for skill scan failures.

    Returns a JSONResponse so callers receive structured scan
    details rather than a bare HTTP error.
    """
    return JSONResponse(
        status_code=422,
        content=_scan_error_payload(exc),
    )


class SkillSpec(BaseModel):
    """Workspace skill metadata returned by list endpoints."""

    name: str
    description: str = ""
    version_text: str = ""
    source: str
    emoji: str = ""
    enabled: bool = False
    channels: list[str] = Field(default_factory=lambda: ["all"])
    preload: bool = False
    tags: list[str] = Field(default_factory=list)
    last_updated: str = ""


class SkillDetail(SkillSpec):
    """Workspace skill fields loaded only when its editor is opened."""

    content: str
    config: dict[str, Any] = Field(default_factory=dict)
    installed_from: str = ""
    requirements: SkillRequirements = Field(default_factory=SkillRequirements)


class PoolSkillSpec(BaseModel):
    """Skill-pool metadata returned by list endpoints."""

    name: str
    description: str = ""
    version_text: str = ""
    source: str
    emoji: str = ""
    external: bool = False
    external_path: str = ""
    sync_status: str = ""
    tags: list[str] = Field(default_factory=list)
    last_updated: str = ""
    auto_sync: bool = False
    auto_update: bool = False


class PoolSkillDetail(PoolSkillSpec):
    """Skill-pool fields loaded only when its editor is opened."""

    content: str
    config: dict[str, Any] = Field(default_factory=dict)
    installed_from: str = ""
    requirements: SkillRequirements = Field(default_factory=SkillRequirements)
    builtin_language: str = ""
    available_builtin_languages: list[str] = Field(default_factory=list)
    auto_sync_targets: list[str] | None = None


class WorkspaceSkillSummary(BaseModel):
    agent_id: str
    agent_name: str = ""
    skill_names: list[str] = Field(default_factory=list)


class HubSkillSpec(BaseModel):
    slug: str
    name: str
    description: str = ""
    version: str = ""
    source_url: str = ""
    author: str = ""
    icon_url: str = ""


class BuiltinImportSpec(BaseModel):
    name: str
    description: str = ""
    version_text: str = ""
    current_version_text: str = ""
    current_source: str = ""
    current_language: str = ""
    available_languages: list[str] = Field(default_factory=list)
    languages: dict[str, dict[str, Any]] = Field(default_factory=dict)
    status: str = ""


class BuiltinRemovedSpec(BaseModel):
    name: str
    description: str = ""
    current_version_text: str = ""
    current_source: str = ""


class BuiltinUpdateNotice(BaseModel):
    fingerprint: str = ""
    has_updates: bool = False
    total_changes: int = 0
    actionable_skill_names: list[str] = Field(default_factory=list)
    added: list[BuiltinImportSpec] = Field(default_factory=list)
    missing: list[BuiltinImportSpec] = Field(default_factory=list)
    updated: list[BuiltinImportSpec] = Field(default_factory=list)
    removed: list[BuiltinRemovedSpec] = Field(default_factory=list)


class BuiltinImportSelection(BaseModel):
    skill_name: str
    language: str = ""


class ImportBuiltinRequest(BaseModel):
    skill_names: list[str] = Field(
        default_factory=list,
    )  # Deprecated: use imports
    imports: list[BuiltinImportSelection] = Field(default_factory=list)
    overwrite_conflicts: bool = False


class UpdateBuiltinRequest(BaseModel):
    language: str = ""


class CreateSkillRequest(BaseModel):
    name: str
    content: str
    references: dict[str, Any] | None = None
    scripts: dict[str, Any] | None = None
    config: dict[str, Any] | None = None
    enable: bool = True


class UploadToPoolRequest(BaseModel):
    workspace_id: str
    skill_name: str
    overwrite: bool = False
    preview_only: bool = False


class PoolDownloadTarget(BaseModel):
    workspace_id: str


class DownloadFromPoolRequest(BaseModel):
    skill_name: str
    targets: list[PoolDownloadTarget] = Field(default_factory=list)
    all_workspaces: bool = False
    overwrite: bool = False
    preview_only: bool = False


class SkillConfigRequest(BaseModel):
    config: dict[str, Any] = Field(default_factory=dict)


class AutoSyncRequest(BaseModel):
    enabled: bool
    targets: list[str] | None = None


class SkillAutomationRequest(BaseModel):
    auto_update: bool | None = None
    auto_sync: AutoSyncRequest | None = None


class SavePoolSkillRequest(BaseModel):
    name: str
    content: str
    source_name: str | None = None
    config: dict[str, Any] | None = None
    overwrite: bool = False


class SaveSkillRequest(BaseModel):
    name: str
    content: str
    source_name: str | None = None
    config: dict[str, Any] | None = None
    overwrite: bool = False


class HubInstallRequest(BaseModel):
    bundle_url: str = Field(..., description="Skill URL")
    version: str = Field(default="", description="Optional version tag")
    enable: bool = Field(default=True, description="Enable after import")
    target_name: str = Field(default="", description="Optional renamed skill")


class HubInstallTaskStatus(str, Enum):
    PENDING = "pending"
    IMPORTING = "importing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class HubInstallTask(BaseModel):
    task_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    bundle_url: str
    version: str = ""
    enable: bool = True
    status: HubInstallTaskStatus = HubInstallTaskStatus.PENDING
    error: str | None = None
    result: dict[str, Any] | None = None
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


_hub_install_tasks: dict[str, HubInstallTask] = {}
_hub_install_runtime_tasks: dict[str, asyncio.Task] = {}
_hub_install_cancel_events: dict[str, threading.Event] = {}
_hub_install_lock = asyncio.Lock()


class SkillsMarketPayload(BaseModel):
    version: int = Field(default=1)
    cache: dict[str, int] = Field(default_factory=lambda: {"ttl_sec": 600})
    install: dict[str, bool] = Field(
        default_factory=lambda: {"overwrite_default": False},
    )
    markets: list[SkillMarketSpec] = Field(default_factory=list)


class ValidateMarketRequest(SkillMarketSpec):
    pass


class MarketError(BaseModel):
    market_id: str
    code: str
    message: str
    retryable: bool = False


class MarketplaceItem(BaseModel):
    market_id: str
    skill_id: str
    name: str
    description: str = ""
    version: str = ""
    source_url: str
    install_url: str
    tags: list[str] = Field(default_factory=list)


class InstallMarketplaceRequest(BaseModel):
    market_id: str
    skill_id: str
    enable: bool = True
    overwrite: bool = False


_OWNER_REPO_PATTERN = re.compile(r"^[\w.-]+/[\w.-]+$")
_MARKETPLACE_CACHE_LOCK = threading.Lock()
_MARKETPLACE_CACHE: dict[str, Any] = {
    "expires_at": 0.0,
    "items": [],
    "errors": [],
    "meta": {},
}
_SKILLS_MARKET_DEFAULT_DIR = Path(__file__).resolve().parents[2] / "skills_market"
_SKILLS_MARKET_CONFIG_PATH = _SKILLS_MARKET_DEFAULT_DIR / "config.json"
_SKILLS_MARKET_DEFAULT_PATH = _SKILLS_MARKET_DEFAULT_DIR / "default.json"

_HUB_INSTALL_TASK_TTL_SECONDS = 10 * 60
_HUB_INSTALL_TASK_MAX_HISTORY = 100
_HUB_INSTALL_TERMINAL_STATUSES = frozenset(
    {
        HubInstallTaskStatus.COMPLETED,
        HubInstallTaskStatus.FAILED,
        HubInstallTaskStatus.CANCELLED,
    },
)

_ALLOWED_ZIP_TYPES = {
    "application/zip",
    "application/x-zip-compressed",
    "application/octet-stream",
}


def _load_market_payload_from_path(path: Path) -> SkillsMarketPayload:
    raw = json.loads(path.read_text(encoding="utf-8"))
    return SkillsMarketPayload.model_validate(raw)


def _write_market_payload_to_path(payload: SkillsMarketPayload, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload.model_dump(mode="json"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _load_current_market_config() -> SkillsMarketConfig:
    if _SKILLS_MARKET_CONFIG_PATH.exists():
        return _payload_to_market_config(
            _load_market_payload_from_path(_SKILLS_MARKET_CONFIG_PATH),
        )
    return load_config().skills_market


def _extract_github_market_spec(url: str) -> tuple[str, str, str] | None:
    parsed = urlparse((url or "").strip())
    host = (parsed.netloc or "").lower()
    if host not in {"github.com", "www.github.com"}:
        return None
    parts = [unquote(p) for p in parsed.path.split("/") if p]
    if len(parts) < 2:
        return None

    owner, repo = parts[0], parts[1]
    if repo.endswith(".git"):
        repo = repo[: -len(".git")]
    repo_url = f"https://github.com/{owner}/{repo}.git"
    branch = ""
    path = ""
    if len(parts) >= 4 and parts[2] in {"tree", "blob"}:
        branch = parts[3].strip()
        if len(parts) > 4:
            path = "/".join(parts[4:]).strip()
    return repo_url, branch, path


def _normalize_market_url(url: str) -> str:
    raw = (url or "").strip()
    if _OWNER_REPO_PATTERN.fullmatch(raw):
        return f"https://github.com/{raw}.git"
    return raw


def _normalize_market_spec(market: SkillMarketSpec) -> SkillMarketSpec:
    normalized = market.model_copy(deep=True)
    github_spec = _extract_github_market_spec(normalized.url)
    if github_spec is not None:
        repo_url, branch, path = github_spec
        normalized.url = repo_url
        if branch and not normalized.branch:
            normalized.branch = branch
        if path and (
            not normalized.path
            or normalized.path == "index.json"
            or normalized.path == "/"
        ):
            normalized.path = path
        return normalized
    normalized.url = _normalize_market_url(normalized.url)
    return normalized


def _validate_market_url(url: str) -> bool:
    raw = (url or "").strip()
    if not raw:
        return False
    if _OWNER_REPO_PATTERN.fullmatch(raw):
        return True
    if _extract_github_market_spec(raw) is not None:
        return True
    if raw.startswith(("https://", "http://", "git@")):
        return True
    if raw.endswith(".git"):
        return True
    return False


def _validate_market_path(path: str) -> bool:
    raw = (path or "").strip() or "index.json"
    candidate = Path(raw)
    if candidate.is_absolute():
        return False
    return ".." not in candidate.parts


def _validate_market_ids(markets: list[SkillMarketSpec]) -> None:
    seen: set[str] = set()
    for market in markets:
        if market.id in seen:
            raise HTTPException(
                status_code=400,
                detail=f"MARKET_ID_DUPLICATED: {market.id}",
            )
        seen.add(market.id)


def _market_config_to_payload(cfg: SkillsMarketConfig) -> SkillsMarketPayload:
    return SkillsMarketPayload(
        version=cfg.version,
        cache={"ttl_sec": cfg.cache.ttl_sec},
        install={"overwrite_default": cfg.install.overwrite_default},
        markets=cfg.markets,
    )


def _payload_to_market_config(payload: SkillsMarketPayload) -> SkillsMarketConfig:
    _validate_market_ids(payload.markets)
    normalized_markets: list[SkillMarketSpec] = []
    for market in payload.markets:
        normalized_market = _normalize_market_spec(market)
        if not _validate_market_url(normalized_market.url):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"MARKET_URL_INVALID: {market.url}. "
                    "Use owner/repo, http(s), ssh, or .git URL"
                ),
            )
        if not _validate_market_path(normalized_market.path):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"MARKET_INDEX_INVALID: invalid path '{normalized_market.path}'"
                ),
            )
        normalized_markets.append(normalized_market)

    ttl_sec = int(payload.cache.get("ttl_sec", 600))
    overwrite_default = bool(payload.install.get("overwrite_default", False))
    return SkillsMarketConfig(
        version=max(1, int(payload.version)),
        markets=normalized_markets,
        cache=SkillsMarketCacheConfig(ttl_sec=ttl_sec),
        install=SkillsMarketInstallConfig(
            overwrite_default=overwrite_default,
        ),
    )


def _run_git_command(
    args: list[str],
    *,
    cwd: str | None = None,
    timeout_sec: int = 30,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=timeout_sec,
        check=False,
    )


def _market_repo_web_url(url: str) -> str:
    raw = (url or "").strip()
    if raw.startswith("git@github.com:"):
        repo = raw[len("git@github.com:") :]
        if repo.endswith(".git"):
            repo = repo[: -len(".git")]
        return f"https://github.com/{repo}"
    if raw.endswith(".git"):
        return raw[: -len(".git")]
    return raw


def _is_markdown_market_file(path: Path) -> bool:
    suffix = path.suffix.lower()
    if suffix not in {".md", ".markdown"}:
        return False
    return path.name.lower() not in {
        "readme.md",
        "readme.markdown",
        "index.md",
        "index.markdown",
    }


def _build_market_skill_entry(
    market: SkillMarketSpec,
    *,
    skill_id: str,
    name: str,
    source_path: str,
    branch: str,
) -> dict[str, Any]:
    return {
        "skill_id": skill_id,
        "name": name,
        "description": "",
        "version": "",
        "source": {
            "type": "git",
            "url": market.url,
            "branch": branch,
            "path": source_path,
        },
        "tags": [],
    }


def _generate_market_index_from_directory(
    market: SkillMarketSpec,
    skills_dir: Path,
    *,
    effective_branch: str,
) -> tuple[dict[str, Any], list[str]]:
    branch = effective_branch or market.branch or "main"
    warnings: list[str] = []
    skills: list[dict[str, Any]] = []
    for sub in sorted(skills_dir.iterdir()):
        if sub.is_dir() and (sub / "SKILL.md").exists():
            rel_path = sub.relative_to(skills_dir.parent).as_posix()
            skills.append(
                _build_market_skill_entry(
                    market,
                    skill_id=sub.name,
                    name=sub.name,
                    source_path=rel_path,
                    branch=branch,
                ),
            )
            continue
        if sub.is_file() and _is_markdown_market_file(sub):
            rel_path = sub.relative_to(skills_dir.parent).as_posix()
            skills.append(
                _build_market_skill_entry(
                    market,
                    skill_id=sub.stem,
                    name=sub.stem,
                    source_path=rel_path,
                    branch=branch,
                ),
            )
    if not skills:
        warnings.append(
            "No importable skill entries found in market directory",
        )
    return {"skills": skills}, warnings


def _generate_market_index_from_markdown_file(
    market: SkillMarketSpec,
    markdown_path: Path,
    *,
    repo_dir: Path,
    effective_branch: str,
) -> tuple[dict[str, Any], list[str]]:
    branch = effective_branch or market.branch or "main"
    rel_path = markdown_path.relative_to(repo_dir).as_posix()
    return {
        "skills": [
            _build_market_skill_entry(
                market,
                skill_id=markdown_path.stem,
                name=markdown_path.stem,
                source_path=rel_path,
                branch=branch,
            ),
        ],
    }, []


def _is_default_market_index_path(path: str) -> bool:
    raw = (path or "").strip()
    return raw in {"", "/", "index.json"}


def _market_source_install_url(
    repo_web_url: str,
    branch: str,
    source_path: str,
) -> str:
    if not source_path:
        return repo_web_url
    if source_path.lower().endswith((".md", ".markdown")):
        return f"{repo_web_url}/blob/{branch}/{source_path}"
    return f"{repo_web_url}/tree/{branch}/{source_path}"


def _load_market_index(market: SkillMarketSpec) -> tuple[dict[str, Any], list[str]]:
    normalized_market = _normalize_market_spec(market)
    market_url = _normalize_market_url(normalized_market.url)
    with tempfile.TemporaryDirectory(prefix="copaw-market-") as tmp:
        repo_dir = Path(tmp) / "repo"
        clone_args = ["clone", "--depth", "1"]
        if normalized_market.branch:
            clone_args += ["--branch", normalized_market.branch]
        clone_args += [market_url, str(repo_dir)]
        clone_result = _run_git_command(clone_args, timeout_sec=40)
        if clone_result.returncode != 0:
            raise RuntimeError(
                "MARKET_UNREACHABLE: "
                + (clone_result.stderr.strip() or "clone failed"),
            )

        effective_branch = (normalized_market.branch or "").strip()
        if not effective_branch:
            branch_result = _run_git_command(
                ["rev-parse", "--abbrev-ref", "HEAD"],
                cwd=str(repo_dir),
                timeout_sec=10,
            )
            if branch_result.returncode == 0:
                effective_branch = branch_result.stdout.strip()

        target_raw_path = normalized_market.path or "index.json"
        target_path = repo_dir / target_raw_path
        warnings: list[str] = []
        if target_path.is_file():
            if target_path.suffix.lower() in {".md", ".markdown"}:
                return _generate_market_index_from_markdown_file(
                    normalized_market,
                    target_path,
                    repo_dir=repo_dir,
                    effective_branch=effective_branch,
                )
            return json.loads(target_path.read_text(encoding="utf-8")), warnings
        if target_path.is_dir():
            return _generate_market_index_from_directory(
                normalized_market,
                target_path,
                effective_branch=effective_branch,
            )
        if _is_default_market_index_path(target_raw_path):
            fallback_skills_dir = repo_dir / "skills"
            if fallback_skills_dir.is_dir():
                index_doc, fallback_warnings = _generate_market_index_from_directory(
                    normalized_market,
                    fallback_skills_dir,
                    effective_branch=effective_branch,
                )
                return index_doc, [
                    (
                        "index.json not found; auto-generated marketplace "
                        "from skills/"
                    ),
                    *fallback_warnings,
                ]
        raise ValueError(
            f"MARKET_INDEX_INVALID: path '{normalized_market.path}' not found",
        )


def _extract_market_items(
    market: SkillMarketSpec,
    index_doc: dict[str, Any],
) -> tuple[list[MarketplaceItem], list[MarketError]]:
    skills = index_doc.get("skills")
    if not isinstance(skills, list):
        return [], [
            MarketError(
                market_id=market.id,
                code="MARKET_INDEX_INVALID",
                message="skills field must be a list",
            ),
        ]

    items: list[MarketplaceItem] = []
    errors: list[MarketError] = []
    for raw in skills:
        if not isinstance(raw, dict):
            errors.append(
                MarketError(
                    market_id=market.id,
                    code="MARKET_INDEX_INVALID",
                    message="skill entry must be an object",
                ),
            )
            continue
        try:
            source = raw.get("source") or {}
            if not isinstance(source, dict):
                raise ValueError("source must be an object")
            source_url = str(source.get("url") or market.url).strip()
            source_branch = str(source.get("branch") or market.branch or "main").strip()
            source_path = str(source.get("path") or "").strip()
            repo_web_url = _market_repo_web_url(source_url)
            install_url = _market_source_install_url(
                repo_web_url,
                source_branch,
                source_path,
            )

            description = raw.get("description") or ""
            if isinstance(description, dict):
                description = (
                    description.get("zh")
                    or description.get("en")
                    or next(iter(description.values()), "")
                )

            items.append(
                MarketplaceItem(
                    market_id=market.id,
                    skill_id=str(raw.get("skill_id") or raw.get("name") or "").strip(),
                    name=str(raw.get("name") or raw.get("skill_id") or "").strip(),
                    description=str(description or ""),
                    version=str(raw.get("version") or ""),
                    source_url=source_url,
                    install_url=install_url,
                    tags=[str(tag) for tag in raw.get("tags") or []],
                ),
            )
        except Exception as exc:
            errors.append(
                MarketError(
                    market_id=market.id,
                    code="MARKET_INDEX_INVALID",
                    message=str(exc),
                ),
            )
    return items, errors


def _aggregate_marketplace(
    cfg: SkillsMarketConfig | None = None,
    *,
    refresh: bool = False,
) -> tuple[list[MarketplaceItem], list[MarketError], dict[str, Any]]:
    cfg = cfg or _load_current_market_config()
    now = time.time()
    ttl = max(0, int(cfg.cache.ttl_sec))
    with _MARKETPLACE_CACHE_LOCK:
        if not refresh and _MARKETPLACE_CACHE["expires_at"] > now:
            return (
                list(_MARKETPLACE_CACHE["items"]),
                list(_MARKETPLACE_CACHE["errors"]),
                dict(_MARKETPLACE_CACHE["meta"]),
            )

    items: list[MarketplaceItem] = []
    errors: list[MarketError] = []
    enabled_markets = [market for market in cfg.markets if market.enabled]
    success_market_count = 0
    for market in enabled_markets:
        try:
            index_doc, warnings = _load_market_index(market)
            market_items, market_errors = _extract_market_items(market, index_doc)
            items.extend(market_items)
            errors.extend(market_errors)
            for warning in warnings:
                errors.append(
                    MarketError(
                        market_id=market.id,
                        code="MARKET_WARNING",
                        message=warning,
                    ),
                )
            success_market_count += 1
        except Exception as exc:
            errors.append(
                MarketError(
                    market_id=market.id,
                    code="MARKET_UNREACHABLE",
                    message=str(exc),
                    retryable=True,
                ),
            )
    meta = {
        "refreshed_at": int(now),
        "cache_hit": False,
        "enabled_market_count": len(enabled_markets),
        "success_market_count": success_market_count,
        "item_count": len(items),
    }
    with _MARKETPLACE_CACHE_LOCK:
        _MARKETPLACE_CACHE.update(
            {
                "expires_at": now + ttl,
                "items": list(items),
                "errors": list(errors),
                "meta": dict(meta),
            },
        )
    return items, errors, meta


def _workspace_dir_for_agent(agent_id: str) -> Path:
    for workspace in list_workspaces():
        if workspace["agent_id"] == agent_id:
            return Path(workspace["workspace_dir"])
    raise HTTPException(
        status_code=404,
        detail=f"Workspace '{agent_id}' not found",
    )


def _snapshot_workspace_skill(
    workspace_dir: Path,
    skill_name: str,
) -> dict[str, Any]:
    manifest = read_skill_manifest(workspace_dir)
    entry = manifest.get("skills", {}).get(skill_name)
    skill_dir = workspace_dir / "skills" / skill_name
    backup_dir: Path | None = None
    if skill_dir.exists():
        backup_root = Path(
            tempfile.mkdtemp(prefix=f"qwenpaw_skill_rollback_{skill_name}_"),
        )
        backup_dir = backup_root / skill_name
        shutil.copytree(skill_dir, backup_dir)
    return {
        "workspace_dir": workspace_dir,
        "skill_name": skill_name,
        "entry": copy.deepcopy(entry) if entry is not None else None,
        "backup_dir": backup_dir,
    }


def _restore_workspace_skill(snapshot: dict[str, Any]) -> None:
    workspace_dir = Path(snapshot["workspace_dir"])
    skill_name = str(snapshot["skill_name"])
    skill_dir = workspace_dir / "skills" / skill_name
    backup_dir = snapshot.get("backup_dir")
    entry = snapshot.get("entry")

    if skill_dir.exists():
        shutil.rmtree(skill_dir)
    if backup_dir is not None and Path(backup_dir).exists():
        shutil.copytree(Path(backup_dir), skill_dir)

    def _restore(payload: dict[str, Any]) -> None:
        payload.setdefault("skills", {})
        if entry is None:
            payload["skills"].pop(skill_name, None)
            return
        payload["skills"][skill_name] = copy.deepcopy(entry)

    mutate_json(
        get_workspace_skill_manifest_path(workspace_dir),
        default_workspace_manifest(),
        _restore,
    )
    reconcile_workspace_manifest(workspace_dir)
    if backup_dir is not None:
        shutil.rmtree(Path(backup_dir).parent, ignore_errors=True)


async def _request_workspace_dir(request: Request) -> Path:
    from ..agent_context import get_agent_for_request

    workspace = await get_agent_for_request(request)
    return Path(workspace.workspace_dir)


async def _hub_task_set_status(
    task_id: str,
    status: HubInstallTaskStatus,
    *,
    error: str | None = None,
    result: dict[str, Any] | None = None,
) -> None:
    async with _hub_install_lock:
        task = _hub_install_tasks.get(task_id)
        if task is None:
            return
        task.status = status
        task.updated_at = time.time()
        if error is not None:
            task.error = error
        if result is not None:
            task.result = result


async def _hub_task_get(task_id: str) -> HubInstallTask | None:
    async with _hub_install_lock:
        _hub_task_cleanup_locked()
        return _hub_install_tasks.get(task_id)


async def validate_market(payload: ValidateMarketRequest) -> dict[str, Any]:
    normalized = _normalize_market_spec(payload)
    if not _validate_market_url(normalized.url):
        raise HTTPException(
            status_code=400,
            detail=(
                f"MARKET_URL_INVALID: {payload.url}. "
                "Use owner/repo, http(s), ssh, or .git URL"
            ),
        )
    if not _validate_market_path(normalized.path):
        raise HTTPException(
            status_code=400,
            detail=f"MARKET_INDEX_INVALID: invalid path '{normalized.path}'",
        )

    ls_remote = _run_git_command(["ls-remote", normalized.url], timeout_sec=20)
    if ls_remote.returncode != 0:
        raise HTTPException(
            status_code=502,
            detail="MARKET_UNREACHABLE: "
            + (ls_remote.stderr.strip() or "ls-remote failed"),
        )

    try:
        _index_doc, warnings = _load_market_index(normalized)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return {
        "ok": True,
        "normalized": normalized.model_dump(mode="json"),
        "warnings": warnings,
    }


@router.get("/markets", response_model=SkillsMarketPayload)
async def get_markets() -> SkillsMarketPayload:
    return _market_config_to_payload(_load_current_market_config())


@router.put("/markets", response_model=SkillsMarketPayload)
async def save_markets(payload: SkillsMarketPayload) -> SkillsMarketPayload:
    cfg = _payload_to_market_config(payload)
    current = load_config()
    current.skills_market = cfg
    save_config(current)

    normalized_payload = _market_config_to_payload(cfg)
    _write_market_payload_to_path(normalized_payload, _SKILLS_MARKET_CONFIG_PATH)
    with _MARKETPLACE_CACHE_LOCK:
        _MARKETPLACE_CACHE["expires_at"] = 0.0
    return normalized_payload


@router.get("/markets/defaults", response_model=SkillsMarketPayload)
async def get_market_defaults() -> SkillsMarketPayload:
    return _load_market_payload_from_path(_SKILLS_MARKET_DEFAULT_PATH)


@router.post("/markets/reset", response_model=SkillsMarketPayload)
async def reset_markets() -> SkillsMarketPayload:
    payload = _load_market_payload_from_path(_SKILLS_MARKET_DEFAULT_PATH)
    _write_market_payload_to_path(payload, _SKILLS_MARKET_CONFIG_PATH)
    return payload


@router.post("/markets/validate")
async def validate_market_endpoint(payload: ValidateMarketRequest) -> dict[str, Any]:
    return await validate_market(payload)


@router.get("/marketplace")
async def get_marketplace(refresh: bool = False) -> dict[str, Any]:
    items, errors, meta = _aggregate_marketplace(refresh=refresh)
    return {
        "items": [item.model_dump(mode="json") for item in items],
        "market_errors": [error.model_dump(mode="json") for error in errors],
        "meta": meta,
    }


@router.post("/marketplace/install")
async def install_marketplace_skill(
    payload: InstallMarketplaceRequest,
    request: Request,
) -> dict[str, Any]:
    cfg = _load_current_market_config()
    items, _errors, _meta = _aggregate_marketplace(cfg, refresh=True)
    selected = next(
        (
            item
            for item in items
            if item.market_id == payload.market_id and item.skill_id == payload.skill_id
        ),
        None,
    )
    if selected is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"MARKET_ITEM_NOT_FOUND: market={payload.market_id} skill={payload.skill_id}"
            ),
        )

    from ..agent_context import get_agent_for_request

    workspace = await get_agent_for_request(request)
    workspace_dir = Path(workspace.workspace_dir)

    overwrite = payload.overwrite or bool(cfg.install.overwrite_default)
    try:
        result = install_skill_from_hub(
            workspace_dir=workspace_dir,
            bundle_url=selected.install_url,
            enable=payload.enable,
            overwrite=overwrite,
        )
    except SkillScanError as exc:
        return _scan_error_response(exc)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except SkillConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.detail) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    reconcile_workspace_manifest(workspace_dir)
    if payload.enable and result.enabled:
        schedule_agent_reload(request, workspace.agent_id)

    return {
        "installed": True,
        "workspace_dir": str(workspace.workspace_dir),
        "market_id": payload.market_id,
        "skill_id": payload.skill_id,
        "name": result.name,
        "enabled": result.enabled,
        "source_url": result.source_url,
    }


async def _hub_task_register_runtime(task_id: str, task: asyncio.Task) -> None:
    async with _hub_install_lock:
        _hub_install_runtime_tasks[task_id] = task


def _hub_task_cleanup_locked(*, now: float | None = None) -> None:
    """Remove expired/excess finished tasks while the registry lock is held."""
    current_time = time.time() if now is None else now
    finished = [
        task
        for task_id, task in _hub_install_tasks.items()
        if task.status in _HUB_INSTALL_TERMINAL_STATUSES
        and task_id not in _hub_install_runtime_tasks
    ]

    expired_ids = {
        task.task_id
        for task in finished
        if current_time - task.updated_at > _HUB_INSTALL_TASK_TTL_SECONDS
    }
    retained = [task for task in finished if task.task_id not in expired_ids]
    excess = max(0, len(retained) - _HUB_INSTALL_TASK_MAX_HISTORY)
    if excess:
        retained.sort(key=lambda task: (task.updated_at, task.created_at))
        expired_ids.update(task.task_id for task in retained[:excess])

    for expired_id in expired_ids:
        _hub_install_tasks.pop(expired_id, None)
        _hub_install_cancel_events.pop(expired_id, None)


async def _hub_task_finish_runtime(task_id: str) -> None:
    async with _hub_install_lock:
        _hub_install_runtime_tasks.pop(task_id, None)
        _hub_install_cancel_events.pop(task_id, None)
        task = _hub_install_tasks.get(task_id)
        if task is not None and task.status in _HUB_INSTALL_TERMINAL_STATUSES:
            # Retention starts when the worker actually stops, which can be
            # later than the cancel endpoint's terminal response.
            task.updated_at = time.time()
        _hub_task_cleanup_locked()


async def _read_validated_zip_upload(file: UploadFile) -> bytes:
    if file.content_type and file.content_type not in _ALLOWED_ZIP_TYPES:
        raise HTTPException(
            status_code=400,
            detail=(
                "Expected a zip file, "
                f"got content-type: {file.content_type}"
            ),
        )

    data = await file.read()
    check_upload_size(data)
    return data


def _cleanup_imported_skill(workspace_dir: Path, skill_name: str) -> None:
    if not skill_name:
        return
    try:
        skill_service = SkillService(workspace_dir)
        skill_service.disable_skill(skill_name)
        skill_service.delete_skill(skill_name)
    except Exception as exc:  # pragma: no cover
        logger.warning(
            "Cleanup after cancelled import failed for '%s': %s",
            skill_name,
            exc,
        )


async def _run_hub_install_task(
    *,
    task_id: str,
    workspace_dir: Path,
    body: HubInstallRequest,
    cancel_event: threading.Event,
) -> None:
    await _hub_task_set_status(task_id, HubInstallTaskStatus.IMPORTING)
    imported_skill_name: str | None = None
    try:
        result = await install_skill_from_hub(
            workspace_dir=workspace_dir,
            bundle_url=body.bundle_url,
            version=body.version,
            enable=body.enable,
            target_name=body.target_name,
            cancel_checker=cancel_event.is_set,
        )
        imported_skill_name = result.name
        if cancel_event.is_set():
            _cleanup_imported_skill(workspace_dir, result.name)
            await _hub_task_set_status(
                task_id,
                HubInstallTaskStatus.CANCELLED,
                result={
                    "installed": False,
                    "name": result.name,
                    "enabled": False,
                    "source_url": result.source_url,
                    "installed_from": result.installed_from,
                },
            )
            return
        await _hub_task_set_status(
            task_id,
            HubInstallTaskStatus.COMPLETED,
            result={
                "installed": True,
                "name": result.name,
                "enabled": result.enabled,
                "source_url": result.source_url,
                "installed_from": result.installed_from,
            },
        )
    except SkillImportCancelled:
        if imported_skill_name:
            _cleanup_imported_skill(workspace_dir, imported_skill_name)
        await _hub_task_set_status(task_id, HubInstallTaskStatus.CANCELLED)
    except asyncio.CancelledError:
        await _hub_task_set_status(task_id, HubInstallTaskStatus.CANCELLED)
        raise
    except SkillScanError as exc:
        await _hub_task_set_status(
            task_id,
            HubInstallTaskStatus.FAILED,
            error=str(exc),
            result=_scan_error_payload(exc),
        )
    except SkillConflictError as exc:
        await _hub_task_set_status(
            task_id,
            HubInstallTaskStatus.FAILED,
            error=str(exc),
            result=exc.detail,
        )
    except (ValueError, AppBaseException) as exc:
        await _hub_task_set_status(
            task_id,
            HubInstallTaskStatus.FAILED,
            error=str(exc),
        )
    except RuntimeError as exc:
        await _hub_task_set_status(
            task_id,
            HubInstallTaskStatus.FAILED,
            error=str(exc),
        )
    except Exception as exc:  # pragma: no cover
        await _hub_task_set_status(
            task_id,
            HubInstallTaskStatus.FAILED,
            error=f"Skill hub import failed: {exc}",
        )
    finally:
        await _hub_task_finish_runtime(task_id)


def _build_workspace_skill_specs(workspace_dir: Path) -> list[SkillSpec]:
    manifest = read_skill_manifest(workspace_dir)
    entries = manifest.get("skills", {})
    skill_root = get_workspace_skills_dir(workspace_dir)
    specs: list[SkillSpec] = []
    for skill_name, raw_entry in sorted(entries.items()):
        entry = normalize_skill_manifest_entry(raw_entry)
        if raw_entry not in (None, entry):
            logger.warning(
                "Skipping malformed workspace skill entry '%s' in manifest",
                skill_name,
            )
        try:
            source = entry.get("source", "customized")
            skill_dir = safe_skill_dir(skill_root, skill_name)
            if not (skill_dir / "SKILL.md").is_file():
                continue
            metadata = build_skill_metadata(
                skill_name,
                skill_dir,
                source=source,
            )
            specs.append(
                SkillSpec(
                    name=skill_name,
                    description=str(metadata.get("description", "") or ""),
                    version_text=metadata["version_text"],
                    source=source,
                    emoji=str(metadata.get("emoji", "") or ""),
                    enabled=entry.get("enabled", False),
                    channels=entry.get("channels") or ["all"],
                    preload=entry.get("preload") is True,
                    tags=entry.get("tags") or [],
                    last_updated=str(metadata.get("updated_at", "") or ""),
                ),
            )
        except Exception:
            logger.warning(
                "Skipping workspace skill '%s': failed to build spec",
                skill_name,
                exc_info=True,
            )
    return specs


def _build_pool_skill_specs() -> list[PoolSkillSpec]:
    manifest = read_skill_pool_manifest()
    entries = manifest.get("skills", {})
    sync_info = get_pool_builtin_sync_status(pool_skills=entries)
    specs: list[PoolSkillSpec] = []
    for skill_name, raw_entry in sorted(entries.items()):
        entry = normalize_skill_manifest_entry(raw_entry)
        if raw_entry not in (None, entry):
            logger.warning(
                "Skipping malformed pool skill entry '%s' in manifest",
                skill_name,
            )
        try:
            source = entry.get("source", "customized")
            skill_dir = resolve_pool_skill_dir(skill_name)
            if skill_dir is None:
                continue
            metadata = build_skill_metadata(
                skill_name,
                skill_dir,
                source=source,
            )
            info = sync_info.get(skill_name, {})
            is_external = bool(entry.get("external", False))
            automation = read_pool_skill_automation(entry)
            specs.append(
                PoolSkillSpec(
                    name=skill_name,
                    description=str(metadata.get("description", "") or ""),
                    version_text=metadata["version_text"],
                    source=source,
                    emoji=str(metadata.get("emoji", "") or ""),
                    external=is_external,
                    external_path=str(skill_dir) if is_external else "",
                    sync_status=str(info.get("sync_status", "") or ""),
                    tags=entry.get("tags") or [],
                    last_updated=str(metadata.get("updated_at", "") or ""),
                    auto_sync=automation.auto_sync,
                    auto_update=(
                        source == "builtin" and automation.auto_update
                    ),
                ),
            )
        except Exception:
            logger.warning(
                "Skipping pool skill '%s': failed to build spec",
                skill_name,
                exc_info=True,
            )
    return specs


def _build_workspace_skill_detail(
    workspace_dir: Path,
    skill_name: str,
) -> SkillDetail | None:
    manifest = read_skill_manifest(workspace_dir)
    raw_entry = manifest.get("skills", {}).get(skill_name)
    if raw_entry is None:
        return None
    entry = normalize_skill_manifest_entry(raw_entry)
    try:
        skill_dir = safe_skill_dir(
            get_workspace_skills_dir(workspace_dir),
            skill_name,
        )
    except AppBaseException:
        return None
    source = str(entry.get("source", "customized") or "customized")
    skill_data = read_skill_content_and_metadata_from_dir(
        skill_name,
        skill_dir,
        source=source,
    )
    if skill_data is None:
        return None
    content, metadata = skill_data
    return SkillDetail(
        name=skill_name,
        description=str(metadata.get("description", "") or ""),
        version_text=metadata["version_text"],
        requirements=SkillRequirements(**metadata["requirements"]),
        source=source,
        emoji=str(metadata.get("emoji", "") or ""),
        enabled=bool(entry.get("enabled", False)),
        channels=entry.get("channels") or ["all"],
        preload=entry.get("preload") is True,
        tags=entry.get("tags") or [],
        last_updated=str(metadata.get("updated_at", "") or ""),
        content=content,
        config=entry.get("config") or {},
        installed_from=str(entry.get("installed_from", "") or ""),
    )


def _build_pool_skill_detail(skill_name: str) -> PoolSkillDetail | None:
    manifest = read_skill_pool_manifest()
    entries = manifest.get("skills", {})
    raw_entry = entries.get(skill_name)
    if raw_entry is None:
        return None
    entry = normalize_skill_manifest_entry(raw_entry)
    skill_dir = resolve_pool_skill_dir(skill_name)
    if skill_dir is None:
        return None
    source = str(entry.get("source", "customized") or "customized")
    skill_data = read_skill_content_and_metadata_from_dir(
        skill_name,
        skill_dir,
        source=source,
    )
    if skill_data is None:
        return None
    content, metadata = skill_data
    info = get_pool_builtin_sync_status(pool_skills=entries).get(
        skill_name,
        {},
    )
    is_external = bool(entry.get("external", False))
    automation = read_pool_skill_automation(entry)
    return PoolSkillDetail(
        name=skill_name,
        description=str(metadata.get("description", "") or ""),
        version_text=metadata["version_text"],
        requirements=SkillRequirements(**metadata["requirements"]),
        source=source,
        emoji=str(metadata.get("emoji", "") or ""),
        external=is_external,
        external_path=str(skill_dir) if is_external else "",
        sync_status=str(info.get("sync_status", "") or ""),
        tags=entry.get("tags") or [],
        last_updated=str(metadata.get("updated_at", "") or ""),
        auto_sync=automation.auto_sync,
        auto_update=(source == "builtin" and automation.auto_update),
        content=content,
        config=entry.get("config") or {},
        installed_from=str(entry.get("installed_from", "") or ""),
        builtin_language=str(entry.get("builtin_language", "") or ""),
        available_builtin_languages=[
            str(language)
            for language in (
                info.get("available_languages")
                or entry.get("available_builtin_languages")
                or []
            )
            if str(language)
        ],
        auto_sync_targets=(
            list(automation.auto_sync_targets)
            if automation.auto_sync_targets
            else None
        ),
    )


def _list_workspace_skill_names(workspace_dir: Path) -> list[str]:
    """List names that the former full workspace index would have returned."""
    manifest = read_skill_manifest(workspace_dir)
    skill_root = get_workspace_skills_dir(workspace_dir)
    names: list[str] = []
    for skill_name in sorted(manifest.get("skills", {})):
        try:
            skill_dir = safe_skill_dir(skill_root, skill_name)
        except AppBaseException:
            continue
        if (skill_dir / "SKILL.md").is_file():
            names.append(skill_name)
    return names


@router.get("")
async def list_skills(request: Request) -> list[SkillSpec]:
    workspace_dir = await _request_workspace_dir(request)
    return _build_workspace_skill_specs(workspace_dir)


@router.post("/refresh")
async def refresh_skills(request: Request) -> list[SkillSpec]:
    """Force reconcile and return updated workspace skill list."""
    workspace_dir = await _request_workspace_dir(request)
    reconcile_workspace_manifest(workspace_dir)
    return _build_workspace_skill_specs(workspace_dir)


@router.get("/hub/search")
async def search_hub(
    q: str = "",
    limit: int = 20,
) -> list[HubSkillSpec]:
    results = await search_hub_skills(q, limit=limit)
    return [
        HubSkillSpec(
            slug=item.slug,
            name=item.name,
            description=item.description,
            version=item.version,
            source_url=item.source_url,
            author=item.author,
            icon_url=item.icon_url,
        )
        for item in results
    ]


@router.get("/workspaces")
async def list_workspace_skill_sources() -> list[WorkspaceSkillSummary]:
    summaries: list[WorkspaceSkillSummary] = []
    workspaces = list_workspaces()
    for workspace in workspaces:
        workspace_dir = Path(workspace["workspace_dir"])
        summaries.append(
            WorkspaceSkillSummary(
                agent_id=workspace["agent_id"],
                agent_name=workspace.get("agent_name", ""),
                skill_names=_list_workspace_skill_names(workspace_dir),
            ),
        )
    return summaries


@router.post("/hub/install/start", response_model=HubInstallTask)
async def start_install_from_hub(
    request_body: HubInstallRequest,
    request: Request,
) -> HubInstallTask:
    workspace_dir = await _request_workspace_dir(request)
    task = HubInstallTask(
        bundle_url=request_body.bundle_url,
        version=request_body.version,
        enable=request_body.enable,
    )
    cancel_event = threading.Event()
    async with _hub_install_lock:
        _hub_task_cleanup_locked()
        _hub_install_tasks[task.task_id] = task
        _hub_install_cancel_events[task.task_id] = cancel_event
        runtime_task = asyncio.create_task(
            _run_hub_install_task(
                task_id=task.task_id,
                workspace_dir=workspace_dir,
                body=request_body,
                cancel_event=cancel_event,
            ),
            name=f"skill-hub-install-{task.task_id}",
        )
        _hub_install_runtime_tasks[task.task_id] = runtime_task
    return task


@router.get("/hub/install/status/{task_id}", response_model=HubInstallTask)
async def get_hub_install_status(task_id: str) -> HubInstallTask:
    task = await _hub_task_get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="install task not found")
    return task


@router.post("/hub/install/cancel/{task_id}")
async def cancel_hub_install(task_id: str) -> dict[str, Any]:
    async with _hub_install_lock:
        task = _hub_install_tasks.get(task_id)
        if task is None:
            raise HTTPException(
                status_code=404,
                detail="install task not found",
            )
        if task.status in _HUB_INSTALL_TERMINAL_STATUSES:
            return {"task_id": task_id, "status": task.status.value}
        cancel_event = _hub_install_cancel_events.get(task_id)
        if cancel_event is not None:
            cancel_event.set()
        task.status = HubInstallTaskStatus.CANCELLED
        task.updated_at = time.time()
    return {"task_id": task_id, "status": "cancelled"}


@router.get("/pool")
async def list_pool_skills() -> list[PoolSkillSpec]:
    return _build_pool_skill_specs()


@router.post("/pool/refresh")
async def refresh_pool_skills() -> list[PoolSkillSpec]:
    """Force reconcile and return updated pool skill list."""
    result = await asyncio.to_thread(refresh_pool_automation)
    await post_pool_automation_inbox(result)
    return _build_pool_skill_specs()


@router.get("/pool/builtin-sources")
async def list_pool_builtin_sources() -> list[BuiltinImportSpec]:
    return [
        BuiltinImportSpec(**item) for item in list_builtin_import_candidates()
    ]


@router.get("/pool/builtin-notice")
async def get_pool_builtin_notice() -> BuiltinUpdateNotice:
    notice = get_pool_builtin_update_notice()
    return BuiltinUpdateNotice(
        fingerprint=str(notice.get("fingerprint", "") or ""),
        has_updates=bool(notice.get("has_updates", False)),
        total_changes=int(notice.get("total_changes", 0) or 0),
        actionable_skill_names=[
            str(name)
            for name in notice.get("actionable_skill_names", [])
            if str(name)
        ],
        added=[BuiltinImportSpec(**item) for item in notice.get("added", [])],
        missing=[
            BuiltinImportSpec(**item) for item in notice.get("missing", [])
        ],
        updated=[
            BuiltinImportSpec(**item) for item in notice.get("updated", [])
        ],
        removed=[
            BuiltinRemovedSpec(**item) for item in notice.get("removed", [])
        ],
    )


@router.post("")
async def create_skill(
    request: Request,
    body: CreateSkillRequest,
) -> dict[str, Any]:
    from ..agent_context import get_agent_for_request

    workspace = await get_agent_for_request(request)
    workspace_dir = Path(workspace.workspace_dir)
    try:
        created = SkillService(workspace_dir).create_skill(
            name=body.name,
            content=body.content,
            references=body.references,
            scripts=body.scripts,
            config=body.config,
            enable=body.enable,
        )
    except SkillScanError as exc:
        return _scan_error_response(exc)
    except (ValueError, AppBaseException) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not created:
        raise HTTPException(
            status_code=409,
            detail={
                "reason": "conflict",
                "suggested_name": suggest_conflict_name(body.name),
            },
        )
    if body.enable:
        schedule_agent_reload(request, workspace.agent_id)
    return {"created": True, "name": created}


@router.post("/upload")
async def upload_skill_zip(
    request: Request,
    file: UploadFile = File(...),
    enable: bool = True,
    target_name: str = "",
    rename_map: str = "",
) -> dict[str, Any]:
    from ..agent_context import get_agent_for_request

    workspace = await get_agent_for_request(request)
    workspace_dir = Path(workspace.workspace_dir)
    data = await _read_validated_zip_upload(file)
    parsed_rename: dict[str, str] | None = None
    if rename_map.strip():
        try:
            parsed_rename = json.loads(rename_map)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail="rename_map must be valid JSON",
            ) from exc
        if not isinstance(parsed_rename, dict):
            raise HTTPException(
                status_code=400,
                detail="rename_map must be a JSON object",
            )
    try:
        result = await asyncio.to_thread(
            SkillService(workspace_dir).import_from_zip,
            data=data,
            enable=enable,
            target_name=target_name,
            rename_map=parsed_rename,
        )
    except SkillScanError as exc:
        return _scan_error_response(exc)
    except (ValueError, AppBaseException) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if result.get("conflicts"):
        raise HTTPException(status_code=409, detail=result)
    if enable and result.get("count", 0) > 0:
        schedule_agent_reload(request, workspace.agent_id)
    return result


@router.post("/pool/create")
async def create_pool_skill(body: CreateSkillRequest) -> dict[str, Any]:
    try:
        created = SkillPoolService().create_skill(
            name=body.name,
            content=body.content,
            references=body.references,
            scripts=body.scripts,
            config=body.config,
        )
    except SkillScanError as exc:
        return _scan_error_response(exc)
    except (ValueError, AppBaseException) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not created:
        raise HTTPException(
            status_code=409,
            detail={
                "reason": "conflict",
                "suggested_name": suggest_conflict_name(body.name),
            },
        )
    return {"created": True, "name": created}


@router.put("/pool/save")
async def save_pool_skill(body: SavePoolSkillRequest) -> dict[str, Any]:
    """Save one pool skill.

    ``overwrite`` only matters when the save would replace an existing target
    skill during rename/save-as.
    """
    service = SkillPoolService()
    try:
        result = service.save_pool_skill(
            skill_name=body.source_name or body.name,
            target_name=body.name,
            content=body.content,
            config=body.config,
            overwrite=body.overwrite,
        )
    except SkillScanError as exc:
        return _scan_error_response(exc)
    except (ValueError, AppBaseException) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not result.get("success"):
        reason = result.get("reason")
        status = 404 if reason == "not_found" else 409
        raise HTTPException(status_code=status, detail=result)
    await _follow_auto_sync(result.get("name"))
    return result


@router.post("/pool/upload-zip")
async def upload_skill_pool_zip(
    file: UploadFile = File(...),
    target_name: str = "",
    rename_map: str = "",
) -> dict[str, Any]:
    data = await _read_validated_zip_upload(file)
    parsed_rename: dict[str, str] | None = None
    if rename_map.strip():
        try:
            parsed_rename = json.loads(rename_map)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail="rename_map must be valid JSON",
            ) from exc
        if not isinstance(parsed_rename, dict):
            raise HTTPException(
                status_code=400,
                detail="rename_map must be a JSON object",
            )
    try:
        result = await asyncio.to_thread(
            SkillPoolService().import_from_zip,
            data=data,
            target_name=target_name,
            rename_map=parsed_rename,
        )
    except SkillScanError as exc:
        return _scan_error_response(exc)
    except (ValueError, AppBaseException) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if result.get("conflicts"):
        raise HTTPException(status_code=409, detail=result)
    await _follow_auto_sync()
    return result


@router.post("/pool/import")
async def import_skill_pool_from_hub(
    body: HubInstallRequest,
) -> dict[str, Any]:
    try:
        result = await import_pool_skill_from_hub(
            bundle_url=body.bundle_url,
            version=body.version,
            target_name=body.target_name,
        )
    except SkillScanError as exc:
        return _scan_error_response(exc)
    except SkillConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.detail) from exc
    except (ValueError, AppBaseException) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await _follow_auto_sync(result.name)
    return {
        "installed": True,
        "name": result.name,
        "enabled": False,
        "source_url": result.source_url,
        "installed_from": result.installed_from,
    }


@router.post("/pool/upload")
async def upload_workspace_skill_to_pool(
    body: UploadToPoolRequest,
) -> dict[str, Any]:
    workspace_dir = _workspace_dir_for_agent(body.workspace_id)
    try:
        result = SkillPoolService().upload_from_workspace(
            workspace_dir=workspace_dir,
            skill_name=body.skill_name,
            overwrite=body.overwrite,
            preview_only=body.preview_only,
        )
    except SkillScanError as exc:
        return _scan_error_response(exc)
    except (ValueError, AppBaseException) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not result.get("success"):
        status = 404 if result.get("reason") == "not_found" else 409
        raise HTTPException(status_code=status, detail=result)
    if not body.preview_only:
        await _follow_auto_sync(result.get("name"))
    return result


def _preflight_download_conflicts(
    hub_service: SkillPoolService,
    targets: list[PoolDownloadTarget],
    skill_name: str,
    overwrite: bool,
) -> list[dict[str, Any]]:
    """Check all targets for conflicts before downloading."""
    conflicts: list[dict[str, Any]] = []
    for target in targets:
        workspace_dir = _workspace_dir_for_agent(target.workspace_id)
        result = hub_service.preflight_download_to_workspace(
            skill_name=skill_name,
            workspace_dir=workspace_dir,
            overwrite=overwrite,
        )
        if not result.get("success"):
            if result.get("reason") == "not_found":
                raise HTTPException(status_code=404, detail=result)
            conflicts.append(result)
    return conflicts


def _resolve_and_preflight(
    body: DownloadFromPoolRequest,
) -> tuple[list[PoolDownloadTarget], SkillPoolService]:
    """Resolve targets and reject if any conflicts exist."""
    targets = list(body.targets)
    if body.all_workspaces:
        targets = [
            PoolDownloadTarget(workspace_id=workspace["agent_id"])
            for workspace in list_workspaces()
        ]
    if not targets:
        raise HTTPException(
            status_code=400,
            detail="No workspace targets provided",
        )
    hub_service = SkillPoolService()
    try:
        conflicts = _preflight_download_conflicts(
            hub_service,
            targets,
            body.skill_name,
            body.overwrite,
        )
    except (ValueError, AppBaseException) as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc
    if conflicts:
        raise HTTPException(
            status_code=409,
            detail={
                "downloaded": [],
                "conflicts": conflicts,
            },
        )
    return targets, hub_service


def _build_download_plan(
    targets: list[PoolDownloadTarget],
    skill_name: str,
) -> list[dict[str, Any]]:
    """Build execution plan with rollback snapshots."""
    plan: list[dict[str, Any]] = []
    for target in targets:
        workspace_dir = _workspace_dir_for_agent(target.workspace_id)
        snapshot = _snapshot_workspace_skill(
            workspace_dir,
            str(skill_name),
        )
        plan.append(
            {
                "workspace_id": target.workspace_id,
                "workspace_dir": workspace_dir,
                "snapshot": snapshot,
            },
        )
    return plan


def _download_one_or_raise(
    hub_service: SkillPoolService,
    plan: dict[str, Any],
    execution_plan: list[dict[str, Any]],
    *,
    skill_name: str,
    overwrite: bool,
) -> dict[str, str]:
    """Download into one workspace; on failure roll back all and raise.

    A missing pool skill is a target-independent 404; any other failure is
    a per-target 409 conflict.
    """
    result = hub_service.download_to_workspace(
        skill_name=skill_name,
        workspace_dir=plan["workspace_dir"],
        overwrite=overwrite,
    )
    if not result.get("success"):
        for rollback in reversed(execution_plan):
            _restore_workspace_skill(rollback["snapshot"])
        if result.get("reason") == "not_found":
            raise HTTPException(status_code=404, detail=result)
        raise HTTPException(
            status_code=409,
            detail={"downloaded": [], "conflicts": [result]},
        )
    return {
        "workspace_id": str(plan["workspace_id"]),
        "workspace_name": str(result.get("workspace_name", "") or ""),
        "name": str(result.get("name", "")),
    }


@router.post("/pool/download")
async def download_pool_skill_to_workspaces(
    body: DownloadFromPoolRequest,
) -> dict[str, Any]:
    """Download one pool skill into one or more workspaces.

    All-or-nothing: if any target conflicts, reject everything.
    """
    targets, hub_service = _resolve_and_preflight(body)
    if body.preview_only:
        return {"downloaded": []}

    execution_plan = _build_download_plan(targets, body.skill_name)

    downloaded: list[dict[str, str]] = []
    try:
        for plan in execution_plan:
            downloaded.append(
                _download_one_or_raise(
                    hub_service,
                    plan,
                    execution_plan,
                    skill_name=body.skill_name,
                    overwrite=body.overwrite,
                ),
            )
    except HTTPException:
        raise
    except SkillScanError as exc:
        for rollback in reversed(execution_plan):
            _restore_workspace_skill(rollback["snapshot"])
        return _scan_error_response(exc)
    except Exception:
        for rollback in reversed(execution_plan):
            _restore_workspace_skill(rollback["snapshot"])
        raise
    finally:
        for plan in execution_plan:
            backup_dir = plan["snapshot"].get("backup_dir")
            if backup_dir is not None:
                shutil.rmtree(Path(backup_dir).parent, ignore_errors=True)

    return {"downloaded": downloaded}


@router.post("/pool/import-builtin")
async def import_pool_builtins(
    body: ImportBuiltinRequest,
) -> dict[str, Any]:
    imports: list[dict[str, Any]] = (
        [item.model_dump() for item in body.imports]
        if body.imports
        else [{"skill_name": skill_name} for skill_name in body.skill_names]
    )
    try:
        result = await asyncio.to_thread(
            import_builtin_skills,
            imports,
            overwrite_conflicts=body.overwrite_conflicts,
        )
    except (ValueError, AppBaseException) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if result.get("conflicts") and not body.overwrite_conflicts:
        raise HTTPException(status_code=409, detail=result)
    await _follow_auto_sync()
    return result


@router.post("/pool/{skill_name}/update-builtin")
async def update_pool_builtin(
    skill_name: str,
    body: UpdateBuiltinRequest | None = Body(default=None),
) -> dict[str, Any]:
    language = body.language if body is not None else ""
    if language and language not in BUILTIN_SKILL_LANGUAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid language '{language}', "
            f"must be one of {BUILTIN_SKILL_LANGUAGES}",
        )
    try:
        result = await asyncio.to_thread(
            update_single_builtin,
            skill_name,
            language=language or None,
        )
    except (ValueError, AppBaseException) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await _follow_auto_sync()
    return result


@router.get("/pool/{skill_name}")
async def get_pool_skill(skill_name: str) -> PoolSkillDetail:
    detail = _build_pool_skill_detail(skill_name)
    if detail is None:
        raise HTTPException(status_code=404, detail="Pool skill not found")
    return detail


@router.delete("/pool/{skill_name}")
async def delete_pool_skill(skill_name: str) -> dict[str, Any]:
    deleted = SkillPoolService().delete_skill(skill_name)
    if not deleted:
        raise HTTPException(
            status_code=409,
            detail="Skill pool entry cannot be deleted",
        )
    return {"deleted": True}


@router.get("/pool/{skill_name}/config")
async def get_pool_skill_config(skill_name: str) -> dict[str, Any]:
    manifest = read_skill_pool_manifest()
    entry = manifest.get("skills", {}).get(skill_name)
    if entry is None:
        raise HTTPException(status_code=404, detail="Pool skill not found")
    return {"config": entry.get("config", {})}


@router.put("/pool/{skill_name}/config")
async def update_pool_skill_config(
    skill_name: str,
    body: SkillConfigRequest,
) -> dict[str, Any]:
    def _update(payload: dict[str, Any]) -> bool:
        entry = payload.get("skills", {}).get(skill_name)
        if entry is None:
            return False
        entry["config"] = dict(body.config)
        return True

    updated = mutate_pool_manifest(_update)
    if not updated:
        raise HTTPException(status_code=404, detail="Pool skill not found")
    return {"updated": True}


@router.delete("/pool/{skill_name}/config")
async def delete_pool_skill_config(skill_name: str) -> dict[str, Any]:
    def _update(payload: dict[str, Any]) -> bool:
        entry = payload.get("skills", {}).get(skill_name)
        if entry is None:
            return False
        entry.pop("config", None)
        return True

    updated = mutate_pool_manifest(_update)
    if not updated:
        raise HTTPException(status_code=404, detail="Pool skill not found")
    return {"cleared": True}


def _validate_tags(tags: list[str]) -> list[str]:
    if len(tags) > MAX_TAGS:
        raise HTTPException(
            status_code=422,
            detail=f"At most {MAX_TAGS} tags allowed",
        )
    cleaned: list[str] = []
    for t in tags:
        t = str(t).strip()[:MAX_TAG_LENGTH]
        if t:
            cleaned.append(t)
    return cleaned


@router.put("/pool/{skill_name}/tags")
async def update_pool_skill_tags(
    skill_name: str,
    tags: list[str],
) -> dict[str, Any]:
    tags = _validate_tags(tags)
    updated = SkillPoolService().set_pool_skill_tags(skill_name, tags)
    if not updated:
        raise HTTPException(
            status_code=404,
            detail="Pool skill not found",
        )
    return {"updated": True, "tags": tags}


@router.put("/pool/{skill_name}/auto-update", deprecated=True)
@router.put("/pool/{skill_name}/auto-sync")
async def update_pool_skill_auto_sync(
    skill_name: str,
    body: AutoSyncRequest,
) -> dict[str, Any]:
    """Toggle Auto Sync and persist its target agents.

    The deprecated auto-update path retains its historical Auto Sync meaning.
    """
    result = await asyncio.to_thread(
        SkillPoolService().set_skill_auto_sync,
        skill_name,
        enabled=body.enabled,
        targets=body.targets,
    )
    if result is None:
        raise HTTPException(
            status_code=404,
            detail="Pool skill not found",
        )
    await post_auto_sync_inbox(result)
    return {
        "updated": True,
        "enabled": body.enabled,
        "targets": body.targets,
    }


@router.put("/pool/{skill_name}/automation")
async def update_pool_skill_automation(
    skill_name: str,
    body: SkillAutomationRequest,
) -> dict[str, Any]:
    """Atomically configure builtin Auto Update and workspace Auto Sync."""
    builtin_field_set = "auto_update" in body.model_fields_set
    if builtin_field_set and body.auto_update is None:
        raise HTTPException(
            status_code=422,
            detail="auto_update must be true or false",
        )
    if not builtin_field_set and body.auto_sync is None:
        raise HTTPException(
            status_code=422,
            detail="At least one automation setting is required",
        )

    auto_sync_targets_provided = bool(
        body.auto_sync is not None
        and "targets" in body.auto_sync.model_fields_set,
    )
    service = SkillPoolService()
    result = await asyncio.to_thread(
        service.set_skill_automation,
        skill_name,
        auto_update=(body.auto_update if builtin_field_set else None),
        auto_sync_enabled=(
            body.auto_sync.enabled if body.auto_sync is not None else None
        ),
        **(
            {"auto_sync_targets": body.auto_sync.targets}
            if auto_sync_targets_provided and body.auto_sync is not None
            else {}
        ),
    )
    if not result.get("success"):
        reason = result.get("reason")
        if reason == "not_found":
            raise HTTPException(
                status_code=404,
                detail="Pool skill not found",
            )
        if reason == "not_builtin":
            raise HTTPException(
                status_code=400,
                detail="Auto Update is only supported for builtin skills",
            )
        raise HTTPException(status_code=400, detail="Invalid automation")

    await post_pool_automation_inbox(result.get("automation"))
    return {
        "updated": True,
        "auto_update": bool(result.get("auto_update")),
        "auto_sync": result.get("auto_sync") or {},
        "automation": result.get("automation") or {},
    }


@router.post("/batch-delete")
async def batch_delete_skills(
    request: Request,
    skills: list[str],
) -> dict[str, Any]:
    """Auto-disable then delete each skill. Per-skill results."""
    workspace_dir = await _request_workspace_dir(request)
    service = SkillService(workspace_dir)
    results: dict[str, Any] = {}
    for skill_name in skills:
        try:
            service.disable_skill(skill_name)
            deleted = service.delete_skill(skill_name)
            results[skill_name] = {
                "success": deleted,
                "reason": None if deleted else "delete_failed",
            }
        except Exception as exc:
            results[skill_name] = {
                "success": False,
                "reason": str(exc),
            }
    return {"results": results}


@router.post("/pool/batch-delete")
async def batch_delete_pool_skills(
    skills: list[str],
) -> dict[str, Any]:
    """Delete multiple pool skills. Per-skill results."""
    service = SkillPoolService()
    results: dict[str, Any] = {}
    for skill_name in skills:
        try:
            deleted = service.delete_skill(skill_name)
            results[skill_name] = {
                "success": deleted,
                "reason": None if deleted else "delete_failed",
            }
        except Exception as exc:
            results[skill_name] = {
                "success": False,
                "reason": str(exc),
            }
    return {"results": results}


@router.post("/batch-disable")
async def batch_disable_skills(
    request: Request,
    skills: list[str],
) -> dict[str, Any]:
    from ..agent_context import get_agent_for_request

    workspace = await get_agent_for_request(request)
    workspace_dir = Path(workspace.workspace_dir)
    service = SkillService(workspace_dir)
    results = {skill: service.disable_skill(skill) for skill in skills}
    if any(result.get("success") for result in results.values()):
        schedule_agent_reload(request, workspace.agent_id)
    return {"results": results}


@router.post("/batch-enable")
async def batch_enable_skills(
    request: Request,
    skills: list[str],
) -> dict[str, Any]:
    """Enable each requested skill independently and collect per-skill results.

    Example:
        enabling ``["ok_skill", "blocked_skill"]`` returns success for the
        first item and ``reason="security_scan_failed"`` for the second,
        rather than aborting the entire batch.
    """
    from ..agent_context import get_agent_for_request

    workspace = await get_agent_for_request(request)
    workspace_dir = Path(workspace.workspace_dir)
    service = SkillService(workspace_dir)
    results: dict[str, Any] = {}
    for skill in skills:
        try:
            results[skill] = service.enable_skill(skill)
        except SkillScanError as exc:
            results[skill] = {
                "success": False,
                "reason": "security_scan_failed",
                "detail": _scan_error_payload(exc),
            }
    if any(
        isinstance(result, dict) and result.get("success")
        for result in results.values()
    ):
        schedule_agent_reload(request, workspace.agent_id)
    return {"results": results}


@router.post("/{skill_name}/disable")
async def disable_skill(
    request: Request,
    skill_name: str,
) -> dict[str, Any]:
    from ..agent_context import get_agent_for_request

    workspace = await get_agent_for_request(request)
    workspace_dir = Path(workspace.workspace_dir)
    result = SkillService(workspace_dir).disable_skill(skill_name)
    if not result.get("success"):
        raise HTTPException(status_code=404, detail="Skill not found")
    schedule_agent_reload(request, workspace.agent_id)
    return {"disabled": True, **result}


@router.post("/{skill_name}/enable")
async def enable_skill(
    request: Request,
    skill_name: str,
) -> dict[str, Any]:
    """Enable one workspace skill after a fresh scan."""
    from ..agent_context import get_agent_for_request

    workspace = await get_agent_for_request(request)
    workspace_dir = Path(workspace.workspace_dir)
    try:
        result = SkillService(workspace_dir).enable_skill(skill_name)
    except SkillScanError as exc:
        return _scan_error_response(exc)
    if not result.get("success"):
        raise HTTPException(
            status_code=404,
            detail=result.get("reason", "Skill not found"),
        )
    schedule_agent_reload(request, workspace.agent_id)
    return {"enabled": True, **result}


@router.get("/{skill_name}")
async def get_skill(request: Request, skill_name: str) -> SkillDetail:
    workspace_dir = await _request_workspace_dir(request)
    detail = _build_workspace_skill_detail(workspace_dir, skill_name)
    if detail is None:
        raise HTTPException(status_code=404, detail="Skill not found")
    return detail


@router.delete("/{skill_name}")
async def delete_skill(
    request: Request,
    skill_name: str,
) -> dict[str, Any]:
    workspace_dir = await _request_workspace_dir(request)
    service = SkillService(workspace_dir)
    service.disable_skill(skill_name)
    deleted = service.delete_skill(skill_name)
    if not deleted:
        raise HTTPException(
            status_code=409,
            detail="Only disabled workspace skills can be deleted",
        )
    return {"deleted": True}


@router.get("/{skill_name}/files/{file_path:path}")
async def load_skill_file(
    request: Request,
    skill_name: str,
    file_path: str,
) -> dict[str, Any]:
    workspace_dir = await _request_workspace_dir(request)
    content = SkillService(workspace_dir).load_skill_file(
        skill_name=skill_name,
        file_path=file_path,
    )
    if content is None:
        raise HTTPException(status_code=404, detail="File not found")
    return {"content": content}


@router.put("/save")
async def save_workspace_skill(
    request: Request,
    body: SaveSkillRequest,
) -> dict[str, Any]:
    from ..agent_context import get_agent_for_request

    workspace = await get_agent_for_request(request)
    workspace_dir = Path(workspace.workspace_dir)
    try:
        result = SkillService(workspace_dir).save_skill(
            skill_name=body.source_name or body.name,
            content=body.content,
            target_name=body.name if body.source_name else None,
            config=body.config,
            overwrite=body.overwrite,
        )
    except SkillScanError as exc:
        return _scan_error_response(exc)
    except (ValueError, AppBaseException) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not result.get("success"):
        if result.get("reason") == "conflict":
            raise HTTPException(status_code=409, detail=result)
        raise HTTPException(status_code=404, detail="Skill not found")
    if result.get("mode") != "noop":
        schedule_agent_reload(request, workspace.agent_id)
    return result


@router.put("/{skill_name}/channels")
async def update_skill_channels_endpoint(
    request: Request,
    skill_name: str,
    channels: list[str],
) -> dict[str, Any]:
    from ..agent_context import get_agent_for_request

    workspace = await get_agent_for_request(request)
    workspace_dir = Path(workspace.workspace_dir)
    updated = SkillService(workspace_dir).set_skill_channels(
        skill_name,
        channels,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Skill not found")
    schedule_agent_reload(request, workspace.agent_id)
    return {"updated": True, "channels": channels}


@router.put("/{skill_name}/preload")
async def update_skill_preload_endpoint(
    request: Request,
    skill_name: str,
    preload: bool = Body(..., embed=True),
) -> dict[str, Any]:
    from ..agent_context import get_agent_for_request

    workspace = await get_agent_for_request(request)
    workspace_dir = Path(workspace.workspace_dir)
    updated = SkillService(workspace_dir).set_skill_preload(
        skill_name,
        preload,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Skill not found")
    schedule_agent_reload(request, workspace.agent_id)
    return {"updated": True, "preload": preload}


@router.put("/{skill_name}/tags")
async def update_skill_tags(
    request: Request,
    skill_name: str,
    tags: list[str],
) -> dict[str, Any]:
    from ..agent_context import get_agent_for_request

    tags = _validate_tags(tags)
    workspace = await get_agent_for_request(request)
    workspace_dir = Path(workspace.workspace_dir)
    updated = SkillService(workspace_dir).set_skill_tags(
        skill_name,
        tags,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Skill not found")
    return {"updated": True, "tags": tags}


@router.get("/{skill_name}/config")
async def get_skill_config_endpoint(
    request: Request,
    skill_name: str,
) -> dict[str, Any]:
    workspace_dir = await _request_workspace_dir(request)
    manifest = read_skill_manifest(workspace_dir)
    entry = manifest.get("skills", {}).get(skill_name)
    if entry is None:
        raise HTTPException(status_code=404, detail="Skill not found")
    return {"config": entry.get("config", {})}


@router.put("/{skill_name}/config")
async def update_skill_config_endpoint(
    request: Request,
    skill_name: str,
    body: SkillConfigRequest,
) -> dict[str, Any]:
    workspace_dir = await _request_workspace_dir(request)
    manifest_path = get_workspace_skill_manifest_path(workspace_dir)

    def _update(payload: dict[str, Any]) -> bool:
        entry = payload.get("skills", {}).get(skill_name)
        if entry is None:
            return False
        entry["config"] = dict(body.config)
        return True

    updated = mutate_json(
        manifest_path,
        default_workspace_manifest(),
        _update,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Skill not found")
    return {"updated": True}


@router.delete("/{skill_name}/config")
async def delete_skill_config_endpoint(
    request: Request,
    skill_name: str,
) -> dict[str, Any]:
    workspace_dir = await _request_workspace_dir(request)
    manifest_path = get_workspace_skill_manifest_path(workspace_dir)

    def _update(payload: dict[str, Any]) -> bool:
        entry = payload.get("skills", {}).get(skill_name)
        if entry is None:
            return False
        entry.pop("config", None)
        return True

    updated = mutate_json(
        manifest_path,
        default_workspace_manifest(),
        _update,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Skill not found")
    return {"cleared": True}
