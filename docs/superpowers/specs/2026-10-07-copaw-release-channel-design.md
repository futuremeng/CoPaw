# CoPaw 发布渠道设计

- 状态：**已批准**（用户 2026-10-08 复审通过，§9 五项待裁按本文建议答案采纳）。实施计划另出：`docs/superpowers/plans/2026-10-08-copaw-release-channel-phase1.md`（阶段 1；计划对本文有四处已核对的偏离，列在该计划开头）
- 日期：2026-10-07
- 分支：`wp/integration`（worktree `CoPaw-wp14`）
- 用户已锁的四项决定：① 范围 = 全渠道 + 自有 PyPI 包名；② 版本政策 = 跟上游同号、自加 `.postN`；③ 账号现状 = 只有 GitHub 已开，PyPI / Docker / 对象存储都没有；④ 技术方案 = 单一事实源（一个 `release_channel.json` 供 CLI / 前端 / 文档 / CI 共同读）
- 顺序（用户 2026-10-07 亲自排）：**止血两刀（已闭）→ 本设计文档 → 追上游 v2.2.1 排最后**
- 延伸：D-22 品牌边界的 R3（分发物的命名由 fork 自有的构建 overlay 决定，实现方式不许是"改上游构建脚本"）
- 前置：止血两刀已落地并推送 —— `ceeee342a`（`copaw update` 不再走上游 pip 安装器）、`ac9afd740`（console 版本徽标不再抓 PyPI、改为打开本地 CoPaw 更新指引）

---

## 1 目标与非目标

**目标**

1. "发版这件事的事实源集中成一处"：等账号就绪时只填凭据与一个 JSON，不再改代码。
2. 任何 CoPaw 用户能走到的升级路径，都不许把这台机器上的 CoPaw 换成上游 QwenPaw。
3. 一条版本线只有一个来源；未就绪的渠道在数据里显式表达"这个渠道没有"，而不是"地址未知"。

**非目标**

1. 不改 Python import 名、环境变量名、数据目录、上游 console script 名（理由见 §3）。
2. 不做用户数据迁移。
3. 不在本设计里追上游 v2.2.1 —— 那是另一串刀（实测 84 文件 / 234 块逐块裁决），且与本设计抢同一批文件（见 §9）。

---

## 2 现状盘点（全部 2026-10-07 现查）

所有权一栏 = 该文件在 base-ref `e111ec6fb`（merge-base，2026-06-03）里是否存在；在册一栏 = `scripts/check_p1_invariants.py --json --target-ref HEAD` 现算（当前册：**144 文件 / 行为 143 / +13,704 −2,272 / 命名 1·9·37 / mechanical 1**）。

