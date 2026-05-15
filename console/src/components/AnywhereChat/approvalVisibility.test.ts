import { describe, expect, it } from "vitest";
import { resolveApprovalVisibility } from "./approvalVisibility";

describe("resolveApprovalVisibility", () => {
  it("sorts approvals by createdAt desc", () => {
    const result = resolveApprovalVisibility(
      [
        { requestId: "a", createdAt: 100 },
        { requestId: "b", createdAt: 300 },
        { requestId: "c", createdAt: 200 },
      ],
      3,
      true,
    );

    expect(result.sorted.map((item) => item.requestId)).toEqual(["b", "c", "a"]);
  });

  it("limits visible approvals when showAll=false", () => {
    const result = resolveApprovalVisibility(
      [
        { requestId: "a", createdAt: 100 },
        { requestId: "b", createdAt: 300 },
        { requestId: "c", createdAt: 200 },
        { requestId: "d", createdAt: 150 },
      ],
      2,
      false,
    );

    expect(result.visible.map((item) => item.requestId)).toEqual(["b", "c"]);
    expect(result.hiddenCount).toBe(2);
  });

  it("returns all approvals when showAll=true", () => {
    const result = resolveApprovalVisibility(
      [
        { requestId: "a", createdAt: 100 },
        { requestId: "b", createdAt: 300 },
      ],
      1,
      true,
    );

    expect(result.visible.map((item) => item.requestId)).toEqual(["b", "a"]);
    expect(result.hiddenCount).toBe(0);
  });

  it("handles zero limit safely", () => {
    const result = resolveApprovalVisibility(
      [
        { requestId: "a", createdAt: 100 },
        { requestId: "b", createdAt: 300 },
      ],
      0,
      false,
    );

    expect(result.visible).toEqual([]);
    expect(result.hiddenCount).toBe(2);
  });
});
