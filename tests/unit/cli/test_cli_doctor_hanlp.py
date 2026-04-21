# -*- coding: utf-8 -*-

from qwenpaw.config.config import Config
from qwenpaw.cli.doctor_cmd import _check_hanlp_sidecar


def test_check_hanlp_sidecar_reports_unconfigured_note() -> None:
    ok, detail, notes = _check_hanlp_sidecar(Config())

    assert ok is False
    assert "not configured" in detail.lower()
    assert any("COPAW_HANLP_SIDECAR_ENABLED=1" in line for line in notes)