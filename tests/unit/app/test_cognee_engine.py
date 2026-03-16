# -*- coding: utf-8 -*-

from pathlib import Path

from copaw.app.routers import knowledge as knowledge_router_module
from copaw.config.config import Config
from copaw.knowledge.cognee_engine import CogneeEngine


class _FakeCognee:
    def __init__(self) -> None:
        self.add_calls = []
        self.cognify_calls = []
        self.search_calls = []
        self.delete_calls = []

    async def add(self, payload, dataset_name=None):
        self.add_calls.append((payload, dataset_name))

    async def cognify(self, datasets=None):
        self.cognify_calls.append(datasets)

    async def search(self, query_text=None, query_type=None, top_k=10, datasets=None):
        self.search_calls.append(
            {
                "query_text": query_text,
                "query_type": query_type,
                "top_k": top_k,
                "datasets": datasets,
            },
        )
        if query_type == "GRAPH_COMPLETION":
            return [{"snippet": "graph answer", "score": 2.0, "dataset": datasets[0]}]
        return [{"snippet": "chunk evidence", "score": 1.0, "dataset": datasets[0]}]

    async def delete(self, datasets=None):
        self.delete_calls.append(datasets)


def test_cognee_engine_index_search_delete_workflow(monkeypatch, tmp_path: Path):
    engine = CogneeEngine(tmp_path / "indexes")
    engine.index_dir.mkdir(parents=True, exist_ok=True)

    config = Config().knowledge
    config.cognee.enabled = True
    config.cognee.dataset_prefix = "copaw"
    config.cognee.search_mode = "hybrid"

    source = knowledge_router_module.KnowledgeSourceSpec(
        id="note-1",
        name="Note 1",
        type="text",
        content="CoPaw closes the chat knowledge loop.",
        enabled=True,
        recursive=False,
        tags=[],
        description="",
    )
    config.sources = [source]

    fake = _FakeCognee()
    monkeypatch.setattr(engine, "_load_cognee_modules", lambda: (fake, None))

    indexed = engine.index_source(source, config)
    assert indexed["source_id"] == "note-1"
    assert indexed["backend"] == "cognee"
    assert len(fake.add_calls) == 1
    assert len(fake.cognify_calls) == 1

    result = engine.search("knowledge loop", config, limit=4)
    assert len(fake.search_calls) == 2
    assert fake.search_calls[0]["query_type"] == "CHUNKS"
    assert fake.search_calls[1]["query_type"] == "GRAPH_COMPLETION"
    assert len(result["hits"]) == 2
    assert result["hits"][0]["snippet"] == "graph answer"

    docs = engine.get_source_documents("note-1")
    assert docs["indexed"] is True
    assert docs["chunk_count"] == 1

    index_path = engine.index_dir / "note-1.json"
    assert index_path.exists()

    engine.delete_index("note-1", config)
    assert len(fake.delete_calls) == 1
    assert not index_path.exists()
