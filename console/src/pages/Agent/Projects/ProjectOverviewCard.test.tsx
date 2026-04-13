import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentProjectFileInfo,
  AgentProjectFileSummary,
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
    initialFilter?: "" | "original" | "intermediate" | "artifact" | "agent" | "skill" | "flow" | "case" | "builtin" | "markdown" | "text" | "script" | "otherType";
    initialTreeDisplayMode?: "filter" | "highlight";
    projectFileSummary?: AgentProjectFileSummary | null;
  },
) {
  const onUploadFiles = vi.fn();
  const onSelectFileFromTree = vi.fn();
  const onAttachArtifactToChat = vi.fn();

  function TestHarness() {
    const [selectedMetricFilter, setSelectedMetricFilter] = useState<
      "" | "original" | "intermediate" | "artifact" | "agent" | "skill" | "flow" | "case" | "builtin" | "markdown" | "text" | "script" | "otherType"
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
        projectFileSummary={options?.projectFileSummary ?? null}
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
  it("toggles file-type filter card and updates filter indicator", async () => {
    const user = userEvent.setup();
    renderCard([
      {
        filename: "guide.md",
        path: "original/guide.md",
        size: 123,
        modified_time: "2026-04-09T00:00:00Z",
      },
    ]);

    const markdownButton = screen.getByRole("button", { name: /Markdown/i });
    await user.click(markdownButton);
    expect(markdownButton.getAttribute("aria-pressed")).toBe("true");

    await user.click(markdownButton);
    expect(markdownButton.getAttribute("aria-pressed")).toBe("false");
  });

  it("shows reset action for active markdown filter and clears it", async () => {
    const user = userEvent.setup();
    renderCard([
      {
        filename: "guide.md",
        path: "original/guide.md",
        size: 123,
        modified_time: "2026-04-09T00:00:00Z",
      },
    ]);

    await user.click(screen.getByRole("button", { name: /Markdown/i }));
    const resetButton = screen.getByRole("button", { name: "Reset" });
    expect(resetButton).toBeDefined();

    await user.click(resetButton);
    expect(screen.getByRole("button", { name: /Markdown/i }).getAttribute("aria-pressed")).toBe("false");
  });

  it("shows empty filtered hint when no files match selected script filter", async () => {
    const user = userEvent.setup();
    renderCard([
      {
        filename: "diagram.png",
        path: "data/diagram.png",
        size: 1024,
        modified_time: "2026-04-09T00:00:00Z",
      },
    ]);

    await user.click(screen.getByRole("button", { name: /脚本/i }));

    expect(screen.getByText("No related files under the current filter")).toBeDefined();
    expect(screen.getByRole("button", { name: /脚本/i }).getAttribute("aria-pressed")).toBe("true");
  });

  it("shows only built-in files when builtin stage/filter is active", () => {
    renderCard(
      [
        {
          filename: "AGENTS.md",
          path: ".agent/AGENTS.md",
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
    expect(screen.getByText(".cursor")).toBeDefined();
    expect(screen.queryByText(".env")).toBeNull();
    expect(screen.queryByText("guide.md")).toBeNull();
  });

  it("loads non-built-in files in highlight mode for builtin filter", () => {
    renderCard(
      [
        {
          filename: "AGENTS.md",
          path: ".agent/AGENTS.md",
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

  it("prefers server summary counts in overview cards when provided", () => {
    renderCard(
      [
        {
          filename: "guide.md",
          path: "original/guide.md",
          size: 10,
          modified_time: "2026-04-09T00:00:00Z",
        },
      ],
      {
        projectFileSummary: {
          total_files: 10,
          builtin_files: 2,
          visible_files: 8,
          original_files: 5,
          intermediate_files: 2,
          artifact_files: 1,
          derived_files: 3,
          knowledge_candidate_files: 7,
          markdown_files: 6,
          text_files: 4,
          script_files: 2,
          other_type_files: 1,
          text_like_files: 8,
          agent_files: 1,
          skill_files: 1,
          flow_files: 1,
          case_files: 1,
          recently_updated_files: 4,
        },
      },
    );

    expect(screen.getByRole("button", { name: /Original Files/i }).textContent).toContain("5");
    expect(screen.getByRole("button", { name: /Intermediate Files/i }).textContent).toContain("2");
    expect(screen.getByRole("button", { name: /Markdown/i }).textContent).toContain("6");
    expect(screen.getByRole("button", { name: /文本文件/i }).textContent).toContain("4");
  });
});
