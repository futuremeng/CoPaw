import type { KnowledgeHistoryBackfillProgress } from "../../../api/types";

export interface UnifiedBatchProgressViewModel {
  visible: boolean;
  percent: number;
  status: "active" | "normal";
  labelI18nKey?: string;
  labelDefault?: string;
  labelParams?: Record<string, number | string>;
}

export interface BuildUnifiedBatchProgressInput {
  indexingAll: boolean;
  backfillProgress: KnowledgeHistoryBackfillProgress | null;
  backfillingHistory: boolean;
  clearingKnowledge: boolean;
}

export function buildUnifiedBatchProgress(
  input: BuildUnifiedBatchProgressInput,
): UnifiedBatchProgressViewModel {
  if (input.indexingAll) {
    return {
      visible: true,
      percent: 0,
      status: "active",
      labelI18nKey: "knowledge.unifiedProgressIndexAll",
      labelDefault: "Rebuilding all indexes...",
    };
  }

  if (input.backfillProgress?.running) {
    const total = Math.max(1, input.backfillProgress.total_sessions || 1);
    const traversed = Math.max(
      0,
      Math.min(total, input.backfillProgress.traversed_sessions || 0),
    );
    return {
      visible: true,
      percent: Math.round((traversed / total) * 100),
      status: "active",
      labelI18nKey: "knowledge.unifiedProgressBackfill",
      labelDefault: "Backfilling history {{traversed}}/{{total}}",
      labelParams: { traversed, total },
    };
  }

  if (input.backfillingHistory) {
    return {
      visible: true,
      percent: 0,
      status: "active",
      labelI18nKey: "knowledge.unifiedProgressBackfillStarting",
      labelDefault: "Preparing backfill...",
    };
  }

  if (input.clearingKnowledge) {
    return {
      visible: true,
      percent: 0,
      status: "active",
      labelI18nKey: "knowledge.unifiedProgressClearing",
      labelDefault: "Clearing knowledge data...",
    };
  }

  return {
    visible: false,
    percent: 0,
    status: "normal",
  };
}
