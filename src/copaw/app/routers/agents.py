# -*- coding: utf-8 -*-
"""Multi-agent management API.

Provides RESTful API for managing multiple agent instances.
"""
import asyncio
import copy
import importlib.resources
import json
import logging
import re
import shutil
import tempfile
import subprocess
import threading
import time
import unicodedata
from pathlib import Path
from datetime import datetime
from typing import Any, cast
from urllib.parse import unquote, urlparse
from fastapi import (
    APIRouter,
    Body,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi import Path as PathParam
from pydantic import BaseModel, Field, field_validator

from ...agents.utils.file_handling import read_text_file_with_encoding_fallback
from ...agents.skills_hub import install_skill_from_hub
from ...agents.skills_manager import SkillConflictError
from ..utils import schedule_agent_reload
from ...config.config import (
    AgentProfileConfig,
    AgentProfileRef,
    AgentsSquareSourceSpec,
    AgentsSquareConfig,
    AgentsSquareCacheConfig,
    AgentsSquareInstallConfig,
    load_agent_config,
    save_agent_config,
    generate_short_agent_id,
)
from ...config.utils import load_config, save_config
from ...agents.memory.agent_md_manager import AgentMdManager
from ...agents.utils import copy_builtin_qa_md_files
from ...agents.skills_manager import SkillPoolService, get_workspace_skills_dir
from ..multi_agent_manager import MultiAgentManager
from ...constant import WORKING_DIR

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["agents"])

_PROJECT_TEMPLATES_DIR = (
    Path(__file__).resolve().parents[1] / "project_templates"
)

_DEFAULT_PROJECT_TEMPLATES = {
    "projects/README.md": "# Projects\n\n"
    "Store one project per subdirectory, for example:\n\n"
    "- project-abcde123/\n"
    "  - PROJECT.md\n"
    "  - data/\n\n"
    "The project metadata should be declared in PROJECT.md frontmatter:\n\n"
    "---\n"
    "id: project-abcde123\n"
    "name: Example project\n"
    "description: Short summary\n"
    "status: active\n"
    "data_dir: data\n"
    "tags: [demo, draft]\n"
    "artifact_profile:\n"
    "    skills: []\n"
    "    scripts: []\n"
    "    flows: []\n"
    "    cases: []\n"
    "---\n\n"
    "Project details go below.\n",
    "project/AGENTS.md": "# Project Collaboration Rules\n\n"
    "Use this file only for the highest-signal project rules.\n\n"
    "- Workspace root is this project directory.\n"
    "- Resolve files by relative path from project root.\n"
    "- If a requested path starts with original/, retry {{DATA_DIR}}/ once.\n"
    "- Prefer exact file reads over broad scans.\n"
    "- Artifact mapping: scripts/*.py => script, pipelines/templates/*.json => flow, {{DATA_DIR}}/* and pipelines/runs/* => case.\n"
    "- Put detailed behavior and distillation rules in skills/project-artifact-governor/SKILL.md.\n",
    "project/data/README.md": "# {{DATA_DIR}} directory\n\n"
    "Purpose: case artifacts and evidence outputs.\n\n"
    "## Mapping to artifact kind\n"
    "- Most files here are case artifacts.\n\n"
    "## Notes\n"
    "- Historical user references may use original/.\n"
    "- In this project, use {{DATA_DIR}}/ as canonical location.\n",
    "project/scripts/README.md": "# scripts directory\n\n"
    "Purpose: executable scripts for project workflows.\n\n"
    "## Mapping to artifact kind\n"
    "- scripts/*.py are script artifacts.\n",
    "project/pipelines/templates/README.md": "# pipelines/templates directory\n\n"
    "Purpose: reusable flow templates.\n\n"
    "## Mapping to artifact kind\n"
    "- pipelines/templates/*.json are flow artifacts.\n",
    "project/pipelines/runs/README.md": "# pipelines/runs directory\n\n"
    "Purpose: run instances, manifests, and evidence.\n\n"
    "## Mapping to artifact kind\n"
    "- Run outputs are primarily case evidence.\n",
    "project/skills/project-artifact-governor/SKILL.md": "---\n"
    "name: project-artifact-governor\n"
    "description: Enforce project path resolution and four-artifact governance for this project workspace.\n"
    "---\n\n"
    "# project-artifact-governor\n\n"
    "## Procedure\n"
    "1. Confirm workspace root.\n"
    "2. Resolve each file via absolute path first.\n"
    "3. If path uses original/, remap to {{DATA_DIR}}/ and retry once.\n"
    "4. Classify outputs by directory + intent.\n"
    "5. Generate concise structured result.\n\n"
    "## Classification Rules\n"
    "- scripts/*.py => script\n"
    "- pipelines/templates/*.json => flow\n"
    "- {{DATA_DIR}}/* or pipelines/runs/* outputs => case\n"
    "- reusable method/checklist distilled from repeated evidence => skill\n",
}


class AgentSummary(BaseModel):
    """Agent summary information."""

    id: str
    name: str
    description: str
    workspace_dir: str
    enabled: bool = True
    project_count: int = 0
    projects: list["ProjectSummary"] = Field(default_factory=list)


class ProjectSummary(BaseModel):
    """Project summary information under an agent workspace."""

    id: str
    name: str
    description: str = ""
    status: str = "active"
    workspace_dir: str
    data_dir: str
    metadata_file: str
    tags: list[str] = Field(default_factory=list)
    artifact_distill_mode: str = "file_scan"
    artifact_profile: "ProjectArtifactProfile" = Field(
        default_factory=lambda: ProjectArtifactProfile(),
    )
    preferred_workspace_chat_id: str = ""
    updated_time: str


class ProjectArtifactItem(BaseModel):
    """Single project artifact item in the unified product model."""

    id: str
    name: str
    kind: str
    origin: str = "project-distilled"
    status: str = "draft"
    version: str = ""
    artifact_file_path: str = ""
    version_history: list[dict[str, str]] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    derived_from_ids: list[str] = Field(default_factory=list)
    distillation_note: str = ""
    market_source_id: str | None = None
    market_item_id: str | None = None


class ProjectArtifactProfile(BaseModel):
    """Unified artifact profile for standard and scenario artifacts."""

    skills: list[ProjectArtifactItem] = Field(default_factory=list)
    scripts: list[ProjectArtifactItem] = Field(default_factory=list)
    flows: list[ProjectArtifactItem] = Field(default_factory=list)
    cases: list[ProjectArtifactItem] = Field(default_factory=list)


class AgentListResponse(BaseModel):
    """Response for listing agents."""

    agents: list[AgentSummary]


class ReorderAgentsRequest(BaseModel):
    """Request model for persisting agent order."""

    agent_ids: list[str]


class CreateAgentRequest(BaseModel):
    """Request model for creating a new agent (id is auto-generated)."""

    name: str
    description: str = ""
    workspace_dir: str | None = None
    language: str = "en"
    skill_names: list[str] | None = None

    @field_validator("workspace_dir", mode="before")
    @classmethod
    def strip_workspace_dir(cls, value: str | None) -> str | None:
        """Strip accidental whitespace"""
        if value is None:
            return None
        if isinstance(value, str):
            stripped = value.strip()
            return stripped if stripped else None
        return value


class MdFileInfo(BaseModel):
    """Markdown file metadata."""

    filename: str
    path: str
    size: int
    created_time: str
    modified_time: str


class MdFileContent(BaseModel):
    """Markdown file content."""

    content: str


class ProjectFileInfo(BaseModel):
    """Project file metadata."""

    filename: str
    path: str
    size: int
    modified_time: str


class ProjectFileContent(BaseModel):
    """Project file content."""

    content: str


class CloneProjectRequest(BaseModel):
    """Request body for cloning a project."""

    target_id: str | None = None
    target_name: str | None = None
    include_pipeline_runs: bool = True


class CreateProjectRequest(BaseModel):
    """Request body for creating a project."""

    id: str | None = None
    name: str
    description: str = ""
    status: str = "active"
    data_dir: str = "data"
    tags: list[str] = Field(default_factory=list)
    artifact_distill_mode: str = "file_scan"
    artifact_profile: ProjectArtifactProfile = Field(
        default_factory=lambda: ProjectArtifactProfile(),
    )


class UpdateProjectArtifactDistillModeRequest(BaseModel):
    """Request body for updating project artifact distill mode."""

    artifact_distill_mode: str = "file_scan"


class UpdateProjectWorkspaceChatBindingRequest(BaseModel):
    """Request body for updating preferred project workspace chat binding."""

    preferred_workspace_chat_id: str = ""


class DeleteProjectResponse(BaseModel):
    """Response body for deleting a project."""

    success: bool
    project_id: str


class PromoteProjectArtifactRequest(BaseModel):
    """Request body for promoting a project artifact to agent scope."""

    target_name: str | None = None
    overwrite: bool = False
    enable: bool = True


class PromoteProjectArtifactResponse(BaseModel):
    """Response body for promote artifact API."""

    promoted: bool
    artifact_kind: str
    artifact_id: str
    target_name: str
    target_path: str
    project: ProjectSummary


class DistillProjectSkillsDraftResponse(BaseModel):
    """Response body for auto-distilling project skills into drafts."""

    drafted_count: int
    skipped_count: int
    drafted_ids: list[str] = Field(default_factory=list)
    artifact_distill_mode: str = "file_scan"
    project: ProjectSummary


class DistillProjectSkillsDraftRequest(BaseModel):
    """Request body for auto-distilling project skills into drafts."""

    run_id: str | None = None


class ConfirmProjectSkillStableResponse(BaseModel):
    """Response body for confirming one project skill artifact as stable."""

    confirmed: bool
    artifact_id: str
    status: str
    project: ProjectSummary


class AgentsSquareSourcesPayload(BaseModel):
    """Payload for Agents Square source management."""

    version: int = 1
    cache: dict[str, int] = Field(default_factory=lambda: {"ttl_sec": 600})
    install: dict[str, bool] = Field(
        default_factory=lambda: {
            "overwrite_default": False,
            "preserve_workspace_files": True,
        },
    )
    sources: list[AgentsSquareSourceSpec] = Field(default_factory=list)


class ValidateSquareSourceRequest(AgentsSquareSourceSpec):
    """Request body for validating a single Agents Square source."""


class SourceError(BaseModel):
    """Source-level marketplace errors."""

    source_id: str
    code: str
    message: str
    retryable: bool = False


class AgentSquareItem(BaseModel):
    """Single Agent Square item."""

    source_id: str
    agent_id: str
    name: str
    description: str = ""
    version: str = ""
    license: str = ""
    source_url: str
    install_url: str
    tags: list[str] = Field(default_factory=list)
    extra: dict[str, str] = Field(default_factory=dict)


class ImportAgentRequest(BaseModel):
    """Import request for a source agent into local agents."""

    source_id: str
    agent_id: str
    overwrite: bool = False
    enable: bool = True
    preferred_name: str | None = None


class ImportAgentResponse(BaseModel):
    """Import response for Agents Square import API."""

    imported: bool
    id: str
    name: str
    workspace_dir: str
    source: dict[str, str]


_OWNER_REPO_PATTERN = re.compile(r"^[\w.-]+/[\w.-]+$")
_AGENT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{1,127}$")
_SQUARE_CACHE_LOCK = threading.Lock()
_SQUARE_CACHE: dict[str, Any] = {
    "expires_at": 0.0,
    "items": [],
    "errors": [],
    "meta": {},
    "import_index": {},
}
_SQUARE_SKIP_DIRS = {
    ".git",
    ".github",
    "integrations",
    "scripts",
    "examples",
    "docs",
    "assets",
}
_SQUARE_SKIP_FILES = {
    "README.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "CHANGELOG.md",
}
_AGENTS_SQUARE_DEFAULT_DIR = (
    Path(__file__).resolve().parents[2] / "agents_square"
)
_AGENTS_SQUARE_CONFIG_PATH = WORKING_DIR / "agents_square" / "config.json"
_AGENTS_SQUARE_DEFAULT_PATH = _AGENTS_SQUARE_DEFAULT_DIR / "default.json"
_PROJECTS_DIRNAME = "projects"
_PROJECT_METADATA_FILENAMES = ("PROJECT.md", "project.md")
_PROJECT_ARTIFACT_DIR_BY_KIND = {
    "skill": "skills",
    "script": "scripts",
    "flow": "flows",
    "case": "cases",
}
_PROJECT_ARTIFACT_DISTILL_MODES = {
    "file_scan",
    "conversation_evidence",
}


def _normalize_project_artifact_distill_mode(raw_value: Any) -> str:
    mode = str(raw_value or "").strip().lower()
    if mode in _PROJECT_ARTIFACT_DISTILL_MODES:
        return mode
    return "file_scan"


def _ensure_square_config_initialized() -> None:
    """Ensure agents_square/config.json exists, bootstrap from default.json."""
    if _AGENTS_SQUARE_CONFIG_PATH.exists():
        return

    _AGENTS_SQUARE_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

    if _AGENTS_SQUARE_DEFAULT_PATH.exists():
        shutil.copyfile(
            _AGENTS_SQUARE_DEFAULT_PATH, _AGENTS_SQUARE_CONFIG_PATH
        )
        return

    # Last resort fallback when default.json is missing.
    fallback_payload = {
        "version": 1,
        "sources": [],
        "cache": {"ttl_sec": 600},
        "install": {
            "overwrite_default": False,
            "preserve_workspace_files": True,
        },
    }
    _AGENTS_SQUARE_CONFIG_PATH.write_text(
        json.dumps(fallback_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _load_square_payload_from_file(path: Path) -> AgentsSquareSourcesPayload:
    """Load Agents Square payload from file."""
    try:
        raw_text = path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"SQUARE_CONFIG_READ_FAILED: {path.name}: {exc}",
        ) from exc

    if not raw_text:
        raise HTTPException(
            status_code=500,
            detail=f"SQUARE_CONFIG_INVALID: {path.name} is empty",
        )

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"SQUARE_CONFIG_INVALID_JSON: {path.name}: {exc}",
        ) from exc

    return AgentsSquareSourcesPayload.model_validate(parsed)


