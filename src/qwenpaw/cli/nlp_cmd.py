# -*- coding: utf-8 -*-
"""Local HanLP NLP task commands for CoPaw CLI."""
from __future__ import annotations

import json
import time
from typing import Any

import click

from ..config import load_config
from ..knowledge.hanlp_runtime import NLPRuntime


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
    cfg = load_config()
    runtime = NLPRuntime()
    runtime_task_key = _RUNTIME_TASK_KEY.get(task_key, task_key)

    started = time.perf_counter()
    result, state = runtime.run_task(runtime_task_key, text, cfg.knowledge)
    elapsed_ms = int((time.perf_counter() - started) * 1000)

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


def _register_shortcut(task_key: str, description: str) -> None:
    @nlp_group.command(name=task_key, help=f"{description}.")
    @click.argument("text", type=str)
    @click.option("--show-perf", is_flag=True, help="Show performance details.")
    @click.option("--json", "json_output", is_flag=True, help="Output structured JSON.")
    def _cmd(text: str, show_perf: bool, json_output: bool) -> None:
        _run_task(task_key, text, show_perf=show_perf, json_output=json_output)


for _task_key, _task_desc in _TASKS.items():
    _register_shortcut(_task_key, _task_desc)
