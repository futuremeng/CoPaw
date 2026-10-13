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
| prettier `--check` | **144 枚脏**，逐枚归属 **0 枚与上游逐字节相同**（134 fork 自有 + 10 fork 改动）；全仓无 workflow 跑它 ⇒ 本地口径（判据 126；**⚠ 2026-10-11 更正**：prettier 钩子存在但 `exclude` 掉 `console/`，这 144 枚正住在被排除的那棵 ⇒ 结论不变，措辞按判据 162 换）|

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
- **126（脏度读数没有 CI 读者时只是本地口径）**：prettier 144 枚脏、~~全仓零 workflow 跑它~~ ⇒ 不是合并阻塞；
  但"0 枚上游逐字节相同文件脏"这一半是有用的归属证据。
  **⚠ 2026-10-11 刀 102 更正措辞，结论照旧**：`pre-commit.yml` **是有 prettier 钩子的**（判据 162 那个两跳漏判的同一处），
  只是钩子 `exclude: '(?x)(^web/|^console/|/dist/|…)'` 把 `console/` 整棵排除，而那 144 枚脏全在 `console/` 里 ⇒
  "**这 144 枚**没有 CI 读者"成立，"仓库没有 prettier 门禁"不成立（钩子的选择集现数 **363 个 ts/tsx 文件**，CI 判 Passed）。
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
现数 4 次启动、每次两种渲染各一行）。~~**现网后果是那台 project-knowledge watcher 从不运行**~~ —— **这句写轻了，
刀 97 取栈后更正**：那枚描述符没有 `optional=True`（`workspace.py:655-668`），`_run_service` 因此重抛
（`service_manager.py:331` 记 `Failed to start service`、`:336` 抛）⇒ 代价是**整个 agent 实例启动失败**
（`workspace.py:751` 记 `Failed to start agent instance`），CI 集日志里 4 次真启动 4 次全灭。同一笔取栈也结清了
下半句：那 10 枚 startup/migration 红（6 + 4）**不是**这枚 TypeError 造成的 —— 本笔修好后它们照旧红（见 8.16）。
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
  其中 2 枚是 `_app` 符号搬家、另有 4 次启动日志是同一枚 TypeError —— 若停在枚数层，那台把整实例启动拖掉的 watcher
  就藏在"startup/migration 10 枚"这一行里。判据 134 说按枚取栈，这条补它的另一半：**取了栈也别反过来把
  同宿主的枚并成一个根因**，那 10 枚的断言各不相同，未证（刀 97 已结清：修好后那 10 枚照旧红）。
- **141（`git checkout <ref> -- 路径` 在"内容已提交"前提下才是安全的探针撤销）**：那条禁用 checkout 的规则
  成因是未提交工作会被吞；本笔先把内容提交、再退回 HEAD~1 字节取"改前"读数，工作树与 HEAD 逐字节相等，
  于是 checkout 是最短且可验证（`git status` 空）的撤法。写清前提，否则下笔要么误用、要么该用时绕远路。

**待办（本笔新登记，不在刀序里）**：① ~~上面那枚两参工厂 `create_project_knowledge_watcher`（生产侧，
一行签名 + 改 `publish(watcher)`，配一枚真起 workspace 的用例）~~ **已由刀 97 结清（见 8.16）**；② `_app.ensure_qa_agent_exists` 的
符号搬家 2 枚；③ 发布渠道 `pending` 那 14 枚要等阶段 2 的 PyPI/Docker 真上线才结，不是测试侧的账。

### 8.16 刀 97：那枚两参工厂结清，并顺手把 8.14 的严重度写错的一句更正

**改了什么**：生产侧一枚 `src/qwenpaw/app/workspace/service_factories.py:341`（+6/−4，入册 14 → **16**）
+ 一枚 fork 自有新文件 `tests/unit/app/workspace/test_service_factory_contract.py`（84 行 / 8 枚用例）。
提交 `18c60af66`（修）+ `432409b16`（账）。

签名从 `create_project_knowledge_watcher(ws, _)` 换成 `(ws, _, publish)`，并把原先那句
`ws._service_manager.services["project_knowledge_watcher"] = watcher` 换成 `publish(watcher)`。**等价性不是我说的**：
`service_manager.py:433-434` 的 `publish_service` 就是 `self.services[name] = instance`，`name` 即描述符名
`project_knowledge_watcher`（`workspace.py:660`），另有 `:448` 的兜底按返回值补登记 ⇒ 同一枚键、同一条写路径，
只是不再伸手进管理器。

**严重度更正（对 8.14 那句"watcher 从不运行"）**：那枚描述符**没有** `optional=True`，`_run_service` 因此走重抛分支
（`service_manager.py:331` 记 `Failed to start service` → `:336` 抛），冒到 `workspace.py:751` 记
`Failed to start agent instance`。所以代价不是"少一台后台 watcher"，是**整个 agent 实例起不来**。CI 选择集日志实测：
`TypeError: create_project_knowledge_watcher() takes 2 positional arguments but 3 were given` **17 → 0**、
`Failed to start service 'project_knowledge_watcher'` **4 → 0**、`Failed to start agent instance` **4 → 0**。
（那个 17 是**行数**不是失败数：现数 17 = 4 行 `service_manager.py:331` 的记录 + 4 行 `workspace.py:751` 的记录 +
9 行 traceback/`E` 行 ⇒ 同一次失败在日志里印三遍，去重到失败事件是 **4** 次，与另两个 4 对得上。）

**为什么合并没报冲突（判据 143）**：上游把 `post_init` 这个**槽位**的合同从两参加宽到三参，改的是调用方
（`service_manager.py:436`，上游自有），而我们那枚是被调方且是 fork 自有 ⇒ 合并永远不会碰它 ⇒ 断在树里而不是断在
冲突表上。旧分叉点 `e111ec6fb` 时代这枚工厂还不存在、合同也还是两参；新分叉点 `ddd8408eb` 起调用方已是三参 ⇒
这笔是**重立基线那一刻就埋下的**，与合并解冲突的动作无关。守卫因此按槽位枚举而不是点名：
`vars(service_factories)` 里所有 `create_*` 协程（现数 **7** 枚）都必须收得到三个位置参数，这样以后 fork 新加的
工厂留旧元数会当场红。

**TDD**：新文件对着 HEAD 字节 **2 failed / 6 passed**（用点枚抛 `TypeError`；参数化守卫红的臂正是
`test_every_factory_accepts_the_three_argument_contract[create_project_knowledge_watcher]`，其余 6 枚工厂当场绿），
同目录 **2 failed / 32 passed**；改签名后 **34 passed**。

**CI 选择集两态对照（判据 107，同旗标 `-p no:randomly`）**：BEFORE（工厂退回 HEAD 字节 + 新用例留着）
**43 failed / 15,669 passed / 27 skipped / 4 xfailed / 988.47 s**；AFTER（本笔字节）
**41 failed / 15,671 passed / 27 skipped / 4 xfailed / 1,057.55 s**。两态收集总数逐位相同
（43+15,669+27+4 = 41+15,671+27+4 = **15,743**），失败 node-id 差集 = **恰好那 2 枚契约用例**。

⚠ **41 ≠ 8.14 那 40 的算术**：我这两次跑都比刀 96 那次多一枚红 ——
`tests/unit/services/test_terminal.py::test_real_pty_cwd_unicode_resize_interrupt_and_cleanup`。它在两态里**都在**，
所以不是本笔造成的；单取该文件 **10 passed / 8.01 s**，失败签名是 `collect()` 循环等真 pty 输出、
踩 `src/qwenpaw/services/terminal.py:151` 那句 `asyncio.wait_for(self.changed.wait(), timeout=20)` ⇒ 判据 107
那一类负载相关计时红。刀 96 的 15,735 + 本笔 8 枚新用例 = 15,743 对得上，所以差额在"跑法"不在"树"。
**诚实的剩余口径 = 刀 96 那 40 枚 + 这枚 pty flake**。

**结清 8.14 欠的那半句（判据 134）**：那 40 枚 —— 含 6 枚 migration、4 枚 `test_multi_agent_manager_startup.py`、
2 枚 `test_provider_startup_offload.py` —— 在 TypeError 归零后**照旧红** ⇒ 直接证成它们与这枚缺陷无关。
（这 2 枚已由刀 98 结清，见 8.18；余下 40 − 2 = 38 枚在册，其中 1 枚 pty flake 时红时绿。）

**账**：P1 **111 文件 / +10,863 −530**，行为 **110 文件 / +10,828 invasive / −495 deleted**，命名 1·7·35 与
mechanical 1 零动；`--check` 绿（无增长）。只有一枚条目位移（`service_factories.py` 14 → 16）。
**顺带把两处一直看不明白的账读通了（判据 142）**：`scripts/check_p1_invariants.py:179` 只统计
**在基线 ref 就存在**的路径（`if path not in owned ... continue`），`:199` 的 `totals.files` 又把 mechanical 剔掉 ⇒
① 本笔那枚全新 fork 自有测试文件**结构上进不了册**（不是漏记），② 基线里 `files` 字典 112 枚键 vs `totals.files` 111
从来不是漂移（多出的那枚是 `console/package-lock.json`）。推论：deliverable 是"新建 fork 自有文件"的那把刀，
册上唯一信号是被改的上游宿主文件，**文件数不动是设计使然，不能读成"什么都没变"**。

**其余读数**：五道离线门禁绿，串与刀 96 逐字相同（locale split 4,658 gated / 59 模板族 / 7 豁免 / 1,459 overlay 叶 /
23 上游键豁免 · namespace 35/6/0/0/0 · release channel R1–R5 over 6 files · CI targets 16 命令 / 3 目录 ·
brand 7 文件 / 35 行）。合集回归 `tests/unit/app/workspace/` + `tests/unit/app/test_project_knowledge_watcher.py` +
L1 五目录 **1,382 passed / 1 skipped / 16.57 s**。flake8 对本笔两枚文件 **rc=0、零读数**（不是"零新增"，是本来就干净）。

**没做到的一半**：本笔的用例是按管理器合同喂 `SimpleNamespace` 假 workspace，不是真起一台 workspace；
现网侧证据只有那 4 次真启动的日志从 4 变 0。**待办**：① ~~`_app.ensure_qa_agent_exists` 符号搬家 2 枚（判据 111 型，
仍在册）~~ **已由刀 98 结清（见 8.18），且这里原来的措辞"符号搬家"低估了它 —— 生产侧没搬家，是上游用例的桩名
撞不上我们的接替名**；② 那枚 pty flake 的等待预算（与刀 86 的 M1/M2/M3 同族，未结）；③ 发布渠道 `pending` 14 枚仍等阶段 2；
④ 8.18 末登记的那 6 枚 migration 红（`load_agent_config` 在替身不全时抛错、错误路径仍写顶层配置）待单独一刀。

### 8.17 本笔新增判据 142–143

- **142（先读门禁脚本的选取规则，再解释它的读数）**：P1 脚本按"基线 ref 在册"筛路径、按 `mechanical` 剔分母。
  不知道这两条就会把"新建 fork 自有文件后文件数不动"读成漏记、把"112 键 / 111 files"读成基线漂移 ——
  两处都是我自己先前挂着的问号，一次脚本读源码就结清。
- **143（合同加宽要按槽位枚举被调方，不能只改报错那枚）**：上游改调用方、我们提供被调方时，合并零冲突、
  断点静默进树，代价是每次启动整台实例起不来。修法的验收单位是"这个槽位的全部实现"（这里从模块
  `vars()` 枚举 `create_*` 协程），否则下一把刀新加的工厂会重演同一笔。

### 8.18 刀 98：那两枚启动用例红是改名桥，不是能力丢失（开刀前那句措辞是错的）

**先更正开刀前的措辞**。§8.14 待办 ① 与 8.16 末句都写作"`_app.ensure_qa_agent_exists` 符号搬家 2 枚"，
批准开刀时我把它复述成"启动时不建 QA agent，产品侧可见"。实跑取证否掉了这半句：
`git diff ddd8408eb HEAD -- src/qwenpaw/app/_app.py` 只说明上游那两行（`:55` import、`:263` 调用）不在我们树里，
而同位置我们写的是 `ensure_builtin_agents_exist`（现数 `:54` / `:263`），它出自 fork 提交 `f9cf47a41`
（2026-04-14 "feat: add builtin understand agents"，`git log --first-parent -S` 唯一命中）⇒ **一次改名替换，
不是吞掉**。覆盖关系有两条字节证据：`migration.py:812 _do_ensure_qa_agent` 今天就只剩一行薄壳
`ensure_builtin_agents_exist(spec_ids=[BUILTIN_QA_AGENT_ID])`，而 `builtin_agents.py:60 BUILTIN_AGENT_SPECS`
第 0 枚规格的 `id=BUILTIN_QA_AGENT_ID`（另 6 枚是 understand agent）⇒ 启动照建 QA agent，只是连那 6 枚一起建。
生产侧一枚未改。

**2 枚红的唯一成因**：上游自有 `tests/unit/app/test_provider_startup_offload.py:73,155` 用
`monkeypatch.setattr(app_module, "ensure_qa_agent_exists", lambda: None)` 按名字打桩，撞不上我们换掉的名字 ⇒
`AttributeError: <module 'qwenpaw.app._app' ...> has no attribute 'ensure_qa_agent_exists'`（实测 2 failed / 1 passed）。
修法照刀 96 的桥：两行改钉 `_app` 上真存在的接替名（按定义符号找，裁决 ③），另加一枚 fork 自有守卫
`tests/unit/app/test_startup_builtin_agent_coverage.py` 钉住我据以下结论的两条不变量。

**守卫的两条断言各自证过红**（改生产字节 → 跑 → 用 Edit 改回，`git diff --stat -- src/` 读空自证撤销干净）：
① 把 `_app.py:263` 的调用改名 ⇒ `test_lifespan_runs_the_builtin_agents_startup_step` 红（正向钉调用点，判据 88，
没有用否定式禁止串）；② 把 `BUILTIN_AGENT_SPECS[0].id` 加后缀 ⇒ `test_builtin_agent_specs_cover_the_qa_agent` 红。

**顺手把同类断点扫尽**：全仓 `ensure_qa_agent_exists` 现剩 9 处命中 = 生产 3（定义 `migration.py:784` +
`cli/init_cmd.py:224,280`）+ 用例 5（`test_migration.py:341` 注释、`:352` 与
`test_migration_skills_and_qa_agent.py:812` 都按 `migration.` 前缀调、`test_init_cmd.py:68,223` 按
`qwenpaw.app.migration` 模块打桩）+ 本笔守卫的文档串 1。那 5 处指向的模块都真有这枚符号 ⇒
**没有第二枚用例按 `_app` 的属性名打它**。另确认 4 枚 `test_multi_agent_manager_startup.py` 不在这类里
（该文件零处引用 `ensure_*`，红在 `:449` 的 `subprocess.run(timeout=10)`）。

**账**：新宿主 1 枚 `tests/unit/app/test_provider_startup_offload.py`（上游自有、改前与分叉点逐字节相同）
+10/−2 ⇒ 册 111 → **112 files / +10,873−532 / 行为 111 files / +10,838−497 / 命名 1·7·35 / mechanical 1**。
那 +10 全是"为守 79 列把一行 `setattr` 拆成五行"的格式代价，语义只是换一个名字（判据 147）。

**CI 选择集两态对照（判据 107，同旗标 `--ignore=tests/unit/channels -p no:randomly`）**：BEFORE 取刀 97 的
AFTER 日志 **41 failed / 15,671 passed / 27 skipped / 4 xfailed / 1,057.55 s**；本笔 **38 failed / 15,676 passed /
27 skipped / 4 xfailed / 1,087.14 s**，收集总数 15,712 → 15,714 恰为本笔新加的 2 枚守卫。FAILED node-id 差集
= 那 2 枚 offload + 1 枚 `test_real_pty_cwd_unicode_resize_interrupt_and_cleanup`（刀 97 登记的负载敏感 flake，
这一轮没复现）⇒ **在册测试侧红 40 → 38**：14 发布渠道 `pending`（等阶段 2）+ 6 migration + 4 startup subprocess
+ 14 散枚。⚠ 这一轮收集读的是拆行之前的字节（拆行发生在跑之后，语义相同），跑完后该文件单跑 **3 passed**。

**其余验收读数**：五道离线门禁 + 品牌账册 + P1 `--check` 全 rc=0，输出串与刀 94–97 逐字相同（本笔没碰
文案/品牌/渠道面）；L1 must-pass 五目录 **1,336 passed / 1 skipped / 7.81 s**；flake8 rc=0 两枚被改文件；
两枚文件合跑 **5 passed**。

**没做到的一半（新登记，不在刀序里）**：那 6 枚 migration 红里 5 枚也带 QA agent 字样，容易被当成本笔同一
根因 —— 不是。实测落点在 `migration.py:890 load_agent_config(spec.id)`，抛
`ConfigurationException: Agent 'QwenPaw_QA_Agent_0.2' not found in config`（用例只 monkeypatch 了
`migration.load_config`，`load_agent_config` 走真实配置），异常被 `:906` 的 `except Exception` 吞成 WARNING，
随后 `:913-916` 仍然 `save_config(config)` ⇒ 用例的 `assert saved_configs == []` 读到一枚 Config。
这枚要么是真缺陷（每次启动多写一次顶层配置），要么是替身不够，我跑的证据不足以判，留给单独一刀。

### 8.19 本笔新增判据 144–147

- **144（改名替换是判据 111/143 的镜像方向）**：上游保留它自己的符号、我们把我们那一步换了名字，于是断点
  不出在生产调用方也不出在冲突表上，而是出在**上游用例按名字打的那根 monkeypatch 桩**上。报错形式是
  `AttributeError: module X has no attribute Y`，不是行为差异 ⇒ 见到这类红先查 `Y` 在本树有没有改名后的接替者，
  别先怀疑生产逻辑。
- **145（"某能力在启动路径上丢了"要用接替符号 + 规格表两级取证）**：`git diff <base> HEAD` 只给你"上游两行
  没了"，判它是吞掉还是改名要看同位置我们那行写的是什么、以及新名字是否覆盖旧语义（这里是
  `BUILTIN_AGENT_SPECS` 第 0 枚就是 QA agent）。开刀前那句"启动不建 QA agent"是一笔没跑过的推论，
  它当时还挂在 §8.14 的待办里被引用。
- **146（一次日志行计数不是失败次数）**：17 行含同一句 `TypeError` = 4 次失败 × 3 处印（`service_manager.py:331`
  记录 4 + `workspace.py:751` 记录 4 + traceback/`E` 行 9）。成对出现的读数必须写明各自数的是行还是事件，
  否则下一个读者会像我一样去"更正"一个本来正确的数。
- **147（桥的账按行交，即使语义零变化）**：为守 79 列把一行 `setattr` 拆成五行，册上就是 +10/−2，而改动内容
  只是换一个名字。记账口径按行不按义，与判据 91 同族：格式改动和减法刀受同一把尺。

### 8.20 刀 99：那 6 枚 migration 红是三因，不是 8.18 末句猜的那一因

**先立逐枚根因表**（判据 134/140）。8.18 末句给的机制——"`migration.py` 错误路径把 `save_config` 多写了一次"
——是按簇预判；实测 6 枚里只有 3 枚吃这条，另 3 枚分别是生产侧少写一行与路径读取点走错。逐枚取法：刀 98
那轮 CI 用 `--tb=line`，日志里带**断言所在行号**，再按行号读改前字节（`bed6aac13`）的测试源码。

| 用例 | 改前失败的那一行断言 | 成因 | 分派 |
|---|---|---|---|
| `test_migration.py::TestEnsureDefaultAgent::test_creates_missing_default` | `:336 assert agent_configs == ["default"]` | fork 把上游建默认 agent 时的 `build_agent_template(...)` + `save_agent_config("default", ...)` 丢了 ⇒ 顶层配置写了、`agent.json` 没写 | **生产侧**（裁决 RC-A：恢复上游那两行） |
| `test_migration_skills_and_qa_agent.py::TestDoEnsureQaAgent::test_creates_the_builtin_slot_and_moves_active_agent_off_legacy` | `:736 assert canonical.is_dir()` | 规格对象的 `workspace_dir` 在 fork 里读**导入期**绑定的 `constant.WORKING_DIR` ⇒ 用例打 `migration.WORKING_DIR` 打不住它，目录建到开发者 `~/.copaw` | **生产侧读取点**（裁决 RC-B：修读取点） |
| `...::test_skips_creation_when_another_agent_owns_the_path` | `:765 assert saved_configs == []` | 同一读取点：`_other_agent_owns_workspace`（`:714`）拿真 HOME 下算出的 canonical 跟 `alice` 的 `wd/workspaces/<QA>` 比，看不见认领 ⇒ 走创建分支 | 同上 |
| `test_migration.py::TestEnsureQaAgent::test_existing_qa_agent_noop` | `:373 assert saved == []` | fork 对已存在的 builtin profile 会回填 `is_builtin` / `builtin_kind` / `builtin_label` / `system_protected` 并 `save_config`，上游没有这一步 | **断言侧**（裁决 RC-B：改断言、不弱化） |
| `...::test_existing_builtin_profile_is_a_noop` | `:782 assert saved_configs == []` | 同上 | 同上 |
| `...::test_existing_profile_with_a_custom_workspace_is_respected` | `:803 assert saved_configs == []` | 同上（这条同时吃读取点：`custom` 目录的创建路径） | 同上 |

**落点三笔**：
- `a19268e30`（生产侧，2 文件 +35/−9）：`migration.py` +29/−2 恢复上游那两行，并新增
  `_builtin_workspace_dir(spec)`（`:833-840`，调用点 `:856` / `:893`）；`builtin_agents.py` +6/−7 删掉
  `workspace_dir` property 与随之失效的 `Path` / `WORKING_DIR` 导入。全仓 `grep "spec.workspace_dir"` 现 0 命中
  ⇒ 规格对象不带路径，路径只由使用方自己的模块级绑定解析，这才是 monkeypatch 能生效的原因。上游那两行所在的
  import 块还列 `QA_AGENT_TEMPLATE`，本文件 0 引用，故只取实际用到的两个名字。
- `ed532158e`（上游自有断言，2 文件 +38/−4）：三枚 noop 断言改成钉 fork 真正做的事——回填四字段的**值**、
  `agent_order` 含 QA id、二次调用幂等（仍只写一次）、`chats.json` 仍在、自定义 workspace 不被搬到 canonical。
  判据 88：全是正向钉，没有一枚改成"允许写"。
- `b6da69a66`（fork 自有新文件 143 行，见下"超出裁决范围的一处落点"）。

**证红与改前证据**：改前两文件合跑 **6 failed / 63 passed**（69 枚，`/tmp/k99_before.txt`）；改后四文件合跑
**73 passed in 1.27 s**（+4 = 2 枚新回填覆盖 + 2 枚刀 98 的启动守卫）。另有六枚单变量变异探针（把恢复的
`save_agent_config` 退回、把 `_builtin_workspace_dir` 换成写死拼接、去掉 ref 回填、去掉 `agent_order` 自愈、
去掉已存在 profile 的 `_initialize_agent_workspace` 重跑、去掉 `agent.json` 回填），每枚各自把自己对应的新断言
读成红，探针全部用 Edit 撤销并以 `git diff --stat -- src/` 读空自证。⚠ 这六枚的改前字节没有留档，能复核的是
"每枚新断言都有对应一行被改坏"这个映射，以及上面那份改前红日志。

**一次假绿（自纠）**：99-A 那步我在生产改动尚未落盘时就报过"三枚转绿"，实际跑的是 `bed6aac13` 的字节；
发现后重跑读到 **3 failed / 66 passed** 才继续。此后每个"绿"之前都先确认改动在场（判据 89 的同一族：
读数只对取它时的树状态有效）。

**超出裁决范围的一处落点（申报）**：`tests/unit/app/test_migration_builtin_backfill.py`（fork 自有，
`git cat-file -e ddd8408eb:` 失败）。理由：改后的三枚上游断言在 `tests/unit` 下走的都是
`load_agent_config` 抛异常的那一半（autouse 隔离所致，判据 148），也就是回填循环里 `agent.json` 那一半**永远
走不到**；grep 证据 = 该循环只有 `migration.py:889` 一处调用它，上游用例没有一个把配置那一半满足掉。这枚文件
把那一半单独摊开成两条：配置已合格 + `agent.json` 缺字段 ⇒ 只补字段、不动用户自选的 name/description；
两边都合格 ⇒ 一次写都不做。它超出 RC-B 的字面（"改断言 + 修读取点"），补的是判据 134 要求的分支覆盖，
不引入新语义。

**泄漏：本刀只结清了一半，另一半归因到具体文件并登记**。
- 已结清（marker 双向实测）：四文件 migration 簇跑完后 `~/.copaw/workspaces` 里**晚于 marker 的文件 0 处**，
  `~/.copaw/qwenpaw.log` 本身也没被碰（同轮 73 passed）。
- 仍在漏：`~/.copaw/qwenpaw.log` 15:26:33–15:27:58 那段写盘指纹是
  `src/qwenpaw/app/migration.py:977/1000` + `src/qwenpaw/app/routers/agents.py:1995` +
  `src/qwenpaw/app/_app.py:470 "Server ready in 0.293s"`。两条判据说明它是**源码 checkout 的进程**而不是桌面
  bundle：① `src/` 前缀（bundle 打的是 `_internal/qwenpaw`，前缀为 `qwenpaw/...` 且没有 `.py`），
  ② `:977` 这个行号只对刀 99 之后的字节成立。同一份 log 里两种前缀 = 两个进程；bundle 自己的 traceback
  恰在其上方、时间戳 15:15:01。
- 归因手段：仓外临时 pytest 插件 `/tmp/leaktrace/leaktrace.py` 包住 `migration._do_ensure_builtin_agents`，
  把当时看到的 `migration.WORKING_DIR` 与 `PYTEST_CURRENT_TEST` 连栈写文件；整轮 CI 选择集跑完 **25 次命中全部
  来自 `tests/unit/app/routers/test_copaw_hanlp_tasks_router.py`**，且 25 次的 `WORKING_DIR` 全是
  `/Users/futuremeng/.copaw`。单文件复跑坐实：该文件 29 枚用例（25 枚各进一次真 lifespan，`with
  TestClient(app)`）20.21 s 内在开发者真目录写出 **8 枚文件**（7 枚 builtin 的 `agent.json` +
  `QwenPaw_QA_Agent_0.2/skill.json`）。
- 机制：`migration.py` 的 `WORKING_DIR` 来自 `from ..constant import WORKING_DIR` 这个**导入期绑定**，全仓同形
  绑定现数 74 处，而刀 86 那笔 autouse 隔离只打了 `_config_utils.WORKING_DIR` 一枚 ⇒ 配置读写被隔离、目录读写
  没有。所以 `~/.copaw/config.json` 保住了（用例自己打了 `load_config`），代价是每次 CI 都在开发者真目录里重写
  那 7 枚 builtin 的 `agent.json`。
- 登记不修：两条修法各有前置——在 autouse 里补 `migration.WORKING_DIR` 要先量那 25 枚 hanlp 用例是否依赖真
  HOME 下的产物；把 `with TestClient(app)` 换成不打 lifespan 的替身则要动一枚 fork 自有测试文件。这是第二笔
  测试基建账，另开一刀，不在本刀顺手做（判据 66 的方向：本刀把 migration 簇隔离好了，盲区移到了那 25 枚）。

**门禁读数的一处更正**：刀 94–98 都写"五道门禁输出串逐字相同"，其中 `check_namespace_boundaries.py` 那道记的
是 `shared_count: 35 / copaw_only_count: 6`。本笔复核发现那四次传的是 `--upstream-ref qwenpaw_upstream_main`，
这个名字在本地**不存在**（`git rev-parse` fatal，脚本只印一行 `warning: failed to read baseline ref` 然后照常
跑）⇒ 它们从没打印过 baseline 块与 delta 块，"逐字相同"比的是半张表。换成能解析的本地 `upstream/main`
（= 新分叉点，里面没有 `src/copaw`）后读数 = current `shared_count: 35 / copaw_only_count: 6 / 其余三项 0`，
baseline 三项全 0，delta 三项全 0，`result: PASSED`。结论没变（零回归），变的是那句话此前没有 baseline 可比。

**账**：新宿主 2 枚，都是上游自有测试文件（`test_migration.py` +14/−1、
`test_migration_skills_and_qa_agent.py` +24/−3，改前与分叉点逐字节相同）；`migration.py` 净 +27；
`builtin_agents.py` 与 `test_migration_builtin_backfill.py` 对分叉点 diff 为空 / 分叉点无此文件 ⇒ 不入册。
册 112 → **114 files / +10,922 −520**，行为 **113 files / +10,887 / −485**，命名 1·7·35 与 mechanical 1 照旧。
+49 可加 = 11（`migration.py` 除恢复行以外的新写）+ 14 + 24；−12 可减 = 还回上游那 16 行（−16）与本笔自己新删
的 4 行。`migration.py` 单文件的 `removed` 75 → **59**：这是判据 ㉑ 的第二例形状（把上游的东西还回去，账上是
减债）。⚠ 面（133 文件 / 15,213 行为行）本笔没重算，仍引 `2026-10-07-trial-merge-conflict-table.md` 的口径。

**验收读数**：
- CI 选择集三态（同旗标 `tests/unit --ignore=tests/unit/channels -p no:randomly`，判据 107）：
  BEFORE（= 刀 98 的 AFTER）38 failed / 15,676 passed / 27 skipped / 4 xfailed / 1,087.14 s；
  AFTER ① **32 failed / 15,684 passed / 27 skipped / 4 xfailed / 1,038.58 s**（取在最后一次编辑之后，判据 89）；
  AFTER ②（带泄漏插件重跑）**32 / 15,684 / 27 / 4 / 1,018.87 s**。两次 AFTER 的 `FAILED` node-id 集
  **逐字节相同**（`diff` 空），收集总数 15,745 → 15,747 恰为本笔新增枚数，差集 = 那 6 枚 ⇒ **0 枚新红**，
  刀 97 登记的 pty flake 两轮都没复现。在册测试侧红自此 38 → **32** = 14 发布渠道 `pending`（等阶段 2）
  + 4 `test_multi_agent_manager_startup.py` subprocess 超时 + 14 散枚。
- L1 must-pass 五目录 **1,336 passed / 1 skipped / 7.50 s**；五道离线门禁 + 品牌账册全 rc=0
  （locale 门禁 `4658 production gated keys / 59 template key families gated / 7 exempted / 1459 overlay keys
  en/zh / 23 upstream-owned keys exempted`；发布渠道 `R1-R5 over 6 channel files`；CI 命令目标 `16 run commands
  across 3 package dirs`；品牌 `ledger replayable: 7 files / 35 lines`）；P1 `--check` rc=0（`--write-baseline`
  之后）；namespace 门禁见上段更正。
- flake8：`builtin_agents.py` 42/48/49 E501 + 164 W292、`migration.py` 912 E501 共 5 处，与改前字节
  （`git show bed6aac13:` 同码 43/49/50/165 + `migration.py:885`）**同码同枚、只因本笔插入而行号位移**，
  新增 0 处；三枚测试文件 0 处。⚠ 这一步 rc=1 是那 5 处既有违规，CI 里没有跑 flake8 的 workflow（判据 73）。

### 8.21 本笔新增判据 148–151

- **148（打一枚模块级绑定不等于隔离了那个常量）**：`from x import CONST` 在每个被导入模块里造出一份**独立**绑定
  （`WORKING_DIR` 全仓现数 74 处），autouse 补丁只覆盖其中一枚 ⇒ 被检模块读的仍是开发者真目录。判"测试已与本
  机目录解耦"必须枚举绑定枚数，或直接读那个模块自己的全局；否则就会像我一样把刀 86 那笔当成交付完成，
  而每次 CI 仍在 8 枚真实文件上落盘。
- **149（日志路径前缀能免费区分写盘进程）**：同一份 `~/.copaw/qwenpaw.log` 里源码 checkout 印
  `src/qwenpaw/app/migration.py:977`，冻结桌面 bundle 印 `qwenpaw/...`（没有 `src/`、没有 `.py`）⇒ 两种前缀
  混排就是两个进程。再叠一层"行号只对某个提交字节有效"就能把归属钉到某次改动之后，不用加instrumentation。
- **150（"泄漏已结清"必须写明夹住的范围）**：我一度把 marker 前后 `~/.copaw` 的指纹读成一致，就写成"泄漏结清"；
  那次 marker 只夹住了 migration 簇，一整轮 CI 选择集跑完照样冒 8 枚文件。结清类断言的主语要么是"这个样本"
  要么是"这个进程"，不能是"测试套件"。
- **151（按簇预判的机制不能顶替逐枚根因，判据 134/140 的实例）**：刀 98 留下的"错误路径多写一次 `save_config`"
  确实存在于树里，但它只解释 6 枚中的 3 枚；另 3 枚一枚是生产侧少写（真缺陷）、两枚是路径读取点走错（把用例
  自己的 tmp 目录判成不存在）。若照簇修，那枚真缺陷会被断言改写掩盖掉——这与我改 RC-A 的方向相反，代价是产品
  少建 `agent.json`。

**待裁（刀 99 登记，不在刀序里）**：那 25 枚 `with TestClient(app)` 的本机目录泄漏（8.20 已归因到文件、机制已量到
导入期绑定 74 处），两条修法各有前置，需要一句"要不要为测试基建再开一刀"（刀 100 的 8.22 待裁 ③ 是同一机制的
读数面）。

### 8.22 刀 100：那 14 枚散枚红 = 1 枚生产侧文件 + 5 枚测试侧文件（共 9 枚用例），余 5 枚是环境红

**七笔提交，均已推 `origin/sync/upstream-20261009`、未开 PR**（按落点分笔，`c263ecf15` 那笔的标题写"four test-side
edits"不准确：账只响应 `query_error_dump.py` 出册（−3）+ heartbeat +8 + manager −1 = **+4**，另外三枚测试文件
按 `check_p1_invariants.py:179` 的定义进不了册，所以账笔对它们是零响应）：

- `22c112207` 生产侧 1 文件 +3/−3：`query_error_dump.py` 退回上游字节 ⇒ **出册**。
- `a291a2fb4` 测试侧 crons 两文件 +23/−16：heartbeat 跟上游签名、manager 两枚断言正反向下调。
- `0d6c98828` 测试侧 cli 1 文件 +26/−21：桩换到 `_signal_process_tree_unix`。
- `4c0f5cb18` 测试侧 providers 1 文件 +49/−15：兼容用例整枚重写（fork 自建、出册）。
- `57c403500` 测试侧 providers 1 文件 +3/−3：retry 替身的字段与 chunk 形状。
- `c263ecf15` 账 `scripts/p1_baseline.json` +10/−18。
- `e9e9da282` docs（本节 + §8.23）。

提交后在 HEAD 上重取的两项：`check_p1_invariants.py --check`（默认 `--target-ref HEAD`）**rc=0**、
读数串与上面"账"一节逐字相同；六枚相关测试文件（五枚本笔改过 + 上游的 `test_query_error_dump.py`）在
`HOME=/tmp/k100_home2` 下 **175 passed / 4 skipped / 5.11 s**。CI 选择集的 AFTER 读数取在最后一枚**代码**编辑之后，
其后只有账与 docs 两笔 ⇒ 判据 89 未被违反。

8.20 的验收读数把在册测试侧红收到 **32** = 14 发布渠道 `pending` + 4 `test_multi_agent_manager_startup.py`
subprocess 超时 + **14 散枚**。本刀只做那 14 枚，且**先逐枚取栈**再分派（判据 134/140；8.20 的 6 枚教训是"按簇
预判只解释一半"）。取法 = 单文件跑 `-q --tb=line` 拿断言行号，再按行号读树里字节 + 读被钉的生产签名。
逐枚落点（六枚文件、九枚用例）：

