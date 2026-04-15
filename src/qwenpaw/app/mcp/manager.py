# -*- coding: utf-8 -*-
"""MCP client manager for hot-reloadable client lifecycle management.

This module provides centralized management of MCP clients with support
for runtime updates without restarting the application.
"""

from __future__ import annotations

import asyncio
import logging
import os
import warnings
from typing import Any, Dict, List, TYPE_CHECKING

from .stateful_client import HttpStatefulClient, StdIOStatefulClient

if TYPE_CHECKING:
    from ...config.config import MCPClientConfig, MCPConfig

logger = logging.getLogger(__name__)


class MCPClientManager:
    """Manages MCP clients with hot-reload support.

    This manager handles the lifecycle of MCP clients, including:
    - Initial loading from config
    - Runtime replacement when config changes
    - Cleanup on shutdown

    Design pattern mirrors ChannelManager for consistency.
    """

    def __init__(self) -> None:
        """Initialize an empty MCP client manager."""
        self._clients: Dict[str, Any] = {}
        self._lock = asyncio.Lock()
        # Keys that failed to connect at startup or disconnected at runtime
        self._failed_keys: set = set()

    async def init_from_config(self, config: "MCPConfig") -> None:
        """Initialize clients from configuration.

        Args:
            config: MCP configuration containing client definitions
        """
        logger.debug("Initializing MCP clients from config")
        for key, client_config in config.clients.items():
            if not client_config.enabled:
                logger.debug(f"MCP client '{key}' is disabled, skipping")
                continue

            try:
                await self._add_client(key, client_config)
                logger.debug(f"MCP client '{key}' initialized successfully")
                self._failed_keys.discard(key)
            except BaseException as e:
                if isinstance(e, (KeyboardInterrupt, SystemExit)):
                    raise
                self._failed_keys.add(key)
                logger.warning(
                    f"MCP client '{key}' unavailable at startup"
                    f" ({type(e).__name__}: {e})."
                    " Auto-reconnect is disabled; fix config and reconnect manually.",
                )

    def active_keys(self) -> set:
        """Return the set of currently connected client keys.

        Uses ``is_connected`` from the underlying client object so that
        runtime disconnections are reflected without a heartbeat round-trip.
        """
        return {
            key
            for key, client in self._clients.items()
            if getattr(client, "is_connected", True)
        }

    def failed_keys(self) -> set:
        """Return keys that need reconnection.

        Combines startup failures (``_failed_keys``) with clients that
        connected initially but have since dropped (``is_connected=False``).
        """
        disconnected = {
            key
            for key, client in self._clients.items()
            if not getattr(client, "is_connected", True)
        }
        return self._failed_keys | disconnected

    def is_active(self, key: str) -> bool:
        """Return whether a given client is currently connected."""
        client = self._clients.get(key)
        if client is None:
            return False
        return bool(getattr(client, "is_connected", True))

    async def refresh_client_status(
        self,
        key: str,
        client_config: "MCPClientConfig",
        timeout: float = 15.0,
    ) -> bool:
        """Actively probe and reconnect a client if needed.

        Returns:
            True if the client is connected after refresh, False otherwise.
        """
        if not client_config.enabled:
            self._failed_keys.discard(key)
            return False

        existing = self._clients.get(key)

        if existing is not None and getattr(existing, "is_connected", False):
            try:
                await self._probe_client_capabilities(
                    existing,
                    key,
                    timeout=timeout,
                )
                self._failed_keys.discard(key)
                return True
            except Exception as exc:
                logger.debug(
                    "MCP client '%s' health probe failed: %s",
                    key,
                    exc,
                )
                try:
                    await existing.close()
                except Exception:
                    pass

        try:
            await self.replace_client(key, client_config, timeout=timeout)

            refreshed = self._clients.get(key)
            if refreshed is None:
                raise RuntimeError(
                    f"MCP client '{key}' missing after reconnect",
                )

            await self._probe_client_capabilities(
                refreshed,
                key,
                timeout=timeout,
            )
            self._failed_keys.discard(key)
            return True
        except Exception:
            failed_client = None
            async with self._lock:
                failed_client = self._clients.pop(key, None)
            if failed_client is not None:
                try:
                    await failed_client.close()
                except Exception:
                    logger.debug(
                        "Error closing failed MCP client '%s'",
                        key,
                        exc_info=True,
                    )
            self._failed_keys.add(key)
            return False

    async def _probe_client_capabilities(
        self,
        client: Any,
        key: str,
        timeout: float,
    ) -> None:
        """Probe MCP permissions by listing tools or resources.

        Token/auth failures for remote MCP usually surface here even if
        transport connect succeeded.
        """
        probe_errors: List[str] = []
        has_probe_method = False

        for method_name in ("list_tools", "list_resources"):
            method = getattr(client, method_name, None)
            if method is None or not callable(method):
                continue

            has_probe_method = True
            try:
                await asyncio.wait_for(method(), timeout=timeout)
                return
            except Exception as exc:
                probe_errors.append(f"{method_name}: {type(exc).__name__}: {exc}")

        if not has_probe_method:
            logger.debug(
                "MCP client '%s' has no probe methods; skip capability probe",
                key,
            )
            return

        raise RuntimeError(
            f"MCP client '{key}' capability probe failed: "
            + "; ".join(probe_errors)
        )

    async def get_clients(self) -> List[Any]:
        """Get list of all active MCP clients.

        This method is called by the runner on each query to get
        the latest set of clients.

        Returns:
            List of connected MCP client instances
        """
        async with self._lock:
            return [
                client
                for client in self._clients.values()
                if client is not None
            ]

    async def get_client(self, key: str) -> Any | None:
        """Get a specific active MCP client by key.

        Args:
            key: Client identifier (from config)

        Returns:
            Connected MCP client instance, or None if not found
        """
        async with self._lock:
            return self._clients.get(key)

    async def replace_client(
        self,
        key: str,
        client_config: "MCPClientConfig",
        timeout: float = 60.0,
    ) -> None:
        """Replace or add a client with new configuration.

        Flow: connect new (outside lock) → swap + close old (inside lock).
        This ensures minimal lock holding time.

        Args:
            key: Client identifier (from config)
            client_config: New client configuration
            timeout: Connection timeout in seconds (default 60s)
        """
        # 1. Create and connect new client outside lock (may be slow)
        logger.debug(f"Connecting new MCP client: {key}")
        new_client = self._build_client(client_config)

        try:
            # Add timeout to prevent indefinite blocking
            await asyncio.wait_for(new_client.connect(), timeout=timeout)
        except BaseException:
            await self._force_cleanup_client(new_client)
            raise

        # 2. Swap and close old client inside lock
        async with self._lock:
            old_client = self._clients.get(key)
            self._clients[key] = new_client
            self._failed_keys.discard(key)

            if old_client is not None:
                logger.debug(f"Closing old MCP client: {key}")
                try:
                    await old_client.close()
                except Exception as e:
                    logger.warning(
                        f"Error closing old MCP client '{key}': {e}",
                    )
            else:
                logger.debug(f"Added new MCP client: {key}")

    async def remove_client(self, key: str) -> None:
        """Remove and close a client.

        Args:
            key: Client identifier to remove
        """
        async with self._lock:
            old_client = self._clients.pop(key, None)
            self._failed_keys.discard(key)

        if old_client is not None:
            logger.debug(f"Removing MCP client: {key}")
            try:
                await old_client.close()
            except Exception as e:
                logger.warning(f"Error closing MCP client '{key}': {e}")

    async def close_all(self) -> None:
        """Close all MCP clients.

        Called during application shutdown.
        """
        async with self._lock:
            clients_snapshot = list(self._clients.items())
            self._clients.clear()
            self._failed_keys.clear()

        logger.debug("Closing all MCP clients")
        for key, client in clients_snapshot:
            if client is not None:
                try:
                    await client.close()
                except Exception as e:
                    logger.warning(f"Error closing MCP client '{key}': {e}")

    async def _add_client(
        self,
        key: str,
        client_config: "MCPClientConfig",
        timeout: float = 60.0,
    ) -> None:
        """Add a new client (used during initial setup).

        Args:
            key: Client identifier
            client_config: Client configuration
            timeout: Connection timeout in seconds (default 60s)
        """
        client = self._build_client(client_config)

        try:
            await asyncio.wait_for(client.connect(), timeout=timeout)
        except BaseException:
            await self._force_cleanup_client(client)
            raise

        async with self._lock:
            self._clients[key] = client
            self._failed_keys.discard(key)

    @staticmethod
    async def _force_cleanup_client(client: Any) -> None:
        """Force-close a client whose ``connect()`` was interrupted.

        ``StatefulClientBase.close()`` refuses to run when
        ``is_connected`` is still ``False`` (which is the case when
        ``connect()`` times out or raises).  We bypass that guard by
        closing the ``AsyncExitStack`` directly — this triggers the
        ``stdio_client`` finally-block that sends SIGTERM/SIGKILL to
        the child process.

        The ``ClientSession`` is registered on the same stack via
        ``enter_async_context``, so ``stack.aclose()`` exits it in
        LIFO order — no separate session teardown is needed.
        """
        if client is None:
            return

        stack = getattr(client, "stack", None)
        if stack is None:
            return

        try:
            await stack.aclose()
        except Exception:
            logger.debug(
                "Error during force-cleanup of MCP client",
                exc_info=True,
            )
        finally:
            for attr, default in (
                ("stack", None),
                ("session", None),
                ("is_connected", False),
            ):
                try:
                    setattr(client, attr, default)
                except Exception:
                    pass

    @staticmethod
    def _build_client(client_config: "MCPClientConfig") -> Any:
        """Build MCP client instance by configured transport."""
        rebuild_info = {
            "name": client_config.name,
            "transport": client_config.transport,
            "url": client_config.url,
            "headers": client_config.headers or None,
            "command": client_config.command,
            "args": list(client_config.args),
            "env": dict(client_config.env),
            "cwd": client_config.cwd or None,
        }

        if client_config.transport == "stdio":
            client = StdIOStatefulClient(
                name=client_config.name,
                command=client_config.command,
                args=client_config.args,
                env=client_config.env,
                cwd=client_config.cwd or None,
            )
            setattr(client, "_copaw_rebuild_info", rebuild_info)
            setattr(client, "_qwenpaw_rebuild_info", rebuild_info)
            return client

        headers = client_config.headers
        if headers:
            headers = {k: os.path.expandvars(v) for k, v in headers.items()}
            # Log headers for debugging auth issues
            safe_headers = {
                k: (v[:30] + "..." if len(v) > 30 else v)
                for k, v in headers.items()
            }
            logger.debug(
                "MCP client '%s' configured with headers: %s",
                client_config.name,
                safe_headers,
            )
        else:
            logger.debug(
                "MCP client '%s' has no custom headers",
                client_config.name,
            )

        transport = client_config.transport
        if transport == "sse":
            logger.info(
                "MCP client '%s' uses legacy transport 'sse'; "
                "using 'streamable_http' instead.",
                client_config.name,
            )
            transport = "streamable_http"

        # agentscope currently emits this deprecation from inside dependency
        # internals even when using streamable_http; suppress it locally only.
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message=r"Use `streamable_http_client` instead\.",
                category=DeprecationWarning,
            )
            client = HttpStatefulClient(
                name=client_config.name,
                transport=transport,
                url=client_config.url,
                headers=headers or None,
            )
        setattr(client, "_copaw_rebuild_info", rebuild_info)
        setattr(client, "_qwenpaw_rebuild_info", rebuild_info)
        return client
