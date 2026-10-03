# 与 upstream 同步的冲突面清单（155 个文件）

> **这份文件的用途**：记录"下一次把仓库对齐到 upstream 2.x 时必然会产生合并冲突的文件"，并按搬迁成本分簇排序。它是**输入清单**，不是执行计划；每个簇的实施计划单独写。
> 判据来自两条总目标：① 最终要与最新 upstream 对齐，并能在保持同步的前提下长出 CoPaw 工作界面；② 短期是"去债 + 保成果"—— 去债 = 缩小与 upstream 的冲突与差异，保成果 = 把对 upstream 的有益修改转移到 CoPaw 自有区域，**而不是直接丢弃**。

**生成时间**：2026-10-01。数据来源：分支 `wp/02-ownership` HEAD `462a1cf0f`，merge-base `e111ec6fb`，upstream 基线 `upstream/main`（= 2.x）。**第 1–4 节在 `297b37b1a` 上做过一次读数修正**（重命名检测，见 §1 那条注），第 4 节同时补了那 18 个文件的逐文件落点判定。

## 1 口径

一个文件进这张表，必须同时满足三条：

1. **上游自有**：该文件在 merge-base `e111ec6fb` 里存在（fork 新建的文件不算，它们不会冲突）；
2. **fork 侧有逻辑改动**：按 `scripts/check_p1_invariants.py` 的行为/命名分册规则，去掉纯改名后仍有改动行（`behavior_added + behavior_removed > 0`）；
3. **上游侧也改过**：`git diff --no-renames e111ec6fb upstream/main -- <path>` 非空。

> **"面侧行为行"这个度量与第 2 条取数同口径**：总行数 = 进门禁 `--json` 的这些文件的 `behavior_added + behavior_removed` 之和，**不是** `git diff --numstat` 的加删之和。两者在 `wp/integration @ bb42257f5` 的同一 131 文件上是 **15,409 vs 15,427**，差的 18 行正是被门禁剥掉的命名行，逐宿主为 `console/index.html`(+2)、`console/src/layouts/Header.tsx`(+2)、`console/src/layouts/constants.ts`(+6)、`console/src/pages/Chat/OptionsPanel/defaultConfig.ts`(+2)、`console/src/pages/Login/index.tsx`(+2)、`scripts/install.bat`(+4)。**引用面行数必须说明用的是门禁侧**，否则同树复核会造出一个假差异（与上面那条 `--no-renames` 的教训同型：算式要按指标自己的定义来，不要自造）。

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

> **2026-10-02 执行回写（本表其余数字仍是 2026-10-01 的第一版读数）**：簇 A 已执行 ⇒ 上表三行同时下修：**fork 侧有逻辑改动的上游文件 168 → 162**、**下次同步必然冲突 155 → 149**、**这 149 个文件上 fork 的改动行数少 304 行**（§3 的 A 簇口径：+302/−2）。全仓 P1-行为从本表读数的 **+15,049/−2,584** 经 **WP-12 阶段 A（退 88 行改名）** 与 **WP-13（本刀 −377/+8）** 两笔下修，现为 **+14,555/−2,576**。命名册 126 行**未变**（簇 A 里 `id.json` 那 2 行是缩进破坏不是改名）。执行后读数用 `--check` 现算，见 §7 顶部那条与迁移计划 §8 已闭环 45。

按 fork 侧改动量分桶：**≤10 行 50 个**（多数可机械搬或还原）、**11–60 行 57 个**（逐条判归属）、**>60 行 48 个**（需要设计，见第 5 节）。

## 3 按簇分布与处置方向

