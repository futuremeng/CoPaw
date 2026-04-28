import { describe, expect, it } from "vitest";
import type { KnowledgeTaskProgress } from "../../../api/types";
import type { KnowledgeSourceItem, ProjectKnowledgeSyncState } from "../../../api/types";
import {
  deriveSourceQuantBaseMetrics,
  getActiveKnowledgeTasks,
  pickActiveKnowledgeTask,
} from "./useProjectKnowledgeState";

function buildTask(
  overrides: Partial<KnowledgeTaskProgress> = {},
): KnowledgeTaskProgress {
  return {
    task_id: "task-default",
    task_type: "project_sync",
    status: "running",
    updated_at: "2026-04-25T10:00:00Z",
    ...overrides,
  };
}

describe("useProjectKnowledgeState task priority", () => {
  it("prefers quality loop and memify over project sync for the primary active task", () => {
    const tasks = [
      buildTask({ task_id: "sync-1", task_type: "project_sync", updated_at: "2026-04-25T10:03:00Z" }),
      buildTask({ task_id: "memify-1", task_type: "memify", updated_at: "2026-04-25T10:02:00Z" }),
      buildTask({ task_id: "quality-1", task_type: "quality_loop", updated_at: "2026-04-25T10:01:00Z" }),
    ];

    expect(pickActiveKnowledgeTask(tasks)?.task_id).toBe("quality-1");
  });

  it("keeps project sync ahead of history backfill when no higher-order task is active", () => {
    const tasks = [
      buildTask({ task_id: "backfill-1", task_type: "history_backfill", updated_at: "2026-04-25T10:02:00Z" }),
      buildTask({ task_id: "sync-1", task_type: "project_sync", updated_at: "2026-04-25T10:01:00Z" }),
    ];

    expect(getActiveKnowledgeTasks(tasks).map((task) => task.task_id)).toEqual([
      "sync-1",
      "backfill-1",
    ]);
  });

  it("filters out inactive tasks before ranking", () => {
    const tasks = [
      buildTask({ task_id: "done-memify", task_type: "memify", status: "succeeded" }),
      buildTask({ task_id: "queued-sync", task_type: "project_sync", status: "queued" }),
    ];

    expect(getActiveKnowledgeTasks(tasks).map((task) => task.task_id)).toEqual(["queued-sync"]);
  });
});

function buildSource(
  status: Partial<KnowledgeSourceItem["status"]>,
): KnowledgeSourceItem {
  return {
    id: "source-1",
    name: "Source 1",
    type: "directory",
    location: "/tmp/source-1",
    content: "",
    enabled: true,
    recursive: true,
    tags: [],
    summary: "",
    status: {
      indexed: false,
      indexed_at: null,
      document_count: 0,
      chunk_count: 0,
      sentence_count: 0,
      char_count: 0,
      token_count: 0,
      error: null,
      ...status,
    },
  };
}

function buildSyncState(
  overrides: Partial<ProjectKnowledgeSyncState> = {},
): ProjectKnowledgeSyncState {
  return {
    project_id: "project-1",
    status: "idle",
    current_stage: "",
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
    latest_source_id: "",
    last_result: {},
    ...overrides,
  };
}

describe("deriveSourceQuantBaseMetrics", () => {
  it("prefers backend global metrics when present", () => {
    const sources = [
      buildSource({
        indexed: true,
        document_count: 7,
        chunk_count: 15,
        sentence_count: 30,
      }),
    ];
    const syncState = buildSyncState({
      global_metrics: {
        document_count: 2,
        chunk_count: 3,
        sentence_count: 4,
        char_count: 5,
        token_count: 6,
      },
      last_result: {
        index: {
          document_count: 9,
          chunk_count: 18,
        },
      },
    });

    const metrics = deriveSourceQuantBaseMetrics(sources, true, syncState);

    expect(metrics.documentCount).toBe(2);
    expect(metrics.chunkCount).toBe(3);
    expect(metrics.sentenceCount).toBe(4);
    expect(metrics.charCount).toBe(5);
    expect(metrics.tokenCount).toBe(6);
  });

  it("falls back to source/index aggregation when backend global metrics are absent", () => {
    const sources = [
      buildSource({ indexed: false, document_count: 1, chunk_count: 2 }),
      buildSource({ indexed: false, document_count: 2, chunk_count: 4 }),
    ];
    const syncState = buildSyncState({
      last_result: {
        index: {
          document_count: 5,
          chunk_count: 9,
          sentence_count: 12,
        },
      },
    });

    const metrics = deriveSourceQuantBaseMetrics(sources, false, syncState);

    expect(metrics.documentCount).toBe(5);
    expect(metrics.chunkCount).toBe(9);
    expect(metrics.sentenceCount).toBe(12);
  });
});