# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import os
import re
import sys
import threading
import subprocess
import atexit
import contextlib
from pathlib import Path
from typing import Any

from ..config.config import KnowledgeConfig

# ---------------------------------------------------------------------------
# Authoritative HanLP pretrained model → download URL mapping.
# Source: https://hanlp.hankcs.com/docs/api/hanlp/pretrained/
# Only models hosted on file.hankcs.com or download.hanlp.com are listed.
# Used by both the host-side artifact check and the sidecar bridge code to
# resolve symbolic constant names without requiring hanlp.pretrained at runtime.
# ---------------------------------------------------------------------------
_HANLP_PRETRAINED_URLS: dict[str, str] = {
	# --- mtl ---
	"CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_BASE_ZH": "https://file.hankcs.com/hanlp/mtl/close_tok_pos_ner_srl_dep_sdp_con_electra_base_20210111_124519.zip",
	"CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH": "https://file.hankcs.com/hanlp/mtl/close_tok_pos_ner_srl_dep_sdp_con_electra_small_20210111_124159.zip",
	"CLOSE_TOK_POS_NER_SRL_DEP_SDP_CON_ERNIE_GRAM_ZH": "https://file.hankcs.com/hanlp/mtl/close_tok_pos_ner_srl_dep_sdp_con_ernie_gram_base_aug_20210904_145403.zip",
	"CLOSE_TOK_POS_NER_SRL_UDEP_SDP_CON_ELECTRA_SMALL_ZH": "https://file.hankcs.com/hanlp/mtl/close_tok_pos_ner_srl_dep_sdp_con_electra_small_20220626_175100.zip",
	"EN_TOK_LEM_POS_NER_SRL_UDEP_SDP_CON_MODERNBERT_BASE": "https://file.hankcs.com/hanlp/mtl/en_tok_lem_pos_ner_srl_udep_sdp_con_modernbert_base_prepend_false_20241229_053838.zip",
	"EN_TOK_LEM_POS_NER_SRL_UDEP_SDP_CON_MODERNBERT_LARGE": "https://file.hankcs.com/hanlp/mtl/en_tok_lem_pos_ner_srl_udep_sdp_con_modernbert_large_prepend_false_20250107_181612.zip",
	"KYOTO_EVAHAN_TOK_LEM_POS_UDEP_LZH": "https://file.hankcs.com/hanlp/mtl/kyoto_evahan_tok_lem_pos_udep_bert-ancient-chinese_lr_1_aug_dict_20250112_154422.zip",
	"NPCMJ_UD_KYOTO_TOK_POS_CON_BERT_BASE_CHAR_JA": "https://file.hankcs.com/hanlp/mtl/npcmj_ud_kyoto_tok_pos_ner_dep_con_srl_bert_base_char_ja_20210914_133742.zip",
	"OPEN_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_BASE_ZH": "https://file.hankcs.com/hanlp/mtl/open_tok_pos_ner_srl_dep_sdp_con_electra_base_20201223_201906.zip",
	"OPEN_TOK_POS_NER_SRL_DEP_SDP_CON_ELECTRA_SMALL_ZH": "https://file.hankcs.com/hanlp/mtl/open_tok_pos_ner_srl_dep_sdp_con_electra_small_20201223_035557.zip",
	"UD_ONTONOTES_TOK_POS_LEM_FEA_NER_SRL_DEP_SDP_CON_MMINILMV2L12": "https://file.hankcs.com/hanlp/mtl/ud_ontonotes_tok_pos_lem_fea_ner_srl_dep_sdp_con_mMiniLMv2L12_no_space_20220807_133143.zip",
	"UD_ONTONOTES_TOK_POS_LEM_FEA_NER_SRL_DEP_SDP_CON_MMINILMV2L6": "https://file.hankcs.com/hanlp/mtl/ud_ontonotes_tok_pos_lem_fea_ner_srl_dep_sdp_con_mMiniLMv2L6_no_space_20220731_161526.zip",
	"UD_ONTONOTES_TOK_POS_LEM_FEA_NER_SRL_DEP_SDP_CON_XLMR_BASE": "https://file.hankcs.com/hanlp/mtl/ud_ontonotes_tok_pos_lem_fea_ner_srl_dep_sdp_con_xlm_base_20220608_003435.zip",
	# --- tok ---
	"COARSE_ELECTRA_SMALL_ZH": "https://file.hankcs.com/hanlp/tok/coarse_electra_small_20220616_012050.zip",
	"CTB6_CONVSEG": "https://file.hankcs.com/hanlp/tok/ctb6_convseg_nowe_nocrf_20200110_004046.zip",
	"CTB9_TOK_ELECTRA_BASE": "http://download.hanlp.com/tok/extra/ctb9_tok_electra_base_20220426_111949.zip",
	"CTB9_TOK_ELECTRA_BASE_CRF": "http://download.hanlp.com/tok/extra/ctb9_tok_electra_base_crf_20220426_161255.zip",
	"CTB9_TOK_ELECTRA_SMALL": "https://file.hankcs.com/hanlp/tok/ctb9_electra_small_20220215_205427.zip",
	"FINE_ELECTRA_SMALL_ZH": "https://file.hankcs.com/hanlp/tok/fine_electra_small_20220615_231803.zip",
	"KYOTO_EVAHAN_TOK_LZH": "http://download.hanlp.com/tok/extra/kyoto_evahan_tok_bert-ancient-chinese_tau_0.5_20250111_234146.zip",
	"LARGE_ALBERT_BASE": "https://file.hankcs.com/hanlp/tok/large_corpus_cws_albert_base_20211228_160926.zip",
	"MSR_TOK_ELECTRA_BASE_CRF": "http://download.hanlp.com/tok/extra/msra_crf_electra_base_20220507_113936.zip",
	"PKU_NAME_MERGED_SIX_MONTHS_CONVSEG": "https://file.hankcs.com/hanlp/tok/pku98_6m_conv_ngram_20200110_134736.zip",
	"SIGHAN2005_MSR_CONVSEG": "https://file.hankcs.com/hanlp/tok/convseg-msr-nocrf-noembed_20200110_153524.zip",
	"SIGHAN2005_PKU_BERT_BASE_ZH": "https://file.hankcs.com/hanlp/tok/sighan2005_pku_bert_base_zh_20201231_141130.zip",
	"SIGHAN2005_PKU_CONVSEG": "https://file.hankcs.com/hanlp/tok/sighan2005-pku-convseg_20200110_153722.zip",
	"UD_TOK_MMINILMV2L12": "https://file.hankcs.com/hanlp/tok/ud_tok_mMiniLMv2L12_no_space_mul_20220619_091159.zip",
	"UD_TOK_MMINILMV2L6": "https://file.hankcs.com/hanlp/tok/ud_tok_mMiniLMv2L6_no_space_mul_20220619_091824.zip",
	# --- pos ---
	"C863_POS_ELECTRA_SMALL": "https://file.hankcs.com/hanlp/pos/pos_863_electra_small_20220217_101958.zip",
	"CTB5_POS_RNN": "https://file.hankcs.com/hanlp/pos/ctb5_pos_rnn_20200113_235925.zip",
	"CTB5_POS_RNN_FASTTEXT_ZH": "https://file.hankcs.com/hanlp/pos/ctb5_pos_rnn_fasttext_20191230_202639.zip",
	"CTB9_POS_ALBERT_BASE": "https://file.hankcs.com/hanlp/pos/ctb9_albert_base_20211228_163935.zip",
	"CTB9_POS_ELECTRA_SMALL": "https://file.hankcs.com/hanlp/pos/pos_ctb_electra_small_20220215_111944.zip",
	"CTB9_POS_ELECTRA_SMALL_TF": "https://file.hankcs.com/hanlp/pos/pos_ctb_electra_small_20211227_121341.zip",
	"CTB9_POS_RADICAL_ELECTRA_SMALL": "https://file.hankcs.com/hanlp/pos/pos_ctb_radical_electra_small_20220215_111932.zip",
	"PKU_POS_ELECTRA_SMALL": "https://file.hankcs.com/hanlp/pos/pos_pku_electra_small_20220217_142436.zip",
	"PTB_POS_RNN_FASTTEXT_EN": "https://file.hankcs.com/hanlp/pos/ptb_pos_rnn_fasttext_20220418_101708.zip",
	# --- ner ---
	"CONLL03_NER_BERT_BASE_CASED_EN": "https://file.hankcs.com/hanlp/ner/ner_conll03_bert_base_cased_en_20211227_121443.zip",
	"MSRA_NER_ALBERT_BASE_ZH": "https://file.hankcs.com/hanlp/ner/msra_ner_albert_base_20211228_173323.zip",
	"MSRA_NER_BERT_BASE_ZH": "https://file.hankcs.com/hanlp/ner/ner_bert_base_msra_20211227_114712.zip",
	"MSRA_NER_ELECTRA_SMALL_ZH": "https://file.hankcs.com/hanlp/ner/msra_ner_electra_small_20220215_205503.zip",
	# --- dep ---
	"CTB5_BIAFFINE_DEP_ZH": "https://file.hankcs.com/hanlp/dep/biaffine_ctb5_20191229_025833.zip",
	"CTB7_BIAFFINE_DEP_ZH": "https://file.hankcs.com/hanlp/dep/biaffine_ctb7_20200109_022431.zip",
	"CTB9_DEP_ELECTRA_SMALL": "https://file.hankcs.com/hanlp/dep/ctb9_dep_electra_small_20220216_100306.zip",
	"CTB9_UDC_ELECTRA_SMALL": "https://file.hankcs.com/hanlp/dep/udc_dep_electra_small_20220218_095452.zip",
	"PMT1_DEP_ELECTRA_SMALL": "https://file.hankcs.com/hanlp/dep/pmt_dep_electra_small_20220218_134518.zip",
	"PTB_BIAFFINE_DEP_EN": "https://file.hankcs.com/hanlp/dep/ptb_dep_biaffine_20200101_174624.zip",
	# --- constituency ---
	"CTB9_CON_ELECTRA_SMALL": "https://file.hankcs.com/hanlp/constituency/ctb9_con_electra_small_20220215_230116.zip",
	"CTB9_CON_FULL_TAG_ELECTRA_SMALL": "https://file.hankcs.com/hanlp/constituency/ctb9_full_tag_con_electra_small_20220118_103119.zip",
	"CTB9_CON_FULL_TAG_ERNIE_GRAM": "http://download.hanlp.com/constituency/extra/ctb9_full_tag_con_ernie_20220331_121430.zip",
	# --- srl ---
	"CPB3_SRL_ELECTRA_SMALL": "https://file.hankcs.com/hanlp/srl/cpb3_electra_small_crf_has_transform_20220218_135910.zip",
	# --- sdp ---
	"SEMEVAL15_DM_BIAFFINE_EN": "https://file.hankcs.com/hanlp/sdp/semeval15_biaffine_dm_20200106_122808.zip",
	"SEMEVAL15_PAS_BIAFFINE_EN": "https://file.hankcs.com/hanlp/sdp/semeval15_biaffine_pas_20200103_152405.zip",
	"SEMEVAL15_PSD_BIAFFINE_EN": "https://file.hankcs.com/hanlp/sdp/semeval15_biaffine_psd_20200106_123009.zip",
	"SEMEVAL16_ALL_ELECTRA_SMALL_ZH": "https://file.hankcs.com/hanlp/sdp/semeval16_sdp_electra_small_20220719_171433.zip",
	"SEMEVAL16_NEWS_BIAFFINE_ZH": "https://file.hankcs.com/hanlp/sdp/semeval16-news-biaffine_20191231_235407.zip",
	"SEMEVAL16_TEXT_BIAFFINE_ZH": "https://file.hankcs.com/hanlp/sdp/semeval16-text-biaffine_20200101_002257.zip",
}

