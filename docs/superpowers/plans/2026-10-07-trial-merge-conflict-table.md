# 试合并冲突表：`wp/integration` × `upstream/main`

**生成时间**：2026-10-07。**数据来源**：全部为当次现算，非引用历史读数。
**方法**：`git fetch upstream` 后用 `git merge-tree --write-tree HEAD upstream/main` 做三向合并。
这条命令只向对象库写一棵树，**不改动工作区、不产生提交、不动任何分支、不推送**；因此这张表可以在
任何时刻重算，重算前不需要清理现场。

**测量前提（先确认，否则整表口径不成立）**

| 项 | 现算值 |
|---|---|
| `upstream/main` 最新提交 | `80e412da9`，2026-09-30，`fix(e2e): stop stalled session cleanup (#8041)` |
| fetch 是否带来新提交 | 否（`git fetch upstream --prune` 之后 `upstream/main` 未移动 ⇒ 本地快照就是服务端现状） |
| 分叉点（`git merge-base HEAD upstream/main`） | `e111ec6fb`，2026-06-03 —— **至今未变，说明这四个月没有发生过一次真正的上游合并** |
| 落后的上游提交数 | **1,180** |
| 我们领先的上游提交数 | 1,079 |
| 上游在分叉点之后改动的文件 | 5,125（+1,246,091 / −95,201 行） |
| 我们改过而上游没碰的文件 | 531 |
| 我们自己新增的文件（在 HEAD、不在分叉点） | 534 |
| 整树规模 | HEAD 2,562 个文件 → `upstream/main` 5,976 个文件 |

---

## 1. 一次合并到底要判多少东西

`git merge-tree` 报出 **112 个冲突文件 / 617 处冲突块 / 标记内 37,532 行**。这个总数会吓人，但它必须由三种
可分离的量拆开，否则会高估工作量：

| 性质 | 文件数 | 冲突块 | 标记内行 | 为什么这样算 |
|---|---|---|---|---|
| 内容冲突（双方都改同一区域） | 86 | 604 | 30,466 | 其中 `console/package-lock.json` 一个文件占 346 块 / 17,161 行 |
| └ 排除生成文件后的真实内容冲突 | **85** | **258** | **13,305** | 锁文件取上游版重新 `npm install` 即可，不需要逐块判 |
| 撞名新建（双方各自创建了同一路径） | 9 | 13 | 7,066 | 整份文件都算冲突，实际只是"二选一或合并断言" |
| 上游删除、我们改过（modify/delete） | 16 | 0 | 0 | 不产生标记；git 保留我们的版本，需要人工找上游替代实现 |
| 位置冲突（file location） | 1 | 0 | 0 | 上游把文件放进了一个已被我们改名的目录，改名即可 |
| 合计 | 112 | 617 | 37,532 | |

**去掉两种"假冲突"之后，真正要逐块判定的工作量 = 85 个文件 / 258 处块 / 13,305 行标记内容。**
再考虑撞名新建的 9 个（每个只需一次裁决）与 modify/delete 的 16 个（每个只需一次归属判定），
**这次合并的决策总数约为 111 次，不是 617 次，更不是 3.7 万行。**

---

## 2. 和现有欠账表对账

欠账表（`scripts/check_p1_invariants.py` 现算，口径 = 分叉点已存在 + 去掉纯改名后仍有改动 + 上游也改过）
现数 **145 个文件**。三方关系：

| 关系 | 文件数 | 说明 |
|---|---|---|
| 既在册又真冲突 | **100** | 表的作用域是对的 |
| 在册但这次干净合并 | **43** | 过去几十步把共享文件退回上游字节的成果，在这里第一次被验证为"确实减少冲突" |
| 在册、看似干净、其实冲突挪了位置 | **2** | `src/qwenpaw/app/runner/__init__.py` → `app/chats/__init__.py`（67%）、`runner/session.py` → `app/chats/session.py`（71%）：上游改名后我们的改动照样撞上 |
| 真冲突但不在册 | **12** | 全是分叉点之后才出现的路径：9 个撞名测试 + 上述 2 个改名后的新路径 + 1 个位置冲突 |

