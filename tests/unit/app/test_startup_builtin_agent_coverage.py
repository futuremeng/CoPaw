# -*- coding: utf-8 -*-
"""Pin the fork's startup step that supersedes upstream's QA-agent call.

Upstream's lifespan calls ``ensure_qa_agent_exists()``; this fork replaced
that step with ``ensure_builtin_agents_exist()``, which must still seed the
QA agent.
"""

import inspect

from qwenpaw.app import _app as app_module
from qwenpaw.app.builtin_agents import BUILTIN_AGENT_SPECS
from qwenpaw.constant import BUILTIN_QA_AGENT_ID


def test_lifespan_runs_the_builtin_agents_startup_step() -> None:
    source = inspect.getsource(app_module.lifespan)
    assert "ensure_builtin_agents_exist()" in source


def test_builtin_agent_specs_cover_the_qa_agent() -> None:
    assert BUILTIN_QA_AGENT_ID in {spec.id for spec in BUILTIN_AGENT_SPECS}
