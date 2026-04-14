# -*- coding: utf-8 -*-
"""Chat management API."""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from agentscope_runtime.engine.schemas.agent_schemas import Message

from .session import (
    SafeJSONSession,
    normalize_in_memory_memory_state,
    restore_in_memory_memory,
)
from .manager import ChatManager
from .models import (
    ChatSpec,
    ChatUpdate,
    ChatHistory,
    ChatTailUserDeleteRequest,
    ChatTailUserDeleteResponse,
)
from .utils import agentscope_msg_to_message


router = APIRouter(prefix="/chats", tags=["chats"])

_MAX_PLUGIN_OUTPUT_CHARS = 8000


def _is_tool_trace_message(msg: Message) -> bool:
    return msg.type in {"plugin_call", "plugin_call_output"}


def _is_tool_trace_message_dict(message_dict: dict[str, Any]) -> bool:
    return str(message_dict.get("type") or "").strip() in {
        "plugin_call",
        "plugin_call_output",
    }


def _compact_chat_history_messages(
    messages: list[Message],
) -> list[Message]:
    """Hide low-value tool trace messages for chat history rendering."""
    return [m for m in messages if not _is_tool_trace_message(m)]


def _paginate_chat_history_messages(
    messages: list[Message],
    offset: int,
    limit: int,
) -> tuple[list[Message], int, bool]:
    """Slice chat history into a stable page and provide pagination metadata."""
    total = len(messages)
    if offset >= total:
        return [], total, False

    page = messages[offset : offset + limit]
    has_more = (offset + len(page)) < total
    return page, total, has_more


def _truncate_chat_history_messages(
    messages: list[Message],
    max_plugin_output_chars: int = _MAX_PLUGIN_OUTPUT_CHARS,
) -> list[Message]:
    """Truncate oversized plugin call outputs for chat-history rendering.

    Large tool outputs can freeze web UI rendering for old sessions. Keep
    normal messages untouched while clipping only ``plugin_call_output`` data.
    """
    truncated: list[Message] = []

    for msg in messages:
        raw = msg.model_dump()
        content = raw.get("content")

        if (
            raw.get("type") != "plugin_call_output"
            or not isinstance(content, list)
        ):
            truncated.append(msg)
            continue

        msg_changed = False
        next_content = []
        for item in content:
            if not isinstance(item, dict) or item.get("type") != "data":
                next_content.append(item)
                continue

            data = item.get("data")
            if not isinstance(data, dict):
                next_content.append(item)
                continue

            output = data.get("output")
            if not isinstance(output, str) or len(output) <= max_plugin_output_chars:
                next_content.append(item)
                continue

            clip_suffix = (
                "\n\n[truncated by CoPaw chat API: "
                f"showing first {max_plugin_output_chars} chars, "
                f"{len(output) - max_plugin_output_chars} chars omitted]"
            )
            next_item = deepcopy(item)
            next_item["data"]["output"] = (
                output[:max_plugin_output_chars] + clip_suffix
            )
            next_content.append(next_item)
            msg_changed = True

        if msg_changed:
            raw["content"] = next_content
            truncated.append(Message.model_validate(raw))
        else:
            truncated.append(msg)

    return truncated


def _memory_item_to_message_dict(item: Any) -> dict[str, Any] | None:
    if isinstance(item, list) and len(item) == 2 and isinstance(item[0], dict):
        return item[0]
    if isinstance(item, dict):
        return item
    return None


def _extract_text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        text_parts: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                text_parts.append(text.strip())
        return "\n".join(text_parts).strip()
    return ""


def _is_user_memory_message(message_dict: dict[str, Any]) -> bool:
    return str(message_dict.get("role") or "").strip().lower() == "user"