_BRIDGE_CODE = r"""
import json
import os
import sys
import traceback


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()


def normalize_task_key(task_name):
    return str(task_name or "").strip().replace("/", "_").replace("-", "_")


def is_coref_task_name(task_name):
    return normalize_task_key(task_name) in {"cor", "coref", "coreference", "coreference_resolution"}


def version_in_range():
    current = (sys.version_info.major, sys.version_info.minor)
    return (3, 6) <= current <= (3, 10)


def load_payload():
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    return json.loads(raw)


def load_task_specs(payload):
    raw_matrix = payload.get("task_matrix") or {}
    raw_tasks = raw_matrix.get("tasks") or {}
    if not isinstance(raw_tasks, dict):
        return {}
    specs = {}
    for task_key, raw_spec in raw_tasks.items():
        if not isinstance(raw_spec, dict):
            continue
        specs[str(task_key)] = {
            "enabled": bool(raw_spec.get("enabled", True)),
            "task_name": str(raw_spec.get("task_name") or task_key).strip(),
            "model_id": str(raw_spec.get("model_id") or "").strip(),
        }
    return specs


def lookup_task_spec(payload, task_key):
    task_key = str(task_key or "").strip()
    specs = load_task_specs(payload)
    if task_key in specs:
        return specs[task_key]
    normalized = normalize_task_key(task_key)
    for spec in specs.values():
        if normalize_task_key(spec.get("task_name")) == normalized:
            return spec
    return None


def flatten_tokens(value):
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple)):
        items = []
        for child in value:
            items.extend(flatten_tokens(child))
        return items
    return []


def load_model(module, model_id):
    loader = getattr(module, "load", None)
    if not callable(loader):
        return None
    return loader(model_id)


def choose_ner_model(module, preferred_model_id):
    candidates = []
    preferred = str(preferred_model_id or "").strip()
    if preferred:
        candidates.append(preferred)
    candidates.extend([
        "MSRA_NER_BERT_BASE_ZH",
        "MSRA_NER_ELECTRA_SMALL_ZH",
        "MSRA_NER_ALBERT_BASE_ZH",
    ])
    for model_id in candidates:
        try:
            model = load_model(module, model_id)
        except Exception:
            continue
        if model is not None:
            return model
    return None


def extract_parse_result(result, task_name):
    if isinstance(result, dict):
        for key in (task_name, normalize_task_key(task_name), "ner/msra", "ner_msra", "dep", "sdp", "con", "pos"):
            if key in result:
                return result[key]
    return result


def ready_payload(reason_code, reason, **extra):
    payload = {
        "engine": "hanlp2",
        "status": "ready",
        "reason_code": reason_code,
        "reason": reason,
    }
    payload.update(extra)
    return payload


def unavailable_payload(reason_code, reason, **extra):
    payload = {
        "engine": "hanlp2",
        "status": "unavailable",
        "reason_code": reason_code,
        "reason": reason,
    }
    payload.update(extra)
    return payload


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "probe"
    payload = load_payload()

    if not version_in_range():
        emit(unavailable_payload("HANLP2_PYTHON_UNSUPPORTED", "Current Python version is unsupported by HanLP2 runtime."))
        return

    try:
        import hanlp
    except Exception:
        emit(unavailable_payload("HANLP2_IMPORT_UNAVAILABLE", "HanLP2 module is not installed or failed to import."))
        return

    if mode == "probe":
        model_id = str(payload.get("model_id") or "FINE_ELECTRA_SMALL_ZH").strip()
        emit(ready_payload("HANLP2_READY", "HanLP2 semantic engine is ready.", resolved_model=model_id, tokens=[]))
        return

    if mode in {"model_status", "ensure_model"}:
        model_id = str(payload.get("model_id") or "").strip()
        if not model_id:
            emit(unavailable_payload("HANLP2_MODEL_UNSPECIFIED", "HanLP2 model is not configured."))
            return
        try:
            load_model(hanlp, model_id)
        except Exception as exc:
            emit(unavailable_payload("HANLP2_MODEL_LOAD_FAILED", f"HanLP2 model load failed: {type(exc).__name__}."))
            return
        emit(ready_payload("HANLP2_MODEL_READY", "HanLP2 tokenizer model is ready."))
        return

    if mode == "tokenize":
        text = str(payload.get("text") or "")
        tokenizer = getattr(hanlp, "tokenize", None)
        if not callable(tokenizer):
            model_id = str(payload.get("model_id") or "FINE_ELECTRA_SMALL_ZH").strip()
            try:
                tokenizer = load_model(hanlp, model_id)
            except Exception:
                tokenizer = None
        if not callable(tokenizer):
            emit(unavailable_payload("HANLP2_TOKENIZE_UNAVAILABLE", "HanLP2 tokenizer is unavailable."))
            return
        try:
            tokens = flatten_tokens(tokenizer(text))
        except Exception as exc:
            emit(unavailable_payload("HANLP2_TOKENIZE_FAILED", f"HanLP2 semantic tokenization failed via tok: {type(exc).__name__}."))
            return
        emit(ready_payload("HANLP2_READY", "HanLP2 semantic engine is ready.", tokens=tokens))
        return

    if mode in {"task_status", "run_task"}:
        task_key = str(payload.get("task_key") or "").strip()
        spec = lookup_task_spec(payload, task_key) or {"task_name": task_key, "model_id": ""}
        task_name = str(spec.get("task_name") or task_key).strip()
        text = str(payload.get("text") or "")
		if is_coref_task_name(task_name):
			emit({
				"engine": "hanlp2",
				"status": "error",
				"reason_code": "HANLP2_COREF_NOT_OPEN_SOURCE",
				"reason": "HanLP coreference_resolution is not open-source and is disabled in CoPaw runtime.",
				"task_result": None,
			})
            return
        if mode == "task_status":
            emit(ready_payload("HANLP2_TASK_READY", "HanLP task is ready."))
            return

        task_result = None
        parse = getattr(hanlp, "parse", None)
        if callable(parse):
            try:
                task_result = extract_parse_result(parse(text, tasks=[task_name]), task_name)
            except Exception:
                task_result = None

        if task_result is None and normalize_task_key(task_name) == "ner_msra":
            model = choose_ner_model(hanlp, spec.get("model_id"))
            if callable(model):
                try:
                    task_result = model(text)
                except IndexError:
                    tokenizer = getattr(hanlp, "tokenize", None)
                    if callable(tokenizer):
                        task_result = model(flatten_tokens(tokenizer(text)))
                except Exception:
                    task_result = None

        if task_result is None:
            emit(unavailable_payload("HANLP2_TASK_UNAVAILABLE", "HanLP task is unavailable.", task_result=None))
            return
        emit(ready_payload("HANLP2_TASK_READY", "HanLP task is ready.", task_result=task_result))
        return

    emit(unavailable_payload("HANLP2_WORKER_PROTOCOL_ERROR", f"Unexpected mode: {mode}"))


if __name__ == "__main__":
	try:
		main()
	except Exception:
		emit(unavailable_payload("HANLP2_BRIDGE_CRASHED", traceback.format_exc()))
""".replace("\t", "    ")


