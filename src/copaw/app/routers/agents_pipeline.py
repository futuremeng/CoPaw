# -*- coding: utf-8 -*-
"""Project pipeline APIs split from agents router to reduce merge conflicts."""
from pathlib import Path
import json

from fastapi import APIRouter, HTTPException, Request
from fastapi import Path as PathParam
from fastapi import Query
from fastapi.responses import StreamingResponse

from . import agents as agents_router_impl
from .agents_pipeline_core import (
    CreatePipelineRunRequest,
    ImportPlatformTemplateRequest,
    PlatformFlowTemplateInfo,
    PlatformTemplateVersionRecord,
    ProjectFlowInstanceInfo,
    PublishProjectTemplateRequest,
    PipelineDraftInfo,
    PipelineRunDetail,
    PipelineRunSummary,
    PipelineTemplateInfo,
    PipelineTemplateStep,
    _list_agent_pipeline_templates,
    _create_project_pipeline_run,
    _ensure_pipeline_draft_workspace,
    _get_pipeline_draft,
    _import_platform_template_to_project,
    _list_platform_template_versions,
    _list_platform_flow_templates,
    _save_agent_pipeline_template_with_md,
    _list_project_pipeline_runs,
    _list_project_pipeline_templates,
    _load_project_pipeline_run,
    _publish_project_template_to_platform,
    _add_or_update_step,
    _delete_step,
)

router = APIRouter(prefix="/agents", tags=["agents"])


