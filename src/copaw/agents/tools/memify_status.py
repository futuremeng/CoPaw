# -*- coding: utf-8 -*-
"""Compatibility wrapper for memify status queries."""

from __future__ import annotations

import json
import time
from pathlib import Path

from agentscope.message import TextBlock
from agentscope.tool import ToolResponse

from ...config import load_config
from ...config.config import load_agent_config
from ...config.context import get_current_workspace_dir
from ...constant import WORKING_DIR
from ...knowledge.graph_ops import GraphOpsManager


def _resolve_memify_tool_context():
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


async def memify_status(job_id: str) -> ToolResponse:
	normalized_job_id = (job_id or "").strip()
	if not normalized_job_id:
		return ToolResponse(content=[TextBlock(type="text", text="Error: job_id cannot be empty.")])

	config, running, workspace_dir = _resolve_memify_tool_context()
	if not getattr(config, "knowledge", None) or not config.knowledge.enabled:
		return ToolResponse(content=[TextBlock(type="text", text="Error: knowledge is disabled in configuration.")])
	if not bool(getattr(running, "knowledge_enabled", True)):
		return ToolResponse(content=[TextBlock(type="text", text="Error: knowledge is disabled in agent runtime configuration.")])
	if not bool(getattr(config.knowledge, "memify_enabled", False)):
		return ToolResponse(content=[TextBlock(type="text", text="Error: memify is disabled in configuration.")])

	try:
		manager = GraphOpsManager(workspace_dir)
		result = manager.get_memify_status(normalized_job_id)
		for _ in range(10):
			if result is None or str(result.get("status") or "").strip().lower() in {"succeeded", "failed"}:
				break
			time.sleep(0.05)
			result = manager.get_memify_status(normalized_job_id)
		if result is None:
			return ToolResponse(content=[TextBlock(type="text", text="Error: memify job not found.")])
		return ToolResponse(
			content=[TextBlock(type="text", text=json.dumps(result, ensure_ascii=False, indent=2))],
		)
	except Exception as exc:
		return ToolResponse(content=[TextBlock(type="text", text=f"Error: memify status failed due to\n{exc}")])