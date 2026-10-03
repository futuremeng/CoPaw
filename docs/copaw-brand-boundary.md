# CoPaw 品牌边界（D-22 设计）

- 状态：**阶段 A 已实施**（分支 `wp/12-brand-stage-a`，四条提交见 `git log --oneline wp/02-ownership..wp/12-brand-stage-a`；原拟编号 WP-10 已被"切主"占用，故为 WP-12）；阶段 B 待 WP-06 + S1/S2/S5 探针。原"待用户复审"随阶段 A 的实施结案；本文所有 126/92 的旧读数按 §1.1 末尾的更正块读。**2026-10-03 复审真正结案**：唯一的开放项是仓库 README banner，裁定见 §6.1（选项 B），同时用 R2 射程条款修掉了 R2 字面与 §5 A2-① 的矛盾。
- 日期：2026-10-01
- 取代：D-15「可见品牌与分发物包括命令等命名都叫 Copaw」中"把上游既有文字改名"的全部做法
- 关闭：D-21「界面内正文品牌名」（裁为承认上游界面叫 QwenPaw，理由见 §3.4）
- 作废：D-17 收下的 6 条 `tests/unit/cli/test_cli_update.py` 命名税红
- 改写：原则 3 的边界措辞（原文承认"fork 已在界面外挂了产品名 patch，见 D-15"）
- 前置：阶段 B 依赖 WP-06（同步 v2）；阶段 A 不依赖

---

## 1 规则

**命名只随所有权走。** 三条推论：

- **R1（禁改名）** 上游自有文件（在 base-ref `e111ec6fb` 已存在）里，不许把上游既有文字中的 `QwenPaw` 改成 `CoPaw` —— 文案、docstring、logo 引用、注册表键、安装包名都不改。**这条只管"改名"，不管"新增"**：在上游自有文件里新写的行落在 `behavior` 册，由 D-8 与封闭清单管，不归本规则管（判别式见 §1.1，这正是现有脚本的口径）。
- **R2（正面表述）** `CoPaw` 这个名字应当只出现在 **fork 自有文件**（base-ref 不存在）里，或经 **上游原生接缝**（`<Slot>` replace/fill、`hostSdk` / PawApp setter、`provider.getConfig` 覆写、`route.replace`）注入。
  - **射程（2026-10-03 裁定，见 §6.1）**：R2 只管两类事 —— **改名**（把上游既有文字里的 `QwenPaw` 换成 `CoPaw`）与**界面品牌注入**（console 侧可见品牌位必须走接缝）。**上游自有文件里"新写的"行不在 R2 射程内**（典型 = 仓库 README 顶部的 fork banner），它按 D-8 / P1-行为册计价管理，不按违规处理。这条裁定修掉了 R2 字面与 §5 A2-① 之间的原有矛盾。
- **R3（分发物）** 分发物的命名由 **fork 自有的构建 overlay** 决定，实现方式不许是"改上游构建脚本"。

### 1.1 判别式（不需要新脚本）

`scripts/check_p1_invariants.py` 已经把每个上游文件的 diff 拆成两册，`naming` 的定义就是"一个纯品牌改名：把 `qwenpaw`/`copaw` token（任意大小写）换成占位符后，删行与增行逐字节相同"。所以本规则的可测形式是一条现有指标：

```
naming_lines:  122 → 34（阶段 A）→ 0（阶段 B）      现在只承诺"只减不增"，B4 升级为"必须 = 0"
```

按这个口径核出来的当前 22 个命名册文件（数据取自 `check_p1_invariants.py --target-ref working --json`，本轮实测）：

