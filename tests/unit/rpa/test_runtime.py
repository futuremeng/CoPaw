# -*- coding: utf-8 -*-

from pathlib import Path

from qwenpaw.rpa.runtime import execute_rpa_script_step


def test_execute_rpa_script_step_open_action(monkeypatch):
    calls: list[tuple[str, dict]] = []

    def _fake_invoke(action: str, **kwargs):
        calls.append((action, kwargs))
        return {"ok": True}

    monkeypatch.setattr("qwenpaw.rpa.runtime.invoke_browser_use", _fake_invoke)

    outputs, metrics, evidence = execute_rpa_script_step(
        project_dir=Path("/tmp"),
        step_id="open_book",
        script="rpa:browser.open",
        inputs={"url": "https://example.com"},
        parameters={},
    )

    assert outputs == []
    assert metrics["rpa_kind"] == "browser.open"
    assert metrics["rpa_actions_executed"] == 1
    assert calls[0][0] == "open"
    assert calls[0][1]["url"] == "https://example.com"
    assert evidence and evidence[0].startswith("browser.open")
    assert metrics["rpa_action_duration_ms_total"] >= 0
    assert metrics["rpa_action_count_by_kind"]["browser.open"] == 1


def test_execute_rpa_script_step_loop_actions(monkeypatch, tmp_path: Path):
    calls: list[tuple[str, dict]] = []

    def _fake_invoke(action: str, **kwargs):
        calls.append((action, kwargs))
        if action == "screenshot":
            screenshot_path = Path(str(kwargs["path"]))
            screenshot_path.parent.mkdir(parents=True, exist_ok=True)
            screenshot_path.write_text("fake image", encoding="utf-8")
        return {"ok": True}

    monkeypatch.setattr("qwenpaw.rpa.runtime.invoke_browser_use", _fake_invoke)

    outputs, metrics, _ = execute_rpa_script_step(
        project_dir=tmp_path,
        step_id="capture_pages",
        script="rpa:flow.loop",
        inputs={
            "screenshot_dir": "browser/rpa/ebook",
            "page_prefix": "page",
            "wait_after_flip_ms": 200,
            "next_button_selector": ".next",
            "__rpa_loop__": {
                "mode": "range",
                "iterator": "page_index",
                "start": 1,
                "end": "{{page_total}}",
                "actions": [
                    {
                        "kind": "browser.screenshot",
                        "path": "{{screenshot_dir}}/{{page_prefix}}-{{page_index:03d}}.png",
                        "full_page": True,
                    },
                    {
                        "kind": "browser.click",
                        "selector": "{{next_button_selector}}",
                    },
                    {
                        "kind": "browser.wait",
                        "wait_time_ms": "{{wait_after_flip_ms}}",
                    },
                ],
            },
        },
        parameters={"page_total": 2},
    )

    assert len(outputs) == 2
    assert outputs[0].endswith("page-001.png")
    assert outputs[1].endswith("page-002.png")
    assert metrics["rpa_loop_iterations"] == 2
    assert metrics["rpa_actions_executed"] == 6
    assert metrics["rpa_action_count_by_kind"]["browser.screenshot"] == 2
    assert metrics["rpa_action_count_by_kind"]["browser.click"] == 2
    assert metrics["rpa_action_count_by_kind"]["browser.wait"] == 2
    assert metrics["rpa_action_duration_ms_total"] >= 0
    action_names = [item[0] for item in calls]
    assert action_names.count("screenshot") == 2
    assert action_names.count("click") == 2
    assert action_names.count("wait_for") == 2


