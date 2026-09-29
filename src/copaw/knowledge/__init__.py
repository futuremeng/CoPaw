# -*- coding: utf-8 -*-

from __future__ import annotations

from importlib import import_module
from typing import Any


_EXPORTS = {
	"KnowledgeManager": ("copaw.knowledge.manager", "KnowledgeManager"),
	"GraphOpsManager": ("copaw.knowledge.graph_ops", "GraphOpsManager"),
	"ProjectKnowledgePipelineManager": (
		"qwenpaw.knowledge.project_pipeline_manager",
		"ProjectKnowledgePipelineManager",
	),
	"QuantizationArchitectureManager": (
		"qwenpaw.knowledge.knowledge_quantization_architecture",
		"QuantizationArchitectureManager",
	),
	"RetrievalFacade": ("copaw.knowledge.facades", "RetrievalFacade"),
	"QuantizationFacade": ("qwenpaw.knowledge.knowledge_quantization_facade", "QuantizationFacade"),
	"DuckDBKnowledgeCatalog": ("copaw.knowledge.duckdb_catalog", "DuckDBKnowledgeCatalog"),
	"build_l2_quantization_scorecard": (
		"qwenpaw.knowledge.knowledge_quantization_assessment",
		"build_l2_quantization_scorecard",
	),
	"grade_l2_quantization_assessment": (
		"qwenpaw.knowledge.knowledge_quantization_assessment",
		"grade_l2_quantization_assessment",
	),
	"summarize_l2_quantization_risk_label_hits": (
		"qwenpaw.knowledge.knowledge_quantization_assessment",
		"summarize_l2_quantization_risk_label_hits",
	),
	"normalize_l2_quantization_grade_thresholds": (
		"qwenpaw.knowledge.knowledge_quantization_assessment",
		"normalize_l2_quantization_grade_thresholds",
	),
	"sort_l2_quantization_assessment_items": (
		"qwenpaw.knowledge.knowledge_quantization_assessment",
		"sort_l2_quantization_assessment_items",
	),
}

__all__ = list(_EXPORTS)


def __getattr__(name: str) -> Any:
	if name not in _EXPORTS:
		raise AttributeError(name)
	module_name, attr_name = _EXPORTS[name]
	module = import_module(module_name)
	return getattr(module, attr_name)