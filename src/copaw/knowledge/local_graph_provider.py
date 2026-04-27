# -*- coding: utf-8 -*-

from __future__ import annotations

import hashlib
import json
import logging
import re
from collections import Counter, defaultdict
from datetime import datetime
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
_PREDICATE_TRIM_RE = re.compile(r"^[\s\.,;:!\?，。；：！？、\-]+|[\s\.,;:!\?，。；：！？、\-]+$")
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

_QUERY_DIRECTIVE_RE = re.compile(r'(?P<key>path|file|version|before|after|since|until|sort|group|latest):(?P<value>"[^"]+"|\S+)', re.IGNORECASE)
_QUERY_GROUP_MODES = {"path", "file", "version", "time", "snapshot"}
_QUERY_SORT_MODES = {"score_desc", "score_asc", "time_desc", "time_asc", "path_asc", "path_desc"}
_ALL_GRAPH_QUERY_TOKENS = {"*", "__all__", "all"}


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


def _strip_query_quotes(value: str) -> str:
    text = str(value or "").strip()
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        return text[1:-1].strip()
    return text


def _parse_query_timestamp(value: str) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _record_snapshot_dt(record: dict[str, Any]) -> datetime | None:
    return _parse_query_timestamp(str(record.get("snapshot_at") or "").strip())


def _record_group_value(record: dict[str, Any], group_mode: str) -> str:
    normalized = str(group_mode or "").strip().lower()
    if normalized in {"path", "file"}:
        return str(record.get("document_path") or record.get("file_key") or "").strip()
    if normalized == "version":
        return str(record.get("version_id") or "").strip()
    if normalized in {"time", "snapshot"}:
        return str(record.get("snapshot_at") or "").strip()
    return ""


def _parse_query_directives(query_text: str) -> tuple[str, dict[str, Any]]:
    directives: dict[str, Any] = {
        "path": [],
        "file": [],
        "version": [],
        "after": None,
        "before": None,
        "sort": "score_desc",
        "group": "",
        "latest": False,
    }

    def _replace(match: re.Match[str]) -> str:
        key = str(match.group("key") or "").strip().lower()
        value = _strip_query_quotes(str(match.group("value") or ""))
        if key in {"path", "file", "version"} and value:
            directives[key].append(value)
        elif key in {"after", "since"}:
            parsed = _parse_query_timestamp(value)
            if parsed is not None:
                directives["after"] = parsed
        elif key in {"before", "until"}:
            parsed = _parse_query_timestamp(value)
            if parsed is not None:
                directives["before"] = parsed
        elif key == "sort":
            normalized = value.lower().replace("-", "_")
            if normalized in _QUERY_SORT_MODES:
                directives["sort"] = normalized
        elif key == "group":
            normalized = value.lower()
            if normalized in _QUERY_GROUP_MODES:
                directives["group"] = "path" if normalized == "file" else ("time" if normalized == "snapshot" else normalized)
        elif key == "latest":
            directives["latest"] = value.lower() not in {"0", "false", "no", "off"}
        return " "

    residual = _QUERY_DIRECTIVE_RE.sub(_replace, str(query_text or ""))
    residual = re.sub(r"\s+", " ", residual).strip()
    return residual, directives


def _is_all_graph_query(query_text: str) -> bool:
    normalized = str(query_text or "").strip().lower()
    return normalized in _ALL_GRAPH_QUERY_TOKENS


def _record_matches_directives(record: dict[str, Any], directives: dict[str, Any]) -> bool:
    document_path = str(record.get("document_path") or "").strip().lower()
    file_key = str(record.get("file_key") or record.get("document_path") or "").strip().lower()
    version_id = str(record.get("version_id") or "").strip().lower()
    snapshot_dt = _record_snapshot_dt(record)

    path_filters = [str(item).strip().lower() for item in directives.get("path") or [] if str(item).strip()]
    if path_filters and not any(item in document_path or item in file_key for item in path_filters):
        return False

    file_filters = [str(item).strip().lower() for item in directives.get("file") or [] if str(item).strip()]
    if file_filters and not any(item in Path(document_path or file_key).name.lower() for item in file_filters):
        return False

    version_filters = [str(item).strip().lower() for item in directives.get("version") or [] if str(item).strip()]
    if version_filters and not any(item in version_id for item in version_filters):
        return False

    after_dt = directives.get("after")
    if after_dt is not None and (snapshot_dt is None or snapshot_dt < after_dt):
        return False

    before_dt = directives.get("before")
    if before_dt is not None and (snapshot_dt is None or snapshot_dt > before_dt):
        return False

    return True


def _apply_query_record_sort(records: list[dict[str, Any]], sort_mode: str) -> list[dict[str, Any]]:
    normalized = str(sort_mode or "score_desc").strip().lower()
    if normalized == "score_asc":
        return sorted(records, key=lambda item: (float(item.get("score") or 0.0), str(item.get("document_path") or "")))
    if normalized == "time_desc":
        return sorted(records, key=lambda item: (_record_snapshot_dt(item) or datetime.min, float(item.get("score") or 0.0)), reverse=True)
    if normalized == "time_asc":
        return sorted(records, key=lambda item: (_record_snapshot_dt(item) or datetime.min, -float(item.get("score") or 0.0)))
    if normalized == "path_asc":
        return sorted(records, key=lambda item: (str(item.get("document_path") or item.get("file_key") or ""), -float(item.get("score") or 0.0)))
    if normalized == "path_desc":
        return sorted(records, key=lambda item: (str(item.get("document_path") or item.get("file_key") or ""), float(item.get("score") or 0.0)), reverse=True)
    return sorted(records, key=lambda item: float(item.get("score") or 0.0), reverse=True)


def _apply_latest_record_filter(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    latest_by_path: dict[str, tuple[datetime | None, float, dict[str, Any]]] = {}
    for record in records:
        path_key = str(record.get("document_path") or record.get("file_key") or "").strip()
        if not path_key:
            continue
        snapshot_dt = _record_snapshot_dt(record)
        score = float(record.get("score") or 0.0)
        current = latest_by_path.get(path_key)
        if current is None or (snapshot_dt or datetime.min, score) > (current[0] or datetime.min, current[1]):
            latest_by_path[path_key] = (snapshot_dt, score, record)
    filtered = [item[2] for item in latest_by_path.values()]
    return filtered if filtered else records


def _aggregate_query_records(records: list[dict[str, Any]], group_mode: str) -> list[dict[str, Any]]:
    normalized = str(group_mode or "").strip().lower()
    if normalized not in {"path", "version", "time"}:
        return records

    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        group_value = _record_group_value(record, normalized)
        if not group_value:
            group_value = "unknown"
        grouped[group_value].append(record)

    aggregated: list[dict[str, Any]] = []
    for group_value, items in grouped.items():
        ordered = _apply_query_record_sort(items, "score_desc")
        exemplar = dict(ordered[0])
        exemplar["subject"] = group_value
        exemplar["predicate"] = f"aggregate_by_{normalized}"
        exemplar["object"] = str(len(items))
        exemplar["score"] = float(sum(float(item.get("score") or 0.0) for item in items))
        exemplar["aggregate_mode"] = normalized
        exemplar["aggregate_group"] = normalized
        exemplar["aggregate_key"] = group_value
        exemplar["aggregate_count"] = len(items)
        exemplar["aggregate_predicates"] = sorted({str(item.get("predicate") or "") for item in items if str(item.get("predicate") or "")})
        exemplar["document_paths"] = sorted({str(item.get("document_path") or "") for item in items if str(item.get("document_path") or "")})
        exemplar["version_ids"] = sorted({str(item.get("version_id") or "") for item in items if str(item.get("version_id") or "")})
        exemplar["snapshot_range"] = [
            min((str(item.get("snapshot_at") or "") for item in items if str(item.get("snapshot_at") or "")), default=""),
            max((str(item.get("snapshot_at") or "") for item in items if str(item.get("snapshot_at") or "")), default=""),
        ]
        aggregated.append(exemplar)
    return aggregated


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
    text = str(document.get("ner_text") or document.get("text") or "")
    cleaned = _FRONTMATTER_RE.sub("", text, count=1)
    cleaned = _FENCED_CODE_BLOCK_RE.sub(" ", cleaned)
    cleaned = _INLINE_CODE_RE.sub(" ", cleaned)
    cleaned = _MARKDOWN_HEADING_RE.sub(" ", cleaned)
    cleaned = _TABLE_SEPARATOR_RE.sub(" ", cleaned)
    cleaned = _KEY_VALUE_PREFIX_RE.sub("", cleaned)
    return cleaned.strip()


def _load_syntax_payload(document: dict[str, Any]) -> dict[str, Any] | None:
    raw = str(document.get("syntax_structured_text") or "").strip()
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return payload if isinstance(payload, dict) else None


def _collect_syntax_sentences(document: dict[str, Any]) -> list[dict[str, Any]]:
    payload = _load_syntax_payload(document)
    if not isinstance(payload, dict):
        return []
    sentences = payload.get("sentences")
    if not isinstance(sentences, list):
        return []
    return [item for item in sentences if isinstance(item, dict)]


def _collect_syntax_entity_counter(document: dict[str, Any]) -> Counter[str]:
    counter: Counter[str] = Counter()
    for sentence in _collect_syntax_sentences(document):
        for entity in sentence.get("entities") or []:
            if not isinstance(entity, dict):
                continue
            normalized = _normalize_entity(str(entity.get("normalized") or entity.get("surface") or ""))
            if len(normalized) < 2 or _looks_like_noise_entity(normalized):
                continue
            if normalized.isdigit():
                continue
            counter[normalized] += 1
    return counter


def _extract_heading_text(document: dict[str, Any]) -> str:
    text = str(document.get("ner_text") or document.get("text") or "")
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
    syntax_sentences = _collect_syntax_sentences(document)
    if syntax_sentences:
        sentence_stats: list[dict[str, Any]] = []
        syntax_entity_total = 0
        for sentence in syntax_sentences:
            sentence_text = str(sentence.get("sentence_text") or "")
            entities = [item for item in (sentence.get("entities") or []) if isinstance(item, dict)]
            entity_count_total = len(entities)
            syntax_entity_total += entity_count_total
            unique_entities = {
                _normalize_entity(str(item.get("normalized") or item.get("surface") or ""))
                for item in entities
                if _normalize_entity(str(item.get("normalized") or item.get("surface") or ""))
            }
            entity_char_count = sum(len(str(item.get("surface") or "")) for item in entities)
            sentence_char_count = int(len(re.sub(r"\s+", "", sentence_text)))
            entity_char_ratio = (
                float(entity_char_count / sentence_char_count)
                if sentence_char_count > 0
                else 0.0
            )
            sentence_stats.append(
                {
                    "sentence_index": int(sentence.get("sentence_index") or len(sentence_stats) + 1),
                    "sentence": sentence_text,
                    "entity_count_total": entity_count_total,
                    "entity_count_unique": int(len(unique_entities)),
                    "entity_char_count": entity_char_count,
                    "sentence_char_count": sentence_char_count,
                    "entity_char_ratio": entity_char_ratio,
                }
            )
        if syntax_entity_total > 0:
            return sentence_stats

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


def _collect_ranked_entities(document: dict[str, Any]) -> list[tuple[str, int]]:
    syntax_counter = _collect_syntax_entity_counter(document)
    if syntax_counter:
        return syntax_counter.most_common()

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

    # Return all ranked entities without limit (let all valid candidates through)
    return ranked.most_common()


def _collect_syntax_sentence_entity_groups(document: dict[str, Any]) -> list[list[str]]:
    groups: list[list[str]] = []
    for sentence in _collect_syntax_sentences(document):
        labels: list[str] = []
        seen: set[str] = set()
        for entity in sentence.get("entities") or []:
            if not isinstance(entity, dict):
                continue
            normalized = _normalize_entity(str(entity.get("normalized") or entity.get("surface") or ""))
            if len(normalized) < 2 or _looks_like_noise_entity(normalized):
                continue
            if normalized in seen:
                continue
            seen.add(normalized)
            labels.append(normalized)
        if labels:
            groups.append(labels)
    return groups


def _normalize_predicate(text: str) -> str:
    normalized = _PREDICATE_TRIM_RE.sub("", str(text or "").strip())
    normalized = re.sub(r"\s+", " ", normalized)
    if re.fullmatch(r"[A-Za-z0-9_. -]+", normalized):
        normalized = normalized.lower().strip()
    return normalized


def _looks_like_noise_predicate(text: str) -> bool:
    normalized = _normalize_predicate(text)
    if len(normalized) < 1:
        return True
    if re.fullmatch(r"[\W_]+", normalized):
        return True
    if normalized in {"和", "与", "及", "以及", "and", "or", "to", "with", "by", "of"}:
        return True
    if len(normalized) > 32:
        return True
    return False


def _collect_relation_candidates(document: dict[str, Any]) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for sentence in _collect_syntax_sentences(document):
        sentence_text = str(sentence.get("sentence_text") or "")
        sentence_start = int(sentence.get("start") or 0)
        entities = [item for item in (sentence.get("entities") or []) if isinstance(item, dict)]
        filtered_entities: list[dict[str, Any]] = []
        for entity in sorted(entities, key=lambda item: (int(item.get("start") or 0), int(item.get("end") or 0))):
            normalized = _normalize_entity(str(entity.get("normalized") or entity.get("surface") or ""))
            if len(normalized) < 2 or _looks_like_noise_entity(normalized):
                continue
            if normalized.isdigit():
                continue
            filtered_entities.append({**entity, "_normalized": normalized})

        if not filtered_entities:
            regex_entities: list[dict[str, Any]] = []
            for match in _ENTITY_RE.finditer(sentence_text):
                surface = match.group(0)
                normalized = _normalize_entity(surface)
                if len(normalized) < 2 or _looks_like_noise_entity(normalized):
                    continue
                if normalized.isdigit():
                    continue
                regex_entities.append(
                    {
                        "surface": surface,
                        "start": sentence_start + match.start(),
                        "end": sentence_start + match.end(),
                        "_normalized": normalized,
                    }
                )
            if len(regex_entities) >= 2:
                filtered_entities = [regex_entities[0], regex_entities[-1]]

        for left, right in zip(filtered_entities, filtered_entities[1:]):
            subject = str(left.get("_normalized") or "")
            object_ = str(right.get("_normalized") or "")
            if not subject or not object_ or subject == object_:
                continue
            left_end = int(left.get("end") or 0)
            right_start = int(right.get("start") or 0)
            predicate_text = sentence_text[max(left_end - sentence_start, 0):max(right_start - sentence_start, 0)]
            predicate = _normalize_predicate(predicate_text)
            if _looks_like_noise_predicate(predicate):
                continue
            candidates.append(
                {
                    "subject": subject,
                    "predicate": predicate,
                    "object": object_,
                    "subject_id": _safe_node_id("ent", subject),
                    "object_id": _safe_node_id("ent", object_),
                    "sentence_index": int(sentence.get("sentence_index") or 0),
                    "sentence": sentence_text,
                    "confidence": "syntax_span",
                    "parse_mode": str(sentence.get("parse_mode") or "tokenized_only"),
                    "subject_surface": str(left.get("surface") or subject),
                    "object_surface": str(right.get("surface") or object_),
                    "predicate_text": predicate_text,
                }
            )
    return candidates


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
        payload = manager.get_source_chunk_documents(source_id)
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
                    "chunk_id": str(document.get("chunk_id") or ""),
                    "chunk_path": str(document.get("chunk_path") or ""),
                    "snapshot_path": str(document.get("snapshot_path") or ""),
                    "snapshot_relative_path": str(document.get("snapshot_relative_path") or ""),
                    "snapshot_at": str(document.get("snapshot_at") or ""),
                    "version_id": str(document.get("version_id") or ""),
                    "file_key": str(document.get("file_key") or document.get("path") or ""),
                    "ner_path": str(document.get("ner_path") or ""),
                    "ner_status": str(document.get("ner_status") or "unavailable"),
                    "ner_entity_count": int(document.get("ner_entity_count") or 0),
                    "ner_text": str(document.get("ner_text") or ""),
                    "syntax_path": str(document.get("syntax_path") or ""),
                    "syntax_structured_path": str(document.get("syntax_structured_path") or ""),
                    "syntax_status": str(document.get("syntax_status") or "unavailable"),
                    "syntax_structured_text": str(document.get("syntax_structured_text") or ""),
                }
            )
    return documents