def _load_current_square_config() -> AgentsSquareConfig:
    """Load current square config from agents_square/config.json."""
    _ensure_square_config_initialized()
    payload = _load_square_payload_from_file(_AGENTS_SQUARE_CONFIG_PATH)
    return _payload_to_square_config(payload)


def _load_default_square_config() -> AgentsSquareConfig:
    """Load bundled square defaults from agents_square/default.json."""
    if not _AGENTS_SQUARE_DEFAULT_PATH.exists():
        _ensure_square_config_initialized()
        return _load_current_square_config()

    payload = _load_square_payload_from_file(_AGENTS_SQUARE_DEFAULT_PATH)
    return _payload_to_square_config(payload)


def _save_current_square_config(cfg: AgentsSquareConfig) -> None:
    """Persist current square config to agents_square/config.json."""
    _AGENTS_SQUARE_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = _square_config_to_payload(cfg).model_dump(mode="json")
    _AGENTS_SQUARE_CONFIG_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def _reset_current_square_config_to_default() -> AgentsSquareConfig:
    """Reset current square config by copying default.json to config.json."""
    _AGENTS_SQUARE_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)

    if _AGENTS_SQUARE_DEFAULT_PATH.exists():
        shutil.copyfile(
            _AGENTS_SQUARE_DEFAULT_PATH, _AGENTS_SQUARE_CONFIG_PATH
        )
        return _load_current_square_config()

    # Fallback when default.json is missing.
    fallback_cfg = _load_default_square_config()
    _save_current_square_config(fallback_cfg)
    return fallback_cfg


def _slugify(value: str) -> str:
    text = unicodedata.normalize("NFKD", (value or "").strip().lower())
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-z0-9_-]+", "-", text)
    text = text.strip("-")
    return text or "agent"


def _github_owner_repo_from_url(url: str) -> tuple[str, str] | None:
    parsed = urlparse((url or "").strip())
    host = (parsed.netloc or "").lower()
    if host not in {"github.com", "www.github.com"}:
        return None
    parts = [p for p in parsed.path.split("/") if p]
    if len(parts) < 2:
        return None
    owner = parts[0]
    repo = parts[1]
    if repo.endswith(".git"):
        repo = repo[: -len(".git")]
    return owner, repo


def _build_github_blob_url(
    source: AgentsSquareSourceSpec,
    rel_path: str,
) -> str:
    owner_repo = _github_owner_repo_from_url(source.url)
    if owner_repo is None:
        return source.url
    owner, repo = owner_repo
    branch = source.branch or "main"
    rel = rel_path.strip("/")
    return f"https://github.com/{owner}/{repo}/blob/{branch}/{rel}"


def _run_git_command(
    args: list[str],
    *,
    cwd: str | None = None,
    timeout_sec: int = 60,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=timeout_sec,
        check=False,
    )


def _clone_square_source(source: AgentsSquareSourceSpec) -> Path:
    tmp_dir = Path(tempfile.mkdtemp(prefix="copaw-square-"))
    clone_args = ["clone", "--depth", "1"]
    if source.branch:
        clone_args.extend(["--branch", source.branch])
    clone_args.extend([source.url, str(tmp_dir)])
    cp = _run_git_command(clone_args, timeout_sec=120)
    if cp.returncode != 0:
        raise RuntimeError(
            "SOURCE_UNREACHABLE: " + (cp.stderr.strip() or "clone failed"),
        )
    return tmp_dir


def _parse_markdown_frontmatter(path: Path) -> tuple[dict, str] | None:
    raw = path.read_text(encoding="utf-8", errors="ignore")
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

    header = "\n".join(lines[1:end])
    body = "\n".join(lines[end + 1 :]).strip()
    try:
        import yaml

        data = yaml.safe_load(header) or {}
    except Exception:
        return None
    if not isinstance(data, dict):
        return None
    return data, body


def _format_iso_time(ts: float) -> str:
    return datetime.fromtimestamp(ts).isoformat(timespec="seconds")


def _safe_project_data_subdir(raw_value: str) -> str:
    candidate = (raw_value or "").strip() or "original"
    path = Path(candidate)
    if path.is_absolute() or ".." in path.parts:
        return "original"
    normalized = path.as_posix().strip("/")
    return normalized or "original"


def _parse_project_tags(raw_tags: Any) -> list[str]:
    if isinstance(raw_tags, list):
        return [str(item).strip() for item in raw_tags if str(item).strip()]
    if isinstance(raw_tags, str):
        return [item.strip() for item in raw_tags.split(",") if item.strip()]
    return []


def _safe_artifact_slug(raw_value: str, fallback: str) -> str:
    slug = _slugify(raw_value)
    if not slug or slug == "agent":
        return fallback
    return slug


def _build_project_artifact_file_path(
    kind: str,
    artifact_id: str,
    version: str,
) -> str:
    kind_dir = _PROJECT_ARTIFACT_DIR_BY_KIND.get(kind, "artifacts")
    artifact_slug = _safe_artifact_slug(artifact_id, f"{kind}-item")
    version_slug = _safe_artifact_slug(version, "v0-draft")
    return f"{kind_dir}/{artifact_slug}/{version_slug}.md"


def _parse_project_artifact_version_history(
    raw_value: Any,
) -> list[dict[str, str]]:
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


def _normalize_project_artifact_storage(
    item: ProjectArtifactItem,
    kind: str,
) -> ProjectArtifactItem:
    file_path = (
        item.artifact_file_path.strip()
        or _build_project_artifact_file_path(
            kind,
            item.id,
            item.version,
        )
    )
    history = _parse_project_artifact_version_history(item.version_history)

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


def _normalize_project_artifact_profile_storage(
    profile: ProjectArtifactProfile,
) -> ProjectArtifactProfile:
    return ProjectArtifactProfile(
        skills=[
            _normalize_project_artifact_storage(item, "skill")
            for item in profile.skills
        ],
        scripts=[
            _normalize_project_artifact_storage(item, "script")
            for item in profile.scripts
        ],
        flows=[
            _normalize_project_artifact_storage(item, "flow")
            for item in profile.flows
        ],
        cases=[
            _normalize_project_artifact_storage(item, "case")
            for item in profile.cases
        ],
    )


def _ensure_project_artifact_layout(project_dir: Path) -> None:
    for dirname in _PROJECT_ARTIFACT_DIR_BY_KIND.values():
        (project_dir / dirname).mkdir(parents=True, exist_ok=True)


