import { describe, expect, it } from "vitest";
import {
  buildProjectKnowledgeProcessingRecentHistorySections,
  buildProjectKnowledgeProcessingRecentHistorySectionsFromState,
  buildProjectKnowledgeSourcesRecentHistorySections,
  buildProjectKnowledgeSourcesRecentHistorySectionsFromState,
} from "../utils/projectKnowledgeRecentHistoryModel";

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

    expect(buildProjectKnowledgeProcessingRecentHistorySections(t, {
      snapshotRawHistory: [snapshotRaw],
      buildChunksHistory: [buildChunks],
      buildInterlinearHistory: [buildInterlinear],
      tokenizeHistory: [tokenize],
      posTaggingHistory: [posTagging],
      syntaxParseHistory: [syntaxParse],
      semanticRoleLabelingHistory: [semanticRoleLabeling],
    })).toEqual([
      {
        key: "snapshot_raw",
        title: "最近原始快照",
        hint: "来自 snapshot_raw 项目统计文件",
        items: [
          {
            key: expect.any(String),
            timestamp: expect.stringContaining("05/12"),
            summary: "5 files / 2 changed / 1 sources",
          },
        ],
      },
      {
        key: "build_chunks",
        title: "最近切块构建",
        hint: "来自 build_chunks 项目统计",
        items: [
          {
            key: expect.any(String),
            timestamp: expect.stringContaining("05/12"),
            summary: "3 docs / 7 chunks / 11 sentences",
          },
        ],
      },
      {
        key: "build_interlinear",
        title: "最近 interlinear 构建",
        hint: "来自 build_interlinear 项目统计",
        items: [
          {
            key: expect.any(String),
            timestamp: expect.stringContaining("05/12"),
            summary: "3 docs / 7 chunks / 11 sentences",
          },
        ],
      },
      {
        key: "tokenize",
        title: "最近分词运行",
        hint: "来自 tokenize 项目统计",
        items: [
          {
            key: expect.any(String),
            timestamp: expect.stringContaining("05/12"),
            summary: "3 docs / 7 chunks / 11 sentences",
          },
        ],
      },
      {
        key: "pos_tagging",
        title: "最近词性标注",
        hint: "来自 pos_tagging 项目统计",
        items: [
          {
            key: expect.any(String),
            timestamp: expect.stringContaining("05/12"),
            summary: "3 docs / 7 chunks / 11 sentences",
          },
        ],
      },
      {
        key: "syntax_parse",
        title: "最近句法解析",
        hint: "来自 syntax_parse 项目统计",
        items: [
          {
            key: expect.any(String),
            timestamp: expect.stringContaining("05/12"),
            summary: "3 docs / 9 nodes / 12 relations",
          },
        ],
      },
      {
        key: "semantic_role_labeling",
        title: "最近 SRL 运行",
        hint: "来自 semantic_role_labeling 项目统计",
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
      sourceScanStats: { history: [snapshotRaw] },
      fileAnalysisStats: { history: [buildChunks] },
      projectStepStats: {
        build_interlinear: { history: [buildInterlinear] },
        tokenize: { history: [tokenize] },
        pos_tagging: { history: [posTagging] },
        syntax_parse: { history: [syntaxParse] },
        semantic_role_labeling: { history: [semanticRoleLabeling] },
      },
    })).toHaveLength(7);
  });

  it("builds sources recent history sections", () => {
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

    expect(buildProjectKnowledgeSourcesRecentHistorySections(t, {
      sourceScanHistory: [snapshotRaw],
      fileAnalysisHistory: [buildChunks],
    })).toEqual([
      {
        key: "snapshot_raw",
        title: "最近原始快照",
        hint: "最近的 snapshot_raw 项目统计",
        items: [
          {
            key: expect.any(String),
            timestamp: expect.stringContaining("05/12"),
            summary: "5 files / 2 changed / 1 sources",
          },
        ],
      },
      {
        key: "build_chunks",
        title: "最近切块运行",
        hint: "最近的 build_chunks 项目统计",
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
      sourceScanStats: { history: [snapshotRaw] },
      fileAnalysisStats: { history: [buildChunks] },
    })).toHaveLength(2);
  });
});