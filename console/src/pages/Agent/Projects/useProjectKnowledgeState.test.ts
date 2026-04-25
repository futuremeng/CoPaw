import { describe, expect, it } from "vitest";
import type { KnowledgeTaskProgress } from "../../../api/types";
import {
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