import { describe, expect, it } from "vitest";

import { deriveBuiltinProjectKnowledgeStages } from "./builtinStages.ts";

describe("deriveBuiltinProjectKnowledgeStages", () => {
  it("returns six detailed stages with idle defaults", () => {
    const stages = deriveBuiltinProjectKnowledgeStages(null);

    expect(stages).toHaveLength(6);
    expect(stages.map((item) => item.key)).toEqual([
      "file_analysis",
      "source_scan",
      "tokenize",
      "ner",
      "cor",
      "syntax",
    ]);
    expect(stages.every((item) => item.status === "idle" || item.status === "pending")).toBe(true);
  });

  it("maps nlp stage status and progress from sync payload", () => {
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

    const tokenize = stages.find((item) => item.key === "tokenize");
    const ner = stages.find((item) => item.key === "ner");
    const syntax = stages.find((item) => item.key === "syntax");

    expect(tokenize?.status).toBe("ready");
    expect(tokenize?.progress).toBe(100);
    expect(ner?.status).toBe("running");
    expect(ner?.progress).toBe(40);
    expect(syntax?.status).toBe("running");
    expect(syntax?.summary).toBe("3/10");
  });
});
