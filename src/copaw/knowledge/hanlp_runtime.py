# -*- coding: utf-8 -*-
from __future__ import annotations

from typing import Any

from ..config.config import KnowledgeConfig


class NLPRuntime:
    """Generic NLP runtime placeholder before RexUniNLU integration."""

    def __init__(self) -> None:
        self._probe_cache_state: dict[str, str] | None = None

    @staticmethod
    def _provider(config: KnowledgeConfig | None) -> str:
        nlp_cfg = getattr(config, "nlp", None)
        provider = str(getattr(nlp_cfg, "provider", "") or "").strip().lower()
        if provider:
            return provider
        return "rex_uninlu"

    @classmethod
    def _state(
        cls,
        config: KnowledgeConfig | None,
        *,
        status: str,
        reason_code: str,
        reason: str,
    ) -> dict[str, str]:
        return {
            "engine": "nlp",
            "provider": cls._provider(config),
            "status": status,
            "reason_code": reason_code,
            "reason": reason,
        }

    def probe(self, config: KnowledgeConfig | None) -> dict[str, str]:
        state = self._state(
            config,
            status="unavailable",
            reason_code="NLP_ENGINE_PLACEHOLDER_ACTIVE",
            reason=(
                "NLP provider placeholder is active. HanLP has been removed and "
                "RexUniNLU is not integrated yet."
            ),
        )
        self._probe_cache_state = dict(state)
        return state

    def model_status(self, config: KnowledgeConfig | None) -> dict[str, str]:
        return self._state(
            config,
            status="unavailable",
            reason_code="NLP_ENGINE_MODEL_NOT_IMPLEMENTED",
            reason="Model status is unavailable in placeholder NLP runtime.",
        )

    def ensure_model(self, config: KnowledgeConfig | None) -> dict[str, str]:
        return self._state(
            config,
            status="unavailable",
            reason_code="NLP_ENGINE_MODEL_NOT_IMPLEMENTED",
            reason="Model verification is unavailable in placeholder NLP runtime.",
        )

    def tokenize(
        self,
        text: str,
        config: KnowledgeConfig | None,
    ) -> tuple[list[str], dict[str, str]]:
        _ = text
        return [], self._state(
            config,
            status="unavailable",
            reason_code="NLP_ENGINE_TOKENIZE_NOT_IMPLEMENTED",
            reason="Semantic tokenization is unavailable before RexUniNLU integration.",
        )

    def task_status(
        self,
        task_key: str,
        config: KnowledgeConfig | None,
    ) -> dict[str, str]:
        _ = task_key
        return self._state(
            config,
            status="unavailable",
            reason_code="NLP_ENGINE_TASK_NOT_IMPLEMENTED",
            reason="Task status is unavailable in placeholder NLP runtime.",
        )

    def run_task(
        self,
        task_key: str,
        text: str,
        config: KnowledgeConfig | None,
    ) -> tuple[Any, dict[str, str]]:
        _ = (task_key, text)
        return None, self._state(
            config,
            status="unavailable",
            reason_code="NLP_ENGINE_TASK_NOT_IMPLEMENTED",
            reason="Task execution is unavailable before RexUniNLU integration.",
        )

    def api_status(self, config: KnowledgeConfig | None) -> dict[str, Any]:
        state = self.probe(config)
        return {
            **state,
            "capabilities": {
                "tokenize": False,
                "tasks": False,
                "model_check": False,
            },
        }


class HanLPSidecarRuntime(NLPRuntime):
    """Compatibility alias for legacy imports.

    Deprecated: use NLPRuntime instead.
    """
