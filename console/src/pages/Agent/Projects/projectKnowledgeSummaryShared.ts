import type {
  ProjectKnowledgeProcessingMode,
  ProjectKnowledgeStepStatsRecord,
} from "../../../api/types";

export type TranslateFn = (
  key: string,
  maybeFallbackOrOptions?: string | Record<string, unknown>,
  maybeOptions?: Record<string, unknown>,
) => string;

export type ProjectKnowledgeStatsLike = ProjectKnowledgeStepStatsRecord | Record<string, never> | null | undefined;
export type ProjectKnowledgeStatsHistoryLike = ProjectKnowledgeStepStatsRecord[] | null | undefined;

export interface ProjectKnowledgeSummaryStateLike {
  sourceScanStats?: { latest?: ProjectKnowledgeStatsLike; history?: ProjectKnowledgeStatsHistoryLike } | null;
  fileAnalysisStats?: { latest?: ProjectKnowledgeStatsLike; history?: ProjectKnowledgeStatsHistoryLike } | null;
  projectStepStats?: {
    domain_graph_build?: { latest?: ProjectKnowledgeStatsLike; history?: ProjectKnowledgeStatsHistoryLike } | null;
    quality_review?: { latest?: ProjectKnowledgeStatsLike; history?: ProjectKnowledgeStatsHistoryLike } | null;
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
  key: "source_scan" | "file_analysis" | "domain_graph_build" | "quality_review";
  title: string;
  hint: string;
  items: ProjectKnowledgeRecentHistoryItem[];
}