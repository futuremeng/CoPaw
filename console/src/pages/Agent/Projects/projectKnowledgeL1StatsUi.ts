import type {
  ProjectKnowledgeProcessingMode,
  ProjectKnowledgeStepStatsRecord,
} from "../../../api/types";

type TranslateFn = (
  key: string,
  maybeFallbackOrOptions?: string | Record<string, unknown>,
  maybeOptions?: Record<string, unknown>,
) => string;

type ProjectKnowledgeStatsLike = ProjectKnowledgeStepStatsRecord | Record<string, never> | null | undefined;

function asMetricsRecord(stats: ProjectKnowledgeStatsLike): Record<string, unknown> {
  if (!stats || typeof stats !== "object" || !("metrics" in stats)) {
    return {};
  }
  const metrics = stats.metrics;
  return metrics && typeof metrics === "object" ? (metrics as Record<string, unknown>) : {};
}

function hasObjectFields(value: ProjectKnowledgeStatsLike): boolean {
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

export function hasProjectKnowledgeStats(stats: ProjectKnowledgeStatsLike): boolean {
  return hasObjectFields(stats);
}

export function formatProjectKnowledgeStatsTimestamp(value?: string | null): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "-";
  }
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    return normalized;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function formatProjectKnowledgeStatsRecordTimestamp(stats: ProjectKnowledgeStatsLike): string {
  if (!stats || typeof stats !== "object") {
    return "-";
  }
  const updatedAt = "updated_at" in stats ? stats.updated_at : undefined;
  const indexedAt = "indexed_at" in stats ? stats.indexed_at : undefined;
  return formatProjectKnowledgeStatsTimestamp(String(updatedAt || indexedAt || ""));
}

export function summarizeProjectKnowledgeSourceScanStats(
  t: TranslateFn,
  stats: ProjectKnowledgeStatsLike,
  key = "projects.knowledge.sourcesRecentScanSummary",
  fallback = "{{files}} files / {{changed}} changed / {{sources}} sources",
): string {
  const metrics = asMetricsRecord(stats);
  return t(key, fallback, {
    files: Number(metrics.data_file_count || 0),
    changed: Number(metrics.changed_path_count || 0),
    sources: Number(metrics.source_count || 0),
  });
}

export function summarizeProjectKnowledgeFileAnalysisStats(
  t: TranslateFn,
  stats: ProjectKnowledgeStatsLike,
  key = "projects.knowledge.sourcesRecentL1RunSummary",
  fallback = "{{documents}} docs / {{chunks}} chunks / {{sentences}} sentences",
): string {
  const metrics = asMetricsRecord(stats);
  return t(key, fallback, {
    documents: Number(metrics.document_count || 0),
    chunks: Number(metrics.chunk_count || 0),
    sentences: Number(metrics.sentence_count || 0),
  });
}

export function summarizeProjectKnowledgeDomainGraphBuildStats(
  t: TranslateFn,
  stats: ProjectKnowledgeStatsLike,
  key = "projects.knowledge.processing.recentDomainGraphRunSummary",
  fallback = "{{documents}} docs / {{nodes}} nodes / {{relations}} relations",
): string {
  const metrics = asMetricsRecord(stats);
  return t(key, fallback, {
    documents: Number(metrics.document_count || 0),
    nodes: Number(metrics.node_count || 0),
    relations: Number(metrics.relation_count || 0),
  });
}

export function summarizeProjectKnowledgeQualityReviewStats(
  t: TranslateFn,
  stats: ProjectKnowledgeStatsLike,
  key = "projects.knowledge.processing.recentQualityReviewSummary",
  fallback = "{{before}} -> {{after}} / delta {{delta}} / {{rounds}} rounds",
): string {
  const metrics = asMetricsRecord(stats);
  const before = Number(metrics.quality_score_before || 0);
  const after = Number(metrics.quality_score_after || 0);
  const delta = Number(metrics.quality_delta || 0);
  const rounds = Number(metrics.quality_rounds || 0);
  return t(key, fallback, {
    before: before.toFixed(2),
    after: after.toFixed(2),
    delta: delta.toFixed(2),
    rounds,
  });
}

