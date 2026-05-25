import {
  messageRequestsHistoryClear,
  payloadCompletesResponse,
  payloadRequestsHistoryClear,
} from "./clearHistoryParser";

describe("clearHistoryParser", () => {
  test("messageRequestsHistoryClear supports top-level metadata flag", () => {
    expect(
      messageRequestsHistoryClear({
        metadata: { clear_history: true },
      }),
    ).toBe(true);
  });

  test("messageRequestsHistoryClear supports nested metadata flag", () => {
    expect(
      messageRequestsHistoryClear({
        metadata: {
          metadata: {
            clear_history: true,
          },
        },
      }),
    ).toBe(true);
  });

  test("payloadRequestsHistoryClear detects clear flag from response output", () => {
    expect(
      payloadRequestsHistoryClear({
        object: "response",
        output: [
          {
            object: "message",
            metadata: { clear_history: true },
          },
        ],
      }),
    ).toBe(true);
  });

  test("payloadRequestsHistoryClear returns false for unrelated payload", () => {
    expect(
      payloadRequestsHistoryClear({
        object: "response",
        output: [
          {
            object: "message",
            metadata: { clear_history: false },
          },
        ],
      }),
    ).toBe(false);
  });

  test("payloadCompletesResponse only accepts completed response", () => {
    expect(payloadCompletesResponse({ object: "response", status: "completed" })).toBe(true);
    expect(payloadCompletesResponse({ object: "response", status: "in_progress" })).toBe(false);
    expect(payloadCompletesResponse({ object: "message", status: "completed" })).toBe(false);
  });
});
