import { describe, expect, it, vi } from "vitest";

const mockedAgentsApi = vi.hoisted(() => ({
  queryProjectFiles: vi.fn(),
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
  isPathReadonly,
} from "../adapters";

describe("projectWorkspaceAdapter path behavior", () => {
  it("passes dot paths through project read api", async () => {
    mockedAgentsApi.readProjectFile.mockResolvedValue({
      content: "dot",
    });

    const adapter = createProjectWorkspaceAdapter({
      scope: "project",
      agentId: "agent-1",
      projectId: "proj-1",
    });

    await adapter.readText(".agent/AGENTS.md");
    expect(mockedAgentsApi.readProjectFile).toHaveBeenCalledWith(
      "agent-1",
      "proj-1",
      ".agent/AGENTS.md",
    );
  });

  it("marks intermediate and output paths readonly by default", async () => {
    mockedWorkspaceApi.listCodeFiles.mockResolvedValue([
      {
        filename: "a.ts",
        path: "intermediate/a.ts",
        size: 1,
        created_time: "2026-05-28T00:00:00Z",
        modified_time: "2026-05-28T00:00:00Z",
      },
      {
        filename: "b.md",
        path: "original/b.md",
        size: 1,
        created_time: "2026-05-28T00:00:00Z",
        modified_time: "2026-05-28T00:00:00Z",
      },
    ]);

    const adapter = createProjectWorkspaceAdapter({ scope: "workspace" });
    const output = await adapter.queryFiles({});

    const intermediate = output.items.find((item) => item.path === "intermediate/a.ts");
    const original = output.items.find((item) => item.path === "original/b.md");
    expect(intermediate?.readonly).toBe(true);
    expect(original?.readonly).toBe(false);
  });

  it("can detect readonly path with helper", () => {
    expect(isPathReadonly("output/result.json")).toBe(true);
    expect(isPathReadonly("original/notes.md")).toBe(false);
  });
});
