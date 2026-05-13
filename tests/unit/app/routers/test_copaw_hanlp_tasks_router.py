# -*- coding: utf-8 -*-

from __future__ import annotations

import asyncio
import time
from types import SimpleNamespace

from fastapi.testclient import TestClient


class _FakeRuntime:
    last_ner_model_id: str | None = None
    last_dep_model_id: str | None = None
    last_tokenized_task_key: str | None = None
    last_tokenized_tokens: list[str] | None = None

    def run_ner(self, text: str, config):
        _FakeRuntime.last_ner_model_id = getattr(getattr(config, "nlp", None), "model_id", None)
        return [{"text": text, "label": "ORG", "span": [0, len(text)]}], {
            "status": "ready",
            "reason_code": "HANLP2_TASK_READY",
            "reason": "HanLP task is ready.",
        }

    def run_dep(self, text: str, config):
        _FakeRuntime.last_dep_model_id = getattr(getattr(config, "nlp", None), "model_id", None)
        return [{"token": text, "head": 0, "deprel": "root"}], {
            "status": "ready",
            "reason_code": "HANLP2_TASK_READY",
            "reason": "HanLP task is ready.",
        }

    def tokenize(self, text: str, config):
        _ = config
        return [token for token in text.split(" ") if token], {
            "status": "ready",
            "reason_code": "HANLP2_TASK_READY",
            "reason": "HanLP task is ready.",
        }

    def run_task(self, task_key: str, text: str, config):
        _ = config
        if task_key == "srl":
            return [
                [
                    ["微软", "ARG0", 0, 1],
                    ["发布", "PRED", 1, 2],
                    ["新模型", "ARG1", 2, 3],
                ]
            ], {
                "status": "ready",
                "reason_code": "HANLP2_TASK_READY",
                "reason": "HanLP task is ready.",
            }
        return {"task": task_key, "text": text}, {
            "status": "ready",
            "reason_code": "HANLP2_TASK_READY",
            "reason": "HanLP task is ready.",
        }

    def tokenize_batch(self, texts: list[str], config):
        _ = config
        return [[token for token in text.split(" ") if token] for text in texts], {
            "status": "ready",
            "reason_code": "HANLP2_BATCH_READY",
            "reason": "HanLP batch tokenization finished successfully.",
            "duration_ms": 1,
            "sidecar_elapsed_ms": 1,
            "sidecar_trace_elapsed_ms": 0,
            "sidecar_trace_stage_ms": {},
            "preload_status": "idle",
        }

    def run_task_batch(self, task_key: str, texts: list[str], config):
        _ = config
        if task_key == "srl":
            return [
                [
                    [
                        ["微软", "ARG0", 0, 1],
                        ["发布", "PRED", 1, 2],
                        ["新模型", "ARG1", 2, 3],
                    ]
                ]
                for _ in texts
            ], {
                "status": "ready",
                "reason_code": "HANLP2_BATCH_READY",
                "reason": "HanLP batch task finished successfully.",
                "duration_ms": 1,
                "sidecar_elapsed_ms": 1,
                "sidecar_trace_elapsed_ms": 0,
                "sidecar_trace_stage_ms": {},
                "preload_status": "idle",
            }
        return [{"task": task_key, "text": text} for text in texts], {
            "status": "ready",
            "reason_code": "HANLP2_BATCH_READY",
            "reason": "HanLP batch task finished successfully.",
            "duration_ms": 1,
            "sidecar_elapsed_ms": 1,
            "sidecar_trace_elapsed_ms": 0,
            "sidecar_trace_stage_ms": {},
            "preload_status": "idle",
        }

    def run_task_tokenized(self, task_key: str, tokens: list[str], config):
        _ = config
        _FakeRuntime.last_tokenized_task_key = task_key
        _FakeRuntime.last_tokenized_tokens = list(tokens)
        if task_key == "srl":
            pred_index = 1 if len(tokens) > 1 else 0
            return [
                [
                    [tokens[pred_index], "PRED", pred_index, pred_index + 1],
                    ["".join(tokens), "ARG1", 0, len(tokens)],
                ]
            ], {
                "status": "ready",
                "reason_code": "HANLP2_TASK_READY",
                "reason": "HanLP task is ready.",
            }
        if task_key == "ner_msra":
            return [["".join(tokens), "ORGANIZATION", 0, len(tokens)]], {
                "status": "ready",
                "reason_code": "HANLP2_TASK_READY",
                "reason": "HanLP task is ready.",
            }
        return {"task": task_key, "tokens": tokens}, {
            "status": "ready",
            "reason_code": "HANLP2_TASK_READY",
            "reason": "HanLP task is ready.",
        }

    def run_task_tokenized_batch(self, task_key: str, tokens_batch: list[list[str]], config):
        _ = config
        if task_key == "srl":
            results = []
            for tokens in tokens_batch:
                if not tokens:
                    results.append([])
                    continue
                pred_index = 1 if len(tokens) > 1 else 0
                results.append(
                    [
                        [
                            [tokens[pred_index], "PRED", pred_index, pred_index + 1],
                            ["".join(tokens), "ARG1", 0, len(tokens)],
                        ]
                    ]
                )
            return results, {
                "status": "ready",
                "reason_code": "HANLP2_BATCH_READY",
                "reason": "HanLP batch task finished successfully.",
                "duration_ms": 1,
                "sidecar_elapsed_ms": 1,
                "sidecar_trace_elapsed_ms": 0,
                "sidecar_trace_stage_ms": {},
                "preload_status": "idle",
            }
        return [{"task": task_key, "tokens": tokens} for tokens in tokens_batch], {
            "status": "ready",
            "reason_code": "HANLP2_BATCH_READY",
            "reason": "HanLP batch task finished successfully.",
            "duration_ms": 1,
            "sidecar_elapsed_ms": 1,
            "sidecar_trace_elapsed_ms": 0,
            "sidecar_trace_stage_ms": {},
            "preload_status": "idle",
        }


