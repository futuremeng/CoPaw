# -*- coding: utf-8 -*-

from pathlib import Path

from qwenpaw.rpa.workflow import (
    RPA_PACKAGE_KIND,
    RPA_PACKAGE_SCHEMA_VERSION,
    build_ebook_screenshot_template,
    dump_rpa_template_package,
    load_rpa_template_package,
    rpa_template_from_pipeline_template,
    rpa_template_to_pipeline_template,
    write_rpa_template_package,
)


def test_build_ebook_screenshot_template_is_parameterized() -> None:
    template = build_ebook_screenshot_template()

    assert template.id == "ebook-page-screenshot-v1"
    assert template.builtin_kind == "rpa"
    assert template.execution_mode == "deterministic"
    assert [variable.name for variable in template.variables] == [
        "target_url",
        "page_total",
        "page_number_selector",
        "next_button_selector",
        "screenshot_dir",
        "page_prefix",
        "wait_after_flip_ms",
    ]
    capture_step = next(step for step in template.steps if step.id == "capture_pages")
    assert capture_step.kind == "flow.loop"
    assert capture_step.loop is not None
    assert capture_step.loop.actions[0]["kind"] == "browser.screenshot"
    assert capture_step.loop.end == "{{page_total}}"


def test_rpa_template_package_round_trip(tmp_path: Path) -> None:
    template = build_ebook_screenshot_template()
    payload = dump_rpa_template_package(
        template,
        metadata={"author": "copilot", "source": "unit-test"},
    )

    assert payload["schema_version"] == RPA_PACKAGE_SCHEMA_VERSION
    assert payload["kind"] == RPA_PACKAGE_KIND
    assert payload["template"]["id"] == template.id

    package_path = write_rpa_template_package(
        template,
        tmp_path / "ebook-template.json",
        metadata={"author": "copilot"},
    )
    loaded_package = load_rpa_template_package(package_path)

    assert loaded_package.kind == RPA_PACKAGE_KIND
    assert loaded_package.schema_version == RPA_PACKAGE_SCHEMA_VERSION
    assert loaded_package.template.id == template.id
    assert loaded_package.metadata["author"] == "copilot"
    assert loaded_package.template.steps[1].loop is not None


def test_rpa_template_converts_to_pipeline_template() -> None:
    template = build_ebook_screenshot_template()
    pipeline_template = rpa_template_to_pipeline_template(template)
    restored = rpa_template_from_pipeline_template(pipeline_template)

    assert pipeline_template.id == template.id
    assert pipeline_template.builtin_kind == "rpa"
    assert len(pipeline_template.steps) == len(template.steps)
    assert pipeline_template.steps[1].kind == "task"
    assert pipeline_template.steps[1].inputs["__rpa_kind__"] == "flow.loop"
    assert pipeline_template.steps[1].inputs["__rpa_loop__"]["mode"] == "range"
    assert restored.steps[1].loop is not None
    assert restored.steps[1].kind == "flow.loop"
    assert restored.steps[1].loop.iterator == "page_index"