# -*- coding: utf-8 -*-
"""Compatibility bridge for knowledge modules.

The fork keeps the active implementation under ``copaw.knowledge`` while
upstream-renamed modules import from ``qwenpaw.knowledge``.
"""

from copaw.knowledge import (
	GraphOpsManager,
	KnowledgeManager,
	ProjectKnowledgeSyncManager,
	QuantizationFacade,
)
from copaw.knowledge.hanlp_runtime import HanLPSidecarRuntime

__all__ = [
	"KnowledgeManager",
	"GraphOpsManager",
	"ProjectKnowledgeSyncManager",
	"QuantizationFacade",
	"HanLPSidecarRuntime",
]