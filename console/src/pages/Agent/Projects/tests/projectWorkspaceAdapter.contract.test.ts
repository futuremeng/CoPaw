import { describe, expect, it, vi } from "vitest";

const mockedAgentsApi = vi.hoisted(() => ({
  queryProjectFiles: vi.fn(),
  getProjectFileSummary: vi.fn(),
  listProjectFileTree: vi.fn(),
  readProjectFile: vi.fn(),
  createProjectDirectory: vi.fn(),
  moveProjectPath: vi.fn(),
  deleteProjectPath: vi.fn(),
  uploadProjectFile: vi.fn(),
  getProjectBinaryFileUrl: vi.fn(),
}));

const mockedWorkspaceApi = vi.hoisted(() => ({
  listCodeFiles: vi.fn(),
  loadCodeFile: vi.fn(),
  saveCodeFile: vi.fn(),
  uploadFile: vi.fn(),
  getBinaryFileUrl: vi.fn(),
  getWatchUrl: vi.fn(),
}));

vi.mock("../../../../api/modules/agents", () => ({
  agentsApi: mockedAgentsApi,
}));

vi.mock("../../../../api/modules/workspace", () => ({
  workspaceApi: mockedWorkspaceApi,
}));

vi.mock("../../../../api/authHeaders", () => ({
  buildAuthHeaders: () => ({}),
}));

import {
  createProjectWorkspaceAdapter,
  normalizeAdapterError,
} from "../adapters";

describe("projectWorkspaceAdapter contract", () => {
  it("creates project-scoped adapter and maps query output", async () => {
    mockedAgentsApi.queryProjectFiles.mockResolvedValueOnce({
      items: [
        {
          filename: "README.md",
          path: "original/README.md",
          size: 42,
          modified_time: "2026-05-28T00:00:00Z",
          stage: "original",
          content_type: "markdown",
          builtin: false,
          ignored: false,
        },
      ],
      summary: {
        total_matched: 1,
        offset: 0,
        limit: 10,
        returned: 1,
        builtin_count: 0,
        ignored_count: 0,
        stage_counts: { original: 1 },
        content_type_counts: { markdown: 1 },
      },
      query_meta: {
        search: "",
        path_prefix: "",
        stages: [],
        content_types: [],
        include_builtin: false,
        include_ignored: false,
        sort_by: "path",
        sort_order: "asc",
      },
    });
    mockedAgentsApi.getProjectFileSummary.mockResolvedValueOnce({
      total_files: 1,
      builtin_files: 0,
      visible_files: 1,
      original_files: 1,
      derived_files: 0,
      knowledge_candidate_files: 1,
      markdown_files: 1,
      text_like_files: 1,
      recently_updated_files: 1,
    });

    const adapter = createProjectWorkspaceAdapter({
      scope: "project",
      agentId: "agent-1",
      projectId: "proj-1",
    });
    const output = await adapter.queryFiles({ limit: 10 });
    const summary = await adapter.getFileSummary();

    expect(output.summary.totalMatched).toBe(1);
    expect(summary.total_files).toBe(1);
    expect(output.items[0].path).toBe("original/README.md");
    expect(output.items[0].readonly).toBe(false);
    expect(mockedAgentsApi.queryProjectFiles).toHaveBeenCalledWith(
      "agent-1",
      "proj-1",
      expect.objectContaining({ limit: 10 }),
    );
  });

  it("creates workspace-scoped adapter and maps list/query output", async () => {
    mockedWorkspaceApi.listCodeFiles.mockResolvedValue([
      {
        filename: "a.md",
        path: "original/a.md",
        size: 4,
        created_time: "2026-05-28T00:00:00Z",
        modified_time: "2026-05-28T00:00:00Z",
      },
      {
        filename: "b.ts",
        path: "intermediate/b.ts",
        size: 8,
        created_time: "2026-05-28T00:00:00Z",
        modified_time: "2026-05-28T00:00:00Z",
      },
    ]);
    mockedWorkspaceApi.loadCodeFile.mockResolvedValue({
      path: "original/a.md",
      content: "hello",
    });
    mockedWorkspaceApi.getBinaryFileUrl.mockReturnValue("/api/workspace/binary-files/a.md");

    const adapter = createProjectWorkspaceAdapter({ scope: "workspace" });
    const query = await adapter.queryFiles({ search: "a" });
    const tree = await adapter.listTree("");
    const read = await adapter.readText("original/a.md");

    expect(query.items.length).toBe(2);
    const markdownItem = query.items.find((item) => item.path === "original/a.md");
    expect(markdownItem?.contentType).toBe("markdown");
    expect(markdownItem?.readonly).toBe(false);
    expect(tree.length).toBe(2);
    expect(read.content).toBe("hello");
    expect(adapter.getBinaryUrl("original/a.md")).toBe("/api/workspace/binary-files/a.md");
  });

  it("throws on project scope when required ids are missing", () => {
    expect(() => createProjectWorkspaceAdapter({ scope: "project" })).toThrow();
  });

  it("normalizes adapter error object", () => {
    const err = new Error("boom") as Error & { status?: number };
    err.status = 413;

    const normalized = normalizeAdapterError(err);
    expect(normalized.status).toBe(413);
    expect(normalized.message).toBe("boom");
  });
});
