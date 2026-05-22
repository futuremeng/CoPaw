# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable

from fastapi import HTTPException

from copaw.config.config import KnowledgeConfig
from copaw.knowledge.graph_ops import GraphOpsManager
from copaw.knowledge.manager import KnowledgeManager
from copaw.knowledge.project_pipeline_manager import DEFAULT_PROJECT_PIPELINE_QUALITY_LOOP_ROUNDS

from .builtin_agents import (
    BUILTIN_UNDERSTAND_DOMAIN_ANALYZER_ID,
    BUILTIN_UNDERSTAND_FILE_ANALYZER_ID,
    BUILTIN_UNDERSTAND_GRAPH_REVIEWER_ID,
    BUILTIN_UNDERSTAND_PROJECT_SCANNER_ID,
)
from .knowledge_workflow_steps import (
    KNOWLEDGE_WORKFLOW_STEP_IDS,
    KNOWLEDGE_WORKFLOW_STEP_SPECS,
    _load_builtin_pipeline_doc,
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
# Version is read from the authoritative JSON at runtime – this constant is
# kept only as a safe fallback for code paths that run before the JSON is
# available (e.g. test fixtures).
KNOWLEDGE_WORKFLOW_TEMPLATE_VERSION = "2.0.0"
KNOWLEDGE_PROCESSING_MODES = {"fast", "nlp", "agentic"}


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
    # Only keep the fields understood by PipelineTemplateStep.
    _fields = {f for f in PipelineTemplateStep.model_fields}
    return [
        PipelineTemplateStep(**{k: v for k, v in spec.items() if k in _fields})
        for spec in KNOWLEDGE_WORKFLOW_STEP_SPECS
    ]


def get_knowledge_workflow_step_ids() -> tuple[str, ...]:
    return KNOWLEDGE_WORKFLOW_STEP_IDS


def build_knowledge_workflow_template() -> PipelineTemplateInfo:
    try:
        doc = _load_builtin_pipeline_doc()
        version = str(doc.get("version") or KNOWLEDGE_WORKFLOW_TEMPLATE_VERSION).strip()
        description = str(doc.get("description") or "").strip()
    except Exception:
        version = KNOWLEDGE_WORKFLOW_TEMPLATE_VERSION
        description = (
            "Builtin project-scoped workflow for knowledge indexing, NLP enrichment, "
            "and quality review."
        )
    return PipelineTemplateInfo(
        id=KNOWLEDGE_WORKFLOW_TEMPLATE_ID,
        name=KNOWLEDGE_WORKFLOW_TEMPLATE_NAME,
        version=version,
        description=description,
        steps=_knowledge_workflow_steps(),
    )


def ensure_knowledge_workflow_template(project_dir: Path) -> PipelineTemplateInfo:
    template = build_knowledge_workflow_template()
    pipelines_dir = project_dir / ".pipelines" / "templates"
    pipelines_dir.mkdir(parents=True, exist_ok=True)
    template_path = pipelines_dir / f"{template.id}.json"
    if not template_path.exists():
        # Write from the authoritative JSON source (preserves full schema).
        try:
            source_doc = _load_builtin_pipeline_doc()
        except Exception:
            source_doc = {
                **template.model_dump(mode="json"),
                "builtin_kind": "knowledge-processing",
                "system_owned": True,
                "entrypoint": "project-knowledge-panel",
            }
        template_path.write_text(
            json.dumps(source_doc, ensure_ascii=False, indent=2) + "\n",
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


def _collect_project_source_files(
    project_dir: Path,
    *,
    source_location: str | Path | None,
    recursive: bool = True,
) -> list[str]:
    source_dir = Path(source_location or project_dir).expanduser().resolve()
    if not source_dir.exists() or not source_dir.is_dir():
        return []
    filter_config = KnowledgeConfig()
    pattern = "**/*" if recursive else "*"
    return [
        _relative_to_project(project_dir, path)
        for path in sorted(source_dir.glob(pattern), key=lambda item: item.as_posix().lower())
        if path.is_file()
        if KnowledgeManager._is_allowed_path(path.relative_to(source_dir).as_posix(), filter_config)
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
        processing_mode: str | None = None,
        quantization_stage: str | None = None,  # 新增参数
        status_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        normalized_mode = str(processing_mode or "agentic").strip().lower() or "agentic"
        quant_stage = (quantization_stage or "").strip().lower() if quantization_stage else None
        if normalized_mode not in KNOWLEDGE_PROCESSING_MODES:
            raise ValueError(f"Unsupported knowledge processing mode: {normalized_mode}")
        if quant_stage == "l1":
            normalized_mode = "fast"
        elif quant_stage == "l2":
            normalized_mode = "nlp"
        elif quant_stage == "l3":
            normalized_mode = "agentic"
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
        run.parameters["processing_mode"] = normalized_mode
        if quant_stage:
            run.parameters["quantization_stage"] = quant_stage
        self._append_run_event(
            run,
            event="workflow.started",
            actor="knowledge-workflow",
            status="running",
            message="Knowledge processing workflow started",
        )
        self._persist(run)

        index_result: dict[str, Any] | None = None
        nlp_result: dict[str, Any] | None = None
        memify_result: dict[str, Any] | None = None
        quality_loop_result: dict[str, Any] | None = None

        index_path = self.knowledge_manager._source_index_path(source.id)
        quality_report_path = self.graph_ops.enrichment_quality_report_path

        # ── Step 1 of 7: snapshot_raw ──────────────────────────────────────
        self._patch_step(
            run,
            "snapshot_raw",
            actor=BUILTIN_UNDERSTAND_PROJECT_SCANNER_ID,
            status_callback=status_callback,
            sync_patch={
                "status": "indexing",
                "stage": "indexing",
                "stage_message": "Snapshotting source files",
                "progress": 5,
                "current": 0,
                "total": 7,
                **_lane_overrides(
                    fast={"status": "running", "available": False, "progress": 5, "stage": "Snapshotting sources"},
                    nlp={"status": "running", "available": False, "progress": 5, "stage": "Snapshotting sources"},
                    agentic={"status": "running", "available": False, "progress": 5, "stage": "Snapshotting sources"},
                ),
            },
            completed_sync_patch={
                "status": "indexing",
                "stage": "indexing",
                "stage_message": "Raw snapshots ready",
                "progress": 20,
                "current": 0,
                "total": 7,
                **_lane_overrides(
                    fast={"status": "running", "available": False, "progress": 20, "stage": "Building chunks"},
                    nlp={"status": "running", "available": False, "progress": 20, "stage": "Building chunks"},
                    agentic={"status": "running", "available": False, "progress": 20, "stage": "Building chunks"},
                ),
            },
            executor=lambda step: self._execute_snapshot_raw(
                source=source,
                config=config,
                running_config=running_config,
                changed_paths=normalized_changed_paths,
                index_path=index_path,
            ),
        )
        index_result = dict(run.steps[0].metrics.get("result") or {})

        # ── Step 2 of 7: build_chunks (pass-through from snapshot_raw) ────
        self._patch_step(
            run,
            "build_chunks",
            actor=BUILTIN_UNDERSTAND_FILE_ANALYZER_ID,
            status_callback=status_callback,
            sync_patch={
                "status": "indexing",
                "stage": "indexing",
                "stage_message": "Building content chunks",
                "progress": 22,
                "current": 1,
                "total": 7,
                **_lane_overrides(
                    fast={"status": "running", "available": False, "progress": 22, "stage": "Chunking content"},
                    nlp={"status": "running", "available": False, "progress": 22, "stage": "Chunking content"},
                    agentic={"status": "running", "available": False, "progress": 22, "stage": "Chunking content"},
                ),
            },
            completed_sync_patch={
                "status": "indexing",
                "stage": "indexing",
                "stage_message": "Chunks ready",
                "progress": 28,
                "current": 1,
                "total": 7,
                **_lane_overrides(
                    fast={"status": "running", "available": False, "progress": 28, "stage": "Building interlinear"},
                    nlp={"status": "running", "available": False, "progress": 28, "stage": "Building interlinear"},
                    agentic={"status": "running", "available": False, "progress": 28, "stage": "Building interlinear"},
                ),
            },
            executor=lambda step: self._execute_passthrough(
                step_id="build_chunks",
                metrics={
                    "chunk_count": int(index_result.get("chunk_count") or 0),
                    "document_count": int(index_result.get("document_count") or 0),
                },
                evidence=run.steps[0].evidence[:5],
                artifacts=[],
            ),
        )

        # ── Step 3 of 7: build_interlinear (pass-through from snapshot_raw)
        self._patch_step(
            run,
            "build_interlinear",
            actor=BUILTIN_UNDERSTAND_FILE_ANALYZER_ID,
            status_callback=status_callback,
            sync_patch={
                "status": "indexing",
                "stage": "indexing",
                "stage_message": "Building interlinear text",
                "progress": 30,
                "current": 2,
                "total": 7,
                **_lane_overrides(
                    fast={"status": "running", "available": False, "progress": 30, "stage": "Building interlinear"},
                    nlp={"status": "running", "available": False, "progress": 30, "stage": "Building interlinear"},
                    agentic={"status": "running", "available": False, "progress": 30, "stage": "Building interlinear"},
                ),
            },
            completed_sync_patch={
                "status": "indexing",
                "stage": "indexing",
                "stage_message": "Interlinear text ready",
                "progress": 38,
                "current": 2,
                "total": 7,
                **_lane_overrides(
                    fast={"status": "ready", "available": True, "progress": 100, "stage": "Fast preview ready"},
                    nlp={"status": "queued", "available": False, "stage": "Waiting for tokenize"},
                    agentic={"status": "queued", "available": False, "stage": "Waiting for tokenize"},
                ),
            },
            executor=lambda step: self._execute_passthrough(
                step_id="build_interlinear",
                metrics={
                    "tokenize_line_count": int(index_result.get("tokenize_line_count") or 0),
                    "sentence_count": int(index_result.get("sentence_count") or 0),
                },
                evidence=run.steps[0].evidence[:5],
                artifacts=[],
            ),
        )

        if normalized_mode == "fast":
            return self._finalize_run(
                run,
                config=config,
                running_config=running_config,
                processing_mode=normalized_mode,
                quantization_stage=quant_stage,
                source=source,
                index_result=index_result,
                nlp_result=nlp_result,
                memify_result=memify_result,
                quality_loop_result=quality_loop_result,
                quality_report_path=quality_report_path,
                status_callback=status_callback,
            )

        # ── Step 4 of 7: tokenize ──────────────────────────────────────────

        def _nlp_progress(payload: dict[str, Any]) -> None:
            if status_callback is None:
                return
            raw_progress = payload.get("progress", payload.get("percent", 60))
            try:
                percent = int(float(raw_progress or 60))
            except (TypeError, ValueError):
                percent = 60
            l2_progress = payload.get("l2_progress") if isinstance(payload.get("l2_progress"), dict) else {}
            l2_metrics = payload.get("l2_metrics") if isinstance(payload.get("l2_metrics"), dict) else {}
            status_callback(
                {
                    "status": "graphifying",
                    "stage": "graphifying",
                    "stage_message": str(payload.get("stage_message") or "Running NLP enrichment"),
                    "progress": max(40, min(85, percent)),
                    "current": 3,
                    "total": 7,
                    "eta_seconds": payload.get("eta_seconds") if isinstance(payload.get("eta_seconds"), (int, float)) else None,
                    "l2_progress": l2_progress,
                    "l2_metrics": l2_metrics,
                    **_lane_overrides(
                        fast={"status": "ready", "available": True, "progress": 100, "stage": "Fast preview ready"},
                        nlp={"status": "running", "available": False, "progress": max(40, min(85, percent)), "stage": str(payload.get("stage_message") or "Running NLP")},
                        agentic={"status": "running", "available": False, "progress": max(40, min(85, percent)), "stage": str(payload.get("stage_message") or "Running NLP")},
                    ),
                }
            )

        self._patch_step(
            run,
            "tokenize",
            actor=BUILTIN_UNDERSTAND_DOMAIN_ANALYZER_ID,
            status_callback=status_callback,
            sync_patch={
                "status": "graphifying",
                "stage": "graphifying",
                "stage_message": "Running tokenization and NLP enrichment",
                "progress": 45,
                "current": 3,
                "total": 7,
                **_lane_overrides(
                    fast={"status": "ready", "available": True, "progress": 100, "stage": "Fast preview ready"},
                    nlp={"status": "running", "available": False, "progress": 45, "stage": "Tokenizing content"},
                    agentic={"status": "running", "available": False, "progress": 45, "stage": "Tokenizing content"},
                ),
            },
            completed_sync_patch={
                "status": "graphifying",
                "stage": "graphifying",
                "stage_message": "Tokenization complete",
                "progress": 70,
                "current": 3,
                "total": 7,
                **_lane_overrides(
                    fast={"status": "ready", "available": True, "progress": 100, "stage": "Fast preview ready"},
                    nlp={"status": "running", "available": False, "progress": 70, "stage": "Running POS tagging"},
                    agentic={"status": "running", "available": False, "progress": 70, "stage": "Running POS tagging"},
                ),
            },
            executor=lambda step: self._execute_tokenize(
                source=source,
                config=config,
                progress_callback=_nlp_progress,
            ),
        )
        nlp_result = dict(run.steps[3].metrics.get("result") or {})

        # ── Step 5 of 7: pos_tagging (pass-through from tokenize) ─────────
        self._patch_step(
            run,
            "pos_tagging",
            actor=BUILTIN_UNDERSTAND_DOMAIN_ANALYZER_ID,
            status_callback=status_callback,
            sync_patch={
                "status": "graphifying",
                "stage": "graphifying",
                "stage_message": "Applying POS tags",
                "progress": 72,
                "current": 4,
                "total": 7,
                **_lane_overrides(
                    fast={"status": "ready", "available": True, "progress": 100, "stage": "Fast preview ready"},
                    nlp={"status": "running", "available": False, "progress": 72, "stage": "POS tagging"},
                    agentic={"status": "running", "available": False, "progress": 72, "stage": "POS tagging"},
                ),
            },
            completed_sync_patch={
                "status": "graphifying",
                "stage": "graphifying",
                "stage_message": "POS tagging complete",
                "progress": 78,
                "current": 4,
                "total": 7,
                **_lane_overrides(
                    fast={"status": "ready", "available": True, "progress": 100, "stage": "Fast preview ready"},
                    nlp={"status": "running", "available": False, "progress": 78, "stage": "Running syntax parse"},
                    agentic={"status": "running", "available": False, "progress": 78, "stage": "Running syntax parse"},
                ),
            },
            executor=lambda step: self._execute_passthrough(
                step_id="pos_tagging",
                metrics={
                    "pos_count": int(nlp_result.get("pos_count") or nlp_result.get("syntax_pos_count") or 0),
                    "pos_tag_type_count": int(nlp_result.get("pos_tag_type_count") or nlp_result.get("syntax_pos_tag_type_count") or 0),
                    "syntax_pos_count": int(nlp_result.get("syntax_pos_count") or nlp_result.get("pos_count") or 0),
                    "syntax_pos_tag_type_count": int(nlp_result.get("syntax_pos_tag_type_count") or nlp_result.get("pos_tag_type_count") or 0),
                    "pos_coverage_on_syntax_tokens": float(nlp_result.get("pos_coverage_on_syntax_tokens") or 0.0),
                },
                evidence=run.steps[3].evidence[:5],
                artifacts=[],
            ),
        )

        # ── Step 6 of 7: syntax_parse (pass-through from tokenize) ────────
        self._patch_step(
            run,
            "syntax_parse",
            actor=BUILTIN_UNDERSTAND_DOMAIN_ANALYZER_ID,
            status_callback=status_callback,
            sync_patch={
                "status": "graphifying",
                "stage": "graphifying",
                "stage_message": "Parsing syntax dependencies",
                "progress": 80,
                "current": 5,
                "total": 7,
                **_lane_overrides(
                    fast={"status": "ready", "available": True, "progress": 100, "stage": "Fast preview ready"},
                    nlp={"status": "running", "available": False, "progress": 80, "stage": "Syntax parsing"},
                    agentic={"status": "running", "available": False, "progress": 80, "stage": "Syntax parsing"},
                ),
            },
            completed_sync_patch={
                "status": "graphifying",
                "stage": "graphifying",
                "stage_message": "Syntax parse complete",
                "progress": 86,
                "current": 5,
                "total": 7,
                **_lane_overrides(
                    fast={"status": "ready", "available": True, "progress": 100, "stage": "Fast preview ready"},
                    nlp={"status": "ready", "available": True, "progress": 100, "stage": "NLP enrichment ready"},
                    agentic={"status": "running", "available": False, "progress": 86, "stage": "Semantic role labeling"},
                ),
            },
            executor=lambda step: self._execute_passthrough(
                step_id="syntax_parse",
                metrics={
                    "syntax_relation_count": int(nlp_result.get("syntax_relation_count") or 0),
                    "syntax_sentence_count": int(nlp_result.get("syntax_sentence_count") or 0),
                    "syntax_token_count": int(nlp_result.get("syntax_token_count") or 0),
                },
                evidence=run.steps[3].evidence[:5],
                artifacts=[],
            ),
        )

        if normalized_mode == "nlp":
            return self._finalize_run(
                run,
                config=config,
                running_config=running_config,
                processing_mode=normalized_mode,
                quantization_stage=quant_stage,
                source=source,
                index_result=index_result,
                nlp_result=nlp_result,
                memify_result=memify_result,
                quality_loop_result=quality_loop_result,
                quality_report_path=quality_report_path,
                status_callback=status_callback,
            )

        # ── Step 7 of 7: semantic_role_labeling (placeholder) ─────────────
        self._patch_step(
            run,
            "semantic_role_labeling",
            actor=BUILTIN_UNDERSTAND_DOMAIN_ANALYZER_ID,
            status_callback=status_callback,
            sync_patch={
                "status": "graphifying",
                "stage": "graphifying",
                "stage_message": "Semantic role labeling",
                "progress": 88,
                "current": 6,
                "total": 7,
                **_lane_overrides(
                    fast={"status": "ready", "available": True, "progress": 100, "stage": "Fast preview ready"},
                    nlp={"status": "ready", "available": True, "progress": 100, "stage": "NLP enrichment ready"},
                    agentic={"status": "running", "available": False, "progress": 88, "stage": "Semantic role labeling"},
                ),
            },
            completed_sync_patch={
                "status": "graphifying",
                "stage": "graphifying",
                "stage_message": "NLP enrichment pipeline complete",
                "progress": 92,
                "current": 6,
                "total": 7,
                **_lane_overrides(
                    fast={"status": "ready", "available": True, "progress": 100, "stage": "Fast preview ready"},
                    nlp={"status": "ready", "available": True, "progress": 100, "stage": "NLP enrichment ready"},
                    agentic={"status": "running", "available": False, "progress": 92, "stage": "Building knowledge graph"},
                ),
            },
            executor=lambda step: self._execute_semantic_role_labeling(),
        )

        return self._finalize_run(
            run,
            config=config,
            running_config=running_config,
            processing_mode=normalized_mode,
            quantization_stage=quant_stage,
            source=source,
            index_result=index_result,
            nlp_result=nlp_result,
            memify_result=memify_result,
            quality_loop_result=quality_loop_result,
            quality_report_path=quality_report_path,
            status_callback=status_callback,
        )
    def _finalize_run(
        self,
        run: PipelineRunDetail,
        *,
        config,
        running_config: Any | None,
        processing_mode: str,
        quantization_stage: str | None,
        source,
        index_result: dict[str, Any] | None,
        nlp_result: dict[str, Any] | None,
        memify_result: dict[str, Any] | None,
        quality_loop_result: dict[str, Any] | None,
        quality_report_path: Path,
        status_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        # ── Agentic post-NLP: graph build + quality loop ───────────────────
        if processing_mode == "agentic":
            try:
                memify_result = self._run_memify(
                    config=config, source=source, quality_report_path=quality_report_path
                )
                quality_loop_result = self._run_quality_loop(
                    config=config,
                    source=source,
                    memify_result=memify_result,
                    quality_report_path=quality_report_path,
                )
                # Record graph artifact paths in the run record.
                for candidate in [
                    self.graph_ops.local_graph_path,
                    self.graph_ops.enriched_graph_path,
                    quality_report_path,
                ]:
                    if candidate.exists():
                        rel = _relative_to_project(self.project_dir, candidate)
                        if rel not in run.artifacts:
                            run.artifacts.append(rel)
                if status_callback is not None:
                    status_callback(
                        {
                            "status": "ready",
                            "stage": "complete",
                            "stage_message": "Knowledge graph built",
                            "progress": 100,
                            **_lane_overrides(
                                fast={"status": "ready", "available": True, "progress": 100, "stage": "Fast preview ready"},
                                nlp={"status": "ready", "available": True, "progress": 100, "stage": "NLP enrichment ready"},
                                agentic={"status": "ready", "available": True, "progress": 100, "stage": "Knowledge graph ready"},
                            ),
                        }
                    )
            except Exception as exc:
                run.status = "failed"
                run.updated_at = _pipeline_now_iso()
                self._append_run_event(
                    run,
                    event="workflow.failed",
                    actor="knowledge-workflow",
                    status="failed",
                    message=f"Post-NLP graph build failed: {exc}",
                )
                self._persist(run)
                raise

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
            "processing_mode": processing_mode,
            "quantization_stage": quantization_stage,
            "template_id": self.template.id,
            "processing_fingerprint": processing_fingerprint,
            "latest_job_id": str(
                (quality_loop_result or {}).get("job_id")
                or (memify_result or {}).get("job_id")
                or ""
            ).strip(),
            "index": index_result or {},
            "nlp": nlp_result or {},
            "memify": memify_result or {},
            "quality_loop": quality_loop_result or {},
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

    def _execute_snapshot_raw(
        self,
        *,
        source,
        config,
        running_config: Any | None,
        changed_paths: list[str],
        index_path: Path,
    ) -> dict[str, Any]:
        """Steps 1-3 driver: index source (raw + chunk + interlinear artifacts)."""
        data_files = _collect_project_source_files(
            self.project_dir,
            source_location=source.location,
            recursive=bool(getattr(source, "recursive", True)),
        )
        index_result = self.knowledge_manager.index_source(
            source,
            config,
            running_config,
            include_semantic_artifacts=False,
        )
        evidence = _project_metadata_candidates(self.project_dir)
        if changed_paths:
            evidence.extend(changed_paths[:5])
        artifacts: list[str] = []
        if index_path.exists():
            rel_index = _relative_to_project(self.project_dir, index_path)
            evidence.append(rel_index)
            artifacts.append(rel_index)
        metrics = {
            "changed_path_count": len(changed_paths),
            "data_file_count": len(data_files),
            "document_count": int(index_result.get("document_count") or 0),
            "snapshot_count": int(index_result.get("snapshot_count") or 0),
            "chunk_count": int(index_result.get("chunk_count") or 0),
            "sentence_count": int(index_result.get("sentence_count") or 0),
            "tokenize_line_count": int(index_result.get("tokenize_line_count") or 0),
        }
        self.knowledge_manager.write_project_step_stats(
            project_id=self.project_id,
            project_workspace_dir=self.project_dir,
            step_id="snapshot_raw",
            source_id=source.id,
            source_location=str(source.location or "").strip(),
            metrics=metrics,
            extra_fields={"changed_paths": changed_paths, "data_files": data_files[:20]},
        )
        return {
            "metrics": metrics,
            "result": index_result,
            "evidence": evidence or [".agent/PROJECT.md"],
            "artifacts": artifacts,
        }

    def _execute_passthrough(
        self,
        *,
        step_id: str,
        metrics: dict[str, Any],
        evidence: list[str],
        artifacts: list[str],
    ) -> dict[str, Any]:
        """Pass-through executor for steps whose work is done by a preceding step."""
        return {
            "metrics": metrics,
            "result": {},
            "evidence": evidence,
            "artifacts": artifacts,
        }

    def _execute_tokenize(
        self,
        *,
        source,
        config,
        progress_callback: Callable[[dict[str, Any]], None] | None,
    ) -> dict[str, Any]:
        """Steps 4-6 driver: tokenize + POS + syntax NLP enrichment."""
        self.knowledge_manager.materialize_semantic_artifacts_for_source(
            source,
            config=config,
            progress_callback=progress_callback,
        )
        # Re-read the index payload to pick up freshly written NLP metrics.
        nlp_payload = self.knowledge_manager._load_index_payload_safe(source.id)
        if not isinstance(nlp_payload, dict):
            nlp_payload = {}
        metrics = {
            "tokenize_ready_chunk_count": int(nlp_payload.get("tokenize_ready_chunk_count") or 0),
            "tokenize_line_count": int(nlp_payload.get("tokenize_line_count") or 0),
            "tokenize_token_count": int(nlp_payload.get("tokenize_token_count") or 0),
            "pos_ready_chunk_count": int(nlp_payload.get("pos_ready_chunk_count") or 0),
            "pos_line_count": int(nlp_payload.get("pos_line_count") or 0),
            "pos_token_count": int(nlp_payload.get("pos_token_count") or 0),
            "pos_count": int(nlp_payload.get("pos_count") or nlp_payload.get("syntax_pos_count") or 0),
            "pos_tag_type_count": int(nlp_payload.get("pos_tag_type_count") or nlp_payload.get("syntax_pos_tag_type_count") or 0),
            "syntax_pos_count": int(nlp_payload.get("syntax_pos_count") or 0),
            "syntax_pos_tag_type_count": int(nlp_payload.get("syntax_pos_tag_type_count") or 0),
            "pos_coverage_on_syntax_tokens": float(nlp_payload.get("pos_coverage_on_syntax_tokens") or 0.0),
            "syntax_relation_count": int(nlp_payload.get("syntax_relation_count") or 0),
            "syntax_sentence_count": int(nlp_payload.get("syntax_sentence_count") or 0),
            "syntax_token_count": int(nlp_payload.get("syntax_token_count") or 0),
        }
        evidence: list[str] = []
        tokenize_dir = self.knowledge_manager.tokenize_dir
        if tokenize_dir.exists():
            evidence.append(_relative_to_project(self.project_dir, tokenize_dir))
        self.knowledge_manager.write_project_step_stats(
            project_id=self.project_id,
            project_workspace_dir=self.project_dir,
            step_id="tokenize",
            source_id=source.id,
            source_location=str(source.location or "").strip(),
            metrics=metrics,
            extra_fields={},
        )
        return {
            "metrics": metrics,
            "result": metrics,
            "evidence": evidence,
            "artifacts": evidence,
        }

    def _execute_semantic_role_labeling(self) -> dict[str, Any]:
        """Placeholder step — SRL is reserved for a future release."""
        return {
            "metrics": {
                "srl_status": "unavailable",
                "reason_code": "SRL_NOT_IMPLEMENTED",
            },
            "result": {
                "status": "unavailable",
                "reason_code": "SRL_NOT_IMPLEMENTED",
                "reason": "Semantic role labeling is reserved for a future release.",
            },
            "evidence": [],
            "artifacts": [],
        }

    def _run_memify(
        self,
        *,
        config,
        source,
        quality_report_path: Path,
    ) -> dict[str, Any]:
        """Post-NLP graph build (agentic mode only, not a tracked pipeline step)."""
        memify_result = self.graph_ops.execute_memify_once(
            config=config,
            pipeline_type="knowledge-processing-workflow",
            dataset_scope=[source.id],
            dry_run=False,
            progress_callback=None,
        )
        if str(memify_result.get("status") or "") != "succeeded":
            raise RuntimeError(str(memify_result.get("error") or "Knowledge graph build failed"))
        return memify_result

    def _run_quality_loop(
        self,
        *,
        config,
        source,
        memify_result: dict[str, Any] | None,
        quality_report_path: Path,
    ) -> dict[str, Any]:
        """Post-NLP quality self-drive loop (agentic mode only)."""
        quality_start = self.graph_ops.maybe_start_quality_self_drive(
            config=config,
            dataset_scope=[source.id],
            project_id=self.project_id,
            max_rounds=DEFAULT_PROJECT_PIPELINE_QUALITY_LOOP_ROUNDS,
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
        return quality_result