import type { PropsWithChildren, ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectDetailPage from "./ProjectDetailPage";

const {
  mockedAcquireProjectKnowledgeWatchLease,
  mockedListProjectFileTree,
  mockedQueryProjectFiles,
  mockedReleaseProjectKnowledgeWatchLease,
  mockedReadProjectFile,
  mockedGetProjectFileSummary,
  mockedMessageError,
  mockedMessageSuccess,
  projectOverviewCardState,
  mockAgentStoreState,
  mockPreferredWorkspaceChatState,
  mockProjectUploadControllerState,
  mockProjectChatEnsureControllerState,
  mockProjectDesignChatControllerState,
  mockKnowledgeState,
  realtimeControllerState,
} = vi.hoisted(() => ({
  mockedAcquireProjectKnowledgeWatchLease: vi.fn(),
  mockedListProjectFileTree: vi.fn(),
  mockedQueryProjectFiles: vi.fn(),
  mockedReleaseProjectKnowledgeWatchLease: vi.fn(),
  mockedReadProjectFile: vi.fn(),
  mockedGetProjectFileSummary: vi.fn(),
  mockedMessageError: vi.fn(),
  mockedMessageSuccess: vi.fn(),
  projectOverviewCardState: {
    latestProps: null as Record<string, unknown> | null,
  },
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
    reconnectAttempt: 0,
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
    acquireProjectKnowledgeWatchLease: mockedAcquireProjectKnowledgeWatchLease,
    listProjectFileTree: mockedListProjectFileTree,
    queryProjectFiles: mockedQueryProjectFiles,
    releaseProjectKnowledgeWatchLease: mockedReleaseProjectKnowledgeWatchLease,
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

vi.mock("./hooks/useProjectRealtimeController", () => ({
  default: (args: {
    onFileTreeInvalidated?: typeof realtimeControllerState.onFileTreeInvalidated;
    onPipelineInvalidated?: typeof realtimeControllerState.onPipelineInvalidated;
  }) => {
    realtimeControllerState.onFileTreeInvalidated = args.onFileTreeInvalidated;
    realtimeControllerState.onPipelineInvalidated = args.onPipelineInvalidated;
    return {
      status: realtimeControllerState.status,
      reconnectAttempt: realtimeControllerState.reconnectAttempt,
    };
  },
}));

vi.mock("./components/ProjectAutomationPanel", () => ({ default: () => <div /> }));
vi.mock("./components/ProjectKnowledgePanel", () => ({ default: () => <div /> }));
vi.mock("./components/ProjectKnowledgeNerPanel", () => ({ default: () => <div /> }));
vi.mock("./components/ProjectKnowledgeOutputsPanel", () => ({ default: () => <div /> }));
vi.mock("./components/ProjectKnowledgeProcessingPanel", () => ({ default: () => <div /> }));
vi.mock("./components/ProjectKnowledgeSignalsPanel", () => ({
  default: (props: {
    runtimeSignalValue?: string;
    runtimeSignalTooltipContent?: ReactNode;
    realtimeConnectionText?: string;
    realtimeReconnectAttempt?: number;
    showRealtimeConnectionNotice?: boolean;
  }) => (
    <div>
      <div data-testid="runtime-signal-value">{props.runtimeSignalValue}</div>
      <div data-testid="runtime-signal-tooltip">{props.runtimeSignalTooltipContent}</div>
      {props.showRealtimeConnectionNotice ? (
        <div data-testid="realtime-health-notice">
          {props.realtimeConnectionText}
          {props.realtimeReconnectAttempt ? ` Attempt ${props.realtimeReconnectAttempt}` : ""}
        </div>
      ) : null}
    </div>
  ),
}));
vi.mock("./components/ProjectKnowledgeSourcesPanel", () => ({ default: () => <div /> }));
vi.mock("./components/ProjectKnowledgeSettingsPanel", () => ({ default: () => <div /> }));
vi.mock("./components/ProjectOverviewCard", () => ({
  default: (props: Record<string, unknown>) => {
    projectOverviewCardState.latestProps = props;
    return <div />;
  },
}));
vi.mock("./components/ProjectUploadModal", () => ({ default: () => <div /> }));
vi.mock("./components/ProjectWorkbenchPanel", () => ({ default: () => <div /> }));
vi.mock("./components/ProjectMetricsPanel", () => ({ default: () => <div /> }));
vi.mock("./components/ProjectEvidencePanel", () => ({ default: () => <div /> }));
vi.mock("./components/ProjectChatPanel", () => ({
  default: (props: { onAssistantTurnCompleted?: () => void }) => (
    <button type="button" onClick={props.onAssistantTurnCompleted}>
      assistant-turn-completed
    </button>
  ),
}));

vi.mock("./hooks/useArtifactSelectionGuards", () => ({ default: () => undefined }));
vi.mock("./hooks/useProjectChatEnsureController", () => ({
  default: () => mockProjectChatEnsureControllerState,
}));
vi.mock("./hooks/useProjectChatFocusEffects", () => ({ default: () => undefined }));
vi.mock("./hooks/usePreferredProjectWorkspaceChat", () => ({
  default: () => mockPreferredWorkspaceChatState,
}));
vi.mock("./hooks/useProjectDesignChatController", () => ({
  default: () => mockProjectDesignChatControllerState,
}));
vi.mock("./hooks/useLeaveConfirmGuard", () => ({ default: () => undefined }));
vi.mock("./hooks/useOpenUploadQuery", () => ({ default: () => undefined }));
vi.mock("./hooks/useProjectUploadController", () => ({
  default: () => mockProjectUploadControllerState,
}));
vi.mock("./hooks/useProjectKnowledgeState", () => ({
  useProjectKnowledgeState: () => mockKnowledgeState,
}));
vi.mock("./utils/projectKnowledgeSyncUi", () => ({
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

describe("ProjectDetailPage refresh scheduling", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    mockedAcquireProjectKnowledgeWatchLease.mockResolvedValue({
      lease_id: "lease-project-detail",
      active_count: 1,
      file_monitoring_state: "active",
      acquired_at: "2026-05-12T00:00:00Z",
    });
    const mutableKnowledgeState = mockKnowledgeState as {
      activeKnowledgeTask: Record<string, unknown> | null;
      activeKnowledgeTasks: Array<Record<string, unknown>>;
      syncState: Record<string, unknown> | null;
    };
    mutableKnowledgeState.activeKnowledgeTask = null;
    mutableKnowledgeState.activeKnowledgeTasks = [];
    mutableKnowledgeState.syncState = null;
    realtimeControllerState.status = "connected";
    realtimeControllerState.reconnectAttempt = 0;
    realtimeControllerState.onFileTreeInvalidated = undefined;
    realtimeControllerState.onPipelineInvalidated = undefined;
    projectOverviewCardState.latestProps = null;
    mockedListProjectFileTree.mockResolvedValue([
      {
        filename: "guide.md",
        path: "original/guide.md",
        size: 128,
        modified_time: "2026-04-29T00:00:00Z",
        is_directory: false,
        child_count: 0,
        descendant_file_count: 0,
        direct_file_count: 0,
        has_child_directories: false,
      },
    ]);
    mockedQueryProjectFiles.mockResolvedValue({
      items: [
        {
          filename: "guide.md",
          path: "original/guide.md",
          size: 128,
          modified_time: "2026-04-29T00:00:00Z",
          stage: "original",
          content_type: "markdown",
          builtin: false,
          ignored: false,
        },
      ],
      summary: {
        total_matched: 1,
        offset: 0,
        limit: 5000,
        returned: 1,
        builtin_count: 0,
        ignored_count: 0,
        stage_counts: { original: 1, intermediate: 0, artifact: 0, builtin: 0, other: 0 },
        content_type_counts: { markdown: 1, text: 0, script: 0, other: 0 },
      },
      query_meta: {
        search: "",
        path_prefix: "",
        stages: [],
        content_types: [],
        include_builtin: null,
        include_ignored: false,
        sort_by: "path",
        sort_order: "asc",
      },
    });
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
    mockedReleaseProjectKnowledgeWatchLease.mockResolvedValue({
      lease_id: "lease-project-detail",
      released: true,
      active_count: 0,
      file_monitoring_state: "idle",
      updated_at: "2026-05-12T00:01:00Z",
    });
  });

  it("acquires and releases project knowledge watch lease with page lifecycle", async () => {
    const view = renderPage();

    await waitFor(() => {
      expect(mockedAcquireProjectKnowledgeWatchLease).toHaveBeenCalledWith("agent-1", "proj-1");
    });
    expect(mockedQueryProjectFiles).toHaveBeenCalledWith(
      "agent-1",
      "proj-1",
      expect.objectContaining({
        include_ignored: false,
        sort_by: "path",
        sort_order: "asc",
        offset: 0,
        limit: 5000,
        include_builtin: false,
        stages: ["original", "intermediate", "artifact"],
      }),
    );

    view.unmount();

    await waitFor(() => {
      expect(mockedReleaseProjectKnowledgeWatchLease).toHaveBeenCalledWith("agent-1", "proj-1", "lease-project-detail");
    });
  });

  it("uses summary recent updates without prefetching child directories", async () => {
    mockedListProjectFileTree.mockResolvedValue([
      {
        filename: "original",
        path: "original",
        size: 0,
        modified_time: "2026-04-29T00:00:00Z",
        is_directory: true,
        child_count: 2,
        descendant_file_count: 1,
        direct_file_count: 1,
        has_child_directories: true,
      },
    ]);
    mockedGetProjectFileSummary.mockResolvedValue({
      total_files: 2,
      builtin_files: 0,
      visible_files: 2,
      original_files: 2,
      derived_files: 0,
      knowledge_candidate_files: 2,
      markdown_files: 2,
      text_like_files: 2,
      recently_updated_files: 1,
      recent_updates: [
        {
          filename: "latest.md",
          path: "original/latest.md",
          size: 64,
          modified_time: "2026-04-29T00:01:00Z",
        },
      ],
    });

    const view = renderPage();
    try {
      await waitFor(() => {
        expect(mockedGetProjectFileSummary).toHaveBeenCalled();
        expect(projectOverviewCardState.latestProps?.latestUpdatedFilePath).toBe("original/latest.md");
      });

      await waitFor(() => {
        expect(mockedListProjectFileTree).toHaveBeenCalledWith("agent-1", "proj-1", "");
      });
      expect(mockedListProjectFileTree).not.toHaveBeenCalledWith("agent-1", "proj-1", "original");
    } finally {
      view.unmount();
    }
  });

  it("keeps resync invalidations lightweight without auto-refresh scheduling", async () => {
    const view = renderPage();
    try {
      await waitFor(() => {
        expect(mockedQueryProjectFiles).toHaveBeenCalledTimes(1);
        expect(mockedListProjectFileTree).toHaveBeenCalledTimes(1);
        expect(mockedGetProjectFileSummary).toHaveBeenCalledTimes(1);
      });

      expect(realtimeControllerState.onFileTreeInvalidated).toBeTypeOf("function");

      act(() => {
        realtimeControllerState.onFileTreeInvalidated?.({
          changedPaths: ["original/changed.md"],
          changedDirs: ["original"],
          changedPathsTruncated: false,
          reason: "resync",
        });
      });

      expect(mockedQueryProjectFiles).toHaveBeenCalledTimes(1);
      expect(mockedListProjectFileTree).toHaveBeenCalledTimes(1);
      expect(mockedGetProjectFileSummary).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
    }
  });

  it("reloads project files with mapped query filters when metric filter changes", async () => {
    const view = renderPage();
    try {
      await waitFor(() => {
        expect(mockedQueryProjectFiles).toHaveBeenCalledTimes(1);
      });

      const onMetricFilterChange = (
        projectOverviewCardState.latestProps?.onMetricFilterChange
      ) as ((next: "" | "markdown" | "text" | "script" | "otherType") => void) | undefined;

      expect(onMetricFilterChange).toBeTypeOf("function");

      act(() => {
        onMetricFilterChange?.("markdown");
      });

      await waitFor(() => {
        expect(mockedQueryProjectFiles).toHaveBeenCalledTimes(2);
      });

      const calls = mockedQueryProjectFiles.mock.calls;
      const latestCall = calls[calls.length - 1];
      expect(latestCall?.[0]).toBe("agent-1");
      expect(latestCall?.[1]).toBe("proj-1");
      expect(latestCall?.[2]).toEqual(
        expect.objectContaining({
          include_ignored: false,
          include_builtin: false,
          sort_by: "path",
          sort_order: "asc",
          offset: 0,
          limit: 5000,
          content_types: ["markdown"],
        }),
      );
    } finally {
      view.unmount();
    }
  });

  it("selects a root-level recent file without probing file-tree by file path", async () => {
    mockedListProjectFileTree.mockResolvedValue([
      {
        filename: "guide.md",
        path: "guide.md",
        size: 128,
        modified_time: "2026-04-29T00:00:00Z",
        is_directory: false,
        child_count: 0,
        descendant_file_count: 0,
        direct_file_count: 0,
        has_child_directories: false,
      },
    ]);
    mockedQueryProjectFiles.mockResolvedValue({
      items: [
        {
          filename: "guide.md",
          path: "guide.md",
          size: 128,
          modified_time: "2026-04-29T00:00:00Z",
          stage: "original",
          content_type: "markdown",
          builtin: false,
          ignored: false,
        },
        {
          filename: "notes.md",
          path: "notes.md",
          size: 64,
          modified_time: "2026-04-29T00:01:00Z",
          stage: "original",
          content_type: "markdown",
          builtin: false,
          ignored: false,
        },
      ],
      summary: {
        total_matched: 2,
        offset: 0,
        limit: 5000,
        returned: 2,
        builtin_count: 0,
        ignored_count: 0,
        stage_counts: { original: 2, intermediate: 0, artifact: 0, builtin: 0, other: 0 },
        content_type_counts: { markdown: 2, text: 0, script: 0, other: 0 },
      },
      query_meta: {
        search: "",
        path_prefix: "",
        stages: [],
        content_types: [],
        include_builtin: null,
        include_ignored: false,
        sort_by: "path",
        sort_order: "asc",
      },
    });
    mockedGetProjectFileSummary.mockResolvedValue({
      total_files: 2,
      builtin_files: 0,
      visible_files: 2,
      original_files: 2,
      derived_files: 0,
      knowledge_candidate_files: 2,
      markdown_files: 2,
      text_like_files: 2,
      recently_updated_files: 1,
      recent_updates: [
        {
          filename: "notes.md",
          path: "notes.md",
          size: 64,
          modified_time: "2026-04-29T00:01:00Z",
        },
      ],
    });
    mockedReadProjectFile.mockResolvedValue({ content: "root" });

    const view = renderPage();
    try {
      await waitFor(() => {
        expect(projectOverviewCardState.latestProps?.latestUpdatedFilePath).toBe("notes.md");
      });

      act(() => {
        (projectOverviewCardState.latestProps?.onSelectLatestUpdatedFile as ((path: string) => void) | undefined)?.("notes.md");
      });

      await waitFor(() => {
        expect(mockedReadProjectFile).toHaveBeenCalledWith("agent-1", "proj-1", "notes.md");
      });
      expect(mockedListProjectFileTree).not.toHaveBeenCalledWith("agent-1", "proj-1", "notes.md");
    } finally {
      view.unmount();
    }
  });

  it("surfaces degraded realtime status only through the knowledge health panel", async () => {
    realtimeControllerState.status = "degraded";
    realtimeControllerState.reconnectAttempt = 3;

    const view = renderPage();
    try {
      expect(screen.getByTestId("realtime-health-notice").textContent || "").toContain("Realtime degraded");
      expect(screen.getByTestId("realtime-health-notice").textContent || "").toContain("Attempt 3");
    } finally {
      view.unmount();
    }
  });

});