# -*- coding: utf-8 -*-

import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from qwenpaw.app.routers.agents_pipeline_core import (
    PipelineRunDetail,
    PipelineRunStep,
    PipelineTemplateInfo,
    PipelineTemplateStep,
    _append_collab_event,
    _execute_project_pipeline_run,
    _get_pipeline_draft,
    _list_platform_flow_templates,
    _pipeline_flow_memory_path,
    _pipeline_md_path,
    _save_agent_pipeline_template_with_md,
    _transition_run_status,
    _transition_step_status,
)


def _build_template(template_id: str = "demo-pipeline") -> PipelineTemplateInfo:
    return PipelineTemplateInfo(
        id=template_id,
        name="Demo Pipeline",
        version="0.1.0",
        description="Demo flow",
        steps=[
            PipelineTemplateStep(
                id="step-1",
                name="Collect",
                kind="ingest",
                description="collect source",
                prompt="Collect source inputs and normalize them.",
            ),
            PipelineTemplateStep(
                id="step-2",
                name="Validate",
                kind="validation",
                description="check schema",
                prompt="Validate schema and report mismatches.",
            ),
        ],
    )


def _read_template_json(workspace_dir: Path, template_id: str) -> dict:
    json_path = workspace_dir / "pipelines" / "templates" / f"{template_id}.json"
    return json.loads(json_path.read_text(encoding="utf-8"))


def test_save_template_bootstraps_markdown_and_flow_memory(tmp_path: Path):
    saved = _save_agent_pipeline_template_with_md(tmp_path, _build_template())

    md_path = _pipeline_md_path(tmp_path, saved.id)
    flow_memory_path = _pipeline_flow_memory_path(tmp_path, saved.id)

    assert md_path.exists()
    assert flow_memory_path.exists()
    assert saved.revision == 1
    assert saved.content_hash

    draft = _get_pipeline_draft(tmp_path, saved.id)
    assert draft is not None
    assert draft.flow_memory_relative_path.endswith("flow-memory.md")
    assert len(draft.steps) == 2


def test_save_template_is_idempotent_for_same_markdown(tmp_path: Path):
    first = _save_agent_pipeline_template_with_md(tmp_path, _build_template())
    second = _save_agent_pipeline_template_with_md(
        tmp_path,
        _build_template(),
        expected_revision=first.revision,
    )

    assert second.revision == first.revision
    assert second.content_hash == first.content_hash


def test_save_template_detects_revision_conflict(tmp_path: Path):
    first = _save_agent_pipeline_template_with_md(tmp_path, _build_template())

    with pytest.raises(HTTPException) as exc_info:
        _save_agent_pipeline_template_with_md(
            tmp_path,
            _build_template(),
            expected_revision=first.revision + 1,
        )

    assert exc_info.value.status_code == 409
    detail = exc_info.value.detail
    assert isinstance(detail, dict)
    assert detail.get("code") == "pipeline_revision_conflict"


def test_save_template_validation_failure_keeps_previous_json(tmp_path: Path):
    initial = _save_agent_pipeline_template_with_md(tmp_path, _build_template())
    before_doc = _read_template_json(tmp_path, initial.id)

    md_path = _pipeline_md_path(tmp_path, initial.id)
    md_path.write_text(
        "---\n"
        f"pipeline_id: {initial.id}\n"
        "name: Broken\n"
        "version: 0.1.0\n"
        "---\n\n"
        "# Broken\n\n"
        "No step headings here.\n",
        encoding="utf-8",
    )

    with pytest.raises(HTTPException) as exc_info:
        _save_agent_pipeline_template_with_md(
            tmp_path,
            _build_template(),
            expected_revision=initial.revision,
        )

    assert exc_info.value.status_code == 422
    detail = exc_info.value.detail
    assert isinstance(detail, dict)
    assert detail.get("code") == "pipeline_md_validation_failed"
    errors = detail.get("errors") or []
    assert isinstance(errors, list)
    assert errors

    after_doc = _read_template_json(tmp_path, initial.id)
    assert after_doc == before_doc


