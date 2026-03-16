# -*- coding: utf-8 -*-

import hashlib
import asyncio
from pathlib import Path
from types import SimpleNamespace
import json
from datetime import UTC, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from copaw.app.routers import knowledge as knowledge_router_module
from copaw.config.config import Config
from copaw.constant import CHATS_FILE
from copaw.app.runner.session import sanitize_filename
from copaw.knowledge import KnowledgeManager
from copaw.config.config import LastDispatchConfig


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


def test_upsert_and_list_knowledge_sources(knowledge_api_client: TestClient):
    response = knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "docs-local",
            "name": "Local Docs",
            "type": "text",
            "content": "Knowledge layer planning notes.",
            "enabled": True,
            "recursive": True,
            "tags": ["docs"],
            "description": "Planning material",
        },
    )

    assert response.status_code == 200
    assert response.json()["id"] == "docs-local"

    listing = knowledge_api_client.get("/knowledge/sources")

    assert listing.status_code == 200
    body = listing.json()
    assert body["enabled"] is False
    assert len(body["sources"]) == 1
    assert body["sources"][0]["status"]["indexed"] is False


def test_upsert_source_auto_generates_name(knowledge_api_client: TestClient):
    response = knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "text-auto-title",
            "name": "Manual Title Should Be Ignored",
            "type": "text",
            "content": "This line should become the generated knowledge title.\nMore details.",
            "enabled": True,
            "recursive": False,
            "tags": [],
            "description": "",
        },
    )

    assert response.status_code == 200
    assert response.json()["name"] == "This line should become the generated knowledge title"


def test_upsert_image_source_accepts_location(knowledge_api_client: TestClient):
    response = knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "image-1",
            "name": "Screenshot",
            "type": "image",
            "location": "/tmp/screenshot.png",
            "enabled": True,
            "recursive": False,
            "tags": ["media"],
            "description": "image source",
        },
    )

    assert response.status_code == 200
    assert response.json()["type"] == "image"


def test_list_sources_uses_auto_generated_titles_for_existing_config(
    knowledge_api_client: TestClient,
):
    put_response = knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "url-auto-title",
            "name": "Old URL Name",
            "type": "url",
            "location": "https://example.com/path/to/guide.html",
            "enabled": True,
            "recursive": False,
            "tags": ["remote"],
            "description": "",
        },
    )
    assert put_response.status_code == 200

    listing = knowledge_api_client.get("/knowledge/sources")
    assert listing.status_code == 200
    source = listing.json()["sources"][0]
    assert source["name"] == "example.com/guide.html"


def test_regenerate_all_titles_endpoint(knowledge_api_client: TestClient):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["sources"] = [
        {
            "id": "regen-1",
            "name": "manual-1",
            "type": "text",
            "location": "",
            "content": "Semantic title from text content",
            "enabled": True,
            "recursive": False,
            "tags": [],
            "description": "",
        },
        {
            "id": "regen-2",
            "name": "manual-2",
            "type": "url",
            "location": "https://example.com/docs/semantic-title",
            "content": "",
            "enabled": True,
            "recursive": False,
            "tags": [],
            "description": "",
        },
    ]
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    regenerate = knowledge_api_client.post(
        "/knowledge/titles/regenerate?use_llm=true&confirm=true"
    )
    assert regenerate.status_code == 200
    payload = regenerate.json()
    assert payload["queued"] is True
    assert payload["job"]["total"] == 2
    assert payload["job"]["enabled_only"] is True
    assert payload["job"]["priority"] == "low"


