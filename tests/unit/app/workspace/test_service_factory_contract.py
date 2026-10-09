# -*- coding: utf-8 -*-
"""Contract tests for the workspace service factories.

``ServiceManager._run_post_init`` invokes every ``post_init`` factory with
three arguments (workspace, service, publish). A fork-owned factory written
against the older two-argument shape raises ``TypeError`` on every workspace
startup and the service it should install never exists.
"""
from __future__ import annotations

import asyncio
import inspect
from types import SimpleNamespace

import pytest

from qwenpaw.app.workspace import service_factories


def _fake_workspace(tmp_path) -> SimpleNamespace:
    return SimpleNamespace(
        agent_id="agent-1",
        workspace_dir=tmp_path,
        _service_manager=SimpleNamespace(services={}),
    )


def _publish_into(ws: SimpleNamespace):
    """The manager's own callback shape: store under the descriptor name."""

    published: list[object] = []

    def publish(instance: object) -> None:
        published.append(instance)
        ws._service_manager.services["project_knowledge_watcher"] = instance

    return published, publish


def test_project_knowledge_watcher_publishes_through_manager_contract(
    tmp_path,
):
    ws = _fake_workspace(tmp_path)
    published, publish = _publish_into(ws)

    watcher = asyncio.run(
        service_factories.create_project_knowledge_watcher(
            ws,
            None,
            publish,
        ),
    )

    assert watcher is not None
    assert published == [watcher]
    assert ws._service_manager.services["project_knowledge_watcher"] is (
        watcher
    )


@pytest.mark.parametrize(
    "factory_name",
    sorted(
        name
        for name, value in vars(service_factories).items()
        if name.startswith("create_") and inspect.iscoroutinefunction(value)
    ),
)
def test_every_factory_accepts_the_three_argument_contract(factory_name):
    factory = getattr(service_factories, factory_name)
    parameters = list(inspect.signature(factory).parameters.values())
    positional = [
        parameter
        for parameter in parameters
        if parameter.kind
        in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        )
    ]
    assert len(positional) >= 3, (
        f"{factory_name} takes {len(positional)} positional arguments; "
        "ServiceManager post_init always passes (workspace, service, publish)"
    )
