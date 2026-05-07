import type { PropsWithChildren, ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ProjectDetailPage from "./ProjectDetailPage";

const {
  mockedListProjectFileTree,
  mockedListProjectFiles,
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
  mockedListProjectFileTree: vi.fn(),
  mockedListProjectFiles: vi.fn(),
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

vi.mock("./useProjectRealtimeController", () => ({
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

vi.mock("./ProjectAutomationPanel", () => ({ default: () => <div /> }));
vi.mock("./ProjectKnowledgePanel", () => ({ default: () => <div /> }));
vi.mock("./ProjectKnowledgeNerPanel", () => ({ default: () => <div /> }));
vi.mock("./ProjectKnowledgeOutputsPanel", () => ({ default: () => <div /> }));
vi.mock("./ProjectKnowledgeProcessingPanel", () => ({ default: () => <div /> }));
vi.mock("./ProjectKnowledgeSignalsPanel", () => ({
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
vi.mock("./ProjectKnowledgeSourcesPanel", () => ({ default: () => <div /> }));
vi.mock("./ProjectKnowledgeSettingsPanel", () => ({ default: () => <div /> }));
vi.mock("./ProjectOverviewCard", () => ({
  default: (props: Record<string, unknown>) => {
    projectOverviewCardState.latestProps = props;
    return <div />;
  },
}));
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

describe("ProjectDetailPage refresh scheduling", () => {
  afterEach(() => {
    cleanup();
  });

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
        expect(mockedListProjectFiles).toHaveBeenCalledTimes(1);
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

      expect(mockedListProjectFiles).toHaveBeenCalledTimes(1);
      expect(mockedListProjectFileTree).toHaveBeenCalledTimes(1);
      expect(mockedGetProjectFileSummary).toHaveBeenCalledTimes(1);
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
    mockedListProjectFiles.mockResolvedValue([
      {
        filename: "guide.md",
        path: "guide.md",
        size: 128,
        modified_time: "2026-04-29T00:00:00Z",
      },
      {
        filename: "notes.md",
        path: "notes.md",
        size: 64,
        modified_time: "2026-04-29T00:01:00Z",
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