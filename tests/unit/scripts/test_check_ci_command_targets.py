# -*- coding: utf-8 -*-

from __future__ import annotations

import importlib.util
import json
from pathlib import Path


def _load_module():
    repo_root = Path(__file__).resolve().parents[3]
    name = "check_ci_command_targets"
    path = repo_root / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _write_workflow(root: Path, body: str) -> None:
    workflows = root / ".github" / "workflows"
    workflows.mkdir(parents=True)
    (workflows / "job.yml").write_text(body, encoding="utf-8")


def _write_package(root: Path, directory: str, scripts: list[str]) -> None:
    target = root / directory
    target.mkdir(parents=True)
    (target / "package.json").write_text(
        json.dumps({"scripts": {name: "echo ok" for name in scripts}}),
        encoding="utf-8",
    )


def test_a_workflow_calling_a_dropped_script_fails(tmp_path, capsys):
    """The exact regression this guard exists for (judgment 20)."""
    mod = _load_module()
    _write_workflow(
        tmp_path,
        "jobs:\n"
        "  vitest:\n"
        "    defaults:\n"
        "      run:\n"
        "        working-directory: console\n"
        "    steps:\n"
        "      - run: npm run test:run\n",
    )
    _write_package(tmp_path, "console", ["test"])

    assert mod.main(["--repo-root", str(tmp_path)]) == 1
    report = capsys.readouterr().out
    assert "npm run test:run" in report
    assert "console/package.json has no such script" in report


def test_inline_cd_selects_the_package_it_runners_in(tmp_path):
    mod = _load_module()
    _write_workflow(
        tmp_path,
        "jobs:\n"
        "  site:\n"
        "    defaults:\n"
        "      run:\n"
        "        working-directory: console\n"
        "    steps:\n"
        "      - run: cd website && pnpm run build\n"
        "      - run: npm run build\n",
    )
    _write_package(tmp_path, "console", ["build"])
    _write_package(tmp_path, "website", ["build"])

    assert mod.main(["--repo-root", str(tmp_path)]) == 0
    assert mod.collect(tmp_path) == [
        ("job.yml:site", "website", "build"),
        ("job.yml:site", "console", "build"),
    ]


def test_missing_package_json_is_an_error(tmp_path, capsys):
    mod = _load_module()
    _write_workflow(
        tmp_path,
        "jobs:\n"
        "  e2e:\n"
        "    steps:\n"
        "      - run: npm run smoke\n"
        "        working-directory: e2e\n",
    )

    assert mod.main(["--repo-root", str(tmp_path)]) == 1
    assert "e2e, which has no package.json" in capsys.readouterr().out


def test_this_repository_passes_the_guard():
    mod = _load_module()
    assert mod.main([]) == 0