| 用例 | 实测的失败机制 | 分派 |
|---|---|---|
| `test_query_error_dump.py::test_timestamp_is_utc_and_zulu_formatted` | 上游用例钉 `re.fullmatch(r"\d{4}-…:\d{2}Z", ts_utc)`（无小数秒），fork 写的是 `isoformat().replace("+00:00","Z")` ⇒ 带微秒必红 | **生产侧**：整文件退回上游字节，`ts_utc` 回到 `strftime("%Y-%m-%dT%H:%M:%SZ")`，模块级 `UTC = timezone.utc` 一行也一并还回 |
| `test_heartbeat.py::test_run_heartbeat_once_dispatches_with_agent_last_dispatch` | fork 自写的这枚用例（上游在该路径只有 109 行、无此枚）钉 `runner=` + `load_agent_config`，而 `heartbeat.py:189` 的签名是 `workspace=`、last-dispatch 走 `read_last_dispatch`，且 `hb.timeout_seconds` 是必读数 ⇒ `TypeError` | **测试侧**：参数改名 + 补 `timeout_seconds=HEARTBEAT_DEFAULT_TIMEOUT_SECONDS` + 打点改 `heartbeat.read_last_dispatch`。该生产文件对分叉点 diff 为空 ⇒ 上游的合同，fork 的用例过期 |
| `test_manager.py::test_create_or_replace_raises_on_invalid_cron` / `…_without_started` | 两处断言写的是"先落库再校验"（fork 旧合同），现 `create_or_replace_job` 的第一句就是 `validate_job_spec` ⇒ 无效 spec 一处写都不留 | **测试侧**：docstring 换成上游合同陈述、断言改 `repo.list_jobs() == []`，第二枚另加 `pytest.raises(ValueError)`（判据 88：改的是钉得更严，不是弱化） |
| `test_desktop_cmd_exit_code.py::test_closing_the_window_exits_zero` / `…webview_failure…` | `FakeProc` 记录的是 `proc.terminate()`，但 `desktop_cmd.py:297` 现在走 `shutdown_cmd._terminate_pid` → `_signal_process_tree_unix`（`:325` SIGTERM / `:336` SIGKILL），fake 的 `terminated` 永远 False | **测试侧**：桩换成 `qwenpaw.cli.shutdown_cmd._signal_process_tree_unix` 收集 `(pid, sig)`，正向钉 `== [(proc.pid, SIGTERM)]`；两枚否定式改钉 `== []`。这个 seam 正是上游自有 `test_cli_shutdown.py:319` 打的同一枚 ⇒ 顺带不再对真 pid 发真信号 |
| `test_openai_stream_malformed_tool_use_compat.py`（旧两枚） | **计划里的变异探针不落红**：把 #4185 过滤的 `_tool_types` 掏空后两枚照绿。探针读到的真机制 = agentscope 2.0.9 `_model.py:442` 用 `delta_name or "unknown"` 给缺名工具调用**补名**（实测 `n_blocks=1 -> [('call_no_name', 'unknown')]`），`:432 index = tool_call.index` 会因缺 `index` 直接 `AttributeError`，而缺 `id` 在 `_model_response.py:154` 造 `ToolCallBlock` 时被 pydantic 判 `Input should be a valid string [input_value=None]` ⇒ 过滤器两条臂**都拿不到块** | **测试侧**：整文件重写为 4 枚，钉在真正还活着的 `_sanitize_tool_call` 两条 drop 臂上（缺 `index`、缺 `function`），另两枚把"补名而非丢弃"与"合法块幸存"写死。⚠ 上游 #4185 想防的"坏条目进 session history"在新库下已不成立——缺名块会以 `name="unknown"` 落库，缺 `id` 则整条流抛 `ValidationError`。**待裁**（见本节末） |
| `test_retry_chat_model.py::test_retry_stream_when_remote_protocol_error` | 双层：`RetryChatModel.model_key`（`:456`）读 `self._inner.model`，fork 的替身仍交 `model_name` ⇒ `AttributeError`；改完又撞 `retry_chat_model.py:639` 的 `has_meaningful_stream_content(chunk.content)` ⇒ 替身 yield 裸 dict 再撞一次 | **测试侧**：`model = "fake"`、`yield SimpleNamespace(content="ok")`、断言读 `.content`——照抄本文件里上游自己的替身形状。生产侧那 14 行（`_iter_exception_chain` 的异常链重试）一枚未动；变异探针取上游前一刻的形式 `for current in (exc,)` 才隔离出这唯一一枚依赖者（第一版探针 `for current in []` 把整条重试性都废了，太粗） |

**证红**：那 9 枚逐枚都在 8.20 实测读到的 32 枚 `FAILED` 名单里（`/tmp/k99_after_failed.txt`，本笔开刀前逐枚
`grep` 复核 9/9 命中），开刀后又各自单文件跑过一次红才动代码。三枚变异探针全部用 Edit 撤销，撤销后
`git diff --numstat HEAD -- openai_chat_model_compat.py` 读空自证；探针实测分别是
缺 `index` 臂摘掉 ⇒ `test_tool_call_without_index_is_dropped` 红在库内 `_model.py:432 AttributeError`、
缺 `function` 臂摘掉 ⇒ `test_tool_call_without_function_is_dropped` 红在多出一枚
`ToolCallBlock(id='call_empty', name='unknown', input='')`、`_tool_types = ()` ⇒ 本文件 4 枚全绿
（= 惰性证明），但同一轮上游自有 `test_openai_stream_toolcall_compat.py` 红 3 枚——那个名字还被 extra-content
那一段用着，属于探针的连带面，不是 #4185 过滤器的作用。

**账**：`query_error_dump.py` 对分叉点 diff 读空 ⇒ **离开册**（改前条目 +3/−3）；`test_heartbeat.py` +298→**306**、
`test_manager.py` +163→**162**、`test_retry_chat_model.py` 66/0 不变；`test_desktop_cmd_exit_code.py`（+145/0）与
`test_openai_stream_malformed_tool_use_compat.py`（+137/0）**两枚 fork 新建文件本来就不在册**——
`check_p1_invariants.py:179` 的选文件逻辑是 `if path not in owned: continue`，`owned` 取自
`git ls-tree -r ddd8408eb`，新分叉点无此路径 ⇒ 按定义零 P1 债，不是漏读（`git cat-file -e` 两枚均失败）。
册 **114 → 113 files / +10,926 −517**，行为 **113 → 112 files / +10,891 / −482**，命名 1·7·35 与 mechanical 1 照旧。
+4 的 reconciliation 只能按文件比（判据 139）：−3（还回上游）+8（heartbeat）−1（manager）= **+4**，
`removed` −517 = −520+3。

**验收读数**（全部取在最后一次编辑之后，判据 89；本机 `HOME` = 开发者真目录，下面所有读数都带这个条件）：
- CI 选择集（`tests/unit --ignore=tests/unit/channels -p no:randomly`）BEFORE **32 failed / 15,684 passed /
  27 skipped / 4 xfailed**（= 8.20 的 AFTER，逐字节引 `/tmp/k99_after_failed.txt`）；AFTER
  **23 failed / 15,695 passed / 27 skipped / 4 xfailed / 1,679.16 s**。差集 = 那 9 枚，收集 15,747 → 15,749
  恰为 E 重写带来的 +2 ⇒ **0 枚新红**。
- 余 23 = **14** 发布渠道 `pending`（`test_cli_update.py` 11 + `test_cli_update_overlay.py` 3，等阶段 2）
  + **4** `test_multi_agent_manager_startup.py` 的 `subprocess.TimeoutExpired … timed out after 10 seconds`
  + **5** 散枚。5 枚里 4 枚（acp 两枚 `_advertise_commands did not fire within 5.0s`、`shutdown_lifecycle`、
  `shutdown_deadline_integration`）逐枚都在 8.20 那 32 里 ⇒ 本刀没碰；第 5 枚
  `test_terminal_availability.py::test_app_starts_without_winpty` 是本刀换进来的，而 8.20 在册的
  `test_fork_project.py::test_finalize_lock_released_after_subprocess_crash` 这轮绿 ⇒ **成员本身不稳**（判据 107）。
  两态实测：这 5 枚单跑 `HOME=/tmp/k100_home2` **5 passed / 26.78 s**，同一批单跑真 HOME
  **4 failed / 1 passed / 227.90 s**；日志里看得见原因——真 HOME 下这枚用例真的把整个 workspace 起来了
  （`ChatManager created: ~/.copaw/workspaces/default/chats.json`、reme 载入 19 枚 doc 的 BM25 索引、
  向外部 MCP server 发 `server/discover` 并收到 HTTP 500）。**所以报任何红读数都必须写明 HOME**，
  这一族的"在册红数"在本机与 CI 干净 HOME 下不是同一个数。
- L1 must-pass 五目录（按 `unit-tests.yml:114-119` 现枚举：`tests/unit/security`、`tests/contract/security`、
  `tests/unit/agents/hooks`、`tests/unit/agents/memory`、`tests/unit/agents/utils`）
  **1,336 passed / 1 skipped / 21.19 s**（与 8.20 同计数）。⚠ 本刀中途一度把 L1 读成 1,954，那是我自己多加了
  `tests/unit/agents/tools` 的口径差，CI 定义里没有它（判据 92）。
- 五道离线门禁 + 品牌账册全 rc=0，串与 8.20 逐字相同：locale `4658 production gated keys / 59 template key
  families gated / 7 exempted / 1459 overlay keys en/zh / 23 upstream-owned keys exempted`；发布渠道
  `R1-R5 over 6 channel files`；CI 命令目标 `16 run commands across 3 package dirs`；品牌
  `ledger replayable: 7 files / 35 lines`；pipeline `4 files / 4 templates / 0 issues`；namespace 门禁带可读
  baseline（`--upstream-ref upstream/main`）= `shared_count: 35 / copaw_only_count: 6`、baseline 三项 0、
  delta 三项 0、`result: PASSED`。P1 `--write-baseline` 后 `--check` rc=0。
- flake8：六枚文件只 `test_heartbeat.py` 有 10 处 E501，同文件 HEAD 副本 **11** 处 ⇒ 本笔净 −1、新增 0；
  `query_error_dump.py` 退回上游字节后 0 处（HEAD 副本 2 处）。CI 仍无跑 flake8 的 workflow（判据 73）。

**待裁（本笔新登记三件，都不在刀序里）**：
1. **#4185 保护在新库下失效要不要生产侧补**（8.22 表第五行）：现在缺名工具调用会以 `name="unknown"` 落进
   session history，缺 `id` 会让整条流 `ValidationError`。要么在 fork 侧加一条"丢/改名 `unknown` 块"的臂（那是
   往上游自有文件再加行为，P1 上涨），要么认上游现在的行为并把这条从册里划掉。
2. ~~`test_heartbeat.py` 里 **4 枚自 skip** 的 quality-loop 用例~~ —— **刀 101 已裁"修"并落地（8.24）**。
   ⚠ 本条原措辞"`_collect_project_quality_loop_digest` 在 `src/` 现 0 命中"只对四枚 heartbeat helper 成立，
   对子系统不成立：`knowledge/graph_ops.py:492 maybe_start_quality_self_drive`、`:860 list_quality_loop_jobs`、
   `app/routers/knowledge.py:2000` 三处合同都活着（判据 157）。
3. `~/.copaw` 非密封那笔（8.20 已登记 25 枚 hanlp 用例的落盘泄漏）：本笔的 5 枚环境红是同一机制的**读数面**
   （不止写脏，还会让用例自己变红），加进"要不要为测试基建再开一刀"的证据里。

### 8.23 本笔新增判据 152–156

- **152（变异探针不落红 = 那个机制已死的证据，不是"代码安全"的证据）**：我按计划把 #4185 过滤器的
  `_tool_types` 掏空，两枚守卫照绿。正确结论是"这条臂不再起作用"，而不是"这条臂不需要"。探针绿了必须
  继续往上游一层读它把输入改成了什么（这里读到 `delta_name or "unknown"`），否则下一步就会像我一开头那样
  把守卫用例改写成"钉一个没人执行的意图"。
- **153（库的改名与补默认会静默废掉 fork 自己的守卫）**：上游把 `model_name` 改名 `model`、把缺名工具调用
  补成 `unknown`、把 `id` 收进 pydantic 的 `str` 合同——三处都不报错，但每一处都能让一个按旧形状写的守卫
  永远绿或永远以另一种方式红。判"我们的兼容层还有效"必须重新读库字节里的默认值分支，不能只看它有没有抛异常。
- **154（红读数必须写明 HOME；为卫生选的隔离 HOME 自己就能改变结果）**：同一批 5 枚用例，隔离 HOME
  5 passed / 26.78 s，真 HOME 4 failed / 1 passed / 227.90 s，差 8.5 倍墙钟。带真 HOME 的"在册红 N 枚"与
  CI 干净 HOME 的数不是同一个量，跨刀比较前必须确认两轮的 HOME 一致；否则我会把环境红算成回归。
- **155（散枚红的成员集本身会换人）**：这轮 `test_fork_project` 那枚转绿、`test_terminal_availability`
  那枚进集。判"本笔没引入新红"要按"差集是否恰为本笔修的枚 + 新收集枚"对账，而不是拿两个总数相减——
    总数相减在成员换手时会给出一样的数却讲错原因（判据 139 的同一族）。
- **156（"这枚文件怎么不在册"要先读工具的选文件逻辑）**：两枚 fork 新建测试文件带着 +145/0、+137/0 的对分叉点
  diff 却不在册，我一开始当成读数漏了。真相是 `check_p1_invariants.py:179` 只认 base ref 存在的路径 ⇒
  新文件按定义零 P1 债。任何"账对不上"先读脚本自己的选择集，再怀疑数（判据 73 的正向用法）。

### 8.24 刀 101：8.22 待裁 ② 那 4 枚自 skip 判"修"，落点从上游宿主换到 fork 自有模块

用户裁定口径 = "你觉得有价值就修，没价值就删"，我公开把范围收在 8.22 待裁 ② 那一件（待裁 ① #4185、
待裁 ③ `~/.copaw` 密封不是"修/删"形状，仍开放）。

**根因收到一笔提交一枚机制**：`git log -S "does not offload quality-loop digest collection in current runtime"
-- tests/unit/app/crons/test_heartbeat.py` 唯一命中 `ac9b836db`（`fix(cron): add workspace fast-path and
stabilize cron tests`）。能力本体是 `1182316c4`（2026-04-13 `feat: close quality-loop orchestration loop and
harden auth status requests`，对 `src/copaw/app/crons/heartbeat.py` **+195/0**）写的，上游 `copaw → qwenpaw`
改名合并把它吞掉；那笔没有连用例一起删，而是给四枚用例钉 skip ⇒ 这是一张止血欠条，不是产品侧放弃。

**接替者逐枚查**（裁决 3 那一型）：`_collect_project_quality_loop_digest`、`append_quality_loop_digest`、
`maybe_start_quality_self_drive`、`list_quality_loop_jobs` 四个符号在 `agentscope-ai/main` 命中均 **0 文件** ⇒
上游没有接替者，"重设计"没有依据，按忠实恢复写；同时 8.22 待裁 ② 那句"在 `src/` 现 0 命中"已就地更正——
无的是四枚 heartbeat helper，quality-loop 子系统的三处合同都活着（`knowledge/graph_ops.py:492`、`:860`、
`app/routers/knowledge.py:2000`），照旧措辞会推出相反结论。

**落点定价**：227 行 helper 全放 fork 自有新文件 `src/qwenpaw/app/crons/heartbeat_quality_loop.py`；
上游宿主 `heartbeat.py` 只留 import 1 行 + 调用 4 行 = **对分叉点 +6**。对照 donor 形状（195 行重放进宿主）
= 同一笔成果、册涨 6 还是 195、下次合并的冲突面按整枚文件算还是按 6 行算（判据 129/142 的又一次落地）。
新文件本身按 `check_p1_invariants.py:179` 的定义零 P1 债。

**接线位置与可达性**：插入点在 `run_heartbeat_once` 读完 HEARTBEAT.md、空文件 `return` 之后，
在 `HEARTBEAT_TARGET_LAST`（`:246`）/ `HEARTBEAT_TARGET_INBOX`（`:272`）/ `main` 落流（`:392`）三条分支**之前** ⇒
三种心跳目标都带摘要。两处生产调用方 `crons/manager.py:1015`、`app/routers/config.py:826` 都传
`workspace_dir` ⇒ 恢复的是活路径而不是只被用例走到的分支。`KnowledgeConfig` 的 `enabled`
（`config/product_models.py:262`，默认 True）与 `memify_enabled`（`:269`，默认 False）字段仍在，
自动编排读这两枚 ⇒ 默认关；摘要采集本身不受这两枚限制。

**四枚用例的合同改动**：`runner=` → `workspace=`（8.22 表第二行同一改法）；config 替身补
`timeout_seconds=HEARTBEAT_DEFAULT_TIMEOUT_SECONDS`；打点目标从 `qwenpaw.app.crons.heartbeat.*` 移到
`qwenpaw.app.crons.heartbeat_quality_loop.*`（前三枚另补一条 `_load_knowledge_config` 返回
`enabled=False, memify_enabled=False`，让自动编排在不相关用例里保持关闭）。

**证红顺序**（TDD：红必须是对的形状）：第一版红是 `AttributeError: module 'qwenpaw.app.crons' has no
attribute 'heartbeat_quality_loop'`——用例打了还不存在的模块 ⇒ 先落骨架 + 宿主接线，才拿到行为型红
`AssertionError: assert '[Project Quality Loop Digest]' in 'ping'`。三枚临时探针逐枚量牙齿，每枚只让它对应的
那一枚用例红、其余三枚照旧绿，探针全部用 Edit 撤销，撤销后 `grep -rn PROBE` 读空。
第四枚（offload 断言）是**机制性重写**不是搬运：宿主现在用 `run_sync_io`（`utils/io_utils.py:117`）把
`get_heartbeat_config` 也扔到线程，`patch()` 装的 MagicMock 因此是第一枚被 offload 的可调用对象且无
`__name__`，原断言"摘要是第一枚 `to_thread` 调用"不可达。实测一轮线程序列 =
`[MagicMock, is_file, read_text_file_with_encoding_fallback, _collect_project_quality_loop_digest,
read_last_dispatch]` ⇒ 改为容忍无名可调用 + 正向断言成员（判据 88 那一型）。

**账**：`heartbeat.py` 首次进册 **+6**、`test_heartbeat.py` 306→**321**（+15），册
**113 → 114 files / +10,947 −517**，行为 **112 → 113 files / +10,912 / −482**，命名 1·7·35 与 mechanical 1 照旧；
`behavior_added` 的 +21 只能按文件对账（+6 宿主、+15 用例）。新模块 +227/0 零响应。
`--check`（默认 `--target-ref HEAD`）rc=0；未提交态 `--check --target-ref working` 红 5 条
（`files 113→114`、`behavior_added 10,891→10,912`、`behavior_files 112→113`、
`NEW upstream-owned file touched: src/qwenpaw/app/crons/heartbeat.py`、
`tests/unit/app/crons/test_heartbeat.py behavior grew: 306→321`）⇒ 配套 `chore(p1)` 重立基线一笔
（`c263ecf15` 那一型）。⚠ 默认 HEAD 读不到未提交改动（判据 78），所以 `--check` rc=0 在这一笔里不代表成果。

**验收读数**（全部取在最后一枚**代码**编辑之后，判据 89；本笔 `HOME` = `/tmp/k101_home`，读数带这个条件，
判据 154）：
- `tests/unit/app/crons` 改前 **163 passed / 4 skipped / 0.88 s** → 改后 **167 passed / 0 skipped / 1.00 s**。
- CI 选择集（`tests/unit --ignore=tests/unit/channels -p no:randomly`）**15 failed / 15,707 passed /
  23 skipped / 4 xfailed / 762.05 s**。收集 **15,749** 与 8.22 的 AFTER 逐位相同 ⇒ 本笔没换收集口径。
  差额闭合：skipped −4 = 去 skip 的四枚；failed −8 = 8.22 那 8 枚环境/负载枚（acp 两枚
  `did not fire within 5.0s`、`shutdown_lifecycle`、`shutdown_deadline_integration`、
  `test_terminal_availability`、四枚 `test_multi_agent_manager_startup.py` subprocess 超时）这轮全绿；
  新进集 1 枚 = `test_safety_checks.py::test_b1_normalize_before_home_glob_match`，机制读到函数字节：
  `safety_checks.py:345 _HOME_TOP_LEVEL = frozenset({"home", "users"})` + `:443` 只看路径首段 ⇒
  `../*`（cwd = `$HOME/project`）在 `/tmp` 下的 HOME 里首段是 `tmp`，不被判 catastrophic。两态实测：真 HOME
  单文件 **158 passed**、隔离 HOME 单文件 **1 failed / 157 passed**，且把 `$HOME/project` 建出来照旧红 ⇒
  判 HOME 形状，非负载、非本笔（判据 154 的第三种成因）。选择集 `FAILED` 名单里 `tests/unit/app/crons` **0 枚**。
- L1 must-pass 五目录（`unit-tests.yml:112-119` 现枚举）真 HOME **1,336 passed / 1 skipped / 7.19 s**，
  与 8.20/8.22 同计数；同一批在 `/tmp/k101_home` 下多出的那 1 枚就是上面这枚（判据 154 直接命中）。
- 门禁按 CI 定义现枚举（判据 92）：`unit-tests.yml:68/84/89/94` + `tests.yml:207` + `local-gate.sh:24-27`
  共 6 条，全 rc=0。locale 串与 8.22 逐字相同（`4658 production gated keys / 59 template key families gated /
  7 exempted / 1459 overlay keys en/zh / 23 upstream-owned keys exempted`）；namespace 门禁本机
  `qwenpaw_upstream_main` 不可解析（无该 remote），改用 `--upstream-ref agentscope-ai/main` ⇒
  `copaw_only_count: 6`、delta 三项 0、`result: PASSED`；发布渠道 `R1-R5 over 6 channel files`；
  CI 命令目标 `16 run commands across 3 package dirs`；channel contracts 18 渠道 OK；pipeline `0 issues`。
- flake8 三枚文件：`heartbeat.py`、`heartbeat_quality_loop.py` **0 处**；`test_heartbeat.py` **4 处 E501**
  全是未动的既有行（两枚函数签名 + 两枚 dict 字面量），同文件 HEAD 副本 **10** 处 ⇒ 净 −6、新增 0。
  CI 无跑 flake8 的 workflow（判据 73），这一项是本地约定不是门禁。
  **⚠ 2026-10-11 刀 102 就地作废这一句**：`.github/workflows/pre-commit.yml` 跑 flake8/black/mypy/pylint 且本分支连续 ≥8 次全红（判据 162）；
  本 bullet 用的未固定版本 flake8 读数按判据 163 属"不可比"，只有"净 −6、新增 0"的方向在锁定版本（`~/.cache/pre-commit/reposrj6vl_p/…/flake8`，6.1.0）下重取照旧成立。
- 前端一枚文件未改 ⇒ vitest / tsc / prettier 不在本笔验收范围。

**没量什么**：合并到 tip 后 CI 干净 HOME 的实际读数（本机取不了）；`append_quality_loop_digest` 在真机
workspace 上产出的摘要文本没做人工复看，只有四枚用例断言；`memify_enabled=True` 时真起
`maybe_start_quality_self_drive` 的端到端（用例打的是替身）。

### 8.25 本笔新增判据 157–161

- **157（skip 理由引用的机制要分两层读，再判修/删）**：那四枚 skip 的理由串指向
  `_collect_project_quality_loop_digest`。只读"这个 helper 在不在 `src/`"会得出"能力已死 ⇒ 删用例"；
  再读"它调的子系统合同活不活"（这里三处都活着，`graph_ops.py:492/860`、`knowledge.py:2000`）结论翻成
  "helper 没了、能力还在 ⇒ 这是改名吞掉的欠条"。判"这枚能力还有没有价值"必须先做能力面的第二层取证。
- **158（恢复一笔被改名吞掉的能力，落点按下一次合并的冲突面定价，不按 donor 的形状）**：同样四枚用例绿，
  195 行重放进上游宿主 vs 227 行放进 fork 自有新文件 + 宿主 6 行。后者把册涨幅从 195 压到 6、把宿主冲突
  从整枚文件压到 6 行可重放，新文件按定义零债。落点选择不是风格问题，是给未来的自己少开一次冲突。
- **159（"我是第一枚被 offload 的调用"这类断言会在宿主自己开始 offloading 之后变成不可达）**：宿主的
  `run_sync_io(get_heartbeat_config, …)` 让 `patch()` 装的 MagicMock 成为第一枚被扔进线程的可调用对象，
  而 MagicMock 无 `__name__`。搬运旧断言必红在 `AttributeError: __name__`；正确做法是先打印整条序列
  （这里五元素），再写成"容忍无名 + 正向断言成员"。
- **160（红读数必须先分类，而"分类"的证据要取到函数字节）**：这枚 `tool_guard` 用例在两态 HOME 下单文件跑就
  翻面，建目录不改结果 ⇒ 机制是 `_HOME_TOP_LEVEL = {"home","users"}` 的首段假设。没有那两处字节，
  我会在册上把它写成"又一个 HOME 泄漏"，而它其实是"被测函数的路径形状假设 + 隔离 HOME 的选址"。
- **161（`--check` rc=0 在有未提交改动时是空读）**：P1 门禁默认 `--target-ref HEAD`，本笔五处红全部只在
  `--target-ref working` 下存在。任何"门禁绿了"的陈述都必须带上它读的是哪一态，否则一张还没进账的欠条
  会以"通过"的面目出现（判据 78 的第二次咬人）。

**待裁（本笔之后仍开放，都不在刀序里）**：8.22 待裁 ①（#4185 保护在新库下失效要不要生产侧补）、
待裁 ③（`~/.copaw` 密封：74 处导入期 `WORKING_DIR` 绑定 vs 一枚 autouse patch）、
以及 8.22 末那条 `SkillPoolService` / `get_workspace_skills_dir` 影子。本笔新登记的候选不是刀，
是选址约定：以后为测试卫生选隔离 HOME，应选形状与真 HOME 同族的目录（`/Users/…`、`/home/…`），
不要放在 `/tmp` 下（判据 160）。

**待裁（刀 99 之后仍开放）**：`SkillPoolService` / `get_workspace_skills_dir` 那对影子 —— 现网跑的是我们
保留的 `agents/skills_manager.py` 那份（14/15 方法体与上游 `agents/skill_system/` 不同，上游另多 4 枚自动化/改名
方法）。要么按裁决 2 跟着上游删、把 `agents.py` 的 import 翻到 `skill_system`，要么留我们那份并承认这是 fork
自有能力。这需要产品侧一句话，不是合并能自动答的。

### 8.26 刀 102：合并本身落地（`24661da15`），并在新分叉点重立基线（`c7ee64a01`）

8.23 末句"下一个动作只能是合并本身"就是本笔的范围。按裁决 ① 一次合到 `upstream/main` tip（不取 `v2.2.1`
tag）；授权来自用户常设指示"尽快把这 1201 个提交追上"——`git fetch` 与上游合并在 push policy 里平时都要问，
这一句把它们覆盖了。

**合并事实**：`24661da15`（2026-10-11 08:47），父 `2bb510b85`（我们，刀 101 之后的第一笔）+ `2744a976b`（上游）。
吸收 `ddd8408eb..2744a976b` 共 **16 枚提交**，tip 是 `fix(hub): respect administrator token capability overrides
(#8169)`（2026-10-10）。`git diff --shortstat 24661da15^1 24661da15` = **99 files changed, +5,567 / −555**。
合并后 `HEAD..upstream/main` = **0** ⇒ 上游 tip 已被完整吸收。旧基线 `ddd8408eb`（2026-10-09 那次合并的落点）
经 `git merge-base --is-ancestor` 确证是 `2744a976b` 的祖先，所以这 16 枚是**直线补齐**、不是第二次大合并 ——
这一点决定了下面的手解量。

**手解的落点只有四枚，全在 `console/`**（Python 侧这次一枚手解都没有；重活是 8.1 那笔 117 枚冲突做的）。
commit message 首句写"3 content conflicts resolved"、正文列四条，两个数不一致 ⇒ 本节按**手改文件枚数**记 4：
- `console/src/utils/lazyWithRetry.ts`（册 **+38/−4**）：取上游的 recovery 重写
  （`loadImport` / `recoverableLazy` / `lazyImportFailure`），再重放 fork 四处增量——`92a988ca1`
  "prevent route-switch loading hangs" 那 12 s `IMPORT_TIMEOUT_MS` + `withImportTimeout`（上游那套机制救的是
  **被 reject 的 import**、不救**挂住的** import，所以保留它不是冗余）、显式扩展名的 `pathToModuleKey`、
  `pathFromGlobKey`、单文件 `.tsx`/`.ts` glob 解析链。
- `console/src/utils/chunkRecovery.ts`（**+1/−1**）：`isChunkLoadError` 加 `|chunk import timed out`。
  fork 原本把这条谓词扩在 `ChunkErrorBoundary` 的本地副本里，上游把谓词搬到了 `chunkRecovery` ⇒ 落点跟着搬。
- `console/src/components/ChunkErrorBoundary.tsx`：**退回上游字节**（本地那份 `isChunkLoadError` 的归宿就是上一条）。
- `console/src/pages/Settings/Agents/index.tsx`（**+47/−25**）：跟上游删 `PageHeader` 的 `parent` prop，
  留 fork 的 tab 相关 `current` 标题。

**三方对账（裁决 ④ 的落地）**——同一棵树、三个基线口径，全部 `check_p1_invariants.py --json` 现取：

| 口径 | base → target | files / + / − | 行为 files / + / − |
| --- | --- | --- | --- |
| A 合并前树 vs 旧基线 | `ddd8408eb` → `2bb510b85` | 114 / +10,947 / −517 | 113 / +10,912 / −482 |
| B 合并后树 vs **过期**旧基线 | `ddd8408eb` → `c7ee64a01` | 182 / +14,354 / −1,055 | 181 / +14,319 / −1,020 |
| C 合并后树 vs 新基线（已提交） | `2744a976b` → `c7ee64a01` | 114 / +10,950 / −518 | 113 / +10,915 / −483 |

于是两件事被分开量：这笔合并的**真实成本 = A→C，0 枚文件、+3 行、−1 行**（命名 1·7·35 与 mechanical 1 照旧），
而 B 相对 C 多出的 **68 枚文件 / +3,404 / −537** 全是"基线过期"造出的幻影——那 68 枚是上游自己在这 16 枚提交里
动的宿主，我们并没有改它们。**不重立基线，这笔合并会被读成"P1 债涨了 3,404 行"**，而 `chore(p1)` 那一笔
（`c7ee64a01`，写 `base_ref: 2744a976b`）买的正是这一点（判据 61 那一族的又一次落地）。
新基线的 `--check` 现读 rc=0：`P1 upstream-owned files modified: 114 (+10950/-518) … P1 invariants hold`。

**验收读数**（`HEAD` = `c7ee64a01`、`git status --porcelain` 空；`HOME=/Users/futuremeng/.k102home`，判据 154；
lint 两枚工具取 pre-commit 缓存里的**锁定版本**环境，判据 163；两态对照用的合并前 worktree =
`/tmp/k102-pre` @ `2bb510b85`、**共享同一份 `console/node_modules`**；纯上游参照树 = `/tmp/k102-upmain` @
`2744a976b`）：
- **前端全量**：532 files / 4,948 cases，两轮 242.58 s / 265.86 s。**红 17 枚文件 = 12 枚收集错误 +
  5 枚断言文件（分别 3 / 7 / 3 / 1 / 10 条 = 24 条红用例）**。同一依赖状态下合并前那棵树跑出**逐文件、
  逐用例相同**的 17/24 ⇒ **本笔合并造红 0**（判据 166；§8.24 记的"前端基线 75 文件 / 482 用例"在这一版
  依赖状态下已经不能用来判红）。
  17 枚按根因分四族，四族都不是合并造出来的：
  (a) 12 枚收集错误 = fork 自有 `console/vitest.config.ts` 的**前缀 alias** 把 `@agentscope-ai/design` 整族
  吃掉，深路径（`/lib/i18n` 等）被改写进 mock，`deps.inline` 的正则又排除 icons/chat/design ⇒ 判据 165；
  **【→ 8.30 现量拆分：那 12 枚里 `design` 只占 1 枚，9 枚是同一形状的 `@agentscope-ai/chat` 前缀，另 2 枚
  （`Sidebar.test.tsx`、`ProjectDetailPage.test.tsx`）与前缀 alias 无关。本句的"整族"当成 design 族是错的归属。】**
  (b) `register.test.ts` 7 条 + `i18n.test.ts` 3 条 = overlay 注册打在替身上；
  (c) `openExternalLink.test.ts` 10 条 = Tauri 命令 spy 一次没被调到
  （`AssertionError: expected "vi.fn()" to be called with arguments: [ 'open_external_link', …(1) ] /
  Number of calls: 0`，`:106`）；
  **【→ 8.30 已修并结清：根因 = 影子配置缺了上游 `vite.config.ts` 里 `@tauri-apps/api/core` 与
  `@tauri-apps/plugin-dialog` → `src/test/tauri-mock.ts` 那两枚 find，生产模块打到真包、用例手里的替身
  因此一次也没被调用；补上两枚 find 后 23/23 全绿。】**
  (d) 两枚案例级分歧：`Chat/OptionsPanel/defaultConfig.test.ts` 3 条（用例期望 `/online.svg`，生产给
  `/copaw-icon.svg`——那枚生产文件正是册里 7 枚"碰过的命名"文件之一，`naming: 1`、+2/−2）、
  `ProviderConfigModal.test.tsx` 1 条（`TypeError: default.getAgentRunningConfig is not a function`，
  栈指 `ProviderConfigModal.tsx:556`，fork 加的叫法，册 +236/−0）。
- **`tsc -b --force`**：**19 = 19**，两态规范化错误清单逐条相同 ⇒ 合并造类型错 0。
- **black（锁定 rev 23.3.0，钩子 `--line-length=79`，exclude 只有 `.*/skills/.*|^scripts/pack/|^e2e/`）**：
  offender **180 = 180** 枚文件，两态一致 ⇒ 合并增量 0。构成：`src/qwenpaw` 84、`tests/unit` 54、`src/copaw` 20、
  `scripts/` 15、其余（`tmp/` 与根目录散文件）7；按所有权分 = **册内上游自有 16 枚 / 册外 164 枚**
  （那 16 枚就是"顺手格式化会给上游宿主加删除行"的那批，判据 22/129）。纯上游树 `2744a976b` 同一选择集
  offender = **0** ⇒ 这 180 枚全是我们造成的形状。
- **flake8（锁定 rev 6.1.0，`.flake8` 的 `exclude = scripts/*, src/agentscope/rpc/*` 生效）**：
  **8,965 = 8,965** 处 ⇒ 合并增量 0。大头是 tab 缩进的 W191，集中在 `src/qwenpaw/knowledge/`
  （`hanlp_nlp_runtime.py` 单文件 992 枚、`project_pipeline_projection.py` 909、`project_pipeline_manager.py` 572）。
- **门禁按 CI 定义现枚举**（判据 92）全 rc=0：locale 串与 §8.24 逐字相同
  （`4658 production gated keys / 59 template key families gated / 7 exempted / 1459 overlay keys en/zh /
  23 upstream-owned keys exempted`）；namespace `shared 35 / copaw_only 6 / deltas 0 / PASSED`；
  brand `ledger replayable: 7 files / 35 lines`；发布渠道 `R1-R5 over 6 channel files`；
  channel contracts 18 渠道 OK；pipeline `templates_with_issues: 0`；
  **`ci command targets` 从 §8.24 的 `16 run commands across 3 package dirs` 变成
  `18 run commands across 4 package dirs`** —— 这是合并带进来的合法移动（上游新增一枚 package 目录），不是漂移。
- **`pytest tests/unit` 全量（含 `tests/unit/channels`，`-q --tb=line -p no:randomly`）**：
  **15 failed / 17,790 passed / 24 skipped / 4 xfailed / 1,026.08 s**。⚠ 这是"整个 `tests/unit`"口径，
  与 §8.24 那条"CI 选择集（`--ignore=tests/unit/channels`）15 failed / 15,707 passed"**不是同一个集合**，
  两个 15 是巧合同数、不是同一批。本笔这 15 枚 = `tests/unit/cli/test_cli_update.py` 11 枚 +
  `test_cli_update_overlay.py` 3 枚 = 发布渠道那 14 枚 `pending` 欠条（等阶段 2 授权，账在
  `project-copaw-release-channel`）+ `test_safety_checks.py::test_b1_normalize_before_home_glob_match`
  1 枚（判据 160 那一枚，本笔把它的机制读得更细了，见 8.27 判据 168）。
- **L1 must-pass 五目录**：**1,336 passed / 1 skipped / 19.80 s**，与 §8.20/§8.22/§8.24 同计数。
- **分支拓扑**：`main` = `5d5c0d572`，`HEAD..main` = **0**、`main..HEAD` = **1,250** ⇒ `main` 可直接快进；
  `HEAD..upstream/main` = **0**；`origin/sync/upstream-20261009` 落后本地 18 枚。

**"追上那 1201 枚"的验收口径**：GitHub 那行"1121 ahead / 1201 behind"比的是**被展示分支**与
`agentscope-ai/QwenPaw:main` 的祖先关系，**合并本身不改变它**（判据 167）——让 behind 归零的动作是把 `main`
（以及同处 `5d5c0d572` 的 `wp/integration`）快进到本分支。这就是本笔最后那个推送。

**两处自我更正**：
1. 本笔早期我说过"tsc 从 19 降到 16"——**撤回**：两态都是 19，且规范化清单逐条相同（上面那条是复测读数）。
2. §8.24 倒数第 8 行"CI 无跑 flake8 的 workflow（判据 73）"、以及判据 73 原文里"全仓**没有任何 workflow 跑
   flake8/ruff/black**"这一句（`2026-10-01-conflict-surface-backlog.md:808`）**已作废**，证据与教训记在
   8.27 判据 162；同一句里"`.flake8` 的 `exclude = scripts/*` ⇒ flake8 读不到 `scripts/`"仍成立，
   但"`scripts/` 无格式化门禁覆盖"对 **black 是错的**（black 钩子只排 `scripts/pack/`，现数 `scripts/` 下
   15 枚 offender）。§8.24 那条 flake8 三枚文件读数用的是未固定版本，按判据 163 属"不可比"，
   好在"净 −6、新增 0"的方向在锁定版本下重取照旧成立。

**没量什么**：CI 干净 HOME 下的实际读数（本机取不了）；`main` 快进之后的 CI 表现（快进是本笔之后的动作）；
上面 (b)(c) 两族红的根因只到"报错文本 + 栈指哪一行"，没做单枚最小复现——它们不是合并造的红，排在待裁里；
pre-commit 那道 workflow 的 pylint/mypy 逐枚清单没取（只取了 CI 给的汇总数）。

### 8.27 本笔新增判据 162–168