def _document_group_key(document: dict[str, Any]) -> str:
    return str(document.get("path") or document.get("file_key") or document.get("title") or "").strip()


def _graphify_document_filename(document_path: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", str(document_path or "").strip().lower()).strip("-")
    if not normalized:
        normalized = "document"
    normalized = normalized[:48].strip("-") or "document"
    digest = hashlib.sha1(str(document_path or normalized).encode("utf-8")).hexdigest()[:12]
    return f"{normalized}-{digest}.graphify.json"


def _sorted_unique_nonempty(values: list[str]) -> list[str]:
    return sorted({str(value).strip() for value in values if str(value).strip()})


def _merge_node_fields(existing: dict[str, Any], incoming: dict[str, Any]) -> None:
    for key in ("chunk_paths", "snapshot_paths", "version_history"):
        if key in incoming:
            merged = _sorted_unique_nonempty(list(existing.get(key) or []) + list(incoming.get(key) or []))
            if merged:
                existing[key] = merged
    for key in ("source_id", "source_file", "source_location", "file_type", "node_type", "project_id", "file_key", "ner_path"):
        if not existing.get(key) and incoming.get(key):
            existing[key] = incoming.get(key)
    if not existing.get("label") and incoming.get("label"):
        existing["label"] = incoming.get("label")


def _merge_edge_fields(existing: dict[str, Any], incoming: dict[str, Any]) -> None:
    existing["weight"] = float(existing.get("weight") or 0) + float(incoming.get("weight") or 0)
    for key in ("chunk_paths", "snapshot_paths", "version_history"):
        if key in incoming:
            merged = _sorted_unique_nonempty(list(existing.get(key) or []) + list(incoming.get(key) or []))
            if merged:
                existing[key] = merged
    for key in ("document_path", "document_title", "chunk_path", "snapshot_path", "snapshot_at", "version_id", "file_key", "source_id"):
        if not existing.get(key) and incoming.get(key):
            existing[key] = incoming.get(key)


def _build_document_graphify_payload(document_path: str, documents: list[dict[str, Any]]) -> dict[str, Any]:
    primary = documents[0] if documents else {}
    title = str(primary.get("title") or document_path)
    doc_id = _safe_node_id("doc", document_path)
    nodes: dict[str, dict[str, Any]] = {}
    edges: dict[tuple[str, str, str], dict[str, Any]] = {}
    entity_sources: defaultdict[str, set[str]] = defaultdict(set)
    sentence_entity_stats: list[dict[str, Any]] = []
    relation_candidates: list[dict[str, Any]] = []
    entity_weights: Counter[str] = Counter()
    co_occurrence_weights: Counter[tuple[str, str]] = Counter()
    sentence_count_total = 0
    sentence_with_entities_count = 0
    entity_mentions_count = 0
    entity_char_ratio_sum = 0.0
    chunk_paths: list[str] = []
    snapshot_paths: list[str] = []
    snapshot_ats: list[str] = []
    version_ids: list[str] = []

    for document in documents:
        chunk_path = str(document.get("chunk_path") or "")
        snapshot_path = str(document.get("snapshot_path") or "")
        snapshot_at = str(document.get("snapshot_at") or "").strip()
        version_id = str(document.get("version_id") or "").strip()
        chunk_paths.append(chunk_path)
        snapshot_paths.append(snapshot_path)
        snapshot_ats.append(snapshot_at)
        version_ids.append(version_id)

        sentence_stats = _collect_sentence_entity_stats(document)
        sentence_count_total += len(sentence_stats)
        for stat in sentence_stats:
            entity_count_total = int(stat.get("entity_count_total") or 0)
            entity_mentions_count += entity_count_total
            if entity_count_total > 0:
                sentence_with_entities_count += 1
            entity_char_ratio_sum += float(stat.get("entity_char_ratio") or 0.0)
            sentence_entity_stats.append(
                {
                    "source_id": document["source_id"],
                    "project_id": document["project_id"],
                    "document_path": document_path,
                    "document_title": title,
                    "chunk_path": chunk_path,
                    "snapshot_path": snapshot_path,
                    "snapshot_at": snapshot_at,
                    "version_id": version_id,
                    **stat,
                }
            )

        document_relation_candidates = _collect_relation_candidates(document)
        for candidate in document_relation_candidates:
            relation_candidates.append(
                {
                    "source_id": document["source_id"],
                    "project_id": document["project_id"],
                    "document_path": document_path,
                    "document_title": title,
                    "chunk_path": chunk_path,
                    "snapshot_path": snapshot_path,
                    "snapshot_at": snapshot_at,
                    "version_id": version_id,
                    "file_key": document.get("file_key") or document_path,
                    **candidate,
                }
            )

        entity_pairs = _collect_ranked_entities(document)
        entity_labels = [label for label, _ in entity_pairs[:16]]
        for label, weight in entity_pairs:
            entity_weights[label] += weight
            entity_id = _safe_node_id("ent", label)
            entity_sources[entity_id].add(document["source_id"])

        syntax_entity_groups = _collect_syntax_sentence_entity_groups(document)
        co_occurrence_groups = syntax_entity_groups or [sorted(set(entity_labels))]
        for group in co_occurrence_groups:
            for left, right in combinations(sorted(set(group)), 2):
                ordered = tuple(sorted((left, right)))
                co_occurrence_weights[ordered] += 1

    chunk_paths = _sorted_unique_nonempty(chunk_paths)
    snapshot_paths = _sorted_unique_nonempty(snapshot_paths)
    snapshot_ats = _sorted_unique_nonempty(snapshot_ats)
    version_ids = _sorted_unique_nonempty(version_ids)
    representative_chunk_path = chunk_paths[0] if chunk_paths else ""
    representative_snapshot_path = snapshot_paths[0] if snapshot_paths else ""
    representative_snapshot_at = snapshot_ats[-1] if snapshot_ats else ""
    representative_version_id = version_ids[-1] if version_ids else ""

    nodes[doc_id] = {
        "id": doc_id,
        "label": title,
        "source_id": str(primary.get("source_id") or ""),
        "source_file": document_path,
        "source_location": document_path,
        "file_type": str(primary.get("source_type") or "document"),
        "node_type": "document",
        "project_id": str(primary.get("project_id") or ""),
        "chunk_path": representative_chunk_path,
        "chunk_paths": chunk_paths,
        "snapshot_path": representative_snapshot_path,
        "snapshot_paths": snapshot_paths,
        "snapshot_at": representative_snapshot_at,
        "version_id": representative_version_id,
        "version_history": version_ids,
        "file_key": str(primary.get("file_key") or document_path),
        "ner_path": str(primary.get("ner_path") or ""),
        "sentence_count": sentence_count_total,
        "entity_mentions_count": entity_mentions_count,
        "chunk_count": len(chunk_paths),
    }

    metadata_relations = [
        ("has_path", document_path, "path"),
        ("has_file_name", Path(document_path).name or document_path, "file_name"),
    ]
    for snapshot_at in snapshot_ats:
        metadata_relations.append(("has_snapshot_at", snapshot_at, "snapshot_at"))
    for version_id in version_ids:
        metadata_relations.append(("has_version", version_id, "version"))

    for relation_name, value_label, node_type in metadata_relations:
        meta_node_id = _safe_node_id(node_type, value_label)
        nodes.setdefault(
            meta_node_id,
            {
                "id": meta_node_id,
                "label": value_label,
                "source_id": str(primary.get("source_id") or ""),
                "source_file": document_path,
                "source_location": document_path,
                "file_type": node_type,
                "node_type": node_type,
                "project_id": str(primary.get("project_id") or ""),
                "snapshot_path": representative_snapshot_path,
                "snapshot_paths": snapshot_paths,
                "snapshot_at": representative_snapshot_at,
                "version_id": representative_version_id,
                "version_history": version_ids,
                "file_key": str(primary.get("file_key") or document_path),
            },
        )
        edges[(doc_id, meta_node_id, relation_name)] = {
            "source": doc_id,
            "target": meta_node_id,
            "relation": relation_name,
            "confidence": "derived",
            "weight": 1,
            "source_id": str(primary.get("source_id") or ""),
            "document_path": document_path,
            "document_title": title,
            "chunk_path": representative_chunk_path,
            "chunk_paths": chunk_paths,
            "snapshot_path": representative_snapshot_path,
            "snapshot_paths": snapshot_paths,
            "snapshot_at": representative_snapshot_at,
            "version_id": representative_version_id,
            "version_history": version_ids,
            "file_key": str(primary.get("file_key") or document_path),
        }

    for label, weight in entity_weights.items():
        entity_id = _safe_node_id("ent", label)
        nodes.setdefault(
            entity_id,
            {
                "id": entity_id,
                "label": label,
                "source_id": sorted(entity_sources.get(entity_id) or [str(primary.get("source_id") or "")])[0],
                "source_file": document_path,
                "source_location": document_path,
                "file_type": "entity",
                "node_type": "entity",
                "project_id": str(primary.get("project_id") or ""),
                "chunk_path": representative_chunk_path,
                "chunk_paths": chunk_paths,
                "snapshot_path": representative_snapshot_path,
                "snapshot_paths": snapshot_paths,
                "snapshot_at": representative_snapshot_at,
                "version_id": representative_version_id,
                "version_history": version_ids,
                "file_key": str(primary.get("file_key") or document_path),
            },
        )
        edges[(doc_id, entity_id, "mentions")] = {
            "source": doc_id,
            "target": entity_id,
            "relation": "mentions",
            "confidence": str(weight),
            "weight": weight,
            "source_id": str(primary.get("source_id") or ""),
            "document_path": document_path,
            "document_title": title,
            "chunk_path": representative_chunk_path,
            "chunk_paths": chunk_paths,
            "snapshot_path": representative_snapshot_path,
            "snapshot_paths": snapshot_paths,
            "snapshot_at": representative_snapshot_at,
            "version_id": representative_version_id,
            "version_history": version_ids,
            "file_key": str(primary.get("file_key") or document_path),
        }

    for (left, right), weight in co_occurrence_weights.items():
        left_id = _safe_node_id("ent", left)
        right_id = _safe_node_id("ent", right)
        ordered = tuple(sorted((left_id, right_id)))
        edges[(ordered[0], ordered[1], "co_occurs_with")] = {
            "source": ordered[0],
            "target": ordered[1],
            "relation": "co_occurs_with",
            "confidence": "derived",
            "weight": weight,
            "source_id": str(primary.get("source_id") or ""),
            "document_path": document_path,
            "document_title": title,
            "chunk_path": representative_chunk_path,
            "chunk_paths": chunk_paths,
            "snapshot_path": representative_snapshot_path,
            "snapshot_paths": snapshot_paths,
            "snapshot_at": representative_snapshot_at,
            "version_id": representative_version_id,
            "version_history": version_ids,
            "file_key": str(primary.get("file_key") or document_path),
        }

    for node_id, source_ids in entity_sources.items():
        if node_id in nodes and source_ids:
            nodes[node_id]["source_id"] = sorted(source_ids)[0]

    return {
        "artifact": "document_graphify",
        "document_path": document_path,
        "document_title": title,
        "file_key": str(primary.get("file_key") or document_path),
        "source_id": str(primary.get("source_id") or ""),
        "source_name": str(primary.get("source_name") or ""),
        "source_type": str(primary.get("source_type") or ""),
        "project_id": str(primary.get("project_id") or ""),
        "chunk_paths": chunk_paths,
        "snapshot_paths": snapshot_paths,
        "snapshot_ats": snapshot_ats,
        "version_ids": version_ids,
        "nodes": list(nodes.values()),
        "links": list(edges.values()),
        "sentence_entity_stats": sentence_entity_stats,
        "relation_candidates": relation_candidates,
        "stats": {
            "document_count": 1,
            "chunk_count": len(chunk_paths),
            "node_count": len(nodes),
            "relation_count": len(edges),
            "relation_candidate_count": len(relation_candidates),
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
            "entity_char_ratio_sum": entity_char_ratio_sum,
        },
    }


def _build_document_graphify_payloads(documents: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for document in documents:
        grouped[_document_group_key(document)].append(document)
    return [
        _build_document_graphify_payload(document_path, grouped_documents)
        for document_path, grouped_documents in sorted(grouped.items(), key=lambda item: item[0])
        if document_path
    ]


def _build_project_graph_payload_from_documents(document_payloads: list[dict[str, Any]]) -> dict[str, Any]:
    nodes: dict[str, dict[str, Any]] = {}
    edges: dict[tuple[str, str, str], dict[str, Any]] = {}
    sentence_entity_stats: list[dict[str, Any]] = []
    relation_candidates: list[dict[str, Any]] = []
    sentence_count_total = 0
    sentence_with_entities_count = 0
    entity_mentions_count = 0
    entity_char_ratio_sum = 0.0

    for payload in document_payloads:
        for node in payload.get("nodes") or []:
            if not isinstance(node, dict) or not node.get("id"):
                continue
            node_id = str(node.get("id"))
            existing = nodes.get(node_id)
            if existing is None:
                nodes[node_id] = dict(node)
            else:
                _merge_node_fields(existing, node)

        for edge in payload.get("links") or []:
            if not isinstance(edge, dict):
                continue
            edge_key = (
                str(edge.get("source") or ""),
                str(edge.get("target") or ""),
                str(edge.get("relation") or ""),
            )
            existing = edges.get(edge_key)
            if existing is None:
                edges[edge_key] = dict(edge)
            else:
                _merge_edge_fields(existing, edge)

        sentence_entity_stats.extend(
            item for item in (payload.get("sentence_entity_stats") or []) if isinstance(item, dict)
        )
        relation_candidates.extend(
            item for item in (payload.get("relation_candidates") or []) if isinstance(item, dict)
        )
        stats = payload.get("stats") or {}
        sentence_count_total += int(stats.get("sentence_count") or 0)
        sentence_with_entities_count += int(stats.get("sentence_with_entities_count") or 0)
        entity_mentions_count += int(stats.get("entity_mentions_count") or 0)
        entity_char_ratio_sum += float(stats.get("entity_char_ratio_sum") or 0.0)

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
        f"documents={len(document_payloads)}, "
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
        "relation_candidates": relation_candidates,
        "stats": {
            "document_count": len(document_payloads),
            "node_count": len(nodes),
            "relation_count": len(edges),
            "relation_candidate_count": len(relation_candidates),
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


def build_local_graph_payload(
    manager: KnowledgeManager,
    config: KnowledgeConfig,
    dataset_scope: list[str] | None,
) -> dict[str, Any]:
    documents = _load_dataset_documents(manager, config, dataset_scope)
    document_payloads = _build_document_graphify_payloads(documents)
    return _build_project_graph_payload_from_documents(document_payloads)


def persist_local_graph(
    manager: KnowledgeManager,
    config: KnowledgeConfig,
    dataset_scope: list[str] | None,
    graph_path: Path,
) -> dict[str, Any]:
    documents = _load_dataset_documents(manager, config, dataset_scope)
    document_payloads = _build_document_graphify_payloads(documents)
    graphify_dir = graph_path.parent.parent / "graphify"
    graphify_dir.mkdir(parents=True, exist_ok=True)
    manifest_documents: list[dict[str, Any]] = []
    for payload in document_payloads:
        document_path = str(payload.get("document_path") or "")
        payload_name = _graphify_document_filename(document_path)
        payload_path = graphify_dir / payload_name
        payload_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        manifest_documents.append(
            {
                "document_path": document_path,
                "document_title": str(payload.get("document_title") or ""),
                "payload_path": str(payload_path),
                "payload_relative_path": str(payload_path.relative_to(graph_path.parent.parent)),
                "chunk_count": int((payload.get("stats") or {}).get("chunk_count") or 0),
                "version_ids": list(payload.get("version_ids") or []),
            }
        )
    manifest_path = graphify_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "artifact": "graphify_manifest",
                "document_count": len(document_payloads),
                "documents": manifest_documents,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    payload = _build_project_graph_payload_from_documents(document_payloads)
    graph_path.parent.mkdir(parents=True, exist_ok=True)
    graph_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    stats = payload.get("stats") or {}
    return {
        "status": "succeeded",
        "error": None,
        "warnings": [] if stats.get("relation_count", 0) > 0 else ["LOCAL_GRAPH_EMPTY"],
        "graph_path": str(graph_path),
        "document_graph_dir": str(graphify_dir),
        "document_graph_manifest_path": str(manifest_path),
        "document_graph_count": len(document_payloads),
        "document_count": int(stats.get("document_count") or 0),
        "node_count": int(stats.get("node_count") or 0),
        "relation_count": int(stats.get("relation_count") or 0),
        "relation_candidate_count": int(stats.get("relation_candidate_count") or 0),
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
    effective_query_text, directives = _parse_query_directives(query_text)
    all_query = _is_all_graph_query(effective_query_text)
    terms = [token.lower() for token in _ENTITY_RE.findall(effective_query_text or "") if len(token) > 1]
    if not all_query and not terms and not any(
        [
            directives.get("path"),
            directives.get("file"),
            directives.get("version"),
            directives.get("after"),
            directives.get("before"),
            directives.get("group"),
            directives.get("latest"),
        ]
    ):
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
                str(edge.get("snapshot_at") or ""),
                str(edge.get("version_id") or ""),
                str(edge.get("file_key") or ""),
            ]
        ).lower()
        score = sum(1 for term in terms if term in haystack)
        if not all_query and terms and score <= 0:
            continue
        record = {
            "subject": str(source.get("label") or edge.get("source") or "unknown"),
            "subject_type": str(source.get("node_type") or source.get("type") or source.get("file_type") or "entity"),
            "predicate": str(edge.get("relation") or "related_to"),
            "object": str(target.get("label") or edge.get("target") or "unknown"),
            "object_type": str(target.get("node_type") or target.get("type") or target.get("file_type") or "entity"),
            "score": float(score + float(edge.get("weight") or 0) * 0.1),
            "source_id": str(edge.get("source_id") or source.get("source_id") or ""),
            "source_type": str(source.get("file_type") or "graph"),
            "document_path": str(edge.get("document_path") or source.get("source_file") or ""),
            "document_title": str(edge.get("document_title") or source.get("label") or ""),
            "chunk_path": str(edge.get("chunk_path") or source.get("chunk_path") or ""),
            "snapshot_path": str(edge.get("snapshot_path") or source.get("snapshot_path") or ""),
            "snapshot_at": str(edge.get("snapshot_at") or source.get("snapshot_at") or ""),
            "version_id": str(edge.get("version_id") or source.get("version_id") or ""),
            "file_key": str(edge.get("file_key") or source.get("file_key") or ""),
        }
        if not _record_matches_directives(record, directives):
            continue
        records.append(record)
    if directives.get("latest"):
        records = _apply_latest_record_filter(records)
    if directives.get("group"):
        records = _aggregate_query_records(records, str(directives.get("group") or ""))
    records = _apply_query_record_sort(records, str(directives.get("sort") or "score_desc"))
    return records[: max(1, int(top_k))]