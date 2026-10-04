from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
CONSOLE_LOCALES = REPO_ROOT / "console" / "src" / "locales"
SWITCHER = REPO_ROOT / "console" / "src" / "components" / "LanguageSwitcher" / "index.tsx"
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

switcher_keys: set[str] = set()
if SWITCHER.exists():
    switcher_keys = set(re.findall(r'key:\s*"([^"]+)"', SWITCHER.read_text(encoding="utf-8")))
else:
    errors.append(f"missing language switcher: {SWITCHER.relative_to(REPO_ROOT)}")

for lang in LANGS:
    if lang not in switcher_keys:
        errors.append(
            f"locale bundle {lang}.json ships but has no entry in the language switcher"
        )

CONSOLE_SRC = REPO_ROOT / "console" / "src"
OVERLAY_GROUPS = ("projects", "pipelines", "rpa", "workbench")
# Only these four roots are i18n namespaces.  Storage keys such as
# "copaw.navigation.trace" or "copaw.project.knowledge.trend.v1" live outside
# them, so restricting the roots keeps the scan from treating cache keys as copy.
OVERLAY_KEY_RE = re.compile(
    r'["\'](copaw\.(?:projects|pipelines|rpa|workbench)\.[A-Za-z0-9_.]+?)["\']'
)


def flatten(node: Any, prefix: str = "") -> set[str]:
    if isinstance(node, dict):
        return {
            key
            for child_key, child in node.items()
            for key in flatten(child, f"{prefix}.{child_key}" if prefix else child_key)
        }
    return {prefix} if prefix else set()


def overlay_keys(lang: str) -> set[str]:
    keys: set[str] = set()
    for group in OVERLAY_GROUPS:
        path = CONSOLE_LOCALES / "copaw" / group / f"{lang}.json"
        if path.exists():
            keys |= flatten(load_json(path))
    return keys


def resolvable_keys(lang: str) -> set[str]:
    base_path = CONSOLE_LOCALES / f"{lang}.json"
    keys = overlay_keys(lang)
    if base_path.exists():
        keys |= flatten(load_json(base_path))
    return keys


def production_translation_keys() -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for dirpath, dirnames, filenames in os.walk(CONSOLE_SRC):
        dirnames[:] = [d for d in dirnames if d != "tests"]
        for filename in filenames:
            if not filename.endswith((".ts", ".tsx")):
                continue
            path = Path(dirpath) / filename
            rel = path.relative_to(CONSOLE_SRC)
            if ".test." in filename or rel.as_posix() == "locales/copaw/register.ts":
                continue
            for match in OVERLAY_KEY_RE.finditer(path.read_text(encoding="utf-8")):
                found.setdefault(match.group(1), []).append(rel.as_posix())
    return found


call_sites = production_translation_keys()
for lang in ("en", "zh"):
    available = resolvable_keys(lang)
    for key in sorted(k for k in call_sites if k not in available):
        errors.append(
            f"translation key {key} is read by production code but missing from the {lang} bundle "
            f"(sites: {', '.join(sorted(set(call_sites[key])))})"
        )

en_overlay = overlay_keys("en")
zh_overlay = overlay_keys("zh")
for key in sorted(en_overlay - zh_overlay):
    errors.append(f"copaw overlay key exists in en but not zh: {key}")
for key in sorted(zh_overlay - en_overlay):
    errors.append(f"copaw overlay key exists in zh but not en: {key}")

if errors:
    for item in errors:
        print(f"ERROR: {item}")
    sys.exit(1)

print(
    "CoPaw locale split check passed "
    f"({len(call_sites)} production copaw.* keys, {len(en_overlay)} overlay keys en/zh)"
)
