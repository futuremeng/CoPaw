# D-22 品牌边界 · 阶段 A 实施计划（WP-10）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 D-22 把上游文件里的 126 行 `QwenPaw → CoPaw` 改名退掉 **92 行**（阶段 A：`src/` 17 行 + docs/website 75 行），把 `test_cli_update.py` 的 6 条命名税红变成"不再存在"，并把阶段 B 的 6 个未证事实转成可执行 spike。

**Architecture:** 退回动作**全部由 fork 自有的账册工具完成，不手工改任何一行文字**。`scripts/copaw_brand.json` 里每对 `old`/`new` 是**整行文本**，`copaw_brand.py strip` 只做整行反向替换，`verify` 保证 strip→apply 逐字节可回放；范围控制用脚本现成的 `--ledger` 参数指向一个只含阶段 A 那 13 个文件的**账册切片**（切片放 `/tmp`，不进仓库）。验收用另一件现成门禁 `scripts/check_p1_invariants.py`，它已经把每个上游文件的 diff 拆成 `naming` / `behavior` 两册，所以"只退改名、没碰到行为"是可测的而不是承诺。

**Tech Stack:** Python 3.10 venv + pytest；`scripts/copaw_brand.py`、`scripts/check_p1_invariants.py`；git（`--no-renames` 口径）；node 侧只做核对（`tsc -b --noEmit` / prettier），阶段 A 不改 `console/`。

**Spec:** `docs/copaw-brand-boundary.md`（D-22 设计，提交 `462a1cf0f`）。本计划实现其 §5 阶段 A（A1–A4）与 §7 S6；§5 阶段 B 与 §7 S1–S5/S7 在本计划末尾"阶段 B：入场券"一节，**不含代码步骤，理由见该节开头**。

---

## Global Constraints

每个任务的隐含要求，逐条来自 spec 或迁移计划红线，冲突时以本节为准：

- **分支**：`wp/10-brand-stage-a`，从 **`wp/02-ownership` 的 HEAD** 分出（不是 `main`）。实测 `wp/01-p1-invariants` 与 `wp/02-ownership` 都**尚未进 main**（`git merge-base --is-ancestor` 两条都 NO），而本计划要重写的门禁基线 `scripts/p1_baseline.json` 是 WP-01 那批提交建立的，从 main 分出来会拿到旧基线。
- **不开 PR。** D-13 与本轮既定口径：先把 CoPaw 整理好，PR 需要单独明确批准。本计划所有任务的终点是"独立提交 + fast-forward push 到 `origin/wp/10-brand-stage-a`"。fast-forward 推送已预授权；force push / 改历史需先问。
- **只退 naming，不许动 behavior。** 判据不是口头承诺：每个文件 strip 后 `git diff --numstat` 的 **added 与 removed 必须都等于该文件在账册里的 pair 数**（一行改名 = 一增一减），多出来的任何一行都算越界，停下报告。
- **不许向 `src/qwenpaw` 或 `console/src` 加 `import copaw` / `copaw` 字样**（WP-01 不变式；`src/copaw` 只能是别名壳）。
- **不改上游测试**（D-17）；**不许用 `skip` / `xfail` / `filterwarnings` 消红**。阶段 A 之后那 6 条红是"消失"，不是"被屏蔽"——`tests/unit/cli/test_cli_update.py` 必须一行未动。
- **环境口径**：所有 python 命令用 `/Users/futuremeng/github/futuremeng/CoPaw/.venv/bin/python`（下称 `$PY`，Python 3.10.20），每条都带 `CI=true`；pytest 带 `PYTHONPATH=$PWD/src`；**一次只跑一个 suite，跑期间不改树**。
- **基准红**：全量 `tests/unit` 8F/3314P，其中 6 条是本次要消掉的命名税，2 条是 py3.10 无 `BaseExceptionGroup`（只能在 WP-06 抬 Python 下限时才消失）。**阶段 A 的终点是 2F**，不许把这两条算成本计划的账。
- **diff 口径**：任何"这个文件和上游差多少"的计数一律带 `--no-renames`（默认的重命名检测会漏掉改名宿主，见冲突面清单 §1）。
- **禁止用 `git checkout` 回退临时探查改动**，撤销一律用 Edit 或 `git show <ref>:<path> > <path>`。

### 关键路径变量

```bash
export COPAW_MAIN=/Users/futuremeng/github/futuremeng/CoPaw
export PY=$COPAW_MAIN/.venv/bin/python
export BASE=e111ec6fb                  # merge-base，上游 v1 共同祖先
export WP10=/Users/futuremeng/github/futuremeng/CoPaw-wp10
```

---

## 0. 本轮实测基线（写计划时取的读数，不是估的）

Task 1 会把这些数字重新取一遍并落在提交信息里。以下全部为本计划在 `wp/02-ownership` HEAD（`07754b2d8`）上实测：

| 指标 | 现在 | 阶段 A 后应得 | 来源 |
|---|---|---|---|
| `naming_lines` | **126** | **34** | `check_p1_invariants.py --target-ref working --json` |
| `naming_files`（纯改名文件） | **4** | **1**（只剩 `scripts/pack/build_win.ps1`） | 同上 |
| `naming_touched_files` | **22** | **9** | 同上 |
| P1 上游文件总数 `files` | **172** | **169** | 同上 |
| `behavior_files` | **168** | **168**（不许变） | 同上 |
| `behavior_added` / `behavior_removed` | **14932 / 2584** | **14932 / 2584**（不许变） | 同上 |
| `tests/unit/cli/test_cli_update.py` | **6 failed, 28 passed** | **0 failed, 34 passed** | 实测 4.26s |
| `tests/unit` 全量 | **8F / 3314P** | **2F** | 门禁基准 |
| `tests/unit/{app,knowledge,scripts}` | **2F / 607P / 4skip / 14xf** | 同 | 实测 791.88s |
| 账册 | 22 files / 126 lines | 9 files / 34 lines | `scripts/copaw_brand.json` |

