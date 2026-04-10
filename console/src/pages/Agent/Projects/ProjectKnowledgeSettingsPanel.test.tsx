import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentsApi } from "../../../api/modules/agents";
import ProjectKnowledgeSettingsPanel from "./ProjectKnowledgeSettingsPanel";

const { mockedApi, mockedAgentsApi } = vi.hoisted(() => ({
  mockedApi: {
    listKnowledgeSources: vi.fn(),
    upsertKnowledgeSource: vi.fn(),
    indexKnowledgeSource: vi.fn(),
    startMemifyJob: vi.fn(),
    getMemifyJobStatus: vi.fn(),
  },
  mockedAgentsApi: {
    updateProjectKnowledgeSink: vi.fn(),
  },
}));

vi.mock("../../../api", () => ({
  __esModule: true,
  default: mockedApi,
}));

vi.mock("../../../api/modules/agents", () => ({
  agentsApi: mockedAgentsApi,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, maybeFallback?: string) => maybeFallback || key,
  }),
}));

function buildRegisteredSource(projectId: string) {
  return {
    id: `project-${projectId.toLowerCase()}-workspace`,
    name: "Project Source",
    type: "directory",
    location: "/tmp/workspace",
    content: "",
    enabled: true,
    recursive: true,
    tags: ["project"],
    summary: "",
    status: {
      indexed: true,
      indexed_at: null,
      document_count: 2,
      chunk_count: 3,
      error: null,
    },
  };
}

describe("ProjectKnowledgeSettingsPanel", () => {
  const projectId = "project-abc";

  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.listKnowledgeSources.mockResolvedValue({
      sources: [buildRegisteredSource(projectId)],
    });
    mockedApi.startMemifyJob.mockResolvedValue({
      accepted: true,
      job_id: "job-1",
      status_url: "/api/knowledge/memify/jobs/job-1",
    });
    mockedApi.getMemifyJobStatus.mockResolvedValue({ status: "succeeded", error: "" });
    mockedApi.upsertKnowledgeSource.mockResolvedValue({});
    mockedApi.indexKnowledgeSource.mockResolvedValue({});
  });

  it("updates project auto sink via API", async () => {
    const user = userEvent.setup();
    vi.mocked(agentsApi.updateProjectKnowledgeSink).mockResolvedValue({
      project_auto_knowledge_sink: false,
    } as never);

    render(
      <ProjectKnowledgeSettingsPanel
        agentId="default"
        projectId={projectId}
        projectName="Project ABC"
        projectWorkspaceDir="/tmp/workspace"
        projectAutoKnowledgeSink
        includeGlobal
        onIncludeGlobalChange={vi.fn()}
      />,
    );

    const autoSinkSwitch = await screen.findByRole("switch");
    await user.click(autoSinkSwitch);

    await waitFor(() => {
      expect(agentsApi.updateProjectKnowledgeSink).toHaveBeenCalledWith(
        "default",
        projectId,
        { project_auto_knowledge_sink: false },
      );
    });
  });

  it("triggers includeGlobal callback", async () => {
    const user = userEvent.setup();
    const onIncludeGlobalChange = vi.fn();

    render(
      <ProjectKnowledgeSettingsPanel
        agentId="default"
        projectId={projectId}
        projectName="Project ABC"
        projectWorkspaceDir="/tmp/workspace"
        projectAutoKnowledgeSink
        includeGlobal
        onIncludeGlobalChange={onIncludeGlobalChange}
      />,
    );

    await user.click(await screen.findByRole("checkbox"));

    expect(onIncludeGlobalChange).toHaveBeenCalledWith(false);
  });

  it("starts manual sink job for registered project source", async () => {
    const user = userEvent.setup();

    render(
      <ProjectKnowledgeSettingsPanel
        agentId="default"
        projectId={projectId}
        projectName="Project ABC"
        projectWorkspaceDir="/tmp/workspace"
        projectAutoKnowledgeSink
        includeGlobal
        onIncludeGlobalChange={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "projects.knowledge.manualSink" }));

    await waitFor(() => {
      expect(mockedApi.startMemifyJob).toHaveBeenCalledWith(
        expect.objectContaining({
          pipeline_type: "project-manual",
          project_id: projectId,
        }),
      );
    });
  });
});
