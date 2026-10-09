# 追上游实施跑道（2026-10-08 刷新；§8 = 2026-10-09 合并落地后的账）

**目的**：把"合并 upstream 最新进展"这条路的最短走法量化到可以直接开工的粒度。
本文全部为 2026-10-08 现算，不是引用 2026-10-07 那张表的读数（对照处会写明旧值）。

**方法（只读）**：`git fetch upstream` → `git merge-tree --write-tree HEAD upstream/main`。
`merge-tree` 只向对象库写一棵树，不碰工作区、不产生提交、不动分支、不推送，因此随时可重算、
重算前不需要清理现场。本次产出树 = `8374294c6`。

**取数基线**：本文所有读数取于 `HEAD = 1b946c05d`（刀 86 的三笔之后）。落本文这笔 docs 提交
本身会把"领先上游"那一行往上推 1–2 枚 —— 那是口径随提交自然漂移，不是新事实，比较时以
"取数基线"为准。

**§2 的例外**：那一节在刀 87/88/89 之后（`HEAD = 358f0e7ba`）按 import specifier 重算并改写过一次，
其余各节仍是 `1b946c05d` 的读数 ⇒ §1 的冲突总量与 §3 的权重没有随 87/88/89 重算（这三笔全落在
fork 自建文件上，一枚上游宿主都没碰，重算只会把"落后/领先"两行往上推）。

**§8 的例外**：那一节是**合并之后**的账（`HEAD = 2f85a4e06`，2026-10-09），分叉点已从 `e111ec6fb`
换轨到 `ddd8408eb` ⇒ §1 的 117 枚冲突、§3 的权重分布与 §8 的新基线读数**不在同一口径下可比**，
不是"数字变了"而是"量的东西换了"（判据 125）。§1–§7 保留原状，作为合并前的决策依据。

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

## 2. 静默删除：这一节被推翻了重写过一次

上游在分叉点之后删除 115 枚路径，我们树里还留着 115 枚，其中 **96 枚我们从没改过 ⇒ 合并不报任何冲突、直接删**。
数量与 10-07 相同（96 / 19）。

**先更正方法。** 10-08 那一版拿合并产物树 `8374294c6` 与 `upstream/main` 各跑一次
`git grep -l -F <模块名/基名>`、排除文档命中，得 65 / 24 / 7 三档，并把那 7 枚报成"合并后真正的静默断裂点"。
那次读数错在两处，两处都是**判据 102**（按名字/路径 token 匹配会造出假消费方）的实例：

- **按基名匹配**：`FileTree.module.less` 命中 `ProjectFileTree.tsx` —— 后者只 import 自己那份
  （`ProjectFileTree.tsx:54 import styles from "./ProjectFileTree.module.less"`），子串包含而已。
- **只匹配带引号的 specifier**：Python 的 `from .mod import x` 整形式没进扫描集。

重算改成**逐文件解析 import specifier、把每个说明符解析成仓库里的具体路径**再比对
（`/tmp/closure7.py` ⇒ 权威读数 `/tmp/closure10.out`）。结果：**96 枚里 43 枚全树零引用者，53 枚有引用者，
而"只有我们在引用、且引用者能活到合并之后"的 = 0 枚。** 旧的"24 枚上游自己也引用"这一档直接归零，全是子串造的假阳性。

按引用者的归属分四档（**对数**是划分互斥的口径：83 对引用关系每对只进一档；**目标数**按档内去重，跨档可重叠）。
⚠ 口径：这一版**没有读合并产物**，三棵树分别是分叉点 `e111ec6fb`（2,028 路径）、tip `7147731d5`（5,981）、
本树 `HEAD = 358f0e7ba`（2,586），"合并会怎样"是按**引用者归属**推出来的（在不在 tip、我们有没有改过它）
⇒ "免做"与"整簇同删"两档是推论，合并态里要各验一枚；"断裂 = 0"这一档不依赖推论，它只要求
引用者在 tip 存在且我们改过它，那正是"手删"档。

| 档 | 引用对数 | 目标数 | 合并时会怎样 |
|---|---|---|---|
| **断裂**（fork 独有引用者，且引用者幸存） | **0** | **0** | — |
| **手删**（引用者是我们改过的上游自有文件） | 5 | 5 | 取上游字节 ⇒ 我们在册那几行无处落，逐行手删 |
| **免做**（引用者是上游自有、我们没改过） | 20 | 17 | 取上游字节即自动清 ⇒ **不排刀**（判据 103 的正面） |
| **整簇同删**（引用者本身也在上游删除集里） | 58 | 40 | 上游删对了，跟着删 |

5 对手删逐条（`<-` 读它的是谁）：

| 被上游删掉的路径 | 引用它的宿主 | 宿主在册行为行 |
|---|---|---|
| `console/src/pages/Agent/Config/components/ADBPGConfigCard.tsx` | `console/src/pages/Agent/Config/components/index.ts` | +1/−0 |
| `console/src/test/chat-mock.ts` | `console/vite.config.ts` | +25/−2 |
| `src/qwenpaw/agents/coding_mode_mixin.py` | `src/qwenpaw/agents/react_agent.py` | +76/−40 |
| `src/qwenpaw/agents/tool_guard_mixin.py` | `src/qwenpaw/agents/react_agent.py` | 同上（一枚宿主两行 import） |
| `src/qwenpaw/app/routers/coding_project.py` | `src/qwenpaw/app/routers/__init__.py` | +16/−0 |

原来那 7 枚"断裂点"的下落（两枚是假的，两枚真断已由刀补掉）：

- `Coding/FileTree.module.less` ← `ProjectFileTree.tsx`：**假阳性**（子串命中）。而且
  `ProjectFileTree.tsx` 自身也在上游删除集 ⇒ 归"整簇同删"。
- `Settings/Agents/components/SortableAgentRow.tsx` ← `AgentTable.tsx`：**分类错**，引用者
  `AgentTable.tsx` 自身也在上游删除集 ⇒ 整簇同删，不是断裂。
- `console/src/test/chat-mock.ts` ← 前端测试 alias：**真断**，已由**刀 88 `ae732975e`** 结清
  （`console/vitest.config.ts` 的 alias 改为解析已安装的 SDK，与上游自己的 `vite.config.ts` 同形）。
- `agents/memory/adbpg_memory_manager.py` ← `tests/unit/app/test_workspace_memory_backend.py`：**真断**，
  已由**刀 89 `358f0e7ba`** 结清（用例改成枚举 `memory_registry.list_registered()`，不再按名字 import 具体后端）。
- `console/src/pages/Chat/ChatPage.test.tsx` ← `vitest.config.ts` 的 `exclude`：**仍在**，但 `exclude`
  是一条 glob 字符串、不是 import specifier ⇒ 任何 specifier 扫描都看不见它；exclude 一个不存在的文件不报错 ⇒ 无害，
  合并时顺手删掉那一行。
- `Agent/Skills/components/skillMetadata.ts`、`Settings/SkillPool/components/SkillPoolListItem.tsx`：只有 docs 引用 ⇒ 非代码。

⇒ 旧结论"**代码级 4 枚 + 惰性 1 枚，需要逐枚裁决**"作废。**合并前需要为静默删除开的刀 = 0 把**
（88、89 已闭，剩下的 5 对手删全部落在**上游自有文件**上 ⇒ 按判据 105，它们属于"取上游字节 + 删我们那几行"
那一型，是合并时的逐行工作，不是独立刀）。

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
- ⚠ 这里压着两笔已闭案的修复：**已闭环 40（远程 MCP 的 OAuth Bearer 注入）**与**已闭环 46（py3.10 `BaseExceptionGroup` NameError）**。2026-10-09 逐枚按定义符号找了接替者（判据 104），两条都有下落，但**合同方向不同**：

