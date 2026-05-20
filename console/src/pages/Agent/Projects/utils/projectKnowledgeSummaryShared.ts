import type {
  ProjectKnowledgeProcessingMode,
  ProjectKnowledgeStepStatsRecord,
} from "../../../../api/types";

export type TranslateFn = (...args: any[]) => any;

export type ProjectKnowledgeStatsLike = ProjectKnowledgeStepStatsRecord | Record<string, never> | null | undefined;
export type ProjectKnowledgeStatsHistoryLike = ProjectKnowledgeStepStatsRecord[] | null | undefined;

export interface ProjectKnowledgeSummaryStateLike {
  sourceScanStats?: { latest?: ProjectKnowledgeStatsLike; history?: ProjectKnowledgeStatsHistoryLike } | null;
  fileAnalysisStats?: { latest?: ProjectKnowledgeStatsLike; history?: ProjectKnowledgeStatsHistoryLike } | null;
  projectStepStats?: {
    build_interlinear?: { latest?: ProjectKnowledgeStatsLike; history?: ProjectKnowledgeStatsHistoryLike } | null;
    tokenize?: { latest?: ProjectKnowledgeStatsLike; history?: ProjectKnowledgeStatsHistoryLike } | null;
    pos_tagging?: { latest?: ProjectKnowledgeStatsLike; history?: ProjectKnowledgeStatsHistoryLike } | null;
    syntax_parse?: { latest?: ProjectKnowledgeStatsLike; history?: ProjectKnowledgeStatsHistoryLike } | null;
    semantic_role_labeling?: { latest?: ProjectKnowledgeStatsLike; history?: ProjectKnowledgeStatsHistoryLike } | null;
  } | null;
  outputResolution?: {
    activeMode?: ProjectKnowledgeProcessingMode;
  } | null;
}

export interface ProjectKnowledgeRecentHistoryItem {
  key: string;
  timestamp: string;
  summary: string;
}

export interface ProjectKnowledgeRecentHistorySection {
  key: "snapshot_raw" | "build_chunks" | "build_interlinear" | "tokenize" | "pos_tagging" | "syntax_parse" | "semantic_role_labeling";
  title: string;
  hint: string;
  items: ProjectKnowledgeRecentHistoryItem[];
}