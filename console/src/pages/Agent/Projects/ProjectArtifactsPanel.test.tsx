import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProjectArtifactsPanel from "./components/ProjectArtifactsPanel";
import type { ProjectKnowledgeState } from "./hooks/useProjectKnowledgeState";

vi.mock("./components/ProjectMdxReadonlyPreview", () => ({
  default: ({ markdown }: { filePath: string; markdown: string }) => (
    <div data-testid="project-mdx-preview">{markdown}</div>
  ),
}));

vi.mock("./components/ProjectDocumentKnowledgeVisualization", () => ({
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
    selectedFilePath: "docs/baseline.md",
    knownProjectFilesByPath: {
      "docs/baseline.md": {
        filename: "baseline.md",
        path: "docs/baseline.md",
        relative_path: "docs/baseline.md",
        size: 0,
        modified_time: "2026-04-24 10:00:00",
        is_directory: false,
      },
    },
    projectFiles: [],
    fileContent: "",
    charStatsContent: "",
    nerStructuredContent: "",
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
          "docs/baseline.md": {
            ...baseProps.knownProjectFilesByPath["docs/baseline.md"],
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

  it("hides knowledge visualization for dot-prefixed built-in directory files", () => {
    render(
      <ProjectArtifactsPanel
        {...baseProps}
        selectedFilePath=".agent/AGENTS.md"
        knownProjectFilesByPath={{
          ".agent/AGENTS.md": {
            filename: "AGENTS.md",
            path: ".agent/AGENTS.md",
            size: 120,
            modified_time: "2026-04-24 10:00:00",
          },
        }}
        fileContent={"# Rules\n"}
      />,
    );

    expect(screen.queryByText("Current Document Knowledge Visualization")).toBeNull();
    expect(screen.queryByTestId("project-knowledge-visualization")).toBeNull();
  });

  it("hides knowledge visualization for root dot files", () => {
    render(
      <ProjectArtifactsPanel
        {...baseProps}
        selectedFilePath=".gitignore"
        knownProjectFilesByPath={{
          ".gitignore": {
            filename: ".gitignore",
            path: ".gitignore",
            size: 64,
            modified_time: "2026-04-24 10:00:00",
          },
        }}
        fileContent={"node_modules\n"}
      />,
    );

    expect(screen.queryByText("Current Document Knowledge Visualization")).toBeNull();
    expect(screen.queryByTestId("project-knowledge-visualization")).toBeNull();
  });
});