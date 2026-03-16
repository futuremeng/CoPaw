#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Minimal local smoke test for Cognee-backed chat knowledge closure.

This script validates the local workflow:
1) index one text source through CogneeEngine route,
2) search through KnowledgeManager,
3) render chat-style context text.

It is intended for manual verification on developer machines.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path
from types import SimpleNamespace


def _ensure_repo_imports(repo_root: Path) -> None:
    src_path = repo_root / "src"
    if str(src_path) not in sys.path:
        sys.path.insert(0, str(src_path))


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Smoke test: Cognee chat knowledge closure",
    )
    parser.add_argument(
        "--working-dir",
        default=".copaw-smoke",
        help="Working directory for temporary knowledge artifacts",
    )
    parser.add_argument(
        "--search-mode",
        choices=["hybrid", "chunks", "graph"],
        default="hybrid",
        help="Cognee search mode to validate",
    )
    parser.add_argument(
        "--query",
        default="How does CoPaw close the chat knowledge loop?",
        help="Search query for validation",
    )
    parser.add_argument(
        "--text",
        default="CoPaw closes the chat knowledge loop by indexing source text and injecting retrieval context into the next turn.",
        help="Text payload to index through cognee",
    )
    parser.add_argument(
        "--keep-artifacts",
        action="store_true",
        help="Do not delete generated index artifacts after run",
    )
    return parser


def main() -> int:
    args = _build_parser().parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    _ensure_repo_imports(repo_root)

    try:
        __import__("cognee")
    except Exception as exc:
        print("[ERROR] Cognee is not available in current environment.")
        print("Install first, for example: pip install cognee")
        print(f"Details: {exc}")
        return 2

    from copaw.config.config import Config
    from copaw.knowledge import KnowledgeManager
    from copaw.app.runner.runner import AgentRunner
    from copaw.config.config import KnowledgeSourceSpec

    working_dir = Path(args.working_dir).expanduser().resolve()
    working_dir.mkdir(parents=True, exist_ok=True)

    source_id = "smoke-" + hashlib.sha1(args.text.encode("utf-8")).hexdigest()[:10]

    config = Config().knowledge
    config.enabled = True
    config.engine.provider = "cognee"
    config.engine.fallback_to_default = False
    config.cognee.enabled = True
    config.cognee.search_mode = args.search_mode
    config.cognee.dataset_prefix = "copaw-smoke"

    source = KnowledgeSourceSpec(
        id=source_id,
        name="Cognee Smoke Source",
        type="text",
        content=args.text,
        enabled=True,
        recursive=False,
        tags=["smoke"],
        description="manual smoke verification",
    )
    config.sources = [source]

    manager = KnowledgeManager(working_dir)

    print(f"[INFO] Working dir: {working_dir}")
    print(f"[INFO] Search mode: {args.search_mode}")
    print(f"[INFO] Source id: {source_id}")

    try:
        indexed = manager.index_source(
            source,
            config,
            running_config=SimpleNamespace(knowledge_chunk_size=1200),
        )
        print(f"[OK] Indexed source: {indexed}")

        search_result = manager.search(
            query=args.query,
            config=config,
            limit=4,
        )
        hits = search_result.get("hits") or []
        print(f"[OK] Retrieved hits: {len(hits)}")
        if not hits:
            print("[ERROR] No hits returned from cognee search")
            return 3

        context_text = AgentRunner._build_knowledge_context_text(hits=hits, max_chars=1200)
        print("[OK] Built chat context preview:")
        print("=" * 60)
        print(context_text)
        print("=" * 60)

        if "知识库检索结果" not in context_text:
            print("[ERROR] Context format mismatch: expected knowledge header")
            return 4

        print("[SUCCESS] Cognee chat closure smoke test passed")
        return 0
    except Exception as exc:
        print(f"[ERROR] Smoke test failed: {exc}")
        return 1
    finally:
        if not args.keep_artifacts:
            try:
                manager.delete_index(source_id, config)
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
