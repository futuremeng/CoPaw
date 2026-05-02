import type { PropsWithChildren, ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectDetailPage from "./ProjectDetailPage";

const {
  mockedCreateProjectTreeRefreshSchedulerState,
  mockedResetProjectTreeRefreshSchedulerState,
  mockedScheduleProjectTreeRefresh,
  mockedListProjectFileTree,
  mockedListProjectFiles,
  mockedReadProjectFile,
  mockedGetProjectFileSummary,
  mockedMessageError,
  mockedMessageSuccess,
  mockAgentStoreState,
  mockPreferredWorkspaceChatState,
  mockProjectUploadControllerState,
  mockProjectChatEnsureControllerState,
  mockProjectDesignChatControllerState,
  mockKnowledgeState,
  realtimeControllerState,
} = vi.hoisted(() => ({
  mockedCreateProjectTreeRefreshSchedulerState: vi.fn().mockReturnValue({ token: "scheduler-state" }),
  mockedResetProjectTreeRefreshSchedulerState: vi.fn(),
  mockedScheduleProjectTreeRefresh: vi.fn().mockResolvedValue(undefined),
  mockedListProjectFileTree: vi.fn(),
  mockedListProjectFiles: vi.fn(),
  mockedReadProjectFile: vi.fn(),
  mockedGetProjectFileSummary: vi.fn(),
  mockedMessageError: vi.fn(),
  mockedMessageSuccess: vi.fn(),
  mockAgentStoreState: {
    selectedAgent: "agent-1",
    agents: [
      {
        id: "agent-1",
        name: "Agent One",
        description: "demo agent",
        workspace_dir: "workspace",
        enabled: true,
        is_builtin: false,
        builtin_kind: "",
        builtin_label: "",
        system_protected: false,
        projects: [
          {
            id: "proj-1",
            name: "Project One",
            description: "demo project",
            status: "active",
            workspace_dir: "workspace/project-one",
            data_dir: "data/project-one",
            metadata_file: "project.json",
            tags: [],
            artifact_distill_mode: "file_scan",
            artifact_profile: {
              skills: [],
              scripts: [],
              flows: [],
              cases: [],
            },
            project_auto_knowledge_sink: true,
            updated_time: "2026-04-29T00:00:00Z",
          },
        ],
      },
    ],
    setAgents: vi.fn(),
  },
  mockPreferredWorkspaceChatState: {
    preferredWorkspaceChatId: "",
    applyWorkspaceChatFocus: vi.fn(),
    syncPreferredWorkspaceChatBinding: vi.fn().mockResolvedValue(undefined),
    resetPreferredWorkspaceChatBinding: vi.fn(),
  },
  mockProjectUploadControllerState: {
    uploadModalOpen: false,
    setUploadModalOpen: vi.fn(),
    uploadingFiles: false,
    pendingUploads: [],
    setPendingUploads: vi.fn(),
    uploadTargetDir: "",
    setUploadTargetDir: vi.fn(),
    resetUploadState: vi.fn(),
    handleUploadFiles: vi.fn().mockResolvedValue(undefined),
  },
  mockProjectChatEnsureControllerState: {
    handleEnsureRunChat: vi.fn().mockResolvedValue(""),
    handleEnsureWorkspaceChat: vi.fn().mockResolvedValue(""),
  },
  mockProjectDesignChatControllerState: {
    handleEnsureDesignChat: vi.fn().mockResolvedValue(""),
  },
  mockKnowledgeState: {
    activeKnowledgeTask: null,
    activeKnowledgeTasks: [],
    syncState: null,
  },
  realtimeControllerState: {
    status: "connected",
    onFileTreeInvalidated: undefined as
      | ((payload?: {
        changedPaths: string[];
        changedDirs: string[];
        changedPathsTruncated: boolean;
        reason: string;
      }) => Promise<void>)
      | undefined,
    onPipelineInvalidated: undefined as
      | ((payload?: {
        changedPaths: string[];
        changedDirs: string[];
        changedPathsTruncated: boolean;
        reason: string;
      }) => Promise<void>)
      | undefined,
  },
}));

vi.mock("antd", async () => {
  const Splitter = ({ children }: PropsWithChildren) => <div>{children}</div>;
  Splitter.Panel = ({ children }: PropsWithChildren) => <div>{children}</div>;

  const Tabs = ({ items, children }: { items?: Array<{ key: string; children?: ReactNode }>; children?: ReactNode }) => (
    <div>
      {items?.map((item) => <div key={item.key}>{item.children}</div>) ?? children}
    </div>
  );

  const Collapse = ({ items, children }: { items?: Array<{ key: string; children?: ReactNode }>; children?: ReactNode }) => (
    <div>
      {items?.map((item) => <div key={item.key}>{item.children}</div>) ?? children}
    </div>
  );

  return {
    Alert: ({ children, message }: PropsWithChildren<{ message?: ReactNode }>) => <div>{message}{children}</div>,
    Badge: ({ children }: PropsWithChildren) => <div>{children}</div>,
    Button: ({ children, onClick }: PropsWithChildren<{ onClick?: () => void }>) => <button type="button" onClick={onClick}>{children}</button>,
    Card: ({ children, title, extra }: PropsWithChildren<{ title?: ReactNode; extra?: ReactNode }>) => <div>{title}{extra}{children}</div>,
    Collapse,
    Drawer: ({ children }: PropsWithChildren) => <div>{children}</div>,
    Empty: () => <div>empty</div>,
    Modal: ({ children }: PropsWithChildren) => <div>{children}</div>,
    Popconfirm: ({ children }: PropsWithChildren) => <div>{children}</div>,
    Select: ({ children }: PropsWithChildren) => <div>{children}</div>,
    Spin: () => <div>loading</div>,
    Splitter,
    Tabs,
    Typography: {
      Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
    },
    message: {
      success: mockedMessageSuccess,
      error: mockedMessageError,
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      maybeFallbackOrOptions?: string | Record<string, unknown>,
      maybeOptions?: Record<string, unknown>,
    ) => {
      const fallback = typeof maybeFallbackOrOptions === "string" ? maybeFallbackOrOptions : undefined;
      const options = typeof maybeFallbackOrOptions === "object" ? maybeFallbackOrOptions : maybeOptions;
      if (typeof fallback === "string") {
        return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ""));
      }
      return key;
    },
    i18n: {
      language: "en",
    },
  }),
}));

