import { describe, expect, it } from "vitest";
import type { KnowledgeSourceItem } from "../../../api/types";
import { summarizeRemoteRetryResults } from "./metrics";
import { buildRemoteRetryNotice, collectRemoteRetrySources } from "./remoteRetry";

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

describe("remoteRetry summary", () => {
  it("summarizes full success correctly", () => {
    const summary = summarizeRemoteRetryResults(
      [
        { id: "s1", name: "Source A" },
        { id: "s2", name: "Source B" },
      ],
      [
        { status: "fulfilled", value: {} },
        { status: "fulfilled", value: {} },
      ],
    );

    expect(summary).toEqual({
      successCount: 2,
      failedCount: 0,
      failedNames: [],
    });
  });

  it("summarizes partial failure with failed source names", () => {
    const summary = summarizeRemoteRetryResults(
      [
        { id: "s1", name: "Source A" },
        { id: "s2", name: "Source B" },
        { id: "s3", name: "Source C" },
      ],
      [
        { status: "fulfilled", value: {} },
        { status: "rejected", reason: new Error("x") },
        { status: "rejected", reason: new Error("y") },
      ],
    );

    expect(summary.successCount).toBe(1);
    expect(summary.failedCount).toBe(2);
    expect(summary.failedNames).toEqual(["Source B", "Source C"]);
  });

  it("collects only non-cached remote sources", () => {
    const retrySources = collectRemoteRetrySources([
      createSource({
        id: "s1",
        name: "Source A",
        status: {
          indexed: true,
          indexed_at: "2026-04-09T00:00:00Z",
          document_count: 1,
          chunk_count: 1,
          error: null,
          remote_cache_state: "cached",
        },
      }),
      createSource({
        id: "s2",
        name: "Source B",
        status: {
          indexed: true,
          indexed_at: "2026-04-09T00:00:00Z",
          document_count: 1,
          chunk_count: 1,
          error: null,
          remote_cache_state: "waiting_retry",
        },
      }),
      createSource({
        id: "s3",
        name: "Source C",
        status: {
          indexed: true,
          indexed_at: "2026-04-09T00:00:00Z",
          document_count: 1,
          chunk_count: 1,
          error: null,
          remote_cache_state: "ready_retry",
        },
      }),
    ]);

    expect(retrySources).toEqual([
      { id: "s2", name: "Source B" },
      { id: "s3", name: "Source C" },
    ]);
  });

  it("builds remote retry notices for success, partial and full failure", () => {
    expect(buildRemoteRetryNotice({
      successCount: 2,
      failedCount: 0,
      failedNames: [],
    })).toEqual({
      level: "success",
      i18nKey: "knowledge.remoteRetrySuccess",
      params: { count: 2 },
    });

    expect(buildRemoteRetryNotice({
      successCount: 1,
      failedCount: 2,
      failedNames: ["A", "B", "C", "D"],
    })).toEqual({
      level: "warning",
      i18nKey: "knowledge.remoteRetryPartial",
      params: {
        success: 1,
        failed: 2,
        failedNames: "A, B, C",
      },
    });

    expect(buildRemoteRetryNotice({
      successCount: 0,
      failedCount: 2,
      failedNames: ["A", "B"],
    })).toEqual({
      level: "error",
      i18nKey: "knowledge.remoteRetryAllFailed",
      params: {
        failed: 2,
        failedNames: "A, B",
      },
    });
  });
});
