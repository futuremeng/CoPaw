import json
import sys
import time
from pathlib import Path

from qwenpaw.config import load_config
from copaw.knowledge.hanlp_nlp_runtime import NLPRuntime

DEFAULT_OUT_PATH = Path("/tmp/bert_ner_timing.json")
PROBE_TEXT = "微软在北京发布Copaw。"


def main() -> None:
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT_PATH
    cfg = load_config().knowledge
    nlp = getattr(cfg, "nlp", None) or getattr(cfg, "hanlp", None)
    if nlp is None:
        out_path.write_text(
            json.dumps({"error": "knowledge.nlp not found"}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(str(out_path))
        return

    nlp.provider = "hanlp"
    nlp.enabled = True
    nlp.tokenize_timeout_sec = 180.0

    try:
        task_cfg = nlp.task_matrix.tasks["ner_msra"]
        task_cfg.model_id = "MSRA_NER_BERT_BASE_ZH"
        task_cfg.timeout_sec = 180.0
    except Exception:
        pass

    runtime = NLPRuntime()
    result: dict[str, object] = {
        "model": "MSRA_NER_BERT_BASE_ZH",
        "text": PROBE_TEXT,
    }

    t0 = time.perf_counter()
    status1 = runtime.task_status("ner_msra", cfg)
    result["first_task_status_ms"] = round((time.perf_counter() - t0) * 1000, 2)
    result["first_task_status"] = status1

    t1 = time.perf_counter()
    ner1, state1 = runtime.run_ner(PROBE_TEXT, cfg)
    result["first_run_ner_ms"] = round((time.perf_counter() - t1) * 1000, 2)
    result["first_run_ner_state"] = state1
    result["first_run_ner_sample"] = ner1

    t2 = time.perf_counter()
    ner2, state2 = runtime.run_ner(PROBE_TEXT, cfg)
    result["second_run_ner_ms"] = round((time.perf_counter() - t2) * 1000, 2)
    result["second_run_ner_state"] = state2
    result["second_run_ner_sample"] = ner2

    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(str(out_path))


if __name__ == "__main__":
    main()
