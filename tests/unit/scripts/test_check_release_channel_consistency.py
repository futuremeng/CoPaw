# -*- coding: utf-8 -*-
"""scripts/check_release_channel_consistency.py guards the six rules."""

from __future__ import annotations

import importlib.util
import json
import re
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
    # R6: the declaration plus every file that reads the installed
    # distribution by name.
    "pyproject.toml",
    "src/qwenpaw/cli/update_cmd.py",
    "scripts/pack/build_common.py",
    "scripts/pack/build_macos.sh",
    "scripts/pack/build_win.ps1",
)


def _module():
    path = REPO_ROOT / "scripts/check_release_channel_consistency.py"
    spec = importlib.util.spec_from_file_location(
        "check_release_channel_consistency",
        path,
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
        (root / "src/copaw/release_channel.json").read_text(encoding="utf-8"),
    )


def _write_fact(root: Path, data: dict) -> None:
    (root / "src/copaw/release_channel.json").write_text(
        json.dumps(data, indent=2) + "\n",
        encoding="utf-8",
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
    fixture_root,
    capsys,
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
    fixture_root,
    capsys,
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
            '"futuremeng/CoPaw"',
            '"someone/Else"',
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
        encoding="utf-8",
    )
    assert ".post" in text


# ------------------------------------------------------------------ R6
#
# The design says the phase-2 rename is one commit: ``[project] name`` plus
# every place that reads the installed distribution by that name.  A rename
# that lands only half of it is worse than no rename -- the wheel is published
# under the new name while the updater still polls the old one -- so the gate
# has to make the half state impossible.


def _declared(root):
    return _module().declared_distribution(root)


def _regenerate_ts(mod, root):
    path = root / "console/src/generated/releaseChannel.ts"
    path.write_text(mod.render_ts(_fact(root)), encoding="utf-8")


def _open_pypi_channel(mod, root):
    """Take ``pypi`` out of ``pending``, as phase 2 does."""
    data = _fact(root)
    data["pending"] = [name for name in data["pending"] if name != "pypi"]
    _write_fact(root, data)
    _regenerate_ts(mod, root)


def _rename_declaration(root, name):
    path = root / "pyproject.toml"
    text = path.read_text(encoding="utf-8").replace(
        'name = "qwenpaw"',
        f'name = "{name}"',
        1,
    )
    path.write_text(text, encoding="utf-8")


def _rename_every_reader(mod, root, old, new):
    """Rewrite every registered reader, the way phase 2 must."""
    for rel, template in mod.DISTRIBUTION_READERS:
        if "{distribution}" not in template:
            continue
        path = root / rel
        text = path.read_text(encoding="utf-8").replace(
            template.replace("{distribution}", old),
            template.replace("{distribution}", new),
        )
        path.write_text(text, encoding="utf-8")


def test_rule_six_reads_the_declared_name_from_pyproject(fixture_root):
    assert _declared(fixture_root) == "qwenpaw"


def test_rule_six_rejects_a_declaration_no_reader_can_be_checked_against(
    fixture_root,
    capsys,
):
    mod = _module()
    (fixture_root / "pyproject.toml").unlink()
    assert run(mod, fixture_root) == 1
    assert "R6:" in capsys.readouterr().out


def test_rule_six_rejects_a_rename_that_leaves_every_reader_behind(
    fixture_root,
    capsys,
):
    mod = _module()
    _open_pypi_channel(mod, fixture_root)
    _rename_declaration(fixture_root, "copaw-community")
    assert run(mod, fixture_root) == 1
    out = capsys.readouterr().out
    assert "R6:" in out
    assert "scripts/pack/build_macos.sh" in out


def test_rule_six_rejects_a_rename_that_leaves_one_reader_behind(
    fixture_root,
    capsys,
):
    mod = _module()
    _open_pypi_channel(mod, fixture_root)
    _rename_declaration(fixture_root, "copaw-community")
    _rename_every_reader(mod, fixture_root, "qwenpaw", "copaw-community")
    # Undo exactly one registered reader: the rename is now half-landed.
    path = fixture_root / "scripts/pack/build_common.py"
    path.write_text(
        path.read_text(encoding="utf-8").replace(
            "copaw-community-*.whl",
            "qwenpaw-*.whl",
        ),
        encoding="utf-8",
    )
    assert run(mod, fixture_root) == 1
    out = capsys.readouterr().out
    assert "R6:" in out and "build_common.py" in out


