# -*- coding: utf-8 -*-

from __future__ import annotations

from typing import Any


def _safe_int(value: Any) -> int:
	try:
		return int(value)
	except (TypeError, ValueError):
		return 0


def _clamp_0_1(value: float) -> float:
	return max(0.0, min(1.0, value))


def _as_dict(value: Any) -> dict[str, Any]:
	if isinstance(value, dict):
		return value
	return {}


def build_l2_quantization_scorecard(state: dict[str, Any]) -> dict[str, Any]:
	raw_l2_metrics = state.get("l2_metrics")
	raw_nlp_progress = state.get("nlp_progress")
	l2_metrics = _as_dict(raw_l2_metrics)
	nlp_progress = _as_dict(raw_nlp_progress)
	stages = _as_dict(nlp_progress.get("stages"))
	data_warnings: list[str] = []
	if not isinstance(raw_l2_metrics, dict):
		data_warnings.append("missing_or_invalid_l2_metrics")
	if not isinstance(raw_nlp_progress, dict):
		data_warnings.append("missing_or_invalid_nlp_progress")

	total_chunks_raw = _safe_int(l2_metrics.get("total_chunks"))
	total_chunks = max(total_chunks_raw, 0)
	has_valid_total_chunks = total_chunks > 0
	if not has_valid_total_chunks:
		data_warnings.append("invalid_total_chunks")

	total_denominator = max(total_chunks, 1)
	ner_ready = _safe_int(l2_metrics.get("ner_ready_chunk_count"))
	syntax_ready = _safe_int(l2_metrics.get("syntax_ready_chunk_count"))
	cor_ready = _safe_int(l2_metrics.get("cor_ready_chunk_count"))
	entity_count = _safe_int(l2_metrics.get("ner_entity_count"))
	relation_count = _safe_int(l2_metrics.get("syntax_relation_count"))
	token_count = _safe_int(l2_metrics.get("syntax_token_count"))

	coverage_ner = _clamp_0_1(ner_ready / total_denominator) if has_valid_total_chunks else 0.0
	coverage_syntax = _clamp_0_1(syntax_ready / total_denominator) if has_valid_total_chunks else 0.0
	coverage_cor = _clamp_0_1(cor_ready / total_denominator) if has_valid_total_chunks else 0.0
	coverage_l2_core = (coverage_ner + coverage_syntax) / 2.0

	entity_density = (entity_count / total_denominator) if has_valid_total_chunks else 0.0
	relation_density = relation_count / max(token_count, 1)

	quality_proxy = _clamp_0_1((min(entity_density / 3.0, 1.0) + min(relation_density / 0.35, 1.0)) / 2.0)

	cor_stage = _as_dict(stages.get("cor"))
	cor_status = str(cor_stage.get("status") or "")
	cor_reason_code = str(cor_stage.get("reason_code") or "")
	degrade_flags: list[str] = []
	if not has_valid_total_chunks:
		degrade_flags.append("invalid_total_chunks")
	if cor_status == "unavailable":
		degrade_flags.append("cor_unavailable")
	if cor_reason_code:
		degrade_flags.append(f"cor_reason:{cor_reason_code}")

	return {
		"total_chunks": total_chunks,
		"coverage": {
			"ner": round(coverage_ner, 4),
			"syntax": round(coverage_syntax, 4),
			"cor": round(coverage_cor, 4),
			"l2_core": round(coverage_l2_core, 4),
		},
		"counts": {
			"entity_count": entity_count,
			"relation_count": relation_count,
			"token_count": token_count,
		},
		"density": {
			"entity_per_chunk": round(entity_density, 4),
			"relation_per_token": round(relation_density, 4),
		},
		"quality_proxy": round(quality_proxy, 4),
		"degrade_flags": degrade_flags,
		"data_warnings": data_warnings,
	}


