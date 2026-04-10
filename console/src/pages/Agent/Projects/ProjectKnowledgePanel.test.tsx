import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectKnowledgePanel from "./ProjectKnowledgePanel";

const { mockedApi } = vi.hoisted(() => ({
  mockedApi: {
    listKnowledgeSources: vi.fn(),
    graphQuery: vi.fn(),
  },
}));

vi.mock("../../../api", () => ({
  __esModule: true,
  default: mockedApi,
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
    mockedApi.graphQuery.mockResolvedValue({
      records: [],
      summary: "ok",
      warnings: [],
      provenance: { engine: "local_lexical" },
    });
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
});