def _normalize_project_artifact_item(
    raw_item: Any,
    kind: str,
) -> ProjectArtifactItem | None:
    if isinstance(raw_item, str):
        normalized = raw_item.strip()
        if not normalized:
            return None
        return ProjectArtifactItem(id=normalized, name=normalized, kind=kind)

    if not isinstance(raw_item, dict):
        return None

    item_id = str(raw_item.get("id") or raw_item.get("name") or "").strip()
    if not item_id:
        return None

    item_name = str(raw_item.get("name") or item_id).strip() or item_id
    origin = (
        str(raw_item.get("origin") or "project-distilled").strip()
        or "project-distilled"
    )
    status = str(raw_item.get("status") or "draft").strip() or "draft"
    version = str(raw_item.get("version") or "").strip()
    artifact_file_path = str(raw_item.get("artifact_file_path") or "").strip()
    version_history = _parse_project_artifact_version_history(
        raw_item.get("version_history"),
    )
    tags = _parse_project_tags(raw_item.get("tags"))
    derived_from_ids = _parse_project_tags(raw_item.get("derived_from_ids"))
    distillation_note = str(raw_item.get("distillation_note") or "").strip()
    market_source_id = (
        str(raw_item.get("market_source_id") or "").strip() or None
    )
    market_item_id = str(raw_item.get("market_item_id") or "").strip() or None

    item = ProjectArtifactItem(
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
    return _normalize_project_artifact_storage(item, kind)


def _parse_project_artifact_list(
    raw_value: Any,
    kind: str,
) -> list[ProjectArtifactItem]:
    if raw_value is None:
        return []

    if isinstance(raw_value, list):
        raw_list = raw_value
    elif isinstance(raw_value, str):
        raw_list = [raw_value]
    else:
        return []

    result: list[ProjectArtifactItem] = []
    seen: set[str] = set()
    for raw_item in raw_list:
        normalized = _normalize_project_artifact_item(raw_item, kind)
        if normalized is None or normalized.id in seen:
            continue
        seen.add(normalized.id)
        result.append(normalized)
    return result


def _parse_project_artifact_profile(
    metadata: dict[str, Any],
) -> ProjectArtifactProfile:
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

    return ProjectArtifactProfile(
        skills=_parse_project_artifact_list(skills_raw, "skill"),
        scripts=_parse_project_artifact_list(scripts_raw, "script"),
        flows=_parse_project_artifact_list(flows_raw, "flow"),
        cases=_parse_project_artifact_list(cases_raw, "case"),
    )


def _first_nonempty_line(text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip().lstrip("#").strip()
        if stripped:
            return stripped
    return ""


def _load_project_summary(project_dir: Path) -> ProjectSummary | None:
    metadata_file = next(
        (
            project_dir / name
            for name in _PROJECT_METADATA_FILENAMES
            if (project_dir / name).is_file()
        ),
        None,
    )
    if metadata_file is None:
        return None

    parsed = _parse_markdown_frontmatter(metadata_file)
    metadata: dict[str, Any] = {}
    body = ""
    if parsed is not None:
        metadata, body = parsed
    else:
        body = metadata_file.read_text(encoding="utf-8", errors="ignore")

    data_subdir = _safe_project_data_subdir(
        str(metadata.get("data_dir") or metadata.get("dataDir") or "data"),
    )
    project_id = (
        str(metadata.get("id") or project_dir.name).strip() or project_dir.name
    )
    project_name = (
        str(metadata.get("name") or project_dir.name).strip()
        or project_dir.name
    )
    description = str(
        metadata.get("description") or _first_nonempty_line(body)
    ).strip()
    status = str(metadata.get("status") or "active").strip() or "active"
    tags = _parse_project_tags(metadata.get("tags"))
    artifact_distill_mode = _normalize_project_artifact_distill_mode(
        metadata.get("artifact_distill_mode") or metadata.get("distill_mode"),
    )
    artifact_profile = _parse_project_artifact_profile(metadata)
    preferred_workspace_chat_id = str(
        metadata.get("preferred_workspace_chat_id")
        or metadata.get("preferred_workspace_chat")
        or "",
    ).strip()
    updated_time = _format_iso_time(metadata_file.stat().st_mtime)

    return ProjectSummary(
        id=project_id,
        name=project_name,
        description=description,
        status=status,
        workspace_dir=str(project_dir),
        data_dir=str(project_dir / data_subdir),
        metadata_file=str(metadata_file),
        tags=tags,
        artifact_distill_mode=artifact_distill_mode,
        artifact_profile=artifact_profile,
        preferred_workspace_chat_id=preferred_workspace_chat_id,
        updated_time=updated_time,
    )


def _list_agent_projects(workspace_dir: Path) -> list[ProjectSummary]:
    projects_dir = workspace_dir / _PROJECTS_DIRNAME
    if not projects_dir.exists() or not projects_dir.is_dir():
        return []

    projects: list[ProjectSummary] = []
    for project_dir in sorted(
        projects_dir.iterdir(), key=lambda item: item.name.lower()
    ):
        if not project_dir.is_dir():
            continue
        summary = _load_project_summary(project_dir)
        if summary is not None:
            projects.append(summary)
    return projects


def _ensure_projects_layout(workspace_dir: Path) -> None:
    projects_dir = workspace_dir / _PROJECTS_DIRNAME
    projects_dir.mkdir(exist_ok=True)
    readme_path = projects_dir / "README.md"
    if readme_path.exists():
        return

    readme_path.write_text(
        _load_project_template_text("projects/README.md"),
        encoding="utf-8",
    )


def _load_project_template_text(
    relative_path: str,
    replacements: dict[str, str] | None = None,
) -> str:
    content: str | None = None

    try:
        template_resource = importlib.resources.files("copaw").joinpath(
            "app", "project_templates", *relative_path.split("/")
        )
        if template_resource.is_file():
            content = template_resource.read_text(encoding="utf-8")
    except Exception:
        content = None

    if content is None:
        template_path = _PROJECT_TEMPLATES_DIR / relative_path
        if template_path.is_file():
            content = template_path.read_text(encoding="utf-8")

    if content is None:
        content = _DEFAULT_PROJECT_TEMPLATES.get(relative_path)
        if content is None:
            raise FileNotFoundError(
                f"Project template not found: {relative_path}"
            )
        logger.warning(
            "Project template missing from package and source tree; using builtin fallback: %s",
            relative_path,
        )

    for key, value in (replacements or {}).items():
        content = content.replace(f"{{{{{key}}}}}", value)
    return content


def _scaffold_project_governance_files(
    project_dir: Path,
    data_subdir: str,
) -> None:
    """Create default governance files for new projects.

    Files are created only when missing, so callers can safely re-run this.
    """

    agents_md = project_dir / "AGENTS.md"
    if not agents_md.exists():
        agents_md.write_text(
            _load_project_template_text(
                "project/AGENTS.md",
                {"DATA_DIR": data_subdir},
            ),
            encoding="utf-8",
        )

    data_readme = project_dir / data_subdir / "README.md"
    if not data_readme.exists():
        data_readme.write_text(
            _load_project_template_text(
                "project/data/README.md",
                {"DATA_DIR": data_subdir},
            ),
            encoding="utf-8",
        )

    scripts_readme = project_dir / "scripts" / "README.md"
    scripts_readme.parent.mkdir(parents=True, exist_ok=True)
    if not scripts_readme.exists():
        scripts_readme.write_text(
            _load_project_template_text("project/scripts/README.md"),
            encoding="utf-8",
        )

    templates_readme = project_dir / "pipelines" / "templates" / "README.md"
    if not templates_readme.exists():
        templates_readme.write_text(
            _load_project_template_text(
                "project/pipelines/templates/README.md",
            ),
            encoding="utf-8",
        )

    runs_readme = project_dir / "pipelines" / "runs" / "README.md"
    runs_readme.parent.mkdir(parents=True, exist_ok=True)
    if not runs_readme.exists():
        runs_readme.write_text(
            _load_project_template_text(
                "project/pipelines/runs/README.md",
            ),
            encoding="utf-8",
        )

    skill_md = (
        project_dir
        / "skills"
        / "project-artifact-governor"
        / "SKILL.md"
    )
    skill_md.parent.mkdir(parents=True, exist_ok=True)
    if not skill_md.exists():
        skill_md.write_text(
            _load_project_template_text(
                "project/skills/project-artifact-governor/SKILL.md",
                {"DATA_DIR": data_subdir},
            ),
            encoding="utf-8",
        )


def _resolve_project_dir(workspace_dir: Path, project_id: str) -> Path:
    projects_dir = workspace_dir / _PROJECTS_DIRNAME
    if not projects_dir.exists() or not projects_dir.is_dir():
        raise HTTPException(
            status_code=404, detail="Projects directory not found"
        )

    for project_dir in sorted(
        projects_dir.iterdir(), key=lambda item: item.name.lower()
    ):
        if not project_dir.is_dir():
            continue
        summary = _load_project_summary(project_dir)
        if summary is None:
            continue
        if summary.id == project_id or project_dir.name == project_id:
            return project_dir

    raise HTTPException(
        status_code=404, detail=f"Project '{project_id}' not found"
    )


def _read_project_frontmatter_with_body(
    metadata_file: Path,
) -> tuple[dict[str, Any], str]:
    parsed = _parse_markdown_frontmatter(metadata_file)
    if parsed is not None:
        metadata, body = parsed
        return metadata, body
    if metadata_file.exists():
        return {}, metadata_file.read_text(encoding="utf-8", errors="ignore")
    return {}, ""


def _get_project_artifact_profile(
    workspace_dir: Path,
    project_id: str,
) -> ProjectArtifactProfile:
    project_dir = _resolve_project_dir(workspace_dir, project_id)
    summary = _load_project_summary(project_dir)
    if summary is None:
        raise HTTPException(
            status_code=404,
            detail=f"Project '{project_id}' metadata not found",
        )
    return summary.artifact_profile


def _update_project_artifact_profile(
    workspace_dir: Path,
    project_id: str,
    profile: ProjectArtifactProfile,
) -> ProjectSummary:
    project_dir = _resolve_project_dir(workspace_dir, project_id)
    summary = _load_project_summary(project_dir)
    if summary is None:
        raise HTTPException(
            status_code=404,
            detail=f"Project '{project_id}' metadata not found",
        )

    metadata_file = Path(summary.metadata_file)
    metadata, body = _read_project_frontmatter_with_body(metadata_file)
    normalized_profile = _normalize_project_artifact_profile_storage(profile)
    _ensure_project_artifact_layout(project_dir)
    metadata["artifact_profile"] = normalized_profile.model_dump(
        mode="json",
        exclude_none=True,
    )
    _write_project_frontmatter(metadata_file, metadata, body)

    updated = _load_project_summary(project_dir)
    if updated is None:
        raise HTTPException(
            status_code=500,
            detail="Failed to load updated project summary",
        )
    return updated


def _update_project_artifact_distill_mode(
    workspace_dir: Path,
    project_id: str,
    artifact_distill_mode: str,
) -> ProjectSummary:
    project_dir = _resolve_project_dir(workspace_dir, project_id)
    summary = _load_project_summary(project_dir)
    if summary is None:
        raise HTTPException(
            status_code=404,
            detail=f"Project '{project_id}' metadata not found",
        )

    metadata_file = Path(summary.metadata_file)
    metadata, body = _read_project_frontmatter_with_body(metadata_file)
    metadata[
        "artifact_distill_mode"
    ] = _normalize_project_artifact_distill_mode(
        artifact_distill_mode,
    )
    _write_project_frontmatter(metadata_file, metadata, body)

    updated = _load_project_summary(project_dir)
    if updated is None:
        raise HTTPException(
            status_code=500,
            detail="Failed to load updated project summary",
        )
    return updated


def _update_project_workspace_chat_binding(
    workspace_dir: Path,
    project_id: str,
    preferred_workspace_chat_id: str,
) -> ProjectSummary:
    project_dir = _resolve_project_dir(workspace_dir, project_id)
    summary = _load_project_summary(project_dir)
    if summary is None:
        raise HTTPException(
            status_code=404,
            detail=f"Project '{project_id}' metadata not found",
        )

    metadata_file = Path(summary.metadata_file)
    metadata, body = _read_project_frontmatter_with_body(metadata_file)
    metadata["preferred_workspace_chat_id"] = (
        preferred_workspace_chat_id.strip()
    )
    _write_project_frontmatter(metadata_file, metadata, body)

    updated = _load_project_summary(project_dir)
    if updated is None:
        raise HTTPException(
            status_code=500,
            detail="Failed to load updated project summary",
        )
    return updated


def _build_promoted_skill_markdown(
    item: ProjectArtifactItem,
    project_id: str,
    source_body: str,
) -> str:
    skill_name = item.name.strip() or item.id
    description = item.distillation_note.strip() or (
        f"Promoted from project '{project_id}' skill artifact '{item.id}'."
    )
    version = item.version.strip() or "v0-draft"
    tags = [*item.tags, "project-promoted", f"project:{project_id}"]
    deduped_tags = [tag for tag in dict.fromkeys(tags) if tag]
    tags_text = ", ".join(deduped_tags)
    source_text = source_body.strip()
    if not source_text:
        source_text = item.distillation_note.strip()
    source_block = source_text or "No additional project notes provided."
    return (
        "---\n"
        f"name: {skill_name}\n"
        f"description: {description}\n"
        f"version: {version}\n"
        f"tags: [{tags_text}]\n"
        "---\n\n"
        "## Origin\n"
        f"- project_id: {project_id}\n"
        f"- artifact_id: {item.id}\n"
        f"- source_path: {item.artifact_file_path}\n\n"
        "## Distilled Skill\n\n"
        f"{source_block}\n"
    )


def _extract_project_conversation_skill_candidates(
    project_dir: Path,
    limit: int = 50,
    run_id: str | None = None,
) -> list[dict[str, str]]:
    runs_dir = project_dir / "pipelines" / "runs"
    if not runs_dir.exists() or not runs_dir.is_dir():
        return []

    candidates: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    expected_run_id = str(run_id or "").strip().lower()

    for run_dir in sorted(
        runs_dir.iterdir(), key=lambda item: item.name.lower()
    ):
        if not run_dir.is_dir():
            continue
        manifest_file = run_dir / "run_manifest.json"
        if not manifest_file.exists() or not manifest_file.is_file():
            continue
        try:
            raw_doc = json.loads(manifest_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(raw_doc, dict):
            continue

        run_id = (
            str(raw_doc.get("run_id") or run_dir.name).strip() or run_dir.name
        )
        if expected_run_id and run_id.lower() != expected_run_id:
            continue
        events = raw_doc.get("collaboration_events") or []
        if not isinstance(events, list):
            continue

        for event in events:
            if not isinstance(event, dict):
                continue
            event_name = str(event.get("event") or "").strip().lower()
            if event_name not in {"step.completed", "run.completed"}:
                continue

            message = str(event.get("message") or "").strip()
            if not message:
                continue

            step_id = (
                str(event.get("step_id") or event_name).strip() or event_name
            )
            artifact_id = _safe_artifact_slug(
                f"{run_id}-{step_id}",
                f"skill-{generate_short_agent_id()}",
            )
            if artifact_id in seen_ids:
                continue
            seen_ids.add(artifact_id)

            name_seed = message.split(".")[0].strip() or message
            name_tokens = [token for token in name_seed.split() if token]
            if len(name_tokens) > 8:
                name_seed = " ".join(name_tokens[:8])

            rel_manifest_path = manifest_file.resolve().relative_to(
                project_dir.resolve()
            )
            candidates.append(
                {
                    "id": artifact_id,
                    "name": name_seed,
                    "note": f"[{run_id}] {message}",
                    "source_path": rel_manifest_path.as_posix(),
                },
            )
            if len(candidates) >= limit:
                return candidates

    return candidates


def _auto_distill_project_skills_to_draft(
    workspace_dir: Path,
    project_id: str,
    run_id: str | None = None,
) -> DistillProjectSkillsDraftResponse:
    project_dir = _resolve_project_dir(workspace_dir, project_id)
    summary = _load_project_summary(project_dir)
    if summary is None:
        raise HTTPException(
            status_code=404,
            detail=f"Project '{project_id}' metadata not found",
        )

    metadata_file = Path(summary.metadata_file)
    metadata, content_body = _read_project_frontmatter_with_body(metadata_file)
    profile = _parse_project_artifact_profile(metadata)
    existing_ids = {item.id for item in profile.skills}

    drafted_ids: list[str] = []
    skipped_count = 0

    if summary.artifact_distill_mode == "conversation_evidence":
        candidates = _extract_project_conversation_skill_candidates(
            project_dir,
            run_id=run_id,
        )
        for candidate in candidates:
            artifact_id = candidate["id"]
            if artifact_id in existing_ids:
                skipped_count += 1
                continue

            profile.skills.append(
                ProjectArtifactItem(
                    id=artifact_id,
                    name=candidate["name"],
                    kind="skill",
                    origin="project-distilled",
                    status="draft",
                    version="v0-draft",
                    artifact_file_path=candidate["source_path"],
                    tags=["auto-draft", "conversation-evidence"],
                    derived_from_ids=[],
                    distillation_note=candidate["note"],
                    market_source_id=None,
                    market_item_id=None,
                ),
            )
            existing_ids.add(artifact_id)
            drafted_ids.append(artifact_id)
    else:
        skills_dir = project_dir / "skills"
        if not skills_dir.exists() or not skills_dir.is_dir():
            return DistillProjectSkillsDraftResponse(
                drafted_count=0,
                skipped_count=0,
                drafted_ids=[],
                artifact_distill_mode=summary.artifact_distill_mode,
                project=summary,
            )

        for md_file in sorted(
            skills_dir.rglob("*.md"), key=lambda item: item.as_posix()
        ):
            if not md_file.is_file():
                continue
            rel_path = (
                md_file.resolve().relative_to(project_dir.resolve()).as_posix()
            )
            if rel_path.lower().endswith("/skill.md"):
                # Skip skill market packaging files that may appear in nested folders.
                skipped_count += 1
                continue

            artifact_seed = (
                md_file.relative_to(skills_dir).with_suffix("").as_posix()
            )
            artifact_id = _safe_artifact_slug(
                artifact_seed.replace("/", "-"),
                f"skill-{generate_short_agent_id()}",
            )
            if artifact_id in existing_ids:
                skipped_count += 1
                continue

            raw_text = read_text_file_with_encoding_fallback(md_file)
            lines = [
                line.strip() for line in raw_text.splitlines() if line.strip()
            ]
            heading = next(
                (
                    line.lstrip("#").strip()
                    for line in lines
                    if line.startswith("#")
                ),
                "",
            )
            name = (
                heading
                or md_file.stem.replace("-", " ").replace("_", " ").strip()
            )
            if not name:
                name = artifact_id

            note_lines: list[str] = []
            for line in lines:
                if line.startswith("#"):
                    continue
                note_lines.append(line)
                if len(" ".join(note_lines)) >= 240:
                    break
            distillation_note = " ".join(note_lines).strip() or (
                f"Auto drafted from {rel_path}."
            )

            profile.skills.append(
                ProjectArtifactItem(
                    id=artifact_id,
                    name=name,
                    kind="skill",
                    origin="project-distilled",
                    status="draft",
                    version="v0-draft",
                    artifact_file_path=rel_path,
                    tags=["auto-draft"],
                    derived_from_ids=[],
                    distillation_note=distillation_note,
                    market_source_id=None,
                    market_item_id=None,
                ),
            )
            existing_ids.add(artifact_id)
            drafted_ids.append(artifact_id)

    normalized_profile = _normalize_project_artifact_profile_storage(profile)
    _ensure_project_artifact_layout(project_dir)
    metadata["artifact_profile"] = normalized_profile.model_dump(
        mode="json",
        exclude_none=True,
    )
    _write_project_frontmatter(metadata_file, metadata, content_body)

    updated_summary = _load_project_summary(project_dir)
    if updated_summary is None:
        raise HTTPException(
            status_code=500,
            detail="Failed to load project after auto distillation",
        )

    return DistillProjectSkillsDraftResponse(
        drafted_count=len(drafted_ids),
        skipped_count=skipped_count,
        drafted_ids=drafted_ids,
        artifact_distill_mode=updated_summary.artifact_distill_mode,
        project=updated_summary,
    )


def _confirm_project_skill_stable(
    workspace_dir: Path,
    project_id: str,
    artifact_id: str,
) -> ConfirmProjectSkillStableResponse:
    project_dir = _resolve_project_dir(workspace_dir, project_id)
    summary = _load_project_summary(project_dir)
    if summary is None:
        raise HTTPException(
            status_code=404,
            detail=f"Project '{project_id}' metadata not found",
        )

    skill_item = next(
        (
            item
            for item in summary.artifact_profile.skills
            if item.id == artifact_id
        ),
        None,
    )
    if skill_item is None:
        raise HTTPException(
            status_code=404,
            detail=f"Skill artifact '{artifact_id}' not found in project",
        )

    metadata_file = Path(summary.metadata_file)
    metadata, content_body = _read_project_frontmatter_with_body(metadata_file)
    normalized_profile = _parse_project_artifact_profile(metadata)
    for idx, item in enumerate(normalized_profile.skills):
        if item.id != artifact_id:
            continue
        normalized_profile.skills[idx] = _normalize_project_artifact_storage(
            item.model_copy(update={"status": "stable"}),
            "skill",
        )
        break

    metadata["artifact_profile"] = normalized_profile.model_dump(
        mode="json",
        exclude_none=True,
    )
    _write_project_frontmatter(metadata_file, metadata, content_body)

    updated_summary = _load_project_summary(project_dir)
    if updated_summary is None:
        raise HTTPException(
            status_code=500,
            detail="Failed to load project after confirming stable",
        )

    confirmed_item = next(
        (
            item
            for item in updated_summary.artifact_profile.skills
            if item.id == artifact_id
        ),
        None,
    )
    if confirmed_item is None:
        raise HTTPException(
            status_code=500,
            detail="Failed to read updated skill artifact",
        )

    return ConfirmProjectSkillStableResponse(
        confirmed=True,
        artifact_id=artifact_id,
        status=confirmed_item.status,
        project=updated_summary,
    )


def _promote_project_skill_to_agent(
    workspace_dir: Path,
    project_id: str,
    artifact_id: str,
    body: PromoteProjectArtifactRequest,
) -> PromoteProjectArtifactResponse:
    project_dir = _resolve_project_dir(workspace_dir, project_id)
    summary = _load_project_summary(project_dir)
    if summary is None:
        raise HTTPException(
            status_code=404,
            detail=f"Project '{project_id}' metadata not found",
        )

    skill_item = next(
        (
            item
            for item in summary.artifact_profile.skills
            if item.id == artifact_id
        ),
        None,
    )
    if skill_item is None:
        raise HTTPException(
            status_code=404,
            detail=f"Skill artifact '{artifact_id}' not found in project",
        )
    if (skill_item.status or "").strip().lower() != "stable":
        raise HTTPException(
            status_code=400,
            detail=(
                "Only stable skill artifacts can be promoted. "
                f"Current status: '{skill_item.status or 'draft'}'."
            ),
        )

    skill_dir_name = _safe_artifact_slug(
        body.target_name or skill_item.id,
        f"skill-{generate_short_agent_id()}",
    )
    target_skill_dir = workspace_dir / "skills" / skill_dir_name
    target_skill_md = target_skill_dir / "SKILL.md"
    if target_skill_dir.exists() and not body.overwrite:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Target skill '{skill_dir_name}' already exists. "
                "Set overwrite=true to replace it."
            ),
        )

    source_body = ""
    source_path = skill_item.artifact_file_path.strip()
    if source_path:
        source_file = (project_dir / source_path).resolve()
        try:
            source_file.relative_to(project_dir.resolve())
        except ValueError:
            source_file = project_dir / "skills" / f"{skill_item.id}.md"
        if source_file.exists() and source_file.is_file():
            source_body = source_file.read_text(
                encoding="utf-8",
                errors="ignore",
            )

    target_skill_dir.mkdir(parents=True, exist_ok=True)
    promoted_md = _build_promoted_skill_markdown(
        skill_item,
        project_id,
        source_body,
    )
    target_skill_md.write_text(promoted_md, encoding="utf-8")

    if body.enable:
        try:
            from ...agents.skills_manager import reconcile_workspace_manifest

            manifest = reconcile_workspace_manifest(workspace_dir)
            entry = manifest.get("skills", {}).get(skill_dir_name)
            if isinstance(entry, dict):
                entry["enabled"] = True
                manifest_path = workspace_dir / "skill.json"
                manifest_path.write_text(
                    json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
        except Exception as exc:  # pragma: no cover - best effort enable
            logger.warning("Failed to auto-enable promoted skill: %s", exc)

    metadata_file = Path(summary.metadata_file)
    metadata, content_body = _read_project_frontmatter_with_body(metadata_file)
    normalized_profile = _parse_project_artifact_profile(metadata)
    for idx, item in enumerate(normalized_profile.skills):
        if item.id != artifact_id:
            continue
        updated_item = item.model_copy(
            update={
                "origin": "project-promoted",
                "market_item_id": skill_dir_name,
            },
        )
        normalized_profile.skills[idx] = _normalize_project_artifact_storage(
            updated_item,
            "skill",
        )
        break
    metadata["artifact_profile"] = normalized_profile.model_dump(
        mode="json",
        exclude_none=True,
    )
    _write_project_frontmatter(metadata_file, metadata, content_body)

    updated_summary = _load_project_summary(project_dir)
    if updated_summary is None:
        raise HTTPException(
            status_code=500,
            detail="Failed to load project after promote",
        )

    return PromoteProjectArtifactResponse(
        promoted=True,
        artifact_kind="skill",
        artifact_id=artifact_id,
        target_name=skill_dir_name,
        target_path=str(target_skill_md),
        project=updated_summary,
    )


def _build_unique_project_id(workspace_dir: Path, base_id: str) -> str:
    projects = _list_agent_projects(workspace_dir)
    existing = {item.id for item in projects}
    candidate = _slugify(base_id).replace("agent", "project")
    if candidate not in existing:
        return candidate
    index = 2
    while f"{candidate}-{index}" in existing:
        index += 1
    return f"{candidate}-{index}"


def _build_random_project_id(workspace_dir: Path) -> str:
    projects = _list_agent_projects(workspace_dir)
    existing = {item.id for item in projects}
    while True:
        candidate = f"project-{generate_short_agent_id()}"
        if candidate not in existing:
            return candidate


def _build_unique_project_name(workspace_dir: Path, base_name: str) -> str:
    projects = _list_agent_projects(workspace_dir)
    existing = {item.name for item in projects}
    name = (base_name or "").strip() or "Project Clone"
    if name not in existing:
        return name
    index = 2
    while f"{name} ({index})" in existing:
        index += 1
    return f"{name} ({index})"


def _write_project_frontmatter(
    metadata_file: Path,
    metadata: dict[str, Any],
    body: str,
) -> None:
    import yaml

    serialized = yaml.safe_dump(
        metadata,
        allow_unicode=True,
        sort_keys=False,
    ).strip()
    text = f"---\n{serialized}\n---\n\n{(body or '').strip()}\n"
    metadata_file.write_text(text, encoding="utf-8")


def _clone_project(
    workspace_dir: Path,
    source_project_id: str,
    body: CloneProjectRequest,
) -> ProjectSummary:
    source_dir = _resolve_project_dir(workspace_dir, source_project_id)
    source_summary = _load_project_summary(source_dir)
    if source_summary is None:
        raise HTTPException(
            status_code=404,
            detail=f"Project '{source_project_id}' metadata not found",
        )

    cloned_id_seed = body.target_id or f"{source_summary.id}-clone"
    cloned_id = _build_unique_project_id(workspace_dir, cloned_id_seed)
    cloned_name_seed = body.target_name or f"{source_summary.name} (Clone)"
    cloned_name = _build_unique_project_name(workspace_dir, cloned_name_seed)

    projects_dir = workspace_dir / _PROJECTS_DIRNAME
    projects_dir.mkdir(parents=True, exist_ok=True)
    target_dir = projects_dir / cloned_id
    shutil.copytree(source_dir, target_dir)

    if not body.include_pipeline_runs:
        runs_dir = target_dir / "pipelines" / "runs"
        if runs_dir.exists() and runs_dir.is_dir():
            shutil.rmtree(runs_dir)

    _ensure_project_artifact_layout(target_dir)

    metadata_file = next(
        (
            target_dir / name
            for name in _PROJECT_METADATA_FILENAMES
            if (target_dir / name).is_file()
        ),
        target_dir / "PROJECT.md",
    )

    parsed = _parse_markdown_frontmatter(metadata_file)
    metadata: dict[str, Any] = {}
    content_body = ""
    if parsed is not None:
        metadata, content_body = parsed
    elif metadata_file.exists():
        content_body = metadata_file.read_text(
            encoding="utf-8", errors="ignore"
        )

    metadata["id"] = cloned_id
    metadata["name"] = cloned_name
    tags = _parse_project_tags(metadata.get("tags"))
    if "cloned" not in tags:
        tags.append("cloned")
    metadata["tags"] = tags
    _write_project_frontmatter(metadata_file, metadata, content_body)

    summary = _load_project_summary(target_dir)
    if summary is None:
        raise HTTPException(
            status_code=500, detail="Failed to load cloned project summary"
        )
    return summary


def _create_project(
    workspace_dir: Path,
    body: CreateProjectRequest,
) -> ProjectSummary:
    _ensure_projects_layout(workspace_dir)

    project_name_seed = (body.name or "").strip() or "New Project"
    project_name = _build_unique_project_name(workspace_dir, project_name_seed)
    if (body.id or "").strip():
        project_id_seed = body.id or "project"
        project_id = _build_unique_project_id(workspace_dir, project_id_seed)
    else:
        project_id = _build_random_project_id(workspace_dir)

    projects_dir = workspace_dir / _PROJECTS_DIRNAME
    project_dir = projects_dir / project_id
    project_dir.mkdir(parents=True, exist_ok=False)

    data_subdir = _safe_project_data_subdir(body.data_dir)
    (project_dir / data_subdir).mkdir(parents=True, exist_ok=True)
    (project_dir / "pipelines" / "templates").mkdir(
        parents=True, exist_ok=True
    )
    _ensure_project_artifact_layout(project_dir)

    metadata_file = project_dir / "PROJECT.md"
    normalized_profile = _normalize_project_artifact_profile_storage(
        body.artifact_profile,
    )
    metadata = {
        "id": project_id,
        "name": project_name,
        "description": (body.description or "").strip(),
        "status": (body.status or "active").strip() or "active",
        "data_dir": data_subdir,
        "tags": [item.strip() for item in body.tags if str(item).strip()],
        "artifact_distill_mode": _normalize_project_artifact_distill_mode(
            body.artifact_distill_mode,
        ),
        "artifact_profile": normalized_profile.model_dump(
            mode="json",
            exclude_none=True,
        ),
    }
    body_text = (body.description or "").strip() or f"# {project_name}"
    _write_project_frontmatter(metadata_file, metadata, body_text)
    _scaffold_project_governance_files(project_dir, data_subdir)

    summary = _load_project_summary(project_dir)
    if summary is None:
        raise HTTPException(
            status_code=500, detail="Failed to load created project summary"
        )
    return summary


def _delete_project(
    workspace_dir: Path, project_id: str
) -> DeleteProjectResponse:
    project_dir = _resolve_project_dir(workspace_dir, project_id)
    shutil.rmtree(project_dir)
    return DeleteProjectResponse(success=True, project_id=project_id)


def _is_safe_relative_path(rel_path: str) -> bool:
    if not rel_path:
        return False
    candidate = Path(rel_path)
    if candidate.is_absolute() or ".." in candidate.parts:
        return False
    return True


def _rewrite_original_to_data_path(rel_path: str) -> str | None:
    normalized = rel_path.strip().replace("\\", "/")
    if not normalized.startswith("original/"):
        return None
    remainder = normalized[len("original/") :]
    if not remainder:
        return None
    return f"data/{remainder}"


def _list_project_files(project_dir: Path) -> list[ProjectFileInfo]:
    project_root = project_dir.resolve()
    files: list[ProjectFileInfo] = []

    for path in sorted(
        project_root.rglob("*"), key=lambda item: item.as_posix().lower()
    ):
        if not path.is_file():
            continue

        rel = path.resolve().relative_to(project_root).as_posix()
        if rel.startswith(".git/") or "/.git/" in rel:
            continue

        stat = path.stat()
        files.append(
            ProjectFileInfo(
                filename=path.name,
                path=rel,
                size=stat.st_size,
                modified_time=_format_iso_time(stat.st_mtime),
            ),
        )

    return files


def _read_project_text_file(project_dir: Path, rel_path: str) -> str:
    if not _is_safe_relative_path(rel_path):
        raise HTTPException(status_code=400, detail="Invalid file path")

    target_rel_path = rel_path
    target = (project_dir / target_rel_path).resolve()
    project_root = project_dir.resolve()
    if not str(target).startswith(str(project_root)):
        raise HTTPException(status_code=400, detail="Invalid file path")
    if not target.exists() or not target.is_file():
        fallback_rel_path = _rewrite_original_to_data_path(target_rel_path)
        if fallback_rel_path and _is_safe_relative_path(fallback_rel_path):
            fallback_target = (project_dir / fallback_rel_path).resolve()
            if str(fallback_target).startswith(str(project_root)) and fallback_target.exists() and fallback_target.is_file():
                target_rel_path = fallback_rel_path
                target = fallback_target
    if not target.exists() or not target.is_file():
        raise HTTPException(
            status_code=404, detail=f"File '{rel_path}' not found"
        )

    raw = target.read_bytes()
    if b"\x00" in raw[:4096]:
        raise HTTPException(
            status_code=400, detail="Binary file preview is not supported"
        )
    return raw.decode("utf-8", errors="replace")


def _upload_project_file(
    project_dir: Path,
    upload: UploadFile,
    target_dir: str,
) -> ProjectFileInfo:
    if not upload.filename:
        raise HTTPException(
            status_code=400, detail="Uploaded file must have a filename"
        )

    safe_dir = _safe_project_data_subdir(target_dir or "original")
    raw_name = Path(upload.filename).name.strip()
    if not raw_name:
        raise HTTPException(status_code=400, detail="Invalid filename")

    destination_dir = (project_dir / safe_dir).resolve()
    project_root = project_dir.resolve()
    if not str(destination_dir).startswith(str(project_root)):
        raise HTTPException(status_code=400, detail="Invalid target directory")
    destination_dir.mkdir(parents=True, exist_ok=True)

    destination_path = (destination_dir / raw_name).resolve()
    if not str(destination_path).startswith(str(project_root)):
        raise HTTPException(status_code=400, detail="Invalid destination path")

    content = upload.file.read()
    destination_path.write_bytes(content)

    stat = destination_path.stat()
    rel = destination_path.relative_to(project_root).as_posix()
    return ProjectFileInfo(
        filename=destination_path.name,
        path=rel,
        size=stat.st_size,
        modified_time=_format_iso_time(stat.st_mtime),
    )


def _is_square_candidate_markdown(path: Path) -> bool:
    if path.suffix.lower() != ".md":
        return False
    if path.name in _SQUARE_SKIP_FILES:
        return False
    for p in path.parts:
        if p in _SQUARE_SKIP_DIRS:
            return False
    return True


def _collect_agency_markdown_items(
    source: AgentsSquareSourceSpec,
    source_root: Path,
    repo_dir: Path,
) -> tuple[list[AgentSquareItem], dict[str, dict[str, Any]]]:
    items: list[AgentSquareItem] = []
    import_index: dict[str, dict[str, Any]] = {}
    seen: set[str] = set()

    for md_file in sorted(source_root.rglob("*.md")):
        if not md_file.is_file() or not _is_square_candidate_markdown(md_file):
            continue
        parsed = _parse_markdown_frontmatter(md_file)
        if parsed is None:
            continue
        meta, body = parsed
        name = str(meta.get("name") or "").strip()
        description = str(meta.get("description") or "").strip()
        if not name:
            continue

        # Normalize both paths to avoid macOS /var vs /private/var alias mismatch.
        rel_path = md_file.resolve().relative_to(repo_dir.resolve()).as_posix()
        agent_id = _slugify(str(meta.get("slug") or "") or md_file.stem)
        key = f"{source.id}:{agent_id}"
        if key in seen:
            agent_id = _slugify(f"{agent_id}-{md_file.stem}")
            key = f"{source.id}:{agent_id}"
        seen.add(key)

        category = rel_path.split("/")[0] if "/" in rel_path else ""
        item = AgentSquareItem(
            source_id=source.id,
            agent_id=agent_id,
            name=name,
            description=description,
            version=str(meta.get("version") or ""),
            license=source.license_hint or "",
            source_url=_build_github_blob_url(source, rel_path),
            install_url=_build_github_blob_url(source, rel_path),
            tags=[str(t) for t in (meta.get("tags") or []) if str(t).strip()],
            extra={
                "emoji": str(meta.get("emoji") or ""),
                "vibe": str(meta.get("vibe") or ""),
                "color": str(meta.get("color") or ""),
                "category": category,
                "original_path": rel_path,
            },
        )
        items.append(item)
        import_index[f"{source.id}/{agent_id}"] = {
            "name": name,
            "description": description,
            "content": body,
            "source_url": item.source_url,
            "license": item.license,
            "original_agent_id": agent_id,
        }

    return items, import_index


def _collect_index_json_items(
    source: AgentsSquareSourceSpec,
    source_root: Path,
    repo_dir: Path,
) -> tuple[list[AgentSquareItem], dict[str, dict[str, Any]]]:
    index_path = source_root
    if index_path.is_dir():
        index_path = index_path / "index.json"
    if not index_path.exists():
        raise ValueError("SOURCE_INDEX_INVALID: index.json not found")

    doc = json.loads(index_path.read_text(encoding="utf-8"))
    agents = doc.get("agents")
    if not isinstance(agents, list):
        raise ValueError("SOURCE_INDEX_INVALID: agents must be list")

    items: list[AgentSquareItem] = []
    import_index: dict[str, dict[str, Any]] = {}

    def _compose_content(node_doc: dict[str, Any], fallback_name: str) -> str:
        raw_content = str(node_doc.get("content") or "").strip()
        if raw_content:
            return raw_content

        soul = str(node_doc.get("soul") or node_doc.get("SOUL") or "").strip()
        rules = str(
            node_doc.get("rules") or node_doc.get("RULES") or ""
        ).strip()
        agents_md = str(
            node_doc.get("agents_md")
            or node_doc.get("agents")
            or node_doc.get("AGENTS")
            or "",
        ).strip()

        sections: list[str] = []
        if agents_md:
            sections.append(agents_md)
        else:
            sections.append(f"# {fallback_name}")
        if soul:
            sections.append("## SOUL\n" + soul)
        if rules:
            sections.append("## RULES\n" + rules)
        return "\n\n".join(part for part in sections if part.strip())

    for node in agents:
        if not isinstance(node, dict):
            continue
        agent_id = _slugify(str(node.get("agent_id") or node.get("id") or ""))
        name = str(node.get("name") or "").strip()
        if not agent_id or not name:
            continue
        rel = str(node.get("path") or "").strip()
        source_url = str(node.get("source_url") or "").strip()
        install_url = str(node.get("install_url") or source_url).strip()
        if rel and not source_url:
            source_url = _build_github_blob_url(source, rel)
            install_url = source_url
        content = _compose_content(node, name)

        item = AgentSquareItem(
            source_id=source.id,
            agent_id=agent_id,
            name=name,
            description=str(node.get("description") or ""),
            version=str(node.get("version") or ""),
            license=str(node.get("license") or source.license_hint or ""),
            source_url=source_url or source.url,
            install_url=install_url or source.url,
            tags=[str(t) for t in (node.get("tags") or []) if str(t).strip()],
            extra={
                "category": str(node.get("category") or ""),
                "original_path": rel,
            },
        )
        items.append(item)
        import_index[f"{source.id}/{agent_id}"] = {
            "name": name,
            "description": str(node.get("description") or ""),
            "content": content,
            "source_url": item.source_url,
            "license": item.license,
            "original_agent_id": agent_id,
            "bundle": node.get("bundle") or node.get("exchange") or {},
        }

    return items, import_index


def _aggregate_square_items(
    cfg: AgentsSquareConfig,
    *,
    refresh: bool = False,
) -> tuple[
    list[AgentSquareItem],
    list[SourceError],
    dict[str, object],
    dict[str, dict[str, Any]],
]:
    now = time.time()
    with _SQUARE_CACHE_LOCK:
        expires_at = float(_SQUARE_CACHE.get("expires_at", 0.0) or 0.0)
        if not refresh and now < expires_at:
            meta = cast(
                dict[str, object],
                copy.deepcopy(_SQUARE_CACHE.get("meta") or {}),
            )
            if isinstance(meta, dict):
                meta["cache_hit"] = True
            return (
                cast(
                    list[AgentSquareItem],
                    copy.deepcopy(_SQUARE_CACHE.get("items") or []),
                ),
                cast(
                    list[SourceError],
                    copy.deepcopy(_SQUARE_CACHE.get("errors") or []),
                ),
                meta,
                cast(
                    dict[str, dict[str, Any]],
                    copy.deepcopy(_SQUARE_CACHE.get("import_index") or {}),
                ),
            )

    started = time.time()
    items: list[AgentSquareItem] = []
    errors: list[SourceError] = []
    import_index: dict[str, dict[str, Any]] = {}
    enabled_sources = sorted(
        [s for s in cfg.sources if s.enabled],
        key=lambda s: (s.order, s.id),
    )

    for source in enabled_sources:
        tmp_dir: Path | None = None
        try:
            tmp_dir = _clone_square_source(source)
            source_root = (tmp_dir / (source.path or ".")).resolve()
            if not str(source_root).startswith(str(tmp_dir.resolve())):
                raise ValueError(
                    "SOURCE_INDEX_INVALID: path escapes repository"
                )
            if not source_root.exists():
                raise ValueError(
                    f"SOURCE_INDEX_INVALID: path not found '{source.path}'",
                )

            if source.provider == "agency_markdown_repo":
                (
                    source_items,
                    source_import_index,
                ) = _collect_agency_markdown_items(
                    source,
                    source_root,
                    tmp_dir,
                )
            else:
                source_items, source_import_index = _collect_index_json_items(
                    source,
                    source_root,
                    tmp_dir,
                )

            items.extend(source_items)
            import_index.update(source_import_index)
        except ValueError as e:
            errors.append(
                SourceError(
                    source_id=source.id,
                    code="SOURCE_INDEX_INVALID",
                    message=str(e),
                    retryable=False,
                ),
            )
        except RuntimeError as e:
            errors.append(
                SourceError(
                    source_id=source.id,
                    code="SOURCE_UNREACHABLE",
                    message=str(e),
                    retryable=True,
                ),
            )
        except Exception as e:  # pylint: disable=broad-except
            errors.append(
                SourceError(
                    source_id=source.id,
                    code="SOURCE_LOAD_FAILED",
                    message=str(e),
                    retryable=True,
                ),
            )
        finally:
            if tmp_dir and tmp_dir.exists():
                import shutil

                shutil.rmtree(tmp_dir, ignore_errors=True)

    items.sort(
        key=lambda item: (item.source_id, item.name.lower(), item.agent_id)
    )
    duration_ms = int((time.time() - started) * 1000)
    meta: dict[str, object] = {
        "generated_at": time.time(),
        "cache_ttl_sec": cfg.cache.ttl_sec,
        "source_count": len(enabled_sources),
        "item_count": len(items),
        "cache_hit": False,
        "duration_ms": duration_ms,
    }

    with _SQUARE_CACHE_LOCK:
        _SQUARE_CACHE["expires_at"] = time.time() + cfg.cache.ttl_sec
        _SQUARE_CACHE["items"] = copy.deepcopy(items)
        _SQUARE_CACHE["errors"] = copy.deepcopy(errors)
        _SQUARE_CACHE["meta"] = copy.deepcopy(meta)
        _SQUARE_CACHE["import_index"] = copy.deepcopy(import_index)

    return items, errors, meta, import_index


def _extract_install_urls(bundle: dict[str, Any]) -> list[str]:
    urls: list[str] = []

    raw_skills = bundle.get("skills")
    if isinstance(raw_skills, dict):
        candidates = (
            raw_skills.get("install_urls")
            or raw_skills.get("bundle_urls")
            or []
        )
    else:
        candidates = raw_skills

    if isinstance(candidates, list):
        for item in candidates:
            if isinstance(item, str) and item.strip():
                urls.append(item.strip())
            elif isinstance(item, dict):
                url = str(
                    item.get("install_url") or item.get("url") or ""
                ).strip()
                if url:
                    urls.append(url)

    raw_skill_bundles = bundle.get("skill_bundles")
    if isinstance(raw_skill_bundles, list):
        for item in raw_skill_bundles:
            if isinstance(item, str) and item.strip():
                urls.append(item.strip())
            elif isinstance(item, dict):
                url = str(
                    item.get("url") or item.get("install_url") or ""
                ).strip()
                if url:
                    urls.append(url)

    return [u for u in dict.fromkeys(urls) if u]


def _extract_builtin_tool_names(bundle: dict[str, Any]) -> list[str]:
    names: list[str] = []

    for key in ("tools", "builtin_tools"):
        raw = bundle.get(key)
        if not isinstance(raw, list):
            continue
        for item in raw:
            if isinstance(item, str) and item.strip():
                names.append(item.strip())
            elif isinstance(item, dict):
                name = str(item.get("name") or item.get("id") or "").strip()
                if name:
                    names.append(name)

    manifest = bundle.get("manifest")
    if isinstance(manifest, dict):
        raw_manifest_tools = manifest.get("tools")
        if isinstance(raw_manifest_tools, list):
            for item in raw_manifest_tools:
                if isinstance(item, str) and item.strip():
                    names.append(item.strip())

    return [n for n in dict.fromkeys(names) if n]


def _extract_flow_items(bundle: dict[str, Any]) -> list[dict[str, Any]]:
    flows = bundle.get("workflows")
    if flows is None:
        flows = bundle.get("flows")
    if not isinstance(flows, list):
        return []
    return [item for item in flows if isinstance(item, dict)]


def _resolve_bundle_import_toggles(bundle: dict[str, Any]) -> dict[str, bool]:
    """Resolve optional per-resource import toggles from bundle payload."""
    toggles: dict[str, bool] = {
        "skills": True,
        "tools": True,
        "flow_descriptions": True,
    }

    raw_import = bundle.get("import")
    if not isinstance(raw_import, dict):
        return toggles

    if "skills" in raw_import:
        toggles["skills"] = bool(raw_import.get("skills"))
    if "tools" in raw_import:
        toggles["tools"] = bool(raw_import.get("tools"))

    if "flow_descriptions" in raw_import:
        toggles["flow_descriptions"] = bool(
            raw_import.get("flow_descriptions"),
        )
    elif "workflows" in raw_import:
        toggles["flow_descriptions"] = bool(raw_import.get("workflows"))
    elif "flows" in raw_import:
        toggles["flow_descriptions"] = bool(raw_import.get("flows"))

    return toggles


def _activate_import_bundle(
    *,
    workspace_dir: Path,
    local_agent_id: str,
    source_id: str,
    original_agent_id: str,
    bundle: dict[str, Any],
    overwrite: bool,
) -> dict[str, Any]:
    toggles = _resolve_bundle_import_toggles(bundle)
    summary: dict[str, Any] = {
        "skills_installed": [],
        "skill_errors": [],
        "builtin_tools_enabled": [],
        "flow_description_count": 0,
        "flow_count": 0,
        "project_id": "",
        "import_toggles": toggles,
    }

    if toggles["skills"]:
        install_urls = _extract_install_urls(bundle)
        for url in install_urls:
            try:
                result = install_skill_from_hub(
                    workspace_dir=workspace_dir,
                    bundle_url=url,
                    enable=True,
                    overwrite=overwrite,
                )
                summary["skills_installed"].append(result.name)
            except SkillConflictError as exc:
                summary["skill_errors"].append(str(exc.detail))
            except Exception as exc:  # pylint: disable=broad-except
                summary["skill_errors"].append(str(exc))

    if toggles["tools"]:
        tool_names = _extract_builtin_tool_names(bundle)
        if tool_names:
            try:
                agent_cfg = load_agent_config(local_agent_id)
                tools_cfg = agent_cfg.tools
                if tools_cfg is None:
                    summary.setdefault("tool_errors", []).append(
                        "tools config is missing",
                    )
                else:
                    changed = False
                    for tool_name in tool_names:
                        builtin = tools_cfg.builtin_tools.get(tool_name)
                        if builtin is None:
                            continue
                        if not builtin.enabled:
                            builtin.enabled = True
                            changed = True
                        summary["builtin_tools_enabled"].append(tool_name)
                    if changed:
                        save_agent_config(local_agent_id, agent_cfg)
            except Exception as exc:  # pylint: disable=broad-except
                summary.setdefault("tool_errors", []).append(str(exc))

    flows = _extract_flow_items(bundle) if toggles["flow_descriptions"] else []
    if flows:
        project_seed = f"import-{source_id}-{original_agent_id}"
        project_name = (
            str(bundle.get("project_name") or "Imported Bundle").strip()
            or "Imported Bundle"
        )
        project_summary = _create_project(
            workspace_dir,
            CreateProjectRequest(
                id=project_seed,
                name=project_name,
                description="Imported workflow bundle",
                tags=["imported", "bundle"],
            ),
        )
        project_dir = _resolve_project_dir(workspace_dir, project_summary.id)
        _ensure_project_artifact_layout(project_dir)

        profile = project_summary.artifact_profile
        for idx, flow in enumerate(flows, start=1):
            flow_id_raw = str(
                flow.get("id") or flow.get("name") or f"flow-{idx}",
            ).strip()
            flow_id = _slugify(flow_id_raw)
            flow_name = str(flow.get("name") or flow_id_raw).strip() or flow_id
            flow_version = (
                str(flow.get("version") or "v0-draft").strip() or "v0-draft"
            )
            flow_content = str(
                flow.get("content") or flow.get("markdown") or ""
            ).strip()
            if not flow_content:
                flow_content = (
                    "```json\n"
                    + json.dumps(
                        flow,
                        ensure_ascii=False,
                        indent=2,
                    )
                    + "\n```"
                )

            flow_item = _normalize_project_artifact_storage(
                ProjectArtifactItem(
                    id=flow_id,
                    name=flow_name,
                    kind="flow",
                    origin="imported-bundle",
                    status="active",
                    version=flow_version,
                    tags=["imported", "description"],
                    distillation_note=(
                        "Imported as flow description artifact from "
                        "agent exchange bundle."
                    ),
                ),
                "flow",
            )
            artifact_file = project_dir / flow_item.artifact_file_path
            artifact_file.parent.mkdir(parents=True, exist_ok=True)
            artifact_file.write_text(flow_content + "\n", encoding="utf-8")

            if all(existing.id != flow_item.id for existing in profile.flows):
                profile.flows.append(flow_item)

        updated_summary = _update_project_artifact_profile(
            workspace_dir,
            project_summary.id,
            profile,
        )
        summary["flow_description_count"] = len(flows)
        summary["flow_count"] = len(flows)
        summary["project_id"] = updated_summary.id

    return summary


def _find_imported_agent(
    config,
    source_id: str,
    original_agent_id: str,
) -> tuple[str, Path] | None:
    for local_agent_id, agent_ref in config.agents.profiles.items():
        metadata_file = Path(agent_ref.workspace_dir) / "imported_from.json"
        if not metadata_file.exists():
            continue
        try:
            payload = json.loads(metadata_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        if (
            payload.get("source_id") == source_id
            and payload.get("original_agent_id") == original_agent_id
        ):
            return local_agent_id, Path(agent_ref.workspace_dir)
    return None


def _persist_import_metadata(
    workspace_dir: Path, payload: dict[str, str]
) -> None:
    metadata_file = workspace_dir / "imported_from.json"
    metadata_file.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _extract_github_source_spec(url: str) -> tuple[str, str, str] | None:
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


def _normalize_source_url(url: str) -> str:
    raw = (url or "").strip()
    if _OWNER_REPO_PATTERN.fullmatch(raw):
        return f"https://github.com/{raw}.git"
    return raw


def _normalize_square_source(
    source: AgentsSquareSourceSpec,
) -> AgentsSquareSourceSpec:
    normalized = source.model_copy(deep=True)
    github_spec = _extract_github_source_spec(normalized.url)
    if github_spec is not None:
        repo_url, branch, path = github_spec
        normalized.url = repo_url
        if branch and not normalized.branch:
            normalized.branch = branch
        if path and (not normalized.path or normalized.path == "."):
            normalized.path = path
        return normalized

    normalized.url = _normalize_source_url(normalized.url)
    return normalized


def _validate_square_source_url(url: str) -> bool:
    raw = (url or "").strip()
    if not raw:
        return False
    if _OWNER_REPO_PATTERN.fullmatch(raw):
        return True
    if _extract_github_source_spec(raw) is not None:
        return True
    if raw.startswith(("https://", "http://", "git@")):
        return True
    if raw.endswith(".git"):
        return True
    return False


def _validate_square_source_path(path: str) -> bool:
    raw = (path or "").strip() or "."
    p = Path(raw)
    if p.is_absolute():
        return False
    return ".." not in p.parts


def _validate_square_source_ids(sources: list[AgentsSquareSourceSpec]) -> None:
    seen: set[str] = set()
    for source in sources:
        if not _AGENT_ID_RE.fullmatch(source.id):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"SOURCE_ID_INVALID: {source.id}. "
                    "Use lowercase letters, digits, underscore, or hyphen"
                ),
            )
        if source.id in seen:
            raise HTTPException(
                status_code=400,
                detail=f"SOURCE_ID_DUPLICATED: {source.id}",
            )
        seen.add(source.id)


def _square_config_to_payload(
    cfg: AgentsSquareConfig,
) -> AgentsSquareSourcesPayload:
    return AgentsSquareSourcesPayload(
        version=cfg.version,
        cache={"ttl_sec": cfg.cache.ttl_sec},
        install={
            "overwrite_default": cfg.install.overwrite_default,
            "preserve_workspace_files": cfg.install.preserve_workspace_files,
        },
        sources=cfg.sources,
    )


def _payload_to_square_config(
    payload: AgentsSquareSourcesPayload,
) -> AgentsSquareConfig:
    _validate_square_source_ids(payload.sources)
    normalized_sources: list[AgentsSquareSourceSpec] = []

    for source in payload.sources:
        normalized = _normalize_square_source(source)
        if not _validate_square_source_url(normalized.url):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"SOURCE_URL_INVALID: {source.url}. "
                    "Use owner/repo, http(s), ssh, or .git URL"
                ),
            )
        if not _validate_square_source_path(normalized.path):
            raise HTTPException(
                status_code=400,
                detail=f"SOURCE_INDEX_INVALID: invalid path '{normalized.path}'",
            )
        normalized_sources.append(normalized)

    ttl_sec = int(payload.cache.get("ttl_sec", 600))
    overwrite_default = bool(payload.install.get("overwrite_default", False))
    preserve_workspace_files = bool(
        payload.install.get("preserve_workspace_files", True),
    )

    return AgentsSquareConfig(
        version=max(1, int(payload.version)),
        sources=normalized_sources,
        cache=AgentsSquareCacheConfig(ttl_sec=ttl_sec),
        install=AgentsSquareInstallConfig(
            overwrite_default=overwrite_default,
            preserve_workspace_files=preserve_workspace_files,
        ),
    )


