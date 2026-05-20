import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentsApi } from "../../../../api/modules/agents";
import type { ProjectKnowledgePipelineState } from "../../../../api/types";
import ProjectKnowledgeSettingsPanel from "../components/ProjectKnowledgeSettingsPanel";

const { mockedApi, mockedAgentsApi } = vi.hoisted(() => ({
  mockedApi: {
    listKnowledgeSources: vi.fn(),
  },
  mockedAgentsApi: {
    updateProjectKnowledgeSink: vi.fn(),
    updateProjectKnowledgeRegistration: vi.fn(),
  },
}));

vi.mock("../../../../api", () => ({
  __esModule: true,
  default: mockedApi,
  getApiUrl: (path: string) => path,
  getApiToken: () => "",
}));

vi.mock("../../../../api/modules/agents", () => ({
  agentsApi: mockedAgentsApi,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, maybeFallback?: string | Record<string, unknown>) =>
      typeof maybeFallback === "string" ? maybeFallback : key,
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

function buildSyncState(projectId: string): ProjectKnowledgePipelineState {
  return {
    project_id: projectId,
    status: "idle" as const,
    current_stage: "idle",
    progress: 0,
    auto_enabled: true,
    dirty: false,
    dirty_after_run: false,
    last_trigger: "",
    changed_paths: [],
    pending_changed_paths: [],
    changed_count: 0,
    last_error: "",
    latest_job_id: "",
    latest_source_id: `project-${projectId.toLowerCase()}-workspace`,
    last_result: {},
    percent: 0,
    stage_message: "",
    current: 0,
    total: 0,
    eta_seconds: 0,
    operation_id: "",
    idempotency_key: "",
    deduplicated: false,
    last_action: "",
    quantization_stage: "",
    operation_updated_at: "",
    changed_files: [],
  } as unknown as ProjectKnowledgePipelineState;
}

describe("ProjectKnowledgeSettingsPanel", () => {
  const projectId = "project-abc";

  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.listKnowledgeSources.mockResolvedValue({ sources: [] });
    mockedAgentsApi.updateProjectKnowledgeRegistration.mockResolvedValue({});
  });

  it("updates auto workflow toggle via API", async () => {
    const user = userEvent.setup();
    vi.mocked(agentsApi.updateProjectKnowledgeSink).mockResolvedValue({
      project_auto_knowledge_sink: false,
    } as never);

    render(
      <ProjectKnowledgeSettingsPanel
        agentId="default"
        projectId={projectId}
        projectAutoKnowledgeSink
        syncState={buildSyncState(projectId)}
      />,
    );

    const switches = await screen.findAllByRole("switch");
    await user.click(switches[0]);

    await waitFor(() => {
      expect(agentsApi.updateProjectKnowledgeSink).toHaveBeenCalledWith(
        "default",
        projectId,
        { project_auto_knowledge_sink: false },
      );
    });
  });

  it("registers project knowledge source when enabling registration toggle", async () => {
    const user = userEvent.setup();
    mockedApi.listKnowledgeSources.mockResolvedValue({ sources: [] });

    render(
      <ProjectKnowledgeSettingsPanel
        agentId="default"
        projectId={projectId}
        projectAutoKnowledgeSink={false}
        syncState={buildSyncState(projectId)}
      />,
    );

    const switches = await screen.findAllByRole("switch");
    await user.click(switches[1]);

    await waitFor(() => {
      expect(mockedAgentsApi.updateProjectKnowledgeRegistration).toHaveBeenCalledWith(
        "default",
        projectId,
        { project_agent_knowledge_registered: true },
      );
    });
  });

  it("unregisters project knowledge source when disabling registration toggle", async () => {
    const user = userEvent.setup();
    mockedApi.listKnowledgeSources.mockResolvedValue({
      sources: [buildRegisteredSource(projectId)],
    });

    render(
      <ProjectKnowledgeSettingsPanel
        agentId="default"
        projectId={projectId}
        projectAutoKnowledgeSink={false}
        syncState={buildSyncState(projectId)}
      />,
    );

    const switches = await screen.findAllByRole("switch");
    await user.click(switches[1]);

    await waitFor(() => {
      expect(mockedAgentsApi.updateProjectKnowledgeRegistration).toHaveBeenCalledWith(
        "default",
        projectId,
        { project_agent_knowledge_registered: false },
      );
    });
  });
});
