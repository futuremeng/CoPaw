from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
CONSOLE_LOCALES = REPO_ROOT / "console" / "src" / "locales"
LANGS = ("en", "zh", "ja", "ru", "pt-BR", "id")


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def nested_get(data: dict[str, Any], *parts: str) -> Any:
    current: Any = data
    for part in parts:
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


errors: list[str] = []

for lang in LANGS:
    base_path = CONSOLE_LOCALES / f"{lang}.json"
    if not base_path.exists():
        errors.append(f"missing base locale: {base_path.relative_to(REPO_ROOT)}")
        continue

    base = load_json(base_path)
    if "pipelines" in base:
        errors.append(
            f"base locale still contains top-level pipelines block: {base_path.relative_to(REPO_ROOT)}"
        )
    if "copaw" in base:
        errors.append(
            f"base locale should not contain top-level copaw block: {base_path.relative_to(REPO_ROOT)}"
        )

    projects_path = CONSOLE_LOCALES / "copaw" / "projects" / f"{lang}.json"
    pipelines_path = CONSOLE_LOCALES / "copaw" / "pipelines" / f"{lang}.json"
    rpa_path = CONSOLE_LOCALES / "copaw" / "rpa" / f"{lang}.json"

    for split_path, pointer in (
        (projects_path, ("copaw", "projects", "knowledge")),
        (pipelines_path, ("copaw", "pipelines")),
        (rpa_path, ("copaw", "rpa")),
    ):
        if not split_path.exists():
            errors.append(f"missing split locale: {split_path.relative_to(REPO_ROOT)}")
            continue
        payload = load_json(split_path)
        node = nested_get(payload, *pointer)
        if not isinstance(node, dict) or not node:
            errors.append(
                f"split locale node is empty: {split_path.relative_to(REPO_ROOT)} -> {'.'.join(pointer)}"
            )

if errors:
    for item in errors:
        print(f"ERROR: {item}")
    sys.exit(1)

print("CoPaw locale split check passed")
