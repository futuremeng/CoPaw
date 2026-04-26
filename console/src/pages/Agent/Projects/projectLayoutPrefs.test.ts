import { describe, expect, it } from "vitest";
import {
  buildProjectLayoutStorageKey,
  defaultProjectLayoutPrefs,
  parseProjectLayoutPrefs,
  PROJECT_LAYOUT_PREFS_PREFIX,
} from "./projectLayoutPrefs";

describe("project layout prefs", () => {
  it("builds storage key with project id", () => {
    expect(buildProjectLayoutStorageKey("project-1")).toBe(
      `${PROJECT_LAYOUT_PREFS_PREFIX}project-1`,
    );
  });

  it("falls back to default key suffix when project id is empty", () => {
    expect(buildProjectLayoutStorageKey("")).toBe(
      `${PROJECT_LAYOUT_PREFS_PREFIX}default`,
    );
  });

  it("returns defaults for null or invalid payload", () => {
    expect(parseProjectLayoutPrefs(null)).toEqual(defaultProjectLayoutPrefs());
    expect(parseProjectLayoutPrefs("{" )).toEqual(defaultProjectLayoutPrefs());
  });

  it("restores persisted knowledge module collapse and other fields", () => {
    const payload = {
      leftPanelCollapsed: false,
      activeStage: "knowledge",
      knowledgeModuleCollapsed: true,
      selectedMetricFilter: "knowledgeCandidates",
      treeDisplayMode: "highlight",
      treeExpandedKeys: ["original", "original/docs"],
      selectedTreeFilePath: "original/docs/guide.md",
    };

    expect(parseProjectLayoutPrefs(JSON.stringify(payload))).toEqual({
      ...defaultProjectLayoutPrefs(),
      ...payload,
    });
  });

  it("fills missing fields with defaults for backward compatibility", () => {
    const parsed = parseProjectLayoutPrefs(
      JSON.stringify({
        leftPanelCollapsed: false,
        activeStage: "output",
      }),
    );

    expect(parsed.leftPanelCollapsed).toBe(false);
    expect(parsed.activeStage).toBe("output");
    expect(parsed.knowledgeModuleCollapsed).toBe(false);
    expect(parsed.selectedMetricFilter).toBe("");
    expect(parsed.treeDisplayMode).toBe("filter");
    expect(parsed.treeExpandedKeys).toEqual([]);
    expect(parsed.selectedTreeFilePath).toBe("");
  });

  it("drops invalid tree persistence payload while keeping valid string entries", () => {
    const parsed = parseProjectLayoutPrefs(
      JSON.stringify({
        treeExpandedKeys: ["original", 123, "", "original/docs"],
        selectedTreeFilePath: 99,
      }),
    );

    expect(parsed.treeExpandedKeys).toEqual(["original", "original/docs"]);
    expect(parsed.selectedTreeFilePath).toBe("");
  });
});