- **162（"仓里没有 X 门禁"这类否定判据必须由 CI 定义枚举支撑，而 `pre-commit` 那种两跳形态最容易被漏）**：
  判据 73 / 126 断言"全仓没有任何 workflow 跑 flake8/ruff/black"，据此把 lint 轴判成"不是债轴"。实测相反：
  `.pre-commit-config.yaml` 锁了 black 23.3.0 / flake8 6.1.0 / mypy v1.7.0 / pylint v3.0.2 / prettier v3.0.0 /
  actionlint v1.7.7，`.github/workflows/pre-commit.yml` 在 `on: push` + PR 上装 `-e ".[dev]"`、
  `pre-commit install`、`pre-commit run --all-files 2>&1 | tee pre-commit.log || true`，再用
  `grep -q Failed pre-commit.log` 决定退出。`gh` 读 `Pre-commit Checks`：本分支连续 **≥8 次 push 全部
  failure**（run 38097953005 @ `2bb510b85` 2026-10-11T00:18:02Z，以及 38074678871、38068118766、38067995705、
  38038384516、38007321720、37966684134、37959972296；单次 12–18 min）。run 38097953005 的钩子判定：
  **mypy Failed（Found 64 errors in 22 files，checked 2157 source files）、black Failed（183 行 "reformatted"）、
  flake8 Failed、pylint Failed**；check-ast / check-yaml / check-xml / check-toml / check-docstring-first /
  check-json 与 prettier Passed。⇒ **这个 fork 从来没有通过这道 workflow**，而它最容易被
  "grep workflow 里的 `black|flake8|ruff`"漏掉：钩子名不在 `*.yml` 里，`*.yml` 只写 `pre-commit run`。
  **否定判据的取证面要包含"外部工具自己的配置文件"，不能只有 workflow 文件。**
- **163（本地 lint 读数只在版本与被门禁锁定的版本一致时才算数；而 pinned 环境已经躺在 pre-commit 缓存里）**：
  同一棵树，随手装的 black 与门禁锁定的 **23.3.0** 给出的 offender 集合不同，两个数不可比。可复用的锁定环境
  不用新建 venv、不用装包：`~/.cache/pre-commit/repoucwzvhwz/py_env-python3.12/bin/black`
  （自报 `0.1.dev1+gbf7a16254`，CPython 3.12.11）、`~/.cache/pre-commit/reposrj6vl_p/py_env-python3.13/bin/flake8`。
  判据 73 的读数要作废，一半原因就是它拿的是未固定版本的本地数。⚠ 脱离 `.pre-commit-config.yaml` 直接跑工具
  会算错选择集：`--line-length=79` 与 `exclude: '(?x)(.*/skills/.*|^scripts/pack/|^e2e/)'` 都是钩子字段给的。
- **164（CI 日志是"每个钩子过/没过"的证据，不是普查；判数量要用 pinned 工具现数）**：同一棵树同一钩子，
  CI 的 flake8 段 **1,596** 行 findings，本地按 `.flake8` 的 exclude 取 CI 选择集是 **8,965** 处；
  `src/qwenpaw/knowledge/hanlp_nlp_runtime.py` CI 报 **334** 枚 W191，而 `git show HEAD:` 那份现数 **992** 枚
  tab；被 track、且不在任何 exclude 里的 `plugins/**`、`packages/**`（`motion_engine.py`、`mail_client.py`、
  `live_operation_guidance.py`）在 CI 日志里 **0 命中**。`--log-failed` 复跑内容一致，没有 `.gitmodules`，
  也没有能解释它的 gitignore 命中。**这条差异我没结清，留在册上当开放项**；它不影响本笔结论，因为两态对照
  用的是同一个本地 pinned 工具（增量 0），而判"红/绿"用的是 CI。**⇒ 一份日志能支撑的断言类型，要看它的
  收集面是不是和你要量的那个面一致。**
- **165（fork 自有的前缀 alias 会静默杀掉一整族深路径导入；红要先按"收集错误 / 断言失败"分类再数）**：
  `console/vitest.config.ts` 把 `@agentscope-ai/design` 整个**前缀**重写到 `src/test/design-mock.ts`，
  于是 `@agentscope-ai/design/lib/i18n` 这类深路径也被改写进 mock，而 `deps.inline` 的正则
  `[/@agentscope-ai\/(?!icons|chat|design)/]` 恰好把这三族排除在 inline 之外 ⇒ **12 枚测试文件在收集期就死，
  一条用例都没跑**。它们在"红文件数"里和真正的断言失败长得一样，实际是**覆盖丢失**：本笔那 17 枚红里有 12 枚
  根本没有用例。alias 只列 SDK 根 + 一枚 `types.js` 子路径，等于宣告"其余深子路径不可解析"。
  **⇒ 判"套件覆盖了什么"之前，先把收集错误单独列一张表；它不是红，是"没测"。**
- **166（全量红集合要和"同一 `node_modules` 的合并前 worktree"两态对照，不能对记忆里的基线串）**：
  我原本拿 §8.24 记的"75 文件 / 482 用例"去判这次的 17 枚红 / 24 条，会得出"合并砍出 24 条红"并开一笔修复账。
  在 `/tmp/k102-pre`（`2bb510b85`，**共享同一份 `console/node_modules`**）跑出与 HEAD **逐文件、逐用例相同**的
  结果之后，结论翻成"合并造红 0，24 条是既有债"。代价是一次全量跑（本仓 4–5 min）。锁文件或依赖版本一变，
  历史基线串立刻失效——它连自己量的是哪份依赖状态都不记得。同一手法在本笔还量出 tsc 19 = 19、
  black 180 = 180、flake8 8,965 = 8,965；纯上游树 `/tmp/k102-upmain` @ `2744a976b` 用来回答
  "这是上游自己的形状还是我们造成的"（同一选择集里上游 black offender = **0**）。
- **167（"behind N commits" 是展示分支的祖先关系读数，不是合并的读数）**：合并让 `upstream/main` 被吸收
  （`HEAD..upstream/main` = 0），但 GitHub 那行"1121 ahead / 1201 behind"比的是**报告分支**与
  `agentscope-ai/QwenPaw:main`；`main..HEAD` = 1,250、`HEAD..main` = 0 ⇒ 只有把 `main` 快进过来那行才归零。
  任何"追上上游了没有"的验收必须指明是哪条分支相对谁，否则一笔已完成的合并会因为报告分支没动而"看起来没做"
  （判据 20 执行侧的第二例：验收口径要从被展示的那条分支倒推，不能从工作分支自证）。
- **168（选址类"临时缓解"要按被测函数的判定维度给，不能按"看起来像真家目录"给）**：判据 160 教的是"为测试卫生
  选隔离 HOME 时选 `/Users/…` 形状，别放 `/tmp` 下"。本笔在 `HOME=/Users/futuremeng/.k102home` 下那枚
  `test_b1_normalize_before_home_glob_match` **照旧红**，机制读到字节：`safety_checks.py:344` 注释与 `:439-444`
  写的是 `if top in _HOME_TOP_LEVEL: return len(parts) <= 3` —— 家目录树只在**深度 ≤3**（`/Users/<user>`）时被判
  catastrophic，而 `../*` 从 `$HOME/project` 归一化到 `/Users/futuremeng/.k102home` 是 **4 段** ⇒ 判不出来。
  也就是说 `/tmp` 形状（首段不在 `{home, users}`）与"更深的一层 HOME"（首段对但深度超）**两种选址各因一因**，
  而只有 `HOME` 本身恰好是 `/Users/<单段>` 才满足这枚用例的假设。**⇒ 一条"换目录就好"的建议必须写成被测判据的
  形式（这里 = 首段 ∈ {home,users} 且 len(parts) ≤ 3），否则它只是把红从一种成因换成另一种。**

**待裁（刀 102 之后新增，都不在刀序里）**：(a) 那 12 枚被前缀 alias 杀掉的收集错误要不要修
`console/vitest.config.ts` 的 alias 形状（候选改法：按子路径逐条 alias，或把 `@agentscope-ai/design` 从 alias
里摘掉改走真实包）—— 它买回的是 12 枚文件的覆盖，不是"多几条绿"；
**【→ 8.30 已裁"修"并落地：真实形状 = 数组 + exact-match `find`，另补上游有而影子配置缺的两枚 `@tauri-apps/*`
find。实测买回 10 枚文件 / +274 条用例，另有 2 枚收集错误与前缀 alias 无关、留给 (b)。】**
(b) 8.26 (b)(c)(d) 三族共 12 条断言红的逐枚归因【**数错了，现账 = 24 条 = (b) 10 + (c) 10 + (d) 4**，判据 171；
其中 (c) 那 10 条已由 8.30 修掉、8.30 又新暴露 `longTextPaste` 6 条 ⇒ 现存 20 条：10 − (b) + 4 (d) + 6 新 = 20】；
(c) 判据 164 那条"CI 日志 vs 本地选择集"的差异要不要结清【已在 8.29 结清，2026-10-11】；(d) 判据 162 之后 lint 轴**是**门禁了
（black 180 枚 / mypy 64 错 / flake8 8,965 处 / pylint 亦红），要不要排刀。本笔的处置是**不排**，理由与实测都记在
这里：180 枚里 164 枚在册外、16 枚是上游宿主，格式化那 16 枚会给上游文件加删除行（判据 22），而只修几枚
fork 自有文件也不会让这道 workflow 转绿（它还红在 mypy / flake8 / pylint 上）——已实测一次
`pre-commit run black` 就地改写了 3 枚 tracked 文件（`agents/skill_system/__init__.py`、`app/_app.py`、
`app/routers/skills.py`，196 行 diff 存 `/tmp/k102_black_diff.txt`），确认树原本干净且 diff 全是 black 的换行后
用 `git checkout --` 撤销。**这笔账的形状是"一条从未绿过的全仓门禁"，它要的是单独一次裁决，不是顺手修。**

### 8.28 旧账清扫（2026-10-11，**不是刀**）：7 处旧断言就地作废 + 判据 169–174

**为什么单独立一节**：判据 170 立的是"作废旧断言要落在**原句那一行**"。理由是账册不按顺序被读：一条更正如果只写在下游新段落里，
而读者是从中间某句取前提的（取验收表那一行、取判据 126 那一句），那处旧句对他仍然是活的。本笔按这条口径把两本账里被刀 102 的
新证据推翻的话逐句画掉，**没有闭环任何新的去债成果** ⇒ 本节末"已闭环"计数照旧停在 **102**。

**已作废（7 处，全部就地标记，可 grep `2026-10-11` 复现）**：
1. 本文验收表 `:550` —— "全仓无 workflow 跑它 ⇒ 本地口径"。`.pre-commit-config.yaml` **是有 prettier 钩子的**（`mirrors-prettier v3.0.0`、
   `files: \.(tsx?)$`、`exclude: '(?x)(^web/|^console/|/dist/|.*/skills/.*|^scripts/pack/)'`，逐字节取自配置），CI 判 **Passed**；
   钩子选择集现数 **363 个 ts/tsx 文件**（`git ls-files '*.ts' '*.tsx' | grep -vE '(^web/|^console/|/dist/|.*/skills/.*|^scripts/pack/)' | wc -l`）。
   那 144 枚脏全住在被排除的 `console/` 里 ⇒ "**这 144 枚**没有 CI 读者"成立、"仓库没有 prettier 门禁"不成立（判据 173）。
2. 本文判据 126 原句 `:619` 划掉 ~~全仓零 workflow 跑它~~，续行 `:621-623` 落上面那条结论（同一件事的两半：归属证据照旧有用，遮蔽理由作废）。
3. 本文 §8.24 bullet `:1319-1320` —— "没有检查会因它红"，且该 bullet 用的**未固定版本** flake8 读数按判据 163 属"不可比"；
   只有"净 −6、新增 0"这个方向在锁定版本（6.1.0）下重取照旧成立。
4. `2026-10-01-conflict-surface-backlog.md:466`（刀 74 的格式化括号）—— "`scripts/*.py` 不在任何格式化门禁里"分轴作废：对 flake8 成立
   （`.flake8` `exclude = scripts/*`），对 black **不成立**（钩子只排 `scripts/pack/`，`scripts/` 下现数 **15 枚 offender**）。
5. 同文 `:470`（刀 76 ⑥ 与其未办 (vi)，同一行）—— "全仓没有任何 workflow 跑 flake8/ruff/black" 整句作废（那道 workflow 每次 push 与 PR 都跑，
   本分支连续 ≥8 次全红），连带 75 那条"新 Python 文件 flake8 rc=0"的读数解释一起更正。
6. 同文 `:686`（判据 12 尾句）—— "仍然没有任何检查会因它红"划掉；结论不变，但改由"修册外文件不会让那道 workflow 转绿 +
   格式化册内上游宿主是往上游文件加删除行（判据 22）"支撑。
7. 同文 `:808`（判据 73 双句）—— 与 5 同一件事的另一处（已在上笔提交里画掉，此处只登记入清单）。

**照旧留历史原样的 5 个半句**（判据 170 不要求逐处涂改，因为它们**仍然成立**，只是不再足以支撑结论）：
`pyproject.toml` 无 `[tool.black]`/`[tool.ruff]`；CI 只有 `website` 与 `console` 两个 `format:check`；prettier 现树 144 枚脏；
flake8 锁定版本下 CI 选择集 8,965 处【→ 8.29：这一串没固定成命令、选择集与现算那条不同轴，现量以 **8,779 行 / 164 枚文件** 为准】；
`.flake8` 的 `exclude = scripts/*, src/agentscope/rpc/*`。
这五串**只要求标注选择集**（判据 172），不要求改写。**（→ 8.29 补记：这五串里的 flake8 `8,965` 后来被证明没固定成命令、
与现算那条不同轴 ⇒ 已就地标注为历史读数。所以"5 个仍成立"现读作 **4 个仍成立 + 1 个代**，判据 170 的"仍成立"判据自己也要重跑。）**

**本笔新增判据 169–174**

- **169（分母不许从旧表继承）**：换基线时那张旧表的"总数"不能再当分母用。实例 = 记忆里的"册 114 里只 100 真冲突"这类推断，
  它的坐标轴是 `e111ec6fb → 旧 upstream/main`，而新基线的 `total_files: 114` 里**含 1 枚 mechanical 锁文件**（判据 101 那条口径），
  两数不同轴 ⇒ 换分叉点时必须显式写"这个分母没有来源了"，只更新被减数会造出一个看似能对账的假比例。
- **170（作废旧断言的位置 = 原句那一行，不是下游新段落）**：本笔实测代价 = 判据 126 那一句要占 3 个位置（验收表行、判据句、续行）
  才对得起"读者从任何一处进来都不被误导"。边界：历史刀账（刀 73/74/75/76 的落地段）里**当时真测到**的数字不涂改，
  只在它被下游当复用的前提时加标记 ⇒ 11 处里 7 处画掉、5 个半句留原样。
- **171（按需重放不出来的数不许进账，或必须写明它依赖什么）**：本笔自己三次被抓：prettier 选择集先写 **364**（凭一次 `wc -l` 的记忆），
  重跑实测 **363**；一条 bullet 断言"判据现最大 168"时那一半还没有来源；"18 枚里 16 枚在册内"没做逐枚对账 ⇒ 删。
  判据形态：每个数要么附可重放命令，要么写成"读数依赖 X"（X = HOME / 负载 / 版本 / 选择集）。
- **172（一份 CI 日志能支撑什么断言取决于它的收集面）**：同一件 flake8 事实在本笔前后有**四次互不可比**读数 ——
  CI 日志 **1,596** 行 / CI 选择集本地实跑 **8,965** 处 / 去掉 exclude **4,624** / 全仓 **11,178**，每次都换了选择集或数法，
  且都没固定成一条可重放命令。⇒ 判"红/绿"只用 CI，判"多少处"只用一次固定选择集的实跑，**两边不许互引**。
  这条把 8.26 待裁 (c) 从"待结清"升级为"口径已定、量级仍开放"。**（→ 8.29 已判结清：四次读数的归属与两条可重放配方都在那里，
  机制 = flake8 前面的改写钩子换了它的对象，见判据 175。）**
- **173（判据 162 的第二种遮蔽：钩子存在但它的 `files`/`exclude` 不含你要断言的那批文件）**：这次不是没看到钩子，而是看到了钩子
  **没读它的 `exclude` 字段**。结论同向（那 144 枚确实无 CI 读者），理由完全不同 ⇒ 同一条判据的两种错法要分开记，不能合并成"又是门禁盲区"。
- **174（第三种遮蔽：中间那一跳）**：在 `*.yml` 里 grep `flake8|black|prettier` 必然得 0，因为 `pre-commit run --all-files` 把钩子名
  吞在日志里而不写进 YAML；`pre-commit.yml` 用 `tee pre-commit.log` + `grep -q Failed` 定退出，钩子名因此**从不出现在 workflow 正文**。
  ⇒ "仓里有没有某类门禁"必须读 `.pre-commit-config.yaml` 的 `hooks[].id`，从 workflow 反查工具名是判据 162 那一次漏判的机制。

**未办**：本笔没重开任何 lint / vitest / HOME 侧的刀，也没重跑合并前的两态 worktree（那两份临时树已删 ⇒ §8.26 的 vitest/tsc/black/flake8
两态对照是**当时实测**、不是本笔复算）；待裁清单照旧是 8.26 末那 (a)–(f)，其中 **(c) 已由 8.29 判结清**。

相关账目：本节 = 已闭环 **102**（刀 94 = 8.9 那笔，裁决 (b) 的落地；刀 95 = 8.11 那笔，8.10 里唯一一枚生产侧；
刀 96 = 8.14 那笔，8.10 里其余 14 枚测试侧；刀 97 = 8.16 那笔，8.14 待办 ① 那枚生产侧签名；
刀 98 = 8.18 那笔，8.14 待办 ① 剩下的 2 枚测试侧红；刀 99 = 8.20 那笔，8.18 末句登记的那 6 枚 migration 红；
刀 100 = 8.22 那笔，8.20 验收读数里剩下的 14 枚散枚红；刀 101 = 8.24 那笔，8.22 待裁 ② 那 4 枚自 skip 的用例；
刀 102 = 8.26 那笔，8.23 末句"下一个动作只能是合并本身"落地（16 枚提交 + 4 枚手解宿主）+ 新分叉点重立基线；
刀 103 = 8.30 那笔，8.26/8.27 待裁 (a) 那 12 枚收集错误的 alias 形状）；
判据 113–128 原文在本节 8.7、129–136 在 8.12、137–141 在 8.15、142–143 在 8.17、144–147 在 8.19、148–151 在 8.21、
152–156 在 8.23、157–161 在 8.25、162–168 在 8.27、169–174 在 8.28、175 在 8.29、176 在 8.30（§1–§6 引用的 84–86、101–112 仍是
`2026-10-07-trial-merge-conflict-table.md` 与本文前七节的口径）。
**8.28 不是刀**：它没有闭环新的去债成果，只按判据 170/171 就地作废 7 处旧断言（另有 5 个仍成立的半句只加选择集标注、不改写）、
并新开判据 169–174，所以"已闭环"计数照旧停在 **102**。

### 8.29 flake8 四次读数的结清（2026-10-11，**不是刀**）：CI 那 1,596 行量的不是提交树

**一句话结论**：`pre-commit run --all-files` 是一条**含改写型钩子的流水线**
（`fix-encoding-pragma` → `trailing-whitespace` → `add-trailing-comma` → mypy → `black` → `flake8` → `pylint`），
排在后面的 `flake8` 量的是前面四支改写后的树，不是提交树。⇒ 8.26 待裁 (c) **结清**，判据 172 那句"四次互不可比"有了归属。

**两条配方**（都在 HEAD `996348917` 上现算；选择集 = `git ls-files '*.py' | grep -E -v '(.*/skills/.*|^scripts/pack/|^e2e/)'` ⇒ **2,765** 枚，
与 flake8 钩子的 `exclude` 一致；工具 = pre-commit 缓存里的那两套 env：flake8 `6.1.0 (mccabe 0.7.0 / pycodestyle 2.11.1 / pyflakes 3.1.0)`、
black `--line-length=79`；`scripts/` 那 20 枚被 `.flake8` 的 `exclude` 吃掉，实测同一批文件 `--isolated` 得 **223** 处、不加 `--isolated` 得 **0** 处
⇒ 排除确实生效，两侧一致）：

| 量什么 | 命令 | 行数 | 文件数 | 逐码 |
|---|---|---|---|---|
| **提交树** | 选择集 → `flake8 --extend-ignore=E203` | **8,779** | **164** | W191 4,318 / E501 4,060 / E101 143 / W292 67 / W293 50 / E122 50 / E402 34 / F811 25 / E302 9 / F841 8 / E231 5 / W291·E305·E303·E226 各 2 / E131·E127 各 1 |
| **CI 的树** | 同一选择集按序过那四支改写钩子（black 重排 **183** 枚）→ 同一 `flake8` | **1,598** | **101** | E501 861 / W191 334 / E101 334 / E402 34 / F811 25 / F841 8 / E226 2 |
| **CI 实际日志** | run `38107979080` @ `996348917` 的 flake8 段（`:1038-2637`） | **1,596** | **101** | E501 861 / W191 334 / E101 334 / E402 34 / F811 25 / F841 8 |

**差的 2 行**是 `tests/unit/knowledge/test_graphify_provider.py:194:28` 与 `tmp/rerun_ner_no_status_poll.py:18:56` 两处 E226；
CI 整份日志里 E226 **0 命中**，而同一文件的另一行（`:289:80 E501`，宽度都是 96）两边逐字相同
⇒ black 的产物一致，差异在 flake8 那一侧。候选解释 = CI 现装 rev 6.1.0 时 pycodestyle 解析到的补丁版与本地缓存 env 的 2.11.1 不同（E226 在
pycodestyle 的 `DEFAULT_IGNORE` 里，`.flake8` 的 `ignore` 是否会清掉它取决于版本）。**不追**：2/1,596 = 0.13%，不动任何裁决。

**最小对拍**（不必整树，随时可重放）：`src/qwenpaw/knowledge/hanlp_nlp_runtime.py` 提交树 **143 E101 / 140 E501 / 992 W191**
→ `black --line-length=79` 后 **334 E101 / 102 E501 / 334 W191**，与 CI 对该路径的计数**逐码逐字相同**。

**顺带结清两处旧数**：
1. **180 vs 183**：8.27 记的"black 180 枚"是**提交树**上的 would-reformat；本节 183 是**前三支改写钩子跑完**后 black 实际重排的枚数。
   同一机制的小尺寸版本，不是漂移。
2. **8,965**（`:1424`、`:1483`、`:1502`、`:1522`、`:1553`、`:1568` 六处引用）没有固定成命令、选择集与现在这条不同轴（差 186 行，未逐枚对账）
   ⇒ 按判据 171 以 **8,779** 为现算准，那六处的"8,965"是历史读数、不再当分母用；4,624 与 11,178 是另两种选择集（去掉 exclude / 全仓），同样不再引用。

**判据 175（一条 lint 读数必须标明它量的是哪棵树）**：同一份 CI 日志里，报告型钩子的**对象**由排在它前面的改写型钩子决定，
日志本身不会写明这一点（`- hook id: flake8` 只写钩子名）。⇒ 引用任何 lint 数字前必须回答"提交树还是改写后"，
并给出所选树 + 选择集 + 工具版本三件；否则同一件事会出现四个互不可比的数（这次就是 1,596 / 8,965 / 4,624 / 11,178）。
边界：判据 172 说"判红绿只用 CI、判量级只用于一次实跑"仍然成立，本节把它补齐的是**为什么**两边不可互引（不只是"收集面不同"，而是"量的不是同一棵树"）。

**本节不是刀**：没改任何生产或测试文件（对拍全在 `/tmp`，临时 worktree 已 `git worktree remove`），只把 8.26 待裁 (c) 判结清、
并新立判据 175，所以"已闭环"计数照旧停在 **102**。

### 8.30 刀 103（2026-10-11）：影子 `console/vitest.config.ts` 的 alias 形状漂出上游，静默杀掉 12 枚测试文件

**落点**：`console/vitest.config.ts`（fork 自有、**册外**：`grep -c vitest scripts/p1_baseline.json` = 0 ⇒ 零冲突面代价）。
只此一枚文件，+39/−25（含把这枚文件本身格式化到 prettier 干净的那几行）。

**机制**：vitest 的配置查找顺序里 `vitest.config.*` **赢过** `vite.config.*`，所以 fork 这枚影子文件不是"补充"上游配置，
而是**整份替掉**它（`plugins`、`css.modules`、`resolve`、`server`、`test.*` 全部换成影子文件里的字段，上游那套一次也不生效）。
替掉之后，影子文件里的 `test.alias` 用的是**对象**形状，而对象条目在 vite 里是**前缀子串**匹配：
`"@agentscope-ai/chat"` 会把 `@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/...` 逐条改写成
`<abs>/chat/lib/index.js/lib/AgentScopeRuntimeWebUI/core/...`（不存在的宿主），`"@agentscope-ai/design"` 同理会把
`@agentscope-ai/design/lib/i18n` 改写进 mock。上游 `vite.config.ts` 早就用**数组 + exact-match 正则**避开这件事
（它的注释原话 = "Resolve the beta's real ESM entry for Vitest, without masking SDK subpaths"），
影子文件既没跟上那个形状、又缺了上游的 `@tauri-apps/api/core` 与 `@tauri-apps/plugin-dialog` → `src/test/tauri-mock.ts`
两枚 find ⇒ 生产模块打到真包，用例手里的 `vi.fn()` 替身一次也没被调到。

**本笔改法**（把 `test.alias` 换成数组，finds 逐项对齐上游，再保留 fork 自己那枚 `.../AgentScopeRuntime/types.js` 替身）：
`/^@agentscope-ai\/chat$/` → 装好的 SDK 入口、`/^@agentscope-ai\/design$/` → `src/test/design-mock.ts`、
`@agentscope-ai/icons` → `icons-mock.ts`、两枚 `@tauri-apps/*` → `tauri-mock.ts`、types.js → `chat-runtime-types-mock.ts`。

**验收读数**（同一棵树、同一份 `console/node_modules`，只换那枚配置；配方 =
`cd console && npx vitest run --reporter=json --outputFile=<f>`，两态各一次，`HOME` 不参与）：

| 读数 | 改前 | 改后 |
|---|---|---|
| 收集到的测试文件 | 532 | **532**（枚数不动，因为收集错误的文件也占一枚行） |
| 跑到的用例 | 4,948 | **5,222**（**+274**） |
| 红文件 | 17 | **7** |
| 红用例 | 24 | **20** |
| `numFailedTestSuites` | 24 | **14** |
| JSON 时间跨度（`startTime` → 最晚 `endTime`，与 §8.26 那两枚 242.58/265.86 s 的墙钟数不同轴，判据 175） | 140.0 s | 186.5 s |

12 枚收集错误的真实拆分（**这一行更正 8.26 里"design 整族"的归属**）：
`design` 前缀只杀了 **1** 枚（`src/App.runtime.test.tsx`，改后 8/8 绿）、`chat` 前缀杀了 **9** 枚
（8 枚改后全绿，逐枚用例数 = `ChatPage.coverage` 86、`sdkHostIntegration` 95、`messageDisplay` 20、
`HostBubbles.test.ts` 13、`chatRunLifecycle` 13、`sdkSessionLifecycle.integration` 14、`turnEndedProvider` 12、
`HostBubbles.render` 2；第 9 枚 `longTextPaste.integration` 现在能跑了，11 条里 **6 条红**）、另 **2** 枚与前缀 alias 无关、改后照旧收集失败
（`layouts/Sidebar.test.tsx` = `instance.addResourceBundle is not a function`、
`Agent/Projects/tests/ProjectDetailPage.test.tsx` = `document.queryCommandSupported is not a function`）。
**对账**：那 10 枚改活的文件用例数逐枚相加 = 8 + 86 + 95 + 20 + 13 + 13 + 14 + 12 + 2 + 11 = **274**，
与表里 `numTotalTests` 的 +274 **逐枚闭合**。
断言红那边：`utils/openExternalLink.test.ts` 的 10 条**全清**（23/23 绿），这就是 8.26 待裁 (b) 里 (c) 那族的结清。
红用例的对账：24 − 10（Tauri） + 6（`longTextPaste` 新暴露） = **20** ⇒ 与表里那个 20 一致，本笔**净造红 0**。

**旁证**：`npx vitest run src/App.runtime.test.tsx src/utils/openExternalLink.test.ts
src/pages/Chat/chatRunLifecycle.test.ts src/pages/Chat/messageDisplay.test.ts` = 4 files / 64 cases 全绿、5.30 s
（改前这四枚里三枚是收集错误、一枚 10 条红）；`npx tsc -b --force` = **19 = 19**（错误清单没动）；
`scripts/check_p1_invariants.py --check` = **114 文件 / +10,950 −518、rc=0**（落点册外，账册零变化）；
`npx prettier --check vitest.config.ts` 改前红、改后绿（顺手把这枚文件本身格式化了一次，属同一文件）。

**新暴露那 6 条的归属（本笔只登记、不裁）**：`longTextPaste.integration.test.tsx` 与它的宿主
`src/pages/Chat/LongTextPaste.tsx` 对 `2744a976b` **逐字节相同** ⇒ 不是 fork 改坏的生产代码；用例找的是
antd `Modal` 里的"Paste as text / Attach as file / Cancel"三枚按钮（文案在册内 `en.json` 的
`chat.longTextPaste.*`），报错是 `Unable to find role="button"`，而同一文件里那 5 条"不该有弹窗"的用例全绿
⇒ 弹窗路径整条没渲染。它是随 8.26 那笔上游合并进来的（`610efd539`，2026-10-08），在影子配置下从进场第一天就是收集错误。
候选成因 = 影子配置替掉的**其余**字段（`plugins: [react(), startupMonitorPlugin(), cssStubPlugin]`、
`css.modules.localsConvention/generateScopedName`、`define` 的 loadEnv、`test.exclude` 里的 `**/src/tauri/**`、
`test.coverage`），不是 alias。**这笔没动它们**：动了就是把上游那枚在册文件（`console/vite.config.ts` 在 P1 册内）的
行为整份搬进测试路径，属于 (b) 项的独立裁决。

**判据 176（影子配置文件是持续性义务，它的漂移不写"红 N 条"而写"少跑 N 枚文件"）**：一次替掉宿主配置的 fork 影子文件
必须在每次上游合并后与宿主**逐字段对拍**（本笔实测到的差异分五层：finds 形状、finds 清单、`plugins`、`css.modules`、
`test.exclude/coverage`），且统计口径要先把红分成"收集错误 / 断言失败"两类才敢当分母用。
边界：判据 165 说的是"前缀 alias 会静默杀一整族"，本笔补的是它缺的那一半——**被杀的家族按 find 逐条算，
不能按包名整体算**（`design` 族实测只 1 枚，`chat` 族 9 枚，还有 2 枚根本不是 alias）。
另一条：`numTotalTestSuites` 这类汇总数在"文件收集失败"时也会增长（17 枚红文件里 12 枚的 `assertionResults` 是空的），
所以"跑到了多少条用例"只能读 `numTotalTests`，不能读 suites 数。

**已闭环计数推到 103。**

### 8.31 刀 104（2026-10-11）：8.30 末那 20 枚红是三因，头一因在 fork 自己的生产代码里

**对象**：授权清单第 ④ 项。8.30 末的现算读数 = 20 枚断言红（5 枚文件）+ 2 枚收集错误（共 7 枚红文件）。

**三因分解**（逐枚归属用 `git diff 2744a976b..HEAD --stat -- <file>` 判：空 diff ⇒ 上游逐字节）：

| 因 | 落点 | 吃掉多少 |
|---|---|---|
| 一 · 生产侧回归（**唯一一枚真回归**） | `console/src/locales/copaw/register.ts` | `i18n.test.ts` 3 + `locales/copaw/register.test.ts` 7 + `Chat/longTextPaste.integration.test.tsx` 6 = **16 枚**，外加 `layouts/Sidebar.test.tsx` 一枚收集错误 |
| 二 · fork 测试侧的过期假设 | `Projects/tests/ProjectDetailPage.test.tsx`、`Projects/tests/enLocaleTranslate.ts`、`Knowledge/selectLabels.test.ts`、`Knowledge/metrics.test.ts`、`Projects/tests/projectKnowledgePipelineUi.test.ts` + 新增 `src/test/loadTestLocales.ts` | 1 枚收集错误 + **11 枚**（selectLabels 6 + pipelineUi 4 + metrics 1） |
| 三 · 与上游的分歧（不是 bug，是两笔账） | `Chat/OptionsPanel/defaultConfig.test.ts`、`Settings/Models/components/modals/ProviderConfigModal.test.tsx` | **4 枚**（defaultConfig 3 枚品牌 + ProviderConfigModal 1 枚 api 替身） |

**因一机制**（`console/node_modules/i18next/dist/cjs/i18next.js:1455`，`BackendConnector.queueLoad`）：
`if (!options.reload && this.store.hasResourceBundle(lng, ns)) { this.state[name] = 2; }`
—— i18next 只在 store **还没有**这枚语言包时才请求。WP-13 把 overlay 注册从 `i18n.ts` 搬进
`register.ts` 后，`registerCopawTranslations(i18n)` 仍在**模块作用域**把六语 overlay 整表
`addResourceBundle` 进 store ⇒ 六语全被标记为已加载 ⇒ `i18n.ts` 里那枚供上游 base json 的
`localeBackend.read` 一次也没被调用 ⇒ 在册的上游页面渲染裸 key（`i18n.test.ts` 3 枚红就是这件事）。
`init` 把加载推到后一个 tick，所以模块作用域那次注册总是先赢。

**修法**：overlay 改挂 i18next 的 `loaded` 事件（同文件 `:1520` 发，载荷 `{lng: {ns: true}}`），按语言各取自己那枚合并进去。
必须挂在 `loaded` 而不是提前塞：`:1520` 之前 `loaded(name, err, data)` 已经把 base 用
`store.addResourceBundle(..., {skipCopy: true})` 以 `{...pack, ...resources}` **浅**合并进 store，
overlay 只有在那之后带 `deep=true, overwrite=true` 落地才不会把 base 整棵盖掉。
另加 `typeof instance.on !== "function"` 早退：上游 `Sidebar.test.tsx` 用 `vi.mock("i18next")` 交回的是
`{ t, use, init }` 替身（既没有 `addResourceBundle` 也没有 `on`），它们的 `t` 从不读 store，那里没有可叠的东西。

**因果取证**（探针 = Edit 把 `register.ts` 的合并时机换回整表塞入、读完再 Edit 复原，**不碰 `git checkout`，判据 121**）：

```
cd console && HOME=~/.k102home npx vitest run src/i18n.test.ts src/locales/copaw/register.test.ts \
  src/pages/Chat/longTextPaste.integration.test.tsx --reporter=json --outputFile=<f>
```

同一命令两态 = **39 枚用例 / 16 枚红**（时机换回旧写法）↔ **39 / 0**（事件式合并）。
16 枚红的标题逐枚 = `i18n.test.ts` 3（`restores the persisted language …`、`logs and falls back to English …`、
`uses the initialized instance for built-in menu labels`）、`register.test.ts` 7（六语 `registers exactly the
pre-move merged bundle` + `keeps upstream-owned keys resolvable next to the overlay`）、
`longTextPaste` 6（`pastes into an empty composer …` 一族）。⇒ 8.30 末那 20 枚的头 16 枚由这一枚文件解释。

**因二**：三枚 fork 自写守卫（selectLabels / metrics / pipelineUi）断言的是 `i18n.t(key, { lng })`，
但**没有任何人驱动那枚语言的加载**——旧写法把 overlay 提前塞满 store，所以它们一直是靠"store 里恰好只剩
overlay"这一件事而绿的（base 被压掉之后 overlay 反而全命中）。base 一恢复，裸 key 立刻现形 ⇒
新增 `console/src/test/loadTestLocales.ts`（`await i18nReady` 后 `i18n.loadLanguages([...], cb)`），
四处调用点各挂 `beforeAll(() => loadTestLocales(...))`（`register.test.ts` 自己也挂：断言"导入留下的那副 store"
等于在赌注册时机，摘掉 hook 后它自己的 `expectedBundle` 独立对账照样能证红）。
`enLocaleTranslate.ts` 那枚测试替身原来靠 `registerCopawTranslations(collector)` 嗅探 overlay，
时机改成事件式后它没有实例可挂 ⇒ `register.ts` 导出 `copawOverlays`，替身直读 `copawOverlays.en`
（合并顺序的唯一所有者仍是 `register.ts`，替身没有重新列表）。
`ProjectDetailPage.test.tsx` 的收集错误 = `document.queryCommandSupported is not a function`（monaco 在 jsdom 下
import 期就要它，而该文件没有一条用例断言编辑器）⇒ 本地 `vi.mock("../components/ProjectEditorPanel")`，
与同族兄弟文件替 monaco 的既有做法一致。

