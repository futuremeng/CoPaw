# 追上游实施跑道（2026-10-08 刷新）

**目的**：把"合并 upstream 最新进展"这条路的最短走法量化到可以直接开工的粒度。
本文全部为 2026-10-08 现算，不是引用 2026-10-07 那张表的读数（对照处会写明旧值）。

**方法（只读）**：`git fetch upstream` → `git merge-tree --write-tree HEAD upstream/main`。
`merge-tree` 只向对象库写一棵树，不碰工作区、不产生提交、不动分支、不推送，因此随时可重算、
重算前不需要清理现场。本次产出树 = `8374294c6`。

**取数基线**：本文所有读数取于 `HEAD = 1b946c05d`（刀 86 的三笔之后）。落本文这笔 docs 提交
本身会把"领先上游"那一行往上推 1–2 枚 —— 那是口径随提交自然漂移，不是新事实，比较时以
"取数基线"为准。

---

## 1. 刷新后的总量（对照 2026-10-07）

| 项 | 2026-10-07 | 2026-10-08 现算 |
|---|---|---|
| `upstream/main` tip | `80e412da9`（2026-09-30） | **`7147731d5`（2026-10-08）** |
| fetch 是否带来新提交 | 否 | **是，4 枚**（`80e412da9..7147731d5`） |
| 分叉点 | `e111ec6fb` | **`e111ec6fb` 未变** |
| 落后上游 | 1,180 | **1,184** |
| 领先上游（`wp/integration`） | 1,079 | **1,112**（`main` = 1,109，与 GitHub 界面读数逐位一致） |
| 上游改动过的文件（分叉点之后） | 5,125 | **5,104** |
| 我们改动过的文件 | — | **703**；其中两边都改 **147** |
| 只上游改（合并自动取上游） | — | **4,957** |
| 只我们改（合并自动保留） | — | **556** |
| 整树规模 | 2,562 → 5,976 | **2,585 → 5,981**（分叉点 2,028） |
| 双方各自新建同一路径 | 9 | **14**（其中 10 报 add/add 冲突） |

**冲突总量与分型**（旧值 → 新值）：

| 性质 | 10-07 | 10-08 |
|---|---|---|
| 内容冲突 | 86 | **90** |
| 撞名新建（add/add） | 9 | **10** |
| 上游删除、我们改过（modify/delete） | 16 | **16** |
| 位置冲突（file location） | 1 | **1** |
| 合计冲突路径 | 112 | **117** |
| 冲突块 | 617 | **622** |
| 标记内行（含 add/add） | 37,532 | **36,537**；锁文件 346 块 / 16,469 行 ⇒ 非锁 **276 块 / 20,068 行** |

**与在册账本的交叉**（在册 = `check_p1_invariants.py --json` 的 `files` 字典，146 个键 /
`totals.files` 145：差的那一枚是 `console/package-lock.json`，`_totals` 把 `mechanical` 整枚剔掉，
`mechanical_files` 现数 1 ⇒ 不是口径漂移，是同一枚自动生成文件在两个字段里的不同待遇）：

| 关系 | 10-07 | 10-08 |
|---|---|---|
| 在册且真冲突 | 100 | **104** |
| 在册但这次干净合并 | 43 | **42** |
| 真冲突但不在册 | 12 | **13** |

104 + 42 = 146。不在册的 13 枚 = 10 枚 add/add（全是分叉点之后双方各建的同名文件，其中
**`console/src/layouts/constants.test.ts` 是发布渠道阶段 1 我们自己新建的**，上游也新建了同名文件）
+ 3 枚被上游改名搬走的宿主（`app/chats/{__init__.py, session.py, query_error_resilience.py}`，
判据 86 那一型：冲突从"干净"列被搬到"冲突"列，只按路径交叉会漏）。

⚠ 一天之内 100→104、43→42、112→117：上游那 4 枚新提交（`fix(chats)` / `fix(console)` ×2 /
`fix(providers)`）踩到的正是我们在改的宿主。**每多一天，这个数只会更大。**

---

## 2. 静默删除：这次量到了后果，而不只是数量

上游在分叉点之后删除 115 枚路径，我们树里还留着 115 枚，其中 **96 枚我们从没改过 ⇒ 合并不报任何冲突、直接删**。
数量与 10-07 相同（96 / 19）。本次新增的是**引用实测**：拿合并产物树 `8374294c6` 与 `upstream/main` 两棵树
各跑一次 `git grep -l -F <模块名/基名>`，排除文档命中，得到

