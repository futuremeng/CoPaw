import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import ProjectEditorPanel from "../components/ProjectEditorPanel";
import type { ProjectWorkspaceFacade } from "../hooks/useProjectWorkspaceFacade";
import type { ProjectKnowledgeState } from "../hooks/useProjectKnowledgeState";

const openTab = vi.fn();
const setActiveTab = vi.fn();
const closeTab = vi.fn();
const setTabContent = vi.fn();
const setTabDirty = vi.fn();
const useTabsForScope = vi.fn((_scopeKey: string) => []);
const useActiveTabPathForScope = vi.fn((_scopeKey: string) => "");

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../../stores/codingTabsStore", () => ({
  useCodingTabsStore: () => ({
    openTab,
    setActiveTab,
    closeTab,
    setTabContent,
    setTabDirty,
  }),
  useTabsForScope: (scopeKey: string) => useTabsForScope(scopeKey),
  useActiveTabPathForScope: (scopeKey: string) =>
    useActiveTabPathForScope(scopeKey),
}));

vi.mock("../../../../stores/agentStore", () => ({
  useAgentStore: () => ({ selectedAgent: "agent-7" }),
}));

vi.mock("../../../Coding/TabbedEditor", () => ({
  default: () => <div data-testid="tabbed-editor" />,
}));

vi.mock("../components/ProjectDocumentKnowledgeVisualization", () => ({
  default: () => <div data-testid="knowledge-visualization" />,
}));

function buildProps() {
  const facade = {
    readText: vi.fn(async () => ({ content: "" })),
    writeText: vi.fn(async () => undefined),
  } as unknown as ProjectWorkspaceFacade;
  return {
    projectWorkspaceFacade: facade,
    selectedFilePath: "notes.md",
    fileContent: "hello",
    charStatsContent: "",
    nerStructuredContent: "",
    selectedAttachPaths: [] as string[],
    autoAnalyzeOnAttach: false,
    sendingSelectedFiles: false,
    knowledgeState: {} as ProjectKnowledgeState,
    onToggleAutoAnalyze: vi.fn(),
    onSendSelectedFilesToChat: vi.fn(),
    loadFileContent: () => "hello",
  };
}

describe("ProjectEditorPanel scope key", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTabsForScope.mockReturnValue([]);
    useActiveTabPathForScope.mockReturnValue("");
  });

  it("keys the coding tabs store by the agent files-workspace scope", () => {
    render(<ProjectEditorPanel {...buildProps()} />);

    expect(screen.getByTestId("tabbed-editor")).toBeInTheDocument();
    expect(useTabsForScope).toHaveBeenCalledWith("agent:agent-7");
    expect(useActiveTabPathForScope).toHaveBeenCalledWith("agent:agent-7");
    expect(openTab).toHaveBeenCalledWith("agent:agent-7", {
      path: "notes.md",
      content: "hello",
      dirty: false,
    });
    expect(setActiveTab).toHaveBeenCalledWith("agent:agent-7", "notes.md");
  });
});
