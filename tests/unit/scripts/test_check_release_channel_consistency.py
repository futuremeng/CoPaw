# -*- coding: utf-8 -*-
"""scripts/check_release_channel_consistency.py guards the five rules."""

from __future__ import annotations

import importlib.util
import json
import shutil
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]

FIXTURE_FILES = (
    "src/copaw/release_channel.json",
    "src/copaw/release_channel.py",
    "src/copaw/cli/update_cmd.py",
    "scripts/install.sh",
    "scripts/install.ps1",
    "scripts/install.bat",
    "console/src/layouts/constants.ts",
    "console/src/generated/releaseChannel.ts",
    "src/qwenpaw/__version__.py",
)


def _module():
    path = REPO_ROOT / "scripts/check_release_channel_consistency.py"
    spec = importlib.util.spec_from_file_location(
        "check_release_channel_consistency", path
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def fixture_root(tmp_path):
    """A copy of the live tree: every red below is a real regression."""
    root = tmp_path / "repo"
    for rel in FIXTURE_FILES:
        source = REPO_ROOT / rel
        assert source.exists(), f"fixture source missing: {rel}"
        target = root / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    return root


def _fact(root: Path) -> dict:
    return json.loads(
        (root / "src/copaw/release_channel.json").read_text(encoding="utf-8")
    )


def _write_fact(root: Path, data: dict) -> None:
    (root / "src/copaw/release_channel.json").write_text(
        json.dumps(data, indent=2) + "\n", encoding="utf-8"
    )


def run(mod, root):
    return mod.main(["--repo-root", str(root)])


def test_rule_one_rejects_an_unknown_pending_name(fixture_root, capsys):
    mod = _module()
    data = _fact(fixture_root)
    data["pending"] = ["pypii", "docker", "cdn"]
    _write_fact(fixture_root, data)
    assert run(mod, fixture_root) == 1
    assert "R1:" in capsys.readouterr().out


def test_rule_one_rejects_an_empty_distribution_name(fixture_root, capsys):
    mod = _module()
    data = _fact(fixture_root)
    data["pypi_project"] = ""
    _write_fact(fixture_root, data)
    assert run(mod, fixture_root) == 1
    assert "R1:" in capsys.readouterr().out


def test_rule_two_rejects_a_ready_channel_without_address(
    fixture_root, capsys
):
    mod = _module()
    data = _fact(fixture_root)
    data["pending"] = ["pypi", "cdn"]  # docker ready, field still null
    _write_fact(fixture_root, data)
    assert run(mod, fixture_root) == 1
    assert "R2:" in capsys.readouterr().out


def test_rule_two_rejects_a_pending_channel_with_address(fixture_root, capsys):
    mod = _module()
    data = _fact(fixture_root)
    data["docker_namespace"] = "ghcr.io/futuremeng"
    _write_fact(fixture_root, data)
    assert run(mod, fixture_root) == 1
    assert "R2:" in capsys.readouterr().out


def test_rule_three_rejects_an_upstream_clone_source(fixture_root, capsys):
    mod = _module()
    path = fixture_root / "scripts/install.sh"
    text = path.read_text(encoding="utf-8").replace(
        "https://github.com/futuremeng/CoPaw.git",
        "https://github.com/agentscope-ai/QwenPaw.git",
    )
    path.write_text(text, encoding="utf-8")
    assert run(mod, fixture_root) == 1
    out = capsys.readouterr().out
    assert "R3:" in out and "agentscope-ai/QwenPaw" in out


def test_rule_three_rejects_an_installer_without_our_releases_page(
    fixture_root, capsys
):
    mod = _module()
    path = fixture_root / "scripts/install.bat"
    text = path.read_text(encoding="utf-8").replace(
        "https://github.com/futuremeng/CoPaw/releases",
        "https://example.invalid/releases",
    )
    path.write_text(text, encoding="utf-8")
    assert run(mod, fixture_root) == 1
    out = capsys.readouterr().out
    assert "R3:" in out and "install.bat" in out


def test_rule_three_needs_every_covered_file(fixture_root, capsys):
    mod = _module()
    (fixture_root / "console/src/generated/releaseChannel.ts").unlink()
    assert run(mod, fixture_root) == 1
    assert "missing" in capsys.readouterr().out


def test_rule_four_rejects_a_stale_generated_file(fixture_root, capsys):
    mod = _module()
    path = fixture_root / "console/src/generated/releaseChannel.ts"
    path.write_text(
        path.read_text(encoding="utf-8").replace(
            '"futuremeng/CoPaw"', '"someone/Else"'
        ),
        encoding="utf-8",
    )
    assert run(mod, fixture_root) == 1
    assert "R4:" in capsys.readouterr().out


def test_this_repository_passes_the_guard():
    """The gate runs in unit-tests.yml, so the live tree must be clean."""
    assert _module().main([]) == 0


def _set_version(root: Path, number: str) -> None:
    (root / "src/qwenpaw/__version__.py").write_text(
        f'# -*- coding: utf-8 -*-\n__version__ = "{number}"\n',
        encoding="utf-8",
    )


def test_rule_five_rejects_a_foreign_upstream_number(fixture_root, capsys):
    mod = _module()
    _set_version(fixture_root, "2.0.0")
    assert run(mod, fixture_root) == 1
    assert "R5:" in capsys.readouterr().out


def test_rule_five_accepts_a_post_release(fixture_root):
    mod = _module()
    fact = _fact(fixture_root)
    _set_version(fixture_root, f"{fact['upstream_version']}.post3")
    assert run(mod, fixture_root) == 0


def test_our_channel_number_carries_a_post_release():
    """CoPaw ships upstream's number plus its own suffix (design §5), so the
    distributed version can never equal the upstream build."""
    text = (REPO_ROOT / "src/qwenpaw/__version__.py").read_text(
        encoding="utf-8"
    )
    assert ".post" in text
