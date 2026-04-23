# -*- coding: utf-8 -*-
from __future__ import annotations

import os
from pathlib import Path

RUNTIME_FLAVOR_ENV = "QWENPAW_RUNTIME_FLAVOR"
CORE_RUNTIME_FLAVOR = "qwenpaw"
ENHANCED_RUNTIME_FLAVOR = "copaw"
DEFAULT_RUNTIME_FLAVOR = CORE_RUNTIME_FLAVOR
_VALID_RUNTIME_FLAVORS = frozenset(
    {
        CORE_RUNTIME_FLAVOR,
        ENHANCED_RUNTIME_FLAVOR,
    },
)


def normalize_runtime_flavor(flavor: str | None) -> str:
    if not flavor:
        return DEFAULT_RUNTIME_FLAVOR
    normalized = flavor.strip().lower()
    if normalized in _VALID_RUNTIME_FLAVORS:
        return normalized
    return DEFAULT_RUNTIME_FLAVOR


def detect_runtime_flavor(program_name: str | None = None) -> str:
    candidate = program_name or os.path.basename(os.sys.argv[0])
    stem = Path(candidate).name.lower()
    if stem.endswith(".exe"):
        stem = stem[:-4]
    if stem.startswith(ENHANCED_RUNTIME_FLAVOR):
        return ENHANCED_RUNTIME_FLAVOR
    return CORE_RUNTIME_FLAVOR


def get_runtime_flavor() -> str:
    return normalize_runtime_flavor(os.environ.get(RUNTIME_FLAVOR_ENV))


def ensure_runtime_flavor(
    flavor: str | None = None,
    *,
    program_name: str | None = None,
) -> str:
    resolved = normalize_runtime_flavor(flavor)
    if flavor is None:
        current = os.environ.get(RUNTIME_FLAVOR_ENV)
        if current:
            resolved = normalize_runtime_flavor(current)
        else:
            resolved = detect_runtime_flavor(program_name=program_name)
    os.environ[RUNTIME_FLAVOR_ENV] = resolved
    return resolved


def is_enhanced_runtime(flavor: str | None = None) -> bool:
    return normalize_runtime_flavor(flavor or get_runtime_flavor()) == ENHANCED_RUNTIME_FLAVOR


def get_runtime_app_import_path(flavor: str | None = None) -> str:
    resolved = normalize_runtime_flavor(flavor or get_runtime_flavor())
    if resolved == ENHANCED_RUNTIME_FLAVOR:
        return "copaw.app._app:app"
    return "qwenpaw.app._app:app"