100 + 43 + 2 = 145。⚠ 在册的**头数口径**是 144（本文按 145 枚路径做交叉）：同一次 `--json` 里 `totals.files`
读 **144**、`files` 字典有 **145** 个键，差的那一枚是 `scripts/pack/build_ta.py`（`behavior_added` 与
`behavior_removed` 均为 0）。这是门禁自身的口径差，不是本文新算出来的数。

**方法沉淀（写下来，别只留在对话里）**

- **判据 84：合并代价只能用 `git merge-tree` 现算，不能拿"差异表"当冲突数。** 差异表量的是"两边是否不同"，
  冲突量的是"两边是否改了同一区域"。145 个在册文件里只有 100 个真冲突 ⇒ 用差异表估合并成本会高估 45%，
  而且会漏掉另外 12 个表根本看不见的冲突。
- **判据 85：任何按"分叉点已存在"取数的表，结构上就看不见分叉点之后新增路径的撞名冲突。** 本例 9 个
  Python/前端测试文件是双方各自独立新建的同名文件，它们既不在差异表里也不会被"我们改过哪些上游文件"这类
  提问捕获。合并后新增文件会越来越多的两边并行创建，这类必须单独枚举。
- **判据 86：改名会把冲突从"干净"列搬到"冲突"列。** 判断"某文件能否干净合并"必须带着 `-M` 的重命名映射
  再走一遍，否则上游 `app/runner/ → app/chats/` 这种目录改名会让 43 个"干净"里的 2 个被误判。

---

## 3. 新发现的风险：合并会静默删东西，而且不报冲突

上游删了、我们树里还留着的路径共 **115 个**，按我们是否改过分两类，后果完全不同：

| 类别 | 数量 | 合并后果 |
|---|---|---|
| 我们**没**改过 | **96** | **合并直接删除，一个冲突都不报** —— 这就是静默断裂的来源 |
| 我们改过 | 19 | 其中 **16** 报 modify/delete（见 §1 表），**3** 被上游改名识别（`runner/__init__.py`、`runner/session.py` 的冲突出现在新路径、`runner/query_error_dump.py` 100% 改名后干净） |

现算的"合并后会指向不存在文件"的引用点。方法与范围都写清楚，避免同名假命中：

- **前端**：解析 `console/src` 全部 `.ts/.tsx` 的 import / `import()` / `lazyImportWithRetry` 说明符，
  **按导入文件的目录逐项解析相对路径**（含扩展名与 `/index` 展开），再与 16 个目标比对 —— 不用路径 token
  模糊匹配（第一轮那么量得到过"21 个文件引用 `ChatSessionItem/index.module.less`"这种由同名引起的假命中）。
  下面只计**合并后仍然存活**的引用方（引用方自己也被上游删掉的不算断裂）。
- **Python / 脚本**：`git grep` 点号与路径引用，排除被删文件自身；`scripts/p1_baseline.json` 是门禁的基线
  数据文件、不是代码引用点，不计入。**96 个静默删除项未做同等逐文件查引用**（见 §6）。