- **65 枚**：全树无人引用 ⇒ 上游删对了，跟着删即可。
- **24 枚**：上游自己的树里也仍有引用 ⇒ 是上游的存量悬挂，不是我们造成的。
- **7 枚**：**只有我们的树还在引用** ⇒ 这 7 枚是合并后真正的静默断裂点。

7 枚逐条（`<-` 读它的是谁）：

| 被上游删掉的路径 | 谁还在引用 | 性质 |
|---|---|---|
| `console/src/pages/Coding/FileTree.module.less` | `console/src/pages/Agent/Projects/components/ProjectFileTree.tsx` | **真断**（fork 自有组件 import 上游已删的样式文件） |
| `console/src/pages/Settings/Agents/components/SortableAgentRow.tsx` | `console/src/pages/Settings/Agents/components/AgentTable.tsx` | **真断** |
| `console/src/test/chat-mock.ts` | `console/vitest.config.ts` 的 alias | **真断**（前端测试配置直接指向不存在的文件） |
| `src/qwenpaw/agents/memory/adbpg_memory_manager.py` | `tests/unit/app/test_workspace_memory_backend.py` | **真断**（刀 79-A 系的工作集后端用例） |
| `console/src/pages/Chat/ChatPage.test.tsx` | `console/vitest.config.ts` 的 `exclude` | 惰性断（exclude 一个不存在的文件不会报错） |
| `console/src/pages/Agent/Skills/components/skillMetadata.ts` | 只有 docs | 非代码 |
| `console/src/pages/Settings/SkillPool/components/SkillPoolListItem.tsx` | 只有 docs | 非代码 |

⇒ **代码级 4 枚 + 惰性 1 枚**，需要逐枚裁决（补上游替代 / 把文件留在 fork 侧 / 删掉引用点）。

---

## 3. 权重在哪：88 枚在册内容冲突的分布

先破一个可能的幻想：**在册的内容冲突里"纯改名型"= 0 枚**（按 `behavior_added == 0 且 behavior_removed == 0`
筛，命中 0）。所以没有任何一类冲突能靠 `copaw_brand.py` 重新生成来批量了结。

按"我们在册的行为行"排序，权重高度集中（前 8 枚占大头）：

| 冲突块 | 在册行为行 | 宿主 |
|---|---|---|
| 346 | +8,960 −9,444 | `console/package-lock.json`（**取上游 + 重新 `npm install`，不逐块判**） |
| 21 | +4,052 −327 | `src/qwenpaw/app/routers/agents.py` |
| 6 | +1,056 −72 | `console/src/pages/Agent/Skills/index.tsx` |
| 3 | +698 −4 | `src/qwenpaw/app/routers/skills.py` |
| 3 | +695 −0 | `console/src/api/modules/agents.ts` |
| 4 | +617 −3 | `console/src/api/types/agents.ts` |
| 1 | +363 −17 | `console/src/api/modules/agent.ts` |
| 4 | +264 −76 | `console/src/pages/Settings/Security/index.tsx` |

（口径先说清，这里最容易读错（**判据 101**）：`totals.behavior_added` 13,705 + `totals.behavior_removed` 2,285
= **15,990** 是**门禁口径**，它把 `MECHANICAL` 集合里的文件整枚剔掉（`scripts/check_p1_invariants.py`
的 `_totals`），本树里被剔掉的正是 `console/package-lock.json` 那一枚 —— `files` 字典 146 键、
`totals.files` 145，差的就是它；而**含 lock 的主机累加是 34,394**（一枚自动生成文件占 54%）。
下面所有分数**用 15,990 作分母**，lock 单独列，权重才不被一枚自动生成文件吃掉。）

**这一簇的权重（现算，非估算）：**

- 88 枚在册内容冲突的行为行合计 **30,306**，其中 lock 一枚 **18,404**
  ⇒ **除 lock 外 11,902 = 门禁口径全册 15,990 的 74.4%**。
- 块数：88 枚合计 **595** 个 `<<<<<<<`，lock 一枚占 **346** ⇒ 其余 87 枚 **249** 块。
- **agents / skills 一簇 12 枚**（现筛：路径含 `agents` / `agent.ts` / `skills.py` / `Skills/index.tsx`
  的在册内容冲突，逐枚为
  `app/routers/agents.py` 4,379、`pages/Agent/Skills/index.tsx` 1,128、`app/routers/skills.py` 702、
  `api/modules/agents.ts` 695、`api/types/agents.ts` 620、`api/modules/agent.ts` 380、
  `agents/react_agent.py` 116、`agents/tools/file_io.py` 62、`agents/utils/message_processing.py` 53、
  `api/types/agent.ts` 41、`agents/memory/agent_md_manager.py` 5、`agents/tools/file_search.py` 4）
  合计 **8,185** 行 = 门禁口径全册的 **51.2%**，块数只有 **55** ⇒
  一半以上的判决行压在这一簇上，而且块少行重，判起来是"一次读一大片"而不是"很多次小判"。
