# -*- coding: utf-8 -*-

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