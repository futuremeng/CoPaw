# 追上游实施跑道（2026-10-08 刷新）

**目的**：把"合并 upstream 最新进展"这条路的最短走法量化到可以直接开工的粒度。
本文全部为 2026-10-08 现算，不是引用 2026-10-07 那张表的读数（对照处会写明旧值）。

**方法（只读）**：`git fetch upstream` → `git merge-tree --write-tree HEAD upstream/main`。
`merge-tree` 只向对象库写一棵树，不碰工作区、不产生提交、不动分支、不推送，因此随时可重算、
重算前不需要清理现场。本次产出树 = `8374294c6`。

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

（口径先说清，这里最容易读错：`totals.behavior_added` 13,705 + `totals.behavior_removed` 2,285
= **15,990** 是**门禁口径**，它把 `MECHANICAL` 集合里的文件整枚剔掉（`scripts/check_p1_invariants.py`
的 `_totals`），本树里被剔掉的正是 `console/package-lock.json` 那一枚 —— `files` 字典 146 键、
`totals.files` 145，差的就是它；而**含 lock 的主机累加是 34,394**。
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
- 上游**不再保留** `runner/` 的 12 枚：`runner.py command_dispatch.py daemon_commands.py mission_dispatch.py task_tracker.py query_error_resilience.py control_commands/*(6)` ⇒ 我们在这些文件里有 fork 行为（含已闭环 56/57 恢复的 runner 能力与 context-overflow 重试），要么把整族留在 fork 侧自有路径，要么逐枚判"上游新架构里谁接替了它"。

**(b) `app/mcp/ → drivers/`（重构，不是改名）**

- 我们侧：`mcp/manager.py`（+194 −13）、`mcp/stateful_client.py`（**+690 −396**）、`mcp/watcher.py`（+26 −8）。
- 上游侧 `app/mcp/` 只剩 `__init__.py config_service.py schemas.py`；`stateful_client` 的新宿主是
  **`src/qwenpaw/drivers/handlers/mcp_stateful_client.py`**（配套 `drivers/adapters/mcp_{binding,card_builder,console,legacy_config}.py`、`drivers/handlers/mcp.py`）。
- ⚠ 这里压着两笔已闭案的修复：**已闭环 40（远程 MCP 的 OAuth Bearer 注入回归）**与**已闭环 46（py3.10 `BaseExceptionGroup` NameError）**。搬到新宿主时必须重验这两笔，不能靠"合并没报红"过关。

**(c) 上游整体删除、我们仍在改的四组前端能力 + 一组后端**

| 路径 | 我们的在册行为行 | 上游替代 |
|---|---|---|
| `console/src/api/modules/plan.ts` + `console/src/components/PlanPanel/index.tsx` + `src/qwenpaw/app/routers/plan.py` | +16 / +13 / +2 | **无**（上游整个删掉 Plan 这套） |
| `console/src/pages/Agent/Workspace/{index.tsx, index.module.less, components/FileListPanel.tsx, components/useAgentsData.ts}` | +12 / +9 / +8 / +58 | **无** |
| `console/src/pages/Chat/components/ChatSessionDrawer/index.tsx` | +5 −5 | **无** |
| `console/src/pages/Settings/Agents/components/AgentTable.tsx` | +98 −60 | **无**（同名文件也被删；`Settings/Backups/restore/RestoreAgentTable.tsx` 不是接替者） |

⇒ 这四组是**产品裁决**，不是解冲突：跟着上游删（放弃功能）或在 fork 侧安家继续维护。

---

## 5. 最快路线

结论：**一次 merge，配一份逐类默认解法，比按上游 release 切片合并快**，理由是
切片会把同一批宿主（尤其上表 3 的 agents/skills 簇）反复打开 N 次，而 4,957 + 556 枚
自动合并的部分一次就能定；且分叉点 `e111ec6fb` 从未变过，切片不会让任何一方变"干净"。

建议的执行形态（成本从低到高）：

1. **准备阶段（可提前做、每做一枚就少一枚冲突）**：把 §2 的 4 枚真断引用先结掉，
   把 §4(c) 四组产品裁决落成 fork 自有路径（这一步之后它们在合并里不再报 modify/delete）。
   这一步就是判据 84/85 的反向使用：**在册但这次干净合并的 42 枚，是过去几十步"退回上游字节"换来的**。
2. **开一个专用 worktree + 分支**（例如 `sync/upstream-20261008`，基点 `wp/integration`），
   在里面 `git merge upstream/main`，工作区一旦进冲突态就留在里面，不碰 `CoPaw-wp14`。
3. **按类批量落默认解**：
   - 锁文件：取上游 ⇒ 之后 `npm install` 让 fork 侧新增依赖（`@testing-library/dom` 等）自己长回来；
   - add/add 10 枚：以**上游为准**，把我们的额外断言并进同一文件（9 枚是双方各自写的测试）；
   - `app/runner/*` → `app/chats/*`：逐枚搬到新路径；上游不再保留的 12 枚先判"留在 fork 路径"还是"接上游新架构"；
   - `app/mcp/*` → `drivers/`：逐 hunk 重放到 `drivers/handlers/mcp_stateful_client.py`，**OAuth 注入与 py3.10 两笔必须有回归用例**；
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
   - 版本线：阶段 1 定的 `1.1.11b1.post1` 要按"跟上游同号 + `.postN`"重新裁定（上游已到 v2.2.x 线）。

---

## 6. 需要用户裁决的 4 项（不开口就没法往下走）

1. **合并形态**：一次 merge 到 `upstream/main` tip（`7147731d5`），还是先追 `v2.2.1` 再补 tip？
   现算 `v2.2.1` tag（`cae577370`）**不是** `main` 的祖先（main 另有 133 枚提交、tag 另有 1 枚），
   追 tag 反而多一步。
2. **§4(c) 四组被上游整体删除的能力**（Plan 前后端整套、`Agent/Workspace` 页、`ChatSessionDrawer`、
   `Settings/Agents/AgentTable`）：跟随上游删除，还是在 fork 侧安家继续维护？
3. **`app/runner/` 里上游不再保留的 12 枚**（含 `runner.py`、`command_dispatch.py`、`control_commands/*`）：
   整族留 fork 自有路径，还是逐枚找上游新架构的接替者？
4. **P1 账本的新基线**：合并落地后 `DEFAULT_BASE_REF` 换成什么（上游合并点 / 新分叉点），
   以及换基线那一步要不要单独成一笔账。

---

## 7. 量到了什么 / 没量什么

量到：冲突分型与逐枚路径、权重排序、静默删除的引用实测、两边改动集规模、tag 拓扑、
`app/runner→app/chats` 与 `app/mcp→drivers` 的宿主映射（按目录清单逐一对照，非推测）。

没量：**没有真跑一次 merge**（`merge-tree` 只产树，不产工作区冲突态，所以"hunk 级实际文本长度"
与"逐枚裁决的真实耗时"仍是估计）；没跑合并后的测试；没读上游 v2.2.1 → tip 这 133 枚提交的内容摘要
（不知道上游自己在这 133 枚里是否已经把我们的某些能力做掉了）；`console/package-lock.json` 取上游后
`npm install` 会产生什么差异没验；§2 的引用实测按"模块名/基名的字面出现"计数，
动态 import 与字符串拼路径不在其中。

相关账目：已闭环 84–86（判据 84/85/86 原文在 `2026-10-07-trial-merge-conflict-table.md`）、
已闭环 40、46、56、57、75、79–81、83–86。
