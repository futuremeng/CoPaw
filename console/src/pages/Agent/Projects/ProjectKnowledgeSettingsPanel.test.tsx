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
    getProjectKnowledgeSyncStatus: vi.fn(),
    runProjectKnowledgeSync: vi.fn(),
  },
  mockedAgentsApi: {
    updateProjectKnowledgeSink: vi.fn(),
  },
}));

vi.mock("../../../api", () => ({
  __esModule: true,
  default: mockedApi,
  getApiUrl: (path: string) => path,
  getApiToken: () => "",
}));

vi.mock("../../../api/modules/agents", () => ({
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

describe("ProjectKnowledgeSettingsPanel", () => {
  const projectId = "project-abc";

  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.listKnowledgeSources.mockResolvedValue({
      sources: [buildRegisteredSource(projectId)],
    });
    mockedApi.getProjectKnowledgeSyncStatus.mockResolvedValue({
      project_id: projectId,
      status: "idle",
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
    });
    mockedApi.runProjectKnowledgeSync.mockResolvedValue({
      accepted: true,
      reason: "STARTED",
      state: {
        project_id: projectId,
        status: "pending",
        current_stage: "pending",
        progress: 1,
        auto_enabled: true,
        dirty: false,
        dirty_after_run: false,
        last_trigger: "manual-panel",
        changed_paths: [],
        pending_changed_paths: [],
        changed_count: 0,
        last_error: "",
        latest_job_id: "",
        latest_source_id: `project-${projectId.toLowerCase()}-workspace`,
        last_result: {},
      },
    });
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
      expect(mockedApi.runProjectKnowledgeSync).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          trigger: "manual-panel",
          force: true,
        }),
      );
    });
  });

  it("renders queued sync stage summary", async () => {
    mockedApi.getProjectKnowledgeSyncStatus.mockResolvedValueOnce({
      project_id: projectId,
      status: "queued",
      current_stage: "cooldown",
      progress: 1,
      auto_enabled: true,
      dirty: true,
      dirty_after_run: false,
      last_trigger: "project_watcher_change",
      changed_paths: ["original/a.md"],
      pending_changed_paths: [],
      changed_count: 1,
      scheduled_for: "2026-04-11T23:31:00+00:00",
      last_error: "",
      latest_job_id: "",
      latest_source_id: `project-${projectId.toLowerCase()}-workspace`,
      last_result: {},
    });

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

    const alert = await screen.findByRole("alert");
    expect(alert.textContent || "").toContain("projects.knowledge.syncStage.cooldown");
  });
});
