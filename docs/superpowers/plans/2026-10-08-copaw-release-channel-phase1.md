# CoPaw 发布渠道（阶段 1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax of tracking.

**Goal:** 把 CoPaw 的六个对外分发身份（PyPI 包名 / Docker 命名空间 / Releases 仓库 / 下载 CDN / 更新检查源 / 产物文件名）收拢到一个事实源 JSON，并让 CLI、前端、安装脚本、CI 四类读取方都从它取值；同时把"照着官方步骤装错产品"这条路径彻底封掉。

**Architecture:** 一份 `src/copaw/release_channel.json`（落在 D-16 排除目录，零冲突宿主）+ 一个按路径加载的小 loader。Python 侧走 `copaw` 自有 overlay 模块；CI 与 checkout 型 shell 走 `scripts/release_channel.py` 的四种输出；前端走提交进仓库的生成文件 `console/src/generated/releaseChannel.ts`。安装脚本是 `curl … | bash` 的入口，运行时既没有 checkout 也没有 Python，所以它取字面值，由新门禁保证字面值与事实源一致。`pending` 数组是唯一的可用性位：未就绪的渠道读出 `None`，任何读取方都不许把"空"当成"去查上游"。

**Tech Stack:** Python 3.10（`json` + `importlib.util` + `packaging.version`，**没有 `tomllib`**）、click、pytest、TypeScript + React + vitest、bash / PowerShell / 批处理、GitHub Actions。

**Spec:** `docs/superpowers/specs/2026-10-07-copaw-release-channel-design.md`（分支 `wp/integration`，提交 `a8eced206`，用户已复审通过，§9 五项待裁全部按建议答案采纳）。本计划**只覆盖阶段 1**；阶段 2 / 阶段 3 在文末只写接口，不写步骤。

---

## 全局约束（每个任务都默认包含这一节）

- **不改** Python import 名、`QWENPAW_*` 环境变量、`~/.qwenpaw` 数据目录、上游 console script `qwenpaw`（设计 §3）。
- **任何文案不得承诺"从 PyPI 安装 CoPaw"**：PyPI / Docker / CDN 三个账号都没开（设计前置决定 ③），就绪前 `pending` 必须含 `pypi` / `docker` / `cdn`。
- **版本政策**：跟上游同号 + 自加 `.postN`。事实源里的 `upstream_version` 是"我们最后一次真同步进来的上游号"，不是上游当前号（上游现在是 `2.2.1`）。
- **册的口径**：`src/copaw/` 是 D-16 排除目录 ⇒ 新文件零宿主。阶段 1 的净定价是**冲突宿主 +1**，只有 `src/qwenpaw/__version__.py` 一行；其余被改的上游文件（`pyproject.toml`、`console/src/layouts/constants.ts`、`scripts/install.{sh,ps1,bat}`）都已在册，只加行。
- **证红落点**：门禁的红必须在 `/tmp` 的全树副本或 fixture 里证，**不在工作树里制造临时的红**。
- **恢复临时改动用 Edit**，禁止 `git checkout` / `git restore` / `git stash` / `git clean`。
- **不往共享 venv 里装任何东西**（`/Users/futuremeng/github/futuremeng/CoPaw/.venv` 与隔壁 `CoPaw` 检出共用），不 `pip install -e .`，不 `git fetch`，不开 PR，不强推，不合并上游。
- 本 worktree 跑 Python 测试必须带 `PYTHONPATH`，否则解析到兄弟树的 `src/qwenpaw`。

### 命令口径（逐字照抄，别换解释器）

```bash
# 仓库根
cd /Users/futuremeng/github/futuremeng/CoPaw-wp14
VENV=/Users/futuremeng/github/futuremeng/CoPaw/.venv/bin/python

# Python 单测（必须带 PYTHONPATH）
PYTHONPATH=$PWD/src $VENV -m pytest tests/unit/<path>::<test> -q

# 前端类型检查 / 前端测试（vitest 生效配置是 fork 自有 console/vitest.config.ts）
cd console && npx tsc -b --force; echo "rc=$?"
cd console && npm run test:run; echo "rc=$?"        # 裸跑，不要用管道掩 $?

# 品牌账册 / P1 读数（一律现算，别信 p1_baseline.json 的历史值）
$VENV scripts/copaw_brand.py verify
$VENV scripts/check_p1_invariants.py --json --target-ref HEAD

# lint（scripts/* 被 exclude 排除，src/copaw/** 要过）
$VENV -m flake8 --extend-ignore=E203 <file>
```

`scripts/` 下的 Python 文件不受 `.flake8` 的 `exclude` 约束，但仍写 ≤79 列；`src/copaw/**` 必须过 flake8。

---

## 与设计文档的四处偏离（已核对代码，按计划为准；执行时不要再"顺手修正"）

1. **设计 §4 把安装脚本列为 `--sh` 的读取方 —— 不可行**。`curl -fsSL …/install.sh | bash` 既没有 checkout 也没有 Python，`python scripts/release_channel.py --sh` 在这种入口里根本无法执行。改法：三个安装脚本取**字面值**，由新门禁 R3 的"正向锚点"保证字面值与事实源一致。`--sh` 仍然实现，服务 checkout 型消费者（本地开发脚本、将来的 fork workflow）。
2. **设计 §5 说版本行"同时进 `copaw_brand.py` 那种整行 old/new 账册" —— 事实不成立**。`copaw_brand.py` 只登记品牌改名对（`scripts/check_p1_invariants.py` 的 `pair_rename_lines` 同理：删行与增行在把 `qwenpaw|copaw` 归一为占位符后必须逐字节相同）。`__version__ = "1.1.11b1"` → `"1.1.11b1.post1"` 两侧归一后仍不相同 ⇒ 它是**行为行**，`export` 永远不会产出它，也不需要账册条目（同步刀本来就要整行覆盖它）。结论：任务 8 只做版本行 + 重算 P1 册并 `--write-baseline`，**不新增账册条目**。同一把尺也适用于设计 §7 那行"改动逐条进 `copaw_brand.json`"：本计划往 `pyproject.toml` / `constants.ts` / 三个安装脚本加的都是行为行，它们由 P1 册现算捕获，账册只收纯改名对。
3. **设计 §8 R4 写"重新生成后 `git diff --quiet` 必须干净" —— 换成字节比较**。门禁要在 fixture / `/tmp` 全树副本上跑（那里没有 git 对象），所以实现为"渲染结果与提交文件逐字节相等"，不变量更强、也更可测。
4. **设计 §8 用例清单里"就绪分支"的 PyPI 升级用例 —— 阶段 1 无对应代码，明确推到阶段 2**（见文末接口）。别在阶段 1 里为它造一个假的就绪态命令体。

---

## 文件结构（阶段 1 全量）

**新建（全部 fork 自有 ⇒ 0 宿主）**

| 文件 | 职责 |
|---|---|
| `src/copaw/release_channel.json` | 事实源本体（唯一可写地址处） |
| `src/copaw/release_channel.py` | loader：`load` / `is_ready` / `address` / `releases_url` / `repository_url` / `asset_name` / `CHANNELS` / `ADDRESS_FIELDS` |
| `scripts/release_channel.py` | 输出适配器：`--print` / `--sh` / `--gh-env` / `--write-ts`，纯函数 `render_ts` |
| `scripts/check_release_channel_consistency.py` | 门禁，五条规则 R1–R5，`--repo-root` |
| `console/src/generated/releaseChannel.ts` | 前端生成文件（提交进仓库） |
| `tests/unit/copaw/__init__.py` | 让新测试包与既有包 basename 不撞（照 `tests/unit/scripts/` 的做法） |
| `tests/unit/copaw/test_release_channel_loader.py` | loader 用例 |
| `tests/unit/scripts/test_release_channel_cli.py` | 输出适配器用例 |
| `tests/unit/scripts/test_check_release_channel_consistency.py` | 门禁五条规则的 fixture 红 + 现树绿 |
| `tests/unit/scripts/test_install_scripts_refuse_pypi.py` | 三个安装脚本的拒绝态与克隆源断言 |
| `console/src/layouts/constants.test.ts` | 生成文件与 JSON 镜像、UPDATE_MD 地址断言 |

