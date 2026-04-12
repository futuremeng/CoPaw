import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import ProjectKnowledgePanel from "./ProjectKnowledgePanel";
import type { ProjectKnowledgeState } from "./useProjectKnowledgeState";

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

vi.mock("../Knowledge/graphQuery", () => ({
  recordsToVisualizationData: () => ({ nodes: [], edges: [] }),
}));

function buildKnowledgeState(projectId: string): ProjectKnowledgeState {
  return {
    projectSourceId: `project-${projectId.toLowerCase()}-workspace`,
    sourceLoaded: true,
    sourceRegistered: true,
    projectSources: [],
    selectedSourceId: "",
    setSelectedSourceId: vi.fn(),
    sourceContentById: {},
    sourceContentLoadingById: {},
    loadSourceContent: vi.fn().mockResolvedValue(null),
    syncState: null,
    quantMetrics: {
      totalSources: 1,
      indexedSources: 1,
      indexedRatio: 1,
      documentCount: 1,
      chunkCount: 2,
      relationCount: 0,
    },
    graphQueryText: "",
    setGraphQueryText: vi.fn(),
    graphQueryMode: "template",
    setGraphQueryMode: vi.fn(),
    graphLoading: false,
    graphError: "",
    graphResult: null,
    relationRecords: [],
    activeGraphNodeId: null,
    setActiveGraphNodeId: vi.fn(),
    runGraphQuery: vi.fn().mockResolvedValue(undefined),
    resetGraphQuery: vi.fn(),
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

function StatefulPanel(props: {
  projectId: string;
  knowledgeState?: ProjectKnowledgeState;
}) {
  const [queryText, setQueryText] = useState(props.knowledgeState?.graphQueryText || "");
  const knowledgeState = props.knowledgeState ?? buildKnowledgeState(props.projectId);

  return (
    <ProjectKnowledgePanel
      projectId={props.projectId}
      projectName="Project ABC"
      knowledgeState={{
        ...knowledgeState,
        graphQueryText: queryText,
        setGraphQueryText: (value) => {
          knowledgeState.setGraphQueryText(value);
          setQueryText(value);
        },
      }}
      graphComponents={testGraphComponents}
    />
  );
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
      }}
    >
      graph-visualization
    </button>
  ),
};

describe("ProjectKnowledgePanel interactions", () => {
  const projectId = "project-abc";

  it("dispatches query mode changes to shared knowledge state", async () => {
    const user = userEvent.setup();
    const knowledgeState = buildKnowledgeState(projectId);

    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
        knowledgeState={knowledgeState}
        graphComponents={testGraphComponents}
      />,
    );

    await user.click(await screen.findByText("projects.knowledge.queryModeTemplate"));
    await user.click(await screen.findByText("projects.knowledge.queryModeCypherMvp"));

    expect(knowledgeState.setGraphQueryMode).toHaveBeenCalledWith("cypher");
  });

  it("submits search queries through the shared knowledge state", async () => {
    const knowledgeState = buildKnowledgeState(projectId);

    render(<StatefulPanel projectId={projectId} knowledgeState={knowledgeState} />);

    const queryInput = screen.getByPlaceholderText("projects.knowledge.queryPlaceholder");
    fireEvent.change(queryInput, {
      target: { value: "MATCH (node)-[:RELATES_TO]->(tool) RETURN node LIMIT 5" },
    });

    fireEvent.keyDown(queryInput, { key: "Enter", code: "Enter", charCode: 13 });

    expect(knowledgeState.setGraphQueryText).toHaveBeenCalled();
    await waitFor(() => {
      expect(knowledgeState.runGraphQuery).toHaveBeenCalledWith(
        "MATCH (node)-[:RELATES_TO]->(tool) RETURN node LIMIT 5",
      );
    });
  });

  it("keeps signals and health actions out of explore", () => {
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

  it("applies path context through shared state actions", async () => {
    const user = userEvent.setup();
    const knowledgeState = buildKnowledgeState(projectId);
    knowledgeState.graphQueryText = "Seed query";
    knowledgeState.graphResult = {
      records: [],
      summary: "ok",
      warnings: [],
      provenance: { engine: "local_lexical" },
    };

    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
        knowledgeState={knowledgeState}
        graphComponents={testGraphComponents}
      />,
    );

    await user.click(await screen.findByTestId("graph-visualization"));

    await waitFor(() => {
      expect(knowledgeState.setGraphQueryText).toHaveBeenCalledWith(
        expect.stringContaining("Path context: node-a -> node-b"),
      );
      expect(knowledgeState.runGraphQuery).toHaveBeenCalledWith(
        expect.stringContaining("Path context: node-a -> node-b"),
      );
    });
  });

  it("runs requested query handoff through shared state", async () => {
    const knowledgeState = buildKnowledgeState(projectId);
    const onRequestedQueryHandled = vi.fn();

    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
        knowledgeState={knowledgeState}
        requestedQuery="Summarize project ABC"
        onRequestedQueryHandled={onRequestedQueryHandled}
        graphComponents={testGraphComponents}
      />,
    );

    await waitFor(() => {
      expect(knowledgeState.setGraphQueryText).toHaveBeenCalledWith("Summarize project ABC");
      expect(knowledgeState.runGraphQuery).toHaveBeenCalledWith(
        "Summarize project ABC",
        "template",
      );
    });
    expect(onRequestedQueryHandled).toHaveBeenCalledTimes(1);
  });
});
