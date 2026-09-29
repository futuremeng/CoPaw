# CoPaw fork → 上游 QwenPaw v2 迁移计划

对象仓库：`/Users/futuremeng/github/futuremeng/CoPaw`（`origin` = `futuremeng/CoPaw`，GitHub 关系 `isFork=true`，parent = `agentscope-ai/QwenPaw`）
基线数据全部由文末命令在 **2026-09-29** 重新 fetch 后产出，upstream HEAD = `70715e982`（2026-09-28）。

---

## 0. 总原则（2026-09-29 由用户定，优先级高于本计划其余一切）

1. **完全保留 qwenpaw 的功能，不要破坏。**
2. **自身新增功能与扩展分两路**：能以 qwenpaw 原生模式构建的 → **用原生方式实现**；不方便原生的 → **放 `copaw`**。
3. **产品名以 Copaw 为准**（底座包名仍是 `qwenpaw`，二者不冲突）。**D-15 已把覆盖深度裁定为：可见品牌与分发物，包括命令等命名，都叫 Copaw**（不是只到界面内）。落地方式按原则 2 排序：上游已原生给的（`copaw` CLI 命令、`COPAW_*`、`~/.copaw`、`copaw.doctor`）直接用、不挂 patch；界面内有品牌位的用品牌位；其余改名进 P1-命名册并做成可机械重放（§6 D-15、§7、§8 已闭环 23）。
4. **Copaw 需要自己的一套"工作台"界面（原称"看板模式"，2026-09-29 升级为工作台），用户可在三种界面间随时切换。** 上游现状：默认界面（工程师化）与桌面模式（过于像 OS 桌面）都不适合作为 Copaw 的主界面。工作台的定义不是仪表盘，而是**聚合对话、文件、统计、知识、任务这五类对用户直接有价值的内容与操作的入口**。Copaw 工作台为**默认落地界面**，上游两个界面降为次级入口。

### 0.1 原则的可度量形式（用作 Gate，不是口号）

| 原则 | 不变式 | 当前基线 | 目标 |
| --- | --- | --- | --- |
| P1 不破坏 | **fork 对上游自有文件的改动数只减不增**（D-15 后拆两册，见 §7） | **全仓 187 个上游自有文件被 fork 改过**（+24,985/−12,377，§2.1.1）；此前长期只统计 `src/qwenpaw` **61** 个与 `console/src` **83** 个，另有 **43 个账外文件**（根 README×4 + `pyproject.toml` + `console/index.html` + `tests/**` 10 个上游测试 + `scripts/**` 10 + `.github/**` 4 + `website/**` 4 + `Makefile`/`CONTRIBUTING`/`Dockerfile` 等）；另含 **5 处上游文件 import fork 私有模块**（2 处 `import copaw` + 3 处 `import runtime_mode`，见 §2 耦合真相）。**其中真·产品名改动经配对量化 = 22 文件 / 127 行**（§8 已闭环 23） | **P1-行为 = 0，无例外**（D-8：不许挂 patch，宁可砍功能；含树外 patch）；**P1-命名 = 承认并治理**（D-15：可见品牌与分发物含命令命名都叫 Copaw），封闭清单 + 可机械重放 + 新增需说明。计数口径 = 全仓，`package-lock.json` 单列为机械差异 |
| P1 不破坏 | 迁移切片**默认丢弃** fork 对上游文件的旧改动，而不是搬运它 | — | 承载 Copaw 能力的部分改用原生接缝重表达；不能重表达的部分**直接砍或进 `src/copaw`**。**D-13 已裁：feature 类改动不再提上游 PR**（本仓 21 个 PR 只合 1 个，§2.4），PR 只用于**明确的 qwenpaw bug**，且不承载任何 Copaw 功能 |
| P2 原生优先 | 每个 fork 能力在动工前先落一个归属判定（见 0.2 决策表），未判定不许写代码 | — | 判定表覆盖 §4 全部 12 行 |
| P3 品牌 | **D-15 已裁**：可见品牌与分发物（含命令等命名）都叫 Copaw；界面内走原生品牌位，界面外改名走 P1-命名册 | 实测三件事分开看：**(1) 真·改名 = 22 文件 / 127 行**（§8 已闭环 23 有分布表）；**(2) fork 在界面内文案上其实一处没改** —— `console/src/locales/{en,zh}.json` 各 +128 行是**新 feature key**（`nlpConfig`、`projects`…，0 个品牌字样），`{id,ja,pt-BR,ru}` 各 +11/−2 同类，另外 18 个文件是 fork 新增的 `locales/copaw/*`（+2,762/−0，不计数），`i18n.ts` 的 36 行是 import 这些私有文件；**(3) 命令名/目录名上游原生就有**（`[project.scripts] copaw`、`COPAW_*`、`~/.copaw`、`copaw.doctor`） | **(1) 127 行改名 = 承认 + 做成可机械重放的命名册**（WP-01 新交付物），不再追归零；**(2) 界面内 494 处 QwenPaw 文案（v2 上游 locale 实测）**先验覆盖接缝（§8 未验证 19），验不过才进命名册；**(3) 上游已有的 feature-key 追加（那 6 个文件）不属于命名册** —— 它是往上游文件里加长尾内容的 **P1-行为**改动，目标是把私有文案收敛进 `locales/copaw/*` 并让注册面本身移出上游文件；**命令/目录/环境变量一类"改名"直接删除 fork 的重复实现，按原生用** |
| P4 工作台模式 | 工作台的信息架构、卡片、数据源、三向切换器**只经 `route.add`/`route.replace`/`menu`/`slot` 注册**产出；上游文件的改动**只允许出现在 §6.1 例外清单里列出的那 2 个文件的加性行**（`console/src/App.tsx`、`console/src/utils/navigationMode.ts`） | 尚不存在 | 例外清单外的 `console/src` 上游文件改动数 = 0；清单内两个文件的改动**只增不扩**，且必须与上游 `osActive` 分支同形（见 §3.3、§6.1） |

### 0.2 归属判定流程（P2 的执行入口）

对一个 fork 能力依次问：

> **先排除一类：纯产品名/文案改动不进这套四态判定。** D-15 已裁"可见品牌与分发物（含命令命名）都叫 Copaw"，所以改名走 §7 的 **P1-命名册**（封闭清单 + 可机械重放），不走下面的归属流程。**但先查原生是否已给**：CLI 命令名 `copaw`、`COPAW_*` env、`~/.copaw` 目录、`copaw.doctor` 分组都是上游原文（§8 已闭环 23），这些位置连命名册都不该进。

1. 上游有对应 `PluginType` 类目或 PawApp 注册方法吗？（`tool / provider / hook / command / channel / memory / frontend / app` + `route / include_router / managed_service / dependency / agent_profile / skill_provider / prompt_section / runtime_hook / on_workspace_created / task+SSE`）→ **有：原生实现**，落 `plugins/apps/copaw-*`。
2. 是前端吗？上游 console 有 `registerRoutes`（路由+侧边栏菜单）、`addToolRenderers`（工具气泡渲染）、`slot`/`menu`/`route` 注册面与 `header.leftTitle`/`header.leftLogo`/`theme.colorPrimary` 品牌位 → **有：写成 FRONTEND 插件，不碰上游 console 源码**。
3. 是"修 qwenpaw 自身的**明确 bug**"吗？→ 提上游 PR（**D-13 已裁：除此之外不再提 PR**）。本仓 `feat/upstream/*` 有 **11 条**分支、对应 21 个上游 PR，实测合并 1 个，且唯一合的是单点小 bugfix（`#1480`）；`fix(` 13 个合 1 个、`feat(` 8 个合 0 个（§2.4）。所以 PR 的定位是**降低未来冲突面 / 让 sync 更便宜**，**不是保住某个 fork 功能的机制**。
   > **本条已按 D-13 改写**：原判据流程把"走上游 PR"列为第 3 个归属态，实测证据（21 开 1 合）说明它经验上等价于"永久砍掉"。**feature 类改动一律不提 PR**，直接走第 1/2 条（原生）或第 4 条（`copaw`）或第 5 条（砍）。
4. 以上都不成立（需要上游没有的常驻进程模型、需要改上游数据结构等），且属于 **Copaw 自有能力** → **放 `src/copaw`**（D-7 定为并存：稳定的私有能力进 `src/copaw`，想反哺的进 `plugins/apps`）。落在这里的东西必须是**可整目录删除而不影响 qwenpaw 启动与功能**的。
5. 既无原生接缝、又不肯砍、也不能进 `copaw`（因为它必须在执行路径上改上游行为）→ **该功能砍掉**。这是 D-8 的明文后果，不是异常。

> 只有第 4 条落到 `src/copaw`。这条流程的意义是防止"先在 fork 里 patch 一把"退化成默认路径 —— 那正是当前**全仓 187 个上游文件被改**（§2.1.1；旧口径只看得见 61+83）、1160 提交落后的成因。

### 0.3 原则与裁决的相互影响（含 D-10/D-11/D-12 对 D-8 的例外化）

- **D-1**（可上游化 vs 私有 overlay）：原则 2 定为原生优先 → 可上游化路线，`copaw` 只兜底。
- **D-5**（`copaw` 命名）：原则 3 定为 Copaw → 包名保留。上游自己也留着 `copaw` 这个 legacy CLI 别名与 legacy `copaw.doctor` 入口组，不冲突。
- **D-7**（"放到 copaw" 指包还是产品层）：**定为并存** —— 稳的私有能力进 `src/copaw`（A 案语义：全局顶层包、零导入改写、可整目录丢弃），想反哺的进 `plugins/apps/copaw-*`（B 案）。
- **D-8**（无接缝时能否挂 patch）：**定为不许挂，宁可砍**。代价见 §2.1，其中最大一项（`agents.py`）的实际形状已由 §2.3 量清 —— 不是"4,239 行新增要重写"，而是"私有命名空间的路由体 + 一层该删的转发"；**D-14 落定后该文件的手工语义合并面 = 0**。D-8 的退路原写作"走上游 PR"，现由 **D-13** 收窄为"只能砍或进 copaw"。
- **D-3**（v2 基线）：**定为 `upstream/main`（2.2.2b4）**，与上游节奏一致。（原附带的理由"反哺 PR 可直接合"已被 §2.4 实测推翻：本仓 21 个上游 PR 合并 1 个。基线选择本身不变。）
- **D-10**（第三种界面做到哪一层）：**定为形态 3 —— 与 `/console`、`/os` 平级的第三个模式 root `/wb`**，明知需破 D-8。这是 D-8 的**第一个也是目前唯一一个例外**，例外条款与 patch 面见 §6.1。
- **D-11**（"看板"指任务流转看板还是概览仪表盘）：**都不选，重定义为工作台** —— 聚合对话/文件/统计/知识/任务的操作性入口，不是单纯指标卡盘，也不是 Issue 列看板。上游 `plugins/apps/agent-kanban` 因此不构成复用对象，WP-11 按新建算。
- **D-12**（默认落地界面）：**定为 Copaw 工作台**，上游界面降为次级入口。这条**原生可做**：`route.replace(pluginId, "core.root", …)` 无 targetId 白名单（§3.3）。
- **本轮"确认未决项"新开的 2 条决策已全部关闭**（用户 2026-09-29 裁决，见 §6 已关闭表）：**D-13 = 不再提 PR，除非是明确的 bug**；**D-14 = 内置 agent 保留和 upstream 一致的策略**（= 砍掉 `system_protected`）。同时 D-4、D-9 由实测闭环。**（本轮补记：D-1…D-14 全部关闭；"以仓库实际为准"复核时新开的 D-15 也已由用户裁决 ——「可见品牌与分发物，包括命令等命名，都叫 Copaw」，其后果是 P1 指标拆成 `行为`/`命名` 两册，见 §6 与 §2.1.1、§7。当前没有待裁项。）**

---

## 1. 结论

> 前提：**§0 的四条总原则优先于本节**。本节是原则下的技术结论。

- **不做一次性 merge**：`main` 落后 1160 提交、跨 v1.1.11b1 → v2.2.2b4 大版本，双方共同改动 179 个文件，且上游删掉了 fork 改过的 11 个后端文件。一次 merge 的结果无法验证。
- **不重新 fork**：fork 关系健康，重新 fork 只是换一份干净上游副本，约 810 个真实提交的移植量一分不减，还会丢掉 `feat/upstream/*` 的上游 PR 关联和全部 backup 分支历史。（D-13 后前者的价值下降，但那些分支是 WP-02 对账"11 条分支 × 21 个 PR、哪些代码既不在上游也不在主线"的唯一凭据，仍然不能丢。）
- **走结构解耦 + 分片移植**：上游 v2 已经把"后端 router + 前端页面 + sidecar 进程 + 长任务"做成一等公民（PawApp SDK）。fork 独有的 `src/copaw` 正好是这一形态，应把它从"平行包 + 侵入式 import"改造成一个 PawApp，以 `upstream/main` 为新基线逐片移植。
  > **一处修正**（§8 已闭环 13）：fork 的能力实际只用到这套契约的 **router / dependency / task** 三面；**`managed_service`（常驻 loopback HTTP 进程托管）在本 fork 没有对应物** —— 它的"sidecar"是另一个 venv 的解释器与进程内模型单例，不是服务。移植时不要把 HanLP/DuckDB 硬塞进 `managed_service`。

判定一句话：**偏离确实很大，但偏离的形态刚好是上游 v2 新增的扩展形态，所以既不是同步能解决，也不是重新 fork 能解决 —— 是把 fork 的能力一件件搬进上游的扩展面，搬不动的收进 `copaw`。**

---

## 2. 分叉事实基线

| 指标 | 值 |
| --- | --- |
| 同步 merge-base | `e111ec6f`（2026-06-03，`fix(coding-mode): support browsing all drives on Windows (#4906)`） |
| `main` vs `upstream/main` | fork 独有 **889**，落后 **1160** |
| fork 独有提交构成 | 79 个 merge（历次同步），约 **810 个真实提交**；类型分布 feat 299 / fix 276 / refactor 67 / docs 40 / chore 29 / test 16 |
| 文件级差异 | **691 files, +203,231 / −12,377**；其中 **504 新增 / 187 修改** |
| fork 版本 / 上游版本 | `1.1.11b1` / `2.2.2b4`（另有 `release/v2.2.1` = `cae577370`，2026-09-11） |
| 上游同期改动规模 | 5076 文件；`console/src` 1304、`plugins/apps` 1167、`src/qwenpaw` 897、`tests/unit` 658 |
| 上游删除 | qwenpaw 包内 89 个文件 |

分区拆解（`e111ec6f → main`）：

| 区域 | fork 新增 | fork 改动上游文件 | 其中该文件在 v2 已不存在 |
| --- | --- | --- | --- |
| `src/copaw` | 81 | 0 | — （fork 自有包） |
| `src/qwenpaw` | 64 | **61** | **11**（`app/mcp/*` 3、`app/runner/*` 6、`app/routers/plan.py`） |
| `console/src` | **206** | **83** | 8 |
| `console/` 非 src（本轮补测） | （新增文件未单列） | **4**：`vite.config.ts` 25/2、`package.json` 21/13、`index.html` 12/2、`tsconfig.app.json` 1/2 | — （`package-lock.json` 8,960/9,444 单列为机械差异，见 §2.1.1） |
| `tests` | 66 | 10 | — |
| `docs` | 36 | 0 | — |
| `scripts` | 17 | 10 | — |
| `.github` | 5 | 4 | 含 `unit-tests.yml` `frontend-tests.yml` `pr-under-review.yml` |
| `website` / `deploy` | 0 | 4 / 1 | — |
| 根目录散落 | 20+ | — | `tmp/*.py`(6)、`test_mcp_headers_debug.py`、`fork_issues.json`、`fork_prs.json`、`upstream_prs.json`、`upstream_issues.json`、`ROADMAP.md`、`DEV_BRANCHING_SOP*.md`、`SUPERSET_MCP_FIX.md`、`dual-track-sop.SKILL.md`、`projects/project-e2e-minimal/` |

**耦合真相（修正口径）**：`src/qwenpaw` 里出现 `copaw` 字样的文件 42 个，但真正 `import copaw` 的只有 **14 个**，其中 **12 个是 fork 自己新增的文件**，只有 **2 个是对上游文件的侵入修改** —— `src/qwenpaw/app/routers/agents.py`、`src/qwenpaw/cli/doctor_cmd.py`。**本轮复核补上一处此前漏算的同类侵入**：fork 新增的 `src/qwenpaw/runtime_mode.py`（65 行 flavor 开关）被 **3 个上游自有文件** import（`app/_app.py`、`cli/main.py`、`cli/app_cmd.py`）→ **上游文件伸手进 fork 私有模块的总数是 5 处，不是 2 处**（详见 §8 已闭环 11、WP-01）。

这条很重要：**侵入点比表面数字小两个数量级（5 处而非 42 处）**，真正的成本在"61 个改动过的上游后端文件 + 83 个改动过的上游前端文件"要逐个判定存废，而不是在解耦本身上。**（本轮补测：这个"61+83"是**口径不全**的结果，全仓真实数字是 187 个上游自有文件，见 §2.1.1。）**

打包侧还有个好条件：两侧 `pyproject.toml` 都是 `packages = { find = { where = ["src"] } }`，`copaw` 本来就是和 `qwenpaw` 平级的独立顶层包，不嵌套 —— 搬到 `plugins/apps/<id>/` 主要是"移动 + 加清单"，不是拆骨肉。

### 2.1 D-8（不许挂 patch）的代价量化

按"新增行里 Copaw 关键词命中数"把 fork 在 61 个上游后端文件里的新增行分堆。**本节只覆盖 `src/qwenpaw` + `console/src`，是 §2.1.1 那个全仓口径的子集**；分堆规则本身（关键词命中数）的可靠性问题见 §8 未验证 10 与 §3.4。

> **本节数字本轮重测并修正过**：原记"8,122 行分三堆"用的是 `grep -c "^+[^+]"`，这个正则**会把新增的空行整个丢掉**（`+` 后必须再跟一个非 `+` 字符）。改成"`+` 开头且不是 `+++`"后，总量是 **9,303 行**（`git diff --numstat e111ec6f main -- src/qwenpaw` 对同 61 文件汇总 = 9,302 插入 / 1,996 删除；逐文件累加与汇总差 1，量级无关）。另外原来只有 `hits≥5` 与 `hits≤1` 两档阈值，**`hits` 落在 2–4 的文件哪一堆都没进**，本轮补成第四堆。复现脚本见附录。

| 堆 | 行数 | 文件数 | 处理 |
| --- | --- | --- | --- |
| **P1 Copaw 承载性**（hits ≥ 5） | **5,139** | 14 | 必须用原生接缝重表达，否则砍。**极度集中**：`app/routers/agents.py` 一家 4,239 行（占 82.5%、1,096 处关键词），其余 `config/config.py` 247、`cli/desktop_cmd.py` 216、`agents/react_agent.py` 76、`cli/doctor_cmd.py` 76、`app/channels/dingtalk/channel.py` 74、`agents/tools/file_io.py` 60、`app/_app.py` 54，余下 6 个文件 ≤25 行。**§2.3 拆开量过之后 `agents.py` 不是"一面硬的 patch"**，而是一层已抽到 `src/copaw` 外的服务门面；D-14 落定后它的语义残差**归零**（见 §2.3） |
| **P2 疑似改上游行为，且上游 v2 已删该文件**（hits ≤ 1） | **1,656** | 10 | **自动作废** —— 上游删了 `app/mcp/{stateful_client,watcher}.py`、`app/runner/*` 7 个文件、`app/routers/plan.py`，等于上游替我们做了裁决，无需决策 |
| **P3 疑似改上游行为，上游文件仍在**（hits ≤ 1） | **1,609** | 30 | 逐个裁决"砍 / 进 `copaw`"（**D-13 后不再把"走上游 PR 并等合并"列为选项**）。清单见下 |
| **P4 中间带**（hits 2–4，原分堆漏掉） | **899** | 7 | 本轮新识别，未逐条读过：`agents/utils/audio_transcription.py` 335、`app/mcp/manager.py` 194（**上游已删，可与 P2 同样作废**）、`app/migration.py` 159、`app/routers/workspace.py` 105、`config/context.py` 39、`app/workspace/workspace.py` 36、`agents/prompt.py` 31。WP-02 需给出归属 |

P3 里 ≥50 行的 7 个文件（合计 1,345 行，余 23 个文件 264 行）：

```
698 行  src/qwenpaw/app/routers/skills.py
221 行  src/qwenpaw/app/agent_config_watcher.py
134 行  src/qwenpaw/agents/utils/setup_utils.py
114 行  src/qwenpaw/providers/openai_chat_model_compat.py
 62 行  src/qwenpaw/providers/retry_chat_model.py
 59 行  src/qwenpaw/app/agent_context.py
 57 行  src/qwenpaw/app/routers/config.py
```

注意这 7 个文件在 v2 里上游也各自改了（属 §2 的 179 文件冲突面），所以搬运本来也不可行 —— D-8 在这里的代价接近于零。**P1 那 5,139 行的实际代价此前被高估**：§2.3 已把 `agents.py` 拆开量过，其余是转发层与私有命名空间；D-14 又把唯一需要手工合并的 4 条同名路径消成 0 条。剩下的未证明项只有 §8 提到的"重表达后行为等价性无法自动证明"，以及 P4 这 899 行还没读实现。

#### 2.1.1 P1 的**完整口径**：187 个上游自有文件，不是 61 + 83（本轮"以仓库实际为准"的**口径更正**，不是新发现）

**先说清性质**：187 这个数字 §2 的文件级差异行里**早就有**（`504 新增 / 187 修改`），分区表里也列了 `tests` 10 / `scripts` 10 / `.github` 4 / `website+deploy` 5。真正的问题是**分析口径与处置口径不一致**：§2.1 的四堆、WP-01/WP-08 的 Gate、§7 的红线，全都只数 `src/qwenpaw`(61) 与 `console/src`(83)，所以有 **43 个文件从来没进过任何判定清单**，其中 **13 个连分区表都没有**（根目录 9 + `console` 非 src 4）。改成全仓口径（`git diff --numstat e111ec6fb main` ∩ `git ls-tree -r e111ec6fb`，即"merge-base 就存在且 fork 动过"的文件）后：

