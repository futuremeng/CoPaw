# -*- coding: utf-8 -*-
"""Read CoPaw's release-channel fact source.

``pending`` is the only availability bit: a channel that has not been opened
reads as ``None``, never as an empty string a caller might "helpfully" fill
in with upstream's address.  That confusion is the bug this module exists to
make impossible.

``src/copaw/__init__.py`` re-exports all of ``qwenpaw``, so the gate and the
scripts load this file *by path*; the CLI imports it normally because it
already depends on ``qwenpaw``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

FACT_SOURCE = Path(__file__).with_name("release_channel.json")

CHANNELS = ("pypi", "docker", "cdn")
ADDRESS_FIELDS = {"docker": "docker_namespace", "cdn": "download_cdn"}


def load(path: Path = FACT_SOURCE) -> dict[str, Any]:
    """Parse the fact source.  Malformed JSON raises to the caller."""
    return json.loads(path.read_text(encoding="utf-8"))


def is_ready(data: dict[str, Any], channel: str) -> bool:
    """A channel is available exactly when ``pending`` does not name it."""
    return channel not in data["pending"]


def address(data: dict[str, Any], channel: str) -> Optional[str]:
    """``None`` while the channel is pending; the value once it is ready."""
    value = data.get(ADDRESS_FIELDS[channel])
    return value or None


def repository_url(data: dict[str, Any]) -> str:
    return f"https://github.com/{data['github_repository']}"


def releases_url(data: dict[str, Any]) -> str:
    return f"{repository_url(data)}/releases"


def asset_name(data: dict[str, Any], platform: str, version: str) -> str:
    return data["assets"][platform].format(version=version)
