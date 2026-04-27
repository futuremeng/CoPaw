import { describe, expect, it } from "vitest";
import {
  isPreviewablePath,
  pickPreviewablePathFromTreeNodes,
  resolveArtifactSelectionPath,
} from "./projectFileSelectionUtils";

describe("project file selection utils", () => {
  it("allows managed hidden directories to be previewed", () => {
    expect(isPreviewablePath(".memories/baseline.md")).toBe(true);
    expect(isPreviewablePath(".agent/AGENTS.md")).toBe(true);
    expect(isPreviewablePath(".skills/demo/SKILL.md")).toBe(true);
    expect(isPreviewablePath(".data/source.txt")).toBe(true);
    expect(isPreviewablePath(".pipelines/templates/template.json")).toBe(true);
  });

  it("allows arbitrary hidden paths under the project workspace", () => {
    expect(isPreviewablePath(".env")).toBe(true);
    expect(isPreviewablePath(".cursor/rules.md")).toBe(true);
    expect(isPreviewablePath("docs/.drafts/notes.md")).toBe(true);
  });

  it("selects the first previewable file from tree nodes", () => {
    expect(pickPreviewablePathFromTreeNodes([
      {
        filename: "graphify",
        path: "projects/demo/.knowledge/graphify",
        size: 0,
        modified_time: "",
        is_directory: true,
        child_count: 2,
        descendant_file_count: 2,
      },
      {
        filename: "manifest.json",
        path: "projects/demo/.knowledge/graphify/manifest.json",
        size: 10,
        modified_time: "",
        is_directory: false,
        child_count: 0,
        descendant_file_count: 0,
      },
    ])).toBe("projects/demo/.knowledge/graphify/manifest.json");
  });

  it("returns empty when a directory has no previewable child file", () => {
    expect(pickPreviewablePathFromTreeNodes([
      {
        filename: "graphify",
        path: "projects/demo/.knowledge/graphify",
        size: 0,
        modified_time: "",
        is_directory: true,
        child_count: 0,
        descendant_file_count: 0,
      },
    ])).toBe("");
  });

  it("resolves a directory artifact path to its first previewable child file", () => {
    expect(resolveArtifactSelectionPath(
      "projects/demo/.knowledge/graphify",
      [
        {
          filename: "manifest.json",
          path: "projects/demo/.knowledge/graphify/manifest.json",
          size: 10,
          modified_time: "",
          is_directory: false,
          child_count: 0,
          descendant_file_count: 0,
        },
      ],
    )).toEqual({
      selectedPath: "projects/demo/.knowledge/graphify/manifest.json",
      expandedDirectoryPath: "projects/demo/.knowledge/graphify",
    });
  });

  it("keeps file artifact paths unchanged when no directory children are provided", () => {
    expect(resolveArtifactSelectionPath("projects/demo/.knowledge/graphify-out/graph.json")).toEqual({
      selectedPath: "projects/demo/.knowledge/graphify-out/graph.json",
      expandedDirectoryPath: null,
    });
  });

  it("expands the directory but leaves selection empty when no previewable child exists", () => {
    expect(resolveArtifactSelectionPath(
      "projects/demo/.knowledge/graphify",
      [],
    )).toEqual({
      selectedPath: "",
      expandedDirectoryPath: "projects/demo/.knowledge/graphify",
    });
  });
});