def test_execute_rpa_script_step_loop_stop_condition_page_number_reached(monkeypatch, tmp_path: Path):
    calls: list[tuple[str, dict]] = []

    def _fake_invoke(action: str, **kwargs):
        calls.append((action, kwargs))
        if action == "run_code":
            code = str(kwargs.get("code") or "")
            if "querySelector" in code:
                return {"ok": True, "result": "2/10"}
        if action == "screenshot":
            screenshot_path = Path(str(kwargs["path"]))
            screenshot_path.parent.mkdir(parents=True, exist_ok=True)
            screenshot_path.write_text("fake image", encoding="utf-8")
        return {"ok": True}

    monkeypatch.setattr("qwenpaw.rpa.runtime.invoke_browser_use", _fake_invoke)

    outputs, metrics, evidence = execute_rpa_script_step(
        project_dir=tmp_path,
        step_id="capture_pages",
        script="rpa:flow.loop",
        inputs={
            "screenshot_dir": "browser/rpa/ebook",
            "page_prefix": "page",
            "page_number_selector": ".page-number",
            "__rpa_loop__": {
                "mode": "range",
                "iterator": "page_index",
                "start": 2,
                "end": 2,
                "stop_condition": {
                    "type": "page_number_reached",
                    "selector": "{{page_number_selector}}",
                    "expected_value": "{{page_index}}",
                },
                "actions": [
                    {
                        "kind": "browser.screenshot",
                        "path": "{{screenshot_dir}}/{{page_prefix}}-{{page_index:03d}}.png",
                    }
                ],
            },
        },
        parameters={},
    )

    assert len(outputs) == 1
    assert outputs[0].endswith("page-002.png")
    assert metrics["rpa_stop_condition_checks"] == 1
    assert any(item[0] == "run_code" for item in calls)
    assert evidence


def test_execute_rpa_script_step_loop_max_iterations(monkeypatch, tmp_path: Path):
    calls: list[tuple[str, dict]] = []

    def _fake_invoke(action: str, **kwargs):
        calls.append((action, kwargs))
        if action == "screenshot":
            screenshot_path = Path(str(kwargs["path"]))
            screenshot_path.parent.mkdir(parents=True, exist_ok=True)
            screenshot_path.write_text("fake image", encoding="utf-8")
        return {"ok": True}

    monkeypatch.setattr("qwenpaw.rpa.runtime.invoke_browser_use", _fake_invoke)

    outputs, metrics, evidence = execute_rpa_script_step(
        project_dir=tmp_path,
        step_id="capture_pages",
        script="rpa:flow.loop",
        inputs={
            "screenshot_dir": "browser/rpa/ebook",
            "page_prefix": "page",
            "__rpa_loop__": {
                "mode": "range",
                "iterator": "page_index",
                "start": 1,
                "end": 5,
                "stop_condition": {
                    "max_iterations": 2,
                },
                "actions": [
                    {
                        "kind": "browser.screenshot",
                        "path": "{{screenshot_dir}}/{{page_prefix}}-{{page_index:03d}}.png",
                    }
                ],
            },
        },
        parameters={},
    )

    assert len(outputs) == 2
    assert metrics["rpa_loop_iterations"] == 2
    assert metrics["rpa_actions_executed"] == 2
    assert any("max_iterations" in item for item in evidence)


def test_execute_rpa_script_step_loop_stop_condition_continue_policy(monkeypatch, tmp_path: Path):
    calls: list[tuple[str, dict]] = []

    def _fake_invoke(action: str, **kwargs):
        calls.append((action, kwargs))
        if action == "run_code":
            return {"ok": True, "result": "1/10"}
        if action == "screenshot":
            screenshot_path = Path(str(kwargs["path"]))
            screenshot_path.parent.mkdir(parents=True, exist_ok=True)
            screenshot_path.write_text("fake image", encoding="utf-8")
        return {"ok": True}

    monkeypatch.setattr("qwenpaw.rpa.runtime.invoke_browser_use", _fake_invoke)

    outputs, metrics, evidence = execute_rpa_script_step(
        project_dir=tmp_path,
        step_id="capture_pages",
        script="rpa:flow.loop",
        inputs={
            "screenshot_dir": "browser/rpa/ebook",
            "page_prefix": "page",
            "page_number_selector": ".page-number",
            "__rpa_loop__": {
                "mode": "range",
                "iterator": "page_index",
                "start": 1,
                "end": 2,
                "stop_condition": {
                    "type": "page_number_reached",
                    "selector": "{{page_number_selector}}",
                    "expected_value": "{{page_index}}",
                    "on_failure": "continue",
                },
                "actions": [
                    {
                        "kind": "browser.screenshot",
                        "path": "{{screenshot_dir}}/{{page_prefix}}-{{page_index:03d}}.png",
                    }
                ],
            },
        },
        parameters={},
    )

    assert len(outputs) == 2
    assert metrics["rpa_stop_condition_checks"] == 2
    assert metrics["rpa_stop_condition_failures"] == 1
    assert any("stop_condition_failed:continue" in item for item in evidence)
