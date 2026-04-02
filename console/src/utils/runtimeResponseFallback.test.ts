import { describe, expect, it } from "vitest";
import {
  buildThinkingOnlyFallbackText,
  extractRenderableAssistantText,
  materializeThinkingOnlyFallback,
} from "./runtimeResponseFallback";

describe("runtimeResponseFallback", () => {
  it("keeps normal text output unchanged", () => {
    const response = {
      output: [
        {
          role: "assistant",
          content: [{ type: "text", text: "final answer" }],
        },
      ],
    };

    expect(extractRenderableAssistantText(response)).toBe("final answer");
    expect(materializeThinkingOnlyFallback(response)).toEqual(response);
  });

  it("materializes a styled fallback when only thinking exists", () => {
    const response = {
      output: [
        {
          role: "assistant",
          content: [{ type: "thinking", thinking: "step 1\nstep 2" }],
        },
      ],
    };

    const normalized = materializeThinkingOnlyFallback(response);
    const content = normalized.output?.[0]?.content as Array<Record<string, unknown>>;

    expect(content).toHaveLength(2);
    expect(content[1]).toMatchObject({
      type: "text",
      copaw_fallback_kind: "thinking_only",
      copaw_synthetic: true,
    });
    expect(String(content[1]?.text || "")).toContain("step 1");
    expect(extractRenderableAssistantText(response)).toContain("step 2");
  });

  it("does not duplicate an existing fallback block", () => {
    const fallbackText = buildThinkingOnlyFallbackText("draft reasoning");
    const response = {
      output: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "draft reasoning" },
            {
              type: "text",
              text: fallbackText,
              copaw_fallback_kind: "thinking_only",
              copaw_synthetic: true,
            },
          ],
        },
      ],
    };

    const normalized = materializeThinkingOnlyFallback(response);
    expect(normalized).toEqual(response);
  });
});