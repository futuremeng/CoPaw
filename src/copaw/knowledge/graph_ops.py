# -*- coding: utf-8 -*-
"""Bridge layer for graph-oriented knowledge operations.

This module provides a lightweight manager used by graph tools. It keeps
current MVP behavior compatible while reserving integration points for
graph-provider implementations (for example, Cognee/Graphify).
"""

from __future__ import annotations

import json
import math
import re
import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

from ..config.config import KnowledgeConfig
from ..constant import WORKING_DIR
from .graphify_provider import (
    GraphifyError,
    GraphifyNotConfiguredError,
    graphify_memify,
    graphify_query,
)
from .enrichment_pipeline import run_system_knowledge_enrichment
from .local_graph_provider import persist_local_graph, query_local_graph
from .manager import KnowledgeManager


@dataclass
class GraphOpsResult:
    records: list[dict[str, Any]]
    summary: str
    provenance: dict[str, Any]
    warnings: list[str]


class GraphOpsManager:
    """Graph operation facade for tool-layer usage."""

    def __init__(
        self,
        working_dir: Path | str = WORKING_DIR,
        *,
        knowledge_dirname: str = "knowledge",
    ) -> None:
        self.working_dir = Path(working_dir)
        self.knowledge_dirname = knowledge_dirname
        self.knowledge_root = self.working_dir / knowledge_dirname
        self.memify_jobs_path = self.knowledge_root / "memify-jobs.json"
        self.quality_loop_jobs_path = self.knowledge_root / "quality-loop-jobs.json"
        self.local_graph_path = self.knowledge_root / "graphify-out" / "graph.json"
        self.enriched_graph_path = self.knowledge_root / "graphify-out" / "graph.enriched.json"
        self.enrichment_quality_report_path = (
            self.knowledge_root / "graphify-out" / "enrichment-quality-report.json"
        )
        self._jobs_lock = threading.Lock()
        self._quality_jobs_lock = threading.Lock()

    @staticmethod
    def _normalize_quality_loop_patch(patch: dict[str, Any]) -> dict[str, Any]:
        stage = str(patch.get("stage") or patch.get("current_stage") or "pending").strip() or "pending"
        percent = int(max(0, min(100, int(patch.get("progress", patch.get("percent", 0)) or 0))))
        normalized = {
            **patch,
            "task_type": "quality_loop",
            "current_stage": stage,
            "stage": stage,
            "progress": percent,
            "percent": percent,
            "current": int(patch.get("current") or 0),
            "total": int(patch.get("total") or 0),
            "stage_message": str(patch.get("stage_message") or "").strip(),
        }
        return normalized

    @staticmethod
    def _clamp(value: float, minimum: float, maximum: float) -> float:
        return max(minimum, min(maximum, value))

    @classmethod
    def _safe_ratio(cls, numerator: float, denominator: float) -> float:
        if denominator <= 0:
            return 0.0
        return cls._clamp(numerator / denominator, 0.0, 1.0)

    def _derive_adaptive_thresholds(
        self,
        *,
        relation_count: int,
        entity_count: int,
    ) -> dict[str, float]:
        relation_scale = math.log10(max(10, relation_count))
        entity_scale = math.log10(max(10, entity_count))
        return {
            "relation_normalization_threshold": self._clamp(0.48 + relation_scale * 0.08, 0.5, 0.82),
            "entity_canonical_threshold": self._clamp(0.45 + entity_scale * 0.08, 0.48, 0.8),
            "low_confidence_threshold": self._clamp(0.28 - relation_scale * 0.03, 0.12, 0.28),
            "missing_evidence_threshold": self._clamp(0.30 - relation_scale * 0.03, 0.15, 0.30),
        }

    def _build_quality_snapshot(self, payload: dict[str, Any]) -> dict[str, Any]:
        relation_count = int(payload.get("relation_count") or 0)
        entity_count = int(payload.get("node_count") or payload.get("entity_count") or 0)
        document_count = int(payload.get("document_count") or 0)
        enrichment_metrics = payload.get("enrichment_metrics") or {}
        if not isinstance(enrichment_metrics, dict):
            enrichment_metrics = {}

        edge_count = int(enrichment_metrics.get("edge_count") or relation_count)
        node_count = int(enrichment_metrics.get("node_count") or entity_count)
        relation_normalized_count = int(enrichment_metrics.get("relation_normalized_count") or 0)
        entity_canonicalized_count = int(enrichment_metrics.get("entity_canonicalized_count") or 0)
        low_confidence_edges = int(enrichment_metrics.get("low_confidence_edges") or 0)
        missing_evidence_edges = int(enrichment_metrics.get("missing_evidence_edges") or 0)

        relation_normalization_coverage = self._safe_ratio(relation_normalized_count, edge_count)
        entity_canonical_coverage = self._safe_ratio(entity_canonicalized_count, node_count)
        low_confidence_ratio = self._safe_ratio(low_confidence_edges, edge_count)
        missing_evidence_ratio = self._safe_ratio(missing_evidence_edges, edge_count)

        thresholds = self._derive_adaptive_thresholds(
            relation_count=relation_count,
            entity_count=entity_count,
        )
        pass_flags = {
            "relation_normalization": relation_normalization_coverage >= thresholds["relation_normalization_threshold"],
            "entity_canonical": entity_canonical_coverage >= thresholds["entity_canonical_threshold"],
            "low_confidence": low_confidence_ratio <= thresholds["low_confidence_threshold"],
            "missing_evidence": missing_evidence_ratio <= thresholds["missing_evidence_threshold"],
        }

        normalized_scores = [
            self._safe_ratio(relation_normalization_coverage, thresholds["relation_normalization_threshold"]),
            self._safe_ratio(entity_canonical_coverage, thresholds["entity_canonical_threshold"]),
            self._clamp(1 - self._safe_ratio(low_confidence_ratio, thresholds["low_confidence_threshold"]), 0.0, 1.0),
            self._clamp(1 - self._safe_ratio(missing_evidence_ratio, thresholds["missing_evidence_threshold"]), 0.0, 1.0),
        ]
        quality_score = sum(normalized_scores) / len(normalized_scores)

        return {
            "document_count": document_count,
            "relation_count": relation_count,
            "entity_count": entity_count,
            "relation_normalization_coverage": relation_normalization_coverage,
            "entity_canonical_coverage": entity_canonical_coverage,
            "low_confidence_ratio": low_confidence_ratio,
            "missing_evidence_ratio": missing_evidence_ratio,
            "thresholds": thresholds,
            "pass_flags": pass_flags,
            "quality_score": quality_score,
        }

    @staticmethod
    def _build_quality_actions(snapshot: dict[str, Any]) -> list[dict[str, Any]]:
        thresholds = snapshot.get("thresholds") or {}
        pass_flags = snapshot.get("pass_flags") or {}
        actions: list[dict[str, Any]] = []
        if not bool(pass_flags.get("relation_normalization")):
            actions.append(
                {
                    "action": "strengthen_relation_normalization",
                    "expected_metric": "relation_normalization_coverage",
                    "target": thresholds.get("relation_normalization_threshold"),
                }
            )
        if not bool(pass_flags.get("entity_canonical")):
            actions.append(
                {
                    "action": "strengthen_entity_canonicalization",
                    "expected_metric": "entity_canonical_coverage",
                    "target": thresholds.get("entity_canonical_threshold"),
                }
            )
        if not bool(pass_flags.get("low_confidence")):
            actions.append(
                {
                    "action": "prune_low_confidence_edges",
                    "expected_metric": "low_confidence_ratio",
                    "target": thresholds.get("low_confidence_threshold"),
                }
            )
        if not bool(pass_flags.get("missing_evidence")):
            actions.append(
                {
                    "action": "backfill_missing_evidence",
                    "expected_metric": "missing_evidence_ratio",
                    "target": thresholds.get("missing_evidence_threshold"),
                }
            )
        return actions

    @staticmethod
    def _normalize_dataset_scope(dataset_scope: list[str] | None) -> list[str]:
        return [
            str(item or "").strip()
            for item in (dataset_scope or [])
            if str(item or "").strip()
        ]

    @staticmethod
    def _normalize_project_id(project_id: str | None) -> str:
        return str(project_id or "").strip().lower()

    def _project_quality_skills_dir(self, project_id: str | None) -> Path | None:
        normalized = self._normalize_project_id(project_id)
        if not normalized:
            return None
        projects_dir = self.working_dir / "projects"
        if projects_dir.exists() and projects_dir.is_dir():
            exact_dir = projects_dir / str(project_id or "")
            if exact_dir.exists() and exact_dir.is_dir():
                return exact_dir / ".skills" / "quality-loop"
            for child in sorted(projects_dir.iterdir()):
                if not child.is_dir():
                    continue
                if child.name.lower() == normalized:
                    return child / ".skills" / "quality-loop"
        return projects_dir / normalized / ".skills" / "quality-loop"

    def _load_quality_reflection_hints(self, project_id: str | None) -> dict[str, Any]:
        skills_dir = self._project_quality_skills_dir(project_id)
        if skills_dir is None:
            return {}
        params_path = skills_dir / "PARAMS.json"
        if not params_path.exists():
            return {}
        try:
            payload = json.loads(params_path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        if not isinstance(payload, dict):
            return {}
        return payload

    def _save_quality_reflection_artifacts(
        self,
        *,
        project_id: str | None,
        job_id: str,
        rounds: list[dict[str, Any]],
        final_summary: dict[str, Any],
        next_round_hints: dict[str, Any],
    ) -> dict[str, str]:
        skills_dir = self._project_quality_skills_dir(project_id)
        if skills_dir is None:
            return {}

        skills_dir.mkdir(parents=True, exist_ok=True)
        rounds_dir = skills_dir / "rounds"
        rounds_dir.mkdir(parents=True, exist_ok=True)
        lessons_path = skills_dir / "LESSONS.md"
        params_path = skills_dir / "PARAMS.json"
        skill_md_path = skills_dir / "SKILL.md"

        lines = [
            "# Quality Loop Lessons",
            "",
            f"- job_id: {job_id}",
            f"- total_rounds: {len(rounds)}",
            f"- stop_reason: {str(final_summary.get('stop_reason') or '')}",
            f"- score_before: {final_summary.get('score_before')}",
            f"- score_after: {final_summary.get('score_after')}",
            f"- delta: {final_summary.get('delta')}",
            "",
            "## Round Summaries",
            "",
        ]

        for round_item in rounds:
            summary = round_item.get("summary") or {}
            round_no = int(round_item.get("round") or 0)
            lines.extend(
                [
                    f"### Round {round_no}",
                    f"- status: {round_item.get('status')}",
                    f"- delta: {round_item.get('delta')}",
                    f"- agent_gate_status: {(round_item.get('agent_gate') or {}).get('status')}",
                    f"- continue: {summary.get('continue')}",
                    f"- reason: {summary.get('stop_or_continue_reason')}",
                    f"- hypotheses: {', '.join(summary.get('problem_hypotheses') or [])}",
                    f"- next_plan: {', '.join(summary.get('next_round_plan') or [])}",
                    "",
                ]
            )
            round_path = rounds_dir / f"round-{round_no:02d}.json"
            round_payload = {
                "job_id": job_id,
                "round": round_no,
                "artifact_version": 1,
                "recorded_at": datetime.now(UTC).isoformat(),
                **round_item,
            }
            round_path.write_text(
                json.dumps(round_payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )

        lessons_path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
        params_path.write_text(
            json.dumps(next_round_hints, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        if not skill_md_path.exists():
            skill_md_path.write_text(
                """---
name: quality-loop-reflection
description: Reflection notes and execution hints for project quality loop
---

# Quality Loop Reflection Skill

Read LESSONS.md and PARAMS.json before running the next quality loop round.
Agent gate review is mandatory before automatic continuation.
""",
                encoding="utf-8",
            )
        return {
            "lessons_path": str(lessons_path),
            "params_path": str(params_path),
            "skill_md_path": str(skill_md_path),
            "rounds_dir": str(rounds_dir),
        }

    def _run_quality_agent_gate(
        self,
        *,
        round_no: int,
        actions: list[dict[str, Any]],
        before_snapshot: dict[str, Any],
        after_snapshot: dict[str, Any],
        round_summary: dict[str, Any],
        previous_hints: dict[str, Any],
    ) -> dict[str, Any]:
        action_names = [
            str(item.get("action") or "").strip()
            for item in actions
            if str(item.get("action") or "").strip()
        ]
        failed_metrics = [
            str(metric)
            for metric, passed in (after_snapshot.get("pass_flags") or {}).items()
            if not bool(passed)
        ]
        delta = float(round_summary.get("observed_delta") or 0.0)
        should_continue = bool(round_summary.get("continue"))
        suggestions = [
            str(item)
            for item in (round_summary.get("skill_patch_suggestions") or [])
            if str(item).strip()
        ]

        # Keep gate strict for actionable next-round continuation.
        if should_continue and not action_names:
            return {
                "status": "review_required",
                "reason": "MISSING_ACTION_PLAN",
                "summary": "No executable actions were produced for the next round.",
                "next_round_hints": {},
            }

        pipeline_bias = str(previous_hints.get("pipeline_bias") or "").strip() or "balanced"
        if any(name in {"strengthen_relation_normalization", "strengthen_entity_canonicalization"} for name in action_names):
            pipeline_bias = "enrichment_focus"

        next_round_hints = {
            **previous_hints,
            "version": 1,
            "updated_at": datetime.now(UTC).isoformat(),
            "round_no": round_no,
            "pipeline_bias": pipeline_bias,
            "focus_actions": action_names,
            "agent_reflection": {
                "failed_metrics": failed_metrics,
                "observed_delta": delta,
                "suggestions": suggestions,
            },
        }

        return {
            "status": "accepted",
            "reason": "OK",
            "summary": (
                f"Round {round_no} reviewed with {len(action_names)} action(s); "
                f"delta={delta:.4f}, continue={str(should_continue).lower()}"
            ),
            "next_round_hints": next_round_hints,
        }

    def _build_quality_round_summary(
        self,
        *,
        round_no: int,
        actions: list[dict[str, Any]],
        before_snapshot: dict[str, Any],
        after_snapshot: dict[str, Any],
        delta: float,
        stop_or_continue_reason: str,
    ) -> dict[str, Any]:
        failed_metrics = [
            str(key)
            for key, value in (after_snapshot.get("pass_flags") or {}).items()
            if not bool(value)
        ]
        action_names = [str(item.get("action") or "") for item in actions if str(item.get("action") or "").strip()]
        continue_next = bool(failed_metrics) and delta <= 0.02
        return {
            "round": round_no,
            "problem_hypotheses": failed_metrics,
            "applied_actions": action_names,
            "observed_delta": delta,
            "next_round_plan": action_names[:3],
            "skill_patch_suggestions": [
                f"Tune {metric} extraction policy"
                for metric in failed_metrics[:3]
            ],
            "continue": continue_next,
            "stop_or_continue_reason": stop_or_continue_reason,
            "quality_score_before": before_snapshot.get("quality_score"),
            "quality_score_after": after_snapshot.get("quality_score"),
        }

    def _derive_quality_execution_hints(
        self,
        *,
        actions: list[dict[str, Any]],
        previous_hints: dict[str, Any],
        round_no: int,
        before_snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        action_names = [str(item.get("action") or "").strip() for item in actions if str(item.get("action") or "").strip()]
        previous_bias = str(previous_hints.get("pipeline_bias") or "").strip()
        low_conf_target = 0.35
        thresholds = before_snapshot.get("thresholds") or {}
        if isinstance(thresholds, dict):
            try:
                low_conf_target = max(0.2, min(0.6, float(thresholds.get("low_confidence_threshold", 0.35))))
            except (TypeError, ValueError):
                low_conf_target = 0.35
        should_prune_low_conf = "prune_low_confidence_edges" in action_names
        should_drop_missing = "backfill_missing_evidence" in action_names
        bias = "enrichment_focus" if any(
            name in {"strengthen_relation_normalization", "strengthen_entity_canonicalization"}
            for name in action_names
        ) else (previous_bias or "balanced")
        return {
            "version": 1,
            "updated_at": datetime.now(UTC).isoformat(),
            "round_no": round_no,
            "pipeline_bias": bias,
            "focus_actions": action_names,
            "quality_policy": {
                "prune_low_confidence": should_prune_low_conf,
                "drop_missing_evidence": should_drop_missing,
                "min_confidence_to_keep": low_conf_target,
            },
            "retry_policy": {
                "max_stagnation_rounds": 2,
                "delta_floor": 0.005,
            },
        }

    def _pick_latest_memify_result(
        self,
        *,
        dataset_scope: list[str] | None = None,
        project_id: str | None = None,
    ) -> dict[str, Any] | None:
        normalized_scope = set(self._normalize_dataset_scope(dataset_scope))
        normalized_project_id = self._normalize_project_id(project_id)
        jobs = self.list_memify_jobs(active_only=False, limit=20)
        for job in jobs:
            if str(job.get("status") or "") != "succeeded":
                continue
            if int(job.get("relation_count") or 0) <= 0 and int(job.get("node_count") or 0) <= 0:
                continue
            job_scope = set(self._normalize_dataset_scope(job.get("dataset_scope") if isinstance(job.get("dataset_scope"), list) else []))
            if normalized_scope and job_scope and normalized_scope.isdisjoint(job_scope):
                continue
            if normalized_project_id:
                if job_scope and not any(normalized_project_id in item.lower() for item in job_scope):
                    continue
            return job
        return None

    def maybe_start_quality_self_drive(
        self,
        *,
        config: KnowledgeConfig,
        dataset_scope: list[str] | None,
        project_id: str | None,
        max_rounds: int,
        dry_run: bool,
        baseline_result: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = baseline_result if isinstance(baseline_result, dict) else self._pick_latest_memify_result(
            dataset_scope=dataset_scope,
            project_id=project_id,
        )
        if not isinstance(payload, dict):
            return {
                "accepted": False,
                "reason": "NO_BASELINE_MEMIFY_RESULT",
            }

        snapshot = self._build_quality_snapshot(payload)
        pass_flags = snapshot.get("pass_flags") or {}
        relation_count = int(snapshot.get("relation_count") or 0)
        entity_count = int(snapshot.get("entity_count") or 0)

        if relation_count <= 0 and entity_count <= 0:
            return {
                "accepted": False,
                "reason": "INSUFFICIENT_GRAPH_SIGNAL",
                "snapshot": snapshot,
            }

        if pass_flags and all(bool(value) for value in pass_flags.values()):
            return {
                "accepted": False,
                "reason": "QUALITY_TARGET_MET",
                "snapshot": snapshot,
            }

        result = self.run_quality_self_drive(
            config=config,
            dataset_scope=dataset_scope,
            project_id=project_id,
            max_rounds=max_rounds,
            dry_run=dry_run,
        )
        return {
            **result,
            "snapshot": snapshot,
        }

    def run_quality_self_drive(
        self,
        *,
        config: KnowledgeConfig,
        dataset_scope: list[str] | None,
        project_id: str | None,
        max_rounds: int,
        dry_run: bool,
    ) -> dict[str, Any]:
        with self._quality_jobs_lock:
            jobs = self._load_quality_loop_jobs()
            active = next(
                (
                    item
                    for item in jobs.values()
                    if str(item.get("status") or "") in {"pending", "running"}
                ),
                None,
            )
            if isinstance(active, dict):
                return {
                    "accepted": False,
                    "job_id": str(active.get("job_id") or ""),
                    "status_url": f"/knowledge/quality-loop/jobs/{active.get('job_id')}",
                    "reason": "QUALITY_LOOP_ALREADY_RUNNING",
                }

            rounds = max(1, min(8, int(max_rounds or 1)))
            job_id = uuid.uuid4().hex[:12]
            now = datetime.now(UTC).isoformat()
            baseline_payload = self._pick_latest_memify_result(
                dataset_scope=dataset_scope,
                project_id=project_id,
            )
            payload = {
                "job_id": job_id,
                "task_type": "quality_loop",
                "status": "pending",
                "stage": "pending",
                "current_stage": "pending",
                "stage_message": "Waiting to start quality loop",
                "progress": 0,
                "percent": 0,
                "current": 0,
                "total": rounds,
                "max_rounds": rounds,
                "dry_run": bool(dry_run),
                "dataset_scope": dataset_scope or [],
                "project_id": str(project_id or ""),
                "baseline_result": baseline_payload if isinstance(baseline_payload, dict) else None,
                "rounds": [],
                "score_before": None,
                "score_after": None,
                "delta": None,
                "stop_reason": "",
                "warnings": [],
                "error": None,
                "updated_at": now,
                "started_at": None,
                "finished_at": None,
            }
            jobs[job_id] = payload
            self._save_quality_loop_jobs(jobs)

        worker = threading.Thread(
            target=self._run_quality_loop_job,
            args=(job_id, config, dataset_scope, project_id, rounds, dry_run),
            daemon=True,
        )
        worker.start()
        return {
            "accepted": True,
            "job_id": job_id,
            "status_url": f"/knowledge/quality-loop/jobs/{job_id}",
            "estimated_rounds": rounds,
        }

    def _run_quality_loop_job(
        self,
        job_id: str,
        config: KnowledgeConfig,
        dataset_scope: list[str] | None,
        project_id: str | None,
        max_rounds: int,
        dry_run: bool,
    ) -> None:
        now = datetime.now(UTC).isoformat()
        self._patch_quality_loop_job(
            job_id,
            self._normalize_quality_loop_patch(
                {
                    "status": "running",
                    "stage": "observe",
                    "stage_message": "Collecting baseline quality snapshot",
                    "started_at": now,
                    "updated_at": now,
                }
            ),
        )

        rounds: list[dict[str, Any]] = []
        warnings: list[str] = []
        stop_reason = "MAX_ROUNDS_REACHED"
        previous_score: float | None = None
        stagnation_rounds = 0

        job_payload = self.get_quality_loop_status(job_id) or {}
        baseline_payload = (
            job_payload.get("baseline_result")
            if isinstance(job_payload.get("baseline_result"), dict)
            else None
        )
        if baseline_payload is None:
            baseline_payload = self._pick_latest_memify_result(
                dataset_scope=dataset_scope,
                project_id=project_id,
            )
        if baseline_payload is None:
            warnings.append("NO_BASELINE_MEMIFY_RESULT")
            baseline_snapshot = self._build_quality_snapshot({})
        else:
            baseline_snapshot = self._build_quality_snapshot(baseline_payload)

        score_before = float(baseline_snapshot.get("quality_score") or 0.0)
        reflection_hints = self._load_quality_reflection_hints(project_id)
        next_round_hints = dict(reflection_hints)

        for round_index in range(max_rounds):
            round_no = round_index + 1
            before_snapshot = baseline_snapshot if round_index == 0 else rounds[-1]["after"]
            actions = self._build_quality_actions(before_snapshot)

            stage_message = f"Round {round_no}: planning quality improvements"
            progress = int((round_index / max_rounds) * 100)
            self._patch_quality_loop_job(
                job_id,
                self._normalize_quality_loop_patch(
                    {
                        "status": "running",
                        "stage": "plan",
                        "stage_message": stage_message,
                        "current": round_no,
                        "total": max_rounds,
                        "progress": progress,
                        "updated_at": datetime.now(UTC).isoformat(),
                    }
                ),
            )

            if not actions:
                after_snapshot = before_snapshot
                stop_reason = "QUALITY_TARGET_MET"
            elif dry_run:
                after_snapshot = before_snapshot
                warnings.append("QUALITY_LOOP_DRY_RUN_NO_EXECUTION")
            else:
                execution_hints = self._derive_quality_execution_hints(
                    actions=actions,
                    previous_hints=reflection_hints,
                    round_no=round_no,
                    before_snapshot=before_snapshot,
                )
                next_round_hints = dict(execution_hints)
                effective_pipeline_type = (
                    "system-enrichment"
                    if str(execution_hints.get("pipeline_bias") or "") == "enrichment_focus"
                    else "full"
                )
                execution_result = self.execute_memify_once(
                    config=config,
                    pipeline_type=effective_pipeline_type,
                    dataset_scope=dataset_scope,
                    dry_run=False,
                    job_id=None,
                    progress_callback=None,
                    quality_hints=execution_hints,
                )
                if str(execution_result.get("status") or "") != "succeeded":
                    stop_reason = "MEMIFY_EXECUTION_FAILED"
                    warnings.extend(
                        [
                            str(item)
                            for item in (execution_result.get("warnings") or [])
                            if str(item).strip()
                        ]
                    )
                    rounds.append(
                        {
                            "round": round_no,
                            "before": before_snapshot,
                            "actions": actions,
                            "after": before_snapshot,
                            "delta": 0.0,
                            "status": "failed",
                            "error": execution_result.get("error") or "MEMIFY_EXECUTION_FAILED",
                        }
                    )
                    break
                after_snapshot = self._build_quality_snapshot(execution_result)

            current_score = float(after_snapshot.get("quality_score") or 0.0)
            before_score = float(before_snapshot.get("quality_score") or 0.0)
            delta = current_score - before_score
            round_stop_reason = "CONTINUE"
            if all(bool(v) for v in (after_snapshot.get("pass_flags") or {}).values()):
                round_stop_reason = "QUALITY_TARGET_MET"
            elif previous_score is not None and current_score <= previous_score + 0.005:
                round_stop_reason = "LOW_GAIN"
            round_summary = self._build_quality_round_summary(
                round_no=round_no,
                actions=actions,
                before_snapshot=before_snapshot,
                after_snapshot=after_snapshot,
                delta=delta,
                stop_or_continue_reason=round_stop_reason,
            )
            agent_gate = self._run_quality_agent_gate(
                round_no=round_no,
                actions=actions,
                before_snapshot=before_snapshot,
                after_snapshot=after_snapshot,
                round_summary=round_summary,
                previous_hints=next_round_hints,
            )
            gate_hints = agent_gate.get("next_round_hints")
            if isinstance(gate_hints, dict) and gate_hints:
                next_round_hints = dict(gate_hints)
            rounds.append(
                {
                    "round": round_no,
                    "before": before_snapshot,
                    "actions": actions,
                    "after": after_snapshot,
                    "delta": delta,
                    "status": "succeeded",
                    "summary": round_summary,
                    "agent_gate": agent_gate,
                }
            )

            if str(agent_gate.get("status") or "") != "accepted":
                stop_reason = "REVIEW_REQUIRED"
                warnings.append(str(agent_gate.get("reason") or "AGENT_GATE_REVIEW_REQUIRED"))
                break

            if all(bool(v) for v in (after_snapshot.get("pass_flags") or {}).values()):
                stop_reason = "QUALITY_TARGET_MET"
                break

            if previous_score is not None and current_score <= previous_score + 0.005:
                stagnation_rounds += 1
            else:
                stagnation_rounds = 0
            previous_score = current_score
            if stagnation_rounds >= 2:
                stop_reason = "QUALITY_STAGNATED"
                break

        score_after = float((rounds[-1]["after"]["quality_score"] if rounds else score_before) or 0.0)
        delta_total = score_after - score_before
        final_status = "failed" if stop_reason == "MEMIFY_EXECUTION_FAILED" else "succeeded"
        final_summary = {
            "score_before": score_before,
            "score_after": score_after,
            "delta": delta_total,
            "stop_reason": stop_reason,
        }
        reflection_artifacts = self._save_quality_reflection_artifacts(
            project_id=project_id,
            job_id=job_id,
            rounds=rounds,
            final_summary=final_summary,
            next_round_hints=next_round_hints,
        )
        finished = datetime.now(UTC).isoformat()
        self._patch_quality_loop_job(
            job_id,
            self._normalize_quality_loop_patch(
                {
                    "status": final_status,
                    "stage": "completed" if final_status == "succeeded" else "failed",
                    "stage_message": "Quality loop finished" if final_status == "succeeded" else "Quality loop failed",
                    "current": len(rounds),
                    "total": max_rounds,
                    "progress": 100 if final_status == "succeeded" else max(0, min(95, int(len(rounds) * 100 / max_rounds))),
                    "rounds": rounds,
                    "score_before": score_before,
                    "score_after": score_after,
                    "delta": delta_total,
                    "stop_reason": stop_reason,
                    "warnings": warnings,
                    "final_summary": final_summary,
                    "next_round_hints": next_round_hints,
                    "reflection_artifacts": reflection_artifacts,
                    "finished_at": finished,
                    "updated_at": finished,
                }
            ),
        )

    def _patch_quality_loop_job(self, job_id: str, patch: dict[str, Any]) -> None:
        with self._quality_jobs_lock:
            jobs = self._load_quality_loop_jobs()
            job = jobs.get(job_id)
            if not isinstance(job, dict):
                return
            job.update(patch)
            jobs[job_id] = job
            self._save_quality_loop_jobs(jobs)

    def get_quality_loop_status(self, job_id: str) -> dict[str, Any] | None:
        jobs = self._load_quality_loop_jobs()
        payload = jobs.get(job_id)
        if not isinstance(payload, dict):
            return None
        return self._normalize_quality_loop_patch(payload)

    def list_quality_loop_jobs(
        self,
        *,
        active_only: bool = False,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        jobs = [
            self._normalize_quality_loop_patch(job)
            for job in self._load_quality_loop_jobs().values()
            if isinstance(job, dict)
        ]
        if active_only:
            jobs = [
                job for job in jobs if str(job.get("status") or "") in {"pending", "running"}
            ]
        jobs.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
        if isinstance(limit, int) and limit > 0:
            jobs = jobs[:limit]
        return jobs

    def _load_quality_loop_jobs(self) -> dict[str, dict[str, Any]]:
        if not self.quality_loop_jobs_path.exists():
            return {}
        try:
            payload = json.loads(self.quality_loop_jobs_path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        if not isinstance(payload, dict):
            return {}
        return {str(k): v for k, v in payload.items() if isinstance(v, dict)}

    def _save_quality_loop_jobs(self, jobs: dict[str, dict[str, Any]]) -> None:
        self.knowledge_root.mkdir(parents=True, exist_ok=True)
        self.quality_loop_jobs_path.write_text(
            json.dumps(jobs, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _resolve_query_graph_path(self, config: KnowledgeConfig) -> tuple[Path, str]:
        if self.enriched_graph_path.exists():
            return self.enriched_graph_path, "l2_enriched"
        return self.local_graph_path, "l1_raw"

    def _resolve_graphify_query_graph_path(
        self,
        config: KnowledgeConfig,
        graphify_cfg: Any,
    ) -> tuple[str, str]:
        configured_graph_path = str(getattr(graphify_cfg, "graph_path", "") or "").strip()
        if self.enriched_graph_path.exists():
            return str(self.enriched_graph_path), "l2_enriched"
        if configured_graph_path:
            return configured_graph_path, "l1_raw"
        if self.local_graph_path.exists():
            return str(self.local_graph_path), "l1_raw"
        return "", "l1_raw"

    @staticmethod
    def _normalize_progress_patch(patch: dict[str, Any]) -> dict[str, Any]:
        stage = str(patch.get("stage") or patch.get("current_stage") or "pending").strip() or "pending"
        percent = int(max(0, min(100, int(patch.get("progress", patch.get("percent", 0)) or 0))))
        current = patch.get("current")
        total = patch.get("total")
        eta_seconds = patch.get("eta_seconds")
        stage_message = str(patch.get("stage_message") or "").strip()
        normalized = {
            **patch,
            "task_type": "memify",
            "current_stage": stage,
            "stage": stage,
            "progress": percent,
            "percent": percent,
            "current": int(current) if isinstance(current, (int, float)) else 0,
            "total": int(total) if isinstance(total, (int, float)) else 0,
            "eta_seconds": int(eta_seconds) if isinstance(eta_seconds, (int, float)) else None,
            "stage_message": stage_message,
        }
        return normalized

    def _build_memify_progress_callback(self, job_id: str) -> Callable[[dict[str, Any]], None]:
        def _callback(payload: dict[str, Any]) -> None:
            now = datetime.now(UTC).isoformat()
            patch = self._normalize_progress_patch(
                {
                    **payload,
                    "status": "running",
                    "updated_at": now,
                }
            )
            self._patch_memify_job(job_id, patch)

        return _callback

    @staticmethod
    def _translate_cypher_query_text(raw_query: str) -> str:
        """Translate a constrained Cypher-like query into search terms.

        MVP behavior: extract quoted literals and identifier tokens and join
        them into a lexical query string.
        """
        query = (raw_query or "").strip()
        if not query:
            return ""

        quoted_terms = [
            token.strip()
            for token in re.findall(r"['\"]([^'\"]{2,})['\"]", query)
            if token.strip()
        ]

        keyword_block = {
            "match",
            "return",
            "where",
            "with",
            "limit",
            "order",
            "by",
            "asc",
            "desc",
            "and",
            "or",
            "not",
            "contains",
            "starts",
            "ends",
            "optional",
            "call",
            "as",
            "distinct",
            "count",
        }
        identifiers = [
            token
            for token in re.findall(r"[A-Za-z_][A-Za-z0-9_]{2,}", query)
            if token.lower() not in keyword_block
        ]

        merged: list[str] = []
        seen: set[str] = set()
        for token in [*quoted_terms, *identifiers]:
            norm = token.lower()
            if norm in seen:
                continue
            seen.add(norm)
            merged.append(token)
        return " ".join(merged)

    def graph_query(
        self,
        *,
        config: KnowledgeConfig,
        query_mode: str,
        query_text: str,
        dataset_scope: list[str] | None,
        project_scope: list[str] | None,
        include_global: bool,
        top_k: int,
        timeout_sec: int,
    ) -> GraphOpsResult:
        """Run graph-like query over current knowledge backend.

        For MVP local engine, template mode is mapped to existing lexical
        retrieval and normalized into graph-like records.
        """
        _ = timeout_sec
        engine = getattr(config, "engine", "local_lexical")
        warnings: list[str] = []
        effective_query_text = query_text

        if query_mode == "cypher":
            translated = self._translate_cypher_query_text(query_text)
            if not translated:
                raise ValueError(
                    "Cypher query is empty or unsupported for MVP translation."
                )
            effective_query_text = translated
            warnings.append("CYPHER_MVP_TRANSLATED")

        if engine == "cognee":
            raise RuntimeError("Cognee graph provider is not wired yet.")

        if engine == "graphify":
            graphify_cfg = getattr(config, "graphify", None)
            try:
                graph_path_for_query, graph_layer = self._resolve_graphify_query_graph_path(
                    config,
                    graphify_cfg,
                )
                graphify_cfg_for_query = graphify_cfg
                if graphify_cfg is not None and graph_path_for_query:
                    graphify_cfg_for_query = graphify_cfg.model_copy(deep=True)
                    graphify_cfg_for_query.graph_path = graph_path_for_query

                records = graphify_query(
                    config=graphify_cfg_for_query,  # type: ignore[arg-type]
                    query_text=effective_query_text,
                    top_k=top_k,
                    dataset_scope=dataset_scope,
                )
                records = self._filter_records_by_project_scope(
                    records=records,
                    config=config,
                    project_scope=project_scope,
                    include_global=include_global,
                )
                if not records:
                    warnings.append("NO_GRAPH_RECORDS")
                return GraphOpsResult(
                    records=records,
                    summary=f"Returned {len(records)} graph-like records via Graphify.",
                    provenance={
                        "engine": engine,
                        "layer": graph_layer,
                        "graph_path": graph_path_for_query,
                        "dataset_scope": dataset_scope or [],
                        "project_scope": project_scope or [],
                        "include_global": include_global,
                        "query_mode": query_mode,
                    },
                    warnings=warnings,
                )
            except GraphifyNotConfiguredError as exc:
                fallback_ok = getattr(graphify_cfg, "fallback_to_local", True)
                if not fallback_ok:
                    raise
                warnings.append("GRAPHIFY_NOT_CONFIGURED")
                warnings.append(str(exc))
                warnings.append("GRAPHIFY_FALLBACK_TO_LOCAL_LEXICAL")
            except GraphifyError as exc:
                fallback_ok = getattr(graphify_cfg, "fallback_to_local", True)
                if not fallback_ok:
                    raise
                warnings.append("GRAPHIFY_RUNTIME_ERROR")
                warnings.append(str(exc))
                warnings.append("GRAPHIFY_FALLBACK_TO_LOCAL_LEXICAL")

        manager = KnowledgeManager(
            self.working_dir,
            knowledge_dirname=self.knowledge_dirname,
        )

        if engine == "local_lexical":
            graph_path, graph_layer = self._resolve_query_graph_path(config)
            local_graph_records = query_local_graph(
                graph_path,
                effective_query_text,
                top_k,
            )
            local_graph_records = self._filter_records_by_project_scope(
                records=local_graph_records,
                config=config,
                project_scope=project_scope,
                include_global=include_global,
            )
            if local_graph_records:
                return GraphOpsResult(
                    records=local_graph_records,
                    summary=f"Returned {len(local_graph_records)} graph relations via local graph.",
                    provenance={
                        "engine": "local_graph",
                        "layer": graph_layer,
                        "graph_path": str(graph_path),
                        "dataset_scope": dataset_scope or [],
                        "project_scope": project_scope or [],
                        "include_global": include_global,
                        "query_mode": query_mode,
                    },
                    warnings=warnings,
                )

        search_result = manager.search(
            query=effective_query_text,
            config=config,
            limit=max(1, top_k),
            project_scope=project_scope,
            include_global=include_global,
        )
        records: list[dict[str, Any]] = []
        for hit in search_result.get("hits") or []:
            snippet = (hit.get("snippet") or "").strip()
            if not snippet:
                continue
            records.append(
                {
                    "subject": hit.get("source_name") or hit.get("source_id") or "unknown",
                    "predicate": "mentions",
                    "object": snippet,
                    "score": float(hit.get("score", 0) or 0),
                    "source_id": hit.get("source_id"),
                    "source_type": hit.get("source_type"),
                    "document_path": hit.get("document_path"),
                    "document_title": hit.get("document_title"),
                }
            )

        if not records:
            warnings.append("NO_GRAPH_RECORDS")

        return GraphOpsResult(
            records=records,
            summary=f"Returned {len(records)} graph-like records.",
            provenance={
                "engine": engine,
                "dataset_scope": dataset_scope or [],
                "project_scope": project_scope or [],
                "include_global": include_global,
                "query_mode": query_mode,
            },
            warnings=warnings,
        )

    @staticmethod
    def _filter_records_by_project_scope(
        *,
        records: list[dict[str, Any]],
        config: KnowledgeConfig,
        project_scope: list[str] | None,
        include_global: bool,
    ) -> list[dict[str, Any]]:
        scope_set = {
            item.strip()
            for item in (project_scope or [])
            if item and item.strip()
        }
        if not scope_set:
            return records

        source_project_map: dict[str, str] = {}
        for source in config.sources:
            source_project_map[source.id] = (getattr(source, "project_id", "") or "").strip()

        filtered: list[dict[str, Any]] = []
        for record in records:
            source_id = str(record.get("source_id") or "").strip()
            if not source_id:
                # Unknown source cannot be safely scoped when project filter is requested.
                continue
            source_project_id = source_project_map.get(source_id, "")
            in_scope = source_project_id in scope_set
            is_global = not source_project_id
            if in_scope or (include_global and is_global):
                filtered.append(record)
        return filtered

    def run_memify(
        self,
        *,
        config: KnowledgeConfig,
        pipeline_type: str,
        dataset_scope: list[str] | None,
        idempotency_key: str,
        dry_run: bool,
    ) -> dict[str, Any]:
        """Create and run a memify job asynchronously."""
        with self._jobs_lock:
            jobs = self._load_memify_jobs()

            normalized_key = (idempotency_key or "").strip()
            if normalized_key:
                existing = next(
                    (
                        item
                        for item in jobs.values()
                        if item.get("idempotency_key") == normalized_key
                    ),
                    None,
                )
                if existing is not None:
                    return {
                        "accepted": False,
                        "job_id": existing["job_id"],
                        "status_url": f"/knowledge/memify/jobs/{existing['job_id']}",
                        "reason": "IDEMPOTENT_REUSE",
                    }

            job_id = uuid.uuid4().hex[:12]
            now = datetime.now(UTC).isoformat()
            engine = getattr(config, "engine", "local_lexical")

            job_payload = {
                "job_id": job_id,
                "pipeline_type": pipeline_type,
                "dataset_scope": dataset_scope or [],
                "idempotency_key": normalized_key,
                "dry_run": bool(dry_run),
                "status": "pending",
                "progress": 0,
                "percent": 0,
                "estimated_steps": 5,
                "task_type": "memify",
                "stage": "pending",
                "current_stage": "pending",
                "stage_message": "Waiting to start",
                "current": 0,
                "total": 0,
                "eta_seconds": None,
                "started_at": None,
                "finished_at": None,
                "error": None,
                "warnings": [],
                "engine": engine,
                "updated_at": now,
            }
            jobs[job_id] = job_payload
            self._save_memify_jobs(jobs)

        worker = threading.Thread(
            target=self._run_memify_job,
            args=(job_id, config, pipeline_type, dataset_scope, dry_run),
            daemon=True,
        )
        worker.start()

        return {
            "accepted": True,
            "job_id": job_id,
            "estimated_steps": 5,
            "status_url": f"/knowledge/memify/jobs/{job_id}",
        }

    def _run_memify_job(
        self,
        job_id: str,
        config: KnowledgeConfig,
        pipeline_type: str,
        dataset_scope: list[str] | None,
        dry_run: bool,
    ) -> None:
        self._patch_memify_job(
            job_id,
            self._normalize_progress_patch({
                "status": "running",
                "progress": 3,
                "stage": "prepare",
                "stage_message": "Preparing memify task",
                "current": 0,
                "total": 0,
                "started_at": datetime.now(UTC).isoformat(),
                "updated_at": datetime.now(UTC).isoformat(),
            }),
        )

        progress_callback = self._build_memify_progress_callback(job_id)

        memify_result = self.execute_memify_once(
            config=config,
            pipeline_type=pipeline_type,
            dataset_scope=dataset_scope,
            dry_run=dry_run,
            job_id=job_id,
            progress_callback=progress_callback,
        )

        now = datetime.now(UTC).isoformat()
        self._patch_memify_job(
            job_id,
            self._normalize_progress_patch({
                "status": str(memify_result.get("status") or "failed"),
                "progress": 100 if str(memify_result.get("status") or "") == "succeeded" else 0,
                "stage": "completed" if str(memify_result.get("status") or "") == "succeeded" else "failed",
                "stage_message": "Memify completed" if str(memify_result.get("status") or "") == "succeeded" else "Memify failed",
                "current": memify_result.get("current") or 0,
                "total": memify_result.get("total") or 0,
                "eta_seconds": 0,
                "error": memify_result.get("error"),
                "warnings": memify_result.get("warnings") or [],
                "engine": memify_result.get("engine"),
                "graph_path": memify_result.get("graph_path"),
                "relation_count": memify_result.get("relation_count"),
                "node_count": memify_result.get("node_count"),
                "document_count": memify_result.get("document_count"),
                "enrichment_status": memify_result.get("enrichment_status"),
                "enrichment_warnings": memify_result.get("enrichment_warnings"),
                "enriched_graph_path": memify_result.get("enriched_graph_path"),
                "enrichment_quality_report_path": memify_result.get(
                    "enrichment_quality_report_path",
                ),
                "enrichment_metrics": memify_result.get("enrichment_metrics"),
                "finished_at": now,
                "updated_at": now,
            }),
        )

    def execute_memify_once(
        self,
        *,
        config: KnowledgeConfig,
        pipeline_type: str,
        dataset_scope: list[str] | None,
        dry_run: bool,
        job_id: str | None = None,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
        quality_hints: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Execute one memify run synchronously and return the normalized result."""
        engine = getattr(config, "engine", "local_lexical")
        status = "failed"
        error: str | None = None
        warnings: list[str] = []
        result_engine = engine
        memify_result: dict[str, Any] = {}

        if engine == "cognee":
            error = "Cognee memify provider is not wired yet."
            warnings = ["COGNEE_PROVIDER_NOT_READY"]
        elif engine == "graphify":
            graphify_cfg = getattr(config, "graphify", None)
            try:
                memify_result = graphify_memify(
                    config=graphify_cfg,  # type: ignore[arg-type]
                    pipeline_type=pipeline_type,
                    dataset_scope=dataset_scope,
                    dry_run=dry_run,
                    progress_callback=progress_callback,
                )
                status = str(memify_result.get("status") or "failed")
                error = (
                    str(memify_result.get("error") or "").strip() or None
                )
                warnings = [
                    str(item)
                    for item in (memify_result.get("warnings") or [])
                    if str(item).strip()
                ]
                result_engine = str(memify_result.get("engine") or engine)
            except GraphifyError as exc:
                status = "failed"
                error = str(exc)
                warnings = ["GRAPHIFY_MEMIFY_ERROR"]
        else:
            if progress_callback is not None:
                progress_callback(
                    {
                        "stage": "extract",
                        "stage_message": "Building local lexical graph",
                        "progress": 50,
                        "current": 1,
                        "total": 2,
                        "eta_seconds": 1,
                    }
                )
            manager = KnowledgeManager(
                self.working_dir,
                knowledge_dirname=self.knowledge_dirname,
            )
            memify_result = persist_local_graph(
                manager,
                config,
                dataset_scope,
                self.local_graph_path,
            )
            status = str(memify_result.get("status") or "failed")
            error = str(memify_result.get("error") or "").strip() or None
            warnings = [
                str(item)
                for item in (memify_result.get("warnings") or [])
                if str(item).strip()
            ]
            result_engine = "local_graph"
            if progress_callback is not None:
                progress_callback(
                    {
                        "stage": "build",
                        "stage_message": "Local graph persisted",
                        "progress": 85,
                        "current": 2,
                        "total": 2,
                        "eta_seconds": 0,
                    }
                )

        response = {
            "job_id": job_id or "",
            "status": status,
            "error": error,
            "warnings": warnings,
            "engine": result_engine,
            "pipeline_type": pipeline_type,
            "dataset_scope": dataset_scope or [],
            "dry_run": bool(dry_run),
        }

        if status == "succeeded" and not dry_run:
            source_graph_path: Path | None = None
            if engine == "local_lexical":
                source_graph_path = self.local_graph_path
            elif engine == "graphify":
                graphify_cfg = getattr(config, "graphify", None)
                configured_graph_path = str(getattr(graphify_cfg, "graph_path", "") or "").strip()
                if configured_graph_path:
                    source_graph_path = Path(configured_graph_path)

            if source_graph_path is None or not source_graph_path.exists():
                warnings.append("ENRICHMENT_SOURCE_GRAPH_NOT_FOUND")
                response.update({
                    "enrichment_status": "skipped",
                    "enrichment_warnings": ["ENRICHMENT_SOURCE_GRAPH_NOT_FOUND"],
                })
            else:
                try:
                    enrichment_result = run_system_knowledge_enrichment(
                        source_graph_path=source_graph_path,
                        enriched_graph_path=self.enriched_graph_path,
                        quality_report_path=self.enrichment_quality_report_path,
                        pipeline_id=str(
                            getattr(
                                config,
                                "enrichment_pipeline_id",
                                "system-knowledge-enrichment-v1",
                            )
                            or "system-knowledge-enrichment-v1"
                        ),
                        quality_policy=(quality_hints or {}).get("quality_policy")
                        if isinstance(quality_hints, dict)
                        else None,
                    )
                    warnings.extend(enrichment_result.warnings)
                    response.update(
                        {
                            "warnings": warnings,
                            "enrichment_status": enrichment_result.status,
                            "enrichment_warnings": enrichment_result.warnings,
                            "enriched_graph_path": enrichment_result.enriched_graph_path,
                            "enrichment_quality_report_path": enrichment_result.quality_report_path,
                            "enrichment_metrics": enrichment_result.metrics,
                        },
                    )
                except Exception as exc:
                    warnings.append("ENRICHMENT_PIPELINE_FAILED")
                    warnings.append(str(exc))
                    response.update(
                        {
                            "warnings": warnings,
                            "enrichment_status": "failed",
                            "enrichment_warnings": [
                                "ENRICHMENT_PIPELINE_FAILED",
                                str(exc),
                            ],
                        },
                    )

        if engine == "local_lexical":
            response.update(
                {
                    "graph_path": str(self.local_graph_path),
                    "relation_count": int(memify_result.get("relation_count") or 0),
                    "node_count": int(memify_result.get("node_count") or 0),
                    "document_count": int(memify_result.get("document_count") or 0),
                }
            )
        elif engine == "graphify":
            response.update(
                {
                    "graph_path": str(memify_result.get("graph_path") or ""),
                    "relation_count": int(memify_result.get("relation_count") or 0),
                    "node_count": int(memify_result.get("node_count") or 0),
                    "document_count": int(memify_result.get("document_count") or 0),
                }
            )

        if progress_callback is not None:
            progress_callback(
                {
                    "stage": "finalize",
                    "stage_message": "Finalizing memify result",
                    "progress": 95,
                    "current": 1,
                    "total": 1,
                    "eta_seconds": 0,
                }
            )
        return response

    def _patch_memify_job(self, job_id: str, patch: dict[str, Any]) -> None:
        with self._jobs_lock:
            jobs = self._load_memify_jobs()
            job = jobs.get(job_id)
            if not isinstance(job, dict):
                return
            job.update(patch)
            jobs[job_id] = job
            self._save_memify_jobs(jobs)

    def get_memify_status(self, job_id: str) -> dict[str, Any] | None:
        jobs = self._load_memify_jobs()
        job = jobs.get(job_id)
        if not isinstance(job, dict):
            return None
        return self._normalize_progress_patch(job)

    def list_memify_jobs(
        self,
        *,
        active_only: bool = False,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        jobs = [
            self._normalize_progress_patch(job)
            for job in self._load_memify_jobs().values()
            if isinstance(job, dict)
        ]
        if active_only:
            jobs = [
                job for job in jobs if str(job.get("status") or "") in {"pending", "running"}
            ]
        jobs.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
        if isinstance(limit, int) and limit > 0:
            jobs = jobs[:limit]
        return jobs

    def _load_memify_jobs(self) -> dict[str, dict[str, Any]]:
        if not self.memify_jobs_path.exists():
            return {}
        try:
            payload = json.loads(self.memify_jobs_path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        if not isinstance(payload, dict):
            return {}
        return {str(key): value for key, value in payload.items() if isinstance(value, dict)}

    def _save_memify_jobs(self, jobs: dict[str, dict[str, Any]]) -> None:
        self.knowledge_root.mkdir(parents=True, exist_ok=True)
        self.memify_jobs_path.write_text(
            json.dumps(jobs, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )