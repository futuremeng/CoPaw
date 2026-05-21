import { Button, Modal, Select, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "../index.module.less";
import { buildProjectKnowledgeProcessingRecentHistorySectionsFromState } from "../utils/projectKnowledgeRecentHistoryModel";
import {
  buildKnowledgeSourceRows,
} from "../utils/projectKnowledgeSourceRows";
import type {
  ProjectKnowledgeModeState,
  ProjectKnowledgeProcessingScope,
  ProjectKnowledgeState,
} from "../hooks/useProjectKnowledgeState";
import type {
  ProjectKnowledgeMetricEvidenceBundlePayload,
  ProjectKnowledgeModeMetricsPayload,
  ProjectKnowledgeProcessingMode,
} from "../../../../api/types";
import type { AgentProjectFileInfo } from "../../../../api/types/agents";

type ProjectKnowledgeNlpStageKey = "tokenize" | "ner" | "syntax" | "cor";
type ProjectKnowledgeLayerKey =
  | "dataPreprocess"
  | "lexical"
  | "phrase"
  | "syntax"
  | "semantic"
  | "pragmatic";
type ProjectKnowledgeLayerStatus = "ready" | "running" | "pending" | "unavailable";

interface ProjectKnowledgeLayerCellMetric {
  label: string;
  value: string | number;
  evidenceKey?: string;
  evidencePath?: string;
}

interface ProjectKnowledgeLayerCell {
  status: ProjectKnowledgeLayerStatus;
  summary: string;
  reason?: string;
  metrics: ProjectKnowledgeLayerCellMetric[];
}

interface ProjectKnowledgeLayerRow {
  key: ProjectKnowledgeLayerKey;
  title: string;
  description: string;
  l2: ProjectKnowledgeLayerCell;
  l3: ProjectKnowledgeLayerCell;
}

interface ProjectKnowledgeProcessingPanelProps {
  knowledgeState: ProjectKnowledgeState;
  projectFiles: AgentProjectFileInfo[];
  onOpenSettings?: () => void;
  onSelectArtifactPath?: (path: string) => void | Promise<void>;
  focusedMode?: ProjectKnowledgeModeState["mode"];
  focusedStage?: ProjectKnowledgeNlpStageKey;
  focusedScope?: ProjectKnowledgeProcessingScope;
  focusToken?: number;
}

function modeHasIndependentOutputs(mode: ProjectKnowledgeModeState | null): boolean {
  if (!mode) {
    return false;
  }
  return mode.available || mode.entityCount > 0 || mode.relationCount > 0 || mode.qualityScore != null;
}

function mergeModeStateWithMetrics(
  baseMode: ProjectKnowledgeModeState | null,
  metrics: ProjectKnowledgeModeMetricsPayload | null,
): ProjectKnowledgeModeState | null {
  if (!baseMode || !metrics) {
    return baseMode;
  }
  const next = {
    ...baseMode,
  };
  if (typeof metrics.document_count === "number") {
    next.documentCount = Math.max(0, Number(next.documentCount || 0), Number(metrics.document_count));
  }
  if (typeof metrics.chunk_count === "number") {
    next.chunkCount = Math.max(0, Number(next.chunkCount || 0), Number(metrics.chunk_count));
  }
  if (typeof metrics.entity_count === "number") {
    next.entityCount = Math.max(0, Number(next.entityCount || 0), Number(metrics.entity_count));
  }
  if (typeof metrics.relation_count === "number") {
    next.relationCount = Math.max(0, Number(next.relationCount || 0), Number(metrics.relation_count));
  }
  if (metrics.quality_score != null && Number.isFinite(Number(metrics.quality_score))) {
    next.qualityScore = Number(metrics.quality_score);
  }
  if (typeof metrics.ner_ready_chunk_count === "number") {
    next.nerReadyChunkCount = Math.max(0, Number(next.nerReadyChunkCount || 0), Number(metrics.ner_ready_chunk_count));
  }
  if (typeof metrics.ner_entity_count === "number") {
    next.nerEntityCount = Math.max(0, Number(next.nerEntityCount || 0), Number(metrics.ner_entity_count));
  }
  if (typeof metrics.syntax_sentence_count === "number") {
    next.syntaxSentenceCount = Math.max(0, Number(next.syntaxSentenceCount || 0), Number(metrics.syntax_sentence_count));
  }
  if (typeof metrics.syntax_token_count === "number") {
    next.syntaxTokenCount = Math.max(0, Number(next.syntaxTokenCount || 0), Number(metrics.syntax_token_count));
  }
  if (typeof metrics.syntax_pos_count === "number") {
    next.syntaxPosCount = Math.max(0, Number(next.syntaxPosCount || 0), Number(metrics.syntax_pos_count));
  }
  if (typeof metrics.pos_coverage_on_document_tokens === "number") {
    next.posCoverageOnDocumentTokens = Number(metrics.pos_coverage_on_document_tokens);
  }
  if (typeof metrics.syntax_relation_count === "number") {
    next.syntaxRelationCount = Math.max(0, Number(next.syntaxRelationCount || 0), Number(metrics.syntax_relation_count));
  }
  return next;
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`;
}

function formatDoneTotal(done: number, total: number): string {
  const safeDone = Math.max(0, Number(done || 0));
  const safeTotal = Math.max(0, Number(total || 0));
  if (safeTotal <= 0) {
    return `${safeDone}/-`;
  }
  return `${safeDone}/${safeTotal}`;
}

function resolveEvidencePathByKey(
  evidencePaths: Record<string, string>,
  key: string,
): string {
  const path = String(evidencePaths[key] || "").trim();
  return path;
}

function mapModeToLayerStatus(
  mode: ProjectKnowledgeModeState | null,
  ready: boolean,
  unavailable = false,
): ProjectKnowledgeLayerStatus {
  if (unavailable) {
    return "unavailable";
  }
  if (ready) {
    return mode?.status === "running" || mode?.status === "queued" ? "running" : "ready";
  }
  if (mode?.status === "running" || mode?.status === "queued") {
    return "running";
  }
  return "pending";
}

function buildKnowledgeLayerRows(
  params: {
    nlpMode: ProjectKnowledgeModeState | null;
    agenticMode: ProjectKnowledgeModeState | null;
    l2EvidencePaths: Record<string, string>;
    l3EvidencePaths: Record<string, string>;
    entityDelta: number;
    relationDelta: number;
    t: ReturnType<typeof useTranslation>["t"];
  },
): ProjectKnowledgeLayerRow[] {
  const {
    nlpMode,
    agenticMode,
    l2EvidencePaths,
    l3EvidencePaths,
    entityDelta,
    relationDelta,
    t,
  } = params;
  const hasL3Outputs = modeHasIndependentOutputs(agenticMode);
  const l3Running = agenticMode?.status === "running" || agenticMode?.status === "queued";
  const l3Ready = Boolean(agenticMode && hasL3Outputs && agenticMode.status === "ready");
  const l2DocumentCount = Math.max(0, Number(nlpMode?.tokenizeDoneDocuments || nlpMode?.documentCount || 0));
  const l2TotalDocuments = Math.max(0, Number(nlpMode?.tokenizeTotalDocuments || 0));
  const l2DoneLines = Math.max(0, Number(nlpMode?.tokenizeDoneLines || 0));
  const l2TotalLines = Math.max(0, Number(nlpMode?.tokenizeTotalLines || 0));
  const l2TokenCountFromDocuments = (nlpMode?.tokenizeDocumentsProgress || []).reduce((sum, item) => {
    if (String(item?.status || "").trim().toLowerCase() !== "ready") {
      return sum;
    }
    return sum + Math.max(0, Number(item?.token_count_ready || 0));
  }, 0);
  const l2TokenCount = l2TokenCountFromDocuments > 0
    ? l2TokenCountFromDocuments
    : Math.max(0, Number(nlpMode?.syntaxTokenCount || 0));
  const l2TokenizeFinished = l2TotalDocuments > 0 && l2DocumentCount >= l2TotalDocuments;
  const l2PosCount = Math.max(0, Number(nlpMode?.syntaxPosCount || 0));
  const l2PosCoverage = formatPercent(Number(nlpMode?.posCoverageOnDocumentTokens || 0));
  const l2SyntaxRelations = Math.max(0, Number(nlpMode?.syntaxRelationCount || 0));
  const l2SyntaxSentences = Math.max(0, Number(nlpMode?.syntaxSentenceCount || 0));
  const l2NerEntities = Math.max(0, Number(nlpMode?.nerEntityCount || 0));
  const l2NerReadyChunks = Math.max(0, Number(nlpMode?.nerReadyChunkCount || 0));
  const l3Quality = agenticMode?.qualityScore != null
    ? `${Math.round(Number(agenticMode.qualityScore) * 100)}%`
    : t("copaw.projects.knowledge.processing.metricPending");

  const buildL3Cell = (
    summaryKey: string,
    metrics: ProjectKnowledgeLayerCellMetric[],
    reason?: string,
  ): ProjectKnowledgeLayerCell => ({
    status: mapModeToLayerStatus(agenticMode, l3Ready, false),
    summary: l3Ready
      ? t(summaryKey)
      : l3Running
        ? t("copaw.projects.knowledge.processing.l3AuditRunning")
        : t("copaw.projects.knowledge.processing.l3AuditPending"),
    reason,
    metrics,
  });

  return [
    {
      key: "dataPreprocess",
      title: t("copaw.projects.knowledge.processing.layerDataPreprocessTitle"),
      description: t("copaw.projects.knowledge.processing.layerDataPreprocessDesc"),
      l2: {
        status: mapModeToLayerStatus(nlpMode, l2TokenizeFinished || l2TokenCount > 0),
        summary: t("copaw.projects.knowledge.processing.layerDataPreprocessL2"),
        metrics: [
          {
            label: t("copaw.projects.knowledge.documents"),
            value: formatDoneTotal(l2DocumentCount, l2TotalDocuments),
            evidenceKey: "document_count",
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "document_count"),
          },
          {
            label: t("copaw.projects.knowledge.processing.tokenizeLineProgress", "Tokenize lines"),
            value: formatDoneTotal(l2DoneLines, l2TotalLines),
            evidenceKey: "tokenize_line_count",
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "tokenize_line_count"),
          },
          {
            label: t("copaw.projects.knowledge.processing.syntaxTokens"),
            value: l2TokenCount,
            evidenceKey: "tokenize_token_count",
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "tokenize_token_count"),
          },
        ],
      },
      l3: buildL3Cell(
        "copaw.projects.knowledge.processing.layerDataPreprocessL3",
        [
          {
            label: t("copaw.projects.knowledge.processing.auditStatus"),
            value: l3Ready
              ? t("copaw.projects.knowledge.processing.stageReady")
              : l3Running
                ? t("copaw.projects.knowledge.processing.stageRunning")
                : t("copaw.projects.knowledge.processing.stagePending"),
            evidenceKey: "audit_status",
            evidencePath: resolveEvidencePathByKey(l3EvidencePaths, "audit_status"),
          },
        ],
      ),
    },
    {
      key: "lexical",
      title: t("copaw.projects.knowledge.processing.layerLexicalTitle"),
      description: t("copaw.projects.knowledge.processing.layerLexicalDesc"),
      l2: {
        status: mapModeToLayerStatus(nlpMode, l2PosCount > 0),
        summary: t("copaw.projects.knowledge.processing.layerLexicalL2"),
        metrics: [
          {
            label: t("copaw.projects.knowledge.processing.syntaxPosCount"),
            value: l2PosCount,
            evidenceKey: "syntax_pos_count",
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "syntax_pos_count"),
          },
          {
            label: t("copaw.projects.knowledge.processing.posCoverageDocument"),
            value: l2PosCoverage,
            evidenceKey: "pos_coverage_on_document_tokens",
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "pos_coverage_on_document_tokens"),
          },
        ],
      },
      l3: buildL3Cell(
        "copaw.projects.knowledge.processing.layerLexicalL3",
        [
          {
            label: t("copaw.projects.knowledge.processing.auditFocus"),
            value: t("copaw.projects.knowledge.processing.auditFocusLexical"),
            evidenceKey: "audit_focus",
            evidencePath: resolveEvidencePathByKey(l3EvidencePaths, "audit_focus"),
          },
        ],
      ),
    },
    {
      key: "phrase",
      title: t("copaw.projects.knowledge.processing.layerPhraseTitle"),
      description: t("copaw.projects.knowledge.processing.layerPhraseDesc"),
      l2: {
        status: mapModeToLayerStatus(nlpMode, false, true),
        summary: t("copaw.projects.knowledge.processing.layerPhraseL2"),
        reason: "PHRASE_LAYER_NOT_IMPLEMENTED",
        metrics: [
          {
            label: t("copaw.projects.knowledge.processing.stageReason"),
            value: "PHRASE_LAYER_NOT_IMPLEMENTED",
          },
        ],
      },
      l3: {
        status: mapModeToLayerStatus(agenticMode, false, true),
        summary: t("copaw.projects.knowledge.processing.layerPhraseL3"),
        reason: "PHRASE_LAYER_NOT_IMPLEMENTED",
        metrics: [
          {
            label: t("copaw.projects.knowledge.processing.auditStatus"),
            value: t("copaw.projects.knowledge.processing.stageUnavailable"),
          },
        ],
      },
    },
    {
      key: "syntax",
      title: t("copaw.projects.knowledge.processing.layerSyntaxTitle"),
      description: t("copaw.projects.knowledge.processing.layerSyntaxDesc"),
      l2: {
        status: mapModeToLayerStatus(nlpMode, l2SyntaxRelations > 0),
        summary: t("copaw.projects.knowledge.processing.layerSyntaxL2"),
        metrics: [
          {
            label: t("copaw.projects.knowledge.processing.syntaxSentences"),
            value: l2SyntaxSentences,
            evidenceKey: "syntax_sentence_count",
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "syntax_sentence_count"),
          },
          {
            label: t("copaw.projects.knowledge.processing.syntaxRelations"),
            value: l2SyntaxRelations,
            evidenceKey: "syntax_relation_count",
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "syntax_relation_count"),
          },
        ],
      },
      l3: buildL3Cell(
        "copaw.projects.knowledge.processing.layerSyntaxL3",
        [
          {
            label: t("copaw.projects.knowledge.processing.auditFocus"),
            value: t("copaw.projects.knowledge.processing.auditFocusSyntax"),
            evidenceKey: "audit_focus",
            evidencePath: resolveEvidencePathByKey(l3EvidencePaths, "audit_focus"),
          },
        ],
      ),
    },
    {
      key: "semantic",
      title: t("copaw.projects.knowledge.processing.layerSemanticTitle"),
      description: t("copaw.projects.knowledge.processing.layerSemanticDesc"),
      l2: {
        status: mapModeToLayerStatus(nlpMode, l2NerEntities > 0 || l2NerReadyChunks > 0),
        summary: t("copaw.projects.knowledge.processing.layerSemanticL2"),
        metrics: [
          {
            label: t("copaw.projects.knowledge.processing.nerEntities"),
            value: l2NerEntities,
            evidenceKey: "ner_entity_count",
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "ner_entity_count"),
          },
          {
            label: t("copaw.projects.knowledge.processing.readyChunks"),
            value: l2NerReadyChunks,
            evidenceKey: "ner_ready_chunk_count",
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "ner_ready_chunk_count"),
          },
        ],
      },
      l3: buildL3Cell(
        "copaw.projects.knowledge.processing.layerSemanticL3",
        [
          {
            label: t("copaw.projects.knowledge.processing.auditFocus"),
            value: t("copaw.projects.knowledge.processing.auditFocusSemantic"),
            evidenceKey: "audit_focus",
            evidencePath: resolveEvidencePathByKey(l3EvidencePaths, "audit_focus"),
          },
        ],
      ),
    },
    {
      key: "pragmatic",
      title: t("copaw.projects.knowledge.processing.layerPragmaticTitle"),
      description: t("copaw.projects.knowledge.processing.layerPragmaticDesc"),
      l2: {
        status: "pending",
        summary: t("copaw.projects.knowledge.processing.layerPragmaticL2"),
        metrics: [
          {
            label: t("copaw.projects.knowledge.processing.layerOwner"),
            value: t("copaw.projects.knowledge.layerL3"),
          },
        ],
      },
      l3: {
        status: mapModeToLayerStatus(agenticMode, l3Ready),
        summary: l3Ready
          ? t("copaw.projects.knowledge.processing.layerPragmaticL3")
          : l3Running
            ? t("copaw.projects.knowledge.processing.l3ReasoningRunning")
            : t("copaw.projects.knowledge.processing.l3ReasoningPending"),
        metrics: [
          {
            label: t("copaw.projects.knowledge.processing.qualityScore"),
            value: l3Quality,
            evidenceKey: "quality_score",
            evidencePath: resolveEvidencePathByKey(l3EvidencePaths, "quality_score"),
          },
          {
            label: t("copaw.projects.knowledge.processing.auditRound"),
            value: agenticMode?.auditRound
              ? `#${agenticMode.auditRound}`
              : agenticMode?.runId || t("copaw.projects.knowledge.processing.metricUnavailable"),
            evidenceKey: "audit_round",
            evidencePath: resolveEvidencePathByKey(l3EvidencePaths, "audit_round"),
          },
          {
            label: t("copaw.projects.knowledge.processing.enhancementDelta"),
            value: hasL3Outputs
              ? t("copaw.projects.knowledge.processing.deltaSummary", {
                entities: entityDelta,
                relations: relationDelta,
              })
              : t("copaw.projects.knowledge.processing.outputPendingLong"),
            evidenceKey: "enhancement_delta",
            evidencePath: resolveEvidencePathByKey(l3EvidencePaths, "enhancement_delta"),
          },
        ],
      },
    },
  ];
}

