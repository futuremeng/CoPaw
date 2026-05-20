import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import ProjectsListPage from "../ProjectsListPage";

const {
  navigateMock,
  mockedSuccess,
  mockedError,
  mockedAgentsApi,
  storeState,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  mockedSuccess: vi.fn(),
  mockedError: vi.fn(),
  mockedAgentsApi: {
    getAgent: vi.fn(),
    listAgentProjects: vi.fn(),
    createProject: vi.fn(),
    cloneProject: vi.fn(),
    deleteProject: vi.fn(),
  },
  storeState: {
    selectedAgent: "agent-1",
  } as { selectedAgent: string },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      maybeFallbackOrOptions?: string | { name?: string },
      maybeOptions?: { name?: string },
    ) => {
      const fallback = typeof maybeFallbackOrOptions === "string" ? maybeFallbackOrOptions : key;
      const options = typeof maybeFallbackOrOptions === "object" ? maybeFallbackOrOptions : maybeOptions;
      if (options?.name && typeof fallback === "string") {
        return fallback.replace("{{name}}", options.name);
      }
      return fallback;
    },
  }),
}));

vi.mock("../../../../stores/agentStore", () => ({
  useAgentStore: () => ({
    selectedAgent: storeState.selectedAgent,
  }),
}));

vi.mock("../../../../api/modules/agents", () => ({
  agentsApi: mockedAgentsApi,
}));

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  return {
    ...actual,
    message: {
      success: mockedSuccess,
      error: mockedError,
    },
  };
});

describe("ProjectsListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.selectedAgent = "agent-1";
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    mockedAgentsApi.getAgent.mockResolvedValue({
      id: "agent-1",
      name: "Agent One",
      workspace_dir: "/tmp/agent-1",
    });
    mockedAgentsApi.listAgentProjects.mockResolvedValue([]);
    mockedAgentsApi.createProject.mockResolvedValue({
      id: "project-1",
      name: "Project One",
      description: "demo",
      status: "active",
      workspace_dir: "workspace",
      data_dir: "output",
      metadata_file: ".agent/PROJECT.md",
      tags: ["demo", "draft"],
      artifact_distill_mode: "file_scan",
      artifact_profile: {
        skills: [],
        scripts: [],
        flows: [],
        cases: [],
      },
      project_auto_knowledge_sink: true,
      created_time: "2026-04-20T00:00:00Z",
      updated_time: "2026-04-24T00:00:00Z",
    });
  });

  it("sorts projects by updated time descending by default", async () => {
    mockedAgentsApi.listAgentProjects.mockResolvedValue([
      {
        id: "project-new",
        name: "Project New",
        description: "newer update",
        status: "active",
        workspace_dir: "/tmp/project-new",
        data_dir: "output",
        metadata_file: ".agent/PROJECT.md",
        tags: [],
        artifact_distill_mode: "file_scan",
        artifact_profile: { skills: [], scripts: [], flows: [], cases: [] },
        project_auto_knowledge_sink: true,
        created_time: "2026-04-03T00:00:00Z",
        updated_time: "2026-04-12T00:00:00Z",
      },
      {
        id: "project-old",
        name: "Project Old",
        description: "older update",
        status: "active",
        workspace_dir: "/tmp/project-old",
        data_dir: "output",
        metadata_file: ".agent/PROJECT.md",
        tags: [],
        artifact_distill_mode: "file_scan",
        artifact_profile: { skills: [], scripts: [], flows: [], cases: [] },
        project_auto_knowledge_sink: true,
        created_time: "2026-04-01T00:00:00Z",
        updated_time: "2026-04-09T00:00:00Z",
      },
    ]);

    render(<ProjectsListPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId("project-name").map((item) => item.textContent)).toEqual([
        "Project New",
        "Project Old",
      ]);
    });
  });

  it("switches to created time ascending sort", async () => {
    const user = userEvent.setup();
    mockedAgentsApi.listAgentProjects.mockResolvedValue([
      {
        id: "project-later",
        name: "Project Later",
        description: "later created",
        status: "active",
        workspace_dir: "/tmp/project-later",
        data_dir: "output",
        metadata_file: ".agent/PROJECT.md",
        tags: [],
        artifact_distill_mode: "file_scan",
        artifact_profile: { skills: [], scripts: [], flows: [], cases: [] },
        project_auto_knowledge_sink: true,
        created_time: "2026-04-08T00:00:00Z",
        updated_time: "2026-04-10T00:00:00Z",
      },
      {
        id: "project-earlier",
        name: "Project Earlier",
        description: "earlier created",
        status: "active",
        workspace_dir: "/tmp/project-earlier",
        data_dir: "output",
        metadata_file: ".agent/PROJECT.md",
        tags: [],
        artifact_distill_mode: "file_scan",
        artifact_profile: { skills: [], scripts: [], flows: [], cases: [] },
        project_auto_knowledge_sink: true,
        created_time: "2026-04-02T00:00:00Z",
        updated_time: "2026-04-11T00:00:00Z",
      },
    ]);

    render(<ProjectsListPage />);

    await waitFor(() => {
      expect(screen.getAllByTestId("project-name").map((item) => item.textContent)).toEqual([
        "Project Earlier",
        "Project Later",
      ]);
    });

    await user.click(screen.getByRole("combobox", { name: "Sort projects by" }));
    await user.click(screen.getByText("Created time"));
    await user.click(screen.getByLabelText("Toggle sort order"));

    const names = screen.getAllByTestId("project-name").map((item) => item.textContent);

    expect(names).toEqual(["Project Earlier", "Project Later"]);
  });

  it("creates projects with default output dir", async () => {
    const user = userEvent.setup();

    render(<ProjectsListPage />);

    await waitFor(() => {
      expect(mockedAgentsApi.getAgent).toHaveBeenCalledWith("agent-1");
    });

    await user.click(screen.getAllByRole("button", { name: "New Project" })[0]);
    await user.type(screen.getByLabelText("Name"), "Project One");
    await user.type(screen.getByLabelText("Description"), "demo");
    await user.type(screen.getByLabelText("Tags (comma separated)"), "demo, draft");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(mockedAgentsApi.createProject).toHaveBeenCalledWith("agent-1", {
        id: undefined,
        name: "Project One",
        description: "demo",
        status: "active",
        data_dir: "output",
        tags: ["demo", "draft"],
      });
    });
  }, 15000);
});