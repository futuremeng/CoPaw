# -*- coding: utf-8 -*-
"""Bridge layer for graph-oriented knowledge operations.

This module provides a lightweight manager used by graph tools. It keeps
current MVP behavior compatible while reserving integration points for
Cognee-backed implementations.
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
from .cognee_engine import CogneeEngine
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
        self.index_dir = self.knowledge_root / "indexes"

    def graph_query(
        self,
        *,
        config: KnowledgeConfig,
        query_mode: str,
        query_text: str,
        dataset_scope: list[str] | None,
        top_k: int,
        timeout_sec: int,
    ) -> GraphOpsResult:
        """Run graph-like query over current knowledge backend.

        For MVP local engine, template mode is mapped to existing lexical
        retrieval and normalized into graph-like records.
        """
        _ = timeout_sec
        engine = self._resolve_engine_name(config)
        warnings: list[str] = []

        if query_mode == "cypher" and engine != "cognee":
            return GraphOpsResult(
                records=[],
                summary="Cypher mode is not available on local_lexical engine.",
                provenance={"engine": engine, "dataset_scope": dataset_scope or []},
                warnings=["CYPHER_UNAVAILABLE_ON_LOCAL_ENGINE"],
            )

        if engine == "cognee":
            return self._graph_query_with_cognee(
                config=config,
                query_mode=query_mode,
                query_text=query_text,
                dataset_scope=dataset_scope,
                top_k=top_k,
            )

        manager = KnowledgeManager(self.working_dir)
        search_result = manager.search(
            query=query_text,
            config=config,
            limit=max(1, min(top_k, 50)),
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
                "query_mode": query_mode,
            },
            warnings=warnings,
        )

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
        and job observability can be validated before real Cognee wiring.
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
        engine = self._resolve_engine_name(config)

        if engine == "cognee":
            status, error, warnings = self._run_cognee_memify(
                config=config,
                pipeline_type=pipeline_type,
                dataset_scope=dataset_scope,
                dry_run=bool(dry_run),
            )
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

    def _graph_query_with_cognee(
        self,
        *,
        config: KnowledgeConfig,
        query_mode: str,
        query_text: str,
        dataset_scope: list[str] | None,
        top_k: int,
    ) -> GraphOpsResult:
        cognee_engine = CogneeEngine(self.index_dir)

        if query_mode == "template":
            source_ids = dataset_scope or None
            search_result = cognee_engine.search(
                query=query_text,
                config=config,
                limit=max(1, min(top_k, 50)),
                source_ids=source_ids,
                source_types=None,
            )
            records = [
                {
                    "subject": hit.get("source_name") or hit.get("source_id") or "unknown",
                    "predicate": "related_to",
                    "object": (hit.get("snippet") or "").strip(),
                    "score": float(hit.get("score", 0) or 0),
                    "source_id": hit.get("source_id"),
                    "source_type": hit.get("source_type"),
                    "document_path": hit.get("document_path"),
                    "document_title": hit.get("document_title"),
                }
                for hit in (search_result.get("hits") or [])
                if (hit.get("snippet") or "").strip()
            ]
            return GraphOpsResult(
                records=records,
                summary=f"Returned {len(records)} graph-like records from cognee search.",
                provenance={
                    "engine": "cognee",
                    "dataset_scope": dataset_scope or [],
                    "query_mode": query_mode,
                },
                warnings=[] if records else ["NO_GRAPH_RECORDS"],
            )

        # cypher mode: direct cognee search with CYPHER retriever
        cognee_module, search_types_module = cognee_engine._load_cognee_modules()
        cypher_type = cognee_engine._resolve_query_type("CYPHER", search_types_module)

        datasets = None
        if dataset_scope:
            datasets = list(dataset_scope)
        else:
            datasets = [
                cognee_engine._dataset_name(source, config)
                for source in (config.sources or [])
                if source.enabled
            ]

        async def _cypher_search() -> Any:
            try:
                return await cognee_module.search(
                    query_text=query_text,
                    query_type=cypher_type,
                    top_k=max(1, min(top_k, 50)),
                    datasets=datasets,
                )
            except TypeError:
                return await cognee_module.search(
                    query_text,
                    query_type=cypher_type,
                    top_k=max(1, min(top_k, 50)),
                    datasets=datasets,
                )

        raw = cognee_engine._run_async(_cypher_search())
        items = raw if isinstance(raw, list) else [raw]
        records = [
            {
                "subject": "cypher",
                "predicate": "returns",
                "object": CogneeEngine._stringify_item(item),
                "score": 1.0,
                "source_id": None,
                "source_type": "graph",
                "document_path": "",
                "document_title": "cypher",
            }
            for item in items
            if CogneeEngine._stringify_item(item)
        ]
        return GraphOpsResult(
            records=records,
            summary=f"Returned {len(records)} cypher records from cognee.",
            provenance={
                "engine": "cognee",
                "dataset_scope": dataset_scope or [],
                "query_mode": query_mode,
            },
            warnings=[] if records else ["NO_CYPHER_RECORDS"],
        )

    def _run_cognee_memify(
        self,
        *,
        config: KnowledgeConfig,
        pipeline_type: str,
        dataset_scope: list[str] | None,
        dry_run: bool,
    ) -> tuple[str, str | None, list[str]]:
        if dry_run:
            return ("succeeded", None, ["COGNEE_MEMIFY_DRY_RUN"])

        cognee_engine = CogneeEngine(self.index_dir)
        cognee_module, _ = cognee_engine._load_cognee_modules()

        dataset_names: list[str] | None = None
        if dataset_scope:
            dataset_names = list(dataset_scope)
        else:
            dataset_names = [
                cognee_engine._dataset_name(source, config)
                for source in (config.sources or [])
                if source.enabled
            ]

        async def _run() -> None:
            if pipeline_type == "default":
                fn = getattr(cognee_module, "memify", None)
                if fn is None:
                    raise RuntimeError("cognee.memify is not available")
                try:
                    await fn(datasets=dataset_names)
                except TypeError:
                    await fn()
                return

            fn_name_map = {
                "coding_rules": "memify_coding_rules",
                "triplet_embeddings": "memify_triplet_embeddings",
                "session_persistence": "memify_session_persistence",
                "entity_consolidation": "memify_entity_consolidation",
            }
            fn_name = fn_name_map.get(pipeline_type)
            if not fn_name:
                raise RuntimeError(f"Unsupported memify pipeline: {pipeline_type}")

            fn = getattr(cognee_module, fn_name, None)
            if fn is None:
                raise RuntimeError(f"cognee.{fn_name} is not available")
            try:
                await fn(datasets=dataset_names)
            except TypeError:
                await fn()

        try:
            cognee_engine._run_async(_run())
            return ("succeeded", None, ["COGNEE_MEMIFY_EXECUTED"])
        except Exception as exc:
            return ("failed", str(exc), ["COGNEE_MEMIFY_FAILED"])

    @staticmethod
    def _resolve_engine_name(config: KnowledgeConfig) -> str:
        """Normalize knowledge engine config to a string backend name."""
        engine_cfg = getattr(config, "engine", "local_lexical")
        if isinstance(engine_cfg, str):
            return engine_cfg

        provider = getattr(engine_cfg, "provider", "default")
        return "cognee" if provider == "cognee" else "local_lexical"