def test_regenerate_titles_prefers_llm_when_available(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    class _ModelResp:
        text = "LLM semantic title"

    class _FakeModel:
        async def __call__(self, messages):
            assert isinstance(messages, list)
            return _ModelResp()

    monkeypatch.setattr(
        "copaw.knowledge.manager.create_model_and_formatter",
        lambda: (_FakeModel(), None),
    )

    saved = knowledge_api_client.put(
        "/knowledge/config",
        json={
            **Config().knowledge.model_dump(mode="json"),
            "sources": [
                {
                    "id": "llm-title-1",
                    "name": "Manual title",
                    "type": "text",
                    "location": "",
                    "content": "This is content for model generated title.",
                    "enabled": True,
                    "recursive": False,
                    "tags": [],
                    "description": "",
                }
            ],
        },
    )
    assert saved.status_code == 200

    regenerate = knowledge_api_client.post(
        "/knowledge/titles/regenerate?use_llm=true&confirm=true"
    )
    assert regenerate.status_code == 200
    assert regenerate.json()["queued"] is True


def test_regenerate_titles_requires_confirmation(knowledge_api_client: TestClient):
    regenerate = knowledge_api_client.post("/knowledge/titles/regenerate?use_llm=true")
    assert regenerate.status_code == 400
    assert regenerate.json()["detail"] == "KNOWLEDGE_TITLES_CONFIRM_REQUIRED"


def test_regenerate_titles_rejects_when_queue_is_active(
    knowledge_api_client: TestClient,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["sources"] = [
        {
            "id": "regen-active-1",
            "name": "manual-1",
            "type": "text",
            "location": "",
            "content": "Semantic title from text content",
            "enabled": True,
            "recursive": False,
            "tags": [],
            "description": "",
        },
    ]
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    first = knowledge_api_client.post(
        "/knowledge/titles/regenerate?use_llm=true&confirm=true"
    )
    assert first.status_code == 200
    second = knowledge_api_client.post(
        "/knowledge/titles/regenerate?use_llm=true&confirm=true"
    )
    assert second.status_code == 409
    assert second.json()["detail"] == "KNOWLEDGE_TITLES_QUEUE_ALREADY_ACTIVE"


def test_regenerate_titles_force_clear_restarts_active_queue(
    knowledge_api_client: TestClient,
):
    config_payload = Config().knowledge.model_dump(mode="json")
    config_payload["sources"] = [
        {
            "id": "regen-force-1",
            "name": "manual-1",
            "type": "text",
            "location": "",
            "content": "Semantic title from text content",
            "enabled": True,
            "recursive": False,
            "tags": [],
            "description": "",
        },
    ]
    saved = knowledge_api_client.put("/knowledge/config", json=config_payload)
    assert saved.status_code == 200

    first = knowledge_api_client.post(
        "/knowledge/titles/regenerate?use_llm=true&confirm=true"
    )
    assert first.status_code == 200
    first_job_id = first.json()["job"]["job_id"]

    restarted = knowledge_api_client.post(
        "/knowledge/titles/regenerate?use_llm=true&confirm=true&force_clear=true"
    )
    assert restarted.status_code == 200
    payload = restarted.json()
    assert payload["queued"] is True
    assert payload["force_clear"] is True
    assert payload["restarted"] is True
    assert payload["cleared_jobs"] >= 1
    assert first_job_id in payload["cleared_job_ids"]
    assert payload["job"]["job_id"] != first_job_id


def test_maintain_next_source_title_processes_one_each_call(tmp_path: Path, monkeypatch):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.sources = [
        knowledge_router_module.KnowledgeSourceSpec(
            id="s1",
            name="manual-1",
            type="text",
            content="First semantic title source",
            enabled=True,
            recursive=False,
            tags=[],
            description="",
        ),
        knowledge_router_module.KnowledgeSourceSpec(
            id="s2",
            name="manual-2",
            type="text",
            content="Second semantic title source",
            enabled=True,
            recursive=False,
            tags=[],
            description="",
        ),
    ]

    class _ModelResp:
        def __init__(self, text: str):
            self.text = text

    class _FakeModel:
        async def __call__(self, messages):
            prompt = messages[-1]["content"]
            if "First semantic title source" in prompt:
                return _ModelResp("Title One")
            return _ModelResp("Title Two")

    monkeypatch.setattr(
        "copaw.knowledge.manager.create_model_and_formatter",
        lambda: (_FakeModel(), None),
    )

    first = asyncio.run(manager.maintain_next_source_title(config, use_llm=True))
    second = asyncio.run(manager.maintain_next_source_title(config, use_llm=True))

    assert first["processed"] is True
    assert first["source_id"] == "s1"
    assert first["updated"] is True
    assert second["processed"] is True
    assert second["source_id"] == "s2"
    assert second["updated"] is True
    assert config.sources[0].name == "Title One"
    assert config.sources[1].name == "Title Two"


def test_title_regeneration_queue_processes_in_batches(tmp_path: Path, monkeypatch):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.sources = [
        knowledge_router_module.KnowledgeSourceSpec(
            id="q1",
            name="manual-1",
            type="text",
            content="First semantic title source",
            enabled=True,
            recursive=False,
            tags=[],
            description="",
        ),
        knowledge_router_module.KnowledgeSourceSpec(
            id="q2",
            name="manual-2",
            type="text",
            content="Second semantic title source",
            enabled=True,
            recursive=False,
            tags=[],
            description="",
        ),
    ]

    class _ModelResp:
        def __init__(self, text: str):
            self.text = text

    class _FakeModel:
        async def __call__(self, messages):
            prompt = messages[-1]["content"]
            if "First semantic title source" in prompt:
                return _ModelResp("Queue Title One")
            return _ModelResp("Queue Title Two")

    monkeypatch.setattr(
        "copaw.knowledge.manager.create_model_and_formatter",
        lambda: (_FakeModel(), None),
    )

    enqueue = manager.enqueue_title_regeneration(
        config,
        use_llm=True,
        enabled_only=True,
        batch_size=1,
    )
    assert enqueue["queued"] is True

    first = asyncio.run(manager.process_title_regen_queue_batch(config))
    assert first["processed"] is True
    assert first["job"]["status"] == "running"
    assert first["job"]["processed"] == 1

    second = asyncio.run(manager.process_title_regen_queue_batch(config))
    assert second["processed"] is True
    assert second["job"]["status"] == "completed"
    assert second["job"]["processed"] == 2

    assert config.sources[0].name == "Queue Title One"
    assert config.sources[1].name == "Queue Title Two"


def test_title_regeneration_queue_yields_between_llm_items(tmp_path: Path, monkeypatch):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.sources = [
        knowledge_router_module.KnowledgeSourceSpec(
            id="q1",
            name="manual-1",
            type="text",
            content="First semantic title source",
            enabled=True,
            recursive=False,
            tags=[],
            description="",
        ),
        knowledge_router_module.KnowledgeSourceSpec(
            id="q2",
            name="manual-2",
            type="text",
            content="Second semantic title source",
            enabled=True,
            recursive=False,
            tags=[],
            description="",
        ),
    ]

    class _ModelResp:
        def __init__(self, text: str):
            self.text = text

    class _FakeModel:
        async def __call__(self, messages):
            prompt = messages[-1]["content"]
            if "First semantic title source" in prompt:
                return _ModelResp("Queue Title One")
            return _ModelResp("Queue Title Two")

    sleep_calls: list[float] = []

    async def _fake_sleep(delay: float):
        sleep_calls.append(delay)

    monkeypatch.setattr(
        "copaw.knowledge.manager.create_model_and_formatter",
        lambda: (_FakeModel(), None),
    )
    monkeypatch.setattr("copaw.knowledge.manager.asyncio.sleep", _fake_sleep)

    enqueue = manager.enqueue_title_regeneration(
        config,
        use_llm=True,
        enabled_only=True,
        batch_size=2,
    )
    assert enqueue["queued"] is True

    result = asyncio.run(manager.process_title_regen_queue_batch(config))

    assert result["processed"] is True
    assert result["job"]["status"] == "completed"
    assert result["job"]["processed"] == 2
    assert result["job"]["last_processed_source_id"] == "q2"
    assert result["job"]["current_source_id"] is None
    assert sleep_calls == [2.0]
    assert result["job"]["timing_samples"] == 2
    assert result["job"]["last_item_duration_ms"] is not None
    assert result["job"]["avg_item_duration_ms"] is not None


def test_title_regeneration_queue_uses_adaptive_yield_when_dispatch_is_recent(
    tmp_path: Path,
    monkeypatch,
):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.sources = [
        knowledge_router_module.KnowledgeSourceSpec(
            id="q1",
            name="manual-1",
            type="text",
            content="First semantic title source",
            enabled=True,
            recursive=False,
            tags=[],
            description="",
        ),
        knowledge_router_module.KnowledgeSourceSpec(
            id="q2",
            name="manual-2",
            type="text",
            content="Second semantic title source",
            enabled=True,
            recursive=False,
            tags=[],
            description="",
        ),
    ]

    class _ModelResp:
        def __init__(self, text: str):
            self.text = text

    class _FakeModel:
        async def __call__(self, messages):
            prompt = messages[-1]["content"]
            if "First semantic title source" in prompt:
                return _ModelResp("Queue Title One")
            return _ModelResp("Queue Title Two")

    sleep_calls: list[float] = []

    async def _fake_sleep(delay: float):
        sleep_calls.append(delay)

    monkeypatch.setattr(
        "copaw.knowledge.manager.create_model_and_formatter",
        lambda: (_FakeModel(), None),
    )
    monkeypatch.setattr("copaw.knowledge.manager.asyncio.sleep", _fake_sleep)

    enqueue = manager.enqueue_title_regeneration(
        config,
        use_llm=True,
        enabled_only=True,
        batch_size=2,
        yield_interval_seconds=2.0,
    )
    assert enqueue["queued"] is True

    result = asyncio.run(
        manager.process_title_regen_queue_batch(
            config,
            SimpleNamespace(knowledge_maintenance_llm_yield_seconds=2.0),
            LastDispatchConfig(
                channel="console",
                user_id="u1",
                session_id="s1",
                dispatched_at=datetime.now(UTC).isoformat(),
            ),
        )
    )

    assert result["processed"] is True
    assert result["job"]["yield_mode"] == "adaptive"
    assert result["job"]["effective_yield_seconds"] == 6.0
    assert result["job"]["yield_reason"] == "burst_window"
    assert result["job"]["dispatch_age_seconds"] is not None
    assert sleep_calls == [6.0]


def test_title_regeneration_queue_uses_configured_adaptive_parameters(
    tmp_path: Path,
    monkeypatch,
):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.sources = [
        knowledge_router_module.KnowledgeSourceSpec(
            id="q1",
            name="manual-1",
            type="text",
            content="First semantic title source",
            enabled=True,
            recursive=False,
            tags=[],
            description="",
        ),
        knowledge_router_module.KnowledgeSourceSpec(
            id="q2",
            name="manual-2",
            type="text",
            content="Second semantic title source",
            enabled=True,
            recursive=False,
            tags=[],
            description="",
        ),
    ]

    class _ModelResp:
        def __init__(self, text: str):
            self.text = text

    class _FakeModel:
        async def __call__(self, messages):
            prompt = messages[-1]["content"]
            if "First semantic title source" in prompt:
                return _ModelResp("Queue Title One")
            return _ModelResp("Queue Title Two")

    sleep_calls: list[float] = []

    async def _fake_sleep(delay: float):
        sleep_calls.append(delay)

    monkeypatch.setattr(
        "copaw.knowledge.manager.create_model_and_formatter",
        lambda: (_FakeModel(), None),
    )
    monkeypatch.setattr("copaw.knowledge.manager.asyncio.sleep", _fake_sleep)

    enqueue = manager.enqueue_title_regeneration(
        config,
        use_llm=True,
        enabled_only=True,
        batch_size=2,
        yield_interval_seconds=2.0,
    )
    assert enqueue["queued"] is True

    running_cfg = SimpleNamespace(
        knowledge_maintenance_llm_yield_seconds=2.0,
        knowledge_title_regen_adaptive_active_window_seconds=120.0,
        knowledge_title_regen_adaptive_burst_window_seconds=30.0,
        knowledge_title_regen_adaptive_active_multiplier=2.5,
        knowledge_title_regen_adaptive_burst_multiplier=4.0,
    )

    result = asyncio.run(
        manager.process_title_regen_queue_batch(
            config,
            running_cfg,
            LastDispatchConfig(
                channel="console",
                user_id="u1",
                session_id="s1",
                dispatched_at=datetime.now(UTC).isoformat(),
            ),
        )
    )

    assert result["processed"] is True
    assert result["job"]["yield_mode"] == "adaptive"
    assert result["job"]["effective_yield_seconds"] == 8.0
    assert result["job"]["yield_reason"] == "burst_window"
    assert sleep_calls == [8.0]


def test_title_regeneration_queue_uses_fixed_reason_without_recent_dispatch(
    tmp_path: Path,
    monkeypatch,
):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.sources = [
        knowledge_router_module.KnowledgeSourceSpec(
            id="q1",
            name="manual-1",
            type="text",
            content="First semantic title source",
            enabled=True,
            recursive=False,
            tags=[],
            description="",
        ),
        knowledge_router_module.KnowledgeSourceSpec(
            id="q2",
            name="manual-2",
            type="text",
            content="Second semantic title source",
            enabled=True,
            recursive=False,
            tags=[],
            description="",
        ),
    ]

    class _ModelResp:
        def __init__(self, text: str):
            self.text = text

    class _FakeModel:
        async def __call__(self, messages):
            prompt = messages[-1]["content"]
            if "First semantic title source" in prompt:
                return _ModelResp("Queue Title One")
            return _ModelResp("Queue Title Two")

    sleep_calls: list[float] = []

    async def _fake_sleep(delay: float):
        sleep_calls.append(delay)

    monkeypatch.setattr(
        "copaw.knowledge.manager.create_model_and_formatter",
        lambda: (_FakeModel(), None),
    )
    monkeypatch.setattr("copaw.knowledge.manager.asyncio.sleep", _fake_sleep)

    enqueue = manager.enqueue_title_regeneration(
        config,
        use_llm=True,
        enabled_only=True,
        batch_size=2,
        yield_interval_seconds=1.5,
    )
    assert enqueue["queued"] is True

    result = asyncio.run(
        manager.process_title_regen_queue_batch(
            config,
            SimpleNamespace(knowledge_maintenance_llm_yield_seconds=1.5),
            None,
        )
    )

    assert result["processed"] is True
    assert result["job"]["yield_mode"] == "fixed"
    assert result["job"]["yield_reason"] == "no_recent_dispatch"
    assert result["job"]["effective_yield_seconds"] == 1.5
    assert result["job"]["dispatch_age_seconds"] is None
    assert sleep_calls == [1.5]


def test_enqueue_title_regeneration_accepts_custom_yield_interval(tmp_path: Path):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.sources = [
        knowledge_router_module.KnowledgeSourceSpec(
            id="q1",
            name="manual-1",
            type="text",
            content="First semantic title source",
            enabled=True,
            recursive=False,
            tags=[],
            description="",
        )
    ]

    result = manager.enqueue_title_regeneration(
        config,
        use_llm=True,
        enabled_only=True,
        batch_size=1,
        yield_interval_seconds=3.5,
    )

    assert result["queued"] is True
    assert result["job"]["yield_interval_seconds"] == 3.5


def test_index_file_source_and_search(
    knowledge_api_client: TestClient,
    tmp_path: Path,
):
    doc_path = tmp_path / "guide.md"
    doc_path.write_text(
        "CoPaw knowledge layer indexes documents and preserves provenance.\n",
        encoding="utf-8",
    )

    put_response = knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "guide",
            "name": "Guide",
            "type": "file",
            "location": str(doc_path),
            "enabled": True,
            "recursive": False,
            "tags": ["guide"],
            "description": "Single file guide",
        },
    )
    assert put_response.status_code == 200

    index_response = knowledge_api_client.post("/knowledge/sources/guide/index")

    assert index_response.status_code == 200
    assert index_response.json()["document_count"] == 1
    assert index_response.json()["chunk_count"] >= 1

    search_response = knowledge_api_client.get(
        "/knowledge/search",
        params={"q": "preserves provenance", "limit": 5},
    )

    assert search_response.status_code == 200
    hits = search_response.json()["hits"]
    assert len(hits) == 1
    assert hits[0]["source_id"] == "guide"
    assert "preserves provenance" in hits[0]["snippet"].lower()


