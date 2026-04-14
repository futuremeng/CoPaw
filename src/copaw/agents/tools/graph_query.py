# -*- coding: utf-8 -*-
"""Compatibility wrapper for graph-oriented knowledge queries."""

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


def _resolve_graph_tool_context():
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


async def graph_query(
	query_text: str,
	query_mode: str = "template",
	output_mode: str = "",
	dataset_scope: list[str] | None = None,
	top_k: int = 10,
	timeout_sec: int = 20,
) -> ToolResponse:
	text = (query_text or "").strip()
	if not text:
		return ToolResponse(
			content=[TextBlock(type="text", text="Error: query_text cannot be empty.")],
		)

	mode = (query_mode or "template").strip().lower()
	if mode not in {"template", "cypher"}:
		return ToolResponse(
			content=[TextBlock(type="text", text="Error: query_mode must be 'template' or 'cypher'.")],
		)

	preferred_output_mode = (output_mode or "").strip().lower()
	if preferred_output_mode and preferred_output_mode not in {"fast", "nlp", "agentic"}:
		return ToolResponse(
			content=[TextBlock(type="text", text="Error: output_mode must be 'fast', 'nlp', or 'agentic'.")],
		)

	config, running, workspace_dir = _resolve_graph_tool_context()
	if not getattr(config, "knowledge", None) or not config.knowledge.enabled:
		return ToolResponse(
			content=[TextBlock(type="text", text="Error: knowledge is disabled in configuration.")],
		)
	if not bool(getattr(running, "knowledge_enabled", True)):
		return ToolResponse(
			content=[TextBlock(type="text", text="Error: knowledge is disabled in agent runtime configuration.")],
		)
	if not bool(getattr(config.knowledge, "graph_query_enabled", False)):
		return ToolResponse(
			content=[TextBlock(type="text", text="Error: graph query is disabled in configuration.")],
		)
	if mode == "cypher" and not bool(getattr(config.knowledge, "allow_cypher_query", False)):
		return ToolResponse(
			content=[TextBlock(type="text", text="Error: cypher query is not allowed by configuration.")],
		)

	try:
		manager = GraphOpsManager(workspace_dir)
		result = manager.graph_query(
			config=config.knowledge,
			query_mode=mode,
			query_text=text,
			dataset_scope=dataset_scope,
			project_scope=None,
			include_global=True,
			top_k=max(1, int(top_k)),
			timeout_sec=max(1, min(int(timeout_sec), 120)),
			preferred_output_mode=preferred_output_mode or None,
		)
		payload = {
			"records": result.records,
			"summary": result.summary,
			"provenance": result.provenance,
			"warnings": result.warnings,
		}
		return ToolResponse(
			content=[TextBlock(type="text", text=json.dumps(payload, ensure_ascii=False, indent=2))],
		)
	except Exception as exc:
		return ToolResponse(
			content=[TextBlock(type="text", text=f"Error: graph query failed due to\n{exc}")],
		)