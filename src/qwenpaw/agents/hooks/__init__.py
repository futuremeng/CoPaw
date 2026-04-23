# -*- coding: utf-8 -*-
"""Agent hooks package.

This package provides hook implementations for QwenPawAgent that follow
AgentScope's hook interface (any Callable).

Available Hooks:
    - BootstrapHook: First-time setup guidance
    - MemoryCompactionHook: Legacy context compaction compatibility hook
"""

from .bootstrap import BootstrapHook
from .memory_compaction import MemoryCompactionHook

__all__ = [
    "BootstrapHook",
    "MemoryCompactionHook",
]
