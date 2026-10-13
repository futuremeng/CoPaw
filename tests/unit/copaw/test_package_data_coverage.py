# -*- coding: utf-8 -*-
"""Every tracked data file must be declared in the wheel that ships it.

The suite runs against an editable install, where a data file is read
straight from the source tree: an undeclared file stays green there and
simply vanishes from the built artifact.  That is exactly how a wheel with
no ``app/pipelines`` document got as far as an install before its backend
died on import.
"""

from __future__ import annotations

import fnmatch
import subprocess
import tomllib
from pathlib import Path, PurePosixPath

REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGES = ("qwenpaw", "copaw")


def _package_data_globs() -> dict[str, tuple[str, ...]]:
    with (REPO_ROOT / "pyproject.toml").open("rb") as handle:
        data = tomllib.load(handle)
    table = data["tool"]["setuptools"]["package-data"]
    return {
        package: tuple(table.get(package, ())) for package in PACKAGES
    }


def _match(pattern: tuple[str, ...], path: tuple[str, ...]) -> bool:
    """Segment-wise glob match, so ``*`` never crosses a directory."""
    if not pattern:
        return not path
    head, rest = pattern[0], pattern[1:]
    if head == "**":
        return any(_match(rest, path[skip:]) for skip in range(len(path) + 1))
    if not path:
        return False
    return fnmatch.fnmatchcase(path[0], head) and _match(rest, path[1:])


def _matches(glob: str, relative: str) -> bool:
    return _match(PurePosixPath(glob).parts, PurePosixPath(relative).parts)


def _tracked_data_files(package: str) -> list[str]:
    listed = subprocess.run(
        ["git", "ls-files", "-z", f"src/{package}"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
    )
    files = []
    for raw in listed.stdout.split(b"\0"):
        if not raw:
            continue
        path = Path(raw.decode())
        if path.suffix not in {".py", ".pyc"}:
            files.append(str(path.relative_to(f"src/{package}")))
    return files


def _uncovered(globs: dict[str, tuple[str, ...]]) -> list[str]:
    offenders: list[str] = []
    for package in PACKAGES:
        declared = globs[package]
        for relative in _tracked_data_files(package):
            if not any(_matches(each, relative) for each in declared):
                offenders.append(f"src/{package}/{relative}")
    return sorted(offenders)


def test_the_glob_matcher_keeps_setuptools_meaning() -> None:
    assert _matches("agents/md_files/**", "agents/md_files/x/en/SOUL.md")
    assert _matches("console/**", "console/assets/index-abc.js")
    assert _matches("skills_market/*.json", "skills_market/default.json")
    assert _matches("docs/*.md", "docs/README.md")
    assert not _matches("docs/*.md", "docs/nested/README.md")
    assert not _matches("console/**", "console2/index.html")
    assert not _matches("agents/md_files/**", "agents/other/SOUL.md")


def test_every_tracked_data_file_is_declared_as_package_data() -> None:
    """A file git ships must be a file the wheel ships.

    ``app/pipelines/builtin-knowledge-processing-v1.json`` is read at
    import time by ``qwenpaw.app.knowledge_workflow_steps``, which raises
    ``RuntimeError`` when it is absent, so an undeclared copy leaves the
    installed backend unstartable.
    """
    offenders = _uncovered(_package_data_globs())
    assert not offenders, "undeclared: " + ", ".join(offenders)