@router.get(
    "/{agentId}/pipelines/templates",
    response_model=list[PipelineTemplateInfo],
    summary="List agent pipeline templates",
    description="List available agent-level pipeline templates",
)
async def list_agent_pipeline_templates(
    request: Request,
    agentId: str = PathParam(...),
) -> list[PipelineTemplateInfo]:
    """List available agent-level pipeline templates."""
    manager = agents_router_impl._get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        return _list_agent_pipeline_templates(Path(workspace.workspace_dir))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/{agentId}/pipelines/platform/templates",
    response_model=list[PlatformFlowTemplateInfo],
    summary="List platform flow templates",
    description="List project-agnostic flow templates from platform library",
)
async def list_platform_flow_templates(
    request: Request,
    agentId: str = PathParam(...),
) -> list[PlatformFlowTemplateInfo]:
    """List project-agnostic flow templates from platform library."""
    manager = agents_router_impl._get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        return _list_platform_flow_templates(Path(workspace.workspace_dir))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/{agentId}/pipelines/platform/templates/{templateId}/versions",
    response_model=list[PlatformTemplateVersionRecord],
    summary="List platform template version history",
    description="List published versions of one platform flow template",
)
async def list_platform_template_versions(
    request: Request,
    agentId: str = PathParam(...),
    templateId: str = PathParam(...),
) -> list[PlatformTemplateVersionRecord]:
    """List published versions of one platform flow template."""
    manager = agents_router_impl._get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        return _list_platform_template_versions(
            Path(workspace.workspace_dir),
            templateId,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.put(
    "/{agentId}/pipelines/templates/{templateId}",
    response_model=PipelineTemplateInfo,
    summary="Save agent pipeline template",
    description="Create or update one agent-level pipeline template",
)
async def save_agent_pipeline_template(
    request: Request,
    body: PipelineTemplateInfo,
    agentId: str = PathParam(...),
    templateId: str = PathParam(...),
    expectedRevision: int | None = Query(default=None),
) -> PipelineTemplateInfo:
    """Create or update one agent-level pipeline template."""
    manager = agents_router_impl._get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        normalized = body.model_copy(update={"id": templateId})
        return _save_agent_pipeline_template_with_md(
            Path(workspace.workspace_dir),
            normalized,
            expected_revision=expectedRevision,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/{agentId}/pipelines/templates/{templateId}/save/stream",
    summary="Save pipeline template with SSE progress",
    description="Save template from markdown source-of-truth and stream validation/save stages",
)
async def save_agent_pipeline_template_stream(
    request: Request,
    body: PipelineTemplateInfo,
    agentId: str = PathParam(...),
    templateId: str = PathParam(...),
    expectedRevision: int | None = Query(default=None),
) -> StreamingResponse:
    """Stream save stages so frontend can show progress and structured errors."""
    manager = agents_router_impl._get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    workspace_dir = Path(workspace.workspace_dir)
    normalized = body.model_copy(update={"id": templateId})

    async def _event_stream():
        def _event(event: str, payload: dict) -> str:
            data = {
                "event": event,
                "agent_id": agentId,
                "pipeline_id": templateId,
                "payload": payload,
            }
            return f"data: {json.dumps(data, ensure_ascii=False)}\\n\\n"

        yield _event("validation_started", {"expected_revision": expectedRevision})
        try:
            saved = _save_agent_pipeline_template_with_md(
                workspace_dir,
                normalized,
                expected_revision=expectedRevision,
            )
            yield _event(
                "saved",
                {
                    "revision": saved.revision,
                    "content_hash": saved.content_hash,
                    "md_mtime": saved.md_mtime,
                },
            )
            yield _event("done", {"ok": True})
        except HTTPException as exc:
            yield _event(
                "validation_failed" if exc.status_code == 422 else "save_failed",
                {
                    "ok": False,
                    "status_code": exc.status_code,
                    "detail": exc.detail,
                },
            )
            yield _event("done", {"ok": False})
        except Exception as exc:
            yield _event(
                "save_failed",
                {
                    "ok": False,
                    "status_code": 500,
                    "detail": str(exc),
                },
            )
            yield _event("done", {"ok": False})

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.get(
    "/{agentId}/pipelines/templates/{templateId}/draft",
    response_model=PipelineDraftInfo,
    summary="Get pipeline draft from markdown workspace",
    description="Read the agent-editable markdown file and return parsed pipeline steps",
)
async def get_agent_pipeline_draft(
    request: Request,
    agentId: str = PathParam(...),
    templateId: str = PathParam(...),
) -> PipelineDraftInfo:
    """Return parsed steps from the pipeline markdown workspace file."""
    manager = agents_router_impl._get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        draft = _get_pipeline_draft(Path(workspace.workspace_dir), templateId)
        if draft is None:
            draft = _ensure_pipeline_draft_workspace(
                Path(workspace.workspace_dir),
                PipelineTemplateInfo(
                    id=templateId,
                    name=templateId,
                    version="0.1.0",
                    description="",
                    steps=[],
                ),
            )
        return draft
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/{agentId}/pipelines/templates/{templateId}/draft/ensure",
    response_model=PipelineDraftInfo,
    summary="Ensure pipeline markdown draft workspace",
    description="Create the markdown workspace and flow memory for pipeline editing when missing",
)
async def ensure_agent_pipeline_draft(
    request: Request,
    body: PipelineTemplateInfo,
    agentId: str = PathParam(...),
    templateId: str = PathParam(...),
) -> PipelineDraftInfo:
    """Ensure pipeline markdown workspace exists before opening edit chat."""
    manager = agents_router_impl._get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        normalized = body.model_copy(update={"id": templateId})
        return _ensure_pipeline_draft_workspace(Path(workspace.workspace_dir), normalized)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/{agentId}/projects/{projectId}/pipelines/templates",
    response_model=list[PipelineTemplateInfo],
    summary="List project pipeline templates",
    description="List available pipeline templates for a project",
)
async def list_project_pipeline_templates(
    request: Request,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> list[PipelineTemplateInfo]:
    """List available pipeline templates for a project."""
    manager = agents_router_impl._get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        project_dir = agents_router_impl._resolve_project_dir(Path(workspace.workspace_dir), projectId)
        return _list_project_pipeline_templates(project_dir)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/{agentId}/projects/{projectId}/pipelines/platform/import",
    response_model=ProjectFlowInstanceInfo,
    summary="Import platform template into project",
    description="Create one project flow instance from a platform template",
)
async def import_platform_template_into_project(
    request: Request,
    body: ImportPlatformTemplateRequest,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> ProjectFlowInstanceInfo:
    """Create one project flow instance from a platform template."""
    manager = agents_router_impl._get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        workspace_dir = Path(workspace.workspace_dir)
        project_dir = agents_router_impl._resolve_project_dir(
            workspace_dir,
            projectId,
        )
        platform_templates = {
            item.id: item
            for item in _list_platform_flow_templates(workspace_dir)
        }
        target_template = platform_templates.get(body.platform_template_id)
        if target_template is None:
            raise HTTPException(
                status_code=404,
                detail=(
                    "Platform template "
                    f"'{body.platform_template_id}' not found"
                ),
            )

        return _import_platform_template_to_project(
            projectId,
            project_dir,
            target_template,
            target_template_id=body.target_template_id,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/{agentId}/projects/{projectId}/pipelines/templates/{templateId}/publish-platform",
    response_model=PlatformFlowTemplateInfo,
    summary="Publish project template to platform",
    description="Standardize one project flow instance as platform template",
)
async def publish_project_template_to_platform(
    request: Request,
    body: PublishProjectTemplateRequest,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
    templateId: str = PathParam(...),
) -> PlatformFlowTemplateInfo:
    """Standardize one project flow instance as platform template."""
    manager = agents_router_impl._get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    bump = (body.bump or "patch").strip().lower()
    if bump not in {"major", "minor", "patch"}:
        raise HTTPException(
            status_code=400,
            detail="bump must be one of: major, minor, patch",
        )

    try:
        workspace_dir = Path(workspace.workspace_dir)
        project_dir = agents_router_impl._resolve_project_dir(
            workspace_dir,
            projectId,
        )
        return _publish_project_template_to_platform(
            projectId,
            project_dir,
            workspace_dir,
            templateId,
            platform_template_id=body.platform_template_id,
            bump=bump,
            tags=body.tags,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/{agentId}/projects/{projectId}/pipelines/runs",
    response_model=list[PipelineRunSummary],
    summary="List project pipeline runs",
    description="List pipeline runs under a project",
)
async def list_project_pipeline_runs(
    request: Request,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> list[PipelineRunSummary]:
    """List pipeline runs under a project."""
    manager = agents_router_impl._get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        project_dir = agents_router_impl._resolve_project_dir(Path(workspace.workspace_dir), projectId)
        return _list_project_pipeline_runs(project_dir)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get(
    "/{agentId}/projects/{projectId}/pipelines/runs/{runId}",
    response_model=PipelineRunDetail,
    summary="Get project pipeline run",
    description="Get one pipeline run detail under a project",
)
async def get_project_pipeline_run(
    request: Request,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
    runId: str = PathParam(...),
) -> PipelineRunDetail:
    """Get one pipeline run detail under a project."""
    manager = agents_router_impl._get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        project_dir = agents_router_impl._resolve_project_dir(Path(workspace.workspace_dir), projectId)
        return _load_project_pipeline_run(project_dir, runId)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post(
    "/{agentId}/projects/{projectId}/pipelines/runs",
    response_model=PipelineRunDetail,
    summary="Create project pipeline run",
    description="Create a new pipeline run from one template",
)
async def create_project_pipeline_run(
    request: Request,
    body: CreatePipelineRunRequest,
    agentId: str = PathParam(...),
    projectId: str = PathParam(...),
) -> PipelineRunDetail:
    """Create a new pipeline run from one template."""
    manager = agents_router_impl._get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        project_dir = agents_router_impl._resolve_project_dir(Path(workspace.workspace_dir), projectId)
        return _create_project_pipeline_run(projectId, project_dir, body)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


# ============================================================================
# Step-level operations (add, update, delete single steps)
# ============================================================================


@router.post(
    "/{agentId}/pipelines/templates/{templateId}/steps",
    response_model=PipelineTemplateInfo,
    summary="Add or update a pipeline step",
    description="Add a new step or update an existing step in a pipeline template",
)
async def add_or_update_pipeline_step(
    request: Request,
    body: PipelineTemplateStep,
    agentId: str = PathParam(...),
    templateId: str = PathParam(...),
    operation: str = Query(default="update", description="Either 'add' or 'update'"),
    expectedRevision: int | None = Query(default=None),
) -> PipelineTemplateInfo:
    """Add a new step or update an existing step in a pipeline template."""
    if operation not in ("add", "update"):
        raise HTTPException(status_code=400, detail="operation must be 'add' or 'update'")
    
    manager = agents_router_impl._get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        return _add_or_update_step(
            Path(workspace.workspace_dir),
            templateId,
            body,
            operation=operation,
            expected_revision=expectedRevision,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.delete(
    "/{agentId}/pipelines/templates/{templateId}/steps/{stepId}",
    response_model=PipelineTemplateInfo,
    summary="Delete a pipeline step",
    description="Delete one step from a pipeline template",
)
async def delete_pipeline_step(
    request: Request,
    agentId: str = PathParam(...),
    templateId: str = PathParam(...),
    stepId: str = PathParam(...),
    expectedRevision: int | None = Query(default=None),
) -> PipelineTemplateInfo:
    """Delete one step from a pipeline template."""
    manager = agents_router_impl._get_multi_agent_manager(request)

    try:
        workspace = await manager.get_agent(agentId)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    try:
        return _delete_step(
            Path(workspace.workspace_dir),
            templateId,
            stepId,
            expected_revision=expectedRevision,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
