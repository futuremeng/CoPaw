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
    sourceScanHistory?: ProjectKnowledgeStatsHistoryLike;
    fileAnalysisHistory?: ProjectKnowledgeStatsHistoryLike;
    domainGraphBuildHistory?: ProjectKnowledgeStatsHistoryLike;
    qualityReviewHistory?: ProjectKnowledgeStatsHistoryLike;
  },
): ProjectKnowledgeRecentHistorySection[] {
  const sections: ProjectKnowledgeRecentHistorySection[] = [];

  const sourceScanItems = buildRecentHistoryItems(
    params.sourceScanHistory,
    (item) => summarizeProjectKnowledgeSourceScanStats(
      t,
      item,
      "projects.knowledge.processing.recentSourceScanSummary",
      "{{files}} files / {{changed}} changed / {{sources}} sources",
    ),
  );
  if (sourceScanItems.length) {
    sections.push({
      key: "source_scan",
      title: t("projects.knowledge.processing.recentSourceScans", "最近扫描"),
      hint: t("projects.knowledge.processing.recentSourceScansHint", "来自 source_scan 项目统计文件"),
      items: sourceScanItems,
    });
  }

  const fileAnalysisItems = buildRecentHistoryItems(
    params.fileAnalysisHistory,
    (item) => summarizeProjectKnowledgeFileAnalysisStats(
      t,
      item,
      "projects.knowledge.processing.recentL1RunSummary",
      "{{documents}} docs / {{chunks}} chunks / {{sentences}} sentences",
    ),
  );
  if (fileAnalysisItems.length) {
    sections.push({
      key: "file_analysis",
      title: t("projects.knowledge.processing.recentL1Runs", "最近基础分析"),
      hint: t("projects.knowledge.processing.recentL1RunsHint", "来自文件分析项目统计"),
      items: fileAnalysisItems,
    });
  }

  const domainGraphBuildItems = buildRecentHistoryItems(
    params.domainGraphBuildHistory,
    (item) => summarizeProjectKnowledgeDomainGraphBuildStats(t, item),
  );
  if (domainGraphBuildItems.length) {
    sections.push({
      key: "domain_graph_build",
      title: t("projects.knowledge.processing.recentDomainGraphRuns", "最近结构化构建"),
      hint: t("projects.knowledge.processing.recentDomainGraphRunsHint", "来自结构化构建项目统计"),
      items: domainGraphBuildItems,
    });
  }

  const qualityReviewItems = buildRecentHistoryItems(
    params.qualityReviewHistory,
    (item) => summarizeProjectKnowledgeQualityReviewStats(t, item),
  );
  if (qualityReviewItems.length) {
    sections.push({
      key: "quality_review",
      title: t("projects.knowledge.processing.recentQualityReviewRuns", "最近增强审校"),
      hint: t("projects.knowledge.processing.recentQualityReviewRunsHint", "来自审校增强项目统计"),
      items: qualityReviewItems,
    });
  }

  return sections;
}

export function buildProjectKnowledgeProcessingRecentHistorySectionsFromState(
  t: TranslateFn,
  state: ProjectKnowledgeSummaryStateLike,
): ProjectKnowledgeRecentHistorySection[] {
  return buildProjectKnowledgeProcessingRecentHistorySections(t, {
    sourceScanHistory: state.sourceScanStats?.history,
    fileAnalysisHistory: state.fileAnalysisStats?.history,
    domainGraphBuildHistory: state.projectStepStats?.domain_graph_build?.history,
    qualityReviewHistory: state.projectStepStats?.quality_review?.history,
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
      key: "source_scan",
      title: t("projects.knowledge.sourcesRecentScans", "最近扫描"),
      hint: t("projects.knowledge.sourcesRecentScansHint", "最近的 source_scan 项目统计"),
      items: sourceScanItems,
    });
  }

  const fileAnalysisItems = buildRecentHistoryItems(
    params.fileAnalysisHistory,
    (item) => summarizeProjectKnowledgeFileAnalysisStats(t, item),
  );
  if (fileAnalysisItems.length) {
    sections.push({
      key: "file_analysis",
      title: t("projects.knowledge.sourcesRecentAnalysisRuns", "最近分析运行"),
      hint: t("projects.knowledge.sourcesRecentAnalysisRunsHint", "最近的文件分析项目统计"),
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