**账册里阶段 A 的 13 个文件 / 92 对**（`src/` 17 = 7+4+3+2+1；docs/website 75 = README×4 各 2 + `cli.zh.md` 23 + `cli.en.md` 22 + `desktop.{en,zh}.md` 各 11）：

```
src/qwenpaw/cli/init_cmd.py        7    纯改名 → 完全离开 P1
src/qwenpaw/cli/desktop_cmd.py     4    混合（behavior 212/133）→ 留在 P1
src/qwenpaw/app/migration.py       3    混合（behavior 156/125）→ 留在 P1
src/qwenpaw/cli/main.py            2    纯改名 → 完全离开 P1
src/qwenpaw/cli/update_cmd.py      1    纯改名 → 完全离开 P1（6 条红的根因）
README.md / README_ja / README_ru / README_zh   2 each = 8
website/public/docs/cli.zh.md     23
website/public/docs/cli.en.md     22
website/public/docs/desktop.en.md 11
website/public/docs/desktop.zh.md 11
```

**留到阶段 B 的 9 个文件 / 34 对**：`scripts/pack/desktop.nsi` 15、`build_win.ps1` 7、`build_macos.sh` 3、`scripts/install.bat` 2、`console/src/layouts/constants.ts` 3、`console/index.html` 1、`console/src/layouts/Header.tsx` 1、`console/src/pages/Chat/OptionsPanel/defaultConfig.ts` 1、`console/src/pages/Login/index.tsx` 1。

---

### Task 1: 建 worktree 与分支，钉住基线读数

**Files:**
- Create: 分支 `wp/10-brand-stage-a`（worktree `/Users/futuremeng/github/futuremeng/CoPaw-wp10`）
- Modify: 无（本任务只读数）

**Interfaces:**
- Produces: `$WP10` 工作树；`/tmp/brand-stage-a.json`（Task 2 产出、Task 3/4 消费的账册切片路径约定）；基线四元组 `naming_lines=126 / naming_files=4 / naming_touched_files=22 / files=172`。

- [ ] **Step 1: 用 using-git-worktrees skill 开独立工作树**

在当前 `CoPaw-wp02` 仓库里执行（`git worktree add` 是这里的机制，无原生 worktree 工具可用）：

```bash
cd /Users/futuremeng/github/futuremeng/CoPaw-wp02
git worktree add "$WP10" -b wp/10-brand-stage-a wp/02-ownership
cd "$WP10" && git log --oneline -1     # 期望 07754b2d8（或当时 wp/02-ownership 的更新 HEAD）
```

**注意**：`$WP10/console/node_modules` 不存在，`wp02` 那份是临时符号链接、用完已删。阶段 A 不改 `console/`，所以不需要 node；Task 9 若要 `npm run dev` 再在 `$WP10/console` 里 `npm ci`。

- [ ] **Step 2: 确认工作树干净且账册可回放**

```bash
cd "$WP10" && git status --short && CI=true $PY scripts/copaw_brand.py verify
```

期望输出：`ledger replayable: 22 files / 126 lines`，exit 0。**这条不通过就不许进入 Task 3**（说明账册与树已不一致，先查因）。

- [ ] **Step 3: 取基线读数**

```bash
cd "$WP10" && CI=true $PY scripts/check_p1_invariants.py --target-ref working --json \
  | $PY -c "import json,sys; print(json.dumps(json.load(sys.stdin)['totals'], ensure_ascii=False, indent=1, sort_keys=True))"
```

期望：`naming_lines 126` / `naming_files 4` / `naming_touched_files 22` / `files 172` / `behavior_added 14932` / `behavior_removed 2584`（若 `wp/02-ownership` 已前进导致数字不同，**以本次实读为准**并同步改掉 §0 表与后续所有期望值；不要沿用本文件里的旧数）。

- [ ] **Step 4: 取测试基线**

```bash
cd "$WP10" && CI=true PYTHONPATH=$PWD/src $PY -m pytest tests/unit/cli/test_cli_update.py -q
```

期望：`6 failed, 28 passed, 1 warning`。

```bash
cd "$WP10" && CI=true $PY scripts/check_p1_invariants.py --check; echo "rc=$?"
```

期望：`P1 invariants hold (no growth vs baseline)` + `rc=0`。

---

### Task 2: 造阶段 A 的账册切片

**Files:**
- Create: `/tmp/brand-stage-a.json`（throwaway，不进仓库）
- Modify: 无

**Interfaces:**
- Consumes: `scripts/copaw_brand.json` 的 `{"base_ref","source_ref","files","lines","entries":[{"path","pairs":[{"old","new"}]}]}` 结构。
- Produces: Task 3/4 用的 `--ledger /tmp/brand-stage-a.json`；`_rewrite()` 只读 `entries`，`verify` 也只读 `entries`（`scripts/copaw_brand.py:120`），所以切片里 `files`/`lines` 字段填什么都不影响行为，但为可读性要填对。

- [ ] **Step 1: 按 13 个路径切出账册**

```bash
cd "$WP10" && $PY - <<'PY'
import json, pathlib
A_FILES = [
    "src/qwenpaw/cli/init_cmd.py", "src/qwenpaw/cli/desktop_cmd.py",
    "src/qwenpaw/app/migration.py", "src/qwenpaw/cli/main.py",
    "src/qwenpaw/cli/update_cmd.py",
    "README.md", "README_ja.md", "README_ru.md", "README_zh.md",
    "website/public/docs/cli.zh.md", "website/public/docs/cli.en.md",
    "website/public/docs/desktop.en.md", "website/public/docs/desktop.zh.md",
]
src = json.loads(pathlib.Path("scripts/copaw_brand.json").read_text())
by_path = {e["path"]: e for e in src["entries"]}
missing = [p for p in A_FILES if p not in by_path]
assert not missing, f"账册里没有这些文件，计划口径错了，停下报告: {missing}"
entries = [by_path[p] for p in A_FILES]
lines = sum(len(e["pairs"]) for e in entries)
assert lines == 92, f"阶段 A 期望 92 对，实得 {lines}"
out = {"base_ref": src["base_ref"], "source_ref": "stage-A-slice",
       "files": len(entries), "lines": lines, "entries": entries}
pathlib.Path("/tmp/brand-stage-a.json").write_text(
    json.dumps(out, indent=2, ensure_ascii=False) + "\n")
print(f"wrote /tmp/brand-stage-a.json: {len(entries)} files / {lines} lines")
PY
```

期望：`wrote /tmp/brand-stage-a.json: 13 files / 92 lines`。**assert 失败就停下**：说明账册内容与 §0 的文件清单不再对应，属于计划前提被推翻。

- [ ] **Step 2: 确认切片覆盖的正是那 13 个文件**

```bash
cd "$WP10" && $PY -c "
import json; d=json.load(open('/tmp/brand-stage-a.json'))
print(d['files'], d['lines'])
print(*[f\"{len(e['pairs']):3d} {e['path']}\" for e in d['entries']], sep='\n')"
```

期望：第一行 `13 92`，下面 13 行与 §0 的文件表一一对应。

---

### Task 3: A1 —— 退 `src/` 5 个文件的 17 行改名

**Files:**
- Modify（由 strip 完成）: `src/qwenpaw/cli/init_cmd.py`(7)、`src/qwenpaw/cli/desktop_cmd.py`(4)、`src/qwenpaw/app/migration.py`(3)、`src/qwenpaw/cli/main.py`(2)、`src/qwenpaw/cli/update_cmd.py`(1)
- Test（只读，不许改）: `tests/unit/cli/test_cli_update.py`

**Interfaces:**
- Consumes: `/tmp/brand-stage-a.json`；`copaw_brand.py strip --ledger`（整行反向替换，每对只替换第一处匹配，`scripts/copaw_brand.py:50-54`）。
- Produces: 3 个纯改名文件与 `$BASE` 逐字节相同；`test_cli_update.py` 0 红。

- [ ] **Step 1: 先跑一次红，确认根因还是那一行**

```bash
cd "$WP10" && CI=true PYTHONPATH=$PWD/src $PY -m pytest tests/unit/cli/test_cli_update.py -q 2>&1 | tail -3
grep -n 'Starting CoPaw update' src/qwenpaw/cli/update_cmd.py
```

期望：`6 failed, 28 passed` + 命中一行 `click.echo("Starting CoPaw update...")`。

- [ ] **Step 2: 只 strip `src/` 那 5 个文件**

```bash
cd "$WP10" && $PY - <<'PY'
import json, pathlib, subprocess
keep = ("src/",)
d = json.loads(pathlib.Path("/tmp/brand-stage-a.json").read_text())
entries = [e for e in d["entries"] if e["path"].startswith(keep)]
pathlib.Path("/tmp/brand-stage-a-src.json").write_text(json.dumps(
    {"base_ref": d["base_ref"], "source_ref": "stage-A-src",
     "files": len(entries), "lines": sum(len(e["pairs"]) for e in entries),
     "entries": entries}, indent=2, ensure_ascii=False) + "\n")
print(pathlib.Path("/tmp/brand-stage-a-src.json").read_text().count('"path"'), "files")
PY
CI=true $PY scripts/copaw_brand.py --ledger /tmp/brand-stage-a-src.json strip
```

期望：`stripped 17 rename lines, 0 unmatched`，exit 0。**`unmatched` 非 0 就停下报告**，不要手工补。

- [ ] **Step 3: 验收 A —— 改动量必须恰好是 17 增 17 减**

```bash
cd "$WP10" && git diff --no-renames --numstat -- src/qwenpaw/cli src/qwenpaw/app/migration.py
```

期望：5 行，added 合计 **17**、removed 合计 **17**，且逐文件等于 `init_cmd 7 / desktop_cmd 4 / migration 3 / main 2 / update_cmd 1`。多出来的一律视为越界，`git show <ref>:<path> > <path>` 还原该文件后重跑 Step 2。

- [ ] **Step 4: 验收 B —— 3 个纯改名文件回到 merge-base**

```bash
cd "$WP10" && git diff --exit-code $BASE -- \
  src/qwenpaw/cli/init_cmd.py src/qwenpaw/cli/main.py src/qwenpaw/cli/update_cmd.py; echo "rc=$?"
```

