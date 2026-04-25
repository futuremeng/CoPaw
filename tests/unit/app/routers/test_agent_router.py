# -*- coding: utf-8 -*-

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
        lambda: {
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
            "status_before": {"sidecar": {"status": "unavailable"}, "model": {"status": "unavailable"}},
            "status_after": {"sidecar": {"status": "ready"}, "model": {"status": "unavailable"}},
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
            "status_before": {"sidecar": {"status": "ready"}, "model": {"status": "unavailable"}},
            "status_after": {"sidecar": {"status": "ready"}, "model": {"status": "ready"}},
            "model_result": {
                "status": "ready",
                "reason_code": "HANLP2_MODEL_READY",
                "reason": "HanLP2 tokenizer model is ready.",
                "model_id": "FINE_ELECTRA_SMALL_ZH",
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