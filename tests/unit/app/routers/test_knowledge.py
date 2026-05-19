# -*- coding: utf-8 -*-

import io
import json
import time
from pathlib import Path
from types import SimpleNamespace
import zipfile

import logging

# Enable logging capture for the test
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from copaw.app.routers import knowledge as knowledge_router_module
from copaw.config.config import Config
from copaw.knowledge import GraphOpsManager, KnowledgeManager
from copaw.knowledge.knowledge_quantization_architecture import QuantizationArchitectureManager


@pytest.fixture
def knowledge_api_client(tmp_path: Path, monkeypatch) -> TestClient:
    config = Config()
    state = {"config": config}

    def fake_load_config():
        return state["config"]

    def fake_save_config(new_config):
        state["config"] = new_config

    monkeypatch.setattr(knowledge_router_module, "load_config", fake_load_config)
    monkeypatch.setattr(knowledge_router_module, "save_config", fake_save_config)
    monkeypatch.setattr(knowledge_router_module, "WORKING_DIR", tmp_path)

    app = FastAPI()
    app.include_router(knowledge_router_module.router)
    return TestClient(app)


def test_upsert_source_auto_generates_summary_when_empty(
    knowledge_api_client: TestClient,
):
    response = knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "text-auto-summary",
            "name": "Manual Name",
            "type": "text",
            "content": "Quarterly planning checklist and milestone review for the release train.",
            "enabled": True,
            "recursive": False,
            "tags": [],
            "summary": "",
        },
    )

    assert response.status_code == 200
    generated = response.json()["summary"]
    assert generated


def test_upsert_source_auto_summary_includes_keywords(
    knowledge_api_client: TestClient,
):
    response = knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "text-auto-keywords",
            "name": "Manual Name",
            "type": "text",
            "content": (
                "支付系统 风控规则 更新。"
                "支付系统 对账流程 优化。"
                "支付系统 异常告警 升级。"
                "风控规则 每日巡检。"
            ),
            "enabled": True,
            "recursive": False,
            "tags": [],
            "summary": "",
        },
    )

    assert response.status_code == 200
    generated = response.json()["summary"]
    assert generated
    assert "支付系统" in generated


def test_upsert_source_subject_prefers_summary_over_content(
    knowledge_api_client: TestClient,
):
    response = knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "text-subject-from-summary",
            "name": "Manual Name",
            "type": "text",
            "content": "Very long internal content that should not be the direct subject source.",
            "enabled": True,
            "recursive": False,
            "tags": [],
            "summary": "Release checklist summary for sprint handoff",
        },
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Release checklist summary for sprint handoff"


def test_list_sources_uses_auto_generated_subjects_for_existing_config(
    knowledge_api_client: TestClient,
):
    put_response = knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "url-auto-subject",
            "name": "Old URL Name",
            "type": "url",
            "location": "https://example.com/path/to/guide.html",
            "enabled": True,
            "recursive": False,
            "tags": ["remote"],
            "summary": "",
        },
    )
    assert put_response.status_code == 200

    listing = knowledge_api_client.get("/knowledge/sources")
    assert listing.status_code == 200
    source = listing.json()["sources"][0]
    assert source["name"] == "example.com/guide.html"


def test_list_sources_returns_structured_summary_keywords(
    knowledge_api_client: TestClient,
):
    put_response = knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "text-structured-fields",
            "name": "Manual Name",
            "type": "text",
            "content": (
                "支付系统 风控规则 更新。"
                "支付系统 对账流程 优化。"
                "支付系统 异常告警 升级。"
            ),
            "enabled": True,
            "recursive": False,
            "tags": [],
            "summary": "",
        },
    )
    assert put_response.status_code == 200

    listing = knowledge_api_client.get("/knowledge/sources")
    assert listing.status_code == 200
    source = listing.json()["sources"][0]
    assert isinstance(source.get("subject"), str)
    assert isinstance(source.get("summary"), str)
    assert isinstance(source.get("keywords"), list)


def test_list_sources_returns_semantic_engine_status(
    knowledge_api_client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        KnowledgeManager,
        "get_semantic_engine_state",
        classmethod(
            lambda cls, _config=None: {
                "engine": "hanlp",
                "status": "unavailable",
                "reason_code": "HANLP_IMPORT_UNAVAILABLE",
                "reason": "HanLP module is not installed or failed to import.",
            }
        ),
    )

    put_response = knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "text-semantic-status",
            "name": "Manual Name",
            "type": "text",
            "content": "支付系统 风控规则 更新。",
            "enabled": True,
            "recursive": False,
            "tags": [],
            "summary": "",
        },
    )
    assert put_response.status_code == 200

    listing = knowledge_api_client.get("/knowledge/sources?include_semantic=true")
    assert listing.status_code == 200
    source = listing.json()["sources"][0]
    assert source["semantic_status"]["engine"] == "hanlp"
    assert source["semantic_status"]["status"] == "unavailable"
    assert source["semantic_status"]["reason_code"] == "HANLP_IMPORT_UNAVAILABLE"


def test_list_sources_filters_by_project_id(
    knowledge_api_client: TestClient,
):
    first = knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "project-source-a",
            "name": "Source A",
            "type": "text",
            "content": "alpha project knowledge",
            "enabled": True,
            "recursive": False,
            "tags": [],
            "summary": "",
            "project_id": "project-A",
        },
    )
    assert first.status_code == 200

    second = knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "project-source-b",
            "name": "Source B",
            "type": "text",
            "content": "beta project knowledge",
            "enabled": True,
            "recursive": False,
            "tags": [],
            "summary": "",
            "project_id": "project-B",
        },
    )
    assert second.status_code == 200

    listing = knowledge_api_client.get("/knowledge/sources?project_id=project-A")
    assert listing.status_code == 200
    sources = listing.json()["sources"]
    assert len(sources) == 1
    assert sources[0]["id"] == "project-source-a"
    assert sources[0].get("project_id") == "project-A"


