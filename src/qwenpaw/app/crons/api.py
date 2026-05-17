# -*- coding: utf-8 -*-
from __future__ import annotations

import uuid
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from .manager import CronManager
from .models import (
    CronDispatchTargetItem,
    CronDispatchTargetsResponse,
    CronExecutionRecord,
    CronJobSpec,
    CronJobState,
    CronJobView,
)
from .repo.json_repo import JsonJobRepository
from ..runner.repo.json_repo import JsonChatRepository
from ..agent_context import (
    get_loaded_agent_for_request,
    resolve_agent_id_for_request,
)
from ...config.utils import load_config

router = APIRouter(prefix="/cron", tags=["cron"])


async def get_cron_manager(
    request: Request,
) -> CronManager:
    """Get cron manager for the active agent."""
    from ..agent_context import get_agent_for_request

    workspace = await get_agent_for_request(request)
    if workspace.cron_manager is None:
        raise HTTPException(
            status_code=500,
            detail="CronManager not initialized",
        )
    return workspace.cron_manager


def _resolve_workspace_dir(request: Request) -> Path:
    agent_id = resolve_agent_id_for_request(request)
    config = load_config()
    return Path(config.agents.profiles[agent_id].workspace_dir).expanduser()


def _job_repo_for_request(request: Request) -> JsonJobRepository:
    workspace_dir = _resolve_workspace_dir(request)
    return JsonJobRepository(workspace_dir / "jobs.json")


def _chat_repo_for_request(request: Request) -> JsonChatRepository:
    workspace_dir = _resolve_workspace_dir(request)
    return JsonChatRepository(workspace_dir / "chats.json")


@router.get(
    "/dispatch-targets",
    response_model=CronDispatchTargetsResponse,
)
async def list_dispatch_targets(
    request: Request,
    channel: str
    | None = Query(
        default=None,
        description="Optional channel filter",
    ),
    keyword: str
    | None = Query(
        default=None,
        description="Optional keyword for user/session/channel",
    ),
    limit: int = Query(
        default=500,
        ge=1,
        le=2000,
        description="Max number of target items",
    ),
):
    """List candidate dispatch targets derived from known chats."""
    workspace = get_loaded_agent_for_request(request)
    if workspace is not None and workspace.chat_manager is not None:
        chats = await workspace.chat_manager.list_chats(channel=channel)
    else:
        chat_repo = _chat_repo_for_request(request)
        chats = await chat_repo.filter_chats(channel=channel)
    kw = (keyword or "").strip().lower()

    deduped: dict[tuple[str, str, str], CronDispatchTargetItem] = {}
    for chat in chats:
        item = CronDispatchTargetItem(
            channel=chat.channel,
            user_id=chat.user_id,
            session_id=chat.session_id,
        )
        if kw:
            haystack = (
                f"{item.channel} {item.user_id} {item.session_id}".lower()
            )
            if kw not in haystack:
                continue
        deduped[(item.channel, item.user_id, item.session_id)] = item
        if len(deduped) >= limit:
            break

    items = list(deduped.values())
    channels = sorted({item.channel for item in items})
    if "console" not in channels:
        channels.insert(0, "console")
    return CronDispatchTargetsResponse(channels=channels, items=items)


@router.get("/jobs", response_model=list[CronJobSpec])
async def list_jobs(request: Request):
    workspace = get_loaded_agent_for_request(request)
    if workspace is not None and workspace.cron_manager is not None:
        return await workspace.cron_manager.list_jobs()

    repo = _job_repo_for_request(request)
    return await repo.list_jobs()


@router.get("/jobs/{job_id}", response_model=CronJobView)
async def get_job(job_id: str, request: Request):
    workspace = get_loaded_agent_for_request(request)
    if workspace is not None and workspace.cron_manager is not None:
        job = await workspace.cron_manager.get_job(job_id)
        state = workspace.cron_manager.get_state(job_id)
    else:
        repo = _job_repo_for_request(request)
        job = await repo.get_job(job_id)
        state = CronJobState()

    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return CronJobView(spec=job, state=state)


@router.post("/jobs", response_model=CronJobSpec)
async def create_job(
    spec: CronJobSpec,
    request: Request,
):
    # server generates id; ignore client-provided spec.id
    job_id = str(uuid.uuid4())
    created = spec.model_copy(update={"id": job_id})
    workspace = get_loaded_agent_for_request(request)
    try:
        if workspace is not None and workspace.cron_manager is not None:
            await workspace.cron_manager.create_or_replace_job(created)
        else:
            repo = _job_repo_for_request(request)
            await repo.upsert_job(created)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return created


@router.put("/jobs/{job_id}", response_model=CronJobSpec)
async def replace_job(
    job_id: str,
    spec: CronJobSpec,
    request: Request,
):
    if spec.id is None:
        spec.id = job_id
    elif spec.id != job_id:
        raise HTTPException(status_code=400, detail="job_id mismatch")
    workspace = get_loaded_agent_for_request(request)
    try:
        if workspace is not None and workspace.cron_manager is not None:
            await workspace.cron_manager.create_or_replace_job(spec)
        else:
            repo = _job_repo_for_request(request)
            await repo.upsert_job(spec)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return spec


@router.delete("/jobs/{job_id}")
async def delete_job(
    job_id: str,
    request: Request,
):
    workspace = get_loaded_agent_for_request(request)
    if workspace is not None and workspace.cron_manager is not None:
        ok = await workspace.cron_manager.delete_job(job_id)
    else:
        repo = _job_repo_for_request(request)
        ok = await repo.delete_job(job_id)

    if not ok:
        raise HTTPException(status_code=404, detail="job not found")
    return {"deleted": True}


@router.post("/jobs/{job_id}/pause")
async def pause_job(job_id: str, mgr: CronManager = Depends(get_cron_manager)):
    try:
        await mgr.pause_job(job_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"paused": True}


@router.post("/jobs/{job_id}/resume")
async def resume_job(
    job_id: str,
    mgr: CronManager = Depends(get_cron_manager),
):
    try:
        await mgr.resume_job(job_id)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"resumed": True}


@router.post("/jobs/{job_id}/run")
async def run_job(job_id: str, mgr: CronManager = Depends(get_cron_manager)):
    try:
        await mgr.run_job(job_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail="job not found") from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {"started": True}


@router.get("/jobs/{job_id}/state")
async def get_job_state(
    job_id: str,
    request: Request,
):
    workspace = get_loaded_agent_for_request(request)
    if workspace is not None and workspace.cron_manager is not None:
        job = await workspace.cron_manager.get_job(job_id)
        state = workspace.cron_manager.get_state(job_id)
    else:
        repo = _job_repo_for_request(request)
        job = await repo.get_job(job_id)
        state = CronJobState()

    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return state.model_dump(mode="json")


@router.get("/jobs/{job_id}/history", response_model=list[CronExecutionRecord])
async def get_job_history(
    job_id: str,
    request: Request,
):
    workspace = get_loaded_agent_for_request(request)
    if workspace is not None and workspace.cron_manager is not None:
        job = await workspace.cron_manager.get_job(job_id)
    else:
        repo = _job_repo_for_request(request)
        job = await repo.get_job(job_id)

    if not job:
        raise HTTPException(status_code=404, detail="job not found")

    if workspace is not None and workspace.cron_manager is not None:
        return await workspace.cron_manager.get_history(job_id)

    repo = _job_repo_for_request(request)
    return await repo.get_history(job_id)
