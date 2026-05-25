# -*- coding: utf-8 -*-
"""Agent file management API."""

import asyncio
import re
import subprocess
from typing import Literal

from fastapi import APIRouter, Body, HTTPException, Request
from pydantic import BaseModel, Field

from ..utils import schedule_agent_reload
from ...config import (
    load_config,
    save_config,
    AgentsRunningConfig,
)
from ...config.config import load_agent_config, save_agent_config
from ...knowledge.module_skills import sync_knowledge_module_skills
from copaw.knowledge.hanlp_nlp_runtime import NLPRuntime
from ...agents.memory.agent_md_manager import AgentMdManager
from ...agents.utils import (
    copy_builtin_agent_md_files,
    copy_builtin_qa_md_files,
    copy_md_files,
)
from ..builtin_agents import get_builtin_agent_spec
from ..agent_context import (
    get_agent_for_request,
    get_loaded_agent_for_request,
    resolve_agent_id_for_request,
)

router = APIRouter(prefix="/agent", tags=["agent"])


def _migrate_knowledge_automation_to_running(config) -> bool:
    """Compat: migrate deprecated knowledge.automation to agents.running."""
    changed = False
    defaults = AgentsRunningConfig()
    running = config.agents.running
    legacy = getattr(config.knowledge, "automation", None)
    if legacy is None:
        return False

    if (
        running.knowledge_enabled == defaults.knowledge_enabled
        and config.knowledge.enabled != defaults.knowledge_enabled
    ):
        running.knowledge_enabled = config.knowledge.enabled
        changed = True

    if (
        running.knowledge_auto_collect_chat_files == defaults.knowledge_auto_collect_chat_files
        and legacy.knowledge_auto_collect_chat_files != defaults.knowledge_auto_collect_chat_files
    ):
        running.knowledge_auto_collect_chat_files = legacy.knowledge_auto_collect_chat_files
        changed = True

    if (
        running.knowledge_auto_collect_chat_urls == defaults.knowledge_auto_collect_chat_urls
        and legacy.knowledge_auto_collect_chat_urls != defaults.knowledge_auto_collect_chat_urls
    ):
        running.knowledge_auto_collect_chat_urls = legacy.knowledge_auto_collect_chat_urls
        changed = True

    if (
        running.knowledge_auto_collect_long_text == defaults.knowledge_auto_collect_long_text
        and legacy.knowledge_auto_collect_long_text != defaults.knowledge_auto_collect_long_text
    ):
        running.knowledge_auto_collect_long_text = legacy.knowledge_auto_collect_long_text
        changed = True

    if (
        running.knowledge_long_text_min_chars == defaults.knowledge_long_text_min_chars
        and legacy.knowledge_long_text_min_chars != defaults.knowledge_long_text_min_chars
    ):
        running.knowledge_long_text_min_chars = legacy.knowledge_long_text_min_chars
        changed = True

    knowledge_index = getattr(config.knowledge, "index", None)
    if (
        knowledge_index is not None
        and running.knowledge_chunk_size == defaults.knowledge_chunk_size
        and knowledge_index.chunk_size != defaults.knowledge_chunk_size
    ):
        running.knowledge_chunk_size = knowledge_index.chunk_size
        changed = True

    return changed


def _sync_running_to_knowledge_automation(config) -> None:
    """Compat: keep deprecated knowledge.automation in sync."""
    legacy = getattr(config.knowledge, "automation", None)
    if legacy is None:
        return
    running = config.agents.running
    config.knowledge.enabled = running.knowledge_enabled
    legacy.knowledge_auto_collect_chat_files = running.knowledge_auto_collect_chat_files
    legacy.knowledge_auto_collect_chat_urls = running.knowledge_auto_collect_chat_urls
    legacy.knowledge_auto_collect_long_text = running.knowledge_auto_collect_long_text
    legacy.knowledge_long_text_min_chars = running.knowledge_long_text_min_chars
    config.knowledge.index.chunk_size = running.knowledge_chunk_size


class MdFileInfo(BaseModel):
    """Markdown file metadata."""

    filename: str = Field(..., description="File name")
    path: str = Field(..., description="File path")
    size: int = Field(..., description="Size in bytes")
    created_time: str = Field(..., description="Created time")
    modified_time: str = Field(..., description="Modified time")


