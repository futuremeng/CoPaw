# -*- coding: utf-8 -*-

from pathlib import Path
from typing import cast

from copaw.config.config import Config, KnowledgeSourceSpec
from copaw.knowledge.project_sync_manager import (
    ProjectKnowledgeSyncManager,
    ProjectSyncCommand,
    ProjectSyncCoordinator,
)


class _FakeSyncManager:
    def __init__(self) -> None:
        self.start_calls: list[dict] = []
        self.resume_calls: list[dict] = []
        self.check_calls: list[dict] = []

    def start_sync(self, **kwargs):
        self.start_calls.append(kwargs)
        return {
            "accepted": True,
            "reason": "STARTED",
            "state": {
                "project_id": kwargs["project_id"],
                "status": "queued",
            },
        }

    def resume_sync_if_needed(self, **kwargs):
        self.resume_calls.append(kwargs)
        return {
            "accepted": False,
            "reason": "NOOP",
        }

    def check_needs_reindex(self, **kwargs):
        self.check_calls.append(kwargs)
        return False


def _source(project_id: str, project_dir: Path) -> KnowledgeSourceSpec:
    return KnowledgeSourceSpec(
        id=f"project-{project_id}-workspace",
        name=f"Project Workspace: {project_id}",
        type="directory",
        location=str(project_dir),
        content="",
        enabled=True,
        recursive=True,
        project_id=project_id,
        tags=["project"],
        summary="test source",
    )


def test_project_sync_command_generates_stable_operation_id_without_manual_key(tmp_path: Path):
    project_id = "project-op-stable"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    cfg = Config().knowledge

    source = _source(project_id, project_dir)
    cmd_a = ProjectSyncCommand.start(
        project_id=project_id,
        config=cfg,
        running_config=None,
        source=source,
        trigger="manual",
        changed_paths=["original/a.md", "original/b.md"],
        auto_enabled=True,
        force=False,
    )
    cmd_b = ProjectSyncCommand.start(
        project_id=project_id,
        config=cfg,
        running_config=None,
        source=source,
        trigger="manual",
        changed_paths=["original/b.md", "original/a.md"],
        auto_enabled=True,
        force=False,
    )

    assert cmd_a.idempotency_key == cmd_b.idempotency_key
    assert cmd_a.operation_id == cmd_b.operation_id
    assert cmd_a.operation_id.startswith("ps-")


def test_project_sync_command_respects_manual_idempotency_key(tmp_path: Path):
    project_id = "project-op-manual"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    cfg = Config().knowledge

    source = _source(project_id, project_dir)
    cmd = ProjectSyncCommand.start(
        project_id=project_id,
        config=cfg,
        running_config=None,
        source=source,
        trigger="manual",
        changed_paths=["note.md"],
        auto_enabled=True,
        force=False,
        idempotency_key="manual-key-123",
    )

    assert cmd.idempotency_key == "manual-key-123"
    assert cmd.operation_id.startswith("ps-")


def test_project_sync_command_tracks_quantization_stage(tmp_path: Path):
    project_id = "project-op-stage"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    cfg = Config().knowledge

    source = _source(project_id, project_dir)
    cmd_l1 = ProjectSyncCommand.start(
        project_id=project_id,
        config=cfg,
        running_config=None,
        source=source,
        trigger="manual",
        changed_paths=["note.md"],
        auto_enabled=True,
        force=False,
        quantization_stage="l1",
    )
    cmd_l2 = ProjectSyncCommand.start(
        project_id=project_id,
        config=cfg,
        running_config=None,
        source=source,
        trigger="manual",
        changed_paths=["note.md"],
        auto_enabled=True,
        force=False,
        quantization_stage="l2",
    )

    assert cmd_l1.quantization_stage == "l1"
    assert cmd_l2.quantization_stage == "l2"
    assert cmd_l1.idempotency_key != cmd_l2.idempotency_key


