import type {
  KnowledgeHistoryBackfillProgress,
  KnowledgeTaskProgress,
} from "../../../api/types";

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
  activeTasks?: KnowledgeTaskProgress[];
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

  const activeTask = (input.activeTasks || []).find((task) =>
    ["pending", "running", "queued", "indexing", "graphifying"].includes(
      String(task.status || ""),
    ),
  );
  if (activeTask) {
    const percent = Math.max(
      0,
      Math.min(100, Math.round(Number(activeTask.percent ?? activeTask.progress ?? 0))),
    );
    const current = Number(activeTask.current ?? 0);
    const total = Number(activeTask.total ?? 0);
    const detail = total > 0 ? ` (${current}/${total})` : "";
    return {
      visible: true,
      percent,
      status: "active",
      labelDefault: `${activeTask.stage_message || activeTask.current_stage || activeTask.task_type || "Knowledge task running"}${detail}`,
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
