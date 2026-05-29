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
from typing import Any, Literal, NoReturn, cast
from urllib.parse import unquote, urlparse
from fastapi import (
    APIRouter,
    Body,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from fastapi import Path as PathParam
from pydantic import BaseModel, Field, field_validator
from starlette.responses import FileResponse

from agentscope_runtime.engine.schemas.exception import (
    AppBaseException,
)

from ...agents.utils.file_handling import read_text_file_with_encoding_fallback
from ...agents.skill_system.hub import install_skill_from_hub
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
    sanitize_agent_id,
    validate_agent_id,
)
from ...config.utils import load_config, save_config
from ...agents.memory.agent_md_manager import AgentMdManager
from ...agents.utils import (
    copy_builtin_agent_md_files,
    copy_builtin_qa_md_files,
    copy_md_files,
)
from ...agents.skills_manager import SkillPoolService, get_workspace_skills_dir
from ..multi_agent_manager import MultiAgentManager
from ...constant import WORKING_DIR
from copaw.knowledge.project_pipeline_manager import (
    DEFAULT_PROJECT_PIPELINE_COOLDOWN_SECONDS,
    DEFAULT_PROJECT_PIPELINE_DEBOUNCE_SECONDS,
    ProjectKnowledgePipelineManager,
    build_project_source_spec,
    ensure_project_source_registered,
)
from ..knowledge_workflow_steps import _load_builtin_pipeline_doc
from ..project_monitoring_state import (
    PROJECT_FILE_MONITORING_ACTIVE,
    PROJECT_FILE_MONITORING_IDLE,
    acquire_project_watch_lease,
    normalize_project_file_monitoring_state,
    read_project_metadata_with_body,
    release_project_watch_lease,
    update_project_file_monitoring_state,
    write_project_metadata,
)
from ..project_realtime_events import (
    collect_recent_project_updates,
    record_project_realtime_paths,
)
from ..project_file_query import (
    extension_of_path,
    query_project_file_records,
    scan_project_file_records,
)
from copaw.app.routers import project_file_services as copaw_project_file_services
from copaw.app.routers import project_file_query_services as copaw_project_file_query_services
from copaw.app.routers import project_file_ops as copaw_project_file_ops
from copaw.app.routers import project_artifact_normalization_services as copaw_project_artifact_normalization_services
from copaw.app.routers import project_artifact_workflow_services as copaw_project_artifact_workflow_services
from copaw.app.routers import project_scaffold_services as copaw_project_scaffold_services
from copaw.app.routers import project_lifecycle_services as copaw_project_lifecycle_services
from copaw.app.routers import project_metadata_services as copaw_project_metadata_services
from copaw.app.routers import project_summary_services as copaw_project_summary_services
from copaw.app.routers import project_watch_artifact_services as copaw_project_watch_artifact_services

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["agents"])

_PROJECT_TEMPLATES_DIR = (
    Path(__file__).resolve().parents[1] / "project_templates"
)

_PROJECT_TEMPLATE_PATH_ALIASES = {
    "project/.scripts/README.md": "project/scripts/README.md",
    "project/.pipelines/templates/README.md": "project/pipelines/templates/README.md",
    "project/.pipelines/runs/README.md": "project/pipelines/runs/README.md",
    "project/.skills/project-artifact-governor/SKILL.md": "project/skills/project-artifact-governor/SKILL.md",
}

_DEFAULT_PROJECT_TEMPLATES = {
    "projects/README.md": "# Projects\n\n"
    "Store one project per subdirectory, for example:\n\n"
    "- project-abcde123/\n"
    "  - .agent/PROJECT.md\n"
    "  - output/\n\n"
    "The project metadata should be declared in .agent/PROJECT.md frontmatter:\n\n"
    "---\n"
    "id: project-abcde123\n"
    "name: Example project\n"
    "description: Short summary\n"
    "status: active\n"
    "workspacePath: /absolute/path/to/projects/project-abcde123\n"
    "data_dir: output\n"
    "tags: [demo, draft]\n"
    "artifact_profile:\n"
    "    skills: []\n"
    "    scripts: []\n"
    "    flows: []\n"
    "    cases: []\n"
    "---\n\n"
    "Project details go below.\n",
    "project/AGENTS.md": "# Project Collaboration Rules\n\n"
    "Before resolving any file, read `.agent/PROJECT.md` frontmatter to get\n"
    "`workspacePath` (absolute path to project root) and `data_dir` (data subdirectory).\n\n"
    "## Path Resolution\n\n"
    "- Workspace root: value of `workspacePath` in `.agent/PROJECT.md` frontmatter.\n"
    "- Resolve all files relative to workspace root unless an absolute path is given.\n"
    "- Data artifacts live in `{{DATA_DIR}}/`; remap `original/` → `{{DATA_DIR}}/` once on miss.\n"
    "- Save new user-facing files in workspace root by default; use subdirectories only when explicitly requested.\n\n"
    "## File Priorities\n\n"
    "- Prefer exact file reads over broad directory scans.\n"
    "- Check `.agent/PLAN.md` for current milestones and next actions.\n"
    "- Detailed distillation rules are in `.skills/project-artifact-governor/SKILL.md`.\n\n"
    "## Artifact Mapping\n\n"
    "- `.scripts/*.py` → builtin\n"
    "- `.pipelines/templates/*.json` → builtin\n"
    "- `{{DATA_DIR}}/*`, `.pipelines/runs/*` → builtin\n"
    "- Distilled method/checklist from repeated evidence → skill\n",
    "project/.scripts/README.md": "# .scripts directory\n\n"
    "Purpose: builtin executable scripts for project pipelines.\n\n"
    "## Mapping to artifact kind\n"
    "- .scripts/*.py are builtin project files.\n",
    "project/.pipelines/templates/README.md": "# .pipelines/templates directory\n\n"
    "Purpose: reusable flow templates.\n\n"
    "## Mapping to artifact kind\n"
    "- .pipelines/templates/*.json are builtin project files.\n",
    "project/.pipelines/runs/README.md": "# .pipelines/runs directory\n\n"
    "Purpose: run instances, manifests, and evidence.\n\n"
    "## Mapping to artifact kind\n"
    "- Run outputs are stored as builtin project files.\n",
    "project/.skills/project-artifact-governor/SKILL.md": "---\n"
    "name: project-artifact-governor\n"
    "description: Enforce project path resolution and four-artifact governance for this project workspace.\n"
    "---\n\n"
    "# project-artifact-governor\n\n"
    "## Procedure\n"
    "1. Confirm workspace root.\n"
    "2. Resolve each file via absolute path first.\n"
    "3. Save new user-facing files in the project root unless the user explicitly requests a subdirectory.\n"
    "4. If path uses original/, remap to {{DATA_DIR}}/ and retry once.\n"
    "5. Classify outputs by directory + intent.\n"
    "6. Generate concise structured result.\n\n"
    "## Classification Rules\n"
    "- .scripts/*.py => builtin\n"
    "- .pipelines/templates/*.json => builtin\n"
    "- {{DATA_DIR}}/* or .pipelines/runs/* outputs => builtin\n"
    "- reusable method/checklist distilled from repeated evidence => skill\n",
}


class AgentSummary(BaseModel):
    """Agent summary information."""

    id: str
    name: str
    description: str
    workspace_dir: str
    enabled: bool = True
    is_builtin: bool = False
    builtin_kind: str = ""
    builtin_label: str = ""
    system_protected: bool = False
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
    project_auto_knowledge_sink: bool = True
    project_agent_knowledge_registered: bool = False
    file_monitoring_state: str = PROJECT_FILE_MONITORING_ACTIVE
    preferred_workspace_chat_id: str = ""
    created_time: str
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
    """Request model for creating a new agent.

    The ``id`` field is optional.  When provided the server uses it as
    the agent identifier (after sanitization); when omitted a random
    short UUID is generated automatically.
    """

    id: str | None = None
    name: str
    description: str = ""
    workspace_dir: str | None = None
    language: str = "en"
    skill_names: list[str] | None = None

    @field_validator("id", mode="before")
    @classmethod
    def sanitize_id(cls, value: str | None) -> str | None:
        """Strip whitespace from the custom ID."""
        if value is None:
            return None
        if isinstance(value, str):
            sanitized = sanitize_agent_id(value)
            return sanitized if sanitized else None
        return value

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


class ProjectFileTreeNode(BaseModel):
    """Single shallow file-tree node under a project directory."""

    filename: str
    path: str
    size: int
    modified_time: str
    is_directory: bool = False
    child_count: int = 0
    descendant_file_count: int = 0
    direct_file_count: int = 0
    has_child_directories: bool = False


