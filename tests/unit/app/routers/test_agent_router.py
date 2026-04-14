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