| 被删目标 | 存活的引用方 |
|---|---|
| `console/src/api/modules/plan.ts` | 3：`components/AnywhereChat/index.tsx`、`pages/Agent/Config/components/ReactAgentCard.tsx`、`pages/Chat/index.tsx` |
| `console/src/components/PlanPanel/index.tsx` | 2：`components/AnywhereChat/index.tsx`、`pages/Chat/components/ChatActionGroup/index.tsx` |
| `console/src/pages/Agent/Workspace/index.tsx` | 1：`layouts/MainLayout/index.tsx`（路由表） |
| `console/src/pages/Agent/Workspace/index.module.less` | 1：同上 |
| `console/src/pages/Chat/components/ChatSessionDrawer/index.tsx` | 1：`pages/Chat/components/ChatActionGroup/index.tsx` |
| `console/src/pages/Settings/Agents/components/AgentTable.tsx` | 1：`pages/Settings/Agents/components/index.ts` |
| `console/src/pages/Agent/Workspace/components/{FileListPanel.tsx,useAgentsData.ts}` | **0** —— 整个 Workspace 界面只剩上面两行引用，取上游即整套消失 |
| `app.runner` / `app.mcp` 点号引用 | 6 个生产文件 + 1 个打包脚本 + 13 个测试文件（其中 **9 个是我们自己新增的测试**）：`app/_app.py`、`agents/react_agent.py`、`app/routers/plugins.py`、`cli/daemon_cmd.py`、`agent_stats/service.py`、`agents/memory/proactive/proactive_trigger.py`、`scripts/pack-tauri/qwenpaw.spec`、`tests/unit/app/runner/*.py`（5 个）、`tests/unit/app/test_mcp_*.py`（4 个）、`tests/unit/app/{test_chat_updates,test_title_generator,test_reload_background_task_killed}.py`、`tests/unit/agents/test_session.py` |

**⇒ 合并的验收不能只看"冲突清零"**，必须在这 112 个之外再跑一遍：`tsc -b`、Python 单测、前端用例。
上一节的 96 个静默删除项，是本表里唯一一处"越安静越危险"的东西。

---

## 4. 上游带来的新体量（合并的另一半成本）

4,977 个我们从没碰过的文件会直接进树。按顶层目录分布：

```
console   1,387      plugins  1,355      src    931      tests  928
website     189      e2e        73      .github   46
scripts      37      packages    14
```

其中 `plugins/`（含 `plugins/apps/qwenpaw-creator/`，单文件最大 9,940 行）与 `e2e/` 是**我们完全没有的新子系统**：
它们不产生冲突，但每合一次就多一批必须决定"CoPaw 界面挂不挂它"的东西。**这部分成本不体现在冲突数里，
却决定合并之后能不能真的跑起来。**

---

## 5. 逐文件表

列含义：

- **块** = 该文件里 `<<<<<<<` 标记的数量；**标记内行** = 落在冲突标记之间的行数（含 ours/theirs 两侧与分隔线）。
- **我们改的行** = `分叉点 → HEAD` 的增删合计；**上游改的行** = `分叉点 → upstream/main` 的增删合计。
  ⚠ 两个注意点：① 上游改的行在 modify/delete 行里读作"上游删掉的行数"；
  ② 若上游把文件改名了，我们侧的改动仍记在**旧路径**上，所以新路径行的"我们改的行"会读成 0
  （例如 `app/chats/session.py` 读 0，而 `app/runner/session.py` 的 496 行行为改动记在旧路径）。
- **在欠账表** = 是否被 `check_p1_invariants.py` 现数收录。
- **默认处置** = 按冲突性质给出的第一动作，**不是裁决**；每行仍需一次人工确认，尤其"取上游"必须先确认
  我们的改动是否已被上游某处覆盖（这是过去几十步反复踩过的点：退回上游字节会**减**债，但退错会丢能力）。

### 性质：content（86 个文件）

