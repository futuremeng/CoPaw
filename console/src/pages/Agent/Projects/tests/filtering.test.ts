import { describe, expect, it } from "vitest";
import {
  getProjectFilterLabelDescriptor,
  toggleProjectFileFilter,
} from "../utils/filtering";
import { t } from "./enLocaleTranslate";

describe("project filtering helpers", () => {
  it("toggles project file filter on repeated click", () => {
    expect(toggleProjectFileFilter("", "original")).toBe("original");
    expect(toggleProjectFileFilter("original", "original")).toBe("");
    expect(toggleProjectFileFilter("original", "text")).toBe("text");
  });

  it("maps filter keys to i18n label descriptors", () => {
    expect(getProjectFilterLabelDescriptor("original")).toEqual({
      i18nKey: "projects.filesOriginal",
    });
    expect(getProjectFilterLabelDescriptor("intermediate")).toEqual({
      i18nKey: "projects.filesIntermediate",
    });
    expect(getProjectFilterLabelDescriptor("script")).toEqual({
      i18nKey: "projects.quantScriptFiles",
    });
    expect(getProjectFilterLabelDescriptor("agent")).toEqual({
      i18nKey: "projects.filesAgent",
    });
  });

  it("ships bundle copy for every filter label", () => {
    const filters = [
      "original",
      "intermediate",
      "artifact",
      "agent",
      "skill",
      "flow",
      "case",
      "builtin",
      "markdown",
      "text",
      "script",
      "otherType",
    ] as const;
    const seen = new Set<string>();
    for (const filter of filters) {
      const { i18nKey } = getProjectFilterLabelDescriptor(filter);
      seen.add(i18nKey);
      const label = t(i18nKey);
      expect(label).not.toBe(i18nKey);
      expect(label.length).toBeGreaterThan(0);
    }
    expect(seen.size).toBe(12);
    // The descriptor's default branch is the one label the switch above cannot reach.
    expect(t("projects.files")).not.toBe("projects.files");
  });
});