| 簇 | 文件数 | fork 行 | 上游行 | 上游已删 |
|---|---|---|---|---|
| A console/src/locales/*.json（界面文案）**✅ 已执行（WP-13，`wp/13-locale-exit`，见 §8 说明与计划 §8 已闭环 45）** | 6 → **0** | 304 → **0** | 20,850 | 0 |
| B console/src/plugins（插件宿主） | 2 | 54 | 315 | 0 |
| C console/src/api（前端 API 客户端） | 15 | 2,356 | 1,569 | 1 |
| D console/src/pages（前端页面） | 43 | 3,229 | 21,532 | 6 |
| E console/src/components（前端组件） | 7 | 90 | 1,886 | 1 |
| F console/src/layouts（布局与顶栏） | 5 | 135 | 3,490 | 0 |
| G console/src 其它（App.tsx / i18n.ts / utils / styles） | 4 | 165 | 1,284 | 0 |
| H console 配置（tsconfig / vite / package.json） | 3 | 73 | 245 | 0 |
| I src/qwenpaw/app/routers（后端 HTTP 路由） | 9 → **8**（`tools.py` 已整文件退出册） | 5,676 → **5,537** | 5,875（**未重算**：tools.py 的上游侧 259/115 = 374 行仍含在内，重算时应减） | 1 |
| J src/qwenpaw/app/runner（会话与消息处理） | 6 | 1,163 | 1,270 | 6（其中 3 个改名到 `app/chats/`） |
| K src/qwenpaw/app/mcp（MCP 客户端） | 3 | 1,330 | 1,282 | 3 |
| L src/qwenpaw/app 其它（_app / migration / workspace / flow_engine 等） | 8 | 677 → **673**（`_app.py` 退 2 加 2 删） | 3,224 | 0 |
| M src/qwenpaw/agents（agent 工具、记忆、技能、prompt） | 11 | 654 | 3,975 | 0 |
| N src/qwenpaw/config（配置模型与工具） | 4 | 142 | 3,216 | 0 |
| O src/qwenpaw/cli（命令行） | 1 | 345 → **111**（`desktop_cmd.py` 整文件退回字节后只留 fork 的清理能力 111 行；已闭环 49） | 141 | 0 |
| P src/qwenpaw 其它（providers / constant / security / token_usage） | 7 | 249 → **132**（`openai_chat_model_compat.py` 125 → 8，实现搬进 fork 自有 `providers/visible_text_compat.py`） | 2,899（未重算） | 0 |
| Q scripts/pack（桌面打包） | 2 | 41 | 11 | 0 |
| R scripts 其它（install.* / README） | 3 | 21 | 43 | 0 |
| S website/public/docs（文档站正文）**✅ 已执行（已闭环 48）** | 4 → **0** | 12 → **0** | 325 | 0 |
| U .github（CI 与模板）**✅ 已执行完（已闭环 48 + 58）** | 2 → 1 → **0** | 26 → 16 → **0** | 124 | 0 |
| V 仓库根（pyproject / Makefile / CONTRIBUTING / deploy 等）**部分已执行（已闭环 54 + 58）** | 10 → **7**（`Makefile`、`CONTRIBUTING{,_zh}.md` 三宿主退出） | 364 → **167**（现算 `--json`；**364 是 2026-10-01 首版快照，与本轮读数不可做加减**） | 1,752 | 0 |

各簇的落点与前置条件：

**A — console/src/locales/*.json（界面文案）**。fork 在此新增 302 行私有文案 key。落点已存在：`console/src/locales/copaw/{projects,pipelines,rpa}/*.json`（18 个 fork 自有文件，+2,762/−0）。把这 6 个文件里的 key 迁过去，6 个冲突文件直接清零。**前置未验证**：v2 `console/src/i18n.ts` 用 `createInstance` + `as const` 硬编码 7 个 loader，全仓无 `addResource`，fork 现在靠改 `i18n.ts` 的 36 行 import 注册 —— 注册面本身也要搬出上游文件。 → **✅ 已执行（2026-10-02，分支 `wp/13-locale-exit` @ `ee400b053`，WP-13）**：6 个上游 locale 回到 merge-base `e111ec6fb` 字节（`cmp -s` 逐个验等，顺带修掉 `id.json` 的缩进破坏）；302 行私有 key 按**原 key path** 搬进新增的 fork 自有 `console/src/locales/copaw/workbench/*.json`（en/zh 各 134 行、其余 4 语言各 15 行，真根键 4 个 = `nav`/`nlpConfig`/`projects`/`agentConfig`）；注册面搬进 fork 自有 `locales/copaw/register.ts`，`i18n.ts` 从 **+91/−7 降到 +16/−1**、上游 `resources` 字面量字节原样。**P1 实测：172 → 166 文件、行为 168 → 162、侵入新增 +14,932 → +14,555（−377）、上游行删除 −2,584 → −2,576、命名册 126 不变、rc=0。** 那个"前置未验证"现在有答案了，且答案分两半：**插件层拿不到 i18n 句柄**（计划 §8 已闭环 39 ⑧，不变），但 **fork 自有 `console/src` 代码里调 `addResourceBundle(lng,"translation",overlay,true,true)` 确实生效** —— 已闭环 45 ④ 还查出 `deepExtend` 会原地改写 store 里的 `pack`（可能就是 init 按引用拿走的上游 JSON 对象），所以**必须 overlay-only**，否则"零侵入"是假的。等价性由两条独立证明守着（叶子级规范化 JSON 深度比对 6 语言 `VERIFY OK` + fork 自有 `register.test.ts` 19 条）。**残留：`i18n.ts` 那 +16/−1 让簇 G 少 75 行、但让"上游文件改动数 = 0"这条 Gate 仍差 1 个文件。**

**B — console/src/plugins（插件宿主）**。插件宿主代码。落点 = v2 的 `plugins/api.py`（17 个 `register_*`）与 PawApp SDK；不在上游宿主文件里加分支。

**C — console/src/api（前端 API 客户端）**。前端 API 客户端（`api/modules/agents.ts` +718、`api/types/agents.ts` +617 等）。落点 = fork 自有 `console/src/copaw/api/*`，经 v2 的 plugin/宿主接缝引用。

**D — console/src/pages（前端页面）**。页面级改动，最大的簇。落点 = 工作台（`console/src/copaw/workbench/`，fork 自有目录）+ v2 的 route/menu 注册；`route.replace(pluginId, "core.root", …)` 是 D-12 默认落地界面的实现路径，**其作用域未验证**。

**E — console/src/components（前端组件）**。组件级，多数改动很小。逐条判：能搬到 fork 自有组件就搬，纯文案还原。

**F — console/src/layouts（布局与顶栏）**。布局与顶栏，含品牌可见面（`Header.tsx` 的 `<span>CoPaw</span>`、`index.module.less`）。落点 = v2 的 `<Slot name="header.logo" kind="replace">`（`AppBrand.tsx:297`，上游测试 `index.module.test.ts:38` 钉住）。这是 D-22 阶段 B 的内容，不在阶段 A。

**G — console/src 其它（App.tsx / i18n.ts / utils / styles）**。`App.tsx`（§6.1 在册例外之一）、`i18n.ts`（36 行注册面）、`utils/navigationMode.ts`（§6.1 另一例外）、`styles/layout.css`。`navigationMode.ts` + `App.tsx` 是封闭清单 2 文件，其余要搬。 → **部分已执行（2026-10-02，WP-13）**：`i18n.ts` 的注册面已搬进 fork 自有 `locales/copaw/register.ts`，该文件从 **+91/−7 降到 +16/−1**（簇 G 因此从 165 行降到约 90 行，且上游 `resources` 字面量回到字节原样）；剩下那 16 行 = 1 行 import + `resolveInitialLanguage()` + 一行 `registerCopawTranslations(i18n)` 调用，**插件层拿不到 i18n 句柄**（计划 §8 已闭环 39 ⑧）⇒ 这 16 行目前无法搬出上游文件，是 WP-08 Gate"`console/src` 上游文件改动数 = 0"的唯一残留差项。

**H — console 配置（tsconfig / vite / package.json）**。构建配置。`vite.config.ts` +25、`package.json` +21/−13（含 fork 的 `postinstall: patch-chat-flushsync.mjs` 树外 patch，版本锁 `^1.1.64-beta` vs v2 `1.2.0-beta` → 同步时几乎确定失效）。落点 = fork 自有构建包装。

**I — src/qwenpaw/app/routers（后端 HTTP 路由）**。后端路由，**单簇侵入最大（5,676 行，其中 `app/routers/agents.py` 一文件 +4,190/−326）**。D-16 已把实现下沉进 `src/qwenpaw`，所以这里剩的是"路由注册 + 上游 agents 路由被改写"。落点 = v2 插件路由（`plugins/registry.py` 硬拼 `/api` 前缀，`register_middleware` 是请求级不是 ASGI ⇒ 拿不到顶层 mount，已实测）。这一簇需要 WP-03/04 的 PawApp 化设计，不能机械搬。 → **第一刀已执行（2026-10-02，`wp/integration`，计划 §8 已闭环 51）：`app/routers/tools.py` +28/−111 → 0/0，整文件退回 merge-base 字节并退出 P1 册与冲突面**。它是第 5 个"替换型 hunk"：fork 把上游从插件 manifest 读 `requires_config` / `config_fields` / `config_values`（含 password 掩码）的富 `_build_tool_info` 换成 6 行单参 stub，111 行删除里 96 行是那个函数体；`git grep` 确认 v2 仍保留富版本（`upstream/main:src/qwenpaw/app/routers/tools.py:143`）⇒ 回归而非重构。症状是**用户可见的**：`ToolInfo` 那三个字段模型仍声明，`response_model` 于是把 `requires_config=false` / `config_fields=null` 序列化出去，而 `console/src/pages/Agent/Tools/useTools.ts:44-51` 在 PATCH 成功后 `{ ...t, ...result }` ⇒ 列表页真好值被 stub 默认值覆盖，"配置"入口消失到刷新为止；**这两个前端文件对 merge-base 的 fork diff 都是空的**，责任全在后端。图标回退 `_DEFAULT_TOOL_ICON` 那 4 行判 `DROP`（四条证据见已闭环 51 ④，含"前端 `tools.ts:22` 把 `icon: string` 声明成必填 ⇒ 想要 🔧 只能往上游文件加行"）。这一刀同时**第一次真正缩小冲突面：142 → 141**，该簇 fork 侧行为行 16,222 → 16,083。⇒ **新增一条可复用的减面手法**：对"fork 只是替换了上游实现、且替换没换来任何东西"的文件，**退回字节直到 `git diff --no-renames e111ec6fb -- <path>` 为空**，该文件就按判据（行为行 > 0）退出冲突面；前面几刀（簇 A/O/P）都在册上减行但面不动，正是因为宿主仍有非零行为行。**本簇剩余 8 个文件仍以 `agents.py`（+4,190/−326）为大头，按原判定要等 WP-03/04 设计。**

**J — src/qwenpaw/app/runner（会话与消息处理）**。上游把整个 `app/runner/` 换成了 `app/chats/`：**22 个文件、3,187 行删除**。fork 有改动的那 6 个里 3 个（`session.py` / `__init__.py` / `query_error_dump.py`）被 v2 改名带走（同步时是普通冲突，看得见），另外 3 个（`api.py` / `command_dispatch.py` / `models.py`）是重写后当作删除处理（属于静默丢失那 15 个）。逐文件判定见 §4.3 —— 结论比"整簇要搬"轻得多：绝大部分 fork 改动已被 v2 用别的实现覆盖（`DROP`，含本轮改判的**历史分页**），真正需要搬的是 `tail-user/delete` 端点与 `ChatUpdate.meta` 的写路径两件，`.snapshot` sidecar 与 chat runtime-status 各待一项用户裁决。

**K — src/qwenpaw/app/mcp（MCP 客户端）**。`app/mcp/{manager,stateful_client,watcher}.py` **三个文件在 v2 里全部不存在**（上游删了 1,282 行），而 fork 在 `stateful_client.py` 里有 +690/−396。**v2 的落点已查清**（`UPSTREAM_V2_MIGRATION_PLAN.md` §8 已闭环 33）：MCP 被收敛进 driver 体系 —— `drivers/handlers/{mcp,mcp_stateful_client,mcp_streamable_http}.py`（`mcp_stateful_client.py` 1,084 行，`_MCPClientMixin` / `StdIOStatefulClient` / `HttpStatefulClient` 同名同位）+ `drivers/manager.py` + `app/driver_config_watcher.py` + 配置面 `app/mcp/{config_service,schemas}.py`。fork 那六项私有能力里，**配置 mtime 快照热重载已被 v2 的 `app/driver_config_watcher.py` 覆盖（`DROP`）**，其余五项（`refresh_client_status` / `failed_keys` / `_probe_client_capabilities` / `_resolve_stdio_command` / httpx 异常链诊断）在 v2 全树**逐符号命中 0** ⇒ 这一簇不存在"重放 patch"，只有 `搬迁`（`_resolve_stdio_command`，搬到构造 endpoint 配置那一层）、`原生`（走 v2 接缝重表达）与 `CUT` 三种标签。

**L — src/qwenpaw/app 其它（_app / migration / workspace / flow_engine 等）**。`_app.py`(+43/−15)、`migration.py`(+156/−125)、~~`agent_config_watcher.py`(+221/−110)~~ → **0/0（2026-10-02 已闭环 52 整文件退回字节，已退出本表与冲突面；归属见迁移计划已闭环 52 ⑤：那 221 行是 fork 坏合并复活的“上游 #4064 之前”实现，四类归属全部零保留价值）**、`agent_context.py`(+59/−33)、`workspace/*`、`multi_agent_manager.py`。这一簇混杂：`_app.py` 的两行是 D-22 品牌 patch（还原即可），其余逐条判归属。

**M — src/qwenpaw/agents（agent 工具、记忆、技能、prompt）**。agents 工具与记忆。含 `audio_transcription.py`(+335/−5，fork 加的本地 whisper 自动安装)、`file_io.py`(+60)、`prompt.py`(+31)。落点 = v2 的 agent 扩展接缝（`register_*` / skill 目录），逐条判。

**N — src/qwenpaw/config（配置模型与工具）**。`config/config.py`(+73/−3)。**这条减面机会已兑现（2026-10-02 在 `wp/integration` 上复核；动作本身是 WP-01 的 `daa0e8e28` + `2fcfb26f1`）**：那 17 个 fork 私有模型（`Knowledge*`、`GraphifyConfig`、`AgentsSquare*`、`SkillsMarket*`）早就搬进了 fork 自有 `src/qwenpaw/config/product_models.py`（**348 行；merge-base 里不存在 ⇒ 是"加了个新文件"，本来就不进冲突面**），`config.py:22` 那段 import 就是它的 re-export。⇒ 簇 N 现存的 +73 行全是**字段级侵入**（7 个 hunk：import 块、`ToolResultPruningConfig`、`AgentProfileRef`、`AgentProfileConfig`、`build_local_agent_tools_config`、`Config` 两处），**没有剩余的机械搬空间**，只能随 WP-06 逐字段判 `DROP`/`搬迁`。

**O — src/qwenpaw/cli（命令行）**。~~`cli/desktop_cmd.py`(+212/−133)。桌面 CLI 被 fork 大改；v2 侧同文件上游也改了 141 行。落点 = fork 自有 CLI 命令~~ → **✅ 已执行（2026-10-02，`wp/integration`，详见 UPSTREAM_V2_MIGRATION_PLAN.md 已闭环 49）：原估的"落点 = fork 自有 CLI 命令"不成立** —— `desktop` 这个命令住在上游自有文件里，打包入口 `scripts/pack/*` 同样上游自有，且已闭环 5 证明桌面入口加载不到 copaw overlay，加上"不许向 `src/qwenpaw` 加 `import copaw`"这条硬约束 ⇒ 没有任何上游自有的调用点可以把这笔改写"搬"到 `src/copaw/cli/*`。**实际动作 = 退回 merge-base 字节 + 只把真正的新能力钉回去**：212/133 逐 hunk 分四类后，只有 102 行的 `_cleanup_stale_desktop_backends`（清理旧版打包残留的后端孤儿进程）是第四类，原样保留在册内；其余是纯重构（`_serve_desktop_window` 等 4 次提取）、`print` 换 `logger` 的文案替换（零收益：`setup_logger` 本就写 stderr，`build_macos.sh:119-135` 两路都重定向进 `desktop.log`），以及**两个真 bug** —— fork 丢了上游的 `manually_terminated` 守卫 ⇒ 正常关窗口以 **-15** 退出（`sys.exit(-15)` → shell 241，而打包脚本专门按 `EXIT>=128` 判信号），以及 `with subprocess.Popen(...)` 在异常路径上不 kill 子进程 ⇒ **潜在永久 hang**（CPython `__exit__` 只 `wait()` 不 `terminate()`）。两条都已用测试固化（fork 自有 `tests/unit/cli/test_desktop_cmd_exit_code.py`，4 条，修前 3 红）。**读数：该文件 vs merge-base 212/133 → 111/0，vs v2 221/209 → 144/100；全仓 P1 154 文件 / +14,473 / −2,456。**⚠️ **它仍是冲突宿主**（v2 侧同文件上游改了 141 行），所以这一刀减的是**册**与**行为风险**，不减冲突面（147→142 由上一刀完成，本刀冲突面不动）。那 102 行的到期条件 = D-22 阶段 B 的 fork 自有构建 overlay 建好后，把它并进 `src/copaw/cli/*`。

**P — src/qwenpaw 其它（providers / constant / security / token_usage）**。providers / constant / security / token_usage。`constant.py` 只 +1 行；~~`providers/openai_chat_model_compat.py` +114/−11 需要判上游 v2 是否已有等价兼容~~ → **第一刀已执行（2026-10-02，`wp/integration`，详见 UPSTREAM_V2_MIGRATION_PLAN.md 已闭环 50）**：那 114/11 里被删的 11 行**正是上游 issue #4185 的畸形 `tool_use` 过滤守卫**，fork 把 `_sanitize_visible_text_blocks(parsed)` 直接放到了它的位置上（"替换型 hunk"），而 **v2 仍保留这道守卫、还把它扩成 dict-or-attr 并加进 `tool_call`** ⇒ 现树是活回归（空名 tool 块会被持久化进 session history；`_sanitize_tool_call` 对缺名 tool call 故意返回 `name=""` 而不是 `None`，所以除这道守卫外无人拦截）。动作 = **守卫逐字节贴回 merge-base 版本 + 110 行 leaked-thinking 实现搬进 fork 自有新文件 `src/qwenpaw/providers/visible_text_compat.py`（123 行，不进册）**，只留两个公有调用点 ⇒ 该文件 **114/11 → 8/0**（对 v2 是 292/687 → 194/684），WP-06 在这个宿主的回放塌缩成"重钉两个调用点"。红→绿测试：新增 fork 自有 `tests/unit/providers/test_openai_stream_malformed_tool_use_compat.py`（2 条，1 条改前红）。**簇 P 其余 providers 侵入的对 v2 等价性（这就是 P 行原来挂着的问题，已答）**：`retry_chat_model.py` +62/−16 的 **SDK 异常加宽 v2 已原生覆盖**（v2 新建 `model_error_policy.py:29-41`，两个 `InternalServerError` 都在，`retry_chat_model.py:177-183` 委托 ⇒ WP-06 `DROP`）；**v2 没有**异常链遍历（`__cause__/__context__`，v2 `providers/` grep 0 命中）、**没有** `httpcore` 类（0 命中）、**没有**重试耗尽的终态 `logger.error`；`openai_provider.py` 的 `"EMPTY"` 占位 api key（`require_api_key=False` 的本地兼容端点）v2 也 0 命中、仍直传 `self.api_key`（v2 `:178`/`:514`）⇒ 这三项是真 fork 成果，随 WP-06 逐条搬。⚠️ 记下未动：fork 的 `httpx.TransportError` 比 v2 的三类更宽（把 `ProxyError`/`UnsupportedProtocol` 变可重试），是行为差异不是 bug，WP-06 要显式判。**全仓读数：P1 154 文件 / +14,367 / −2,445，行为 153 / +14,333 / −2,411；冲突面 142 不变**（该文件 v1→v2 上游自己改 685 行，仍是重冲突宿主；这 142 个文件里 fork 侧行为行合计 16,222，本宿主贡献从 125 降到 8）。⚠️ **P 行还剩**：`security/skill_scanner/data/default_policy.yaml`（−1）、~~`security/tool_guard/guardians/file_guardian.py`（+3/−2）~~ **已判（2026-10-03，已闭环 59）**：那 3/2 里只有 `_workspace_root()` 的一行是真 fork 行为（focus 优先回落 workspace），另两行是"把上游 import 行改写 + 同符号重复绑定"，改回**上游原行 + 一行加性 import** ⇒ **3/2 → 2/1**，顺带消掉该文件长期挂着的一条 `F811`；`token_usage` 侧 —— 未逐 hunk 判。

**Q — scripts/pack（桌面打包）**。`scripts/pack/build_macos.sh`(+15/−2 行为 + 3 命名)、`build_win.ps1`（纯命名 7 行）。落点 = D-22 §4 的 fork 自有构建 overlay；顺序要求是先建 overlay 再还原这 25 行命名。

**R — scripts 其它（install.* / README）**。`scripts/install.bat`(+6/−2 行为 + 2 命名)、`install.sh`(+4/−1)、`install.ps1`(+8)。落点 = fork 自有安装脚本。

**S — website/public/docs（文档站正文）**。文档站正文 4 文件（`cli.{en,zh}.md`、`desktop.{en,zh}.md`），阶段 A 还原 67 行命名后各剩 2 行。落点 = 新建 `website/public/docs/copaw/*` 或 fork 自有页面，需查 v2 文档站的注册方式（未验证）。 → **✅ 这 4 个文件已于 2026-10-02 退回 merge-base 字节（已闭环 48）**：`cli.*` 剩的那 2 行是纯改名（其中一行引用的正是 `_app.py` 里被硬编码的 console 文案，所以**连同 `_app.py` 的 `{PROJECT_NAME}` 一起还原才自洽**），`desktop.*` 剩的是被删掉的空行。⇒ **簇 S 现在 0 文件**，"新建 `docs/copaw/*`"那条落点问题不再是这 4 行的前置。

**U — .github（CI 与模板）**。.github 2 文件（`frontend-tests.yml` +10 是 fork 的 locale guard 步骤、`ISSUE_TEMPLATE/config.yml` +3）。落点 = fork 自有 workflow 文件（D-22 的 `copaw-desktop.yml` 就是这个模式）。 → **✅ 两笔已于 2026-10-02 清完（已闭环 48）**：locale 守卫整块搬进 fork 自建的 `unit-tests.yml`（脚本 `REPO_ROOT` 取自 `__file__`、只用标准库 ⇒ 与 cwd 和 npm 都无关，放前端 job 没有理由），`paths` 补 `console/src/locales/**` + 脚本自身 ⇒ 触发面不减，`frontend-tests.yml` 回 merge-base 字节；`config.yml` 那 3 行 `contact_links` 是冗余入口（release checklist 模板本体是 fork 新建文件，GitHub 自动列进模板选择器）⇒ 整块退回。⇒ **簇 U 现只剩 `.github` 里那些 fork 新建文件（账外）**。

**V — 仓库根（pyproject / Makefile / CONTRIBUTING / deploy 等）**。仓库根 10 文件（`pyproject.toml` +10 依赖与 package-data、`Makefile`、`CONTRIBUTING*`、`.gitignore`、`deploy/Dockerfile`、`README*` 4 篇）。README 4 篇里 fork 自写章节共 16 行品牌内容属此类；`pyproject.toml` 的 +10 与产品名无关（实测 = 4 行依赖 + 1 行 package-data 等），不要当品牌税处理。
>
> **2026-10-03 现算（已闭环 58 + 60 之后）**：本簇只剩 **4 个冲突宿主** —— `README.md` +7/−0（banner 已缩成纯加行块，另三篇 README 逐字节退回 ⇒ 出面）、`pyproject.toml` 10/1、`.gitignore` 4/0、`deploy/Dockerfile` 1/0；`Makefile` 与 `CONTRIBUTING{,_zh}.md` 与 `.github/PULL_REQUEST_TEMPLATE.md` 已由已闭环 58 归零。上面那句"仓库根 10 文件"是本表第一版的读数，别再引用。

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
| **运行时状态模型**：`ChatRuntimeStatus` + `ChatRuntimeStatusBreakdownItem`（`models.py` 108 行的主体） | **实测这条不是"丢失的成果"，而是接了但必然失败的功能**（现树上每次打开面板都显示"采集异常"，细节见 §4.7）：前端调用点存在（`console/src/api/modules/chat.ts:152` → `GET /console/chats/{id}/runtime-status`，消费方 `AnywhereChat/index.tsx:1672`），但后端 `app/routers/console.py` 的路由清单里**没有**该路径（v2 console 面只有 `/chat`、`/chat/stop`、`/upload`、`/debug/backend-logs`、`/chat/task{,/{id}}`、`/push-messages`、`/inbox/*`）；`app/runner/runtime_status_store.py` 的 `RuntimeStatusRecorder` / `persist_runtime_status` / `set_current_runtime_status_context` **零生产调用者**（`token_usage/model_wrapper.py:25` 收 `runtime_status_recorder=None`，无人传）。**复核期间的附带发现**：v2 确实有一个同名不同物的端点 `GET /api/agents/{agentId}/memory/runtime-status`（`app/routers/agents.py:1465`，`response_model=MemoryRuntimeStatus`，实现在 `memory_manager.get_runtime_status(...)`，前端 `agents.ts:129` 有调用、集成测试 `test_contract_batch_agents.py:257` 钉了契约）—— 它是 **agent 记忆/ReMe 生命周期**状态，不是 per-chat 的 token/耗时分解，**不能当原生替代**；它的价值是给出上游认可的形状：manager 上放 `get_runtime_status()` + 一个 typed response model + 一条只读路由 | **`CUT` + 清理已裁（2026-10-01，用户确认）**：整套删除，不计入搬家量。删除集合 = `models.py` 里 `ChatRuntimeStatus` / `ChatRuntimeStatusBreakdownItem`（那 108 行的主体）、`app/runner/runtime_status_store.py`、`token_usage/model_wrapper.py:25` 那个没人传的 `runtime_status_recorder` 参数、前端 `api/modules/chat.ts:152`、`components/AnywhereChat/index.tsx:1672` 的消费与 `console/src/utils/chatRuntimeStatus.ts`、e2e `console/e2e/pipeline-design-chat.spec.ts:382` 的 mock。理由：它在当前树上从来不是活功能（后端无路由、store 零调用者），删它是**减债不是丢成果**；将来若真要做 per-chat token/耗时面板，按 v2 那个形状新做 |
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
- **净删除项（减债，不是搬家）**：chat runtime-status 整套 —— `ChatRuntimeStatus` + `ChatRuntimeStatusBreakdownItem`（`models.py` 108 行的主体）、`runtime_status_store.py`、`model_wrapper.py:25` 那个没人传的参数、前端 `chat.ts:152` 与 `AnywhereChat/index.tsx:1672` 与 `utils/chatRuntimeStatus.ts`、e2e mock `pipeline-design-chat.spec.ts:382`、~~**runner 包 `__init__.py` 那 38 行懒加载守卫**~~（原判"它唯一的存在理由就是懒加载 `runtime_status_store`"已作废，实测守卫另有承载，见 §4.7 执行记录）。

~~**这 5 条搬迁/原生线的净实现行数仍不给数字**~~ —— **本节当时不给，§4.8 已给出：`搬迁` 394 行 + `原生` 300 行 = 694 行净写作量。** 不给的原因成立过一次：`git diff --unified=0` 的 35 个 hunk（session.py）与 68 个 hunk（stateful_client.py）里 `DROP` 与差集交错出现，按文件总量估会把 `DROP` 那半也算进工时；§4.8 用"逐 added 行归属到最近 `def`/`class` + 混合符号显式拆行区间"把它结掉了，并且**真的拆出三处按文件估会算错的地方**。

这条结论直接反驳了 `UPSTREAM_V2_MIGRATION_PLAN.md` §2 表里那行 P2 判据（"上游删了 `app/runner/*` 7 个文件…等于上游替我们做了裁决，无需决策"）：**上游删掉宿主文件不等于上游删掉了需求**，`tail-user/delete` 与 `ChatUpdate.meta` 的需求在 fork 自有的 `AnywhereChat` / `Projects` 页面上依然活着，只是失去了后端载体。那行判据需要按本节改写（见 §8）。

### 4.7 D-23 裁决记录（2026-10-01，用户确认）

簇 J / K 复核后剩的 4 个开放项一次裁完，共同依据是短期目标里那条"去债优先，但要分清丢的是**成果**还是**债**"：

| # | 裁决 | 放弃的东西 | 如实记下的代价 |
|---|---|---|---|
| ① | 免启动 workspace 快路径 `CUT`，沿用 D-19 | `_resolve_chat_workspace_dir` 7 行 | 冷启动打开会话列表要先加载 workspace，这条快路径带来的启动性能收益消失 |
| ② | chat runtime-status **整套删除**（不是 `CUT` 掉上游改动，是删 fork 自己的死码） | `ChatRuntimeStatus` 两模型 + `runtime_status_store.py` + 前端调用/工具/e2e mock（~~+ runner 包 38 行懒加载~~，守卫不随本项删，见下方执行记录） | 无。它在当前树上从来没有活过：后端无路由、store 零生产调用者。将来要做 per-chat token/耗时面板时按 v2 的形状（`get_runtime_status()` + typed response + 只读路由）新做 |
| ③ | session 的 `.snapshot` sidecar `CUT`，信任上游容错 | 备份回滚这条退路 | 截断写入（写一半掉电）这类 `utils/json_utils.safe_json_loads` 救不回的情况，CoPaw 不再能自愈 |
| ④ | `_is_mineru_stdio` `CUT`，随 roadmap 一起重做 | 9 行"启动前查 `MINERU_API_KEY`"的清晰报错 | `docs/devops/FORK_ROADMAP.md:22` 那行"内置 mineru_mcp"**保持"计划中"不撤**；真进产品时按 v2 `app/mail/driver_config.py:57 resolve_qwenpawmail_endpoint()` 的形状（构造期解析 + env 覆盖）重写，与 `_resolve_stdio_command` 同批 |

**这四项合起来消掉的冲突面**：`app/runner/{api,models}.py` 里那 7 + 108 行、`session.py` 的 sidecar 三件套、`stateful_client.py` 的 9 行 mineru 分支，以及前端 `chat.ts` / `chatRuntimeStatus.ts` / `AnywhereChat` 消费点 —— 全部不需要在 WP-06 里重放。（`runner/__init__.py` 的 38 行懒加载**不在其列**，见执行记录。）**这条记录的作用是把它们变成"有意识的放弃"**，下次同步时不再作为"疑似丢失成果"被重新翻出来。

**执行时机要分两类，别顺手一起删**：

- **①③④ 与 plan 面板这 4 项 `CUT` 随 WP-06 同步执行**，不在现树提前动手。理由：它们在 CoPaw **当前** 1.x 树上是**在跑的功能**（冷启动列会话、损坏回滚、mineru 报错提示、plan 面板），现在删等于让现网用户付代价而冲突面并不额外减少 —— WP-06 换基线时"不再重放 fork 改动"本身就是删除，效果相同、零现网成本。
- **② runtime-status 整套可以在现树立即删**，且应该立即删。它在当前树上不是"没接上"，而是**接了但必然失败**：`loadRuntimeStatus` 只在用户打开那个面板时才发请求（`index.tsx:2402-2409` 的 `if (!runtimeStatusOpen) return`），而后端**整棵树没有这条路由**（`grep runtime-status src/qwenpaw` = 命中 0，只有 `token_usage/model_wrapper.py:25/:33/:85` 那个没人传的参数在引用 recorder），于是每次打开都走 `catch` ⇒ `console.warn` + `setRuntimeStatusError(...)`（`:1680-1687`），触发器徽标从此显示"采集异常"（`:3254` 的 `chat.runtimeStatusError`、`:3449` 的 `chat.runtimeStatusErrorShort`）。e2e 靠 `pipeline-design-chat.spec.ts:382` 的 mock 通过，所以这条**用户可见的坏状态在测试里是隐形的**。删它是纯减债。这一项单独开一个提交，不夹带在任何迁移工作里。删除时别碰 `knowledge/manager.py:3571` 那族 `runtime_status` —— 那是 NER 就绪状态，同名但是活功能。

**执行记录（2026-10-01，`7f8cff1ae`）**：删掉 11 个文件路径、**1,806 行 / +7**，`tests/unit/{app,knowledge,scripts}` 回到基准 **2F/607P**（那 2 条是 py3.10 无 `BaseExceptionGroup`），`tests/unit/{app/runner,token_usage}` 41P/9XF，`tsc -b --noEmit` 无新增错误。两条原判需要更正：

1. **`runner/__init__.py` 的 38 行懒加载守卫不能删。** 把上游的急加载 `__init__` 搬回来，`import qwenpaw.app.agent_context` 立刻 `ImportError: cannot import name 'get_agent_for_request' from partially initialized module`，`tests/unit/app` 有 **14 个模块收集失败**。链路是 `agent_context → multi_agent_manager → workspace/workspace.py:30 (from ..runner.task_tracker …) → runner/__init__.py (from .api) → api.py:28 (from ..agent_context)` —— 上游在 merge-base 把 `get_agent_for_request` 写在函数内（`api.py:24`），fork 把它提到模块级（还多带两个 helper），这才是环的成因；`runtime_status_store` 从来不是。⇒ **守卫的真实承载是这处 fork 模块级 import，删除动作随 WP-06**（把 import 收回函数内即可同时消掉 `api.py` 的命名/行为差异与这 38 行）。已在 `__init__.py` docstring 里改写成这个真实理由。
2. **前端比原判更大一圈。** `transientMessages` 状态机（state + `updateTransientMessages` + 7 个调用点 + `pendingUserMessage` 构造）在删掉面板后成为**只写不读**：它唯一的读者是 `transientHistory`/`fallbackHistory` 两个 memo，而这两个 memo 只喂 runtime-status。它藏在 `send()` 与 SSE `finalize()` 的热路径上，属于同一套死码，随本项一并删（`AnywhereChat/index.tsx` −476 行）。

### 4.8 hunk 级净行数账目（2026-10-01，§9 未验证 7 结案）

方法：`git diff --no-renames --unified=0 e111ec6fb HEAD -- <path>` 取全部 added 行，按 **HEAD 侧的行号归属到最近的 `def`/`class`**（`git show HEAD:<path>` 重建符号表），再对 §4.2/§4.3 的判定表逐符号打标签；混合符号用显式行区间拆分。**账目只算 added 行**（re-implement 的工作量在新增侧；删除侧的 fork 代码在同步时是"不再重放"，零写作量）。

输入 7 个文件（§9-7 那 6 个 + fork 自有新文件 `runtime_status_store.py`，因为它是净删除项的主体）：

| 文件 | added | removed |
|---|---|---|
| `app/mcp/stateful_client.py` | 690 | 396 |
| `app/mcp/manager.py` | 194 | 16 |
| `app/runner/api.py` | 457 | 34 |
| `app/runner/models.py` | 108 | 0 |
| `app/runner/session.py` | 320 | 176 |
| `app/runner/__init__.py` | 21 | 17 |
| `app/runner/runtime_status_store.py`（fork 自有） | 382 | 0 |
| **合计** | **2,172** | **639** |

**分桶读数**：

| 桶 | added 行 | 明细 |
|---|---|---|
| `DROP` | **864** | 生命周期与写盘加固 694（`stateful_client.py` 465 / `session.py` 193 / `manager.py` 28 / `api.py` 8）、历史裁剪 89、分页 39（`api.py` 30 + `ChatHistory` 9）、历史预览 26、路由改写 16 |
| `净删除` | **472** | `runtime_status_store.py` 382 + `models.py` 两模型 69 + `runner/__init__.py` 21（`__getattr__` 12 + 它所在的 9 行懒加载块） |
| `搬迁` | **394** | tail-user 端点 192（`delete_tail_user_message` 164 + 2 import + `ChatTailUserDelete{Request,Response}` 26）、**tail-user 依赖 134**（见下方"耦合"一条）、stdio 命令解析 64、`ChatUpdate.meta` 4 |
| `原生` | **300** | MCP 运行状态三件套 148（`@@ -61,0 +68,139 @@` 那一整块 + 6 处 `_failed_keys` 触点 + 启动失败文案 3）、httpx 异常链诊断 152（5 个 helper 133 + `import create_mcp_http_client` + `manager.py:420-437` 的 header 脱敏日志 18） |
| `CUT` | **142** | 免启动快路径 66（`_resolve_chat_workspace_dir` 6 + `list_chats` 19 + `create_chat` 22 + `get_chat` 分支 11 + 6 import）、`.snapshot` sidecar 49（三方法 41 + 4 处调用点及其 guard）、mineru 27（`_is_mineru_stdio` 7 + `_run_lifecycle:316-335` 的 guard 20） |
| **总计** | **2,172** | 校验：864+472+394+300+142 = 2,172 = 逐文件 numstat 之和 |

**排期结论：这 18 文件簇里真正要写代码的是 694 行（`搬迁` 394 + `原生` 300），占 fork 侧总量的 32%。其余 1,478 行是"同步时不再重放"，零写作量。**

三条只有拆到 hunk 才看得见的账目修正：

1. **`tail-user` 这条 `搬迁` 线不是 164 行，是 192 + 134。** `delete_tail_user_message` 调 `_load_visible_messages_for_chat`（24）、`_memory_item_to_message_dict`（8）、`_is_user_memory_message`（4）、`_extract_text_from_content`（15），后两者又调 `session.py` 的 `normalize_in_memory_memory_state`（29）+ `_normalize_memory_state_item`（15）+ `_coerce_message_dict`（25）+ `restore_in_memory_memory`（7）。这 134 行在 §4.3 里全部记在 `DROP` 名下 —— 按文件总量估时会把它们算成零成本，**这是 §4.6 那句"按文件总量估会把 `DROP` 那半也算进工时"的具体形态，方向反过来也成立**。**而且这 134 行大概率不该搬**：v2 `chats/api.py:816 get_chat` 已经把消息存储从 `agent.memory`（`InMemoryMemory` 的 `content` 二元组列表）换成 `agent.state.context`（`AgentState.model_validate`，失败退 `chats/utils.py:110 parse_legacy_memory_state`），fork 这套 memory-state 归一化是给 **v1 内存布局**打的补丁，v2 有自己的读路径 ⇒ 搬过去等于在 v2 之上再维护一套 legacy 读法。**代价是 tail-user 端点要按 v2 的形状重写而不是照搬**：读 `AgentState.context`、末位 user 消息的判定与"可见序列 ↔ 持久序列"的索引对齐逻辑（fork 那 164 行的主体，是真实需求逻辑）保留，底下 134 行的存取层换成 v2 原生。给排期的区间因此是 **192（下限，v2 读写路径原生可用）～ 326（上限，需要自带 legacy 归一化）**，取下限的前提是 WP-06 落地时实测 v2 的 `update_session_state`（`chats/session.py:354`，点分路径 + `get_path_lock` + `write_json_atomic_async`）能写回 `agent.state`。
2. **`_run_lifecycle` 里那 20 行（`stateful_client.py:379-398`）不属于生命周期重写。** 它是 `except FileNotFoundError` 的"stdio 命令找不到"诊断：拼错误消息、给 `uvx`/`uv` 提示、用 `shutil.which` 判断是否在 PATH。它和 `_resolve_stdio_command` 是同一个需求的两半（一个管解析、一个管解析不了时说人话），所以账目里并进 `搬迁/stdio`。**若实施时判定 v2 的 driver 面不需要这条报错，`搬迁` 从 394 降到 374。** 同一函数里另 51 行是生命周期重写，仍在 `DROP`。
3. **`manager.py` 的 `_build_client`（+43/−14）是个三合一混合符号，其中一条是 fork 引入的上游功能回归。** 拆开：`420-437` header 脱敏调试日志 18 行（记 `原生`）；`439-461` 把 `sse` 强制改写成 `streamable_http` 并 `warnings.filterwarnings` 抑制 agentscope 的 deprecation（23 行，v2 由 drivers 体系接管 transport ⇒ 记 `DROP`，本轮未单独裁）；`416`/`462` 两行 `setattr(client, "_copaw_rebuild_info", …)` 是**纯命名税** —— 上游 merge-base 本来就有 `_qwenpaw_rebuild_info`（`e111ec6fb:manager.py:267/:285`），fork 只是并列加了一个 `CoPaw` 别名的 setattr，这两行归 D-22 阶段 A 退回去。**最重要的一条不是行数而是这个：fork 在同一次改动里删掉了 `MCPClientManager._inject_oauth_token(headers, client_config, …)` 的调用，而该方法仍留在 `manager.py:368` 且全仓零调用者。** 上游 merge-base 在 `_build_client` 里是注入 OAuth token 的（`e111ec6fb:manager.py:274`），fork 换成了 header 调试日志 ⇒ **远程 MCP 的 OAuth token 注入在 CoPaw 现树上已经断了**。它落在 `DROP` 桶里，同步时随"还原上游语义"自愈，但**必须显式检查而不是指望自愈**：v2 不仅保留了这件事，还把它做得更完整 —— `app/mcp/config_service.py:32/:103-111` 走 `mcp_oauth_credential_ref` 的凭证引用体系（`_credential_ref_by_alias_or_kind` + `load_optional_credential`），说明**OAuth 在上游是活的能力，不是打算废弃的旧码**。建议单独立一条现网 bug 复核（不在本 WP 范围内动代码）。

**§4.8-3 复核结案（2026-10-02，task #38 诊断 + #40 修复）**：回归确认存在，已在独立分支 `fix/mcp-oauth-injection`（基点 `wp/02-ownership`，提交 `0ea653fef`）修掉，未开 PR。

- **根因**：`_build_client` 是全仓唯一读取 `client_cfg.oauth.access_token` 的路径，而它不再调用 `_inject_oauth_token`（merge-base `e111ec6fb:manager.py:274` 有这笔调用）。于是 `app/routers/mcp_oauth.py:545-590 _persist_tokens` 走完整 RFC 8414/9728 + PKCE 流程后写进 `client_cfg.oauth` → `save_agent_config` → `schedule_agent_reload` 的 token，**没有任何消费者**。
- **用户可见形态**：浏览器弹「Authorization successful!」、`GET /oauth/status/{client_key}` 报 `authorized: true`，但每个请求都不带 `Authorization` 打到远程 MCP server ⇒ 401。可达性已核实：`MCPOAuthConfig` 字段仍在线（`config/config.py:1327/:1359`）、`mcp_oauth.py` 是上游自有且 fork 未改、console 侧 `MCPClientCard.tsx` 的 Authorize 按钮与 `api/modules/mcp.ts` 仍在调 `/mcp/oauth/start`。
- **为什么一直没被发现**：token→header 这条路径全仓零测试覆盖。唯一的 OAuth 测试 `tests/integration/test_mcp_oauth.py`（上游自有，未改）测的是 404/错误页，而 `.github/workflows/unit-tests.yml` 只跑 `tests/unit`。
- **修复内容**：恢复注入调用，headers 构造还原成 merge-base 形态（始终为 dict、先 `expandvars` 再注入），调试日志留在注入之前以免 Bearer token 进 debug 日志；fork 自加的诊断日志块本身不动（删它属于丢成果）。新增 `tests/unit/app/test_mcp_oauth_injection.py` 4 条：空 headers 也必须注入 / 覆盖手工设置的 `Authorization` 且不改动 `config.headers` / 过期 token 不注入 / `expandvars` 与注入共存。
- **P1 是实测不是断言**：`manager.py` 相对 merge-base 由 `+194/−16` 变 `+194/−13` ⇒ 单文件 behavior **210 → 207**，全库 `behavior_added` 14932 **不变**、`behavior_removed` **2584 → 2581**（多还原了 3 行上游字节），`check_p1_invariants.py --check` 保持 rc=0，**基线未改**。踩到的工具事实：`--check` 的 target 默认 `HEAD`，未提交的改动对门禁不可见，要量工作区得用 `--target-ref working`。
- **遗留（本笔不处理）**：`rebuild_info` 从 merge-base 起就不携带 `oauth`，所以 `agents/react_agent.py:728-765 _rebuild_mcp_client` 的重连路径仍会丢 token —— 这是**上游既有缺口而非 fork 造成**，不该记在 fork 账上。v2 侧 `app/mcp/manager.py` 已被上游删除，改由 `app/mcp/config_service.py` + `drivers/credentials/bindings.py:91` 的 credential binding 承担 ⇒ 本修复只对 v1 树有效，WP-06 落地时随文件一起消失。

**净删除项的完整尺寸（本 WP 之外的前端侧）**：后端 472 行是精确值；前端另加 `console/src/utils/chatRuntimeStatus.ts` **整文件 313 行**、`api/modules/chat.ts` 里 `getRuntimeStatus` 那 3 行、`pipeline-design-chat.spec.ts:382` 的 mock、以及 `AnywhereChat/index.tsx` 内 **144 处 `runtimeStatus` 引用**（`grep -c`，散布在 `loadRuntimeStatus:1665-1692`、retry `:1695+`、面板门禁 `:2402-2409`、徽标文案 `:3254`/`:3449-3450` 等 6 个区块）。`AnywhereChat` 是 fork 自有文件（+3,806/−0），所以那 144 处不能从文件总量里估，task #36 落地时按区块删。

**这轮账目没覆盖的**：`app/routers/plan.py`、`console/src/pages/Agent/MCP/*`、`console/src/pages/Agent/Workspace/*` 等其余 11 个文件。它们不需要覆盖 —— §4.3/§4.4 已把它们整行判成 `DROP` 或 `CUT`（plan 面板整套 43 行 `CUT`，见 D-23），`原生` 那两条的**新写量**按 v2 接缝另计，不在"存量重放"的口径里。

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
| `src/qwenpaw/app/routers/tools.py` ~~+28/−111~~ → **0/0**（2026-10-02 已闭环 51 整文件退回字节，已退出本表与冲突面） | ~~+28/−111~~ | +259/−115（纯上游 v1→v2） |
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
| `src/qwenpaw/app/agent_config_watcher.py` ~~+221/−110~~ → **0/0**（2026-10-02 已闭环 52 整文件退回字节，已退出本表与冲突面） | ~~+51/−24~~（纯上游 v1→v2） |
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

> **2026-10-02 状态更正**：下表是**第一版读数**，不随执行回写。**簇 A 那 6 行（#2–#7）与 #94 `console/src/i18n.ts` 已执行完毕**（WP-13，`wp/13-locale-exit` @ `ee400b053`）—— 6 个 locale 文件已不再是冲突宿主（回到 merge-base 字节），`i18n.ts` 从 +91/−7 降到 +16/−1。执行后的 P1 读数：**166 文件 / +14,681/−2,702 · 行为 162 / +14,555/−2,576 · 命名 4/22/126 · rc=0**（详见 §3 簇 A 那条与迁移计划 §8 已闭环 45）。

> **2026-10-02 小面簇第一刀（迁移计划 §8 已闭环 48，分支 `wp/integration` @ `e04481ac8` + `1977f2d13`）**：`website/public/docs/{cli.en,cli.zh,desktop.en,desktop.zh}.md` 与 `.github/workflows/frontend-tests.yml` **5 个冲突宿主退回 merge-base 字节** ⇒ **冲突面 147 → 142**（在同一棵树上前后各算一次，不是引用本表第一版数）。另退掉 2 个"只被 fork 改、上游没碰"的文件（`.github/ISSUE_TEMPLATE/config.yml` +3、`.github/workflows/pr-under-review.yml` −2）—— 它们减册不减冲突面。全仓 P1 现读 **154 文件 / +14,574/−2,589 · 行为 153 / +14,540/−2,555 · 命名 1/9/34 · rc=0**。**一条口径纠正**：本表 §2/§3 长期写的"冲突面 149"是 `wp/13-locale-exit` 分支上的读数，`wp/integration` 主线（吃过两条 `fix/*` 之后）的真实值是 **147**。**另一条判据纠正**：这一刀退掉的 4 行文档改名**不在命名册里**（改名配对靠行相似度，markdown 表格行/正文句没配上对），所以"退行数"不能直接读成"命名税下降"。

> **2026-10-02 簇 P / 簇 I 两刀（迁移计划 §8 已闭环 50 / 51，分支 `wp/integration`）**：`providers/openai_chat_model_compat.py` **+114/−11 → +8/−0**（110 行 leaked-thinking 实现搬进 fork 自有新文件 `providers/visible_text_compat.py`，被盖掉的上游 issue #4185 守卫从 merge-base 逐字节贴回）⇒ 册 154 文件不变、**冲突面 142 → 142**（宿主仍有 8 行行为行，且上游 v1→v2 自己改了 685 行）。`app/routers/tools.py` **+28/−111 → 0/0**（整文件退回 merge-base 字节，本表 **#48 那行就此失效**）⇒ **P1 154 → 153 文件 / +14,367 → +14,339 / −2,445 → −2,334 · 行为 153 → 152 / +14,333 → +14,305 / −2,411 → −2,300 · 命名 1/9/34 · mechanical 1 · rc=0**，**冲突面 142 → 141**（本计划以来第一次真正减面），这 141 个文件的 fork 侧行为行 **16,222 → 16,083**。⇒ 本表那句"在册文件数 ≠ 冲突面"现在有了正面用例：**只有把某个宿主的 fork 行为行退到 0，它才退出冲突面**；只减册内行数而不归零的（簇 A/O/P）面不动。

> **2026-10-02 簇 L 第一刀（迁移计划 §8 已闭环 52，分支 `wp/integration`）**：`src/qwenpaw/app/agent_config_watcher.py` **+221/−110 → 0/0**（整文件退回 merge-base 字节；`service_factories.py` 构造点同步退回 `workspace=ws`，该文件 **16/1 → 14/0**）+ 删掉 fork 复活的 `src/qwenpaw/agents/hooks/memory_compaction.py`（**191 行**）与 `hooks/__init__.py` 那 3 行 re-export（**3/0 → 0/0**）⇒ **P1 153 → 151 文件 · 行为 152 → 150 · +14,339 → +14,113 · −2,334 → −2,223 · 命名 1/9/34 没动 · rc=0**，**冲突面 141 → 140**（同一棵树前后各算一次；上一条那句手法第二次生效），这 140 个文件的 fork 侧行为行 **16,083 → 15,749**。**本刀真正的收益是一条新账**：`memory_compaction.py` 在 merge-base 与 v2 **都不存在** ⇒ 它是 out-of-book 的 fork 新文件，**P1 门禁的“上游自有文件被改”判据一条都扫不到它**，它带着一个本树不存在的配置字段（`memory_summary`）进了 6 个月、零检查会红。⇒ 这类债的判据见 §9 第 8 条。

> **2026-10-02 簇 V 仓库根第一刀（迁移计划 §8 已闭环 54，分支 `wp/integration`）**：`README.md` / `_zh` / `_ja` / `_ru` 里 fork 重新生成的**嵌套 TOC 退回**（merge-base 与 v2 两侧都是扁平一级列表 ⇒ 纯格式 churn；只对含 `+  - [` 的 hunk 反向 apply，CoPaw banner 与链接行序保留）⇒ 四文件聚合 diff **258/78 → 135/16**，**P1 151 文件 / 行为 150 / 命名 1·9·34 / rc=0 全部不变**，只有行数动：**+14,113−2,223 → +13,990−2,161**；**冲突面仍 140 文件，fork 侧行为行 15,749 → 15,564（−185）**，与册侧 `(14,113+2,223)−(13,990+2,161)=185` 逐字对上。**⇒ 这是"退回字节 ⇒ 减面"判据的弱形式**：簇 L/簇 I 那一型是"宿主行为行归零 ⇒ 文件退出冲突面"（141→140），本刀是"文件留在面上、只把行数退掉"。同批第二笔（`26663e7ef`，19 行发布/开发指令死路径，含 8 行 `src/copaw/__version__.py`）**对册与冲突面零响应**（全部落在 fork 已加行或 fork 自有文件内），但修掉了一条**照做即失败**的发布流程，见 §9 第 10 条。

> **2026-10-03 删除量审计队列头两刀（迁移计划 §8 已闭环 55，分支 `wp/integration`）**：`app/migration.py` 从坏合并 `31b06aecf` 手里恢复两套 legacy-QA helper + `WORKING_DIR` import（册内条目 `156/125 → 160/75`）+ `agents_pipeline_core.py` 删掉一句未绑定的 `node` 引用（现网运行列表现网恒为空）。⇒ **册 151 文件 / 行为 150 / +13,990−2,161 → +13,994−2,077 / 命名 1·9·34 / `--check` rc=0，冲突面 140 文件 / 行为行 15,564 逐字不变**。本刀给本清单添**第三条排序轴**：`migration.py` 上游 1.x→2.x **没碰过**，按本清单三条口径它不进表，尽管册内带着 125 行上游删除 ⇒ **只按"会不会冲突"排序会系统性漏掉"上游没碰的文件上的删除行"**（零冲突压力、纯能力丢失、永远不上榜）。细则见 §9 第 11 条。

> **2026-10-03 恢复类第一刀（迁移计划 §8 已闭环 56，分支 `wp/integration`）：本清单以来第一次"主动涨面"。** `src/qwenpaw/app/runner/runner.py` 此前对 merge-base **逐字节相同**（0/0），本刀为恢复 5 项被 `deca2612a`（2026-05-13 合并取 upstream 侧）丢掉的查询错误韧性，往里放了 1 行 import + 18 行接线 ⇒ **册 151 → 152 文件 · 行为 150 → 151 · +13,994 → +14,013 / −2,077 不变 · 命名 1·9·34 · rc=0**；**冲突面 140 → 141 文件 · fork 侧行为行 15,564 → 15,583（+19）**，与该文件贡献量逐字对上——**"宿主行为行归零 ⇔ 退出冲突面"这条判据的反向用例第一次被实测**（给一个零行为行的上游宿主加行 ⇒ 它进面）。约 250 行的实现本体放在 fork 自有新文件 `app/runner/query_error_resilience.py`（merge-base 不存在 ⇒ out-of-book、三面零响应）。**寿命已定**：v2 删掉整个 `app/runner/` 包（`git diff --numstat e111ec6fb upstream/main -- …/runner/runner.py` = `0 1034`）⇒ 这 19 行是 WP-06 搬家账里的一项，不是在册长债。**另记一条与本清单相关的工具事实**：`--check` 只防"涨"，所以已提交的 `scripts/p1_baseline.json` 会漂——本次重算发现它仍列着 **17 个如今对 merge-base 逐字节相同的文件**（簇 A 的 6 个 locale、`routers/tools.py`、`agent_config_watcher.py`、`hooks/__init__.py`、两个 workflow 等）与 11 个数值偏高的条目。⇒ 本清单所有读数都是用 `--json` **现算**的，从来不读那份账本，因此未受影响；但引用"册 = N 文件"时要说清是现算还是账本。

> **2026-10-03 恢复类第二刀（迁移计划 §8 已闭环 57，分支 `wp/integration`）：判据的第三型 —— 给已在面上的宿主加行 ⇒ 文件数零响应。** 同一宿主 `src/qwenpaw/app/runner/runner.py` 再吃一次恢复：context overflow → 压缩 → 重放一轮（`d6557ea1d` 的能力，随 `deca2612a` 丢，依赖的 `MemoryCompactionHook` 已被上游 #3548 删除 ⇒ 重锚到当前树活着的 `agent.context_manager.pre_reasoning`）。册内条目 `19/0 → 32/3`，**冲突面 141 文件不变 · fork 侧行为行 15,583 → 15,599（+16 = +13 加 +3 删，与册侧逐字对上）**。**⇒ 本清单的"面"这根轴对同一文件的第二次侵入只报行数、不报文件数**，所以"这一刀没让面变大"必须说清是"文件数没变"而非"零成本"。三型判据至此补齐：退字节到 diff 清空 ⇒ 退出面（51/52）；给逐字节相同的宿主加行 ⇒ 新进入面（56）；给已在面上的宿主加行 ⇒ 只涨行为行（57）。**这 16 行的寿命比 56 的 19 行更短**：v2 在模型调用层已经原生实现同一策略（`agents/context/overflow_recovery.py::call_with_overflow_recovery`、`react_agent.py:665/:712/:737`、`context/base.recover_from_context_overflow`，三个符号现树 0 命中），且 fork 版据此新加的"压缩没观测到效果就不发第二次请求""已吐过内容不重放"两条守卫与 v2 的判据一致 ⇒ **WP-06 落点 `DROP`，是恢复队列里第一个"保成果与去债不冲突"的条目**（56 那五项恢复的是 v2 没有的用户可见文案，没有这个性质）。测试侧另结一笔：`query_error_resilience.py` 约 250 行原本**零直接测试**，本刀补 fork 自有 `tests/unit/app/runner/test_query_error_resilience.py` 11 条；runner 目录 `19P/5xf → 31P/4xf`，全仓严格 xfail 9 → 8。

> **2026-10-03 簇 V 第二刀 + 簇 U 收尾（迁移计划 §8 已闭环 58，分支 `wp/integration` @ `2a2f79a8f` + `9f7dbebc7`）：第一次靠"给 fork 内容找到自有归宿"而不是靠退死行，一次让 4 个宿主退出冲突面 —— 141 → 137。** 四个上游文件 `git diff --no-renames e111ec6fb -- <path>` 现为空：`.github/PULL_REQUEST_TEMPLATE.md`（+16 发布类 PR 清单 → 搬进 fork 自有 `RELEASE{,_zh}.md` 新增 §10.1）、`CONTRIBUTING.md` / `CONTRIBUTING_zh.md`（各 +7 的"PR 内容模板与自查" → 搬进 fork 自有 `docs/dual-track-sop.md` 新增 §5.4）、`Makefile`（+5/−1 的 `check-locale-split` 目标 → **判 `DROP` 不搬家**：`scripts/local-gate.sh:26-27` 早已直接跑该守卫，全仓除一行 `scripts/README.md` 文档外零引用、CI 无 `make` 调用 ⇒ 买到 0 收益）。**读数：册 152 → 148 文件 · 行为 151 → 147 · +14,026−2,114 → +13,990−2,113 · 行为 +13,992 → +13,956 / −2,080 → −2,079 · 命名 1·9·34 一字未动 · rc=0；冲突面 137 文件 · fork 侧行为行 15,599 → 15,563（−36 = 16+7+7+6，与册侧逐笔对上）**。**两条要记的判据**：① **`scripts/README.md` 那 1 行（删掉 `make check-locale-split`）只减册、不减面** —— 实测 v2 对该文件一行未改（`git diff --no-renames --name-only e111ec6fb upstream/main -- scripts/README.md` 为空）⇒ 与已闭环 48 那条"在册文件数 ≠ 冲突面"同向，只是这次是行数级。② **`.gitignore` +4 明确不动，并记一条"无落点"**：`test-results/` 与根级 `.vite/` 在 merge-base 与 v2 都没有（v2 只有 `website/.vite/`），而**根级忽略项没有 fork 自有归宿**（`.gitignore` 是唯一机制，子目录的 `.gitignore` 覆盖不到仓库根产物）⇒ 与 `desktop_cmd.py` 那 102 行同族"在册必要、无落点"，**不许为减面删功能**。详见 §9 第 12 条（本刀的规则产出）。**上表历史读数（含第 133 行 `PULL_REQUEST_TEMPLATE.md` +16）自本刀起对该 4 文件作废，引用面/册一律现算。**

> **2026-10-03 小面簇第三刀 + 恢复类第三刀（迁移计划 §8 已闭环 59，分支 `wp/integration` @ `627ec4ae7` + `db626f534` + `f1477022e`）：一批"等价改写"退回 ⇒ 3 个宿主出面；同时挖出本清单第一例界面级静默能力丢失（少一门语言）。** 六文件 `git diff --no-renames e111ec6fb -- <path>` 现读：三个 antd 宿主 `console/src/pages/Control/{Channels/components/ChannelCard,CronJobs/components/columns,Sessions/index}` **各 +1/−1 → 空 diff（出面）**；`console/src/pages/Agent/Skills/components/index.ts` **1/1 → 1/0**；`src/qwenpaw/security/tool_guard/guardians/file_guardian.py` **3/2 → 2/1**；`console/src/components/LanguageSwitcher/index.tsx` **1/3 → 1/2**。**退回的证据不是"看着像格式改动"，是上游自己在用**：`console/package.json` 的 antd 在 merge-base / HEAD / v2 分别是 `^5.29.1` / `^5.29.1` / `5.29.3`（没升级），而 **v2 仍然逐字写 `bodyStyle`** —— `git grep -n bodyStyle upstream/main -- 'console/src/**/*.tsx'` = **9 处 / 6 个文件**，含与 fork **同一位置**的 `ChannelCard.tsx:52` 与 `Sessions/index.tsx:360` ⇒ fork 那三行 `styles={{ body: … }}` 买到 0 收益、只把三个宿主钉在面上。**读 `file_guardian.py` 时才发现的一处真实缺陷**：fork 把上游那行 import 改成 `get_current_workspace_dir, get_current_focus_dir` 之后**又另加一行同样的组合 import** ⇒ 同一符号绑定两次，`flake8` 长期报 `F811 redefinition of unused 'get_current_workspace_dir' from line 16`；本刀改成"上游原行 + 一行加性 import"，该文件 lint **3 条 → 2 条**（⇒ 已闭环 58 ⑥ 那句"F 类全在 fork 自有文件里"要更正：也在个别上游宿主文件里）。**恢复项（判据价值高于那 3 个宿主）**：`LANGUAGE_LIST` 少了 `{ key: "id", label: "Bahasa Indonesia" }`，而 **`console/src/locales/id.json` 仍在打包、`console/src/i18n.ts:26` 仍注册 `id`** ⇒ 界面少一个语言入口、运行时完全支持。归因用 `git log -m -S 'Bahasa Indonesia'`（普通 `-S` 看不见，只有合并提交动过它）：上游 `9bc51ed13 feat(console): add Indonesian language option (#4219)` 是 merge-base 的祖先（= 上游自有能力），`cc58edfd3` 与 `deca2612a` 两次合并的 **`^1`（fork）= 0 / `^2`（上游）= 1 / 结果 = 0** ⇒ 两次都取 fork 侧。**刻意保留的一处偏离**：上游 pt-BR 用 `SparkPtLine`，fork 钉的 `@agentscope-ai/icons` 1.0.63 无该导出（其 lockfile 条目缺 `resolved`/`integrity`）⇒ 退回会直接编译失败，继续用 `SparkEnglish02Line` 别名（v2 自己就把图标全写成 `Languages as SparkXxx`，同型做法）。**本刀的方法学产出**：这类丢失能静默存活，是因为**没有任何门禁把 locale bundle 与切换器条目对齐** ⇒ 已给 fork 自有 `scripts/check_copaw_locale_split.py` 加一条 `key: "<lang>"` 反查（零册成本；脚本在 CI `unit-tests.yml:69` 与 `scripts/local-gate.sh:27` 双处在位）；**反证实跑**：抽掉 `id` 那行 ⇒ rc=1 报 `locale bundle id.json ships but has no entry in the language switcher`，补回 ⇒ rc=0。**⇒ 新增一条纪律：恢复类动作若落在"用户可见但无测试覆盖"的面上，必须同时问"有没有现成门禁能钉住"，能钉则钉，否则下一次同型合并会再吃一遍。** **读数**：册 **148 → 145 文件 · 行为 147 → 144 · +13,990/−2,113 → +13,986/−2,107 · 命名 1·9·34 一字未动 · rc=0**；**冲突面 137 → 134 文件 · fork 侧行为行 15,563 → 15,553**。−10 逐笔 = 三宿主各 −2（出面）= −6，`file_guardian.py` −2，`Skills/components/index.ts` −1，`LanguageSwitcher` −1 ⇒ **与册侧逐字对上**；**面文件数 −3 与行为行 −10 不同速，是第 ① 型与第 ③ 型混用的预期结果，引用时必须分开说**。**§6/§7 表里这 6 行（`ChannelCard` 第 109 行、`CronJobs/components/columns` 第 73 行、`Sessions/index` 第 89 行、`Skills/components/index.ts` 第 135 行、`file_guardian.py` 第 136 行、`LanguageSwitcher/index.tsx` 第 128 行）自本刀起作废，引用面/册一律现算。** **没跑的**：任何前端命令与 tsc（本 worktree 无 `console/node_modules` ⇒ antd prop 与语言列表两处只有"退回上游自己写的字节"这条静态证据，运行时未验）；py3.12 交叉核对；含 channels 全量；GitHub CI 实跑。后端侧实测零漂移：固定口径 **647P/4skip/8xf**（与 57/58 同读数）、含 security 扩口径 **1,126P/4skip/8xf/0F**、全量不含 channels **2,119P/0F/4skip/8xf**（与 57 基准逐字相同）、`check_namespace_boundaries.py` PASSED（三项 delta 全 0）、`copaw_brand.py verify` 9 文件 / 34 行。