def test_index_source_uses_running_chunk_size(tmp_path: Path):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.enabled = True

    doc_path = tmp_path / "chunked.md"
    doc_path.write_text("A" * 450, encoding="utf-8")
    source = knowledge_router_module.KnowledgeSourceSpec(
        id="chunked",
        name="Chunked",
        type="file",
        location=str(doc_path),
        enabled=True,
        recursive=False,
        tags=[],
        description="",
    )

    result = manager.index_source(
        source,
        config,
        SimpleNamespace(knowledge_chunk_size=200),
    )

    assert result["document_count"] == 1
    assert result["chunk_count"] == 3


def test_default_engine_rejects_multimedia_sources(tmp_path: Path):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge

    image_path = tmp_path / "shot.png"
    image_path.write_bytes(b"\x89PNG\r\n\x1a\n")

    source = knowledge_router_module.KnowledgeSourceSpec(
        id="img-source",
        name="Image Source",
        type="image",
        location=str(image_path),
        enabled=True,
        recursive=False,
        tags=[],
        description="",
    )

    with pytest.raises(ValueError, match="does not support multimedia"):
        manager.index_source(source, config)


def test_cognee_engine_fallback_to_default_for_indexing(tmp_path: Path, monkeypatch):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.engine.provider = "cognee"
    config.engine.fallback_to_default = True
    config.cognee.enabled = True

    doc_path = tmp_path / "fallback.md"
    doc_path.write_text("fallback to default engine", encoding="utf-8")

    source = knowledge_router_module.KnowledgeSourceSpec(
        id="fallback-source",
        name="Fallback Source",
        type="file",
        location=str(doc_path),
        enabled=True,
        recursive=False,
        tags=[],
        description="",
    )

    monkeypatch.setattr(
        manager,
        "_get_cognee_engine",
        lambda: (_ for _ in ()).throw(RuntimeError("cognee unavailable")),
    )

    result = manager.index_source(source, config)
    assert result["source_id"] == "fallback-source"
    assert result["document_count"] == 1