def _get_multi_agent_manager(request: Request | None) -> MultiAgentManager:
    """Get MultiAgentManager from app state."""
    if request is None:
        raise HTTPException(
            status_code=500,
            detail="Request context is required for agent runtime operations",
        )
    if not hasattr(request.app.state, "multi_agent_manager"):
        raise HTTPException(
            status_code=500,
            detail="MultiAgentManager not initialized",
        )
    return request.app.state.multi_agent_manager


def _normalized_agent_order(config) -> list[str]:
    """Return a deduplicated agent order covering every configured agent."""
    profile_ids = list(config.agents.profiles.keys())
    ordered_ids: list[str] = []

    for agent_id in config.agents.agent_order:
        if agent_id in config.agents.profiles and agent_id not in ordered_ids:
            ordered_ids.append(agent_id)

    for agent_id in profile_ids:
        if agent_id not in ordered_ids:
            ordered_ids.append(agent_id)

    return ordered_ids


def _read_profile_description(workspace_dir: str) -> str:
    """Read description from PROFILE.md if exists."""
    try:
        profile_path = Path(workspace_dir) / "PROFILE.md"
        if not profile_path.exists():
            return ""

        content = read_text_file_with_encoding_fallback(profile_path).strip()
        lines = []
        in_identity = False

        for line in content.split("\n"):
            if line.strip().startswith("## 身份") or line.strip().startswith(
                "## Identity",
            ):
                in_identity = True
                continue
            if in_identity:
                if line.strip().startswith("##"):
                    break
                if line.strip() and not line.strip().startswith("#"):
                    lines.append(line.strip())

        return " ".join(lines)[:200] if lines else ""
    except Exception:  # noqa: E722
        return ""


