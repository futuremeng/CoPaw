import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProjectArtifactsPanel from "./ProjectArtifactsPanel";
import type { ProjectKnowledgeState } from "./useProjectKnowledgeState";

vi.mock("./ProjectMdxReadonlyPreview", () => ({
  default: ({ markdown }: { filePath: string; markdown: string }) => (
    <div data-testid="project-mdx-preview">{markdown}</div>
  ),
}));

vi.mock("./ProjectDocumentKnowledgeVisualization", () => ({
  default: ({ selectedFilePath }: { selectedFilePath: string }) => (
    <div data-testid="project-knowledge-visualization">viz:{selectedFilePath}</div>
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, maybeFallback?: string | Record<string, unknown>) =>
      typeof maybeFallback === "string" ? maybeFallback : key,
  }),
}));

describe("ProjectArtifactsPanel", () => {
  const baseProps = {
    filesLoading: false,
    contentLoading: false,
    artifactRecords: [],
    selectedArtifactRecord: undefined,
    selectedFilePath: ".memories/baseline.md",
    knownProjectFilesByPath: {
      ".memories/baseline.md": {
        filename: "baseline.md",
        path: ".memories/baseline.md",
        relative_path: ".memories/baseline.md",
        size: 0,
        modified_time: "2026-04-24 10:00:00",
        is_directory: false,
      },
    },
    projectFiles: [],
    fileContent: "",
    charStatsContent: "",
    selectedAttachPaths: [],
    autoAnalyzeOnAttach: false,
    sendingSelectedFiles: false,
    knowledgeState: {
      selectedSourceId: "",
      projectSourceId: "",
      sourceContentById: {},
    } as unknown as ProjectKnowledgeState,
    onToggleAutoAnalyze: vi.fn(),
    onSendSelectedFilesToChat: vi.fn(),
    formatBytes: () => "0 B",
  };

  it("shows an explicit empty-state for empty files", () => {
    render(<ProjectArtifactsPanel {...baseProps} />);

    expect(screen.getByText("This file is empty")).toBeTruthy();
    expect(screen.queryByText("Select a file to preview")).toBeNull();
    expect(screen.getByTestId("project-knowledge-visualization")).toBeTruthy();
  });

  it("renders file content when the file is not empty", () => {
    render(
      <ProjectArtifactsPanel
        {...baseProps}
        knownProjectFilesByPath={{
          ".memories/baseline.md": {
            ...baseProps.knownProjectFilesByPath[".memories/baseline.md"],
            size: 14,
          },
        }}
        fileContent={"# Baseline\n"}
      />,
    );

    expect(screen.getByTestId("project-mdx-preview")).toBeTruthy();
    expect(screen.getByText("# Baseline")).toBeTruthy();
    expect(screen.queryByText("This file is empty")).toBeNull();
  });

  it("falls back to raw text preview for non-markdown files", () => {
    render(
      <ProjectArtifactsPanel
        {...baseProps}
        selectedFilePath="scripts/build.sh"
        knownProjectFilesByPath={{
          "scripts/build.sh": {
            filename: "build.sh",
            path: "scripts/build.sh",
            size: 11,
            modified_time: "2026-04-24 10:00:00",
          },
        }}
        fileContent={"echo ready"}
      />,
    );

    expect(screen.queryByTestId("project-mdx-preview")).toBeNull();
    expect(screen.getByText("echo ready")).toBeTruthy();
  });
});