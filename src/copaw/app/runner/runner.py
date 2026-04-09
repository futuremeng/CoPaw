# -*- coding: utf-8 -*-
# pylint: disable=unused-argument too-many-branches too-many-statements
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

from agentscope.message import Msg, TextBlock
from agentscope.pipeline import stream_printing_messages
from agentscope_runtime.engine.runner import Runner
from agentscope_runtime.engine.schemas.agent_schemas import AgentRequest
from agentscope_runtime.engine.schemas.exception import AgentException
from dotenv import load_dotenv

from .command_dispatch import (
    _get_last_user_text,
    _is_command,
    run_command_path,
)
from .query_error_dump import write_query_error_dump
from .runtime_status_store import (
    RuntimeStatusWriteContext,
    reset_current_runtime_status_context,
    set_current_runtime_status_context,
)
from .session import SafeJSONSession
from .utils import build_env_context
from ..channels.schema import DEFAULT_CHANNEL
from ...agents.react_agent import CoPawAgent
from ...agents.hooks import MemoryCompactionHook
from ...security.tool_guard.models import TOOL_GUARD_DENIED_MARK
from ...config import load_config
from ...config.config import load_agent_config
from ...constant import (
    LLM_MAX_RETRIES,
    TOOL_GUARD_APPROVAL_TIMEOUT_SECONDS,
    WORKING_DIR,
)
from ...security.tool_guard.approval import ApprovalDecision

if TYPE_CHECKING:
    from ...agents.memory import BaseMemoryManager

logger = logging.getLogger(__name__)

_TRANSIENT_UPSTREAM_STATUS_CODES = {429, 500, 502, 503, 504}
_RETRYABLE_STATUS_PATTERN = re.compile(
    r"(?:error\s*code|status)\s*[:=]?\s*(\d{3})",
    re.IGNORECASE,
)
_CONTEXT_OVERFLOW_PATTERNS = (
    "context size has been exceeded",
    "maximum context length",
    "max context length",
    "context_length_exceeded",
    "context window",
    "too many tokens",
    "input is too long",
)
_APPROVE_EXACT = frozenset(
    {
        "approve",
        "/approve",
        "/daemon approve",
    },
)

_REFERENCE_SECTION_PATTERN = re.compile(
    r"(^|\n)#{1,6}\s*(references|引文清单)\b",
    re.IGNORECASE,
)

_COMPACTION_STATUS_PATTERN = re.compile(
    r"^(?:[🔄✅⚠️]\s*)?context\s+compaction\s+(?:started|failed|completed|skipped)\.?$",
    re.IGNORECASE,
)


def _is_compaction_status_message(text: str) -> bool:
    """Best-effort matcher for transient compaction status updates."""
    normalized = (text or "").strip()
    if not normalized:
        return False

    # Preserve the strict legacy matcher first.
    if _COMPACTION_STATUS_PATTERN.fullmatch(normalized):
        return True

    # Only inspect the first visible line to tolerate appended hints.
    first_line = normalized.splitlines()[0].strip().lower()
    first_line = re.sub(r"^[🔄✅⚠️\s]+", "", first_line)
    first_line = re.sub(r"\s+", " ", first_line)

    return first_line.startswith("context compaction started") or first_line.startswith(
        "context compaction failed"
    ) or first_line.startswith("context compaction completed") or first_line.startswith(
        "context compaction skipped"
    )


def _block_get(block: Any, key: str, default: Any = None) -> Any:
    if isinstance(block, dict):
        return block.get(key, default)
    return getattr(block, key, default)


def _block_set_text(block: Any, text: str) -> bool:
    if isinstance(block, dict):
        block["text"] = text
        return True
    if hasattr(block, "text"):
        setattr(block, "text", text)
        return True
    return False


def _flatten_for_reference(value: Any, limit: int = 220) -> str:
    if value is None:
        return "-"
    if isinstance(value, str):
        raw = value
    else:
        try:
            raw = json.dumps(value, ensure_ascii=False)
        except Exception:
            raw = str(value)
    compact = re.sub(r"\s+", " ", raw).strip()
    if len(compact) <= limit:
        return compact
    return compact[: limit - 3].rstrip() + "..."


def _parse_reference_record(record: str) -> dict[str, str]:
    pairs: dict[str, str] = {}
    for match in re.finditer(r"([a-zA-Z_]+)=(.*?)(?=\s+[a-zA-Z_]+=|$)", record):
        key = match.group(1).strip().lower()
        value = match.group(2).strip()
        if key and value:
            pairs[key] = value
    return pairs


def _truncate_visual_value(
    text: str,
    *,
    max_len: int,
    keep_tail: bool = False,
) -> str:
    value = (text or "").strip()
    if not value:
        return "-"
    if len(value) <= max_len:
        return value
    if keep_tail and max_len >= 16:
        head = max_len // 2 - 2
        tail = max_len - head - 3
        return f"{value[:head]}...{value[-tail:]}"
    return value[: max_len - 3].rstrip() + "..."