def test_save_template_rejects_non_semver_version_in_markdown(tmp_path: Path):
    initial = _save_agent_pipeline_template_with_md(tmp_path, _build_template())

    md_path = _pipeline_md_path(tmp_path, initial.id)
    content = md_path.read_text(encoding="utf-8")
    md_path.write_text(content.replace("version: 0.1.0", "version: v1", 1), encoding="utf-8")

    with pytest.raises(HTTPException) as exc_info:
        _save_agent_pipeline_template_with_md(
            tmp_path,
            _build_template(),
            expected_revision=initial.revision,
        )

    assert exc_info.value.status_code == 422
    detail = exc_info.value.detail
    assert isinstance(detail, dict)
    errors = detail.get("errors") or []
    assert any(item.get("error_code") == "pipeline_version_invalid" for item in errors)


def test_list_platform_flow_templates_includes_builtin_project_knowledge_template(tmp_path: Path):
    templates = _list_platform_flow_templates(tmp_path)

    ids = {item.id for item in templates}
    assert "builtin-project-knowledge-pipeline-v1" in ids
    assert "agent-knowledge-aggregation-v1" in ids


def test_append_collab_event_uses_canonical_event_and_observability_fields():
    run = PipelineRunDetail(
        id="run-1",
        project_id="project-1",
        template_id="demo-pipeline",
        status="running",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
        parameters={},
        steps=[],
        artifacts=[],
        flow_version="0.1.0",
    )

    _append_collab_event(
        run,
        "run.started",
        status="running",
        message="start",
    )

    assert len(run.collaboration_events) == 1
    event = run.collaboration_events[0]
    assert event.event == "run_started"
    assert event.metrics.get("event_version") == "1.0"
    assert event.metrics.get("event_sequence") == 1
    assert event.metrics.get("event_schema") == "pipeline_event.v1"
    assert event.metrics.get("legacy_event") == "run.started"


def test_execute_project_pipeline_run_emits_standardized_events(tmp_path: Path):
    project_dir = tmp_path / "project-a"
    project_dir.mkdir(parents=True, exist_ok=True)
    data_dir = project_dir / ".data"
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "sample.md").write_text("# sample\n", encoding="utf-8")

    template = PipelineTemplateInfo(
        id="demo-pipeline",
        name="Demo Pipeline",
        version="0.1.0",
        description="demo",
        steps=[
            PipelineTemplateStep(
                id="step-1",
                name="Collect",
                kind="ingest",
                description="collect",
                prompt="collect source",
            ),
        ],
    )

    run = PipelineRunDetail(
        id="run-demo",
        project_id="project-a",
        template_id="demo-pipeline",
        status="running",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
        parameters={},
        steps=[
            PipelineRunStep(
                id="step-1",
                name="Collect",
                kind="ingest",
                description="collect",
                status="pending",
                metrics={},
                evidence=[],
            ),
        ],
        artifacts=[],
        flow_version="0.1.0",
    )

    executed = _execute_project_pipeline_run(project_dir, run, template)

    assert executed.status == "succeeded"
    assert executed.steps[0].status == "succeeded"
    assert "duration_sec" in executed.steps[0].metrics
    event_names = [item.event for item in executed.collaboration_events]
    assert "run_started" in event_names
    assert "step_started" in event_names
    assert "step_progress" in event_names
    assert "step_finished" in event_names
    assert "run_finished" in event_names
    assert all("." not in item for item in event_names)

    observability = executed.observability
    assert observability.step_total == 1
    assert observability.step_succeeded == 1
    assert observability.step_failed == 0
    assert observability.step_running == 0
    assert observability.duration_sec >= 0
    assert observability.stage


def test_status_transition_guards_reject_invalid_transitions():
    with pytest.raises(ValueError):
        _transition_run_status("succeeded", "running")

    with pytest.raises(ValueError):
        _transition_step_status("succeeded", "running")
