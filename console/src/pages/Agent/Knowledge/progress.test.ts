import { describe, expect, it } from "vitest";
import { buildUnifiedBatchProgress } from "./progress";

describe("knowledge unified batch progress", () => {
  it("prioritizes indexing-all state", () => {
    const state = buildUnifiedBatchProgress({
      indexingAll: true,
      backfillProgress: {
        running: true,
        completed: false,
        failed: false,
        total_sessions: 10,
        traversed_sessions: 2,
        processed_sessions: 0,
        updated_at: "2026-04-09T00:00:00Z",
      },
      backfillingHistory: true,
      clearingKnowledge: true,
    });

    expect(state).toEqual({
      visible: true,
      percent: 0,
      status: "active",
      labelI18nKey: "knowledge.unifiedProgressIndexAll",
      labelDefault: "Rebuilding all indexes...",
    });
  });

  it("computes backfill progress percent and params", () => {
    const state = buildUnifiedBatchProgress({
      indexingAll: false,
      backfillProgress: {
        running: true,
        completed: false,
        failed: false,
        total_sessions: 8,
        traversed_sessions: 3,
        processed_sessions: 0,
        updated_at: "2026-04-09T00:00:00Z",
      },
      backfillingHistory: false,
      clearingKnowledge: false,
    });

    expect(state).toEqual({
      visible: true,
      percent: 38,
      status: "active",
      labelI18nKey: "knowledge.unifiedProgressBackfill",
      labelDefault: "Backfilling history {{traversed}}/{{total}}",
      labelParams: { traversed: 3, total: 8 },
    });
  });

  it("returns hidden normal state when idle", () => {
    const state = buildUnifiedBatchProgress({
      indexingAll: false,
      backfillProgress: null,
      backfillingHistory: false,
      clearingKnowledge: false,
    });

    expect(state).toEqual({
      visible: false,
      percent: 0,
      status: "normal",
    });
  });
});
