import type { ReactNode } from "react";
import { Alert, Button, Select, Space, Tag, Tooltip, Typography } from "antd";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";
import { getProjectKnowledgeSemanticReasonLabel } from "./projectKnowledgeSyncUi";
import type {
  ProjectKnowledgeHeaderSignals,
  ProjectKnowledgeState,
} from "./useProjectKnowledgeState";

interface QualityLoopSummary {
  jobStatus: string;
  roundNo: number | null;
  scoreAfter: number | null;
  delta: number | null;
  stopReason: string;
  gateStatus: string;
  gateReason: string;
  gateSummary: string;
  nextPlan: string[];
  hypotheses: string[];
  updatedAt: string;
  tone: "warning" | "success" | "error" | "default" | "processing";
}

interface ProjectKnowledgeSignalsPanelProps {
  knowledgeState: ProjectKnowledgeState;
  knowledgeHeaderSignals: ProjectKnowledgeHeaderSignals;
  runtimeSignalValue: string;
  runtimeSignalTooltipContent: ReactNode;
  runtimeSignalTooltipOpen: boolean;
  onRuntimeSignalTooltipOpenChange?: (open: boolean) => void;
  latestQualityLoopSummary?: QualityLoopSummary | null;
  onOpenSettings?: () => void;
  onRunSuggestedQuery?: (query: string) => void;
}

function formatMetricsSourceLabel(source: string, t: ReturnType<typeof useTranslation>["t"]): string {
  const normalized = String(source || "").trim();
  if (!normalized) {
    return t("projects.knowledge.metricsSourceUnknown", "unknown");
  }
  if (normalized === "project_sync_merged") {
    return t("projects.knowledge.metricsSourceProjectSyncMerged", "Backend merged sync metrics");
  }
  if (normalized === "source_status") {
    return t("projects.knowledge.metricsSourceSourceStatus", "Source status metrics");
  }
  if (normalized === "index_result") {
    return t("projects.knowledge.metricsSourceIndexResult", "Index result metrics");
  }
  return normalized;
}

function formatLocalDateTime(value: string): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    return normalized;
  }
  return new Date(timestamp).toLocaleString();
}

