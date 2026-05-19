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


def write_chunk_tokenize_artifacts(
	manager: Any,
	source: KnowledgeSourceSpec,
	payload: dict[str, Any],
	*,
	config: KnowledgeConfig | None,
	progress_callback: Callable[[dict[str, Any]], None] | None = None,
	progress_start: int = 45,
	progress_end: int = 52,
) -> set[str]:
	previous_manifest_paths = manager._load_source_tokenize_manifest(source.id)
	current_tokenize_paths: set[str] = set()
	map_rows = manager._load_source_interlinear_lightweight_map_rows(source.id)

	raw_chunks = payload.get("chunks") or []
	chunks = [item for item in raw_chunks if isinstance(item, dict)] if isinstance(raw_chunks, list) else []
	chunk_groups = manager._group_chunks_for_ner(chunks)
	total_documents = len(chunk_groups)
	tokenize_ready_so_far = 0
	tokenize_line_so_far = 0
	tokenize_token_so_far = 0
	document_token_totals: dict[str, int] = {}

	for index, group in enumerate(chunk_groups, start=1):
		representative = group[0]

		if all(manager._chunk_stage_ready_for_resume(chunk, stage="tokenize") for chunk in group):
			for chunk in group:
				current_tokenize_paths.update(manager._chunk_stage_paths(chunk, stage="tokenize"))
			tokenize_ready_so_far += 1
			document_path = str(
				representative.get("document_path")
				or representative.get("snapshot_relative_path")
				or ""
			).strip()
			group_token_count = max(
				max(0, _safe_count_int(chunk.get("tokenize_token_count") or 0))
				for chunk in group
			)
			if document_path:
				document_token_totals[document_path] = document_token_totals.get(document_path, 0) + group_token_count
			tokenize_line_so_far += max(
				max(0, _safe_count_int(chunk.get("tokenize_line_count") or 0))
				for chunk in group
			)
			tokenize_token_so_far += max(
				max(0, _safe_count_int(chunk.get("tokenize_token_count") or 0))
				for chunk in group
			)
			if progress_callback is not None:
				progress_callback(
					{
						"stage": "tokenize",
						"done_chunks": index,
						"total_chunks": total_documents,
						"metrics": {
							"tokenize_ready_chunk_count": tokenize_ready_so_far,
							"tokenize_line_count": tokenize_line_so_far,
							"tokenize_token_count": tokenize_token_so_far,
						},
					}
				)
			continue

		for chunk in group:
			chunk["tokenize_status"] = "unavailable"
			chunk["tokenize_format_version"] = manager._TOKENIZE_FORMAT_VERSION if hasattr(manager, "_TOKENIZE_FORMAT_VERSION") else "0.1"
			chunk["tokenize_line_count"] = 0
			chunk["tokenize_token_count"] = 0
			chunk.pop("tokenize_path", None)
			chunk.pop("tokenize_structured_path", None)
			chunk.pop("tokenize_line_stats_path", None)

		resolved_text, source_text, interlinear_path, tokenize_input_mode = manager._resolve_document_ner_input_text(
			group,
			map_rows=map_rows,
			source=source,
			allow_fallback=source.type in {"text", "chat"},
		)
		if tokenize_input_mode == "interlinear_required" or not str(resolved_text or "").strip():
			raise RuntimeError("Tokenize stage requires non-empty interlinear-aligned input text.")

		line_entries: list[dict[str, Any]] = []
		line_count = 0
		token_count = 0
		for line_index, line_text in enumerate(str(resolved_text or "").splitlines(), start=1):
			line_count += 1
			raw_tokens, state = manager._semantic_runtime.tokenize(line_text, config)
			manager._remember_semantic_engine_state(state)
			if str(state.get("status") or "").strip().lower() != "ready":
				reason_code = str(state.get("reason_code") or "HANLP_TOKENIZE_FAILED").strip() or "HANLP_TOKENIZE_FAILED"
				reason = str(state.get("reason") or "HanLP2 sidecar tokenization failed.").strip()
				raise RuntimeError(f"Tokenize stage failed at line {line_index}: {reason_code} {reason}")
			tokens = manager._flatten_tokenize_items(raw_tokens)
			offsets = manager._token_offsets_from_text(line_text, tokens)
			token_rows: list[dict[str, Any]] = []
			for token_index, token_text in enumerate(tokens, start=1):
				start, end = offsets[token_index - 1] if token_index - 1 < len(offsets) else (0, 0)
				token_rows.append(
					{
						"token_index": token_index,
						"text": token_text,
						"start": int(start),
						"end": int(end),
					}
				)
			token_count += len(token_rows)
			line_entries.append(
				{
					"line_index": line_index,
					"text": line_text,
					"token_count": len(token_rows),
					"tokens": token_rows,
				}
			)

		structured_payload = {
			"artifact": "tokenize_structured",
			"format_version": "0.1",
			"document_path": str(representative.get("document_path") or ""),
			"document_title": str(representative.get("document_title") or ""),
			"chunk_id": str(representative.get("chunk_id") or ""),
			"chunk_path": str(representative.get("chunk_path") or ""),
			"version_id": manager._chunk_version_id(representative),
			"snapshot_at": str(representative.get("snapshot_at") or ""),
			"source_text": str(source_text or ""),
			"input_text": str(resolved_text or ""),
			"interlinear_path": str(interlinear_path or ""),
			"tokenize_input_mode": str(tokenize_input_mode or "chunk_fallback"),
			"line_count": line_count,
			"token_count": token_count,
			"lines": line_entries,
		}

		tokenize_relative_path = manager._build_tokenize_relative_path(str(representative.get("chunk_path") or ""))
		tokenize_structured_relative_path = manager._build_tokenize_structured_relative_path(
			str(representative.get("chunk_path") or "")
		)
		tokenize_line_stats_relative_path = manager._build_tokenize_line_stats_relative_path(
			str(representative.get("chunk_path") or "")
		)
		tokenize_file_path = manager.root_dir / tokenize_relative_path
		tokenize_structured_file_path = manager.root_dir / tokenize_structured_relative_path
		tokenize_line_stats_file_path = manager.root_dir / tokenize_line_stats_relative_path
		tokenize_file_path.parent.mkdir(parents=True, exist_ok=True)
		tokenize_file_path.write_text(
			manager._render_chunk_tokenize_text(representative, structured_payload),
			encoding="utf-8",
		)
		tokenize_structured_file_path.parent.mkdir(parents=True, exist_ok=True)
		tokenize_structured_file_path.write_text(
			json.dumps(structured_payload, ensure_ascii=False, indent=2) + "\n",
			encoding="utf-8",
		)
		tokenize_line_stats_payload = {
			"artifact": "tokenize_line_stats",
			"format_version": "0.1",
			"document_path": str(representative.get("document_path") or ""),
			"chunk_id": str(representative.get("chunk_id") or ""),
			"chunk_path": str(representative.get("chunk_path") or ""),
			"version_id": manager._chunk_version_id(representative),
			"line_count": line_count,
			"token_count_total": token_count,
			"line_token_counts": [
				{
					"line_index": int(item.get("line_index") or 0),
					"token_count": int(item.get("token_count") or 0),
				}
				for item in line_entries
				if isinstance(item, dict)
			],
			"updated_at": datetime.now(UTC).isoformat(),
		}
		tokenize_line_stats_file_path.parent.mkdir(parents=True, exist_ok=True)
		tokenize_line_stats_file_path.write_text(
			json.dumps(tokenize_line_stats_payload, ensure_ascii=False, indent=2) + "\n",
			encoding="utf-8",
		)

		for chunk in group:
			chunk["tokenize_status"] = "ready"
			chunk["tokenize_format_version"] = "0.1"
			chunk["tokenize_input_mode"] = str(tokenize_input_mode or "")
			chunk["tokenize_interlinear_path"] = str(interlinear_path or "")
			chunk["tokenize_line_count"] = line_count
			chunk["tokenize_token_count"] = token_count
			chunk["tokenize_path"] = tokenize_relative_path.as_posix()
			chunk["tokenize_structured_path"] = tokenize_structured_relative_path.as_posix()
			chunk["tokenize_line_stats_path"] = tokenize_line_stats_relative_path.as_posix()

		current_tokenize_paths.add(tokenize_relative_path.as_posix())
		current_tokenize_paths.add(tokenize_structured_relative_path.as_posix())
		current_tokenize_paths.add(tokenize_line_stats_relative_path.as_posix())
		tokenize_ready_so_far += 1
		tokenize_line_so_far += line_count
		tokenize_token_so_far += token_count
		document_path = str(representative.get("document_path") or representative.get("snapshot_relative_path") or "").strip()
		if document_path:
			document_token_totals[document_path] = document_token_totals.get(document_path, 0) + token_count
		manager._write_source_tokenize_manifest(source.id, current_tokenize_paths)
		manager._write_l2_checkpoint(
			source.id,
			payload,
			stage="tokenize",
			done_chunks=index,
			total_chunks=total_documents,
			metrics={
				"tokenize_ready_chunk_count": tokenize_ready_so_far,
				"tokenize_line_count": tokenize_line_so_far,
				"tokenize_token_count": tokenize_token_so_far,
			},
		)
		if progress_callback is not None:
			progress_callback(
				{
					"stage": "tokenize",
					"done_chunks": index,
					"total_chunks": total_documents,
					"metrics": {
						"tokenize_ready_chunk_count": tokenize_ready_so_far,
						"tokenize_line_count": tokenize_line_so_far,
						"tokenize_token_count": tokenize_token_so_far,
					},
				}
			)

	stale_tokenize_paths = previous_manifest_paths - current_tokenize_paths
	for tokenize_path in stale_tokenize_paths:
		manager._delete_tokenize_path(tokenize_path)
	manager._write_source_tokenize_manifest(source.id, current_tokenize_paths)
	manager._write_source_tokenize_file_totals(source.id, document_token_totals)
	return current_tokenize_paths