def test_cognee_search_mode_graph_only(tmp_path: Path, monkeypatch):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.engine.provider = "cognee"
    config.engine.fallback_to_default = False
    config.cognee.enabled = True
    config.cognee.search_mode = "graph"

    source = knowledge_router_module.KnowledgeSourceSpec(
        id="doc1",
        name="Doc1",
        type="text",
        content="hello world",
        enabled=True,
        recursive=False,
        tags=[],
        description="",
    )
    config.sources = [source]

    class _Engine:
        def __init__(self):
            self.called = []

        def search(self, query, config, limit=10, source_ids=None, source_types=None):
            self.called.append((query, limit))
            return {
                "query": query,
                "hits": [
                    {
                        "source_id": "doc1",
                        "source_name": "Doc1",
                        "source_type": "text",
                        "document_path": "doc1",
                        "document_title": "Doc1",
                        "score": 1.0,
                        "snippet": "graph result",
                    }
                ],
            }

    fake = _Engine()
    monkeypatch.setattr(manager, "_get_cognee_engine", lambda: fake)

    result = manager.search("what is doc1", config, limit=3)
    assert fake.called == [("what is doc1", 3)]
    assert result["hits"][0]["snippet"] == "graph result"


def test_cognee_engine_search_mode_filters_queries(monkeypatch, tmp_path: Path):
    from copaw.knowledge.cognee_engine import CogneeEngine

    engine = CogneeEngine(tmp_path / "indexes")
    engine.index_dir.mkdir(parents=True, exist_ok=True)

    config = Config().knowledge
    config.cognee.enabled = True
    config.cognee.dataset_prefix = "copaw"
    config.cognee.search_mode = "chunks"
    config.sources = [
        knowledge_router_module.KnowledgeSourceSpec(
            id="s1",
            name="S1",
            type="text",
            content="abc",
            enabled=True,
            recursive=False,
            tags=[],
            description="",
        )
    ]

    class _CogneeModule:
        def __init__(self):
            self.calls = []

        async def search(self, *args, **kwargs):
            self.calls.append(kwargs.get("query_type"))
            return [{"snippet": "chunk only"}]

    fake_cognee = _CogneeModule()
    monkeypatch.setattr(
        engine,
        "_load_cognee_modules",
        lambda: (fake_cognee, None),
    )

    result = engine.search("abc", config, limit=2)
    assert len(result["hits"]) == 1
    assert fake_cognee.calls == ["CHUNKS"]


def test_manager_search_falls_back_to_default_when_cognee_fails(
    tmp_path: Path,
    monkeypatch,
):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge

    source = knowledge_router_module.KnowledgeSourceSpec(
        id="fallback-search",
        name="Fallback Search",
        type="text",
        content="CoPaw can fallback to lexical search when cognee is unavailable.",
        enabled=True,
        recursive=False,
        tags=[],
        description="",
    )
    config.sources = [source]

    # Build default index first.
    manager.index_source(source, config)

    # Switch to cognee mode and force cognee failure.
    config.engine.provider = "cognee"
    config.engine.fallback_to_default = True
    config.cognee.enabled = True
    monkeypatch.setattr(
        manager,
        "_get_cognee_engine",
        lambda: (_ for _ in ()).throw(RuntimeError("cognee unavailable")),
    )

    result = manager.search("fallback lexical", config, limit=3)
    assert len(result["hits"]) >= 1
    assert result["hits"][0]["source_id"] == "fallback-search"


def test_manager_search_raises_when_cognee_fails_and_fallback_disabled(
    tmp_path: Path,
    monkeypatch,
):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.engine.provider = "cognee"
    config.engine.fallback_to_default = False
    config.cognee.enabled = True
    config.sources = [
        knowledge_router_module.KnowledgeSourceSpec(
            id="strict-search",
            name="Strict Search",
            type="text",
            content="strict failure mode",
            enabled=True,
            recursive=False,
            tags=[],
            description="",
        )
    ]

    monkeypatch.setattr(
        manager,
        "_get_cognee_engine",
        lambda: (_ for _ in ()).throw(RuntimeError("cognee unavailable")),
    )

    with pytest.raises(RuntimeError, match="cognee unavailable"):
        manager.search("strict failure", config)


def test_manager_uses_default_when_provider_is_default_even_if_cognee_enabled(
    tmp_path: Path,
    monkeypatch,
):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.engine.provider = "default"
    config.cognee.enabled = True

    source = knowledge_router_module.KnowledgeSourceSpec(
        id="provider-default",
        name="Provider Default",
        type="text",
        content="default provider path",
        enabled=True,
        recursive=False,
        tags=[],
        description="",
    )
    config.sources = [source]

    called = {"cognee": False}

    def _should_not_call():
        called["cognee"] = True
        raise RuntimeError("should not call cognee")

    monkeypatch.setattr(manager, "_get_cognee_engine", _should_not_call)

    manager.index_source(source, config)
    result = manager.search("provider", config)

    assert called["cognee"] is False
    assert len(result["hits"]) >= 1


def test_delete_source_removes_index(
    knowledge_api_client: TestClient,
    tmp_path: Path,
):
    doc_path = tmp_path / "delete-me.md"
    doc_path.write_text("delete source index test", encoding="utf-8")

    knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "delete-me",
            "name": "Delete Me",
            "type": "file",
            "location": str(doc_path),
            "enabled": True,
            "recursive": False,
            "tags": [],
            "description": "",
        },
    )
    knowledge_api_client.post("/knowledge/sources/delete-me/index")

    response = knowledge_api_client.delete("/knowledge/sources/delete-me")

    assert response.status_code == 200
    assert response.json()["deleted"] is True

    listing = knowledge_api_client.get("/knowledge/sources")
    assert listing.status_code == 200
    assert listing.json()["sources"] == []


def test_index_url_source_and_search(
    knowledge_api_client: TestClient,
    monkeypatch,
):
    monkeypatch.setattr(
        knowledge_router_module.KnowledgeManager,
        "_read_url_document",
        staticmethod(lambda url: knowledge_router_module.KnowledgeManager._normalize_text and {
            "path": url,
            "title": url,
            "text": "Knowledge Doc CoPaw can index remote documentation.",
        }),
    )

    response = knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "remote-doc",
            "name": "Remote Doc",
            "type": "url",
            "location": "https://example.com/docs",
            "enabled": True,
            "recursive": False,
            "tags": ["remote"],
            "description": "Remote documentation",
        },
    )

    assert response.status_code == 200

    index_response = knowledge_api_client.post(
        "/knowledge/sources/remote-doc/index",
    )
    assert index_response.status_code == 200

    search_response = knowledge_api_client.get(
        "/knowledge/search",
        params={"q": "remote documentation", "source_types": "url"},
    )
    assert search_response.status_code == 200
    hits = search_response.json()["hits"]
    assert len(hits) == 1
    assert hits[0]["source_type"] == "url"