def derive_l2_quantization_risk_labels(
	scorecard: dict[str, Any] | None,
	probes: dict[str, Any] | None,
) -> list[str]:
	labels: list[str] = []
	if not isinstance(scorecard, dict):
		return ["missing_state_metrics"]

	coverage = _as_dict(scorecard.get("coverage"))
	l2_core = float(coverage.get("l2_core") or 0.0)
	quality_proxy = float(scorecard.get("quality_proxy") or 0.0)
	degrade_flags = scorecard.get("degrade_flags") if isinstance(scorecard.get("degrade_flags"), list) else []
	data_warnings = scorecard.get("data_warnings") if isinstance(scorecard.get("data_warnings"), list) else []

	if l2_core < 0.60:
		labels.append("coverage_low")
	if quality_proxy < 0.40:
		labels.append("quality_proxy_low")
	if degrade_flags:
		labels.append("degrade_present")
	if data_warnings:
		labels.append("state_schema_warning")

	if isinstance(probes, dict):
		probe_success = float(probes.get("success_ratio") or 0.0)
		probe_p95 = _safe_int(probes.get("p95_duration_ms"))
		raw_rows = probes.get("rows")
		rows: list[dict[str, Any]] = raw_rows if isinstance(raw_rows, list) else []
		timeout_runs = 0
		total_runs = 0
		for row in rows:
			if not isinstance(row, dict):
				continue
			total_runs += 1
			if str(row.get("reason_code") or "") == "NLP_PROBE_TIMEOUT":
				timeout_runs += 1

		if probe_success < 0.75:
			labels.append("probe_unstable")
		if probe_p95 >= 5000:
			labels.append("latency_high")
		if total_runs > 0 and (timeout_runs / total_runs) >= 0.20:
			labels.append("probe_timeout_spike")

	return labels


def grade_l2_quantization_assessment(
	scorecard: dict[str, Any] | None,
	probes: dict[str, Any] | None,
	*,
	threshold_a: float,
	threshold_b: float,
	threshold_c: float,
) -> dict[str, Any]:
	if not isinstance(scorecard, dict):
		return {
			"grade": "N/A",
			"score": 0.0,
			"risk_score": 1.0,
			"risk_labels": ["missing_state_metrics"],
			"reasons": ["No L2 state metrics available (probe-only or missing state)."],
			"recommendations": [
				"Run project knowledge pipeline first to generate L2 metrics.",
				"Then rerun assess-l2 with --project-id or --state-file.",
			],
		}

	coverage = _as_dict(scorecard.get("coverage"))
	l2_core = float(coverage.get("l2_core") or 0.0)
	quality_proxy = float(scorecard.get("quality_proxy") or 0.0)
	degrade_flags = scorecard.get("degrade_flags") if isinstance(scorecard.get("degrade_flags"), list) else []
	data_warnings = scorecard.get("data_warnings") if isinstance(scorecard.get("data_warnings"), list) else []
	degrade_penalty = 0.2 if degrade_flags else 0.0

	has_probe_metrics = isinstance(probes, dict)
	probe_success = 0.0
	probe_p95 = 0
	if has_probe_metrics:
		probe_success = float(probes.get("success_ratio") or 0.0)
		probe_p95 = _safe_int(probes.get("p95_duration_ms"))

	weighted_score_numerator = 0.45 * l2_core + 0.30 * quality_proxy
	weighted_score_denominator = 0.75
	if has_probe_metrics:
		weighted_score_numerator += 0.25 * probe_success
		weighted_score_denominator += 0.25

	score = _clamp_0_1((weighted_score_numerator / max(weighted_score_denominator, 1e-6)) - degrade_penalty)

	if score >= threshold_a:
		grade = "A"
	elif score >= threshold_b:
		grade = "B"
	elif score >= threshold_c:
		grade = "C"
	else:
		grade = "D"

	risk_score = _clamp_0_1(1.0 - score)
	if degrade_flags:
		risk_score = _clamp_0_1(risk_score + 0.15)
	if has_probe_metrics and probe_success < 0.5:
		risk_score = _clamp_0_1(risk_score + 0.10)

	risk_labels = derive_l2_quantization_risk_labels(scorecard, probes)

	reasons: list[str] = [
		f"l2_core_coverage={l2_core:.4f}",
		f"quality_proxy={quality_proxy:.4f}",
	]
	if has_probe_metrics:
		reasons.append(f"probe_success_ratio={probe_success:.4f}")
	else:
		reasons.append("probe_success_ratio=skipped(no-run-probes)")
	if degrade_flags:
		reasons.append(f"degrade_flags={','.join(str(x) for x in degrade_flags)}")
	if data_warnings:
		reasons.append(f"data_warnings={','.join(str(x) for x in data_warnings)}")
	if probe_p95 > 0:
		reasons.append(f"probe_p95_duration_ms={probe_p95}")

	recommendations: list[str] = []
	if l2_core < 0.80:
		recommendations.append("Increase NER/Syntax ready chunk coverage in L2 pipeline.")
	if quality_proxy < 0.55:
		recommendations.append("Improve entity/relation density quality controls and extraction prompts.")
	if has_probe_metrics and probe_success < 0.75:
		recommendations.append("Investigate NLP task availability/timeouts (sidecar/model cache/runtime).")
	if has_probe_metrics and probe_p95 >= 5000:
		recommendations.append("Optimize probe latency (preload models and reduce cold starts).")
	if not has_probe_metrics:
		recommendations.append("Run with probes enabled to include runtime readiness in grade.")
	if degrade_flags:
		recommendations.append("Make degradation visible in L2 metrics and add fallback diagnostics.")
	if not recommendations:
		recommendations.append("Maintain current L2 baseline and monitor trend weekly.")

	return {
		"grade": grade,
		"score": round(score, 4),
		"risk_score": round(risk_score, 4),
		"risk_labels": risk_labels,
		"reasons": reasons,
		"recommendations": recommendations,
		"thresholds": {
			"A": threshold_a,
			"B": threshold_b,
			"C": threshold_c,
		},
	}