| 我们的修复 | 上游 tip 的接替者 | 行为是否等价 |
|---|---|---|
| `manager.py::_inject_oauth_token`（`_build_client` 里调） | `drivers/credentials/bindings.py:89-91 implicit_auth_headers` + `adapters/mcp_card_builder.py:288-293`（把 `Authorization` 声明成 `{source: credential, field: access_token, format: "Bearer {value}"}`） | **不等价两处**：① 过期令牌我们是不注入，上游是走刷新（`credentials/providers.py:225-247`，`expires_at - now > _REFRESH_MARGIN_SECONDS`）；② 手动 header 我们让令牌**覆盖**它，上游是 `existing_headers` 里已有 `authorization` 就**整个返回 `{}`**（`bindings.py:73-75`） |
| `stateful_client.py::_iter_leaf_exceptions` / `_extract_http_status_error`（不命名 `BaseExceptionGroup`） | `drivers/handlers/mcp_stateful_client.py:96-107`（`_is_transport_error`、`_is_401_error`，同为 `getattr(exc, "exceptions", None)` 鸭子式展开） | NameError 那一型在上游新宿主**结构性不会复发**：tip `pyproject.toml:6` 是 `requires-python = ">=3.11,<3.14"`（我们是 `>=3.10`），`ExceptionGroup` 在 3.11 是内置。我们那 4 枚 helper（`_iter_leaf_exceptions`、`_summarize_exception_chain`、`_extract_http_status_error`、`_log_http_lifecycle_exception`）在 tip `src/qwenpaw` **零命中** ⇒ 重试日志上下文那部分能力无落点，按裁决 2 归上游 |

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
   - `app/mcp/*` → `drivers/`：逐 hunk 重放到 `drivers/handlers/mcp_stateful_client.py`，
     两笔已闭案（40 OAuth 注入、46 py3.10）的用例与合同分歧见 §4(b) 与 §6 第 3 项 —— **11 条用例已存在，要重指宿主，不是新写**；
   - `app/runner/*` → `app/chats/*` 与上游不再保留的 12 枚：按 §4(a) 的符号级接替表逐枚落地（不留 fork 自有路径）；
   - 其余在册内容冲突：按 §3 的权重倒序处理，**先吃掉 agents/skills 那 12 枚（55 块、51.2% 的行）**，
     剩下 75 枚平均不到 50 行、逐块判即可。
4. **验收集**（与刀 86 之后的基线一致，全部现跑）：`pytest tests/unit`（基线 3,433 / 5 skipped / 8 xfailed）·
   `console` 全量 `test:run`（基线 78 文件 / 491 用例）· `tsc -b --force` · 五道门禁
   （locale split / namespace boundaries / release channel R1–R5 / CI command targets / brand verify）·
   `~/.copaw/config.json` 哈希不变 · 真浏览器起一次 `copaw app` 走 overlay 路由。
   ⚠ **那两句基线已作废**（判据 125：换分叉点会让所有历史读数失效，报数只能现算）。合并落地后的口径在
   §8.5：`tests/unit` 全量 **17,750** 用例（其中 CI 那步 15,595 passed / 104 failed）、前端全量
   **528 文件 / 4,826 用例**。这句是更正，不是把上面两行改掉 —— 上面那两行是那笔刀当时的真实读数。
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
   - **Python 下限（2026-10-09 现算，合并必裁）**：`pyproject.toml:6` 我们是 `>=3.10,<3.14`，tip 是
     `>=3.11,<3.14`。取上游那侧 ⇒ **本 worktree 的共用 venv（`.venv/bin/python -V` = `Python 3.10.20`）
     不再满足下限**，合并后所有 Python 读数（`pytest tests/unit`、五道门禁）都要先换解释器；
     副作用是已闭环 46 那一型（命名 `BaseExceptionGroup` 在 3.10 上 NameError）结构性消失，
     连带的 `exceptiongroup` 兜底只剩 `tests/unit/app/test_mcp_stateful_client.py:17-23` 一处。
     取我们那侧则要逐枚验上游 3.11+ 标准库用法，现算 tip：**`import tomllib` 3 处**
     （`checkpoints/policy.py:215`、`portability/providers/codex_schedule_reader.py:13`、`portability/providers/external_state.py:9`）
     · **`from enum import … StrEnum` 8 枚文件** · `except*` **0 处** ⇒ 3.10 上必 `ImportError` 的面是这 11 枚，
     不是全树。未逐枚验它们是否在活跃导入链上。

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

合并前（fork 侧独立可验的刀。⚠ **2026-10-09：下面 1/2/3 三项已全部闭完 ⇒ 合并前刀序清空，下一个动作只能是合并本身**。
判据 105：**"少一枚冲突"不是这类刀的评价标准** —— 落在上游自有文件上的
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
2. **§2 的静默删除引用 = 合并前刀已全部闭完（88 `ae732975e`、89 `358f0e7ba`），剩下 5 对手删只能在合并态里做**。
   §2 重算后"只有我们在引用、且引用者幸存"的枚数是 **0**（旧文的 4 枚真断：两枚是子串假阳性
   `FileTree.module.less` / `SortableAgentRow.tsx`，两枚真断已由 88/89 补掉）。
   5 对落点全部是**上游自有、且我们改过行**的文件 ⇒ 按判据 105 归"取上游字节 + 手删我们那几行"，**不排合并前的刀**：
   `Agent/Config/components/index.ts`(+1) · `console/vite.config.ts`(+25/−2) ·
   `agents/react_agent.py`(+76/−40，两行 mixin import) · `app/routers/__init__.py`(+16)。
   刀 88 读数（落在 fork 自建 `console/vitest.config.ts`，册外）：前端全量 78 文件 / 491 用例 rc=0（负载 8.32，57.80 s）、
   `tsc -b --force` rc=0、五表逐键与刀 87 相同、四道门禁绿且 locale 串逐字不变。
   刀 89 读数（落在 fork 自建 `tests/unit/app/test_workspace_memory_backend.py`，册外）：本文件 3 条通过、
   证红 = 把配对翻转后 1 条失败（非空转），`pytest tests/unit` 3,432 passed / 1 failed，那 1 条
   （`test_knowledge.py::test_project_scoped_memify_jobs_are_isolated`，404≠200）单跑 1.41 s 绿、整文件 81 条绿
   ⇒ 属刀 86 / 条目 83 ⑪ 的负载敏感那一族，不能归到本刀。
   ⚠ 归因教训（新判据 107，见 §7 末）：全量计时类的红**必须两态同负载各测一次**才能归因 —— 第一次 2 红 / 1 绿
   的对比是在负载 26 与 8.32 之间做的，把 stub→SDK 这一改动误判成超时元凶；
   第二次 stub 全量在负载 26 同样红（该条用例在安静时 12,724 ms、负载下 21,831–22,317 ms，
   上限是 `testTimeout: 20000`）⇒ 那次 2×1 作废。
3. **五表里已被标为待重放的两笔（已闭环 40、46）= 用例早已存在，合并前工作量 0**。
   2026-10-09 现数：`tests/unit/app/test_mcp_oauth_injection.py` 4 条 + `tests/unit/app/test_mcp_stateful_client.py` 7 条
   = **11 条**，现树 `pytest` 两文件 **11 passed / 0.18 s**；两枚文件都是 fork 自建（分叉点与 tip 各 `git cat-file -e` 全失败）
   ⇒ 合并不会动它们，**不需要"先把用例写红"**。
   真正的合并态工作是**这 11 条钉在即将消失的宿主上**：两者分别 `from qwenpaw.app.mcp.manager import MCPClientManager`
   与 `from qwenpaw.app.mcp import stateful_client`，而 `app/mcp/{manager,stateful_client}.py` 在 tip 不存在
   （只剩 `__init__.py config_service.py schemas.py`）⇒ 按裁决 2 接受删除之后，11 条全变 collection error，
   守卫恰好在需要它重放的那一刻消失。归并后清单第 6 项：4 条 OAuth 用例重指 `drivers/credentials/bindings.py` +
   `adapters/mcp_card_builder.py`，并按 §4(b) 那张表**先裁两处合同分歧**（过期不注入 vs 过期即刷新；令牌覆盖手动 header vs 有 authorization 就不注入），
   再决定 7 条 helper 用例是重指 `_is_401_error`/`_is_transport_error` 还是随宿主同删。

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
`npm install` 会产生什么差异没验；§2 已换成**逐 import specifier 解析**（不再是字面计数），但它仍只看
代码里的说明符：**模板串拼出来的路径、`importlib` / 运行时动态加载、以及测试配置里的字符串（alias 值与
`exclude` glob）都不在它的作用域里**（判据 108）；**§4(a) 符号表只证明"上游有同名符号的宿主"，没证明它的行为合同与我们那份等价**（`query_error_resilience` 那一枚最需要这一步：上游有
`call_with_overflow_recovery`，但它覆盖不覆盖已闭环 57 的全部情形，要在合并后用用例验）；
**§4(b) 的 MCP 两笔已于 2026-10-09 补做到合同级**（判据 112：接替者找到、且量出两处方向相反 ⇒ 这两处是合并后必红的，
红得有依据）；runner 12 枚与 `query_error_resilience` 仍停在"同名宿主存在"这一级。
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
- **判据 106（判"无人引用"要同时覆盖 Python 的无引号 import 形式）**：第一版闭包脚本只匹配
  引号里的 specifier（`from "x" import` / `import("x")` / `require("x")`），于是
  `from .adbpg_memory_manager import …` 这类**模块名不在引号里**的 Python 形式整类漏检。
  同一族错在 §2 旧读数的另一侧（按基名匹配又造出假阳性）⇒ 一次"静默删除 0 断裂"的结论要求
  **两种匹配各错过一次之后**才成立，别把第一版脚本的读数当结论。