class ProjectFileSummary(BaseModel):
    """Aggregated project file counts for lightweight overview rendering."""

    total_files: int
    builtin_files: int
    visible_files: int
    original_files: int
    intermediate_files: int = 0
    artifact_files: int = 0
    derived_files: int
    knowledge_candidate_files: int
    markdown_files: int
    text_files: int = 0
    script_files: int = 0
    other_type_files: int = 0
    text_like_files: int
    agent_files: int = 0
    skill_files: int = 0
    flow_files: int = 0
    case_files: int = 0
    recently_updated_files: int
    recent_updates: list[ProjectFileInfo] = Field(default_factory=list)


class ProjectFileQueryRequest(BaseModel):
    """Request body for querying project files with unified filters."""

    search: str = ""
    path_prefix: str = ""
    stages: list[Literal["original", "intermediate", "artifact", "builtin", "other"]] = Field(default_factory=list)
    content_types: list[Literal["markdown", "text", "script", "other"]] = Field(default_factory=list)
    include_builtin: bool | None = None
    include_ignored: bool = False
    size_min: int | None = None
    size_max: int | None = None
    modified_after: str | None = None
    modified_before: str | None = None
    sort_by: Literal["path", "modified_time", "size"] = "path"
    sort_order: Literal["asc", "desc"] = "asc"
    offset: int = 0
    limit: int = 200


class ProjectFileQuerySummary(BaseModel):
    """Summary for filtered project file query results."""

    total_matched: int
    offset: int
    limit: int
    returned: int
    builtin_count: int
    ignored_count: int
    stage_counts: dict[str, int] = Field(default_factory=dict)
    content_type_counts: dict[str, int] = Field(default_factory=dict)


class ProjectFileQueryMeta(BaseModel):
    """Normalized query metadata for observability and debugging."""

    search: str
    path_prefix: str
    stages: list[str] = Field(default_factory=list)
    content_types: list[str] = Field(default_factory=list)
    include_builtin: bool | None = None
    include_ignored: bool = False
    sort_by: str = "path"
    sort_order: str = "asc"


class ProjectFileQueryItem(ProjectFileInfo):
    """Extended project file row returned by unified query API."""

    stage: str
    content_type: str
    builtin: bool = False
    ignored: bool = False


class ProjectFileQueryResponse(BaseModel):
    """Unified project file query response."""

    items: list[ProjectFileQueryItem] = Field(default_factory=list)
    summary: ProjectFileQuerySummary
    query_meta: ProjectFileQueryMeta


class ProjectFileMetadataRequest(BaseModel):
    """Request body for fetching project file metadata by relative path."""

    paths: list[str] = Field(default_factory=list)


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
    data_dir: str = "output"
    tags: list[str] = Field(default_factory=list)
    artifact_distill_mode: str = "file_scan"
    project_auto_knowledge_sink: bool = True
    project_agent_knowledge_registered: bool = False
    artifact_profile: ProjectArtifactProfile = Field(
        default_factory=lambda: ProjectArtifactProfile(),
    )


class UpdateProjectArtifactDistillModeRequest(BaseModel):
    """Request body for updating project artifact distill mode."""

    artifact_distill_mode: str = "file_scan"


class UpdateProjectWorkspaceChatBindingRequest(BaseModel):
    """Request body for updating preferred project workspace chat binding."""

    preferred_workspace_chat_id: str = ""


class UpdateProjectKnowledgeSinkRequest(BaseModel):
    """Request body for updating project auto knowledge sink switch."""

    project_auto_knowledge_sink: bool = True


class UpdateProjectKnowledgeRegistrationRequest(BaseModel):
    """Request body for updating project knowledge registration switch."""

    project_agent_knowledge_registered: bool = False


class AcquireProjectKnowledgeWatchLeaseResponse(BaseModel):
    """Response body for acquiring a project knowledge watch lease."""

    lease_id: str
    active_count: int = 0
    file_monitoring_state: str = PROJECT_FILE_MONITORING_IDLE
    acquired_at: str = ""


class ReleaseProjectKnowledgeWatchLeaseResponse(BaseModel):
    """Response body for releasing a project knowledge watch lease."""

    lease_id: str
    released: bool = False
    active_count: int = 0
    file_monitoring_state: str = PROJECT_FILE_MONITORING_IDLE
    updated_at: str = ""


class DeleteProjectResponse(BaseModel):
    """Response body for deleting a project."""

    success: bool
    project_id: str


class DeleteProjectPathResponse(BaseModel):
    """Response body for deleting one project file or directory."""

    success: bool
    path: str
    is_directory: bool


class CreateProjectDirectoryRequest(BaseModel):
    """Request body for creating a project directory."""

    path: str


class CreateProjectDirectoryResponse(BaseModel):
    """Response body for creating a project directory."""

    success: bool
    path: str
    existed: bool = False


class MoveProjectPathRequest(BaseModel):
    """Request body for moving/renaming one project path."""

    source_path: str
    target_path: str
    conflict_strategy: Literal["fail_if_exists", "overwrite"] = "fail_if_exists"


