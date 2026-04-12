import type {
  KnowledgeHistoryBackfillStatus,
  KnowledgeSearchHit,
  KnowledgeSourceItem,
  KnowledgeTaskProgress,
} from "../../../api/types";

export interface KnowledgeQuantMetrics {
  totalSources: number;
  indexedSources: number;
  indexedRatio: number;
  totalDocuments: number;
  totalChunks: number;
  totalEntities: number;
  totalRelations: number;
  relationNormalizationCoverage: number;
  entityCanonicalCoverage: number;
  lowConfidenceRatio: number;
  missingEvidenceRatio: number;
  pendingHistorySessions: number;
  searchHits: number;
}

export type QuantTone = "neutral" | "positive" | "warning";

export type KnowledgeQuantMetricKey =
  | "indexed"
  | "documents"
  | "chunks"
  | "entities"
  | "relations"
  | "relationNormCoverage"
  | "entityNormCoverage"
  | "lowConfidenceRatio"
  | "missingEvidenceRatio";

export interface QuantAssessment {
  tone: QuantTone;
  status: "healthy" | "attention" | "neutral";
}

export interface QuantStatusLabel {
  i18nKey: string;
  defaultLabel: string;
}

export type KnowledgeQuantActionKey =
  | "addSource"
  | "rebuildIndex"
  | "backfillHistory"
  | "retryRemote";

export interface KnowledgeQuantActionDescriptor {
  key: KnowledgeQuantActionKey;
  labelI18nKey: string;
  defaultLabel: string;
}

export interface KnowledgeQuantCardModel {
  key: KnowledgeQuantMetricKey;
  labelI18nKey: string;
  defaultLabel: string;
  value: string | number;
  assessment: QuantAssessment;
  reason: QuantReason;
  actionKey?: KnowledgeQuantActionKey;
}

export interface QuantReason {
  key:
    | "indexedCoverageLow"
    | "indexedCoverageHealthy"
    | "pendingHistoryExists"
    | "pendingHistoryClear"
    | "emptyState"
    | "activityPresent"
    | "noActivity"
    | "qualityCoverageHealthy"
    | "qualityCoverageLow"
    | "riskRatioHealthy"
    | "riskRatioHigh";
  params?: Record<string, number | string>;
  defaultLabel?: string;
}

export interface RemoteRetrySource {
  id: string;
  name: string;
}

export interface RemoteRetrySummary {
  successCount: number;
  failedCount: number;
  failedNames: string[];
}

function pickLatestMemifyTask(tasks: KnowledgeTaskProgress[]): KnowledgeTaskProgress | null {
  const memifyJobs = tasks
    .filter((task) => String(task.task_type || "") === "memify")
    .sort((left, right) => String(right.updated_at || "").localeCompare(String(left.updated_at || "")));
  return memifyJobs[0] || null;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, numerator / denominator));
}

