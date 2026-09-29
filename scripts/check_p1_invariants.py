#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Count P1 debt: upstream-owned files the fork modified, split by kind.

P1 = "the fork must not touch files that upstream owns".  A file is
upstream-owned when it already existed at the fork point (``--base-ref``).
Every such file that still differs today is one unit of P1 debt.

Each file's diff is split into two ledgers (plan §7 / D-15):

* ``naming``  — a brand rename and nothing else: a removed line and an added
  line become byte-identical once every ``qwenpaw``/``copaw`` token (any case)
  is replaced by a placeholder.  Admitted as a permanent, replayable tax.
* ``behavior`` — everything else: changed logic, dependencies, packaging,
  build flags, or modified upstream tests.  Target is **0**, only decreasing.

Usage:
    python scripts/check_p1_invariants.py                  # report
    python scripts/check_p1_invariants.py --write-baseline # record baseline
    python scripts/check_p1_invariants.py --check          # gate (non-zero on growth)
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

DEFAULT_BASE_REF = "e111ec6fb"
DEFAULT_BASELINE = "scripts/p1_baseline.json"
BRAND_RE = re.compile(r"(?:qwenpaw|copaw)", re.IGNORECASE)
PLACEHOLDER = "\x00"
# Mechanical, non-semantic diffs reported on their own line.
MECHANICAL = {"console/package-lock.json", "package-lock.json"}


