import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ProjectKnowledgeInsightsPanel from "./ProjectKnowledgeInsightsPanel";
import ProjectKnowledgeSignalsPanel from "./ProjectKnowledgeSignalsPanel";
import ProjectKnowledgeSourcesPanel from "./ProjectKnowledgeSourcesPanel";
import type { ProjectKnowledgeState } from "./useProjectKnowledgeState";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      maybeFallbackOrOptions?: string | { value?: number },
    ) => {
      if (typeof maybeFallbackOrOptions === "string") {
        return maybeFallbackOrOptions;
      }
      if (key === "projects.knowledge.signalDelta") {
        return String(maybeFallbackOrOptions?.value ?? 0);
      }
      return key;
    },
  }),
}));

function buildKnowledgeState(): ProjectKnowledgeState {
  return {
    projectSourceId: "project-project-abc-workspace",
    sourceLoaded: true,
    sourceRegistered: true,
    projectSources: [
      {
        id: "project-project-abc-workspace",
        name: "Project Source",
        type: "directory",
        location: "/tmp/workspace",
        content: "",
        enabled: true,
        recursive: true,
        tags: ["project"],
        summary: "",
        status: {
          indexed: true,
          indexed_at: "2026-04-11T23:30:00+00:00",
          document_count: 3,
          chunk_count: 7,
          error: null,
        },
      },
    ],
    syncState: null,
    quantMetrics: {
      totalSources: 1,
      indexedSources: 1,
      indexedRatio: 1,
      documentCount: 3,
      chunkCount: 7,
      relationCount: 12,
    },
    trendRangeDays: 7,
    setTrendRangeDays: vi.fn(),
    trendExpanded: true,
    setTrendExpanded: vi.fn(),
    filteredTrendSnapshots: [
      {
        ts: Date.now() - 1000,
        indexedRatio: 1,
        documentCount: 2,
        chunkCount: 5,
        relationCount: 8,
      },
      {
        ts: Date.now(),
        indexedRatio: 1,
        documentCount: 3,
        chunkCount: 7,
        relationCount: 12,
      },
    ],
    trendDocumentPath: "M0,0 L1,1",
    trendChunkPath: "M0,1 L1,0",
    trendDelta: {
      documentDelta: 1,
      chunkDelta: 2,
      relationDelta: 4,
    },
    syncAlertType: "info",
    syncAlertDescription: "sync ok",
    suggestedQuery: "Summarize key entities",
    insightAction: "query",
    insightMessageKey: "projects.knowledge.insightNeedExplore",
    loadProjectSourceStatus: vi.fn().mockResolvedValue(undefined),
  };
}

describe("project knowledge supporting panels", () => {
  it("renders signals content outside explore", () => {
    render(<ProjectKnowledgeSignalsPanel knowledgeState={buildKnowledgeState()} />);

    expect(screen.getByText("projects.knowledge.signalsTitle")).not.toBeNull();
    expect(screen.getByText("projects.knowledge.signalRelations")).not.toBeNull();
  });

  it("renders source inventory", () => {
    render(<ProjectKnowledgeSourcesPanel knowledgeState={buildKnowledgeState()} />);

    expect(screen.getByText("Project Source")).not.toBeNull();
    expect(screen.getByText("/tmp/workspace")).not.toBeNull();
  });

  it("runs suggested query from insights panel", async () => {
    const user = userEvent.setup();
    const onRunSuggestedQuery = vi.fn();

    render(
      <ProjectKnowledgeInsightsPanel
        knowledgeState={buildKnowledgeState()}
        onRunSuggestedQuery={onRunSuggestedQuery}
      />,
    );

    await user.click(screen.getByRole("button", {
      name: "projects.knowledge.actionRunSuggestedQuery",
    }));

    expect(onRunSuggestedQuery).toHaveBeenCalledWith("Summarize key entities");
  });
});