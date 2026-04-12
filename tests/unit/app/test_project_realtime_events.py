# -*- coding: utf-8 -*-

from pathlib import Path

from copaw.app.project_realtime_events import (
    collect_project_realtime_changes,
    record_project_realtime_paths,
)


def test_record_project_realtime_paths_collects_unseen_changes(tmp_path: Path):
    workspace_dir = tmp_path
    project_dir = workspace_dir / "projects" / "project-a"
    target = project_dir / "original" / "note.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("hello", encoding="utf-8")

    record_project_realtime_paths(workspace_dir, [target])
    latest_event_id, changed_paths = collect_project_realtime_changes(
        project_dir,
        "project-a",
        0,
    )

    assert latest_event_id == 1
    assert changed_paths == ["original/note.md"]


def test_record_project_realtime_paths_ignores_non_project_files(tmp_path: Path):
    outside = tmp_path / "notes.txt"
    outside.write_text("hello", encoding="utf-8")

    record_project_realtime_paths(tmp_path, [outside])
    latest_event_id, changed_paths = collect_project_realtime_changes(
        tmp_path / "projects" / "project-a",
        "project-a",
        0,
    )

    assert latest_event_id == 0
    assert changed_paths == []