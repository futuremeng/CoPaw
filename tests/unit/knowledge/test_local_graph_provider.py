# -*- coding: utf-8 -*-

import json
from pathlib import Path

from copaw.config.config import Config, KnowledgeSourceSpec
from copaw.knowledge.local_graph_provider import persist_local_graph
from copaw.knowledge.manager import KnowledgeManager


def test_local_graph_filters_hidden_docs_and_noise_entities(tmp_path: Path):
    project_root = tmp_path / "project"
    project_root.mkdir(parents=True, exist_ok=True)
    (project_root / ".DS_Store").write_text("binary-like-noise", encoding="utf-8")
    (project_root / "PROJECT.md").write_text(
        "术语发现 preferred_workspace_chat_id adf21727-eaa0-4c8f-91ec-2d4e379bb569\n"
        "ToolDispatcher 协同 FileSearch 处理术语冲突。\n"
        "merged_terms_v2.tsv.json project-rxpwrp normalized_term template status completed true name description data 当前 说明",
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
    config.sources.append(source)

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)
    graph_path = tmp_path / "knowledge" / "graphify-out" / "graph.json"
    result = persist_local_graph(manager, config, [source.id], graph_path)
    payload = json.loads(graph_path.read_text(encoding="utf-8"))
    labels = {str(node.get("label") or "") for node in payload.get("nodes") or []}

    assert result["relation_count"] > 0
    assert ".DS_Store" not in labels
    assert "project.md" not in labels
    assert "adf21727-eaa0-4c8f-91ec-2d4e379bb569" not in labels
    assert "preferred_workspace_chat_id" not in labels
    assert "merged_terms_v2.tsv.json" not in labels
    assert "project-rxpwrp" not in labels
    assert "normalized_term" not in labels
    assert "template" not in labels
    assert "status" not in labels
    assert "completed" not in labels
    assert "true" not in labels
    assert "name" not in labels
    assert "description" not in labels
    assert "data" not in labels
    assert "当前" not in labels
    assert "说明" not in labels
    assert "tooldispatcher" in labels
    assert "filesearch" in labels


def test_local_graph_strips_frontmatter_and_key_value_noise(tmp_path: Path):
    project_root = tmp_path / "project"
    project_root.mkdir(parents=True, exist_ok=True)
    (project_root / "PROJECT.md").write_text(
        "---\n"
        "name: Example Project\n"
        "status: completed\n"
        "tags: [demo, review]\n"
        "---\n\n"
        "# 核心功能\n\n"
        "- description: 多书术语评审与冲突修复\n"
        "- metadata: should not become an entity\n"
        "ToolDispatcher 协同 FileSearch 处理术语冲突。\n",
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
    config.sources.append(source)

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)
    graph_path = tmp_path / "knowledge" / "graphify-out" / "graph.json"
    persist_local_graph(manager, config, [source.id], graph_path)
    payload = json.loads(graph_path.read_text(encoding="utf-8"))
    labels = {str(node.get("label") or "") for node in payload.get("nodes") or []}

    assert "name" not in labels
    assert "status" not in labels
    assert "tags" not in labels
    assert "description" not in labels
    assert "metadata" not in labels
    assert "tooldispatcher" in labels
    assert "filesearch" in labels


def test_local_graph_skips_code_files(tmp_path: Path):
    project_root = tmp_path / "project"
    project_root.mkdir(parents=True, exist_ok=True)
    (project_root / "notes.md").write_text(
        "ToolDispatcher 连接 FileSearch。",
        encoding="utf-8",
    )
    (project_root / "script.py").write_text(
        "filename = 'demo.md'\nmetadata = {'status': 'done'}\n",
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
    config.sources.append(source)

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)
    graph_path = tmp_path / "knowledge" / "graphify-out" / "graph.json"
    result = persist_local_graph(manager, config, [source.id], graph_path)
    payload = json.loads(graph_path.read_text(encoding="utf-8"))
    labels = {str(node.get("label") or "") for node in payload.get("nodes") or []}

    assert result["document_count"] == 1
    assert "filename" not in labels
    assert "metadata" not in labels
    assert "tags" not in labels
    assert "cases" not in labels
    assert "tooldispatcher" in labels
    assert "filesearch" in labels


def test_local_graph_ignores_title_only_generic_entities(tmp_path: Path):
    project_root = tmp_path / "project"
    project_root.mkdir(parents=True, exist_ok=True)
    (project_root / "dashboard-notes.md").write_text(
        "# Dashboard Pipeline\n\n简短说明。",
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
    config.sources.append(source)

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)
    graph_path = tmp_path / "knowledge" / "graphify-out" / "graph.json"
    persist_local_graph(manager, config, [source.id], graph_path)
    payload = json.loads(graph_path.read_text(encoding="utf-8"))
    labels = {str(node.get("label") or "") for node in payload.get("nodes") or []}

    assert "dashboard" not in labels
    assert "pipeline" not in labels
    assert "copaw" not in labels
    assert "plus" not in labels
    assert "核心功能" not in labels
    assert "项目状态" not in labels
    assert "说明文档" not in labels
    assert "决议" not in labels
    assert "选项" not in labels
    assert "编号" not in labels
    assert "一致率" not in labels


