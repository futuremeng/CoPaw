import { describe, expect, it, vi } from "vitest";
import { computeKnowledgeQuantMetrics } from "./metrics";
import { buildKnowledgeQuantCardViewModels } from "./quantCards";

describe("knowledge quant cards view models", () => {
  it("maps action keys to handlers and loading state", () => {
    const metrics = computeKnowledgeQuantMetrics(
      [
        {
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
            remote_cache_state: "waiting_retry",
          },
        },
      ],
      [],
        null,
    );

    const onAddSource = vi.fn();
    const onRebuildIndex = vi.fn();
    const onBackfillHistory = vi.fn();
    const onRetryRemote = vi.fn();

    const cards = buildKnowledgeQuantCardViewModels({
      metrics,
      handlers: {
        addSource: onAddSource,
        rebuildIndex: onRebuildIndex,
        backfillHistory: onBackfillHistory,
        retryRemote: onRetryRemote,
      },
      loading: {
        addSource: false,
        rebuildIndex: true,
        backfillHistory: false,
        retryRemote: true,
      },
    });

    const indexed = cards.find((item) => item.key === "indexed");
      const documents = cards.find((item) => item.key === "documents");

    expect(indexed?.action?.defaultLabel).toBe("Rebuild Index");
    expect(indexed?.action?.loading).toBe(true);
    indexed?.action?.onClick();
    expect(onRebuildIndex).toHaveBeenCalledTimes(1);

      expect(documents?.action).toBeUndefined();
      expect(cards).toHaveLength(9);
      expect(onAddSource).not.toHaveBeenCalled();
      expect(onBackfillHistory).not.toHaveBeenCalled();
      expect(onRetryRemote).not.toHaveBeenCalled();
  });

  it("provides add-source action on empty sources metrics", () => {
    const metrics = computeKnowledgeQuantMetrics([], [], null);
    const onAddSource = vi.fn();

    const cards = buildKnowledgeQuantCardViewModels({
      metrics,
      handlers: {
        addSource: onAddSource,
        rebuildIndex: vi.fn(),
        backfillHistory: vi.fn(),
        retryRemote: vi.fn(),
      },
      loading: {
        addSource: false,
        rebuildIndex: false,
        backfillHistory: false,
        retryRemote: false,
      },
    });

      const documentsCard = cards.find((item) => item.key === "documents");
      expect(documentsCard?.action?.defaultLabel).toBe("Add Source");
      documentsCard?.action?.onClick();
    expect(onAddSource).toHaveBeenCalledTimes(1);
  });
});
