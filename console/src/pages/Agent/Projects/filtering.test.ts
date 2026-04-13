import { describe, expect, it } from "vitest";
import {
  getProjectFilterLabelDescriptor,
  toggleProjectFileFilter,
} from "./filtering";

describe("project filtering helpers", () => {
  it("toggles project file filter on repeated click", () => {
    expect(toggleProjectFileFilter("", "original")).toBe("original");
    expect(toggleProjectFileFilter("original", "original")).toBe("");
    expect(toggleProjectFileFilter("original", "text")).toBe("text");
  });

  it("maps filter keys to i18n label descriptors", () => {
    expect(getProjectFilterLabelDescriptor("original")).toEqual({
      i18nKey: "projects.filesOriginal",
      defaultLabel: "Original Files",
    });
    expect(getProjectFilterLabelDescriptor("intermediate")).toEqual({
      i18nKey: "projects.filesIntermediate",
      defaultLabel: "Intermediate Files",
    });
    expect(getProjectFilterLabelDescriptor("script")).toEqual({
      i18nKey: "projects.quantScriptFiles",
      defaultLabel: "脚本 (.py)",
    });
    expect(getProjectFilterLabelDescriptor("agent")).toEqual({
      i18nKey: "projects.filesAgent",
      defaultLabel: "智能体",
    });
  });
});