| # | 链路 | 现值与落点 | 所有权 | 在册 | 状态 |
|---|---|---|---|---|---|
| 1 | PyPI 分发名 | `pyproject.toml:2` `name = "qwenpaw"` | 上游自有 | 在册（+11 −2） | 待办（阶段 2） |
| 2 | 上游自更新命令 | `src/qwenpaw/cli/update_cmd.py:353` `package_spec = f"qwenpaw=={latest_version}"` | 上游自有 | 不在册 | **止血已闭**：`src/copaw/cli/update_cmd.py` 用同名命令盖住，上游文件一个字节没动 |
| 3 | 前端更新检查 | 原 `constants.ts` 的 `PYPI_URL` + `Header.tsx` 挂载时 fetch | 上游自有 | 在册 | **止血已闭**：已删，徽标改为恒可点 |
| 4 | 前端指引正文 | `console/src/layouts/constants.ts:96` `UPDATE_MD`（zh / ru / en 三门真译文） | 上游自有 | 在册 | **止血已闭**：只写 CoPaw 的 Releases |
| 5 | Releases / 源码仓库指向 | `console/src/layouts/constants.ts:3` `GITHUB_URL = "https://github.com/agentscope-ai/QwenPaw"`；同文件 `:79 :82 :85 :88` 四个文档站链接指 `qwenpaw.agentscope.io` | 上游自有 | 在册 | 待办，且文档站归属要裁（§9） |
| 6 | 安装脚本 | `scripts/install.sh:31` / `scripts/install.ps1:34` / `scripts/install.bat:25` 克隆 `agentscope-ai/QwenPaw.git`；`install.sh:264` / `install.ps1:315` 装 `qwenpaw==<version>` | 上游自有 | 三个都在册（+4−1 / +8−0 / +8−4） | **待办，当前最尖锐的一条**：按我们的文档跑我们的脚本，装进来的是上游产品 |
| 7 | Docker | `docker-compose.yml:13` `image: agentscope/qwenpaw:latest`；`.github/workflows/docker-release.yml:22-23` `ACR_REGISTRY` / `IMAGE: agentscope/qwenpaw`；`scripts/docker_sync_latest.sh:63`；`scripts/docker_build.sh:17` 默认 tag `qwenpaw:latest`；`deploy/Dockerfile:94` `uv pip install .`（与分发名无关） | 上游自有 | **五个都不在册** | 待办（账号未就绪 ⇒ 在事实源里标 pending；动 YAML 的代价见 §7） |
| 8 | 下载 CDN | `website/src/pages/Downloads/constants.ts:3`；`src/qwenpaw/plugins/download_catalog.py:17`；`src/qwenpaw/local_models/manager.py:48` 均指 `download.qwenpaw.agentscope.io` | 上游自有 | 不在册 | 待裁（§9）：后两枚是**运行时代码**，我们没有对应桶 |
| 9 | 桌面包产物名与版本读取 | `.github/workflows/desktop-release.yml:90,134,201,247,271-274`（`QwenPaw-Setup-*.exe` 等）；`scripts/pack/desktop.nsi`；**`scripts/pack/build_macos.sh:161` 与 `build_win.ps1:289` 用 `importlib.metadata.version('qwenpaw')` 读已装分发的版本** | 上游自有 | `build_macos.sh` 在册（+18 −5） | 待办（阶段 2）：分发名一改，这两处立刻读不到版本 |
| 10 | 版本线 | `src/qwenpaw/__version__.py:2` `__version__ = "1.1.11b1"`；`pyproject.toml` 的 `[tool.setuptools.dynamic]` 从它取版本 | 上游自有 | **不在册（逐字同 merge-base）** | 待办（§5，本设计唯一一处新增宿主） |

**顺带核到的一条现成证据支持 §5**：`scripts/pack-tauri/sync_tauri_version.mjs:27` 的版本正则里**已经包含 `.postN`**（`(?:\.post(\d+))?`）——"跟上游同号 + 自加 postN"不是新发明，是现有打包链已经支持的形状。

**可复用的账册机制**：`scripts/copaw_brand.json` + `copaw_brand.py`（export / apply / strip / verify）已经是"把对上游文件的改动做成可回放账册"，现数 **9 文件 / 37 行**，其中正包含本设计要动的 `console/src/layouts/{constants.ts,Header.tsx}`、`scripts/install.bat`、`scripts/pack/{build_macos.sh,build_win.ps1,desktop.nsi}`。也就是说"改上游文件"在这个项目里不是裸改，是记账 + 一条命令回放。

---

## 3 名字边界：哪些标识符属于发布渠道，哪些不属于

要改的是六个**对外分发身份**：PyPI 分发名、Docker 命名空间、Releases 仓库、下载 CDN、更新检查源、产物文件名。

**明确不属于本次范围、并建议永不改的三类**（D-22"品牌只随所有权走"的延伸）：

1. **import 名 `qwenpaw` / `copaw`**：`packages = { find = { where = ["src"] } }` 意味着分发改名对 Python 代码零影响；动 import 名的代价现算是——`qwenpaw` 这个 token 在 `src/` 的 `.py` 里占 **521 行**，在全仓跟踪文件里（排除 `node_modules` / `console/dist` / `egg-info`）占 **6,728 行**。
2. **`QWENPAW_*` 环境变量、`~/.qwenpaw` 数据目录、配置键**：改了会让老用户在升级时丢配置 —— 那是数据迁移工程，不是发布渠道。本设计只要求"CoPaw 渠道必须能读上游已装实例的目录"，即**升级不搬家**。
3. **上游 console script `qwenpaw`**：`[project.scripts]` 里 `qwenpaw` 与 `copaw` 两条原样保留。删它等于删掉用户的既有习惯。