def configure_runtime_env():
	os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
	os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
	if sys.platform == "darwin":
		os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
		os.environ.setdefault("PYTORCH_NVML_BASED_CUDA_CHECK", "0")
	hf_endpoint = (
		str(os.environ.get("COPAW_HF_ENDPOINT", "") or "").strip()
		or str(os.environ.get("COPAW_HANLP_HF_ENDPOINT", "") or "").strip()
	)
	if hf_endpoint:
		os.environ["HF_ENDPOINT"] = hf_endpoint
	os.environ.setdefault("COPAW_HANLP_REQUIRE_LOCAL_MODELS", "1")


def _default_runtime_state(*, status: str, reason_code: str, reason: str, **extra: Any) -> dict[str, Any]:
	payload: dict[str, Any] = {
		"engine": "hanlp2",
		"status": status,
		"reason_code": reason_code,
		"reason": reason,
	}
	payload.update(extra)
	return payload


def _worker_dispatch(mode: str, payload: dict[str, Any]) -> dict[str, Any]:
	bridge_input = json.dumps(payload, ensure_ascii=False)
	completed = subprocess.run(
		[sys.executable, "-c", _BRIDGE_CODE, mode],
		input=bridge_input,
		capture_output=True,
		text=True,
		check=False,
	)
	if completed.returncode != 0:
		return _default_runtime_state(
			status="unavailable",
			reason_code="HANLP2_BRIDGE_CRASHED",
			reason=(completed.stderr or "HanLP bridge exited unexpectedly.").strip() or "HanLP bridge exited unexpectedly.",
		)
	try:
		return json.loads(completed.stdout or "{}")
	except Exception:
		return _default_runtime_state(
			status="unavailable",
			reason_code="HANLP2_WORKER_PROTOCOL_ERROR",
			reason="HanLP worker returned invalid JSON.",
		)


