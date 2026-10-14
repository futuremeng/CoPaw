#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Guard CoPaw's release-channel fact source against its consumers.

Seven rules (design §8):

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
* R7 dependency  -- no requirement declared for the distribution itself names
                    the retired identity while the declaration reads our own
                    name; such a string was a self-reference before the
                    rename and is a dependency on the upstream distribution
                    after it.
* R8 requirement -- every requirement-shaped reference (a watched name plus
                    extras, a ``==`` pin or a `` @ url``) is registered with the
                    reason it exists, an ``install`` site names the distribution
                    we actually declare, and both the registry and the sweep
                    only see files a fresh clone contains.

Usage:
    python scripts/check_release_channel_consistency.py
    python scripts/check_release_channel_consistency.py --repo-root DIR
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Optional

from packaging.requirements import InvalidRequirement, Requirement
from packaging.utils import canonicalize_name
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

# A registered reader is written in one of two spellings of the same name.
# ``importlib.metadata``, pip and the PyPI JSON endpoint are normalization
# insensitive and take the declared form; a *file name* does not: PEP 427
# collapses ``[-_.]+`` to ``_`` when the wheel and its ``.dist-info`` are
# named, so ``copaw-community`` ships as ``copaw_community-<ver>-*.whl``.
# Substituting the declared spelling into the file-name points would make the
# gate demand a filename the build can never produce.
WHEEL_NAME_PLACEHOLDER = "{wheel_name}"


def wheel_name(declared: str) -> str:
    return re.sub(r"[-_.]+", "_", declared)


def reader_literal(template: str, declared: str) -> str:
    """The exact text the registered line must contain."""
    return template.replace("{distribution}", declared).replace(
        WHEEL_NAME_PLACEHOLDER,
        wheel_name(declared),
    )


