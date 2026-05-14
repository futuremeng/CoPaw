import { afterEach, describe, expect, it, vi } from "vitest";
import { knowledgeApi } from "./knowledge";

vi.mock("../request", () => ({ request: vi.fn() }));

import { request } from "../request";

describe("knowledgeApi.getProjectStepStats", () => {
  afterEach(() => vi.clearAllMocks());

  it("requests the generic project step stats endpoint with project_id and limit", async () => {
    vi.mocked(request).mockResolvedValue({
      project_id: "project-a",
      step_id: "file_analysis",
      latest: {},
      history: [],
    });

    await knowledgeApi.getProjectStepStats("file_analysis", "project-a", { limit: 3 });

    expect(request).toHaveBeenCalledWith(
      "/knowledge/project-stats/file_analysis?limit=3&project_id=project-a",
    );
  });
});

describe("knowledgeApi.getProjectFileAnalysisStats", () => {
  afterEach(() => vi.clearAllMocks());

  it("requests the file_analysis stats endpoint with project_id and limit", async () => {
    vi.mocked(request).mockResolvedValue({
      project_id: "project-a",
      step_id: "file_analysis",
      latest: {},
      history: [],
    });

    await knowledgeApi.getProjectFileAnalysisStats("project-a", { limit: 15 });

    expect(request).toHaveBeenCalledWith(
      "/knowledge/project-stats/file_analysis?limit=15&project_id=project-a",
    );
  });

  it("requests the file_analysis stats endpoint without limit when omitted", async () => {
    vi.mocked(request).mockResolvedValue({
      project_id: "project-a",
      step_id: "file_analysis",
      latest: {},
      history: [],
    });

    await knowledgeApi.getProjectFileAnalysisStats("project-a");

    expect(request).toHaveBeenCalledWith(
      "/knowledge/project-stats/file_analysis?project_id=project-a",
    );
  });
});

describe("knowledgeApi.getProjectSourceScanStats", () => {
  afterEach(() => vi.clearAllMocks());

  it("requests the source_scan stats endpoint with project_id and limit", async () => {
    vi.mocked(request).mockResolvedValue({
      project_id: "project-a",
      step_id: "source_scan",
      latest: {},
      history: [],
    });

    await knowledgeApi.getProjectSourceScanStats("project-a", { limit: 10 });

    expect(request).toHaveBeenCalledWith(
      "/knowledge/project-stats/source_scan?limit=10&project_id=project-a",
    );
  });
});

describe("knowledgeApi.graphQuery", () => {
  afterEach(() => vi.clearAllMocks());

  it("serializes scope filter params for graph query", async () => {
    vi.mocked(request).mockResolvedValue({
      records: [],
      summary: "",
      provenance: {},
      warnings: [],
    });

    await knowledgeApi.graphQuery({
      query: "demo",
      mode: "template",
      topK: 20,
      timeoutSec: 30,
      scopeType: "project",
      scopeId: "project-123",
      projectScope: ["project-123"],
      includeGlobal: false,
      projectId: "project-123",
    });

    expect(request).toHaveBeenCalledWith(
      "/knowledge/graph-query?q=demo&mode=template&top_k=20&timeout_sec=30&scope_type=project&scope_id=project-123&project_scope=project-123&include_global=false&project_id=project-123",
    );
  });
});