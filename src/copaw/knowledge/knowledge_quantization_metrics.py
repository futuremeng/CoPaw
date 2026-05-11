# -*- coding: utf-8 -*-

from __future__ import annotations

from typing import Any


def _safe_int(value: Any) -> int:
	if isinstance(value, bool):
		return int(value)
	try:
		return int(value)
	except (TypeError, ValueError):
		return 0


def _safe_float(value: Any) -> float | None:
	if value is None:
		return None
	try:
		return float(value)
	except (TypeError, ValueError):
		return None


def build_l1_metrics(state: dict[str, Any], source_status: dict[str, Any] | None) -> dict[str, Any]:
	if not isinstance(source_status, dict):
		source_status = {}
	latest_source_id = str(state.get("latest_source_id") or "").strip()
	metrics_updated_at = str(
		source_status.get("stats_updated_at")
		or source_status.get("indexed_at")
		or source_status.get("raw_last_ingested_at")
		or state.get("updated_at")
		or ""
	).strip()
	raw_document_count = _safe_int(source_status.get("raw_document_count"))
	indexed_document_count = _safe_int(source_status.get("document_count"))
	snapshot_count = _safe_int(source_status.get("snapshot_count"))
	return {
		"source_id": latest_source_id or None,
		"metrics_source": "project_sync_l1_raw",
		"metrics_updated_at": metrics_updated_at or None,
		"document_count": indexed_document_count,
		"snapshot_count": snapshot_count,
		"raw_document_count": raw_document_count,
		"indexed_document_count": indexed_document_count,
		"chunk_count": _safe_int(source_status.get("chunk_count")),
		"sentence_count": _safe_int(source_status.get("sentence_count")),
		"char_count": _safe_int(source_status.get("char_count")),
		"token_count": _safe_int(source_status.get("token_count")),
		"raw_total_bytes": _safe_int(source_status.get("raw_total_bytes")),
		"raw_last_ingested_at": str(source_status.get("raw_last_ingested_at") or "").strip() or None,
		"source_stats_updated_at": str(source_status.get("stats_updated_at") or "").strip() or None,
	}


