# -*- coding: utf-8 -*-
"""Deterministic RPA runtime for pipeline steps with ``rpa:`` scripts."""

from __future__ import annotations

import asyncio
import json
import re
import time
from pathlib import Path
from threading import Thread
from typing import Any


_PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)(?::([^}]+))?\s*\}\}")


def _extract_text_from_tool_response(resp: Any) -> str:
    content = getattr(resp, "content", None)
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            text = getattr(block, "text", None)
            if isinstance(text, str) and text.strip():
                parts.append(text)
        if parts:
            return "\n".join(parts)
    return str(resp)


def _run_async(coro: Any) -> Any:
    try:
        loop = asyncio.get_running_loop()
        if loop.is_running():
            box: dict[str, Any] = {}

            def _runner() -> None:
                try:
                    box["result"] = asyncio.run(coro)
                except Exception as exc:  # pragma: no cover - defensive
                    box["error"] = exc

            thread = Thread(target=_runner, daemon=True)
            thread.start()
            thread.join()
            if "error" in box:
                raise box["error"]
            return box.get("result")
    except RuntimeError:
        pass
    return asyncio.run(coro)


def invoke_browser_use(action: str, **kwargs: Any) -> dict[str, Any]:
    """Invoke browser_use and return parsed JSON response."""
    from ..agents.tools.browser_control import browser_use

    response = _run_async(browser_use(action=action, **kwargs))
    raw = _extract_text_from_tool_response(response).strip()
    if not raw:
        return {"ok": False, "error": "empty browser response"}
    try:
        payload = json.loads(raw)
        if isinstance(payload, dict):
            return payload
    except Exception:
        pass
    return {"ok": False, "error": raw}


def _render_template(value: Any, context: dict[str, Any]) -> Any:
    if not isinstance(value, str):
        return value

    def _replace(match: re.Match[str]) -> str:
        key = match.group(1)
        fmt = match.group(2)
        raw = context.get(key, "")
        if fmt:
            try:
                return format(raw, fmt)
            except Exception:
                return str(raw)
        return str(raw)

    return _PLACEHOLDER_RE.sub(_replace, value)


def _normalize_path(project_dir: Path, path_value: str) -> tuple[Path, str]:
    candidate = Path(path_value).expanduser()
    if candidate.is_absolute():
        abs_path = candidate
    else:
        abs_path = (project_dir / candidate).resolve()

    rel_path: str
    try:
        rel_path = str(abs_path.relative_to(project_dir.resolve()))
    except Exception:
        rel_path = str(abs_path)
    return abs_path, rel_path


def _to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _extract_first_int(text: str) -> int | None:
    match = re.search(r"\d+", text)
    if not match:
        return None
    try:
        return int(match.group(0))
    except Exception:
        return None


