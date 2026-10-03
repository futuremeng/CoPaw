# -*- coding: utf-8 -*-
"""The agent workspace-file routes must stay gone.

Upstream #3738 moved workspace file IO to ``/workspace/*`` and deleted these
handlers; a fork merge resurrected them into ``agents.py``, where they kept a
second, untested copy of the file API alive on the surface.
"""


def _routes():
    from qwenpaw.app.routers.agents import router

    return {
        (route.path, method)
        for route in router.routes
        for method in getattr(route, "methods", ())
    }


def test_resurrected_agent_file_routes_are_gone():
    routes = _routes()
    assert ("/agents/{agentId}/files", "GET") not in routes
    assert ("/agents/{agentId}/files/{filename}", "GET") not in routes
    assert ("/agents/{agentId}/files/{filename}", "PUT") not in routes
    assert ("/agents/{agentId}/memory", "GET") not in routes


def test_live_project_file_route_is_kept():
    assert (
        "/agents/{agentId}/projects/{projectId}/files",
        "GET",
    ) in _routes()
