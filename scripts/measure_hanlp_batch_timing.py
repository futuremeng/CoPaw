#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import statistics
import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient

DEFAULT_OUT_PATH = Path("/tmp/hanlp_batch_timing.json")
DEFAULT_TASKS = ["tokenize", "ner", "dep", "sdp", "con"]
DEFAULT_TEXTS = [
    "微软在北京发布Copaw。",
    "阿里在杭州发布新平台。",
    "百度升级检索引擎。",
    "腾讯上线新服务。",
    "字节推出新模型。",
]


def _payload_for_task(task_key: str) -> dict[str, object]:
    return {
        "texts": DEFAULT_TEXTS,
        "request_id": f"batch-bench-{task_key}",
    }


def _measure_task(client: TestClient, task_key: str, rounds: int = 3) -> dict[str, object]:
    timings: list[float] = []
    states: list[dict[str, object]] = []
    payload = _payload_for_task(task_key)
    for index in range(rounds):
        started = time.perf_counter()
        response = client.post(f"/knowledge/tasks/{task_key}/run", json=payload)
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        timings.append(elapsed_ms)
        state: dict[str, object]
        try:
            state = response.json()
        except Exception:
            state = {"error": "invalid-json", "status_code": response.status_code}
        states.append(
            {
                "round": index + 1,
                "status_code": response.status_code,
                "elapsed_ms": elapsed_ms,
                "status": state.get("status"),
                "reason_code": state.get("reason_code"),
                "duration_ms": state.get("duration_ms"),
            }
        )
    return {
        "task_key": task_key,
        "rounds": states,
        "min_ms": round(min(timings), 2),
        "median_ms": round(statistics.median(timings), 2),
        "max_ms": round(max(timings), 2),
        "mean_ms": round(statistics.fmean(timings), 2),
        "under_2s_all": all(value < 2000.0 for value in timings),
    }


def main() -> None:
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT_PATH
    rounds = int(sys.argv[2]) if len(sys.argv) > 2 else 3

    from copaw.app._app import app

    result: dict[str, object] = {
        "tasks": DEFAULT_TASKS,
        "texts": DEFAULT_TEXTS,
        "rounds": rounds,
        "measured_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }

    with TestClient(app) as client:
        result["results"] = [_measure_task(client, task_key, rounds=rounds) for task_key in DEFAULT_TASKS]

    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(str(out_path))


if __name__ == "__main__":
    main()