_WORKER_CODE = r"""
import json
import sys
from copaw.knowledge.hanlp_nlp_runtime import _worker_dispatch

for line in sys.stdin:
    raw = str(line or "").strip()
    if not raw:
        continue
    request = json.loads(raw)
    mode = str(request.get("mode") or "probe")
    payload = request.get("payload") or {}
    response = _worker_dispatch(mode, payload)
    sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
    sys.stdout.flush()
"""


class NLPRuntime:
	"""HanLP sidecar runtime facade used by the migrated knowledge pipeline."""

	def __init__(self) -> None:
		configure_runtime_env()
		self._lock = threading.RLock()
		self._worker_process: subprocess.Popen[str] | None = None
		self._worker_cache_key = ""
		self._probe_cache_key = ""
		self._probe_cache_state: dict[str, Any] | None = None
		self._worker_started_once = False
		atexit.register(self.close)

	def close(self) -> None:
		with self._lock:
			self._stop_worker_locked()

	@staticmethod
	def _runtime_config(config: KnowledgeConfig | None) -> Any:
		return getattr(config, "hanlp", config)

	@staticmethod
	def _task_specs_payload(config: KnowledgeConfig | None) -> dict[str, Any]:
		runtime_config = NLPRuntime._runtime_config(config)
		tasks = getattr(getattr(runtime_config, "task_matrix", None), "tasks", {}) if runtime_config is not None else {}
		result: dict[str, Any] = {}
		for task_key, task_cfg in (tasks or {}).items():
			result[str(task_key)] = {
				"enabled": bool(getattr(task_cfg, "enabled", True)),
				"task_name": str(getattr(task_cfg, "task_name", task_key) or task_key).strip(),
				"model_id": str(getattr(task_cfg, "model_id", "") or "").strip(),
				"artifact_key": str(getattr(task_cfg, "artifact_key", task_key) or task_key).strip(),
				"eval_role": str(getattr(task_cfg, "eval_role", "compare") or "compare").strip(),
				"timeout_sec": float(getattr(task_cfg, "timeout_sec", 30.0) or 30.0),
			}
		return result

	def _config_payload(self, config: KnowledgeConfig | None) -> dict[str, Any]:
		runtime_config = self._runtime_config(config)
		return {
			"enabled": bool(getattr(runtime_config, "enabled", False)),
			"python_executable": str(getattr(runtime_config, "python_executable", "") or "").strip(),
			"model_id": str(getattr(runtime_config, "model_id", "") or "").strip(),
			"hanlp_home": str(getattr(runtime_config, "model_home", "") or "").strip(),
			"probe_timeout_sec": float(getattr(runtime_config, "probe_timeout_sec", 5.0) or 5.0),
			"tokenize_timeout_sec": float(getattr(runtime_config, "tokenize_timeout_sec", 15.0) or 15.0),
			"task_matrix": {"tasks": self._task_specs_payload(config)},
		}

	@staticmethod
	def _cache_key(payload: dict[str, Any]) -> str:
		return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

	@classmethod
	def _worker_cache_key_for_payload(cls, payload: dict[str, Any]) -> str:
		stable_payload = {
			key: value
			for key, value in payload.items()
			if key not in {"text", "task_key"}
		}
		return cls._cache_key(stable_payload)

	def _ensure_sidecar(self, payload: dict[str, Any]) -> Path:
		executable_text = str(payload.get("python_executable") or "").strip()
		if not payload.get("enabled") or not executable_text:
			raise ValueError("HANLP2_SIDECAR_UNCONFIGURED")
		executable = Path(executable_text)
		if not executable.exists():
			raise FileNotFoundError(executable_text)
		return executable

	@staticmethod
	def _sidecar_unavailable_state(error: Exception) -> dict[str, Any]:
		if isinstance(error, FileNotFoundError):
			return _default_runtime_state(
				status="unavailable",
				reason_code="HANLP2_SIDECAR_PYTHON_MISSING",
				reason="Configured HanLP2 Python executable was not found.",
			)
		return _default_runtime_state(
			status="unavailable",
			reason_code="HANLP2_SIDECAR_UNCONFIGURED",
			reason="HanLP2 sidecar is not configured.",
		)

	def _start_worker_locked(self, executable: Path, payload: dict[str, Any], *, cache_key: str) -> subprocess.Popen[str]:
		_ = payload
		process = subprocess.Popen(
			[str(executable), "-u", "-c", _WORKER_CODE],
			stdin=subprocess.PIPE,
			stdout=subprocess.PIPE,
			stderr=subprocess.PIPE,
			text=True,
		)
		self._worker_process = process
		self._worker_cache_key = cache_key
		return process

	def _stop_worker_locked(self) -> None:
		process = self._worker_process
		self._worker_process = None
		self._worker_cache_key = ""
		if process is None:
			return
		with contextlib.suppress(Exception):
			if process.poll() is None:
				process.terminate()
		with contextlib.suppress(Exception):
			process.wait(timeout=1.0)
		with contextlib.suppress(Exception):
			if process.poll() is None:
				process.kill()

	def _worker_request(self, executable: Path, *, mode: str, payload: dict[str, Any]) -> dict[str, Any]:
		cache_key = self._worker_cache_key_for_payload(payload)
		with self._lock:
			worker_restarted = False
			if (
				self._worker_process is None
				or self._worker_process.poll() is not None
				or self._worker_cache_key != cache_key
			):
				worker_restarted = self._worker_process is not None
				self._stop_worker_locked()
				process = self._start_worker_locked(executable, payload, cache_key=cache_key)
				cold_start = not self._worker_started_once
				self._worker_started_once = True
			else:
				process = self._worker_process
				cold_start = False

			assert process is not None
			request = json.dumps({"mode": mode, "payload": payload}, ensure_ascii=False) + "\n"
			try:
				assert process.stdin is not None
				process.stdin.write(request)
				process.stdin.flush()
			except Exception:
				self._stop_worker_locked()
				process = self._start_worker_locked(executable, payload, cache_key=cache_key)
				self._worker_started_once = True
				worker_restarted = True
				cold_start = False
				assert process.stdin is not None
				process.stdin.write(request)
				process.stdin.flush()

			assert process.stdout is not None
			response_text = process.stdout.readline().strip()
			if not response_text:
				response = _default_runtime_state(
					status="unavailable",
					reason_code="HANLP2_WORKER_PROTOCOL_ERROR",
					reason="HanLP worker returned an empty response.",
				)
			else:
				response = json.loads(response_text)
			response["worker_pid"] = int(getattr(process, "pid", 0) or 0)
			response["cold_start"] = cold_start
			response["worker_restarted"] = worker_restarted
			return response

	def _run_bridge(
		self,
		executable: Path,
		*,
		mode: str,
		payload: dict[str, Any],
		timeout: float,
		retry_on_timeout: bool = True,
	) -> dict[str, Any]:
		_ = timeout
		_ = retry_on_timeout
		return self._worker_request(executable, mode=mode, payload=payload)

	def probe(self, config: KnowledgeConfig | None = None) -> dict[str, Any]:
		payload = self._config_payload(config)
		cache_key = self._cache_key(payload)
		with self._lock:
			if (
				self._probe_cache_state is not None
				and self._probe_cache_key == cache_key
				and self._worker_process is not None
				and self._worker_process.poll() is None
				and self._worker_cache_key == cache_key
			):
				cached_state = dict(self._probe_cache_state)
				cached_state.setdefault("worker_pid", int(getattr(self._worker_process, "pid", 0) or 0))
				cached_state.setdefault("cold_start", False)
				cached_state.setdefault("worker_restarted", False)
				return cached_state
		try:
			executable = self._ensure_sidecar(payload)
		except ValueError:
			return _default_runtime_state(
				status="unavailable",
				reason_code="HANLP2_SIDECAR_UNCONFIGURED",
				reason="HanLP2 sidecar is not configured.",
			)
		except FileNotFoundError:
			return _default_runtime_state(
				status="unavailable",
				reason_code="HANLP2_SIDECAR_PYTHON_MISSING",
				reason="Configured HanLP2 Python executable was not found.",
			)

		state = self._run_bridge(
			executable,
			mode="probe",
			payload=payload,
			timeout=float(payload.get("probe_timeout_sec") or 5.0),
		)
		self._probe_cache_key = cache_key
		self._probe_cache_state = dict(state)
		return state

	def api_status(self, config: KnowledgeConfig | None = None) -> dict[str, Any]:
		return self.probe(config)

	def model_status(self, config: KnowledgeConfig | None = None) -> dict[str, Any]:
		probe_state = self.probe(config)
		if probe_state.get("status") != "ready":
			return probe_state
		payload = self._config_payload(config)
		try:
			executable = self._ensure_sidecar(payload)
		except (ValueError, FileNotFoundError) as error:
			return self._sidecar_unavailable_state(error)
		return self._run_bridge(
			executable,
			mode="model_status",
			payload=payload,
			timeout=float(payload.get("probe_timeout_sec") or 5.0),
		)

	def ensure_model(self, config: KnowledgeConfig | None = None) -> dict[str, Any]:
		probe_state = self.probe(config)
		if probe_state.get("status") != "ready":
			return probe_state
		payload = self._config_payload(config)
		try:
			executable = self._ensure_sidecar(payload)
		except (ValueError, FileNotFoundError) as error:
			return self._sidecar_unavailable_state(error)
		return self._run_bridge(
			executable,
			mode="ensure_model",
			payload=payload,
			timeout=float(payload.get("tokenize_timeout_sec") or 15.0),
		)

	def tokenize(self, text: str, config: KnowledgeConfig | None = None) -> tuple[list[str], dict[str, Any]]:
		probe_state = self.probe(config)
		if probe_state.get("status") != "ready":
			return [], probe_state
		payload = self._config_payload(config)
		payload["text"] = text
		try:
			executable = self._ensure_sidecar(payload)
		except (ValueError, FileNotFoundError) as error:
			return [], self._sidecar_unavailable_state(error)
		state = self._run_bridge(
			executable,
			mode="tokenize",
			payload=payload,
			timeout=float(payload.get("tokenize_timeout_sec") or 15.0),
		)
		tokens = state.get("tokens") if isinstance(state.get("tokens"), list) else []
		return [str(token) for token in tokens], state

	def task_status(self, task_key: str, config: KnowledgeConfig | None = None) -> dict[str, Any]:
		probe_state = self.probe(config)
		if probe_state.get("status") != "ready":
			return probe_state
		payload = self._config_payload(config)
		payload["task_key"] = task_key
		task_cfg = ((payload.get("task_matrix") or {}).get("tasks") or {}).get(task_key) or {}
		timeout = float(task_cfg.get("timeout_sec") or payload.get("tokenize_timeout_sec") or 15.0)
		try:
			executable = self._ensure_sidecar(payload)
		except (ValueError, FileNotFoundError) as error:
			return self._sidecar_unavailable_state(error)
		return self._run_bridge(
			executable,
			mode="task_status",
			payload=payload,
			timeout=timeout,
			retry_on_timeout=False,
		)

	def ner_status(self, config: KnowledgeConfig | None = None) -> dict[str, Any]:
		return self.task_status("ner_msra", config)

	def run_ner(self, text: str, config: KnowledgeConfig | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
		result, state = self.run_task("ner_msra", text, config)
		return result if isinstance(result, list) else [], state

	def run_dep(self, text: str, config: KnowledgeConfig | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
		result, state = self.run_task("dep", text, config)
		return result if isinstance(result, list) else [], state

	def run_task(
		self,
		task_key: str,
		text: str,
		config: KnowledgeConfig | None = None,
	) -> tuple[Any, dict[str, Any]]:
		probe_state = self.probe(config)
		if probe_state.get("status") != "ready":
			return [], probe_state
		payload = self._config_payload(config)
		payload["task_key"] = task_key
		payload["text"] = text
		task_cfg = ((payload.get("task_matrix") or {}).get("tasks") or {}).get(task_key) or {}
		timeout = float(task_cfg.get("timeout_sec") or payload.get("tokenize_timeout_sec") or 15.0)
		try:
			executable = self._ensure_sidecar(payload)
		except (ValueError, FileNotFoundError) as error:
			return [], self._sidecar_unavailable_state(error)
		state = self._run_bridge(
			executable,
			mode="run_task",
			payload=payload,
			timeout=timeout,
			retry_on_timeout=False,
		)
		return state.get("task_result"), state


__all__ = ["NLPRuntime", "_BRIDGE_CODE"]
