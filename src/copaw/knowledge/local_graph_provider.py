# -*- coding: utf-8 -*-

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path
from typing import Any

from ..config.config import KnowledgeConfig
from .manager import KnowledgeManager

logger = logging.getLogger(__name__)

_ENTITY_RE = re.compile(r"[A-Za-z][A-Za-z0-9_./-]{2,}|[\u4e00-\u9fff]{2,16}")
_FILE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]+\.(?:md|txt|json|ya?ml|csv|tsv|py|js|ts|tsx|jsx|html|xml|toml|ini|cfg)$", re.IGNORECASE)
_MULTI_SUFFIX_FILE_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$", re.IGNORECASE)
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_HEXISH_RE = re.compile(r"^[0-9a-f]{12,}$", re.IGNORECASE)
_ID_LIKE_RE = re.compile(r"(?:^|[_-])(id|uuid|session|chat|token|hash|digest)(?:$|[_-])", re.IGNORECASE)
_CODE_IDENTIFIER_RE = re.compile(r"^[a-z0-9]+(?:[_-][a-z0-9]+)+$")
_SYSTEM_FILENAMES = {".ds_store", "thumbs.db"}
_GRAPH_TEXT_SUFFIXES = {".md", ".markdown", ".mdx", ".txt", ".rst", ".adoc"}
_FRONTMATTER_RE = re.compile(r"\A---\s*\n.*?\n---\s*(?:\n|\Z)", re.DOTALL)
_FENCED_CODE_BLOCK_RE = re.compile(r"```.*?```", re.DOTALL)
_INLINE_CODE_RE = re.compile(r"`[^`]+`")
_MARKDOWN_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+.*$", re.MULTILINE)
_TABLE_SEPARATOR_RE = re.compile(r"^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*$", re.MULTILINE)
_KEY_VALUE_PREFIX_RE = re.compile(r"^\s*(?:[-*]\s*)?[A-Za-z_][A-Za-z0-9_ -]{1,40}:\s*", re.MULTILINE)
_CAMEL_CASE_RE = re.compile(r"^[A-Z][A-Za-z0-9]+(?:[A-Z][A-Za-z0-9]+)+$")
_ENTITY_STOP_WORDS = {
    "the",
    "and",
    "for",
    "with",
    "this",
    "that",
    "from",
    "into",
    "test",
    "content",
    "data",
    "name",
    "description",
    "status",
    "output",
    "term",
    "terms",
    "file",
    "files",
    "metadata",
    "json",
    "yaml",
    "yml",
    "csv",
    "tsv",
    "pdf",
    "true",
    "false",
    "null",
    "none",
    "len",
    "当前",
    "完成",
    "修复",
    "输入",
    "输出",
}


def _safe_node_id(prefix: str, value: str) -> str:
    digest = hashlib.sha1(f"{prefix}:{value}".encode("utf-8")).hexdigest()[:16]
    return f"{prefix}-{digest}"


def _normalize_entity(token: str) -> str:
    normalized = str(token or "").strip().strip("._-/:")
    if not normalized:
        return ""
    if re.fullmatch(r"[A-Za-z0-9_.-]+", normalized):
        normalized = normalized.lower()
    return normalized


def _looks_like_noise_entity(token: str) -> bool:
    if not token:
        return True
    lowered = token.lower()
    if lowered in _ENTITY_STOP_WORDS:
        return True
    if "/" in token or "\\" in token:
        return True
    if _FILE_TOKEN_RE.fullmatch(token):
        return True
    if "." in token and _MULTI_SUFFIX_FILE_TOKEN_RE.fullmatch(token):
        return True
    if _UUID_RE.fullmatch(lowered) or _HEXISH_RE.fullmatch(lowered):
        return True
    if _ID_LIKE_RE.search(lowered):
        return True
    if _CODE_IDENTIFIER_RE.fullmatch(token):
        return True
    digit_count = sum(ch.isdigit() for ch in token)
    if digit_count >= 4 and digit_count / max(len(token), 1) >= 0.25:
        return True
    if token.count("-") >= 2 and digit_count > 0:
        return True
    return False


def _should_include_document(document: dict[str, Any]) -> bool:
    path = Path(str(document.get("path") or document.get("title") or ""))
    name = path.name.lower()
    if not name:
        return False
    if name in _SYSTEM_FILENAMES or name.startswith("."):
        return False
    suffix = path.suffix.lower()
    if suffix and suffix not in _GRAPH_TEXT_SUFFIXES:
        return False
    text = str(document.get("text") or "").strip()
    return bool(text)


