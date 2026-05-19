import { Button, Modal, Tag, Tooltip, Typography } from "antd";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";
import { buildProjectKnowledgeProcessingRecentHistorySectionsFromState } from "./projectKnowledgeRecentHistoryModel";
import {
} from "./projectKnowledgeL1StatsUi";
import type {
  ProjectKnowledgeProcessingFreshness,
  ProjectKnowledgeModeState,
  ProjectKnowledgeState,
} from "./useProjectKnowledgeState";
import type {
  ProjectKnowledgeMetricEvidenceBundlePayload,
  ProjectKnowledgeModeMetricsPayload,
  ProjectKnowledgeProcessingMode,
} from "../../../api/types";

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
  onOpenSettings?: () => void;
  onSelectArtifactPath?: (path: string) => void | Promise<void>;
  focusedMode?: ProjectKnowledgeModeState["mode"];
  focusedStage?: ProjectKnowledgeNlpStageKey;
  focusToken?: number;
}

function modeHasIndependentOutputs(mode: ProjectKnowledgeModeState | null): boolean {
  if (!mode) {
    return false;
  }
  return mode.available || mode.entityCount > 0 || mode.relationCount > 0 || mode.qualityScore != null;
}

function displayEntityCount(mode: ProjectKnowledgeModeState | null): number {
  if (!mode) {
    return 0;
  }
  if (mode.mode === "nlp") {
    return Math.max(0, Number(mode.nerEntityCount || mode.entityCount || 0));
  }
  return Math.max(0, Number(mode.entityCount || 0));
}

function formatEntityValue(
  mode: ProjectKnowledgeModeState | null,
  t: ReturnType<typeof useTranslation>["t"],
): string | number {
  if (!mode) {
    return 0;
  }
  const value = displayEntityCount(mode);
  if (mode.mode !== "nlp") {
    return value;
  }
  if (value > 0) {
    return value;
  }
  if (mode.status === "running" || mode.status === "queued") {
    return t("copaw.projects.knowledge.processing.metricPending");
  }
  const readyCount = Math.max(0, Number(mode.nerReadyChunkCount || 0));
  if (readyCount <= 0) {
    return t("copaw.projects.knowledge.processing.metricUnavailable");
  }
  return value;
}

function displayRelationCount(mode: ProjectKnowledgeModeState | null): number {
  if (!mode) {
    return 0;
  }
  if (mode.mode === "nlp") {
    return Math.max(0, Number(mode.syntaxRelationCount || mode.relationCount || 0));
  }
  return Math.max(0, Number(mode.relationCount || 0));
}

