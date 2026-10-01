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

# doctor_hanlp branches its "how to enable" note on the interpreter version, so
# the test accepts either wording instead of pinning the suite to Python 3.10.
ENABLE_HINTS = ("nlp.sidecar_enabled=true", "COPAW_HANLP_SIDECAR_ENABLED")


def _has_enable_hint(lines) -> bool:
    return any(hint in line for line in lines for hint in ENABLE_HINTS)


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
    assert _has_enable_hint(notes)


def test_hanlp_doctor_notes_render_as_contribution_lines() -> None:
    lines = hanlp_doctor_notes(_ctx())

    assert lines[0].startswith("HanLP sidecar:")
    assert _has_enable_hint(lines[1:])


def test_register_attaches_to_upstream_doctor_extensions() -> None:
    reset_doctor_registry_state()
    try:
        register()
        results = dict(run_extension_contributions(_ctx()))
    finally:
        reset_doctor_registry_state()

    assert CONTRIBUTION_ID in results
    assert results[CONTRIBUTION_ID]