class _UnavailableRuntime:
    def run_ner(self, text: str, config):
        _ = (text, config)
        return [{"text": "微软", "label": "ORG"}], {
            "status": "unavailable",
            "reason_code": "HANLP2_MODEL_LOAD_FAILED",
            "reason": "HanLP model load failed.",
        }

    def run_dep(self, text: str, config):
        _ = (text, config)
        return [{"token": "微软", "head": 0, "deprel": "root"}], {
            "status": "unavailable",
            "reason_code": "HANLP2_MODEL_LOAD_FAILED",
            "reason": "HanLP model load failed.",
        }

    def tokenize(self, text: str, config):
        _ = (text, config)
        return [], {
            "status": "unavailable",
            "reason_code": "HANLP2_MODEL_LOAD_FAILED",
            "reason": "HanLP model load failed.",
        }

    def run_task(self, task_key: str, text: str, config):
        _ = (task_key, text, config)
        return None, {
            "status": "unavailable",
            "reason_code": "HANLP2_MODEL_LOAD_FAILED",
            "reason": "HanLP model load failed.",
        }

    def tokenize_batch(self, texts: list[str], config):
        _ = (texts, config)
        return [[] for _ in texts], {
            "status": "unavailable",
            "reason_code": "HANLP2_MODEL_LOAD_FAILED",
            "reason": "HanLP model load failed.",
        }

    def run_task_batch(self, task_key: str, texts: list[str], config):
        _ = (task_key, texts, config)
        return [None for _ in texts], {
            "status": "unavailable",
            "reason_code": "HANLP2_MODEL_LOAD_FAILED",
            "reason": "HanLP model load failed.",
        }

    def run_task_tokenized(self, task_key: str, tokens: list[str], config):
        _ = (task_key, tokens, config)
        return None, {
            "status": "unavailable",
            "reason_code": "HANLP2_MODEL_LOAD_FAILED",
            "reason": "HanLP model load failed.",
        }

    def run_task_tokenized_batch(self, task_key: str, tokens_batch: list[list[str]], config):
        _ = (task_key, tokens_batch, config)
        return [None for _ in tokens_batch], {
            "status": "unavailable",
            "reason_code": "HANLP2_MODEL_LOAD_FAILED",
            "reason": "HanLP model load failed.",
        }


