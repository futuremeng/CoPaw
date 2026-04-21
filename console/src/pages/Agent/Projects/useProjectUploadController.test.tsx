import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentsApi } from "../../../api/modules/agents";
import useProjectUploadController from "./useProjectUploadController";

const { mockedAgentsApi, mockedSuccess, mockedError } = vi.hoisted(() => ({
  mockedAgentsApi: {
    uploadProjectFile: vi.fn(),
  },
  mockedSuccess: vi.fn(),
  mockedError: vi.fn(),
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

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      maybeFallback?: string | Record<string, unknown>,
      maybeOptions?: Record<string, unknown>,
    ) => {
      const fallback = typeof maybeFallback === "string" ? maybeFallback : key;
      const options = typeof maybeFallback === "object" ? maybeFallback : maybeOptions;
      if (options && "count" in options) {
        return fallback.replace("{{count}}", String(options.count));
      }
      return fallback;
    },
  }),
}));

function TestHarness({ loadProjectFiles }: {
  loadProjectFiles: ReturnType<typeof vi.fn>;
}) {
  const controller = useProjectUploadController({
    currentAgent: {
      id: "agent-1",
      name: "Agent One",
      description: "",
      workspace_dir: "/tmp/agent-1",
      enabled: true,
      is_builtin: false,
      builtin_kind: "",
      builtin_label: "",
      system_protected: false,
    },
    selectedProject: {
      id: "proj-1",
      name: "Project One",
      description: "",
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
      updated_time: "",
    },
    resolvedProjectRequestId: "proj-1",
    setResolvedProjectRequestId: vi.fn(),
    loadProjectFiles,
  });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          controller.setPendingUploads([
            new File(["hello"], "hello.txt", { type: "text/plain" }),
          ]);
        }}
      >
        prepare
      </button>
      <button
        type="button"
        onClick={() => {
          void controller.handleUploadFiles();
        }}
      >
        upload
      </button>
    </>
  );
}

describe("useProjectUploadController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedAgentsApi.uploadProjectFile.mockResolvedValue(undefined);
  });

  it("preserves the current workbench selection after uploads refresh the file list", async () => {
    const user = userEvent.setup();
    const loadProjectFiles = vi.fn().mockResolvedValue(undefined);

    render(<TestHarness loadProjectFiles={loadProjectFiles} />);

    await user.click(screen.getByRole("button", { name: "prepare" }));
    await user.click(screen.getByRole("button", { name: "upload" }));

    await waitFor(() => {
      expect(agentsApi.uploadProjectFile).toHaveBeenCalledTimes(1);
      expect(loadProjectFiles).toHaveBeenCalledWith(
        "agent-1",
        expect.objectContaining({ id: "proj-1" }),
        { preserveSelection: true },
      );
    });
  });
});