- **判据 107（全量计时类的红必须同负载两态对照才能归因）**：本机 VS Code renderer 在 292%/100% CPU、
  load average 26 时跑全量，与 load 8.32 时跑同一份代码不是同一个实验。第一次的"2 红 vs 1 绿"
  把改动（stub→SDK）认成超时元凶；第二次 stub 在负载 26 同样红 ⇒ 该对比作废。
  这条尤其适用于**靠 `testTimeout` 兜住的粗用例**：实测同一条在安静时 12,724 ms、负载下 21,831–22,317 ms
  ⇒ 20,000 ms 的上限**在负载下不成立**，"全量绿"这个验收口径本身是负载依赖的。
- **判据 109（"合并后全套绿"不是成果守住的证明，两类守卫各自失效）**：fork 自建的守卫文件钉在即将消失的宿主上时，
  裁决 2 落地后它们从"用例红"变成"收集红"（§6 第 3 项那 11 条即是）—— 仍然报红，但**报的不再是行为**；
  反过来，只存在于册内行数为证据的符号（一句 import、一个分支、一条错误消息）消失时**一条用例都不会红**。
  所以合并验收要逐枚点名符号：刀 89 的"钉住一枚后端名"改写成"枚举注册表并要求每个注册名解析到各自的类"是一型，
  §6 第 3 项那 11 条重指到新宿主是另一型。
- **判据 110（同一宿主上，我们的在册行是待移植的小集，不是要保护的文件）**：现算 `src/qwenpaw/config/config.py`
  —— 册内读 **+73/−3**（我们相对分叉点 `e111ec6fb` 的字节），上游 base→tip 同一枚路径读 **+2,190/−407**
  ⇒ 合并时这一枚是大规模内容冲突，正确动作是把**那 73 行**逐 hunk 移植进上游重写后的文件，
  而不是"保住这份文件"。凡是两侧数字差一个数量级的宿主都属于这一型，逐块判的靶子应该是我们的行，不是文件。
- **判据 111（排刀前先核"待办"是不是已经做完）**：§6 原第 3 项写着"现在能先把回归用例写红"，
  现数两枚文件里 11 条用例早就在（刀 40/46 的产物）⇒ 合并前工作量为 0，差点按旧措辞开一把重复的刀。
  这条待办的**真**内容换了个方向：fork 自建的守卫钉在即将消失的宿主上，合并后全变 collection error，
  守卫恰好在需要重放的那一刻失效 ⇒ 待办项的措辞要用现树核一遍再排。
- **判据 112（接替者要逐枚比合同方向，同名符号存在 ≠ 等价）**：`_process_plan` 那类"同名但语义已改"
  是一层，OAuth 注入是另一层 —— 上游的接替机制两条都与我们相反（过期**刷新** vs 我们**不注入**；
  手动 header 已存在时**整个不注入** vs 我们**令牌覆盖**）。判据 104 让人去找接替者，112 要求找到之后
  再问"它对同一输入的分支走向是不是我们那条"，否则合并后红的是断言而不是差异。
- **判据 108（合并时 fork 自有的配置文件是静默删除的落点，不是豁免区）**：合并只会动上游自有文件；
  一份**fork 自建、上游看不见**的配置（本例 `console/vitest.config.ts`）在合并后原样留着，
  它指向的上游文件却可能被删 ⇒ 断点恰好长在这类文件里，而它既不在冲突表里、也不在任何"取上游字节"的动作里。
  反向同样成立：改这类文件**不减少任何冲突**，所以它的价值只能用"合并后是否仍指向存在的路径"来评。

相关账目：已闭环 84–86（判据 84/85/86 原文在 `2026-10-07-trial-merge-conflict-table.md`）、
已闭环 40、46、56、57、75、79–81、83–86、**87（`54bb86bc8` AnywhereChat 摘 plan 用点）、
88（`ae732975e` 测试 alias → 已安装 SDK）、89（`358f0e7ba` 后端注册表用例改枚举）、
90（本节 §6 第 3 项结清：MCP 两笔的接替者与合同分歧，判据 111/112）**。

---

## 8. 合并已落地（2026-10-09）：分叉点换轨、12 笔修复、五类读数

**取数基线**：`HEAD = 2f85a4e06`，分支 `sync/upstream-20261009`（基点 `wp/integration`），
worktree `/Users/futuremeng/github/futuremeng/CoPaw-sync-upstream`。
**已推 `origin/sync/upstream-20261009`**（本地与远端逐位相等），**未开 PR**，**`main` 未动**。

### 8.1 合并本身

合并提交 `0172730bd`，第一父 `5d5c0d572`（§6 刀序的最后一笔），第二父 = 上游 tip `ddd8408eb`。
四项裁决（§6）全部按原样落地：一次合到 tip、跟着上游删、按定义符号找接替者、换新分叉点重立基线。

**分叉点自此变更：`e111ec6fb` → `ddd8408eb`。** `scripts/check_p1_invariants.py:32 DEFAULT_BASE_REF`
已改；`copaw_brand.json` 与 `p1_baseline.json` 由现跑 `--target-ref working` 重生成（不手改）。
任何还在拿 `e111ec6fb` 当基线的读数都是过期口径，包括本文 §1 与 §3。

一处合并意外：**干净自动合并会把两边并成比双方都大的文件**。`app/routers/agents.py` 分叉点 600 行、
我们 4,325 行、上游 2,154 行，自动合并产出 **5,941 行且零冲突**。合并后专门查了重复 `def` 与重复
route（`sort | uniq -d` 两项皆空），但语义等价性没法离线验 ⇒ 判据 113。

### 8.2 合并后的 12 笔修复

| 提交 | 做什么 | 账目代价 |
| --- | --- | --- |
| `9c2f21020` | P1 账册在新分叉点重立基线 | 见 8.3 |
| `2cd093a5e` | locale 门禁的语言注册扫描跟着上游搬到 `constants/languageList.tsx`，并按调用点作者重新推豁免 | 判据 115/116 |
| `1a616ca41` | rpa：我们的 browser tool import 跟随上游搬家进 `deprecated_browser/` | fork 自有文件 |
| `9e697987f` | desktop 用例改钉它真正调用的 `get_stable_port` | fork 自有文件 |
| `796c48db5` | 退掉钉 `app/runner/*`（上游整族删除）的 fork 守卫，**35 条** | 裁决 2 + 判据 109/114 |
| `9ffe804a5` | 退掉钉 `app/mcp/{manager,stateful_client}.py` 的 fork 守卫，**16 条 / 4 枚文件** | 同上 |
| `7db324f44` | MCP probe-status 端点按裁决"在上游驱动层重建"＋ 5 条用例重指 | **一枚上游自有文件都没动 ⇒ 冲突面零增长** |
| `e195c60c6` | `unit-tests.yml` 改装 `".[dev,test]"` | 判据 120 |
| `00e1fd423` | `npm install` 重生成 `console/package-lock.json` | 判据 117 |
| `d25fdd255` | 配套把锁文件登记为 mechanical 在册行 | mechanical 0 → **1** |
| `399c79996` | autouse 配置隔离夹具的落点搬出用例自己的 `tmp_path`，守卫用例改按 `getbasetemp()` 断言 | 判据 124 |
| `2f85a4e06` | 21 条双替身断言改成 agentscope 2.x 的对象形状（5 枚 fork 自有文件 / 25 处） | 判据 127/128 |