def _prepare_entity_text(document: dict[str, Any]) -> str:
    text = str(document.get("text") or "")
    cleaned = _FRONTMATTER_RE.sub("", text, count=1)
    cleaned = _FENCED_CODE_BLOCK_RE.sub(" ", cleaned)
    cleaned = _INLINE_CODE_RE.sub(" ", cleaned)
    cleaned = _MARKDOWN_HEADING_RE.sub(" ", cleaned)
    cleaned = _TABLE_SEPARATOR_RE.sub(" ", cleaned)
    cleaned = _KEY_VALUE_PREFIX_RE.sub("", cleaned)
    return cleaned.strip()


def _extract_heading_text(document: dict[str, Any]) -> str:
    text = str(document.get("text") or "")
    text = _FRONTMATTER_RE.sub("", text, count=1)
    headings = []
    for line in text.splitlines():
        if _MARKDOWN_HEADING_RE.fullmatch(line.strip()):
            headings.append(re.sub(r"^\s{0,3}#{1,6}\s+", "", line).strip())
    return "\n".join(item for item in headings if item)


def _split_sentences(text: str) -> list[str]:
    normalized = str(text or "").replace("\r\n", "\n").replace("\r", "\n")
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


def _collect_sentence_entity_stats(document: dict[str, Any]) -> list[dict[str, Any]]:
    prepared_text = _prepare_entity_text(document)
    sentence_stats: list[dict[str, Any]] = []
    for sentence_index, sentence in enumerate(_split_sentences(prepared_text), start=1):
        counter = _extract_entity_counter(sentence)
        entity_count_total = int(sum(counter.values()))
        entity_char_count = int(sum(len(term) * count for term, count in counter.items()))
        sentence_char_count = int(len(re.sub(r"\s+", "", sentence)))
        entity_char_ratio = (
            float(entity_char_count / sentence_char_count)
            if sentence_char_count > 0
            else 0.0
        )
        sentence_stats.append(
            {
                "sentence_index": sentence_index,
                "sentence": sentence,
                "entity_count_total": entity_count_total,
                "entity_count_unique": int(len(counter)),
                "entity_char_count": entity_char_count,
                "sentence_char_count": sentence_char_count,
                "entity_char_ratio": entity_char_ratio,
            }
        )
    return sentence_stats


def _extract_entities(text: str, *, limit: int = 10) -> list[tuple[str, int]]:
    counter: Counter[str] = Counter()
    for raw in _ENTITY_RE.findall(text or ""):
        token = _normalize_entity(raw)
        if len(token) < 2 or _looks_like_noise_entity(token):
            continue
        if token.isdigit():
            continue
        counter[token] += 1
    return counter.most_common(limit)


def _extract_entity_counter(text: str) -> Counter[str]:
    counter: Counter[str] = Counter()
    for raw in _ENTITY_RE.findall(text or ""):
        token = _normalize_entity(raw)
        if len(token) < 2 or _looks_like_noise_entity(token):
            continue
        if token.isdigit():
            continue
        counter[token] += 1
    return counter


def _is_high_signal_entity(raw_token: str) -> bool:
    token = str(raw_token or "").strip()
    if not token:
        return False
    if _CAMEL_CASE_RE.fullmatch(token):
        return True
    if re.search(r"[\u4e00-\u9fff]", token):
        return len(token) >= 2
    return False


def _collect_ranked_entities(document: dict[str, Any], *, limit: int = 200) -> list[tuple[str, int]]:
    title_text = str(document.get("title") or "").strip()
    heading_text = _extract_heading_text(document)
    body_text = _prepare_entity_text(document)
    title_counter = _extract_entity_counter(title_text)
    heading_counter = _extract_entity_counter(heading_text)
    body_counter = _extract_entity_counter(body_text)

    ranked: Counter[str] = Counter()
    for token, count in body_counter.items():
        ranked[token] += count

    for raw in _ENTITY_RE.findall(title_text):
        normalized = _normalize_entity(raw)
        if not normalized or normalized in ranked:
            continue
        if _looks_like_noise_entity(normalized):
            continue
        if _is_high_signal_entity(raw):
            ranked[normalized] += 1

    for raw in _ENTITY_RE.findall(heading_text):
        normalized = _normalize_entity(raw)
        if not normalized or normalized in ranked:
            continue
        if _looks_like_noise_entity(normalized):
            continue
        if _is_high_signal_entity(raw):
            ranked[normalized] += max(heading_counter.get(normalized, 0), 1)

    return ranked.most_common(limit)