| 文件 | naming | behavior +/− | 阶段 | 退完是否离开 P1 |
|---|---|---|---|---|
| `src/qwenpaw/cli/init_cmd.py` | 7 | 0 / 0 | A1 | **是（纯改名）** |
| `src/qwenpaw/cli/main.py` | 2 | 0 / 0 | A1 | **是（纯改名）** |
| `src/qwenpaw/cli/update_cmd.py` | 1 | 0 / 0 | A1 | **是（纯改名，6 条红的根因）** |
| `src/qwenpaw/app/migration.py` | 3 | 156 / 125 | A1 | 否 |
| `src/qwenpaw/cli/desktop_cmd.py` | 4 | 212 / 133 | A1 | 否 |
| `README.md` / `_ja` / `_ru` / `_zh` | 1×4（判定修复前核为 2×4，见下方更正） | 58/17、63/20、65/20、68/17 | A2 | 否（各自还有 60–70 行 fork 自写内容） |
| `website/public/docs/cli.en.md` | 22 | 2 / 2 | A2 | 否 |
| `website/public/docs/cli.zh.md` | 23 | 2 / 2 | A2 | 否 |
| `website/public/docs/desktop.en.md` | 11 | 0 / 2 | A2 | 否 |
| `website/public/docs/desktop.zh.md` | 11 | 0 / 2 | A2 | 否 |
| `scripts/pack/build_win.ps1` | 7 | 0 / 0 | B1 | **是（纯改名）** |
| `scripts/pack/desktop.nsi` | 15 | 1 / 1 | B1 | 否 |
| `scripts/pack/build_macos.sh` | 3 | 15 / 2 | B1 | 否 |
| `scripts/install.bat` | 2 | 6 / 2 | B1 | 否 |
| `console/index.html` | 1 | 11 / 1 | B2 | 否 |
| `console/src/layouts/Header.tsx` | 1 | 7 / 5 | B2 | 否（顶栏那几行 CoPaw 里只有 `alt` 是改名，`src="/copaw-icon.svg"` 与 `<span>CoPaw</span>` 是新增行 = behavior） |
| `console/src/layouts/constants.ts` | 3 | 8 / 0 | B2 | 否 |
| `console/src/pages/Chat/OptionsPanel/defaultConfig.ts` | 1 | 1 / 1 | B2 | 否 |
| `console/src/pages/Login/index.tsx` | 1 | 3 / 2 | B2 | 否 |

合计 naming 126、文件 22（4 个纯改名 + 18 个混合）。**P1 债的准确预期**：阶段 A 后 `naming_lines` 126→34、`naming_files` 4→1、`naming_touched_files` 22→9、**P1 文件数 172→169**（3 个纯改名文件完全离开 P1）；阶段 B 后再退 34 行、`build_win.ps1` 离开 ⇒ **168 文件 / naming_lines 0**。B2 若把 Header 顶栏的自写品牌行也 slot 化，会额外减 behavior，那条不预判数字。
>
> **更正（2026-10-01，阶段 A 实施时实测，提交 `860d8abac`）**：上面的 **126 里有 4 行虚账**。`pair_rename_lines` 用"抹掉品牌 token 后逐字节相同"给删行与增行配对，于是**同一行被挪动位置**也会配成一对 —— 4 篇 README 各有 1 对 `old==new` 的 `<img ... alt="QwenPaw Logo" ...>`（fork 重排了头部区块，文字未改）。它不是改名，`copaw_brand.py strip` 对它天然是空操作（`src==dst` 直接跳过）。判定修好后：**真实改名 = 22 文件 / 122 行**，README 每文件从 2 降到 1，阶段 A 实退 **88 行**（`src` 17 + `website/docs` 67 + README 4），而阶段 A 的**终点读数与本表承诺一致**（`naming_lines` 34 / `naming_touched_files` 9 / `files` 169）—— 目的地没错，只是里程表此前多记了 4 行。这条必须修：B4 的门禁是 `naming_lines 必须 = 0`，不修就永久卡在 4。

---

## 2 为什么比 D-15 合理（本轮实测，不是估计）

### 2.1 上游自己就这么做子品牌：CloudPaw

`plugins/bundle/cloudpaw/ui/src/index.ts:2612-2624`（**该文件与 merge-base 逐字节相同，fork 从未改过；fork 点和 v2 都有这个 bundle**）：

```ts
provider.getConfig = function (t) {
  const base = originalGetConfig(t);
  return { ...base,
    theme:  { ...base.theme, leftHeader: { ...base.theme?.leftHeader, title: "Work with CloudPaw" } },
    welcome:{ ...base.welcome, avatar: CLOUDPAW_LOGO_URL } };
};
```

外加 `:2438` 的 `window.QwenPaw.registerRoutes?.("cloudpaw", [...])`。即：**第一方子品牌 CloudPaw 用宿主给的接缝给自己的界面命名，全程不改宿主的名字。** 这条把 D-22 从"我们的偏好"变成"上游的既有惯例"。

### 2.2 命名册现在就压着 6 条红，根因是一行