**一处必须跟着改、否则改名立刻咬人**：§2 第 9 行那两个 `importlib.metadata.version('qwenpaw')`。已核实这是全仓仅有的"按分发名读版本"的读点（Python 侧唯一的 `metadata.version()` 调用读的是 `reme-ai`，`src/qwenpaw/agents/memory/reme_light_memory_manager.py:163`，与分发名无关）。

**一处分发名的连锁成本（要接受，不打算阻止）**：PyPI 上 `copaw` 与 `qwenpaw` 是两个不同的包，可以同时装，而两边都提供 `qwenpaw` 这个 console script，pip 会静默覆盖。上游包不是我们能控的；应对只写在文档与安装脚本里："装 CoPaw 渠道用 `pip install copaw`，跑 `copaw`"。

---

## 4 单一事实源：`release_channel.json`

**落点**：`src/copaw/release_channel.json`。`src/copaw/` 是 D-16 排除目录，不计入冲突册 ⇒ 事实源本身**零宿主**。

```json
{
  "distribution": "copaw",
  "pypi_project": "copaw",
  "upstream_version": "1.1.11b1",
  "docker_namespace": null,
  "github_repository": "futuremeng/CoPaw",
  "download_cdn": null,
  "assets": { "windows": "CoPaw-Setup-{version}.exe", "macos": "CoPaw-{version}-macOS.zip" },
  "pending": ["pypi", "docker", "cdn"]
}
```

`upstream_version` = "我们最后一次真同步进来的那个上游号"，由同步刀更新，不是上游当前值（上游现在是 `2.2.1`；拿它当基准比会永久红）。

**四个读取方，各走本项目已有的机制，不新造协议**

| 读取方 | 方式 | 现成先例 |
|---|---|---|
| Python | `src/copaw/release_channel.py` 一个小 loader（`json.load` + 字段名常量），`copaw update`、CLI 文案、诊断自检查都从它取 | `src/copaw/cli/{app_command,update_cmd}.py` 已经是 fork 自有 overlay |
| GitHub Actions | 一步 `python scripts/release_channel.py --gh-env` 往 `$GITHUB_ENV` 写 `RELEASE_DISTRIBUTION=copaw` 等 | `desktop-release.yml:31-41`（pwsh 正则抽 `__version__.py`）与 `:101-103`（sed 抽版本写 `$GITHUB_OUTPUT`）已经是"从一处读版本"的形状 |
| Shell / PowerShell 安装脚本 | `python scripts/release_channel.py --sh` 出 `export` 行 | `scripts/copaw_brand.py` 已是"脚本读账本"这种形状 |
| 前端 | 提交进仓库的生成文件 `console/src/generated/releaseChannel.ts` | `console/src/layouts/constants.ts` 已是常量集散地（`console/src/generated/` 目前不存在，是新目录） |

**命名避让（对批准稿的一处改动，用户 2026-10-08 复审确认）**：批准稿里 CI / 安装脚本的入口写作 `scripts/channel.py`。现仓已有 `scripts/check_channel_contracts.py`，那里的 "channel" 指**聊天渠道**（钉钉 / 飞书 / Discord）。同一个仓库里两个 "channel" 会让人读错，因此改名为 `scripts/release_channel.py`、环境变量前缀 `RELEASE_`。概念、字段、行为都不变，只是名字。

**承重轴：`pending` 必须能区分"没有这个渠道"和"渠道地址未知"**。loader 对 `null` 返回 `None`（不是空串），前端拿到 `null` 就不发那个请求。现在这个弹窗的病根正是"把上游渠道当成我们的渠道去查"——若新设计允许"空串 ⇒ 仍然请求"，同样的病会复发。

**为什么前端那份生成文件要提交**（与 Tauri 那条 gitignore 相反）：`sync_tauri_version.mjs` 的注释说版本号文件不能提交，因为它每次发版都变、提交就变成 rebase 后的陈旧值。渠道标识符一年变不了两次，而 `tsc -b --force` 和 vitest 都要读它；不提交就得让类型检查依赖一次 codegen 的执行顺序，那是新的脆弱点。配套门禁：**重新生成后 `git diff --quiet` 必须干净**（改了 JSON 忘了改前端就红）。

