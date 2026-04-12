# -*- coding: utf-8 -*-

from pathlib import Path

from copaw.app.project_realtime_events import (
    collect_project_realtime_changes,
    record_project_realtime_paths,
)
from copaw.app.routers.agents_pipeline_core import (
    PipelineRunDetail,
    PipelineRunStep,
    PlatformFlowTemplateInfo,
    PipelineTemplateInfo,
    PipelineTemplateStep,
    _import_platform_template_to_project,
    _persist_project_pipeline_run,
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


def test_persist_project_pipeline_run_records_manifest_changes(tmp_path: Path):
    project_dir = tmp_path / "projects" / "project-a"
    project_dir.mkdir(parents=True, exist_ok=True)
    template = PipelineTemplateInfo(
        id="pipeline-a",
        name="Pipeline A",
        version="0.1.0",
        steps=[
            PipelineTemplateStep(
                id="step-1",
                name="Step 1",
                kind="ingest",
            )
        ],
    )
    run = PipelineRunDetail(
        id="run-1",
        template_id="pipeline-a",
        project_id="project-a",
        status="succeeded",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:01Z",
        steps=[
            PipelineRunStep(
                id="step-1",
                name="Step 1",
                kind="ingest",
                status="succeeded",
                started_at="2026-01-01T00:00:00Z",
                ended_at="2026-01-01T00:00:01Z",
            )
        ],
    )

    _persist_project_pipeline_run(project_dir, run, template)

    latest_event_id, changed_paths = collect_project_realtime_changes(
        project_dir,
        "project-a",
        0,
    )

    assert latest_event_id == 1
    assert "pipelines/runs/run-1/run_manifest.json" in changed_paths
    assert "pipelines/runs/run-1/steps/step-1/artifact_manifest.json" in changed_paths
    assert "pipelines/runs/run-1/steps/step-1/metric_pack.json" in changed_paths


def test_import_platform_template_to_project_records_template_change(tmp_path: Path):
    project_dir = tmp_path / "projects" / "project-a"
    project_dir.mkdir(parents=True, exist_ok=True)
    template = PlatformFlowTemplateInfo(
        id="platform-a",
        name="Platform A",
        version="0.2.0",
        description="importable template",
        steps=[
            PipelineTemplateStep(
                id="step-1",
                name="Step 1",
                kind="ingest",
            )
        ],
    )

    imported = _import_platform_template_to_project(
        "project-a",
        project_dir,
        template,
        target_template_id="instance-a",
    )

    latest_event_id, changed_paths = collect_project_realtime_changes(
        project_dir,
        "project-a",
        0,
    )

    assert imported.id == "instance-a"
    assert latest_event_id == 1
    assert "pipelines/templates/instance-a.json" in changed_paths