function describeStaleSources(
  freshness: ProjectKnowledgeProcessingFreshness,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (freshness.staleSources.length === 0) {
    return t("copaw.projects.knowledge.processing.staleHint");
  }

  const sourceLabels = freshness.staleSources.map((source) => (
    source === "project-sync"
      ? t("copaw.projects.knowledge.processing.channelProjectSync")
      : t("copaw.projects.knowledge.processing.channelTasks")
  ));
  const sourceSummary = sourceLabels.length > 1
    ? sourceLabels.join(" / ")
    : sourceLabels[0];
  const primaryStatus = freshness.channelStatus[freshness.staleSources[0]];
  const statusLabel = primaryStatus === "connecting"
    ? t("copaw.projects.knowledge.processing.channelConnecting")
    : t("copaw.projects.knowledge.processing.channelReconnecting");

  return `${sourceSummary}${statusLabel}，${t("copaw.projects.knowledge.processing.staleHintSuffix")}`;
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`;
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
    l3Mode: ProjectKnowledgeModeState | null;
    l2EvidencePaths: Record<string, string>;
    l3EvidencePaths: Record<string, string>;
    quantMetrics: ProjectKnowledgeState["quantMetrics"];
    entityDelta: number;
    relationDelta: number;
    t: ReturnType<typeof useTranslation>["t"];
  },
): ProjectKnowledgeLayerRow[] {
  const {
    nlpMode,
    l3Mode,
    l2EvidencePaths,
    l3EvidencePaths,
    quantMetrics,
    entityDelta,
    relationDelta,
    t,
  } = params;
  const hasL3Outputs = modeHasIndependentOutputs(l3Mode);
  const l3Running = l3Mode?.status === "running" || l3Mode?.status === "queued";
  const l3Ready = Boolean(l3Mode && hasL3Outputs && l3Mode.status === "ready");
  const l2DocumentCount = Math.max(0, Number(nlpMode?.documentCount || 0));
  const l2TokenCount = Math.max(0, Number(nlpMode?.syntaxTokenCount || quantMetrics.tokenCount || 0));
  const l2PosCount = Math.max(0, Number(nlpMode?.syntaxPosCount || 0));
  const l2PosCoverage = formatPercent(Number(nlpMode?.posCoverageOnDocumentTokens || 0));
  const l2SyntaxRelations = Math.max(0, Number(nlpMode?.syntaxRelationCount || 0));
  const l2SyntaxSentences = Math.max(0, Number(nlpMode?.syntaxSentenceCount || 0));
  const l2NerEntities = Math.max(0, Number(nlpMode?.nerEntityCount || 0));
  const l2NerReadyChunks = Math.max(0, Number(nlpMode?.nerReadyChunkCount || 0));
  const l3Quality = l3Mode?.qualityScore != null
    ? `${Math.round(Number(l3Mode.qualityScore) * 100)}%`
    : t("copaw.projects.knowledge.processing.metricPending");

  const buildL3Cell = (
    summaryKey: string,
    metrics: ProjectKnowledgeLayerCellMetric[],
    reason?: string,
  ): ProjectKnowledgeLayerCell => ({
    status: mapModeToLayerStatus(l3Mode, l3Ready, false),
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
        status: mapModeToLayerStatus(nlpMode, l2TokenCount > 0),
        summary: t("copaw.projects.knowledge.processing.layerDataPreprocessL2"),
        metrics: [
          {
            label: t("copaw.projects.knowledge.documents"),
            value: l2DocumentCount,
            evidenceKey: "document_count",
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "document_count"),
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
        status: mapModeToLayerStatus(l3Mode, false, true),
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
        status: mapModeToLayerStatus(l3Mode, l3Ready),
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
            value: l3Mode?.auditRound
              ? `#${l3Mode.auditRound}`
              : l3Mode?.runId || t("copaw.projects.knowledge.processing.metricUnavailable"),
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
  const hasStaleProcessing = props.knowledgeState.processingFreshness.stale;
  const nlpMode = visibleModes.find((mode) => mode.mode === "nlp") || null;
  const l3Mode = visibleModes.find((mode) => mode.mode === "agentic") || null;
  const modeMetricsPayload = (props.knowledgeState.syncState?.mode_metrics || {}) as Partial<Record<string, ProjectKnowledgeModeMetricsPayload>>;
  const l2EvidencePaths = (modeMetricsPayload.nlp?.evidence_paths || {}) as Record<string, string>;
  const l3EvidencePaths = (modeMetricsPayload.agentic?.evidence_paths || {}) as Record<string, string>;
  const l2EvidenceBundles = useMemo(
    () => (modeMetricsPayload.nlp?.evidence_bundles || {}) as Record<string, ProjectKnowledgeMetricEvidenceBundlePayload>,
    [modeMetricsPayload.nlp?.evidence_bundles],
  );
  const l3EvidenceBundles = useMemo(
    () => (modeMetricsPayload.agentic?.evidence_bundles || {}) as Record<string, ProjectKnowledgeMetricEvidenceBundlePayload>,
    [modeMetricsPayload.agentic?.evidence_bundles],
  );
  const { entityDelta, relationDelta } = props.knowledgeState.processingCompareDelta;
  const staleTooltip = describeStaleSources(props.knowledgeState.processingFreshness, t);
  const recentHistorySections = useMemo(
    () => buildProjectKnowledgeProcessingRecentHistorySectionsFromState(t, props.knowledgeState),
    [
      props.knowledgeState.fileAnalysisStats?.history,
      props.knowledgeState.projectStepStats.build_interlinear?.history,
      props.knowledgeState.projectStepStats.tokenize?.history,
      props.knowledgeState.projectStepStats.pos_tagging?.history,
      props.knowledgeState.projectStepStats.syntax_parse?.history,
      props.knowledgeState.projectStepStats.semantic_role_labeling?.history,
      props.knowledgeState.sourceScanStats?.history,
      t,
    ],
  );
  const evidencePathsForModal = useMemo(() => {
    const merged: string[] = [];
    const samplePaths = activeEvidence?.bundle?.sample_source_paths || [];
    const artifactPaths = activeEvidence?.bundle?.artifact_paths || [];
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
  const layerRows = buildKnowledgeLayerRows({
    nlpMode,
    l3Mode,
    l2EvidencePaths,
    l3EvidencePaths,
    quantMetrics: props.knowledgeState.quantMetrics,
    entityDelta,
    relationDelta,
    t,
  });

  return (
    <div className={`${styles.projectKnowledgeWorkbench} ${styles.projectKnowledgeProcessingWorkbench}`}>
      <div className={styles.projectKnowledgeProcessingScrollBody}>
        <div className={styles.projectKnowledgeProcessingStickySummary}>
          <div className={styles.projectKnowledgeSignalGrid}>
            <div className={styles.projectKnowledgeSignalCard}>
              <Typography.Text type="secondary">{t("copaw.projects.knowledge.processing.l2Entities")}</Typography.Text>
              <Typography.Text strong>{formatEntityValue(nlpMode, t)}</Typography.Text>
            </div>
            <div className={styles.projectKnowledgeSignalCard}>
              <Typography.Text type="secondary">{t("copaw.projects.knowledge.processing.l2Relations")}</Typography.Text>
              <Typography.Text strong>{displayRelationCount(nlpMode)}</Typography.Text>
            </div>
            <div className={styles.projectKnowledgeSignalCard}>
              <Typography.Text type="secondary">{t("copaw.projects.knowledge.processing.l3Entities")}</Typography.Text>
              <Typography.Text strong>
                {l3Mode && !modeHasIndependentOutputs(l3Mode)
                  ? t("copaw.projects.knowledge.processing.outputPending")
                  : (l3Mode?.entityCount || 0)}
              </Typography.Text>
            </div>
            <div className={styles.projectKnowledgeSignalCard}>
              <Typography.Text type="secondary">{t("copaw.projects.knowledge.processing.l3Relations")}</Typography.Text>
              <Typography.Text strong>
                {l3Mode && !modeHasIndependentOutputs(l3Mode)
                  ? t("copaw.projects.knowledge.processing.outputPending")
                  : (l3Mode?.relationCount || 0)}
              </Typography.Text>
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

      <Modal
        title={t("copaw.projects.knowledge.processing.evidenceDetailTitle")}
        open={Boolean(activeEvidence)}
        onCancel={() => setActiveEvidence(null)}
        footer={null}
        width={680}
      >
        {activeEvidence ? (
          <div className={styles.projectKnowledgeEvidenceDetail}>
            <Typography.Text strong>{activeEvidence.metricLabel}</Typography.Text>
            <Typography.Text type="secondary">
              {t("copaw.projects.knowledge.processing.evidenceMetricValue")}: {activeEvidence.metricValue}
            </Typography.Text>
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