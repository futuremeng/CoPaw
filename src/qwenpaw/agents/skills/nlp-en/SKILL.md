---
name: nlp
description: "Use this skill when users need Chinese or Classical Chinese NLP capabilities, including tokenization, named entity recognition, POS tagging, dependency/semantic parsing, and semantic role labeling. Suitable for information extraction, structured understanding, preprocessing, and diagnostics. Do not use for model training, fine-tuning, translation-only tasks, or requests without text input."
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

# NLP Multi-Task Builtin Skill

## When to use

Use this skill for:

- Chinese and Classical Chinese tokenization
- Named Entity Recognition (NER)
- POS tagging (CTB/PKU/863)
- Dependency parsing, semantic dependency, constituency parsing
- Semantic role labeling (SRL)
- Structured NLP outputs for downstream workflows

## Unified API endpoint

All tasks share one endpoint:

POST /api/knowledge/tasks/{task_key}/run

Minimal payload:

```json
{
  "text": "Beijing Jiulu Technology Co., Ltd. was founded in September 2022.",
  "request_id": "nlp-skill-demo-001"
}
```

## Supported task_key values

Modern Chinese:

- tokenize
- ner
- pos_ctb
- pos_pku
- pos_863
- dep
- sdp
- con
- srl

Classical Chinese:

- lzh_tok_fine
- lzh_tok_coarse
- lzh_lem
- lzh_pos_upos
- lzh_pos_xpos
- lzh_pos_pku
- lzh_dep

## Input priority

If multiple input fields are provided, use this priority:

1. tokens_batch
2. tokens
3. texts
4. text

Constraints:

- texts / tokens_batch: max 5 items per request
- If input is empty, ask the user for text before execution

## Recommended execution flow

### 1) Identify user intent

Clarify which output is needed:

- Tokenization vs entity extraction
- Syntactic vs semantic analysis
- Modern Chinese vs Classical Chinese

### 2) Pick a task_key

Choose the minimal task that satisfies the request.

### 3) Execute and parse

Call `/api/knowledge/tasks/{task_key}/run`, then read:

- result (primary output)

Use advanced fields only when needed:

- status
- reason_code
- duration_ms
- resolved_model
- preload_status

### 4) Return actionable output

Present output in this order:

- Key result first (entities/tokens/dependencies)
- Supporting details second (latency/errors/notes)

## Failure handling

### Sidecar not configured

If status is not ready and reason_code indicates runtime/sidecar not ready:

- Clearly state runtime is unavailable
- Ask the user to check NLP runtime config/status
- Never fabricate NLP results

### Cold start and model download

First-run latency can be high. Handle by:

- Informing the user about model initialization
- Returning actionable next steps on timeout (retry/lightweight task/check cache)

### Invalid parameters

For invalid task_key or bad payload:

- Point out invalid fields clearly
- Provide a copyable corrected payload

## Output layering

- Default layer: user-facing NLP result
- Advanced layer: debug metadata (status/reason_code/duration_ms)

Example:

```json
{
  "task": "ner",
  "summary": "2 entities detected",
  "entities": [
    {"text": "北京九录科技有限公司", "label": "ORG"},
    {"text": "孟繁永", "label": "PERSON"}
  ],
  "debug": {
    "status": "ready",
    "reason_code": "HANLP2_READY",
    "duration_ms": 42
  }
}
```

## CLI examples

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

## Do not

- Do not fabricate model outputs
- Do not claim analysis was executed without calling the API
- Do not expose debug fields as primary user-facing result
