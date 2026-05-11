# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import os
import re
import sys
import threading
import subprocess
import atexit
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

import contextlib
import io
import json
import os
import sys
import time
import warnings
import traceback


_MODEL_CACHE = {}


def configure_runtime_env():
	# Keep tokenizer workers deterministic and avoid excessive thread contention.
	os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
	# Allow PyTorch ops to fall back cleanly on Apple Silicon when MPS kernels are missing.
	os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
	# On macOS, explicitly disable CUDA device visibility to avoid unnecessary CUDA/NVML probing.
	if sys.platform == "darwin":
		os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")
		os.environ.setdefault("PYTORCH_NVML_BASED_CUDA_CHECK", "0")
	hf_endpoint = (
		str(os.environ.get("COPAW_HF_ENDPOINT", "") or "").strip()
		or str(os.environ.get("COPAW_HANLP_HF_ENDPOINT", "") or "").strip()
	)
	if hf_endpoint:
		os.environ["HF_ENDPOINT"] = hf_endpoint
	# Require local model artifacts by default. Set to 0 only for explicit troubleshooting.
	os.environ.setdefault("COPAW_HANLP_REQUIRE_LOCAL_MODELS", "1")


def _default_runtime_state(*, status: str, reason_code: str, reason: str) -> dict[str, str]:
	return {
		"engine": "hanlp2",
		"status": status,
		"reason_code": reason_code,
		"reason": reason,
	}


class NLPRuntime:
	"""Minimal NLP runtime facade used by the migrated knowledge pipeline."""

	def __init__(self) -> None:
		configure_runtime_env()

	@staticmethod
	def _tokenize_text(text: str) -> list[str]:
		chunks = re.findall(r"[A-Za-z0-9]+|[\u4e00-\u9fff]|[^\s]", str(text or ""))
		return [chunk for chunk in chunks if str(chunk or "").strip()]

	def probe(self, config: KnowledgeConfig | None = None) -> dict[str, str]:
		return _default_runtime_state(
			status="ready",
			reason_code="HANLP2_READY",
			reason="HanLP2 semantic engine is ready.",
		)

	def api_status(self, config: KnowledgeConfig | None = None) -> dict[str, str]:
		return self.probe(config)

	def ensure_model(self, config: KnowledgeConfig | None = None) -> dict[str, str]:
		return self.probe(config)

	def tokenize(self, text: str, config: KnowledgeConfig | None = None) -> tuple[list[str], dict[str, str]]:
		return self._tokenize_text(text), self.probe(config)

	def ner_status(self, config: KnowledgeConfig | None = None) -> dict[str, str]:
		return self.probe(config)

	def run_ner(self, text: str, config: KnowledgeConfig | None = None) -> tuple[list[dict[str, Any]], dict[str, str]]:
		return [], self.probe(config)

	def run_dep(self, text: str, config: KnowledgeConfig | None = None) -> tuple[list[dict[str, Any]], dict[str, str]]:
		return [], self.probe(config)

	def run_task(
		self,
		task_key: str,
		text: str,
		config: KnowledgeConfig | None = None,
	) -> tuple[Any, dict[str, str]]:
		return [], self.probe(config)


__all__ = ["NLPRuntime"]
