# -*- coding: utf-8 -*-
"""RPA workflow schema and import/export helpers.

This module is intentionally small and framework-agnostic. It defines a
portable RPA template package that can be:

- edited in the Web workbench,
- executed by a future deterministic runtime,
- imported/exported as a single JSON file, and
- converted to and from the existing pipeline template model.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

RPA_PACKAGE_SCHEMA_VERSION = "rpa-template.package.v1"
RPA_PACKAGE_KIND = "rpa"

_PIPELINE_LOOP_INPUT_KEY = "__rpa_loop__"
_PIPELINE_RPA_KIND_INPUT_KEY = "__rpa_kind__"


class RpaVariableSpec(BaseModel):
    """Template variable definition."""

    model_config = ConfigDict(extra="allow")

    name: str
    kind: str = "string"
    description: str = ""
    default: Any = None
    required: bool = False
    example: Any = None


class RpaLoopSpec(BaseModel):
    """Declarative loop configuration for a single RPA step."""

    model_config = ConfigDict(extra="allow")

    mode: Literal["range", "until_last_page", "custom"] = "range"
    iterator: str = "page_index"
    start: int = 1
    end: str = ""
    stop_condition: dict[str, Any] = Field(default_factory=dict)
    actions: list[dict[str, Any]] = Field(default_factory=list)


class RpaStepSpec(BaseModel):
    """RPA step definition used by the template and runtime."""

    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    kind: str
    description: str = ""
    inputs: dict[str, Any] = Field(default_factory=dict)
    outputs: dict[str, Any] = Field(default_factory=dict)
    depends_on: list[str] = Field(default_factory=list)
    input_bindings: dict[str, str] = Field(default_factory=dict)
    retry_policy: dict[str, Any] = Field(default_factory=dict)
    loop: RpaLoopSpec | None = None
    guard: dict[str, Any] = Field(default_factory=dict)


class RpaTemplateSpec(BaseModel):
    """Portable RPA template definition."""

    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    version: str = "0.1.0"
    description: str = ""
    execution_mode: Literal["deterministic", "healing", "manual"] = "deterministic"
    entrypoint: str = "rpa-workbench"
    builtin_kind: str | None = "rpa"
    target_kind: str = "browser"
    tags: list[str] = Field(default_factory=list)
    variables: list[RpaVariableSpec] = Field(default_factory=list)
    steps: list[RpaStepSpec] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


class RpaTemplatePackage(BaseModel):
    """Self-contained JSON package for import/export."""

    model_config = ConfigDict(extra="allow")

    schema_version: str = RPA_PACKAGE_SCHEMA_VERSION
    kind: str = RPA_PACKAGE_KIND
    template: RpaTemplateSpec
    metadata: dict[str, Any] = Field(default_factory=dict)


def _normalize_step_text(value: str) -> str:
    return str(value or "").strip()


def _extract_loop_from_inputs(inputs: dict[str, Any]) -> tuple[dict[str, Any], RpaLoopSpec | None]:
    loop_raw = inputs.get(_PIPELINE_LOOP_INPUT_KEY)
    if isinstance(loop_raw, dict):
        next_inputs = {key: value for key, value in inputs.items() if key != _PIPELINE_LOOP_INPUT_KEY}
        return next_inputs, RpaLoopSpec.model_validate(loop_raw)
    return dict(inputs), None


def _normalize_pipeline_step_kind(rpa_kind: str) -> str:
    # Existing pipeline markdown validation only accepts a fixed enum.
    # RPA runtime-specific kinds are preserved in inputs and projected to "task".
    allowed = {
        "alignment",
        "analysis",
        "ingest",
        "input",
        "output",
        "publish",
        "review",
        "task",
        "transform",
        "validation",
    }
    normalized = str(rpa_kind or "").strip().lower().replace("-", "_")
    if normalized in allowed:
        return normalized
    return "task"


def _embed_loop_in_inputs(inputs: dict[str, Any], loop: RpaLoopSpec | None) -> dict[str, Any]:
    payload = dict(inputs)
    if loop is not None:
        payload[_PIPELINE_LOOP_INPUT_KEY] = loop.model_dump(mode="json", exclude_none=True)
    return payload


def _embed_rpa_kind_in_inputs(inputs: dict[str, Any], kind: str) -> dict[str, Any]:
    payload = dict(inputs)
    payload[_PIPELINE_RPA_KIND_INPUT_KEY] = kind
    return payload


def _extract_rpa_kind_from_inputs(inputs: dict[str, Any], fallback_kind: str) -> tuple[dict[str, Any], str]:
    raw_kind = inputs.get(_PIPELINE_RPA_KIND_INPUT_KEY)
    if isinstance(raw_kind, str) and raw_kind.strip():
        next_inputs = {
            key: value
            for key, value in inputs.items()
            if key != _PIPELINE_RPA_KIND_INPUT_KEY
        }
        return next_inputs, raw_kind.strip()
    return dict(inputs), fallback_kind


def rpa_template_to_pipeline_template(template: RpaTemplateSpec):
    """Convert an RPA template into the existing pipeline template model."""
    from ..app.routers.agents_pipeline_core import PipelineTemplateInfo, PipelineTemplateStep

    return PipelineTemplateInfo(
        id=template.id,
        name=template.name,
        version=template.version,
        description=template.description,
        steps=[
            PipelineTemplateStep(
                id=step.id,
                name=step.name,
                kind=_normalize_pipeline_step_kind(step.kind),
                description=step.description,
                inputs=_embed_loop_in_inputs(
                    _embed_rpa_kind_in_inputs(step.inputs, step.kind),
                    step.loop,
                ),
                script=f"rpa:{step.kind}",
                outputs=step.outputs,
                depends_on=step.depends_on,
                input_bindings=step.input_bindings,
                retry_policy=step.retry_policy,
            )
            for step in template.steps
        ],
        tags=template.tags,
        system_owned=False,
        builtin_kind=template.builtin_kind,
        entrypoint=template.entrypoint,
        compilation_status="ready",
    )


def rpa_template_from_pipeline_template(template) -> RpaTemplateSpec:
    """Convert a pipeline template into an RPA template spec."""
    variables: list[RpaVariableSpec] = []
    steps: list[RpaStepSpec] = []

    for step in template.steps:
        inputs = dict(step.inputs or {})
        normalized_inputs, loop = _extract_loop_from_inputs(inputs)
        normalized_inputs, rpa_kind = _extract_rpa_kind_from_inputs(
            normalized_inputs,
            step.kind,
        )
        steps.append(
            RpaStepSpec(
                id=step.id,
                name=step.name,
                kind=rpa_kind,
                description=step.description,
                inputs=normalized_inputs,
                outputs=dict(step.outputs or {}),
                depends_on=list(step.depends_on or []),
                input_bindings=dict(step.input_bindings or {}),
                retry_policy=dict(step.retry_policy or {}),
                loop=loop,
            ),
        )

    raw_variables = getattr(template, "variables", None)
    if isinstance(raw_variables, list):
        for item in raw_variables:
            if isinstance(item, dict):
                variables.append(RpaVariableSpec.model_validate(item))

    return RpaTemplateSpec(
        id=template.id,
        name=template.name,
        version=template.version or "0.1.0",
        description=template.description,
        tags=list(template.tags or []),
        variables=variables,
        steps=steps,
        builtin_kind=template.builtin_kind or "rpa",
        entrypoint=template.entrypoint or "rpa-workbench",
    )


def build_ebook_screenshot_template(
    template_id: str = "ebook-page-screenshot-v1",
    *,
    name: str = "Electronic Magazine Page Screenshot",
    description: str = "Capture every page of a flipbook or e-magazine as individual screenshots.",
) -> RpaTemplateSpec:
    """Build a ready-to-edit template for the magazine page capture use case."""
    variables = [
        RpaVariableSpec(
            name="target_url",
            kind="string",
            description="The flipbook or magazine entry URL.",
            required=True,
            example="https://book.yunzhan365.com/vuwl/fztp/mobile/index.html",
        ),
        RpaVariableSpec(
            name="page_total",
            kind="integer",
            description="Total page count to capture.",
            required=True,
            example=144,
        ),
        RpaVariableSpec(
            name="page_number_selector",
            kind="string",
            description="Selector for the current page number indicator.",
            required=True,
            example=".page-number",
        ),
        RpaVariableSpec(
            name="next_button_selector",
            kind="string",
            description="Selector for the next-page control.",
            required=True,
            example="[data-role='next']",
        ),
        RpaVariableSpec(
            name="screenshot_dir",
            kind="string",
            description="Output directory for captured page screenshots.",
            default="browser/rpa/ebook",
            required=False,
            example="browser/rpa/ebook",
        ),
        RpaVariableSpec(
            name="page_prefix",
            kind="string",
            description="Prefix used when naming screenshots.",
            default="page",
            required=False,
            example="page",
        ),
        RpaVariableSpec(
            name="wait_after_flip_ms",
            kind="integer",
            description="Delay after clicking next before checking the next page.",
            default=250,
            required=False,
            example=250,
        ),
    ]

    loop = RpaLoopSpec(
        mode="range",
        iterator="page_index",
        start=1,
        end="{{page_total}}",
        stop_condition={
            "type": "page_number_reached",
            "selector": "{{page_number_selector}}",
            "expected_value": "{{page_index}}",
        },
        actions=[
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
                "text_gone": "{{page_number_selector}}",
            },
        ],
    )

    steps = [
        RpaStepSpec(
            id="open_book",
            name="Open Book",
            kind="browser.open",
            description="Open the magazine entry page.",
            inputs={
                "url": "{{target_url}}",
            },
            outputs={
                "page_id": "default",
            },
        ),
        RpaStepSpec(
            id="capture_pages",
            name="Capture Pages",
            kind="flow.loop",
            description="Capture every page as a screenshot while stepping through the book.",
            inputs={
                "page_number_selector": "{{page_number_selector}}",
                "next_button_selector": "{{next_button_selector}}",
                "screenshot_dir": "{{screenshot_dir}}",
                "page_prefix": "{{page_prefix}}",
                "wait_after_flip_ms": "{{wait_after_flip_ms}}",
            },
            outputs={
                "screenshots_dir": "{{screenshot_dir}}",
            },
            depends_on=["open_book"],
            loop=loop,
        ),
        RpaStepSpec(
            id="close_book",
            name="Close Book",
            kind="browser.close",
            description="Close the browser page after capture is complete.",
            depends_on=["capture_pages"],
        ),
    ]

    return RpaTemplateSpec(
        id=template_id,
        name=name,
        version="0.1.0",
        description=description,
        execution_mode="deterministic",
        entrypoint="rpa-workbench",
        builtin_kind="rpa",
        target_kind="browser",
        tags=["browser", "capture", "ebook", "magazine"],
        variables=variables,
        steps=steps,
        notes=[
            "The loop step is intentionally declarative so the runtime can decide how to wait for page transitions.",
            "Selectors are kept as variables so the same template can be reused across same-structure magazines.",
        ],
    )


def dump_rpa_template_package(
    template: RpaTemplateSpec,
    *,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a JSON-serializable package for *template*."""
    package = RpaTemplatePackage(
        template=template,
        metadata=dict(metadata or {}),
    )
    return package.model_dump(mode="json", exclude_none=True)


def write_rpa_template_package(
    template: RpaTemplateSpec,
    destination: str | Path,
    *,
    metadata: dict[str, Any] | None = None,
) -> Path:
    """Write *template* to *destination* as JSON and return the path."""
    output_path = Path(destination).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    payload = dump_rpa_template_package(template, metadata=metadata)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return output_path


def load_rpa_template_package(source: str | Path | dict[str, Any] | RpaTemplatePackage) -> RpaTemplatePackage:
    """Load a template package from a dict, JSON string, or file path."""
    if isinstance(source, RpaTemplatePackage):
        return source

    raw: Any
    if isinstance(source, dict):
        raw = source
    else:
        candidate = Path(str(source)).expanduser()
        if candidate.exists() and candidate.is_file():
            raw = json.loads(candidate.read_text(encoding="utf-8"))
        else:
            raw = json.loads(str(source))

    package = RpaTemplatePackage.model_validate(raw)
    return package