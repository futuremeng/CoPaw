import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentsApi } from "../../../api/modules/agents";
import ProjectKnowledgePanel from "./ProjectKnowledgePanel";

const { mockedApi, mockedAgentsApi } = vi.hoisted(() => ({
  mockedApi: {
    listKnowledgeSources: vi.fn(),
    upsertKnowledgeSource: vi.fn(),
    indexKnowledgeSource: vi.fn(),
    startMemifyJob: vi.fn(),
    getMemifyJobStatus: vi.fn(),
    graphQuery: vi.fn(),
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
    mockedApi.graphQuery.mockResolvedValue({
      records: [],
      summary: "ok",
      warnings: [],
      provenance: { engine: "local_lexical" },
    });
    mockedApi.getMemifyJobStatus.mockResolvedValue({ status: "succeeded", error: "" });
  });

  it("updates project auto sink via API and callback", async () => {
    const user = userEvent.setup();
    const onProjectAutoKnowledgeSinkChange = vi.fn();
    vi.mocked(agentsApi.updateProjectKnowledgeSink).mockResolvedValue({
      project_auto_knowledge_sink: false,
    } as never);

    render(
      <ProjectKnowledgePanel
        agentId="default"
        projectId={projectId}
        projectName="Project ABC"
        projectWorkspaceDir="/tmp/workspace"
        projectAutoKnowledgeSink
        onProjectAutoKnowledgeSinkChange={onProjectAutoKnowledgeSinkChange}
      />,
    );

    const autoSinkSwitch = await screen.findByRole("switch");
    await user.click(autoSinkSwitch);

    await waitFor(() => {
      expect(mockedApi.listKnowledgeSources).toHaveBeenCalledWith({
        projectId,
      });
      expect(agentsApi.updateProjectKnowledgeSink).toHaveBeenCalledWith(
        "default",
        projectId,
        { project_auto_knowledge_sink: false },
      );
      expect(onProjectAutoKnowledgeSinkChange).toHaveBeenCalledWith(false);
    });
  });

  it("starts manual sink job for registered project source", async () => {
    const user = userEvent.setup();

    render(
      <ProjectKnowledgePanel
        agentId="default"
        projectId={projectId}
        projectName="Project ABC"
        projectWorkspaceDir="/tmp/workspace"
        projectAutoKnowledgeSink
      />,
    );

    const manualSinkButton = await screen.findByRole("button", { name: "projects.knowledge.manualSink" });
    await user.click(manualSinkButton);

    await waitFor(() => {
      expect(mockedApi.startMemifyJob).toHaveBeenCalledWith(
        expect.objectContaining({
          pipeline_type: "project-manual",
          dataset_scope: ["project-project-abc-workspace"],
          project_id: projectId,
        }),
      );
    });
  });

  it("passes project namespace for source register/reindex", async () => {
    const user = userEvent.setup();
    mockedApi.upsertKnowledgeSource.mockResolvedValue({});
    mockedApi.indexKnowledgeSource.mockResolvedValue({
      source_id: "project-project-abc-workspace",
      document_count: 1,
      chunk_count: 1,
      indexed_at: "2026-04-10T00:00:00Z",
    });

    render(
      <ProjectKnowledgePanel
        agentId="default"
        projectId={projectId}
        projectName="Project ABC"
        projectWorkspaceDir="/tmp/workspace"
        projectAutoKnowledgeSink
      />,
    );

    const registerOrReindex = await screen.findByRole("button", {
      name: "projects.knowledge.sourceReindex",
    });
    await user.click(registerOrReindex);

    await waitFor(() => {
      expect(mockedApi.upsertKnowledgeSource).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: projectId,
        }),
        { projectId },
      );
      expect(mockedApi.indexKnowledgeSource).toHaveBeenCalledWith(
        "project-project-abc-workspace",
        { projectId },
      );
    });
  });

  it("queries graph in cypher mode when selected", async () => {
    const user = userEvent.setup();

    render(
      <ProjectKnowledgePanel
        agentId="default"
        projectId={projectId}
        projectName="Project ABC"
        projectWorkspaceDir="/tmp/workspace"
        projectAutoKnowledgeSink
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
        agentId="default"
        projectId={projectId}
        projectName="Project ABC"
        projectWorkspaceDir="/tmp/workspace"
        projectAutoKnowledgeSink
      />,
    );

    expect(await screen.findByText("projects.knowledge.signalsTitle")).not.toBeNull();
  });

  it("runs suggested query from insight action", async () => {
    const user = userEvent.setup();

    render(
      <ProjectKnowledgePanel
        agentId="default"
        projectId={projectId}
        projectName="Project ABC"
        projectWorkspaceDir="/tmp/workspace"
        projectAutoKnowledgeSink
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
        agentId="default"
        projectId={projectId}
        projectName="Project ABC"
        projectWorkspaceDir="/tmp/workspace"
        projectAutoKnowledgeSink
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
});
