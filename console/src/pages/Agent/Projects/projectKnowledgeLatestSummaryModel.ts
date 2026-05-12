import type { ProjectKnowledgeProcessingMode } from "../../../api/types";
import {
  buildProjectKnowledgeLatestL1SummaryParts,
  buildProjectKnowledgeLatestL23SummaryParts,
  buildProjectKnowledgeLatestOutputSummaryParts,
} from "./projectKnowledgeL1StatsUi";
import type {
  ProjectKnowledgeStatsLike,
  ProjectKnowledgeSummaryStateLike,
  TranslateFn,
} from "./projectKnowledgeSummaryShared";

export interface ProjectKnowledgeLatestSummaryModel {
  l1Parts: string[];
  l23Parts: string[];
  workflowParts: string[];
  outputParts: string[];
}

export function buildProjectKnowledgeLatestSummaryModel(
  t: TranslateFn,
  params: {
    selectedOutputMode?: ProjectKnowledgeProcessingMode;
    sourceScan?: ProjectKnowledgeStatsLike;
    fileAnalysis?: ProjectKnowledgeStatsLike;
    domainGraphBuild?: ProjectKnowledgeStatsLike;
    qualityReview?: ProjectKnowledgeStatsLike;
  },
): ProjectKnowledgeLatestSummaryModel {
  const l1Parts = buildProjectKnowledgeLatestL1SummaryParts(t, {
    sourceScan: params.sourceScan,
    fileAnalysis: params.fileAnalysis,
  });
  const l23Parts = buildProjectKnowledgeLatestL23SummaryParts(t, {
    domainGraphBuild: params.domainGraphBuild,
    qualityReview: params.qualityReview,
  });
  return {
    l1Parts,
    l23Parts,
    workflowParts: [...l1Parts, ...l23Parts],
    outputParts: buildProjectKnowledgeLatestOutputSummaryParts(t, {
      selectedMode: params.selectedOutputMode || "fast",
      domainGraphBuild: params.domainGraphBuild,
      qualityReview: params.qualityReview,
    }),
  };
}

export function buildProjectKnowledgeLatestSummaryModelFromState(
  t: TranslateFn,
  state: ProjectKnowledgeSummaryStateLike,
  selectedOutputMode?: ProjectKnowledgeProcessingMode,
): ProjectKnowledgeLatestSummaryModel {
  return buildProjectKnowledgeLatestSummaryModel(t, {
    selectedOutputMode: selectedOutputMode || state.outputResolution?.activeMode,
    sourceScan: state.sourceScanStats?.latest,
    fileAnalysis: state.fileAnalysisStats?.latest,
    domainGraphBuild: state.projectStepStats?.domain_graph_build?.latest,
    qualityReview: state.projectStepStats?.quality_review?.latest,
  });
}