`7db324f44` 有一处**与旧行为明示不同**：旧 docstring 承诺"reconnecting it when it is not connected"，
新的 `DriverManager.refresh_driver` 只在保存的 card 变了才重载 ⇒ **不再强制重连已掉线的客户端**
（更重的公开替代是 `reload_driver`）。这是裁决 3 找接替者时量到的合同分歧（判据 112 那一型），
不是漏掉的 bug。

### 8.3 新基线读数

现数（`--target-ref working --json`，`d25fdd255` 之后）：

**108 文件 / +10,771 −519 / 行为 107 文件 / 命名 1·7·35 / mechanical 1**

对照旧口径（`e111ec6fb` 基线，刀 83 之后）：145 文件 / +13,742 −2,322。**降幅全部来自分叉点换轨**
—— 上一轮我们相对 `e111ec6fb` 的入侵行里，有一大半已经被上游自己吸收或重写了；这不是"还掉的真债"，
是量尺换了（判据 125）。

⚠ `console/package-lock.json` 在上游存在 ⇒ 是 upstream-owned，任何一次 `npm install` 重生成都会让
`--check` 报 `NEW upstream-owned file touched` ⇒ **每把重生成锁的刀固定配一笔重立基线**（判据 117）。
`totals.files = behavior 107 + naming 1`，机械行不计入文件数（判据 101）。

### 8.4 环境（读数解锁的前提）

合并后 `pyproject.toml` = `>=3.11,<3.14` + `agentscope[model-ollama]==2.0.9` ⇒ 共用 venv
（py3.10.20 + agentscope 1.0.20）对本 worktree **不可用**，系统 python 3.14.4 又超上限。
专用 venv `/tmp/copaw312`（py3.12.11 + agentscope 2.0.9 + mcp 1.30.0 + pytest 9.1.1，
`uv pip install -e ".[dev,test]"`）是**唯一被授权**的验证环境；不要往共用 venv 里 `pip install -e .`。
`agentscope-runtime 1.1.6.post2` 是手动补装的（判据 122：上游打包缺口，未改仓库）。

`console/node_modules` 已装，`npm ci --dry-run` 无 EUSAGE。
能离线取的 5 道门禁全绿：locale split（4,658 gated / 59 模板族 / 7 豁免 / 1,459 overlay 叶 / 23 上游键豁免）
· P1 `--check` · brand verify（7 文件 / 35 行）· release channel R1–R5 · CI command targets（16 命令 / 3 目录）。

### 8.5 五类读数（2026-10-09，`/tmp/copaw312` + `console/node_modules` 现取）

| 读数 | 现数 |
| --- | --- |
| CI 那步 `tests/unit --ignore=tests/unit/channels` | **104 failed / 15,595 passed / 27 skipped / 4 xfailed / 0 collection error / 1,216.64 s** |
| CI 一直 ignore 的 `tests/unit/channels` | **2,019 passed / 1 skipped / 0 failed / 123 s** ⇒ 全 `tests/unit` = **17,750 用例** |
| CI 唯一 must-pass 那步（L1 硬门禁 5 目录） | **1,336 passed / 1 skipped / 0 failed / 29 s** ⇒ 必过门是绿的，104 条红落在 `continue-on-error: true` 那步 |
| `console` `test:run` 全量 | **528 files / 4,826 tests ⇒ 22 files / 32 tests 红**，889 s |
| `tsc -b --force` | exit 2、**19 errors / 12 files** |
| prettier `--check` | **144 枚脏**，逐枚归属 **0 枚与上游逐字节相同**（134 fork 自有 + 10 fork 改动）；全仓无 workflow 跑它 ⇒ 本地口径（判据 126） |

104 条按**测试文件作者**分：UPSTREAM_UNCHANGED 15 枚文件 / 67 条 · FORK_ONLY 10 / 30 ·
FORK_MODIFIED 4 / 5。簇：最大 27 条（见 8.6）、~~21 条 `'TextBlock' object is not subscriptable`~~
已由 `2f85a4e06` 结清（21 passed / 1 xfailed）、14 条 `qwenpaw update`（11 上游自有 + 3 我们的 overlay 守卫）、
9 条 providers、6 条负载依赖、其余零散。

vitest 32 条红分：7 条超时（6×20,000 ms + 1×15,000 ms，用例耗时 14,449–25,079 ms ⇒ 判据 107 那一型）、
5 条 `open_external_link` spy 参数（上游自有）、6 条 `@agentscope-ai/chat/lib/…` 深层路径（fork 自有，
判据 108 那一型）、`i18n.test.ts`（上游自有）报我们的 **overlay 命名空间漏进了上游对资源表的精确断言**、
`/copaw-icon.svg` vs `/online.svg` 是品牌覆盖撞上游用例。

### 8.6 三簇合并砍掉的宿主：三簇都已裁并落地

`src/qwenpaw/app/runner/`（23 枚文件）与 `src/qwenpaw/app/mcp/{manager,stateful_client}.py` 整族被上游删除，
我们对它们的在册改动**没有**重放到接替宿主（实测 `AgentRunner`、`MCPClientManager`、
`_truncate/_compact/_paginate_chat_history_messages`、`normalize_in_memory_memory_state` 等 11+ 枚符号
在 `src/` 零命中）。悬空引用实测：`tests/` 25 处 / 9 枚文件（8 枚 fork 自建、1 枚上游自有自带
`importorskip`）；`src/` **不是 0 处，是 1 处** —— `app/routers/mcp_runtime_status.py:15`
引用了上游删掉的 `_build_client_info`，而这枚宿主由 `app/routers/__init__.py` 注册 ⇒ 一次踩出
**56 条 collection error**。`7db324f44` 修掉后收集数 = **15,725 / 0 error**。

**唯一需要用户裁决的一笔 = 那 27 条**。`tests/unit/app/routers/test_workspace_router_agent_surface.py`
与上游 tip 逐字节相同、27 条全红（判据 123 的实测型），根因是 fork 自有 helper
`src/qwenpaw/app/routers/workspace.py:2352 _resolve_workspace_target` 走
`get_loaded_agent_for_request` / `resolve_agent_id_for_request` 读 `request.state`，绕开了上游 tip 同文件
`:195` 的 `await get_agent_for_request(request)`；上游用例打的是后者的替身、并传 `SimpleNamespace()`
当 request ⇒ 生产侧 `AttributeError` 被路由自己的 `except Exception` 吞成 500。
**价签**：这笔在册 +96/−54 的侵入 = 27 条上游用例。
两条路：(a) 把 helper 收回上游的 `get_agent_for_request` 合同（减侵入，代价是要重放我们靠它做的事）；
(b) 改上游那枚用例（冲突面 +1 枚文件，性质是"为绿而改上游测试"）。
**已裁 = (b)**，已落地 = 刀 94（见 8.9）。(a) 的代价在开刀前量过：`get_agent_for_request` 会
`await manager.get_agent(...)` ⇒ 强制拉起 workspace，而 fork 的解耦（`d3c8508b9` 2026-05-12、
`553f592ec` 2026-05-18）正是为了避免它；现树 29 个生产调用点分布在 6 枚上游自有路由
（workspace 13 / config 6 / knowledge 6 / agent 2 / providers 1 / flows 1），收回合同等于撤掉这项解耦。

### 8.7 本笔新增判据 113–128

- **113（干净自动合并会把两边并成比双方都大的文件）**：见 8.1。大宿主合并后要专门查重复定义与重复注册，
  而"零冲突"不等于"语义正确"。
- **114（"跟着上游删"会把 fork 自建的守卫用例留在原地）**：宿主删了，钉它的测试不会冲突、只会变
  collection error ⇒ 接受 modify/delete 的同一笔里就要跑一遍 import 解析。补测：字符串型 patch 目标
  （`patch("a.b.C.d")`）不会有 import，要单独扫；扫出来先问"定义体在哪枚文件"、再问"这条用例是不是本来就
  skip"。合并后字符串目标净新增悬空 = 0。