- 除 lock 与上面这 12 枚之外，还剩 **75 枚 / 3,717 行 / 194 块**（每枚平均不到 50 行）。

结论同一句：**合并判决量集中在 agents/skills 一簇 + lock 一枚**，
lock 走"取上游 + 重新生成"，剩下真正要逐块判的是这 12 枚（55 块、8,185 行）+ 75 枚（194 块、3,717 行）。

---

## 4. 三类"要重新安家"而不是"要解冲突"的宿主

这是这次合并真正的成本所在：上游不是改了这些文件，是把它们**搬走或整个删掉**了，
所以 git 只会报 modify/delete 或干脆不报，人工必须回答"我们的改动落到哪去"。

**(a) `app/runner/ → app/chats/`（改名 + 砍掉一半）**

- 上游现存 `chats/` 11 枚：`__init__.py api.py manager.py models.py query_error_dump.py session.py title_generator.py utils.py repo/{__init__,base,json_repo}.py`
  ⇒ 我们 `runner/` 同名 11 枚逐一对应，**我们的在册改动可以逐枚搬到新路径**（`api.py` +457、`session.py` +320、`models.py` +37、`__init__.py` +23、`runner.py` +32 里除 `runner.py` 外都在）。
- 上游**不再保留** `runner/` 的 12 枚：`runner.py command_dispatch.py daemon_commands.py mission_dispatch.py task_tracker.py query_error_resilience.py control_commands/*(6)`。
  逐枚按**定义符号**（不是文件名）在上游 tip 上找接替宿主，12 枚**全部有下落**：

| 我们侧（`app/runner/`） | 上游定义符号 | 接替宿主（实测） |
|---|---|---|
| `task_tracker.py` | `class TaskTracker` | **同符号搬家**：`src/qwenpaw/app/task_tracker.py:47` |
| `control_commands/{__init__,base,model_handler,skills_handler,stop_handler,approval_handler}.py` | `BaseControlCommandHandler ControlContext …CommandHandler` | **同族搬家**：`src/qwenpaw/runtime/commands/control/`（其 `__init__.py:25-34` 逐一导入，另加 `checkpoint_handler.py`） |
| `daemon_commands.py` | `DAEMON_PREFIX`、`RestartInProgressError` | `runtime/commands/daemon.py:30` + `exceptions.py:553`；适配器 `runtime/builtin_commands.py:32 _make_daemon_adapter` |
| `command_dispatch.py` | `_is_conversation_command`、`_is_control_command`、`handle_control_command` | **改写**：`runtime/slash_command_registry.py`（`CommandSpec:28`、`SlashCommandRegistry:47`）+ `runtime/builtin_commands.py`（`_make_conversation_adapter:511`、`_collect_conversation_specs:613`、`_make_control_adapter:165`、`_collect_control_specs:248`）；`is_control_command` 另见 `app/channels/command_registry.py` |
| `mission_dispatch.py` | `detect_active_mission_phase` | **改写**：`src/qwenpaw/modes/mission/`（`MissionMode:27`、`MissionGate:43`，`gates.py:4` 注释明写 "Replaces the custom run_mission_phase2 executor"、`contributor.py`、`hooks.py`） |
| `query_error_resilience.py` | `_CONTEXT_OVERFLOW_PATTERNS`、`_TRANSIENT_UPSTREAM_STATUS_CODES` | **上游自己实现了同一能力**：`agents/context/overflow_recovery.py:19 call_with_overflow_recovery` + `agents/context/base.py:25 recover_from_context_overflow`（`scroll/manager.py:375` 实现）+ `agents/react_agent.py:665 _is_context_overflow_error` ⇒ **已闭环 57 那笔（context overflow → compaction 重试）合并后应以上游实现为准，我们那份退掉**（⚠ 别拿 `agents/context/recovery.py` 当上游宿主 —— 那是**我们**的文件，上游没有） |
| `runner.py` | `class AgentRunner`（继承 `Runner`） | 上游 tip `git grep "^class \w*Runner"` **零命中** ⇒ 整枚拆进 `runtime/`：`runtime.py executor.py builder.py phases.py hooks.py tool_registry.py tool_guard.py` |

⇒ 裁决 3（"问上游新架构里谁接替了它"）的答案是：**不需要"整族留 fork 自有路径"这个选项**，
12 枚逐枚都能落到上表的新宿主上。代价分两类：同符号/同族搬家 4 组可以直接把我们的在册改动重放；
`command_dispatch`、`mission_dispatch`、`query_error_resilience`、`runner.py` 这 4 枚是上游重写，
我们的 fork 行为要**映射到新机制**（slash 注册表、modes/mission、context recovery），不是搬文本。

