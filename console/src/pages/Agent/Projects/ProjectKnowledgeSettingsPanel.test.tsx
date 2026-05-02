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

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
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
    semantic_status: {
      engine: "hanlp2",
      status: "ready",
      reason_code: "HANLP2_READY",
      reason: "HanLP2 semantic engine is ready.",
    },
    status: {
      indexed: true,
      indexed_at: null,
      document_count: 2,
      chunk_count: 3,
      error: null,
    },
  };
}

function buildSemanticState(
  overrides: Record<string, unknown> = {},
) {
  return {
    engine: "hanlp2",
    status: "ready",
    reason_code: "HANLP2_READY",
    reason: "HanLP2 semantic engine is ready.",
    ...overrides,
  };
}

function buildSyncState(
  projectId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
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
    semantic_engine: buildSemanticState(),
    ...overrides,
  };
}

describe("ProjectKnowledgeSettingsPanel", () => {
  const projectId = "project-abc";

  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.listKnowledgeSources.mockResolvedValue({
      sources: [buildRegisteredSource(projectId)],
    });
    mockedApi.getProjectKnowledgeSyncStatus.mockResolvedValue(buildSyncState(projectId));
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

    const { container } = render(
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

    const autoSinkSwitch = container.querySelector("button.ant-switch");
    expect(autoSinkSwitch).not.toBeNull();
    if (!autoSinkSwitch) {
      throw new Error("auto sink switch not found");
    }
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

    await user.click(await screen.findByRole("button", { name: "Run Sync" }));

    await waitFor(() => {
      expect(mockedApi.runProjectKnowledgeSync).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          trigger: "manual-panel",
          force: true,
          processingMode: "agentic",
          quantizationStage: "l3",
        }),
      );
    });
  });

  it("renders queued sync stage summary", async () => {
    mockedApi.getProjectKnowledgeSyncStatus.mockResolvedValueOnce(buildSyncState(projectId, {
      status: "queued",
      current_stage: "cooldown",
      stage_message: "Waiting for debounce/cooldown window · Semantic engine unavailable: HanLP2 module is not installed.",
      progress: 1,
      dirty: true,
      last_trigger: "project_watcher_change",
      changed_paths: ["original/a.md"],
      changed_count: 1,
      scheduled_for: "2026-04-11T23:31:00+00:00",
      semantic_engine: buildSemanticState({
        status: "unavailable",
        reason_code: "HANLP2_IMPORT_UNAVAILABLE",
        reason: "HanLP2 module is not installed or failed to import.",
        summary: "Semantic engine unavailable: HanLP2 module is not installed.",
      }),
    }));

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

    await waitFor(() => {
      expect(document.body.textContent || "").toContain("projects.knowledge.syncStage.cooldown");
      expect(document.body.textContent || "").toContain("Semantic engine unavailable: HanLP2 module is not installed.");
    });
  });

  it("renders semantic engine status in layer 2", async () => {
    mockedApi.getProjectKnowledgeSyncStatus.mockResolvedValueOnce(buildSyncState(projectId, {
      semantic_engine: buildSemanticState({
        status: "unavailable",
        reason_code: "HANLP2_IMPORT_UNAVAILABLE",
        reason: "HanLP2 module is not installed or failed to import.",
      }),
    }));
    mockedApi.listKnowledgeSources.mockResolvedValueOnce({
      sources: [
        {
          ...buildRegisteredSource(projectId),
          semantic_status: buildSemanticState({
            status: "unavailable",
            reason_code: "HANLP2_IMPORT_UNAVAILABLE",
            reason: "HanLP2 module is not installed or failed to import.",
          }),
        },
      ],
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

    await waitFor(() => {
      expect(document.body.textContent || "").toContain("Module Unavailable");
      expect(document.body.textContent || "").toContain("HANLP2_IMPORT_UNAVAILABLE");
      expect(document.body.textContent || "").toContain("Semantic engine unavailable: HanLP2 module is not installed.");
    });
  });

  it("renders semantic runtime failure code in layer 2", async () => {
    mockedApi.getProjectKnowledgeSyncStatus.mockResolvedValueOnce(buildSyncState(projectId, {
      semantic_engine: buildSemanticState({
        status: "error",
        reason_code: "HANLP2_TOKENIZE_FAILED",
        reason: "HanLP2 semantic tokenization failed via tok: RuntimeError.",
      }),
    }));
    mockedApi.listKnowledgeSources.mockResolvedValueOnce({
      sources: [
        {
          ...buildRegisteredSource(projectId),
          semantic_status: buildSemanticState({
            status: "error",
            reason_code: "HANLP2_TOKENIZE_FAILED",
            reason: "HanLP2 semantic tokenization failed via tok: RuntimeError.",
          }),
        },
      ],
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

    await waitFor(() => {
      expect(document.body.textContent || "").toContain("Tokenization Failed");
      expect(document.body.textContent || "").toContain("HANLP2_TOKENIZE_FAILED");
    });
  });

  it("renders HanLP sidecar setup guidance for sidecar-related semantic status", async () => {
    mockedApi.getProjectKnowledgeSyncStatus.mockResolvedValueOnce(buildSyncState(projectId, {
      semantic_engine: buildSemanticState({
        status: "unavailable",
        reason_code: "HANLP2_SIDECAR_UNCONFIGURED",
        reason: "HanLP2 sidecar is not configured.",
      }),
    }));
    mockedApi.listKnowledgeSources.mockResolvedValueOnce({
      sources: [
        {
          ...buildRegisteredSource(projectId),
          semantic_status: buildSemanticState({
            status: "unavailable",
            reason_code: "HANLP2_SIDECAR_UNCONFIGURED",
            reason: "HanLP2 sidecar is not configured.",
          }),
        },
      ],
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

    await waitFor(() => {
      const body = document.body.textContent || "";
      expect(body).toContain("Sidecar Unconfigured");
      expect(body).toContain("HanLP sidecar setup");
      expect(body).toContain("COPAW_HANLP_SIDECAR_ENABLED=1");
      expect(body).toContain("qwenpaw doctor");
    });
  });

  it("prefers sync state semantic engine over source fallback", async () => {
    mockedApi.getProjectKnowledgeSyncStatus.mockResolvedValueOnce(buildSyncState(projectId, {
      semantic_engine: buildSemanticState({
        status: "idle",
        reason_code: "SOURCE_NOT_READY",
        reason: "Project source has not been prepared for semantic extraction yet.",
      }),
    }));

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

    await waitFor(() => {
      expect(document.body.textContent || "").toContain("Source Not Ready");
      expect(document.body.textContent || "").toContain("SOURCE_NOT_READY");
    });
  });

  it("renders project sync operation tracing metadata", async () => {
    mockedApi.getProjectKnowledgeSyncStatus.mockResolvedValueOnce(buildSyncState(projectId, {
      operation_id: "ps-abc1234",
      idempotency_key: "manual-op-key-1",
      deduplicated: true,
      last_action: "start_sync",
      quantization_stage: "l2",
      operation_updated_at: "2026-04-11T23:30:00+00:00",
    }));

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

    await waitFor(() => {
      const body = document.body.textContent || "";
      expect(body).toMatch(/Operation:\s*ps-abc1234/);
      expect(body).toMatch(/Idempotency:\s*manual-op-key-1/);
      expect(body).toMatch(/Deduplicated:\s*Yes/);
      expect(body).toMatch(/Action:\s*start_sync/);
      expect(body).toMatch(/Stage:\s*L2/);
      expect(body).toMatch(/Updated:\s*/);
    });
  });
});
