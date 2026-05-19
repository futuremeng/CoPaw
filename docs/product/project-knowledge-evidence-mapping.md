# Project Knowledge Evidence Mapping (L2/L3 Matrix)

This document maps each metric shown in the six-layer matrix to:
- Display value source
- Backend `mode_metrics.evidence_paths` key
- Artifact source used by backend evidence selection

## Contract Path

- UI reads evidence paths from:
  - `syncState.mode_metrics.nlp.evidence_paths`
  - `syncState.mode_metrics.agentic.evidence_paths`
- API payload field:
  - `ProjectKnowledgeModeMetricsPayload.evidence_paths?: Record<string, string>`

## L2 (NLP) Matrix Metrics

| Layer | Metric (UI) | Display Value Source | Evidence Key | Backend Metric Source | Evidence Artifact Preference |
|---|---|---|---|---|---|
| Data Preprocess | Documents | `nlpMode.documentCount` | `document_count` | `processing_modes[nlp].document_count` | `document_graph_manifest`, `index` |
| Data Preprocess | Token Count | `nlpMode.syntaxTokenCount` (fallback `quantMetrics.tokenCount`) | `syntax_token_count` | `index_result.syntax_token_count` | `graph`, `document_graph_manifest` |
| Lexical | POS Count | `nlpMode.syntaxPosCount` | `syntax_pos_count` | `index_result.syntax_pos_count` | `graph`, `document_graph_manifest` |
| Lexical | POS Coverage (doc-token) | `nlpMode.posCoverageOnDocumentTokens` | `pos_coverage_on_document_tokens` | `index_result.pos_coverage_on_document_tokens` | `graph`, `document_graph_manifest` |
| Syntax | Sentence Count | `nlpMode.syntaxSentenceCount` | `syntax_sentence_count` | `index_result.syntax_sentence_count` | `graph` |
| Syntax | Relation Count | `nlpMode.syntaxRelationCount` | `syntax_relation_count` | `index_result.syntax_relation_count` | `graph` |
| Semantic | NER Entity Count | `nlpMode.nerEntityCount` | `ner_entity_count` | `index_result.ner_entity_count` | `graph`, `document_graph_manifest` |
| Semantic | Ready Normalized Docs | `nlpMode.nerReadyChunkCount` | `ner_ready_chunk_count` | `index_result.ner_ready_chunk_count` | `document_graph_manifest`, `document_graph_dir`, `graph` |

## L3 (Agentic) Matrix Metrics

| Layer | Metric (UI) | Display Value Source | Evidence Key | Backend Metric Source | Evidence Artifact Preference |
|---|---|---|---|---|---|
| Data Preprocess | Audit Status | Derived by UI state (`l3Ready/l3Running`) | `audit_status` | mode-level status from `processing_modes[agentic]` | `pipeline_artifact`, `quality_report`, `enriched_graph`, `graph` |
| Lexical | Audit Focus (lexical) | UI fixed text | `audit_focus` | mode-level audit context | `pipeline_artifact`, `quality_report`, `enriched_graph`, `graph` |
| Syntax | Audit Focus (syntax) | UI fixed text | `audit_focus` | mode-level audit context | `pipeline_artifact`, `quality_report`, `enriched_graph`, `graph` |
| Semantic | Audit Focus (semantic) | UI fixed text | `audit_focus` | mode-level audit context | `pipeline_artifact`, `quality_report`, `enriched_graph`, `graph` |
| Pragmatic | Quality Score | `agenticMode.qualityScore` | `quality_score` | `processing_modes[agentic].quality_score` (quality loop snapshot) | `quality_report`, `pipeline_artifact`, `enriched_graph` |
| Pragmatic | Audit Round | `agenticMode.auditRound` (fallback `agenticMode.runId`) | `audit_round` | pipeline run / quality loop context | `pipeline_artifact`, `quality_report`, `enriched_graph` |
| Pragmatic | Delta vs L2 | UI computed delta (`l3-l2`) | `enhancement_delta` | derived from L2/L3 entity+relation counts | `enriched_graph`, `pipeline_artifact`, `quality_report`, `graph` |

## Not Implemented Layer

- Phrase layer is placeholder only (`PHRASE_LAYER_NOT_IMPLEMENTED`)
- No evidence key is provided; evidence button remains disabled

## Coverage Check

Current matrix evidence keys used by UI are all covered by backend `evidence_paths` generation.

- UI keys: 13
- Covered by backend: 13
- Additional backend keys not yet used by matrix buttons: `entity_count`, `relation_count`

## Suggested Manual Verification

1. Open Project Knowledge Processing panel.
2. For each enabled `View Evidence` button in L2/L3, click and confirm file tree selection jumps to expected artifact path.
3. Confirm Phrase-layer buttons are disabled.
4. Confirm when agentic pipeline artifacts are empty, L3 buttons can still resolve to `quality_report` or `enriched_graph` paths.