- **115（fork 写的门禁若按正则读上游文件的"形状"，上游一搬家就把上游整包报成缺文案）**：locale 门禁在
  `LanguageSwitcher/index.tsx` 抓 `key: "<lang>"`，上游把表搬进 `constants/languageList.tsx` ⇒ 一门语言都
  "没注册"，一次红 59 条。修法要保留"两处都没有才算缺"。
- **116（同步后的门禁红先按调用点作者归属，再按文案归属）**：24 枚缺键里 23 枚、8 个模板族里 6 个都在
  上游自己写的行上；补我们的文案会盖掉上游文案。其中 3 枚（`common.saveFailed`/`common.selectAll`/
  `hub.errors.loadFailed`）上游今天在渲染裸键路径 ⇒ 那是上游的缺。
- **117（`package-lock.json` 不能手工合）**：取上游字节 + `npm install`；代价固定 = 一笔 P1 重立基线。
- **118（"我们的文件与上游逐字节相同"这种比法只看两边都存在的文件，fork 自建宿主天然在比较集外）**：
  真断在那儿的 `mcp_runtime_status.py` 是我们新建的文件，逐字节 cmp 永远看不到它坏了。
- **119（只走 `tests/` 的 import 检核器不能支撑一句关于 `src/` 的结论）**：检核器要用**已知会红的宿主**
  校准过才能报数。
- **120（上游重装 extra 会静默抽走 fork CI 的测试依赖）**：2.x 把 pytest 一族从 `[dev]` 挪进新的 `[test]`；
  `unit-tests.yml` 是我们自有工作流、只装 `.[dev]` ⇒ 合并后 CI 连 pytest 都不装，而上游自己的 `tests.yml`
  不会红。要比的是"extra 定义变了、我方装法还成不成立"。
- **121（"什么都没收集到就大声失败"那步只看 `N tests collected` 会不会出现，踩不住收集错误）**：
  56 条 collection error 时 pytest 照样打印 collected 行数 ⇒ 那道门禁绿着通过。破面要单独断言 error 计数为 0。
- **122（`agentscope_runtime` 是上游没声明的依赖，不是我们的债）**：全仓唯一 importer 是
  `app/routers/agents.py:88`，它不在任何 extra、也不在任何工作流里 ⇒ 上游打包缺口。
- **123（上游逐字节相同的测试文件成片红，第一嫌疑是我们对同一宿主的在册侵入，不是上游坏了）**：
  116 的镜像面 —— 合并后"谁的红"按**宿主被我们改过没有**归属。
- **124（autouse 隔离夹具不能把状态目录建在用例自己的 `tmp_path` 里）**：`tmp_path` 对产品代码就是一枚
  可见的工作区目录 ⇒ 17 条枚举工作区的用例把自己的 fixture 当成了被测内容。落点用
  `tmp_path_factory.mktemp()`，守卫用例改按 `getbasetemp()` 断言。
- **125（新分叉点会让所有历史基线数字作废，报数只能现算）**：`pytest tests/unit` 3,433 → 17,750、
  前端 78 文件/491 用例 → 528 文件/4,826 用例。
- **126（脏度读数没有 CI 读者时只是本地口径）**：prettier 144 枚脏、全仓零 workflow 跑它 ⇒ 不是合并阻塞；
  但"0 枚上游逐字节相同文件脏"这一半是有用的归属证据。
- **127（用例注入的 ContextVar 和解析器读的 ContextVar 可以不是同一枚 ⇒ 形状修完仍红时先比"注入点 vs 读取点"）**：
  `test_file_io_realtime_events.py` 钉的是 `set_current_focus_dir`，而现树 `write_file` 的相对路径解析
  （`_effective_project_roots()` → `get_all_project_dir_paths()` / `get_tool_base_dir()`）不看 focus dir。
  取证法 = `git show <写用例那笔提交>:<宿主文件>` 拿当时的解析合同和现树对读。机制退役后留在树里的 setter
  （这里只剩 `agents/utils/file_handling.py:118` 一个读者）会让用例伪装成生产回归。
- **128（agentscope 2.x 的 `TextBlock` 是 pydantic 模型不是 dict ⇒ 断言按现树多数形状，纯形状改、断言强度不动）**：
  `tb["text"]` → `TypeError`、`tb.get()` → `AttributeError`，正解 `tb.text`；现树 36 枚测试文件已在用
  `content[0].text`，所以改的是跟随多数。判"双替身过期"要能一句话说清"哪一侧的字节变了"。

### 8.9 刀 94：那 27 条按裁决 (b) 落地（`565452cd1` + 账 `0f8f5706f`）

**改了什么**：`tests/unit/app/routers/test_workspace_router_agent_surface.py` 加一枚模块内 autouse 夹具
（+23/−1），把 fork 多出来的那次查找接回用例自己装的替身 —— `get_loaded_agent_for_request` 返回
`ws.get_agent_for_request.return_value`，即"这条用例准备给上游那枚入口的对象"。断言零改动，
33 个 `patch.object(ws, "get_agent_for_request", …)` 用点零改动，12 个仍走上游入口的调用点零改动。
另两处是 fork 自身合同要求：`_validate_and_extract_zip` 的替身要返回变更路径列表（fork 的
`upload_workspace` 把它转交 `record_project_realtime_paths`，上游不用返回值），以及
`put_agent_language` 不再 `str(workspace_dir)` —— `copy_workspace_md_files` 收 `Path | str` 且第一行就
`Path(...)` 包回来，而上游用例钉的是 Path。

**实测（同机同负载两态对照，判据 107）**：把两枚文件临时退回 HEAD 字节跑一遍、再换回来跑一遍，
同一选择集 `tests/unit/app/routers/ + tests/unit/app/test_agents_workspace_initialization.py`：

| 态 | 红 |
| --- | --- |
| 改前 | **42 failed / 1,333 passed / 121.75 s**（其中本文件 27 枚、其余 15 枚） |
| 改后 | **15 failed / 1,360 passed / 110.31 s** |
| 本文件单独 | 27 failed → **60 passed** |

⇒ 净 −27 = 恰好这笔簇，15 枚非本簇红逐枚同名 ⇒ 零连带。那 15 枚已按机制分派，见 8.10。

**账**：P1 从 108 文件变 **109 文件 / +10,794 −520 / 行为 108 文件（invasive +10,759、deleted −485）/
命名 1·7·35 / mechanical 1**。`--check` 先红（`NEW upstream-owned file touched` + 四项 grew）、
`--write-baseline` 后绿。冲突面自此 **+1 枚文件** = 裁决 (b) 认下的价。
其余四道离线的门禁逐字未动：locale split（4,658 gated / 59 模板族 / 7 豁免 / 1,459 overlay 叶 /
23 上游键豁免）· release channel R1–R5（6 文件）· CI command targets（16 命令 / 3 目录）·
brand verify（7 文件 / 35 行）。flake8 对两枚被改文件只剩一枚预红 E203（`workspace.py:388`，不在改动行）。

**申报一处削弱**：两条 `resolver.assert_not_awaited()`（"拒绝发生在任何 workspace 查找之前"）在本夹具
落地后只钉得住上游那枚入口 —— fork 侧的查找不再被断言。它们仍绿，但守卫力变窄，这是把桥放在用例侧
而非生产侧的固有代价。

### 8.10 剩下的 15 枚红：按枚取栈后的归因（本笔已复算，替掉本节原先的按簇预判）

原先这三行是按报错文本猜机制写的分派表。取到栈之后有两处判错了，下表是实测版。

