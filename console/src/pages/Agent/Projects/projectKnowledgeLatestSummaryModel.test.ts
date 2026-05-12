import { describe, expect, it } from "vitest";
import {
  buildProjectKnowledgeLatestSummaryModel,
  buildProjectKnowledgeLatestSummaryModelFromState,
} from "./projectKnowledgeLatestSummaryModel";

const t = (
  _key: string,
  maybeFallbackOrOptions?: string | Record<string, unknown>,
  maybeOptions?: Record<string, unknown>,
): string => {
  const fallback = typeof maybeFallbackOrOptions === "string" ? maybeFallbackOrOptions : "";
  const options = (typeof maybeFallbackOrOptions === "object"
    ? maybeFallbackOrOptions
    : maybeOptions) as Record<string, unknown> | undefined;
  return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ""));
};

describe("projectKnowledgeLatestSummaryModel", () => {
  it("builds latest summary parts from direct step inputs", () => {
    const sourceScan = {
      project_id: "project-abc",
      source_id: "project-project-abc-workspace",
      step_id: "source_scan",
      updated_at: "2026-05-12T10:21:00Z",
      metrics: {
        data_file_count: 5,
        changed_path_count: 2,
        source_count: 1,
      },
    };
    const fileAnalysis = {
      project_id: "project-abc",
      source_id: "project-project-abc-workspace",
      step_id: "file_analysis",
      updated_at: "2026-05-12T10:31:00Z",
      metrics: {
        document_count: 3,
        chunk_count: 7,
        sentence_count: 11,
      },
    };
    const domainGraphBuild = {
      project_id: "project-abc",
      source_id: "project-project-abc-workspace",
      step_id: "domain_graph_build",
      updated_at: "2026-05-12T10:41:00Z",
      metrics: {
        document_count: 3,
        node_count: 9,
        relation_count: 12,
      },
    };
    const qualityReview = {
      project_id: "project-abc",
      source_id: "project-project-abc-workspace",
      step_id: "quality_review",
      updated_at: "2026-05-12T10:51:00Z",
      metrics: {
        quality_score_before: 0.91,
        quality_score_after: 0.95,
        quality_delta: 0.04,
        quality_rounds: 1,
      },
    };

    expect(buildProjectKnowledgeLatestSummaryModel(t, {
      selectedOutputMode: "agentic",
      sourceScan,
      fileAnalysis,
      domainGraphBuild,
      qualityReview,
    })).toEqual({
      l1Parts: [
        expect.stringContaining("scan"),
        expect.stringContaining("analysis"),
      ],
      l23Parts: [
        expect.stringContaining("graph"),
        expect.stringContaining("review"),
      ],
      workflowParts: [
        expect.stringContaining("scan"),
        expect.stringContaining("analysis"),
        expect.stringContaining("graph"),
        expect.stringContaining("review"),
      ],
      outputParts: [
        expect.stringContaining("graph provenance"),
        expect.stringContaining("review outcome"),
      ],
    });
  });

  it("builds latest summary parts from knowledge state-like input", () => {
    const sourceScan = {
      project_id: "project-abc",
      source_id: "project-project-abc-workspace",
      step_id: "source_scan",
      updated_at: "2026-05-12T10:21:00Z",
      metrics: {
        data_file_count: 5,
        changed_path_count: 2,
        source_count: 1,
      },
    };
    const fileAnalysis = {
      project_id: "project-abc",
      source_id: "project-project-abc-workspace",
      step_id: "file_analysis",
      updated_at: "2026-05-12T10:31:00Z",
      metrics: {
        document_count: 3,
        chunk_count: 7,
        sentence_count: 11,
      },
    };
    const domainGraphBuild = {
      project_id: "project-abc",
      source_id: "project-project-abc-workspace",
      step_id: "domain_graph_build",
      updated_at: "2026-05-12T10:41:00Z",
      metrics: {
        document_count: 3,
        node_count: 9,
        relation_count: 12,
      },
    };
    const qualityReview = {
      project_id: "project-abc",
      source_id: "project-project-abc-workspace",
      step_id: "quality_review",
      updated_at: "2026-05-12T10:51:00Z",
      metrics: {
        quality_score_before: 0.91,
        quality_score_after: 0.95,
        quality_delta: 0.04,
        quality_rounds: 1,
      },
    };

    expect(buildProjectKnowledgeLatestSummaryModelFromState(t, {
      sourceScanStats: { latest: sourceScan },
      fileAnalysisStats: { latest: fileAnalysis },
      projectStepStats: {
        domain_graph_build: { latest: domainGraphBuild },
        quality_review: { latest: qualityReview },
      },
      outputResolution: { activeMode: "agentic" },
    })).toEqual({
      l1Parts: [
        expect.stringContaining("scan"),
        expect.stringContaining("analysis"),
      ],
      l23Parts: [
        expect.stringContaining("graph"),
        expect.stringContaining("review"),
      ],
      workflowParts: [
        expect.stringContaining("scan"),
        expect.stringContaining("analysis"),
        expect.stringContaining("graph"),
        expect.stringContaining("review"),
      ],
      outputParts: [
        expect.stringContaining("graph provenance"),
        expect.stringContaining("review outcome"),
      ],
    });
  });

  it("skips empty latest records", () => {
    expect(buildProjectKnowledgeLatestSummaryModel(t, {
      selectedOutputMode: "fast",
      sourceScan: {},
      fileAnalysis: null,
      domainGraphBuild: {},
      qualityReview: null,
    })).toEqual({
      l1Parts: [],
      l23Parts: [],
      workflowParts: [],
      outputParts: [],
    });
    expect(buildProjectKnowledgeLatestSummaryModelFromState(t, {
      sourceScanStats: { latest: {} },
      fileAnalysisStats: null,
      projectStepStats: {
        domain_graph_build: { latest: {} },
        quality_review: null,
      },
      outputResolution: { activeMode: "fast" },
    })).toEqual({
      l1Parts: [],
      l23Parts: [],
      workflowParts: [],
      outputParts: [],
    });
  });
});