| 文件 | 冲突类型 | 块 | 标记内行 | 我们改的行 | 上游改的行 | 在欠账表 | 备注 | 默认处置 |
|---|---|---|---|---|---|---|---|---|
| `console/package-lock.json` | content | 346 | 17,161 | 18,404 | 20,913 | 是 | 生成文件 | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/app/routers/agents.py` | content | 21 | 3,179 | 4,379 | 1,826 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Agent/Skills/index.tsx` | content | 6 | 1,176 | 1,128 | 271 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/api/modules/agents.ts` | content | 3 | 757 | 695 | 114 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/layouts/Sidebar.tsx` | content | 3 | 444 | 53 | 1,588 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/app/routers/workspace.py` | content | 8 | 404 | 164 | 1,430 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/api/request.test.ts` | content | 1 | 373 | 58 | 332 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/agents/react_agent.py` | content | 2 | 366 | 116 | 2,466 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/app/chats/session.py` | content | 11 | 361 | 0 | 473 | 否 | 这是上游把 `src/qwenpaw/app/runner/session.py` 改名后的位置（71%）；不在欠账表（分叉点后才出现的路径） | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Settings/Environments/index.module.less` | content | 5 | 357 | 48 | 770 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Agent/MCP/components/MCPClientCard.tsx` | content | 8 | 285 | 61 | 422 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/app/routers/skills.py` | content | 3 | 251 | 702 | 715 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Control/Channels/components/ChannelDrawer.tsx` | content | 1 | 244 | 18 | 1,134 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/layouts/Header.tsx` | content | 4 | 243 | 14 | 462 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/layouts/MainLayout/index.tsx` | content | 2 | 226 | 42 | 225 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Agent/Config/useAgentConfig.tsx` | content | 4 | 222 | 93 | 200 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/agents/tools/file_io.py` | content | 7 | 212 | 62 | 407 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Agent/Config/components/ReactAgentCard.tsx` | content | 4 | 188 | 35 | 426 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Agent/MCP/index.tsx` | content | 9 | 186 | 231 | 195 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Settings/Security/index.tsx` | content | 4 | 175 | 340 | 114 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Settings/Security/index.module.less` | content | 3 | 174 | 22 | 540 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Settings/SkillPool/index.module.less` | content | 2 | 170 | 7 | 851 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Chat/index.module.less` | content | 2 | 156 | 103 | 750 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Coding/TabbedEditor.tsx` | content | 10 | 155 | 27 | 1,086 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/i18n.ts` | content | 1 | 142 | 17 | 122 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/components/AgentSelector/index.module.less` | content | 7 | 140 | 30 | 586 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/providers/retry_chat_model.py` | content | 2 | 139 | 78 | 809 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/config/context.py` | content | 2 | 134 | 39 | 229 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/cli/desktop_cmd.py` | content | 2 | 127 | 111 | 141 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/App.tsx` | content | 2 | 122 | 20 | 587 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/app/multi_agent_manager.py` | content | 3 | 108 | 26 | 681 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/app/channels/dingtalk/channel.py` | content | 1 | 95 | 75 | 464 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/components/AgentSelector/index.tsx` | content | 3 | 90 | 28 | 646 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/app/workspace/workspace.py` | content | 6 | 89 | 58 | 642 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/api/request.ts` | content | 1 | 82 | 127 | 170 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Settings/Agents/index.tsx` | content | 3 | 76 | 62 | 272 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/plugins/PluginContext.tsx` | content | 2 | 74 | 9 | 86 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/plugins/usePluginLoader.ts` | content | 3 | 73 | 45 | 229 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/layouts/constants.ts` | content | 1 | 71 | 14 | 60 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/package.json` | content | 7 | 69 | 30 | 48 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Control/Heartbeat/index.tsx` | content | 2 | 68 | 18 | 310 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/app/agent_context.py` | content | 1 | 65 | 92 | 192 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Agent/Tools/index.module.less` | content | 3 | 62 | 7 | 506 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/providers/openai_provider.py` | content | 2 | 59 | 13 | 778 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/layouts/index.module.less` | content | 4 | 58 | 20 | 1,155 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Agent/MCP/index.module.less` | content | 4 | 57 | 15 | 952 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/index.html` | content | 1 | 55 | 14 | 53 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/api/types/agents.ts` | content | 4 | 47 | 620 | 127 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Agent/Skills/index.module.less` | content | 4 | 47 | 9 | 1,553 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/api/modules/chat.ts` | content | 1 | 45 | 141 | 114 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Chat/components/ChatHeaderTitle/index.tsx` | content | 2 | 45 | 5 | 242 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Chat/index.tsx` | content | 2 | 44 | 4 | 4,338 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/app/_app.py` | content | 2 | 43 | 54 | 804 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Agent/MCP/useMCP.ts` | content | 5 | 42 | 80 | 91 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/components/AgentSelector/AgentSelector.test.tsx` | content | 3 | 41 | 7 | 257 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/agents/utils/message_processing.py` | content | 2 | 41 | 53 | 261 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/providers/ollama_provider.py` | content | 1 | 38 | 4 | 58 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/api/types/agent.ts` | content | 3 | 36 | 41 | 151 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/providers/openai_chat_model_compat.py` | content | 2 | 35 | 8 | 872 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/vite.config.ts` | content | 2 | 34 | 27 | 144 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/config/config.py` | content | 2 | 32 | 76 | 2,597 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Settings/Models/index.module.less` | content | 2 | 31 | 141 | 2,403 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/components/LanguageSwitcher/index.tsx` | content | 1 | 25 | 3 | 56 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `pyproject.toml` | content | 3 | 25 | 13 | 91 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Control/Channels/index.module.less` | content | 2 | 23 | 5 | 571 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/agents/tools/file_search.py` | content | 2 | 22 | 4 | 248 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/app/routers/__init__.py` | content | 2 | 22 | 16 | 26 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/app/chats/__init__.py` | content | 2 | 20 | 0 | 24 | 否 | 这是上游把 `src/qwenpaw/app/runner/__init__.py` 改名后的位置（67%）；不在欠账表（分叉点后才出现的路径） | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/app/routers/config.py` | content | 2 | 20 | 77 | 710 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/api/types/chat.ts` | content | 1 | 18 | 18 | 28 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/security/tool_guard/guardians/file_guardian.py` | content | 2 | 18 | 3 | 24 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/app/routers/providers.py` | content | 2 | 17 | 48 | 609 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/utils/lazyWithRetry.ts` | content | 1 | 15 | 39 | 31 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/app/routers/agent_scoped.py` | content | 2 | 14 | 14 | 9 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/components/LanguageSwitcher/index.module.less` | content | 1 | 13 | 2 | 62 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/styles/layout.css` | content | 1 | 13 | 8 | 544 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Settings/Agents/index.module.less` | content | 1 | 11 | 2 | 280 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/api/modules/agent.ts` | content | 1 | 10 | 380 | 38 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `src/qwenpaw/agents/memory/agent_md_manager.py` | content | 1 | 10 | 5 | 180 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Chat/ModelSelector/index.module.less` | content | 1 | 9 | 3 | 1,771 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Settings/Models/components/modals/ProviderConfigModal.tsx` | content | 2 | 9 | 241 | 196 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Login/index.tsx` | content | 1 | 8 | 7 | 295 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Chat/utils.test.ts` | content | 1 | 7 | 58 | 179 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Agent/Skills/components/index.ts` | content | 1 | 6 | 1 | 30 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Settings/Agents/components/index.ts` | content | 1 | 6 | 1 | 3 | 是 | — | 逐块判定：ours / theirs / 手工合 |
| `console/src/pages/Chat/components/WhisperSpeechButton/index.tsx` | content | 1 | 4 | 24 | 12 | 是 | — | 逐块判定：ours / theirs / 手工合 |