我们侧还在跨目录引用 `app.runner` 的 6 处（合并后必须逐个重指）：
`agent_stats/service.py:16`、`agents/memory/proactive/proactive_trigger.py:64`、
`app/_app.py:395`、`app/routers/plugins.py:173`、`:383`、`cli/daemon_cmd.py:13`。

**(b) `app/mcp/ → drivers/`（重构，不是改名）**

- 我们侧：`mcp/manager.py`（+194 −13）、`mcp/stateful_client.py`（**+690 −396**）、`mcp/watcher.py`（+26 −8）。
- 上游侧 `app/mcp/` 只剩 `__init__.py config_service.py schemas.py`；`stateful_client` 的新宿主是
  **`src/qwenpaw/drivers/handlers/mcp_stateful_client.py`**（配套 `drivers/adapters/mcp_{binding,card_builder,console,legacy_config}.py`、`drivers/handlers/mcp.py`）。
- ⚠ 这里压着两笔已闭案的修复：**已闭环 40（远程 MCP 的 OAuth Bearer 注入回归）**与**已闭环 46（py3.10 `BaseExceptionGroup` NameError）**。搬到新宿主时必须重验这两笔，不能靠"合并没报红"过关。

**(c) 上游整体删除、我们仍在改的四组：逐组量了"接替者"与"消费方闭包"（判据 102）**

量法：对每个被删路径，用 `git grep -nE "from ['\"][^'\"]*< specifier >"` 逐文件解析 import specifier
再做扩展名/目录补全；Python 侧按 dotted module 加相对层级补全。路径 token 模糊匹配会造假命中
（`plan` 一词在 HEAD 里命中 76 个文件，真消费方只有 7 个）。

| 组 | 被删路径 | 我们的在册行为行 | 上游接替者（已实测存在） | HEAD 里的消费方 |
|---|---|---|---|---|
| Workspace | `pages/Agent/Workspace/` 全部 8 枚文件 | +12 / +9 / +8 / +58（其余 4 枚在册外） | **`pages/Files/index.tsx`**（路由 `core.workspace` = `/workspace`）挂 **`features/files-workspace/FilesWorkspace.tsx`**（该 feature 目录 30 枚文件，含 `FilesDrawer.tsx`、`FilesNavigator.tsx`、`MemoryGraphView.tsx`、`ResponseArtifactList.tsx`） | 唯一入口是 `layouts/MainLayout/index.tsx:31` 的字符串路由 `lazyImportWithRetry("../../pages/Agent/Workspace")`；上游的 MainLayout 已换成注册表驱动的 `useRoutes()`（`console/src/plugins/registry`），文件里已无 `lazyImportWithRetry` |
| 会话抽屉 | `pages/Chat/components/ChatSessionDrawer/` 全部 3 枚 | +5 −5 | **`layouts/SidebarSessionList.tsx`** + `useSidebarSessionListData.ts` + `components/SessionItem/`、`SessionGroupDnd/`、`SessionGroupHeader/`、`SessionDateHeader/` ⇒ 会话列表从抽屉挪进侧栏 | `Chat/components/ChatActionGroup/index.tsx:11` 一处 + 组内自带 `ChatSessionDrawer.test.tsx`。上游的 ChatActionGroup 只剩 `Files`、`Terminal` 两个 IconButton |
| Agent 表 | `pages/Settings/Agents/components/AgentTable.tsx` | +98 −60 | **`Settings/Agents/components/AgentGallery.tsx`**（`index.tsx:1` import、`:356` 渲染；上游该目录留 18 枚文件，其 `components/index.ts` 只出 `AgentModal`/`AgentBackendFields`/`CopyAgentModal`） | barrel 一行 `components/index.ts:1`，经 barrel 被 `Settings/Agents/index.tsx:10` import、`:206` 渲染 |
| Plan | `app/routers/plan.py` + `api/modules/plan.ts` + `components/PlanPanel/{index.tsx, index.module.less}` + `src/qwenpaw/plan/{__init__,broadcast,hints,schemas}.py` | +2 / +16 / +13（后 4 枚在册外、静默删） | **无实现，但留三处壳**（刀 87 后现数）：`agents/command_handler.py:1579 _process_plan` 是桩，正文写"plan mode is being migrated to the new task system"，同文件 tip 上仍有 16 枚 plan 命中（含 `clear_plan` metadata 与 `:138-153` 的"`/plan <描述>` 透传给 runner"注释）；`config/config.py:2069 class PlanConfig` 仍在，唯一写者 `pawapp/agent.py:144`，全树无读者；`chat.commands.plan.description` 仍在 `locales/en.json`，上游自己 console 侧零读者。`src/qwenpaw/plan/`、`app/routers/plan.py`、`api/modules/plan.ts`、`PlanPanel/` 确实不在 tip 上 | py（按 import specifier 现数 5 枚宿主）：`app/runner/runner.py`(4)、`agents/react_agent.py`(2)、`app/runner/command_dispatch.py`(1)、`app/routers/agent_scoped.py`(1)、`app/routers/__init__.py`(1)。ts：`api/modules/plan` 被 `PlanPanel`、`Chat/index.tsx:35`、`ReactAgentCard.tsx:5` import（`AnywhereChat:23/:60` 已由刀 87 摘除）；`PlanPanel` 被 `ChatActionGroup:13` import |