class _NestedListNerRuntime(_FakeRuntime):
    def run_ner(self, text: str, config):
        _ = config
        return [[], [], [], [[text[:1], "PERSON", 0, 1]]], {
            "status": "ready",
            "reason_code": "HANLP2_TASK_READY",
            "reason": "HanLP task is ready.",
        }


class _TaskMatrixProbeRuntime(_FakeRuntime):
    last_ner_matrix_model_id: str | None = None

    def run_ner(self, text: str, config):
        nlp_cfg = getattr(config, "nlp", None)
        task_matrix = getattr(nlp_cfg, "task_matrix", None)
        tasks = getattr(task_matrix, "tasks", None) if task_matrix is not None else None
        task_cfg = tasks.get("ner_msra") if isinstance(tasks, dict) else None
        _TaskMatrixProbeRuntime.last_ner_matrix_model_id = getattr(task_cfg, "model_id", None)
        return super().run_ner(text, config)


class _FragmentedNerRuntime(_FakeRuntime):
    def run_ner(self, text: str, config):  # type: ignore[override]
        _ = config
        # Simulate sidecar returning fragmented entities with reset local spans.
        return [["北", "LOCATION", 0, 1], ["京", "LOCATION", 0, 1]], {
            "status": "ready",
            "reason_code": "HANLP2_TASK_READY",
            "reason": "HanLP task is ready.",
        }


class _SlowTokenizeRuntime(_FakeRuntime):
    def tokenize(self, text: str, config):  # type: ignore[override]
        _ = (text, config)
        time.sleep(0.4)
        return ["微软", "发布", "新模型"], {
            "status": "ready",
            "reason_code": "HANLP2_TASK_READY",
            "reason": "HanLP task is ready.",
        }


def _install_runtime_mocks(monkeypatch):
    from copaw.app.routers import knowledge_hanlp_tasks as module

    fake_cfg = SimpleNamespace(
        knowledge=SimpleNamespace(
            hanlp=SimpleNamespace(model_id="MSRA_NER_BERT_BASE_ZH"),
        ),
    )
    monkeypatch.setattr(module, "load_config", lambda: fake_cfg)
    monkeypatch.setattr(module, "NLPRuntime", lambda: _FakeRuntime())


def _install_runtime_mocks_with_strategy(monkeypatch):
    from copaw.app.routers import knowledge_hanlp_tasks as module

    cfg = SimpleNamespace(
        knowledge=SimpleNamespace(
            nlp=SimpleNamespace(
                model_id="hanlp.pretrained.mtl.CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH",
                strategy=SimpleNamespace(
                    mode="auto",
                    default_model_id="hanlp.pretrained.mtl.CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH",
                    task_overrides={},
                    auto_classical_chinese=SimpleNamespace(
                        enabled=True,
                        threshold=0.2,
                        model_id="hanlp.pretrained.mtl.KYOTO_EVAHAN_TOK_LEM_POS_UDEP_LZH",
                    ),
                ),
            ),
        ),
    )
    monkeypatch.setattr(module, "load_config", lambda: cfg)
    monkeypatch.setattr(module, "NLPRuntime", lambda: _FakeRuntime())


def _install_unavailable_runtime_mocks(monkeypatch):
    from copaw.app.routers import knowledge_hanlp_tasks as module

    fake_cfg = SimpleNamespace(
        knowledge=SimpleNamespace(
            hanlp=SimpleNamespace(model_id="MSRA_NER_BERT_BASE_ZH"),
        ),
    )
    monkeypatch.setattr(module, "load_config", lambda: fake_cfg)
    monkeypatch.setattr(module, "NLPRuntime", lambda: _UnavailableRuntime())


