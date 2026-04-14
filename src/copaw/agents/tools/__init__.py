# -*- coding: utf-8 -*-

from __future__ import annotations

from importlib import import_module
from typing import Any

_TOOL_EXPORTS = {
	"execute_python_code": ("agentscope.tool", "execute_python_code"),
	"execute_shell_command": ("qwenpaw.agents.tools.shell", "execute_shell_command"),
	"view_text_file": ("agentscope.tool", "view_text_file"),
	"write_text_file": ("agentscope.tool", "write_text_file"),
	"read_file": ("qwenpaw.agents.tools.file_io", "read_file"),
	"write_file": ("qwenpaw.agents.tools.file_io", "write_file"),
	"edit_file": ("qwenpaw.agents.tools.file_io", "edit_file"),
	"append_file": ("qwenpaw.agents.tools.file_io", "append_file"),
	"grep_search": ("qwenpaw.agents.tools.file_search", "grep_search"),
	"glob_search": ("qwenpaw.agents.tools.file_search", "glob_search"),
	"send_file_to_user": ("qwenpaw.agents.tools.send_file", "send_file_to_user"),
	"desktop_screenshot": ("qwenpaw.agents.tools.desktop_screenshot", "desktop_screenshot"),
	"view_image": ("qwenpaw.agents.tools.view_media", "view_image"),
	"view_video": ("qwenpaw.agents.tools.view_media", "view_video"),
	"browser_use": ("qwenpaw.agents.tools.browser_control", "browser_use"),
	"create_memory_search_tool": ("qwenpaw.agents.tools.memory_search", "create_memory_search_tool"),
	"get_current_time": ("qwenpaw.agents.tools.get_current_time", "get_current_time"),
	"set_user_timezone": ("qwenpaw.agents.tools.get_current_time", "set_user_timezone"),
	"get_token_usage": ("qwenpaw.agents.tools.get_token_usage", "get_token_usage"),
	"knowledge_search": ("qwenpaw.agents.tools.knowledge_search", "knowledge_search"),
	"graph_query": ("qwenpaw.agents.tools.graph_query", "graph_query"),
	"memify_run": ("qwenpaw.agents.tools.memify_run", "memify_run"),
	"memify_status": ("qwenpaw.agents.tools.memify_status", "memify_status"),
	"triplet_focus_search": ("qwenpaw.agents.tools.triplet_focus_search", "triplet_focus_search"),
	"skill_market_search": ("qwenpaw.agents.tools.skill_market_search", "skill_market_search"),
	"skill_market_install": ("qwenpaw.agents.tools.skill_market_install", "skill_market_install"),
}

__all__ = list(_TOOL_EXPORTS)


def __getattr__(name: str) -> Any:
	if name not in _TOOL_EXPORTS:
		raise AttributeError(name)
	module_name, attr_name = _TOOL_EXPORTS[name]
	module = import_module(module_name)
	return getattr(module, attr_name)