@router.get(
    "",
    response_model=AgentListResponse,
    summary="List all agents",
    description="Get list of all configured agents",
)
async def list_agents() -> AgentListResponse:
    """List all configured agents."""
    config = load_config()
    ordered_agent_ids = _normalized_agent_order(config)

    agents = []
    for agent_id in ordered_agent_ids:
        agent_ref = config.agents.profiles[agent_id]
        workspace_dir = Path(agent_ref.workspace_dir)
        _ensure_projects_layout(workspace_dir)
        projects = _list_agent_projects(workspace_dir)

        # Load agent config to get name and description
        try:
            agent_config = load_agent_config(agent_id)
            description = agent_config.description or ""

            profile_desc = _read_profile_description(agent_ref.workspace_dir)
            if profile_desc:
                if description.strip():
                    description = f"{description.strip()} | {profile_desc}"
                else:
                    description = profile_desc

            agents.append(
                AgentSummary(
                    id=agent_id,
                    name=agent_config.name,
                    description=description,
                    workspace_dir=agent_ref.workspace_dir,
                    enabled=getattr(agent_ref, "enabled", True),
                    project_count=len(projects),
                    projects=projects,
                ),
            )
        except Exception:  # noqa: E722
            agents.append(
                AgentSummary(
                    id=agent_id,
                    name=agent_id.title(),
                    description="",
                    workspace_dir=agent_ref.workspace_dir,
                    enabled=getattr(agent_ref, "enabled", True),
                    project_count=len(projects),
                    projects=projects,
                ),
            )

    return AgentListResponse(agents=agents)


