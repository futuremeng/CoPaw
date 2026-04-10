import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentProjectFileInfo,
  AgentProjectSummary,
} from "../../../api/types/agents";
import ProjectOverviewCard from "./ProjectOverviewCard";
import type { ProjectStageKey } from "./projectLayoutPrefs";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      maybeFallbackOrOptions?: string | { label?: string },
      maybeOptions?: { label?: string },
    ) => {
      const fallback = typeof maybeFallbackOrOptions === "string" ? maybeFallbackOrOptions : undefined;
      const options = typeof maybeFallbackOrOptions === "object"
        ? maybeFallbackOrOptions
        : maybeOptions;

      if (options?.label && typeof fallback === "string") {
        return fallback.replace("{{label}}", options.label);
      }

      if (typeof fallback === "string") {
        return fallback;
      }

      return key;
    },
  }),
}));

function buildProjectSummary(): AgentProjectSummary {
  return {
    id: "proj-1",
    name: "Project One",
    description: "demo",
    status: "active",
    workspace_dir: "workspace",
    data_dir: "data",
    metadata_file: "project.json",
    tags: [],
    artifact_distill_mode: "file_scan",
    artifact_profile: {
      skills: [],
      scripts: [],
      flows: [],
      cases: [],
    },
    project_auto_knowledge_sink: true,
    updated_time: "2026-04-09T00:00:00Z",
  };
}

function renderCard(
  projectFiles: AgentProjectFileInfo[],
  options?: {
    activeStage?: ProjectStageKey;
    initialFilter?: "" | "original" | "derived" | "skills" | "scripts" | "flows" | "cases" | "builtin" | "knowledgeCandidates" | "markdown" | "textLike" | "recent";
    initialTreeDisplayMode?: "filter" | "highlight";
  },
) {
  const onUploadFiles = vi.fn();
  const onSelectFileFromTree = vi.fn();
  const onAttachArtifactToChat = vi.fn();

  function TestHarness() {
    const [selectedMetricFilter, setSelectedMetricFilter] = useState<
      "" | "original" | "derived" | "skills" | "scripts" | "flows" | "cases" | "builtin" | "knowledgeCandidates" | "markdown" | "textLike" | "recent"
    >(options?.initialFilter ?? "");
    const [treeDisplayMode, setTreeDisplayMode] = useState<"filter" | "highlight">(options?.initialTreeDisplayMode ?? "filter");

    return (
      <ProjectOverviewCard
        activeStage={options?.activeStage ?? "source"}
        selectedMetricFilter={selectedMetricFilter}
        onMetricFilterChange={setSelectedMetricFilter}
        treeDisplayMode={treeDisplayMode}
        onTreeDisplayModeChange={setTreeDisplayMode}
        selectedProject={buildProjectSummary()}
        projectFileCount={projectFiles.length}
        pipelineTemplateCount={0}
        pipelineRunCount={0}
        projectWorkspaceSummary="snapshot"
        projectFiles={projectFiles}
        priorityFilePaths={[]}
        selectedFilePath=""
        selectedAttachPaths={[]}
        onUploadFiles={onUploadFiles}
        onSelectFileFromTree={onSelectFileFromTree}
        onAttachArtifactToChat={onAttachArtifactToChat}
      />
    );
  }

  render(<TestHarness />);
}

describe("ProjectOverviewCard interactions", () => {
  it("toggles knowledge filter card and updates filter indicator", async () => {
    const user = userEvent.setup();
    renderCard([
      {
        filename: "guide.md",
        path: "original/guide.md",
        size: 123,
        modified_time: "2026-04-09T00:00:00Z",
      },
    ]);

    const knowledgeButton = screen.getByRole("button", { name: /Knowledge Candidates/i });
    await user.click(knowledgeButton);

    expect(knowledgeButton.getAttribute("aria-pressed")).toBe("true");

    await user.click(knowledgeButton);

    expect(knowledgeButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows reset action for active knowledge filter and clears it", async () => {
    const user = userEvent.setup();
    renderCard([
      {
        filename: "guide.md",
        path: "original/guide.md",
        size: 123,
        modified_time: "2026-04-09T00:00:00Z",
      },
    ]);

    await user.click(screen.getByRole("button", { name: /Knowledge Candidates/i }));
    const resetButton = screen.getByRole("button", { name: "Reset" });
    expect(resetButton).toBeDefined();

    await user.click(resetButton);

    expect(screen.getByRole("button", { name: /Knowledge Candidates/i }).getAttribute("aria-pressed")).toBe("false");
  });

  it("shows empty filtered hint when no files match selected knowledge filter", async () => {
    const user = userEvent.setup();
    renderCard([
      {
        filename: "diagram.png",
        path: "data/diagram.png",
        size: 1024,
        modified_time: "2026-04-09T00:00:00Z",
      },
    ]);

    await user.click(screen.getByRole("button", { name: /Text-like Files/i }));

    expect(screen.getByText("No related files under the current filter")).toBeDefined();
    expect(screen.getByRole("button", { name: /Text-like Files/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows only built-in files when builtin stage/filter is active", () => {
    renderCard(
      [
        {
          filename: "AGENTS.md",
          path: "AGENTS.md",
          size: 10,
          modified_time: "2026-04-09T00:00:00Z",
        },
        {
          filename: ".env",
          path: ".env",
          size: 10,
          modified_time: "2026-04-09T00:00:00Z",
        },
        {
          filename: "config.json",
          path: ".cursor/config.json",
          size: 10,
          modified_time: "2026-04-09T00:00:00Z",
        },
        {
          filename: "guide.md",
          path: "original/guide.md",
          size: 10,
          modified_time: "2026-04-09T00:00:00Z",
        },
      ],
      { activeStage: "builtin", initialFilter: "builtin" },
    );

    expect(screen.getByText("AGENTS.md")).toBeDefined();
    expect(screen.getByText(".env")).toBeDefined();
    expect(screen.getByText(".cursor")).toBeDefined();
    expect(screen.queryByText("guide.md")).toBeNull();
  });

  it("loads non-built-in files in highlight mode for builtin filter", () => {
    renderCard(
      [
        {
          filename: "AGENTS.md",
          path: "AGENTS.md",
          size: 10,
          modified_time: "2026-04-09T00:00:00Z",
        },
        {
          filename: "guide.md",
          path: "original/guide.md",
          size: 10,
          modified_time: "2026-04-09T00:00:00Z",
        },
      ],
      { activeStage: "builtin", initialFilter: "builtin", initialTreeDisplayMode: "highlight" },
    );

    expect(screen.getByText("AGENTS.md")).toBeDefined();
    expect(screen.getByText("guide.md")).toBeDefined();
  });
});
