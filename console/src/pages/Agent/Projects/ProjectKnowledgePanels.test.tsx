import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ProjectKnowledgeOutputsPanel from "./ProjectKnowledgeOutputsPanel";
import ProjectKnowledgeNerPanel from "./ProjectKnowledgeNerPanel";
import ProjectKnowledgeProcessingPanel from "./ProjectKnowledgeProcessingPanel";
import ProjectKnowledgeSignalsPanel from "./ProjectKnowledgeSignalsPanel";
import ProjectKnowledgeSourcesPanel from "./ProjectKnowledgeSourcesPanel";
import { buildModeState } from "./projectKnowledgeTestUtils";
import type { ProjectKnowledgeSemanticEngineState } from "../../../api/types/knowledge";
import type { ProjectKnowledgeState } from "./useProjectKnowledgeState";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      maybeFallbackOrOptions?: string | { value?: number },
      maybeOptions?: Record<string, unknown>,
    ) => {
      const fallback = typeof maybeFallbackOrOptions === "string" ? maybeFallbackOrOptions : undefined;
      const options = (typeof maybeFallbackOrOptions === "object"
        ? maybeFallbackOrOptions
        : maybeOptions) as Record<string, unknown> | { value?: number } | undefined;
      const interpolationValues = options as Record<string, unknown> | undefined;
      if (typeof fallback === "string") {
        return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(interpolationValues?.[name] ?? ""));
      }
      if (typeof maybeFallbackOrOptions === "string") {
        return maybeFallbackOrOptions;
      }
      if (key === "projects.knowledge.signalDelta") {
        return String(maybeFallbackOrOptions?.value ?? 0);
      }
      return key;
    },
  }),
}));

function buildSemanticEngineState(
  overrides: Partial<ProjectKnowledgeSemanticEngineState> = {},
): ProjectKnowledgeSemanticEngineState {
  return {
    engine: "hanlp2",
    status: "unavailable",
    reason_code: "HANLP2_IMPORT_UNAVAILABLE",
    reason: "HanLP2 module is not installed or failed to import.",
    summary: "Semantic engine unavailable: HanLP2 module is not installed.",
    ...overrides,
  };
}

