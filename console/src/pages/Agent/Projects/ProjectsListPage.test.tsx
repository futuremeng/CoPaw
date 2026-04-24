import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import ProjectsListPage from "./ProjectsListPage";

const {
  navigateMock,
  setAgentsMock,
  mockedSuccess,
  mockedError,
  mockedAgentsApi,
} = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  setAgentsMock: vi.fn(),
  mockedSuccess: vi.fn(),
  mockedError: vi.fn(),
  mockedAgentsApi: {
    listAgents: vi.fn(),
    createProject: vi.fn(),
    cloneProject: vi.fn(),
    deleteProject: vi.fn(),
  },
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

vi.mock("../../../stores/agentStore", () => ({
  useAgentStore: () => ({
    selectedAgent: "agent-1",
    agents: [
      {
        id: "agent-1",
        name: "Agent One",
        description: "",
        workspace_dir: "/tmp/agent-1",
        enabled: true,
        is_builtin: false,
        builtin_kind: "",
        builtin_label: "",
        system_protected: false,
        project_count: 0,
        projects: [],
      },
    ],
    setAgents: setAgentsMock,
  }),
}));

vi.mock("../../../api/modules/agents", () => ({
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
    mockedAgentsApi.listAgents.mockResolvedValue({ agents: [] });
    mockedAgentsApi.createProject.mockResolvedValue({
      id: "project-1",
      name: "Project One",
      description: "demo",
      status: "active",
      workspace_dir: "workspace",
      data_dir: ".data",
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
      updated_time: "2026-04-24T00:00:00Z",
    });
  });

  it("creates projects with dot-prefixed default data dir", async () => {
    const user = userEvent.setup();

    render(<ProjectsListPage />);

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
        data_dir: ".data",
        tags: ["demo", "draft"],
      });
    });
  });
});