| 目录 | 上游自有文件数 | fork 新增行 | fork 删除行 | 此前状态 |
| --- | --- | --- | --- | --- |
| `console/` | 88 | 14,696 | 10,174 | 判定只覆盖 `console/src` 的 83 |
| ├ 其中 `package-lock.json` | 1 | 8,960 | 9,444 | 从未单列（机械差异，应排除语义行但仍计冲突） |
| ├ 其中 `console/src` | 83 | —— | —— | 已进入 §2.1 判定范围 |
| └ 其中 `vite.config.ts` 25/2、`package.json` 21/13、**`index.html` 12/2**、`tsconfig.app.json` 1/2 | 4 | 59 | 19 | **分区表与判定清单都没有** |
| `src/` | 61 | 9,302 | 1,996 | 已进入 §2.1 判定范围（四堆） |
| `tests/` | **10** | 307 | 11 | 分区表有 · **判定清单无** |
| 仓库根 | **9** | 291 | 83 | **分区表与判定清单都没有**（§2 只把它们当"新增散落文件"提过） |
| `scripts/` | 10 | 265 | 36 | 分区表有 · 判定清单无 |
| `website/` | 4 | 71 | 75 | 分区表有 · 判定清单无 |
| `.github/` | 4 | 29 | 2 | 分区表有 · 判定清单无 |
| `deploy/` | 1 | 1 | 0 | 分区表有 · 判定清单无 |
| **合计** | **187** | **+24,985** | **−12,377** | —— |

**即 43 个文件 / 约 1,000 语义行从未进过任何判定清单**（`package-lock.json` 那 8,960 行除外）。

**逐条归属前先把"这批是不是产品名 patch"测准**（本轮补测；上一版这里有三条**错判**，已纠正）：判定方法是对每个上游自有文件取 `--unified=0` diff，把删掉的含 `qwenpaw` 的行与加进来的含 `copaw` 的行做归一化配对（去掉 `(qwen|co)paw` 与空白/引号后逐字相等）= **纯改名对**；剩下含 `copaw` 的新增行 = **功能引用**（`import copaw`、转发到 `src/copaw` 等）。结果：**22 个文件有纯改名对，共 127 行；另有 36 行是功能引用**。

- **`pyproject.toml` +5/−0 —— 与产品名无关，上一版说它"证实了 entry-point 只能改这个文件"是错的。** 实测这 5 行是 4 行依赖（`networkx`、`duckdb`、`addict`、`datasets`）+ 1 行 package-data（`app/project_templates/**`），**0 个 copaw 字样**。而 `[project.scripts]` 里 **`copaw = "qwenpaw.cli.main:cli"` 是上游自己就发布的**（merge-base `:90` 与 `upstream/main:123` 都有，fork 一行没动），`[project.entry-points."qwenpaw.doctor"]` 的注释示例和"Legacy group `copaw.doctor` is still loaded"也是上游原文。**结论：CLI 命令名 = 零 patch 原生可得；doctor 注册要写的也只是这文件里 1–3 行加性声明。**
- **`deploy/Dockerfile` +1/−0、`.gitignore` +5/−1 —— 同样不是改名**：前者是 `ENV NODE_OPTIONS=--max-old-space-size=4096`，后者是 `test-results/`、`.vite/`、`.smoke-cognee-working/` 三个缓存目录。**0 个 copaw 字样。**
- **真·产品名 patch 的实测清单（127 行改名对，按面分类）**：
  | 面 | 文件 | 改名对 |
  | --- | --- | --- |
  | 文档 | `website/public/docs/cli.{zh,en}.md` | 47 |
  | 文档 | `website/public/docs/desktop.{en,zh}.md` | 22 |
  | 安装包 | `scripts/pack/desktop.nsi`（Windows 产品名） | 15 |
  | 打包/安装脚本 | `scripts/pack/build_win.ps1` 7、`build_macos.sh` 3、`install.bat` 4 | 14 |
  | CLI 自述文本 | `src/qwenpaw/cli/{init_cmd 7,desktop_cmd 5,main 2,update_cmd 1}.py` | 15 |
  | 内置 agent 默认文案 | `src/qwenpaw/app/migration.py`（`"Default QwenPaw agent"` → `"Default CoPaw agent"`） | 3 |
  | console 界面 | `layouts/constants.ts` 3、`Header.tsx` 1、`pages/Login/index.tsx` 1、`Chat/OptionsPanel/defaultConfig.ts` 1、`console/index.html` 1 | 7 |
  | README | `README{,_zh,_ja,_ru}.md` | 4 |
- **`console/index.html` +12/−2 的准确成分**：1 行改名对（`<title>QwenPaw Console</title>` → `CoPaw Console`）+ 1 行 favicon（`/online.svg` → `/copaw-icon.svg`），**其余 8 行加性是 Google Fonts 的 preconnect/stylesheet**，属样式而非品牌。
- **`console/src/i18n.ts` 的 36 行不是改名，是"把 fork 私有文案注册进上游文件"**：`import copawProjectsEn from "./locales/copaw/projects/en.json"` 这类，配套 fork 新增 `console/src/locales/copaw/{projects,pipelines,rpa}/*.json`（实测 18 个文件、+2,762/−0 纯新增，不计入 P1）。**这条是 D-15 认定合法后需要单列的一类：加性注册，不是改名。**
- **界面内文案 fork 其实一处都没改**：`console/src/locales/{en,zh}.json` 各有 +128 行纯新增（`nlpConfig`、`projects` 等新 key），**0 个 copaw/qwenpaw 字样**；而 v2 上游 locale 里的 QwenPaw 品牌字样是 **en 88 / zh 87 / ja 67 / ru 65 / pt-BR 65 / id 65 / vi 57 = 494 处**。即"界面内彻底改名"是 D-15 之后**新出现的工作面**，不是既有账。
- **`tests/unit/**` 10 个上游测试文件 +307/−11** —— 最该警惕的一批：fork **改了上游自己的测试**（`test_agents_ordering.py` +26/−1、`test_openai_provider.py` +38/−2、`test_app_startup.py` −1）。被改过的上游测试不再是"上游行为没坏"的独立证据，§8 未验证 8 说的"行为基线自己就不自洽"在这里有具体实例。
- **`.github/workflows/frontend-tests.yml` +10、`pr-under-review.yml` −2、`PULL_REQUEST_TEMPLATE.md` +16、`ISSUE_TEMPLATE/config.yml` +3**、**`Makefile` +5/−1**、**`CONTRIBUTING{,_zh}.md` +14**、**`scripts/**` 其余**（`scripts/README.md` +152/−1 是 fork 新写的说明，`install.ps1` +6、`install.sh` +3）—— 协作面的改名。

**处置（写进 WP-01 的 Gate）**：P1 的计数口径从"61 + 83"改为**全仓 187 文件**，并明确三条子规则：(a) `package-lock.json` 单列为机械差异，不计语义行数但必须计入冲突文件数；(b) `tests/` 里被 fork 改过的上游测试**优先恢复为上游版本**，因为它们污染的是本项目唯一的回归判据（D-13 后不能靠上游 PR 修正，只能自己还原）；(c) **按 D-15 的裁决把指标拆成两条**，见 §6 的 D-15 条与 §7 红线。账外这 43 个文件的逐条归属并进 WP-02 的矩阵（成为第 5 项必答）。

#### 2.1.2 树外 patch：fork 有一个 `postinstall` 在改写 `node_modules`（本轮实测，**任何计数都没覆盖它**）

`console/package.json:8` 有 `"postinstall": "node scripts/patch-chat-flushsync.mjs"`（fork 新增，+128 行新文件），脚本对 **`@agentscope-ai/chat` 这个第三方 SDK 的编译产物**做字符串替换：实测 **6 个目标文件、6 处 `ReactDOM.flushSync(...)` 包裹被拆平**（外加 3 处随之删掉的 `import ReactDOM`）。目标文件：`AgentScopeRuntimeWebUI/core/Chat/hooks/{useChatMessageHandler,useChatController}.js`、`AgentScopeRuntimeWebUI/core/Context/ChatAnywhereSessionsContext.js`、`ChatAnywhere/hooks/useSessionList.js`、`Bubble/hooks/usePaginationItemsData.js`、`Markdown/core/components/Link.js`。

四件事必须知道：
1. **这是 D-8 明文禁止的机制，而且现在活着。** §7 的"不许挂 patch"此前只被理解成"不改上游仓库文件"，所以 187 / 61 / 83 这些计数**天然看不见它** —— 它改的是 `node_modules`。真实的 patch 清单 = 187 个树内文件 **+ 这 1 个树外 patcher**。
2. **它会静默失效。** 脚本逻辑是：文件不存在 → `continue`；锚点字符串不匹配 → `continue`；只要有任一文件被"touch"但没改动 → 打印 `already applied` 并 **exit 0**。也就是说 **SDK 一升级、锚点对不上，它会报告"已应用"而实际什么都没做**，聊天渲染行为静默回到上游语义，且构建不报错。
3. **升级路径上必然踩到**：fork 钉的是 `@agentscope-ai/chat: ^1.1.64-beta.1779961389231`，`upstream/main` 钉的是 `1.2.0-beta.1789540479556`（**精确版本，无 `^`**）。迁到 v2 时编译产物换了一批，锚点失配是默认结果而不是小概率。
4. **顺带实测到一条 CI 硬冲突**：fork 的 `console/package.json` **没有 `test:coverage` 脚本**（merge-base 有 `test:run`/`test:coverage`，fork 删了，只留 `"test": "vitest run"`）。而 §2.2 记的 v2 `frontend-tests.yml` 正是跑 `npm run test:coverage` + coverage ratchet → **上游那个前端 CI job 对着 fork 的 console 根本跑不起来，不是"跑不过"而是"命令不存在"**。另外 fork 还把 `@agentscope-ai/icons` 从 `^1.0.67` **降级**到 `^1.0.63`、`@vitejs/plugin-react` 从 `^4.4.1` 升到 `^6.0.1`，两者都会在 v2 构建上产生额外摩擦。

**处置**：(a) `patch-chat-flushsync.mjs` 按 D-8 属于**必须消除**项，进 WP-08：先测 v2 的 SDK（1.2.0-beta）里 `flushSync` 这个性能问题是否仍存在；不存在则直接删脚本；仍存在则**不 patch**，改为在 Copaw 自己的组件层规避，或按 D-13 提一条**明确的 bug PR 给 SDK/上游**（这是 D-13 允许的那一类）。(b) 若短期内保留任何形态，脚本必须改成"锚点失配即 exit 1"，把静默失效变成构建失败。(c) `test:coverage` 脚本要在 WP-08 里补回来，否则 WP-08/11 的"CI 绿"Gate 无法执行。

### 2.2 D-4 实测结论：CI 不是"可能不绿"，是**从未跑过 Python 测试**（2026-09-29 全部本地复现）

**远端事实**（`gh run list` / `gh workflow list`）：

| 观测 | 值 |
| --- | --- |
| 最近一次任何 workflow run | 2026-08-02（`Full Tests Nightly`），**failure** |
| 该 nightly 连续失败 | 至少 2026-07-09 → 08-02 每天一次，全部 failure |
| `Full Tests Nightly` 当前状态 | **`disabled_inactivity`**（被 GitHub 自动停用） |
| 最后一次 `push` 触发的 run（main，2026-06-03） | Unit Tests **failure**、Contract Tests **failure**、Integrated **failure**、Frontend Tests **failure**、NPM Format **failure**、E2E Smoke **success** |
| `main` 最后一次提交 | `a0002eaaa` 2026-06-03 |
| 上游 `agentscope-ai/QwenPaw` 同期 | 2026-09-29 的 Tests / Frontend Tests / NPM Format / CodeQL **全部 success** |

最后一行是关键：**红是 fork 造成的，不是 runner/密钥/基础设施问题**，不能外包给环境。

**失败的真正位置在 pytest 之前**：`tests.yml` 的每个 job 第一步都是 `cd console && npm ci && npm run build`，而 `build = tsc -b && vite build`（`console/package.json:9`）。tsc 先炸，于是 **Unit / Contract / Integrated 三个 job 一次都没有执行到 pytest**。

**本地复现的完整数字**（这是本项目第一次拿到它们）：

| 层 | 实测 | 归属拆分 |
| --- | --- | --- |
| `console` `tsc -b` | **63 errors**（exit 2） | **58 在 fork 新增文件 / 5 在上游自有文件** |
| `pytest tests/unit`（强制越过收集错误） | **3069 passed, 90 failed, 5 skipped, 24 collection errors**，耗时 15m51s | 失败测试：77 在 fork 新增测试文件 / **13 在上游自有测试文件**；收集错误：22 fork 新增 / **2 上游自有** |
| `console` `vitest run` | **492 tests：465 passed, 27 failed**，10 个文件失败 | 全部集中在 `console/src/pages/Agent/Projects/tests/*`（fork 新增） |

**已经存在的 P1 破坏，有一条是可当场复现的**：

```
$ python -c "import qwenpaw.cli.cron_cmd"
ImportError: cannot import name 'validate_cron_trigger' from 'qwenpaw.app.crons.manager'
```

引入者是 fork 自己的提交 `9077dfb9c`（2026-03-14，"fix(cron): reject invalid cron expressions on write path, closes #1443"，**不是** merge-base 的后代）。被 import 的符号在本树的任何版本里都不存在 —— 上游 `v1.1.11` 与 `upstream/main` 的 `cron_cmd.py` 里 `validate_cron_trigger` 出现次数都是 **0**。配套的上游 PR `#1467 feat/upstream/cron-invalid-schedule` 已 **CLOSED 未合并**。
→ 结论：**`qwenpaw cron` 命令组在 fork 的 `main` 上是坏的，今天就是坏的**；而它之所以能坏 6 个月，正是因为上面那条链路（tsc 炸 → pytest 不跑 → 没人看见）。这是 D-8 想防的失效模式的实例，不是假设。

**对计划的直接改写**：

1. "先补 CI 再迁移"这个默认解读**是错的**。58/63 的 tsc 错误与 77/90 的测试失败都在 fork 自有文件里，而 §4/§5 的既定动作就是**不把这批 fork 前端文件带上 v2**。所以 CI 变绿是 WP-02/WP-09 的**结果**，不是它的前置条件。
2. 但反过来，**剩余那批红是真实欠债**：13 个上游自有测试失败 + 2 个收集错误 + 5 个上游文件 tsc 错误 = 当前"破坏 qwenpaw"的可度量积压。需要逐条归因（fork 改坏 vs fork 的半合并让测试与源码不自洽），`cron_cmd` 那条已证明至少有一类是前者。
3. 任何 Gate 里写"测试绿"之前，必须先有一个**只跑 pytest 的 job**（把 console 构建从后端测试里解耦）。否则"绿"永远取决于前端，而后端回归等于没有门禁。
4. **新发现的上游约束**：v2 的 `Frontend Tests` 跑的是 `npm run test:coverage`，且注释明写 "coverage **ratchet** blocks PR on regression"。所以 WP-08/WP-11 的前端工作量要含配套测试，不能只算页面代码。
5. `npm run build` 与 `format:check` 都含 `tsc -b`；fork 现有 63 个类型错误说明 fork 从来没有跑通构建门禁 —— 与 §2 的 187 个"改动上游文件"提交同源。

### 2.3 D-9 实测结论：`agents.py` 不是一个 4,239 行的 patch，而是一个**已经拆过一次的门面**

**裁决：D-9 的 (a)「照原语义搬进 PawApp router」/ (b)「按 v2 agents 语义重新设计」这个二选一，前提不成立。** 实测形状是：project 域的实现**早就在 `src/copaw` 里**，`agents.py` 只是转发层 + 路由表 + 模型定义。本节初稿曾得出"需要真正重新设计语义的只剩 3 个 guard 与 4 条路径"，**该残差已随 D-14 归零**（见下）。

**表 A — 文件内部构成**（`git show main:src/qwenpaw/app/routers/agents.py`，4,504 行；merge-base 同文件 600 行，v2 2,154 行。AST 统计，非行数估算）

| 组成 | 数量 | 行数 | 含义 |
| --- | --- | --- | --- |
| 模块级 `def` | 169 | — | |
| ├ `@router.*` 路由处理函数 | **44** | **1,193** | 真正的 HTTP 面（v2 同文件 17 个 / 1,010 行） |
| ├ **非路由的纯转发门面函数**（body ≤3 条语句且只调 `copaw.app.routers.project_*`） | **100** | **855** | 与上一行**互斥**计数；另有若干薄 handler 也属转发，已含在 1,193 内 |
| ├ 其余 helper 函数 | 25 | **1,120** | 本地工具函数 |
| 模块级 `class` | 44 | **385** | 其中 **42 个是 pydantic** 请求/响应模型 |
| import / 模块级常量前导段 | — | **952** | 21% 只是 import 与常量 |
| **合计** | | **4,505** | = 4,504 行内容 + 文件末空行；五类互斥，附录有 AST 脚本可原样复现 |

→ **只有 1,193 行（26.5%）是路由体**；其余 3,312 行是服务层门面、helper、数据模型与 import 段。这既解释它为什么长到 4,504 行，也解释它为什么**可搬**：搬运的主体是换前缀 + 删转发，不是重写。

**表 B — 37 条唯一路径的命名空间归属**

| 命名空间 | 条数 | 与 v2 的关系 |
| --- | --- | --- |
| `/{agentId}/projects/{projectId}/…` | **24** | v2 的 `agents.py` 14 条路径里**无一含 `projects`** → 私有命名空间，整体迁到 PawApp 的 `/api/{app_id}/…` 前缀后**零语义冲突** |
| `/square/*` | **6** | v2 无 `/square`；反哺 PR `#1883` 有 7 条 review 讨论仍 CLOSED（见 §2.4） |
| 共享域 | **7** | `''`、`/order`、`/{agentId}`、`/{agentId}/toggle` 四条与 v2 **同名**（曾被视为唯一真正的合并面，**D-14 后确认四条全部原样采用 v2 版本**，见下）；`/{agentId}/files`、`/{agentId}/files/{filename}`、`/{agentId}/memory` v2 无同名 |
| v2 独有（fork 缺） | **10** | `/memory/backends`、`/{agentId}/{backend-settings,model-settings,copy,pin}`、`/{agentId}/memory/{graph,status,reindex,reindex/undo,runtime-status}` —— 迁移时**必须原样保留**，这就是"不许破坏 qwenpaw"在本文件的具体清单 |

**硬残差：`system_protected` —— 已由 D-14 裁决为「砍」（2026-09-29）**

- **D-14 内容**：内置 agent 采用**与 upstream 一致的策略** = 不做删除/改名/停用保护。所以 `system_protected` 连同 4 个文件里的全部落点**整体删除**，**不进 §6.1 例外清单**（例外清单仍是 2 个前端文件，不扩到后端）。
- 实测落点（`git grep -c system_protected main -- src/qwenpaw`）：`config/config.py` 2（上游文件）、`app/migration.py` 6（上游文件）、`app/routers/agents.py` 9（上游文件）、`app/builtin_agents.py` 1（fork 新文件）—— 三个 guard 分别在 `agents.py:3320`(`update_agent`)、`:3365`(`delete_agent`)、`:3407`(`toggle_agent_enabled`)。`git grep system_protected upstream/main -- src/qwenpaw` = **0 命中**；v2 的 `routers/agents.py` + `config/config.py` 对 `protected|is_builtin|readonly` 同样 **0 命中**。
- **前端残差 = 0**（比本节初稿的判断更好，是本轮实测出来的）：消费 `system_protected` 的唯一 UI 是 `console/src/pages/Settings/Agents/components/AgentTable.tsx`（`:47` 用它置灰删除/停用、`:182` 渲染 blockedReason）。该文件 **merge-base 有、`upstream/main` 已删**（v2 换成 `AgentGallery.tsx` / `AgentBackendFields.tsx` / `useAgents.ts` 一套），且 **v2 整个 `console/src` 对 `is_builtin|builtin_kind|builtin_label|system_protected` 命中数 = 0**。→ 采纳 v2 后保护 UI 随宿主文件一起消失，**零前端改动**，也不会留下"按钮能点但后端报错"的半保护态。
- **表 B 那 4 条同名路径的残差因此消解。** 去掉 guard 后逐条 diff fork vs v2 的 handler，fork 独有的行只剩 (i) `load_config()`/`save_config()` 的同步写法（v2 用 `await run_sync_io(…)` + `mutate_config` 原子重读改写）、(ii) `_normalized_agent_order`（v2 用 `_display_agent_order` + pin 次序校验）、(iii) 随 guard 一起删掉的 `raise` 文案行。**fork 在这 4 条路径上没有任何 v2 缺失的行为** → 一律**原样采用 v2 版本**（v2 反而更强：`delete_agent`/`toggle_agent_enabled` 有 409 "still starting"、`list_agents` 有 startup status、`update_agent` 有 backend/mail 校验与回滚快照）。于是本节此前写的"**3 个 guard + 4 条同名路径**"变成 **0 条需要手工语义合并的路径**。
- **同一处上游 schema 还剩 24 行不在 D-14 管辖内**（转 WP-02，别当成已解决）：`config/config.py` 的两个 hunk `@@ -1070,0 +1071,16 @@ class AgentProfileRef` 与 `@@ -1108,0 +1125,16 @@ class AgentProfileConfig` = **32 行 = 4 字段 × 2 个类**，其中 `system_protected` 占 8 行、`is_builtin`/`builtin_kind`/`builtin_label` 占 24 行。后三者是**展示元数据**（"内置"标签、QA/Understand 分类），D-14 不管辖，但它们同样是**对上游 pydantic 模型的加性 patch**（同违 D-8，计入 §2.1 的 P1 堆）。
  - 零 patch 表达是可行的（已验证）：fork 有 `app/builtin_agents.py`（164 行，**fork 新文件**，merge-base 与 v2 均无）持静态 spec 表，含 `:163 is_builtin_agent_id(agent_id)`、`:30-31 builtin_kind/builtin_label`。而 `is_builtin` 的**全部读取点**只有两处 —— `agents.py:2769-2795` 的响应组装、`migration.py:824-841` 的幂等检查 —— 两处都能按 agent_id 从 spec 表派生，**不必持久化进上游 schema**。
  - v2 侧的对应概念是 `template_id`（`v2:agents.py:486-489` 有 `pawapp:` 前缀语义；`v2:config.py:2330` "Builtin template used when this agent was created"）：上游用"这个 agent 由哪个模板/PawApp 产生"表达内置来源，而不是用布尔保护位。→ 内置标签若要保留，原生落点是 `template_id`，不是新字段。
  - → WP-02 对这一行必须落 `原生`（改走 `template_id`）或 `CUT`（不显示内置标签），**不许**继续往 `config.py` 加字段。
- 已证伪的原生接缝（保留原记录，说明为什么 D-14 的动作是"砍"而不是"换个地方实现保护"）：PawApp 的 `middleware(factory, priority)` 是 **AgentScope 运行时中间件**（`pawapp/app.py:486-494` 的 docstring + `:816-819` 注册进 `api.register_middleware`），不是 ASGI/HTTP 中间件，拦不住上游自己的 `DELETE /api/agents/{id}`；`hook(phase)` 同域。用 Copaw 同名路由去遮蔽上游路由属于"改 qwenpaw 行为而不留痕"，违 P1/P2 精神，不算接缝。
- **明确接受的代价**：切到 v2 后，Copaw 的内置 agent（QA + 6 个 Understand-*，即 `builtin_agents.py` 的 spec 表）**可被删除、改名、停用，且删除不可恢复**（v2 的 `delete_agent` 只做 `del config.agents.profiles[agentId]` + 次序归一）。这与上游行为一致，是 D-14 的明文后果，不是待修缺陷。