**因三**：`ProviderConfigModal.test.tsx` 的 `apiMocks` 只列了 `testProviderConnection` / `configureProvider`，
而 fork 的 `ProviderConfigModal.tsx:556` effect 调 `api.getAgentRunningConfig()`（在册 +236 行那笔 lmstudio 能力）
⇒ 上游替身补一枚 `getAgentRunningConfig: vi.fn()` + `beforeEach` 里 `mockResolvedValue({})`。
`defaultConfig.test.ts` 钉的是 `title: "Work with QwenPaw"` 与 `/online.svg`，而在册生产文件
`defaultConfig.ts` 的对应两行是 `Work with CoPaw` 与 `/copaw-icon.svg`（两枚资源都在 `console/public/` 里，实测存在）
⇒ 这是 D-22 阶段 B 的账（`docs/superpowers/plans/2026-10-01-d22-brand-boundary-stage-a.md:72,613`、
`docs/copaw-brand-boundary.md:51` 把这枚文件列为阶段 B 的 9 枚之一），不是本刀的裁决。
两条路都不选：把生产那 2 行退回上游 ⇒ 用户可见品牌在 B3 的落点还不存在时先被剥掉；
放着不管 ⇒ 全套又回到非零红，后面每一刀的"绿"信号都没了。故选**桥**：改上游用例的 3 枚字面量并写明
"这是桥、阶段 B 退上游字节时连本文件一起退回"。**代价现算**：`check_p1_invariants.py --check` 报
`NEW upstream-owned file touched` ×2（`defaultConfig.test.ts`、`ProviderConfigModal.test.tsx`），
册 114 → **116**、+10,950 → **+10,960**、−518 → **−521**、命名 35 → **36 行**（touched 7 → 8 枚）。
配套 `--write-baseline` 重立，`chore(p1)` 同笔提交。

**验收读数**（配方同 8.30：`cd console && npx vitest run --reporter=json --outputFile=<f>`）：

| 读数 | 8.30 末（改前） | 本笔末（改后） |
|---|---|---|
| 跑到的用例 `numTotalTests` | 5,222 | **5,237**（+15 = `ProjectDetailPage` 7 + `Sidebar` 8，即那两枚收集错误变成可跑） |
| 断言红 | 20 | **0** |
| 红文件（断言 + 收集） | 7 | **0** |
| `numFailedTestSuites` | 14 | **0** |
| 收集到的文件行 | 532 | **532** |

红账对平：改前 20 = 因一 16 + 因三 4；末态 0。中间态（只落因一的修法）实测 5,237 / **15 枚红** / 5 枚文件 =
因三那 4 枚 + 因二暴露的 11 枚（selectLabels 6 + pipelineUi 4 + metrics 1）；那 11 枚的可复现取法 =
摘掉三处 `beforeAll(() => loadTestLocales())`。⇒ 本笔**净造红 0**，且头一因是**本笔自己造出来又当场测到的**
（判据 177）。

**旁证**：`npx tsc -b --noEmit` = **19 枚错误 / 12 枚文件**，与 8.30 那笔的 `npx tsc -b --force` = 19 **同数**，
且 19 枚的落点文件与本笔 10 枚落点**零交集**（`grep -E "register|loadTestLocales|selectLabels|…"` 空）⇒ 类型面本笔净增 0；
`scripts/check_copaw_locale_split.py` rc=0（4658 gated keys / 59 template families gated / 7 exempted /
1459 overlay keys en+zh / 23 upstream-owned exempted）；
`npx prettier --check` 本笔 10 枚落点里只 `register.ts` 因本笔变脏（`--stdin-filepath` 对 `git show HEAD:` 的字节重取，
证它在 HEAD 是干净的）⇒ 已改到干净；另 3 枚（`ProjectDetailPage.test.tsx`、`projectKnowledgePipelineUi.test.ts`、
`metrics.test.ts`）**改前就脏**，本笔没顺手 `--write`（判据 180）。
Python 侧本笔零改动（`git status --short` 的落点全在 `console/`），pytest 读数**本笔没重取**，不拿旧串当现读（判据 171）。

**本笔新增判据 177–181**：

**判据 177（改共享单例的注册时机 = 全套验证，不是逐文件验证）**：本笔把 overlay 合并从"整表提前塞"改成"挂 `loaded`"，
逐枚文件重跑全绿，全套却从 20 枚红变成 15 枚红 + 11 枚**新**红——因为三枚 fork 守卫一直靠那枚回归而绿
（base 被压掉时 overlay 全命中）。边界：判据 165/176 讲的是"少跑"，本笔是另一半——**时机类改动会让一些用例
从"因错而对"变成对**，所以它的验收必须含一次全套，且把"新造红"逐枚记账，不许写进"净减 N 枚"里抹平。

**判据 178（i18next 的"已有 bundle 就不再请求"是 overlay 注册的硬约束）**：任何在模块作用域把语言包塞进
`store` 的写法都会关掉 base 加载；正确挂点是 `loaded` 事件（`i18next.js:1520`），且合并要 `deep=true, overwrite=true`，
因为 base 那侧的写入是 `skipCopy` 浅合并。副作用另记一条：`on` 必须**先探测再挂**，上游用例的 i18next 替身形状是
`{ t, use, init }`，缺方法时用例文件是收集错误而不是断言红。

**判据 179（断言 `t(key, { lng })` 的守卫用例必须自己驱动加载）**：不驱动 = 在断言"导入副作用恰好发生的顺序"。
落点收在一枚 `src/test/loadTestLocales.ts`（`await i18nReady` 再 `loadLanguages`），由调用方 `beforeAll` 挂，
语言子集按用例声明给；`register.test.ts` 那类"对拍整棵 store"的用例同样要挂，否则它测的是注册留下的残局而不是合同。

**判据 180（prettier 只对本次改的行负责，历史脏的整枚文件不要顺手 `--write`）**：判据取法 =
`npx prettier --stdin-filepath <真路径> --list-different < <(git show HEAD:<真路径>)` 先判改前是否已脏，
再用 `npx prettier <真路径> | diff - <真路径>` 看差异行有没有落进本笔新增行。本笔实测 4 枚 warn 里
只 1 枚（`register.ts`）是新增脏，另外 3 枚是历史脏，顺手重排会造出一批与本笔无关的 P1 行。

**判据 181（品牌分歧的桥要留在册内、带退回出处，别当新合同）**：上游用例钉住上游品牌字面量、fork 生产文件带着
fork 品牌 ⇒ 三选一里"退生产行"会在阶段 B 落点存在之前剥掉用户可见品牌，"放着不管"会毁掉全套绿信号，
所以选"桥 + 记账"。记账的最小形 = 在册文件数与命名行数的现算增量（本笔 114→116、35→36）+
用例里那行"阶段 B 退上游字节时连本文件一起退回"的出处（D-22 计划 `:72,613`、边界文档 `:51`）。
**别把它读成 D-22 阶段 B 开工**：阶段 B 的 S1–S5 仍未验。

**已闭环计数推到 104。**

**本笔登记的未办（不裁，只登记落点与现算数）**：
① **overlay→渲染那一跳没有用例钉**：现树只有 base 侧的渲染证明（`longTextPaste.integration.test.tsx`
用真 i18n 实例找 `chat.longTextPaste.*` 三枚按钮，本笔从 6 枚红转绿）。overlay 侧靠事件订阅顺序推理
（`registerCopawTranslations` 在 import 期订阅，组件在 mount 期订阅，emitter 按注册序触发）⇒ 谁把那枚注册
挪到 mount 之后就会静默失效。可钉法 = 拿 `I18nextProvider` 渲一枚同时读 base 叶与 overlay 叶的组件。
② **`npx tsc -b --noEmit` = 19 枚错误 / 12 枚文件**（本笔落点外，8.30 那笔的 `--force` 同数）。拆分现算 =
**12 枚**是 `AgentSummary` 多出的 4 枚必填字段（`is_builtin`/`builtin_kind`/`builtin_label`/`system_protected`）
或 `backend` 没同步进旧替身（`useAgentStatusPolling.test.tsx` 4、`CreateBackupModal.test.tsx` 2、
`useAgentLongPress.test.tsx` 1、`Import/index.test.tsx` 1、`AgentModal.mailDomains.test.tsx` 1、`reorder.test.ts` 1、
`SettingsCenter/index.test.tsx` 1、`useProjectUploadController.test.tsx` 1 缺 `backend`）、
**5 枚**是 `vi.fn()` 直接当函数属性用的替身形状（`useArtifactSelectionGuards.test.tsx` 2、
`useProjectRealtimeController.test.tsx` 2、`useProjectUploadController.test.tsx` 1）、
**2 枚**在生产文件（`Agent/Knowledge/index.tsx` 的 `AgentsRunningConfig` 实参形状、
`Projects/components/ProjectEditorPanel.tsx` 把 `{kind, agentId}` 当 `string` 传）。12 + 5 + 2 = 19 闭合。
⇒ `npm run format:check` 整条红是**这 19 枚造成的**（它是 `tsc -b --noEmit && prettier --check .`），与项 ⑤ 同族。
③ 3 枚历史脏的 prettier 文件（判据 180 表里那 3 枚）。
④ 真浏览器 `copaw app` 一笔（8.13 段末已欠，混淆项 = `QwenPew Desktop.app` 会写 `~/.copaw/config.json`）；
本笔动的是首屏 i18n 加载路径，这枚欠账的权重因此变高，但本笔**没**跑它。

### 8.32 刀 105（2026-10-11）：项 ⑤ 那条 pre-commit 门禁——先证"上游在分叉点上是绿的"，再按 P1 账把机械改写收成两笔

**对象**：授权清单第 ⑤ 项（"从没绿过的 pre-commit 门禁"）。

**前提取证（这条门禁到底绿过没有）**：`gh run view 38039977636 --log --job 114178096778` 是 push 事件、
提交 `2744a976b` = 我们的分叉点，`.github/workflows/pre-commit.yml` 与 `.pre-commit-config.yaml` 当时均与基线逐字节相同，
八支钩子全 Passed（pragma / whitespace / Add trailing commas / mypy / black / flake8 / pylint / actionlint）。
⇒ 我们现算的每一枚红都是 fork 侧的，不能用"门禁本来就有噪声"解释。
第二个前提：**草稿 PR 的 job 不是证据**——workflow 在 draft 上直接打印"✅ Draft PR — pre-commit checks deferred"，
一支钩子都没跑，日志里读不到任何 Passed/Failed。

**离线复现配方**（无网机上可重放）：`pre-commit run --all-files` 整条不可用，它先给每支钩子建 env，
actionlint 那支要 `go install ./...` 走网络而中断；可重放的最小形 = 逐支
`/tmp/copaw312/bin/pre-commit run <id> --all-files`，且 `HOME` 必须是真 `~`
（指到 `.k102home` 会判 `~/.cache/pre-commit` 缺失、强制重 clone ⇒ rc=3）。

**改前基线**（`dc81580a6`，CI 序逐支现算，改写照常落工作树）：

| 钩子 | 性质 | 读数 |
|---|---|---|
| `fix-encoding-pragma` | 改写 | 12 枚文件被改 |
| `trailing-whitespace` | 改写 | 12 |
| `add-trailing-comma` | 改写 | 85 |
| `mypy` | 报告 | 64 处 / 22 枚 |
| `black` | 改写 | 176 |
| `flake8` | 报告 | 1,586 处 / 94 枚 |
| `pylint` | 报告 | 1,606 处 / 153 枚 |

**第一处非显然：comma 与 black 不可交换，CI 的绿点落在不动点上**。CI 每支钩子一趟只跑一次，
而一趟 pass 的产物仍不满足另一支 ⇒ 提交"跑完一遍"的树下一轮还会 Failed。实测：一趟 comma→black 之后
仍有 115 枚要 comma、107 枚要 black，迭代到第 2 轮两支同时归 0 才收敛。可提交的状态是**不动点**，不是"一趟的产物"。

**第二处非显然：归属账决定这刀的价格**。对 186 枚逐枚 `git cat-file -e 2744a976b:<path>` 再与基线比字节 ⇒
**169 枚 fork 自有（基线上不存在）+ 17 枚在册（上游自有、我们已改、已在 `scripts/p1_baseline.json`）+ 0 枚新冲突宿主**。
存在性探测不能用 `git show BASE:<path> | md5 -q`：缺路径时它给的是空输入 md5，非空判据永不命中，
会把 fork 自有文件成批误标成在册（判据 162 的三分法在 lint 刀上照用，只是探测要换 `cat-file -e`）。

**第三处：全量 186 提交会把 P1 打红，代价必须现算，不能读成"格式无害"**。
`check_p1_invariants.py --check` rc 0→1，`behavior_added 10,924 → 11,096`（**+172 行**），
逐枚增长的恰好是 17 枚在册宿主里的 15 枚（另 2 枚 `.gitignore` 与 `app/routers/agent_scoped.py`
本刀各只做了 1 增 1 删的原地替换，现算 `behavior_added` 停在 4 与 14 没涨，所以不进红名单）：
`agents/skill_system/__init__.py` 20→25、
`agents/utils/audio_transcription.py` 340→352、`file_handling.py` 5→7、`message_processing.py` 54→56、
`app/_app.py` 43→47、`app/channels/dingtalk/channel.py` 76→79、`app/chats/session.py` 84→92、
`app/migration.py` 230→233、`app/routers/agents.py` 3,796→3,872、`app/routers/skills.py` 709→743、
`config/utils.py` 25→28、`tests/unit/app/crons/test_heartbeat.py` 321→323、
`tests/unit/app/routers/test_tools_router.py` 199→206、`test_workspace_router.py` 107→117、
`tests/unit/config/test_config_utils.py` 60→62。
⇒ 裁法：**那 15 枚退回 `dc81580a6` 字节，只留 171 枚 fork 自有的**（两笔提交 `8b5cd63b3` + `a1f81d1be`）。
理由不是"逗号不算侵入"——逗号行本身就是将来会冲突的行，P1 计它是对的；而是这 +172 行**买不到任何东西**：
门禁仍红在三枝报告型钩子上（下段），抹平 15 枚上游文件不会让它转绿，却确定性地多 172 行冲突面。
退回后 `--check` rc=0，`behavior_added 10,923`（比基线还少 1），在册宿主 **116 枚 / `+10,959 −520`**。
（此行原写 `+11,132 −520 不变`——那是 `8b5cd63b3` 那棵 186 全量树的总数，不是退回后的；
2026-10-11 刀 106 用临时 worktree 在两棵树上分别现算更正，见 8.33 末。）

**改后读数**（`a1f81d1be`）：

| 钩子 | 改前 | 改后 | 备注 |
|---|---|---|---|
| pragma | 12 | **0，Passed** | 结清 |
| whitespace | 12 | **0，Passed** | 结清 |
| add-trailing-comma | 85 | 15 | 残余集与那 15 枚在册宿主 `comm -12` 实测 **15/15 逐枚相同** |
| black | 176 | 15 | 同上（临时 worktree 里迭代两轮，集不再变） |
| mypy | 64 / 22 | 65 / 22 | 多 1 处，同文件同码集，black 拆行所致（判据 178 那族：计数随拆行涨） |
| flake8 | 1,586 / 94 | 1,649 / 101 | 同一配方在 186 全量树现算 1,586/94 ⇒ 退回 15 枚的成本 = **+63 处 / +7 枚，全落 E501**（850→912） |
| pylint | 1,606 / 153 | 1,607 / 153 | 在 186 全量树上现算；+1 处是行号位移，没出现新缺陷类 |

**用例面**：CI 选择集 `tests/unit --ignore=tests/unit/channels`（186 全量树）= **15 failed / 15,771 passed /
23 skipped / 4 xfailed / 779.33 s**，与 8.28 那条"15 failed / 15,707 passed"同枚数、收集面 +64 ⇒ 本刀没引入新红。
CI 必过段 L1 五目录在 `a1f81d1be` 现算 = **1 failed / 1,335 passed / 1 skipped / 17.64 s**，那 1 枚是
`tests/unit/security/tool_guard/test_safety_checks.py::TestIsCommandDestructive::test_b1_normalize_before_home_glob_match`
= 授权清单第 ⑥ 项，与本刀无关，但它坐在必过段上 ⇒ 第 ⑥ 项的优先级由这条读数抬高，不是由文档叙述抬高。
四枝离线门禁 + 品牌账册 + P1 全 rc=0（namespace boundaries / release-channel R1–R5 over 6 files /
ci-command-targets 18 条 / locale-split 4,658 枚 gated keys / brand ledger 7 files 35 lines）。

**门禁仍红，但剩余面第一次有了量**：改写型四枝被收成"两枝永久绿 + 两枝只剩 15 枚在册宿主"，
剩下的红全在三枝报告型钩子上，机械改写吃不掉：flake8 1,649（E501 912 + W191 334 + E101 334 = 1,580，占 96%，
后两码集中在少数 tab 缩进文件）、pylint 1,607 / 153 枚、mypy 65 / 22 枚。属下一批刀。

**判据 182（"这条门禁从没绿过"是要取证的断言，不是背景）**：取法 = 在分叉点提交上找 **push/merge 事件**的 job 逐字读
那八行结论，不要拿 PR 事件的日志替代——草稿 PR 会被 workflow 短路，日志里零钩子跑过，读起来"没有 Failed"像是绿的、
"没有 Passed"又像是从没评估过，两头都推不出结论。有基线绿证之后，现算的每一枚红才能确定归 fork 侧。

**判据 183（改写型钩子的可提交状态是不动点，不是"跑完一遍"）**：判据 = 一趟 comma→black 之后再跑一趟，
两支同时报 0 才算收敛。CI 每支只跑一次，所以提交一趟产物会下一轮还红；本刀实测一趟差 115/107 枚、两轮才 0/0。

**判据 184（机械改写刀的定价单位是 `behavior_added`，不是 diff 行数）**：逗号与拆行都会成为将来合并的冲突行，
所以 P1 把它们计成侵入是对的，不要靠 `--write-baseline` 把它认下来。定价之后的正确动作是**按宿主所有权切两半**：
fork 自有那批照提（零账），在册宿主那批当买不到门禁绿时退回原字节。本刀 = 171 枚入账、15 枚退回、P1 零增长。

**判据 185（残红归属要用同一配方对拍两棵树，不要引用历史数字）**：同一
`pre-commit run flake8 --all-files` 在 186 全量树得 1,586/94、在 171 树得 1,649/101 ⇒ 退回成本精确到码（+63 全在 E501）。
若拿 8.29 那条 1,598 当分母，等于把判据 175（"改写流水线量的不是提交树"）已经结清的账重新搅开。

**已闭环计数推到 105。**

**本笔登记的未办（不裁，只登记落点与现算数）**：
① **15 枚在册宿主仍带 comma/black 脏**（上表残余集，逐枚即那 15 条 `behavior grew` 名单）——本刀故意不修；
下一刀若要修，得连带决定 P1 那 +172 行怎么入账，不能只跑钩子。
② **三枝报告型钩子的手改面**：flake8 1,649 / pylint 1,607（153 枚）/ mypy 65（22 枚），逐枚归属未做。
③ **pylint `E0611` 那 24 处的跨文件机制仍未结清**：只在整树批次里出现（单文件跑 pylint 是 10.00/10），
构成 = 7 枚逐字节等于基线的宿主全报 `cannot import name ... from module 'mcp'`
（`packages/qwenpawmail-mcp/*` 3 处、`drivers/handlers/mcp_stateful_client.py` 6 处、`mcp_streamable_http.py` 1 处、
`tests/fixtures/mcp/*` 2 处、`tests/unit/drivers/handlers/test_mcp_stateful_client.py` 2 处）
+ 5 枚 fork 自有文件报 `qwenpaw.knowledge`/`qwenpaw.agents`/`copaw.knowledge`。
基线宿主不能动，唯一免宿主的手段 = `pyproject.toml` 的 `[tool.pylint]`（该文件已在册），判为"配置吞债"，**只登记不用**。
④ **L1 必过段那 1 枚**（`test_b1_normalize_before_home_glob_match`）= 授权清单第 ⑥ 项，现算在案（**8.33 刀 106 已闭**）。
⑤ 8.31 末那四项照旧未办（overlay→渲染守卫、19 枚 tsc、3 枚历史脏 prettier、真浏览器 `copaw app`）。

### 8.33 刀 106（2026-10-11）：项 ⑥——灾难清除的"家目录"判据从段数改成当前用户的那个家

**一句话结论**：8.32 未办 ④ 那枚 L1 必过红不是测试工件，是**生产安全规则用"路径有几段"当"是不是家"的判据**；
把当前用户的家作为附加目标钉进判定后，L1 五目录从 `1 failed / 1,335 passed` 变 **`1,339 passed / 1 skipped / 0 failed`**，
代价 = 新开一枚冲突宿主（`+9` 侵入 / `−1` 上游行）。

**前置事实（为什么必须动生产码）**：`src/qwenpaw/security/tool_guard/safety_checks.py` 的
`_is_resolved_path_catastrophic` 里那行 `if top in _HOME_TOP_LEVEL: return len(parts) <= 3`
（`_HOME_TOP_LEVEL = {"home", "users"}`）⇒ 只有 HOME 恰为 `/Users/<单段>` 或 `/home/<单段>` 时
`rm -rf ~/*` 才被判灾难。上游用例 `tests/unit/security/tool_guard/test_safety_checks.py:288`
`test_b1_normalize_before_home_glob_match` 用 `home = os.path.expanduser("~")` 取真家，所以它只在
CI runner 那种三段家里绿；本机 HOME 是四段 `/Users/futuremeng/.k102home` ⇒ 断言
`is_command_catastrophic("rm -rf ../*", cwd=<home>/project) is True` 红。
**同一条规则在任何把家放在更深一层的环境里都漏**（`/home/service/app`、容器内 `/root/.cache` 型布局）
⇒ 按判据 186 走修规则而不是改用例。

**修法（只加不减）**：新增 `_real_home_logical_parts()` = `os.path.expanduser("~")` → 非 `/` 开头直接返回 `()`
（Windows 原生家不参与）→ 复用既有 `_logical_posix_parts`（含 macOS `/System/Volumes/Data` firmlink 剥离）；
判定改成 `return len(parts) <= 3 or parts == _real_home_logical_parts()`。别的用户树的三段规则一字未动，
所以回归面只有"多认一枚家根"这一向。

**TDD 账**：fork 自有守卫 `tests/unit/security/tool_guard/test_safety_checks_nested_home.py`（三枚用例：
四段家的 `../*` / 绝对 `<home>/*` / `<home>/project/build` 的 `../../*` 都必须 True；
`<home>/project/build` 的 `../*` 与 `<home>/project/build` 本体必须 False；非家树 `/tmp/unrelated/project`
的 `../*` 必须 False）先取红 = **1 failed, 2 passed**（红形如 `assert False is True`），
落修复后 **161 passed**（新文件 + 上游整文件一起跑）。三枚用例在 `os.name == "nt"` 下用 `pytest.skip`
显式跳过，不用裸 `return` 冒充通过。

**读数**：CI 选择集（`tests/unit --ignore=tests/unit/channels`）**15 failed / 15,774 passed / 23 skipped / 4 xfailed**，
与改前的 15 枚**逐枚差一**——消失的正是那枚安全红；多出来的 `tests/unit/services/test_terminal.py::test_real_pty_...`
报 `asyncio.exceptions.CancelledError → TimeoutError`，隔离单跑 3/3 通过（0.66s / 7.62s / 0.26s）
⇒ 判为并发争抢的计时红、非回归（判据 187 的口径：整树跑与单跑不同轴时以单跑归属）。
其余 14 枚照旧（`test_cli_update.py` 11 + `test_cli_update_overlay.py` 3，同一根因
`overlay_update_callback() got an unexpected keyword argument 'prerelease'`，属项 ⑦ 射程）。
L1 五目录 **1,339 passed / 1 skipped / 0 failed**。两枚动过的文件对八枚钩子全 Passed
（pragma / whitespace / comma / black / flake8 / mypy / pylint）；新测试文件那行
`# -*- coding: utf-8 -*-` 是 pragma 钩子自己写进去的，不是我加的。
离线门禁四道全 rc=0，locale split 4,658 键 / CI command targets 18 命令 · 4 包目录照旧。

**P1 账**：`safety_checks.py` 对分叉点 `2744a976b` 逐字节相同 ⇒ 这一刀**新开一枚冲突宿主**。
改前现读 `116 文件 / +10,959 −520`，改后 **`117 文件 / +10,968 −521`**（新宿主 `+9 侵入 / −1 上游行`），
`--check` 先红四条（files / behavior_added / behavior_files / NEW upstream-owned file touched），
配套 `--write-baseline` 一笔重立。重算顺带吸收两处**负向**移动：旧基线把总数记成 `+10,960 −521`（高 1 行），
以及 8.32 那笔机械改动留在 `agent_scoped.py` 上的 `15 → 14`。

**复算与一处更正（临时 worktree 现算，两棵不同树）**：`git worktree add --detach` 到 `8b5cd63b3` 与 `a1f81d1be`
各跑一次 `--check`/`--json`，得 `8b5cd63b3`（186 全量）= **116 枚 / +11,132 −520 / behavior 11,096**、
`a1f81d1be`（退回后）= **116 枚 / +10,959 −520 / behavior 10,923** ⇒ 8.32 那句"退回后 … `+11,132 −520` 不变"
把前一棵树的总数安到了后一棵上（已就地更正）。留存机械改动的 171 枚的三分法复算一致：
**169 fork-created + 2 枚在册**（`.gitignore` 只把空格行改成空行、added 4 不变；`agent_scoped.py` 净减 1 行），
0 枚新冲突宿主——那两枚没进退回名单是因为对 P1 零增长/负增长，`--check` 不红。

**判据 186（形状型安全谓词的测试红要先问规则在真实环境里对不对）**：一条按"路径段数"实现的安全判定，
在 CI 的特定家目录形状下恰好成立 ≠ 它对。用例红的时候先复现"非 CI 的家形状"（这里就是四段 HOME），
能复现就是生产缺陷；把它当工件处理（skip 用例、改断言、或把本机 HOME 摆成三段）等于把漏洞留在树里。
**判据 187（整树跑与隔离跑不同轴时，单枚红要用隔离重跑归属，并且要报"差集"而不是"净数"）**：
两次整树跑都是 15 failed 但集合不同 ⇒ 只报 15→15 会同时漏掉"修好一枚"和"新红一枚"；必须逐枚列差集，
差集里新增的那枚再用隔离重跑判它是计时红还是真回归。
**判据 188（判据 175 的同一件事在 P1 账上重演：一个 P1 总数必须标明它量的是哪一笔提交）**：
`+11,132` 与 `+10,959` 都是"116 枚在册宿主"，差 173 行全在机械改写里 ⇒ 引用册读数前要写清
"哪个 commit + 是否含未退回的机械改写"；跨刀对账时用临时 worktree 在那几笔提交上现算，别信文档里的裸数字。

**已闭环计数推到 106。**

### 8.34 刀 107（2026-10-11）：项 ⑦ 的前置——合并吞掉了 fork 覆盖命令的参数面，`update` 在两个程序名下一起死

**一句话结论**：fork 的 `update` 覆盖用 `params=list(上游.params)` 抄选项面、却把回调签名写死成 `yes`，
上游这 1,201 枚里新增的 `--prerelease` 因此让**每一次** `update` 调用死于
`TypeError: overlay_update_callback() got an unexpected keyword argument 'prerelease'`；
改成 `**options` 转发（同仓兄弟覆盖早已用的那个形）后，§8.33 记的那 14 枚红全清，代价 = **零枚新宿主**。

**归属**：动的两枚文件 `src/copaw/cli/update_cmd.py`、`tests/unit/cli/test_cli_update_overlay.py`
对分叉点 `2744a976b` 均 `git cat-file -e` 不存在 ⇒ **fork-created，零账**；
上游那枚 `src/qwenpaw/cli/update_cmd.py` 现读仍逐字节等于基线（clean-upstream），本刀一字未动，
所以它没被拖进冲突面。

**根因（不是"少写一个参数"，是两套面的耦合方式）**：`make_overlay_update_command()`
（`src/copaw/cli/update_cmd.py:60`）把上游命令的 `params` 整表抄来 ⇒ **解析面自动跟上游**；
覆盖自己的回调只认 `yes` ⇒ 上游加一枚选项（`src/qwenpaw/cli/update_cmd.py:679 --prerelease`，
回调 `:685 def update_cmd(ctx, yes, prerelease)`）之后，click 照抄来的面传 kwargs，回调接不住。
命令注册在**共享**的核心 group 上（判据 90），`copaw` 与 `qwenpaw` 解析到同一枚命令对象，
所以红的不是 fork 那条拒绝分支，而是上游自己的升级入口 —— 两个程序名全死。
同仓已有正解：兄弟覆盖 `src/copaw/cli/app_command.py` 用 `functools.wraps(core_callback)` + `*args/**kwargs`
转发，所以它的 `app` 命令没红。

**修法**：`overlay_update_callback` 改 `@click.pass_context` + `**options: Any`，非 copaw 名时
`ctx.invoke(_core_update_cmd, **options)`；copaw 名的拒绝分支与文案一字未动。
转发的 kwargs 面 = 抄来的 params 面 ⇒ 上游将来加的每个选项自动跟着走，不再需要第二把刀。

**用例账（TDD，先红后绿）**：两枚新守卫都取过红，红形就是那条 `TypeError`。
① `test_copaw_refusal_accepts_every_option_it_advertises`：枚举覆盖命令**自己广告的**选项面，逐枚以最长名传进 CLI，
断言仍 rc≠0、仍不 pip-install，并额外断言这些选项全是 flag ⇒ 上游一旦加**带值**的选项，这条先红，
逼下一次去读参数面（修的是这一类，不是这一枚）。
② `test_qwenpaw_program_forwards_prerelease_to_the_upstream_updater`：钉"转发的 kwargs 真到了上游回调"，
断言替身收到的调用面是 `{"include_prerelease": True}`。
顺带修的一处前置：`up_to_date` 替身原来是 `lambda: core_update.__version__`，接不住新 kwarg ⇒ 改成镜像真签名
`def _fetch_latest(*, include_prerelease: bool = False)`（严格 kw-only，将来签名再漂就大声红）并记录调用面。

**读数**：

| 面 | 改前 | 改后 |
|---|---|---|
| 两枚 update 用例文件 | 33 passed / **14 failed** | **49 passed** |
| CI 选择集（本刀之后、8.35 之前）| §8.33 记的 15 failed / 15,774 passed | 10 failed / 15,781 passed |
| `copaw`/`qwenpaw` 两个程序名的 `update` | 全死在 TypeError | 拒绝分支与上游升级分支各归其位 |

那 10 枚不是本刀引入的：按判据 187 在 `9bcdbf3eb` 的临时 worktree（不带本刀改动）隔离重跑，9 枚照红 ⇒
归属见 8.35。flake8/mypy 在本刀动的文件上 Passed；pylint 在这枚 fork 自有测试文件上从 9 条 W0621/W0613 涨到 11 条，
新增两枚全是**同类**（pytest fixture 形参按模块作用域名重复），该文件在基线上就不绿（8.32 未办 ② 的射程）。

**判据 189（抄来的解析面必须配转发到底的执行面）**：覆盖型命令只要写 `params=list(core.params)`，
它的回调就不能再点自己认识的选项名——否则上游每加一枚选项就红一次，而且红在上游自己的程序名上（共享 group）。
取红用例要**枚举广告面**而不是点一枚具体新选项，并断言选项形状（全是 flag）；同仓的 `functools.wraps` +
`**kwargs` 形是现成正解，先抄自己人再改签名。
**判据 190（替身要镜像真签名，严格 kw-only）**：测试替身写成 `lambda:` 就等于把上游合同钉死在采集它的那天；
`def _fetch(*, include_prerelease: bool = False)` 让下一次上游漂签名时替身自己红，而不是让被测代码红在别处。

**已闭环计数推到 107。**

### 8.35 刀 108（2026-10-11）：CI 选择集剩余红的根因是本机钥匙串——unit 套件与真机解耦，但不改上游的安全码

**一句话结论**：`import qwenpaw` 在真实 `HOME` 下要花 **20s 墙钟换 0.2s CPU**，因为
`_get_master_key` 串行吃满**两趟** `_KEYRING_TIMEOUT=10`（读超时 → 文件兜底命中 → 回写又超时），
这条把 8 枚计时红判成了机器耦合而非回归；修法只在 fork 自有的 `tests/unit/conftest.py` 加一枚 autouse
fixture，用上游自己留的逃生口 `QWENPAW_DISABLE_KEYRING`，**零枚新宿主**。

**取证配方（值得复用，成本 3 条命令）**：
`python -c pass` real 0.03s；`PYTHONPATH=src python -c "import qwenpaw"` real **20.37s / user 0.22s**；
同一命令 `HOME=/tmp/空目录` real 0.28s。墙钟与 CPU 差两个数量级 ⇒ 阻塞在非 CPU 处。
栈由 `faulthandler.dump_traceback_later(6/15)` 给出，两次转储正好抓到那两趟调用：

```
__init__.py:17 load_envs_into_environ → envs/store.py:352 → secret_store.decrypt(:392)
  → _get_fernet(:366) → _get_master_key(:334)
  → _try_keyring_get → _call_with_timeout → keyring/backends/macOS/api.py:151 find_generic_password  (10s)
  → _read_key_file 命中 → _try_keyring_set → api.py:183 delete/set_generic_password                (又 10s)
```

**为什么不在生产侧修**：`src/qwenpaw/security/secret_store.py` 与 `src/qwenpaw/__init__.py` 现读均与分叉点
逐字节相同 ⇒ 动它们 = **新开两枚冲突宿主**；而且"读超时之后还要不要回写""导入期要不要解密"是上游的
钥匙串/启动策略，fork 替它裁等于把一个安全决定搬进我们的账册。
**生产面读数照记不藏**：`python -m copaw.cli.main update --yes`（真实 HOME、无逃生口）
= **real 22.50s / user 1.79s** 打三行拒绝文案 ⇒ 同一条 20s 在 CLI 冷启动上是用户可感的；
触发条件是"这台机器的钥匙串条目不在当前解释器的 ACL 里"（开发者多 venv/worktree 的形状），
发布后的单解释器安装不会撞上，所以记为上游可上报项而非 fork 缺陷（`_should_skip_keyring` 的文档
承诺"caller never blocked for more than `_KEYRING_TIMEOUT` seconds"，聚合面是 2×，这条可以直接报上游）。

**测试侧修法（落点零账）**：`tests/unit/conftest.py`（fork-created）加 autouse `isolated_os_keyring`，
`monkeypatch.setenv("QWENPAW_DISABLE_KEYRING", "1")` —— 与 `src/qwenpaw/hub/local_provisioner.py:362`
给子进程的那枚逃生口同一支；原则就是这枚 conftest 里 `isolated_config_file` 自己写下的那一句
（"any unit test that reaches load_config()/save_config() touches the developer's live `~/.copaw/config.json`"），
不新造机制。
守卫文件 `tests/unit/test_unit_suite_environment.py`（新建，fork-created）钉两件事：
`_should_skip_keyring()` 在本套件里必须为真；以及**后果**——用套件自己的 10s 预算重导入
`qwenpaw.constant` 必须跑完（这条就是那 4 枚 `test_custom_startup_concurrency_parsing` 的失败形）。
红 = `2 failed`（一枚 `assert False is True`、一枚 `subprocess.TimeoutExpired ... after 10 seconds`），
绿 = **54 passed in 1.77s**（守卫两枚 + `test_multi_agent_manager_startup.py` 整文件 +
`tests/unit/security/test_secret_store.py`，后者逐枚 patch `_try_keyring_get/set`，不受逃生口影响）。

**读数（同一棵树上的三趟 CI 选择集，集合差异按判据 187 报）**：

| 趟 | 失败 | 通过 |
|---|---|---|
| `9bcdbf3eb`（刀 106 落点，§8.33 记的那趟）| 15 | 15,774 |
| 刀 107 之后 | 10 | 15,781 |
| 刀 107 + 108 | **2** | **15,791**（23 skipped / 4 xfailed / 836.78s）|

L1 必过五目录同树现算 **1,339 passed / 1 skipped / 0 failed / 8.50s**（§8.32 那趟是 17.64s，
逃生口把它也带走了）。离线五门禁全 rc=0（namespace boundaries / release-channel R1–R5 over 6 files /
ci-command-targets 18 命令 · 4 包目录 / locale split 4,658 键 / brand ledger 7 files 35 lines）；
P1 对在册宿主 `--check --target-ref working` rc=0（`117 文件 / +10,968 −521`，与 §8.33 改后读数一致，
本批四枚文件全不在册 ⇒ 零增长，没动基线）。

**剩余 2 枚的归属（不裁，只登记）**：`tests/unit/agents/test_acp_available_commands.py` 的两枚
`_drain(..., timeout=5.0)` 超时，隔离单跑也红 ⇒ 不是并发争抢。同一文件在两种解耦下都全绿：
空 `HOME` = 21 passed / 1.86s；真 `HOME` + `QWENPAW_WORKING_DIR=/tmp/…` = 21 passed / 1.53s
⇒ 与钥匙串无关，是**真工作区**让 ACP 会话启动超出那 5s 预算。该文件逐字节等于分叉点（clean-upstream），
免宿主落点仍是那枚 fork 自有 conftest（把 `QWENPAW_WORKING_DIR` 也钉进临时目录），
但它同时会改变 CI 上的工作区形状，**必须整树重跑才能落**，本刀不做。

**判据 191（计时型红的取证是"两种 HOME 的 real/user 比"，不是把预算调大）**：墙钟 ≫ CPU 就是阻塞在非 CPU 处，
`faulthandler.dump_traceback_later` 给得出栈；同一命令换 HOME 复现即坐实机器耦合。
调 timeout 或 skip 用例都是把耦合留在树里（判据 186 的同一件事，只是这次量的是时间）。
**判据 192（套件级机器解耦优先用上游自带的那个逃生口，并且要连后果一起钉）**：上游已经有
`QWENPAW_DISABLE_KEYRING`（hub provisioner 给自己的子进程就是这枚），fork 再造一层 fixture 或再包一层
monkeypatch 都是第二套真相；守卫用例一枚钉机制（谓词为真）、一枚钉后果（子进程在自己的 10s 预算内跑完），
这样上游把逃生口改名时我们会红，而不是静默地把 20s 导入请回来。

