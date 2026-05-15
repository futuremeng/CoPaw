import { describe, expect, it } from "vitest";
import { shouldStopSearchAnchorRetry } from "./searchAnchorRetry";

describe("shouldStopSearchAnchorRetry", () => {
  it("stops immediately when anchor was found", () => {
    expect(
      shouldStopSearchAnchorRetry({
        done: true,
        attempts: 1,
        maxAttempts: 10,
      }),
    ).toBe(true);
  });

  it("continues when not done and attempts below max", () => {
    expect(
      shouldStopSearchAnchorRetry({
        done: false,
        attempts: 3,
        maxAttempts: 10,
      }),
    ).toBe(false);
  });

  it("stops when attempts reach max", () => {
    expect(
      shouldStopSearchAnchorRetry({
        done: false,
        attempts: 10,
        maxAttempts: 10,
      }),
    ).toBe(true);
  });
});
