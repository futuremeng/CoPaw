# -*- coding: utf-8 -*-
from __future__ import annotations

import pytest

from qwenpaw.app.crons.manager import CronManager
from qwenpaw.app.crons.models import (
    CronJobRequest,
    CronJobSpec,
    DispatchSpec,
    DispatchTarget,
    JobsFile,
    ScheduleSpec,
)
from qwenpaw.app.crons.repo.base import BaseJobRepository


class _InMemoryRepo(BaseJobRepository):
    def __init__(self, jobs_file: JobsFile):
        self._jobs_file = jobs_file
        self._history = {}

    async def load(self) -> JobsFile:
        return self._jobs_file

    async def save(self, jobs_file: JobsFile) -> None:
        self._jobs_file = jobs_file

    async def get_history(self, job_id: str):
        return self._history.get(job_id, [])

    async def append_history(self, job_id: str, record, *, limit: int = 50):
        records = list(self._history.get(job_id, []))
        records.insert(0, record)
        del records[limit:]
        self._history[job_id] = records
        return records

    async def delete_history(self, job_id: str) -> None:
        self._history.pop(job_id, None)

    async def prune_orphan_history(self, valid_job_ids: set[str]) -> None:
        self._history = {
            job_id: records
            for job_id, records in self._history.items()
            if job_id in valid_job_ids
        }


@pytest.mark.asyncio
async def test_start_skips_invalid_cron_and_keeps_valid_job() -> None:
    valid_job = CronJobSpec(
        id="job-valid",
        name="valid",
        schedule=ScheduleSpec(cron="*/5 * * * *", timezone="UTC"),
        task_type="agent",
        request=CronJobRequest(input="ping"),
        dispatch=DispatchSpec(
            channel="console",
            target=DispatchTarget(user_id="u1", session_id="s1"),
        ),
    )
    # 5 fields but invalid for APScheduler hour field (step > 23).
    invalid_job = CronJobSpec(
        id="job-invalid",
        name="invalid",
        schedule=ScheduleSpec(cron="0 */30 * * *", timezone="UTC"),
        task_type="agent",
        request=CronJobRequest(input="ping"),
        dispatch=DispatchSpec(
            channel="console",
            target=DispatchTarget(user_id="u2", session_id="s2"),
        ),
    )

    repo = _InMemoryRepo(JobsFile(jobs=[valid_job, invalid_job]))
    manager = CronManager(repo=repo, runner=None, channel_manager=None)

    await manager.start()
    try:
        state_valid = manager.get_state("job-valid")
        state_invalid = manager.get_state("job-invalid")

        assert state_valid.next_run_at is not None
        assert state_valid.last_status is None

        assert state_invalid.next_run_at is None
        # Current behavior: invalid job is skipped and auto-disabled,
        # but state fields remain unset.
        assert state_invalid.last_status is None
        assert state_invalid.last_error is None

        # Current behavior: startup keeps running and auto-disables
        # invalid jobs persisted in storage.
        saved_jobs = await repo.list_jobs()
        invalid_saved = next(
            (job for job in saved_jobs if job.id == "job-invalid"),
            None,
        )
        assert invalid_saved is not None
        assert invalid_saved.enabled is False
    finally:
        await manager.stop()


@pytest.mark.asyncio
async def test_create_or_replace_raises_on_invalid_cron() -> None:
    """Current behavior: invalid cron is persisted, then scheduler raises."""
    repo = _InMemoryRepo(JobsFile(jobs=[]))
    manager = CronManager(repo=repo, runner=None, channel_manager=None)
    await manager.start()
    try:
        invalid = CronJobSpec(
            id="job-bad",
            name="bad-cron",
            schedule=ScheduleSpec(cron="0 */30 * * *", timezone="UTC"),
            task_type="agent",
            request=CronJobRequest(input="ping"),
            dispatch=DispatchSpec(
                channel="console",
                target=DispatchTarget(user_id="u1", session_id="s1"),
            ),
        )
        with pytest.raises(ValueError):
            await manager.create_or_replace_job(invalid)

        # Current behavior: persistence happens before scheduler validation.
        saved = await repo.list_jobs()
        assert len(saved) == 1
        assert saved[0].id == "job-bad"
    finally:
        await manager.stop()


@pytest.mark.asyncio
async def test_create_or_replace_raises_without_started() -> None:
    """Current behavior: invalid cron persists when manager is not started."""
    repo = _InMemoryRepo(JobsFile(jobs=[]))
    manager = CronManager(repo=repo, runner=None, channel_manager=None)
    # Do NOT call start()
    invalid = CronJobSpec(
        id="job-bad2",
        name="bad-cron-2",
        schedule=ScheduleSpec(cron="0 */30 * * *", timezone="UTC"),
        task_type="agent",
        request=CronJobRequest(input="ping"),
        dispatch=DispatchSpec(
            channel="console",
            target=DispatchTarget(user_id="u1", session_id="s1"),
        ),
    )
    await manager.create_or_replace_job(invalid)

    saved = await repo.list_jobs()
    assert len(saved) == 1
    assert saved[0].id == "job-bad2"
