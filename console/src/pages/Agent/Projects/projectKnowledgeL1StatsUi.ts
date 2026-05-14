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
    snapshotRaw?: ProjectKnowledgeStatsLike;
    buildChunks?: ProjectKnowledgeStatsLike;
  },
): string[] {
  const parts: string[] = [];
  if (hasProjectKnowledgeStats(params.snapshotRaw)) {
    parts.push(t(
      "projects.knowledge.latestSnapshotRawSummary",
      "scan {{time}} · {{summary}}",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.snapshotRaw),
        summary: summarizeProjectKnowledgeSourceScanStats(
          t,
          params.snapshotRaw,
          "projects.knowledge.latestSnapshotRawMetrics",
          "{{files}} files / {{changed}} changed",
        ),
      },
    ));
  }
  if (hasProjectKnowledgeStats(params.buildChunks)) {
    parts.push(t(
      "projects.knowledge.latestBuildChunksSummary",
      "analysis {{time}} · {{summary}}",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.buildChunks),
        summary: summarizeProjectKnowledgeFileAnalysisStats(
          t,
          params.buildChunks,
          "projects.knowledge.latestBuildChunksMetrics",
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
    buildInterlinear?: ProjectKnowledgeStatsLike;
    tokenize?: ProjectKnowledgeStatsLike;
    posTagging?: ProjectKnowledgeStatsLike;
    syntaxParse?: ProjectKnowledgeStatsLike;
    semanticRoleLabeling?: ProjectKnowledgeStatsLike;
  },
): string[] {
  const parts: string[] = [];
  if (hasProjectKnowledgeStats(params.buildInterlinear)) {
    parts.push(t(
      "projects.knowledge.latestBuildInterlinearSummary",
      "interlinear {{time}} · {{summary}}",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.buildInterlinear),
        summary: summarizeProjectKnowledgeFileAnalysisStats(
          t,
          params.buildInterlinear,
          "projects.knowledge.latestBuildInterlinearMetrics",
          "{{documents}} docs / {{chunks}} chunks / {{sentences}} sentences",
        ),
      },
    ));
  }
  if (hasProjectKnowledgeStats(params.tokenize)) {
    parts.push(t(
      "projects.knowledge.latestTokenizeSummary",
      "tokenize {{time}} · {{summary}}",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.tokenize),
        summary: summarizeProjectKnowledgeFileAnalysisStats(
          t,
          params.tokenize,
          "projects.knowledge.latestTokenizeMetrics",
          "{{documents}} docs / {{chunks}} chunks / {{sentences}} sentences",
        ),
      },
    ));
  }
  if (hasProjectKnowledgeStats(params.posTagging)) {
    parts.push(t(
      "projects.knowledge.latestPosTaggingSummary",
      "pos {{time}} · {{summary}}",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.posTagging),
        summary: summarizeProjectKnowledgeFileAnalysisStats(
          t,
          params.posTagging,
          "projects.knowledge.latestPosTaggingMetrics",
          "{{documents}} docs / {{chunks}} chunks / {{sentences}} sentences",
        ),
      },
    ));
  }
  if (hasProjectKnowledgeStats(params.syntaxParse)) {
    parts.push(t(
      "projects.knowledge.latestSyntaxParseSummary",
      "syntax {{time}} · {{summary}}",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.syntaxParse),
        summary: summarizeProjectKnowledgeDomainGraphBuildStats(
          t,
          params.syntaxParse,
          "projects.knowledge.latestSyntaxParseMetrics",
          "{{documents}} docs / {{nodes}} nodes / {{relations}} relations",
        ),
      },
    ));
  }
  if (hasProjectKnowledgeStats(params.semanticRoleLabeling)) {
    parts.push(t(
      "projects.knowledge.latestSemanticRoleLabelingSummary",
      "srl {{time}} · {{summary}}",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.semanticRoleLabeling),
        summary: summarizeProjectKnowledgeQualityReviewStats(
          t,
          params.semanticRoleLabeling,
          "projects.knowledge.latestSemanticRoleLabelingMetrics",
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
    syntaxParse?: ProjectKnowledgeStatsLike;
    semanticRoleLabeling?: ProjectKnowledgeStatsLike;
  },
): string[] {
  const parts: string[] = [];
  if ((params.selectedMode === "nlp" || params.selectedMode === "agentic") && hasProjectKnowledgeStats(params.syntaxParse)) {
    parts.push(t(
      "projects.knowledge.outputs.latestSyntaxProvenance",
      "syntax provenance {{time}} · {{summary}}",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.syntaxParse),
        summary: summarizeProjectKnowledgeDomainGraphBuildStats(
          t,
          params.syntaxParse,
          "projects.knowledge.outputs.latestSyntaxProvenanceMetrics",
          "{{documents}} docs / {{nodes}} nodes / {{relations}} relations",
        ),
      },
    ));
  }
  if (params.selectedMode === "agentic" && hasProjectKnowledgeStats(params.semanticRoleLabeling)) {
    parts.push(t(
      "projects.knowledge.outputs.latestSemanticRoleLabelingOutcome",
      "srl outcome {{time}} · {{summary}}",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.semanticRoleLabeling),
        summary: summarizeProjectKnowledgeQualityReviewStats(
          t,
          params.semanticRoleLabeling,
          "projects.knowledge.outputs.latestSemanticRoleLabelingOutcomeMetrics",
          "{{before}} -> {{after}} / delta {{delta}} / {{rounds}} rounds",
        ),
      },
    ));
  }
  return parts;
}