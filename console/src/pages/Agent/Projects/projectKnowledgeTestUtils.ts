import type { ProjectKnowledgeModeState } from "./useProjectKnowledgeState";

export function buildModeState(
  overrides: Partial<ProjectKnowledgeModeState> = {},
): ProjectKnowledgeModeState {
  return {
    mode: "fast",
    status: "ready",
    available: true,
    progress: null,
    stage: "Fast preview ready",
    summary: "秒级预览，优先保障可用性。",
    lastUpdatedAt: "",
    runId: "",
    jobId: "",
    documentCount: 1,
    chunkCount: 2,
    entityCount: 0,
    relationCount: 0,
    qualityScore: null,
    ...overrides,
  };
}