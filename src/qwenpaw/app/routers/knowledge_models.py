# -*- coding: utf-8 -*-

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ProjectPipelineRuntimeMetaPayload(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "operation_id": "manual-flow-resume:project-alpha",
                "idempotency_key": "manual-flow-resume:flow-run-abc123",
                "last_action": "flow_resume",
                "recent_control_command": "resume",
                "control_updated_at": "2026-05-26T12:00:00+00:00",
                "flow_run_id": "flow-run-abc123",
                "deduplicated": False,
            }
        }
    )

    operation_id: str = Field(default="", description="Latest operation id recorded for project pipeline runtime events.")
    idempotency_key: str = Field(default="", description="Idempotency key associated with the latest operation.")
    last_action: str = Field(default="", description="Latest runtime action label, for example start_sync or flow_resume.")
    recent_control_command: str = Field(default="", description="Latest explicit control command, for example pause/resume/cancel.")
    control_updated_at: str = Field(default="", description="UTC timestamp when recent_control_command was last updated.")
    flow_run_id: str = Field(default="", description="Bridged flow engine run id for this project pipeline.")
    deduplicated: bool = Field(default=False, description="Whether the latest operation was deduplicated.")


class ProjectPipelineCommandResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "project_id": "project-alpha",
                "flow_run_id": "flow-run-abc123",
                "command_type": "resume",
                "run": {
                    "id": "flow-run-abc123",
                    "status": "running",
                },
                "runtime_meta": {
                    "operation_id": "manual-flow-resume:project-alpha",
                    "idempotency_key": "manual-flow-resume:flow-run-abc123",
                    "last_action": "flow_resume",
                    "recent_control_command": "resume",
                    "control_updated_at": "2026-05-26T12:00:00+00:00",
                    "flow_run_id": "flow-run-abc123",
                    "deduplicated": False,
                },
            }
        }
    )

    project_id: str = Field(description="Target project id.")
    flow_run_id: str = Field(description="Bridged flow engine run id.")
    command_type: str = Field(description="Control command type: pause/resume/cancel.")
    run: dict[str, object] = Field(default_factory=dict, description="Updated flow run snapshot returned by flow engine.")
    runtime_meta: ProjectPipelineRuntimeMetaPayload = Field(description="Latest project pipeline runtime metadata.")


class ProjectPipelineStatusResponse(BaseModel):
    model_config = ConfigDict(
        extra="allow",
        json_schema_extra={
            "example": {
                "project_id": "project-alpha",
                "status": "indexing",
                "operation_id": "ps-0123456789abcdef",
                "idempotency_key": "route-status-resume:project-alpha",
                "deduplicated": True,
                "last_action": "resume_sync",
                "operation_updated_at": "2026-05-26T12:00:10+00:00",
                "flow_run_id": "flow-run-abc123",
                "recent_control_command": "resume",
                "control_updated_at": "2026-05-26T12:00:00+00:00",
                "step_outputs": {
                    "snapshot_raw": {
                        "snapshot_manifest_path": ".knowledge/sources/project-alpha/snapshot-manifest.json",
                        "snapshot_count": 4,
                    },
                    "tokenize": {
                        "tokenize_manifest_path": ".knowledge/sources/project-alpha/tokenize-manifest.json",
                        "token_count": 320,
                    },
                },
                "recent_error_code": "",
                "recent_error_source": "",
                "lanes": {
                    "retrieval": {"mode": "fast"},
                    "quantization": {"mode": "nlp"},
                },
                "quantization_stages": {
                    "l1": {},
                    "l2": {},
                    "l3": {},
                },
            }
        },
    )

    project_id: str = Field(default="", description="Target project id.")
    status: str = Field(default="", description="Current project pipeline status.")
    operation_id: str = Field(default="", description="Latest operation id.")
    idempotency_key: str = Field(default="", description="Latest idempotency key.")
    deduplicated: bool = Field(default=False, description="Whether the latest operation was deduplicated.")
    last_action: str = Field(default="", description="Latest runtime action label.")
    operation_updated_at: str = Field(default="", description="UTC timestamp of latest runtime event update.")
    flow_run_id: str = Field(default="", description="Bridged flow engine run id.")
    recent_control_command: str = Field(default="", description="Latest control command issued through commands endpoint.")
    control_updated_at: str = Field(default="", description="UTC timestamp of latest control command update.")
    step_outputs: dict[str, dict[str, object]] = Field(
        default_factory=dict,
        description="Latest per-step output payloads keyed by step id.",
    )
    recent_error_code: str = Field(default="", description="Latest pipeline error code if available.")
    recent_error_source: Literal["", "workflow_step", "execution_loop", "flow_control"] = Field(
        default="",
        description="Source category of latest pipeline error code.",
    )