**本笔登记的未办（不裁，只落点）**：① 上面那 2 枚 acp 的 `QWENPAW_WORKING_DIR` 全局解耦（候选一行，
需整树重跑）；② 上游 `secret_store` 的 2×timeout 聚合 + 导入期解密（可上报上游，fork 不代裁）；
③ 8.32 未办 ①–⑤ 照旧在册（15 枚在册宿主的 comma/black 脏、三枝报告型钩子、pylint `E0611`、
overlay→真渲染守卫、19 枚 tsc、3 枚 prettier、真浏览器 `copaw app`）。

**已闭环计数推到 108。**

---

### 8.36 刀 109-1（2026-10-11）：设计文档那句"全仓仅两处按分发名读版本"是错的 —— 修法不是把句子改对，是让这类句子跑红

**一句话结论**：现扫得 **12 处 = 1 枚声明 + 11 处读点，分布在 5 个文件**（文档旧写 2 处，且其中一枚的行号已漂；
本节的"10 处读点"同日被第二次纠正，见 §8.37）；
门禁 `scripts/check_release_channel_consistency.py` 因此加第 6 条规则 **R6**：登记表（10 条模板 = 1 条声明 + 9 条读点）
与一次正则全扫做**相等**比对（相等最初只做到文件级，同日补刀 §8.37 把行级也钉上）；
今后"只有 N 处"这类话不必靠人记住，漏登记即红。

**根因（不是笔误，是口径）**：旧断言只把 `importlib.metadata.version()` 当作"按分发名读取"的形状，
漏了同一身份另外四类用法 —— 查 PyPI json（`update_cmd.py:33`）、`metadata.distribution()`（`:181`）、
拼 pip 升级规格（`:395`）、认 wheel 产物文件名（`build_common.py:64/102`、`build_macos.sh:35/40`、
`build_win.ps1:36/43`）。这与 §8.34 判据 189 是同一件事的两面：那里是 fork 覆盖命令的参数面被合并吞掉，
这里是分发名的读取面被文档口径吞掉 —— **一处身份改动散落在多种形状里，任何"我数过了"的清单都会漏**。

**顺带查实并更正的两处**：① `build_win.ps1` 的版本读取在 `:347`（旧写 `:289`，上游合并后行号漂移）；
② 旧文说"Python 侧唯一的 `metadata.version()` 读的是 `reme-ai`" —— 现树 `src/` 里 `metadata.version()`
**一处也没有**，被引用的 `reme_light_memory_manager.py:161` 读的是 `reme.__version__`（import 属性，
与分发名无关），结论仍成立但机制写错了。
③ 文案侧（`pip install qwenpaw[...]` 给人看的指引：`providers_cmd.py:28`、6 门 locale 的
`transcriptionInfoDescLocal`、`release-duty.yml:240`、`QuickStart.tsx:74`、插件 README、`website/public/docs/*`）
**不是运行期读取**，R6 有意不管 —— 它的归属按 §7 账册口径逐文件裁，改不改都不影响分发名能否被读到。

**R6 的三条动作**（`rule_distribution`，`scripts/check_release_channel_consistency.py:193`）：
1. 声明与 `pending` 的关系：`pypi` 已离开 `pending` ⇒ `[project] name` 必须等于事实源的 `pypi_project`；
   仍 pending ⇒ 只允许 `pypi_project` 或 `qwenpaw`（= `PRE_RENAME_DECLARATION`，上游改名前那枚，§3 判据 90 同族）。
   这条把"改名前先把某处改了"挡在门外。
2. 每条登记读点必须仍含 `template.replace("{distribution}", declared)` —— 半把落（改了读点没改声明，
   或反过来）红，消息直说"the distribution name moves in one commit with pyproject.toml"。
3. 全扫（初版 `READER_PATTERNS` 5 支；本批后为 4 支静态 + 1 支按受盯身份动态构造的 wheel 模式 —— §8.37 ×
   `READER_DIRS` 5 目录 × 7 个后缀）命中的**落点文件**必须**都在登记表里** ——
   新增读点不落登记即红，这条才是"清单不会再漏"的机制。初版比的是文件级，行级由 §8.37 的守卫用例补上。

**TDD 读数**：红 = `AttributeError: module ... has no attribute 'declared_distribution'`（**1 failed / 12 passed**）；
终树 **22 passed**（既有 12 + 新 10），`tests/unit/scripts` 整目录 **158 passed in 18.58s**；
现树门禁 **rc=0 / 2.26s**，当时串为
`Release channel consistency check passed (R1-R6 over 6 channel files and 10 distribution readers)`
—— 这条消息里的写死数字同日被查出偏小（§8.37），现已由门禁自己从扫描结果算出。

**变异检查（逐条摘，这一步查出两处真覆盖洞，不是走过场）**：

| 摘掉的动作 | 变红 | 用例 |
| --- | --- | --- |
| 动作 3：全扫 ↔ 登记表相等 | 1 | `..._rejects_an_unregistered_reader` |
| 动作 2：每条登记读点仍含新名字面量 | 3 | 落后全部读点 / 落后一枚读点 / 抢在声明之前 |
| 动作 1b：`pending` 期不得声明第三枚名 | 1 | `..._rejects_a_third_name_while_the_channel_is_still_pending` |
| 动作 1a：渠道已开 ⇒ 声明必须等于 `pypi_project` | 1 | `..._rejects_an_opened_channel_that_left_the_declaration_out` |

头两行是初版 9 枚就断住的；后两行**是变异检查现造的** —— 最初那条第三枚名用例只断 `rc == 1` 且输出含 `"R6:"`，
而半把落地的读点字面量红会把同一次运行也变红，于是**把 `elif` 整枝摘掉后 21 枚全绿**（= 该分支无人钉）；
1a 那条分支更是初版根本没有用例走到（`_open_pypi_channel` 只出现在"改了读点"的那几条里）。
补法：两条都改断**自己那条分支的消息子串**（`while the pypi channel is pending` / `no longer pending`），
并新增 1a 用例 ⇒ 再摘对应分支各红 1 枚。⇒ **判据 193（红用例要断到自己那条分支的消息，只断 `rc != 0` 的会被邻近的红掩掉）**：
一条规则的多条分支共享同一个非零退出码时，`assert rc == 1` 的覆盖面等于零 —— 断消息、断文件名，
并用"摘分支看掉几枚"来量覆盖，而不是看用例数。

**账（现算，非沿用）**：P1 `--check` rc=0，**117 文件 / +10,968 −521**（behavior 116 / +10,932 / −485，
机械 1 枚 lockfile）—— 本批 4 枚文件（门禁 + 它的用例 + 两本 docs）全是 fork-created 或 docs 豁免 ⇒ **零增长**。
其余四枝离线门禁同树全 rc=0：namespace `PASSED` · ci-command-targets `18 命令 / 4 包目录` ·
locale split `4,658 + 59 + 7 + 1,459 + 23` · brand `7 files / 35 lines`。
CI 选择集（终树两趟，`tests/unit --ignore=tests/unit/channels`）：**2 failed / 15,801 passed / 23 skipped /
4 xfailed in 917.45s**，前一趟同集合 **2 / 15,800 in 987.45s** —— 差的 1 枚就是本批最后补的那条 1a 用例，
红的仍是 §8.35 登记的两枚 `test_acp_available_commands`（工作区耦合，未裁）⇒ **本刀零新增红**。
L1 必过五目录不受影响（本批未动 `src/`）。

**lint 侧如实记账**：`check-ast` / `black` / `flake8` 三枝在改后的两枚文件上 Passed；`mypy` 那条既有错仍在同一处
（`module_from_spec` 参数可空，HEAD 在 `:79`，本批把它推到 `:242`，属行号漂移不是新错）；
`pylint` 两枚文件合跑 rating **9.49/10**，报出的都是既有类 —— 门禁文件 1 条 `C0413`（`sys.path.insert` 之后
`from release_channel import render_ts` 的惯用法），用例文件 **W0621 10 → 19**
（新 10 枚里 9 枚沿用同一 `fixture_root` 注名，第 10 枚不取 fixture）——
既有类、既有报告型红钩子，不新开类别，也不为此加 `disable`（那会把既有 10 枚一起静音）。
`prettier` 钩子的 `files:` 不覆盖 `docs/superpowers/**`，现跑 `(no files to check) Skipped` ⇒ 本批 docs 无格式化账。

**阶段 2 的宿主代价因此第一次被看见**（不在本刀裁，只登记）：R6 的 5 个文件里
`src/qwenpaw/cli/update_cmd.py` 与 `scripts/pack/build_common.py` 现读**逐字节等于分叉点**（clean-upstream）
⇒ 真改名那一刀必须**新开 2 枚冲突宿主**，另 3 枚（`pyproject.toml`、`build_macos.sh`、`build_win.ps1`）已在册。
替代路径是把这几处按分发名的读取搬进 fork 覆盖层（`src/copaw/cli/update_cmd.py` 已经这样盖住了 `update` 命令），
但 `_detect_installation()` 的 `metadata.distribution("qwenpaw")` 在 wheel 改名后会对
`qwenpaw` 那枚 console script **抛 `PackageNotFoundError`**（上游模块自己的路径，我们的覆盖层拦不到它）
—— 这条要么接受，要么同刀再开一枚覆盖点。**两条都是产品裁决，落刀前要先报。**

**判据 194（散落多形状的身份改动，立"登记表 = 机器全扫"的相等门禁，而不是把清单写对）**：一条身份
（分发名 / 命令参数 / 文案键）被多种语法形状读取时，任何人工清单的可信度等于它上次被重扫的时间；
把它做成登记表 + 每次运行重扫 + 集合相等，错的断言就会在提交时红，而不是等改名那天咬人。
判据 165 / 186（文档与文件名不是证据）的机器化版本 —— 不是再核一遍，是让核不动这件事本身变红。
**判据 195（读点所有权要先于改名方案算清）**：改名类动作的真实代价 = 命中的每个文件按分叉点分类
（在册 = 记账；clean-upstream = **新开宿主**）；这个数只有全扫落地后才数得出来，所以"门禁"这一步
不是官僚，是把不可知变成可知。

**本笔登记的未办（不裁，只落点）**：① 上面那条阶段 2 的"2 枚新宿主 vs 再开一枚覆盖点"二选一，落刀前报用户；
② `109-2` 那把（fork 自有 `copaw-release.yml` + `scripts/release_channel.py --check-artifacts`，
外加 `constants.test.ts` 那枚 `/pip install copaw/` 未锚定自咬的前置修）；
③ §8.35 的两项照旧在册（2 枚 acp 的 `QWENPAW_WORKING_DIR` 全局解耦、上游 `secret_store` 2×timeout 聚合）；
④ 8.32 未办 ①–⑤ 照旧在册。

**已闭环计数推到 108；109-1（分发名读点全表 + 门禁 R6）已落，109-2 待做。**

---

### 8.37 刀 109-1b（2026-10-11）：109-1 刚立的机器账自己少报了两行 —— 相等要比在"哪一行"，不是"哪些文件"

**一句话结论**：上一节的"11 处 = 1 声明 + 10 读点"是错的，真表 **12 处 = 1 声明 + 11 读点**（5 个文件不变）；
`DISTRIBUTION_READERS` 的 **10 是模板条数**（1 条声明 + 9 条读点模板，合计覆盖 11 行），我把它当成了读点条数。
更硬的一条是机制洞：全扫的 wheel 模式在 `build_win.ps1` 上被同一行更早的宽匹配**非重叠吞掉**，
`:36/:43` 两行从未被扫到 —— 而"命中的文件都在登记表里"这条相等判定**看不见这种漏**，因为那枚文件因别的行本来就在册。

**根因（正则的匹配起点竞争，不是清单漏项）**：初版模式是 `([\w.\-]+)-[\w$ {}\-*\"']{0,40}\.whl`，名字侧允许任意 token。
PowerShell 那两行是 `$wheelGlob = Join-Path $Dist "qwenpaw-$CurrentVersion-*.whl"`，
`finditer` 从左往右走：在 `Join` 处起手的匹配能一路吃掉整条尾巴（`-Path $Dist "qwenpaw-$CurrentVersion-*.whl` 全落在尾巴字符集里），
于是这一枚匹配一直吃到行尾，**真正的 `qwenpaw-…whl` 已不在剩余区间里**，`group(1)` 是 `'Join'` —— 不在受盯身份里 ⇒ 整行被丢。
同一条模式在 `build_macos.sh` 上恰好抢不到（那里是 `${REPO_ROOT}/dist/qwenpaw-${CURRENT_VERSION}-"*.whl`，
`REPO_ROOT` 与 `CURRENT_VERSION` 后面都紧跟 `}` 或 `/` 而非 `-`，起点只能落在 `qwenpaw` 上），
`build_common.py` 那两行同理 ⇒ 现跑旧模式实测**六行 wheel 读点里只漏 `build_win.ps1` 的两行**。
症状因此像"我数漏了"，实际是**扫了但没扫到**。

**修法（两处，都在门禁侧）**：
1. 名字侧锚到受盯身份：`wheel_reader_pattern(tracked)` 构造 `(?<![\w.\-])(copaw-community|qwenpaw|copaw)-<tail>`，
   alternation 按名字长度倒序排（否则短名会先咬住长名的前缀），`tracked` 来自 `_tracked_names()`
   （声明 + 事实源的 `pypi_project` / `distribution`）。
   静态 `READER_PATTERNS` 因此从 5 支降到 4 支，第 5 支改为动态 ⇒ 全集 4 + 1。
   尾巴字符集同时补了 `.`（wheel 文件名里的点号版本段是这一族的常态，如 `qwenpaw-1.1.11b1.post1-*.whl`），
   现树实测含点与不含点两支模式命中同样 6 行 ⇒ 这一处是为将来的字面量放宽，不是本缺陷的必要修。
2. 相等补到**行级**：新增第 23 枚用例 `test_the_live_sweep_pinpoints_every_registered_line`，
   把登记表每条模板在现树展开成的 `(文件, 行)` 集合与全扫 `line N:` 命中的集合做 `==`。
   原先的相等只做在文件级（门禁动作 3 问"这枚落点文件在不在册"、守卫用例问"每条模板的字面量还在不在文件里"），
   正是这一级差让 `build_win.ps1` 的"文件在册、行漏扫"混过去。
   行级放在用例而不是门禁里，是因为"少扫一行"只能由扫描器自身缺陷造出 —— fixture 造不出那样的红，
   而按判据 193，没有可证红分支的规则等于没被钉的规则；这条用例与门禁同批在 CI 跑，强度一致。
   通过消息里的数字也改成从扫描结果现算（`10 registered templates, 11 read points swept in 5 files`），
   不再写死 —— 109-1 那句 `and 10 distribution readers` 就是把结论抄进字符串，它自己也会腐。

**TDD 读数（先红，红得正是那两行）**：红 = `Extra items in the right set: ('scripts/pack/build_win.ps1', 43) / (…, 36)`；
这两条一出现就把"漏扫"和"漏登记"分开了 —— 不是登记表缺条目，是扫描器没找到。
终树 `tests/unit/scripts` + `tests/unit/copaw` **169 passed in 8.73s**（门禁文件 23 枚），
现树门禁 **rc=0 / 1.50s**。

**门禁当场咬了我自己一次**：为解释这个吞匹配，我在门禁文件里写了那条违规字面量的例子，
扫描器立刻把 `scripts/check_release_channel_consistency.py:114` 报成**未登记读点**，3 枚用例红。
修法是把注释里的字面量改写掉（并在注释里注明"写出来就成了一枚读点"），**不是给门禁加豁免目录** ——
机制能扫到作者自己的注释，正说明它按设计在工作。

**lint 侧的既有坑（不是本批造的）**：裸跑 `black` 用默认 88 列，会把一枚既有的隐式字符串拼接合成一行 ⇒ flake8 `E501`；
`.pre-commit-config.yaml:62` 那枝 black 传的是 `--line-length=79`，与 `.flake8` 的 `max-line-length = 79` 是一对。
照钩子参数重跑后 `black --check` 与 `flake8 --extend-ignore=E203` 在两枚文件上均 **rc=0**。

**账（现算，非沿用）**：P1 `--check` rc=0，**117 文件 / +10,968 −521**（behavior 116 / +10,932 / −485，机械 1 枚 lockfile）
—— 与 109-1 落的读数逐字相同 ⇒ 本批 5 枚文件（门禁 + 用例 + 三本 docs）**零增长**。
四枝离线门禁同树 rc=0：namespace `PASSED`（`non_extension_copaw_only: 0`）· ci-command-targets `18 命令 / 4 包目录` ·
locale split `4,658 + 59 + 7 + 1,459 + 23` · brand `7 files / 35 lines`。
`src/` 未动 ⇒ L1 必过五目录不受影响（`tests/unit/security`、`tests/contract/security`、
`tests/unit/agents/{hooks,memory,utils}` 全含在下面的 CI 选择集里，该集合只红两枚 acp）。
CI 选择集（终树一趟，`tests/unit --ignore=tests/unit/channels`）：**2 failed / 15,802 passed / 23 skipped /
4 xfailed in 931.49s** —— 与 109-1 的 2 / 15,801 差 1 枚，就是本批新增的那条行级用例；
红的仍是 §8.35 登记的两枚 `test_acp_available_commands`（工作区耦合，未裁）⇒ **本批零新增红**。

**判据 196（全扫模式必须锚在受盯身份上，相等必须做到行级）**：一次"机器数一遍"的可信度取决于模式的**起点**，
不是它的覆盖面 —— 允许任意 token 作捕获组的名字侧，会被同行更早的更宽匹配非重叠吞掉，症状是**静默少报**而非报错。
配套的两条：把名字侧钉成受盯身份的倒序 alternation（并在注释里说明为什么不能放宽），
以及把相等门禁做到 `(文件, 行)` 级 —— 文件级相等会让"这枚文件因别的行在册"掩掉"这一行没扫到"。
判据 194 是这条的上半（清单会变账），196 是下半（账本身的形状要能容纳最坏的错误）。

**顺带更正的记录**：设计文档 §3 lead 句、§2 第 9 行、§8 规则 6、§10 阶段 2 条目与阶段 1 计划"阶段 2 接口"第 2 条
里的读点数全部从 10 改为 **11**（模板仍 10 条），并把"集合相等 / 逐行比对"这类含混说法改成明确分工的写法
（**门禁盯未登记的落点文件，守卫用例盯行级相等**）；§8.36 的三处旧串就地标注为"同日被第二次纠正，见本节"。

**本笔登记的未办**：① 109-2 那把照旧在册（fork 自有 `copaw-release.yml` + `--check-artifacts` + `constants.test.ts` 自咬前置修）—— **同日已落，见 §8.38**；
② §8.36 未办 ①–④ 照旧在册（阶段 2 宿主二选一待报、2 枚 acp 工作区耦合、上游 `secret_store`、8.32 ①–⑤）。

**已闭环计数推到 109（109-1 与其补刀 109-1b 同批闭环）；109-2 待做。**（109-2 同日落地，见 §8.38。）

---

### 8.38 刀 109-2（2026-10-11）：发布链路缺的是两道闸门，而那条写死的禁令两头都错

**一句话结论**：三处落地 —— `scripts/release_channel.py --check-artifacts`（+64）、fork 自有
`.github/workflows/copaw-release.yml`（155 行，配 6 枚断言 117 行）、`constants.test.ts` 那条
未锚定的 `/pip install copaw/` 换成按事实源状态判定（+35 −4）。上游四条发布 workflow 仍逐字节等于分叉点，
靠 GitHub 设置停用（**设置动作，未授权，仍在待裁**）。**这把不是零账册成本**：P1 行为 +31，见下面"账"。

**为什么新建 workflow 不必进冲突账**：现测 `.github/workflows/` 共 38 枚文件，除 `unit-tests.yml`
（fork-created）其余 37 枚在 `2744a976b` 上字节相同 ⇒ 新建一枚不碰任何上游文件；两个既有机制顺带把它盯住 ——
门禁 R3 的 `FORK_WORKFLOW_GLOB = copaw-*.y*ml` 把"fork 自有 workflow 不得指向上游地址"覆盖到它，
R6 的全扫 `READER_DIRS` 含 `.github/workflows` × 后缀 `.yml`，所以它若写成按分发名读 wheel 就以**未登记读点**变红。
现树读数仍是 `10 registered templates, 11 read points swept in 5 files`（与 §8.37 逐字相同 ⇒ 本批未新造读点）。
`check_ci_command_targets.py` 从上一笔的 `18 命令` 变成 **19 命令 / 4 包目录** —— 新增那 1 条正是本 workflow 的
`run` 步骤，被门禁验过指向真实目标。

**两道闸门各自被摘掉看过红（5 枚变异，每枚恰红 1 条）**：

| 摘掉/改掉 | 变红的断言 |
| --- | --- |
| 加 `release: published` 触发 | `test_it_can_only_be_started_by_hand` |
| 删 publish 的 `if: inputs.confirm_publish` | `test_publishing_requires_the_explicit_confirmation` |
| publish 的 `needs` 去掉 `artifacts` | `test_the_publish_job_downstreams_the_artifact_check` |
| `COPAW_PYPI_API_TOKEN` 换回上游的 `PYPI_API_TOKEN` | `test_it_never_borrows_upstream_pypi_secret_name` |
| 删 `channel` 里的一致性闸门步 | `test_a_job_exports_the_channel_facts_and_runs_the_consistency_gate` |

形状：`channel`（导出事实源到 `GITHUB_ENV` + 跑 R1–R6）→ `build`（前端产物 + `python -m build`）→
`artifacts`（`--check-artifacts dist`）→ `publish`（需人工 `confirm_publish`）。
上游那四条 YAML 一字不改（§7 裁决），所以**这个文件是我们到 PyPI 的唯一路径** —— 它必须自带闸门，
而不能指望"没人会误点"。

**`--check-artifacts` 为什么必须认两种规范化形式**：`python -m build` 按 `[project] name` 命名产物，
而 PEP 427 让 wheel 把 `[-_.]` 连串折成下划线、sdist 折成连字符 ⇒ `copaw-community` 的产物是
`copaw_community-…-py3-none-any.whl` 与 `copaw-community-….tar.gz` **同时存在**。只比一种会把自己的 sdist 判成外来的。
变异实测：把连字符那支改成下划线 ⇒ 恰红 `test_check_artifacts_accepts_both_normalized_forms` 1 枚；
把 `.tar.gz` 后缀摘掉 ⇒ 同一枚红。方向相反的两条红也在：pending 期一律拒（消息含 `pypi` / `pending`）、
空目录拒（`no artifacts`）、**`copaw-1.0-py3-none-any.whl` 也拒** —— `copaw` 是上游改名前那枚被占的包名
（§4，2026-10-08 裁），它看着像我们的，实际会把包发到别人的项目下。

**判据 98 在本刀的实证（那条旧断言两头都错）**：`not.toMatch(/pip install copaw/)` 既放过 `pip install qwenpaw`，
又会在渠道开通那天咬住本该教的 `pip install copaw-community`。三枚探针实测（改 `constants.ts` 文案 / 改事实源
`pending`，跑完用 Edit 还原；`git status` 证两枚文件字节未变，`grep pip install` 只剩三行 `-e .`）：

| 探针 | 新用例 | 旧用例 |
| --- | --- | --- |
| pending 期文案写 `pip install qwenpaw` | **红 1** | 绿 ⇒ 这就是漏 |
| 渠道已开、文案写 `copaw`（错名） | 红 1 | 红 1 |
| 渠道已开、文案写 `copaw-community`（合法） | 绿 | **红** ⇒ 自咬（旧正则对该串匹配为真，实测 `True`） |

新写法：从每语正文提取所有 `pip install` 的**目标 token**（跳过 flag 与 `.`，`uv pip install x` 由同一匹配吃到），
pending 期要求目标集为空，开通后每个目标必须逐字等于 `pypi_project`。
第二条探针同时红 `RELEASE_CHANNEL` 镜像那条（改事实源必然改到生成文件）—— 属预期，非新洞。

**TDD 读数**：`--check-artifacts` 先红 = `SystemExit: 2 / one of the arguments --print --sh --gh-env --write-ts is required`；
workflow 断言先红 = 文件不存在（`test_the_workflow_exists_and_parses`）。终树
`tests/unit/scripts` + `tests/unit/copaw` **180 passed in 9.22s**（上一笔 169 ⇒ 本批 +11 枚：CLI 5 + workflow 6），
门禁 **rc=0** 同串。

**账（现算，非沿用）**：P1 `--check --target-ref working` 在提交前就报
`behavior_added 10932 → 10963`、`console/src/layouts/constants.test.ts 88 → 119` ——
**本刀账册成本 +31 行**，全在那枚在册的上游用例文件里；其余四枚落点
（`scripts/release_channel.py`、它的 CLI 用例、新 workflow、新 workflow 用例）全是 fork-created ⇒ 不记账。
`behavior_removed` 与总 `removed` 不变（我删掉的 4 行本身就是 fork 加的行，不进上游行账）。
基线随本笔重立：`--write-baseline` 后 **117 文件 / +10,999 −521**（behavior 116 / +10,963 / −485，机械 1 枚 lockfile），
`--check` **rc=0**。

**其余读数**：前端全量 **532 文件 / 5,237 passed / 334.33s**（用例数不变：一条换一条）；
CI 选择集（`tests/unit --ignore=tests/unit/channels`）**2 failed / 15,813 passed / 23 skipped / 4 xfailed in 1169.27s**
—— 与 §8.37 的 2 / 15,802 差 **11 枚**，正是本批新增，红的仍是 §8.35 那两枚 `test_acp_available_commands`（工作区耦合，未裁）
⇒ **本批零新增红**。`src/` 未动 ⇒ L1 必过五目录不重跑。
`npx tsc --noEmit -p tsconfig.json` **0 错**（旧记的 19 枚在此命令下不复现，取现测为准）；
`prettier --check` 两枚前端文件干净；`black 23.3.0` 与 `add-trailing-comma` 迭代到**不动点**后同 Passed
（首跑两枚文件被 reformatted —— 钩子版本与本机 `black 26.10.0` 都不是"随手跑一次"的依据，以 pre-commit 为准）；
`flake8 --extend-ignore=E203` 三枚 Python 文件 **rc=0**。四枝离线门禁同树 rc=0：
namespace `PASSED` · ci-command-targets `19 命令 / 4 包目录` · locale split `4,658 + 59 + 7 + 1,459 + 23` ·
brand `7 files / 35 lines`。

**取不到的一条，如实登记**：`actionlint` 钩子离线装不起来（Go 依赖要网络，`proxy.golang.org` i/o timeout）。
对照实验：对**上游自己的** `.github/workflows/release.yml` 同样 rc=3 安装失败 ⇒ 这是环境缺口，不是本文件的裁决。
新 workflow 的 actionlint 结论只能等推送后由 CI 给。

**判据 197（禁令要写成"按可用性状态判定 + 提取目标集合"，不要写成被禁字符串的字面匹配）**：
以字面量为禁令的守卫同时具备两种错 —— 拼写不同的违规放过（`qwenpaw`），未来合法的文本咬住
（`copaw-community` 以 `copaw` 为前缀）。它的根因与判据 98 同族（用今天的非法串枚举明天的合法串），
197 给的是替代写法：状态读事实源，覆盖面靠"提取全部目标"而不是"列举已知坏值"，
于是渠道开关那天既不用改用例也不会漏掉别的名。

**本笔登记的未办（不裁，只落点）**：① 阶段 2 真发包的四把仍未落 —— `pyproject.toml:2` 改名 +
§3 那 11 处读点同把落 + `pending` 去掉 `pypi` + `copaw update` 从拒绝改真升级，**逐把需单独授权**；
② GitHub 设置停用上游四条发布 workflow、创建仓库密钥 `COPAW_PYPI_API_TOKEN`（设置动作，需授权）；
③ 那 6 枚 release-channel 前端用例整体搬进 fork 自有文件：可退掉本刀的 +31，并可能让
`constants.test.ts` 退回分叉点字节 ⇒ **关 1 枚冲突宿主**（待裁，不在本刀做）；
④ actionlint 的本地读数缺口（见上）；⑤ §8.36 未办 ①–④ 与 §8.35 两项照旧在册。

**已闭环计数推到 110（109-2 落）；阶段 2 的"发"那一步待授权，本刀只把闸门备好。**

---

### 8.39 刀 111（2026-10-11）：lint 批按归属分箱 —— 整批机械清的是 fork-created，在册那 10 枚格式化脏不是 lint 账是冲突账

**一句话结论**：五笔提交把 CI pre-commit 门禁里能机械清的全部清掉 —— prettier 145 枚 fork-created 前端文件
（`92470ce15`，+16,406 −8,724）、hanlp sidecar 里 668 条 tab Finding（`c2cbd526a`，350/350 行原地等宽替换）、
fork-owned Python 的 329 条残留 E501（`dd27f8a4c`，85 文件 +2,847 −1,334）、需要真编辑而非重排的
E402 34 + F841 8 + E226 1 + 一枚恒等 `replace`（`b0512a8ab`，12 文件 +18 −39）、30 条整行注释 E501
（`5ebbc839f`，17 文件 +66 −42）。**中间踩了一次账**：`0d32b4f31` 把 CI 钉的 black 落在一枚在册文件上，
P1 行为账 +5 侵入行，`be918f7b4` 退回记账字节。flake8 现算 **587**（= E501 561 + F811 25 + E305 1）。

**tab 岛为什么敢动**：334 行 tab 缩进全在两枚内嵌程序（`_BRIDGE_CODE`、`_WORKER_CODE`）的字符串内部，
sidecar 直接 exec 它们。`_BRIDGE_CODE` 末尾有 `.replace()` 做 tab 展开 ⇒ 每个 tab 换成 4 空格后
**运行时字节值不变**；`_WORKER_CODE` 没有那步 replace ⇒ 必须展开到 8 的倍数，且用 **AST 解析树不变**
作等价证明。27 枚 hanlp runtime 用例过。这是判据 184 家族第一次在"字符串内部"用双证（值等 + 树等），
而不是只靠"看起来没改语义"。

**注释层的护栏**：formatter 不会替整行注释换行，所以 30 条只能手写。护栏三条：每文件 AST dump 逐字节相同、
每文件注释**词序列**不变（只重排换行）、pinned black/add-trailing-comma 仍报不动点。编号项那几块保留行结构，
只断超长的那一行。

**判据 198（formatter 脏按归属分箱：fork-created 进 lint 账，在册文件进冲突账，别把两本混着清）**：
`0d32b4f31` 的错不是"格式化了"，是**格式化了一枚上游拥有的文件** —— 钩子的 black 会把 5 行改成
fork 的写法，于是 P1 行为侵入 +5，而这 5 行没有一处改变行为。同树对照：`be918f7b4` 退回后 P1 回到原读数，
门禁照红（它本来就红），**没有任何能力损失**。所以判据给的是分箱规则而不是"别跑 formatter"：
按调用点归属决定这笔账记在哪本上；在册文件的 formatter 脏属于 §8.34 那批"待裁的侵入行"，
把它算进 lint 清理进度就是虚报。

**现算更正两条旧记**：①`92470ce15` 的消息写"13 枚在册前端文件"，**现测 10 枚**（MCP 簇那批在刀 93/107 里已被别的目的改过）；
②同消息写"tsc 同样 19 枚既有错"，现测 `npx tsc --noEmit -p tsconfig.json` **0 错**（§8.38 已记此更正，本处只是说明那条 commit message 不作数）。
10 枚在册文件的 prettier 代价实测 **+316 / −207 行**，0 枚新冲突宿主 —— 见 §8.41 末待裁清单。

**未办（不裁，只落点）**：① 那 10 枚在册文件的 prettier 脏（待裁）；② 15 枚在册文件的 black/ATC 脏（判据 184，待裁）；
③ flake8 残 587 的分档与可修层（在 §8.41 末给表，待裁）。

### 8.40 刀 112（2026-10-11）：三处漏 `await` —— 一条返回协变量 repr，一条被裸 except 吞成日志

**一句话结论**：`install_skill_from_hub` 在分叉点就是 `async def`，但三处 fork 自写的调用点当普通函数调它。
市场安装路由把**协变量的 repr 当结果返回**，还传了签名里根本没有的 `overwrite=`；bundle 导入循环里
每枚技能都记进 `skill_errors` 而一枚都没装 —— 因为协变量的 `.name` 抛 `AttributeError`，
被循环那句裸 `except Exception` 收成了错误字符串。参照模式就在同一个 router 里：
`_run_hub_install_task` 一直是正确 await 的写法。

**落点**（两枚在册文件，账只减不增）：`app/routers/skills.py` 删
`overwrite = payload.overwrite or bool(cfg.install.overwrite_default)` 与 `overwrite=` 实参并补 `await`；
`app/routers/agents.py` 的 `_activate_import_bundle` 改 `async def` + `await install_skill_from_hub(...)` +
调用点 `await`。P1 行为侵入 **10,963 → 10,961（−2）**，总账 117 文件 / **+10,997 −521**。

**为什么先写用例而不是先改**：这类缺陷的症状是"接口 200、内容错"，改完再补用例就只能断言"现在对了"。
两枚新用例都断**被 await 的那次调用的实参**，而不是断返回形状：
`tests/unit/app/routers/test_agents_import_bundle_skills.py`（新文件）证 bundle 导入真的调到安装函数且不落
`skill_errors`；`tests/unit/app/routers/test_skills_market.py` 追加一枚，捕获 `workspace_dir / bundle_url /
version / enable / target_name / cancel_checker` 六个实参并断 `captured["cancel_checker"] is None`
—— 后者同时清掉这枚新用例自己引出的那 1 条 pylint `W0613 unused-argument`（参数被记录=被断言=不再未用）。

**读数**：CI 选择集（`tests/unit`）**2 failed / 17,834 passed / 24 skipped / 4 xfailed in 19m18s** ——
红仍是 §8.35 那两枚 acp（工作区耦合，未裁），pass 数相对 §8.38 的 15,813 只增不减（批间新增），
4 枚 strict xfail 仍红着（没被"顺手改绿"）。

**判据 199（漏 await 的守卫要断"那次调用拿到了什么实参"，不能断"这次响应成功"）**：
协变量不是错误 —— 它能让 HTTP 200、能让断言"返回非空"通过、能被 `str()` 得出一串可读的文本。
所以按结果形状写的用例对这类缺陷天然免疫失效。可迁移的写法是把 mock 的 `captured` 字典当作合同面：
断每个实参，尤其是**签名里不该存在的关键字**（`overwrite=`）与**默认值实参**（`cancel_checker is None`）——
前者一旦上游签名变化就会红，后者保证被 await 的那次调用是完整的那次。

**未办**：`_activate_import_bundle` 的 `overwrite` 形参现在无人使用（pylint `W0613` 保留在册）——
它是调用方协议的一部分，删不删随 §8.41 的 unused-argument 一并裁，不在本刀做。

### 8.41 刀 113（2026-10-12）：pylint 的 1,457 条里"改了没人会反对"的那族只有 93 条，而剩下 44 条真缺陷全在别人文件上

**一句话结论**：`9c552a4d5` 在 **40 枚 fork-created 文件**上做 **76 处编辑**，把 pylint 整树 **1,457 → 1,364**
清掉 **93 条**（这 40 枚自己从 758 → 665，整树差与局部落差同为 93 ⇒ 没有在任何别处新增 finding）；
尾批 `88a701b0f` 再清 3 条 `unused-import`，**1,364 → 1,361**，把 fork-created 文件上的"真缺陷族"清零。
剩下的 1,361 条切三档：**风格意见 1,289 / 环境假阳性 28 / 真缺陷 44**，而 44 条**全部**落在在册文件上 ——
这就是本刀停手的位置，也是 §8.42 要裁的全部。

**提交消息里的一个数要更正**：`9c552a4d5` 写"76 findings cleared (1,457 -> 1,364)"，把两个不同的量当成一个。
现算是 **76 处编辑操作 / 93 条 findings 清掉**（一处编辑可清多条，例如一枚文件里的 10 枚死导入）。

**为什么切"真缺陷 vs 风格意见"，而不是照单清到 0**：成本不对称，且 pylint 的默认消息码集合本身不是本合同的规格。
主干五族 —— `protected-access` 549（全在 fork-created）、`redefined-outer-name` 264、`unused-argument` 140、
`line-too-long` 113、`too-many-*` 122 —— 改它们要么给几百处访问补公共接口，要么动函数签名与测试局部变量名，
收益是"少一条警告"，风险是行为面变化。反过来 `unused-import` / `reimported` / `unreachable` 是**读代码的人
会被误导**的那类，且清它们只删不改。**环境假阳性 28 条**另有一层：`no-name-in-module` 23 枚里 15 枚在
上游同文件上，报错原因是钉住的 lint 环境未安装 `mcp` 那组依赖；`E1120/E1123/E1136` 6 枚同属类型面而非事实面。

**pylint 现算全表**（消息码 × 归属，`pre-commit run pylint --files` 逐文件跑 + 逐文件归属；总数 1,361）：