期望：无 diff 输出、`rc=0`。这 3 个文件从此在 P1 里消失。
（`desktop_cmd.py` 与 `migration.py` **不该**回到 merge-base —— 它们各自还有 212/133 与 156/125 的 behavior 行，留在 P1 是正确状态。）

- [ ] **Step 5: 验收 C —— 6 条红变成"不存在"，且测试文件一行未改**

```bash
cd "$WP10" && git diff --exit-code $BASE -- tests/unit/cli/test_cli_update.py; echo "test-file rc=$?"
CI=true PYTHONPATH=$PWD/src $PY -m pytest tests/unit/cli/test_cli_update.py -q 2>&1 | tail -2
```

期望：`test-file rc=0`（上游测试没被碰过）+ `34 passed`。

- [ ] **Step 6: 验收 D —— naming 读数按预期下降、behavior 一动没动**

```bash
cd "$WP10" && CI=true $PY scripts/check_p1_invariants.py --target-ref working --json \
  | $PY -c "import json,sys; t=json.load(sys.stdin)['totals']; \
print({k:t[k] for k in ('naming_lines','naming_files','naming_touched_files','files','behavior_added','behavior_removed')})"
```

期望：`naming_lines` 126→**109**、`naming_files` 4→**1**、`naming_touched_files` 22→**17**、`files` 172→**169**、`behavior_added`/`behavior_removed` **不变**。
（`naming_files` 在 A1 就掉到 1：那 4 个纯改名文件里 3 个在 `src/`，剩下唯一的纯改名文件是 `scripts/pack/build_win.ps1`，它属阶段 B 的 B1。`files` 掉到 169 同理 —— 这 3 个文件完全离开 P1，A2 之后仍是 169。Task 6 的 spec 预期"阶段 A 后 169"与此一致。）

- [ ] **Step 7: 跑受影响面的测试（CLI + token/runner 无关，只跑 cli 与 app 两处快集）**

```bash
cd "$WP10" && CI=true PYTHONPATH=$PWD/src $PY -m pytest tests/unit/cli -q 2>&1 | tail -3
```

期望：0 failed（历史基准里 CLI 只有那 6 条命名税红）。

- [ ] **Step 8: 提交**

```bash
cd "$WP10" && git add src/qwenpaw/cli/init_cmd.py src/qwenpaw/cli/main.py \
  src/qwenpaw/cli/update_cmd.py src/qwenpaw/cli/desktop_cmd.py src/qwenpaw/app/migration.py
git commit -m "$(cat <<'EOF'
D-22 阶段 A1: 退回 src/ 5 个上游文件的 17 行品牌改名

账册把 QwenPaw 改成 CoPaw 的地方全部按整行反向还原，behavior 行一根没动
（naming_lines 126→109，behavior_added/removed 不变）。init_cmd.py / main.py /
update_cmd.py 是纯改名，从此离开 P1。

顺带消掉 tests/unit/cli/test_cli_update.py 的 6 条红：那 6 条是上游测试断言
"Starting QwenPaw update..."，fork 把 echo 改成了 CoPaw。测试文件一行未改，
红不是被屏蔽掉的，是不再存在。
EOF
)"
```

---

### Task 4: A2 —— 退 docs/website 8 个文件的 75 行改名

**Files:**
- Modify: `README.md`、`README_ja.md`、`README_ru.md`、`README_zh.md`（各 2）、`website/public/docs/cli.zh.md`(23)、`cli.en.md`(22)、`desktop.en.md`(11)、`desktop.zh.md`(11)

**Interfaces:**
- Consumes: `/tmp/brand-stage-a.json`（取其中非 `src/` 的 8 条 entry）。
- Produces: `naming_lines` 109→34、`naming_touched_files` 17→9。

- [ ] **Step 1: strip docs 切片**

```bash
cd "$WP10" && $PY - <<'PY'
import json, pathlib
d = json.loads(pathlib.Path("/tmp/brand-stage-a.json").read_text())
entries = [e for e in d["entries"] if not e["path"].startswith("src/")]
assert len(entries) == 8 and sum(len(e["pairs"]) for e in entries) == 75
pathlib.Path("/tmp/brand-stage-a-docs.json").write_text(json.dumps(
    {"base_ref": d["base_ref"], "source_ref": "stage-A-docs",
     "files": 8, "lines": 75, "entries": entries}, indent=2, ensure_ascii=False) + "\n")
PY
CI=true $PY scripts/copaw_brand.py --ledger /tmp/brand-stage-a-docs.json strip
```

期望：`stripped 75 rename lines, 0 unmatched`。

- [ ] **Step 2: 验收 —— 恰好 75 增 75 减，且这 8 个文件不许离开 P1**

```bash
cd "$WP10" && git diff --no-renames --numstat -- README.md README_ja.md README_ru.md README_zh.md website/public/docs
```

期望：8 行，added 合计 **75**、removed 合计 **75**（`cli.zh 23 / cli.en 22 / desktop.en 11 / desktop.zh 11 / README×4 各 2`）。

```bash
cd "$WP10" && git diff --exit-code $BASE -- README.md; echo "README rc=$?（期望非 0）"
```

期望：`README rc=1` 且有 diff —— fork 在 4 篇 README 里自写的 58–68 行内容属 behavior 册，**必须还在**。**不许宣称这 8 个文件变成"未触碰"**；若 `rc=0` 说明把 fork 自写内容一起删了，立刻还原重做。

- [ ] **Step 3: 抽查一处"半改"确实被修复**

spec §2.4 记的三处不一致里有一处在文档：`migration.py` 的 docstring 现在指回真实标识符 `qwenpaw_source_index`。

