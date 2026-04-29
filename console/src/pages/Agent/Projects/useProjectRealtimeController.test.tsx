import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useProjectRealtimeController from "./useProjectRealtimeController";

const { mockedGetApiToken, mockedGetApiUrl } = vi.hoisted(() => ({
  mockedGetApiToken: vi.fn(),
  mockedGetApiUrl: vi.fn(),
}));

vi.mock("../../../api", () => ({
  getApiToken: mockedGetApiToken,
  getApiUrl: mockedGetApiUrl,
}));

class MockWebSocket {
  static instances: MockWebSocket[] = [];

  static CONNECTING = 0;

  static OPEN = 1;

  static CLOSING = 2;

  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;

  onopen: (() => void) | null = null;

  onmessage: ((event: MessageEvent<string>) => void) | null = null;

  onclose: (() => void) | null = null;

  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  emitOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  emitMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent<string>);
  }
}

function TestHarness(props: {
  onFileTreeInvalidated?: ReturnType<typeof vi.fn>;
  onPipelineInvalidated?: ReturnType<typeof vi.fn>;
}) {
  useProjectRealtimeController({
    agentId: "agent-1",
    projectId: "project-1",
    onFileTreeInvalidated: props.onFileTreeInvalidated,
    onPipelineInvalidated: props.onPipelineInvalidated,
  });
  return null;
}

describe("useProjectRealtimeController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockWebSocket.instances = [];
    mockedGetApiToken.mockReturnValue("token-1");
    mockedGetApiUrl.mockImplementation((path: string) => `http://localhost:8000${path}`);
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
  });

  it("forwards changed directory hints and truncation metadata to invalidation callbacks", async () => {
    const onFileTreeInvalidated = vi.fn();
    const onPipelineInvalidated = vi.fn();

    render(
      <TestHarness
        onFileTreeInvalidated={onFileTreeInvalidated}
        onPipelineInvalidated={onPipelineInvalidated}
      />,
    );

    expect(MockWebSocket.instances).toHaveLength(1);
    const socket = MockWebSocket.instances[0];
    act(() => {
      socket.emitOpen();
      socket.emitMessage({
        type: "snapshot",
        event_id: 1,
        project_id: "project-1",
        reason: "initial_sync",
        changed_paths: [],
        changed_dirs: [],
        changed_paths_truncated: false,
        changed_count: 0,
        snapshot: {
          project_id: "project-1",
          generated_at: "2026-04-29T00:00:00Z",
          file_tree: {
            fingerprint: "file-1",
            latest_mtime_ns: 1,
            summary: {
              total_files: 1,
              builtin_files: 0,
              visible_files: 1,
              original_files: 1,
              intermediate_files: 0,
              artifact_files: 0,
              agent_files: 0,
              skill_files: 0,
              flow_files: 0,
              case_files: 0,
              markdown_files: 1,
              text_files: 1,
              script_files: 0,
              other_type_files: 0,
              recently_updated_files: 1,
            },
          },
          pipeline: {
            fingerprint: "pipeline-1",
            latest_mtime_ns: 1,
            run_count: 0,
          },
        },
      });
    });

    expect(onFileTreeInvalidated).not.toHaveBeenCalled();
    expect(onPipelineInvalidated).not.toHaveBeenCalled();

    act(() => {
      socket.emitMessage({
        type: "snapshot",
        event_id: 2,
        project_id: "project-1",
        reason: "change",
        changed_paths: ["original/a.md", "original/b.md"],
        changed_dirs: ["original"],
        changed_paths_truncated: true,
        changed_count: 4,
        snapshot: {
          project_id: "project-1",
          generated_at: "2026-04-29T00:00:01Z",
          file_tree: {
            fingerprint: "file-2",
            latest_mtime_ns: 2,
            summary: {
              total_files: 4,
              builtin_files: 0,
              visible_files: 4,
              original_files: 4,
              intermediate_files: 0,
              artifact_files: 0,
              agent_files: 0,
              skill_files: 0,
              flow_files: 0,
              case_files: 0,
              markdown_files: 4,
              text_files: 4,
              script_files: 0,
              other_type_files: 0,
              recently_updated_files: 4,
            },
          },
          pipeline: {
            fingerprint: "pipeline-2",
            latest_mtime_ns: 2,
            run_count: 1,
          },
        },
      });
    });

    await waitFor(() => {
      expect(onFileTreeInvalidated).toHaveBeenCalledWith({
        changedPaths: ["original/a.md", "original/b.md"],
        changedDirs: ["original"],
        changedPathsTruncated: true,
        reason: "change",
        fileSummary: expect.objectContaining({
          total_files: 4,
          original_files: 4,
        }),
      });
      expect(onPipelineInvalidated).toHaveBeenCalledWith({
        changedPaths: ["original/a.md", "original/b.md"],
        changedDirs: ["original"],
        changedPathsTruncated: true,
        reason: "change",
      });
    });
  });
});