class MoveProjectPathResponse(BaseModel):
    """Response body for moving/renaming one project path."""

    success: bool
    source_path: str
    target_path: str
    is_directory: bool


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
_PROJECT_AGENT_CONFIG_DIR = ".agent"
_PROJECT_METADATA_RELATIVE_PATHS = (
    ".agent/PROJECT.md",
    ".agent/project.md",
    "PROJECT.md",
    "project.md",
)
_PROJECT_ARTIFACT_DIR_BY_KIND = {
    "skill": ".skills",
    "script": ".scripts",
    "flow": "artifacts/flow",
    "case": "artifacts/case",
}
_PROJECT_PRECREATED_ARTIFACT_DIRS = (
    ".skills",
    ".scripts",
)
_PROJECT_MANAGED_VISIBLE_HIDDEN_DIRS = {
    ".agent",
    ".memories",
    ".skills",
    ".scripts",
    ".pipelines",
}
_PROJECT_TREE_IGNORED_NAMES = {
    ".git",
    "__pycache__",
}
_PROJECT_IGNORED_FILE_NAMES = {
    ".ds_store",
    ".gitkeep",
    "thumbs.db",
}
_PROJECT_MARKDOWN_EXTENSIONS = {"md", "mdx"}
_PROJECT_TEXT_FILE_EXTENSIONS = {
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
_PROJECT_SCRIPT_EXTENSIONS = {"py"}
_PROJECT_KNOWLEDGE_EXTENSIONS = (
    _PROJECT_MARKDOWN_EXTENSIONS
    | _PROJECT_TEXT_FILE_EXTENSIONS
    | _PROJECT_SCRIPT_EXTENSIONS
    | {"pdf", "doc", "docx"}
)
_PROJECT_TEXT_LIKE_EXTENSIONS = (
    _PROJECT_MARKDOWN_EXTENSIONS
    | _PROJECT_TEXT_FILE_EXTENSIONS
    | _PROJECT_SCRIPT_EXTENSIONS
)
_PROJECT_ARTIFACT_DISTILL_MODES = {
    "file_scan",
    "conversation_evidence",
}


def _normalize_project_artifact_distill_mode(raw_value: Any) -> str:
    return copaw_project_artifact_normalization_services.normalize_project_artifact_distill_mode(
        raw_value,
        artifact_distill_modes=_PROJECT_ARTIFACT_DISTILL_MODES,
    )


def _normalize_project_auto_knowledge_sink(raw_value: Any) -> bool:
    return copaw_project_artifact_normalization_services.normalize_project_auto_knowledge_sink(
        raw_value,
    )


def _normalize_project_agent_knowledge_registered(raw_value: Any) -> bool:
    return copaw_project_artifact_normalization_services.normalize_project_agent_knowledge_registered(
        raw_value,
    )


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
    return copaw_project_scaffold_services.parse_markdown_frontmatter(path)


def _format_iso_time(ts: float) -> str:
    return datetime.fromtimestamp(ts).isoformat(timespec="seconds")


def _normalize_project_created_time(raw_value: Any) -> str:
    return copaw_project_artifact_normalization_services.normalize_project_created_time(
        raw_value,
    )


def _resolve_project_created_time(
    metadata: dict[str, Any], metadata_file: Path
) -> str:
    return copaw_project_artifact_normalization_services.resolve_project_created_time(
        metadata,
        metadata_file,
        normalize_project_created_time=_normalize_project_created_time,
        format_iso_time=_format_iso_time,
    )


def _safe_project_data_subdir(raw_value: str) -> str:
    return copaw_project_artifact_normalization_services.safe_project_data_subdir(
        raw_value,
    )


def _parse_project_tags(raw_tags: Any) -> list[str]:
    return copaw_project_artifact_normalization_services.parse_project_tags(
        raw_tags,
    )


def _safe_artifact_slug(raw_value: str, fallback: str) -> str:
    return copaw_project_artifact_normalization_services.safe_artifact_slug(
        raw_value,
        fallback,
        slugify=_slugify,
    )


def _build_project_artifact_file_path(
    kind: str,
    artifact_id: str,
    version: str,
) -> str:
    return copaw_project_artifact_normalization_services.build_project_artifact_file_path(
        kind,
        artifact_id,
        version,
        project_artifact_dir_by_kind=_PROJECT_ARTIFACT_DIR_BY_KIND,
        safe_artifact_slug=_safe_artifact_slug,
    )


def _parse_project_artifact_version_history(
    raw_value: Any,
) -> list[dict[str, str]]:
    return copaw_project_artifact_normalization_services.parse_project_artifact_version_history(
        raw_value,
    )


def _normalize_project_artifact_storage(
    item: ProjectArtifactItem,
    kind: str,
) -> ProjectArtifactItem:
    return cast(
        ProjectArtifactItem,
        copaw_project_artifact_normalization_services.normalize_project_artifact_storage(
            item,
            kind,
            build_project_artifact_file_path=_build_project_artifact_file_path,
            parse_project_artifact_version_history=_parse_project_artifact_version_history,
        ),
    )


def _normalize_project_artifact_profile_storage(
    profile: ProjectArtifactProfile,
) -> ProjectArtifactProfile:
    return cast(
        ProjectArtifactProfile,
        copaw_project_artifact_normalization_services.normalize_project_artifact_profile_storage(
            profile,
            normalize_project_artifact_storage=_normalize_project_artifact_storage,
            project_artifact_profile_factory=ProjectArtifactProfile,
        ),
    )


def _ensure_project_artifact_layout(project_dir: Path) -> None:
    copaw_project_artifact_normalization_services.ensure_project_artifact_layout(
        project_dir,
        project_precreated_artifact_dirs=_PROJECT_PRECREATED_ARTIFACT_DIRS,
    )


def _normalize_project_artifact_item(
    raw_item: Any,
    kind: str,
) -> ProjectArtifactItem | None:
    return cast(
        ProjectArtifactItem | None,
        copaw_project_artifact_normalization_services.normalize_project_artifact_item(
            raw_item,
            kind,
            project_artifact_item_factory=ProjectArtifactItem,
            parse_project_artifact_version_history=_parse_project_artifact_version_history,
            parse_project_tags=_parse_project_tags,
            normalize_project_artifact_storage=_normalize_project_artifact_storage,
        ),
    )


def _parse_project_artifact_list(
    raw_value: Any,
    kind: str,
) -> list[ProjectArtifactItem]:
    return cast(
        list[ProjectArtifactItem],
        copaw_project_artifact_normalization_services.parse_project_artifact_list(
            raw_value,
            kind,
            normalize_project_artifact_item=_normalize_project_artifact_item,
        ),
    )


def _parse_project_artifact_profile(
    metadata: dict[str, Any],
) -> ProjectArtifactProfile:
    return cast(
        ProjectArtifactProfile,
        copaw_project_artifact_normalization_services.parse_project_artifact_profile(
            metadata,
            parse_project_artifact_list=_parse_project_artifact_list,
            project_artifact_profile_factory=ProjectArtifactProfile,
        ),
    )


def _first_nonempty_line(text: str) -> str:
    return copaw_project_summary_services.first_nonempty_line(text)


def _has_hidden_directory_segment(
    rel_path: str,
    *,
    assume_last_segment_is_dir: bool = False,
    allow_managed_hidden_dirs: bool = False,
) -> bool:
    return copaw_project_file_query_services.has_hidden_directory_segment(
        rel_path,
        assume_last_segment_is_dir=assume_last_segment_is_dir,
        allow_managed_hidden_dirs=allow_managed_hidden_dirs,
        project_managed_visible_hidden_dirs=_PROJECT_MANAGED_VISIBLE_HIDDEN_DIRS,
    )


def _iter_project_metadata_files(project_dir: Path):
    yield from copaw_project_scaffold_services.iter_project_metadata_files(
        project_dir=project_dir,
        project_metadata_relative_paths=_PROJECT_METADATA_RELATIVE_PATHS,
    )


def _default_project_metadata_file(project_dir: Path) -> Path:
    return copaw_project_scaffold_services.default_project_metadata_file(
        project_dir=project_dir,
        project_metadata_relative_paths=_PROJECT_METADATA_RELATIVE_PATHS,
    )


def _load_project_summary(project_dir: Path) -> ProjectSummary | None:
    return cast(
        ProjectSummary | None,
        copaw_project_summary_services.load_project_summary(
            project_dir=project_dir,
            read_project_metadata_with_body=read_project_metadata_with_body,
            safe_project_data_subdir=_safe_project_data_subdir,
            first_nonempty_line=_first_nonempty_line,
            parse_project_tags=_parse_project_tags,
            normalize_project_artifact_distill_mode=_normalize_project_artifact_distill_mode,
            parse_project_artifact_profile=_parse_project_artifact_profile,
            normalize_project_auto_knowledge_sink=_normalize_project_auto_knowledge_sink,
            normalize_project_agent_knowledge_registered=_normalize_project_agent_knowledge_registered,
            normalize_project_file_monitoring_state=normalize_project_file_monitoring_state,
            resolve_project_created_time=_resolve_project_created_time,
            format_iso_time=_format_iso_time,
            project_summary_factory=ProjectSummary,
        ),
    )


def _list_agent_projects(workspace_dir: Path) -> list[ProjectSummary]:
    return cast(
        list[ProjectSummary],
        copaw_project_summary_services.list_agent_projects(
            workspace_dir=workspace_dir,
            projects_dirname=_PROJECTS_DIRNAME,
            load_project_summary=_load_project_summary,
        ),
    )


def _ensure_projects_layout(workspace_dir: Path) -> None:
    copaw_project_summary_services.ensure_projects_layout(
        workspace_dir=workspace_dir,
        projects_dirname=_PROJECTS_DIRNAME,
        load_project_template_text=_load_project_template_text,
    )


def _load_project_template_text(
    relative_path: str,
    replacements: dict[str, str] | None = None,
) -> str:
    return copaw_project_scaffold_services.load_project_template_text(
        relative_path=relative_path,
        replacements=replacements,
        project_template_path_aliases=_PROJECT_TEMPLATE_PATH_ALIASES,
        project_templates_dir=_PROJECT_TEMPLATES_DIR,
        default_project_templates=_DEFAULT_PROJECT_TEMPLATES,
        logger=logger,
    )


def _scaffold_project_governance_files(
    project_dir: Path,
    data_subdir: str,
) -> None:
    copaw_project_scaffold_services.scaffold_project_governance_files(
        project_dir=project_dir,
        data_subdir=data_subdir,
        project_agent_config_dir=_PROJECT_AGENT_CONFIG_DIR,
        load_project_template_text=_load_project_template_text,
    )


def _copy_builtin_pipeline_template_to_project(project_dir: Path) -> None:
    """Copy the authoritative builtin knowledge-processing pipeline JSON to
    the project's .pipelines/templates/ directory at project creation time.

    Idempotent: skips the copy when the file already exists with the same
    version; overwrites silently when the bundled version is newer.
    """
    copaw_project_scaffold_services.copy_builtin_pipeline_template_to_project(
        project_dir=project_dir,
        load_builtin_pipeline_doc=_load_builtin_pipeline_doc,
    )


def _resolve_project_dir(workspace_dir: Path, project_id: str) -> Path:
    return copaw_project_scaffold_services.resolve_project_dir(
        workspace_dir=workspace_dir,
        project_id=project_id,
        projects_dirname=_PROJECTS_DIRNAME,
        load_project_summary=_load_project_summary,
        http_exception_factory=HTTPException,
    )


def _resolve_agent_workspace_dir(agent_id: str) -> Path:
    """Resolve agent workspace directory without starting the runtime."""
    config = load_config()
    agent_ref = config.agents.profiles.get(agent_id)
    if agent_ref is None:
        raise HTTPException(
            status_code=404,
            detail=f"Agent '{agent_id}' not found",
        )
    if not getattr(agent_ref, "enabled", True):
        raise HTTPException(
            status_code=403,
            detail=f"Agent '{agent_id}' is disabled",
        )
    return Path(agent_ref.workspace_dir).expanduser()


def _read_project_frontmatter_with_body(
    metadata_file: Path,
) -> tuple[dict[str, Any], str]:
    return copaw_project_scaffold_services.read_project_frontmatter_with_body(
        metadata_file=metadata_file,
        read_project_metadata_with_body=read_project_metadata_with_body,
    )


def _get_project_artifact_profile(
    workspace_dir: Path,
    project_id: str,
) -> ProjectArtifactProfile:
    return cast(
        ProjectArtifactProfile,
        copaw_project_metadata_services.get_project_artifact_profile(
            workspace_dir=workspace_dir,
            project_id=project_id,
            resolve_project_dir=_resolve_project_dir,
            load_project_summary=_load_project_summary,
            http_exception_factory=HTTPException,
        ),
    )


def _update_project_artifact_profile(
    workspace_dir: Path,
    project_id: str,
    profile: ProjectArtifactProfile,
) -> ProjectSummary:
    return cast(
        ProjectSummary,
        copaw_project_metadata_services.update_project_artifact_profile(
            workspace_dir=workspace_dir,
            project_id=project_id,
            profile=profile,
            resolve_project_dir=_resolve_project_dir,
            load_project_summary=_load_project_summary,
            read_project_frontmatter_with_body=_read_project_frontmatter_with_body,
            normalize_project_artifact_profile_storage=_normalize_project_artifact_profile_storage,
            ensure_project_artifact_layout=_ensure_project_artifact_layout,
            write_project_frontmatter=_write_project_frontmatter,
            http_exception_factory=HTTPException,
        ),
    )


def _update_project_artifact_distill_mode(
    workspace_dir: Path,
    project_id: str,
    artifact_distill_mode: str,
) -> ProjectSummary:
    return cast(
        ProjectSummary,
        copaw_project_metadata_services.update_project_artifact_distill_mode(
            workspace_dir=workspace_dir,
            project_id=project_id,
            artifact_distill_mode=artifact_distill_mode,
            resolve_project_dir=_resolve_project_dir,
            load_project_summary=_load_project_summary,
            read_project_frontmatter_with_body=_read_project_frontmatter_with_body,
            normalize_project_artifact_distill_mode=_normalize_project_artifact_distill_mode,
            write_project_frontmatter=_write_project_frontmatter,
            http_exception_factory=HTTPException,
        ),
    )


def _update_project_workspace_chat_binding(
    workspace_dir: Path,
    project_id: str,
    preferred_workspace_chat_id: str,
) -> ProjectSummary:
    return cast(
        ProjectSummary,
        copaw_project_metadata_services.update_project_workspace_chat_binding(
            workspace_dir=workspace_dir,
            project_id=project_id,
            preferred_workspace_chat_id=preferred_workspace_chat_id,
            resolve_project_dir=_resolve_project_dir,
            load_project_summary=_load_project_summary,
            read_project_frontmatter_with_body=_read_project_frontmatter_with_body,
            write_project_metadata=write_project_metadata,
            http_exception_factory=HTTPException,
        ),
    )


def _update_project_auto_knowledge_sink(
    workspace_dir: Path,
    project_id: str,
    project_auto_knowledge_sink: bool,
) -> ProjectSummary:
    return cast(
        ProjectSummary,
        copaw_project_metadata_services.update_project_auto_knowledge_sink(
            workspace_dir=workspace_dir,
            project_id=project_id,
            project_auto_knowledge_sink=project_auto_knowledge_sink,
            resolve_project_dir=_resolve_project_dir,
            load_project_summary=_load_project_summary,
            read_project_frontmatter_with_body=_read_project_frontmatter_with_body,
            write_project_metadata=write_project_metadata,
            http_exception_factory=HTTPException,
        ),
    )


def _sync_project_agent_knowledge_registration(
    summary: ProjectSummary,
    *,
    enabled: bool,
) -> None:
    copaw_project_metadata_services.sync_project_agent_knowledge_registration(
        summary=summary,
        enabled=enabled,
        load_config=load_config,
        ensure_project_source_registered=ensure_project_source_registered,
        build_project_source_spec=build_project_source_spec,
        save_config=save_config,
    )


def _update_project_agent_knowledge_registration(
    workspace_dir: Path,
    project_id: str,
    project_agent_knowledge_registered: bool,
) -> ProjectSummary:
    return cast(
        ProjectSummary,
        copaw_project_metadata_services.update_project_agent_knowledge_registration(
            workspace_dir=workspace_dir,
            project_id=project_id,
            project_agent_knowledge_registered=project_agent_knowledge_registered,
            resolve_project_dir=_resolve_project_dir,
            load_project_summary=_load_project_summary,
            sync_project_agent_knowledge_registration=lambda summary, enabled: _sync_project_agent_knowledge_registration(summary, enabled=enabled),
            read_project_frontmatter_with_body=_read_project_frontmatter_with_body,
            write_project_metadata=write_project_metadata,
            http_exception_factory=HTTPException,
        ),
    )


def _maybe_start_project_auto_knowledge_sync(
    workspace: Any,
    project_id: str,
    changed_paths: list[str] | None,
    *,
    trigger: str,
) -> dict[str, Any] | None:
    return cast(
        dict[str, Any] | None,
        copaw_project_metadata_services.maybe_start_project_auto_knowledge_sync(
            workspace=workspace,
            project_id=project_id,
            changed_paths=changed_paths,
            trigger=trigger,
            project_file_monitoring_active=PROJECT_FILE_MONITORING_ACTIVE,
            default_trigger="project_upload",
            default_project_pipeline_debounce_seconds=DEFAULT_PROJECT_PIPELINE_DEBOUNCE_SECONDS,
            default_project_pipeline_cooldown_seconds=DEFAULT_PROJECT_PIPELINE_COOLDOWN_SECONDS,
            resolve_project_dir=_resolve_project_dir,
            load_project_summary=_load_project_summary,
            load_config=load_config,
            build_project_source_spec=build_project_source_spec,
            project_knowledge_pipeline_manager_factory=ProjectKnowledgePipelineManager,
        ),
    )


def _build_promoted_skill_markdown(
    item: ProjectArtifactItem,
    project_id: str,
    source_body: str,
) -> str:
    return copaw_project_artifact_workflow_services.build_promoted_skill_markdown(
        item,
        project_id,
        source_body,
    )


def _extract_project_conversation_skill_candidates(
    project_dir: Path,
    limit: int = 50,
    run_id: str | None = None,
) -> list[dict[str, str]]:
    return copaw_project_artifact_workflow_services.extract_project_conversation_skill_candidates(
        project_dir,
        safe_artifact_slug=_safe_artifact_slug,
        generate_short_agent_id=generate_short_agent_id,
        limit=limit,
        run_id=run_id,
    )


def _auto_distill_project_skills_to_draft(
    workspace_dir: Path,
    project_id: str,
    run_id: str | None = None,
) -> DistillProjectSkillsDraftResponse:
    return cast(
        DistillProjectSkillsDraftResponse,
        copaw_project_artifact_workflow_services.auto_distill_project_skills_to_draft(
            workspace_dir=workspace_dir,
            project_id=project_id,
            run_id=run_id,
            resolve_project_dir=_resolve_project_dir,
            load_project_summary=_load_project_summary,
            read_project_frontmatter_with_body=_read_project_frontmatter_with_body,
            parse_project_artifact_profile=_parse_project_artifact_profile,
            extract_project_conversation_skill_candidates=lambda project_dir, run_id: _extract_project_conversation_skill_candidates(project_dir, run_id=run_id),
            safe_artifact_slug=_safe_artifact_slug,
            generate_short_agent_id=generate_short_agent_id,
            read_text_file_with_encoding_fallback=read_text_file_with_encoding_fallback,
            project_artifact_item_factory=ProjectArtifactItem,
            normalize_project_artifact_profile_storage=_normalize_project_artifact_profile_storage,
            ensure_project_artifact_layout=_ensure_project_artifact_layout,
            write_project_frontmatter=_write_project_frontmatter,
            distill_project_skills_draft_response_factory=DistillProjectSkillsDraftResponse,
            http_exception_factory=HTTPException,
        ),
    )


def _confirm_project_skill_stable(
    workspace_dir: Path,
    project_id: str,
    artifact_id: str,
) -> ConfirmProjectSkillStableResponse:
    return cast(
        ConfirmProjectSkillStableResponse,
        copaw_project_artifact_workflow_services.confirm_project_skill_stable(
            workspace_dir=workspace_dir,
            project_id=project_id,
            artifact_id=artifact_id,
            resolve_project_dir=_resolve_project_dir,
            load_project_summary=_load_project_summary,
            read_project_frontmatter_with_body=_read_project_frontmatter_with_body,
            parse_project_artifact_profile=_parse_project_artifact_profile,
            normalize_project_artifact_storage=_normalize_project_artifact_storage,
            write_project_frontmatter=_write_project_frontmatter,
            confirm_project_skill_stable_response_factory=ConfirmProjectSkillStableResponse,
            http_exception_factory=HTTPException,
        ),
    )


def _promote_project_skill_to_agent(
    workspace_dir: Path,
    project_id: str,
    artifact_id: str,
    body: PromoteProjectArtifactRequest,
) -> PromoteProjectArtifactResponse:
    def _enable_promoted_skill(workspace_path: Path, skill_dir_name: str) -> None:
        from ...agents.skills_manager import reconcile_workspace_manifest

        manifest = reconcile_workspace_manifest(workspace_path)
        entry = manifest.get("skills", {}).get(skill_dir_name)
        if isinstance(entry, dict):
            entry["enabled"] = True
            manifest_path = workspace_path / "skill.json"
            manifest_path.write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

    return cast(
        PromoteProjectArtifactResponse,
        copaw_project_artifact_workflow_services.promote_project_skill_to_agent(
            workspace_dir=workspace_dir,
            project_id=project_id,
            artifact_id=artifact_id,
            body=body,
            resolve_project_dir=_resolve_project_dir,
            load_project_summary=_load_project_summary,
            safe_artifact_slug=_safe_artifact_slug,
            generate_short_agent_id=generate_short_agent_id,
            build_promoted_skill_markdown=_build_promoted_skill_markdown,
            enable_promoted_skill=_enable_promoted_skill,
            warn_enable_promoted_skill=lambda exc: logger.warning(
                "Failed to auto-enable promoted skill: %s", exc
            ),
            read_project_frontmatter_with_body=_read_project_frontmatter_with_body,
            parse_project_artifact_profile=_parse_project_artifact_profile,
            normalize_project_artifact_storage=_normalize_project_artifact_storage,
            write_project_frontmatter=_write_project_frontmatter,
            promote_project_artifact_response_factory=PromoteProjectArtifactResponse,
            http_exception_factory=HTTPException,
        ),
    )


def _build_unique_project_id(workspace_dir: Path, base_id: str) -> str:
    return copaw_project_scaffold_services.build_unique_project_id(
        workspace_dir=workspace_dir,
        base_id=base_id,
        list_agent_projects=_list_agent_projects,
        slugify=_slugify,
    )


def _build_random_project_id(workspace_dir: Path) -> str:
    return copaw_project_scaffold_services.build_random_project_id(
        workspace_dir=workspace_dir,
        list_agent_projects=_list_agent_projects,
        generate_short_agent_id=generate_short_agent_id,
    )


def _build_unique_project_name(workspace_dir: Path, base_name: str) -> str:
    return copaw_project_scaffold_services.build_unique_project_name(
        workspace_dir=workspace_dir,
        base_name=base_name,
        list_agent_projects=_list_agent_projects,
    )


def _write_project_frontmatter(
    metadata_file: Path,
    metadata: dict[str, Any],
    body: str,
) -> None:
    copaw_project_scaffold_services.write_project_frontmatter(
        metadata_file=metadata_file,
        metadata=metadata,
        body=body,
        write_project_metadata=write_project_metadata,
    )


def _clone_project(
    workspace_dir: Path,
    source_project_id: str,
    body: CloneProjectRequest,
) -> ProjectSummary:
    return cast(
        ProjectSummary,
        copaw_project_lifecycle_services.clone_project(
            workspace_dir=workspace_dir,
            source_project_id=source_project_id,
            body=body,
            projects_dirname=_PROJECTS_DIRNAME,
            resolve_project_dir=_resolve_project_dir,
            load_project_summary=_load_project_summary,
            build_unique_project_id=_build_unique_project_id,
            build_unique_project_name=_build_unique_project_name,
            ensure_project_artifact_layout=_ensure_project_artifact_layout,
            iter_project_metadata_files=_iter_project_metadata_files,
            default_project_metadata_file=_default_project_metadata_file,
            parse_markdown_frontmatter=_parse_markdown_frontmatter,
            parse_project_tags=_parse_project_tags,
            format_iso_time=_format_iso_time,
            write_project_frontmatter=_write_project_frontmatter,
            record_project_realtime_paths=record_project_realtime_paths,
            http_exception_factory=HTTPException,
        ),
    )


def _create_project(
    workspace_dir: Path,
    body: CreateProjectRequest,
) -> ProjectSummary:
    return cast(
        ProjectSummary,
        copaw_project_lifecycle_services.create_project(
            workspace_dir=workspace_dir,
            body=body,
            projects_dirname=_PROJECTS_DIRNAME,
            project_file_monitoring_idle=PROJECT_FILE_MONITORING_IDLE,
            ensure_projects_layout=_ensure_projects_layout,
            build_unique_project_name=_build_unique_project_name,
            build_unique_project_id=_build_unique_project_id,
            build_random_project_id=_build_random_project_id,
            safe_project_data_subdir=_safe_project_data_subdir,
            ensure_project_artifact_layout=_ensure_project_artifact_layout,
            default_project_metadata_file=_default_project_metadata_file,
            normalize_project_artifact_profile_storage=_normalize_project_artifact_profile_storage,
            normalize_project_artifact_distill_mode=_normalize_project_artifact_distill_mode,
            format_iso_time=_format_iso_time,
            write_project_frontmatter=_write_project_frontmatter,
            scaffold_project_governance_files=_scaffold_project_governance_files,
            copy_builtin_pipeline_template_to_project=_copy_builtin_pipeline_template_to_project,
            load_project_summary=_load_project_summary,
            http_exception_factory=HTTPException,
        ),
    )


def _delete_project(
    workspace_dir: Path, project_id: str
) -> DeleteProjectResponse:
    return cast(
        DeleteProjectResponse,
        copaw_project_lifecycle_services.delete_project(
            workspace_dir=workspace_dir,
            project_id=project_id,
            resolve_project_dir=_resolve_project_dir,
            delete_project_response_factory=DeleteProjectResponse,
        ),
    )


def _is_safe_relative_path(rel_path: str) -> bool:
    return copaw_project_file_query_services.is_safe_relative_path(rel_path)


def _rewrite_original_to_data_path(rel_path: str) -> str | None:
    return copaw_project_file_query_services.rewrite_original_to_data_path(rel_path)


def _normalize_project_tree_dir_path(raw_value: str) -> str:
    return copaw_project_file_query_services.normalize_project_tree_dir_path(raw_value)


def _is_visible_project_tree_path(rel_path: str) -> bool:
    return copaw_project_file_query_services.is_visible_project_tree_path(
        rel_path,
        project_tree_ignored_names=_PROJECT_TREE_IGNORED_NAMES,
    )


def _count_visible_project_tree_children(target_dir: Path) -> int:
    return copaw_project_file_query_services.count_visible_project_tree_children(
        target_dir,
        is_visible_project_tree_path=_is_visible_project_tree_path,
    )


def _count_visible_project_tree_direct_files(target_dir: Path) -> int:
    return copaw_project_file_query_services.count_visible_project_tree_direct_files(
        target_dir,
        is_visible_project_tree_path=_is_visible_project_tree_path,
    )


def _has_visible_project_tree_child_directories(target_dir: Path) -> bool:
    return copaw_project_file_query_services.has_visible_project_tree_child_directories(
        target_dir,
        is_visible_project_tree_path=_is_visible_project_tree_path,
    )


def _list_project_file_tree_nodes(
    project_dir: Path,
    dir_path: str = "",
) -> list[ProjectFileTreeNode]:
    return cast(
        list[ProjectFileTreeNode],
        copaw_project_file_query_services.list_project_file_tree_nodes(
            project_dir,
            dir_path,
            normalize_project_tree_dir_path=_normalize_project_tree_dir_path,
            is_safe_relative_path=_is_safe_relative_path,
            is_visible_project_tree_path=_is_visible_project_tree_path,
            format_iso_time=_format_iso_time,
            count_visible_project_tree_children=_count_visible_project_tree_children,
            count_visible_project_tree_direct_files=_count_visible_project_tree_direct_files,
            has_visible_project_tree_child_directories=_has_visible_project_tree_child_directories,
            project_file_tree_node_factory=ProjectFileTreeNode,
            http_exception_factory=HTTPException,
        ),
    )


def _list_project_files(project_dir: Path) -> list[ProjectFileInfo]:
    return cast(
        list[ProjectFileInfo],
        copaw_project_file_query_services.list_project_files(
            project_dir,
            scan_project_file_records=scan_project_file_records,
            project_file_info_factory=ProjectFileInfo,
        ),
    )


def _normalize_project_metric_path(rel_path: str) -> str:
    return copaw_project_file_query_services.normalize_project_metric_path(rel_path)


def _extension_of_project_path(rel_path: str) -> str:
    return copaw_project_file_query_services.extension_of_project_path(rel_path)


def _is_ignored_project_metric_file(rel_path: str) -> bool:
    return copaw_project_file_query_services.is_ignored_project_metric_file(
        rel_path,
        project_ignored_file_names=_PROJECT_IGNORED_FILE_NAMES,
    )


def _is_builtin_project_metric_file(rel_path: str) -> bool:
    return copaw_project_file_query_services.is_builtin_project_metric_file(
        rel_path,
        has_hidden_directory_segment=_has_hidden_directory_segment,
    )


def _is_original_project_metric_file(rel_path: str) -> bool:
    return copaw_project_file_query_services.is_original_project_metric_file(rel_path)


def _is_intermediate_project_metric_file(rel_path: str) -> bool:
    return copaw_project_file_query_services.is_intermediate_project_metric_file(rel_path)


def _is_artifact_project_metric_file(rel_path: str) -> bool:
    return copaw_project_file_query_services.is_artifact_project_metric_file(rel_path)


def _is_agent_project_metric_file(rel_path: str) -> bool:
    return copaw_project_file_query_services.is_agent_project_metric_file(rel_path)


def _is_skill_project_metric_file(rel_path: str) -> bool:
    return copaw_project_file_query_services.is_skill_project_metric_file(rel_path)


def _is_flow_project_metric_file(rel_path: str) -> bool:
    return copaw_project_file_query_services.is_flow_project_metric_file(rel_path)


def _is_case_project_metric_file(rel_path: str) -> bool:
    return copaw_project_file_query_services.is_case_project_metric_file(rel_path)


def _build_project_file_summary(project_dir: Path) -> ProjectFileSummary:
    return cast(
        ProjectFileSummary,
        copaw_project_file_query_services.build_project_file_summary(
            project_dir,
            scan_project_file_records=scan_project_file_records,
            extension_of_path=extension_of_path,
            is_agent_project_metric_file=_is_agent_project_metric_file,
            is_skill_project_metric_file=_is_skill_project_metric_file,
            is_flow_project_metric_file=_is_flow_project_metric_file,
            is_case_project_metric_file=_is_case_project_metric_file,
            project_knowledge_extensions=_PROJECT_KNOWLEDGE_EXTENSIONS,
            collect_recent_project_updates=collect_recent_project_updates,
            format_iso_time=_format_iso_time,
            project_file_info_factory=ProjectFileInfo,
            project_file_summary_factory=ProjectFileSummary,
        ),
    )


def _build_project_file_summary_for_workspace(
    workspace_dir: Path,
    project_id: str,
) -> ProjectFileSummary:
    return cast(
        ProjectFileSummary,
        copaw_project_file_query_services.build_project_file_summary_for_workspace(
            workspace_dir,
            project_id,
            resolve_project_dir=_resolve_project_dir,
            build_project_file_summary=_build_project_file_summary,
        ),
    )


def _list_project_files_for_workspace(
    workspace_dir: Path,
    project_id: str,
) -> list[ProjectFileInfo]:
    return cast(
        list[ProjectFileInfo],
        copaw_project_file_query_services.list_project_files_for_workspace(
            workspace_dir,
            project_id,
            resolve_project_dir=_resolve_project_dir,
            list_project_files=_list_project_files,
        ),
    )


def _query_project_files_for_workspace(
    workspace_dir: Path,
    project_id: str,
    payload: ProjectFileQueryRequest,
) -> ProjectFileQueryResponse:
    return cast(
        ProjectFileQueryResponse,
        copaw_project_file_query_services.query_project_files_for_workspace(
            workspace_dir,
            project_id,
            payload,
            resolve_project_dir=_resolve_project_dir,
            query_project_file_records=query_project_file_records,
            response_model_validate=ProjectFileQueryResponse.model_validate,
        ),
    )


def _list_project_file_tree_nodes_for_workspace(
    workspace_dir: Path,
    project_id: str,
    dir_path: str = "",
) -> list[ProjectFileTreeNode]:
    return cast(
        list[ProjectFileTreeNode],
        copaw_project_file_query_services.list_project_file_tree_nodes_for_workspace(
            workspace_dir,
            project_id,
            dir_path,
            resolve_project_dir=_resolve_project_dir,
            list_project_file_tree_nodes=_list_project_file_tree_nodes,
        ),
    )


def _get_project_files_metadata(
    project_dir: Path,
    rel_paths: list[str],
) -> list[ProjectFileInfo]:
    return cast(
        list[ProjectFileInfo],
        copaw_project_file_query_services.get_project_files_metadata(
            project_dir,
            rel_paths,
            is_safe_relative_path=_is_safe_relative_path,
            format_iso_time=_format_iso_time,
            file_info_factory=ProjectFileInfo,
            http_exception_factory=HTTPException,
        ),
    )


def _get_project_files_metadata_for_workspace(
    workspace_dir: Path,
    project_id: str,
    rel_paths: list[str],
) -> list[ProjectFileInfo]:
    return cast(
        list[ProjectFileInfo],
        copaw_project_file_query_services.get_project_files_metadata_for_workspace(
            workspace_dir,
            project_id,
            rel_paths,
            resolve_project_dir=_resolve_project_dir,
            get_project_files_metadata=_get_project_files_metadata,
        ),
    )


def _read_project_text_file(project_dir: Path, rel_path: str) -> str:
    return copaw_project_file_query_services.read_project_text_file(
        project_dir,
        rel_path,
        resolve_project_file_path=_resolve_project_file_path,
        http_exception_factory=HTTPException,
    )


def _resolve_project_file_path(project_dir: Path, rel_path: str) -> Path:
    return copaw_project_file_query_services.resolve_project_file_path(
        project_dir,
        rel_path,
        is_safe_relative_path=_is_safe_relative_path,
        rewrite_original_to_data_path=_rewrite_original_to_data_path,
        http_exception_factory=HTTPException,
    )


def _resolve_project_file_path_for_workspace(
    workspace_dir: Path,
    project_id: str,
    rel_path: str,
) -> Path:
    return copaw_project_file_query_services.resolve_project_file_path_for_workspace(
        workspace_dir,
        project_id,
        rel_path,
        resolve_project_dir=_resolve_project_dir,
        resolve_project_file_path=_resolve_project_file_path,
    )


def _read_project_text_file_for_workspace(
    workspace_dir: Path,
    project_id: str,
    rel_path: str,
) -> str:
    return copaw_project_file_query_services.read_project_text_file_for_workspace(
        workspace_dir,
        project_id,
        rel_path,
        resolve_project_dir=_resolve_project_dir,
        read_project_text_file=_read_project_text_file,
    )


def _upload_project_file(
    project_dir: Path,
    upload: UploadFile,
    target_dir: str,
    relative_path: str = "",
) -> ProjectFileInfo:
    payload = copaw_project_file_ops.upload_project_file(
        project_dir,
        upload,
        target_dir,
        relative_path,
    )
    return ProjectFileInfo.model_validate(payload)


def _delete_project_path(
    project_dir: Path,
    rel_path: str,
) -> DeleteProjectPathResponse:
    payload = copaw_project_file_ops.delete_project_path(project_dir, rel_path)
    return DeleteProjectPathResponse.model_validate(payload)


def _create_project_directory(
    project_dir: Path,
    rel_path: str,
) -> CreateProjectDirectoryResponse:
    payload = copaw_project_file_ops.create_project_directory(project_dir, rel_path)
    return CreateProjectDirectoryResponse.model_validate(payload)


def _move_project_path(
    project_dir: Path,
    source_path: str,
    target_path: str,
    *,
    conflict_strategy: Literal["fail_if_exists", "overwrite"] = "fail_if_exists",
) -> MoveProjectPathResponse:
    payload = copaw_project_file_ops.move_project_path(
        project_dir,
        source_path,
        target_path,
        conflict_strategy=conflict_strategy,
    )
    return MoveProjectPathResponse.model_validate(payload)


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
            record_project_realtime_paths(None, [artifact_file])

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


def _collect_agent_summaries(
    config: Any,
    ordered_agent_ids: list[str],
) -> list[AgentSummary]:
    """Build lightweight agent summaries without project expansion."""
    agents: list[AgentSummary] = []

    for agent_id in ordered_agent_ids:
        agent_ref = config.agents.profiles[agent_id]

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
                    is_builtin=bool(
                        getattr(agent_config, "is_builtin", False)
                        or getattr(agent_ref, "is_builtin", False)
                    ),
                    builtin_kind=(
                        getattr(agent_config, "builtin_kind", "")
                        or getattr(agent_ref, "builtin_kind", "")
                    ),
                    builtin_label=(
                        getattr(agent_config, "builtin_label", "")
                        or getattr(agent_ref, "builtin_label", "")
                    ),
                    system_protected=bool(
                        getattr(agent_config, "system_protected", False)
                        or getattr(agent_ref, "system_protected", False)
                    ),
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
                    is_builtin=bool(getattr(agent_ref, "is_builtin", False)),
                    builtin_kind=str(getattr(agent_ref, "builtin_kind", "") or ""),
                    builtin_label=str(getattr(agent_ref, "builtin_label", "") or ""),
                    system_protected=bool(
                        getattr(agent_ref, "system_protected", False),
                    ),
                ),
            )

    return agents


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
    agents = await asyncio.to_thread(
        _collect_agent_summaries,
        config,
        ordered_agent_ids,
    )
    return AgentListResponse(agents=agents)


