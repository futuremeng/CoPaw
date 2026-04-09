import type {
  KnowledgeHistoryBackfillStatus,
  KnowledgeSearchHit,
  KnowledgeSourceItem,
} from "../../../api/types";

export interface KnowledgeQuantMetrics {
  totalSources: number;
  indexedSources: number;
  indexedRatio: number;
  totalDocuments: number;
  totalChunks: number;
  autoSources: number;
  sourceTypeCount: number;
  remoteTrackedSources: number;
  remoteCachedSources: number;
  pendingHistorySessions: number;
  searchHits: number;
}

export type QuantTone = "neutral" | "positive" | "warning";

export type KnowledgeQuantMetricKey =
  | "sources"
  | "indexed"
  | "documents"
  | "chunks"
  | "auto"
  | "types"
  | "remote"
  | "pending"
  | "hits";

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
    | "remoteCachePartial"
    | "remoteCacheHealthy"
    | "pendingHistoryExists"
    | "pendingHistoryClear"
    | "sourceTypesNarrow"
    | "sourceTypesDiverse"
    | "emptyState"
    | "activityPresent"
    | "noActivity";
  params?: Record<string, number | string>;
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

function isAutoSource(source: KnowledgeSourceItem): boolean {
  const tags = source.tags || [];
  return tags.includes("auto") || tags.includes("origin:auto") || source.id.startsWith("auto-");
}

export function computeKnowledgeQuantMetrics(
  sources: KnowledgeSourceItem[],
  hits: KnowledgeSearchHit[],
  backfillStatus: KnowledgeHistoryBackfillStatus | null,
): KnowledgeQuantMetrics {
  const totalSources = sources.length;
  const indexedSources = sources.filter((source) => source.status.indexed).length;
  const indexedRatio = totalSources > 0 ? indexedSources / totalSources : 0;
  const totalDocuments = sources.reduce((sum, source) => sum + Math.max(0, source.status.document_count || 0), 0);
  const totalChunks = sources.reduce((sum, source) => sum + Math.max(0, source.status.chunk_count || 0), 0);
  const autoSources = sources.filter((source) => isAutoSource(source)).length;
  const sourceTypeCount = new Set(sources.map((source) => source.type)).size;
  const remoteTrackedSources = sources.filter(
    (source) => typeof source.status.remote_cache_state === "string" && source.status.remote_cache_state.length > 0,
  ).length;
  const remoteCachedSources = sources.filter((source) => source.status.remote_cache_state === "cached").length;
  const pendingHistorySessions = backfillStatus?.has_pending_history
    ? Math.max(0, backfillStatus.history_chat_count || 0)
    : 0;

  return {
    totalSources,
    indexedSources,
    indexedRatio,
    totalDocuments,
    totalChunks,
    autoSources,
    sourceTypeCount,
    remoteTrackedSources,
    remoteCachedSources,
    pendingHistorySessions,
    searchHits: hits.length,
  };
}

