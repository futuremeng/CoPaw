import { describe, expect, it } from "vitest";
import type {
  KnowledgeHistoryBackfillStatus,
  KnowledgeSourceItem,
  KnowledgeTaskProgress,
} from "../../../api/types";
import {
  buildKnowledgeQuantCardModels,
  computeKnowledgeQuantMetrics,
  getKnowledgeQuantActionDescriptor,
  getKnowledgeQuantActionKey,
  getKnowledgeQuantAssessment,
  getKnowledgeQuantReason,
  getKnowledgeQuantStatusLabel,
} from "./metrics";

function createSource(overrides: Partial<KnowledgeSourceItem>): KnowledgeSourceItem {
  return {
    id: "manual-file-a1b2c3",
    name: "Source",
    type: "file",
    location: "/tmp/source.md",
    content: "",
    enabled: true,
    recursive: false,
    tags: [],
    summary: "",
    status: {
      indexed: false,
      indexed_at: null,
      document_count: 0,
      chunk_count: 0,
      error: null,
    },
    ...overrides,
  };
}

function createMemifyTask(overrides: Partial<KnowledgeTaskProgress>): KnowledgeTaskProgress {
  return {
    task_id: "memify-1",
    task_type: "memify",
    job_id: "memify-1",
    status: "succeeded",
    current_stage: "completed",
    stage_message: "Done",
    progress: 100,
    percent: 100,
    current: 1,
    total: 1,
    updated_at: "2026-04-12T10:00:00Z",
    relation_count: 892,
    node_count: 223,
    document_count: 87,
    enrichment_metrics: {
      edge_count: 892,
      node_count: 223,
      relation_normalized_count: 668,
      entity_canonicalized_count: 156,
      low_confidence_edges: 80,
      missing_evidence_edges: 44,
    },
    ...overrides,
  } as KnowledgeTaskProgress;
}

describe("knowledge metrics", () => {
  it("aggregates base and enrichment quality metrics", () => {
    const sources: KnowledgeSourceItem[] = [
      createSource({
        status: {
          indexed: true,
          indexed_at: "2026-04-09T10:00:00Z",
          document_count: 87,
          chunk_count: 6641,
          error: null,
        },
      }),
    ];

    const backfillStatus: KnowledgeHistoryBackfillStatus = {
      has_backfill_record: false,
      backfill_completed: false,
      marked_unbackfilled: true,
      history_chat_count: 18,
      has_pending_history: true,
    };

    const metrics = computeKnowledgeQuantMetrics(
      sources,
      [],
      backfillStatus,
      [createMemifyTask({ updated_at: "2026-04-12T10:00:00Z" })],
    );

    expect(metrics.indexedRatio).toBe(1);
    expect(metrics.totalDocuments).toBe(87);
    expect(metrics.totalChunks).toBe(6641);
    expect(metrics.totalEntities).toBe(223);
    expect(metrics.totalRelations).toBe(892);
    expect(metrics.relationNormalizationCoverage).toBeCloseTo(668 / 892, 4);
    expect(metrics.entityCanonicalCoverage).toBeCloseTo(156 / 223, 4);
    expect(metrics.lowConfidenceRatio).toBeCloseTo(80 / 892, 4);
    expect(metrics.missingEvidenceRatio).toBeCloseTo(44 / 892, 4);
    expect(metrics.pendingHistorySessions).toBe(18);
  });

  it("returns safe zero defaults when there is no data", () => {
    const metrics = computeKnowledgeQuantMetrics([], [], null, []);

    expect(metrics).toEqual({
      totalSources: 0,
      indexedSources: 0,
      indexedRatio: 0,
      totalDocuments: 0,
      totalChunks: 0,
      totalEntities: 0,
      totalRelations: 0,
      relationNormalizationCoverage: 0,
      entityCanonicalCoverage: 0,
      lowConfidenceRatio: 0,
      missingEvidenceRatio: 0,
      pendingHistorySessions: 0,
      searchHits: 0,
    });
  });

  it("marks low quality coverage and high risk ratios as attention", () => {
    const metrics = computeKnowledgeQuantMetrics(
      [
        createSource({
          status: {
            indexed: false,
            indexed_at: null,
            document_count: 0,
            chunk_count: 0,
            error: null,
          },
        }),
      ],
      [],
      null,
      [
        createMemifyTask({
          relation_count: 100,
          node_count: 50,
          enrichment_metrics: {
            edge_count: 100,
            node_count: 50,
            relation_normalized_count: 10,
            entity_canonicalized_count: 5,
            low_confidence_edges: 60,
            missing_evidence_edges: 40,
          },
        }),
      ],
    );

    expect(getKnowledgeQuantAssessment("indexed", metrics)).toEqual({
      tone: "warning",
      status: "attention",
    });
    expect(getKnowledgeQuantAssessment("relationNormCoverage", metrics)).toEqual({
      tone: "warning",
      status: "attention",
    });
    expect(getKnowledgeQuantAssessment("lowConfidenceRatio", metrics)).toEqual({
      tone: "warning",
      status: "attention",
    });
    expect(getKnowledgeQuantReason("relationNormCoverage", metrics).key).toBe("qualityCoverageLow");
    expect(getKnowledgeQuantReason("missingEvidenceRatio", metrics).key).toBe("riskRatioHigh");
  });

  it("derives quant action keys from metric states", () => {
    const weakMetrics = computeKnowledgeQuantMetrics(
      [
        createSource({
          status: {
            indexed: false,
            indexed_at: null,
            document_count: 0,
            chunk_count: 0,
            error: null,
          },
        }),
      ],
      [],
      null,
      [],
    );

    expect(getKnowledgeQuantActionKey("indexed", weakMetrics)).toBe("rebuildIndex");

    const emptyMetrics = computeKnowledgeQuantMetrics([], [], null, []);
    expect(getKnowledgeQuantActionKey("documents", emptyMetrics)).toBe("addSource");
    expect(getKnowledgeQuantActionDescriptor("addSource")).toEqual({
      key: "addSource",
      labelI18nKey: "knowledge.addSource",
      defaultLabel: "Add Source",
    });

    const cards = buildKnowledgeQuantCardModels(weakMetrics);
    expect(cards).toHaveLength(9);
    expect(cards[0].key).toBe("indexed");
    expect(cards[0].value).toBe("0%");
    expect(cards[5].key).toBe("relationNormCoverage");
    expect(cards[8].key).toBe("missingEvidenceRatio");
    expect(getKnowledgeQuantStatusLabel("healthy")).toEqual({
      i18nKey: "knowledge.quantStatusHealthy",
      defaultLabel: "Healthy",
    });
  });
});