vi.mock("../../../stores/agentStore", () => ({
  useAgentStore: () => mockAgentStoreState,
}));

vi.mock("../../../api/modules/agents", () => ({
  agentsApi: {
    listProjectFileTree: mockedListProjectFileTree,
    listProjectFiles: mockedListProjectFiles,
    readProjectFile: mockedReadProjectFile,
    getProjectFileSummary: mockedGetProjectFileSummary,
    listProjectPipelineTemplates: vi.fn().mockResolvedValue([]),
    listProjectPipelineRuns: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../../api/modules/chat", () => ({
  chatApi: {
    clearChatMeta: vi.fn().mockResolvedValue(undefined),
    createChat: vi.fn().mockResolvedValue({ id: "chat-1" }),
    listChats: vi.fn().mockResolvedValue([]),
    updateChat: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../api/modules/knowledge", () => ({
  knowledgeApi: {
    getQualityLoopJobStatus: vi.fn().mockResolvedValue(null),
    getMemifyJobStatus: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("./projectTreeRefreshScheduler", () => ({
  createProjectTreeRefreshSchedulerState: mockedCreateProjectTreeRefreshSchedulerState,
  resetProjectTreeRefreshSchedulerState: mockedResetProjectTreeRefreshSchedulerState,
  scheduleProjectTreeRefresh: mockedScheduleProjectTreeRefresh,
}));

vi.mock("./useProjectRealtimeController", () => ({
  default: (args: {
    onFileTreeInvalidated?: typeof realtimeControllerState.onFileTreeInvalidated;
    onPipelineInvalidated?: typeof realtimeControllerState.onPipelineInvalidated;
  }) => {
    realtimeControllerState.onFileTreeInvalidated = args.onFileTreeInvalidated;
    realtimeControllerState.onPipelineInvalidated = args.onPipelineInvalidated;
    return { status: realtimeControllerState.status };
  },
}));

vi.mock("./ProjectAutomationPanel", () => ({ default: () => <div /> }));
vi.mock("./ProjectKnowledgePanel", () => ({ default: () => <div /> }));
vi.mock("./ProjectKnowledgeOutputsPanel", () => ({ default: () => <div /> }));
vi.mock("./ProjectKnowledgeProcessingPanel", () => ({ default: () => <div /> }));
vi.mock("./ProjectKnowledgeSignalsPanel", () => ({
  default: (props: { runtimeSignalValue?: string; runtimeSignalTooltipContent?: ReactNode }) => (
    <div>
      <div data-testid="runtime-signal-value">{props.runtimeSignalValue}</div>
      <div data-testid="runtime-signal-tooltip">{props.runtimeSignalTooltipContent}</div>
    </div>
  ),
}));
vi.mock("./ProjectKnowledgeSourcesPanel", () => ({ default: () => <div /> }));
vi.mock("./ProjectKnowledgeSettingsPanel", () => ({ default: () => <div /> }));
vi.mock("./ProjectOverviewCard", () => ({ default: () => <div /> }));
vi.mock("./ProjectUploadModal", () => ({ default: () => <div /> }));
vi.mock("./ProjectWorkbenchPanel", () => ({ default: () => <div /> }));
vi.mock("./ProjectMetricsPanel", () => ({ default: () => <div /> }));
vi.mock("./ProjectEvidencePanel", () => ({ default: () => <div /> }));
vi.mock("./ProjectChatPanel", () => ({
  default: (props: { onAssistantTurnCompleted?: () => void }) => (
    <button type="button" onClick={props.onAssistantTurnCompleted}>
      assistant-turn-completed
    </button>
  ),
}));

vi.mock("./useArtifactSelectionGuards", () => ({ default: () => undefined }));
vi.mock("./useProjectChatEnsureController", () => ({
  default: () => mockProjectChatEnsureControllerState,
}));
vi.mock("./useProjectChatFocusEffects", () => ({ default: () => undefined }));
vi.mock("./usePreferredProjectWorkspaceChat", () => ({
  default: () => mockPreferredWorkspaceChatState,
}));
vi.mock("./useProjectDesignChatController", () => ({
  default: () => mockProjectDesignChatControllerState,
}));
vi.mock("./useLeaveConfirmGuard", () => ({ default: () => undefined }));
vi.mock("./useOpenUploadQuery", () => ({ default: () => undefined }));
vi.mock("./useProjectUploadController", () => ({
  default: () => mockProjectUploadControllerState,
}));
vi.mock("./useProjectKnowledgeState", () => ({
  useProjectKnowledgeState: () => mockKnowledgeState,
}));
vi.mock("./projectKnowledgeSyncUi", () => ({
  getProjectKnowledgeSemanticDescription: vi.fn().mockReturnValue(""),
  getProjectKnowledgeSemanticReasonLabel: vi.fn().mockReturnValue(""),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/projects/proj-1"]}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function flushRenderWork() {
  await waitFor(() => {
    expect(mockedGetProjectFileSummary).toHaveBeenCalled();
  });
}

describe("ProjectDetailPage refresh scheduling", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    const mutableKnowledgeState = mockKnowledgeState as {
      activeKnowledgeTask: Record<string, unknown> | null;
      activeKnowledgeTasks: Array<Record<string, unknown>>;
      syncState: Record<string, unknown> | null;
    };
    mutableKnowledgeState.activeKnowledgeTask = null;
    mutableKnowledgeState.activeKnowledgeTasks = [];
    mutableKnowledgeState.syncState = null;
    realtimeControllerState.status = "connected";
    realtimeControllerState.onFileTreeInvalidated = undefined;
    realtimeControllerState.onPipelineInvalidated = undefined;
    mockedListProjectFileTree.mockResolvedValue([
      {
        filename: "guide.md",
        path: "original/guide.md",
        size: 128,
        modified_time: "2026-04-29T00:00:00Z",
        is_directory: false,
        child_count: 0,
        descendant_file_count: 0,
      },
    ]);
    mockedListProjectFiles.mockResolvedValue([
      {
        filename: "guide.md",
        path: "original/guide.md",
        size: 128,
        modified_time: "2026-04-29T00:00:00Z",
      },
    ]);
    mockedReadProjectFile.mockResolvedValue({ content: "hello" });
    mockedGetProjectFileSummary.mockResolvedValue({
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
  });

  it("routes resync invalidations through the root refresh scheduler", async () => {
    renderPage();
    await flushRenderWork();

    expect(realtimeControllerState.onFileTreeInvalidated).toBeTypeOf("function");

    await act(async () => {
      await realtimeControllerState.onFileTreeInvalidated?.({
        changedPaths: ["original/changed.md"],
        changedDirs: ["original"],
        changedPathsTruncated: false,
        reason: "resync",
      });
    });

    await waitFor(() => {
      expect(mockedScheduleProjectTreeRefresh).toHaveBeenCalledTimes(1);
    });
    expect(mockedScheduleProjectTreeRefresh).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: { token: "scheduler-state" },
        delay: 180,
        clearStale: true,
        runRefresh: expect.any(Function),
      }),
    );
  });

  it("routes assistant fallback syncs through the root refresh scheduler", async () => {
    realtimeControllerState.status = "idle";
    renderPage();
    await flushRenderWork();
    mockedScheduleProjectTreeRefresh.mockClear();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "assistant-turn-completed" }));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockedScheduleProjectTreeRefresh).toHaveBeenCalledTimes(1);
    });
    expect(mockedScheduleProjectTreeRefresh).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: { token: "scheduler-state" },
        delay: 180,
        clearStale: true,
        runRefresh: expect.any(Function),
      }),
    );
  });

  it("includes quantization stage in the runtime knowledge sync summary", async () => {
    const mutableKnowledgeState = mockKnowledgeState as {
      activeKnowledgeTask: Record<string, unknown> | null;
      activeKnowledgeTasks: Array<Record<string, unknown>>;
      syncState: Record<string, unknown> | null;
    };
    mutableKnowledgeState.activeKnowledgeTask = {
      task_id: "task-sync-1",
      task_type: "project_sync",
      status: "running",
      current_stage: "indexing",
      stage_message: "Building structured outputs",
      progress: 0.42,
      percent: 42,
      current: 2,
      total: 5,
      updated_at: "2026-04-29T00:00:00Z",
    };
    mutableKnowledgeState.activeKnowledgeTasks = [mutableKnowledgeState.activeKnowledgeTask];
    mutableKnowledgeState.syncState = {
      project_id: "proj-1",
      status: "pending",
      current_stage: "indexing",
      progress: 42,
      auto_enabled: true,
      dirty: false,
      dirty_after_run: false,
      last_trigger: "manual-panel",
      changed_paths: [],
      pending_changed_paths: [],
      changed_count: 3,
      last_error: "",
      latest_job_id: "",
      latest_source_id: "project-proj-1-workspace",
      last_result: {},
      quantization_stage: "l2",
    };

    renderPage();
    await flushRenderWork();

    await waitFor(() => {
      expect(screen.getByTestId("runtime-signal-value").textContent || "").toContain("Project Sync");
      expect(screen.getByTestId("runtime-signal-value").textContent || "").toContain("42%");
      expect(screen.getByTestId("runtime-signal-value").textContent || "").toContain("Stage: L2");
      expect(screen.getByTestId("runtime-signal-tooltip").textContent || "").toContain("Stage: L2");
    });
  });
});