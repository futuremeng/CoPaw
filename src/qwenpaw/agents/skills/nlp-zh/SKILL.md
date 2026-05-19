---
name: nlp
description: "当用户需要对中文或古汉语文本做分词、实体识别、词性标注、依存/语义分析、语义角色分析时，使用此技能。适用于信息抽取、结构化理解、文本预处理、规则验证与故障排查场景。不用于模型训练、微调、跨语言翻译或无文本输入的任务。"
metadata:
  builtin_skill_version: "1.0"
  qwenpaw:
    emoji: "🧠"
    requires: {}
tags:
  - nlp
  - chinese
  - classical-chinese
  - ner
  - parsing
channels:
  - all
---

# NLP 多任务内建技能

## 适用场景

当用户请求以下能力时使用本技能：

- 中文分词与古汉语分词
- 命名实体识别（人名、地名、机构名等）
- 词性标注（CTB/PKU/863）
- 依存句法、语义依存、短语结构
- 语义角色标注（SRL）
- 面向下游流程的文本结构化结果

## 统一调用入口

所有任务统一调用：

POST /api/knowledge/tasks/{task_key}/run

示例最小请求体：

```json
{
  "text": "北京九录科技有限公司成立于2022年9月。",
  "request_id": "nlp-skill-demo-001"
}
```

## 任务清单（task_key）

现代中文：

- tokenize
- ner
- pos_ctb
- pos_pku
- pos_863
- dep
- sdp
- con
- srl

古汉语：

- lzh_tok_fine
- lzh_tok_coarse
- lzh_lem
- lzh_pos_upos
- lzh_pos_xpos
- lzh_pos_pku
- lzh_dep

## 输入优先级

如果同时提供多个输入字段，按以下优先级选择：

1. tokens_batch
2. tokens
3. texts
4. text

约束：

- texts / tokens_batch 单次最多 5 条
- 输入为空时应先提示用户补充文本

## 推荐执行流程

### 1) 明确用户目标

先确认用户要的结果类型：

- 需要分词还是实体
- 需要语法关系还是语义角色
- 是现代中文还是古汉语

### 2) 选择 task_key

按目标选择最小必要任务，不做无关任务叠加。

### 3) 执行并解析

调用 `/api/knowledge/tasks/{task_key}/run` 后，优先读取：

- result（主结果）

必要时查看高级信息：

- status
- reason_code
- duration_ms
- resolved_model
- preload_status

### 4) 给出用户可行动结论

输出应先给结论，再给证据：

- 先展示关键结果（如实体列表、分词序列、依存关系）
- 再补充必要说明（置信、异常、耗时）

## 故障处理规范

### sidecar 未配置

若 status 非 ready 且 reason_code 指向 sidecar/环境未就绪：

- 明确告知当前 NLP 运行环境不可用
- 提示检查 NLP 配置页与运行时状态
- 不要伪造分析结果

### 冷启动与模型下载

首次调用可能耗时较长。处理原则：

- 先告知“模型初始化中”
- 超时后返回可执行建议（重试、切换轻量任务、检查缓存路径）

### 参数错误

若 task_key 不支持或输入不合法：

- 清晰指出错误字段
- 给出可复制的正确请求体示例

## 输出格式建议

- 默认输出：用户可直接使用的 NLP 结果
- 高级输出：折叠呈现调试字段（status/reason_code/duration_ms）

示例（简化）：

```json
{
  "task": "ner",
  "summary": "识别到 2 个实体",
  "entities": [
    {"text": "北京九录科技有限公司", "label": "ORG"},
    {"text": "孟繁永", "label": "PERSON"}
  ],
  "debug": {
    "status": "ready",
    "reason_code": "HANLP_READY",
    "duration_ms": 42
  }
}
```

## CLI 调用示例

```bash
curl -s -X POST "http://127.0.0.1:8088/api/knowledge/tasks/tokenize/run" \
  -H "Content-Type: application/json" \
  -d '{"text":"北京九录科技有限公司成立于2022年9月。","request_id":"nlp-cli-tokenize-001"}'
```

```bash
curl -s -X POST "http://127.0.0.1:8088/api/knowledge/tasks/lzh_tok_fine/run" \
  -H "Content-Type: application/json" \
  -d '{"text":"赫赫九录，肇基京华。孟氏创立，岁在孟秋。","request_id":"nlp-cli-lzh-001"}'
```

## 禁止事项

- 不虚构模型输出
- 不在未调用接口时声称“已完成分析”
- 不将调试字段当作主业务结果返回给最终用户
