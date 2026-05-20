import type { ProjectKnowledgePipelineState } from "../../../api/types/knowledge";

export type BuiltinRuntimeStage = {
  key: string;
  label: string;
  labelKey?: string;
  status: string;
  summary: string;
  progress?: number | null;
  legacyMapped?: boolean;
};

export function deriveBuiltinProjectKnowledgeStages(
  syncState: ProjectKnowledgePipelineState | null,
): BuiltinRuntimeStage[] {
  const workflowStatus = String(syncState?.status || "idle").trim().toLowerCase();
  const stageToken = String(syncState?.current_stage || syncState?.stage || "").trim().toLowerCase();
  const hasIndexedResult = Boolean(
    syncState?.last_result && typeof syncState.last_result === "object" && (syncState.last_result as Record<string, unknown>).index,
  );

  const nlpStages = syncState?.nlp_progress?.stages;
  const nlpTotalChunks = Number(syncState?.nlp_progress?.total_chunks || 0);
  const hasLegacyNlpStages = Boolean(
    nlpStages?.tokenize || nlpStages?.ner || nlpStages?.cor || nlpStages?.syntax || nlpStages?.phrase,
  );
  const workflowProgress = Number(syncState?.progress || 0);
  const stageMessage = String(syncState?.stage_message || "").trim();

  const stageIncludesAny = (...tokens: string[]): boolean => tokens.some((token) => stageToken.includes(token));
  const runningOrPending = (status: string): boolean => ["running", "pending", "indexing", "graphifying", "queued"].includes(status);
  const isDoneStatus = (status: string): boolean => ["succeeded", "failed"].includes(status);

  const tokenizeDone = Number(nlpStages?.tokenize?.done_chunks || 0);
  const nerReady = Number(nlpStages?.ner?.ready_chunks || 0);
  const corReady = Number(nlpStages?.cor?.ready_chunks || 0);
  const syntaxReady = Number(nlpStages?.syntax?.ready_chunks || 0);

  const legacyNlpPeak = Math.max(tokenizeDone, nerReady, corReady, syntaxReady);

  const canonicalStages: Array<{ key: string; aliases: string[] }> = [
    { key: "snapshot_raw", aliases: ["snapshot_raw"] },
    { key: "build_chunks", aliases: ["build_chunks", "index"] },
    { key: "build_interlinear", aliases: ["build_interlinear"] },
    { key: "tokenize", aliases: ["tokenize"] },
    { key: "pos_tagging", aliases: ["pos_tagging", "pos", "ner", "cor"] },
    { key: "syntax_parse", aliases: ["syntax_parse", "syntax", "phrase", "graphify"] },
    { key: "semantic_role_labeling", aliases: ["semantic_role_labeling", "srl"] },
  ];

  const activeIndex = canonicalStages.findIndex((stage) => stage.aliases.some((token) => stageIncludesAny(token)));

  const computeStageStatus = (index: number): string => {
    const isActive = activeIndex === index;
    const passed = activeIndex > index;

    if (isActive) {
      return workflowStatus === "failed" ? "failed" : "running";
    }
    if (passed) {
      return "ready";
    }
    if (isDoneStatus(workflowStatus)) {
      return "ready";
    }
    if (index <= 2 && hasIndexedResult) {
      return "ready";
    }
    if (hasLegacyNlpStages && index >= 3 && index <= 5) {
      return "ready";
    }
    return runningOrPending(workflowStatus) ? "pending" : "idle";
  };

  const buildChunkSummary = (doneChunks?: number, readyChunks?: number): string => {
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

  const toProgress = (value: number): number | null => {
    if (nlpTotalChunks <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((value / nlpTotalChunks) * 100)));
  };

  const legacyChunkByStep: Record<string, number> = {
    tokenize: tokenizeDone,
    pos_tagging: Math.max(nerReady, corReady),
    syntax_parse: syntaxReady,
  };

  return canonicalStages.map((stage, index): BuiltinRuntimeStage => {
    const status = computeStageStatus(index);
    const isActive = activeIndex === index;
    const legacyChunkCount = legacyChunkByStep[stage.key] ?? legacyNlpPeak;
    const progress = isActive
      ? Math.max(0, Math.min(100, Math.round(workflowProgress)))
      : (stage.key in legacyChunkByStep ? toProgress(legacyChunkCount) : null);

    let summary = status === "ready" ? "ready" : status;
    if (isActive && stageMessage) {
      summary = stageMessage;
    } else if (stage.key in legacyChunkByStep && hasLegacyNlpStages) {
      summary = buildChunkSummary(legacyChunkCount, legacyChunkCount);
    }

    return {
      key: stage.key,
      label: stage.key,
      labelKey: `copaw.pipelines.builtinRuntimeStage.${stage.key}`,
      status,
      summary,
      progress,
      legacyMapped: hasLegacyNlpStages && index >= 3 && index <= 5,
    };
  });
}