**修改（除 `src/qwenpaw/__version__.py` 外全部已在册 ⇒ 0 新宿主）**

| 文件 | 改什么 | 册影响 |
|---|---|---|
| `pyproject.toml` | `[tool.setuptools.package-data]` 新增 `"copaw" = ["release_channel.json"]` | 已在册，加行 |
| `console/src/layouts/constants.ts` | `GITHUB_URL` 改为从生成文件 re-export；`UPDATE_MD` 三门文案里的 Releases 字面值改为插值 | 已在册 |
| `console/src/layouts/Header.tsx` | 弹窗页脚 `viewReleases`（`:182`）由文档站改指 `releasesUrl` | 已在册 |
| `src/copaw/cli/update_cmd.py` | 拒绝文案的地址从事实源取；模块 docstring 去掉 `qwenpaw==` 字面值（门禁 R3 要把这个文件纳入覆盖集） | fork 自有，零册影响 |
| `scripts/install.sh` / `.ps1` / `.bat` | 克隆源改指 `futuremeng/CoPaw.git`；非源码安装改为**在建环境之前**显式失败并指向 Releases；删掉 PyPI 安装分支 | 三个都在册 |
| `src/qwenpaw/__version__.py` | `1.1.11b1` → `1.1.11b1.post1` | **+1 宿主 / +1 −1 行为行** |
| `scripts/p1_baseline.json` | `--write-baseline` 重算（tracked，CI 的 `--check` 要它） | fork 自有 |
| `.github/workflows/unit-tests.yml` | 门禁接进既有 gate job | fork 自有 workflow |
| `UPSTREAM_V2_MIGRATION_PLAN.md`（仓库根） | 在 §「已闭环」列表末尾追加条目 **83** | fork 自有 |

**接口约定（跨任务共享的名字，逐字使用）**

```python
# src/copaw/release_channel.py
CHANNELS = ("pypi", "docker", "cdn")
ADDRESS_FIELDS = {"docker": "docker_namespace", "cdn": "download_cdn"}
def load(path: Path = FACT_SOURCE) -> dict          # JSONDecodeError 向上抛
def is_ready(data, channel) -> bool                 # 只看 pending
def address(data, channel) -> Optional[str]         # 未就绪 ⇒ None，不是 ""
def releases_url(data) -> str
def repository_url(data) -> str
def asset_name(data, platform, version) -> str
```

```python
# scripts/release_channel.py
def render_ts(data: dict) -> str                    # 纯函数，门禁 R4 直接 import 它
```

---

## Task 1: 事实源 JSON + loader

**Files:**
- Create: `src/copaw/release_channel.json`
- Create: `src/copaw/release_channel.py`
- Create: `tests/unit/copaw/__init__.py`（空文件）
- Create: `tests/unit/copaw/test_release_channel_loader.py`

**Interfaces:** Produces 上面"接口约定"里的 `src/copaw/release_channel.py` 全部名字。后续任务用 `importlib.util.spec_from_file_location` 按路径加载它（不 `import copaw.release_channel`，因为 `src/copaw/__init__.py` 是 `from qwenpaw import *`，门禁和脚本不该拖起整个 qwenpaw）。

- [ ] **Step 1: 写失败用例**

```python
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
    assert data["pypi_project"] == "copaw"


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
```

- [ ] **Step 2: 跑到红**

Run: `PYTHONPATH=$PWD/src $VENV -m pytest tests/unit/copaw/test_release_channel_loader.py -q`
Expected: 收集或执行失败 —— `FileNotFoundError: .../src/copaw/release_channel.py`（loader 与 JSON 还不存在）。

- [ ] **Step 3: 写事实源**

`src/copaw/release_channel.json`（逐字，键序也照抄 —— `scripts/release_channel.py` 按插入序渲染）：

```json
{
  "distribution": "copaw",
  "pypi_project": "copaw",
  "upstream_version": "1.1.11b1",
  "docker_namespace": null,
  "github_repository": "futuremeng/CoPaw",
  "download_cdn": null,
  "assets": {
    "windows": "CoPaw-Setup-{version}.exe",
    "macos": "CoPaw-{version}-macOS.zip"
  },
  "pending": ["pypi", "docker", "cdn"]
}
```

- [ ] **Step 4: 写 loader**

```python
# -*- coding: utf-8 -*-
"""Read CoPaw's release-channel fact source.

``pending`` is the only availability bit: a channel that has not been opened
reads as ``None``, never as an empty string a caller might "helpfully" fill
in with upstream's address.  That confusion is the bug this module exists to
make impossible.

``src/copaw/__init__.py`` re-exports all of ``qwenpaw``, so the gate and the
scripts load this file *by path*; the CLI imports it normally because it
already depends on ``qwenpaw``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

FACT_SOURCE = Path(__file__).with_name("release_channel.json")

CHANNELS = ("pypi", "docker", "cdn")
ADDRESS_FIELDS = {"docker": "docker_namespace", "cdn": "download_cdn"}


def load(path: Path = FACT_SOURCE) -> dict[str, Any]:
    """Parse the fact source.  Malformed JSON raises to the caller."""
    return json.loads(path.read_text(encoding="utf-8"))


def is_ready(data: dict[str, Any], channel: str) -> bool:
    """A channel is available exactly when ``pending`` does not name it."""
    return channel not in data["pending"]


def address(data: dict[str, Any], channel: str) -> Optional[str]:
    """``None`` while the channel is pending; the value once it is ready."""
    value = data.get(ADDRESS_FIELDS[channel])
    return value or None


def repository_url(data: dict[str, Any]) -> str:
    return f"https://github.com/{data['github_repository']}"


def releases_url(data: dict[str, Any]) -> str:
    return f"{repository_url(data)}/releases"


def asset_name(data: dict[str, Any], platform: str, version: str) -> str:
    return data["assets"][platform].format(version=version)
```

- [ ] **Step 5: 跑到绿 + lint**

Run: `PYTHONPATH=$PWD/src $VENV -m pytest tests/unit/copaw/test_release_channel_loader.py -q` → 8 passed
Run: `$VENV -m flake8 --extend-ignore=E203 src/copaw/release_channel.py tests/unit/copaw/` → rc=0

- [ ] **Step 6: 提交**

```bash
git add src/copaw/release_channel.json src/copaw/release_channel.py \
        tests/unit/copaw/__init__.py tests/unit/copaw/test_release_channel_loader.py
git commit -m "feat(release-channel): add the CoPaw channel fact source and loader"
```

---

## Task 2: 让 wheel 带上事实源（`pyproject.toml` package-data）

事实源装在 `src/copaw/` 里，而 `[tool.setuptools.package-data]` 现在只有 `"qwenpaw"` 一个键；`include-package-data = true` + `packages = {find={where=["src"]}}` 会把 `copaw` 当包收进来（`.py` 已实测进 `SOURCES.txt`），但非 `.py` 数据文件要靠 package-data 显式列。

**Files:**
- Modify: `pyproject.toml`（`:74` 起的 `[tool.setuptools.package-data]` 段）
- Test: `tests/unit/copaw/test_release_channel_loader.py`（追加两条）

**Interfaces:** Consumes Task 1 的 `src/copaw/release_channel.json` 路径。

- [ ] **Step 1: 追加失败用例**（接到 Task 1 那个文件末尾）