# Every place that reads the installed distribution *by name* (not the import
# package ``qwenpaw``, which stays).  ``{distribution}`` is the declared name,
# ``{wheel_name}`` its PEP 427 file-name form.
DISTRIBUTION_READERS = (
    (PYPROJECT_REL, 'name = "{distribution}"'),
    ("src/qwenpaw/cli/update_cmd.py", "pypi.org/pypi/{distribution}/json"),
    (
        "src/qwenpaw/cli/update_cmd.py",
        'metadata.distribution("{distribution}")',
    ),
    ("src/qwenpaw/cli/update_cmd.py", '"{distribution}=={'),
    ("scripts/pack/build_common.py", "{wheel_name}-*.whl"),
    ("scripts/pack/build_macos.sh", "dist/{wheel_name}-"),
    ("scripts/pack/build_macos.sh", "version('{distribution}')"),
    ("scripts/pack/build_win.ps1", "{wheel_name}-$CurrentVersion"),
    ("scripts/pack/build_win.ps1", "{wheel_name}-*.whl"),
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


def tracked_paths(repo_root: Path):
    """Paths git would hand a fresh clone, or ``None`` outside a checkout.

    Both registries are built by scanning on this machine, and this machine
    contains files git was told to ignore -- ``src/qwenpaw/docs/`` is one such
    directory (``.gitignore``).  A registry that names one of them reads green
    here and red in CI, where the file does not exist; the sweep therefore has
    to enumerate the same set a clone does.

    Unit fixtures copy the registry into a temp directory with no git index, so
    ``None`` means "trust the filesystem": there is nothing else to consult.
    """
    result = subprocess.run(
        ("git", "ls-files", "-z"),
        cwd=repo_root,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        return None
    return {path.decode("utf-8") for path in result.stdout.split(b"\0") if path}


def _tracked_names(repo_root: Path) -> set:
    """Identities R6 watches: the declaration, both fact-source names, and the
    name we moved off.

    Each identity is watched in both spellings, because a wheel glob in a
    build script is written in the file-name form and would otherwise sweep as
    an unknown token.

    ``qwenpaw`` is no longer any identity of ours, but it is the one an
    upstream merge resurrects, and it comes back in files the registry has
    never seen; dropping it here would sweep such a read point as unknown
    instead of reporting it.
    """
    names = {PRE_RENAME_DECLARATION}
    declared = declared_distribution(repo_root)
    if declared:
        names.add(declared)
    fact = repo_root / FACT_REL
    data = {}
    if fact.exists():
        try:
            data = json.loads(fact.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            data = {}
    for key in ("pypi_project", "distribution"):
        value = data.get(key)
        if isinstance(value, str) and value:
            names.add(value)
    return names | {wheel_name(name) for name in names}


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
    cloned = tracked_paths(repo_root)
    for rel_dir in READER_DIRS:
        base = repo_root / rel_dir
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file() or path.suffix not in READER_SUFFIXES:
                continue
            if cloned is not None and (
                str(path.relative_to(repo_root)) not in cloned
            ):
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
        literal = reader_literal(template, declared)
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


# R7's scan roots: the two TOML regions that declare requirements for this
# distribution.  Parsing stays line-based on purpose -- the gate must run on
# the same interpreter its sibling gates do, and a TOML library is not a
# declared dependency of any gate.
DEPENDENCY_TABLES = ("project", "project.optional-dependencies")
TABLE_HEAD_RE = re.compile(r"^\[([^\]]+)\]\s*$")
ARRAY_HEAD_RE = re.compile(r"^\s*([A-Za-z0-9_-]+)\s*=\s*\[\s*$")
ONE_LINE_ARRAY_RE = re.compile(r"^\s*([A-Za-z0-9_-]+)\s*=\s*\[(.*)\]\s*$")
QUOTED_RE = re.compile(r'"([^"]*)"')


def _array_opened_by(line):
    """``(key, inline_body)`` when the line opens a TOML array."""
    match = ONE_LINE_ARRAY_RE.match(line)
    if match:
        return match.group(1), _outside_strings(match.group(2))
    match = ARRAY_HEAD_RE.match(line)
    if match:
        return match.group(1), None
    return None, None


def _outside_strings(text: str) -> str:
    """``text`` with a trailing ``#`` comment removed.

    Comments sit inside these arrays (the ``dependencies`` block explains the
    ``agent-client-protocol`` upper bound and quotes the Kitty term
    "associated text"), and sweeping a comment's quoted word in as a
    requirement makes the gate red on a line pip never reads.
    """
    kept = []
    in_string = False
    for char in text:
        if char == '"':
            in_string = not in_string
        elif char == "#" and not in_string:
            break
        kept.append(char)
    return "".join(kept)


def dependency_requirements(repo_root: Path) -> Optional[list]:
    """Every requirement string declared for the distribution itself."""
    path = repo_root / PYPROJECT_REL
    if not path.exists():
        return None
    table = ""
    collecting = False
    found = []
    for line in path.read_text(encoding="utf-8").splitlines():
        header = TABLE_HEAD_RE.match(line)
        if header:
            table = header.group(1)
            collecting = False
            continue
        if collecting:
            if line.strip().startswith("]"):
                collecting = False
            else:
                found.extend(
                    QUOTED_RE.findall(_outside_strings(line)),
                )
            continue
        if table not in DEPENDENCY_TABLES:
            continue
        key, inline = _array_opened_by(line)
        if key is None:
            continue
        if table == "project" and key != "dependencies":
            continue
        if inline is None:
            collecting = True
        else:
            found.extend(QUOTED_RE.findall(inline))
    return found


def rule_dependencies(repo_root):
    declared = declared_distribution(repo_root)
    requirements = dependency_requirements(repo_root)
    if requirements is None or declared is None:
        return []  # R6 already reports an unreadable declaration
    if not requirements:
        return [
            (
                f"R7: {PYPROJECT_REL} yielded no requirement to check; the "
                "declarations moved out of the two tables R7 reads"
            ),
        ]
    if declared == PRE_RENAME_DECLARATION:
        # While we ship under the upstream name these strings are self-
        # references, and R6 has to keep replaying that state.
        return []
    errors = []
    retired = canonicalize_name(PRE_RENAME_DECLARATION)
    for raw in requirements:
        try:
            name = canonicalize_name(Requirement(raw).name)
        except InvalidRequirement:
            errors.append(
                (
                    f"R7: {PYPROJECT_REL} declares {raw!r}, which is not a "
                    "PEP 508 requirement"
                ),
            )
            continue
        if name == retired:
            errors.append(
                (
                    f"R7: {PYPROJECT_REL} requires {raw!r} while declaring "
                    f"{declared!r}; the string names the upstream "
                    "distribution, not us"
                ),
            )
    return errors


# R8 -- requirement-shaped references to one of our tracked identities,
# written anywhere in the tree.
#
# R6 watches the places that read the *installed* distribution by name and R7
# watches the declarations, but a third family carries the same coupling:
# strings shaped like a PEP 508 requirement -- ``name[extras]``, ``name==pin``,
# ``name @ url`` -- because pip/conda read those names too, and a rename
# changes what they resolve to without changing a single character.  A
# direct-URL requirement is the sharpest case: the artifact on the other side
# of the ``@`` is named by the build, so a stale literal there is refused by
# pip at the moment the desktop pack runs.
#
# The sweep therefore covers every path a requirement string can hide in, and
# each hit has to be registered below with the reason it exists.  Registering
# is cheap; the price is paid once per file instead of by a manual grep that
# nobody repeats.
REQUIREMENT_DIRS = (
    "src",
    "scripts",
    "tests",
    "plugins",
    "deploy",
    ".github",
    "console/src",
)
REQUIREMENT_SUFFIXES = READER_SUFFIXES + (".json", ".md", ".yaml")
REQUIREMENT_SKIP = frozenset({"__pycache__", "node_modules"})

# ``==`` must be followed by something, or the gate's own forbidden-name
# markers (``"qwenpaw=="``, a prefix used to *detect* the retired name) would
# read as requirements.
REQUIREMENT_TAIL = (
    r"(?:\[[^\]\n]{0,60}\]"  # extras
    r"|==[^\s\"'`]{1,40}"  # version pin
    r"| @ )"  # direct URL
)

# ``install`` -- the literal is handed to pip/conda as something to install, so
# its name must equal the distribution we actually declare and build; a
# mismatch is not a style problem, pip refuses the artifact
# (``.dist-info`` must start with the requirement's own name).
# ``copy`` -- user-visible text telling a human what to install.
# ``doc`` -- documentation and README instructions.
# ``test`` -- a test pinning or fixtureing the string.
REQUIREMENT_SITES = (
    # Handed to a package manager.
    ("src/qwenpaw/cli/update_cmd.py", "install"),
    ("scripts/pack/build_common.py", "install"),
    # User-visible copy that names an extra to install.
    ("src/qwenpaw/harnesses/base.py", "copy"),
    ("src/qwenpaw/harnesses/codex/adapter.py", "copy"),
    ("src/qwenpaw/cli/hub_cmd.py", "copy"),
    ("src/qwenpaw/cli/providers_cmd.py", "copy"),
    ("src/qwenpaw/hub/docker_provisioner.py", "copy"),
    ("plugins/apps/qwenpaw-data/plugin.json", "copy"),
    ("console/src/locales/en.json", "copy"),
    ("console/src/locales/zh.json", "copy"),
    ("console/src/locales/ja.json", "copy"),
    ("console/src/locales/ru.json", "copy"),
    ("console/src/locales/vi.json", "copy"),
    ("console/src/locales/id.json", "copy"),
    ("console/src/locales/pt-BR.json", "copy"),
    (".github/workflows/release-duty.yml", "copy"),
    # Documentation.  ``src/qwenpaw/docs/*.md`` is deliberately absent: that
    # whole directory is gitignored, so the requirement strings living in it
    # exist only on the machine that built them and no clone can be checked
    # against them.
    ("scripts/pack/README.md", "doc"),
    ("scripts/pack/README_zh.md", "doc"),
    ("plugins/apps/qwenpaw-data/README.md", "doc"),
    ("plugins/apps/qwenpaw-data/README_ZH.md", "doc"),
    # Tests that pin the string or build a fixture out of it.
    ("tests/unit/app/routers/test_harnesses_router.py", "test"),
    ("tests/unit/cli/test_cli_update_overlay.py", "test"),
    ("tests/unit/cli/test_hub_cmd.py", "test"),
    ("tests/unit/harnesses/test_codex_adapter.py", "test"),
    (
        "tests/unit/harnesses/test_optional_dependencies.py",
        "test",
    ),
    ("tests/unit/scripts/test_check_release_channel_consistency.py", "test"),
)


def requirement_pattern(names):
    alternation = "|".join(
        re.escape(name) for name in sorted(names, key=len, reverse=True)
    )
    return re.compile(rf"(?<![\w.\-])({alternation}){REQUIREMENT_TAIL}")


def _requirement_files(repo_root: Path):
    cloned = tracked_paths(repo_root)
    for rel_dir in REQUIREMENT_DIRS:
        base = repo_root / rel_dir
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*")):
            if not path.is_file() or path.suffix not in REQUIREMENT_SUFFIXES:
                continue
            rel = str(path.relative_to(repo_root))
            if cloned is not None and rel not in cloned:
                continue
            if REQUIREMENT_SKIP & set(path.relative_to(repo_root).parts):
                continue
            yield rel, path


def scan_requirement_names(repo_root: Path) -> dict:
    """``rel -> {names}`` for every requirement-shaped reference.

    A dict rather than a list because the rule needs both directions: files the
    sweep found that are not registered, and files registered that the sweep
    no longer finds.
    """
    pattern = requirement_pattern(_tracked_names(repo_root))
    found: dict = {}
    for rel, path in _requirement_files(repo_root):
        text = path.read_text(encoding="utf-8", errors="ignore")
        names = {match.group(1) for match in pattern.finditer(text)}
        if names:
            found[rel] = names
    return found


def rule_requirement_sites(repo_root):
    errors = []
    declared = declared_distribution(repo_root)
    if declared is None:
        return [
            (
                f"R8: {PYPROJECT_REL} has no [project] name to check "
                "requirement sites against"
            ),
        ]
    registered = dict(REQUIREMENT_SITES)
    allowed = {declared, wheel_name(declared)}
    found = scan_requirement_names(repo_root)
    cloned = tracked_paths(repo_root)
    for rel in sorted(set(found) | set(registered)):
        category = registered.get(rel)
        if category is None:
            errors.append(
                (
                    f"R8: {rel} requires "
                    f"{sorted(found[rel])} but is not registered in "
                    "REQUIREMENT_SITES"
                ),
            )
            continue
        if cloned is not None and rel not in cloned:
            errors.append(
                (
                    f"R8: registered requirement site {rel} is not tracked by "
                    "git; the sweep only sees what a fresh clone contains, so "
                    "this entry reads green here and red in CI"
                ),
            )
            continue
        names = found.get(rel)
        if not names:
            path = repo_root / rel
            if not path.exists():
                errors.append(f"R8: registered requirement site {rel} is gone")
                continue
            errors.append(
                (
                    f"R8: {rel} is registered as {category!r} but no longer "
                    "carries a requirement-shaped distribution name; the "
                    "literal moved, was reworded, or the scan root changed"
                ),
            )
            continue
        if category == "install":
            for name in sorted(names - allowed):
                errors.append(
                    (
                        f"R8: {rel} hands {name!r} to a package manager while "
                        f"{PYPROJECT_REL} declares {declared!r}; pip refuses a "
                        "requirement whose name does not match the artifact's "
                        ".dist-info"
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
    errors += rule_dependencies(repo_root)
    errors += rule_requirement_sites(repo_root)

    if errors:
        for item in errors:
            print(f"ERROR: {item}")
        return 1

    hits = scan_distribution_readers(repo_root)
    sites = scan_requirement_names(repo_root)
    read_points = sum(
        1 for _, description in hits if description.startswith("line ")
    )
    print(
        (
            "Release channel consistency check passed "
            f"(R1-R8 over {len(CHANNEL_FILES)} channel files; "
            f"{len(DISTRIBUTION_READERS)} registered templates, "
            f"{read_points} read points swept in "
            f"{len({rel for rel, _ in hits})} files; "
            f"{len(REQUIREMENT_SITES)} registered requirement sites, "
            f"{sum(len(names) for names in sites.values())} names in "
            f"{len(sites)} files swept)"
        ),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
