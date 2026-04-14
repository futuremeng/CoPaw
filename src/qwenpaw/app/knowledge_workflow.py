# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable

from fastapi import HTTPException

from copaw.knowledge import GraphOpsManager, KnowledgeManager
from copaw.knowledge.project_sync import DEFAULT_PROJECT_SYNC_QUALITY_LOOP_ROUNDS

from .builtin_agents import (
    BUILTIN_UNDERSTAND_DOMAIN_ANALYZER_ID,
    BUILTIN_UNDERSTAND_FILE_ANALYZER_ID,
    BUILTIN_UNDERSTAND_GRAPH_REVIEWER_ID,
    BUILTIN_UNDERSTAND_PROJECT_SCANNER_ID,
)
from .routers import agents as agents_router_impl
from .routers.agents_pipeline_core import (
    PipelineRunDetail,
    PipelineRunStep,
    PipelineTemplateInfo,
    PipelineTemplateStep,
    _append_collab_event,
    _persist_project_pipeline_run,
    _pipeline_now_iso,
)

KNOWLEDGE_WORKFLOW_TEMPLATE_ID = "builtin-knowledge-processing-v1"
KNOWLEDGE_WORKFLOW_TEMPLATE_NAME = "Knowledge Processing Workflow"
KNOWLEDGE_WORKFLOW_TEMPLATE_VERSION = "0.1.0"


def _lane_overrides(
    *,
    fast: dict[str, Any],
    nlp: dict[str, Any],
    agentic: dict[str, Any],
) -> dict[str, Any]:
    return {
        "processing_mode_overrides": {
            "fast": fast,
            "nlp": nlp,
            "agentic": agentic,
        }
    }


def _knowledge_workflow_steps() -> list[PipelineTemplateStep]:
    return [
        PipelineTemplateStep(
            id="source_scan",
            name="Source Scan",
            kind="analysis",
            description="Inventory project sources and confirm the project-scoped knowledge input boundary.",
        ),
        PipelineTemplateStep(
            id="file_analysis",
            name="File Analysis",
            kind="transform",
            description="Parse and index project files into the project-scoped knowledge store.",
        ),
        PipelineTemplateStep(
            id="domain_graph_build",
            name="Domain Graph Build",
            kind="transform",
            description="Build graph artifacts and domain-level enrichment from indexed project knowledge.",
        ),
        PipelineTemplateStep(
            id="quality_review",
            name="Quality Review",
            kind="validation",
            description="Review graph quality, run the quality loop when needed, and summarize next actions.",
        ),
    ]


def build_knowledge_workflow_template() -> PipelineTemplateInfo:
    return PipelineTemplateInfo(
        id=KNOWLEDGE_WORKFLOW_TEMPLATE_ID,
        name=KNOWLEDGE_WORKFLOW_TEMPLATE_NAME,
        version=KNOWLEDGE_WORKFLOW_TEMPLATE_VERSION,
        description=(
            "Builtin project-scoped workflow for knowledge indexing, graph building, "
            "and quality review."
        ),
        steps=_knowledge_workflow_steps(),
    )


