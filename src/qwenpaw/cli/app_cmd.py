# -*- coding: utf-8 -*-
from __future__ import annotations

import logging
import os
import subprocess
import sys
from pathlib import Path

import click
import uvicorn

from ..constant import LOG_LEVEL_ENV
from ..config.utils import write_last_api
from ..runtime_mode import get_runtime_app_import_path
from ..utils.logging import setup_logger, SuppressPathAccessLogFilter


def _debugger_attached() -> bool:
    """Return True when running under a debugger (debugpy/pdb/pydevd)."""
    trace_fn = sys.gettrace()
    if trace_fn is not None:
        return True
    return bool(os.environ.get("DEBUGPY_LAUNCHER_PORT"))


def _kill_port(port: int, signal: str = "TERM") -> None:
    """Kill process(es) occupying the specified port."""
    try:
        # Try lsof first (macOS, Linux)
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            capture_output=True,
            text=True,
            timeout=2,
        )
        pids = result.stdout.strip().split() if result.stdout.strip() else []
        
        if not pids:
            # Fallback: try netstat (Linux)
            result = subprocess.run(
                ["netstat", "-tlnp"],
                capture_output=True,
                text=True,
                timeout=2,
            )
            for line in result.stdout.split("\n"):
                if f":{port} " in line:
                    parts = line.split()
                    if len(parts) > 0:
                        pid_part = parts[-1].split("/")[0]
                        if pid_part.isdigit():
                            pids.append(pid_part)
        
        # Kill found processes
        for pid_str in pids:
            try:
                pid = int(pid_str)
                if pid > 0:
                    click.echo(
                        f"[copaw] Killing PID {pid} on port {port}...",
                        err=True,
                    )
                    subprocess.run(
                        ["kill", f"-{signal}", str(pid)],
                        timeout=2,
                        check=False,
                    )
            except (ValueError, subprocess.TimeoutExpired):
                pass
    except (subprocess.TimeoutExpired, FileNotFoundError):
        # lsof/netstat not available or timeout, silently continue
        pass



@click.command("app")
@click.option(
    "--host",
    default="127.0.0.1",
    show_default=True,
    help="Bind host",
)
@click.option(
    "--port",
    default=8088,
    type=int,
    show_default=True,
    help="Bind port",
)
@click.option("--reload", is_flag=True, help="Enable auto-reload (dev only)")
@click.option(
    "--log-level",
    default="info",
    type=click.Choice(
        ["critical", "error", "warning", "info", "debug", "trace"],
        case_sensitive=False,
    ),
    show_default=True,
    help="Log level",
)
@click.option(
    "--hide-access-paths",
    multiple=True,
    default=("/console/push-messages",),
    show_default=True,
    help="Path substrings to hide from uvicorn access log (repeatable).",
)
@click.option(
    "--workers",
    type=int,
    default=None,
    help="[DEPRECATED] Number of worker processes. "
    "This option is deprecated and will be removed in a future version. "
    "CoPaw always uses 1 worker.",
)
def app_cmd(
    host: str,
    port: int,
    reload: bool,
    workers: int,  # pylint: disable=unused-argument
    log_level: str,
    hide_access_paths: tuple[str, ...],
) -> None:
    """Run CoPaw FastAPI app."""
    # Kill any existing process on this port
    _kill_port(port)
    
    # Uvicorn reload mode spawns a supervisor/worker process pair and can make
    # VS Code debug sessions appear frozen or stop after Continue.
    if reload and _debugger_attached() and os.environ.get("QWENPAW_DEBUG_ALLOW_RELOAD") != "1":
        click.echo(
            "[copaw] Debugger detected: disabling --reload for stable single-process debugging. "
            "Set QWENPAW_DEBUG_ALLOW_RELOAD=1 to force reload mode.",
            err=True,
        )
        reload = False

    # Handle deprecated --workers parameter
    if workers is not None:
        click.echo(
            "⚠️  WARNING: --workers option is deprecated and will be removed "
            "in a future version.",
            err=True,
        )
        click.echo(
            "   CoPaw always uses 1 worker for stability. "
            "Your specified value will be ignored.",
            err=True,
        )
        click.echo(err=True)

    # Persist last used host/port for other terminals
    if host == "0.0.0.0":
        write_last_api("127.0.0.1", port)
    else:
        write_last_api(host, port)
    os.environ[LOG_LEVEL_ENV] = log_level

    # Signal reload mode to browser_control.py for Windows
    # compatibility: use sync Playwright + ThreadPool only when reload=True
    if reload:
        os.environ["QWENPAW_RELOAD_MODE"] = "1"
    else:
        os.environ.pop("QWENPAW_RELOAD_MODE", None)

    setup_logger(log_level)
    if log_level in ("debug", "trace"):
        from .main import log_init_timings

        log_init_timings()

    paths = [p for p in hide_access_paths if p]
    if paths:
        logging.getLogger("uvicorn.access").addFilter(
            SuppressPathAccessLogFilter(paths),
        )

    run_kwargs = {
        "host": host,
        "port": port,
        "reload": reload,
        "workers": 1,
        "log_level": log_level,
    }

    if reload:
        repo_root = Path(__file__).resolve().parents[3]
        run_kwargs.update(
            {
                "reload_dirs": [str(repo_root / "src"), str(repo_root / "tests")],
                "reload_excludes": [
                    ".venv/*",
                    "**/.venv/*",
                    "node_modules/*",
                    "**/node_modules/*",
                    ".git/*",
                    "**/.git/*",
                ],
            },
        )

    app_import_path = get_runtime_app_import_path()
    uvicorn.run(
        app_import_path,
        **run_kwargs,
    )