def test_local_graph_keeps_high_signal_title_entities(tmp_path: Path):
    project_root = tmp_path / "project"
    project_root.mkdir(parents=True, exist_ok=True)
    (project_root / "integration.md").write_text(
        "# ToolDispatcher Integration\n\n简短说明。",
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
    config.sources.append(source)

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)
    graph_path = tmp_path / "knowledge" / "graphify-out" / "graph.json"
    persist_local_graph(manager, config, [source.id], graph_path)
    payload = json.loads(graph_path.read_text(encoding="utf-8"))
    labels = {str(node.get("label") or "") for node in payload.get("nodes") or []}

    assert "tooldispatcher" in labels


def test_local_graph_filters_worklog_explanatory_terms(tmp_path: Path):
    project_root = tmp_path / "project"
    project_root.mkdir(parents=True, exist_ok=True)
    (project_root / "WORKING.md").write_text(
        "## 项目状态\n"
        "生成报告，包含路径与大小信息，统一使用分隔符。\n"
        "现代液压气动 与 金属材料 术语对齐完成。\n",
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
    config.sources.append(source)

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)
    graph_path = tmp_path / "knowledge" / "graphify-out" / "graph.json"
    persist_local_graph(manager, config, [source.id], graph_path)
    payload = json.loads(graph_path.read_text(encoding="utf-8"))
    labels = {str(node.get("label") or "") for node in payload.get("nodes") or []}

    assert "项目状态" not in labels
    assert "报告" not in labels
    assert "路径" not in labels
    assert "大小" not in labels
    assert "统一使用" not in labels
    assert "分隔符" not in labels
    assert "修复" not in labels
    assert "任务" not in labels
    assert "分歧项" not in labels
    assert "级修复项" not in labels
    assert "级修复项详情" not in labels
    assert "将合并后的术语集" not in labels
    assert "拆分为各书独立文" not in labels
    assert "待处理" not in labels
    assert "便于管理" not in labels
    assert "版本控制和溯源验" not in labels
    assert "执行脚本" not in labels
    assert "输入" not in labels
    assert "总计" not in labels
    assert "项修复完成" not in labels
    assert "合并度量集" not in labels
    assert "个独立术语文件" not in labels
    assert "条记录" not in labels
    assert "书籍" not in labels
    assert "源文件名" not in labels
    assert "记录数" not in labels
    assert "合并样本" not in labels
    assert "可视化" not in labels
    assert "括号标注" not in labels
    assert "术语集拆分与归档" not in labels
    assert "多书术语提取" not in labels
    assert "冲突识别" not in labels
    assert "质量门控与人工复" not in labels
    assert "现代液压气动" in labels
    assert "金属材料" in labels


def test_local_graph_allows_documents_under_hidden_parent_directories(tmp_path: Path):
    hidden_root = tmp_path / ".copaw" / "projects" / "demo"
    hidden_root.mkdir(parents=True, exist_ok=True)
    (hidden_root / "visible.md").write_text(
        "ToolDispatcher 和 FileSearch 在项目知识同步中协作。",
        encoding="utf-8",
    )

    config = Config().knowledge
    source = KnowledgeSourceSpec(
        id="project-demo-workspace",
        name="Project Demo",
        type="directory",
        location=str(hidden_root),
        content="",
        enabled=True,
        recursive=True,
        tags=["project"],
        summary="",
    )
    config.sources.append(source)

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)
    graph_path = tmp_path / "knowledge" / "graphify-out" / "graph.json"
    result = persist_local_graph(manager, config, [source.id], graph_path)

    assert result["document_count"] == 1
    assert result["node_count"] > 0
    assert result["relation_count"] > 0


def test_local_graph_emits_sentence_entity_stats(tmp_path: Path):
    project_root = tmp_path / "project"
    project_root.mkdir(parents=True, exist_ok=True)
    (project_root / "stats.md").write_text(
        "ToolDispatcher 调用 FileSearch。\n"
        "FileSearch 处理 KnowledgeGraph 与 ToolDispatcher。\n",
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
    config.sources.append(source)

    manager = KnowledgeManager(tmp_path)
    manager.index_source(source, config)
    graph_path = tmp_path / "knowledge" / "graphify-out" / "graph.json"
    result = persist_local_graph(manager, config, [source.id], graph_path)
    payload = json.loads(graph_path.read_text(encoding="utf-8"))
    sentence_stats = payload.get("sentence_entity_stats") or []

    assert result["sentence_count"] >= 2
    assert result["entity_mentions_count"] >= 4
    assert result["avg_entities_per_sentence"] > 0
    assert result["avg_entity_char_ratio"] > 0
    assert len(sentence_stats) >= 2
    assert all("entity_count_total" in item for item in sentence_stats)
    assert all("entity_char_ratio" in item for item in sentence_stats)
    assert all(0 <= float(item.get("entity_char_ratio") or 0) <= 1 for item in sentence_stats)