class MdFileContent(BaseModel):
    """Markdown file content."""

    content: str = Field(..., description="File content")


class NLPAutoClassicalChineseBody(BaseModel):
    """Request body for classical-Chinese auto routing settings."""

    enabled: bool = Field(default=True)
    threshold: float = Field(default=0.22, ge=0.0, le=1.0)
    model_id: str = Field(default="")


class NLPStrategyUpdateBody(BaseModel):
    """Request body for NLP strategy updates."""

    mode: Literal["auto", "manual", "hybrid"] = Field(default="auto")
    default_model_id: str = Field(default="")
    task_overrides: dict[str, str] = Field(default_factory=dict)
    auto_classical_chinese: NLPAutoClassicalChineseBody = Field(
        default_factory=NLPAutoClassicalChineseBody,
    )


class NLPStrategyDryRunBody(BaseModel):
    """Request body for NLP strategy decision dry-run."""

    text: str = Field(..., min_length=1, description="Input text used to evaluate routing strategy")
    task_key: str = Field(default="ner", description="Task key, e.g. ner/dep")


class NLPPreloadUpdateBody(BaseModel):
    """Request body for startup preload settings."""

    enabled: bool = Field(default=False)
    scope: Literal["critical", "all_enabled_tasks"] = Field(default="critical")


class NLPPreloadTriggerBody(BaseModel):
    """Request body for manual preload trigger."""

    force: bool = Field(default=False)


_CLASSICAL_HINT_CHARS = frozenset("之乎者也焉矣其乃若夫盖兮耳哉")
_CLASSICAL_HINT_PATTERNS = (
    re.compile(r"[吾余予汝尔卿]"),
    re.compile(r"[不无未弗毋勿]\w?"),
)
_MODERN_HINT_TOKENS = (
    "我们",
    "你们",
    "他们",
    "这个",
    "那个",
    "因为",
    "所以",
    "以及",
)


def _normalize_task_overrides(raw: dict[str, str] | None) -> dict[str, str]:
    """Normalize task overrides by trimming keys/values and dropping empties."""
    normalized: dict[str, str] = {}
    if not isinstance(raw, dict):
        return normalized
    for task_key, model_id in raw.items():
        key = str(task_key or "").strip()
        value = str(model_id or "").strip()
        if key and value:
            normalized[key] = value
    return normalized


def _build_nlp_strategy_payload(nlp_cfg) -> dict:
    """Build strategy payload for NLP status and update responses."""
    strategy_cfg = getattr(nlp_cfg, "strategy", None)
    auto_cfg = getattr(strategy_cfg, "auto_classical_chinese", None)
    return {
        "mode": str(getattr(strategy_cfg, "mode", "auto") or "auto"),
        "default_model_id": str(getattr(strategy_cfg, "default_model_id", "") or ""),
        "task_overrides": dict(getattr(strategy_cfg, "task_overrides", {}) or {}),
        "auto_classical_chinese": {
            "enabled": bool(getattr(auto_cfg, "enabled", False)) if auto_cfg is not None else False,
            "threshold": float(getattr(auto_cfg, "threshold", 0.22) or 0.22)
            if auto_cfg is not None
            else 0.22,
            "model_id": str(getattr(auto_cfg, "model_id", "") or "") if auto_cfg is not None else "",
        },
    }


def _build_hanlp_api_snapshot(payload: dict) -> dict:
    """Build a lightweight API capability snapshot from cached HanLP status."""
    sidecar = payload.get("sidecar") or {}
    model = payload.get("model") or {}
    tasks = payload.get("tasks") or {}
    task_entries = tasks.values() if isinstance(tasks, dict) else []

    def _task_ready(task_key: str) -> bool:
        if not isinstance(tasks, dict):
            return False
        task = tasks.get(task_key)
        if not isinstance(task, dict):
            return False
        return str(task.get("status") or "") == "ready"

    status = str(sidecar.get("status") or "unavailable")
    reason_code = str(sidecar.get("reason_code") or "HANLP_SIDECAR_UNCONFIGURED")
    reason = str(sidecar.get("reason") or "HanLP sidecar is not configured.")
    if status == "ready" and str(model.get("status") or "") != "ready":
        status = str(model.get("status") or "unavailable")
        reason_code = str(model.get("reason_code") or "HANLP_MODEL_LOAD_FAILED")
        reason = str(model.get("reason") or "HanLP tokenizer model is unavailable.")

    return {
        "engine": "hanlp",
        "status": status,
        "reason_code": reason_code,
        "reason": reason,
        "python_version": str(sidecar.get("python_version") or ""),
        "hanlp_version": "",
        "has_coreference_resolution": _task_ready("cor"),
        "has_parse": _task_ready("dep") or _task_ready("sdp") or _task_ready("con"),
        "has_pipeline": status == "ready",
        "has_load": status == "ready",
        "pretrained_categories": [],
        "task_ready_count": sum(1 for task in task_entries if isinstance(task, dict) and str(task.get("status") or "") == "ready"),
    }