| 枚数 | 落点 | 实测根因 | 归属 |
| --- | --- | --- | --- |
| 4 | `test_config_router.py`（上游逐字节相同） | **与 8.6 同根因**（原判"非解析层"是错的）：fork 把 `list_channels`/`get_channel`/`put_channels`/`put_channel` 改走 `resolve_agent_id_for_request` + `load_agent_config`（读盘），写侧再镜像进 `get_loaded_agent_for_request`；用例只钉上游那枚 `get_agent_for_request` ⇒ 读写都落不回替身，且那条"查找失败要 404"在上游入口上 | 测试侧桥，形状复用 8.9；404 那枚改钉 fork 入口（fork 侧同样会抛 404，只是不在 `get_agent_for_request` 里） |
| 7 | `test_providers_active_openrouter.py`（上游逐字节相同） | **另一型**：fork 新增的生产钩子 `_preflight_model_slot`（`providers.py` 在册 +43/−8）在 `activate_model` 之前调 `provider.support_connection_check` → `await provider.check_model_connection(...)`；上游替身是 `MagicMock()`，前者恒真、后者不可 await ⇒ `TypeError: object MagicMock can't be used in 'await' expression` | 测试侧：替身要显式声明"这枚 provider 不支持连接检查"，因为上游用例从没有意图要测这钩子 |
| 1 | `test_providers_active_openrouter.py::TestGetActiveModels::test_effective_scope_prefers_agent_model` | 解析层：`_load_agent_model` 现在按 agent id 读盘，而 `resolve_agent_id_for_request(request)` 拿到的是 `MagicMock.state.agent_id` ⇒ 生产侧 404 后回落全局槽 | 测试侧桥 |
| 1 | `test_providers_router.py`（**fork 自建文件**） | 我们自己的账：用例 `monkeypatch.setattr(providers_mod, "save_agent_config", …)`，而该模块已不再导入这个名字 | 改我们自己的用例，零冲突代价 |
| 1 | `test_agents_router.py::test_get_agent_returns_404_for_app_base_exception` | **生产侧**，不是解析层：合并后的 `agents.py` 把 `AppBaseException` 绑了两次（上游 `qwenpaw.exceptions` 在 `:19`、我们那行 `agentscope_runtime` 在 `:88`），**后写的赢** ⇒ 文件里 5 处 `except (ValueError, AppBaseException)` 抓的是第三方那枚类，上游的 404 合同在现网答 500 | 生产侧，刀 95 已修（见 8.11） |
| 1 | `test_workspace_router.py::test_language_change_schedules_agent_reload`（上游自有、已在册 +99/−1） | 与 8.6 同型：`put_agent_language` 走 `_resolve_workspace_target`，替身 `MagicMock()` 的 `state.agent_id` 不在 `config.agents.profiles` 里 ⇒ 生产侧抛 404 | 测试侧桥，复用 8.9 那座夹具的形状 |

⇒ 只有那 1 枚是生产侧、已由刀 95 结清；其余 14 枚是测试侧、已由刀 96 结清（见 8.14；代价 = 再动
2 枚上游自有用例文件（`test_config_router.py`、`test_providers_active_openrouter.py`）+ 1 枚我们自己的文件）。
CI 选择集总量读数也已在这棵树上重跑完（8.14），本节原先那句"仍未重跑"作废。

### 8.11 刀 95：自动合并造出的导入影子（8.10 里那唯一一枚生产侧）

**改了什么**：`src/qwenpaw/app/routers/agents.py` −3 行，删的是我们那行
`from agentscope_runtime.engine.schemas.exception import AppBaseException`（合并后在 `:88`）。
上游的同名绑定在 `:19`（`from qwenpaw.exceptions import AppBaseException`），两边并排落在同一文件后
**Python 按后写的重新绑定** ⇒ 文件里 5 处 except 子句（现树 `:735/:785/:1165/:1363` 的
`except (ValueError, AppBaseException)` 加 `:1461` 的裸 `except AppBaseException`；行号取修后，
删的那三行在它们上面）抓的是第三方那枚类，而 router 抛的是我们自己那枚 ⇒ 上游用例要的 404 在现网答 500。

**这是判据 113 的第一枚实测实例，而且是它最阴的一型**：合并零冲突、自动成功、唯一可见后果是文件变大；
两行都是语法合法的 import，所以"重复定义"这个说法在工具里没有任何一栏会亮。

**全仓扫过一遍才算归因**：AST 只遍历 `tree.body`（模块作用域）取 import 绑定，按**来源**分组
（`pkg:<根包>` / `mod:<点数+模块>`；纯子模块导入如 `aiofiles` + `aiofiles.os` 因此折叠成同一来源，不算影子）。
`src/` 现数（修后）：**39 枚模块作用域同名绑定 → 按来源只剩 2 枚真影子**，加本刀修掉的那枚共 3 枚；
按名字分组的 39 枚里有 37 枚是"同名同来源的重复 import"（自动合并把两边 import 段并起来的形状，行为等价）。
剩下的 2 枚显式豁免在同宿主同文件：
`SkillPoolService`、`get_workspace_skills_dir`（`:58` 上游 `agents.skill_system` vs `:106` 我们保留的
`agents.skills_manager`，我们的在后 ⇒ 现网跑的是**我们那份实现**）。这两枚没顺手翻过来是因为
"上游自有的 router 该跑哪份实现"是产品裁决（上游那份 14/15 方法体不同、还多 4 枚自动化/改名方法），
不是 lint 能定的事 —— 已进待裁队列，见本节末。

**配的门禁**：fork 自有 `tests/unit/test_module_import_bindings.py`（125 行 / 4 条用例 / flake8 rc=0）。
`KNOWN_SHADOWED_IMPORTS` 是豁免池，两个方向都钉（判据 66）：新增影子 ⇒ 红；池里的影子已修却不删条目 ⇒ 也红。
另两条是自证用例（检测器对已知影子必须报出、对子模块导入必须不报），避免"门禁自己坏了却报绿"。

**证红**：拿本刀自己的删除前状态（判据 67）—— `git apply -R` 把那三行装回去 ⇒
`2 failed, 3 passed`，红的正是新守卫那条 **和** 上游那枚 404 用例；`git apply` 换回来 ⇒
文件里 `agentscope` 命中 0、`62 passed`（守卫 4 + `test_agents_router.py` 58）。
两态之间只动了那三行 ⇒ 连带面为零。

**顺带结清判据 122**：那枚 `agentscope_runtime` 导入是全仓唯一读者。修法用 AST 走全 `src/` 树（含函数体内的
import）现证 **0 处** 从 `agentscope_runtime` 根包导入；开刀前另用 `sys.meta_path` 导入阻断器在运行时验过同一件事
⇒ 我们这侧的"上游未声明依赖"不再成立（上游自己仍缺，那是上游的账）。

**两态对照（判据 107）**：同一选择集 `tests/unit/app/routers/` + `test_agents_workspace_initialization.py`
刀 94 后 15 failed / 1,360 passed ⇒ 刀 95 后 **14 failed / 1,361 passed**（本机另有三株隔壁树的 pytest 在跑、
load 18 ⇒ 只报通过/失败数，15 failed → 14 failed 这句是数，97.68 s 那句不是口径）。
14 枚红逐枚同名 ⇒ 转绿的只有一枚，就是 8.10 那枚生产侧，连带面为零。
L1 硬门禁五目录照旧 **1,336 passed / 1 skipped / 0 failed**。
⚠ 取数顺序按判据 136 记清：这两句都在探针之前取（选择集先跑完、之后才 `git apply -R` 装影子证红），
所以它们是最终树上的读数；撤销探针之后重跑的只有守卫用例 + `test_agents_router.py` 那 62 条，
以及 `git diff --stat` 确认那枚文件回到 −3 行的字节。

**账**：P1 **109 文件 / +10,791 −520**（invasive 比刀 94 少 3 行；文件数、行为文件数、命名 1·7·35、
mechanical 1 全部零动）。冲突面 **+0 枚**：`agents.py` 本就在册，新守卫用例是 fork 自有文件。
四道离线门禁读数与刀 94 逐字相同（locale split 4,658 gated / 59 模板族 / 7 豁免 / 1,459 overlay 叶 / 23 上游键豁免
· release channel R1–R5 over 6 files · CI command targets 16 命令 / 3 目录 · brand verify 7 文件 / 35 行）。
`agents.py` 的 F811 由 22 条降到 21 条 —— 剩下的 21 条里没有一条是跨来源影子（同名同来源的重复 import，
行为等价），那是自动合并把两边 import 段并起来的形状，属于"要不要顺手整理上游文件"的另一个问题。

### 8.12 本节新增判据 129–136

