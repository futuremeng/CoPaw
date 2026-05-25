import { describe, expect, it, vi } from "vitest";

import { createClearHistoryResponseParser } from "./clearHistoryResponseParser";

describe("createClearHistoryResponseParser", () => {
  it("marks pending when payload requests clear_history", () => {
    const markPendingClearHistory = vi.fn();
    const clearHistoryWhenCompleted = vi.fn();

    const parse = createClearHistoryResponseParser({
      markPendingClearHistory,
      clearHistoryWhenCompleted,
    });

    parse(
      JSON.stringify({
        object: "response",
        status: "in_progress",
        output: [
          {
            object: "message",
            metadata: {
              clear_history: true,
            },
          },
        ],
      }),
    );

    expect(markPendingClearHistory).toHaveBeenCalledTimes(1);
    expect(clearHistoryWhenCompleted).not.toHaveBeenCalled();
  });

  it("clears history only when response status is completed", () => {
    const markPendingClearHistory = vi.fn();
    const clearHistoryWhenCompleted = vi.fn();

    const parse = createClearHistoryResponseParser({
      markPendingClearHistory,
      clearHistoryWhenCompleted,
    });

    parse(
      JSON.stringify({
        object: "response",
        status: "completed",
        output: [
          {
            object: "message",
            metadata: {
              clear_history: true,
            },
          },
        ],
      }),
    );

    expect(markPendingClearHistory).toHaveBeenCalledTimes(1);
    expect(clearHistoryWhenCompleted).toHaveBeenCalledTimes(1);
  });

  it("returns parsed payload unchanged", () => {
    const parse = createClearHistoryResponseParser({
      markPendingClearHistory: vi.fn(),
      clearHistoryWhenCompleted: vi.fn(),
    });

    const chunk = JSON.stringify({ object: "response", status: "completed", output: [] });
    const payload = parse(chunk);

    expect(payload).toEqual({ object: "response", status: "completed", output: [] });
  });
});