def _load_dataset_documents(
    manager: KnowledgeManager,
    config: KnowledgeConfig,
    dataset_scope: list[str] | None,
) -> list[dict[str, Any]]:
    source_ids = dataset_scope or [source.id for source in config.sources if source.enabled]
    source_map = {source.id: source for source in config.sources}
    documents: list[dict[str, Any]] = []
    for source_id in source_ids:
        source = source_map.get(source_id)
        if source is None or not source.enabled:
            continue
        payload = manager.get_source_documents(source_id)
        if not payload.get("indexed"):
            continue
        for document in payload.get("documents") or []:
            if not isinstance(document, dict):
                continue
            if not _should_include_document(document):
                continue
            documents.append(
                {
                    "source_id": source_id,
                    "source_name": source.name,
                    "source_type": source.type,
                    "project_id": getattr(source, "project_id", "") or "",
                    "path": str(document.get("path") or ""),
                    "title": str(document.get("title") or source.name),
                    "text": str(document.get("text") or ""),
                }
            )
    return documents


def build_local_graph_payload(
    manager: KnowledgeManager,
    config: KnowledgeConfig,
    dataset_scope: list[str] | None,
) -> dict[str, Any]:
    documents = _load_dataset_documents(manager, config, dataset_scope)
    nodes: dict[str, dict[str, Any]] = {}
    edges: dict[tuple[str, str, str], dict[str, Any]] = {}
    entity_sources: defaultdict[str, set[str]] = defaultdict(set)
    sentence_entity_stats: list[dict[str, Any]] = []
    sentence_count_total = 0
    sentence_with_entities_count = 0
    entity_mentions_count = 0
    entity_char_ratio_sum = 0.0

    # 调试统计变量
    total_entity_pairs_processed = 0

    for document in documents:
        doc_path = document["path"] or document["title"]
        doc_id = _safe_node_id("doc", doc_path)
        nodes.setdefault(
            doc_id,
            {
                "id": doc_id,
                "label": document["title"],
                "source_id": document["source_id"],
                "source_file": doc_path,
                "source_location": doc_path,
                "file_type": document["source_type"],
                "node_type": "document",
                "project_id": document["project_id"],
            },
        )

        sentence_stats = _collect_sentence_entity_stats(document)
        sentence_count = len(sentence_stats)
        sentence_count_total += sentence_count
        mentions_for_document = 0
        for stat in sentence_stats:
            entity_count_total = int(stat.get("entity_count_total") or 0)
            mentions_for_document += entity_count_total
            entity_mentions_count += entity_count_total
            if entity_count_total > 0:
                sentence_with_entities_count += 1
            entity_char_ratio_sum += float(stat.get("entity_char_ratio") or 0.0)
            sentence_entity_stats.append(
                {
                    "source_id": document["source_id"],
                    "project_id": document["project_id"],
                    "document_path": doc_path,
                    "document_title": document["title"],
                    **stat,
                }
            )
        if doc_id in nodes:
            nodes[doc_id]["sentence_count"] = sentence_count
            nodes[doc_id]["entity_mentions_count"] = mentions_for_document

        entity_pairs = _collect_ranked_entities(document)
        entity_labels = [label for label, _ in entity_pairs[:16]]
        for label, weight in entity_pairs:
            entity_id = _safe_node_id("ent", label)
            nodes.setdefault(
                entity_id,
                {
                    "id": entity_id,
                    "label": label,
                    "source_id": document["source_id"],
                    "source_file": doc_path,
                    "source_location": doc_path,
                    "file_type": "entity",
                    "node_type": "entity",
                    "project_id": document["project_id"],
                },
            )
            entity_sources[entity_id].add(document["source_id"])
            edge_key = (doc_id, entity_id, "mentions")
            edge = edges.setdefault(
                edge_key,
                {
                    "source": doc_id,
                    "target": entity_id,
                    "relation": "mentions",
                    "confidence": str(weight),
                    "weight": 0,
                    "source_id": document["source_id"],
                    "document_path": doc_path,
                    "document_title": document["title"],
                },
            )
            edge["weight"] += weight

        for left, right in combinations(sorted(set(entity_labels)), 2):
            left_id = _safe_node_id("ent", left)
            right_id = _safe_node_id("ent", right)
            source_id = document["source_id"]
            ordered = tuple(sorted((left_id, right_id)))
            edge_key = (ordered[0], ordered[1], "co_occurs_with")
            edge = edges.setdefault(
                edge_key,
                {
                    "source": ordered[0],
                    "target": ordered[1],
                    "relation": "co_occurs_with",
                    "confidence": "derived",
                    "weight": 0,
                    "source_id": source_id,
                    "document_path": doc_path,
                    "document_title": document["title"],
                },
            )
            edge["weight"] += 1

    for node_id, source_ids in entity_sources.items():
        if node_id in nodes and source_ids:
            nodes[node_id]["source_id"] = sorted(source_ids)[0]

    # 调试统计输出
    total_entities = len([n for n in nodes.values() if n.get("node_type") == "entity"])
    total_relations = len(edges)
    entity_coverage_ratio = (
        float(total_entities / sentence_count_total * 100)
        if sentence_count_total > 0
        else 0.0
    )
    avg_mentions_per_sentence = (
        float(entity_mentions_count / sentence_count_total)
        if sentence_count_total > 0
        else 0.0
    )
    logger.info(
        f"Entity extraction stats: "
        f"documents={len(documents)}, "
        f"sentences={sentence_count_total}, "
        f"entities={total_entities}, "
        f"coverage_ratio={entity_coverage_ratio:.2f}%, "
        f"relations={total_relations}, "
        f"entity_mentions={entity_mentions_count}, "
        f"avg_mentions_per_sent={avg_mentions_per_sentence:.2f}"
    )

    return {
        "directed": False,
        "multigraph": False,
        "nodes": list(nodes.values()),
        "links": list(edges.values()),
        "sentence_entity_stats": sentence_entity_stats,
        "stats": {
            "document_count": len(documents),
            "node_count": len(nodes),
            "relation_count": len(edges),
            "sentence_count": sentence_count_total,
            "sentence_with_entities_count": sentence_with_entities_count,
            "entity_mentions_count": entity_mentions_count,
            "avg_entities_per_sentence": (
                float(entity_mentions_count / sentence_count_total)
                if sentence_count_total > 0
                else 0.0
            ),
            "avg_entity_char_ratio": (
                float(entity_char_ratio_sum / sentence_count_total)
                if sentence_count_total > 0
                else 0.0
            ),
        },
    }