> **2026-10-03 簇 V 第三刀 + D-22 #29 结案（迁移计划 §8 已闭环 60，分支 `wp/integration` @ `f22346f76` + `ba8402272`）：banner 只保首页 ⇒ 134 → 131 文件 / 行为行 −144，"宿主同时出面"这一类里本清单最大的一笔。** 四篇 README 的 fork diff **整段就是那块 CoPaw banner**（`-U0` 逐 hunk 核过，无夹带内容 ⇒ 退回零损失），裁为：`README_zh/_ja/_ru.md` 逐字节退回 merge-base（**3 宿主出面**），`README.md` 只留一个 **+7/−0 的纯加行块**（图标 + 一行能力摘要 + 一行指向新建的 fork 自有 `docs/copaw-overview.md`），banner 完整内容（能力清单 / 社区二维码 / 上游指认）搬进 overview。**读数对账**：面 **134 → 131 文件 · 15,553 → 15,409 行为行**；−144 = 三宿主 40+38+40 = **−118** + `README.md` 33→7 = **−26**，与册侧 **145 → 142 文件 · 行为 144 → 141 · +13,986/−2,107 → +13,858/−2,091（行为加行 −128 / 删行 −16）**逐字对上；命名 **1·9·34 一字未动** · mechanical 1 · `--check` rc=0。**本刀的定价判据（比减量本身更值钱）**：**在册行数不是冲突成本，必须乘"上游对该文件的重写密度"** —— 这四篇上游 1.x→2.x 自己改了 +177/−141、+192/−223、+230/−209、+203/−182（近乎逐行重写），且**上游新增的两个 badge 与 trendshift 图正落在 banner 挤占的同一段头部**（`README.md` 上游 hunk `@@ -15,6 +15,9 @@`）⇒ 保留 banner 的真实代价是"每次同步在重写过的头部里手工重贴 4 次"，不是表上那 151 行。**同批更正两条**：① **面读数的复现式** —— `check_p1_invariants.py --json` 的 `files` ∩〔在 `e111ec6fb` 树里 ∧ 出现在 `git diff --no-renames --name-only e111ec6fb upstream/main` ∧ 行为行>0 ∧ 非 mechanical ∧ 不以 `src/copaw/` 开头〕在本树**精确给出 131 / 15,409**；**裸 numstat 交集给 136**，多的 5 个 = `console/package-lock.json`（即 `mechanical: 1`）+ 4 个 `src/copaw/` D-16 别名壳 ⇒ 引用"面 N 文件"前必须先过这两道排除。② **"Knowledge dock 六个标签"住在 `console/src/pages/Agent/Projects/ProjectDetailPage.tsx:741`（`KnowledgeDockTabKey`），不在 `pages/Agent/Knowledge/`** ⇒ 按目录名 grep 会把一条 live 能力误判成失效宣传（搬家前核时效时实测踩到）。**V 仓库根至此 7 宿主 → 4**（`README.md` 7/0、`pyproject.toml` 10/1、`.gitignore` 4、`deploy/Dockerfile` 1）。**上表 4 行（第 463 / 467 / 472 行那三篇 + `README.md` 那行）连同 §4 表第 309 / 311 / 315 / 323 行自本刀起作废**（三篇已离开冲突面，`README.md` 现为 +7/−0），引用面/册一律现算。**没跑的**：GitHub 侧渲染完全未验证（首页 banner 的 `<br>` 排版、overview 里 `../console/public/*` 两个相对图链与三篇语言 README 的相对链接）—— 本 worktree 无前端环境，且渲染正确性没有静态判据；py3.12 交叉核对；含 channels 全量；GitHub CI 实跑。后端侧固定口径 **647P/4skip/8xf**（与 57/58/59 逐字同读数 ⇒ docs-only 零漂移）、locale 守卫 rc=0、namespace PASSED、`copaw_brand verify` 9/34。

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
| ~~63~~ | ~~`src/qwenpaw/app/agent_config_watcher.py`~~ | L | ~~+221/−110~~ → **0/0**（已闭环 52 退回字节并退出冲突面） | ~~+51/−24~~ | 35 | 是 | 0 |
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