**对工时与 §2.1 的改写**

1. **WP-06 从 3–6d 降到 2–3d**：24 条 project 路径的实现已在 `src/copaw/app/routers/` 的 10 个 `project_*` 服务模块里，重表达 = 换前缀 + 删 855 行转发。
2. **§2.1 的"真正的代价集中在 4,440 行的重表达"要下调**：其中 855 行是纯转发门面、1,193 行是含大量私有命名空间的路由体、42 个类是模型。**D-14 落定后，本节初稿说的"3 个 guard + 4 条共享路径"进一步归零** —— 4 条同名路径全部原样采用 v2 版本，`agents.py` 这个文件**不再有任何需要手工语义合并的点**，它整体退化为"私有命名空间的路由体 + 该删的转发层"。D-9 的不确定性主要来自"没读过这个文件"，现已消除。
3. `src/copaw` 的真实体量：81 个文件 / ~407 KB，其中 **25 个是 `from qwenpaw…import *` 再导出壳、56 个是实现**（最大 `copaw/app/routers/knowledge_hanlp_tasks.py` 56.6 KB）。WP-04 的 5–8d 不变，但"copaw 是兼容包"这个说法只对那 25 个壳成立。
4. `import copaw` 这一侧仍然干净：`src/qwenpaw/**` 里 import copaw 的文件共 14 个，**12 个是 fork 新文件**，只有 `app/routers/agents.py`、`cli/doctor_cmd.py` 是上游自有。（但"侵入 import 共 2 处"这个说法**不成立**，还有 3 个上游文件 import fork 新增的 `runtime_mode` —— 见 §8 已闭环 11 与 §4 该行。）
5. **自我更正**：本节前版记录"仅 295 行在路由处理函数内"，该数字来自错误启发式（多行装饰器被漏判）。AST 复核后的正确值是 **1,193 行 / 44 个 handler**。

### 2.4 反哺 PR 通道实测：D-8 的"走上游 PR"这条退路**经验上不存在**

对 `agentscope-ai/QwenPaw`、author `futuremeng` 的全部 PR（`gh pr list --state all --author futuremeng`）：

| 观测 | 值 |
| --- | --- |
| 总数 / 时间窗 | **21 个**，全部开在 2026-03-12 → 2026-04-02 |
| MERGED | **1**（`#1480` fix(ollama): default to 127.0.0.1…，一个边界清楚的小 bugfix） |
| CLOSED 未合并 | **20** → 合并率 **4.8%** |
| 是否"无人评审" | **否**：`#1679` 17 条讨论、`#2374` 8 条、`#1883` 7 条，均有 review 活动后仍 CLOSED |
| feature 级 PR | `#1530` skills marketplace、`#1679` knowledge layer MVP、`#1883` agents-square —— **全灭**，而这三条正是 §4 里 knowledge / square / skills_market 三行"走上游 PR"的预设对象 |
| **按标题类型分**（本轮补测） | `fix(` 开头 **13 个 → 只合 1 个**；`feat(` 开头 **8 个 → 合 0 个**。唯一 merged 的 `#1480` 是"ollama 默认走 127.0.0.1"这种边界清楚的单点小 bugfix |

**结论 + D-13 裁决（2026-09-29）**：D-8 把失效模式写成"砍 / 走上游 PR 并等合并（期间该改动不存在）"，实测第二个选项与第一个**在结果上等价**。用户据此裁定 **D-13 = 不再提 PR，除非是明确的 bug**。落到本计划：

- **`上游PR` 从五态归属标签里移除**。归属判定只剩 `原生` / `copaw` / `DROP` / `CUT` 四态（§0.2、§4、WP-02 同步改写）。feature 类改动**不提 PR**：能原生就原生，不能就进 `src/copaw`，两者都不行就砍。
- PR 的**唯一**用途收窄为"**修 qwenpaw 自身的明确 bug**"。这类 PR 不承载 Copaw 功能，因此不存在"合并前功能缺失"的问题；它的价值是降低未来冲突面、让 sync 更便宜。§0.2 第 3 条与 §6.1 约束 2 按此改写。**但别高估这条窄通道**：按同一份数据，`fix(` 类 13 个也只合进 1 个（`#1467` 那类 bugfix PR 同样 CLOSED），所以 bug PR 也只能当"顺手清债"，**任何 Gate 与排期都不许把"上游会合"当作依赖**。
- **§6.1 那笔 patch 因此确定是永久税**（见 §6.1 约束 2）：不再存在"等上游合并 mode-registry PR"这条退出路径，`/wb` 的两个前端文件改动按**每次同步手工重放**来评估与承受。


---

## 3. 上游 v2 扩展契约（已读代码验证）

`src/qwenpaw/plugins/architecture.py` 的 `PluginType`：`TOOL / PROVIDER / HOOK / COMMAND / CHANNEL / MEMORY / FRONTEND / APP / GENERAL`。其中 `APP` 的定义就是 fork 需要的东西：

> *"A PawApp: a full app (backend router + UI page) authored with the PawApp SDK…"*

SDK 位于 `src/qwenpaw/pawapp/{__init__,app,agent,context,dependency,deps,service,task}.py`。`app.py` 上 `PawApp` 的注册面：

```
enable_standard_capabilities · route(path, methods) · include_router(APIRouter, **kw)
tool · command · middleware(factory, priority) · hook(phase, priority) · runtime_hook
on_install / on_launch / on_terminate / on_uninstall · on_workspace_created
skill_provider · prompt_section · agent_profile · managed_service · dependency · register
```

对 fork 最关键的三个能力，逐条对上：

| fork 需要的 | v2 提供的 | 证据 |
| --- | --- | --- |
| 自己的后端 router（11 个 fork-only router） | `include_router` / `route` | `pawapp/app.py` |
| HanLP / DuckDB / graph 常驻 sidecar | ~~`managed_service`~~ → **`dependency`（自定义 probe）**。`managed_service` 的公开契约是"常驻 loopback HTTP 服务 + `health_path`"，fork 的三种形态（HanLP 进程内单例 / siamese 按次 `subprocess.run` / DuckDB 进程内库）**全都不符合**，详见 §8 已闭环 13 | `pawapp/service.py:101-131`、`pawapp/dependency.py` |
| 扩展 `qwenpaw doctor` 的自检项（fork 为此改了 `cli/doctor_cmd.py` +76/−4） | **`qwenpaw.doctor` entry point（或 legacy `copaw.doctor` 组）+ `register_doctor_contribution(contrib_id, fn)` 程序化注册**；契约 = 接收 `DoctorRunContext(cfg, raw_cfg, cli_base_url, timeout, deep)`、返回 `list[str]` | `cli/doctor_registry.py:32-53,67-93`、`pyproject.toml:127-129` |
| pipeline 长任务 + 前端进度 | `TaskManager` + `SSEChannel`，`POST /api/pawapp/{app_id}/task`、`GET .../task/{id}/stream` | `pawapp/task.py` |
| 内置 agent 人设（fork 有 10 个 `PROFILE/SOUL.md`） | `agent_profile` + app 内 `agents/<name>/en/{PROFILE,SOUL}.md` | `pawapp/agent.py`、`plugins/apps/qwenpaw-data/agents/` |
| 独立 Python 依赖（HanLP/graphify 等） | `plugin.json` 的 `meta.runtime_dependencies.python_packages`；loader 给每个 plugin 独立 `plugin_runtime/<bucket>/site` 站点目录 + install lock | `plugins/loader.py:62-89`、qwenpaw-data `plugin.json` |

**同构先例**：`plugins/apps/qwenpaw-data` 自己就是"图库 + 外部 Python runtime + 独立 console + 后端 router"（带 `docker-compose.yml`、Neo4j/PostgreSQL、`backend/{main,runtime,bridge,engine_gateway}.py`、`ui/`）。fork 的 knowledge 层不是无家可归的怪东西，上游已经用同一形态收了一个更重的 app。

**契约漂移警告**：`architecture.py` 文档写 PawApp 由 `manifest.yaml` 描述，但现存三个 app 全部用 `plugin.json`，无一个 `manifest.yaml`。以 `plugin.json` 为准。

### 3.1 隔离与挂载的实际语义（已读 `module_isolation.py` / `loader.py:515-640` / `pawapp/app.py:770-795`）

- **隔离是"带全局兜底的重定向"，不是沙箱。** 插件 backend 在私有顶层命名空间 `plugin_<id>`（`-`→`_`）下执行，`search_paths = [entry 文件所在目录, 插件根目录]`。裸绝对导入 `import X`：X 在 `search_paths` 里找到 → 重定向为 `plugin_<id>.X`；**找不到就原样落回标准导入机制**，stdlib / 第三方 / 全局已安装包行为完全不变（原文："Names not present in the plugin's directories fall through to the regular import machinery"）。
- `strip_plugin_sys_path` 只清理**插件自己目录下**的 `sys.path` 条目，加载结束即清扫；`sweep_bare_tree_modules` 只弹出 `__file__` 落在插件目录树内的残留模块。
- 对 fork 的直接含义：`import copaw.*` **两种摆放方式都能工作，一行导入都不用改** ——
  - **A 案**（`src/copaw` 留作全局顶层包）：不在 `search_paths` 内 → 落回全局机制，模块用普通 `__builtins__`，不受清扫影响。零改写、零隔离副作用，代价是这个私有顶层包进了发行物，**不可上游化**。
  - **B 案**（`copaw/` 移进插件目录）：被重定向为 `plugin_<id>.copaw.*`，同样零改写（重定向自动覆盖嵌套与函数级裸导入，靠 `PluginNamespaceFinder`）。
- **B 案只需付出一处代价**：全 fork 只有 **1 个**动态导入会被重定向漏掉 —— `src/copaw/knowledge/project_pipeline_manager.py:326` 的 `importlib.import_module("copaw.knowledge.manager")`（`importlib.import_module` 绕过 `__import__`，加载完成后 sys.path 已清扫 → `ModuleNotFoundError`）。改成静态导入即可。另两处动态导入是 `torch` / `modelscope`，第三方全局导入，本来就落回标准机制，安全。
- **另外两条已声明的隔离限制，实测打不到本 fork**：`src/copaw` 与 fork 新增的 `src/qwenpaw` 文件中 **pickle / joblib / dill / torch.save 命中数为 0**（"plugin 命名空间对象只在插件已加载的进程里可反序列化"这条不构成风险）；`tests` 里 **`patch("builtins…")` 命中数为 0**（"插件 `__builtins__` 是快照"这条不影响测试）。
- **多 router 支持，但前缀是硬约束**：`register()` 把 capability router、`route()` 用的 router、以及**每一个** `include_router()` 的 router 全部聚合进一个 `aggregate_router`，再以 `prefix=/{app_id}` 一次性 `api.register_http_router()`。即 **一个 app 只有一个 HTTP 前缀**。而且 `include_router(self, router, **kwargs)` 把 kwargs 吞掉了（带 `pylint: disable=unused-argument`）—— **`prefix=` 参数无效**，前缀必须写在 `APIRouter(prefix="/knowledge")` 里。fork 的 11 个 router 迁过去时这是最容易整片 404 的地方。
- **多页面**：`meta.pawapp.entry_page` 是单个字符串（一个 app 一个入口页）。子页面靠 `frontend_router` 的 `/{plugin_id}/files/{file_path:path}` 静态路由发多份 SPA 产物 —— qwenpaw-data 正是这么带 `data-console` + `context-console` 两个 console 的。fork 的 knowledge/flows/projects 跨多页，需要照这个模式做**一个 app 内多静态子应用**，或拆成多个 app。
- **版本区间不构成阻塞**：`_version_compat.py` 语义为 `>=min, <max`（`max` 缺省时由 `min` 推为 `{major}.{minor+1}.0`），但文件里明确写了 **"Upper-bound (`max`) enforcement is temporarily disabled"**。所以 `qwenpaw_version.max` 目前不会挡住 2.2.2b4。反过来说这条随时可能被上游恢复，声明 `max` 是个未来地雷 —— 建议放宽或只填 `min`。

### 3.2 前端原生扩展面（P2/P3 的落点，已读 `console/src/plugins/*`）

上游 console 内建了一套真正的前端插件运行时，**fork 的页面可以注册进原生 console，无需替换它**：

- `window.QwenPaw` 上暴露 `registerRoutes`、`registerToolRender`、`menu`、`route`、`slot`、`host`、`audit`、`memoryBackends`、`paw`。
- `PluginRouteDeclaration = { path, component, label, icon?, priority? }` —— **一条声明同时产生路由和侧边栏菜单项**，`priority` 控制排序。`addRoutes(pluginId, routes)` / `addToolRenderers(pluginId, renderers, {isBuiltin})`。
- 品牌与文案位（`registry/types.ts`、`chatExtensions.ts`，均为 `Localized<>` 多语言类型）：`header.leftTitle`、`header.leftLogo`、`header.leftHeader.render`（整段覆盖，优先级高于前两字段）、`theme.colorPrimary`、`welcome.{greeting,description,avatar,nick,prompts,render}`、`sender.{placeholder,disclaimer}`、`request.render`/`response.render`。
  **调用形态本轮读到实现确认**（`console/src/plugins/hostSdk/install.ts:80-115`，`QwenPawChatNamespace`）：`QwenPaw.chat.leftHeader.set(pluginId, {logo, title})`、`QwenPaw.chat.theme.set(pluginId, {colorPrimary})`、`QwenPaw.chat.welcome.set/render`、`sender.set/addPrefix/addSuggestion`、`actions.add`、`requestPayload.add`、`request.{render,prepend,append}`、`response.{set,render,prepend,append}` —— **每个都返回 `Disposable`**。上游自己的测试就是这套的可用性证明（`hostSdk/install.test.tsx:73-80` 断言 `set(partial)` 写入 `header.leftTitle`/`header.leftLogo`）。
  → **原则 3（产品名 Copaw）在 console 聊天界面内有现成原生接缝，完全不需要改上游 locales。**
  **但原则 3 的覆盖面到此为止**（本轮实测，见 §8）：v2 全库无 `branding`/`productName` 之类的品牌配置；品牌硬编码还留在 `console/index.html:10`（`<title>QwenPaw Console</title>` + `.qwenpaw-boot` 内联样式）、`pyproject.toml:2,4,82-84`（包名/description/Homepage）、CLI 帮助文本、Docker 镜像标签上 —— 这些位置**没有任何原生接缝**，改它们就是改上游文件。`document.title` 一侧较乐观：`ConsolePollService/index.tsx:22,31` 是把**挂载时的 `document.title` 原值**存进 ref 再做闪烁，所以插件在它之前改写 `document.title` 理论上能生效，但**加载顺序未实测**。
- 另有加法型 slot（prepend/append）与 whole-section override 两档，粒度足够覆盖"在原生页面里插 Copaw 区块"。
- 静态资源经 `/{plugin_id}/files/{file_path:path}` 公开服务，且 `frontend_plugin.py` 文档明确写了这套是**故意免鉴权**以便"自定义登录页"也能加载插件 bundle —— 品牌整页替换也在上游的设想内。
- **备用整壳方案**（不属于原生路径，仅作退路）：`QWENPAW_CONSOLE_STATIC_DIR` 可整体替换 console 静态目录（`hub/static_files.py:88-98`，doctor 有专门检查项）。用它等于永久扛下"手动跟上游 1304 个 console 文件"的成本，**本计划不采用**，除非将来出现前端能力必须整壳才够用的确凿证据。

### 3.3 界面模式机制（原则 4 的约束来源，已读 `utils/navigationMode.ts` / `registry/sdk.ts`）

上游的两个界面**不是两份前端**，而是同一个 bundle 内按 URL 前缀切壳：

- `CONSOLE_BASENAME = "/console"`，`getRouterBasename()` 用正则 `/^\/console/` 判定；`isOsPath()` 判定 `/os` 与 `/os/*`；`BrowserRouter basename` 在 `App.tsx:443` 按此挂载。
- 默认界面 → `/console/*`；桌面模式 → `/os/*`。侧栏的 "Desktop mode" 入口做的是**硬导航**：`handleOpenDesktopMode = () => window.location.assign(getOsRootHref(...))`（`Sidebar.tsx:481`），即换 root，不是换主题。
- 代码里还有第三个面：`/hub/admin`（`App.tsx:247`）。所以"上游只有两个界面"这个前提在实现层已经不严格成立。

**已验证的原生接缝（2026-09-29 逐文件读 `upstream/main` 确认，行号为 v2）**：

- `QwenPaw.route` / `registerRoutes`：注册路由 + 侧栏菜单项（`PluginRouteDeclaration`）。
- `MenuItem`：`id / location / parentId / before / after / order / label / icon / route / href / visible() / isGroup / divider` —— 菜单树可分组、可排序、可条件显示。
- **`QwenPaw.route.replace(pluginId, targetId, component)`**（`registry/sdk.ts:38-45` → `store.ts:383-405`）：**对 `targetId` 没有任何白名单或校验**，纯 override 栈。`core.root`（`path:"/"`，`DefaultRedirect` → `/chat`，`layouts/registry/builtinRoutes.tsx:69`）可被插件替换 → **"Copaw 工作台作为默认落地"这条完全原生，零 patch。**
- `route.wrap(pluginId, targetId, wrapper)`（`store.ts:431-470`，`resolveAll` 在 `store.ts:578-600` 用 `wraps.reduce` 组合，后注册的包在外层）。
- Slot：`header.left*`、`header.rightHeader`、`sider.bottom` + chat 域 scalar/list 位。**宿主实际渲染的 `<Slot>` 只有 7 个**（实测 `git grep -o 'Slot name="…"'`：`content.statusBar`、`header.left`、`header.logo`、`header.right`、`overlay.global`、`sider.top`、`sider.bottom`）。`SlotName = string`（`types.ts:144`）看似开放，但**没有 shell 级 slot** —— 无法用 slot 摘掉 Sidebar/Header。

**不可原生的部分（已穷尽验证，撞上 D-8）**：v2 的 chromeless 页面**只有三个，且全部由宿主硬编码**，插件拿不到第四个：

- `App.tsx:429-479`：`osActive = isOsPath(window.location.pathname)` 为真时**整棵 `routedContent` 换成 `<DesktopOSPage/>` 且挂在 `BrowserRouter` 之外**；否则 `/login`、`/hub/admin` 是显式兄弟路由，其余全部落 `path="/*"` → `MainLayout`。所以任何 `route.add` 的新路径都在 `MainLayout` 的 `<Routes>`（`MainLayout/index.tsx:73-81`）里，**必然带 Sidebar+Header**。
- `MainLayout/index.tsx:35-53` 里上游**自己**就有"按选中路由换壳"的先例：`selectedKey === "core.settings-center"` 时隐藏 `Sidebar`。但那个 id 是硬编码常量，插件改不动（改掉它 = 破 P1，会毁掉上游 Settings Center）。
- PawApp 前端被**双重收紧**：`pawapp-sdk/ui.tsx:120-138` 硬抛错 "PawApp page path must stay under /apps/{appId}"；`MainLayout/index.tsx:42-45` 又把 `/apps/<id>` 形状的路径从渲染里过滤掉，App Center 用 `pages/AppCenter/index.tsx:335-352` **内联渲染**（不是 iframe）。后端侧也封死：`plugins/registry.py:274` 把 `register_http_router` 硬拼成 `/api{prefix}`，`register_middleware`（`plugins/api.py:644`）是 AgentScope 请求级中间件、不是 ASGI，**插件无法 mount 顶层路径**。
- 结论：**"与 `/console`、`/os` 平级的第三个 chromeless root" 必须 patch `console/src/App.tsx` + `console/src/utils/navigationMode.ts`，没有原生替代路径。** 这条已从"待验证"变为"已证伪原生可行性"。

> 一个已由实测消解的顾虑：**新顶层 URL 不需要任何后端改动**。`hub/control_app.py:1830-1841` 的 `@app.get("/{path:path}")` 对所有非 `api/` 前缀路径回落 `index.html`，所以 `/wb` 直接命中同一个 bundle。patch 面纯前端。

**原则 4 的三种落地形态（D-10 已裁决为形态 3，见 §6）**：

| 形态 | 做法 | 碰上游文件？ | 代价 |
| --- | --- | --- | --- |
| 1：工作台 = console root 下的全屏路由 | `route.add` + `route.wrap` 壳 + 菜单/切换器落 slot | 否 | 带 console Sidebar/Header，不是独立"模式"；只能用 `menu.replace(..., visible())` 有条件地收起部分条目 |
| 2：整个 console 换成 Copaw 自建面 | `QWENPAW_CONSOLE_STATIC_DIR`（`hub/static_files.py:88-99`） | 否（是原生 env 位） | **淘汰**：整站替换上游 console，直接违反 P1 |
| **3：工作台 = 第三个平级模式 root `/wb`** | patch 2 个上游文件加 `isWorkbenchPath` + 一个 `workbenchActive` 分支 | **是，D-8 首个例外** | 见 §6.1 例外条款；结构性与上游 `osActive` 同形，可加性 patch |

### 3.4 `copaw` 在上游不是空命名空间 —— 它是上游自己的**遗留名**（本轮"以仓库实际为准"实测）

配置里 `upstream` remote 指向 `agentscope-ai/CoPaw.git`，`agentscope-ai` remote 指向 `agentscope-ai/QwenPaw.git`；`agentscope-ai/main`(`2d9527bb0`) 是 `upstream/main`(`70715e982`) 的**严格祖先**（`rev-list --left-right --count` = `0 1197`），`upstream/main` 的 reflog 是连续 fast-forward（`2cce9b129 → 2d9527bb0 → a51445f5f → e111ec6fb → 70715e982`）→ **两个 remote 是同一个仓库**，`CoPaw` 这个名字在上游侧被 GitHub 解析。**结论：上游在被叫做 QwenPaw 之前就叫 CoPaw，`copaw` 是上游的遗留命名层，不是无人认领的命名空间。**