### 性质：add/add（9 个文件）

| 文件 | 冲突类型 | 块 | 标记内行 | 我们改的行 | 上游改的行 | 在欠账表 | 备注 | 默认处置 |
|---|---|---|---|---|---|---|---|---|
| `tests/unit/providers/test_retry_chat_model.py` | add/add | 2 | 1,896 | 70 | 1,830 | 否 | 不在欠账表（分叉点后才出现的路径） | 二选一或合并断言（两侧各自新建同一路径） |
| `tests/unit/app/routers/test_workspace_router.py` | add/add | 1 | 1,183 | 103 | 1,079 | 否 | 不在欠账表（分叉点后才出现的路径） | 二选一或合并断言（两侧各自新建同一路径） |
| `tests/unit/app/crons/test_manager.py` | add/add | 1 | 885 | 156 | 728 | 否 | 不在欠账表（分叉点后才出现的路径） | 二选一或合并断言（两侧各自新建同一路径） |
| `console/src/pages/Control/Channels/components/ChannelDrawer.test.tsx` | add/add | 2 | 815 | 126 | 697 | 否 | 不在欠账表（分叉点后才出现的路径） | 二选一或合并断言（两侧各自新建同一路径） |
| `tests/unit/config/test_config_utils.py` | add/add | 1 | 617 | 64 | 552 | 否 | 不在欠账表（分叉点后才出现的路径） | 二选一或合并断言（两侧各自新建同一路径） |
| `tests/unit/app/routers/test_tools_router.py` | add/add | 2 | 588 | 205 | 387 | 否 | 不在欠账表（分叉点后才出现的路径） | 二选一或合并断言（两侧各自新建同一路径） |
| `console/src/api/modules/agents.test.ts` | add/add | 1 | 433 | 226 | 208 | 否 | 不在欠账表（分叉点后才出现的路径） | 二选一或合并断言（两侧各自新建同一路径） |
| `tests/unit/app/crons/test_heartbeat.py` | add/add | 1 | 407 | 301 | 109 | 否 | 不在欠账表（分叉点后才出现的路径） | 二选一或合并断言（两侧各自新建同一路径） |
| `tests/unit/app/test_agent_config_watcher.py` | add/add | 2 | 242 | 156 | 90 | 否 | 不在欠账表（分叉点后才出现的路径） | 二选一或合并断言（两侧各自新建同一路径） |