def _visualize_reference_record(index: int, record: str) -> str:
    """Render a single citation line in academic style (no icons)."""
    fields = _parse_reference_record(record)
    source = fields.get("source", "runtime")
    tool = fields.get("tool", "")

    if source == "tool_call":
        args_str = fields.get("arguments", "")
        raw_path = ""
        extra_kv = ""
        try:
            if args_str and args_str not in ("{}", "null", "-"):
                args_dict = json.loads(args_str) if args_str.startswith("{") else {}
                for pkey in ("file_path", "path", "filename", "filepath", "command"):
                    if pkey in args_dict and args_dict[pkey]:
                        raw_path = str(args_dict[pkey])
                        break
                other = {
                    k: v for k, v in args_dict.items()
                    if k not in ("file_path", "path", "filename", "filepath", "command")
                }
                if other:
                    extra_kv = ", ".join(
                        f"{k}: {_flatten_for_reference(v, limit=30)}"
                        for k, v in list(other.items())[:2]
                    )
        except Exception:
            pass
        label = f"`{tool}`" + (f" ({extra_kv})" if extra_kv else "")
        if raw_path:
            path_vis = _truncate_visual_value(raw_path, max_len=72, keep_tail=True)
            return f"- [R{index}] {label}: `{path_vis}`"
        return f"- [R{index}] {label}"

    if source == "knowledge":
        path = _truncate_visual_value(fields.get("path", "-"), max_len=72, keep_tail=True)
        title = fields.get("title", "")
        snippet = fields.get("snippet", "")
        loc = f"`{path}`"
        if title and title not in ("-", ""):
            loc += f', "{_truncate_visual_value(title, max_len=40)}"'
        if snippet and snippet not in ("-", ""):
            snip = _truncate_visual_value(snippet, max_len=100)
            return f'- [R{index}] Knowledge {loc}: "{snip}"'
        return f"- [R{index}] Knowledge {loc}"

    if source == "memory":
        path = _truncate_visual_value(fields.get("path", "-"), max_len=72, keep_tail=True)
        line = fields.get("line", "")
        snippet = fields.get("snippet", "")
        loc = f"`{path}`" + (f":{line}" if line and line != "-" else "")
        if snippet and snippet not in ("-", ""):
            snip = _truncate_visual_value(snippet, max_len=100)
            return f'- [R{index}] Memory {loc}: "{snip}"'
        return f"- [R{index}] Memory {loc}"

    if source == "tool_result":
        output = fields.get("output", "-")
        out_vis = _truncate_visual_value(
            _flatten_for_reference(output, limit=200), max_len=120
        )
        if out_vis and out_vis != "-":
            return f'- [R{index}] `{tool}` (result): "{out_vis}"'
        return f"- [R{index}] `{tool}` (result)"

    # runtime / other
    snip = _truncate_visual_value(record, max_len=100)
    return f"- [R{index}] {source}: {snip}"


def _tool_name_of_block(block: Any) -> str:
    return str(_block_get(block, "name", "") or "unknown").strip()


def _extract_kv_lines(text: str) -> dict[str, str]:
    pairs: dict[str, str] = {}
    for raw_line in (text or "").splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        key, val = line.split(":", 1)
        key = key.strip().lower()
        val = val.strip()
        if not key or not val:
            continue
        if key not in pairs:
            pairs[key] = val
    return pairs


def _build_tool_output_reference(tool_name: str, call_id: str, output: Any) -> str:
    output_text = _flatten_for_reference(output, limit=360)
    output_str = output if isinstance(output, str) else ""
    fields = _extract_kv_lines(output_str)

    if tool_name == "knowledge_search":
        path = fields.get("path", "-")
        title = fields.get("title", "-")
        snippet = _flatten_for_reference(fields.get("snippet", output_text), limit=180)
        return (
            f"source=knowledge tool={tool_name} call_id={call_id} "
            f"path={path} title={title} snippet={snippet}"
        )

    if tool_name == "memory_search":
        path = fields.get("path", fields.get("file", "-"))
        line = fields.get("line", fields.get("line_number", "-"))
        snippet = _flatten_for_reference(fields.get("snippet", output_text), limit=180)
        return (
            f"source=memory tool={tool_name} call_id={call_id} "
            f"path={path} line={line} snippet={snippet}"
        )

    return (
        f"source=tool_result tool={tool_name} call_id={call_id} "
        f"output={output_text}"
    )


def _collect_runtime_references(
    msg: Msg,
    records: list[str],
    seen: set[str],
    tool_use_idx: dict[str, int] | None = None,
) -> None:
    content = getattr(msg, "content", None)
    if not isinstance(content, list):
        return

    for block in content:
        btype = str(_block_get(block, "type", "")).strip().lower()
        if btype == "tool_use":
            tool_name = _tool_name_of_block(block)
            call_id = str(_block_get(block, "id", "") or "-")
            args = _flatten_for_reference(_block_get(block, "input"))
            source_type = "tool_call"
            if tool_name == "knowledge_search":
                source_type = "knowledge"
            elif tool_name == "memory_search":
                source_type = "memory"
            record = f"source={source_type} tool={tool_name} call_id={call_id} arguments={args}"
            # Deduplicate tool_use by call_id; streaming may emit the same block
            # twice — first with empty input, then with the full arguments.
            if tool_use_idx is not None:
                existing = tool_use_idx.get(call_id)
                if existing is not None:
                    if args not in ("{}", "null", "-", ""):
                        old_parts = records[existing].split(" arguments=", 1)
                        old_args = old_parts[1] if len(old_parts) > 1 else ""
                        if old_args in ("{}", "null", "-", ""):
                            records[existing] = record
                    continue
                tool_use_idx[call_id] = len(records)
        elif btype == "tool_result":
            tool_name = _tool_name_of_block(block)
            call_id = str(_block_get(block, "id", "") or "-")
            record = _build_tool_output_reference(
                tool_name=tool_name,
                call_id=call_id,
                output=_block_get(block, "output"),
            )
        else:
            continue

        if record in seen:
            continue
        seen.add(record)
        records.append(record)


