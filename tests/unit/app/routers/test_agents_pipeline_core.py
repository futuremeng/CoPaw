# -*- coding: utf-8 -*-

import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from qwenpaw.app.routers.agents_pipeline_core import (
    CreatePipelineRunRequest,
    PipelineRunDetail,
    PipelineRunStep,
    PipelineTemplateInfo,
    PipelineTemplateStep,
    _create_project_pipeline_run,
    _append_collab_event,
    _apply_real_step_results,
    _execute_project_pipeline_run,
    _get_pipeline_draft,
    _import_platform_template_to_project,
    _list_platform_flow_templates,
    _pipeline_flow_memory_path,
    _pipeline_md_path,
    _parse_pipeline_template_doc,
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
    assert "builtin-knowledge-processing-v1" in ids
    assert "agent-knowledge-aggregation-v1" in ids

    project_knowledge = next(
        item for item in templates if item.id == "builtin-knowledge-processing-v1"
    )
    assert [step.id for step in project_knowledge.steps] == [
        "snapshot_raw",
        "build_chunks",
        "build_interlinear",
        "tokenize",
        "pos_tagging",
        "syntax_parse",
        "semantic_role_labeling",
    ]


def test_parse_builtin_project_template_enforces_canonical_steps_even_if_local_doc_drifts():
    drifted_doc = {
        "id": "builtin-knowledge-processing-v1",
        "name": "Project Knowledge Pipeline",
        "version": "2.0.0",
        "description": "drifted",
        "steps": [
            {"id": "snapshot_raw", "name": "Raw Snapshot", "kind": "ingest"},
            {"id": "build_chunks", "name": "Build Chunks", "kind": "transform"},
            # Legacy nodes should be dropped by canonical enforcement.
            {"id": "source_scan", "name": "Source Scan", "kind": "analysis"},
            {"id": "file_analysis", "name": "File Analysis", "kind": "analysis"},
            {"id": "domain_graph_build", "name": "Domain Graph Build", "kind": "analysis"},
            {"id": "quality_review", "name": "Quality Review", "kind": "review"},
        ],
    }

    parsed = _parse_pipeline_template_doc(drifted_doc, fallback_id="builtin-knowledge-processing-v1")

    assert parsed is not None
    assert [step.id for step in parsed.steps] == [
        "snapshot_raw",
        "build_chunks",
        "build_interlinear",
        "tokenize",
        "pos_tagging",
        "syntax_parse",
        "semantic_role_labeling",
    ]
    parsed_step_ids = {step.id for step in parsed.steps}
    assert "source_scan" not in parsed_step_ids
    assert "file_analysis" not in parsed_step_ids
    assert "domain_graph_build" not in parsed_step_ids
    assert "quality_review" not in parsed_step_ids


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


def test_create_project_knowledge_pipeline_run_triggers_sync_helper(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    project_id = "project-knowledge"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    # Seed minimal knowledge artifacts so 7 canonical steps can collect outputs.
    for _step in ("snapshot_raw", "build_chunks", "build_interlinear", "tokenize",
                   "pos_tagging", "syntax_parse", "semantic_role_labeling"):
        _sdir = project_dir / ".knowledge" / "stats" / _step
        _sdir.mkdir(parents=True, exist_ok=True)
        (_sdir / "latest.json").write_text("{}\n", encoding="utf-8")
    (project_dir / ".knowledge" / "sources" / "project-source").mkdir(parents=True, exist_ok=True)
    (project_dir / ".knowledge" / "sources" / "project-source" / "index.json").write_text("{}\n", encoding="utf-8")
    (project_dir / ".knowledge" / "graphify-out").mkdir(parents=True, exist_ok=True)
    (project_dir / ".knowledge" / "graphify-out" / "graph.json").write_text("{}\n", encoding="utf-8")
    (project_dir / ".knowledge" / "graphify-out" / "graph.enriched.json").write_text("{}\n", encoding="utf-8")
    (project_dir / ".knowledge" / "graphify-out" / "enrichment-quality-report.json").write_text("{}\n", encoding="utf-8")

    platform_templates = _list_platform_flow_templates(tmp_path)
    project_knowledge_template = next(
        item for item in platform_templates if item.id == "builtin-knowledge-processing-v1"
    )
    _import_platform_template_to_project(
        project_id,
        project_dir,
        project_knowledge_template,
        target_template_id="builtin-knowledge-processing-v1",
    )

    called: dict[str, object] = {}

    def _fake_sync_helper(*, project_id: str, project_dir: Path, parameters: dict[str, object]):
        called["project_id"] = project_id
        called["project_dir"] = project_dir
        called["parameters"] = dict(parameters)
        return {
            "status": "succeeded",
            "current_stage": "quality_review",
            "progress": 100,
            "updated_at": "2026-01-01T00:00:00Z",
            "last_error": "",
        }

    monkeypatch.setattr(
        "qwenpaw.app.routers.agents_pipeline_core._run_builtin_project_knowledge_sync",
        _fake_sync_helper,
    )

    run = _create_project_pipeline_run(
        project_id,
        project_dir,
        CreatePipelineRunRequest(
            template_id="builtin-knowledge-processing-v1",
            parameters={"processing_mode": "agentic"},
        ),
    )

    assert called["project_id"] == project_id
    assert called["project_dir"] == project_dir
    assert called["parameters"] == {"processing_mode": "agentic"}
    assert run.status == "succeeded"
    assert run.parameters.get("knowledge_sync_snapshot") == {
        "status": "succeeded",
        "current_stage": "quality_review",
        "progress": 100,
        "updated_at": "2026-01-01T00:00:00Z",
        "last_error": None,
    }
    assert [step.id for step in run.steps] == [
        "snapshot_raw",
        "build_chunks",
        "build_interlinear",
        "tokenize",
        "pos_tagging",
        "syntax_parse",
        "semantic_role_labeling",
    ]


def test_status_transition_guards_reject_invalid_transitions():
    with pytest.raises(ValueError):
        _transition_run_status("succeeded", "running")

    with pytest.raises(ValueError):
        _transition_step_status("succeeded", "running")

    def test_build_run_observability_aggregates_rpa_metrics():
        run = PipelineRunDetail(
            id="run-rpa-obs",
            project_id="project-rpa",
            template_id="tpl-rpa",
            status="succeeded",
            created_at="2026-01-01T00:00:00Z",
            updated_at="2026-01-01T00:00:10Z",
            parameters={},
            artifacts=["browser/rpa/ebook/page-001.png"],
            steps=[
                PipelineRunStep(
                    id="step-1",
                    name="Open",
                    kind="task",
                    status="succeeded",
                    metrics={
                        "rpa_runtime": True,
                        "rpa_actions_executed": 3,
                        "rpa_stop_condition_failures": 1,
                        "rpa_action_duration_ms_total": 120.5,
                        "rpa_action_count_by_kind": {
                            "browser.open": 1,
                            "browser.screenshot": 2,
                        },
                    },
                    evidence=[],
                ),
                PipelineRunStep(
                    id="step-2",
                    name="Validate",
                    kind="validation",
                    status="succeeded",
                    metrics={},
                    evidence=[],
                ),
            ],
            flow_version="0.1.0",
        )

        observability = _build_run_observability(run)
        assert observability.rpa_runtime_steps == 1
        assert observability.rpa_actions_executed == 3
        assert observability.rpa_stop_condition_failures == 1
        assert observability.rpa_action_duration_ms_total == 120.5
        assert observability.rpa_action_count_by_kind["browser.open"] == 1
        assert observability.rpa_action_count_by_kind["browser.screenshot"] == 2

def test_apply_real_step_results_rpa_runtime_branch(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    project_dir = tmp_path / "project-rpa"
    project_dir.mkdir(parents=True, exist_ok=True)

    calls: list[tuple[str, dict]] = []

    def _fake_invoke(action: str, **kwargs):
        calls.append((action, kwargs))
        if action == "screenshot":
            path = Path(str(kwargs["path"]))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fake", encoding="utf-8")
        return {"ok": True}

    monkeypatch.setattr("qwenpaw.rpa.runtime.invoke_browser_use", _fake_invoke)

    step = PipelineRunStep(
        id="capture-pages",
        name="Capture Pages",
        kind="task",
        script="rpa:flow.loop",
        inputs={
            "screenshot_dir": "browser/rpa/ebook",
            "page_prefix": "page",
            "__rpa_loop__": {
                "mode": "range",
                "iterator": "page_index",
                "start": 1,
                "end": "{{page_total}}",
                "actions": [
                    {
                        "kind": "browser.screenshot",
                        "path": "{{screenshot_dir}}/{{page_prefix}}-{{page_index:03d}}.png",
                    }
                ],
            },
        },
        status="running",
        metrics={},
        evidence=[],
    )

    outputs = _apply_real_step_results(
        project_dir=project_dir,
        template_id="rpa-demo",
        step=step,
        run_parameters={"page_total": 2},
    )

    assert len(outputs) == 2
    assert outputs[0].endswith("page-001.png")
    assert step.metrics.get("rpa_runtime") is True
    assert step.metrics.get("rpa_loop_iterations") == 2
    assert step.metrics.get("warning_count") == 0
    assert calls and calls[0][0] == "screenshot"
