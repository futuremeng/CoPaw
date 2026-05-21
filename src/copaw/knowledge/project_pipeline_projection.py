# -*- coding: utf-8 -*-

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .knowledge_quantization_metrics import (
	build_l1_metrics,
	build_l2_metrics,
	build_l3_metrics,
	build_nlp_progress,
)


def _safe_int(value: Any) -> int:
	try:
		return int(value)
	except (TypeError, ValueError):
		return 0


def _safe_float(value: Any) -> float | None:
	try:
		return float(value)
	except (TypeError, ValueError):
		return None


def _as_dict(value: Any) -> dict[str, Any]:
	return value if isinstance(value, dict) else {}


def _merge_runtime_nlp_progress(
	hydrated: dict[str, Any],
	runtime: dict[str, Any],
) -> dict[str, Any]:
	merged = dict(hydrated)
	for key in ("mode", "status", "stage", "summary", "updated_at"):
		value = runtime.get(key)
		if value not in {None, ""}:
			merged[key] = value
	for key in ("total_chunks", "entity_count", "relation_count"):
		merged[key] = max(_safe_int(merged.get(key)), _safe_int(runtime.get(key)))

	hydrated_stages = _as_dict(merged.get("stages"))
	runtime_stages = _as_dict(runtime.get("stages"))
	for stage_key, stage_payload in runtime_stages.items():
		runtime_stage = _as_dict(stage_payload)
		if not runtime_stage:
			continue
		stage = _as_dict(hydrated_stages.get(stage_key))
		stage_merged = dict(stage)
		for key in ("key", "required", "status", "reason_code", "reason"):
			value = runtime_stage.get(key)
			if value not in {None, ""}:
				stage_merged[key] = value
		for key in (
			"done_chunks",
			"ready_chunks",
			"done_lines",
			"total_lines",
			"done_documents",
			"total_documents",
			"line_count",
			"token_count",
			"entity_count",
			"sentence_count",
			"pos_count",
			"pos_tag_type_count",
			"relation_count",
			"cluster_count",
			"replacement_count",
			"effective_chunk_count",
		):
			stage_merged[key] = max(_safe_int(stage_merged.get(key)), _safe_int(runtime_stage.get(key)))
		documents_progress = runtime_stage.get("documents_progress")
		if isinstance(documents_progress, list) and documents_progress:
			stage_merged["documents_progress"] = [
				dict(item) for item in documents_progress if isinstance(item, dict)
			]
		hydrated_stages[stage_key] = stage_merged
	merged["stages"] = hydrated_stages
	return merged


def _task_states(semantic_engine: dict[str, Any]) -> dict[str, Any]:
	return _as_dict(semantic_engine.get("task_states"))


def _task_state_ready(semantic_engine: dict[str, Any], task_key: str) -> bool:
	state = _as_dict(_task_states(semantic_engine).get(task_key))
	return str(state.get("status") or "").strip().lower() in {"ready", "running"}


def _semantic_unavailable_blocks_nlp(semantic_engine: dict[str, Any]) -> bool:
	semantic_status = str(semantic_engine.get("status") or "idle").strip().lower()
	if semantic_status not in {"error", "unavailable"}:
		return False
	return not _task_state_ready(semantic_engine, "tokenize")


def _merge_file_analysis_l1_metrics(
	source_status: dict[str, Any],
	file_analysis_stats: dict[str, Any],
) -> dict[str, Any]:
	metrics = _as_dict(file_analysis_stats.get("metrics"))
	if not metrics:
		return dict(source_status)
	merged = dict(source_status)
	for key in ("document_count", "snapshot_count", "chunk_count", "sentence_count", "char_count", "token_count"):
		merged[key] = max(_safe_int(merged.get(key)), _safe_int(metrics.get(key)))
	merged["indexed"] = bool(merged.get("indexed")) or any(
		_safe_int(metrics.get(key)) > 0 for key in ("document_count", "snapshot_count", "chunk_count")
	)
	merged["indexed_at"] = str(merged.get("indexed_at") or file_analysis_stats.get("indexed_at") or "").strip() or None
	merged["stats_updated_at"] = str(merged.get("stats_updated_at") or file_analysis_stats.get("updated_at") or "").strip() or None
	return merged


def build_semantic_engine_summary(manager: Any, engine_state: dict[str, Any]) -> str:
	status = str(engine_state.get("status") or "idle").strip().lower()
	reason = str(engine_state.get("reason") or "").strip()
	if reason:
		reason = reason.split(" via ", 1)[0].strip()
		reason = reason.split(" or ", 1)[0].strip()
		reason = reason.replace("HanLP semantic tokenization", "HanLP tokenization")
	if status == "error":
		return f"Semantic engine error: {reason or 'Unknown semantic engine error.'}"
	if status == "unavailable":
		return f"Semantic engine unavailable: {reason or 'Semantic engine is unavailable.'}"
	if status == "ready":
		return "Semantic engine ready."
	return "Semantic engine waiting for project source preparation."