def test_upload_file_endpoint_returns_saved_location(
    knowledge_api_client: TestClient,
):
    response = knowledge_api_client.post(
        "/knowledge/upload/file",
        data={"source_id": "upload-test"},
        files={"file": ("notes.md", b"hello knowledge", "text/markdown")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["filename"] == "notes.md"
    assert body["location"].endswith("notes.md")


def test_history_backfill_status_endpoint(
    knowledge_api_client: TestClient,
    tmp_path: Path,
):
    chats_path = tmp_path / CHATS_FILE
    chats_path.write_text(
        json.dumps(
            {
                "version": 1,
                "chats": [
                    {
                        "id": "chat-1",
                        "name": "Legacy",
                        "session_id": "console:user-1",
                        "user_id": "user-1",
                    }
                ],
            },
        ),
        encoding="utf-8",
    )

    response = knowledge_api_client.get("/knowledge/history-backfill/status")
    assert response.status_code == 200
    body = response.json()
    assert body["history_chat_count"] == 1
    assert body["marked_unbackfilled"] is True
    assert body["has_pending_history"] is True


def test_run_history_backfill_endpoint(
    knowledge_api_client: TestClient,
    tmp_path: Path,
    monkeypatch,
):
    _ = knowledge_api_client.put(
        "/knowledge/config",
        json={
            **Config().knowledge.model_dump(mode="json"),
            "enabled": True,
        },
    )

    chats_path = tmp_path / CHATS_FILE
    chats_path.write_text(
        json.dumps(
            {
                "version": 1,
                "chats": [
                    {
                        "id": "chat-1",
                        "name": "Legacy",
                        "session_id": "console:user-2",
                        "user_id": "user-2",
                    }
                ],
            },
        ),
        encoding="utf-8",
    )

    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    session_file = sessions_dir / (
        f"{sanitize_filename('user-2')}_{sanitize_filename('console:user-2')}.json"
    )
    session_file.write_text(
        json.dumps(
            {
                "agent": {
                    "memory": {
                        "content": [
                            [
                                {
                                    "id": "m2",
                                    "role": "assistant",
                                    "type": "message",
                                    "content": [
                                        {
                                            "type": "text",
                                            "text": "history url https://example.com/history-2",
                                        }
                                    ],
                                },
                                [],
                            ]
                        ]
                    }
                }
            },
        ),
        encoding="utf-8",
    )

    class _Resp:
        status_code = 200
        headers = {"content-type": "text/plain"}
        text = "ok"

        def raise_for_status(self):
            return None

    monkeypatch.setattr(
        "copaw.knowledge.manager.httpx.get",
        lambda url, timeout, follow_redirects: _Resp(),
    )

    response = knowledge_api_client.post("/knowledge/history-backfill/run")
    assert response.status_code == 200
    body = response.json()
    assert body["result"]["skipped"] is False
    assert body["result"]["processed_sessions"] == 1
    assert body["status"]["backfill_completed"] is True


def test_chat_source_can_index_persisted_history(
    knowledge_api_client: TestClient,
    tmp_path: Path,
):
    chats_path = tmp_path / CHATS_FILE
    chats_path.write_text(
        json.dumps(
            {
                "version": 1,
                "chats": [
                    {
                        "id": "chat-1",
                        "name": "Editorial Notes",
                        "session_id": "console:user-1",
                        "user_id": "user-1",
                        "channel": "console",
                        "created_at": "2026-03-16T00:00:00Z",
                        "updated_at": "2026-03-16T00:00:00Z",
                        "meta": {},
                    }
                ],
            },
        ),
        encoding="utf-8",
    )
    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    session_file = sessions_dir / (
        f"{sanitize_filename('user-1')}_{sanitize_filename('console:user-1')}.json"
    )
    session_file.write_text(
        json.dumps(
            {
                "agent": {
                    "memory": {
                        "content": [
                            [
                                {
                                    "id": "m1",
                                    "role": "assistant",
                                    "type": "message",
                                    "content": [
                                        {
                                            "type": "text",
                                            "text": "The assistant discussed chapter sequencing.",
                                        }
                                    ],
                                },
                                [],
                            ],
                            [
                                {
                                    "id": "m2",
                                    "role": "assistant",
                                    "type": "plugin_call_output",
                                    "content": [
                                        {
                                            "type": "data",
                                            "data": {
                                                "output": "tool output should stay out of chat knowledge",
                                            },
                                        }
                                    ],
                                },
                                [],
                            ],
                        ]
                    }
                }
            },
        ),
        encoding="utf-8",
    )

    put_response = knowledge_api_client.put(
        "/knowledge/sources",
        json={
            "id": "chat-history",
            "name": "Chat History",
            "type": "chat",
            "enabled": True,
            "recursive": False,
            "tags": ["chat"],
            "description": "",
        },
    )
    assert put_response.status_code == 200

    index_response = knowledge_api_client.post(
        "/knowledge/sources/chat-history/index",
    )
    assert index_response.status_code == 200
    assert index_response.json()["document_count"] == 1

    search_response = knowledge_api_client.get(
        "/knowledge/search",
        params={"q": "chapter sequencing", "source_types": "chat"},
    )
    assert search_response.status_code == 200
    hits = search_response.json()["hits"]
    assert len(hits) == 1
    assert hits[0]["source_type"] == "chat"

    tool_search = knowledge_api_client.get(
        "/knowledge/search",
        params={"q": "tool output should stay out", "source_types": "chat"},
    )
    assert tool_search.status_code == 200
    assert tool_search.json()["hits"] == []


def test_auto_collect_turn_files_and_long_text(tmp_path: Path):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.enabled = True
    config.automation.auto_collect_chat_files = True
    config.automation.auto_collect_long_text = True
    config.automation.long_text_min_chars = 20

    upload_path = tmp_path / "notes.md"
    upload_path.write_text("chapter outline and references", encoding="utf-8")

    result = manager.auto_collect_from_messages(
        config=config,
        running_config=None,
        session_id="console:user-1",
        user_id="user-1",
        request_messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "file",
                        "file_url": str(upload_path),
                        "name": "notes.md",
                    }
                ],
            }
        ],
        response_messages=[
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "text",
                        "text": "This is a very long structured answer that should be persisted as a text knowledge source.",
                    }
                ],
            }
        ],
    )

    assert result["changed"] is True
    assert result["file_sources"] == 1
    assert result["text_sources"] == 1
    assert len(config.sources) == 2
    assert {source.type for source in config.sources} == {"file", "text"}
    by_type = {source.type: source for source in config.sources}
    assert "origin:auto" in by_type["file"].tags
    assert "auto:file" in by_type["file"].tags
    assert "origin:auto" in by_type["text"].tags
    assert "auto:text" in by_type["text"].tags


def test_auto_collect_turn_urls_from_chat_text(tmp_path: Path, monkeypatch):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.enabled = True

    class _Resp:
        status_code = 200
        headers = {"content-type": "text/plain"}

        def __init__(self, text: str):
            self.text = text

        def raise_for_status(self):
            return None

    def fake_get(url: str, timeout: float, follow_redirects: bool):
        _ = timeout, follow_redirects
        return _Resp((f"Indexed content from {url}. " * 80).strip())

    monkeypatch.setattr("copaw.knowledge.manager.httpx.get", fake_get)

    running = SimpleNamespace(
        auto_collect_chat_files=False,
        auto_collect_chat_urls=True,
        auto_collect_long_text=False,
        long_text_min_chars=2000,
    )

    result = manager.auto_collect_from_messages(
        config=config,
        running_config=running,
        session_id="console:user-1",
        user_id="user-1",
        request_messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "参考文档：https://example.com/guide?id=1 。"
                            "同一个链接重复一次 https://example.com/guide?id=1"
                        ),
                    }
                ],
            }
        ],
        response_messages=[
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "text",
                        "text": "还可以看 https://docs.example.org/spec).",
                    }
                ],
            }
        ],
    )

    assert result["changed"] is True
    assert result["file_sources"] == 0
    assert result["text_sources"] == 0
    assert result["url_sources"] == 2
    assert len(config.sources) == 2
    assert all(source.type == "url" for source in config.sources)
    assert {source.location for source in config.sources} == {
        "https://example.com/guide?id=1",
        "https://docs.example.org/spec",
    }
    assert all("auto:url" in source.tags for source in config.sources)


