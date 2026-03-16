# -*- coding: utf-8 -*-
"""Cognee-backed knowledge engine adapter (optional dependency)."""

from __future__ import annotations

import asyncio
import importlib
import json
import logging
import re
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ..config.config import KnowledgeConfig, KnowledgeSourceSpec

logger = logging.getLogger(__name__)


class CogneeEngine:
    """Adapter that routes indexing/search calls to cognee when available."""

    def __init__(self, index_dir: Path):
        self.index_dir = index_dir

    @staticmethod
    def _sanitize_token(text: str) -> str:
        cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", (text or "").strip())
        return cleaned.strip("-") or "unknown"

    def _dataset_name(self, source: KnowledgeSourceSpec, config: KnowledgeConfig) -> str:
        prefix = self._sanitize_token(getattr(config.cognee, "dataset_prefix", "copaw"))
        source_key = self._sanitize_token(source.id)
        return f"{prefix}-{source_key}"

    @staticmethod
    def _run_async(coro):
        """Run async cognee calls from both sync and async call paths."""
        try:
            asyncio.get_running_loop()
            in_event_loop = True
        except RuntimeError:
            in_event_loop = False

        if not in_event_loop:
            return asyncio.run(coro)

        result_box: dict[str, Any] = {}
        error_box: dict[str, BaseException] = {}

        def _runner() -> None:
            try:
                result_box["value"] = asyncio.run(coro)
            except BaseException as exc:  # pragma: no cover - passthrough
                error_box["error"] = exc

        thread = threading.Thread(target=_runner, daemon=True)
        thread.start()
        thread.join()
        if "error" in error_box:
            raise error_box["error"]
        return result_box.get("value")

    @staticmethod
    def _load_cognee_modules() -> tuple[Any, Any | None]:
        try:
            cognee = importlib.import_module("cognee")
        except ImportError as exc:
            raise RuntimeError(
                "Cognee engine selected but package 'cognee' is not installed",
            ) from exc

        search_types_module = None
        try:
            search_types_module = importlib.import_module("cognee.modules.search.types")
        except ImportError:
            # SearchType enum may not be available in all versions; string fallback is used.
            search_types_module = None

        return cognee, search_types_module

    @staticmethod
    def _resolve_query_type(query_type_name: str, search_types_module: Any | None) -> Any:
        if search_types_module is None:
            return query_type_name
        search_type_enum = getattr(search_types_module, "SearchType", None)
        if search_type_enum is None:
            return query_type_name
        return getattr(search_type_enum, query_type_name, query_type_name)

    @staticmethod
    def _extract_payload(source: KnowledgeSourceSpec) -> str:
        if source.content and source.content.strip():
            return source.content.strip()
        if source.location and source.location.strip():
            return source.location.strip()
        raise ValueError(
            f"Knowledge source '{source.id}' has no ingestable content for cognee",
        )

    @staticmethod
    def _stringify_item(item: Any) -> str:
        if isinstance(item, str):
            return item.strip()
        if isinstance(item, dict):
            for key in (
                "snippet",
                "text",
                "content",
                "description",
                "summary",
                "result",
                "answer",
            ):
                value = item.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
            return json.dumps(item, ensure_ascii=False)
        if isinstance(item, (list, tuple)):
            joined = "\n".join(CogneeEngine._stringify_item(x) for x in item)
            return joined.strip()
        return str(item).strip()

    @staticmethod
    def _iter_items(raw: Any):
        if isinstance(raw, list):
            for item in raw:
                yield from CogneeEngine._iter_items(item)
            return
        if isinstance(raw, tuple):
            for item in raw:
                yield from CogneeEngine._iter_items(item)
            return
        yield raw

    def _index_path(self, source_id: str) -> Path:
        return self.index_dir / f"{source_id}.json"

    def _write_meta_index(
        self,
        source: KnowledgeSourceSpec,
        *,
        indexed_at: str,
        preview_text: str,
    ) -> None:
        preview = preview_text.strip()
        payload = {
            "source": source.model_dump(mode="json"),
            "indexed_at": indexed_at,
            "document_count": 1,
            "chunk_count": 1,
            "error": None,
            "backend": "cognee",
            "chunks": [
                {
                    "document_path": source.location or source.id,
                    "document_title": source.name,
                    "text": preview[:800],
                }
            ],
        }
        self._index_path(source.id).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def index_source(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig,
        running_config: Any | None = None,
    ) -> dict[str, Any]:
        _ = running_config
        payload = self._extract_payload(source)
        dataset_name = self._dataset_name(source, config)
        cognee, _ = self._load_cognee_modules()

        async def _index_pipeline() -> None:
            try:
                await cognee.add(payload, dataset_name=dataset_name)
            except TypeError:
                try:
                    await cognee.add(payload, dataset_name)
                except TypeError:
                    await cognee.add(payload)

            try:
                await cognee.cognify([dataset_name])
            except TypeError:
                try:
                    await cognee.cognify(datasets=[dataset_name])
                except TypeError:
                    await cognee.cognify()

        self._run_async(_index_pipeline())

        indexed_at = datetime.now(UTC).isoformat()
        self._write_meta_index(source, indexed_at=indexed_at, preview_text=payload)
        return {
            "source_id": source.id,
            "document_count": 1,
            "chunk_count": 1,
            "indexed_at": indexed_at,
            "backend": "cognee",
            "dataset": dataset_name,
        }

    def index_all(
        self,
        config: KnowledgeConfig,
        running_config: Any | None = None,
    ) -> dict[str, Any]:
        results = []
        for source in config.sources:
            if not source.enabled:
                continue
            results.append(self.index_source(source, config, running_config))
        return {
            "indexed_sources": len(results),
            "results": results,
            "backend": "cognee",
        }

    def delete_index(
        self,
        source_id: str,
        config: KnowledgeConfig,
    ) -> None:
        index_path = self._index_path(source_id)
        if index_path.exists():
            index_path.unlink()

        source = next((item for item in config.sources if item.id == source_id), None)
        if source is None:
            return

        dataset_name = self._dataset_name(source, config)
        try:
            cognee, _ = self._load_cognee_modules()
        except Exception:
            return

        async def _delete_dataset() -> None:
            delete_fn = getattr(cognee, "delete", None)
            if delete_fn is None:
                return
            try:
                await delete_fn(datasets=[dataset_name])
            except TypeError:
                try:
                    await delete_fn(dataset_name)
                except Exception:
                    logger.debug("Cognee delete signature not matched", exc_info=True)

        try:
            self._run_async(_delete_dataset())
        except Exception:
            logger.warning(
                "Failed to delete cognee dataset '%s' for source '%s'",
                dataset_name,
                source_id,
                exc_info=True,
            )

    def search(
        self,
        query: str,
        config: KnowledgeConfig,
        limit: int = 10,
        source_ids: list[str] | None = None,
        source_types: list[str] | None = None,
    ) -> dict[str, Any]:
        cognee, search_types_module = self._load_cognee_modules()

        sources = [
            source
            for source in config.sources
            if (not source_ids or source.id in source_ids)
            and (not source_types or source.type in source_types)
        ]
        if not sources:
            return {"query": query, "hits": []}

        datasets = [self._dataset_name(source, config) for source in sources]
        dataset_to_source = dict(zip(datasets, sources, strict=True))

        chunks_type = self._resolve_query_type(
            config.cognee.chunks_query_type,
            search_types_module,
        )
        graph_type = self._resolve_query_type(
            config.cognee.graph_query_type,
            search_types_module,
        )
        search_mode = getattr(config.cognee, "search_mode", "hybrid")

        async def _search_pipeline() -> dict[str, Any]:
            chunks_results: Any = []
            graph_results: Any = []

            if search_mode in {"hybrid", "chunks"}:
                try:
                    chunks_results = await cognee.search(
                        query_text=query,
                        query_type=chunks_type,
                        top_k=limit,
                        datasets=datasets,
                    )
                except TypeError:
                    try:
                        chunks_results = await cognee.search(
                            query,
                            query_type=chunks_type,
                            top_k=limit,
                            datasets=datasets,
                        )
                    except Exception:
                        logger.debug("Cognee CHUNKS search call failed", exc_info=True)

            if search_mode in {"hybrid", "graph"}:
                try:
                    graph_results = await cognee.search(
                        query_text=query,
                        query_type=graph_type,
                        top_k=limit,
                        datasets=datasets,
                    )
                except TypeError:
                    try:
                        graph_results = await cognee.search(
                            query,
                            query_type=graph_type,
                            top_k=limit,
                            datasets=datasets,
                        )
                    except Exception:
                        logger.debug(
                            "Cognee GRAPH_COMPLETION search call failed",
                            exc_info=True,
                        )

            return {
                "chunks": chunks_results,
                "graph": graph_results,
            }

        raw_result = self._run_async(_search_pipeline())
        raw = raw_result if isinstance(raw_result, dict) else {}

        hits: list[dict[str, Any]] = []
        rank = 0
        for result_kind in ("graph", "chunks"):
            entries = raw.get(result_kind, [])
            for item in self._iter_items(entries):
                snippet = self._stringify_item(item)
                if not snippet:
                    continue
                rank += 1

                source_id = None
                if isinstance(item, dict):
                    source_id = item.get("source_id")
                    dataset = item.get("dataset")
                    if not source_id and isinstance(dataset, str):
                        mapped = dataset_to_source.get(dataset)
                        if mapped is not None:
                            source_id = mapped.id
                if source_id is None:
                    source_id = sources[0].id

                source = next((s for s in sources if s.id == source_id), sources[0])
                score = 1.0 / rank
                if isinstance(item, dict) and item.get("score") is not None:
                    try:
                        score_value = item.get("score")
                        if score_value is not None:
                            score = float(score_value)
                    except (TypeError, ValueError):
                        pass

                hits.append(
                    {
                        "source_id": source.id,
                        "source_name": source.name,
                        "source_type": source.type,
                        "document_path": source.location or source.id,
                        "document_title": source.name,
                        "score": score,
                        "snippet": snippet[:1200],
                    },
                )

        hits.sort(key=lambda item: item["score"], reverse=True)
        return {"query": query, "hits": hits[:limit], "backend": "cognee"}

    def get_source_documents(self, source_id: str) -> dict[str, Any]:
        index_path = self._index_path(source_id)
        if not index_path.exists():
            return {"indexed": False, "documents": []}

        payload = json.loads(index_path.read_text(encoding="utf-8"))
        chunks = payload.get("chunks", [])
        documents = [
            {
                "path": chunk.get("document_path") or source_id,
                "title": chunk.get("document_title") or source_id,
                "text": chunk.get("text", ""),
            }
            for chunk in chunks
        ]
        return {
            "indexed": True,
            "indexed_at": payload.get("indexed_at"),
            "document_count": payload.get("document_count", len(documents)),
            "chunk_count": payload.get("chunk_count", len(chunks)),
            "documents": documents,
            "backend": "cognee",
        }