- **D-22 品牌边界计划**（`docs/superpowers/plans/2026-10-01-d22-brand-boundary.md`，**已写、阶段 A 已实施在 `wp/12-brand-stage-a`**）只做 126 行改名还原 + 4 个文件离开冲突表，**不是去债主线**。它的价值是消掉"每次同步都要手工重放的机械税"，并顺手把 `_app.py` 里被硬编码破坏的上游品牌变量 `{PROJECT_NAME}` 还原。**执行更正：阶段 A 实际退回 88 行 ⇒ 命名册降到 34 行（真实改名 122 而非 126 —— 4 行是"同文移动"假阳性），P1 169 文件 / 行为 168；"126 行全清 + 4 文件离场"是阶段 A+B 的合并目标，不是 A 的读数。**
- **WP-03/WP-04**（PawApp 化）承接簇 I / C / D / J / K：D-16 已把约 11,000 行实现下沉进 `src/qwenpaw`，所以这些簇现在是"从核心包里往外抽"，比从 `src/copaw` 抽更贵，排期时要把这笔算进去。
- **WP-06**（升级到 v2，前置条件：Python 下限抬到 3.11）开始前，第 4 节的 18 个文件必须全部有落点，否则同步当天就会静默丢功能。
- **需要回写 `UPSTREAM_V2_MIGRATION_PLAN.md` §2 的一处判据**：那张表的 P2 行写着"上游删了 `app/mcp/{stateful_client,watcher}.py`、`app/runner/*` 7 个文件、`app/routers/plan.py`，等于上游替我们做了裁决，无需决策"。§4 的逐文件复核推翻了"无需决策"：**上游删掉宿主文件不等于上游删掉需求** —— `tail-user/delete`（v2 全树消息级删除符号命中 0）、`ChatUpdate.meta`（v2 `ChatUpdate` 只有 `name` 且 `extra="forbid"`，而 fork 侧 6 处生产调用在写它）、session 的 `.snapshot` sidecar 这几条需求仍活在 fork 自有的 `AnywhereChat` / `Projects` 界面上，只是失去了后端载体；反过来 `AgentTable` / `Workspace` / plan 前端 / 历史分页那几类跟着走 `CUT` 或 `DROP` 才是对齐。这两类必须分开写，不能再合并成"自动作废"。
- **簇 A（6 个 locale 文件）是投入产出比最高的一刀**：302 行私有文案搬进 fork 已有的 `console/src/locales/copaw/*`，一次消掉 6 个冲突文件，零功能损失；唯一前置是 v2 的插件翻译注册接缝（`i18n.ts` 全仓无 `addResource`）是否存在 —— 未验证。 → **✅ 已执行（2026-10-02，WP-13，`wp/13-locale-exit` @ `ee400b053`），且这一刀确实兑现了预判：−6 冲突宿主 / −377 侵入行，是本清单里最大单笔削减。** 那个"唯一前置"的答案是**两半**：插件侧注册接缝**不存在**（拿不到 i18n 句柄），但 fork 自有 `console/src` 代码里 overlay-only 的 `addResourceBundle` **可用**，所以落点形态从"等上游接缝"改成"fork 自有 `locales/copaw/register.ts` + `i18n.ts` 留 16 行调用"。零功能损失也实测到了：6 语言叶子级深度合并逐 key 相等 + 19 条 fork 自有测试 + tsc/vitest 与基线同集合。
- **簇 J / K 搬迁项的落点机制**：`src/copaw` 在 D-16 之后只剩别名壳，fork 自有后端实现的合法落点是 `PluginApi.register_http_router(router, *, prefix, tags)`（**v2 `plugins/api.py:590` / fork 当前树 `plugins/api.py:191`，两棵树行号不同，引用时别混用**；实现体 `plugins/registry.py:141`，路由挂在 `/api` + prefix，`prefix` 非法或被占用直接 raise）与 PawApp（WP-03/04）。这条接缝**已在产运行**：`plugins/bundle/qwenpaw-pet/plugin.py:73` 用 `router.py` 挂 `/qwenpaw-pet`，父 app 由 `set_plugin_http_app` 注入（fork `app/_app.py:355`、v2 `app/_app.py:491`）。前端落点是 fork 自有组件目录（`components/AnywhereChat` 已是先例）+ v2 的 slot 接缝。

