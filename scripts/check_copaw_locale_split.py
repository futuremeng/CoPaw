from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
CONSOLE_LOCALES = REPO_ROOT / "console" / "src" / "locales"
CONSOLE_SRC = REPO_ROOT / "console" / "src"
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
            # Conflict-surface knife 76: only en/zh are full-copy deliverables.
            # A secondary language that has nothing to say ships no file at all,
            # so requiring six files per group would push those languages back
            # into verbatim English just to satisfy the check.  A file that does
            # exist must still carry content: an empty carrier is the same debt
            # wearing a hat.
            if lang in ("en", "zh"):
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

# `projects`, `pipelines`, `rpa`, `workbench` are copaw-prefixed groups; the
# bare roots are copy the fork's own pages read (conflict-surface knives 70-72).
# The knife-72 roots are NOT in LITERAL_KEY_RE below: they also host upstream
# copy, so a bare-literal scan there would gate upstream keys on fork copy.
OVERLAY_GROUPS = (
    "projects",
    "pipelines",
    "rpa",
    "workbench",
    "knowledge",
    "agent",
    "agentConfig",
    "approval",
    "chat",
    "common",
    "mcp",
    "models",
    "skills",
)
# Only these paths are i18n keys *outside* of a call site.  Storage keys such as
# "copaw.navigation.trace" or "copaw.project.knowledge.trend.v1" live outside
# them, so restricting the roots keeps the scan from treating cache keys as copy.
LITERAL_KEY_RE = re.compile(
    r'["\']((?:copaw\.(?:projects|pipelines|rpa|workbench)|projects|knowledge)'
    r'\.[A-Za-z0-9_.]+?)["\']'
)

# Conflict-surface knife 72 (judgment 52): copy ownership follows the author of
# the *call-site line*, not the file that hosts it.  Asking that question needs
# upstream v2's blobs, which are not reachable from a clone of this fork, so the
# gate encodes the answer as this exemption list instead.  Every entry is a key
# whose only production reads are upstream's own lines: supplying fork copy at
# those paths would shadow upstream copy (judgment 44) or fix an upstream
# defect from the fork.  Upstream owns these; the fork does not gate on them.
UPSTREAM_OWNED_KEYS = {
    "common.all": "read from upstream's own line in pages/Agent/ACP/index.tsx",
    "common.operationFailed": "read from upstream's own line in pages/Inbox/index.tsx",
    "common.unknown": "read from upstream's own lines (chat surfaces)",
    "voiceTranscription.loadFailed": "read from upstream's own settings line",
    "skills.examples": "read only from a line upstream deleted in v2 (sync debt)",
}

CALL_RE = re.compile(r'(?<![A-Za-z0-9_$])(?:[A-Za-z0-9_]+\.)?t\(')
DESCRIPTOR_RE = re.compile(
    r'(?:i18nKey|labelI18nKey)\s*:\s*["\']([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)["\']'
)
KEYISH_RE = re.compile(r"^[a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$")
STRING_ARG_RE = re.compile(r'^["\']([^"\']+)["\']$')


def _matching_paren(text: str, open_index: int) -> int | None:
    depth, index, quote = 1, open_index, None
    while index < len(text):
        char = text[index]
        if quote:
            if char == "\\":
                index += 2
                continue
            if char == quote:
                quote = None
        elif char in "\"'`":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth == 0:
                return index
        index += 1
    return None


def _first_argument(argument_text: str) -> str:
    depth, index, quote = 0, 0, None
    while index < len(argument_text):
        char = argument_text[index]
        if quote:
            if char == "\\":
                index += 2
                continue
            if char == quote:
                quote = None
        elif char in "\"'`":
            quote = char
        elif char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif char == "," and depth == 0:
            break
        index += 1
    return argument_text[:index].strip()


def call_site_keys(path: Path) -> set[str]:
    text = path.read_text(encoding="utf-8")
    found = {match.group(1) for match in DESCRIPTOR_RE.finditer(text)}
    for match in CALL_RE.finditer(text):
        end = _matching_paren(text, match.end())
        if end is None:
            continue
        first = _first_argument(text[match.end():end])
        literal = STRING_ARG_RE.match(first)
        if literal and KEYISH_RE.match(literal.group(1)):
            found.add(literal.group(1))
    return found


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
            text = path.read_text(encoding="utf-8")
            for key in call_site_keys(path):
                found.setdefault(key, []).append(rel.as_posix())
            for match in LITERAL_KEY_RE.finditer(text):
                found.setdefault(match.group(1), []).append(rel.as_posix())
    return found


