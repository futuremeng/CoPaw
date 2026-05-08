# -*- coding: utf-8 -*-

from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient


class _FakeRuntime:
    last_ner_model_id: str | None = None
    last_dep_model_id: str | None = None

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
        return {"task": task_key, "text": text}, {
            "status": "ready",
            "reason_code": "HANLP2_TASK_READY",
            "reason": "HanLP task is ready.",
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


def test_copaw_hanlp_ner_run_endpoint(monkeypatch):
    _install_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/ner:run",
            json={"text": "微软发布新模型", "request_id": "req-ner-1"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "ner"
    assert payload["request_id"] == "req-ner-1"
    assert payload["status"] == "ready"
    assert payload["reason_code"] == "HANLP2_TASK_READY"
    assert payload["resolved_model"] == "MSRA_NER_BERT_BASE_ZH"
    assert payload["strategy_mode"] == "auto"
    assert payload["detected_style"] == "modern"
    assert payload["fallback_used"] is False
    assert payload["result"][0]["label"] == "ORG"


def test_copaw_hanlp_dep_run_endpoint(monkeypatch):
    _install_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/dep:run",
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
            "/knowledge/tasks/ner:run",
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
            "/knowledge/tasks/dep:run",
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
            "/knowledge/tasks/ner:run",
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
            "/knowledge/tasks/ner:run",
            json={"text": "我们正在测试模型自动选择能力", "request_id": "req-ner-modern"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["detected_style"] == "modern"
    assert payload["resolved_model"] == "hanlp.pretrained.mtl.CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH"
    assert payload["detection_score"] < 0.2
    assert _FakeRuntime.last_ner_model_id == "hanlp.pretrained.mtl.CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH"


def test_copaw_hanlp_tokenize_run_endpoint(monkeypatch):
    _install_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/tokenize:run",
            json={"text": "微软 发布 新模型", "request_id": "req-tokenize-1"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "tokenize"
    assert payload["status"] == "ready"
    assert payload["result"] == ["微软", "发布", "新模型"]


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


def test_copaw_hanlp_sdp_run_endpoint(monkeypatch):
    _install_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/sdp:run",
            json={"text": "微软发布新模型", "request_id": "req-sdp-1"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_key"] == "sdp"
    assert payload["status"] == "ready"
    assert payload["result"]["task"] == "sdp"


def test_copaw_hanlp_unknown_task_rejected(monkeypatch):
    _install_runtime_mocks(monkeypatch)

    from copaw.app._app import app

    with TestClient(app) as client:
        response = client.post(
            "/knowledge/tasks/unknown:run",
            json={"text": "微软发布新模型", "request_id": "req-unknown-1"},
        )

    assert response.status_code == 400
    assert response.json()["detail"] == "HANLP_TASK_UNSUPPORTED"