`upstream/main` 里 `copaw` 的**功能性**存在（不是拼写巧合）：
- `constant.py:82-94` —— `WORKING_DIR` 优先级：**若 `~/.copaw` 存在则固定使用它**，否则 `~/.qwenpaw`；`QWENPAW_*` 环境变量带 `COPAW_*` 透明 fallback（merge-base 同款逻辑，fork 未改动）。
- `config/config.py:3984-4008` —— 上游**自带**从 `~/.copaw` 迁移 `sessions/memory/jobs.json/AGENTS.md/SOUL.md/PROFILE.md` 到默认 workspace 的代码。
- `cli/doctor_registry.py:70` —— 同时发现 `qwenpaw.doctor` 与 **`copaw.doctor`** 两个 entry-point 组。
- `cli/doctor_checks.py:63` —— `_QWENPAW_LOCAL_PROVIDER_IDS = {"qwenpaw-local", "copaw-local"}`。
- `app/routers/git.py:76`、`checkpoints/policy.py:77` —— 元数据文件名 `copaw_file_metadata.json`。
- `pawapp.py:177`、`console/.../PawApps/index.tsx:68` —— PawApp 安装目录 `~/.copaw/apps`。
- 界面品牌仍是 **QwenPaw**：`config.py:117 PROJECT_NAME = "QwenPaw"`、`console/src/layouts/AppBrand.tsx:300 alt="QwenPaw"`、`README.md` 标题 `# QwenPaw`。

**对本计划的三条影响**：
1. **原则 3 的定位要改口径**：Copaw 不是"fork 起的新产品名"，而是**上游的前身名**。界面内把它改回来（`header.leftTitle/leftLogo`）依然原生可做，但要清楚这是在**覆盖上游自己的名字**，不是填一个空位；而 `pyproject.toml name = "qwenpaw"`、`PROJECT_NAME`、README 在 v2 里同样没有任何接缝（§8 已闭环 9 不变）。**D-15 已裁："没有接缝"不等于"不改" —— 这些位置按 P1-命名册承认并治理（封闭清单 + 可机械重放），只有 `[project] name` 因牵连打包与 entry-point 分组而暂不动（§6 D-15 条第 5 点）。反过来说，D-15 想要的命令名与数据目录命名上游已经原生给了（`[project.scripts] copaw`、`COPAW_*`、`~/.copaw`、`copaw.doctor`），这些地方**不该出现在任何册子里**。**
2. **利好：数据目录兼容是上游原生行为，不需要 fork 写迁移。** fork 私有数据目录 `agents_square/`、`custom_channels/`、`hanlp_sidecar/`（`git grep 'WORKING_DIR / "<dir>"'` 实测：main 有、v2 命中 0）与 v2 无重名冲突；v2 原生就优先读 `~/.copaw`，所以 v1→v2 的用户数据落在同一路径上。WP-10 的"切主"因此在数据层面**不需要 patch、不需要自研迁移器**。唯一要实测的是 `~/.copaw/apps`（v2 新增的 PawApp 目录）与 fork 现有目录树并存时的行为。
3. **§2.1 的关键词代理指标有污染**：分堆用的正则里 `copaw` 在上游文件里本来就有命中（实测 `git grep -I -n -w -i copaw upstream/main -- src/qwenpaw console/src` = **66 行**），所以 `hits` 高不等于"Copaw 私有能力"，`hits=1` 的行也可能是上游遗留名的正常改动。P3/P4 的语义判定（WP-02）必须按内容而不是按这个词。

---

## 4. fork 资产 → v2 承接点映射


| fork 子系统 | 规模 | v2 承接方式 | 初判 |
| --- | --- | --- | --- |
| `copaw/knowledge`(29) + `qwenpaw/knowledge`(13) + `knowledge*.py` routers | ~45 | `include_router` + **`dependency`（自定义 probe）+ 进程内单例**；**不用 `managed_service`**（§8 已闭环 13：fork 无 HTTP sidecar，DuckDB 是进程内库，siamese 是按次子进程） | **高度契合**，但契合的是 dependency 面而非 sidecar 托管面 |
| `copaw/app/flow_engine`(5) + `flows.py`/`flows_global.py` | 7 | `include_router` + `task`/SSE | 契合 |
| project 控制面：`copaw/app/routers/project_*`(10 服务模块 + `project_file_ops`) + `coding_project.py`/`project_realtime.py` | `src/copaw/app/routers` 实测 13 个文件 = 10 `project_*` + 2 `knowledge_*_tasks.py` + `__init__.py`；`coding_project.py` 在 v2 已被删、`project_realtime.py` 是 fork 新增 | `include_router` + `on_workspace_created` | **先查重**：上游 v2 已有 `app/routers/project_directory.py`（**1,034 行、AST 实测 12 条路由**：`GET/PUT/DELETE /dirs`、`GET/PUT ""`、`POST /create`、`/clone`、`/import-local`、`/upload-zip`、`GET /browse-dirs`、`POST /browse-dirs/create`、`GET /list`；前缀 `/workspace/project-directory`，另有 `services/project_directory.py` **734 行**）；前端配套 `features/project-directory/`(1,357 行) + `ProjectSelectModal`(690 行) + `stores/projectDirectoryStore.ts`。**它与 fork 的 project 概念是否同一件事，是 WP-02 的第一个必答项**（§2.3 已证这 10 个模块是**实现所在**、`agents.py` 只是转发层，所以若判 `原生` 则本行是"换前缀 + 删转发"，若判重叠则可能是"并入上游 project-directory + 只补差集"，不是重写）。注：v2 同时**保留** `app/routers/workspace.py`，即 P4 堆里那 105 行不是自动作废项 |
| `agents_pipeline{,_core}.py`、`agent.py`、`sidecar.py` routers | 5 | `include_router` / `managed_service` | 契合 |
| builtin agent `PROFILE/SOUL.md`(10) | 10 | `agent_profile` + app `agents/` | 直接对应。**但见 D-14**：随迁的是 md 内容，`system_protected` 保护语义**删除**；同处的 `is_builtin/builtin_kind/builtin_label` 3 个上游 schema 字段改为由 `builtin_agents.py` 的静态 spec 表派生或改走 v2 的 `template_id`（§2.3），不再加字段 |
| `copaw/agents/memory`(4) | 4 | `PluginType.MEMORY`；上游已有 `plugins/memory/{adbpg,powercontext}` | **大概率 DROP**，先查重 |
| `skills_market/default.json`、`agents_square/default.json`、`module_skills` | 3 | `skill_provider` + 上游 `routers/market.py` | 概念重叠，需语义比对 |
| `console/src`（206 新 + 83 改） | **289** | **原生**：`registerRoutes` → 路由+侧边栏菜单；`addToolRenderers`；品牌走 `header.leftTitle/leftLogo`（§3.2） | **归属=原生**，那 83 个上游 console 文件改动默认**全部丢弃**，见 WP-08 |
| **5 处**侵入 import（原记 2 处，已由 §8 item 11 更正）：`import copaw` 落在 `routers/agents.py`、`cli/doctor_cmd.py`；`import runtime_mode`（fork 新增模块）落在 `app/_app.py`、`cli/main.py`、`cli/app_cmd.py` | 5 | copaw 侧改由 `hook(phase)` / `runtime_hook` 承接；`runtime_mode` 这个 flavor 开关**整体作废**（v2 无对应物也不该有） | **必须清零**，且 `runtime_mode` 优先级最高（它在 qwenpaw 启动主路径上）。**`doctor_cmd.py` 那一处已有零 patch 路线**（§8 已闭环 19）：把 `_check_hanlp_sidecar` 移进 `src/copaw`，由插件在 import 时调 `register_doctor_contribution()`，或声明 `qwenpaw.doctor` / `copaw.doctor` entry point —— 上游 `doctor_registry.py` 明写支持这两种方式 |
| `copaw/config`(3) + `qwenpaw/config` 改动(4) | 7 | plugin config + dependency probe | 需重写 |
| `scripts`(17/10)、`.github`(5/4)、`docs`(36) | — | **不迁移**，按需重建 | — |
| 根目录散落 20+ 文件 | — | 迁移时丢弃 | 见 WP-09 |

> 本表的"初判"是**待 §0.2 流程正式判定前的假设**。WP-02 的输出物必须给每行落一个归属标签，**四态**（D-13 后 `上游PR` 已从五态里删除）：**`原生` / `copaw` / `DROP` / `CUT`**，并给出依据（哪条注册方法够用 / 为什么不够）。没有标签的行不许进入 WP-04 之后的任何实现工作包。**唯一例外**：若某行判出来是"修 qwenpaw 自身的明确 bug"，才允许挂一条上游 PR，且该 PR 不得承载 Copaw 功能。

---

## 5. 工作包分解

时长按 1 名熟悉本 fork 的工程师估，给区间。括号内为阻塞它的前置。

### WP-00 冻结基线（0.5d）
打 tag + 保留现有 `backup/*` 惯例，不碰代码。
**基线的实际状态（2026-09-29 按"以仓库实际为准"复核，全部实测）**：`main` = `a0002eaaa`（2026-06-03），工作区干净、只有本计划文档未纳入 git；`main` 相对 `origin/main` 是 **3 ahead / 0 behind**，即 **v1 唯一兜底有 3 个提交从未推送**：`248e61b35`（refactor(projects)：文件树独立组件 + `TabbedEditor` 替换预览，8 文件 +1,797/−262）、`c5f04f83f`（feat(backend)：项目上下文注入 system prompt，7 文件 +216/−72）、`a0002eaaa`（fix：恢复误删的 `_register_hooks`，2 文件 +43/−3）。仓库里**不存在 `sync/v2` 分支**，`git log --all --grep=WP-`、reflog、dangling objects 全空 → **本计划没有任何 WP 已被执行**。
这 3 个提交触及 **4 个上游自有文件**（`console/src/api/authHeaders.ts`、`console/src/pages/Coding/TabbedEditor.tsx`、`src/qwenpaw/agents/react_agent.py`、`src/qwenpaw/app/routers/agent_scoped.py`），且这 4 个已在 §2.1 的 P1 61 文件 / `console/src` 83 文件计数内，**所以上述基线数字不变**；其余 10 个文件是 fork 自有路径（`console/src/pages/Agent/Projects/**`、`src/qwenpaw/app/project_context.py` 等，v2 下不存在）。
**Gate**：`git tag v1-fork-final-<date> main` 存在；那 3 个未推送提交已推到 `origin` 或另存 `backup/` ref（**tag 不够 —— tag 指向的提交本身还在本地，磁盘坏了就一起没了**）；本计划文档纳入 git（否则唯一一份迁移依据是未版本化的单文件）；`main` 明确标记为 v1 兜底不再前进。

### WP-01 建立 P1 不变式：`copaw` 可整体丢弃（**1.5–2.5d**，前置 WP-00；原估 1–2d，§2.1.1 的全仓口径 + `tests/` 还原 +0.5d）
**在 v1.1.11b1 基线上做**，不引入任何上游 v2 变更 —— 这一步在 v1 上做冲突为零，拖到 v2 上做就要同时对抗 1160 提交。
目标不是"顺手解耦"，是**验证原则 1/2 的下限**：把 `src/qwenpaw` 内 12 个 fork 自有 importer 移入 `src/copaw`，消除 **5 处**上游文件伸向 fork 私有模块的侵入（`import copaw`：`app/routers/agents.py`、`cli/doctor_cmd.py`；`import runtime_mode`：`app/_app.py`、`cli/main.py`、`cli/app_cmd.py`，其中 **`runtime_mode` 是本步的主目标** —— 它是 v1"一套代码两种产品"的 flavor 开关，位于 qwenpaw 启动主路径上，v2 无对应物，处置方式是**整体作废并把它承载的差异改用 PawApp 装载表达**），使 **`src/copaw` 成为可整目录删除而不影响 qwenpaw 启动与功能的独立包**。这是 `copaw` 长期存在（P2 第二类）的合法性前提。
另外新增一项**由 §2.2 逼出来的交付物**：把 `tests.yml` 里"每个后端 job 先 `cd console && npm run build`"的耦合拆开，加一个**只跑 pytest 的 job**。没有这一步，本项目所有 Gate 里写的"测试绿"都只等于"前端 tsc 过得了"，后端回归等于无门禁（fork 已经这样把 `qwenpaw cron` 的 ImportError 漏了 6 个月）。
**再新增一项由 D-15 逼出来的交付物**：把 P1-命名册做成**可机械重放**的资产 —— 用上面 Gate(a) 的配对脚本把 22 文件 / 127 行改名对导出成一份 `位置 → 替换对` 清单（落在 fork 自有文件里，例如 `scripts/copaw_brand.json` + 一个 apply 脚本），使每次跟进上游时"改名"是一条命令而不是人肉重打。**判定标准：清空 fork 的全部改名后重放该清单，`git diff` 与清空前逐字节相同。** 这条是 D-15 承认命名税之后唯一能让它不失控的做法；同时它会自动暴露"哪些改名上游已经原生给了"（如 CLI 命令名 `copaw`），那些条目应当被删掉而不是被重放。
**Gate**：`git grep -E "^(from|import) copaw|^from \.\.+runtime_mode|^from \.runtime_mode" -- src/qwenpaw` 命中 **0**；`src/qwenpaw/runtime_mode.py` 不存在或其消费点已全部移除；临时移开 `src/copaw` 后 qwenpaw 仍能起、上游测试仍全绿（P1 的直接证明）；`src/qwenpaw`/`console/src` 中被 fork 改动的上游文件数不增加；**pytest-only job 在 console 构建失败时仍然执行并出报告**；**本轮新增三条（来自 §2.1.1 与 §8 已闭环 19）**：(a) 计数脚本口径改为**全仓 187 文件**（`package-lock.json` 单列），基线记下来后只减不增 —— **且脚本必须自动把每个文件的 diff 拆成 `P1-行为` 与 `P1-命名` 两栏**（拆法见 §7：删掉的含 `qwenpaw` 行与加进来的含 `copaw` 行归一化后逐字相等 = 命名，其余 = 行为；当前基线 22 文件 / 127 行命名、其余为行为），两栏各自单独设"只减不增"的目标，命名栏按 D-15 允许持平但要求逐条可重放；(b) `tests/` 里那 10 个被 fork 改过的上游测试**还原为上游版本**（它们现在是唯一回归判据上的污点）；(c) `cli/doctor_cmd.py` 那 76 行改走 `register_doctor_contribution` / `qwenpaw.doctor`（未验证项 16 的时序与 pass/fail 缺口先实测，实测不过就按 D-8 砍这条自检）。

### WP-02 语义查重 + 归属判定（**3–4d**，前置 WP-00；原估 3–4d → D-13 使 `上游PR` 态消失后降到 2–3d → §2.1.1 的账外 43 文件与 §8 已闭环 18 的 project-directory 比对加回 1d）
只读上游，产出重叠矩阵：上游 v2 的 `project_directory.py` / `market.py` / `plugins/memory/*` / `pawapps.py` / `loops.py` / `harnesses.py` 是否已覆盖 fork 对应能力。**必须读实现，不能只比文件名**（第 4 节的判断目前只到文件名级）。
对每个 fork 能力跑一遍 §0.2 流程，落一个归属标签，**四态**（D-13 已删 `上游PR`）：**`原生`（写明具体用哪条注册方法）/ `copaw`（§0.2 第 4 条，写明为什么原生接缝不够）/ `DROP`（上游已有等价物）/ `CUT`（无接缝且不肯改成 copaw 形态，按 D-8 砍）**。
另外五件事必须在这一包里做完：
1. 对 §2.1 **P3 那 30 个文件（1,609 行，其中 ≥50 行的 7 个占 1,345 行）** 逐条签字：`CUT` 还是 `copaw`。**不再有第三个选项** —— D-13 后"提 PR 等合并"不是一个可落标签。
2. 对 §2.1 **P4 中间带那 899 行 / 7 个文件**（`audio_transcription.py` 335、`app/mcp/manager.py` 194、`migration.py` 159、`routers/workspace.py` 105、`config/context.py` 39、`workspace/workspace.py` 36、`agents/prompt.py` 31）补做同一套判定。这批此前根本没进任何一堆，是本轮重测分堆规则时翻出来的。
3. 对 §2.3 结尾那 **24 行 `is_builtin/builtin_kind/builtin_label`**（上游 `config/config.py` 的加性字段）判定 `原生`（改走 v2 的 `template_id`）或 `CUT`。
4. **（本轮"以仓库实际为准"新增）** 读 v2 `project-directory` 的实现语义（后端 12 条路由 / 1,034+734 行 + 前端 1,357+690 行，§8 已闭环 18），与 fork 的 24 条 `project_*` 路径、以及 fork **未推送**提交 `248e61b35` 新写的 1,432 行文件树/编辑面板代码做三方比对，产出"上游已覆盖 / 差集 / 冲突"三栏。**这一项直接决定 WP-06 与 WP-08 的形态，不能拖到实施时再说。**
5. **（本轮新增，来自 §2.1.1 的账外 43 文件；判定规则已由 D-15 定）** 给根目录与构建/文档/测试面的上游文件改动逐条落标签：`pyproject.toml` +5（**实测是 4 行依赖 + 1 行 package-data，不是文案**）、`console/index.html` +12/−2（改名对 1 + favicon 1 + Google Fonts 8）、`console/{package.json,vite.config.ts,tsconfig.app.json}` +47/17、`README{,_zh,_ja,_ru}.md` +262/−82、`CONTRIBUTING*` +14、`Makefile` +5/−1、`.gitignore` +5（缓存目录，非文案）、`.github/**` +29/−2、`scripts/**` +265/−36、`website/public/docs/*` +71/−75、`deploy/Dockerfile` +1（`NODE_OPTIONS`，非文案）、**`tests/unit/**` 10 个被改的上游测试 +307/−11**。这一批的标签现在只有三个合法值，**不再需要现场辩论**：
   - **P1-命名**（改名对/文案，D-15 承认）：进 WP-01 计数脚本自动配出的 22 文件 / 127 行封闭清单，逐条写明"重放方法 = 同一位置同一替换对"。
   - **P1-行为**（改依赖、改打包、改构建参数、改上游测试）：**目标仍是 0**，逐条判 `原生` / `src/copaw` / `CUT`；其中 10 个上游测试按 WP-01 Gate(b) 先还原。
   - **`原生`**（这一格里确实存在了）：凡"为了让东西叫 Copaw"而做的改动，先查上游是否已给 —— CLI 命令名、env 前缀、工作目录、doctor 分组都已原生存在（§8 已闭环 23），**这些的合法标签是 `原生（已满足，删除 fork 的重复实现）`，不是命名也不是行为**。
**Gate**：矩阵覆盖 §4 全部 12 行 + 上面 1–5 五项，无 `待定`；每行的 `原生` 判定都指到一条真实存在的上游方法（不许写"应该可以"）；`copaw` 判定逐条写明缺口。**这个 Gate 直接决定 WP-04…WP-08 的存废与形态，不许跳过。**
附带一项**几乎零成本但会翻出暗账**的对账：把 11 条本地 `feat/upstream/*` 分支与 §2.4 那 21 个上游 PR（20 CLOSED / 1 MERGED）逐条配对，标出"PR 已闭但分支代码从未进 `main`"的部分 —— 这些是既不在上游也不在主线上的**隐形丢失功能**，必须在归属判定前显式确认它们到底还要不要。**D-13 之后这批代码不存在"再提一次 PR"的处置方式，只能选保留进 `copaw` / 显式放弃。**

### WP-03 PawApp 骨架（1d，前置 WP-02、D-3）
`plugins/apps/<fork-app>/{plugin.json, backend/main.py, ui/, agents/}`：`type: "app"`、`entry.{backend,frontend}`、`meta.pawapp.{icon,entry_page,launch_scope,category}`、`meta.permissions`、`qwenpaw_version.{min,max}`。
**Gate**：在 `sync/v2` 分支上 loader 能列出该 app、healthcheck 通过、空页面能 launch。

### WP-04 knowledge 切片（**4–6d**，前置 WP-03、D-7；原估 5–8d）
`copaw/knowledge` + `qwenpaw/knowledge` → app backend；`knowledge.py`、`knowledge_models.py` → `include_router`，**且前缀写进 `APIRouter(prefix=…)` 而不是 `include_router(..., prefix=…)`**（后者被吞掉，见 §3.1）；随迁对应 `tests/unit`。
**本节原有一句"sidecar 用 `managed_service` + `dependency` 重写（不再自管端口与进程），现已作废**：§8 已闭环 13 实测 fork 的 `src/copaw` 里 **socket / bind / uvicorn / HTTPServer / 端口号命中数全为 0** —— 所谓"sidecar"是**另一个 venv 的解释器**（`.venv-hanlp` / `.venv-senta`），HanLP 走**进程内单例**、siamese 走**一次性 `subprocess.run`**，两者都不是 HTTP 服务，因此 `managed_service`（要求 `command` + loopback HTTP `health_path`）**形态不匹配、不该用**。替代做法：
- HanLP 运行时 → app backend 内保留模块级单例，用 `dependency` 注册一个自定义 probe（把现有 `sidecar.py` 的 ready/status 逻辑搬过去）。
- Siamese/UniNLU → 原样保留 ephemeral `subprocess.run`（300s timeout 的按次 worker），**这不属于上游的进程托管模型**。
- DuckDB catalog → 进程内库 + 文件布局，直接 `import`，无任何接缝问题。
**不需要任何导入语句改写**（§3.1 已证），只需处理 `project_pipeline_manager.py:326` 那一处动态导入 —— 若选 A 案连这处都不用动。
**Gate**：graph-query、NER、quantization 三条链路在 v2 端到端跑通，测试绿；每条 router 路由在新前缀下可命中（防前缀问题伪装成 500）；**且 `src/copaw` 内不得出现新的端口/进程自管代码（那是 managed_service 的形态，本 fork 不需要，出现即说明走错了接缝）**。

### WP-05 flow_engine + pipelines（3–5d，前置 WP-04）
`flows.py`/`flows_global.py` → `include_router`，pipeline 执行 → `task` + SSE 进度。
**Gate**：4 层引擎的 4 条 canonical flow 全部跑通，前端能看到进度事件。

### WP-06 project 控制面（**1.5–2d**，前置 WP-02 结论；原估 3–6d → §2.3 实测降到 2–3d → D-14 再降）
`copaw/app/routers/project_*`(10 个服务模块) + `project_file_ops.py` + `coding_project.py`、`project_realtime.py`。
**§2.3 已量过的实际工作形状**：24 条 `/{agentId}/projects/{projectId}/…` 路径的实现**已经在 copaw 侧**，`agents.py` 里那 100 个纯转发函数（855 行）+ 一批只调 copaw 的薄 handler → 本包 = 把这些服务直接 `include_router` 到 PawApp（前缀写在 `APIRouter` 上，见 §3.1）+ 删转发层，**不是重写**。
**手工合并面 = 0 条路径**（D-14 的直接结果）：原先认为要逐条手工合并的 4 条同名路径（`''`、`/order`、`/{agentId}`、`/{agentId}/toggle`）**一律原样采用 v2 版本** —— 实测去掉 `system_protected` guard 后，fork 在这 4 条路径上没有任何 v2 缺失的行为，只剩同步 IO 写法与 `_normalized_agent_order` 这类被 v2 的 `run_sync_io`/`_display_agent_order` 取代的实现（§2.3）。本包在 `agents.py` 上的动作因此是**纯删除**：删转发 + 删 3 个 guard + 删 `config/config.py`(2)、`app/migration.py`(6) 里的 `system_protected` 落点。
**`system_protected` 已按 D-14 砍**（内置 agent 与上游一致，不做删除/改名/停用保护）；同处的 `is_builtin/builtin_kind/builtin_label` 不属本包，转 WP-02 判定。
**Gate**：项目创建→文件树→artifact 观察 全链在 v2 跑通；且 v2 原生 agents 的 14 条路由（含 fork 没有的 10 条）逐条有回归用例证明未被改变；**并有一条测试证明 `git grep system_protected` 在 `src/` 下命中数 = 0**。