```python
def test_package_data_ships_the_fact_source():
    text = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    section = text.split("[tool.setuptools.package-data]")[1]
    section = section.split("[build-system]")[0]
    assert '"copaw"' in section
    assert "release_channel.json" in section


def test_version_still_comes_from_the_upstream_version_module():
    text = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert 'version = {attr = "qwenpaw.__version__.__version__"}' in text
```

- [ ] **Step 2: 跑到红**

Run: `PYTHONPATH=$PWD/src $VENV -m pytest tests/unit/copaw/test_release_channel_loader.py -q`
Expected: `test_package_data_ships_the_fact_source` FAIL（section 里没有 `"copaw"`）；第二条 PASS（它是钉住现状的回归线，本来就该绿）。

- [ ] **Step 3: 改 `pyproject.toml`**

把 `[tool.setuptools.package-data]` 段的收尾（现 `:90` 附近，`"qwenpaw" = [...]` 的闭括号之后）补一个键：

```toml
"copaw" = [
    "release_channel.json",
]
```

- [ ] **Step 4: 跑到绿**

Run: `PYTHONPATH=$PWD/src $VENV -m pytest tests/unit/copaw/test_release_channel_loader.py -q` → 10 passed

**没验到的部分（写进提交信息，别当已证）**：本机 `python -m build --wheel --no-isolation` 报 `Missing dependencies: wheel`，而 `wheel` 是项目自己 `[build-system] requires` 声明的；共享 venv 禁止装包。所以"wheel 里真的有这个 JSON"要等阶段 2 有可用构建环境时再实测。

- [ ] **Step 5: 提交**

```bash
git add pyproject.toml tests/unit/copaw/test_release_channel_loader.py
git commit -m "build(release-channel): package the fact source with the copaw distribution"
```

---

## Task 3: `scripts/release_channel.py` —— 四个输出形式

**Files:**
- Create: `scripts/release_channel.py`
- Create: `tests/unit/scripts/test_release_channel_cli.py`

**Interfaces:**
- Consumes: `src/copaw/release_channel.py`（按路径加载）。
- Produces: `render_ts(data) -> str`（Task 4 写文件、Task 7 门禁 R4 都比这个字节）；命令行 `--print` / `--sh` / `--gh-env` / `--write-ts [--out PATH]`；环境变量名 `RELEASE_DISTRIBUTION` / `RELEASE_PYPI_PROJECT` / `RELEASE_UPSTREAM_VERSION` / `RELEASE_GITHUB_REPOSITORY` / `RELEASE_DOCKER_NAMESPACE` / `RELEASE_DOWNLOAD_CDN` / `RELEASE_ASSET_WINDOWS` / `RELEASE_ASSET_MACOS` / `RELEASE_PENDING` / `RELEASE_RELEASES_URL`。

- [ ] **Step 1: 写失败用例**

```python
# -*- coding: utf-8 -*-
"""scripts/release_channel.py renders the fact source for each reader."""

from __future__ import annotations

import importlib.util
import json
import os
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
```

- [ ] **Step 2: 跑到红**

Run: `PYTHONPATH=$PWD/src $VENV -m pytest tests/unit/scripts/test_release_channel_cli.py -q`
Expected: FAIL —— `FileNotFoundError: .../scripts/release_channel.py`。

- [ ] **Step 3: 写脚本**

```python
#!/usr/bin/env python
"""Render CoPaw's release-channel fact source for each consumer.

    python scripts/release_channel.py --print
    python scripts/release_channel.py --sh
    GITHUB_ENV=... python scripts/release_channel.py --gh-env
    python scripts/release_channel.py --write-ts [--out PATH]

``--sh`` serves a *checkout* of this repository; the shipped installers are
``curl … | bash`` and have neither a checkout nor Python, so they carry the
literals and the consistency gate keeps them equal to this file.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
FACT_SOURCE = REPO_ROOT / "src/copaw/release_channel.json"
LOADER_MODULE = REPO_ROOT / "src/copaw/release_channel.py"
GENERATED_TS = REPO_ROOT / "console/src/generated/releaseChannel.ts"

TS_HEADER = (
    "// GENERATED by scripts/release_channel.py --write-ts. "
    "Do not edit by hand.\n"
    "// Fact source: src/copaw/release_channel.json\n"
)
TS_FOOTER = (
    "\nexport const githubUrl = "
    "`https://github.com/${RELEASE_CHANNEL.github_repository}`;\n"
    "export const releasesUrl = `${githubUrl}/releases`;\n"
)

# env name suffix -> fact-source key; a tuple means a nested (assets) lookup.
ENV_FIELDS = (
    ("DISTRIBUTION", "distribution"),
    ("PYPI_PROJECT", "pypi_project"),
    ("UPSTREAM_VERSION", "upstream_version"),
    ("GITHUB_REPOSITORY", "github_repository"),
    ("DOCKER_NAMESPACE", "docker_namespace"),
    ("DOWNLOAD_CDN", "download_cdn"),
    ("ASSET_WINDOWS", ("assets", "windows")),
    ("ASSET_MACOS", ("assets", "macos")),
)


def _loader():
    spec = importlib.util.spec_from_file_location(
        "_copaw_release_channel", LOADER_MODULE
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _scalar(data: dict[str, Any], key: Any) -> Any:
    value: Any = data
    if isinstance(key, tuple):
        for part in key:
            value = value[part]
        return value
    return value[key]


def env_map(data: dict[str, Any]) -> dict[str, str]:
    out = {}
    for suffix, key in ENV_FIELDS:
        value = _scalar(data, key)
        out[f"RELEASE_{suffix}"] = "" if value is None else str(value)
    loader = _loader()
    out["RELEASE_PENDING"] = ",".join(data["pending"])
    out["RELEASE_RELEASES_URL"] = loader.releases_url(data)
    return out


def _ts_value(value: Any) -> str:
    if value is None:
        return "null"
    return json.dumps(value)


def _ts_lines(value: Any, key: str, indent: int) -> list[str]:
    pad = " " * indent
    if isinstance(value, dict):
        lines = [f"{pad}{key}: {{"]
        for sub, sub_value in value.items():
            lines += _ts_lines(sub_value, sub, indent + 2)
        lines.append(f"{pad}}},")
        return lines
    if isinstance(value, list):
        inline = f"{pad}{key}: [{', '.join(_ts_value(v) for v in value)}],"
        if len(inline) <= 80:
            return [inline]
        lines = [f"{pad}{key}: ["]
        for item in value:
            lines.append(f"{pad}  {_ts_value(item)},")
        lines.append(f"{pad}],")
        return lines
    return [f"{pad}{key}: {_ts_value(value)},"]


def render_ts(data: dict[str, Any]) -> str:
    """Render the committed console module in prettier's own style."""
    lines = [TS_HEADER.rstrip("\n"), "export const RELEASE_CHANNEL = {"]
    for key, value in data.items():
        lines += _ts_lines(value, key, 2)
    lines.append("} as const;")
    return "\n".join(lines) + TS_FOOTER


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    form = parser.add_mutually_exclusive_group(required=True)
    form.add_argument("--print", action="store_true")
    form.add_argument("--sh", action="store_true")
    form.add_argument("--gh-env", action="store_true")
    form.add_argument("--write-ts", action="store_true")
    parser.add_argument(
        "--out", type=Path, default=GENERATED_TS, help="--write-ts target"
    )
    parser.add_argument("--fact-source", type=Path, default=FACT_SOURCE)
    args = parser.parse_args(argv)

    data = _loader().load(args.fact_source)

    if args.print:
        print(json.dumps(data, indent=2))
        return 0
    if args.sh:
        for name, value in env_map(data).items():
            print(f"export {name}={value}")
        return 0
    if args.gh_env:
        target = os.environ.get("GITHUB_ENV")
        if not target:
            print("ERROR: --gh-env needs GITHUB_ENV to point at a file")
            return 1
        with open(target, "a", encoding="utf-8") as handle:
            for name, value in env_map(data).items():
                handle.write(f"{name}={value}\n")
        return 0
    rendered = render_ts(data)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(rendered, encoding="utf-8")
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

**注意 `--sh` 不加引号**：事实源的键值都是我们自己写的、不含空格 / `$` / 反引号的标识符和 URL；`shlex.quote` 会把 `RELEASE_PENDING` 变成带引号的串，测试与既有 `eval` 用法都要跟着变，不值得。若将来往 JSON 里放含空格的值，改这里并同步测试。

- [ ] **Step 4: 跑到绿**

Run: `PYTHONPATH=$PWD/src $VENV -m pytest tests/unit/scripts/test_release_channel_cli.py -q` → 6 passed

- [ ] **Step 5: 手工看一眼两种输出（不改仓库）**

```bash
$VENV scripts/release_channel.py --sh
$VENV scripts/release_channel.py --print | head -20
```

- [ ] **Step 6: 提交**

```bash
git add scripts/release_channel.py tests/unit/scripts/test_release_channel_cli.py
git commit -m "feat(release-channel): render the fact source for CI, shells and the console"
```

---

## Task 4: 前端生成文件 + 接线（Releases / GitHub 指向）

**Files:**
- Create: `console/src/generated/releaseChannel.ts`（由脚本生成，不手写）
- Modify: `console/src/layouts/constants.ts`（`:3` 与 `:104` / `:131` / `:158`）
- Modify: `console/src/layouts/Header.tsx`（`:15` 之后的 import 块、`:182`）
- Create: `console/src/layouts/constants.test.ts`

**Interfaces:** Consumes `render_ts`。Produces 前端侧 `RELEASE_CHANNEL` / `githubUrl` / `releasesUrl`；`constants.ts` 继续 re-export `GITHUB_URL`（唯一消费者 `Header.tsx:157` 不用改）。

- [ ] **Step 1: 写失败用例**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RELEASE_CHANNEL, githubUrl, releasesUrl } from "../generated/releaseChannel";
import { GITHUB_URL, UPDATE_MD } from "./constants";

