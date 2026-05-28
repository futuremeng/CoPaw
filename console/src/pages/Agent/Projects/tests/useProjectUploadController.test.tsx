import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useProjectUploadController from "../hooks/useProjectUploadController";

const { mockedAdapterUpload, mockedSuccess, mockedError } = vi.hoisted(() => ({
  mockedAdapterUpload: vi.fn(),
  mockedSuccess: vi.fn(),
  mockedError: vi.fn(),
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
      created_time: "",
      updated_time: "",
    },
    resolvedProjectRequestId: "proj-1",
    setResolvedProjectRequestId: vi.fn(),
    getProjectAdapter: () => ({
      upload: mockedAdapterUpload,
    }) as unknown as Parameters<typeof useProjectUploadController>[0]["getProjectAdapter"] extends (...args: unknown[]) => infer R ? R : never,
    onUploadCompleted,
  });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          controller.setPendingUploads([
            {
              file: new File(["hello"], "hello.txt", { type: "text/plain" }),
              relativePath: "hello.txt",
            },
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
    mockedAdapterUpload.mockResolvedValue(undefined);
  });

  it("refreshes the project workbench after uploads complete", async () => {
    const user = userEvent.setup();
    const onUploadCompleted = vi.fn().mockResolvedValue(undefined);

    render(<TestHarness onUploadCompleted={onUploadCompleted} />);

    await user.click(screen.getByRole("button", { name: "prepare" }));
    await user.click(screen.getByRole("button", { name: "upload" }));

    await waitFor(() => {
      expect(mockedAdapterUpload).toHaveBeenCalledTimes(1);
      expect(mockedAdapterUpload).toHaveBeenCalledWith(
        expect.any(File),
        "",
        "hello.txt",
      );
      expect(onUploadCompleted).toHaveBeenCalledWith(
        "agent-1",
        expect.objectContaining({ id: "proj-1" }),
      );
    });
  });
});