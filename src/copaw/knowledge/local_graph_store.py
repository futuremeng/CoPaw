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
