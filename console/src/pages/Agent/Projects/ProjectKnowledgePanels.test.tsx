import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProjectKnowledgeNerPanel from "./ProjectKnowledgeNerPanel";
import ProjectKnowledgeOutputsPanel from "./ProjectKnowledgeOutputsPanel";
import ProjectKnowledgeProcessingPanel from "./ProjectKnowledgeProcessingPanel";
import ProjectKnowledgeSignalsPanel from "./ProjectKnowledgeSignalsPanel";
import ProjectKnowledgeSourcesPanel from "./ProjectKnowledgeSourcesPanel";
import { buildModeState } from "./projectKnowledgeTestUtils";
import type { ProjectKnowledgeHeaderSignals, ProjectKnowledgeState } from "./useProjectKnowledgeState";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      maybeFallbackOrOptions?: string | Record<string, unknown>,
      maybeOptions?: Record<string, unknown>,
    ) => {
      if (typeof maybeFallbackOrOptions === "string") {
        return maybeFallbackOrOptions.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String((maybeOptions as Record<string, unknown> | undefined)?.[name] ?? ""));
      }
      return key;
    },
  }),
}));

function buildKnowledgeState(): ProjectKnowledgeState {
  const projectId = "project-abc";
  return {
    projectSourceId: "project-project-abc-workspace",
    sourceLoaded: true,
    sourceRegistered: true,
    projectStepStats: {
      build_interlinear: {
        project_id: projectId,
        step_id: "build_interlinear",
        latest: {
          project_id: projectId,
          source_id: "project-project-abc-workspace",
          step_id: "build_interlinear",
          updated_at: "2026-05-12T10:36:00Z",
          metrics: { document_count: 3, chunk_count: 7, sentence_count: 11 },
        },
        history: [],
      },
      tokenize: {
        project_id: projectId,
        step_id: "tokenize",
        latest: {
          project_id: projectId,
          source_id: "project-project-abc-workspace",
          step_id: "tokenize",
          updated_at: "2026-05-12T10:41:00Z",
          metrics: { document_count: 3, chunk_count: 7, sentence_count: 11 },
        },
        history: [],
      },
      pos_tagging: {
        project_id: projectId,
        step_id: "pos_tagging",
        latest: {
          project_id: projectId,
          source_id: "project-project-abc-workspace",
          step_id: "pos_tagging",
          updated_at: "2026-05-12T10:46:00Z",
          metrics: { document_count: 3, chunk_count: 7, sentence_count: 11 },
        },
        history: [],
      },
      syntax_parse: {
        project_id: projectId,
        step_id: "syntax_parse",
        latest: {
          project_id: projectId,
          source_id: "project-project-abc-workspace",
          step_id: "syntax_parse",
          updated_at: "2026-05-12T10:51:00Z",
          metrics: { document_count: 3, node_count: 9, relation_count: 12 },
        },
        history: [],
      },
      semantic_role_labeling: {
        project_id: projectId,
        step_id: "semantic_role_labeling",
        latest: {
          project_id: projectId,
          source_id: "project-project-abc-workspace",
          step_id: "semantic_role_labeling",
          updated_at: "2026-05-12T10:56:00Z",
          metrics: { quality_score_before: 0.91, quality_score_after: 0.95, quality_delta: 0.04, quality_rounds: 1 },
        },
        history: [],
      },
    } as ProjectKnowledgeState["projectStepStats"],
    fileAnalysisStats: {
      project_id: projectId,
      step_id: "build_chunks",
      latest: {
        project_id: projectId,
        source_id: "project-project-abc-workspace",
        step_id: "build_chunks",
        updated_at: "2026-05-12T10:31:00Z",
        metrics: { document_count: 3, snapshot_count: 3, chunk_count: 7, sentence_count: 11 },
      },
      history: [],
    },
    sourceScanStats: {
      project_id: projectId,
      step_id: "snapshot_raw",
      latest: {
        project_id: projectId,
        source_id: "project-project-abc-workspace",
        step_id: "snapshot_raw",
        updated_at: "2026-05-12T10:21:00Z",
        metrics: { data_file_count: 5, changed_path_count: 2, source_count: 1 },
      },
      history: [],
    },
    projectSources: [],
    selectedSourceId: "",
    setSelectedSourceId: vi.fn(),
    sourceContentById: {},
    sourceContentLoadingById: {},
    loadSourceContent: vi.fn().mockResolvedValue(null),
    syncState: {
      operation_id: "ps-test-123",
      idempotency_key: "manual-op-key-1",
      deduplicated: true,
      last_action: "start_sync",
      quantization_stage: "l3",
      operation_updated_at: "2026-04-11T23:30:00+00:00",
      semantic_engine: { engine: "hanlp2", status: "unavailable", reason_code: "HANLP2_IMPORT_UNAVAILABLE", reason: "", summary: "" },
    } as ProjectKnowledgeState["syncState"],
    activeKnowledgeTasks: [],
    activeKnowledgeTask: null,
    latestQualityLoopJob: null,
    memifyEnabled: true,
    processingModes: [buildModeState(), buildModeState({ mode: "nlp", status: "idle", available: false }), buildModeState({ mode: "agentic", status: "idle", available: false })],
    processingCompareModes: [buildModeState({ mode: "nlp", status: "idle", available: false }), buildModeState({ mode: "agentic", status: "idle", available: false })],
    processingCompareDelta: { entityDelta: 0, relationDelta: 0 },
    processingFreshness: { stale: false, staleModes: [], staleSources: [], channelStatus: { "project-sync": "open", tasks: "open" } },
    outputModes: [buildModeState({ mode: "agentic", status: "idle", available: false }), buildModeState({ mode: "nlp", status: "idle", available: false })],
    outputResolution: { activeMode: "agentic", availableModes: [], fallbackChain: ["agentic", "nlp"], reason: "" },
    processingScheduler: { strategy: "parallel", modeOrder: ["agentic", "nlp", "fast"], runningModes: [], queuedModes: ["nlp", "agentic"], readyModes: ["fast"], failedModes: [], nextMode: "nlp", consumptionMode: "fast", reason: "" },
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
    quantMetricsMeta: {
      source: "project_sync_merged",
      sourceId: "project-project-abc-workspace",
      updatedAt: "2026-05-12T10:00:00Z",
      sourceStatsUpdatedAt: "2026-05-12T10:00:00Z",
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
    trendDelta: { documentDelta: 0, chunkDelta: 0, relationDelta: 0 },
    syncAlertType: "info",
    syncAlertDescription: "sync ok",
    suggestedQuery: "Summarize key entities",
    insightAction: "query",
    insightMessageKey: "copaw.projects.knowledge.insightNeedExplore",
    loadProjectSourceStatus: vi.fn().mockResolvedValue(undefined),
    semanticBySourceId: {},
    semanticLoadingBySourceId: {},
    loadSourceSemantic: vi.fn().mockResolvedValue(undefined),
  } as ProjectKnowledgeState;
}

function buildHeaderSignals(knowledgeState: ProjectKnowledgeState): ProjectKnowledgeHeaderSignals {
  return {
    indexedRatio: knowledgeState.quantMetrics.indexedRatio,
    documentCount: knowledgeState.quantMetrics.documentCount,
    chunkCount: knowledgeState.quantMetrics.chunkCount,
    sentenceCount: knowledgeState.quantMetrics.sentenceCount,
    sentenceWithEntitiesCount: knowledgeState.quantMetrics.sentenceWithEntitiesCount,
    entityMentionsCount: knowledgeState.quantMetrics.entityMentionsCount,
    avgEntitiesPerSentence: knowledgeState.quantMetrics.avgEntitiesPerSentence,
    avgEntityCharRatio: knowledgeState.quantMetrics.avgEntityCharRatio,
    relationCount: knowledgeState.quantMetrics.relationCount,
    entityCount: knowledgeState.quantMetrics.entityCount,
    relationNormalizationCoverage: knowledgeState.quantMetrics.relationNormalizationCoverage,
    entityCanonicalCoverage: knowledgeState.quantMetrics.entityCanonicalCoverage,
    lowConfidenceRatio: knowledgeState.quantMetrics.lowConfidenceRatio,
    missingEvidenceRatio: knowledgeState.quantMetrics.missingEvidenceRatio,
    relationNormalizationThreshold: knowledgeState.quantMetrics.relationNormalizationThreshold,
    entityCanonicalThreshold: knowledgeState.quantMetrics.entityCanonicalThreshold,
    lowConfidenceThreshold: knowledgeState.quantMetrics.lowConfidenceThreshold,
    missingEvidenceThreshold: knowledgeState.quantMetrics.missingEvidenceThreshold,
    qualityAssessmentScore: knowledgeState.quantMetrics.qualityAssessmentScore,
  };
}

describe("project knowledge panels", () => {
  it("renders signals and sources panels", () => {
    const knowledgeState = buildKnowledgeState();

    render(
      <ProjectKnowledgeSignalsPanel
        knowledgeState={knowledgeState}
        knowledgeHeaderSignals={buildHeaderSignals(knowledgeState)}
        runtimeSignalValue="Idle"
        runtimeSignalTooltipContent={<div>Runtime</div>}
        runtimeSignalTooltipOpen
      />,
    );

    expect(screen.getByText("Health")).not.toBeNull();
    expect(screen.getByText(/Backend merged sync metrics/)).not.toBeNull();

    render(<ProjectKnowledgeSourcesPanel knowledgeState={knowledgeState} />);
    expect(screen.getByText("Sources")).not.toBeNull();
    expect(screen.getByText("Snapshots")).not.toBeNull();
  });

  it("renders processing and outputs panels", () => {
    const knowledgeState = buildKnowledgeState();

    render(<ProjectKnowledgeProcessingPanel knowledgeState={knowledgeState} />);
    expect(screen.getByText("Processing")).not.toBeNull();

    render(<ProjectKnowledgeOutputsPanel knowledgeState={knowledgeState} />);
    expect(screen.getByText("Latest output provenance")).not.toBeNull();
  });

  it("renders NER panel", () => {
    const knowledgeState = buildKnowledgeState();

    render(<ProjectKnowledgeNerPanel knowledgeState={knowledgeState} />);
    expect(screen.getByText("NER")).not.toBeNull();
    expect(screen.getByText("No source content loaded yet. Open Sources or trigger sync first.")).not.toBeNull();
  });
});