def merge_stage_message_with_semantic_summary(
	manager: Any,
	stage_message: str,
	semantic_engine: dict[str, Any],
	*,
	include_reason_code: bool = False,
) -> str:
	base_message = str(stage_message or "").strip()
	summary = str(semantic_engine.get("summary") or "").strip()
	reason_code = str(semantic_engine.get("reason_code") or "").strip()
	status = str(semantic_engine.get("status") or "idle").strip().lower()
	if status in {"error", "unavailable"} and summary:
		merged = f"{base_message} · {summary}" if base_message else summary
		if include_reason_code and reason_code:
			return f"{merged} (reason_code={reason_code})"
		return merged
	if base_message:
		return base_message if not summary or summary in base_message else f"{base_message} · {summary}"
	return summary


def build_semantic_engine_state(manager: Any, state: dict[str, Any]) -> dict[str, Any]:
	current = state.get("semantic_engine") if isinstance(state.get("semantic_engine"), dict) else {}
	latest_source_id = str(state.get("latest_source_id") or "").strip()
	if isinstance(current, dict) and current:
		payload = dict(current)
		payload.setdefault("engine", "hanlp")
		payload.setdefault("status", "idle")
		payload.setdefault("reason_code", "SOURCE_NOT_READY")
		payload.setdefault("reason", "Project source has not been prepared for semantic extraction yet.")
		payload.setdefault("updated_at", state.get("updated_at"))
		payload["summary"] = build_semantic_engine_summary(manager, payload)
		return payload
	if not latest_source_id:
		payload = dict(manager._default_state(str(state.get("project_id") or "")).get("semantic_engine") or {})
		payload.update({key: value for key, value in _as_dict(current).items() if value not in {None, ""}})
		payload["summary"] = build_semantic_engine_summary(manager, payload)
		return payload
	getter = getattr(manager._knowledge_manager, "get_semantic_engine_state", None)
	if callable(getter):
		try:
			payload = getter()
		except Exception:
			payload = current
	else:
		payload = current
	if not isinstance(payload, dict):
		payload = current
	if not isinstance(payload, dict) or not payload:
		payload = dict(manager._default_state(str(state.get("project_id") or "")).get("semantic_engine") or {})
	payload = dict(payload)
	payload.setdefault("engine", "hanlp")
	payload.setdefault("status", "idle")
	payload.setdefault("reason_code", "SOURCE_NOT_READY")
	payload.setdefault("reason", "Project source has not been prepared for semantic extraction yet.")
	payload.setdefault("updated_at", state.get("updated_at"))
	if isinstance(current, dict) and isinstance(current.get("task_states"), dict) and not isinstance(payload.get("task_states"), dict):
		payload["task_states"] = dict(current.get("task_states") or {})
	payload["summary"] = build_semantic_engine_summary(manager, payload)
	return payload


def relative_workspace_path(manager: Any, value: Any) -> str:
	text = str(value or "").strip()
	if not text:
		return ""
	path = Path(text).expanduser()
	try:
		return path.resolve().relative_to(manager.working_dir.resolve()).as_posix()
	except Exception:
		return text.replace("\\", "/")


