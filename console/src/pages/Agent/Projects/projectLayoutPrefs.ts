import type { ProjectFileFilterKey } from "./filtering";

export type ProjectStageKey = "source" | "knowledge" | "output" | "builtin";
export type TreeDisplayMode = "filter" | "highlight";
export type KnowledgeDockTabKey = "explore" | "settings" | "signals" | "sources" | "insights";

function parsePaneSize(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

export interface ProjectDetailLayoutPrefs {
  leftPanelCollapsed: boolean;
  activeStage: ProjectStageKey;
  knowledgeModuleCollapsed: boolean;
  knowledgeDockTab: KnowledgeDockTabKey;
  selectedMetricFilter: ProjectFileFilterKey | "";
  treeDisplayMode: TreeDisplayMode;
  leftPaneSize: number;
  workbenchPaneSize: number;
  chatPaneSize: number;
  knowledgeDockSize: number;
}

export const PROJECT_LAYOUT_PREFS_PREFIX = "copaw:projects:detail:layout:";
const STAGE_KEYS: ProjectStageKey[] = ["source", "knowledge", "output", "builtin"];
const TREE_MODES: TreeDisplayMode[] = ["filter", "highlight"];

function parseStageKey(value: unknown, fallback: ProjectStageKey): ProjectStageKey {
  return typeof value === "string" && STAGE_KEYS.includes(value as ProjectStageKey)
    ? (value as ProjectStageKey)
    : fallback;
}

function parseTreeMode(value: unknown, fallback: TreeDisplayMode): TreeDisplayMode {
  return typeof value === "string" && TREE_MODES.includes(value as TreeDisplayMode)
    ? (value as TreeDisplayMode)
    : fallback;
}

export function buildProjectLayoutStorageKey(routeProjectId: string): string {
  return `${PROJECT_LAYOUT_PREFS_PREFIX}${routeProjectId || "default"}`;
}

export function defaultProjectLayoutPrefs(): ProjectDetailLayoutPrefs {
  return {
    leftPanelCollapsed: true,
    activeStage: "source",
    knowledgeModuleCollapsed: false,
    knowledgeDockTab: "explore",
    selectedMetricFilter: "",
    treeDisplayMode: "filter",
    leftPaneSize: 440,
    workbenchPaneSize: 620,
    chatPaneSize: 520,
    knowledgeDockSize: 320,
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
      activeStage: parseStageKey(parsed.activeStage, fallback.activeStage),
      knowledgeModuleCollapsed:
        parsed.knowledgeModuleCollapsed ?? fallback.knowledgeModuleCollapsed,
      knowledgeDockTab:
        parsed.knowledgeDockTab === "settings"
        || parsed.knowledgeDockTab === "signals"
        || parsed.knowledgeDockTab === "sources"
        || parsed.knowledgeDockTab === "insights"
          ? parsed.knowledgeDockTab
          : fallback.knowledgeDockTab,
      selectedMetricFilter:
        parsed.selectedMetricFilter ?? fallback.selectedMetricFilter,
      treeDisplayMode: parseTreeMode(parsed.treeDisplayMode, fallback.treeDisplayMode),
      leftPaneSize: parsePaneSize(parsed.leftPaneSize, fallback.leftPaneSize),
      workbenchPaneSize: parsePaneSize(
        parsed.workbenchPaneSize,
        fallback.workbenchPaneSize,
      ),
      chatPaneSize: parsePaneSize(parsed.chatPaneSize, fallback.chatPaneSize),
      knowledgeDockSize: parsePaneSize(
        parsed.knowledgeDockSize,
        fallback.knowledgeDockSize,
      ),
    };
  } catch {
    return fallback;
  }
}
