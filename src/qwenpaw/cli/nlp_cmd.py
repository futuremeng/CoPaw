# -*- coding: utf-8 -*-
"""Local HanLP NLP task commands for CoPaw CLI."""
from __future__ import annotations

import json
import time
from pathlib import Path
from queue import Queue
from threading import Thread
from typing import Any

import click

from ..config import load_config
from copaw.knowledge.hanlp_nlp_runtime import NLPRuntime
from copaw.knowledge.knowledge_quantization_assessment import (
    build_l2_quantization_scorecard,
    grade_l2_quantization_assessment,
    normalize_l2_quantization_grade_thresholds,
    sort_l2_quantization_assessment_items,
    summarize_l2_quantization_risk_label_hits,
)
from ..constant import WORKING_DIR


_TASKS: dict[str, str] = {
    "tokenize": "Tokenization",
    "ner": "Named Entity Recognition",
    "pos_ctb": "POS tagging (CTB)",
    "pos_pku": "POS tagging (PKU)",
    "pos_863": "POS tagging (863)",
    "dep": "Dependency parsing",
    "sdp": "Semantic dependency parsing",
    "con": "Constituency parsing",
    "lzh_tok_fine": "Classical Chinese tokenization (fine)",
    "lzh_tok_coarse": "Classical Chinese tokenization (coarse)",
    "lzh_lem": "Classical Chinese lemmatization",
    "lzh_pos_upos": "Classical Chinese POS (UPOS)",
    "lzh_pos_xpos": "Classical Chinese POS (XPOS)",
    "lzh_pos_pku": "Classical Chinese POS (PKU)",
    "lzh_dep": "Classical Chinese dependency parsing",
}

_RUNTIME_TASK_KEY: dict[str, str] = {
    "ner": "ner_msra",
}

_L2_PROBE_TASKS: tuple[str, ...] = ("ner", "dep", "sdp", "con")


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _clamp_0_1(value: float) -> float:
    return max(0.0, min(1.0, value))


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _format_result(value: Any) -> str:
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, ensure_ascii=False, indent=2)
    return str(value)


def _print_perf(state: dict[str, str], elapsed_ms: int) -> None:
    click.echo("\nPerformance:")
    click.echo(f"  duration_ms: {elapsed_ms}")
    sidecar_ms = state.get("sidecar_elapsed_ms")
    if sidecar_ms:
        click.echo(f"  sidecar_elapsed_ms: {sidecar_ms}")
    trace_ms = state.get("sidecar_trace_elapsed_ms")
    if trace_ms:
        click.echo(f"  sidecar_trace_elapsed_ms: {trace_ms}")
    execution_path = state.get("sidecar_execution_path")
    if execution_path:
        click.echo(f"  sidecar_execution_path: {execution_path}")
    execution_detail = state.get("sidecar_execution_detail")
    if execution_detail:
        click.echo(f"  sidecar_execution_detail: {execution_detail}")


def _run_task(
    task_key: str,
    text: str,
    *,
    show_perf: bool,
    json_output: bool,
) -> None:
    result, state, elapsed_ms = _execute_task(task_key, text)

    status = str(state.get("status") or "unavailable")
    if status != "ready":
        reason_code = str(state.get("reason_code") or "NLP_TASK_FAILED")
        reason = str(state.get("reason") or "NLP task failed")
        raise click.ClickException(f"{reason_code}: {reason}")

    if json_output:
        payload = {
            "task_key": task_key,
            "status": status,
            "result": result,
            "meta": state,
            "duration_ms": elapsed_ms,
        }
        click.echo(json.dumps(payload, ensure_ascii=False, indent=2))
        return

    click.echo(_format_result(result))
    if show_perf:
        _print_perf(state, elapsed_ms)


def _execute_task(task_key: str, text: str) -> tuple[Any, dict[str, str], int]:
    cfg = load_config()
    runtime = NLPRuntime()
    runtime_task_key = _RUNTIME_TASK_KEY.get(task_key, task_key)
    runtime_cfg = cfg.knowledge.model_copy(deep=True)
    setattr(runtime_cfg, "nlp", cfg.nlp.model_copy(deep=True))

    started = time.perf_counter()
    result, state = runtime.run_task(runtime_task_key, text, runtime_cfg)
    elapsed_ms = int((time.perf_counter() - started) * 1000)
    return result, state, elapsed_ms


