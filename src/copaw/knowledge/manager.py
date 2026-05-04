# -*- coding: utf-8 -*-
"""File-backed knowledge source indexing and search."""

from __future__ import annotations

import fnmatch
import filecmp
import hashlib
import json
import logging
import re
import shutil
from collections import Counter
from datetime import datetime, timedelta, timezone

UTC = timezone.utc
from html import escape, unescape
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse, parse_qs

import httpx

from ..constant import CHATS_FILE
from ..config.config import KnowledgeConfig, KnowledgeSourceSpec
from .hanlp_runtime import NLPRuntime

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
    "original",
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
_NER_SENTENCE_DELIMITERS = {"。", "！", "？", "!", "?", ";", "；", ".", "\n"}
_COR_FORMAT_VERSION = "0.1"
_NER_FORMAT_VERSION = "1.1"
_SYNTAX_FORMAT_VERSION = "0.2"
_SEMANTIC_STAGE_PATH_KEYS = {
    "cor": ("cor_path", "cor_structured_path", "cor_annotated_path"),
    "ner": ("ner_path", "ner_structured_path", "ner_annotated_path", "ner_stats_path"),
    "syntax": ("syntax_path", "syntax_structured_path", "syntax_annotated_path"),
}
_INTERLINEAR_CHAR_RE = re.compile(r"[A-Za-z0-9\u4e00-\u9fff]")


def _sanitize_filename(name: str) -> str:
    return _UNSAFE_FILENAME_RE.sub("--", name)


def _safe_count_int(value: Any) -> int:
    """Convert metric-like values to int safely.

    Some pipeline payloads may carry list-based counters (e.g. relations),
    which should be interpreted by length instead of raising TypeError.
    """
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (list, tuple, set)):
        return len(value)
    if isinstance(value, dict):
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0





