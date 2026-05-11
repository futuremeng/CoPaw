# -*- coding: utf-8 -*-

from __future__ import annotations

from pathlib import Path
from typing import Any

from .knowledge_quantization_architecture import QuantizationArchitectureManager


class QuantizationFacade:
	"""B-lane facade: staged quantization (L1/L2/L3) only."""

	def __init__(self, project_root: Path | str, knowledge_dirname: str = ".knowledge"):
		self._manager = QuantizationArchitectureManager(
			project_root,
			knowledge_dirname=knowledge_dirname,
		)

	def run_stage(
		self,
		*,
		stage: str,
		source_id: str,
		snapshot_id: str,
		metrics: dict[str, Any] | None = None,
		metadata: dict[str, Any] | None = None,
	) -> dict[str, Any]:
		return self._manager.write_stage_result(
			stage=stage,
			source_id=source_id,
			snapshot_id=snapshot_id,
			metrics=metrics,
			metadata=metadata,
		)

	def get_stage_stats(
		self,
		*,
		stage: str,
		source_id: str,
		snapshot_id: str,
	) -> dict[str, Any] | None:
		return self._manager.get_stage_result(
			stage=stage,
			source_id=source_id,
			snapshot_id=snapshot_id,
		)

	def list_stage_stats(
		self,
		*,
		stage: str,
		source_id: str | None = None,
		limit: int = 50,
	) -> dict[str, Any]:
		items = self._manager.list_stage_results(
			stage=stage,
			source_id=source_id,
			limit=limit,
		)
		return {
			"items": items,
			"count": len(items),
		}

	def compare_stages(self, *, source_id: str, snapshot_id: str) -> dict[str, Any]:
		return self._manager.compare_stages(
			source_id=source_id,
			snapshot_id=snapshot_id,
		)

	def compare_versions(
		self,
		*,
		source_id: str,
		snapshot_a: str,
		snapshot_b: str,
		stage: str,
	) -> dict[str, Any]:
		return self._manager.compare_versions(
			source_id=source_id,
			snapshot_a=snapshot_a,
			snapshot_b=snapshot_b,
			stage=stage,
		)

	def compare_sources(
		self,
		*,
		source_a: str,
		source_b: str,
		stage: str,
		snapshot_id: str | None = None,
	) -> dict[str, Any]:
		return self._manager.compare_sources(
			source_a=source_a,
			source_b=source_b,
			stage=stage,
			snapshot_id=snapshot_id,
		)