### WP-07 agent profile / skills / square 默认数据（1–2d，前置 WP-03）
10 个 PROFILE/SOUL → `agent_profile`；`skills_market`/`agents_square` 默认 JSON 视 WP-02 结论决定接上游 `market.py` 还是自带。

### WP-08 前端：以原生插件注册进上游 console（4–7d，前置 WP-04/05）
**策略已由原则 2/3 改写**：不整壳、不搬 diff、不 patch 上游 console，而是写成 `PluginType.FRONTEND` 插件，用 `registerRoutes` 把 Copaw 的页面注册进原生 console（一条声明同时拿到路由 + 侧边栏菜单项），工具气泡用 `addToolRenderers`，区块插入用 `slot`。
分三小步：
1. **品牌（原则 3）**：`header.leftTitle` / `header.leftLogo` / `theme.colorPrimary` 设 Copaw 名与标识。**`console/src/locales` 那 18 新增 + 6 改动上游文件全部丢弃** —— 走文案位是原生做法。
2. **Copaw 自有页面**：knowledge 浏览、pipeline/flow 控制、project 详情，各注册为 `/plugin/copaw-*/…` 路由。组件从 fork 的 206 个新增文件里**按需挑可复用的**移植（这些是 fork 自有文件，搬运不违反 P1）。
3. **上游页面内的增强**：用 additive slot / `request.render` / `response.render`，不 fork 上游页面组件。
**明确放弃**：fork 对上游 console 的 83 个改动文件默认全部丢弃（其中 8 个上游已删）。**D-13 已裁**：不属于"修 qwenpaw 自身明确 bug"的改动**不再提上游 PR**，也不在 fork 里挂 patch —— 所以这类改动按"该能力从此在 Copaw 里不存在"来评估与排期，**不要按"等上游合"排期**。（若某改动确实想留，唯一路径是改写成 `PluginType.FRONTEND` 插件或用 slot/品牌位重表达，即 §0.2 第 2 条。）
**并补一条来自 §2.2 的硬约束**：v2 的 `Frontend Tests` 跑 `npm run test:coverage` 且有 **coverage ratchet**（覆盖率倒退直接挡 PR）。本包与 WP-11 的估时**必须含配套前端测试**。D-13 后前端测试不再是"为了提 PR 而过门禁"，但它仍是本仓 CI 的唯一门禁（§2.2），不做就等于把 P1 的验证关掉。**本轮实测补一个前置事实**：fork 的 `console/package.json` **已经把 `test:coverage` 脚本删掉了**（merge-base 有，fork 相对 merge-base −1 处），只剩 `"test": "vitest run"` —— 所以那个上游 job 对着 fork 的 console 是"命令不存在"级别的失败，WP-08 第一步要把脚本补回来。
**新增一项必须处理的树外 patch（§2.1.2）**：`postinstall: node scripts/patch-chat-flushsync.mjs` 改写 `@agentscope-ai/chat` 的 6 个编译产物文件。迁 v2 时 SDK 从 `^1.1.64-beta.…` 换成 `1.2.0-beta.1789540479556`，锚点必然失配，而脚本失配时打印 `already applied` 并 **exit 0** —— 静默失效。**处置顺序**：先在 v2 的 SDK 上复现那个 `flushSync` 性能问题是否还在；在 → 不 patch，改在 Copaw 自己的组件层规避（或按 D-13 允许的范围提"明确 bug"的 PR）；不在 → 删脚本。无论哪种，保留期间脚本必须改成"锚点失配 exit 1"。
**`TabbedEditor` / 文件树独立组件重构：原写"先确认上游有无等价物"，本轮已按仓库实际确认，答案不是"有无"而是"上游更强"**（详见 §8 已闭环 17）：
- `TabbedEditor.tsx` 上游**有且已大改** —— v2 1,486 行 vs fork 1,017 行（`main` vs `upstream/main` = +314/−783），v2 还带 `TabbedEditor.test.tsx` + `TabbedEditor.copy.test.ts`。**按 D-8 用上游版本，fork 的改动丢弃。**
- 文件树：上游 v2 **已删** `console/src/pages/Coding/FileTree.tsx`(474 行) 与 `Coding/index.tsx` —— fork 从未改过这两个文件（所以它们不占 83/8 的账），但 v1 里唯一的文件树参照实现从此在上游消失；fork 未推送提交 `248e61b35` 新造的 `Agent/Projects/components/ProjectFileTree.tsx`(1,022 行) + `ProjectEditorPanel.tsx`(250) + `projectFileTreeUtils.ts`(160) ≈ **1,432 行 fork 自有新代码**，其上游对照物是 v2 的 `console/src/features/project-directory/SessionProjectDirectory.tsx`(**1,357 行**) + `components/ProjectSelectModal/index.tsx`(**690 行**) —— 量级相当、主题相同。**这必须进 WP-02 的查重矩阵读实现比对，不许默认保留。**
**Gate**：`console/src` 中被 fork 改动的上游文件数 = **0**（P1/P3 的可度量证明）；关键用户路径 e2e 通过；不重复实现上游已有 settings/console 组件；**`console/package.json` 里没有改写 `node_modules` 的 `postinstall`（§2.1.2）**；**`npm run test:coverage` 存在且能跑**（否则 WP-08/11 的 CI Gate 无法执行）。
> 说明：本包估时从 8–15d 降到 4–7d，是因为发现上游有完整的 route/menu/slot/品牌位注册面（§3.2），"重写整个前端"这个前提不成立。风险从工时转移到 §8 未验证项 1。

### WP-09 清理（0.5d，与 WP-08 并行）
不随迁移带入 v2：`tmp/*.py`(6)、`test_mcp_headers_debug.py`、`fork_issues.json`/`fork_prs.json`/`upstream_prs.json`/`upstream_issues.json`、`projects/project-e2e-minimal/`、根目录 `ROADMAP.md`/`SUPERSET_MCP_FIX.md`/`dual-track-sop.SKILL.md` 等已漂移文档。

### WP-11 Copaw 工作台（原则 4 / D-10 / D-11 / D-12；10–17d，前置 WP-08；编号接在末尾是为了不破坏前文交叉引用）
**不是仪表盘，也不是 Issue 列看板**：D-11 定为**工作台** —— 聚合「对话、文件、统计、知识、任务」五类对用户直接有价值的内容与操作的入口。它是 Copaw 的**默认落地界面**（D-12），上游默认界面与桌面模式降为次级入口。上游 `plugins/apps/agent-kanban` 是任务流转看板，**不构成复用对象**。

拆成两块，因为它们的合规性完全不同：

**WP-11a 壳与模式切换（2–3d，唯一的 D-8 例外落点）**
- 新增 `/wb` 为第三个 chromeless 模式 root，与 `/console`、`/os` 平级。§3.3 已证伪一切原生做法，所以这里是 patch：
  - `console/src/utils/navigationMode.ts`：加 `isWorkbenchPath()` / `getWorkbenchRootHref()`，与 `isOsPath`(`:29-33`) / `getOsRootHref`(`:70-72`) 同形。`getRouterBasename`(`:19-21`) **不动** —— 它的正则只认 `/console`，对 `/wb` 返回 `undefined` 正是想要的。
  - `console/src/App.tsx`：在 `osActive`(`:429`) 旁加 `workbenchActive`，把 `routedContent` 的三元式最外层加一个分支渲染工作台壳，结构与 `osActive` 分支（`AuthGuard useHardRedirect` + 挂在 `BrowserRouter` 之外）逐字对称。
  - 后端**零改动**：`hub/control_app.py:1830-1841` 的 SPA fallback 对所有非 `api/` 路径回 `index.html`，`/wb` 直接命中同一 bundle（§3.3）。
  - 工作台壳的 React 代码放 **fork 自有新目录** `console/src/copaw/workbench/`（新增文件，不计入 P1 改动数）。
- 三向切换：`/console/*` ↔ `/os/*` ↔ `/wb/*` 全是**硬导航**（沿用上游 `window.location.assign(getOsRootHref(…))`，`Sidebar.tsx:481` 是先例）。切换入口经原生 `menu.add` / `slot`(`header.right`、`sider.bottom`) 注册，**不在 patch 范围内**。
- 默认落地：`route.replace(copawPluginId, "core.root", 跳转壳)` 原生可达（`store.ts:383-405` 对 targetId 无校验）。在 `/console` 部署形态下命中 `core.root` 后做一次 `location.assign` 到 `/wb`，代价是一次重定向闪屏 —— 这是 D-12 与形态 3 交互留下的唯一体验税，需在验收时实测。
- **受鉴权主干影响**：`isLoginPath` / `getLoginHref` / `getPostLoginHref`(`:62-68` 现在只放行 `/os`) 都读同一文件。工作台若要在未登录时可被正确重定向，`getPostLoginHref` 必须放宽 —— **这是本例外里风险最高的一处**，必须配一条 characterization test 覆盖「登录 → 落在哪」。

**WP-11b 工作台内容（8–14d，全原生）**
- 五个入口的数据源：**不为工作台新开私有接口**。对话/文件/统计复用上游原生 router（`/chat`、`/files`、`/token-usage`、`/agent-stats` 对应的 API），知识与任务用 WP-04/05/06 已重表达的原生 PawApp router（`/api/{app_id}/…`）。
- 可复用的 fork 资产：`console/src/pages/Agent/Projects/ProjectDetailPage.tsx` 那套量化阶段/运行态展示逻辑（fork 自有文件，搬运不违反 P1）可拆成工作台卡片。
- 呈现层是 fork 自有组件树，只经 console 的 API 层取数，**不 import 上游内部组件**（上游私有组件无稳定性承诺，import 它们等于隐性 patch）。

**Gate**
1. `console/src` 上游文件改动数**只允许** = {`App.tsx`, `navigationMode.ts`} 两个，且改动**只增不扩**、与上游 `osActive` 分支同形；其余任何上游文件改动数保持 0。例外清单见 §6.1。
2. 每次跟进上游：这 2 个文件必须做三方比对，patch 若不能干净重放即视为**阻塞项**，不允许"先凑合"。
3. 三种界面来回切换不丢登录态/会话态（硬导航与 SPA 导航混用是已知风险面，必须有端到端用例）。
4. 工作台每块数据都能指到一条已注册的原生 router；工作台代码里出现 `import` 上游内部组件即违例。
5. `getPostLoginHref` 放宽后，上游"登录后落在 `/os`"的原行为必须有测试证明未被改变。

### WP-10 切主（1d + 观察期，前置 WP-04…WP-08）
`sync/v2` → PR → `origin`。`main` 保留 v1 兜底至少一个 release 周期。

**关键路径**：WP-00 → WP-01 → WP-02 → WP-03 → WP-04 → WP-05 → WP-08 → **WP-11** → WP-10。WP-06/07/09 可并行。
**总量**：含 WP-11（原则 4 / D-10 / D-12）后，主路径串行 **28–44 人日**（WP-00 0.5 + WP-01 **1.5–2.5** + WP-02 **3–4** + WP-03 1 + WP-04 4–6 + WP-05 3–5 + WP-08 4–7 + WP-11 10–17 + WP-10 1；WP-06 **1.5–2** / WP-07 1–2 / WP-09 0.5 并行，另加 WP-01 的 pytest-only job ≈0.5d）。**本轮"以仓库实际为准"把总量抬回 +1.5d**：WP-01 的全仓 P1 口径 + `tests/` 还原（+0.5d）、WP-02 的账外 43 文件与 project-directory 语义比对（+1d）。这是四次修正里第一次**上调**（前三次 D-9 / `managed_service` / D-13 都是下调），因为前三次修的是"估多了的能力项"，这次补的是"漏计的账"。
**D-15 的裁决给总量挂了一个条件项（尚未计入 28–44）**：界面内文案若按"可见品牌都叫 Copaw"彻底落地，需处理 v2 上游 locale 的 **494 处 QwenPaw 字样**（7 个上游 JSON）。**若 §8 未验证 19 验出运行时覆盖接缝 → +0.5d（写一个覆盖层）；若验不过、只能直接 patch 那 7 个文件 → +1–2d，并且这 7 个文件进 P1-命名册、每次跟进上游都要重放。** 这条在 WP-02 结束时定数，不在主路径估里凭空加。
**区间被收窄过三次（上一轮），本轮按仓库实际抬回 1.5d**：原估 30–51 → D-9 消解使 WP-06 从 3–6d 降到 2–3d（D-14 后再降到 1.5–2d，但它是并行包，不进串行主路径）→ `managed_service` 问题证伪使 WP-04 从 5–8d 降到 4–6d → **D-13 取消 `上游PR` 归属态使 WP-02 从 3–4d 降到 2–3d**（主路径因此 −1d）。**当前区间宽度已不再由 D-9 决定，而是由两处未验证项决定：WP-08/11b 的页面能否全走 slot（§8 未验证 7），以及 WP-11a 那三处未实测的鉴权/重定向行为（§8 未验证 15）。** D-10 已裁决为形态 3，其代价已从"工时区间"转成**永久的上游同步税**（§6.1，且 D-13 确认这笔税没有"等上游合"的退出路径）。

---

## 6. 决策状态

### 已关闭

| 编号 | 原决策 | 结论与依据 |
| --- | --- | --- |
| D-1 | 可上游化 vs 私有 overlay | **原生优先 + 可上游化**（原则 2），`copaw` 只兜底放不下的部分 |
| D-2 | 是否放弃 fork 的 console 改造 | 问题被原则 2 消解：既不整壳也不硬搬，而是 **`registerRoutes` 注册进原生 console**（§3.2）。83 个上游 console 改动默认丢弃 |
| D-3 | v2 基线 | **`upstream/main`（2.2.2b4）** —— 与上游节奏一致。**注意：原附带理由"反哺 PR 可直接合"已被实测推翻**（§2.4：本仓 21 个上游 PR 合并 1 个），基线选择本身不变 |
| D-5 | `copaw` 命名 | 原则 3 定为 Copaw → 包名保留。上游自己也留着 `copaw` legacy CLI 别名与 legacy `copaw.doctor` 入口组，不冲突 |
| D-6 | `copaw` 摆放 A/B 案 | 并入 D-7 |
| D-7 | "放到 copaw" 指包还是产品层 | **并存**：稳定的私有能力进 `src/copaw`（全局顶层包，零导入改写，可整目录丢弃），想反哺的进 `plugins/apps/copaw-*` |
| D-8 | 无接缝时能否挂 patch | **不许挂，宁可砍该功能**。代价量化见 §2.1 + §2.3 —— 原本以为代价集中在 `agents.py` 那 4,239 行新增，§2.3 拆开后它不含任何需要手工合并的语义（D-14 归零）；1,656 行因上游已删文件而自动作废，1,609 行分布在 **30 个文件**（≥50 行的 7 个占 1,345 行）上待 WP-02 逐条签字，另有本轮补出的 899 行中间带。**D-8 原本的退路"走上游 PR"已由 D-13 关闭 → 现在只剩"原生 / copaw / 砍"三种处置**。例外见 D-10 / §6.1 |
| **D-4** | 当前 fork CI 是否绿 | **已实测，答案比"不绿"更糟：CI 从未执行过一次 pytest。** 根因是 `tests.yml` 每个 job 先 `cd console && npm ci && npm run build`（`build = tsc -b && vite build`），fork 有 63 个 tsc 错误 → 构建先炸、三个后端 job 全数在测试前失败；nightly 已 `disabled_inactivity`。同期上游 CI 全绿 ⇒ 红是 fork 造成的。本地首次拿到完整数字（3069 passed / 90 failed / 24 collection errors，vitest 465/27）。**推论：CI 绿是 WP-02/09 的结果，不是前置条件**；但"先补一个只跑 pytest 的 job"变成 WP-01 的新增交付物。详见 §2.2 |
| **D-9** | `agents.py` 那 4,239 行新增的重表达深度 | **(a)/(b) 二选一前提不成立。** AST + 路径枚举实测：44 个 handler 只占 1,193 行；100 个非路由模块级函数（855 行）已经是**纯粹转发给 `src/copaw/app/routers/project_*`** 的门面；44 个类里 42 个是 pydantic 模型。37 条唯一路径中 **24 条 project + 6 条 square 是 v2 完全没有的私有命名空间**（迁到 PawApp 前缀零冲突），只有 4 条与 v2 同名；v2 反向有 10 条 fork 缺的路径必须原样保留。曾经认定的唯一不可重表达项 `system_protected` **已由 D-14 裁决砍掉**，于是同名 4 条路径也改为原样采用 v2 版本 → **手工语义合并面 = 0**。WP-06 因此从 3–6d → 2–3d → **1.5–2d**。详见 §2.3 |
| D-10 | 第三种界面做到哪一层 | **定为形态 3：`/wb` 与 `/console`、`/os` 平级**，明知需破 D-8。原由：形态 1（`route.wrap` 全屏路由）经 §3.3 穷尽验证**不能摘掉 Sidebar/Header** —— v2 的 chromeless 页面只有 `/login`、`/hub/admin`、`/os` 三个且全部宿主硬编码，`SlotName` 虽为 `string` 但宿主只渲染 7 个 `<Slot>` 且无 shell 级位，PawApp 路径被 `pawapp-sdk/ui.tsx:130-133` 与 `MainLayout/index.tsx:42-45` 双重锁在 `/apps/{id}` 下，后端 `registry.py:274` 把插件路由硬拼 `/api`。**原生做不到，不是没找。** |
| D-11 | "看板"指任务流转看板还是概览仪表盘 | **都不选，重定义为工作台**（对话/文件/统计/知识/任务的操作性聚合入口）。上游 `agent-kanban` 不是复用对象 |
| D-12 | 默认落地界面 | **Copaw 工作台**，上游界面降为次级入口。**这条原生可做**：`route.replace(pluginId, "core.root", …)`，`store.ts:383-405` 对 `targetId` 无白名单校验 |
| **D-13** | 反哺 PR 通道是否还算一条功能退路 | **定为：不再提 PR，除非是明确的 bug。** 依据（§2.4 实测）：本仓 21 个上游 PR 合并 1 个（4.8%），`fix(` 13 个合 1、`feat(` 8 个合 0，唯一合并的 `#1480` 是边界清楚的单点 bugfix，三个 feature 级 PR 均在有 review 讨论后 CLOSED。连带效果：§0.2 判定流程的 `上游PR` 态**删除**（五态→四态），§4、WP-02、WP-08 同步改写；PR 只用于"修 qwenpaw 自身明确 bug / 降低未来冲突面"，**不承载 Copaw 功能**；§6.1 约束 2 的"合并后 30 天摘除"经验上不会发生，改为按**永久 patch + 每次同步手工重放**评估。WP-02 因判定空间收窄从 3–4d 降到 2–3d |
| **D-14** | `system_protected`（内置 agent 禁止删除/改名/停用）砍还是留 | **定为：内置 agent 保留与 upstream 一致的策略 = 砍掉 `system_protected`。** 采纳上游原生行为：内置 agent **可被删除、改名、停用，删除不可恢复**，这是明文接受的代价，不是待修缺陷。实测落点与删除清单见 §2.3：`config/config.py` 2、`app/migration.py` 6、`app/routers/agents.py` 9（3 个 guard 在 `:3320/:3365/:3407`）、`app/builtin_agents.py` 1。**前端零改动**（唯一消费方 `AgentTable.tsx` 上游 v2 已删，v2 console 对这四个字段命中数为 0）。**§6.1 例外清单不因此扩展**，仍是 2 个前端文件、不含后端。同处的 `is_builtin/builtin_kind/builtin_label`（24 行上游 schema 加性字段）不受本裁决覆盖，转 WP-02 判定 |

### 6.1 D-8 例外条款（由 D-10 触发，目前唯一在册例外）

例外不是"允许挂 patch"的口子，而是一个**封闭清单 + 四条约束**。清单外的上游文件改动仍按 D-8 一律砍功能。**D-14 明确不扩清单**：`system_protected` 落在后端主干 3 个上游文件 + 上游 config 模型上，若为它开例外面，风险等级与本清单（前端壳 2 文件、纯加性）完全不同 —— 用户选择砍功能而不是扩清单。

**封闭清单（2 个文件，只做加性改动）**

| 文件 | 允许改什么 | 不允许碰什么 |
| --- | --- | --- |
| `console/src/utils/navigationMode.ts` | 新增 `isWorkbenchPath()` / `getWorkbenchRootHref()`（与 `isOsPath:29-33`、`getOsRootHref:70-72` 同形）；`getPostLoginHref:62-68` 的 `isOsPath` 判定放宽为"os 或 workbench" | `getRouterBasename:19-21`、`CONSOLE_BASENAME:7`、`isLoginPath:35-37`、`getLoginPath/getLoginHref` 一律不动 |
| `console/src/App.tsx` | 新增 `workbenchActive` 常量 + `routedContent` 三元式最外层一个新分支 | `/login`、`/hub/admin` 两条既有路由、`osActive` 分支体、`basename` 计算不动 |

**四条约束**
1. **加性 only**：只插入新行与新符号，不删除也不改写上游既有行的语义。违例判据：`git diff` 里对上游文件的 `-` 行数必须为 0。
2. **不提 PR（D-13 已裁）**：把 `osActive` 硬编码前缀换成模式注册表的那条 `feat(upstream/*): console: allow host-defined mode roots` 是架构正解，但 **D-13 定为 feature 类改动不再走上游 PR**（§2.4 实测 21 开 1 合），所以本条例外**没有"上游合并后摘除"的退出路径**：这 2 个文件的 patch 按**永久税**管理 —— 每次跟进上游手工重放，约束 3 就是它的执行机制。这与 D-8 不矛盾：D-8 禁的是用 patch 顶替"改上游行为"，这里是上游明确缺失的能力位，且代价已被显式登记与接受。
   > 留一句可逆性说明：若未来上游主动把 `navigationMode.ts` 泛化成注册表（无需我们提 PR），本条例外自然失效、应在 30 天内摘除。**但排期不许依赖这件事发生。**
3. **同步即阻塞**：每次跟进上游必须对这 2 个文件做三方比对，patch 不能干净重放时**停止同步**、先修 patch，不允许"先凑合跑"。
4. **永久税要写进 PR**：承载它的 PR 描述必须列明这 2 个文件的 diff 行数与所在函数，让每次评审都重新确认这笔代价。

