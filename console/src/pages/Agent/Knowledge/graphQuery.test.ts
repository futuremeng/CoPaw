import { describe, expect, it } from "vitest";
import type { GraphQueryRecord } from "../../../api/types";
import {
  limitGraphVisualizationRecords,
  recordsToVisualizationData,
} from "./graphQuery";

function buildRecord(partial: Partial<GraphQueryRecord>): GraphQueryRecord {
  return {
    subject: "Alpha",
    predicate: "relates_to",
    object: "Beta",
    score: 0.92,
    source_id: "source-1",
    source_type: "local_graph",
    document_path: "docs/a.md",
    document_title: "Doc A",
    ...partial,
  };
}

describe("recordsToVisualizationData", () => {
  it("limits graph visualization source records by topK before rendering", () => {
    const records = [
      buildRecord({ subject: "Alpha" }),
      buildRecord({ subject: "Beta" }),
      buildRecord({ subject: "Gamma" }),
    ];

    expect(limitGraphVisualizationRecords(records, 2).map((item) => item.subject)).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(limitGraphVisualizationRecords(records, Number.NaN)).toHaveLength(3);
  });

  it("falls back to plain-text object targets and merges shared entities", () => {
    const data = recordsToVisualizationData(
      [
        buildRecord({ subject: "Alpha", predicate: "uses", object: "Beta" }),
        buildRecord({ subject: "Beta", predicate: "depends_on", object: "Gamma；Delta" }),
      ],
      "summary",
      {},
    );

    expect(data.nodes.map((node) => node.id).sort()).toEqual([
      "entity-alpha",
      "entity-beta",
      "entity-delta",
      "entity-gamma",
    ]);
    expect(data.edges.map((edge) => `${edge.source}->${edge.target}:${edge.label}`).sort()).toEqual([
      "entity-alpha->entity-beta:uses",
      "entity-beta->entity-delta:depends_on",
      "entity-beta->entity-gamma:depends_on",
    ]);
  });

  it("keeps structured arrow relations when object contains graph syntax", () => {
    const data = recordsToVisualizationData(
      [
        buildRecord({
          subject: "Agent",
          object: "Agent --implements[88%]--> Workflow",
          predicate: "ignored_when_arrow_present",
        }),
      ],
      "summary",
      {},
    );

    expect(data.nodes.map((node) => node.id).sort()).toEqual([
      "entity-agent",
      "entity-workflow",
    ]);
    expect(data.edges).toHaveLength(1);
    expect(data.edges[0]).toMatchObject({
      source: "entity-agent",
      target: "entity-workflow",
      label: "implements",
      confidence: "88%",
    });
  });
});