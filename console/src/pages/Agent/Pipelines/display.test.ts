import { describe, expect, it } from "vitest";

import { formatPipelineDateTime, getCanonicalStageLabel } from "./display.ts";

describe("pipelines display helpers", () => {
  it("formats missing or invalid timestamps", () => {
    expect(formatPipelineDateTime()).toBe("-");
    expect(formatPipelineDateTime("not-a-date")).toBe("not-a-date");
  });

  it("labels canonical stages", () => {
    expect(getCanonicalStageLabel("semantic_role_labeling")).toBe("Semantic Role Labeling");
    expect(getCanonicalStageLabel("custom_stage")).toBe("Custom Stage");
  });
});