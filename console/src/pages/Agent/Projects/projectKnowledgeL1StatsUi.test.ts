import { describe, expect, it } from "vitest";
import {
  buildProjectKnowledgeLatestL1SummaryParts,
  buildProjectKnowledgeLatestL23SummaryParts,
  buildProjectKnowledgeLatestOutputSummaryParts,
  formatProjectKnowledgeStatsRecordTimestamp,
  summarizeProjectKnowledgeDomainGraphBuildStats,
  summarizeProjectKnowledgeFileAnalysisStats,
  summarizeProjectKnowledgeQualityReviewStats,
  summarizeProjectKnowledgeSourceScanStats,
} from "./projectKnowledgeL1StatsUi";

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

describe("projectKnowledgeL1StatsUi", () => {
  it("formats source_scan and file_analysis summaries", () => {
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

    expect(formatProjectKnowledgeStatsRecordTimestamp(sourceScan)).toMatch(/05\/12/);
    expect(summarizeProjectKnowledgeSourceScanStats(t, sourceScan)).toBe("5 files / 2 changed / 1 sources");
    expect(summarizeProjectKnowledgeFileAnalysisStats(t, fileAnalysis)).toBe("3 docs / 7 chunks / 11 sentences");
    expect(summarizeProjectKnowledgeDomainGraphBuildStats(t, domainGraphBuild)).toBe("3 docs / 9 nodes / 12 relations");
    expect(summarizeProjectKnowledgeQualityReviewStats(t, qualityReview)).toBe("0.91 -> 0.95 / delta 0.04 / 1 rounds");
    expect(buildProjectKnowledgeLatestL1SummaryParts(t, { sourceScan, fileAnalysis })).toEqual([
      expect.stringContaining("scan"),
      expect.stringContaining("analysis"),
    ]);
    expect(buildProjectKnowledgeLatestL23SummaryParts(t, { domainGraphBuild, qualityReview })).toEqual([
      expect.stringContaining("graph"),
      expect.stringContaining("review"),
    ]);
    expect(buildProjectKnowledgeLatestOutputSummaryParts(t, {
      selectedMode: "nlp",
      domainGraphBuild,
      qualityReview,
    })).toEqual([
      expect.stringContaining("graph provenance"),
    ]);
    expect(buildProjectKnowledgeLatestOutputSummaryParts(t, {
      selectedMode: "agentic",
      domainGraphBuild,
      qualityReview,
    })).toEqual([
      expect.stringContaining("graph provenance"),
      expect.stringContaining("review outcome"),
    ]);
  });

  it("skips empty latest records", () => {
    expect(buildProjectKnowledgeLatestL1SummaryParts(t, { sourceScan: {}, fileAnalysis: null })).toEqual([]);
    expect(buildProjectKnowledgeLatestL23SummaryParts(t, { domainGraphBuild: {}, qualityReview: null })).toEqual([]);
    expect(buildProjectKnowledgeLatestOutputSummaryParts(t, {
      selectedMode: "fast",
      domainGraphBuild: {},
      qualityReview: null,
    })).toEqual([]);
  });
});