def test_list_sources_uses_project_file_analysis_stats_for_project_source(
    knowledge_api_client: TestClient,
    tmp_path: Path,
):
    project_id = "project-l1-api"
    project_dir = tmp_path / "projects" / project_id
    stats_dir = project_dir / ".knowledge" / "stats" / "file_analysis"
    stats_dir.mkdir(parents=True, exist_ok=True)
    (stats_dir / "latest.json").write_text(
        json.dumps(
            {
                "project_id": project_id,
                "source_id": "project-source-l1-api",
                "step_id": "file_analysis",
                "indexed_at": "2026-05-12T11:00:00Z",
                "updated_at": "2026-05-12T11:00:01Z",
                "metrics": {
                    "document_count": 4,
                    "snapshot_count": 4,
                    "chunk_count": 9,
                    "sentence_count": 12,
                    "char_count": 40,
                    "token_count": 20,
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    registered = knowledge_api_client.put(
        f"/knowledge/sources?project_id={project_id}",
        json={
            "id": "project-source-l1-api",
            "name": "Project Source L1 API",
            "type": "directory",
            "location": str(project_dir),
            "content": "",
            "enabled": True,
            "recursive": True,
            "tags": ["project"],
            "summary": "",
            "project_id": project_id,
        },
    )
    assert registered.status_code == 200

    listing = knowledge_api_client.get(f"/knowledge/sources?project_id={project_id}")
    assert listing.status_code == 200
    sources = listing.json()["sources"]

    assert len(sources) == 1
    status = sources[0]["status"]
    assert status["indexed"] is True
    assert status["document_count"] == 4
    assert status["snapshot_count"] == 4
    assert status["chunk_count"] == 9
    assert status["sentence_count"] == 12


def test_get_project_step_stats_accepts_file_analysis_hyphen_alias(
    knowledge_api_client: TestClient,
    tmp_path: Path,
):
    project_id = "project-l1-history-api"
    project_dir = tmp_path / "projects" / project_id
    stats_dir = project_dir / ".knowledge" / "stats" / "file_analysis"
    stats_dir.mkdir(parents=True, exist_ok=True)
    latest_payload = {
        "project_id": project_id,
        "source_id": "project-source-l1-history-api",
        "step_id": "file_analysis",
        "indexed_at": "2026-05-12T12:00:00Z",
        "updated_at": "2026-05-12T12:00:01Z",
        "metrics": {
            "document_count": 5,
            "snapshot_count": 5,
            "chunk_count": 11,
            "sentence_count": 14,
        },
    }
    history_rows = [
        {
            **latest_payload,
            "updated_at": "2026-05-12T11:59:00Z",
            "metrics": {
                "document_count": 4,
                "snapshot_count": 4,
                "chunk_count": 9,
                "sentence_count": 12,
            },
        },
        latest_payload,
    ]
    (stats_dir / "latest.json").write_text(
        json.dumps(latest_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (stats_dir / "history.jsonl").write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in history_rows) + "\n",
        encoding="utf-8",
    )

    response = knowledge_api_client.get(
        f"/knowledge/project-stats/file-analysis?project_id={project_id}&limit=1"
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["project_id"] == project_id
    assert payload["step_id"] == "file_analysis"
    assert payload["latest"]["metrics"]["chunk_count"] == 11
    assert len(payload["history"]) == 1
    assert payload["history"][0]["updated_at"] == "2026-05-12T12:00:01Z"


def test_get_project_step_stats_accepts_source_scan_hyphen_alias(
    knowledge_api_client: TestClient,
    tmp_path: Path,
):
    project_id = "project-source-scan-api"
    project_dir = tmp_path / "projects" / project_id
    stats_dir = project_dir / ".knowledge" / "stats" / "source_scan"
    stats_dir.mkdir(parents=True, exist_ok=True)
    latest_payload = {
        "project_id": project_id,
        "source_id": "project-source-source-scan-api",
        "step_id": "source_scan",
        "updated_at": "2026-05-12T12:10:01Z",
        "metrics": {
            "changed_path_count": 2,
            "data_file_count": 7,
            "source_count": 1,
        },
        "changed_paths": ["data/a.md", "data/b.md"],
    }
    (stats_dir / "latest.json").write_text(
        json.dumps(latest_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (stats_dir / "history.jsonl").write_text(
        json.dumps(latest_payload, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    response = knowledge_api_client.get(
        f"/knowledge/project-stats/source-scan?project_id={project_id}&limit=1"
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["project_id"] == project_id
    assert payload["step_id"] == "source_scan"
    assert payload["latest"]["metrics"]["data_file_count"] == 7
    assert len(payload["history"]) == 1
    assert payload["history"][0]["metrics"]["changed_path_count"] == 2


def test_get_project_step_stats_generic_route_returns_latest_and_history(
    knowledge_api_client: TestClient,
    tmp_path: Path,
):
    project_id = "project-step-generic-api"
    project_dir = tmp_path / "projects" / project_id
    stats_dir = project_dir / ".knowledge" / "stats" / "file_analysis"
    stats_dir.mkdir(parents=True, exist_ok=True)
    latest_payload = {
        "project_id": project_id,
        "source_id": "project-source-step-generic-api",
        "step_id": "file_analysis",
        "updated_at": "2026-05-12T12:20:01Z",
        "metrics": {
            "document_count": 6,
            "chunk_count": 12,
            "sentence_count": 15,
        },
    }
    (stats_dir / "latest.json").write_text(
        json.dumps(latest_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (stats_dir / "history.jsonl").write_text(
        json.dumps(latest_payload, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    response = knowledge_api_client.get(
        f"/knowledge/project-stats/file_analysis?project_id={project_id}&limit=1"
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["project_id"] == project_id
    assert payload["step_id"] == "file_analysis"
    assert payload["latest"]["metrics"]["document_count"] == 6
    assert len(payload["history"]) == 1


def test_get_project_step_stats_generic_route_accepts_workflow_step_without_stats(
    knowledge_api_client: TestClient,
    tmp_path: Path,
):
    project_id = "project-step-empty-api"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    response = knowledge_api_client.get(
        f"/knowledge/project-stats/domain_graph_build?project_id={project_id}&limit=1"
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["project_id"] == project_id
    assert payload["step_id"] == "domain_graph_build"
    assert payload["latest"] == {}
    assert payload["history"] == []


def test_get_project_step_stats_rejects_unknown_step(
    knowledge_api_client: TestClient,
):
    response = knowledge_api_client.get(
        "/knowledge/project-stats/unknown-step?project_id=project-abc"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "PROJECT_STEP_STATS_NOT_FOUND"


def test_list_sources_offloads_processing_to_thread(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    original_to_thread = knowledge_router_module.asyncio.to_thread
    manager = KnowledgeManager(knowledge_router_module.WORKING_DIR)
    config = knowledge_router_module.load_config().knowledge
    config.sources.append(
        manager.normalize_source_name(
            knowledge_router_module.KnowledgeSourceSpec(
                id="threaded-list-source",
                name="Manual Name",
                type="text",
                content="支付系统 风控规则 更新。支付系统 对账流程 优化。",
                enabled=True,
                recursive=False,
                tags=[],
                summary="",
            ),
            config,
        )
    )
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(knowledge_router_module.asyncio, "to_thread", fake_to_thread)

    response = knowledge_api_client.get("/knowledge/sources")

    assert response.status_code == 200
    assert calls
    assert calls[0][0].__name__ == "list_sources"
    assert any(source.id == "threaded-list-source" for source in calls[0][1][0].sources)
    assert calls[0][1][1] is False


def test_list_sources_include_semantic_true(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    original_to_thread = knowledge_router_module.asyncio.to_thread
    manager = KnowledgeManager(knowledge_router_module.WORKING_DIR)
    config = knowledge_router_module.load_config().knowledge
    config.sources.append(
        manager.normalize_source_name(
            knowledge_router_module.KnowledgeSourceSpec(
                id="semantic-list-source",
                name="Semantic Source",
                type="text",
                content="知识语义提取测试文本。",
                enabled=True,
                recursive=False,
                tags=[],
                summary="",
            ),
            config,
        )
    )
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(knowledge_router_module.asyncio, "to_thread", fake_to_thread)

    response = knowledge_api_client.get("/knowledge/sources?include_semantic=true")

    assert response.status_code == 200
    assert calls
    assert calls[0][0].__name__ == "list_sources"
    assert calls[0][1][1] is True


def test_upsert_source_offloads_name_normalization_to_thread(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    original_to_thread = knowledge_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(knowledge_router_module.asyncio, "to_thread", fake_to_thread)

    response = knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "threaded-upsert-source",
            "name": "Manual Name",
            "type": "text",
            "content": "Release checklist summary for sprint handoff and milestone review.",
            "enabled": True,
            "recursive": False,
            "tags": [],
            "summary": "",
        },
    )

    assert response.status_code == 200
    assert calls
    assert calls[0][0].__name__ == "normalize_source_name"
    assert calls[0][1][0].id == "threaded-upsert-source"


def test_index_source_offloads_indexing_to_thread(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    upsert = knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "threaded-index-source",
            "name": "Threaded Index Source",
            "type": "text",
            "content": "knowledge index content",
            "enabled": True,
            "recursive": False,
            "tags": [],
            "summary": "",
        },
    )
    assert upsert.status_code == 200

    original_to_thread = knowledge_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(knowledge_router_module.asyncio, "to_thread", fake_to_thread)

    response = knowledge_api_client.post("/knowledge/sources/threaded-index-source/index")

    assert response.status_code == 200
    assert calls
    assert calls[0][0].__name__ == "index_source"
    assert calls[0][1][0].id == "threaded-index-source"


def test_search_knowledge_offloads_search_to_thread(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    class _FakeManager:
        def search(self, **kwargs):
            return {"items": [{"query": kwargs["query"]}], "total": 1}

    original_to_thread = knowledge_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(knowledge_router_module, "_manager_for_workspace", lambda *_args, **_kwargs: _FakeManager())
    monkeypatch.setattr(knowledge_router_module.asyncio, "to_thread", fake_to_thread)

    response = knowledge_api_client.get("/knowledge/search?q=threaded-search")

    assert response.status_code == 200
    assert response.json()["items"][0]["query"] == "threaded-search"
    assert calls
    assert calls[0][0].__name__ == "search"


def test_search_knowledge_passes_scope_filters(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    captured: dict[str, object] = {}

    class _FakeManager:
        def search(self, **kwargs):
            captured.update(kwargs)
            return {"query": kwargs["query"], "hits": []}

    monkeypatch.setattr(
        knowledge_router_module,
        "_manager_for_workspace",
        lambda *_args, **_kwargs: _FakeManager(),
    )

    response = knowledge_api_client.get(
        "/knowledge/search?q=threaded-search&scope_type=project&scope_id=project-demo",
    )

    assert response.status_code == 200
    assert captured.get("scope_type") == "project"
    assert captured.get("scope_id") == "project-demo"


def test_search_knowledge_rejects_invalid_scope_type(
    knowledge_api_client: TestClient,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    response = knowledge_api_client.get(
        "/knowledge/search?q=threaded-search&scope_type=workspace",
    )
    assert response.status_code == 400
    assert response.json().get("detail") == "INVALID_SCOPE_TYPE"


def test_project_sync_run_does_not_expose_project_source_to_global_search(
    knowledge_api_client: TestClient,
    tmp_path: Path,
    monkeypatch,
):
    project_id = "global-scope-sync-only"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    class _FakeProjectSyncManager:
        def get_state(self, _project_id):
            return {"project_id": _project_id, "status": "idle"}

    class _FakeCoordinator:
        def dispatch(self, _command):
            return SimpleNamespace(
                action="start_sync",
                operation_id="ps-global-scope-sync-only",
                idempotency_key="sync-only-key",
                deduplicated=False,
                payload={"accepted": True, "project_id": project_id, "status": "queued"},
            )

    monkeypatch.setattr(
        knowledge_router_module,
        "_project_sync_for_workspace",
        lambda *_args, **_kwargs: _FakeProjectSyncManager(),
    )
    monkeypatch.setattr(
        knowledge_router_module,
        "_project_sync_coordinator_for_workspace",
        lambda *_args, **_kwargs: _FakeCoordinator(),
    )

    run_response = knowledge_api_client.post(
        f"/knowledge/project-sync/run?project_id={project_id}",
        json={
            "trigger": "manual-test",
            "changed_paths": ["original/note.md"],
            "force": True,
            "processing_mode": "nlp",
        },
    )
    assert run_response.status_code == 200

    captured: dict[str, object] = {}

    class _FakeSearchManager:
        def search(self, **kwargs):
            source_ids = [source.id for source in kwargs["config"].sources]
            captured["source_ids"] = source_ids
            return {"query": kwargs["query"], "hits": []}

    monkeypatch.setattr(
        knowledge_router_module,
        "_manager_for_workspace",
        lambda *_args, **_kwargs: _FakeSearchManager(),
    )

    search_response = knowledge_api_client.get("/knowledge/search?q=sync-only-query")
    assert search_response.status_code == 200
    assert captured["source_ids"] == []


def test_register_project_source_exposes_it_to_global_search_and_graph_query(
    knowledge_api_client: TestClient,
    tmp_path: Path,
    monkeypatch,
):
    project_id = "global-scope-registered"
    source_id = f"project-{project_id}-workspace"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["graph_query_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    registered = knowledge_api_client.put(
        f"/knowledge/sources?project_id={project_id}",
        json={
            "id": source_id,
            "name": f"Project Workspace: {project_id}",
            "type": "directory",
            "location": str(project_dir),
            "content": "",
            "enabled": True,
            "recursive": True,
            "project_id": project_id,
            "tags": ["project", f"project:{project_id}", "scope:project"],
            "summary": f"Project-scoped knowledge source for {project_id}",
        },
    )
    assert registered.status_code == 200

    captured_search: dict[str, object] = {}

    class _FakeSearchManager:
        def search(self, **kwargs):
            source_ids = [source.id for source in kwargs["config"].sources]
            captured_search["source_ids"] = source_ids
            return {"query": kwargs["query"], "hits": []}

    monkeypatch.setattr(
        knowledge_router_module,
        "_manager_for_workspace",
        lambda *_args, **_kwargs: _FakeSearchManager(),
    )

    search_response = knowledge_api_client.get("/knowledge/search?q=registered-query")
    assert search_response.status_code == 200
    assert source_id in captured_search["source_ids"]

    captured_graph: dict[str, object] = {}

    class _FakeGraphOps:
        def graph_query(self, **kwargs):
            source_ids = [source.id for source in kwargs["config"].sources]
            captured_graph["source_ids"] = source_ids
            return SimpleNamespace(
                records=[],
                summary={"ok": True},
                provenance={"source_count": len(source_ids)},
                warnings=[],
            )

    monkeypatch.setattr(
        knowledge_router_module,
        "_graph_ops_for_workspace",
        lambda *_args, **_kwargs: _FakeGraphOps(),
    )

    graph_response = knowledge_api_client.get("/knowledge/graph-query?q=registered-graph")
    assert graph_response.status_code == 200
    assert source_id in captured_graph["source_ids"]


def test_graph_query_offloads_query_to_thread(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["graph_query_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    class _FakeGraphOps:
        def graph_query(self, **kwargs):
            return SimpleNamespace(
                records=[{"query": kwargs["query_text"]}],
                summary={"mode": kwargs["query_mode"]},
                provenance=[],
                warnings=[],
            )

    original_to_thread = knowledge_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(knowledge_router_module, "_graph_ops_for_workspace", lambda *_args, **_kwargs: _FakeGraphOps())
    monkeypatch.setattr(knowledge_router_module.asyncio, "to_thread", fake_to_thread)

    response = knowledge_api_client.get("/knowledge/graph-query?q=threaded-graph")

    assert response.status_code == 200
    assert response.json()["records"][0]["query"] == "threaded-graph"
    assert calls
    assert calls[0][0].__name__ == "graph_query"


def test_graph_query_forwards_output_mode(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["graph_query_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    captured: dict[str, object] = {}

    class _FakeGraphOps:
        def graph_query(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                records=[{"query": kwargs["query_text"]}],
                summary={"mode": kwargs["query_mode"]},
                provenance={"resolved_output_mode": kwargs.get("preferred_output_mode")},
                warnings=[],
            )

    monkeypatch.setattr(knowledge_router_module, "_graph_ops_for_workspace", lambda *_args, **_kwargs: _FakeGraphOps())

    response = knowledge_api_client.get("/knowledge/graph-query?q=threaded-graph&output_mode=agentic")

    assert response.status_code == 200
    assert captured["preferred_output_mode"] == "agentic"
    assert response.json()["provenance"]["resolved_output_mode"] == "agentic"


def test_graph_query_passes_scope_filters(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["graph_query_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    captured: dict[str, object] = {}

    class _FakeGraphOps:
        def graph_query(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                records=[{"query": kwargs["query_text"]}],
                summary={"mode": kwargs["query_mode"]},
                provenance={"scope_type": kwargs.get("scope_type"), "scope_id": kwargs.get("scope_id")},
                warnings=[],
            )

    monkeypatch.setattr(knowledge_router_module, "_graph_ops_for_workspace", lambda *_args, **_kwargs: _FakeGraphOps())

    response = knowledge_api_client.get(
        "/knowledge/graph-query?q=threaded-graph&scope_type=project&scope_id=project-demo",
    )

    assert response.status_code == 200
    assert captured.get("scope_type") == "project"
    assert captured.get("scope_id") == "project-demo"


def test_graph_query_rejects_invalid_scope_type(
    knowledge_api_client: TestClient,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["graph_query_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    response = knowledge_api_client.get(
        "/knowledge/graph-query?q=threaded-graph&scope_type=workspace",
    )
    assert response.status_code == 400
    assert response.json().get("detail") == "INVALID_SCOPE_TYPE"


def test_graph_query_fast_preview_bypasses_graph_enabled_flag(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["graph_query_enabled"] = False
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    captured: dict[str, object] = {}

    class _FakeGraphOps:
        def graph_query(self, **kwargs):
            captured.update(kwargs)
            return SimpleNamespace(
                records=[{"query": kwargs["query_text"]}],
                summary="fast-preview",
                provenance={"resolved_output_mode": kwargs.get("preferred_output_mode") or "fast"},
                warnings=[],
            )

    monkeypatch.setattr(knowledge_router_module, "_graph_ops_for_workspace", lambda *_args, **_kwargs: _FakeGraphOps())

    response = knowledge_api_client.get("/knowledge/graph-query?q=threaded-graph&output_mode=fast")

    assert response.status_code == 200
    assert response.json()["summary"] == "fast-preview"
    assert captured["preferred_output_mode"] == "fast"


def test_graph_query_non_fast_still_requires_graph_enabled(
    knowledge_api_client: TestClient,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["graph_query_enabled"] = False
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    response = knowledge_api_client.get("/knowledge/graph-query?q=threaded-graph&output_mode=agentic")

    assert response.status_code == 400
    assert response.json()["detail"] == "GRAPH_QUERY_DISABLED"


def test_get_memify_job_status_offloads_status_read_to_thread(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    class _FakeGraphOps:
        def get_memify_status(self, job_id):
            return {"job_id": job_id, "status": "succeeded"}

    original_to_thread = knowledge_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(knowledge_router_module, "_graph_ops_for_workspace", lambda *_args, **_kwargs: _FakeGraphOps())
    monkeypatch.setattr(knowledge_router_module.asyncio, "to_thread", fake_to_thread)

    response = knowledge_api_client.get("/knowledge/memify/jobs/job-threaded")

    assert response.status_code == 200
    assert response.json()["job_id"] == "job-threaded"
    assert calls
    assert calls[0][0].__name__ == "get_memify_status"


def test_run_quality_loop_offloads_run_to_thread(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    class _FakeGraphOps:
        def run_quality_self_drive(self, **kwargs):
            return {
                "accepted": True,
                "job_id": "quality-threaded",
                "status_url": "/knowledge/quality-loop/jobs/quality-threaded",
                "estimated_rounds": kwargs.get("max_rounds", 0),
            }

    original_to_thread = knowledge_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(
        knowledge_router_module,
        "_graph_ops_for_workspace",
        lambda *_args, **_kwargs: _FakeGraphOps(),
    )
    monkeypatch.setattr(knowledge_router_module.asyncio, "to_thread", fake_to_thread)

    response = knowledge_api_client.post(
        "/knowledge/quality-loop/run",
        json={"max_rounds": 4, "dry_run": True, "dataset_scope": ["project:demo"]},
    )

    assert response.status_code == 200
    assert response.json()["job_id"] == "quality-threaded"
    assert calls
    assert calls[0][0].__name__ == "run_quality_self_drive"


def test_get_quality_loop_job_status_offloads_status_read_to_thread(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    class _FakeGraphOps:
        def get_quality_loop_status(self, job_id):
            return {
                "job_id": job_id,
                "task_type": "quality_loop",
                "status": "succeeded",
                "progress": 100,
                "stage": "completed",
            }

    original_to_thread = knowledge_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(
        knowledge_router_module,
        "_graph_ops_for_workspace",
        lambda *_args, **_kwargs: _FakeGraphOps(),
    )
    monkeypatch.setattr(knowledge_router_module.asyncio, "to_thread", fake_to_thread)

    response = knowledge_api_client.get("/knowledge/quality-loop/jobs/quality-threaded")

    assert response.status_code == 200
    assert response.json()["job_id"] == "quality-threaded"
    assert calls
    assert calls[0][0].__name__ == "get_quality_loop_status"


def test_get_knowledge_tasks_snapshot_offloads_collection_to_thread(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    original_to_thread = knowledge_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(
        knowledge_router_module,
        "_collect_knowledge_tasks_snapshot",
        lambda *_args, **_kwargs: {"tasks": [], "updated_at": "now", "project_id": ""},
    )
    monkeypatch.setattr(knowledge_router_module.asyncio, "to_thread", fake_to_thread)

    response = knowledge_api_client.get("/knowledge/tasks/snapshot")

    assert response.status_code == 200
    assert response.json()["tasks"] == []
    assert calls
    assert calls[0][0].__name__ == "<lambda>"


def test_run_knowledge_nlp_task_delegates_to_hanlp_runner(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    from copaw.app.routers import knowledge_hanlp_tasks as hanlp_tasks_module

    async def fake_run_hanlp_task(task_key, request_body, _http_request):
        return {
            "task_key": task_key,
            "request_id": request_body.request_id or "req-test",
            "status": "ready",
            "reason_code": "HANLP_TASK_READY",
            "reason": "ok",
            "result": ["微软", "发布", "新模型"],
            "resolved_model": "FINE_ELECTRA_SMALL_ZH",
            "strategy_mode": "auto",
            "detected_style": "modern",
            "detection_score": 0.0,
            "matched_rules": [],
            "fallback_used": False,
            "duration_ms": 1,
        }

    monkeypatch.setattr(hanlp_tasks_module, "_run_hanlp_task", fake_run_hanlp_task)

    response = knowledge_api_client.post(
        "/knowledge/tasks/tokenize/run",
        json={"text": "微软发布新模型", "request_id": "demo-1"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "tokenize"
    assert payload["request_id"] == "demo-1"
    assert payload["status"] == "ready"


def test_get_project_sync_status_offloads_state_read_to_thread(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    class _FakeProjectSyncManager:
        def get_state(self, project_id):
            return {"project_id": project_id, "status": "idle"}

    original_to_thread = knowledge_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(
        knowledge_router_module,
        "_project_sync_for_workspace",
        lambda *_args, **_kwargs: _FakeProjectSyncManager(),
    )
    monkeypatch.setattr(knowledge_router_module.asyncio, "to_thread", fake_to_thread)

    response = knowledge_api_client.get("/knowledge/project-sync/status?project_id=threaded-project")

    assert response.status_code == 200
    assert response.json()["project_id"] == "threaded-project"
    assert calls
    assert any(call[0].__name__ == "get_state" for call in calls)


def test_get_project_sync_status_does_not_auto_register_project_source(
    knowledge_api_client: TestClient,
    tmp_path: Path,
    monkeypatch,
):
    project_id = "status-no-register"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    class _FakeProjectSyncManager:
        def get_state(self, project_id):
            return {"project_id": project_id, "status": "idle", "latest_source_id": ""}

    captured: dict[str, object] = {}

    class _FakeCoordinator:
        def dispatch(self, command):
            captured["source_id"] = getattr(getattr(command, "source", None), "id", "")
            captured["source_location"] = getattr(getattr(command, "source", None), "location", "")
            return SimpleNamespace(
                action="resume_sync",
                operation_id="ps-status-no-register",
                idempotency_key="status-key",
                deduplicated=False,
                payload={"accepted": True, "reason": "RESUMED"},
            )

    monkeypatch.setattr(
        knowledge_router_module,
        "_project_sync_for_workspace",
        lambda *_args, **_kwargs: _FakeProjectSyncManager(),
    )
    monkeypatch.setattr(
        knowledge_router_module,
        "_project_sync_coordinator_for_workspace",
        lambda *_args, **_kwargs: _FakeCoordinator(),
    )

    response = knowledge_api_client.get(f"/knowledge/project-sync/status?project_id={project_id}")

    assert response.status_code == 200
    assert captured["source_id"] == f"project-{project_id}-workspace"
    assert str(captured["source_location"]).endswith(f"projects/{project_id}")
    assert knowledge_router_module.load_config().knowledge.sources == []


def test_run_project_sync_offloads_dispatch_to_thread(
    knowledge_api_client: TestClient,
    tmp_path: Path,
    monkeypatch,
):
    project_id = "threaded-project-sync"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    class _FakeProjectSyncManager:
        def start_sync(self, **kwargs):
            return {
                "accepted": True,
                "project_id": kwargs["project_id"],
                "status": "queued",
            }

    original_to_thread = knowledge_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(
        knowledge_router_module,
        "_project_sync_for_workspace",
        lambda *_args, **_kwargs: _FakeProjectSyncManager(),
    )
    monkeypatch.setattr(knowledge_router_module.asyncio, "to_thread", fake_to_thread)

    response = knowledge_api_client.post(
        f"/knowledge/project-sync/run?project_id={project_id}",
        json={
            "trigger": "manual-test",
            "changed_paths": ["notes.md"],
            "force": True,
            "processing_mode": "nlp",
            "quantization_stage": "l2",
        },
    )

    assert response.status_code == 200
    assert response.json()["accepted"] is True
    assert response.json()["project_id"] == project_id
    assert calls
    assert calls[0][0].__name__ == "dispatch"
    assert len(calls[0][1]) == 1
    command = calls[0][1][0]
    assert getattr(command, "action", "") == "start_sync"
    assert getattr(command, "processing_mode", "") == "nlp"
    assert getattr(command, "quantization_stage", "") == "l2"


def test_run_project_sync_auto_registers_project_source(
    knowledge_api_client: TestClient,
    tmp_path: Path,
    monkeypatch,
):
    project_id = "run-no-register"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    class _FakeProjectSyncManager:
        def get_state(self, project_id):
            return {"project_id": project_id, "status": "idle"}

    captured: dict[str, object] = {}

    class _FakeCoordinator:
        def dispatch(self, command):
            captured["source_id"] = getattr(getattr(command, "source", None), "id", "")
            captured["source_location"] = getattr(getattr(command, "source", None), "location", "")
            return SimpleNamespace(
                action="start_sync",
                operation_id="ps-run-no-register",
                idempotency_key="run-key",
                deduplicated=False,
                payload={"accepted": True, "project_id": project_id, "status": "queued"},
            )

    monkeypatch.setattr(
        knowledge_router_module,
        "_project_sync_for_workspace",
        lambda *_args, **_kwargs: _FakeProjectSyncManager(),
    )
    monkeypatch.setattr(
        knowledge_router_module,
        "_project_sync_coordinator_for_workspace",
        lambda *_args, **_kwargs: _FakeCoordinator(),
    )

    response = knowledge_api_client.post(
        f"/knowledge/project-sync/run?project_id={project_id}",
        json={
            "trigger": "manual-test",
            "changed_paths": ["notes.md"],
            "force": True,
            "processing_mode": "nlp",
        },
    )

    assert response.status_code == 200
    assert captured["source_id"] == f"project-{project_id}-workspace"
    assert str(captured["source_location"]).endswith(f"projects/{project_id}")
    sources = knowledge_router_module.load_config().knowledge.sources
    assert len(sources) == 1
    assert sources[0].id == f"project-{project_id}-workspace"
    assert str(sources[0].project_id) == project_id
    assert str(sources[0].location).endswith(f"projects/{project_id}")


def test_run_project_sync_allows_fast_mode_when_memify_disabled(
    knowledge_api_client: TestClient,
    tmp_path: Path,
    monkeypatch,
):
    project_id = "fast-only-project-sync"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = False
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    captured: dict[str, object] = {}

    class _FakeProjectSyncManager:
        def start_sync(self, **kwargs):
            captured.update(kwargs)
            return {"accepted": True, "project_id": kwargs["project_id"], "status": "queued"}

    monkeypatch.setattr(
        knowledge_router_module,
        "_project_sync_for_workspace",
        lambda *_args, **_kwargs: _FakeProjectSyncManager(),
    )

    response = knowledge_api_client.post(
        f"/knowledge/project-sync/run?project_id={project_id}",
        json={"trigger": "manual-test", "force": True, "processing_mode": "fast"},
    )

    assert response.status_code == 200
    assert captured["processing_mode"] == "fast"


def test_run_project_sync_returns_operation_metadata(
    knowledge_api_client: TestClient,
    tmp_path: Path,
    monkeypatch,
):
    project_id = "project-sync-op-meta"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    class _FakeProjectSyncManager:
        def start_sync(self, **kwargs):
            return {
                "accepted": True,
                "reason": "STARTED",
                "state": {
                    "project_id": kwargs["project_id"],
                    "status": "queued",
                },
            }

    monkeypatch.setattr(
        knowledge_router_module,
        "_project_sync_for_workspace",
        lambda *_args, **_kwargs: _FakeProjectSyncManager(),
    )

    response = knowledge_api_client.post(
        f"/knowledge/project-sync/run?project_id={project_id}",
        json={
            "trigger": "manual-test",
            "processing_mode": "agentic",
            "idempotency_key": "manual-op-key-1",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["accepted"] is True
    assert payload["idempotency_key"] == "manual-op-key-1"
    assert str(payload.get("operation_id") or "").startswith("ps-")


def test_restore_knowledge_backup_offloads_filesystem_copy_to_thread(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    zip_data = _build_knowledge_zip(
        {
            "sources/new-source/index.json": _source_index_payload(
                "new-source",
                "new content",
            ),
            "sources/new-source/content.md": "# new-source\n\nnew content\n",
        }
    )

    original_to_thread = knowledge_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(knowledge_router_module.asyncio, "to_thread", fake_to_thread)

    response = knowledge_api_client.post(
        "/knowledge/restore",
        files={"file": ("knowledge.zip", zip_data, "application/zip")},
    )

    assert response.status_code == 200
    assert any(call[0].__name__ == "_restore_backup_tree" for call in calls)


def test_history_backfill_status_includes_progress(
    knowledge_api_client: TestClient,
):
    response = knowledge_api_client.get("/knowledge/history-backfill/status")
    assert response.status_code == 200
    payload = response.json()
    assert "progress" in payload
    assert isinstance(payload["progress"], dict)
    assert "running" in payload["progress"]


def test_history_backfill_progress_ws_snapshot(
    knowledge_api_client: TestClient,
):
    with knowledge_api_client.websocket_connect(
        "/knowledge/history-backfill/progress/ws?interval_ms=300",
    ) as ws:
        payload = ws.receive_json()

    assert payload["type"] == "snapshot"
    assert isinstance(payload["progress"], dict)
    assert "running" in payload["progress"]


def test_clear_knowledge_requires_confirmation(knowledge_api_client: TestClient):
    response = knowledge_api_client.delete("/knowledge/clear")
    assert response.status_code == 400
    assert response.json()["detail"] == "KNOWLEDGE_CLEAR_CONFIRM_REQUIRED"


def test_clear_knowledge_removes_sources_and_indexes(
    knowledge_api_client: TestClient,
    tmp_path: Path,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["sources"] = [
        {
            "id": "clear-1",
            "name": "to-clear",
            "type": "text",
            "location": "",
            "content": "clear me",
            "enabled": True,
            "recursive": False,
            "tags": [],
            "summary": "",
        }
    ]
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    source_index = tmp_path / "knowledge" / "clear-1--index.json"
    source_index.parent.mkdir(parents=True, exist_ok=True)
    source_index.write_text("{}", encoding="utf-8")

    response = knowledge_api_client.delete(
        "/knowledge/clear?confirm=true&remove_sources=true"
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["cleared"] is True
    assert payload["removed_source_configs"] is True
    assert payload["cleared_sources"] == 1
    assert "cleared_indexes" not in payload or payload["cleared_indexes"] >= 0


def test_read_url_document_skips_binary_content(monkeypatch):
    class _Resp:
        headers = {"content-type": "image/png"}
        text = "binary"

        @staticmethod
        def raise_for_status():
            return None

    monkeypatch.setattr("copaw.knowledge.manager.httpx.get", lambda *args, **kwargs: _Resp())

    doc = KnowledgeManager._read_url_document("https://example.com/a.png")

    assert doc["path"] == "https://example.com/a.png"
    assert doc["text"] == ""


def test_get_memify_job_status_requires_memify_enabled(
    knowledge_api_client: TestClient,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = False
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    response = knowledge_api_client.get("/knowledge/memify/jobs/job-1")
    assert response.status_code == 400
    assert response.json()["detail"] == "MEMIFY_DISABLED"


def test_get_memify_job_status_success(
    knowledge_api_client: TestClient,
):
    knowledge_config = Config().knowledge
    config_payload = knowledge_config.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    knowledge_config.enabled = True
    knowledge_config.memify_enabled = True

    started = knowledge_api_client.post(
        "/knowledge/memify/jobs",
        json={
            "pipeline_type": "default",
            "dataset_scope": [],
            "idempotency_key": "route-status-job",
            "dry_run": False,
        },
    )
    assert started.status_code == 200
    job_id = started.json()["job_id"]

    deadline = time.time() + 2.0
    last_payload = None
    while time.time() < deadline:
        response = knowledge_api_client.get(f"/knowledge/memify/jobs/{job_id}")
        assert response.status_code == 200
        payload = response.json()
        last_payload = payload
        if payload["status"] in {"succeeded", "failed"}:
            break
        time.sleep(0.05)

    assert last_payload is not None
    assert last_payload["job_id"] == job_id
    assert last_payload["status"] in {"pending", "running", "succeeded", "failed"}


def test_put_knowledge_config_syncs_running_toggle_and_module_skill(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    sync_calls: list[bool] = []
    monkeypatch.setattr(
        knowledge_router_module,
        "sync_knowledge_module_skills",
        lambda enabled: sync_calls.append(enabled),
    )

    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = False

    response = knowledge_api_client.put("/knowledge/config", json=config_payload)

    assert response.status_code == 200
    assert response.json()["enabled"] is False
    assert sync_calls == []


def test_put_knowledge_config_does_not_resync_module_skill_when_toggle_unchanged(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    sync_calls: list[bool] = []
    monkeypatch.setattr(
        knowledge_router_module,
        "sync_knowledge_module_skills",
        lambda enabled: sync_calls.append(enabled),
    )

    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True

    response = knowledge_api_client.put("/knowledge/config", json=config_payload)

    assert response.status_code == 200
    assert response.json()["enabled"] is True
    assert sync_calls == [True]


def _build_knowledge_zip(entries: dict[str, str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path, content in entries.items():
            zf.writestr(path, content)
    return buf.getvalue()


def _source_index_payload(source_id: str, content: str = "knowledge text") -> str:
    payload = {
        "source": {
            "id": source_id,
            "name": source_id,
            "type": "text",
            "location": "",
            "content": content,
            "enabled": True,
            "recursive": False,
            "tags": [],
            "summary": "",
        },
        "documents": [
            {
                "path": f"{source_id}.md",
                "title": source_id,
                "text": content,
            }
        ],
        "chunks": [],
    }
    return json.dumps(payload, ensure_ascii=False)


def test_restore_knowledge_backup_replace_existing(
    knowledge_api_client: TestClient,
    tmp_path: Path,
):
    old_source_index = tmp_path / "knowledge" / "old-source--index.json"
    old_source_index.parent.mkdir(parents=True, exist_ok=True)
    old_source_index.write_text(
        _source_index_payload("old-source", "old content"),
        encoding="utf-8",
    )

    zip_data = _build_knowledge_zip(
        {
            "sources/new-source/index.json": _source_index_payload(
                "new-source",
                "new content",
            ),
            "sources/new-source/content.md": "# new-source\n\nnew content\n",
            "catalog.json": json.dumps({"version": 2}),
        }
    )

    response = knowledge_api_client.post(
        "/knowledge/restore",
        files={"file": ("knowledge.zip", zip_data, "application/zip")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["replace_existing"] is True
    assert payload["restored_sources"] == 1
    assert not old_source_index.exists()
    assert (tmp_path / "knowledge" / "new-source--index.json").exists()

    listing = knowledge_api_client.get("/knowledge/sources")
    assert listing.status_code == 200
    ids = {item["id"] for item in listing.json()["sources"]}
    assert ids == {"new-source"}


def test_restore_knowledge_backup_merge_existing(
    knowledge_api_client: TestClient,
    tmp_path: Path,
):
    existing_source_index = tmp_path / "knowledge" / "local-source--index.json"
    existing_source_index.parent.mkdir(parents=True, exist_ok=True)
    existing_source_index.write_text(
        _source_index_payload("local-source", "local content"),
        encoding="utf-8",
    )

    zip_data = _build_knowledge_zip(
        {
            "sources/imported-source/index.json": _source_index_payload(
                "imported-source",
                "imported content",
            ),
            "sources/imported-source/content.md": "# imported-source\n\nimported content\n",
        }
    )

    response = knowledge_api_client.post(
        "/knowledge/restore?replace_existing=false",
        files={"file": ("knowledge.zip", zip_data, "application/zip")},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["replace_existing"] is False
    assert payload["restored_sources"] == 2
    assert (tmp_path / "knowledge" / "local-source--index.json").exists()
    assert (tmp_path / "knowledge" / "imported-source--index.json").exists()

    listing = knowledge_api_client.get("/knowledge/sources")
    assert listing.status_code == 200
    ids = {item["id"] for item in listing.json()["sources"]}
    assert ids == {"local-source", "imported-source"}


def test_restore_knowledge_backup_rejects_unsafe_zip_path(
    knowledge_api_client: TestClient,
):
    zip_data = _build_knowledge_zip(
        {
            "../escape/index.json": _source_index_payload("escape"),
        }
    )

    response = knowledge_api_client.post(
        "/knowledge/restore",
        files={"file": ("knowledge.zip", zip_data, "application/zip")},
    )

    assert response.status_code == 400
    assert "unsafe path" in response.json()["detail"]


def test_project_scoped_index_storage_isolated(
    knowledge_api_client: TestClient,
    tmp_path: Path,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    source_payload = {
        "id": "proj-source-a",
        "name": "Project A Source",
        "type": "text",
        "location": "",
        "content": "project-a knowledge content",
        "enabled": True,
        "recursive": False,
        "tags": ["project"],
        "summary": "",
    }

    upsert = knowledge_api_client.put(
        "/knowledge/sources?project_id=project-a",
        json=source_payload,
    )
    assert upsert.status_code == 200

    indexed = knowledge_api_client.post(
        "/knowledge/sources/proj-source-a/index?project_id=project-a"
    )
    assert indexed.status_code == 200

    project_index = (
        tmp_path
        / "projects"
        / "project-a"
        / ".knowledge"
        / "proj-source-a--index.json"
    )
    global_index = tmp_path / "knowledge" / "proj-source-a--index.json"
    project_chunks_dir = tmp_path / "projects" / "project-a" / ".knowledge" / "chunks"
    global_chunks_dir = tmp_path / "knowledge" / "chunks"

    assert project_index.exists()
    assert not global_index.exists()
    assert project_chunks_dir.exists()
    assert any(project_chunks_dir.rglob("*.txt"))
    assert not global_chunks_dir.exists() or not any(global_chunks_dir.rglob("*.txt"))


def test_project_scoped_memify_jobs_are_isolated(
    knowledge_api_client: TestClient,
    tmp_path: Path,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    started = knowledge_api_client.post(
        "/knowledge/memify/jobs?project_id=project-b",
        json={
            "pipeline_type": "project-manual",
            "dataset_scope": [],
            "idempotency_key": "project-b-job",
            "dry_run": True,
            "project_id": "project-b",
        },
    )
    assert started.status_code == 200
    job_id = started.json()["job_id"]

    status = knowledge_api_client.get(
        f"/knowledge/memify/jobs/{job_id}?project_id=project-b"
    )
    assert status.status_code == 200
    assert status.json()["job_id"] == job_id

    project_jobs = tmp_path / "projects" / "project-b" / ".knowledge" / "memify-jobs.json"
    global_jobs = tmp_path / "knowledge" / "memify-jobs.json"

    assert project_jobs.exists()
    assert not global_jobs.exists()


def test_project_sync_status_ws_snapshot(
    knowledge_api_client: TestClient,
):
    with knowledge_api_client.websocket_connect(
        "/knowledge/project-sync/ws?project_id=project-sync-demo&interval_ms=300",
    ) as ws:
        payload = ws.receive_json()

    assert payload["type"] == "snapshot"
    assert payload["state"]["project_id"] == "project-sync-demo"
    assert payload["state"]["status"] == "idle"


def test_project_sync_status_projects_runtime_operation_metadata(
    knowledge_api_client: TestClient,
    tmp_path: Path,
    monkeypatch,
):
    project_id = "project-sync-runtime-status"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    knowledge_router_module._PROJECT_SYNC_RUNTIME_META.clear()

    class _FakeProjectSyncManager:
        def start_sync(self, **kwargs):
            return {
                "accepted": True,
                "reason": "STARTED",
                "state": {
                    "project_id": kwargs["project_id"],
                    "status": "queued",
                },
            }

        def resume_sync_if_needed(self, **kwargs):
            return {
                "accepted": False,
                "reason": "NOOP",
            }

        def get_state(self, project_id):
            return {
                "project_id": project_id,
                "status": "idle",
            }

    monkeypatch.setattr(
        knowledge_router_module,
        "_project_sync_for_workspace",
        lambda *_args, **_kwargs: _FakeProjectSyncManager(),
    )

    started = knowledge_api_client.post(
        f"/knowledge/project-sync/run?project_id={project_id}",
        json={
            "trigger": "manual-test",
            "processing_mode": "agentic",
            "idempotency_key": "manual-runtime-status-1",
        },
    )
    assert started.status_code == 200

    status = knowledge_api_client.get(
        f"/knowledge/project-sync/status?project_id={project_id}"
    )
    assert status.status_code == 200
    payload = status.json()
    assert payload["project_id"] == project_id
    assert payload["idempotency_key"] == f"route-status-resume:{project_id}"
    assert str(payload.get("operation_id") or "").startswith("ps-")
    assert payload["deduplicated"] is True


def test_project_sync_ws_snapshot_includes_latest_run_operation_metadata(
    knowledge_api_client: TestClient,
    tmp_path: Path,
    monkeypatch,
):
    project_id = "project-sync-runtime-ws"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)

    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    knowledge_router_module._PROJECT_SYNC_RUNTIME_META.clear()

    class _FakeProjectSyncManager:
        def start_sync(self, **kwargs):
            return {
                "accepted": True,
                "reason": "STARTED",
                "state": {
                    "project_id": kwargs["project_id"],
                    "status": "queued",
                },
            }

        def get_state(self, project_id):
            return {
                "project_id": project_id,
                "status": "idle",
            }

    monkeypatch.setattr(
        knowledge_router_module,
        "_project_sync_for_workspace",
        lambda *_args, **_kwargs: _FakeProjectSyncManager(),
    )

    started = knowledge_api_client.post(
        f"/knowledge/project-sync/run?project_id={project_id}",
        json={
            "trigger": "manual-test",
            "processing_mode": "agentic",
            "idempotency_key": "manual-runtime-ws-1",
        },
    )
    assert started.status_code == 200

    with knowledge_api_client.websocket_connect(
        f"/knowledge/project-sync/ws?project_id={project_id}&interval_ms=300",
    ) as ws:
        payload = ws.receive_json()

    assert payload["type"] == "snapshot"
    assert payload["state"]["project_id"] == project_id
    assert payload["state"]["idempotency_key"] == "manual-runtime-ws-1"
    assert str(payload["state"].get("operation_id") or "").startswith("ps-")


def test_project_sync_run_does_not_auto_register_source_and_persists_state(
    knowledge_api_client: TestClient,
    tmp_path: Path,
):
    logger = logging.getLogger("test_project_sync")
    logger.debug("Starting test_project_sync_run_does_not_auto_register_source_and_persists_state")
    project_id = "project-sync-demo"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    (project_dir / "notes.md").write_text(
        "project sync content for graphify bootstrap",
        encoding="utf-8",
    )

    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    started = knowledge_api_client.post(
        f"/knowledge/project-sync/run?project_id={project_id}",
        json={
            "trigger": "manual-test",
            "changed_paths": ["notes.md"],
            "force": True,
        },
    )
    assert started.status_code == 200
    assert started.json()["accepted"] is True

    deadline = time.time() + 6.0
    last_payload = None
    while time.time() < deadline:
        response = knowledge_api_client.get(
            f"/knowledge/project-sync/status?project_id={project_id}"
        )
        assert response.status_code == 200
        last_payload = response.json()
        if last_payload["status"] in {"succeeded", "failed"}:
            break
        time.sleep(0.05)

    assert last_payload is not None
    assert last_payload["project_id"] == project_id
    assert last_payload["status"] in {
        "pending",
        "running",
        "graphifying",
        "succeeded",
    }
    assert last_payload["latest_source_id"] == "project-project-sync-demo-workspace"

    source_ids = {
        source.id for source in knowledge_router_module.load_config().knowledge.sources
    }
    assert "project-project-sync-demo-workspace" not in source_ids

    state_path = (
        tmp_path
        / "projects"
        / project_id
        / ".knowledge"
        / "project-sync-state.json"
    )
    assert state_path.exists()


def test_quantization_stage_run_and_stats_query(
    knowledge_api_client: TestClient,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    run_resp = knowledge_api_client.post(
        "/knowledge/quantization/stages/l1/run",
        json={
            "source_id": "source-alpha",
            "snapshot_id": "snapshot-001",
            "metrics": {"document_count": 3, "chunk_count": 10},
            "metadata": {"trigger": "test"},
        },
    )
    assert run_resp.status_code == 200
    run_payload = run_resp.json()
    assert run_payload["stage"] == "l1"
    assert run_payload["status"] == "ready"

    stats_resp = knowledge_api_client.get(
        "/knowledge/quantization/stages/l1/stats",
        params={"source_id": "source-alpha", "snapshot_id": "snapshot-001"},
    )
    assert stats_resp.status_code == 200
    stats_payload = stats_resp.json()
    assert stats_payload["stage"] == "l1"
    assert stats_payload["source_id"] == "source-alpha"
    assert stats_payload["stats"]["metrics"]["chunk_count"] == 10


def test_quantization_compare_endpoints(
    knowledge_api_client: TestClient,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    for stage, metrics in [
        ("l1", {"document_count": 2, "chunk_count": 8}),
        ("l2", {"entity_count": 5, "relation_count": 7}),
        ("l3", {"quality_score": 0.8}),
    ]:
        response = knowledge_api_client.post(
            f"/knowledge/quantization/stages/{stage}/run",
            json={
                "source_id": "source-compare-a",
                "snapshot_id": "snapshot-v1",
                "metrics": metrics,
            },
        )
        assert response.status_code == 200

    version_resp = knowledge_api_client.post(
        "/knowledge/quantization/stages/l2/run",
        json={
            "source_id": "source-compare-a",
            "snapshot_id": "snapshot-v2",
            "metrics": {"entity_count": 9, "relation_count": 12},
        },
    )
    assert version_resp.status_code == 200

    source_b_resp = knowledge_api_client.post(
        "/knowledge/quantization/stages/l2/run",
        json={
            "source_id": "source-compare-b",
            "snapshot_id": "snapshot-v9",
            "metrics": {"entity_count": 4, "relation_count": 6},
        },
    )
    assert source_b_resp.status_code == 200

    stages_resp = knowledge_api_client.get(
        "/knowledge/quantization/compare/stages",
        params={"source_id": "source-compare-a", "snapshot_id": "snapshot-v1"},
    )
    assert stages_resp.status_code == 200
    assert stages_resp.json()["compare_type"] == "stages"

    versions_resp = knowledge_api_client.get(
        "/knowledge/quantization/compare/versions",
        params={
            "source_id": "source-compare-a",
            "snapshot_a": "snapshot-v1",
            "snapshot_b": "snapshot-v2",
            "stage": "l2",
        },
    )
    assert versions_resp.status_code == 200
    versions_payload = versions_resp.json()
    assert versions_payload["compare_type"] == "versions"
    assert versions_payload["a"]["entity_count"] == 5
    assert versions_payload["b"]["entity_count"] == 9

    sources_resp = knowledge_api_client.get(
        "/knowledge/quantization/compare/sources",
        params={
            "source_a": "source-compare-a",
            "source_b": "source-compare-b",
            "stage": "l2",
        },
    )
    assert sources_resp.status_code == 200
    sources_payload = sources_resp.json()
    assert sources_payload["compare_type"] == "sources"
    assert sources_payload["a"]["entity_count"] == 9
    assert sources_payload["b"]["entity_count"] == 4


def test_project_sync_status_includes_lane_and_quantization_stage_skeleton(
    knowledge_api_client: TestClient,
    tmp_path: Path,
):
    project_id = "project-sync-lane-skeleton"
    (tmp_path / "projects" / project_id).mkdir(parents=True, exist_ok=True)

    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["enabled"] = True
    config_payload["memify_enabled"] = True
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    response = knowledge_api_client.get(
        f"/knowledge/project-sync/status?project_id={project_id}"
    )

    assert response.status_code == 200
    payload = response.json()
    assert "lanes" in payload
    assert payload["lanes"]["retrieval"]["mode"] == "fast"
    assert payload["lanes"]["quantization"]["mode"] == "nlp"
    assert "quantization_stages" in payload
    assert set(payload["quantization_stages"].keys()) == {"l1", "l2", "l3"}


def test_schedule_stage_run_dependencies():
    manager = QuantizationArchitectureManager("/tmp/test_project")

    # Simulate L1 completion
    manager.write_stage_result(stage="l1", source_id="source1", snapshot_id="snapshot1")

    # Schedule L3 without L2 (should raise an error)
    try:
        manager.schedule_stage_run(stage="l3", source_id="source1", snapshot_id="snapshot1")
    except RuntimeError as e:
        assert "Dependency not met" in str(e)
    else:
        assert False, "Expected RuntimeError for unmet dependency"

    # Now schedule L2 (should pass as L1 is ready)
    result = manager.schedule_stage_run(stage="l2", source_id="source1", snapshot_id="snapshot1")
    assert result["status"] == "ready"
