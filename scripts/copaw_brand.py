#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Export, replay and verify the P1-命名 ledger (the Copaw brand renames).

D-15 admits that the fork renames upstream text to ``Copaw`` and that this is a
permanent tax paid on every upstream sync.  This tool turns that tax into one
command instead of hand-retyping 126 lines.

Commands:
    python scripts/copaw_brand.py export [--target-ref REF]   # write the ledger
    python scripts/copaw_brand.py apply                        # replay onto worktree
    python scripts/copaw_brand.py strip                        # undo the renames
    python scripts/copaw_brand.py verify                       # strip+apply == original
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from check_p1_invariants import DEFAULT_BASE_REF, rename_pairs_by_path  # noqa: E402

DEFAULT_LEDGER = "scripts/copaw_brand.json"
DEFAULT_TARGET_REF = "v1-fork-final-2026-09-29"


def _load_ledger(path: Path) -> list[dict]:
    return json.loads(path.read_text())["entries"]


def _apply_pairs(
    lines: list[str],
    pairs: list[dict],
    *,
    forward: bool,
) -> tuple[list[str], int, int]:
    """Replace ``old``->``new`` (forward) or ``new``->``old`` (reverse)."""
    out = list(lines)
    done = 0
    missing = 0
    for pair in pairs:
        src = pair["new"] if not forward else pair["old"]
        dst = pair["old"] if not forward else pair["new"]
        if src == dst:
            continue
        for i, line in enumerate(out):
            if line.rstrip("\n") == src:
                out[i] = dst + "\n" if line.endswith("\n") else dst
                done += 1
                break
        else:
            missing += 1
    return out, done, missing


def cmd_export(args: argparse.Namespace) -> int:
    target = None if args.target_ref == "working" else args.target_ref
    pairs = rename_pairs_by_path(args.base_ref, target)
    entries = [
        {
            "path": path,
            "pairs": [{"old": old, "new": new} for old, new in pairs[path]],
        }
        for path in sorted(pairs)
    ]
    payload = {
        "base_ref": args.base_ref,
        "source_ref": args.target_ref,
        "files": len(entries),
        "lines": sum(len(e["pairs"]) for e in entries),
        "entries": entries,
    }
    Path(args.ledger).write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
    )
    print(
        f"wrote {args.ledger}: {payload['files']} files / "
        f"{payload['lines']} rename lines",
    )
    return 0


def _rewrite(args: argparse.Namespace, *, forward: bool) -> int:
    total_done = 0
    total_missing = 0
    for entry in _load_ledger(Path(args.ledger)):
        path = Path(entry["path"])
        if not path.exists():
            print(f"::error::{path} missing", file=sys.stderr)
            total_missing += len(entry["pairs"])
            continue
        lines = path.read_text().splitlines(keepends=True)
        out, done, missing = _apply_pairs(lines, entry["pairs"], forward=forward)
        if done:
            path.write_text("".join(out))
        total_done += done
        total_missing += missing
        if missing:
            print(f"{path}: {done} applied, {missing} not found")
    verb = "applied" if forward else "stripped"
    print(f"{verb} {total_done} rename lines, {total_missing} unmatched")
    return 0 if total_missing == 0 else 1


def cmd_apply(args: argparse.Namespace) -> int:
    return _rewrite(args, forward=True)


def cmd_strip(args: argparse.Namespace) -> int:
    return _rewrite(args, forward=False)


def cmd_verify(args: argparse.Namespace) -> int:
    """strip() then apply() must reproduce the current bytes exactly."""
    failures: list[str] = []
    for entry in _load_ledger(Path(args.ledger)):
        path = Path(entry["path"])
        if not path.exists():
            failures.append(f"{path}: missing")
            continue
        original = path.read_text()
        lines = original.splitlines(keepends=True)
        stripped, _, miss_strip = _apply_pairs(
            lines,
            entry["pairs"],
            forward=False,
        )
        replayed, _, miss_apply = _apply_pairs(
            stripped,
            entry["pairs"],
            forward=True,
        )
        if "".join(replayed) != original:
            failures.append(f"{path}: replay differs after strip/apply")
        elif miss_strip or miss_apply:
            failures.append(
                f"{path}: unmatched (strip={miss_strip} apply={miss_apply})",
            )
    if failures:
        for failure in failures:
            print(f"::error::{failure}", file=sys.stderr)
        print("naming ledger is NOT byte-replayable", file=sys.stderr)
        return 1
    entries = _load_ledger(Path(args.ledger))
    print(
        f"ledger replayable: {len(entries)} files / "
        f"{sum(len(e['pairs']) for e in entries)} lines",
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", default=DEFAULT_LEDGER)
    parser.add_argument("--base-ref", default=DEFAULT_BASE_REF)
    parser.add_argument("--target-ref", default=DEFAULT_TARGET_REF)
    parser.add_argument("command", choices=("export", "apply", "strip", "verify"))
    args = parser.parse_args()
    return {
        "export": cmd_export,
        "apply": cmd_apply,
        "strip": cmd_strip,
        "verify": cmd_verify,
    }[args.command](args)


if __name__ == "__main__":
    sys.exit(main())