```bash
cd "$WP10" && grep -n "qwenpaw_source_index\|copaw_source_index" src/qwenpaw/app/migration.py
```

期望：只出现 `qwenpaw_source_index`，`copaw_source_index` 命中 0（Task 3 已退，这里是回归确认文档行不再描述一个不存在的名字）。

- [ ] **Step 4: 验收 —— naming 到阶段 A 终点**

```bash
cd "$WP10" && CI=true $PY scripts/check_p1_invariants.py --target-ref working --json \
  | $PY -c "import json,sys; t=json.load(sys.stdin)['totals']; \
print({k:t[k] for k in ('naming_lines','naming_files','naming_touched_files','files','behavior_added','behavior_removed')})"
```

期望：`naming_lines` **34**、`naming_files` **1**、`naming_touched_files` **9**、`files` **169**、behavior 两项**不变**。

- [ ] **Step 5: 提交**

```bash
cd "$WP10" && git add README.md README_ja.md README_ru.md README_zh.md website/public/docs
git commit -m "$(cat <<'EOF'
D-22 阶段 A2: 退回 README×4 与 website/public/docs×4 的 75 行品牌改名

naming_lines 109→34、naming_touched_files 17→9。这 8 个文件仍留在 P1：
README 各自还有 58-68 行 fork 自写内容，cli/desktop 文档还有 2 行（或 0/2）
behavior 改动，本提交一律未动。
EOF
)"
```

---

### Task 5: A3 —— 重导账册，让 CI 门禁跟着缩小

**Files:**
- Modify: `scripts/copaw_brand.json`
- Modify: 无 `.github` 改动（B4 才删 verify 步骤）

**Interfaces:**
- Consumes: `copaw_brand.py export --target-ref working`（从 base..worktree 重算整行改名对，`scripts/copaw_brand.py:60-84`）。
- Produces: 账册 = 9 files / 34 lines；`copaw_brand.py verify` 逐字节通过。

- [ ] **Step 1: 重导**

```bash
cd "$WP10" && CI=true $PY scripts/copaw_brand.py export --target-ref working
```

期望：`wrote scripts/copaw_brand.json: 9 files / 34 rename lines`。
（`source_ref` 会写成字面量 `working`，无害：`verify` 与 `apply/strip` 只读 `entries`，不读这个字段。）

- [ ] **Step 2: 核对账册内容正是阶段 B 那 9 个文件**

```bash
cd "$WP10" && $PY -c "
import json; d=json.load(open('scripts/copaw_brand.json'))
print(d['files'], d['lines'])
print(*[f\"{len(e['pairs']):3d} {e['path']}\" for e in d['entries']], sep='\n')"
```

期望：`9 34`；文件清单与 §0"留到阶段 B"那 9 行**完全一致**（`desktop.nsi 15 / build_win.ps1 7 / build_macos.sh 3 / install.bat 2 / constants.ts 3 / index.html 1 / Header.tsx 1 / defaultConfig.ts 1 / Login/index.tsx 1`）。差一个文件就是 strip 漏退或多退，停下核对，不要继续。

- [ ] **Step 3: 门禁回放性**

```bash
cd "$WP10" && CI=true $PY scripts/copaw_brand.py verify; echo "rc=$?"
```

期望：`ledger replayable: 9 files / 34 lines` + `rc=0`。

- [ ] **Step 4: 确认账册 diff 只缩不歪**

```bash
cd "$WP10" && git diff --numstat -- scripts/copaw_brand.json
git diff -- scripts/copaw_brand.json | grep -c '^-.*"path"'
```

期望：删除侧 `"path"` 行数 = **13**（阶段 A 那 13 个文件离开账册），新增侧 0（其余 9 条 entry 内容逐字不变）。

- [ ] **Step 5: 提交**

```bash
cd "$WP10" && git add scripts/copaw_brand.json
git commit -m "$(cat <<'EOF'
D-22 阶段 A3: 重导命名账册到 9 文件 / 34 行

账册从 22/126 缩到 9/34，只剩 scripts/pack/*（27）与 console/*（7）——
两者都要等 §4 的 fork 自有构建 overlay 和品牌位（阶段 B）。
CI 的 copaw_brand.py verify 仍逐字节通过。
EOF
)"
```

---

### Task 6: A4 —— 重记 P1 门禁基线

**Files:**
- Modify: `scripts/p1_baseline.json`

**Interfaces:**
- Consumes: `check_p1_invariants.py --write-baseline`（默认写 `scripts/p1_baseline.json`，`:33/:224-232`）。
- Produces: `--check` 以新的低水位为参照。

- [ ] **Step 1: 先证明旧基线下 --check 仍过（只减不增）**

```bash
cd "$WP10" && CI=true $PY scripts/check_p1_invariants.py --check; echo "rc=$?"
```

期望：`P1 invariants hold (no growth vs baseline)` + `rc=0`。门禁只禁止增长，所以这一步必须先绿，证明阶段 A 没有把任何 behavior 涨上去。

- [ ] **Step 2: 重写基线**

```bash
cd "$WP10" && CI=true $PY scripts/check_p1_invariants.py --write-baseline
CI=true $PY scripts/check_p1_invariants.py --check; echo "rc=$?"
```

期望：`wrote scripts/p1_baseline.json (169 files)`，随后 `--check` 仍 `rc=0`。

- [ ] **Step 3: 核对新基线的读数**

