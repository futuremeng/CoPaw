import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import useArtifactSelectionGuards from "../hooks/useArtifactSelectionGuards";
import type { AgentProjectFileInfo, ProjectPipelineArtifactRecord } from "../../../../api/types/agents";

function TestHarness(params: {
  selectedStepId?: string;
  currentStepIds?: string[];
  selectedFilePath: string;
  relatedArtifactPathsForSelectedStep?: Set<string>;
  artifactRecords?: ProjectPipelineArtifactRecord[];
  filesLoading?: boolean;
  knownProjectFilePaths?: Set<string>;
  projectFiles?: AgentProjectFileInfo[];
  setSelectedStepId?: ReturnType<typeof vi.fn>;
  setSelectedFilePath: ReturnType<typeof vi.fn>;
}) {
  useArtifactSelectionGuards({
    selectedStepId: params.selectedStepId || "",
    setSelectedStepId: params.setSelectedStepId || vi.fn(),
    currentStepIds: params.currentStepIds || [],
    selectedFilePath: params.selectedFilePath,
    setSelectedFilePath: params.setSelectedFilePath,
    relatedArtifactPathsForSelectedStep: params.relatedArtifactPathsForSelectedStep || new Set<string>(),
    artifactRecords: params.artifactRecords || [],
    filesLoading: Boolean(params.filesLoading),
    knownProjectFilePaths: params.knownProjectFilePaths || new Set<string>(),
    projectFiles: params.projectFiles || [],
  });
  return null;
}

describe("useArtifactSelectionGuards fallback behavior", () => {
  it("keeps selection when path remains known but is temporarily hidden from filtered project files", async () => {
    const setSelectedFilePath = vi.fn();

    render(
      <TestHarness
        selectedFilePath="docs/selected.md"
        setSelectedFilePath={setSelectedFilePath}
        projectFiles={[]}
        artifactRecords={[]}
        knownProjectFilePaths={new Set<string>(["docs/selected.md"])}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(setSelectedFilePath).not.toHaveBeenCalled();
  });

  it("falls back to a root-level previewable file when current selection disappears", async () => {
    const setSelectedFilePath = vi.fn();

    render(
      <TestHarness
        selectedFilePath="missing.md"
        setSelectedFilePath={setSelectedFilePath}
        projectFiles={[
          {
            filename: "root.md",
            path: "root.md",
            size: 1,
            modified_time: "",
          },
          {
            filename: "nested.md",
            path: "docs/nested.md",
            size: 1,
            modified_time: "",
          },
        ]}
      />,
    );

    await waitFor(() => {
      expect(setSelectedFilePath).toHaveBeenCalledWith("root.md");
    });
  });

  it("does not clear selection while files are still loading", async () => {
    const setSelectedFilePath = vi.fn();

    render(
      <TestHarness
        selectedFilePath="missing.md"
        setSelectedFilePath={setSelectedFilePath}
        filesLoading
        projectFiles={[
          {
            filename: "root.md",
            path: "root.md",
            size: 1,
            modified_time: "",
          },
        ]}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(setSelectedFilePath).not.toHaveBeenCalled();
  });

  it("clears selection only when no previewable fallback exists", async () => {
    const setSelectedFilePath = vi.fn();

    render(
      <TestHarness
        selectedFilePath="missing.md"
        setSelectedFilePath={setSelectedFilePath}
        projectFiles={[]}
        artifactRecords={[]}
        knownProjectFilePaths={new Set<string>()}
      />,
    );

    await waitFor(() => {
      expect(setSelectedFilePath).toHaveBeenCalledWith("");
    });
  });
});
