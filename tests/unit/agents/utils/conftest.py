# -*- coding: utf-8 -*-
"""Fixtures for qwenpaw.agents.utils unit tests."""

from __future__ import annotations

import pytest

from qwenpaw.agents.utils import audio_transcription


def _clear_status_cache() -> None:
    audio_transcription._local_whisper_status_cache = None
    audio_transcription._local_whisper_status_cache_time = 0.0


@pytest.fixture(autouse=True)
def reset_local_whisper_status_cache():
    """Drop the module-level whisper probe cache around every test.

    CoPaw caches ``check_local_whisper_available()`` for 30s (9f72551fb) so the
    agent routers do not re-probe on every request. Upstream's tests each patch
    a different fake environment and expect a fresh probe, so with the cache
    live whichever of them runs second reads the previous one's result.
    """
    _clear_status_cache()
    yield
    _clear_status_cache()