```bash
cd "$WP10" && $PY -c "
import json; t=json.load(open('scripts/p1_baseline.json'))['totals']
print({k:t[k] for k in ('naming_lines','naming_files','naming_touched_files','files','behavior_files','behavior_added','behavior_removed')})"
```

期望：`naming_lines 34`、`naming_files 1`、`naming_touched_files 9`、`files 169`、`behavior_files 168`，behavior 两项与 Task 1 Step 3 实读数一致。

- [ ] **Step 4: 记录一条新基线的副作用（写进提交信息，不写代码）**

3 个纯改名文件从基线 `files` 里消失。此后若有人再动 `init_cmd.py`/`main.py`/`update_cmd.py`，门禁会报 `NEW upstream-owned file touched` —— 这正是 D-22 R1 要的绊线，不是回归。

- [ ] **Step 5: 提交**

```bash
cd "$WP10" && git add scripts/p1_baseline.json
git commit -m "$(cat <<'EOF'
D-22 阶段 A4: P1 门禁基线重记为 169 文件 / naming_lines 34

init_cmd.py、main.py、update_cmd.py 已离开上游文件被改动集合，因此从基线里
消失；将来再动这三个文件会直接报 NEW upstream-owned file touched，这是 D-22
R1（禁改名）要的绊线。
EOF
)"
```

---

### Task 7: 全量回归

- [ ] **Step 1: 全量 `tests/unit`**

```bash
cd "$WP10" && CI=true PYTHONPATH=$PWD/src $PY -m pytest tests/unit \
  --ignore=tests/unit/channels -q 2>&1 | tail -5
```

期望：**2 failed**，且两条都是 `NameError: name 'BaseExceptionGroup' is not defined`（`tests/unit/app/test_mcp_stateful_client.py::test_log_http_lifecycle_exception_for_{status,read}_error`）。8F → 2F 就是阶段 A 的账。**出现任何别一条红就停下排查。**

- [ ] **Step 2: 其余两道门禁**

```bash
cd "$WP10" && CI=true $PY scripts/check_p1_invariants.py --check; echo "p1 rc=$?"
CI=true $PY scripts/check_namespace_boundaries.py --upstream-ref upstream/main; echo "ns rc=$?"
```

期望：两道都 `rc=0`。（namespace 门禁是 CI 里 P1 之前的那一步，`unit-tests.yml:73-75`；本地 `upstream/main` 已 fetch 到 `80e412da9`。）

- [ ] **Step 3: 前端零改动确认**

```bash
cd "$WP10" && git diff --name-only $BASE...HEAD -- console | grep . && echo "意外：动了 console" || echo "console 未动 ✓"
```

期望：`console 未动 ✓`。

---

### Task 8: 推送并汇报（不开 PR）

- [ ] **Step 1: 推送分支**

```bash
cd "$WP10" && git log --oneline wp/02-ownership..HEAD    # 应为 A1/A2/A3/A4 四条
git push -u origin wp/10-brand-stage-a
```

fast-forward 推送已预授权；**不开 PR**（D-13 + 本轮"先把 CoPaw 整理好"口径）。

- [ ] **Step 2: 汇报口径**

一次说完四件事：`naming_lines 126→34`、`P1 文件 172→169`、`test_cli_update 6F→0 且测试文件未被改`、`全量 8F→2F（剩两条是 py3.10 BaseExceptionGroup，归 WP-06）`。

---

### Task 9: S6 —— 过渡期可见品牌核对（spike，阶段 A 之后、WP-06 之前）

spec §6 第 3 条的例外**只保护顶栏那几行**。阶段 A 把 CLI 与文档里的 CoPaw 收回去了，需要一次真实观察确认没有第二处产品内痕迹被顺带退掉。

**先给已实测的事实**（本计划取证时得出，spike 只需验产品在跑时的样子）：账册里 `old` 是**上游行**（QwenPaw）、`new` 是 **fork 行**（CoPaw），所以"退回前树上显示 CoPaw、退回后显示 QwenPaw"。阶段 A 退掉的 17 个 `src/` 行里，**会在运行时被用户看到**的是这 4 处（其余 13 行是 docstring / 帮助正文）：

| 位置 | 退回前（CoPaw） | 退回后（QwenPaw） | 入口 |
|---|---|---|---|
| `cli/main.py`（2 行） | `@click.version_option(prog_name="CoPaw")` + `"""CoPaw CLI."""` | `prog_name="QwenPaw"` + `QwenPaw CLI.` | `copaw --version` / `copaw --help` |
| `cli/init_cmd.py`（7 行） | welcome 正文 6 行 + Rich 标题 `title="[bold]📊 Help improve QwenPaw[/bold]"` 的对应 CoPaw 版 | 全部说 QwenPaw | `copaw init` 交互界面 |
| `cli/desktop_cmd.py`（4 行，其中 1 行可见） | `click.echo(f"Starting CoPaw app on {url} …")` | `Starting QwenPaw app on …` | `copaw desktop` |
| `cli/update_cmd.py`（1 行） | `click.echo("Starting CoPaw update...")` | `Starting QwenPaw update...` | `copaw update` |

另有一处非运行时、但面向外部读者：**README×4 与 website 4 篇文档的 75 行**（公开文档站与仓库首页）。

**这不是回归**：D-22 §4 明确"维持上游命名：PyPI `qwenpaw`、Docker、CLI `qwenpaw`（`copaw` 作为已有新增 entry 保留）"。`copaw` 这个**命令名**继续存在（`pyproject.toml:96-99` 的 entry point 是 fork 自加的、属 R2 允许的新增），变的只是命令**说出来的话**。

