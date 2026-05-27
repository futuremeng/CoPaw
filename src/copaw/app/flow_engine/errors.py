# -*- coding: utf-8 -*-

from __future__ import annotations


class FlowEngineError(RuntimeError):
    error_code = "FLOW_ENGINE_ERROR"

    def __init__(self, message: str = "") -> None:
        super().__init__(message or self.error_code)


class FlowDefinitionNotFoundError(FlowEngineError, KeyError):
    error_code = "FLOW_DEFINITION_NOT_FOUND"


class FlowRunNotFoundError(FlowEngineError, KeyError):
    error_code = "FLOW_RUN_NOT_FOUND"


class FlowTransitionNotAllowedError(FlowEngineError, ValueError):
    error_code = "FLOW_TRANSITION_NOT_ALLOWED"


class FlowTransitionConflictError(FlowEngineError, ValueError):
    error_code = "FLOW_TRANSITION_CONFLICT"