# -*- coding: utf-8 -*-

from __future__ import annotations

from types import SimpleNamespace

from fastapi.testclient import TestClient


class _FakeRuntime:
    def run_ner(self, text: str, config):
        _ = config
        return [{"text": text, "label": "ORG", "span": [0, len(text)]}], {
            "status": "ready",
            "reason_code": "HANLP2_TASK_READY",
            "reason": "HanLP task is ready.",
        }

    def run_dep(self, text: str, config):
        _ = config
        return [{"token": text, "head": 0, "deprel": "root"}], {
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


def _install_runtime_mocks(monkeypatch):
    from copaw.app.routers import knowledge_hanlp_tasks as module

    fake_cfg = SimpleNamespace(
        knowledge=SimpleNamespace(
            hanlp=SimpleNamespace(model_id="MSRA_NER_BERT_BASE_ZH"),
        ),
    )
    monkeypatch.setattr(module, "load_config", lambda: fake_cfg)
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
    assert payload["result"] is None