def test_rule_six_accepts_the_complete_rename(fixture_root):
    """The gate must not be the reason phase 2 skips the readers."""
    mod = _module()
    _open_pypi_channel(mod, fixture_root)
    _rename_declaration(fixture_root, "copaw-community")
    _rename_every_reader(mod, fixture_root, "qwenpaw", "copaw-community")
    assert run(mod, fixture_root) == 0


def test_rule_six_rejects_a_reader_renamed_ahead_of_the_declaration(
    fixture_root,
    capsys,
):
    mod = _module()
    path = fixture_root / "scripts/pack/build_macos.sh"
    path.write_text(
        path.read_text(encoding="utf-8").replace(
            "version('qwenpaw')",
            "version('copaw-community')",
        ),
        encoding="utf-8",
    )
    assert run(mod, fixture_root) == 1
    out = capsys.readouterr().out
    assert "R6:" in out and "build_macos.sh" in out


def test_rule_six_rejects_a_third_name_while_the_channel_is_still_pending(
    fixture_root,
    capsys,
):
    """``copaw`` is upstream's pre-rename package on PyPI (design §3), so
    declaring it while our own channel is unopened publishes under a name
    that belongs to someone else."""
    mod = _module()
    _rename_declaration(fixture_root, "copaw")
    assert run(mod, fixture_root) == 1
    assert "while the pypi channel is pending" in capsys.readouterr().out


def test_rule_six_rejects_an_opened_channel_that_left_the_declaration_out(
    fixture_root,
    capsys,
):
    """Dropping ``pypi`` from ``pending`` is phase 2's opening move; it must
    not be possible while the wheel is still declared under upstream's name."""
    mod = _module()
    _open_pypi_channel(mod, fixture_root)
    assert run(mod, fixture_root) == 1
    assert "no longer pending" in capsys.readouterr().out


def test_rule_six_rejects_an_unregistered_reader(fixture_root, capsys):
    """A new read point must join the registry in the same commit."""
    mod = _module()
    path = fixture_root / "src/copaw/sidecar_reader.py"
    path.write_text(
        (
            "from importlib.metadata import version\n\n"
            "INSTALLED = version('qwenpaw')\n"
        ),
        encoding="utf-8",
    )
    assert run(mod, fixture_root) == 1
    out = capsys.readouterr().out
    assert "R6:" in out and "sidecar_reader.py" in out


def test_the_live_read_points_are_exactly_the_registered_ones():
    """The registry is the whole table, not a list someone remembered.

    Design §3 row 9 once claimed two read points; a scan of the tree finds
    eleven read points plus the declaration, in five files.  This is what
    keeps that class of claim honest: an
    unregistered reader or a stale registry entry fails here even while every
    red case above still passes.
    """
    mod = _module()
    declared = _declared(REPO_ROOT)
    hits = {rel for rel, _ in mod.scan_distribution_readers(REPO_ROOT)}
    registered = {rel for rel, _ in mod.DISTRIBUTION_READERS}
    assert hits == registered
    for rel, template in mod.DISTRIBUTION_READERS:
        literal = template.replace("{distribution}", declared)
        text = (REPO_ROOT / rel).read_text(encoding="utf-8")
        assert literal in text, f"{rel} no longer contains {literal!r}"


def test_the_live_sweep_pinpoints_every_registered_line():
    """File-set equality is not enough -- the sweep must find each *line*.

    A pattern that matches a wider prefix than the identity swallows the real
    hit: ``qwenpaw-$CurrentVersion-*.whl`` inside ``Join-Path $Dist "..."``
    matched on ``Join`` first, so the two wheel read points in
    ``build_win.ps1`` went unswept while their *file* still looked registered.
    Pinned line by line, an unanchored sweep can no longer report a smaller
    table than the registry.
    """
    mod = _module()
    declared = _declared(REPO_ROOT)
    expected = set()
    for rel, template in mod.DISTRIBUTION_READERS:
        if rel == mod.PYPROJECT_REL:
            continue
        literal = template.replace("{distribution}", declared)
        text = (REPO_ROOT / rel).read_text(encoding="utf-8")
        expected.update(
            (rel, lineno)
            for lineno, line in enumerate(text.splitlines(), 1)
            if literal in line
        )
    swept = set()
    for rel, description in mod.scan_distribution_readers(REPO_ROOT):
        match = re.match(r"^line (\d+):", description)
        if match:
            swept.add((rel, int(match.group(1))))
    assert swept == expected