def _resolve_l2_state_path(
    *,
    project_id: str | None,
    knowledge_dirname: str | None,
    state_file: str | None,
) -> Path:
    if state_file:
        return Path(state_file).expanduser().resolve()

    if not project_id:
        raise click.ClickException("Either --project-id or --state-file is required.")

    dirname = (knowledge_dirname or f"projects/{project_id}/.knowledge").strip()
    return (Path(WORKING_DIR) / dirname / "project-pipeline-state.json").resolve()


def _grade_l2_assessment(
    scorecard: dict[str, Any] | None,
    probes: dict[str, Any] | None,
    *,
    threshold_a: float,
    threshold_b: float,
    threshold_c: float,
) -> dict[str, Any]:
    return grade_l2_quantization_assessment(
        scorecard,
        probes,
        threshold_a=threshold_a,
        threshold_b=threshold_b,
        threshold_c=threshold_c,
    )


def _discover_project_state_files(limit: int = 100) -> list[tuple[str, Path]]:
    root = Path(WORKING_DIR) / "projects"
    if not root.exists():
        return []

    out: list[tuple[str, Path]] = []
    for child in sorted(root.iterdir(), key=lambda p: p.name):
        if not child.is_dir():
            continue
        state_path = child / ".knowledge" / "project-pipeline-state.json"
        if state_path.exists():
            out.append((child.name, state_path.resolve()))
            if len(out) >= max(1, limit):
                break
    return out


