# -*- coding: utf-8 -*-
"""MCP stateful clients with proper cross-task lifecycle management.

This module provides drop-in replacements for AgentScope's MCP clients
that solve the CPU leak issue caused by cross-task context manager exits.

The issue occurs when using AgentScope's StatefulClientBase in uvicorn/FastAPI:
- connect() enters AsyncExitStack in task A (e.g., startup event)
- close() exits AsyncExitStack in task B (e.g., reload background task)
- anyio.CancelScope requires enter/exit in the same task
- Error is silently ignored, leaving MCP processes and streams uncleaned

Our solution: Run the entire context manager lifecycle in a single dedicated
background task, using event-based signaling for reload/stop operations.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import sys
from contextlib import AsyncExitStack
from pathlib import Path
from datetime import timedelta
from typing import Any, Literal

import httpx
from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters
from mcp.client.sse import sse_client
from mcp.client.streamable_http import streamable_http_client
from mcp.shared._httpx_utils import create_mcp_http_client

from agentscope.mcp import StatefulClientBase

logger = logging.getLogger(__name__)


def _iter_leaf_exceptions(exc: BaseException):
    """Yield leaf exceptions, unwrapping ExceptionGroup recursively."""
    if isinstance(exc, BaseExceptionGroup):
        for sub_exc in exc.exceptions:
            yield from _iter_leaf_exceptions(sub_exc)
        return
    yield exc


def _extract_http_status_error(exc: BaseException) -> httpx.HTTPStatusError | None:
    """Extract first HTTPStatusError from nested/exception-group errors."""
    for leaf in _iter_leaf_exceptions(exc):
        if isinstance(leaf, httpx.HTTPStatusError):
            return leaf
    return None


def _is_mineru_stdio(args: list[str] | None) -> bool:
    """Return whether stdio args target mineru-mcp launcher."""
    if not args:
        return False
    return any(str(arg).strip() == "mineru-mcp" for arg in args)


def _resolve_stdio_command(command: str) -> str:
    """Resolve stdio executable robustly across mixed Python environments.

    Priority:
    1) As-is if explicit path provided.
    2) PATH lookup via shutil.which.
    3) Current interpreter's scripts/bin directory (sys.executable sibling).
    """
    if not command:
        return command

    command_path = Path(command).expanduser()
    if command_path.is_absolute() or command_path.parent != Path("."):
        return str(command_path)

    path_match = shutil.which(command)
    if path_match:
        return path_match

    interpreter_dir = Path(sys.executable).resolve().parent
    candidates = [interpreter_dir / command]
    if os.name == "nt":
        candidates.extend(
            [
                interpreter_dir / f"{command}.exe",
                interpreter_dir / f"{command}.cmd",
                interpreter_dir / f"{command}.bat",
            ],
        )

    for candidate in candidates:
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)

    return command


class StdIOStatefulClient(StatefulClientBase):
    """StdIO MCP client with proper cross-task lifecycle management.

    Drop-in replacement for agentscope.mcp.StdIOStatefulClient that solves
    the CPU leak issue by running the entire context manager lifecycle in
    a single dedicated background task.

    Key improvements:
    - Context manager enter/exit happens in the same asyncio task
    - Uses event-based signaling for reload/stop operations
    - Properly cleans up MCP subprocess and stdio streams
    - No CPU leak on reload
    - No zombie processes

    API-compatible with agentscope.mcp.StdIOStatefulClient for drop-in
    replacement.
    """

    def __init__(
        self,
        name: Any,
        command: Any,
        args: list[str] | None = None,
        env: dict[str, str] | None = None,
        cwd: str | None = None,
        encoding: str = "utf-8",
        encoding_error_handler: Literal[
            "strict",
            "ignore",
            "replace",
        ] = "strict",
    ) -> None:
        """Initialize the StdIO MCP client.

        Args:
            name: Client identifier (unique across MCP servers)
            command: The executable to run to start the server
            args: Command line arguments to pass to the executable
            env: The environment to use when spawning the process
            cwd: The working directory to use when spawning the process
            encoding: The text encoding used when sending/receiving messages
            encoding_error_handler: The text encoding error handler

        Raises:
            TypeError: If name or command is not a string
        """
        if not isinstance(name, str):
            raise TypeError(f"name must be str, got {type(name).__name__}")
        if not isinstance(command, str):
            raise TypeError(
                f"command must be str, got {type(command).__name__}",
            )

        self.name = name
        merged_env = dict(os.environ)
        if env:
            merged_env.update(env)
        resolved_command = _resolve_stdio_command(command)
        self.server_params = StdioServerParameters(
            command=resolved_command,
            args=args or [],
            env=merged_env,
            cwd=cwd,
            encoding=encoding,
            encoding_error_handler=encoding_error_handler,
        )

        # Lifecycle management
        self._lifecycle_task: asyncio.Task | None = None
        self._reload_event = asyncio.Event()
        self._ready_event = asyncio.Event()
        self._failed_event = asyncio.Event()
        self._stop_event = asyncio.Event()
        self._last_error: RuntimeError | None = None

        # Session state
        self.session: ClientSession | None = None
        self.is_connected = False

        # Tool cache
        self._cached_tools = None

    async def _run_lifecycle(self) -> None:
        """Run MCP client lifecycle in a dedicated task.

        This ensures __aenter__ and __aexit__ are called in the same task,
        avoiding the cross-task cancel scope error.
        """
        from mcp.client.stdio import stdio_client

        while not self._stop_event.is_set():
            self._failed_event.clear()
            self._last_error = None
            try:
                if _is_mineru_stdio(self.server_params.args):
                    mineru_api_key = (self.server_params.env or {}).get(
                        "MINERU_API_KEY",
                    )
                    if not mineru_api_key:
                        message = (
                            "MCP stdio precheck failed for 'mineru-mcp': "
                            "MINERU_API_KEY is missing in runtime environment. "
                            "Set the variable where CoPaw process starts, "
                            "then restart or reload MCP config."
                        )
                        self.session = None
                        self.is_connected = False
                        self._cached_tools = None
                        self._ready_event.clear()
                        self._last_error = RuntimeError(message)
                        self._failed_event.set()

                        logger.warning(message)

                        # Permanent until env/config is fixed and client reloads.
                        while (
                            not self._reload_event.is_set()
                            and not self._stop_event.is_set()
                        ):
                            await asyncio.sleep(0.2)

                        if self._reload_event.is_set():
                            self._reload_event.clear()
                            self._ready_event.clear()
                            self._failed_event.clear()
                        continue

                logger.debug(f"Connecting MCP client: {self.name}")

                # Enter context manager in THIS task
                async with AsyncExitStack() as stack:
                    context = await stack.enter_async_context(
                        stdio_client(self.server_params),
                    )
                    read_stream, write_stream = context[0], context[1]

                    # Initialize session
                    self.session = ClientSession(read_stream, write_stream)
                    await stack.enter_async_context(self.session)
                    await self.session.initialize()

                    # Mark as connected and signal ready
                    self.is_connected = True
                    self._ready_event.set()
                    logger.info(f"MCP client connected: {self.name}")

                    # Wait for reload or stop signal
                    while (
                        not self._reload_event.is_set()
                        and not self._stop_event.is_set()
                    ):
                        await asyncio.sleep(0.1)

                    # Clear state before exiting context
                    self.session = None
                    self.is_connected = False
                    self._cached_tools = None

                    if self._reload_event.is_set():
                        logger.info(f"Reloading MCP client: {self.name}")
                        self._reload_event.clear()
                        self._ready_event.clear()
                        # Context manager will exit here, then loop restarts
                    else:
                        logger.info(f"Stopping MCP client: {self.name}")
                        # Context manager will exit here, then loop exits

                # Context manager exits cleanly in THIS task

            except FileNotFoundError as e:
                command = self.server_params.command
                message = (
                    f"MCP stdio command not found for '{self.name}': {command!r}. "
                    "Install the command or update the MCP client config."
                )
                if command in {"uvx", "uv"}:
                    message += " Hint: install uv first, then retry."
                elif shutil.which(command) is None:
                    message += " Ensure the command exists in PATH."

                self.session = None
                self.is_connected = False
                self._cached_tools = None
                self._ready_event.clear()
                self._last_error = RuntimeError(message)
                self._failed_event.set()

                logger.warning(message)

                # Treat missing executable as permanent until reload/stop.
                while (
                    not self._reload_event.is_set()
                    and not self._stop_event.is_set()
                ):
                    await asyncio.sleep(0.1)

                if self._reload_event.is_set():
                    self._reload_event.clear()
                    self._ready_event.clear()
                    self._failed_event.clear()

            except Exception as e:
                logger.error(
                    f"Error in MCP client lifecycle for {self.name}: {e}",
                    exc_info=True,
                )
                self.session = None
                self.is_connected = False
                self._cached_tools = None
                self._ready_event.clear()
                await self._wait_before_retry(1.0)

        logger.info(f"MCP client lifecycle task exited: {self.name}")

    async def _wait_before_retry(self, delay: float) -> None:
        """Sleep up to *delay* seconds, returning early if stop is requested.

        This ensures that disabling a client (which sets _stop_event via
        close()) takes effect immediately instead of waiting the full retry
        delay.
        """
        stop_task = asyncio.ensure_future(self._stop_event.wait())
        try:
            await asyncio.wait({stop_task}, timeout=delay)
        finally:
            if not stop_task.done():
                stop_task.cancel()
                try:
                    await stop_task
                except asyncio.CancelledError:
                    pass

    async def connect(self, timeout: float = 30.0) -> None:
        """Connect to MCP server.

        Args:
            timeout: Connection timeout in seconds (default 30s)

        Raises:
            RuntimeError: If already connected
            asyncio.TimeoutError: If connection times out
        """
        if self.is_connected:
            raise RuntimeError(
                f"MCP client '{self.name}' is already connected. "
                f"Call close() before connecting again.",
            )

        # Start lifecycle task
        self._stop_event.clear()
        self._failed_event.clear()
        self._last_error = None
        self._lifecycle_task = asyncio.create_task(self._run_lifecycle())

        # Wait for initial connection
        ready_wait_task: asyncio.Task | None = None
        failed_wait_task: asyncio.Task | None = None
        try:
            ready_wait_task = asyncio.create_task(self._ready_event.wait())
            failed_wait_task = asyncio.create_task(self._failed_event.wait())

            done, pending = await asyncio.wait(
                {ready_wait_task, failed_wait_task},
                timeout=timeout,
                return_when=asyncio.FIRST_COMPLETED,
            )

            for task in pending:
                task.cancel()

            if not done:
                raise asyncio.TimeoutError

            if failed_wait_task in done and self._failed_event.is_set():
                raise self._last_error or RuntimeError(
                    f"MCP client '{self.name}' failed to connect",
                )
        except asyncio.TimeoutError:
            logger.error(
                f"Timeout waiting for MCP client '{self.name}' to connect",
            )
            # Clean up failed task
            self._stop_event.set()
            if self._lifecycle_task:
                await self._lifecycle_task
            raise
        finally:
            if ready_wait_task is not None and not ready_wait_task.done():
                ready_wait_task.cancel()
            if failed_wait_task is not None and not failed_wait_task.done():
                failed_wait_task.cancel()

    async def close(self, ignore_errors: bool = True) -> None:
        """Close MCP client and clean up resources.

        Args:
            ignore_errors: Whether to ignore errors during cleanup

        Raises:
            RuntimeError: If not connected (unless ignore_errors=True)
        """
        if not self.is_connected:
            if not ignore_errors:
                raise RuntimeError(
                    f"MCP client '{self.name}' is not connected. "
                    f"Call connect() before closing.",
                )
            return

        try:
            # Signal stop and wait for lifecycle task to finish
            self._stop_event.set()
            if self._lifecycle_task:
                await self._lifecycle_task
                self._lifecycle_task = None
        except Exception as e:
            if not ignore_errors:
                raise
            logger.warning(
                f"Error closing MCP client '{self.name}': {e}",
            )

    async def reload(self, timeout: float = 30.0) -> None:
        """Reload the MCP client (reconnect).

        Args:
            timeout: Connection timeout in seconds (default 30s)

        Raises:
            RuntimeError: If not connected
            asyncio.TimeoutError: If reload times out
        """
        if not self.is_connected:
            raise RuntimeError(
                f"MCP client '{self.name}' is not connected. "
                f"Call connect() first.",
            )

        logger.info(f"Triggering reload for MCP client: {self.name}")
        self._reload_event.set()

        # Wait for new connection
        try:
            await asyncio.wait_for(self._ready_event.wait(), timeout=timeout)
            logger.info(f"Reload completed for MCP client: {self.name}")
        except asyncio.TimeoutError:
            logger.error(
                f"Timeout waiting for MCP client '{self.name}' to reload",
            )
            raise

    async def list_tools(self):
        """Get all available tools from the server.

        Returns:
            List of available MCP tools

        Raises:
            RuntimeError: If not connected
        """
        self._validate_connection()

        res = await self.session.list_tools()

        # Cache the tools for later use
        self._cached_tools = res.tools
        return res.tools

    async def call_tool(self, name: str, arguments: dict | None = None):
        """Call a tool on the MCP server.

        Args:
            name: Tool name
            arguments: Tool arguments (optional)

        Returns:
            Tool call result

        Raises:
            RuntimeError: If not connected
        """
        self._validate_connection()

        return await self.session.call_tool(name, arguments or {})

    def _validate_connection(self) -> None:
        """Validate the connection to the MCP server.

        Raises:
            RuntimeError: If not connected or session not initialized
        """
        if not self.is_connected:
            raise RuntimeError(
                f"MCP client '{self.name}' is not connected. "
                f"Call connect() first.",
            )

        if not self.session:
            raise RuntimeError(
                f"MCP client '{self.name}' session is not initialized. "
                f"Call connect() first.",
            )


class HttpStatefulClient(StatefulClientBase):
    """HTTP/SSE MCP client with proper cross-task lifecycle management.

    Drop-in replacement for agentscope.mcp.HttpStatefulClient that solves
    the CPU leak issue by running the entire context manager lifecycle in
    a single dedicated background task.

    Supports both streamable HTTP and SSE transports.
    """

    def __init__(
        self,
        name: Any,
        transport: Any,
        url: Any,
        headers: dict[str, str] | None = None,
        timeout: float = 30,
        sse_read_timeout: float = 60 * 5,
        **client_kwargs: Any,
    ) -> None:
        """Initialize the HTTP MCP client.

        Args:
            name: Client identifier (unique across MCP servers)
            transport: The transport type ("streamable_http" or "sse")
            url: The URL to the MCP server
            headers: Additional headers to include in the HTTP request
            timeout: The timeout for the HTTP request in seconds
            sse_read_timeout: The timeout for reading SSE in seconds
            **client_kwargs: Additional keyword arguments for the client

        Raises:
            TypeError: If name, transport, or url is not a string
            ValueError: If transport is not "streamable_http" or "sse"
        """
        if not isinstance(name, str):
            raise TypeError(f"name must be str, got {type(name).__name__}")
        if not isinstance(transport, str):
            raise TypeError(
                f"transport must be str, got {type(transport).__name__}",
            )
        if transport not in ["streamable_http", "sse"]:
            raise ValueError(
                f"transport must be 'streamable_http' or 'sse', "
                f"got {transport!r}",
            )
        if not isinstance(url, str):
            raise TypeError(f"url must be str, got {type(url).__name__}")

        self.name = name
        self.transport = transport
        self.url = url
        self.headers = headers
        self.timeout = timeout
        self.sse_read_timeout = sse_read_timeout
        self.client_kwargs = client_kwargs

        # Lifecycle management
        self._lifecycle_task: asyncio.Task | None = None
        self._reload_event = asyncio.Event()
        self._ready_event = asyncio.Event()
        self._stop_event = asyncio.Event()

        # Session state
        self.session: ClientSession | None = None
        self.is_connected = False

        # Tool cache
        self._cached_tools = None

    async def _run_lifecycle(self) -> None:
        """Run MCP client lifecycle in a dedicated task."""
        while not self._stop_event.is_set():
            try:
                logger.debug(f"Connecting MCP client: {self.name}")

                # Enter context manager in THIS task
                async with AsyncExitStack() as stack:
                    if self.transport == "streamable_http":
                        timeout_seconds = (
                            self.timeout.total_seconds()
                            if isinstance(self.timeout, timedelta)
                            else self.timeout
                        )
                        sse_read_timeout_seconds = (
                            self.sse_read_timeout.total_seconds()
                            if isinstance(self.sse_read_timeout, timedelta)
                            else self.sse_read_timeout
                        )

                        http_client = create_mcp_http_client(
                            headers=self.headers or {},
                            timeout=httpx.Timeout(
                                connect=timeout_seconds,
                                read=sse_read_timeout_seconds,
                                write=timeout_seconds,
                                pool=timeout_seconds,
                            ),
                            **self.client_kwargs,
                        )

                        http_client = await stack.enter_async_context(http_client)
                        context = await stack.enter_async_context(
                            streamable_http_client(
                                url=self.url,
                                http_client=http_client,
                            ),
                        )
                    else:
                        context = await stack.enter_async_context(
                            sse_client(
                                url=self.url,
                                headers=self.headers,
                                timeout=self.timeout,
                                sse_read_timeout=self.sse_read_timeout,
                                **self.client_kwargs,
                            ),
                        )
                    read_stream, write_stream = context[0], context[1]

                    # Initialize session
                    self.session = ClientSession(read_stream, write_stream)
                    await stack.enter_async_context(self.session)
                    await self.session.initialize()

                    # Mark as connected and signal ready
                    self.is_connected = True
                    self._ready_event.set()
                    logger.info(f"MCP client connected: {self.name}")

                    # Wait for reload or stop signal
                    while (
                        not self._reload_event.is_set()
                        and not self._stop_event.is_set()
                    ):
                        await asyncio.sleep(0.1)

                    # Clear state before exiting context
                    self.session = None
                    self.is_connected = False
                    self._cached_tools = None

                    if self._reload_event.is_set():
                        logger.info(f"Reloading MCP client: {self.name}")
                        self._reload_event.clear()
                        self._ready_event.clear()
                    else:
                        logger.info(f"Stopping MCP client: {self.name}")

                # Context manager exits cleanly in THIS task

            except Exception as e:
                retry_delay = 1.0
                http_status_error = _extract_http_status_error(e)
                if http_status_error is not None:
                    status_code = http_status_error.response.status_code
                    request_url = str(http_status_error.request.url)
                    reason = (
                        http_status_error.response.reason_phrase
                        or "HTTP error"
                    )

                    # Reduce noisy rapid retries when upstream MCP is unavailable.
                    if status_code in {401, 403}:
                        retry_delay = 15.0
                    elif status_code >= 500:
                        retry_delay = 5.0
                    else:
                        retry_delay = 2.0
                    logger.warning(
                        "MCP HTTP client lifecycle error for %s: HTTP %s %s (%s); retrying in %.1fs",
                        self.name,
                        status_code,
                        reason,
                        request_url,
                        retry_delay,
                    )
                    if status_code in {401, 403}:
                        # Provide detailed guidance for auth errors
                        has_auth = any(
                            k.lower() == "authorization"
                            for k in (self.headers or {}).keys()
                        )
                        if has_auth:
                            logger.warning(
                                "MCP HTTP auth error for %s (401/403): Authorization header is configured but rejected. "
                                "Possible causes: (1) token is expired/invalid, (2) nginx proxy not forwarding auth header, "
                                "(3) server doesn't support configured token format. URL: %s",
                                self.name,
                                request_url,
                            )
                        else:
                            logger.warning(
                                "MCP HTTP auth error for %s (401/403): NO Authorization header configured. "
                                "Please add 'headers' with 'Authorization' to your MCP client config. URL: %s",
                                self.name,
                                request_url,
                            )
                    logger.debug(
                        "Detailed MCP HTTP lifecycle exception for %s",
                        self.name,
                        exc_info=True,
                    )
                else:
                    logger.error(
                        f"Error in MCP client lifecycle for {self.name}: {e}",
                        exc_info=True,
                    )
                self.session = None
                self.is_connected = False
                self._cached_tools = None
                self._ready_event.clear()
                await self._wait_before_retry(retry_delay)

        logger.info(f"MCP client lifecycle task exited: {self.name}")

    async def _wait_before_retry(self, delay: float) -> None:
        """Sleep up to *delay* seconds, returning early if stop is requested.

        This ensures that disabling a client (which sets _stop_event via
        close()) takes effect immediately instead of waiting the full retry
        delay.
        """
        stop_task = asyncio.ensure_future(self._stop_event.wait())
        try:
            await asyncio.wait({stop_task}, timeout=delay)
        finally:
            if not stop_task.done():
                stop_task.cancel()
                try:
                    await stop_task
                except asyncio.CancelledError:
                    pass

    async def connect(self, timeout: float = 30.0) -> None:
        """Connect to MCP server.

        Args:
            timeout: Connection timeout in seconds

        Raises:
            RuntimeError: If already connected
            asyncio.TimeoutError: If connection times out
        """
        if self.is_connected:
            raise RuntimeError(
                f"MCP client '{self.name}' is already connected. "
                f"Call close() before connecting again.",
            )

        self._stop_event.clear()
        self._lifecycle_task = asyncio.create_task(self._run_lifecycle())

        try:
            await asyncio.wait_for(self._ready_event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            logger.error(
                f"Timeout waiting for MCP client '{self.name}' to connect",
            )
            self._stop_event.set()
            if self._lifecycle_task:
                await self._lifecycle_task
            raise

    async def close(self, ignore_errors: bool = True) -> None:
        """Close MCP client and clean up resources.

        Args:
            ignore_errors: Whether to ignore errors during cleanup

        Raises:
            RuntimeError: If not connected (unless ignore_errors=True)
        """
        if not self.is_connected:
            if not ignore_errors:
                raise RuntimeError(
                    f"MCP client '{self.name}' is not connected. "
                    f"Call connect() before closing.",
                )
            return

        try:
            self._stop_event.set()
            if self._lifecycle_task:
                await self._lifecycle_task
                self._lifecycle_task = None
        except Exception as e:
            if not ignore_errors:
                raise
            logger.warning(
                f"Error closing MCP client '{self.name}': {e}",
            )

    async def list_tools(self):
        """Get all available tools from the server.

        Returns:
            List of available MCP tools

        Raises:
            RuntimeError: If not connected
        """
        self._validate_connection()

        res = await self.session.list_tools()
        self._cached_tools = res.tools
        return res.tools

    async def call_tool(self, name: str, arguments: dict | None = None):
        """Call a tool on the MCP server.

        Args:
            name: Tool name
            arguments: Tool arguments (optional)

        Returns:
            Tool call result

        Raises:
            RuntimeError: If not connected
        """
        self._validate_connection()

        return await self.session.call_tool(name, arguments or {})

    def _validate_connection(self) -> None:
        """Validate the connection to the MCP server.

        Raises:
            RuntimeError: If not connected or session not initialized
        """
        if not self.is_connected:
            raise RuntimeError(
                f"MCP client '{self.name}' is not connected. "
                f"Call connect() first.",
            )

        if not self.session:
            raise RuntimeError(
                f"MCP client '{self.name}' session is not initialized. "
                f"Call connect() first.",
            )
