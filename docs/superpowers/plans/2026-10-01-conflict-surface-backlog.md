# 与 upstream 同步的冲突面清单（155 个文件）

> **这份文件的用途**：记录"下一次把仓库对齐到 upstream 2.x 时必然会产生合并冲突的文件"，并按搬迁成本分簇排序。它是**输入清单**，不是执行计划；每个簇的实施计划单独写。
> 判据来自两条总目标：① 最终要与最新 upstream 对齐，并能在保持同步的前提下长出 CoPaw 工作界面；② 短期是"去债 + 保成果"—— 去债 = 缩小与 upstream 的冲突与差异，保成果 = 把对 upstream 的有益修改转移到 CoPaw 自有区域，**而不是直接丢弃**。

**生成时间**：2026-10-01。数据来源：分支 `wp/02-ownership` HEAD `462a1cf0f`，merge-base `e111ec6fb`，upstream 基线 `upstream/main`（= 2.x）。**第 1–4 节在 `297b37b1a` 上做过一次读数修正**（重命名检测，见 §1 那条注），第 4 节同时补了那 18 个文件的逐文件落点判定。

## 1 口径

一个文件进这张表，必须同时满足三条：

1. **上游自有**：该文件在 merge-base `e111ec6fb` 里存在（fork 新建的文件不算，它们不会冲突）；
2. **fork 侧有逻辑改动**：按 `scripts/check_p1_invariants.py` 的行为/命名分册规则，去掉纯改名后仍有改动行（`behavior_added + behavior_removed > 0`）；
3. **上游侧也改过**：`git diff --no-renames e111ec6fb upstream/main -- <path>` 非空。

> **`--no-renames` 是必须的**（本清单第一版踩过这个坑，2026-10-01 修正）：默认 `git diff` 会做重命名检测。上游把 `app/runner/` 改名成 `app/chats/` 时，旧路径只出现在 `R` 行的源端、不进 `--name-only` 输出，于是 `runner/{session,__init__,query_error_dump}.py` 三个文件被误判成"上游没碰"。加 `--no-renames` 后它们变成 `D` + `A` 两条，三个读数从 152 / 16 / 15 修正为 **155 / 13 / 18**。第 2、3、4 节用的是修正后的数；第 5–7 节的分桶表是第一版生成的、少那 3 行，补录见 §7.1。

排除项：`console/package-lock.json`（机械差异，单独处理）。

复现命令（在 worktree 根目录）：

```bash
# 主仓的 venv 解释器（worktree 没有自己的 venv），路径按本机情况替换
PY=<主仓 CoPaw>/.venv/bin/python
CI=true PYTHONPATH=src $PY scripts/check_p1_invariants.py --json > /tmp/p1.json
git diff --no-renames --name-only e111ec6fb upstream/main > /tmp/upstream_changed.txt
```

把 `/tmp/p1.json` 里 `behavior_added + behavior_removed > 0` 的路径与 `/tmp/upstream_changed.txt` 取交集，即下表 155 行。

## 2 总量读数

| 项 | 数值 | 含义 |
|---|---|---|
| fork 侧有逻辑改动的上游文件 | 168 | 全仓 P1-行为口径（不含 lockfile） |
| 其中上游在 1.x→2.x 也改过 | **155** | **下次同步必然冲突** |
| 只被 fork 改、上游没碰 | 13 | 可以原样带走，不产生冲突 |
| 上游已在 2.x 删除 | **18** | 其中 **15 个是真删除（静默丢失）**、3 个是改名（`app/runner/` → `app/chats/`，会以普通冲突出现，看得见） |
| 这 155 个文件上 fork 的改动行数 | 17,106 | 全仓 P1-行为 17,633（+15,049/−2,584）的子集，差额 527 行在"只被 fork 改"那 13 个文件上 |
| 上游在这 155 个文件上的改动行数 | 75,308 | 冲突的另一侧体量 |
| 纯改名行数（D-22 品牌税） | 126 行 / 22 文件，其中 4 个文件 | 占侵入量的 **0.7%**，见 `docs/copaw-brand-boundary.md` |

按 fork 侧改动量分桶：**≤10 行 50 个**（多数可机械搬或还原）、**11–60 行 57 个**（逐条判归属）、**>60 行 48 个**（需要设计，见第 5 节）。

## 3 按簇分布与处置方向