const factSource = JSON.parse(
  readFileSync(
    new URL("../../../src/copaw/release_channel.json", import.meta.url),
    "utf-8",
  ),
);

describe("CoPaw release channel wiring", () => {
  it("mirrors the fact source field for field", () => {
    expect(RELEASE_CHANNEL).toEqual(factSource);
  });

  it("derives both repository URLs from the repository field", () => {
    expect(githubUrl).toBe(`https://github.com/${factSource.github_repository}`);
    expect(releasesUrl).toBe(`${githubUrl}/releases`);
    expect(GITHUB_URL).toBe(githubUrl);
  });

  it("names only CoPaw's own releases page in every shipped guide", () => {
    const languages = Object.keys(UPDATE_MD);
    expect(languages.length).toBeGreaterThan(0);
    for (const language of languages) {
      expect(UPDATE_MD[language]).toContain(releasesUrl);
      expect(UPDATE_MD[language]).not.toContain("agentscope-ai/QwenPaw");
    }
  });

  it("never promises a PyPI channel the fact source marks pending", () => {
    for (const language of Object.keys(UPDATE_MD)) {
      expect(UPDATE_MD[language]).not.toMatch(/pip install copaw/);
      expect(UPDATE_MD[language]).not.toMatch(/uv pip install copaw/);
    }
  });
});
```

- [ ] **Step 2: 跑到红**

Run: `cd console && npx vitest run src/layouts/constants.test.ts; echo "rc=$?"`
Expected: rc=1，报错是 `Failed to resolve import "../generated/releaseChannel"`（文件不存在）。

- [ ] **Step 3: 生成前端文件**

```bash
$VENV scripts/release_channel.py --write-ts
npx --prefix console prettier --check console/src/generated/releaseChannel.ts
```
Expected: 生成成功且 prettier 报 "All matched files use Prettier code style!"（**这条已实测过**：2026-10-08 用本计划 `render_ts` 的实现对今天的 JSON 渲染一份副本，`prettier 3.0.0 --check` rc=0，`--write` 后与原串逐字节相同 ⇒ 键不带引号、`pending` 单行、结尾有逗号这三条形状是 prettier 的稳定形状，R4 的字节比较能长期成立。）若将来 JSON 变宽导致 prettier 再报错，**改 `render_ts`** 直到两边一致，不要 `prettier --write` 生成文件后留下一个不一致的渲染器。

- [ ] **Step 4: 接线 `constants.ts`**

把第 1–3 行：

```ts
// ── URLs ──────────────────────────────────────────────────────────────────

export const GITHUB_URL = "https://github.com/agentscope-ai/QwenPaw" as const;
```

替换为：

```ts
// ── URLs ──────────────────────────────────────────────────────────────────
// Both repository URLs come from the release-channel fact source
// (src/copaw/release_channel.json -> console/src/generated/releaseChannel.ts).
// The documentation-site helpers below still point at the upstream site on
// purpose: it is upstream's content asset, and CoPaw has no equivalent yet
// (design §9.3).

import { githubUrl, releasesUrl } from "../generated/releaseChannel";

export { githubUrl as GITHUB_URL, releasesUrl };
```

（必须是"先 import 再 export"，不能写 `export { … } from "…"`：那种 re-export 不在本模块绑定名字，下面的 `UPDATE_MD` 模板串里 `${releasesUrl}` 会直接编译不过。）

再把 `UPDATE_MD` 三门文案里的三处 Releases 字面值（现 `:104`、`:131`、`:158`，内容都是 `https://github.com/futuremeng/CoPaw/releases` 单占一行）改为插值。因为 `UPDATE_MD` 是模板串，直接写 `${releasesUrl}`：

```
\`\`\`
${releasesUrl}
\`\`\`
```

（三处同样处理，逐字替换：把那一行的 `https://github.com/futuremeng/CoPaw/releases` 换成 `${releasesUrl}`。）

- [ ] **Step 5: 接线 `Header.tsx` 页脚**

`:182` 由

```tsx
            onClick={() => handleNavClick(getReleaseNotesUrl(i18n.language))}
```

改为

```tsx
            onClick={() => handleNavClick(releasesUrl)}
```

并在 `:10`–`:17` 的 import 里补 `releasesUrl`（与 `GITHUB_URL` 同一条 `from "./constants"`）。资源菜单里的 `changelog`（`:138`）**保持** `getReleaseNotesUrl`：那是上游文档站的内容，页脚那颗按钮的文案才是 "Releases"（分发落点）。

- [ ] **Step 6: 跑到绿 + 类型检查**

```bash
cd console && npx vitest run src/layouts/constants.test.ts src/layouts/Header.test.tsx; echo "rc=$?"
cd console && npx tsc -b --force; echo "rc=$?"
```
Expected: 两条 rc=0。`Header.test.tsx` 既有的"每门文案都含 `github.com/futuremeng/CoPaw`"断言在插值后仍然成立（`UPDATE_MD` 渲染出的就是同一串）。

- [ ] **Step 7: 提交**

```bash
git add console/src/generated/releaseChannel.ts console/src/layouts/constants.ts \
        console/src/layouts/Header.tsx console/src/layouts/constants.test.ts
git commit -m "feat(console): point the update guide at the channel fact source"
```

---

## Task 5: `copaw update` 的拒绝文案改从事实源取

**Files:**
- Modify: `src/copaw/cli/update_cmd.py`
- Modify: `tests/unit/cli/test_cli_update_overlay.py`

**Interfaces:** Consumes `src/copaw/release_channel.py`（这个文件可以正常 import：它已经 `from qwenpaw…`，import `copaw.release_channel` 不新增循环 —— `copaw/__init__` 只 `from qwenpaw import *`）。Produces 无新名字；行为仍是：程序名是 `copaw` ⇒ 打印 + `SystemExit(1)`，否则委托上游（判据 90）。

