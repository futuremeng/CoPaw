# -*- coding: utf-8 -*-
"""Chat models for runner with UUID management."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field
from agentscope_runtime.engine.schemas.agent_schemas import Message

from ..channels.schema import DEFAULT_CHANNEL


class ChatSpec(BaseModel):
    """Chat specification with UUID identifier.

    Stored in Redis and can be persisted in JSON file.
    """

    id: str = Field(
        default_factory=lambda: str(uuid4()),
        description="Chat UUID identifier",
    )
    name: str = Field(default="New Chat", description="Chat name")
    session_id: str = Field(
        ...,
        description="Session identifier (channel:user_id format)",
    )
    user_id: str = Field(..., description="User identifier")
    channel: str = Field(default=DEFAULT_CHANNEL, description="Channel name")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Chat creation timestamp",
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="Chat last update timestamp",
    )
    meta: Dict[str, Any] = Field(
        default_factory=dict,
        description="Additional metadata",
    )
    status: str = Field(
        default="idle",
        description="Conversation status: idle or running",
    )


class ChatUpdate(BaseModel):
    """Mutable chat fields accepted from external clients.

    Chat identity and system-managed fields stay read-only. The update API is
    currently used for renaming chats, so only externally mutable fields belong
    here.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, description="Chat name")
    meta: Dict[str, Any] | None = Field(
        default=None,
        description="Chat metadata for focus/binding annotations",
    )


class ChatHistory(BaseModel):
    """Complete chat view with spec and state."""

    messages: list[Message] = Field(default_factory=list)
    status: str = Field(
        default="idle",
        description="Conversation status: idle or running",
    )
    total: int | None = Field(default=None, description="Total messages count")
    offset: int | None = Field(default=None, description="Current page offset")
    limit: int | None = Field(default=None, description="Current page size")
    has_more: bool | None = Field(
        default=None,
        description="Whether there are more messages after this page",
    )


class ChatTailUserDeleteResponse(BaseModel):
    """Result of deleting the last persisted user message."""

    deleted: bool = Field(
        default=False,
        description="Whether the tail user message was deleted",
    )
    removed_text: str = Field(
        default="",
        description="Extracted plain text from the removed message",
    )
    removed_count: int = Field(
        default=0,
        description="Number of raw memory items removed from session state",
    )


class ChatTailUserDeleteRequest(BaseModel):
    """Optional target for deleting a visible user message."""

    message_id: str | None = Field(
        default=None,
        description="Visible message id to delete from the chat tail",
    )


class ChatRuntimeStatusBreakdownItem(BaseModel):
    """One categorized token usage item inside a chat runtime snapshot."""

    key: str = Field(..., description="Stable breakdown key")
    label: str = Field(..., description="Display label")
    tokens: int = Field(default=0, description="Token count for this category")
    ratio: float = Field(
        default=0,
        description="Category ratio relative to context window",
    )
    section: str = Field(
        ...,
        description="Breakdown section, e.g. system or user",
    )


class ChatRuntimeStatus(BaseModel):
    """Runtime context usage snapshot for a chat session."""

    scope_level: str = Field(
        default="chat",
        description="Ownership level of this snapshot, currently chat",
    )
    snapshot_source: str = Field(
        default="runtime_push",
        description="How this snapshot was produced, e.g. runtime_push or empty_baseline",
    )
    snapshot_stage: str = Field(
        default="pre_model_call",
        description="Runtime stage captured by this snapshot",
    )
    agent_id: str | None = Field(default=None, description="Owning agent id")
    session_id: str | None = Field(default=None, description="Owning session id")
    user_id: str | None = Field(default=None, description="Owning user id")
    chat_id: str | None = Field(default=None, description="Owning chat id")

    context_window_tokens: int = Field(
        ...,
        description="Estimated or configured total context window",
    )
    used_tokens: int = Field(
        default=0,
        description="Tokens currently occupied in the prompt context",
    )
    used_ratio: float = Field(
        default=0,
        description="Used tokens divided by context window",
    )
    reserved_response_tokens: int = Field(
        default=0,
        description="Tokens reserved for the model response",
    )
    remaining_tokens: int = Field(
        default=0,
        description="Context tokens still available after reservation",
    )
    model_id: str | None = Field(default=None, description="Active model id")
    provider_id: str | None = Field(
        default=None,
        description="Active provider id",
    )
    profile_label: str = Field(
        default="Unknown runtime",
        description="Human-friendly runtime label",
    )
    breakdown: list[ChatRuntimeStatusBreakdownItem] = Field(
        default_factory=list,
        description="Token usage breakdown items",
    )


class ChatsFile(BaseModel):
    """Chat registry file for JSON repository.

    Stores chat_id (UUID) -> session_id mappings for persistence.
    """

    version: int = 1
    chats: list[ChatSpec] = Field(default_factory=list)
