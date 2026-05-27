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
  const workflowProgress = Number(syncState?.progress || 0);
  const stageMessage = String(syncState?.stage_message || "").trim();

  const stageIncludesAny = (...tokens: string[]): boolean => tokens.some((token) => stageToken.includes(token));
  const runningOrPending = (status: string): boolean => ["running", "pending", "indexing", "graphifying", "queued"].includes(status);
  const isDoneStatus = (status: string): boolean => ["succeeded", "failed"].includes(status);

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
    return runningOrPending(workflowStatus) ? "pending" : "idle";
  };

  return canonicalStages.map((stage, index): BuiltinRuntimeStage => {
    const status = computeStageStatus(index);
    const isActive = activeIndex === index;
    const progress = isActive ? Math.max(0, Math.min(100, Math.round(workflowProgress))) : null;

    let summary = status === "ready" ? "ready" : status;
    if (isActive && stageMessage) {
      summary = stageMessage;
    }

    return {
      key: stage.key,
      label: stage.key,
      labelKey: `copaw.pipelines.builtinRuntimeStage.${stage.key}`,
      status,
      summary,
      progress,
      legacyMapped: false,
    };
  });
}
