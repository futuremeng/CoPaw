# -*- coding: utf-8 -*-
"""Compatibility wrapper for triplet-focused graph retrieval."""

from __future__ import annotations

import json
from pathlib import Path

from agentscope.message import TextBlock
from agentscope.tool import ToolResponse

from ...config import load_config
from ...config.config import load_agent_config
from ...config.context import get_current_workspace_dir
from ...constant import WORKING_DIR
from ...knowledge.graph_ops import GraphOpsManager


def _resolve_triplet_tool_context():
	config = load_config()
	agents = getattr(config, "agents", None)
	running = getattr(agents, "running", None)
	workspace_dir = WORKING_DIR if agents is None else (get_current_workspace_dir() or WORKING_DIR)
	workspace_path = Path(workspace_dir).expanduser().resolve()
	try:
		for agent_id, profile in ((getattr(agents, "profiles", None) or {}).items()):
			profile_path = Path(profile.workspace_dir).expanduser().resolve()
			if profile_path == workspace_path:
				agent_config = load_agent_config(agent_id)
				running = agent_config.running
				break
	except Exception:
		pass
	return config, running, workspace_dir


async def triplet_focus_search(
	subject: str = "",
	predicate: str = "",
	object_text: str = "",
	query_text: str = "",
	dataset_scope: list[str] | None = None,
	top_k: int = 10,
	expand_hops: int = 1,
) -> ToolResponse:
	s = (subject or "").strip()
	p = (predicate or "").strip()
	o = (object_text or "").strip()
	q = (query_text or "").strip()

	if not any([s, p, o, q]):
		return ToolResponse(
			content=[TextBlock(type="text", text="Error: at least one of subject/predicate/object_text/query_text is required.")],
		)

	config, running, workspace_dir = _resolve_triplet_tool_context()
	if not getattr(config, "knowledge", None) or not config.knowledge.enabled:
		return ToolResponse(content=[TextBlock(type="text", text="Error: knowledge is disabled in configuration.")])
	if not bool(getattr(running, "knowledge_enabled", True)):
		return ToolResponse(content=[TextBlock(type="text", text="Error: knowledge is disabled in agent runtime configuration.")])
	if not bool(getattr(config.knowledge, "triplet_search_enabled", False)):
		return ToolResponse(content=[TextBlock(type="text", text="Error: triplet-focused search is disabled in configuration.")])

	effective_query = q or " ".join(item for item in [s, p, o] if item)
	try:
		manager = GraphOpsManager(workspace_dir)
		base = manager.graph_query(
			config=config.knowledge,
			query_mode="template",
			query_text=effective_query,
			dataset_scope=dataset_scope,
			project_scope=None,
			include_global=True,
			top_k=max(1, int(top_k)),
			timeout_sec=20,
		)

		filtered_records: list[dict] = []
		for record in base.records:
			rs = str(record.get("subject") or "")
			rp = str(record.get("predicate") or "")
			ro = str(record.get("object") or "")
			if s and s.lower() not in rs.lower():
				continue
			if p and p.lower() not in rp.lower():
				continue
			if o and o.lower() not in ro.lower():
				continue
			filtered_records.append(record)

		payload = {
			"triplets": [
				{
					"subject": item.get("subject"),
					"predicate": item.get("predicate"),
					"object": item.get("object"),
				}
				for item in filtered_records
			],
			"evidence": [
				{
					"source_id": item.get("source_id"),
					"source_type": item.get("source_type"),
					"document_path": item.get("document_path"),
					"document_title": item.get("document_title"),
				}
				for item in filtered_records
			],
			"scores": [float(item.get("score", 0) or 0) for item in filtered_records],
			"context_summary": f"Found {len(filtered_records)} triplets (expand_hops={max(1, int(expand_hops))}).",
			"warnings": base.warnings,
		}
		return ToolResponse(
			content=[TextBlock(type="text", text=json.dumps(payload, ensure_ascii=False, indent=2))],
		)
	except Exception as exc:
		return ToolResponse(content=[TextBlock(type="text", text=f"Error: triplet-focused search failed due to\n{exc}")])