## 9 本清单里的未验证项

1. ~~v2 是否有插件侧注册翻译资源的接缝（决定簇 A 的落点形态）~~ → **已答，且簇 A 已按答案执行完（2026-10-02，WP-13）**：插件侧接缝**不存在**（`window.QwenPaw` 无 i18n 句柄、插件前端走 Blob URL 动态 import，计划 §8 已闭环 39 ⑧），但 fork 自有 `console/src` 代码里 `addResourceBundle(lng,"translation",overlay,true,true)` **可用且已用于簇 A**。残留的那 16 行 `i18n.ts` 调用不是设计未知，而是上游缺句柄 —— 要消掉只能等上游给插件暴露 i18n（D-13 禁止把"能力请求"当 bug 提）。
2. ~~v2 的 MCP 实现在哪个路径（决定簇 K 的 1,330 行往哪搬）~~ → **已解决**：`drivers/handlers/{mcp,mcp_stateful_client,mcp_streamable_http}.py` + `drivers/manager.py` + `app/driver_config_watcher.py` + `app/mcp/{config_service,schemas}.py`，详见 §3 簇 K 与 §8 已闭环 33。剩下的不是"落点在哪"，而是 §4.2 那 6 项私有符号各自的 `原生` / `CUT` 判定。
3. `route.replace(pluginId, "core.root", …)` 的作用域能否只覆盖 CoPaw 自有页面而不触及上游路由（决定簇 D 与 D-12 默认落地界面）。
4. v2 文档站 `website/` 的页面注册方式（决定簇 S）。
5. 簇 B 的宿主改动（+54 行）在 v2 的两个接缝面（`plugins/api.py` 的 17 个 `register_*` 与 `pawapp/app.py`）上各自的等价落点。
6. ~~**§4.5 那 6 项**（v2 的 stdio 可执行文件解析、mineru 依赖是否在用、v2 regenerate 的覆盖面、`AnywhereChat` 的后端端点依赖全表、v2 `/plan` 的落库状态、`register_http_router` 最小插件端点能否被装载）~~ —— **2026-10-01 全部复核完毕，结论见 §4.5**；随之暴露的 4 个开放项也已一次裁完，记为 **D-23（§4.7）**。簇 J / K 的 2,825 行最终账目：**3 条 `搬迁` + 2 条 `原生` + 4 条 `CUT` + 1 项净删除（runtime-status 整套）**，其余 `DROP`。剩下的唯一前置是下一条那条 hunk 级净行数账目。
7. ~~**§4.6 那 5 条线 + 1 项净删除的 hunk 级账目**~~ —— **2026-10-01 做完，结论在 §4.8**：`搬迁` 394 + `原生` 300 = **694 行是 WP-06 的净写作量**，其余 1,478 行是"同步时不再重放"的零成本项。这轮账目另外翻出三件按文件总量估不出来的事：tail-user 那条真实尺寸是 192+134 而不是 164、`_run_lifecycle:379-398` 那 20 行属于 stdio 需求而非生命周期重写、以及 **fork 在 `_build_client` 里摘掉了上游的 OAuth token 注入且方法至今零调用者**（新开的现网复核项，见 §4.8 第 3 条）—— **该复核项 2026-10-02 结案：回归确认存在，已在 `fix/mcp-oauth-injection`（提交 `0ea653fef`）修复并补测，记录在 §4.8 末尾的结案块**。

