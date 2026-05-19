# -*- coding: utf-8 -*-

from pathlib import Path

from qwenpaw.app.project_file_query import query_project_file_records


def _write(path: Path, content: str = "x") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_query_project_file_records_classifies_and_counts(tmp_path: Path):
    project_dir = tmp_path / "projects" / "project-a"
    _write(project_dir / "original" / "note.md", "hello")
    _write(project_dir / "output" / "result.json", '{"ok": true}')
    _write(project_dir / "intermediate" / "steps.txt", "mid")
    _write(project_dir / ".agent" / "PROJECT.md", "meta")
    _write(project_dir / ".DS_Store", "ignore me")

    payload = query_project_file_records(project_dir)
    summary = payload["summary"]
    items = payload["items"]

    assert summary["total_matched"] == 4
    assert summary["ignored_count"] == 0
    assert summary["stage_counts"]["original"] == 1
    assert summary["stage_counts"]["intermediate"] == 1
    assert summary["stage_counts"]["artifact"] == 1
    assert summary["stage_counts"]["builtin"] == 1
    assert any(item["path"] == "original/note.md" and item["content_type"] == "markdown" for item in items)


def test_query_project_file_records_supports_filters_and_sort(tmp_path: Path):
    project_dir = tmp_path / "projects" / "project-a"
    _write(project_dir / "original" / "a.txt", "a")
    _write(project_dir / "original" / "b.md", "b")
    _write(project_dir / "output" / "c.json", "{}")

    payload = query_project_file_records(
        project_dir,
        stages=["original"],
        content_types=["markdown", "text"],
        sort_by="path",
        sort_order="desc",
    )

    assert payload["summary"]["total_matched"] == 2
    assert [item["path"] for item in payload["items"]] == [
        "original/b.md",
        "original/a.txt",
    ]


def test_query_project_file_records_supports_pagination(tmp_path: Path):
    project_dir = tmp_path / "projects" / "project-a"
    for index in range(5):
        _write(project_dir / "original" / f"note-{index}.txt", str(index))

    payload = query_project_file_records(
        project_dir,
        sort_by="path",
        sort_order="asc",
        offset=1,
        limit=2,
    )

    assert payload["summary"]["total_matched"] == 5
    assert payload["summary"]["returned"] == 2
    assert [item["path"] for item in payload["items"]] == [
        "original/note-1.txt",
        "original/note-2.txt",
    ]
