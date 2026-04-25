import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import ProjectKnowledgePanel from "./ProjectKnowledgePanel";
import { buildModeState } from "./projectKnowledgeTestUtils";
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
    activeKnowledgeTasks: [],
    activeKnowledgeTask: null,
    latestQualityLoopJob: null,
    memifyEnabled: true,
    processingModes: [
      buildModeState(),
      buildModeState({
        mode: "nlp",
        status: "idle",
        available: false,
        stage: "Waiting for graph extraction",
        summary: "图谱与结构化产物尚未形成。",
      }),
      buildModeState({
        mode: "agentic",
        status: "idle",
        available: false,
        stage: "Waiting for multi-agent workflow scheduling",
        summary: "长耗时深加工轨道，产物缺失时将自动降级。",
      }),
    ],
    processingCompareModes: [
      buildModeState({
        mode: "nlp",
        status: "idle",
        available: false,
        stage: "Waiting for graph extraction",
        summary: "图谱与结构化产物尚未形成。",
      }),
      buildModeState({
        mode: "agentic",
        status: "idle",
        available: false,
        stage: "Waiting for multi-agent workflow scheduling",
        summary: "长耗时深加工轨道，产物缺失时将自动降级。",
      }),
    ],
    processingCompareDelta: {
      entityDelta: 0,
      relationDelta: 0,
    },
    processingFreshness: {
      stale: false,
      staleModes: [],
      staleSources: [],
      channelStatus: {
        "project-sync": "open",
        tasks: "open",
      },
    },
    outputModes: [
      buildModeState({
        mode: "agentic",
        status: "idle",
        available: false,
        stage: "Waiting for multi-agent workflow scheduling",
        summary: "长耗时深加工轨道，产物缺失时将自动降级。",
      }),
      buildModeState({
        mode: "nlp",
        status: "idle",
        available: false,
        stage: "Waiting for graph extraction",
        summary: "图谱与结构化产物尚未形成。",
      }),
    ],
    outputResolution: {
      activeMode: "agentic",
      availableModes: [],
      fallbackChain: ["agentic", "nlp"],
      reason: "高阶输出尚未就绪，当前保持 L2/L3 输出视角并等待深加工产物生成。",
    },
    processingScheduler: {
      strategy: "parallel",
      modeOrder: ["agentic", "nlp", "fast"],
      runningModes: [],
      queuedModes: ["nlp", "agentic"],
      readyModes: ["fast"],
      failedModes: [],
      nextMode: "nlp",
      consumptionMode: "fast",
      reason: "当前无活跃执行，下一条待推进轨道为 nlp。",
    },
    modeOutputs: {
      fast: {
        mode: "fast",
        source: "indexed-preview",
        summaryLines: ["Documents: 1", "Chunks: 2"],
        artifacts: [],
      },
      nlp: {
        mode: "nlp",
        source: "graph-artifacts",
        summaryLines: ["Entities: 0", "Relations: 0"],
        artifacts: [],
      },
      agentic: {
        mode: "agentic",
        source: "workflow-artifacts",
        summaryLines: ["Run: ", "Status: idle"],
        artifacts: [],
      },
    },
    quantMetrics: {
      totalSources: 1,
      indexedSources: 1,
      indexedRatio: 1,
      documentCount: 1,
      chunkCount: 2,
      sentenceCount: 3,
      sentenceWithEntitiesCount: 2,
      entityMentionsCount: 4,
      avgEntitiesPerSentence: 1.33,
      avgEntityCharRatio: 0.2,
      relationCount: 0,
      entityCount: 0,
      relationNormalizationCoverage: 0,
      entityCanonicalCoverage: 0,
      lowConfidenceRatio: 0,
      missingEvidenceRatio: 0,
      relationNormalizationThreshold: 0.5,
      entityCanonicalThreshold: 0.48,
      lowConfidenceThreshold: 0.28,
      missingEvidenceThreshold: 0.3,
      qualityAssessmentScore: 0,
    },
    graphQueryText: "",
    setGraphQueryText: vi.fn(),
    graphQueryTopK: 200,
    setGraphQueryTopK: vi.fn(),
    graphQueryMode: "template",
    setGraphQueryMode: vi.fn(),
    graphNeedsRefresh: false,
    markGraphNeedsRefresh: vi.fn(),
    graphLoading: false,
    graphError: "",
    graphResult: null,
    relationRecords: [],
    relationKeywordSeed: "",
    setRelationKeywordSeed: vi.fn(),
    activeGraphNodeId: null,
    setActiveGraphNodeId: vi.fn(),
    runGraphQuery: vi.fn().mockResolvedValue(undefined),
    startProcessingMode: vi.fn().mockResolvedValue(undefined),
    processingLaunchMode: null,
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
    semanticBySourceId: {},
    semanticLoadingBySourceId: {},
    loadSourceSemantic: vi.fn().mockResolvedValue(undefined),
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