def _run_l2_probes(sample_texts: list[str]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    ok = 0
    total = 0

    for text in sample_texts:
        text = str(text or "").strip()
        if not text:
            continue
        for task_key in _L2_PROBE_TASKS:
            total += 1
            _result, state, elapsed_ms = _execute_task_with_timeout(task_key, text)
            status = str(state.get("status") or "unavailable")
            if status == "ready":
                ok += 1
            rows.append(
                {
                    "task": task_key,
                    "text": text,
                    "status": status,
                    "duration_ms": elapsed_ms,
                    "reason_code": str(state.get("reason_code") or ""),
                    "sidecar_elapsed_ms": _safe_int(state.get("sidecar_elapsed_ms")),
                    "sidecar_execution_path": str(state.get("sidecar_execution_path") or ""),
                }
            )

    success_ratio = (ok / total) if total > 0 else 0.0
    latencies = [r["duration_ms"] for r in rows if r.get("status") == "ready"]
    p95_ms = 0
    if latencies:
        sorted_lat = sorted(int(x) for x in latencies)
        idx = max(0, min(len(sorted_lat) - 1, int(round((len(sorted_lat) - 1) * 0.95))))
        p95_ms = sorted_lat[idx]

    return {
        "tasks": list(_L2_PROBE_TASKS),
        "sample_size": len(sample_texts),
        "total_runs": total,
        "ready_runs": ok,
        "success_ratio": round(success_ratio, 4),
        "p95_duration_ms": p95_ms,
        "rows": rows,
    }


def _execute_task_with_timeout(
    task_key: str,
    text: str,
    *,
    timeout_sec: float = 20.0,
) -> tuple[Any, dict[str, str], int]:
    started = time.perf_counter()
    out: Queue[tuple[Any, dict[str, str], int] | Exception] = Queue(maxsize=1)

    def _target() -> None:
        try:
            out.put(_execute_task(task_key, text))
        except Exception as exc:  # pylint: disable=broad-except
            out.put(exc)

    worker = Thread(target=_target, daemon=True)
    worker.start()
    worker.join(timeout=timeout_sec)

    if worker.is_alive():
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return (
            None,
            {
                "status": "unavailable",
                "reason_code": "NLP_PROBE_TIMEOUT",
                "reason": f"Probe task timed out after {timeout_sec:.1f}s",
            },
            elapsed_ms,
        )

    if out.empty():
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return (
            None,
            {
                "status": "unavailable",
                "reason_code": "NLP_PROBE_EMPTY_RESULT",
                "reason": "Probe task finished without result payload",
            },
            elapsed_ms,
        )

    result = out.get()
    if isinstance(result, Exception):
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return (
            None,
            {
                "status": "unavailable",
                "reason_code": "NLP_PROBE_EXCEPTION",
                "reason": str(result),
            },
            elapsed_ms,
        )
    return result


def _print_assessment_table(payload: dict[str, Any]) -> None:
    score = _as_dict(payload.get("scorecard"))
    coverage = _as_dict(score.get("coverage"))
    density = _as_dict(score.get("density"))
    click.echo("L2 Assessment Summary")
    click.echo("---------------------")
    click.echo(f"project_id: {payload.get('project_id') or '(from state file)'}")
    click.echo(f"total_chunks: {score.get('total_chunks', 0)}")
    click.echo(f"coverage.l2_core: {coverage.get('l2_core', 0):.4f}")
    click.echo(f"coverage.ner: {coverage.get('ner', 0):.4f}")
    click.echo(f"coverage.syntax: {coverage.get('syntax', 0):.4f}")
    click.echo(f"quality_proxy: {score.get('quality_proxy', 0):.4f}")
    click.echo(f"density.entity_per_chunk: {density.get('entity_per_chunk', 0):.4f}")
    click.echo(f"density.relation_per_token: {density.get('relation_per_token', 0):.4f}")
    raw_degrade_flags = score.get("degrade_flags")
    degrade_flags = raw_degrade_flags if isinstance(raw_degrade_flags, list) else []
    click.echo(f"degrade_flags: {', '.join(degrade_flags) if degrade_flags else '(none)'}")

    probes = _as_dict(payload.get("probes"))
    if probes:
        click.echo("\nProbe Summary")
        click.echo("-------------")
        click.echo(f"tasks: {', '.join(probes.get('tasks') or [])}")
        click.echo(f"total_runs: {probes.get('total_runs', 0)}")
        click.echo(f"ready_runs: {probes.get('ready_runs', 0)}")
        click.echo(f"success_ratio: {float(probes.get('success_ratio') or 0):.4f}")
        click.echo(f"p95_duration_ms: {int(probes.get('p95_duration_ms') or 0)}")

    grade = _as_dict(payload.get("grade"))
    if grade:
        click.echo("\nGrade")
        click.echo("-----")
        click.echo(f"grade: {grade.get('grade', 'N/A')}")
        click.echo(f"score: {float(grade.get('score') or 0):.4f}")
        click.echo(f"risk_score: {float(grade.get('risk_score') or 0):.4f}")
        labels = grade.get("risk_labels") if isinstance(grade.get("risk_labels"), list) else []
        click.echo(f"risk_labels: {', '.join(str(x) for x in labels) if labels else '(none)'}")
        reasons = grade.get("reasons") if isinstance(grade.get("reasons"), list) else []
        if reasons:
            click.echo("reasons:")
            for reason in reasons:
                click.echo(f"  - {reason}")
        recommendations = grade.get("recommendations") if isinstance(grade.get("recommendations"), list) else []
        if recommendations:
            click.echo("recommendations:")
            for rec in recommendations:
                click.echo(f"  - {rec}")


def _print_batch_assessment_table(payload: dict[str, Any]) -> None:
    raw_items = payload.get("items")
    items: list[dict[str, Any]] = raw_items if isinstance(raw_items, list) else []
    risk_label_hits = payload.get("risk_label_hits") if isinstance(payload.get("risk_label_hits"), dict) else {}
    click.echo("L2 Batch Assessment")
    click.echo("-------------------")
    click.echo(f"projects_scanned: {len(items)}")
    if risk_label_hits:
        summary = ", ".join(f"{k}:{v}" for k, v in sorted(risk_label_hits.items(), key=lambda x: (-int(x[1]), str(x[0]))))
        click.echo(f"risk_label_hits: {summary}")
    click.echo("project_id            grade   score    risk    state")
    click.echo("-------------------   -----   ------   ------  -------------")
    for item in items:
        if not isinstance(item, dict):
            continue
        project_id = str(item.get("project_id") or "")
        grade = _as_dict(item.get("grade"))
        grade_value = str(grade.get("grade") or "N/A")
        score_value = float(grade.get("score") or 0)
        risk_value = float(grade.get("risk_score") or 0)
        source = _as_dict(item.get("source"))
        source_status = str(source.get("status") or "")
        click.echo(f"{project_id:<20} {grade_value:<5}   {score_value:0.4f}   {risk_value:0.4f}  {source_status}")


def _export_payload(payload: dict[str, Any], export_path: str) -> Path:
    path = Path(export_path).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path

@click.group("nlp")
def nlp_group() -> None:
    """Run local HanLP NLP tasks (tokenize/ner/pos/dep...)."""


@nlp_group.command("list")
def list_tasks_cmd() -> None:
    """List available local NLP tasks."""
    click.echo("Available NLP tasks:")
    for task_key, desc in _TASKS.items():
        click.echo(f"  {task_key:<15} {desc}")


@nlp_group.command("run")
@click.argument("task_key", type=click.Choice(list(_TASKS.keys())))
@click.argument("text", type=str)
@click.option("--show-perf", is_flag=True, help="Show performance details.")
@click.option("--json", "json_output", is_flag=True, help="Output structured JSON.")
def run_cmd(
    task_key: str,
    text: str,
    show_perf: bool,
    json_output: bool,
) -> None:
    """Run one NLP task with explicit task key."""
    _run_task(task_key, text, show_perf=show_perf, json_output=json_output)


@nlp_group.command("assess-l2")
@click.option("--project-id", default=None, help="Project ID to assess.")
@click.option(
    "--knowledge-dirname",
    default=None,
    help="Knowledge directory relative to WORKING_DIR (default: projects/<project_id>/.knowledge).",
)
@click.option("--state-file", default=None, help="Explicit project-pipeline-state.json path.")
@click.option(
    "--sample-text",
    "sample_texts",
    multiple=True,
    help="Sample text for NLP probe. Repeatable.",
)
@click.option("--run-probes/--no-run-probes", default=True, help="Run NLP probes for NER/DEP/SDP/CON.")
@click.option("--probe-timeout", default=20.0, type=float, show_default=True, help="Per task timeout in seconds for probe runs.")
@click.option("--probe-only", is_flag=True, help="Run probes without loading project pipeline state.")
@click.option("--all-projects", is_flag=True, help="Assess all local projects under WORKING_DIR/projects.")
@click.option("--allow-empty", is_flag=True, help="In --all-projects mode, return empty result instead of error when no state files found.")
@click.option("--project-limit", default=100, type=int, show_default=True, help="Max number of projects to scan in batch mode.")
@click.option("--sort-by", type=click.Choice(["risk", "score", "project_id"]), default="risk", show_default=True, help="Batch result ordering.")
@click.option("--top", default=0, type=int, show_default=True, help="Return top-N projects after sorting (0 means all).")
@click.option("--grade-a", default=0.85, type=float, show_default=True, help="Grade A threshold.")
@click.option("--grade-b", default=0.70, type=float, show_default=True, help="Grade B threshold.")
@click.option("--grade-c", default=0.50, type=float, show_default=True, help="Grade C threshold.")
@click.option("--export", "export_path", default=None, help="Write assessment JSON output to file.")
@click.option("--json", "json_output", is_flag=True, help="Output structured JSON.")
def assess_l2_cmd(
    project_id: str | None,
    knowledge_dirname: str | None,
    state_file: str | None,
    sample_texts: tuple[str, ...],
    run_probes: bool,
    probe_timeout: float,
    probe_only: bool,
    all_projects: bool,
    allow_empty: bool,
    project_limit: int,
    sort_by: str,
    top: int,
    grade_a: float,
    grade_b: float,
    grade_c: float,
    export_path: str | None,
    json_output: bool,
) -> None:
    """Assess L2 knowledge quantization using current project pipeline metrics + NLP probes."""
    try:
        threshold_a, threshold_b, threshold_c = normalize_l2_quantization_grade_thresholds(
            grade_a,
            grade_b,
            grade_c,
        )
    except ValueError as exc:
        raise click.ClickException(str(exc)) from exc
    if all_projects and (project_id or state_file or probe_only):
        raise click.ClickException("--all-projects cannot be combined with --project-id/--state-file/--probe-only.")

    if all_projects:
        discovered = _discover_project_state_files(limit=max(1, project_limit))
        if not discovered:
            if not allow_empty:
                raise click.ClickException("No project-pipeline-state.json found under WORKING_DIR/projects.")
            payload = {
                "mode": "all-projects",
                "sort_by": sort_by,
                "top": top,
                "items": [],
                "risk_label_hits": {},
            }
            saved: Path | None = None
            if export_path:
                saved = _export_payload(payload, export_path)
            if json_output:
                click.echo(json.dumps(payload, ensure_ascii=False, indent=2))
                if saved is not None:
                    click.echo(f"\nExported: {saved}")
                return
            _print_batch_assessment_table(payload)
            if saved is not None:
                click.echo(f"\nExported: {saved}")
            return

        default_samples = [
            "阿婆主来到北京立方庭参观自然语义科技公司。",
            "项目空间中的知识图谱需要高质量实体与关系抽取。",
        ]
        samples = [s for s in list(sample_texts) if str(s or "").strip()] or default_samples

        items: list[dict[str, Any]] = []
        for item_project_id, path in discovered:
            state_error: str | None = None
            try:
                state = json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                state = {}
                state_error = f"Invalid state JSON: {exc}"
            scorecard = build_l2_quantization_scorecard(state) if state_error is None else None
            probes = (
                _run_l2_probes_with_timeout(samples, timeout_sec=max(1.0, probe_timeout))
                if run_probes
                else None
            )
            grade = _grade_l2_assessment(
                scorecard,
                probes,
                threshold_a=threshold_a,
                threshold_b=threshold_b,
                threshold_c=threshold_c,
            )
            item_payload = {
                "project_id": item_project_id,
                "state_file": str(path),
                "scorecard": scorecard,
                "source": {
                    "status": "invalid_state_json" if state_error else str(state.get("status") or ""),
                    "stage": str(state.get("stage") or ""),
                    "updated_at": str(state.get("updated_at") or state.get("last_finished_at") or ""),
                },
                "grade": grade,
            }
            if state_error:
                item_payload["state_error"] = state_error
                item_grade = _as_dict(item_payload.get("grade"))
                raw_labels = item_grade.get("risk_labels")
                labels: list[Any] = raw_labels if isinstance(raw_labels, list) else []
                raw_reasons = item_grade.get("reasons")
                reasons: list[Any] = raw_reasons if isinstance(raw_reasons, list) else []
                item_grade["risk_labels"] = [*labels, "state_parse_error"]
                item_grade["reasons"] = [*reasons, state_error]
                item_grade["grade"] = "N/A"
                item_payload["grade"] = item_grade
            if probes is not None:
                item_payload["probes"] = probes
            items.append(item_payload)

        items = sort_l2_quantization_assessment_items(items, sort_by=sort_by)
        if top > 0:
            items = items[:top]

        risk_label_hits = summarize_l2_quantization_risk_label_hits(items)

        payload = {
            "mode": "all-projects",
            "sort_by": sort_by,
            "top": top,
            "items": items,
            "risk_label_hits": risk_label_hits,
        }
        saved: Path | None = None
        if export_path:
            saved = _export_payload(payload, export_path)
        if json_output:
            click.echo(json.dumps(payload, ensure_ascii=False, indent=2))
            if saved is not None:
                click.echo(f"\nExported: {saved}")
            return
        _print_batch_assessment_table(payload)
        if saved is not None:
            click.echo(f"\nExported: {saved}")
        return

    state: dict[str, Any] = {}
    state_path: Path | None = None
    scorecard: dict[str, Any] | None = None

    if not probe_only:
        state_path = _resolve_l2_state_path(
            project_id=project_id,
            knowledge_dirname=knowledge_dirname,
            state_file=state_file,
        )
        if not state_path.exists():
            raise click.ClickException(f"State file not found: {state_path}")

        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise click.ClickException(f"Invalid state JSON: {state_path} ({exc})") from exc

        scorecard = build_l2_quantization_scorecard(state)

    default_samples = [
        "阿婆主来到北京立方庭参观自然语义科技公司。",
        "项目空间中的知识图谱需要高质量实体与关系抽取。",
    ]
    samples = [s for s in list(sample_texts) if str(s or "").strip()] or default_samples

    payload: dict[str, Any] = {
        "project_id": project_id,
        "state_file": str(state_path) if state_path is not None else None,
        "scorecard": scorecard,
        "source": {
            "status": str(state.get("status") or ""),
            "stage": str(state.get("stage") or ""),
            "updated_at": str(state.get("updated_at") or state.get("last_finished_at") or ""),
        },
    }

    if run_probes:
        payload["probes"] = _run_l2_probes_with_timeout(samples, timeout_sec=max(1.0, probe_timeout))

    payload["grade"] = _grade_l2_assessment(
        scorecard,
        _as_dict(payload.get("probes")) if run_probes else None,
        threshold_a=threshold_a,
        threshold_b=threshold_b,
        threshold_c=threshold_c,
    )

    saved: Path | None = None
    if export_path:
        saved = _export_payload(payload, export_path)

    if json_output:
        click.echo(json.dumps(payload, ensure_ascii=False, indent=2))
        if saved is not None:
            click.echo(f"\nExported: {saved}")
        return

    _print_assessment_table(payload)
    if saved is not None:
        click.echo(f"\nExported: {saved}")


def _run_l2_probes_with_timeout(sample_texts: list[str], *, timeout_sec: float) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    ok = 0
    total = 0

    for text in sample_texts:
        text = str(text or "").strip()
        if not text:
            continue
        for task_key in _L2_PROBE_TASKS:
            total += 1
            _result, state, elapsed_ms = _execute_task_with_timeout(
                task_key,
                text,
                timeout_sec=timeout_sec,
            )
            status = str(state.get("status") or "unavailable")
            if status == "ready":
                ok += 1
            rows.append(
                {
                    "task": task_key,
                    "text": text,
                    "status": status,
                    "duration_ms": elapsed_ms,
                    "reason_code": str(state.get("reason_code") or ""),
                    "sidecar_elapsed_ms": _safe_int(state.get("sidecar_elapsed_ms")),
                    "sidecar_execution_path": str(state.get("sidecar_execution_path") or ""),
                }
            )

    success_ratio = (ok / total) if total > 0 else 0.0
    latencies = [r["duration_ms"] for r in rows if r.get("status") == "ready"]
    p95_ms = 0
    if latencies:
        sorted_lat = sorted(int(x) for x in latencies)
        idx = max(0, min(len(sorted_lat) - 1, int(round((len(sorted_lat) - 1) * 0.95))))
        p95_ms = sorted_lat[idx]

    return {
        "tasks": list(_L2_PROBE_TASKS),
        "sample_size": len(sample_texts),
        "total_runs": total,
        "ready_runs": ok,
        "success_ratio": round(success_ratio, 4),
        "p95_duration_ms": p95_ms,
        "rows": rows,
        "probe_timeout_sec": timeout_sec,
    }


def _register_shortcut(task_key: str, description: str) -> None:
    @nlp_group.command(name=task_key, help=f"{description}.")
    @click.argument("text", type=str)
    @click.option("--show-perf", is_flag=True, help="Show performance details.")
    @click.option("--json", "json_output", is_flag=True, help="Output structured JSON.")
    def _cmd(text: str, show_perf: bool, json_output: bool) -> None:
        _run_task(task_key, text, show_perf=show_perf, json_output=json_output)


for _task_key, _task_desc in _TASKS.items():
    _register_shortcut(_task_key, _task_desc)
