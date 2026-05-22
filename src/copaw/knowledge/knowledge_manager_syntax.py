# -*- coding: utf-8 -*-

from __future__ import annotations

import json
from typing import Any, Callable

from ..config.config import KnowledgeConfig, KnowledgeSourceSpec


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


def write_chunk_syntax_artifacts(
    manager: Any,
    source: KnowledgeSourceSpec,
    payload: dict[str, Any],
    *,
    config: KnowledgeConfig | None = None,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
    progress_start: int = 64,
    progress_end: int = 70,
) -> set[str]:
    previous_manifest_paths = manager._load_source_syntax_manifest(source.id)
    current_syntax_paths: set[str] = set()
    map_rows = manager._load_source_interlinear_lightweight_map_rows(source.id)
    raw_chunks = payload.get("chunks") or []
    chunks = [item for item in raw_chunks if isinstance(item, dict)] if isinstance(raw_chunks, list) else []
    chunk_groups = manager._group_chunks_for_ner(chunks)
    total_documents = len(chunk_groups)
    syntax_ready_so_far = 0
    syntax_sentence_so_far = 0
    syntax_token_so_far = 0
    syntax_pos_so_far = 0
    syntax_pos_tag_types_so_far: set[str] = set()
    syntax_relation_so_far = 0
    syntax_format_version = getattr(manager, "_SYNTAX_FORMAT_VERSION", "0.2")

    for index, group in enumerate(chunk_groups, start=1):
        representative = group[0]

        if all(manager._chunk_stage_ready_for_resume(chunk, stage="syntax") for chunk in group):
            for chunk in group:
                current_syntax_paths.update(manager._chunk_stage_paths(chunk, stage="syntax"))
            syntax_ready_so_far += 1
            syntax_sentence_so_far += max(
                max(0, _safe_count_int(chunk.get("syntax_sentence_count") or 0))
                for chunk in group
            )
            syntax_token_so_far += max(
                max(0, _safe_count_int(chunk.get("syntax_token_count") or 0))
                for chunk in group
            )
            syntax_pos_so_far += max(
                max(0, _safe_count_int(chunk.get("syntax_pos_count") or 0))
                for chunk in group
            )
            for chunk in group:
                raw_pos_tag_types = chunk.get("syntax_pos_tag_types")
                if not isinstance(raw_pos_tag_types, list):
                    continue
                for item in raw_pos_tag_types:
                    tag = str(item or "").strip()
                    if tag:
                        syntax_pos_tag_types_so_far.add(tag)
            syntax_relation_so_far += max(
                max(0, _safe_count_int(chunk.get("syntax_relation_count") or 0))
                for chunk in group
            )
            if progress_callback is not None:
                progress_callback(
                    {
                        "stage": "syntax",
                        "done_chunks": index,
                        "total_chunks": total_documents,
                        "metrics": {
                            "syntax_ready_chunk_count": syntax_ready_so_far,
                            "syntax_sentence_count": syntax_sentence_so_far,
                            "syntax_token_count": syntax_token_so_far,
                            "syntax_pos_count": syntax_pos_so_far,
                            "syntax_pos_tag_type_count": len(syntax_pos_tag_types_so_far),
                            "syntax_relation_count": syntax_relation_so_far,
                        },
                    }
                )
            continue

        for chunk in group:
            chunk["syntax_status"] = "ready"
            chunk["syntax_format_version"] = syntax_format_version
            chunk.pop("syntax_path", None)
            chunk.pop("syntax_structured_path", None)
            chunk.pop("syntax_annotated_path", None)

        resolved_text, source_text, interlinear_path, syntax_input_mode = manager._resolve_document_ner_input_text(
            group,
            map_rows=map_rows,
            source=source,
            allow_fallback=source.type in {"text", "chat"},
            chunks_only=manager._source_requires_chunks_only(source),
        )
        if syntax_input_mode in {"interlinear_required", "chunks_required"} or not str(resolved_text or "").strip():
            for chunk in group:
                chunk["syntax_status"] = "unavailable"
                chunk["syntax_input_mode"] = syntax_input_mode
                chunk["syntax_interlinear_path"] = str(interlinear_path or "")
                chunk["syntax_sentence_count"] = 0
                chunk["syntax_token_count"] = 0
                existing_pos_count = _safe_count_int(chunk.get("syntax_pos_count") or chunk.get("pos_count") or 0)
                existing_pos_tag_types = [
                    str(item).strip()
                    for item in (chunk.get("syntax_pos_tag_types") or chunk.get("pos_tag_types") or [])
                    if str(item).strip()
                ]
                chunk["syntax_pos_count"] = existing_pos_count
                chunk["syntax_pos_tag_types"] = existing_pos_tag_types
                chunk["syntax_pos_tag_type_count"] = len(existing_pos_tag_types)
                chunk["syntax_relation_count"] = 0
            if progress_callback is not None:
                progress_callback(
                    {
                        "stage": "syntax",
                        "done_chunks": index,
                        "total_chunks": total_documents,
                        "metrics": {
                            "syntax_ready_chunk_count": syntax_ready_so_far,
                            "syntax_sentence_count": syntax_sentence_so_far,
                            "syntax_token_count": syntax_token_so_far,
                            "syntax_pos_count": syntax_pos_so_far,
                            "syntax_pos_tag_type_count": len(syntax_pos_tag_types_so_far),
                            "syntax_relation_count": syntax_relation_so_far,
                        },
                    }
                )
            continue
        cor_structured_path = ""
        cor_resolution_mode = "identity_fallback"
        mentions = manager._load_chunk_ner_mentions(representative)
        structured_payload = manager._render_chunk_syntax_structured_payload(
            representative,
            source_text=source_text,
            input_text=resolved_text,
            interlinear_path=interlinear_path,
            syntax_input_mode=syntax_input_mode,
            cor_structured_path=cor_structured_path,
            cor_resolution_mode=cor_resolution_mode,
            mentions=mentions,
            config=config,
        )

        syntax_sentence_count = _safe_count_int(structured_payload.get("sentence_count") or 0)
        syntax_token_count = _safe_count_int(structured_payload.get("token_count") or 0)
        syntax_pos_count = _safe_count_int(structured_payload.get("pos_count") or 0)
        syntax_pos_tag_type_count = _safe_count_int(structured_payload.get("pos_tag_type_count") or 0)
        syntax_pos_tag_types = [
            str(item).strip()
            for item in (structured_payload.get("pos_tag_types") or [])
            if str(item).strip()
        ]
        syntax_relation_count = _safe_count_int(structured_payload.get("relation_count") or 0)

        syntax_relative_path = manager._build_syntax_relative_path(str(representative.get("chunk_path") or ""))
        syntax_structured_relative_path = manager._build_syntax_structured_relative_path(
            str(representative.get("chunk_path") or "")
        )
        syntax_annotated_relative_path = manager._build_syntax_annotated_relative_path(
            str(representative.get("chunk_path") or "")
        )

        syntax_file_path = manager.root_dir / syntax_relative_path
        syntax_structured_file_path = manager.root_dir / syntax_structured_relative_path
        syntax_annotated_file_path = manager.root_dir / syntax_annotated_relative_path
        syntax_file_path.parent.mkdir(parents=True, exist_ok=True)
        syntax_file_path.write_text(
            manager._render_chunk_syntax_text(representative, structured_payload),
            encoding="utf-8",
        )
        syntax_structured_file_path.parent.mkdir(parents=True, exist_ok=True)
        syntax_structured_file_path.write_text(
            json.dumps(
                structured_payload,
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        syntax_annotated_file_path.parent.mkdir(parents=True, exist_ok=True)
        syntax_annotated_file_path.write_text(
            manager._render_chunk_syntax_annotated_markdown(representative, structured_payload),
            encoding="utf-8",
        )

        for chunk in group:
            chunk["syntax_input_mode"] = str(syntax_input_mode or "")
            chunk["syntax_interlinear_path"] = str(interlinear_path or "")
            chunk["syntax_sentence_count"] = syntax_sentence_count
            chunk["syntax_token_count"] = syntax_token_count
            chunk["syntax_pos_count"] = max(_safe_count_int(chunk.get("syntax_pos_count") or chunk.get("pos_count") or 0), syntax_pos_count)
            existing_pos_tag_types = [
                str(item).strip()
                for item in (chunk.get("syntax_pos_tag_types") or chunk.get("pos_tag_types") or [])
                if str(item).strip()
            ]
            merged_pos_tag_types = sorted({*existing_pos_tag_types, *syntax_pos_tag_types})
            chunk["syntax_pos_tag_types"] = merged_pos_tag_types
            chunk["syntax_pos_tag_type_count"] = max(len(existing_pos_tag_types), syntax_pos_tag_type_count, len(merged_pos_tag_types))
            chunk["syntax_relation_count"] = syntax_relation_count
            chunk["syntax_path"] = syntax_relative_path.as_posix()
            chunk["syntax_structured_path"] = syntax_structured_relative_path.as_posix()
            chunk["syntax_annotated_path"] = syntax_annotated_relative_path.as_posix()

        current_syntax_paths.add(syntax_relative_path.as_posix())
        current_syntax_paths.add(syntax_structured_relative_path.as_posix())
        current_syntax_paths.add(syntax_annotated_relative_path.as_posix())

        syntax_ready_so_far += 1
        syntax_sentence_so_far += syntax_sentence_count
        syntax_token_so_far += syntax_token_count
        syntax_pos_so_far += syntax_pos_count
        for tag in syntax_pos_tag_types:
            if tag:
                syntax_pos_tag_types_so_far.add(tag)
        syntax_relation_so_far += syntax_relation_count
        manager._write_source_syntax_manifest(source.id, current_syntax_paths)
        manager._write_l2_checkpoint(
            source.id,
            payload,
            stage="syntax",
            done_chunks=index,
            total_chunks=total_documents,
            metrics={
                "syntax_ready_chunk_count": syntax_ready_so_far,
                "syntax_sentence_count": syntax_sentence_so_far,
                "syntax_token_count": syntax_token_so_far,
                "syntax_pos_count": syntax_pos_so_far,
                "syntax_pos_tag_type_count": len(syntax_pos_tag_types_so_far),
                "syntax_relation_count": syntax_relation_so_far,
            },
        )

        if progress_callback is not None:
            progress_callback(
                {
                    "stage": "syntax",
                    "done_chunks": index,
                    "total_chunks": total_documents,
                    "metrics": {
                        "syntax_ready_chunk_count": syntax_ready_so_far,
                        "syntax_sentence_count": syntax_sentence_so_far,
                        "syntax_token_count": syntax_token_so_far,
                        "syntax_pos_count": syntax_pos_so_far,
                        "syntax_pos_tag_type_count": len(syntax_pos_tag_types_so_far),
                        "syntax_relation_count": syntax_relation_so_far,
                    },
                }
            )

    stale_syntax_paths = previous_manifest_paths - current_syntax_paths
    for syntax_path in stale_syntax_paths:
        manager._delete_syntax_path(syntax_path)
    manager._write_source_syntax_manifest(source.id, current_syntax_paths)
    return current_syntax_paths