export default function ProjectKnowledgeSignalsPanel(
  props: ProjectKnowledgeSignalsPanelProps,
) {
  const { t } = useTranslation();
  const {
    knowledgeState,
    knowledgeHeaderSignals,
    runtimeSignalValue,
    runtimeSignalTooltipContent,
    runtimeSignalTooltipOpen,
    onRuntimeSignalTooltipOpenChange,
    latestQualityLoopSummary,
  } = props;
  const semanticEngine = knowledgeState.syncState?.semantic_engine;
  const syncOperationId = String(knowledgeState.syncState?.operation_id || "").trim();
  const syncIdempotencyKey = String(knowledgeState.syncState?.idempotency_key || "").trim();
  const syncLastAction = String(knowledgeState.syncState?.last_action || "").trim();
  const syncDeduplicated = knowledgeState.syncState?.deduplicated === true;
  const syncOperationUpdatedAt = formatLocalDateTime(
    String(knowledgeState.syncState?.operation_updated_at || "").trim(),
  );
  const semanticReasonLabel = getProjectKnowledgeSemanticReasonLabel(semanticEngine, t);
  const metricsSourceLabel = formatMetricsSourceLabel(knowledgeState.quantMetricsMeta?.source || "", t);
  const metricsUpdatedAtLabel = formatLocalDateTime(knowledgeState.quantMetricsMeta?.updatedAt || "");

  return (
    <div className={styles.projectKnowledgeWorkbench}>
      <div className={styles.projectKnowledgeTabHeader}>
        <div>
          <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
            {t("projects.knowledgeDock.tabHealth", "Health")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t(knowledgeState.insightMessageKey)}
          </Typography.Text>
          {knowledgeState.quantMetricsMeta ? (
            <Typography.Text type="secondary">
              {t("projects.knowledge.metricsSourceLabel", "Metrics Source")}: {metricsSourceLabel}
              {metricsUpdatedAtLabel
                ? ` · ${t("projects.knowledge.metricsUpdatedAt", "Updated")}: ${metricsUpdatedAtLabel}`
                : ""}
            </Typography.Text>
          ) : null}
        </div>
        <div className={styles.projectKnowledgeTabActions}>
          {knowledgeState.insightAction === "settings" ? (
            <Button size="small" type="primary" onClick={props.onOpenSettings}>
              {t("projects.knowledge.actionOpenSettings", "Open settings")}
            </Button>
          ) : null}
          {knowledgeState.insightAction === "query" ? (
            <Button
              size="small"
              type="primary"
              onClick={() => props.onRunSuggestedQuery?.(knowledgeState.suggestedQuery)}
            >
              {t("projects.knowledge.actionRunSuggestedQuery")}
            </Button>
          ) : null}
          <Button size="small" onClick={() => void knowledgeState.loadProjectSourceStatus()}>
            {t("projects.knowledge.actionRefreshSignals")}
          </Button>
        </div>
      </div>

      <div className={styles.knowledgeModuleHeaderSignals}>
        <Tooltip
          title={runtimeSignalTooltipContent}
          trigger="hover"
          open={runtimeSignalTooltipOpen}
          onOpenChange={(open) => {
            onRuntimeSignalTooltipOpenChange?.(open);
          }}
          classNames={{ root: styles.knowledgeRuntimeTooltipOverlay }}
        >
          <div
            className={`${styles.knowledgeModuleHeaderSignal} ${knowledgeState.activeKnowledgeTask ? styles.knowledgeModuleHeaderSignalActive : ""}`}
          >
            <Typography.Text type="secondary">{t("projects.knowledge.signalRuntimeStatus", "Runtime")}</Typography.Text>
            <Typography.Text strong>{runtimeSignalValue}</Typography.Text>
          </div>
        </Tooltip>
        <div className={styles.knowledgeModuleHeaderSignal}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalIndexedCoverage")}</Typography.Text>
          <Typography.Text strong>{`${Math.round(knowledgeHeaderSignals.indexedRatio * 100)}%`}</Typography.Text>
        </div>
        <div className={styles.knowledgeModuleHeaderSignal}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalDocuments")}</Typography.Text>
          <Typography.Text strong>{String(knowledgeHeaderSignals.documentCount)}</Typography.Text>
        </div>
        <div className={styles.knowledgeModuleHeaderSignal}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalChunks")}</Typography.Text>
          <Typography.Text strong>{String(knowledgeHeaderSignals.chunkCount)}</Typography.Text>
        </div>
        <div className={styles.knowledgeModuleHeaderSignal}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalSentences", "Sentences")}</Typography.Text>
          <Typography.Text strong>{String(knowledgeHeaderSignals.sentenceCount)}</Typography.Text>
        </div>
        <div className={styles.knowledgeModuleHeaderSignal}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalEntityMentions", "Entity Mentions")}</Typography.Text>
          <Typography.Text strong>{String(knowledgeHeaderSignals.entityMentionsCount)}</Typography.Text>
        </div>
        <div className={styles.knowledgeModuleHeaderSignal}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalAvgEntitiesPerSentence", "Entities/Sentence")}</Typography.Text>
          <Typography.Text strong>{knowledgeHeaderSignals.avgEntitiesPerSentence.toFixed(2)}</Typography.Text>
        </div>
        <div className={styles.knowledgeModuleHeaderSignal}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalEntityCharRatio", "Entity Char Ratio")}</Typography.Text>
          <Typography.Text strong>{`${Math.round(knowledgeHeaderSignals.avgEntityCharRatio * 100)}%`}</Typography.Text>
        </div>
        <div className={styles.knowledgeModuleHeaderSignal}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalRelations")}</Typography.Text>
          <Typography.Text strong>{String(knowledgeHeaderSignals.relationCount)}</Typography.Text>
        </div>
        <div className={styles.knowledgeModuleHeaderSignal}>
          <Typography.Text type="secondary">{t("projects.knowledge.entities", "实体数")}</Typography.Text>
          <Typography.Text strong>{String(knowledgeHeaderSignals.entityCount)}</Typography.Text>
        </div>
        <div className={styles.knowledgeModuleHeaderSignal}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalQualityScore", "Quality Score")}</Typography.Text>
          <Typography.Text strong>{`${Math.round(knowledgeHeaderSignals.qualityAssessmentScore * 100)}`}</Typography.Text>
        </div>
        {semanticEngine ? (
          <div className={styles.knowledgeModuleHeaderSignal}>
            <Typography.Text type="secondary">
              {t("projects.knowledge.semanticEngineStatus", "Semantic Engine")}
            </Typography.Text>
            <Typography.Text strong>{semanticReasonLabel}</Typography.Text>
          </div>
        ) : null}
        {syncOperationId || syncIdempotencyKey ? (
          <div className={styles.knowledgeModuleHeaderSignal}>
            <Typography.Text type="secondary">
              {t("projects.knowledge.syncTrace", "Sync Trace")}
            </Typography.Text>
            <Typography.Text strong>
              {syncOperationId || "-"}
            </Typography.Text>
            <Typography.Text type="secondary">
              {t("projects.knowledge.syncIdempotencyShort", "Key")}: {syncIdempotencyKey || "-"}
            </Typography.Text>
            <Typography.Text type="secondary">
              {t("projects.knowledge.syncDeduplicated", "Deduplicated")}: {syncDeduplicated ? t("common.yes", "Yes") : t("common.no", "No")}
              {syncLastAction
                ? ` · ${t("projects.knowledge.syncLastAction", "Action")}: ${syncLastAction}`
                : ""}
            </Typography.Text>
            {syncOperationUpdatedAt ? (
              <Typography.Text type="secondary">
                {t("projects.knowledge.syncOperationUpdatedAt", "Updated")}: {syncOperationUpdatedAt}
              </Typography.Text>
            ) : null}
          </div>
        ) : null}
        <div className={styles.knowledgeModuleHeaderSignal}>
          <Typography.Text type="secondary">{t("knowledge.quantRelationNormalizationCoverage")}</Typography.Text>
          <Typography.Text strong>
            {`${Math.round(knowledgeHeaderSignals.relationNormalizationCoverage * 100)}% / >=${Math.round(knowledgeHeaderSignals.relationNormalizationThreshold * 100)}%`}
          </Typography.Text>
        </div>
        <div className={styles.knowledgeModuleHeaderSignal}>
          <Typography.Text type="secondary">{t("knowledge.quantEntityCanonicalCoverage")}</Typography.Text>
          <Typography.Text strong>
            {`${Math.round(knowledgeHeaderSignals.entityCanonicalCoverage * 100)}% / >=${Math.round(knowledgeHeaderSignals.entityCanonicalThreshold * 100)}%`}
          </Typography.Text>
        </div>
        <div className={styles.knowledgeModuleHeaderSignal}>
          <Typography.Text type="secondary">{t("knowledge.quantLowConfidenceRatio")}</Typography.Text>
          <Typography.Text strong>
            {`${Math.round(knowledgeHeaderSignals.lowConfidenceRatio * 100)}% / <=${Math.round(knowledgeHeaderSignals.lowConfidenceThreshold * 100)}%`}
          </Typography.Text>
        </div>
        <div className={styles.knowledgeModuleHeaderSignal}>
          <Typography.Text type="secondary">{t("knowledge.quantMissingEvidenceRatio")}</Typography.Text>
          <Typography.Text strong>
            {`${Math.round(knowledgeHeaderSignals.missingEvidenceRatio * 100)}% / <=${Math.round(knowledgeHeaderSignals.missingEvidenceThreshold * 100)}%`}
          </Typography.Text>
        </div>
      </div>

      {latestQualityLoopSummary ? (
        <div
          className={[
            styles.knowledgeLoopSummary,
            latestQualityLoopSummary.tone === "warning"
              ? styles.knowledgeLoopSummaryWarning
              : "",
            latestQualityLoopSummary.tone === "success"
              ? styles.knowledgeLoopSummarySuccess
              : "",
            latestQualityLoopSummary.tone === "error"
              ? styles.knowledgeLoopSummaryError
              : "",
          ].filter(Boolean).join(" ")}
        >
          <div className={styles.knowledgeLoopSummaryHeaderRow}>
            <Typography.Text strong>
              {t("projects.knowledge.latestQualityLoop", "Latest Quality Loop")}
            </Typography.Text>
            <div className={styles.knowledgeLoopSummaryTags}>
              <Tag color={latestQualityLoopSummary.tone}>
                {latestQualityLoopSummary.jobStatus || t("projects.statusUnknown", "unknown")}
              </Tag>
              {latestQualityLoopSummary.roundNo ? (
                <Tag>{t("projects.knowledge.roundLabel", "Round")} {latestQualityLoopSummary.roundNo}</Tag>
              ) : null}
              {latestQualityLoopSummary.stopReason ? (
                <Tag color={latestQualityLoopSummary.tone}>
                  {latestQualityLoopSummary.stopReason}
                </Tag>
              ) : null}
              {latestQualityLoopSummary.gateStatus ? (
                <Tag color={latestQualityLoopSummary.gateStatus === "accepted" ? "success" : "warning"}>
                  {t("projects.knowledge.agentGate", "agent gate: {{status}}", {
                    status: latestQualityLoopSummary.gateStatus,
                  })}
                </Tag>
              ) : null}
            </div>
          </div>
          <div className={styles.knowledgeLoopSummaryMetaRow}>
            {latestQualityLoopSummary.scoreAfter !== null ? (
              <Typography.Text type="secondary">
                {t("projects.knowledge.signalQualityScore", "Quality Score")}: {Math.round(latestQualityLoopSummary.scoreAfter * 100)}
              </Typography.Text>
            ) : null}
            {latestQualityLoopSummary.delta !== null ? (
              <Typography.Text type="secondary">
                {t("projects.knowledge.runtimeStatusScoreDelta", "Score delta")}: {latestQualityLoopSummary.delta >= 0 ? "+" : ""}{Math.round(latestQualityLoopSummary.delta * 100)}
              </Typography.Text>
            ) : null}
            {latestQualityLoopSummary.updatedAt ? (
              <Typography.Text type="secondary">
                {t("projects.knowledge.runtimeStatusUpdatedAt", "Updated")}: {latestQualityLoopSummary.updatedAt}
              </Typography.Text>
            ) : null}
          </div>
          {latestQualityLoopSummary.gateSummary ? (
            <Typography.Text>
              {latestQualityLoopSummary.gateSummary}
            </Typography.Text>
          ) : latestQualityLoopSummary.gateReason ? (
            <Typography.Text>
              {latestQualityLoopSummary.gateReason}
            </Typography.Text>
          ) : null}
          {latestQualityLoopSummary.hypotheses.length ? (
            <Typography.Text type="secondary">
              {t("projects.knowledge.qualityLoopHypotheses", "Issues")}: {latestQualityLoopSummary.hypotheses.join(", ")}
            </Typography.Text>
          ) : null}
          {latestQualityLoopSummary.nextPlan.length ? (
            <Typography.Text type="secondary">
              {t("projects.knowledge.qualityLoopNextPlan", "Next plan")}: {latestQualityLoopSummary.nextPlan.join(", ")}
            </Typography.Text>
          ) : null}
        </div>
      ) : null}

      <div className={styles.projectKnowledgeSignalGrid}>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalDocuments")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.documentCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalChunks")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.chunkCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalSentences", "Sentences")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.sentenceCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalEntityMentions", "Entity Mentions")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.entityMentionsCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalAvgEntitiesPerSentence", "Entities/Sentence")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.avgEntitiesPerSentence.toFixed(2)}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalEntityCharRatio", "Entity Char Ratio")}</Typography.Text>
          <Typography.Text strong>{`${Math.round(knowledgeState.quantMetrics.avgEntityCharRatio * 100)}%`}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalCoverage", "Coverage")}</Typography.Text>
          <Typography.Text strong>
            {Math.round(knowledgeState.quantMetrics.indexedRatio * 100)}%
          </Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalRelations")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.relationCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.entities", "实体数")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.entityCount}</Typography.Text>
        </div>
      </div>

      {knowledgeState.syncState
        && (
          knowledgeState.syncState.status !== "idle"
          || Boolean(knowledgeState.syncState.last_error)
          || Boolean(knowledgeState.syncState.last_finished_at)
        ) ? (
          <Alert
            type={knowledgeState.syncAlertType}
            showIcon
            message={t("projects.knowledge.sinkJob", "Knowledge Sync")}
            description={knowledgeState.syncAlertDescription}
          />
        ) : null}

      <div className={styles.projectKnowledgeTrendSection}>
        <div className={styles.projectKnowledgeTrendHeader}>
          <Typography.Text strong>
            {t("projects.knowledge.signalsTitle")}
          </Typography.Text>
          <Space size={6} wrap>
            <Select
              size="small"
              value={knowledgeState.trendRangeDays}
              classNames={{ popup: { root: styles.projectKnowledgeSelectDropdown } }}
              options={[
                { value: 7, label: t("projects.knowledge.trendRange7d") },
                { value: 30, label: t("projects.knowledge.trendRange30d") },
              ]}
              onChange={(value) => knowledgeState.setTrendRangeDays(value as 7 | 30)}
              style={{ width: 96 }}
            />
            <Button
              size="small"
              type="text"
              onClick={() => knowledgeState.setTrendExpanded((prev) => !prev)}
            >
              {knowledgeState.trendExpanded
                ? t("common.collapse", "Collapse")
                : t("common.expand", "Expand")}
            </Button>
          </Space>
        </div>

        {knowledgeState.trendExpanded && knowledgeState.filteredTrendSnapshots.length > 1 ? (
          <div className={styles.projectKnowledgeTrendChart}>
            <svg viewBox="0 0 300 70" preserveAspectRatio="none">
              <path d={knowledgeState.trendDocumentPath} fill="none" stroke="#1677ff" strokeWidth="2" />
              <path d={knowledgeState.trendChunkPath} fill="none" stroke="#13c2c2" strokeWidth="2" />
            </svg>
            <div className={styles.projectKnowledgeTrendLegend}>
              <span>{t("projects.knowledge.signalDocuments")}</span>
              <span>{t("projects.knowledge.signalChunks")}</span>
            </div>
          </div>
        ) : knowledgeState.trendExpanded ? (
          <Typography.Text type="secondary">
            {t("projects.knowledge.trendNotEnough")}
          </Typography.Text>
        ) : null}

        <div className={styles.projectKnowledgeTrendDeltaRow}>
          <Typography.Text type="secondary">
            {t("projects.knowledge.signalDocuments")}: {t("projects.knowledge.signalDelta", { value: knowledgeState.trendDelta.documentDelta })}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t("projects.knowledge.signalChunks")}: {t("projects.knowledge.signalDelta", { value: knowledgeState.trendDelta.chunkDelta })}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t("projects.knowledge.signalRelations")}: {t("projects.knowledge.signalDelta", { value: knowledgeState.trendDelta.relationDelta })}
          </Typography.Text>
        </div>
      </div>
    </div>
  );
}