def resolve_document_graph_artifacts(manager: Any, memify_result: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
	if not isinstance(memify_result, dict):
		return [], 0
	graph_path_text = str(memify_result.get("graph_path") or "").strip()
	manifest_path_text = str(memify_result.get("document_graph_manifest_path") or "").strip()
	graphify_dir_text = str(memify_result.get("document_graph_dir") or "").strip()
	if graph_path_text:
		graph_path = Path(graph_path_text)
		knowledge_dir = graph_path.parent.parent if len(graph_path.parents) >= 2 else graph_path.parent
		if not manifest_path_text:
			candidate = knowledge_dir / "graphify" / "manifest.json"
			if candidate.exists():
				manifest_path_text = str(candidate)
		if not graphify_dir_text:
			candidate_dir = knowledge_dir / "graphify"
			if candidate_dir.exists():
				graphify_dir_text = str(candidate_dir)
	document_graph_count = _safe_int(memify_result.get("document_graph_count"))
	if manifest_path_text:
		manifest_path = Path(manifest_path_text)
		if manifest_path.exists():
			try:
				manifest_payload = json.loads(manifest_path.read_text(encoding="utf-8"))
			except Exception:
				manifest_payload = {}
			document_graph_count = max(document_graph_count, _safe_int(manifest_payload.get("document_count")))
	artifacts: list[dict[str, Any]] = []
	if manifest_path_text and document_graph_count > 0:
		artifacts.append({
			"kind": "document_graph_manifest",
			"label": "Document graph manifest",
			"path": relative_workspace_path(manager, manifest_path_text),
		})
	if graphify_dir_text and document_graph_count > 0:
		artifacts.append({
			"kind": "document_graph_dir",
			"label": "Document graphify payloads",
			"path": relative_workspace_path(manager, graphify_dir_text),
		})
	return artifacts, document_graph_count


def collect_source_document_sample_paths(manager: Any, source_id: str) -> list[str]:
	getter = getattr(manager._knowledge_manager, "get_source_chunk_documents", None)
	if not callable(getter):
		return []
	try:
		payload = getter(source_id)
	except TypeError:
		payload = getter(source_id=source_id)
	except Exception:
		return []
	documents = payload.get("documents") if isinstance(payload, dict) else []
	if not isinstance(documents, list):
		return []
	return [
		str(item.get("path") or "").strip()
		for item in documents
		if isinstance(item, dict) and str(item.get("path") or "").strip()
	]


def _collect_project_source_specs(manager: Any, project_id: str) -> list[Any]:
	getter = getattr(manager._knowledge_manager, "list_sources_from_storage", None)
	if not callable(getter):
		return []
	try:
		sources = getter()
	except Exception:
		return []
	if not isinstance(sources, list):
		return []
	if not project_id:
		return [item for item in sources if getattr(item, "id", None)]
	return [
		item
		for item in sources
		if getattr(item, "id", None) and str(getattr(item, "project_id", "") or "").strip() == project_id
	]


def _load_source_index_chunks(manager: Any, source_id: str) -> list[dict[str, Any]]:
	loader = getattr(manager._knowledge_manager, "_load_index_payload", None)
	if not callable(loader):
		return []
	try:
		payload = loader(source_id)
	except Exception:
		return []
	if not isinstance(payload, dict):
		return []
	chunks = payload.get("chunks")
	if not isinstance(chunks, list):
		return []
	return [item for item in chunks if isinstance(item, dict)]


def _first_non_empty_path(manager: Any, chunks: list[dict[str, Any]], keys: list[str]) -> str:
	for chunk in chunks:
		for key in keys:
			path = str(chunk.get(key) or "").strip()
			if path:
				return relative_workspace_path(manager, path)
	return ""


def _source_sample_paths(manager: Any, chunks: list[dict[str, Any]]) -> list[str]:
	paths: list[str] = []
	for chunk in chunks:
		doc_path = str(chunk.get("document_path") or "").strip()
		if doc_path and doc_path not in paths:
			paths.append(relative_workspace_path(manager, doc_path))
		if len(paths) >= 5:
			break
	return paths


def build_mode_metrics_by_source(
	manager: Any,
	state: dict[str, Any],
	mode_metrics: dict[str, Any],
) -> dict[str, Any]:
	project_id = str(state.get("project_id") or "").strip()
	latest_source_id = str(state.get("latest_source_id") or "").strip()
	source_specs = _collect_project_source_specs(manager, project_id)
	if not source_specs and latest_source_id:
		source_specs = [type("_SourceRef", (), {"id": latest_source_id, "project_id": project_id, "location": "", "name": latest_source_id})()]

	status_getter = getattr(manager._knowledge_manager, "get_source_status", None)
	by_source: dict[str, Any] = {}

	def _build_payload_for_chunks(
		chunks: list[dict[str, Any]],
		*,
		document_count: int,
		chunk_count: int,
		token_count: int,
	) -> dict[str, Any]:
		sample_paths = _source_sample_paths(manager, chunks)
		ner_entity_count = sum(_safe_int(chunk.get("ner_entity_count")) for chunk in chunks)
		ner_ready_chunk_count = sum(1 for chunk in chunks if str(chunk.get("ner_status") or "").strip().lower() == "ready")
		syntax_sentence_count = sum(_safe_int(chunk.get("syntax_sentence_count")) for chunk in chunks)
		syntax_token_count = sum(_safe_int(chunk.get("syntax_token_count")) for chunk in chunks)
		syntax_pos_count = sum(_safe_int(chunk.get("syntax_pos_count")) for chunk in chunks)
		syntax_relation_count = sum(_safe_int(chunk.get("syntax_relation_count")) for chunk in chunks)
		cor_cluster_count = sum(_safe_int(chunk.get("cor_cluster_count")) for chunk in chunks)
		cor_replacement_count = sum(_safe_int(chunk.get("cor_replacement_count")) for chunk in chunks)
		cor_ready_chunk_count = sum(1 for chunk in chunks if str(chunk.get("cor_status") or "").strip().lower() == "ready")
		cor_effective_chunk_count = sum(1 for chunk in chunks if _safe_int(chunk.get("cor_replacement_count")) > 0)
		tokenize_line_count = sum(_safe_int(chunk.get("tokenize_line_count")) for chunk in chunks)

		fast_global = _as_dict(mode_metrics.get("fast"))
		nlp_global = _as_dict(mode_metrics.get("nlp"))
		agentic_global = _as_dict(mode_metrics.get("agentic"))

		fast_metrics = {
			**fast_global,
			"mode": "fast",
			"document_count": document_count,
			"chunk_count": chunk_count,
		}
		nlp_metrics = {
			**nlp_global,
			"mode": "nlp",
			"document_count": document_count,
			"chunk_count": chunk_count,
			"tokenize_line_count": tokenize_line_count,
			"tokenize_token_count": token_count,
			"ner_ready_chunk_count": ner_ready_chunk_count,
			"ner_entity_count": ner_entity_count,
			"syntax_sentence_count": syntax_sentence_count,
			"syntax_token_count": syntax_token_count,
			"syntax_pos_count": syntax_pos_count,
			"syntax_relation_count": syntax_relation_count,
			"cor_ready_chunk_count": cor_ready_chunk_count,
			"cor_cluster_count": cor_cluster_count,
			"cor_replacement_count": cor_replacement_count,
			"cor_effective_chunk_count": cor_effective_chunk_count,
			"evidence_paths": {
				"document_count": _first_non_empty_path(manager, chunks, ["document_path", "snapshot_path"]),
				"tokenize_line_count": _first_non_empty_path(manager, chunks, ["tokenize_interlinear_path", "syntax_interlinear_path", "tokenize_structured_path", "tokenize_path", "snapshot_path", "chunk_path"]),
				"tokenize_token_count": _first_non_empty_path(manager, chunks, ["snapshot_path", "syntax_interlinear_path", "chunk_path"]),
				"ner_ready_chunk_count": _first_non_empty_path(manager, chunks, ["ner_structured_path", "ner_path"]),
				"ner_entity_count": _first_non_empty_path(manager, chunks, ["ner_structured_path", "ner_path"]),
				"syntax_sentence_count": _first_non_empty_path(manager, chunks, ["syntax_structured_path", "syntax_path"]),
				"syntax_token_count": _first_non_empty_path(manager, chunks, ["syntax_structured_path", "syntax_path"]),
				"syntax_pos_count": _first_non_empty_path(manager, chunks, ["syntax_structured_path", "syntax_path"]),
				"syntax_relation_count": _first_non_empty_path(manager, chunks, ["syntax_structured_path", "syntax_path"]),
				"cor_ready_chunk_count": _first_non_empty_path(manager, chunks, ["cor_structured_path", "cor_path"]),
				"cor_cluster_count": _first_non_empty_path(manager, chunks, ["cor_structured_path", "cor_path"]),
				"cor_replacement_count": _first_non_empty_path(manager, chunks, ["cor_structured_path", "cor_path"]),
				"cor_effective_chunk_count": _first_non_empty_path(manager, chunks, ["cor_structured_path", "cor_path"]),
			},
			"evidence_bundles": {
				"document_count": {
					"metric_key": "document_count",
					"metric_kind": "aggregate",
					"source_count": len(sample_paths),
					"sample_source_paths": sample_paths,
				},
				"tokenize_line_count": {
					"metric_key": "tokenize_line_count",
					"metric_kind": "aggregate",
					"source_count": len(sample_paths),
					"sample_source_paths": sample_paths,
				},
				"tokenize_token_count": {
					"metric_key": "tokenize_token_count",
					"metric_kind": "aggregate",
					"source_count": len(sample_paths),
					"sample_source_paths": sample_paths,
				},
				"ner_entity_count": {
					"metric_key": "ner_entity_count",
					"metric_kind": "aggregate",
					"source_count": len(sample_paths),
					"sample_source_paths": sample_paths,
				},
				"syntax_relation_count": {
					"metric_key": "syntax_relation_count",
					"metric_kind": "aggregate",
					"source_count": len(sample_paths),
					"sample_source_paths": sample_paths,
				},
			},
		}
		agentic_metrics = {
			**agentic_global,
			"mode": "agentic",
			"document_count": document_count,
			"chunk_count": chunk_count,
		}
		return {
			"fast": fast_metrics,
			"nlp": nlp_metrics,
			"agentic": agentic_metrics,
		}

	for source in source_specs:
		source_id = str(getattr(source, "id", "") or "").strip()
		if not source_id:
			continue
		source_status: dict[str, Any] = {}
		if callable(status_getter):
			try:
				source_status = status_getter(source_id, source=source, lightweight=True)
			except TypeError:
				try:
					source_status = status_getter(source_id=source_id, source=source, lightweight=True)
				except Exception:
					source_status = {}
			except Exception:
				source_status = {}
		if not isinstance(source_status, dict):
			source_status = {}

		chunks = _load_source_index_chunks(manager, source_id)
		document_count = _safe_int(source_status.get("document_count"))
		chunk_count = _safe_int(source_status.get("chunk_count"))
		token_count = _safe_int(source_status.get("token_count"))
		by_source[source_id] = _build_payload_for_chunks(
			chunks,
			document_count=document_count,
			chunk_count=chunk_count,
			token_count=token_count,
		)

		doc_groups: dict[str, list[dict[str, Any]]] = {}
		for chunk in chunks:
			doc_key = str(chunk.get("document_path") or "").strip()
			if not doc_key:
				continue
			doc_groups.setdefault(doc_key, []).append(chunk)
		for doc_key, doc_chunks in doc_groups.items():
			normalized_doc_key = relative_workspace_path(manager, doc_key)
			doc_token_count = sum(_safe_int(chunk.get("syntax_token_count")) for chunk in doc_chunks)
			by_source[normalized_doc_key] = _build_payload_for_chunks(
				doc_chunks,
				document_count=1,
				chunk_count=len(doc_chunks),
				token_count=doc_token_count,
			)
			doc_name = Path(normalized_doc_key).name.strip()
			if doc_name and doc_name not in by_source:
				by_source[doc_name] = by_source[normalized_doc_key]
	return by_source


def build_mode_outputs(manager: Any, state: dict[str, Any], processing_modes: list[dict[str, Any]]) -> dict[str, Any]:
	_ = processing_modes
	last_result = _as_dict(state.get("last_result"))
	index_result = _as_dict(last_result.get("index"))
	memify_result = _as_dict(last_result.get("memify"))
	quality_result = _as_dict(last_result.get("quality_loop"))
	pipeline_run = _as_dict(last_result.get("pipeline_run"))

	document_graph_artifacts, document_graph_count = resolve_document_graph_artifacts(manager, memify_result)

	fast_output = {
		"mode": "fast",
		"source": "indexed-preview",
		"summary_lines": [
			f"Documents: {_safe_int(index_result.get('document_count'))}",
			f"Chunks: {_safe_int(index_result.get('chunk_count'))}",
		],
		"artifacts": [],
	}

	nlp_artifacts = list(document_graph_artifacts)
	graph_path_text = str(memify_result.get("graph_path") or "").strip()
	if graph_path_text:
		nlp_artifacts.append({
			"kind": "graph",
			"label": "Graph",
			"path": relative_workspace_path(manager, graph_path_text),
		})
	nlp_output = {
		"mode": "nlp",
		"source": "graph-artifacts",
		"summary_lines": [f"Document graphify payloads: {document_graph_count}"],
		"artifacts": nlp_artifacts,
	}

	agentic_artifacts: list[dict[str, Any]] = []
	enriched_graph_path = str(
		quality_result.get("enriched_graph_path")
		or memify_result.get("enriched_graph_path")
		or getattr(manager._graph_ops, "enriched_graph_path", "")
		or ""
	).strip()
	quality_report_path = str(
		quality_result.get("enrichment_quality_report_path")
		or memify_result.get("enrichment_quality_report_path")
		or getattr(manager._graph_ops, "enrichment_quality_report_path", "")
		or ""
	).strip()
	if quality_report_path:
		agentic_artifacts.append({
			"kind": "quality_report",
			"label": "Quality report",
			"path": relative_workspace_path(manager, quality_report_path),
		})
	if enriched_graph_path:
		agentic_artifacts.append({
			"kind": "enriched_graph",
			"label": "Enriched graph",
			"path": relative_workspace_path(manager, enriched_graph_path),
		})
	if graph_path_text:
		agentic_artifacts.append({
			"kind": "graph",
			"label": "Graph",
			"path": relative_workspace_path(manager, graph_path_text),
		})
	agentic_output = {
		"mode": "agentic",
		"source": "pipeline-artifacts",
		"summary_lines": [f"Run: {str(pipeline_run.get('run_id') or '')}".strip()],
		"artifacts": agentic_artifacts,
	}

	return {
		"fast": fast_output,
		"nlp": nlp_output,
		"agentic": agentic_output,
	}


def build_global_metrics(
	manager: Any,
	state: dict[str, Any],
	*,
	mode_metrics: dict[str, Any],
	source_status: dict[str, Any] | None,
) -> dict[str, Any]:
	last_result = _as_dict(state.get("last_result"))
	pipeline_run = _as_dict(last_result.get("pipeline_run"))
	quality_loop = _as_dict(last_result.get("quality_loop"))
	agentic_rounds = quality_loop.get("rounds") if isinstance(quality_loop.get("rounds"), list) else []
	agentic_after = agentic_rounds[-1].get("after") if agentic_rounds and isinstance(agentic_rounds[-1], dict) else {}
	if str(state.get("status") or "").strip().lower() in manager._active_statuses and isinstance(state.get("processing_mode_overrides"), dict) and state.get("processing_mode_overrides"):
		return {
			"document_count": 0,
			"snapshot_count": 0,
			"chunk_count": 0,
			"sentence_count": 0,
			"char_count": 0,
			"token_count": 0,
		}
	pipeline_status = str(pipeline_run.get("status") or pipeline_run.get("run_status") or "").strip().lower()
	if pipeline_status in {"pending", "running"}:
		return {
			"document_count": 0,
			"snapshot_count": 0,
			"chunk_count": 0,
			"sentence_count": 0,
			"char_count": 0,
			"token_count": 0,
		}
	if pipeline_status == "succeeded" and not isinstance(agentic_after, dict):
		agentic_after = {}
	if pipeline_status == "succeeded" and not agentic_after:
		return {
			"document_count": 0,
			"snapshot_count": 0,
			"chunk_count": 0,
			"sentence_count": 0,
			"char_count": 0,
			"token_count": 0,
		}
	return build_l1_metrics(state, source_status)


def build_processing_modes(
	manager: Any,
	state: dict[str, Any],
	index_result: dict[str, Any],
	semantic_engine: dict[str, Any],
	l2_metrics: dict[str, Any],
) -> list[dict[str, Any]]:
	last_result = _as_dict(state.get("last_result"))
	pipeline_run = _as_dict(last_result.get("pipeline_run"))
	quality_loop = _as_dict(last_result.get("quality_loop"))
	semantic_status = str(semantic_engine.get("status") or "idle").strip().lower()
	semantic_summary = str(semantic_engine.get("summary") or "").strip()
	semantic_reason = str(semantic_engine.get("reason") or "").replace("HanLP sidecar", "HanLP sidecar")

	fast_ready = _safe_int(index_result.get("document_count")) > 0 or _safe_int(index_result.get("chunk_count")) > 0
	fast_mode = {
		"mode": "fast",
		"status": "ready" if fast_ready else "queued",
		"available": fast_ready,
		"summary": "L1 ready" if fast_ready else "L1 pending",
		"stage": "Indexed preview ready" if fast_ready else "Waiting for source indexing",
		"document_count": _safe_int(index_result.get("document_count")),
		"chunk_count": _safe_int(index_result.get("chunk_count")),
	}

	required_ready = all(
		_safe_int(l2_metrics.get(key)) > 0
		for key in ("tokenize_ready_chunk_count", "ner_ready_chunk_count", "syntax_ready_chunk_count")
	)
	nlp_mode = {
		"mode": "nlp",
		"status": "ready" if required_ready else "queued",
		"available": required_ready,
		"summary": "NLP ready" if required_ready else "Waiting for required NLP stages",
		"stage": "NLP extraction ready",
		"entity_count": _safe_int(l2_metrics.get("ner_entity_count")),
		"relation_count": _safe_int(l2_metrics.get("syntax_relation_count")),
		"progress": _safe_int(state.get("progress")),
	}
	if required_ready and not _safe_int(l2_metrics.get("cor_ready_chunk_count")) and str(l2_metrics.get("cor_reason_code") or "").strip():
		nlp_mode["stage"] = "NLP extraction ready · COR remains optional"

	agentic_rounds = quality_loop.get("rounds") if isinstance(quality_loop.get("rounds"), list) else []
	agentic_after = agentic_rounds[-1].get("after") if agentic_rounds and isinstance(agentic_rounds[-1], dict) else {}
	pipeline_status = str(pipeline_run.get("status") or pipeline_run.get("run_status") or "").strip().lower()
	agentic_mode = {
		"mode": "agentic",
		"status": "queued",
		"available": False,
		"summary": "Waiting for review stage",
		"stage": "Waiting for review stage",
		"entity_count": 0,
		"relation_count": 0,
		"quality_score": None,
	}
	if pipeline_status in {"pending", "running"}:
		agentic_mode.update({
			"status": "running",
			"summary": "Agentic pipeline in progress",
			"stage": "Building agentic outputs",
		})
	elif pipeline_status == "succeeded" and isinstance(agentic_after, dict) and agentic_after:
		agentic_mode.update({
			"status": "ready",
			"available": True,
			"summary": "Agentic pipeline ready",
			"stage": "Agentic outputs ready",
			"entity_count": _safe_int(agentic_after.get("entity_count")),
			"relation_count": _safe_int(agentic_after.get("relation_count")),
			"quality_score": _safe_float(agentic_after.get("quality_score") or quality_loop.get("score_after")),
		})
	elif pipeline_status == "succeeded":
		agentic_mode.update({
			"status": "queued",
			"available": False,
			"summary": "Waiting for review stage",
			"stage": "Waiting for review stage",
		})

	if _semantic_unavailable_blocks_nlp(semantic_engine):
		nlp_mode.update({
			"status": "blocked",
			"available": False,
			"summary": semantic_reason or semantic_summary,
		})
		agentic_mode.update({
			"status": "blocked",
			"available": False,
			"summary": semantic_reason or semantic_summary,
		})

	overrides = _as_dict(state.get("processing_mode_overrides"))
	for mode_name, payload in (("fast", fast_mode), ("nlp", nlp_mode), ("agentic", agentic_mode)):
		override = overrides.get(mode_name)
		if isinstance(override, dict):
			payload.update(override)

	return [fast_mode, nlp_mode, agentic_mode]


def build_output_resolution(processing_modes: list[dict[str, Any]], semantic_engine: dict[str, Any]) -> dict[str, Any]:
	mode_map = {str(item.get("mode") or ""): item for item in processing_modes if isinstance(item, dict)}
	semantic_status = str(semantic_engine.get("status") or "idle").strip().lower()
	if semantic_status in {"error", "unavailable"} and _semantic_unavailable_blocks_nlp(semantic_engine):
		return {
			"active_mode": None,
			"available_modes": [],
			"fallback_chain": [],
			"skipped_modes": [],
			"reason_code": "SEMANTIC_ENGINE_UNAVAILABLE",
		}
	agentic = mode_map.get("agentic") or {}
	nlp = mode_map.get("nlp") or {}
	fallback_chain = ["agentic", "nlp"]
	if bool(agentic.get("available")):
		return {
			"active_mode": "agentic",
			"available_modes": ["agentic"],
			"fallback_chain": fallback_chain,
			"skipped_modes": [],
			"reason_code": "AGENTIC_READY",
		}
	if bool(nlp.get("available")):
		return {
			"active_mode": "nlp",
			"available_modes": ["nlp"],
			"fallback_chain": fallback_chain,
			"skipped_modes": ["agentic"],
			"reason_code": "FALLBACK_TO_NLP",
		}
	return {
		"active_mode": "agentic",
		"available_modes": [],
		"fallback_chain": fallback_chain,
		"skipped_modes": [],
		"reason_code": "HIGH_ORDER_PENDING",
	}


def build_output_scheduler(processing_modes: list[dict[str, Any]]) -> dict[str, Any]:
	ready_modes = [str(item.get("mode") or "") for item in processing_modes if isinstance(item, dict) and str(item.get("status") or "") == "ready"]
	running_modes = [str(item.get("mode") or "") for item in processing_modes if isinstance(item, dict) and str(item.get("status") or "") == "running"]
	queued_modes = [str(item.get("mode") or "") for item in processing_modes if isinstance(item, dict) and str(item.get("status") or "") == "queued"]
	next_mode = None
	for candidate in ["agentic", "nlp", "fast"]:
		if candidate in running_modes or candidate in queued_modes:
			next_mode = candidate
			break
	return {
		"strategy": "parallel",
		"consumption_mode": "agentic",
		"ready_modes": ready_modes,
		"running_modes": running_modes,
		"queued_modes": queued_modes,
		"next_mode": next_mode,
	}


def build_mode_metrics(
	manager: Any,
	state: dict[str, Any],
	processing_modes: list[dict[str, Any]],
	mode_outputs: dict[str, Any],
	l1_metrics: dict[str, Any],
	l2_metrics: dict[str, Any],
	l3_metrics: dict[str, Any],
) -> dict[str, Any]:
	_ = processing_modes
	_ = l3_metrics
	latest_source_id = str(state.get("latest_source_id") or "").strip()
	sample_source_paths = collect_source_document_sample_paths(manager, latest_source_id) if latest_source_id else []
	last_result = _as_dict(state.get("last_result"))
	quality_loop = _as_dict(last_result.get("quality_loop"))
	memify_result = _as_dict(last_result.get("memify"))
	pipeline_run = _as_dict(last_result.get("pipeline_run"))

	fast_metrics = {
		"mode": "fast",
		"document_count": _safe_int(l1_metrics.get("document_count")),
		"chunk_count": _safe_int(l1_metrics.get("chunk_count")),
		"artifact_count": len(_as_dict(mode_outputs.get("fast")).get("artifacts") or []),
	}

	nlp_metrics = dict(l2_metrics)
	nlp_metrics.update({
		"mode": "nlp",
		"document_count": _safe_int(l1_metrics.get("document_count")),
		"chunk_count": _safe_int(l1_metrics.get("chunk_count")),
		"artifact_count": len(_as_dict(mode_outputs.get("nlp")).get("artifacts") or []),
		"evidence_paths": {},
		"evidence_bundles": {
			"document_count": {
				"metric_key": "document_count",
				"metric_kind": "aggregate",
				"sample_source_paths": sample_source_paths,
				"artifact_paths": sample_source_paths,
			},
			"tokenize_token_count": {
				"metric_key": "tokenize_token_count",
				"metric_kind": "aggregate",
				"sample_source_paths": sample_source_paths,
				"artifact_paths": sample_source_paths,
			},
		},
	})

	agentic_rounds = quality_loop.get("rounds") if isinstance(quality_loop.get("rounds"), list) else []
	agentic_after = agentic_rounds[-1].get("after") if agentic_rounds and isinstance(agentic_rounds[-1], dict) else {}
	pipeline_status = str(pipeline_run.get("status") or "").strip().lower()
	quality_report_path = str(
		quality_loop.get("enrichment_quality_report_path")
		or memify_result.get("enrichment_quality_report_path")
		or getattr(manager._graph_ops, "enrichment_quality_report_path", "")
		or ""
	).strip()
	enriched_graph_path = str(
		memify_result.get("enriched_graph_path")
		or getattr(manager._graph_ops, "enriched_graph_path", "")
		or ""
	).strip()
	graph_path = str(memify_result.get("graph_path") or "").strip()
	if pipeline_status == "succeeded":
		agentic_metrics = {
			"mode": "agentic",
			"document_count": _safe_int(l1_metrics.get("document_count")),
			"chunk_count": _safe_int(l1_metrics.get("chunk_count")),
			"entity_count": _safe_int(agentic_after.get("entity_count")),
			"relation_count": _safe_int(agentic_after.get("relation_count")),
			"quality_score": _safe_float(agentic_after.get("quality_score") or quality_loop.get("score_after")),
		}
	else:
		agentic_metrics = {
			"mode": "agentic",
			"document_count": _safe_int(l1_metrics.get("document_count")),
			"chunk_count": _safe_int(l1_metrics.get("chunk_count")),
			"entity_count": 0,
			"relation_count": 0,
			"quality_score": None,
		}
	agentic_metrics["evidence_paths"] = {
		"quality_score": relative_workspace_path(manager, quality_report_path),
		"audit_status": relative_workspace_path(manager, quality_report_path),
		"audit_focus": relative_workspace_path(manager, quality_report_path),
		"audit_round": relative_workspace_path(manager, quality_report_path),
		"enhancement_delta": relative_workspace_path(manager, quality_report_path),
		"entity_count": relative_workspace_path(manager, enriched_graph_path or graph_path),
		"relation_count": relative_workspace_path(manager, enriched_graph_path or graph_path),
	}
	agentic_metrics["evidence_bundles"] = {
		"quality_score": {
			"metric_key": "quality_score",
			"metric_kind": "derived",
			"source_count": len([item for item in [quality_report_path] if item]),
			"artifact_paths": [relative_workspace_path(manager, item) for item in [quality_report_path] if item],
		},
		"enhancement_delta": {
			"metric_key": "enhancement_delta",
			"metric_kind": "derived",
			"artifact_paths": [relative_workspace_path(manager, item) for item in [quality_report_path] if item],
			"formula": "quality_score_after - quality_score_before",
		},
	}

	return {"fast": fast_metrics, "nlp": nlp_metrics, "agentic": agentic_metrics}


def build_pipeline_trace(
	state: dict[str, Any],
	processing_modes: list[dict[str, Any]],
	mode_outputs: dict[str, Any],
	l1_metrics: dict[str, Any],
	l2_metrics: dict[str, Any],
	l3_metrics: dict[str, Any],
) -> dict[str, Any]:
	mode_map = {str(item.get("mode") or ""): item for item in processing_modes if isinstance(item, dict)}
	stage_defs = [
		("fast", "copaw.projects.knowledge.pipelineStage.fast", "L1 · Fast", l1_metrics),
		("nlp", "copaw.projects.knowledge.pipelineStage.nlp", "L2 · NLP", l2_metrics),
		("agentic", "copaw.projects.knowledge.pipelineStage.agentic", "L3 · Agentic", l3_metrics),
	]
	stages = []
	for mode, label_key, label, metrics in stage_defs:
		payload = mode_map.get(mode) or {}
		output = mode_outputs.get(mode) if isinstance(mode_outputs.get(mode), dict) else {}
		stages.append({
			"key": mode,
			"mode": mode,
			"label_key": label_key,
			"label": label,
			"status": str(payload.get("status") or "queued"),
			"available": bool(payload.get("available")),
			"summary": str(payload.get("summary") or ""),
			"metrics": dict(metrics or {}),
			"artifacts": list(_as_dict(output).get("artifacts") or []),
		})
	return {
		"source_id": str(state.get("latest_source_id") or "").strip(),
		"updated_at": str(state.get("updated_at") or "").strip() or None,
		"stages": stages,
	}


def resolve_index_result(state: dict[str, Any]) -> dict[str, Any]:
	last_result = _as_dict(state.get("last_result"))
	return dict(_as_dict(last_result.get("index")))


def hydrate_processing_view(manager: Any, state: dict[str, Any]) -> dict[str, Any]:
	payload = dict(state)
	project_id = str(payload.get("project_id") or "").strip()
	source_id = str(payload.get("latest_source_id") or "").strip()
	getter = getattr(manager._knowledge_manager, "get_source_status", None)
	source_status = {}
	if source_id and callable(getter):
		try:
			source_status = getter(source_id, lightweight=True)
		except TypeError:
			source_status = getter(source_id=source_id, lightweight=True)
		except Exception:
			source_status = {}
	if not isinstance(source_status, dict):
		source_status = {}
	file_analysis_stats: dict[str, Any] = {}
	file_stats_loader = getattr(manager._knowledge_manager, "load_project_step_stats", None)
	if project_id and callable(file_stats_loader):
		try:
			file_analysis_stats = file_stats_loader(project_id=project_id, step_id="file_analysis")
		except Exception:
			file_analysis_stats = {}
	if not isinstance(file_analysis_stats, dict):
		file_analysis_stats = {}
	source_status = _merge_file_analysis_l1_metrics(source_status, file_analysis_stats)
	l1_metrics = build_global_metrics(manager, payload, mode_metrics={}, source_status=source_status)
	index_result = resolve_index_result(payload)
	l2_metrics = build_l2_metrics(payload, index_result)
	semantic_engine = build_semantic_engine_state(manager, payload)
	processing_modes = build_processing_modes(manager, payload, index_result, semantic_engine, l2_metrics)
	nlp_progress = build_nlp_progress_view(manager, processing_modes, l2_metrics)
	runtime_nlp_progress = _as_dict(payload.get("nlp_progress"))
	if runtime_nlp_progress:
		nlp_progress = _merge_runtime_nlp_progress(nlp_progress, runtime_nlp_progress)
	mode_outputs = build_mode_outputs(manager, payload, processing_modes)
	mode_metrics = build_mode_metrics(manager, payload, processing_modes, mode_outputs, l1_metrics, l2_metrics, build_l3_metrics(payload))
	mode_metrics_by_source = build_mode_metrics_by_source(manager, payload, mode_metrics)
	global_metrics = build_global_metrics(manager, payload, mode_metrics=mode_metrics, source_status=source_status)
	output_resolution = build_output_resolution(processing_modes, semantic_engine)
	output_scheduler = build_output_scheduler(processing_modes)
	pipeline_trace = build_pipeline_trace(payload, processing_modes, mode_outputs, mode_metrics.get("fast") or {}, mode_metrics.get("nlp") or {}, mode_metrics.get("agentic") or {})
	payload.update({
		"file_analysis_stats": file_analysis_stats,
		"semantic_engine": semantic_engine,
		"processing_modes": processing_modes,
		"output_resolution": output_resolution,
		"output_scheduler": output_scheduler,
		"mode_outputs": mode_outputs,
		"mode_metrics": mode_metrics,
		"mode_metrics_by_source": mode_metrics_by_source,
		"global_metrics": global_metrics,
		"l1_metrics": l1_metrics,
		"l2_metrics": l2_metrics,
		"l3_metrics": build_l3_metrics(payload),
		"nlp_progress": nlp_progress,
		"pipeline_trace": pipeline_trace,
	})
	include_reason_code = str(payload.get("status") or "") == "pending"
	payload["stage_message"] = merge_stage_message_with_semantic_summary(
		manager,
		str(payload.get("stage_message") or ""),
		semantic_engine,
		include_reason_code=include_reason_code,
	)
	return payload


def build_nlp_progress_view(manager: Any, processing_modes: list[dict[str, Any]], l2_metrics: dict[str, Any]) -> dict[str, Any]:
	return build_nlp_progress(manager, processing_modes, l2_metrics)


__all__ = [
	"build_global_metrics",
	"build_mode_metrics",
	"build_mode_outputs",
	"build_nlp_progress_view",
	"build_output_resolution",
	"build_output_scheduler",
	"build_pipeline_trace",
	"build_processing_modes",
	"build_semantic_engine_state",
	"build_semantic_engine_summary",
	"collect_source_document_sample_paths",
	"hydrate_processing_view",
	"merge_stage_message_with_semantic_summary",
	"relative_workspace_path",
	"resolve_document_graph_artifacts",
	"resolve_index_result",
]