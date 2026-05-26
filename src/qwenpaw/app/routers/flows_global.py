# -*- coding: utf-8 -*-

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from ..flow_engine_runtime import get_flow_engine_service

router = APIRouter(prefix="/flows/global", tags=["flows-global"])


async def _get_service():
    return get_flow_engine_service()


@router.get("/runs")
async def list_runs_global(
    agent_id: str | None = Query(default=None),
    scope_kind: str | None = Query(default=None),
    scope_id: str | None = Query(default=None),
):
    service = await _get_service()
    runs = service.list_runs(agent_id=agent_id, scope_kind=scope_kind, scope_id=scope_id)
    return [item.model_dump(mode="json") for item in runs]


@router.get("/runs/{run_id}")
async def get_run_global(run_id: str):
    service = await _get_service()
    detail = service.get_run_timeline(run_id=run_id, agent_id=None)
    if detail is None:
        raise HTTPException(status_code=404, detail="run not found")
    return {
        "run": detail["run"].model_dump(mode="json"),
        "events": [item.model_dump(mode="json") for item in detail["events"]],
        "commands": [item.model_dump(mode="json") for item in detail["commands"]],
    }


@router.get("/agents/{agent_id}/summary")
async def get_agent_flow_summary(agent_id: str):
    service = await _get_service()
    runs = service.list_runs(agent_id=agent_id)
    status_counts: dict[str, int] = {}
    for run in runs:
        status_counts[run.status] = status_counts.get(run.status, 0) + 1
    return {
        "agent_id": agent_id,
        "total_runs": len(runs),
        "status_counts": status_counts,
    }
