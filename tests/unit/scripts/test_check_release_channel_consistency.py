# -*- coding: utf-8 -*-
"""scripts/check_release_channel_consistency.py guards the seven rules."""

from __future__ import annotations

import importlib.util
import json
import re
import shutil
import tomllib
from pathlib import Path

import pytest
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

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
    """A copy of the live tree: every red below is a real regression.

    The file list is derived from the gate's own registries, so a rule that
    starts reading a new file is a fixture that copies it -- the alternative is
    a red that comes from the fixture being thin instead of the tree.
    """
    mod = _module()
    root = tmp_path / "repo"
    rels = (
        set(FIXTURE_FILES)
        | {rel for rel, _ in mod.DISTRIBUTION_READERS}
        | {rel for rel, _ in mod.REQUIREMENT_SITES}
    )
    for rel in sorted(rels):
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
    text, count = re.subn(
        r'^name\s*=\s*"[^"]+"',
        f'name = "{name}"',
        path.read_text(encoding="utf-8"),
        count=1,
        flags=re.MULTILINE,
    )
    assert count == 1, "the [project] name line disappeared"
    path.write_text(text, encoding="utf-8")


def _rename_every_reader(mod, root, old, new):
    """Rewrite every registered reader and requirement site, the way a
    rename must."""
    for rel, template in mod.DISTRIBUTION_READERS:
        if rel == mod.PYPROJECT_REL:
            continue
        path = root / rel
        text = path.read_text(encoding="utf-8").replace(
            mod.reader_literal(template, old),
            mod.reader_literal(template, new),
        )
        path.write_text(text, encoding="utf-8")
    spellings = (
        (old, new),
        (mod.wheel_name(old), mod.wheel_name(new)),
    )
    for rel, _category in mod.REQUIREMENT_SITES:
        path = root / rel
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        for source, target in spellings:
            text = text.replace(source, target)
        path.write_text(text, encoding="utf-8")


def test_rule_six_reads_the_declared_name_from_pyproject(fixture_root):
    assert _declared(fixture_root) == "copaw-community"


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
    """The shape phase 2 must never land in: the wheel is declared under our
    own name while the build scripts still glob upstream's."""
    mod = _module()
    _rename_every_reader(mod, fixture_root, "copaw-community", "qwenpaw")
    assert run(mod, fixture_root) == 1
    out = capsys.readouterr().out
    assert "R6:" in out
    assert "scripts/pack/build_macos.sh" in out


def test_rule_six_rejects_a_rename_that_leaves_one_reader_behind(
    fixture_root,
    capsys,
):
    mod = _module()
    path = fixture_root / "scripts/pack/build_common.py"
    stale = mod.reader_literal("{wheel_name}-*.whl", "qwenpaw")
    live = mod.reader_literal("{wheel_name}-*.whl", "copaw-community")
    path.write_text(
        path.read_text(encoding="utf-8").replace(live, stale),
        encoding="utf-8",
    )
    assert run(mod, fixture_root) == 1
    out = capsys.readouterr().out
    assert "R6:" in out and "build_common.py" in out


def test_rule_six_accepts_the_complete_rename(fixture_root):
    """Both poles are legal, and the rename between them is one commit: the
    gate may not be the reason phase 2 skips the readers."""
    mod = _module()
    _rename_declaration(fixture_root, "qwenpaw")
    _rename_every_reader(mod, fixture_root, "copaw-community", "qwenpaw")
    assert run(mod, fixture_root) == 0
    _rename_declaration(fixture_root, "copaw-community")
    _rename_every_reader(mod, fixture_root, "qwenpaw", "copaw-community")
    assert run(mod, fixture_root) == 0


def test_rule_six_rejects_a_reader_renamed_ahead_of_the_declaration(
    fixture_root,
    capsys,
):
    mod = _module()
    _rename_declaration(fixture_root, "qwenpaw")
    _rename_every_reader(mod, fixture_root, "copaw-community", "qwenpaw")
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
    _rename_declaration(fixture_root, "qwenpaw")
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
            "INSTALLED = version('copaw-community')\n"
        ),
        encoding="utf-8",
    )
    assert run(mod, fixture_root) == 1
    out = capsys.readouterr().out
    assert "R6:" in out and "sidecar_reader.py" in out


def test_the_registry_names_a_wheel_file_in_its_normalized_form():
    """A wheel filename is not the declared name: PEP 427 rewrites ``-`` to
    ``_`` when ``build_wheel`` names the artifact and the ``.dist-info``
    directory, so ``copaw-community`` ships as ``copaw_community-1.0.whl``.

    Phase 2 renames five glob/filename read points, and two metadata reads that
    ``importlib.metadata`` resolves regardless of spelling.  Substituting the
    declared name into all ten templates would make the gate demand a filename
    the build can never produce, so the registry has to say which shape each
    point is in.
    """
    mod = _module()
    assert (
        mod.reader_literal("{wheel_name}-*.whl", "copaw-community")
        == "copaw_community-*.whl"
    )
    assert (
        mod.reader_literal('name = "{distribution}"', "copaw-community")
        == 'name = "copaw-community"'
    )


