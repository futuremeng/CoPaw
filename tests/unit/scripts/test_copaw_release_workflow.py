# -*- coding: utf-8 -*-
"""The fork's own release workflow may only publish through the channel gate.

Upstream's ``release.yml`` and ``publish-pypi.yml`` stay in the tree and are
meant to be disabled in repository settings, not edited (design 7).  So this
workflow is the only path by which a CoPaw-named build can reach PyPI, and it
exists to close the two accidents that matter: publishing on a trigger nobody
confirmed, and publishing a build whose artifacts still carry upstream's
distribution name.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = REPO_ROOT / ".github/workflows/copaw-release.yml"
PUBLISH_ACTION = "pypa/gh-action-pypi-publish"


def _text() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


def _document() -> dict:
    return yaml.safe_load(_text())


def _triggers() -> dict:
    # PyYAML 1.1 reads the unquoted ``on:`` key as the boolean True.
    document = _document()
    return document.get("on") or document.get(True)


def _job_text(job: dict) -> str:
    return "\n".join(
        f"{step.get('uses', '')} {step.get('run', '')}"
        for step in job.get("steps", [])
    )


def _jobs_where(predicate) -> dict:
    return {
        name: job
        for name, job in _document()["jobs"].items()
        if predicate(job)
    }


def _publishing_jobs() -> dict:
    return _jobs_where(
        lambda job: any(
            PUBLISH_ACTION in str(step.get("uses", ""))
            for step in job.get("steps", [])
        ),
    )


def test_the_workflow_exists_and_parses():
    assert WORKFLOW.exists()
    assert isinstance(_document()["jobs"], dict)


def test_it_can_only_be_started_by_hand():
    """``publish-pypi.yml`` also fires on ``release: published``, which would
    publish whatever the last GitHub Release built -- including a wheel made
    before the distribution rename.  Ours has exactly one trigger."""
    triggers = _triggers()
    assert list(triggers) == ["workflow_dispatch"]
    assert "confirm_publish" in triggers["workflow_dispatch"]["inputs"]


def test_a_job_exports_the_channel_facts_and_runs_the_consistency_gate():
    facts = _jobs_where(
        lambda job: "release_channel.py --gh-env" in _job_text(job),
    )
    assert facts, "no job reads the fact source"
    gate = _jobs_where(
        lambda job: "check_release_channel_consistency.py" in _job_text(job),
    )
    assert gate, "the workflow publishes without the consistency gate"


def test_the_publish_job_downstreams_the_artifact_check():
    checked = _jobs_where(
        lambda job: "--check-artifacts" in _job_text(job),
    )
    assert checked, "nothing ever calls --check-artifacts"
    publishing = _publishing_jobs()
    assert publishing, "the workflow does not publish at all"
    for name, job in publishing.items():
        needs = job.get("needs", [])
        needs = [needs] if isinstance(needs, str) else needs
        assert set(checked) <= set(
            needs,
        ), f"{name} publishes without the artifact gate"


def test_publishing_requires_the_explicit_confirmation():
    publishing = _publishing_jobs()
    assert publishing
    for name, job in publishing.items():
        assert "inputs.confirm_publish" in str(
            job.get("if", ""),
        ), f"{name} would publish on an unconfirmed run"


def test_it_never_borrows_upstream_pypi_secret_name():
    """``secrets.PYPI_API_TOKEN`` is upstream's token name.  A fork that
    creates it for its own project would be pointing at whatever that secret
    actually holds, so ours is named with the COPAW_ prefix and the bare name
    must not appear."""
    assert not re.search(r"secrets\.PYPI_API_TOKEN", _text())
    assert "secrets.COPAW_PYPI_API_TOKEN" in _text()
