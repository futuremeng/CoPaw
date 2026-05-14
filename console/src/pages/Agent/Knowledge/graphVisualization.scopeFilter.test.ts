import { describe, expect, it } from "vitest";
import { parseScopeFilterProvenance } from "./graphScopeFilter";

describe("parseScopeFilterProvenance", () => {
  it("returns combined when scope filter is not applied", () => {
    const parsed = parseScopeFilterProvenance({
      engine: "fast_preview",
      scope_filter_applied: false,
    });

    expect(parsed).toEqual({
      applied: false,
      scopeType: "combined",
      scopeId: null,
    });
  });

  it("parses agent scope filter and scope id", () => {
    const parsed = parseScopeFilterProvenance({
      scope_filter_applied: true,
      scope_type: "agent",
      scope_id: "demo-agent",
    });

    expect(parsed).toEqual({
      applied: true,
      scopeType: "agent",
      scopeId: "demo-agent",
    });
  });

  it("falls back to combined for unknown scope type", () => {
    const parsed = parseScopeFilterProvenance({
      scope_filter_applied: true,
      scope_type: "unknown",
      scope_id: "x",
    });

    expect(parsed.scopeType).toBe("combined");
  });
});
