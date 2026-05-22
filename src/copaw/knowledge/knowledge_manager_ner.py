# -*- coding: utf-8 -*-

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Callable

from ..config.config import KnowledgeConfig, KnowledgeSourceSpec

UTC = timezone.utc


def _safe_count_int(value: Any) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (list, tuple, set)):
        return len(value)
    if isinstance(value, dict):
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def write_chunk_ner_artifacts(
    manager: Any,
    source: KnowledgeSourceSpec,
    payload: dict[str, Any],
    *,
    config: KnowledgeConfig | None,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
    progress_start: int = 55,
    progress_end: int = 63,
) -> set[str]:
    previous_manifest_paths = manager._load_source_ner_manifest(source.id)
    current_ner_paths: set[str] = set()
    map_rows = manager._load_source_interlinear_lightweight_map_rows(source.id)
    semantic_state = manager.get_semantic_engine_state(config) if config is not None else manager._semantic_engine_state(
        status="unavailable",
        reason_code="NLP_ENGINE_UNAVAILABLE",
        reason="NLP semantic engine is not configured.",
    )

    raw_chunks = payload.get("chunks") or []
    chunks = [item for item in raw_chunks if isinstance(item, dict)] if isinstance(raw_chunks, list) else []
    chunk_groups = manager._group_chunks_for_ner(chunks)
    total_documents = len(chunk_groups)
    ner_ready_so_far = 0
    ner_entity_so_far = 0
    ner_format_version = getattr(manager, "_NER_FORMAT_VERSION", "1.1")

    for index, group in enumerate(chunk_groups, start=1):
        representative = group[0]

        if all(manager._chunk_stage_ready_for_resume(chunk, stage="ner") for chunk in group):
            for chunk in group:
                current_ner_paths.update(manager._chunk_stage_paths(chunk, stage="ner"))
            ner_ready_so_far += 1
            ner_entity_so_far += max(
                max(0, _safe_count_int(chunk.get("ner_entity_count") or 0))
                for chunk in group
            )
            if progress_callback is not None:
                progress_callback(
                    {
                        "stage": "ner",
                        "done_chunks": index,
                        "total_chunks": total_documents,
                        "metrics": {
                            "ner_ready_chunk_count": ner_ready_so_far,
                            "ner_entity_count": ner_entity_so_far,
                        },
                    }
                )
            continue

        for chunk in group:
            chunk["file_key"] = manager._chunk_file_key(chunk)
            chunk["version_id"] = manager._chunk_version_id(chunk)
            chunk["ner_status"] = "unavailable"
            chunk["ner_entity_count"] = 0
            chunk["ner_format_version"] = ner_format_version
            chunk["ner_reason_code"] = str(semantic_state.get("reason_code") or "")
            chunk["ner_reason"] = str(semantic_state.get("reason") or "")
            chunk.pop("ner_path", None)
            chunk.pop("ner_structured_path", None)
            chunk.pop("ner_annotated_path", None)
            chunk.pop("ner_stats_path", None)

        resolved_text, source_text, interlinear_path, ner_input_mode = manager._resolve_document_ner_input_text(
            group,
            map_rows=map_rows,
            source=source,
            allow_fallback=source.type in {"text", "chat"},
            chunks_only=manager._source_requires_chunks_only(source),
        )
        if ner_input_mode in {"interlinear_required", "chunks_required"} or not str(resolved_text or "").strip():
            for chunk in group:
                chunk["ner_status"] = "unavailable"
                chunk["ner_entity_count"] = 0
                chunk["ner_input_mode"] = ner_input_mode
                if ner_input_mode == "chunks_required":
                    chunk["ner_reason_code"] = "CHUNKS_REQUIRED"
                    chunk["ner_reason"] = "NER requires chunk text input and fallback is disabled."
                else:
                    chunk["ner_reason_code"] = "INTERLINEAR_REQUIRED"
                    chunk["ner_reason"] = "NER requires interlinear input and fallback is disabled."
            if progress_callback is not None:
                progress_callback(
                    {
                        "stage": "ner",
                        "done_chunks": index,
                        "total_chunks": total_documents,
                        "metrics": {
                            "ner_ready_chunk_count": ner_ready_so_far,
                            "ner_entity_count": ner_entity_so_far,
                        },
                    }
                )
            continue
        cor_structured_path = ""
        cor_resolution_mode = "identity_fallback"
        ner_execution_started_at = datetime.now(UTC)
        ner_batch_size = manager._resolve_ner_batch_size(config)
        mentions, ner_runtime_stats = (
            manager._collect_document_ner_mentions_batched(
                resolved_text,
                config=config,
                batch_size=ner_batch_size,
            )
            if config is not None
            else (
                [],
                {
                    "batch_count": 0,
                    "worker_restart_count": 0,
                    "worker_pids": [],
                    "status": "unavailable",
                    "reason_code": "NLP_ENGINE_UNAVAILABLE",
                    "reason": "NLP semantic engine is not configured.",
                },
            )
        )
        ner_runtime_status = str(ner_runtime_stats.get("status") or "ready").strip().lower()
        if ner_runtime_status != "ready":
            reason_code = str(ner_runtime_stats.get("reason_code") or "NLP_ENGINE_UNAVAILABLE")
            reason = str(ner_runtime_stats.get("reason") or "NER runtime is unavailable.")
            for chunk in group:
                chunk["ner_status"] = "unavailable"
                chunk["ner_entity_count"] = 0
                chunk["ner_input_mode"] = ner_input_mode
                chunk["ner_batch_size"] = ner_batch_size
                chunk["ner_batch_count"] = int(ner_runtime_stats.get("batch_count") or 0)
                chunk["ner_worker_restart_count"] = int(ner_runtime_stats.get("worker_restart_count") or 0)
                chunk["ner_worker_pids"] = list(ner_runtime_stats.get("worker_pids") or [])
                chunk["ner_reason_code"] = reason_code
                chunk["ner_reason"] = reason
            if progress_callback is not None:
                progress_callback(
                    {
                        "stage": "ner",
                        "done_chunks": index,
                        "total_chunks": total_documents,
                        "metrics": {
                            "ner_ready_chunk_count": ner_ready_so_far,
                            "ner_entity_count": ner_entity_so_far,
                        },
                    }
                )
            continue
        catalog = manager._build_chunk_ner_catalog(mentions)
        ner_execution_finished_at = datetime.now(UTC)
        ner_execution_duration_ms = max(
            0,
            int((ner_execution_finished_at - ner_execution_started_at).total_seconds() * 1000),
        )
        ner_relative_path = manager._build_ner_relative_path(str(representative.get("chunk_path") or ""))
        ner_structured_relative_path = manager._build_ner_structured_relative_path(
            str(representative.get("chunk_path") or "")
        )
        ner_annotated_relative_path = manager._build_ner_annotated_relative_path(
            str(representative.get("chunk_path") or "")
        )
        ner_stats_relative_path = manager._build_ner_stats_relative_path(str(representative.get("chunk_path") or ""))
        ner_file_path = manager.root_dir / ner_relative_path
        ner_structured_file_path = manager.root_dir / ner_structured_relative_path
        ner_annotated_file_path = manager.root_dir / ner_annotated_relative_path
        ner_stats_file_path = manager.root_dir / ner_stats_relative_path
        ner_file_path.parent.mkdir(parents=True, exist_ok=True)
        ner_file_path.write_text(
            manager._render_chunk_ner_text(representative, text=resolved_text, catalog=catalog),
            encoding="utf-8",
        )
        ner_structured_file_path.parent.mkdir(parents=True, exist_ok=True)
        ner_structured_file_path.write_text(
            json.dumps(
                manager._render_chunk_ner_structured_payload(
                    representative,
                    source_text=source_text,
                    input_text=resolved_text,
                    interlinear_path=interlinear_path,
                    ner_input_mode=ner_input_mode,
                    cor_structured_path=cor_structured_path,
                    cor_resolution_mode=cor_resolution_mode,
                    catalog=catalog,
                    mentions=mentions,
                    execution_started_at=ner_execution_started_at.isoformat(),
                    execution_finished_at=ner_execution_finished_at.isoformat(),
                    execution_duration_ms=ner_execution_duration_ms,
                ),
                ensure_ascii=False,
                indent=2,
            ) + "\n",
            encoding="utf-8",
        )
        ner_annotated_file_path.parent.mkdir(parents=True, exist_ok=True)
        ner_annotated_file_path.write_text(
            manager._render_chunk_ner_annotated_markdown(
                representative,
                text=resolved_text,
                mentions=mentions,
                structured_relative_path=ner_structured_relative_path,
            ),
            encoding="utf-8",
        )
        ner_stats_file_path.parent.mkdir(parents=True, exist_ok=True)
        ner_stats_payload = {
            "artifact": "ner_stats",
            "format_version": ner_format_version,
            "document_path": str(representative.get("document_path") or ""),
            "version_id": manager._chunk_version_id(representative),
            "interlinear_path": interlinear_path,
            "ner_input_mode": ner_input_mode,
            "ner_batch_size": ner_batch_size,
            "ner_batch_count": int(ner_runtime_stats.get("batch_count") or 0),
            "ner_worker_restart_count": int(ner_runtime_stats.get("worker_restart_count") or 0),
            "ner_worker_pids": list(ner_runtime_stats.get("worker_pids") or []),
            "entity_count": len(catalog),
            "entity_mentions_count": len(mentions),
            "execution_started_at": ner_execution_started_at.isoformat(),
            "execution_finished_at": ner_execution_finished_at.isoformat(),
            "execution_duration_ms": ner_execution_duration_ms,
            "sentence_count": len([line for line in str(resolved_text or "").splitlines() if line.strip()]),
            "avg_entities_per_sentence": (
                float(len(catalog))
                / max(1, len([line for line in str(resolved_text or "").splitlines() if line.strip()]))
            ),
            "updated_at": datetime.now(UTC).isoformat(),
        }
        ner_stats_file_path.write_text(
            json.dumps(ner_stats_payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        for chunk in group:
            chunk["ner_status"] = "ready"
            chunk["ner_entity_count"] = len(catalog)
            chunk["ner_input_mode"] = ner_input_mode
            chunk["ner_batch_size"] = ner_batch_size
            chunk["ner_batch_count"] = int(ner_runtime_stats.get("batch_count") or 0)
            chunk["ner_worker_restart_count"] = int(ner_runtime_stats.get("worker_restart_count") or 0)
            chunk["ner_worker_pids"] = list(ner_runtime_stats.get("worker_pids") or [])
            chunk["ner_path"] = ner_relative_path.as_posix()
            chunk["ner_structured_path"] = ner_structured_relative_path.as_posix()
            chunk["ner_annotated_path"] = ner_annotated_relative_path.as_posix()
            chunk["ner_stats_path"] = ner_stats_relative_path.as_posix()

        current_ner_paths.add(ner_relative_path.as_posix())
        current_ner_paths.add(ner_structured_relative_path.as_posix())
        current_ner_paths.add(ner_annotated_relative_path.as_posix())
        current_ner_paths.add(ner_stats_relative_path.as_posix())
        ner_ready_so_far += 1
        ner_entity_so_far += len(catalog)
        manager._write_source_ner_manifest(source.id, current_ner_paths)
        manager._write_l2_checkpoint(
            source.id,
            payload,
            stage="ner",
            done_chunks=index,
            total_chunks=total_documents,
            metrics={
                "ner_ready_chunk_count": ner_ready_so_far,
                "ner_entity_count": ner_entity_so_far,
            },
        )
        if progress_callback is not None:
            progress_callback(
                {
                    "stage": "ner",
                    "done_chunks": index,
                    "total_chunks": total_documents,
                    "metrics": {
                        "ner_ready_chunk_count": ner_ready_so_far,
                        "ner_entity_count": ner_entity_so_far,
                    },
                }
            )

    stale_ner_paths = previous_manifest_paths - current_ner_paths
    for ner_path in stale_ner_paths:
        manager._delete_ner_path(ner_path)
    manager._write_source_ner_manifest(source.id, current_ner_paths)
    return current_ner_paths