**被这笔例外换来的东西**：URL 体现第三种模式、工作台可完全脱离 console chrome、与桌面模式切换体验同质。
**它额外引入的风险**：`navigationMode.ts` 位于鉴权/路由主干（`getPostLoginHref` 决定登录后落点），是 §2.1 认定的 P1 破坏风险最高的位置之一 —— 因此 Gate 3 与 Gate 5（WP-11）不是可选项。


### 仍然只能你定

**空。** 本轮"以仓库实际为准"开出的 D-15 已由用户裁决（2026-09-29）：

> **D-15（已裁）：可见品牌与分发物，包括命令等命名，都叫 Copaw。**

这条裁决**等于选项 (b) 并被用户加强**：产品名不再只到界面内，而是覆盖**可见品牌 + 分发物 + 命名**。于是 §7 的 P1 指标必须拆成两条（下面第 1 条），同时原则 2「原生优先」在命名这件事上**优先级更高** —— 因为实测发现**能零 patch 拿到的命名，fork 本来就有**：

1. **P1 拆成两个指标，各自单独考核**（这是 D-15 的直接后果，也是 WP-01 Gate 的新口径）：
   - **P1-行为（目标 0，硬约束不变）**：改变上游行为的 patch —— 逻辑、路由、算法、鉴权、上游测试文件。**只减不增，D-8 继续按字面管着这一类**，包括树外 patch（§2.1.2）。
   - **P1-命名（承认存在，但要治理）**：纯改名/文案。实测规模 = **22 个上游文件、127 行改名对**（分布见 §2.1.1 的表：文档 69、安装包与脚本 29、CLI 自述 15、console 界面 7、内置 agent 默认文案 3、README 4）。治理要求三条：**(a) 单列成一份封闭清单**，WP-02 第 5 项输出；**(b) 每条都必须可机械重放**（同一位置同一替换对），跟进上游时先重放清单再跑 diff；**(c) 只许减不许增的仍是 P1-行为**，命名面新增文件需要单独说明理由。
2. **命令与数据面的命名 = 零 patch，已经满足**（实测，别再挂 patch）：`[project.scripts]` 里 `copaw = "qwenpaw.cli.main:cli"` 是**上游自己发布的**（merge-base 与 `upstream/main` 都有，fork 一行没动）；`COPAW_*` 环境变量、`~/.copaw` 工作目录优先级、doctor 分组 `copaw.doctor`、`~/.copaw/apps`、`copaw_file_metadata.json` 同样全是上游原生。**WP-10 与 WP-01 里任何"为了叫 copaw"而做的兼容改动都应该删掉 —— 需要 patch 的只有自述文本（`cli/init_cmd.py` 等 15 行）这一类字符串。**
3. **界面内的可见品牌走原生，不走 patch**（原则 2）：logo / 标题 / 主色用 `QwenPaw.chat.leftHeader.set()`、`chat.theme.set()` 这类 hostSdk setter。`console/index.html` 的 `<title>` 与 favicon（改名对 1 行 + favicon 1 行）属"界面外"，按 D-15 保留在 P1-命名清单里。
4. **新增工作面（D-15 带来，此前不在任何账上）**：界面内文案 fork **一处都没改过**，而 v2 上游 locale 里的 QwenPaw 字样实测 **en 88 / zh 87 / ja 67 / ru 65 / pt-BR 65 / id 65 / vi 57 = 494 处**（7 个上游自有 JSON）。"可见品牌都叫 Copaw"若含界面内正文，这 494 处是新面。**路由为验证项而非决策项**（§8 未验证 19）：先验 v2 有没有运行时 override 接缝（`i18n.ts` 用 `createInstance` + `as const` 的 `localeLoaders`，实测**没有**插件注册翻译的入口；但 fork 已经在用 `i18n.ts` 里 import 私有 `locales/copaw/*.json` 的加性写法，能否顺势做 key 覆盖要实测），验不过再退回直接 patch 这 7 个文件并计入 P1-命名清单。
5. **`[project] name = "qwenpaw"` 暂不改**（分发物的包名）：D-15 说"可见品牌与分发物"，Windows 安装包（`desktop.nsi` 已改，15 行改名对）与 Docker 标签是可见分发物；而 pip 包名一改动会牵连 entry-point group、`pip install -e .` 路径与 v2 doctor 的分组发现，属 **P1-行为**风险。这条按"改收益小于风险"暂留在行为面归零的约束下；若你要把它也纳入命名面，需单独说一句。

历史脉络保留如下（都已生效，仅作追溯用）：

| 编号 | 状态 | 备注 |
| --- | --- | --- |
| ~~D-4~~ | **已闭环**（§2.2、已关闭表）。结论与"是否绿"这个问题本身不同：CI 从未跑到过 pytest | 已生效；新增 WP-01 交付物"只跑 pytest 的 job" |
| ~~D-9~~ | **已闭环**（§2.3）。二选一被实测消解；D-14 把最后的残差归零 | 已生效 |
| ~~D-10~~ | **已裁决为形态 3**，原生可行性已穷尽证伪（§3.3） | 已生效；例外治理见 §6.1 |
| ~~D-11~~ | **已裁决为"工作台"**，不是看板也不是仪表盘 | 已生效 |
| ~~D-12~~ | **已裁决为 Copaw 工作台默认落地** | 已生效，原生可做 |
| ~~D-13~~ | **已裁决：不再提 PR，除非是明确的 bug** | 已生效；§0.2 判定流程、§4、§2.4、WP-02、WP-08、§6.1 约束 2 均已按此改写 |
| ~~D-14~~ | **已裁决：内置 agent 与 upstream 一致 = 砍 `system_protected`** | 已生效；删除清单与后果见 §2.3，WP-06 工时随之下调 |
| ~~D-15~~ | **已裁决：可见品牌与分发物（含命令等命名）都叫 Copaw** | 已生效；等于把 P1 拆成 `行为`/`命名` 两个指标（§7、§2.1.1），并暴露 494 处界面内文案这个新增工作面（§8 未验证 19） |

**D-1…D-15 全部关闭，没有需要用户再签字的开放项。** 其余缺口都是**验证**：§8「仍未验证」那几条是执行层问题（能不能做到、代价多大），其中若干条会改变工时区间，不需要用户决策。D-15 的落地口径见上面「仍然只能你定」一节的 5 条（指标拆分、零 patch 命名已满足、界面内走原生 setter、494 处文案待验、`[project] name` 暂不改）。

---

## 7. 红线

- **（P1 / D-8）不挂 patch 顶替。** 无原生接缝的改动就是**不存在**：要么用原生接缝重表达，要么收进 `src/copaw`，要么砍。不接受"先挂上，以后再说"。这条是本次裁决最硬的一条红线，因为它同时是 P1 的保险和 fork 不再长回 1160 提交落后的保险。**"patch" 的判定范围含树外 patch**（§2.1.2：`console/package.json` 的 `postinstall` 改写 `node_modules/@agentscope-ai/chat` 就是违例，不因"没动仓库文件"而合法）。**唯一被 D-15 从这条红线里排除出去的是 P1-命名（纯改名/文案），它按 §7 P1 条的清单治理；行为面改动一律仍受本条约束。**
- **（D-13）不为 feature 提上游 PR。** PR 只用于**修 qwenpaw 自身的明确 bug**；任何"把 Copaw 功能送进上游以保住它"的 PR 都不再开（实测 21 开 1 合、feature 类 8 开 0 合，§2.4）。相应地，**任何排期都不许把"等上游合并"当作依赖**。
- **（D-14）内置 agent 不设保护。** `system_protected` 全线删除，Copaw 的内置 agent 与上游行为一致：可删、可改名、可停用。**不要**在后端路由或前端组件里私自恢复这层保护 —— 那是给已被裁决砍掉的能力挂隐式 patch。
- **（P1）不新增对上游自有文件的改动**：计数口径本轮改为**全仓**（§2.1.1：当前 **187 个上游自有文件**被 fork 改过，+24,985/−12,377；含 `src/qwenpaw` 61、`console/` 88、`tests/` 10、根目录 9、`scripts/` 10、`website/` 4、`.github/` 4、`deploy/` 1）。`console/package-lock.json` 单列为机械差异（不计语义行，但计冲突文件数）。
  **D-15 裁决后，这个指标拆成两条，各自独立考核，不许混算：**
  - **P1-行为 —— 只减不增，目标 0。** 改变上游行为的改动（逻辑、路由、算法、鉴权、依赖声明、entry point、**上游测试文件**）。任何一次提交让这个计数上升即违例，需在 PR 里显式声明。**唯一在册例外 = §6.1 封闭清单的 2 个文件，且只准加行**；清单外一律按 D-8 砍功能，不存在"再开一个例外"的流程。
  - **P1-命名 —— 承认存在，按清单治理。** 纯产品名/文案改动，实测当前 **22 个上游文件、127 行改名对**（§2.1.1 的分布表）。三条治理要求：单列成封闭清单（WP-02 第 5 项输出）、每条可机械重放、新增文件要在 PR 里单独说明理由。**它不是"自由增长区"**：D-15 裁的是"命名要 Copaw"，不是"可以顺手改上游文件"。
  - **判定归属的规则**：删掉的含 `qwenpaw` 行与加进来的含 `copaw` 行归一化后逐字相等 = 命名；否则 = 行为。这条规则要落进 WP-01 的计数脚本，不能靠人肉分。
- **（P1）不改上游自己的测试。** `tests/` 下那 10 个被 fork 改过的上游测试（+307/−11）是回归判据上的污点：D-14 之后本项目的"没破坏 qwenpaw"只能由上游测试证明，改过的测试证明不了任何东西。WP-01 里还原，还原后失败逐条归因（是 fork 真破坏了行为，还是 fork 有意改了行为而该行为已被 D-13/D-14 砍掉），**不许靠改测试让它们变绿**。
- **（P2）未落归属判定的能力不许开工**（§0.2 四态标签：`原生` / `copaw` / `DROP` / `CUT`）。"先 patch 一把跑通再说"是本 fork 走到今天 1160 提交落后的成因，不是效率手段。
- **（P3）产品名/Logo/主题只经原生品牌位设置**，不改上游 console 源码与上游 locales。
- **（原则 3 / §3.4）`copaw` 不是空位，是上游自己的旧名。** `~/.copaw`、`COPAW_*` env、`copaw.doctor` entry-point 组、`copaw-local` provider id、`copaw_file_metadata.json` 都是上游 v2 里的活代码。因此：(a) 不许把这些上游遗留标识当作"fork 私有符号"去改或删；(b) fork 新增私有标识时**不要**复用这些已有名字，避免与上游遗留层混淆；(c) 界面内改名是在**覆盖上游自己的名字**，措辞上别再声称"Copaw 是本 fork 的独立命名"；**(d) D-15 要的命令名上游已经给了**（`[project.scripts] copaw = qwenpaw.cli.main:cli`，merge-base 与 v2 都在），所以"让命令叫 Copaw"这件事**不需要也不允许**以任何 patch 形式实现 —— 只有自述文本（"QwenPaw 的命令行工具"这类字符串）才是改动面。
- **不把 `upstream/main` 一次性 merge 进 `main`。** 这是本计划否掉的第一个方案。
- **不 `reset --hard`、不 force push `origin/main`。** `main` 是 v1 唯一兜底。
- **临时探针/试验改动一律用 Edit 手工回滚，不用 `git checkout` 撤销** —— 本项目已因 `git checkout` 丢过一次未提交的 WP-09d 工作。
- 每个 WP 独立分支独立 PR，不合并成一个巨型 PR（巨型 PR 就是那个不可验证的 merge 的另一种写法）。
- 未验证的结论不写进任何 Gate 的通过依据。

---

## 8. 验证状态

### 已闭环（本轮读代码 + 实测确认，可作为执行依据）

1. ~~插件隔离要求改写绝对导入~~ → **不要求**。隔离是带全局兜底的重定向，`import copaw.*` 在 A/B 两种摆放下都零改写（§3.1）。B 案唯一代价是 `project_pipeline_manager.py:326` 一处动态导入。原先估的 2–4d **作废**。
2. ~~多 router / 多页面未验证~~ → 多 router 支持但**共享一个 `/api/{app_id}` 前缀**，且 `include_router` 的 `prefix=` kwarg 被吞（前缀必须写在 `APIRouter` 上）；多页面靠 `entry_page` 单入口 + `files/{path}` 静态子应用。**这是新发现的真实坑，不是未知。**
3. ~~版本区间谁来放宽~~ → `_version_compat.py` 明确 `max` 端强制**暂时关闭**，不构成当前阻塞。
4. ~~D-10 的形态 1 是否够用（`route.wrap` 能否做出独立壳）~~ → **不够用，已证伪**（§3.3 全量枚举）。同时确认可用的原生接缝比原先估计更宽：
   - `route.replace(pluginId, targetId, component)` **对 targetId 无白名单**（`store.ts:383-405`）→ D-12「工作台为默认落地」原生可做，`core.root` 就是替换点（`builtinRoutes.tsx:69`）。
   - 宿主实际只渲染 7 个 `<Slot>`，无 shell 级 slot（`git grep -o 'Slot name="…"'` 实测），`SlotName=string` 是类型开放而非接缝开放。
   - PawApp 前端被 `pawapp-sdk/ui.tsx:130-133` 与 `MainLayout/index.tsx:42-45` 双重锁死在 `/apps/{appId}` 内联渲染，且**不是 iframe**（`pages/AppCenter/index.tsx:335-352`）。
   - 后端 `plugins/registry.py:274` 把 `register_http_router` 硬拼 `/api{prefix}`，`register_middleware`（`plugins/api.py:644`）是 AgentScope 请求级而非 ASGI → 插件拿不到顶层 mount。
5. ~~新顶层 URL 是否需要后端改动~~ → **不需要**。`hub/control_app.py:1830-1841` 的 `@app.get("/{path:path}")` 对所有非 `api/` 路径回落 `index.html`，`/wb` 直接命中同一 bundle。WP-11a 的 patch 面因此是**纯前端 2 个文件**。
6. 更正 item 2 的静态路径表述：PawApp 静态资源实际挂在 **`/api/pawapps/{app_id}/static/{file_path}`**（`app/routers/pawapps.py:24,240-291`），前端 bundle 在 **`/api/frontend_plugin/{plugin_id}/files/{file_path}`**（`routers/frontend_plugin.py:20,59`）—— 与 app 自己的 `/api/{app_id}` router 前缀**是三个不同的 URL 空间**，写 WP-03 骨架时别混。
7. ~~D-4：CI 是否可用~~ → **已实测**（§2.2）：fork CI **从未执行过 pytest**（tsc 构建门禁在前）；本地第一次拿到全量数字（3069 passed / 90 failed / 24 collection errors / vitest 465-of-492）。并当场复现一条 P1 破坏：`import qwenpaw.cli.cron_cmd` → `ImportError: validate_cron_trigger`，由 fork 独有提交 `9077dfb9c` 引入、配套上游 PR `#1467` CLOSED。**"测试绿"从现在起是可测的事实而不是要求**，前提是先做 WP-01 的 pytest-only job。
8. ~~D-9：`agents.py` 那 4,239 行新增的重表达深度~~ → **已实测并消解**（§2.3）：AST 五分类（互斥、合计 4,505 行）= 44 handler **1,193** / 100 纯转发门面 **855** / 25 helper **1,120** / 44 class **385** / import+常量前导 **952**；37 条路径中 30 条（24 project + 6 square）是 v2 无对应的私有命名空间；4 条与 v2 同名，且**在 D-14 后确认全部原样采用 v2 版本**（§8 已闭环 15）；v2 反向 10 条路径必须保留。**"无对应"只成立于路径字符串层面** —— v2 有概念相近的 `project-directory` 命名空间（见 item 18），所以这一句不能当成"上游没有 project 能力"的结论用。
9. ~~原则 3 的覆盖深度~~ → **已实测边界**（§3.2）：console 聊天界面内品牌接缝完整（`QwenPaw.chat.leftHeader/theme/welcome/sender/request/response`，全部返 `Disposable`）；界面外**无接缝**（`console/index.html` 的 `<title>`、`pyproject.toml` 包名与 description、CLI 文本、Docker 标签），v2 全库 `branding|productName` 命中 0。→ 原则 3 只能声明为"界面内 Copaw 化 + 界面外沿用 qwenpaw 名义"，除非把包名改掉（那是 fork 名分问题，不在本计划范围）。
10. **新增事实（未列决策，但改变多处措辞）**：反哺 PR 通道 21 开 1 合并（§2.4）；v2 `frontend-tests.yml` 跑 `test:coverage` 且注释明写 coverage **ratchet** 会挡 PR → 前端工作包必须自带测试；`src/copaw` 81 文件 / 407 KB 中 **25 个是 `from qwenpaw…import *` 再导出壳**，56 个是实现；**上游自有文件里伸手进 fork 独有模块的有 5 个而非 2 个**（见下一条）。
11. **修正 §4 与 WP-01 的"2 处侵入 import"**：除 `import copaw` 的 `app/routers/agents.py`、`cli/doctor_cmd.py` 之外，fork 还新增了 `src/qwenpaw/runtime_mode.py`（65 行，`QWENPAW_RUNTIME_FLAVOR` / `CORE_RUNTIME_FLAVOR="qwenpaw"` / `ENHANCED="copaw"`），被 **3 个上游自有文件**消费：`app/_app.py:31,61,586-587`、`cli/main.py:10`、`cli/app_cmd.py:13`。它是 v1 时代"一套代码两种产品"的开关，**在 v2 里没有对应物，也不该有**（v2 用插件装载表达同类差异）。→ 它是 WP-01 的必办项，且**优先级高于 copaw 解耦**：它让 qwenpaw 的启动路径依赖一个 fork 私有模块，是 P1 最直接的违例。
12. **`app_id` 的字符集约束已读到实现**（补未验证项 4 的一半）：`_APP_ID_PATTERN = ^[a-z0-9][a-z0-9-]*$`（`pawapp/app.py:64`）**只在 `enable_standard_capabilities()` 里强制**（`:369-383`，docstring 明写 "reserves strict app ID validation for apps using the new app-scoped frontend contract"）。→ **Copaw 的 app id 必须取小写 kebab-case**（`copaw-knowledge`，不是 `copaw_knowledge`），只要调用那个 opt-in（拿 namespaced chat/storage/toast/notify 就要调）；不走该路径的 app 不受此约束。WP-03 骨架命名按此定。
13. ~~`managed_service` 能否承载 fork 的 sidecar 形态~~ → **问题本身是错的，已证伪**（§5 WP-04）。`pawapp/service.py:101-131` 要求 `command`（argv）+ `health_path`（必须 `/` 开头的 HTTP 健康路径）+ `_validate_loopback_host`，即**上游的托管模型是"常驻 loopback HTTP 服务"**；而 fork 侧 `git grep -E "socket\.|\.bind\(|find_free_port|uvicorn|HTTPServer|serve_forever" main -- src/copaw` **命中 0**，全树无端口自管。fork 的"sidecar"其实是**另一个 venv 的解释器**（`.venv-hanlp` / `.venv-senta`，见 `hanlp_sidecar.py:_normalize_siamese_python_executable`）：HanLP 是**进程内单例**（`NLPRuntime()` 在 `knowledge_hanlp_tasks.py:182` 存成 `_RUNTIME_SINGLETON`），siamese 是**按次一次性 `subprocess.run([python,"-c",runner_code], timeout=300)`**（`siamese_uninlu_runtime.py:228,425`），DuckDB 是**进程内库 + 文件布局**（`duckdb_catalog.py:27-33`）。→ **`managed_service` 三者都不适用**，正确接缝是 `dependency`（自定义 probe）+ 普通进程内单例 + 保留 ephemeral 子进程。**这消除了 WP-04 原本最大的浮动项。**
14. ~~D-13：反哺 PR 通道算不算一条功能退路~~ → **已由用户裁决关闭：不再提 PR，除非是明确的 bug。** 本轮补测的分布依据：21 个 PR 里 `fix(` 开头 13 个只合 1 个、`feat(` 开头 8 个合 0 个（§2.4）。直接后果：§0.2 判定流程与 §4 的标签集从五态收窄为四态（`原生`/`copaw`/`DROP`/`CUT`），WP-02 从 3–4d 降到 2–3d，§6.1 约束 2 从"合并后 30 天摘除"改为**永久 patch + 每次同步手工重放**。
15. ~~D-14：`system_protected` 砍还是留~~ → **已由用户裁决关闭：内置 agent 保留与 upstream 一致的策略 = 砍。** 本轮实测出三条此前不知道的事实，使它比预期便宜得多：
    - **前端零改动**：唯一消费方 `console/src/pages/Settings/Agents/components/AgentTable.tsx`（`:47`、`:182`）**在 `upstream/main` 已被删除**（merge-base 有、v2 无，v2 换 `AgentGallery.tsx` 一套）；v2 的 `console/src` 对 `is_builtin|builtin_kind|builtin_label|system_protected` **命中数 0**。所以采纳 v2 后保护 UI 自然消失，不出现"按钮能点、后端 400"的半保护态。
    - **表 B 那 4 条同名路径的合并面归零**：去掉 guard 后逐条 diff，fork 独有行只剩同步 IO 写法与 `_normalized_agent_order`，没有任何 v2 缺失的行为 → 4 条全部原样采用 v2 版本（v2 更强：409 still-starting、`mutate_config` 原子写、`_display_agent_order` 的 pin 次序校验、`update_agent` 的 backend/mail 校验与回滚快照）。
    - **删除清单是可度量的**：`config/config.py` 2 处 Field（`:1083`、`:1137`，共 8 行）、`app/migration.py` 6 处、`app/routers/agents.py` 9 处（guard 在 `:3320`/`:3365`/`:3407`）、`app/builtin_agents.py` 1 处（`:36 system_protected: bool = True`）。WP-06 的 Gate 加一条"全 `src/` 下 `git grep system_protected` 命中 0"。
    - **未随本裁决解决**：同一批上游 hunk 里的 `is_builtin`/`builtin_kind`/`builtin_label`（24 行加性 schema）仍违 D-8，见 §2.3 末尾与 WP-02 第 3 项。
