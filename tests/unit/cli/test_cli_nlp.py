import json
from pathlib import Path

from click.testing import CliRunner

from qwenpaw.cli.nlp_cmd import _grade_l2_assessment, nlp_group


def test_assess_l2_all_projects_without_state_fails_by_default(monkeypatch) -> None:
    monkeypatch.setattr("qwenpaw.cli.nlp_cmd._discover_project_state_files", lambda limit=100: [])

    result = CliRunner().invoke(
        nlp_group,
        ["assess-l2", "--all-projects", "--no-run-probes", "--json"],
    )

    assert result.exit_code != 0
    assert "No project-sync-state.json found under WORKING_DIR/projects." in result.output


def test_assess_l2_all_projects_allow_empty_returns_json(monkeypatch) -> None:
    monkeypatch.setattr("qwenpaw.cli.nlp_cmd._discover_project_state_files", lambda limit=100: [])

    result = CliRunner().invoke(
        nlp_group,
        ["assess-l2", "--all-projects", "--allow-empty", "--no-run-probes", "--json"],
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["mode"] == "all-projects"
    assert payload["items"] == []
    assert payload["risk_label_hits"] == {}


def test_grade_without_probes_is_not_treated_as_probe_failure() -> None:
    scorecard = {
        "coverage": {"l2_core": 1.0},
        "quality_proxy": 1.0,
        "degrade_flags": [],
        "data_warnings": [],
    }
    no_probe_grade = _grade_l2_assessment(
        scorecard,
        None,
        threshold_a=0.85,
        threshold_b=0.7,
        threshold_c=0.5,
    )
    with_probe_zero_grade = _grade_l2_assessment(
        scorecard,
        {"success_ratio": 0.0, "p95_duration_ms": 0, "rows": []},
        threshold_a=0.85,
        threshold_b=0.7,
        threshold_c=0.5,
    )

    assert float(no_probe_grade["score"]) > float(with_probe_zero_grade["score"])
    assert "probe_unstable" not in (no_probe_grade.get("risk_labels") or [])


def test_assess_l2_all_projects_invalid_state_json_is_marked(monkeypatch, tmp_path: Path) -> None:
    broken = tmp_path / "project-sync-state.json"
    broken.write_text("{invalid json", encoding="utf-8")

    monkeypatch.setattr(
        "qwenpaw.cli.nlp_cmd._discover_project_state_files",
        lambda limit=100: [("demo_project", broken)],
    )

    result = CliRunner().invoke(
        nlp_group,
        ["assess-l2", "--all-projects", "--no-run-probes", "--json"],
    )

    assert result.exit_code == 0
    payload = json.loads(result.output)
    assert payload["items"]
    item = payload["items"][0]
    assert item["source"]["status"] == "invalid_state_json"
    assert "state_error" in item
    assert "state_parse_error" in (item["grade"].get("risk_labels") or [])
