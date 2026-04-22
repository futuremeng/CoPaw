import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ProjectKnowledgeOutputsPanel from "./ProjectKnowledgeOutputsPanel";
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
    ) => {
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
    latestQualityLoopJob: null,
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
          predicate: "uses",
          object: "Workflow",
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
    relationRecords: [
      {
        subject: "Agent",
        predicate: "uses",
        object: "Workflow",
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
    expect(screen.getAllByText("projects.knowledge.signalRelations").length).toBeGreaterThan(0);
    expect(screen.getAllByText("实体数").length).toBeGreaterThan(0);
    expect(screen.getByText("Semantic Engine")).not.toBeNull();
    expect(screen.getByText("Module Unavailable")).not.toBeNull();
    expect(screen.getByText(/Semantic Engine: Module Unavailable/)).not.toBeNull();
    expect(screen.getByText(/HANLP2_IMPORT_UNAVAILABLE/)).not.toBeNull();

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
    ]);
  });

  it("renders source inventory", () => {
    const { container } = render(<ProjectKnowledgeSourcesPanel knowledgeState={buildKnowledgeState()} />);

    const signalLabels = Array.from(
      container.querySelectorAll("._projectKnowledgeSignalCard_209b2b .ant-typography-secondary"),
    ).map((element) => element.textContent);

    expect(signalLabels).toEqual([
      "projects.knowledge.signalDocuments",
      "projects.knowledge.signalChunks",
      "Sentences",
      "Lightweight Tokens",
      "Characters",
    ]);
  });

  it("renders processing mode cards", () => {
    const knowledgeState = buildKnowledgeState();
    knowledgeState.processingCompareModes = knowledgeState.processingCompareModes.map((mode) => (
      mode.mode === "nlp"
        ? {
          ...mode,
          stage: "Waiting for graph extraction · Semantic engine unavailable: HanLP2 module is not installed.",
        }
        : mode
    ));

    render(<ProjectKnowledgeProcessingPanel knowledgeState={knowledgeState} />);

    expect(screen.getByText("Processing")).not.toBeNull();
    expect(screen.queryByText("极速模式")).toBeNull();
    expect(screen.getAllByText("NLP 模式").length).toBeGreaterThan(0);
    expect(screen.getAllByText("多智能体模式").length).toBeGreaterThan(0);
    expect(screen.getByText("L2 实体数")).not.toBeNull();
    expect(screen.getByText("L3 关系数")).not.toBeNull();
    expect(screen.getByText("实体关系抽取")).not.toBeNull();
    expect(screen.getByText("多智能体增强")).not.toBeNull();
    expect(screen.getAllByText(/Semantic engine unavailable: HanLP2 module is not installed\./).length).toBeGreaterThan(0);
    const runNlpButton = screen.getByRole("button", { name: "运行 NLP 结构化" }) as HTMLButtonElement;
    expect(runNlpButton.disabled).toBe(true);
    expect(runNlpButton.parentElement?.getAttribute("title")).toBe("Semantic engine unavailable: HanLP2 module is not installed.");
    expect(screen.getByText("L2 提供实体与关系的结构化基础，L3 在此基础上继续做多智能体增强与质量提升。")).not.toBeNull();
  });

  it("renders output records through the new outputs panel", async () => {
    const user = userEvent.setup();
    const onRunSuggestedQuery = vi.fn();

    render(
      <ProjectKnowledgeOutputsPanel
        knowledgeState={buildKnowledgeState()}
        onRunSuggestedQuery={onRunSuggestedQuery}
      />,
    );

    expect(screen.getByText("Raw knowledge graph")).not.toBeNull();
    expect(screen.getByText("projects/project-abc/.knowledge/graphify-out/graph.json")).not.toBeNull();
    expect(screen.getByText("Agent")).not.toBeNull();
    expect(screen.getByText("Workflow")).not.toBeNull();

    await user.type(
      screen.getByPlaceholderText("Search entities, relations, or document paths"),
      "missing",
    );

    expect(screen.getByText("No result")).not.toBeNull();
  });
});