要点（刀 87 后已全部现数复核）：

- **Plan 组不需要"手删我们加的那几行"**：plan 命中数在分叉点与 HEAD 逐宿主相等 ——
  `agents/react_agent.py` 40/40、`app/runner/runner.py` 65/65、`app/routers/__init__.py` 2/2、
  `app/routers/agent_scoped.py` 2/2、`pages/Chat/index.tsx` 11/11、`ChatActionGroup/index.tsx` 11/11、
  `ReactAgentCard.tsx` 21/21 —— 只有 `app/runner/command_dispatch.py` 是我们把 14 删到 11。
  ⇒ 整组是 v1 继承（上游 `20f62efe6 feat(plan): add plan mode (#3686)`），fork 侧没往任何上游宿主加过
  plan 行为 ⇒ 取上游字节即清空，判据 103 里"我们加的那几行"这一项在 Plan 组是**空集**。
  ⚠ 本节第一版写的"`agents/react_agent.py:817` 与 `:927` 是我们加的行、是合并后唯一还活着的引用"**已作废**，
  上面那行逐宿主计数是它的反证。
- **`components/AnywhereChat/index.tsx`（fork 自建，`git cat-file -e e111ec6fb:` 失败 ⇒ 合并不会动它）已处理 = 刀 87**
  （`54bb86bc8`，用户裁"跟着删，与裁决 2 一致"，代价 = 产品里不再有 Plan Mode）：摘掉 9 处用点、
  净 −81 行（两枚 import、`PlanIcon`、`planEnabled` 与 `planPanelOpen` 两枚 state、`getPlanConfig` effect、
  `/plan` 拦截、斜杠命令建议项、两枚依赖数组里的 `planEnabled`、工具栏按钮、`PlanPanel` 渲染）。
  3,318 → 3,237 行，残留 `plan` 命中 0；簇文件一枚未动，留给合并删。
  ⇒ 买掉的是合并后必然的编译断裂：`import { planApi }` 与 `import PlanPanel` 会指向上游静默删除的文件。
- ⚠ 刀 87 **不减冲突数**：16 枚 modify/delete 里 plan 簇占 3 枚（`api/modules/plan.ts` +16/−7、
  `components/PlanPanel/index.tsx` +13/−5、`app/routers/plan.py` +2 —— 也正是册里仅有的 3 枚 plan 文件），
  它们照旧报 modify/delete，只是解法固定为"接受删除"、零手工。另 5 枚（`src/qwenpaw/plan/` 4 枚 +
  `tests/integration/test_plan.py`）与分叉点逐字节相同 ⇒ delete/delete，不报冲突、静默消失。
  `ReactAgentCard.tsx` 是 content 冲突（上游那份 plan 归零、我们那份 21 枚），解法同样是取上游字节。
- ⚠ 闭包数口径更正：本节开头那句"真消费方只有 7 个"与刀 87 的复测不一致。按 import specifier 现数是
  **8 枚**（py 5：`app/runner/runner.py`、`agents/react_agent.py`、`app/runner/command_dispatch.py`、
  `app/routers/agent_scoped.py`、`app/routers/__init__.py`；ts 3：`pages/Chat/index.tsx`、
  `pages/Agent/Config/components/ReactAgentCard.tsx`、`Chat/components/ChatActionGroup/index.tsx`），
  外加 fork 自建的 `AnywhereChat`（本刀已摘净）⇒ **上表那行是现数，7 是旧口径读数**。

16 枚 modify/delete 的在册行为行合计 **2,244 行**（占 15,990 的 14%），其中 `stateful_client.py`
一枚占 1,086 ⇒ 后端两族（runner→chats、mcp→drivers）是重新安家，前端四组才是裁决面。

