# -*- coding: utf-8 -*-
"""Product-level config models that are not part of the upstream engine.

These live outside ``config.py`` so the upstream-owned root config file stays
free of Copaw-specific classes; ``config.py`` re-exports them.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List

from pydantic import BaseModel, ConfigDict, Field, model_validator

class KnowledgeSourceSpec(BaseModel):
    """Compatibility source spec for CoPaw knowledge modules."""

    model_config = ConfigDict(extra="allow")

    id: str = ""
    name: str = ""
    type: str = ""
    location: str = ""
    content: str = ""
    summary: str = ""
    tags: List[str] = Field(default_factory=list)
    enabled: bool = True
    recursive: bool = False
    project_id: str = ""

    def get(self, key: str, default: Any = None) -> Any:
        return getattr(self, key, default)


class KnowledgeTaskSpec(BaseModel):
    """Task-level HanLP runtime settings."""

    model_config = ConfigDict(extra="allow")

    enabled: bool = True
    task_name: str = ""
    model_id: str = ""
    artifact_key: str = ""
    eval_role: str = "compare"
    timeout_sec: float = 30.0


class KnowledgeHanLPTaskConfig(KnowledgeTaskSpec):
    """Compatibility alias for HanLP task matrix entries."""


class KnowledgeTaskMatrixConfig(BaseModel):
    """HanLP task matrix configuration."""

    model_config = ConfigDict(extra="allow")

    tasks: Dict[str, KnowledgeHanLPTaskConfig] = Field(default_factory=dict)


class KnowledgeNLPConfig(BaseModel):
    """Compatibility NLP runtime configuration."""

    model_config = ConfigDict(extra="allow")

    enabled: bool = False
    provider: str = "hanlp"
    strategy_mode: str = "manual"
    sidecar_enabled: bool | None = None
    python_executable: str = ""
    model_id: str = ""
    model_home: str = ""
    probe_timeout_sec: float = 5.0
    tokenize_timeout_sec: float = 15.0
    siamese_sidecar_enabled: bool = False
    siamese_python_executable: str = ""
    siamese_model_id: str = "iic/nlp_structbert_siamese-uninlu_chinese-base"
    siamese_model_revision: str = "master"
    task_matrix: KnowledgeTaskMatrixConfig = Field(
        default_factory=KnowledgeTaskMatrixConfig,
    )


class KnowledgeIndexConfig(BaseModel):
    """Compatibility indexing configuration."""

    model_config = ConfigDict(extra="allow")

    dataset_dir: str = ""
    graph_path: str = ""
    bfs_depth: int = 2
    token_budget: int = 4096
    chunk_size: int = 1200
    max_file_size: int = 2 * 1024 * 1024
    include_globs: List[str] = Field(default_factory=list)
    exclude_globs: List[str] = Field(default_factory=list)


class KnowledgeAutomationConfig(BaseModel):
    """Compatibility automation configuration."""

    model_config = ConfigDict(extra="allow")

    enabled: bool = False
    knowledge_auto_collect_chat_files: bool = False
    knowledge_auto_collect_chat_urls: bool = False
    knowledge_auto_collect_long_text: bool = False
    knowledge_long_text_min_chars: int = 500


class GraphifyConfig(BaseModel):
    """Graphify knowledge graph engine configuration.

    Local file mode (primary): point ``graph_path`` at a
    ``graphify-out/graph.json`` built in advance from ``dataset_dir``.

    Remote mode: set ``endpoint`` to a hosted Graphify service URL.

    Environment overrides (take precedence over config file values):
      COPAW_GRAPHIFY_GRAPH_PATH   - path to graph.json
      COPAW_GRAPHIFY_DATASET_DIR  - directory to build graph from
      COPAW_GRAPHIFY_ENDPOINT     - remote service URL
      COPAW_GRAPHIFY_API_KEY      - remote service API key
      COPAW_GRAPHIFY_DATASET      - dataset name for the remote service
      COPAW_GRAPHIFY_FALLBACK     - "0"/"false" disables local fallback
      COPAW_GRAPHIFY_REQUEST_TIMEOUT_SEC - remote HTTP timeout seconds
    """

    model_config = ConfigDict(extra="allow")

    endpoint: str = Field(
        default="",
        description="Graphify service endpoint URL (remote mode).",
    )
    api_key: str = Field(
        default="",
        description="API key for hosted Graphify service.",
    )
    graph_path: str = Field(
        default="",
        description="Path to graphify-out/graph.json (local file mode).",
    )
    dataset_dir: str = Field(
        default="",
        description="Directory to run graphify on for memify (build graph).",
    )
    dataset: str = Field(
        default="copaw",
        description="Dataset name for hosted Graphify service.",
    )
    fallback_to_local: bool = Field(
        default=True,
        description=(
            "Fall back to local_lexical engine when Graphify fails. "
            "Set to False to surface errors instead."
        ),
    )
    bfs_depth: int = Field(
        default=3,
        ge=1,
        le=6,
        description="BFS traversal depth for graph queries.",
    )
    token_budget: int = Field(
        default=2000,
        ge=100,
        description="Max output token budget for graph query results.",
    )
    request_timeout_sec: float = Field(
        default=15.0,
        ge=1.0,
        le=120.0,
        description="Timeout in seconds for Graphify remote HTTP calls.",
    )

    @model_validator(mode="after")
    def _inject_from_env(self) -> "GraphifyConfig":
        """Override fields from environment variables when set."""
        str_map = {
            "COPAW_GRAPHIFY_GRAPH_PATH": "graph_path",
            "COPAW_GRAPHIFY_DATASET_DIR": "dataset_dir",
            "COPAW_GRAPHIFY_ENDPOINT": "endpoint",
            "COPAW_GRAPHIFY_API_KEY": "api_key",
            "COPAW_GRAPHIFY_DATASET": "dataset",
        }
        for env_var, field_name in str_map.items():
            val = os.environ.get(env_var, "").strip()
            if val:
                setattr(self, field_name, val)
        fallback_raw = os.environ.get("COPAW_GRAPHIFY_FALLBACK", "").strip()
        if fallback_raw:
            self.fallback_to_local = fallback_raw.lower() not in {
                "0",
                "false",
                "no",
            }
        timeout_raw = os.environ.get(
            "COPAW_GRAPHIFY_REQUEST_TIMEOUT_SEC",
            "",
        ).strip()
        if timeout_raw:
            try:
                self.request_timeout_sec = max(
                    1.0,
                    min(float(timeout_raw), 120.0),
                )
            except ValueError:
                pass
        return self


class KnowledgeConfig(BaseModel):
    """Compatibility top-level knowledge config used by CoPaw modules."""

    model_config = ConfigDict(extra="allow")

    enabled: bool = True
    sources: List[KnowledgeSourceSpec] = Field(default_factory=list)
    index: KnowledgeIndexConfig = Field(default_factory=KnowledgeIndexConfig)
    automation: KnowledgeAutomationConfig = Field(
        default_factory=KnowledgeAutomationConfig,
    )
    graphify: GraphifyConfig = Field(default_factory=GraphifyConfig)
    memify_enabled: bool = False


class AgentsSquareSourceSpec(BaseModel):
    """One source entry for Agents Square catalog discovery."""

    id: str = ""
    url: str = ""
    branch: str = ""
    path: str = "."
    provider: str = "index_json"
    enabled: bool = True
    order: int = 0
    pinned: bool = False
    license_hint: str = ""


class AgentsSquareCacheConfig(BaseModel):
    """Caching settings for Agents Square listing."""

    ttl_sec: int = Field(default=600, ge=0)


class AgentsSquareInstallConfig(BaseModel):
    """Install behavior settings for Agents Square imports."""

    overwrite_default: bool = False
    preserve_workspace_files: bool = True


class AgentsSquareConfig(BaseModel):
    """Top-level Agents Square source configuration."""

    version: int = Field(default=1, ge=1)
    sources: List[AgentsSquareSourceSpec] = Field(default_factory=list)
    cache: AgentsSquareCacheConfig = Field(
        default_factory=AgentsSquareCacheConfig,
    )
    install: AgentsSquareInstallConfig = Field(
        default_factory=AgentsSquareInstallConfig,
    )


class SkillMarketSpec(BaseModel):
    """One source entry for skill marketplace aggregation."""

    model_config = ConfigDict(extra="allow")

    id: str = ""
    url: str = ""
    branch: str = ""
    path: str = "index.json"
    enabled: bool = True
    order: int = 0


class SkillsMarketCacheConfig(BaseModel):
    """Caching settings for skills marketplace listing."""

    ttl_sec: int = Field(default=600, ge=0)


class SkillsMarketInstallConfig(BaseModel):
    """Install behavior settings for marketplace imports."""

    overwrite_default: bool = False
    preserve_workspace_files: bool = True


class SkillsMarketConfig(BaseModel):
    """Top-level skills marketplace source configuration."""

    version: int = Field(default=1, ge=1)
    markets: List[SkillMarketSpec] = Field(default_factory=list)
    cache: SkillsMarketCacheConfig = Field(
        default_factory=SkillsMarketCacheConfig,
    )
    install: SkillsMarketInstallConfig = Field(
        default_factory=SkillsMarketInstallConfig,
    )