def test_auto_collect_turn_urls_skips_short_content(tmp_path: Path, monkeypatch):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.enabled = True

    class _Resp:
        status_code = 200
        headers = {"content-type": "text/plain"}

        def __init__(self, text: str):
            self.text = text

        def raise_for_status(self):
            return None

    def fake_get(url: str, timeout: float, follow_redirects: bool):
        _ = url, timeout, follow_redirects
        # Intentionally below URL auto-collect threshold.
        return _Resp("short content")

    monkeypatch.setattr("copaw.knowledge.manager.httpx.get", fake_get)

    running = SimpleNamespace(
        auto_collect_chat_files=False,
        auto_collect_chat_urls=True,
        auto_collect_long_text=False,
        long_text_min_chars=2000,
    )

    result = manager.auto_collect_from_messages(
        config=config,
        running_config=running,
        session_id="console:user-1",
        user_id="user-1",
        request_messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "看这个 https://example.com/too-short",
                    }
                ],
            }
        ],
        response_messages=[],
    )

    assert result["url_sources"] == 0
    assert len(config.sources) == 0


def test_auto_collect_remote_file_uses_cache(tmp_path: Path, monkeypatch):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.enabled = True
    config.automation.auto_collect_chat_files = True

    calls = {"count": 0}

    class _Resp:
        status_code = 200
        content = b"remote knowledge payload"

        def raise_for_status(self):
            return None

    def fake_get(url: str, timeout: float, follow_redirects: bool):
        _ = timeout, follow_redirects
        assert url == "https://example.com/a.md"
        calls["count"] += 1
        return _Resp()

    monkeypatch.setattr("copaw.knowledge.manager.httpx.get", fake_get)

    payload = [
        {
            "role": "user",
            "content": [
                {
                    "type": "file",
                    "file_url": "https://example.com/a.md",
                    "name": "a.md",
                }
            ],
        }
    ]

    first = manager.auto_collect_from_messages(
        config=config,
        running_config=None,
        session_id="console:user-1",
        user_id="user-1",
        request_messages=payload,
        response_messages=[],
    )
    second = manager.auto_collect_from_messages(
        config=config,
        running_config=None,
        session_id="console:user-1",
        user_id="user-1",
        request_messages=payload,
        response_messages=[],
    )

    assert first["file_sources"] == 1
    assert second["file_sources"] == 1
    assert calls["count"] == 1


def test_auto_collect_remote_file_backoff_retry(tmp_path: Path, monkeypatch):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.enabled = True
    config.automation.auto_collect_chat_files = True

    calls = {"count": 0}

    def fake_get(url: str, timeout: float, follow_redirects: bool):
        _ = url, timeout, follow_redirects
        calls["count"] += 1
        raise RuntimeError("temporary network failure")

    monkeypatch.setattr("copaw.knowledge.manager.httpx.get", fake_get)

    payload = [
        {
            "role": "user",
            "content": [
                {
                    "type": "file",
                    "file_url": "https://example.com/fail.md",
                    "name": "fail.md",
                }
            ],
        }
    ]

    first = manager.auto_collect_from_messages(
        config=config,
        running_config=None,
        session_id="console:user-1",
        user_id="user-1",
        request_messages=payload,
        response_messages=[],
    )
    second = manager.auto_collect_from_messages(
        config=config,
        running_config=None,
        session_id="console:user-1",
        user_id="user-1",
        request_messages=payload,
        response_messages=[],
    )

    assert first["file_sources"] == 0
    assert second["file_sources"] == 0
    # second call should be skipped by retry backoff
    assert calls["count"] == 1


def test_remote_source_status_includes_retry_metadata(tmp_path: Path, monkeypatch):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.enabled = True
    config.automation.auto_collect_chat_files = True

    def fake_get(url: str, timeout: float, follow_redirects: bool):
        _ = url, timeout, follow_redirects
        raise RuntimeError("temporary network failure")

    monkeypatch.setattr("copaw.knowledge.manager.httpx.get", fake_get)

    remote_url = "https://example.com/fail-status.md"
    payload = [
        {
            "role": "user",
            "content": [
                {
                    "type": "file",
                    "file_url": remote_url,
                    "name": "fail-status.md",
                }
            ],
        }
    ]

    _ = manager.auto_collect_from_messages(
        config=config,
        running_config=None,
        session_id="console:user-1",
        user_id="user-1",
        request_messages=payload,
        response_messages=[],
    )

    remote_hash = hashlib.sha1(remote_url.encode("utf-8")).hexdigest()
    source = knowledge_router_module.KnowledgeSourceSpec(
        id="auto-file-failed",
        name="Auto File Failed",
        type="file",
        location="/tmp/not-exist.md",
        enabled=True,
        recursive=False,
        tags=[f"remote:url_hash:{remote_hash}", "auto", "auto:file"],
        description="",
    )

    status = manager.get_source_status(source.id, source)
    assert status["remote_status"] == "failed"
    assert status["remote_cache_state"] in {"waiting_retry", "ready_retry"}
    assert status["remote_fail_count"] >= 1
    assert isinstance(status["remote_last_error"], str)


def test_auto_backfill_history_runs_once(tmp_path: Path):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.enabled = True

    chats_path = tmp_path / CHATS_FILE
    chats_path.write_text(
        json.dumps(
            {
                "version": 1,
                "chats": [
                    {
                        "id": "chat-1",
                        "name": "Legacy Chat",
                        "session_id": "console:user-1",
                        "user_id": "user-1",
                        "channel": "console",
                        "created_at": "2026-03-16T00:00:00Z",
                        "updated_at": "2026-03-16T00:00:00Z",
                        "meta": {},
                    }
                ],
            },
        ),
        encoding="utf-8",
    )

    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    session_file = sessions_dir / (
        f"{sanitize_filename('user-1')}_{sanitize_filename('console:user-1')}.json"
    )
    session_file.write_text(
        json.dumps(
            {
                "agent": {
                    "memory": {
                        "content": [
                            [
                                {
                                    "id": "m1",
                                    "role": "assistant",
                                    "type": "message",
                                    "content": [
                                        {
                                            "type": "text",
                                            "text": "legacy history content worth backfill",
                                        }
                                    ],
                                },
                                [],
                            ]
                        ]
                    }
                }
            },
        ),
        encoding="utf-8",
    )

    running = SimpleNamespace(
        auto_backfill_history_data=True,
        auto_collect_chat_files=False,
        auto_collect_long_text=True,
        long_text_min_chars=10,
    )

    first = manager.auto_backfill_history_data(config, running)
    second = manager.auto_backfill_history_data(config, running)

    assert first["skipped"] is False
    assert first["processed_sessions"] == 1
    assert first["text_sources"] >= 1
    assert second["skipped"] is True
    assert second["reason"] == "already_completed"


