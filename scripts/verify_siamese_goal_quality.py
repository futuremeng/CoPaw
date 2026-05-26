#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Verify Siamese UniNLU tasks against semantic quality goals.

This script validates real output quality, not only HTTP/status success.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any


def flatten_spans(result: Any) -> list[dict[str, Any]]:
    spans: list[dict[str, Any]] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if "span" in node:
                spans.append(node)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(result)
    return spans


def evaluate(task: str, payload: dict[str, Any], response: dict[str, Any]) -> tuple[bool, str]:
    result = response.get("result")
    spans = flatten_spans(result)
    span_texts = [str(item.get("span") or "") for item in spans]
    span_join = " | ".join(span_texts)

    if task == "named_entity_recognition":
        ok = any(s in span_join for s in ["北京九录科技有限公司", "Copaw"])
        return ok, f"spans={span_texts}"

    if task == "relation_extraction":
        has_person = any(s in span_texts for s in ["孟繁永"])
        has_role = any(s in span_texts for s in ["创始人", "首席执行官"])
        ok = has_person and has_role
        return ok, f"spans={span_texts}"

    if task == "event_extraction":
        ok = len(spans) > 0 and any(s in span_join for s in ["发布", "2026年5月", "九录科技", "Copaw 2.0"])
        return ok, f"spans={span_texts}"

    if task == "aspect_sentiment_extraction":
        ok = len(spans) > 0 and any(s in span_join for s in ["音质", "续航", "价格"])
        return ok, f"spans={span_texts}"

    if task == "coreference_resolution":
        ok = any(s in {"是的", "不是"} for s in span_texts)
        return ok, f"spans={span_texts}"

    if task == "sentiment_classification":
        ok = any(s in {"正向", "负向", "中性"} for s in span_texts)
        return ok, f"spans={span_texts}"

    if task == "text_classification":
        ok = any(s in {"科技", "财经", "体育", "娱乐"} for s in span_texts)
        return ok, f"spans={span_texts}"

    if task == "text_matching":
        ok = any(s in {"匹配", "不匹配"} for s in span_texts)
        return ok, f"spans={span_texts}"

    if task == "natural_language_inference":
        ok = any(s in {"蕴含", "矛盾", "中立"} for s in span_texts)
        return ok, f"spans={span_texts}"

    if task == "reading_comprehension_choice":
        choices = payload.get("choices") or []
        ok = any(s in choices for s in span_texts)
        return ok, f"spans={span_texts}"

    if task == "reading_comprehension_extractive":
        ok = any("Copaw" in s for s in span_texts)
        return ok, f"spans={span_texts}"

    return len(spans) > 0, f"spans={span_texts}"


