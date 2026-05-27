# -*- coding: utf-8 -*-

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from copaw.app.flow_engine import (
    FlowDefinition,
    FlowDefinitionNotFoundError,
    FlowEngineError,
    FlowRunNotFoundError,
    FlowTransitionConflictError,
    FlowTransitionNotAllowedError,
)

from ..agent_context import resolve_agent_id_for_request
from ..flow_engine_runtime import get_flow_engine_service

router = APIRouter(prefix="/flows", tags=["flows"])


def _flow_error_detail(exc: FlowEngineError) -> dict[str, str]:
    return {
        "error_code": exc.error_code,
        "message": str(exc),
    }


class FlowRunCreateRequest(BaseModel):
    definition_id: str
    scope_kind: str
    scope_id: str
    priority: int = 100
    idempotency_key: str = ""


class FlowCommandRequest(BaseModel):
    command_type: Literal["pause", "resume", "cancel"]
    payload: dict[str, Any] = Field(default_factory=dict)


async def _get_agent_flow_service(request: Request):
    agent_id = resolve_agent_id_for_request(request)
    service = getattr(request.app.state, "flow_engine_service", None)
    if service is None:
        service = get_flow_engine_service()
    return agent_id, service


@router.get("/definitions", response_model=list[FlowDefinition])
async def list_flow_definitions(ctx=Depends(_get_agent_flow_service)):
    _agent_id, service = ctx
    return service.list_definitions()


@router.post("/definitions", response_model=FlowDefinition)
async def upsert_flow_definition(
    definition: FlowDefinition,
    ctx=Depends(_get_agent_flow_service),
):
    _agent_id, service = ctx
    try:
        return service.register_definition(definition)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/runs")
async def list_flow_runs(
    request: Request,
    scope_kind: str | None = Query(default=None),
    scope_id: str | None = Query(default=None),
    ctx=Depends(_get_agent_flow_service),
):
    agent_id, service = ctx
    runs = service.list_runs(agent_id=agent_id, scope_kind=scope_kind, scope_id=scope_id)
    return [item.model_dump(mode="json") for item in runs]


@router.post("/runs")
async def create_flow_run(
    payload: FlowRunCreateRequest,
    ctx=Depends(_get_agent_flow_service),
):
    agent_id, service = ctx
    try:
        run = service.enqueue_run(
            agent_id=agent_id,
            definition_id=payload.definition_id,
            scope_kind=payload.scope_kind,
            scope_id=payload.scope_id,
            priority=payload.priority,
            idempotency_key=payload.idempotency_key,
        )
    except FlowDefinitionNotFoundError as exc:
        raise HTTPException(status_code=404, detail=_flow_error_detail(exc)) from exc
    return run.model_dump(mode="json")


@router.get("/runs/{run_id}")
async def get_flow_run(run_id: str, ctx=Depends(_get_agent_flow_service)):
    agent_id, service = ctx
    detail = service.get_run_timeline(run_id=run_id, agent_id=agent_id)
    if detail is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error_code": FlowRunNotFoundError.error_code,
                "message": f"Flow run '{run_id}' not found",
            },
        )
    return {
        "run": detail["run"].model_dump(mode="json"),
        "events": [item.model_dump(mode="json") for item in detail["events"]],
        "commands": [item.model_dump(mode="json") for item in detail["commands"]],
    }


@router.post("/runs/{run_id}/commands")
async def command_flow_run(
    run_id: str,
    payload: FlowCommandRequest,
    ctx=Depends(_get_agent_flow_service),
):
    agent_id, service = ctx
    try:
        if payload.command_type == "pause":
            updated = service.pause_run(
                agent_id=agent_id,
                run_id=run_id,
                payload=payload.payload,
            )
        elif payload.command_type == "resume":
            updated = service.resume_run(
                agent_id=agent_id,
                run_id=run_id,
                payload=payload.payload,
            )
        else:
            updated = service.cancel_run(
                agent_id=agent_id,
                run_id=run_id,
                payload=payload.payload,
            )

        commands = service.repo.list_commands(run_id, agent_id=agent_id)
        command = commands[-1] if commands else None
        if command is None:
            raise RuntimeError("flow command write failed")
    except FlowRunNotFoundError as exc:
        raise HTTPException(status_code=404, detail=_flow_error_detail(exc)) from exc
    except (FlowTransitionNotAllowedError, FlowTransitionConflictError) as exc:
        raise HTTPException(status_code=409, detail=_flow_error_detail(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "command": command.model_dump(mode="json"),
        "run": updated.model_dump(mode="json"),
    }
