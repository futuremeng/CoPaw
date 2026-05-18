import type { ProjectKnowledgeStepStatsRecord } from "../../../api/types";
import {
  formatProjectKnowledgeStatsRecordTimestamp,
  summarizeProjectKnowledgeDomainGraphBuildStats,
  summarizeProjectKnowledgeFileAnalysisStats,
  summarizeProjectKnowledgeQualityReviewStats,
  summarizeProjectKnowledgeSourceScanStats,
} from "./projectKnowledgeL1StatsUi";
import type {
  ProjectKnowledgeRecentHistoryItem,
  ProjectKnowledgeRecentHistorySection,
  ProjectKnowledgeStatsHistoryLike,
  ProjectKnowledgeSummaryStateLike,
  TranslateFn,
} from "./projectKnowledgeSummaryShared";

function buildRecentHistoryItems(
  history: ProjectKnowledgeStatsHistoryLike,
  summarize: (item: ProjectKnowledgeStepStatsRecord) => string,
): ProjectKnowledgeRecentHistoryItem[] {
  return (history || []).slice(0, 3).map((item, index) => ({
    key: `${item.updated_at || item.indexed_at || index}`,
    timestamp: formatProjectKnowledgeStatsRecordTimestamp(item),
    summary: summarize(item),
  }));
}

export function buildProjectKnowledgeProcessingRecentHistorySections(
  t: TranslateFn,
  params: {
    snapshotRawHistory?: ProjectKnowledgeStatsHistoryLike;
    buildChunksHistory?: ProjectKnowledgeStatsHistoryLike;
    buildInterlinearHistory?: ProjectKnowledgeStatsHistoryLike;
    tokenizeHistory?: ProjectKnowledgeStatsHistoryLike;
    posTaggingHistory?: ProjectKnowledgeStatsHistoryLike;
    syntaxParseHistory?: ProjectKnowledgeStatsHistoryLike;
    semanticRoleLabelingHistory?: ProjectKnowledgeStatsHistoryLike;
  },
): ProjectKnowledgeRecentHistorySection[] {
  const sections: ProjectKnowledgeRecentHistorySection[] = [];

  const snapshotRawItems = buildRecentHistoryItems(
    params.snapshotRawHistory,
    (item) => summarizeProjectKnowledgeSourceScanStats(t, item),
  );
  if (snapshotRawItems.length) {
    sections.push({
      key: "snapshot_raw",
      title: t("copaw.projects.knowledge.processing.recentSnapshotRawRuns"),
      hint: t("copaw.projects.knowledge.processing.recentSnapshotRawRunsHint"),
      items: snapshotRawItems,
    });
  }

  const buildChunksItems = buildRecentHistoryItems(
    params.buildChunksHistory,
    (item) => summarizeProjectKnowledgeFileAnalysisStats(t, item),
  );
  if (buildChunksItems.length) {
    sections.push({
      key: "build_chunks",
      title: t("copaw.projects.knowledge.processing.recentBuildChunksRuns"),
      hint: t("copaw.projects.knowledge.processing.recentBuildChunksRunsHint"),
      items: buildChunksItems,
    });
  }

  const buildInterlinearItems = buildRecentHistoryItems(
    params.buildInterlinearHistory,
    (item) => summarizeProjectKnowledgeFileAnalysisStats(t, item),
  );
  if (buildInterlinearItems.length) {
    sections.push({
      key: "build_interlinear",
      title: t("copaw.projects.knowledge.processing.recentBuildInterlinearRuns"),
      hint: t("copaw.projects.knowledge.processing.recentBuildInterlinearRunsHint"),
      items: buildInterlinearItems,
    });
  }

  const tokenizeItems = buildRecentHistoryItems(
    params.tokenizeHistory,
    (item) => summarizeProjectKnowledgeFileAnalysisStats(t, item),
  );
  if (tokenizeItems.length) {
    sections.push({
      key: "tokenize",
      title: t("copaw.projects.knowledge.processing.recentTokenizeRuns"),
      hint: t("copaw.projects.knowledge.processing.recentTokenizeRunsHint"),
      items: tokenizeItems,
    });
  }

  const posTaggingItems = buildRecentHistoryItems(
    params.posTaggingHistory,
    (item) => summarizeProjectKnowledgeFileAnalysisStats(t, item),
  );
  if (posTaggingItems.length) {
    sections.push({
      key: "pos_tagging",
      title: t("copaw.projects.knowledge.processing.recentPosTaggingRuns"),
      hint: t("copaw.projects.knowledge.processing.recentPosTaggingRunsHint"),
      items: posTaggingItems,
    });
  }

  const syntaxParseItems = buildRecentHistoryItems(
    params.syntaxParseHistory,
    (item) => summarizeProjectKnowledgeDomainGraphBuildStats(t, item),
  );
  if (syntaxParseItems.length) {
    sections.push({
      key: "syntax_parse",
      title: t("copaw.projects.knowledge.processing.recentSyntaxParseRuns"),
      hint: t("copaw.projects.knowledge.processing.recentSyntaxParseRunsHint"),
      items: syntaxParseItems,
    });
  }

  const semanticRoleLabelingItems = buildRecentHistoryItems(
    params.semanticRoleLabelingHistory,
    (item) => summarizeProjectKnowledgeQualityReviewStats(t, item),
  );
  if (semanticRoleLabelingItems.length) {
    sections.push({
      key: "semantic_role_labeling",
      title: t("copaw.projects.knowledge.processing.recentSemanticRoleLabelingRuns"),
      hint: t("copaw.projects.knowledge.processing.recentSemanticRoleLabelingRunsHint"),
      items: semanticRoleLabelingItems,
    });
  }

  return sections;
}