def test_auto_backfill_history_collects_chat_urls(
    tmp_path: Path,
    monkeypatch,
):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.enabled = True

    chats_path = tmp_path / CHATS_FILE
    chats_path.write_text(
        json.dumps(
            {
                "version": 1,
                "chats": [
                    {
                        "id": "chat-1",
                        "name": "Legacy Chat",
                        "session_id": "console:user-2",
                        "user_id": "user-2",
                        "channel": "console",
                        "created_at": "2026-03-16T00:00:00Z",
                        "updated_at": "2026-03-16T00:00:00Z",
                        "meta": {},
                    }
                ],
            },
        ),
        encoding="utf-8",
    )

    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    session_file = sessions_dir / (
        f"{sanitize_filename('user-2')}_{sanitize_filename('console:user-2')}.json"
    )
    session_file.write_text(
        json.dumps(
            {
                "agent": {
                    "memory": {
                        "content": [
                            [
                                {
                                    "id": "m2",
                                    "role": "assistant",
                                    "type": "message",
                                    "content": [
                                        {
                                            "type": "text",
                                            "text": "历史资料地址 https://example.com/history，如果有更新请同步",
                                        }
                                    ],
                                },
                                [],
                            ]
                        ]
                    }
                }
            },
        ),
        encoding="utf-8",
    )

    class _Resp:
        status_code = 200
        headers = {"content-type": "text/plain"}
        text = ("history url content " * 80).strip()

        def raise_for_status(self):
            return None

    def fake_get(url: str, timeout: float, follow_redirects: bool):
        _ = timeout, follow_redirects
        assert url == "https://example.com/history"
        return _Resp()

    monkeypatch.setattr("copaw.knowledge.manager.httpx.get", fake_get)

    running = SimpleNamespace(
        auto_backfill_history_data=True,
        auto_collect_chat_files=False,
        auto_collect_chat_urls=True,
        auto_collect_long_text=False,
        long_text_min_chars=2000,
    )

    result = manager.auto_backfill_history_data(config, running)

    assert result["skipped"] is False
    assert result["processed_sessions"] == 1
    assert result["url_sources"] == 1
    assert any(source.type == "url" for source in config.sources)


def test_extract_urls_from_text_strips_cn_punctuation_and_backtick():
    text = (
        "请参考 https://github.com/agentscope-ai/CoPaw`，如果出现新的提交就同步，"
        "以及 https://example.com/docs。"
    )

    urls = KnowledgeManager._extract_urls_from_text(text)

    assert urls == [
        "https://github.com/agentscope-ai/CoPaw",
        "https://example.com/docs",
    ]


def test_extract_urls_from_text_handles_mixed_cn_and_adjacent_links():
    text = (
        "对比 https://github.com/futuremeng/CoPaw和原来的"
        "https://github.com/agentscope-ai/CoPaw做一个区分，另见"
        "https://github.com/agentscope-ai/CoPaw**"
    )

    urls = KnowledgeManager._extract_urls_from_text(text)

    assert urls == [
        "https://github.com/futuremeng/CoPaw",
        "https://github.com/agentscope-ai/CoPaw",
    ]


def test_extract_urls_from_text_handles_reported_merged_url_case():
    text = (
        "https://github.com/futuremeng/CoPaw和原来的"
        "https://github.com/agentscope-ai/CoPaw做一个区分"
    )

    urls = KnowledgeManager._extract_urls_from_text(text)

    assert urls == [
        "https://github.com/futuremeng/CoPaw",
        "https://github.com/agentscope-ai/CoPaw",
    ]


def test_auto_backfill_history_continues_when_one_url_index_fails(
    tmp_path: Path,
    monkeypatch,
):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.enabled = True

    chats_path = tmp_path / CHATS_FILE
    chats_path.write_text(
        json.dumps(
            {
                "version": 1,
                "chats": [
                    {
                        "id": "chat-1",
                        "name": "Legacy Chat",
                        "session_id": "console:user-3",
                        "user_id": "user-3",
                        "channel": "console",
                        "created_at": "2026-03-16T00:00:00Z",
                        "updated_at": "2026-03-16T00:00:00Z",
                        "meta": {},
                    }
                ],
            },
        ),
        encoding="utf-8",
    )

    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir(parents=True, exist_ok=True)
    session_file = sessions_dir / (
        f"{sanitize_filename('user-3')}_{sanitize_filename('console:user-3')}.json"
    )
    session_file.write_text(
        json.dumps(
            {
                "agent": {
                    "memory": {
                        "content": [
                            [
                                {
                                    "id": "m3",
                                    "role": "assistant",
                                    "type": "message",
                                    "content": [
                                        {
                                            "type": "text",
                                            "text": (
                                                "坏链接 https://example.com/404 "
                                                "好链接 https://example.com/history-ok"
                                            ),
                                        }
                                    ],
                                },
                                [],
                            ]
                        ]
                    }
                }
            },
        ),
        encoding="utf-8",
    )

    class _Resp:
        status_code = 200
        headers = {"content-type": "text/plain"}

        def __init__(self, text: str):
            self.text = text

        def raise_for_status(self):
            return None

    def fake_get(url: str, timeout: float, follow_redirects: bool):
        _ = timeout, follow_redirects
        if url.endswith("/404"):
            raise RuntimeError("404 not found")
        assert url == "https://example.com/history-ok"
        return _Resp(("ok content " * 120).strip())

    monkeypatch.setattr("copaw.knowledge.manager.httpx.get", fake_get)

    running = SimpleNamespace(
        auto_backfill_history_data=True,
        auto_collect_chat_files=False,
        auto_collect_chat_urls=True,
        auto_collect_long_text=False,
        long_text_min_chars=2000,
    )

    result = manager.auto_backfill_history_data(config, running)

    assert result["skipped"] is False
    assert result["processed_sessions"] == 1
    assert result["url_sources"] == 1
    assert "failed_sources" not in result
    assert "errors" not in result
    assert any(
        source.location == "https://example.com/history-ok"
        for source in config.sources
    )


    # ---------------------------------------------------------------------------
# URL exclusion helpers
# ---------------------------------------------------------------------------


def test_should_exclude_url_private_localhost():
    assert KnowledgeManager._should_exclude_url("http://localhost:3000/api") is True
    assert KnowledgeManager._should_exclude_url("http://127.0.0.1:8080/") is True
    assert KnowledgeManager._should_exclude_url("http://192.168.1.100/dashboard") is True
    assert KnowledgeManager._should_exclude_url("http://10.0.0.1/path") is True


def test_should_exclude_url_public_is_not_excluded():
    assert KnowledgeManager._should_exclude_url("https://github.com/repo") is False
    assert KnowledgeManager._should_exclude_url("https://example.com/page") is False


def test_should_exclude_url_token_params():
    assert (
        KnowledgeManager._should_exclude_url(
            "https://oapi.dingtalk.com/robot/send?access_token=abc123"
        )
        is True
    )
    assert (
        KnowledgeManager._should_exclude_url(
            "https://hooks.slack.com/services/xxx?webhook_token=yyy"
        )
        is True
    )
    # No token param → not excluded
    assert (
        KnowledgeManager._should_exclude_url("https://example.com/search?q=foo")
        is False
    )


def test_should_exclude_url_custom_pattern():
    from copaw.config.config import KnowledgeAutomationConfig

    cfg = KnowledgeAutomationConfig(url_exclude_patterns=["https://internal.corp/"])
    assert KnowledgeManager._should_exclude_url("https://internal.corp/api", cfg) is True
    assert KnowledgeManager._should_exclude_url("https://external.com/api", cfg) is False


def test_should_exclude_url_private_disabled():
    from copaw.config.config import KnowledgeAutomationConfig

    cfg = KnowledgeAutomationConfig(url_exclude_private_addresses=False)
    # Even localhost is allowed when flag is off
    assert KnowledgeManager._should_exclude_url("http://127.0.0.1:3000/", cfg) is False


def test_build_url_sources_excludes_private_and_token_urls(tmp_path: Path):
    manager = KnowledgeManager(tmp_path)
    from copaw.config.config import KnowledgeAutomationConfig

    automation = KnowledgeAutomationConfig()
    messages = [
        {
            "role": "user",
            "content": (
                "webhook: https://oapi.dingtalk.com/robot/send?access_token=secret "
                "local: http://127.0.0.1:3000/ "
                "good: https://github.com/agentscope-ai/CoPaw"
            ),
        }
    ]
    sources = manager._build_url_sources_from_messages(
        messages, "session-1", "user-1", automation_config=automation
    )
    locations = [s.location for s in sources]
    assert "https://github.com/agentscope-ai/CoPaw" in locations
    assert not any(
        "access_token" in loc or "127.0.0.1" in loc for loc in locations
    )


