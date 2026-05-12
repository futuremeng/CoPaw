import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import ProjectKnowledgePanel from "./ProjectKnowledgePanel";
import {
  formatGraphEntityTypeLabel,
  formatGraphRelationTypeLabel,
} from "./projectKnowledgeFilterLabels";
import { buildModeState } from "./projectKnowledgeTestUtils";
import type { KnowledgeSourceItem } from "../../../api/types";
import type { ProjectKnowledgeState } from "./useProjectKnowledgeState";

const mockRecordsToVisualizationData = vi.fn((_: unknown, __?: unknown) => ({ nodes: [], edges: [] }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      maybeFallbackOrOptions?: string | Record<string, unknown>,
      maybeOptions?: Record<string, unknown>,
    ) => {
      if (typeof maybeFallbackOrOptions === "string") {
        return maybeFallbackOrOptions.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => (
          String(maybeOptions?.[name] ?? `{{${name}}}`)
        ));
      }
      return key;
    },
  }),
}));

vi.mock("../Knowledge/graphQuery", () => ({
  limitGraphVisualizationRecords: (records: unknown[], topK?: number) => {
    if (!Array.isArray(records)) {
      return [];
    }
    if (!Number.isFinite(topK)) {
      return records;
    }
    return records.slice(0, Math.max(1, Math.floor(Number(topK))));
  },
  recordsToVisualizationData: (records: unknown[], options?: unknown) => (
    mockRecordsToVisualizationData(records, options)
  ),
}));