def _detect_python_version(python_executable: str) -> str:
    """Best-effort python version probe from executable path."""
    executable = str(python_executable or "").strip()
    if not executable:
        return ""
    try:
        result = subprocess.run(
            [
                executable,
                "-c",
                "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')",
            ],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
    except Exception:
        return ""
    if result.returncode != 0:
        return ""
    output = (result.stdout or "").strip()
    match = re.search(r"(\d+)\.(\d+)", output)
    if not match:
        return ""
    return f"{match.group(1)}.{match.group(2)}"


def _classical_detection_score(text: str) -> float:
    """Compute a lightweight heuristic score for classical-Chinese style."""
    normalized = str(text or "").strip()
    if not normalized:
        return 0.0
    classical_hits = sum(1 for ch in normalized if ch in _CLASSICAL_HINT_CHARS)
    for pattern in _CLASSICAL_HINT_PATTERNS:
        classical_hits += len(pattern.findall(normalized))
    modern_hits = 0
    for token in _MODERN_HINT_TOKENS:
        modern_hits += normalized.count(token)
    density_score = min(1.0, (classical_hits / max(len(normalized), 1)) * 10.0)
    contrast_score = max(0.0, (classical_hits - modern_hits) / max(classical_hits + modern_hits, 1))
    score = (density_score * 0.65) + (contrast_score * 0.35)
    return max(0.0, min(score, 1.0))


def _resolve_nlp_model_decision(task_key: str, text: str, nlp_cfg) -> dict:
    """Resolve selected model and decision metadata for a given input text/task."""
    normalized_task_key = str(task_key or "ner").strip().lower() or "ner"
    strategy = getattr(nlp_cfg, "strategy", None)
    base_model = str(getattr(nlp_cfg, "model_id", "") or "").strip()
    selected_model = base_model
    detected_style = "modern"
    detection_score = 0.0
    matched_rules: list[str] = []
    mode = str(getattr(strategy, "mode", "auto") or "auto").strip().lower() or "auto"

    default_model = str(getattr(strategy, "default_model_id", "") or "").strip() if strategy else ""
    if default_model:
        selected_model = default_model
        matched_rules.append("strategy.default_model_id")

    task_overrides = getattr(strategy, "task_overrides", {}) if strategy is not None else {}
    if isinstance(task_overrides, dict):
        override_model = str(task_overrides.get(normalized_task_key) or "").strip()
        if override_model:
            selected_model = override_model
            matched_rules.append(f"strategy.task_overrides.{normalized_task_key}")

    auto_cfg = getattr(strategy, "auto_classical_chinese", None)
    auto_enabled = bool(getattr(auto_cfg, "enabled", False)) if auto_cfg is not None else False
    if mode in {"auto", "hybrid"} and auto_enabled:
        detection_score = _classical_detection_score(text)
        threshold = float(getattr(auto_cfg, "threshold", 0.22) or 0.22)
        if detection_score >= max(0.0, min(threshold, 1.0)):
            detected_style = "classical_chinese"
            classical_model = str(getattr(auto_cfg, "model_id", "") or "").strip()
            if classical_model:
                selected_model = classical_model
                matched_rules.append("strategy.auto_classical_chinese")

    if not selected_model:
        selected_model = base_model
        if base_model:
            matched_rules.append("nlp.model_id")

    return {
        "task_key": normalized_task_key,
        "strategy_mode": mode,
        "detected_style": detected_style,
        "detection_score": round(detection_score, 4),
        "selected_model": selected_model,
        "matched_rules": matched_rules,
        "fallback_used": False,
    }


@router.get(
    "/files",
    response_model=list[MdFileInfo],
    summary="List working files",
    description="List all working files (uses active agent)",
)
async def list_working_files(
    request: Request,
) -> list[MdFileInfo]:
    """List working directory markdown files."""
    try:
        workspace = await get_agent_for_request(request)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
        )
        files = [
            MdFileInfo.model_validate(file)
            for file in workspace_manager.list_working_mds()
        ]
        return files
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/files/{md_name}",
    response_model=MdFileContent,
    summary="Read a working file",
    description="Read a working markdown file (uses active agent)",
)
async def read_working_file(
    md_name: str,
    request: Request,
) -> MdFileContent:
    """Read a working directory markdown file."""
    try:
        workspace = await get_agent_for_request(request)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
        )
        content = workspace_manager.read_working_md(md_name)
        return MdFileContent(content=content)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put(
    "/files/{md_name}",
    response_model=dict,
    summary="Write a working file",
    description="Create or update a working file (uses active agent)",
)
async def write_working_file(
    md_name: str,
    body: MdFileContent,
    request: Request,
) -> dict:
    """Write a working directory markdown file."""
    try:
        workspace = await get_agent_for_request(request)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
        )
        workspace_manager.write_working_md(md_name, body.content)
        return {"written": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/memory",
    response_model=list[MdFileInfo],
    summary="List memory files",
    description="List all memory files (uses active agent)",
)
async def list_memory_files(
    request: Request,
) -> list[MdFileInfo]:
    """List memory directory markdown files."""
    try:
        workspace = await get_agent_for_request(request)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
        )
        files = [
            MdFileInfo.model_validate(file)
            for file in workspace_manager.list_memory_mds()
        ]
        return files
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/memory/{md_name}",
    response_model=MdFileContent,
    summary="Read a memory file",
    description="Read a memory markdown file (uses active agent)",
)
async def read_memory_file(
    md_name: str,
    request: Request,
) -> MdFileContent:
    """Read a memory directory markdown file."""
    try:
        workspace = await get_agent_for_request(request)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
        )
        content = workspace_manager.read_memory_md(md_name)
        return MdFileContent(content=content)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put(
    "/memory/{md_name}",
    response_model=dict,
    summary="Write a memory file",
    description="Create or update a memory file (uses active agent)",
)
async def write_memory_file(
    md_name: str,
    body: MdFileContent,
    request: Request,
) -> dict:
    """Write a memory directory markdown file."""
    try:
        workspace = await get_agent_for_request(request)
        workspace_manager = AgentMdManager(
            str(workspace.workspace_dir),
        )
        workspace_manager.write_memory_md(md_name, body.content)
        return {"written": True}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/language",
    summary="Get agent language",
    description="Get the language setting for agent MD files (en/zh/ru)",
)
async def get_agent_language(request: Request) -> dict:
    """Get agent language setting for current agent."""
    workspace = await get_agent_for_request(request)
    agent_config = load_agent_config(workspace.agent_id)
    return {
        "language": agent_config.language,
        "agent_id": workspace.agent_id,
    }