- [ ] **Step 1: 先把用例改成"地址来自事实源"（取红）**

在 `tests/unit/cli/test_cli_update_overlay.py` 的模块顶部补 import（现有 import 块 `:15`–`:28`）：

```python
import json
from pathlib import Path
```

把该文件 `:30` 的本地常量 `COPAW_RELEASES_URL = "https://github.com/futuremeng/CoPaw/releases"` 删掉，换成从事实源推导（该文件位于 `tests/unit/cli/`，`parents[3]` 才是仓库根）：

```python
_REPO_ROOT = Path(__file__).resolve().parents[3]


def _fact_releases_url() -> str:
    fact = json.loads(
        (_REPO_ROOT / "src/copaw/release_channel.json").read_text(
            encoding="utf-8"
        )
    )
    return f"https://github.com/{fact['github_repository']}/releases"
```

把既有断言（`:107` 的 `assert COPAW_RELEASES_URL in result.output`）换成：

```python
    assert _fact_releases_url() in result.output
```

并**新增一条**钉住"拒绝输出里不许出现上游分发身份"（沿用同文件既有的 `no_installer` 夹具，它保证这一步不碰 pip/uv）：

```python
def test_copaw_refusal_names_no_upstream_install_target(no_installer) -> None:
    result = CliRunner().invoke(
        copaw_cli,
        ["update"],
        prog_name="copaw",
    )

    assert result.exit_code != 0
    assert no_installer == []
    for marker in (
        "agentscope-ai/QwenPaw",
        "agentscope/qwenpaw",
        "pypi.org/pypi/qwenpaw",
        "qwenpaw==",
    ):
        assert marker not in result.output
```

- [ ] **Step 2: 跑到红**

Run: `PYTHONPATH=$PWD/src $VENV -m pytest tests/unit/cli/test_cli_update_overlay.py -q`
Expected: 若 Step 1 里先删了 import 则收集失败；保留时常量仍等于事实源推导串 ⇒ 新那条 `test_refusal_names_no_upstream_install_target` 绿、其余绿。**要在动手前额外确认这条会红**：临时把 `src/copaw/release_channel.json` 的 `github_repository` 改成 `example/SomeRepo`（Edit，不提交），跑一次用例应见 `assert _fact_releases_url() in result.output` 红 —— 证明 `copaw update` 现在还**不**读事实源；然后用 Edit 把 JSON 改回 `futuremeng/CoPaw`，`git status --short` 必须为空。（禁止用 `git checkout` 回滚这类临时探针改动。）

- [ ] **Step 3: 改实现**

`src/copaw/cli/update_cmd.py`：

1. 第 5 行 docstring 里的 `project and pip-installs ``qwenpaw==<latest>`` into the current environment.` 改成 `project and pip-installs that project into the current environment.`（门禁 R3 要把这个文件纳入覆盖集，`qwenpaw==` 是禁止串；语义不变。）
2. 删掉 `COPAW_RELEASES_URL = "https://github.com/futuremeng/CoPaw/releases"` 常量，改为：

```python
from copaw.release_channel import load as _load_fact_source
from copaw.release_channel import releases_url as _releases_url
```

3. 拒绝分支里那行 `click.echo(f"Releases: {COPAW_RELEASES_URL}")` 改为：

```python
    click.echo(f"Releases: {_releases_url(_load_fact_source())}")
```

4. `help` 文案保持 `"Refuse to upgrade: CoPaw is not on PyPI yet."` 不变（"没有 PyPI 渠道"仍成立，事实源 `pending` 含 `pypi`）。

- [ ] **Step 4: 跑到绿**

Run: `PYTHONPATH=$PWD/src $VENV -m pytest tests/unit/cli/test_cli_update_overlay.py tests/unit/copaw -q` → 全部 passed
Run: `$VENV -m flake8 --extend-ignore=E203 src/copaw/cli/update_cmd.py` → rc=0

- [ ] **Step 5: 提交**

```bash
git add src/copaw/cli/update_cmd.py tests/unit/cli/test_cli_update_overlay.py
git commit -m "feat(cli): read the update refusal's address from the channel fact source"
```

---

## Task 6: 安装脚本 —— 克隆源指回我们，PyPI 路径在建环境之前拒绝

三条都要改（设计 §6 最后一行"当前最尖锐"）。本机没有 `pwsh` / `powershell` ⇒ `.ps1` / `.bat` **只做静态字符串断言**，`bash -n` 只作用于 `.sh`。这是已知未验证项，写进提交信息。

**Files:**
- Modify: `scripts/install.sh`（`:31`、`:91` 之后插入、`:261`–`:269`）
- Modify: `scripts/install.ps1`（`:34`、`:62` 之后插入、`:312`–`:320`）
- Modify: `scripts/install.bat`（`:25`、`:main` 开头、`:340`–`:341`、`:422`–`:449`）
- Create: `tests/unit/scripts/test_install_scripts_refuse_pypi.py`

**Interfaces:** 无新符号。三个脚本都要含 loader 从事实源推出的 `releases_url`（Task 7 的门禁拿它当**正向锚点**）。

- [ ] **Step 1: 写失败用例**

```python
# -*- coding: utf-8 -*-
"""The installers must not be able to hand a CoPaw user upstream."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ("scripts/install.sh", "scripts/install.ps1", "scripts/install.bat")
UPSTREAM_MARKERS = (
    "agentscope-ai/QwenPaw",
    "agentscope/qwenpaw",
    "pypi.org/pypi/qwenpaw",
    "qwenpaw==",
    "--refresh-package qwenpaw",
)


def _fact():
    return json.loads(
        (REPO_ROOT / "src/copaw/release_channel.json").read_text(
            encoding="utf-8"
        )
    )


@pytest.mark.parametrize("rel", SCRIPTS)
def test_clone_source_is_ours(rel):
    text = (REPO_ROOT / rel).read_text(encoding="utf-8")
    assert "https://github.com/futuremeng/CoPaw.git" in text


@pytest.mark.parametrize("rel", SCRIPTS)
def test_refusal_points_at_our_releases_page(rel):
    fact = _fact()
    text = (REPO_ROOT / rel).read_text(encoding="utf-8")
    assert (
        f"https://github.com/{fact['github_repository']}/releases" in text
    )
    assert "not published to PyPI yet" in text


@pytest.mark.parametrize("rel", SCRIPTS)
def test_no_upstream_distribution_identity(rel):
    text = (REPO_ROOT / rel).read_text(encoding="utf-8")
    for marker in UPSTREAM_MARKERS:
        assert marker not in text, f"{rel} still names {marker!r}"


def test_install_sh_still_parses():
    path = REPO_ROOT / "scripts/install.sh"
    subprocess.run(
        ["bash", "-n", str(path)], check=True, capture_output=True, text=True
    )
```

- [ ] **Step 2: 跑到红**

Run: `PYTHONPATH=$PWD/src $VENV -m pytest tests/unit/scripts/test_install_scripts_refuse_pypi.py -q`
Expected: 9 条 FAIL（克隆源、锚点、禁止串三组各命中一次以上）。

- [ ] **Step 3: 改 `scripts/install.sh`**

1. `:31`：`QWENPAW_REPO="https://github.com/agentscope-ai/QwenPaw.git"` → `QWENPAW_REPO="https://github.com/futuremeng/CoPaw.git"`
2. 参数解析的 `done`（`:91`）之后、`# ── OS check` 之前插入：

```bash
# ── Channel guard ───────────────────────────────────────────────────────────
# CoPaw has no PyPI distribution: release_channel.json keeps "pypi" pending.
# Refuse before uv creates anything, so re-running the documented install
# command can never replace a CoPaw install with the upstream package.
if [ "$FROM_SOURCE" != true ]; then
    die "CoPaw is not published to PyPI yet. Re-run with --from-source, or download a build from https://github.com/futuremeng/CoPaw/releases"
fi
```