- **129（给上游用例加 fork 桥，落点按"未来冲突面"计价，不是按可读性直觉）**：同一需求可以写成 33 个
  `patch.object` 兄弟项，也可以写成 1 枚模块内 autouse 夹具 +23 行；后者把未来合并的冲突集中在**一枚
  hunk**，且 33 个用点与 12 个仍走上游入口的调用点一处不动。
- **130（"同簇同根因"要等桥修完再数一遍才算）**：27 枚红的根因是解析层，但桥落地后仍剩 5 枚 ——
  两类完全不同的分歧（fork 开始消费 helper 的返回值 / fork 多做了一次 `str()` 转型）。把簇当成一笔债
  会漏掉这两笔，也会把 `assert_not_awaited` 那两条的削弱算错。
- **131（桥的取值来自测试自己装的替身 ⇒ 相关否定式断言的守卫力变窄，要申报不要掩盖）**：见 8.9 末段。
- **132（`git reset --soft HEAD~1` 是相对当时 HEAD 的，跨命令重复执行会逐笔往回吞提交）**：撤销自己刚造的
  提交之后，下一条命令必须重新确认 HEAD。本笔实测踩中：连吃两次把已推送的 `be5f3ba7c` 并进了新提交，
  于是本地不再能 fast-forward 到 `origin/sync/upstream-20261009`。复原 = `git diff <被吞提交> <新提交> > 补丁`
  → `git reset --hard <与 origin 逐位相等的那枚>` → `git apply` → 重新提交；内容零丢。
- **133（重复 import 的影子要按"来源"分组，按"名字"分组只会淹在噪音里）**：`from a import X` 与
  `from b import X` 才是事故；`from a import X` 出现两次是自动合并的形状、行为等价。本笔实测：`src/` 里
  按名字收到 39 枚模块作用域同名绑定，按来源只剩 2 枚（+ 已修的这枚共 3 枚）—— 信噪比 39:3。
  中间版本还走过一条弯路：用"父包/子模块算不同来源"的启发式，于是 `urllib` + `urllib.parse` 这类正常写法
  全被报成影子；正解是把 `pkg:<根包>` 折叠成一个键，纯子模块导入因此不算两来源。
  这条尺子的价值有具体后果：`except (ValueError, AppBaseException)` 抓的类**会**因为后写的那行 import 而换掉，
  而两行都是合法语句，任何"读一遍文件"的复核都不会把它当错误。
- **134（按簇预判不算归因，要按枚取栈）**：8.10 的初版是按报错文本猜机制的分派表，六行里两行猜错 ——
  `test_config_router.py` 那 4 枚我判"非解析层"，取栈后它与 8.6 **同根因**；`test_agents_router.py` 那枚我并进
  解析层，取栈后它是**生产侧**且是全仓唯一一枚生产侧。猜错的代价不是文档不准：按簇排刀会把 4 枚已经修好的
  桥再排一遍，同时漏掉那枚会让现网答 500 的 bug。
- **135（门禁的豁免池是"待裁登记表"，不是 suppress 列表，而且必须双向钉）**：每条豁免带"为什么现在不能改"
  与去向（本池两条写的是"fork 版 vs 上游 `skill_system`，等待裁"），并且配一条反向用例 —— 池里的影子已修却不删
  条目同样报红。单向豁免池会静默长大，这是判据 66 在门禁数据结构上的形态。
- **136（全量读数不能与临时补丁探针并发；撞上了只能停掉重跑）**：本笔先起了后台 `pytest tests/unit`，随后为了
  证红把三行影子 `git apply -R` 装回去约 90 秒。窗口极短、也不是每个用例都读那枚模块，但这个读数已经不能
  作为"最终树上的读数"上报 ⇒ 杀掉重跑。判据 89 说的是"最后一次编辑之后整体重跑"，这条是它的时间面：
  探针编辑与采集必须在时间上分离，哪怕探针最后撤销干净了。

### 8.13 没量什么

- ~~**CI 选择集复跑未取**~~ —— 已由刀 96 结清：现数 **40 failed / 15,664 passed**，见 8.14。
  原先这里写的"理论 76"（以及按 8.10 再减 14 得到的 62）都是推导值，与实测差 22 枚（判据 139）。
- **真浏览器 `copaw app` 一笔仍欠**（混淆项：`QwenPew Desktop.app` 会写 `~/.copaw/config.json`）。
- **144 枚 prettier 脏一个 `--write` 都没跑**（判据 63：预红文件不在本轮顺手格式化）。
- `pip install "mcp<1.28"`（`unit-tests.yml:78`）能不能去掉未判：pin-free venv 用 mcp 1.30.0
  收集 15,725 / 0 error。

### 8.14 刀 96：8.10 那 14 枚测试侧红全部结清（`c4db29af5` + 账 `c24891ac1`）

**改了什么**：四枚用例文件、+122/−17 行，生产侧一枚未动。

| 文件 | 落点 | 形状 |
| --- | --- | --- |
| `test_config_router.py`（上游逐字节相同 → 新增册宿主） | 4 枚 | 一枚模块 autouse 夹具把 fork 那两次查找（读盘的 `load_agent_config`、写侧镜像 `get_loaded_agent_for_request`）交回用例自己的替身；别的 agent id 一律落到真实现，桥因此越不过用例装的那枚 agent。404 那枚不装替身 |
| `test_workspace_router.py`（已在册） | 1 枚 | 一枚 hunk：`get_agent_for_request` 换成 fork 真正 consult 的 `get_loaded_agent_for_request`，因此去掉 `AsyncMock` |
| `test_providers_active_openrouter.py`（上游逐字节相同 → 新增册宿主） | 8 枚 | `_manager()` 的 provider 替身显式声明 `support_connection_check = False`（7 枚，钩子据此早退）；`test_effective_scope_prefers_agent_model` 桥一枚 `resolve_agent_id_for_request` |
| `test_providers_router.py`（fork 自有，零冲突代价） | 1 枚 + 1 枚新增 | 那笔已经不存在的 `save_agent_config` monkeypatch 换成 `update_agent_config_async` 的 mutator 替身；新增一枚钉 `_preflight_model_slot` 的**拒绝**分支 |

新增那枚不是顺手：`_preflight_model_slot` 是 fork 造的钩子，上游没有，全仓此前 **0 处**测它那条"provider 声明支持连接检查、且答模型已不在"的分支（上游用例的替身全部走早退）。它现在是这条钩子唯一的用点级守卫。

**两态对照（判据 107，本机低负载时段）**：同一选择集 `tests/unit/app/routers/` + `tests/unit/app/test_agents_workspace_initialization.py` ——
四枚文件退回 HEAD~1 字节 **14 failed / 1,361 passed / 53.75 s**；本笔字节 **0 failed / 1,376 passed / 98.37 s**。
+15 = 14 枚转绿 + 那枚新增用例，两态总数逐位对得上。⚠ 取数顺序按判据 136 记清：后者是在**尚未提交**的工作树上取的，
提交后把字节退回 HEAD~1 再换回 HEAD（`git status` 现为空 ⇒ 与取读数时逐字节相同），并复跑 `tests/unit/app/routers/`
单目录佐证 **1,374 passed / 88.29 s**。撤销那一步的前提与代价见判据 141。

**证红（判据 67）**：把那枚 autouse 夹具临时改成 `autouse=False` ⇒ `3 failed / 65 passed`，红的正是
`test_put_channels_saves_and_triggers_reload`、`test_get_onebot_channel_keeps_reverse_ws_fields`、
`test_put_onebot_channel_stores_a_validated_model`；第 4 枚（404）不依赖夹具 ⇒ 它钉的是生产规则而不是替身。

