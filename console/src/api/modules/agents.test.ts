import { afterEach, describe, expect, it, vi } from "vitest";
import { agentsApi } from "./agents";

vi.mock("../request", () => ({ request: vi.fn() }));

import { request } from "../request";

describe("agentsApi.queryProjectFiles", () => {
  afterEach(() => vi.clearAllMocks());

  it("posts query payload to files/query endpoint", async () => {
    vi.mocked(request).mockResolvedValue({
      items: [],
      summary: {
        total_matched: 0,
        offset: 0,
        limit: 200,
        returned: 0,
        builtin_count: 0,
        ignored_count: 0,
        stage_counts: {},
        content_type_counts: {},
      },
      query_meta: {
        search: "",
        path_prefix: "",
        stages: [],
        content_types: [],
        include_builtin: null,
        include_ignored: false,
        sort_by: "path",
        sort_order: "asc",
      },
    });

    await agentsApi.queryProjectFiles("agent-1", "project/a", {
      search: "brief",
      sort_by: "modified_time",
      sort_order: "desc",
      offset: 10,
      limit: 20,
      include_ignored: false,
    });

    expect(request).toHaveBeenCalledWith(
      "/agents/agent-1/projects/project%2Fa/files/query",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          search: "brief",
          sort_by: "modified_time",
          sort_order: "desc",
          offset: 10,
          limit: 20,
          include_ignored: false,
        }),
      }),
    );
  });
});

describe("agentsApi.listProjectFiles", () => {
  afterEach(() => vi.clearAllMocks());

  it("uses files/query and maps response items with query classification metadata", async () => {
    vi.mocked(request).mockResolvedValue({
      items: [
        {
          filename: "a.md",
          path: "original/a.md",
          size: 128,
          modified_time: "2026-05-19T10:00:00",
          stage: "original",
          content_type: "markdown",
          builtin: false,
          ignored: false,
        },
      ],
      summary: {
        total_matched: 1,
        offset: 0,
        limit: 5000,
        returned: 1,
        builtin_count: 0,
        ignored_count: 0,
        stage_counts: { original: 1 },
        content_type_counts: { markdown: 1 },
      },
      query_meta: {
        search: "",
        path_prefix: "",
        stages: [],
        content_types: [],
        include_builtin: null,
        include_ignored: false,
        sort_by: "path",
        sort_order: "asc",
      },
    });

    const files = await agentsApi.listProjectFiles("agent-1", "project-a");

    expect(request).toHaveBeenCalledWith(
      "/agents/agent-1/projects/project-a/files/query",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(files).toEqual([
      {
        filename: "a.md",
        path: "original/a.md",
        size: 128,
        modified_time: "2026-05-19T10:00:00",
        stage: "original",
        content_type: "markdown",
        builtin: false,
        ignored: false,
      },
    ]);
  });
});