function buildKnowledgeHeaderSignals(knowledgeState: ProjectKnowledgeState) {
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

function buildKnowledgeState(): ProjectKnowledgeState {
  return {
    projectSourceId: "project-project-abc-workspace",
    sourceLoaded: true,
    sourceRegistered: true,
    projectStepStats: {},
    fileAnalysisStats: null,
    sourceScanStats: null,
    projectSources: [
      {
        id: "project-project-abc-workspace",
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
          indexed_at: "2026-04-11T23:30:00+00:00",
          document_count: 3,
          snapshot_count: 3,
          chunk_count: 7,
          error: null,
        },
      },
    ],
    selectedSourceId: "project-project-abc-workspace",
    setSelectedSourceId: vi.fn(),
    sourceContentById: {
      "project-project-abc-workspace": {
        indexed: true,
        indexed_at: "2026-04-11T23:30:00+00:00",
        document_count: 3,
        chunk_count: 7,
        documents: [
          {
            path: "original/guide.md",
            title: "guide.md",
            text: "guide body",
            ner_status: "ready",
            ner_input_mode: "interlinear_full_document",
            ner_entity_count: 2,
            ner_batch_count: 3,
            ner_worker_restart_count: 1,
            ner_worker_pids: [83303, 83304],
            ner_structured_text: JSON.stringify({
              entity_catalog: [
                { normalized: "agent", label: "ORG", mention_count: 2 },
                { normalized: "workflow", label: "PRODUCT", mention_count: 1 },
              ],
              entity_mentions: [
                { surface: "Agent", label: "ORG" },
                { surface: "agent", label: "ORG" },
                { surface: "workflow", label: "PRODUCT" },
              ],
            }),
          },
        ],
      },
    },
    sourceContentLoadingById: {},
    loadSourceContent: vi.fn().mockResolvedValue(null),
    syncState: {
      project_id: "project-abc",
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
      latest_source_id: "project-project-abc-workspace",
      last_result: {},
      semantic_engine: buildSemanticEngineState(),
    },
    activeKnowledgeTasks: [],
    activeKnowledgeTask: null,
    latestQualityLoopJob: {
      job_id: "quality-loop-job-1",
      status: "succeeded",
      rounds: [
        {
          round: 1,
          after: {
            quality_score: 0.76,
          },
        },
        {
          round: 2,
          after: {
            quality_score: 0.81,
          },
        },
      ],
    },
    memifyEnabled: true,
    processingModes: [
      buildModeState({
        lastUpdatedAt: "2026-04-11T23:30:00+00:00",
        jobId: "job-fast",
        documentCount: 3,
        chunkCount: 7,
      }),
      buildModeState({
        mode: "nlp",
        stage: "NLP graph artifacts ready",
        summary: "中等复杂度知识产物，可作为多智能体结果的回退层。",
        lastUpdatedAt: "2026-04-11T23:30:00+00:00",
        jobId: "job-nlp",
        documentCount: 3,
        chunkCount: 7,
        entityCount: 2,
        relationCount: 12,
        corReadyChunkCount: 5,
        corClusterCount: 7,
        corReplacementCount: 4,
        nerReadyChunkCount: 4,
        nerEntityCount: 9,
        nerBatchCount: 3,
        nerWorkerRestartCount: 1,
        nerWorkerPidCount: 2,
        syntaxReadyChunkCount: 6,
        syntaxSentenceCount: 11,
        syntaxTokenCount: 42,
        syntaxRelationCount: 13,
        qualityScore: 0.86,
      }),
      buildModeState({
        mode: "agentic",
        status: "queued",
        available: false,
        progress: 45,
        stage: "Waiting for multi-agent workflow scheduling",
        summary: "长耗时深加工轨道，产物缺失时将自动降级。",
        lastUpdatedAt: "2026-04-11T23:30:00+00:00",
        runId: "run-knowledge-1",
        jobId: "job-agentic",
        documentCount: 3,
        chunkCount: 7,
        entityCount: 2,
        relationCount: 12,
        qualityScore: 0.86,
      }),
    ],
    processingCompareModes: [
      buildModeState({
        mode: "nlp",
        stage: "NLP graph artifacts ready",
        summary: "中等复杂度知识产物，可作为多智能体结果的回退层。",
        lastUpdatedAt: "2026-04-11T23:30:00+00:00",
        jobId: "job-nlp",
        documentCount: 3,
        chunkCount: 7,
        entityCount: 2,
        relationCount: 12,
        corReadyChunkCount: 5,
        corClusterCount: 7,
        corReplacementCount: 4,
        nerReadyChunkCount: 4,
        nerEntityCount: 9,
        nerBatchCount: 3,
        nerWorkerRestartCount: 1,
        nerWorkerPidCount: 2,
        syntaxReadyChunkCount: 6,
        syntaxSentenceCount: 11,
        syntaxTokenCount: 42,
        syntaxRelationCount: 13,
      }),
      buildModeState({
        mode: "agentic",
        status: "queued",
        available: false,
        progress: 45,
        stage: "Waiting for multi-agent workflow scheduling",
        summary: "长耗时深加工轨道，产物缺失时将自动降级。",
        lastUpdatedAt: "2026-04-11T23:30:00+00:00",
        runId: "run-knowledge-1",
        jobId: "job-agentic",
        documentCount: 3,
        chunkCount: 7,
        entityCount: 2,
        relationCount: 12,
        qualityScore: 0.86,
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
        status: "queued",
        available: false,
        progress: 45,
        stage: "Waiting for multi-agent workflow scheduling",
        summary: "长耗时深加工轨道，产物缺失时将自动降级。",
        lastUpdatedAt: "2026-04-11T23:30:00+00:00",
        runId: "run-knowledge-1",
        jobId: "job-agentic",
        documentCount: 3,
        chunkCount: 7,
        entityCount: 2,
        relationCount: 12,
        qualityScore: 0.86,
      }),
      buildModeState({
        mode: "nlp",
        stage: "NLP graph artifacts ready",
        summary: "中等复杂度知识产物，可作为多智能体结果的回退层。",
        lastUpdatedAt: "2026-04-11T23:30:00+00:00",
        jobId: "job-nlp",
        documentCount: 3,
        chunkCount: 7,
        entityCount: 2,
        relationCount: 12,
      }),
    ],
    outputResolution: {
      activeMode: "nlp",
      availableModes: ["nlp"],
      fallbackChain: ["agentic", "nlp"],
      reason: "多智能体产物缺失，已自动降级到 NLP 产物。",
    },
    processingScheduler: {
      strategy: "parallel",
      modeOrder: ["agentic", "nlp", "fast"],
      runningModes: [],
      queuedModes: ["agentic"],
      readyModes: ["nlp", "fast"],
      failedModes: [],
      nextMode: "agentic",
      consumptionMode: "nlp",
      reason: "当前无活跃执行，下一条待推进轨道为 agentic。",
    },
    modeOutputs: {
      fast: {
        mode: "fast",
        source: "indexed-preview",
        summaryLines: ["Documents: 3", "Chunks: 7"],
        artifacts: [
          {
            kind: "index",
            label: "Indexed source payload",
            path: "projects/project-abc/.knowledge/sources/project-project-abc-workspace/index.json",
          },
        ],
      },
      nlp: {
        mode: "nlp",
        source: "graph-artifacts",
        summaryLines: ["Entities: 2", "Relations: 12"],
        artifacts: [
          {
            kind: "graph",
            label: "Raw knowledge graph",
            path: "projects/project-abc/.knowledge/graphify-out/graph.json",
          },
        ],
      },
      agentic: {
        mode: "agentic",
        source: "workflow-artifacts",
        summaryLines: ["Run: run-knowledge-1", "Status: queued"],
        artifacts: [
          {
            kind: "workflow_artifact",
            label: "graph.enriched.json",
            path: "projects/project-abc/.knowledge/graphify-out/graph.enriched.json",
          },
        ],
      },
    },
    quantMetrics: {
      totalSources: 1,
      indexedSources: 1,
      indexedRatio: 1,
      documentCount: 3,
      snapshotCount: 3,
      chunkCount: 7,
      sentenceCount: 11,
      sentenceWithEntitiesCount: 9,
      entityMentionsCount: 15,
      avgEntitiesPerSentence: 1.36,
      avgEntityCharRatio: 0.23,
      relationCount: 12,
      entityCount: 2,
      relationNormalizationCoverage: 0.8,
      entityCanonicalCoverage: 0.75,
      lowConfidenceRatio: 0.1,
      missingEvidenceRatio: 0.05,
      relationNormalizationThreshold: 0.58,
      entityCanonicalThreshold: 0.55,
      lowConfidenceThreshold: 0.2,
      missingEvidenceThreshold: 0.22,
      qualityAssessmentScore: 0.86,
    },
    quantMetricsMeta: {
      source: "project_sync_merged",
      updatedAt: "2026-04-28T10:00:00+00:00",
      sourceId: "project-project-abc-workspace",
      sourceStatsUpdatedAt: "2026-04-28T09:59:00+00:00",
    },
    graphQueryText: "Summarize key entities",
    setGraphQueryText: vi.fn(),
    graphQueryTopK: 200,
    setGraphQueryTopK: vi.fn(),
    graphQueryMode: "template",
    setGraphQueryMode: vi.fn(),
    graphNeedsRefresh: false,
    markGraphNeedsRefresh: vi.fn(),
    graphLoading: false,
    graphError: "",
    graphResult: {
      records: [
        {
          subject: "Agent",
          subject_type: "entity",
          predicate: "uses",
          object: "Workflow",
          object_type: "entity",
          score: 0.9,
          source_id: "project-project-abc-workspace",
          source_type: "directory",
          document_path: "original/guide.md",
          document_title: "guide.md",
        },
      ],
      summary: "1 record",
      provenance: {},
      warnings: [],
    },
    graphRelationTypeFilters: [],
    setGraphRelationTypeFilters: vi.fn(),
    graphEntityTypeFilters: [],
    setGraphEntityTypeFilters: vi.fn(),
    graphRelationTypeOptions: ["uses"],
    graphEntityTypeOptions: ["entity"],
    relationRecords: [
      {
        subject: "Agent",
        subject_type: "entity",
        predicate: "uses",
        object: "Workflow",
        object_type: "entity",
        score: 0.9,
        source_id: "project-project-abc-workspace",
        source_type: "directory",
        document_path: "original/guide.md",
        document_title: "guide.md",
      },
    ],
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
    filteredTrendSnapshots: [
      {
        ts: Date.now() - 1000,
        indexedRatio: 1,
        documentCount: 2,
        chunkCount: 5,
        relationCount: 8,
      },
      {
        ts: Date.now(),
        indexedRatio: 1,
        documentCount: 3,
        chunkCount: 7,
        relationCount: 12,
      },
    ],
    trendDocumentPath: "M0,0 L1,1",
    trendChunkPath: "M0,1 L1,0",
    trendDelta: {
      documentDelta: 1,
      chunkDelta: 2,
      relationDelta: 4,
    },
    syncAlertType: "info",
    syncAlertDescription: "sync ok",
    suggestedQuery: "Summarize key entities",
    insightAction: "query",
    insightMessageKey: "projects.knowledge.insightNeedExplore",
    loadProjectSourceStatus: vi.fn().mockResolvedValue(undefined),
    semanticBySourceId: {},
    semanticLoadingBySourceId: {},
    loadSourceSemantic: vi.fn().mockResolvedValue(undefined),
  };
}