| 消息码 | 现 | fork-created | 在册 | 上游同 | 定性 |
| --- | --- | --- | --- | --- | --- |
| `protected-access` (W0212) | 549 | 549 | 0 | 0 | 风格意见 |
| `redefined-outer-name` (W0621) | 264 | 256 | 8 | 0 | 风格意见 |
| `unused-argument` (W0613) | 140 | 136 | 4 | 0 | 风格意见 |
| `line-too-long` (C0301) | 113 | 94 | 19 | 0 | 风格意见 |
| `too-many-branches` (R0912) | 53 | 51 | 2 | 0 | 风格意见 |
| `too-many-statements` (R0915) | 40 | 38 | 2 | 0 | 风格意见 |
| `reimported` (W0404) | 26 | 0 | 26 | 0 | 真缺陷 |
| `too-many-return-statements` (R0911) | 25 | 23 | 2 | 0 | 风格意见 |
| `no-name-in-module` (E0611) | 23 | 8 | 0 | 15 | 环境假阳性 |
| `unnecessary-lambda` (W0108) | 23 | 21 | 2 | 0 | 风格意见 |
| `wildcard-import` (W0401) | 22 | 22 | 0 | 0 | 风格意见 |
| `unused-wildcard-import` (W0614) | 22 | 22 | 0 | 0 | 风格意见 |
| `unused-import` (W0611) | 17 | 0 | 17 | 0 | 真缺陷 |
| `wrong-import-order` (C0411) | 14 | 0 | 14 | 0 | 风格意见 |
| `use-implicit-booleaness-not-comparison` (C1803) | 7 | 5 | 2 | 0 | 风格意见 |
| `ungrouped-imports` (C0412) | 5 | 0 | 5 | 0 | 风格意见 |
| `too-many-nested-blocks` (R1702) | 3 | 2 | 1 | 0 | 风格意见 |
| `no-value-for-parameter` (E1120) | 2 | 0 | 0 | 2 | 环境假阳性 |
| `unsubscriptable-object` (E1136) | 2 | 2 | 0 | 0 | 环境假阳性 |
| `try-except-raise` (W0706) | 1 | 1 | 0 | 0 | 风格意见 |
| `unexpected-keyword-arg` (E1123) | 1 | 0 | 1 | 0 | 环境假阳性 |
| `superfluous-parens` (C0325) | 1 | 1 | 0 | 0 | 风格意见 |
| `chained-comparison` (R1716) | 1 | 1 | 0 | 0 | 风格意见 |
| `useless-return` (R1711) | 1 | 1 | 0 | 0 | 风格意见 |
| `unreachable` (W0101) | 1 | 0 | 1 | 0 | 真缺陷 |
| `too-many-boolean-expressions` (R0916) | 1 | 1 | 0 | 0 | 风格意见 |
| `consider-using-with` (R1732) | 1 | 1 | 0 | 0 | 风格意见 |
| `unnecessary-pass` (W0107) | 1 | 1 | 0 | 0 | 风格意见 |
| `too-many-public-methods` (R0904) | 1 | 1 | 0 | 0 | 风格意见 |
| `cell-var-from-loop` (W0640) | 1 | 1 | 0 | 0 | 风格意见 |

**归属的三种读法怎么算**（判据 198 的机制，这里给可复现命令）：`git rev-parse -q --verify 2744a976b:<path>`
不存在 ⇒ **fork-created**（编辑零账面成本）；存在且列在 `scripts/p1_baseline.json["files"]`（118 枚键）⇒ **在册**；
存在且 `git hash-object` 与分叉点字节相同 ⇒ **上游同**。表里"上游同"只有 17 条，但每一条都是**碰一下就新造一枚
冲突宿主**，所以它们不是"待修"，是"看着能修、实际不能碰"。

**判据 200（formatter 口径必须带上钩子的 `--line-length=79`；按 black 默认的 88 去量会凭空造出 33 枚脏文件）**：
本刀编辑后我先跑不带参数的 `black --check`，得到"40 枚里 33 枚已脏"，据此几乎要写下"这批文件格式债早就存在"。
钩子是 `args: [--line-length=79]`（`.pre-commit-config.yaml`，`.flake8` 同样钉 `max-line-length = 79`）。
同一棵树换成 79 重测：**HEAD 上这 40 枚 0 枚脏**，编辑后 **3 枚脏 / 16 行 diff**。也就是说脏不是既有债，
是本刀自己造的新债 —— 而 88 的读数把它伪装成了既有债。可迁移的动作只有一个：**量之前先读钩子的 args**，
因为两个口径的差足以让"既有"与"新增"互换，而这条界线正是判据 198 赖以分箱的前提。

**判据 201（隐式字符串拼接的重排和 black 的合流对撞；同时满足 flake8 / black / pylint 的形状只有一枚融合字面量）**：
`implicit-str-concat`（W1404）只对**跨行**拼接开火。写成单行 `"a" "b"` 能让 pylint 闭嘴，但那正是
flake8 与可读性都不想要的形状；写成括号里的跨行拼接，black 在 79 装得下时会把它**合流**，合流后又变回单行拼接。
三把尺子的唯一不动点是**把相邻字面量并成一枚**（值不变，只是不再"相邻"）。四处同型修正：
`tests/unit/providers/test_openai_stream_thinking_leak_compat.py`（`leaked = "Thinking\n## ✅ 当前进展确认 - 没有丢失！\n根据我刚才的读取验证，所有成果都已保存。"`）、
`tests/unit/knowledge/test_local_graph_provider.py`（`write_text` 的内容并为一枚）、
`src/qwenpaw/knowledge/graphify_provider.py`（`sorted_nodes = sorted(nodes, key=G.degree, reverse=True)[:top_k]` 收成一行）、
`src/qwenpaw/knowledge/manager.py`（`persisted_lines` 的换行只保留 ATC 要求的那枚尾逗号）。
自拦一条：第一次尝试保留两行拼接，**没跑就否掉**了 —— 那个长度在 79 内，black 必然合流，合流后 W1404 重新开火。

**验证读数**（全部改后现算；black/ATC/pylint 三枚是刚复算的，与记录逐字相同）：
- pinned black `--line-length=79 --check` 这 40 枚：**`40 files would be left unchanged`**；
  add-trailing-comma 在 `/tmp` 副本上跑，**40 枚无变化**（钩子版本不接受 `--line-length`，只能是默认行为）。
- `pre-commit run pylint --files` 这 40 枚：**665 条**，评分 9.62/10，无新增消息码。
- `pre-commit run flake8 --all-files`：**587 条不变**（不给显式文件列表 —— 那会绕过 `.flake8` 的 exclude）。
- 定向 pytest：**3,672 passed / 1 skipped / 4 xfailed**；本刀改过的 5 枚测试文件复跑 **32 passed**。
- L1 必过五目录：**1,339 passed / 1 skipped**。
- CI 选择集（`tests/unit`）：**2 failed / 17,834 passed / 24 skipped / 4 xfailed in 1107.06s** ——
  与 §8.40 记录的基线逐字相同，两枚红仍是那两枚 acp（工作区耦合，未裁）。
- P1 `--check --target-ref working` **rc=0**，账 **117 文件 / +10,997 −521** 未动（40 枚全 fork-created）；
  六枚离线门禁 rc=0（用 `/tmp/copaw312/bin/python`，系统 python3 缺 `yaml`/`packaging`/`dotenv`）。

**flake8 残 587 的分档**（本刀不动它：它是 §8.39 的账；给表只为 §8.42 有数可裁）：

| 码 | 条数 | fork-created | 在册 |
| --- | --- | --- | --- |
| `E501` line too long | 561 | 376 | 185 |
| `F811` redefinition | 25 | 0 | 25 |
| `E305` expected 2 blank lines | 1 | 0 | 1 |

E501 按**物理行形状**（现算：tokenize 判是否落在多行字符串 token 内，行首 `#` 判整行注释）：

| 形状 | 条数 | fork-created | 在册 |
| --- | --- | --- | --- |
| 行内字符串超限 | 304 | 244 | 60 |
| 纯代码超限 | 175 | 55 | 120 |
| 落在多行字符串内部（docstring/模板） | 75 | 73 | 2 |
| 代码 + 行尾注释 | 5 | 4 | 1 |
| 整行注释 | 2 | 0 | 2 |

这张形状表说明为什么"剩 561 条"不等于"还能机械清 561 条"：formatter 只替**纯代码**那 175 条换行，
`fork-created` 那半里还有 73 条在字符串内部（改了会改值，只能改文案本身）、244 条是行内字符串（同理）；
整行注释那 30 条已在 `5ebbc839f` 手写过。

**F811 25 条全在册**：21 枚在 `app/routers/agents.py`（自动合并造出的导入影子，§8.34 已记），3 枚在
`config/utils.py`，1 枚在 `agents/utils/file_handling.py`。它们与 pylint 表里在册的 `reimported` 26 +
`unused-import` 17 + `unreachable` 1 是同一批痕迹 —— 合并把导入写了两遍，两把尺子从两侧看到同一件事。

**待裁清单（§8.42 呈报的四问，本刀一律不自裁）**：
① 风格意见族 **1,289** 条：加 `--disable` 进 `.pre-commit-config.yaml`（该文件是**上游同**，动它 = 开一枚配置宿主）、
还是逐族留账不改配置、还是只在 fork-created 文件上加行级 pragma。
② 环境假阳性 **28** 条：是否给 pylint 钩子补 `additional_dependencies`（`mcp`）—— 同样是动上游同的配置文件。
③ 在册 **44** 条真缺陷（`reimported` 26 / `unused-import` 17 / `unreachable` 1）+ flake8 `F811` 25 + `E305` 1：
清它们必须动在册文件，判据 198 说这属于冲突账，要单独授权而不是随 lint 批走。
④ 在册 formatter 脏：prettier **10** 枚（+316 / −207，0 枚新宿主）+ black/ATC **15** 枚。

**未办**：`_activate_import_bundle` 的 `overwrite` 形参（`W0613`，在册）随 ① 一起裁；
`redefined-outer-name` 在册那 8 条随 ③ 一起裁。

### 8.42 刀 114（2026-10-12）：裁决 ③ 落了 —— 在册真缺陷 44 → 1，剩下那 1 条不是 lint 账而是实现分歧

**一句话结论**：§8.41 待裁 ③ 授权后，**9 枚文件 / 21 处编辑**把在册 pylint 真缺陷 **44 → 1**、
flake8 **587 → 562**（`F811` 25 → 1、`E305` 1 → 0）；P1 账 `behavior_added 10,961 → 10,937`（−24）、
`behavior_removed 485 → 486`（+1），冲突面文件数 **117** 不变。留着的那 1 条是 `app/routers/agents.py:86`
的 `SkillPoolService` 导入影子 —— 两个同名类的实现不同，去重就等于替一枚上游拥有的路由选实现，
那是产品裁决而不是合并卫生裁决。本刀之所以敢在别人的文件上删 22 行，靠的是改前改后各做一次
**模块级绑定身份对拍**（判据 202）。

**逐文件的账**（`--target-ref working` 现算；pylint 列 = 该文件结清的消息）：

| 文件 | 归属 | 编辑 | `behavior_added` | `behavior_removed` | 结清 |
| --- | --- | --- | --- | --- | --- |
| `src/qwenpaw/app/routers/agents.py` | 在册 | 26 删 / 4 改：把 fork 那半的导入面收窄到上游没写过的名字（含 9 行 `fastapi` 块、`pydantic` 整行，以及函数体内那处 `import shutil`） | 3790 → 3768（−22） | 6 → 6 | `reimported` 21 + `unused-import` 2 |
| `src/qwenpaw/config/config.py` | 在册 | 删 4 枚零消费名、10 枚 re-export 名改语句级 pragma | 65 → 63（−2） | 0 → 0 | `unused-import` 14 |
| `src/qwenpaw/config/utils.py` | 在册 | 删 fork 那 2 行，把上游那 2 行恢复成字节相同 | 25 → 23（−2） | 0 → 0 | `reimported` 3 |
| `src/qwenpaw/agents/utils/file_handling.py` | 在册 | fork 那行收窄成只导 `get_current_focus_dir`，不动上游行 | 3 → 3 | 2 → 2 | `reimported` 1 |
| `src/qwenpaw/agents/skill_system/__init__.py` | 在册 | `E305`：`__all__` 前补一枚空行 | 20 → 21（+1） | 0 → 0 | flake8 `E305` 1 |
| `tests/unit/app/routers/test_config_router.py` | 在册 | `HTTPException` 全文件 0 引用，改上游那一行 | 50 → 51（+1） | 8 → 9（+1） | `unused-import` 1 |
| `tests/unit/providers/test_retry_chat_model.py` | fork-created | `unreachable` 行级 pragma | — | — | `unreachable` 1 |
| `tests/unit/app/routers/test_agents_project_artifacts_router.py` | fork-created | 2 处借道把手改字符串形式（见判据 203） | — | — | — |
| `tests/unit/test_module_import_bindings.py` | fork-created | 刀 95 影子表退一枚已结清的登记 + 更正注释 | — | — | — |

**账差为什么是 −24 / +1**：−22 −2 −2 +1 +1 = −24；`behavior_removed` 那唯一 +1 来自
`test_config_router.py` —— 本刀只在那枚文件里**改写了上游的一行**（`from fastapi import FastAPI, HTTPException`
→ `from fastapi import FastAPI`），改写上游行按定义就是"删掉一枚上游行 + 加一枚 fork 行"。
其余全部落在 fork 自己写的那半：删的是重复行，恢复的是上游原文。
`skill_system/__init__.py` 的 +1 是新加的那枚空行，不是行为。

**44 → 1 的三种处置**：**删 32 / 抑制 11 / 留 1**。抑制的 11 枚 = `config/config.py` 那 10 枚
re-export 名（语句级 `# pylint: disable=unused-import`）+ `test_retry_chat_model.py` 那枚 `unreachable`
（行级 pragma，且必须落在 `yield` 那一行，不是 `async def` 那一行）。

**为什么 `unused-import` 17 枚只删 7 枚**：`src/copaw/config/config.py:3` 是
`from qwenpaw.config.config import * # noqa: F401,F403`，而 `qwenpaw/config/config.py` 没有 `__all__` ——
于是那里每一个公开名都是**外部可达的公共面**（`copaw.config.config.X` 全部能解析）。加 `__all__` 会改变
`import *` 的语义（把 wildcard 面收窄），删导入会让真实消费者的名字变 `AttributeError`。全树 grep 只有
4 枚是零消费（`KnowledgeTaskSpec` / `KnowledgeTaskMatrixConfig` / `KnowledgeIndexConfig` /
`KnowledgeAutomationConfig`，只在 `product_models.py` 的定义处出现），那 4 枚删；其余 10 枚抑制。

**顺带消失的风格意见，和一句没结清的话**：去重把 `wrong-import-order` 14 → 12、`ungrouped-imports` 5 → 2、
`redefined-outer-name` 8 → 7 —— 它们本来就是同一批重复导入的次生症状。逐消息对账（12 枚在册宿主）：
**105 → 56**，其中 49 条消失、2 条 `C0411` 只是换了描述（同一枚 finding，它指的导入行改了写法）。
§8.41 未办把"在册 `redefined-outer-name` 8 条"挂在 ③ 名下，实际**只顺带掉 1 条，剩 7 条仍在**
（`test_tools_router.py` 5 枚同名 fixture + `test_workspace_router.py` 1 枚 + `test_retry_chat_model.py`
1 枚 `httpx`）。它们不是导入影子，本刀没碰，如实退回待裁。

**判据 202（"重复导入"去重前先证两个名字绑到同一个对象；同名同物是 lint 账，同名异物是分歧账）**：
flake8 与 pylint 都只能证明"这行写了两次"，不能证明"两次是同一个东西"。本刀对 5 枚改动的生产模块做了
模块级绑定身份对拍（`name → 定义模块`，改前改后各 dump 一次）：`agents.py` 只丢 `NoReturn` 与 `importlib`
两枚零消费名，`config/config.py` 只丢那 4 枚零消费名，`config/utils.py` 与 `file_handling.py` 的绑定表逐字不变。
全刀只有**一处换了绑定**：`get_workspace_skills_dir` —— fork 那行指向 `agents.skills_manager`，上游那行指向
`agents.skill_system.store`；用 `inspect.getsource` 证明两份源码逐字相同（`same object: False`、
`source identical: True`）之后，才按判据 101"按定义符号找接替者"删掉 fork 行、保留上游行。
反过来 `SkillPoolService` 不成立，所以它留着：fork 的 `agents/skills_manager.py` 版 15 个方法，
上游 `agents/skill_system/pool_service.py` 版 19 个，15 个共有方法里**只有 `__init__` 的 AST 相同**，
其余 14 个别体不同，上游另有 `_configure_skill_automation` / `rename_in_workspaces` /
`set_skill_auto_sync` / `set_skill_automation` 四枚 fork 没有。该路由唯一的用法在
`agents.py:1956`：`pool_service = SkillPoolService()` → `download_to_workspace(skill_name=, workspace_dir=,
overwrite=False)`。留哪一行 = 选哪个实现，本刀不选。
可迁移的动作：**任何"去重 / 删死导入 / 改指接替者"类清理，先跑绑定对拍，把同名同物与同名异物分开**。

**判据 203（"未用导入"可能是测试的借道把手：删之前 grep 全树的 `句柄模块.库.属性` 形状）**：
删掉 `agents.py` 里那枚 pylint 判定"未用"的 `import importlib.resources` 后，CI 选择集从 2 红变 5 红。
逐条根因：两枚在 `tests/unit/app/routers/test_agents_project_artifacts_router.py`，它们不 patch 真调用点，
而是伸手进模块命名空间取那枚导入句柄 —— `monkeypatch.setattr(agents_router_module.importlib.resources,
"files", ...)`，被改的是**进程共享的** `importlib` 模块对象；生产代码的真实调用点在
`project_scaffold_services.py:47`，与那枚导入无关，所以 pylint 说"未用"是对的，测试却说"在用"。
第三枚是刀 95 的影子表 `test_module_import_bindings.py` 自我兑现：表里登记的两枚名有一枚被本刀结清，
守卫按设计开红 —— 那枚红不是缺陷，是门禁在正常工作。修法都在测试侧（两枚文件均 fork-created，零账面成本）：
把手改字符串形式 `monkeypatch.setattr("importlib.resources.files", ...)`，影子表退掉那枚已结清的名。
可迁移的动作：pylint 的"未用"只统计**本文件内**的名字使用，看不见别的文件通过模块对象伸手进来；
删这类导入前把全树的 `\.importlib\.` 一类的借道形状 grep 一遍。

**判据 204（会写文件的测量必须在副本上跑：`black` 有 `--check`，add-trailing-comma 没有）**：
为了回答"ATC 会给 `agents.py` 造多少脏"，我把钩子直接跑在工作树上 —— 它当场写入 19 枚尾逗号，
diff 从 30 行涨到 68 行，把裁决 ④ 尚未授权的在册 formatter 脏混进了本刀的 ③。恢复方式：
`git show HEAD:` 取原文，用一个脚本做 8 处逐字替换（每处断言恰好命中 1 次），再证明重建结果与 ATC 的输出
只差那 19 枚逗号；绑定对拍、P1 账、flake8、pylint 四项读数全部回到误跑之前。
可迁移的动作：测量类命令先问一句"它会写吗"，会写的只在 `/tmp` 副本上问。

**在册 formatter 脏零新增的证明**（判据 200 的口径：pinned black `23.3.0` + `--line-length=79`、钩子版 ATC）：
对 HEAD 与工作树分别跑，逐文件比"black 会新增的行数"与"ATC 会改动的行数"：
`agents.py` 前后都是 **117 / 19**，其余 5 枚在册宿主前后都是 **0 / 0**。
本刀既没让任何一枚在册文件的 ④ 脏变多，也没顺手替它清掉一点。

**读数核对，一处更正**：`scripts/check_ci_command_targets.py` 现读 **19 命令 / 4 包目录**。
§8.34 与 §8.37 记的 "18" 是 109-2 那枚 fork 自有 workflow 落地**之前**的读数，§8.38 已把它记成 19 ⇒
不是账漂，是旧读数还留在原地，本刀不改写历史。

**判据 205（只罚增长的门禁对"收缩方向的陈旧"是盲的；重立基线要先确认 `--write-baseline` 参照的是工作树）**：
`--write-baseline` 不带 `--target-ref working` 时量的是 **HEAD**。我先按默认写了一次，得到
`+10,997 / behavior 10,961 / removed 485`，而提交里的基线记的是 `10,999 / 10,963` —— 差的 2 行在
`app/routers/skills.py`（`704 → 702`）：刀 113 的尾批 `88a701b0f` 让账收缩了 2 行却没重立基线。
因为 `--check` 只对"增长"开红，收缩从未被报出来，基线与真实账可以长期不一致而全绿。
按工作树重立后 `--check --target-ref working` **rc=0**，新账 `117 文件 / +10,973 −522`、
`P1-行为 116 文件 / +10,937 / −486`、`naming 1 纯 / 8 涉 / 36 行`、`mechanical 1`。
可迁移的动作：每当一笔刀合法地移动了册，收尾时用 `--write-baseline --target-ref working`，
并在记账里写上"基线已从工作树重立"，否则下一次有人按默认参照重写基线，会把未提交的编辑当成既有账。

**判据 206（"整树"读数只能用带 exclude 的那条命令量；逐枚文件拼出来的表与它不是同一个文件集）**：
本刀按 §8.41 记的 1,361 起算，实测宿主集内 −49，两数对不上（1,361 − 49 = 1,312，而工作树跑出来是 1,314），
差 2 逼出这次 A/B。用同一枚钉住的 pylint 环境（`~/.cache/pre-commit/repo9m7jmnhs`，3.0.2）、
同一条 `pre-commit run pylint --all-files`，在**另一枚干净 worktree**（`CoPaw-wp14`，同样停在 `fc8f103df`）
量 HEAD：**1,363 → 1,314，−49**，与宿主集内的 −49 逐码吻合 ⇒ 本刀没有在任何别处开新 finding。
对照之下 §8.41 那张表有三处与实测不符：总数 **1,361**（实 1,363）、`unused-argument` **140**（实 143）、
`unexpected-keyword-arg` **1 条在册**（HEAD 实测 **0**）—— 少 3 与多 1 相加正好是 2。
那张表的口径是"`--files` 逐枚跑 + 逐枚归属"，而钩子对整树自带 exclude（`^docs`、`pb2.py`、`grpc.py`），
两种跑法的**文件集不同**，所以"表加总"与"整树"不能混用，也不该拿其中一个去校另一个。
可迁移的动作：报"整树"就只报 `--all-files`，报"这批文件"就只报 `--files`，且每次宣称"没有外溢"时要像本刀一样
**拿另一枚干净 worktree 量 HEAD**，而不是引用上一节里那个来路不同的总数。

**整树 A/B 的逐码差**（HEAD `fc8f103df` → 工作树，`--all-files`，全部落在本刀宿主集内）：

| 码 | HEAD | 现 | 差 |
| --- | --- | --- | --- |
| `reimported` (W0404) | 26 | 1 | −25 |
| `unused-import` (W0611) | 17 | 0 | −17 |
| `ungrouped-imports` (C0412) | 5 | 2 | −3 |
| `wrong-import-order` (C0411) | 14 | 12 | −2 |
| `unreachable` (W0101) | 1 | 0 | −1 |
| `redefined-outer-name` (W0621) | 264 | 263 | −1 |
| **合计** | **1,363** | **1,314** | **−49** |

**验证读数（本刀收口的九项，全部为该树现读）**

- **flake8**（`pre-commit run flake8 --all-files`，权威口径）：**587 → 562**。差额正好是本刀的
  25 枚 `F811` + 1 枚 `E305`；残余形状 = `E501` 561 + `F811` 1，而那 1 枚 `F811` 就是 `SkillPoolService`
  的存活影子（它和 44 里剩下的那 1 枚 `reimported` 是同一行的两种说法，不是两笔债）。
- **pylint 整树**：`1,363 → 1,314`，−49，逐码见上表；A/B 用另一枚干净 worktree 量 HEAD（判据 206）。
- **在册真缺陷**：**44 → 1**（`reimported` 26→1 / `unused-import` 17→0 / `unreachable` 1→0）。
  fork-created 侧的真缺陷族在 `88a701b0f` 已清零，本刀之后再无"我们的文件里有真 bug"这一格。
- **P1 册**：**117 文件 / +10,973 −522**；`P1-行为 116 文件 / +10,937 / −486`；`naming 1 纯 / 8 涉 / 36 行`；
  `mechanical 1`。`behavior_added` 净减 24（去重删掉的都是 fork 加的行），`behavior_removed` 净增 1
  （唯一一处上游自有行改写：`test_config_router.py:26` 去掉 `HTTPException`）。
  基线**已从工作树重立**（判据 205），`--check --target-ref working` **rc=0**。
- **L1 必过五目录**：**1,339 passed / 1 skipped**（`tests/unit/security`、`tests/contract/security`、
  `tests/unit/agents/{hooks,memory,utils}`）。
- **本刀宿主相关的定向 pytest**（上述五目录 + `tests/unit/app/routers`、`tests/unit/providers`、
  `tests/unit/config`）：**3,583 passed / 1 skipped**。
- **全量 unit 套件**：**2 failed / 17,834 passed / 24 skipped / 4 xfailed**（18 分 30 秒）。
  那 2 枚红是合并后一直在册的 `tests/unit/agents/test_acp_available_commands.py::{test_new_session_advertises_commands,
  test_load_session_advertises_commands}` —— 用例依赖 acp 工作区形状，与本刀无关，**本刀零新增红**
  （判据 207）。
- **五道离线门禁同树 rc=0**：namespace boundaries `PASSED` · ci-command-targets **19 命令 / 4 包目录** ·
  locale split `4,658 + 59 + 7 + 1,459 + 23` · brand `7 文件 / 35 行` · release-channel R1–R6
  `6 文件 / 10 模板 / 11 读点 / 5 宿主`。
- **formatter 脏零新增**：pinned black `23.3.0 --line-length=79` 与钩子版 ATC 对 HEAD 与工作树逐文件对拍，
  `agents.py` 前后 **117 / 19** 不变，其余 5 枚在册宿主前后 **0 / 0** 不变（判据 204 的口径）。

**判据 207（"去重导入"这类刀的红测面要包含全量套件，不能只跑宿主目录）**：本刀的编辑集中在 6 枚生产文件的
导入块，而真正会被它们打破的是**用字符串路径反射**的测试。三枚测试侧红（`test_config_router`、
`test_retry_chat_model`、`test_agents_project_artifacts_router`）里只有第一枚在宿主同目录，另两枚分别在
`providers` 与 `app/routers` 的另一支文件；判据 203 那种"通过共享模块对象打补丁"的耦合，只有跑到那一支用例时
才会现形。可迁移的动作：动导入块 = 跑全量 `tests/unit`，并和合并后已知的红集（当前 2 枚 acp）逐枚对名字，
而不是只看"有没有新红"。

**待裁清单（刀 114 之后重列；①②④ 是旧项换新数，③ 只结清了一半）**

- ① **pylint 风格意见 1,286**（1,314 − 27 环境假阳性 − 1 存活真缺陷）：三条路仍是
  加 `--disable` 进 `.pre-commit-config.yaml`（该文件是上游同，动它 = 新开一枚配置宿主）/
  逐族留账不改配置 / 只在 fork-created 文件加行级 pragma。本刀不改这个数，只把它的分母从 1,314 起算。
- ② **环境假阳性 27**（`no-name-in-module` 23 + `E1120` 2 + `E1136` 2）：是否为 pylint 钩子补
  `additional_dependencies`（`mcp`）。同样是动上游同的配置。
- ③ **在册真缺陷：结清 43/44，剩 1 枚不是 lint 账** —— `src/qwenpaw/app/routers/agents.py:86` 的
  `SkillPoolService` 是 fork 副本与上游实现的**同名不同体**（AST 方法体对拍：fork 版有 fork 自己加的方法，
  上游 `skill_system` 版是另一套；router 只有一个使用点）。**待裁：这一枚用 fork 实现还是上游实现。**
  答完之前它同时是 1 枚 `reimported` 和 1 枚 `F811`，任何"再清一遍 lint"的刀都绕不过它。
- ③-补 **在册 `redefined-outer-name` 还剩 7 条**（本刀只落 1 条，因为其余 7 条要靠重命名函数内变量，
  属风格意见而非缺陷）；`agents.py:4505` 那条 `overwrite` 同样未动。
- ④ **在册 formatter 脏**：prettier 10 枚（+316/−207）+ black/ATC 15 枚（付它是 +172 行 P1，判据 184 已裁
  "先不付"）。本刀证明它**没有因为 ③ 而变多**，所以这一项的价码与本刀之前完全一致。
- **E501 561**：形状分层见 §8.41（行内串 304 / 纯代码 175 / 多行串内 75 / 代码+尾注 5 / 整行注释 2）——
  formatter 只能替那 175 条换行，其余要么改了会改值、要么已在 `5ebbc839f` 手写过。
- **mypy 65 errors / 22 文件**：从刀 105 到今天没有进过任何一刀的射程，待裁。
- 根目录散落物仍**登记未动**（`UPSTREAM_V2_MIGRATION_PLAN.md:92/562` 列的那批）。

**本刀的三笔提交**：`11f81a434`（测试侧两枚 inert 缺陷：`unused-import` 1 + `unreachable` 1）·
`c558ad278`（生产侧六枚在册文件 + 影子表/把手两处配套测试 + 重立的 `scripts/p1_baseline.json`）·
`80f9ad8e8`（本节）。三枝 `sync/upstream-20261009`、`main`、`wp/integration` 已同点快进并推送。

---

### 8.43 刀 115（2026-10-12）：裁决 ③ 落了 —— 上游拥有的路由跑上游实现，代价是 −1 行 P1，顺带捞出一条被裸 `except` 吞掉的缺陷

**一句话结论**：用户裁"应用上游版本的 `SkillPoolService`"。**3 枚文件 / 4 处编辑**：在册 pylint 真缺陷
**1 → 0**（也就是 §8.41 那 44 条到此全清）、flake8 **562 → 561**（`F811` 1 → 0）、整树 pylint
**1,314 → 1,313**、P1 账 `behavior_added 10,937 → 10,936`（−1，就是删掉的那行 fork 导入）、
`behavior_removed 486` 与冲突面文件数 **117** 都不动。
换实现之所以只要 −1 行，是因为 fork 那行本来就只是**影子**：上游的绑定早在第 58 行就写好了，
fork 的第 86 行盖在它后面，删掉盖人的那行即可。
**全套验证读数**：两枚先红用例取红 → GREEN 7 passed；全量 unit **17,836 passed**（比 §8.42 的
17,834 只多本刀新写的那两枚）、L1 + 宿主目录 **8,217 passed**，两处都只剩那对已归因的 acp
工作区耦合红 ⇒ 零新增红；flake8 561、整树 pylint 1,313、
在册真缺陷 **1 → 0**、五道离线门禁 rc=0、formatter 脏改前改后等量。

**顺着裁决查出来一条真缺陷，不是 lint 账**：`agents.py:78` 那行 `from ...agents.skills_manager import
SkillConflictError` 导入的是 fork 的 `skills_manager.py:1007 SkillConflictError(RuntimeError)`；
而第 4527 行 `except SkillConflictError` 要接的那条抛出，来自 `agents/skill_system/hub.py`
（该文件与上游**字节相同**），它抛的是 `qwenpaw.exceptions.SkillConflictError(SkillsError)`。
两者只是同名，`issubclass(上游那枚, fork 那枚)` 为 `False` ⇒ 名字冲突从来落不进这个 `except`，
一路掉进旁边那句 `except Exception`，API 把 `str(exc)` 记成 `'Skill conflict'`，
把 `exc.detail` 里那枚撞名 skill 的名字丢了。改法是把第 78 行重指到 `...agents.skill_system`
—— 该行是 fork 自有的行（上游没写过它），所以**零额外账本成本**：一行换目标，`added` 计数不变。

**为什么换实现是安全的**（改前先量的三条，逐条现读）：

| 对拍项 | fork `skills_manager.py:2907` | 上游 `skill_system/pool_service.py:134` |
| --- | --- | --- |
| 方法面 | 15 枚 | **19 枚**（严格超集；差异只在 `create_skill` 多一个可选参 `installed_from`） |
| 该路由唯一调用点 | `download_to_workspace` | 同名同返回合同（`success` / `reason`，含 `builtin_upgrade`、`conflict`） |
| 构造 | `__init__(self)` | `__init__(self)`（`SkillPoolService()` 那处调用不带参） |

调用点本身在 `_install_initial_skills` 的宽 `except Exception` 里，所以即便实现有行为差，也不会把
那条路径变成崩；`agents.py:1955` 是唯一使用点。

**逐文件的账**（`--target-ref working` 现算）：

| 文件 | 归属 | 编辑 | `behavior_added` | pylint / flake8 结清 |
| --- | --- | --- | --- | --- |
| `src/qwenpaw/app/routers/agents.py` | 在册 | 2 处：删第 86 行 fork 的 `SkillPoolService` 导入；第 78 行 `SkillConflictError` 改指 `...agents.skill_system` | 3768 → 3767（−1） | `reimported` 1 → 0；flake8 `F811` 1 → 0 |
| `tests/unit/test_module_import_bindings.py` | fork-created | 影子表清空（表里两枚名字至此都已被裁决退场）+ 新增一枚**单向**守卫 `RULED_IMPORT_BINDINGS` | — | — |
| `tests/unit/app/routers/test_agents_import_bundle_skills.py` | fork-created | 新增一枚用例：hub 的名字冲突必须把 `detail` 传到调用方 | — | — |

守卫换轴这件事值得单记：旧表 `KNOWN_SHADOWED_IMPORTS` 的语义是"这里有两枚绑定，没裁"，
它对"两枚并存"是双向锁（判据 111 那套）；裁决之后只剩一枚绑定，要防的是**下一次自动合并把输的那行
再塞回来**，而那件事在 Python 里不报错 —— 模块级绑定顺序悄悄决定实现。所以新守卫读的是
运行期身份：`importlib.import_module(...)` 取模块属性，再断 `cls.__module__` 等于裁决指定的来源模块。
表清空与生产去重仍必须同一笔提交，否则双向锁的另一半会红（与 §8.42 同）。

**验证读数（本刀的九项，全部为该树现读）**

- **本刀两枚先红用例**（GREEN 前）：`2 failed` ——
  `AssertionError: assert 'skill-alpha' in 'Skill conflict'`（detail 被丢）与
  `qwenpaw.app.routers.agents.SkillPoolService is bound from qwenpaw.agents.skills_manager`（绑定不对）；
  GREEN 后同两条命令 **7 passed**，另加 `tests/unit/agents/skill_system` 整目录 **778 passed**。
- **flake8**（`pre-commit run flake8 --all-files`，权威口径）：**562 → 561**，残余全是 `E501`；
  `F811` 归零。中途我自己新写的一行 docstring 超 79 字符，量出来后当场折行复测（所以两次读数分别
  是 562 与 561，不是 563 → 561）。
- **pylint 整树**：**1,314 → 1,313**。`reimported` `unused-import` `unreachable` 三族同树读数为 **0**，
  即 §8.41 定义的"真缺陷"族在**全树**清零，不再只是 fork-created 侧。
  `redefined-outer-name` 263（−0）、`wrong-import-order` 12、`ungrouped-imports` 2 未动。
- **在册真缺陷**：**1 → 0**。刀 114 之后这一格是 lint 账里唯一需要产品裁决的项，裁完即闭合。
- **P1 册**：**117 文件 / +10,972 −522**；`P1-行为 116 文件 / +10,936 / −486`；`naming 1 纯 / 8 涉 / 36 行`；
  `mechanical 1`。基线**已从工作树重立**（判据 205），提交后 `--check` 以该树为准复测。
- **L1 + 宿主目录**（`tests/unit/security`、`tests/contract/security`、`tests/unit/agents`、
  `tests/unit/app` 一次跑）：**2 failed / 8,217 passed / 5 skipped / 4 xfailed**。
- **全量 unit 套件**（`pytest tests/unit -q -p no:cacheprovider`，判据 207 要求动导入块就跑它）：
  **2 failed / 17,836 passed / 24 skipped / 4 xfailed in 1175.00s (19:35)**。两枚红逐枚对名字 =
  `tests/unit/agents/test_acp_available_commands.py::{test_new_session_advertises_commands,
  test_load_session_advertises_commands}` —— 与 §8.42 记的那对逐字相同（acp 工作区耦合，未裁），
  **本刀零新增红**。pass 数 17,834 → **17,836**：多的正是本刀新写的那两枚用例 —— 同一选择集、
  同一红集、只多两枚绿，这本身就是一次免费的 A/B。
  （过程账：中途临时文件里还出现过另一份汇总 `12,631 passed / 15 skipped / 8 xfailed in 2093.99s`，
  它的选择集与红名都和本次对不上（它报的那两枚在本次运行里是绿的），**未采信**，出处也没能复认。
  可迁移的动作：一份日志被多次复用写入时，落笔前先确认汇总行属于哪一次命令，别按文件名认亲。）
- **五道离线门禁同树 rc=0**：namespace boundaries `PASSED` · ci-command-targets **19 命令 / 4 包目录** ·
  locale split `4,658 + 59 + 7 + 1,459 + 23` · brand `7 文件 / 35 行` · release-channel R1–R6
  `6 文件 / 10 模板 / 11 读点 / 5 宿主`。
- **formatter 脏零新增**：钩子版 black（`--line-length=79`）对 `agents.py` 改前改后同侧对拍
  **123 / 123**，ATC **19 / 19**。顺带更正 §8.42 那句"前后 117 / 19"：ATC 那半今天逐字复现（19），
  black 那半同一条命令今天读 123，不是 117（判据 210）。

**判据 208（裁决过的实现分歧，守卫要从"并存"换成"指定来源"的单向锁）**：影子表能证明"两枚绑定都在、
尚未裁决"，裁决后它两边都不红 —— 表退场是测试侧的账，而真正会复发的是下一次自动合并把输的那行导入
重新写回，模块级绑定顺序会悄悄把实现换回去且不报错。可迁移的动作：凡由产品裁过"用哪一侧实现"的名字，
留一张 `名字 → 必须来自的模块` 的表，断言运行期 `cls.__module__`（判据 202 的身份对拍因此从"改前改后
各做一次"升级成了常驻用例）。

