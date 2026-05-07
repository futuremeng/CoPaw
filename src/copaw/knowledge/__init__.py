# -*- coding: utf-8 -*-

from __future__ import annotations

from importlib import import_module
from typing import Any


_EXPORTS = {
	"KnowledgeManager": ("copaw.knowledge.manager", "KnowledgeManager"),
	"GraphOpsManager": ("copaw.knowledge.graph_ops", "GraphOpsManager"),
	"ProjectKnowledgeSyncManager": (
		"copaw.knowledge.project_sync",
		"ProjectKnowledgeSyncManager",
	),
	"QuantizationArchitectureManager": (
		"copaw.knowledge.architecture",
		"QuantizationArchitectureManager",
	),
	"RetrievalFacade": ("copaw.knowledge.facades", "RetrievalFacade"),
	"QuantizationFacade": ("copaw.knowledge.facades", "QuantizationFacade"),
}

__all__ = list(_EXPORTS)


def __getattr__(name: str) -> Any:
	if name not in _EXPORTS:
		raise AttributeError(name)
	module_name, attr_name = _EXPORTS[name]
	module = import_module(module_name)
	return getattr(module, attr_name)