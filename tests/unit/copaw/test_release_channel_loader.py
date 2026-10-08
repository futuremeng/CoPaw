# -*- coding: utf-8 -*-
"""The fact source is the only place a channel address is written."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
JSON_PATH = REPO_ROOT / "src/copaw/release_channel.json"


def _loader():
    path = REPO_ROOT / "src/copaw/release_channel.py"
    spec = importlib.util.spec_from_file_location("_rc_loader", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def rc():
    return _loader()


@pytest.fixture(scope="module")
def data():
    return json.loads(JSON_PATH.read_text(encoding="utf-8"))


def test_fact_source_has_exactly_the_declared_fields(rc, data):
    assert set(data) == {
        "distribution",
        "pypi_project",
        "upstream_version",
        "docker_namespace",
        "github_repository",
        "download_cdn",
        "assets",
        "pending",
    }
    assert set(data["assets"]) == {"windows", "macos"}


def test_declared_channels_are_the_pending_names(rc, data):
    assert set(rc.CHANNELS) == {"pypi", "docker", "cdn"}
    assert set(data["pending"]) <= set(rc.CHANNELS)


def test_phase_one_has_no_ready_channel(rc, data):
    for channel in rc.CHANNELS:
        assert rc.is_ready(data, channel) is False


def test_unready_channel_reads_none_not_empty_string(rc, data):
    assert rc.address(data, "docker") is None
    assert rc.address(data, "cdn") is None


def test_pypi_name_exists_while_pending(rc, data):
    assert rc.is_ready(data, "pypi") is False
    assert data["pypi_project"] == "copaw-community"
    # Upstream owns the bare `copaw` project on PyPI (their pre-rename
    # distribution, last uploaded 2026-04-09), so the PyPI name must never
    # collapse back onto the program name.
    assert data["pypi_project"] != data["distribution"]


def test_urls_derive_from_the_repository_field(rc, data):
    assert rc.repository_url(data) == "https://github.com/futuremeng/CoPaw"
    assert (
        rc.releases_url(data)
        == "https://github.com/futuremeng/CoPaw/releases"
    )


def test_asset_names_interpolate_the_version(rc, data):
    assert (
        rc.asset_name(data, "windows", "1.1.11b1.post1")
        == "CoPaw-Setup-1.1.11b1.post1.exe"
    )
    assert (
        rc.asset_name(data, "macos", "1.1.11b1.post1")
        == "CoPaw-1.1.11b1.post1-macOS.zip"
    )


def test_ready_channel_exposes_its_address(rc, tmp_path):
    """Two-state proof without a ready channel in the tree yet."""
    ready = json.loads(JSON_PATH.read_text(encoding="utf-8"))
    ready["pending"] = []
    ready["docker_namespace"] = "ghcr.io/futuremeng"
    ready["download_cdn"] = "https://cdn.example.invalid/copaw"
    path = tmp_path / "release_channel.json"
    path.write_text(json.dumps(ready), encoding="utf-8")

    data = rc.load(path)
    assert rc.is_ready(data, "docker") is True
    assert rc.address(data, "docker") == "ghcr.io/futuremeng"
    assert rc.address(data, "cdn") == "https://cdn.example.invalid/copaw"


def test_package_data_ships_the_fact_source():
    text = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    section = text.split("[tool.setuptools.package-data]")[1]
    section = section.split("[build-system]")[0]
    assert '"copaw"' in section
    assert "release_channel.json" in section


def test_version_still_comes_from_the_upstream_version_module():
    text = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert 'version = {attr = "qwenpaw.__version__.__version__"}' in text
