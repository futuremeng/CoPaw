import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ProjectKnowledgeRelationsPanel from "./ProjectKnowledgeRelationsPanel";
import ProjectKnowledgeSignalsPanel from "./ProjectKnowledgeSignalsPanel";
import ProjectKnowledgeSourcesPanel from "./ProjectKnowledgeSourcesPanel";
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
    syncState: null,
    activeKnowledgeTasks: [],
    activeKnowledgeTask: null,
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
    const { container } = render(<ProjectKnowledgeSignalsPanel knowledgeState={buildKnowledgeState()} />);

    expect(screen.getByText("projects.knowledge.signalsTitle")).not.toBeNull();
    expect(screen.getByText("projects.knowledge.signalRelations")).not.toBeNull();
    expect(screen.getByText("实体数")).not.toBeNull();

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
    render(<ProjectKnowledgeSourcesPanel knowledgeState={buildKnowledgeState()} />);

    expect(screen.getAllByText("Project Source").length).toBeGreaterThan(0);
    expect(screen.getAllByText("/tmp/workspace").length).toBeGreaterThan(0);
  });

  it("renders direct relation records", async () => {
    const user = userEvent.setup();
    const onRunSuggestedQuery = vi.fn();

    render(
      <ProjectKnowledgeRelationsPanel
        knowledgeState={buildKnowledgeState()}
        onRunSuggestedQuery={onRunSuggestedQuery}
      />,
    );

    expect(screen.getByText("Agent")).not.toBeNull();
    expect(screen.getByText("Workflow")).not.toBeNull();

    await user.type(
      screen.getByPlaceholderText("Search entities, relations, or document paths"),
      "missing",
    );

    expect(screen.getByText("projects.knowledge.emptyResult")).not.toBeNull();
  });
});