def ensure_knowledge_workflow_template(project_dir: Path) -> PipelineTemplateInfo:
    template = build_knowledge_workflow_template()
    pipelines_dir = project_dir / "pipelines" / "templates"
    pipelines_dir.mkdir(parents=True, exist_ok=True)
    template_path = pipelines_dir / f"{template.id}.json"
    if not template_path.exists():
        template_payload = {
            **template.model_dump(mode="json"),
            "builtin_kind": "knowledge-processing",
            "system_owned": True,
            "entrypoint": "project-knowledge-panel",
        }
        template_path.write_text(
            json.dumps(template_payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return template


def _relative_to_project(project_dir: Path, target: Path) -> str:
    resolved_project = project_dir.resolve()
    resolved_target = target.resolve()
    try:
        return resolved_target.relative_to(resolved_project).as_posix()
    except ValueError:
        return resolved_target.name


def _project_metadata_candidates(project_dir: Path) -> list[str]:
    candidates = [
        project_dir / ".agent" / "PROJECT.md",
        project_dir / "PROJECT.md",
        project_dir / "README.md",
    ]
    paths: list[str] = []
    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            paths.append(_relative_to_project(project_dir, candidate))
    return paths


def _collect_project_data_files(project_dir: Path) -> list[str]:
    data_dir = project_dir / "data"
    if not data_dir.exists() or not data_dir.is_dir():
        return []
    return [
        _relative_to_project(project_dir, path)
        for path in sorted(data_dir.rglob("*"), key=lambda item: item.as_posix().lower())
        if path.is_file()
    ]


def _build_initial_run(
    *,
    project_id: str,
    source_id: str,
    trigger: str,
    changed_paths: list[str],
) -> PipelineRunDetail:
    now = _pipeline_now_iso()
    template = build_knowledge_workflow_template()
    run_id = f"run-{project_id}-knowledge-{int(time.time() * 1000)}"
    steps = [
        PipelineRunStep(
            id=step.id,
            name=step.name,
            kind=step.kind,
            description=step.description,
            status="pending",
            metrics={},
            evidence=[],
        )
        for step in template.steps
    ]
    return PipelineRunDetail(
        id=run_id,
        project_id=project_id,
        template_id=template.id,
        status="pending",
        created_at=now,
        updated_at=now,
        parameters={
            "workflow_kind": "knowledge-processing",
            "source_id": source_id,
            "trigger": trigger,
            "changed_paths": changed_paths,
        },
        steps=steps,
        artifacts=[],
        flow_version=template.version,
        focus_chat_id=None,
        focus_type="project_knowledge_workflow",
        focus_path=f"projects/{project_id}/knowledge",
    )


def _resolve_project_dir_with_fallback(workspace_dir: Path, project_id: str) -> Path:
    try:
        return agents_router_impl._resolve_project_dir(workspace_dir, project_id)
    except HTTPException:
        fallback = (workspace_dir / "projects" / project_id).resolve()
        if fallback.exists() and fallback.is_dir() and str(fallback).startswith(
            str((workspace_dir / "projects").resolve())
        ):
            return fallback
        raise


class KnowledgeWorkflowOrchestrator:
    def __init__(
        self,
        *,
        workspace_dir: Path | str,
        project_id: str,
        knowledge_dirname: str,
    ) -> None:
        self.workspace_dir = Path(workspace_dir).expanduser().resolve()
        self.project_id = (project_id or "").strip()
        self.knowledge_dirname = knowledge_dirname
        self.project_dir = _resolve_project_dir_with_fallback(
            self.workspace_dir,
            self.project_id,
        )
        self.knowledge_manager = KnowledgeManager(
            self.workspace_dir,
            knowledge_dirname=knowledge_dirname,
        )
        self.graph_ops = GraphOpsManager(
            self.workspace_dir,
            knowledge_dirname=knowledge_dirname,
        )
        self.template = ensure_knowledge_workflow_template(self.project_dir)

    def run(
        self,
        *,
        config,
        running_config: Any | None,
        source,
        trigger: str,
        changed_paths: list[str] | None = None,
        status_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        normalized_changed_paths = [
            str(item or "").strip().replace("\\", "/")
            for item in (changed_paths or [])
            if str(item or "").strip()
        ]
        run = _build_initial_run(
            project_id=self.project_id,
            source_id=source.id,
            trigger=(trigger or "manual").strip() or "manual",
            changed_paths=normalized_changed_paths,
        )
        self._append_run_event(
            run,
            event="workflow.started",
            actor="knowledge-workflow",
            status="running",
            message="Knowledge processing workflow started",
        )
        self._persist(run)

        index_result: dict[str, Any] | None = None
        memify_result: dict[str, Any] | None = None
        quality_loop_result: dict[str, Any] | None = None

        index_path = self.knowledge_manager._source_index_path(source.id)
        quality_report_path = self.graph_ops.enrichment_quality_report_path

        self._patch_step(
            run,
            "source_scan",
            actor=BUILTIN_UNDERSTAND_PROJECT_SCANNER_ID,
            status_callback=status_callback,
            sync_patch={
                "status": "pending",
                "stage": "pending",
                "stage_message": "Preparing knowledge workflow",
                "progress": 5,
                "current": 0,
                "total": 4,
                **_lane_overrides(
                    fast={
                        "status": "running",
                        "available": False,
                        "progress": 5,
                        "stage": "Scanning project sources",
                    },
                    nlp={
                        "status": "queued",
                        "available": False,
                        "stage": "Waiting for base index",
                    },
                    agentic={
                        "status": "queued",
                        "available": False,
                        "stage": "Waiting for structured artifacts",
                    },
                ),
            },
            completed_sync_patch={
                "status": "pending",
                "stage": "pending",
                "stage_message": "Knowledge sources scanned",
                "progress": 12,
                "current": 0,
                "total": 4,
                **_lane_overrides(
                    fast={
                        "status": "queued",
                        "available": False,
                        "stage": "Waiting for indexing",
                    },
                    nlp={
                        "status": "queued",
                        "available": False,
                        "stage": "Waiting for base index",
                    },
                    agentic={
                        "status": "queued",
                        "available": False,
                        "stage": "Waiting for structured artifacts",
                    },
                ),
            },
            executor=lambda step: self._execute_source_scan(
                source=source,
                changed_paths=normalized_changed_paths,
            ),
        )

        self._patch_step(
            run,
            "file_analysis",
            actor=BUILTIN_UNDERSTAND_FILE_ANALYZER_ID,
            status_callback=status_callback,
            sync_patch={
                "status": "indexing",
                "stage": "indexing",
                "stage_message": "Indexing project knowledge",
                "progress": 28,
                "current": 1,
                "total": 4,
                **_lane_overrides(
                    fast={
                        "status": "running",
                        "available": False,
                        "progress": 28,
                        "stage": "Building fast preview index",
                    },
                    nlp={
                        "status": "queued",
                        "available": False,
                        "stage": "Waiting for indexed content",
                    },
                    agentic={
                        "status": "queued",
                        "available": False,
                        "stage": "Waiting for indexed content",
                    },
                ),
            },
            completed_sync_patch={
                "status": "indexing",
                "stage": "indexing",
                "stage_message": "Fast preview ready",
                "progress": 40,
                "current": 1,
                "total": 4,
                **_lane_overrides(
                    fast={
                        "status": "ready",
                        "available": True,
                        "progress": 100,
                        "stage": "Fast preview ready",
                    },
                    nlp={
                        "status": "queued",
                        "available": False,
                        "stage": "Waiting for graph extraction",
                    },
                    agentic={
                        "status": "queued",
                        "available": False,
                        "stage": "Waiting for graph extraction",
                    },
                ),
            },
            executor=lambda step: self._execute_file_analysis(
                source=source,
                config=config,
                running_config=running_config,
                index_path=index_path,
            ),
        )
        index_result = dict(run.steps[1].metrics.get("result") or {})

        def _memify_progress(payload: dict[str, Any]) -> None:
            if status_callback is None:
                return
            raw_progress = payload.get("progress", payload.get("percent", 70))
            try:
                percent = int(float(raw_progress or 70))
            except (TypeError, ValueError):
                percent = 70
            status_callback(
                {
                    "status": "graphifying",
                    "stage": "graphifying",
                    "stage_message": str(payload.get("stage_message") or "Building project graph"),
                    "progress": max(35, min(90, percent)),
                    "current": 2,
                    "total": 4,
                    "eta_seconds": payload.get("eta_seconds") if isinstance(payload.get("eta_seconds"), (int, float)) else None,
                    **_lane_overrides(
                        fast={
                            "status": "ready",
                            "available": True,
                            "progress": 100,
                            "stage": "Fast preview ready",
                        },
                        nlp={
                            "status": "running",
                            "available": False,
                            "progress": max(35, min(90, percent)),
                            "stage": str(payload.get("stage_message") or "Building NLP artifacts"),
                        },
                        agentic={
                            "status": "queued",
                            "available": False,
                            "stage": "Waiting for review stage",
                        },
                    ),
                }
            )

        self._patch_step(
            run,
            "domain_graph_build",
            actor=BUILTIN_UNDERSTAND_DOMAIN_ANALYZER_ID,
            status_callback=status_callback,
            sync_patch={
                "status": "graphifying",
                "stage": "graphifying",
                "stage_message": "Building knowledge graph",
                "progress": 55,
                "current": 2,
                "total": 4,
                **_lane_overrides(
                    fast={
                        "status": "ready",
                        "available": True,
                        "progress": 100,
                        "stage": "Fast preview ready",
                    },
                    nlp={
                        "status": "running",
                        "available": False,
                        "progress": 55,
                        "stage": "Building NLP graph artifacts",
                    },
                    agentic={
                        "status": "queued",
                        "available": False,
                        "stage": "Waiting for review stage",
                    },
                ),
            },
            completed_sync_patch={
                "status": "graphifying",
                "stage": "graphifying",
                "stage_message": "NLP graph artifacts ready",
                "progress": 82,
                "current": 2,
                "total": 4,
                **_lane_overrides(
                    fast={
                        "status": "ready",
                        "available": True,
                        "progress": 100,
                        "stage": "Fast preview ready",
                    },
                    nlp={
                        "status": "ready",
                        "available": True,
                        "progress": 100,
                        "stage": "NLP graph artifacts ready",
                    },
                    agentic={
                        "status": "queued",
                        "available": False,
                        "stage": "Waiting for review stage",
                    },
                ),
            },
            executor=lambda step: self._execute_domain_graph_build(
                config=config,
                source=source,
                progress_callback=_memify_progress,
                quality_report_path=quality_report_path,
            ),
        )
        memify_result = dict(run.steps[2].metrics.get("result") or {})

        self._patch_step(
            run,
            "quality_review",
            actor=BUILTIN_UNDERSTAND_GRAPH_REVIEWER_ID,
            status_callback=status_callback,
            sync_patch={
                "status": "graphifying",
                "stage": "graphifying",
                "stage_message": "Reviewing graph quality",
                "progress": 88,
                "current": 3,
                "total": 4,
                **_lane_overrides(
                    fast={
                        "status": "ready",
                        "available": True,
                        "progress": 100,
                        "stage": "Fast preview ready",
                    },
                    nlp={
                        "status": "ready",
                        "available": True,
                        "progress": 100,
                        "stage": "NLP graph artifacts ready",
                    },
                    agentic={
                        "status": "running",
                        "available": False,
                        "progress": 88,
                        "stage": "Reviewing multi-agent outputs",
                    },
                ),
            },
            completed_sync_patch={
                "status": "graphifying",
                "stage": "graphifying",
                "stage_message": "Multi-agent outputs ready",
                "progress": 98,
                "current": 3,
                "total": 4,
                **_lane_overrides(
                    fast={
                        "status": "ready",
                        "available": True,
                        "progress": 100,
                        "stage": "Fast preview ready",
                    },
                    nlp={
                        "status": "ready",
                        "available": True,
                        "progress": 100,
                        "stage": "NLP graph artifacts ready",
                    },
                    agentic={
                        "status": "ready",
                        "available": True,
                        "progress": 100,
                        "stage": "Multi-agent outputs ready",
                    },
                ),
            },
            executor=lambda step: self._execute_quality_review(
                config=config,
                source=source,
                memify_result=memify_result,
                quality_report_path=quality_report_path,
            ),
        )
        quality_loop_result = dict(run.steps[3].metrics.get("result") or {})

        run.status = "succeeded"
        run.updated_at = _pipeline_now_iso()
        self._append_run_event(
            run,
            event="workflow.completed",
            actor="knowledge-workflow",
            status="succeeded",
            message="Knowledge processing workflow completed",
        )
        self._persist(run)

        processing_fingerprint = self.knowledge_manager.compute_processing_fingerprint(
            config,
            running_config,
        )
        return {
            "run_id": run.id,
            "run_status": run.status,
            "template_id": self.template.id,
            "processing_fingerprint": processing_fingerprint,
            "latest_job_id": str(
                quality_loop_result.get("job_id")
                or memify_result.get("job_id")
                or ""
            ).strip(),
            "index": index_result,
            "memify": memify_result,
            "quality_loop": quality_loop_result,
            "artifacts": run.artifacts[:],
        }

    def _persist(self, run: PipelineRunDetail) -> None:
        _persist_project_pipeline_run(self.project_dir, run, self.template)

    def _append_run_event(
        self,
        run: PipelineRunDetail,
        *,
        event: str,
        actor: str,
        status: str,
        message: str,
        step_id: str = "",
        evidence: list[str] | None = None,
        metrics: dict[str, Any] | None = None,
    ) -> None:
        _append_collab_event(
            run,
            event,
            step_id=step_id,
            role=step_id or "knowledge-workflow",
            actor=actor,
            status=status,
            message=message,
            evidence=evidence or [],
            metrics=metrics or {},
        )

    def _step_by_id(self, run: PipelineRunDetail, step_id: str) -> PipelineRunStep:
        for step in run.steps:
            if step.id == step_id:
                return step
        raise HTTPException(status_code=500, detail=f"Workflow step '{step_id}' missing")

    def _patch_step(
        self,
        run: PipelineRunDetail,
        step_id: str,
        *,
        actor: str,
        status_callback: Callable[[dict[str, Any]], None] | None,
        sync_patch: dict[str, Any],
        completed_sync_patch: dict[str, Any] | None = None,
        executor: Callable[[PipelineRunStep], dict[str, Any]],
    ) -> None:
        step = self._step_by_id(run, step_id)
        if status_callback is not None:
            status_callback(sync_patch)
        started_at = _pipeline_now_iso()
        step.status = "running"
        step.started_at = started_at
        step.ended_at = None
        run.status = "running"
        run.updated_at = started_at
        self._append_run_event(
            run,
            event="step.started",
            actor=actor,
            status="running",
            step_id=step.id,
            message=f"{step.name} started",
        )
        self._persist(run)
        try:
            result = executor(step)
            ended_at = _pipeline_now_iso()
            step.status = "succeeded"
            step.ended_at = ended_at
            step.metrics = {
                **step.metrics,
                **result.get("metrics", {}),
                "result": result.get("result", {}),
            }
            step.evidence = result.get("evidence", [])[:20]
            if result.get("artifacts"):
                merged_artifacts = list(dict.fromkeys([*run.artifacts, *result["artifacts"]]))
                run.artifacts = merged_artifacts[:200]
            run.updated_at = ended_at
            self._append_run_event(
                run,
                event="step.completed",
                actor=actor,
                status="succeeded",
                step_id=step.id,
                message=f"{step.name} completed",
                evidence=step.evidence[:5],
                metrics={key: value for key, value in step.metrics.items() if isinstance(value, (int, float, str, bool))},
            )
            self._persist(run)
            if status_callback is not None and completed_sync_patch is not None:
                status_callback(completed_sync_patch)
        except Exception as exc:
            ended_at = _pipeline_now_iso()
            step.status = "failed"
            step.ended_at = ended_at
            step.metrics = {
                **step.metrics,
                "error_count": 1,
            }
            step.evidence = [f"error:{type(exc).__name__}: {exc}"]
            run.status = "failed"
            run.updated_at = ended_at
            self._append_run_event(
                run,
                event="step.failed",
                actor=actor,
                status="failed",
                step_id=step.id,
                message=f"{step.name} failed: {exc}",
                evidence=step.evidence,
            )
            self._append_run_event(
                run,
                event="workflow.failed",
                actor="knowledge-workflow",
                status="failed",
                message="Knowledge processing workflow failed",
            )
            self._persist(run)
            raise

    def _execute_source_scan(
        self,
        *,
        source,
        changed_paths: list[str],
    ) -> dict[str, Any]:
        data_files = _collect_project_data_files(self.project_dir)
        evidence = _project_metadata_candidates(self.project_dir)
        if changed_paths:
            evidence.extend(changed_paths[:5])
        metrics = {
            "changed_path_count": len(changed_paths),
            "data_file_count": len(data_files),
            "source_count": 1,
        }
        result = {
            "source_id": source.id,
            "source_type": source.type,
            "source_location": source.location,
            "changed_paths": changed_paths,
            "data_files": data_files[:20],
        }
        return {
            "metrics": metrics,
            "result": result,
            "evidence": evidence or [".agent/PROJECT.md"],
            "artifacts": data_files[:20],
        }

    def _execute_file_analysis(
        self,
        *,
        source,
        config,
        running_config: Any | None,
        index_path: Path,
    ) -> dict[str, Any]:
        index_result = self.knowledge_manager.index_source(source, config, running_config)
        evidence = []
        artifacts = []
        if index_path.exists():
            rel_index = _relative_to_project(self.project_dir, index_path)
            evidence.append(rel_index)
            artifacts.append(rel_index)
        metrics = {
            "document_count": int(index_result.get("document_count") or 0),
            "chunk_count": int(index_result.get("chunk_count") or 0),
            "sentence_count": int(index_result.get("sentence_count") or 0),
        }
        return {
            "metrics": metrics,
            "result": index_result,
            "evidence": evidence or [source.location],
            "artifacts": artifacts,
        }

    def _execute_domain_graph_build(
        self,
        *,
        config,
        source,
        progress_callback: Callable[[dict[str, Any]], None] | None,
        quality_report_path: Path,
    ) -> dict[str, Any]:
        memify_result = self.graph_ops.execute_memify_once(
            config=config,
            pipeline_type="knowledge-processing-workflow",
            dataset_scope=[source.id],
            dry_run=False,
            progress_callback=progress_callback,
        )
        if str(memify_result.get("status") or "") != "succeeded":
            raise RuntimeError(str(memify_result.get("error") or "Knowledge graph build failed"))

        artifacts: list[str] = []
        evidence: list[str] = []
        for candidate in [
            self.graph_ops.local_graph_path,
            self.graph_ops.enriched_graph_path,
            quality_report_path,
        ]:
            if candidate.exists():
                rel_path = _relative_to_project(self.project_dir, candidate)
                evidence.append(rel_path)
                artifacts.append(rel_path)
        metrics = {
            "relation_count": int(memify_result.get("relation_count") or 0),
            "node_count": int(memify_result.get("node_count") or 0),
            "document_count": int(memify_result.get("document_count") or 0),
        }
        return {
            "metrics": metrics,
            "result": memify_result,
            "evidence": evidence,
            "artifacts": artifacts,
        }

    def _execute_quality_review(
        self,
        *,
        config,
        source,
        memify_result: dict[str, Any] | None,
        quality_report_path: Path,
    ) -> dict[str, Any]:
        quality_start = self.graph_ops.maybe_start_quality_self_drive(
            config=config,
            dataset_scope=[source.id],
            project_id=self.project_id,
            max_rounds=DEFAULT_PROJECT_SYNC_QUALITY_LOOP_ROUNDS,
            dry_run=False,
            baseline_result=memify_result,
        )

        quality_result = quality_start
        if bool(quality_start.get("accepted")):
            job_id = str(quality_start.get("job_id") or "").strip()
            deadline = time.monotonic() + 300.0
            while True:
                current = self.graph_ops.get_quality_loop_status(job_id) or {}
                status = str(current.get("status") or "").strip()
                if status in {"succeeded", "failed"}:
                    quality_result = current
                    break
                if time.monotonic() >= deadline:
                    raise TimeoutError("Quality review workflow timed out")
                time.sleep(0.2)

        status = str(quality_result.get("status") or "succeeded").strip()
        if status == "failed":
            raise RuntimeError(str(quality_result.get("error") or "Quality review failed"))

        artifacts: list[str] = []
        evidence: list[str] = []
        if quality_report_path.exists():
            rel_path = _relative_to_project(self.project_dir, quality_report_path)
            evidence.append(rel_path)
            artifacts.append(rel_path)

        reflection_artifacts = quality_result.get("reflection_artifacts")
        if isinstance(reflection_artifacts, dict):
            for value in reflection_artifacts.values():
                text = str(value or "").strip()
                if not text:
                    continue
                candidate = Path(text)
                if candidate.exists():
                    rel_path = _relative_to_project(self.project_dir, candidate)
                    evidence.append(rel_path)
                    artifacts.append(rel_path)

        metrics = {
            "quality_score_before": float(quality_result.get("score_before") or 0.0),
            "quality_score_after": float(quality_result.get("score_after") or quality_result.get("score_before") or 0.0),
            "quality_delta": float(quality_result.get("delta") or 0.0),
            "quality_rounds": len(quality_result.get("rounds") or []),
        }
        return {
            "metrics": metrics,
            "result": quality_result,
            "evidence": evidence,
            "artifacts": artifacts,
        }