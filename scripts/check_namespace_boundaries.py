#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Check namespace boundaries between copaw and qwenpaw.

Rules:
1) Shared-path ownership should stay in qwenpaw; copaw should be a thin shim.
2) qwenpaw should not reverse-import copaw for shared modules.
3) copaw-only modules should stay within approved extension prefixes.

Optional:
- Compare current boundary metrics against an upstream git ref.

Usage:
    python scripts/check_namespace_boundaries.py
    python scripts/check_namespace_boundaries.py --upstream-ref agentscope-ai/main
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC_COPAW = ROOT / "src" / "copaw"
SRC_QWENPAW = ROOT / "src" / "qwenpaw"

# qwenpaw may intentionally bridge to copaw for explicit extension-only modules.
ALLOWED_QWENPAW_TO_COPAW = {
    "knowledge/architecture.py",
    "knowledge/enrichment_pipeline.py",
    "knowledge/facades.py",
    "knowledge/graphify_provider.py",
    "knowledge/local_graph_provider.py",
}

# Shared files intentionally kept non-thin for runtime branding bridge or
# extension ownership in copaw.
ALLOWED_NON_THIN_SHARED = {
    "__init__.py",
    "app/_app.py",
    "knowledge/__init__.py",
    "knowledge/architecture.py",
    "knowledge/enrichment_pipeline.py",
    "knowledge/facades.py",
    "knowledge/graphify_provider.py",
    "knowledge/local_graph_provider.py",
}

# copaw-only files should remain under extension areas (prefix match).
ALLOWED_COPAW_ONLY_PREFIXES = (
    "knowledge/",
    "app/flow_engine/",
)

# Keep these as explicit file-level exceptions to avoid broad app/router
# namespace expansion while preserving current extension ownership.
ALLOWED_COPAW_ONLY_FILES = {
    "app/routers/knowledge_hanlp_tasks.py",
    "app/routers/knowledge_siamese_tasks.py",
}

QWENPAW_TO_COPAW_IMPORT_RE = re.compile(r"^\s*from\s+copaw\.[\w.]+\s+import\s+", re.M)
COPAW_TO_QWENPAW_IMPORT_RE = re.compile(
    r"^\s*(from\s+qwenpaw\.[\w.]+\s+import\s+.+|import\s+qwenpaw\.[\w.]+)(\s+#.*)?$",
    re.M,
)


def _py_files(base: Path) -> set[str]:
    return {
        p.relative_to(base).as_posix()
        for p in base.rglob("*.py")
        if "__pycache__" not in p.parts
    }


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return ""