describe("project knowledge supporting panels", () => {
  it("renders health content outside explore", () => {
    const knowledgeState = buildKnowledgeState();
    knowledgeState.sourceScanStats = {
      project_id: "project-abc",
      step_id: "source_scan",
      latest: {
        project_id: "project-abc",
        source_id: "project-project-abc-workspace",
        step_id: "source_scan",
        updated_at: "2026-05-12T09:21:00Z",
        metrics: {
          data_file_count: 5,
          changed_path_count: 2,
          source_count: 1,
        },
      },
      history: [],
    };
    knowledgeState.fileAnalysisStats = {
      project_id: "project-abc",
      step_id: "file_analysis",
      latest: {
        project_id: "project-abc",
        source_id: "project-project-abc-workspace",
        step_id: "file_analysis",
        updated_at: "2026-05-12T09:31:00Z",
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
        project_id: "project-abc",
        step_id: "domain_graph_build",
        latest: {
          project_id: "project-abc",
          source_id: "project-project-abc-workspace",
          step_id: "domain_graph_build",
          indexed_at: "2026-05-12T10:40:00Z",
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
        project_id: "project-abc",
        step_id: "quality_review",
        latest: {
          project_id: "project-abc",
          source_id: "project-project-abc-workspace",
          step_id: "quality_review",
          indexed_at: "2026-05-12T10:50:00Z",
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
    const baseSyncState = knowledgeState.syncState;
    if (!baseSyncState) {
      throw new Error("syncState fixture missing");
    }
    knowledgeState.syncState = {
      ...baseSyncState,
      operation_id: "ps-test-123",
      idempotency_key: "manual-op-key-1",
      deduplicated: true,
      last_action: "start_sync",
      quantization_stage: "l3",
      operation_updated_at: "2026-04-11T23:30:00+00:00",
    };
    const runtimeTooltipContent = (
      <div>
        <span>Runtime</span>
        <span>Semantic Engine: Module Unavailable. Code: HANLP2_IMPORT_UNAVAILABLE</span>
        <span>Updated: 2026-04-11 23:30:00</span>
      </div>
    );
    const { container } = render(
      <ProjectKnowledgeSignalsPanel
        knowledgeState={knowledgeState}
        knowledgeHeaderSignals={buildKnowledgeHeaderSignals(knowledgeState)}
        runtimeSignalValue="Idle"
        runtimeSignalTooltipContent={runtimeTooltipContent}
        runtimeSignalTooltipOpen
      />,
    );

    expect(screen.getByText("projects.knowledge.signalsTitle")).not.toBeNull();
    expect(screen.getByText(/Metrics Source/)).not.toBeNull();
    expect(screen.getByText(/Backend merged sync metrics/)).not.toBeNull();
    expect(screen.getByText(/Latest Sources:/)).not.toBeNull();
    expect(screen.getByText(/5 files \/ 2 changed/)).not.toBeNull();
    expect(screen.getByText(/3 docs \/ 7 chunks \/ 11 sentences/)).not.toBeNull();
    expect(screen.getByText(/Latest Processing:/)).not.toBeNull();
    expect(screen.getByText(/3 docs \/ 9 nodes \/ 12 relations/)).not.toBeNull();
    expect(screen.getByText(/0.91 -> 0.95 \/ delta 0.04 \/ 1 rounds/)).not.toBeNull();
    expect(screen.getAllByText("projects.knowledge.signalRelations").length).toBeGreaterThan(0);
    expect(screen.getAllByText("实体数").length).toBeGreaterThan(0);
    expect(screen.getByText("Semantic Engine")).not.toBeNull();
    expect(screen.getByText("Module Unavailable")).not.toBeNull();
    expect(screen.getByText(/Semantic Engine: Module Unavailable/)).not.toBeNull();
    expect(screen.getByText(/HANLP2_IMPORT_UNAVAILABLE/)).not.toBeNull();
    expect(screen.getByText("Sync Trace")).not.toBeNull();
    expect(screen.getByText("ps-test-123")).not.toBeNull();
    expect(screen.getByText(/Key: manual-op-key-1/)).not.toBeNull();
    expect(screen.getByText(/Deduplicated: Yes/)).not.toBeNull();
    expect(screen.getByText(/Action: start_sync/)).not.toBeNull();
    expect(screen.getByText(/Stage:/)).not.toBeNull();
    expect((document.body.textContent || "").match(/Sync Trace[\s\S]*Updated\s*:/)).not.toBeNull();

    const signalLabels = Array.from(
      container.querySelectorAll("._projectKnowledgeSignalCard_209b2b .ant-typography-secondary"),
    ).map((element) => element.textContent);
    expect(signalLabels).toEqual([
      "projects.knowledge.signalDocuments",
      "projects.knowledge.signalChunks",
      "Sentences",
      "Entity Mentions",
      "Entities/Sentence",
      "Entity Char Ratio",
      "Coverage",
      "projects.knowledge.signalRelations",
      "实体数",
      "NER Batches",
      "Worker Restarts",
      "Worker PID Count",
    ]);
  });

  it("shows degraded realtime status in the health panel", () => {
    const knowledgeState = buildKnowledgeState();

    render(
      <ProjectKnowledgeSignalsPanel
        knowledgeState={knowledgeState}
        knowledgeHeaderSignals={buildKnowledgeHeaderSignals(knowledgeState)}
        realtimeConnectionStatus="degraded"
        realtimeConnectionText="Realtime degraded"
        realtimeReconnectAttempt={3}
        showRealtimeConnectionNotice
        runtimeSignalValue="Idle"
        runtimeSignalTooltipContent={<div>Runtime</div>}
        runtimeSignalTooltipOpen={false}
      />,
    );

    expect(screen.getByText("Realtime degraded")).not.toBeNull();
    expect(screen.getByText("Attempt 3")).not.toBeNull();
  });

  it("renders source inventory", () => {
    render(<ProjectKnowledgeSourcesPanel knowledgeState={buildKnowledgeState()} />);

    expect(screen.queryByText(/L1 基线/)).toBeNull();
    expect(screen.getByRole("img", { hidden: true })).not.toBeNull();

    const { container } = render(<ProjectKnowledgeSourcesPanel knowledgeState={buildKnowledgeState()} />);

    const signalLabels = Array.from(
      container.querySelectorAll("._projectKnowledgeSignalCard_209b2b .ant-typography-secondary"),
    ).map((element) => element.textContent);

    expect(signalLabels).toEqual([
      "projects.knowledge.signalDocuments",
      "Snapshots",
      "projects.knowledge.signalChunks",
      "Sentences🛈",
      "Lightweight Tokens🛈",
      "Characters🛈",
    ]);
  });

  it("renders recent analysis runs in sources panel when project stats history is available", () => {
    const knowledgeState = buildKnowledgeState();
    knowledgeState.sourceScanStats = {
      project_id: "project-abc",
      step_id: "source_scan",
      latest: {
        project_id: "project-abc",
        source_id: "project-project-abc-workspace",
        step_id: "source_scan",
        indexed_at: "2026-05-12T10:20:00Z",
        updated_at: "2026-05-12T10:21:00Z",
        metrics: {
          data_file_count: 5,
          changed_path_count: 2,
          source_count: 1,
        },
      },
      history: [
        {
          project_id: "project-abc",
          source_id: "project-project-abc-workspace",
          step_id: "source_scan",
          indexed_at: "2026-05-12T10:20:00Z",
          updated_at: "2026-05-12T10:21:00Z",
          metrics: {
            data_file_count: 5,
            changed_path_count: 2,
            source_count: 1,
          },
        },
      ],
    };
    knowledgeState.fileAnalysisStats = {
      project_id: "project-abc",
      step_id: "file_analysis",
      latest: {
        project_id: "project-abc",
        source_id: "project-project-abc-workspace",
        step_id: "file_analysis",
        indexed_at: "2026-05-12T10:30:00Z",
        updated_at: "2026-05-12T10:31:00Z",
        metrics: {
          document_count: 3,
          snapshot_count: 3,
          chunk_count: 7,
          sentence_count: 11,
        },
      },
      history: [
        {
          project_id: "project-abc",
          source_id: "project-project-abc-workspace",
          step_id: "file_analysis",
          indexed_at: "2026-05-12T10:30:00Z",
          updated_at: "2026-05-12T10:31:00Z",
          metrics: {
            document_count: 3,
            snapshot_count: 3,
            chunk_count: 7,
            sentence_count: 11,
          },
        },
      ],
    };

    render(<ProjectKnowledgeSourcesPanel knowledgeState={knowledgeState} />);

    expect(screen.getByText("最近扫描")).not.toBeNull();
    expect(screen.getByText("最近的 source_scan 项目统计")).not.toBeNull();
    expect(screen.getByText("5 files / 2 changed / 1 sources")).not.toBeNull();
    expect(screen.getByText("最近分析运行")).not.toBeNull();
    expect(screen.getByText("最近的文件分析项目统计")).not.toBeNull();
    expect(screen.getByText("3 docs / 7 chunks / 11 sentences")).not.toBeNull();
  });

  it("renders processing summary and layer matrix", () => {
    const knowledgeState = buildKnowledgeState();
    const baseSyncState = knowledgeState.syncState;
    if (!baseSyncState) {
      throw new Error("syncState fixture missing");
    }
    knowledgeState.processingCompareModes = knowledgeState.processingCompareModes.map((mode) => (
      mode.mode === "agentic"
        ? {
          ...mode,
          auditRound: 2,
        }
        : mode
    ));
    knowledgeState.syncState = {
      ...baseSyncState,
      latest_requested_mode: "nlp",
      quantization_stage: "l2",
    };
    knowledgeState.processingCompareModes = knowledgeState.processingCompareModes.map((mode) => (
      mode.mode === "nlp"
        ? {
          ...mode,
          stage: "Waiting for graph extraction · Semantic engine unavailable: HanLP2 module is not installed.",
        }
        : mode
    ));
    knowledgeState.sourceScanStats = {
      latest: null,
      history: [
        {
          project_id: "project-abc",
          source_id: "project-project-abc-workspace",
          step_id: "source_scan",
          updated_at: "2026-05-12T10:21:00Z",
          metrics: {
            data_file_count: 5,
            changed_path_count: 2,
            source_count: 1,
          },
        },
      ],
    } as any;
    knowledgeState.fileAnalysisStats = {
      latest: null,
      history: [
        {
          project_id: "project-abc",
          source_id: "project-project-abc-workspace",
          step_id: "file_analysis",
          updated_at: "2026-05-12T10:31:00Z",
          metrics: {
            document_count: 3,
            chunk_count: 7,
            sentence_count: 11,
          },
        },
      ],
    } as any;
    knowledgeState.projectStepStats = {
      domain_graph_build: {
        latest: null,
        history: [
          {
            project_id: "project-abc",
            source_id: "project-project-abc-workspace",
            step_id: "domain_graph_build",
            updated_at: "2026-05-12T10:41:00Z",
            metrics: {
              document_count: 3,
              node_count: 9,
              relation_count: 12,
            },
          },
        ],
      },
      quality_review: {
        latest: null,
        history: [
          {
            project_id: "project-abc",
            source_id: "project-project-abc-workspace",
            step_id: "quality_review",
            updated_at: "2026-05-12T10:51:00Z",
            metrics: {
              quality_score_before: 0.91,
              quality_score_after: 0.95,
              quality_delta: 0.04,
              quality_rounds: 1,
            },
          },
        ],
      },
    } as any;

    render(<ProjectKnowledgeProcessingPanel knowledgeState={knowledgeState} />);

    const expectSignalValue = (label: string, value: string) => {
      const labelNode = screen.getByText(label);
      const cardNode = labelNode.closest("div");
      expect(cardNode).not.toBeNull();
      if (!(cardNode instanceof HTMLElement)) {
        return;
      }
      const valueNode = within(cardNode).getByText(value);
      expect(valueNode).not.toBeNull();
    };

    expect(screen.getByText("Processing")).not.toBeNull();
    expect(screen.queryByText("极速模式")).toBeNull();
    expect(screen.getByText("结构化实体数")).not.toBeNull();
    expect(screen.getByText("增强后关系数")).not.toBeNull();
    expectSignalValue("结构化实体数", "9");
    expectSignalValue("结构化关系数", "13");
    expect(screen.getByText("最近扫描")).not.toBeNull();
    expect(screen.getByText("5 files / 2 changed / 1 sources")).not.toBeNull();
    expect(screen.getByText("最近基础分析")).not.toBeNull();
    expect(screen.getByText("3 docs / 7 chunks / 11 sentences")).not.toBeNull();
    expect(screen.getByText("最近结构化构建")).not.toBeNull();
    expect(screen.getByText("3 docs / 9 nodes / 12 relations")).not.toBeNull();
    expect(screen.getByText("最近增强审校")).not.toBeNull();
    expect(screen.getByText("0.91 -> 0.95 / delta 0.04 / 1 rounds")).not.toBeNull();
    expect(screen.getByText("知识计量六层")).not.toBeNull();
    expect(screen.getByText("结构化处理")).not.toBeNull();
    expect(screen.getByText("增强审校")).not.toBeNull();
    expect(screen.getByText("数据层与预处理层")).not.toBeNull();
    expect(screen.getByText("语义层次")).not.toBeNull();
    expect(screen.getByText("语用与推理层次")).not.toBeNull();
    expect(screen.getByText("#2")).not.toBeNull();
    expect(screen.getAllByText("查看依据").length).toBeGreaterThan(0);
    expect(screen.getAllByText("就绪标准化文档数").length).toBeGreaterThan(0);
    expect(screen.getAllByText("识别实体数").length).toBeGreaterThan(0);
    expect(screen.getAllByText("句法关系数").length).toBeGreaterThan(0);
    expect(screen.getByText("质量分")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Refresh" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Open settings" })).not.toBeNull();
  });

  it("marks stale queued processing snapshots", () => {
    const knowledgeState = buildKnowledgeState();
    knowledgeState.processingFreshness = {
      stale: true,
      staleModes: ["agentic"],
      staleSources: ["tasks"],
      channelStatus: {
        "project-sync": "open",
        tasks: "reconnecting",
      },
    };

    render(<ProjectKnowledgeProcessingPanel knowledgeState={knowledgeState} />);

    expect(screen.getByText("状态可能已过期")).not.toBeNull();
  });

  it("hides L1-specific indexing hints in processing header", () => {
    const knowledgeState = buildKnowledgeState();
    knowledgeState.quantMetrics = {
      ...knowledgeState.quantMetrics,
      totalSources: 3,
      indexedSources: 1,
    };

    render(<ProjectKnowledgeProcessingPanel knowledgeState={knowledgeState} />);

    expect(screen.queryByText("L1 基础索引进度 1/3，详细状态请看 Sources / Signals。")).toBeNull();
    expect(screen.getByText("知识计量六层")).not.toBeNull();
    expect(screen.getByText("数据层与预处理层")).not.toBeNull();
    expect(screen.getByText("词汇层次")).not.toBeNull();
    expect(screen.getByText("短语层次")).not.toBeNull();
    expect(screen.getByText("句法层次")).not.toBeNull();
    expect(screen.getByText("语义层次")).not.toBeNull();
    expect(screen.getByText("语用与推理层次")).not.toBeNull();
  });

  it("shows pending labels when agentic outputs are not independently available", () => {
    const knowledgeState = buildKnowledgeState();
    knowledgeState.processingCompareModes = knowledgeState.processingCompareModes.map((mode) => (
      mode.mode === "agentic"
        ? {
          ...mode,
          available: false,
          status: "queued",
          entityCount: 0,
          relationCount: 0,
          qualityScore: null,
        }
        : mode
    ));

    render(<ProjectKnowledgeProcessingPanel knowledgeState={knowledgeState} />);

    expect(screen.getAllByText("未产出").length).toBeGreaterThan(1);
    expect(screen.getByText("等待形成独立增强结果")).not.toBeNull();
  });

  it("opens settings from the processing header actions", async () => {
    const user = userEvent.setup();
    const knowledgeState = buildKnowledgeState();
    const onOpenSettings = vi.fn();

    render(<ProjectKnowledgeProcessingPanel knowledgeState={knowledgeState} onOpenSettings={onOpenSettings} />);

    await user.click(screen.getByRole("button", { name: "Open settings" }));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("renders recent source_scan, L1, L2 and L3 runs when project stats history is available", () => {
    const knowledgeState = buildKnowledgeState();
    knowledgeState.sourceScanStats = {
      project_id: "project-abc",
      step_id: "source_scan",
      latest: {
        project_id: "project-abc",
        source_id: "project-project-abc-workspace",
        step_id: "source_scan",
        indexed_at: "2026-05-12T10:20:00Z",
        updated_at: "2026-05-12T10:21:00Z",
        metrics: {
          data_file_count: 5,
          changed_path_count: 2,
          source_count: 1,
        },
      },
      history: [
        {
          project_id: "project-abc",
          source_id: "project-project-abc-workspace",
          step_id: "source_scan",
          indexed_at: "2026-05-12T10:20:00Z",
          updated_at: "2026-05-12T10:21:00Z",
          metrics: {
            data_file_count: 5,
            changed_path_count: 2,
            source_count: 1,
          },
        },
      ],
    };
    knowledgeState.fileAnalysisStats = {
      project_id: "project-abc",
      step_id: "file_analysis",
      latest: {
        project_id: "project-abc",
        source_id: "project-project-abc-workspace",
        step_id: "file_analysis",
        indexed_at: "2026-05-12T10:30:00Z",
        updated_at: "2026-05-12T10:31:00Z",
        metrics: {
          document_count: 3,
          snapshot_count: 3,
          chunk_count: 7,
          sentence_count: 11,
        },
      },
      history: [
        {
          project_id: "project-abc",
          source_id: "project-project-abc-workspace",
          step_id: "file_analysis",
          indexed_at: "2026-05-12T10:30:00Z",
          updated_at: "2026-05-12T10:31:00Z",
          metrics: {
            document_count: 3,
            snapshot_count: 3,
            chunk_count: 7,
            sentence_count: 11,
          },
        },
        {
            project_id: "project-abc",
            source_id: "project-project-abc-workspace",
            step_id: "file_analysis",
            indexed_at: "2026-05-12T10:00:00Z",
            updated_at: "2026-05-12T10:01:00Z",
            metrics: {
              document_count: 2,
              snapshot_count: 2,
              chunk_count: 5,
              sentence_count: 8,
            },
          },
        ],
      };
      knowledgeState.projectStepStats = {
        domain_graph_build: {
          project_id: "project-abc",
          step_id: "domain_graph_build",
          latest: {
            project_id: "project-abc",
            source_id: "project-project-abc-workspace",
            step_id: "domain_graph_build",
            indexed_at: "2026-05-12T10:40:00Z",
            updated_at: "2026-05-12T10:41:00Z",
            metrics: {
              document_count: 3,
              node_count: 9,
              relation_count: 12,
            },
          },
          history: [
            {
              project_id: "project-abc",
              source_id: "project-project-abc-workspace",
              step_id: "domain_graph_build",
              indexed_at: "2026-05-12T10:40:00Z",
              updated_at: "2026-05-12T10:41:00Z",
              metrics: {
                document_count: 3,
                node_count: 9,
                relation_count: 12,
              },
            },
          ],
        },
        quality_review: {
          project_id: "project-abc",
          step_id: "quality_review",
          latest: {
            project_id: "project-abc",
            source_id: "project-project-abc-workspace",
            step_id: "quality_review",
            indexed_at: "2026-05-12T10:50:00Z",
            updated_at: "2026-05-12T10:51:00Z",
            metrics: {
              quality_score_before: 0.91,
              quality_score_after: 0.95,
              quality_delta: 0.04,
              quality_rounds: 1,
            },
          },
          history: [
            {
              project_id: "project-abc",
              source_id: "project-project-abc-workspace",
              step_id: "quality_review",
              indexed_at: "2026-05-12T10:50:00Z",
              updated_at: "2026-05-12T10:51:00Z",
              metrics: {
                quality_score_before: 0.91,
                quality_score_after: 0.95,
                quality_delta: 0.04,
                quality_rounds: 1,
              },
            },
          ],
        },
      };

    render(<ProjectKnowledgeProcessingPanel knowledgeState={knowledgeState} />);

      expect(screen.getByText("最近扫描")).not.toBeNull();
      expect(screen.getByText("来自 source_scan 项目统计文件")).not.toBeNull();
      expect(screen.getByText("5 files / 2 changed / 1 sources")).not.toBeNull();
    expect(screen.getByText("最近基础分析")).not.toBeNull();
    expect(screen.getByText("来自文件分析项目统计")).not.toBeNull();
    expect(screen.getByText("3 docs / 7 chunks / 11 sentences")).not.toBeNull();
    expect(screen.getByText("2 docs / 5 chunks / 8 sentences")).not.toBeNull();
      expect(screen.getByText("最近结构化构建")).not.toBeNull();
      expect(screen.getByText("3 docs / 9 nodes / 12 relations")).not.toBeNull();
      expect(screen.getByText("最近增强审校")).not.toBeNull();
      expect(screen.getByText("0.91 -> 0.95 / delta 0.04 / 1 rounds")).not.toBeNull();
  });

  it("shows raw graph and document graphify artifacts in the outputs panel", () => {
    const knowledgeState = buildKnowledgeState();
    knowledgeState.projectStepStats = {
      domain_graph_build: {
        project_id: "project-abc",
        step_id: "domain_graph_build",
        latest: {
          project_id: "project-abc",
          source_id: "project-project-abc-workspace",
          step_id: "domain_graph_build",
          indexed_at: "2026-05-12T10:40:00Z",
          updated_at: "2026-05-12T10:41:00Z",
          metrics: {
            document_count: 3,
            node_count: 9,
            relation_count: 12,
          },
        },
        history: [],
      },
    };
    knowledgeState.modeOutputs.nlp.artifacts = [
      {
        kind: "document_graph_manifest",
        label: "Document graphify manifest",
        path: "projects/project-abc/.knowledge/graphify/manifest.json",
      },
      {
        kind: "document_graph_dir",
        label: "Document graphify payloads",
        path: "projects/project-abc/.knowledge/graphify",
      },
      {
        kind: "graph",
        label: "Raw knowledge graph",
        path: "projects/project-abc/.knowledge/graphify-out/graph.json",
      },
    ];

    render(
      <ProjectKnowledgeOutputsPanel
        knowledgeState={knowledgeState}
        onRunSuggestedQuery={vi.fn()}
        onSelectArtifactPath={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Raw knowledge graph").length).toBeGreaterThan(0);
    expect(screen.getByText("Document graphify manifest")).not.toBeNull();
    expect(screen.getByText("Latest output provenance")).not.toBeNull();
    expect(screen.getByText(/3 docs \/ 9 nodes \/ 12 relations/)).not.toBeNull();
  });

  it("renders output records through the new outputs panel", async () => {
    const user = userEvent.setup();
    const onRunSuggestedQuery = vi.fn();
    const onSelectArtifactPath = vi.fn();
    const knowledgeState = buildKnowledgeState();
    knowledgeState.modeOutputs.nlp.summaryLines = [
      "Document graphify payloads: 2",
      "Entities: 2",
      "Relations: 12",
    ];
    knowledgeState.modeOutputs.nlp.artifacts = [
      {
        kind: "document_graph_manifest",
        label: "Document graphify manifest",
        path: "projects/project-abc/.knowledge/graphify/manifest.json",
      },
      {
        kind: "document_graph_dir",
        label: "Document graphify payloads",
        path: "projects/project-abc/.knowledge/graphify",
      },
      {
        kind: "graph",
        label: "Raw knowledge graph",
        path: "projects/project-abc/.knowledge/graphify-out/graph.json",
      },
    ];

    render(
      <ProjectKnowledgeOutputsPanel
        knowledgeState={knowledgeState}
        onRunSuggestedQuery={onRunSuggestedQuery}
        onSelectArtifactPath={onSelectArtifactPath}
      />,
    );

    expect(screen.getByText("Raw knowledge graph")).not.toBeNull();
    expect(screen.getByText("Document graphify manifest")).not.toBeNull();
    expect(screen.getByText("文档级 graphify 中间层已生成")).not.toBeNull();
    expect(screen.getAllByText(/Document graphify payloads: 2/).length).toBeGreaterThan(0);
    expect(screen.getByText("Manifest")).not.toBeNull();
    expect(screen.getByText("Payload Directory")).not.toBeNull();
    expect(screen.getByText("Actions")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Preview manifest" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Open payload directory" })).not.toBeNull();
    expect(screen.getAllByRole("button", { name: "projects/project-abc/.knowledge/graphify/manifest.json" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "projects/project-abc/.knowledge/graphify" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "projects/project-abc/.knowledge/graphify-out/graph.json" })).not.toBeNull();
    expect(screen.getByText("Agent")).not.toBeNull();
    expect(screen.getByText("Workflow")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Preview manifest" }));
    expect(onSelectArtifactPath).toHaveBeenCalledWith("projects/project-abc/.knowledge/graphify/manifest.json");

    await user.click(screen.getByRole("button", { name: "Open payload directory" }));
    expect(onSelectArtifactPath).toHaveBeenCalledWith("projects/project-abc/.knowledge/graphify");

    await user.click(screen.getByRole("button", { name: "projects/project-abc/.knowledge/graphify-out/graph.json" }));
    expect(onSelectArtifactPath).toHaveBeenCalledWith("projects/project-abc/.knowledge/graphify-out/graph.json");

    await user.type(
      screen.getByPlaceholderText("Search entities, relations, or document paths"),
      "missing",
    );

    expect(screen.getByText("No result")).not.toBeNull();
  });

  it("shows a user-facing empty state when only base outputs are available", () => {
    const knowledgeState = buildKnowledgeState();
    knowledgeState.outputModes = [
      buildModeState({
        mode: "fast",
        status: "ready",
        available: true,
        summary: "Base outputs are ready.",
        lastUpdatedAt: "2026-04-11T23:30:00+00:00",
        documentCount: 3,
        chunkCount: 7,
      }),
    ];
    knowledgeState.outputResolution = {
      activeMode: "fast",
      availableModes: ["fast"],
      fallbackChain: ["fast"],
      reason: "Only base outputs are available.",
    };

    render(
      <ProjectKnowledgeOutputsPanel
        knowledgeState={knowledgeState}
        onRunSuggestedQuery={vi.fn()}
        onSelectArtifactPath={vi.fn()}
      />,
    );

    expect(screen.getByText("结构化或增强结果尚未就绪，暂时无法展示实体关系结果。")).not.toBeNull();
  });

  it("renders ner panel with aggregated entities", () => {
    const knowledgeState = buildKnowledgeState();

    render(<ProjectKnowledgeNerPanel knowledgeState={knowledgeState} />);

    const expectSignalValue = (label: string, value: string) => {
      const labelNode = screen.getByText(label);
      const cardNode = labelNode.closest("div");
      expect(cardNode).not.toBeNull();
      if (!(cardNode instanceof HTMLElement)) {
        return;
      }
      const valueNode = within(cardNode).getByText(value);
      expect(valueNode).not.toBeNull();
    };

    expect(screen.getByText("NER")).not.toBeNull();
    expect(screen.getByText("Unique Entities")).not.toBeNull();
    expect(screen.getByText("Entity Mentions")).not.toBeNull();
    expect(screen.getByText("NER Batches")).not.toBeNull();
    expect(screen.getByText("Worker Restarts")).not.toBeNull();
    expect(screen.getByText("Worker PID Count")).not.toBeNull();
    expectSignalValue("NER Batches", "3");
    expectSignalValue("Worker Restarts", "1");
    expectSignalValue("Worker PID Count", "2");
    expect(screen.getByText("interlinear_full_document: 1")).not.toBeNull();
    expect(screen.getByText("agent")).not.toBeNull();
    expect(screen.getByText("workflow")).not.toBeNull();
  });
});