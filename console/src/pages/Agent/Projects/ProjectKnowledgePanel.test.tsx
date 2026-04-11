import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectKnowledgePanel from "./ProjectKnowledgePanel";

const { mockedApi } = vi.hoisted(() => ({
  mockedApi: {
    listKnowledgeSources: vi.fn(),
    graphQuery: vi.fn(),
    getProjectKnowledgeSyncStatus: vi.fn(),
  },
}));

vi.mock("../../../api", () => ({
  __esModule: true,
  default: mockedApi,
  getApiUrl: (path: string) => path,
  getApiToken: () => "",
}));

vi.mock("../Knowledge/graphVisualization", () => ({
  GraphQueryResults: () => <div data-testid="graph-query-results" />,
  GraphVisualization: (props: {
    onUsePathContext?: (pathSummary: string, runNow?: boolean) => void;
  }) => (
    <button
      data-testid="graph-visualization"
      type="button"
      onClick={() => {
        props.onUsePathContext?.("node-a -> node-b", true);
        props.onUsePathContext?.("node-a -> node-b", true);
      }}
    >
      graph-visualization
    </button>
  ),
}));

vi.mock("../Knowledge/graphQuery", () => ({
  recordsToVisualizationData: () => ({ nodes: [], edges: [] }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      maybeFallbackOrOptions?: string | { project?: string },
      _maybeOptions?: { project?: string },
    ) => {
      if (typeof maybeFallbackOrOptions === "string") {
        return maybeFallbackOrOptions;
      }
      return key;
    },
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
      document_count: 1,
      chunk_count: 2,
      error: null,
    },
  };
}