@router.put(
    "/language",
    summary="Update agent language",
    description=(
        "Update the language for agent MD files (en/zh/ru). "
        "Optionally copies MD files for the new language to agent workspace."
    ),
)
async def put_agent_language(
    request: Request,
    body: dict = Body(
        ...,
        description='Language setting, e.g. {"language": "zh"}',
    ),
) -> dict:
    """
    Update agent language and optionally re-copy MD files to agent workspace.
    """
    language = (body.get("language") or "").strip().lower()
    valid = {"zh", "en", "ru"}
    if language not in valid:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid language '{language}'. "
                f"Must be one of: {', '.join(sorted(valid))}"
            ),
        )

    # Get current agent's workspace
    workspace = await get_agent_for_request(request)
    agent_id = workspace.agent_id

    # Load agent config
    agent_config = load_agent_config(agent_id)
    old_language = agent_config.language

    # Update agent's language
    agent_config.language = language
    save_agent_config(agent_id, agent_config)

    copied_files: list[str] = []
    if old_language != language:
        builtin_spec = get_builtin_agent_spec(agent_id)
        if builtin_spec and builtin_spec.template_key == "qa":
            copied_files = copy_builtin_qa_md_files(
                language,
                workspace.workspace_dir,
                only_if_missing=False,
            )
        elif builtin_spec and builtin_spec.template_key:
            copied_files = copy_builtin_agent_md_files(
                builtin_spec.template_key,
                language,
                workspace.workspace_dir,
                only_if_missing=False,
            )
        else:
            copied_files = (
                copy_md_files(
                    language,
                    workspace_dir=workspace.workspace_dir,
                )
                or []
            )

    return {
        "language": language,
        "copied_files": copied_files,
        "agent_id": agent_id,
    }