def build_l2_metrics(state: dict[str, Any], index_result: dict[str, Any]) -> dict[str, Any]:
	live_l2 = state.get("l2_metrics") if isinstance(state.get("l2_metrics"), dict) else {}
	l2_progress = state.get("l2_progress") if isinstance(state.get("l2_progress"), dict) else {}
	index_result = index_result or {}
	total_chunks = max(
		_safe_int(l2_progress.get("total_chunks")),
		_safe_int(index_result.get("chunk_count")),
	)
	return {
		"metrics_source": "project_sync_l2_nlp",
		"metrics_updated_at": str(state.get("updated_at") or state.get("last_finished_at") or "").strip() or None,
		"total_chunks": total_chunks,
		"tokenize_done_chunks": max(_safe_int(l2_progress.get("tokenize_done_chunks")), _safe_int(index_result.get("tokenize_ready_chunk_count"))),
		"cor_done_chunks": max(_safe_int(l2_progress.get("cor_done_chunks")), _safe_int(index_result.get("cor_ready_chunk_count"))),
		"ner_done_chunks": max(_safe_int(l2_progress.get("ner_done_chunks")), _safe_int(index_result.get("ner_ready_chunk_count"))),
		"syntax_done_chunks": max(_safe_int(l2_progress.get("syntax_done_chunks")), _safe_int(index_result.get("syntax_ready_chunk_count"))),
		"tokenize_ready_chunk_count": max(_safe_int(live_l2.get("tokenize_ready_chunk_count")), _safe_int(index_result.get("tokenize_ready_chunk_count"))),
		"tokenize_line_count": max(_safe_int(live_l2.get("tokenize_line_count")), _safe_int(index_result.get("tokenize_line_count"))),
		"tokenize_token_count": max(_safe_int(live_l2.get("tokenize_token_count")), _safe_int(index_result.get("tokenize_token_count"))),
		"cor_ready_chunk_count": max(_safe_int(live_l2.get("cor_ready_chunk_count")), _safe_int(index_result.get("cor_ready_chunk_count"))),
		"cor_cluster_count": max(_safe_int(live_l2.get("cor_cluster_count")), _safe_int(index_result.get("cor_cluster_count"))),
		"cor_replacement_count": max(_safe_int(live_l2.get("cor_replacement_count")), _safe_int(index_result.get("cor_replacement_count"))),
		"cor_effective_chunk_count": max(_safe_int(live_l2.get("cor_effective_chunk_count")), _safe_int(index_result.get("cor_effective_chunk_count"))),
		"ner_ready_chunk_count": max(_safe_int(live_l2.get("ner_ready_chunk_count")), _safe_int(index_result.get("ner_ready_chunk_count"))),
		"ner_entity_count": max(_safe_int(live_l2.get("ner_entity_count")), _safe_int(index_result.get("ner_entity_count"))),
		"syntax_ready_chunk_count": max(_safe_int(live_l2.get("syntax_ready_chunk_count")), _safe_int(index_result.get("syntax_ready_chunk_count"))),
		"syntax_sentence_count": max(_safe_int(live_l2.get("syntax_sentence_count")), _safe_int(index_result.get("syntax_sentence_count"))),
		"syntax_token_count": max(_safe_int(live_l2.get("syntax_token_count")), _safe_int(index_result.get("syntax_token_count"))),
		"syntax_pos_count": max(_safe_int(live_l2.get("syntax_pos_count")), _safe_int(index_result.get("syntax_pos_count"))),
		"syntax_pos_tag_type_count": max(_safe_int(live_l2.get("syntax_pos_tag_type_count")), _safe_int(index_result.get("syntax_pos_tag_type_count"))),
		"pos_coverage_on_syntax_tokens": max(_safe_float(live_l2.get("pos_coverage_on_syntax_tokens")) or 0.0, _safe_float(index_result.get("pos_coverage_on_syntax_tokens")) or 0.0),
		"pos_coverage_on_document_tokens": max(_safe_float(live_l2.get("pos_coverage_on_document_tokens")) or 0.0, _safe_float(index_result.get("pos_coverage_on_document_tokens")) or 0.0),
		"syntax_relation_count": max(_safe_int(live_l2.get("syntax_relation_count")), _safe_int(index_result.get("syntax_relation_count"))),
		"entity_count": max(_safe_int(live_l2.get("ner_entity_count")), _safe_int(index_result.get("ner_entity_count"))),
		"relation_count": max(_safe_int(live_l2.get("syntax_relation_count")), _safe_int(index_result.get("syntax_relation_count"))),
	}


def build_l3_metrics(state: dict[str, Any]) -> dict[str, Any]:
	return {
		"metrics_source": "project_sync_l3_placeholder",
		"metrics_updated_at": str(state.get("updated_at") or state.get("last_finished_at") or "").strip() or None,
		"status": "empty",
		"reason_code": "L3_NOT_READY",
		"reason": "L3 agentic metrics are intentionally empty until independent outputs are ready.",
		"entity_count": 0,
		"relation_count": 0,
		"quality_score": None,
	}


def resolve_nlp_stage_status(
	*,
	mode_status: str,
	total_chunks: int,
	ready_chunks: int,
	done_chunks: int,
	optional: bool = False,
	reason_code: str = "",
) -> str:
	if ready_chunks > 0:
		if mode_status == "running" and total_chunks > 0 and done_chunks < total_chunks:
			return "running"
		return "ready"
	if optional:
		normalized_reason = str(reason_code or "").strip()
		cor_unavailable = (
			normalized_reason
			and normalized_reason != "HANLP2_TASK_READY"
			and normalized_reason != "HANLP2_COREF_HEURISTIC_READY"
			and mode_status not in {"running", "queued"}
		)
		if cor_unavailable:
			return "unavailable"
	if mode_status == "running":
		return "running"
	return "pending"


