# -*- coding: utf-8 -*-
"""Workspace memory-manager backend resolution must use the registry.

Upstream #3548 replaced the hardcoded resolver with the
``memory_registry`` lookup in ``get_memory_manager_backend``; a fork merge
resurrected the old resolver, which only knows ``remelight``.
"""
import tempfile
from pathlib import Path

import pytest


def _memory_descriptor(ws):
    return ws._service_manager.descriptors["memory_manager"]  # pylint: disable=W0212


class _Running:
    def __init__(self, backend):
        self.memory_manager_backend = backend


class _Config:
    def __init__(self, backend):
        self.running = _Running(backend)


@pytest.fixture
def workspace():
    from qwenpaw.app.workspace import Workspace

    with tempfile.TemporaryDirectory() as tmpdir:
        ws = Workspace(agent_id="test123", workspace_dir=Path(tmpdir) / "a")
        ws._config = _Config("remelight")  # pylint: disable=W0212
        yield ws


def test_every_registered_backend_resolves(workspace):
    """Registry contract: each registered name resolves to its own class.

    Enumerated rather than hardcoded to one backend name, so the guard survives
    the set of registered backends changing underneath it.
    """
    from qwenpaw.agents.memory.base_memory_manager import memory_registry

    names = memory_registry.list_registered()
    assert names
    for name in names:
        workspace._config = _Config(name)  # pylint: disable=W0212
        assert (
            _memory_descriptor(workspace).service_class(workspace)
            is memory_registry.get(name)
        )


def test_remelight_backend_resolves(workspace):
    from qwenpaw.agents.memory.reme_light_memory_manager import (
        ReMeLightMemoryManager,
    )

    assert _memory_descriptor(workspace).service_class(
        workspace
    ) is ReMeLightMemoryManager


def test_unknown_backend_falls_back_instead_of_raising(workspace):
    """Registry contract: unknown name warns and returns a registered class."""
    from qwenpaw.agents.memory.base_memory_manager import memory_registry

    workspace._config = _Config("no-such-backend")  # pylint: disable=W0212
    cls = _memory_descriptor(workspace).service_class(workspace)
    registered = {
        memory_registry.get(name)
        for name in memory_registry.list_registered()
    }
    assert cls in registered
