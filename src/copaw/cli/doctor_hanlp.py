# -*- coding: utf-8 -*-
"""Copaw's HanLP sidecar self-check, attached to upstream's doctor extensions.

``qwenpaw.cli.doctor_registry`` already runs registered contributions inside a
``=== Doctor extensions ===`` section (manual registration or the
``qwenpaw.doctor`` / legacy ``copaw.doctor`` entry-point groups). Registering
here keeps that Copaw-only check out of the upstream-owned ``doctor_cmd``, so
``qwenpaw doctor`` stays exactly what upstream ships and ``copaw doctor`` gains
the extra notes without a patch.
"""

from __future__ import annotations

import sys
from typing import TYPE_CHECKING

from qwenpaw.cli.doctor_registry import (
    DoctorRunContext,
    register_doctor_contribution,
)

from copaw.knowledge.hanlp_nlp_runtime import NLPRuntime

if TYPE_CHECKING:
    from qwenpaw.config.config import Config

CONTRIBUTION_ID = "copaw.hanlp_sidecar"


def check_hanlp_sidecar(cfg) -> tuple[bool, str, list[str]]:
    runtime = NLPRuntime()
    runtime_cfg = cfg.knowledge.model_copy(deep=True)
    setattr(runtime_cfg, "nlp", cfg.nlp.model_copy(deep=True))
    state = runtime.probe(runtime_cfg)
    status = str(state.get("status") or "unavailable").strip().lower()
    reason_code = str(state.get("reason_code") or "").strip().upper()
    reason = str(state.get("reason") or "HanLP sidecar state is unavailable.").strip()
    notes: list[str] = []

    hanlp_cfg = cfg.nlp
    if not NLPRuntime._sidecar_enabled(hanlp_cfg):
        if sys.version_info[:2] == (3, 10):
            notes.append(
                "Main runtime is Python 3.10. Install directly with: "
                "python -m pip install 'hanlp[full]', then set nlp.sidecar_enabled=true.",
            )
        else:
            notes.append(
                "Enable HanLP sidecar with COPAW_HANLP_SIDECAR_ENABLED=1 and "
                "set COPAW_HANLP_SIDECAR_PYTHON to a Python 3.6-3.10 interpreter.",
            )
    elif not str(hanlp_cfg.python_executable or "").strip():
        notes.append(
            "Set COPAW_HANLP_SIDECAR_PYTHON or nlp.python_executable "
            "to the dedicated Python 3.6-3.10 sidecar interpreter.",
        )
    else:
        notes.append(
            f"Configured sidecar Python: {hanlp_cfg.python_executable}",
        )
    model_home = (
        str(getattr(hanlp_cfg, "model_home", "") or "").strip()
        or str(getattr(hanlp_cfg, "hanlp_home", "") or "").strip()
    )
    if model_home:
        notes.append(f"HANLP_HOME: {model_home}")
    else:
        notes.append(
            "Optional: set COPAW_HANLP_HOME when using preloaded offline model caches.",
        )

    if status == "ready":
        return True, reason, notes
    if reason_code == "HANLP_IMPORT_UNAVAILABLE":
        notes.append(
            "Install HanLP in the sidecar environment, for example: "
            "<sidecar-python> -m pip install 'hanlp[full]'",
        )
    elif reason_code == "HANLP_FULL_INSTALL_REQUIRED":
        notes.append(
            "Install full dependencies in sidecar: <sidecar-python> -m pip install 'hanlp[full]'.",
        )
    elif reason_code == "HANLP_SIDECAR_PYTHON_INCOMPATIBLE":
        notes.append(
            "HanLP 2.x local runtime should use Python 3.6-3.10 according to the upstream install guide.",
        )
    return False, reason, notes


def hanlp_doctor_notes(ctx: DoctorRunContext) -> list[str]:
    """Doctor contribution entry point: one section worth of notes."""
    ok, detail, notes = check_hanlp_sidecar(ctx.cfg)
    header = "HanLP sidecar ready" if ok else f"HanLP sidecar: {detail}"
    return [header, *notes]


def register() -> None:
    """Attach the check to ``qwenpaw doctor`` (called by the copaw CLI entry)."""
    register_doctor_contribution(CONTRIBUTION_ID, hanlp_doctor_notes)