⇒ 四组里有三组上游给了**明确接替者**（FilesWorkspace、SidebarSessionList、AgentGallery），
"跟着上游删"意味着我们的 fork 行为要搬到接替者上重新实现一遍，或直接放弃。

---

## 5. 最快路线

结论：**一次 merge，配一份逐类默认解法，比按上游 release 切片合并快**，理由是
切片会把同一批宿主（尤其上表 3 的 agents/skills 簇）反复打开 N 次，而 4,957 + 556 枚
自动合并的部分一次就能定；且分叉点 `e111ec6fb` 从未变过，切片不会让任何一方变"干净"。

建议的执行形态（成本从低到高）：

1. **准备阶段（可提前做、每做一枚就少一枚冲突）**：清单见 §6 的"合并前刀序"。
   这一步就是判据 84/85 的反向使用：**在册但这次干净合并的 42 枚，是过去几十步"退回上游字节"换来的**。
2. **开一个专用 worktree + 分支**（例如 `sync/upstream-20261008`，基点 `wp/integration`），
   在里面 `git merge upstream/main`，工作区一旦进冲突态就留在里面，不碰 `CoPaw-wp14`。
3. **按类批量落默认解**（add/add 10 枚以**上游为准**、把我们的额外断言并进同一文件，因为那 9 枚是双方各自写的测试）：
   - 锁文件：取上游 ⇒ 之后 `npm install` 让 fork 侧新增依赖（`@testing-library/dom` 等）自己长回来；
   - `app/mcp/*` → `drivers/`：逐 hunk 重放到 `drivers/handlers/mcp_stateful_client.py`，**OAuth 注入与 py3.10 两笔必须有回归用例**；
   - `app/runner/*` → `app/chats/*` 与上游不再保留的 12 枚：按 §4(a) 的符号级接替表逐枚落地（不留 fork 自有路径）；
   - 其余在册内容冲突：按 §3 的权重倒序处理，**先吃掉 agents/skills 那 12 枚（55 块、51.2% 的行）**，
     剩下 75 枚平均不到 50 行、逐块判即可。
4. **验收集**（与刀 86 之后的基线一致，全部现跑）：`pytest tests/unit`（基线 3,433 / 5 skipped / 8 xfailed）·
   `console` 全量 `test:run`（基线 78 文件 / 491 用例）· `tsc -b --force` · 五道门禁
   （locale split / namespace boundaries / release channel R1–R5 / CI command targets / brand verify）·
   `~/.copaw/config.json` 哈希不变 · 真浏览器起一次 `copaw app` 走 overlay 路由。
5. **账本后果（必须提前定）**：
   - `check_p1_invariants.py` 的 `DEFAULT_BASE_REF = e111ec6fb` 与真实分叉点**目前相等**；一旦合并落地，
     `git diff base..HEAD` 会把上游 1,184 枚提交的内容也计成"我们的 added 行" ⇒ 五表读数会一次性暴涨，
     **这不是回归，是口径平移**。要么把 base 改成上游合并点（`upstream/main` tip 或 merge 后的第二父），
     要么改成"合并之后的新分叉点"并重新立基线。这是判据 92 那一类问题：口径不先定，读数就没人能解释。
   - `check_namespace_boundaries.py --upstream-ref qwenpaw_upstream_main` 与 CI 里那个 ref 名要一起更新。
     ⚠ 现算：`qwenpaw_upstream_main` **只存在于 CI 里**（`.github/workflows/unit-tests.yml:83` 现场
     `git fetch … agentscope-ai/QwenPaw.git main:qwenpaw_upstream_main`），本地 `git ls-tree` 直接
     `fatal: Not a valid object name` ⇒ 这条门禁在本地是不可用的，读数只能在 CI 里取。
     另：上游仓库已改名（本地 remote `upstream` = `agentscope-ai/CoPaw.git`，tip `7147731d5`；
     旧名 `agentscope-ai/QwenPaw.git` 的本地 ref 停在 `2d9527bb0` 2026-05-27，且**是** tip 的祖先）
     ⇒ 换基线那一步要把 workflow 里那两处 URL/ref 与 `DEFAULT_BASE_REF` 同时核一遍。
   - 版本线：阶段 1 定的 `1.1.11b1.post1` 要按"跟上游同号 + `.postN`"重新裁定（上游已到 v2.2.x 线）。

---

## 6. 四项裁决（2026-10-08 已下）与刀序

裁决原文与落点：

