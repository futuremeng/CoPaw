import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  AgentProjectFileInfo,
  AgentProjectSummary,
} from "../../../api/types/agents";
import ProjectOverviewCard from "./ProjectOverviewCard";

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
    updated_time: "2026-04-09T00:00:00Z",
  };
}

function renderCard(projectFiles: AgentProjectFileInfo[]) {
  const onUploadFiles = vi.fn();
  const onSelectFileFromTree = vi.fn();
  const onAttachArtifactToChat = vi.fn();
  const onToggleHideBuiltInFiles = vi.fn();

  render(
    <ProjectOverviewCard
      selectedProject={buildProjectSummary()}
      projectFileCount={projectFiles.length}
      pipelineTemplateCount={0}
      pipelineRunCount={0}
      projectWorkspaceSummary="snapshot"
      projectFiles={projectFiles}
      priorityFilePaths={[]}
      selectedFilePath=""
      selectedAttachPaths={[]}
      hideBuiltInFiles={false}
      onUploadFiles={onUploadFiles}
      onSelectFileFromTree={onSelectFileFromTree}
      onAttachArtifactToChat={onAttachArtifactToChat}
      onToggleHideBuiltInFiles={onToggleHideBuiltInFiles}
    />,
  );
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

    expect(screen.getByText("Current filter: Knowledge Candidates")).toBeDefined();

    await user.click(knowledgeButton);

    expect(screen.queryByText("Current filter: Knowledge Candidates")).toBeNull();
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

    expect(screen.queryByText("Current filter: Knowledge Candidates")).toBeNull();
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
    expect(screen.getByText("Current filter: Text-like Files")).toBeDefined();
  });
});
