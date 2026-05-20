import type { ProjectKnowledgeProcessingMode } from "../../../../api/types";
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
    snapshotRaw?: ProjectKnowledgeStatsLike;
    buildChunks?: ProjectKnowledgeStatsLike;
    buildInterlinear?: ProjectKnowledgeStatsLike;
    tokenize?: ProjectKnowledgeStatsLike;
    posTagging?: ProjectKnowledgeStatsLike;
    syntaxParse?: ProjectKnowledgeStatsLike;
    semanticRoleLabeling?: ProjectKnowledgeStatsLike;
  },
): ProjectKnowledgeLatestSummaryModel {
  const l1Parts = buildProjectKnowledgeLatestL1SummaryParts(t, {
    snapshotRaw: params.snapshotRaw,
    buildChunks: params.buildChunks,
  });
  const l23Parts = buildProjectKnowledgeLatestL23SummaryParts(t, {
    buildInterlinear: params.buildInterlinear,
    tokenize: params.tokenize,
    posTagging: params.posTagging,
    syntaxParse: params.syntaxParse,
    semanticRoleLabeling: params.semanticRoleLabeling,
  });
  return {
    l1Parts,
    l23Parts,
    workflowParts: [...l1Parts, ...l23Parts],
    outputParts: buildProjectKnowledgeLatestOutputSummaryParts(t, {
      selectedMode: params.selectedOutputMode || "fast",
      syntaxParse: params.syntaxParse,
      semanticRoleLabeling: params.semanticRoleLabeling,
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
    snapshotRaw: state.sourceScanStats?.latest,
    buildChunks: state.fileAnalysisStats?.latest,
    buildInterlinear: state.projectStepStats?.build_interlinear?.latest,
    tokenize: state.projectStepStats?.tokenize?.latest,
    posTagging: state.projectStepStats?.pos_tagging?.latest,
    syntaxParse: state.projectStepStats?.syntax_parse?.latest,
    semanticRoleLabeling: state.projectStepStats?.semantic_role_labeling?.latest,
  });
}