# 与 upstream 同步的冲突面清单（152 个文件）

> **这份文件的用途**：记录"下一次把仓库对齐到 upstream 2.x 时必然会产生合并冲突的文件"，并按搬迁成本分簇排序。它是**输入清单**，不是执行计划；每个簇的实施计划单独写。
> 判据来自两条总目标：① 最终要与最新 upstream 对齐，并能在保持同步的前提下长出 CoPaw 工作界面；② 短期是"去债 + 保成果"—— 去债 = 缩小与 upstream 的冲突与差异，保成果 = 把对 upstream 的有益修改转移到 CoPaw 自有区域，**而不是直接丢弃**。

**生成时间**：2026-10-01。数据来源：分支 `wp/02-ownership` HEAD `462a1cf0f`，merge-base `e111ec6fb`，upstream 基线 `upstream/main`（= 2.x）。

## 1 口径

一个文件进这张表，必须同时满足三条：

1. **上游自有**：该文件在 merge-base `e111ec6fb` 里存在（fork 新建的文件不算，它们不会冲突）；
2. **fork 侧有逻辑改动**：按 `scripts/check_p1_invariants.py` 的行为/命名分册规则，去掉纯改名后仍有改动行（`behavior_added + behavior_removed > 0`）；
3. **上游侧也改过**：`git diff e111ec6fb upstream/main -- <path>` 非空。

排除项：`console/package-lock.json`（机械差异，单独处理）。

复现命令（在 worktree 根目录）：

```bash
# 主仓的 venv 解释器（worktree 没有自己的 venv），路径按本机情况替换
PY=<主仓 CoPaw>/.venv/bin/python
CI=true PYTHONPATH=src $PY scripts/check_p1_invariants.py --json > /tmp/p1.json
git diff --name-only e111ec6fb upstream/main > /tmp/upstream_changed.txt
```

把 `/tmp/p1.json` 里 `behavior_added + behavior_removed > 0` 的路径与 `/tmp/upstream_changed.txt` 取交集，即下表 152 行。

## 2 总量读数

| 项 | 数值 | 含义 |
|---|---|---|
| fork 侧有逻辑改动的上游文件 | 168 | 全仓 P1-行为口径（不含 lockfile） |
| 其中上游在 1.x→2.x 也改过 | **152** | **下次同步必然冲突** |
| 只被 fork 改、上游没碰 | 16 | 可以原样带走，不产生冲突 |
| 上游已在 2.x 删除 | **15** | **搬家窗口：不同步就把功能弄丢了** |
| 这 152 个文件上 fork 的改动行数 | 16,566 | 与全仓 P1-行为 17,633（+15,049/−2,584）同一口径下的子集 |
| 上游在这 152 个文件上的改动行数 | 74,706 | 冲突的另一侧体量 |
| 纯改名行数（D-22 品牌税） | 126 行 / 22 文件，其中 4 个文件 | 占侵入量的 **0.8%**，见 `docs/copaw-brand-boundary.md` |

按 fork 侧改动量分桶：**≤10 行 49 个**（多数可机械搬或还原）、**11–60 行 56 个**（逐条判归属）、**>60 行 47 个**（需要设计，见第 5 节）。

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
| J src/qwenpaw/app/runner（会话与消息处理） | 3 | 623 | 668 | 3 |
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

**J — src/qwenpaw/app/runner（会话与消息处理）**。`runner/api.py`、`command_dispatch.py`、`models.py` **三个文件在 v2 里全部不存在**（上游删了 768 行）。fork 在此的 623 行改动必须在同步前搬到 fork 自有模块，否则同步当天功能消失。v2 的对应实现是 `src/qwenpaw/agents/command_handler.py`。

**K — src/qwenpaw/app/mcp（MCP 客户端）**。`app/mcp/{manager,stateful_client,watcher}.py` **三个文件在 v2 里全部不存在**（上游删了 1,282 行），而 fork 在 `stateful_client.py` 里有 +690/−396。与 J 同一性质：搬家窗口正在关闭。v2 的 MCP 实现落点要先查清（未验证）。

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

## 4 搬家窗口：上游在 2.x 已删除的 15 个文件

这一组最紧急。fork 的改动落在上游已经决定不存在的文件上，**一旦同步到 2.x，这些改动连同它们实现的功能会一起消失**，而且不是靠合并冲突能发现的（没有文件可冲突）。

