#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Guard CoPaw's release-channel fact source against its consumers.

Six rules (design §8):

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
* R6 readers     -- ``[project] name`` and every registered reader of the
                    installed distribution move in the same commit, and the
                    registry is the whole table: a read point that is not
                    registered is itself a red.

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
from typing import Optional

from packaging.version import InvalidVersion, Version

sys.path.insert(0, str(Path(__file__).resolve().parent))
# pylint: disable=wrong-import-position
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

PYPROJECT_REL = "pyproject.toml"
# The name upstream ships under.  Our channel may only be opened once the
# declaration equals ``pypi_project``, so this is the single other name R6
# tolerates -- ``copaw`` itself is upstream's pre-rename package on PyPI.
PRE_RENAME_DECLARATION = "qwenpaw"

# Every place that reads the installed distribution *by name* (not the import
# package ``qwenpaw``, which stays).  ``{distribution}`` is the declared name.
DISTRIBUTION_READERS = (
    (PYPROJECT_REL, 'name = "{distribution}"'),
    ("src/qwenpaw/cli/update_cmd.py", "pypi.org/pypi/{distribution}/json"),
    (
        "src/qwenpaw/cli/update_cmd.py",
        'metadata.distribution("{distribution}")',
    ),
    ("src/qwenpaw/cli/update_cmd.py", '"{distribution}=={'),
    ("scripts/pack/build_common.py", "{distribution}-*.whl"),
    ("scripts/pack/build_macos.sh", "dist/{distribution}-"),
    ("scripts/pack/build_macos.sh", "version('{distribution}')"),
    ("scripts/pack/build_win.ps1", "{distribution}-$CurrentVersion"),
    ("scripts/pack/build_win.ps1", "{distribution}-*.whl"),
    ("scripts/pack/build_win.ps1", "version('{distribution}')"),
)

# Shapes that mean "this code keys on a distribution name".  A hit on one of
# our tracked names must appear in DISTRIBUTION_READERS.
READER_PATTERNS = (
    re.compile(r"metadata\.distribution\(\s*[\"']([\w.\-]+)[\"']"),
    re.compile(r"version\(\s*['\"]([\w.\-]+)['\"]\s*\)"),
    re.compile(r"pypi\.org/pypi/([\w.\-]+)/json"),
    re.compile(r"['\"]([\w.\-]+)==\{"),
)

# A wheel filename is ``name-<version>-…whl``, and the version segment holds
# ``$CurrentVersion``/``${V}``, quotes and globs.  Letting the name group be
# any token loses to a wider prefix on the same line: in the PowerShell build
# script, a ``Join-Path`` of a distribution name and a wheel glob matched
# starting at ``Join``, consumed the whole tail, and swallowed the read point
# underneath it.  So the name side is anchored to the identities we track.
# (Writing the offending literal here would make this file a read point itself.)
WHEEL_TAIL_RE = r"-[\w$ {}.\-*\"']{0,40}\.whl"


def wheel_reader_pattern(names):
    alternation = "|".join(
        re.escape(name) for name in sorted(names, key=len, reverse=True)
    )
    return re.compile(rf"(?<![\w.\-])({alternation}){WHEEL_TAIL_RE}")


READER_DIRS = ("src", "scripts", "plugins", "deploy", ".github/workflows")
READER_SUFFIXES = (".py", ".sh", ".ps1", ".bat", ".yml", ".spec", ".nsi")
PROJECT_NAME_RE = re.compile(r'^name\s*=\s*"([^"]+)"', re.MULTILINE)


def _project_section(text: str) -> str:
    """Return the ``[project]`` table, up to the next table header."""
    marker = "\n[project]\n"
    start = ("\n" + text).find(marker)
    if start < 0:
        return ""
    rest = text[start:]
    nxt = rest.find("\n[", len(marker) - 1)
    return rest if nxt < 0 else rest[:nxt]


def declared_distribution(repo_root: Path) -> Optional[str]:
    """``[project] name`` -- the identity the wheel is built under."""
    path = repo_root / PYPROJECT_REL
    if not path.exists():
        return None
    match = PROJECT_NAME_RE.search(
        _project_section(path.read_text(encoding="utf-8")),
    )
    return match.group(1) if match else None