def _append_references_footer_if_needed(msg: Msg, records: list[str]) -> Msg:
    if not records:
        return msg

    if str(getattr(msg, "role", "")).strip().lower() != "assistant":
        return msg

    content = getattr(msg, "content", None)
    if not isinstance(content, list) or not content:
        return msg

    text_block: Any | None = None
    text_value = ""
    for block in reversed(content):
        if str(_block_get(block, "type", "")).strip().lower() != "text":
            continue
        candidate = _block_get(block, "text")
        if isinstance(candidate, str) and candidate.strip():
            text_block = block
            text_value = candidate
            break

    if text_block is None:
        return msg

    # Keep compaction status messages clean (no citation footer).
    if _is_compaction_status_message(text_value):
        return msg

    if _REFERENCE_SECTION_PATTERN.search(text_value):
        return msg

    footer_lines = ["", "---", "", "### References"]
    for idx, record in enumerate(records[:12], 1):
        footer_lines.append(_visualize_reference_record(idx, record))

    footer_lines.extend(
        [
            "",
            "<!-- COPAW_REFERENCES_FULL_BEGIN",
        ],
    )
    for idx, record in enumerate(records[:12], 1):
        footer_lines.append(f"[R{idx}] {record}")
    footer_lines.append("COPAW_REFERENCES_FULL_END -->")

    footer = "\n".join(footer_lines)
    next_text = text_value.rstrip() + "\n" + footer + "\n"
    _block_set_text(text_block, next_text)
    return msg


@dataclass
class FocusContext:
    """Resolved focus context from chat metadata."""

    focus_type: str
    focus_dir: Path
    flow_memory_path: str | None = None


def _is_safe_subpath(candidate: Path, root: Path) -> bool:
    """True when candidate is within root after resolution."""
    try:
        candidate_resolved = candidate.resolve()
        root_resolved = root.resolve()
    except Exception:
        return False
    return str(candidate_resolved).startswith(str(root_resolved))


def _resolve_path_in_workspace(raw_path: str, workspace_dir: Path) -> Path | None:
    """Resolve path inside workspace safely from absolute/relative raw string."""
    if not raw_path:
        return None
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = (workspace_dir / candidate).resolve()
    if not _is_safe_subpath(candidate, workspace_dir):
        return None
    return candidate


def _resolve_focus_context_from_chat_meta(
    chat_meta: dict[str, Any] | None,
    workspace_dir: Path | None,
) -> FocusContext | None:
    """Resolve focus context from chat metadata with legacy compatibility.

    Supported metadata keys:
    - New focus keys: focus_type, focus_id, focus_path, focus_flow_memory_path
    - Legacy pipeline keys: binding_type, pipeline_id, flow_memory_path
    """
    if not chat_meta or workspace_dir is None:
        return None

    ws_dir = workspace_dir.resolve()
    focus_type = str(chat_meta.get("focus_type") or "").strip()
    if not focus_type:
        legacy_type = str(chat_meta.get("binding_type") or "").strip()
        focus_type = "pipeline_edit" if legacy_type == "pipeline_edit" else ""

    if not focus_type:
        return None

    raw_focus_path = str(chat_meta.get("focus_path") or "").strip()
    focus_dir: Path | None = None
    if raw_focus_path:
        focus_dir = _resolve_path_in_workspace(raw_focus_path, ws_dir)

    if focus_dir is None and focus_type == "pipeline_edit":
        pipeline_id = str(
            chat_meta.get("focus_id") or chat_meta.get("pipeline_id") or "",
        ).strip()
        if not pipeline_id:
            return None
        fallback_dir = ws_dir / "pipelines" / "workspaces" / pipeline_id
        if _is_safe_subpath(fallback_dir, ws_dir):
            focus_dir = fallback_dir

    if focus_dir is None and focus_type == "project_run":
        project_id = str(chat_meta.get("project_id") or "").strip()
        run_id = str(chat_meta.get("run_id") or "").strip()
        if run_id:
            run_dir = ws_dir / "projects" / project_id / "pipelines" / "runs" / run_id
            if _is_safe_subpath(run_dir, ws_dir):
                focus_dir = run_dir
        if focus_dir is None and project_id:
            project_dir = ws_dir / "projects" / project_id
            if _is_safe_subpath(project_dir, ws_dir):
                focus_dir = project_dir

    if focus_dir is None:
        return None

    flow_memory_path: str | None = None
    raw_flow_memory_path = str(
        chat_meta.get("focus_flow_memory_path")
        or chat_meta.get("flow_memory_path")
        or "",
    ).strip()
    if raw_flow_memory_path:
        flow_candidate = _resolve_path_in_workspace(raw_flow_memory_path, ws_dir)
        if flow_candidate is not None:
            flow_memory_path = str(flow_candidate)

    if flow_memory_path is None and focus_type == "pipeline_edit":
        pipeline_id = str(
            chat_meta.get("focus_id") or chat_meta.get("pipeline_id") or "",
        ).strip()
        if pipeline_id:
            fallback_flow = ws_dir / "pipelines" / "workspaces" / pipeline_id / "flow-memory.md"
            if _is_safe_subpath(fallback_flow, ws_dir):
                flow_memory_path = str(fallback_flow)

    return FocusContext(
        focus_type=focus_type,
        focus_dir=focus_dir,
        flow_memory_path=flow_memory_path,
    )


