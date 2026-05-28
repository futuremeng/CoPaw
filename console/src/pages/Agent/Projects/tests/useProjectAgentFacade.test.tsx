import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import useProjectAgentFacade from "../hooks/useProjectAgentFacade";

const {
  mockedListAgents,
  mockedListAgentProjects,
  mockedAcquireLease,
  mockedReleaseLease,
  mockedDeleteProject,
} = vi.hoisted(() => ({
  mockedListAgents: vi.fn().mockResolvedValue({ agents: [] }),
  mockedListAgentProjects: vi.fn().mockResolvedValue([]),
  mockedAcquireLease: vi.fn().mockResolvedValue({ lease_id: "lease-1" }),
  mockedReleaseLease: vi.fn().mockResolvedValue({ released: true }),
  mockedDeleteProject: vi.fn().mockResolvedValue({ success: true, project_id: "proj-1" }),
}));

vi.mock("../../../../api/modules/agents", () => ({
  agentsApi: {
    listAgents: mockedListAgents,
    listAgentProjects: mockedListAgentProjects,
    acquireProjectKnowledgeWatchLease: mockedAcquireLease,
    releaseProjectKnowledgeWatchLease: mockedReleaseLease,
    deleteProject: mockedDeleteProject,
  },
}));

describe("useProjectAgentFacade", () => {
  it("keeps method references stable across rerenders", () => {
    const { result, rerender } = renderHook(() => useProjectAgentFacade());

    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
    expect(result.current.listAgents).toBe(first.listAgents);
    expect(result.current.listAgentProjects).toBe(first.listAgentProjects);
    expect(result.current.acquireProjectKnowledgeWatchLease).toBe(first.acquireProjectKnowledgeWatchLease);
    expect(result.current.releaseProjectKnowledgeWatchLease).toBe(first.releaseProjectKnowledgeWatchLease);
    expect(result.current.deleteProject).toBe(first.deleteProject);
  });

  it("delegates calls to agents API", async () => {
    const { result } = renderHook(() => useProjectAgentFacade());

    await result.current.listAgents();
    await result.current.listAgentProjects("agent-1");
    await result.current.acquireProjectKnowledgeWatchLease("agent-1", "proj-1");
    await result.current.releaseProjectKnowledgeWatchLease("agent-1", "proj-1", "lease-1");
    await result.current.deleteProject("agent-1", "proj-1");

    expect(mockedListAgents).toHaveBeenCalledTimes(1);
    expect(mockedListAgentProjects).toHaveBeenCalledWith("agent-1");
    expect(mockedAcquireLease).toHaveBeenCalledWith("agent-1", "proj-1");
    expect(mockedReleaseLease).toHaveBeenCalledWith("agent-1", "proj-1", "lease-1");
    expect(mockedDeleteProject).toHaveBeenCalledWith("agent-1", "proj-1");
  });
});