### 性质：modify/delete（16 个文件）

| 文件 | 冲突类型 | 块 | 标记内行 | 我们改的行 | 上游改的行 | 在欠账表 | 备注 | 默认处置 |
|---|---|---|---|---|---|---|---|---|
| `console/src/api/modules/plan.ts` | modify/delete | 0 | 0 | 23 | 115 | 是 | — | 上游已删除，须先定位上游替代实现再决定搬运目标 |
| `console/src/components/PlanPanel/index.tsx` | modify/delete | 0 | 0 | 18 | 216 | 是 | — | 上游已删除，须先定位上游替代实现再决定搬运目标 |
| `console/src/pages/Agent/Workspace/components/FileListPanel.tsx` | modify/delete | 0 | 0 | 14 | 126 | 是 | — | 上游已删除，须先定位上游替代实现再决定搬运目标 |
| `console/src/pages/Agent/Workspace/components/useAgentsData.ts` | modify/delete | 0 | 0 | 82 | 296 | 是 | — | 上游已删除，须先定位上游替代实现再决定搬运目标 |
| `console/src/pages/Agent/Workspace/index.module.less` | modify/delete | 0 | 0 | 11 | 655 | 是 | — | 上游已删除，须先定位上游替代实现再决定搬运目标 |
| `console/src/pages/Agent/Workspace/index.tsx` | modify/delete | 0 | 0 | 12 | 208 | 是 | — | 上游已删除，须先定位上游替代实现再决定搬运目标 |
| `console/src/pages/Chat/components/ChatSessionDrawer/index.tsx` | modify/delete | 0 | 0 | 10 | 613 | 是 | — | 上游已删除，须先定位上游替代实现再决定搬运目标 |
| `console/src/pages/Settings/Agents/components/AgentTable.tsx` | modify/delete | 0 | 0 | 158 | 248 | 是 | — | 上游已删除，须先定位上游替代实现再决定搬运目标 |
| `src/qwenpaw/app/mcp/manager.py` | modify/delete | 0 | 0 | 207 | 286 | 是 | — | 上游已删除，须先定位上游替代实现再决定搬运目标 |
| `src/qwenpaw/app/mcp/stateful_client.py` | modify/delete | 0 | 0 | 1,086 | 665 | 是 | — | 上游已删除，须先定位上游替代实现再决定搬运目标 |
| `src/qwenpaw/app/mcp/watcher.py` | modify/delete | 0 | 0 | 34 | 331 | 是 | — | 上游已删除，须先定位上游替代实现再决定搬运目标 |
| `src/qwenpaw/app/routers/plan.py` | modify/delete | 0 | 0 | 2 | 176 | 是 | — | 上游已删除，须先定位上游替代实现再决定搬运目标 |
| `src/qwenpaw/app/runner/api.py` | modify/delete | 0 | 0 | 491 | 233 | 是 | — | 上游已删除，须先定位上游替代实现再决定搬运目标 |
| `src/qwenpaw/app/runner/command_dispatch.py` | modify/delete | 0 | 0 | 24 | 332 | 是 | — | 上游已删除，须先定位上游替代实现再决定搬运目标 |
| `src/qwenpaw/app/runner/models.py` | modify/delete | 0 | 0 | 37 | 103 | 是 | — | 上游已删除，须先定位上游替代实现再决定搬运目标 |
| `src/qwenpaw/app/runner/runner.py` | modify/delete | 0 | 0 | 35 | 1,034 | 是 | — | 上游已删除，须先定位上游替代实现再决定搬运目标 |

