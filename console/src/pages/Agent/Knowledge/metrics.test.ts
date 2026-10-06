import { describe, expect, it } from "vitest";
import i18n from "../../../i18n";
import { t } from "../Projects/tests/enLocaleTranslate";
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
import type {
  KnowledgeQuantMetricKey,
  KnowledgeQuantMetrics,
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

  it("ships bundle copy for every quant reason the producer can emit", () => {
    const emptyMetrics: KnowledgeQuantMetrics = {
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
    };
    const weakMetrics: KnowledgeQuantMetrics = {
      ...emptyMetrics,
      totalSources: 10,
      indexedSources: 6,
      indexedRatio: 0.6,
      totalDocuments: 4,
      totalChunks: 8,
      totalEntities: 0,
      totalRelations: 0,
      relationNormalizationCoverage: 0.2,
      entityCanonicalCoverage: 0.3,
      lowConfidenceRatio: 0.4,
      missingEvidenceRatio: 0.5,
    };
    const strongMetrics: KnowledgeQuantMetrics = {
      ...emptyMetrics,
      totalSources: 10,
      indexedSources: 10,
      indexedRatio: 1,
      totalDocuments: 40,
      totalChunks: 80,
      totalEntities: 12,
      totalRelations: 30,
      relationNormalizationCoverage: 0.8,
      entityCanonicalCoverage: 0.9,
      lowConfidenceRatio: 0.1,
      missingEvidenceRatio: 0.05,
    };
    const metricKeys: KnowledgeQuantMetricKey[] = [
      "indexed",
      "documents",
      "chunks",
      "entities",
      "relations",
      "relationNormCoverage",
      "entityNormCoverage",
      "lowConfidenceRatio",
      "missingEvidenceRatio",
    ];

    const emitted = new Set<string>();
    for (const metrics of [emptyMetrics, weakMetrics, strongMetrics]) {
      for (const metricKey of metricKeys) {
        const reason = getKnowledgeQuantReason(metricKey, metrics);
        emitted.add(reason.key);
        const dottedKey = `knowledge.quantReason.${reason.key}`;
        const rendered = t(dottedKey, reason.params ?? {});
        expect(rendered).not.toBe(dottedKey);
        expect(rendered).not.toContain("{{");
      }
    }

    expect([...emitted].sort()).toEqual([
      "activityPresent",
      "emptyState",
      "indexedCoverageHealthy",
      "indexedCoverageLow",
      "noActivity",
      "qualityCoverageHealthy",
      "qualityCoverageLow",
      "riskRatioHealthy",
      "riskRatioHigh",
    ].sort());
  });

  it("renders the quant reason family in the languages the overlay ships", () => {
    // Through the product's own i18n instance, so the four-language deliverable
    // is proven by the same registration order production uses, not by a second
    // hand-assembled bundle.
    const reasonKeys = [
      "emptyState",
      "indexedCoverageHealthy",
      "indexedCoverageLow",
      "activityPresent",
      "noActivity",
      "qualityCoverageHealthy",
      "qualityCoverageLow",
      "riskRatioHealthy",
      "riskRatioHigh",
    ] as const;
    const english: Record<string, string> = {};

    for (const key of reasonKeys) {
      const dottedKey = `knowledge.quantReason.${key}`;
      english[key] = i18n.t(dottedKey, { lng: "en", percent: 42 });
      expect(english[key]).not.toBe(dottedKey);
      expect(english[key]).not.toContain("{{");
    }

    for (const lng of ["zh", "ja", "ru"] as const) {
      for (const key of reasonKeys) {
        const rendered = i18n.t(`knowledge.quantReason.${key}`, { lng, percent: 42 });
        expect(rendered).not.toBe(`knowledge.quantReason.${key}`);
        expect(rendered).not.toContain("{{");
        expect(rendered).not.toBe(english[key]);
        if (english[key].includes("42")) {
          expect(rendered).toContain("42");
        }
      }
    }

    for (const lng of ["pt-BR", "id"] as const) {
      for (const key of reasonKeys) {
        expect(i18n.t(`knowledge.quantReason.${key}`, { lng, percent: 42 })).toBe(
          english[key],
        );
      }
    }
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
    });

    const cards = buildKnowledgeQuantCardModels(weakMetrics);
    expect(cards).toHaveLength(9);
    expect(cards[0].key).toBe("indexed");
    expect(cards[0].value).toBe("0%");
    expect(cards[5].key).toBe("relationNormCoverage");
    expect(cards[8].key).toBe("missingEvidenceRatio");
    expect(getKnowledgeQuantStatusLabel("healthy")).toEqual({
      i18nKey: "knowledge.quantStatusHealthy",
    });
  });

  it("ships bundle copy for every card, status and action label", () => {
    const cards = buildKnowledgeQuantCardModels(computeKnowledgeQuantMetrics([], [], null));
    expect(cards).toHaveLength(9);
    for (const card of cards) {
      expect(t(card.labelI18nKey)).not.toBe(card.labelI18nKey);
    }
    for (const status of ["healthy", "attention", "neutral"] as const) {
      expect(t(getKnowledgeQuantStatusLabel(status).i18nKey)).not.toBe(
        getKnowledgeQuantStatusLabel(status).i18nKey,
      );
    }
    for (const actionKey of ["addSource", "rebuildIndex", "backfillHistory", "retryRemote"] as const) {
      const labelI18nKey = getKnowledgeQuantActionDescriptor(actionKey).labelI18nKey;
      expect(t(labelI18nKey)).not.toBe(labelI18nKey);
    }
  });
});