@router.put(
    "/order",
    summary="Persist agent order",
    description="Save the full ordered list of configured agent IDs",
)
async def reorder_agents(
    reorder_request: ReorderAgentsRequest = Body(...),
) -> dict:
    """Persist the full ordered list of agent IDs."""
    config = load_config()
    configured_ids = list(config.agents.profiles.keys())

    if len(reorder_request.agent_ids) != len(set(reorder_request.agent_ids)):
        raise HTTPException(
            status_code=400,
            detail="Each configured agent ID must appear exactly once.",
        )

    if set(reorder_request.agent_ids) != set(configured_ids):
        raise HTTPException(
            status_code=400,
            detail="Each configured agent ID must appear exactly once.",
        )

    config.agents.agent_order = list(reorder_request.agent_ids)
    save_config(config)

    return {"success": True, "agent_ids": config.agents.agent_order}


@router.get("/square/sources", response_model=AgentsSquareSourcesPayload)
async def get_square_sources() -> AgentsSquareSourcesPayload:
    """Get Agents Square source configuration."""
    square_cfg = _load_current_square_config()
    return _square_config_to_payload(square_cfg)


@router.get(
    "/square/sources/defaults", response_model=AgentsSquareSourcesPayload
)
async def get_square_source_defaults() -> AgentsSquareSourcesPayload:
    """Get bundled Agents Square default source configuration from package."""
    square_cfg = _load_default_square_config()
    return _square_config_to_payload(square_cfg)