---

## 5 版本线：上游同号 + 自加 `.postN`

规则：同步上游后 `src/qwenpaw/__version__.py` 那一行等于上游给的号（`post` 归零）；两次同步之间我们自己的补丁递增 `.post1`、`.post2`。发 `copaw` 包时 `pyproject.toml` 的 `version = {attr = "qwenpaw.__version__.__version__"}` 原样不动。

两件事已实测：`Version("1.1.11b1.post1")` 能解析（同时是 prerelease 与 post-release），且 `scripts/pack-tauri/sync_tauri_version.mjs:27` 的正则接受"预发布段 + `.postN`"这种组合 ⇒ 预发布号上带 post 不会在打包链里被拒。

**定价（本设计唯一一处新增宿主）**：`__version__.py` 现在与 merge-base 逐字相同（§2 第 10 行：不在册），写它就是 **+1 冲突宿主 / 1 行**，同时进 `copaw_brand.py` 那种"整行 old/new 账册"，同步时一条命令回放。

**为什么不用"零宿主"的办法**：把 `attr` 改指一个 fork 自有版本模块确实零宿主，但那四个上游读点会继续报上游号 —— `src/qwenpaw/app/_app.py:662`（前端 `api.getVersion()` 读的 `/version` 响应）、`src/qwenpaw/cli/doctor_cmd.py:908`（CLI 与服务端版本对账）、`src/qwenpaw/utils/telemetry.py:55`、`src/qwenpaw/cli/update_cmd.py:594`。我们发出去的包是 post 号，那四处报另一个号，其中一个还是"有没有新版"的判断基准 —— 正好造出这次要修的那类病。**一条版本线只能有一个来源**，所以付 1 行宿主，换所有读点自动一致。

（四个读点里 `update_cmd.py:594` 在我们盖住它之后已不在 CoPaw 路径上，但它在 `qwenpaw` 程序名分派下仍会被委托执行，所以仍要计入。）

---

## 6 未就绪 / 就绪两态下各链路的行为

| 链路 | 现在（未就绪，止血后的状态） | 就绪后 | 谁负责切换 |
|---|---|---|---|
| `copaw update` | 打印版本 + "CoPaw is not published to PyPI yet" + Releases 链接，退出码 1，不执行任何 pip/uv | 从事实源读 `pypi_project`，比对基号后 `pip install copaw==<latest>` | `pending` 里去掉 `pypi` 那一把刀；命令体仍按**程序名分派**（判据 90：非 `copaw` 一律委托上游） |
| `qwenpaw update` | 上游原行为（委托，未被我们改） | 同左 | 不变 |
| 版本徽标 | 恒可点，打开本地三语指引，不发任何网络请求 | 恢复"有新版本"圆点，基准来自 `releaseChannel.ts`（由 JSON 生成） | 阶段 3 |
| 上游四条发布 workflow（`publish-pypi` / `docker-release` / `desktop-release` / `plugins-release`） | 仍在仓库里；靠 GitHub 设置**停用**，不改 YAML | fork 自有 `copaw-release.yml` / `copaw-docker-release.yml` 承担发布 | 停均是仓库设置动作，需要授权，不在代码里 |
| 安装脚本 | 仍克隆上游仓库（§2 第 6 行）| 克隆源、包名、索引全部从事实源取 | **阶段 1 就做**：这是当前唯一"照着官方步骤装错产品"的路径。**未就绪期的具体行为要定死**：源码分支（克隆）改指 `futuremeng/CoPaw`；PyPI 分支（`install.sh:264` / `install.ps1:315` 那种 `qwenpaw==<version>`）在 `pending` 含 `pypi` 时必须**显式失败并指向 Releases**，既不许装上游 `qwenpaw==`，也不许去装一个还不存在的 `copaw==` |

---

## 7 冲突宿主与账册定价（按现算读数）

