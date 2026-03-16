# -*- coding: utf-8 -*-
"""File-backed knowledge source indexing and search."""

from __future__ import annotations

import asyncio
import fnmatch
import hashlib
import json
import logging
import re
import shutil
from datetime import UTC, datetime, timedelta
from html import unescape
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, parse_qs

import httpx

from ..constant import CHATS_FILE
from ..config.config import KnowledgeConfig, KnowledgeSourceSpec, LastDispatchConfig
from ..agents.model_factory import create_model_and_formatter

_UNSAFE_FILENAME_RE = re.compile(r'[\\/:*?"<>|]')
_CHAT_URL_RE = re.compile(
    r"https?://[A-Za-z0-9._~:/?#\[\]@!$&'()+,;=%-]+",
    re.IGNORECASE,
)
_URL_TRAILING_STRIP_CHARS = ".,;:!?)]}\"'`*，。！？；：、）】》〉」』"

# URL exclusion helpers
_URL_SENSITIVE_PARAMS = frozenset({
    "access_token", "token", "api_key", "apikey", "apitoken",
    "secret", "password", "auth", "key", "webhook_token",
    "sign", "signature", "hmac",
})
_PRIVATE_HOST_RE = re.compile(
    r"^("
    r"localhost"
    r"|127(?:\.\d{1,3}){3}"
    r"|0\.0\.0\.0"
    r"|10(?:\.\d{1,3}){3}"
    r"|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}"
    r"|192\.168(?:\.\d{1,3}){2}"
    r"|::1"
    r"|\[::1\]"
    r")$",
    re.IGNORECASE,
)
_TITLE_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}")
_TITLE_REGEN_DEFAULT_PROMPT = "给以下内容起一个标题，一般10个字到20个字。"
_TITLE_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？.!?])\s+|[\n\r]+")
_TITLE_STOP_WORDS = {
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "from",
    "into",
    "chat",
    "auto",
    "source",
    "message",
    "messages",
    "knowledge",
    "data",
    "content",
    "session",
    "用户",
    "助手",
    "自动",
    "来源",
    "消息",
    "内容",
    "知识",
    "数据",
}

logger = logging.getLogger(__name__)
_TITLE_REGEN_LLM_LOCK = asyncio.Lock()
_TITLE_REGEN_YIELD_SECONDS = 2.0
_TITLE_REGEN_ADAPTIVE_ACTIVE_WINDOW_SECONDS = 60.0
_TITLE_REGEN_ADAPTIVE_BURST_WINDOW_SECONDS = 15.0
_TITLE_REGEN_ADAPTIVE_ACTIVE_MULTIPLIER = 2.0
_TITLE_REGEN_ADAPTIVE_BURST_MULTIPLIER = 3.0
_AUTO_COLLECT_URL_MIN_CONTENT_CHARS = 1000


def _sanitize_filename(name: str) -> str:
    return _UNSAFE_FILENAME_RE.sub("--", name)