3. 删掉 PyPI 分支（`:261`–`:269` 的 `else` 整块，含 `PACKAGE="qwenpaw==$VERSION"` 与 `--refresh-package qwenpaw` 那行），把 `if [ "$FROM_SOURCE" = true ]; then … else … fi` 收成 `if … fi`。保留 `if` 外壳（源码分支的缩进不动 ⇒ diff 最小）。

- [ ] **Step 4: 改 `scripts/install.ps1`**

1. `:34`：`$QwenpawRepo     = "https://github.com/agentscope-ai/QwenPaw.git"` → `… = "https://github.com/futuremeng/CoPaw.git"`
2. Help 块收尾的 `}`（`:62`）之后、`:64` 那两行 `Write-Host "[qwenpaw] "` 之前插入：

```powershell
# CoPaw has no PyPI distribution yet (release_channel.json keeps "pypi"
# pending).  Refuse before uv creates the environment.
if (-not $FromSource) {
    Stop-WithError "CoPaw is not published to PyPI yet. Re-run with -FromSource, or download a build from https://github.com/futuremeng/CoPaw/releases"
}
```

3. 把 `:312`–`:320` 的 `} else { … }` 整块（`$package = "qwenpaw"`、`"qwenpaw==$Version"`、`uv pip install … --refresh-package qwenpaw`、`Stop-WithError "Installation failed"`）替换为单独的 `}`。

- [ ] **Step 5: 改 `scripts/install.bat`**

1. `:25`：`set "QWENPAW_REPO=https://github.com/agentscope-ai/QwenPaw.git"` → `set "QWENPAW_REPO=https://github.com/futuremeng/CoPaw.git"`
2. `:main`（`:302`）第一行 `echo` 之后插入：

```bat

REM CoPaw has no PyPI distribution yet (release_channel.json keeps "pypi"
REM pending).  Refuse before uv creates the environment.
if not "%ARG_FROM_SOURCE%"=="1" goto :refuse_pypi_channel
```

3. 分派处（`:340`–`:341`）`goto :install_from_pypi` → `goto :refuse_pypi_channel`
4. 把 `:install_from_pypi`（`:422`）到 `:install_verify`（`:452`）之前那整段（含版本号白名单校验、`set "_PACKAGE=qwenpaw%ARG_VERSION%"`、`uv pip install … --refresh-package qwenpaw`）替换为：

```bat
:refuse_pypi_channel
call :stop_with_error "CoPaw is not published to PyPI yet. Re-run with --from-source, or download a build from https://github.com/futuremeng/CoPaw/releases"
```

（`:stop_with_error` 在 `:108` 定义为 `echo [qwenpaw] ERROR: %~1` + `exit /b 1`，消息里的 `:` 与 `/` 在带引号的 `%~1` 展开下是安全的。）

- [ ] **Step 6: 跑到绿 + 既有账册校验不受影响**

Run: `PYTHONPATH=$PWD/src $VENV -m pytest tests/unit/scripts/test_install_scripts_refuse_pypi.py -q` → 10 passed
Run: `$VENV scripts/copaw_brand.py verify` → rc=0（`install.bat` 在账册里有 2 对纯改名行，本任务没碰它们）

- [ ] **Step 7: 提交**

```bash
git add scripts/install.sh scripts/install.ps1 scripts/install.bat \
        tests/unit/scripts/test_install_scripts_refuse_pypi.py
git commit -m "fix(install): clone from CoPaw and refuse before any PyPI install"
```

---

## Task 7: 门禁 R1–R4（先 fixture 取红）

**Files:**
- Create: `scripts/check_release_channel_consistency.py`
- Create: `tests/unit/scripts/test_check_release_channel_consistency.py`
- Modify: `.github/workflows/unit-tests.yml`（gate job 追加一步）

**Interfaces:** Consumes `release_channel.render_ts`（同目录 import）与 loader（按路径）。Produces `main(argv) -> int`、`--repo-root`、`ERROR: R<n>: …` 行格式（照 `check_ci_command_targets.py` 的形状，任务 8 要复用同一批 fixture helper）。

- [ ] **Step 1: 写用例（fixture 是现树的 `/tmp` 拷贝，不是编造数据）**

```python
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


def test_rule_two_rejects_a_ready_channel_without_address(fixture_root, capsys):
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
```

- [ ] **Step 2: 跑到红**

Run: `PYTHONPATH=$PWD/src $VENV -m pytest tests/unit/scripts/test_check_release_channel_consistency.py -q`
Expected: FAIL —— 门禁脚本不存在（`FileNotFoundError`）。

- [ ] **Step 3: 写门禁**

