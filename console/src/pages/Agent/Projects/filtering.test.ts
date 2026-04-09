import { describe, expect, it } from "vitest";
import {
  getProjectFilterLabelDescriptor,
  toggleProjectFileFilter,
} from "./filtering";

describe("project filtering helpers", () => {
  it("toggles project file filter on repeated click", () => {
    expect(toggleProjectFileFilter("", "original")).toBe("original");
    expect(toggleProjectFileFilter("original", "original")).toBe("");
    expect(toggleProjectFileFilter("original", "markdown")).toBe("markdown");
  });

  it("maps filter keys to i18n label descriptors", () => {
    expect(getProjectFilterLabelDescriptor("original")).toEqual({
      i18nKey: "projects.filesOriginal",
      defaultLabel: "Original Files",
    });
    expect(getProjectFilterLabelDescriptor("skills")).toEqual({
      i18nKey: "projects.artifacts.skill",
      defaultLabel: "Skills",
    });
    expect(getProjectFilterLabelDescriptor("knowledgeCandidates")).toEqual({
      i18nKey: "projects.quantKnowledgeCandidates",
      defaultLabel: "Knowledge Candidates",
    });
    expect(getProjectFilterLabelDescriptor("recent")).toEqual({
      i18nKey: "projects.quantRecentlyUpdated",
      defaultLabel: "Updated in 7d",
    });
  });
});