**判据 209（改导入行时，同名异常类要一起查身份）**：`except SomeError` 家族不是 lint 账，pylint 只会
说它 `reimported` 或什么都不说；但"导入的是哪一家的同名类"决定了这条 `except` 到底接不接得到。
本刀的 `SkillConflictError` 就是这一类：两个同名类、无继承关系、抛出方来自与上游字节相同的那本，
于是 detail 静默丢失、被裸 `except Exception` 吞成一句通用文案。可迁移的动作：动某枚名字的导入行时，
把该名字在本文件里的**每个使用点**（尤其 `except`）与抛出方的类身份对拍一次，别只看导入块本身。

**判据 210（旧账里的数字若不可复现，就地标出而不是静默替换）**：formatter 脏的对拍只在"同一条命令、
改前改后两侧各读一次"时才有意义；§8.42 记的 `117 / 19` 里 black 那半用今天的同命令读是 `123`，
而本刀真正需要证明的是两侧相等。可迁移的动作：记录这类数字时把计数口径一起写下来（数 `+` 行还是数
`+`/`-` 全部内容行），否则下一刀只能重新猜。

**判据 211（一份临时日志被多次写入时，汇总行要认命令不认文件名）**：本刀把两份不同选择的 `pytest`
汇总落到了同一枚临时文件的读写链里，于是差点把 `12,631 passed` 那一份当作 `tests/unit` 的全量读数写进
本节 —— 差额 5,205 枚，而红名也对不上（它报的两枚在本次运行里是绿的）。可迁移的动作：写下一条测试
汇总前先比对**该次运行的命令与选择集**（以及 skip/xfail 的形状，它对选择集很敏感），单靠"pass 数变少"
就能识别串台；识别出来就当众记一笔"未采信 + 出处未能复认"，而不是静默挑一个数。

**待裁清单（刀 115 之后重列；③ 已闭合，新增一项删面）**

- **新增（本刀造出的死码）**：fork 的 `skills_manager.py:2907-3695` 那 789 行 `SkillPoolService`
  现在**全仓零引用**（唯一入口是本刀删掉的那行；`src/copaw/agents/skills_manager.py` 那句
  `import *` 是通配再导出，不构成引用）。删它落在 fork-created 文件上 = 零账本成本，但 §8.42 那条
  "`import *` 让每个公开名都是外部可达的公共面"的论证在这里同样成立（`skills_manager.py` 也没有
  `__all__`），所以要先清那枚星号面有多少外部消费者，再确认 `_staged_skill_dir` 等共享把手不被误删。
- ① **pylint 风格意见 1,286**（1,313 − 27 环境假阳性 − 0 真缺陷）：三条路不变（改配置 = 新开一枚
  上游同的宿主 / 逐族留账 / 只在 fork-created 加行级 pragma）。
- ② **环境假阳性 27**（`no-name-in-module` 23 + `E1120` 2 + `E1136` 2）：是否为 pylint 钩子补
  `additional_dependencies`（`mcp`）。同样是动上游同的配置。
- ③-补 **在册 `redefined-outer-name` 还剩 7 条**、`agents.py:4504` 那条 `overwrite` 未用参数：
  本刀未动，性质仍是风格意见。
- ④ **在册 formatter 脏**：prettier 10 枚（+316/−207）+ black/ATC 15 枚（付它是 +172 行 P1，判据 184
  已裁"先不付"）。本刀没让它变多。
- **E501 561**：分层见 §8.41；`agents.py` 独占 129 条，改前改后同数。
- **mypy 65 errors / 22 文件**、3 枚 contract/integrated CI 红、2 枚 acp 工作区耦合的 unit 红
  （本刀那 8,217 读数里那 2 枚仍是它俩）、`secret_store` 2×timeout 聚合、22.50 秒 `copaw update`、
  overlay→真渲染接替、欠一次真浏览器 `copaw app` 复看、6 枚前端测试回买（+31）、发布渠道阶段 2 的
  发包那一半、根目录散落物登记 —— 全部不变。

**本刀的两笔提交**：`df326609b`（`fix(lint)`：`agents.py` 两处 + 影子表清空与单向守卫 + 那枚 detail 用例
+ 重立的 P1 基线）与 `325510079`（本节）。表清空与生产去重必须同笔（判据 111 的双向锁）。

### 8.44 刀 116（2026-10-12）：把刀 115 裁剩的 827 行删掉 —— 死活要用两把尺各量一次，名字搜索本身不算证据

**一句话结论**：§8.43 待裁第一项落刀，**2 枚文件 / 3 处删除 + 1 处新增守卫**，全在 fork-created 上 ⇒
P1 册**总数一格不动**（117 文件 / +10,972 −522）、flake8 **561 不变**、整树 pylint **1,313 不变**、
真缺陷仍 0；全量 unit **17,837 passed**（只多本刀那枚新守卫）、红集逐字不变 ⇒ 零新增红。
新增判据 212–214，**已闭环计数推到 116**。

§8.43 待裁清单的第一项（"新增（本刀造出的死码）"）落刀。唯一的落点是 fork-created 的
`src/qwenpaw/agents/skills_manager.py`：三处删除、827 行，文件 3,695 → 2,868 行，模块级定义 91 → 88 枚。

- `class SkillPoolService`（原 `2907-3695`，该文件最后一枚类，一直写到 EOF）
- `get_workspace_identity`（原 `388-401`）
- `ensure_skill_pool_initialized`（原 `1471-1488`）

后两枚只被那枚类调用 ⇒ 与类同笔走。这半边就是刀 115 那句"输的那侧现在是死码"的全部内容。

**删前的闭包（判据 213：两把尺各量一次，缺一把就会删掉活码）**

- 尺一 · 跨文件：`grep -rnI -w` 覆盖 `src tests scripts`（排 `__pycache__`）后，三枚名字的引用只剩它们
  自己的 def 行。`src/copaw/agents/skills_manager.py:3` 那句 `import *` 是通配再导出、不构成引用；而该桥
  的模块路径 `copaw.agents.skills_manager` 在 `src tests scripts docs` 里**零**消费者（现读 0 条）
  ⇒ §8.43 要的"先清那枚星号面有多少外部消费者"，本仓侧是空的。诚实边界：仓库是公开的，仓外的第三方
  导入量不到 —— 这与每一次 fork-created 删除承担的是同一类风险，本裁决接受它。
- 尺二 · 模块内：类用到的把手删后仍有别处在调 —— `_mutate_json` 14 处、`_copy_skill_dir` 9 处、
  `_normalize_skill_dir_name` 5 处、`_staged_skill_dir` 4 处、`_read_frontmatter_safe_from_path` 2 处
  ⇒ 跟着类一起删会删掉活码，全部留下。
- 两把尺同时为真（模块内只出现在自己的 def 行 **且** 跨文件零引用）才叫死码：删前 0 枚、删后 0 枚
  ⇒ **本刀没造出新孤儿**。
- 该文件也**不是**整枚孤儿：`reconcile_workspace_manifest` 仍有两枚生产导入
  （`app/routers/agents.py:3615`、`agents/tools/skill_market_install.py:13`）。
- 剩下同型局面（新登记，见待裁）：14 枚定义在模块内零自调用，但每一枚在 `agents/skill_system/` 都有一枚
  同名活实现（`registry.py` / `pool_service.py` / `hub.py`），而生产侧全部绑自后者 —— 引其中两枚就是
  `app/routers/skills.py:44-51`（`import_builtin_skills`、`update_single_builtin`）⇒ 那是"两套同名实现
  并存"，删它要先裁哪套是正典，与刀 115 同题，不在本刀射程。

**守卫成对（判据 212：单向锁只防一半）**：`RULED_IMPORT_BINDINGS`（刀 115）钉的是"活的那束仍来自上游"，
它**不会**因为输的那侧重新出现而开红 —— 一次自动合并把 `class SkillPoolService` 按"双方都加了代码"留下时，
模块级绑定顺序仍让上游那枚赢：裁决绿，死码活。故新表 `RETIRED_FORK_DEFINITIONS` + 用例
`test_retired_fork_definitions_stay_retired`（`tests/unit/test_module_import_bindings.py`，fork-created，
+27 行）断言那三枚名字在该模块上 `not hasattr`。先红实测：删除**前**跑该用例，红信点名三枚幸存者。

**判据 212（裁掉一套同名实现之后，守卫要成对）**：`名字 → 必须来自的模块` 只钉住胜者，钉不住败者的
**定义**复活；而"双方都加了代码"正是自动合并最常见的解法。可迁移的动作：凡由产品裁过"两套同名实现取
哪一套"的地方，除 `__module__` 对拍外，再对被裁那一侧开一枚 `not hasattr` 断言，并把"这枚定义属于哪本书"
写进表注释 —— 否则下一刀只能靠读实现猜。

**判据 213（"全仓零引用"要用两把尺各量一次）**：单看名字搜索会把"只被本模块内部使用的私有把手"读成死码
（`_staged_skill_dir` 跨文件 0 引用、模块内 4 处调用），也会把"只被测试引用"的读成活的。可迁移的动作：
删码前分别量 ①模块内出现次数（≤1 即只有 def 行）与 ②跨文件引用（通配 `import *` 再导出不算引用），
两条同时成立才进删除清单；删后再量一次同一条判据，**新增孤儿数应为 0**，非 0 就说明这刀把活码删了。

**判据 214（选择集里冒出的单枚红，先空闲复跑再归因，别急着加 skip）**：本刀一趟并发运行里
`tests/unit/app/routers/test_knowledge.py::test_run_quality_loop_offloads_run_to_thread` 报
`AgentConfigConflictError: Agent 'default' changed on disk; reload it and retry`
（抛自 `src/qwenpaw/config/config.py:208`），而本刀没动 `config.py`。机器空闲复跑同一命令 ⇒ 0 红，该文件
单独跑亦 81 passed ⇒ 归因是两个 pytest 进程共用本机 on-disk `agent.json`。可迁移的动作：这类"单枚、
与改动无交集、报错形状是磁盘状态冲突"的红，先用同命令复跑 + 把选择集拆到单文件各读一次，再决定是否记账；
给它加 skip 会把并发污染固化成永久豁免。

**全套验证读数（改前改后同命令）**

- 全量 `tests/unit`：**2 failed / 17,837 passed / 24 skipped / 4 xfailed in 1231.82s** —— 刀 115 的
  17,836 只多本刀新写的那一枚守卫，红集逐字不变（仍是那对 acp 工作区耦合的）⇒ **零新增红**。
- L1 必过五目录：**1,339 passed / 1 skipped / 0 failed in 8.67s**（与刀 115 逐字同数）；
  五目录 + `tests/unit/app/routers`：**2,722 passed / 1 skipped / 0 failed in 76.28s**。
- flake8 整树 **561**（全 `E501`，与刀 115 同数）。落点文件自身：`skills_manager.py` 改前改后都只 1 枚
  （`:342`，同一条），守卫文件 0 枚 —— 新写的注释首稿有两条 80/81 列，重排到 79 列内才保持同数。
- 整树 pylint **1,313** 逐字不变 = 风格 1,286 + 环境假阳性 27 + 真缺陷 0；`W0611` / `W0612` 均 0
  （那 789 行的类删掉后没让任何导入变成未用，因为它唯一的入口就是刀 115 删的那行）。
- 五道离线门禁 rc=0；`check_p1_invariants.py --check` rc=0 且**总数不动**（117 文件 / +10,972 −522 /
  `P1-行为 +10,936 −486`），因为两枚改动文件都是 fork-created ⇒ 本来就在册外。这印证 §8.43 那句
  "零账本成本"：册只记上游拥有的文件。
- formatter 脏改前改后等量（`black --line-length=79` `123 / 123`、add-trailing-comma `19 / 19`）。
- 8 枚相关模块的导入冒烟 + 那 6 枚守卫用例（`test_module_import_bindings.py`）全绿。

**待裁清单（刀 116 之后重列；§8.43 第一项闭合，新增一项同型候选）**

- **新增（同型候选，规模小得多）**：`skills_manager.py` 剩 14 枚"模块内零自调用、生产侧改绑
  `agents/skill_system/`"的名字 —— 删它同样要先裁哪套实现是正典，性质与刚闭的那项相同。
- ① **pylint 风格意见 1,286**（1,313 − 27 环境假阳性 − 0 真缺陷）：三条路不变（改配置 = 新开一枚
  上游同的宿主 / 逐族留账 / 只在 fork-created 加行级 pragma）。
- ② **环境假阳性 27**（`no-name-in-module` 23 + `E1120` 2 + `E1136` 2）：是否为 pylint 钩子补
  `additional_dependencies`（`mcp`）。同样是动上游同的配置。
- ③-补 **在册 `redefined-outer-name` 还剩 7 条**、`agents.py:4504` 那条 `overwrite` 未用参数：
  本刀未动，性质仍是风格意见。
- ④ **在册 formatter 脏**：prettier 10 枚（+316/−207）+ black/ATC 15 枚（付它是 +172 行 P1，判据 184
  已裁"先不付"）。本刀没让它变多。
- **E501 561**：分层见 §8.41；`agents.py` 独占 129 条，改前改后同数。
- **mypy 65 errors / 22 文件**、3 枚 contract/integrated CI 红、2 枚 acp 工作区耦合的 unit 红
  （本刀那 17,837 读数里那 2 枚仍是它俩）、`secret_store` 2×timeout 聚合、22.50 秒 `copaw update`、
  overlay→真渲染接替、欠一次真浏览器 `copaw app` 复看、6 枚前端测试回买（+31）、发布渠道阶段 2 的
  发包那一半、根目录散落物登记 —— 全部不变。
- **新增（测试侧，非本刀造，已量到根因）**：`tests/unit/conftest.py` 的 autouse `isolated_config_file`
  只 patch 了 `config.utils` 那一枚 `WORKING_DIR` 绑定（连同两枚 mtime 缓存），而 `config.py:57` 另从
  `..constant` 绑了一枚同名的，`config.py:2504` 与 `:3985` 用它拼 default agent 的
  `workspace/agent.json` ⇒ 这段选择集仍写本机共享文件（判据 214 那枚红的出处）。候选落点是在同一枚
  fixture 里把 `qwenpaw.config.config.WORKING_DIR` 一起改指，动的是 fork-created 的 conftest。本刀只是
  复跑证掉了它，没修。要不要修，待裁。

**本刀的两笔提交**：`10390761b`（`chore(skills)`：827 行删除 + `RETIRED_FORK_DEFINITIONS` 退休守卫）
与 `47fcb02d4`（本节）。守卫与删除必须同笔 —— 先删后立守卫会留一个"死码可复现"的窗口，先立守卫不删则当场红。

### 8.45 刀 117（2026-10-12）：隔离缺口的真实面是 43 枚模块级绑定而不是 1 枚 —— monkeypatch 追不上已在导入那一刻绑死的名字

**一句话结论**：§8.44 待裁的最后一项（测试侧 `conftest`）落刀。**1 枚新增 fork-created 根 `conftest.py`
+ `tests/unit/conftest.py` +8 行 + 1 枚新守卫文件**，三处全在 fork-created 上 ⇒ P1 册**总数一格不动**
（117 文件 / +10,972 −522）、flake8 **561 不变**、整树 pylint **1,313 不变**（风格 1,286 + 环境 27 +
真缺陷 0）；全量 unit 从"2 failed / 17,837 passed"换成 **0 failed / 17,841 passed** —— 在册多刀的那对
acp 工作区耦合红**被本刀一并关掉**（A/B 实测见下）。新增判据 215–218，**已闭环计数推到 117**，
**unit 基线换为 17,841 / 0 红**。

**根因比 §8.44 记的更宽（这一段是对那条记录的更正）**：§8.44 写的候选落点"在同一枚 fixture 里把
`qwenpaw.config.config.WORKING_DIR` 一起改指"只覆盖 1 枚模块。开刀前量了真实面：`constant.py:86-94` 在
**导入那一刻**把 `WORKING_DIR` 解析成三档（`QWENPAW_WORKING_DIR` → 已存在的 `~/.copaw` → `~/.qwenpaw`），
之后每一枚 `from ..constant import WORKING_DIR` 都绑死在那一刻的值 —— 生产侧这种绑定 **85 处**（grep），
`tests/unit/app/routers + tests/unit/config` 这枚选择集真正导入到、且改前仍指本机的 **43 枚**（运行时扫
`sys.modules` 得，判据 216）。逐枚补 43 条 `monkeypatch.setattr` 不叫修，叫把缺口搬进 conftest。

**落点因此分两层，两层都是 fork-created**：

- **新增仓库根 `conftest.py`**（管另外 42 枚）。pytest 先加载 rootdir 的 conftest，再加载
  `tests/conftest.py` —— 而后者 `:21` 就 `from qwenpaw.providers import provider_manager`，即
  `qwenpaw.constant` 在那一刻已经绑完。所以唯一能在绑定发生**之前**说话的位子就是仓库根的 conftest，
  这也是它必须放在根上而不是 `tests/` 里的原因。做的事只有三件：`tempfile.mkdtemp()`、
  `os.environ.setdefault("QWENPAW_WORKING_DIR", …)`、`atexit` 清理。用 `setdefault` 不是保守，是尊重
  显式导出的目录（`tests/integration/browser/conftest.py:19` 那类自己指定的仍然赢）。副带收益：xdist
  下每枚 worker 各自 import 一次 ⇒ 各得一个目录，"两个 pytest 进程共用本机 `agent.json`"这件事
  （判据 214 的出处）结构性消失，不是被豁免。
- **`tests/unit/conftest.py`**（管 `config.py` 那一枚，+8 行）。同一枚 autouse `isolated_config_file`
  里把 `qwenpaw.config.config.WORKING_DIR` 与 `config.utils` 那枚一起改指每用例目录。只补 `utils` 会
  造出更坏的局面：`load_config()` 写 A 处、它返回的 `AgentsConfig` 指 B 处，`config.py:2504` 与 `:3985`
  拼出的 default agent `workspace/agent.json` 仍落在会话级目录里跨用例共享。
- **新守卫 `tests/unit/config/test_unit_suite_working_dir.py`**（2 枚用例）：一枚断言两模块的绑定**相等**，
  一枚断言 `AgentsConfig().profiles["default"].workspace_dir` 落在该目录**内**。先红实测（改前跑）：
  两条都点名 `/Users/futuremeng/.copaw`，第二条报 `default agent workspace
  /Users/futuremeng/.copaw/workspaces/default is not under …`。

**顺带关掉两枚在册红**：`tests/unit/agents/test_acp_available_commands.py::{test_new_session_advertises_commands,
test_load_session_advertises_commands}` 自合并后一直在册，§8.42 与 §8.44 都写"acp 工作区耦合，未裁"。
同一命令两态实测：**留**根 conftest ⇒ 21 passed / **2.52s**；把它 `mv` 到 `/tmp`（不是 `git checkout`）
⇒ 2 failed / 19 passed / **75.97s**。耗时差 30 倍本身就是证据 —— 那两枚在等本机磁盘与钥匙串路径，等完了
再撞上别人的 `agent.json`。⇒ **unit 红集清空**，全量读数 17,841 = 17,837 + 那 2 枚转绿 + 本刀 2 枚新守卫。

**判据 215（模块级 `from x import NAME` 的测试隔离只能在导入顺序的上游做）**：`monkeypatch` 改的是
属性，改不动已经复制出去的绑定；同一枚常量在 N 个模块里就是 N 份拷贝，逐份追永远少一份。可迁移的动作：
凡隔离目标是"某常量在导入时被解析成的那个值"，落点选在**该常量所属包被首次导入之前**能执行的文件
（本仓是仓库根 conftest；`tests/conftest.py:21` 就是那条界线），并把这条界线写进新文件的 docstring，
否则下一刀会试图用 fixture 修它。

**判据 216（量隔离缺口用运行时探针，不用 grep 计数）**：grep 给 85 枚候选，其中 `from ..constant import`
在函数体内的（`runtime/builder.py`、`plugins/loader.py` 等 40 余枚）每次调用现读、本来就没漏；真正漏的是
"模块级绑定 **且** 被这枚选择集导入到"的交集。可迁移的动作：写一枚 pytest 插件在 `sessionfinish` 扫
`sys.modules`、把每枚模块的同名属性与"本机真实值"比，改前改后各跑一次同一命令（本刀 43 → 0）；
grep 只用来列候选，不用来下结论。

**判据 217（长期在册的"环境耦合红"要 A/B 归因，耗时差是免费证据）**：一对红挂了四刀并被记为"未裁"，
实际从来没人把可疑变量单独移开重跑。可迁移的动作：怀疑是环境耦合时，把新增的那一处**移开**（`mv`，
不是 `git checkout`）再跑同一命令取反态，两态之间既比 passed/failed 也比秒数 —— 秒数暴涨通常意味着
代码在等本机资源，而"等"和"撞车"往往是同一枚缺口的两个症状。

**判据 218（fake-HOME 是隔离的判决实验，但它自己会制造红）**：把 `HOME` 指到空目录跑同一选择集，
是检验"套件是否还依赖本机"的最直接办法：本刀读数 **3,098 passed / 1 failed**，而那 1 枚
（`test_b1_normalize_before_home_glob_match`）早在 §8.33 就记过它用 `os.path.expanduser("~")` 取真家、
只在 HOME 形状像家时成立 ⇒ 是**实验的产物**，不是新增回归。但同一实验暴露了一枚真漏：空 HOME 里长出
`.qwenpaw/nm-bridge.json` —— `src/qwenpaw/browser/control_link/chrome/ws_handler.py:26` 的
`DEFAULT_CONFIG_PATH = Path.home() / ".qwenpaw" / "nm-bridge.json"` 根本不走 `WORKING_DIR`。
可迁移的动作：这类实验的红要按"实验造成的 / 实验揭出的"分两类记，后者登记成待裁而不是顺手修。

**全套验证读数（改前改后同命令）**

- 全量 `tests/unit`：**0 failed / 17,841 passed / 24 skipped / 4 xfailed in 1092.96s**（改前
  2 failed / 17,837 passed / 同 skip 同 xfail）。
- L1 必过五目录：**1,339 passed / 1 skipped / 0 failed in 7.58s**（与刀 116 逐字同数）；
  `tests/unit/app/routers`：**1,383 passed**（= 改前"L1 + routers 2,722"减去 L1 的那 1,339，逐字同数）；
  `tests/contract`：**1 failed / 411 passed / 1 skipped**，那 1 枚 = `test_track_isolation.py::
  test_inbound_imports_limited_to_the_fork`（`rpa/runtime.py` 越界导入），**A/B 证与根 conftest 无关**
  —— 移开该文件同样红，属在册那 3 枚 contract/integrated CI 红之一。
- 运行时探针：`constant.WORKING_DIR=/private/var/…/copaw-test-working-…`，仍绑本机的模块 **0 枚**
  （改前同一命令 43 枚）。
- flake8 整树 **561** 逐字不变（全 `E501`）；整树 pylint **1,313** 逐字不变 = 风格 1,286 + 环境假阳性 27
  （`E0611` 23 + `E1120` 2 + `E1136` 2）+ 真缺陷 0。三枚落点文件自身：flake8 0 枚、pylint 钩子 Passed、
  `black --line-length=79 --check` unchanged、add-trailing-comma 无改（对拍在 `/tmp` 副本上做，判据 204）
  ⇒ 整树 formatter 读数不动是因为新增面自身 0 脏。
- 五道离线门禁 rc=0；`check_p1_invariants.py --check` rc=0 且**总数不动** —— 根 `conftest.py` 与那枚新
  测试文件都不在上游分叉点的树里（`git rev-parse -q --verify 2744a976b:…` 为空），`tests/unit/conftest.py`
  本来就在册外。
- 守卫先红 → 改后 2 passed；`HOME` 换空目录的判决实验另读一遍同一选择集（3,098 / 1，见判据 218）。

**待裁清单（刀 117 之后重列；§8.44 最后一项闭合，"2 枚 acp unit 红"这一项从册上消失）**

- **新增（生产侧，上游拥有，1 行）**：`browser/control_link/chrome/ws_handler.py:26` 用 `Path.home()`
  硬编码 `~/.qwenpaw/nm-bridge.json`，**无视 `QWENPAW_WORKING_DIR`** ⇒ 改了工作目录的用户会把 bridge
  配置写到另一个地方，而 `:115` 在读不到该文件时会**当场创建**它。这是上游文件，动它 = 新开一枚冲突宿主
  + 生产行为变化，故不在本刀射程。候选落点：`DEFAULT_CONFIG_PATH` 改由 `WORKING_DIR` 拼。
- ① **pylint 风格意见 1,286**（三条路不变）；② **环境假阳性 27**（是否为 pylint 钩子补
  `additional_dependencies`）；③-补 **在册 `redefined-outer-name` 7 条** + `agents.py:4504` 那枚未用的
  `overwrite`；④ **在册 formatter 脏**（prettier 10 + black/ATC 15，判据 184 已裁"先不付"）——
  四本账全部不变，本刀一格没动。
- **E501 561**：分层见 §8.41；`agents.py` 独占 129 条，改前改后同数。
- **mypy 65 errors / 22 文件**、3 枚 contract/integrated CI 红（本刀的 `tests/contract` 读数里那 1 枚
  就是它的本机可见部分）、`secret_store` 2×timeout 聚合、22.50 秒 `copaw update`、overlay→真渲染接替、
  欠一次真浏览器 `copaw app` 复看、6 枚前端测试回买（+31）、发布渠道阶段 2 的发包那一半、根目录散落物
  登记 —— 全部不变。**注意：根目录新增了一枚有正当理由的 `conftest.py`，散落物登记那一项要把它算作
  在册文件而不是散落物（它是 pytest 的 rootdir conftest，作用写在文件 docstring 里）。**
- ~~2 枚 acp 工作区耦合的 unit 红~~ —— 本刀关掉，反态实测见"顺带关掉两枚在册红"。

**本刀的两笔提交**：`01d1b89d9`（`fix(tests)`：根 conftest + `config.WORKING_DIR` 同指 + 两枚守卫）与
`13c26cb9d`（本节）。守卫与两层落点必须同笔：只放根 conftest 而补不上 `config.py` 那一枚，
`isolated_config_file` 与 `AgentsConfig` 会指向两处；只补 `config.py` 而不在根上设环境变量，
另外 42 枚绑定仍指本机。

### 8.46 刀 118（2026-10-12）：桥接配置的写入路径绕过了整套目录隔离 —— 落点选在测试侧，生产侧那 4 枚文件留给产品裁决

**一句话结论**：§8.45 待裁清单最后一项落刀，但**先更正它的价签**：那里写的"上游文件，动它 = 新开一枚
冲突宿主、候选落点 1 行"不成立 —— 同一个 `Path.home()/".qwenpaw"` 表达式在 **4 枚上游自有文件**里一致地
硬编码（写侧 + 读侧 + 扩展安装链路），只翻 `ws_handler.py` 会把"核心写到的位置"和"扩展被装去读的位置"
分家。⇒ 本刀落 **fork-created 测试层**（`tests/unit/conftest.py` +13 行 + 1 枚新守卫文件 2 枚用例），
P1 册**总数一格不动**、flake8 **561 不变**、整树 pylint **1,313 不变**；生产侧那 4 枚留在待裁
（**同日内已裁并关闭，见本节末"该项已于 2026-10-12 裁决关闭"一段与判据 222、223 —— 那里量出的真实面
是 8 枚上游自有文件，不是 4 枚**）。
新增判据 219–221，**已闭环计数推到 118**。

**为什么全量套件会写开发者本机（取证链，四步都不是推测）**：

1. `src/qwenpaw/browser/control_link/chrome/ws_handler.py:26`
   `DEFAULT_CONFIG_PATH = Path.home() / ".qwenpaw" / "nm-bridge.json"` —— 不经 `WORKING_DIR`，
   也不看 `QWENPAW_WORKING_DIR`（整条 chrome 链路没有任何环境出口，逐枚文件查过）。
2. `:108 _expected_token` 取 `_bridge_state.config_path or DEFAULT_CONFIG_PATH`，读不到文件时 `:115`
   调 `configure_nm_bridge(config_path=…)` ⇒ `:89 config_path.parent.mkdir(parents=True, exist_ok=True)`
   是**写**动作。
3. `app/_app.py:451-456` 在 lifespan 里调 `prime_bridge_token()`，而 `prime_bridge_token` 就是
   `_expected_token()`（`:167-169`）⇒ 任何进入真 lifespan 的用例都走到那一步。
4. 判决实验：`HOME=/tmp/k118probe pytest tests/unit/app/routers/test_copaw_hanlp_tasks_router.py`
   ⇒ **29 passed** 且 `find /tmp/k118probe` 长出 `.qwenpaw/nm-bridge.json`。同一命令在落刀后重跑，
   那枚空 HOME **跑完仍是空的**。

**为什么这件事在刀 117 之前从未露头**：本机 `~/.qwenpaw/nm-bridge.json` 早在 9 月就存在且里面有 token
⇒ `_read_existing_token` 命中、直接返回、不写。只有把 HOME 换成空目录（判据 218 那一次实验）才会走创建
分支。⇒ 这条耦合的表现形式是"偶发多进程争用同一枚 `agent.json` 之外的第二枚本机文件"，而不是"用例变红"。

**生产侧那一刀的代价已量清（本轮不付，留给裁决）**：`git cat-file -e 2744a976b:…` 逐枚验过 4 枚都在上游
分叉点的树里 —— `browser/control_link/chrome/ws_handler.py:26`、
`plugins/bundle/chrome/assets/scripts/nm_host.py:49`、`plugins/bundle/chrome/api/routes.py:36`、
`plugins/bundle/chrome/extension_setup.py:203`（`_qwenpaw_home(home) = home / ".qwenpaw"`，被 `:254` 以
`home or Path.home()` 调用，`:404/:527/:616/:723` 四处拼出同一枚 `nm-bridge.json`）。
动它们 = **+4 枚冲突宿主**，且"改完之后扩展去哪读"是行为变化：现有 `~/.copaw` 老安装会读到另一处。
候选落点仍写在待裁里（把 `DEFAULT_CONFIG_PATH` 改由 `WORKING_DIR` 拼，并同步另外三枚）。

**落点为什么是"两枚绑定一起转"**：`configure_nm_bridge` 的默认参数 `config_path=DEFAULT_CONFIG_PATH`
在 `def` 执行那一刻就绑死了（判据 220）⇒ 只改模块常量对默认值无效；而 `_expected_token` 实际传的是单例
字段 ⇒ 只改单例又留了个"调用方不传参就直接写本机"的口子。两枚一起改指
`working_dir / "nm-bridge.json"`，与刀 117 的 `config` / `config.utils` 同指是同一件事。
取单例走公开入口 `get_nm_bridge_route_state()`，不写 `_bridge_state`（否则 pylint `W0212` 加进整树账）。
把 `ws_handler` 导入 conftest 的代价实测 **0.140 秒 / 每进程一次**（`config.utils` 那枚是 0.272 秒，
同一位置早就在付）。

**守卫 2 枚用例，以及其中一枚的第一版是假绿**：
`tests/unit/browser/control_link/test_nm_bridge_working_dir_isolation.py`。
- 先红实测（落刀前跑）：两条都红，逐条点名 `/Users/futuremeng/.qwenpaw/nm-bridge.json`
  （"outside the per-test directory …/copaw-config0"）。
- 第二条第一版写成 `assert config_path.exists()` ⇒ **通过**，理由是"真 HOME 里那枚文件本来就存在"，
  它测到的是本机状态不是机制（判据 219）。改成断言"解析出来的路径落在隔离目录**内**"才真正钉住写入位置。
- 反态实测（落刀后把三行 `monkeypatch` 注释掉再跑）：**2 failed**；放回：**2 passed**。

**全套验证读数（全部在最后一条编辑之后重取，判据 89）**

- 全量 `tests/unit`：**1 failed / 17,842 passed / 24 skipped / 4 xfailed in 1252.55s**
  （基线 0 failed / 17,841 passed / 同 skip 同 xfail；17,843 = 17,841 + 本刀 2 枚守卫）。
- 那 1 枚红 = `tests/unit/services/test_terminal.py::test_real_pty_cwd_unicode_resize_interrupt_and_cleanup`：
  单文件复跑 **10 passed in 0.90s**，失败栈停在 `await session.output(after)` 等一个 needle ⇒ 负载依赖型，
  与合并账里同一枚用例的旧处置逐字同级，不是本刀造出的回归。
- L1 必过五目录：**1,339 passed / 1 skipped / 0 failed in 7.22s**（与刀 117 逐字同数）。
- fake-HOME 判决实验（改后）：`HOME=/tmp/k118home2 pytest tests/unit/app tests/unit/browser tests/unit/config`
  ⇒ **3,929 passed / 1 skipped / 4 xfailed in 109.10s**，跑完那枚空 HOME 里**没有任何文件**。
- 本机对拍：整轮全量前后 `~/.qwenpaw/nm-bridge.json` 的 mtime 仍是 `Sep 16 19:27`（未被写）。
- 五道离线门禁 rc=0，读数逐字不变：locale split 4,658 / 59 / 7 / 1,459 / 23 · brand 7 文件 / 35 行 ·
  release channel R1–R6（6 文件 / 10 注册模板 / 11 读点 5 文件）· CI command targets 19 命令 / 4 目录 ·
  namespace boundaries。
- `check_p1_invariants.py --check --target-ref working` rc=0 且**总数不动**：
  **117 文件 / +10,972 −522 / 行为 116 文件（invasive +10,936、deleted −486）/ 命名 1·7·8 / mechanical 1**
  ⇒ 冲突面 **+0**（两枚落点都不在上游分叉点的树里）。
- flake8 整树 **561**（全 `E501`）逐字不变；整树 pylint **1,313** 逐字不变，且报告里两枚落点文件 **0 命中**。
  两枚文件自己：`--files` 单跑时先报出 4 条 `E501`（当场收掉，不加进册）与 1 条 `W0212`（改用公开 getter
  消掉，没写行级 pragma）；`black --line-length=79 --check` unchanged、add-trailing-comma 无改。

**判据 219（"文件存在"型断言在有真本机的环境下会假绿，要钉"解析到哪"而不是"有没有"）**：守卫第一版
`assert config_path.exists()` 直接通过，因为开发者家里那枚文件本来就在 —— 它测的是本机状态，不是隔离机制。
可迁移的动作：凡断言落在"某路径上的产物"，改成断言该产物**属于哪个目录**（这里 `is_relative_to` 隔离根），
并跑一次"把夹具移开必须变红"的反态。

**判据 220（默认参数在 `def` 那一刻绑死，改模块常量救不了它）**：`configure_nm_bridge(config_path=
DEFAULT_CONFIG_PATH)` 的默认值与 `ws_handler.DEFAULT_CONFIG_PATH` 此后是两枚独立对象，
`monkeypatch` 只改后者对前者无效。可迁移的动作：隔离这类路径要同时找齐"常量绑定 + 运行时字段 + 默认参数"
三处，缺任一处就还剩一条写本机的路；找不到第三处的办法是读 `def` 那一行的签名，而不是读调用点。

**判据 221（待裁项的价签要在开刀时重量一次，登记时的估计会排错刀序）**：§8.45 把这条记成"1 行 / 1 枚上游
宿主"，实测是 4 枚上游自有文件（写侧 + 读侧 + 扩展安装链路 4 处拼同一文件名）+ 一次"老装法读哪里"的产品
裁决。可迁移的动作：登记"改 X 文件一行"这类候选时，先 `grep` 同一表达式在全仓的出现次数并按归属分类，
把宿主数与"是否行为变化"写进条目；否则下一刀会按 1 枚宿主的预算开工，做到一半发现要裁产品。

**判据 222（共享路径的"写侧 + 读侧"是一个合同，迁移类改动单边落 = 断桥）**：本节原先给的候选落点
"`ws_handler.py:26` 改由 `WORKING_DIR` 拼"如果单独落地，产出的是一个**看起来完全合理、运行起来全废**的
状态 —— 核心把 token 写去 A，Chrome 拉起的 host 仍去 B 读旧 token，而 `:115` 那分支还会当场再造一份新
token，两侧从此永久分家且没有任何一侧报错（host 只会连不上）。可迁移的动作：凡"改某枚路径常量"的候选，
开刀前先找齐它的**跨进程对面**（这里是安装时 `shutil.copy2` 出去的 `nm_host.py`，`load_config` 的默认参数
在 `:218`、`run` 的在 `:418`），把对面一并算进价签；找不到的时候，用"这枚文件是不是被复制出去了"来问，
而不是用"谁 import 了它"。

**判据 223（Chrome 那棵子树里 host 侧没有环境出口，但安装时物化有现成机制）**：`nm_host.py` 全文件只读
`sys.argv`（`--probe` / `--check-runtime`）和自己的常量，bundle 里唯一的 env 出口是
`extension_setup.py:209` 的 `QWENPAW_DESKTOP_PY_RUNTIME`；Chrome 也不会把 shell 环境传给 native host
⇒ "让读侧改成读 `QWENPAW_WORKING_DIR`"这种改法在真机上永远读不到值。可迁移的动作：这类"独立进程要
知道核心解析出来的事实"的需求，落点看安装期而不是运行期 —— `extension_setup.py:553` 已经在
`bin/` 里物化 `build_fingerprint.py`（`"Build fingerprint materialized at installation time."`），
launcher 也已经 `exec "<interpreter>" "<host_impl>" "$@"` 转发参数（`:573`），两条路都现成。