| 簇 | 文件数 | fork 行 | 上游行 | 上游已删 |
|---|---|---|---|---|
| A console/src/locales/*.json（界面文案） | 6 | 304 | 20,850 | 0 |
| B console/src/plugins（插件宿主） | 2 | 54 | 315 | 0 |
| C console/src/api（前端 API 客户端） | 15 | 2,356 | 1,569 | 1 |
| D console/src/pages（前端页面） | 43 | 3,229 | 21,532 | 6 |
| E console/src/components（前端组件） | 7 | 90 | 1,886 | 1 |
| F console/src/layouts（布局与顶栏） | 5 | 135 | 3,490 | 0 |
| G console/src 其它（App.tsx / i18n.ts / utils / styles） | 4 | 165 | 1,284 | 0 |
| H console 配置（tsconfig / vite / package.json） | 3 | 73 | 245 | 0 |
| I src/qwenpaw/app/routers（后端 HTTP 路由） | 9 | 5,676 | 5,875 | 1 |
| J src/qwenpaw/app/runner（会话与消息处理） | 6 | 1,163 | 1,270 | 6（其中 3 个改名到 `app/chats/`） |
| K src/qwenpaw/app/mcp（MCP 客户端） | 3 | 1,330 | 1,282 | 3 |
| L src/qwenpaw/app 其它（_app / migration / workspace / flow_engine 等） | 8 | 677 | 3,224 | 0 |
| M src/qwenpaw/agents（agent 工具、记忆、技能、prompt） | 11 | 654 | 3,975 | 0 |
| N src/qwenpaw/config（配置模型与工具） | 4 | 142 | 3,216 | 0 |
| O src/qwenpaw/cli（命令行） | 1 | 345 | 141 | 0 |
| P src/qwenpaw 其它（providers / constant / security / token_usage） | 7 | 249 | 2,899 | 0 |
| Q scripts/pack（桌面打包） | 2 | 41 | 11 | 0 |
| R scripts 其它（install.* / README） | 3 | 21 | 43 | 0 |
| S website/public/docs（文档站正文） | 4 | 12 | 325 | 0 |
| U .github（CI 与模板） | 2 | 26 | 124 | 0 |
| V 仓库根（pyproject / Makefile / CONTRIBUTING / deploy 等） | 10 | 364 | 1,752 | 0 |

各簇的落点与前置条件：

**A — console/src/locales/*.json（界面文案）**。fork 在此新增 302 行私有文案 key。落点已存在：`console/src/locales/copaw/{projects,pipelines,rpa}/*.json`（18 个 fork 自有文件，+2,762/−0）。把这 6 个文件里的 key 迁过去，6 个冲突文件直接清零。**前置未验证**：v2 `console/src/i18n.ts` 用 `createInstance` + `as const` 硬编码 7 个 loader，全仓无 `addResource`，fork 现在靠改 `i18n.ts` 的 36 行 import 注册 —— 注册面本身也要搬出上游文件。

**B — console/src/plugins（插件宿主）**。插件宿主代码。落点 = v2 的 `plugins/api.py`（17 个 `register_*`）与 PawApp SDK；不在上游宿主文件里加分支。

**C — console/src/api（前端 API 客户端）**。前端 API 客户端（`api/modules/agents.ts` +718、`api/types/agents.ts` +617 等）。落点 = fork 自有 `console/src/copaw/api/*`，经 v2 的 plugin/宿主接缝引用。

**D — console/src/pages（前端页面）**。页面级改动，最大的簇。落点 = 工作台（`console/src/copaw/workbench/`，fork 自有目录）+ v2 的 route/menu 注册；`route.replace(pluginId, "core.root", …)` 是 D-12 默认落地界面的实现路径，**其作用域未验证**。

**E — console/src/components（前端组件）**。组件级，多数改动很小。逐条判：能搬到 fork 自有组件就搬，纯文案还原。

**F — console/src/layouts（布局与顶栏）**。布局与顶栏，含品牌可见面（`Header.tsx` 的 `<span>CoPaw</span>`、`index.module.less`）。落点 = v2 的 `<Slot name="header.logo" kind="replace">`（`AppBrand.tsx:297`，上游测试 `index.module.test.ts:38` 钉住）。这是 D-22 阶段 B 的内容，不在阶段 A。

**G — console/src 其它（App.tsx / i18n.ts / utils / styles）**。`App.tsx`（§6.1 在册例外之一）、`i18n.ts`（36 行注册面）、`utils/navigationMode.ts`（§6.1 另一例外）、`styles/layout.css`。`navigationMode.ts` + `App.tsx` 是封闭清单 2 文件，其余要搬。

**H — console 配置（tsconfig / vite / package.json）**。构建配置。`vite.config.ts` +25、`package.json` +21/−13（含 fork 的 `postinstall: patch-chat-flushsync.mjs` 树外 patch，版本锁 `^1.1.64-beta` vs v2 `1.2.0-beta` → 同步时几乎确定失效）。落点 = fork 自有构建包装。

**I — src/qwenpaw/app/routers（后端 HTTP 路由）**。后端路由，**单簇侵入最大（5,676 行，其中 `app/routers/agents.py` 一文件 +4,190/−326）**。D-16 已把实现下沉进 `src/qwenpaw`，所以这里剩的是"路由注册 + 上游 agents 路由被改写"。落点 = v2 插件路由（`plugins/registry.py` 硬拼 `/api` 前缀，`register_middleware` 是请求级不是 ASGI ⇒ 拿不到顶层 mount，已实测）。这一簇需要 WP-03/04 的 PawApp 化设计，不能机械搬。

**J — src/qwenpaw/app/runner（会话与消息处理）**。上游把整个 `app/runner/` 换成了 `app/chats/`：**22 个文件、3,187 行删除**。fork 有改动的那 6 个里 3 个（`session.py` / `__init__.py` / `query_error_dump.py`）被 v2 改名带走（同步时是普通冲突，看得见），另外 3 个（`api.py` / `command_dispatch.py` / `models.py`）是重写后当作删除处理（属于静默丢失那 15 个）。逐文件判定见 §4.3 —— 结论比"整簇要搬"轻得多：绝大部分 fork 改动已被 v2 用别的实现覆盖（`DROP`，含本轮改判的**历史分页**），真正需要搬的是 `tail-user/delete` 端点与 `ChatUpdate.meta` 的写路径两件，`.snapshot` sidecar 与 chat runtime-status 各待一项用户裁决。

**K — src/qwenpaw/app/mcp（MCP 客户端）**。`app/mcp/{manager,stateful_client,watcher}.py` **三个文件在 v2 里全部不存在**（上游删了 1,282 行），而 fork 在 `stateful_client.py` 里有 +690/−396。**v2 的落点已查清**（`UPSTREAM_V2_MIGRATION_PLAN.md` §8 已闭环 33）：MCP 被收敛进 driver 体系 —— `drivers/handlers/{mcp,mcp_stateful_client,mcp_streamable_http}.py`（`mcp_stateful_client.py` 1,084 行，`_MCPClientMixin` / `StdIOStatefulClient` / `HttpStatefulClient` 同名同位）+ `drivers/manager.py` + `app/driver_config_watcher.py` + 配置面 `app/mcp/{config_service,schemas}.py`。fork 那六项私有能力里，**配置 mtime 快照热重载已被 v2 的 `app/driver_config_watcher.py` 覆盖（`DROP`）**，其余五项（`refresh_client_status` / `failed_keys` / `_probe_client_capabilities` / `_resolve_stdio_command` / httpx 异常链诊断）在 v2 全树**逐符号命中 0** ⇒ 这一簇不存在"重放 patch"，只有 `搬迁`（`_resolve_stdio_command`，搬到构造 endpoint 配置那一层）、`原生`（走 v2 接缝重表达）与 `CUT` 三种标签。

**L — src/qwenpaw/app 其它（_app / migration / workspace / flow_engine 等）**。`_app.py`(+43/−15)、`migration.py`(+156/−125)、`agent_config_watcher.py`(+221/−110)、`agent_context.py`(+59/−33)、`workspace/*`、`multi_agent_manager.py`。这一簇混杂：`_app.py` 的两行是 D-22 品牌 patch（还原即可），其余逐条判归属。

**M — src/qwenpaw/agents（agent 工具、记忆、技能、prompt）**。agents 工具与记忆。含 `audio_transcription.py`(+335/−5，fork 加的本地 whisper 自动安装)、`file_io.py`(+60)、`prompt.py`(+31)。落点 = v2 的 agent 扩展接缝（`register_*` / skill 目录），逐条判。

**N — src/qwenpaw/config（配置模型与工具）**。`config/config.py`(+73/−3)。**已识别的减面机会**：上游该文件里紧挨 `class Config` 之前有一整段连续的 200 行 / 17 个 fork 私有模型（`Knowledge*`、`GraphifyConfig`、`AgentsSquare*`、`SkillsMarket*`），搬到 fork 自有模块 + 留一段 re-export import，可减约 200 行行为侵入并缩小与 v2 的冲突面。

**O — src/qwenpaw/cli（命令行）**。`cli/desktop_cmd.py`(+212/−133)。桌面 CLI 被 fork 大改；v2 侧同文件上游也改了 141 行。落点 = fork 自有 CLI 命令（`src/copaw/cli/*` 已有 `app_command.py` 等先例，entry point `copaw` 是上游自己发布的）。

**P — src/qwenpaw 其它（providers / constant / security / token_usage）**。providers / constant / security / token_usage。`constant.py` 只 +1 行；`providers/openai_chat_model_compat.py` +114/−11 需要判上游 v2 是否已有等价兼容。

**Q — scripts/pack（桌面打包）**。`scripts/pack/build_macos.sh`(+15/−2 行为 + 3 命名)、`build_win.ps1`（纯命名 7 行）。落点 = D-22 §4 的 fork 自有构建 overlay；顺序要求是先建 overlay 再还原这 25 行命名。

**R — scripts 其它（install.* / README）**。`scripts/install.bat`(+6/−2 行为 + 2 命名)、`install.sh`(+4/−1)、`install.ps1`(+8)。落点 = fork 自有安装脚本。

**S — website/public/docs（文档站正文）**。文档站正文 4 文件（`cli.{en,zh}.md`、`desktop.{en,zh}.md`），阶段 A 还原 67 行命名后各剩 2 行。落点 = 新建 `website/public/docs/copaw/*` 或 fork 自有页面，需查 v2 文档站的注册方式（未验证）。

**U — .github（CI 与模板）**。.github 2 文件（`frontend-tests.yml` +10 是 fork 的 locale guard 步骤、`ISSUE_TEMPLATE/config.yml` +3）。落点 = fork 自有 workflow 文件（D-22 的 `copaw-desktop.yml` 就是这个模式）。

**V — 仓库根（pyproject / Makefile / CONTRIBUTING / deploy 等）**。仓库根 10 文件（`pyproject.toml` +10 依赖与 package-data、`Makefile`、`CONTRIBUTING*`、`.gitignore`、`deploy/Dockerfile`、`README*` 4 篇）。README 4 篇里 fork 自写章节共 16 行品牌内容属此类；`pyproject.toml` 的 +10 与产品名无关（实测 = 4 行依赖 + 1 行 package-data 等），不要当品牌税处理。

## 4 搬家窗口：上游在 2.x 删除或改名的 18 个文件

这一组最紧急。fork 的改动落在上游已经决定不再以原路径存在的文件上，**一旦同步到 2.x，这些改动连同它们实现的功能会一起消失**，其中真删除那 15 个连合并冲突都不会产生（没有文件可冲突，静默丢失）。

本节给出逐文件落点判定。**标签口径**（与 `UPSTREAM_V2_MIGRATION_PLAN.md` §4 一致）：`DROP` = 上游已用另一套实现覆盖同一件事，删掉 fork 改动不丢用户可见功能；`原生` = 需求仍然成立，但要改成走 v2 的扩展接缝重表达；`搬迁` = 需求成立且 v2 无等价物，实现必须移到 fork 自有位置；`CUT` = 显式放弃并写进决策记录。

### 4.1 总量

| 分组 | 文件数 | fork 改动行 | 上游删除行 |
|---|---|---|---|
| 真删除（静默丢失） | 15 | 2,285 | 4,603 |
| 改名到 `app/chats/`（普通冲突，看得见） | 3 | 540 | 602 |
| 合计 | **18** | **2,825** | **5,205** |

三个整簇正好落在这里：`app/mcp` 3 文件 1,330 行、`app/runner` 6 文件 1,163 行、`console/src/pages/Agent/Workspace` 4 文件 119 行。

### 4.2 后端：`app/mcp`（3 文件 / 1,330 行）

v2 的落点已查清（`UPSTREAM_V2_MIGRATION_PLAN.md` §8 已闭环 33）：MCP 被重构进 driver 体系 —— `drivers/handlers/{mcp,mcp_stateful_client,mcp_streamable_http}.py`（`mcp_stateful_client.py` 1,084 行，`_MCPClientMixin` / `StdIOStatefulClient` / `HttpStatefulClient` 同名同位）+ `drivers/manager.py` + `app/driver_config_watcher.py` + 配置面 `app/mcp/{config_service,schemas}.py`。

| fork 改动内容 | v2 对应物 | 判定 |
|---|---|---|
| 重写客户端生命周期：取消 `_MCPClientMixin`，在两个 client 类里各自内联 `_run_lifecycle` / `connect` / `close` / `list_tools` / `call_tool`（`stateful_client.py` 那 +690/−396 的主体） | v2 保留 `_MCPClientMixin` 并把同一问题做得更深：`_is_transport_error:76`、`_is_401_error:97`、`_SessionGoneError:121`、不可取消任务处理 `_discard_task_result:108` / `_gather_uncancelled:147`、会话 RPC 排空 `_drain_session_rpcs:685`、熔断 `_circuit_open_error:828`、断连后取缓存 `_cached_tools_if_disconnected:817` | `DROP`（上游换了地基，fork 的重写无处可重放，也不该重放） |
| 配置热重载：`_read_mtime_ns` + `_snapshot_async`（`watcher.py` 26/8） | `app/driver_config_watcher.py` 已是快照差分热重载（`_last_snapshot:40`、`current == self._last_snapshot:80` 后做差分） | `DROP`（本轮新确认，把已闭环 33 的"六项"降为五项） |
| 运行时状态三件套 `refresh_client_status` / `failed_keys` / `_probe_client_capabilities`（`manager.py` 194/16） | v2 全树命中 0；v2 的"活跃"概念是 `ensure_driver_active`，不是面向控制台的状态展示 | `原生` 或 `CUT`，逐项判；控制台那半按已闭环 33 的结论对着 `drivers/adapters/{mcp_console,mcp_card_builder}.py` 重做，而不是补 fork 那版 `pages/Agent/MCP/*` |
| `_resolve_stdio_command`（PATH → 当前解释器 bin 目录的可执行文件解析，跨混部 Python 环境；fork 调用点在 `stateful_client.py:278`，即 spawn 前一行） | **复核 1：v2 起 stdio 进程不解析命令** —— `drivers/handlers/mcp.py:83` 是 `command=str(endpoint.get("command") or "")` 原样透传，`:316-336` 只校验"非空字符串"。但上游承认这个问题，只是换了位置：v2 给自己的内置 mail MCP 写了 `app/mail/driver_config.py:57 resolve_qwenpawmail_endpoint()`，优先级为 env 覆盖 `QWENPAWMAIL_PYTHON` → frozen 时取 `Path(sys.executable).with_name("qwenpaw" + suffix)`（与 fork 的"解释器兄弟 bin"同一思路）→ `find_spec` → 退化成 `"python"`。v2 全树 `shutil.which` 的命中里没有一处落在 MCP 起进程路径上 | `搬迁`，**落点必须在构造 endpoint 配置的那一层**（fork 自有），不能 patch `drivers/handlers/mcp.py`（违 D-8）。上游把解析放在"写 endpoint 时"而不是"spawn 前"，这条形状差异要带进实施计划 |
| `_is_mineru_stdio`（对 `mineru-mcp` 启动参数的特例判断） | **复核 2：mineru 不在 CoPaw 当前功能面上** —— 全仓（排除 `.venv` / `node_modules` / `__pycache__`）14 处命中，扣掉本清单自己的 3 处文档命中，只剩 `stateful_client.py:175-179` 与 `:316-324`（启动前查 `MINERU_API_KEY`，缺失就 fail fast 并 warning）；`pyproject` / `requirements` / MCP 配置种子 / 前端 **0 命中**；v2 全树 **0 命中**；`docs/devops/FORK_ROADMAP.md:22` 那行"内置 mineru_mcp"状态是**计划中**（与 jiulu_mcp 同批，从未发布） | **`CUT` 已裁（2026-10-01，用户确认）**：这 9 行是一个未发布集成的错误提示，不是能力，不保留既有条码。`docs/devops/FORK_ROADMAP.md:22` 那行"内置 mineru_mcp"**仍留在 roadmap 上（状态"计划中"，不撤）**；等 mineru 真进产品时，按 v2 的 `app/mail/driver_config.py:57 resolve_qwenpawmail_endpoint()` 形状（构造期解析 + env 覆盖）在 fork 侧重写，与 `_resolve_stdio_command` 同批处理 |
| httpx 异常链诊断 5 个 helper（`_iter_leaf_exceptions` / `_extract_http_status_error` / `_summarize_exception_chain` / `_extract_request_url` / `_log_http_lifecycle_exception`） | 命中 0；v2 有 `credentials/providers.py:135 _is_transient_oauth_status` 但只处理 OAuth 重试分类 | `原生`（走 v2 日志/错误面）或 `CUT`；注意 fork 那 2 条在册红 `test_mcp_stateful_client.py::…BaseExceptionGroup…` 会随 Python 3.11 前置动作自动消失（§8 已闭环 38） |

### 4.3 后端：`app/runner`（6 文件 / 1,163 行）

v2 把整个目录改名重写成 `app/chats/`（该路径共 22 个文件、3,187 行删除）。会话与聊天 API 的落点是 `app/chats/{api,models,session,manager,repo,utils,query_error_dump}.py`，命令派发落到 `agents/command_handler.py`。

| fork 改动内容 | v2 对应物 | 判定 |
|---|---|---|
| **历史消息裁剪**：`_truncate_chat_history_messages`（把 `plugin_call_output` 的 `data.output` 截到阈值）、`_compact_chat_history_messages`（隐藏 `plugin_call` / `plugin_call_output`）、`_paginate_chat_history_messages`、`_is_tool_trace_message*` —— `api.py:41-133`，93 行 | v2 把这件事搬到前端并加了回归测试：`console/src/pages/Chat/sessionApi/index.ts:34` 认 `plugin_call_output`、`:219` 把 system + `plugin_call_output` 映射为 role `tool` 并剥 metadata；`console/src/pages/Chat/tests/testLargeSession.test.ts` 专为 issue #5479（>500KB 会话打开报错）钉住数据变换层 | `DROP`（同一个用户可见问题，上游已 own） |
| **历史预览与 legacy 解析**：`_load_chat_history_preview_from_memory_state` / `_memory_item_to_message_dict` / `_is_user_memory_message` / `_extract_text_from_content` —— `api.py:134-211`，78 行 | v2 `app/chats/api.py:817 get_chat` 直接读 `agent.state.context`（`AgentState.model_validate`），失败回退 `parse_legacy_memory_state`（`app/chats/utils.py:110`） | `DROP` |
| **chat 级 workspace 解析**：`_resolve_chat_workspace_dir`（未加载 workspace 时直读 `chats.json`）—— `api.py:216-222`，7 行 | v2 `chats/api.py:55 get_workspace` 仍要求已启动 workspace；免启动快路径与 D-19 砍掉的 cron 快路径同族（WP-01 已把 `test_list_chats_reads_repo_without_loading_workspace` 归到同一族） | **`CUT` 已裁（2026-10-01，用户确认）**：沿用 D-19 口径，不为 7 行开一条 fork 自有路由。行为差异如实记下：同步后冷启动打开会话列表需要先加载 workspace。随 D-23 一并归档 |
| **历史分页**：`get_chat(offset, limit)`（`api.py:350`）+ `ChatHistory.total/offset/limit/has_more`（`models.py`） | v2 `GET /chats/{chat_id}`（`chats/api.py:816`）无分页参数，`ChatHistory` 只有 `messages` + `status`（`:908`），且该路由**一次性返回全量**、服务端不裁剪。**复核 4 的决定性证据**：唯一消费方 `AnywhereChat/history.ts:173-215 loadPagedChatHistory` 是一个 `while(true)` 循环，把每页累加回完整列表再返回 `{total: allMessages.length, has_more: false}` | **建议 `CUT`（本轮改判）**：分页在这里不是功能而是**传输分片** —— 客户端最终仍拿全量，UI 不做窗口化。上游对同一个用户可见问题（大会话打不开）给的是前端侧答案且有测试钉住（issue #5479、`testLargeSession.test.ts`）。留下 `offset/limit` 就是在 fork 侧重建一套 v2 没有的写接口面。风险如实记下：若 CoPaw 用户的会话大到单次响应仍然出问题，再按 `register_http_router` 自建分页读端点，那时是**新做**而不是"搬迁既有条码" |
| **删除末尾用户消息**：`POST /{chat_id}/tail-user/delete` + `ChatTailUserDeleteRequest/Response` —— `api.py:462-629`，168 行 | **复核 3 定案：v2 没有原生替代。** v2 全树对 `tail_user` / `delete_tail` / `truncate_messages` / `remove_last` / `pop_last` / `messages.delete` 命中 **0**；`app/chats/api.py` 的路由面里**没有任何消息级写路由**（只有 chat 级：`PUT`/`DELETE /chats/{chat_id}`、groups、archive、`batch-delete`、project-dirs、thinking）。v2 的 regenerate 是另一件事：`console/src/pages/Chat/index.tsx:3227` 注释 "Every turn goes through this fetch, including the SDK's own regenerate"，`:3312` "Regenerate targets this identity, never text"，机制是给 user card 与请求都挂 `clientMessageId`（`:3285`）后**重跑同一轮**，不含"改文本再发" | `搬迁` 定案。需求是"编辑最后一句重发"，身份重跑覆盖不了它。消费方实测：`AnywhereChat/index.tsx:2217` 调 `deleteTailUserMessage`，紧接 `:2239/:2242` 用 `sessionApi.removeLastUserMessage` 做本地同步 |
| **`ChatUpdate.meta`** | v2 `ChatSpec.meta` 存在（`chats/models.py:132`）且 v2 内部大量使用（`chats/api.py:866 session_model(chat.meta)`、`mgr.set_session_project_dirs`），但 `ChatUpdate`（`:180`）是 `extra="forbid"` 且**只有 `name` 一个字段**（docstring："currently used for renaming chats"）⇒ 同步后任何带 `meta` 的 PUT 直接 **422**。**复核 4 实测消费方不是 1 处而是 6 处生产调用**：`pages/Agent/Projects/ProjectDetailPage.tsx:2086`、`hooks/useProjectDesignChatController.ts:187`、`hooks/useProjectChatEnsureController.ts:167/:243`（都走 `chat.ts:161 clearChatMeta`），v2 前端 `clearChatMeta` 命中 **0** | `搬迁`（真契约差集，且是 CoPaw 项目/焦点功能的活路径）。落点不能是改 v2 的 `ChatUpdate`（违 D-8）：要在 fork 侧开一个写 meta 的端点（`register_http_router`），经 v2 的 `ChatManager` 写下去 |
| **运行时状态模型**：`ChatRuntimeStatus` + `ChatRuntimeStatusBreakdownItem`（`models.py` 108 行的主体） | **实测这条不是"丢失的成果"，而是没做完的功能**：前端调用点存在（`console/src/api/modules/chat.ts:152` → `GET /console/chats/{id}/runtime-status`，消费方 `AnywhereChat/index.tsx:1672`），但后端 `app/routers/console.py` 的路由清单里**没有**该路径（v2 console 面只有 `/chat`、`/chat/stop`、`/upload`、`/debug/backend-logs`、`/chat/task{,/{id}}`、`/push-messages`、`/inbox/*`）；`app/runner/runtime_status_store.py` 的 `RuntimeStatusRecorder` / `persist_runtime_status` / `set_current_runtime_status_context` **零生产调用者**（`token_usage/model_wrapper.py:25` 收 `runtime_status_recorder=None`，无人传）。**复核期间的附带发现**：v2 确实有一个同名不同物的端点 `GET /api/agents/{agentId}/memory/runtime-status`（`app/routers/agents.py:1465`，`response_model=MemoryRuntimeStatus`，实现在 `memory_manager.get_runtime_status(...)`，前端 `agents.ts:129` 有调用、集成测试 `test_contract_batch_agents.py:257` 钉了契约）—— 它是 **agent 记忆/ReMe 生命周期**状态，不是 per-chat 的 token/耗时分解，**不能当原生替代**；它的价值是给出上游认可的形状：manager 上放 `get_runtime_status()` + 一个 typed response model + 一条只读路由 | **`CUT` + 清理已裁（2026-10-01，用户确认）**：整套删除，不计入搬家量。删除集合 = `models.py` 里 `ChatRuntimeStatus` / `ChatRuntimeStatusBreakdownItem`（那 108 行的主体）、`app/runner/runtime_status_store.py`、`token_usage/model_wrapper.py:25` 那个没人传的 `runtime_status_recorder` 参数、前端 `api/modules/chat.ts:152`、`components/AnywhereChat/index.tsx:1672` 的消费与 `console/src/utils/chatRuntimeStatus.ts`、e2e `console/e2e/pipeline-design-chat.spec.ts:382` 的 mock。理由：它在当前树上从来不是活功能（后端无路由、store 零调用者），删它是**减债不是丢成果**；将来若真要做 per-chat token/耗时面板，按 v2 那个形状新做 |
| **命令派发**：`command_dispatch.py` +7/−17 —— fork 删掉了 `/plan <描述>` 的透传例外、把 `/stop, /approval` 缩成 `/stop`、用 `restore_in_memory_memory` 替换 `runner.context_manager.get_agent_context()` | v2 `agents/command_handler.py:153` **保留与 merge-base 相同的 plan 透传判断**，`SYSTEM_COMMANDS` 含 `plan` / `history` / `compact_str` / `auto_memory_status`（`:117-129`），短期记忆住在 `agent.state`（`:244` 注释）与 `agents/context/scroll/` 一整套 | `DROP`，全部还原上游语义（fork 那几行是给 v1 内存布局打的补丁，且砍掉 `/approval` 与 v2 的 approval 体系相冲） |
| **session 写盘加固**：`_get_file_lock` + `os.replace` 原子写 + `_parse_json_with_recovery` | v2 `chats/session.py` 已用 `utils/io_utils.get_path_lock`（`io_utils.py:58`，键是 `resolve` 后的规范路径，比 fork 的原始路径键更稳）与 `write_json_atomic_async`（`:459`），损坏 JSON 恢复已是上游一等模块 `utils/json_utils.safe_json_loads`（文件头 "JSON utilities with corruption recovery"）；`sanitize_filename`、`migrate_legacy_weixin_session_files` 也都进了 v2 `chats/session.py:31/:100` | `DROP` |
| **session `.snapshot` sidecar**：`_get_snapshot_path` / `_mirror_snapshot_unlocked` / `_restore_from_snapshot_unlocked`（写完镜像一份、主文件损坏或缺失时从 sidecar 恢复） | v2 全树 `.snapshot` 命中 0，sidecar 概念不存在 | **`CUT` 已裁（2026-10-01，用户确认）**：信任上游的解析容错，不在 fork 侧维护第二套数据一致性机制（要给上游 `SafeJSONSession` 挂 patch 也违 D-8）。代价如实记下：截断写入（写一半掉电）这类 `safe_json_loads` 救不回的情况，CoPaw 失去备份回滚这条退路 |
| **runner 包懒加载**：`__init__.py` 的 `__getattr__`（38 行，为的是导入 `runtime_status_store` 时不牵进 `runner.py`） | v2 `app/chats/__init__.py`（R067）另有其形状 | **`CUT`（随 runtime-status 那行一并清理）**：这 38 行存在的唯一理由就是懒加载 `runtime_status_store`，那条功能既判删除，这个守卫也就没有承载对象了 |
| **错误转储时间戳**：`query_error_dump.py` 的 `UTC` 常量与 `datetime.now(UTC).isoformat().replace("+00:00","Z")`（6 行） | 该文件 v2 **R100 = 逐字节未改** | `DROP`（与上游写法语义等价，只差亚秒精度） |

### 4.4 前端：9 个文件

| 文件 | fork 改动的实质 | v2 的替代界面 | 判定 |
|---|---|---|---|
| `pages/Settings/Agents/components/AgentTable.tsx`（160 行） | 两个展示列（内建/自定义、builtin 特性标签）+ `system_protected` 编辑与启停保护 | `Settings/Agents/components/AgentGallery.tsx`（配 `reorder.ts`、`AgentBackendFields.tsx`、`CopyAgentModal.tsx`）。驱动这两个列的 `is_builtin` / `builtin_kind` / `builtin_label` / `system_protected` 四个字段已由 §8 已闭环 35 判 **全部 `CUT`**（v2 用 `template_id`(`config/config.py:2328`) + `ManagedAgentProfileSpec.app_id` 派生）；`system_protected` 另受 D-14 约束；`is_builtin` 在 v2 后端 7 处、**前端 0 处** | `CUT`。若 CoPaw 仍要"内建/自定义"标签，那是 WP-07 在 AgentGallery 之上的 fork 自有扩展，不是把这 160 行搬过去 |
| `pages/Agent/Workspace/{index.tsx,index.module.less,components/FileListPanel.tsx,components/useAgentsData.ts}`（4 文件 / 119 行） | 初始化竞态守卫（`cancelled` 标志）、加载空态 `Spin`、切换 workspace 后重选同一文件、容器 padding 与滚动 | `console/src/features/files-workspace/`（`FilesWorkspace.tsx` / `FilesDrawer.tsx`（`:123` AbortController）/ `FilesNavigator.tsx` / `MemoryGraphView.tsx` / `directorySources.ts`），并带 `FilesWorkspace.revalidation.test.tsx` 与 `.pending-diff.test.tsx` | `DROP`：上游把失效重校验做成了有测试钉住的实现，fork 这三类守卫已被覆盖 |
| `pages/Chat/components/ChatSessionDrawer/index.tsx`（10 行） | 给 5 个 `(s) => …` 回调补 `IAgentScopeRuntimeWebUISession` 显式类型（服务 fork 的 tsc 严格度），**零产品行为** | v2 已删该目录（会话抽屉改为 `chats` 前端体系） | `DROP` |
| `components/PlanPanel/index.tsx` + `api/modules/plan.ts` + `app/routers/plan.py`（43 行） | 只做一件事：把 plan 从全局作用域改成 **agent 作用域**（`/agents/{agentId}/plan/{current,config,stream}`）；`plan.py` 那 2 行是 `workspace.config.plan is None` 的空值保护 | **复核 5：我此前"v2 全树 `PlanConfig` 命中 0"的记述是错的，已更正。** v2 保留着 plan 的**持久化配置**：`config/config.py:2069 class PlanConfig`（docstring "Plan mode configuration (stored in agent.json)"，字段只有 `enabled: bool = False`）、`config.py:2426 workspace.config.plan`。**但读方为 0**：`app` / `api` / `schemas` 与 `console/src` 里 `PlanConfig` / `plan_enabled` / `get_plan_config` / `/plan` 全部命中 0；唯一的写方是 PawApp —— `pawapp/agent.py:159 profile.plan.enabled = self.spec.plan_enabled`（spec 字段 `plan_enabled: bool = True` 在 `:71`）。会话命令 `/plan` 本身是**上游自己关掉的**：`agents/command_handler.py:1579 _process_plan` 是 stub，返回 "Plan Mode — Status: **temporarily unavailable** … being migrated to the new task system" | `CUT`（面板 + SSE + router 整套），但**结论比上一版好**：fork 想要的"agent 作用域"**已经是 v2 的模型**（plan 就是 per-agent 存进 `agent.json`），所以将来重开不是 fork 自建状态 schema，而是等上游 new task system 落地后读 `plan.enabled` —— 这条从"留档的设计意见"升级为"与上游同构、可直接对接的读法"。**降级行为实测**：`AnywhereChat/index.tsx:1973` 调 `planApi.getPlanConfig(selectedAgent)` 带 `.catch(() => setPlanEnabled(false))`，同步后该端点 404 会**静默**显示"plan 未启用"，不报错也不显式提示 —— 裁决时要把它当"功能消失但无信号"来告知用户，不能靠报错暴露 |

### 4.5 六项复核的结论（2026-10-01 全部做完，每条都有实测证据）

原先这 6 项是"判定前置检查"。现在 6 项都有结论，**其中 2 项推翻了我此前的记述**（第 5 项 `PlanConfig`、第 4 项历史分页），已回写到 §4.2–§4.4 的对应行。

1. **v2 stdio 起进程不解析可执行文件**：`drivers/handlers/mcp.py:83` 原样透传 `endpoint.command`，`:316-336` 只校验非空字符串。上游在同一问题上用的是**构造期解析**：`app/mail/driver_config.py:57 resolve_qwenpawmail_endpoint()`（env 覆盖 → frozen 时 `Path(sys.executable).with_name("qwenpaw"+suffix)` → `find_spec` → `"python"`）。⇒ `_resolve_stdio_command` 判 `搬迁`，落点在 fork 侧构造 endpoint 配置的那一层，不 patch 上游 handler（D-8）。
2. **mineru 不在用**：全仓 14 命中 = 本清单文档 3 + `stateful_client.py:175-179/:316-324` 的启动前检查；`pyproject`/`requirements`/MCP 配置种子/前端/v2 全树均 **0**；`docs/devops/FORK_ROADMAP.md:22` 状态"计划中"。⇒ 建议 `CUT`，等产品裁决确认。
3. **v2 regenerate 不覆盖"编辑最后一句重发"**：v2 全树消息级删除符号命中 0，`app/chats/api.py` 无消息级写路由；v2 的 regenerate 按 `clientMessageId` 身份重跑同一轮，`:3312` 明确"targets this identity, never text"。⇒ `tail-user/delete` 判 `搬迁` 定案。
4. **`AnywhereChat` 后端端点依赖全表**（按调用点实测，非估计。文件 3,805 行 / 122,977 字节，同目录另有 `ChatSearchPanel.tsx` 327 行与 `history.ts`）：

   | 前端调用 | 路径 | v2 状态 |
   |---|---|---|
   | `chatApi.listChats({user_id, channel})` —— `index.tsx:1392/1405/2732`、`history.ts:236/269`、`ChatSearchPanel.tsx:131` | `GET /chats` | **在**（`chats/api.py:291`，`user_id` / `channel` 参数都在，另多 `archived`） |
   | `chatApi.getChat(chatId)` —— `ChatSearchPanel.tsx:160`、`history.ts:182` | `GET /chats/{id}` | **在**（`:816`），但 `history.ts` 传的 `offset/limit` 无对应参数 |
   | `chatApi.getRuntimeStatus(id)` —— `index.tsx:1672` | `GET /console/chats/{id}/runtime-status` | **缺**（console 路由面无此路径） |
   | `chatApi.deleteTailUserMessage(id)` —— `index.tsx:2217` | `POST /chats/{id}/tail-user/delete` | **缺** |
   | `chatApi.clearChatMeta` 的 `meta` 写 —— `ProjectDetailPage.tsx:2086`、3 个 Projects hook | `PUT /chats/{id}` | **缺字段**（v2 `ChatUpdate` 只有 `name` 且 `extra="forbid"` ⇒ 422） |
   | `planApi.getPlanConfig(agent)` —— `index.tsx:1973` | `GET /agents/{id}/plan/config` | **缺路由**（状态原生存在于 `config.py:2069`，无人读；上游 `/plan` 是 stub） |
   | `chatApi.uploadFile` + `filePreviewUrl` —— `index.tsx:1780/1782/1900/1901` | `POST /console/upload` | **在**（`console.py:617`） |
   | `chatApi.stopConsoleChat(id)` —— `index.tsx:3175/3757` | `POST /console/chat/stop` | **在** |
   | `commandsApi.sendApprovalCommand` —— `index.tsx:2052/2078` | approval 命令面 | v2 有 approval 体系（`command_handler.py:117-129`），同步时按 v2 命令面核一次 |
   | `sessionApi.{getSession,createSession,updateSession,removeLastUserMessage,setLastUserMessage,getRealIdForSession}` —— `index.tsx:1512/2482-2503/2722-2725` | 前端 SDK 包装层，不直接对应路由 | 随 `chats` 前端体系重核 |

   ⇒ **搬迁端点集合是 4 条，不是 5 条**：`tail-user/delete`、`ChatUpdate.meta` 的写路径、runtime-status（待裁）、plan config 的读路径。历史分页按复核 4 改判 `CUT`，不进这个集合。
5. **v2 的 plan 状态**：见 §4.4 那行的完整证据 —— `PlanConfig` 在 v2 **存在**（`config/config.py:2069`，写方 `pawapp/agent.py:159`），读方 0，`/plan` 命令是上游自写的"temporarily unavailable" stub。我此前"全树命中 0"的记述作废。
6. **fork 自有后端端点的落点成立，不需要再做运行时 spike**：`PluginApi.register_http_router` 在 fork 当前树是 `plugins/api.py:191`、v2 是 `plugins/api.py:590`（**两棵树行号不同，引用时别混用**），实现体在 `plugins/registry.py:141`：挂到 `/api` + `prefix`，`prefix == "/"` 被拒、重复 prefix 直接 `raise ValueError`（一处冲突一处报错，无需自避让），父 app 由 `set_plugin_http_app` 注入 —— 生产调用点 `app/_app.py:355`（fork）/ `app/_app.py:491`（v2，另有 `cli/channels_cmd.py:642`）。**在册可用样例**：`plugins/bundle/qwenpaw-pet/plugin.py:73` 把 `router.py` 挂到 `/qwenpaw-pet`。

### 4.6 净结论

复核做完、四项裁决落定后（D-23，见 §4.7），§4.2–§4.4 那 18 个文件 2,825 行的账目**比第一版轻得多**：真正要动代码的只剩 **5 条线 + 1 项净删除**，其余全部 `DROP` 或 `CUT`。

- `DROP`（上游已用另一套实现覆盖，删 fork 改动不丢用户可见功能）：MCP 客户端生命周期重写、配置热重载、历史裁剪、历史预览与 legacy 解析、session 写盘加固、命令派发补丁、`query_error_dump.py` 时间戳、前端 9 个文件的竞态守卫与展示列，**加本轮新判的 历史分页**（`AnywhereChat` 分片后仍取全量，上游用前端变换 + `testLargeSession.test.ts` 覆盖同一问题）。
- `搬迁`（需求成立、v2 无等价物，必须移到 fork 自有位置）：**`_resolve_stdio_command`**（构造期解析）、**`tail-user/delete`**（168 行）、**`ChatUpdate.meta` 的写路径**（6 处生产调用者）。**共 3 条。**
- `原生`（需求成立，改成走 v2 接缝重表达）：**MCP 运行时状态三件套**、**httpx 异常链诊断 5 个 helper**。**共 2 条。**
- `CUT`（显式放弃，已写进 D-23）：**免启动 workspace 快路径**（7 行，沿用 D-19）、**`_is_mineru_stdio`**（9 行，roadmap 那行"内置 mineru_mcp"仍留在计划中）、**plan 面板整套**（43 行，上游自己把 `/plan` 关成 stub）、**`.snapshot` sidecar**（信任 v2 的 `safe_json_loads`）。
- **净删除项（减债，不是搬家）**：chat runtime-status 整套 —— `ChatRuntimeStatus` + `ChatRuntimeStatusBreakdownItem`（`models.py` 108 行的主体）、`runtime_status_store.py`、`model_wrapper.py:25` 那个没人传的参数、前端 `chat.ts:152` 与 `AnywhereChat/index.tsx:1672` 与 `utils/chatRuntimeStatus.ts`、e2e mock `pipeline-design-chat.spec.ts:382`、**runner 包 `__init__.py` 那 38 行懒加载守卫**（它唯一的存在理由就是懒加载 `runtime_status_store`）。

**这 5 条搬迁/原生线的净实现行数仍不给数字** —— 得出它要把 §4.2–§4.4 逐 hunk 记账：`git diff --unified=0` 的 35 个 hunk（session.py）与 68 个 hunk（stateful_client.py）里 `DROP` 与差集交错出现，按文件总量估会把 `DROP` 那半也算进工时。排期前补这一次账目，输入已经缩小到 5 条线 + 1 项净删除，成本可控。

这条结论直接反驳了 `UPSTREAM_V2_MIGRATION_PLAN.md` §2 表里那行 P2 判据（"上游删了 `app/runner/*` 7 个文件…等于上游替我们做了裁决，无需决策"）：**上游删掉宿主文件不等于上游删掉了需求**，`tail-user/delete` 与 `ChatUpdate.meta` 的需求在 fork 自有的 `AnywhereChat` / `Projects` 页面上依然活着，只是失去了后端载体。那行判据需要按本节改写（见 §8）。

### 4.7 D-23 裁决记录（2026-10-01，用户确认）

簇 J / K 复核后剩的 4 个开放项一次裁完，共同依据是短期目标里那条"去债优先，但要分清丢的是**成果**还是**债**"：

| # | 裁决 | 放弃的东西 | 如实记下的代价 |
|---|---|---|---|
| ① | 免启动 workspace 快路径 `CUT`，沿用 D-19 | `_resolve_chat_workspace_dir` 7 行 | 冷启动打开会话列表要先加载 workspace，这条快路径带来的启动性能收益消失 |
| ② | chat runtime-status **整套删除**（不是 `CUT` 掉上游改动，是删 fork 自己的死码） | `ChatRuntimeStatus` 两模型 + `runtime_status_store.py` + 前端调用/工具/e2e mock + runner 包 38 行懒加载 | 无。它在当前树上从来没有活过：后端无路由、store 零生产调用者。将来要做 per-chat token/耗时面板时按 v2 的形状（`get_runtime_status()` + typed response + 只读路由）新做 |
| ③ | session 的 `.snapshot` sidecar `CUT`，信任上游容错 | 备份回滚这条退路 | 截断写入（写一半掉电）这类 `utils/json_utils.safe_json_loads` 救不回的情况，CoPaw 不再能自愈 |
| ④ | `_is_mineru_stdio` `CUT`，随 roadmap 一起重做 | 9 行"启动前查 `MINERU_API_KEY`"的清晰报错 | `docs/devops/FORK_ROADMAP.md:22` 那行"内置 mineru_mcp"**保持"计划中"不撤**；真进产品时按 v2 `app/mail/driver_config.py:57 resolve_qwenpawmail_endpoint()` 的形状（构造期解析 + env 覆盖）重写，与 `_resolve_stdio_command` 同批 |

**这四项合起来消掉的冲突面**：`app/runner/{api,models}.py` 里那 7 + 108 行、`session.py` 的 sidecar 三件套、`runner/__init__.py` 的 38 行懒加载、`stateful_client.py` 的 9 行 mineru 分支，以及前端 `chat.ts` / `chatRuntimeStatus.ts` / `AnywhereChat` 消费点 —— 全部不需要在 WP-06 里重放。**这条记录的作用是把它们变成"有意识的放弃"**，下次同步时不再作为"疑似丢失成果"被重新翻出来。

## 5 >60 行的 47 个文件（需要设计，不能机械搬；修正后 48 个，补录见 §7.1）

| 文件 | fork | 上游 |
|---|---|---|
| `src/qwenpaw/app/routers/agents.py` | +4190/−326 | +1690/−136 |
| `console/src/locales/zh.json` | +128/−0 | +3534/−231 |
| `console/src/locales/en.json` | +128/−0 | +3518/−226 |
| `src/qwenpaw/config/config.py` | +73/−3 | +2190/−407 |
| `src/qwenpaw/agents/react_agent.py` | +76/−40 | +1202/−1264 |
| `console/src/pages/Settings/Models/index.module.less` | +139/−2 | +1929/−474 |
| `src/qwenpaw/app/mcp/stateful_client.py` | +690/−396 | +0/−665 |
| `src/qwenpaw/app/routers/workspace.py` | +105/−59 | +1322/−108 |
| `src/qwenpaw/app/routers/skills.py` | +698/−4 | +596/−119 |
| `console/src/pages/Agent/Skills/index.tsx` | +1056/−72 | +229/−42 |
| `src/qwenpaw/providers/openai_chat_model_compat.py` | +114/−11 | +685/−187 |
| `src/qwenpaw/providers/retry_chat_model.py` | +62/−16 | +629/−180 |
| `console/src/pages/Chat/index.module.less` | +103/−0 | +689/−61 |
| `console/src/api/modules/agents.ts` | +718/−0 | +114/−0 |
| `src/qwenpaw/app/routers/config.py` | +56/−21 | +594/−116 |
| `console/src/api/types/agents.ts` | +617/−3 | +127/−0 |
| `src/qwenpaw/app/runner/api.py` | +457/−34 | +0/−233 |
| `src/qwenpaw/app/workspace/workspace.py` | +36/−40 | +521/−121 |
| `src/qwenpaw/app/channels/dingtalk/channel.py` | +74/−1 | +414/−50 |
| `README_ja.md` | +63/−20 | +230/−209 |
| `src/qwenpaw/app/routers/tools.py` | +28/−111 | +259/−115 |
| `README_zh.md` | +68/−17 | +192/−223 |
| `src/qwenpaw/app/mcp/manager.py` | +194/−16 | +0/−286 |
| `src/qwenpaw/cli/desktop_cmd.py` | +212/−133 | +104/−37 |
| `console/src/pages/Agent/MCP/components/MCPClientCard.tsx` | +47/−14 | +120/−302 |
| `README_ru.md` | +65/−20 | +203/−182 |
| `src/qwenpaw/agents/tools/file_io.py` | +60/−2 | +282/−125 |
| `console/src/pages/Settings/Security/index.tsx` | +264/−76 | +50/−64 |
| `console/src/pages/Settings/Models/components/modals/ProviderConfigModal.tsx` | +239/−2 | +97/−99 |
| `console/src/pages/Agent/MCP/index.tsx` | +87/−144 | +155/−40 |
| `console/src/api/modules/agent.ts` | +363/−17 | +35/−3 |
| `console/src/pages/Settings/Agents/components/AgentTable.tsx` | +100/−60 | +0/−248 |
| `src/qwenpaw/app/agent_config_watcher.py` | +221/−110 | +51/−24 |
| `README.md` | +58/−17 | +177/−141 |
| `console/src/pages/Agent/Workspace/components/useAgentsData.ts` | +58/−24 | +0/−296 |
| `src/qwenpaw/agents/utils/audio_transcription.py` | +335/−5 | +2/−1 |
| `console/src/pages/Settings/Agents/index.tsx` | +44/−20 | +224/−48 |
| `console/src/api/request.ts` | +122/−5 | +143/−27 |
| `console/src/pages/Agent/Config/useAgentConfig.tsx` | +46/−47 | +146/−54 |
| `src/qwenpaw/app/agent_context.py` | +59/−33 | +181/−11 |
| `console/src/api/modules/chat.ts` | +143/−4 | +109/−5 |
| `console/src/pages/Chat/utils.ts` | +121/−0 | +86/−49 |
| `console/src/api/types/agent.ts` | +62/−11 | +122/−29 |
| `console/src/i18n.ts` | +91/−7 | +90/−32 |
| `src/qwenpaw/app/runner/models.py` | +108/−0 | +0/−103 |
| `console/src/pages/Agent/MCP/useMCP.ts` | +71/−10 | +73/−18 |
| `console/src/api/types/skill.ts` | +73/−0 | +70/−11 |

## 6 ≤10 行的 49 个文件（便宜项，优先做；修正后 50 个，补录见 §7.1）

每个文件的 fork 改动都在 10 行以内，处置后可以从冲突表里划掉；**判据统一**：还原或搬迁后，`git diff e111ec6fb..upstream/main` 与该文件的 fork 差异中不再含 fork 逻辑行。

| 文件 | fork | 上游 | fork hunk 数 |
|---|---|---|---|
| `.github/workflows/frontend-tests.yml` | +10/−0 | +92/−11 | 3 |
| `.gitignore` | +4/−0 | +21/−0 | 2 |
| `CONTRIBUTING.md` | +7/−0 | +4/−8 | 1 |
| `CONTRIBUTING_zh.md` | +7/−0 | +4/−8 | 1 |
| `Makefile` | +5/−1 | +18/−4 | 2 |
| `console/src/api/types/index.ts` | +2/−0 | +1/−0 | 2 |
| `console/src/api/types/mcp.ts` | +2/−0 | +93/−0 | 1 |
| `console/src/components/AgentSelector/AgentSelector.test.tsx` | +4/−3 | +219/−38 | 4 |
| `console/src/components/ChunkErrorBoundary.tsx` | +1/−0 | +55/−8 | 1 |
| `console/src/components/LanguageSwitcher/index.module.less` | +1/−1 | +23/−39 | 1 |
| `console/src/components/LanguageSwitcher/index.tsx` | +1/−3 | +22/−34 | 2 |
| `console/src/layouts/constants.ts` | +8/−0 | +0/−60 | 9 |
| `console/src/pages/Agent/Config/components/LightContextCard.tsx` | +2/−2 | +274/−223 | 2 |
| `console/src/pages/Agent/Config/components/index.ts` | +1/−0 | +2/−1 | 1 |
| `console/src/pages/Agent/Skills/components/index.ts` | +1/−1 | +25/−5 | 2 |
| `console/src/pages/Agent/Skills/index.module.less` | +5/−4 | +1060/−493 | 4 |
| `console/src/pages/Agent/Tools/index.module.less` | +4/−3 | +210/−296 | 3 |
| `console/src/pages/Chat/ModelSelector/index.module.less` | +2/−1 | +1635/−136 | 1 |
| `console/src/pages/Chat/OptionsPanel/defaultConfig.ts` | +1/−1 | +10/−0 | 2 |
| `console/src/pages/Chat/components/ChatHeaderTitle/index.tsx` | +4/−1 | +239/−3 | 2 |
| `console/src/pages/Chat/components/ChatSessionDrawer/index.tsx` | +5/−5 | +0/−613 | 6 |
| `console/src/pages/Control/Channels/components/ChannelCard.tsx` | +1/−1 | +61/−49 | 1 |
| `console/src/pages/Control/Channels/index.module.less` | +3/−2 | +437/−134 | 2 |
| `console/src/pages/Control/CronJobs/components/columns.tsx` | +1/−1 | +90/−224 | 1 |
| `console/src/pages/Control/Sessions/index.tsx` | +1/−1 | +209/−28 | 1 |
| `console/src/pages/Login/index.tsx` | +3/−2 | +252/−43 | 2 |
| `console/src/pages/Settings/Agents/components/index.ts` | +1/−0 | +2/−1 | 1 |
| `console/src/pages/Settings/Agents/index.module.less` | +1/−1 | +25/−255 | 1 |
| `console/src/pages/Settings/SkillPool/index.module.less` | +4/−3 | +314/−537 | 3 |
| `console/src/plugins/PluginContext.tsx` | +8/−1 | +76/−10 | 4 |
| `console/src/styles/layout.css` | +4/−4 | +327/−217 | 1 |
| `deploy/Dockerfile` | +1/−0 | +32/−5 | 1 |
| `scripts/install.bat` | +6/−2 | +14/−3 | 5 |
| `scripts/install.ps1` | +8/−0 | +8/−3 | 2 |
| `scripts/install.sh` | +4/−1 | +12/−3 | 3 |
| `src/qwenpaw/agents/memory/agent_md_manager.py` | +4/−1 | +147/−33 | 1 |
| `src/qwenpaw/agents/tools/file_search.py` | +2/−2 | +204/−44 | 2 |
| `src/qwenpaw/agents/utils/__init__.py` | +2/−0 | +13/−0 | 2 |
| `src/qwenpaw/agents/utils/file_handling.py` | +3/−2 | +126/−74 | 2 |
| `src/qwenpaw/app/channels/manager.py` | +1/−1 | +39/−30 | 1 |
| `src/qwenpaw/app/routers/plan.py` | +2/−0 | +0/−176 | 1 |
| `src/qwenpaw/config/__init__.py` | +0/−2 | +8/−2 | 2 |
| `src/qwenpaw/constant.py` | +1/−0 | +113/−32 | 1 |
| `src/qwenpaw/providers/ollama_provider.py` | +2/−2 | +46/−12 | 2 |
| `src/qwenpaw/security/tool_guard/guardians/file_guardian.py` | +3/−2 | +18/−6 | 2 |
| `website/public/docs/cli.en.md` | +2/−2 | +72/−30 | 13 |
| `website/public/docs/cli.zh.md` | +2/−2 | +68/−29 | 14 |
| `website/public/docs/desktop.en.md` | +0/−2 | +32/−33 | 11 |
| `website/public/docs/desktop.zh.md` | +0/−2 | +30/−31 | 11 |

## 7 全量 155 行（前 152 行为第一版读数，补录 3 行见 §7.1）

| # | 文件 | 簇 | fork | 上游 | fork hunk | v2 存在 | 命名行 |
|---|---|---|---|---|---|---|---|
| 1 | `src/qwenpaw/app/routers/agents.py` | I | +4190/−326 | +1690/−136 | 87 | 是 | 0 |
| 2 | `console/src/locales/id.json` | A | +13/−2 | +3995/−49 | 2 | 是 | 0 |
| 3 | `console/src/locales/zh.json` | A | +128/−0 | +3534/−231 | 4 | 是 | 0 |
| 4 | `console/src/locales/en.json` | A | +128/−0 | +3518/−226 | 4 | 是 | 0 |
| 5 | `console/src/locales/pt-BR.json` | A | +11/−0 | +2938/−201 | 2 | 是 | 0 |
| 6 | `console/src/locales/ru.json` | A | +11/−0 | +2897/−183 | 2 | 是 | 0 |
| 7 | `console/src/locales/ja.json` | A | +11/−0 | +2896/−182 | 2 | 是 | 0 |
| 8 | `src/qwenpaw/config/config.py` | N | +73/−3 | +2190/−407 | 8 | 是 | 0 |
| 9 | `src/qwenpaw/agents/react_agent.py` | M | +76/−40 | +1202/−1264 | 3 | 是 | 0 |
| 10 | `console/src/pages/Settings/Models/index.module.less` | D | +139/−2 | +1929/−474 | 3 | 是 | 0 |
| 11 | `console/src/pages/Chat/ModelSelector/index.module.less` | D | +2/−1 | +1635/−136 | 1 | 是 | 0 |
| 12 | `src/qwenpaw/app/mcp/stateful_client.py` | K | +690/−396 | +0/−665 | 68 | **否** | 0 |
| 13 | `console/src/pages/Agent/Config/index.module.less` | D | +12/−0 | +1517/−138 | 1 | 是 | 0 |
| 14 | `console/src/layouts/Sidebar.tsx` | F | +50/−3 | +1021/−567 | 6 | 是 | 0 |
| 15 | `src/qwenpaw/app/routers/workspace.py` | I | +105/−59 | +1322/−108 | 35 | 是 | 0 |
| 16 | `console/src/pages/Agent/Skills/index.module.less` | D | +5/−4 | +1060/−493 | 4 | 是 | 0 |
| 17 | `src/qwenpaw/app/routers/skills.py` | I | +698/−4 | +596/−119 | 8 | 是 | 0 |
| 18 | `console/src/pages/Agent/Skills/index.tsx` | D | +1056/−72 | +229/−42 | 13 | 是 | 0 |
| 19 | `console/src/layouts/index.module.less` | F | +16/−4 | +1012/−143 | 4 | 是 | 0 |
| 20 | `console/src/pages/Control/Channels/components/ChannelDrawer.tsx` | D | +15/−3 | +874/−260 | 4 | 是 | 0 |
| 21 | `console/src/pages/Coding/TabbedEditor.tsx` | D | +19/−8 | +783/−303 | 11 | 是 | 0 |
| 22 | `src/qwenpaw/providers/openai_chat_model_compat.py` | P | +114/−11 | +685/−187 | 4 | 是 | 0 |
| 23 | `console/src/pages/Agent/MCP/index.module.less` | D | +5/−10 | +777/−175 | 4 | 是 | 0 |
| 24 | `src/qwenpaw/providers/retry_chat_model.py` | P | +62/−16 | +629/−180 | 12 | 是 | 0 |
| 25 | `src/qwenpaw/app/_app.py` | L | +43/−15 | +544/−260 | 7 | 是 | 0 |
| 26 | `console/src/pages/Settings/SkillPool/index.module.less` | D | +4/−3 | +314/−537 | 3 | 是 | 0 |
| 27 | `console/src/pages/Chat/index.module.less` | D | +103/−0 | +689/−61 | 3 | 是 | 0 |
| 28 | `console/src/api/modules/agents.ts` | C | +718/−0 | +114/−0 | 5 | 是 | 0 |
| 29 | `console/src/pages/Settings/Environments/index.module.less` | D | +39/−9 | +286/−484 | 17 | 是 | 0 |
| 30 | `src/qwenpaw/providers/openai_provider.py` | P | +11/−2 | +632/−146 | 4 | 是 | 0 |
| 31 | `src/qwenpaw/app/routers/config.py` | I | +56/−21 | +594/−116 | 11 | 是 | 0 |
| 32 | `console/src/api/types/agents.ts` | C | +617/−3 | +127/−0 | 8 | 是 | 0 |
| 33 | `src/qwenpaw/app/runner/api.py` | J | +457/−34 | +0/−233 | 27 | **否** | 0 |
| 34 | `src/qwenpaw/app/workspace/workspace.py` | L | +36/−40 | +521/−121 | 13 | 是 | 0 |
| 35 | `src/qwenpaw/app/multi_agent_manager.py` | L | +18/−8 | +579/−102 | 3 | 是 | 0 |
| 36 | `console/src/components/AgentSelector/index.tsx` | E | +18/−10 | +534/−112 | 8 | 是 | 0 |
| 37 | `console/src/pages/Agent/Workspace/index.module.less` | D | +9/−2 | +0/−655 | 3 | **否** | 0 |
| 38 | `src/qwenpaw/app/routers/providers.py` | I | +43/−5 | +505/−104 | 6 | 是 | 0 |
| 39 | `console/src/pages/Chat/components/ChatSessionDrawer/index.tsx` | D | +5/−5 | +0/−613 | 6 | **否** | 0 |
| 40 | `console/src/components/AgentSelector/index.module.less` | E | +24/−6 | +396/−190 | 8 | 是 | 0 |
| 41 | `console/src/App.tsx` | G | +16/−4 | +496/−91 | 3 | 是 | 0 |
| 42 | `console/src/pages/Control/Channels/index.module.less` | D | +3/−2 | +437/−134 | 2 | 是 | 0 |
| 43 | `console/src/pages/Settings/Security/index.module.less` | D | +20/−2 | +190/−350 | 6 | 是 | 0 |
| 44 | `console/src/styles/layout.css` | G | +4/−4 | +327/−217 | 1 | 是 | 0 |
| 45 | `src/qwenpaw/app/channels/dingtalk/channel.py` | L | +74/−1 | +414/−50 | 3 | 是 | 0 |
| 46 | `README_ja.md` | V | +63/−20 | +230/−209 | 4 | 是 | 2 |
| 47 | `console/src/pages/Agent/Tools/index.module.less` | D | +4/−3 | +210/−296 | 3 | 是 | 0 |
| 48 | `src/qwenpaw/app/routers/tools.py` | I | +28/−111 | +259/−115 | 28 | 是 | 0 |
| 49 | `console/src/pages/Agent/Config/components/LightContextCard.tsx` | D | +2/−2 | +274/−223 | 2 | 是 | 0 |
| 50 | `README_zh.md` | V | +68/−17 | +192/−223 | 4 | 是 | 2 |
| 51 | `src/qwenpaw/app/mcp/manager.py` | K | +194/−16 | +0/−286 | 13 | **否** | 0 |
| 52 | `src/qwenpaw/cli/desktop_cmd.py` | O | +212/−133 | +104/−37 | 18 | 是 | 4 |
| 53 | `console/src/pages/Agent/MCP/components/MCPClientCard.tsx` | D | +47/−14 | +120/−302 | 11 | 是 | 0 |
| 54 | `console/src/layouts/Header.tsx` | F | +7/−5 | +151/−311 | 7 | 是 | 1 |
| 55 | `README_ru.md` | V | +65/−20 | +203/−182 | 4 | 是 | 2 |
| 56 | `src/qwenpaw/agents/tools/file_io.py` | M | +60/−2 | +282/−125 | 11 | 是 | 0 |
| 57 | `console/src/pages/Agent/Config/components/ReactAgentCard.tsx` | D | +20/−15 | +256/−170 | 9 | 是 | 0 |
| 58 | `console/src/pages/Settings/Security/index.tsx` | D | +264/−76 | +50/−64 | 16 | 是 | 0 |
| 59 | `console/src/pages/Settings/Models/components/modals/ProviderConfigModal.tsx` | D | +239/−2 | +97/−99 | 12 | 是 | 0 |
| 60 | `console/src/pages/Agent/MCP/index.tsx` | D | +87/−144 | +155/−40 | 30 | 是 | 0 |
| 61 | `console/src/api/modules/agent.ts` | C | +363/−17 | +35/−3 | 13 | 是 | 0 |
| 62 | `console/src/pages/Settings/Agents/components/AgentTable.tsx` | D | +100/−60 | +0/−248 | 8 | **否** | 0 |
| 63 | `src/qwenpaw/app/agent_config_watcher.py` | L | +221/−110 | +51/−24 | 35 | 是 | 0 |
| 64 | `src/qwenpaw/config/utils.py` | N | +25/−0 | +272/−108 | 4 | 是 | 0 |
| 65 | `README.md` | V | +58/−17 | +177/−141 | 4 | 是 | 2 |
| 66 | `console/src/api/request.test.ts` | C | +58/−0 | +329/−3 | 2 | 是 | 0 |
| 67 | `console/src/pages/Agent/Workspace/components/useAgentsData.ts` | D | +58/−24 | +0/−296 | 11 | **否** | 0 |
| 68 | `src/qwenpaw/app/mcp/watcher.py` | K | +26/−8 | +0/−331 | 11 | **否** | 0 |
| 69 | `src/qwenpaw/app/runner/command_dispatch.py` | J | +7/−17 | +0/−332 | 9 | **否** | 0 |
| 70 | `src/qwenpaw/agents/utils/audio_transcription.py` | M | +335/−5 | +2/−1 | 14 | 是 | 0 |
| 71 | `console/src/pages/Settings/Agents/index.tsx` | D | +44/−20 | +224/−48 | 7 | 是 | 0 |
| 72 | `console/src/pages/Control/Heartbeat/index.tsx` | D | +6/−12 | +162/−148 | 2 | 是 | 0 |
| 73 | `console/src/pages/Control/CronJobs/components/columns.tsx` | D | +1/−1 | +90/−224 | 1 | 是 | 0 |
| 74 | `src/qwenpaw/agents/utils/message_processing.py` | M | +49/−4 | +219/−42 | 4 | 是 | 0 |
| 75 | `src/qwenpaw/app/workspace/service_factories.py` | L | +16/−1 | +225/−72 | 2 | 是 | 0 |
| 76 | `console/src/pages/Login/index.tsx` | D | +3/−2 | +252/−43 | 2 | 是 | 1 |
| 77 | `console/src/api/request.ts` | C | +122/−5 | +143/−27 | 3 | 是 | 0 |
| 78 | `console/src/pages/Agent/Config/useAgentConfig.tsx` | D | +46/−47 | +146/−54 | 15 | 是 | 0 |
| 79 | `src/qwenpaw/app/agent_context.py` | L | +59/−33 | +181/−11 | 2 | 是 | 0 |
| 80 | `console/src/pages/Settings/Agents/index.module.less` | D | +1/−1 | +25/−255 | 1 | 是 | 0 |
| 81 | `console/src/plugins/usePluginLoader.ts` | B | +43/−2 | +148/−81 | 3 | 是 | 0 |
| 82 | `src/qwenpaw/config/context.py` | N | +39/−0 | +229/−0 | 2 | 是 | 0 |
| 83 | `console/src/layouts/MainLayout/index.tsx` | F | +32/−10 | +64/−161 | 10 | 是 | 0 |
| 84 | `console/src/components/AgentSelector/AgentSelector.test.tsx` | E | +4/−3 | +219/−38 | 4 | 是 | 0 |
| 85 | `console/src/api/modules/chat.ts` | C | +143/−4 | +109/−5 | 8 | 是 | 0 |
| 86 | `console/src/pages/Chat/utils.ts` | D | +121/−0 | +86/−49 | 1 | 是 | 0 |
| 87 | `src/qwenpaw/agents/tools/file_search.py` | M | +2/−2 | +204/−44 | 2 | 是 | 0 |
| 88 | `console/src/pages/Chat/components/ChatHeaderTitle/index.tsx` | D | +4/−1 | +239/−3 | 2 | 是 | 0 |
| 89 | `console/src/pages/Control/Sessions/index.tsx` | D | +1/−1 | +209/−28 | 1 | 是 | 0 |
| 90 | `console/src/pages/Chat/utils.test.ts` | D | +58/−0 | +172/−7 | 2 | 是 | 0 |
| 91 | `src/qwenpaw/token_usage/model_wrapper.py` | P | +15/−8 | +196/−17 | 3 | 是 | 0 |
| 92 | `console/src/components/PlanPanel/index.tsx` | E | +13/−5 | +0/−216 | 8 | **否** | 0 |
| 93 | `console/src/api/types/agent.ts` | C | +62/−11 | +122/−29 | 5 | 是 | 0 |
| 94 | `console/src/i18n.ts` | G | +91/−7 | +90/−32 | 9 | 是 | 0 |
| 95 | `console/src/pages/Agent/Workspace/index.tsx` | D | +12/−0 | +0/−208 | 3 | **否** | 0 |
| 96 | `src/qwenpaw/app/runner/models.py` | J | +108/−0 | +0/−103 | 2 | **否** | 0 |
| 97 | `src/qwenpaw/agents/utils/file_handling.py` | M | +3/−2 | +126/−74 | 2 | 是 | 0 |
| 98 | `src/qwenpaw/agents/memory/agent_md_manager.py` | M | +4/−1 | +147/−33 | 1 | 是 | 0 |
| 99 | `src/qwenpaw/app/routers/plan.py` | I | +2/−0 | +0/−176 | 1 | **否** | 0 |
| 100 | `console/src/api/modules/skill.ts` | C | +43/−0 | +83/−50 | 3 | 是 | 0 |
| 101 | `console/src/pages/Agent/MCP/useMCP.ts` | D | +71/−10 | +73/−18 | 13 | 是 | 0 |
| 102 | `console/vite.config.ts` | H | +25/−2 | +106/−38 | 3 | 是 | 0 |
| 103 | `console/src/api/types/skill.ts` | C | +73/−0 | +70/−11 | 2 | 是 | 0 |
| 104 | `src/qwenpaw/constant.py` | P | +1/−0 | +113/−32 | 1 | 是 | 0 |
| 105 | `src/qwenpaw/agents/prompt.py` | M | +31/−0 | +97/−14 | 2 | 是 | 0 |
| 106 | `console/src/pages/Agent/Workspace/components/FileListPanel.tsx` | D | +8/−6 | +0/−126 | 1 | **否** | 0 |
| 107 | `console/src/api/modules/plan.ts` | C | +16/−7 | +0/−115 | 7 | **否** | 0 |
| 108 | `.github/workflows/frontend-tests.yml` | U | +10/−0 | +92/−11 | 3 | 是 | 0 |
| 109 | `console/src/pages/Control/Channels/components/ChannelCard.tsx` | D | +1/−1 | +61/−49 | 1 | 是 | 0 |
| 110 | `website/public/docs/cli.en.md` | S | +2/−2 | +72/−30 | 13 | 是 | 22 |
| 111 | `pyproject.toml` | V | +10/−1 | +75/−16 | 5 | 是 | 0 |
| 112 | `website/public/docs/cli.zh.md` | S | +2/−2 | +68/−29 | 14 | 是 | 23 |
| 113 | `console/src/api/types/mcp.ts` | C | +2/−0 | +93/−0 | 1 | 是 | 0 |
| 114 | `console/src/plugins/PluginContext.tsx` | B | +8/−1 | +76/−10 | 4 | 是 | 0 |
| 115 | `console/package.json` | H | +21/−13 | +39/−9 | 14 | 是 | 0 |
| 116 | `src/qwenpaw/agents/utils/setup_utils.py` | M | +16/−0 | +66/−0 | 1 | 是 | 0 |
| 117 | `console/src/api/modules/auth.ts` | C | +30/−4 | +32/−8 | 5 | 是 | 0 |
| 118 | `console/src/api/types/chat.ts` | C | +44/−1 | +28/−0 | 5 | 是 | 0 |
| 119 | `src/qwenpaw/app/channels/manager.py` | L | +1/−1 | +39/−30 | 1 | 是 | 0 |
| 120 | `console/src/utils/lazyWithRetry.ts` | G | +35/−4 | +16/−15 | 8 | 是 | 0 |
| 121 | `console/src/layouts/constants.ts` | F | +8/−0 | +0/−60 | 9 | 是 | 3 |
| 122 | `website/public/docs/desktop.en.md` | S | +0/−2 | +32/−33 | 11 | 是 | 11 |
| 123 | `console/index.html` | H | +11/−1 | +52/−1 | 2 | 是 | 1 |
| 124 | `console/src/components/ChunkErrorBoundary.tsx` | E | +1/−0 | +55/−8 | 1 | 是 | 0 |
| 125 | `console/src/components/LanguageSwitcher/index.module.less` | E | +1/−1 | +23/−39 | 1 | 是 | 0 |
| 126 | `website/public/docs/desktop.zh.md` | S | +0/−2 | +30/−31 | 11 | 是 | 11 |
| 127 | `src/qwenpaw/providers/ollama_provider.py` | P | +2/−2 | +46/−12 | 2 | 是 | 0 |
| 128 | `console/src/components/LanguageSwitcher/index.tsx` | E | +1/−3 | +22/−34 | 2 | 是 | 0 |
| 129 | `console/src/api/modules/mcp.ts` | C | +11/−0 | +32/−0 | 1 | 是 | 0 |
| 130 | `src/qwenpaw/agents/skill_system/__init__.py` | M | +20/−0 | +19/−1 | 4 | 是 | 0 |
| 131 | `src/qwenpaw/app/routers/__init__.py` | I | +14/−0 | +19/−7 | 8 | 是 | 0 |
| 132 | `deploy/Dockerfile` | V | +1/−0 | +32/−5 | 1 | 是 | 0 |
| 133 | `.github/PULL_REQUEST_TEMPLATE.md` | U | +16/−0 | +18/−3 | 1 | 是 | 0 |
| 134 | `console/src/pages/Chat/components/WhisperSpeechButton/index.tsx` | D | +10/−14 | +6/−6 | 11 | 是 | 0 |
| 135 | `console/src/pages/Agent/Skills/components/index.ts` | D | +1/−1 | +25/−5 | 2 | 是 | 0 |
| 136 | `src/qwenpaw/security/tool_guard/guardians/file_guardian.py` | P | +3/−2 | +18/−6 | 2 | 是 | 0 |
| 137 | `Makefile` | V | +5/−1 | +18/−4 | 2 | 是 | 0 |
| 138 | `scripts/pack/README.md` | Q | +22/−0 | +6/−0 | 1 | 是 | 0 |
| 139 | `.gitignore` | V | +4/−0 | +21/−0 | 2 | 是 | 0 |
| 140 | `scripts/install.bat` | R | +6/−2 | +14/−3 | 5 | 是 | 2 |
| 141 | `scripts/pack/README_zh.md` | Q | +19/−0 | +5/−0 | 1 | 是 | 0 |
| 142 | `src/qwenpaw/app/routers/agent_scoped.py` | I | +14/−0 | +6/−3 | 3 | 是 | 0 |
| 143 | `scripts/install.sh` | R | +4/−1 | +12/−3 | 3 | 是 | 0 |
| 144 | `CONTRIBUTING.md` | V | +7/−0 | +4/−8 | 1 | 是 | 0 |
| 145 | `CONTRIBUTING_zh.md` | V | +7/−0 | +4/−8 | 1 | 是 | 0 |
| 146 | `scripts/install.ps1` | R | +8/−0 | +8/−3 | 2 | 是 | 0 |
| 147 | `src/qwenpaw/agents/utils/__init__.py` | M | +2/−0 | +13/−0 | 2 | 是 | 0 |
| 148 | `console/src/pages/Chat/OptionsPanel/defaultConfig.ts` | D | +1/−1 | +10/−0 | 2 | 是 | 1 |
| 149 | `src/qwenpaw/config/__init__.py` | N | +0/−2 | +8/−2 | 2 | 是 | 0 |
| 150 | `console/src/pages/Agent/Config/components/index.ts` | D | +1/−0 | +2/−1 | 1 | 是 | 0 |
| 151 | `console/src/pages/Settings/Agents/components/index.ts` | D | +1/−0 | +2/−1 | 1 | 是 | 0 |
| 152 | `console/src/api/types/index.ts` | C | +2/−0 | +1/−0 | 2 | 是 | 0 |

### 7.1 补录：被重命名检测漏掉的 3 行（2026-10-01 修正）

下表口径同 §7（fork = `behavior_added/behavior_removed`，上游 = 该路径在 `--no-renames` 下的删除行数）。这 3 行的"上游已删"是**改名**而非真删除，落点见 §4.3：

| # | 文件 | 簇 | fork | 上游 | fork hunk | v2 存在 | 命名行 |
|---|---|---|---|---|---|---|---|
| 153 | `src/qwenpaw/app/runner/session.py` | J | +320/−176 | +0/−468 | 35 | **改名到 `app/chats/session.py`**（R071） | 0 |
| 154 | `src/qwenpaw/app/runner/__init__.py` | J | +21/−17 | +0/−30 | 7 | **改名到 `app/chats/__init__.py`**（R067） | 0 |
| 155 | `src/qwenpaw/app/runner/query_error_dump.py` | J | +3/−3 | +0/−104 | 2 | **改名到 `app/chats/query_error_dump.py`（R100，逐字节未变）** | 0 |

编号从 153 顺排是为了不打乱 §7 那 152 行已被别处引用的行号；按本表"上游行数降序"的排序键，这三行分别应落在上游 ≈470 / ≈105 / ≈30 的位置。

分桶变化：`>60` 47 → **48**（session.py）、`11–60` 56 → **57**（`__init__.py`）、`≤10` 49 → **50**（`query_error_dump.py`）。

## 8 与其它计划的关系

- **D-22 品牌边界计划**（`docs/superpowers/plans/2026-10-01-d22-brand-boundary.md`，待写）只做 126 行改名还原 + 4 个文件离开冲突表，**不是去债主线**。它的价值是消掉"每次同步都要手工重放的机械税"，并顺手把 `_app.py` 里被硬编码破坏的上游品牌变量 `{PROJECT_NAME}` 还原。
- **WP-03/WP-04**（PawApp 化）承接簇 I / C / D / J / K：D-16 已把约 11,000 行实现下沉进 `src/qwenpaw`，所以这些簇现在是"从核心包里往外抽"，比从 `src/copaw` 抽更贵，排期时要把这笔算进去。
- **WP-06**（升级到 v2，前置条件：Python 下限抬到 3.11）开始前，第 4 节的 18 个文件必须全部有落点，否则同步当天就会静默丢功能。
- **需要回写 `UPSTREAM_V2_MIGRATION_PLAN.md` §2 的一处判据**：那张表的 P2 行写着"上游删了 `app/mcp/{stateful_client,watcher}.py`、`app/runner/*` 7 个文件、`app/routers/plan.py`，等于上游替我们做了裁决，无需决策"。§4 的逐文件复核推翻了"无需决策"：**上游删掉宿主文件不等于上游删掉需求** —— `tail-user/delete`（v2 全树消息级删除符号命中 0）、`ChatUpdate.meta`（v2 `ChatUpdate` 只有 `name` 且 `extra="forbid"`，而 fork 侧 6 处生产调用在写它）、session 的 `.snapshot` sidecar 这几条需求仍活在 fork 自有的 `AnywhereChat` / `Projects` 界面上，只是失去了后端载体；反过来 `AgentTable` / `Workspace` / plan 前端 / 历史分页那几类跟着走 `CUT` 或 `DROP` 才是对齐。这两类必须分开写，不能再合并成"自动作废"。
- **簇 A（6 个 locale 文件）是投入产出比最高的一刀**：302 行私有文案搬进 fork 已有的 `console/src/locales/copaw/*`，一次消掉 6 个冲突文件，零功能损失；唯一前置是 v2 的插件翻译注册接缝（`i18n.ts` 全仓无 `addResource`）是否存在 —— 未验证。
- **簇 J / K 搬迁项的落点机制**：`src/copaw` 在 D-16 之后只剩别名壳，fork 自有后端实现的合法落点是 `PluginApi.register_http_router(router, *, prefix, tags)`（**v2 `plugins/api.py:590` / fork 当前树 `plugins/api.py:191`，两棵树行号不同，引用时别混用**；实现体 `plugins/registry.py:141`，路由挂在 `/api` + prefix，`prefix` 非法或被占用直接 raise）与 PawApp（WP-03/04）。这条接缝**已在产运行**：`plugins/bundle/qwenpaw-pet/plugin.py:73` 用 `router.py` 挂 `/qwenpaw-pet`，父 app 由 `set_plugin_http_app` 注入（fork `app/_app.py:355`、v2 `app/_app.py:491`）。前端落点是 fork 自有组件目录（`components/AnywhereChat` 已是先例）+ v2 的 slot 接缝。

## 9 本清单里的未验证项

1. v2 是否有插件侧注册翻译资源的接缝（决定簇 A 的落点形态）。
2. ~~v2 的 MCP 实现在哪个路径（决定簇 K 的 1,330 行往哪搬）~~ → **已解决**：`drivers/handlers/{mcp,mcp_stateful_client,mcp_streamable_http}.py` + `drivers/manager.py` + `app/driver_config_watcher.py` + `app/mcp/{config_service,schemas}.py`，详见 §3 簇 K 与 §8 已闭环 33。剩下的不是"落点在哪"，而是 §4.2 那 6 项私有符号各自的 `原生` / `CUT` 判定。
3. `route.replace(pluginId, "core.root", …)` 的作用域能否只覆盖 CoPaw 自有页面而不触及上游路由（决定簇 D 与 D-12 默认落地界面）。
4. v2 文档站 `website/` 的页面注册方式（决定簇 S）。
5. 簇 B 的宿主改动（+54 行）在 v2 的两个接缝面（`plugins/api.py` 的 17 个 `register_*` 与 `pawapp/app.py`）上各自的等价落点。
6. ~~**§4.5 那 6 项**（v2 的 stdio 可执行文件解析、mineru 依赖是否在用、v2 regenerate 的覆盖面、`AnywhereChat` 的后端端点依赖全表、v2 `/plan` 的落库状态、`register_http_router` 最小插件端点能否被装载）~~ —— **2026-10-01 全部复核完毕，结论见 §4.5**；随之暴露的 4 个开放项也已一次裁完，记为 **D-23（§4.7）**。簇 J / K 的 2,825 行最终账目：**3 条 `搬迁` + 2 条 `原生` + 4 条 `CUT` + 1 项净删除（runtime-status 整套）**，其余 `DROP`。剩下的唯一前置是下一条那条 hunk 级净行数账目。
7. **§4.6 那 5 条线 + 1 项净删除的 hunk 级账目**：逐 hunk 标 `DROP` / `搬迁` / `原生` / `CUT` / `净删除`，产出排期用的净实现行数。用 §1 的 `git diff --no-renames --unified=0` 命令，输入只限簇 J / K 的 6 个文件（`stateful_client.py`、`manager.py`、`runner/{api,models,session}.py`、`runner/__init__.py`）。
