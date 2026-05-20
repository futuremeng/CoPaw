import { describe, expect, it } from "vitest";
import {
  buildProjectKnowledgeLatestSummaryModel,
  buildProjectKnowledgeLatestSummaryModelFromState,
} from "./utils/projectKnowledgeLatestSummaryModel";

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

    expect(buildProjectKnowledgeLatestSummaryModel(t, {
      selectedOutputMode: "agentic",
      snapshotRaw,
      buildChunks,
      buildInterlinear,
      tokenize,
      posTagging,
      syntaxParse,
      semanticRoleLabeling,
    })).toEqual({
      l1Parts: [
        expect.stringContaining("scan"),
        expect.stringContaining("analysis"),
      ],
      l23Parts: [
        expect.stringContaining("interlinear"),
        expect.stringContaining("tokenize"),
        expect.stringContaining("pos"),
        expect.stringContaining("syntax"),
        expect.stringContaining("srl"),
      ],
      workflowParts: [
        expect.stringContaining("scan"),
        expect.stringContaining("analysis"),
        expect.stringContaining("interlinear"),
        expect.stringContaining("tokenize"),
        expect.stringContaining("pos"),
        expect.stringContaining("syntax"),
        expect.stringContaining("srl"),
      ],
      outputParts: [
        expect.stringContaining("syntax provenance"),
        expect.stringContaining("srl outcome"),
      ],
    });
  });

  it("builds latest summary parts from knowledge state-like input", () => {
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

    expect(buildProjectKnowledgeLatestSummaryModelFromState(t, {
      sourceScanStats: { latest: snapshotRaw },
      fileAnalysisStats: { latest: buildChunks },
      projectStepStats: {
        build_interlinear: { latest: buildInterlinear },
        tokenize: { latest: tokenize },
        pos_tagging: { latest: posTagging },
        syntax_parse: { latest: syntaxParse },
        semantic_role_labeling: { latest: semanticRoleLabeling },
      },
      outputResolution: { activeMode: "agentic" },
    })).toEqual({
      l1Parts: [
        expect.stringContaining("scan"),
        expect.stringContaining("analysis"),
      ],
      l23Parts: [
        expect.stringContaining("interlinear"),
        expect.stringContaining("tokenize"),
        expect.stringContaining("pos"),
        expect.stringContaining("syntax"),
        expect.stringContaining("srl"),
      ],
      workflowParts: [
        expect.stringContaining("scan"),
        expect.stringContaining("analysis"),
        expect.stringContaining("interlinear"),
        expect.stringContaining("tokenize"),
        expect.stringContaining("pos"),
        expect.stringContaining("syntax"),
        expect.stringContaining("srl"),
      ],
      outputParts: [
        expect.stringContaining("syntax provenance"),
        expect.stringContaining("srl outcome"),
      ],
    });
  });

  it("skips empty latest records", () => {
    expect(buildProjectKnowledgeLatestSummaryModel(t, {
      selectedOutputMode: "fast",
      snapshotRaw: {},
      buildChunks: null,
      buildInterlinear: null,
      tokenize: null,
      posTagging: null,
      syntaxParse: null,
      semanticRoleLabeling: null,
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
        build_interlinear: { latest: {} },
        tokenize: { latest: null },
        pos_tagging: { latest: null },
        syntax_parse: { latest: null },
        semantic_role_labeling: null,
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