function nlpStageTagColor(
  status: "ready" | "running" | "pending" | "unavailable",
): string {
  if (status === "ready") {
    return "success";
  }
  if (status === "running") {
    return "processing";
  }
  if (status === "unavailable") {
    return "default";
  }
  return "gold";
}

function nlpStageStatusLabel(
  status: "ready" | "running" | "pending" | "unavailable",
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (status === "ready") {
    return t("copaw.projects.knowledge.processing.stageReady");
  }
  if (status === "running") {
    return t("copaw.projects.knowledge.processing.stageRunning");
  }
  if (status === "unavailable") {
    return t("copaw.projects.knowledge.processing.stageUnavailable");
  }
  return t("copaw.projects.knowledge.processing.stagePending");
}

export default function ProjectKnowledgeProcessingPanel(
  props: ProjectKnowledgeProcessingPanelProps,
) {
  const { t } = useTranslation();
  const [activeEvidence, setActiveEvidence] = useState<{
    mode: ProjectKnowledgeProcessingMode;
    scope: "global" | "source";
    sourceId?: string;
    sourceLabel?: string;
    metricLabel: string;
    metricValue: string | number;
    metricKey: string;
    summary: string;
    bundle: ProjectKnowledgeMetricEvidenceBundlePayload | null;
    fallbackPath: string;
  } | null>(null);
  const visibleModes = props.knowledgeState.processingCompareModes.filter(
    (mode) => mode.mode === "nlp" || mode.mode === "agentic",
  );
  const sourceRows = useMemo(() => buildKnowledgeSourceRows(props.projectFiles || []), [props.projectFiles]);
  // 已移除 sourceRowByLookup，因下拉选项已直接基于 sourceRows 生成
  // 下拉选项直接遍历所有有效项目文件，允许每个文件都能手动发起加工
  const sourceOptions = useMemo(() => (
    sourceRows.map((row) => ({
      value: row.path, // 用 path 作为唯一标识
      label: row.path,
      title: row.title,
    }))
  ), [sourceRows]);
  const effectiveSourceId = String(
    sourceOptions.some((item) => item.value === props.knowledgeState.selectedSourceId)
      ? props.knowledgeState.selectedSourceId
      : (sourceOptions[0]?.value || ""),
  ).trim();
  const effectiveSourceOption = sourceOptions.find((item) => item.value === effectiveSourceId) || null;
  const effectiveSourceLabel = String(
    effectiveSourceOption?.label || sourceOptions.find((item) => item.value === effectiveSourceId)?.title || effectiveSourceId,
  ).trim();

  const nlpBaseMode = visibleModes.find((mode) => mode.mode === "nlp") || null;
  const agenticBaseMode = visibleModes.find((mode) => mode.mode === "agentic") || null;
  const globalModeMetricsPayload = useMemo(
    () => {
      if (props.knowledgeState.resolveProcessingModeMetrics) {
        return props.knowledgeState.resolveProcessingModeMetrics("global", effectiveSourceId);
      }
      return (props.knowledgeState.syncState?.mode_metrics || {}) as Partial<Record<ProjectKnowledgeProcessingMode, ProjectKnowledgeModeMetricsPayload>>;
    },
    [effectiveSourceId, props.knowledgeState],
  );
  const sourceModeMetricsPayload = useMemo(
    () => {
      if (props.knowledgeState.resolveProcessingModeMetrics) {
        return props.knowledgeState.resolveProcessingModeMetrics("source", effectiveSourceId);
      }
      return (props.knowledgeState.syncState?.mode_metrics || {}) as Partial<Record<ProjectKnowledgeProcessingMode, ProjectKnowledgeModeMetricsPayload>>;
    },
    [effectiveSourceId, props.knowledgeState],
  );
  const globalNlpMode = mergeModeStateWithMetrics(nlpBaseMode, globalModeMetricsPayload.nlp || null);
  const sourceNlpMode = mergeModeStateWithMetrics(nlpBaseMode, sourceModeMetricsPayload.nlp || null);
  const sourceAgenticMode = mergeModeStateWithMetrics(agenticBaseMode, sourceModeMetricsPayload.agentic || null);
  const sourceL2EvidencePaths = (sourceModeMetricsPayload.nlp?.evidence_paths || {}) as Record<string, string>;
  const sourceL3EvidencePaths = (sourceModeMetricsPayload.agentic?.evidence_paths || {}) as Record<string, string>;
  const l2EvidenceBundles = useMemo(
    () => (sourceModeMetricsPayload.nlp?.evidence_bundles || {}) as Record<string, ProjectKnowledgeMetricEvidenceBundlePayload>,
    [sourceModeMetricsPayload.nlp?.evidence_bundles],
  );
  const l3EvidenceBundles = useMemo(
    () => (sourceModeMetricsPayload.agentic?.evidence_bundles || {}) as Record<string, ProjectKnowledgeMetricEvidenceBundlePayload>,
    [sourceModeMetricsPayload.agentic?.evidence_bundles],
  );
  const { entityDelta, relationDelta } = props.knowledgeState.processingCompareDelta;
  const recentHistorySections = useMemo(
    () => buildProjectKnowledgeProcessingRecentHistorySectionsFromState(t, props.knowledgeState),
    [props.knowledgeState, t],
  );
  const evidencePathsForModal = useMemo(() => {
    const merged: string[] = [];
    const samplePaths = activeEvidence?.bundle?.sample_source_paths || [];
    const artifactPaths = activeEvidence?.bundle?.artifact_paths || [];
    if (activeEvidence?.metricKey === "tokenize_line_count" && activeEvidence?.fallbackPath) {
      const normalizedPath = String(activeEvidence.fallbackPath || "").trim();
      if (normalizedPath) {
        merged.push(normalizedPath);
      }
      return merged;
    }
    if (
      (activeEvidence?.metricKey === "document_count" || activeEvidence?.metricKey === "tokenize_token_count")
      && samplePaths.length > 0
    ) {
      for (const pathText of samplePaths) {
        const normalizedPath = String(pathText || "").trim();
        if (!normalizedPath || merged.includes(normalizedPath)) {
          continue;
        }
        merged.push(normalizedPath);
      }
      return merged;
    }
    for (const pathText of [...samplePaths, ...artifactPaths]) {
      const normalizedPath = String(pathText || "").trim();
      if (!normalizedPath || merged.includes(normalizedPath)) {
        continue;
      }
      merged.push(normalizedPath);
    }
    if (!merged.length && activeEvidence?.fallbackPath) {
      merged.push(activeEvidence.fallbackPath);
    }
    return merged;
  }, [activeEvidence]);
  const evidenceSourceCount = Math.max(0, Number(activeEvidence?.bundle?.source_count || 0));
  const evidenceSampleCoverage = evidenceSourceCount > 0
    ? `${evidencePathsForModal.length}/${evidenceSourceCount}`
    : `${evidencePathsForModal.length}`;
  const globalDocumentCount = Math.max(0, Number(globalNlpMode?.tokenizeDoneDocuments || globalNlpMode?.documentCount || 0));
  const globalTotalDocuments = Math.max(0, Number(globalNlpMode?.tokenizeTotalDocuments || 0));
  const globalDoneLines = Math.max(0, Number(globalNlpMode?.tokenizeDoneLines || 0));
  const globalTotalLines = Math.max(0, Number(globalNlpMode?.tokenizeTotalLines || 0));
  const globalTokenCountFromDocuments = (globalNlpMode?.tokenizeDocumentsProgress || []).reduce((sum, item) => {
    if (String(item?.status || "").trim().toLowerCase() !== "ready") {
      return sum;
    }
    return sum + Math.max(0, Number(item?.token_count_ready || 0));
  }, 0);
  const globalTokenCount = globalTokenCountFromDocuments > 0
    ? globalTokenCountFromDocuments
    : Math.max(0, Number(globalNlpMode?.syntaxTokenCount || 0));
  const layerRows = buildKnowledgeLayerRows({
    nlpMode: sourceNlpMode,
    agenticMode: sourceAgenticMode,
    l2EvidencePaths: sourceL2EvidencePaths,
    l3EvidencePaths: sourceL3EvidencePaths,
    entityDelta,
    relationDelta,
    t,
  });
  const tokenizeDocumentsProgress = useMemo(() => {
    return (globalNlpMode?.tokenizeDocumentsProgress || []).map((item) => ({
      sourceId: String(item.source_id || "").trim(),
      documentPath: String(item.document_path || "").trim(),
      status: String(item.status || "queued").trim().toLowerCase(),
      doneLines: Math.max(0, Number(item.done_lines || 0)),
      totalLines: Math.max(0, Number(item.total_lines || 0)),
      readyTokens: Math.max(0, Number(item.token_count_ready || 0)),
      updatedAt: String(item.updated_at || "").trim(),
    })).filter((item) => item.documentPath);
  }, [globalNlpMode?.tokenizeDocumentsProgress]);
  const tokenizeRunningDocuments = useMemo(
    () => tokenizeDocumentsProgress.filter((item) => item.status === "running" || item.status === "queued"),
    [tokenizeDocumentsProgress],
  );

  return (
    <div className={`${styles.projectKnowledgeWorkbench} ${styles.projectKnowledgeProcessingWorkbench}`}>
      <div className={styles.projectKnowledgeProcessingScrollBody}>
        <div className={styles.projectKnowledgeProcessingSection}>
          <Typography.Text strong>{t("projects.knowledgeDock.tabProcessing", "Processing")}</Typography.Text>
          <Typography.Text type="secondary">
            {t("copaw.projects.knowledge.processing.globalOverviewHint", "项目全局占位指标，后续会继续细化")}
          </Typography.Text>
          <div className={styles.projectKnowledgeSignalGrid}>
            <div className={styles.projectKnowledgeSignalCard}>
              <Typography.Text type="secondary">{t("copaw.projects.knowledge.documents")}</Typography.Text>
              <Typography.Text strong>{formatDoneTotal(globalDocumentCount, globalTotalDocuments)}</Typography.Text>
            </div>
            <div className={styles.projectKnowledgeSignalCard}>
              <Typography.Text type="secondary">{t("copaw.projects.knowledge.processing.tokenizeLineProgress", "Tokenize lines")}</Typography.Text>
              <Typography.Text strong>{formatDoneTotal(globalDoneLines, globalTotalLines)}</Typography.Text>
            </div>
            <div className={styles.projectKnowledgeSignalCard}>
              <Typography.Text type="secondary">{t("copaw.projects.knowledge.processing.syntaxTokens")}</Typography.Text>
              <Typography.Text strong>{globalTokenCount}</Typography.Text>
            </div>
          </div>
        </div>

        <div className={styles.projectKnowledgeProcessingSection}>
          <div className={styles.projectKnowledgeHistoryStrip}>
            <div className={styles.projectKnowledgeHistoryHeader}>
              <Typography.Text strong>
                {t("copaw.projects.knowledge.processing.tokenizeProgressTitle", "Tokenize progress")}
              </Typography.Text>
              <Typography.Text type="secondary">
                {formatDoneTotal(
                  Math.max(0, Number(globalNlpMode?.tokenizeDoneLines || 0)),
                  Math.max(0, Number(globalNlpMode?.tokenizeTotalLines || 0)),
                )}
                {" · "}
                {t("copaw.projects.knowledge.processing.tokenizeRunningDocs", "Running docs")}: {tokenizeRunningDocuments.length}
              </Typography.Text>
            </div>
            <div className={styles.projectKnowledgeHistoryList}>
              {tokenizeDocumentsProgress.length === 0 ? (
                <div className={styles.projectKnowledgeHistoryItem}>
                  <Typography.Text type="secondary">
                    {t("copaw.projects.knowledge.processing.tokenizeProgressEmpty", "No tokenize progress yet")}
                  </Typography.Text>
                </div>
              ) : tokenizeDocumentsProgress.map((item) => (
                <div key={`${item.sourceId}-${item.documentPath}`} className={styles.projectKnowledgeHistoryItem}>
                  <Typography.Text strong>{item.documentPath}</Typography.Text>
                  <Typography.Text type="secondary">
                    {item.status} · {formatDoneTotal(item.doneLines, item.totalLines)} · tokens {item.readyTokens}
                  </Typography.Text>
                </div>
              ))}
            </div>
          </div>
          {recentHistorySections.map((section) => (
            <div key={section.key} className={styles.projectKnowledgeHistoryStrip}>
              <div className={styles.projectKnowledgeHistoryHeader}>
                <Typography.Text strong>
                  {section.title}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {section.hint}
                </Typography.Text>
              </div>
              <div className={styles.projectKnowledgeHistoryList}>
                {section.items.map((item) => (
                  <div key={item.key} className={styles.projectKnowledgeHistoryItem}>
                    <Typography.Text strong>
                      {item.timestamp}
                    </Typography.Text>
                    <Typography.Text type="secondary">
                      {item.summary}
                    </Typography.Text>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className={styles.projectKnowledgeProcessingSection}>
          <div className={styles.projectKnowledgeLayerHeaderRow}>
            <Typography.Text strong>
              {t("copaw.projects.knowledge.processing.layerDimension")}
            </Typography.Text>
            <Select
              size="small"
              value={effectiveSourceId || undefined}
              options={sourceOptions}
              disabled={!sourceOptions.length}
              className={styles.projectKnowledgeProcessingScopeSourceSelect}
              placeholder={t("copaw.projects.knowledge.processing.sourceSelectPlaceholder", "Select source")}
              onChange={(value) => {
                props.knowledgeState.setSelectedSourceId(String(value || ""));
              }}
            />
          </div>
          <div className={styles.projectKnowledgeLayerMatrix}>
            <div className={styles.projectKnowledgeLayerMatrixHeader}>
              <Typography.Text strong>
                {t("copaw.projects.knowledge.processing.layerDimension")}
              </Typography.Text>
              <Typography.Text strong>
                {t("copaw.projects.knowledge.processing.layerL2Column")}
              </Typography.Text>
              <Typography.Text strong>
                {t("copaw.projects.knowledge.processing.layerL3Column")}
              </Typography.Text>
            </div>
            {layerRows.map((row) => (
              <div key={row.key} className={styles.projectKnowledgeLayerMatrixRow}>
                <div className={styles.projectKnowledgeLayerMatrixDimension}>
                  <Typography.Text strong>{row.title}</Typography.Text>
                  <Typography.Text type="secondary">{row.description}</Typography.Text>
                </div>
                {[row.l2, row.l3].map((cell, index) => (
                  <div key={`${row.key}-${index}`} className={styles.projectKnowledgeLayerMatrixCell}>
                    <div className={styles.projectKnowledgeModeMeta}>
                      <Tag color={nlpStageTagColor(cell.status)}>{nlpStageStatusLabel(cell.status, t)}</Tag>
                    </div>
                    <Typography.Text>{cell.summary}</Typography.Text>
                    <div className={styles.projectKnowledgeProcessingStageMetrics}>
                      {cell.metrics.map((metric) => (
                        <div key={`${row.key}-${index}-${metric.label}`} className={styles.projectKnowledgeProcessingStageMetric}>
                          <div className={styles.projectKnowledgeProcessingStageMetricMain}>
                            <Typography.Text type="secondary">{metric.label}</Typography.Text>
                            <Typography.Text strong>{metric.value}</Typography.Text>
                          </div>
                          {(() => {
                            const modeForCell: ProjectKnowledgeProcessingMode = index === 0 ? "nlp" : "agentic";
                            const evidenceBundle = metric.evidenceKey
                              ? ((modeForCell === "nlp" ? l2EvidenceBundles : l3EvidenceBundles)[metric.evidenceKey] || null)
                              : null;
                            const hasEvidence = Boolean(
                              metric.evidencePath
                              || (evidenceBundle?.sample_source_paths && evidenceBundle.sample_source_paths.length > 0)
                              || (evidenceBundle?.artifact_paths && evidenceBundle.artifact_paths.length > 0),
                            );
                            return (
                              <Button
                                type="link"
                                size="small"
                                disabled={!hasEvidence}
                                style={{ paddingInline: 0, height: "auto" }}
                                onClick={() => {
                                  if (!metric.evidenceKey || !hasEvidence) {
                                    return;
                                  }
                                  setActiveEvidence({
                                    mode: modeForCell,
                                    scope: "source",
                                    sourceId: effectiveSourceId || undefined,
                                    sourceLabel: effectiveSourceLabel || undefined,
                                    metricLabel: metric.label,
                                    metricValue: metric.value,
                                    metricKey: metric.evidenceKey,
                                    summary: cell.summary,
                                    bundle: evidenceBundle,
                                    fallbackPath: metric.evidencePath || "",
                                  });
                                }}
                              >
                                {t("copaw.projects.knowledge.processing.viewBasis")}
                              </Button>
                            );
                          })()}
                        </div>
                      ))}
                    </div>
                    {cell.reason ? (
                      <Typography.Text type="secondary">
                        {t("copaw.projects.knowledge.processing.stageReason")}: {cell.reason}
                      </Typography.Text>
                    ) : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

      </div>

      <Modal
        title={t("copaw.projects.knowledge.processing.evidenceDetailTitle")}
        open={Boolean(activeEvidence)}
        onCancel={() => setActiveEvidence(null)}
        footer={null}
        width={1080}
      >
        {activeEvidence ? (
          <div className={styles.projectKnowledgeEvidenceDetail}>
            <Typography.Text strong>{activeEvidence.metricLabel}</Typography.Text>
            <Typography.Text type="secondary">
              {t("copaw.projects.knowledge.processing.evidenceMetricValue")}: {activeEvidence.metricValue}
            </Typography.Text>
            {activeEvidence.scope === "source" && activeEvidence.sourceLabel ? (
              <Typography.Text type="secondary">
                {t("copaw.projects.knowledge.processing.evidenceScopeSource", "Source scope: {{source}}", { source: activeEvidence.sourceLabel })}
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary">
                {t("copaw.projects.knowledge.processing.evidenceScopeGlobal", "Project scope aggregate")}
              </Typography.Text>
            )}
            <Typography.Text type="secondary">{activeEvidence.summary}</Typography.Text>
            <Typography.Text>
              {t("copaw.projects.knowledge.processing.evidenceAggregationHint")}
            </Typography.Text>

            <div className={styles.projectKnowledgeEvidenceSection}>
              <Typography.Text strong>
                {t("copaw.projects.knowledge.processing.evidenceFormula")}
              </Typography.Text>
              <Typography.Text type="secondary">
                {activeEvidence.bundle?.formula
                  || t("copaw.projects.knowledge.processing.evidenceFormulaFallback")}
              </Typography.Text>
            </div>

            <div className={styles.projectKnowledgeEvidenceSection}>
              <Typography.Text strong>
                {t("copaw.projects.knowledge.processing.evidenceSampleFiles")}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t("copaw.projects.knowledge.processing.evidenceSourceCount")}: {activeEvidence.bundle?.source_count || evidencePathsForModal.length || 0}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t("copaw.projects.knowledge.processing.evidenceSampleCoverage", "Sample coverage")}: {evidenceSampleCoverage}
              </Typography.Text>
              <div className={styles.projectKnowledgeEvidencePaths}>
                {evidencePathsForModal.length ? evidencePathsForModal.map((pathText) => (
                  <div key={pathText} className={styles.projectKnowledgeEvidencePathRow}>
                    <Typography.Text ellipsis={{ tooltip: pathText }}>{pathText}</Typography.Text>
                    <Button
                      size="small"
                      disabled={!props.onSelectArtifactPath}
                      onClick={() => {
                        if (!props.onSelectArtifactPath) {
                          return;
                        }
                        void props.onSelectArtifactPath(pathText);
                      }}
                    >
                      {t("copaw.projects.knowledge.processing.evidenceLocateFile")}
                    </Button>
                  </div>
                )) : (
                  <Typography.Text type="secondary">
                    {t("copaw.projects.knowledge.processing.evidenceNone")}
                  </Typography.Text>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}