`src/qwenpaw/cli/update_cmd.py:716` 被账册改为 `click.echo("Starting CoPaw update...")`，而上游自有测试 `tests/unit/cli/test_cli_update.py` 在 7 处断言 `"Starting QwenPaw update..."`。本轮实测：

```
CI=true pytest tests/unit/cli/test_cli_update.py -q → 6 failed, 28 passed, 1 warning in 2.27s
```

全量 `tests/unit` 基准的 8 条红里，**6 条就是这一行**（另 2 条是 py3.10 无 `BaseExceptionGroup`，WP-06 抬 Python 下限时自动消失）。D-17 当时把这条判为"上游测试不可见、不动"的永久豁免；新规则下它不是豁免，是**不再存在**。

### 2.3 命名册已经改到"安装身份"，不只是可见文案

`scripts/pack/desktop.nsi` 的 15 个 pair 里包含 `InstallDir "$LOCALAPPDATA\CoPaw"`、`InstallDirRegKey HKCU "Software\CoPaw" "InstallPath"`、`WriteRegStr HKCU "Software\CoPaw"`、`DeleteRegKey HKCU "Software\CoPaw"` 与 4 条快捷方式名。这从"品牌字样"越到了**装机路径与注册表键**：从上游版本升级或卸载时，旧键 `Software\QwenPaw` 读不到 ⇒ 可预期地不复用旧安装目录、旧名快捷方式不在新卸载段清理范围内。（这是**从脚本源码直接读出的行为**，未实机验证。）这一层从未被 D-15 单独裁过 —— D-15 只裁过"pip 包名不改"。

### 2.4 半改导致的是不一致，不是品牌

| 位置 | 现状 |
|---|---|
| `scripts/pack/build_macos.sh` | `:11 APP_NAME="CoPaw"`（账册改的），但 `:194` 产物名仍是 `QwenPaw-${VERSION}-macOS.zip`，`:186` macOS 权限文案仍是 QwenPaw |
| `desktop.nsi` × `build_win.ps1` | `desktop.nsi:14-15` 的 `OUTPUT_EXE` 默认值被改成 `CoPaw-Setup-…`，但 `build_win.ps1:298` 算出 `QwenPaw-Setup-$Version.exe` 并在 `:304` 用 `/DOUTPUT_EXE` 覆盖 ⇒ **今天真实产出的安装包文件名仍叫 QwenPaw** |
| `src/qwenpaw/app/migration.py` | 账册把 docstring 里的标识符引用改成 `copaw_source_index`，而真实标识符没改 ⇒ 文档行现在描述一个不存在的名字 |

### 2.5 界面正文里那批 QwenPaw 不是自指品牌，改名会改错语义

v2 `console/src/locales/zh.json` 抽样（大小写敏感 `QwenPaw` 全仓 376 处 / 335 行 / 7 个 JSON）：

- `:408` `"QwenPaw、Codex 和 Qoder 配置"` —— 指被管理的上游 runtime，与 Codex/Qoder 并列
- `:855` `"QwenPaw 原生智能体"`、`:860` `"不依赖 QwenPaw 模型"` —— 用来区分第三方 agent runtime
- `:302` `"QwenPaw 菜单"`、`:296` 应用兼容性告警 `"您当前的 QwenPaw 版本为 {{version}}"` —— 指上游发布物本身

（**抽样判断，不是 376 处的全量分类**；结论方向不受影响：改这 376 处既不划算也不安全。规格化之前若要引用"多少处是指称对象"，需要一次逐 key 归类。）

### 2.6 仓库里已有的同构先例

| 先例 | 做法 |
|---|---|
| `pyproject.toml:96-99` | 包名保留上游 `qwenpaw`，只**新增** `copaw = "copaw.cli.main:cli"`；注释明写"src/qwenpaw 里不出现 copaw 引用、src/copaw 可整目录摘除"。`src/copaw/cli/main.py:1-9` 同义：两个入口共享全部核心命令，overlay 只在 `copaw` 侧挂 `app` 目标与 `nlp` 命令 |
| `console/src/locales/copaw/{projects,pipelines,rpa}/*.json` | 18 个 fork 自有文件，经 `i18n.ts:9-26/55-97` 与上游 locale 并列装载，上游 JSON 零改动 |
| `src/copaw/` 53 文件 + `console/public/copaw-icon.svg` | overlay 与自有资源，CoPaw 名字本来就住在这里 |
| CloudPaw bundle | 见 §2.1 |

