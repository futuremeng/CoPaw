import { describe, expect, it } from "vitest";
import type { GraphVisualizationData } from "../../../api/types";
import {
  buildGraphDisplayData,
  summarizeGraphEntities,
} from "./graphVisualizationData";

function buildVisualizationData(): GraphVisualizationData {
  return {
    nodes: [
      { id: "entity-alpha", label: "Alpha", title: "Doc", type: "local_graph", score: 0.9, source_id: "s1", document_path: "a.md" },
      { id: "entity-beta", label: "Beta", title: "Doc", type: "local_graph", score: 0.8, source_id: "s1", document_path: "a.md" },
      { id: "entity-gamma", label: "Gamma", title: "Doc", type: "local_graph", score: 0.7, source_id: "s1", document_path: "a.md" },
    ],
    edges: [
      { id: "edge-1", source: "entity-alpha", target: "entity-beta", label: "uses", confidence: "20%" },
      { id: "edge-2", source: "entity-alpha", target: "entity-gamma", label: "owns", confidence: "80%" },
    ],
    summary: "summary",
    provenance: { engine: "local_graph" },
  };
}

describe("graph display helpers", () => {
  it("keeps all nodes visible after threshold filtering removes edges", () => {
    const data = buildGraphDisplayData(buildVisualizationData(), 0.9);

    expect(data.nodes).toHaveLength(3);
    expect(data.edges).toHaveLength(0);
    expect(data.isolatedNodeIds.sort()).toEqual([
      "entity-alpha",
      "entity-beta",
      "entity-gamma",
    ]);
  });

  it("summarizes connected and top entities from filtered graph data", () => {
    const displayData = buildGraphDisplayData(buildVisualizationData(), 0.5);
    const summary = summarizeGraphEntities(displayData);

    expect(summary.totalNodes).toBe(3);
    expect(summary.connectedNodes).toBe(2);
    expect(summary.isolatedNodes).toBe(1);
    expect(summary.topEntities[0]).toMatchObject({
      id: "entity-alpha",
      label: "Alpha",
      degree: 1,
    });
  });
});