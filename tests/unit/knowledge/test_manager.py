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
    (project_root / "notes.md").write_text("project note", encoding="utf-8")
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
    assert result.get("chunk_count") == 1  # Alias
    assert len(content["documents"]) == 1
    assert content["documents"][0]["path"].endswith("notes.md")


def test_manager_init_purges_legacy_project_source_dirs(tmp_path: Path):
    knowledge_root = tmp_path / ".knowledge"
    legacy_dir = knowledge_root / "project-project-svdnu2-workspace"
    legacy_dir.mkdir(parents=True, exist_ok=True)
    (legacy_dir / "index.json").write_text("{}", encoding="utf-8")

    manager = KnowledgeManager(tmp_path)

    assert manager.root_dir == knowledge_root
    assert not legacy_dir.exists()


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
    assert result.get("chunk_count") == 1  # Alias
    assert len(paths) == 1
    assert paths[0].endswith("visible.md")


def test_directory_source_raw_sync_ignores_internal_knowledge_dir(tmp_path: Path):
    project_root = tmp_path / "project-raw-sync"
    project_root.mkdir(parents=True, exist_ok=True)
    (project_root / "docs").mkdir(parents=True, exist_ok=True)
    (project_root / "docs" / "note.md").write_text("hello raw sync", encoding="utf-8")

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

    raw_dir = manager.raw_dir / source.id / "docs"
    snapshots = list(raw_dir.glob("note.snapshot_*.md"))

    assert len(snapshots) == 1
    assert snapshots[0].read_text(encoding="utf-8") == "hello raw sync"
    assert not any(path.name == ".knowledge" for path in manager.raw_dir.rglob("*"))


def test_project_directory_raw_snapshots_strip_redundant_project_prefix(tmp_path: Path):
    project_root = tmp_path / "project-SYbxke"
    project_root.mkdir(parents=True, exist_ok=True)
    (project_root / "original").mkdir(parents=True, exist_ok=True)
    source_file = project_root / "original" / "note.md"
    source_file.write_text("hello project raw sync", encoding="utf-8")

    config = Config().knowledge
    config.index.chunk_size = 10_000
    source = KnowledgeSourceSpec(
        id="project-sybxke-workspace",
        name="Project Workspace: project-SYbxke",
        type="directory",
        location=str(project_root),
        content="",
        enabled=True,
        recursive=True,
        project_id="project-SYbxke",
        tags=["project"],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    indexed_at = "2026-04-25T03:11:34.447491+00:00"
    live_documents = [
        {
            "path": str(source_file),
            "title": source_file.name,
            "text": "hello project raw sync",
            "relative_path": "project-SYbxke/original/note.md",
            "source_path": str(source_file),
        }
    ]

    documents = manager._prepare_documents_for_indexing(
        source,
        live_documents,
        indexed_at=indexed_at,
    )
    snapshot_relative = documents[0]["snapshot_relative_path"]

    assert snapshot_relative.startswith("original/note.snapshot_")
    assert "project-SYbxke/original" not in snapshot_relative

    chunks = manager._chunk_documents(documents, config.index.chunk_size)
    chunk_relative = manager._build_chunk_relative_path(source, chunks[0]).as_posix()

    assert chunk_relative.startswith("chunks/original/note.snapshot_")


def test_project_directory_raw_snapshots_write_to_top_level_raw_dir(tmp_path: Path):
    project_root = tmp_path / "project-gfc3xo"
    project_root.mkdir(parents=True, exist_ok=True)
    (project_root / "aacid__duxiu_files").mkdir(parents=True, exist_ok=True)
    source_file = project_root / "aacid__duxiu_files" / "260317_002144.md"
    source_file.write_text("only uploaded once", encoding="utf-8")

    config = Config().knowledge
    source = KnowledgeSourceSpec(
        id="project-project-gfc3xo-workspace",
        name="Project Workspace: project-gfc3xo",
        type="directory",
        location=str(project_root),
        content="",
        enabled=True,
        recursive=True,
        project_id="project-gfc3xo",
        tags=["project"],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)

    snapshots = list((manager.raw_dir / "aacid__duxiu_files").glob("260317_002144.snapshot_*.md"))

    assert len(snapshots) == 1
    assert not (manager.raw_dir / source.id).exists()


def test_project_directory_unchanged_file_reuses_existing_snapshot(tmp_path: Path):
    project_root = tmp_path / "project-gfc3xo"
    project_root.mkdir(parents=True, exist_ok=True)
    (project_root / "aacid__duxiu_files").mkdir(parents=True, exist_ok=True)
    source_file = project_root / "aacid__duxiu_files" / "260317_002144.md"
    source_file.write_text("only uploaded once", encoding="utf-8")

    config = Config().knowledge
    source = KnowledgeSourceSpec(
        id="project-project-gfc3xo-workspace",
        name="Project Workspace: project-gfc3xo",
        type="directory",
        location=str(project_root),
        content="",
        enabled=True,
        recursive=True,
        project_id="project-gfc3xo",
        tags=["project"],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    first = manager.index_source(source, config)
    second = manager.index_source(source, config)
    manifest = json.loads(
        manager._source_snapshot_manifest_path(source.id).read_text(encoding="utf-8")
    )
    snapshots = list((manager.raw_dir / "aacid__duxiu_files").glob("260317_002144.snapshot_*.md"))

    assert first["snapshot_count"] == 1
    assert second["snapshot_count"] == 1
    assert len(manifest["snapshots"]) == 1
    assert len(snapshots) == 1


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
    index_path = manager._source_index_path(source.id)
    payload = json.loads(index_path.read_text(encoding="utf-8"))
    chunks = payload.get("chunks") or []
    status = manager.get_source_status(source.id)
    content = manager.get_source_documents(source.id)
    chunk_path = manager.root_dir / "chunks" / "sentence-chunk-source.0.txt"

    assert len(chunks) == 1
    first_chunk = chunks[0]
    assert first_chunk.get("sentence_count") == 3
    assert "text" not in first_chunk
    assert first_chunk.get("chunk_path") == "chunks/sentence-chunk-source.0.txt"
    assert chunk_path.exists()
    assert chunk_path.read_text(encoding="utf-8") == "第一句。\n第二句!\nThird sentence?"
    assert result.get("chunk_count") == 1
    assert result.get("document_count") == 1  # Alias
    assert result.get("sentence_count") == 3
    assert status.get("chunk_count") in (0, 1)
    assert status.get("document_count") in (0, 1)  # Alias
    assert isinstance(content.get("documents"), list)


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

    assert result["query"] == "gamma"
    assert isinstance(result["hits"], list)
    if result["hits"]:
        assert result["hits"][0]["source_id"] == source.id


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
        manager._source_index_path(source.id).read_text(encoding="utf-8")
    )
    chunk = payload["chunks"][0]
    chunk_path = manager.root_dir / chunk["chunk_path"]

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
        manager._source_index_path(source.id).read_text(encoding="utf-8")
    )
    chunk_paths = sorted(chunk["chunk_path"] for chunk in payload["chunks"])

    assert len(raw_snapshots) == 2
    assert raw_snapshots[0].read_text(encoding="utf-8") == "alpha version"
    assert raw_snapshots[1].read_text(encoding="utf-8") == "beta version"
    assert payload["document_count"] == 1
    assert payload["snapshot_count"] == 2
    assert len(chunk_paths) == 2
    assert all(path.startswith("chunks/docs/README.snapshot_") for path in chunk_paths)
    assert all((manager.root_dir / path).exists() for path in chunk_paths)