### 2.7 上游 v2 自己的源码里就在写 `CoPaw`，但语义是"遗留"

本轮实测（大小写敏感）：`CoPaw` 在 v2 `console/src` = **5 文件 / 15 行**（`pages/Chat/HostBubbles.tsx`、`pages/Chat/index.tsx`、`sdkHostIntegration.test.tsx`、`sdkSessionAdapter.ts`、`sdkSessionLifecycle.integration.test.tsx`），在 v2 `src/` = **4 文件 / 5 行**（`constant.py` 2、`agents/memory/proactive/__init__.py`、`agents/utils/message_request_normalizer.py`、`security/secret_store.py`）。两处关键语义：`constant.py:206-209` 注释 "CoPaw-era builtin QA" + `LEGACY_QA_AGENT_ID = "CoPaw_QA_Agent_0.1beta1"`；`config/config.py:3983-3984` 把 `~/.copaw` 当**旧路径**迁移。同期可见品牌仍是 QwenPaw：`console/src` 77 文件 / 652 行，`src/` 227 文件 / 637 行。

⇒ 两条推论：**(1)** `copaw` 在上游不是空命名空间（迁移计划 §3.4 已记），对上游文件做 `qwenpaw→copaw` 改名等于**在上游的迁移/遗留语义层上覆盖新含义** —— 这是退回命名册的一条独立于"税"的理由；**(2)** 上游自己在源码注释与测试名里用 CoPaw 指代本产品，"CoPaw 只出现在 fork 自有文件里"这条规则约束的是**上游文件的 diff**，不是这个词的可见性。

---

## 3 界面机制：路由感知的品牌位（已选方案）

### 3.1 接缝存在，且是上游自己的设计意图

v2 `console/src/plugins/registry/Slot.tsx:30-42`：`kind="replace"` 把宿主默认内容作为 `children` 传进插件 render（`:41`），注释原文（`:33-34`）—— *"Pass `children` (host default) into the plugin render so an **agent-/route-aware plugin can `return defaultContent` to opt out** of replacement on a per-render basis"*；`:33` 无 replace 注册、`:42` render 返回 `null` 都回落 `children`。⇒ **同一窗口内按当前路由显示 CoPaw、或把上游品牌位原样交回去，是上游契约允许的，零 patch。**

**同一处读出的两个约束，方案必须照着它们设计**：**(1)** `Slot.tsx:31` 用 `entries.find((e) => e.kind === "replace")` ⇒ **一个 replace 位只有一个赢家**，Copaw 与别的插件同时想换 `header.logo` 时，先注册者得，后注册者整段无效（注册顺序行为未实测，见 §7 S2）；**(2)** 该 opt-out 是**每次 render 决定**，不是插件级隔离 —— "上游界面永不被换品牌"要靠 Copaw 自己的 render 里 `return children` 兑现，机制本身不会替我们守住边界。

### 3.2 品牌位清单（v2）

| 位 | 来源 | 用途 |
|---|---|---|
| `<Slot name="header.logo" kind="replace">` | `console/src/layouts/AppBrand.tsx` | 应用级品牌（Sidebar 持有）；CoPaw 在此按路由决定 |
| `chat.leftHeader.set/render` | `plugins/hostSdk/install.ts:88` 与 `:273-274`、`plugins/pawapp-sdk/ui.tsx:53-57` | Chat 左头 logo/标题整段替换 |
| `provider.getConfig` 覆写 `theme.leftHeader.title` / `welcome.avatar` | `plugins/bundle/cloudpaw/ui/src/index.ts:2612-2624` | 已被上游第一方子品牌使用（§2.1） |
| `ChatScalar`：`header.leftTitle`(`:30`) / `header.leftLogo`(`:31`) / `welcome.{greeting,description,avatar,nick,prompts,render}`(`:24-29`) / `theme.colorPrimary`(`:33`) | `plugins/registry/slotKeys.ts:23-38` | Chat 内品牌与欢迎区 |
| `route.replace(pluginId, "core.root", …)` | `plugins/registry/store.ts`（`replace` 对 `targetId` 无白名单） | D-12 的默认落地界面；**它能否只作用于 CoPaw 自有页而不触及上游路由，未验证（S2）** |