class ProjectPipelineRunResponse(BaseModel):
    model_config = ConfigDict(
        extra="allow",
        json_schema_extra={
            "example": {
                "accepted": True,
                "reason": "STARTED",
                "status": "queued",
                "project_id": "project-alpha",
                "operation_id": "ps-0123456789abcdef",
                "idempotency_key": "manual-op-key-1",
                "deduplicated": False,
                "flow_run_id": "flow-run-abc123",
                "state": {
                    "project_id": "project-alpha",
                    "status": "queued",
                },
            }
        },
    )

    accepted: bool = Field(default=False, description="Whether the run request was accepted.")
    reason: str = Field(default="", description="Reason code/message for acceptance decision.")
    status: str = Field(default="", description="Current project pipeline status after run request.")
    project_id: str = Field(default="", description="Target project id.")
    operation_id: str = Field(default="", description="Operation id generated for this run request.")
    idempotency_key: str = Field(default="", description="Idempotency key used for this run request.")
    deduplicated: bool = Field(default=False, description="Whether this run request was deduplicated.")
    flow_run_id: str = Field(default="", description="Bridged flow engine run id created/reused for this run.")


class ProjectPipelineSourcesResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "project_id": "project-alpha",
                "manual_source_paths": [
                    "original/requirements.md",
                    "output/design/overview.md",
                ],
                "manual_sources": [
                    {
                        "path": "original/requirements.md",
                        "category": "document",
                        "stage": "original",
                        "content_type": "md",
                        "size_bytes": 1024,
                        "modified_time": "2026-05-28T12:00:00Z",
                    }
                ],
            }
        }
    )

    class SourceItem(BaseModel):
        path: str = Field(default="", description="Project-relative file path.")
        category: str = Field(default="document", description="Normalized category: document|structured|image.")
        stage: str = Field(default="other", description="Inferred project file stage.")
        content_type: str = Field(default="", description="File extension based content type label.")
        size_bytes: int = Field(default=0, description="File size in bytes.")
        modified_time: str = Field(default="", description="File modified timestamp in ISO format when available.")

    project_id: str = Field(default="", description="Target project id.")
    manual_source_paths: list[str] = Field(
        default_factory=list,
        description="Manually curated source file paths used by project knowledge processing.",
    )
    manual_sources: list[SourceItem] = Field(
        default_factory=list,
        description="Manual sources with normalized category and file metadata.",
    )


class ProjectPipelineSourceCandidatesResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "project_id": "project-alpha",
                "candidates": [
                    {
                        "path": "original/requirements.md",
                        "category": "document",
                        "stage": "original",
                        "content_type": "md",
                        "size_bytes": 1024,
                        "modified_time": "2026-05-28T12:00:00Z",
                    },
                    {
                        "path": "data/schema.json",
                        "category": "structured",
                        "stage": "intermediate",
                        "content_type": "json",
                        "size_bytes": 2048,
                        "modified_time": "2026-05-28T12:10:00Z",
                    },
                ],
            }
        }
    )

    class CandidateItem(BaseModel):
        path: str = Field(default="", description="Project-relative file path.")
        category: str = Field(default="document", description="Normalized category: document|structured|image.")
        stage: str = Field(default="other", description="Inferred project file stage.")
        content_type: str = Field(default="", description="File extension based content type label.")
        size_bytes: int = Field(default=0, description="File size in bytes.")
        modified_time: str = Field(default="", description="File modified timestamp in ISO format when available.")

    project_id: str = Field(default="", description="Target project id.")
    candidates: list[CandidateItem] = Field(
        default_factory=list,
        description="Auto-discovered candidate source file metadata for manual selection.",
    )
