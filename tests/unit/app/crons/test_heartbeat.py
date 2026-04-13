# -*- coding: utf-8 -*-
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from copaw.app.crons.heartbeat import run_heartbeat_once
from copaw.constant import HEARTBEAT_FILE, HEARTBEAT_TARGET_LAST


async def _stream_events(_request):
    yield {"type": "message", "text": "heartbeat"}


@pytest.mark.asyncio
async def test_run_heartbeat_once_dispatches_with_agent_last_dispatch(
    tmp_path,
) -> None:
    heartbeat_file = tmp_path / HEARTBEAT_FILE
    heartbeat_file.write_text("ping", encoding="utf-8")

    heartbeat_config = SimpleNamespace(active_hours=None, target=HEARTBEAT_TARGET_LAST)
    last_dispatch = SimpleNamespace(
        channel="console",
        user_id="user-1",
        session_id="session-1",
    )
    runner = SimpleNamespace(stream_query=_stream_events)
    channel_manager = SimpleNamespace(send_event=AsyncMock())

    with patch(
        "copaw.app.crons.heartbeat.get_heartbeat_config",
        return_value=heartbeat_config,
    ), patch(
        "copaw.config.config.load_agent_config",
        return_value=SimpleNamespace(last_dispatch=last_dispatch),
    ):
        await run_heartbeat_once(
            runner=runner,
            channel_manager=channel_manager,
            agent_id="agent-1",
            workspace_dir=tmp_path,
        )

    channel_manager.send_event.assert_awaited_once()
    _, kwargs = channel_manager.send_event.await_args
    assert kwargs["channel"] == "console"
    assert kwargs["user_id"] == "user-1"
    assert kwargs["session_id"] == "session-1"
    assert kwargs["event"] == {"type": "message", "text": "heartbeat"}
    assert kwargs["meta"] == {}


@pytest.mark.asyncio
async def test_run_heartbeat_once_injects_quality_loop_digest(tmp_path) -> None:
    heartbeat_file = tmp_path / HEARTBEAT_FILE
    heartbeat_file.write_text("ping", encoding="utf-8")

    heartbeat_config = SimpleNamespace(active_hours=None, target="main")
    captured_requests: list[dict] = []

    async def _stream_capture(request):
        captured_requests.append(request)
        yield {"type": "message", "text": "ok"}

    runner = SimpleNamespace(stream_query=_stream_capture)
    channel_manager = SimpleNamespace(send_event=AsyncMock())

    project_quality_dir = tmp_path / "projects" / "demo" / ".knowledge"
    project_quality_dir.mkdir(parents=True, exist_ok=True)
    (project_quality_dir / "quality-loop-jobs.json").write_text(
        """
{
  "job-1": {
    "job_id": "job-1",
    "status": "succeeded",
    "stop_reason": "REVIEW_REQUIRED",
    "score_after": 0.61,
    "updated_at": "2026-04-13T12:00:00+00:00"
  }
}
""".strip(),
        encoding="utf-8",
    )

    with patch(
        "copaw.app.crons.heartbeat.get_heartbeat_config",
        return_value=heartbeat_config,
    ):
        await run_heartbeat_once(
            runner=runner,
            channel_manager=channel_manager,
            agent_id="agent-1",
            workspace_dir=tmp_path,
        )

    assert captured_requests
    text = captured_requests[0]["input"][0]["content"][0]["text"]
    assert "[Project Quality Loop Digest]" in text
    assert "Projects needing quality-loop review:" in text
    assert "demo: stop_reason=REVIEW_REQUIRED" in text
    assert "Recommended heartbeat actions:" in text
    assert "review the latest quality-loop evidence" in text


@pytest.mark.asyncio
async def test_run_heartbeat_once_includes_actionable_quality_loop_guidance(
    tmp_path,
) -> None:
    heartbeat_file = tmp_path / HEARTBEAT_FILE
    heartbeat_file.write_text("ping", encoding="utf-8")

    heartbeat_config = SimpleNamespace(active_hours=None, target="main")
    captured_requests: list[dict] = []

    async def _stream_capture(request):
        captured_requests.append(request)
        yield {"type": "message", "text": "ok"}

    runner = SimpleNamespace(stream_query=_stream_capture)
    channel_manager = SimpleNamespace(send_event=AsyncMock())

    stagnated_quality_dir = tmp_path / "projects" / "alpha" / ".knowledge"
    stagnated_quality_dir.mkdir(parents=True, exist_ok=True)
    (stagnated_quality_dir / "quality-loop-jobs.json").write_text(
        """
{
  "job-1": {
    "job_id": "job-1",
    "status": "succeeded",
    "stop_reason": "QUALITY_STAGNATED",
    "score_after": 0.54,
    "updated_at": "2026-04-13T12:00:00+00:00",
    "reflection_artifacts": {
      "lessons_path": "/workspace/projects/alpha/.skills/quality-loop/LESSONS.md",
      "params_path": "/workspace/projects/alpha/.skills/quality-loop/PARAMS.json",
      "rounds_dir": "/workspace/projects/alpha/.skills/quality-loop/rounds"
    }
  }
}
""".strip(),
        encoding="utf-8",
    )
    active_quality_dir = tmp_path / "projects" / "beta" / ".knowledge"
    active_quality_dir.mkdir(parents=True, exist_ok=True)
    (active_quality_dir / "quality-loop-jobs.json").write_text(
        """
{
  "job-2": {
    "job_id": "job-2",
    "status": "running",
    "current": 1,
    "total": 3,
    "stage": "execute_memify",
    "updated_at": "2026-04-13T12:05:00+00:00"
  }
}
""".strip(),
        encoding="utf-8",
    )

    with patch(
        "copaw.app.crons.heartbeat.get_heartbeat_config",
        return_value=heartbeat_config,
    ):
        await run_heartbeat_once(
            runner=runner,
            channel_manager=channel_manager,
            agent_id="agent-1",
            workspace_dir=tmp_path,
        )

    assert captured_requests
    text = captured_requests[0]["input"][0]["content"][0]["text"]
    assert "Active project quality loops:" in text
    assert "beta: active (1/3), stage=execute_memify" in text
    assert "Recommended heartbeat actions:" in text
    assert "alpha: inspect the latest round evidence" in text
    assert "/workspace/projects/alpha/.skills/quality-loop/LESSONS.md" in text
    assert "beta: observe active quality loop" in text