def test_project_sync_coordinator_start_dispatch_injects_operation_metadata(tmp_path: Path):
    project_id = "project-coordinator-start"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    cfg = Config().knowledge

    manager = _FakeSyncManager()
    coordinator = ProjectSyncCoordinator(
        tmp_path,
        manager_factory=lambda _pid: cast(ProjectKnowledgeSyncManager, manager),
    )

    event = coordinator.dispatch(
        ProjectSyncCommand.start(
            project_id=project_id,
            config=cfg,
            running_config=None,
            source=_source(project_id, project_dir),
            trigger="manual",
            changed_paths=["doc.md"],
            auto_enabled=True,
            force=False,
            idempotency_key="manual-key-start",
        )
    )

    assert event.accepted is True
    assert event.reason == "STARTED"
    assert event.idempotency_key == "manual-key-start"
    assert event.operation_id.startswith("ps-")
    assert event.payload["operation_id"] == event.operation_id
    assert event.payload["idempotency_key"] == "manual-key-start"
    assert event.payload["deduplicated"] is False
    assert len(manager.start_calls) == 1


def test_project_sync_coordinator_resume_dispatch_marks_deduplicated(tmp_path: Path):
    project_id = "project-coordinator-resume"
    project_dir = tmp_path / "projects" / project_id
    project_dir.mkdir(parents=True, exist_ok=True)
    cfg = Config().knowledge

    manager = _FakeSyncManager()
    coordinator = ProjectSyncCoordinator(
        tmp_path,
        manager_factory=lambda _pid: cast(ProjectKnowledgeSyncManager, manager),
    )

    event = coordinator.dispatch(
        ProjectSyncCommand.resume(
            project_id=project_id,
            config=cfg,
            running_config=None,
            source=_source(project_id, project_dir),
            idempotency_key="resume-key-1",
        )
    )

    assert event.accepted is False
    assert event.reason == "NOOP"
    assert event.deduplicated is True
    assert event.payload["idempotency_key"] == "resume-key-1"
    assert event.payload["operation_id"] == event.operation_id
    assert len(manager.resume_calls) == 1


def test_project_sync_coordinator_check_reindex_false_marks_noop_dedup(tmp_path: Path):
    project_id = "project-coordinator-check"
    cfg = Config().knowledge

    manager = _FakeSyncManager()
    coordinator = ProjectSyncCoordinator(
        tmp_path,
        manager_factory=lambda _pid: cast(ProjectKnowledgeSyncManager, manager),
    )

    event = coordinator.dispatch(
        ProjectSyncCommand.check_reindex(
            project_id=project_id,
            config=cfg,
            running_config=None,
            idempotency_key="check-key-1",
        )
    )

    assert event.accepted is False
    assert event.reason == "NOOP"
    assert event.deduplicated is True
    assert event.idempotency_key == "check-key-1"
    assert event.payload is False
    assert len(manager.check_calls) == 1


def test_build_global_metrics_prefers_l1_metrics_values_for_sources(tmp_path: Path):
    manager = ProjectKnowledgeSyncManager(tmp_path)

    payload = manager._build_global_metrics(
        {
            "project_id": "project-1",
            "latest_source_id": "source-1",
            "updated_at": "2026-05-06T10:00:00+00:00",
            "last_result": {
                "index": {
                    "document_count": 9,
                    "chunk_count": 10,
                    "sentence_count": 11,
                },
            },
        },
        mode_metrics={},
        source_status={
            "raw_document_count": 3,
            "document_count": 3,
            "snapshot_count": 3,
            "chunk_count": 7,
            "sentence_count": 12,
            "char_count": 20,
            "token_count": 5,
            "stats_updated_at": "2026-05-06T10:00:01+00:00",
        },
    )

    assert payload["document_count"] == 3
    assert payload["snapshot_count"] == 3
    assert payload["chunk_count"] == 7
    assert payload["sentence_count"] == 12
