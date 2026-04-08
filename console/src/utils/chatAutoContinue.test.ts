import { describe, expect, it } from "vitest";
import { AgentScopeRuntimeRunStatus } from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/types.js";
import {
  endsWithIncompleteVisibleOutput,
  endsWithLikelyInterruptedIntent,
  endsWithOnlyThinking,
  shouldAutoContinueResponse,
} from "./chatAutoContinue";

describe("chatAutoContinue", () => {
  it("detects interrupted action-intent endings like the dataset example", () => {
    const text = [
      "数据集已成功创建并验证，ID:23。现在让我创建一个完整的实施状态文档来记录这个成果，然后继续后续步骤如创建 Gold Layer 数据集和可视化图表。",
      "",
      "好的！✅ Bronze Layer Dataset 已创建并验证成功！",
      "",
      "## 推荐下一步：创建完整的图表和仪表板",
      "",
      "既然数据集已验证可用，让我现在创建几个关键的可视化图表来完善机械主题分析",
    ].join("\n");

    expect(endsWithLikelyInterruptedIntent(text)).toBe(true);
    expect(
      shouldAutoContinueResponse({
        status: AgentScopeRuntimeRunStatus.Completed,
        sawFinalChunk: true,
        assistantText: text,
      }),
    ).toBe(true);
  });

  it("does not continue a clearly completed short answer", () => {
    expect(
      shouldAutoContinueResponse({
        status: AgentScopeRuntimeRunStatus.Completed,
        sawFinalChunk: true,
        assistantText: "处理完成。所有图表都已创建并保存。",
      }),
    ).toBe(false);
  });

  describe("endsWithOnlyThinking", () => {
    it("detects a complete <think> block with no response after it", () => {
      const text = "<think>\n分析一下用户的问题，需要创建一个可视化图表。\n好的，我来整理思路。\n</think>";
      expect(endsWithOnlyThinking(text)).toBe(true);
      expect(
        shouldAutoContinueResponse({
          status: AgentScopeRuntimeRunStatus.Completed,
          sawFinalChunk: true,
          assistantText: text,
        }),
      ).toBe(true);
    });

    it("detects an unclosed <think> block (model stopped mid-think)", () => {
      const text = "<think>\n这道题需要分步骤计算，首先...";
      expect(endsWithOnlyThinking(text)).toBe(true);
    });

    it("does not trigger when visible response follows thinking block", () => {
      const text = "<think>\n先想一想。\n</think>\n\n好的，答案是 42。";
      expect(endsWithOnlyThinking(text)).toBe(false);
    });

    it("does not trigger on a normal response with no thinking block", () => {
      expect(endsWithOnlyThinking("这是一个正常的回复。")).toBe(false);
    });
  });

  describe("endsWithIncompleteVisibleOutput", () => {
    it("detects thinking block + short mid-sentence visible text", () => {
      const text = "<think>\n需要分析一下这个情况。\n</think>\n\n好的！我理解了，您要求严格按照 MCP";
      expect(endsWithIncompleteVisibleOutput(text)).toBe(true);
      expect(
        shouldAutoContinueResponse({
          status: AgentScopeRuntimeRunStatus.Completed,
          sawFinalChunk: true,
          assistantText: text,
        }),
      ).toBe(true);
    });

    it("detects thinking block + very short cutoff like '让我严格'", () => {
      const text = "<think>\n长思考过程。\n</think>\n\n让我严格";
      expect(endsWithIncompleteVisibleOutput(text)).toBe(true);
    });

    it("does not trigger when visible text ends with sentence punctuation", () => {
      const text = "<think>\n思考中。\n</think>\n\n好的！";
      expect(endsWithIncompleteVisibleOutput(text)).toBe(false);
    });

    it("does not trigger for response with no thinking block", () => {
      const text = "好的，我明白了，按照规范操作";
      expect(endsWithIncompleteVisibleOutput(text)).toBe(false);
    });

    it("does not trigger when visible text is long enough even without thinking", () => {
      // No thinking block → rule should not apply
      expect(endsWithIncompleteVisibleOutput("没有thinking块，但文字较短")).toBe(false);
    });
  });
});
