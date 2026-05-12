# -*- coding: utf-8 -*-

from __future__ import annotations

import json
from typing import Any


def load_state(manager: Any, project_id: str, *, hydrate: bool = True) -> dict[str, Any]:
	state = manager._default_state(project_id)
	if manager.state_path.exists():
		try:
			payload = json.loads(manager.state_path.read_text(encoding="utf-8"))
		except Exception:
			payload = {}
		if isinstance(payload, dict):
			state.update(payload)
	state["project_id"] = project_id
	return manager._hydrate_processing_view(state) if hydrate else state


def save_state(manager: Any, state: dict[str, Any]) -> None:
	manager.state_path.parent.mkdir(parents=True, exist_ok=True)
	manager.state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def get_state(manager: Any, project_id: str) -> dict[str, Any]:
	with manager._lock:
		state = manager._load_state(project_id, hydrate=False)
	return manager._hydrate_processing_view(dict(state))


__all__ = ["get_state", "load_state", "save_state"]