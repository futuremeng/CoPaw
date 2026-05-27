import { describe, expect, it } from "vitest";

import { deriveBuiltinProjectKnowledgeStages } from "./builtinStages.ts";

describe("deriveBuiltinProjectKnowledgeStages", () => {
  it("returns canonical seven stages with idle/pending defaults", () => {
    const stages = deriveBuiltinProjectKnowledgeStages(null);

    expect(stages).toHaveLength(7);
    expect(stages.map((item) => item.key)).toEqual([
      "snapshot_raw",
      "build_chunks",
      "build_interlinear",
      "tokenize",
      "pos_tagging",
      "syntax_parse",
      "semantic_role_labeling",
    ]);
    expect(stages.every((item) => item.status === "idle" || item.status === "pending")).toBe(true);
  });

  it("maps legacy nlp runtime into canonical tokenize/pos/syntax stages", () => {
    const stages = deriveBuiltinProjectKnowledgeStages({
      project_id: "project-a",
      status: "graphifying",
      current_stage: "syntax",
      progress: 40,
      auto_enabled: true,
      dirty: false,
      dirty_after_run: false,
      last_trigger: "manual",
      changed_paths: [],
      pending_changed_paths: [],
      changed_count: 0,
      last_error: "",
      latest_job_id: "",
      latest_source_id: "project-a-workspace",
      last_result: {
        index: {
          document_count: 2,
        },
      },
      nlp_progress: {
        mode: "nlp",
        status: "running",
        total_chunks: 10,
        stages: {
          tokenize: {
            key: "tokenize",
            required: true,
            status: "ready",
            done_chunks: 10,
          },
          ner: {
            key: "ner",
            required: true,
            status: "running",
            ready_chunks: 4,
          },
          cor: {
            key: "cor",
            required: true,
            status: "pending",
            ready_chunks: 0,
          },
          syntax: {
            key: "syntax",
            required: true,
            status: "running",
            ready_chunks: 3,
          },
        },
      },
    });

    const snapshotRaw = stages.find((item) => item.key === "snapshot_raw");
    const buildChunks = stages.find((item) => item.key === "build_chunks");
    const buildInterlinear = stages.find((item) => item.key === "build_interlinear");
    const tokenize = stages.find((item) => item.key === "tokenize");
    const posTagging = stages.find((item) => item.key === "pos_tagging");
    const syntaxParse = stages.find((item) => item.key === "syntax_parse");
    const srl = stages.find((item) => item.key === "semantic_role_labeling");

    expect(snapshotRaw?.status).toBe("ready");
    expect(buildChunks?.status).toBe("ready");
    expect(buildInterlinear?.status).toBe("ready");
    expect(tokenize?.status).toBe("ready");
    expect(tokenize?.summary).toBe("ready");
    expect(tokenize?.legacyMapped).toBe(false);
    expect(posTagging?.status).toBe("ready");
    expect(posTagging?.summary).toBe("ready");
    expect(posTagging?.legacyMapped).toBe(false);
    expect(syntaxParse?.status).toBe("running");
    expect(syntaxParse?.progress).toBe(40);
    expect(syntaxParse?.summary).toBe("running");
    expect(syntaxParse?.legacyMapped).toBe(false);
    expect(srl?.status).toBe("pending");
  });
});