**接缝稳定性有保障**：上游自有测试 `console/src/layouts/index.module.test.ts:34-42` 断言 `AppBrand.tsx` 源码必须含 `<Slot name="header.logo" kind="replace">`、`Header.tsx` 必须含 `header.left` / `header.right` fill 与 `showBrand && <AppBrand />`。上游若删掉品牌位，先红它自己的测试。

### 3.3 时序硬约束

fork 当前 v1 树：`git grep '<Slot' HEAD -- console/src/layouts` 命中 **0**，且不存在 `AppBrand.tsx` ⇒ §3 整套只能在 **WP-06 之后**成立。这决定了 §5 的分阶段。

### 3.4 界面内正文（D-21 的结案）

上游界面正文（含 376 处 QwenPaw）**不改**，即 D-21 裁为 **(a) 承认上游界面叫 QwenPaw**；原先推荐给计划的两条 (b) 改 7 个上游 locale JSON / (c) 改上游 `i18n.ts` 合并 **一并撤回**。(b) 会把 376 行推进 P1-命名册（比现在这 126 行大 3 倍），(c) 是 P1-行为、双违。CoPaw 专属界面的文案继续走 `locales/copaw/*` 自有命名空间。

---

## 4 分发物 overlay（已选方案）

- v2 桌面产物名的真源：`console/src-tauri/tauri.conf.json` 的 `productName: "QwenPaw Desktop"`、`identifier: io.agentscope.qwenpaw.desktop`、`bundle.targets: ["app","nsis"]`、nsis 自定义模板 `nsis/tauri-installer.nsi`（`:53-57`）。
- 做法：**新增 fork 自有** `.github/workflows/copaw-desktop.yml` + 一层 fork 自有构建包装，用 `tauri build --config` 覆盖 `productName`；若 nsis 模板需要品牌，指向 fork 自有的模板副本，而不是改上游 `scripts/pack/*`（那 27 行退回，见 B1）。
- 维持上游命名：PyPI `qwenpaw`、Docker `agentscope/qwenpaw`、CLI `qwenpaw`（`copaw` 作为已有新增 entry 保留）。
- **本节依赖 §7 S1 的构建 spike，未跑通前不写死。**

---

## 5 回滚与删除清单（分两阶段）

### 阶段 A：88 行，不依赖 v2，已作为 WP-12 实施（原记 92 行，多出的 4 行见 §1.1 更正）

| 步 | 动作 | 判据 |
|---|---|---|
| A1 | 退 `src/` 5 文件 17 行（`init_cmd.py` 7、`desktop_cmd.py` 4、`migration.py` 3、`main.py` 2、`update_cmd.py` 1） | `pytest tests/unit/cli/test_cli_update.py` **6 failed → 0**；全量基准 8F → **2F**；`init_cmd.py`/`main.py`/`update_cmd.py` 与 merge-base 逐字节相同 |
| A2 | 退 docs/website 8 文件 **71 行**（`cli.zh.md` 23、`cli.en.md` 22、`desktop.{zh,en}.md` 11+11、README×4 各 1；原记 75/各 2，那 4 行是 §1.1 更正的移动假阳性） | 这 8 个文件仍在 P1（各自还有 behavior 改动，**不许宣称它们变成未触碰**）；`naming_lines` 122→34 |
| A3 | `copaw_brand.py export` 重导账册，只剩 34 行（pack 27 + console 7） | CI `copaw_brand.py verify` 仍逐字节通过 |
| A4 | `check_p1_invariants.py --write-baseline` 重记基线 | `naming_lines` 34 / `naming_files` 1 / `naming_touched_files` 9 / **P1 文件 172→169**，`--check` exit 0 |

**阶段 A 不会发生的两件事（说清楚免得误期待）**：① 4 篇 README 里 fork 自己写的 CoPaw 内容（每个文件 58–68 个新增行，含 `README_ja.md:7` 引用 `console/public/copaw-icon.svg`）属 behavior 册，**不动**；② 顶栏 `Header.tsx` 里 fork 自写的 `<span>CoPaw</span>` 与 `copaw-icon.svg` 引用同理不动，留到 B2/B3 slot 化。

### 阶段 B：34 行 + 机制，WP-06 之后