- [ ] **Step 1: 目视跑一遍产品内路径**

```bash
cd "$WP10/console" && npm ci && CI=true npm run dev
```

在浏览器里过：顶栏 logo/标题（应仍是 CoPaw —— §6 例外 3 保护到 B2）、`/login` 页、Chat 欢迎区、任意 CoPaw 专属页（Projects / Pipelines / RPA）。

- [ ] **Step 2: 记录**

把"除顶栏外是否还有第二处 CoPaw 痕迹被 A 退掉"写成一句结论，追加到 `docs/copaw-brand-boundary.md` §7 的 S6 行（同一提交里只改这一行）。若答案是"有"，**不要顺手补**——那是阶段 B 的 B2/B3 范围，登记为 §7 的新未证项或计划外工作项并停下问用户。

- [ ] **Step 3: 若 Step 1 需要 node 依赖，收尾时删掉它以免污染工作树**

```bash
cd "$WP10/console" && du -sh node_modules && rm -rf node_modules
git status --short   # 期望无输出
```

---

## 阶段 B：入场券（不在此计划里写代码，理由如下）

阶段 B 的 4 个动作（B1 退 pack 27 行、B2 退 console 7 行 + slot 化顶栏、B3 注册 CoPaw 品牌位、B4 删账册与 CI 步骤）**现在无法写出可执行且正确的代码步骤**，三个硬前提：

1. **宿主接缝在现树不存在。** 实测 `git grep '<Slot' HEAD -- console/src/layouts` 命中 **0**，`console/src/layouts/AppBrand.tsx` 不存在（这两个文件只在 `upstream/main` 有：`AppBrand.tsx` + `AppBrand.test.tsx`）。B3 的代码要对着 v2 的 `Slot.tsx` / `hostSdk` 写，写在这棵树上必然错。
2. **B1 的顺序不能反，而 overlay 还没跑通过。** spec §5 B1 明写"先建 overlay 并跑通，再退 pack 27 行，否则装机名出现真空"。跑通要靠 S1 的真构建，未做。
3. **B4 的判据是 `naming_lines = 0`**，前 3 步没完它不可能成立；且 B4 删的是本计划 Task 5 正在重导的那两个文件（`scripts/copaw_brand.py`、`scripts/copaw_brand.json`）与 `.github/workflows/unit-tests.yml:81` 那一行 verify，同时把 `check_p1_invariants.py` 的 naming 门禁从"只减不增"（`scripts/check_p1_invariants.py:280-285`）改成"必须 0"。

因此本节只交付**spike 任务**（每个都有可执行命令与判据，输出是一个答案而不是代码）+ **B1–B4 的范围与验收**（作为 spike 之后那份计划的输入）。

### Spike 任务（WP-06 换基线之后、B1 之前）

- [ ] **S1（0.5d）`tauri build --config` 能否产出 CoPaw 产物名**
  - 读 `console/src-tauri/tauri.conf.json` 的 `productName: "QwenPaw Desktop"`、`identifier: io.agentscope.qwenpaw.desktop`、`bundle.targets: ["app","nsis"]`，以及 nsis 自定义模板 `console/src-tauri/nsis/tauri-installer.nsi`（品牌行在 `:53-57`）。
  - 做：一次真构建，`tauri build --config <fork 自有 json 覆盖 productName>`。
  - 判据：产物 `.app` 文件名 + `Info.plist` 的 `CFBundleName` 是 CoPaw。**不通过就退到 spec §4 未选的备选**（fork 自有 pack 目录副本），并据此改写 B1。

- [ ] **S7（0.5d）只改 `productName`、维持 `identifier` 的安装行为**（spec §6 第 2 条）
  - 判据：一次覆盖安装确认是**原地升级**而非并存新 app、老用户数据可读。这条不过，§6 第 2 条要重裁。

- [ ] **S2（0.5d）品牌位 render 里按路由 `return children` 的写法**
  - 契约已由读码确立：`console/src/plugins/registry/Slot.tsx:30-42`，`kind="replace"` 把宿主默认内容作为 `children` 传进插件 render（`:41`），注释原文允许插件"opt out of replacement on a per-render basis"。
  - 做：参照 v2 `plugins/registry/__tests__/Slot.test.tsx` 写一个 vitest，断言同一路由下 `/copaw` 渲染 CoPaw、`/chat` 渲染上游内容。
  - 判据：一绿一红两条断言同时成立（即真的按路由分岔，不是恒等于某一支）。

- [ ] **S5（0.25d）`route.replace(pluginId, "core.root", …)` 的作用域与多插件竞争**
  - 已读码的两条约束：`store.ts` 的 `replace` 对 `targetId` **无白名单**；`Slot.tsx:31` 用 `entries.find((e) => e.kind === "replace")` ⇒ **一个 replace 位只有一个赢家**。
  - 做：一次真实注册观察 —— 同时注册两个想换同一位的插件，看谁赢、D-12 默认落地页能否只作用于 CoPaw 自有路由。
  - 判据：写下实际行为（不许写"应该可以"）。D-12 依赖这条。

- [ ] **S3（0.25d）CoPaw 专属界面清单**
  - 输入：fork 自有 206 个 `console/src` 新文件（冲突面清单 §3 簇 D）。
  - 输出：一张 `route → 是否 CoPaw 界面` 的表，作为品牌位判定的**唯一真源**；必须逐条回答 Knowledge / Projects / Pipelines / RPA 算不算。