```python
#!/usr/bin/env python
"""Guard CoPaw's release-channel fact source against its consumers.

Five rules (design §8):

* R1 authority   -- ``pending`` is the only availability bit, and it can only
                    name declared channels; our own distribution names are
                    never empty.
* R2 two-state   -- an address field is null exactly while its channel is
                    still pending.
* R3 no-upstream -- a fork-side channel file never names an upstream
                    distribution identity, and every installer still points
                    at our own Releases page (a positive anchor: a forbidden
                    string alone would miss ``_PACKAGE=qwenpaw%VERSION%``).
* R4 codegen     -- the committed console module equals the rendered fact
                    source byte for byte.
* R5 version     -- ``__version__`` parses, and after stripping ``.postN`` /
                    ``.devN`` it equals ``upstream_version``.

Usage:
    python scripts/check_release_channel_consistency.py
    python scripts/check_release_channel_consistency.py --repo-root DIR
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

from packaging.version import InvalidVersion, Version

sys.path.insert(0, str(Path(__file__).resolve().parent))
from release_channel import render_ts  # noqa: E402

LOADER_REL = "src/copaw/release_channel.py"
FACT_REL = "src/copaw/release_channel.json"
VERSION_REL = "src/qwenpaw/__version__.py"

# rel path -> which derived anchor it must contain ("releases" or None).
CHANNEL_FILES = (
    ("scripts/install.sh", "releases"),
    ("scripts/install.ps1", "releases"),
    ("scripts/install.bat", "releases"),
    ("console/src/layouts/constants.ts", None),
    ("console/src/generated/releaseChannel.ts", None),
    ("src/copaw/cli/update_cmd.py", "releases"),
)
FORK_WORKFLOW_GLOB = "copaw-*.y*ml"

# Upstream's distribution identities.  A fork-side channel file can have no
# legitimate reason to name them; that is what makes this list safe.
UPSTREAM_MARKERS = (
    "agentscope-ai/QwenPaw",
    "agentscope/qwenpaw",
    "pypi.org/pypi/qwenpaw",
    "qwenpaw==",
)

VERSION_RE = re.compile(r'^__version__\s*=\s*"([^"]+)"', re.MULTILINE)
LOCAL_SUFFIX_RE = re.compile(r"(?:\.post\d+|\.dev\d+)+$")


def _load_loader(repo_root: Path):
    spec = importlib.util.spec_from_file_location(
        "_rc_consistency_loader", repo_root / LOADER_REL
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rule_authority(loader, data):
    errors = []
    pending = data["pending"]
    if len(set(pending)) != len(pending):
        errors.append("R1: pending lists a channel twice")
    unknown = [name for name in pending if name not in loader.CHANNELS]
    if unknown:
        errors.append(
            f"R1: pending names unknown channels {unknown}; "
            f"declared channels are {list(loader.CHANNELS)}"
        )
    for key in ("distribution", "pypi_project"):
        value = data.get(key)
        if not isinstance(value, str) or not value:
            errors.append(
                f"R1: {key} must name our own distribution even while its "
                "channel is still pending"
            )
    return errors


def rule_two_state(loader, data):
    errors = []
    for channel, field in loader.ADDRESS_FIELDS.items():
        ready = loader.is_ready(data, channel)
        value = data.get(field)
        if ready and not value:
            errors.append(
                f"R2: {channel} is not pending but {field} is empty"
            )
        if not ready and value is not None:
            errors.append(
                f"R2: {channel} is pending but {field} = {value!r}"
            )
    return errors


def _anchors(loader, data):
    return {"releases": loader.releases_url(data)}


def rule_no_upstream(loader, data, repo_root):
    errors = []
    anchors = _anchors(loader, data)
    paths = list(CHANNEL_FILES)
    # Fork-owned release workflows join as soon as they exist (phase 2);
    # an empty glob is a legitimate phase-1 state, not a missing file.
    for path in sorted((repo_root / ".github/workflows").glob(FORK_WORKFLOW_GLOB)):
        paths.append((str(path.relative_to(repo_root)), None))
    for rel, anchor in paths:
        path = repo_root / rel
        if not path.exists():
            errors.append(f"R3: channel file {rel} is missing")
            continue
        text = path.read_text(encoding="utf-8")
        for marker in UPSTREAM_MARKERS:
            if marker in text:
                errors.append(
                    f"R3: {rel} names the upstream identity {marker!r}"
                )
        if anchor:
            expected = anchors[anchor]
            if expected not in text:
                errors.append(f"R3: {rel} no longer points at {expected}")
    return errors


def rule_codegen(data, repo_root):
    rel = "console/src/generated/releaseChannel.ts"
    path = repo_root / rel
    if not path.exists():
        return [f"R4: {rel} is missing"]
    if path.read_text(encoding="utf-8") != render_ts(data):
        return [
            f"R4: {rel} is stale; re-run "
            "scripts/release_channel.py --write-ts"
        ]
    return []


def rule_version_line(data, repo_root):
    path = repo_root / VERSION_REL
    if not path.exists():
        return [f"R5: {VERSION_REL} is missing"]
    match = VERSION_RE.search(path.read_text(encoding="utf-8"))
    if not match:
        return [f"R5: {VERSION_REL} has no parseable __version__ assignment"]
    number = match.group(1)
    try:
        Version(number)
    except InvalidVersion:
        return [f"R5: {number!r} is not a valid PEP 440 version"]
    # base_version is NOT usable here: Version("1.1.11b1.post1").base_version
    # drops the b1, so the comparison would always fail.
    base = LOCAL_SUFFIX_RE.sub("", number)
    if base != data["upstream_version"]:
        return [
            f"R5: {VERSION_REL} reports {number!r} (upstream part {base!r}) "
            f"but the fact source says upstream_version="
            f"{data['upstream_version']!r}"
        ]
    return []


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
    )
    args = parser.parse_args(argv)
    repo_root = args.repo_root.resolve()

    loader = _load_loader(repo_root)
    fact = repo_root / FACT_REL
    if not fact.exists():
        print(f"ERROR: R1: fact source {FACT_REL} is missing")
        return 1
    try:
        data = loader.load(fact)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: R1: fact source {FACT_REL} is unreadable: {exc}")
        return 1

    errors = []
    errors += rule_authority(loader, data)
    errors += rule_two_state(loader, data)
    errors += rule_no_upstream(loader, data, repo_root)
    errors += rule_codegen(data, repo_root)
    errors += rule_version_line(data, repo_root)

    if errors:
        for item in errors:
            print(f"ERROR: {item}")
        return 1

    print(
        "Release channel consistency check passed "
        f"(R1-R5 over {len(CHANNEL_FILES)} channel files)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: 跑到绿（R5 此时就应绿：`1.1.11b1` 剥 post 后仍等于 `upstream_version`）**

Run: `PYTHONPATH=$PWD/src $VENV -m pytest tests/unit/scripts/test_check_release_channel_consistency.py -q` → 9 passed
Run: `$VENV scripts/check_release_channel_consistency.py; echo "rc=$?"` → rc=0，串里写 `R1-R5`

- [ ] **Step 5: 接进 CI（fork 自有 workflow，不动上游那四条）**

`.github/workflows/unit-tests.yml` 的 gate 段里，紧跟 `Check P1 invariants (gate)`（`:86`–`:91`）之后追加一步，格式照抄相邻那一步（含 `if:` 那行的矩阵版本条件）：

```yaml
      - name: Release channel consistency (gate)
        if: matrix.python-version == '3.10'
        run: python scripts/check_release_channel_consistency.py
```

**别把 `unit-tests.yml` 自己纳入门禁 R3 的覆盖集**：它 `:84` 的 `git fetch https://github.com/agentscope-ai/QwenPaw.git` 是命名空间边界检查器在读上游所必需的合法出现点，纳进来就是一颗永久红、只能靠豁免表压住。R3 只吃 `.github/workflows/copaw-*.y*ml` 这个 glob（阶段 1 命中 0 个文件，是合法状态而不是缺文件）。

- [ ] **Step 6: 提交**

```bash
git add scripts/check_release_channel_consistency.py \
        tests/unit/scripts/test_check_release_channel_consistency.py \
        .github/workflows/unit-tests.yml
git commit -m "test(ci): gate the release-channel fact source against its readers"
```

---

## Task 8: 版本线写回 `__version__.py`（唯一 +1 宿主）+ 门禁 R5 的 post 断言

**Files:**
- Modify: `src/qwenpaw/__version__.py`（`:2`）
- Modify: `scripts/p1_baseline.json`（`--write-baseline` 重算）
- Modify: `tests/unit/scripts/test_check_release_channel_consistency.py`（追加 3 条）

**Interfaces:** 无新符号。R5 的实现已在 Task 7；本任务加"现树必须带 `.postN`"这条产品不变量。

- [ ] **Step 1: 追加失败用例**（接到 Task 7 那个文件末尾）

```python
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
```

- [ ] **Step 2: 跑到红**

Run: `PYTHONPATH=$PWD/src $VENV -m pytest tests/unit/scripts/test_check_release_channel_consistency.py -q`
Expected: 前两条 PASS（R5 已实现），第三条 FAIL —— `assert ".post" in text`。

- [ ] **Step 3: 改版本行**

`src/qwenpaw/__version__.py:2`：`__version__ = "1.1.11b1"` → `__version__ = "1.1.11b1.post1"`

- [ ] **Step 4: 跑到绿 + 全量 Python 用例**

```bash
PYTHONPATH=$PWD/src $VENV -m pytest tests/unit/scripts/test_check_release_channel_consistency.py -q
PYTHONPATH=$PWD/src $VENV -m pytest tests/unit -q
```
Expected: 本文件 12 passed；`tests/unit` 全绿（已知基线：3,382 passed / 5 skipped / 8 xfailed，以现算为准）。已核：全仓除 `__version__.py` 与 `Header.test.tsx` 的 mock 之外没有第二处硬编码 `1.1.11b1` ⇒ 这行改动撞不到别的用例。

- [ ] **Step 5: 重算 P1 册与账册**

```bash
$VENV scripts/check_p1_invariants.py --json --target-ref HEAD | python3 -c "import json,sys; print(json.load(sys.stdin)['totals'])"
$VENV scripts/check_p1_invariants.py --write-baseline
$VENV scripts/check_p1_invariants.py --check; echo "rc=$?"
$VENV scripts/copaw_brand.py verify
```
Expected:
- `--json` 现算：`files` 由 144 → **145**，`behavior_files` 143 → **144**，`added` +1、`removed` +1（`src/qwenpaw/__version__.py` 记 `added 1 / removed 1 / naming 0`）。**命名 37 行不动** —— 版本行不是改名对，`copaw_brand.py export` 不会登记它（设计偏离点 2）。
- `--check` rc=0（不 `--write-baseline` 的话必然报 `NEW upstream-owned file touched: src/qwenpaw/__version__.py` 与 `files grew`，所以这一步不能省）。
- `copaw_brand.py verify` rc=0。