def _tracked_names(repo_root: Path) -> set:
    """Identities R6 watches: the declaration plus both fact-source names."""
    names = set()
    declared = declared_distribution(repo_root)
    if declared:
        names.add(declared)
    fact = repo_root / FACT_REL
    if not fact.exists():
        return names
    try:
        data = json.loads(fact.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return names
    for key in ("pypi_project", "distribution"):
        value = data.get(key)
        if isinstance(value, str) and value:
            names.add(value)
    return names


def scan_distribution_readers(repo_root: Path):
    """``(rel, description)`` for every code read point naming our identities.

    The declaration counts as a read point too, so the file carrying the name
    has to be in the registry -- R6 compares this scan against
    ``DISTRIBUTION_READERS`` instead of trusting someone to remember the list.
    """
    tracked = _tracked_names(repo_root)
    declared = declared_distribution(repo_root)
    hits = []
    if declared is None:
        return hits
    patterns = READER_PATTERNS + (wheel_reader_pattern(tracked),)
    hits.append((PYPROJECT_REL, f"declares name = {declared!r}"))
    for rel_dir in READER_DIRS:
        base = repo_root / rel_dir
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file() or path.suffix not in READER_SUFFIXES:
                continue
            text = path.read_text(encoding="utf-8", errors="ignore")
            for pattern in patterns:
                for match in pattern.finditer(text):
                    if match.group(1) not in tracked:
                        continue
                    lineno = text[: match.start()].count("\n") + 1
                    hits.append(
                        (
                            str(path.relative_to(repo_root)),
                            f"line {lineno}: {match.group(0).strip()!r}",
                        ),
                    )
    return hits


def rule_distribution(loader, data, repo_root):
    errors = []
    declared = declared_distribution(repo_root)
    if declared is None:
        return [
            (
                f"R6: {PYPROJECT_REL} has no [project] name to check readers "
                "against"
            ),
        ]
    if loader.is_ready(data, "pypi"):
        if declared != data["pypi_project"]:
            errors.append(
                (
                    "R6: the pypi channel is no longer pending but"
                    f" {PYPROJECT_REL} declares {declared!r} instead of the"
                    f" fact source's {data['pypi_project']!r}"
                ),
            )
    elif declared not in (data["pypi_project"], PRE_RENAME_DECLARATION):
        errors.append(
            (
                f"R6: {PYPROJECT_REL} declares {declared!r} while the pypi "
                "channel is pending; only the fact source's "
                f"{data['pypi_project']!r} or the pre-rename "
                f"{PRE_RENAME_DECLARATION!r} may be declared"
            ),
        )

    registered = {rel for rel, _ in DISTRIBUTION_READERS}
    for rel, template in DISTRIBUTION_READERS:
        path = repo_root / rel
        if not path.exists():
            errors.append(f"R6: registered reader {rel} is missing")
            continue
        literal = template.replace("{distribution}", declared)
        if literal not in path.read_text(encoding="utf-8"):
            errors.append(
                (
                    f"R6: {rel} no longer reads {literal!r}; the distribution "
                    f"name moves in one commit with {PYPROJECT_REL}"
                ),
            )
    for rel, description in scan_distribution_readers(repo_root):
        if rel not in registered:
            errors.append(
                (
                    f"R6: {rel} {description} reads a distribution name but is"
                    " not registered in DISTRIBUTION_READERS"
                ),
            )
    return errors


def _load_loader(repo_root: Path):
    spec = importlib.util.spec_from_file_location(
        "_rc_consistency_loader",
        repo_root / LOADER_REL,
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
            (
                f"R1: pending names unknown channels {unknown}; "
                f"declared channels are {list(loader.CHANNELS)}"
            ),
        )
    for key in ("distribution", "pypi_project"):
        value = data.get(key)
        if not isinstance(value, str) or not value:
            errors.append(
                (
                    f"R1: {key} must name our own distribution even while its "
                    "channel is still pending"
                ),
            )
    return errors


def rule_two_state(loader, data):
    errors = []
    for channel, field in loader.ADDRESS_FIELDS.items():
        ready = loader.is_ready(data, channel)
        value = data.get(field)
        if ready and not value:
            errors.append(
                f"R2: {channel} is not pending but {field} is empty",
            )
        if not ready and value is not None:
            errors.append(
                f"R2: {channel} is pending but {field} = {value!r}",
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
        (repo_root / ".github/workflows").glob(FORK_WORKFLOW_GLOB),
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
                    f"R3: {rel} names the upstream identity {marker!r}",
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
            (
                f"R4: {rel} is stale; re-run "
                "scripts/release_channel.py --write-ts"
            ),
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
            (
                f"R5: {VERSION_REL} reports {number!r} (upstream part"
                f" {base!r}) but the fact source says"
                f" upstream_version={data['upstream_version']!r}"
            ),
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
    errors += rule_distribution(loader, data, repo_root)

    if errors:
        for item in errors:
            print(f"ERROR: {item}")
        return 1

    hits = scan_distribution_readers(repo_root)
    read_points = sum(
        1 for _, description in hits if description.startswith("line ")
    )
    print(
        (
            "Release channel consistency check passed "
            f"(R1-R6 over {len(CHANNEL_FILES)} channel files; "
            f"{len(DISTRIBUTION_READERS)} registered templates, "
            f"{read_points} read points swept in "
            f"{len({rel for rel, _ in hits})} files)"
        ),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
