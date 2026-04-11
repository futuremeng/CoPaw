import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectKnowledgePanel from "./ProjectKnowledgePanel";
import type { ProjectKnowledgeState } from "./useProjectKnowledgeState";

const { mockedApi } = vi.hoisted(() => ({
  mockedApi: {
    graphQuery: vi.fn(),
  },
}));

vi.mock("../../../api", () => ({
  __esModule: true,
  default: mockedApi,
}));

vi.mock("../Knowledge/graphQuery", () => ({
  recordsToVisualizationData: () => ({ nodes: [], edges: [] }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      maybeFallbackOrOptions?: string | { project?: string },
    ) => {
      if (typeof maybeFallbackOrOptions === "string") {
        return maybeFallbackOrOptions;
      }
      return key;
    },
  }),
}));

function buildKnowledgeState(projectId: string): ProjectKnowledgeState {
  return {
    projectSourceId: `project-${projectId.toLowerCase()}-workspace`,
    sourceLoaded: true,
    sourceRegistered: true,
    projectSources: [],
    syncState: {
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
    },
    quantMetrics: {
      totalSources: 1,
      indexedSources: 1,
      indexedRatio: 1,
      documentCount: 1,
      chunkCount: 2,
      relationCount: 0,
    },
    trendRangeDays: 7,
    setTrendRangeDays: vi.fn(),
    trendExpanded: true,
    setTrendExpanded: vi.fn(),
    filteredTrendSnapshots: [],
    trendDocumentPath: "",
    trendChunkPath: "",
    trendDelta: {
      documentDelta: 0,
      chunkDelta: 0,
      relationDelta: 0,
    },
    syncAlertType: "info",
    syncAlertDescription: "",
    suggestedQuery: `Summarize key entities, modules, and relations in project ${projectId}`,
    insightAction: "healthy",
    insightMessageKey: "projects.knowledge.insightHealthy",
    loadProjectSourceStatus: vi.fn().mockResolvedValue(undefined),
  };
}

const testGraphComponents = {
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
};

describe("ProjectKnowledgePanel interactions", () => {
  const projectId = "project-abc";

  beforeEach(() => {
    vi.clearAllMocks();
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
        knowledgeState={buildKnowledgeState(projectId)}
        graphComponents={testGraphComponents}
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

  it("no longer renders signals content inside explore", () => {
    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
        knowledgeState={buildKnowledgeState(projectId)}
        graphComponents={testGraphComponents}
      />,
    );

    expect(screen.queryByText("projects.knowledge.signalsTitle")).toBeNull();
    expect(screen.queryByRole("button", {
      name: "projects.knowledge.actionRunSuggestedQuery",
    })).toBeNull();
  });

  it("deduplicates repeated path context when apply-and-run is clicked repeatedly", async () => {
    const user = userEvent.setup();
    mockedApi.graphQuery.mockClear();

    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
        knowledgeState={buildKnowledgeState(projectId)}
        graphComponents={testGraphComponents}
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

  it("refreshes query when sync finishes", async () => {
    const user = userEvent.setup();
    const knowledgeState = buildKnowledgeState(projectId);
    const existingSyncState = knowledgeState.syncState;
    const { rerender } = render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
        knowledgeState={knowledgeState}
        graphComponents={testGraphComponents}
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

    rerender(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
        knowledgeState={{
          ...knowledgeState,
          syncState: existingSyncState
            ? {
                ...existingSyncState,
                status: "succeeded",
                current_stage: "completed",
                last_finished_at: "2026-04-11T23:30:00+00:00",
              }
            : null,
        }}
        graphComponents={testGraphComponents}
      />,
    );

    await waitFor(() => {
      expect(mockedApi.graphQuery).toHaveBeenCalledTimes(2);
    });
  });

  it("runs requested query from insights handoff", async () => {
    const onRequestedQueryHandled = vi.fn();

    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
        knowledgeState={buildKnowledgeState(projectId)}
        requestedQuery="Summarize project ABC"
        onRequestedQueryHandled={onRequestedQueryHandled}
        graphComponents={testGraphComponents}
      />,
    );

    await waitFor(() => {
      expect(mockedApi.graphQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "Summarize project ABC",
        }),
      );
    });
    expect(onRequestedQueryHandled).toHaveBeenCalledTimes(1);
  });
});