@router.put("/square/sources", response_model=AgentsSquareSourcesPayload)
async def put_square_sources(
    payload: AgentsSquareSourcesPayload,
) -> AgentsSquareSourcesPayload:
    """Update Agents Square source configuration."""
    current_square_cfg = _load_current_square_config()
    square_cfg = _payload_to_square_config(payload)

    # Pinned sources can be disabled but not removed.
    pinned_ids = {
        source.id for source in current_square_cfg.sources if source.pinned
    }
    next_ids = {source.id for source in square_cfg.sources}
    removed_pinned = pinned_ids - next_ids
    if removed_pinned:
        source_id = sorted(removed_pinned)[0]
        raise HTTPException(
            status_code=400,
            detail=f"SOURCE_PINNED_CANNOT_DELETE: {source_id}",
        )

    _save_current_square_config(square_cfg)

    # Keep root config in sync for backward compatibility.
    config = load_config()
    config.agents_square = square_cfg
    save_config(config)
    return _square_config_to_payload(square_cfg)


@router.post(
    "/square/sources/reset", response_model=AgentsSquareSourcesPayload
)
async def reset_square_sources() -> AgentsSquareSourcesPayload:
    """Reset current square sources by copying bundled default.json."""
    square_cfg = _reset_current_square_config_to_default()

    # Keep root config in sync for backward compatibility.
    config = load_config()
    config.agents_square = square_cfg
    save_config(config)

    return _square_config_to_payload(square_cfg)


@router.post("/square/sources/validate")
async def validate_square_source(
    payload: ValidateSquareSourceRequest,
) -> dict:
    """Validate a source specification and return normalized contract."""
    normalized = _normalize_square_source(payload)
    if not _validate_square_source_url(normalized.url):
        raise HTTPException(
            status_code=400,
            detail=(
                f"SOURCE_URL_INVALID: {payload.url}. "
                "Use owner/repo, http(s), ssh, or .git URL"
            ),
        )
    if not _validate_square_source_path(normalized.path):
        raise HTTPException(
            status_code=400,
            detail=f"SOURCE_INDEX_INVALID: invalid path '{normalized.path}'",
        )

    probe = subprocess.run(
        ["git", "ls-remote", "--heads", normalized.url],
        capture_output=True,
        text=True,
        timeout=20,
        check=False,
    )
    if probe.returncode != 0:
        raise HTTPException(
            status_code=502,
            detail=(
                "SOURCE_UNREACHABLE: "
                + (probe.stderr.strip() or "ls-remote failed")
            ),
        )

    return {
        "ok": True,
        "normalized": normalized.model_dump(mode="json"),
        "warnings": [],
    }


@router.get("/square/items")
async def get_square_items(refresh: bool = False) -> dict:
    """Get aggregated Agents Square items."""
    square_cfg = _load_current_square_config()
    items, source_errors, meta, _ = _aggregate_square_items(
        square_cfg,
        refresh=refresh,
    )

    if refresh:
        meta["cache_hit"] = False

    return {
        "items": [item.model_dump(mode="json") for item in items],
        "source_errors": [e.model_dump(mode="json") for e in source_errors],
        "meta": meta,
    }


@router.post("/square/import", response_model=ImportAgentResponse)
async def import_square_agent(
    req: ImportAgentRequest,
) -> ImportAgentResponse:
    """Import a source agent into local agents."""
    square_cfg = _load_current_square_config()
    config = load_config()
    source = next(
        (s for s in square_cfg.sources if s.id == req.source_id and s.enabled),
        None,
    )
    if source is None:
        raise HTTPException(
            status_code=404,
            detail=f"AGENT_ITEM_NOT_FOUND: {req.source_id}/{req.agent_id}",
        )

    items, _, _, import_index = _aggregate_square_items(
        square_cfg,
        refresh=False,
    )
    selected_item = next(
        (
            item
            for item in items
            if item.source_id == req.source_id
            and item.agent_id == req.agent_id
        ),
        None,
    )
    selected_payload = import_index.get(f"{req.source_id}/{req.agent_id}")
    if selected_item is None or selected_payload is None:
        raise HTTPException(
            status_code=404,
            detail=f"AGENT_ITEM_NOT_FOUND: {req.source_id}/{req.agent_id}",
        )

    content = (selected_payload.get("content") or "").strip()
    if not content:
        raise HTTPException(
            status_code=422,
            detail=(
                "AGENT_TEMPLATE_INVALID: source item has no importable content"
            ),
        )

    overwrite = bool(req.overwrite or square_cfg.install.overwrite_default)
    preferred_name = (req.preferred_name or "").strip()
    target_name = preferred_name or selected_item.name
    target_description = selected_item.description

    existing_import = _find_imported_agent(
        config,
        req.source_id,
        req.agent_id,
    )

    if existing_import is not None and not overwrite:
        raise HTTPException(
            status_code=409,
            detail=(
                f"AGENT_NAME_CONFLICT: {req.source_id}/{req.agent_id} "
                "already imported"
            ),
        )

    if existing_import is None:
        for local_id in config.agents.profiles:
            try:
                cfg = load_agent_config(local_id)
            except Exception:
                continue
            if cfg.name.strip().lower() == target_name.strip().lower():
                if not overwrite:
                    raise HTTPException(
                        status_code=409,
                        detail=f"AGENT_NAME_CONFLICT: {target_name}",
                    )
                existing_import = (
                    local_id,
                    Path(config.agents.profiles[local_id].workspace_dir),
                )
                break

    if existing_import is not None:
        local_agent_id, workspace_dir = existing_import
        workspace_dir.mkdir(parents=True, exist_ok=True)
        agent_cfg = load_agent_config(local_agent_id)
        agent_cfg.name = target_name
        agent_cfg.description = target_description
        save_agent_config(local_agent_id, agent_cfg)
    else:
        max_attempts = 10
        local_agent_id = None
        for _ in range(max_attempts):
            candidate_id = generate_short_agent_id()
            if candidate_id not in config.agents.profiles:
                local_agent_id = candidate_id
                break
        if local_agent_id is None:
            raise HTTPException(
                status_code=500,
                detail="Failed to generate unique agent ID after 10 attempts",
            )

        workspace_dir = Path(
            f"{WORKING_DIR}/workspaces/{local_agent_id}"
        ).expanduser()
        workspace_dir.mkdir(parents=True, exist_ok=True)

        from ...config.config import (
            ChannelConfig,
            MCPConfig,
            HeartbeatConfig,
            ToolsConfig,
        )

        agent_cfg = AgentProfileConfig(
            id=local_agent_id,
            name=target_name,
            description=target_description,
            workspace_dir=str(workspace_dir),
            language=config.agents.language,
            channels=ChannelConfig(),
            mcp=MCPConfig(),
            heartbeat=HeartbeatConfig(),
            tools=ToolsConfig(),
        )
        _initialize_agent_workspace(workspace_dir, agent_cfg)
        config.agents.profiles[local_agent_id] = AgentProfileRef(
            id=local_agent_id,
            workspace_dir=str(workspace_dir),
        )
        save_config(config)
        save_agent_config(local_agent_id, agent_cfg)

    (workspace_dir / "AGENTS.md").write_text(content + "\n", encoding="utf-8")

    bundle_payload = selected_payload.get("bundle")
    if isinstance(bundle_payload, str):
        try:
            bundle_payload = json.loads(bundle_payload)
        except Exception:
            bundle_payload = {}
    if not isinstance(bundle_payload, dict):
        bundle_payload = {}

    activation_summary: dict[str, Any] | None = None
    if bundle_payload:
        activation_summary = _activate_import_bundle(
            workspace_dir=workspace_dir,
            local_agent_id=local_agent_id,
            source_id=req.source_id,
            original_agent_id=req.agent_id,
            bundle=bundle_payload,
            overwrite=overwrite,
        )

    imported_from_payload = {
        "source_id": req.source_id,
        "source_url": selected_payload.get("source_url")
        or selected_item.source_url,
        "license": selected_payload.get("license") or selected_item.license,
        "original_agent_id": req.agent_id,
        "imported_at": str(int(time.time())),
    }
    if activation_summary is not None:
        imported_from_payload["activation_summary"] = json.dumps(
            activation_summary,
            ensure_ascii=False,
        )
    _persist_import_metadata(workspace_dir, imported_from_payload)

    return ImportAgentResponse(
        imported=True,
        id=local_agent_id,
        name=target_name,
        workspace_dir=str(workspace_dir),
        source={
            "source_id": req.source_id,
            "source_url": imported_from_payload["source_url"],
            "license": imported_from_payload["license"],
            "original_agent_id": req.agent_id,
        },
    )


@router.get(
    "/{agentId}",
    response_model=AgentProfileConfig,
    summary="Get agent details",
    description="Get complete configuration for a specific agent",
)
async def get_agent(agentId: str = PathParam(...)) -> AgentProfileConfig:
    """Get agent configuration."""
    try:
        agent_config = load_agent_config(agentId)
        return agent_config
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "",
    response_model=AgentProfileRef,
    status_code=201,
    summary="Create new agent",
    description="Create a new agent (ID is auto-generated by server)",
)
async def create_agent(
    request: CreateAgentRequest = Body(...),
) -> AgentProfileRef:
    """Create a new agent with auto-generated ID."""
    config = load_config()

    max_attempts = 10
    new_id = None
    for _ in range(max_attempts):
        candidate_id = generate_short_agent_id()
        if candidate_id not in config.agents.profiles:
            new_id = candidate_id
            break

    if new_id is None:
        raise HTTPException(
            status_code=500,
            detail="Failed to generate unique agent ID after 10 attempts",
        )

    workspace_dir = Path(
        request.workspace_dir or f"{WORKING_DIR}/workspaces/{new_id}",
    ).expanduser()
    workspace_dir.mkdir(parents=True, exist_ok=True)

    from ...config.config import (
        ChannelConfig,
        MCPConfig,
        HeartbeatConfig,
        ToolsConfig,
    )

    agent_config = AgentProfileConfig(
        id=new_id,
        name=request.name,
        description=request.description,
        workspace_dir=str(workspace_dir),
        language=request.language,
        channels=ChannelConfig(),
        mcp=MCPConfig(),
        heartbeat=HeartbeatConfig(),
        tools=ToolsConfig(),
    )

    _initialize_agent_workspace(
        workspace_dir,
        skill_names=(
            request.skill_names if request.skill_names is not None else []
        ),
    )

    agent_ref = AgentProfileRef(
        id=new_id,
        workspace_dir=str(workspace_dir),
        enabled=True,
    )

    config.agents.profiles[new_id] = agent_ref
    config.agents.agent_order = _normalized_agent_order(config)
    save_config(config)
    save_agent_config(new_id, agent_config)

    logger.info(f"Created new agent: {new_id} (name={request.name})")

    return agent_ref


@router.put(
    "/{agentId}",
    response_model=AgentProfileConfig,
    summary="Update agent",
    description="Update agent configuration and trigger reload",
)
async def update_agent(
    request: Request,
    agentId: str = PathParam(...),
    agent_config: AgentProfileConfig = Body(...),
) -> AgentProfileConfig:
    """Update agent configuration."""
    config = load_config()

    if agentId not in config.agents.profiles:
        raise HTTPException(
            status_code=404,
            detail=f"Agent '{agentId}' not found",
        )

    existing_config = load_agent_config(agentId)

    update_data = agent_config.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key != "id":
            setattr(existing_config, key, value)

    existing_config.id = agentId
    save_agent_config(agentId, existing_config)
    schedule_agent_reload(request, agentId)

    return agent_config


@router.delete(
    "/{agentId}",
    summary="Delete agent",
    description="Delete agent and workspace (cannot delete default agent)",
)
async def delete_agent(
    request: Request,
    agentId: str = PathParam(...),
) -> dict:
    """Delete an agent."""
    config = load_config()

    if agentId not in config.agents.profiles:
        raise HTTPException(
            status_code=404,
            detail=f"Agent '{agentId}' not found",
        )

    if agentId == "default":
        raise HTTPException(
            status_code=400,
            detail="Cannot delete the default agent",
        )

    manager = _get_multi_agent_manager(request)
    await manager.stop_agent(agentId)

    del config.agents.profiles[agentId]
    config.agents.agent_order = _normalized_agent_order(config)
    save_config(config)

    return {"success": True, "agent_id": agentId}


@router.patch(
    "/{agentId}/toggle",
    summary="Toggle agent enabled state",
    description="Enable or disable an agent (cannot disable default agent)",
)
async def toggle_agent_enabled(
    request: Request,
    agentId: str = PathParam(...),
    enabled: bool = Body(..., embed=True),
) -> dict:
    """Toggle agent enabled state."""
    config = load_config()

    if agentId not in config.agents.profiles:
        raise HTTPException(
            status_code=404,
            detail=f"Agent '{agentId}' not found",
        )

    if agentId == "default":
        raise HTTPException(
            status_code=400,
            detail="Cannot disable the default agent",
        )

    agent_ref = config.agents.profiles[agentId]
    manager = _get_multi_agent_manager(request)

    if not enabled and getattr(agent_ref, "enabled", True):
        await manager.stop_agent(agentId)

    agent_ref.enabled = enabled
    save_config(config)

    if enabled:
        try:
            await manager.get_agent(agentId)
            logger.info(f"Agent {agentId} started successfully")
        except Exception as e:
            logger.error(f"Failed to start agent {agentId}: {e}")
            raise HTTPException(
                status_code=500,
                detail=f"Agent enabled but failed to start: {str(e)}",
            ) from e

    return {
        "success": True,
        "agent_id": agentId,
        "enabled": enabled,
    }