def build_cases() -> dict[str, dict[str, Any]]:
    return {
        "named_entity_recognition": {
            "payload": {
                "text": "北京九录科技有限公司推出产品 Copaw。Copaw 是公司面向知识生产和加工场景打造的产品，致力于以智能化技术推动知识服务领域的全流程数字化转型，并持续支持多个开源项目。",
                "schema": {"人物": None, "地理位置": None, "组织机构": None, "公司": None, "产品": None},
            },
            "goal": "至少识别公司或产品实体",
        },
        "relation_extraction": {
            "payload": {
                "text": "孟繁永担任北京九录科技有限公司创始人兼首席执行官，公司总部位于北京。",
                "schema": {"人物": {"组织": None, "职位": None}},
            },
            "goal": "至少抽取人物与职位证据",
        },
        "event_extraction": {
            "payload": {
                "text": "2026年5月，九录科技在北京发布 Copaw 2.0，吸引多家机构参与试点。",
                "schema": {"发布": {"时间": None, "地点": None, "发布方": None, "产品": None}},
            },
            "goal": "抽取出事件及至少一个论元",
        },
        "aspect_sentiment_extraction": {
            "payload": {
                "text": "这款耳机音质很好，但续航一般，价格偏高。",
                "schema": {"属性词": {"正向情感(情感词)": None, "负向情感(情感词)": None, "中性情感(情感词)": None}},
            },
            "goal": "抽取方面词及其情感词",
        },
        "coreference_resolution": {
            "payload": {
                "text": "是的,不是|孟繁永创立了北京九录科技有限公司。他希望它能够持续服务知识生产。",
                "schema": {"在下面的描述中，代词“它”指代的是“北京九录科技有限公司”吗？": None},
            },
            "goal": "输出是的/不是之一",
        },
        "sentiment_classification": {
            "payload": {
                "text": "整体体验不错，功能完善，但学习成本略高。",
                "labels": ["正向", "负向", "中性"],
                "schema": {"情感分类": None},
            },
            "goal": "输出三分类标签之一",
        },
        "text_classification": {
            "payload": {
                "text": "该平台发布了新的模型评测基准，并开放了开发者文档。",
                "labels": ["科技", "财经", "体育", "娱乐"],
                "schema": {"分类": None},
            },
            "goal": "输出分类标签之一",
        },
        "text_matching": {
            "payload": {
                "text_a": "Copaw 是知识生产智能体。",
                "text_b": "Copaw 用于知识加工与发布。",
                "labels": ["匹配", "不匹配"],
                "schema": {"文本匹配": None},
            },
            "goal": "输出匹配/不匹配",
        },
        "natural_language_inference": {
            "payload": {
                "text_a": "所有员工都参加了周会。",
                "text_b": "小王参加了周会。",
                "labels": ["蕴含", "矛盾", "中立"],
                "schema": {"段落2和段落1的关系是：": None},
            },
            "goal": "输出蕴含/矛盾/中立之一",
        },
        "reading_comprehension_choice": {
            "payload": {
                "question": "谁推出了 Copaw？",
                "context": "北京九录科技有限公司推出产品 Copaw，用于知识生产和加工。",
                "choices": ["北京九录科技有限公司", "张三", "李四", "王五"],
                "labels": ["A", "B", "C", "D"],
                "schema": {"谁推出了 Copaw？": None},
            },
            "goal": "答案命中 choices 之一",
        },
        "reading_comprehension_extractive": {
            "payload": {
                "question": "文中提到的产品名是什么？",
                "context": "该公司的产品名是 Copaw。",
                "text": "该公司的产品名是 Copaw。",
                "schema": {"产品名": None},
            },
            "goal": "抽取答案应包含 Copaw",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify Siamese task output quality goals.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8088", help="Backend base URL")
    parser.add_argument("--output", default="", help="Optional output JSON file path")
    args = parser.parse_args()

    cases = build_cases()
    rows: list[dict[str, Any]] = []

    for task, cfg in cases.items():
        payload = cfg["payload"]
        endpoint = f"{args.base_url}/api/nlp/siamese/tasks/{task}/run"
        req = urllib.request.Request(
            endpoint,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json"},
        )

        try:
            with urllib.request.urlopen(req, timeout=180) as response:
                body = json.loads(response.read().decode("utf-8"))
            ok, detail = evaluate(task, payload, body)
            row = {
                "task": task,
                "goal": cfg["goal"],
                "status": body.get("status"),
                "reason_code": body.get("reason_code"),
                "goal_ok": ok,
                "detail": detail,
            }
        except urllib.error.URLError as exc:
            row = {
                "task": task,
                "goal": cfg["goal"],
                "status": "error",
                "reason_code": "REQUEST_FAILED",
                "goal_ok": False,
                "detail": str(exc),
            }

        rows.append(row)

    report = {
        "total": len(rows),
        "goal_ok": sum(1 for row in rows if row["goal_ok"]),
        "goal_failed": sum(1 for row in rows if not row["goal_ok"]),
        "rows": rows,
    }

    report_text = json.dumps(report, ensure_ascii=False, indent=2)
    print(report_text)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(report_text + "\n")

    return 0 if report["goal_failed"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