1. **合并形态 = 一次合到 `upstream/main` tip（`7147731d5`）**。不追 `v2.2.1`（它不是 `main` 的祖先，追它多一次合并）。
2. **§4(c) 四组被上游整体删除的能力 = 跟着上游删**。
   实测动作不是"删四个文件"：这些组的消费方**绝大多数是上游自有文件，且上游那份对这些符号零引用**
   ⇒ 每一处的动作 = 取上游字节，其中我们加过行的宿主再手删那几行，然后删我们的文件。
   Plan 组的子裁决也已由用户裁下：**"跟着删（裁决 2 一致）"，代价 = 产品里不再有 Plan Mode**
   ⇒ 落点 = 刀 87（`54bb86bc8`），只改 fork 自建的 `components/AnywhereChat/index.tsx`（9 处用点 / 净 −81 行），
   簇文件与上游自有宿主一枚未动，全部留给合并。详见 §4(c)。
   三组有明确接替者（`pages/Files` + `features/files-workspace/FilesWorkspace.tsx`、
   `layouts/SidebarSessionList.tsx` + `components/SessionItem`、`Settings/Agents/components/AgentGallery.tsx`），
   Plan 组**无接替者、但有三处壳**（`command_handler.py:1579 _process_plan` 桩 + `config/config.py:2069 PlanConfig`
   无读者 + `chat.commands.plan.description` 零读者；实现路径 `src/qwenpaw/plan/`、`app/routers/plan.py`、
   `api/modules/plan.ts`、`PlanPanel/` 在 tip 上都不存在，agent 侧只留 `make_plan-{en,zh}/SKILL.md` 提示词）。
3. **`app/runner/` 上游不再保留的 12 枚 = 逐枚找上游新架构的接替者**（不做"整族留 fork 路径"）。
   结果见 §4(a) 的符号级接替表：12 枚全有下落，4 组同符号/同族搬家、4 枚上游重写需要把 fork 行为映射到新机制。
4. **P1 账本 = 换新分叉点重立基线**：合并落地后 `DEFAULT_BASE_REF` 与
   `check_namespace_boundaries.py --upstream-ref` 一起换到新分叉点，重立基线那一步单独成一笔账。

### 刀序（合并前能做的，与只能在合并后做的）

合并前（fork 侧独立可验的刀。⚠ 判据 105：**"少一枚冲突"不是这类刀的评价标准** —— 落在上游自有文件上的
预防性改动不会减冲突，只会把合并的免费工作量重做一遍；合并前真正该手工摘的只有 fork 自建文件那一型）：

1. **裁决 2 的前置刀：合并前只需要手工摘 fork 自建那一枚消费方 —— 已完成（刀 87，`54bb86bc8`）**。
   落点只有 `components/AnywhereChat/index.tsx`（fork 自建 ⇒ 合并不会动它，9 处用点 / 净 −81 行）。
   其余候选落点（`api/modules/plan.ts`、`components/PlanPanel/`、`pages/Agent/Workspace/`、
   `Chat/components/ChatSessionDrawer/`、`Settings/Agents/components/AgentTable.tsx`）**都是上游自有文件**
   ⇒ 合并取上游字节就清空，开刀前先去改它们等于把合并的免费工作量做两遍（判据 105）。
   刀 87 读数：前端 78 文件 / 491 用例全绿 rc=0、`pytest tests/unit` 3,433 passed / 5 skipped / 8 xfailed、
   `tsc -b --force` 改前改后同 rc=0、五表现算逐键相同（146 keys / `totals.files` 145 / +13,742 −2,322 /
   行为 144 / mechanical 1，判据 101 同口径）、CI 四道门禁全绿且 locale 串与刀 80/81 逐字相同
   （2,977 gated / 11 模板族 / 2 豁免 / 1,459 overlay en+zh / 5 上游键豁免）。
   ⚠ `AnywhereChat/index.tsx` 改前即 prettier 红（把 HEAD 字节复制进 `console/` 树内单测也 rc=1），
   本刀一个 `--write` 都没跑（判据 63）。
   ⚠ 判据 91 说"删上游一项能力"要记 `behavior_removed` 上涨 —— 本刀落在**册外文件**上，实测五表零响应。
2. **§2 的 4 枚真断引用**（合并只会扩大它们，不会修）：
   `Coding/FileTree.module.less`、`Settings/Agents/components/SortableAgentRow.tsx`、
   `console/src/test/chat-mock.ts`、`agents/memory/adbpg_memory_manager.py`。
3. **五表里已被标为待重放的两笔**（已闭环 40 OAuth 注入、已闭环 46 py3.10 `BaseExceptionGroup`）
   在 `app/mcp/*` → `drivers/` 搬迁时必须有回归用例 —— 现在能先把用例写红。

合并后（只能在合并态里做）：