| 落点 | 是否新增宿主 | 说明 |
|---|---|---|
| `src/copaw/release_channel.{json,py}`、`scripts/release_channel.py`、`console/src/generated/releaseChannel.ts`、fork 自有 workflow | **0** | fork 自有文件不计入册（D-16） |
| `src/qwenpaw/__version__.py` | **+1** | §5；本设计唯一的净新增宿主 |
| `pyproject.toml`、`console/src/layouts/constants.ts`、`scripts/install.{sh,ps1,bat}`、`scripts/pack/build_macos.sh`、`build_win.ps1`、`desktop.nsi` | **0** | 都已在册，只加行；改动逐条进 `copaw_brand.json` 账册 |
| `docker-compose.yml`、`website/src/pages/Downloads/constants.ts`、`src/qwenpaw/plugins/download_catalog.py`、`src/qwenpaw/local_models/manager.py`、上游四条 workflow | **0（本设计选择不改它们）** | 全不在册，改即新增宿主；Docker 走 fork 自有编排文件与 fork workflow，CDN 那三枚列为待裁（§9） |

净定价：**冲突宿主 +1**（`__version__.py` 一行）。⚠ 面侧读数（133 文件 / 15,213 行为行）本设计没重算，它的出处是 `docs/superpowers/plans/2026-10-07-trial-merge-conflict-table.md`，不是 `check_p1_invariants.py` 的输出。

---

## 8 门禁与测试

**新门禁 `scripts/check_release_channel_consistency.py`**，五条规则：

1. **权威性**：`pending` 是唯一的可用性位 —— 读取方判断"这个渠道能不能用"只看它在不在 `pending` 里，不看字段是否为空。`pypi_project` 是**名字**不是地址，允许在账号就绪前就有值（`copaw`），否则未就绪期没有任何地方能写出我们的包名。
2. **地址类字段**（`docker_namespace`、`download_cdn`）在对应项离开 `pending` 之前必须为 `null`；反过来 `pending` 里没有的项，其字段必须非 `null`。
3. **禁止串清单**：fork 侧渠道文件（安装脚本、前端指引、fork workflow）里出现 `pypi.org/pypi/qwenpaw`、`agentscope-ai/QwenPaw.git`、`agentscope/qwenpaw` 即红。禁止串取自键值本身，不取任何一门语言的文案（判据 83）。
4. `console/src/generated/releaseChannel.ts` 与 JSON 同步：重新生成后 `git diff --quiet` 必须干净。
5. 版本线：`Version(__version__)` 可解析，且**只剥掉 `.postN` / `.devN` 之后剩下的完整号**（含预发布段）必须等于 JSON 里的 `upstream_version`。⚠ 不能用 `Version.base_version` —— 实测 `Version("1.1.11b1.post1").base_version` 是 `1.1.11`，`b1` 会被丢掉，比出来必然错。**上游 ref 在本地不存在时报错而不是静默跳过**（判据 73：一条为空的读数要先问覆盖集）。

**证红落点**：全树拷到 `/tmp` 或用 fixture，不在工作树里证红（本项目既有约束）。

**用例按先红后绿**（止血已建立的那批继续留在树上，不重写）：

- Python：loader 对 `null` 返回 `None`；`pending` 与字段一致性；`copaw update` 在未就绪态**不触碰** `subprocess` / `_fetch_latest_version`（已有 `no_installer` 夹具）；就绪分支新增一条（monkeypatch 一个假 PyPI 读数，断言它装的是 `copaw==`，且程序名不是 `copaw` 时仍委托上游）。
- Shell / PS：`--sh` 出串的形状用例（fixture 仓库，不真跑安装）。
- 前端：生成常量与 JSON 逐字段一致；`Header` 挂载时不发网络请求（已有）；新增"就绪态才出现圆点"的分支用例。
- 全套照旧：五表 + `tsc -b --force` + `npm run test:run` + `PYTHONPATH=$PWD/src pytest tests/unit` + prettier + `copaw_brand.py verify`。

---

## 9 待裁、风险与未验证

**待裁（需要产品/账号决定，不能由实现顺手定）**