@router.get(
    "/audio-mode",
    summary="Get audio mode",
    description=(
        "Get the audio handling mode for incoming voice messages. "
        'Values: "auto", "native".'
    ),
)
async def get_audio_mode() -> dict:
    """Get audio mode setting."""
    config = load_config()
    return {"audio_mode": config.agents.audio_mode}


@router.put(
    "/audio-mode",
    summary="Update audio mode",
    description=(
        "Update how incoming audio/voice messages are handled. "
        '"auto": transcribe if provider available, else file placeholder; '
        '"native": send audio directly to model (may need ffmpeg).'
    ),
)
async def put_audio_mode(
    body: dict = Body(
        ...,
        description='Audio mode, e.g. {"audio_mode": "auto"}',
    ),
) -> dict:
    """Update audio mode setting."""
    raw = body.get("audio_mode")
    audio_mode = (str(raw) if raw is not None else "").strip().lower()
    valid = {"auto", "native"}
    if audio_mode not in valid:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid audio_mode '{audio_mode}'. "
                f"Must be one of: {', '.join(sorted(valid))}"
            ),
        )
    config = load_config()
    config.agents.audio_mode = audio_mode
    save_config(config)
    return {"audio_mode": audio_mode}


@router.get(
    "/transcription-provider-type",
    summary="Get transcription provider type",
    description=(
        "Get the transcription provider type. "
        'Values: "disabled", "whisper_api", "local_whisper".'
    ),
)
async def get_transcription_provider_type() -> dict:
    """Get transcription provider type setting."""
    config = load_config()
    return {
        "transcription_provider_type": (
            config.agents.transcription_provider_type
        ),
    }


@router.put(
    "/transcription-provider-type",
    summary="Set transcription provider type",
    description=(
        "Set the transcription provider type. "
        '"disabled": no transcription; '
        '"whisper_api": remote Whisper endpoint; '
        '"local_whisper": locally installed openai-whisper.'
    ),
)
async def put_transcription_provider_type(
    body: dict = Body(
        ...,
        description=(
            "Provider type, e.g. "
            '{"transcription_provider_type": "whisper_api"}'
        ),
    ),
) -> dict:
    """Set the transcription provider type."""
    raw = body.get("transcription_provider_type")
    provider_type = (str(raw) if raw is not None else "").strip().lower()
    valid = {"disabled", "whisper_api", "local_whisper"}
    if provider_type not in valid:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid transcription_provider_type '{provider_type}'. "
                f"Must be one of: {', '.join(sorted(valid))}"
            ),
        )
    config = load_config()
    config.agents.transcription_provider_type = provider_type
    save_config(config)
    return {"transcription_provider_type": provider_type}


@router.get(
    "/local-whisper-status",
    summary="Check local whisper availability",
    description=(
        "Check whether the local whisper provider can be used. "
        "Returns availability of ffmpeg and openai-whisper."
    ),
)
async def get_local_whisper_status() -> dict:
    """Check local whisper dependencies."""
    from ...agents.utils.audio_transcription import (
        check_local_whisper_available,
    )

    return await asyncio.to_thread(check_local_whisper_available)


