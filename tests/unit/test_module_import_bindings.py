# -*- coding: utf-8 -*-
"""Guards against a merged module binding one name from two different sources.

A conflict-free automatic merge of a host that both sides rewrote can leave the
file larger than either parent and still be semantically wrong: the two import
blocks survive side by side, and because Python binds module-scope names in
source order, the later import silently decides which class a name refers to.
Measured on ``app/routers/agents.py``: upstream catches
``qwenpaw.exceptions.AppBaseException`` so that a missing agent answers 404;
our side caught the ``agentscope_runtime`` class of the same name, and the
merge kept both with ours last -- five ``except`` clauses began answering 500.
Nothing in the merge reported it; the upstream test did.

``import x`` together with ``import x.y`` binds ``x`` twice, but both lines
name the same root package -- that is the ordinary way to pull a submodule into
a process, so plain imports of one root count as a single source.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

REPO_ROOT = Path(__file__).resolve().parents[2]

#: Retired by a knife, so a fixed entry must be deleted from this table.
#: Both names this table ever carried were retired by knife 114 and knife 115:
#: ``get_workspace_skills_dir`` because the fork's and upstream's copies proved
#: source-identical, and ``SkillPoolService`` because the product ruled that an
#: upstream-owned router runs upstream's implementation (see
#: ``RULED_IMPORT_BINDINGS``, which now guards that choice in one direction).
KNOWN_SHADOWED_IMPORTS: dict[tuple[str, str], str] = {}


def _source_key(node: ast.Import | ast.ImportFrom, alias) -> str:
    if isinstance(node, ast.Import):
        return f"pkg:{alias.name.split('.')[0]}"
    return f"mod:{'.' * node.level}{node.module or ''}"


def _module_scope_bindings(path: Path) -> dict[str, list[str]]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    bindings: dict[str, list[str]] = {}
    for node in tree.body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                name = alias.asname or alias.name.split(".")[0]
                bindings.setdefault(name, []).append(
                    _source_key(node, alias),
                )
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name == "*":
                    continue
                name = alias.asname or alias.name
                bindings.setdefault(name, []).append(_source_key(node, alias))
    return bindings


def _conflicting(bindings: dict[str, list[str]]) -> list[str]:
    return [
        f"{name} bound from {sorted(set(sources))}"
        for name, sources in bindings.items()
        if len(set(sources)) > 1
    ]


def _scan() -> set[tuple[str, str]]:
    found = set()
    for path in sorted((REPO_ROOT / "src").rglob("*.py")):
        conflicts = _conflicting(_module_scope_bindings(path))
        for conflict in conflicts:
            name = conflict.split(" bound from", 1)[0]
            found.add((str(path.relative_to(REPO_ROOT)), name))
    return found


def test_no_new_shadowed_module_import() -> None:
    found = _scan()
    new = sorted(found - set(KNOWN_SHADOWED_IMPORTS))
    assert not new, (
        "a module-scope import name is bound from two unrelated sources, so "
        "whichever import line comes last silently wins; delete one of them "
        f"or list the pair in KNOWN_SHADOWED_IMPORTS: {new}"
    )


def test_retired_shadowed_imports_are_removed_from_the_table() -> None:
    found = _scan()
    stale = sorted(set(KNOWN_SHADOWED_IMPORTS) - found)
    assert not stale, f"no longer shadowed, delete the exemption: {stale}"


def test_detector_reports_a_shadowed_import(tmp_path: Path) -> None:
    host = tmp_path / "host.py"
    host.write_text(
        "from pkg.a import Name\nfrom pkg.b import Name\n",
        encoding="utf-8",
    )
    assert _conflicting(_module_scope_bindings(host)) == [
        "Name bound from ['mod:pkg.a', 'mod:pkg.b']",
    ]


def test_detector_accepts_a_submodule_import(tmp_path: Path) -> None:
    host = tmp_path / "host.py"
    host.write_text(
        "import aiofiles\nimport aiofiles.os\n",
        encoding="utf-8",
    )
    assert _conflicting(_module_scope_bindings(host)) == []


#: Names whose owning implementation the product has ruled on, mapped to the
#: module the survivor must come from.  A shadow-table entry says "two bindings
#: exist, unresolved"; this says "one binding, and this side won".  A future
#: automatic merge that re-adds the losing import line fails here, because
#: module-scope binding order decides the implementation silently.
RULED_IMPORT_BINDINGS: dict[tuple[str, str], str] = {
    (
        "qwenpaw.app.routers.agents",
        "SkillPoolService",
    ): "qwenpaw.agents.skill_system.pool_service",
}


def test_ruled_import_bindings_hold() -> None:
    import importlib

    for (module_name, attr), owner in sorted(RULED_IMPORT_BINDINGS.items()):
        module = importlib.import_module(module_name)
        bound = getattr(module, attr)
        assert bound.__module__ == owner, (
            f"{module_name}.{attr} is bound from {bound.__module__}, "
            f"but the ruling says it must come from {owner}"
        )
