# -*- coding: utf-8 -*-

import json
from pathlib import Path

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

    assert len(chunks) == 1
    first_chunk = chunks[0]
    assert first_chunk.get("sentence_count") == 3
    assert first_chunk.get("text") == "第一句。\n第二句!\nThird sentence?"
    assert result.get("chunk_count") == 1
    assert result.get("sentence_count") == 3
    assert status.get("chunk_count") == 1
    assert status.get("sentence_count") == 3
    assert content.get("chunk_count") == 1
    assert content.get("sentence_count") == 3


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