def test_build_url_sources_captures_surrounding_context(tmp_path: Path):
    manager = KnowledgeManager(tmp_path)
    messages = [
        {
            "role": "user",
            "content": "CoPaw 项目地址 https://github.com/agentscope-ai/CoPaw 请帮我分析",
        }
    ]
    sources = manager._build_url_sources_from_messages(
        messages, "session-2", "user-2"
    )
    assert len(sources) == 1
    assert "来源上下文:" in sources[0].description
    assert "CoPaw" in sources[0].description


def test_extract_url_context_returns_surrounding_text():
    text = "这是前面的文字 https://example.com/page 这是后面的文字"
    snippet = KnowledgeManager._extract_url_context(text, "https://example.com/page", max_chars=200)
    assert "前面的文字" in snippet
    assert "后面的文字" in snippet


def test_context_has_sufficient_content_with_content_marker():
    context = "source_id: s1\n\nsource_type: text\n\ncontent:\nSome real body text here"
    assert KnowledgeManager._context_has_sufficient_content(context, min_chars=10) is True
    # Too-short actual text
    assert KnowledgeManager._context_has_sufficient_content(
        "source_id: s1\n\ncontent:\nhi", min_chars=10
    ) is False


def test_context_has_sufficient_content_with_chat_context_marker():
    context = (
        "source_id: u1\n\nsource_type: url\n\n"
        "description: Auto-collected\n来源上下文: 这是来自对话的真实上下文内容"
    )
    assert KnowledgeManager._context_has_sufficient_content(context, min_chars=10) is True


def test_context_has_sufficient_content_metadata_only():
    context = "source_id: u1\n\nsource_type: url\n\nlocation: https://example.com\n\ndescription: Auto-collected"
    assert KnowledgeManager._context_has_sufficient_content(context, min_chars=10) is False


def test_normalize_source_name_with_llm_timeout(tmp_path: Path, monkeypatch):
    """LLM that times out should fall back to local title."""
    import asyncio

    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    source = knowledge_router_module.KnowledgeSourceSpec(
        id="slow-src",
        name="old-name",
        type="text",
        content="This is some sufficiently long body text for testing timeout behaviour.",
        enabled=True,
        recursive=False,
        tags=[],
        description="",
    )

    class _SlowModel:
        async def __call__(self, messages):
            await asyncio.sleep(5)  # Simulates very slow LLM
            raise AssertionError("Should not reach here")

    monkeypatch.setattr(
        "copaw.knowledge.manager.create_model_and_formatter",
        lambda: (_SlowModel(), None),
    )

    result = asyncio.run(
        manager.normalize_source_name_with_llm(source, config, timeout_seconds=0.05)
    )
    # Falls back to local semantic title (not "old-name" raw value)
    assert result.id == "slow-src"
    # Must NOT raise; name should be fallback
    assert isinstance(result.name, str) and result.name


def test_normalize_source_name_with_llm_disable_thinking_adds_no_think(
    tmp_path: Path, monkeypatch
):
    """disable_thinking=True appends /no_think to system message."""
    import asyncio

    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    source = knowledge_router_module.KnowledgeSourceSpec(
        id="think-src",
        name="old-name",
        type="text",
        content="Body text long enough to pass content check for LLM call.",
        enabled=True,
        recursive=False,
        tags=[],
        description="",
    )

    captured: list[list[dict]] = []

    class _FakeModel:
        async def __call__(self, messages):
            captured.append(messages)

            class R:
                text = "New Title"

            return R()

    monkeypatch.setattr(
        "copaw.knowledge.manager.create_model_and_formatter",
        lambda: (_FakeModel(), None),
    )

    asyncio.run(
        manager.normalize_source_name_with_llm(source, config, disable_thinking=True)
    )
    assert captured, "Model was not called"
    system_content = captured[0][0]["content"]
    assert "/no_think" in system_content


def test_normalize_source_name_with_llm_uses_custom_prompt(
    tmp_path: Path, monkeypatch
):
    """Custom prompt should be prepended to user message content."""
    import asyncio

    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    source = knowledge_router_module.KnowledgeSourceSpec(
        id="prompt-src",
        name="old-name",
        type="text",
        content="Body text long enough to pass content check for LLM call.",
        enabled=True,
        recursive=False,
        tags=[],
        description="",
    )
    prompt = "给以下内容起一个标题，一般10个字到20个字。"

    captured: list[list[dict]] = []

    class _FakeModel:
        async def __call__(self, messages):
            captured.append(messages)

            class R:
                text = "New Title"

            return R()

    monkeypatch.setattr(
        "copaw.knowledge.manager.create_model_and_formatter",
        lambda: (_FakeModel(), None),
    )

    asyncio.run(
        manager.normalize_source_name_with_llm(
            source,
            config,
            title_prompt=prompt,
        )
    )
    assert captured, "Model was not called"
    user_content = captured[0][1]["content"]
    assert user_content.startswith(prompt)


def test_maintain_next_source_title_deletes_empty_source(tmp_path: Path):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.sources = [
        knowledge_router_module.KnowledgeSourceSpec(
            id="empty-src",
            name="empty",
            type="chat",
            enabled=True,
            recursive=False,
            tags=["auto", "origin:auto", "source:chat"],
            description="",
        )
    ]

    result = asyncio.run(
        manager.maintain_next_source_title(
            config,
            use_llm=True,
            min_content_chars=10,
        )
    )

    assert result["processed"] is True
    assert result["deleted"] is True
    assert result["source_id"] == "empty-src"
    assert config.sources == []


def test_process_title_regen_queue_batch_deletes_empty_source(tmp_path: Path, monkeypatch):
    manager = KnowledgeManager(tmp_path)
    config = Config().knowledge
    config.sources = [
        knowledge_router_module.KnowledgeSourceSpec(
            id="empty-src",
            name="empty",
            type="chat",
            enabled=True,
            recursive=False,
            tags=["auto", "origin:auto", "source:chat"],
            description="",
        ),
        knowledge_router_module.KnowledgeSourceSpec(
            id="valid-src",
            name="old-name",
            type="text",
            content="This is valid content for title generation.",
            enabled=True,
            recursive=False,
            tags=[],
            description="",
        ),
    ]

    class _FakeModel:
        async def __call__(self, messages):
            _ = messages

            class R:
                text = "New Title"

            return R()

    monkeypatch.setattr(
        "copaw.knowledge.manager.create_model_and_formatter",
        lambda: (_FakeModel(), None),
    )

    enqueue = manager.enqueue_title_regeneration(
        config,
        use_llm=True,
        enabled_only=True,
        batch_size=2,
    )
    assert enqueue["queued"] is True

    result = asyncio.run(
        manager.process_title_regen_queue_batch(
            config,
            SimpleNamespace(
                knowledge_title_min_content_chars=10,
                knowledge_title_regen_llm_timeout_seconds=30.0,
                knowledge_title_regen_disable_thinking=True,
                knowledge_title_regen_prompt="给以下内容起一个标题，一般10个字到20个字。",
                knowledge_maintenance_llm_yield_seconds=0.0,
            ),
            None,
        )
    )

    assert result["processed"] is True
    assert result["job"]["deleted"] == 1
    assert all(source.id != "empty-src" for source in config.sources)