describe("ProjectKnowledgePanel interactions", () => {
  const projectId = "project-abc";
  let originalWebSocket: typeof WebSocket | undefined;

  class FakeWebSocket {
    static instances: FakeWebSocket[] = [];

    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onopen: (() => void) | null = null;
    readyState = 1;

    constructor(_url: string) {
      FakeWebSocket.instances.push(this);
    }

    close() {
      this.readyState = 3;
    }

    emit(payload: unknown) {
      this.onmessage?.({ data: JSON.stringify(payload) });
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    FakeWebSocket.instances = [];
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
    mockedApi.graphQuery.mockResolvedValue({
      records: [],
      summary: "ok",
      warnings: [],
      provenance: { engine: "local_lexical" },
    });
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket as typeof WebSocket;
  });

  it("queries graph in cypher mode when selected", async () => {
    const user = userEvent.setup();

    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
      />,
    );

    await user.click(await screen.findByText("projects.knowledge.queryModeTemplate"));
    await user.click(await screen.findByText("projects.knowledge.queryModeCypherMvp"));

    const queryInput = screen.getByPlaceholderText("projects.knowledge.queryPlaceholder");
    fireEvent.change(queryInput, {
      target: { value: "MATCH (node)-[:RELATES_TO]->(tool) RETURN node LIMIT 5" },
    });
    await user.click(screen.getByRole("button", { name: "projects.knowledge.query" }));

    await waitFor(() => {
      expect(mockedApi.graphQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "cypher",
          projectScope: [projectId],
          projectId,
        }),
      );
    });
  });

  it("renders knowledge signals section", async () => {
    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
      />,
    );

    expect(await screen.findByText("projects.knowledge.signalsTitle")).not.toBeNull();
  });

  it("runs suggested query from insight action", async () => {
    const user = userEvent.setup();

    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
      />,
    );

    const actionButton = await screen.findByRole("button", {
      name: "projects.knowledge.actionRunSuggestedQuery",
    });
    await user.click(actionButton);

    await waitFor(() => {
      expect(mockedApi.graphQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.stringContaining("Project ABC"),
          projectScope: [projectId],
          projectId,
        }),
      );
    });
  });

  it("deduplicates repeated path context when apply-and-run is clicked repeatedly", async () => {
    const user = userEvent.setup();
    mockedApi.graphQuery.mockClear();

    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
      />,
    );

    const queryInput = await screen.findByPlaceholderText("projects.knowledge.queryPlaceholder");
    fireEvent.change(queryInput, {
      target: { value: "Seed query" },
    });

    await user.click(screen.getByRole("button", { name: "projects.knowledge.query" }));
    await waitFor(() => {
      expect(mockedApi.graphQuery).toHaveBeenCalledTimes(1);
    });

    await user.click(await screen.findByTestId("graph-visualization"));

    await waitFor(() => {
      expect(mockedApi.graphQuery).toHaveBeenCalledTimes(3);
      const lastQuery = mockedApi.graphQuery.mock.calls[2][0]?.query as string;
      expect(lastQuery.includes("Path context: node-a -> node-b")).toBe(true);
      const occurrences = lastQuery.match(/Path context: node-a -> node-b/g)?.length || 0;
      expect(occurrences).toBe(1);
    });
  });

  it("refreshes sources and query when sync finishes", async () => {
    const user = userEvent.setup();

    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
      />,
    );

    const queryInput = await screen.findByPlaceholderText("projects.knowledge.queryPlaceholder");
    fireEvent.change(queryInput, {
      target: { value: "Refresh me" },
    });
    await user.click(screen.getByRole("button", { name: "projects.knowledge.query" }));

    await waitFor(() => {
      expect(mockedApi.graphQuery).toHaveBeenCalledTimes(1);
    });

    const ws = FakeWebSocket.instances[0];
    expect(ws).toBeTruthy();

    act(() => {
      ws.emit({
        type: "snapshot",
        state: {
          project_id: projectId,
          status: "succeeded",
          current_stage: "completed",
          progress: 100,
          auto_enabled: true,
          dirty: false,
          dirty_after_run: false,
          last_trigger: "project_watcher_change",
          changed_paths: ["original/brief.md"],
          pending_changed_paths: [],
          changed_count: 1,
          last_error: "",
          last_finished_at: "2026-04-11T23:30:00+00:00",
          latest_job_id: "",
          latest_source_id: `project-${projectId.toLowerCase()}-workspace`,
          last_result: {},
        },
      });
    });

    await waitFor(() => {
      expect(mockedApi.listKnowledgeSources).toHaveBeenCalledTimes(2);
      expect(mockedApi.graphQuery).toHaveBeenCalledTimes(2);
    });
  });

  it("renders explicit queued sync status", async () => {
    mockedApi.getProjectKnowledgeSyncStatus.mockResolvedValueOnce({
      project_id: projectId,
      status: "queued",
      current_stage: "debouncing",
      progress: 1,
      auto_enabled: true,
      dirty: true,
      dirty_after_run: false,
      last_trigger: "project_upload",
      changed_paths: ["upload/file.md"],
      pending_changed_paths: [],
      changed_count: 1,
      scheduled_for: "2026-04-11T23:31:00+00:00",
      last_error: "",
      latest_job_id: "",
      latest_source_id: `project-${projectId.toLowerCase()}-workspace`,
      last_result: {},
    });

    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
      />,
    );

    const alert = await screen.findByRole("alert");
    expect(alert.textContent || "").toContain("projects.knowledge.syncStage.debouncing");
  });

  it("reports relation count from memify sync result", async () => {
    const onSignalsChange = vi.fn();
    mockedApi.getProjectKnowledgeSyncStatus.mockResolvedValueOnce({
      project_id: projectId,
      status: "succeeded",
      current_stage: "completed",
      progress: 100,
      auto_enabled: true,
      dirty: false,
      dirty_after_run: false,
      last_trigger: "project_watcher_change",
      changed_paths: [],
      pending_changed_paths: [],
      changed_count: 0,
      last_error: "",
      latest_job_id: "",
      latest_source_id: `project-${projectId.toLowerCase()}-workspace`,
      last_result: {
        memify: {
          node_count: 12,
          relation_count: 24,
        },
      },
    });

    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
        onSignalsChange={onSignalsChange}
      />,
    );

    await waitFor(() => {
      expect(onSignalsChange).toHaveBeenCalledWith(
        expect.objectContaining({
          relationCount: 24,
        }),
      );
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent || "").toContain("projects.knowledge.syncGraphStats");
  });
});