def _install_nested_list_ner_runtime_mocks(monkeypatch):
    from copaw.app.routers import knowledge_hanlp_tasks as module

    fake_cfg = SimpleNamespace(
        knowledge=SimpleNamespace(
            hanlp=SimpleNamespace(model_id="MSRA_NER_BERT_BASE_ZH"),
        ),
    )
    monkeypatch.setattr(module, "load_config", lambda: fake_cfg)
    monkeypatch.setattr(module, "NLPRuntime", lambda: _NestedListNerRuntime())


def _install_runtime_mocks_with_strategy_and_task_matrix(monkeypatch):
    from copaw.app.routers import knowledge_hanlp_tasks as module

    cfg = SimpleNamespace(
        knowledge=SimpleNamespace(
            nlp=SimpleNamespace(
                model_id="hanlp.pretrained.mtl.CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH",
                strategy=SimpleNamespace(
                    mode="auto",
                    default_model_id="hanlp.pretrained.mtl.CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH",
                    task_overrides={},
                    auto_classical_chinese=SimpleNamespace(
                        enabled=False,
                        threshold=0.2,
                        model_id="",
                    ),
                ),
                task_matrix=SimpleNamespace(
                    tasks={
                        "ner_msra": SimpleNamespace(model_id="MSRA_NER_BERT_BASE_ZH"),
                    },
                ),
            ),
        ),
    )
    monkeypatch.setattr(module, "load_config", lambda: cfg)
    monkeypatch.setattr(module, "NLPRuntime", lambda: _TaskMatrixProbeRuntime())


def _install_fragmented_ner_runtime_mocks(monkeypatch):
    from copaw.app.routers import knowledge_hanlp_tasks as module

    fake_cfg = SimpleNamespace(
        knowledge=SimpleNamespace(
            hanlp=SimpleNamespace(model_id="MSRA_NER_BERT_BASE_ZH"),
        ),
    )
    monkeypatch.setattr(module, "load_config", lambda: fake_cfg)
    monkeypatch.setattr(module, "NLPRuntime", lambda: _FragmentedNerRuntime())


def _install_slow_tokenize_runtime_mocks(monkeypatch):
    from copaw.app.routers import knowledge_hanlp_tasks as module

    fake_cfg = SimpleNamespace(
        knowledge=SimpleNamespace(
            nlp=SimpleNamespace(
                model_id="FINE_ELECTRA_SMALL_ZH",
                tokenize_timeout_sec=0.01,
                task_matrix=SimpleNamespace(tasks={}),
            ),
        ),
    )
    monkeypatch.setattr(module, "load_config", lambda: fake_cfg)
    monkeypatch.setattr(module, "NLPRuntime", lambda: _SlowTokenizeRuntime())
    monkeypatch.setattr(module, "_route_timeout_sec", lambda task_key, effective_config: 0.01)


