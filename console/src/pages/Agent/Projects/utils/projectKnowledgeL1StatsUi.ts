import type {
  ProjectKnowledgeProcessingMode,
  ProjectKnowledgeStepStatsRecord,
} from "../../../../api/types";

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
  key = "copaw.projects.knowledge.sourcesRecentScanSummary",
): string {
  const metrics = asMetricsRecord(stats);
  return t(key, {
    files: Number(metrics.data_file_count || 0),
    changed: Number(metrics.changed_path_count || 0),
    sources: Number(metrics.source_count || 0),
  });
}

export function summarizeProjectKnowledgeFileAnalysisStats(
  t: TranslateFn,
  stats: ProjectKnowledgeStatsLike,
  key = "copaw.projects.knowledge.sourcesRecentL1RunSummary",
): string {
  const metrics = asMetricsRecord(stats);
  return t(key, {
    documents: Number(metrics.document_count || 0),
    chunks: Number(metrics.chunk_count || 0),
    sentences: Number(metrics.sentence_count || 0),
  });
}

export function summarizeProjectKnowledgeDomainGraphBuildStats(
  t: TranslateFn,
  stats: ProjectKnowledgeStatsLike,
  key = "copaw.projects.knowledge.processing.recentDomainGraphRunSummary",
): string {
  const metrics = asMetricsRecord(stats);
  return t(key, {
    documents: Number(metrics.document_count || 0),
    nodes: Number(metrics.node_count || 0),
    relations: Number(metrics.relation_count || 0),
  });
}

export function summarizeProjectKnowledgeQualityReviewStats(
  t: TranslateFn,
  stats: ProjectKnowledgeStatsLike,
  key = "copaw.projects.knowledge.processing.recentQualityReviewSummary",
): string {
  const metrics = asMetricsRecord(stats);
  const before = Number(metrics.quality_score_before || 0);
  const after = Number(metrics.quality_score_after || 0);
  const delta = Number(metrics.quality_delta || 0);
  const rounds = Number(metrics.quality_rounds || 0);
  return t(key, {
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
      "copaw.projects.knowledge.latestSnapshotRawSummary",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.snapshotRaw),
        summary: summarizeProjectKnowledgeSourceScanStats(
          t,
          params.snapshotRaw,
          "copaw.projects.knowledge.latestSnapshotRawMetrics",
        ),
      },
    ));
  }
  if (hasProjectKnowledgeStats(params.buildChunks)) {
    parts.push(t(
      "copaw.projects.knowledge.latestBuildChunksSummary",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.buildChunks),
        summary: summarizeProjectKnowledgeFileAnalysisStats(
          t,
          params.buildChunks,
          "copaw.projects.knowledge.latestBuildChunksMetrics",
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
      "copaw.projects.knowledge.latestBuildInterlinearSummary",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.buildInterlinear),
        summary: summarizeProjectKnowledgeFileAnalysisStats(
          t,
          params.buildInterlinear,
          "copaw.projects.knowledge.latestBuildInterlinearMetrics",
        ),
      },
    ));
  }
  if (hasProjectKnowledgeStats(params.tokenize)) {
    parts.push(t(
      "copaw.projects.knowledge.latestTokenizeSummary",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.tokenize),
        summary: summarizeProjectKnowledgeFileAnalysisStats(
          t,
          params.tokenize,
          "copaw.projects.knowledge.latestTokenizeMetrics",
        ),
      },
    ));
  }
  if (hasProjectKnowledgeStats(params.posTagging)) {
    parts.push(t(
      "copaw.projects.knowledge.latestPosTaggingSummary",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.posTagging),
        summary: summarizeProjectKnowledgeFileAnalysisStats(
          t,
          params.posTagging,
          "copaw.projects.knowledge.latestPosTaggingMetrics",
        ),
      },
    ));
  }
  if (hasProjectKnowledgeStats(params.syntaxParse)) {
    parts.push(t(
      "copaw.projects.knowledge.latestSyntaxParseSummary",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.syntaxParse),
        summary: summarizeProjectKnowledgeDomainGraphBuildStats(
          t,
          params.syntaxParse,
          "copaw.projects.knowledge.latestSyntaxParseMetrics",
        ),
      },
    ));
  }
  if (hasProjectKnowledgeStats(params.semanticRoleLabeling)) {
    parts.push(t(
      "copaw.projects.knowledge.latestSemanticRoleLabelingSummary",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.semanticRoleLabeling),
        summary: summarizeProjectKnowledgeQualityReviewStats(
          t,
          params.semanticRoleLabeling,
          "copaw.projects.knowledge.latestSemanticRoleLabelingMetrics",
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
      "copaw.projects.knowledge.outputs.latestSyntaxProvenance",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.syntaxParse),
        summary: summarizeProjectKnowledgeDomainGraphBuildStats(
          t,
          params.syntaxParse,
          "copaw.projects.knowledge.outputs.latestSyntaxProvenanceMetrics",
        ),
      },
    ));
  }
  if (params.selectedMode === "agentic" && hasProjectKnowledgeStats(params.semanticRoleLabeling)) {
    parts.push(t(
      "copaw.projects.knowledge.outputs.latestSemanticRoleLabelingOutcome",
      {
        time: formatProjectKnowledgeStatsRecordTimestamp(params.semanticRoleLabeling),
        summary: summarizeProjectKnowledgeQualityReviewStats(
          t,
          params.semanticRoleLabeling,
          "copaw.projects.knowledge.outputs.latestSemanticRoleLabelingOutcomeMetrics",
        ),
      },
    ));
  }
  return parts;
}