**该项已于 2026-10-12 裁决关闭（本轮不再开刀）**：产品侧确认 `~/.qwenpaw` 作为 Chrome 套件安装根是
**设计选择**（`website/public/docs/chrome.zh.md:112` 与 `chrome.en.md:142` 已把它写进用户文档），
不是缺陷 ⇒ 生产侧一格不动。开刀前把真实面重量了一遍，比本节前面写的"4 枚上游自有文件"更宽：
写手 **2** 枚（`ws_handler.py:26` 与 `plugins/bundle/chrome/api/routes.py:36`，后者是插件启动实际走的那条：
`plugin.py:16` 从 `.api.routes` 导入 `configure_nm_bridge`、`:37` 无参调用）、读手 **2** 枚
（`nm_host.py:49` config、`:53` `logs/nm-host.log`）、安装根 **1 个函数 + 5 个调用点**
（`extension_setup.py:203 _qwenpaw_home()`，`:254/:655/:717/:825` 及 setup 内部）、观测侧 **2** 枚
（`observe.py:31` launcher 路径、`:36` 扩展 manifest 路径）、文档 **2** 枚、集成测试 **3** 枚
（`test_chrome_native_host_install.py:110`、`test_chrome_extension_setup.py:130`、
`test_chrome_nm_host.py:130`）⇒ 真要迁，是 **8 枚上游自有文件 + 2 文档 + 3 测试**，冲突宿主 +8，
且必须写读两侧同笔。**重启条件**（写清楚，避免下一刀又从单边改法开工）：出现"自定义 `WORKING_DIR`
的部署要把 Chrome 接起来"的真实需求时按 A 方案做；`~/.copaw` 老安装的兼容不用再考虑 —— 产品侧确认
**从未有人装过 copaw**，这条从决策里去掉了。

刀 118 那两枚落点的覆盖面也在此说清：测试隔离钉的是 `ws_handler` 那枚写手；`routes.py:36` 那枚不在
夹具里，因为 `tests/unit` 没有任何用例 import `plugins.bundle.chrome`（现 grep 0 命中），只有集成测试
碰它 ⇒ 单元套件不会经由它写本机，本刀的 fake-HOME 实测（3,929 passed、空 HOME 跑完仍为空）覆盖了这个
判断。

**待裁清单（刀 118 之后重列；第一项已裁决关闭，其余全部不变）**

- ~~`nm-bridge.json` 的本机路径（生产侧，待产品裁）~~ —— **已裁：`~/.qwenpaw` 是 Chrome 套件的固定安装根，
  属上游文档化的设计选择，生产侧不动**（判据 222、223；完整面与重启条件见上一段）。
- ① **pylint 风格意见 1,286**；② **环境假阳性 27**；③-补 **在册 `redefined-outer-name` 7 条** +
  `agents.py:4504` 未用的 `overwrite`；④ **在册 formatter 脏**（prettier 10 + black/ATC 15，判据 184
  已裁"先不付"）—— 四本账全部不变。
- **E501 561** 分层不变；**mypy 65 errors / 22 文件**、3 枚 contract/integrated CI 红、
  `secret_store` 2×timeout 聚合、22.50 秒 `copaw update`、overlay→真渲染接替、欠一次真浏览器 `copaw app`
  复看、6 枚前端测试回买（+31）、发布渠道阶段 2 的发包那一半、根目录散落物登记（根 `conftest.py` 算在册）
  —— 全部不变。
- `skills_manager.py` 那 14 枚"模块内零自调用、生产侧已改绑 `agents/skill_system/`"的名字（同型候选）不变。

**本刀的两笔提交**：`a17378b7c`（`test(unit)`：桥接配置随隔离目录同转 + 2 枚守卫）与 `cdab00271`（本节）。
两枚绑定与守卫必须同笔：只转常量而漏单例，`_expected_token` 仍写本机；只转单例而漏常量，任何不传参的
`configure_nm_bridge()` 调用点仍写本机 —— 守卫的第一条正是钉这两枚相等。

### 8.47 刀 119（2026-10-13）：阶段 2 的改名那一半整把落地 —— 1 枚声明 + 11 处读点同笔改指 `copaw-community`，发包那一半仍等授权

**一句话结论**：§8.36 量过的价签（5 枚读点文件里 2 枚逐字等于分叉点 ⇒ **+2 枚冲突宿主**）由产品裁决付掉
（原话"可以，直接做，不过要等版本稳定之后再推到正式发布"），本刀把 `qwenpaw` 这枚**分发名**从树里退休：
`pyproject.toml:2` 的声明与 11 处读点同一笔改指 `copaw-community`，构建产物从 `qwenpaw-*.whl` 变成
`copaw_community-2.2.2b4.post1-py3-none-any.whl`（现读 42,789,197 字节 / 3,766 条目）。
**发布语义一格没动**：`pending` 照旧含 `pypi`，`release_channel.py --check-artifacts dist` 对着真产物仍
**rc=1** 打 `ERROR: the pypi channel is still pending; refusing to publish`，`copaw update` 照旧拒绝。
P1 册 **117 → 119 文件 / +10,986 −534**（+2 宿主逐字命中预判）。新增判据 224–227，**已闭环计数推到 119**。

**这一把为什么必须整把落**（R6 那份合同是 109-1 立的）：登记表与全树重扫要相等，且每条在册读点必须仍含
新名字面量 ⇒ 半把（改声明不改读点，或反之）当场红。改前实测就是那枚红：
`pytest tests/unit/scripts/test_check_release_channel_consistency.py -q` ⇒ **1 failed / 47 passed in 10.67s**，
断言逐字 `AssertionError: assert 'qwenpaw' == 'copaw-community'`；三条改名定向用例先红实测
`-k "normalized_form or ships_under_our_own or stays_pending"` ⇒ **3 failed / 1 passed / 23 deselected in 5.32s**。

**落点（1 枚声明 + 11 处读点 / 5 枚文件，逐枚行数与在册归属）**

| 文件 | 行 | 归属与侵入 |
| --- | --- | --- |
| `pyproject.toml:2` | +1 −1 | 在册；`name` 从 `qwenpaw` 改 `copaw-community` |
| `src/qwenpaw/cli/update_cmd.py:33/:181/:395` | +3 −3 | **本刀起在册**（改前逐字等于分叉点）：PyPI JSON 地址、`metadata.distribution()`、`package_spec` |
| `scripts/pack/build_common.py` | +2 −2 | **本刀起在册**（同上）：wheel glob 换文件名形 |
| `scripts/pack/build_macos.sh` | +3 −3 | 在册：`dist/{wheel}-` + `version('{distribution}')` |
| `scripts/pack/build_win.ps1` | +3 −3 | 在册：wheel glob ×2 + `version('{distribution}')` |
| `scripts/check_release_channel_consistency.py` | +49 −15 | fork 自有：`{wheel_name}` 占位符 + `wheel_name()` + `reader_literal()` + `_tracked_names()` 留退休名 |
| `scripts/release_channel.py` | +6 −3 | fork 自有：`artifact_prefixes()` 的 docstring 改成两形合同 |
| `src/copaw/cli/update_cmd.py` | +12 −9 | fork 自有：拒绝文案不再写死包名，改从事实源读 |

5 枚在册文件的侵入算术与 P1 读数逐格对得上：**+14 invasive / −12 deleted**（1+3+2+3+3+… 按枚 = 14），
`behavior_added 10,936 → 10,950`、`behavior_removed 486 → 498`、`behavior_files 116 → 119`。

**两枚只有改名当天才暴露的合同**：

1. **登记表必须区分"包名形"和"文件名形"**。PEP 427 把 wheel 文件名里的 `[-_.]+` 折成 `_`，
   所以 `copaw-community` 落盘是 `copaw_community-…whl` —— 而 `build_common.py`、`build_macos.sh`、
   `build_win.ps1` 里那 4 条 glob 是**文件名**，短横形字面量永远匹配不上。⇒ 注册表新增
   `WHEEL_NAME_PLACEHOLDER = "{wheel_name}"`，`reader_literal()` 按占位符选形展开（`{distribution}` 原样、
   `{wheel_name}` 过 `re.sub(r"[-_.]+", "_", …)`）。守卫 `test_the_registry_names_a_wheel_file_in_its_normalized_form`
   钉的正是"文件名条目若用短横形，登记即红"。
2. **sdist 两形在真 PyPI 上都存在**，§8.38 那句"PEP 427 归一化形式"只说对一半：现查
   `python-dateutil-2.9.0.post0.tar.gz` 是老短横形、PEP 625 之后的 `jsonschema_specifications-2025.9.1.tar.gz`
   / `zope_interface-8.6.tar.gz` 是归一形、`add_trailing_comma-4.0.0.tar.gz` 又混用 ⇒ `artifact_prefixes()`
   两形都收（否则真发布那天按 sdist 名误拒）。

**改名把 fork 自有那侧的一处陈旧文案翻了出来**：`src/copaw/cli/update_cmd.py` 的拒绝文案原先写死
`pip-install qwenpaw`。本刀让它从事实源取 `pypi_project` ⇒ 文案与真动作同源，下次改名不用再来一遍。
守卫 `test_copaw_refusal_names_the_project_it_would_fetch` 断言两件事：输出含事实源那枚名，且不含
`pip-install qwenpaw`。落点先红实测：改前该文件 **1 failed / 12 passed in 0.75s**，改后 **13 passed in 0.98s**。

**`_tracked_names()` 为什么要留着退休的 `qwenpaw`**：全树重扫的"受盯身份"若只剩新名，将来某次上游合并把
带 `qwenpaw` 的读点复活进来，扫描会把它当**未知身份**放过 ⇒ R6 静默漏扫。现表 = `{新名, 旧名}` ∪ 每个身份的
wheel 形。这条是判据 196（"全扫的名字侧必须锚在受盯身份上"）的反向补集，先红实测
`-k old_distribution` ⇒ **1 failed / 1 passed / 27 deselected in 1.31s**。

**装进 venv 的身份读数（改名生效与品牌未动，两件事分开钉）**
`/tmp/copaw_desktop_v` 装本刀 wheel 后现读：
`importlib.metadata.version('copaw-community')` = **2.2.2b4.post1**；
`version('qwenpaw')` → **PackageNotFoundError: No package metadata was found for qwenpaw**（改名生效的判据）；
`copaw --version` 仍打印 **`QwenPaw, version 2.2.2b4.post1`**（品牌串属品牌册，本刀一格没动，判据 94 那条
"入口可用性要执行装好的脚本"在这里复用）；`copaw update` 仍 **rc=1** 并点名 `copaw-community`。
元数据目录名是 `copaw_community-2.2.2b4.post1.dist-info`（归一形）—— 与分发名不同形，这是判据 224 的实测面。

**全套验证读数（全部在最后一条编辑之后重取，判据 89）**

- 全量 `tests/unit`：**17,850 passed / 24 skipped / 4 xfailed in 1032.05s**（基线 17,843 + 本刀 7 枚守卫：
  `test_check_release_channel_consistency.py` +6、`test_cli_update_overlay.py` +1）；**0 红**。
- L1 必过五目录：**1,339 passed / 1 skipped**，与刀 117、118 逐字同数。
- 五道离线门禁读数照旧，其中 release channel 一行原文：
  `Release channel consistency check passed (R1-R6 over 6 channel files; 10 registered templates, 11 read points swept in 5 files)`
  —— 模板数与读点数在改名前后**同数**（改名只换字面量，不换形状），这正是 R6 想要的性质。
  locale split 4,658 / 59 / 7 / 1,459 / 23 · brand 7 文件 / 35 行 · CI targets 19 命令 / 4 目录 · namespace PASSED。
- flake8 整树 **561**（全 `E501`）不变；整树 pylint **1,313 → 1,316**，+3 由两枚在册测试文件的 per-file
  A/B 直接测得（`test_cli_update_overlay.py` 11→12、`test_check_release_channel_consistency.py` 19→21，
  全部 `W0621 redefined-outer-name` 风格意见，记进待裁 ① 不加真缺陷）。
- `check_p1_invariants.py --check --target-ref working`：**rc=1、9 条 `::error::`**
  （`files grew: 117 -> 119`、`NEW upstream-owned file touched: scripts/pack/build_common.py`、
  `… src/qwenpaw/cli/update_cmd.py` 等）⇒ 基线重记成独立一笔提交，处置同 §8.20。
- 中途合并跑（改名进行到一半）：**6 failed / 1,314 passed / 2 skipped** —— 6 枚全在 R6/fixture 侧，
  逐枚随落点清；改名后那枚 fixture 第一版 **5 failed / 22 passed in 3.02s**（它自己在拼旧字面量），
  重写 `_rename_declaration`（`re.subn` 带 `count=1` 断言）与 `_rename_every_reader`（改用
  `mod.reader_literal`）后 **40 passed in 3.63s**。
- `tests/unit/scripts` + `tests/unit/cli` 合并：**1,447 passed / 2 skipped in 56.47s**。

**判据 224（按产物文件名匹配的代码，要同时接住包名形与 PEP 427 归一形）**：`copaw-community` 在 wheel 与
`.dist-info` 里必然是 `copaw_community`（PEP 427 折 `[-_.]+`→`_`），但 **sdist 两形在真 PyPI 上并存**
（`python-dateutil-2.9.0.post0.tar.gz` 老形 / PEP 625 的 `jsonschema_specifications-2025.9.1.tar.gz` 新形 /
`add_trailing_comma-4.0.0.tar.gz` 混用）。可迁移的动作：凡"用声明名去拼产物文件名"的地方，先问这行拼的是
**分发名**还是**文件名**，把形状写进登记表（这里落成两枚占位符 `{distribution}` / `{wheel_name}`），
而不是让读代码的人去猜归一化规则；`importlib.metadata` / pip / PEP 503 那一侧对拼写不敏感，别把结论过去。

**判据 225（改名刀要 grep 自己 fork 层的硬编码文案，不能只跟着门禁走）**：R6 的读点表覆盖上游自有文件，
`src/copaw/cli/update_cmd.py` 的拒绝文案是 fork 自己写的、不在表内，改名当天它就变成**说错话的文案**
（"would pip-install qwenpaw"，而真动作已是 `copaw-community==…`）。可迁移的动作：任何改名/换渠道刀，
落刀前对 fork 自有目录同一枚字面量做一次 `grep`，命中的要么进登记表，要么改成从事实源读（本刀取后者，
并加断言"输出含事实源名、且不含旧名"）。

**判据 226（覆盖式扫描的受盯集合要留着退休身份）**：把 `qwenpaw` 从 `_tracked_names()` 里删掉，今天更干净，
但下次合并复活一枚带旧名的上游读点时，全树重扫会把它当未知字符串放过 ⇒ 门禁绿而树里有读点指向已退休的包。
可迁移的动作：改名刀要把旧名**留在扫描集合**（只是不再允许出现在树里），新名进声明集合；两集合不等是设计，
写进注释与用例（`test_the_sweep_still_sees_upstreams_old_distribution_name`）。判据 196 讲的是"锚在受盯身份上
以免被更宽 token 吞掉"，这条讲的是"受盯身份本身要含历史形"。

**判据 227（改名生效与品牌未动是两枚独立断言，元数据目录名不能当改名证据）**：venv 里同时成立的是
`version('qwenpaw')` → `PackageNotFoundError`（改名生效）与 `copaw --version` →
`QwenPaw, version 2.2.2b4.post1`（品牌照旧，属品牌册那 7 文件 / 35 行未闭），且 `.dist-info` 目录是归一形
`copaw_community-…`。可迁移的动作：这类"换标识符但不换对外称呼"的刀，验收要**分开钉**元数据可见身份与
用户可见串；只看 `--version` 会把"改名完全没生效"读成"改名生效了"。

**待裁清单（刀 119 之后；除 pylint 那一本账全部不变）**

- ① **pylint 风格意见 1,286 → 1,289**（+3 全为本刀两枚测试文件的 `W0621`）；② 环境假阳性 27；
  ③ 在册真缺陷 **0**；④ 在册 formatter 脏（prettier 10 + black/ATC 15，判据 184 已裁"先不付"）。
- **E501 561** 分层不变；**mypy 65 errors / 22 文件**、3 枚 contract/integrated CI 红、`secret_store`
  2×timeout 聚合、22.50 秒 `copaw update`、overlay→真渲染接替、欠一次真浏览器 `copaw app` 复看、
  根目录散落物登记、`skills_manager.py` 那 14 枚名字 —— 全部不变。
- **阶段 2 剩下的是"发"那一半，仍需单独授权**：`pending` 去掉 `pypi`、真 `copaw update`、创建
  `COPAW_PYPI_API_TOKEN` secret、在 GitHub 设置停用上游那四枚 workflow。本刀**没碰**这四件。
- 109-1 记过的那枚可回购项（把 6 枚 release-channel 前端用例搬进 fork 自有文件 ⇒ 退 `constants.test.ts`
  那 +31 行）不变。

**本刀的提交**：代码与守卫一笔（`feat(release)`：分发名整把改指 `copaw-community` + 形状合同 + 7 枚守卫），
P1 基线重记独立一笔（`scripts/p1_baseline.json`，117→119 文件 / +10,986 −534），本节一笔，
节内自名哈希的补笔一笔。改名与 `{wheel_name}` 那枚形状标注**必须同笔**：只改声明不改 4 条 glob，
门禁当场红；只改 glob 不带形状标注，`reader_literal()` 会用短横形去比对文件名行 —— 那是"绿着的漏扫"，
比红更坏（判据 224、226）。

### 8.48 刀 120（2026-10-13）：第一次把 wheel 装进干净 venv 起桌面，后端在 import 那一步就死了 —— 根因不是改名，是 package-data 从没被任何断言盯过

**一句话结论**：刀 119-5 那次"wheel + sdist，装进干净 venv 起桌面"的验收（裁决原话）当场抓到一枚**在册真缺陷**：
`copaw desktop` 起的后端在**导入期**抛
`RuntimeError: Authoritative pipeline definition not found: …/site-packages/qwenpaw/app/pipelines/builtin-knowledge-processing-v1.json`，
因为 `app/pipelines/*.json` 从没写进 `[tool.setuptools.package-data]`。顺带查出同型第二枚
（`knowledge/skills` 的数据在 **2,022 笔之前**那笔"代码翻了、数据没翻"的 fork 提交后一直不在 wheel 里）
与 12 枚**零读者**的 builtin_agents 残留。落点：package-data **+2 行**、`git mv` **2 枚**、删 **12 枚**、
README 指路 **1 行**、守卫 **+3 枚用例**（新文件 2 + 既有文件 1）；修后 wheel 3,766 条目含全部 4 枚关键数据，
桌面版 **0 Traceback / 0 5xx** 起在 webview 里。P1 册**一格不动**（本刀 5 枚落点全部 fork-created，
逐枚 `git cat-file -e 2744a976b:` 验过）。新增判据 228–235，**已闭环计数推到 120**。

**取证链：为什么这枚红只有 wheel 能暴露**（四步，栈是日志原文）

1. `copaw desktop` → `desktop_cmd.py` 起子进程 `-m qwenpaw app` → `qwenpaw/app/_app.py:59`
   `from .routers import create_agent_scoped_router` → `routers/__init__.py:6` → `routers/agents.py:93`
   `from ..knowledge_workflow_steps import _load_builtin_pipeline_doc`。
2. `knowledge_workflow_steps.py:47` 是**模块级赋值** `KNOWLEDGE_WORKFLOW_STEP_SPECS = _load_builtin_step_specs()`
   ⇒ `:34` → `:23` 的 `raise RuntimeError` 发生在 **import**，不是某个功能被调用时。
   ⇒ 后果不是"知识流程红"，是**整个后端起不来**（`desktop_cmd.py:439 Server did not become ready in time`、
   `:465 Backend already exited with code 1`）。
3. 同一枚 `git ls-files src/qwenpaw/app/pipelines` 在源树里存在、在 wheel 里没有 ⇒ 差的就是声明。
4. 为什么 17,843 条用例一条都不红：套件跑在 **editable 安装**上，数据文件直接从源树读
   （判据 228）。这条盲区不是第一次咬人 —— §8.47 之前那枚"wheel 没带 `app/pipelines` 文档、装完起不来"
   就是它，只是当时没有 wheel 可装。

**守卫先红，以及它自己的第一红是假指控**：`tests/unit/copaw/test_package_data_coverage.py`（2 枚用例）。
- 第一版 `_tracked_data_files()` 用 `path.relative_to("src")` 拼相对路径，而 pyproject 里的 glob 是
  **包相对**（`qwenpaw/**` 之下不含包名）⇒ 首红名单 **441 枚**（423 + 18），里面赫然包括
  `copaw/release_channel.json` 和三枚字体许可证 —— 这三类**早就正确声明过**。
  改成 `relative_to(f"src/{package}")`、并把offender 前缀补回 `src/{package}/` 之后，真名单 **15 枚**（判据 230）。
- 15 枚 = 12 枚 `src/copaw/agents/md_files/builtin_agents/understand-*/en/{PROFILE,SOUL}.md`
  + 2 枚 `src/copaw/knowledge/skills/{INDEX.md,knowledge_search_assistant/SKILL.md}`
  + 1 枚 `src/qwenpaw/app/pipelines/builtin-knowledge-processing-v1.json`。
- 匹配器自己是守卫的一部分，所以自带 7 例自证（`test_the_glob_matcher_keeps_setuptools_meaning`）：
  `**` 跨目录、`*` 不跨 `/`、`console/**` 不匹配 `console2/`（判据 231）。匹配器错一次的代价是"441 枚假指控"
  或"静默放过"，两种都比缺声明更坏。

**15 枚的逐枚处置**（不是"补齐声明"一句话）

| 组 | 枚数 | 处置 | 依据 |
| --- | --- | --- | --- |
| `qwenpaw/app/pipelines/*.json` | 1 | 补 `"app/pipelines/*.json",` | 导入期硬读（上面那条栈），必须随 wheel |
| `copaw/knowledge/skills/**` | 2 | `git mv` 进 `src/qwenpaw/knowledge/skills/` + 补 `"knowledge/skills/**",` | 读它的代码在 qwenpaw 那侧（下面单独取证） |
| `copaw/agents/md_files/builtin_agents/understand-*/en/*` | 12 | `git rm -r` 删掉 | **零读者已证**：`src/qwenpaw/app/builtin_agents.py` 对这六枚给 `template_key=None`，而 `setup_utils.py:275` 只按 `agents_root/"md_files"/template_id/<lang>` 拼路径 ⇒ 这六枚的目录名永远不会被任何读法命中 |

**第二枚的根因是一笔 fork 提交，不是上游也不是改名**：`b74542312`（2026-05-07，
`refactor: make qwenpaw knowledge canonical and thin copaw shims`，作者 Future Meng），
`git merge-base --is-ancestor b74542312 2744a976b` ⇒ **rc=1，不是上游祖先**，距 HEAD **2,022 笔**。
那笔把 `src/copaw/knowledge/module_skills.py` 改成 `from qwenpaw.knowledge.module_skills import *`，
而真实现 `src/qwenpaw/knowledge/module_skills.py:9` 是
`KNOWLEDGE_MODULE_SKILLS_DIR = Path(__file__).parent / "skills"` —— 代码翻了，`skills/` 数据留在 `src/copaw` 那侧。
⇒ 这 2,022 笔里该目录**读不到任何东西**（`sync_knowledge_module_skills` 被 `app/routers/agent.py:1088` 与
`app/routers/knowledge.py:1492` 调用）。它长期不红的唯一原因：树里那枚既有用例
`tests/unit/app/test_knowledge_module_skills.py` 把 `KNOWLEDGE_MODULE_SKILLS_DIR` **monkeypatch 到 `tmp_path`**
（判据 232）⇒ 本刀给该文件加 1 枚"真目录里真文件在"的用例。

**gitignore 那 8 枚是守卫看不见的另一半面**：`.gitignore:114 AGENTS.md` 盖掉 7 枚
（6 枚 `…/builtin_agents/*/en/AGENTS.md` + `app/project_templates/project/AGENTS.md`）、
`:69 config.json` 盖掉 `src/copaw/skills_market/config.json`；同型还有 `:41 src/qwenpaw/console/` 与
`:47 src/qwenpaw/docs/`。以 `git ls-files` 为真源的守卫**结构上不可能**报它们（判据 233）。
本刀的处置：这 8 枚按"删残留"裁决**先移不走删**（`/tmp/k120_copaw_untracked/`，可逆），
现查后确认运行时读的那枚市场目录是 `qwenpaw/skills_market/default.json`（`routers/skills.py:513` 的
`parents[2] / "skills_market"`）—— 它在册、已声明、wheel 里有；console 那枚由 pack 脚本构建产物落进 wheel，
修后实测 `STATIC_DIR: …/site-packages/qwenpaw/console`（判据 233 的正面样本）。

**修后运行时读数（同一枚 wheel 重装进 `/tmp/copaw_desktop_v` 现取）**

- wheel：`dist/copaw_community-2.2.2b4.post1-py3-none-any.whl`，**3,766 条目**，逐枚在册
  `qwenpaw/app/pipelines/builtin-knowledge-processing-v1.json`、`qwenpaw/knowledge/skills/INDEX.md`、
  `qwenpaw/knowledge/skills/knowledge_search_assistant/SKILL.md`、`copaw/release_channel.json`；
  sdist 41,303,340 字节同批产出。
- 装好的 venv 里：`import qwenpaw.app._app` ⇒ **app import ok**、`KNOWLEDGE_WORKFLOW_STEP_SPECS` ⇒ **7 条 step spec**、
  `KNOWLEDGE_MODULE_SKILLS_DIR` ⇒ `…/site-packages/qwenpaw/knowledge/skills` **True**、`activated: True`。
- 桌面版（`/tmp/k120_desktop.log`，08:18→08:45）：`Starting QwenPaw app on http://127.0.0.1:57147`、
  `Uvicorn running`、`desktop_cmd.py:415 HTTP ready, creating webview window…`、`:425 Calling webview.start()`；
  `GET / → 200`、`/api/version → 200`、`/api/auth/status`、`/api/config/theme`、`/api/frontend_plugin` 全 200；
  **0 条 Traceback、0 条 5xx**；`pip list` 里是 `copaw-community 2.2.2b4.post1`。

**全套验证读数（全部在最后一条编辑之后重取，判据 89）**

- 全量 `tests/unit`：**0 红**，本刀 +3 枚守卫 ⇒ **17,853 条**（= 刀 119 的 17,850 + 3）。
  这条读数是**两次实跑对拍出来的**，不是一次：
  ① 第一次整套 `pytest tests/unit` = `1 failed / 17,852 passed / 24 skipped / 4 xfailed in 979.85s`，
  唯一那枚红正是 `test_package_data_coverage`，成因见判据 235（背景里的拆提交把 `git reset` 落进了同一时间窗）；
  commit 落定后单跑该文件 `2 passed`。② 之后在同一份已提交状态整轮复跑，命令换成
  `pytest tests/unit tests/contract` ⇒ **1 failed / 18,264 passed / 25 skipped / 4 xfailed in 1072.70s**；
  那 1 枚红是 `tests/contract/browser/test_track_isolation.py::test_inbound_imports_limited_to_the_fork`
  （`src/qwenpaw/rpa/runtime.py` 越界导入），**在册那 3 枚 contract/integrated CI 红之一**（§8.45 记过，
  单文件复跑 `1 failed / 2 passed in 0.43s`，`git log e8d38985e^..d30d06b86 -- 该文件` **0 笔** ⇒ 与本刀无关）。
  两把尺子互证：18,264 − 411（§8.45 那条 contract 的 passed 数）= **17,853**，与 ①+守卫的推导逐字相同；
  skip 24 + 1 = 25、xfail 4 也对齐 ⇒ unit 侧 **0 红**、contract 侧**没有新增红**。
- L1 必过五目录：**1,339 passed / 1 skipped in 16.39s**；rc=0。
- flake8 整树 **561**（全 `E501`）不变；整树 pylint **1,316** 不变，且新守卫文件**在 pylint 的扫内**却
  **0 条命中**（`--files` 单跑先是 `W0611: Unused import pytest`，收掉后 Passed —— 不是"没扫到"）。
- 五道离线门禁 rc=0，读数与 §8.47 逐字相同（release channel 仍是 `10 registered templates, 11 read points
  swept in 5 files`；namespace `non_extension_copaw_only: 0` / `result: PASSED`）。
- `check_p1_invariants.py --check --target-ref working`：**9 条 `::error::`、总数与 §8.47 完全一致**
  （117 → 119 文件 / +10,986 −534 / 命名 0 pure · 8 touched · 36 行 / mechanical 1）
  ⇒ **本刀冲突面 +0**：`src/qwenpaw/agents/skills/README.md`、`src/qwenpaw/knowledge/skills/*`、
  `tests/unit/app/test_knowledge_module_skills.py`、`tests/unit/copaw/test_package_data_coverage.py`
  逐枚 `git cat-file -e 2744a976b:` 全部 **NO**（fork-created）。
- `release_channel.py --check-artifacts dist` 对着这两枚真产物仍 **rc=1**（`pypi` 仍在 `pending`）—— 本刀
  没让任何发布语义前进。

**顺带开出的两枚（已排刀，不记进本刀）**：构建那轮 `npm run build` = `tsc -b && vite build && …`，
`tsc -b` 报 **19 条 `error TS`**（17 条测试替身形状：`AgentSummary` 缺
`is_builtin/builtin_kind/builtin_label/system_protected` + `Mock` 对签名；**2 条生产侧**：
`src/pages/Agent/Knowledge/index.tsx(490,37)` 与 `…/Projects/components/ProjectEditorPanel.tsx(69,39)` 的
TS2345）；因为 `&&` 在 tsc 就断，wheel 里的 console 来自一次显式标注"tsc skipped"的二次构建
（`✓ 20636 modules transformed`、monaco-css OK、precompress 549 assets），其最后一道自检
`Initial bundle: 10.73 MiB raw, 2.77 MiB Brotli across 11 assets.` 之后
`Error: Initial raw bundle exceeds 10.00 MiB.` ⇒ 刀 121（#280，先根因那 2 条生产侧）与
刀 122（#281，归因 0.73 MiB 超预算并把这枚门禁写进文档）。

**判据 228（editable 安装对 package-data 完全失明：全绿套件能构建出启动即死的 wheel）**：
源树直读让"缺声明"在测试里不可见，红只在装好的 venv 里出现，且出现在 import 期。可迁移的动作：
凡新增或改动"按包内路径读数据"的刀，验收要有一次**非 editable** 的实测（`python -m build` + 干净 venv +
真启动那一条命令），只跑 `pytest` 与只跑 `pip install -e` 都不算；更便宜的替代是本刀那枚守卫
（`git ls-files` 的在册数据 ⟺ package-data 声明）。

**判据 229（模块级读盘 = 启动期致命，失败面要按"服务起不来"记）**：`X = _load()` 在 `:47` 这种模块级赋值
把一次配置缺失升格为整包 import 失败；同一枚文件里那三行 `raise RuntimeError` 因此没有"降级"路径。
可迁移的动作：给"读包内数据"的代码分类时，先问读取发生在 **import** 还是**调用**，前者进 P1 级清单。

**判据 230（覆盖式守卫的第一红要先证伪自己：拿已知正确项验红名单）**：441 枚假指控里包含
`copaw/release_channel.json` 这种"上一刀刚验过声明"的条目 —— 那是基准路径错位的信号，不是树里有 441 枚债。
可迁移的动作：新写覆盖式守卫时，先塞 2–3 枚**已知已声明**的样本，看它们是否出现在红名单里；
出现即先修守卫。相对路径的基准必须与声明的基准同源（这里是包相对）。

**判据 231（守卫里的匹配器自己是守卫的一部分，要自证语义）**：setuptools 的 `**` 跨目录、`*` 不跨 `/`，
把 glob 拍平成"整串 fnmatch"会让 `docs/*.md` 匹配到 `docs/nested/README.md` ⇒ 漏报。本刀把那 7 例
按段匹配的自证用例留在同一个文件里（`test_the_glob_matcher_keeps_setuptools_meaning`），
因为"红名单可信"是"缺声明即红"的前提。

**判据 232（"代码翻了、数据留在原地"的提交可以长期绿；monkeypatch 掉路径的用例看不见真路径坏着）**：
`b74542312` 之后 2,022 笔里该功能一直读空，唯一相关用例把 `KNOWLEDGE_MODULE_SKILLS_DIR` 指到 `tmp_path`。
可迁移的动作：凡"路径常量 + 目录内容"的合同，钉两枚 —— 常量解析到哪（已有用例），以及**真目录里真有真文件**
（本刀补的那枚）；只有前者时，搬家类提交（改常量不改数据）永远绿。

**判据 233（`.gitignore` 会让必需数据同时躲开 `git ls-files` 清单与 wheel）**：`AGENTS.md`（`:114`，7 枚命中）
与 `config.json`（`:69`，1 枚）这类"模式级"忽略规则盖在包目录里 ⇒ 以 git 跟踪为真源的守卫结构上看不见，
而构建端静默少文件。可迁移的动作：数据清单不能只以跟踪文件为真源，还要对**运行时实际读的那枚路径**现查
"装好的包里有没有它"（本刀正面样本：`routers/skills.py:513` 读 `qwenpaw/skills_market/default.json`，
在册 + 已声明 + wheel 里有；`STATIC_DIR` 落在 `site-packages/qwenpaw/console`）。

**判据 234（一条 lint 读数必须连着计数表达式一起记：同一棵树能读出 1,309 / 1,313 / 1,316）**：
整树 pylint 历史上被 `[a-zA-Z_/.-]+\.py` 这类字符集"路径里不含数字"的正则扫过，
静默丢掉 3 条（`scripts/check_p1_invariants.py:220 R0912`、
`scripts/verify_project_knowledge_pipeline_e2e.py:131/:166 C0301`）；再退掉连字符又少 4 条
（`packages/qwenpawmail-mcp/**` 的 4 条 `E0611`）。本刀的处置：整树读数的命令与正则写进本节，
+3 的归因不靠总数相减而靠两枚文件的 `--files` A/B（11→12、19→21）。可迁移的动作：报告任何"逐字不变"的
计数时，把 `grep -cE` 的表达式一并留下 —— 只留数字，下一刀无法判断变化是真的还是口径变了。

**判据 235（判据 89 的范围包括索引：读 `git ls-files` 的守卫会跟着 INDEX 红，拆提交那一轮不能同时跑整套）**：
本刀的第一次整套读数是 `1 failed / 17,852 passed / 24 skipped / 4 xfailed in 979.85s`，那枚红正是
`test_package_data_coverage` —— 不是树有缺陷，而是背景里的拆提交把 `git reset` 落进了同一时间窗：
reset 只动索引，把本刀删掉的 12 枚与 `git mv` 的 2 枚**重新登记为在册**而磁盘上没有 ⇒
守卫照 `git ls-files` 的口径报了它们，**这个红在当时的索引状态下是对的**。
commit 落定后同一枚守卫 `2 passed`，整套复跑才是本节记录的那条读数。
可迁移的动作：凡是 shell 出去问 git 的守卫（`ls-files`、`diff`、`cat-file`），它的真源是索引不是工作树，
所以取"改后读数"的那轮必须等**索引不再变动**（拆提交、`git reset`、暂存/取消暂存都算）；
反过来这也说明这类守卫钉的是"下一次提交要发布什么"，正是我们想要的口径。

**待裁清单（刀 120 之后；除两枚新增排刀外全部不变）**

- ① **pylint 风格意见 1,289**（含刀 119 的 +3 枚 `W0621`）；② 环境假阳性 27；③ 在册真缺陷 **0**（本刀那枚
  package-data 缺声明属**真缺陷**，已闭，不进这一栏）；④ 在册 formatter 脏（prettier 10 + black/ATC 15）。
- **E501 561**、**mypy 65 errors / 22 文件**、3 枚 contract/integrated CI 红、`secret_store` 2×timeout 聚合、
  22.50 秒 `copaw update`、overlay→真渲染接替、欠一次真浏览器 `copaw app` 复看（本刀已在 wheel 装好的 venv 里
  起过一次真 webview，但那是构建产物侧的复看，`copaw app` 那条仍未做）、根目录散落物登记、
  `skills_manager.py` 那 14 枚名字 —— 全部不变。
- **新增两枚排刀**：刀 121 = 19 条 `tsc -b`（先根因 2 条生产侧）、刀 122 = initial bundle 10.73 > 10.00 MiB。
- 阶段 2 的"发"那一半（`pending` 去 `pypi`、真 `copaw update`、`COPAW_PYPI_API_TOKEN`、停用上游四枚 workflow）
  **仍需单独授权**，本刀一格没动。
- **新增一项待裁**：wheel 里 `AGENTS.md` / `config.json` 这类被 gitignore 的数据要不要改成
  "要么进册要么明确不需要"（判据 233 的正面处置）。本刀只是把 8 枚移到 `/tmp/k120_copaw_untracked/`
  （可逆）并记下现查结论，**没有**替产品决定它们该不该随包发布。

**本刀的提交**：代码与守卫一笔（package-data 两行 + `git mv` 2 枚 + 删 12 枚 + README 指路 + 3 枚用例），
本节一笔，节内自名哈希的补笔一笔。两行声明与那枚守卫**必须同笔**：先落声明不落守卫，下一个数据文件还会
以同样的方式在 wheel 里消失（判据 228）；先落守卫不落声明，守卫红 15 枚、CI 直接挡下 —— 两种拆开都比同笔贵。
