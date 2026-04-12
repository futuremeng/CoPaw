# -*- coding: utf-8 -*-
"""Bridge layer for graph-oriented knowledge operations.

This module provides a lightweight manager used by graph tools. It keeps
current MVP behavior compatible while reserving integration points for
graph-provider implementations (for example, Cognee/Graphify).
"""

from __future__ import annotations

import json
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
        self.local_graph_path = self.knowledge_root / "graphify-out" / "graph.json"
        self.enriched_graph_path = self.knowledge_root / "graphify-out" / "graph.enriched.json"
        self.enrichment_quality_report_path = (
            self.knowledge_root / "graphify-out" / "enrichment-quality-report.json"
        )
        self._jobs_lock = threading.Lock()

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