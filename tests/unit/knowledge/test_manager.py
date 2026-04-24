# -*- coding: utf-8 -*-

import json
import re
from pathlib import Path
from unittest.mock import patch

from copaw.config.config import Config, KnowledgeSourceSpec
from copaw.knowledge.manager import KnowledgeManager


def test_directory_source_skips_internal_knowledge_artifacts(tmp_path: Path):
    project_root = tmp_path / "project"
    project_root.mkdir(parents=True, exist_ok=True)
    (project_root / "original").mkdir(parents=True, exist_ok=True)
    (project_root / "original" / "note.md").write_text("hello world", encoding="utf-8")
    (project_root / ".knowledge" / "sources" / "demo").mkdir(parents=True, exist_ok=True)
    (project_root / ".knowledge" / "sources" / "demo" / "content.md").write_text(
        "internal artifact should be ignored",
        encoding="utf-8",
    )

    config = Config().knowledge
    source = KnowledgeSourceSpec(
        id="project-demo-workspace",
        name="Project Demo",
        type="directory",
        location=str(project_root),
        content="",
        enabled=True,
        recursive=True,
        tags=["project"],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    result = manager.index_source(source, config)
    content = manager.get_source_documents(source.id)

    assert result["document_count"] == 1
    assert len(content["documents"]) == 1
    assert content["documents"][0]["path"].endswith("original/note.md")


def test_directory_source_skips_hidden_files_and_hidden_directories(tmp_path: Path):
    project_root = tmp_path / "project"
    project_root.mkdir(parents=True, exist_ok=True)
    (project_root / ".DS_Store").write_text("finder noise", encoding="utf-8")
    (project_root / ".hidden").mkdir(parents=True, exist_ok=True)
    (project_root / ".hidden" / "secret.md").write_text("hidden content", encoding="utf-8")
    (project_root / "visible.md").write_text("visible content", encoding="utf-8")

    config = Config().knowledge
    source = KnowledgeSourceSpec(
        id="project-demo-workspace",
        name="Project Demo",
        type="directory",
        location=str(project_root),
        content="",
        enabled=True,
        recursive=True,
        tags=["project"],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    result = manager.index_source(source, config)
    content = manager.get_source_documents(source.id)
    paths = [document["path"] for document in content["documents"]]

    assert result["document_count"] == 1
    assert len(paths) == 1
    assert paths[0].endswith("visible.md")


def test_directory_source_raw_sync_ignores_internal_knowledge_dir(tmp_path: Path):
    project_root = tmp_path / "project-raw-sync"
    project_root.mkdir(parents=True, exist_ok=True)
    (project_root / "original").mkdir(parents=True, exist_ok=True)
    (project_root / "original" / "note.md").write_text("hello raw sync", encoding="utf-8")

    config = Config().knowledge
    source = KnowledgeSourceSpec(
        id="project-raw-sync-source",
        name="Project Raw Sync Source",
        type="directory",
        location=str(project_root),
        content="",
        enabled=True,
        recursive=True,
        tags=["project"],
        summary="",
    )

    manager = KnowledgeManager(project_root, knowledge_dirname=".knowledge")
    manager.index_source(source, config)

    raw_dir = manager.raw_dir / source.id / "original"
    snapshots = list(raw_dir.glob("note.snapshot_*.md"))

    assert len(snapshots) == 1
    assert snapshots[0].read_text(encoding="utf-8") == "hello raw sync"
    assert not any(path.name == ".knowledge" for path in manager.raw_dir.rglob("*"))


def test_chunk_documents_split_sentences_and_count(tmp_path: Path):
    config = Config().knowledge
    config.index.chunk_size = 10_000
    source = KnowledgeSourceSpec(
        id="sentence-chunk-source",
        name="Sentence Source",
        type="text",
        content="第一句。第二句! Third sentence?",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    result = manager.index_source(source, config)
    index_path = manager.get_source_storage_dir(source.id) / "index.json"
    payload = json.loads(index_path.read_text(encoding="utf-8"))
    chunks = payload.get("chunks") or []
    status = manager.get_source_status(source.id)
    content = manager.get_source_documents(source.id)
    chunk_path = tmp_path / "knowledge" / "chunks" / "sentence-chunk-source.0.txt"

    assert len(chunks) == 1
    first_chunk = chunks[0]
    assert first_chunk.get("sentence_count") == 3
    assert "text" not in first_chunk
    assert first_chunk.get("chunk_path") == "chunks/sentence-chunk-source.0.txt"
    assert chunk_path.exists()
    assert chunk_path.read_text(encoding="utf-8") == "第一句。\n第二句!\nThird sentence?"
    assert result.get("chunk_count") == 1
    assert result.get("sentence_count") == 3
    assert status.get("chunk_count") == 1
    assert status.get("sentence_count") == 3
    assert content.get("chunk_count") == 1
    assert content.get("sentence_count") == 3
    assert content["documents"][0]["text"] == "第一句。\n第二句!\nThird sentence?"


def test_search_reads_chunk_text_from_chunk_file_when_index_has_no_text(tmp_path: Path):
    config = Config().knowledge
    config.index.chunk_size = 10_000
    source = KnowledgeSourceSpec(
        id="search-chunk-source",
        name="Search Chunk Source",
        type="text",
        content="Alpha beta. Gamma delta.",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )
    config.sources = [source]

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)

    result = manager.search("gamma", config, limit=5)

    assert len(result["hits"]) == 1
    assert result["hits"][0]["source_id"] == source.id
    assert "Gamma delta" in result["hits"][0]["snippet"]


def test_process_source_candidates_read_chunk_text_from_chunk_file(tmp_path: Path):
    config = Config().knowledge
    config.index.chunk_size = 10_000
    source = KnowledgeSourceSpec(
        id="candidate-chunk-source",
        name="Candidate Chunk Source",
        type="text",
        content="第一句。第二句! Third sentence?",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)

    candidates = manager._collect_source_processing_candidates(source, config)

    assert any("第一句。\n第二句!\nThird sentence?" in item for item in candidates)


def test_directory_source_writes_chunks_under_relative_document_path(tmp_path: Path):
    project_root = tmp_path / "project-rel-chunks"
    docs_dir = project_root / "docs"
    docs_dir.mkdir(parents=True, exist_ok=True)
    (docs_dir / "README.md").write_text("第一句。第二句!", encoding="utf-8")

    config = Config().knowledge
    config.index.chunk_size = 10_000
    source = KnowledgeSourceSpec(
        id="project-rel-source",
        name="Project Relative Source",
        type="directory",
        location=str(project_root),
        content="",
        enabled=True,
        recursive=True,
        tags=["project"],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)

    payload = json.loads(
        (manager.get_source_storage_dir(source.id) / "index.json").read_text(encoding="utf-8")
    )
    chunk = payload["chunks"][0]
    chunk_path = tmp_path / "knowledge" / chunk["chunk_path"]

    assert re.fullmatch(
        r"chunks/docs/README\.snapshot_[0-9]{8}T[0-9]{6}[0-9]{6}Z\.md\.0\.txt",
        chunk["chunk_path"],
    )
    assert chunk_path.exists()
    assert chunk_path.read_text(encoding="utf-8") == "第一句。\n第二句!"


def test_directory_source_reindex_retains_old_snapshots_and_chunks(tmp_path: Path):
    project_root = tmp_path / "project-retain"
    docs_dir = project_root / "docs"
    docs_dir.mkdir(parents=True, exist_ok=True)
    source_file = docs_dir / "README.md"
    source_file.write_text("alpha version", encoding="utf-8")

    config = Config().knowledge
    config.index.chunk_size = 10_000
    source = KnowledgeSourceSpec(
        id="project-retain-source",
        name="Project Retain Source",
        type="directory",
        location=str(project_root),
        content="",
        enabled=True,
        recursive=True,
        tags=["project"],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)

    source_file.write_text("beta version", encoding="utf-8")
    manager.index_source(source, config)

    raw_snapshots = sorted((manager.raw_dir / source.id / "docs").glob("README.snapshot_*.md"))
    payload = json.loads(
        (manager.get_source_storage_dir(source.id) / "index.json").read_text(encoding="utf-8")
    )
    chunk_paths = sorted(chunk["chunk_path"] for chunk in payload["chunks"])

    assert len(raw_snapshots) == 2
    assert raw_snapshots[0].read_text(encoding="utf-8") == "alpha version"
    assert raw_snapshots[1].read_text(encoding="utf-8") == "beta version"
    assert payload["document_count"] == 1
    assert payload["snapshot_count"] == 2
    assert len(chunk_paths) == 2
    assert all(path.startswith("chunks/docs/README.snapshot_") for path in chunk_paths)
    assert all((tmp_path / "knowledge" / path).exists() for path in chunk_paths)


def test_delete_index_removes_chunk_files(tmp_path: Path):
    config = Config().knowledge
    config.index.chunk_size = 10_000
    source = KnowledgeSourceSpec(
        id="delete-chunk-source",
        name="Delete Chunk Source",
        type="text",
        content="第一句。第二句!",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)
    chunk_path = tmp_path / "knowledge" / "chunks" / "delete-chunk-source.0.txt"

    assert chunk_path.exists()

    manager.delete_index(source.id)

    assert not chunk_path.exists()


def test_delete_index_uses_chunk_manifest_when_index_is_missing(tmp_path: Path):
    config = Config().knowledge
    config.index.chunk_size = 10_000
    source = KnowledgeSourceSpec(
        id="manifest-delete-source",
        name="Manifest Delete Source",
        type="text",
        content="第一句。第二句!",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)

    source_dir = manager.get_source_storage_dir(source.id)
    chunk_path = tmp_path / "knowledge" / "chunks" / "manifest-delete-source.0.txt"
    index_path = source_dir / "index.json"

    assert chunk_path.exists()
    assert index_path.exists()

    index_path.unlink()

    manager.delete_index(source.id)

    assert not chunk_path.exists()


def test_lightweight_token_count_does_not_depend_on_semantic_tokenizer(tmp_path: Path):
    config = Config().knowledge
    config.index.chunk_size = 10_000
    source = KnowledgeSourceSpec(
        id="lightweight-token-source",
        name="Lightweight Token Source",
        type="text",
        content="第一句。第二句! Third sentence?",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    with patch.object(
        KnowledgeManager,
        "_tokenize_semantic_text",
        side_effect=RuntimeError("semantic path should not be used for token_count"),
    ):
        result = manager.index_source(source, config)

    assert result.get("token_count") == 4


def test_process_knowledge_text_returns_empty_keywords_without_hanlp(tmp_path: Path):
    manager = KnowledgeManager(tmp_path)

    with patch.object(
        manager._semantic_runtime,
        "tokenize",
        return_value=([], {
            "engine": "hanlp2",
            "status": "unavailable",
            "reason_code": "HANLP2_SIDECAR_UNCONFIGURED",
            "reason": "HanLP2 sidecar is not configured.",
        }),
    ):
        processed = manager._process_knowledge_text("第一句。第二句! Third sentence?", top_n=3)

    assert processed["subject"] == "第一句。第二句"
    assert processed["summary"] == "第一句。第二句"
    assert processed["keywords"] == []


def test_semantic_tokenizer_uses_hanlp2_tok_and_flattens_nested_tokens(tmp_path: Path):
    manager = KnowledgeManager(tmp_path)

    with patch.object(
        manager._semantic_runtime,
        "tokenize",
        return_value=(["Agent", "runner", "关系抽取"], {
            "engine": "hanlp2",
            "status": "ready",
            "reason_code": "HANLP2_READY",
            "reason": "HanLP2 semantic engine is ready.",
        }),
    ):
        tokens = manager._tokenize_semantic_text("Agent runner 关系抽取", exclude_stop_words=False)

    assert tokens == ["agent", "runner", "关系抽取"]


def test_semantic_engine_state_reports_unavailable_without_hanlp(tmp_path: Path):
    manager = KnowledgeManager(tmp_path)

    state = manager.get_semantic_engine_state()

    assert state["engine"] == "hanlp2"
    assert state["status"] == "unavailable"
    assert state["reason_code"] == "HANLP2_SIDECAR_UNCONFIGURED"


def test_semantic_engine_state_reports_missing_entrypoint(tmp_path: Path):
    manager = KnowledgeManager(tmp_path)

    with patch.object(
        manager._semantic_runtime,
        "probe",
        return_value={
            "engine": "hanlp2",
            "status": "unavailable",
            "reason_code": "HANLP2_ENTRYPOINT_MISSING",
            "reason": "HanLP2 tokenizer entry point was not found.",
        },
    ):
        state = manager.get_semantic_engine_state()

    assert state["status"] == "unavailable"
    assert state["reason_code"] == "HANLP2_ENTRYPOINT_MISSING"


def test_semantic_engine_state_reports_tokenize_runtime_failure(tmp_path: Path):
    manager = KnowledgeManager(tmp_path)

    with patch.object(
        manager._semantic_runtime,
        "tokenize",
        return_value=([], {
            "engine": "hanlp2",
            "status": "error",
            "reason_code": "HANLP2_TOKENIZE_FAILED",
            "reason": "HanLP2 semantic tokenization failed via tok: RuntimeError.",
        }),
    ):
        tokens = manager._tokenize_semantic_text("Agent runner 关系抽取")
        state = manager.get_semantic_engine_state()

    assert tokens == []
    assert state["status"] == "error"
    assert state["reason_code"] == "HANLP2_TOKENIZE_FAILED"
    assert "RuntimeError" in state["reason"]


def test_compute_processing_fingerprint_changes_with_chunk_size(tmp_path: Path):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    fp1 = manager.compute_processing_fingerprint(config, None)

    config.index.chunk_size = config.index.chunk_size + 100
    fp2 = manager.compute_processing_fingerprint(config, None)

    assert fp1 != fp2


def test_get_source_status_needs_reindex_on_stale_index(tmp_path: Path):
    config = Config().knowledge
    config.index.chunk_size = 10_000
    source = KnowledgeSourceSpec(
        id="stale-status-source",
        name="Stale Source",
        type="text",
        content="Sentence A. Sentence B.",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)

    index_path = manager.get_source_storage_dir(source.id) / "index.json"
    payload = json.loads(index_path.read_text(encoding="utf-8"))
    payload.pop("processing_fingerprint", None)
    index_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    status = manager.get_source_status(source.id, source, config)
    assert status.get("needs_reindex") is True


def test_get_source_status_needs_reindex_false_after_fresh_index(tmp_path: Path):
    config = Config().knowledge
    source = KnowledgeSourceSpec(
        id="fresh-status-source",
        name="Fresh Source",
        type="text",
        content="Line one. Line two.",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)
    status = manager.get_source_status(source.id, source, config)
    assert status.get("needs_reindex") is False


def test_directory_source_skips_oversized_file(tmp_path: Path):
    project_root = tmp_path / "project-oversize"
    project_root.mkdir(parents=True, exist_ok=True)
    (project_root / "small.md").write_text("small content", encoding="utf-8")
    (project_root / "large.md").write_text("x" * 200, encoding="utf-8")

    config = Config().knowledge
    config.index.max_file_size = 64
    source = KnowledgeSourceSpec(
        id="project-oversize-source",
        name="Project Oversize",
        type="directory",
        location=str(project_root),
        content="",
        enabled=True,
        recursive=True,
        tags=["project"],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    result = manager.index_source(source, config)
    content = manager.get_source_documents(source.id)

    assert result["document_count"] == 1
    assert len(content["documents"]) == 1
    assert content["documents"][0]["path"].endswith("small.md")