async def _load_visible_messages_for_chat(
    chat_spec: ChatSpec,
    session: SafeJSONSession,
) -> tuple[dict[str, Any], list[Message]]:
    state = await session.get_session_state_dict(
        chat_spec.session_id,
        chat_spec.user_id,
    )
    agent_state = state.get("agent") if isinstance(state, dict) else None
    if not isinstance(agent_state, dict):
        raise HTTPException(
            status_code=409,
            detail="Chat session memory is unavailable.",
        )

    normalized_memory = normalize_in_memory_memory_state(agent_state.get("memory"))
    memory = restore_in_memory_memory(normalized_memory)
    visible_messages = agentscope_msg_to_message(
        await memory.get_memory(prepend_summary=False),
    )
    visible_messages = _truncate_chat_history_messages(visible_messages)
    visible_messages = _compact_chat_history_messages(visible_messages)
    return normalized_memory, visible_messages


async def get_workspace(request: Request):
    """Get the workspace for the active agent."""
    from ..agent_context import get_agent_for_request

    return await get_agent_for_request(request)


async def get_chat_manager(
    request: Request,
) -> ChatManager:
    """Get the chat manager for the active agent.

    Args:
        request: FastAPI request object

    Returns:
        ChatManager instance for the specified agent

    Raises:
        HTTPException: If manager is not initialized
    """
    workspace = await get_workspace(request)
    return workspace.chat_manager


async def get_session(
    request: Request,
) -> SafeJSONSession:
    """Get the session for the active agent.

    Args:
        request: FastAPI request object

    Returns:
        SafeJSONSession instance for the specified agent

    Raises:
        HTTPException: If session is not initialized
    """
    workspace = await get_workspace(request)
    return workspace.runner.session


@router.get("", response_model=list[ChatSpec])
async def list_chats(
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    channel: Optional[str] = Query(None, description="Filter by channel"),
    mgr: ChatManager = Depends(get_chat_manager),
    workspace=Depends(get_workspace),
):
    """List all chats with optional filters.

    Args:
        user_id: Optional user ID to filter chats
        channel: Optional channel name to filter chats
        mgr: Chat manager dependency
    """
    chats = await mgr.list_chats(user_id=user_id, channel=channel)
    tracker = workspace.task_tracker
    result = []
    for spec in chats:
        status = await tracker.get_status(spec.id)
        result.append(spec.model_copy(update={"status": status}))
    return result


@router.post("", response_model=ChatSpec)
async def create_chat(
    request: ChatSpec,
    mgr: ChatManager = Depends(get_chat_manager),
):
    """Create a new chat.

    Server generates chat_id (UUID) automatically.

    Args:
        request: Chat creation request
        mgr: Chat manager dependency

    Returns:
        Created chat spec with UUID
    """
    chat_id = str(uuid4())
    spec = ChatSpec(
        id=chat_id,
        name=request.name,
        session_id=request.session_id,
        user_id=request.user_id,
        channel=request.channel,
        meta=request.meta,
    )
    return await mgr.create_chat(spec)


@router.post("/batch-delete", response_model=dict)
async def batch_delete_chats(
    chat_ids: list[str],
    mgr: ChatManager = Depends(get_chat_manager),
):
    """Delete chats by chat IDs.

    Args:
        chat_ids: List of chat IDs
        mgr: Chat manager dependency
    Returns:
        True if deleted, False if failed

    """
    deleted = await mgr.delete_chats(chat_ids=chat_ids)
    return {"deleted": deleted}