def _extract_status_code(exc: Exception) -> int | None:
    """Best-effort extraction of HTTP status code from provider exceptions."""
    status = getattr(exc, "status_code", None)
    if isinstance(status, int):
        return status

    response = getattr(exc, "response", None)
    response_status = getattr(response, "status_code", None)
    if isinstance(response_status, int):
        return response_status

    return None


def _extract_status_code_from_message(exc: Exception) -> int | None:
    text = str(exc)
    match = _RETRYABLE_STATUS_PATTERN.search(text)
    if not match:
        return None
    try:
        return int(match.group(1))
    except (TypeError, ValueError):
        return None


def _is_transient_transport_error(exc: Exception) -> bool:
    """Whether an exception is a retryable HTTP transport failure."""
    transport_error_names = {
        "TransportError",
        "ReadError",
        "ReadTimeout",
        "ConnectError",
        "ConnectTimeout",
        "RemoteProtocolError",
    }
    transport_error_markers = (
        "peer closed connection",
        "incomplete chunked read",
        "server disconnected",
        "connection reset",
        "broken pipe",
    )

    for item in _iter_exception_chain(exc):
        name = item.__class__.__name__
        module = item.__class__.__module__
        text = str(item).lower()
        if module.startswith(("httpx", "httpcore")) and name in transport_error_names:
            return True
        if name == "RemoteProtocolError" and any(
            marker in text for marker in transport_error_markers
        ):
            return True

    return False


def _is_transient_upstream_error(exc: Exception) -> bool:
    """Whether an exception likely represents a transient model backend failure."""
    status = _extract_status_code(exc)
    if status is None:
        status = _extract_status_code_from_message(exc)
    if status in _TRANSIENT_UPSTREAM_STATUS_CODES:
        return True

    if _is_transient_transport_error(exc):
        return True

    # Some upstream OpenAI-compatible providers may return generic
    # `APIError: Compute error.` without HTTP status details.
    # Treat this as transient so the UI shows a clear provider failure
    # message instead of falling back to AGENT_UNKNOWN_ERROR.
    if exc.__class__.__name__ == "APIError" and "compute error" in str(exc).lower():
        return True

    return exc.__class__.__name__ in {
        "InternalServerError",
        "RateLimitError",
        "APITimeoutError",
        "APIConnectionError",
        "ServiceUnavailableError",
        "OverloadedError",
    }


def _is_tool_call_parse_input_error(exc: Exception) -> bool:
    """Detect model/provider parse failures for malformed tool-call output.

    Some OpenAI-compatible backends reject XML-style tool calls (for example
    ``<tool_call>`` payloads) before a response is produced.  Without a
    dedicated check, these bubble up as AGENT_UNKNOWN_ERROR in the UI.
    """
    text = str(exc).lower()
    if "failed to parse input" not in text:
        return False
    return any(
        marker in text
        for marker in (
            "<tool_call>",
            "<function=",
            "</function>",
            "<parameter=",
            "tool_call",
        )
    )


def _iter_exception_chain(exc: BaseException):
    """Yield exception with chained causes/contexts exactly once."""
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current
        current = (
            current.__cause__
            if current.__cause__ is not None
            else current.__context__
        )


def _is_mcp_connection_error(exc: Exception) -> bool:
    """Best-effort check for MCP connectivity/session failures."""
    mcp_error_markers = (
        "not connected",
        "connect() method first",
        "session terminated",
        "closed resource",
        "closedresourceerror",
    )
    for item in _iter_exception_chain(exc):
        text = f"{item.__class__.__name__}: {item}".lower()
        if "mcp client is not connected to the server" in text:
            return True
        if "mcp" in text and any(
            marker in text for marker in mcp_error_markers
        ):
            return True
    return False


def _is_context_overflow_error(exc: Exception) -> bool:
    """Best-effort check for context overflow style model errors."""
    for item in _iter_exception_chain(exc):
        text = f"{item.__class__.__name__}: {item}".lower()
        if any(pattern in text for pattern in _CONTEXT_OVERFLOW_PATTERNS):
            return True
    return False


def _build_context_overflow_error_msg(
    detail_text: str = "",
) -> Msg:
    """Build a user-facing message for context overflow failures."""
    return Msg(
        name="Friday",
        role="assistant",
        content=[
            TextBlock(
                type="text",
                text=(
                    "⚠️ Context window is full. CoPaw has already attempted "
                    "auto-compaction and retried once, but the request is still "
                    "too large. Please continue in a new thread or run /compact "
                    "then retry.\n"
                    "⚠️ 上下文窗口已满。CoPaw 已自动尝试压缩并重试 1 次，"
                    "但请求仍然过长。请新开对话继续，或先执行 /compact 再重试。"
                    f"{detail_text}"
                ),
            ),
        ],
    )

def _build_retryable_error_msg(exc: Exception) -> Msg | None:
    """Build a user-facing retryable error message for transient failures."""
    if not _is_transient_upstream_error(exc):
        return None

    status = _extract_status_code(exc)
    if status is None:
        status = _extract_status_code_from_message(exc)
    status_text = str(status) if status is not None else "unknown"
    return Msg(
        name="Friday",
        role="assistant",
        content=[
            TextBlock(
                type="text",
                text=(
                    "⚠️ Model service is temporarily unavailable "
                    f"(HTTP {status_text}). "
                    f"Retried {LLM_MAX_RETRIES} times but still failed. "
                    "Please try again shortly.\n"
                    "⚠️ 模型服务暂时不可用"
                    f"（HTTP {status_text}）。"
                    f"已重试 {LLM_MAX_RETRIES} 次仍失败，"
                    "请稍后再试。"
                ),
            ),
        ],
    )


