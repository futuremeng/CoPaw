import { describe, expect, it } from "vitest";
import { buildProjectIdCandidates, projectDirNameFromMetadata } from "./projectIdUtils";

describe("projectId utils", () => {
  it("resolves project directory from direct PROJECT.md path", () => {
    expect(projectDirNameFromMetadata("projects/project-abc/PROJECT.md")).toBe("project-abc");
  });

  it("resolves project directory from .agent PROJECT.md path", () => {
    expect(projectDirNameFromMetadata("projects/project-abc/.agent/PROJECT.md")).toBe("project-abc");
  });

  it("does not treat .agent as project id", () => {
    expect(projectDirNameFromMetadata(".agent/PROJECT.md")).toBe("");
  });

  it("deduplicates candidate project ids", () => {
    expect(buildProjectIdCandidates({
      id: "project-abc",
      name: "Demo",
      description: "",
      status: "active",
      workspace_dir: "",
      data_dir: "",
      metadata_file: "projects/project-abc/.agent/PROJECT.md",
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
      updated_time: "",
    })).toEqual(["project-abc"]);
  });
});
