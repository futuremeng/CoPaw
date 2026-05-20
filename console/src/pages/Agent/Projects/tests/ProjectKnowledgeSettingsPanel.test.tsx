import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentsApi } from "../../../../api/modules/agents";
import type { ProjectKnowledgePipelineState } from "../../../../api/types";
import ProjectKnowledgeSettingsPanel from "../components/ProjectKnowledgeSettingsPanel";

const { mockedApi, mockedAgentsApi } = vi.hoisted(() => ({
  mockedApi: {
    listKnowledgeSources: vi.fn(),
    upsertKnowledgeSource: vi.fn(),
    indexKnowledgeSource: vi.fn(),
    getProjectKnowledgePipelineStatus: vi.fn(),
    runProjectKnowledgePipeline: vi.fn(),
  },
  mockedAgentsApi: {
    updateProjectKnowledgeSink: vi.fn(),
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
      engine: "hanlp",
      status: "ready",
      reason_code: "HANLP_READY",
      reason: "HanLP semantic engine is ready.",
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
    engine: "hanlp",
    status: "ready",
    reason_code: "HANLP_READY",
    reason: "HanLP semantic engine is ready.",
    ...overrides,
  };
}

function buildSyncState(
  projectId: string,
  overrides: Record<string, unknown> = {},
): ProjectKnowledgePipelineState {
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
    semantic_engine: buildSemanticState(),
    // Required fields with defaults
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
    ...overrides,
  } as unknown as ProjectKnowledgePipelineState;
}

describe("ProjectKnowledgeSettingsPanel", () => {
  const projectId = "project-abc";

  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.listKnowledgeSources.mockResolvedValue({
      sources: [buildRegisteredSource(projectId)],
    });
    mockedApi.getProjectKnowledgePipelineStatus.mockResolvedValue(buildSyncState(projectId));
    mockedApi.runProjectKnowledgePipeline.mockResolvedValue({
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
        syncState={buildSyncState(projectId)}
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
        syncState={buildSyncState(projectId)}
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
        syncState={buildSyncState(projectId, {
          status: "queued",
          current_stage: "cooldown",
          stage_message: "Waiting for debounce/cooldown window · Semantic engine unavailable: HanLP module is not installed.",
          progress: 1,
          dirty: true,
          last_trigger: "project_watcher_change",
          changed_paths: ["original/a.md"],
          changed_count: 1,
          scheduled_for: "2026-04-11T23:31:00+00:00",
          semantic_engine: buildSemanticState({
            status: "unavailable",
            reason_code: "HANLP_IMPORT_UNAVAILABLE",
            reason: "HanLP module is not installed or failed to import.",
            summary: "Semantic engine unavailable: HanLP module is not installed.",
          }),
        })}
        onIncludeGlobalChange={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: "copaw.projects.knowledge.manualSink" }));

    await waitFor(() => {
      expect(mockedApi.runProjectKnowledgePipeline).toHaveBeenCalledWith(
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
    mockedApi.getProjectKnowledgePipelineStatus.mockResolvedValueOnce(buildSyncState(projectId, {
      status: "queued",
      current_stage: "cooldown",
      stage_message: "Waiting for debounce/cooldown window · Semantic engine unavailable: HanLP module is not installed.",
      progress: 1,
      dirty: true,
      last_trigger: "project_watcher_change",
      changed_paths: ["original/a.md"],
      changed_count: 1,
      scheduled_for: "2026-04-11T23:31:00+00:00",
      semantic_engine: buildSemanticState({
        status: "unavailable",
        reason_code: "HANLP_IMPORT_UNAVAILABLE",
        reason: "HanLP module is not installed or failed to import.",
        summary: "Semantic engine unavailable: HanLP module is not installed.",
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
        syncState={buildSyncState(projectId, {
          status: "queued",
          current_stage: "cooldown",
          stage_message: "Waiting for debounce/cooldown window · Semantic engine unavailable: HanLP module is not installed.",
          progress: 1,
          dirty: true,
          last_trigger: "project_watcher_change",
          changed_paths: ["original/a.md"],
          changed_count: 1,
          scheduled_for: "2026-04-11T23:31:00+00:00",
          semantic_engine: buildSemanticState({
            status: "unavailable",
            reason_code: "HANLP_IMPORT_UNAVAILABLE",
            reason: "HanLP module is not installed or failed to import.",
            summary: "Semantic engine unavailable: HanLP module is not installed.",
          }),
        })}
        onIncludeGlobalChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(document.body.textContent || "").toContain("copaw.projects.knowledge.syncStage.cooldown");
      expect(document.body.textContent || "").toContain("Semantic engine unavailable: HanLP module is not installed.");
    });
  });

  it("does not render changed file paths in settings panel", async () => {
    mockedApi.getProjectKnowledgePipelineStatus.mockResolvedValueOnce(buildSyncState(projectId, {
      status: "queued",
      current_stage: "cooldown",
      dirty: true,
      last_trigger: "project_watcher_change",
      changed_paths: ["original/a.md", "original/b.md"],
      changed_count: 2,
    }));

    render(
      <ProjectKnowledgeSettingsPanel
        agentId="default"
        projectId={projectId}
        projectName="Project ABC"
        projectWorkspaceDir="/tmp/workspace"
        projectAutoKnowledgeSink
        includeGlobal
        syncState={buildSyncState(projectId, {
          status: "queued",
          current_stage: "cooldown",
          dirty: true,
          last_trigger: "project_watcher_change",
          changed_paths: ["original/a.md", "original/b.md"],
          changed_count: 2,
        })}
        onIncludeGlobalChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(document.body.textContent || "").not.toContain("original/a.md");
      expect(document.body.textContent || "").not.toContain("original/b.md");
      expect(document.body.textContent || "").not.toContain("Changed Files");
    });
  });

  it("renders semantic engine status in layer 2", async () => {
    mockedApi.getProjectKnowledgePipelineStatus.mockResolvedValueOnce(buildSyncState(projectId, {
      semantic_engine: buildSemanticState({
        status: "unavailable",
        reason_code: "HANLP_IMPORT_UNAVAILABLE",
        reason: "HanLP module is not installed or failed to import.",
      }),
    }));
    mockedApi.listKnowledgeSources.mockResolvedValueOnce({
      sources: [
        {
          ...buildRegisteredSource(projectId),
          semantic_status: buildSemanticState({
            status: "unavailable",
            reason_code: "HANLP_IMPORT_UNAVAILABLE",
            reason: "HanLP module is not installed or failed to import.",
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
        syncState={buildSyncState(projectId, {
          semantic_engine: buildSemanticState({
            status: "unavailable",
            reason_code: "HANLP_IMPORT_UNAVAILABLE",
            reason: "HanLP module is not installed or failed to import.",
            summary: "Semantic engine unavailable: HanLP module is not installed.",
          }),
        })}
        onIncludeGlobalChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(document.body.textContent || "").toContain("Module Unavailable");
      expect(document.body.textContent || "").toContain("HANLP_IMPORT_UNAVAILABLE");
      expect(document.body.textContent || "").toContain("Semantic engine unavailable: HanLP module is not installed.");
    });
  });

  it("renders semantic runtime failure code in layer 2", async () => {
    mockedApi.getProjectKnowledgePipelineStatus.mockResolvedValueOnce(buildSyncState(projectId, {
      semantic_engine: buildSemanticState({
        status: "error",
        reason_code: "HANLP_TOKENIZE_FAILED",
        reason: "HanLP semantic tokenization failed via tok: RuntimeError.",
      }),
    }));
    mockedApi.listKnowledgeSources.mockResolvedValueOnce({
      sources: [
        {
          ...buildRegisteredSource(projectId),
          semantic_status: buildSemanticState({
            status: "error",
            reason_code: "HANLP_TOKENIZE_FAILED",
            reason: "HanLP semantic tokenization failed via tok: RuntimeError.",
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
        syncState={buildSyncState(projectId, {
          semantic_engine: buildSemanticState({
            status: "error",
            reason_code: "HANLP_TOKENIZE_FAILED",
            reason: "HanLP semantic tokenization failed via tok: RuntimeError.",
          }),
        })}
        onIncludeGlobalChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(document.body.textContent || "").toContain("Tokenization Failed");
      expect(document.body.textContent || "").toContain("HANLP_TOKENIZE_FAILED");
    });
  });

  it("renders HanLP sidecar setup guidance for sidecar-related semantic status", async () => {
    mockedApi.getProjectKnowledgePipelineStatus.mockResolvedValueOnce(buildSyncState(projectId, {
      semantic_engine: buildSemanticState({
        status: "unavailable",
        reason_code: "HANLP_SIDECAR_UNCONFIGURED",
        reason: "HanLP sidecar is not configured.",
      }),
    }));
    mockedApi.listKnowledgeSources.mockResolvedValueOnce({
      sources: [
        {
          ...buildRegisteredSource(projectId),
          semantic_status: buildSemanticState({
            status: "unavailable",
            reason_code: "HANLP_SIDECAR_UNCONFIGURED",
            reason: "HanLP sidecar is not configured.",
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
        syncState={buildSyncState(projectId, {
          semantic_engine: buildSemanticState({
            status: "unavailable",
            reason_code: "HANLP_SIDECAR_UNCONFIGURED",
            reason: "HanLP sidecar is not configured.",
          }),
        })}
        onIncludeGlobalChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      const body = document.body.textContent || "";
      expect(body).toContain("Sidecar Unconfigured");
      expect(body).toContain("copaw.projects.knowledge.semanticSidecarHintTitle");
      expect(body).toContain("copaw.projects.knowledge.semanticSidecarHintEnable");
      expect(body).toContain("copaw.projects.knowledge.semanticSidecarHintVerify");
    });
  });

  it("prefers sync state semantic engine over source fallback", async () => {
    mockedApi.getProjectKnowledgePipelineStatus.mockResolvedValueOnce(buildSyncState(projectId, {
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
        syncState={buildSyncState(projectId, {
          semantic_engine: buildSemanticState({
            status: "idle",
            reason_code: "SOURCE_NOT_READY",
            reason: "Project source has not been prepared for semantic extraction yet.",
          }),
        })}
        onIncludeGlobalChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(document.body.textContent || "").toContain("Source Not Ready");
      expect(document.body.textContent || "").toContain("SOURCE_NOT_READY");
    });
  });

  it("renders project pipeline operation tracing metadata", async () => {
    mockedApi.getProjectKnowledgePipelineStatus.mockResolvedValueOnce(buildSyncState(projectId, {
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
        syncState={buildSyncState(projectId, {
          operation_id: "ps-abc1234",
          idempotency_key: "manual-op-key-1",
          deduplicated: true,
          last_action: "start_sync",
          quantization_stage: "l2",
          operation_updated_at: "2026-04-11T23:30:00+00:00",
        })}
        onIncludeGlobalChange={vi.fn()}
      />,
    );

    await waitFor(() => {
      const body = document.body.textContent || "";
      expect(body).toContain("ps-abc1234");
      expect(body).toContain("manual-op-key-1");
      expect(body).toContain("Yes");
      expect(body).toContain("start_sync");
      expect(body).toContain("L2");
      expect(body).toContain("copaw.projects.knowledge.syncOperationUpdatedAt:");
    });
  });
});
