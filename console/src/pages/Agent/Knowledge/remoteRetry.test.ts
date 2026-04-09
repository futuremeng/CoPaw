import { describe, expect, it } from "vitest";
import { summarizeRemoteRetryResults } from "./metrics";

describe("remoteRetry summary", () => {
  it("summarizes full success correctly", () => {
    const summary = summarizeRemoteRetryResults(
      [
        { id: "s1", name: "Source A" },
        { id: "s2", name: "Source B" },
      ],
      [
        { status: "fulfilled", value: {} },
        { status: "fulfilled", value: {} },
      ],
    );

    expect(summary).toEqual({
      successCount: 2,
      failedCount: 0,
      failedNames: [],
    });
  });

  it("summarizes partial failure with failed source names", () => {
    const summary = summarizeRemoteRetryResults(
      [
        { id: "s1", name: "Source A" },
        { id: "s2", name: "Source B" },
        { id: "s3", name: "Source C" },
      ],
      [
        { status: "fulfilled", value: {} },
        { status: "rejected", reason: new Error("x") },
        { status: "rejected", reason: new Error("y") },
      ],
    );

    expect(summary.successCount).toBe(1);
    expect(summary.failedCount).toBe(2);
    expect(summary.failedNames).toEqual(["Source B", "Source C"]);
  });
});