@router.post(
    "/local-whisper-install",
    summary="Install local whisper dependencies",
    description=(
        "Attempt to install missing dependencies for the local whisper "
        "provider. Installs openai-whisper into the current Python "
        "environment and, when supported, installs ffmpeg via the OS "
        "package manager."
    ),
)
async def post_local_whisper_install() -> dict:
    """Attempt to install missing Local Whisper dependencies."""
    from ...agents.utils.audio_transcription import (
        auto_install_local_whisper_dependencies,
    )

    try:
        return await asyncio.to_thread(auto_install_local_whisper_dependencies)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.put(
    "/nlp-preload",
    summary="Update NLP preload settings",
    description="Update HanLP startup preload settings in top-level nlp config.",
)
async def put_nlp_preload(
    body: NLPPreloadUpdateBody = Body(
        ...,
        description="Startup preload settings payload",
    ),
) -> dict:
    config = load_config()
    config.nlp.preload_on_startup = bool(body.enabled)
    config.nlp.preload_scope = str(body.scope)
    save_config(config)

    from ...agents.utils.hanlp_sidecar import get_hanlp_preload_status, kickoff_hanlp_preload

    if body.enabled and str(getattr(config.nlp, "provider", "hanlp") or "hanlp").strip().lower() == "hanlp":
        await asyncio.to_thread(kickoff_hanlp_preload, True)

    return {
        "preload": await asyncio.to_thread(get_hanlp_preload_status, config),
    }


@router.post(
    "/nlp-preload",
    summary="Trigger NLP preload",
    description="Start HanLP preload in the background using the current preload settings.",
)
async def post_nlp_preload(
    body: NLPPreloadTriggerBody = Body(
        default=NLPPreloadTriggerBody(),
        description="Manual preload trigger payload",
    ),
) -> dict:
    from ...agents.utils.hanlp_sidecar import kickoff_hanlp_preload

    return {
        "preload": await asyncio.to_thread(kickoff_hanlp_preload, bool(body.force)),
    }


@router.put(
    "/nlp-strategy",
    summary="Update NLP routing strategy",
    description="Update request-scoped NLP model routing strategy in global knowledge config.",
)
async def put_nlp_strategy(
    body: NLPStrategyUpdateBody = Body(
        ...,
        description="NLP routing strategy payload",
    ),
) -> dict:
    """Update request-scoped NLP model routing strategy."""
    config = load_config()
    strategy = config.nlp.strategy

    strategy.mode = str(body.mode)
    strategy.default_model_id = str(body.default_model_id or "").strip()
    strategy.task_overrides = _normalize_task_overrides(body.task_overrides)
    strategy.auto_classical_chinese.enabled = bool(body.auto_classical_chinese.enabled)
    strategy.auto_classical_chinese.threshold = max(
        0.0,
        min(1.0, float(body.auto_classical_chinese.threshold)),
    )
    strategy.auto_classical_chinese.model_id = str(
        body.auto_classical_chinese.model_id or "",
    ).strip()

    save_config(config)
    return {
        "strategy": _build_nlp_strategy_payload(config.nlp),
    }


@router.post(
    "/nlp-strategy/dry-run",
    summary="Preview NLP strategy decision",
    description="Return request-level model routing decision metadata without executing NLP runtime.",
)
async def post_nlp_strategy_dry_run(
    body: NLPStrategyDryRunBody = Body(
        ...,
        description="Dry-run request payload",
    ),
) -> dict:
    """Preview model routing strategy decision for input text/task."""
    config = load_config()
    decision = _resolve_nlp_model_decision(body.task_key, body.text, config.nlp)
    return {
        "decision": decision,
        "strategy": _build_nlp_strategy_payload(config.nlp),
    }


@router.get(
    "/hanlp-status",
    summary="Check HanLP sidecar availability",
    description=(
        "Deprecated compatibility endpoint. "
        "Returns generic NLP placeholder status and migration hints."
    ),
)
async def get_hanlp_status() -> dict:
    """Compatibility wrapper for legacy HanLP status API."""
    from .sidecar import get_sidecar_nlp_status

    payload = await get_sidecar_nlp_status()
    payload["deprecated"] = True
    payload["migration"] = {
        "message": "Use /sidecar/nlp-status and top-level nlp configuration.",
        "target_endpoint": "/sidecar/nlp-status",
    }
    return payload


