# -*- coding: utf-8 -*-
"""Copaw-owned coverage: local-compatible providers get a placeholder key.

Upstream passes ``self.api_key`` straight to ``AsyncOpenAI``, which rejects an
empty key.  The fork adds ``OpenAIProvider._effective_api_key()`` so Ollama /
LM Studio style endpoints work with no key configured.  These cases live here
instead of ``test_openai_provider.py`` / ``test_ollama_provider.py`` so those
upstream files stay at upstream bytes.
"""

from __future__ import annotations

import qwenpaw.providers.openai_provider as openai_provider_module
from qwenpaw.providers.ollama_provider import OllamaProvider
from qwenpaw.providers.openai_provider import OpenAIProvider


def test_openai_client_uses_placeholder_key_for_local_compatible_provider(
    monkeypatch,
) -> None:
    captured: dict[str, object] = {}

    class FakeAsyncOpenAI:
        def __init__(self, *, base_url, api_key, timeout) -> None:
            captured["base_url"] = base_url
            captured["api_key"] = api_key
            captured["timeout"] = timeout

    monkeypatch.setattr(
        openai_provider_module,
        "AsyncOpenAI",
        FakeAsyncOpenAI,
    )

    provider = OpenAIProvider(
        id="lmstudio",
        name="LM Studio",
        base_url="http://localhost:1234/v1",
        api_key="",
        require_api_key=False,
        is_local=True,
        chat_model="OpenAIChatModel",
    )

    getattr(provider, "_client")(timeout=3)

    assert captured == {
        "base_url": "http://localhost:1234/v1",
        "api_key": "EMPTY",
        "timeout": 3,
    }


def test_ollama_client_uses_placeholder_api_key_when_config_is_empty(
    monkeypatch,
) -> None:
    captured: dict[str, object] = {}

    class FakeAsyncOpenAI:
        def __init__(self, *, base_url, api_key, timeout) -> None:
            captured["base_url"] = base_url
            captured["api_key"] = api_key
            captured["timeout"] = timeout

    monkeypatch.setattr(
        "qwenpaw.providers.ollama_provider.AsyncOpenAI",
        FakeAsyncOpenAI,
    )

    provider = OllamaProvider(
        id="ollama",
        name="Ollama",
        base_url="http://localhost:11434",
        api_key="",
        require_api_key=False,
        chat_model="OpenAIChatModel",
    )
    getattr(provider, "_client")(timeout=5)

    assert captured == {
        "base_url": "http://localhost:11434/v1",
        "api_key": "EMPTY",
        "timeout": 5,
    }
