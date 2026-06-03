# -*- coding: utf-8 -*-
"""Project context utilities for multi-project agent support.

Loads project-level configuration files (``.agent/PROJECT.md``,
``.agent/AGENTS.md``) from the project directory and formats them as
system-prompt-compatible text blocks for injection into the agent's
system prompt.

Project directory layout (under agent workspace):
    ``workspace_dir/projects/<project_id>/``
        .agent/
            AGENTS.md   — project-level agent instructions (optional)
            PROJECT.md  — project description, goals, constraints (optional)
"""

import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Files to load for project context, in order
_PROJECT_CONTEXT_FILES = [
    "PROJECT.md",
    "AGENTS.md",
]


def _read_file_safe(filepath: Path) -> Optional[str]:
    """Read a file's content, returning ``None`` on any error."""
    try:
        if not filepath.exists():
            return None
        content = filepath.read_text(encoding="utf-8", errors="replace").strip()
        return content if content else None
    except OSError as e:
        logger.warning("Failed to read project context file %s: %s", filepath, e)
        return None


def load_project_context_blocks(
    workspace_dir: Path,
    project_id: str,
) -> list[dict]:
    """Load project-level context files and return as message blocks.

    Reads ``.agent/PROJECT.md`` and ``.agent/AGENTS.md`` from
    ``workspace_dir/projects/<project_id>/`` and returns them as
    system-prompt message blocks that can be prepended to the
    messages list.

    Args:
        workspace_dir: Agent's workspace directory.
        project_id: The project identifier (subdirectory name under
            ``projects/``).

    Returns:
        List of message blocks, each with ``"role": "system"`` and
        ``"content"``.  Empty list if no project context files exist.
    """
    project_dir = workspace_dir / "projects" / project_id
    agent_dir = project_dir / ".agent"

    if not agent_dir.is_dir():
        logger.debug(
            "No .agent directory for project %s at %s", project_id, agent_dir,
        )
        return []

    blocks: list[dict] = []
    for filename in _PROJECT_CONTEXT_FILES:
        filepath = agent_dir / filename
        content = _read_file_safe(filepath)
        if content is None:
            continue

        blocks.append({
            "role": "system",
            "content": (
                f"=== PROJECT CONTEXT: {filename} (Project: {project_id}) ===\n"
                f"{content}"
            ),
        })
        logger.info(
            "Loaded project context: %s for project %s (%d chars)",
            filename, project_id, len(content),
        )

    return blocks


def build_project_system_prompt_suffix(
    workspace_dir: Path,
    project_id: str,
) -> str:
    """Build a system-prompt suffix string from project context files.

    This is a convenience wrapper around ``load_project_context_blocks``
    that returns a single concatenated string suitable for appending to
    the agent's system prompt.

    Args:
        workspace_dir: Agent's workspace directory.
        project_id: The project identifier.

    Returns:
        Concatenated system prompt suffix, or empty string if no project
        context exists.
    """
    blocks = load_project_context_blocks(workspace_dir, project_id)
    if not blocks:
        return ""

    parts = [block["content"] for block in blocks]
    return "\n\n".join(parts)