| 步 | 动作 | 判据 |
|---|---|---|
| B1 | **先**建 §4 overlay 并跑通，**再**退 pack 27 行（顺序不能反，否则装机名出现真空） | 产物文件名 / `Name` / `InstallDir` / 快捷方式为 CoPaw，且 `scripts/pack/*` 4 文件与 merge-base 逐字节相同；`build_win.ps1` 离开 P1 |
| B2 | 退 console 7 个命名行；把顶栏 fork 自写的品牌 markup 改为经品牌位注入 | 上游自有 console 文件无品牌改名；`Header.tsx` 的 behavior 行随之减少（数字不预判） |
| B3 | 注册 CoPaw 品牌位插件（§3.2）+ D-12 落地页 | §7 S2/S3/S4 的判据 |
| B4 | 删 `scripts/copaw_brand.py`、`scripts/copaw_brand.json`、CI 里的 `copaw_brand.py verify` 步骤；`check_p1_invariants.py` 的 naming 门禁由"只减不增"改为"**必须 0**" | `naming_lines = 0`、`naming_files = 0`；P1 文件 **168**；全量基准 **0F**（另 2 条随 py3.11 自动清） |

---

## 6 三条默认裁定（你选了"直接推进"，我按保守项定，任一都可改判）

1. **Web 浏览器标签标题与 favicon：接受退回 QwenPaw。** v2 的 `console/index.html` `<title>` 与 favicon 没有任何 slot 接缝；桌面端由 `productName` 与图标承担。若不接受，唯一合规路径是 fork 自有发布 overlay 在构建期产出一份 index.html —— 那是 §7 S1 之外的第二个 spike，本轮不做。
2. **`identifier` 保持 `io.agentscope.qwenpaw.desktop`，只改 `productName`。** 理由：identifier 决定 app 数据目录与更新身份，改 = 与上游安装并存且拿不到老用户数据迁移；不改 = 原地覆盖、数据延续。代价要说清：**"装机默认进入 CoPaw"只在可见名/快捷方式层成立**，磁盘身份仍是上游的（这正是 §2.3 里命名册越界改 `Software\CoPaw` 的反面教训）。
3. **过渡期唯一例外：顶栏 CoPaw 保留到 B2。** 依据两条实测：v1 树在 `console/src/layouts` 下没有任何顶栏品牌接缝（§3.3，`<Slot>` 0 命中、无 `AppBrand.tsx`），且 fork 的 console 测试**没有一条断言品牌字样**（`grep -rln 'QwenPaw\|CoPaw' console/src --include='*.test.ts' --include='*.test.tsx'` = 0 命中），所以这 7 个 console 命名 pair 一条红都不造成；今天就退只会让产品在过渡期完全没有 CoPaw 痕迹。**这条例外的范围只到顶栏**：Chat 侧的 `welcome.avatar` / `theme.leftHeader` 在 v1 已有配置面，不受本条例外保护。

补一条不需要裁的事实核对：`scripts/install.bat` 的 `echo To uninstall, run: copaw uninstall` 是**真命令**（`copaw` 与 `qwenpaw` 共享全部核心命令，见 `src/copaw/cli/main.py:12-21`；`uninstall` 在 `src/qwenpaw/cli/uninstall_cmd.py:46`）。B1 退它只是把指令收回上游入口，不产生错误说明。

### 6.1 仓库 README banner 的裁定（2026-10-03，#29 复审的实际开放项）

阶段 A 的 §5 A2-① 只退了 4 行**改名**，明写"fork 自写的 CoPaw 内容不动"，于是把真正的选择留在了原地：**四篇上游 README 顶部那整块 banner 要不要继续钉在上游文件里**。本轮核完价格后裁定为**选项 B（banner 只保首页）**。

**为什么这不是 R1/R2 违规、而是一个纯价目问题**：R1 只管改名，R2 的射程见 §1 的射程条款（只管改名与界面注入），所以 banner 在法律上一直是允许的；裁决点只在"值不值"。原有的矛盾（R2 字面 vs §5 A2-①）由射程条款消除，不需要修改任何一方对 banner 的处置。

**现算的价目（`check_p1_invariants.py --json` ∩ 上游 1.x→2.x 也改过该文件）**：

| 文件 | fork 侧在册 | 上游 v2 自己改了多少 |
|---|---|---|
| `README.md` | +29/−4 | +177/−141 |
| `README_zh.md` | +36/−4 | +192/−223 |
| `README_ja.md` | +34/−4 | +230/−209 |
| `README_ru.md` | +36/−4 | +203/−182 |