export function getKnowledgeQuantAssessment(
  key: KnowledgeQuantMetricKey,
  metrics: KnowledgeQuantMetrics,
): QuantAssessment {
  switch (key) {
    case "sources":
      return metrics.totalSources > 0
        ? { tone: "positive", status: "healthy" }
        : { tone: "neutral", status: "neutral" };
    case "indexed":
      if (metrics.totalSources === 0) {
        return { tone: "neutral", status: "neutral" };
      }
      return metrics.indexedRatio >= 0.8
        ? { tone: "positive", status: "healthy" }
        : { tone: "warning", status: "attention" };
    case "documents":
    case "chunks":
    case "auto":
    case "hits":
      return metrics[key === "documents"
        ? "totalDocuments"
        : key === "chunks"
          ? "totalChunks"
          : key === "auto"
            ? "autoSources"
            : "searchHits"] > 0
        ? { tone: "positive", status: "healthy" }
        : { tone: "neutral", status: "neutral" };
    case "types":
      if (metrics.sourceTypeCount >= 3) {
        return { tone: "positive", status: "healthy" };
      }
      return metrics.sourceTypeCount > 0
        ? { tone: "neutral", status: "neutral" }
        : { tone: "neutral", status: "neutral" };
    case "remote":
      if (metrics.remoteTrackedSources === 0) {
        return { tone: "neutral", status: "neutral" };
      }
      return metrics.remoteCachedSources === metrics.remoteTrackedSources
        ? { tone: "positive", status: "healthy" }
        : { tone: "warning", status: "attention" };
    case "pending":
      return metrics.pendingHistorySessions > 0
        ? { tone: "warning", status: "attention" }
        : { tone: "positive", status: "healthy" };
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
        return { key: "emptyState" };
      }
      return metrics.indexedRatio >= 0.8
        ? {
            key: "indexedCoverageHealthy",
            params: { percent: Math.round(metrics.indexedRatio * 100) },
          }
        : {
            key: "indexedCoverageLow",
            params: { percent: Math.round(metrics.indexedRatio * 100) },
          };
    case "remote":
      if (metrics.remoteTrackedSources === 0) {
        return { key: "emptyState" };
      }
      return metrics.remoteCachedSources === metrics.remoteTrackedSources
        ? {
            key: "remoteCacheHealthy",
            params: {
              cached: metrics.remoteCachedSources,
              tracked: metrics.remoteTrackedSources,
            },
          }
        : {
            key: "remoteCachePartial",
            params: {
              cached: metrics.remoteCachedSources,
              tracked: metrics.remoteTrackedSources,
            },
          };
    case "pending":
      return metrics.pendingHistorySessions > 0
        ? {
            key: "pendingHistoryExists",
            params: { count: metrics.pendingHistorySessions },
          }
        : { key: "pendingHistoryClear" };
    case "types":
      if (metrics.sourceTypeCount === 0) {
        return { key: "emptyState" };
      }
      return metrics.sourceTypeCount >= 3
        ? {
            key: "sourceTypesDiverse",
            params: { count: metrics.sourceTypeCount },
          }
        : {
            key: "sourceTypesNarrow",
            params: { count: metrics.sourceTypeCount },
          };
    case "sources":
    case "documents":
    case "chunks":
    case "auto":
    case "hits": {
      const value = key === "sources"
        ? metrics.totalSources
        : key === "documents"
          ? metrics.totalDocuments
          : key === "chunks"
            ? metrics.totalChunks
            : key === "auto"
              ? metrics.autoSources
              : metrics.searchHits;
      return value > 0 ? { key: "activityPresent" } : { key: "noActivity" };
    }
    default:
      return { key: "emptyState" };
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

  if (key === "sources" && metrics.totalSources === 0) {
    return "addSource";
  }
  if (key === "types" && metrics.sourceTypeCount === 0) {
    return "addSource";
  }
  if (key === "indexed" && assessment.status === "attention") {
    return "rebuildIndex";
  }
  if (key === "pending" && metrics.pendingHistorySessions > 0) {
    return "backfillHistory";
  }
  if (key === "remote" && assessment.status === "attention") {
    return "retryRemote";
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
  const coverage = `${Math.round(metrics.indexedRatio * 100)}%`;
  const remoteCache = metrics.remoteTrackedSources > 0
    ? `${metrics.remoteCachedSources}/${metrics.remoteTrackedSources}`
    : "-";

  const base: Array<{
    key: KnowledgeQuantMetricKey;
    labelI18nKey: string;
    defaultLabel: string;
    value: string | number;
  }> = [
    {
      key: "sources",
      labelI18nKey: "knowledge.quantSourcesTotal",
      defaultLabel: "Sources",
      value: metrics.totalSources,
    },
    {
      key: "indexed",
      labelI18nKey: "knowledge.quantSourcesIndexed",
      defaultLabel: "Index Coverage",
      value: coverage,
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
      key: "auto",
      labelI18nKey: "knowledge.quantAutoSources",
      defaultLabel: "Auto Sources",
      value: metrics.autoSources,
    },
    {
      key: "types",
      labelI18nKey: "knowledge.quantSourceTypes",
      defaultLabel: "Source Types",
      value: metrics.sourceTypeCount,
    },
    {
      key: "remote",
      labelI18nKey: "knowledge.quantRemoteCache",
      defaultLabel: "Remote Cache",
      value: remoteCache,
    },
    {
      key: "pending",
      labelI18nKey: "knowledge.quantPendingHistory",
      defaultLabel: "Pending History",
      value: metrics.pendingHistorySessions,
    },
    {
      key: "hits",
      labelI18nKey: "knowledge.quantSearchHits",
      defaultLabel: "Last Search Hits",
      value: metrics.searchHits,
    },
  ];

  return base.map((item) => ({
    ...item,
    assessment: getKnowledgeQuantAssessment(item.key, metrics),
    reason: getKnowledgeQuantReason(item.key, metrics),
    actionKey: getKnowledgeQuantActionKey(item.key, metrics),
  }));
}