def _execute_rpa_action(
    *,
    project_dir: Path,
    kind: str,
    payload: dict[str, Any],
    context: dict[str, Any],
    outputs: list[str],
    evidence: list[str],
) -> tuple[str, float]:
    action_kind = str(_render_template(kind, context) or "").strip().lower()
    rendered = {
        str(key): _render_template(value, context)
        for key, value in (payload or {}).items()
    }

    started = time.perf_counter()
    if action_kind == "browser.open":
        result = invoke_browser_use(
            "open",
            url=str(rendered.get("url") or rendered.get("target_url") or ""),
            page_id=str(rendered.get("page_id") or "default"),
        )
    elif action_kind == "browser.click":
        result = invoke_browser_use(
            "click",
            page_id=str(rendered.get("page_id") or "default"),
            selector=str(rendered.get("selector") or ""),
            ref=str(rendered.get("ref") or ""),
        )
    elif action_kind == "browser.wait":
        wait_seconds = float(_to_int(rendered.get("wait_time_ms"), default=0)) / 1000.0
        result = invoke_browser_use(
            "wait_for",
            page_id=str(rendered.get("page_id") or "default"),
            wait_time=wait_seconds,
            text=str(rendered.get("text") or ""),
            text_gone=str(rendered.get("text_gone") or ""),
        )
    elif action_kind == "browser.screenshot":
        path_value = str(rendered.get("path") or "").strip()
        if not path_value:
            raise ValueError("browser.screenshot requires path")
        abs_path, rel_path = _normalize_path(project_dir, path_value)
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        result = invoke_browser_use(
            "screenshot",
            page_id=str(rendered.get("page_id") or "default"),
            path=str(abs_path),
            full_page=bool(rendered.get("full_page", False)),
        )
        if result.get("ok"):
            outputs.append(rel_path)
    elif action_kind == "browser.close":
        result = invoke_browser_use(
            "close",
            page_id=str(rendered.get("page_id") or "default"),
        )
    else:
        raise ValueError(f"Unsupported RPA action kind: {action_kind}")

    if not result.get("ok", False):
        raise RuntimeError(str(result.get("error") or f"RPA action failed: {action_kind}"))
    duration_ms = max((time.perf_counter() - started) * 1000.0, 0.0)
    if action_kind == "browser.screenshot" and outputs:
        evidence.append(f"{action_kind}:ok:{outputs[-1]}:{duration_ms:.1f}ms")
    else:
        evidence.append(f"{action_kind}:ok:{duration_ms:.1f}ms")
    return action_kind, duration_ms


def _check_loop_stop_condition(
    *,
    stop_condition: dict[str, Any],
    context: dict[str, Any],
) -> tuple[bool, str]:
    if not isinstance(stop_condition, dict) or not stop_condition:
        return True, ""

    condition_type = str(_render_template(stop_condition.get("type") or "", context)).strip().lower()
    if not condition_type:
        return True, ""

    if condition_type == "page_number_reached":
        selector = str(_render_template(stop_condition.get("selector") or "", context)).strip()
        expected_value = str(_render_template(stop_condition.get("expected_value") or "", context)).strip()
        page_id = str(_render_template(stop_condition.get("page_id") or "default", context)).strip() or "default"
        if not selector or not expected_value:
            return False, "page_number_reached requires selector and expected_value"

        code = (
            "() => {"
            f"const el = document.querySelector({json.dumps(selector)});"
            "return el ? String(el.textContent || '').trim() : '';"
            "}"
        )
        result = invoke_browser_use("run_code", page_id=page_id, code=code)
        if not result.get("ok", False):
            return False, str(result.get("error") or "failed to evaluate page number selector")

        actual_value = str(result.get("result") or "").strip()
        expected_num = _extract_first_int(expected_value)
        actual_num = _extract_first_int(actual_value)
        if expected_num is not None and actual_num is not None:
            return (actual_num == expected_num, f"expected={expected_num}, actual={actual_num}")
        return (actual_value == expected_value, f"expected='{expected_value}', actual='{actual_value}'")

    return True, f"unsupported_stop_condition:{condition_type}:ignored"


