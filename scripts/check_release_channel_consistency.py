#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Guard CoPaw's release-channel fact source against its consumers.

Five rules (design §8):

* R1 authority   -- ``pending`` is the only availability bit, and it can only
                    name declared channels; our own distribution names are
                    never empty.
* R2 two-state   -- an address field is null exactly while its channel is
                    still pending.
* R3 no-upstream -- a fork-side channel file never names an upstream
                    distribution identity, and every installer still points
                    at our own Releases page (a positive anchor: a forbidden
                    string alone would miss ``_PACKAGE=qwenpaw%VERSION%``).
* R4 codegen     -- the committed console module equals the rendered fact
                    source byte for byte.
* R5 version     -- ``__version__`` parses, and after stripping ``.postN`` /
                    ``.devN`` it equals ``upstream_version``.

Usage:
    python scripts/check_release_channel_consistency.py
    python scripts/check_release_channel_consistency.py --repo-root DIR
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

from packaging.version import InvalidVersion, Version

sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_channel import render_ts  # noqa: E402

LOADER_REL = "src/copaw/release_channel.py"
FACT_REL = "src/copaw/release_channel.json"
VERSION_REL = "src/qwenpaw/__version__.py"

# rel path -> which derived anchor it must contain ("releases" or None).
CHANNEL_FILES = (
    ("scripts/install.sh", "releases"),
    ("scripts/install.ps1", "releases"),
    ("scripts/install.bat", "releases"),
    ("console/src/layouts/constants.ts", None),
    ("console/src/generated/releaseChannel.ts", None),
    # No anchor here: Task 5 deletes this file's literal Releases URL and
    # derives the address from the fact source, so requiring the literal
    # would be a permanent red.  It stays in the coverage set for the
    # forbidden markers (its docstring used to name `qwenpaw==`), and the
    # "address comes from the JSON" property is guarded by Task 5's probe
    # experiment plus `test_cli_update_overlay.py`.
    ("src/copaw/cli/update_cmd.py", None),
)
FORK_WORKFLOW_GLOB = "copaw-*.y*ml"

# Upstream's distribution identities.  A fork-side channel file can have no
# legitimate reason to name them; that is what makes this list safe.
UPSTREAM_MARKERS = (
    "agentscope-ai/QwenPaw",
    "agentscope/qwenpaw",
    "pypi.org/pypi/qwenpaw",
    "qwenpaw==",
)

VERSION_RE = re.compile(r'^__version__\s*=\s*"([^"]+)"', re.MULTILINE)
LOCAL_SUFFIX_RE = re.compile(r"(?:\.post\d+|\.dev\d+)+$")


def _load_loader(repo_root: Path):
    spec = importlib.util.spec_from_file_location(
        "_rc_consistency_loader", repo_root / LOADER_REL
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rule_authority(loader, data):
    errors = []
    pending = data["pending"]
    if len(set(pending)) != len(pending):
        errors.append("R1: pending lists a channel twice")
    unknown = [name for name in pending if name not in loader.CHANNELS]
    if unknown:
        errors.append(
            f"R1: pending names unknown channels {unknown}; "
            f"declared channels are {list(loader.CHANNELS)}"
        )
    for key in ("distribution", "pypi_project"):
        value = data.get(key)
        if not isinstance(value, str) or not value:
            errors.append(
                f"R1: {key} must name our own distribution even while its "
                "channel is still pending"
            )
    return errors


def rule_two_state(loader, data):
    errors = []
    for channel, field in loader.ADDRESS_FIELDS.items():
        ready = loader.is_ready(data, channel)
        value = data.get(field)
        if ready and not value:
            errors.append(
                f"R2: {channel} is not pending but {field} is empty"
            )
        if not ready and value is not None:
            errors.append(
                f"R2: {channel} is pending but {field} = {value!r}"
            )
    return errors


def _anchors(loader, data):
    return {"releases": loader.releases_url(data)}


def rule_no_upstream(loader, data, repo_root):
    errors = []
    anchors = _anchors(loader, data)
    paths = list(CHANNEL_FILES)
    # Fork-owned release workflows join as soon as they exist (phase 2);
    # an empty glob is a legitimate phase-1 state, not a missing file.
    for path in sorted(
        (repo_root / ".github/workflows").glob(FORK_WORKFLOW_GLOB)
    ):
        paths.append((str(path.relative_to(repo_root)), None))
    for rel, anchor in paths:
        path = repo_root / rel
        if not path.exists():
            errors.append(f"R3: channel file {rel} is missing")
            continue
        text = path.read_text(encoding="utf-8")
        for marker in UPSTREAM_MARKERS:
            if marker in text:
                errors.append(
                    f"R3: {rel} names the upstream identity {marker!r}"
                )
        if anchor:
            expected = anchors[anchor]
            if expected not in text:
                errors.append(f"R3: {rel} no longer points at {expected}")
    return errors


def rule_codegen(data, repo_root):
    rel = "console/src/generated/releaseChannel.ts"
    path = repo_root / rel
    if not path.exists():
        return [f"R4: {rel} is missing"]
    if path.read_text(encoding="utf-8") != render_ts(data):
        return [
            f"R4: {rel} is stale; re-run "
            "scripts/release_channel.py --write-ts"
        ]
    return []


def rule_version_line(data, repo_root):
    path = repo_root / VERSION_REL
    if not path.exists():
        return [f"R5: {VERSION_REL} is missing"]
    match = VERSION_RE.search(path.read_text(encoding="utf-8"))
    if not match:
        return [f"R5: {VERSION_REL} has no parseable __version__ assignment"]
    number = match.group(1)
    try:
        Version(number)
    except InvalidVersion:
        return [f"R5: {number!r} is not a valid PEP 440 version"]
    # base_version is NOT usable here: Version("1.1.11b1.post1").base_version
    # drops the b1, so the comparison would always fail.
    base = LOCAL_SUFFIX_RE.sub("", number)
    if base != data["upstream_version"]:
        return [
            f"R5: {VERSION_REL} reports {number!r} (upstream part {base!r}) "
            f"but the fact source says upstream_version="
            f"{data['upstream_version']!r}"
        ]
    return []


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
    )
    args = parser.parse_args(argv)
    repo_root = args.repo_root.resolve()

    loader = _load_loader(repo_root)
    fact = repo_root / FACT_REL
    if not fact.exists():
        print(f"ERROR: R1: fact source {FACT_REL} is missing")
        return 1
    try:
        data = loader.load(fact)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: R1: fact source {FACT_REL} is unreadable: {exc}")
        return 1

    errors = []
    errors += rule_authority(loader, data)
    errors += rule_two_state(loader, data)
    errors += rule_no_upstream(loader, data, repo_root)
    errors += rule_codegen(data, repo_root)
    errors += rule_version_line(data, repo_root)

    if errors:
        for item in errors:
            print(f"ERROR: {item}")
        return 1

    print(
        "Release channel consistency check passed "
        f"(R1-R5 over {len(CHANNEL_FILES)} channel files)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