class KnowledgeManager:
    """Manage knowledge source indexing within the CoPaw working directory."""

    def __init__(self, working_dir: str | Path):
        self.working_dir = Path(working_dir).expanduser().resolve()
        self.root_dir = self.working_dir / "knowledge"
        self.index_dir = self.root_dir / "indexes"
        self.uploads_dir = self.root_dir / "uploads"
        self.backfill_state_path = self.root_dir / "history-backfill-state.json"
        self.remote_dir = self.uploads_dir / "remote"
        self.remote_blob_dir = self.remote_dir / "blobs"
        self.remote_meta_dir = self.remote_dir / "url-meta"
        self.title_maintenance_state_path = self.root_dir / "title-maintenance-state.json"
        self.title_regen_queue_state_path = self.root_dir / "title-regen-queue-state.json"
        self.index_dir.mkdir(parents=True, exist_ok=True)
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.remote_blob_dir.mkdir(parents=True, exist_ok=True)
        self.remote_meta_dir.mkdir(parents=True, exist_ok=True)

    def list_sources(self, config: KnowledgeConfig) -> list[dict[str, Any]]:
        """Return configured sources with index metadata when available."""
        results: list[dict[str, Any]] = []
        for source in config.sources:
            payload = source.model_dump(mode="json")
            payload["status"] = self.get_source_status(source.id, source)
            results.append(payload)
        return results

    def normalize_source_name(self, source: KnowledgeSourceSpec) -> KnowledgeSourceSpec:
        """Return a source with auto-generated name derived from its content/location."""
        return self._source_with_auto_name(source)

    async def normalize_source_name_with_llm(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig,
        *,
        timeout_seconds: float = 30.0,
        disable_thinking: bool = True,
        min_content_chars: int = 10,
        title_prompt: str = _TITLE_REGEN_DEFAULT_PROMPT,
    ) -> KnowledgeSourceSpec:
        """Prefer LLM-generated title, fallback to local semantic title."""
        fallback = self.normalize_source_name(source)
        context = self._build_llm_title_context(source, config)
        if not context:
            return fallback

        # Only call LLM when there is sufficient actual document content,
        # not just metadata lines (source_id / source_type / location).
        if not self._context_has_sufficient_content(context, min_content_chars):
            return fallback

        try:
            model, _ = create_model_and_formatter()
        except Exception as exc:
            logger.warning("Knowledge title model unavailable, fallback applied: %s", exc)
            return fallback

        # Optionally suppress thinking/reasoning tokens (e.g. qwen3 /no_think)
        system_suffix = " /no_think" if disable_thinking else ""
        messages = [
            {
                "role": "system",
                "content": (
                    "You generate concise semantic titles for knowledge sources. "
                    "Output one line only, no explanation, max 18 words."
                    + system_suffix
                ),
            },
            {
                "role": "user",
                "content": (
                    f"{(title_prompt or _TITLE_REGEN_DEFAULT_PROMPT).strip()}\n\n"
                    f"{context}"
                ),
            },
        ]

        try:
            response = await asyncio.wait_for(model(messages), timeout=timeout_seconds)
            title = self._sanitize_llm_title(self._extract_text_from_model_response(response))
            if not title:
                return fallback
            return fallback.model_copy(update={"name": title})
        except asyncio.TimeoutError:
            logger.warning(
                "Knowledge title LLM call timed out after %.0fs for source %s, fallback applied",
                timeout_seconds,
                source.id,
            )
            return fallback
        except Exception as exc:
            logger.warning("Knowledge title generation failed, fallback applied: %s", exc)
            return fallback

    async def maintain_next_source_title(
        self,
        config: KnowledgeConfig,
        *,
        use_llm: bool = True,
        title_prompt: str = _TITLE_REGEN_DEFAULT_PROMPT,
        min_content_chars: int = 10,
    ) -> dict[str, Any]:
        """Maintain one source title per call, advancing a persisted cursor."""
        sources = config.sources or []
        if not sources:
            return {"processed": False, "reason": "no_sources"}

        state = self._load_title_maintenance_state()
        cursor = int(state.get("cursor", 0) or 0)
        index = cursor % len(sources)

        source = sources[index]
        old_name = source.name
        if use_llm:
            if self._is_auto_collected_source(source) and self._is_source_content_empty_for_llm_title(
                source,
                config,
                min_content_chars=min_content_chars,
            ):
                removed = sources.pop(index)
                self.delete_index(removed.id)
                next_cursor = (index % len(sources)) if sources else 0
                self._save_title_maintenance_state(
                    {
                        "cursor": next_cursor,
                        "last_source_id": removed.id,
                        "last_deleted": True,
                        "updated_at": datetime.now(UTC).isoformat(),
                    },
                )
                return {
                    "processed": True,
                    "source_id": removed.id,
                    "deleted": True,
                    "next_cursor": next_cursor,
                }
            normalized = await self.normalize_source_name_with_llm(
                source,
                config,
                title_prompt=title_prompt,
                min_content_chars=min_content_chars,
            )
        else:
            normalized = self.normalize_source_name(source)

        updated = normalized.name != old_name
        if updated:
            sources[index] = normalized

        next_cursor = (index + 1) % len(sources)
        self._save_title_maintenance_state(
            {
                "cursor": next_cursor,
                "last_source_id": source.id,
                "last_updated": updated,
                "updated_at": datetime.now(UTC).isoformat(),
            },
        )

        return {
            "processed": True,
            "source_id": source.id,
            "updated": updated,
            "old_name": old_name,
            "new_name": normalized.name,
            "next_cursor": next_cursor,
        }

    def enqueue_title_regeneration(
        self,
        config: KnowledgeConfig,
        *,
        use_llm: bool = True,
        enabled_only: bool = True,
        batch_size: int = 5,
        yield_interval_seconds: float = _TITLE_REGEN_YIELD_SECONDS,
    ) -> dict[str, Any]:
        """Create a queued title-regeneration job and persist it."""
        queue_state = self._load_title_regen_queue_state()
        jobs = queue_state.get("jobs", [])
        active = next(
            (
                item
                for item in jobs
                if item.get("status") in {"queued", "running", "waiting_llm"}
            ),
            None,
        )
        if active is not None:
            return {
                "queued": False,
                "reason": "QUEUE_ALREADY_ACTIVE",
                "job": active,
            }

        source_ids = [
            source.id
            for source in config.sources
            if (source.enabled or not enabled_only)
        ]
        now = datetime.now(UTC).isoformat()
        job = {
            "job_id": hashlib.sha1(f"{now}-{len(source_ids)}".encode("utf-8")).hexdigest()[:12],
            "created_at": now,
            "updated_at": now,
            "status": "queued",
            "priority": "low",
            "use_llm": use_llm,
            "enabled_only": enabled_only,
            "batch_size": max(1, min(20, int(batch_size))),
            "source_ids": source_ids,
            "cursor": 0,
            "processed": 0,
            "updated": 0,
            "deleted": 0,
            "total": len(source_ids),
            "skipped_missing": 0,
            "yield_interval_seconds": max(0.0, min(30.0, float(yield_interval_seconds))),
            "effective_yield_seconds": max(0.0, min(30.0, float(yield_interval_seconds))),
            "yield_mode": "fixed",
            "yield_reason": "no_recent_dispatch",
            "dispatch_age_seconds": None,
            "current_source_id": None,
            "last_processed_source_id": None,
            "yielding_until": None,
            "last_item_duration_ms": None,
            "avg_item_duration_ms": None,
            "timing_samples": 0,
            "errors": [],
        }
        jobs.append(job)
        queue_state["jobs"] = jobs
        queue_state["updated_at"] = now
        self._save_title_regen_queue_state(queue_state)
        return {
            "queued": True,
            "job": job,
        }

    def cancel_active_title_regeneration_jobs(self) -> dict[str, Any]:
        """Cancel active title-regeneration queue jobs and persist state."""
        queue_state = self._load_title_regen_queue_state()
        jobs = queue_state.get("jobs", [])
        if not isinstance(jobs, list):
            return {
                "cancelled": False,
                "cancelled_count": 0,
                "cancelled_job_ids": [],
            }

        active_statuses = {"queued", "running", "waiting_llm"}
        now = datetime.now(UTC).isoformat()
        cancelled_job_ids: list[str] = []
        cancelled_count = 0

        for item in jobs:
            if not isinstance(item, dict):
                continue
            if item.get("status") not in active_statuses:
                continue
            item["status"] = "cancelled"
            item["updated_at"] = now
            item["cancelled_at"] = now
            item["cancel_reason"] = "force_restart"
            item["current_source_id"] = None
            item["yielding_until"] = None
            cancelled_count += 1
            job_id = item.get("job_id")
            if isinstance(job_id, str) and job_id:
                cancelled_job_ids.append(job_id)

        if cancelled_count > 0:
            queue_state["updated_at"] = now
            self._save_title_regen_queue_state(queue_state)

        return {
            "cancelled": cancelled_count > 0,
            "cancelled_count": cancelled_count,
            "cancelled_job_ids": cancelled_job_ids,
        }

    async def process_title_regen_queue_batch(
        self,
        config: KnowledgeConfig,
        running_config: Any | None = None,
        last_dispatch: LastDispatchConfig | None = None,
    ) -> dict[str, Any]:
        """Process one low-priority batch from the queued title-regeneration jobs."""
        queue_state = self._load_title_regen_queue_state()
        jobs = queue_state.get("jobs", [])
        job = next(
            (
                item
                for item in jobs
                if item.get("status") in {"queued", "running", "waiting_llm"}
            ),
            None,
        )
        if job is None:
            return {"processed": False, "reason": "no_active_queue"}

        source_ids = job.get("source_ids", [])
        if not isinstance(source_ids, list) or not source_ids:
            job["status"] = "completed"
            job["updated_at"] = datetime.now(UTC).isoformat()
            self._save_title_regen_queue_state(queue_state)
            return {"processed": False, "reason": "empty_job", "job": job}

        if bool(job.get("use_llm", True)) and _TITLE_REGEN_LLM_LOCK.locked():
            job["status"] = "waiting_llm"
            job["updated_at"] = datetime.now(UTC).isoformat()
            self._save_title_regen_queue_state(queue_state)
            return {"processed": False, "reason": "llm_busy_waiting", "job": job}

        cursor = int(job.get("cursor", 0) or 0)
        batch_size = max(1, min(20, int(job.get("batch_size", 5) or 5)))
        end = min(cursor + batch_size, len(source_ids))
        batch_source_ids = source_ids[cursor:end]
        base_processed = int(job.get("processed", 0) or 0)
        base_updated = int(job.get("updated", 0) or 0)
        updated_count = 0
        processed_count = 0
        source_map = {source.id: idx for idx, source in enumerate(config.sources)}
        use_llm = bool(job.get("use_llm", True))
        yield_seconds = max(
            0.0,
            float(
                job.get(
                    "yield_interval_seconds",
                    getattr(
                        running_config,
                        "knowledge_maintenance_llm_yield_seconds",
                        _TITLE_REGEN_YIELD_SECONDS,
                    ),
                )
                or 0.0
            ),
        )
        errors = job.get("errors")
        if not isinstance(errors, list):
            errors = []

        def _persist_job_state(*, status: str, yielding_until: str | None = None) -> None:
            now = datetime.now(UTC).isoformat()
            job["status"] = status
            job["cursor"] = cursor + processed_count
            job["processed"] = base_processed + processed_count
            job["updated"] = base_updated + updated_count
            job["errors"] = errors
            job["yielding_until"] = yielding_until
            job["updated_at"] = now
            queue_state["updated_at"] = now
            self._save_title_regen_queue_state(queue_state)

        def _resolve_effective_yield() -> tuple[str, float, str, float | None]:
            base_yield = max(0.0, min(30.0, yield_seconds))
            if base_yield <= 0:
                return "fixed", 0.0, "yield_disabled", None

            active_window_seconds = max(
                0.0,
                float(
                    getattr(
                        running_config,
                        "knowledge_title_regen_adaptive_active_window_seconds",
                        _TITLE_REGEN_ADAPTIVE_ACTIVE_WINDOW_SECONDS,
                    )
                    or 0.0
                ),
            )
            burst_window_seconds = max(
                0.0,
                float(
                    getattr(
                        running_config,
                        "knowledge_title_regen_adaptive_burst_window_seconds",
                        _TITLE_REGEN_ADAPTIVE_BURST_WINDOW_SECONDS,
                    )
                    or 0.0
                ),
            )
            active_multiplier = max(
                1.0,
                float(
                    getattr(
                        running_config,
                        "knowledge_title_regen_adaptive_active_multiplier",
                        _TITLE_REGEN_ADAPTIVE_ACTIVE_MULTIPLIER,
                    )
                    or 1.0
                ),
            )
            burst_multiplier = max(
                1.0,
                float(
                    getattr(
                        running_config,
                        "knowledge_title_regen_adaptive_burst_multiplier",
                        _TITLE_REGEN_ADAPTIVE_BURST_MULTIPLIER,
                    )
                    or 1.0
                ),
            )
            dispatched_at = getattr(last_dispatch, "dispatched_at", "") or ""
            if not dispatched_at:
                return "fixed", base_yield, "no_recent_dispatch", None
            try:
                dispatch_time = datetime.fromisoformat(dispatched_at.replace("Z", "+00:00"))
            except ValueError:
                return "fixed", base_yield, "invalid_dispatch_time", None
            if dispatch_time.tzinfo is None:
                dispatch_time = dispatch_time.replace(tzinfo=UTC)
            age_seconds = max(0.0, (datetime.now(UTC) - dispatch_time).total_seconds())
            if burst_window_seconds > 0 and age_seconds <= burst_window_seconds:
                return (
                    "adaptive",
                    round(min(30.0, base_yield * burst_multiplier), 1),
                    "burst_window",
                    age_seconds,
                )
            if active_window_seconds > 0 and age_seconds <= active_window_seconds:
                return (
                    "adaptive",
                    round(min(30.0, base_yield * active_multiplier), 1),
                    "active_window",
                    age_seconds,
                )
            return "fixed", base_yield, "outside_active_window", age_seconds

        def _record_timing(duration_ms: float) -> None:
            samples = int(job.get("timing_samples", 0) or 0) + 1
            prev_avg = float(job.get("avg_item_duration_ms", 0) or 0)
            job["timing_samples"] = samples
            job["last_item_duration_ms"] = round(duration_ms, 1)
            job["avg_item_duration_ms"] = round(
                ((prev_avg * (samples - 1)) + duration_ms) / samples,
                1,
            )
            job["last_item_finished_at"] = datetime.now(UTC).isoformat()

        async def _process_batch() -> None:
            nonlocal updated_count, processed_count, source_map
            loop = asyncio.get_running_loop()
            for index, source_id in enumerate(batch_source_ids):
                idx = source_map.get(source_id)
                if idx is None:
                    job["current_source_id"] = source_id
                    job["skipped_missing"] = int(job.get("skipped_missing", 0) or 0) + 1
                    processed_count += 1
                    job["last_processed_source_id"] = source_id
                    _persist_job_state(status="running")
                    continue
                source = config.sources[idx]
                old_name = source.name
                job["current_source_id"] = source_id
                _persist_job_state(status="running")
                started_at = loop.time()
                try:
                    if use_llm:
                        llm_timeout = float(
                            getattr(
                                running_config,
                                "knowledge_title_regen_llm_timeout_seconds",
                                30.0,
                            )
                            or 30.0
                        )
                        disable_thinking = bool(
                            getattr(
                                running_config,
                                "knowledge_title_regen_disable_thinking",
                                True,
                            )
                        )
                        min_content_chars = int(
                            getattr(
                                running_config,
                                "knowledge_title_min_content_chars",
                                10,
                            )
                            or 10
                        )
                        if self._is_auto_collected_source(source) and self._is_source_content_empty_for_llm_title(
                            source,
                            config,
                            min_content_chars=min_content_chars,
                        ):
                            removed = config.sources.pop(idx)
                            self.delete_index(removed.id)
                            source_map = {
                                item.id: item_idx for item_idx, item in enumerate(config.sources)
                            }
                            job["deleted"] = int(job.get("deleted", 0) or 0) + 1
                            processed_count += 1
                            job["last_processed_source_id"] = source_id
                            _record_timing((loop.time() - started_at) * 1000)
                            _persist_job_state(status="running")
                            continue
                        title_prompt = str(
                            getattr(
                                running_config,
                                "knowledge_title_regen_prompt",
                                _TITLE_REGEN_DEFAULT_PROMPT,
                            )
                            or _TITLE_REGEN_DEFAULT_PROMPT
                        )
                        async with _TITLE_REGEN_LLM_LOCK:
                            normalized = await self.normalize_source_name_with_llm(
                                source,
                                config,
                                timeout_seconds=llm_timeout,
                                disable_thinking=disable_thinking,
                                min_content_chars=min_content_chars,
                                title_prompt=title_prompt,
                            )
                    else:
                        normalized = self.normalize_source_name(source)
                    config.sources[idx] = normalized
                    if normalized.name != old_name:
                        updated_count += 1
                except Exception as exc:  # pylint: disable=broad-except
                    errors.append({"source_id": source_id, "error": str(exc)})
                processed_count += 1
                job["last_processed_source_id"] = source_id
                _record_timing((loop.time() - started_at) * 1000)
                _persist_job_state(status="running")

                has_more_in_batch = index < len(batch_source_ids) - 1
                if use_llm and has_more_in_batch and yield_seconds > 0:
                    (
                        yield_mode,
                        effective_yield_seconds,
                        yield_reason,
                        dispatch_age_seconds,
                    ) = _resolve_effective_yield()
                    job["yield_mode"] = yield_mode
                    job["effective_yield_seconds"] = effective_yield_seconds
                    job["yield_reason"] = yield_reason
                    job["dispatch_age_seconds"] = (
                        round(dispatch_age_seconds, 1)
                        if dispatch_age_seconds is not None
                        else None
                    )
                    yielding_until = (
                        datetime.now(UTC) + timedelta(seconds=effective_yield_seconds)
                    ).isoformat()
                    _persist_job_state(status="running", yielding_until=yielding_until)
                    await asyncio.sleep(effective_yield_seconds)

        await _process_batch()

        final_status = "running" if end < len(source_ids) else "completed"
        if final_status == "completed":
            job["current_source_id"] = None
        if "yield_mode" not in job or "effective_yield_seconds" not in job:
            (
                default_yield_mode,
                default_effective_yield,
                default_reason,
                default_age_seconds,
            ) = _resolve_effective_yield()
            job["yield_mode"] = default_yield_mode
            job["effective_yield_seconds"] = default_effective_yield
            job["yield_reason"] = default_reason
            job["dispatch_age_seconds"] = (
                round(default_age_seconds, 1)
                if default_age_seconds is not None
                else None
            )
        _persist_job_state(status=final_status)

        return {
            "processed": processed_count > 0,
            "job": job,
            "updated_count": updated_count,
            "config_changed": updated_count > 0,
            "batch_processed": processed_count,
        }

    def get_title_regen_queue_status(self) -> dict[str, Any]:
        """Return queued regeneration status for observability/control."""
        queue_state = self._load_title_regen_queue_state()
        jobs = queue_state.get("jobs", [])
        active_statuses = {"queued", "running", "waiting_llm"}
        active = next(
            (item for item in jobs if item.get("status") in active_statuses),
            None,
        )
        active_list = [item for item in jobs if item.get("status") in active_statuses]
        running_list = [item for item in jobs if item.get("status") == "running"]
        completed_list = [
            item for item in jobs if item.get("status") == "completed"
        ]
        last_completed = (
            max(completed_list, key=lambda j: j.get("updated_at", ""))
            if completed_list
            else None
        )

        active_payload = dict(active) if isinstance(active, dict) else active
        if isinstance(active_payload, dict):
            source_ids = active_payload.get("source_ids")
            cursor = int(active_payload.get("cursor", 0) or 0)
            inferred_source_id: str | None = None
            if isinstance(source_ids, list) and source_ids:
                if 0 <= cursor < len(source_ids):
                    inferred_source_id = source_ids[cursor]
                elif cursor > 0 and cursor - 1 < len(source_ids):
                    inferred_source_id = source_ids[cursor - 1]

            if active_payload.get("current_source_id") is None:
                active_payload["current_source_id"] = inferred_source_id
            if active_payload.get("last_processed_source_id") is None and cursor > 0:
                if isinstance(source_ids, list) and cursor - 1 < len(source_ids):
                    active_payload["last_processed_source_id"] = source_ids[cursor - 1]

        return {
            "has_active_job": active_payload is not None,
            "active_job": active_payload,
            "queued_jobs": len(active_list),
            "running_jobs": len(running_list),
            "last_completed_job": last_completed,
            "updated_at": queue_state.get("updated_at"),
        }

    def get_source_status(
        self,
        source_id: str,
        source: KnowledgeSourceSpec | None = None,
    ) -> dict[str, Any]:
        """Return persisted index metadata for a source."""
        index_path = self._index_path(source_id)
        if not index_path.exists():
            status = {
                "indexed": False,
                "indexed_at": None,
                "document_count": 0,
                "chunk_count": 0,
                "error": None,
            }
            if source is not None:
                status.update(self._remote_source_status(source))
            return status

        payload = self._load_json(index_path)
        status = {
            "indexed": True,
            "indexed_at": payload.get("indexed_at"),
            "document_count": payload.get("document_count", 0),
            "chunk_count": payload.get("chunk_count", 0),
            "error": payload.get("error"),
        }
        if source is not None:
            status.update(self._remote_source_status(source))
        return status

    def index_source(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig,
        running_config: Any | None = None,
    ) -> dict[str, Any]:
        """Index a single source into chunked JSON files."""
        documents = self._load_documents(source, config)
        chunks = self._chunk_documents(
            documents,
            self._resolve_chunk_size(config, running_config),
        )
        payload = {
            "source": source.model_dump(mode="json"),
            "indexed_at": datetime.now(UTC).isoformat(),
            "document_count": len(documents),
            "chunk_count": len(chunks),
            "error": None,
            "chunks": chunks,
        }
        self._index_path(source.id).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return {
            "source_id": source.id,
            "document_count": len(documents),
            "chunk_count": len(chunks),
            "indexed_at": payload["indexed_at"],
        }

    def index_all(
        self,
        config: KnowledgeConfig,
        running_config: Any | None = None,
    ) -> dict[str, Any]:
        """Index all enabled sources."""
        results = []
        for source in config.sources:
            if not source.enabled:
                continue
            results.append(self.index_source(source, config, running_config))
        return {
            "indexed_sources": len(results),
            "results": results,
        }

    def delete_index(self, source_id: str) -> None:
        """Delete persisted index for a source."""
        index_path = self._index_path(source_id)
        if index_path.exists():
            index_path.unlink()

    def search(
        self,
        query: str,
        config: KnowledgeConfig,
        limit: int = 10,
        source_ids: list[str] | None = None,
        source_types: list[str] | None = None,
    ) -> dict[str, Any]:
        """Search indexed chunks with a lightweight lexical scorer."""
        source_map = {source.id: source for source in config.sources}
        terms = [term for term in re.findall(r"\w+", query.lower()) if term]
        if not terms:
            return {"query": query, "hits": []}

        hits: list[dict[str, Any]] = []
        for source in config.sources:
            if source_ids and source.id not in source_ids:
                continue
            if source_types and source.type not in source_types:
                continue
            index_path = self._index_path(source.id)
            if not index_path.exists():
                continue
            payload = self._load_json(index_path)
            for chunk in payload.get("chunks", []):
                score = self._score_chunk(chunk.get("text", ""), terms)
                if score <= 0:
                    continue
                hits.append(
                    {
                        "source_id": source.id,
                        "source_name": source_map[source.id].name,
                        "source_type": source.type,
                        "document_path": chunk.get("document_path"),
                        "document_title": chunk.get("document_title"),
                        "score": score,
                        "snippet": self._build_snippet(
                            chunk.get("text", ""),
                            terms,
                        ),
                    },
                )

        hits.sort(key=lambda item: item["score"], reverse=True)
        return {"query": query, "hits": hits[:limit]}

    def get_source_documents(self, source_id: str) -> dict[str, Any]:
        """Return the indexed documents for a source, merged by document path."""
        index_path = self._index_path(source_id)
        if not index_path.exists():
            return {"indexed": False, "documents": []}
        payload = self._load_json(index_path)
        chunks = payload.get("chunks", [])
        # Merge chunks back into per-document text blocks
        docs: dict[str, dict[str, Any]] = {}
        for chunk in chunks:
            doc_path = chunk.get("document_path") or source_id
            if doc_path not in docs:
                docs[doc_path] = {
                    "path": doc_path,
                    "title": chunk.get("document_title") or doc_path,
                    "text": [],
                }
            docs[doc_path]["text"].append(chunk.get("text", ""))
        documents = [
            {
                "path": d["path"],
                "title": d["title"],
                "text": "\n\n".join(d["text"]),
            }
            for d in docs.values()
        ]
        return {
            "indexed": True,
            "indexed_at": payload.get("indexed_at"),
            "document_count": payload.get("document_count", len(documents)),
            "chunk_count": payload.get("chunk_count", len(chunks)),
            "documents": documents,
        }

    def _index_path(self, source_id: str) -> Path:
        return self.index_dir / f"{source_id}.json"

    @staticmethod
    def _load_json(path: Path) -> dict[str, Any]:
        return json.loads(path.read_text(encoding="utf-8"))

    def _load_documents(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig,
    ) -> list[dict[str, str]]:
        if source.type == "file":
            path = Path(source.location).expanduser().resolve()
            return [self._read_file_document(path, config)]
        if source.type == "directory":
            return self._read_directory_documents(Path(source.location), source, config)
        if source.type == "url":
            if source.content and source.content.strip():
                return [
                    {
                        "path": source.location or source.id,
                        "title": source.name,
                        "text": self._normalize_text(source.content),
                    }
                ]
            return [self._read_url_document(source.location)]
        if source.type == "chat":
            if source.location and source.location.strip():
                return self._read_single_chat_document(source.location.strip())
            return self._read_chat_documents()
        text_content = source.content.strip()
        if not text_content and source.location.strip():
            text_content = Path(source.location).expanduser().read_text(
                encoding="utf-8",
            )
        return [
            {
                "path": source.location or source.id,
                "title": source.name,
                "text": self._normalize_text(text_content),
            },
        ]

    def _read_directory_documents(
        self,
        directory: Path,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig,
    ) -> list[dict[str, str]]:
        root = directory.expanduser().resolve()
        if not root.exists() or not root.is_dir():
            raise FileNotFoundError(f"Knowledge directory not found: {root}")

        pattern = "**/*" if source.recursive else "*"
        documents: list[dict[str, str]] = []
        for path in root.glob(pattern):
            if not path.is_file():
                continue
            relative = path.relative_to(root).as_posix()
            if not self._is_allowed_path(relative, config):
                continue
            documents.append(self._read_file_document(path, config))
        return documents

    def save_uploaded_file(self, source_id: str, filename: str, data: bytes) -> Path:
        """Persist an uploaded file and return its saved path."""
        safe_source = self._safe_name(source_id)
        safe_name = self._safe_name(Path(filename).name)
        target_dir = self.uploads_dir / "files" / safe_source
        if target_dir.exists():
            shutil.rmtree(target_dir, ignore_errors=True)
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / safe_name
        target_path.write_bytes(data)
        return target_path

    def save_uploaded_directory(
        self,
        source_id: str,
        files: list[tuple[str, bytes]],
    ) -> Path:
        """Persist an uploaded directory snapshot and return its root path."""
        safe_source = self._safe_name(source_id)
        target_dir = self.uploads_dir / "directories" / safe_source
        if target_dir.exists():
            shutil.rmtree(target_dir, ignore_errors=True)
        target_dir.mkdir(parents=True, exist_ok=True)

        for relative_path, data in files:
            normalized = Path(relative_path)
            safe_parts = [self._safe_name(part) for part in normalized.parts if part not in {"", "."}]
            if not safe_parts:
                continue
            file_path = target_dir.joinpath(*safe_parts)
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_bytes(data)
        return target_dir

    def _read_chat_documents(self) -> list[dict[str, str]]:
        """Build documents from persisted chat registry and session files."""
        chats_path = self.working_dir / CHATS_FILE
        if not chats_path.exists():
            return []
        payload = json.loads(chats_path.read_text(encoding="utf-8"))
        chats = payload.get("chats", [])
        documents: list[dict[str, str]] = []
        sessions_dir = self.working_dir / "sessions"
        for chat in chats:
            session_id = chat.get("session_id", "")
            user_id = chat.get("user_id", "")
            session_path = sessions_dir / self._session_filename(session_id, user_id)
            collected_text = ""
            if session_path.exists():
                state = json.loads(session_path.read_text(encoding="utf-8"))
                collected_text = self._extract_visible_chat_text(state)
            text = self._normalize_text(
                "\n".join(
                    part
                    for part in [
                        chat.get("name", ""),
                        chat.get("channel", ""),
                        session_id,
                        collected_text,
                    ]
                    if part
                ),
            )
            if not text:
                continue
            documents.append(
                {
                    "path": str(session_path),
                    "title": chat.get("name") or session_id or "chat",
                    "text": text,
                },
            )
        return documents

    def _read_single_chat_document(self, session_id: str) -> list[dict[str, str]]:
        """Load a single chat session by session_id and return it as one text document."""
        chats_path = self.working_dir / CHATS_FILE
        sessions_dir = self.working_dir / "sessions"
        chat_meta: dict[str, Any] = {}

        # Try to find matching chat metadata from registry
        if chats_path.exists():
            try:
                payload = json.loads(chats_path.read_text(encoding="utf-8"))
                for chat in payload.get("chats", []):
                    if chat.get("session_id", "") == session_id:
                        chat_meta = chat
                        break
            except Exception:
                pass

        user_id = chat_meta.get("user_id", "")
        chat_name = chat_meta.get("name", "") or session_id

        # Try known session filename patterns
        candidates: list[Path] = []
        if user_id:
            candidates.append(sessions_dir / self._session_filename(session_id, user_id))
        candidates.append(sessions_dir / self._session_filename(session_id, ""))
        # Glob fallback: any file ending with the sanitized session_id
        safe_sid = _sanitize_filename(session_id)
        candidates.extend(sessions_dir.glob(f"*_{safe_sid}.json") if sessions_dir.exists() else [])
        candidates.extend(sessions_dir.glob(f"{safe_sid}.json") if sessions_dir.exists() else [])

        session_path: Path | None = None
        for candidate in candidates:
            if candidate.exists():
                session_path = candidate
                break

        if session_path is None:
            raise FileNotFoundError(
                f"Session file not found for session_id: {session_id}"
            )

        state = json.loads(session_path.read_text(encoding="utf-8"))
        collected_text = self._extract_visible_chat_text(state)
        text = self._normalize_text(collected_text)
        if not text:
            raise ValueError(f"No visible text found in session: {session_id}")

        return [
            {
                "path": str(session_path),
                "title": chat_name,
                "text": text,
            }
        ]

    def auto_collect_from_messages(
        self,
        config: KnowledgeConfig,
        session_id: str,
        user_id: str,
        request_messages: list[Any] | None,
        response_messages: list[Any] | None = None,
        running_config: Any | None = None,
    ) -> dict[str, Any]:
        """Auto-create knowledge sources from the current chat turn."""
        if not config.enabled:
            return {
                "changed": False,
                "file_sources": 0,
                "url_sources": 0,
                "text_sources": 0,
            }

        changed = False
        file_sources = 0
        url_sources = 0
        text_sources = 0
        errors: list[dict[str, str]] = []
        turn_messages = list(request_messages or []) + list(response_messages or [])

        auto_collect_chat_files = getattr(running_config, "auto_collect_chat_files", None)
        if auto_collect_chat_files is None:
            auto_collect_chat_files = config.automation.auto_collect_chat_files

        auto_collect_long_text = getattr(running_config, "auto_collect_long_text", None)
        if auto_collect_long_text is None:
            auto_collect_long_text = config.automation.auto_collect_long_text

        auto_collect_chat_urls = getattr(running_config, "auto_collect_chat_urls", None)
        if auto_collect_chat_urls is None:
            auto_collect_chat_urls = config.automation.auto_collect_chat_urls
        auto_collect_url_min_chars = int(
            getattr(
                running_config,
                "auto_collect_url_min_chars",
                _AUTO_COLLECT_URL_MIN_CONTENT_CHARS,
            )
            or _AUTO_COLLECT_URL_MIN_CONTENT_CHARS
        )

        long_text_min_chars = getattr(running_config, "long_text_min_chars", None)
        if not isinstance(long_text_min_chars, int):
            long_text_min_chars = config.automation.long_text_min_chars

        if auto_collect_chat_files:
            for source in self._build_file_sources_from_messages(
                turn_messages,
                config,
                session_id,
            ):
                if self._upsert_source(config, source):
                    changed = True
                self._index_source_with_recovery(
                    source,
                    config,
                    running_config,
                    errors,
                )
                file_sources += 1

        if auto_collect_long_text:
            for source in self._build_text_sources_from_messages(
                turn_messages,
                config,
                session_id,
                user_id,
                long_text_min_chars,
            ):
                if self._upsert_source(config, source):
                    changed = True
                self._index_source_with_recovery(
                    source,
                    config,
                    running_config,
                    errors,
                )
                text_sources += 1

        if auto_collect_chat_urls:
            for source in self._build_url_sources_from_messages(
                turn_messages,
                session_id,
                user_id,
                automation_config=config.automation,
                min_content_chars=auto_collect_url_min_chars,
            ):
                if self._upsert_source(config, source):
                    changed = True
                self._index_source_with_recovery(
                    source,
                    config,
                    running_config,
                    errors,
                )
                url_sources += 1

        result = {
            "changed": changed,
            "file_sources": file_sources,
            "url_sources": url_sources,
            "text_sources": text_sources,
        }
        if errors:
            result["failed_sources"] = len(errors)
            result["errors"] = errors
        return result

    def auto_backfill_history_data(
        self,
        config: KnowledgeConfig,
        running_config: Any | None = None,
    ) -> dict[str, Any]:
        """Backfill historical chat-session data into knowledge sources once."""
        if not config.enabled:
            return {"changed": False, "skipped": True, "reason": "knowledge_disabled"}

        enabled = getattr(running_config, "auto_backfill_history_data", True)
        if not enabled:
            return {"changed": False, "skipped": True, "reason": "backfill_disabled"}

        signature = self._history_backfill_signature(running_config)
        state = self._load_backfill_state()
        if (
            state.get("completed")
            and state.get("signature") == signature
        ):
            return {"changed": False, "skipped": True, "reason": "already_completed"}

        chats_path = self.working_dir / CHATS_FILE
        if chats_path.exists():
            payload = self._load_json(chats_path)
            chats = payload.get("chats", [])
        else:
            chats = []

        sessions_dir = self.working_dir / "sessions"
        changed = False
        processed_sessions = 0
        file_sources = 0
        url_sources = 0
        text_sources = 0
        errors: list[dict[str, str]] = []

        long_text_min_chars = getattr(running_config, "long_text_min_chars", None)
        if not isinstance(long_text_min_chars, int):
            long_text_min_chars = config.automation.long_text_min_chars
        auto_collect_chat_files = getattr(running_config, "auto_collect_chat_files", False)
        auto_collect_chat_urls = getattr(running_config, "auto_collect_chat_urls", True)
        auto_collect_long_text = getattr(running_config, "auto_collect_long_text", False)
        auto_collect_url_min_chars = int(
            getattr(
                running_config,
                "auto_collect_url_min_chars",
                _AUTO_COLLECT_URL_MIN_CONTENT_CHARS,
            )
            or _AUTO_COLLECT_URL_MIN_CONTENT_CHARS
        )

        for chat in chats:
            session_id = str(chat.get("session_id", "") or "")
            user_id = str(chat.get("user_id", "") or "")
            if not session_id:
                continue
            session_path = sessions_dir / self._session_filename(session_id, user_id)
            if not session_path.exists():
                continue
            state_payload = self._load_json(session_path)
            messages = self._messages_from_session_state(state_payload)
            if not messages:
                continue
            processed_sessions += 1

            if auto_collect_chat_files:
                for source in self._build_file_sources_from_messages(
                    messages,
                    config,
                    session_id,
                ):
                    upserted = self._upsert_source(config, source)
                    if upserted:
                        changed = True
                        self._index_source_with_recovery(
                            source,
                            config,
                            running_config,
                            errors,
                        )
                    file_sources += 1

            if auto_collect_long_text:
                for source in self._build_text_sources_from_messages(
                    messages,
                    config,
                    session_id,
                    user_id,
                    long_text_min_chars,
                ):
                    upserted = self._upsert_source(config, source)
                    if upserted:
                        changed = True
                        self._index_source_with_recovery(
                            source,
                            config,
                            running_config,
                            errors,
                        )
                    text_sources += 1

            if auto_collect_chat_urls:
                for source in self._build_url_sources_from_messages(
                    messages,
                    session_id,
                    user_id,
                    automation_config=config.automation,
                    min_content_chars=auto_collect_url_min_chars,
                ):
                    upserted = self._upsert_source(config, source)
                    if upserted:
                        changed = True
                        self._index_source_with_recovery(
                            source,
                            config,
                            running_config,
                            errors,
                        )
                    url_sources += 1

        self._save_backfill_state(
            {
                "completed": True,
                "signature": signature,
                "processed_sessions": processed_sessions,
                "file_sources": file_sources,
                "url_sources": url_sources,
                "text_sources": text_sources,
                "updated_at": datetime.now(UTC).isoformat(),
            },
        )
        result = {
            "changed": changed,
            "skipped": False,
            "processed_sessions": processed_sessions,
            "file_sources": file_sources,
            "url_sources": url_sources,
            "text_sources": text_sources,
        }
        if errors:
            result["failed_sources"] = len(errors)
            result["errors"] = errors
        return result

    def _index_source_with_recovery(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig,
        running_config: Any | None,
        errors: list[dict[str, str]],
    ) -> None:
        try:
            self.index_source(source, config, running_config)
        except Exception as exc:
            errors.append(
                {
                    "source_id": source.id,
                    "source_type": source.type,
                    "location": source.location,
                    "error": str(exc),
                },
            )

    def _read_file_document(
        self,
        path: Path,
        config: KnowledgeConfig,
    ) -> dict[str, str]:
        file_path = path.expanduser().resolve()
        if not file_path.exists() or not file_path.is_file():
            raise FileNotFoundError(f"Knowledge file not found: {file_path}")
        if file_path.stat().st_size > config.index.max_file_size:
            raise ValueError(f"Knowledge file exceeds max size: {file_path}")
        return {
            "path": str(file_path),
            "title": file_path.name,
            "text": self._normalize_text(
                file_path.read_text(encoding="utf-8", errors="ignore"),
            ),
        }

    @staticmethod
    def _read_url_document(url: str) -> dict[str, str]:
        response = httpx.get(url, timeout=10.0, follow_redirects=True)
        response.raise_for_status()
        content = response.text
        title = url
        if "text/html" in response.headers.get("content-type", ""):
            title_match = re.search(
                r"<title[^>]*>(.*?)</title>",
                content,
                flags=re.S | re.I,
            )
            if title_match:
                extracted = KnowledgeManager._normalize_text(
                    unescape(title_match.group(1)),
                )
                if extracted:
                    title = extracted
            content = re.sub(r"<script.*?</script>", " ", content, flags=re.S | re.I)
            content = re.sub(r"<style.*?</style>", " ", content, flags=re.S | re.I)
            content = re.sub(r"<[^>]+>", " ", content)
        return {
            "path": url,
            "title": title,
            "text": KnowledgeManager._normalize_text(unescape(content)),
        }

    @staticmethod
    def _normalize_text(text: str) -> str:
        compact = text.replace("\r", "\n")
        # Remove all blank lines (lines containing only whitespace)
        compact = re.sub(r"\n[ \t]*\n+", "\n", compact)
        compact = re.sub(r"[ \t]+", " ", compact)
        return compact.strip()

    def _extract_visible_chat_text(self, state: dict[str, Any]) -> str:
        messages = self._messages_from_session_state(state)
        snippets = [
            self._extract_text_from_runtime_message(message)
            for message in messages
        ]
        return self._normalize_text("\n\n".join(item for item in snippets if item))

    @staticmethod
    def _messages_from_session_state(state: dict[str, Any]) -> list[dict[str, Any]]:
        memory_state = state.get("agent", {}).get("memory", {})
        if isinstance(memory_state, dict):
            raw_entries = memory_state.get("content", [])
        elif isinstance(memory_state, list):
            raw_entries = memory_state
        else:
            raw_entries = []

        messages: list[dict[str, Any]] = []
        for entry in raw_entries:
            raw_message = None
            if isinstance(entry, list) and entry:
                raw_message = entry[0]
            elif isinstance(entry, dict):
                raw_message = entry
            if not isinstance(raw_message, dict):
                continue
            if raw_message.get("type") in {"plugin_call", "plugin_call_output"}:
                continue
            messages.append(raw_message)
        return messages

    @staticmethod
    def _extract_text_from_state(value: Any) -> str:
        snippets: list[str] = []

        def walk(node: Any) -> None:
            if isinstance(node, str):
                cleaned = node.strip()
                if cleaned:
                    snippets.append(cleaned)
                return
            if isinstance(node, list):
                for item in node:
                    walk(item)
                return
            if isinstance(node, dict):
                for key in ("text", "thinking", "output", "name", "role"):
                    if key in node and isinstance(node[key], str):
                        walk(node[key])
                content = node.get("content")
                if content is not None:
                    walk(content)
                data = node.get("data")
                if data is not None:
                    walk(data)
                for nested_key, nested_value in node.items():
                    if nested_key in {"text", "thinking", "output", "name", "role", "content", "data"}:
                        continue
                    if isinstance(nested_value, (dict, list)):
                        walk(nested_value)

        walk(value)
        return "\n".join(snippets)

    def _build_file_sources_from_messages(
        self,
        messages: list[Any],
        config: KnowledgeConfig,
        session_id: str,
    ) -> list[KnowledgeSourceSpec]:
        sources: list[KnowledgeSourceSpec] = []
        seen_ids: set[str] = set()
        for block in self._iter_message_blocks(messages):
            if block.get("type") != "file":
                continue
            file_ref = self._file_reference_from_block(block)
            if not file_ref:
                continue
            parsed_ref = urlparse(file_ref)
            remote_hash = None
            if parsed_ref.scheme in {"http", "https"}:
                remote_hash = hashlib.sha1(file_ref.encode("utf-8")).hexdigest()
            stored_path = self._materialize_file_reference(
                file_ref,
                block.get("name") or Path(file_ref).name or "chat-file",
                config,
            )
            if stored_path is None:
                continue
            digest = hashlib.sha1(str(stored_path).encode("utf-8")).hexdigest()[:12]
            source_id = f"auto-file-{digest}"
            if source_id in seen_ids:
                continue
            seen_ids.add(source_id)
            tags = ["auto", "origin:auto", "source:chat", "auto:file"]
            if remote_hash:
                tags.extend(["remote:http", f"remote:url_hash:{remote_hash}"])
            sources.append(
                KnowledgeSourceSpec(
                    id=source_id,
                    name=f"Auto File: {stored_path.name}",
                    type="file",
                    location=str(stored_path),
                    enabled=True,
                    recursive=False,
                    tags=tags,
                    description=f"Auto-collected from chat session {session_id}",
                ),
            )
        return sources

    def _build_text_sources_from_messages(
        self,
        messages: list[Any],
        config: KnowledgeConfig,
        session_id: str,
        user_id: str,
        long_text_min_chars: int,
    ) -> list[KnowledgeSourceSpec]:
        sources: list[KnowledgeSourceSpec] = []
        seen_ids: set[str] = set()
        for role, text in self._iter_message_texts(messages):
            normalized = self._normalize_text(text)
            if len(normalized) < long_text_min_chars:
                continue
            digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:12]
            source_id = f"auto-text-{digest}"
            if source_id in seen_ids:
                continue
            seen_ids.add(source_id)
            title = normalized.splitlines()[0][:48] or "Long chat text"
            sources.append(
                KnowledgeSourceSpec(
                    id=source_id,
                    name=f"Auto Text: {title}",
                    type="text",
                    content=normalized,
                    enabled=True,
                    recursive=False,
                    tags=[
                        "auto",
                        "origin:auto",
                        "source:chat",
                        "auto:text",
                        f"role:{role}",
                    ],
                    description=(
                        f"Auto-saved from {role} message in {session_id}"
                        + (f" for {user_id}" if user_id else "")
                    ),
                ),
            )
        return sources

    def _build_url_sources_from_messages(
        self,
        messages: list[Any],
        session_id: str,
        user_id: str,
        automation_config: Any | None = None,
        min_content_chars: int | None = None,
    ) -> list[KnowledgeSourceSpec]:
        sources: list[KnowledgeSourceSpec] = []
        seen_ids: set[str] = set()
        for role, text in self._iter_message_texts(messages):
            for url in self._extract_urls_from_text(text):
                if self._should_exclude_url(url, automation_config):
                    logger.debug("Skipping excluded URL: %s", url)
                    continue
                digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
                source_id = f"auto-url-{digest}"
                if source_id in seen_ids:
                    continue
                seen_ids.add(source_id)
                label = url if len(url) <= 80 else f"{url[:77]}..."
                fetched_text = ""
                if min_content_chars is not None:
                    try:
                        doc = self._read_url_document(url)
                    except Exception:
                        continue
                    fetched_text = self._normalize_text(doc.get("text", ""))
                    if len(fetched_text) < max(0, min_content_chars):
                        continue
                # Capture surrounding text context from the conversation message
                # so title generation can use it without fetching the URL.
                context_snippet = self._extract_url_context(text, url, max_chars=400)
                description = (
                    f"Auto-collected URL from {role} message in {session_id}"
                    + (f" for {user_id}" if user_id else "")
                )
                if context_snippet:
                    description = f"{description}\n来源上下文: {context_snippet}"
                sources.append(
                    KnowledgeSourceSpec(
                        id=source_id,
                        name=f"Auto URL: {label}",
                        type="url",
                        location=url,
                        content=fetched_text,
                        enabled=True,
                        recursive=False,
                        tags=[
                            "auto",
                            "origin:auto",
                            "source:chat",
                            "auto:url",
                            f"role:{role}",
                        ],
                        description=description,
                    ),
                )
        return sources

    @staticmethod
    def _extract_urls_from_text(text: str) -> list[str]:
        found: list[str] = []
        seen: set[str] = set()
        for match in _CHAT_URL_RE.findall(text or ""):
            cleaned = match.rstrip(_URL_TRAILING_STRIP_CHARS)
            if not cleaned:
                continue

            # Defensive normalization: a previously merged token may contain
            # additional URLs separated by CJK words or punctuation.
            normalized_urls: list[str] = []
            cjk_chunks = re.split(r"[\u4e00-\u9fff]+", cleaned)
            for chunk in cjk_chunks:
                chunk = chunk.strip()
                if not chunk:
                    continue
                nested = _CHAT_URL_RE.findall(chunk)
                if nested:
                    normalized_urls.extend(nested)
                else:
                    normalized_urls.append(chunk)

            for candidate in normalized_urls:
                candidate = candidate.rstrip(_URL_TRAILING_STRIP_CHARS)
                if not candidate or candidate in seen:
                    continue
                seen.add(candidate)
                found.append(candidate)
        return found

    @staticmethod
    def _should_exclude_url(url: str, automation_config: Any | None = None) -> bool:
        """Return True if the URL should be excluded from auto-collection.

        Exclusion criteria (all can be toggled via automation_config):
        - Private/intranet addresses (localhost, 127.x, 192.168.x, etc.)
        - URLs containing credential/token query parameters
        - User-defined exclusion prefix patterns
        """
        try:
            parsed = urlparse(url)
        except Exception:
            return False

        # Private-address exclusion
        exclude_private = True
        if automation_config is not None:
            exclude_private = bool(
                getattr(automation_config, "url_exclude_private_addresses", True)
            )
        if exclude_private:
            host = parsed.hostname or ""
            if _PRIVATE_HOST_RE.match(host):
                return True

        # Token/credential query-param exclusion
        exclude_tokens = True
        if automation_config is not None:
            exclude_tokens = bool(
                getattr(automation_config, "url_exclude_token_params", True)
            )
        if exclude_tokens and parsed.query:
            try:
                params = parse_qs(parsed.query, keep_blank_values=True)
                if any(k.lower() in _URL_SENSITIVE_PARAMS for k in params):
                    return True
            except Exception:
                pass

        # User-defined pattern exclusion (prefix match)
        exclude_patterns: list[str] = []
        if automation_config is not None:
            raw = getattr(automation_config, "url_exclude_patterns", None)
            if isinstance(raw, list):
                exclude_patterns = raw
        for pattern in exclude_patterns:
            if isinstance(pattern, str) and url.startswith(pattern):
                return True

        return False

    @staticmethod
    def _extract_url_context(text: str, url: str, max_chars: int = 400) -> str:
        """Extract a snippet of surrounding text around the given URL.

        Returns up to max_chars/2 chars before and max_chars/2 after
        the URL occurrence, stripped and compacted.
        """
        idx = text.find(url)
        if idx == -1:
            return ""
        half = max_chars // 2
        before = text[max(0, idx - half): idx].strip()
        after = text[idx + len(url): idx + len(url) + half].strip()
        parts = [p for p in (before, after) if p]
        snippet = " ... ".join(parts)
        # Compact whitespace
        snippet = re.sub(r"\s+", " ", snippet).strip()
        return snippet[:max_chars]

    @staticmethod
    def _context_has_sufficient_content(context: str, min_chars: int = 50) -> bool:
        """Return True if context contains actual document content beyond metadata.

        Looks for the presence of a document_text or content section.
        """
        if min_chars <= 0:
            return True
        # Identify real-content markers
        for marker in ("document_text:\n", "content:\n", "来源上下文:"):
            idx = context.find(marker)
            if idx != -1:
                actual = context[idx + len(marker):].strip()
                if len(actual) >= min_chars:
                    return True
        return False

    @staticmethod
    def _block_to_dict(block: Any) -> dict[str, Any] | None:
        if isinstance(block, dict):
            return block
        if hasattr(block, "model_dump"):
            return block.model_dump()
        if hasattr(block, "dict"):
            return block.dict()
        return None

    def _iter_message_blocks(self, messages: list[Any]) -> list[dict[str, Any]]:
        blocks: list[dict[str, Any]] = []
        for message in messages:
            content = getattr(message, "content", None)
            if isinstance(message, dict):
                content = message.get("content")
            if isinstance(content, str):
                blocks.append({"type": "text", "text": content})
                continue
            if not isinstance(content, list):
                continue
            for block in content:
                payload = self._block_to_dict(block)
                if payload is not None:
                    blocks.append(payload)
        return blocks

    def _iter_message_texts(self, messages: list[Any]) -> list[tuple[str, str]]:
        texts: list[tuple[str, str]] = []
        for message in messages:
            role = getattr(message, "role", None)
            if isinstance(message, dict):
                role = message.get("role")
            role = role or "assistant"
            if isinstance(message, dict) and message.get("type") in {
                "plugin_call",
                "plugin_call_output",
            }:
                continue
            content = getattr(message, "content", None)
            if isinstance(message, dict):
                content = message.get("content")
            if isinstance(content, str):
                texts.append((role, content))
                continue
            if not isinstance(content, list):
                continue
            joined: list[str] = []
            for block in content:
                payload = self._block_to_dict(block)
                if not payload or payload.get("type") != "text":
                    continue
                text = payload.get("text")
                if isinstance(text, str) and text.strip():
                    joined.append(text)
            if joined:
                texts.append((role, "\n".join(joined)))
        return texts

    def _extract_text_from_runtime_message(self, message: dict[str, Any]) -> str:
        content = message.get("content")
        if isinstance(content, str):
            return self._normalize_text(content)
        if not isinstance(content, list):
            return ""
        snippets: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                text = block.get("text")
                if isinstance(text, str) and text.strip():
                    snippets.append(text)
        return self._normalize_text("\n".join(snippets))

    @staticmethod
    def _file_reference_from_block(block: dict[str, Any]) -> str:
        for key in ("file_url", "path", "url"):
            value = block.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        source = block.get("source")
        if isinstance(source, dict):
            value = source.get("url") or source.get("path")
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""

    def _materialize_file_reference(
        self,
        file_ref: str,
        filename: str,
        config: KnowledgeConfig,
    ) -> Path | None:
        parsed = urlparse(file_ref)
        if parsed.scheme in {"", "file"}:
            local_value = parsed.path if parsed.scheme == "file" else file_ref
            path = Path(local_value).expanduser()
            if path.exists() and path.is_file():
                return path.resolve()
            return None

        if parsed.scheme in {"http", "https"}:
            downloaded_name = Path(parsed.path).name or filename
            return self._download_remote_file_with_cache(
                file_ref,
                downloaded_name,
                config,
            )
        return None

    def _download_remote_file_with_cache(
        self,
        url: str,
        filename: str,
        config: KnowledgeConfig,
    ) -> Path | None:
        url_key = hashlib.sha1(url.encode("utf-8")).hexdigest()
        meta_path = self.remote_meta_dir / f"{url_key}.json"
        now = datetime.now(UTC)
        metadata: dict[str, Any] = {}

        if meta_path.exists():
            metadata = self._load_json(meta_path)
            cached_path = metadata.get("file_path")
            if isinstance(cached_path, str) and cached_path:
                cached_file = Path(cached_path)
                if cached_file.exists() and cached_file.is_file():
                    return cached_file
            next_retry_at = self._parse_iso_utc(metadata.get("next_retry_at"))
            if next_retry_at is not None and next_retry_at > now:
                return None

        try:
            response = httpx.get(url, timeout=15.0, follow_redirects=True)
            response.raise_for_status()
            content = response.content
            if len(content) > config.index.max_file_size:
                self._save_remote_meta(
                    meta_path,
                    {
                        "url": url,
                        "status": "failed",
                        "last_error": "file too large",
                        "fail_count": 1,
                        "next_retry_at": (
                            now + timedelta(seconds=30)
                        ).isoformat(),
                        "updated_at": now.isoformat(),
                    },
                )
                return None

            content_hash = hashlib.sha1(content).hexdigest()
            blob_dir = self.remote_blob_dir / content_hash
            blob_dir.mkdir(parents=True, exist_ok=True)
            safe_name = self._safe_name(Path(filename).name)
            blob_path = blob_dir / safe_name
            if not blob_path.exists():
                blob_path.write_bytes(content)

            self._save_remote_meta(
                meta_path,
                {
                    "url": url,
                    "status": "ok",
                    "content_hash": content_hash,
                    "file_path": str(blob_path),
                    "file_name": safe_name,
                    "fail_count": 0,
                    "next_retry_at": None,
                    "updated_at": now.isoformat(),
                },
            )
            return blob_path
        except Exception as exc:
            fail_count = int(metadata.get("fail_count", 0)) + 1
            backoff_seconds = min(300, 5 * (2 ** (fail_count - 1)))
            self._save_remote_meta(
                meta_path,
                {
                    "url": url,
                    "status": "failed",
                    "last_error": str(exc),
                    "fail_count": fail_count,
                    "next_retry_at": (
                        now + timedelta(seconds=backoff_seconds)
                    ).isoformat(),
                    "updated_at": now.isoformat(),
                },
            )
            return None

    @staticmethod
    def _save_remote_meta(path: Path, payload: dict[str, Any]) -> None:
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @staticmethod
    def _parse_iso_utc(value: Any) -> datetime | None:
        if not isinstance(value, str) or not value:
            return None
        text = value.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)

    def _history_backfill_signature(self, running_config: Any | None) -> str:
        payload = {
            "auto_collect_chat_files": bool(
                getattr(running_config, "auto_collect_chat_files", False),
            ),
            "auto_collect_chat_urls": bool(
                getattr(running_config, "auto_collect_chat_urls", True),
            ),
            "auto_collect_long_text": bool(
                getattr(running_config, "auto_collect_long_text", False),
            ),
            "long_text_min_chars": int(
                getattr(running_config, "long_text_min_chars", 2000),
            ),
            "knowledge_chunk_size": int(
                getattr(running_config, "knowledge_chunk_size", 1200),
            ),
            "version": 2,
        }
        return hashlib.sha1(
            json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8"),
        ).hexdigest()

    @staticmethod
    def _resolve_chunk_size(
        config: KnowledgeConfig,
        running_config: Any | None,
    ) -> int:
        chunk_size = getattr(running_config, "knowledge_chunk_size", None)
        if isinstance(chunk_size, int):
            return chunk_size
        return config.index.chunk_size

    def history_backfill_status(self) -> dict[str, Any]:
        """Return whether historical chat data still needs knowledge backfill."""
        state = self._load_backfill_state()
        has_backfill_record = bool(state)
        backfill_completed = bool(state.get("completed"))

        chats_path = self.working_dir / CHATS_FILE
        history_chat_count = 0
        if chats_path.exists():
            try:
                payload = self._load_json(chats_path)
                chats = payload.get("chats", [])
                history_chat_count = sum(
                    1
                    for chat in chats
                    if str(chat.get("session_id", "") or "").strip()
                )
            except Exception:
                history_chat_count = 0

        marked_unbackfilled = not backfill_completed
        has_pending_history = marked_unbackfilled and history_chat_count > 0
        return {
            "has_backfill_record": has_backfill_record,
            "backfill_completed": backfill_completed,
            "marked_unbackfilled": marked_unbackfilled,
            "history_chat_count": history_chat_count,
            "has_pending_history": has_pending_history,
        }

    def _load_backfill_state(self) -> dict[str, Any]:
        if not self.backfill_state_path.exists():
            return {}
        try:
            return self._load_json(self.backfill_state_path)
        except Exception:
            return {}

    def _save_backfill_state(self, payload: dict[str, Any]) -> None:
        self.backfill_state_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _remote_source_status(self, source: KnowledgeSourceSpec) -> dict[str, Any]:
        remote_hash = ""
        for tag in source.tags or []:
            if tag.startswith("remote:url_hash:"):
                remote_hash = tag.split(":", 2)[-1]
                break
        if not remote_hash:
            return {}

        meta_path = self.remote_meta_dir / f"{remote_hash}.json"
        if not meta_path.exists():
            return {
                "remote_status": "unknown",
                "remote_cache_state": "missing",
                "remote_fail_count": 0,
                "remote_next_retry_at": None,
                "remote_last_error": None,
                "remote_updated_at": None,
            }

        payload = self._load_json(meta_path)
        remote_status = payload.get("status", "unknown")
        fail_count = int(payload.get("fail_count", 0) or 0)
        next_retry_at = payload.get("next_retry_at")
        next_retry_dt = self._parse_iso_utc(next_retry_at)
        now = datetime.now(UTC)

        if remote_status == "ok":
            if source.location and Path(source.location).exists():
                cache_state = "cached"
            else:
                cache_state = "missing"
        elif remote_status == "failed":
            if next_retry_dt is not None and next_retry_dt > now:
                cache_state = "waiting_retry"
            else:
                cache_state = "ready_retry"
        else:
            cache_state = "unknown"

        return {
            "remote_status": remote_status,
            "remote_cache_state": cache_state,
            "remote_fail_count": fail_count,
            "remote_next_retry_at": next_retry_at,
            "remote_last_error": payload.get("last_error"),
            "remote_updated_at": payload.get("updated_at"),
        }

    def _upsert_source(
        self,
        config: KnowledgeConfig,
        source: KnowledgeSourceSpec,
    ) -> bool:
        normalized = self._source_with_auto_name(source)
        for index, existing in enumerate(config.sources):
            if existing.id != normalized.id:
                continue
            existing_normalized = self._source_with_auto_name(existing)
            if existing_normalized.model_dump(mode="json") == normalized.model_dump(mode="json"):
                return False
            config.sources[index] = normalized
            return True
        config.sources.append(normalized)
        return True

    def _source_with_auto_name(self, source: KnowledgeSourceSpec) -> KnowledgeSourceSpec:
        generated = self._generate_source_name(source)
        if source.name == generated:
            return source
        return source.model_copy(update={"name": generated})

    def _build_llm_title_context(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig,
    ) -> str:
        segments: list[str] = []
        if source.content:
            segments.append(f"content:\n{source.content[:2400]}")
            return "\n\n".join(segments)

        indexed_payload = self._load_index_payload_safe(source.id)
        if indexed_payload:
            first_chunk = next(
                (chunk for chunk in indexed_payload.get("chunks", []) if chunk.get("text")),
                None,
            )
            if isinstance(first_chunk, dict):
                if isinstance(first_chunk.get("text"), str):
                    segments.append(f"document_text:\n{first_chunk['text'][:2400]}")

        if source.type in {"file", "directory", "url", "chat"}:
            try:
                docs = self._load_documents(source, config)
                if docs:
                    doc = docs[0]
                    text = doc.get("text", "")
                    if text:
                        segments.append(f"document_text:\n{text[:2400]}")
            except Exception:
                pass

        return "\n\n".join(seg for seg in segments if seg)

    @staticmethod
    def _is_auto_collected_source(source: KnowledgeSourceSpec) -> bool:
        """Return True if the source was created by auto-collection (not manually added)."""
        return "origin:auto" in (source.tags or [])

    def _is_source_content_empty_for_llm_title(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig,
        *,
        min_content_chars: int = 10,
    ) -> bool:
        context = self._build_llm_title_context(source, config)
        if not context:
            return True
        return not self._context_has_sufficient_content(context, min_content_chars)

    @staticmethod
    def _extract_text_from_model_response(response: Any) -> str:
        if hasattr(response, "text") and isinstance(response.text, str):
            return response.text
        if isinstance(response, str):
            return response
        content = getattr(response, "content", None)
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    return item["text"]
        return ""

    @staticmethod
    def _sanitize_llm_title(text: str, max_len: int = 120) -> str:
        line = (text or "").strip().splitlines()[0] if text else ""
        line = re.sub(r"^['\"“”‘’\s-]+|['\"“”‘’\s-]+$", "", line).strip()
        line = re.sub(r"\s+", " ", line)
        if not line:
            return ""
        if len(line) <= max_len:
            return line
        return line[: max_len - 3].rstrip() + "..."

    def _load_title_maintenance_state(self) -> dict[str, Any]:
        if not self.title_maintenance_state_path.exists():
            return {}
        try:
            return self._load_json(self.title_maintenance_state_path)
        except Exception:
            return {}

    def _save_title_maintenance_state(self, payload: dict[str, Any]) -> None:
        self.title_maintenance_state_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _load_title_regen_queue_state(self) -> dict[str, Any]:
        if not self.title_regen_queue_state_path.exists():
            return {"jobs": []}
        try:
            payload = self._load_json(self.title_regen_queue_state_path)
            if not isinstance(payload, dict):
                return {"jobs": []}
            jobs = payload.get("jobs")
            if not isinstance(jobs, list):
                payload["jobs"] = []
            return payload
        except Exception:
            return {"jobs": []}

    def _save_title_regen_queue_state(self, payload: dict[str, Any]) -> None:
        self.title_regen_queue_state_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _generate_source_name(self, source: KnowledgeSourceSpec) -> str:
        semantic = self._semantic_title_for_source(source)
        if semantic:
            return self._truncate_title(semantic)

        if source.type == "url":
            url = (source.location or "").strip()
            if url:
                parsed = urlparse(url)
                host = parsed.netloc or url
                path = parsed.path.strip("/")
                tail = path.split("/")[-1] if path else ""
                if tail:
                    return self._truncate_title(f"{host}/{tail}")
                return self._truncate_title(host)

        if source.type in {"file", "directory"} and source.location:
            location = (source.location or "").strip()
            if location:
                return self._truncate_title(Path(location).name or location)

        return self._truncate_title(source.id)

    def _semantic_title_for_source(self, source: KnowledgeSourceSpec) -> str:
        candidates: list[str] = []

        if source.content:
            candidates.append(source.content)
        if source.description:
            candidates.append(source.description)

        indexed_payload = self._load_index_payload_safe(source.id)
        if indexed_payload:
            first_chunk = next(
                (chunk for chunk in indexed_payload.get("chunks", []) if chunk.get("text")),
                None,
            )
            if isinstance(first_chunk, dict):
                chunk_title = first_chunk.get("document_title")
                if isinstance(chunk_title, str) and chunk_title.strip():
                    candidates.append(chunk_title)
                chunk_text = first_chunk.get("text")
                if isinstance(chunk_text, str) and chunk_text.strip():
                    candidates.append(chunk_text)

        location = (source.location or "").strip()
        if source.type == "file" and location:
            snippet = self._read_local_text_snippet(Path(location), max_chars=2400)
            if snippet:
                candidates.append(snippet)
        if source.type == "directory" and location:
            snippet = self._read_directory_text_snippet(Path(location), max_chars=2400)
            if snippet:
                candidates.append(snippet)

        for candidate in candidates:
            title = self._semantic_title_from_text(candidate)
            if title:
                return title
        return ""

    def _load_index_payload_safe(self, source_id: str) -> dict[str, Any] | None:
        index_path = self._index_path(source_id)
        if not index_path.exists():
            return None
        try:
            return self._load_json(index_path)
        except Exception:
            return None

    def _read_local_text_snippet(self, path: Path, max_chars: int = 2400) -> str:
        try:
            resolved = path.expanduser().resolve()
            if not resolved.exists() or not resolved.is_file():
                return ""
            raw = resolved.read_text(encoding="utf-8", errors="ignore")
            return self._normalize_text(raw[:max_chars])
        except Exception:
            return ""

    def _read_directory_text_snippet(self, directory: Path, max_chars: int = 2400) -> str:
        try:
            root = directory.expanduser().resolve()
            if not root.exists() or not root.is_dir():
                return ""
            for path in root.rglob("*"):
                if not path.is_file():
                    continue
                snippet = self._read_local_text_snippet(path, max_chars=max_chars)
                if snippet:
                    return snippet
        except Exception:
            return ""
        return ""

    def _semantic_title_from_text(self, text: str) -> str:
        normalized = self._normalize_text(text or "")
        if not normalized:
            return ""

        sentences = [
            s.strip(" \t-:：;；,.。!?！？")
            for s in _TITLE_SENTENCE_SPLIT_RE.split(normalized)
            if s.strip()
        ]
        if not sentences:
            return ""

        token_freq: dict[str, int] = {}
        sentence_tokens: list[list[str]] = []
        for sentence in sentences:
            tokens = [
                tok.lower()
                for tok in _TITLE_WORD_RE.findall(sentence)
                if tok.lower() not in _TITLE_STOP_WORDS
            ]
            sentence_tokens.append(tokens)
            for token in tokens:
                token_freq[token] = token_freq.get(token, 0) + 1

        best_sentence = ""
        best_score = -1.0
        for sentence, tokens in zip(sentences, sentence_tokens):
            if not tokens:
                score = 0.0
            else:
                unique_score = sum(token_freq.get(token, 0) for token in set(tokens))
                score = unique_score / (len(tokens) ** 0.5)
            if score > best_score:
                best_score = score
                best_sentence = sentence

        if not best_sentence:
            best_sentence = sentences[0]
        return self._normalize_text(best_sentence)

    @staticmethod
    def _truncate_title(value: str, max_len: int = 120) -> str:
        compact = re.sub(r"\s+", " ", (value or "").strip())
        if not compact:
            compact = "knowledge"
        if len(compact) <= max_len:
            return compact
        return compact[: max_len - 3].rstrip() + "..."

    @staticmethod
    def _chunk_documents(
        documents: list[dict[str, str]],
        chunk_size: int,
    ) -> list[dict[str, Any]]:
        chunks: list[dict[str, Any]] = []
        for document in documents:
            text = document["text"]
            if not text:
                continue
            for index, start in enumerate(range(0, len(text), chunk_size)):
                chunk_text = text[start : start + chunk_size]
                if not chunk_text.strip():
                    continue
                chunks.append(
                    {
                        "chunk_id": f"{document['path']}::{index}",
                        "document_path": document["path"],
                        "document_title": document["title"],
                        "text": chunk_text,
                    },
                )
        return chunks

    @staticmethod
    def _score_chunk(text: str, terms: list[str]) -> int:
        lowered = text.lower()
        score = 0
        phrase = " ".join(terms)
        if phrase and phrase in lowered:
            score += len(terms) + 2
        for term in terms:
            score += lowered.count(term)
        return score

    @staticmethod
    def _build_snippet(text: str, terms: list[str], length: int = 240) -> str:
        lowered = text.lower()
        position = 0
        for term in terms:
            found = lowered.find(term)
            if found >= 0:
                position = found
                break
        start = max(position - 60, 0)
        end = min(start + length, len(text))
        return text[start:end].strip()

    @staticmethod
    def _is_allowed_path(relative_path: str, config: KnowledgeConfig) -> bool:
        normalized = relative_path.strip("/")
        if any(
            fnmatch.fnmatch(normalized, pattern)
            for pattern in config.index.exclude_globs
        ):
            return False
        if not config.index.include_globs:
            return True
        return any(
            fnmatch.fnmatch(normalized, pattern)
            or fnmatch.fnmatch(f"./{normalized}", pattern)
            for pattern in config.index.include_globs
        )

    @staticmethod
    def _safe_name(value: str) -> str:
        safe = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-.")
        return safe or "knowledge"

    @staticmethod
    def _session_filename(session_id: str, user_id: str) -> str:
        safe_sid = _sanitize_filename(session_id)
        safe_uid = _sanitize_filename(user_id) if user_id else ""
        if safe_uid:
            return f"{safe_uid}_{safe_sid}.json"
        return f"{safe_sid}.json"