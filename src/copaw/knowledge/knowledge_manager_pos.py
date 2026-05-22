# -*- coding: utf-8 -*-

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
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


def _load_json_payload(path: Path) -> dict[str, Any] | None:
    if not path.exists() or not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def _token_texts_from_line(line_entry: dict[str, Any]) -> list[str]:
    tokens = line_entry.get("tokens")
    if not isinstance(tokens, list):
        return []
    token_texts: list[str] = []
    for token in tokens:
        if not isinstance(token, dict):
            continue
        text = str(token.get("text") or "").strip()
        if text:
            token_texts.append(text)
    return token_texts


def _render_pos_text(
    manager: Any,
    chunk: dict[str, Any],
    structured_payload: dict[str, Any],
) -> str:
    lines = [
        f"document_path={chunk.get('document_path') or ''}",
        f"chunk_id={chunk.get('chunk_id') or ''}",
        f"version_id={manager._chunk_version_id(chunk)}",
        f"line_count={structured_payload.get('line_count') or 0}",
        f"token_count={structured_payload.get('token_count') or 0}",
        f"pos_count={structured_payload.get('pos_count') or 0}",
        f"pos_tag_type_count={structured_payload.get('pos_tag_type_count') or 0}",
    ]
    for line in structured_payload.get("lines") or []:
        if not isinstance(line, dict):
            continue
        line_text = str(line.get("text") or "")
        line_tokens = line.get("tokens") or []
        token_labels = []
        for token in line_tokens:
            if not isinstance(token, dict):
                continue
            token_text = str(token.get("text") or "")
            pos_tag = str(token.get("pos") or "")
            token_labels.append(f"{token_text}/{pos_tag}" if pos_tag else token_text)
        lines.append("")
        lines.append(f"[Line {line.get('line_index')}] {line_text}")
        lines.append(f"tokens={' | '.join(token_labels)}")
    return "\n".join(lines)


