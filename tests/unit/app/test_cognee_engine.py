# -*- coding: utf-8 -*-

import os
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
    monkeypatch.setattr(
        engine,
        "_load_cognee_modules",
        lambda _config=None: (fake, None),
    )

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


def test_cognee_engine_syncs_env_from_ollama_active_model(
    monkeypatch,
    tmp_path: Path,
):
    engine = CogneeEngine(tmp_path / "indexes")
    config = Config().knowledge
    config.cognee.enabled = True
    config.cognee.sync_with_copaw_provider = True

    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_API_BASE", raising=False)
    monkeypatch.delenv("LLM_ENDPOINT", raising=False)
    monkeypatch.delenv("EMBEDDING_PROVIDER", raising=False)
    monkeypatch.delenv("EMBEDDING_MODEL", raising=False)
    monkeypatch.delenv("EMBEDDING_DIMENSIONS", raising=False)
    monkeypatch.delenv("EMBEDDING_ENDPOINT", raising=False)
    monkeypatch.delenv("EMBEDDING_API_KEY", raising=False)
    monkeypatch.delenv("HUGGINGFACE_TOKENIZER", raising=False)
    monkeypatch.delenv("MOCK_EMBEDDING", raising=False)

    monkeypatch.setattr(
        engine,
        "_resolve_copaw_active_model",
        lambda: (
            "ollama",
            "qwen3:8b",
            "http://127.0.0.1:11434/v1",
            "",
        ),
    )

    engine._ensure_cognee_llm_env(config)

    assert os.environ["LLM_MODEL"] == "ollama/qwen3:8b"
    assert os.environ["LLM_API_KEY"] == "local"
    assert os.environ["LLM_BASE_URL"] == "http://127.0.0.1:11434/v1"
    assert os.environ["LLM_API_BASE"] == "http://127.0.0.1:11434/v1"
    assert os.environ["LLM_ENDPOINT"] == "http://127.0.0.1:11434/v1"
    assert os.environ["EMBEDDING_PROVIDER"] == "openai"
    assert os.environ["EMBEDDING_MODEL"] == "openai/text-embedding-3-large"
    assert os.environ["EMBEDDING_DIMENSIONS"] == "3072"
    assert os.environ["EMBEDDING_ENDPOINT"] == "http://127.0.0.1:11434/v1"
    assert os.environ["EMBEDDING_API_KEY"] == "local"
    assert os.environ["HUGGINGFACE_TOKENIZER"] == "unused"
    assert os.environ["MOCK_EMBEDDING"] == "true"


def test_cognee_engine_syncs_env_from_custom_provider_with_custom_prefix(
    monkeypatch,
    tmp_path: Path,
):
    engine = CogneeEngine(tmp_path / "indexes")
    config = Config().knowledge
    config.cognee.enabled = True
    config.cognee.sync_with_copaw_provider = True
    config.cognee.custom_model_prefix = "hosted_vllm"

    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_BASE_URL", raising=False)
    monkeypatch.delenv("LLM_API_BASE", raising=False)

    monkeypatch.setattr(
        engine,
        "_resolve_copaw_active_model",
        lambda: (
            "my-custom-provider",
            "qwen2.5-72b-instruct",
            "http://localhost:8000/v1",
            "sk-test",
        ),
    )

    engine._ensure_cognee_llm_env(config)

    assert os.environ["LLM_MODEL"] == "hosted_vllm/qwen2.5-72b-instruct"
    assert os.environ["LLM_API_KEY"] == "sk-test"
    assert os.environ["LLM_BASE_URL"] == "http://localhost:8000/v1"
    assert os.environ["LLM_API_BASE"] == "http://localhost:8000/v1"
