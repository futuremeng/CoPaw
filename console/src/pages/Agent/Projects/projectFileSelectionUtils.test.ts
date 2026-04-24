import { describe, expect, it } from "vitest";
import { isPreviewablePath } from "./projectFileSelectionUtils";

describe("project file selection utils", () => {
  it("allows project-managed hidden directories to be previewed", () => {
    expect(isPreviewablePath(".memories/baseline.md")).toBe(true);
    expect(isPreviewablePath(".agent/AGENTS.md")).toBe(true);
    expect(isPreviewablePath(".skills/demo/SKILL.md")).toBe(true);
    expect(isPreviewablePath(".data/source.txt")).toBe(true);
    expect(isPreviewablePath(".pipelines/templates/template.json")).toBe(true);
  });

  it("continues to block arbitrary hidden paths", () => {
    expect(isPreviewablePath(".env")).toBe(true);
    expect(isPreviewablePath(".cursor/rules.md")).toBe(false);
    expect(isPreviewablePath("docs/.drafts/notes.md")).toBe(false);
  });
});