# -*- coding: utf-8 -*-
from __future__ import annotations

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