def persist_local_graph(
    manager: KnowledgeManager,
    config: KnowledgeConfig,
    dataset_scope: list[str] | None,
    graph_path: Path,
) -> dict[str, Any]:
    payload = build_local_graph_payload(manager, config, dataset_scope)
    graph_path.parent.mkdir(parents=True, exist_ok=True)
    graph_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    stats = payload.get("stats") or {}
    return {
        "status": "succeeded",
        "error": None,
        "warnings": [] if stats.get("relation_count", 0) > 0 else ["LOCAL_GRAPH_EMPTY"],
        "graph_path": str(graph_path),
        "document_count": int(stats.get("document_count") or 0),
        "node_count": int(stats.get("node_count") or 0),
        "relation_count": int(stats.get("relation_count") or 0),
        "sentence_count": int(stats.get("sentence_count") or 0),
        "sentence_with_entities_count": int(stats.get("sentence_with_entities_count") or 0),
        "entity_mentions_count": int(stats.get("entity_mentions_count") or 0),
        "avg_entities_per_sentence": float(stats.get("avg_entities_per_sentence") or 0.0),
        "avg_entity_char_ratio": float(stats.get("avg_entity_char_ratio") or 0.0),
    }


def query_local_graph(
    graph_path: Path,
    query_text: str,
    top_k: int,
) -> list[dict[str, Any]]:
    if not graph_path.exists():
        return []
    payload = json.loads(graph_path.read_text(encoding="utf-8"))
    nodes = {
        str(item.get("id")): item
        for item in (payload.get("nodes") or [])
        if isinstance(item, dict) and item.get("id")
    }
    links = [item for item in (payload.get("links") or []) if isinstance(item, dict)]
    terms = [token.lower() for token in _ENTITY_RE.findall(query_text or "") if len(token) > 1]
    if not terms:
        return []

    records: list[dict[str, Any]] = []
    for edge in links:
        source = nodes.get(str(edge.get("source") or ""))
        target = nodes.get(str(edge.get("target") or ""))
        if source is None or target is None:
            continue
        haystack = " ".join(
            [
                str(source.get("label") or ""),
                str(target.get("label") or ""),
                str(edge.get("document_title") or ""),
                str(edge.get("document_path") or ""),
            ]
        ).lower()
        score = sum(1 for term in terms if term in haystack)
        if score <= 0:
            continue
        records.append(
            {
                "subject": str(source.get("label") or edge.get("source") or "unknown"),
                "predicate": str(edge.get("relation") or "related_to"),
                "object": str(target.get("label") or edge.get("target") or "unknown"),
                "score": float(score + float(edge.get("weight") or 0) * 0.1),
                "source_id": str(edge.get("source_id") or source.get("source_id") or ""),
                "source_type": str(source.get("file_type") or "graph"),
                "document_path": str(edge.get("document_path") or source.get("source_file") or ""),
                "document_title": str(edge.get("document_title") or source.get("label") or ""),
            }
        )
    records.sort(key=lambda item: item["score"], reverse=True)
    return records[: max(1, int(top_k))]