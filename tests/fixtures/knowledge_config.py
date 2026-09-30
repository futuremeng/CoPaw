"""Test helpers for the CoPaw knowledge configuration."""

from __future__ import annotations

from qwenpaw.config.config import Config, KnowledgeConfig


def make_knowledge_config() -> KnowledgeConfig:
    """Return ``Config().knowledge`` shaped like the runtime configs.

    NLP settings live on root ``Config.nlp`` since the cf9d187c8 refactor; every
    production entry point copies them onto the knowledge config with
    ``setattr(knowledge_config, "nlp", root.nlp.model_copy(deep=True))`` before
    handing it to the knowledge modules. Tests that exercise those modules need
    the same injection.
    """
    root = Config()
    knowledge = root.knowledge
    setattr(knowledge, "nlp", root.nlp.model_copy(deep=True))
    return knowledge
