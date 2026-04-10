import type { ProjectFileFilterKey } from "./filtering";

export type ProjectStageKey = "source" | "knowledge" | "output";
export type TreeDisplayMode = "filter" | "highlight";

export interface ProjectDetailLayoutPrefs {
  leftPanelCollapsed: boolean;
  activeStage: ProjectStageKey;
  knowledgeModuleCollapsed: boolean;
  selectedMetricFilter: ProjectFileFilterKey | "";
  treeDisplayMode: TreeDisplayMode;
}

export const PROJECT_LAYOUT_PREFS_PREFIX = "copaw:projects:detail:layout:";

export function buildProjectLayoutStorageKey(routeProjectId: string): string {
  return `${PROJECT_LAYOUT_PREFS_PREFIX}${routeProjectId || "default"}`;
}

export function defaultProjectLayoutPrefs(): ProjectDetailLayoutPrefs {
  return {
    leftPanelCollapsed: true,
    activeStage: "source",
    knowledgeModuleCollapsed: false,
    selectedMetricFilter: "",
    treeDisplayMode: "filter",
  };
}

export function parseProjectLayoutPrefs(raw: string | null): ProjectDetailLayoutPrefs {
  const fallback = defaultProjectLayoutPrefs();
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ProjectDetailLayoutPrefs>;
    return {
      leftPanelCollapsed: parsed.leftPanelCollapsed ?? fallback.leftPanelCollapsed,
      activeStage: parsed.activeStage ?? fallback.activeStage,
      knowledgeModuleCollapsed:
        parsed.knowledgeModuleCollapsed ?? fallback.knowledgeModuleCollapsed,
      selectedMetricFilter:
        parsed.selectedMetricFilter ?? fallback.selectedMetricFilter,
      treeDisplayMode: parsed.treeDisplayMode ?? fallback.treeDisplayMode,
    };
  } catch {
    return fallback;
  }
}
