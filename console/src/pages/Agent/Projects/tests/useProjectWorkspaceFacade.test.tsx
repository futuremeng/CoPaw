import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useProjectWorkspaceFacade from "../hooks/useProjectWorkspaceFacade";

const {
  mockedCreateProjectWorkspaceAdapter,
  mockedNormalizeAdapterError,
  adapterFactory,
} = vi.hoisted(() => {
  const adapterFactoryInner = () => ({
    getScope: vi.fn().mockReturnValue("project"),
    getCapabilities: vi.fn().mockReturnValue({ supportsWatch: false }),
    queryFiles: vi.fn().mockResolvedValue({ items: [], summary: { totalMatched: 0, returned: 0, offset: 0, limit: 5000 } }),
    getFileSummary: vi.fn().mockResolvedValue({
      total_files: 0,
      builtin_files: 0,
      visible_files: 0,
      original_files: 0,
      derived_files: 0,
      knowledge_candidate_files: 0,
      markdown_files: 0,
      text_like_files: 0,
      recently_updated_files: 0,
    }),
    listTree: vi.fn().mockResolvedValue([]),
    readText: vi.fn().mockResolvedValue({ content: "" }),
    writeText: vi.fn().mockResolvedValue({ path: "" }),
    getBinaryUrl: vi.fn().mockReturnValue(""),
    mkdir: vi.fn().mockResolvedValue({ success: true, path: "" }),
    move: vi.fn().mockResolvedValue({ success: true, sourcePath: "", targetPath: "", isDirectory: false }),
    remove: vi.fn().mockResolvedValue({ success: true, path: "", isDirectory: false }),
    upload: vi.fn().mockResolvedValue(undefined),
    watch: vi.fn().mockReturnValue(() => undefined),
  });

  return {
    adapterFactory: adapterFactoryInner,
    mockedCreateProjectWorkspaceAdapter: vi.fn(),
    mockedNormalizeAdapterError: vi.fn().mockReturnValue({ message: "normalized" }),
  };
});

vi.mock("../adapters", () => ({
  createProjectWorkspaceAdapter: mockedCreateProjectWorkspaceAdapter,
  normalizeAdapterError: mockedNormalizeAdapterError,
}));

describe("useProjectWorkspaceFacade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedCreateProjectWorkspaceAdapter.mockImplementation(() => adapterFactory());
  });

  it("keeps facade method references stable when inputs do not change", () => {
    const { result, rerender } = renderHook((props: {
      agentId: string;
      projectId: string;
    }) => useProjectWorkspaceFacade({
      scope: "project",
      agentId: props.agentId,
      projectId: props.projectId,
    }), {
      initialProps: {
        agentId: "agent-1",
        projectId: "proj-1",
      },
    });

    const firstFacade = result.current;
    const firstAdapter = result.current.adapter;

    rerender({ agentId: "agent-1", projectId: "proj-1" });

    expect(result.current.adapter).toBe(firstAdapter);
    expect(result.current).toBe(firstFacade);
    expect(result.current.getProjectAdapter).toBe(firstFacade.getProjectAdapter);
    expect(result.current.queryFiles).toBe(firstFacade.queryFiles);
    expect(result.current.getFileSummary).toBe(firstFacade.getFileSummary);
    expect(result.current.listTree).toBe(firstFacade.listTree);
    expect(result.current.readText).toBe(firstFacade.readText);
    expect(result.current.writeText).toBe(firstFacade.writeText);
    expect(result.current.mkdir).toBe(firstFacade.mkdir);
    expect(result.current.move).toBe(firstFacade.move);
    expect(result.current.remove).toBe(firstFacade.remove);
    expect(result.current.upload).toBe(firstFacade.upload);
    expect(result.current.watch).toBe(firstFacade.watch);
    expect(result.current.getBinaryUrl).toBe(firstFacade.getBinaryUrl);
  });

  it("refreshes adapter-dependent method references when project id changes", () => {
    const { result, rerender } = renderHook((props: {
      agentId: string;
      projectId: string;
    }) => useProjectWorkspaceFacade({
      scope: "project",
      agentId: props.agentId,
      projectId: props.projectId,
    }), {
      initialProps: {
        agentId: "agent-1",
        projectId: "proj-1",
      },
    });

    const firstReadText = result.current.readText;
    const firstAdapter = result.current.adapter;

    rerender({ agentId: "agent-1", projectId: "proj-2" });

    expect(result.current.adapter).not.toBe(firstAdapter);
    expect(result.current.readText).not.toBe(firstReadText);
  });

  it("returns unavailable adapter for missing project context", () => {
    const { result } = renderHook(() => useProjectWorkspaceFacade({
      scope: "project",
      agentId: "agent-1",
      projectId: "",
    }));

    expect(result.current.adapter).toBeNull();
    expect(result.current.getProjectAdapter("")).toBeNull();
  });
});
