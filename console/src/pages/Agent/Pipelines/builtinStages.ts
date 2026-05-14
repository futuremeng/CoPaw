import type { ProjectKnowledgeSyncState } from "../../../api/types/knowledge";

export type BuiltinRuntimeStage = {
  key: string;
  label: string;
  status: string;
  summary: string;
  progress?: number | null;
};

function normalizeBuiltinStageStatus(status: string | undefined): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (["ready", "running", "pending", "failed", "blocked", "idle"].includes(normalized)) {
    return normalized;
  }
  if (normalized === "unavailable") {
    return "blocked";
  }
  return "idle";
}

export function deriveBuiltinProjectKnowledgeStages(
  syncState: ProjectKnowledgeSyncState | null,
): BuiltinRuntimeStage[] {
  const workflowStatus = String(syncState?.status || "idle").trim().toLowerCase();
  const stageToken = String(syncState?.current_stage || syncState?.stage || "").trim().toLowerCase();
  const hasIndexedResult = Boolean(
    syncState?.last_result && typeof syncState.last_result === "object" && (syncState.last_result as Record<string, unknown>).index,
  );

  const fileAnalysisStatus = stageToken.includes("file_analysis")
    ? (workflowStatus === "failed" ? "failed" : "running")
    : (hasIndexedResult || ["graphifying", "succeeded", "failed"].includes(workflowStatus) ? "ready" : "idle");
  const sourceScanStatus = stageToken.includes("source_scan")
    ? (workflowStatus === "failed" ? "failed" : "running")
    : (hasIndexedResult || ["graphifying", "succeeded", "failed"].includes(workflowStatus) ? "ready" : "idle");

  const nlpStages = syncState?.nlp_progress?.stages;
  const nlpTotalChunks = Number(syncState?.nlp_progress?.total_chunks || 0);

  const buildNlpSummary = (doneChunks?: number, readyChunks?: number): string => {
    const done = Number(doneChunks || 0);
    const ready = Number(readyChunks || 0);
    if (nlpTotalChunks > 0) {
      return `${Math.max(done, ready)}/${nlpTotalChunks}`;
    }
    if (done > 0 || ready > 0) {
      return `${Math.max(done, ready)} chunks`;
    }
    return "-";
  };

  const tokenizeStatus = normalizeBuiltinStageStatus(nlpStages?.tokenize?.status);
  const nerStatus = normalizeBuiltinStageStatus(nlpStages?.ner?.status);
  const corStatus = normalizeBuiltinStageStatus(nlpStages?.cor?.status);
  const syntaxStatus = normalizeBuiltinStageStatus(nlpStages?.syntax?.status);

  const tokenizeDone = Number(nlpStages?.tokenize?.done_chunks || 0);
  const nerReady = Number(nlpStages?.ner?.ready_chunks || 0);
  const corReady = Number(nlpStages?.cor?.ready_chunks || 0);
  const syntaxReady = Number(nlpStages?.syntax?.ready_chunks || 0);

  const toProgress = (value: number): number | null => {
    if (nlpTotalChunks <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((value / nlpTotalChunks) * 100)));
  };

  return [
    {
      key: "file_analysis",
      label: "file_analysis",
      status: fileAnalysisStatus,
      summary: stageToken.includes("file_analysis") ? "running" : (hasIndexedResult ? "ready" : "pending"),
    },
    {
      key: "source_scan",
      label: "source_scan",
      status: sourceScanStatus,
      summary: stageToken.includes("source_scan") ? "running" : (hasIndexedResult ? "ready" : "pending"),
    },
    {
      key: "tokenize",
      label: "tokenize",
      status: tokenizeStatus,
      summary: buildNlpSummary(tokenizeDone, tokenizeDone),
      progress: toProgress(tokenizeDone),
    },
    {
      key: "ner",
      label: "ner",
      status: nerStatus,
      summary: buildNlpSummary(undefined, nerReady),
      progress: toProgress(nerReady),
    },
    {
      key: "cor",
      label: "cor",
      status: corStatus,
      summary: buildNlpSummary(undefined, corReady),
      progress: toProgress(corReady),
    },
    {
      key: "syntax",
      label: "syntax",
      status: syntaxStatus,
      summary: buildNlpSummary(undefined, syntaxReady),
      progress: toProgress(syntaxReady),
    },
  ];
}