def _run(args: list[str]) -> str:
    return subprocess.run(
        args,
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def _normalize(line: str) -> str:
    return BRAND_RE.sub(PLACEHOLDER, line)


def _upstream_owned(base_ref: str) -> set[str]:
    listing = _run(["git", "ls-tree", "-r", "--name-only", base_ref])
    return {line for line in listing.splitlines() if line}


def _diff_cmd(base_ref: str, target_ref: str | None, flags: list[str]) -> str:
    cmd = ["git", "diff", *flags, "--no-renames", "--no-color", base_ref]
    if target_ref:
        cmd.append(target_ref)
    return _run(cmd)


def _numstat(base_ref: str, target_ref: str | None) -> dict[str, tuple[int, int]]:
    """Authoritative added/removed line counts per path."""
    out: dict[str, tuple[int, int]] = {}
    for line in _diff_cmd(base_ref, target_ref, ["--numstat"]).splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        added, removed, path = parts[0], parts[1], parts[-1]
        try:
            out[path] = (int(added), int(removed))
        except ValueError:  # binary files report "-"
            out[path] = (0, 0)
    return out


def _iter_diff_files(
    base_ref: str,
    target_ref: str | None,
):
    """Yield ``(path, removed_lines, added_lines)`` per changed file."""
    raw = _diff_cmd(base_ref, target_ref, ["-U0"])
    current: str | None = None
    removed: list[str] = []
    added: list[str] = []
    seen_hunk = False

    def emit():
        if current is not None:
            return (current, removed, added)
        return None

    for line in raw.splitlines():
        if line.startswith("diff --git "):
            done = emit()
            if done:
                yield done
            current = line.split(" b/", 1)[1]
            removed, added, seen_hunk = [], [], False
            continue
        if current is None:
            continue
        if line.startswith("@@"):
            seen_hunk = True
            continue
        if not seen_hunk and (
            line.startswith("--- ") or line.startswith("+++ ")
        ):
            continue
        if line.startswith("-"):
            removed.append(line[1:])
        elif line.startswith("+"):
            added.append(line[1:])
    done = emit()
    if done:
        yield done


def pair_rename_lines(
    removed: list[str],
    added: list[str],
) -> list[tuple[str, str]]:
    """Pair added lines with the removed line they merely renamed."""
    pool: dict[str, list[str]] = {}
    for line in removed:
        if BRAND_RE.search(line):
            pool.setdefault(_normalize(line), []).append(line)
    pairs: list[tuple[str, str]] = []
    for line in added:
        if not BRAND_RE.search(line):
            continue
        bucket = pool.get(_normalize(line))
        if bucket:
            pairs.append((bucket.pop(0), line))
    return pairs


def _pair_naming(removed: list[str], added: list[str]) -> int:
    return len(pair_rename_lines(removed, added))


def rename_pairs_by_path(
    base_ref: str,
    target_ref: str | None,
) -> dict[str, list[tuple[str, str]]]:
    """``{path: [(old_line, new_line), ...]}`` for pure brand renames."""
    return {
        path: pairs
        for path, removed, added in _iter_diff_files(base_ref, target_ref)
        if (pairs := pair_rename_lines(removed, added))
    }


def _collect(
    base_ref: str,
    target_ref: str | None,
) -> dict[str, dict[str, object]]:
    owned = _upstream_owned(base_ref)
    counts = _numstat(base_ref, target_ref)
    pairs = rename_pairs_by_path(base_ref, target_ref)
    naming = {path: len(v) for path, v in pairs.items()}
    out: dict[str, dict[str, object]] = {}
    for path, (added, removed) in counts.items():
        if path not in owned or (added == 0 and removed == 0):
            continue
        names = min(naming.get(path, 0), added, removed)
        out[path] = {
            "added": added,
            "removed": removed,
            "naming": names,
            "behavior_added": added - names,
            "behavior_removed": removed - names,
            "mechanical": path in MECHANICAL,
        }
    return out


def _behavior(entry: dict[str, object]) -> int:
    """Invasive lines: added on top of upstream plus upstream lines deleted."""
    return int(entry["behavior_added"]) + int(entry["behavior_removed"])


def _totals(entries: dict[str, dict[str, object]]) -> dict[str, int]:
    files = [e for e in entries.values() if not e["mechanical"]]
    return {
        "files": len(files),
        "added": sum(int(e["added"]) for e in files),
        "removed": sum(int(e["removed"]) for e in files),
        "naming_lines": sum(int(e["naming"]) for e in files),
        "behavior_added": sum(int(e["behavior_added"]) for e in files),
        "behavior_removed": sum(int(e["behavior_removed"]) for e in files),
        "behavior_files": sum(1 for e in files if _behavior(e) > 0),
        "naming_files": sum(1 for e in files if _behavior(e) == 0),
        "naming_touched_files": sum(1 for e in files if int(e["naming"]) > 0),
        "mechanical_files": sum(1 for e in entries.values() if e["mechanical"]),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-ref", default=DEFAULT_BASE_REF)
    parser.add_argument(
        "--target-ref",
        default="HEAD",
        help="use 'working' to include uncommitted changes",
    )
    parser.add_argument("--baseline", default=DEFAULT_BASELINE)
    parser.add_argument("--write-baseline", action="store_true")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    target = None if args.target_ref == "working" else args.target_ref
    entries = _collect(args.base_ref, target)
    totals = _totals(entries)

    baseline_path = Path(args.baseline)
    if args.write_baseline:
        payload = {
            "base_ref": args.base_ref,
            "totals": totals,
            "files": {k: entries[k] for k in sorted(entries)},
        }
        baseline_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
        print(f"wrote {baseline_path} ({totals['files']} files)")
        return 0

    if not args.json:
        print(
            f"P1 upstream-owned files modified: {totals['files']} "
            f"(+{totals['added']}/-{totals['removed']})",
        )
        print(
            f"  P1-命名: {totals['naming_files']} pure / "
            f"{totals['naming_touched_files']} touched / "
            f"{totals['naming_lines']} lines (admitted, replayable)",
        )
        print(
            f"  P1-行为: {totals['behavior_files']} files / "
            f"+{totals['behavior_added']} invasive / "
            f"-{totals['behavior_removed']} upstream lines deleted "
            "(target: 0, decreasing)",
        )
        print(
            f"  mechanical: {totals['mechanical_files']} files (lockfiles)",
        )

    if not args.check:
        if args.json:
            print(
                json.dumps(
                    {"totals": totals, "files": entries},
                    sort_keys=True,
                ),
            )
        return 0

    if not baseline_path.exists():
        print(f"::error::no baseline at {baseline_path}", file=sys.stderr)
        return 2
    prev = json.loads(baseline_path.read_text())
    prev_totals = prev["totals"]
    problems: list[str] = []
    for key in (
        "files",
        "behavior_added",
        "behavior_removed",
        "behavior_files",
    ):
        if totals[key] > prev_totals[key]:
            problems.append(f"{key} grew: {prev_totals[key]} -> {totals[key]}")
    if totals["naming_lines"] > prev_totals["naming_lines"]:
        problems.append(
            f"naming_lines grew: {prev_totals['naming_lines']} -> "
            f"{totals['naming_lines']} (naming is capped by the ledger)",
        )
    prev_files = prev["files"]
    for path, entry in sorted(entries.items()):
        old = prev_files.get(path)
        if old is None:
            problems.append(f"NEW upstream-owned file touched: {path}")
            continue
        if entry["mechanical"]:
            continue
        new_b = _behavior(entry)
        old_b = _behavior(old)
        if new_b > old_b:
            problems.append(f"{path} behavior grew: {old_b} -> {new_b}")
    if problems:
        for problem in problems:
            print(f"::error::{problem}", file=sys.stderr)
        return 1
    print("P1 invariants hold (no growth vs baseline)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