@router.get(
    "/{agentId}/files",
    response_model=list[MdFileInfo],
    summary="List agent workspace files",
    description="List all markdown files in agent's workspace",
)
async def list_agent_files(
    request: Request,
    agentId: str = PathParam(...),
) -> list[MdFileInfo]:
    """List agent workspace files."""
    manager = _get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    workspace_manager = AgentMdManager(str(workspace.workspace_dir))

    try:
        files = [
            MdFileInfo.model_validate(file)
            for file in workspace_manager.list_working_mds()
        ]
        return files
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/{agentId}/files/{filename}",
    response_model=MdFileContent,
    summary="Read agent workspace file",
    description="Read a markdown file from agent's workspace",
)
async def read_agent_file(
    request: Request,
    agentId: str = PathParam(...),
    filename: str = PathParam(...),
) -> MdFileContent:
    """Read agent workspace file."""
    manager = _get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    workspace_manager = AgentMdManager(str(workspace.workspace_dir))

    try:
        content = workspace_manager.read_working_md(filename)
        return MdFileContent(content=content)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail=f"File '{filename}' not found",
        ) from exc
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put(
    "/{agentId}/files/{filename}",
    response_model=dict,
    summary="Write agent workspace file",
    description="Create or update a markdown file in agent's workspace",
)
async def write_agent_file(
    request: Request,
    agentId: str = PathParam(...),
    filename: str = PathParam(...),
    file_content: MdFileContent = Body(...),
) -> dict:
    """Write agent workspace file."""
    manager = _get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    workspace_manager = AgentMdManager(str(workspace.workspace_dir))

    try:
        workspace_manager.write_working_md(filename, file_content.content)
        return {"written": True, "filename": filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/{agentId}/memory",
    response_model=list[MdFileInfo],
    summary="List agent memory files",
    description="List all memory files for an agent",
)
async def list_agent_memory(
    request: Request,
    agentId: str = PathParam(...),
) -> list[MdFileInfo]:
    """List agent memory files."""
    manager = _get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    workspace_manager = AgentMdManager(str(workspace.workspace_dir))

    try:
        files = [
            MdFileInfo.model_validate(file)
            for file in workspace_manager.list_memory_mds()
        ]
        return files
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/{agentId}/projects/{projectId}/files",
    response_model=list[ProjectFileInfo],
    summary="List project files",
    description="List files under a project directory",
)
async def list_agent_project_files(
    request: Request,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> list[ProjectFileInfo]:
    """List files under a project."""
    manager = _get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        project_dir = _resolve_project_dir(
            Path(workspace.workspace_dir), projectId
        )
        return _list_project_files(project_dir)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/{agentId}/projects",
    response_model=ProjectSummary,
    summary="Create project",
    description="Create a new project directory and initialize PROJECT metadata",
)
async def create_agent_project(
    request: Request,
    body: CreateProjectRequest = Body(...),
    agentId: str = PathParam(...),
) -> ProjectSummary:
    """Create a project under the given agent workspace."""
    manager = _get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        return _create_project(Path(workspace.workspace_dir), body)
    except FileExistsError as e:
        raise HTTPException(
            status_code=409, detail=f"Project already exists: {e}"
        ) from e
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/{agentId}/projects/{projectId}/artifact-profile",
    response_model=ProjectArtifactProfile,
    summary="Get project artifact profile",
    description="Get project unified artifact profile for skills/scripts/flows/cases",
)
async def get_project_artifact_profile(
    request: Request,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> ProjectArtifactProfile:
    """Get project unified artifact profile."""
    manager = _get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        return _get_project_artifact_profile(
            Path(workspace.workspace_dir),
            projectId,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put(
    "/{agentId}/projects/{projectId}/artifact-profile",
    response_model=ProjectSummary,
    summary="Update project artifact profile",
    description="Update project unified artifact profile in PROJECT metadata",
)
async def update_project_artifact_profile(
    request: Request,
    body: ProjectArtifactProfile = Body(...),
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> ProjectSummary:
    """Update project unified artifact profile."""
    manager = _get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        return _update_project_artifact_profile(
            Path(workspace.workspace_dir),
            projectId,
            body,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put(
    "/{agentId}/projects/{projectId}/artifact-distill-mode",
    response_model=ProjectSummary,
    summary="Update project artifact distill mode",
    description="Set project artifact distill mode for subsequent draft actions",
)
async def update_project_artifact_distill_mode(
    request: Request,
    body: UpdateProjectArtifactDistillModeRequest = Body(...),
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> ProjectSummary:
    """Update project artifact distill mode."""
    manager = _get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        return _update_project_artifact_distill_mode(
            Path(workspace.workspace_dir),
            projectId,
            body.artifact_distill_mode,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put(
    "/{agentId}/projects/{projectId}/workspace-chat-binding",
    response_model=ProjectSummary,
    summary="Update preferred project workspace chat binding",
    description="Persist preferred workspace chat id in project metadata",
)
async def update_project_workspace_chat_binding(
    request: Request,
    body: UpdateProjectWorkspaceChatBindingRequest = Body(...),
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> ProjectSummary:
    """Update preferred workspace chat id for a project."""
    manager = _get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        return _update_project_workspace_chat_binding(
            Path(workspace.workspace_dir),
            projectId,
            body.preferred_workspace_chat_id,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/{agentId}/projects/{projectId}/artifacts/skills/distill-draft",
    response_model=DistillProjectSkillsDraftResponse,
    summary="Auto-distill project skills as draft",
    description=(
        "Scan project skills markdown files and append missing skill artifacts "
        "with draft status"
    ),
)
async def auto_distill_project_skills_draft(
    request: Request,
    body: DistillProjectSkillsDraftRequest = Body(
        default_factory=DistillProjectSkillsDraftRequest,
    ),
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> DistillProjectSkillsDraftResponse:
    """Auto-distill project skill artifacts as draft entries."""
    manager = _get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        return _auto_distill_project_skills_to_draft(
            Path(workspace.workspace_dir),
            projectId,
            run_id=body.run_id,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/{agentId}/projects/{projectId}/artifacts/skills/{artifactId}/confirm-stable",
    response_model=ConfirmProjectSkillStableResponse,
    summary="Confirm one project skill as stable",
    description="Set one project skill artifact status to stable",
)
async def confirm_project_skill_stable(
    request: Request,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
    artifactId: str = PathParam(...),
) -> ConfirmProjectSkillStableResponse:
    """Mark one project skill artifact as stable by explicit confirmation."""
    manager = _get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        return _confirm_project_skill_stable(
            Path(workspace.workspace_dir),
            projectId,
            artifactId,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/{agentId}/projects/{projectId}/artifacts/skills/{artifactId}/promote",
    response_model=PromoteProjectArtifactResponse,
    summary="Promote project skill to agent",
    description=(
        "Promote one project skill artifact into agent-level skills directory"
    ),
)
async def promote_project_skill_artifact(
    request: Request,
    body: PromoteProjectArtifactRequest = Body(
        default_factory=PromoteProjectArtifactRequest,
    ),
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
    artifactId: str = PathParam(...),
) -> PromoteProjectArtifactResponse:
    """Promote project skill artifact to agent-level skill."""
    manager = _get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        result = _promote_project_skill_to_agent(
            Path(workspace.workspace_dir),
            projectId,
            artifactId,
            body,
        )
        if body.enable:
            schedule_agent_reload(request, agentId)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/{agentId}/projects/{projectId}/clone",
    response_model=ProjectSummary,
    summary="Clone project",
    description="Clone one project directory and rewrite PROJECT metadata for the new project",
)
async def clone_agent_project(
    request: Request,
    body: CloneProjectRequest = Body(default_factory=CloneProjectRequest),
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> ProjectSummary:
    """Clone a project under the same agent workspace."""
    manager = _get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        return _clone_project(Path(workspace.workspace_dir), projectId, body)
    except FileExistsError as e:
        raise HTTPException(
            status_code=409, detail=f"Target project already exists: {e}"
        ) from e
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete(
    "/{agentId}/projects/{projectId}",
    response_model=DeleteProjectResponse,
    summary="Delete project",
    description="Delete one project directory and all files under it",
)
async def delete_agent_project(
    request: Request,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> DeleteProjectResponse:
    """Delete a project under the given agent workspace."""
    manager = _get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        return _delete_project(Path(workspace.workspace_dir), projectId)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/{agentId}/projects/{projectId}/files/{filePath:path}",
    response_model=ProjectFileContent,
    summary="Read project file",
    description="Read text content from a project file",
)
async def read_agent_project_file(
    request: Request,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
    filePath: str = PathParam(...),
) -> ProjectFileContent:
    """Read text content from a project file."""
    manager = _get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        project_dir = _resolve_project_dir(
            Path(workspace.workspace_dir), projectId
        )
        content = _read_project_text_file(project_dir, filePath)
        return ProjectFileContent(content=content)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/{agentId}/projects/{projectId}/files/upload",
    response_model=ProjectFileInfo,
    summary="Upload project file",
    description="Upload a file into project original directory or a safe subdirectory",
)
async def upload_agent_project_file(
    request: Request,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
    file: UploadFile = File(...),
    target_dir: str = Form("original"),
) -> ProjectFileInfo:
    """Upload a file into project workspace."""
    manager = _get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        project_dir = _resolve_project_dir(
            Path(workspace.workspace_dir), projectId
        )
        return _upload_project_file(project_dir, file, target_dir)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


def _ensure_default_heartbeat_md(workspace_dir: Path, language: str) -> None:
    """Write a default HEARTBEAT.md when the workspace has none."""
    heartbeat_file = workspace_dir / "HEARTBEAT.md"
    if heartbeat_file.exists():
        return

    default_heartbeat_mds = {
        "zh": """# Heartbeat checklist
- 扫描收件箱紧急邮件
- 查看未来 2h 的日历
- 检查待办是否卡住
- 若安静超过 8h，轻量 check-in
""",
        "en": """# Heartbeat checklist
- Scan inbox for urgent email
- Check calendar for next 2h
- Check tasks for blockers
- Light check-in if quiet for 8h
""",
        "ru": """# Heartbeat checklist
- Проверить входящие на срочные письма
- Просмотреть календарь на ближайшие 2 часа
- Проверить задачи на наличие блокировок
- Лёгкая проверка при отсутствии активности более 8 часов
""",
    }
    heartbeat_content = default_heartbeat_mds.get(
        language,
        default_heartbeat_mds["en"],
    )
    with open(heartbeat_file, "w", encoding="utf-8") as file:
        file.write(heartbeat_content.strip())


def _copy_builtin_skills(workspace_dir: Path) -> None:
    """Copy builtin skills into a new workspace when missing."""
    builtin_skills_dir = (
        Path(__file__).parent.parent.parent / "agents" / "skills"
    )
    if not builtin_skills_dir.exists():
        return

    target_skills_dir = get_workspace_skills_dir(workspace_dir)
    target_skills_dir.mkdir(parents=True, exist_ok=True)

    for skill_dir in builtin_skills_dir.iterdir():
        if not skill_dir.is_dir() or not (skill_dir / "SKILL.md").exists():
            continue
        target_skill_dir = target_skills_dir / skill_dir.name
        if target_skill_dir.exists():
            continue
        try:
            shutil.copytree(skill_dir, target_skill_dir)
        except Exception as e:
            logger.warning("Failed to copy skill %s: %s", skill_dir.name, e)


def _install_initial_skills(
    workspace_dir: Path,
    skill_names: list[str] | None,
) -> None:
    """Install requested initial skills from the skill pool."""
    if not skill_names:
        return

    pool_service = SkillPoolService()
    for skill_name in skill_names:
        try:
            result = pool_service.download_to_workspace(
                skill_name=skill_name,
                workspace_dir=workspace_dir,
                overwrite=False,
            )
            if result.get("success"):
                continue
            logger.warning(
                "Failed to install initial skill %s for %s: %s",
                skill_name,
                workspace_dir,
                result.get("reason", "unknown"),
            )
        except Exception as e:
            logger.warning(
                "Failed to install initial skill %s for %s: %s",
                skill_name,
                workspace_dir,
                e,
            )


def _initialize_agent_workspace(
    workspace_dir: Path,
    skill_names: list[str] | None = None,
    builtin_qa_md_seed: bool = False,
) -> None:
    """Initialize agent workspace (similar to copaw init --defaults)."""
    from ...config import load_config as load_global_config

    (workspace_dir / "sessions").mkdir(exist_ok=True)
    (workspace_dir / "memory").mkdir(exist_ok=True)
    (workspace_dir / "skills").mkdir(exist_ok=True)
    (workspace_dir / "active_skills").mkdir(exist_ok=True)
    (workspace_dir / "customized_skills").mkdir(exist_ok=True)
    _ensure_projects_layout(workspace_dir)
    get_workspace_skills_dir(workspace_dir).mkdir(exist_ok=True)

    config = load_global_config()
    language = config.agents.language or "zh"

    _seed_workspace_md_files(
        workspace_dir,
        language,
        builtin_qa_md_seed=builtin_qa_md_seed,
    )
    _ensure_heartbeat_file(workspace_dir, language)
    _copy_builtin_skills(workspace_dir)
    _install_initial_skills(workspace_dir, skill_names)

    jobs_file = workspace_dir / "jobs.json"
    if not jobs_file.exists():
        with open(jobs_file, "w", encoding="utf-8") as file:
            json.dump(
                {"version": 1, "jobs": []},
                file,
                ensure_ascii=False,
                indent=2,
            )

    chats_file = workspace_dir / "chats.json"
    if not chats_file.exists():
        with open(chats_file, "w", encoding="utf-8") as file:
            json.dump(
                {"version": 1, "chats": []},
                file,
                ensure_ascii=False,
                indent=2,
            )
