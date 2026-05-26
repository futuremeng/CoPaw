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


def write_chunk_cor_artifacts(
    manager: Any,
    source: KnowledgeSourceSpec,
    payload: dict[str, Any],
    *,
    config: KnowledgeConfig | None,
    progress_callback: Callable[[dict[str, Any]], None] | None = None,
    progress_start: int = 45,
    progress_end: int = 54,
) -> set[str]:
    previous_manifest_paths = manager._load_source_cor_manifest(source.id)
    current_cor_paths: set[str] = set()
    map_rows = manager._load_source_interlinear_lightweight_map_rows(source.id)
    semantic_state = manager.get_semantic_engine_state(config) if config is not None else manager._semantic_engine_state(
        status="unavailable",
        reason_code="NLP_ENGINE_UNAVAILABLE",
        reason="NLP semantic engine is not configured.",
    )
    ready = semantic_state.get("status") == "ready"
    cor_format_version = getattr(manager, "_COR_FORMAT_VERSION", "0.1")

    raw_chunks = payload.get("chunks") or []
    chunks = [item for item in raw_chunks if isinstance(item, dict)] if isinstance(raw_chunks, list) else []
    chunk_groups = manager._group_chunks_for_ner(chunks)
    total_documents = len(chunk_groups)
    cor_ready_so_far = 0
    cor_cluster_so_far = 0
    cor_replacement_so_far = 0
    cor_effective_so_far = 0

    for index, group in enumerate(chunk_groups, start=1):
        representative = group[0]

        if all(manager._chunk_stage_ready_for_resume(chunk, stage="cor") for chunk in group):
            for chunk in group:
                current_cor_paths.update(manager._chunk_stage_paths(chunk, stage="cor"))
            cor_ready_so_far += 1
            cor_cluster_so_far += max(
                max(0, _safe_count_int(chunk.get("cor_cluster_count") or 0))
                for chunk in group
            )
            chunk_replacement_count = max(
                max(0, _safe_count_int(chunk.get("cor_replacement_count") or 0))
                for chunk in group
            )
            cor_replacement_so_far += chunk_replacement_count
            if chunk_replacement_count > 0:
                cor_effective_so_far += 1
            if progress_callback is not None:
                progress_callback(
                    {
                        "stage": "cor",
                        "done_chunks": index,
                        "total_chunks": total_documents,
                        "metrics": {
                            "cor_ready_chunk_count": cor_ready_so_far,
                            "cor_cluster_count": cor_cluster_so_far,
                            "cor_replacement_count": cor_replacement_so_far,
                            "cor_effective_chunk_count": cor_effective_so_far,
                        },
                    }
                )
            continue

        for chunk in group:
            chunk["cor_status"] = "unavailable"
            chunk["cor_format_version"] = cor_format_version
            chunk["cor_cluster_count"] = 0
            chunk["cor_replacement_count"] = 0
            chunk["cor_resolution_mode"] = "identity_fallback"
            chunk["cor_reason_code"] = str(semantic_state.get("reason_code") or "NLP_ENGINE_UNAVAILABLE")
            chunk["cor_reason"] = str(semantic_state.get("reason") or "NLP semantic engine is not configured.")
            chunk.pop("cor_path", None)
            chunk.pop("cor_structured_path", None)
            chunk.pop("cor_annotated_path", None)

        chunk_text, _, interlinear_path, cor_input_mode = manager._resolve_document_ner_input_text(
            group,
            map_rows=map_rows,
            source=source,
            allow_fallback=source.type in {"text", "chat"},
            chunks_only=manager._source_requires_chunks_only(source),
        )
        if cor_input_mode in {"interlinear_required", "chunks_required"} or not str(chunk_text or "").strip():
            for chunk in group:
                chunk["cor_status"] = "unavailable"
                chunk["cor_input_mode"] = cor_input_mode
                chunk["cor_interlinear_path"] = str(interlinear_path or "")
                if cor_input_mode == "chunks_required":
                    chunk["cor_reason_code"] = "CHUNKS_REQUIRED"
                    chunk["cor_reason"] = "COR requires chunk text input and fallback is disabled."
                else:
                    chunk["cor_reason_code"] = "INTERLINEAR_REQUIRED"
                    chunk["cor_reason"] = "COR requires interlinear input and fallback is disabled."
            if progress_callback is not None:
                progress_callback(
                    {
                        "stage": "cor",
                        "done_chunks": index,
                        "total_chunks": total_documents,
                        "metrics": {
                            "cor_ready_chunk_count": cor_ready_so_far,
                            "cor_cluster_count": cor_cluster_so_far,
                            "cor_replacement_count": cor_replacement_so_far,
                            "cor_effective_chunk_count": cor_effective_so_far,
                        },
                    }
                )
            continue

        raw_result: Any = {}
        if ready and config is not None:
            # HanLP coreference is intentionally disabled in CoPaw runtime.
            for chunk in group:
                chunk["cor_reason_code"] = "HANLP_COREF_NOT_OPEN_SOURCE"
                chunk["cor_reason"] = (
                    "HanLP coreference_resolution is not open-source and is disabled in CoPaw runtime."
                )

        cor_relative_path = manager._build_cor_relative_path(str(representative.get("chunk_path") or ""))
        cor_structured_relative_path = manager._build_cor_structured_relative_path(
            str(representative.get("chunk_path") or "")
        )
        cor_annotated_relative_path = manager._build_cor_annotated_relative_path(
            str(representative.get("chunk_path") or "")
        )

        structured_payload = manager._render_chunk_cor_structured_payload(
            representative,
            text=chunk_text,
            raw_result=raw_result,
            interlinear_path=interlinear_path,
            cor_input_mode=cor_input_mode,
        )
        cor_cluster_count = _safe_count_int(structured_payload.get("cluster_count") or 0)
        cor_replacement_count = _safe_count_int(structured_payload.get("replacement_count") or 0)
        cor_resolution_mode = str(structured_payload.get("resolution_mode") or "identity_fallback")

        cor_file_path = manager.root_dir / cor_relative_path
        cor_structured_file_path = manager.root_dir / cor_structured_relative_path
        cor_annotated_file_path = manager.root_dir / cor_annotated_relative_path
        cor_file_path.parent.mkdir(parents=True, exist_ok=True)
        cor_file_path.write_text(
            manager._render_chunk_cor_text(representative, structured_payload),
            encoding="utf-8",
        )
        cor_structured_file_path.parent.mkdir(parents=True, exist_ok=True)
        cor_structured_file_path.write_text(
            json.dumps(
                structured_payload,
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        cor_annotated_file_path.parent.mkdir(parents=True, exist_ok=True)
        cor_annotated_file_path.write_text(
            manager._render_chunk_cor_annotated_markdown(representative, structured_payload),
            encoding="utf-8",
        )

        for chunk in group:
            chunk["cor_input_mode"] = str(cor_input_mode or "")
            chunk["cor_interlinear_path"] = str(interlinear_path or "")
            chunk["cor_cluster_count"] = cor_cluster_count
            chunk["cor_replacement_count"] = cor_replacement_count
            chunk["cor_resolution_mode"] = cor_resolution_mode
            chunk["cor_path"] = cor_relative_path.as_posix()
            chunk["cor_structured_path"] = cor_structured_relative_path.as_posix()
            chunk["cor_annotated_path"] = cor_annotated_relative_path.as_posix()

        current_cor_paths.add(cor_relative_path.as_posix())
        current_cor_paths.add(cor_structured_relative_path.as_posix())
        current_cor_paths.add(cor_annotated_relative_path.as_posix())

        if str(representative.get("cor_status") or "").strip() == "ready":
            cor_ready_so_far += 1
        cor_cluster_so_far += cor_cluster_count
        cor_replacement_so_far += cor_replacement_count
        if cor_replacement_count > 0:
            cor_effective_so_far += 1

        manager._write_source_cor_manifest(source.id, current_cor_paths)
        manager._write_l2_checkpoint(
            source.id,
            payload,
            stage="cor",
            done_chunks=index,
            total_chunks=total_documents,
            metrics={
                "cor_ready_chunk_count": cor_ready_so_far,
                "cor_cluster_count": cor_cluster_so_far,
                "cor_replacement_count": cor_replacement_so_far,
                "cor_effective_chunk_count": cor_effective_so_far,
            },
        )
        if progress_callback is not None:
            progress_callback(
                {
                    "stage": "cor",
                    "done_chunks": index,
                    "total_chunks": total_documents,
                    "metrics": {
                        "cor_ready_chunk_count": cor_ready_so_far,
                        "cor_cluster_count": cor_cluster_so_far,
                        "cor_replacement_count": cor_replacement_so_far,
                        "cor_effective_chunk_count": cor_effective_so_far,
                    },
                }
            )

    stale_cor_paths = previous_manifest_paths - current_cor_paths
    for cor_path in stale_cor_paths:
        manager._delete_cor_path(cor_path)
    manager._write_source_cor_manifest(source.id, current_cor_paths)
    return current_cor_paths