export function buildProjectKnowledgeLatestL1SummaryParts(
  t: TranslateFn,
  params: {
    sourceScan?: ProjectKnowledgeStatsLike;
    fileAnalysis?: ProjectKnowledgeStatsLike;
  },
): string[] {
  const parts: string[] = [];
  if (hasProjectKnowledgeStats(params.sourceScan)) {
    parts.push(t(
      "projects.knowledge.latestSourceScanSummary",
      "scan {{time}} · {{summary}}",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.sourceScan),
        summary: summarizeProjectKnowledgeSourceScanStats(
          t,
          params.sourceScan,
          "projects.knowledge.latestSourceScanMetrics",
          "{{files}} files / {{changed}} changed",
        ),
      },
    ));
  }
  if (hasProjectKnowledgeStats(params.fileAnalysis)) {
    parts.push(t(
      "projects.knowledge.latestFileAnalysisSummary",
      "analysis {{time}} · {{summary}}",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.fileAnalysis),
        summary: summarizeProjectKnowledgeFileAnalysisStats(
          t,
          params.fileAnalysis,
          "projects.knowledge.latestFileAnalysisMetrics",
          "{{documents}} docs / {{chunks}} chunks / {{sentences}} sentences",
        ),
      },
    ));
  }
  return parts;
}

export function buildProjectKnowledgeLatestL23SummaryParts(
  t: TranslateFn,
  params: {
    domainGraphBuild?: ProjectKnowledgeStatsLike;
    qualityReview?: ProjectKnowledgeStatsLike;
  },
): string[] {
  const parts: string[] = [];
  if (hasProjectKnowledgeStats(params.domainGraphBuild)) {
    parts.push(t(
      "projects.knowledge.latestDomainGraphBuildSummary",
      "graph {{time}} · {{summary}}",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.domainGraphBuild),
        summary: summarizeProjectKnowledgeDomainGraphBuildStats(
          t,
          params.domainGraphBuild,
          "projects.knowledge.latestDomainGraphBuildMetrics",
          "{{documents}} docs / {{nodes}} nodes / {{relations}} relations",
        ),
      },
    ));
  }
  if (hasProjectKnowledgeStats(params.qualityReview)) {
    parts.push(t(
      "projects.knowledge.latestQualityReviewSummary",
      "review {{time}} · {{summary}}",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.qualityReview),
        summary: summarizeProjectKnowledgeQualityReviewStats(
          t,
          params.qualityReview,
          "projects.knowledge.latestQualityReviewMetrics",
          "{{before}} -> {{after}} / delta {{delta}} / {{rounds}} rounds",
        ),
      },
    ));
  }
  return parts;
}

export function buildProjectKnowledgeLatestOutputSummaryParts(
  t: TranslateFn,
  params: {
    selectedMode: ProjectKnowledgeProcessingMode;
    domainGraphBuild?: ProjectKnowledgeStatsLike;
    qualityReview?: ProjectKnowledgeStatsLike;
  },
): string[] {
  const parts: string[] = [];
  if ((params.selectedMode === "nlp" || params.selectedMode === "agentic") && hasProjectKnowledgeStats(params.domainGraphBuild)) {
    parts.push(t(
      "projects.knowledge.outputs.latestGraphProvenance",
      "graph provenance {{time}} · {{summary}}",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.domainGraphBuild),
        summary: summarizeProjectKnowledgeDomainGraphBuildStats(
          t,
          params.domainGraphBuild,
          "projects.knowledge.outputs.latestGraphProvenanceMetrics",
          "{{documents}} docs / {{nodes}} nodes / {{relations}} relations",
        ),
      },
    ));
  }
  if (params.selectedMode === "agentic" && hasProjectKnowledgeStats(params.qualityReview)) {
    parts.push(t(
      "projects.knowledge.outputs.latestReviewOutcome",
      "review outcome {{time}} · {{summary}}",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.qualityReview),
        summary: summarizeProjectKnowledgeQualityReviewStats(
          t,
          params.qualityReview,
          "projects.knowledge.outputs.latestReviewOutcomeMetrics",
          "{{before}} -> {{after}} / delta {{delta}} / {{rounds}} rounds",
        ),
      },
    ));
  }
  return parts;
}