function ratioToPercent(ratio: number): string {
  return `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
}

export function computeKnowledgeQuantMetrics(
  sources: KnowledgeSourceItem[],
  hits: KnowledgeSearchHit[],
  backfillStatus: KnowledgeHistoryBackfillStatus | null,
  tasks: KnowledgeTaskProgress[] = [],
): KnowledgeQuantMetrics {
  const totalSources = sources.length;
  const indexedSources = sources.filter((source) => source.status.indexed).length;
  const indexedRatio = totalSources > 0 ? indexedSources / totalSources : 0;
  const sourceDocuments = sources.reduce(
    (sum, source) => sum + Math.max(0, source.status.document_count || 0),
    0,
  );
  const sourceChunks = sources.reduce(
    (sum, source) => sum + Math.max(0, source.status.chunk_count || 0),
    0,
  );

  const latestMemifyTask = pickLatestMemifyTask(tasks);
  const enrichmentMetrics = (latestMemifyTask?.enrichment_metrics || {}) as Record<string, unknown>;
  const memifyDocumentCount = toFiniteNumber(latestMemifyTask?.document_count, 0);
  const memifyEntityCount = toFiniteNumber(latestMemifyTask?.node_count, 0);
  const memifyRelationCount = toFiniteNumber(latestMemifyTask?.relation_count, 0);

  const totalDocuments = Math.max(sourceDocuments, memifyDocumentCount);
  const totalChunks = sourceChunks;
  const totalEntities = memifyEntityCount;
  const totalRelations = memifyRelationCount;

  const edgeCount = toFiniteNumber(enrichmentMetrics.edge_count, totalRelations);
  const nodeCount = toFiniteNumber(enrichmentMetrics.node_count, totalEntities);
  const relationNormalizedCount = toFiniteNumber(
    enrichmentMetrics.relation_normalized_count,
    0,
  );
  const entityCanonicalizedCount = toFiniteNumber(
    enrichmentMetrics.entity_canonicalized_count,
    0,
  );
  const lowConfidenceEdges = toFiniteNumber(enrichmentMetrics.low_confidence_edges, 0);
  const missingEvidenceEdges = toFiniteNumber(enrichmentMetrics.missing_evidence_edges, 0);

  const relationNormalizationCoverage = safeRatio(relationNormalizedCount, edgeCount);
  const entityCanonicalCoverage = safeRatio(entityCanonicalizedCount, nodeCount);
  const lowConfidenceRatio = safeRatio(lowConfidenceEdges, edgeCount);
  const missingEvidenceRatio = safeRatio(missingEvidenceEdges, edgeCount);

  const pendingHistorySessions = backfillStatus?.has_pending_history
    ? Math.max(0, backfillStatus.history_chat_count || 0)
    : 0;

  return {
    totalSources,
    indexedSources,
    indexedRatio,
    totalDocuments,
    totalChunks,
    totalEntities,
    totalRelations,
    relationNormalizationCoverage,
    entityCanonicalCoverage,
    lowConfidenceRatio,
    missingEvidenceRatio,
    pendingHistorySessions,
    searchHits: hits.length,
  };
}

export function getKnowledgeQuantAssessment(
  key: KnowledgeQuantMetricKey,
  metrics: KnowledgeQuantMetrics,
): QuantAssessment {
  switch (key) {
    case "indexed":
      if (metrics.totalSources === 0) {
        return { tone: "neutral", status: "neutral" };
      }
      if (metrics.indexedRatio >= 0.9) {
        return { tone: "positive", status: "healthy" };
      }
      if (metrics.indexedRatio >= 0.6) {
        return { tone: "neutral", status: "neutral" };
      }
      return { tone: "warning", status: "attention" };
    case "documents":
      return metrics.totalDocuments > 0
        ? { tone: "positive", status: "healthy" }
        : { tone: "neutral", status: "neutral" };
    case "chunks":
      return metrics.totalChunks > 0
        ? { tone: "positive", status: "healthy" }
        : { tone: "neutral", status: "neutral" };
    case "entities":
      return metrics.totalEntities > 0
        ? { tone: "positive", status: "healthy" }
        : { tone: "neutral", status: "neutral" };
    case "relations":
      return metrics.totalRelations > 0
        ? { tone: "positive", status: "healthy" }
        : { tone: "neutral", status: "neutral" };
    case "relationNormCoverage":
      if (metrics.totalRelations <= 0) {
        return { tone: "neutral", status: "neutral" };
      }
      if (metrics.relationNormalizationCoverage >= 0.7) {
        return { tone: "positive", status: "healthy" };
      }
      if (metrics.relationNormalizationCoverage >= 0.4) {
        return { tone: "neutral", status: "neutral" };
      }
      return { tone: "warning", status: "attention" };
    case "entityNormCoverage":
      if (metrics.totalEntities <= 0) {
        return { tone: "neutral", status: "neutral" };
      }
      if (metrics.entityCanonicalCoverage >= 0.7) {
        return { tone: "positive", status: "healthy" };
      }
      if (metrics.entityCanonicalCoverage >= 0.4) {
        return { tone: "neutral", status: "neutral" };
      }
      return { tone: "warning", status: "attention" };
    case "lowConfidenceRatio":
      if (metrics.totalRelations <= 0) {
        return { tone: "neutral", status: "neutral" };
      }
      if (metrics.lowConfidenceRatio <= 0.1) {
        return { tone: "positive", status: "healthy" };
      }
      if (metrics.lowConfidenceRatio <= 0.25) {
        return { tone: "neutral", status: "neutral" };
      }
      return { tone: "warning", status: "attention" };
    case "missingEvidenceRatio":
      if (metrics.totalRelations <= 0) {
        return { tone: "neutral", status: "neutral" };
      }
      if (metrics.missingEvidenceRatio <= 0.1) {
        return { tone: "positive", status: "healthy" };
      }
      if (metrics.missingEvidenceRatio <= 0.25) {
        return { tone: "neutral", status: "neutral" };
      }
      return { tone: "warning", status: "attention" };
    default:
      return { tone: "neutral", status: "neutral" };
  }
}

export function getKnowledgeQuantReason(
  key: KnowledgeQuantMetricKey,
  metrics: KnowledgeQuantMetrics,
): QuantReason {
  switch (key) {
    case "indexed":
      if (metrics.totalSources === 0) {
        return {
          key: "emptyState",
          defaultLabel: "No indexed sources yet",
        };
      }
      return metrics.indexedRatio >= 0.9
        ? {
            key: "indexedCoverageHealthy",
            params: { percent: Math.round(metrics.indexedRatio * 100) },
            defaultLabel: "Indexed coverage is healthy ({{percent}}%)",
          }
        : {
            key: "indexedCoverageLow",
            params: { percent: Math.round(metrics.indexedRatio * 100) },
            defaultLabel: "Indexed coverage is low ({{percent}}%)",
          };
    case "documents":
    case "chunks":
    case "entities":
    case "relations": {
      const value = key === "documents"
        ? metrics.totalDocuments
        : key === "chunks"
          ? metrics.totalChunks
          : key === "entities"
            ? metrics.totalEntities
            : metrics.totalRelations;
      return value > 0
        ? { key: "activityPresent", defaultLabel: "Sufficient observed activity" }
        : { key: "noActivity", defaultLabel: "No activity observed yet" };
    }
    case "relationNormCoverage": {
      const percent = Math.round(metrics.relationNormalizationCoverage * 100);
      return metrics.relationNormalizationCoverage >= 0.4
        ? {
            key: "qualityCoverageHealthy",
            params: { percent },
            defaultLabel: "Coverage is acceptable ({{percent}}%)",
          }
        : {
            key: "qualityCoverageLow",
            params: { percent },
            defaultLabel: "Coverage is low ({{percent}}%)",
          };
    }
    case "entityNormCoverage": {
      const percent = Math.round(metrics.entityCanonicalCoverage * 100);
      return metrics.entityCanonicalCoverage >= 0.4
        ? {
            key: "qualityCoverageHealthy",
            params: { percent },
            defaultLabel: "Coverage is acceptable ({{percent}}%)",
          }
        : {
            key: "qualityCoverageLow",
            params: { percent },
            defaultLabel: "Coverage is low ({{percent}}%)",
          };
    }
    case "lowConfidenceRatio": {
      const percent = Math.round(metrics.lowConfidenceRatio * 100);
      return metrics.lowConfidenceRatio <= 0.25
        ? {
            key: "riskRatioHealthy",
            params: { percent },
            defaultLabel: "Risk ratio is controlled ({{percent}}%)",
          }
        : {
            key: "riskRatioHigh",
            params: { percent },
            defaultLabel: "Risk ratio is high ({{percent}}%)",
          };
    }
    case "missingEvidenceRatio": {
      const percent = Math.round(metrics.missingEvidenceRatio * 100);
      return metrics.missingEvidenceRatio <= 0.25
        ? {
            key: "riskRatioHealthy",
            params: { percent },
            defaultLabel: "Risk ratio is controlled ({{percent}}%)",
          }
        : {
            key: "riskRatioHigh",
            params: { percent },
            defaultLabel: "Risk ratio is high ({{percent}}%)",
          };
    }
    default:
      return {
        key: "emptyState",
        defaultLabel: "No signal",
      };
  }
}

export function summarizeRemoteRetryResults(
  sources: RemoteRetrySource[],
  settled: Array<PromiseSettledResult<unknown>>,
): RemoteRetrySummary {
  const successCount = settled.filter((result) => result.status === "fulfilled").length;
  const failedNames = settled
    .map((result, index) => ({ result, source: sources[index] }))
    .filter((item) => item.result.status === "rejected")
    .map((item) => item.source?.name || item.source?.id || "unknown");

  return {
    successCount,
    failedCount: failedNames.length,
    failedNames,
  };
}

export function getKnowledgeQuantActionKey(
  key: KnowledgeQuantMetricKey,
  metrics: KnowledgeQuantMetrics,
): KnowledgeQuantActionKey | undefined {
  const assessment = getKnowledgeQuantAssessment(key, metrics);

  if (key === "indexed" && assessment.status === "attention") {
    return "rebuildIndex";
  }
  if (metrics.totalSources === 0 && key === "documents") {
    return "addSource";
  }
  return undefined;
}

export function getKnowledgeQuantActionDescriptor(
  actionKey: KnowledgeQuantActionKey,
): KnowledgeQuantActionDescriptor {
  switch (actionKey) {
    case "addSource":
      return {
        key: "addSource",
        labelI18nKey: "knowledge.addSource",
        defaultLabel: "Add Source",
      };
    case "rebuildIndex":
      return {
        key: "rebuildIndex",
        labelI18nKey: "knowledge.indexAll",
        defaultLabel: "Rebuild Index",
      };
    case "backfillHistory":
      return {
        key: "backfillHistory",
        labelI18nKey: "knowledge.backfillNowButton",
        defaultLabel: "Backfill History",
      };
    case "retryRemote":
    default:
      return {
        key: "retryRemote",
        labelI18nKey: "knowledge.remoteRetryAction",
        defaultLabel: "Retry Remote Sources",
      };
  }
}

export function getKnowledgeQuantStatusLabel(
  status: QuantAssessment["status"],
): QuantStatusLabel {
  switch (status) {
    case "healthy":
      return {
        i18nKey: "knowledge.quantStatusHealthy",
        defaultLabel: "Healthy",
      };
    case "attention":
      return {
        i18nKey: "knowledge.quantStatusAttention",
        defaultLabel: "Needs attention",
      };
    case "neutral":
    default:
      return {
        i18nKey: "knowledge.quantStatusNeutral",
        defaultLabel: "No signal",
      };
  }
}

export function buildKnowledgeQuantCardModels(
  metrics: KnowledgeQuantMetrics,
): KnowledgeQuantCardModel[] {
  const base: Array<{
    key: KnowledgeQuantMetricKey;
    labelI18nKey: string;
    defaultLabel: string;
    value: string | number;
  }> = [
    {
      key: "indexed",
      labelI18nKey: "knowledge.quantSourcesIndexed",
      defaultLabel: "Index Coverage",
      value: ratioToPercent(metrics.indexedRatio),
    },
    {
      key: "documents",
      labelI18nKey: "knowledge.quantDocuments",
      defaultLabel: "Documents",
      value: metrics.totalDocuments,
    },
    {
      key: "chunks",
      labelI18nKey: "knowledge.quantChunks",
      defaultLabel: "Chunks",
      value: metrics.totalChunks,
    },
    {
      key: "entities",
      labelI18nKey: "knowledge.quantEntities",
      defaultLabel: "Entities",
      value: metrics.totalEntities,
    },
    {
      key: "relations",
      labelI18nKey: "knowledge.quantRelations",
      defaultLabel: "Relations",
      value: metrics.totalRelations,
    },
    {
      key: "relationNormCoverage",
      labelI18nKey: "knowledge.quantRelationNormalizationCoverage",
      defaultLabel: "Relation Normalization Coverage",
      value: ratioToPercent(metrics.relationNormalizationCoverage),
    },
    {
      key: "entityNormCoverage",
      labelI18nKey: "knowledge.quantEntityCanonicalCoverage",
      defaultLabel: "Entity Canonical Coverage",
      value: ratioToPercent(metrics.entityCanonicalCoverage),
    },
    {
      key: "lowConfidenceRatio",
      labelI18nKey: "knowledge.quantLowConfidenceRatio",
      defaultLabel: "Low-confidence Edge Ratio",
      value: ratioToPercent(metrics.lowConfidenceRatio),
    },
    {
      key: "missingEvidenceRatio",
      labelI18nKey: "knowledge.quantMissingEvidenceRatio",
      defaultLabel: "Missing Evidence Ratio",
      value: ratioToPercent(metrics.missingEvidenceRatio),
    },
  ];

  return base.map((item) => ({
    ...item,
    assessment: getKnowledgeQuantAssessment(item.key, metrics),
    reason: getKnowledgeQuantReason(item.key, metrics),
    actionKey: getKnowledgeQuantActionKey(item.key, metrics),
  }));
}
