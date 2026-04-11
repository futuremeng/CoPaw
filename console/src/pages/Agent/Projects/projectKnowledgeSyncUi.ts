import type { ProjectKnowledgeSyncState } from "../../../api/types";

type Translate = (key: string, options?: Record<string, unknown>) => string;

function formatSyncTime(raw: string | null | undefined): string {
  if (!raw) {
    return "";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  const hh = String(parsed.getHours()).padStart(2, "0");
  const mm = String(parsed.getMinutes()).padStart(2, "0");
  const ss = String(parsed.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function getGraphStats(syncState: ProjectKnowledgeSyncState): {
  relationCount: number;
  nodeCount: number;
} | null {
  const memify = syncState.last_result?.memify;
  if (!memify || typeof memify !== "object") {
    return null;
  }
  const relationCount = Number((memify as { relation_count?: unknown }).relation_count);
  const nodeCount = Number((memify as { node_count?: unknown }).node_count);
  if (!Number.isFinite(relationCount) || relationCount <= 0) {
    return null;
  }
  return {
    relationCount,
    nodeCount: Number.isFinite(nodeCount) ? nodeCount : 0,
  };
}

export function getProjectKnowledgeSyncStageLabel(
  syncState: ProjectKnowledgeSyncState,
  t: Translate,
): string {
  const stage = String(syncState.current_stage || syncState.status || "idle").trim() || "idle";
  return t(`projects.knowledge.syncStage.${stage}`);
}

export function getProjectKnowledgeSyncAlertDescription(
  syncState: ProjectKnowledgeSyncState,
  t: Translate,
): string {
  const graphStats = getGraphStats(syncState);
  const segments = [
    getProjectKnowledgeSyncStageLabel(syncState, t),
    `${syncState.progress ?? 0}%`,
    graphStats
      ? t("projects.knowledge.syncGraphStats", {
          nodes: graphStats.nodeCount,
          relations: graphStats.relationCount,
        })
      : "",
    syncState.changed_count > 0
      ? t("projects.knowledge.syncChangedCount", { count: syncState.changed_count })
      : "",
    syncState.status === "queued" && syncState.scheduled_for
      ? t("projects.knowledge.syncScheduledFor", {
          time: formatSyncTime(syncState.scheduled_for),
        })
      : "",
    syncState.last_trigger
      ? t("projects.knowledge.syncTrigger", {
          trigger: syncState.last_trigger,
        })
      : "",
    syncState.last_error || "",
  ].filter(Boolean);

  return segments.join(" · ");
}

export function getProjectKnowledgeSyncAlertType(
  syncState: ProjectKnowledgeSyncState | null,
): "info" | "success" | "error" {
  if (!syncState) {
    return "info";
  }
  if (syncState.status === "failed") {
    return "error";
  }
  if (syncState.status === "succeeded") {
    return "success";
  }
  return "info";
}