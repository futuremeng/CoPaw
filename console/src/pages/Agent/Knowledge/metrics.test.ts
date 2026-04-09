import { describe, expect, it } from "vitest";
import type { KnowledgeHistoryBackfillStatus, KnowledgeSourceItem } from "../../../api/types";
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

describe("knowledge metrics", () => {
  it("aggregates source, index, remote cache and search metrics", () => {
    const sources: KnowledgeSourceItem[] = [
      createSource({
        id: "manual-file-alpha",
        type: "file",
        status: {
          indexed: true,
          indexed_at: "2026-04-09T10:00:00Z",
          document_count: 3,
          chunk_count: 12,
          error: null,
          remote_cache_state: "cached",
        },
      }),
      createSource({
        id: "auto-url-beta",
        type: "url",
        tags: ["origin:auto"],
        status: {
          indexed: true,
          indexed_at: "2026-04-09T10:00:00Z",
          document_count: 2,
          chunk_count: 7,
          error: null,
          remote_cache_state: "waiting_retry",
        },
      }),
      createSource({
        id: "manual-chat-gamma",
        type: "chat",
        status: {
          indexed: false,
          indexed_at: null,
          document_count: 0,
          chunk_count: 0,
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
      [
        {
          source_id: "manual-file-alpha",
          source_name: "Source",
          source_type: "file",
          document_path: "doc.md",
          document_title: "Doc",
          score: 0.9,
          snippet: "alpha",
        },
      ],
      backfillStatus,
    );

    expect(metrics.totalSources).toBe(3);
    expect(metrics.indexedSources).toBe(2);
    expect(metrics.indexedRatio).toBeCloseTo(2 / 3, 6);
    expect(metrics.totalDocuments).toBe(5);
    expect(metrics.totalChunks).toBe(19);
    expect(metrics.autoSources).toBe(1);
    expect(metrics.sourceTypeCount).toBe(3);
    expect(metrics.remoteTrackedSources).toBe(2);
    expect(metrics.remoteCachedSources).toBe(1);
    expect(metrics.pendingHistorySessions).toBe(18);
    expect(metrics.searchHits).toBe(1);
  });

  it("returns safe zero defaults when there is no data", () => {
    const metrics = computeKnowledgeQuantMetrics([], [], null);

    expect(metrics).toEqual({
      totalSources: 0,
      indexedSources: 0,
      indexedRatio: 0,
      totalDocuments: 0,
      totalChunks: 0,
      autoSources: 0,
      sourceTypeCount: 0,
      remoteTrackedSources: 0,
      remoteCachedSources: 0,
      pendingHistorySessions: 0,
      searchHits: 0,
    });
  });

  it("marks weak coverage and pending history as attention states", () => {
    const metrics = computeKnowledgeQuantMetrics(
      [
        createSource({
          status: {
            indexed: false,
            indexed_at: null,
            document_count: 0,
            chunk_count: 0,
            error: null,
            remote_cache_state: "waiting_retry",
          },
        }),
      ],
      [],
      {
        has_backfill_record: false,
        backfill_completed: false,
        marked_unbackfilled: true,
        history_chat_count: 3,
        has_pending_history: true,
      },
    );

    expect(getKnowledgeQuantAssessment("indexed", metrics)).toEqual({
      tone: "warning",
      status: "attention",
    });
    expect(getKnowledgeQuantAssessment("remote", metrics)).toEqual({
      tone: "warning",
      status: "attention",
    });
    expect(getKnowledgeQuantAssessment("pending", metrics)).toEqual({
      tone: "warning",
      status: "attention",
    });
    expect(getKnowledgeQuantReason("indexed", metrics)).toEqual({
      key: "indexedCoverageLow",
      params: { percent: 0 },
    });
    expect(getKnowledgeQuantReason("pending", metrics)).toEqual({
      key: "pendingHistoryExists",
      params: { count: 3 },
    });
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
            remote_cache_state: "waiting_retry",
          },
        }),
      ],
      [],
      {
        has_backfill_record: false,
        backfill_completed: false,
        marked_unbackfilled: true,
        history_chat_count: 2,
        has_pending_history: true,
      },
    );

    expect(getKnowledgeQuantActionKey("indexed", weakMetrics)).toBe("rebuildIndex");
    expect(getKnowledgeQuantActionKey("pending", weakMetrics)).toBe("backfillHistory");
    expect(getKnowledgeQuantActionKey("remote", weakMetrics)).toBe("retryRemote");

    const emptyMetrics = computeKnowledgeQuantMetrics([], [], null);
    expect(getKnowledgeQuantActionKey("sources", emptyMetrics)).toBe("addSource");
    expect(getKnowledgeQuantActionKey("types", emptyMetrics)).toBe("addSource");
    expect(getKnowledgeQuantActionDescriptor("addSource")).toEqual({
      key: "addSource",
      labelI18nKey: "knowledge.addSource",
      defaultLabel: "Add Source",
    });
    expect(getKnowledgeQuantActionDescriptor("retryRemote")).toEqual({
      key: "retryRemote",
      labelI18nKey: "knowledge.remoteRetryAction",
      defaultLabel: "Retry Remote Sources",
    });

    const cards = buildKnowledgeQuantCardModels(weakMetrics);
    expect(cards).toHaveLength(9);
    expect(cards.find((item) => item.key === "indexed")?.value).toBe("0%");
    expect(cards.find((item) => item.key === "remote")?.value).toBe("0/1");
    expect(cards.find((item) => item.key === "remote")?.actionKey).toBe("retryRemote");
    expect(getKnowledgeQuantStatusLabel("healthy")).toEqual({
      i18nKey: "knowledge.quantStatusHealthy",
      defaultLabel: "Healthy",
    });
  });
});