@router.post(
    "/hanlp-install",
    summary="Install HanLP sidecar",
    description=(
        "Create a managed HanLP sidecar environment with uv and install the "
        "HanLP package into it."
    ),
)
async def post_hanlp_install() -> dict:
    """Install HanLP sidecar runtime and full package dependencies."""
    from ...agents.utils.hanlp_sidecar import auto_install_hanlp_sidecar

    try:
        return await asyncio.to_thread(auto_install_hanlp_sidecar)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post(
    "/hanlp-download-model",
    summary="Download and verify HanLP model",
    description=(
        "Download the configured HanLP tokenizer model inside the managed "
        "sidecar and verify it can be loaded."
    ),
)
async def post_hanlp_download_model() -> dict:
    """Download and verify HanLP task models."""
    from ...agents.utils.hanlp_sidecar import ensure_hanlp_model

    try:
        return await asyncio.to_thread(ensure_hanlp_model)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get(
    "/transcription-providers",
    summary="List transcription providers",
    description=(
        "List providers capable of audio transcription (Whisper API). "
        "Returns available providers and the configured selection."
    ),
)
async def get_transcription_providers() -> dict:
    """List transcription-capable providers and configured selection."""
    from ...agents.utils.audio_transcription import (
        get_configured_transcription_provider_id,
        list_transcription_providers,
    )

    return {
        "providers": list_transcription_providers(),
        "configured_provider_id": (get_configured_transcription_provider_id()),
    }


@router.put(
    "/transcription-provider",
    summary="Set transcription provider",
    description=(
        "Set the provider to use for audio transcription. "
        'Use empty string "" to unset.'
    ),
)
async def put_transcription_provider(
    body: dict = Body(
        ...,
        description=(
            'Provider ID, e.g. {"provider_id": "openai"} '
            'or {"provider_id": ""} to unset'
        ),
    ),
) -> dict:
    """Set the transcription provider."""
    provider_id = (body.get("provider_id") or "").strip()
    config = load_config()
    config.agents.transcription_provider_id = provider_id
    save_config(config)
    return {"provider_id": provider_id}


@router.get(
    "/running-config",
    response_model=AgentsRunningConfig,
    summary="Get agent running config",
    description="Get running configuration for active agent",
)
async def get_agents_running_config(
    request: Request,
) -> AgentsRunningConfig:
    """Get agent running configuration."""
    agent_id = resolve_agent_id_for_request(request)
    workspace = get_loaded_agent_for_request(request, agent_id=agent_id)
    if workspace is not None:
        return workspace.config.running
    return load_agent_config(agent_id).running


@router.put(
    "/running-config",
    response_model=AgentsRunningConfig,
    summary="Update agent running config",
    description="Update running configuration for active agent",
)
async def put_agents_running_config(
    running_config: AgentsRunningConfig = Body(
        ...,
        description="Updated agent running configuration",
    ),
    request: Request = None,
) -> AgentsRunningConfig:
    """Update agent running configuration."""
    workspace = await get_agent_for_request(request)
    agent_config = load_agent_config(workspace.agent_id)
    previous_enabled = bool(getattr(agent_config.running, "knowledge_enabled", True))
    agent_config.running = running_config
    workspace.config.running = running_config

    if previous_enabled != running_config.knowledge_enabled:
        sync_knowledge_module_skills(running_config.knowledge_enabled)
    save_agent_config(workspace.agent_id, agent_config)

    # Hot reload config (async, non-blocking)
    schedule_agent_reload(request, workspace.agent_id)

    return running_config


@router.get(
    "/system-prompt-files",
    response_model=list[str],
    summary="Get system prompt files",
    description="Get system prompt files for active agent",
)
async def get_system_prompt_files(
    request: Request,
) -> list[str]:
    """Get list of enabled system prompt files."""
    workspace = await get_agent_for_request(request)
    agent_config = load_agent_config(workspace.agent_id)
    return agent_config.system_prompt_files or []


@router.put(
    "/system-prompt-files",
    response_model=list[str],
    summary="Update system prompt files",
    description="Update system prompt files for active agent",
)
async def put_system_prompt_files(
    files: list[str] = Body(
        ...,
        description="Markdown filenames to load into system prompt",
    ),
    request: Request = None,
) -> list[str]:
    """Update list of enabled system prompt files."""
    workspace = await get_agent_for_request(request)
    agent_config = load_agent_config(workspace.agent_id)
    agent_config.system_prompt_files = files
    save_agent_config(workspace.agent_id, agent_config)

    # Hot reload config (async, non-blocking)
    schedule_agent_reload(request, workspace.agent_id)

    return files