1. **PyPI 上 `copaw` 包名是否可占**——还没核实，查它需要网络访问，用户尚未授权。这是阶段 2 的第一件事。
2. **停用上游那四条发布 workflow** 是 GitHub 仓库设置动作，不在代码里，需要单独授权。
3. **文档站链接归属**：`constants.ts:79 :82 :85 :88` 四处指 `qwenpaw.agentscope.io`（介绍 / FAQ / 发布说明 / 功能示例），`GITHUB_URL`（`:3`）指上游仓库。前者是**上游的内容资产**，我们没有对应站点；后者是**我们的仓库**。建议：`GITHUB_URL` 随阶段 1 改成 `futuremeng/CoPaw`（它是"看源码 / 去 Releases"的落点，属分发身份），文档站链接暂不改，并在 CoPaw 指引里写明"文档目前在上游站点"。这条要点头。
4. **三个运行时下载点**（`plugins/download_catalog.py:17`、`local_models/manager.py:48`、`website/.../Downloads/constants.ts:3`）：我们没有桶，现在装完会 404。改它们要动上游运行时代码 = 3 个新宿主；不改则接受"插件/模型下载在上游桶里"这一现实。建议列成单独一笔裁决，不并进渠道刀。
5. **`docker-compose.yml:13`**：改一行镜像名 = +1 宿主；不动 = 我们的用户按 compose 起的是上游镜像。建议 fork 自有 `deploy/docker-compose.copaw.yml`（0 宿主），等 Docker 账号就绪再启用。

**风险 / 未验证（别当结论用）**

- 停掉上游 workflow 后，`desktop-release.yml` / `plugins-release.yml` 里的 OSS 凭据（`:310` 读 `secrets.OSS_ENDPOINT`）在 fork 侧全部为空 —— 我们的桌面包发布链**从没真跑过**，第一次跑必然要现场调试 secret 名称。
- Windows / macOS 桌面包在 `CoPaw-*` 产物名下的安装与升级路径没实测过；`desktop.nsi`、`build_win.ps1`、`build_macos.sh` 三处产物名是同一批改动的三个落点，容易只改一处。
- 本设计与追同步抢同一批文件（`Header.tsx`、`constants.ts`、`pyproject.toml`、`console/index.html`、`i18n.ts`）。实测追 v2.2.1 = 101 个冲突文件 / 84 文件 234 块，追 main = 112 / 85 文件 258 块。**建议阶段 1 先做完（它不等账号、只 +1 宿主），再追同步**，否则同一批文件要判两遍。
- `upstream_version` 这个新字段是同步刀的责任：同步完成后没更新它，门禁第 4 条立刻红 —— 这是刻意的（红得比静默漂移便宜）。

---

## 10 分期与验收

**下一步的实施计划只覆盖阶段 1**（阶段 2 / 3 的开关是账号凭据，不是代码；本轮计划只写它们的接口，不写实现步骤）。

**阶段 1（不等任何账号，可立即做）**：事实源 JSON + Python loader + `scripts/release_channel.py` + 前端生成文件与接线 + 门禁五条规则 + 安装脚本的克隆源/包名改指我们仓库 + 版本线写回 `__version__.py`（含 `.post1`）与品牌账册登记 + `copaw update` 文案改为从事实源读。
验收：门禁绿且五条规则各自证过红；**册只 +1 宿主**（`__version__.py`），其余落点逐文件对照 §7；`pytest tests/unit` / `tsc -b --force` / `npm run test:run` 全绿；`copaw update` 仍是拒绝态，但拒绝文案里的地址来自 JSON。

**阶段 2（PyPI 账号就绪）**：`pyproject.toml:2` 分发名 `qwenpaw` → `copaw`；§3 那两个 `importlib.metadata.version('qwenpaw')` 跟着改；fork 自有发布 workflow；`copaw update` 从拒绝改为真升级（仍按程序名分派）；`pending` 去掉 `pypi`。
验收：`pip install copaw` 出来的包能起 `copaw` 且 `qwenpaw` console script 仍在；升级命令装的是 `copaw==`。

**阶段 3（Docker / 对象存储就绪）**：Docker 命名空间与 fork 镜像 workflow；前端"有新版本"圆点恢复；`pending` 清空。

**明确不做**：改 import 名 / 环境变量 / 数据目录 / 上游 console script 名；把上游四条 workflow 的 YAML 改成发我们的渠道；用户数据迁移；在本设计里顺手追 v2.2.1。