def _is_approval(text: str) -> bool:
    """Return True only when *text* is exactly ``approve``,
    ``/approve``, or ``/daemon approve`` (case-insensitive).

    Leading/trailing whitespace and blank lines are stripped before
    comparison.  Everything else is treated as denial.
    """
    normalized = " ".join(text.split()).lower()
    return normalized in _APPROVE_EXACT


class AgentRunner(Runner):
    def __init__(
        self,
        agent_id: str = "default",
        workspace_dir: Path | None = None,
        task_tracker: Any | None = None,
    ) -> None:
        super().__init__()
        self.framework_type = "agentscope"
        self.agent_id = agent_id  # Store agent_id for config loading
        self.workspace_dir = (
            workspace_dir  # Store workspace_dir for prompt building
        )
        self._chat_manager = None  # Store chat_manager reference
        self._mcp_manager = None  # MCP client manager for hot-reload
        self._workspace: Any = None  # Workspace instance for control commands
        self._manager: Any = None  # MultiAgentManager for /daemon restart
        self.memory_manager: BaseMemoryManager | None = None
        self._task_tracker = task_tracker  # Task tracker for background tasks

    def set_chat_manager(self, chat_manager):
        """Set chat manager for auto-registration.

        Args:
            chat_manager: ChatManager instance
        """
        self._chat_manager = chat_manager

    def set_mcp_manager(self, mcp_manager):
        """Set MCP client manager for hot-reload support.

        Args:
            mcp_manager: MCPClientManager instance
        """
        self._mcp_manager = mcp_manager

    def set_workspace(self, workspace):
        """Set workspace for control command handlers.

        Args:
            workspace: Workspace instance
        """
        self._workspace = workspace

    _APPROVAL_TIMEOUT_SECONDS = TOOL_GUARD_APPROVAL_TIMEOUT_SECONDS

    async def _force_context_compaction(self, agent: CoPawAgent) -> bool:
        """Trigger one-shot memory compaction; return True if it likely ran."""
        memory_manager = getattr(agent, "memory_manager", None)
        if memory_manager is None:
            return False

        try:
            memory = agent.memory
            before = ""
            get_summary = getattr(memory, "get_compressed_summary", None)
            if callable(get_summary):
                before = get_summary() or ""

            hook = MemoryCompactionHook(memory_manager=memory_manager)
            await hook(agent, {})

            after = ""
            get_summary = getattr(memory, "get_compressed_summary", None)
            if callable(get_summary):
                after = get_summary() or ""

            if after != before:
                return True

            # Fallback signal: summary task queued means compaction path ran.
            tasks = getattr(memory_manager, "summary_tasks", None)
            if bool(tasks):
                return True

            # If hook completes without errors, consider compaction attempt
            # successful even when no summary delta is observable.
            return True
        except Exception as compact_err:
            logger.warning(
                "Failed to force context compaction retry path: %s",
                compact_err,
            )
            return False

    async def _resolve_pending_approval(
        self,
        session_id: str,
        query: str | None,
    ) -> tuple[Msg | None, bool, dict[str, Any] | None]:
        """Check for a pending tool-guard approval for *session_id*.

        Returns ``(response_msg, was_consumed, approved_tool_call)``:

        - ``(None, False, None)`` — no pending approval, continue normally.
        - ``(Msg, True, None)``   — denied; yield the Msg and stop.
        - ``(None, True, dict)``  — approved with stored tool call.

        Approvals are resolved FIFO per session (oldest pending first).
        """
        if not session_id:
            return None, False, None

        from ..approvals import get_approval_service

        svc = get_approval_service()
        pending = await svc.get_pending_by_session(session_id)
        if pending is None:
            return None, False, None

        elapsed = time.time() - pending.created_at
        if elapsed > self._APPROVAL_TIMEOUT_SECONDS:
            await svc.resolve_request(
                pending.request_id,
                ApprovalDecision.TIMEOUT,
            )
            return (
                Msg(
                    name="Friday",
                    role="assistant",
                    content=[
                        TextBlock(
                            type="text",
                            text=(
                                f"⏰ Tool `{pending.tool_name}` approval "
                                f"timed out ({int(elapsed)}s) — denied.\n"
                                f"工具 `{pending.tool_name}` 审批超时"
                                f"（{int(elapsed)}s），已拒绝执行。"
                            ),
                        ),
                    ],
                ),
                True,
                None,
            )

        normalized = (query or "").strip().lower()
        if _is_approval(normalized):
            resolved = await svc.resolve_request(
                pending.request_id,
                ApprovalDecision.APPROVED,
            )
            approved_tool_call: dict[str, Any] | None = None
            record = resolved or pending
            if isinstance(record.extra, dict):
                candidate = record.extra.get("tool_call")
                if isinstance(candidate, dict):
                    approved_tool_call = dict(candidate)
                    siblings = record.extra.get("sibling_tool_calls")
                    if isinstance(siblings, list):
                        approved_tool_call["_sibling_tool_calls"] = siblings
                    remaining = record.extra.get("remaining_queue")
                    if isinstance(remaining, list):
                        approved_tool_call["_remaining_queue"] = remaining
                    thinking_blocks = record.extra.get("thinking_blocks")
                    if isinstance(thinking_blocks, list):
                        approved_tool_call[
                            "_thinking_blocks"
                        ] = thinking_blocks
            return None, True, approved_tool_call

        await svc.resolve_request(
            pending.request_id,
            ApprovalDecision.DENIED,
        )
        return (
            Msg(
                name="Friday",
                role="assistant",
                content=[
                    TextBlock(
                        type="text",
                        text=(
                            f"❌ Tool `{pending.tool_name}` denied.\n"
                            f"工具 `{pending.tool_name}` 已拒绝执行。"
                        ),
                    ),
                ],
            ),
            True,
            None,
        )

    async def query_handler(  # pyright: ignore[reportIncompatibleMethodOverride]
        self,
        msgs,
        request: AgentRequest | None = None,
        **kwargs,
    ):
        """
        Handle agent query.
        """
        logger.debug(
            f"AgentRunner.query_handler called: agent_id={self.agent_id}, "
            f"msgs={msgs}, request={request}",
        )
        query = _get_last_user_text(msgs)
        session_id = getattr(request, "session_id", "") or ""

        (
            approval_response,
            approval_consumed,
            approved_tool_call,
        ) = await self._resolve_pending_approval(session_id, query)
        if approval_response is not None:
            yield approval_response, True
            user_id = getattr(request, "user_id", "") or ""
            await self._cleanup_denied_session_memory(
                session_id,
                user_id,
                denial_response=approval_response,
            )
            return

        if not approval_consumed and query and _is_command(query):
            logger.info("Command path: %s", query.strip()[:50])
            async for msg, last in run_command_path(request, msgs, self):
                yield msg, last
            return

        logger.debug(
            f"AgentRunner.stream_query: request={request}, "
            f"agent_id={self.agent_id}",
        )

        # Set agent context for model creation
        from ..agent_context import set_current_agent_id

        set_current_agent_id(self.agent_id)

        agent = None
        chat = None
        session_state_loaded = False
        runtime_status_token = None
        user_id = getattr(request, "user_id", "") or ""
        channel = str(
            getattr(request, "channel", DEFAULT_CHANNEL) or DEFAULT_CHANNEL,
        )
        try:
            if request is None:
                raise ValueError("request is required")

            session_id = request.session_id or ""
            user_id = request.user_id or ""
            channel = str(
                getattr(request, "channel", DEFAULT_CHANNEL)
                or DEFAULT_CHANNEL,
            )

            logger.info(
                "Handle agent query:\n%s",
                json.dumps(
                    {
                        "session_id": session_id,
                        "user_id": user_id,
                        "channel": channel,
                        "msgs_len": len(msgs) if msgs else 0,
                        "msgs_str": str(msgs)[:300] + "...",
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
            )

            env_context = build_env_context(
                session_id=session_id,
                user_id=user_id,
                channel=channel,
                working_dir=(
                    str(self.workspace_dir)
                    if self.workspace_dir
                    else str(WORKING_DIR)
                ),
            )

            # Get MCP clients from manager (hot-reloadable)
            mcp_clients = []
            if self._mcp_manager is not None:
                mcp_clients = await self._mcp_manager.get_clients()

            # Load agent-specific configuration
            agent_config = load_agent_config(self.agent_id)

            logger.debug(f"Enabled MCP: {mcp_clients}")

            agent = CoPawAgent(
                agent_config=agent_config,
                env_context=env_context,
                mcp_clients=mcp_clients,
                memory_manager=self.memory_manager,
                request_context={
                    "session_id": session_id,
                    "user_id": user_id,
                    "channel": channel,
                    "agent_id": self.agent_id,
                    **(
                        {
                            "forced_tool_call_json": json.dumps(
                                approved_tool_call,
                                ensure_ascii=False,
                            ),
                        }
                        if approved_tool_call
                        else {}
                    ),
                },
                workspace_dir=self.workspace_dir,
                task_tracker=self._task_tracker,
            )
            await agent.register_mcp_clients()
            agent.set_console_output_enabled(enabled=False)
            # Default to agent-level workspace unless chat meta injects a focus.
            if hasattr(agent, "clear_focus_dir"):
                agent.clear_focus_dir()
            if hasattr(agent, "set_flow_memory_path"):
                agent.set_flow_memory_path(None)

            logger.debug(
                f"Agent Query msgs {msgs}",
            )

            name = "New Chat"
            if len(msgs) > 0:
                content = msgs[0].get_text_content()
                if content:
                    name = msgs[0].get_text_content()[:10]
                else:
                    name = "Media Message"

            logger.debug(
                f"DEBUG chat_manager status: "
                f"_chat_manager={self._chat_manager}, "
                f"is_none={self._chat_manager is None}, "
                f"agent_id={self.agent_id}",
            )

            if self._chat_manager is not None:
                logger.debug(
                    f"Runner: Calling get_or_create_chat for "
                    f"session_id={session_id}, user_id={user_id}, "
                    f"channel={channel}, name={name}",
                )
                chat = await self._chat_manager.get_or_create_chat(
                    session_id,
                    user_id,
                    channel,
                    name=name,
                )
                logger.debug(f"Runner: Got chat: {chat.id}")

                try:
                    # Always reset focus first, then inject from current chat meta.
                    if hasattr(agent, "clear_focus_dir"):
                        agent.clear_focus_dir()
                    if hasattr(agent, "set_flow_memory_path"):
                        agent.set_flow_memory_path(None)

                    chat_meta = (
                        chat.meta
                        if hasattr(chat, "meta") and isinstance(chat.meta, dict)
                        else None
                    )
                    focus_ctx = _resolve_focus_context_from_chat_meta(
                        chat_meta,
                        self.workspace_dir,
                    )
                    if focus_ctx is not None:
                        if hasattr(agent, "set_focus_dir"):
                            agent.set_focus_dir(focus_ctx.focus_dir)
                        focus_env_context = build_env_context(
                            session_id=session_id,
                            user_id=user_id,
                            channel=channel,
                            working_dir=str(focus_ctx.focus_dir),
                        )
                        if hasattr(agent, "update_env_context"):
                            agent.update_env_context(focus_env_context)
                        if focus_ctx.flow_memory_path and hasattr(
                            agent,
                            "set_flow_memory_path",
                        ):
                            agent.set_flow_memory_path(focus_ctx.flow_memory_path)
                        logger.debug(
                            "Scoped agent focus dir (%s): %s",
                            focus_ctx.focus_type,
                            focus_ctx.focus_dir,
                        )
                except Exception as focus_exc:
                    logger.warning("Failed to resolve focus context from chat meta: %s", focus_exc)
            else:
                logger.warning(
                    f"ChatManager is None! Cannot auto-register chat for "
                    f"session_id={session_id}",
                )

            try:
                await self.session.load_session_state(
                    session_id=session_id,
                    user_id=user_id,
                    agent=agent,
                )
            except KeyError as e:
                logger.warning(
                    "load_session_state skipped (state schema mismatch): %s; "
                    "will save fresh state on completion to recover file",
                    e,
                )
            session_state_loaded = True

            # Rebuild system prompt so it always reflects the latest
            # AGENTS.md / SOUL.md / PROFILE.md, not the stale one saved
            # in the session state.
            agent.rebuild_sys_prompt()

            runtime_status_token = set_current_runtime_status_context(
                RuntimeStatusWriteContext(
                    session=self.session,
                    agent_id=self.agent_id,
                    session_id=session_id,
                    user_id=user_id,
                    chat_id=chat.id if chat is not None else "",
                )
            )

            stream_retry_budget = 1
            while True:
                try:
                    citation_records: list[str] = []
                    citation_seen: set[str] = set()
                    citation_tool_use_idx: dict[str, int] = {}
                    async for stream_item in stream_printing_messages(
                        agents=[agent],
                        coroutine_task=agent(msgs),
                    ):
                        out_msg, is_last = stream_item[0], stream_item[1]
                        if isinstance(out_msg, Msg):
                            _collect_runtime_references(
                                out_msg,
                                citation_records,
                                citation_seen,
                                citation_tool_use_idx,
                            )
                            if is_last:
                                out_msg = _append_references_footer_if_needed(
                                    out_msg,
                                    citation_records,
                                )
                        yield out_msg, is_last
                    break
                except Exception as stream_err:
                    if (
                        stream_retry_budget <= 0
                        or not _is_context_overflow_error(stream_err)
                    ):
                        raise

                    compacted = await self._force_context_compaction(agent)
                    if not compacted:
                        raise

                    stream_retry_budget -= 1
                    logger.warning(
                        "Context overflow detected; compacted memory and "
                        "retrying once. session_id=%s user_id=%s channel=%s",
                        session_id,
                        user_id,
                        channel,
                    )

        except asyncio.CancelledError as exc:
            logger.info(f"query_handler: {session_id} cancelled!")
            if agent is not None:
                await agent.interrupt()
            return
        except Exception as e:
            debug_dump_path = write_query_error_dump(
                request=request,
                exc=e,
                locals_=locals(),
            )
            path_hint = (
                f"\n(Details:  {debug_dump_path})" if debug_dump_path else ""
            )
            logger.exception(f"Error in query handler: {e}{path_hint}")

            # Last-resort guard: MCP connectivity failures should not surface
            # as chat-visible "Unknown agent error" payloads.
            if _is_mcp_connection_error(e):
                logger.warning(
                    "Suppressing MCP connectivity error in query output; "
                    "session_id=%s, user_id=%s, channel=%s, reason=%s",
                    session_id,
                    user_id,
                    channel,
                    e,
                )
                return

            if debug_dump_path:
                setattr(e, "debug_dump_path", debug_dump_path)
                if hasattr(e, "add_note"):
                    e.add_note(
                        f"(Details:  {debug_dump_path})",
                    )
                suffix = f"\n(Details:  {debug_dump_path})"
                e.args = (
                    (f"{e.args[0]}{suffix}" if e.args else suffix.strip()),
                ) + e.args[1:]

            if _is_transient_upstream_error(e):
                status = _extract_status_code(e)
                status_text = str(status) if status is not None else "unknown"
                detail_text = (
                    f"\n(Details:  {debug_dump_path})"
                    if debug_dump_path
                    else ""
                )
                yield (
                    Msg(
                        name="Friday",
                        role="assistant",
                        content=[
                            TextBlock(
                                type="text",
                                text=(
                                    "⚠️ Model service is temporarily unavailable "
                                    f"(HTTP {status_text}). "
                                    f"Retried {LLM_MAX_RETRIES} times but still failed. "
                                    "Please try again shortly.\n"
                                    "⚠️ 模型服务暂时不可用"
                                    f"（HTTP {status_text}）。"
                                    f"已重试 {LLM_MAX_RETRIES} 次仍失败，"
                                    f"请稍后再试。{detail_text}"
                                ),
                            ),
                        ],
                    ),
                    True,
                )
                return

            if _is_tool_call_parse_input_error(e):
                detail_text = (
                    f"\n(Details:  {debug_dump_path})"
                    if debug_dump_path
                    else ""
                )
                yield (
                    Msg(
                        name="Friday",
                        role="assistant",
                        content=[
                            TextBlock(
                                type="text",
                                text=(
                                    "⚠️ Model tool-call format is not accepted "
                                    "by the current provider/runtime. "
                                    "Please retry, or switch to a model/runtime "
                                    "with function-calling compatibility.\n"
                                    "⚠️ 当前模型/运行时不接受工具调用格式。"
                                    "请重试，或切换到支持 function calling "
                                    "的模型/运行时。"
                                    f"{detail_text}"
                                ),
                            ),
                        ],
                    ),
                    True,
                )
                return

            if _is_context_overflow_error(e):
                detail_text = (
                    f"\n(Details:  {debug_dump_path})"
                    if debug_dump_path
                    else ""
                )
                yield (
                    _build_context_overflow_error_msg(detail_text),
                    True,
                )
                return
            raise
        finally:
            if runtime_status_token is not None:
                reset_current_runtime_status_context(runtime_status_token)
            if agent is not None and session_state_loaded:
                await self.session.save_session_state(
                    session_id=session_id,
                    user_id=user_id,
                    agent=agent,
                )

            if self._chat_manager is not None and chat is not None:
                await self._chat_manager.touch_chat(chat.id)

    async def _cleanup_denied_session_memory(
        self,
        session_id: str,
        user_id: str,
        denial_response: "Msg | None" = None,
    ) -> None:
        """Clean up session memory after a tool-guard denial.

        In the deny path (no agent is created), this method:

        1. Removes the LLM denial explanation (the assistant message
           immediately following the last marked entry).
        2. Strips ``TOOL_GUARD_DENIED_MARK`` from all marks lists so
           the kept tool-call info becomes normal memory entries.
        3. Appends *denial_response* (e.g. "❌ Tool denied") to the
           persisted session memory.
        """
        if not hasattr(self, "session") or self.session is None:
            return

        path = self.session._get_save_path(  # pylint: disable=protected-access
            session_id,
            user_id,
        )
        if not Path(path).exists():
            return

        try:
            with open(
                path,
                "r",
                encoding="utf-8",
                errors="surrogatepass",
            ) as f:
                states = json.load(f)

            agent_state = states.get("agent", {})
            memory_state = agent_state.get("memory", {})
            content = memory_state.get("content", [])

            if not content:
                return

            def _is_marked(entry):
                return (
                    isinstance(entry, list)
                    and len(entry) >= 2
                    and isinstance(entry[1], list)
                    and TOOL_GUARD_DENIED_MARK in entry[1]
                )

            last_marked_idx = -1
            for i, entry in enumerate(content):
                if _is_marked(entry):
                    last_marked_idx = i

            modified = False

            if last_marked_idx >= 0 and last_marked_idx + 1 < len(content):
                next_entry = content[last_marked_idx + 1]
                if (
                    isinstance(next_entry, list)
                    and len(next_entry) >= 1
                    and isinstance(next_entry[0], dict)
                    and next_entry[0].get("role") == "assistant"
                ):
                    del content[last_marked_idx + 1]
                    modified = True

            for entry in content:
                if _is_marked(entry):
                    entry[1].remove(TOOL_GUARD_DENIED_MARK)
                    modified = True

            if denial_response is not None:
                ts = getattr(denial_response, "timestamp", None)
                msg_dict = {
                    "id": getattr(denial_response, "id", ""),
                    "name": getattr(denial_response, "name", "Friday"),
                    "role": getattr(denial_response, "role", "assistant"),
                    "content": denial_response.content,
                    "metadata": getattr(
                        denial_response,
                        "metadata",
                        None,
                    ),
                    "timestamp": str(ts) if ts is not None else "",
                }
                content.append([msg_dict, []])
                modified = True

            if modified:
                with open(
                    path,
                    "w",
                    encoding="utf-8",
                    errors="surrogatepass",
                ) as f:
                    json.dump(states, f, ensure_ascii=False)
                logger.info(
                    "Tool guard: cleaned up denied session memory in %s",
                    path,
                )
        except Exception:  # pylint: disable=broad-except
            logger.warning(
                "Failed to clean up denied messages from session %s",
                session_id,
                exc_info=True,
            )

    async def init_handler(self, *args, **kwargs):
        """
        Init handler.
        """
        # Load environment variables from .env file
        # env_path = Path(__file__).resolve().parents[4] / ".env"
        env_path = Path("./") / ".env"
        if env_path.exists():
            load_dotenv(env_path)
            logger.debug(f"Loaded environment variables from {env_path}")
        else:
            logger.debug(
                f".env file not found at {env_path}, "
                "using existing environment variables",
            )

        session_dir = str(
            (self.workspace_dir if self.workspace_dir else WORKING_DIR)
            / "sessions",
        )
        self.session = SafeJSONSession(save_dir=session_dir)

    async def shutdown_handler(self, *args, **kwargs):
        """
        Shutdown handler.
        """