- [ ] **Step 6: 提交**

```bash
git add src/qwenpaw/__version__.py scripts/p1_baseline.json \
        tests/unit/scripts/test_check_release_channel_consistency.py
git commit -m "build(release-channel): ship the CoPaw post-release version line"
```

---

## Task 9: 全套验证读数、记账、推送

- [ ] **Step 1: 后端**

```bash
PYTHONPATH=$PWD/src $VENV -m pytest tests/unit -q
$VENV -m flake8 --extend-ignore=E203 src/copaw/release_channel.py src/copaw/cli/update_cmd.py
```

- [ ] **Step 2: 前端**

```bash
cd console && npx tsc -b --force; echo "rc=$?"
cd console && npm run test:run; echo "rc=$?"     # 基线 76 文件 / 486 用例（75 文件 / 482 用例 + 本计划新增 constants.test.ts 4 条）
```

- [ ] **Step 3: 三条门禁 + 账册**

```bash
$VENV scripts/check_release_channel_consistency.py
$VENV scripts/check_ci_command_targets.py
$VENV scripts/check_namespace_boundaries.py
$VENV scripts/copaw_brand.py verify
$VENV scripts/check_p1_invariants.py --check
```

- [ ] **Step 4: 格式**

`npx --prefix console prettier --check` 只跑**本计划新增/改动**的 4 个前端文件（生成文件、`constants.ts`、`Header.tsx`、`constants.test.ts`）。若某个文件改动前就红（判据 63），记录"预红"事实，不要 `--write`。

- [ ] **Step 5: 端到端人工核（不发网络请求）**

```bash
PYTHONPATH=$PWD/src $VENV -m copaw update; echo "rc=$?"      # 期望 rc=1，输出含 Releases 地址
PYTHONPATH=$PWD/src $VENV -m copaw update --help | head -5
bash -n scripts/install.sh
bash scripts/install.sh --help | head -5                      # 只看 help，不安装
$VENV scripts/release_channel.py --sh
```
`pwsh` / `powershell` 本机不存在 ⇒ `.ps1` / `.bat` 的运行时行为留作未验证，写进记录条目。

- [ ] **Step 6: 记账**

在仓库根 `UPSTREAM_V2_MIGRATION_PLAN.md` 的 §「已闭环（本轮读代码 + 实测确认，可作为执行依据）」列表末尾（条目 82 之后）追加条目 **83**：阶段 1 六笔提交、净定价（**册 +1 宿主 / +1 −1 行为行；命名 37 行不动**；文件数 144→145、`behavior_files` 143→144）、四处与设计文档的偏离及理由、未验证项（`.ps1`/`.bat` 无解释器、wheel 里的 JSON 没实测、`--check` 依赖 `--write-baseline`）。
**面侧读数不动**：133 文件 / 15,213 行为行出自 `docs/superpowers/plans/2026-10-07-trial-merge-conflict-table.md`，本刀没重算 —— 记为"照旧引用，未现算"。

- [ ] **Step 7: 更新记忆 + 推送（fast-forward 已预授权；不开 PR）**

更新 `project-copaw-release-channel.md`（阶段 1 已闭、六笔提交哈希、门禁名与五条规则、`pending` 作为唯一可用性位、下一步是阶段 2 的 PyPI 包名核实需授权）与 `project-copaw-conflict-surface.md`（+1 宿主）。

```bash
git status --short            # 必须只剩本刀产物
git log --oneline -8
git push                       # 只 fast-forward 推 wp/integration，不强推、不开 PR
```

---

## 阶段 2 / 阶段 3：接口（本轮不写步骤）

**阶段 2 就绪时只需改这三处 + 一条命令体**

1. `src/copaw/release_channel.json`：`pending` 去掉 `"pypi"`（`pypi_project` 早就有值 ⇒ 不用动）。
2. `pyproject.toml:2`：`name = "qwenpaw"` → `name = "copaw"`；`scripts/pack/build_macos.sh:161` 与 `scripts/pack/build_win.ps1:289` 的 `importlib.metadata.version('qwenpaw')` 同步改成读 `copaw`（分发名一改，这两处立刻读不到版本）。两处 `console script` 条目保持两条都在（设计 §3）。
3. `src/copaw/cli/update_cmd.py` 的命令体：`is_ready(data, "pypi")` 为真时走真升级（读 `pypi_project` 拼 `f"{project}=={latest}"`）；**程序名分派不变** —— `invoked_as_copaw(ctx)` 为假仍 `ctx.invoke(_core_update_cmd, yes=yes)`（判据 90）。新增用例：monkeypatch 一个假 PyPI 读数，断言装的是 `copaw==` 且 `prog_name="qwenpaw"` 时仍委托上游（设计 §8 那条被本轮推迟的用例）。
4. 新建 fork 自有 `.github/workflows/copaw-release.yml`：第一步 `python scripts/release_channel.py --gh-env`，之后用 `RELEASE_PYPI_PROJECT` / `RELEASE_UPSTREAM_VERSION`；它自动进入门禁 R3 的 `copaw-*.y*ml` glob 覆盖集（无需改门禁）。
5. 验收：`pip install copaw` 出来的包能起 `copaw`，`qwenpaw` console script 仍在；`copaw update` 装的是 `copaw==`。

**阶段 3 接口**

- `pending` 去掉 `"docker"` / `"cdn"` 之前，`docker_namespace` / `download_cdn` 必须已有值（门禁 R2 就是这个双向要求）；就绪后 `deploy/docker-compose.copaw.yml`（fork 自有，0 宿主）与 `copaw-docker-release.yml` 从 `--gh-env` 取 `RELEASE_DOCKER_NAMESPACE`。
- 前端"有新版本"圆点恢复：读 `RELEASE_CHANNEL.upstream_version` / `isChannelReady`（届时把 readiness 判断补进生成器），基准不再来自上游；配套新增 `Header` 的"就绪态才出现圆点"分支用例（设计 §8 明写这条属于恢复动作，本轮无代码）。
- 产物文件名走 `asset_name(data, platform, version)`，`desktop.nsi` / `build_win.ps1` / `build_macos.sh` 三处必须同刀改（设计 §9 风险第 2 条）。

---

## 验收清单（对照设计 §10 阶段 1）

- [ ] 门禁绿：`$VENV scripts/check_release_channel_consistency.py` rc=0。
- [ ] 五条规则各自证过红：`test_check_release_channel_consistency.py` 里 R1（2 条）/ R2（2 条）/ R3（3 条）/ R4（1 条）/ R5（2 条）fixture 用例全部存在且取自现树 `/tmp` 拷贝。
- [ ] `copaw update` 仍是拒绝态（rc=1、不碰 `subprocess` / `_fetch_latest_version`），但拒绝文案里的地址来自 `release_channel.json`（Task 5 Step 2 的探针实验已证"改 JSON 会改变输出"）。
- [ ] 册只 **+1 宿主**：`src/qwenpaw/__version__.py`；其余落点逐文件对照本计划"文件结构"表与设计 §7，`check_p1_invariants.py --json` 现算 `files` = 145、`naming_lines` = 37、`mechanical_files` = 1。
- [ ] 三个安装脚本：克隆源是 `futuremeng/CoPaw.git`、非源码路径在任何环境创建之前失败并指向我们自己的 Releases、文件里不含四条上游分发身份。
- [ ] `pytest tests/unit` / `tsc -b --force` / `npm run test:run` / 既有三条门禁 / `copaw_brand.py verify` 全绿。
- [ ] 事实源里 `pending` 仍含 `pypi`、`docker`、`cdn` 三项；文案中没有任何"从 PyPI 安装 CoPaw"的承诺。
