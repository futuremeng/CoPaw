import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useProjectRealtimeController from "./hooks/useProjectRealtimeController";

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

  readonly url: string;

  constructor(url: string) {
    this.url = url;
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

  it("does not create a websocket when project realtime is disabled", async () => {
    const onFileTreeInvalidated = vi.fn();
    const onPipelineInvalidated = vi.fn();

    render(
      <TestHarness
        onFileTreeInvalidated={onFileTreeInvalidated}
        onPipelineInvalidated={onPipelineInvalidated}
      />,
    );

    await waitFor(() => {
      expect(MockWebSocket.instances).toHaveLength(0);
    });
    expect(onFileTreeInvalidated).not.toHaveBeenCalled();
    expect(onPipelineInvalidated).not.toHaveBeenCalled();
  });
});