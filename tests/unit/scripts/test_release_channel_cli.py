# -*- coding: utf-8 -*-
"""scripts/release_channel.py renders the fact source for each reader."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]


def _module():
    path = REPO_ROOT / "scripts/release_channel.py"
    spec = importlib.util.spec_from_file_location("release_channel_cli", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _fact():
    return json.loads(
        (REPO_ROOT / "src/copaw/release_channel.json").read_text(
            encoding="utf-8"
        )
    )


def test_print_emits_the_fact_source_verbatim(tmp_path, capsys):
    mod = _module()
    assert mod.main(["--print"]) == 0
    assert json.loads(capsys.readouterr().out) == _fact()


def test_sh_exports_one_assignment_per_line(capsys):
    mod = _module()
    assert mod.main(["--sh"]) == 0
    lines = capsys.readouterr().out.strip().splitlines()
    assert all(line.startswith("export RELEASE_") for line in lines)
    names = [line.split()[1].split("=")[0] for line in lines]
    assert names == [
        "RELEASE_DISTRIBUTION",
        "RELEASE_PYPI_PROJECT",
        "RELEASE_UPSTREAM_VERSION",
        "RELEASE_GITHUB_REPOSITORY",
        "RELEASE_DOCKER_NAMESPACE",
        "RELEASE_DOWNLOAD_CDN",
        "RELEASE_ASSET_WINDOWS",
        "RELEASE_ASSET_MACOS",
        "RELEASE_PENDING",
        "RELEASE_RELEASES_URL",
    ]
    joined = "\n".join(lines)
    assert "export RELEASE_DISTRIBUTION=copaw" in joined
    assert "export RELEASE_PENDING=pypi,docker,cdn" in joined
    assert (
        "export RELEASE_RELEASES_URL="
        "https://github.com/futuremeng/CoPaw/releases" in joined
    )
    # Unready channels export as empty, and never as an upstream address.
    assert "export RELEASE_DOCKER_NAMESPACE=" in joined
    assert "agentscope" not in joined


def test_gh_env_appends_without_export(tmp_path, monkeypatch):
    env_file = tmp_path / "github_env"
    env_file.write_text("", encoding="utf-8")
    monkeypatch.setenv("GITHUB_ENV", str(env_file))
    mod = _module()
    assert mod.main(["--gh-env"]) == 0
    written = env_file.read_text(encoding="utf-8")
    assert "RELEASE_DISTRIBUTION=copaw\n" in written
    assert "export " not in written


def test_gh_env_without_the_variable_is_an_error(monkeypatch, capsys):
    monkeypatch.delenv("GITHUB_ENV", raising=False)
    mod = _module()
    assert mod.main(["--gh-env"]) == 1
    assert "GITHUB_ENV" in capsys.readouterr().out


def test_write_ts_renders_the_generated_module(tmp_path):
    mod = _module()
    out = tmp_path / "releaseChannel.ts"
    assert mod.main(["--write-ts", "--out", str(out)]) == 0
    text = out.read_text(encoding="utf-8")
    assert text == mod.render_ts(_fact())
    assert "Do not edit by hand" in text


def test_render_ts_is_prettier_stable():
    """The committed file is checked by `prettier --check`, so the renderer
    has to emit exactly the shape prettier keeps (unquoted keys, trailing
    commas).  Verified against prettier 3.0.0."""
    mod = _module()
    body = mod.render_ts(_fact())
    for line in body.splitlines():
        assert not line.startswith("  \""), line
