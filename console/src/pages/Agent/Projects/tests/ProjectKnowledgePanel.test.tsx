import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ProjectKnowledgePanel from "../components/ProjectKnowledgePanel";
import { buildModeState } from "../utils/projectKnowledgeTestUtils";
import type { KnowledgeSourceItem } from "../../../../api/types";
import type { ProjectKnowledgeState } from "../hooks/useProjectKnowledgeState";

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

vi.mock("../../Knowledge/graphQuery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../Knowledge/graphQuery")>();
  return {
    ...actual,
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
  };
});

function buildKnowledgeState(projectId: string): ProjectKnowledgeState {
  return {
    projectSourceId: `project-${projectId.toLowerCase()}-workspace`,
    sourceLoaded: true,
    sourceRegistered: true,
    projectStepStats: {
      build_interlinear: null,
      tokenize: null,
      pos_tagging: null,
      syntax_parse: null,
      semantic_role_labeling: null,
    } as ProjectKnowledgeState["projectStepStats"],
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
      buildModeState({ mode: "nlp", status: "idle", available: false }),
      buildModeState({ mode: "agentic", status: "idle", available: false }),
    ],
    processingCompareModes: [
      buildModeState({ mode: "nlp", status: "idle", available: false }),
      buildModeState({ mode: "agentic", status: "idle", available: false }),
    ],
    processingCompareDelta: { entityDelta: 0, relationDelta: 0 },
    processingFreshness: {
      stale: false,
      staleModes: [],
      staleSources: [],
      channelStatus: { "project-pipeline": "open", tasks: "open" },
    },
    outputModes: [
      buildModeState({ mode: "agentic", status: "idle", available: false }),
      buildModeState({ mode: "nlp", status: "idle", available: false }),
    ],
    outputResolution: {
      activeMode: "agentic",
      availableModes: [],
      fallbackChain: ["agentic", "nlp"],
      reason: "",
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
      reason: "",
    },
    modeOutputs: {
      fast: { mode: "fast", source: "indexed-preview", summaryLines: ["Documents: 1"], artifacts: [] },
      nlp: { mode: "nlp", source: "graph-artifacts", summaryLines: ["Entities: 0"], artifacts: [] },
      agentic: { mode: "agentic", source: "pipeline-artifacts", summaryLines: ["Run:"], artifacts: [] },
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
    runSourceFullPipeline: vi.fn().mockResolvedValue(undefined),
    rerunKnowledgeLayer: vi.fn().mockResolvedValue(undefined),
    processingLaunchMode: null,
    resetGraphQuery: vi.fn(),
    trendRangeDays: 7,
    setTrendRangeDays: vi.fn(),
    trendExpanded: true,
    setTrendExpanded: vi.fn(),
    filteredTrendSnapshots: [],
    trendDocumentPath: "",
    trendChunkPath: "",
    trendDelta: { documentDelta: 0, chunkDelta: 0, relationDelta: 0 },
    syncAlertType: "info",
    syncAlertDescription: "",
    suggestedQuery: `Summarize key entities, modules, and relations in project ${projectId}`,
    insightAction: "healthy",
    insightMessageKey: "copaw.projects.knowledge.insightHealthy",
    loadProjectSourceStatus: vi.fn().mockResolvedValue(undefined),
    semanticBySourceId: {},
    semanticLoadingBySourceId: {},
    loadSourceSemantic: vi.fn().mockResolvedValue(undefined),
    changedFilesNormalized: [],
  } as ProjectKnowledgeState;
}

