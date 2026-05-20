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
} from "../utils/projectKnowledgeL1StatsUi";

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
  it("formats canonical 7-step summaries", () => {
    const snapshotRaw = {
      project_id: "project-abc",
      source_id: "project-project-abc-workspace",
      step_id: "snapshot_raw",
      updated_at: "2026-05-12T10:21:00Z",
      metrics: {
        data_file_count: 5,
        changed_path_count: 2,
        source_count: 1,
      },
    };
    const buildChunks = {
      project_id: "project-abc",
      source_id: "project-project-abc-workspace",
      step_id: "build_chunks",
      updated_at: "2026-05-12T10:31:00Z",
      metrics: {
        document_count: 3,
        chunk_count: 7,
        sentence_count: 11,
      },
    };
    const buildInterlinear = {
      project_id: "project-abc",
      source_id: "project-project-abc-workspace",
      step_id: "build_interlinear",
      updated_at: "2026-05-12T10:36:00Z",
      metrics: {
        document_count: 3,
        chunk_count: 7,
        sentence_count: 11,
      },
    };
    const tokenize = {
      project_id: "project-abc",
      source_id: "project-project-abc-workspace",
      step_id: "tokenize",
      updated_at: "2026-05-12T10:41:00Z",
      metrics: {
        document_count: 3,
        chunk_count: 7,
        sentence_count: 11,
      },
    };
    const posTagging = {
      project_id: "project-abc",
      source_id: "project-project-abc-workspace",
      step_id: "pos_tagging",
      updated_at: "2026-05-12T10:46:00Z",
      metrics: {
        document_count: 3,
        chunk_count: 7,
        sentence_count: 11,
      },
    };
    const syntaxParse = {
      project_id: "project-abc",
      source_id: "project-project-abc-workspace",
      step_id: "syntax_parse",
      updated_at: "2026-05-12T10:51:00Z",
      metrics: {
        document_count: 3,
        node_count: 9,
        relation_count: 12,
      },
    };
    const semanticRoleLabeling = {
      project_id: "project-abc",
      source_id: "project-project-abc-workspace",
      step_id: "semantic_role_labeling",
      updated_at: "2026-05-12T10:56:00Z",
      metrics: {
        quality_score_before: 0.91,
        quality_score_after: 0.95,
        quality_delta: 0.04,
        quality_rounds: 1,
      },
    };

    expect(formatProjectKnowledgeStatsRecordTimestamp(snapshotRaw)).toMatch(/05\/12/);
    expect(summarizeProjectKnowledgeSourceScanStats(t, snapshotRaw)).toBe("5 files / 2 changed / 1 sources");
    expect(summarizeProjectKnowledgeFileAnalysisStats(t, buildChunks)).toBe("3 docs / 7 chunks / 11 sentences");
    expect(summarizeProjectKnowledgeDomainGraphBuildStats(t, syntaxParse)).toBe("3 docs / 9 nodes / 12 relations");
    expect(summarizeProjectKnowledgeQualityReviewStats(t, semanticRoleLabeling)).toBe("0.91 -> 0.95 / delta 0.04 / 1 rounds");
    expect(buildProjectKnowledgeLatestL1SummaryParts(t, { snapshotRaw, buildChunks })).toEqual([
      expect.stringContaining("scan"),
      expect.stringContaining("analysis"),
    ]);
    expect(buildProjectKnowledgeLatestL23SummaryParts(t, { buildInterlinear, tokenize, posTagging, syntaxParse, semanticRoleLabeling })).toEqual([
      expect.stringContaining("interlinear"),
      expect.stringContaining("tokenize"),
      expect.stringContaining("pos"),
      expect.stringContaining("syntax"),
      expect.stringContaining("srl"),
    ]);
    expect(buildProjectKnowledgeLatestOutputSummaryParts(t, {
      selectedMode: "nlp",
      syntaxParse,
      semanticRoleLabeling,
    })).toEqual([
      expect.stringContaining("syntax provenance"),
    ]);
    expect(buildProjectKnowledgeLatestOutputSummaryParts(t, {
      selectedMode: "agentic",
      syntaxParse,
      semanticRoleLabeling,
    })).toEqual([
      expect.stringContaining("syntax provenance"),
      expect.stringContaining("srl outcome"),
    ]);
  });

  it("skips empty latest records", () => {
    expect(buildProjectKnowledgeLatestL1SummaryParts(t, { snapshotRaw: {}, buildChunks: null })).toEqual([]);
    expect(buildProjectKnowledgeLatestL23SummaryParts(t, { buildInterlinear: {}, tokenize: null, posTagging: null, syntaxParse: null, semanticRoleLabeling: null })).toEqual([]);
    expect(buildProjectKnowledgeLatestOutputSummaryParts(t, {
      selectedMode: "fast",
      syntaxParse: {},
      semanticRoleLabeling: null,
    })).toEqual([]);
  });
});