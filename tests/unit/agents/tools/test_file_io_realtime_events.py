# -*- coding: utf-8 -*-

from pathlib import Path

import pytest

from copaw.agents.tools import file_io
from copaw.app.project_realtime_events import collect_project_realtime_changes
from copaw.config.context import set_current_focus_dir, set_current_workspace_dir


@pytest.mark.asyncio
async def test_write_file_records_project_realtime_event(tmp_path: Path):
    workspace_dir = tmp_path
    project_dir = workspace_dir / "projects" / "project-a"
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "original").mkdir(parents=True, exist_ok=True)

    set_current_workspace_dir(workspace_dir)
    set_current_focus_dir(project_dir)
    try:
        response = await file_io.write_file("original/note.md", "hello")
    finally:
        set_current_focus_dir(None)
        set_current_workspace_dir(None)

    text = response.content[0].get("text", "") if response.content else ""
    latest_event_id, changed_paths = collect_project_realtime_changes(
        project_dir,
        "project-a",
        0,
    )

    assert text.startswith("Wrote")
    assert latest_event_id == 1
    assert changed_paths == ["original/note.md"]