class KnowledgeManager:
    """Manage knowledge source indexing within the CoPaw working directory."""

    def __init__(self, project_root: Path, knowledge_dirname: str = ".knowledge"):
        self.project_root = Path(project_root)
        self.working_dir = self.project_root
        self.knowledge_dir = self.project_root / knowledge_dirname
        self.root_dir = self.knowledge_dir
        self.raw_dir = self.knowledge_dir / "raw"
        self.chunks_dir = self.knowledge_dir / "chunks"
        self.cor_dir = self.knowledge_dir / "cor"
        self.ner_dir = self.knowledge_dir / "ner"
        self.syntax_dir = self.knowledge_dir / "syntax"
        self.interlinear_dir = self.knowledge_dir / "interlinear"
        self.lightweight_dir = self.knowledge_dir / "lightweight"
        self.uploads_dir = self.knowledge_dir / "uploads"
        self.remote_blob_dir = self.knowledge_dir / "remote-blob"
        self.remote_meta_dir = self.knowledge_dir / "remote-meta"
        self.catalog_path = self.knowledge_dir / "catalog.json"
        self.backfill_state_path = self.knowledge_dir / "history-backfill-state.json"
        self.backfill_progress_path = (
            self.knowledge_dir / "history-backfill-progress.json"
        )
        self._semantic_runtime = NLPRuntime()
        self._nlp_state: dict[str, str] | None = None
        self._purge_legacy_project_source_dirs()

    def _remember_semantic_engine_state(self, state: dict) -> None:
        """No-op for artifacts-only mode. Exists for legacy compatibility."""
        pass

    def _semantic_engine_state(
        self,
        *,
        status: str,
        reason_code: str,
        reason: str,
    ) -> dict[str, str]:
        """Compatibility helper for legacy callers that update semantic state."""
        return {
            "status": str(status or "unavailable"),
            "reason_code": str(reason_code or "NLP_ENGINE_UNAVAILABLE"),
            "reason": str(reason or "NLP semantic engine is not configured."),
        }

    def get_semantic_engine_state(self, config: KnowledgeConfig | None = None) -> dict:
        """Return the current semantic engine state. Placeholder for artifacts-only mode."""
        # 仅返回一个简单的 ready/unavailable 状态，后续如需扩展可再完善
        return {
            "status": "unavailable",
            "reason_code": "NLP_ENGINE_UNAVAILABLE",
            "reason": "NLP semantic engine is not configured.",
        }

    def normalize_source_name(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig | None = None,
    ) -> KnowledgeSourceSpec:
        """Return a source with auto-generated name derived from its content/location."""
        return self._source_with_auto_name(source, config)

    def get_source_documents(self, source_id: str) -> dict[str, Any]:
        """Return the indexed documents for a source, based only on interlinear-manifest.json.
        返回的每个 document 必须包含原始文档路径（document_path 或 relative_path），以便测试断言 .endswith('xxx.md') 能通过。
        """
        interlinear_manifest = self._load_source_interlinear_manifest(source_id)
        artifacts = interlinear_manifest.get("artifacts", [])
        docs: dict[str, dict[str, Any]] = {}
        for artifact in artifacts:
            doc_id = artifact.get("doc_id") or artifact.get("document_path") or artifact.get("path")
            if not doc_id:
                continue
            # 构造返回结构，优先暴露原始文档路径
            doc_path = artifact.get("document_path") or artifact.get("relative_path") or artifact.get("path")
            doc = dict(artifact)
            doc["path"] = doc_path
            docs[doc_id] = doc
        return {"documents": list(docs.values())}

    def get_source_status(
        self,
        source_id: str,
        source: KnowledgeSourceSpec | None = None,
        config: KnowledgeConfig | None = None,
        running_config: Any | None = None,
        *,
        lightweight: bool = False,
    ) -> dict[str, Any]:
        """Interlinear-only: Return status/statistics for a source based on Interlinear/轻量化工件。"""
        interlinear_manifest = self._load_source_interlinear_manifest(source_id)
        summary = interlinear_manifest.get("summary", {})
        indexed = bool(summary)
        stats = self._load_source_stats(source_id)
        chunk_count = summary.get("chunk_count", 0)
        document_count = chunk_count  # Alias for backward compatibility
        if indexed:
            status = {
                "indexed": True,
                "indexed_at": interlinear_manifest.get("updated_at"),
                "chunk_count": chunk_count,
                "document_count": document_count,
                "sentence_count": summary.get("sentence_count", 0),
                "char_count": summary.get("char_count", 0),
                "token_count": summary.get("token_count", 0),
                "needs_reindex": False,
                "error": None,
                "raw_document_count": stats.get("raw_document_count", 0),
                "raw_total_bytes": stats.get("raw_total_bytes", 0),
                "raw_last_ingested_at": stats.get("raw_last_ingested_at"),
                "stats_updated_at": stats.get("stats_updated_at"),
            }
        else:
            # 未生成 interlinear-manifest.json，若 stats.json 有 raw_document_count/bytes，needs_reindex=True，否则 False
            needs_reindex = bool(stats.get("raw_document_count", 0))
            status = {
                "indexed": False,
                "indexed_at": None,
                "chunk_count": 0,
                "document_count": 0,
                "sentence_count": 0,
                "char_count": 0,
                "token_count": 0,
                "needs_reindex": needs_reindex,
                "error": None,
                "raw_document_count": stats.get("raw_document_count", 0),
                "raw_total_bytes": stats.get("raw_total_bytes", 0),
                "raw_last_ingested_at": stats.get("raw_last_ingested_at"),
                "stats_updated_at": stats.get("stats_updated_at"),
            }
        if source is not None:
            status.update(self._remote_source_status(source))
        return status

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

    def _source_dir(self, source_id: str) -> Path:
        # 旧版 source 命名空间目录（仅用于兼容读取与遗留清理）
        return self.root_dir / self._safe_name(source_id)

    def _source_storage_flat_path(self, source_id: str, filename: str) -> Path:
        safe_source_id = self._safe_name(source_id)
        safe_filename = self._safe_name(filename)
        return self.root_dir / f"{safe_source_id}--{safe_filename}"

    def _source_storage_path(self, source_id: str, filename: str) -> Path:
        """Return flattened storage path only (legacy layout is not supported)."""
        return self._source_storage_flat_path(source_id, filename)

    def _purge_legacy_project_source_dirs(self) -> None:
        if not self.root_dir.exists() or not self.root_dir.is_dir():
            return
        for legacy_dir in self.root_dir.glob("project-*-workspace"):
            if legacy_dir.is_dir():
                shutil.rmtree(legacy_dir, ignore_errors=True)

    def _prune_legacy_source_dir(self, source_id: str) -> None:
        """Remove legacy source directory entirely (no compatibility read path)."""
        legacy_dir = self._source_dir(source_id)
        if not legacy_dir.exists() or not legacy_dir.is_dir():
            return
        shutil.rmtree(legacy_dir, ignore_errors=True)

    def index_source(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig,
        running_config: Any | None = None,
        *,
        include_semantic_artifacts: bool = True,
    ) -> dict[str, Any]:
        """Index a single source into stage-separated artifacts."""
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
        payload: dict[str, Any] = {
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
        self._write_source_storage(
            source,
            payload,
            live_documents,
            config=config,
            include_semantic_artifacts=include_semantic_artifacts,
        )
        self._apply_semantic_stage_metrics(payload)
        self._clear_l2_checkpoint(payload)
        self._write_source_index_payload(source.id, payload)
        self._update_source_stats_after_index(source.id, payload)

        return {
            "source_id": source.id,
            "document_count": len(live_documents),
            "snapshot_count": len(documents),
            "chunk_count": len(chunks),
            "sentence_count": sentence_count,
            "char_count": document_stats["char_count"],
            "token_count": document_stats["token_count"],
            "indexed_at": payload["indexed_at"],
            "cor_ready_chunk_count": _safe_count_int(payload.get("cor_ready_chunk_count") or 0),
            "cor_ready_document_count": _safe_count_int(payload.get("cor_ready_chunk_count") or 0),  # Alias
            "cor_cluster_count": _safe_count_int(payload.get("cor_cluster_count") or 0),
            "cor_replacement_count": _safe_count_int(payload.get("cor_replacement_count") or 0),
            "cor_effective_chunk_count": _safe_count_int(payload.get("cor_effective_chunk_count") or 0),
            "cor_reason_code": str(payload.get("cor_reason_code") or "").strip(),
            "cor_reason": str(payload.get("cor_reason") or "").strip(),
            "cor_ready_chunk_ratio": float(payload.get("cor_ready_chunk_ratio") or 0.0),
            "cor_effective_chunk_ratio": float(payload.get("cor_effective_chunk_ratio") or 0.0),
            "ner_ready_chunk_count": _safe_count_int(payload.get("ner_ready_chunk_count") or 0),
            "ner_entity_count": _safe_count_int(payload.get("ner_entity_count") or 0),
            "syntax_ready_chunk_count": _safe_count_int(payload.get("syntax_ready_chunk_count") or 0),
            "syntax_ready_document_count": _safe_count_int(payload.get("syntax_ready_chunk_count") or 0),  # Alias
            "syntax_sentence_count": _safe_count_int(payload.get("syntax_sentence_count") or 0),
            "syntax_token_count": _safe_count_int(payload.get("syntax_token_count") or 0),
            "syntax_relation_count": _safe_count_int(payload.get("syntax_relation_count") or 0),
        }

    def materialize_semantic_artifacts_for_source(
        self,
        source: KnowledgeSourceSpec,
        *,
        config: KnowledgeConfig,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        """Generate COR/NER/Syntax artifacts for an existing source payload."""
        payload = self._load_index_payload_safe(source.id)
        if not isinstance(payload, dict):
            raise ValueError(f"Source index payload is missing: {source.id}")

        raw_chunks = payload.get("chunks")
        if not isinstance(raw_chunks, list):
            payload["chunks"] = []
            raw_chunks = []
        total_chunks = len(raw_chunks)

        stage_done = {"cor": 0, "ner": 0, "syntax": 0}
        live_metrics: dict[str, Any] = {
            "cor_ready_chunk_count": 0,
            "cor_cluster_count": 0,
            "cor_replacement_count": 0,
            "cor_effective_chunk_count": 0,
            "ner_ready_chunk_count": 0,
            "ner_entity_count": 0,
            "syntax_ready_chunk_count": 0,
            "syntax_sentence_count": 0,
            "syntax_token_count": 0,
            "syntax_relation_count": 0,
        }

        def _emit_l2(stage_payload: dict[str, Any]) -> None:
            if progress_callback is None:
                return
            stage = str(stage_payload.get("stage") or "").strip().lower()
            if stage not in {"cor", "ner", "syntax"}:
                return
            done_chunks = max(0, _safe_count_int(stage_payload.get("done_chunks") or 0))
            if total_chunks > 0:
                done_chunks = min(done_chunks, total_chunks)
            stage_done[stage] = max(stage_done.get(stage, 0), done_chunks)
            stage_metrics = stage_payload.get("metrics")
            if isinstance(stage_metrics, dict):
                for key, value in stage_metrics.items():
                    if key in live_metrics:
                        live_metrics[key] = max(0, _safe_count_int(value))

            processed = stage_done["cor"] + stage_done["ner"] + stage_done["syntax"]
            denom = total_chunks * 3
            ratio = (processed / denom) if denom > 0 else 1.0
            progress = 45 + int(max(0.0, min(1.0, ratio)) * 25)
            stage_title = {"cor": "COR", "ner": "NER", "syntax": "Syntax"}.get(stage, stage.upper())
            progress_callback(
                {
                    "stage_message": (
                        f"L2 {stage_title} {stage_done[stage]}/{total_chunks}"
                        f" · COR {stage_done['cor']}/{total_chunks}"
                        f" · NER {stage_done['ner']}/{total_chunks}"
                        f" · Syntax {stage_done['syntax']}/{total_chunks}"
                    ),
                    "progress": max(45, min(70, progress)),
                    "l2_progress": {
                        "total_chunks": total_chunks,
                        "cor_done_chunks": stage_done["cor"],
                        "ner_done_chunks": stage_done["ner"],
                        "syntax_done_chunks": stage_done["syntax"],
                    },
                    "l2_metrics": dict(live_metrics),
                }
            )

        self._write_chunk_ner_artifacts(
            source,
            payload,
            config=config,
            progress_callback=_emit_l2,
            progress_start=55,
            progress_end=63,
        )
        self._write_chunk_syntax_artifacts(
            source,
            payload,
            config=config,
            progress_callback=_emit_l2,
            progress_start=64,
            progress_end=70,
        )
        self._write_chunk_cor_artifacts(
            source,
            payload,
            config=config,
            progress_callback=_emit_l2,
            progress_start=45,
            progress_end=54,
        )

        self._apply_semantic_stage_metrics(payload)
        self._clear_l2_checkpoint(payload)
        self._write_source_index_payload(source.id, payload)
        self._update_source_stats_after_index(source.id, payload)
        return payload

    def _apply_semantic_stage_metrics(self, payload: dict[str, Any]) -> None:
        raw_chunks = payload.get("chunks")
        chunks: list[dict[str, Any]] = raw_chunks if isinstance(raw_chunks, list) else []
        cor_ready_chunk_count = 0
        cor_cluster_count = 0
        cor_replacement_count = 0
        cor_effective_chunk_count = 0
        ner_ready_chunk_count = 0
        ner_entity_count = 0
        syntax_ready_chunk_count = 0
        syntax_sentence_count = 0
        syntax_token_count = 0
        syntax_relation_count = 0
        cor_reason_counts: dict[str, int] = {}
        cor_reason_messages: dict[str, str] = {}

        for chunk in chunks:
            if not isinstance(chunk, dict):
                continue

            if str(chunk.get("ner_status") or "").strip() == "ready":
                ner_ready_chunk_count += 1
            ner_entity_count += max(0, _safe_count_int(chunk.get("ner_entity_count") or 0))

            if str(chunk.get("syntax_status") or "").strip() == "ready":
                syntax_ready_chunk_count += 1
            syntax_sentence_count += max(0, _safe_count_int(chunk.get("syntax_sentence_count") or 0))
            syntax_token_count += max(0, _safe_count_int(chunk.get("syntax_token_count") or 0))
            syntax_relation_count += max(0, _safe_count_int(chunk.get("syntax_relation_count") or 0))

            reason_code = str(chunk.get("cor_reason_code") or "").strip()
            reason = str(chunk.get("cor_reason") or "").strip()
            if reason_code:
                cor_reason_counts[reason_code] = cor_reason_counts.get(reason_code, 0) + 1
                if reason and reason_code not in cor_reason_messages:
                    cor_reason_messages[reason_code] = reason
            if str(chunk.get("cor_status") or "").strip() != "ready":
                continue
            cor_ready_chunk_count += 1
            chunk_cluster_count = _safe_count_int(chunk.get("cor_cluster_count") or 0)
            chunk_replacement_count = _safe_count_int(chunk.get("cor_replacement_count") or 0)
            cor_cluster_count += max(0, chunk_cluster_count)
            cor_replacement_count += max(0, chunk_replacement_count)
            if chunk_replacement_count > 0:
                cor_effective_chunk_count += 1

        dominant_cor_reason_code = ""
        dominant_cor_reason = ""
        if cor_reason_counts:
            dominant_cor_reason_code = max(
                cor_reason_counts.items(),
                key=lambda item: (item[1], item[0]),
            )[0]
            dominant_cor_reason = cor_reason_messages.get(dominant_cor_reason_code, "")

        payload["cor_ready_chunk_count"] = cor_ready_chunk_count
        payload["cor_cluster_count"] = cor_cluster_count
        payload["cor_replacement_count"] = cor_replacement_count
        payload["cor_effective_chunk_count"] = cor_effective_chunk_count
        payload["cor_reason_code"] = dominant_cor_reason_code
        payload["cor_reason"] = dominant_cor_reason
        payload["cor_ready_chunk_ratio"] = (
            float(cor_ready_chunk_count / len(chunks)) if len(chunks) > 0 else 0.0
        )
        payload["cor_effective_chunk_ratio"] = (
            float(cor_effective_chunk_count / cor_ready_chunk_count)
            if cor_ready_chunk_count > 0
            else 0.0
        )
        payload["ner_ready_chunk_count"] = ner_ready_chunk_count
        payload["ner_entity_count"] = ner_entity_count
        payload["syntax_ready_chunk_count"] = syntax_ready_chunk_count
        payload["syntax_sentence_count"] = syntax_sentence_count
        payload["syntax_token_count"] = syntax_token_count
        payload["syntax_relation_count"] = syntax_relation_count

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
        """Delete persisted artifacts for a source based on all stage manifests."""
        # Interlinear/Lightweight
        interlinear_manifest = self._load_source_interlinear_manifest(source_id)
        for artifact in interlinear_manifest.get("artifacts", []):
            path = artifact.get("path")
            if path:
                self._delete_interlinear_path(path)
        lightweight_paths = self._load_source_lightweight_manifest(source_id)
        for lightweight_path in lightweight_paths:
            self._delete_lightweight_path(lightweight_path)
        # Chunk/NER/COR/Syntax
        for chunk_path in self._load_source_chunk_manifest(source_id):
            self._delete_chunk_path(chunk_path)
        for cor_path in self._load_source_cor_manifest(source_id):
            self._delete_cor_path(cor_path)
        for ner_path in self._load_source_ner_manifest(source_id):
            self._delete_ner_path(ner_path)
        for syntax_path in self._load_source_syntax_manifest(source_id):
            self._delete_syntax_path(syntax_path)
        # Snapshots
        for snapshot in self._load_source_snapshot_manifest(source_id):
            self._delete_snapshot_file(snapshot.get("snapshot_path"))
        # 扁平化元数据文件
        for filename in (
            "content.md",
            "index.json",
            "source.json",
            "stats.json",
            "chunk-manifest.json",
            "cor-manifest.json",
            "ner-manifest.json",
            "syntax-manifest.json",
            "snapshot-manifest.json",
            "interlinear-manifest.json",
            "lightweight-manifest.json",
            "interlinear-lightweight-map.json",
        ):
            flat_path = self._source_storage_flat_path(source_id, filename)
            if flat_path.exists() and flat_path.is_file():
                try:
                    flat_path.unlink()
                except OSError:
                    pass
        # 彻底移除 source 目录
        source_dir = self._source_dir(source_id)
        if source_dir.exists():
            shutil.rmtree(source_dir, ignore_errors=True)

    def clear_knowledge(self, config: KnowledgeConfig, *, remove_sources: bool = True) -> dict[str, Any]:
        """Interlinear-only: 清理所有知识工件和配置。"""
        source_count = len(config.sources)
        if self.root_dir.exists():
            shutil.rmtree(self.root_dir, ignore_errors=True)
        # 只重建 Interlinear/轻量化等目录
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.chunks_dir.mkdir(parents=True, exist_ok=True)
        self.cor_dir.mkdir(parents=True, exist_ok=True)
        self.ner_dir.mkdir(parents=True, exist_ok=True)
        self.syntax_dir.mkdir(parents=True, exist_ok=True)
        self.interlinear_dir.mkdir(parents=True, exist_ok=True)
        self.lightweight_dir.mkdir(parents=True, exist_ok=True)
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.remote_blob_dir.mkdir(parents=True, exist_ok=True)
        self.remote_meta_dir.mkdir(parents=True, exist_ok=True)
        if remove_sources:
            config.sources = []
        return {
            "cleared": True,
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
        """Search indexed interlinear artifacts with a lightweight lexical scorer."""
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
            interlinear_manifest = self._load_source_interlinear_manifest(source.id)
            artifacts = interlinear_manifest.get("artifacts", [])
            for artifact in artifacts:
                interlinear_path = artifact.get("path")
                if not interlinear_path:
                    continue
                try:
                    text = (self.root_dir / interlinear_path).read_text(encoding="utf-8")
                except Exception:
                    text = ""
                score = self._score_chunk(text, terms)
                if score <= 0:
                    continue
                hits.append(
                    {
                        "source_id": source.id,
                        "source_name": source_map[source.id].name,
                        "source_type": source.type,
                        "document_path": artifact.get("document_path"),
                        "document_title": artifact.get("title"),
                        "score": score,
                        "snippet": self._build_snippet(text, terms),
                    },
                )

        hits.sort(key=lambda item: item["score"], reverse=True)
        return {"query": query, "hits": hits[:limit]}

    def _source_content_md_path(self, source_id: str) -> Path:
        return self._source_storage_path(source_id, "content.md")

    def _source_index_path(self, source_id: str) -> Path:
        return self._source_storage_path(source_id, "index.json")

    def _source_metadata_path(self, source_id: str) -> Path:
        return self._source_storage_path(source_id, "source.json")

    def _write_source_index_payload(self, source_id: str, payload: dict[str, Any]) -> None:
        index_path = self._source_index_path(source_id)
        index_path.parent.mkdir(parents=True, exist_ok=True)
        index_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _write_source_metadata(
        self,
        source: KnowledgeSourceSpec,
        *,
        indexed_at: str | None = None,
    ) -> None:
        metadata_path = self._source_metadata_path(source.id)
        metadata_path.parent.mkdir(parents=True, exist_ok=True)
        metadata_path.write_text(
            json.dumps(
                {
                    "source": source.model_dump(mode="json"),
                    "indexed_at": indexed_at,
                    "updated_at": datetime.now(UTC).isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    def _chunk_stage_paths(self, chunk: dict[str, Any], *, stage: str) -> list[str]:
        keys = _SEMANTIC_STAGE_PATH_KEYS.get(stage, ())
        paths: list[str] = []
        for key in keys:
            relative_path = str(chunk.get(key) or "").strip()
            if relative_path:
                paths.append(relative_path)
        return paths

    def _chunk_stage_ready_for_resume(self, chunk: dict[str, Any], *, stage: str) -> bool:
        if str(chunk.get(f"{stage}_status") or "").strip().lower() != "ready":
            return False
        relative_paths = self._chunk_stage_paths(chunk, stage=stage)
        if not relative_paths:
            return False
        for relative_path in relative_paths:
            artifact_path = self.root_dir / relative_path
            if not artifact_path.exists() or not artifact_path.is_file():
                return False
        return True

    def _write_l2_checkpoint(
        self,
        source_id: str,
        payload: dict[str, Any],
        *,
        stage: str,
        done_chunks: int,
        total_chunks: int,
        metrics: dict[str, Any],
    ) -> None:
        payload["l2_checkpoint"] = {
            "stage": str(stage or "").strip().lower(),
            "done_chunks": max(0, _safe_count_int(done_chunks)),
            "total_chunks": max(0, _safe_count_int(total_chunks)),
            "metrics": {
                key: max(0, _safe_count_int(value))
                for key, value in metrics.items()
            },
            "updated_at": datetime.now(UTC).isoformat(),
        }
        self._write_source_index_payload(source_id, payload)

    def _clear_l2_checkpoint(self, payload: dict[str, Any]) -> None:
        payload.pop("l2_checkpoint", None)

    def _source_stats_path(self, source_id: str) -> Path:
        return self._source_storage_path(source_id, "stats.json")

    def _load_source_stats(self, source_id: str) -> dict[str, Any]:
        path = self._source_stats_path(source_id)
        if not path.exists():
            return {}
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        return payload if isinstance(payload, dict) else {}

    def _write_source_stats(self, source_id: str, payload: dict[str, Any]) -> None:
        path = self._source_stats_path(source_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _update_source_stats_after_upload(
        self,
        source_id: str,
        *,
        raw_document_count: int,
        raw_total_bytes: int,
    ) -> None:
        current = self._load_source_stats(source_id)
        now = datetime.now(UTC).isoformat()
        updated = {
            **current,
            "source_id": source_id,
            "raw_document_count": max(0, int(raw_document_count or 0)),
            "raw_total_bytes": max(0, int(raw_total_bytes or 0)),
            "raw_last_ingested_at": now,
            "needs_reindex": True,
            "stats_updated_at": now,
        }
        self._write_source_stats(source_id, updated)

    def _update_source_stats_after_index(
        self,
        source_id: str,
        payload: dict[str, Any],
    ) -> None:
        current = self._load_source_stats(source_id)
        now = datetime.now(UTC).isoformat()
        updated = {
            **current,
            "source_id": source_id,
            "indexed": True,
            "indexed_at": payload.get("indexed_at"),
            "document_count": int(payload.get("document_count", 0) or 0),
            "chunk_count": int(payload.get("chunk_count", 0) or 0),
            "sentence_count": int(payload.get("sentence_count", 0) or 0),
            "char_count": int(payload.get("char_count", 0) or 0),
            "token_count": int(payload.get("token_count", 0) or 0),
            "needs_reindex": False,
            "stats_updated_at": now,
        }
        self._write_source_stats(source_id, updated)

    def _source_chunk_manifest_path(self, source_id: str) -> Path:
        return self._source_storage_path(source_id, "chunk-manifest.json")

    def _source_cor_manifest_path(self, source_id: str) -> Path:
        return self._source_storage_path(source_id, "cor-manifest.json")

    def _source_ner_manifest_path(self, source_id: str) -> Path:
        return self._source_storage_path(source_id, "ner-manifest.json")

    def _source_syntax_manifest_path(self, source_id: str) -> Path:
        return self._source_storage_path(source_id, "syntax-manifest.json")

    def _source_snapshot_manifest_path(self, source_id: str) -> Path:
        return self._source_storage_path(source_id, "snapshot-manifest.json")

    def _source_interlinear_manifest_path(self, source_id: str) -> Path:
        return self._source_storage_path(source_id, "interlinear-manifest.json")

    def _source_lightweight_manifest_path(self, source_id: str) -> Path:
        return self._source_storage_path(source_id, "lightweight-manifest.json")

    def _source_uses_root_raw_dir(self, source: KnowledgeSourceSpec | None) -> bool:
        if source is None:
            return False
        return source.type == "directory" and bool(str(source.project_id or "").strip())

    def _source_raw_dir(
        self,
        source_id: str,
        source: KnowledgeSourceSpec | None = None,
    ) -> Path:
        if self._source_uses_root_raw_dir(source):
            return self.raw_dir
        return self.raw_dir / self._safe_name(source_id)

    def _delete_snapshot_file(self, snapshot_path: str | Path | None) -> None:
        text = str(snapshot_path or "").strip()
        if not text:
            return
        target = Path(text)
        if not target.is_absolute():
            target = self.root_dir / text
        if not target.exists() or not target.is_file():
            return
        try:
            target.unlink()
        except FileNotFoundError:
            return
        current = target.parent
        while current != self.raw_dir and current.exists():
            try:
                current.rmdir()
            except OSError:
                break
            current = current.parent

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

    def _load_source_cor_manifest(self, source_id: str) -> set[str]:
        path = self._source_cor_manifest_path(source_id)
        if not path.exists():
            return set()
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return set()
        if not isinstance(payload, dict):
            return set()
        cor_paths = payload.get("cor_paths")
        if not isinstance(cor_paths, list):
            return set()
        return {
            str(item).strip()
            for item in cor_paths
            if isinstance(item, str) and str(item).strip()
        }

    def _load_source_syntax_manifest(self, source_id: str) -> set[str]:
        path = self._source_syntax_manifest_path(source_id)
        if not path.exists():
            return set()
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return set()
        if not isinstance(payload, dict):
            return set()
        syntax_paths = payload.get("syntax_paths")
        if not isinstance(syntax_paths, list):
            return set()
        return {
            str(item).strip()
            for item in syntax_paths
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

    def _write_source_cor_manifest(self, source_id: str, cor_paths: set[str]) -> None:
        self._source_cor_manifest_path(source_id).write_text(
            json.dumps(
                {
                    "source_id": source_id,
                    "cor_paths": sorted(cor_paths),
                    "updated_at": datetime.now(UTC).isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    def _write_source_syntax_manifest(self, source_id: str, syntax_paths: set[str]) -> None:
        self._source_syntax_manifest_path(source_id).write_text(
            json.dumps(
                {
                    "source_id": source_id,
                    "syntax_paths": sorted(syntax_paths),
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

    def _load_source_interlinear_manifest(self, source_id: str) -> dict:
        """
        读取统一 schema 的 interlinear-manifest.json。
        返回 dict，含 artifacts/summary/updated_at/source_id。
        若不存在则返回空 dict。
        """
        path = self._source_interlinear_manifest_path(source_id)
        if not path.exists():
            return {}
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return {}
        if not isinstance(payload, dict):
            return {}
        # 兼容旧格式
        if "artifacts" not in payload:
            interlinear_paths = payload.get("interlinear_paths")
            if not isinstance(interlinear_paths, list):
                return {}
            artifacts = [
                {"path": str(item).strip()} for item in interlinear_paths if isinstance(item, str) and str(item).strip()
            ]
            payload = {
                "source_id": payload.get("source_id", source_id),
                "updated_at": payload.get("updated_at"),
                "artifacts": artifacts,
                "summary": {},
            }
        return payload

    def _load_source_lightweight_manifest(self, source_id: str) -> set[str]:
        path = self._source_lightweight_manifest_path(source_id)
        if not path.exists():
            return set()
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return set()
        if not isinstance(payload, dict):
            return set()
        lightweight_paths = payload.get("lightweight_paths")
        if not isinstance(lightweight_paths, list):
            return set()
        return {
            str(item).strip()
            for item in lightweight_paths
            if isinstance(item, str) and str(item).strip()
        }

    def _write_source_interlinear_manifest(self, source_id: str, artifacts: list[dict]) -> None:
        """
        写入统一 schema 的 interlinear-manifest.json。
        artifacts: 每个元素包含 path/document_path/title/chunk_id/sentence_count/char_count/token_count/updated_at 等。
        """
        summary = {
            "document_count": len({a.get("document_path") for a in artifacts}),
            "chunk_count": len(artifacts),
            "sentence_count": sum(a.get("sentence_count", 0) for a in artifacts),
            "char_count": sum(a.get("char_count", 0) for a in artifacts),
            "token_count": sum(a.get("token_count", 0) for a in artifacts),
        }
        payload = {
            "source_id": source_id,
            "updated_at": datetime.now(UTC).isoformat(),
            "artifacts": artifacts,
            "summary": summary,
            # "input_fingerprint": "sha256:TODO",  # 可后续补充
        }
        self._source_interlinear_manifest_path(source_id).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def _write_source_lightweight_manifest(self, source_id: str, lightweight_paths: set[str]) -> None:
        self._source_lightweight_manifest_path(source_id).write_text(
            json.dumps(
                {
                    "source_id": source_id,
                    "lightweight_paths": sorted(lightweight_paths),
                    "updated_at": datetime.now(UTC).isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    def _build_interlinear_artifact_key(
        self,
        source_id: str,
        snapshot_entry: dict[str, Any],
    ) -> str:
        document_path = str(snapshot_entry.get("document_path") or "").strip()
        snapshot_relative_path = str(snapshot_entry.get("snapshot_relative_path") or "").strip()
        snapshot_path = str(snapshot_entry.get("snapshot_path") or "").strip()
        raw_key = f"{source_id}:{document_path}:{snapshot_relative_path or snapshot_path}"
        digest = hashlib.sha1(raw_key.encode("utf-8")).hexdigest()[:12]
        base_name = Path(snapshot_relative_path or snapshot_path or document_path or source_id).name
        stem = self._safe_name(Path(base_name).stem or base_name or source_id)
        return f"{self._safe_name(source_id)}__{stem}__{digest}"

    @staticmethod
    def _count_interlinear_line_chars(text: str) -> int:
        return len(_INTERLINEAR_CHAR_RE.findall(text or ""))

    def _build_interlinear_relative_paths(self, artifact_key: str) -> dict[str, Path]:
        key = self._safe_name(artifact_key)
        return {
            "interlinear": Path("Interlinear") / f"{key}.txt",
            "char_stats": Path("Interlinear") / f"{key}.char-stats.json",
            "lightweight_result": Path("lightweight") / f"{key}.json",
            "token_stats": Path("lightweight") / f"{key}.token-stats.json",
        }

    def _write_snapshot_interlinear_and_lightweight(
        self,
        source_id: str,
        snapshot_entry: dict[str, Any],
    ) -> dict[str, str]:
        snapshot_path = Path(str(snapshot_entry.get("snapshot_path") or "").strip())
        if not snapshot_path.exists() or not snapshot_path.is_file():
            return {}

        raw_text = self._read_local_text(snapshot_path)
        sentence_lines = self._split_chunk_sentences(raw_text)
        interlinear_lines = sentence_lines if sentence_lines else ([raw_text.strip()] if raw_text.strip() else [])

        artifact_key = self._build_interlinear_artifact_key(source_id, snapshot_entry)
        relative_paths = self._build_interlinear_relative_paths(artifact_key)
        interlinear_path = self.root_dir / relative_paths["interlinear"]
        char_stats_path = self.root_dir / relative_paths["char_stats"]
        lightweight_result_path = self.root_dir / relative_paths["lightweight_result"]
        token_stats_path = self.root_dir / relative_paths["token_stats"]

        interlinear_path.parent.mkdir(parents=True, exist_ok=True)
        lightweight_result_path.parent.mkdir(parents=True, exist_ok=True)

        interlinear_path.write_text("\n".join(interlinear_lines), encoding="utf-8")
        persisted_lines = [line for line in interlinear_path.read_text(encoding="utf-8").splitlines()]
        if not persisted_lines and interlinear_lines:
            persisted_lines = list(interlinear_lines)

        char_stats: list[dict[str, Any]] = []
        lightweight_result: list[dict[str, Any]] = []
        token_stats: list[dict[str, Any]] = []
        for line_no, line_text in enumerate(persisted_lines, start=1):
            char_count = self._count_interlinear_line_chars(line_text)
            tokens = self._tokenize_lightweight_text(line_text, exclude_stop_words=False)
            token_count = len(tokens)
            char_stats.append({"line_no": line_no, "char_count": char_count})
            lightweight_result.append(
                {
                    "line_no": line_no,
                    "text": line_text,
                    "tokens": tokens,
                    "token_count": token_count,
                    "score": token_count,
                },
            )
            token_stats.append({"line_no": line_no, "token_count": token_count})

        char_stats_path.write_text(
            json.dumps(char_stats, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        lightweight_result_path.write_text(
            json.dumps(lightweight_result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        token_stats_path.write_text(
            json.dumps(token_stats, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        return {
            "interlinear_path": relative_paths["interlinear"].as_posix(),
            "interlinear_char_stats_path": relative_paths["char_stats"].as_posix(),
            "lightweight_path": relative_paths["lightweight_result"].as_posix(),
            "lightweight_token_stats_path": relative_paths["token_stats"].as_posix(),
        }

    def _materialize_interlinear_and_lightweight_for_source(
        self,
        source_id: str,
        snapshots: list[dict[str, str]],
    ) -> None:
        previous_interlinear = self._load_source_interlinear_manifest(source_id)
        previous_interlinear_paths = {a.get("path") for a in previous_interlinear.get("artifacts", []) if a.get("path")}
        previous_lightweight_paths = self._load_source_lightweight_manifest(source_id)

        current_interlinear_paths: set[str] = set()
        current_lightweight_paths: set[str] = set()
        metadata_rows: list[dict[str, str]] = []
        artifacts: list[dict] = []

        for snapshot_entry in snapshots:
            generated = self._write_snapshot_interlinear_and_lightweight(source_id, snapshot_entry)
            if not generated:
                continue
            interlinear_path = str(generated.get("interlinear_path") or "").strip()
            interlinear_char_stats_path = str(generated.get("interlinear_char_stats_path") or "").strip()
            lightweight_path = str(generated.get("lightweight_path") or "").strip()
            lightweight_token_stats_path = str(generated.get("lightweight_token_stats_path") or "").strip()

            for path_value in (interlinear_path, interlinear_char_stats_path):
                if path_value:
                    current_interlinear_paths.add(path_value)
            for path_value in (lightweight_path, lightweight_token_stats_path):
                if path_value:
                    current_lightweight_paths.add(path_value)

            # 读取行级统计
            char_stats = []
            token_stats = []
            if interlinear_char_stats_path:
                char_stats_path = self.root_dir / interlinear_char_stats_path
                if char_stats_path.exists():
                    try:
                        char_stats = json.loads(char_stats_path.read_text(encoding="utf-8"))
                    except Exception:
                        char_stats = []
            if lightweight_token_stats_path:
                token_stats_path = self.root_dir / lightweight_token_stats_path
                if token_stats_path.exists():
                    try:
                        token_stats = json.loads(token_stats_path.read_text(encoding="utf-8"))
                    except Exception:
                        token_stats = []

            # 合并行级统计
            line_stats = {}
            for row in char_stats:
                if "line_no" in row:
                    line_stats[row["line_no"]] = {"char_count": row.get("char_count", 0)}
            for row in token_stats:
                if "line_no" in row:
                    if row["line_no"] not in line_stats:
                        line_stats[row["line_no"]] = {}
                    line_stats[row["line_no"]]["token_count"] = row.get("token_count", 0)

            # 生成 artifacts（每行为一个 artifact）
            for line_no, stats in line_stats.items():
                artifacts.append({
                    "path": interlinear_path,
                    "document_path": str(snapshot_entry.get("document_path") or "").strip(),
                    "title": str(snapshot_entry.get("title") or "").strip(),
                    "snapshot_path": str(snapshot_entry.get("snapshot_path") or "").strip(),
                    "snapshot_relative_path": str(snapshot_entry.get("snapshot_relative_path") or "").strip(),
                    "line_no": line_no,
                    "char_count": stats.get("char_count", 0),
                    "token_count": stats.get("token_count", 0),
                    "updated_at": datetime.now(UTC).isoformat(),
                })

            metadata_rows.append(
                {
                    "document_path": str(snapshot_entry.get("document_path") or "").strip(),
                    "snapshot_path": str(snapshot_entry.get("snapshot_path") or "").strip(),
                    "snapshot_relative_path": str(snapshot_entry.get("snapshot_relative_path") or "").strip(),
                    "interlinear_path": interlinear_path,
                    "interlinear_char_stats_path": interlinear_char_stats_path,
                    "lightweight_path": lightweight_path,
                    "lightweight_token_stats_path": lightweight_token_stats_path,
                },
            )

        for interlinear_path in previous_interlinear_paths - current_interlinear_paths:
            self._delete_interlinear_path(interlinear_path)
        for lightweight_path in previous_lightweight_paths - current_lightweight_paths:
            self._delete_lightweight_path(lightweight_path)

        # 写入统一 schema 的 interlinear-manifest.json
        self._write_source_interlinear_manifest(source_id, artifacts)
        self._write_source_lightweight_manifest(source_id, current_lightweight_paths)

        metadata_path = self._source_storage_path(source_id, "interlinear-lightweight-map.json")
        metadata_path.parent.mkdir(parents=True, exist_ok=True)
        metadata_path.write_text(
            json.dumps(
                {
                    "source_id": source_id,
                    "generated_at": datetime.now(UTC).isoformat(),
                    "files": metadata_rows,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    def _load_source_interlinear_lightweight_map_rows(self, source_id: str) -> list[dict[str, str]]:
        metadata_path = self._source_storage_path(source_id, "interlinear-lightweight-map.json")
        if not metadata_path.exists() or not metadata_path.is_file():
            return []
        try:
            payload = json.loads(metadata_path.read_text(encoding="utf-8"))
        except Exception:
            return []
        if not isinstance(payload, dict):
            return []
        rows = payload.get("files")
        if not isinstance(rows, list):
            return []
        normalized: list[dict[str, str]] = []
        for item in rows:
            if not isinstance(item, dict):
                continue
            normalized.append(
                {
                    "document_path": str(item.get("document_path") or "").strip(),
                    "snapshot_path": str(item.get("snapshot_path") or "").strip(),
                    "snapshot_relative_path": str(item.get("snapshot_relative_path") or "").strip(),
                    "interlinear_path": str(item.get("interlinear_path") or "").strip(),
                }
            )
        return normalized

    def _resolve_chunk_interlinear_path(
        self,
        chunk: dict[str, Any],
        map_rows: list[dict[str, str]],
    ) -> str:
        chunk_document_path = str(chunk.get("document_path") or "").strip()
        chunk_snapshot_path = str(chunk.get("snapshot_path") or "").strip()
        chunk_snapshot_relative_path = str(chunk.get("snapshot_relative_path") or "").strip()

        def _match(row: dict[str, str]) -> bool:
            if not isinstance(row, dict):
                return False
            row_document_path = str(row.get("document_path") or "").strip()
            row_snapshot_path = str(row.get("snapshot_path") or "").strip()
            row_snapshot_relative_path = str(row.get("snapshot_relative_path") or "").strip()
            same_document = bool(chunk_document_path and row_document_path and chunk_document_path == row_document_path)
            same_snapshot_relative = bool(
                chunk_snapshot_relative_path
                and row_snapshot_relative_path
                and chunk_snapshot_relative_path == row_snapshot_relative_path
            )
            same_snapshot_path = bool(chunk_snapshot_path and row_snapshot_path and chunk_snapshot_path == row_snapshot_path)
            if same_document and (same_snapshot_relative or same_snapshot_path):
                return True
            if same_document:
                return True
            return same_snapshot_relative or same_snapshot_path

        for row in map_rows:
            if not _match(row):
                continue
            interlinear_path = str(row.get("interlinear_path") or "").strip()
            if interlinear_path:
                return interlinear_path
        return ""

    def _resolve_chunk_ner_input_text(
        self,
        chunk: dict[str, Any],
        *,
        map_rows: list[dict[str, str]],
    ) -> tuple[str, str, str, str]:
        """Resolve NER input text from Interlinear artifacts first, then fallback to chunk text."""
        chunk_text = self._read_chunk_text(chunk)
        interlinear_path = self._resolve_chunk_interlinear_path(chunk, map_rows)
        if not interlinear_path:
            return chunk_text, chunk_text, "", "chunk_fallback"

        try:
            interlinear_text = (self.root_dir / interlinear_path).read_text(encoding="utf-8")
        except FileNotFoundError:
            return chunk_text, chunk_text, interlinear_path, "chunk_fallback"

        normalized_chunk = str(chunk_text or "").strip()
        normalized_interlinear = str(interlinear_text or "").strip()
        if not normalized_chunk:
            return normalized_interlinear, normalized_interlinear, interlinear_path, "interlinear_full"

        interlinear_line_set = {
            line.strip()
            for line in normalized_interlinear.splitlines()
            if line.strip()
        }
        chunk_lines = [line.strip() for line in normalized_chunk.splitlines() if line.strip()]
        if chunk_lines and interlinear_line_set and all(line in interlinear_line_set for line in chunk_lines):
            aligned_text = "\n".join(chunk_lines)
            return aligned_text, normalized_interlinear, interlinear_path, "interlinear_aligned_chunk"

        if normalized_chunk in normalized_interlinear:
            return normalized_chunk, normalized_interlinear, interlinear_path, "interlinear_substring_chunk"
        return normalized_chunk, normalized_interlinear, interlinear_path, "chunk_fallback"

    @staticmethod
    def _group_chunks_for_ner(chunks: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
        grouped: dict[str, list[dict[str, Any]]] = {}
        order: list[str] = []
        for chunk in chunks:
            snapshot_relative_path = str(chunk.get("snapshot_relative_path") or "").strip()
            document_path = str(chunk.get("document_path") or "").strip()
            chunk_path = str(chunk.get("chunk_path") or "").strip()
            chunk_id = str(chunk.get("chunk_id") or "").strip()
            group_key = snapshot_relative_path or document_path or chunk_path or chunk_id
            if group_key not in grouped:
                grouped[group_key] = []
                order.append(group_key)
            grouped[group_key].append(chunk)
        return [grouped[key] for key in order]

    def _resolve_document_ner_input_text(
        self,
        chunks: list[dict[str, Any]],
        *,
        map_rows: list[dict[str, str]],
    ) -> tuple[str, str, str, str]:
        interlinear_path = ""
        for chunk in chunks:
            interlinear_path = self._resolve_chunk_interlinear_path(chunk, map_rows)
            if interlinear_path:
                break

        if interlinear_path:
            try:
                interlinear_text = (self.root_dir / interlinear_path).read_text(encoding="utf-8")
                normalized_interlinear = str(interlinear_text or "").strip()
                if normalized_interlinear:
                    return (
                        normalized_interlinear,
                        normalized_interlinear,
                        interlinear_path,
                        "interlinear_full_document",
                    )
            except FileNotFoundError:
                pass

        merged_lines: list[str] = []
        for chunk in chunks:
            text = str(self._read_chunk_text(chunk) or "").strip()
            if not text:
                continue
            merged_lines.extend([line for line in text.splitlines() if line.strip()])
        merged_text = "\n".join(merged_lines)
        return merged_text, merged_text, interlinear_path, "document_chunk_merge_fallback"

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

    def _delete_cor_path(self, relative_path: str | Path | None) -> None:
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
        while current != self.cor_dir and current.exists():
            try:
                current.rmdir()
            except OSError:
                break
            current = current.parent

    def _delete_syntax_path(self, relative_path: str | Path | None) -> None:
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
        while current != self.syntax_dir and current.exists():
            try:
                current.rmdir()
            except OSError:
                break
            current = current.parent

    def _delete_interlinear_path(self, relative_path: str | Path | None) -> None:
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
        while current != self.interlinear_dir and current.exists():
            try:
                current.rmdir()
            except OSError:
                break
            current = current.parent

    def _delete_lightweight_path(self, relative_path: str | Path | None) -> None:
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
        while current != self.lightweight_dir and current.exists():
            try:
                current.rmdir()
            except OSError:
                break
            current = current.parent

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

    def _read_artifact_text(self, chunk: dict[str, Any], path_key: str) -> str:
        path_text = str(chunk.get(path_key) or "").strip()
        if not path_text:
            return ""
        try:
            return (self.root_dir / path_text).read_text(encoding="utf-8")
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
        basename = self._safe_name(normalized_doc_path.name or "knowledge")
        chunk_id = str(chunk.get("chunk_id") or "")
        try:
            chunk_index = int(chunk_id.rsplit("::", 1)[-1])
        except (TypeError, ValueError):
            chunk_index = 0
        target = self.chunks_dir
        if str(parent) not in {"", "."}:
            target = target / parent
        return target.relative_to(self.root_dir) / f"{basename}.{chunk_index}.txt"

    def _build_cor_relative_path(self, chunk_relative_path: str) -> Path:
        chunk_path = Path(str(chunk_relative_path or "").strip())
        if not chunk_path.parts:
            return self.cor_dir.relative_to(self.root_dir) / "knowledge.cor.txt"
        relative_parts = chunk_path.parts[1:] if chunk_path.parts[0] == self.chunks_dir.name else chunk_path.parts
        basename = chunk_path.name
        if basename.endswith(".txt"):
            basename = f"{basename[:-4]}.cor.txt"
        else:
            basename = f"{basename}.cor.txt"
        target = self.cor_dir.joinpath(*relative_parts[:-1], basename)
        return target.relative_to(self.root_dir)

    def _build_cor_structured_relative_path(self, chunk_relative_path: str) -> Path:
        cor_path = self._build_cor_relative_path(chunk_relative_path)
        base = cor_path.name[:-4] if cor_path.name.endswith(".txt") else cor_path.name
        return cor_path.with_name(f"{base}.json")

    def _build_cor_annotated_relative_path(self, chunk_relative_path: str) -> Path:
        cor_path = self._build_cor_relative_path(chunk_relative_path)
        base = cor_path.name[:-4] if cor_path.name.endswith(".txt") else cor_path.name
        return cor_path.with_name(f"{base}.annotated.md")

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

    def _build_ner_structured_relative_path(self, chunk_relative_path: str) -> Path:
        ner_path = self._build_ner_relative_path(chunk_relative_path)
        base = ner_path.name[:-4] if ner_path.name.endswith(".txt") else ner_path.name
        return ner_path.with_name(f"{base}.json")

    def _build_ner_annotated_relative_path(self, chunk_relative_path: str) -> Path:
        ner_path = self._build_ner_relative_path(chunk_relative_path)
        base = ner_path.name[:-4] if ner_path.name.endswith(".txt") else ner_path.name
        return ner_path.with_name(f"{base}.annotated.md")

    def _build_ner_stats_relative_path(self, chunk_relative_path: str) -> Path:
        ner_path = self._build_ner_relative_path(chunk_relative_path)
        base = ner_path.name[:-4] if ner_path.name.endswith(".txt") else ner_path.name
        return ner_path.with_name(f"{base}.stats.json")

    def _build_syntax_relative_path(self, chunk_relative_path: str) -> Path:
        chunk_path = Path(str(chunk_relative_path or "").strip())
        if not chunk_path.parts:
            return self.syntax_dir.relative_to(self.root_dir) / "knowledge.syntax.txt"
        relative_parts = chunk_path.parts[1:] if chunk_path.parts[0] == self.chunks_dir.name else chunk_path.parts
        basename = chunk_path.name
        if basename.endswith(".txt"):
            basename = f"{basename[:-4]}.syntax.txt"
        else:
            basename = f"{basename}.syntax.txt"
        target = self.syntax_dir.joinpath(*relative_parts[:-1], basename)
        return target.relative_to(self.root_dir)

    def _build_syntax_structured_relative_path(self, chunk_relative_path: str) -> Path:
        syntax_path = self._build_syntax_relative_path(chunk_relative_path)
        base = syntax_path.name[:-4] if syntax_path.name.endswith(".txt") else syntax_path.name
        return syntax_path.with_name(f"{base}.json")

    def _build_syntax_annotated_relative_path(self, chunk_relative_path: str) -> Path:
        syntax_path = self._build_syntax_relative_path(chunk_relative_path)
        base = syntax_path.name[:-4] if syntax_path.name.endswith(".txt") else syntax_path.name
        return syntax_path.with_name(f"{base}.annotated.md")

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

    @staticmethod
    def _token_offsets_from_text(text: str, tokens: list[str]) -> list[tuple[int, int]]:
        source_text = str(text or "")
        offsets: list[tuple[int, int]] = []
        cursor = 0
        for token in tokens:
            token_text = str(token or "")
            if not token_text:
                offsets.append((cursor, cursor))
                continue
            start = source_text.find(token_text, cursor)
            if start < 0:
                start = source_text.find(token_text)
            if start < 0:
                start = cursor
            end = max(start, 0) + len(token_text)
            offsets.append((max(start, 0), end))
            cursor = max(cursor, end)
        return offsets

    def _normalize_hanlp_coref_payload(
        self,
        raw_result: Any,
    ) -> tuple[list[str], list[dict[str, Any]]]:
        tokens: list[str] = []
        raw_clusters: Any = []
        if isinstance(raw_result, dict):
            raw_tokens = raw_result.get("tokens")
            if isinstance(raw_tokens, list):
                tokens = [str(item or "") for item in raw_tokens]
            raw_clusters = raw_result.get("clusters") or []
        elif isinstance(raw_result, list):
            raw_clusters = raw_result

        clusters: list[dict[str, Any]] = []
        if not isinstance(raw_clusters, list):
            return tokens, clusters

        for cluster_index, raw_cluster in enumerate(raw_clusters, start=1):
            if not isinstance(raw_cluster, list):
                continue
            mentions: list[dict[str, Any]] = []
            for mention_index, raw_mention in enumerate(raw_cluster, start=1):
                if not isinstance(raw_mention, (list, tuple)) or len(raw_mention) < 3:
                    continue
                surface = str(raw_mention[0] or "").strip()
                try:
                    token_start = int(raw_mention[1] or 0)
                    token_end = int(raw_mention[2] or 0)
                except (TypeError, ValueError):
                    continue
                if not surface or token_start < 0 or token_end <= token_start:
                    continue
                mentions.append(
                    {
                        "mention_id": f"c{cluster_index}_m{mention_index}",
                        "surface": surface,
                        "token_start": token_start,
                        "token_end": token_end,
                    }
                )
            if not mentions:
                continue
            mentions.sort(key=lambda item: (int(item["token_start"]), int(item["token_end"])))
            canonical = max(
                mentions,
                key=lambda item: (
                    len(str(item.get("surface") or "")),
                    -int(item.get("token_start") or 0),
                ),
            )
            clusters.append(
                {
                    "cluster_id": f"c{cluster_index}",
                    "canonical_mention": canonical,
                    "mentions": mentions,
                }
            )
        return tokens, clusters

    def _resolve_text_from_coref(
        self,
        text: str,
        tokens: list[str],
        clusters: list[dict[str, Any]],
    ) -> tuple[str, list[str], list[dict[str, Any]]]:
        source_text = str(text or "")
        if not source_text or not tokens or not clusters:
            return source_text, list(tokens), []

        offsets = self._token_offsets_from_text(source_text, tokens)
        replacements: list[dict[str, Any]] = []
        for cluster in clusters:
            canonical = cluster.get("canonical_mention") if isinstance(cluster, dict) else None
            if not isinstance(canonical, dict):
                continue
            canonical_surface = str(canonical.get("surface") or "").strip()
            canonical_id = str(canonical.get("mention_id") or "")
            if not canonical_surface:
                continue
            for mention in cluster.get("mentions") or []:
                if not isinstance(mention, dict):
                    continue
                if str(mention.get("mention_id") or "") == canonical_id:
                    continue
                token_start = int(mention.get("token_start") or 0)
                token_end = int(mention.get("token_end") or 0)
                if token_start < 0 or token_end <= token_start or token_end > len(offsets):
                    continue
                char_start = int(offsets[token_start][0])
                char_end = int(offsets[token_end - 1][1])
                if char_end <= char_start:
                    continue
                replacements.append(
                    {
                        "cluster_id": str(cluster.get("cluster_id") or ""),
                        "mention_id": str(mention.get("mention_id") or ""),
                        "canonical_mention_id": canonical_id,
                        "token_start": token_start,
                        "token_end": token_end,
                        "start": char_start,
                        "end": char_end,
                        "source_surface": source_text[char_start:char_end],
                        "replacement_surface": canonical_surface,
                    }
                )

        if not replacements:
            return source_text, list(tokens), []

        replacements.sort(key=lambda item: (int(item["start"]), int(item["end"])))
        filtered: list[dict[str, Any]] = []
        last_end = -1
        for item in replacements:
            start = int(item["start"])
            end = int(item["end"])
            if start < last_end:
                continue
            filtered.append(item)
            last_end = end

        resolved_text = source_text
        for item in reversed(filtered):
            start = int(item["start"])
            end = int(item["end"])
            resolved_text = (
                resolved_text[:start]
                + str(item.get("replacement_surface") or "")
                + resolved_text[end:]
            )
        resolved_tokens = [match.group(0) for match in _LIGHTWEIGHT_TOKEN_RE.finditer(resolved_text)]
        return resolved_text, resolved_tokens, filtered

    def _render_chunk_cor_structured_payload(
        self,
        chunk: dict[str, Any],
        *,
        text: str,
        raw_result: Any,
        interlinear_path: str = "",
        cor_input_mode: str = "chunk_fallback",
    ) -> dict[str, Any]:
        tokens, clusters = self._normalize_hanlp_coref_payload(raw_result)
        resolved_text, resolved_tokens, replacements = self._resolve_text_from_coref(text, tokens, clusters)
        resolution_mode = "hanlp_cor" if replacements else "identity_fallback"
        return {
            "artifact": "cor_structured",
            "format_version": _COR_FORMAT_VERSION,
            "document_path": str(chunk.get("document_path") or ""),
            "document_title": str(chunk.get("document_title") or ""),
            "chunk_id": str(chunk.get("chunk_id") or ""),
            "chunk_path": str(chunk.get("chunk_path") or ""),
            "version_id": self._chunk_version_id(chunk),
            "snapshot_at": str(chunk.get("snapshot_at") or ""),
            "source_text": str(text or ""),
            "resolved_text": resolved_text,
            "interlinear_path": str(interlinear_path or ""),
            "cor_input_mode": str(cor_input_mode or "chunk_fallback"),
            "tokens": tokens,
            "resolved_tokens": resolved_tokens,
            "clusters": clusters,
            "replacements": replacements,
            "cluster_count": len(clusters),
            "replacement_count": len(replacements),
            "resolution_mode": resolution_mode,
        }

    def _render_chunk_cor_text(
        self,
        chunk: dict[str, Any],
        structured_payload: dict[str, Any],
    ) -> str:
        lines = [
            f"document_path={chunk.get('document_path') or ''}",
            f"chunk_id={chunk.get('chunk_id') or ''}",
            f"version_id={self._chunk_version_id(chunk)}",
            f"resolution_mode={structured_payload.get('resolution_mode') or 'identity_fallback'}",
            f"cluster_count={_safe_count_int(structured_payload.get('cluster_count') or 0)}",
            f"replacement_count={_safe_count_int(structured_payload.get('replacement_count') or 0)}",
            "",
            "[Original Text]",
            str(structured_payload.get("source_text") or ""),
            "",
            "[Resolved Text]",
            str(structured_payload.get("resolved_text") or ""),
        ]
        return "\n".join(lines)

    def _render_chunk_cor_annotated_markdown(
        self,
        chunk: dict[str, Any],
        structured_payload: dict[str, Any],
    ) -> str:
        lines = [
            "---",
            "artifact: cor_annotated",
            f"format_version: {_COR_FORMAT_VERSION}",
            f"document_path: {json.dumps(str(chunk.get('document_path') or ''), ensure_ascii=False)}",
            f"chunk_id: {json.dumps(str(chunk.get('chunk_id') or ''), ensure_ascii=False)}",
            f"version_id: {json.dumps(self._chunk_version_id(chunk), ensure_ascii=False)}",
            f"snapshot_at: {json.dumps(str(chunk.get('snapshot_at') or ''), ensure_ascii=False)}",
            f"cluster_count: {_safe_count_int(structured_payload.get('cluster_count') or 0)}",
            f"replacement_count: {_safe_count_int(structured_payload.get('replacement_count') or 0)}",
            f"structured_ref: {json.dumps(str(chunk.get('cor_structured_path') or ''), ensure_ascii=False)}",
            "---",
            "",
            "# Coreference Annotated",
            "",
            "## Original Text",
            "",
            str(structured_payload.get("source_text") or ""),
            "",
            "## Resolved Text",
            "",
            str(structured_payload.get("resolved_text") or ""),
            "",
            "## Replacement Index",
            "",
            "| cluster | mention | canonical | source | replacement | start | end |",
            "| --- | --- | --- | --- | --- | ---: | ---: |",
        ]
        for item in structured_payload.get("replacements") or []:
            if not isinstance(item, dict):
                continue
            source_surface = str(item.get("source_surface") or "").replace("|", "\\|")
            replacement_surface = str(item.get("replacement_surface") or "").replace("|", "\\|")
            lines.append(
                "| "
                f"{item.get('cluster_id') or ''} | {item.get('mention_id') or ''} | {item.get('canonical_mention_id') or ''} | "
                f"{source_surface} | {replacement_surface} | {item.get('start') or 0} | {item.get('end') or 0} |"
            )
        return "\n".join(lines)

    def _load_chunk_cor_structured(self, chunk: dict[str, Any]) -> dict[str, Any] | None:
        raw = self._read_artifact_text(chunk, "cor_structured_path")
        if not raw.strip():
            return None
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return None
        return payload if isinstance(payload, dict) else None

    def _resolve_chunk_text_via_cor(self, chunk: dict[str, Any]) -> tuple[str, str, str, str]:
        original_text = self._read_chunk_text(chunk)
        cor_payload = self._load_chunk_cor_structured(chunk)
        if not cor_payload:
            return original_text, "", "identity_fallback", original_text
        resolved_text = str(cor_payload.get("resolved_text") or "")
        if not resolved_text:
            resolved_text = original_text
        cor_path = str(chunk.get("cor_structured_path") or "")
        resolution_mode = str(cor_payload.get("resolution_mode") or "identity_fallback")
        source_text = str(cor_payload.get("source_text") or original_text)
        return resolved_text, cor_path, resolution_mode, source_text

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

    @staticmethod
    def _sentence_index_for_offset(text: str, start: int) -> int:
        return 1 + sum(1 for char in str(text or "")[:max(0, start)] if char in _NER_SENTENCE_DELIMITERS)

    def _normalize_hanlp_ner_mentions(
        self,
        text: str,
        raw_result: Any,
    ) -> list[dict[str, Any]]:
        source_text = str(text or "")
        if not source_text or not isinstance(raw_result, list):
            return []

        mentions: list[dict[str, Any]] = []
        search_cursor = 0
        for item in raw_result:
            surface = ""
            label = "entity"
            start = -1
            end = -1
            confidence = 1.0

            if isinstance(item, dict):
                surface = str(item.get("text") or item.get("surface") or item.get("word") or "").strip()
                label = str(item.get("label") or item.get("type") or item.get("tag") or "entity").strip() or "entity"
                span = item.get("span")
                if isinstance(span, (list, tuple)) and len(span) >= 2:
                    start = int(span[0] or 0)
                    end = int(span[1] or 0)
                else:
                    start = int(item.get("start") or -1)
                    end = int(item.get("end") or -1)
                confidence = float(item.get("confidence") or item.get("score") or 1.0)
            elif isinstance(item, (list, tuple)):
                if len(item) >= 2:
                    surface = str(item[0] or "").strip()
                    label = str(item[1] or "entity").strip() or "entity"
                if len(item) >= 4:
                    start = int(item[2] or -1)
                    end = int(item[3] or -1)
            else:
                continue

            if not surface:
                continue
            if start < 0 or end <= start:
                found = source_text.find(surface, search_cursor)
                if found < 0:
                    found = source_text.find(surface)
                if found < 0:
                    continue
                start = found
                end = found + len(surface)
                search_cursor = end
            else:
                search_cursor = max(search_cursor, end)

            mentions.append(
                {
                    "surface": source_text[start:end],
                    "normalized": surface.lower(),
                    "label": label,
                    "start": start,
                    "end": end,
                    "confidence": confidence,
                    "sentence_index": self._sentence_index_for_offset(source_text, start),
                }
            )

        mentions.sort(key=lambda item: (int(item["start"]), int(item["end"])))
        for index, mention in enumerate(mentions, start=1):
            mention["entity_id"] = f"e{index}"
        return mentions

    def _collect_chunk_ner_mentions_with_fallback(
        self,
        text: str,
        *,
        config: KnowledgeConfig,
    ) -> list[dict[str, Any]]:
        raw_result, state = self._semantic_runtime.run_task("ner_msra", text, config)
        self._remember_semantic_engine_state(state)
        if state.get("status") == "ready":
            mentions = self._normalize_hanlp_ner_mentions(text, raw_result)
            if mentions:
                return mentions

        entities = self._collect_chunk_ner_entities(text, config=config)
        return self._build_chunk_ner_mentions(text, entities)

    @staticmethod
    def _build_chunk_ner_catalog(mentions: list[dict[str, Any]]) -> list[dict[str, Any]]:
        grouped: dict[tuple[str, str], dict[str, Any]] = {}
        for mention in mentions:
            normalized = str(mention.get("normalized") or "").strip()
            label = str(mention.get("label") or "entity").strip() or "entity"
            if not normalized:
                continue
            key = (normalized, label)
            entry = grouped.setdefault(
                key,
                {
                    "normalized": normalized,
                    "label": label,
                    "mention_count": 0,
                },
            )
            entry["mention_count"] += 1
        return sorted(grouped.values(), key=lambda item: (str(item["label"]), str(item["normalized"])))

    def _build_chunk_ner_mentions(
        self,
        text: str,
        entities: list[str],
    ) -> list[dict[str, Any]]:
        source_text = str(text or "")
        if not source_text or not entities:
            return []

        occupied: set[int] = set()
        mentions: list[dict[str, Any]] = []
        ranked_entities = sorted(
            {str(item or "").strip().lower() for item in entities if str(item or "").strip()},
            key=lambda item: (-len(item), item),
        )

        for normalized in ranked_entities:
            flags = re.IGNORECASE if re.fullmatch(r"[A-Za-z0-9_-]+", normalized) else 0
            for match in re.finditer(re.escape(normalized), source_text, flags):
                start, end = match.span()
                if start == end:
                    continue
                if any(index in occupied for index in range(start, end)):
                    continue
                occupied.update(range(start, end))
                sentence_index = 1 + sum(
                    1 for char in source_text[:start] if char in _NER_SENTENCE_DELIMITERS
                )
                mentions.append(
                    {
                        "surface": source_text[start:end],
                        "normalized": normalized,
                        "label": "semantic_token",
                        "start": start,
                        "end": end,
                        "confidence": 1.0,
                        "sentence_index": sentence_index,
                    }
                )

        mentions.sort(key=lambda item: (int(item["start"]), int(item["end"])))
        for index, mention in enumerate(mentions, start=1):
            mention["entity_id"] = f"e{index}"
        return mentions

    def _render_chunk_ner_structured_payload(
        self,
        chunk: dict[str, Any],
        *,
        source_text: str,
        input_text: str,
        interlinear_path: str,
        ner_input_mode: str,
        cor_structured_path: str,
        cor_resolution_mode: str,
        catalog: list[dict[str, Any]],
        mentions: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {
            "artifact": "ner_structured",
            "format_version": _NER_FORMAT_VERSION,
            "document_path": str(chunk.get("document_path") or ""),
            "document_title": str(chunk.get("document_title") or ""),
            "chunk_id": str(chunk.get("chunk_id") or ""),
            "chunk_path": str(chunk.get("chunk_path") or ""),
            "version_id": self._chunk_version_id(chunk),
            "snapshot_at": str(chunk.get("snapshot_at") or ""),
            "source_text": str(source_text or ""),
            "input_text": str(input_text or ""),
            "text_length": len(str(input_text or "")),
            "interlinear_path": str(interlinear_path or ""),
            "ner_input_mode": str(ner_input_mode or "chunk_fallback"),
            "cor_structured_path": cor_structured_path,
            "cor_resolution_mode": cor_resolution_mode,
            "entity_catalog": catalog,
            "entity_mentions": mentions,
        }

    def _render_chunk_ner_annotated_text(
        self,
        text: str,
        mentions: list[dict[str, Any]],
    ) -> str:
        if not mentions:
            return str(text or "")

        parts: list[str] = []
        cursor = 0
        for mention in mentions:
            start = int(mention.get("start") or 0)
            end = int(mention.get("end") or 0)
            if start < cursor or end <= start:
                continue
            parts.append(text[cursor:start])
            surface = str(mention.get("surface") or text[start:end])
            parts.append(
                "[["
                f"{surface}|label={mention.get('label') or 'semantic_token'}"
                f"|id={mention.get('entity_id') or ''}"
                f"|norm={mention.get('normalized') or ''}"
                f"|score={float(mention.get('confidence') or 0.0):.2f}"
                "]]"
            )
            cursor = end
        parts.append(text[cursor:])
        return "".join(parts)

    def _render_chunk_ner_annotated_markdown(
        self,
        chunk: dict[str, Any],
        *,
        text: str,
        mentions: list[dict[str, Any]],
        structured_relative_path: Path,
    ) -> str:
        annotated_text = self._render_chunk_ner_annotated_text(text, mentions)
        lines = [
            "---",
            "artifact: ner_annotated",
            f"format_version: {_NER_FORMAT_VERSION}",
            f"document_path: {json.dumps(str(chunk.get('document_path') or ''), ensure_ascii=False)}",
            f"chunk_id: {json.dumps(str(chunk.get('chunk_id') or ''), ensure_ascii=False)}",
            f"version_id: {json.dumps(self._chunk_version_id(chunk), ensure_ascii=False)}",
            f"snapshot_at: {json.dumps(str(chunk.get('snapshot_at') or ''), ensure_ascii=False)}",
            f"entity_count: {len(mentions)}",
            f"structured_ref: {json.dumps(structured_relative_path.as_posix(), ensure_ascii=False)}",
            "---",
            "",
            "# NER Annotated",
            "",
            annotated_text,
            "",
            "## Entity Index",
            "",
            "| id | surface | label | start | end |",
            "| --- | --- | --- | ---: | ---: |",
        ]
        for mention in mentions:
            surface = str(mention.get("surface") or "").replace("|", "\\|")
            normalized = str(mention.get("normalized") or "").replace("|", "\\|")
            lines.append(
                "| "
                f"{mention.get('entity_id') or ''} | {surface} | {mention.get('label') or 'semantic_token'} | {mention.get('start') or 0} | {mention.get('end') or 0} |"
            )
        return "\n".join(lines)

    def _split_chunk_sentence_spans(self, text: str) -> list[dict[str, Any]]:
        normalized = str(text or "")
        if not normalized:
            return []
        sentences: list[dict[str, Any]] = []
        start = 0
        for index, char in enumerate(normalized):
            if char not in _NER_SENTENCE_DELIMITERS:
                continue
            end = index + 1
            sentence_text = normalized[start:end]
            if sentence_text.strip():
                sentences.append({"text": sentence_text, "start": start, "end": end})
            start = end
        if start < len(normalized):
            sentence_text = normalized[start:]
            if sentence_text.strip():
                sentences.append({"text": sentence_text, "start": start, "end": len(normalized)})
        return sentences

    def _load_chunk_ner_mentions(self, chunk: dict[str, Any]) -> list[dict[str, Any]]:
        raw = self._read_artifact_text(chunk, "ner_structured_path")
        if not raw.strip():
            return []
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return []
        mentions = payload.get("entity_mentions")
        if not isinstance(mentions, list):
            return []
        return [item for item in mentions if isinstance(item, dict)]

    def _build_chunk_syntax_sentences(
        self,
        text: str,
        mentions: list[dict[str, Any]],
        *,
        config: KnowledgeConfig | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        sentences = self._split_chunk_sentence_spans(text)
        syntax_sentences: list[dict[str, Any]] = []
        total_tokens = 0
        for sentence_index, sentence in enumerate(sentences, start=1):
            sentence_text = str(sentence.get("text") or "")
            sentence_start = int(sentence.get("start") or 0)
            sentence_end = int(sentence.get("end") or sentence_start)
            tokens: list[dict[str, Any]] = []
            for token_index, match in enumerate(_LIGHTWEIGHT_TOKEN_RE.finditer(sentence_text), start=1):
                token_start = sentence_start + match.start()
                token_end = sentence_start + match.end()
                tokens.append(
                    {
                        "token_index": token_index,
                        "text": match.group(0),
                        "start": token_start,
                        "end": token_end,
                    }
                )
            total_tokens += len(tokens)

            sentence_entities: list[dict[str, Any]] = []
            for mention in mentions:
                mention_start = int(mention.get("start") or 0)
                mention_end = int(mention.get("end") or 0)
                if mention_start < sentence_start or mention_end > sentence_end:
                    continue
                overlapping_tokens = [
                    token for token in tokens
                    if int(token.get("start") or 0) < mention_end
                    and int(token.get("end") or 0) > mention_start
                ]
                sentence_entities.append(
                    {
                        "entity_id": str(mention.get("entity_id") or ""),
                        "surface": str(mention.get("surface") or ""),
                        "label": str(mention.get("label") or "semantic_token"),
                        "normalized": str(mention.get("normalized") or ""),
                        "start": mention_start,
                        "end": mention_end,
                        "token_start": int(overlapping_tokens[0].get("token_index") or 0) if overlapping_tokens else 0,
                        "token_end": int(overlapping_tokens[-1].get("token_index") or 0) if overlapping_tokens else 0,
                    }
                )

            syntax_tasks: list[dict[str, Any]] = []
            dependencies: list[dict[str, Any]] = []
            constituency: dict[str, Any] | None = None
            if config is not None and sentence_text.strip():
                syntax_tasks, dependencies, constituency = self._collect_sentence_syntax_tasks(
                    sentence_text,
                    sentence_start=sentence_start,
                    tokens=tokens,
                    config=config,
                )

            parse_mode = "nlp_task_matrix" if syntax_tasks else "tokenized_only"
            parse_confidence = 1.0 if syntax_tasks else 0.0

            syntax_sentences.append(
                {
                    "sentence_index": sentence_index,
                    "sentence_text": sentence_text,
                    "start": sentence_start,
                    "end": sentence_end,
                    "tokens": tokens,
                    "dependencies": dependencies,
                    "entities": sentence_entities,
                    "parse_mode": parse_mode,
                    "parse_confidence": parse_confidence,
                    "syntax_tasks": syntax_tasks,
                    "constituency": constituency,
                }
            )
        return syntax_sentences, total_tokens

    def _collect_sentence_syntax_tasks(
        self,
        sentence_text: str,
        *,
        sentence_start: int,
        tokens: list[dict[str, Any]],
        config: KnowledgeConfig,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any] | None]:
        task_specs = getattr(getattr(config.nlp, "task_matrix", None), "tasks", {}) or {}
        task_order = ("dep", "sdp", "con")
        syntax_tasks: list[dict[str, Any]] = []
        dependencies: list[dict[str, Any]] = []
        constituency: dict[str, Any] | None = None

        for task_key in task_order:
            task_cfg = task_specs.get(task_key)
            if task_cfg is not None and not bool(getattr(task_cfg, "enabled", True)):
                continue
            raw_result, state = self._semantic_runtime.run_task(task_key, sentence_text, config)
            self._remember_semantic_engine_state(state)
            if state.get("status") != "ready":
                continue
            task_name = str(getattr(task_cfg, "task_name", task_key) or task_key)
            task_entry = {
                "task_key": task_key,
                "task_name": task_name,
                "result": raw_result,
            }
            syntax_tasks.append(task_entry)
            if task_key in {"dep", "sdp"}:
                dependencies.extend(
                    self._normalize_hanlp_dependencies(
                        task_key,
                        raw_result,
                        sentence_start=sentence_start,
                        tokens=tokens,
                    )
                )
            elif task_key == "con":
                constituency = self._normalize_hanlp_constituency(task_key, raw_result)

        return syntax_tasks, dependencies, constituency

    @staticmethod
    def _token_text_at(tokens: list[dict[str, Any]], token_index: int) -> str:
        if 1 <= token_index <= len(tokens):
            token = tokens[token_index - 1]
            if isinstance(token, dict):
                return str(token.get("text") or "")
        return ""

    def _normalize_hanlp_dependencies(
        self,
        task_key: str,
        raw_result: Any,
        *,
        sentence_start: int,
        tokens: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []

        if isinstance(raw_result, dict):
            heads = raw_result.get("head") or raw_result.get("heads") or raw_result.get("arcs")
            relations = raw_result.get("deprel") or raw_result.get("relations") or raw_result.get("labels")
            words = raw_result.get("tokens") or raw_result.get("tok") or []
            if isinstance(heads, list) and isinstance(relations, list):
                for dependent_index, relation in enumerate(relations, start=1):
                    head_index = int(heads[dependent_index - 1] or 0)
                    dependent = self._token_text_at(tokens, dependent_index)
                    if not dependent and isinstance(words, list) and dependent_index - 1 < len(words):
                        dependent = str(words[dependent_index - 1] or "")
                    row = self._build_dependency_row(
                        task_key,
                        dependent_index=dependent_index,
                        head_index=head_index,
                        relation=str(relation or "").strip(),
                        dependent=dependent,
                        sentence_start=sentence_start,
                        tokens=tokens,
                    )
                    if row is not None:
                        rows.append(row)
                return [row for row in rows if row]

        if isinstance(raw_result, list):
            for fallback_index, item in enumerate(raw_result, start=1):
                if isinstance(item, dict):
                    dependent_index = int(item.get("dependent_index") or item.get("id") or fallback_index)
                    head_index = int(item.get("head_index") or item.get("head") or 0)
                    relation = str(item.get("relation") or item.get("label") or item.get("deprel") or "").strip()
                    dependent = str(item.get("dependent") or item.get("form") or item.get("text") or self._token_text_at(tokens, dependent_index))
                elif isinstance(item, (list, tuple)) and len(item) >= 3:
                    if isinstance(item[0], int):
                        dependent_index = int(item[0] or fallback_index)
                        head_index = int(item[1] or 0)
                        relation = str(item[2] or "").strip()
                        dependent = self._token_text_at(tokens, dependent_index)
                    else:
                        dependent_index = fallback_index
                        dependent = str(item[0] or "")
                        head_index = int(item[1] or 0)
                        relation = str(item[2] or "").strip()
                else:
                    continue
                row = self._build_dependency_row(
                    task_key,
                    dependent_index=dependent_index,
                    head_index=head_index,
                    relation=relation,
                    dependent=dependent,
                    sentence_start=sentence_start,
                    tokens=tokens,
                )
                if row is not None:
                    rows.append(row)
        return [row for row in rows if row]

    def _build_dependency_row(
        self,
        task_key: str,
        *,
        dependent_index: int,
        head_index: int,
        relation: str,
        dependent: str,
        sentence_start: int,
        tokens: list[dict[str, Any]],
    ) -> dict[str, Any] | None:
        if dependent_index <= 0:
            return None
        token = tokens[dependent_index - 1] if 1 <= dependent_index <= len(tokens) else {}
        start = int(token.get("start") or sentence_start)
        end = int(token.get("end") or start)
        return {
            "task_key": task_key,
            "dependent_index": dependent_index,
            "head_index": head_index,
            "relation": relation,
            "dependent": dependent,
            "head": self._token_text_at(tokens, head_index) if head_index > 0 else "ROOT",
            "start": start,
            "end": end,
        }

    @staticmethod
    def _normalize_hanlp_constituency(task_key: str, raw_result: Any) -> dict[str, Any] | None:
        if raw_result is None:
            return None
        tree = raw_result
        if isinstance(raw_result, dict):
            tree = raw_result.get("tree") or raw_result.get("con") or raw_result
        return {
            "task_key": task_key,
            "tree": tree,
        }

    def _render_chunk_syntax_structured_payload(
        self,
        chunk: dict[str, Any],
        *,
        source_text: str,
        input_text: str,
        interlinear_path: str,
        syntax_input_mode: str,
        cor_structured_path: str,
        cor_resolution_mode: str,
        mentions: list[dict[str, Any]],
        config: KnowledgeConfig | None = None,
    ) -> dict[str, Any]:
        sentences, token_count = self._build_chunk_syntax_sentences(input_text, mentions, config=config)
        task_keys = sorted(
            {
                str(task.get("task_key") or "")
                for sentence in sentences
                if isinstance(sentence, dict)
                for task in (sentence.get("syntax_tasks") or [])
                if isinstance(task, dict) and str(task.get("task_key") or "")
            }
        )
        relation_count = sum(
            len([item for item in (sentence.get("dependencies") or []) if isinstance(item, dict)])
            for sentence in sentences
            if isinstance(sentence, dict)
        )
        parse_mode = "nlp_task_matrix" if task_keys else "tokenized_only"
        return {
            "artifact": "syntax_structured",
            "format_version": _SYNTAX_FORMAT_VERSION,
            "parse_mode": parse_mode,
            "document_path": str(chunk.get("document_path") or ""),
            "document_title": str(chunk.get("document_title") or ""),
            "chunk_id": str(chunk.get("chunk_id") or ""),
            "chunk_path": str(chunk.get("chunk_path") or ""),
            "version_id": self._chunk_version_id(chunk),
            "snapshot_at": str(chunk.get("snapshot_at") or ""),
            "source_text": str(source_text or ""),
            "input_text": str(input_text or ""),
            "interlinear_path": str(interlinear_path or ""),
            "syntax_input_mode": str(syntax_input_mode or "chunk_fallback"),
            "cor_structured_path": cor_structured_path,
            "cor_resolution_mode": cor_resolution_mode,
            "sentence_count": len(sentences),
            "token_count": token_count,
            "relation_count": relation_count,
            "task_keys": task_keys,
            "entity_alignment_source": str(chunk.get("ner_structured_path") or ""),
            "sentences": sentences,
        }

    def _render_chunk_syntax_text(
        self,
        chunk: dict[str, Any],
        structured_payload: dict[str, Any],
    ) -> str:
        lines = [
            f"document_path={chunk.get('document_path') or ''}",
            f"chunk_id={chunk.get('chunk_id') or ''}",
            f"version_id={self._chunk_version_id(chunk)}",
            f"parse_mode={structured_payload.get('parse_mode') or 'tokenized_only'}",
            f"sentence_count={structured_payload.get('sentence_count') or 0}",
            f"token_count={structured_payload.get('token_count') or 0}",
            f"relation_count={structured_payload.get('relation_count') or 0}",
            f"task_keys={'|'.join(structured_payload.get('task_keys') or [])}",
            f"entity_alignment_source={chunk.get('ner_structured_path') or ''}",
            f"cor_alignment_source={structured_payload.get('cor_structured_path') or ''}",
            f"cor_resolution_mode={structured_payload.get('cor_resolution_mode') or 'identity_fallback'}",
        ]
        for sentence in structured_payload.get("sentences") or []:
            if not isinstance(sentence, dict):
                continue
            lines.append("")
            lines.append(f"[Sentence {sentence.get('sentence_index') or 0}] {sentence.get('sentence_text') or ''}")
            token_labels = [
                f"{token.get('token_index') or 0}:{token.get('text') or ''}"
                for token in (sentence.get("tokens") or [])
                if isinstance(token, dict)
            ]
            entity_labels = [
                f"{entity.get('entity_id') or ''}:{entity.get('surface') or ''}@{entity.get('token_start') or 0}-{entity.get('token_end') or 0}"
                for entity in (sentence.get("entities") or [])
                if isinstance(entity, dict)
            ]
            lines.append(f"tokens={' | '.join(token_labels)}")
            lines.append(f"entities={' | '.join(entity_labels)}")
            dependency_labels = [
                f"{dep.get('task_key') or ''}:{dep.get('dependent_index') or 0}->{dep.get('head_index') or 0}:{dep.get('relation') or ''}"
                for dep in (sentence.get("dependencies") or [])
                if isinstance(dep, dict)
            ]
            if dependency_labels:
                lines.append(f"dependencies={' | '.join(dependency_labels)}")
        return "\n".join(lines)

    def _render_chunk_syntax_annotated_markdown(
        self,
        chunk: dict[str, Any],
        structured_payload: dict[str, Any],
    ) -> str:
        lines = [
            "---",
            "artifact: syntax_annotated",
            f"format_version: {_SYNTAX_FORMAT_VERSION}",
            f"document_path: {json.dumps(str(chunk.get('document_path') or ''), ensure_ascii=False)}",
            f"chunk_id: {json.dumps(str(chunk.get('chunk_id') or ''), ensure_ascii=False)}",
            f"version_id: {json.dumps(self._chunk_version_id(chunk), ensure_ascii=False)}",
            f"snapshot_at: {json.dumps(str(chunk.get('snapshot_at') or ''), ensure_ascii=False)}",
            f"sentence_count: {_safe_count_int(structured_payload.get('sentence_count') or 0)}",
            f"token_count: {_safe_count_int(structured_payload.get('token_count') or 0)}",
            f"relation_count: {_safe_count_int(structured_payload.get('relation_count') or 0)}",
            f"structured_ref: {json.dumps(str(chunk.get('syntax_structured_path') or ''), ensure_ascii=False)}",
            f"ner_structured_ref: {json.dumps(str(chunk.get('ner_structured_path') or ''), ensure_ascii=False)}",
            f"cor_structured_ref: {json.dumps(str(structured_payload.get('cor_structured_path') or ''), ensure_ascii=False)}",
            f"cor_resolution_mode: {json.dumps(str(structured_payload.get('cor_resolution_mode') or 'identity_fallback'), ensure_ascii=False)}",
            "---",
            "",
            "# Syntax Annotated",
            "",
        ]
        for sentence in structured_payload.get("sentences") or []:
            if not isinstance(sentence, dict):
                continue
            lines.extend(
                [
                    f"## Sentence {sentence.get('sentence_index') or 0}",
                    "",
                    str(sentence.get("sentence_text") or ""),
                    "",
                    "| token_index | text | start | end |",
                    "| ---: | --- | ---: | ---: |",
                ]
            )
            for token in sentence.get("tokens") or []:
                if not isinstance(token, dict):
                    continue
                token_text = str(token.get("text") or "").replace("|", "\\|")
                lines.append(
                    f"| {token.get('token_index') or 0} | {token_text} | {token.get('start') or 0} | {token.get('end') or 0} |"
                )
            lines.extend(["", "### Entity Alignment", "", "| id | surface | label | token_start | token_end |", "| --- | --- | --- | ---: | ---: |"])
            for entity in sentence.get("entities") or []:
                if not isinstance(entity, dict):
                    continue
                surface = str(entity.get("surface") or "").replace("|", "\\|")
                lines.append(
                    f"| {entity.get('entity_id') or ''} | {surface} | {entity.get('label') or 'semantic_token'} | {entity.get('token_start') or 0} | {entity.get('token_end') or 0} |"
                )
            dependencies = [item for item in (sentence.get("dependencies") or []) if isinstance(item, dict)]
            if dependencies:
                lines.extend([
                    "",
                    "### Dependencies",
                    "",
                    "| task | dependent | head | relation |",
                    "| --- | --- | --- | --- |",
                ])
                for dep in dependencies:
                    dependent = str(dep.get("dependent") or "").replace("|", "\\|")
                    head = str(dep.get("head") or "").replace("|", "\\|")
                    relation = str(dep.get("relation") or "").replace("|", "\\|")
                    lines.append(
                        f"| {dep.get('task_key') or ''} | {dependent} | {head} | {relation} |"
                    )
            constituency = sentence.get("constituency")
            if isinstance(constituency, dict) and constituency.get("tree") is not None:
                lines.extend([
                    "",
                    "### Constituency",
                    "",
                    "```text",
                    str(constituency.get("tree") or ""),
                    "```",
                ])
            lines.append("")
        return "\n".join(lines)

    def _write_chunk_syntax_artifacts(
        self,
        source: KnowledgeSourceSpec,
        payload: dict[str, Any],
        *,
        config: KnowledgeConfig | None = None,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
        progress_start: int = 64,
        progress_end: int = 70,
    ) -> set[str]:
        previous_manifest_paths = self._load_source_syntax_manifest(source.id)
        current_syntax_paths: set[str] = set()
        map_rows = self._load_source_interlinear_lightweight_map_rows(source.id)
        raw_chunks = payload.get("chunks") or []
        chunks = [item for item in raw_chunks if isinstance(item, dict)] if isinstance(raw_chunks, list) else []
        chunk_groups = self._group_chunks_for_ner(chunks)
        total_documents = len(chunk_groups)
        syntax_ready_so_far = 0
        syntax_sentence_so_far = 0
        syntax_token_so_far = 0
        syntax_relation_so_far = 0

        for index, group in enumerate(chunk_groups, start=1):
            representative = group[0]

            if all(self._chunk_stage_ready_for_resume(chunk, stage="syntax") for chunk in group):
                for chunk in group:
                    current_syntax_paths.update(self._chunk_stage_paths(chunk, stage="syntax"))
                syntax_ready_so_far += 1
                syntax_sentence_so_far += max(
                    max(0, _safe_count_int(chunk.get("syntax_sentence_count") or 0))
                    for chunk in group
                )
                syntax_token_so_far += max(
                    max(0, _safe_count_int(chunk.get("syntax_token_count") or 0))
                    for chunk in group
                )
                syntax_relation_so_far += max(
                    max(0, _safe_count_int(chunk.get("syntax_relation_count") or 0))
                    for chunk in group
                )
                if progress_callback is not None:
                    progress_callback(
                        {
                            "stage": "syntax",
                            "done_chunks": index,
                            "total_chunks": total_documents,
                            "metrics": {
                                "syntax_ready_chunk_count": syntax_ready_so_far,
                                "syntax_sentence_count": syntax_sentence_so_far,
                                "syntax_token_count": syntax_token_so_far,
                                "syntax_relation_count": syntax_relation_so_far,
                            },
                        }
                    )
                continue

            for chunk in group:
                chunk["syntax_status"] = "ready"
                chunk["syntax_format_version"] = _SYNTAX_FORMAT_VERSION
                chunk.pop("syntax_path", None)
                chunk.pop("syntax_structured_path", None)
                chunk.pop("syntax_annotated_path", None)

            resolved_text, source_text, interlinear_path, syntax_input_mode = self._resolve_document_ner_input_text(
                group,
                map_rows=map_rows,
            )
            cor_structured_path = ""
            cor_resolution_mode = "identity_fallback"
            mentions = self._load_chunk_ner_mentions(representative)
            structured_payload = self._render_chunk_syntax_structured_payload(
                representative,
                source_text=source_text,
                input_text=resolved_text,
                interlinear_path=interlinear_path,
                syntax_input_mode=syntax_input_mode,
                cor_structured_path=cor_structured_path,
                cor_resolution_mode=cor_resolution_mode,
                mentions=mentions,
                config=config,
            )

            syntax_sentence_count = _safe_count_int(structured_payload.get("sentence_count") or 0)
            syntax_token_count = _safe_count_int(structured_payload.get("token_count") or 0)
            syntax_relation_count = _safe_count_int(structured_payload.get("relation_count") or 0)

            syntax_relative_path = self._build_syntax_relative_path(str(representative.get("chunk_path") or ""))
            syntax_structured_relative_path = self._build_syntax_structured_relative_path(
                str(representative.get("chunk_path") or "")
            )
            syntax_annotated_relative_path = self._build_syntax_annotated_relative_path(
                str(representative.get("chunk_path") or "")
            )

            syntax_file_path = self.root_dir / syntax_relative_path
            syntax_structured_file_path = self.root_dir / syntax_structured_relative_path
            syntax_annotated_file_path = self.root_dir / syntax_annotated_relative_path
            syntax_file_path.parent.mkdir(parents=True, exist_ok=True)
            syntax_file_path.write_text(
                self._render_chunk_syntax_text(representative, structured_payload),
                encoding="utf-8",
            )
            syntax_structured_file_path.parent.mkdir(parents=True, exist_ok=True)
            syntax_structured_file_path.write_text(
                json.dumps(
                    structured_payload,
                    ensure_ascii=False,
                    indent=2,
                ) + "\n",
                encoding="utf-8",
            )
            syntax_annotated_file_path.parent.mkdir(parents=True, exist_ok=True)
            syntax_annotated_file_path.write_text(
                self._render_chunk_syntax_annotated_markdown(representative, structured_payload),
                encoding="utf-8",
            )

            for chunk in group:
                chunk["syntax_input_mode"] = str(syntax_input_mode or "")
                chunk["syntax_interlinear_path"] = str(interlinear_path or "")
                chunk["syntax_sentence_count"] = syntax_sentence_count
                chunk["syntax_token_count"] = syntax_token_count
                chunk["syntax_relation_count"] = syntax_relation_count
                chunk["syntax_path"] = syntax_relative_path.as_posix()
                chunk["syntax_structured_path"] = syntax_structured_relative_path.as_posix()
                chunk["syntax_annotated_path"] = syntax_annotated_relative_path.as_posix()

            current_syntax_paths.add(syntax_relative_path.as_posix())
            current_syntax_paths.add(syntax_structured_relative_path.as_posix())
            current_syntax_paths.add(syntax_annotated_relative_path.as_posix())

            syntax_ready_so_far += 1
            syntax_sentence_so_far += syntax_sentence_count
            syntax_token_so_far += syntax_token_count
            syntax_relation_so_far += syntax_relation_count
            self._write_source_syntax_manifest(source.id, current_syntax_paths)
            self._write_l2_checkpoint(
                source.id,
                payload,
                stage="syntax",
                done_chunks=index,
                total_chunks=total_documents,
                metrics={
                    "syntax_ready_chunk_count": syntax_ready_so_far,
                    "syntax_sentence_count": syntax_sentence_so_far,
                    "syntax_token_count": syntax_token_so_far,
                    "syntax_relation_count": syntax_relation_so_far,
                },
            )

            if progress_callback is not None:
                progress_callback(
                    {
                        "stage": "syntax",
                        "done_chunks": index,
                        "total_chunks": total_documents,
                        "metrics": {
                            "syntax_ready_chunk_count": syntax_ready_so_far,
                            "syntax_sentence_count": syntax_sentence_so_far,
                            "syntax_token_count": syntax_token_so_far,
                            "syntax_relation_count": syntax_relation_so_far,
                        },
                    }
                )

        stale_syntax_paths = previous_manifest_paths - current_syntax_paths
        for syntax_path in stale_syntax_paths:
            self._delete_syntax_path(syntax_path)
        self._write_source_syntax_manifest(source.id, current_syntax_paths)
        return current_syntax_paths

    def _write_chunk_cor_artifacts(
        self,
        source: KnowledgeSourceSpec,
        payload: dict[str, Any],
        *,
        config: KnowledgeConfig | None,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
        progress_start: int = 45,
        progress_end: int = 54,
    ) -> set[str]:
        previous_manifest_paths = self._load_source_cor_manifest(source.id)
        current_cor_paths: set[str] = set()
        map_rows = self._load_source_interlinear_lightweight_map_rows(source.id)
        semantic_state = self.get_semantic_engine_state(config) if config is not None else self._semantic_engine_state(
            status="unavailable",
            reason_code="NLP_ENGINE_UNAVAILABLE",
            reason="NLP semantic engine is not configured.",
        )
        ready = semantic_state.get("status") == "ready"

        raw_chunks = payload.get("chunks") or []
        chunks = [item for item in raw_chunks if isinstance(item, dict)] if isinstance(raw_chunks, list) else []
        chunk_groups = self._group_chunks_for_ner(chunks)
        total_documents = len(chunk_groups)
        cor_ready_so_far = 0
        cor_cluster_so_far = 0
        cor_replacement_so_far = 0
        cor_effective_so_far = 0

        for index, group in enumerate(chunk_groups, start=1):
            representative = group[0]

            if all(self._chunk_stage_ready_for_resume(chunk, stage="cor") for chunk in group):
                for chunk in group:
                    current_cor_paths.update(self._chunk_stage_paths(chunk, stage="cor"))
                cor_ready_so_far += 1
                cor_cluster_so_far += max(
                    max(0, _safe_count_int(chunk.get("cor_cluster_count") or 0))
                    for chunk in group
                )
                chunk_replacement_count = max(
                    max(0, _safe_count_int(chunk.get("cor_replacement_count") or 0))
                    for chunk in group
                )
                cor_replacement_so_far += chunk_replacement_count
                if chunk_replacement_count > 0:
                    cor_effective_so_far += 1
                if progress_callback is not None:
                    progress_callback(
                        {
                            "stage": "cor",
                            "done_chunks": index,
                            "total_chunks": total_documents,
                            "metrics": {
                                "cor_ready_chunk_count": cor_ready_so_far,
                                "cor_cluster_count": cor_cluster_so_far,
                                "cor_replacement_count": cor_replacement_so_far,
                                "cor_effective_chunk_count": cor_effective_so_far,
                            },
                        }
                    )
                continue

            for chunk in group:
                chunk["cor_status"] = "unavailable"
                chunk["cor_format_version"] = _COR_FORMAT_VERSION
                chunk["cor_cluster_count"] = 0
                chunk["cor_replacement_count"] = 0
                chunk["cor_resolution_mode"] = "identity_fallback"
                chunk["cor_reason_code"] = str(semantic_state.get("reason_code") or "NLP_ENGINE_UNAVAILABLE")
                chunk["cor_reason"] = str(semantic_state.get("reason") or "NLP semantic engine is not configured.")
                chunk.pop("cor_path", None)
                chunk.pop("cor_structured_path", None)
                chunk.pop("cor_annotated_path", None)

            chunk_text, _, interlinear_path, cor_input_mode = self._resolve_document_ner_input_text(
                group,
                map_rows=map_rows,
            )
            raw_result: Any = {}
            if ready and config is not None:
                # HanLP coreference is intentionally disabled in CoPaw runtime.
                for chunk in group:
                    chunk["cor_reason_code"] = "HANLP2_COREF_NOT_OPEN_SOURCE"
                    chunk["cor_reason"] = (
                        "HanLP coreference_resolution is not open-source and is disabled in CoPaw runtime."
                    )

            cor_relative_path = self._build_cor_relative_path(str(representative.get("chunk_path") or ""))
            cor_structured_relative_path = self._build_cor_structured_relative_path(
                str(representative.get("chunk_path") or "")
            )
            cor_annotated_relative_path = self._build_cor_annotated_relative_path(
                str(representative.get("chunk_path") or "")
            )

            structured_payload = self._render_chunk_cor_structured_payload(
                representative,
                text=chunk_text,
                raw_result=raw_result,
                interlinear_path=interlinear_path,
                cor_input_mode=cor_input_mode,
            )
            cor_cluster_count = _safe_count_int(structured_payload.get("cluster_count") or 0)
            cor_replacement_count = _safe_count_int(structured_payload.get("replacement_count") or 0)
            cor_resolution_mode = str(structured_payload.get("resolution_mode") or "identity_fallback")

            cor_file_path = self.root_dir / cor_relative_path
            cor_structured_file_path = self.root_dir / cor_structured_relative_path
            cor_annotated_file_path = self.root_dir / cor_annotated_relative_path
            cor_file_path.parent.mkdir(parents=True, exist_ok=True)
            cor_file_path.write_text(
                self._render_chunk_cor_text(representative, structured_payload),
                encoding="utf-8",
            )
            cor_structured_file_path.parent.mkdir(parents=True, exist_ok=True)
            cor_structured_file_path.write_text(
                json.dumps(
                    structured_payload,
                    ensure_ascii=False,
                    indent=2,
                ) + "\n",
                encoding="utf-8",
            )
            cor_annotated_file_path.parent.mkdir(parents=True, exist_ok=True)
            cor_annotated_file_path.write_text(
                self._render_chunk_cor_annotated_markdown(representative, structured_payload),
                encoding="utf-8",
            )

            for chunk in group:
                chunk["cor_input_mode"] = str(cor_input_mode or "")
                chunk["cor_interlinear_path"] = str(interlinear_path or "")
                chunk["cor_cluster_count"] = cor_cluster_count
                chunk["cor_replacement_count"] = cor_replacement_count
                chunk["cor_resolution_mode"] = cor_resolution_mode
                chunk["cor_path"] = cor_relative_path.as_posix()
                chunk["cor_structured_path"] = cor_structured_relative_path.as_posix()
                chunk["cor_annotated_path"] = cor_annotated_relative_path.as_posix()

            current_cor_paths.add(cor_relative_path.as_posix())
            current_cor_paths.add(cor_structured_relative_path.as_posix())
            current_cor_paths.add(cor_annotated_relative_path.as_posix())

            if str(representative.get("cor_status") or "").strip() == "ready":
                cor_ready_so_far += 1
            cor_cluster_so_far += cor_cluster_count
            cor_replacement_so_far += cor_replacement_count
            if cor_replacement_count > 0:
                cor_effective_so_far += 1

            self._write_source_cor_manifest(source.id, current_cor_paths)
            self._write_l2_checkpoint(
                source.id,
                payload,
                stage="cor",
                done_chunks=index,
                total_chunks=total_documents,
                metrics={
                    "cor_ready_chunk_count": cor_ready_so_far,
                    "cor_cluster_count": cor_cluster_so_far,
                    "cor_replacement_count": cor_replacement_so_far,
                    "cor_effective_chunk_count": cor_effective_so_far,
                },
            )
            if progress_callback is not None:
                progress_callback(
                    {
                        "stage": "cor",
                        "done_chunks": index,
                        "total_chunks": total_documents,
                        "metrics": {
                            "cor_ready_chunk_count": cor_ready_so_far,
                            "cor_cluster_count": cor_cluster_so_far,
                            "cor_replacement_count": cor_replacement_so_far,
                            "cor_effective_chunk_count": cor_effective_so_far,
                        },
                    }
                )

        stale_cor_paths = previous_manifest_paths - current_cor_paths
        for cor_path in stale_cor_paths:
            self._delete_cor_path(cor_path)
        self._write_source_cor_manifest(source.id, current_cor_paths)
        return current_cor_paths

    def _render_chunk_ner_text(
        self,
        chunk: dict[str, Any],
        *,
        text: str,
        catalog: list[dict[str, Any]],
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
        for entity in catalog:
            if not isinstance(entity, dict):
                continue
            entity_label = escape(str(entity.get("label") or "entity"))
            entity_text = escape(str(entity.get("normalized") or ""))
            lines.append(f"    <entity type=\"{entity_label}\">{entity_text}</entity>")
        lines.extend(["  </entities>", "</chunk>"])
        return "\n".join(lines)

    def _write_chunk_ner_artifacts(
        self,
        source: KnowledgeSourceSpec,
        payload: dict[str, Any],
        *,
        config: KnowledgeConfig | None,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
        progress_start: int = 55,
        progress_end: int = 63,
    ) -> set[str]:
        previous_manifest_paths = self._load_source_ner_manifest(source.id)
        current_ner_paths: set[str] = set()
        map_rows = self._load_source_interlinear_lightweight_map_rows(source.id)
        semantic_state = self.get_semantic_engine_state(config) if config is not None else self._semantic_engine_state(
            status="unavailable",
            reason_code="NLP_ENGINE_UNAVAILABLE",
            reason="NLP semantic engine is not configured.",
        )

        raw_chunks = payload.get("chunks") or []
        chunks = [item for item in raw_chunks if isinstance(item, dict)] if isinstance(raw_chunks, list) else []
        chunk_groups = self._group_chunks_for_ner(chunks)
        total_documents = len(chunk_groups)
        ner_ready_so_far = 0
        ner_entity_so_far = 0

        for index, group in enumerate(chunk_groups, start=1):
            representative = group[0]

            if all(self._chunk_stage_ready_for_resume(chunk, stage="ner") for chunk in group):
                for chunk in group:
                    current_ner_paths.update(self._chunk_stage_paths(chunk, stage="ner"))
                ner_ready_so_far += 1
                ner_entity_so_far += max(
                    max(0, _safe_count_int(chunk.get("ner_entity_count") or 0))
                    for chunk in group
                )
                if progress_callback is not None:
                    progress_callback(
                        {
                            "stage": "ner",
                            "done_chunks": index,
                            "total_chunks": total_documents,
                            "metrics": {
                                "ner_ready_chunk_count": ner_ready_so_far,
                                "ner_entity_count": ner_entity_so_far,
                            },
                        }
                    )
                continue

            for chunk in group:
                chunk["file_key"] = self._chunk_file_key(chunk)
                chunk["version_id"] = self._chunk_version_id(chunk)
                chunk["ner_status"] = "unavailable"
                chunk["ner_entity_count"] = 0
                chunk["ner_format_version"] = _NER_FORMAT_VERSION
                chunk["ner_reason_code"] = str(semantic_state.get("reason_code") or "")
                chunk["ner_reason"] = str(semantic_state.get("reason") or "")
                chunk.pop("ner_path", None)
                chunk.pop("ner_structured_path", None)
                chunk.pop("ner_annotated_path", None)
                chunk.pop("ner_stats_path", None)

            resolved_text, source_text, interlinear_path, ner_input_mode = self._resolve_document_ner_input_text(
                group,
                map_rows=map_rows,
            )
            cor_structured_path = ""
            cor_resolution_mode = "identity_fallback"
            mentions = self._collect_chunk_ner_mentions_with_fallback(resolved_text, config=config) if config is not None else []
            catalog = self._build_chunk_ner_catalog(mentions)
            ner_relative_path = self._build_ner_relative_path(str(representative.get("chunk_path") or ""))
            ner_structured_relative_path = self._build_ner_structured_relative_path(
                str(representative.get("chunk_path") or "")
            )
            ner_annotated_relative_path = self._build_ner_annotated_relative_path(
                str(representative.get("chunk_path") or "")
            )
            ner_stats_relative_path = self._build_ner_stats_relative_path(str(representative.get("chunk_path") or ""))
            ner_file_path = self.root_dir / ner_relative_path
            ner_structured_file_path = self.root_dir / ner_structured_relative_path
            ner_annotated_file_path = self.root_dir / ner_annotated_relative_path
            ner_stats_file_path = self.root_dir / ner_stats_relative_path
            ner_file_path.parent.mkdir(parents=True, exist_ok=True)
            ner_file_path.write_text(
                self._render_chunk_ner_text(representative, text=resolved_text, catalog=catalog),
                encoding="utf-8",
            )
            ner_structured_file_path.parent.mkdir(parents=True, exist_ok=True)
            ner_structured_file_path.write_text(
                json.dumps(
                    self._render_chunk_ner_structured_payload(
                        representative,
                        source_text=source_text,
                        input_text=resolved_text,
                        interlinear_path=interlinear_path,
                        ner_input_mode=ner_input_mode,
                        cor_structured_path=cor_structured_path,
                        cor_resolution_mode=cor_resolution_mode,
                        catalog=catalog,
                        mentions=mentions,
                    ),
                    ensure_ascii=False,
                    indent=2,
                ) + "\n",
                encoding="utf-8",
            )
            ner_annotated_file_path.parent.mkdir(parents=True, exist_ok=True)
            ner_annotated_file_path.write_text(
                self._render_chunk_ner_annotated_markdown(
                    representative,
                    text=resolved_text,
                    mentions=mentions,
                    structured_relative_path=ner_structured_relative_path,
                ),
                encoding="utf-8",
            )
            ner_stats_file_path.parent.mkdir(parents=True, exist_ok=True)
            ner_stats_payload = {
                "artifact": "ner_stats",
                "format_version": _NER_FORMAT_VERSION,
                "document_path": str(representative.get("document_path") or ""),
                "chunk_count": len(group),
                "chunk_ids": [str(chunk.get("chunk_id") or "") for chunk in group],
                "chunk_paths": [str(chunk.get("chunk_path") or "") for chunk in group],
                "version_id": self._chunk_version_id(representative),
                "interlinear_path": interlinear_path,
                "ner_input_mode": ner_input_mode,
                "entity_count": len(catalog),
                "entity_mentions_count": len(mentions),
                "sentence_count": len([line for line in str(resolved_text or "").splitlines() if line.strip()]),
                "avg_entities_per_sentence": (
                    float(len(catalog))
                    / max(1, len([line for line in str(resolved_text or "").splitlines() if line.strip()]))
                ),
                "updated_at": datetime.now(UTC).isoformat(),
            }
            ner_stats_file_path.write_text(
                json.dumps(ner_stats_payload, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            for chunk in group:
                chunk["ner_status"] = "ready"
                chunk["ner_entity_count"] = len(catalog)
                chunk["ner_input_mode"] = ner_input_mode
                chunk["ner_path"] = ner_relative_path.as_posix()
                chunk["ner_structured_path"] = ner_structured_relative_path.as_posix()
                chunk["ner_annotated_path"] = ner_annotated_relative_path.as_posix()
                chunk["ner_stats_path"] = ner_stats_relative_path.as_posix()

            current_ner_paths.add(ner_relative_path.as_posix())
            current_ner_paths.add(ner_structured_relative_path.as_posix())
            current_ner_paths.add(ner_annotated_relative_path.as_posix())
            current_ner_paths.add(ner_stats_relative_path.as_posix())
            ner_ready_so_far += 1
            ner_entity_so_far += len(catalog)
            self._write_source_ner_manifest(source.id, current_ner_paths)
            self._write_l2_checkpoint(
                source.id,
                payload,
                stage="ner",
                done_chunks=index,
                total_chunks=total_documents,
                metrics={
                    "ner_ready_chunk_count": ner_ready_so_far,
                    "ner_entity_count": ner_entity_so_far,
                },
            )
            if progress_callback is not None:
                progress_callback(
                    {
                        "stage": "ner",
                        "done_chunks": index,
                        "total_chunks": total_documents,
                        "metrics": {
                            "ner_ready_chunk_count": ner_ready_so_far,
                            "ner_entity_count": ner_entity_so_far,
                        },
                    }
                )

        stale_ner_paths = previous_manifest_paths - current_ner_paths
        for ner_path in stale_ner_paths:
            self._delete_ner_path(ner_path)
        self._write_source_ner_manifest(source.id, current_ner_paths)
        return current_ner_paths

    def get_source_storage_dir(self, source_id: str) -> Path:
        # 扁平化模式下 source 元数据文件位于知识根目录
        return self.root_dir

    def get_source_storage_files(self, source_id: str) -> list[Path]:
        """Collect source-related files under flattened storage layout."""
        candidates: list[Path] = []
        metadata_filenames = (
            "content.md",
            "index.json",
            "source.json",
            "stats.json",
            "chunk-manifest.json",
            "cor-manifest.json",
            "ner-manifest.json",
            "syntax-manifest.json",
            "snapshot-manifest.json",
            "interlinear-manifest.json",
            "lightweight-manifest.json",
            "interlinear-lightweight-map.json",
        )
        for filename in metadata_filenames:
            flat_path = self._source_storage_flat_path(source_id, filename)
            if flat_path.exists() and flat_path.is_file():
                candidates.append(flat_path)

        for chunk_path in self._load_source_chunk_manifest(source_id):
            path = self.root_dir / str(chunk_path)
            if path.exists() and path.is_file():
                candidates.append(path)
        for cor_path in self._load_source_cor_manifest(source_id):
            path = self.root_dir / str(cor_path)
            if path.exists() and path.is_file():
                candidates.append(path)
        for ner_path in self._load_source_ner_manifest(source_id):
            path = self.root_dir / str(ner_path)
            if path.exists() and path.is_file():
                candidates.append(path)
        for syntax_path in self._load_source_syntax_manifest(source_id):
            path = self.root_dir / str(syntax_path)
            if path.exists() and path.is_file():
                candidates.append(path)

        interlinear_manifest = self._load_source_interlinear_manifest(source_id)
        for artifact in interlinear_manifest.get("artifacts", []):
            artifact_path = str(artifact.get("path") or "").strip()
            if not artifact_path:
                continue
            path = self.root_dir / artifact_path
            if path.exists() and path.is_file():
                candidates.append(path)
        for lightweight_path in self._load_source_lightweight_manifest(source_id):
            path = self.root_dir / str(lightweight_path)
            if path.exists() and path.is_file():
                candidates.append(path)
        for snapshot in self._load_source_snapshot_manifest(source_id):
            snapshot_path = str(snapshot.get("snapshot_path") or "").strip()
            if not snapshot_path:
                continue
            path = Path(snapshot_path)
            if path.exists() and path.is_file():
                candidates.append(path)

        unique: dict[str, Path] = {}
        for path in candidates:
            unique[path.as_posix()] = path
        return sorted(unique.values(), key=lambda item: item.as_posix())

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
                    "cor_path": str(chunk.get("cor_path") or ""),
                    "cor_structured_path": str(chunk.get("cor_structured_path") or ""),
                    "cor_annotated_path": str(chunk.get("cor_annotated_path") or ""),
                    "cor_status": str(chunk.get("cor_status") or "unavailable"),
                    "cor_reason_code": str(chunk.get("cor_reason_code") or ""),
                    "cor_reason": str(chunk.get("cor_reason") or ""),
                    "cor_interlinear_path": str(chunk.get("cor_interlinear_path") or ""),
                    "cor_input_mode": str(chunk.get("cor_input_mode") or ""),
                    "cor_cluster_count": _safe_count_int(chunk.get("cor_cluster_count") or 0),
                    "cor_replacement_count": _safe_count_int(chunk.get("cor_replacement_count") or 0),
                    "cor_format_version": str(chunk.get("cor_format_version") or ""),
                    "cor_resolution_mode": str(chunk.get("cor_resolution_mode") or "identity_fallback"),
                    "cor_text": self._read_artifact_text(chunk, "cor_path"),
                    "cor_structured_text": self._read_artifact_text(chunk, "cor_structured_path"),
                    "cor_annotated_text": self._read_artifact_text(chunk, "cor_annotated_path"),
                    "ner_path": str(chunk.get("ner_path") or ""),
                    "ner_structured_path": str(chunk.get("ner_structured_path") or ""),
                    "ner_annotated_path": str(chunk.get("ner_annotated_path") or ""),
                    "ner_stats_path": str(chunk.get("ner_stats_path") or ""),
                    "ner_status": str(chunk.get("ner_status") or "unavailable"),
                    "ner_reason_code": str(chunk.get("ner_reason_code") or ""),
                    "ner_reason": str(chunk.get("ner_reason") or ""),
                    "ner_input_mode": str(chunk.get("ner_input_mode") or ""),
                    "ner_entity_count": _safe_count_int(chunk.get("ner_entity_count") or 0),
                    "ner_format_version": str(chunk.get("ner_format_version") or ""),
                    "ner_text": self._read_ner_text(chunk),
                    "ner_structured_text": self._read_artifact_text(chunk, "ner_structured_path"),
                    "ner_annotated_text": self._read_artifact_text(chunk, "ner_annotated_path"),
                    "ner_stats_text": self._read_artifact_text(chunk, "ner_stats_path"),
                    "syntax_path": str(chunk.get("syntax_path") or ""),
                    "syntax_structured_path": str(chunk.get("syntax_structured_path") or ""),
                    "syntax_annotated_path": str(chunk.get("syntax_annotated_path") or ""),
                    "syntax_status": str(chunk.get("syntax_status") or "unavailable"),
                    "syntax_interlinear_path": str(chunk.get("syntax_interlinear_path") or ""),
                    "syntax_input_mode": str(chunk.get("syntax_input_mode") or ""),
                    "syntax_sentence_count": _safe_count_int(chunk.get("syntax_sentence_count") or 0),
                    "syntax_token_count": _safe_count_int(chunk.get("syntax_token_count") or 0),
                    "syntax_relation_count": _safe_count_int(chunk.get("syntax_relation_count") or 0),
                    "syntax_format_version": str(chunk.get("syntax_format_version") or ""),
                    "syntax_text": self._read_artifact_text(chunk, "syntax_path"),
                    "syntax_structured_text": self._read_artifact_text(chunk, "syntax_structured_path"),
                    "syntax_annotated_text": self._read_artifact_text(chunk, "syntax_annotated_path"),
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
        """Rebuild source specs from source-level metadata, with index fallback."""
        sources: list[KnowledgeSourceSpec] = []
        seen_source_ids: set[str] = set()

        for metadata_path in sorted(self.root_dir.glob("*--source.json")):
            try:
                payload = self._load_json(metadata_path)
                source_payload = payload.get("source")
                if not isinstance(source_payload, dict):
                    continue
                source = KnowledgeSourceSpec.model_validate(source_payload)
                if source.id in seen_source_ids:
                    continue
                sources.append(source)
                seen_source_ids.add(source.id)
            except Exception:
                logger.warning(
                    "Failed to read source metadata from storage: %s",
                    metadata_path,
                )

        for index_path in sorted(self.root_dir.glob("*--index.json")):
            try:
                payload = self._load_json(index_path)
                source_payload = payload.get("source")
                if not isinstance(source_payload, dict):
                    continue
                source = KnowledgeSourceSpec.model_validate(source_payload)
                if source.id in seen_source_ids:
                    continue
                sources.append(source)
                seen_source_ids.add(source.id)
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
        include_semantic_artifacts: bool = True,
    ) -> None:
        previous_manifest_paths = self._load_source_chunk_manifest(source.id)

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

        stale_chunk_paths = previous_manifest_paths - current_chunk_paths
        for chunk_path in stale_chunk_paths:
            self._delete_chunk_path(chunk_path)

        self._write_source_chunk_manifest(source.id, current_chunk_paths)
        if include_semantic_artifacts:
            self._write_chunk_ner_artifacts(source, payload, config=config)
            self._write_chunk_syntax_artifacts(source, payload, config=config)
            self._write_chunk_cor_artifacts(source, payload, config=config)
        else:
            for chunk in payload.get("chunks") or []:
                if not isinstance(chunk, dict):
                    continue
                chunk["cor_status"] = "unavailable"
                chunk["cor_format_version"] = _COR_FORMAT_VERSION
                chunk["cor_cluster_count"] = 0
                chunk["cor_replacement_count"] = 0
                chunk["cor_resolution_mode"] = "identity_fallback"
                chunk["cor_reason_code"] = "INDEXING_DEFERRED"
                chunk["cor_reason"] = "Semantic artifact generation is deferred to graphifying stage."
                chunk.pop("cor_path", None)
                chunk.pop("cor_structured_path", None)
                chunk.pop("cor_annotated_path", None)

                chunk["ner_status"] = "unavailable"
                chunk["ner_entity_count"] = 0
                chunk["ner_format_version"] = _NER_FORMAT_VERSION
                chunk["ner_reason_code"] = "INDEXING_DEFERRED"
                chunk["ner_reason"] = "Semantic artifact generation is deferred to graphifying stage."
                chunk["ner_input_mode"] = ""
                chunk.pop("ner_path", None)
                chunk.pop("ner_structured_path", None)
                chunk.pop("ner_annotated_path", None)
                chunk.pop("ner_stats_path", None)

                chunk["syntax_status"] = "unavailable"
                chunk["syntax_format_version"] = _SYNTAX_FORMAT_VERSION
                chunk["syntax_sentence_count"] = 0
                chunk["syntax_token_count"] = 0
                chunk["syntax_relation_count"] = 0
                chunk.pop("syntax_path", None)
                chunk.pop("syntax_structured_path", None)
                chunk.pop("syntax_annotated_path", None)

            stale_cor_paths = self._load_source_cor_manifest(source.id)
            for cor_path in stale_cor_paths:
                self._delete_cor_path(cor_path)
            self._write_source_cor_manifest(source.id, set())

            stale_ner_paths = self._load_source_ner_manifest(source.id)
            for ner_path in stale_ner_paths:
                self._delete_ner_path(ner_path)
            self._write_source_ner_manifest(source.id, set())

            stale_syntax_paths = self._load_source_syntax_manifest(source.id)
            for syntax_path in stale_syntax_paths:
                self._delete_syntax_path(syntax_path)
            self._write_source_syntax_manifest(source.id, set())

        self._write_source_index_payload(source.id, payload)
        self._write_source_metadata(source, indexed_at=str(payload.get("indexed_at") or ""))
        self._source_content_md_path(source.id).write_text(
            self._build_source_markdown(source, documents),
            encoding="utf-8",
        )
        self._prune_legacy_source_dir(source.id)
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

    def _project_snapshot_relative_path(
        self,
        source: KnowledgeSourceSpec,
        relative_path: str,
    ) -> Path:
        normalized = Path(str(relative_path or "").strip())
        if source.type != "directory" or len(normalized.parts) < 2:
            return normalized

        project_id = str(getattr(source, "project_id", "") or "").strip()
        if not project_id:
            return normalized

        first_part = str(normalized.parts[0] or "").strip()
        location_name = Path(str(source.location or "").strip()).name
        if first_part in {project_id, location_name}:
            return Path(*normalized.parts[1:])
        return normalized

    def _build_snapshot_relative_path(
        self,
        source: KnowledgeSourceSpec,
        document: dict[str, Any],
        *,
        indexed_at: str,
    ) -> Path:
        relative_path = str(document.get("relative_path") or "").strip()
        if source.type == "directory" and relative_path:
            normalized_relative = self._project_snapshot_relative_path(
                source,
                relative_path,
            )
            parent = normalized_relative.parent
            filename = normalized_relative.name
            target = parent if str(parent) not in {"", "."} else Path()
            return target / self._snapshot_filename(filename, indexed_at)

        source_path = str(document.get("source_path") or document.get("path") or source.location or source.id)
        filename = Path(source_path).name or self._safe_name(source.id)
        return Path(self._snapshot_filename(filename, indexed_at))

    def _latest_snapshot_by_document(
        self,
        snapshots: list[dict[str, str]],
    ) -> dict[str, dict[str, str]]:
        latest: dict[str, dict[str, str]] = {}
        for item in snapshots:
            document_path = str(item.get("document_path") or "").strip()
            if not document_path:
                continue
            latest[document_path] = item
        return latest

    def _snapshot_matches_source(
        self,
        source_path: Path,
        snapshot_entry: dict[str, str] | None,
    ) -> bool:
        if not snapshot_entry:
            return False
        snapshot_path_raw = str(snapshot_entry.get("snapshot_path") or "").strip()
        if not snapshot_path_raw:
            return False
        snapshot_path = Path(snapshot_path_raw)
        if not snapshot_path.exists() or not snapshot_path.is_file():
            return False
        try:
            return filecmp.cmp(source_path, snapshot_path, shallow=False)
        except OSError:
            return False

    def _ensure_snapshot_entry_under_raw_root(
        self,
        raw_root: Path,
        snapshot_entry: dict[str, str],
    ) -> dict[str, str]:
        snapshot_relative = str(snapshot_entry.get("snapshot_relative_path") or "").strip()
        if not snapshot_relative:
            return snapshot_entry

        target_path = raw_root / snapshot_relative
        current_path_raw = str(snapshot_entry.get("snapshot_path") or "").strip()
        current_path = Path(current_path_raw) if current_path_raw else None
        if current_path == target_path:
            return snapshot_entry

        target_path.parent.mkdir(parents=True, exist_ok=True)
        if current_path is not None and current_path.exists() and current_path.is_file():
            if target_path != current_path:
                shutil.copy2(current_path, target_path)
                self._delete_snapshot_file(current_path)
        updated = dict(snapshot_entry)
        updated["snapshot_path"] = target_path.as_posix()
        return updated

    def _persist_source_snapshots(
        self,
        source: KnowledgeSourceSpec,
        documents: list[dict[str, Any]],
        *,
        indexed_at: str,
    ) -> list[dict[str, str]]:
        if source.type not in {"file", "directory"}:
            return []

        raw_root = self._source_raw_dir(source.id, source)
        raw_root.mkdir(parents=True, exist_ok=True)
        existing = self._load_source_snapshot_manifest(source.id)
        latest_by_document = self._latest_snapshot_by_document(existing)
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
            document_path = str(document.get("path") or source_path.as_posix())
            latest_snapshot = latest_by_document.get(document_path)
            if self._snapshot_matches_source(source_path, latest_snapshot):
                reused_entry = dict(latest_snapshot)
                if self._source_uses_root_raw_dir(source):
                    reused_entry = self._ensure_snapshot_entry_under_raw_root(raw_root, reused_entry)
                    if reused_entry != latest_snapshot:
                        manifest = [reused_entry if item is latest_snapshot else item for item in manifest]
                        latest_by_document[document_path] = reused_entry
                        seen = {
                            (item.get("document_path") or "", item.get("snapshot_path") or "")
                            for item in manifest
                        }
                results.append(reused_entry)
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
                "document_path": document_path,
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
            latest_by_document[document_path] = snapshot_entry
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
        snapshot_manifest = self._persist_source_snapshots(source, documents, indexed_at=indexed_at)
        self._materialize_interlinear_and_lightweight_for_source(source.id, snapshot_manifest)
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
        self._update_source_stats_after_upload(
            source_id,
            raw_document_count=1,
            raw_total_bytes=len(data),
        )
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

        saved_count = 0
        total_bytes = 0

        for relative_path, data in files:
            normalized = Path(relative_path)
            safe_parts = [self._safe_name(part) for part in normalized.parts if part not in {"", "."}]
            if not safe_parts:
                continue
            file_path = target_dir.joinpath(*safe_parts)
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_bytes(data)
            saved_count += 1
            total_bytes += len(data)
        self._update_source_stats_after_upload(
            source_id,
            raw_document_count=saved_count,
            raw_total_bytes=total_bytes,
        )
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
        path = getattr(
            self,
            "backfill_state_path",
            self.knowledge_dir / "history-backfill-state.json",
        )
        if not path.exists():
            return {}
        try:
            return self._load_json(path)
        except Exception:
            return {}

    def _save_backfill_state(self, payload: dict[str, Any]) -> None:
        path = getattr(
            self,
            "backfill_state_path",
            self.knowledge_dir / "history-backfill-state.json",
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _load_backfill_progress_state(self) -> dict[str, Any]:
        path = getattr(
            self,
            "backfill_progress_path",
            self.knowledge_dir / "history-backfill-progress.json",
        )
        if not path.exists():
            return {}
        try:
            return self._load_json(path)
        except Exception:
            return {}

    def _save_backfill_progress(self, payload: dict[str, Any]) -> None:
        path = getattr(
            self,
            "backfill_progress_path",
            self.knowledge_dir / "history-backfill-progress.json",
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
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
                "NLP semantic engine is unavailable; semantic tokenization is skipped (%s)",
                state.get("reason_code"),
            )
            return []

        if not raw_tokens:
            self._semantic_engine_state(
                status="ready",
                reason_code="NLP_ENGINE_READY",
                reason="NLP semantic engine is ready.",
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
            reason_code="NLP_ENGINE_READY",
            reason="NLP semantic engine is ready.",
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
                count = _safe_count_int(chunk.get("sentence_count") or 0)
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