- [ ] **S4（0.25d）注册时序：CoPaw 插件是否早于首次 `AppBrand` 渲染**
  - 判据：一次真实加载观察；若晚，首屏会闪上游品牌，B3 要改成同步注册路径。

### B1–B4 的范围与验收（写给 spike 之后的那份计划）

| 步 | 动作 | 精确文件 | 验收（实测过的现值 → 目标） |
|---|---|---|---|
| **B1** | 建 fork 自有构建 overlay，**然后**退 pack 改名 | 新增 `.github/workflows/copaw-desktop.yml` + overlay 包装；退回 `$BASE` 的：`scripts/pack/desktop.nsi`(15)、`build_win.ps1`(7)、`build_macos.sh`(3)、`scripts/install.bat`(2) | 产物名 / `Name` / `InstallDir` / 快捷方式 = CoPaw；这 4 个文件与 `$BASE` 逐字节相同；`build_win.ps1` 离开 P1 ⇒ `naming_files` 1→0 |
| **B2** | 退 console 7 行改名 + 顶栏 fork 自写品牌 markup 改走品牌位 | 退回 `$BASE` 的：`console/src/layouts/constants.ts`(3)、`console/index.html`(1)、`layouts/Header.tsx`(1)、`pages/Chat/OptionsPanel/defaultConfig.ts`(1)、`pages/Login/index.tsx`(1) | 上游自有 console 文件零品牌改名；`Header.tsx` 的 behavior 行随之减少（**数字不预判**，§1.1 那行注了原因：顶栏 `<span>CoPaw</span>` 与 `src="/copaw-icon.svg"` 是新增行 = behavior，不是 naming） |
| **B3** | 注册 CoPaw 品牌位插件 | **新增 fork 自有 bundle**（实测：`git diff --name-status $BASE HEAD -- plugins` 里新增文件为 **0**，fork 在 `plugins/` 下一片空白；照 v2 `plugins/bundle/cloudpaw/ui/src/index.ts` 的形状放 `plugins/bundle/copaw/ui/src/index.ts`） | 用 `provider.getConfig` 覆写 `theme.leftHeader.title` / `welcome.avatar`（CloudPaw 已在用的第一方子品牌做法，spec §2.1）+ `slotKeys.ts:23-38` 的 `ChatScalar`；S2/S3/S4/S5 四条判据全过 |
| **B4** | 删账册与 CI 步骤，naming 门禁升级为"必须 0" | 删 `scripts/copaw_brand.py`、`scripts/copaw_brand.json`；删 `.github/workflows/unit-tests.yml:81` 那一行；改 `scripts/check_p1_invariants.py:280-285` 的 `naming_lines > prev` 判定为 `!= 0` 即红 | `naming_lines 0` / `naming_files 0` / P1 `files` **168**；全量 `tests/unit` **0F**（B4 之后只剩 py3.11 抬上来的那 2 条自动消失） |

### 阶段 A 之后立刻要做的两件登记

- [ ] **Task 10：把 WP-10 与阶段 A 结果登记进迁移计划**
  - Modify: `UPSTREAM_V2_MIGRATION_PLAN.md`
  - 在 WP 列表里加一行 `### WP-10 品牌边界阶段 A（0.5d，前置 WP-01；D-22）`（编号 10 实测未被使用：现有 WP-00…09、11），并在 §2 的 P2 行按冲突面清单 §4.6/§4.8 的口径改写（那节还挂着一条"命名册 126 行"的旧读数）。
  - 更新 `docs/copaw-brand-boundary.md` 三处：**(a)** 第 3 行状态改为 `阶段 A 已实施（分支 wp/10-brand-stage-a，四条提交短号见 git log wp/02-ownership..wp/10-brand-stage-a），阶段 B 待 WP-06 + S1/S2/S5`；**(b)** §7 表 S6 行的"待证"补上 Task 9 那句结论；**(c)** §8 最后一行"本 spec 通过后另出实施计划"改为指向 `docs/superpowers/plans/2026-10-01-d22-brand-boundary-stage-a.md`。

---

## 风险与已知代价（逐条都有来源，不是设想）

1. **CLI 可见品牌退回 QwenPaw。** 具体 5 处见 Task 9 的表。依据是 D-22 §4 自己维持 `CLI qwenpaw` 的决定；命令名 `copaw` 不变。若用户不接受，唯一合规路径是 fork 自有发布 overlay 在构建期产出替换后的文本 —— 那是一个新 spike，不在本计划里。
2. **Web 标签标题与 favicon 会显示 QwenPaw**（阶段 A 之后 `console/index.html` 的 1 行留到 B2 退，所以现在还没变；B2 退完就固定为上游）。v2 的 `<title>` / favicon **没有任何 slot 接缝**，spec §6 第 1 条已裁为"接受"。
3. **装机名出现真空**只在 B1 顺序颠倒时发生，阶段 A 不碰 `scripts/pack/`，所以本计划无此风险；写在这里是给 B1 那一步的执行者。
4. **账册缩小后 `verify` 仍是活的门禁**：B4 之前不能删。任何"顺手再退一行 CoPaw"的改动都会让 Task 5 重导的账册与树不符 ⇒ CI 红。
5. **阶段 A 与 WP-02(d) 无交集**：本计划只动 13 个上游文件的既有行 + 两个账册/基线 JSON，不碰 `src/copaw`、不碰归属矩阵那 12 行。