call_sites = production_translation_keys()
gated = sorted(key for key in call_sites if key not in UPSTREAM_OWNED_KEYS)
exempted = sorted(key for key in call_sites if key in UPSTREAM_OWNED_KEYS)
for lang in ("en", "zh"):
    available = resolvable_keys(lang)
    for key in gated:
        if key not in available:
            sites = ", ".join(sorted(set(call_sites[key])))
            errors.append(
                f"translation key {key} is read by production code but missing from the "
                f"{lang} bundle (sites: {sites})"
            )

en_overlay = overlay_keys("en")
zh_overlay = overlay_keys("zh")
for key in sorted(en_overlay - zh_overlay):
    errors.append(f"copaw overlay key exists in en but not zh: {key}")
for key in sorted(zh_overlay - en_overlay):
    errors.append(f"copaw overlay key exists in zh but not en: {key}")


def group_keys(group: str, lang: str) -> set[str]:
    path = CONSOLE_LOCALES / "copaw" / group / f"{lang}.json"
    return set() if not path.exists() else flatten(load_json(path))


def flatten_values(node: Any, prefix: str = "") -> dict[str, Any]:
    leaves: dict[str, Any] = {}
    for key, child in node.items():
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(child, dict):
            leaves.update(flatten_values(child, path))
        else:
            leaves[path] = child
    return leaves


def group_leaves(group: str, lang: str) -> dict[str, Any]:
    path = CONSOLE_LOCALES / "copaw" / group / f"{lang}.json"
    return {} if not path.exists() else flatten_values(load_json(path))


# The overlay ships full copy for en/zh only; ja, ru, pt-BR and id carry a
# partial copy and lean on i18next `fallbackLng`.  A leaf that exists in one of
# those four but not in en is copy no bundle can reach any more, and the en/zh
# checks above are blind to it -- that blindness is how knives 71 and 73 each
# left a batch behind (conflict-surface knife 74).  Lagging behind en is normal,
# leading it is not.
SECONDARY_LANGS = ("ja", "ru", "pt-BR", "id")
for group in OVERLAY_GROUPS:
    english = group_keys(group, "en")
    for lang in SECONDARY_LANGS:
        for key in sorted(group_keys(group, lang) - english):
            errors.append(
                f"copaw overlay group {group} ships {key} in {lang} but en has no such "
                f"leaf; a key the en overlay does not carry is unreachable copy"
            )

# Same blindness, other direction: a leaf whose text byte-equals the en leaf is
# not a translation.  `fallbackLng: "en"` already renders that exact string, so
# nothing can tell the leaf apart from its absence -- it is copy that inflates
# the fork's own locale files while pretending to be localized.  Conflict-surface
# knife 76 found 1,467 of them: every pipelines and rpa leaf in the four
# secondary languages, and 231 of the 259 projects leaves in each.
for group in OVERLAY_GROUPS:
    english = group_leaves(group, "en")
    for lang in SECONDARY_LANGS:
        for key, value in sorted(group_leaves(group, lang).items()):
            if isinstance(value, str) and english.get(key) == value:
                errors.append(
                    f"copaw overlay group {group} ships {key} in {lang} as a verbatim "
                    f"copy of the en leaf; secondary-language copy must be translated"
                )


def bare_overlay_keys(lang: str) -> set[str]:
    keys: set[str] = set()
    for group in OVERLAY_GROUPS:
        path = CONSOLE_LOCALES / "copaw" / group / f"{lang}.json"
        if path.exists():
            keys |= {k for k in flatten(load_json(path)) if not k.startswith("copaw.")}
    return keys


# addResourceBundle(lng, "translation", overlay, true, true) deep-merges, so a bare
# overlay root that matches an upstream base-locale path silently replaces upstream
# copy instead of adding fork copy.
for lang in ("en", "zh"):
    base_path = CONSOLE_LOCALES / f"{lang}.json"
    if not base_path.exists():
        continue
    shadowed = bare_overlay_keys(lang) & flatten(load_json(base_path))
    for key in sorted(shadowed):
        errors.append(
            f"copaw overlay key {key} shadows the same path in the upstream base locale "
            f"({lang}.json); overlay copy must stay additive"
        )

if errors:
    for item in errors:
        print(f"ERROR: {item}")
    sys.exit(1)

print(
    "CoPaw locale split check passed "
    f"({len(gated)} production gated keys, {len(en_overlay)} overlay keys en/zh, "
    f"{len(exempted)} upstream-owned keys exempted)"
)
