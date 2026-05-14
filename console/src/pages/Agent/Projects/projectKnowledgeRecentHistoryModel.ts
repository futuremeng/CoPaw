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
    (item) => summarizeProjectKnowledgeSourceScanStats(
      t,
      item,
      "projects.knowledge.processing.recentSnapshotRawSummary",
      "{{files}} files / {{changed}} changed / {{sources}} sources",
    ),
  );
  if (snapshotRawItems.length) {
    sections.push({
      key: "snapshot_raw",
      title: t("projects.knowledge.processing.recentSnapshotRawRuns", "最近原始快照"),
      hint: t("projects.knowledge.processing.recentSnapshotRawRunsHint", "来自 snapshot_raw 项目统计文件"),
      items: snapshotRawItems,
    });
  }

  const buildChunksItems = buildRecentHistoryItems(
    params.buildChunksHistory,
    (item) => summarizeProjectKnowledgeFileAnalysisStats(
      t,
      item,
      "projects.knowledge.processing.recentBuildChunksSummary",
      "{{documents}} docs / {{chunks}} chunks / {{sentences}} sentences",
    ),
  );
  if (buildChunksItems.length) {
    sections.push({
      key: "build_chunks",
      title: t("projects.knowledge.processing.recentBuildChunksRuns", "最近切块构建"),
      hint: t("projects.knowledge.processing.recentBuildChunksRunsHint", "来自 build_chunks 项目统计"),
      items: buildChunksItems,
    });
  }

  const buildInterlinearItems = buildRecentHistoryItems(
    params.buildInterlinearHistory,
    (item) => summarizeProjectKnowledgeFileAnalysisStats(
      t,
      item,
      "projects.knowledge.processing.recentBuildInterlinearSummary",
      "{{documents}} docs / {{chunks}} chunks / {{sentences}} sentences",
    ),
  );
  if (buildInterlinearItems.length) {
    sections.push({
      key: "build_interlinear",
      title: t("projects.knowledge.processing.recentBuildInterlinearRuns", "最近 interlinear 构建"),
      hint: t("projects.knowledge.processing.recentBuildInterlinearRunsHint", "来自 build_interlinear 项目统计"),
      items: buildInterlinearItems,
    });
  }

  const tokenizeItems = buildRecentHistoryItems(
    params.tokenizeHistory,
    (item) => summarizeProjectKnowledgeFileAnalysisStats(
      t,
      item,
      "projects.knowledge.processing.recentTokenizeSummary",
      "{{documents}} docs / {{chunks}} chunks / {{sentences}} sentences",
    ),
  );
  if (tokenizeItems.length) {
    sections.push({
      key: "tokenize",
      title: t("projects.knowledge.processing.recentTokenizeRuns", "最近分词运行"),
      hint: t("projects.knowledge.processing.recentTokenizeRunsHint", "来自 tokenize 项目统计"),
      items: tokenizeItems,
    });
  }

  const posTaggingItems = buildRecentHistoryItems(
    params.posTaggingHistory,
    (item) => summarizeProjectKnowledgeFileAnalysisStats(
      t,
      item,
      "projects.knowledge.processing.recentPosTaggingSummary",
      "{{documents}} docs / {{chunks}} chunks / {{sentences}} sentences",
    ),
  );
  if (posTaggingItems.length) {
    sections.push({
      key: "pos_tagging",
      title: t("projects.knowledge.processing.recentPosTaggingRuns", "最近词性标注"),
      hint: t("projects.knowledge.processing.recentPosTaggingRunsHint", "来自 pos_tagging 项目统计"),
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
      title: t("projects.knowledge.processing.recentSyntaxParseRuns", "最近句法解析"),
      hint: t("projects.knowledge.processing.recentSyntaxParseRunsHint", "来自 syntax_parse 项目统计"),
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
      title: t("projects.knowledge.processing.recentSemanticRoleLabelingRuns", "最近 SRL 运行"),
      hint: t("projects.knowledge.processing.recentSemanticRoleLabelingRunsHint", "来自 semantic_role_labeling 项目统计"),
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
      title: t("projects.knowledge.sourcesRecentSnapshots", "最近原始快照"),
      hint: t("projects.knowledge.sourcesRecentSnapshotsHint", "最近的 snapshot_raw 项目统计"),
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
      title: t("projects.knowledge.sourcesRecentChunkRuns", "最近切块运行"),
      hint: t("projects.knowledge.sourcesRecentChunkRunsHint", "最近的 build_chunks 项目统计"),
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