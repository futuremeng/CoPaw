# -*- coding: utf-8 -*-

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config.config import KnowledgeConfig, KnowledgeSourceSpec
from .manager import KnowledgeManager


class RetrievalFacade:
    """A-lane facade: retrieval and recall only."""

    def __init__(self, project_root: Path | str, knowledge_dirname: str = ".knowledge"):
        self._manager = KnowledgeManager(
            project_root,
            knowledge_dirname=knowledge_dirname,
        )

    def index_source(
        self,
        source: KnowledgeSourceSpec,
        config: KnowledgeConfig,
        running_config: Any,
    ) -> dict[str, Any]:
        return self._manager.index_source(source, config, running_config)

    def index_all(self, config: KnowledgeConfig, running_config: Any) -> dict[str, Any]:
        return self._manager.index_all(config, running_config)

    def search(
        self,
        *,
        query: str,
        config: KnowledgeConfig,
        limit: int,
        source_ids: list[str] | None = None,
        source_types: list[str] | None = None,
        project_scope: list[str] | None = None,
        include_global: bool = True,
    ) -> dict[str, Any]:
        return self._manager.search(
            query=query,
            config=config,
            limit=limit,
            source_ids=source_ids,
            source_types=source_types,
            project_scope=project_scope,
            include_global=include_global,
        )
