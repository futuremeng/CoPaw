import { describe, expect, it } from "vitest";

import type { FlowDefinition } from "../../../api/types/flows";
import {
  filterCompatibleFlowDefinitions,
  getFlowDefinitionCompatibilityIssues,
  getStructuredErrorSummary,
  humanizeFlowKey,
  isKnowledgeFlowDefinition,
  sortFlowDefinitions,
} from "./viewModel.ts";

const buildDefinition = (partial?: Partial<FlowDefinition>): FlowDefinition => ({
  id: "knowledge.project.pipeline",
  name: "Knowledge Project Pipeline",
  version: "1.0.0",
  description: "Built-in project knowledge orchestration.",
  steps: [
    {
      id: "snapshot_raw",
      name: "Snapshot Raw",
      kind: "task",
      executor: "knowledge.snapshot",
      description: "Collect source files.",
      depends_on: [],
      retry_policy: {},
    },
    {
      id: "build_chunks",
      name: "Build Chunks",
      kind: "task",
      executor: "knowledge.chunk",
      description: "Chunk source files.",
      depends_on: ["snapshot_raw"],
      retry_policy: {},
    },
  ],
  tags: ["builtin", "knowledge", "project"],
  system_owned: true,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...partial,
});

describe("pipelines view model", () => {
  it("filters out incompatible definitions", () => {
    const compatible = buildDefinition();
    const incompatible = buildDefinition({
      id: "broken.definition",
      steps: [
        {
          id: "broken",
          name: "Broken",
          kind: "",
          executor: "",
          description: "",
          depends_on: ["missing_step"],
          retry_policy: {},
        },
      ],
    });

    expect(filterCompatibleFlowDefinitions([compatible, incompatible])).toEqual([compatible]);
    expect(getFlowDefinitionCompatibilityIssues(incompatible)).toEqual([
      "step broken missing kind",
      "step broken depends on missing step:missing_step",
    ]);
  });

  it("sorts knowledge and system-owned definitions first", () => {
    const custom = buildDefinition({
      id: "custom.flow",
      name: "Custom Flow",
      tags: ["custom"],
      system_owned: false,
    });
    const builtin = buildDefinition({
      id: "builtin.flow",
      name: "Builtin Flow",
      tags: ["builtin", "project"],
    });

    const sorted = sortFlowDefinitions([custom, builtin, buildDefinition()]);
    expect(sorted.map((item) => item.id)).toEqual([
      "knowledge.project.pipeline",
      "builtin.flow",
      "custom.flow",
    ]);
    expect(isKnowledgeFlowDefinition(sorted[0])).toBe(true);
  });

  it("parses structured detail from request errors", () => {
    const error = new Error(
      "Conflict - {\"detail\":{\"error_code\":\"FLOW_TRANSITION_NOT_ALLOWED\",\"message\":\"Run cannot be resumed from succeeded\",\"recovery_hint\":\"Refresh status and retry on an active run\"}}",
    );

    expect(getStructuredErrorSummary(error)).toEqual({
      errorCode: "FLOW_TRANSITION_NOT_ALLOWED",
      errorSource: undefined,
      commandType: undefined,
      flowRunId: undefined,
      recoveryHint: "Refresh status and retry on an active run",
      message: "Run cannot be resumed from succeeded",
    });
  });

  it("humanizes stage and status keys", () => {
    expect(humanizeFlowKey("semantic_role_labeling")).toBe("Semantic Role Labeling");
  });
});