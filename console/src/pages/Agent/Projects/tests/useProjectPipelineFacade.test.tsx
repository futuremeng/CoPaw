import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import useProjectPipelineFacade from "../hooks/useProjectPipelineFacade";

const {
  mockedListProjectPipelineTemplates,
  mockedListPlatformFlowTemplates,
  mockedImportPlatformTemplateIntoProject,
  mockedListProjectPipelineRuns,
  mockedGetProjectPipelineRun,
  mockedCreateProjectPipelineRun,
  mockedRetryProjectPipelineRun,
} = vi.hoisted(() => ({
  mockedListProjectPipelineTemplates: vi.fn().mockResolvedValue([]),
  mockedListPlatformFlowTemplates: vi.fn().mockResolvedValue([]),
  mockedImportPlatformTemplateIntoProject: vi.fn().mockResolvedValue({ id: "tpl-1" }),
  mockedListProjectPipelineRuns: vi.fn().mockResolvedValue([]),
  mockedGetProjectPipelineRun: vi.fn().mockResolvedValue({ id: "run-1", artifacts: [] }),
  mockedCreateProjectPipelineRun: vi.fn().mockResolvedValue({ id: "run-2", artifacts: [] }),
  mockedRetryProjectPipelineRun: vi.fn().mockResolvedValue({ id: "run-3", artifacts: [] }),
}));

vi.mock("../../../../api/modules/agents", () => ({
  agentsApi: {
    listProjectPipelineTemplates: mockedListProjectPipelineTemplates,
    listPlatformFlowTemplates: mockedListPlatformFlowTemplates,
    importPlatformTemplateIntoProject: mockedImportPlatformTemplateIntoProject,
    listProjectPipelineRuns: mockedListProjectPipelineRuns,
    getProjectPipelineRun: mockedGetProjectPipelineRun,
    createProjectPipelineRun: mockedCreateProjectPipelineRun,
    retryProjectPipelineRun: mockedRetryProjectPipelineRun,
  },
}));

describe("useProjectPipelineFacade", () => {
  it("keeps method references stable across rerenders", () => {
    const { result, rerender } = renderHook(() => useProjectPipelineFacade());

    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
    expect(result.current.listProjectPipelineTemplates).toBe(first.listProjectPipelineTemplates);
    expect(result.current.listPlatformFlowTemplates).toBe(first.listPlatformFlowTemplates);
    expect(result.current.importPlatformTemplateIntoProject).toBe(first.importPlatformTemplateIntoProject);
    expect(result.current.listProjectPipelineRuns).toBe(first.listProjectPipelineRuns);
    expect(result.current.getProjectPipelineRun).toBe(first.getProjectPipelineRun);
    expect(result.current.createProjectPipelineRun).toBe(first.createProjectPipelineRun);
    expect(result.current.retryProjectPipelineRun).toBe(first.retryProjectPipelineRun);
  });

  it("delegates API calls through facade methods", async () => {
    const { result } = renderHook(() => useProjectPipelineFacade());

    await result.current.listProjectPipelineTemplates("agent-1", "proj-1");
    await result.current.listPlatformFlowTemplates("agent-1");
    await result.current.importPlatformTemplateIntoProject("agent-1", "proj-1", { platform_template_id: "tpl-1" });
    await result.current.listProjectPipelineRuns("agent-1", "proj-1");
    await result.current.getProjectPipelineRun("agent-1", "proj-1", "run-1");
    await result.current.createProjectPipelineRun("agent-1", "proj-1", {
      template_id: "tpl-1",
      parameters: {},
    });
    await result.current.retryProjectPipelineRun("agent-1", "proj-1", "run-1", {
      step_id: "step-1",
      note: "retry",
    });

    expect(mockedListProjectPipelineTemplates).toHaveBeenCalledWith("agent-1", "proj-1");
    expect(mockedListPlatformFlowTemplates).toHaveBeenCalledWith("agent-1");
    expect(mockedImportPlatformTemplateIntoProject).toHaveBeenCalledWith(
      "agent-1",
      "proj-1",
      { platform_template_id: "tpl-1" },
    );
    expect(mockedListProjectPipelineRuns).toHaveBeenCalledWith("agent-1", "proj-1");
    expect(mockedGetProjectPipelineRun).toHaveBeenCalledWith("agent-1", "proj-1", "run-1");
    expect(mockedCreateProjectPipelineRun).toHaveBeenCalled();
    expect(mockedRetryProjectPipelineRun).toHaveBeenCalled();
  });
});