4. 锁文件取上游 + `npm install` 让 fork 侧依赖长回来。
5. add/add 14 枚（10 枚真冲突）以**上游为准**，我们的额外断言并进同一文件。
6. `app/runner/*` → `app/chats/*` 逐枚重放；上游重写那 4 枚按 §4(a) 的符号表映射到
   `runtime/`、`modes/mission/`、`app/task_tracker.py`。
7. agents/skills 那 12 枚（55 块、8,185 行 = 门禁口径 51.2%）先吃，剩 75 枚（194 块、3,717 行）逐块判。
8. 换新分叉点重立基线（裁决 4）+ 版本线重新裁定（`1.1.11b1.post1` vs 上游 v2.2.x）。

---

## 7. 量到了什么 / 没量什么

量到：冲突分型与逐枚路径、权重排序、静默删除的引用实测、两边改动集规模、tag 拓扑、
`app/runner→app/chats` 与 `app/mcp→drivers` 的宿主映射、
上游不再保留的 12 枚 runner 文件的**符号级接替表**、
§4(c) 四组的**接替者与消费方闭包**（逐文件解析 import specifier，非 token 匹配）。

没量：**没有真跑一次 merge**（`merge-tree` 只产树，不产工作区冲突态，所以"hunk 级实际文本长度"
与"逐枚裁决的真实耗时"仍是估计）；没跑合并后的测试；没读上游 v2.2.1 → tip 这 133 枚提交的内容摘要
（不知道上游自己在这 133 枚里是否已经把我们的某些能力做掉了）；`console/package-lock.json` 取上游后
`npm install` 会产生什么差异没验；§2 的引用实测按"模块名/基名的字面出现"计数，
动态 import 与字符串拼路径不在其中；**§4(a) 符号表只证明"上游有同名符号的宿主"，没证明
它的行为合同与我们那份等价**（`query_error_resilience` 那一枚最需要这一步：上游有
`call_with_overflow_recovery`，但它覆盖不覆盖已闭环 57 的全部情形，要在合并后用用例验）；
**`check_namespace_boundaries.py` 在本 worktree 里 `result: PASSED` 但同时打
`warning: failed to read baseline ref 'qwenpaw_upstream_main'`** ⇒ 它这里没有基线可比，"绿"不等于
命名边界成立（判据 92 那一型的又一次：一条读不到输入的门禁会静默存违规）。要它真跑需要上游远端 ref，
也就是需要一次 `git fetch` 的授权。

新判据：

- **判据 102（删除闭包按 import specifier 量，不按路径 token）**：一次模糊匹配把 `plan` 一词
  在 HEAD 里报了 76 枚"消费方"，逐文件解析 import 后真数是 7 枚。合并方案里"删掉一个能力"的
  代价必须数得出真消费方，否则会按假数排刀。
- **判据 103（"跟着上游删"的真实动作在消费方一侧）**：上游删一组能力时，它的消费方通常**也是上游自有文件**，
  且上游那份对这些符号零引用 ⇒ 合并自动取上游字节 = 我们的 fork 行为**静默消失且不报冲突**。
  所以这类裁决的账要记在"我们往上游文件里加了哪几行"上，不是记在被删文件上。
- **判据 104（找接替者要用定义符号，文件名会误导）**：`app/runner/*` 的 12 枚里，
  `task_tracker.py` 的同名类在 `app/task_tracker.py`、`control_commands/*` 的同族在 `runtime/commands/control/`，
  而 `runner.py` 的 `class AgentRunner` 在上游 tip **零命中** —— 只看目录改名会漏掉"整枚被拆"这种形态。
- **判据 105（"跟着上游删"要先按文件所有权分派，否则会重做合并的免费工作量）**：一组被上游删掉的能力，
  它的消费方绝大多数和它同属上游 ⇒ 合并取上游字节就把它一起带走了，把这些落点列成"合并前的刀"
  等于同一件事做两遍，还额外给册添噪声。真正需要合并前手工处理的只有一型：**fork 自建、上游看不见、
  因而合并绝不会动的文件**。判归属用 `git cat-file -e <分叉点>:<path>`（失败 = fork 自建），
  判"我们是否往上游宿主加过这项能力"用分叉点与 HEAD 的命中数对比 —— Plan 组七个上游宿主里六个相等
  （40/40、65/65、2/2、2/2、11/11、21/21），只有 `command_dispatch.py` 是我们删的（14→11），
  所以那一组一行都不用手工摘。

相关账目：已闭环 84–86（判据 84/85/86 原文在 `2026-10-07-trial-merge-conflict-table.md`）、
已闭环 40、46、56、57、75、79–81、83–86。