@pytest.mark.asyncio
async def test_run_heartbeat_once_attempts_quality_loop_orchestration_for_actionable_projects(
    tmp_path,
) -> None:
    heartbeat_file = tmp_path / HEARTBEAT_FILE
    heartbeat_file.write_text("ping", encoding="utf-8")

    heartbeat_config = SimpleNamespace(active_hours=None, target="main")
    captured_requests: list[dict] = []
    orchestration_calls: list[dict] = []

    async def _stream_capture(request):
        captured_requests.append(request)
        yield {"type": "message", "text": "ok"}

    def _fake_maybe_start(self, **kwargs):
        orchestration_calls.append(kwargs)
        return {
            "accepted": True,
            "job_id": "quality-job-auto-1",
            "reason": "STARTED",
        }

    runner = SimpleNamespace(stream_query=_stream_capture)
    channel_manager = SimpleNamespace(send_event=AsyncMock())

    stagnated_quality_dir = tmp_path / "projects" / "alpha" / ".knowledge"
    stagnated_quality_dir.mkdir(parents=True, exist_ok=True)
    (stagnated_quality_dir / "quality-loop-jobs.json").write_text(
        """
{
  "job-1": {
    "job_id": "job-1",
    "status": "succeeded",
    "stop_reason": "QUALITY_STAGNATED",
    "score_after": 0.54,
    "updated_at": "2026-04-13T12:00:00+00:00"
  }
}
""".strip(),
        encoding="utf-8",
    )

    with patch(
        "copaw.app.crons.heartbeat.get_heartbeat_config",
        return_value=heartbeat_config,
    ), patch(
        "copaw.app.crons.heartbeat.load_config",
        return_value=SimpleNamespace(
            knowledge=SimpleNamespace(enabled=True, memify_enabled=True),
        ),
    ), patch(
        "copaw.app.crons.heartbeat.GraphOpsManager.maybe_start_quality_self_drive",
        new=_fake_maybe_start,
    ):
        await run_heartbeat_once(
            runner=runner,
            channel_manager=channel_manager,
            agent_id="agent-1",
            workspace_dir=tmp_path,
        )

    assert orchestration_calls
    assert orchestration_calls[0]["project_id"] == "alpha"
    assert captured_requests
    text = captured_requests[0]["input"][0]["content"][0]["text"]
    assert "Heartbeat orchestration attempts:" in text
    assert "alpha: started (STARTED), job_id=quality-job-auto-1" in text


@pytest.mark.asyncio
async def test_run_heartbeat_once_offloads_quality_digest_to_thread(
    tmp_path,
    monkeypatch,
) -> None:
    heartbeat_file = tmp_path / HEARTBEAT_FILE
    heartbeat_file.write_text("ping", encoding="utf-8")

    heartbeat_config = SimpleNamespace(active_hours=None, target="main")
    runner = SimpleNamespace(stream_query=_stream_events)
    channel_manager = SimpleNamespace(send_event=AsyncMock())
    original_to_thread = asyncio.to_thread
    calls: list[tuple[object, tuple[object, ...]]] = []

    async def fake_to_thread(func, /, *args, **kwargs):
        calls.append((func, args))
        return await original_to_thread(func, *args, **kwargs)

    monkeypatch.setattr("copaw.app.crons.heartbeat.asyncio.to_thread", fake_to_thread)

    with patch(
        "copaw.app.crons.heartbeat.get_heartbeat_config",
        return_value=heartbeat_config,
    ):
        await run_heartbeat_once(
            runner=runner,
            channel_manager=channel_manager,
            agent_id="agent-1",
            workspace_dir=tmp_path,
        )

    assert calls
    assert calls[0][0].__name__ == "_collect_project_quality_loop_digest"