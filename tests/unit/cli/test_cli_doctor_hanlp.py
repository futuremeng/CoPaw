# -*- coding: utf-8 -*-

from qwenpaw.cli.doctor_registry import (
    DoctorRunContext,
    reset_doctor_registry_state,
    run_extension_contributions,
)
from qwenpaw.config.config import Config

from copaw.cli.doctor_hanlp import (
    CONTRIBUTION_ID,
    check_hanlp_sidecar,
    hanlp_doctor_notes,
    register,
)


def _ctx() -> DoctorRunContext:
    return DoctorRunContext(
        cfg=Config(),
        raw_cfg=None,
        cli_base_url="http://127.0.0.1:1",
        timeout=1.0,
        deep=False,
    )


def test_check_hanlp_sidecar_reports_unconfigured_note() -> None:
    ok, detail, notes = check_hanlp_sidecar(Config())

    assert ok is False
    assert "not configured" in detail.lower()
    assert any("nlp.sidecar_enabled=true" in line for line in notes)


def test_hanlp_doctor_notes_render_as_contribution_lines() -> None:
    lines = hanlp_doctor_notes(_ctx())

    assert lines[0].startswith("HanLP sidecar:")
    assert any("nlp.sidecar_enabled=true" in line for line in lines[1:])


def test_register_attaches_to_upstream_doctor_extensions() -> None:
    reset_doctor_registry_state()
    try:
        register()
        results = dict(run_extension_contributions(_ctx()))
    finally:
        reset_doctor_registry_state()

    assert CONTRIBUTION_ID in results
    assert results[CONTRIBUTION_ID]
