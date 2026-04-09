import type { KnowledgeSourceItem } from "../../../api/types";
import type { RemoteRetrySource, RemoteRetrySummary } from "./metrics";

export type RemoteRetryNoticeLevel = "success" | "warning" | "error" | "info";

export interface RemoteRetryNotice {
  level: RemoteRetryNoticeLevel;
  i18nKey: string;
  params?: Record<string, string | number>;
}

export function collectRemoteRetrySources(
  sources: KnowledgeSourceItem[],
): RemoteRetrySource[] {
  return sources
    .filter((source) => {
      const state = source.status.remote_cache_state;
      return typeof state === "string" && state.length > 0 && state !== "cached";
    })
    .map((source) => ({ id: source.id, name: source.name || source.id }));
}

export function buildRemoteRetryNotice(summary: RemoteRetrySummary): RemoteRetryNotice {
  if (summary.failedCount === 0) {
    return {
      level: "success",
      i18nKey: "knowledge.remoteRetrySuccess",
      params: { count: summary.successCount },
    };
  }

  const failedNames = summary.failedNames.slice(0, 3).join(", ");
  if (summary.successCount > 0) {
    return {
      level: "warning",
      i18nKey: "knowledge.remoteRetryPartial",
      params: {
        success: summary.successCount,
        failed: summary.failedCount,
        failedNames,
      },
    };
  }

  return {
    level: "error",
    i18nKey: "knowledge.remoteRetryAllFailed",
    params: {
      failed: summary.failedCount,
      failedNames,
    },
  };
}