export function buildProjectKnowledgeProcessingRecentHistorySectionsFromState(
  t: TranslateFn,
  state: ProjectKnowledgeSummaryStateLike,
): ProjectKnowledgeRecentHistorySection[] {
  return buildProjectKnowledgeProcessingRecentHistorySections(t, {
    snapshotRawHistory: state.sourceScanStats?.history,
    buildChunksHistory: state.fileAnalysisStats?.history,
    buildInterlinearHistory: state.projectStepStats?.build_interlinear?.history,
    tokenizeHistory: state.projectStepStats?.tokenize?.history,
    posTaggingHistory: state.projectStepStats?.pos_tagging?.history,
    syntaxParseHistory: state.projectStepStats?.syntax_parse?.history,
    semanticRoleLabelingHistory: state.projectStepStats?.semantic_role_labeling?.history,
  });
}

export function buildProjectKnowledgeSourcesRecentHistorySections(
  t: TranslateFn,
  params: {
    sourceScanHistory?: ProjectKnowledgeStatsHistoryLike;
    fileAnalysisHistory?: ProjectKnowledgeStatsHistoryLike;
  },
): ProjectKnowledgeRecentHistorySection[] {
  const sections: ProjectKnowledgeRecentHistorySection[] = [];

  const sourceScanItems = buildRecentHistoryItems(
    params.sourceScanHistory,
    (item) => summarizeProjectKnowledgeSourceScanStats(t, item),
  );
  if (sourceScanItems.length) {
    sections.push({
      key: "snapshot_raw",
      title: t("copaw.projects.knowledge.sourcesRecentSnapshots"),
      hint: t("copaw.projects.knowledge.sourcesRecentSnapshotsHint"),
      items: sourceScanItems,
    });
  }

  const fileAnalysisItems = buildRecentHistoryItems(
    params.fileAnalysisHistory,
    (item) => summarizeProjectKnowledgeFileAnalysisStats(t, item),
  );
  if (fileAnalysisItems.length) {
    sections.push({
      key: "build_chunks",
      title: t("copaw.projects.knowledge.sourcesRecentChunkRuns"),
      hint: t("copaw.projects.knowledge.sourcesRecentChunkRunsHint"),
      items: fileAnalysisItems,
    });
  }

  return sections;
}

export function buildProjectKnowledgeSourcesRecentHistorySectionsFromState(
  t: TranslateFn,
  state: ProjectKnowledgeSummaryStateLike,
): ProjectKnowledgeRecentHistorySection[] {
  return buildProjectKnowledgeSourcesRecentHistorySections(t, {
    sourceScanHistory: state.sourceScanStats?.history,
    fileAnalysisHistory: state.fileAnalysisStats?.history,
  });
}