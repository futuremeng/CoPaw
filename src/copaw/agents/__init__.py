# -*- coding: utf-8 -*-
"""Compatibility bridge for legacy copaw.agents imports."""

def __getattr__(name: str):
	if name == "QwenPawAgent":
		from qwenpaw.agents import QwenPawAgent

		return QwenPawAgent
	if name == "create_model_and_formatter":
		from qwenpaw.agents import create_model_and_formatter

		return create_model_and_formatter
	raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
