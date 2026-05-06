#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path


PREFIX_MARKER = "-workspace--"


def iter_prefixed_project_workspace_files(root: Path):
    yield from root.glob("*/.knowledge/project-*-workspace--*")


def rename_prefixed_files(root: Path, *, dry_run: bool) -> tuple[int, int]:
    renamed = 0
    removed = 0
    for path in sorted(iter_prefixed_project_workspace_files(root)):
        prefix, _, suffix = path.name.partition(PREFIX_MARKER)
        if not suffix or not prefix.startswith("project-"):
            continue
        target = path.with_name(suffix)
        if dry_run:
            action = "remove" if target.exists() else "rename"
            print(f"[{action}] {path} -> {target}")
            if action == "remove":
                removed += 1
            else:
                renamed += 1
            continue
        if target.exists():
            path.unlink()
            removed += 1
            print(f"[remove] {path}")
            continue
        path.rename(target)
        renamed += 1
        print(f"[rename] {path} -> {target}")
    return renamed, removed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Rename legacy project workspace knowledge files to unprefixed names.",
    )
    parser.add_argument(
        "root",
        nargs="?",
        default="/Users/futuremeng/.copaw/workspaces/default/projects",
        help="Projects root to scan. Default: %(default)s",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned renames without modifying files.",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    root = Path(args.root).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        parser.error(f"projects root not found: {root}")
    renamed, removed = rename_prefixed_files(root, dry_run=args.dry_run)
    mode = "dry-run" if args.dry_run else "done"
    print(f"[{mode}] renamed={renamed} removed={removed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())