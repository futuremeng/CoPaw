# -*- coding: utf-8 -*-

from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from qwenpaw.app.routers import agent as agent_router_module


def test_get_local_whisper_status_offloads_to_thread(monkeypatch):
    app = FastAPI()
    app.include_router(agent_router_module.router)

    original_to_thread = agent_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(agent_router_module.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(
        "qwenpaw.agents.utils.audio_transcription.check_local_whisper_available",
        lambda: {
            "available": True,
            "ffmpeg_installed": True,
            "whisper_installed": True,
        },
    )

    client = TestClient(app)
    response = client.get("/agent/local-whisper-status")

    assert response.status_code == 200
    assert response.json()["available"] is True
    assert calls
    assert calls[0][0].__name__ == "<lambda>"


def test_get_hanlp_status_offloads_to_thread(monkeypatch):
    app = FastAPI()
    app.include_router(agent_router_module.router)

    original_to_thread = agent_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(agent_router_module.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(
        "qwenpaw.agents.utils.hanlp_sidecar.get_hanlp_sidecar_status",
        lambda **_kwargs: {
            "sidecar": {
                "status": "ready",
                "reason_code": "HANLP2_READY",
                "reason": "HanLP2 semantic engine is ready.",
                "enabled": True,
                "python_executable": "/tmp/hanlp/python",
                "managed": True,
                "uv_available": True,
                "hanlp_home": "/tmp/hanlp/home",
            },
            "model": {
                "status": "ready",
                "reason_code": "HANLP2_MODEL_READY",
                "reason": "HanLP2 tokenizer model is ready.",
                "model_id": "FINE_ELECTRA_SMALL_ZH",
            },
            "tasks": {
                "ner_msra": {
                    "status": "ready",
                    "reason_code": "HANLP2_TASK_READY",
                    "reason": "HanLP task is ready.",
                    "task_name": "ner/msra",
                }
            },
        },
    )

    client = TestClient(app)
    response = client.get("/agent/hanlp-status")

    assert response.status_code == 200
    assert response.json()["sidecar"]["status"] == "ready"
    assert calls
    assert calls[0][0].__name__ == "<lambda>"


def test_post_hanlp_install_offloads_to_thread(monkeypatch):
    app = FastAPI()
    app.include_router(agent_router_module.router)

    original_to_thread = agent_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(agent_router_module.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(
        "qwenpaw.agents.utils.hanlp_sidecar.auto_install_hanlp_sidecar",
        lambda: {
            "success": True,
            "already_available": False,
            "status_before": {"sidecar": {"status": "unavailable"}, "model": {"status": "unavailable"}, "tasks": {}},
            "status_after": {"sidecar": {"status": "ready"}, "model": {"status": "unavailable"}, "tasks": {}},
            "operations": [],
            "manual_steps": [],
        },
    )

    client = TestClient(app)
    response = client.post("/agent/hanlp-install")

    assert response.status_code == 200
    assert response.json()["success"] is True
    assert calls
    assert calls[0][0].__name__ == "<lambda>"


def test_post_hanlp_download_model_offloads_to_thread(monkeypatch):
    app = FastAPI()
    app.include_router(agent_router_module.router)

    original_to_thread = agent_router_module.asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr(agent_router_module.asyncio, "to_thread", fake_to_thread)
    monkeypatch.setattr(
        "qwenpaw.agents.utils.hanlp_sidecar.ensure_hanlp_model",
        lambda: {
            "success": True,
            "status_before": {"sidecar": {"status": "ready"}, "model": {"status": "unavailable"}, "tasks": {}},
            "status_after": {"sidecar": {"status": "ready"}, "model": {"status": "ready"}, "tasks": {"ner_msra": {"status": "ready"}}},
            "model_result": {
                "status": "ready",
                "reason_code": "HANLP2_MODEL_READY",
                "reason": "HanLP2 tokenizer model is ready.",
                "model_id": "FINE_ELECTRA_SMALL_ZH",
            },
            "task_results": {
                "ner_msra": {
                    "status": "ready",
                    "reason_code": "HANLP2_TASK_READY",
                    "reason": "HanLP task is ready.",
                    "task_name": "ner/msra",
                }
            },
            "manual_steps": [],
        },
    )

    client = TestClient(app)
    response = client.post("/agent/hanlp-download-model")

    assert response.status_code == 200
    assert response.json()["model_result"]["status"] == "ready"
    assert calls
    assert calls[0][0].__name__ == "<lambda>"


def test_put_nlp_strategy_updates_config(monkeypatch):
    app = FastAPI()
    app.include_router(agent_router_module.router)

    config = SimpleNamespace(
        knowledge=SimpleNamespace(
            nlp=SimpleNamespace(
                strategy=SimpleNamespace(
                    mode="auto",
                    default_model_id="model-default-old",
                    task_overrides={"ner": "old-model"},
                    auto_classical_chinese=SimpleNamespace(
                        enabled=False,
                        threshold=0.5,
                        model_id="model-old-lzh",
                    ),
                ),
            ),
        ),
    )
    saved = {"called": False}

    monkeypatch.setattr(agent_router_module, "load_config", lambda: config)

    def _fake_save_config(new_config):
        _ = new_config
        saved["called"] = True

    monkeypatch.setattr(agent_router_module, "save_config", _fake_save_config)

    client = TestClient(app)
    response = client.put(
        "/agent/nlp-strategy",
        json={
            "mode": "hybrid",
            "default_model_id": "model-default-new",
            "task_overrides": {
                "ner": "model-ner-new",
                "": "invalid",
                "dep": "",
            },
            "auto_classical_chinese": {
                "enabled": True,
                "threshold": 0.23,
                "model_id": "model-lzh-new",
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["strategy"]["mode"] == "hybrid"
    assert payload["strategy"]["default_model_id"] == "model-default-new"
    assert payload["strategy"]["task_overrides"] == {"ner": "model-ner-new"}
    assert payload["strategy"]["auto_classical_chinese"]["enabled"] is True
    assert payload["strategy"]["auto_classical_chinese"]["threshold"] == 0.23
    assert payload["strategy"]["auto_classical_chinese"]["model_id"] == "model-lzh-new"
    assert saved["called"] is True


def test_post_nlp_strategy_dry_run_classical_chinese(monkeypatch):
    app = FastAPI()
    app.include_router(agent_router_module.router)

    config = SimpleNamespace(
        knowledge=SimpleNamespace(
            nlp=SimpleNamespace(
                model_id="model-default",
                strategy=SimpleNamespace(
                    mode="auto",
                    default_model_id="model-default",
                    task_overrides={},
                    auto_classical_chinese=SimpleNamespace(
                        enabled=True,
                        threshold=0.2,
                        model_id="model-lzh",
                    ),
                ),
            ),
        ),
    )

    monkeypatch.setattr(agent_router_module, "load_config", lambda: config)

    client = TestClient(app)
    response = client.post(
        "/agent/nlp-strategy/dry-run",
        json={
            "task_key": "ner",
            "text": "吾之道也",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    decision = payload["decision"]
    assert decision["detected_style"] == "classical_chinese"
    assert decision["selected_model"] == "model-lzh"
    assert decision["detection_score"] >= 0.2
    assert "strategy.auto_classical_chinese" in decision["matched_rules"]


def test_post_nlp_strategy_dry_run_modern_text(monkeypatch):
    app = FastAPI()
    app.include_router(agent_router_module.router)

    config = SimpleNamespace(
        knowledge=SimpleNamespace(
            nlp=SimpleNamespace(
                model_id="model-default",
                strategy=SimpleNamespace(
                    mode="auto",
                    default_model_id="model-default",
                    task_overrides={},
                    auto_classical_chinese=SimpleNamespace(
                        enabled=True,
                        threshold=0.5,
                        model_id="model-lzh",
                    ),
                ),
            ),
        ),
    )

    monkeypatch.setattr(agent_router_module, "load_config", lambda: config)

    client = TestClient(app)
    response = client.post(
        "/agent/nlp-strategy/dry-run",
        json={
            "task_key": "ner",
            "text": "我们正在测试模型自动选择能力",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    decision = payload["decision"]
    assert decision["detected_style"] == "modern"
    assert decision["selected_model"] == "model-default"
    assert decision["detection_score"] < 0.5


def test_get_running_config_does_not_force_workspace_start(monkeypatch):
    app = FastAPI()
    app.include_router(agent_router_module.router)

    running = SimpleNamespace(max_iters=7, knowledge_enabled=True)
    monkeypatch.setattr(
        agent_router_module,
        "resolve_agent_id_for_request",
        lambda request: "default",
    )
    monkeypatch.setattr(
        agent_router_module,
        "get_loaded_agent_for_request",
        lambda request, agent_id=None: None,
    )
    monkeypatch.setattr(
        agent_router_module,
        "load_agent_config",
        lambda agent_id: SimpleNamespace(running=running),
    )

    manager = MagicMock()
    manager.get_agent.side_effect = AssertionError("workspace should not start")
    app.state.multi_agent_manager = manager

    client = TestClient(app)
    response = client.get("/agent/running-config")

    assert response.status_code == 200
    assert response.json()["max_iters"] == 7
    manager.get_agent.assert_not_called()