def build_nlp_progress(
	self: Any,
	processing_modes: list[dict[str, Any]],
	l2_metrics: dict[str, Any],
) -> dict[str, Any]:
	mode_map = {
		str(item.get("mode") or "").strip(): item
		for item in processing_modes
		if isinstance(item, dict)
	}
	nlp_mode = mode_map.get("nlp") or {}
	mode_status = str(nlp_mode.get("status") or "idle").strip().lower()
	total_chunks = _safe_int(l2_metrics.get("total_chunks"))

	cor_done = _safe_int(l2_metrics.get("cor_done_chunks"))
	ner_done = _safe_int(l2_metrics.get("ner_done_chunks"))
	syntax_done = _safe_int(l2_metrics.get("syntax_done_chunks"))
	tokenize_done = _safe_int(l2_metrics.get("tokenize_done_chunks"))
	cor_ready = _safe_int(l2_metrics.get("cor_ready_chunk_count"))
	ner_ready = _safe_int(l2_metrics.get("ner_ready_chunk_count"))
	syntax_ready = _safe_int(l2_metrics.get("syntax_ready_chunk_count"))
	tokenize_ready = _safe_int(l2_metrics.get("tokenize_ready_chunk_count"))
	cor_reason_code = str(l2_metrics.get("cor_reason_code") or "").strip()
	cor_reason = str(l2_metrics.get("cor_reason") or "").strip()

	return {
		"mode": "nlp",
		"status": mode_status,
		"stage": str(nlp_mode.get("stage") or "").strip(),
		"summary": str(nlp_mode.get("summary") or "").strip(),
		"updated_at": str(l2_metrics.get("metrics_updated_at") or nlp_mode.get("last_updated_at") or "").strip() or None,
		"total_chunks": total_chunks,
		"entity_count": _safe_int(l2_metrics.get("ner_entity_count")),
		"relation_count": _safe_int(l2_metrics.get("syntax_relation_count")),
		"stages": {
			"tokenize": {
				"key": "tokenize",
				"required": True,
				"status": resolve_nlp_stage_status(mode_status=mode_status, total_chunks=total_chunks, ready_chunks=tokenize_ready, done_chunks=tokenize_done),
				"done_chunks": tokenize_done,
				"ready_chunks": tokenize_ready,
				"line_count": _safe_int(l2_metrics.get("tokenize_line_count")),
				"token_count": _safe_int(l2_metrics.get("tokenize_token_count")),
			},
			"ner": {
				"key": "ner",
				"required": True,
				"status": resolve_nlp_stage_status(mode_status=mode_status, total_chunks=total_chunks, ready_chunks=ner_ready, done_chunks=ner_done),
				"done_chunks": ner_done,
				"ready_chunks": ner_ready,
				"entity_count": _safe_int(l2_metrics.get("ner_entity_count")),
			},
			"syntax": {
				"key": "syntax",
				"required": True,
				"status": resolve_nlp_stage_status(mode_status=mode_status, total_chunks=total_chunks, ready_chunks=syntax_ready, done_chunks=syntax_done),
				"done_chunks": syntax_done,
				"ready_chunks": syntax_ready,
				"sentence_count": _safe_int(l2_metrics.get("syntax_sentence_count")),
				"token_count": _safe_int(l2_metrics.get("syntax_token_count")),
				"pos_count": _safe_int(l2_metrics.get("syntax_pos_count")),
				"pos_tag_type_count": _safe_int(l2_metrics.get("syntax_pos_tag_type_count")),
				"pos_coverage_on_syntax_tokens": _safe_float(l2_metrics.get("pos_coverage_on_syntax_tokens")),
				"pos_coverage_on_document_tokens": _safe_float(l2_metrics.get("pos_coverage_on_document_tokens")),
				"relation_count": _safe_int(l2_metrics.get("syntax_relation_count")),
			},
			"phrase": {
				"key": "phrase",
				"required": False,
				"status": "unavailable",
				"done_chunks": 0,
				"ready_chunks": 0,
				"reason_code": "PHRASE_LAYER_NOT_IMPLEMENTED",
				"reason": "Phrase-layer extraction is reserved for a later release.",
			},
			"cor": {
				"key": "cor",
				"required": False,
				"status": resolve_nlp_stage_status(mode_status=mode_status, total_chunks=total_chunks, ready_chunks=cor_ready, done_chunks=cor_done, optional=True, reason_code=cor_reason_code),
				"done_chunks": cor_done,
				"ready_chunks": cor_ready,
				"reason_code": cor_reason_code,
				"reason": cor_reason,
			},
		},
	}