| 文件 | fork 改动 | 上游在 2.x 的动作 | 备注 |
|---|---|---|---|
| `src/qwenpaw/app/mcp/stateful_client.py` | +690/−396 | −665（文件删除） | v2 的 MCP 实现落点未查 |
| `src/qwenpaw/app/runner/api.py` | +457/−34 | −233（文件删除） | v2 对应实现是 `agents/command_handler.py` |
| `src/qwenpaw/app/mcp/manager.py` | +194/−16 | −286（文件删除） | 与 stateful_client 同批 |
| `console/src/pages/Settings/Agents/components/AgentTable.tsx` | +100/−60 | −248（文件删除） |  |
| `src/qwenpaw/app/runner/models.py` | +108/−0 | −103（文件删除） | 同上 |
| `console/src/pages/Agent/Workspace/components/useAgentsData.ts` | +58/−24 | −296（文件删除） |  |
| `src/qwenpaw/app/mcp/watcher.py` | +26/−8 | −331（文件删除） | 与 stateful_client 同批 |
| `src/qwenpaw/app/runner/command_dispatch.py` | +7/−17 | −332（文件删除） | 同上 |
| `console/src/api/modules/plan.ts` | +16/−7 | −115（文件删除） |  |
| `console/src/components/PlanPanel/index.tsx` | +13/−5 | −216（文件删除） |  |
| `console/src/pages/Agent/Workspace/components/FileListPanel.tsx` | +8/−6 | −126（文件删除） |  |
| `console/src/pages/Agent/Workspace/index.tsx` | +12/−0 | −208（文件删除） |  |
| `console/src/pages/Agent/Workspace/index.module.less` | +9/−2 | −655（文件删除） |  |
| `console/src/pages/Chat/components/ChatSessionDrawer/index.tsx` | +5/−5 | −613（文件删除） |  |
| `src/qwenpaw/app/routers/plan.py` | +2/−0 | −176（文件删除） | fork 在此只加 2 行，但整条 plan 路由的上游载体没了 |

这 15 个文件的 fork 改动合计 **2,285 行**（上游侧删除 4,603 行）。重头三处正好是三整个簇：**`app/mcp` 簇 3 个文件 1,330 行（1,086 / 210 / 34）全部落在已删除文件上**、**`app/runner` 簇 3 个文件 623 行（491 / 24 / 108）全部落在已删除文件上**、`console/src/pages/Agent/Workspace` 4 个文件 119 行（+87/−32）全部被上游删除。

## 5 >60 行的 47 个文件（需要设计，不能机械搬）

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

## 6 ≤10 行的 49 个文件（便宜项，优先做）

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

## 7 全量 152 行

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

## 8 与其它计划的关系

- **D-22 品牌边界计划**（`docs/superpowers/plans/2026-10-01-d22-brand-boundary.md`，待写）只做 126 行改名还原 + 4 个文件离开冲突表，**不是去债主线**。它的价值是消掉"每次同步都要手工重放的机械税"，并顺手把 `_app.py` 里被硬编码破坏的上游品牌变量 `{PROJECT_NAME}` 还原。
- **WP-03/WP-04**（PawApp 化）承接簇 I / C / D / J / K：D-16 已把约 11,000 行实现下沉进 `src/qwenpaw`，所以这些簇现在是"从核心包里往外抽"，比从 `src/copaw` 抽更贵，排期时要把这笔算进去。
- **WP-06**（升级到 v2，前置条件：Python 下限抬到 3.11）开始前，第 4 节的 15 个文件必须全部有落点，否则同步当天就会静默丢功能。
- **簇 A（6 个 locale 文件）是投入产出比最高的一刀**：302 行私有文案搬进 fork 已有的 `console/src/locales/copaw/*`，一次消掉 6 个冲突文件，零功能损失；唯一前置是 v2 的插件翻译注册接缝（`i18n.ts` 全仓无 `addResource`）是否存在 —— 未验证。

## 9 本清单里的未验证项

1. v2 是否有插件侧注册翻译资源的接缝（决定簇 A 的落点形态）。
2. v2 的 MCP 实现在哪个路径（决定簇 K 的 1,330 行往哪搬）。
3. `route.replace(pluginId, "core.root", …)` 的作用域能否只覆盖 CoPaw 自有页面而不触及上游路由（决定簇 D 与 D-12 默认落地界面）。
4. v2 文档站 `website/` 的页面注册方式（决定簇 S）。
5. 簇 B 的宿主改动（+54 行）在 v2 的两个接缝面（`plugins/api.py` 的 17 个 `register_*` 与 `pawapp/app.py`）上各自的等价落点。
