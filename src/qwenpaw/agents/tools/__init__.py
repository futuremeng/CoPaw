# -*- coding: utf-8 -*-
"""Tool exports with lazy module loading to avoid circular imports."""
from __future__ import annotations

from importlib import import_module

from agentscope.tool import execute_python_code, view_text_file, write_text_file


_LAZY_EXPORTS: dict[str, tuple[str, str]] = {
    "read_file": (".file_io", "read_file"),
    "write_file": (".file_io", "write_file"),
    "edit_file": (".file_io", "edit_file"),
    "append_file": (".file_io", "append_file"),
    "grep_search": (".file_search", "grep_search"),
    "glob_search": (".file_search", "glob_search"),
    "execute_shell_command": (".shell", "execute_shell_command"),
    "send_file_to_user": (".send_file", "send_file_to_user"),
    "desktop_screenshot": (".desktop_screenshot", "desktop_screenshot"),
    "view_image": (".view_media", "view_image"),
    "view_video": (".view_media", "view_video"),
    "browser_use": (".browser_control", "browser_use"),
    "get_current_time": (".get_current_time", "get_current_time"),
    "set_user_timezone": (".get_current_time", "set_user_timezone"),
    "get_token_usage": (".get_token_usage", "get_token_usage"),
    "knowledge_search": (".knowledge_search", "knowledge_search"),
    "graph_query": (".graph_query", "graph_query"),
    "memify_run": (".memify_run", "memify_run"),
    "memify_status": (".memify_status", "memify_status"),
    "triplet_focus_search": (".triplet_focus_search", "triplet_focus_search"),
    "skill_market_search": (".skill_market_search", "skill_market_search"),
    "skill_market_install": (".skill_market_install", "skill_market_install"),
    "delegate_external_agent": (
        ".delegate_external_agent",
        "delegate_external_agent",
    ),
    "create_memory_search_tool": (".memory_search", "create_memory_search_tool"),
    "list_agents": (".agent_management", "list_agents"),
    "chat_with_agent": (".agent_management", "chat_with_agent"),
    "submit_to_agent": (".agent_management", "submit_to_agent"),
    "check_agent_task": (".agent_management", "check_agent_task"),
}


def __getattr__(name: str):
    target = _LAZY_EXPORTS.get(name)
    if target is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module_name, attr_name = target
    module = import_module(module_name, __name__)
    value = getattr(module, attr_name)
    globals()[name] = value
    return value

# Registered via react_agent's hardcoded tool_functions; kept out of
# __all__ so it's always enabled, not gated on agent config.
from .make_skill_tools import materialize_skill  # noqa: F401

__all__ = [
    "execute_python_code",
    "execute_shell_command",
    "view_text_file",
    "write_text_file",
    "read_file",
    "write_file",
    "edit_file",
    "append_file",
    "grep_search",
    "glob_search",
    "send_file_to_user",
    "desktop_screenshot",
    "view_image",
    "view_video",
    "browser_use",
    "get_current_time",
    "set_user_timezone",
    "get_token_usage",
    "knowledge_search",
    "graph_query",
    "memify_run",
    "memify_status",
    "triplet_focus_search",
    "skill_market_search",
    "skill_market_install",
    "delegate_external_agent",
    "create_memory_search_tool",
    "list_agents",
    "chat_with_agent",
    "submit_to_agent",
    "check_agent_task",
]
