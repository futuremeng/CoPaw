# -*- coding: utf-8 -*-

import pytest

from copaw.knowledge.knowledge_quantization_architecture import QuantizationArchitectureManager


def test_schedule_l2_does_not_require_l1(tmp_path):
    manager = QuantizationArchitectureManager(tmp_path)

    result = manager.schedule_stage_run("l2", "project-source-1", "snapshot-a")

    assert result["stage"] == "l2"
    assert result["status"] == "ready"
    stored = manager.get_stage_result(stage="l2", source_id="project-source-1", snapshot_id="snapshot-a")
    assert stored is not None
    assert stored["status"] == "ready"


def test_schedule_l3_still_requires_l2(tmp_path):
    manager = QuantizationArchitectureManager(tmp_path)

    with pytest.raises(RuntimeError, match="l2 must complete before l3"):
        manager.schedule_stage_run("l3", "project-source-1", "snapshot-a")

    manager.schedule_stage_run("l2", "project-source-1", "snapshot-a")
    result = manager.schedule_stage_run("l3", "project-source-1", "snapshot-a")

    assert result["stage"] == "l3"
    assert result["status"] == "ready"