def test_copaw_hanlp_ner_run_endpoint(monkeypatch):
    _install_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/ner/run",
            json={"text": "微软发布新模型", "request_id": "req-ner-1"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "ner"
    assert payload["request_id"] == "req-ner-1"
    assert payload["status"] == "ready"
    assert payload["reason_code"] == "HANLP2_TASK_READY"
    assert payload["resolved_model"] == "MSRA_NER_ELECTRA_SMALL_ZH"
    assert payload["strategy_mode"] == "auto"
    assert payload["detected_style"] == "modern"
    assert payload["fallback_used"] is False
    assert payload["result"][0]["label"] == "ORG"


def test_copaw_hanlp_dep_run_endpoint(monkeypatch):
    _install_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/dep/run",
            json={"text": "微软发布新模型", "request_id": "req-dep-1"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "dep"
    assert payload["request_id"] == "req-dep-1"
    assert payload["status"] == "ready"
    assert payload["reason_code"] == "HANLP2_TASK_READY"
    assert payload["resolved_model"] == "MSRA_NER_BERT_BASE_ZH"
    assert payload["strategy_mode"] == "auto"
    assert payload["detected_style"] == "modern"
    assert payload["fallback_used"] is False
    assert payload["result"][0]["deprel"] == "root"


def test_copaw_hanlp_ner_unavailable_hides_result_payload(monkeypatch):
    _install_unavailable_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/ner/run",
            json={"text": "微软发布新模型", "request_id": "req-ner-unavailable"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "ner"
    assert payload["request_id"] == "req-ner-unavailable"
    assert payload["status"] == "unavailable"
    assert payload["reason_code"] == "HANLP2_MODEL_LOAD_FAILED"
    assert payload["fallback_used"] is True
    assert payload["result"] is None


def test_copaw_hanlp_dep_unavailable_hides_result_payload(monkeypatch):
    _install_unavailable_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/dep/run",
            json={"text": "微软发布新模型", "request_id": "req-dep-unavailable"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "dep"
    assert payload["request_id"] == "req-dep-unavailable"
    assert payload["status"] == "unavailable"
    assert payload["reason_code"] == "HANLP2_MODEL_LOAD_FAILED"
    assert payload["fallback_used"] is True
    assert payload["result"] is None


def test_copaw_hanlp_auto_route_classical_chinese_model(monkeypatch):
    _install_runtime_mocks_with_strategy(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/ner/run",
            json={"text": "吾之道也", "request_id": "req-ner-lzh"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["detected_style"] == "classical_chinese"
    assert payload["resolved_model"] == "hanlp.pretrained.mtl.KYOTO_EVAHAN_TOK_LEM_POS_UDEP_LZH"
    assert payload["detection_score"] >= 0.2
    assert "strategy.auto_classical_chinese" in payload["matched_rules"]
    assert _FakeRuntime.last_ner_model_id == "hanlp.pretrained.mtl.KYOTO_EVAHAN_TOK_LEM_POS_UDEP_LZH"


def test_copaw_hanlp_auto_route_modern_text_uses_default_model(monkeypatch):
    _install_runtime_mocks_with_strategy(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/ner/run",
            json={"text": "我们正在测试模型自动选择能力", "request_id": "req-ner-modern"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["detected_style"] == "modern"
    assert payload["resolved_model"] == "hanlp.pretrained.mtl.CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH"
    assert payload["detection_score"] < 0.2
    assert _FakeRuntime.last_ner_model_id == "hanlp.pretrained.mtl.CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH"


def test_copaw_hanlp_ner_prefers_task_matrix_model_over_strategy_default(monkeypatch):
    _install_runtime_mocks_with_strategy_and_task_matrix(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/ner/run",
            json={"text": "微软在北京发布Copaw", "request_id": "req-ner-matrix-priority"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["resolved_model"] == "MSRA_NER_BERT_BASE_ZH"
    assert "strategy.default_model_id" in payload["matched_rules"]
    assert _TaskMatrixProbeRuntime.last_ner_matrix_model_id == "MSRA_NER_ELECTRA_SMALL_ZH"


def test_copaw_hanlp_ner_injects_runtime_default_model_when_matrix_empty(monkeypatch):
    from copaw.app.routers import knowledge_hanlp_tasks as module

    cfg = SimpleNamespace(
        knowledge=SimpleNamespace(
            nlp=SimpleNamespace(
                model_id="FINE_ELECTRA_SMALL_ZH",
                strategy=SimpleNamespace(
                    mode="auto",
                    default_model_id="FINE_ELECTRA_SMALL_ZH",
                    task_overrides={},
                    auto_classical_chinese=SimpleNamespace(enabled=False, threshold=0.2, model_id=""),
                ),
                task_matrix=SimpleNamespace(
                    tasks={
                        "ner_msra": SimpleNamespace(model_id=""),
                    },
                ),
            ),
        ),
    )
    monkeypatch.setattr(module, "load_config", lambda: cfg)
    monkeypatch.setattr(module, "NLPRuntime", lambda: _TaskMatrixProbeRuntime())

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/ner/run",
            json={"text": "微软在北京发布Copaw", "request_id": "req-ner-matrix-default"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["resolved_model"] == "MSRA_NER_ELECTRA_SMALL_ZH"
    assert _TaskMatrixProbeRuntime.last_ner_matrix_model_id == "MSRA_NER_ELECTRA_SMALL_ZH"


def test_copaw_hanlp_dep_injects_runtime_default_model_when_matrix_empty(monkeypatch):
    from copaw.app.routers import knowledge_hanlp_tasks as module

    cfg = SimpleNamespace(
        knowledge=SimpleNamespace(
            nlp=SimpleNamespace(
                model_id="FINE_ELECTRA_SMALL_ZH",
                strategy=SimpleNamespace(
                    mode="auto",
                    default_model_id="FINE_ELECTRA_SMALL_ZH",
                    task_overrides={},
                    auto_classical_chinese=SimpleNamespace(enabled=False, threshold=0.2, model_id=""),
                ),
                task_matrix=SimpleNamespace(
                    tasks={
                        "dep": SimpleNamespace(model_id=""),
                    },
                ),
            ),
        ),
    )
    monkeypatch.setattr(module, "load_config", lambda: cfg)
    monkeypatch.setattr(module, "NLPRuntime", lambda: _FakeRuntime())

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/dep/run",
            json={"text": "微软在北京发布Copaw", "request_id": "req-dep-matrix-default"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["resolved_model"] == "CTB9_DEP_ELECTRA_SMALL"
    assert payload["effective_task_model_id"] == "CTB9_DEP_ELECTRA_SMALL"


def test_copaw_hanlp_ner_filters_noisy_and_overlapping_entities(monkeypatch):
    from copaw.app.routers import knowledge_hanlp_tasks as module

    normalized = module._normalize_ner_result(
        [
            ["北京", "LOCATION", 3, 5],
            ["微软在北京", "LOCATION", 0, 5],
            ["发布", "PERSON", 5, 7],
            ["布", "PERSON", 6, 7],
        ],
        "微软在北京发布Copaw。",
    )

    assert any(item.get("text") == "北京" and item.get("label") == "LOCATION" for item in normalized)
    assert all(str(item.get("text") or "") != "发布" for item in normalized)
    assert all(str(item.get("text") or "") != "微软在北京" for item in normalized)


def test_copaw_hanlp_ner_runtime_timeout_is_raised_for_bert_when_too_low(monkeypatch):
    from copaw.app.routers import knowledge_hanlp_tasks as module

    cfg = SimpleNamespace(
        nlp=SimpleNamespace(
            task_matrix=SimpleNamespace(
                tasks={
                    "ner_msra": SimpleNamespace(
                        model_id="MSRA_NER_BERT_BASE_ZH",
                        timeout_sec=30,
                    ),
                },
            ),
        ),
    )

    module._ensure_runtime_task_model_defaults("ner", cfg)
    assert float(cfg.nlp.task_matrix.tasks["ner_msra"].timeout_sec) >= 60.0


def test_copaw_hanlp_ner_route_timeout_budget_matches_ner_model(monkeypatch):
    from copaw.app.routers import knowledge_hanlp_tasks as module

    cfg = SimpleNamespace(
        nlp=SimpleNamespace(
            task_matrix=SimpleNamespace(
                tasks={
                    "ner_msra": SimpleNamespace(
                        model_id="MSRA_NER_BERT_BASE_ZH",
                        timeout_sec=30,
                    ),
                },
            ),
            tokenize_timeout_sec=15,
        ),
    )

    module._ensure_runtime_task_model_defaults("ner", cfg)
    timeout_sec = module._route_timeout_sec("ner", cfg)

    assert timeout_sec >= 60.0
    assert timeout_sec <= 90.0


def test_copaw_hanlp_ner_merges_adjacent_fragments_and_repairs_span(monkeypatch):
    _install_fragmented_ner_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/ner/run",
            json={"text": "微软在北京发布Copaw。", "request_id": "req-ner-fragment"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["result"][0]["text"] == "北京"
    assert payload["result"][0]["label"] == "LOCATION"
    assert payload["result"][0]["start"] == 3
    assert payload["result"][0]["end"] == 5


def test_copaw_hanlp_tokenize_run_endpoint(monkeypatch):
    _install_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/tokenize/run",
            json={"text": "微软 发布 新模型", "request_id": "req-tokenize-1"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "tokenize"
    assert payload["status"] == "ready"
    assert payload["result"] == ["微软", "发布", "新模型"]


def test_copaw_hanlp_ner_nested_list_result_is_normalized(monkeypatch):
    _install_nested_list_ner_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/ner/run",
            json={"text": "微软发布新模型", "request_id": "req-ner-nested-list"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ready"
    assert payload["raw_result"] == [[], [], [], [["微", "PERSON", 0, 1]]]
    assert payload["result"] == [{"text": "微", "label": "PERSON", "start": 0, "end": 1, "score": None}]


def test_copaw_hanlp_tokenize_run_slash_endpoint(monkeypatch):
    _install_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/tokenize/run",
            json={"text": "微软 发布 新模型", "request_id": "req-tokenize-2"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "tokenize"
    assert payload["status"] == "ready"
    assert payload["result"] == ["微软", "发布", "新模型"]


def test_copaw_hanlp_tokenize_batch_of_five_sentences(monkeypatch):
    _install_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/tokenize/run",
            json={
                "texts": [
                    "微软 发布 新模型",
                    "阿里 发布 新平台",
                    "百度 升级 检索",
                    "腾讯 发布 引擎",
                    "字节 上线 服务",
                ],
                "request_id": "req-tokenize-batch-5",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "tokenize"
    assert payload["status"] == "ready"
    assert payload["reason_code"] == "HANLP2_BATCH_READY"
    assert isinstance(payload["result"], list)
    assert len(payload["result"]) == 5
    assert payload["result"][0]["status"] == "ready"
    assert payload["result"][0]["result"] == ["微软", "发布", "新模型"]


def test_copaw_hanlp_batch_rejects_more_than_five_sentences(monkeypatch):
    _install_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/tokenize/run",
            json={
                "texts": [
                    "句子一",
                    "句子二",
                    "句子三",
                    "句子四",
                    "句子五",
                    "句子六",
                ],
                "request_id": "req-tokenize-batch-6",
            },
        )

    assert response.status_code == 422 or response.status_code == 400
    if response.status_code == 400:
        assert response.json().get("detail") == "HANLP_BATCH_TOO_LARGE"


def test_copaw_hanlp_tokenize_run_slash_endpoint_degrades_on_route_timeout(monkeypatch):
    _install_slow_tokenize_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/tokenize/run",
            json={"text": "微软 发布 新模型", "request_id": "req-tokenize-timeout"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "tokenize"
    assert payload["status"] == "degraded"
    assert payload["reason_code"] == "HANLP2_ROUTE_TIMEOUT"
    assert payload["result"] is None
    assert payload["fallback_used"] is True
    assert payload["duration_ms"] < 350


def test_route_timeout_sec_is_capped_for_interactive_requests():
    from copaw.app.routers import knowledge_hanlp_tasks as module

    effective_config = SimpleNamespace(
        nlp=SimpleNamespace(
            tokenize_timeout_sec=15.0,
            task_matrix=SimpleNamespace(
                tasks={
                    "tok": SimpleNamespace(timeout_sec=30.0),
                }
            ),
        )
    )

    timeout_sec = module._route_timeout_sec("tokenize", effective_config)

    assert timeout_sec == module._ROUTE_TIMEOUT_MAX_SEC


def test_copaw_hanlp_tokenize_run_degrades_when_route_setup_exceeds_deadline(monkeypatch):
    from copaw.app.routers import knowledge_hanlp_tasks as module

    async def _slow_resolve(_request):
        await asyncio.sleep(0.05)
        return SimpleNamespace(
            nlp=SimpleNamespace(
                model_id="FINE_ELECTRA_SMALL_ZH",
                tokenize_timeout_sec=30.0,
                task_matrix=SimpleNamespace(tasks={}),
            )
        )

    monkeypatch.setattr(module, "_resolve_knowledge_config", _slow_resolve)
    monkeypatch.setattr(module, "_route_deadline_sec", lambda: 0.01)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/tokenize/run",
            json={"text": "微软 发布 新模型", "request_id": "req-tokenize-setup-timeout"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "tokenize"
    assert payload["status"] == "degraded"
    assert payload["reason_code"] == "HANLP2_ROUTE_TIMEOUT"
    assert payload["result"] is None
    assert payload["fallback_used"] is True


def test_copaw_hanlp_colon_run_endpoint_is_not_supported(monkeypatch):
    _install_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/tokenize:run",
            json={"text": "微软 发布 新模型", "request_id": "req-tokenize-colon"},
        )

    assert response.status_code == 405


def test_copaw_hanlp_sdp_run_endpoint(monkeypatch):
    _install_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/sdp/run",
            json={"text": "微软发布新模型", "request_id": "req-sdp-1"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "sdp"
    assert payload["status"] == "ready"
    assert payload["result"]["task"] == "sdp"


def test_copaw_hanlp_srl_run_endpoint(monkeypatch):
    _install_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/srl/run",
            json={"text": "微软发布新模型", "request_id": "req-srl-1"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "srl"
    assert payload["status"] == "ready"
    assert isinstance(payload["result"], list)
    assert payload["result"][1]["role"] == "PRED"
    assert payload["result"][1]["text"] == "发布"


def test_copaw_hanlp_srl_run_with_tokens_endpoint(monkeypatch):
    _install_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/srl/run",
            json={
                "tokens": ["HanLP", "支持", "流程", "复用"],
                "request_id": "req-srl-tokenized-1",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "srl"
    assert payload["status"] == "ready"
    assert payload["result"][0]["role"] == "PRED"
    assert payload["result"][0]["text"] == "支持"


def test_copaw_hanlp_ner_run_with_tokens_endpoint(monkeypatch):
    _install_runtime_mocks(monkeypatch)
    _FakeRuntime.last_tokenized_task_key = None
    _FakeRuntime.last_tokenized_tokens = None

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/ner/run",
            json={
                "tokens": ["微软", "发布", "新模型"],
                "request_id": "req-ner-tokenized-1",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "ner"
    assert payload["status"] == "ready"
    assert isinstance(payload["result"], list)
    assert _FakeRuntime.last_tokenized_task_key == "ner_msra"
    assert _FakeRuntime.last_tokenized_tokens == ["微软", "发布", "新模型"]


def test_copaw_hanlp_srl_run_with_tokens_batch_endpoint(monkeypatch):
    _install_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/srl/run",
            json={
                "tokens_batch": [
                    ["HanLP", "支持", "流程", "复用"],
                    ["语义", "角色", "分析"],
                ],
                "request_id": "req-srl-tokenized-batch-1",
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "srl"
    assert payload["status"] == "ready"
    assert isinstance(payload["result"], list)
    assert len(payload["result"]) == 2
    assert payload["result"][0]["status"] == "ready"
    assert payload["result"][0]["result"][0]["role"] == "PRED"


def test_copaw_hanlp_unknown_task_rejected(monkeypatch):
    _install_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/unknown/run",
            json={"text": "微软发布新模型", "request_id": "req-unknown-1"},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "HANLP_TASK_UNSUPPORTED"
