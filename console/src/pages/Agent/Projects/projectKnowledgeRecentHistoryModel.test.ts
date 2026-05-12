import { describe, expect, it } from "vitest";
import {
  buildProjectKnowledgeProcessingRecentHistorySections,
  buildProjectKnowledgeProcessingRecentHistorySectionsFromState,
  buildProjectKnowledgeSourcesRecentHistorySections,
  buildProjectKnowledgeSourcesRecentHistorySectionsFromState,
} from "./projectKnowledgeRecentHistoryModel";

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

describe("projectKnowledgeRecentHistoryModel", () => {
  it("builds processing recent history sections", () => {
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

    expect(buildProjectKnowledgeProcessingRecentHistorySections(t, {
      sourceScanHistory: [sourceScan],
      fileAnalysisHistory: [fileAnalysis],
      domainGraphBuildHistory: [domainGraphBuild],
      qualityReviewHistory: [qualityReview],
    })).toEqual([
      {
        key: "source_scan",
        title: "最近扫描",
        hint: "来自 source_scan 项目统计文件",
        items: [
          {
            key: expect.any(String),
            timestamp: expect.stringContaining("05/12"),
            summary: "5 files / 2 changed / 1 sources",
          },
        ],
      },
      {
        key: "file_analysis",
        title: "最近 L1 运行",
        hint: "来自 file_analysis 项目统计文件",
        items: [
          {
            key: expect.any(String),
            timestamp: expect.stringContaining("05/12"),
            summary: "3 docs / 7 chunks / 11 sentences",
          },
        ],
      },
      {
        key: "domain_graph_build",
        title: "最近 L2 图构建",
        hint: "来自 domain_graph_build 项目统计文件",
        items: [
          {
            key: expect.any(String),
            timestamp: expect.stringContaining("05/12"),
            summary: "3 docs / 9 nodes / 12 relations",
          },
        ],
      },
      {
        key: "quality_review",
        title: "最近 L3 质量审校",
        hint: "来自 quality_review 项目统计文件",
        items: [
          {
            key: expect.any(String),
            timestamp: expect.stringContaining("05/12"),
            summary: "0.91 -> 0.95 / delta 0.04 / 1 rounds",
          },
        ],
      },
    ]);

    expect(buildProjectKnowledgeProcessingRecentHistorySectionsFromState(t, {
      sourceScanStats: { history: [sourceScan] },
      fileAnalysisStats: { history: [fileAnalysis] },
      projectStepStats: {
        domain_graph_build: { history: [domainGraphBuild] },
        quality_review: { history: [qualityReview] },
      },
    })).toHaveLength(4);
  });

  it("builds sources recent history sections", () => {
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

    expect(buildProjectKnowledgeSourcesRecentHistorySections(t, {
      sourceScanHistory: [sourceScan],
      fileAnalysisHistory: [fileAnalysis],
    })).toEqual([
      {
        key: "source_scan",
        title: "最近扫描",
        hint: "最近的 source_scan 项目统计",
        items: [
          {
            key: expect.any(String),
            timestamp: expect.stringContaining("05/12"),
            summary: "5 files / 2 changed / 1 sources",
          },
        ],
      },
      {
        key: "file_analysis",
        title: "最近 L1 运行",
        hint: "最近的 file_analysis 项目统计",
        items: [
          {
            key: expect.any(String),
            timestamp: expect.stringContaining("05/12"),
            summary: "3 docs / 7 chunks / 11 sentences",
          },
        ],
      },
    ]);

    expect(buildProjectKnowledgeSourcesRecentHistorySectionsFromState(t, {
      sourceScanStats: { history: [sourceScan] },
      fileAnalysisStats: { history: [fileAnalysis] },
    })).toHaveLength(2);
  });
});