8. **（2026-10-02 已闭环 52 新开，53 执行完毕）“复活上游已删文件”扫描 —— 已测完，命中率 3/145，但挖出本清单以外最大的一笔债。** 判据 = 对 fork 新增、merge-base 与 v2 均无同名文件的 `src/` 文件逐个跑 `git log --oneline -1 e111ec6fb -- <path>`；**merge-base 历史里存在过同名路径 ⇒ 复活嫌疑**，再查它依赖的调用契约（字段名 / 方法名 / 导入者）在当前树是否还存在。实测规模：**145 个 fork 新增 `src/` 文件 → 22 个候选**，其中 **19 个是 `src/copaw/*` 的 D-16 别名壳层**（#3285 改名时上游删掉的老命名空间，fork 有意保留，非 bug；判据要排除 `src/copaw/`，否则命中率被它稀释到 12%），**真候选 3 个**：~~`agents/hooks/memory_compaction.py` 191 行~~（**已闭环 52 删除**）、~~`agents/tools/memory_search.py` 42 行~~（**已闭环 53 删除**：`create_memory_search_tool` 全仓零消费者、`tools/__init__.py` 对 merge-base diff 为空、`src/` 无 `pkgutil`/`iter_modules` 动态注册，且两处都是同一笔 `742cf22b4 fix runtime compatibility after upstream merge` 复活的上游 #3548 删除件）、`app/routers/agent.py` 1,024 行 + `agents/skills_manager.py` 3,684 行（**判定为“WP-06 采纳债”而非复活 bug**，见本条末尾）。⇒ **这条判据值得脚本化**：它抓到的是门禁与冲突面**两张表都扫不到**的债（已闭环 53 那一刀 42 行真删除，册 151/行为 150/冲突面 140/行为行 15,749 **一个数字都没动**，就是活证据）。
9. **（2026-10-02 已闭环 53 新开，两笔未偿的大账）扫描顺带挖出的两处：**
   - **fork 现树同时跑两套 skill 子系统，旧轨 3,684 行。** 上游 `ec4e7d879`(#4235) 删 `agents/skills_manager.py` 换成 `agents/skill_system/`；fork 在 `c7be8dca0 Merge remote-tracking branch upstream/main` 里把旧文件留回来了，且**新轨也只是旧快照**（`skill_system` 对 v2 **−2,327/+320**，还缺 v2 的 `runtime_cache.py`；旧轨比上游最后一版多 44 行）。旧轨有四个活消费者（`app/routers/agents.py:42/:60/:1481`、`knowledge/module_skills.py:6`、`agents/tools/skill_market_install.py:13`、`src/copaw/agents/skills_manager.py` 壳）⇒ **不能删，只能并轨**：WP-06 的账 = 删旧轨 + 四消费者迁到 v2 `skill_system`（v2 `agents.py:58` 已经是 `from ...agents.skill_system import SkillPoolService, get_workspace_skills_dir`，fork 还从旧文件 import 同名符号）+ `skill_system` 整目录升到 v2 字节。**这两套都是 out-of-book，冲突面 140 里一个都不算。**
   - **`console/src/api/types/agent.ts` 里有 6 行死契约（在册文件）。** `MemorySummaryConfig`（`:27-33` 五个字段）+ `:156` 的 `memory_summary` 是 **fork 新增**（merge-base 无此接口），镜像的后端字段 `running.memory_summary.*` 在 `src/qwenpaw` **0 命中** —— 正是已闭环 52 删掉的那个 hook 所读的字段在前端的影子。**修法与 52 的前端配套要一起做**（fork 自有 `pipelineModelBudget.test.ts:76/:170` 两处 fixture 也引用它），单独动 `agent.ts` 要跑 vitest，而 `console/node_modules` 是跨 worktree 共享符号链接 ⇒ 归到“P 行剩下的 `security/*` + 前端那一档”。**（2026-10-03 已闭环 57 补一条排除项）** 曾疑 `tests/unit/agents/memory/test_reme_light_memory_manager.py` 里的 `cfg.running.memory_summary` 是这 6 行的活消费者 ⇒ 实测该文件对 merge-base **零 diff**，是上游自己拿 `MagicMock` 写的空转断言（按 D-17 不动），**那 6 行仍是死契约**，不要因这条线索误开刀。
   - **另：`app/routers/agent.py` 是落在上游已删路径上的 D-16 sink**（上游 `45afb7c89`(#4107) 删了它，fork 版比上游最后一版多 520 行，最近两笔提交是 WP-01 的 `9d9710be7`/`19d79735c`）⇒ 不是 bug，但 WP-06 合并时要**先确认 v2 不会重新占用该路径**，否则再现一次 delete/modify 冲突。
10. **（2026-10-02 已闭环 54 新开）簇 V 仓库根第一刀做完，顺带把"文档侧的 #3285 遗留"与三笔新账钉进队列。** 动作 = 四篇 README 的嵌套 TOC 退回（`535cd4125`）+ 19 行发布/开发指令死路径修复（`26663e7ef`）。**新读数：册 151 文件 / 行为 150 / +13,990−2,161 / 命名 1·9·34 / `--check` rc=0；冲突面 140 文件 / fork 侧行为行 15,564**（−185，与册的 `(14,113+2,223)−(13,990+2,161)=185` 逐字对上）。**这是"退回字节 ⇒ 减面"的弱形式**：文件仍在冲突面上、只减行数 ⇒ 引用"面变小"当证据时要能区分 51/52 那种"文件退出冲突面"的强形式。新开的三笔账：
    - **恢复类最大一笔（不是扫描类）：`tests/unit/app/runner/` 的 9 条 `xfail(strict=True, reason="P1-BEHAVIOR-LOST: …")`** —— `test_runner.py` 7 + `test_knowledge_context_injection.py` 2，reason 全文自证根因是"补丁写在 rebrand 前的 `src/copaw/app/runner/runner.py`，随 `bcaeb9062`(#3285) 丢失，`src/qwenpaw/app/runner/runner.py` 无对应实现"。**实测两侧 503 命中 0、`src/copaw/app/runner/` 目录不存在** ⇒ 丢失的是七项用户可见能力（transient 503 重试与友好消息、remote protocol error 友好消息、可中断 stream 取消、MCP 连接错误抑制、`stream_query` 取消收尾、context overflow → compaction 重试、overflow 友好消息）。这 9 条含在基准"13 xfailed"里，**与"在册豁免已归零"不矛盾**（两个口径），但它是"保留成果"目标下已定性、未偿还的最大一笔。**它是改上游自有文件 `app/runner/runner.py` 的活（在册），归"WP-06 之后的第一刀"，与删除量审计队列里的 `app/runner/session.py` 176 行同宿。**
    - **死构建步骤（已判"非现网回归"，但要改得连文档一起改）：`scripts/source_one_click_start.sh:7/:443`** 把前端产物拷进 `src/copaw/console`，而静态目录**唯一**解析点 `src/qwenpaw/app/_app.py:604-633` 只看 env → `src/qwenpaw/console` → `<repo>/console/dist` → `<cwd>/{console/dist,console_dist}` ⇒ 该 copy 在源码态永不被读取（前端能显示靠 repo 侧 fallback），且脚本还对死目录执行 `rm -rf "$CONSOLE_DEST"/*`。上游自己的 `scripts/wheel_build.sh:25` 拷到 `src/qwenpaw/console/`。**`scripts/README.md:27` 那句"copies assets to `src/copaw/console`"当前与脚本逐字一致 ⇒ 必须同轮改**；本刀不改是因为验证要跑 `npm run build`，而 `console/node_modules` 是跨 worktree 共享符号链接。
    - **上游自有文案债第 4 例（按 D-17 同源纪律不动，只记不办）：`tests/unit/channels/README.md:82` 与 `README_zh.md:81` 的 `--cov=src/copaw/app/channels`** —— 实测 merge-base / v2 / 现树**三处逐字相同**，即 v2 今天仍在发同一行过期命令。与已闭环 53 的 ⑦（`QA_source_index-{en,zh}/SKILL.md:31` 指向两个上游自删路径）同族。**四例累计 ⇒ "上游自己的死链"已是一条稳定类别，值得在 WP-06 之后打包成一条上游 PR（属"明确的 bug"那类，D-13 允许）。**

11. **（2026-10-03 已闭环 55 新开）本清单只有"冲突"这一根排序轴，而债不止这一种：删除量必须按册内 `behavior_removed` 单独排序。** 触发实例 = `src/qwenpaw/app/migration.py`：`git diff --no-renames --name-only e111ec6fb upstream/main` **不含该文件**（v2 有它、但 1.x→2.x 一行未改）⇒ 它不满足本清单第 3 条口径、从来不在 140 里，可它在册内带着 **125 行上游删除**，其中 50 行是两套真实功能（legacy QA agent disable + fallback）加一个 `WORKING_DIR` import。后果不是"同步会冲突"而是"**每次启动静默失败**"：六处 `WORKING_DIR` 引用抛 `NameError`，被 `src/qwenpaw/app/_app.py:266-268` 三个 `try/except Exception: logger.error` 全包，CI 无 flake8 job ⇒ 六个月零信号。**⇒ 队列纪律**：去债有三个独立靶子 —— ① 冲突面（本清单 140 文件），② 册内删除量（`behavior_removed` 降序，与上游是否碰过无关），③ out-of-book 的 fork 自有文件（本清单与门禁都零响应）。三者不可互相代替。
    - **③ 那一栏本刀又添一型：缩进错导致"写好了但从未被收集"的测试。** `tests/unit/app/routers/test_agents_pipeline_core.py` 的 `test_build_run_observability_aggregates_rpa_metrics` 整段缩进在另一个 test 函数体内（4 空格），pytest **永不收集**；且它调用的 `_build_run_observability` 不在该文件 import 块里，真跑会 `NameError`。提到模块级 + 补 import 后**实测通过** ⇒ 被测的 RPA observability 聚合行为一直是对的，丢的只是验证。**判据**：`pytest --collect-only -q` 数一下某文件的收集条数，与 `grep -c "^def test_"` 对比；两者不等 ⇒ 有测试被缩进装饰器或条件 skip 吞掉。fork 自有测试文件不在门禁的"上游自有文件被改"判据里 ⇒ 这类零检查会红。
    - **同一刀顺手结掉的队列项**：`session.py` 的 176 行删除已审完、**判不动刀**（fork 版 `migrate_legacy_weixin_session_files` 与本树的 `sessions/<channel>/<file>` 布局自洽，读取路径 `session.py:305-328` 会从扁平旧路径兜一次，全树无人 glob sessions 目录 ⇒ 残留是惰性垃圾；但 **v2 删掉整个文件 ⇒ 记在 §4 搬家窗口**）。剩 `app/mcp/stateful_client.py` 396（v2 删整文件）与 `app/routers/agents.py` 326（需 WP-03/04 设计）。

12. **（2026-10-03 已闭环 58 新开）"无原生接缝 ⇒ 承认并保留"是一个**上游一侧**的判据，不足以让一行留在上游文件里；还必须举出已查过的 fork 自有归宿。** 触发实例 = 迁移计划已闭环 43 ① 把 `.github/{PULL_REQUEST_TEMPLATE.md,…}`、`Makefile`、`CONTRIBUTING{,_zh}.md` 等整组记为"在册行为档（无原生接缝，承认并保留）"：当时只证明了"上游没有注册接缝"，没有证明"fork 自有区域放不下"。而实测这三处都有归宿 —— 发布 PR 清单在 fork 自有的 `RELEASE{,_zh}.md` 与 `.github/ISSUE_TEMPLATE/6-release_checklist.md`（每一格已有逐项版本）、PR 自查规则在 fork 自有的 `docs/dual-track-sop.md`、`make check-locale-split` 的收益为 0（`scripts/local-gate.sh:26-27` 早已直接跑守卫）⇒ 本轮 4 个宿主退面、**零内容损失**。**判据落地**：写"无落点"之前要逐个点名查过的 fork 自有候选文件（本轮反例是"有同类文档却没去看"）；反过来，**确实没有归宿**的那一类要显式记账（`.gitignore` 的根级忽略项、`desktop_cmd.py` 的 102 行打包后端钉子）—— 这两类合起来才是"在册必要"的完整定义，否则"承认并保留"会退化成一个不用复核的默认档位。同批还判掉一个假候选刀：**lint 不是一刀，是一个不存在的门禁**（`flake8 --statistics src tests/unit` 存量 E501 5,198 / W191 4,318，CI 无 flake8 job，`.flake8` 的 79 列与现状差三个数量级）⇒ 任何"清 lint"排期都不该占队列位。**【已闭环 59 更正本条末句的一处外延】** 58 ⑥ 那句"F 类只有 F841 9 条 / F811 5 条，全在 fork 自有测试或 fork 自有模块内"不准确：`src/qwenpaw/security/tool_guard/guardians/file_guardian.py`（**上游宿主、在册在面**）长期挂着一条 `F811 redefinition of unused 'get_current_workspace_dir' from line 16`，由 fork 自己的重复 import 造成，已随 59 真实消除 ⇒ **F 类也会落在上游宿主文件里**，"lint 不是债轴"这个结论不变（仍然没有任何检查会因它红），但"所以可以不看"是错的：这一条 F811 恰好是那个 3/2 hunk 值得退回的实证。

13. **（2026-10-03 已闭环 59 新开）本清单第三类盲区：**界面可见能力**与**其数据/资源 bundle** 之间没有任何等价断言 ⇒ 合并取侧造成的"少一个入口"这类丢失既不进册、也不进面（行数级），只有人肉点开下拉才会发现。** 触发实例 = `console/src/components/LanguageSwitcher/index.tsx` 的 `LANGUAGE_LIST` 少了 `{ key: "id" }`，而 `console/src/locales/id.json` 仍在打包、`console/src/i18n.ts:26` 仍注册 `id`（⇒ 用户界面上少一门语言、运行时完全支持）。取证要点：普通 `git log -S 'Bahasa Indonesia'` **看不见**这次丢失，只有 `git log -m -S` 才列出动过它的合并提交，再逐 ref 数出现次数（`^1`=0 / `^2`=1 / 结果=0）才证明 `cc58edfd3` 与 `deca2612a` 两次都取了 fork 侧。**已上的守卫**：fork 自有 `scripts/check_copaw_locale_split.py` 增一条"每个 locale 必须在 `LANGUAGE_LIST` 里有 `key: "<lang>"`"反查，反证实跑（抽掉 `id` ⇒ rc=1 并报明确消息）；脚本在 CI `unit-tests.yml:69` 与 `scripts/local-gate.sh:27` 双处在位 ⇒ 零册成本。**判据落地**：**恢复类动作只要落在"用户可见但无测试覆盖"的面上，必须同时问"有没有现成门禁能把它钉住"，能钉则钉** —— 否则下一次同型合并会再吃一遍，而且仍然没有信号。**可外推的同族面**（本轮没做、值得按同一形状扫）：路由/菜单注册表 vs `console/src/pages/**` 实际存在的页面、设置项 schema vs 设置页渲染的控件、`i18n.ts` 的 loader 清单 vs `locales/` 目录 —— 共同点是"两处清单必须一一对应，而其中一侧由上游拥有、另一侧由 fork 拥有"，正是合并最容易出现单侧删除的形状。**另记一条口径**：本刀的 −10 行为行里，3 个 antd 宿主是**第 ① 型**（diff 退到空 ⇒ 出面），另 3 个是**第 ③ 型**（已在面上 ⇒ 只减行）⇒ **面文件数与面行为行不同速是混用两型的预期结果**，引用"面降了 3"与"行降了 10"时必须分别说明。