function buildCanonicalStats(projectId: string) {
  return {
    snapshotRaw: {
      project_id: projectId,
      source_id: `project-${projectId.toLowerCase()}-workspace`,
      step_id: "snapshot_raw",
      updated_at: "2026-05-12T10:21:00Z",
      metrics: { data_file_count: 5, changed_path_count: 2, source_count: 1 },
    },
    buildChunks: {
      project_id: projectId,
      source_id: `project-${projectId.toLowerCase()}-workspace`,
      step_id: "build_chunks",
      updated_at: "2026-05-12T10:31:00Z",
      metrics: { document_count: 3, chunk_count: 7, sentence_count: 11 },
    },
    buildInterlinear: {
      project_id: projectId,
      source_id: `project-${projectId.toLowerCase()}-workspace`,
      step_id: "build_interlinear",
      updated_at: "2026-05-12T10:36:00Z",
      metrics: { document_count: 3, chunk_count: 7, sentence_count: 11 },
    },
    tokenize: {
      project_id: projectId,
      source_id: `project-${projectId.toLowerCase()}-workspace`,
      step_id: "tokenize",
      updated_at: "2026-05-12T10:41:00Z",
      metrics: { document_count: 3, chunk_count: 7, sentence_count: 11 },
    },
    posTagging: {
      project_id: projectId,
      source_id: `project-${projectId.toLowerCase()}-workspace`,
      step_id: "pos_tagging",
      updated_at: "2026-05-12T10:46:00Z",
      metrics: { document_count: 3, chunk_count: 7, sentence_count: 11 },
    },
    syntaxParse: {
      project_id: projectId,
      source_id: `project-${projectId.toLowerCase()}-workspace`,
      step_id: "syntax_parse",
      updated_at: "2026-05-12T10:51:00Z",
      metrics: { document_count: 3, node_count: 9, relation_count: 12 },
    },
    semanticRoleLabeling: {
      project_id: projectId,
      source_id: `project-${projectId.toLowerCase()}-workspace`,
      step_id: "semantic_role_labeling",
      updated_at: "2026-05-12T10:56:00Z",
      metrics: { quality_score_before: 0.91, quality_score_after: 0.95, quality_delta: 0.04, quality_rounds: 1 },
    },
  };
}

describe("ProjectKnowledgePanel", () => {
  it("renders canonical workflow snapshot", () => {
    const projectId = "project-abc";
    const knowledgeState = buildKnowledgeState(projectId);
    const stats = buildCanonicalStats(projectId);
    knowledgeState.sourceScanStats = { project_id: projectId, step_id: "snapshot_raw", latest: stats.snapshotRaw, history: [] };
    knowledgeState.fileAnalysisStats = { project_id: projectId, step_id: "build_chunks", latest: stats.buildChunks, history: [] };
    knowledgeState.projectStepStats = {
      build_interlinear: { project_id: projectId, step_id: "build_interlinear", latest: stats.buildInterlinear, history: [] },
      tokenize: { project_id: projectId, step_id: "tokenize", latest: stats.tokenize, history: [] },
      pos_tagging: { project_id: projectId, step_id: "pos_tagging", latest: stats.posTagging, history: [] },
      syntax_parse: { project_id: projectId, step_id: "syntax_parse", latest: stats.syntaxParse, history: [] },
      semantic_role_labeling: { project_id: projectId, step_id: "semantic_role_labeling", latest: stats.semanticRoleLabeling, history: [] },
    } as ProjectKnowledgeState["projectStepStats"];

    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
        knowledgeState={knowledgeState}
        graphComponents={{
          GraphQueryResults: () => <div data-testid="graph-query-results" />,
          GraphVisualization: () => <div data-testid="graph-visualization" />,
        }}
      />,
    );

    expect(screen.getByText("copaw.projects.knowledge.latestWorkflowSummary")).not.toBeNull();
    expect(screen.getByText(/copaw\.projects\.knowledge\.latestSnapshotRawSummary/)).not.toBeNull();
    expect(screen.getByText(/copaw\.projects\.knowledge\.latestBuildChunksSummary/)).not.toBeNull();
    expect(screen.getByText(/copaw\.projects\.knowledge\.latestSemanticRoleLabelingSummary/)).not.toBeNull();
  });

  it("switches sources", async () => {
    const user = userEvent.setup();
    const projectId = "project-abc";
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
      status: { indexed: true, indexed_at: "2026-04-29T08:00:00+00:00", document_count: 10, chunk_count: 40, error: null },
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
      status: { indexed: false, indexed_at: "", document_count: 0, chunk_count: 0, error: null },
    };
    knowledgeState.projectSources = [sourceA, sourceB];
    knowledgeState.selectedSourceId = sourceA.id;

    render(
      <ProjectKnowledgePanel
        projectId={projectId}
        projectName="Project ABC"
        knowledgeState={knowledgeState}
        graphComponents={{
          GraphQueryResults: () => <div data-testid="graph-query-results" />,
          GraphVisualization: () => <div data-testid="graph-visualization" />,
        }}
      />,
    );

    expect(screen.getByText("copaw.projects.knowledge.dataSource")).not.toBeNull();
    expect(screen.getByText("Workspace Source")).not.toBeNull();

    await user.click(screen.getByText("Workspace Source"));
    await user.click(await screen.findByText("Docs Source"));

    expect(knowledgeState.setSelectedSourceId).toHaveBeenCalledWith("project-project-abc-docs");
  });
});