def summarize_l2_quantization_risk_label_hits(items: list[dict[str, Any]]) -> dict[str, int]:
	counts: dict[str, int] = {}
	for item in items:
		if not isinstance(item, dict):
			continue
		grade = _as_dict(item.get("grade"))
		raw_labels = grade.get("risk_labels")
		labels: list[Any] = raw_labels if isinstance(raw_labels, list) else []
		seen: set[str] = set()
		for label in labels:
			label_key = str(label or "").strip()
			if not label_key or label_key in seen:
				continue
			seen.add(label_key)
			counts[label_key] = int(counts.get(label_key, 0)) + 1
	return dict(sorted(counts.items(), key=lambda x: (-int(x[1]), str(x[0]))))


def normalize_l2_quantization_grade_thresholds(
	threshold_a: float,
	threshold_b: float,
	threshold_c: float,
) -> tuple[float, float, float]:
	a = _clamp_0_1(float(threshold_a))
	b = _clamp_0_1(float(threshold_b))
	c = _clamp_0_1(float(threshold_c))
	if not (a > b > c):
		raise ValueError("Invalid grade thresholds: require A > B > C and each in [0, 1].")
	return a, b, c


def sort_l2_quantization_assessment_items(
	items: list[dict[str, Any]],
	*,
	sort_by: str,
) -> list[dict[str, Any]]:
	if sort_by == "project_id":
		return sorted(items, key=lambda x: str(x.get("project_id") or ""))
	if sort_by == "score":
		return sorted(
			items,
			key=lambda x: float(_as_dict(x.get("grade")).get("score") or 0),
			reverse=True,
		)
	return sorted(
		items,
		key=lambda x: float(_as_dict(x.get("grade")).get("risk_score") or 0),
		reverse=True,
	)