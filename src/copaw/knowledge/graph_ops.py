# -*- coding: utf-8 -*-
"""Bridge layer for graph-oriented knowledge operations.

This module provides a lightweight manager used by graph tools. It keeps
current MVP behavior compatible while reserving integration points for
graph-provider implementations (for example, Cognee/Graphify).
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..config.config import KnowledgeConfig
from ..constant import WORKING_DIR
from .graphify_provider import (
    GraphifyError,
    GraphifyNotConfiguredError,
    graphify_memify,
    graphify_query,
)
from .manager import KnowledgeManager


@dataclass
class GraphOpsResult:
    records: list[dict[str, Any]]
    summary: str
    provenance: dict[str, Any]
    warnings: list[str]


class GraphOpsManager:
    """Graph operation facade for tool-layer usage."""

    def __init__(self, working_dir: Path | str = WORKING_DIR) -> None:
        self.working_dir = Path(working_dir)
        self.knowledge_root = self.working_dir / "knowledge"
        self.memify_jobs_path = self.knowledge_root / "memify-jobs.json"

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

        if query_mode == "cypher" and engine == "local_lexical":
            return GraphOpsResult(
                records=[],
                summary="Cypher mode is not available on local_lexical engine.",
                provenance={"engine": engine, "dataset_scope": dataset_scope or []},
                warnings=["CYPHER_UNAVAILABLE_ON_LOCAL_ENGINE"],
            )

        if query_mode == "cypher" and engine == "graphify":
            return GraphOpsResult(
                records=[],
                summary="Cypher mode is not available until Graphify provider is wired.",
                provenance={"engine": engine, "dataset_scope": dataset_scope or []},
                warnings=["GRAPHIFY_CYPHER_NOT_READY"],
            )

        if engine == "cognee":
            raise RuntimeError("Cognee graph provider is not wired yet.")

        if engine == "graphify":
            graphify_cfg = getattr(config, "graphify", None)
            try:
                records = graphify_query(
                    config=graphify_cfg,  # type: ignore[arg-type]
                    query_text=query_text,
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

        manager = KnowledgeManager(self.working_dir)
        search_result = manager.search(
            query=query_text,
            config=config,
            limit=max(1, min(top_k, 50)),
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
        """Create a memify job record.

        The local lexical engine stores a no-op success job so tool contracts
        and job observability can be validated before real graph-provider
        wiring.
        """
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

        if engine == "cognee":
            status = "failed"
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
                )
                status = memify_result["status"]
                error = memify_result.get("error")
                warnings = memify_result.get("warnings", [])
            except GraphifyError as exc:
                status = "failed"
                error = str(exc)
                warnings = ["GRAPHIFY_MEMIFY_ERROR"]
        else:
            status = "succeeded"
            error = None
            warnings = ["LOCAL_ENGINE_MEMIFY_NOOP"]

        job_payload = {
            "job_id": job_id,
            "pipeline_type": pipeline_type,
            "dataset_scope": dataset_scope or [],
            "idempotency_key": normalized_key,
            "dry_run": bool(dry_run),
            "status": status,
            "progress": 100 if status == "succeeded" else 0,
            "estimated_steps": 1,
            "started_at": now,
            "finished_at": now,
            "error": error,
            "warnings": warnings,
            "engine": engine,
            "updated_at": now,
        }
        jobs[job_id] = job_payload
        self._save_memify_jobs(jobs)

        return {
            "accepted": True,
            "job_id": job_id,
            "estimated_steps": 1,
            "status_url": f"/knowledge/memify/jobs/{job_id}",
        }

    def get_memify_status(self, job_id: str) -> dict[str, Any] | None:
        jobs = self._load_memify_jobs()
        return jobs.get(job_id)

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