@router.get(
    "/{agentId}/projects",
    response_model=list[ProjectSummary],
    summary="List projects for one agent",
    description="Get projects only for the requested agent workspace",
)
async def list_agent_projects(
    request: Request,
    agentId: str = PathParam(...),
) -> list[ProjectSummary]:
    """List projects for one agent workspace without scanning other agents."""
    _ = request
    config = load_config()
    profile = config.agents.profiles.get(agentId)
    if profile is None:
        raise HTTPException(
            status_code=404,
            detail=f"Agent '{agentId}' not found",
        )
    return _list_agent_projects(Path(profile.workspace_dir))


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
        _initialize_agent_workspace(workspace_dir)
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
    except (ValueError, AppBaseException) as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


def _generate_unique_id(existing_ids: set[str]) -> str:
    """Generate a unique random short agent ID.

    Raises:
        HTTPException: If a unique ID could not be generated.
    """
    max_attempts = 10
    for _ in range(max_attempts):
        candidate_id = generate_short_agent_id()
        if candidate_id not in existing_ids:
            return candidate_id
    raise HTTPException(
        status_code=500,
        detail="Failed to generate unique agent ID after 10 attempts",
    )


@router.post(
    "",
    response_model=AgentProfileRef,
    status_code=201,
    summary="Create new agent",
    description="Create a new agent with optional custom ID",
)
async def create_agent(
    request: CreateAgentRequest = Body(...),
) -> AgentProfileRef:
    """Create a new agent.

    When ``request.id`` is provided, it is used as the agent identifier
    (validated for URL-safe characters, length, reserved words, and
    uniqueness).  Otherwise a random short UUID is generated.
    """
    config = load_config()
    existing_ids = set(config.agents.profiles.keys())

    if request.id:
        try:
            validate_agent_id(request.id, existing_ids)
        except ValueError as e:
            raise HTTPException(
                status_code=400,
                detail=str(e),
            ) from e
        new_id = request.id
    else:
        new_id = _generate_unique_id(existing_ids)

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

    agent_ref = config.agents.profiles[agentId]
    if getattr(agent_ref, "system_protected", False):
        raise HTTPException(
            status_code=400,
            detail="Cannot update a system builtin agent",
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

    agent_ref = config.agents.profiles[agentId]
    if getattr(agent_ref, "system_protected", False):
        raise HTTPException(
            status_code=400,
            detail="Cannot delete a system builtin agent",
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
    if getattr(agent_ref, "system_protected", False):
        raise HTTPException(
            status_code=400,
            detail="Cannot toggle a system builtin agent",
        )
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
    except (ValueError, AppBaseException) as e:
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
    except (ValueError, AppBaseException) as e:
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
    except (ValueError, AppBaseException) as e:
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
    except (ValueError, AppBaseException) as e:
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
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        return await asyncio.to_thread(
            _list_project_files_for_workspace,
            workspace_dir,
            projectId,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/{agentId}/projects/{projectId}/file-tree",
    response_model=list[ProjectFileTreeNode],
    summary="List shallow project file tree nodes",
    description="List one directory level under a project for lazy file tree loading",
)
async def list_agent_project_file_tree(
    request: Request,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
    dirPath: str = Query(default="", alias="dir_path"),
) -> list[ProjectFileTreeNode]:
    """List one directory level under a project for lazy file tree loading."""
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        return await asyncio.to_thread(
            _list_project_file_tree_nodes_for_workspace,
            workspace_dir,
            projectId,
            dirPath,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/{agentId}/projects/{projectId}/summary",
    response_model=ProjectFileSummary,
    summary="Get project file summary",
    description="Get lightweight aggregated project file counts for overview rendering",
)
async def get_agent_project_file_summary(
    request: Request,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> ProjectFileSummary:
    """Get lightweight aggregated project file counts for a project."""
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        return await asyncio.to_thread(
            _build_project_file_summary_for_workspace,
            workspace_dir,
            projectId,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/{agentId}/projects/{projectId}/files/metadata",
    response_model=list[ProjectFileInfo],
    summary="Fetch project file metadata by path",
    description="Fetch lightweight metadata for selected project file paths",
)
async def get_agent_project_files_metadata(
    request: Request,
    payload: ProjectFileMetadataRequest = Body(...),
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> list[ProjectFileInfo]:
    """Fetch project file metadata for selected relative paths."""
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        return await asyncio.to_thread(
            _get_project_files_metadata_for_workspace,
            workspace_dir,
            projectId,
            payload.paths,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/{agentId}/projects/{projectId}/files/query",
    response_model=ProjectFileQueryResponse,
    summary="Query project files",
    description="Query project files using unified filters/sort/pagination",
)
async def query_agent_project_files(
    request: Request,
    payload: ProjectFileQueryRequest = Body(...),
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> ProjectFileQueryResponse:
    """Query project files with centralized classification and filtering rules."""
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        return await asyncio.to_thread(
            _query_project_files_for_workspace,
            workspace_dir,
            projectId,
            payload,
        )
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
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        return copaw_project_lifecycle_services.create_project_for_workspace(
            workspace_dir=workspace_dir,
            body=body,
            create_project=_create_project,
        )
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
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        return copaw_project_metadata_services.get_project_artifact_profile_for_workspace(
            workspace_dir=workspace_dir,
            project_id=projectId,
            get_profile=_get_project_artifact_profile,
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
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        return copaw_project_metadata_services.update_project_artifact_profile_for_workspace(
            workspace_dir=workspace_dir,
            project_id=projectId,
            body=body,
            update_profile=_update_project_artifact_profile,
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
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        return copaw_project_metadata_services.update_project_artifact_distill_mode_for_workspace(
            workspace_dir=workspace_dir,
            project_id=projectId,
            artifact_distill_mode=body.artifact_distill_mode,
            update_distill_mode=_update_project_artifact_distill_mode,
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
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        return copaw_project_metadata_services.update_project_workspace_chat_binding_for_workspace(
            workspace_dir=workspace_dir,
            project_id=projectId,
            preferred_workspace_chat_id=body.preferred_workspace_chat_id,
            update_binding=_update_project_workspace_chat_binding,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put(
    "/{agentId}/projects/{projectId}/knowledge-sink",
    response_model=ProjectSummary,
    summary="Update project auto knowledge sink",
    description=(
        "Persist project-level auto knowledge sink switch in project metadata"
    ),
)
async def update_project_knowledge_sink(
    request: Request,
    body: UpdateProjectKnowledgeSinkRequest = Body(...),
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> ProjectSummary:
    """Update project auto knowledge sink switch."""
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        return copaw_project_metadata_services.update_project_knowledge_sink_for_workspace(
            workspace_dir=workspace_dir,
            project_id=projectId,
            project_auto_knowledge_sink=body.project_auto_knowledge_sink,
            update_knowledge_sink=_update_project_auto_knowledge_sink,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put(
    "/{agentId}/projects/{projectId}/knowledge-registration",
    response_model=ProjectSummary,
    summary="Update project knowledge registration",
    description=(
        "Persist project knowledge registration switch and synchronize "
        "project workspace source in knowledge config"
    ),
)
async def update_project_knowledge_registration(
    request: Request,
    body: UpdateProjectKnowledgeRegistrationRequest = Body(...),
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> ProjectSummary:
    """Update project registration as an agent knowledge source."""
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        return copaw_project_metadata_services.update_project_knowledge_registration_for_workspace(
            workspace_dir=workspace_dir,
            project_id=projectId,
            project_agent_knowledge_registered=body.project_agent_knowledge_registered,
            update_knowledge_registration=_update_project_agent_knowledge_registration,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/{agentId}/projects/{projectId}/knowledge-watch-leases",
    response_model=AcquireProjectKnowledgeWatchLeaseResponse,
    summary="Acquire project knowledge watch lease",
    description="Mark a project detail page instance as actively watching this project.",
)
async def acquire_project_knowledge_watch_lease(
    request: Request,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> AcquireProjectKnowledgeWatchLeaseResponse:
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        return AcquireProjectKnowledgeWatchLeaseResponse.model_validate(
            copaw_project_watch_artifact_services.acquire_project_knowledge_watch_lease_for_workspace(
                workspace_dir=workspace_dir,
                project_id=projectId,
                resolve_project_dir=_resolve_project_dir,
                acquire_watch_lease=acquire_project_watch_lease,
            )
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete(
    "/{agentId}/projects/{projectId}/knowledge-watch-leases/{leaseId}",
    response_model=ReleaseProjectKnowledgeWatchLeaseResponse,
    summary="Release project knowledge watch lease",
    description="Release a project detail page watch lease and idle monitoring when no lease remains.",
)
async def release_project_knowledge_watch_lease(
    request: Request,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
    leaseId: str = PathParam(...),
) -> ReleaseProjectKnowledgeWatchLeaseResponse:
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        return ReleaseProjectKnowledgeWatchLeaseResponse.model_validate(
            copaw_project_watch_artifact_services.release_project_knowledge_watch_lease_for_workspace(
                workspace_dir=workspace_dir,
                project_id=projectId,
                lease_id=leaseId,
                resolve_project_dir=_resolve_project_dir,
                release_watch_lease=release_project_watch_lease,
            )
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
        return copaw_project_watch_artifact_services.auto_distill_project_skills_draft_for_workspace(
            workspace_dir=Path(workspace.workspace_dir),
            project_id=projectId,
            run_id=body.run_id,
            auto_distill=_auto_distill_project_skills_to_draft,
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
        return copaw_project_watch_artifact_services.confirm_project_skill_stable_for_workspace(
            workspace_dir=Path(workspace.workspace_dir),
            project_id=projectId,
            artifact_id=artifactId,
            confirm_skill_stable=_confirm_project_skill_stable,
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
        return copaw_project_watch_artifact_services.promote_project_skill_artifact_for_workspace(
            workspace_dir=Path(workspace.workspace_dir),
            project_id=projectId,
            artifact_id=artifactId,
            body=body,
            request=request,
            agent_id=agentId,
            promote_project_skill=_promote_project_skill_to_agent,
            schedule_agent_reload=schedule_agent_reload,
        )
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
        return copaw_project_lifecycle_services.clone_project_for_workspace(
            workspace_dir=Path(workspace.workspace_dir),
            project_id=projectId,
            body=body,
            clone_project=_clone_project,
        )
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
        return copaw_project_lifecycle_services.delete_project_for_workspace(
            workspace_dir=Path(workspace.workspace_dir),
            project_id=projectId,
            delete_project=_delete_project,
        )
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
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        content = await asyncio.to_thread(
            _read_project_text_file_for_workspace,
            workspace_dir,
            projectId,
            filePath,
        )
        return ProjectFileContent(content=content)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/{agentId}/projects/{projectId}/binary-files/{filePath:path}",
    summary="Preview project binary file",
    description="Stream a project file for image/media preview",
)
async def preview_agent_project_binary_file(
    request: Request,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
    filePath: str = PathParam(...),
) -> FileResponse:
    """Stream one project file as binary response for browser preview."""
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        target = await asyncio.to_thread(
            _resolve_project_file_path_for_workspace,
            workspace_dir,
            projectId,
            filePath,
        )
        return FileResponse(target, filename=target.name)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/{agentId}/projects/{projectId}/files/upload",
    response_model=ProjectFileInfo,
    summary="Upload project file",
    description="Upload a file into the project root or a safe subdirectory",
)
async def upload_agent_project_file(
    request: Request,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
    file: UploadFile = File(...),
    target_dir: str = Form(""),
    relative_path: str = Form(""),
) -> ProjectFileInfo:
    """Upload a file into project workspace."""
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        payload = copaw_project_file_services.upload_project_file_for_workspace(
            workspace_dir=workspace_dir,
            project_id=projectId,
            file=file,
            target_dir=target_dir,
            relative_path=relative_path,
            resolve_project_dir=_resolve_project_dir,
            update_monitoring_state=update_project_file_monitoring_state,
            record_realtime_paths=record_project_realtime_paths,
            monitoring_active=PROJECT_FILE_MONITORING_ACTIVE,
        )
        return ProjectFileInfo.model_validate(payload)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete(
    "/{agentId}/projects/{projectId}/files/{targetPath:path}",
    response_model=DeleteProjectPathResponse,
    summary="Delete project file or directory",
    description="Delete one file or directory under the project workspace",
)
async def delete_agent_project_path(
    request: Request,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
    targetPath: str = PathParam(...),
) -> DeleteProjectPathResponse:
    """Delete one file or directory under project workspace."""
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        payload = copaw_project_file_services.delete_project_path_for_workspace(
            workspace_dir=workspace_dir,
            project_id=projectId,
            target_path=targetPath,
            resolve_project_dir=_resolve_project_dir,
            update_monitoring_state=update_project_file_monitoring_state,
            record_realtime_paths=record_project_realtime_paths,
            monitoring_active=PROJECT_FILE_MONITORING_ACTIVE,
        )
        return DeleteProjectPathResponse.model_validate(payload)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/{agentId}/projects/{projectId}/directories",
    response_model=CreateProjectDirectoryResponse,
    summary="Create project directory",
    description="Create one directory under the project workspace",
)
async def create_agent_project_directory(
    request: Request,
    body: CreateProjectDirectoryRequest = Body(...),
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> CreateProjectDirectoryResponse:
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        payload = copaw_project_file_services.create_project_directory_for_workspace(
            workspace_dir=workspace_dir,
            project_id=projectId,
            directory_path=body.path,
            resolve_project_dir=_resolve_project_dir,
            update_monitoring_state=update_project_file_monitoring_state,
            record_realtime_paths=record_project_realtime_paths,
            monitoring_active=PROJECT_FILE_MONITORING_ACTIVE,
        )
        return CreateProjectDirectoryResponse.model_validate(payload)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.patch(
    "/{agentId}/projects/{projectId}/files/move",
    response_model=MoveProjectPathResponse,
    summary="Move or rename project path",
    description="Move/rename one file or directory under the project workspace",
)
async def move_agent_project_path(
    request: Request,
    body: MoveProjectPathRequest = Body(...),
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> MoveProjectPathResponse:
    _ = request
    workspace_dir = _resolve_agent_workspace_dir(agentId)

    try:
        payload = copaw_project_file_services.move_project_path_for_workspace(
            workspace_dir=workspace_dir,
            project_id=projectId,
            source_path=body.source_path,
            target_path=body.target_path,
            conflict_strategy=body.conflict_strategy,
            resolve_project_dir=_resolve_project_dir,
            update_monitoring_state=update_project_file_monitoring_state,
            record_realtime_paths=record_project_realtime_paths,
            monitoring_active=PROJECT_FILE_MONITORING_ACTIVE,
        )
        return MoveProjectPathResponse.model_validate(payload)
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
            reason = str(result.get("reason", "unknown"))
            if reason in {"builtin_upgrade", "conflict"}:
                logger.info(
                    "Initial skill %s already satisfied for %s: %s",
                    skill_name,
                    workspace_dir,
                    reason,
                )
            else:
                logger.warning(
                    "Failed to install initial skill %s for %s: %s",
                    skill_name,
                    workspace_dir,
                    reason,
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
    builtin_template_key: str | None = None,
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

    if builtin_template_key == "qa":
        copy_builtin_qa_md_files(
            language,
            workspace_dir,
            only_if_missing=True,
        )
    elif builtin_template_key:
        copy_builtin_agent_md_files(
            builtin_template_key,
            language,
            workspace_dir,
            only_if_missing=True,
        )
    else:
        copy_md_files(
            language,
            skip_existing=True,
            workspace_dir=workspace_dir,
        )
    _ensure_default_heartbeat_md(workspace_dir, language)
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