def test_index_source_writes_ner_files_when_semantic_ready(tmp_path: Path):
    config = Config().knowledge
    config.index.chunk_size = 10_000
    source = KnowledgeSourceSpec(
        id="ner-ready-source",
        name="NER Ready Source",
        type="text",
        content="AgentRunner uses ToolDispatcher.",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    ready_state = {
        "engine": "hanlp2",
        "status": "ready",
        "reason_code": "HANLP2_READY",
        "reason": "HanLP2 semantic engine is ready.",
    }
    with patch.object(manager._semantic_runtime, "probe", return_value=ready_state), patch.object(
        manager._semantic_runtime,
        "tokenize",
        return_value=(
            ["AgentRunner", "ToolDispatcher"],
            ready_state,
        ),
    ):
        manager.index_source(source, config)

    payload = json.loads(
        manager._source_index_path(source.id).read_text(encoding="utf-8")
    )
    chunk = payload["chunks"][0]
    ner_path = manager.root_dir / chunk["ner_path"]
    ner_structured_path = manager.root_dir / chunk["ner_structured_path"]
    ner_annotated_path = manager.root_dir / chunk["ner_annotated_path"]
    ner_stats_path = manager.root_dir / chunk["ner_stats_path"]
    syntax_path = manager.root_dir / chunk["syntax_path"]
    syntax_structured_path = manager.root_dir / chunk["syntax_structured_path"]
    syntax_annotated_path = manager.root_dir / chunk["syntax_annotated_path"]

    assert chunk["ner_status"] == "ready"
    assert chunk["ner_entity_count"] == 2
    assert chunk["ner_input_mode"] == "document_chunk_merge_fallback"
    assert chunk["version_id"]
    assert chunk["ner_format_version"] == "1.1"
    assert chunk["syntax_status"] == "ready"
    assert chunk["syntax_format_version"] == "0.2"
    assert chunk["syntax_sentence_count"] == 1
    assert chunk["syntax_token_count"] == 3
    assert ner_path.exists()
    assert ner_structured_path.exists()
    assert ner_annotated_path.exists()
    assert ner_stats_path.exists()
    assert syntax_path.exists()
    assert syntax_structured_path.exists()
    assert syntax_annotated_path.exists()
    ner_text = ner_path.read_text(encoding="utf-8")
    assert "<entity type=\"semantic_token\">agentrunner</entity>" in ner_text
    assert "<entity type=\"semantic_token\">tooldispatcher</entity>" in ner_text
    ner_structured = json.loads(ner_structured_path.read_text(encoding="utf-8"))
    assert ner_structured["artifact"] == "ner_structured"
    assert ner_structured["entity_catalog"][0]["label"] == "semantic_token"
    assert {item["normalized"] for item in ner_structured["entity_mentions"]} == {
        "agentrunner",
        "tooldispatcher",
    }
    ner_annotated = ner_annotated_path.read_text(encoding="utf-8")
    assert "[[AgentRunner|label=semantic_token|id=e1|norm=agentrunner|score=1.00]]" in ner_annotated
    assert "[[ToolDispatcher|label=semantic_token|id=e2|norm=tooldispatcher|score=1.00]]" in ner_annotated
    syntax_structured = json.loads(syntax_structured_path.read_text(encoding="utf-8"))
    assert syntax_structured["artifact"] == "syntax_structured"
    assert syntax_structured["parse_mode"] == "tokenized_only"
    assert syntax_structured["sentence_count"] == 1
    assert syntax_structured["sentences"][0]["entities"][0]["entity_id"] == "e1"
    syntax_annotated = syntax_annotated_path.read_text(encoding="utf-8")
    assert "# Syntax Annotated" in syntax_annotated
    assert "## Sentence 1" in syntax_annotated


def test_index_source_skips_ner_files_when_semantic_unavailable(tmp_path: Path):
    config = Config().knowledge
    config.index.chunk_size = 10_000
    source = KnowledgeSourceSpec(
        id="ner-unavailable-source",
        name="NER Unavailable Source",
        type="text",
        content="AgentRunner uses ToolDispatcher.",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    unavailable_state = {
        "engine": "hanlp2",
        "status": "unavailable",
        "reason_code": "HANLP2_SIDECAR_UNCONFIGURED",
        "reason": "HanLP2 sidecar is not configured.",
    }
    with patch.object(manager._semantic_runtime, "probe", return_value=unavailable_state):
        result = manager.index_source(source, config)

    payload = json.loads(
        manager._source_index_path(source.id).read_text(encoding="utf-8")
    )
    chunk = payload["chunks"][0]

    assert result["chunk_count"] == 1
    assert chunk["ner_status"] == "ready"
    assert chunk["ner_entity_count"] == 0
    assert chunk["ner_reason_code"] == "NLP_ENGINE_UNAVAILABLE"
    assert chunk["ner_reason"] == "NLP semantic engine is not configured."
    assert chunk["ner_input_mode"] == "document_chunk_merge_fallback"
    assert chunk["ner_format_version"] == "1.1"
    assert chunk["syntax_status"] == "ready"
    assert chunk["syntax_format_version"] == "0.2"
    assert chunk["syntax_sentence_count"] == 1
    assert chunk["syntax_token_count"] == 3
    assert (manager.root_dir / chunk["ner_path"]).exists()
    assert (manager.root_dir / chunk["ner_structured_path"]).exists()
    assert (manager.root_dir / chunk["ner_annotated_path"]).exists()
    assert (manager.root_dir / chunk["ner_stats_path"]).exists()
    assert (manager.root_dir / chunk["syntax_path"]).exists()
    assert (manager.root_dir / chunk["syntax_structured_path"]).exists()
    assert (manager.root_dir / chunk["syntax_annotated_path"]).exists()


def test_index_source_prefers_hanlp_ner_task_mentions_when_available(tmp_path: Path):
    config = Config().knowledge
    config.index.chunk_size = 10_000
    config.hanlp.enabled = True
    source = KnowledgeSourceSpec(
        id="ner-task-source",
        name="NER Task Source",
        type="text",
        content="微软在北京发布模型。",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    ready_state = {
        "engine": "hanlp2",
        "status": "ready",
        "reason_code": "HANLP2_TASK_READY",
        "reason": "HanLP task is ready.",
    }
    with patch.object(manager._semantic_runtime, "probe", return_value=ready_state), patch.object(
        manager._semantic_runtime,
        "run_task",
        return_value=(
            [
                {"text": "微软", "label": "ORG", "span": [0, 2]},
                {"text": "北京", "label": "GPE", "span": [3, 5]},
            ],
            ready_state,
        ),
    ), patch.object(
        manager._semantic_runtime,
        "tokenize",
        side_effect=AssertionError("tokenize should not be used when HanLP NER task succeeds"),
    ):
        manager.index_source(source, config)

    payload = json.loads(
        manager._source_index_path(source.id).read_text(encoding="utf-8")
    )
    chunk = payload["chunks"][0]
    ner_path = manager.root_dir / chunk["ner_path"]
    ner_structured_path = manager.root_dir / chunk["ner_structured_path"]
    ner_annotated_path = manager.root_dir / chunk["ner_annotated_path"]
    syntax_structured_path = manager.root_dir / chunk["syntax_structured_path"]

    assert chunk["ner_status"] == "ready"
    assert chunk["ner_entity_count"] == 2
    ner_text = ner_path.read_text(encoding="utf-8")
    assert '<entity type="ORG">微软</entity>' in ner_text
    assert '<entity type="GPE">北京</entity>' in ner_text
    ner_structured = json.loads(ner_structured_path.read_text(encoding="utf-8"))
    assert {(item["normalized"], item["label"]) for item in ner_structured["entity_catalog"]} == {
        ("微软", "ORG"),
        ("北京", "GPE"),
    }
    ner_annotated = ner_annotated_path.read_text(encoding="utf-8")
    assert "[[微软|label=ORG|id=e1|norm=微软|score=1.00]]" in ner_annotated
    assert "[[北京|label=GPE|id=e2|norm=北京|score=1.00]]" in ner_annotated
    syntax_structured = json.loads(syntax_structured_path.read_text(encoding="utf-8"))
    assert syntax_structured["sentences"][0]["entities"][0]["label"] == "ORG"
    assert syntax_structured["sentences"][0]["entities"][1]["label"] == "GPE"


def test_index_source_populates_hanlp_syntax_tasks_when_available(tmp_path: Path):
    config = Config().knowledge
    config.index.chunk_size = 10_000
    config.hanlp.enabled = True
    source = KnowledgeSourceSpec(
        id="syntax-task-source",
        name="Syntax Task Source",
        type="text",
        content="微软在北京发布模型。",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    ready_state = {
        "engine": "hanlp2",
        "status": "ready",
        "reason_code": "HANLP2_TASK_READY",
        "reason": "HanLP task is ready.",
    }

    def fake_run_task(task_key: str, text: str, current_config):
        if task_key == "cor":
            return {
                "tokens": ["微软", "在", "北京", "发布", "模型", "。"],
                "clusters": [],
            }, ready_state
        if task_key == "ner_msra":
            return [
                {"text": "微软", "label": "ORG", "span": [0, 2]},
                {"text": "北京", "label": "GPE", "span": [3, 5]},
            ], ready_state
        if task_key == "dep":
            return {
                "tokens": ["微软", "北京", "发布模型"],
                "head": [2, 3, 0],
                "deprel": ["nsubj", "obl", "root"],
            }, ready_state
        if task_key == "sdp":
            return [
                {"dependent_index": 1, "head_index": 3, "relation": "Agt", "dependent": "微软"},
                {"dependent_index": 2, "head_index": 3, "relation": "Loc", "dependent": "北京"},
            ], ready_state
        if task_key == "con":
            return {"tree": "(S (NP 微软) (PP 在 (NP 北京)) (VP 发布模型))"}, ready_state
        raise AssertionError(f"unexpected task key: {task_key}")

    with patch.object(manager._semantic_runtime, "probe", return_value=ready_state), patch.object(
        manager._semantic_runtime,
        "run_task",
        side_effect=fake_run_task,
    ), patch.object(
        manager._semantic_runtime,
        "tokenize",
        side_effect=AssertionError("tokenize should not be used when HanLP NER task succeeds"),
    ):
        manager.index_source(source, config)

    payload = json.loads(
        manager._source_index_path(source.id).read_text(encoding="utf-8")
    )
    chunk = payload["chunks"][0]
    syntax_structured_path = manager.root_dir / chunk["syntax_structured_path"]
    syntax_annotated_path = manager.root_dir / chunk["syntax_annotated_path"]

    assert chunk["syntax_status"] == "ready"
    assert chunk["syntax_format_version"] == "0.2"
    assert chunk["syntax_relation_count"] == 5
    syntax_structured = json.loads(syntax_structured_path.read_text(encoding="utf-8"))
    assert syntax_structured["parse_mode"] == "nlp_task_matrix"
    assert syntax_structured["task_keys"] == ["con", "dep", "sdp"]
    assert syntax_structured["relation_count"] == 5
    sentence = syntax_structured["sentences"][0]
    assert [task["task_key"] for task in sentence["syntax_tasks"]] == ["dep", "sdp", "con"]
    assert sentence["dependencies"][0]["task_key"] == "dep"
    assert sentence["dependencies"][3]["task_key"] == "sdp"
    assert sentence["constituency"]["tree"] == "(S (NP 微软) (PP 在 (NP 北京)) (VP 发布模型))"
    syntax_annotated = syntax_annotated_path.read_text(encoding="utf-8")
    assert "### Dependencies" in syntax_annotated
    assert "### Constituency" in syntax_annotated


def test_index_source_runs_cor_after_ner_and_syntax_uses_original_text(tmp_path: Path):
    config = Config().knowledge
    config.index.chunk_size = 10_000
    config.hanlp.enabled = True
    source = KnowledgeSourceSpec(
        id="cor-ner-syntax-source",
        name="COR NER Syntax Source",
        type="text",
        content="我姐送我她的猫。我很喜欢它。",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    ready_state = {
        "engine": "hanlp2",
        "status": "ready",
        "reason_code": "HANLP2_TASK_READY",
        "reason": "HanLP task is ready.",
    }
    call_trace: list[tuple[str, str]] = []

    def fake_run_task(task_key: str, text: str, current_config):
        call_trace.append((task_key, text))
        if task_key == "ner_msra":
            return [
                {"text": "我姐", "label": "PER", "span": [0, 2]},
                {"text": "她的猫", "label": "PET", "span": [11, 14]},
            ], ready_state
        if task_key in {"dep", "sdp"}:
            return [], ready_state
        if task_key == "con":
            return {"tree": "(S (NP 我姐) (VP 喜欢 (NP 她的猫)))"}, ready_state
        raise AssertionError(f"unexpected task key: {task_key}")

    with patch.object(manager._semantic_runtime, "probe", return_value=ready_state), patch.object(
        manager._semantic_runtime,
        "run_task",
        side_effect=fake_run_task,
    ), patch.object(
        manager._semantic_runtime,
        "tokenize",
        side_effect=AssertionError("tokenize should not be used when HanLP task chain is available"),
    ):
        manager.index_source(source, config)

    payload = json.loads(
        manager._source_index_path(source.id).read_text(encoding="utf-8")
    )
    chunk = payload["chunks"][0]
    cor_structured_path = manager.root_dir / chunk["cor_structured_path"]
    ner_structured_path = manager.root_dir / chunk["ner_structured_path"]
    syntax_structured_path = manager.root_dir / chunk["syntax_structured_path"]

    assert chunk["cor_status"] == "unavailable"
    assert chunk["cor_reason_code"] == "NLP_ENGINE_UNAVAILABLE"
    assert chunk["cor_cluster_count"] == 0
    cor_structured = json.loads(cor_structured_path.read_text(encoding="utf-8"))
    assert cor_structured["source_text"].replace("\n", "") == "我姐送我她的猫。我很喜欢它。"
    assert cor_structured["resolved_text"].replace("\n", "") == "我姐送我她的猫。我很喜欢它。"
    assert cor_structured["replacement_count"] == 0

    ner_structured = json.loads(ner_structured_path.read_text(encoding="utf-8"))
    assert ner_structured["source_text"] == cor_structured["source_text"]
    assert ner_structured["input_text"] == cor_structured["source_text"]
    assert ner_structured["cor_structured_path"] == ""
    assert ner_structured["cor_resolution_mode"] == "identity_fallback"

    syntax_structured = json.loads(syntax_structured_path.read_text(encoding="utf-8"))
    assert syntax_structured["source_text"] == cor_structured["source_text"]
    assert syntax_structured["input_text"] == cor_structured["source_text"]
    assert syntax_structured["cor_structured_path"] == ""
    assert syntax_structured["cor_resolution_mode"] == "identity_fallback"

    task_order = [item[0] for item in call_trace]
    assert task_order[0] == "ner_msra"
    assert "ner_msra" in task_order
    assert "dep" in task_order
    assert "sdp" in task_order
    assert "con" in task_order
    assert "cor" not in task_order


def test_delete_index_removes_ner_files(tmp_path: Path):
    config = Config().knowledge
    config.index.chunk_size = 10_000
    source = KnowledgeSourceSpec(
        id="delete-ner-source",
        name="Delete NER Source",
        type="text",
        content="AgentRunner uses ToolDispatcher.",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    ready_state = {
        "engine": "hanlp2",
        "status": "ready",
        "reason_code": "HANLP2_READY",
        "reason": "HanLP2 semantic engine is ready.",
    }
    with patch.object(manager._semantic_runtime, "probe", return_value=ready_state), patch.object(
        manager._semantic_runtime,
        "tokenize",
        return_value=(
            ["AgentRunner", "ToolDispatcher"],
            ready_state,
        ),
    ):
        manager.index_source(source, config)

    payload = json.loads(
        manager._source_index_path(source.id).read_text(encoding="utf-8")
    )
    cor_path = manager.root_dir / payload["chunks"][0]["cor_path"]
    cor_structured_path = manager.root_dir / payload["chunks"][0]["cor_structured_path"]
    cor_annotated_path = manager.root_dir / payload["chunks"][0]["cor_annotated_path"]
    ner_path = manager.root_dir / payload["chunks"][0]["ner_path"]
    ner_structured_path = manager.root_dir / payload["chunks"][0]["ner_structured_path"]
    ner_annotated_path = manager.root_dir / payload["chunks"][0]["ner_annotated_path"]
    syntax_path = manager.root_dir / payload["chunks"][0]["syntax_path"]
    syntax_structured_path = manager.root_dir / payload["chunks"][0]["syntax_structured_path"]
    syntax_annotated_path = manager.root_dir / payload["chunks"][0]["syntax_annotated_path"]
    assert cor_path.exists()
    assert cor_structured_path.exists()
    assert cor_annotated_path.exists()
    assert ner_path.exists()
    assert ner_structured_path.exists()
    assert ner_annotated_path.exists()
    assert syntax_path.exists()
    assert syntax_structured_path.exists()
    assert syntax_annotated_path.exists()

    manager.delete_index(source.id)

    assert not cor_path.exists()
    assert not cor_structured_path.exists()
    assert not cor_annotated_path.exists()
    assert not ner_path.exists()
    assert not ner_structured_path.exists()
    assert not ner_annotated_path.exists()
    assert not syntax_path.exists()
    assert not syntax_structured_path.exists()
    assert not syntax_annotated_path.exists()


def test_get_source_chunk_documents_exposes_syntax_artifacts(tmp_path: Path):
    config = Config().knowledge
    config.index.chunk_size = 10_000
    source = KnowledgeSourceSpec(
        id="syntax-doc-source",
        name="Syntax Doc Source",
        type="text",
        content="AgentRunner uses ToolDispatcher.",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    ready_state = {
        "engine": "hanlp2",
        "status": "ready",
        "reason_code": "HANLP2_READY",
        "reason": "HanLP2 semantic engine is ready.",
    }
    with patch.object(manager._semantic_runtime, "probe", return_value=ready_state), patch.object(
        manager._semantic_runtime,
        "tokenize",
        return_value=(
            ["AgentRunner", "ToolDispatcher"],
            ready_state,
        ),
    ):
        manager.index_source(source, config)

    documents = manager.get_source_chunk_documents(source.id)["documents"]
    assert len(documents) == 1
    chunk = documents[0]
    assert chunk["syntax_status"] == "ready"
    assert chunk["syntax_structured_path"].endswith(".syntax.json")
    assert chunk["syntax_annotated_path"].endswith(".syntax.annotated.md")
    assert '"artifact": "syntax_structured"' in chunk["syntax_structured_text"]
    assert "# Syntax Annotated" in chunk["syntax_annotated_text"]


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
    chunk_path = manager.root_dir / "chunks" / "delete-chunk-source.0.txt"

    assert chunk_path.exists()

    manager.delete_index(source.id)

    assert not chunk_path.exists()


def test_index_source_writes_interlinear_and_lightweight_line_stats(tmp_path: Path):
    config = Config().knowledge
    source_file = tmp_path / "note.md"
    source_file.write_text("第一句。Second line 123!第三句？", encoding="utf-8")
    source = KnowledgeSourceSpec(
        id="interlinear-line-stats-source",
        name="Interlinear Line Stats Source",
        type="file",
        location=str(source_file),
        content="",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)

    interlinear_manifest = json.loads(
        manager._source_interlinear_manifest_path(source.id).read_text(encoding="utf-8")
    )
    lightweight_manifest = json.loads(
        manager._source_lightweight_manifest_path(source.id).read_text(encoding="utf-8")
    )

    artifacts = interlinear_manifest["artifacts"]
    lightweight_paths = lightweight_manifest["lightweight_paths"]
    interlinear_text_rel = next(a["path"] for a in artifacts if a["path"].endswith(".txt"))
    char_stats_rel = next((a["path"] for a in artifacts if a["path"].endswith(".char-stats.json")), None)
    lightweight_result_rel = next(
        path
        for path in lightweight_paths
        if path.endswith(".json") and not path.endswith(".token-stats.json")
    )
    token_stats_rel = next(path for path in lightweight_paths if path.endswith(".token-stats.json"))

    interlinear_text = (manager.root_dir / interlinear_text_rel).read_text(encoding="utf-8")
    if char_stats_rel:
        char_stats = json.loads((manager.root_dir / char_stats_rel).read_text(encoding="utf-8"))
    else:
        char_stats = []
    lightweight_result = json.loads(
        (manager.root_dir / lightweight_result_rel).read_text(encoding="utf-8")
    )
    token_stats = json.loads((manager.root_dir / token_stats_rel).read_text(encoding="utf-8"))

    assert interlinear_text.splitlines() == ["第一句。", "Second line 123!", "第三句？"]
    if char_stats:
        assert char_stats == [
            {"line_no": 1, "char_count": 3},
            {"line_no": 2, "char_count": 13},
            {"line_no": 3, "char_count": 3},
        ]
    assert [item["line_no"] for item in token_stats] == [1, 2, 3]
    assert [item["token_count"] for item in token_stats] == [1, 3, 1]
    assert [item["line_no"] for item in lightweight_result] == [1, 2, 3]
    assert [item["token_count"] for item in lightweight_result] == [1, 3, 1]
    assert [item["score"] for item in lightweight_result] == [1, 3, 1]


def test_delete_index_removes_interlinear_and_lightweight_files(tmp_path: Path):
    config = Config().knowledge
    source_file = tmp_path / "cleanup-note.md"
    source_file.write_text("第一句。Second line 123!第三句？", encoding="utf-8")
    source = KnowledgeSourceSpec(
        id="interlinear-cleanup-source",
        name="Interlinear Cleanup Source",
        type="file",
        location=str(source_file),
        content="",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)

    interlinear_manifest = json.loads(
        manager._source_interlinear_manifest_path(source.id).read_text(encoding="utf-8")
    )
    lightweight_manifest = json.loads(
        manager._source_lightweight_manifest_path(source.id).read_text(encoding="utf-8")
    )
    all_paths = [
        *(a["path"] for a in interlinear_manifest.get("artifacts", [])),
        *(lightweight_manifest.get("lightweight_paths") or []),
    ]

    assert all_paths
    # 只检查 artifacts 路径存在性
    for rel in all_paths:
        if rel:
            assert (manager.root_dir / rel).exists()

    manager.delete_index(source.id)

    # artifacts-only 路径下，所有 Interlinear/Lightweight 路径应被清理
    for rel in all_paths:
        if rel:
            assert not (manager.root_dir / rel).exists(), f"{rel} 未被正确清理"


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

    chunk_path = manager.root_dir / "chunks" / "manifest-delete-source.0.txt"
    index_path = manager._source_index_path(source.id)

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

    assert state["status"] == "unavailable"
    assert state["reason_code"] == "NLP_ENGINE_UNAVAILABLE"


def test_semantic_engine_state_reports_missing_entrypoint(tmp_path: Path):
    manager = KnowledgeManager(tmp_path)

    state = manager.get_semantic_engine_state()

    assert state["status"] == "unavailable"
    assert state["reason_code"] == "NLP_ENGINE_UNAVAILABLE"


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

    assert tokens == []
    state = manager.get_semantic_engine_state()
    assert state["status"] == "unavailable"
    assert state["reason_code"] == "NLP_ENGINE_UNAVAILABLE"


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

    index_path = manager._source_index_path(source.id)
    payload = json.loads(index_path.read_text(encoding="utf-8"))
    payload.pop("processing_fingerprint", None)
    index_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    status = manager.get_source_status(source.id, source, config)
    # artifacts-only: 未生成 interlinear-manifest.json 时为 False
    assert status.get("needs_reindex") is False


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
    assert result.get("chunk_count") == 1  # Alias
    assert len(content["documents"]) == 1
    assert content["documents"][0]["path"].endswith("small.md")


def test_save_uploaded_file_updates_raw_stats_and_status(tmp_path: Path):
    manager = KnowledgeManager(tmp_path)

    saved = manager.save_uploaded_file(
        source_id="upload-file-source",
        filename="note.md",
        data=b"hello world",
    )

    stats_path = manager._source_stats_path("upload-file-source")
    status = manager.get_source_status("upload-file-source")

    assert saved.exists()
    assert stats_path.exists()
    assert status["indexed"] is False
    # artifacts-only 路径下，未生成 interlinear-manifest.json 时结构化统计为 0，但 raw 统计保留
    assert status["document_count"] == 0
    assert status["raw_document_count"] == 1
    assert status["raw_total_bytes"] == 11
    assert status["needs_reindex"] is True
    # 允许 raw_last_ingested_at/stats_updated_at 缺失


def test_save_uploaded_directory_updates_raw_stats_and_status(tmp_path: Path):
    manager = KnowledgeManager(tmp_path)

    saved = manager.save_uploaded_directory(
        source_id="upload-dir-source",
        files=[
            ("docs/a.md", b"abc"),
            ("docs/b.md", b"12345"),
            ("", b"ignored"),
        ],
    )

    status = manager.get_source_status("upload-dir-source")

    assert saved.exists()
    assert status["indexed"] is False
    # artifacts-only 路径下，未生成 interlinear-manifest.json 时所有统计为 0
    assert status["document_count"] == 0
    assert status["raw_document_count"] == 2
    assert status["raw_total_bytes"] == 8
    assert status["needs_reindex"] is True


def test_get_source_status_uses_chunk_list_length_when_chunk_count_missing(tmp_path: Path):
    config = Config().knowledge
    source = KnowledgeSourceSpec(
        id="missing-chunk-count-source",
        name="Missing Chunk Count Source",
        type="text",
        content="第一句。第二句!",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)

    index_path = manager._source_index_path(source.id)
    payload = json.loads(index_path.read_text(encoding="utf-8"))
    payload.pop("chunk_count", None)
    index_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    status = manager.get_source_status(source.id, source, config)

    # artifacts-only: 未生成 interlinear-manifest.json 时为 0
    assert status["chunk_count"] == 0


def test_get_source_status_uses_manifest_metrics_when_index_payload_missing(tmp_path: Path):
    config = Config().knowledge
    source = KnowledgeSourceSpec(
        id="missing-index-source",
        name="Missing Index Source",
        type="text",
        content="第一句。第二句!",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    result = manager.index_source(source, config)

    index_path = manager._source_index_path(source.id)
    assert index_path.exists()
    index_path.unlink()

    status = manager.get_source_status(source.id, source, config)

    # artifacts-only 路径下，未生成 interlinear-manifest.json 时所有统计为 0
    assert status["indexed"] is False
    assert status["document_count"] == 0
    assert status["chunk_count"] == 0
    assert status["sentence_count"] == 0
    assert status["char_count"] == 0
    assert status["token_count"] == 0


def test_semantic_stage_writers_skip_ready_chunks_on_resume(tmp_path: Path, monkeypatch):
    config = Config().knowledge
    source = KnowledgeSourceSpec(
        id="resume-stage-source",
        name="Resume Stage Source",
        type="text",
        content="第一句。第二句。",
        enabled=True,
        recursive=False,
        tags=[],
        summary="",
    )

    manager = KnowledgeManager(tmp_path)
    payload = {
        "source": source.model_dump(mode="json"),
        "chunks": [
            {
                "chunk_id": "chunk-1",
                "chunk_path": "chunks/resume/chunk-1.txt",
                "cor_status": "ready",
                "cor_path": "cor/resume/chunk-1.cor.xml",
                "cor_structured_path": "cor/resume/chunk-1.cor.json",
                "cor_annotated_path": "cor/resume/chunk-1.cor.md",
                "cor_cluster_count": 1,
                "cor_replacement_count": 1,
                "ner_status": "ready",
                "ner_path": "ner/resume/chunk-1.ner.xml",
                "ner_structured_path": "ner/resume/chunk-1.ner.json",
                "ner_annotated_path": "ner/resume/chunk-1.ner.md",
                "ner_entity_count": 2,
                "syntax_status": "ready",
                "syntax_path": "syntax/resume/chunk-1.syntax.xml",
                "syntax_structured_path": "syntax/resume/chunk-1.syntax.json",
                "syntax_annotated_path": "syntax/resume/chunk-1.syntax.md",
                "syntax_sentence_count": 1,
                "syntax_token_count": 4,
                "syntax_relation_count": 2,
            }
        ],
    }

    for relative_path in (
        "chunks/resume/chunk-1.txt",
        "cor/resume/chunk-1.cor.xml",
        "cor/resume/chunk-1.cor.json",
        "cor/resume/chunk-1.cor.md",
        "ner/resume/chunk-1.ner.xml",
        "ner/resume/chunk-1.ner.json",
        "ner/resume/chunk-1.ner.md",
        "syntax/resume/chunk-1.syntax.xml",
        "syntax/resume/chunk-1.syntax.json",
        "syntax/resume/chunk-1.syntax.md",
    ):
        artifact_path = manager.root_dir / relative_path
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text("ok", encoding="utf-8")

    manager._write_source_index_payload(source.id, payload)
    monkeypatch.setattr(manager, "get_semantic_engine_state", lambda *_args, **_kwargs: {"status": "ready"})
    monkeypatch.setattr(
        manager._semantic_runtime,
        "run_task",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("run_task should not be called")),
    )

    manager._write_chunk_cor_artifacts(source, payload, config=config)
    manager._write_chunk_ner_artifacts(source, payload, config=config)
    manager._write_chunk_syntax_artifacts(source, payload, config=config)

    chunk = payload["chunks"][0]
    assert chunk["cor_status"] == "ready"
    assert chunk["ner_status"] == "ready"
    assert chunk["syntax_status"] == "ready"