**CI 选择集第一次在这棵树上重跑**：`pytest tests/unit --ignore=tests/unit/channels` ⇒
**40 failed / 15,664 passed / 27 skipped / 4 xfailed / 0 收集错误 / 1,120.83 s**。
按落点（不是按根因）分组：`cli/test_cli_update.py` 11 + `cli/test_cli_update_overlay.py` 3 = 发布渠道 `pending`
那簇；两枚 migration 文件 6；`test_multi_agent_manager_startup.py` 4；`test_provider_startup_offload.py` 2；
其余 14 枚散在 10 枚文件：`test_acp_available_commands.py` 2、`test_desktop_cmd_exit_code.py` 2、
`app/crons/test_manager.py` 2、`test_openai_stream_malformed_tool_use_compat.py` 2，
`agents/test_fork_project.py`、`app/chats/test_query_error_dump.py`、`app/crons/test_heartbeat.py`、
`test_shutdown_lifecycle.py`、`test_shutdown_deadline_integration.py`、`test_retry_chat_model.py` 各 1。
**这 40 枚与本笔无关的直接证据**：把 16 枚落点文件单取一集（不含本笔任何被改文件）跑，
仍 **40 failed / 333 passed** ⇒ 不是夹具泄漏，也不是顺序污染。

**顺带量到两笔新的生产侧断点（都未在本笔修，见本节末）**：
① `service_manager._run_post_init` 现以三参调用 `post_init(workspace, service, publish_service)`
（`src/qwenpaw/app/workspace/service_manager.py:436`），同宿主文件里的姊妹工厂 `create_driver_config_watcher`
已是新合同；我们那枚 `create_project_knowledge_watcher(ws, _)`（`service_factories.py:341`）仍收两参、
且自己往 `ws._service_manager.services` 里写 ⇒ 每次 workspace 启动抛
`TypeError: create_project_knowledge_watcher() takes 2 positional arguments but 3 were given`（这次 CI 集日志里
现数 4 次启动、每次两种渲染各一行）。**现网后果是那台 project-knowledge watcher 从不运行**。它**不是**上面
那 10 枚 startup/migration 红（6 + 4）的已证根因 —— 那 10 枚的断言各不相同，未逐枚取栈（判据 134 仍欠着）。
② `test_provider_startup_offload.py` 那 2 枚的签名是
`AttributeError: qwenpaw.app._app has no attribute 'ensure_qa_agent_exists'` —— 用例钉的名字在合并后的 `_app.py`
里已不存在，是判据 111 那一型（上游搬家、我们用点幸存）。

**账**：P1 109 → **111 文件 / +10,861 −530**，行为 **110 文件 / +10,826 invasive / −495 deleted**，
命名 1·7·35 与 mechanical 1 零动。新增两枚宿主 = `test_config_router.py`（+50/−8）、
`test_providers_active_openrouter.py`（+15/−0）；`test_workspace_router.py` 从 +99/−1 涨到 **+104/−3**；
`test_providers_router.py` 是 fork 自有、不入册。**冲突面 +2 枚** —— 裁决 (b) 的第二次付费，
两枚都是纯测试侧冲突（未来合并不涉及行为语义争抢）。
L1 硬门禁五目录 **1,336 passed / 1 skipped / 0 failed**。导入影子守卫（刀 95 那枚）**4 passed**。
flake8 对四枚被改文件 **零新增**：7 条与 HEAD 逐条同名（`E501`×6 + `W292`×1），只是行号位移。
其余四道离线门禁读数与刀 94/95 逐字相同（locale split 4,658 gated / 59 模板族 / 7 豁免 / 1,459 overlay 叶 /
23 上游键豁免 · release channel R1–R5 over 6 files · CI targets 16 命令 / 3 目录 · brand 7 文件 / 35 行）。
全量 `tests/unit`（含 CI 一直 ignore 的 channels）在这棵树上另取一次：**40 failed / 17,683 passed /
28 skipped / 4 xfailed** ⇒ channels 那 2,019 枚仍 0 红，40 枚与 CI 集逐枚同名。

**申报一处削弱（判据 131 第二次适用）**：那 3 枚依赖夹具的用例从此只证明"路由把配置交给它问的那两次查找"，
不再证明"读盘 + 写盘的往返"。补这个缺口的不是我新加的用例，而是上游自有的集成测试
`tests/integration/test_channels_config.py`、`tests/integration/test_config_router.py`、
`tests/integration/test_onebot_reverse_ws.py`（三枚都在分叉点在册）—— 它们打真服务器走这些端点，
本轮没跑（要联网环境，见 8.4 那一类）。

### 8.15 本笔新增判据 137–141

- **137（桥与被桥用例打同名属性时必须共用一套撤销栈）**：本笔实测踩中 —— autouse 夹具用 `mock.patch`
  上下文管理器打 `qwenpaw.config.config.load_agent_config`，而同文件那枚 heartbeat 用例用
  `monkeypatch.setattr` 打同一名字。两套撤销栈互相看不见，装与卸的顺序不由"谁后装"决定；结果是夹具那套
  活过自己的模块，把 404 漏给隔壁 `test_tools_router_web_search_config.py` 的 6 枚不相干用例
  （`HTTPException: 404: Tool 'web_search' not found`，且 `agent_config` 是那枚 `MagicMock name='AgentConfig'`）。
  诊断两步就够：先 `-k "not <嫌疑用例>"` 二分投毒者（80 passed / 3 deselected），再拿一枚临时插件打印
  `repr(模块.属性)` 坐实"泄漏的是绑定不是缓存"。修法是把桥整个交给 `monkeypatch`（同一条 `_setattr` LIFO）。
- **138（能给生产规则就别给桥）**：同一簇 4 枚红只有 3 枚需要桥；第 4 枚改成什么都不 patch、
  用不在 `config.agents.profiles` 里的 agent id 打端点 ⇒ 它从"替身被调用"升级为"fork 的解析规则本身"。
  桥的枚数是上界不是下界，逐枚问一遍"这条能不能不靠替身钉住"。
- **139（红数只能跑出来，不能减出来）**：8.13 的"理论 76"、按 8.10 再减 14 的 62、以及本笔实跑的 40 三者对不上。
  差额不可归因（8.5 那次 104 的簇表把后来被别的刀顺手结清的红也计在内，而结清时没往回扣）。
  真正的问题不是数字不准，是那句推导**被写成了一句看起来像结论的话**并被账目引用。
- **140（一集红按落点分组，不等于按根因分组）**：本笔先按"文件枚数"报了 40，再取两枚的报错签名才发现
  其中 2 枚是 `_app` 符号搬家、另有 4 次启动日志是同一枚 TypeError —— 若停在枚数层，那台从不运行的 watcher
  就藏在"startup/migration 10 枚"这一行里。判据 134 说按枚取栈，这条补它的另一半：**取了栈也别反过来把
  同宿主的枚并成一个根因**，那 10 枚的断言各不相同，未证。
- **141（`git checkout <ref> -- 路径` 在"内容已提交"前提下才是安全的探针撤销）**：那条禁用 checkout 的规则
  成因是未提交工作会被吞；本笔先把内容提交、再退回 HEAD~1 字节取"改前"读数，工作树与 HEAD 逐字节相等，
  于是 checkout 是最短且可验证（`git status` 空）的撤法。写清前提，否则下笔要么误用、要么该用时绕远路。

**待办（本笔新登记，不在刀序里）**：① 上面那枚两参工厂 `create_project_knowledge_watcher`（生产侧，
一行签名 + 改 `publish(watcher)`，配一枚真起 workspace 的用例）；② `_app.ensure_qa_agent_exists` 的
符号搬家 2 枚；③ 发布渠道 `pending` 那 14 枚要等阶段 2 的 PyPI/Docker 真上线才结，不是测试侧的账。

相关账目：本节 = 已闭环 **96**（刀 94 = 8.9 那笔，裁决 (b) 的落地；刀 95 = 8.11 那笔，8.10 里唯一一枚生产侧；
刀 96 = 8.14 那笔，8.10 里其余 14 枚测试侧）；
判据 113–128 原文在本节 8.7、129–136 在 8.12、137–141 在 8.15（§1–§6 引用的 84–86、101–112 仍是
`2026-10-07-trial-merge-conflict-table.md` 与本文前七节的口径）。


**待裁（本笔新登记，不在刀序里）**：`SkillPoolService` / `get_workspace_skills_dir` 那对影子 —— 现网跑的是我们
保留的 `agents/skills_manager.py` 那份（14/15 方法体与上游 `agents/skill_system/` 不同，上游另多 4 枚自动化/改名
方法）。要么按裁决 2 跟着上游删、把 `agents.py` 的 import 翻到 `skill_system`，要么留我们那份并承认这是 fork
自有能力。这需要产品侧一句话，不是合并能自动答的。
