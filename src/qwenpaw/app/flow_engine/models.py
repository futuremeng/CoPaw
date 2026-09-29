# -*- coding: utf-8 -*-

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field


FLOW_ENGINE_SCHEMA_VERSION = 2


def flow_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class FlowStepDefinition(BaseModel):
    id: str
    name: str
    kind: str
    executor: str = ""
    description: str = ""
    depends_on: list[str] = Field(default_factory=list)
    retry_policy: dict[str, Any] = Field(default_factory=dict)


class FlowDefinition(BaseModel):
    id: str
    name: str
    version: str = ""
    description: str = ""
    steps: list[FlowStepDefinition] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    system_owned: bool = False
    created_at: str = Field(default_factory=flow_now_iso)
    updated_at: str = Field(default_factory=flow_now_iso)


class FlowRunRecord(BaseModel):
    id: str
    agent_id: str = ""
    definition_id: str
    scope_kind: str
    scope_id: str
    status: str
    priority: int = 100
    idempotency_key: str = ""
    current_step_id: str = ""
    created_at: str = Field(default_factory=flow_now_iso)
    updated_at: str = Field(default_factory=flow_now_iso)


class FlowEventRecord(BaseModel):
    id: str
    agent_id: str = ""
    run_id: str
    event_type: str
    status: str = ""
    step_id: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=flow_now_iso)


class FlowCommandRecord(BaseModel):
    id: str
    agent_id: str = ""
    run_id: str
    command_type: str
    payload: dict[str, Any] = Field(default_factory=dict)
    status: str = "pending"
    created_at: str = Field(default_factory=flow_now_iso)
    updated_at: str = Field(default_factory=flow_now_iso)