三条实测事实决定了 B 优于"全保留"：① **四篇的 fork diff 整段就是 banner**（`-U0` 逐 hunk 看过，没夹带别的内容）⇒ 退回零内容损失；② 那 4 行删除**全是重排 churn**（fork 把上游的 logo 块挪到自己新加的 `## QwenPaw` 小标题下），买到 0 收益、只把冲突坐实；③ **上游 v2 对这些文件是近乎逐行重写**，且新增的两个 badge 与 trendshift 图落在**同一处头部区**（`README.md` 上游 hunk `@@ -15,6 +15,9 @@`，紧挨 fork 删掉的语言链接行）⇒ banner 的真实成本不是 135 行，是"每次同步在重写过的头部里手工重贴 4 次"。

**裁定内容**：
1. **GitHub 首页是这四篇里唯一有传播价值的渲染面**（仓库首页只渲染 `README.md`，另三篇需用户主动点语言链接）⇒ 接受"非英文 README 不再挂 CoPaw"这个可见性收缩，`README_zh/_ja/_ru.md` 逐字节退回 merge-base ⇒ **3 个宿主退出冲突面**。
2. `README.md` 保留一个**紧凑加性** banner，且**不再动上游任何一行**（恢复被挪走的上游 logo 块与语言链接行）⇒ 该宿主从 +29/−4 降到个位数行为行，仍留在面上。
3. banner 的完整内容（四行能力清单、社区二维码、上游指认）搬进 **fork 自有 `docs/copaw-overview.md`** —— 这正是已闭环 58 那条硬规则的适用现场："写'无落点 ⇒ 保留在册'之前必须举出已查过的 fork 自有归宿"。
4. 搬过去前先核**时效**：四行能力清单本轮逐条对上现树符号 —— `app/routers/agents_pipeline_core.py:2840` 的 `{"fast","nlp","agentic"}`、`app/routers/sidecar.py` + `knowledge_hanlp_tasks.py`、`console/src/pages/Agent/Projects/ProjectDetailPage.tsx:741` 的 `KnowledgeDockTabKey`（Explore/Sources/Processing/Outputs/Health/Settings）、`app/routers/skills.py:69-72` 的 `SkillsMarket*` ⇒ 全部 live，不是沉没文案。


---

## 7 未证事项与 spike（不在 spec 里当既成事实）

| 编号 | 待证 | 判据 | 估 |
|---|---|---|---|
| S1 | `tauri build --config` 覆盖 `productName` 能否真产出 CoPaw 的 `.app` / `Setup.exe` | 一次真构建：产物文件名 + `Info.plist` 的 `CFBundleName`；不通过则退到"fork 自有 pack 目录"（本轮未选的方案） | 0.5d |
| S2 | 品牌位 render 里拿当前路由并 `return children` 的写法与时序 | 一个 vitest（参照 v2 `plugins/registry/__tests__/Slot.test.tsx`）证明"/copaw paint CoPaw、/chat paint 上游"；契约已由 `Slot.tsx:30-42` 确立，**写法未验证** | 0.5d |
| S3 | CoPaw 专属界面清单（206 个自有 console 文件里哪些算路由级 CoPaw 界面） | 一份 route → 是否 CoPaw 的表，作为品牌位判定的唯一真源；须回答 Knowledge/Projects/Pipelines/RPA 是否都算 | 0.25d |
| S4 | CoPaw 插件注册是否早于首次 `AppBrand` 渲染 | 若晚，首屏会闪一下上游品牌；判据是一次真实加载观察 | 0.25d |
| S5 | `route.replace(pluginId, "core.root", …)` 的**作用域**：能否只替换 CoPaw 自有页而不触及上游路由；以及同名 `replace` 位多插件竞争时注册顺序的实际行为（§3.1 的 `find` ⇒ 单赢家） | 一次真实注册观察：D-12 的默认落地依赖这条；机制已读码（`store.ts` 对 `targetId` 无白名单、`Slot.tsx:31` 用 `find`），**运行行为未验证** | 0.25d |
| S6 | 阶段 A 退回后、WP-06 之前的 v1 界面真实显示（§6 第 3 条只保护顶栏那 4 行） | **已闭环（2026-10-01，阶段 A 实施时）**：结论 = **没有第二处界面痕迹被 A 退掉**。阶段 A 的 changeset 里 `console` 文件数 **0**（`git diff --name-only wp/02-ownership..HEAD -- console` 无输出），所以过渡期界面与阶段 A 之前逐字节相同；实测还在的 7 处：`Header.tsx:169/:174`（顶栏 `alt="CoPaw"` + `<span>CoPaw</span>`）、`Login/index.tsx:100/:103`、`layouts/constants.ts:150-152`、`OptionsPanel/defaultConfig.ts:10`（"Work with CoPaw"）、`console/index.html:14`（`<title>CoPaw Console</title>`）。被 A 退掉的可见 CoPaw 只有 CLI 运行时文案与公开文档：`copaw --version` → `QwenPaw, version 1.1.11b1`、`copaw --help` → `QwenPaw CLI.`、`desktop_cmd.py:357`、`update_cmd.py:716`（前两条用 Click `CliRunner` 实跑取回，不是读源码）。**原计划的 `npm run dev` 目视被这一步替代**：既然 0 个 console 文件被改，浏览器里能看到的与树上必然一致 | 0.25d → 0 |
| S7 | 维持 `identifier = io.agentscope.qwenpaw.desktop`、只改 `productName` 的安装行为（§6 第 2 条） | 一次真构建 + 覆盖安装：确认是原地升级而非并存新 app，老用户数据可读 | 0.5d |