def _is_thin_copaw_shim(content: str) -> bool:
    lines = [ln.strip() for ln in content.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    if not lines:
        return False
    if QWENPAW_TO_COPAW_IMPORT_RE.search(content):
        return False

    import_lines = [ln for ln in lines if ln.startswith("from ") or ln.startswith("import ")]
    non_import_lines = [ln for ln in lines if ln not in import_lines]

    if not import_lines:
        return False
    if any(not COPAW_TO_QWENPAW_IMPORT_RE.match(ln) for ln in import_lines):
        return False

    # Allow a tiny amount of local compatibility glue (for example alias helper).
    return len(lines) <= 40 and len(non_import_lines) <= 8


def _git_list_py(ref: str, prefix: str) -> set[str]:
    out = subprocess.check_output(
        ["git", "ls-tree", "-r", "--name-only", ref, prefix],
        cwd=ROOT,
        text=True,
    )
    rels: set[str] = set()
    for line in out.splitlines():
        path = line.strip()
        if not path.endswith(".py"):
            continue
        if path.startswith(prefix + "/"):
            rels.add(path[len(prefix) + 1 :])
    return rels


def _git_show_text(ref: str, path: str) -> str:
    try:
        return subprocess.check_output(
            ["git", "show", f"{ref}:{path}"],
            cwd=ROOT,
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return ""


def compute_local_report() -> dict:
    copaw_files = _py_files(SRC_COPAW)
    qwenpaw_files = _py_files(SRC_QWENPAW)

    shared = sorted(copaw_files & qwenpaw_files)
    copaw_only = sorted(copaw_files - qwenpaw_files)

    reverse_imports: list[str] = []
    non_thin_shared: list[str] = []
    non_extension_copaw_only: list[str] = []

    for rel in shared:
        c_path = SRC_COPAW / rel
        q_path = SRC_QWENPAW / rel
        c_text = _read(c_path)
        q_text = _read(q_path)

        if QWENPAW_TO_COPAW_IMPORT_RE.search(q_text) and rel not in ALLOWED_QWENPAW_TO_COPAW:
            reverse_imports.append(rel)

        if rel in ALLOWED_NON_THIN_SHARED:
            continue
        if c_text != q_text and not _is_thin_copaw_shim(c_text):
            non_thin_shared.append(rel)

    for rel in copaw_only:
        if rel in ALLOWED_COPAW_ONLY_FILES:
            continue
        if not rel.startswith(ALLOWED_COPAW_ONLY_PREFIXES):
            non_extension_copaw_only.append(rel)

    return {
        "shared_count": len(shared),
        "copaw_only_count": len(copaw_only),
        "reverse_imports": sorted(reverse_imports),
        "non_thin_shared": sorted(non_thin_shared),
        "non_extension_copaw_only": sorted(non_extension_copaw_only),
    }


def compute_ref_report(ref: str) -> dict | None:
    try:
        copaw_files = _git_list_py(ref, "src/copaw")
        qwenpaw_files = _git_list_py(ref, "src/qwenpaw")
    except Exception:
        return None

    shared = sorted(copaw_files & qwenpaw_files)
    copaw_only = sorted(copaw_files - qwenpaw_files)

    reverse_imports: list[str] = []
    non_thin_shared: list[str] = []
    non_extension_copaw_only: list[str] = []

    for rel in shared:
        c_text = _git_show_text(ref, f"src/copaw/{rel}")
        q_text = _git_show_text(ref, f"src/qwenpaw/{rel}")

        if QWENPAW_TO_COPAW_IMPORT_RE.search(q_text) and rel not in ALLOWED_QWENPAW_TO_COPAW:
            reverse_imports.append(rel)

        if rel in ALLOWED_NON_THIN_SHARED:
            continue
        if c_text != q_text and not _is_thin_copaw_shim(c_text):
            non_thin_shared.append(rel)

    for rel in copaw_only:
        if rel in ALLOWED_COPAW_ONLY_FILES:
            continue
        if not rel.startswith(ALLOWED_COPAW_ONLY_PREFIXES):
            non_extension_copaw_only.append(rel)

    return {
        "shared_count": len(shared),
        "copaw_only_count": len(copaw_only),
        "reverse_imports": sorted(reverse_imports),
        "non_thin_shared": sorted(non_thin_shared),
        "non_extension_copaw_only": sorted(non_extension_copaw_only),
    }


def _print_report(title: str, report: dict) -> None:
    print(f"\n== {title} ==")
    print(f"shared_count: {report['shared_count']}")
    print(f"copaw_only_count: {report['copaw_only_count']}")
    print(f"reverse_imports: {len(report['reverse_imports'])}")
    for item in report["reverse_imports"]:
        print(f"  - {item}")
    print(f"non_thin_shared: {len(report['non_thin_shared'])}")
    for item in report["non_thin_shared"]:
        print(f"  - {item}")
    print(f"non_extension_copaw_only: {len(report['non_extension_copaw_only'])}")
    for item in report["non_extension_copaw_only"]:
        print(f"  - {item}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Check copaw/qwenpaw namespace boundaries.")
    parser.add_argument(
        "--upstream-ref",
        default="",
        help="Optional git ref for baseline comparison, for example agentscope-ai/main.",
    )
    args = parser.parse_args()

    current = compute_local_report()
    _print_report("current", current)

    baseline = None
    if args.upstream_ref.strip():
        baseline = compute_ref_report(args.upstream_ref.strip())
        if baseline is None:
            print(f"\nwarning: failed to read baseline ref {args.upstream_ref!r}")
        else:
            _print_report(f"baseline:{args.upstream_ref}", baseline)
            print("\n== delta(current - baseline) ==")
            print(
                "reverse_imports_delta:",
                len(current["reverse_imports"]) - len(baseline["reverse_imports"]),
            )
            print(
                "non_thin_shared_delta:",
                len(current["non_thin_shared"]) - len(baseline["non_thin_shared"]),
            )
            print(
                "non_extension_copaw_only_delta:",
                len(current["non_extension_copaw_only"]) - len(baseline["non_extension_copaw_only"]),
            )

    failed = bool(
        current["reverse_imports"]
        or current["non_thin_shared"]
        or current["non_extension_copaw_only"]
    )
    if failed:
        print("\nresult: FAILED")
        return 1

    print("\nresult: PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