### 性质：file location（1 个文件）

| 文件 | 冲突类型 | 块 | 标记内行 | 我们改的行 | 上游改的行 | 在欠账表 | 备注 | 默认处置 |
|---|---|---|---|---|---|---|---|---|
| `src/qwenpaw/app/chats/query_error_resilience.py` | file location | 0 | 0 | 0 | 0 | 否 | 上游把 `src/qwenpaw/app/runner/query_error_resilience.py` 放进已改名的目录，建议移到 `src/qwenpaw/app/chats/query_error_resilience.py`；不在欠账表（分叉点后才出现的路径） | 上游把它挪到了别处，改名即可 |

---

## 6. 这张表**没有**测到的（别当结论用）

- **标记内行数把 ours + theirs + 分隔线全计入了**，没有扣掉公共祖先那一侧 ⇒ 单块读数会高于"真正要重写的行数"。
  它可以用来排序（哪个文件最麻烦），不能用来估算编辑量。
- **9 个撞名新建只证明"两侧都有这个路径"**，没有判语义是否重复。其中 7 个是 Python 测试文件，我们的版本
  有可能是上游版本的分叉祖先，也可能完全不是一回事 —— 这一步必须逐文件读。
- **modify/delete 的 16 个只列了目标，没列落点**：上游用什么替代了 `app/mcp/manager.py`、`app/routers/plan.py`
  一个都没定位。这一项是合并里最需要判断力的部分，也是最容易被"先取 ours 让它编译过"糊弄过去的部分。
- **没有跑任何测试**，因为还没有真合并。`tsc -b`、pytest、vitest 都需要一棵合并后的树。
  本表全部是 `merge-tree` 的静态读数。
- **当前基线不是合并后的预期**：前端 74 文件 / 466 用例、Python 3,382 用例是 HEAD 的数；上游那 4,977 个
  我们从没碰过的文件里带着自己的测试，合并后这两个数一定会变。
- **上游 `plugins/` 1,355 个文件、`e2e/` 73 个文件的可用性未评估** —— 它们不冲突，但要不要挂进 CoPaw 界面
  是产品决策，不是合并决策。
- **静默删除的 96 项只按"我们是否改过"分类，没有逐个查引用**。§3 那张引用表只覆盖了 16 个 modify/delete
  目标（前端用相对路径逐项解析、Python 用点号路径 grep）。同样的解析器**还没有跑在那 96 个上**，
  所以"96 个静默删除"目前的准确说法是"96 个不产生冲突提示的删除候选"，不是"96 处已证实的断裂"。
- 第一轮曾用路径 token 模糊匹配量前端引用，得到过"21 个文件引用 `ChatSessionItem/index.module.less`"这类
  由同名引起的假命中，该方法已废弃；§3 的行数是换成**逐文件解析相对 import** 之后重算的。
- 表内"我们改的行 / 上游改的行"来自 `--no-renames` 的 numstat，**改名文件的两侧数字分别记在新旧路径上**
  （见 §5 列说明），所以 `app/chats/session.py` 那行读 0 不代表我们没改过它的前身。

---

## 7. 若要真做这次合并，建议的分批顺序（每批都带可证红的验收）