16. **本轮重测 §2.1 的分堆，两处算错已更正**：(a) `grep -c "^+[^+]"` 会**丢掉新增空行**，导致总量从 8,122 修正为 **9,303**（`git diff --numstat e111ec6f main -- src/qwenpaw` = 9,302 插入 / 1,996 删除，61 文件）；(b) 分堆阈值只有 `hits≥5` 与 `hits≤1`，**`hits` 为 2–4 的 7 个文件 / 899 行此前哪一堆都没进**（含 `agents/utils/audio_transcription.py` 335、`app/mcp/manager.py` 194、`app/migration.py` 159）。P3 也从"6 个文件"更正为 **30 个文件**（≥50 行的 7 个占 1,345 行）。附录里换成了不会漏空行的脚本。
17. **"以仓库实际为准"复核：仓库的真实状态与本计划的假设一致，但有一处此前未记的风险**：
    - `main` = `a0002eaaa`（2026-06-03），工作区干净，唯一未跟踪文件是本文档；`main...upstream/main` = **889 ahead / 1160 behind**；merge-base `e111ec6fb`。**不存在 `sync/v2` 分支**（`git show-ref | grep -i sync` 只有 `backup/*upstream-sync*`、`origin/eval/main-sync-20260320`、tag `sync-main-20260331`）；`git log --all --grep=WP-`、reflog、dangling objects **全空**（4 条 `--grep=WP` 命中是上游提交里的 "viewport"/"pawport" 假阳性）。→ **本计划没有一个 WP 被执行过，本文档是纯计划**。任何"某 WP 已完成"的说法都不成立。
    - **`main` 相对 `origin/main` = 3 ahead / 0 behind**：v1 唯一兜底有 3 个提交从未离开本机（内容见 WP-00）。已写入 WP-00 的 Gate。
    - 这 3 个提交共触及 14 个文件，其中 **4 个是上游自有文件**（`console/src/api/authHeaders.ts`、`console/src/pages/Coding/TabbedEditor.tsx`、`src/qwenpaw/agents/react_agent.py`、`src/qwenpaw/app/routers/agent_scoped.py`），且**全部已在 §2.1 的 61 / 83 计数内（全仓 187 口径同样不含新文件）→ P1 基线数字无需修改**。其余 10 个是 fork 自有路径（`console/src/pages/Agent/Projects/**`、`src/qwenpaw/app/project_context.py`）。
18. **新实测：上游 v2 有一整套 `project-directory` 能力，此前 §4 只写了"文件名级"**。后端 `app/routers/project_directory.py` **1,034 行 / AST 12 条路由** + `services/project_directory.py` **734 行**，前缀 `/workspace/project-directory`，路由含 `create/clone/import-local/upload-zip/browse-dirs(+/create)/list/dirs(GET,PUT,DELETE)`；前端 `features/project-directory/SessionProjectDirectory.tsx` **1,357 行** + `components/ProjectSelectModal/index.tsx` **690 行** + `stores/projectDirectoryStore.ts`。**它与 fork 的 24 条 `project_*` 路径是不是同一件事 = WP-02 的必答项**（已写进 §4 该行）。同时确认：`console/src/pages/Coding/TabbedEditor.tsx` 上游有且 v2 版 1,486 行 vs fork 1,017 行（+314/−783）并带 2 个测试文件；`Coding/FileTree.tsx`(474) 与 `Coding/index.tsx` v2 已删但 **fork 从未修改过它们**（不在 83 之列）。
19. **两条本轮"以仓库实际为准"新查到的原生接缝，都直接减小 P1**：
    - **`copaw` 是上游自己的遗留命名层，不是空位**（§3.4 全文实测）。最实用的后果：`WORKING_DIR` 在上游 v2 里**原生优先读 `~/.copaw`**，且 `config/config.py:3984` 自带从 `~/.copaw` 迁移 sessions/memory/jobs/md 的代码 → **WP-10 切主在数据层面不需要 fork 写迁移器、不需要 patch**；fork 私有的 `agents_square/`、`custom_channels/`、`hanlp_sidecar/` 三个数据目录在 v2 命中 0，无重名冲突。代价是命名口径：原则 3 的"Copaw"是在**覆盖上游自己的旧名**（v2 的 `PROJECT_NAME="QwenPaw"`、`AppBrand.tsx alt="QwenPaw"`、README 仍 QwenPaw），不是填空。
    - **`qwenpaw doctor` 有官方扩展点**：`cli/doctor_registry.py` 提供 `DoctorRunContext(cfg, raw_cfg, cli_base_url, timeout, deep)` → `list[str]` 的契约、`register_doctor_contribution(contrib_id, fn)` 程序化注册、以及 `qwenpaw.doctor` + legacy `copaw.doctor` 两个 entry-point 组（merge-base 时代就存在，v2 仍在）。fork 为 HanLP sidecar 改的 `cli/doctor_cmd.py` **+76/−4** 因此可整体移出上游文件，**5 处侵入 import 里的 1 处有零 patch 解**。
20. **fork 未推送提交的实际内容已核对**（细节在 WP-00）：`248e61b35` 的 `TabbedEditor`/文件树重构、`c5f04f83f` 的 project 上下文注入、`a0002eaaa` 的 `_register_hooks` 恢复（`react_agent.py` +43）。其中 `c5f04f83f` 值得单列，因为它**是 §4 里"project 上下文注入 system prompt"这条能力的现行实现**，形状是：前端 `buildAuthHeaders()` 发 `X-Project-Id` → 上游 `routers/agent_scoped.py` 的 `AgentContextMiddleware` +14 行写进 `request.request_context["project_id"]` → fork 新文件 `app/project_context.py`(115 行) 读 `workspace_dir/projects/<id>/.agent/{PROJECT,AGENTS}.md` → `ReactAgent._build_sys_prompt()` 合并。
    **本轮新实测：v2 原生就有一整套"请求级 project directory"** —— `app/agent_context.py:141 get_agent_project_dir` / `:164 get_project_dir_for_request` / `:226 get_project_dirs_for_request`，用 `X-Chat-Id`（读 `chat.meta` 的 `session_project_dirs`）或 `X-Session-Project-Dir`（pending override）解析，背后是 `services/project_directory.py` 的 `resolve_effective_project_dirs(...).primary_path`。而 fork 那 +14 行与 v2 自己在同文件里对 `root_session_id` 的写法**逐字同形**（`agent_scoped.py:51-56`）。
    → **这给 `c5f04f83f` 指出了一条零 patch 路线**：把 fork 的 project 语义改挂在 v2 的 session/agent project-dir 机制 + `prompt_section` 上，`agent_scoped.py` 的 14 行与 `project_context.py` 的 id→路径映射一起消失。**但这是"形貌级"匹配，不是等价性证明**（fork 按 id 寻址 + 注入 `.agent/*.md`；v2 按路径寻址 + 服务 Files API），列为未验证项 18，WP-02 判这一行之前必须读 `agent_context.py` / `services/project_directory.py` 的实现。
21. **P1 的账此前系统性少算：全仓真实是 187 个上游自有文件被改，不是 61 + 83**（§2.1.1 有完整表与逐目录行数）。要点三条：(a) 账外 43 个文件集中在**根目录 / `tests` / `scripts` / `website` / `.github` / `deploy` / `console` 非 src**，恰好都在 §8 已闭环 9 声明"没有原生接缝"的区域，说明 fork 事实上已经在那里挂了 patch；(b) `tests/unit/**` 有 **10 个上游测试文件被 fork 改动**（+307/−11，含 `test_agents_ordering.py`、`test_openai_provider.py`、`test_app_startup.py`），这直接削弱"测试绿 = 没破坏 qwenpaw"这条判据；(c) **计划与仓库不一致确实存在，但范围比上一版写的要小、也要更准**：`console/index.html` 有 1 处改名对、四份 README 各 1 处，这些是真·产品名 patch；而 **`pyproject.toml` 的 +5 行与 `deploy/Dockerfile` 的 +1 行实测与产品名无关**（前者是 4 行依赖 + 1 行 package-data，后者是 `NODE_OPTIONS`）。真正的改名面经逐文件配对量化为 **22 文件 / 127 行**（item 23）。§0.1、§7、WP-01 Gate、WP-02 第 5 项已按全仓口径改写。
22. **发现并量化了一个树外 patch，以及一条会让上游前端 CI 直接跑不起来的缺失**（§2.1.2 全文）：(a) `console/package.json:8` `postinstall → scripts/patch-chat-flushsync.mjs`（fork 新增 128 行）改写 `@agentscope-ai/chat` 的 **6 个编译产物文件 / 6 处 `ReactDOM.flushSync`**，且**锚点失配时打印 `already applied` 并 exit 0 = 静默失效**；fork 钉 `^1.1.64-beta.1779961389231`，v2 钉 `1.2.0-beta.1789540479556`，迁移时必然失配。(b) fork 的 `console/package.json` **没有 `test:coverage`**（merge-base 有，fork 删了），而 v2 的 `frontend-tests.yml` 正是跑 `npm run test:coverage` + coverage ratchet → **命令不存在**级别的失败，不是"跑不过"。(c) 顺带实测 fork 还降了 `@agentscope-ai/icons`（`^1.0.67`→`^1.0.63`）、升了 `@vitejs/plugin-react`（`^4.4.1`→`^6.0.1`）。已写进 §7 红线（patch 判定含树外）、WP-08 正文与 Gate。
23. **D-15 的实测账：真·产品名 patch = 22 个上游文件 / 127 行改名对；而"让命令叫 Copaw"零 patch 就已经成立**（本轮按用户裁决"可见品牌与分发物包括命令等命名都叫 Copaw"补测）。配对方法见 §2.1.1。三条结论：
    - **命名分布**：文档 69（`website/public/docs/cli.{zh,en}.md` 47 + `desktop.{en,zh}.md` 22）、安装包与安装脚本 29（`scripts/pack/desktop.nsi` 15、`build_win.ps1` 7、`install.bat` 4、`build_macos.sh` 3）、CLI 自述文本 15（`cli/{init_cmd,desktop_cmd,main,update_cmd}.py`）、console 界面 7（`layouts/constants.ts` 3、`Header.tsx` 1、`pages/Login/index.tsx` 1、`Chat/OptionsPanel/defaultConfig.ts` 1、`console/index.html` 1）、内置 agent 默认文案 3（`app/migration.py` 的 `"Default QwenPaw agent"`）、README 4。另有 36 行含 `copaw` 的新增是**功能引用**（`import copaw`、转发 `src/copaw`），不算命名。
    - **上游原生已给出的 Copaw 命名面（不要用 patch 去"实现"它）**：`[project.scripts]` 里 **`copaw = "qwenpaw.cli.main:cli"` 在 merge-base `:90` 和 `upstream/main:123` 都存在**，fork 一行没动 → **`copaw <子命令>` 这个 CLI 形态是上游发布物的一部分**；同理 `COPAW_*` env、`~/.copaw` 工作目录、`copaw.doctor` entry-point 组、`~/.copaw/apps`、`copaw_file_metadata.json` 都原生可用。**所以 D-15 里"命令命名"这一项的剩余工作只有自述字符串。**
    - **界面内文案是 D-15 新开的、此前不在任何账上的工作面**：fork **没有改过任何上游 locale 文案**（`console/src/locales/{en,zh}.json` 各 +128 行纯新增、0 个品牌字样；`i18n.ts` 的 36 行是 import fork 自己的 `locales/copaw/{projects,pipelines,rpa}/*.json`，18 个新文件 +2,762/−0）。而 v2 上游 locale 的 QwenPaw 字样实测 **en 88 / zh 87 / ja 67 / ru 65 / pt-BR 65 / id 65 / vi 57 = 494 处** —— 若"可见品牌"含界面内正文，这 494 处要另开一册，接缝可行性见未验证 19。

### 仍未验证（别当结论用）

1. ~~`managed_service` 能否承载 fork 的 sidecar 形态~~ → **已闭环，且结论是"这个问题问错了"**（见上面已闭环 13，§5 WP-04）。剩下的唯一实作未知：**`dependency` 的自定义 probe 能否表达 fork 现有的"NLP 运行时是否 ready / 模型是否已下载"这类状态**（`sidecar.py:247,512` 那套 status 语义要落到哪个上游方法上），只读了 `ManagedService` 一侧的 `expose_dependency`/`probe_service` 签名，没读 `dependency` 的注册契约。
2. **重叠度判断大部分仍只到文件名级**。第 4 节的 `DROP` 初判要等 WP-02 读实现才能用，别直接按第 4 节砍工作量。**唯一已推进到"形貌级"的是 `project_directory`**（已闭环 18：12 条路由 + 1,034/734 行后端 + 1,357/690 行前端，全部实测）—— 但**形貌 ≠ 语义**：它到底管的是"会话工作目录"还是 fork 那套"项目工件生命周期"，仍未读实现。
3. ~~没跑过任何测试、没看 CI 状态~~ → **已跑**（§2.2）。**仍未验证的是归因**：90 个失败里那 **13 个上游自有测试文件的失败** + **2 个上游测试文件的收集错误** + **5 个上游文件的 tsc 错误**，各自是"fork 改坏了 qwenpaw"还是"fork 的半合并让测试与源码不自洽"，还没逐条对号。这 20 项是 P1 目前唯一可度量的积压，也是 WP-02 之后的第一批必修项。
4. **B 案下 `plugin_<id>` 命名空间对 FastAPI/Pydantic 的影响未验证**：路由函数的类型解析、以及 `on_workspace_created` / `prompt_section` / `runtime_hook` 这几个 fork 需要的钩子的实际调用时机，都只读了签名没读实现。（`_APP_ID_PATTERN` 那一半**已闭环**，见上面已闭环 12。）
5. **27 个本地分支**（`git branch --list` 实测：7 个 `backup/*`、**11 个 `feat/upstream/*`**、3 个 `feat/fork/*`、2 个 `chore/*`，加 `main`/`fork/main`/`local/pipelines-draft-local-only`/`mirror/upstream-main`）里是否有未回流的价值，未评估。**这 11 条 `feat/upstream/*` 与 §2.4 那 21 个 CLOSED PR 应当逐条对账**（分支还在、PR 已闭 → 里面很可能压着已经决定"走上游"但上游没收的代码，这部分现在是**隐形负债**）；WP-02 应把它列入产出。
6. 前端 206 个新增文件里有多少能被 v2 原生组件替代，未逐页比对。
7. **WP-08 从 8–15d 下修到 4–7d 的前提未逐页验证**：我只确认了 `registerRoutes`/`addToolRenderers`/`slot`/品牌位这套注册面**存在且形态合适**，没有逐页确认 fork 那 144 个新增 page 的交互（尤其嵌入原生聊天页、文件树、编辑器的那些）都能经 slot 注入而不需要改上游组件。若有一批页面必须改上游组件，WP-08 会退回原估。
8. ~~P1 目标"0"能否达成未知~~ → **已量化**（§2.1 + §2.3，本轮把行数与分堆重测过一次）：9,303 行新增分四堆，P1 那 5,139 行的 82.5% 是 `agents.py`，其实际形状是"1,193 行路由体 + 855 行已是转发门面 + 42 个模型"，D-14 后**语义残差为 0**。**但仍未解决的仍是等价性**：D-8 把风险从"挂 patch"转移到"**重表达后的语义等价性**"，而 fork 的 90 个失败测试里有 77 个在 fork 自有测试文件中 —— 意味着**这套行为基线目前自己就不自洽**，拿它当等价性判据不成立。缺口最小化的做法：给 `agents.py` 那 37 条路径各写一条 characterization test（**迁移前在 v1 上写，迁移后在 v2 上跑**；那 4 条同名路径现在改用 v2 版本，所以它们的用例应直接取自 v2 的 agents 测试）。这是 WP-06 Gate 的前置。`agents.py` 那 1,096 处关键词命中对应多少条可测断言，仍未数。
9. ~~原则 3 的覆盖深度未验证~~ → **边界已实测**（§3.2、§8 已闭环 9）：界面内有完整品牌接缝、界面外无。剩下的唯一未知是**时序**：`ConsolePollService` 在挂载时快照 `document.title`，所以"插件先改 title、该组件后挂载"才能保住闪烁语义；两者的加载顺序**未实测**。若顺序不利，浏览器标签名只能维持上游值 —— 属可接受的降级，不影响 P1。
10. **§2.1 的分堆用的是关键词命中数（`copaw|knowledge|pipeline|flow|project|…`）这个代理指标**，不是语义判定。`hits ≤ 1` 不代表该改动与 Copaw 无关（比如一处精心命名的通用 hook 也会落到 hits=0）。P3 那 **30 个文件**与 P4 那 **7 个文件（899 行，本轮新补的带）** 的归类**必须等 WP-02 读实现确认**，别直接按它下"砍不砍"的结论。
11. **D-7 的"稳的/想反哺的"这条分界线没有客观判据**，实际执行时会变成主观选择。建议 WP-02 顺手定一条硬规则（例如"凡是需要改上游数据结构的都不反哺"），否则并存会退化成随手放。
13. **D-14 之后遗留的 `is_builtin`/`builtin_kind`/`builtin_label` 零 patch 方案只到论证，未到实测**：读取点确实只有 `agents.py:2769-2795`（响应组装）与 `migration.py:824-841`（幂等检查）两处、静态 spec 表确实已存在（`builtin_agents.py:163 is_builtin_agent_id`），但**没有实跑过"删掉那 24 行 schema 后 6 个 Understand-* + QA 内置 agent 仍被正确识别与迁移"**。更要紧的是 v2 的 `template_id`（`v2:config.py:2330`、`v2:agents.py:486-489` 的 `pawapp:` 前缀）能否承载 QA/Understand 这类标签：本轮只读了字段定义与一处消费代码，**没读它的写入路径，也没读 v2 前端是否消费它**。WP-02 给这一行落标签前必须补这两项。
14. **P4 中间带那 899 行完全没读实现**（`audio_transcription.py` 335、`app/mcp/manager.py` 194、`migration.py` 159、`routers/workspace.py` 105、`config/context.py` 39、`workspace/workspace.py` 36、`agents/prompt.py` 31）。本轮重测分堆规则时才被发现，此前它们在计划里是隐形的。`app/mcp/manager.py` 大概率和 P2 一样自动作废（上游已删该文件），其余 6 个未知。
15. **WP-11a 的三处具体行为只读到代码、未实测**：(a) `/wb` 走 `AuthGuard useHardRedirect` 时，在 `/console` 部署形态（`basename="/console"`）下 `redirect` 参数往返是否正确；(b) `core.root` 替换后在 `/console/*` 下做一次 `location.assign("/wb")` 的闪屏是否可接受（D-12 × 形态 3 的交互税）；(c) 上游是否已有我没找到的 mode 注册表 —— 已沿 `App.tsx` / `navigationMode.ts` / `<Slot>` 枚举三个方向证伪，但**没有穷尽搜索整个 console**。（注：`CoPaw-upstream-main` worktree 停在 `7f99b4322`，落后于 `upstream/main` = `70715e982`；本文所有 v2 行号取自 `git show upstream/main:<path>`，不要拿该 worktree 的文件系统去 `ls`/`find` 复核，会得出"文件不存在"的假结论 —— 本轮已踩到一次。）
16. **doctor 零 patch 路线的触发方式未验证**（§8 已闭环 19 的下半段）：`pyproject.toml` 是上游自有文件、fork 已改过它 **+5/−0，但实测那 5 行是 4 行依赖 + 1 行 package-data，与产品名和 entry point 都无关**（上一版说它是"文案级违例"是错的，已闭环 21(c) 已纠正）；`[project.entry-points."qwenpaw.doctor"]` 的注释示例与 "Legacy group `copaw.doctor` is still loaded" 都是**上游原文**。所以在里面加 1–3 行加性 entry point 属 **P1-行为**改动（它会真的改变打包结果），不是"再补一行文案"。真正零 patch 的形态只能是"**插件被 loader 导入时调 `register_doctor_contribution()`**"，而这条路要回答两件事：(a) `qwenpaw doctor` / `copaw doctor` 的执行路径**是否先加载插件**（只读到了 registry 的 API，没读 `doctor_cmd.py` 里 `run_extension_contributions` 的调用点与插件 loader 的先后）；(b) `DoctorNotesFn` 只返回 `list[str]`，**没有 pass/fail 通道**，而 fork 的 `_check_hanlp_sidecar` 返回 `(ok, reason, notes)` 三元组并参与退出码 —— 这个语义缺口原生补不上，只能降级成"只出 notes"。
17. **`~/.copaw/apps` 与 fork 现有数据树的并存行为未实测**：v2 新增 PawApp 安装目录（`routers/pawapps.py:177`、`console/.../PawApps/index.tsx:68`），而 fork 的 `WORKING_DIR` 下已有 `plugins/`、`skill_pool/`、`agents_square/`、`hanlp_sidecar/` 等（已实测这些名字在 v2 无冲突或同源）。Copaw 的 app 落到 `~/.copaw/apps` 后与 v1 遗留目录是否互相干扰，未跑过。
18. **`c5f04f83f` 的零 patch 路线只到形貌级**（详见 §8 已闭环 20）：fork 按 `X-Project-Id` + `projects/<id>/.agent/*.md` 注入 sys prompt；v2 按 `X-Chat-Id` / `X-Session-Project-Dir` + `resolve_effective_project_dirs().primary_path` 服务 Files API。**`app/agent_context.py` 与 `services/project_directory.py` 的实现未读**，`prompt_section` 的调用时机与是否能读到 request 级上下文也未读（与未验证项 4 是同一批）。判这一行了 `原生` 之前必须补。
19. **（D-15 新开）界面内 494 处 QwenPaw 文案能否零 patch 覆盖，未验证**。已实测的是：v2 `console/src/i18n.ts` 用 `createInstance` 建实例，`localeLoaders` 是 `as const satisfies Record<…>` 的**硬编码 7 个 loader**，全仓 grep **没有** `addResource` / `registerTranslation` 之类的插件翻译入口（只有两个测试文件自己构造 `resources`）。fork 现在的做法是在 `i18n.ts` 里 **import 自己的 `locales/copaw/*.json`**（36 行加性注册）—— 这条路能加新命名空间，**能不能覆盖上游已有 key 未验证**。要验的两件事：(a) 该实例是否在插件/应用层可达（能否拿到 `i18n` 句柄调 `addResource(s)`）；(b) 若不可达，是否只能用 `ns` 之外的手段（例如在 loader 之后 merge）。**验不过的退路是直接 patch 上游 7 个 locale JSON（494 处），计入 §7 的 P1-命名册。** 这条决定 D-15 在界面内的落地成本，属于工时未知而非产品决策。

---

## 附录：复现命令