def test_the_sweep_finds_a_reader_in_its_normalized_form(fixture_root):
    """An unregistered underscored wheel reader must still be reported."""
    mod = _module()
    path = fixture_root / "scripts/pack/build_extra.sh"
    path.write_text(
        'whls=("${REPO_ROOT}/dist/copaw_community-${V}-"*.whl)\n',
        encoding="utf-8",
    )
    hits = {rel for rel, _ in mod.scan_distribution_readers(fixture_root)}
    assert "scripts/pack/build_extra.sh" in hits


def test_the_sweep_still_sees_upstreams_old_distribution_name(
    fixture_root,
    capsys,
):
    """The rename moves our tracked identities off ``qwenpaw``, so tracking
    only the new names would sweep a resurrected upstream read point as an
    unknown token and let it pass -- and a merge is exactly how one comes back,
    in a file the registry has never seen."""
    mod = _module()
    path = fixture_root / "scripts/pack/build_linux.sh"
    path.write_text(
        'whls=("${REPO_ROOT}/dist/qwenpaw-${V}-"*.whl)\n',
        encoding="utf-8",
    )
    assert run(mod, fixture_root) == 1
    out = capsys.readouterr().out
    assert "R6:" in out and "build_linux.sh" in out


def test_the_live_tree_has_no_read_point_naming_the_old_distribution():
    """Watching the retired name is free only while the rename is complete;
    this is the reading that says so, and the reading that goes red the day a
    merge brings one back."""
    mod = _module()
    hits = [desc for _, desc in mod.scan_distribution_readers(REPO_ROOT)]
    assert not [desc for desc in hits if "qwenpaw" in desc]


def test_the_live_tree_ships_under_our_own_pypi_name():
    """Phase 2's rename half is landed: nothing we build may declare
    upstream's name, because a wheel named ``qwenpaw`` is a package nobody
    installed asked for and it shadows the real project on the same machine."""
    declared = _declared(REPO_ROOT)
    fact = json.loads(
        (REPO_ROOT / "src/copaw/release_channel.json").read_text(
            encoding="utf-8",
        ),
    )
    assert declared == fact["pypi_project"]


def test_the_pypi_channel_stays_pending_until_the_package_exists():
    """The other half of phase 2 is the publish, and that waits for a stable
    version.  While the name is renamed but unpublished, ``copaw update`` must
    keep refusing: a released ``copaw-community`` would make the fact source
    lie and the updater install something no one verified."""
    fact = json.loads(
        (REPO_ROOT / "src/copaw/release_channel.json").read_text(
            encoding="utf-8",
        ),
    )
    assert "pypi" in fact["pending"]


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
        literal = mod.reader_literal(template, declared)
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
        literal = mod.reader_literal(template, declared)
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


def _declared_requirements(pyproject_text: str) -> list[str]:
    document = tomllib.loads(pyproject_text)["project"]
    requirements = list(document.get("dependencies", []))
    for extras in document.get("optional-dependencies", {}).values():
        requirements.extend(extras)
    return requirements


def test_no_dependency_declares_the_retired_distribution():
    """A self-reference is a dependency on somebody else once we rename.

    ``full = ["qwenpaw[qwenpaw-data,hub,...]"]`` was satisfied by the project
    being installed while the declaration still read ``qwenpaw`` (proved in CI:
    run 38232407961 job 114754874690 resolves it as
    ``...extra == "qwenpaw-data"->qwenpaw==2.2.2b4.post1`` and downloads no
    ``qwenpaw`` artifact).  After ``pyproject.toml`` declares
    ``copaw-community`` the same string is a PyPI dependency on the upstream
    distribution, whose per-version ``agentscope`` pins exclude ours.  That is
    why every job of the upstream ``Tests`` workflow died in
    ``Install dependencies`` from run 38333158948 on.
    """
    mod = _module()
    retired = canonicalize_name(mod.PRE_RENAME_DECLARATION)
    offenders = [
        raw
        for raw in _declared_requirements(
            (REPO_ROOT / mod.PYPROJECT_REL).read_text(encoding="utf-8"),
        )
        if canonicalize_name(Requirement(raw).name) == retired
    ]
    assert offenders == [], (
        f"{mod.PYPROJECT_REL} still requires the retired distribution name: "
        f"{offenders}"
    )