1. **零裁决批次**：`console/package-lock.json` 取上游 + 重新 `npm install` 生成；`pyproject.toml`、
   `console/package.json` 的依赖行取上游。
   验收 = 依赖能解析，且现有前端 466 用例与 Python 3,382 用例仍绿（这一步不该改变任何行为；改变即回退）。
2. **16 个 modify/delete**：每个先在上游树里定位替代实现（已确认的一条线索是 `app/runner/ → app/chats/`，
   其余 15 个未定位），找到就把我们的增量搬过去，搬不动就在自有区安家并显式记账"放弃了什么能力"。
   验收 = §3 列出的 Python 侧 6 个生产引用 + 1 个打包脚本 + 13 个测试文件、前端侧 8 处存活引用方
   （`plan.ts` 3 + `PlanPanel` 2 + `Workspace/index.tsx` 1 + `index.module.less` 1 + `ChatSessionDrawer` 1 +
   `AgentTable` 1）全部指向存在的路径，且 `tsc -b` 与 pytest 的收集阶段零报错。
3. **85 个内容冲突（258 块）按目录成批**：`src/qwenpaw` 36 个 → 其余 `console` → `.module.less` 与 `locales`
   这一类"样式/文案型"最后。每批结束立刻跑门禁与用例，不要攒到最后一起判。
4. **9 个撞名新建 + 1 个位置冲突**：逐个决定保留哪一份断言；位置冲突那一个改名即可。
5. **收尾重算**：§1、§2、§3 三张读数全部重算（它们必然变），并按"退回上游字节会减债"的方向核对在册数 145 的走向。

---

## 8. 复现命令

```bash
git fetch upstream --prune
git merge-tree --write-tree --name-only HEAD upstream/main
git merge-tree --write-tree HEAD upstream/main            # 带 CONFLICT 类型与阶段信息
git rev-list --count HEAD..upstream/main                  # 落后多少提交
git merge-base HEAD upstream/main                         # 分叉点
python scripts/check_p1_invariants.py \
  --base-ref e111ec6fb --target-ref HEAD --json           # 在册表（判据 84 的对照物）
git diff -M --name-status e111ec6fb upstream/main         # 改名映射（判据 86 必需）
git diff --no-renames --numstat e111ec6fb HEAD            # 我们侧行数
git diff --no-renames --numstat e111ec6fb upstream/main   # 上游侧行数
```

**必须带 `-M` 的那一步不是可选的**：不带改名映射会把 2 个真冲突读成"干净合并"（判据 86）。

上面的命令即可重算全部读数（`merge-tree` 无副作用，随时可跑）。测量过程中产生的逐文件数值
（112 文件的冲突块/行数、在册与静默删除交叉、被引用清单）当时落在 `/tmp` 下，属于临时文件，
**未随本文提交** —— 本文表格里的每个数都由这些临时读数生成，需要更细的数值请按上面的命令重算。

唯一例外：**§3 前端那几行"存活引用方"** 不是一个 git 命令能出的，它来自一个一次性解析器（枚举
`console/src` 的 import 说明符 → 按宿主目录解析相对路径 → 与 16 个目标比对）。该脚本未提交，
重算要按 §3 开头写的方法重做一遍。Python 侧那行是 `git grep` 现查，可直接复现。

---

## 9. 引用

上游快照 `80e412da9`（2026-09-30，`upstream/main`）· 分叉点 `e111ec6fb`（2026-06-03）·
测量时 HEAD `96f7dab79`（`wp/integration`，已推送，未开 PR）· 方法沉淀见本文 §2 的判据 **84 / 85 / 86**，
与前序判据序列（1–83，定义在 `UPSTREAM_V2_MIGRATION_PLAN.md` §8 的各"已闭环"条目与
`2026-10-01-conflict-surface-backlog.md` 里）续号。**84–86 目前只写在本文，尚未镜像进迁移计划 §8 —— 本文没有执行任何代码改动，所以没按"每刀一条 §8 记录"的惯例开条目。**
