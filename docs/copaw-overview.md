# CoPaw

<p align="center">
  <img src="../console/public/copaw-icon.svg" alt="CoPaw logo" width="120">
</p>

CoPaw 是 [QwenPaw](https://github.com/agentscope-ai/QwenPaw) 的一个 fork。上游负责通用 agent 宿主，CoPaw 这一侧只做**项目知识处理**这条线：把一批文档接进来、切分、抽取、量化、出结果，并且让每一步可观察、可重跑。

本仓库的可见品牌规则（D-22）是"命名只随所有权走"：不改上游任何命名，CoPaw 只出现在 fork 自有文件与构建产物里。仓库首页只渲染英文 `README.md`，其中保留一个紧凑指引块，完整说明就是本文档。其他语言的 README 是上游原文：[中文](../README_zh.md) · [日本語](../README_ja.md) · [Русский](../README_ru.md)。

## 四项能力

每条都附现树符号，便于核对时效（不写"曾经有过"的东西）。

| 能力 | 实现位置 |
|---|---|
| **项目知识处理三条并行通道**：`fast` / `nlp` / `agentic` | 通道校验在 `src/qwenpaw/app/routers/agents_pipeline_core.py:2840`；`nlp`/`agentic` 与 `memify_enabled` 的前置关系在 `:2868` |
| **HanLP sidecar 运行时** | `src/qwenpaw/app/routers/sidecar.py`、`src/qwenpaw/app/routers/knowledge_hanlp_tasks.py` |
| **知识面板工作流标签**：Explore / Sources / Processing / Outputs / Health / Settings | `console/src/pages/Agent/Projects/ProjectDetailPage.tsx:741`（`KnowledgeDockTabKey`）与同目录 `components/ProjectKnowledge*Panel.tsx` |
| **社区 Skills Marketplace 源集成** | `src/qwenpaw/app/routers/skills.py:69-72`（`SkillMarketSpec` / `SkillsMarketConfig` / `SkillsMarketInstallConfig`） |

三条通道的分工：`fast` 只做切分与索引，不调模型；`nlp` 走本地 HanLP / spaCy 管线做 tokenize / NER / syntax / coreference；`agentic` 在此基础上再跑 agent 化的整理与增强。面板的 Processing 标签按这三条通道分别呈现阶段进度（Sources → Structured → Enhanced，见 `ProjectDetailPage.tsx:322-328`）。

## 社区

<p align="center">
  <img src="../console/public/dingtalk.jpg" alt="CoPaw 钉钉群" width="300">
</p>

## 与上游的关系

- 上游发布的包名、CLI 名、Docker 镜像名、界面正文的品牌字样全部保持 `QwenPaw` 不变（D-22 R1/R2）；`copaw` 作为 fork 自有的额外 CLI 入口存在，注册在 `pyproject.toml:96-99`，实现是 `src/copaw/` 这层可整目录摘除的 overlay。
- 分发物（安装包名、桌面产物名）由 fork 自有的构建 overlay 决定，做法见 `docs/copaw-brand-boundary.md` §4。
- 双轨流程（如何跟上游同步、什么进上游什么留本地）见 `docs/dual-track-sop.md`。
