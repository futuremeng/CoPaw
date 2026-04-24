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

function TestHarness({ onUploadCompleted }: {
  onUploadCompleted: ReturnType<typeof vi.fn>;
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
    onUploadCompleted,
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

  it("refreshes the project workbench after uploads complete", async () => {
    const user = userEvent.setup();
    const onUploadCompleted = vi.fn().mockResolvedValue(undefined);

    render(<TestHarness onUploadCompleted={onUploadCompleted} />);

    await user.click(screen.getByRole("button", { name: "prepare" }));
    await user.click(screen.getByRole("button", { name: "upload" }));

    await waitFor(() => {
      expect(agentsApi.uploadProjectFile).toHaveBeenCalledTimes(1);
      expect(agentsApi.uploadProjectFile).toHaveBeenCalledWith(
        "agent-1",
        "proj-1",
        expect.any(File),
        "",
      );
      expect(onUploadCompleted).toHaveBeenCalledWith(
        "agent-1",
        expect.objectContaining({ id: "proj-1" }),
      );
    });
  });
});