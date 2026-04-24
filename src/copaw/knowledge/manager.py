# -*- coding: utf-8 -*-
"""File-backed knowledge source indexing and search."""

from __future__ import annotations

import fnmatch
import hashlib
import json
import logging
import re
import shutil
from collections import Counter
from datetime import UTC, datetime, timedelta
from html import escape, unescape
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, parse_qs

import httpx

from ..constant import CHATS_FILE
from ..config.config import KnowledgeConfig, KnowledgeSourceSpec
from .hanlp_runtime import HanLPSidecarRuntime

_UNSAFE_FILENAME_RE = re.compile(r'[\\/:*?"<>|]')
_CHAT_URL_RE = re.compile(
    r"https?://[A-Za-z0-9._~:/?#\[\]@!$&'()+,;=%-]+",
    re.IGNORECASE,
)
_URL_TRAILING_STRIP_CHARS = ".,;:!?)]}\"'`*，。！？；：、）】》〉」』"

# URL exclusion helpers
_URL_SENSITIVE_PARAMS = frozenset({
    "access_token", "token", "api_key", "apikey", "apitoken",
    "secret", "password", "auth", "key", "webhook_token",
    "sign", "signature", "hmac",
})
_PRIVATE_HOST_RE = re.compile(
    r"^("
    r"localhost"
    r"|127(?:\.\d{1,3}){3}"
    r"|0\.0\.0\.0"
    r"|10(?:\.\d{1,3}){3}"
    r"|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}"
    r"|192\.168(?:\.\d{1,3}){2}"
    r"|::1"
    r"|\[::1\]"
    r")$",
    re.IGNORECASE,
)
_TITLE_WORD_RE = re.compile(r"[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}")
_TITLE_SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？.!?])\s+|[\n\r]+")
_TITLE_STOP_WORDS = {
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "from",
    "into",
    "chat",
    "auto",
    "source",
    "message",
    "messages",
    "knowledge",
    "data",
    "content",
    "session",
    "用户",
    "助手",
    "自动",
    "来源",
    "消息",
    "内容",
    "知识",
    "数据",
}
_LIGHTWEIGHT_TOKEN_RE = re.compile(r"[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*|[\u4e00-\u9fff]{2,}")
_SEMANTIC_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}")
_SEMANTIC_STOP_WORDS = {
    *_TITLE_STOP_WORDS,
    "is",
    "are",
    "was",
    "were",
    "be",
    "to",
    "of",
    "in",
    "on",
    "at",
    "by",
    "or",
    "as",
    "it",
    "an",
    "a",
    "关键词",
    "关键",
    "词",
}
_KEYWORD_DEFAULT_TOP_N = 3

# Bump this version whenever chunking/normalization logic changes.
KNOWLEDGE_PROCESSING_VERSION = "2"
_TEXTUAL_CONTENT_TYPE_MARKERS = (
    "text/",
    "application/json",
    "application/xml",
    "application/xhtml+xml",
    "application/javascript",
    "application/x-javascript",
    "application/ld+json",
)
_TEXT_FILE_ENCODINGS = (
    "utf-8",
    "utf-8-sig",
    "utf-16",
    "utf-16-le",
    "utf-16-be",
    "gb18030",
)
_INTERNAL_EXCLUDED_DIRS = {
    ".knowledge",
    ".git",
    "__pycache__",
    "node_modules",
    ".pytest_cache",
    ".mypy_cache",
}
_INTERNAL_EXCLUDED_FILENAMES = {
    ".ds_store",
    "thumbs.db",
}

logger = logging.getLogger(__name__)
_AUTO_COLLECT_URL_MIN_CONTENT_CHARS = 1000


def _sanitize_filename(name: str) -> str:
    return _UNSAFE_FILENAME_RE.sub("--", name)