@router.get("/{chat_id}", response_model=ChatHistory)
async def get_chat(
    chat_id: str,
    offset: int = Query(
        0,
        ge=0,
        description="History page offset (0-based)",
    ),
    limit: int = Query(
        80,
        ge=1,
        le=500,
        description="History page size",
    ),
    mgr: ChatManager = Depends(get_chat_manager),
    session: SafeJSONSession = Depends(get_session),
    workspace=Depends(get_workspace),
):
    """Get detailed information about a specific chat by UUID.

    Args:
        request: FastAPI request (for agent context)
        chat_id: Chat UUID
        mgr: Chat manager dependency
        session: SafeJSONSession dependency

    Returns:
        ChatHistory with messages and status (idle/running)

    Raises:
        HTTPException: If chat not found (404)
    """
    chat_spec = await mgr.get_chat(chat_id)
    if not chat_spec:
        raise HTTPException(
            status_code=404,
            detail=f"Chat not found: {chat_id}",
        )

    state = await session.get_session_state_dict(
        chat_spec.session_id,
        chat_spec.user_id,
    )
    status = await workspace.task_tracker.get_status(chat_id)
    if not state:
        return ChatHistory(messages=[], status=status)
    memories = state.get("agent", {}).get("memory", {})
    memory = restore_in_memory_memory(memories)

    memories = await memory.get_memory(prepend_summary=False)
    messages = agentscope_msg_to_message(memories)
    messages = _truncate_chat_history_messages(messages)
    messages = _compact_chat_history_messages(messages)
    page, total, has_more = _paginate_chat_history_messages(messages, offset, limit)
    return ChatHistory(
        messages=page,
        status=status,
        total=total,
        offset=offset,
        limit=limit,
        has_more=has_more,
    )


@router.put("/{chat_id}", response_model=ChatSpec)
async def update_chat(
    chat_id: str,
    spec: ChatUpdate,
    mgr: ChatManager = Depends(get_chat_manager),
):
    """Update an existing chat.

    Args:
        chat_id: Chat UUID
        spec: Partial chat update payload
        mgr: Chat manager dependency

    Returns:
        Updated chat spec

    Raises:
        HTTPException: If chat not found (404)
    """
    updated = await mgr.patch_chat(chat_id, spec)
    if updated is None:
        raise HTTPException(
            status_code=404,
            detail=f"Chat not found: {chat_id}",
        )
    return updated


