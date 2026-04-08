import { AgentScopeRuntimeRunStatus } from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/types.js";

const AUTO_CONTINUE_MIN_LENGTH = 120;

export function hasUnclosedMarkdownCodeFence(text: string): boolean {
  const count = (text.match(/```/g) || []).length;
  return count % 2 === 1;
}

export function endsWithLikelyInterruptedToken(text: string): boolean {
  const trimmed = text.trimEnd();
  if (!trimmed) {
    return false;
  }
  const interruptedSuffixes = [
    ",",
    ":",
    ";",
    "，",
    "、",
    "：",
    "；",
    "-",
    "(",
    "[",
    "{",
    "（",
  ];
  return interruptedSuffixes.some((suffix) => trimmed.endsWith(suffix));
}

export function endsWithOnlyThinking(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  // Remove all complete <think>...</think> blocks; what's left is the visible response
  const withoutThinking = trimmed
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  // Nothing left → response is purely a thinking block with no visible output
  if (withoutThinking === "") {
    return true;
  }
  // Unclosed <think> that consumed everything (model stopped mid-think, no visible output)
  if (/^<think>/i.test(withoutThinking) && !/<\/think>/i.test(withoutThinking)) {
    return true;
  }
  return false;
}

export function endsWithLikelyInterruptedIntent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }

  const lines = trimmed
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const lastLine = (lines[lines.length - 1] || trimmed)
    .replace(/^[-*#>\d.\s]+/, "")
    .replace(/\*\*/g, "")
    .trim();

  if (!lastLine) {
    return false;
  }

  const actionLeadPattern =
    /(?:让我|我来|我现在|现在让我|接下来(?:我)?|下面(?:我)?|下一步(?:我)?|随后(?:我)?|然后(?:我)?|我将|我会).{0,80}(?:创建|生成|继续|制作|编写|整理|构建|补充|输出|绘制|分析|实现|添加|提供|完成)/;
  const planLeadPattern =
    /(?:推荐下一步|下一步|后续步骤|接下来|下面|现在)/;

  return (
    actionLeadPattern.test(lastLine)
    || (planLeadPattern.test(lastLine) && /[:：]$/.test(lastLine))
  );
}

export function shouldAutoContinueResponse(params: {
  status?: string;
  sawFinalChunk: boolean;
  assistantText: string;
}): boolean {
  const { status, sawFinalChunk, assistantText } = params;
  const trimmedText = assistantText.trim();
  if (!trimmedText) {
    return false;
  }

  if (!sawFinalChunk) {
    return true;
  }

  if (status !== AgentScopeRuntimeRunStatus.Completed) {
    return false;
  }

  if (hasUnclosedMarkdownCodeFence(trimmedText)) {
    return true;
  }

  // Thinking-only: model produced a reasoning block but no visible output after it
  if (endsWithOnlyThinking(trimmedText)) {
    return true;
  }

  if (trimmedText.length < AUTO_CONTINUE_MIN_LENGTH) {
    return false;
  }

  return (
    endsWithLikelyInterruptedToken(trimmedText)
    || endsWithLikelyInterruptedIntent(trimmedText)
  );
}