def test_rule_seven_rejects_a_dependency_on_the_retired_distribution(
    fixture_root,
    capsys,
):
    mod = _module()
    path = fixture_root / "pyproject.toml"
    path.write_text(
        path.read_text(encoding="utf-8").replace(
            '"copaw-community[sip]"',
            '"qwenpaw[sip]"',
        ),
        encoding="utf-8",
    )
    assert run(mod, fixture_root) == 1
    assert "R7:" in capsys.readouterr().out


def test_rule_seven_accepts_the_pre_rename_self_reference(
    fixture_root,
    capsys,
):
    """The same string is legitimate while the declaration reads ``qwenpaw``.

    R7 compares a requirement against the *declared* name, so a merge that
    replays the pre-rename spelling (the two state R6 already has to tolerate)
    stays green instead of demanding a third identity.
    """
    mod = _module()
    _rename_declaration(fixture_root, "qwenpaw")
    _rename_every_reader(mod, fixture_root, "copaw-community", "qwenpaw")
    path = fixture_root / "pyproject.toml"
    path.write_text(
        path.read_text(encoding="utf-8").replace(
            '"copaw-community[',
            '"qwenpaw[',
        ),
        encoding="utf-8",
    )
    assert run(mod, fixture_root) == 0, capsys.readouterr().out


def test_rule_seven_refuses_to_scan_nothing(fixture_root, capsys):
    """A scan whose input regions moved would otherwise pass by finding zero.

    ``dependencies`` can become ``dynamic``, or the extras can be retabled;
    either edit silences R7 unless the rule asserts it actually read a
    requirement.
    """
    mod = _module()
    path = fixture_root / "pyproject.toml"
    text = path.read_text(encoding="utf-8")
    text = text[: text.index("[project.optional-dependencies]")]
    path.write_text(
        re.sub(r"(?ms)^dependencies = \[.*?^\]", "", text),
        encoding="utf-8",
    )
    assert run(mod, fixture_root) == 1
    assert "R7:" in capsys.readouterr().out


def test_rule_eight_rejects_an_unregistered_requirement_site(
    fixture_root,
    capsys,
):
    """A new ``pip install qwenpaw[extra]``-shaped string is a new read point.

    Knife 119 renamed the distribution and knife 129 fixed the two declarations
    that were found by hand; both times the sites that kept naming the retired
    distribution were in files no scan root covered.  R8 covers the whole
    requirement shape, so a file that starts requiring one of our identities
    has to say so in ``REQUIREMENT_SITES`` in the same commit.
    """
    mod = _module()
    path = fixture_root / "scripts/pack/setup_extra.sh"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('pip install "qwenpaw[hub]"\n', encoding="utf-8")
    assert run(mod, fixture_root) == 1
    out = capsys.readouterr().out
    assert "R8:" in out and "setup_extra.sh" in out


def test_rule_eight_rejects_an_install_site_naming_another_distribution(
    fixture_root,
    capsys,
):
    mod = _module()
    path = fixture_root / "src/qwenpaw/cli/update_cmd.py"
    text = path.read_text(encoding="utf-8")
    assert "copaw-community=={" in text
    path.write_text(
        text.replace("copaw-community=={", "qwenpaw=={"),
        encoding="utf-8",
    )
    assert run(mod, fixture_root) == 1
    out = capsys.readouterr().out
    assert "R8:" in out and "update_cmd.py" in out


def test_rule_eight_refuses_to_scan_nothing(fixture_root, capsys):
    """A registered site that silently stopped matching is a moved scan root.

    R8 is only worth having if it notices the day the requirement shape is
    written differently (a variable name, a retabled file) and the sweep starts
    finding zero while still reporting success.
    """
    mod = _module()
    (fixture_root / "src/qwenpaw/cli/update_cmd.py").unlink()
    assert run(mod, fixture_root) == 1
    out = capsys.readouterr().out
    assert "R8:" in out and "update_cmd.py" in out


def test_no_install_path_requires_a_distribution_we_do_not_declare():
    """The live-tree reading: a direct-URL requirement names its own wheel.

    ``pip`` refuses an artifact whose ``.dist-info`` name does not start with
    the requirement's own name, which is why ``build_common.py`` asking for
    ``qwenpaw[full] @ <copaw_community wheel>`` fails with::

        ERROR: qwenpaw has an invalid wheel, .dist-info directory
        'copaw_community-2.2.2b4.post1.dist-info' does not start with 'qwenpaw'
    """
    mod = _module()
    declared = mod.declared_distribution(REPO_ROOT)
    allowed = {declared, mod.wheel_name(declared)}
    install = {
        rel for rel, category in mod.REQUIREMENT_SITES if category == "install"
    }
    offenders = {
        (rel, name)
        for rel, names in mod.scan_requirement_names(REPO_ROOT).items()
        if rel in install
        for name in names
        if name not in allowed
    }
    assert offenders == set(), (
        f"install paths naming a distribution other than {sorted(allowed)}: "
        f"{sorted(offenders)}"
    )