class KnowledgeManager:
    """Manage knowledge source indexing within the CoPaw working directory."""

    def __init__(
        self,
        working_dir: str | Path,
        *,
        knowledge_dirname: str = "knowledge",
    ):
        self.working_dir = Path(working_dir).expanduser().resolve()
        self.root_dir = self.working_dir / knowledge_dirname
        self.raw_dir = self.root_dir / "raw"
        self.chunks_dir = self.root_dir / "chunks"
        self.ner_dir = self.root_dir / "ner"
        self.sources_dir = self.root_dir / "sources"
        self.catalog_path = self.root_dir / "catalog.json"
        self.uploads_dir = self.root_dir / "uploads"
        self.backfill_state_path = self.root_dir / "history-backfill-state.json"
        self.backfill_progress_path = self.root_dir / "history-backfill-progress.json"
        self.remote_dir = self.uploads_dir / "remote"
        self.remote_blob_dir = self.remote_dir / "blobs"
        self.remote_meta_dir = self.remote_dir / "url-meta"
        legacy_index_dir = self.root_dir / "indexes"
        if legacy_index_dir.exists():
            shutil.rmtree(legacy_index_dir, ignore_errors=True)
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.chunks_dir.mkdir(parents=True, exist_ok=True)
        self.ner_dir.mkdir(parents=True, exist_ok=True)
        self.sources_dir.mkdir(parents=True, exist_ok=True)
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.remote_blob_dir.mkdir(parents=True, exist_ok=True)
        self.remote_meta_dir.mkdir(parents=True, exist_ok=True)
        self._semantic_runtime = HanLPSidecarRuntime()
        self._hanlp2_state: dict[str, str] | None = None

    def list_sources(
        self,
        config: KnowledgeConfig,
        include_semantic: bool = True,
    ) -> list[dict[str, Any]]:
        """Return configured sources with index metadata when available."""
        results: list[dict[str, Any]] = []
        for source in config.sources:
            payload = source.model_dump(mode="json")
            if include_semantic:
                processed = self._process_source_knowledge(source, config)
                payload["subject"] = processed.get("subject") or source.name
                payload["summary"] = processed.get("summary") or source.summary
                payload["keywords"] = processed.get("keywords") or []
                payload["semantic_status"] = self.get_semantic_engine_state(config)
            else:
                payload["subject"] = source.name
                payload["summary"] = source.summary
                payload["keywords"] = []
            payload["status"] = self.get_source_status(source.id, source, config)
            results.append(payload)
        return results

    def get_semantic_engine_state(
        self,
        config: KnowledgeConfig | None = None,
    ) -> dict[str, str]:
        state = self._hanlp2_state
        if state is not None and state.get("status") == "error":
            return state
        runtime_state = self._semantic_runtime.probe(config)
        return self._remember_semantic_engine_state(runtime_state)

    def _remember_semantic_engine_state(self, payload: dict[str, Any]) -> dict[str, str]:
        return self._semantic_engine_state(
            status=str(payload.get("status") or "unavailable"),
            reason_code=str(payload.get("reason_code") or "HANLP2_SIDECAR_EXEC_FAILED"),
            reason=str(payload.get("reason") or "HanLP2 semantic engine is unavailable."),
        )

    def _semantic_engine_state(
        self,
        *,
        status: str,
        reason_code: str,
        reason: str,
    ) -> dict[str, str]:
        state = {
            "engine": "hanlp2",
            "status": status,
            "reason_code": reason_code,
            "reason": reason,
        }
        self._hanlp2_state = state
        return state

    def normalize_source_name(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig | None = None,
    ) -> KnowledgeSourceSpec:
        """Return a source with auto-generated name derived from its content/location."""
        return self._source_with_auto_name(source, config)

    def get_source_status(
        self,
        source_id: str,
        source: KnowledgeSourceSpec | None = None,
        config: KnowledgeConfig | None = None,
        running_config: Any | None = None,
    ) -> dict[str, Any]:
        """Return persisted index metadata for a source."""
        source_index_path = self._source_index_path(source_id)
        if not source_index_path.exists():
            status = {
                "indexed": False,
                "indexed_at": None,
                "document_count": 0,
                "chunk_count": 0,
                "sentence_count": 0,
                "char_count": 0,
                "token_count": 0,
                "needs_reindex": bool(config),
                "error": None,
            }
            if source is not None:
                status.update(self._remote_source_status(source))
            return status

        payload = self._load_json(source_index_path)
        chunks = payload.get("chunks") or []
        needs_reindex = False
        if config is not None:
            current_fingerprint = self.compute_processing_fingerprint(config, running_config)
            stored_fingerprint = str(payload.get("processing_fingerprint") or "")
            needs_reindex = current_fingerprint != stored_fingerprint
        status = {
            "indexed": True,
            "indexed_at": payload.get("indexed_at"),
            "document_count": payload.get("document_count", 0),
            "chunk_count": payload.get("chunk_count", 0),
            "sentence_count": payload.get(
                "sentence_count",
                self._sum_chunk_sentence_count(chunks),
            ),
            "char_count": payload.get(
                "char_count",
                self._sum_chunk_char_count(chunks),
            ),
            "token_count": payload.get(
                "token_count",
                self._sum_chunk_token_count(chunks),
            ),
            "needs_reindex": needs_reindex,
            "error": payload.get("error"),
        }
        if source is not None:
            status.update(self._remote_source_status(source))
        return status

    def index_source(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig,
        running_config: Any | None = None,
    ) -> dict[str, Any]:
        """Index a single source into chunked JSON files."""
        indexed_at = datetime.now(UTC).isoformat()
        live_documents = self._load_documents(source, config)
        documents = self._prepare_documents_for_indexing(
            source,
            live_documents,
            indexed_at=indexed_at,
        )
        chunks = self._chunk_documents(
            documents,
            self._resolve_chunk_size(config, running_config),
        )
        sentence_count = self._sum_chunk_sentence_count(chunks)
        document_stats = self._build_document_stats(documents)
        processing_fingerprint = self.compute_processing_fingerprint(config, running_config)
        payload = {
            "source": source.model_dump(mode="json"),
            "indexed_at": indexed_at,
            "document_count": len(live_documents),
            "snapshot_count": len(documents),
            "chunk_count": len(chunks),
            "sentence_count": sentence_count,
            "char_count": document_stats["char_count"],
            "token_count": document_stats["token_count"],
            "processing_fingerprint": processing_fingerprint,
            "error": None,
            "chunks": chunks,
        }
        self._write_source_storage(source, payload, live_documents, config=config)
        return {
            "source_id": source.id,
            "document_count": len(live_documents),
            "snapshot_count": len(documents),
            "chunk_count": len(chunks),
            "sentence_count": sentence_count,
            "char_count": document_stats["char_count"],
            "token_count": document_stats["token_count"],
            "indexed_at": payload["indexed_at"],
        }

    def index_all(
        self,
        config: KnowledgeConfig,
        running_config: Any | None = None,
    ) -> dict[str, Any]:
        """Index all enabled sources."""
        results = []
        for source in config.sources:
            if not source.enabled:
                continue
            results.append(self.index_source(source, config, running_config))
        return {
            "indexed_sources": len(results),
            "results": results,
        }

    def delete_index(self, source_id: str) -> None:
        """Delete persisted index for a source."""
        for chunk_path in self._load_source_chunk_manifest(source_id):
            self._delete_chunk_path(chunk_path)
        for ner_path in self._load_source_ner_manifest(source_id):
            self._delete_ner_path(ner_path)
        payload = self._load_index_payload_safe(source_id)
        self._delete_chunks_from_payload(payload)
        self._delete_ner_from_payload(payload)
        raw_dir = self._source_raw_dir(source_id)
        if raw_dir.exists():
            shutil.rmtree(raw_dir, ignore_errors=True)
        source_dir = self._source_dir(source_id)
        if source_dir.exists():
            shutil.rmtree(source_dir, ignore_errors=True)

    def clear_knowledge(self, config: KnowledgeConfig, *, remove_sources: bool = True) -> dict[str, Any]:
        """Clear persisted knowledge data and optionally reset configured sources."""
        source_count = len(config.sources)
        cleared_indexes = 0
        if self.sources_dir.exists():
            cleared_indexes = len(list(self.sources_dir.glob("*/index.json")))

        if self.root_dir.exists():
            shutil.rmtree(self.root_dir, ignore_errors=True)

        # Recreate expected directory structure after cleanup.
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.chunks_dir.mkdir(parents=True, exist_ok=True)
        self.ner_dir.mkdir(parents=True, exist_ok=True)
        self.sources_dir.mkdir(parents=True, exist_ok=True)
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.remote_blob_dir.mkdir(parents=True, exist_ok=True)
        self.remote_meta_dir.mkdir(parents=True, exist_ok=True)

        if remove_sources:
            config.sources = []

        return {
            "cleared": True,
            "cleared_indexes": cleared_indexes,
            "cleared_sources": source_count if remove_sources else 0,
            "removed_source_configs": bool(remove_sources),
        }

    def search(
        self,
        query: str,
        config: KnowledgeConfig,
        limit: int = 10,
        source_ids: list[str] | None = None,
        source_types: list[str] | None = None,
        project_scope: list[str] | None = None,
        include_global: bool = True,
    ) -> dict[str, Any]:
        """Search indexed chunks with a lightweight lexical scorer."""
        source_map = {source.id: source for source in config.sources}
        terms = [term for term in re.findall(r"\w+", query.lower()) if term]
        if not terms:
            return {"query": query, "hits": []}

        hits: list[dict[str, Any]] = []
        project_scope_set = {
            item.strip()
            for item in (project_scope or [])
            if item and item.strip()
        }
        for source in config.sources:
            if source_ids and source.id not in source_ids:
                continue
            if source_types and source.type not in source_types:
                continue
            if project_scope_set:
                source_project_id = (getattr(source, "project_id", "") or "").strip()
                in_project_scope = source_project_id in project_scope_set
                is_global_source = not source_project_id
                if not in_project_scope and not (include_global and is_global_source):
                    continue
            payload = self._load_index_payload(source.id)
            if payload is None:
                continue
            for chunk in payload.get("chunks", []):
                chunk_text = self._read_chunk_text(chunk)
                score = self._score_chunk(chunk_text, terms)
                if score <= 0:
                    continue
                hits.append(
                    {
                        "source_id": source.id,
                        "source_name": source_map[source.id].name,
                        "source_type": source.type,
                        "document_path": chunk.get("document_path"),
                        "document_title": chunk.get("document_title"),
                        "score": score,
                        "snippet": self._build_snippet(
                            chunk_text,
                            terms,
                        ),
                    },
                )

        hits.sort(key=lambda item: item["score"], reverse=True)
        return {"query": query, "hits": hits[:limit]}

    def get_source_documents(self, source_id: str) -> dict[str, Any]:
        """Return the indexed documents for a source, merged by document path."""
        payload = self._load_index_payload(source_id)
        if payload is None:
            return {"indexed": False, "documents": []}
        chunks = payload.get("chunks", [])
        # Merge chunks back into per-document text blocks
        docs: dict[str, dict[str, Any]] = {}
        for chunk in chunks:
            doc_path = chunk.get("document_path") or source_id
            if doc_path not in docs:
                docs[doc_path] = {
                    "path": doc_path,
                    "title": chunk.get("document_title") or doc_path,
                    "text": [],
                }
            docs[doc_path]["text"].append(self._read_chunk_text(chunk))
        documents = [
            {
                "path": d["path"],
                "title": d["title"],
                "text": "\n\n".join(d["text"]),
            }
            for d in docs.values()
        ]
        return {
            "indexed": True,
            "indexed_at": payload.get("indexed_at"),
            "document_count": payload.get("document_count", len(documents)),
            "snapshot_count": payload.get("snapshot_count", len(documents)),
            "chunk_count": payload.get("chunk_count", len(chunks)),
            "sentence_count": payload.get(
                "sentence_count",
                self._sum_chunk_sentence_count(chunks),
            ),
            "char_count": payload.get(
                "char_count",
                self._sum_chunk_char_count(chunks),
            ),
            "token_count": payload.get(
                "token_count",
                self._sum_chunk_token_count(chunks),
            ),
            "documents": documents,
        }

    def _source_dir(self, source_id: str) -> Path:
        return self.sources_dir / self._safe_name(source_id)

    def _source_index_path(self, source_id: str) -> Path:
        return self._source_dir(source_id) / "index.json"

    def _source_content_md_path(self, source_id: str) -> Path:
        return self._source_dir(source_id) / "content.md"

    def _source_chunk_manifest_path(self, source_id: str) -> Path:
        return self._source_dir(source_id) / "chunk-manifest.json"

    def _source_ner_manifest_path(self, source_id: str) -> Path:
        return self._source_dir(source_id) / "ner-manifest.json"

    def _source_snapshot_manifest_path(self, source_id: str) -> Path:
        return self._source_dir(source_id) / "snapshot-manifest.json"

    def _source_raw_dir(self, source_id: str) -> Path:
        return self.raw_dir / self._safe_name(source_id)

    def _load_source_chunk_manifest(self, source_id: str) -> set[str]:
        path = self._source_chunk_manifest_path(source_id)
        if not path.exists():
            return set()
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return set()
        if not isinstance(payload, dict):
            return set()
        chunk_paths = payload.get("chunk_paths")
        if not isinstance(chunk_paths, list):
            return set()
        return {
            str(item).strip()
            for item in chunk_paths
            if isinstance(item, str) and str(item).strip()
        }

    def _write_source_chunk_manifest(self, source_id: str, chunk_paths: set[str]) -> None:
        self._source_chunk_manifest_path(source_id).write_text(
            json.dumps(
                {
                    "source_id": source_id,
                    "chunk_paths": sorted(chunk_paths),
                    "updated_at": datetime.now(UTC).isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    def _load_source_ner_manifest(self, source_id: str) -> set[str]:
        path = self._source_ner_manifest_path(source_id)
        if not path.exists():
            return set()
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return set()
        if not isinstance(payload, dict):
            return set()
        ner_paths = payload.get("ner_paths")
        if not isinstance(ner_paths, list):
            return set()
        return {
            str(item).strip()
            for item in ner_paths
            if isinstance(item, str) and str(item).strip()
        }

    def _write_source_ner_manifest(self, source_id: str, ner_paths: set[str]) -> None:
        self._source_ner_manifest_path(source_id).write_text(
            json.dumps(
                {
                    "source_id": source_id,
                    "ner_paths": sorted(ner_paths),
                    "updated_at": datetime.now(UTC).isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    def _load_source_snapshot_manifest(self, source_id: str) -> list[dict[str, str]]:
        path = self._source_snapshot_manifest_path(source_id)
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return []
        if not isinstance(payload, dict):
            return []
        snapshots = payload.get("snapshots")
        if not isinstance(snapshots, list):
            return []
        results: list[dict[str, str]] = []
        for item in snapshots:
            if not isinstance(item, dict):
                continue
            snapshot_path = str(item.get("snapshot_path") or "").strip()
            document_path = str(item.get("document_path") or "").strip()
            if not snapshot_path or not document_path:
                continue
            results.append(
                {
                    "document_path": document_path,
                    "relative_path": str(item.get("relative_path") or "").strip(),
                    "title": str(item.get("title") or Path(document_path).name or document_path),
                    "snapshot_path": snapshot_path,
                    "snapshot_relative_path": str(item.get("snapshot_relative_path") or "").strip(),
                    "snapshot_at": str(item.get("snapshot_at") or "").strip(),
                }
            )
        results.sort(
            key=lambda item: (
                item.get("document_path") or "",
                item.get("snapshot_at") or "",
                item.get("snapshot_path") or "",
            )
        )
        return results

    def _write_source_snapshot_manifest(self, source_id: str, snapshots: list[dict[str, str]]) -> None:
        manifest_path = self._source_snapshot_manifest_path(source_id)
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(
            json.dumps(
                {
                    "source_id": source_id,
                    "snapshots": snapshots,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    def _collect_chunk_paths_from_payload(self, payload: dict[str, Any] | None) -> set[str]:
        if not isinstance(payload, dict):
            return set()
        source = None
        source_payload = payload.get("source")
        if isinstance(source_payload, dict):
            try:
                source = KnowledgeSourceSpec.model_validate(source_payload)
            except Exception:
                source = None
        results: set[str] = set()
        for chunk in payload.get("chunks") or []:
            if not isinstance(chunk, dict):
                continue
            chunk_path = str(chunk.get("chunk_path") or "").strip()
            if not chunk_path and source is not None:
                chunk_path = self._build_chunk_relative_path(source, chunk).as_posix()
            if chunk_path:
                results.add(chunk_path)
        return results

    def _collect_ner_paths_from_payload(self, payload: dict[str, Any] | None) -> set[str]:
        if not isinstance(payload, dict):
            return set()
        results: set[str] = set()
        for chunk in payload.get("chunks") or []:
            if not isinstance(chunk, dict):
                continue
            ner_path = str(chunk.get("ner_path") or "").strip()
            if ner_path:
                results.add(ner_path)
        return results

    def _delete_chunk_path(self, relative_path: str | Path | None) -> None:
        text = str(relative_path or "").strip()
        if not text:
            return
        target = self.root_dir / text
        if not target.exists() or not target.is_file():
            return
        try:
            target.unlink()
        except FileNotFoundError:
            return
        current = target.parent
        while current != self.chunks_dir and current.exists():
            try:
                current.rmdir()
            except OSError:
                break
            current = current.parent

    def _delete_ner_path(self, relative_path: str | Path | None) -> None:
        text = str(relative_path or "").strip()
        if not text:
            return
        target = self.root_dir / text
        if not target.exists() or not target.is_file():
            return
        try:
            target.unlink()
        except FileNotFoundError:
            return
        current = target.parent
        while current != self.ner_dir and current.exists():
            try:
                current.rmdir()
            except OSError:
                break
            current = current.parent

    def _delete_chunks_from_payload(self, payload: dict[str, Any] | None) -> None:
        for chunk_path in self._collect_chunk_paths_from_payload(payload):
            self._delete_chunk_path(chunk_path)

    def _delete_ner_from_payload(self, payload: dict[str, Any] | None) -> None:
        for ner_path in self._collect_ner_paths_from_payload(payload):
            self._delete_ner_path(ner_path)

    def _read_chunk_text(self, chunk: dict[str, Any]) -> str:
        chunk_text = chunk.get("text")
        if isinstance(chunk_text, str):
            return chunk_text
        chunk_path = str(chunk.get("chunk_path") or "").strip()
        if not chunk_path:
            return ""
        try:
            return (self.root_dir / chunk_path).read_text(encoding="utf-8")
        except FileNotFoundError:
            return ""

    def _read_ner_text(self, chunk: dict[str, Any]) -> str:
        ner_text = chunk.get("ner_text")
        if isinstance(ner_text, str):
            return ner_text
        ner_path = str(chunk.get("ner_path") or "").strip()
        if not ner_path:
            return ""
        try:
            return (self.root_dir / ner_path).read_text(encoding="utf-8")
        except FileNotFoundError:
            return ""

    def _normalize_chunk_document_path(
        self,
        source: KnowledgeSourceSpec,
        document_path: str,
    ) -> Path:
        raw_document_path = str(document_path or "").strip()
        normalized_path: str | None = None

        if source.type == "directory" and source.location and raw_document_path:
            try:
                root = Path(source.location).expanduser().resolve()
                resolved = Path(raw_document_path).expanduser().resolve()
                normalized_path = resolved.relative_to(root).as_posix()
            except Exception:
                normalized_path = None
        elif source.type == "file":
            candidate = raw_document_path or str(source.location or "")
            normalized_path = Path(candidate).name
        elif source.type == "url":
            candidate = raw_document_path or str(source.location or source.id)
            parsed = urlparse(candidate)
            normalized_path = parsed.path.strip("/") or parsed.netloc or self._safe_name(source.id)
        elif source.type == "chat":
            candidate = raw_document_path or str(source.location or source.id)
            normalized_path = Path(candidate).name or self._safe_name(source.id)

        if not normalized_path:
            candidate = raw_document_path or str(source.location or source.id)
            normalized_path = Path(candidate).name or self._safe_name(source.id)

        safe_parts = [
            self._safe_name(part)
            for part in Path(normalized_path).parts
            if part not in {"", ".", "..", "/", "\\"}
        ]
        if not safe_parts:
            safe_parts = [self._safe_name(source.id)]
        return Path(*safe_parts)

    def _normalize_snapshot_chunk_path(self, snapshot_relative_path: str) -> Path:
        safe_parts = [
            self._safe_name(part)
            for part in Path(snapshot_relative_path).parts
            if part not in {"", ".", "..", "/", "\\"}
        ]
        if not safe_parts:
            safe_parts = ["knowledge"]
        return Path(*safe_parts)

    def _build_chunk_relative_path(
        self,
        source: KnowledgeSourceSpec,
        chunk: dict[str, Any],
    ) -> Path:
        snapshot_relative_path = str(chunk.get("snapshot_relative_path") or "").strip()
        if snapshot_relative_path:
            normalized_doc_path = self._normalize_snapshot_chunk_path(snapshot_relative_path)
        else:
            normalized_doc_path = self._normalize_chunk_document_path(
                source,
                str(chunk.get("document_path") or ""),
            )
        parent = normalized_doc_path.parent
        basename = self._safe_name(normalized_doc_path.name or source.id)
        chunk_id = str(chunk.get("chunk_id") or "")
        try:
            chunk_index = int(chunk_id.rsplit("::", 1)[-1])
        except (TypeError, ValueError):
            chunk_index = 0
        target = self.chunks_dir
        if str(parent) not in {"", "."}:
            target = target / parent
        return target.relative_to(self.root_dir) / f"{basename}.{chunk_index}.txt"

    def _build_ner_relative_path(self, chunk_relative_path: str) -> Path:
        chunk_path = Path(str(chunk_relative_path or "").strip())
        if not chunk_path.parts:
            return self.ner_dir.relative_to(self.root_dir) / "knowledge.ner.txt"
        relative_parts = chunk_path.parts[1:] if chunk_path.parts[0] == self.chunks_dir.name else chunk_path.parts
        basename = chunk_path.name
        if basename.endswith(".txt"):
            basename = f"{basename[:-4]}.ner.txt"
        else:
            basename = f"{basename}.ner.txt"
        target = self.ner_dir.joinpath(*relative_parts[:-1], basename)
        return target.relative_to(self.root_dir)

    def _chunk_file_key(self, chunk: dict[str, Any]) -> str:
        return str(chunk.get("document_path") or chunk.get("document_title") or "knowledge").strip()

    def _chunk_version_id(self, chunk: dict[str, Any]) -> str:
        snapshot_ref = str(
            chunk.get("snapshot_relative_path")
            or chunk.get("snapshot_path")
            or ""
        ).strip()
        matched = re.search(r"snapshot_([0-9A-Za-z]+)", snapshot_ref)
        if matched:
            return matched.group(1)
        raw = "|".join(
            [
                self._chunk_file_key(chunk),
                str(chunk.get("snapshot_at") or "").strip(),
                str(chunk.get("chunk_id") or "").strip(),
            ]
        )
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]

    def _collect_chunk_ner_entities(
        self,
        text: str,
        *,
        config: KnowledgeConfig,
    ) -> list[str]:
        tokens = self._tokenize_semantic_text(text, config=config)
        seen: set[str] = set()
        entities: list[str] = []
        for token in tokens:
            normalized = str(token or "").strip()
            if len(normalized) < 2 or normalized in seen:
                continue
            seen.add(normalized)
            entities.append(normalized)
        return entities

    def _render_chunk_ner_text(
        self,
        chunk: dict[str, Any],
        *,
        text: str,
        entities: list[str],
    ) -> str:
        attributes = [
            f'document_path="{escape(str(chunk.get("document_path") or ""))}"',
            f'version_id="{escape(self._chunk_version_id(chunk))}"',
        ]
        snapshot_at = str(chunk.get("snapshot_at") or "").strip()
        if snapshot_at:
            attributes.append(f'snapshot_at="{escape(snapshot_at)}"')
        lines = [f"<chunk {' '.join(attributes)}>", "  <text>"]
        source_lines = str(text or "").splitlines() or [str(text or "")]
        for line in source_lines:
            lines.append(f"    {escape(line)}")
        lines.extend(["  </text>", "  <entities>"])
        for entity in entities:
            lines.append(f"    <entity type=\"semantic_token\">{escape(entity)}</entity>")
        lines.extend(["  </entities>", "</chunk>"])
        return "\n".join(lines)

    def _write_chunk_ner_artifacts(
        self,
        source: KnowledgeSourceSpec,
        payload: dict[str, Any],
        *,
        config: KnowledgeConfig | None,
    ) -> set[str]:
        previous_manifest_paths = self._load_source_ner_manifest(source.id)
        previous_payload = self._load_index_payload_safe(source.id)
        current_ner_paths: set[str] = set()
        semantic_state = self.get_semantic_engine_state(config) if config is not None else self._semantic_engine_state(
            status="unavailable",
            reason_code="HANLP2_SIDECAR_UNCONFIGURED",
            reason="HanLP2 sidecar is not configured.",
        )
        ready = semantic_state.get("status") == "ready"

        for chunk in payload.get("chunks") or []:
            if not isinstance(chunk, dict):
                continue
            chunk["file_key"] = self._chunk_file_key(chunk)
            chunk["version_id"] = self._chunk_version_id(chunk)
            chunk["ner_status"] = "unavailable"
            chunk["ner_entity_count"] = 0
            chunk.pop("ner_path", None)
            if not ready:
                continue
            chunk_text = self._read_chunk_text(chunk)
            entities = self._collect_chunk_ner_entities(chunk_text, config=config) if config is not None else []
            chunk["ner_status"] = "ready"
            chunk["ner_entity_count"] = len(entities)
            ner_relative_path = self._build_ner_relative_path(str(chunk.get("chunk_path") or ""))
            ner_file_path = self.root_dir / ner_relative_path
            ner_file_path.parent.mkdir(parents=True, exist_ok=True)
            ner_file_path.write_text(
                self._render_chunk_ner_text(chunk, text=chunk_text, entities=entities),
                encoding="utf-8",
            )
            chunk["ner_path"] = ner_relative_path.as_posix()
            current_ner_paths.add(chunk["ner_path"])

        stale_ner_paths = (
            previous_manifest_paths
            | self._collect_ner_paths_from_payload(previous_payload)
        ) - current_ner_paths
        for ner_path in stale_ner_paths:
            self._delete_ner_path(ner_path)
        self._write_source_ner_manifest(source.id, current_ner_paths)
        return current_ner_paths

    def get_source_storage_dir(self, source_id: str) -> Path:
        return self._source_dir(source_id)

    def get_source_chunk_documents(self, source_id: str) -> dict[str, Any]:
        payload = self._load_index_payload(source_id)
        if payload is None:
            return {"indexed": False, "documents": []}
        documents: list[dict[str, Any]] = []
        for chunk in payload.get("chunks") or []:
            if not isinstance(chunk, dict):
                continue
            documents.append(
                {
                    "path": str(chunk.get("document_path") or source_id),
                    "title": str(chunk.get("document_title") or chunk.get("document_path") or source_id),
                    "text": self._read_chunk_text(chunk),
                    "chunk_id": str(chunk.get("chunk_id") or ""),
                    "chunk_path": str(chunk.get("chunk_path") or ""),
                    "snapshot_path": str(chunk.get("snapshot_path") or ""),
                    "snapshot_relative_path": str(chunk.get("snapshot_relative_path") or ""),
                    "snapshot_at": str(chunk.get("snapshot_at") or ""),
                    "file_key": str(chunk.get("file_key") or self._chunk_file_key(chunk)),
                    "version_id": str(chunk.get("version_id") or self._chunk_version_id(chunk)),
                    "ner_path": str(chunk.get("ner_path") or ""),
                    "ner_status": str(chunk.get("ner_status") or "unavailable"),
                    "ner_entity_count": int(chunk.get("ner_entity_count") or 0),
                    "ner_text": self._read_ner_text(chunk),
                }
            )
        return {
            "indexed": True,
            "indexed_at": payload.get("indexed_at"),
            "document_count": payload.get("document_count", len(documents)),
            "snapshot_count": payload.get("snapshot_count", len(documents)),
            "chunk_count": payload.get("chunk_count", len(documents)),
            "documents": documents,
        }

    def list_sources_from_storage(self) -> list[KnowledgeSourceSpec]:
        """Rebuild source specs from persisted v2 storage layout."""
        sources: list[KnowledgeSourceSpec] = []
        for index_path in sorted(self.sources_dir.glob("*/index.json")):
            try:
                payload = self._load_json(index_path)
                source_payload = payload.get("source")
                if not isinstance(source_payload, dict):
                    continue
                source = KnowledgeSourceSpec.model_validate(source_payload)
                sources.append(source)
            except Exception:
                logger.warning(
                    "Failed to read source spec from storage index: %s",
                    index_path,
                )
        return sources

    def _load_index_payload(self, source_id: str) -> dict[str, Any] | None:
        source_index_path = self._source_index_path(source_id)
        if source_index_path.exists():
            return self._load_json(source_index_path)
        return None

    def _write_source_storage(
        self,
        source: KnowledgeSourceSpec,
        payload: dict[str, Any],
        documents: list[dict[str, str]],
        *,
        config: KnowledgeConfig | None = None,
    ) -> None:
        previous_payload = self._load_index_payload_safe(source.id)
        previous_manifest_paths = self._load_source_chunk_manifest(source.id)
        source_dir = self._source_dir(source.id)
        source_dir.mkdir(parents=True, exist_ok=True)
        (source_dir / "raw").mkdir(parents=True, exist_ok=True)
        (source_dir / "media").mkdir(parents=True, exist_ok=True)

        current_chunk_paths: set[str] = set()
        for chunk in payload.get("chunks") or []:
            if not isinstance(chunk, dict):
                continue
            chunk_relative_path = self._build_chunk_relative_path(source, chunk)
            chunk["chunk_path"] = chunk_relative_path.as_posix()
            chunk_file_path = self.root_dir / chunk_relative_path
            chunk_file_path.parent.mkdir(parents=True, exist_ok=True)
            chunk_file_path.write_text(
                str(chunk.get("text") or ""),
                encoding="utf-8",
            )
            current_chunk_paths.add(chunk["chunk_path"])
            chunk.pop("text", None)

        stale_chunk_paths = (
            previous_manifest_paths
            | self._collect_chunk_paths_from_payload(previous_payload)
        ) - current_chunk_paths
        for chunk_path in stale_chunk_paths:
            self._delete_chunk_path(chunk_path)

        self._write_source_chunk_manifest(source.id, current_chunk_paths)
        self._write_chunk_ner_artifacts(source, payload, config=config)

        self._source_index_path(source.id).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        self._source_content_md_path(source.id).write_text(
            self._build_source_markdown(source, documents),
            encoding="utf-8",
        )
        self._update_catalog_entry(source, payload)

    def _update_catalog_entry(
        self,
        source: KnowledgeSourceSpec,
        payload: dict[str, Any],
    ) -> None:
        catalog: dict[str, Any] = {
            "version": 2,
            "updated_at": datetime.now(UTC).isoformat(),
            "sources": {},
        }
        if self.catalog_path.exists():
            try:
                current = self._load_json(self.catalog_path)
                if isinstance(current, dict):
                    catalog.update(current)
                    if not isinstance(catalog.get("sources"), dict):
                        catalog["sources"] = {}
            except Exception:
                logger.warning("Failed to read knowledge catalog, recreating")

        catalog["updated_at"] = datetime.now(UTC).isoformat()
        catalog["sources"][source.id] = {
            "id": source.id,
            "name": source.name,
            "type": source.type,
            "indexed_at": payload.get("indexed_at"),
            "document_count": payload.get("document_count", 0),
            "chunk_count": payload.get("chunk_count", 0),
            "sentence_count": payload.get("sentence_count", 0),
            "char_count": payload.get("char_count", 0),
            "token_count": payload.get("token_count", 0),
            "path": str(self._source_dir(source.id)),
        }

        self.catalog_path.write_text(
            json.dumps(catalog, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _build_source_markdown(
        self,
        source: KnowledgeSourceSpec,
        documents: list[dict[str, str]],
    ) -> str:
        lines = [
            f"# {source.name}",
            "",
            "## Metadata",
            "",
            f"- id: {source.id}",
            f"- type: {source.type}",
            f"- location: {source.location or '-'}",
            f"- updated_at: {datetime.now(UTC).isoformat()}",
            "",
            "## Documents",
            "",
        ]
        if not documents:
            lines.append("(no documents)")
            lines.append("")
            return "\n".join(lines)

        for doc in documents:
            title = self._truncate_title(doc.get("title", "document"), max_len=200)
            path = doc.get("path", "")
            text = doc.get("text", "").strip()
            lines.extend(
                [
                    f"### {title}",
                    "",
                    f"- path: {path}",
                    "",
                    text if text else "(empty)",
                    "",
                ],
            )
        return "\n".join(lines)

    def _snapshot_timestamp_token(self, timestamp: str) -> str:
        raw = str(timestamp or "").strip()
        if not raw:
            return datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
        try:
            normalized = raw.replace("Z", "+00:00")
            dt = datetime.fromisoformat(normalized)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return dt.astimezone(UTC).strftime("%Y%m%dT%H%M%S%fZ")
        except ValueError:
            return re.sub(r"[^0-9A-Za-z]+", "", raw) or datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")

    def _snapshot_filename(self, filename: str, indexed_at: str) -> str:
        path = Path(filename or "knowledge")
        token = self._snapshot_timestamp_token(indexed_at)
        suffix = path.suffix
        stem = path.stem or path.name or "knowledge"
        return f"{stem}.snapshot_{token}{suffix}"

    def _build_snapshot_relative_path(
        self,
        source: KnowledgeSourceSpec,
        document: dict[str, Any],
        *,
        indexed_at: str,
    ) -> Path:
        relative_path = str(document.get("relative_path") or "").strip()
        if source.type == "directory" and relative_path:
            parent = Path(relative_path).parent
            filename = Path(relative_path).name
            target = parent if str(parent) not in {"", "."} else Path()
            return target / self._snapshot_filename(filename, indexed_at)

        source_path = str(document.get("source_path") or document.get("path") or source.location or source.id)
        filename = Path(source_path).name or self._safe_name(source.id)
        return Path(self._snapshot_filename(filename, indexed_at))

    def _persist_source_snapshots(
        self,
        source: KnowledgeSourceSpec,
        documents: list[dict[str, Any]],
        *,
        indexed_at: str,
    ) -> list[dict[str, str]]:
        if source.type not in {"file", "directory"}:
            return []

        raw_root = self._source_raw_dir(source.id)
        raw_root.mkdir(parents=True, exist_ok=True)
        existing = self._load_source_snapshot_manifest(source.id)
        seen = {
            (item.get("document_path") or "", item.get("snapshot_path") or "")
            for item in existing
        }
        manifest = list(existing)
        results: list[dict[str, str]] = []

        for document in documents:
            source_path_raw = str(document.get("source_path") or document.get("path") or "").strip()
            if not source_path_raw:
                continue
            source_path = Path(source_path_raw).expanduser().resolve()
            if not source_path.exists() or not source_path.is_file():
                continue
            snapshot_relative = self._build_snapshot_relative_path(
                source,
                document,
                indexed_at=indexed_at,
            )
            target_path = raw_root / snapshot_relative
            target_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, target_path)
            snapshot_entry = {
                "document_path": str(document.get("path") or source_path.as_posix()),
                "relative_path": str(document.get("relative_path") or "").strip(),
                "title": str(document.get("title") or source_path.name),
                "snapshot_path": target_path.as_posix(),
                "snapshot_relative_path": snapshot_relative.as_posix(),
                "snapshot_at": indexed_at,
            }
            key = (snapshot_entry["document_path"], snapshot_entry["snapshot_path"])
            if key not in seen:
                manifest.append(snapshot_entry)
                seen.add(key)
            results.append(snapshot_entry)

        if manifest:
            self._write_source_snapshot_manifest(source.id, manifest)
        return manifest

    def _load_snapshot_documents(
        self,
        source: KnowledgeSourceSpec,
    ) -> list[dict[str, Any]]:
        documents: list[dict[str, Any]] = []
        for snapshot in self._load_source_snapshot_manifest(source.id):
            snapshot_path_raw = str(snapshot.get("snapshot_path") or "").strip()
            if not snapshot_path_raw:
                continue
            snapshot_path = Path(snapshot_path_raw)
            text = self._read_local_text(snapshot_path)
            if not text:
                continue
            documents.append(
                {
                    "path": str(snapshot.get("document_path") or source.id),
                    "title": str(snapshot.get("title") or Path(snapshot_path_raw).name),
                    "text": text,
                    "snapshot_path": snapshot_path_raw,
                    "snapshot_relative_path": str(snapshot.get("snapshot_relative_path") or "").strip(),
                    "snapshot_at": str(snapshot.get("snapshot_at") or "").strip(),
                }
            )
        return documents

    def _prepare_documents_for_indexing(
        self,
        source: KnowledgeSourceSpec,
        documents: list[dict[str, Any]],
        *,
        indexed_at: str,
    ) -> list[dict[str, Any]]:
        if source.type not in {"file", "directory"}:
            return documents
        self._persist_source_snapshots(source, documents, indexed_at=indexed_at)
        snapshot_documents = self._load_snapshot_documents(source)
        return snapshot_documents or documents

    def _write_media_semantic_if_needed(self, file_path: Path, media_root: Path) -> None:
        suffix = file_path.suffix.lower()
        media_kind = None
        if suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}:
            media_kind = "image"
        elif suffix in {".mp3", ".wav", ".m4a", ".flac", ".ogg"}:
            media_kind = "audio"
        elif suffix in {".mp4", ".mov", ".avi", ".mkv", ".webm"}:
            media_kind = "video"
        if media_kind is None:
            return

        semantic_name = f"{self._safe_name(file_path.stem)}.semantic.md"
        semantic_path = media_root / semantic_name
        size = file_path.stat().st_size if file_path.exists() else 0
        semantic_path.write_text(
            "\n".join(
                [
                    f"# {file_path.name}",
                    "",
                    "## Semantic Summary",
                    "",
                    "(placeholder) Semantic extraction is not generated yet.",
                    "",
                    "## Metadata",
                    "",
                    f"- kind: {media_kind}",
                    f"- original_file: {file_path.as_posix()}",
                    f"- size_bytes: {size}",
                ],
            ),
            encoding="utf-8",
        )

    @staticmethod
    def _load_json(path: Path) -> dict[str, Any]:
        return json.loads(path.read_text(encoding="utf-8"))

    def _load_documents(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig,
    ) -> list[dict[str, str]]:
        if source.type == "file":
            path = Path(source.location).expanduser().resolve()
            return [self._read_file_document(path, config)]
        if source.type == "directory":
            return self._read_directory_documents(Path(source.location), source, config)
        if source.type == "url":
            if source.content and source.content.strip():
                return [
                    {
                        "path": source.location or source.id,
                        "title": source.name,
                        "text": self._normalize_text(source.content),
                    }
                ]
            return [self._read_url_document(source.location)]
        if source.type == "chat":
            if source.location and source.location.strip():
                return self._read_single_chat_document(source.location.strip())
            return self._read_chat_documents()
        text_content = source.content.strip()
        if not text_content and source.location.strip():
            text_content = Path(source.location).expanduser().read_text(
                encoding="utf-8",
            )
        return [
            {
                "path": source.location or source.id,
                "title": source.name,
                "text": self._normalize_text(text_content),
            },
        ]

    def _read_directory_documents(
        self,
        directory: Path,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig,
    ) -> list[dict[str, Any]]:
        root = directory.expanduser().resolve()
        if not root.exists() or not root.is_dir():
            raise FileNotFoundError(f"Knowledge directory not found: {root}")

        pattern = "**/*" if source.recursive else "*"
        documents: list[dict[str, str]] = []
        for path in root.glob(pattern):
            if not path.is_file():
                continue
            relative = path.relative_to(root).as_posix()
            if not self._is_allowed_path(relative, config):
                continue
            try:
                document = self._read_file_document(path, config)
                document["relative_path"] = relative
                document["source_path"] = str(path.resolve())
                documents.append(document)
            except ValueError as exc:
                if "exceeds max size" not in str(exc) and "not decodable as text" not in str(exc):
                    raise
                if "exceeds max size" in str(exc):
                    logger.warning(
                        "Skip oversized knowledge file: %s (max=%s bytes)",
                        path,
                        config.index.max_file_size,
                    )
        return documents

    def save_uploaded_file(self, source_id: str, filename: str, data: bytes) -> Path:
        """Persist an uploaded file and return its saved path."""
        safe_source = self._safe_name(source_id)
        safe_name = self._safe_name(Path(filename).name)
        target_dir = self.uploads_dir / "files" / safe_source
        if target_dir.exists():
            shutil.rmtree(target_dir, ignore_errors=True)
        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / safe_name
        target_path.write_bytes(data)
        return target_path

    def save_uploaded_directory(
        self,
        source_id: str,
        files: list[tuple[str, bytes]],
    ) -> Path:
        """Persist an uploaded directory snapshot and return its root path."""
        safe_source = self._safe_name(source_id)
        target_dir = self.uploads_dir / "directories" / safe_source
        if target_dir.exists():
            shutil.rmtree(target_dir, ignore_errors=True)
        target_dir.mkdir(parents=True, exist_ok=True)

        for relative_path, data in files:
            normalized = Path(relative_path)
            safe_parts = [self._safe_name(part) for part in normalized.parts if part not in {"", "."}]
            if not safe_parts:
                continue
            file_path = target_dir.joinpath(*safe_parts)
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_bytes(data)
        return target_dir

    def _read_chat_documents(self) -> list[dict[str, str]]:
        """Build documents from persisted chat registry and session files."""
        chats_path = self.working_dir / CHATS_FILE
        if not chats_path.exists():
            return []
        payload = json.loads(chats_path.read_text(encoding="utf-8"))
        chats = payload.get("chats", [])
        documents: list[dict[str, str]] = []
        sessions_dir = self.working_dir / "sessions"
        for chat in chats:
            session_id = chat.get("session_id", "")
            user_id = chat.get("user_id", "")
            session_path = sessions_dir / self._session_filename(session_id, user_id)
            collected_text = ""
            if session_path.exists():
                state = json.loads(session_path.read_text(encoding="utf-8"))
                collected_text = self._extract_visible_chat_text(state)
            text = self._normalize_text(
                "\n".join(
                    part
                    for part in [
                        chat.get("name", ""),
                        chat.get("channel", ""),
                        session_id,
                        collected_text,
                    ]
                    if part
                ),
            )
            if not text:
                continue
            documents.append(
                {
                    "path": str(session_path),
                    "title": chat.get("name") or session_id or "chat",
                    "text": text,
                },
            )
        return documents

    def _read_single_chat_document(self, session_id: str) -> list[dict[str, str]]:
        """Load a single chat session by session_id and return it as one text document."""
        chats_path = self.working_dir / CHATS_FILE
        sessions_dir = self.working_dir / "sessions"
        chat_meta: dict[str, Any] = {}

        # Try to find matching chat metadata from registry
        if chats_path.exists():
            try:
                payload = json.loads(chats_path.read_text(encoding="utf-8"))
                for chat in payload.get("chats", []):
                    if chat.get("session_id", "") == session_id:
                        chat_meta = chat
                        break
            except Exception:
                pass

        user_id = chat_meta.get("user_id", "")
        chat_name = chat_meta.get("name", "") or session_id

        # Try known session filename patterns
        candidates: list[Path] = []
        if user_id:
            candidates.append(sessions_dir / self._session_filename(session_id, user_id))
        candidates.append(sessions_dir / self._session_filename(session_id, ""))
        # Glob fallback: any file ending with the sanitized session_id
        safe_sid = _sanitize_filename(session_id)
        candidates.extend(sessions_dir.glob(f"*_{safe_sid}.json") if sessions_dir.exists() else [])
        candidates.extend(sessions_dir.glob(f"{safe_sid}.json") if sessions_dir.exists() else [])

        session_path: Path | None = None
        for candidate in candidates:
            if candidate.exists():
                session_path = candidate
                break

        if session_path is None:
            raise FileNotFoundError(
                f"Session file not found for session_id: {session_id}"
            )

        state = json.loads(session_path.read_text(encoding="utf-8"))
        collected_text = self._extract_visible_chat_text(state)
        text = self._normalize_text(collected_text)
        if not text:
            raise ValueError(f"No visible text found in session: {session_id}")

        return [
            {
                "path": str(session_path),
                "title": chat_name,
                "text": text,
            }
        ]

    def auto_collect_from_messages(
        self,
        config: KnowledgeConfig,
        session_id: str,
        user_id: str,
        request_messages: list[Any] | None,
        response_messages: list[Any] | None = None,
        running_config: Any | None = None,
    ) -> dict[str, Any]:
        """Backward-compatible wrapper for turn-based auto collection."""
        user_stage = self.auto_collect_user_message_assets(
            config=config,
            session_id=session_id,
            user_id=user_id,
            request_messages=request_messages,
            running_config=running_config,
        )
        text_stage = self.auto_collect_turn_text_pair(
            config=config,
            session_id=session_id,
            user_id=user_id,
            request_messages=request_messages,
            response_messages=response_messages,
            running_config=running_config,
        )
        return {
            "changed": bool(user_stage.get("changed") or text_stage.get("changed")),
            "file_sources": int(user_stage.get("file_sources", 0) or 0),
            "url_sources": int(user_stage.get("url_sources", 0) or 0),
            "text_sources": int(text_stage.get("text_sources", 0) or 0),
            "failed_sources": int(user_stage.get("failed_sources", 0) or 0)
            + int(text_stage.get("failed_sources", 0) or 0),
            "errors": [
                *(user_stage.get("errors") or []),
                *(text_stage.get("errors") or []),
            ],
        }

    def auto_collect_user_message_assets(
        self,
        config: KnowledgeConfig,
        session_id: str,
        user_id: str,
        request_messages: list[Any] | None,
        running_config: Any | None = None,
    ) -> dict[str, Any]:
        """Collect file/url knowledge immediately from user-sent content."""
        if not config.enabled or not bool(
            getattr(running_config, "knowledge_enabled", True)
        ):
            return {
                "changed": False,
                "file_sources": 0,
                "url_sources": 0,
                "text_sources": 0,
            }

        changed = False
        file_sources = 0
        url_sources = 0
        errors: list[dict[str, str]] = []
        user_messages = list(request_messages or [])

        knowledge_auto_collect_chat_files = getattr(running_config, "knowledge_auto_collect_chat_files", None)
        if knowledge_auto_collect_chat_files is None:
            knowledge_auto_collect_chat_files = config.automation.knowledge_auto_collect_chat_files

        knowledge_auto_collect_chat_urls = getattr(running_config, "knowledge_auto_collect_chat_urls", None)
        if knowledge_auto_collect_chat_urls is None:
            knowledge_auto_collect_chat_urls = config.automation.knowledge_auto_collect_chat_urls
        auto_collect_url_min_chars = int(
            getattr(
                running_config,
                "auto_collect_url_min_chars",
                _AUTO_COLLECT_URL_MIN_CONTENT_CHARS,
            )
            or _AUTO_COLLECT_URL_MIN_CONTENT_CHARS
        )

        if knowledge_auto_collect_chat_files:
            for source in self._build_file_sources_from_messages(
                user_messages,
                config,
                session_id,
            ):
                if self._upsert_source(config, source):
                    changed = True
                self._index_source_with_recovery(
                    source,
                    config,
                    running_config,
                    errors,
                )
                file_sources += 1

        if knowledge_auto_collect_chat_urls:
            for source in self._build_url_sources_from_messages(
                user_messages,
                session_id,
                user_id,
                automation_config=config.automation,
                min_content_chars=auto_collect_url_min_chars,
            ):
                if self._upsert_source(config, source):
                    changed = True
                self._index_source_with_recovery(
                    source,
                    config,
                    running_config,
                    errors,
                )
                url_sources += 1

        result = {
            "changed": changed,
            "file_sources": file_sources,
            "url_sources": url_sources,
            "text_sources": 0,
        }
        if errors:
            result["failed_sources"] = len(errors)
            result["errors"] = errors
        return result

    def auto_collect_turn_text_pair(
        self,
        config: KnowledgeConfig,
        session_id: str,
        user_id: str,
        request_messages: list[Any] | None,
        response_messages: list[Any] | None = None,
        running_config: Any | None = None,
    ) -> dict[str, Any]:
        """Collect text knowledge after response, based on one user-assistant turn pair."""
        if not config.enabled or not bool(
            getattr(running_config, "knowledge_enabled", True)
        ):
            return {
                "changed": False,
                "file_sources": 0,
                "url_sources": 0,
                "text_sources": 0,
            }

        knowledge_auto_collect_long_text = getattr(running_config, "knowledge_auto_collect_long_text", None)
        if knowledge_auto_collect_long_text is None:
            knowledge_auto_collect_long_text = config.automation.knowledge_auto_collect_long_text
        if not knowledge_auto_collect_long_text:
            return {
                "changed": False,
                "file_sources": 0,
                "url_sources": 0,
                "text_sources": 0,
            }

        knowledge_long_text_min_chars = getattr(running_config, "knowledge_long_text_min_chars", None)
        if not isinstance(knowledge_long_text_min_chars, int):
            knowledge_long_text_min_chars = config.automation.knowledge_long_text_min_chars

        errors: list[dict[str, str]] = []
        changed = False
        text_sources = 0
        for source in self._build_text_sources_from_turn_pair(
            request_messages=list(request_messages or []),
            response_messages=list(response_messages or []),
            session_id=session_id,
            user_id=user_id,
            knowledge_long_text_min_chars=knowledge_long_text_min_chars,
        ):
            if self._upsert_source(config, source):
                changed = True
            self._index_source_with_recovery(
                source,
                config,
                running_config,
                errors,
            )
            text_sources += 1

        result = {
            "changed": changed,
            "file_sources": 0,
            "url_sources": 0,
            "text_sources": text_sources,
        }
        if errors:
            result["failed_sources"] = len(errors)
            result["errors"] = errors
        return result

    def auto_backfill_history_data(
        self,
        config: KnowledgeConfig,
        running_config: Any | None = None,
    ) -> dict[str, Any]:
        """Backfill historical chat-session data into knowledge sources once."""
        if not config.enabled or not bool(
            getattr(running_config, "knowledge_enabled", True)
        ):
            self._save_backfill_progress(
                {
                    "running": False,
                    "completed": False,
                    "failed": False,
                    "reason": "knowledge_disabled",
                    "updated_at": datetime.now(UTC).isoformat(),
                }
            )
            return {"changed": False, "skipped": True, "reason": "knowledge_disabled"}

        signature = self._history_backfill_signature(running_config)
        state = self._load_backfill_state()
        if (
            state.get("completed")
            and state.get("signature") == signature
        ):
            self._save_backfill_progress(
                {
                    "running": False,
                    "completed": True,
                    "failed": False,
                    "reason": "already_completed",
                    "updated_at": datetime.now(UTC).isoformat(),
                }
            )
            return {"changed": False, "skipped": True, "reason": "already_completed"}

        chats_path = self.working_dir / CHATS_FILE
        if chats_path.exists():
            payload = self._load_json(chats_path)
            chats = payload.get("chats", [])
        else:
            chats = []

        sessions_dir = self.working_dir / "sessions"
        total_sessions = sum(
            1 for chat in chats if str(chat.get("session_id", "") or "").strip()
        )
        changed = False
        traversed_sessions = 0
        processed_sessions = 0
        file_sources = 0
        url_sources = 0
        text_sources = 0
        errors: list[dict[str, str]] = []

        self._save_backfill_progress(
            {
                "running": True,
                "completed": False,
                "failed": False,
                "total_sessions": total_sessions,
                "traversed_sessions": 0,
                "processed_sessions": 0,
                "current_session_id": None,
                "updated_at": datetime.now(UTC).isoformat(),
            }
        )

        knowledge_long_text_min_chars = getattr(running_config, "knowledge_long_text_min_chars", None)
        if not isinstance(knowledge_long_text_min_chars, int):
            knowledge_long_text_min_chars = config.automation.knowledge_long_text_min_chars
        knowledge_auto_collect_chat_files = getattr(running_config, "knowledge_auto_collect_chat_files", False)
        knowledge_auto_collect_chat_urls = getattr(running_config, "knowledge_auto_collect_chat_urls", True)
        knowledge_auto_collect_long_text = getattr(running_config, "knowledge_auto_collect_long_text", False)
        auto_collect_url_min_chars = int(
            getattr(
                running_config,
                "auto_collect_url_min_chars",
                _AUTO_COLLECT_URL_MIN_CONTENT_CHARS,
            )
            or _AUTO_COLLECT_URL_MIN_CONTENT_CHARS
        )

        try:
            for chat in chats:
                session_id = str(chat.get("session_id", "") or "")
                user_id = str(chat.get("user_id", "") or "")
                if not session_id:
                    continue

                traversed_sessions += 1
                self._save_backfill_progress(
                    {
                        "running": True,
                        "completed": False,
                        "failed": False,
                        "total_sessions": total_sessions,
                        "traversed_sessions": traversed_sessions,
                        "processed_sessions": processed_sessions,
                        "current_session_id": session_id,
                        "updated_at": datetime.now(UTC).isoformat(),
                    }
                )

                session_path = sessions_dir / self._session_filename(session_id, user_id)
                if not session_path.exists():
                    continue
                state_payload = self._load_json(session_path)
                messages = self._messages_from_session_state(state_payload)
                if not messages:
                    continue
                processed_sessions += 1

                if knowledge_auto_collect_chat_files:
                    for source in self._build_file_sources_from_messages(
                        messages,
                        config,
                        session_id,
                    ):
                        upserted = self._upsert_source(config, source)
                        if upserted:
                            changed = True
                            self._index_source_with_recovery(
                                source,
                                config,
                                running_config,
                                errors,
                            )
                        file_sources += 1

                if knowledge_auto_collect_long_text:
                    for source in self._build_text_sources_from_messages(
                        messages,
                        config,
                        session_id,
                        user_id,
                        knowledge_long_text_min_chars,
                    ):
                        upserted = self._upsert_source(config, source)
                        if upserted:
                            changed = True
                            self._index_source_with_recovery(
                                source,
                                config,
                                running_config,
                                errors,
                            )
                        text_sources += 1

                if knowledge_auto_collect_chat_urls:
                    for source in self._build_url_sources_from_messages(
                        messages,
                        session_id,
                        user_id,
                        automation_config=config.automation,
                        min_content_chars=auto_collect_url_min_chars,
                    ):
                        upserted = self._upsert_source(config, source)
                        if upserted:
                            changed = True
                            self._index_source_with_recovery(
                                source,
                                config,
                                running_config,
                                errors,
                            )
                        url_sources += 1
        except Exception as exc:
            self._save_backfill_progress(
                {
                    "running": False,
                    "completed": False,
                    "failed": True,
                    "error": str(exc),
                    "total_sessions": total_sessions,
                    "traversed_sessions": traversed_sessions,
                    "processed_sessions": processed_sessions,
                    "updated_at": datetime.now(UTC).isoformat(),
                }
            )
            raise

        self._save_backfill_state(
            {
                "completed": True,
                "signature": signature,
                "processed_sessions": processed_sessions,
                "file_sources": file_sources,
                "url_sources": url_sources,
                "text_sources": text_sources,
                "updated_at": datetime.now(UTC).isoformat(),
            },
        )
        self._save_backfill_progress(
            {
                "running": False,
                "completed": True,
                "failed": False,
                "total_sessions": total_sessions,
                "traversed_sessions": traversed_sessions,
                "processed_sessions": processed_sessions,
                "updated_at": datetime.now(UTC).isoformat(),
            }
        )
        result = {
            "changed": changed,
            "skipped": False,
            "processed_sessions": processed_sessions,
            "file_sources": file_sources,
            "url_sources": url_sources,
            "text_sources": text_sources,
        }
        if errors:
            result["failed_sources"] = len(errors)
            result["errors"] = errors
        return result

    def _index_source_with_recovery(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig,
        running_config: Any | None,
        errors: list[dict[str, str]],
    ) -> None:
        try:
            self.index_source(source, config, running_config)
        except Exception as exc:
            errors.append(
                {
                    "source_id": source.id,
                    "source_type": source.type,
                    "location": source.location,
                    "error": str(exc),
                },
            )

    def _read_file_document(
        self,
        path: Path,
        config: KnowledgeConfig,
    ) -> dict[str, Any]:
        file_path = path.expanduser().resolve()
        if not file_path.exists() or not file_path.is_file():
            raise FileNotFoundError(f"Knowledge file not found: {file_path}")
        if file_path.stat().st_size > config.index.max_file_size:
            raise ValueError(f"Knowledge file exceeds max size: {file_path}")
        text = self._read_text_file_content(file_path)
        if text is None:
            raise ValueError(f"Knowledge file is not decodable as text: {file_path}")
        return {
            "path": str(file_path),
            "source_path": str(file_path),
            "title": file_path.name,
            "text": text,
        }

    def _read_text_file_content(self, path: Path) -> str | None:
        try:
            raw = path.read_bytes()
        except Exception:
            return None
        for encoding in _TEXT_FILE_ENCODINGS:
            try:
                decoded = raw.decode(encoding)
                return self._normalize_text(decoded)
            except UnicodeDecodeError:
                continue
        return None

    @staticmethod
    def _read_url_document(url: str) -> dict[str, str]:
        response = httpx.get(url, timeout=10.0, follow_redirects=True)
        response.raise_for_status()
        content_type = str(response.headers.get("content-type", "") or "").lower()
        if content_type and not any(
            marker in content_type for marker in _TEXTUAL_CONTENT_TYPE_MARKERS
        ):
            # Skip binary payloads (image/audio/video/pdf/zip, etc.) to avoid
            # turning bytes into garbled text in knowledge sources.
            return {
                "path": url,
                "title": url,
                "text": "",
            }
        content = response.text
        title = url
        if "text/html" in response.headers.get("content-type", ""):
            title_match = re.search(
                r"<title[^>]*>(.*?)</title>",
                content,
                flags=re.S | re.I,
            )
            if title_match:
                extracted = KnowledgeManager._normalize_text(
                    unescape(title_match.group(1)),
                )
                if extracted:
                    title = extracted
            content = re.sub(r"<script.*?</script>", " ", content, flags=re.S | re.I)
            content = re.sub(r"<style.*?</style>", " ", content, flags=re.S | re.I)
            content = re.sub(r"<[^>]+>", " ", content)
        return {
            "path": url,
            "title": title,
            "text": KnowledgeManager._normalize_text(unescape(content)),
        }

    @staticmethod
    def _normalize_text(text: str) -> str:
        compact = text.replace("\r", "\n")
        # Remove all blank lines (lines containing only whitespace)
        compact = re.sub(r"\n[ \t]*\n+", "\n", compact)
        compact = re.sub(r"[ \t]+", " ", compact)
        return compact.strip()

    def _extract_visible_chat_text(self, state: dict[str, Any]) -> str:
        messages = self._messages_from_session_state(state)
        snippets = [
            self._extract_text_from_runtime_message(message)
            for message in messages
        ]
        return self._normalize_text("\n\n".join(item for item in snippets if item))

    @staticmethod
    def _messages_from_session_state(state: dict[str, Any]) -> list[dict[str, Any]]:
        memory_state = state.get("agent", {}).get("memory", {})
        if isinstance(memory_state, dict):
            raw_entries = memory_state.get("content", [])
        elif isinstance(memory_state, list):
            raw_entries = memory_state
        else:
            raw_entries = []

        messages: list[dict[str, Any]] = []
        for entry in raw_entries:
            raw_message = None
            if isinstance(entry, list) and entry:
                raw_message = entry[0]
            elif isinstance(entry, dict):
                raw_message = entry
            if not isinstance(raw_message, dict):
                continue
            if raw_message.get("type") in {"plugin_call", "plugin_call_output"}:
                continue
            messages.append(raw_message)
        return messages

    @staticmethod
    def _extract_text_from_state(value: Any) -> str:
        snippets: list[str] = []

        def walk(node: Any) -> None:
            if isinstance(node, str):
                cleaned = node.strip()
                if cleaned:
                    snippets.append(cleaned)
                return
            if isinstance(node, list):
                for item in node:
                    walk(item)
                return
            if isinstance(node, dict):
                for key in ("text", "thinking", "output", "name", "role"):
                    if key in node and isinstance(node[key], str):
                        walk(node[key])
                content = node.get("content")
                if content is not None:
                    walk(content)
                data = node.get("data")
                if data is not None:
                    walk(data)
                for nested_key, nested_value in node.items():
                    if nested_key in {"text", "thinking", "output", "name", "role", "content", "data"}:
                        continue
                    if isinstance(nested_value, (dict, list)):
                        walk(nested_value)

        walk(value)
        return "\n".join(snippets)

    def _build_file_sources_from_messages(
        self,
        messages: list[Any],
        config: KnowledgeConfig,
        session_id: str,
    ) -> list[KnowledgeSourceSpec]:
        sources: list[KnowledgeSourceSpec] = []
        seen_ids: set[str] = set()
        for block in self._iter_message_blocks(messages):
            if block.get("type") != "file":
                continue
            file_ref = self._file_reference_from_block(block)
            if not file_ref:
                continue
            parsed_ref = urlparse(file_ref)
            remote_hash = None
            if parsed_ref.scheme in {"http", "https"}:
                remote_hash = hashlib.sha1(file_ref.encode("utf-8")).hexdigest()
            stored_path = self._materialize_file_reference(
                file_ref,
                block.get("name") or Path(file_ref).name or "chat-file",
                config,
            )
            if stored_path is None:
                continue
            digest = hashlib.sha1(str(stored_path).encode("utf-8")).hexdigest()[:12]
            source_id = f"auto-file-{digest}"
            if source_id in seen_ids:
                continue
            seen_ids.add(source_id)
            tags = ["auto", "origin:auto", "source:chat", "auto:file"]
            if remote_hash:
                tags.extend(["remote:http", f"remote:url_hash:{remote_hash}"])
            sources.append(
                KnowledgeSourceSpec(
                    id=source_id,
                    name=f"Auto File: {stored_path.name}",
                    type="file",
                    location=str(stored_path),
                    enabled=True,
                    recursive=False,
                    tags=tags,
                    summary=f"Auto-collected from chat session {session_id}",
                ),
            )
        return sources

    def _build_text_sources_from_messages(
        self,
        messages: list[Any],
        config: KnowledgeConfig,
        session_id: str,
        user_id: str,
        knowledge_long_text_min_chars: int,
    ) -> list[KnowledgeSourceSpec]:
        sources: list[KnowledgeSourceSpec] = []
        seen_ids: set[str] = set()
        for role, text in self._iter_message_texts(messages):
            normalized = self._normalize_text(text)
            if len(normalized) < knowledge_long_text_min_chars:
                continue
            digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:12]
            source_id = f"auto-text-{digest}"
            if source_id in seen_ids:
                continue
            seen_ids.add(source_id)
            title = normalized.splitlines()[0][:48] or "Long chat text"
            sources.append(
                KnowledgeSourceSpec(
                    id=source_id,
                    name=f"Auto Text: {title}",
                    type="text",
                    content=normalized,
                    enabled=True,
                    recursive=False,
                    tags=[
                        "auto",
                        "origin:auto",
                        "source:chat",
                        "auto:text",
                        f"role:{role}",
                    ],
                    summary=(
                        f"Auto-saved from {role} message in {session_id}"
                        + (f" for {user_id}" if user_id else "")
                    ),
                ),
            )
        return sources

    def _build_text_sources_from_turn_pair(
        self,
        request_messages: list[Any],
        response_messages: list[Any],
        session_id: str,
        user_id: str,
        knowledge_long_text_min_chars: int,
    ) -> list[KnowledgeSourceSpec]:
        user_text = self._normalize_text(
            "\n".join(
                text
                for role, text in self._iter_message_texts(request_messages)
                if str(role).lower() == "user"
            )
        )
        assistant_text = self._normalize_text(
            "\n".join(
                text
                for role, text in self._iter_message_texts(response_messages)
                if str(role).lower() == "assistant"
            )
        )
        if not user_text or not assistant_text:
            return []

        merged = self._normalize_text(f"用户: {user_text}\n\n智能体: {assistant_text}")
        if len(merged) < knowledge_long_text_min_chars:
            return []

        digest = hashlib.sha1(merged.encode("utf-8")).hexdigest()[:12]
        source_id = f"auto-text-{digest}"
        title = merged.splitlines()[0][:48] or "Long chat text"
        return [
            KnowledgeSourceSpec(
                id=source_id,
                name=f"Auto Text: {title}",
                type="text",
                content=merged,
                enabled=True,
                recursive=False,
                tags=[
                    "auto",
                    "origin:auto",
                    "source:chat",
                    "auto:text",
                    "role:turn_pair",
                ],
                summary=(
                    f"Auto-saved from user-assistant turn in {session_id}"
                    + (f" for {user_id}" if user_id else "")
                ),
            )
        ]

    def _build_url_sources_from_messages(
        self,
        messages: list[Any],
        session_id: str,
        user_id: str,
        automation_config: Any | None = None,
        min_content_chars: int | None = None,
    ) -> list[KnowledgeSourceSpec]:
        sources: list[KnowledgeSourceSpec] = []
        seen_ids: set[str] = set()
        for role, text in self._iter_message_texts(messages):
            for url in self._extract_urls_from_text(text):
                if self._should_exclude_url(url, automation_config):
                    logger.debug("Skipping excluded URL: %s", url)
                    continue
                digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
                source_id = f"auto-url-{digest}"
                if source_id in seen_ids:
                    continue
                seen_ids.add(source_id)
                label = url if len(url) <= 80 else f"{url[:77]}..."
                fetched_text = ""
                if min_content_chars is not None:
                    try:
                        doc = self._read_url_document(url)
                    except Exception:
                        continue
                    fetched_text = self._normalize_text(doc.get("text", ""))
                    if len(fetched_text) < max(0, min_content_chars):
                        continue
                # Capture surrounding text context from the conversation message
                # so title generation can use it without fetching the URL.
                context_snippet = self._extract_url_context(text, url, max_chars=400)
                summary = (
                    f"Auto-collected URL from {role} message in {session_id}"
                    + (f" for {user_id}" if user_id else "")
                )
                if context_snippet:
                    summary = f"{summary}\n来源上下文: {context_snippet}"
                sources.append(
                    KnowledgeSourceSpec(
                        id=source_id,
                        name=f"Auto URL: {label}",
                        type="url",
                        location=url,
                        content=fetched_text,
                        enabled=True,
                        recursive=False,
                        tags=[
                            "auto",
                            "origin:auto",
                            "source:chat",
                            "auto:url",
                            f"role:{role}",
                        ],
                        summary=summary,
                    ),
                )
        return sources

    @staticmethod
    def _extract_urls_from_text(text: str) -> list[str]:
        found: list[str] = []
        seen: set[str] = set()
        for match in _CHAT_URL_RE.findall(text or ""):
            cleaned = match.rstrip(_URL_TRAILING_STRIP_CHARS)
            if not cleaned:
                continue

            # Defensive normalization: a previously merged token may contain
            # additional URLs separated by CJK words or punctuation.
            normalized_urls: list[str] = []
            cjk_chunks = re.split(r"[\u4e00-\u9fff]+", cleaned)
            for chunk in cjk_chunks:
                chunk = chunk.strip()
                if not chunk:
                    continue
                nested = _CHAT_URL_RE.findall(chunk)
                if nested:
                    normalized_urls.extend(nested)
                else:
                    normalized_urls.append(chunk)

            for candidate in normalized_urls:
                candidate = candidate.rstrip(_URL_TRAILING_STRIP_CHARS)
                if not candidate or candidate in seen:
                    continue
                seen.add(candidate)
                found.append(candidate)
        return found

    @staticmethod
    def _should_exclude_url(url: str, automation_config: Any | None = None) -> bool:
        """Return True if the URL should be excluded from auto-collection.

        Exclusion criteria (all can be toggled via automation_config):
        - Private/intranet addresses (localhost, 127.x, 192.168.x, etc.)
        - URLs containing credential/token query parameters
        - User-defined exclusion prefix patterns
        """
        try:
            parsed = urlparse(url)
        except Exception:
            return False

        # Private-address exclusion
        exclude_private = True
        if automation_config is not None:
            exclude_private = bool(
                getattr(automation_config, "url_exclude_private_addresses", True)
            )
        if exclude_private:
            host = parsed.hostname or ""
            if _PRIVATE_HOST_RE.match(host):
                return True

        # Token/credential query-param exclusion
        exclude_tokens = True
        if automation_config is not None:
            exclude_tokens = bool(
                getattr(automation_config, "url_exclude_token_params", True)
            )
        if exclude_tokens and parsed.query:
            try:
                params = parse_qs(parsed.query, keep_blank_values=True)
                if any(k.lower() in _URL_SENSITIVE_PARAMS for k in params):
                    return True
            except Exception:
                pass

        # User-defined pattern exclusion (prefix match)
        exclude_patterns: list[str] = []
        if automation_config is not None:
            raw = getattr(automation_config, "url_exclude_patterns", None)
            if isinstance(raw, list):
                exclude_patterns = raw
        for pattern in exclude_patterns:
            if isinstance(pattern, str) and url.startswith(pattern):
                return True

        return False

    @staticmethod
    def _extract_url_context(text: str, url: str, max_chars: int = 400) -> str:
        """Extract a snippet of surrounding text around the given URL.

        Returns up to max_chars/2 chars before and max_chars/2 after
        the URL occurrence, stripped and compacted.
        """
        idx = text.find(url)
        if idx == -1:
            return ""
        half = max_chars // 2
        before = text[max(0, idx - half): idx].strip()
        after = text[idx + len(url): idx + len(url) + half].strip()
        parts = [p for p in (before, after) if p]
        snippet = " ... ".join(parts)
        # Compact whitespace
        snippet = re.sub(r"\s+", " ", snippet).strip()
        return snippet[:max_chars]

    @staticmethod
    def _block_to_dict(block: Any) -> dict[str, Any] | None:
        if isinstance(block, dict):
            return block
        if hasattr(block, "model_dump"):
            return block.model_dump()
        if hasattr(block, "dict"):
            return block.dict()
        return None

    def _iter_message_blocks(self, messages: list[Any]) -> list[dict[str, Any]]:
        blocks: list[dict[str, Any]] = []
        for message in messages:
            content = getattr(message, "content", None)
            if isinstance(message, dict):
                content = message.get("content")
            if isinstance(content, str):
                blocks.append({"type": "text", "text": content})
                continue
            if not isinstance(content, list):
                continue
            for block in content:
                payload = self._block_to_dict(block)
                if payload is not None:
                    blocks.append(payload)
        return blocks

    def _iter_message_texts(self, messages: list[Any]) -> list[tuple[str, str]]:
        texts: list[tuple[str, str]] = []
        for message in messages:
            role = getattr(message, "role", None)
            if isinstance(message, dict):
                role = message.get("role")
            role = role or "assistant"
            if isinstance(message, dict) and message.get("type") in {
                "plugin_call",
                "plugin_call_output",
            }:
                continue
            content = getattr(message, "content", None)
            if isinstance(message, dict):
                content = message.get("content")
            if isinstance(content, str):
                texts.append((role, content))
                continue
            if not isinstance(content, list):
                continue
            joined: list[str] = []
            for block in content:
                payload = self._block_to_dict(block)
                if not payload or payload.get("type") != "text":
                    continue
                text = payload.get("text")
                if isinstance(text, str) and text.strip():
                    joined.append(text)
            if joined:
                texts.append((role, "\n".join(joined)))
        return texts

    def _extract_text_from_runtime_message(self, message: dict[str, Any]) -> str:
        content = message.get("content")
        if isinstance(content, str):
            return self._normalize_text(content)
        if not isinstance(content, list):
            return ""
        snippets: list[str] = []
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text":
                text = block.get("text")
                if isinstance(text, str) and text.strip():
                    snippets.append(text)
        return self._normalize_text("\n".join(snippets))

    @staticmethod
    def _file_reference_from_block(block: dict[str, Any]) -> str:
        for key in ("file_url", "path", "url"):
            value = block.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        source = block.get("source")
        if isinstance(source, dict):
            value = source.get("url") or source.get("path")
            if isinstance(value, str) and value.strip():
                return value.strip()
        return ""

    def _materialize_file_reference(
        self,
        file_ref: str,
        filename: str,
        config: KnowledgeConfig,
    ) -> Path | None:
        parsed = urlparse(file_ref)
        if parsed.scheme in {"", "file"}:
            local_value = parsed.path if parsed.scheme == "file" else file_ref
            path = Path(local_value).expanduser()
            if path.exists() and path.is_file():
                return path.resolve()
            return None

        if parsed.scheme in {"http", "https"}:
            downloaded_name = Path(parsed.path).name or filename
            return self._download_remote_file_with_cache(
                file_ref,
                downloaded_name,
                config,
            )
        return None

    def _download_remote_file_with_cache(
        self,
        url: str,
        filename: str,
        config: KnowledgeConfig,
    ) -> Path | None:
        url_key = hashlib.sha1(url.encode("utf-8")).hexdigest()
        meta_path = self.remote_meta_dir / f"{url_key}.json"
        now = datetime.now(UTC)
        metadata: dict[str, Any] = {}

        if meta_path.exists():
            metadata = self._load_json(meta_path)
            cached_path = metadata.get("file_path")
            if isinstance(cached_path, str) and cached_path:
                cached_file = Path(cached_path)
                if cached_file.exists() and cached_file.is_file():
                    return cached_file
            next_retry_at = self._parse_iso_utc(metadata.get("next_retry_at"))
            if next_retry_at is not None and next_retry_at > now:
                return None

        try:
            response = httpx.get(url, timeout=15.0, follow_redirects=True)
            response.raise_for_status()
            content = response.content
            if len(content) > config.index.max_file_size:
                self._save_remote_meta(
                    meta_path,
                    {
                        "url": url,
                        "status": "failed",
                        "last_error": "file too large",
                        "fail_count": 1,
                        "next_retry_at": (
                            now + timedelta(seconds=30)
                        ).isoformat(),
                        "updated_at": now.isoformat(),
                    },
                )
                return None

            content_hash = hashlib.sha1(content).hexdigest()
            blob_dir = self.remote_blob_dir / content_hash
            blob_dir.mkdir(parents=True, exist_ok=True)
            safe_name = self._safe_name(Path(filename).name)
            blob_path = blob_dir / safe_name
            if not blob_path.exists():
                blob_path.write_bytes(content)

            self._save_remote_meta(
                meta_path,
                {
                    "url": url,
                    "status": "ok",
                    "content_hash": content_hash,
                    "file_path": str(blob_path),
                    "file_name": safe_name,
                    "fail_count": 0,
                    "next_retry_at": None,
                    "updated_at": now.isoformat(),
                },
            )
            return blob_path
        except Exception as exc:
            fail_count = int(metadata.get("fail_count", 0)) + 1
            backoff_seconds = min(300, 5 * (2 ** (fail_count - 1)))
            self._save_remote_meta(
                meta_path,
                {
                    "url": url,
                    "status": "failed",
                    "last_error": str(exc),
                    "fail_count": fail_count,
                    "next_retry_at": (
                        now + timedelta(seconds=backoff_seconds)
                    ).isoformat(),
                    "updated_at": now.isoformat(),
                },
            )
            return None

    @staticmethod
    def _save_remote_meta(path: Path, payload: dict[str, Any]) -> None:
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @staticmethod
    def _parse_iso_utc(value: Any) -> datetime | None:
        if not isinstance(value, str) or not value:
            return None
        text = value.strip()
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=UTC)
        return parsed.astimezone(UTC)

    def _history_backfill_signature(self, running_config: Any | None) -> str:
        payload = {
            "knowledge_auto_collect_chat_files": bool(
                getattr(running_config, "knowledge_auto_collect_chat_files", False),
            ),
            "knowledge_auto_collect_chat_urls": bool(
                getattr(running_config, "knowledge_auto_collect_chat_urls", True),
            ),
            "knowledge_auto_collect_long_text": bool(
                getattr(running_config, "knowledge_auto_collect_long_text", False),
            ),
            "knowledge_long_text_min_chars": int(
                getattr(running_config, "knowledge_long_text_min_chars", 2000),
            ),
            "knowledge_chunk_size": int(
                getattr(running_config, "knowledge_chunk_size", 1200),
            ),
            "version": 2,
        }
        return hashlib.sha1(
            json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8"),
        ).hexdigest()

    @staticmethod
    def _resolve_chunk_size(
        config: KnowledgeConfig,
        running_config: Any | None,
    ) -> int:
        chunk_size = getattr(running_config, "knowledge_chunk_size", None)
        if isinstance(chunk_size, int):
            return chunk_size
        return config.index.chunk_size

    def history_backfill_status(self) -> dict[str, Any]:
        """Return whether historical chat data still needs knowledge backfill."""
        state = self._load_backfill_state()
        has_backfill_record = bool(state)
        backfill_completed = bool(state.get("completed"))

        chats_path = self.working_dir / CHATS_FILE
        history_chat_count = 0
        if chats_path.exists():
            try:
                payload = self._load_json(chats_path)
                chats = payload.get("chats", [])
                history_chat_count = sum(
                    1
                    for chat in chats
                    if str(chat.get("session_id", "") or "").strip()
                )
            except Exception:
                history_chat_count = 0

        marked_unbackfilled = not backfill_completed
        has_pending_history = marked_unbackfilled and history_chat_count > 0
        return {
            "has_backfill_record": has_backfill_record,
            "backfill_completed": backfill_completed,
            "marked_unbackfilled": marked_unbackfilled,
            "history_chat_count": history_chat_count,
            "has_pending_history": has_pending_history,
            "progress": self.get_history_backfill_progress(),
        }

    def get_history_backfill_progress(self) -> dict[str, Any]:
        payload = self._load_backfill_progress_state()
        running = bool(payload.get("running"))
        completed = bool(payload.get("completed"))
        failed = bool(payload.get("failed"))
        total_sessions = int(payload.get("total_sessions", 0) or 0)
        traversed_sessions = int(payload.get("traversed_sessions", 0) or 0)
        safe_total = max(total_sessions, 1)
        percent = 100 if completed else int(max(0, min(100, (traversed_sessions / safe_total) * 100)))

        stage = "idle"
        if running:
            stage = "processing"
        elif completed:
            stage = "completed"
        elif failed:
            stage = "failed"

        return {
            "task_type": "history_backfill",
            "running": running,
            "completed": completed,
            "failed": failed,
            "stage": stage,
            "current_stage": stage,
            "stage_message": str(payload.get("reason") or "").strip() or (
                "Backfilling history sessions" if running else ""
            ),
            "progress": percent,
            "percent": percent,
            "current": traversed_sessions,
            "total": total_sessions,
            "eta_seconds": None,
            "total_sessions": total_sessions,
            "traversed_sessions": traversed_sessions,
            "processed_sessions": int(payload.get("processed_sessions", 0) or 0),
            "current_session_id": payload.get("current_session_id"),
            "error": payload.get("error"),
            "updated_at": payload.get("updated_at"),
            "reason": payload.get("reason"),
        }

    def _load_backfill_state(self) -> dict[str, Any]:
        if not self.backfill_state_path.exists():
            return {}
        try:
            return self._load_json(self.backfill_state_path)
        except Exception:
            return {}

    def _save_backfill_state(self, payload: dict[str, Any]) -> None:
        self.backfill_state_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _load_backfill_progress_state(self) -> dict[str, Any]:
        if not self.backfill_progress_path.exists():
            return {}
        try:
            return self._load_json(self.backfill_progress_path)
        except Exception:
            return {}

    def _save_backfill_progress(self, payload: dict[str, Any]) -> None:
        self.backfill_progress_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _remote_source_status(self, source: KnowledgeSourceSpec) -> dict[str, Any]:
        remote_hash = ""
        for tag in source.tags or []:
            if tag.startswith("remote:url_hash:"):
                remote_hash = tag.split(":", 2)[-1]
                break
        if not remote_hash:
            return {}

        meta_path = self.remote_meta_dir / f"{remote_hash}.json"
        if not meta_path.exists():
            return {
                "remote_status": "unknown",
                "remote_cache_state": "missing",
                "remote_fail_count": 0,
                "remote_next_retry_at": None,
                "remote_last_error": None,
                "remote_updated_at": None,
            }

        payload = self._load_json(meta_path)
        remote_status = payload.get("status", "unknown")
        fail_count = int(payload.get("fail_count", 0) or 0)
        next_retry_at = payload.get("next_retry_at")
        next_retry_dt = self._parse_iso_utc(next_retry_at)
        now = datetime.now(UTC)

        if remote_status == "ok":
            if source.location and Path(source.location).exists():
                cache_state = "cached"
            else:
                cache_state = "missing"
        elif remote_status == "failed":
            if next_retry_dt is not None and next_retry_dt > now:
                cache_state = "waiting_retry"
            else:
                cache_state = "ready_retry"
        else:
            cache_state = "unknown"

        return {
            "remote_status": remote_status,
            "remote_cache_state": cache_state,
            "remote_fail_count": fail_count,
            "remote_next_retry_at": next_retry_at,
            "remote_last_error": payload.get("last_error"),
            "remote_updated_at": payload.get("updated_at"),
        }

    def _upsert_source(
        self,
        config: KnowledgeConfig,
        source: KnowledgeSourceSpec,
    ) -> bool:
        normalized = self._source_with_auto_name(source, config)
        for index, existing in enumerate(config.sources):
            if existing.id != normalized.id:
                continue
            existing_normalized = self._source_with_auto_name(existing, config)
            if existing_normalized.model_dump(mode="json") == normalized.model_dump(mode="json"):
                return False
            config.sources[index] = normalized
            return True
        config.sources.append(normalized)
        return True

    def _source_with_auto_name(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig | None = None,
    ) -> KnowledgeSourceSpec:
        updates: dict[str, Any] = {}
        source_for_title = source

        if not (source.summary or "").strip():
            generated_summary = self._generate_source_summary(source, config)
            if generated_summary:
                updates["summary"] = generated_summary
                source_for_title = source.model_copy(
                    update={"summary": generated_summary}
                )

        generated = self._generate_source_name(source_for_title, config)
        if source.name != generated:
            updates["name"] = generated

        if not updates:
            return source
        return source.model_copy(update=updates)

    def _generate_source_summary(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig | None = None,
    ) -> str:
        semantic = self._semantic_summary_for_source(source, config)
        if semantic:
            keywords = self._semantic_keywords_for_source(source, config)
            if keywords:
                summary_with_keywords = (
                    f"{semantic} 关键词: {', '.join(keywords)}"
                )
                return self._truncate_summary(summary_with_keywords)
            return self._truncate_summary(semantic)

        if source.type == "url":
            url = (source.location or "").strip()
            if url:
                parsed = urlparse(url)
                host = parsed.netloc or url
                path = parsed.path.strip("/")
                tail = path.split("/")[-1] if path else ""
                if tail:
                    return self._truncate_summary(f"{host}/{tail}")
                return self._truncate_summary(host)

        if source.type in {"file", "directory"} and source.location:
            location = (source.location or "").strip()
            if location:
                return self._truncate_summary(Path(location).name or location)

        if source.name:
            return self._truncate_summary(source.name)
        return ""

    def _semantic_summary_for_source(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig | None = None,
    ) -> str:
        processed = self._process_source_knowledge(source, config)
        return processed.get("summary", "")

    def _generate_source_name(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig | None = None,
    ) -> str:
        semantic = self._semantic_subject_for_source(source, config)
        if semantic:
            return self._truncate_title(semantic)

        if source.type == "url":
            url = (source.location or "").strip()
            if url:
                parsed = urlparse(url)
                host = parsed.netloc or url
                path = parsed.path.strip("/")
                tail = path.split("/")[-1] if path else ""
                if tail:
                    return self._truncate_title(f"{host}/{tail}")
                return self._truncate_title(host)

        if source.type in {"file", "directory"} and source.location:
            location = (source.location or "").strip()
            if location:
                return self._truncate_title(Path(location).name or location)

        return self._truncate_title(source.id)

    def _semantic_subject_for_source(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig | None = None,
    ) -> str:
        processed = self._process_source_knowledge(source, config)
        return processed.get("subject", "")

    def _semantic_keywords_for_source(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig | None = None,
        top_n: int = _KEYWORD_DEFAULT_TOP_N,
    ) -> list[str]:
        processed = self._process_source_knowledge(source, config, top_n=top_n)
        return processed.get("keywords", [])

    def _process_source_knowledge(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig | None = None,
        top_n: int = _KEYWORD_DEFAULT_TOP_N,
    ) -> dict[str, Any]:
        candidates = self._collect_source_processing_candidates(source, config)
        merged = self._normalize_text("\n".join(part for part in candidates if part))
        processed = self._process_knowledge_text(merged, top_n=top_n, config=config)

        # Keep deterministic priority for subjects: summary > content > index/title.
        for candidate in candidates:
            subject = self._extract_subject_from_text(candidate, config=config)
            if subject:
                processed["subject"] = subject
                break
        return processed

    def _process_knowledge_text(
        self,
        text: str,
        top_n: int = _KEYWORD_DEFAULT_TOP_N,
        config: KnowledgeConfig | None = None,
    ) -> dict[str, Any]:
        normalized = self._normalize_text(text or "")
        if not normalized:
            return {
                "subject": "",
                "summary": "",
                "keywords": [],
            }

        return {
            "subject": self._extract_subject_from_text(normalized, config=config),
            "summary": self._extract_summary_from_text(normalized, config=config),
            "keywords": self._extract_keywords_from_text(normalized, top_n=top_n, config=config),
        }

    def _collect_source_processing_text(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig | None = None,
    ) -> str:
        candidates = self._collect_source_processing_candidates(source, config)
        return self._normalize_text("\n".join(part for part in candidates if part))

    def _collect_source_processing_candidates(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig | None = None,
    ) -> list[str]:
        candidates: list[str] = []

        if source.summary and source.summary.strip():
            candidates.append(source.summary)
        if source.content and source.content.strip():
            candidates.append(source.content)

        indexed_payload = self._load_index_payload_safe(source.id)
        if indexed_payload:
            chunk_titles: list[str] = []
            chunk_texts: list[str] = []
            for chunk in indexed_payload.get("chunks", []):
                if not isinstance(chunk, dict):
                    continue
                chunk_title = chunk.get("document_title")
                if isinstance(chunk_title, str) and chunk_title.strip():
                    chunk_titles.append(chunk_title)
                chunk_text = self._read_chunk_text(chunk)
                if chunk_text.strip():
                    chunk_texts.append(chunk_text)

            if chunk_titles:
                candidates.append("\n".join(chunk_titles))
            if chunk_texts:
                candidates.append("\n".join(chunk_texts))

        location = (source.location or "").strip()
        if source.type == "file" and location:
            full_text = self._read_local_text(Path(location))
            if full_text:
                candidates.append(full_text)
        elif source.type == "directory" and location:
            full_text = self._read_directory_text(Path(location), config)
            if full_text:
                candidates.append(full_text)

        return candidates

    def _read_local_text(self, path: Path) -> str:
        try:
            resolved = path.expanduser().resolve()
            if not resolved.exists() or not resolved.is_file():
                return ""
            text = self._read_text_file_content(resolved)
            return text or ""
        except Exception:
            return ""

    def _read_directory_text(
        self,
        directory: Path,
        config: KnowledgeConfig | None = None,
    ) -> str:
        try:
            root = directory.expanduser().resolve()
            if not root.exists() or not root.is_dir():
                return ""
            parts: list[str] = []
            for path in root.rglob("*"):
                if not path.is_file():
                    continue
                if config is not None:
                    relative = path.relative_to(root).as_posix()
                    if not self._is_allowed_path(relative, config):
                        continue
                text = self._read_local_text(path)
                if text:
                    parts.append(text)
            return self._normalize_text("\n".join(parts))
        except Exception:
            return ""

    def _load_index_payload_safe(self, source_id: str) -> dict[str, Any] | None:
        index_path = self._source_index_path(source_id)
        if not index_path.exists():
            return None
        try:
            return self._load_json(index_path)
        except Exception:
            return None

    def _read_local_text_snippet(self, path: Path, max_chars: int = 2400) -> str:
        try:
            resolved = path.expanduser().resolve()
            if not resolved.exists() or not resolved.is_file():
                return ""
            raw = resolved.read_text(encoding="utf-8", errors="ignore")
            return self._normalize_text(raw[:max_chars])
        except Exception:
            return ""

    def _read_directory_text_snippet(self, directory: Path, max_chars: int = 2400) -> str:
        try:
            root = directory.expanduser().resolve()
            if not root.exists() or not root.is_dir():
                return ""
            for path in root.rglob("*"):
                if not path.is_file():
                    continue
                snippet = self._read_local_text_snippet(path, max_chars=max_chars)
                if snippet:
                    return snippet
        except Exception:
            return ""
        return ""

    def _semantic_title_from_text(
        self,
        text: str,
        config: KnowledgeConfig | None = None,
    ) -> str:
        normalized = self._normalize_text(text or "")
        if not normalized:
            return ""

        sentences = [
            s.strip(" \t-:：;；,.。!?！？")
            for s in _TITLE_SENTENCE_SPLIT_RE.split(normalized)
            if s.strip()
        ]
        if not sentences:
            return ""

        token_freq: dict[str, int] = {}
        sentence_tokens: list[list[str]] = []
        for sentence in sentences:
            tokens = self._tokenize_semantic_text(sentence, config=config)
            sentence_tokens.append(tokens)
            for token in tokens:
                token_freq[token] = token_freq.get(token, 0) + 1

        best_sentence = ""
        best_score = -1.0
        for sentence, tokens in zip(sentences, sentence_tokens):
            if not tokens:
                score = 0.0
            else:
                unique_score = sum(token_freq.get(token, 0) for token in set(tokens))
                score = unique_score / (len(tokens) ** 0.5)
            if score > best_score:
                best_score = score
                best_sentence = sentence

        if not best_sentence:
            best_sentence = sentences[0]
        return self._normalize_text(best_sentence)

    def _extract_subject_from_text(
        self,
        text: str,
        config: KnowledgeConfig | None = None,
    ) -> str:
        return self._semantic_title_from_text(text, config=config)

    def _extract_summary_from_text(
        self,
        text: str,
        config: KnowledgeConfig | None = None,
    ) -> str:
        # Keep the summary extractor independent for future tuning.
        return self._semantic_title_from_text(text, config=config)

    @staticmethod
    def _tokenize_lightweight_text(text: str, *, exclude_stop_words: bool = False) -> list[str]:
        normalized = re.sub(r"\s+", " ", (text or "").strip())
        if not normalized:
            return []

        tokens: list[str] = []
        for raw in _LIGHTWEIGHT_TOKEN_RE.findall(normalized):
            token = str(raw).strip().lower()
            if not token:
                continue
            if exclude_stop_words and token in _SEMANTIC_STOP_WORDS:
                continue
            tokens.append(token)
        return tokens

    def _tokenize_semantic_text(
        self,
        text: str,
        *,
        exclude_stop_words: bool = True,
        config: KnowledgeConfig | None = None,
    ) -> list[str]:
        normalized = re.sub(r"\s+", " ", (text or "").strip())
        if not normalized:
            return []

        raw_tokens, state = self._semantic_runtime.tokenize(normalized, config)
        self._remember_semantic_engine_state(state)
        if state.get("status") != "ready":
            logger.info(
                "HanLP2 sidecar is unavailable; semantic tokenization is skipped (%s)",
                state.get("reason_code"),
            )
            return []

        if not raw_tokens:
            self._semantic_engine_state(
                status="ready",
                reason_code="HANLP2_READY",
                reason="HanLP2 semantic engine is ready.",
            )
            return []

        tokens: list[str] = []
        for raw in raw_tokens:
            token = str(raw).strip().lower()
            if not token:
                continue
            if not _SEMANTIC_TOKEN_RE.fullmatch(token):
                continue
            if exclude_stop_words and token in _SEMANTIC_STOP_WORDS:
                continue
            tokens.append(token)
        self._semantic_engine_state(
            status="ready",
            reason_code="HANLP2_READY",
            reason="HanLP2 semantic engine is ready.",
        )
        return tokens

    def _extract_keywords_from_text(
        self,
        text: str,
        top_n: int = 3,
        config: KnowledgeConfig | None = None,
    ) -> list[str]:
        tokens = self._tokenize_semantic_text(text, config=config)
        if not tokens or top_n <= 0:
            return []

        freq = Counter(tokens)
        ranked = sorted(freq.items(), key=lambda item: (-item[1], item[0]))
        return [token for token, _ in ranked[:top_n]]

    @staticmethod
    def _truncate_title(value: str, max_len: int = 120) -> str:
        compact = re.sub(r"\s+", " ", (value or "").strip())
        if not compact:
            compact = "knowledge"
        if len(compact) <= max_len:
            return compact
        return compact[: max_len - 3].rstrip() + "..."

    @staticmethod
    def _truncate_summary(value: str, max_len: int = 180) -> str:
        compact = re.sub(r"\s+", " ", (value or "").strip())
        if not compact:
            return ""
        if len(compact) <= max_len:
            return compact
        return compact[: max_len - 3].rstrip() + "..."

    @staticmethod
    def _chunk_documents(
        documents: list[dict[str, Any]],
        chunk_size: int,
    ) -> list[dict[str, Any]]:
        chunks: list[dict[str, Any]] = []
        for document in documents:
            text = document["text"]
            if not text:
                continue
            chunk_subject = str(document.get("snapshot_path") or document["path"])
            for index, start in enumerate(range(0, len(text), chunk_size)):
                chunk_text = text[start : start + chunk_size]
                if not chunk_text.strip():
                    continue
                sentences = KnowledgeManager._split_chunk_sentences(chunk_text)
                normalized_chunk_text = "\n".join(sentences) if sentences else chunk_text.strip()
                chunks.append(
                    {
                        "chunk_id": f"{chunk_subject}::{index}",
                        "document_path": document["path"],
                        "document_title": document["title"],
                        "snapshot_path": document.get("snapshot_path"),
                        "snapshot_relative_path": document.get("snapshot_relative_path"),
                        "snapshot_at": document.get("snapshot_at"),
                        "text": normalized_chunk_text,
                        "sentence_count": len(sentences),
                    },
                )
        return chunks

    @classmethod
    def _build_document_stats(cls, documents: list[dict[str, str]]) -> dict[str, int]:
        char_count = 0
        token_count = 0
        for document in documents:
            text = str(document.get("text") or "")
            if not text:
                continue
            char_count += cls._count_text_chars(text)
            token_count += len(cls._tokenize_lightweight_text(text, exclude_stop_words=False))
        return {
            "char_count": char_count,
            "token_count": token_count,
        }

    @staticmethod
    def _count_text_chars(text: str) -> int:
        return len(re.sub(r"\s+", "", text or ""))

    @staticmethod
    def _split_chunk_sentences(text: str) -> list[str]:
        normalized = text.replace("\r\n", "\n").replace("\r", "\n")
        delimiters = {"。", "！", "？", "!", "?", ";", "；", ".", "\n"}
        sentences: list[str] = []
        buffer: list[str] = []

        for char in normalized:
            buffer.append(char)
            if char not in delimiters:
                continue
            sentence = "".join(buffer).strip()
            if sentence:
                sentences.append(sentence)
            buffer = []

        trailing = "".join(buffer).strip()
        if trailing:
            sentences.append(trailing)
        return sentences

    @staticmethod
    def _sum_chunk_sentence_count(chunks: list[dict[str, Any]]) -> int:
        total = 0
        for chunk in chunks:
            try:
                count = int(chunk.get("sentence_count") or 0)
            except (TypeError, ValueError):
                count = 0
            total += max(0, count)
        return total

    @classmethod
    def _sum_chunk_char_count(cls, chunks: list[dict[str, Any]]) -> int:
        total = 0
        for chunk in chunks:
            total += cls._count_text_chars(str(chunk.get("text") or ""))
        return total

    @classmethod
    def _sum_chunk_token_count(cls, chunks: list[dict[str, Any]]) -> int:
        total = 0
        for chunk in chunks:
            total += len(
                cls._tokenize_lightweight_text(
                    str(chunk.get("text") or ""),
                    exclude_stop_words=False,
                )
            )
        return total

    @staticmethod
    def compute_processing_fingerprint(
        config: KnowledgeConfig,
        running_config: Any | None = None,
    ) -> str:
        chunk_size = getattr(running_config, "knowledge_chunk_size", None)
        if not isinstance(chunk_size, int):
            chunk_size = config.index.chunk_size
        chunk_overlap = int(getattr(config.index, "chunk_overlap", 0) or 0)
        memify_flag = 1 if bool(getattr(config, "memify_enabled", False)) else 0
        raw = f"{KNOWLEDGE_PROCESSING_VERSION}:{chunk_size}:{chunk_overlap}:me{memify_flag}"
        return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]

    @staticmethod
    def _score_chunk(text: str, terms: list[str]) -> int:
        lowered = text.lower()
        score = 0
        phrase = " ".join(terms)
        if phrase and phrase in lowered:
            score += len(terms) + 2
        for term in terms:
            score += lowered.count(term)
        return score

    @staticmethod
    def _build_snippet(text: str, terms: list[str], length: int = 240) -> str:
        lowered = text.lower()
        position = 0
        for term in terms:
            found = lowered.find(term)
            if found >= 0:
                position = found
                break
        start = max(position - 60, 0)
        end = min(start + length, len(text))
        return text[start:end].strip()

    @staticmethod
    def _has_hidden_directory_segment(relative_path: str) -> bool:
        normalized = relative_path.strip("/")
        path_parts = Path(normalized).parts
        if not path_parts:
            return False
        last_index = len(path_parts) - 1
        for index, part in enumerate(path_parts):
            if not part.startswith("."):
                continue
            if index < last_index:
                return True
        return False

    @staticmethod
    def _is_allowed_path(relative_path: str, config: KnowledgeConfig) -> bool:
        normalized = relative_path.strip("/")
        path_parts = Path(normalized).parts
        if KnowledgeManager._has_hidden_directory_segment(normalized):
            return False
        if any(part in _INTERNAL_EXCLUDED_DIRS for part in path_parts):
            return False
        if path_parts and path_parts[-1].lower() in _INTERNAL_EXCLUDED_FILENAMES:
            return False
        if any(
            fnmatch.fnmatch(normalized, pattern)
            for pattern in config.index.exclude_globs
        ):
            return False
        if not config.index.include_globs:
            return True
        return any(
            fnmatch.fnmatch(normalized, pattern)
            or fnmatch.fnmatch(f"./{normalized}", pattern)
            for pattern in config.index.include_globs
        )

    @staticmethod
    def _safe_name(value: str) -> str:
        safe = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-.")
        return safe or "knowledge"

    @staticmethod
    def _session_filename(session_id: str, user_id: str) -> str:
        safe_sid = _sanitize_filename(session_id)
        safe_uid = _sanitize_filename(user_id) if user_id else ""
        if safe_uid:
            return f"{safe_uid}_{safe_sid}.json"
        return f"{safe_sid}.json"