def write_chunk_pos_artifacts(
    manager: Any,
    source: KnowledgeSourceSpec,
    payload: dict[str, Any],
    *,
    config: KnowledgeConfig | None,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
    progress_start: int = 53,
    progress_end: int = 60,
) -> set[str]:
    previous_manifest_paths = manager._load_source_pos_manifest(source.id)
    current_pos_paths: set[str] = set()
    raw_chunks = payload.get("chunks") or []
    chunks = [item for item in raw_chunks if isinstance(item, dict)] if isinstance(raw_chunks, list) else []
    chunk_groups = manager._group_chunks_for_ner(chunks)
    total_documents = len(chunk_groups)
    pos_ready_so_far = 0
    pos_line_so_far = 0
    pos_token_so_far = 0
    pos_count_so_far = 0
    pos_tag_types_so_far: set[str] = set()
    pos_format_version = getattr(manager, "_POS_FORMAT_VERSION", "0.1")

    for index, group in enumerate(chunk_groups, start=1):
        representative = group[0]

        if all(manager._chunk_stage_ready_for_resume(chunk, stage="pos") for chunk in group):
            for chunk in group:
                current_pos_paths.update(manager._chunk_stage_paths(chunk, stage="pos"))
            pos_ready_so_far += 1
            pos_line_so_far += max(
                max(0, _safe_count_int(chunk.get("pos_line_count") or 0))
                for chunk in group
            )
            pos_token_so_far += max(
                max(0, _safe_count_int(chunk.get("pos_token_count") or 0))
                for chunk in group
            )
            pos_count_so_far += max(
                max(0, _safe_count_int(chunk.get("pos_count") or 0))
                for chunk in group
            )
            for chunk in group:
                raw_pos_tag_types = chunk.get("pos_tag_types") or chunk.get("syntax_pos_tag_types")
                if not isinstance(raw_pos_tag_types, list):
                    continue
                for item in raw_pos_tag_types:
                    tag = str(item or "").strip()
                    if tag:
                        pos_tag_types_so_far.add(tag)
            if progress_callback is not None:
                progress_callback(
                    {
                        "stage": "pos",
                        "done_chunks": index,
                        "total_chunks": total_documents,
                        "metrics": {
                            "pos_ready_chunk_count": pos_ready_so_far,
                            "pos_line_count": pos_line_so_far,
                            "pos_token_count": pos_token_so_far,
                            "pos_count": pos_count_so_far,
                            "pos_tag_type_count": len(pos_tag_types_so_far),
                            "syntax_pos_count": pos_count_so_far,
                            "syntax_pos_tag_type_count": len(pos_tag_types_so_far),
                        },
                    }
                )
            continue

        for chunk in group:
            chunk["pos_status"] = "unavailable"
            chunk["pos_format_version"] = pos_format_version
            chunk["pos_line_count"] = 0
            chunk["pos_token_count"] = 0
            chunk["pos_count"] = 0
            chunk["pos_tag_type_count"] = 0
            chunk["pos_tag_types"] = []
            chunk["syntax_pos_count"] = 0
            chunk["syntax_pos_tag_type_count"] = 0
            chunk["syntax_pos_tag_types"] = []
            chunk.pop("pos_path", None)
            chunk.pop("pos_structured_path", None)
            chunk.pop("pos_line_stats_path", None)

        tokenize_relative_path = str(representative.get("tokenize_structured_path") or "").strip()
        tokenize_payload = _load_json_payload(manager.root_dir / tokenize_relative_path) if tokenize_relative_path else None
        line_entries = tokenize_payload.get("lines") if isinstance(tokenize_payload, dict) else []
        if not isinstance(line_entries, list) or not line_entries:
            if progress_callback is not None:
                progress_callback(
                    {
                        "stage": "pos",
                        "done_chunks": index,
                        "total_chunks": total_documents,
                        "metrics": {
                            "pos_ready_chunk_count": pos_ready_so_far,
                            "pos_line_count": pos_line_so_far,
                            "pos_token_count": pos_token_so_far,
                            "pos_count": pos_count_so_far,
                            "pos_tag_type_count": len(pos_tag_types_so_far),
                            "syntax_pos_count": pos_count_so_far,
                            "syntax_pos_tag_type_count": len(pos_tag_types_so_far),
                        },
                    }
                )
            continue

        line_rows: list[dict[str, Any]] = []
        pending_batches: list[dict[str, Any]] = []
        for fallback_index, line_entry in enumerate(line_entries, start=1):
            if not isinstance(line_entry, dict):
                continue
            line_index = _safe_count_int(line_entry.get("line_index") or fallback_index) or fallback_index
            text = str(line_entry.get("text") or "")
            token_rows = [dict(token) for token in (line_entry.get("tokens") or []) if isinstance(token, dict)]
            line_row = {
                "line_index": line_index,
                "text": text,
                "token_count": len(token_rows),
                "pos_count": 0,
                "tokens": token_rows,
                "pos_tags": [],
            }
            line_rows.append(line_row)
            token_texts = _token_texts_from_line(line_entry)
            if token_texts:
                pending_batches.append({"line_row": line_row, "token_texts": token_texts, "token_rows": token_rows})

        status = "ready" if config is not None else "unavailable"
        reason_code = "HANLP_POS_READY" if config is not None else "NLP_ENGINE_UNAVAILABLE"
        reason = "HanLP POS tagging completed successfully." if config is not None else "NLP semantic engine is not configured."

        if config is not None and pending_batches:
            batch_size = 5
            for batch_start in range(0, len(pending_batches), batch_size):
                batch_items = pending_batches[batch_start:batch_start + batch_size]
                batch_tokens = [list(item["token_texts"]) for item in batch_items]
                raw_items, state = manager._semantic_runtime.run_task_tokenized_batch("pos_ctb", batch_tokens, config)
                manager._remember_semantic_engine_state(state)
                batch_ready = str(state.get("status") or "").strip().lower() == "ready"
                if not batch_ready:
                    status = str(state.get("status") or "degraded")
                    reason_code = str(state.get("reason_code") or "HANLP_POS_FAILED")
                    reason = str(state.get("reason") or "HanLP POS tagging failed.")
                raw_items_list = raw_items if isinstance(raw_items, list) else []
                for item_index, item in enumerate(batch_items):
                    line_row = item["line_row"]
                    token_rows = item["token_rows"]
                    raw_item = raw_items_list[item_index] if item_index < len(raw_items_list) else []
                    pos_rows = manager._normalize_hanlp_pos_tags(raw_item, tokens=token_rows) if batch_ready else []
                    pos_lookup = {
                        int(row.get("token_index") or 0): str(row.get("pos") or "")
                        for row in pos_rows
                        if isinstance(row, dict)
                    }
                    tagged_tokens: list[dict[str, Any]] = []
                    for token in token_rows:
                        token_index = _safe_count_int(token.get("token_index") or 0)
                        token_text = str(token.get("text") or "")
                        pos_tag = pos_lookup.get(token_index, "")
                        tagged_token = dict(token)
                        tagged_token["pos"] = pos_tag
                        tagged_tokens.append(tagged_token)
                        if pos_tag:
                            pos_tag_types_so_far.add(pos_tag)
                    line_row["tokens"] = tagged_tokens
                    line_row["pos_tags"] = pos_rows
                    line_row["pos_count"] = len([row for row in pos_rows if str(row.get("pos") or "").strip()])

        pos_line_count = len(line_rows)
        pos_token_count = sum(_safe_count_int(line.get("token_count") or 0) for line in line_rows)
        pos_count = sum(_safe_count_int(line.get("pos_count") or 0) for line in line_rows)
        pos_tag_types = sorted(pos_tag_types_so_far)
        pos_tag_type_count = len(pos_tag_types)

        pos_relative_path = manager._build_pos_relative_path(str(representative.get("chunk_path") or ""))
        pos_structured_relative_path = manager._build_pos_structured_relative_path(str(representative.get("chunk_path") or ""))
        pos_line_stats_relative_path = manager._build_pos_line_stats_relative_path(str(representative.get("chunk_path") or ""))

        pos_file_path = manager.root_dir / pos_relative_path
        pos_structured_file_path = manager.root_dir / pos_structured_relative_path
        pos_line_stats_file_path = manager.root_dir / pos_line_stats_relative_path
        pos_file_path.parent.mkdir(parents=True, exist_ok=True)
        pos_file_path.write_text(
            _render_pos_text(
                manager,
                representative,
                {
                    "artifact": "pos_structured",
                    "format_version": pos_format_version,
                    "document_path": str(representative.get("document_path") or ""),
                    "document_title": str(representative.get("document_title") or ""),
                    "chunk_id": str(representative.get("chunk_id") or ""),
                    "chunk_path": str(representative.get("chunk_path") or ""),
                    "version_id": manager._chunk_version_id(representative),
                    "snapshot_at": str(representative.get("snapshot_at") or ""),
                    "source_text": str(tokenize_payload.get("source_text") or "") if isinstance(tokenize_payload, dict) else "",
                    "input_text": str(tokenize_payload.get("input_text") or "") if isinstance(tokenize_payload, dict) else "",
                    "tokenize_structured_path": tokenize_relative_path,
                    "pos_input_mode": "tokenized_only",
                    "line_count": pos_line_count,
                    "token_count": pos_token_count,
                    "pos_count": pos_count,
                    "pos_tag_type_count": pos_tag_type_count,
                    "pos_tag_types": pos_tag_types,
                    "lines": line_rows,
                },
            ),
            encoding="utf-8",
        )
        pos_structured_file_path.parent.mkdir(parents=True, exist_ok=True)
        pos_structured_file_path.write_text(
            json.dumps(
                {
                    "artifact": "pos_structured",
                    "format_version": pos_format_version,
                    "document_path": str(representative.get("document_path") or ""),
                    "document_title": str(representative.get("document_title") or ""),
                    "chunk_id": str(representative.get("chunk_id") or ""),
                    "chunk_path": str(representative.get("chunk_path") or ""),
                    "version_id": manager._chunk_version_id(representative),
                    "snapshot_at": str(representative.get("snapshot_at") or ""),
                    "source_text": str(tokenize_payload.get("source_text") or "") if isinstance(tokenize_payload, dict) else "",
                    "input_text": str(tokenize_payload.get("input_text") or "") if isinstance(tokenize_payload, dict) else "",
                    "tokenize_structured_path": tokenize_relative_path,
                    "pos_input_mode": "tokenized_only",
                    "line_count": pos_line_count,
                    "token_count": pos_token_count,
                    "pos_count": pos_count,
                    "pos_tag_type_count": pos_tag_type_count,
                    "pos_tag_types": pos_tag_types,
                    "lines": line_rows,
                    "status": status,
                    "reason_code": reason_code,
                    "reason": reason,
                    "updated_at": datetime.now(UTC).isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        pos_line_stats_file_path.parent.mkdir(parents=True, exist_ok=True)
        pos_line_stats_file_path.write_text(
            json.dumps(
                {
                    "artifact": "pos_line_stats",
                    "format_version": pos_format_version,
                    "document_path": str(representative.get("document_path") or ""),
                    "chunk_id": str(representative.get("chunk_id") or ""),
                    "chunk_path": str(representative.get("chunk_path") or ""),
                    "version_id": manager._chunk_version_id(representative),
                    "line_count": pos_line_count,
                    "token_count_total": pos_token_count,
                    "pos_count_total": pos_count,
                    "line_token_counts": [
                        {
                            "line_index": int(item.get("line_index") or 0),
                            "token_count": int(item.get("token_count") or 0),
                            "pos_count": int(item.get("pos_count") or 0),
                        }
                        for item in line_rows
                        if isinstance(item, dict)
                    ],
                    "updated_at": datetime.now(UTC).isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        for chunk in group:
            chunk["pos_status"] = status
            chunk["pos_format_version"] = pos_format_version
            chunk["pos_input_mode"] = "tokenized_only"
            chunk["pos_line_count"] = pos_line_count
            chunk["pos_token_count"] = pos_token_count
            chunk["pos_count"] = pos_count
            chunk["pos_tag_type_count"] = pos_tag_type_count
            chunk["pos_tag_types"] = pos_tag_types
            chunk["pos_path"] = pos_relative_path.as_posix()
            chunk["pos_structured_path"] = pos_structured_relative_path.as_posix()
            chunk["pos_line_stats_path"] = pos_line_stats_relative_path.as_posix()
            chunk["syntax_pos_count"] = pos_count
            chunk["syntax_pos_tag_type_count"] = pos_tag_type_count
            chunk["syntax_pos_tag_types"] = pos_tag_types

        current_pos_paths.add(pos_relative_path.as_posix())
        current_pos_paths.add(pos_structured_relative_path.as_posix())
        current_pos_paths.add(pos_line_stats_relative_path.as_posix())
        if status == "ready":
            pos_ready_so_far += 1
        pos_line_so_far += pos_line_count
        pos_token_so_far += pos_token_count
        pos_count_so_far += pos_count
        manager._write_source_pos_manifest(source.id, current_pos_paths)
        manager._write_l2_checkpoint(
            source.id,
            payload,
            stage="pos",
            done_chunks=index,
            total_chunks=total_documents,
            metrics={
                "pos_ready_chunk_count": pos_ready_so_far,
                "pos_line_count": pos_line_so_far,
                "pos_token_count": pos_token_so_far,
                "pos_count": pos_count_so_far,
                "pos_tag_type_count": len(pos_tag_types_so_far),
                "syntax_pos_count": pos_count_so_far,
                "syntax_pos_tag_type_count": len(pos_tag_types_so_far),
            },
        )
        if progress_callback is not None:
            progress_callback(
                {
                    "stage": "pos",
                    "done_chunks": index,
                    "total_chunks": total_documents,
                    "metrics": {
                        "pos_ready_chunk_count": pos_ready_so_far,
                        "pos_line_count": pos_line_count,
                        "pos_token_count": pos_token_so_far,
                        "pos_count": pos_count_so_far,
                        "pos_tag_type_count": len(pos_tag_types_so_far),
                        "syntax_pos_count": pos_count_so_far,
                        "syntax_pos_tag_type_count": len(pos_tag_types_so_far),
                    },
                }
            )

    stale_pos_paths = previous_manifest_paths - current_pos_paths
    for pos_path in stale_pos_paths:
        manager._delete_pos_path(pos_path)
    manager._write_source_pos_manifest(source.id, current_pos_paths)
    return current_pos_paths
