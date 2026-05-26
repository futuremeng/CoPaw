import { describe, expect, it, vi } from "vitest";
import type { AgentProjectSummary } from "../../../../api/types/agents";
import {
  buildProjectRequestCandidates,
  resolveProjectRequestCandidate,
} from "../utils/projectRequestResolver";

function buildProject(overrides?: Partial<AgentProjectSummary>): AgentProjectSummary {
  return {
    id: "project-main",
    name: "Project Main",
    description: "",
    status: "active",
    workspace_dir: "",
    data_dir: "",
    metadata_file: "projects/project-alt/.agent/PROJECT.md",
    tags: [],
    artifact_distill_mode: "file_scan",
    artifact_profile: {
      skills: [],
      scripts: [],
      flows: [],
      cases: [],
    },
    project_auto_knowledge_sink: false,
    preferred_workspace_chat_id: "",
    created_time: "",
    updated_time: "",
    ...overrides,
  };
}

describe("projectRequestResolver", () => {
  it("builds request candidates from preferred, route, and project metadata", () => {
    const project = buildProject();

    const candidates = buildProjectRequestCandidates(project, {
      preferredProjectRequestId: " preferred-id ",
      routeProjectId: "",
    });

    expect(candidates).toEqual([
      "preferred-id",
      "project-main",
      "project-alt",
    ]);
  });

  it("resolves to the first successful project request id", async () => {
    const loader = vi.fn<
      (projectRequestId: string) => Promise<string>
    >()
      .mockRejectedValueOnce(new Error("missing-a"))
      .mockResolvedValueOnce("ok-b");

    const resolved = await resolveProjectRequestCandidate({
      projectRequestIds: ["a", "b", "c"],
      loader,
    });

    expect(resolved).toEqual({
      projectRequestId: "b",
      value: "ok-b",
    });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("retries when first round fails", async () => {
    const loader = vi.fn<
      (projectRequestId: string) => Promise<string>
    >()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("recovered");

    const resolved = await resolveProjectRequestCandidate({
      projectRequestIds: ["project-main"],
      loader,
      retryCount: 1,
      retryDelayMs: 0,
    });

    expect(resolved.projectRequestId).toBe("project-main");
    expect(resolved.value).toBe("recovered");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("throws the last error when all attempts fail", async () => {
    const loader = vi.fn<
      (projectRequestId: string) => Promise<string>
    >()
      .mockRejectedValue(new Error("final-failure"));

    await expect(resolveProjectRequestCandidate({
      projectRequestIds: ["a", "b"],
      loader,
      retryCount: 1,
      retryDelayMs: 0,
    })).rejects.toThrow("final-failure");

    expect(loader).toHaveBeenCalledTimes(4);
  });
});