S1–S4 合计 **约 1.5d**，是阶段 B 的入场券；阶段 A 不依赖任何一条。S5 与 S2 同属阶段 B（可并做），S6 属阶段 A 之后、WP-06 之前的过渡期，S7 属 R3 overlay 落地时。三条都是本轮新加的，来源见迁移计划 §8 未验证 23–25。


---

## 8 不在范围

- 不改上游测试（D-17 的"不动"继续有效，只是不再需要它当豁免理由）；不提上游 PR（D-13）。
- 不改 pip 包名、Docker 镜像名、`qwenpaw` CLI 名（R1 已覆盖）。
- 不动 `src/copaw/` overlay 与 `console/src/locales/copaw/` —— 它们是 fork 自有文件，本就是新规里 CoPaw 名字该住的地方。
- 不引入品牌开关/配置项（用户设置开关与实例级开关本轮都不选）。
- 不影响在进的 WP-02(d)。实施计划已出并据其执行：**`docs/superpowers/plans/2026-10-01-d22-brand-boundary-stage-a.md`**（阶段 A = 该计划的 Task 1–10，已在分支 `wp/12-brand-stage-a` 完成；阶段 B 的 B1–B4 与 S1/S2/S3/S4/S5/S7 探针写在同一文件的"阶段 B：入场券"一节，等 WP-06 之后另出计划）。**未开 PR**（D-13 + 本轮"先把 CoPaw 整理好"）。

---

## 附录：本轮取证命令

```bash
# 命名册 22 文件 / 126 行的 naming vs behavior 拆分（§1.1 表的来源）
CI=true python scripts/check_p1_invariants.py --target-ref working --json > /tmp/p1_now.json
# 6 条红的根因（单行改名 × 上游 7 处断言）
grep -n "Starting CoPaw update" src/qwenpaw/cli/update_cmd.py
grep -c "Starting QwenPaw update" tests/unit/cli/test_cli_update.py
CI=true PYTHONPATH=$PWD/src python -m pytest tests/unit/cli/test_cli_update.py -q
# 上游第一方子品牌的命名方式（fork 未改过这个文件）
sed -n '2612,2624p;2438p' plugins/bundle/cloudpaw/ui/src/index.ts
git diff --numstat e111ec6fb..HEAD -- plugins/bundle/cloudpaw/ui/src/index.ts   # 无输出 = 逐字节相同
# 品牌接缝只在 v2，不在当前树；且被上游测试钉住
git grep -n '<Slot' upstream/main -- console/src/layouts     # 有
git grep -n '<Slot' HEAD          -- console/src/layouts     # 0 命中
git show upstream/main:console/src/layouts/index.module.test.ts | sed -n '30,45p'
# 产物名的真实决定点
sed -n '296,306p' scripts/pack/build_win.ps1                  # /DOUTPUT_EXE 覆盖 nsi 默认值
git show upstream/main:console/src-tauri/tauri.conf.json | sed -n '1,10p;38,75p'
```