function buildKnowledgeState(projectId: string): ProjectKnowledgeState {
  return {
    projectSourceId: `project-${projectId.toLowerCase()}-workspace`,
    sourceLoaded: true,
    sourceRegistered: true,
    projectStepStats: {},
    fileAnalysisStats: null,
    sourceScanStats: null,
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
      reason: "高阶输出尚未就绪，当前保持结构化与增强输出视角并等待深加工产物生成。",
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
      snapshotCount: 1,
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
    graphRelationTypeFilters: [],
    setGraphRelationTypeFilters: vi.fn(),
    graphEntityTypeFilters: [],
    setGraphEntityTypeFilters: vi.fn(),
    graphRelationTypeOptions: [],
    graphEntityTypeOptions: [],
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

  it("supports source switching and shows source, structured, and enhanced statuses in Explore", async () => {
    const user = userEvent.setup();
    const knowledgeState = buildKnowledgeState(projectId);
    const sourceA: KnowledgeSourceItem = {
      id: "project-project-abc-workspace",
      name: "Workspace Source",
      type: "directory",
      location: "/tmp/workspace-a",
      content: "",
      enabled: true,
      recursive: true,
      tags: ["project"],
      summary: "",
      project_id: projectId,
      status: {
        indexed: true,
        indexed_at: "2026-04-29T08:00:00+00:00",
        document_count: 10,
        chunk_count: 40,
        error: null,
      },
    };
    const sourceB: KnowledgeSourceItem = {
      id: "project-project-abc-docs",
      name: "Docs Source",
      type: "directory",
      location: "/tmp/workspace-b",
      content: "",
      enabled: true,
      recursive: true,
      tags: ["project"],
      summary: "",
      project_id: projectId,
      status: {
        indexed: false,
        indexed_at: "",
        document_count: 0,
        chunk_count: 0,
        error: null,
      },
    };
    knowledgeState.projectSources = [sourceA, sourceB];
    knowledgeState.selectedSourceId = sourceA.id;
    knowledgeState.processingCompareModes = [
      buildModeState({ mode: "nlp", status: "running" }),
      buildModeState({ mode: "agentic", status: "ready" }),
    ];

    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
        knowledgeState={knowledgeState}
        graphComponents={testGraphComponents}
      />,
    );

    expect(screen.getByText("Data Source")).not.toBeNull();
    expect(screen.getByText("Sources")).not.toBeNull();
    expect(screen.getByText("Structured")).not.toBeNull();
    expect(screen.getByText("Enhanced")).not.toBeNull();

    await user.click(screen.getByText("Workspace Source"));
    await user.click(await screen.findByText("Docs Source"));

    expect(knowledgeState.setSelectedSourceId).toHaveBeenCalledWith("project-project-abc-docs");
  });

  it("renders latest workflow snapshot across sources and processing in Explore", () => {
    const knowledgeState = buildKnowledgeState(projectId);
    knowledgeState.sourceScanStats = {
      project_id: projectId,
      step_id: "source_scan",
      latest: {
        project_id: projectId,
        source_id: `project-${projectId.toLowerCase()}-workspace`,
        step_id: "source_scan",
        updated_at: "2026-05-12T10:21:00Z",
        metrics: {
          data_file_count: 5,
          changed_path_count: 2,
          source_count: 1,
        },
      },
      history: [],
    };
    knowledgeState.fileAnalysisStats = {
      project_id: projectId,
      step_id: "file_analysis",
      latest: {
        project_id: projectId,
        source_id: `project-${projectId.toLowerCase()}-workspace`,
        step_id: "file_analysis",
        updated_at: "2026-05-12T10:31:00Z",
        metrics: {
          document_count: 3,
          chunk_count: 7,
          sentence_count: 11,
        },
      },
      history: [],
    };
    knowledgeState.projectStepStats = {
      domain_graph_build: {
        project_id: projectId,
        step_id: "domain_graph_build",
        latest: {
          project_id: projectId,
          source_id: `project-${projectId.toLowerCase()}-workspace`,
          step_id: "domain_graph_build",
          updated_at: "2026-05-12T10:41:00Z",
          metrics: {
            document_count: 3,
            node_count: 9,
            relation_count: 12,
          },
        },
        history: [],
      },
      quality_review: {
        project_id: projectId,
        step_id: "quality_review",
        latest: {
          project_id: projectId,
          source_id: `project-${projectId.toLowerCase()}-workspace`,
          step_id: "quality_review",
          updated_at: "2026-05-12T10:51:00Z",
          metrics: {
            quality_score_before: 0.91,
            quality_score_after: 0.95,
            quality_delta: 0.04,
            quality_rounds: 1,
          },
        },
        history: [],
      },
    };

    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
        knowledgeState={knowledgeState}
        graphComponents={testGraphComponents}
      />,
    );

    expect(screen.getByText("Latest workflow snapshot")).not.toBeNull();
    expect(screen.getByText(/5 files \/ 2 changed/)).not.toBeNull();
    expect(screen.getByText(/3 docs \/ 7 chunks \/ 11 sentences/)).not.toBeNull();
    expect(screen.getByText(/3 docs \/ 9 nodes \/ 12 relations/)).not.toBeNull();
    expect(screen.getByText(/0.91 -> 0.95 \/ delta 0.04 \/ 1 rounds/)).not.toBeNull();
  });

  it("formats graph filter labels into readable text", () => {
    const t = (_key: string, fallback: string) => fallback;

    expect(formatGraphEntityTypeLabel("entity", t)).toBe("Entity");
    expect(formatGraphEntityTypeLabel("document", t)).toBe("Document");
    expect(formatGraphRelationTypeLabel("co_occurs_with", t)).toBe("Co-occurs with");
    expect(formatGraphRelationTypeLabel("custom_relation_name", t)).toBe("Custom Relation Name");
  });

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

  it("keeps entity and relation type filters opt-in by default", () => {
    const knowledgeState = buildKnowledgeState(projectId);
    knowledgeState.graphEntityTypeOptions = ["entity", "document", "path"];
    knowledgeState.graphRelationTypeOptions = ["mentions", "located_in", "path_contains"];

    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
        knowledgeState={knowledgeState}
        graphComponents={testGraphComponents}
      />,
    );

    expect(screen.getByText("Entity type filter (shows all by default)")).not.toBeNull();
    expect(screen.getByText("Relation type filter (shows all by default)")).not.toBeNull();
    expect(knowledgeState.graphEntityTypeFilters).toEqual([]);
    expect(knowledgeState.graphRelationTypeFilters).toEqual([]);
    expect(knowledgeState.setGraphEntityTypeFilters).not.toHaveBeenCalled();
    expect(knowledgeState.setGraphRelationTypeFilters).not.toHaveBeenCalled();
  });

  it("limits visualization records by graph topK while keeping query results intact", () => {
    const knowledgeState = buildKnowledgeState(projectId);
    knowledgeState.graphQueryTopK = 2;
    knowledgeState.graphResult = {
      records: [
        {
          subject: "Alpha",
          predicate: "mentions",
          object: "Beta",
          score: 0.9,
          source_id: "source-1",
          source_type: "directory",
          document_path: "docs/a.md",
          document_title: "Doc A",
        },
        {
          subject: "Gamma",
          predicate: "mentions",
          object: "Delta",
          score: 0.8,
          source_id: "source-1",
          source_type: "directory",
          document_path: "docs/a.md",
          document_title: "Doc A",
        },
        {
          subject: "Epsilon",
          predicate: "mentions",
          object: "Zeta",
          score: 0.7,
          source_id: "source-1",
          source_type: "directory",
          document_path: "docs/a.md",
          document_title: "Doc A",
        },
      ],
      summary: "3 records",
      warnings: [],
      provenance: {},
    };

    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
        knowledgeState={knowledgeState}
        graphComponents={testGraphComponents}
      />,
    );

    expect(mockRecordsToVisualizationData).toHaveBeenCalled();
    const calls = mockRecordsToVisualizationData.mock.calls as unknown[][];
    const lastCall = calls[calls.length - 1];
    expect(lastCall?.[0]).toHaveLength(2);
    expect(knowledgeState.graphResult.records).toHaveLength(3);
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