@router.post(
    "/{chat_id}/tail-user/delete",
    response_model=ChatTailUserDeleteResponse,
)
async def delete_tail_user_message(
    chat_id: str,
    payload: ChatTailUserDeleteRequest | None = None,
    mgr: ChatManager = Depends(get_chat_manager),
    session: SafeJSONSession = Depends(get_session),
):
    """Delete the last visible user message from persisted session memory."""
    chat_spec = await mgr.get_chat(chat_id)
    if not chat_spec:
        raise HTTPException(
            status_code=404,
            detail=f"Chat not found: {chat_id}",
        )

    requested_message_id = (payload.message_id or "").strip() if payload else ""
    all_chats = await mgr.list_chats(
        user_id=chat_spec.user_id,
        channel=chat_spec.channel,
    )
    chat_by_id = {chat.id: chat for chat in all_chats}
    lineage_ids: list[str] = []
    visited_ids: set[str] = set()
    current_id: str | None = chat_id
    while current_id and current_id in chat_by_id and current_id not in visited_ids:
        visited_ids.add(current_id)
        lineage_ids.append(current_id)
        current_id = chat_by_id[current_id].session_id or None
    lineage_ids.reverse()
    if not lineage_ids:
        lineage_ids = [chat_id]

    normalized_memory_by_chat_id: dict[str, dict[str, Any]] = {}
    visible_messages_by_chat_id: dict[str, list[Message]] = {}
    source_chat_id_by_message_id: dict[str, str] = {}
    merged_visible_messages: list[Message] = []
    merged_index_by_id: dict[str, int] = {}

    for lineage_id in lineage_ids:
        lineage_chat_spec = chat_by_id.get(lineage_id)
        if lineage_chat_spec is None:
            continue
        try:
            normalized_memory, visible_messages = await _load_visible_messages_for_chat(
                lineage_chat_spec,
                session,
            )
        except HTTPException as exc:
            if exc.status_code == 409 and exc.detail == "Chat session memory is unavailable.":
                continue
            raise
        normalized_memory_by_chat_id[lineage_id] = normalized_memory
        visible_messages_by_chat_id[lineage_id] = visible_messages
        for message in visible_messages:
            stable_id = str(message.id or "").strip()
            if stable_id:
                source_chat_id_by_message_id[stable_id] = lineage_id
            if stable_id and stable_id in merged_index_by_id:
                merged_visible_messages[merged_index_by_id[stable_id]] = message
                continue
            if stable_id:
                merged_index_by_id[stable_id] = len(merged_visible_messages)
            merged_visible_messages.append(message)

    target_visible_message: Message | None = None
    if requested_message_id:
        for message in reversed(merged_visible_messages):
            if str(message.id or "").strip() == requested_message_id:
                target_visible_message = message
                break

    if target_visible_message is None:
        for message in reversed(merged_visible_messages):
            if str(message.role or "").strip().lower() == "user":
                target_visible_message = message
                break

    is_target_visible_user = bool(
        target_visible_message
        and str(target_visible_message.role or "").strip().lower() == "user"
    )
    if not is_target_visible_user:
        raise HTTPException(
            status_code=409,
            detail="Last visible message is not a user message.",
        )

    target_visible_id = str(target_visible_message.id or "").strip()
    target_chat_id = source_chat_id_by_message_id.get(target_visible_id, chat_id)
    target_visible_messages = visible_messages_by_chat_id.get(target_chat_id, [])
    target_visible_user_indexes = [
        idx
        for idx, message in enumerate(target_visible_messages)
        if str(message.role or "").strip().lower() == "user"
    ]
    target_visible_index = -1
    for idx in reversed(target_visible_user_indexes):
        if str(target_visible_messages[idx].id or "").strip() == target_visible_id:
            target_visible_index = idx
            break
    if target_visible_index < 0:
        raise HTTPException(
            status_code=409,
            detail="Last visible message is not a user message.",
        )
    target_visible_user_from_end = sum(
        1 for idx in target_visible_user_indexes if idx >= target_visible_index
    )

    target_chat_spec = chat_by_id.get(target_chat_id)
    if target_chat_spec is None:
        raise HTTPException(
            status_code=409,
            detail="Target source chat is unavailable.",
        )
    normalized_memory = normalized_memory_by_chat_id.get(target_chat_id)
    if normalized_memory is None:
        normalized_memory, _ = await _load_visible_messages_for_chat(
            target_chat_spec,
            session,
        )
    content = normalized_memory.get("content", [])
    if not isinstance(content, list) or not content:
        raise HTTPException(
            status_code=409,
            detail="Chat session memory is empty.",
        )

    tail_user_index = -1
    removed_text = ""
    matched_visible_user_count = 0
    for idx in range(len(content) - 1, -1, -1):
        message_dict = _memory_item_to_message_dict(content[idx])
        if message_dict is None or not _is_user_memory_message(message_dict):
            continue
        matched_visible_user_count += 1
        if matched_visible_user_count != target_visible_user_from_end:
            continue
        tail_user_index = idx
        removed_text = _extract_text_from_content(message_dict.get("content"))
        break

    if tail_user_index < 0:
        raise HTTPException(
            status_code=409,
            detail="Last persisted user message is unavailable.",
        )

    removed_count = len(content) - tail_user_index
    normalized_memory["content"] = content[:tail_user_index]
    await session.update_session_state(
        session_id=target_chat_spec.session_id,
        user_id=target_chat_spec.user_id,
        key="agent.memory",
        value=normalized_memory,
    )
    await mgr.touch_chat(target_chat_id)

    return ChatTailUserDeleteResponse(
        deleted=True,
        removed_text=removed_text,
        removed_count=removed_count,
    )


@router.delete("/{chat_id}", response_model=dict)
async def delete_chat(
    chat_id: str,
    mgr: ChatManager = Depends(get_chat_manager),
):
    """Delete a chat by UUID.

    Note: This only deletes the chat spec (UUID mapping).
    JSONSession state is NOT deleted.

    Args:
        chat_id: Chat UUID
        mgr: Chat manager dependency

    Returns:
        True if deleted, False if failed

    Raises:
        HTTPException: If chat not found (404)
    """
    deleted = await mgr.delete_chats(chat_ids=[chat_id])
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail=f"Chat not found: {chat_id}",
        )
    return {"deleted": True}