```bash
cd /Users/futuremeng/github/futuremeng/CoPaw
git fetch upstream
git rev-list --left-right --count main...upstream/main        # 889  1160
git merge-base main upstream/main                             # e111ec6f
git diff --shortstat e111ec6f main                            # 691 files, +203231 -12377
git diff --name-status e111ec6f main | awk '{print $1}' | sort | uniq -c   # 504 A / 187 M
git diff --name-only e111ec6f main | sort > /tmp/fork_files.txt
git diff --name-only e111ec6f upstream/main | sort > /tmp/up_files.txt
comm -12 /tmp/fork_files.txt /tmp/up_files.txt | wc -l        # 179 共同改动
git grep -l -E "^(from|import) copaw" main -- src/qwenpaw     # 14 个 importer
git ls-tree --name-only main:src/qwenpaw/app/routers | sort > /tmp/f.txt
git ls-tree --name-only upstream/main:src/qwenpaw/app/routers | sort > /tmp/u.txt
comm -23 /tmp/f.txt /tmp/u.txt                                # 11 个 fork-only router
git show upstream/main:src/qwenpaw/plugins/architecture.py    # PluginType 契约
git show upstream/main:src/qwenpaw/pawapp/app.py | grep -E "^    def "   # PawApp 注册面
git show upstream/main:plugins/apps/qwenpaw-data/plugin.json  # app 清单实例
gh repo view futuremeng/CoPaw --json isFork,parent            # fork 关系健康

# 隔离与挂载语义（§3.1）
git show upstream/main:src/qwenpaw/plugins/module_isolation.py      # 重定向 + 全局兜底 + 已声明限制
git show upstream/main:src/qwenpaw/plugins/loader.py | sed -n '515,640p'   # plugin_<id>/search_paths/清扫
git show upstream/main:src/qwenpaw/pawapp/app.py  | sed -n '770,795p'      # 单前缀聚合挂载
git show upstream/main:src/qwenpaw/_version_compat.py | head -15           # max 强制暂时关闭
git grep -n -E "importlib\.import_module|__import__\(" main -- src/copaw   # 全 fork 仅 3 处，1 处需改
git grep -l -E "pickle|joblib|dill\.|torch\.save" main -- src/copaw        # 0 命中
git grep -l -E "patch\([\"']builtins" main -- tests                        # 0 命中

# 前端原生扩展面与品牌位（§3.2）
git show upstream/main:console/src/plugins/hostExternals.ts | sed -n '71,120p'   # registerRoutes/PluginRouteDeclaration
git show upstream/main:console/src/plugins/registry/types.ts | sed -n '250,272p'  # header.leftTitle / theme.colorPrimary
git grep -n -oE "QwenPaw\.[a-zA-Z]+" upstream/main -- console/src/plugins | awk -F: '{print $NF}' | sort -u
git show upstream/main:src/qwenpaw/hub/static_files.py | sed -n '88,98p'         # console 整壳退路（本计划不用）

# 界面模式与 D-10 证伪（§3.3、§6.1）
git show upstream/main:console/src/App.tsx | sed -n '429,479p'    # osActive 分支 + 只有 /login /hub/admin /*
git show upstream/main:console/src/utils/navigationMode.ts | sed -n '19,33p'   # CONSOLE_BASENAME / isOsPath
git show upstream/main:console/src/utils/navigationMode.ts | sed -n '62,72p'   # getPostLoginHref 只放行 /os
git show upstream/main:console/src/layouts/MainLayout/index.tsx | sed -n '35,53p'  # 上游自己按 selectedKey 换壳（id 硬编码）
git show upstream/main:console/src/layouts/MainLayout/index.tsx | sed -n '73,81p'  # <Routes> 在 Layout 内部
git grep -h -o 'Slot name="[^"]*"' upstream/main -- console/src | sort -u        # 宿主只有 7 个 Slot
git show upstream/main:console/src/plugins/registry/store.ts | sed -n '383,405p'   # route.replace 无 targetId 白名单
git show upstream/main:console/src/plugins/registry/store.ts | sed -n '578,600p'   # resolveAll: override + wrap reduce
git show upstream/main:console/src/layouts/registry/builtinRoutes.tsx | sed -n '68,70p'  # core.root = "/" → /chat
git show upstream/main:console/src/plugins/pawapp-sdk/ui.tsx | sed -n '120,138p'   # PawApp 路径锁死 /apps/{id}
git show upstream/main:src/qwenpaw/plugins/registry.py | sed -n '270,295p'         # full_prefix = f"/api{normalized}"
git show upstream/main:src/qwenpaw/hub/control_app.py | sed -n '1830,1841p'        # 非 api/ 一律回 index.html

# D-8 代价分堆（§2.1）：61 个被 fork 改动的上游后端文件 × Copaw 关键词命中
# ⚠ 旧版这里用 `grep -c "^+[^+]"` 统计新增行，会把新增空行整个漏掉（总数少算 ~1,180 行）。
#   另外旧版只有 hits>=5 / hits<=1 两档，hits 2-4 的文件哪一堆都没进。下面是更正版。
git diff --name-only --diff-filter=M e111ec6f main -- src/qwenpaw > /tmp/mod_qwenpaw.txt
wc -l < /tmp/mod_qwenpaw.txt                       # 61
git diff --numstat e111ec6f main -- src/qwenpaw | awk '{a+=$1; d+=$2} END{print a, d}'   # 9302 插入 / 1996 删除
python3 - <<'PY'
import subprocess, re
files = open("/tmp/mod_qwenpaw.txt").read().split()
KW = re.compile(r"copaw|knowledge|pipeline|flow|project|agents_square|artifact|quantiz", re.I)
v2 = set(subprocess.run(["git","ls-tree","-r","--name-only","upstream/main","--","src/qwenpaw"],
                        capture_output=True, text=True).stdout.split())
bands, rows = {}, []
for f in files:
    d = subprocess.run(["git","diff","-U0","e111ec6f","main","--",f],
                       capture_output=True, text=True).stdout.splitlines()
    added = [l[1:] for l in d if l.startswith("+") and not l.startswith("++")]   # ← 含空行
    a, k = len(added), sum(1 for l in added if KW.search(l))
    band = ("P1 承载性" if k >= 5 else
            "P2 上游已删" if k <= 1 and f not in v2 else
            "P3 待签字"   if k <= 1 else "P4 中间带(hits 2-4)")
    bands.setdefault(band, [0, 0]); bands[band][0] += a; bands[band][1] += 1
    rows.append((a, k, band, f))
print("total", sum(x[0] for x in rows), "files", len(rows))
for b, (l, n) in sorted(bands.items()): print(f"  {b:18s} lines={l:5d} files={n}")
for a, k, b, f in sorted(rows, reverse=True):
    if b.startswith("P4") or (b == "P3" and a >= 50): print(f"  {a:5d} hits={k:4d} {b} {f}")
PY
git show --stat main -- src/qwenpaw/app/routers/agents.py | tail -1

# D-4 CI 实测（§2.2）
gh run list --limit 25                          # nightly 连续 failure + disabled_inactivity
gh workflow list --limit all                    # 看 state=disabled_inactivity
sed -n '60,80p' .github/workflows/tests.yml     # 每个后端 job 第一步是 console 构建
sed -n '9p' console/package.json                 # "build": "tsc -b && vite build"
git show upstream/main:.github/workflows/frontend-tests.yml | grep -n -i "coverage\|ratchet"
cd console && npx tsc -b --pretty false 2>&1 | tail -3      # 63 errors
python -m pytest tests/unit -q --continue-on-collection-errors 2>&1 | tail -5   # 15m51s
python -c "import qwenpaw.cli.cron_cmd"          # ImportError: validate_cron_trigger（P1 活体样本）
git log -1 --format="%h %ad %s" --date=short 9077dfb9c
git grep -c "validate_cron_trigger" upstream/main -- src/qwenpaw   # 0 命中

# D-9 agents.py 拆形（§2.3）—— AST 统计，勿用行数估算
python3 - <<'PY'
import ast
def scan(rev):
    import subprocess
    src = subprocess.run(["git","show",f"{rev}:src/qwenpaw/app/routers/agents.py"],
                         capture_output=True, text=True).stdout
    t = ast.parse(src); lines = src.split("\n")
    def rt(x):
        f = x.func if isinstance(x, ast.Call) else x
        return isinstance(f, ast.Attribute) and getattr(f.value, "id", "") == "router"
    h = p = o = cl = d = c = 0; paths = []
    for n in t.body:
        ln = n.end_lineno - n.lineno + 1
        if isinstance(n, ast.ClassDef):
            c += 1; cl += ln; continue
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            d += 1
            dl = [x for x in n.decorator_list if rt(x)]
            body = n.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                body = body[1:]
            if dl:
                h += ln
                paths += [x.args[0].value for x in dl
                          if isinstance(x, ast.Call) and x.args
                          and isinstance(x.args[0], ast.Constant)]
            elif len(body) <= 3 and "copaw_project" in ast.dump(n): p += ln
            else: o += ln
    print(rev, "total", len(lines), "defs", d, "classes", c,
          "| handler", h, "| forwarding", p, "| helper", o, "| class", cl,
          "| prelude", len(lines) - h - p - o - cl,
          "| unique_paths", len(set(paths)))
    return sorted(set(paths))
f = scan("main"); v = scan("upstream/main")
print("project:", len([x for x in f if "projects" in x]),
      "square:", len([x for x in f if x.startswith("/square")]),
      "collide:", sorted(set(f) & set(v)))
PY
git grep -c "system_protected" main -- src/qwenpaw          # config 2 / migration 6 / agents 9 / builtin_agents 1
git grep -c "system_protected" upstream/main -- src/qwenpaw # 空 = 上游无此概念
git grep -n -iE "protected|is_builtin|readonly" upstream/main -- src/qwenpaw/app/routers/agents.py src/qwenpaw/config/config.py  # 0
git show upstream/main:src/qwenpaw/pawapp/app.py | sed -n '486,494p'   # middleware 是 AgentScope 中间件，非 HTTP

# D-14 裁决的执行面（§2.3、§6）—— 三条都要复现，否则"前端零改动"这个结论不成立
git show main:src/qwenpaw/config/config.py | sed -n '1071,1086p;1125,1140p'   # 4 字段 × 2 类 = 32 行加性 schema
git diff -U0 e111ec6f main -- src/qwenpaw/config/config.py | grep -E "^@@"     # 只有两处 +16 hunk 是 builtin/protected
git cat-file -e main:console/src/pages/Settings/Agents/components/AgentTable.tsx && echo has@main
git cat-file -e upstream/main:console/src/pages/Settings/Agents/components/AgentTable.tsx || echo DELETED-IN-v2
git cat-file -e e111ec6f:console/src/pages/Settings/Agents/components/AgentTable.tsx && echo "existed@merge-base（= 上游自有文件，非 fork 新增）"
git grep -n -E "is_builtin|builtin_kind|builtin_label|system_protected" upstream/main -- console/src   # 0 命中 → 前端零改动
git grep -n "system_protected" main -- console/src/pages/Settings/Agents/components/AgentTable.tsx      # :47 置灰 / :182 blockedReason
git show main:src/qwenpaw/app/builtin_agents.py | sed -n '25,40p;160,164p'   # 静态 spec 表 + is_builtin_agent_id()
git show upstream/main:src/qwenpaw/config/config.py | sed -n '2325,2335p'    # v2 用 template_id 表达内置来源
git show upstream/main:src/qwenpaw/app/routers/agents.py | sed -n '484,492p' # v2: pawapp: 前缀的 template_id

# 去掉 guard 后 fork vs v2 的 4 条同名 handler（结论：fork 无独有行为，全部采用 v2）
git show main:src/qwenpaw/app/routers/agents.py > /tmp/fork_agents.py
git show upstream/main:src/qwenpaw/app/routers/agents.py > /tmp/v2_agents.py
python3 - <<'PY'
import ast, difflib
def grab(p):
    src=open(p).read(); lines=src.splitlines(); out={}
    for n in ast.parse(src).body:
        if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)):
            out[n.name]="\n".join(lines[n.lineno-1:n.end_lineno])
    return out
F, V = grab("/tmp/fork_agents.py"), grab("/tmp/v2_agents.py")
for k in ["list_agents","create_agent","update_agent","delete_agent","toggle_agent_enabled","reorder_agents"]:
    a=[l for l in F[k].splitlines() if "system_protected" not in l]
    only=[x[1:].strip() for x in difflib.unified_diff(a,V[k].splitlines(),lineterm="",n=0)
          if x.startswith("-") and not x.startswith("---") and x[1:].strip()]
    print(f"{k:22s} fork-only(去 guard 后)={len(only):3d}", only[:4])
PY

# 侵入 import 的真实数量（§8 已闭环 11）
git grep -ln -E "^(from|import) copaw|runtime_mode" main -- src/qwenpaw \
  | sed 's|^main:||' | while read f; do git cat-file -e "e111ec6f:$f" 2>/dev/null && echo "UPSTREAM-OWNED: $f"; done   # 5 个

# D-13 反哺 PR 通道（§2.4）
gh pr list --repo agentscope-ai/QwenPaw --state all --limit 100 --author futuremeng \
  --json number,state,createdAt,title   # 21 条 / MERGED 1 / CLOSED 20
gh api repos/agentscope-ai/QwenPaw/pulls/1679 --jq "[.number,.comments,.review_comments]"   # 有评审仍未合并

# 原则 3 的品牌接缝边界（§3.2）
git show upstream/main:console/src/plugins/hostSdk/install.ts | sed -n '80,115p'      # QwenPawChatNamespace 全量方法
git show upstream/main:console/src/plugins/hostSdk/install.test.tsx | sed -n '73,81p' # leftHeader.set 写 leftTitle/leftLogo
git show upstream/main:console/index.html | grep -n "<title>"                          # 硬编码，无接缝
git grep -rn -iE "branding|productName|product_name" upstream/main -- console/src src/qwenpaw | head  # 0 命中
git show upstream/main:console/src/components/ConsolePollService/index.tsx | sed -n '22,32p'  # 挂载时快照 document.title

# managed_service 契约 vs fork 的"sidecar"实况（§8 已闭环 13、WP-04）
git show upstream/main:src/qwenpaw/pawapp/service.py | sed -n '26,40p'      # _validate_loopback_host
git show upstream/main:src/qwenpaw/pawapp/service.py | sed -n '101,131p'   # ManagedServiceSpec: command+health_path 必填
git grep -c -E "socket\.|\.bind\(|find_free_port|uvicorn|HTTPServer|serve_forever" main -- src/copaw   # 0 命中 = 无 HTTP sidecar
git grep -n "NLPRuntime()" main -- src | head                              # 进程内单例
git show main:src/copaw/knowledge/siamese_uninlu_runtime.py | sed -n '220,235p;420,432p'  # 按次 subprocess.run
git show main:src/copaw/knowledge/duckdb_catalog.py | sed -n '27,33p'      # 进程内库 + 文件布局
git show main:src/qwenpaw/app/routers/sidecar.py | sed -n '240,250p;505,515p'  # 现有 ready/status 语义（要落到 dependency）
python -c "import qwenpaw.cli.cron_cmd" 2>&1 | tail -1                     # fork main 上活着的 P1 破坏

# "以仓库实际为准"复核（§8 已闭环 17）+ v2 project-directory 形貌（已闭环 18）
git status --porcelain                                                     # 只剩 ?? UPSTREAM_V2_MIGRATION_PLAN.md
git rev-parse --short main origin/main upstream/main                        # a0002eaaa / <origin=main~3> / 70715e982
git rev-list --left-right --count main...origin/main                         # 3  0  ← v1 兜底未推送
git show-ref | grep -i sync                                                  # 无 sync/v2
git log --all --oneline --grep='WP-' | head                                  # 只剩 viewport/pawport 假阳性
git rev-parse a0e138760                                                      # fatal: ambiguous → 该 id 不存在，别引用
for c in 248e61b35 c5f04f83f a0002eaaa; do git show --stat --format='%h %ad %s' --date=short $c; done
git show upstream/main:src/qwenpaw/app/routers/project_directory.py | sed -n '41,45p'   # prefix=/workspace/project-directory
git show upstream/main:src/qwenpaw/app/routers/project_directory.py | wc -l             # 1034
git show upstream/main:src/qwenpaw/services/project_directory.py | wc -l                # 734
for f in console/src/features/project-directory/SessionProjectDirectory.tsx console/src/components/ProjectSelectModal/index.tsx console/src/pages/Coding/TabbedEditor.tsx; do echo -n "$f "; git show upstream/main:$f | wc -l; done
git diff --numstat upstream/main main -- console/src/pages/Coding/TabbedEditor.tsx       # 314  783
for f in $(git diff --name-only e111ec6fb main -- console/src); do git ls-tree -r --name-only upstream/main -- $f | grep -q . || echo "GONE $f"; done | grep -c .   # 8

# P1 全仓口径（§2.1.1 / 已闭环 21）—— 关键：以 merge-base 的文件清单界定"上游自有"
python3 - <<'PY'
import subprocess
def lines(cmd): return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout.split("\n")
base = {l for l in lines("git ls-tree -r --name-only e111ec6fb") if l}
rows = []
for l in lines("git diff --numstat e111ec6fb main"):
    if not l: continue
    a, d, f = l.split("\t")
    if f in base: rows.append((int(a or 0), int(d or 0), f))
print(f"{len(rows)} files, +{sum(r[0] for r in rows)} / -{sum(r[1] for r in rows)}")   # 187 / +24985 / -12377
from collections import defaultdict
g = defaultdict(lambda: [0, 0, 0])
for a, d, f in rows:
    t = f.split("/")[0] if "/" in f else "(root)"
    g[t][0] += 1; g[t][1] += a; g[t][2] += d
for k, (n, a, d) in sorted(g.items(), key=lambda x: -x[1][1]): print(f"  {k:10} files={n:4d} +{a:6d} -{d:6d}")
PY
git diff --numstat e111ec6fb main -- pyproject.toml console/index.html README.md   # 逐条看成分：pyproject 的 +5 是依赖+package-data，index.html 是 1 改名 + 1 favicon + 8 行 Google Fonts
# D-15 命名面配对测量（§2.1.1 / 已闭环 23）：产出 22 文件 / 127 行改名对
python3 - <<'PY'
import subprocess, re
mb = "e111ec6fb"
touched = [f for f in subprocess.run(["git","diff","--name-only",mb,"main"],capture_output=True,text=True).stdout.split("\n") if f]
base = {u for u in subprocess.run(["git","ls-tree","-r","--name-only",mb],capture_output=True,text=True).stdout.split("\n") if u}
def norm(s):
    s = re.sub(r'qwen[\s_-]?paw|co[\s_-]?paw', '#', s, flags=re.I)
    return re.sub(r'[\s"\',;:]+', '', s)
tot = nfiles = 0
for f in [x for x in touched if x in base]:
    d = subprocess.run(["git","diff","--unified=0",mb,"main","--",f],capture_output=True,text=True).stdout
    adds = [l[1:] for l in d.splitlines() if l.startswith("+") and not l.startswith("+++")]
    dels = [l[1:] for l in d.splitlines() if l.startswith("-") and not l.startswith("---")]
    amap = {}
    for l in adds:
        if re.search("copaw", l, re.I): amap[norm(l)] = amap.get(norm(l), 0) + 1
    p = 0
    for l in dels:
        k = norm(l)
        if amap.get(k, 0) > 0 and re.search("qwenpaw", l, re.I): amap[k] -= 1; p += 1
    if p: nfiles += 1; tot += p; print(f"{f:56} rename-pairs {p}")
print(f"==> {nfiles} files / {tot} pure rename pairs（其余含 copaw 的新增行是功能引用）")
PY
git show e111ec6fb:pyproject.toml | grep -n 'copaw ='      # :90 —— 命令名 copaw 是上游自己发布的
git show upstream/main:pyproject.toml | grep -n 'copaw ='  # :123 —— v2 仍在，fork 一行没动
for L in en zh ja ru pt-BR id vi; do printf "%-6s " $L; git show upstream/main:console/src/locales/$L.json | grep -o -i qwenpaw | wc -l; done   # 合计 494 处界面内文案（§8 未验证 19）
# 注意：`git diff --name-only … -- tests` 给 76（含 fork 新增测试文件）；"被改的上游测试 = 10" 只有上面那段
# python 交集脚本能算出来（交集条件 = 该文件在 merge-base 就存在）。别用 wc -l 直接数。
echo "10" # tests/unit/{providers/test_openai_stream_toolcall_compat.py,providers/test_openai_provider.py,providers/test_ollama_provider.py,agents/test_session.py,agents/test_command_handler.py,app/test_agents_ordering.py,app/test_title_generator.py,workspace/test_agent_model.py,workspace/test_workspace.py} + tests/integration/test_app_startup.py

# `copaw` 是上游遗留命名层（§3.4 / 已闭环 19）
git rev-parse upstream/main agentscope-ai/main                          # 70715e982 / 2d9527bb0 —— 同一仓库
git rev-list --left-right --count agentscope-ai/main...upstream/main     # 0  1197（严格祖先）
git reflog show upstream/main | head -5                                  # 全是 fast-forward，两个 remote 同源
git show upstream/main:src/qwenpaw/constant.py | sed -n '82,94p'          # WORKING_DIR 优先 ~/.copaw
git show upstream/main:src/qwenpaw/config/config.py | sed -n '3980,4008p' # 上游自带 ~/.copaw 迁移
git show upstream/main:src/qwenpaw/cli/doctor_registry.py | sed -n '32,53p;67,93p'  # DoctorRunContext + 两个 entry-point 组
git grep -I -n -w -i copaw upstream/main -- src/qwenpaw console/src | wc -l       # 66 行命中：上游自己就在用这个词
for d in agents_square custom_channels hanlp_sidecar apps plugins skill_pool; do echo -n "$d main="; git grep -c "WORKING_DIR / \"$d\"" main -- src | wc -l | tr -d ' '; echo -n " v2="; git grep -c "WORKING_DIR / \"$d\"" upstream/main -- src | wc -l | tr -d ' '; done

# c5f04f83f：fork 的 project 上下文注入 vs v2 原生的请求级 project dir（已闭环 20 / 未验证 18）
git show c5f04f83f --stat --format='%h %ad %s' --date=short
git show c5f04f83f -- src/qwenpaw/app/routers/agent_scoped.py | sed -n '10,40p'
git show upstream/main:src/qwenpaw/app/routers/agent_scoped.py | sed -n '44,58p'        # fork 那 14 行的同形先例
git show upstream/main:src/qwenpaw/app/agent_context.py | grep -n "^def \|^async def "  # get_agent_project_dir / get_project_dir_for_request

# 树外 patch + 上游前端 CI 对 fork 不可用（§2.1.2 / 已闭环 22）
git show main:console/package.json | grep -nE '"postinstall"|"test"|"test:coverage"'    # 只有 postinstall 与 test，无 test:coverage
git show e111ec6fb:console/package.json | grep -n 'test:coverage'                        # merge-base 有 → fork 删了
git show upstream/main:console/package.json | grep -nE 'test:coverage|agentscope-ai/chat'  # v2 有脚本；SDK 钉 1.2.0-beta.1789540479556
git show main:console/package.json | grep -n 'agentscope-ai/chat'                        # fork 钉 ^1.1.64-beta.1779961389231
git show main:console/scripts/patch-chat-flushsync.mjs | grep -c 'relativePath:'          # 6 个目标文件
git show main:console/scripts/patch-chat-flushsync.mjs | grep -c 'from: ".*ReactDOM.flushSync'  # 6 处锚点
git show main:console/scripts/patch-chat-flushsync.mjs | tail -16                         # 失配→"already applied"→exit 0
```