def execute_rpa_script_step(
    *,
    project_dir: Path,
    step_id: str,
    script: str,
    inputs: dict[str, Any],
    parameters: dict[str, Any],
) -> tuple[list[str], dict[str, Any], list[str]]:
    """Execute a single ``rpa:`` script step.

    Returns ``(outputs, metrics, evidence)``.
    """
    script_value = str(script or "").strip().lower()
    if not script_value.startswith("rpa:"):
        raise ValueError("script is not an rpa protocol script")

    rpa_kind = script_value[4:].strip()
    context: dict[str, Any] = {
        **(parameters or {}),
        **(inputs or {}),
        "step_id": step_id,
    }
    outputs: list[str] = []
    evidence: list[str] = []
    action_count = 0
    loop_iterations = 0
    action_duration_total_ms = 0.0
    action_duration_by_kind: dict[str, float] = {}
    action_count_by_kind: dict[str, int] = {}
    stop_checks = 0
    stop_failures = 0

    if rpa_kind == "flow.loop":
        loop_raw = inputs.get("__rpa_loop__")
        if not isinstance(loop_raw, dict):
            raise ValueError("rpa:flow.loop requires __rpa_loop__ inputs")

        iterator = str(loop_raw.get("iterator") or "item_index")
        mode = str(loop_raw.get("mode") or "range").strip().lower()
        if mode != "range":
            raise ValueError(f"Unsupported rpa loop mode: {mode}")

        start = _to_int(_render_template(loop_raw.get("start", 1), context), default=1)
        end = _to_int(_render_template(loop_raw.get("end", start), context), default=start)
        actions = loop_raw.get("actions") or []
        if not isinstance(actions, list):
            raise ValueError("rpa loop actions must be a list")

        stop_condition = loop_raw.get("stop_condition")
        if not isinstance(stop_condition, dict):
            stop_condition = {}
        max_iterations = _to_int(
            _render_template(
                stop_condition.get("max_iterations", loop_raw.get("max_iterations", 0)),
                context,
            ),
            default=0,
        )

        for index in range(start, end + 1):
            if max_iterations > 0 and loop_iterations >= max_iterations:
                evidence.append(f"flow.loop:stop:max_iterations:{max_iterations}")
                break
            loop_iterations += 1
            loop_context = {**context, iterator: index}
            for action in actions:
                if not isinstance(action, dict):
                    continue
                action_kind = str(action.get("kind") or "").strip()
                payload = {k: v for k, v in action.items() if k != "kind"}
                executed_kind, duration_ms = _execute_rpa_action(
                    project_dir=project_dir,
                    kind=action_kind,
                    payload=payload,
                    context=loop_context,
                    outputs=outputs,
                    evidence=evidence,
                )
                action_count += 1
                action_duration_total_ms += duration_ms
                action_duration_by_kind[executed_kind] = round(
                    action_duration_by_kind.get(executed_kind, 0.0) + duration_ms,
                    3,
                )
                action_count_by_kind[executed_kind] = action_count_by_kind.get(executed_kind, 0) + 1

            if stop_condition:
                stop_checks += 1
                passed, reason = _check_loop_stop_condition(
                    stop_condition=stop_condition,
                    context=loop_context,
                )
                if not passed:
                    on_failure = str(
                        _render_template(stop_condition.get("on_failure", "fail"), loop_context) or "fail"
                    ).strip().lower()
                    if on_failure in {"continue", "ignore"}:
                        stop_failures += 1
                        evidence.append(
                            f"flow.loop:stop_condition_failed:{on_failure}:{reason or 'condition_mismatch'}"
                        )
                    else:
                        raise RuntimeError(f"RPA loop stop_condition check failed: {reason}")
                if reason and reason.startswith("unsupported_stop_condition"):
                    evidence.append(reason)
    else:
        executed_kind, duration_ms = _execute_rpa_action(
            project_dir=project_dir,
            kind=rpa_kind,
            payload=inputs,
            context=context,
            outputs=outputs,
            evidence=evidence,
        )
        action_count = 1
        action_duration_total_ms = duration_ms
        action_duration_by_kind[executed_kind] = round(duration_ms, 3)
        action_count_by_kind[executed_kind] = 1

    metrics = {
        "rpa_runtime": True,
        "rpa_kind": rpa_kind,
        "rpa_actions_executed": action_count,
        "rpa_loop_iterations": loop_iterations,
        "rpa_stop_condition_checks": stop_checks,
        "rpa_stop_condition_failures": stop_failures,
        "rpa_output_count": len(outputs),
        "rpa_action_duration_ms_total": round(action_duration_total_ms, 3),
        "rpa_action_duration_ms_by_kind": action_duration_by_kind,
        "rpa_action_count_by_kind": action_count_by_kind,
    }
    return outputs, metrics, evidence
