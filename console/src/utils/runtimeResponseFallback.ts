import i18n from "../i18n";

type RuntimeContentPart = {
  type?: string;
  text?: string;
  refusal?: string;
  thinking?: string;
  copaw_fallback_kind?: string;
  copaw_synthetic?: boolean;
  [key: string]: unknown;
};

type RuntimeOutputMessageLike = {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
};

type RuntimeResponseLike = {
  output?: RuntimeOutputMessageLike[];
  [key: string]: unknown;
};

const THINKING_ONLY_FALLBACK_KIND = "thinking_only";

function isContentPartArray(content: unknown): content is RuntimeContentPart[] {
  return Array.isArray(content);
}

function isVisibleTextPart(part: RuntimeContentPart): boolean {
  return (
    (part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0)
    || (part.type === "refusal" && typeof part.refusal === "string" && part.refusal.trim().length > 0)
  );
}

function collectThinkingParts(content: RuntimeContentPart[]): string[] {
  return content
    .filter(
      (part) =>
        part.type === "thinking"
        && typeof part.thinking === "string"
        && part.thinking.trim().length > 0,
    )
    .map((part) => part.thinking!.trim());
}

function hasFallbackPart(content: RuntimeContentPart[]): boolean {
  return content.some(
    (part) =>
      part.copaw_fallback_kind === THINKING_ONLY_FALLBACK_KIND
      || (part.type === "text"
        && part.copaw_synthetic === true
        && typeof part.text === "string"
        && part.text.includes("thinking")),
  );
}

export function buildThinkingOnlyFallbackText(thinking: string): string {
  const merged = thinking.trim();
  if (!merged) {
    return "";
  }

  const title = i18n.t("chat.thinkingFallbackTitle", "Thinking fallback view");
  const description = i18n.t(
    "chat.thinkingFallbackDescription",
    "This turn ended before the model produced a final answer. The reasoning content below is shown as a fallback draft for reference.",
  );
  const label = i18n.t("chat.thinkingFallbackLabel", "Draft reasoning");

  return [
    `### ${title}`,
    "",
    `${description}`,
    "",
    `**${label}**`,
    "",
    "```thinking-fallback",
    merged,
    "```",
  ].join("\n").trim();
}

function materializeMessageContent(content: unknown): unknown {
  if (!isContentPartArray(content) || content.length === 0) {
    return content;
  }

  if (hasFallbackPart(content) || content.some(isVisibleTextPart)) {
    return content;
  }

  const thinkingText = collectThinkingParts(content).join("\n\n").trim();
  if (!thinkingText) {
    return content;
  }

  return [
    ...content,
    {
      type: "text",
      text: buildThinkingOnlyFallbackText(thinkingText),
      copaw_fallback_kind: THINKING_ONLY_FALLBACK_KIND,
      copaw_synthetic: true,
    },
  ];
}

export function materializeThinkingOnlyFallback<T extends RuntimeResponseLike>(response: T): T {
  if (!response || !Array.isArray(response.output) || response.output.length === 0) {
    return response;
  }

  let changed = false;
  const nextOutput = response.output.map((message) => {
    const nextContent = materializeMessageContent(message.content);
    if (nextContent === message.content) {
      return message;
    }
    changed = true;
    return {
      ...message,
      content: nextContent,
    };
  });

  if (!changed) {
    return response;
  }

  return {
    ...response,
    output: nextOutput,
  } as T;
}

export function extractRenderableAssistantText(response: RuntimeResponseLike | null): string {
  if (!response || !Array.isArray(response.output)) {
    return "";
  }

  const normalized = materializeThinkingOnlyFallback(response);
  const output = normalized.output || [];

  return output
    .flatMap((message) => {
      if (!isContentPartArray(message.content)) {
        return [];
      }
      return message.content.flatMap((part) => {
        if (part.type === "text" && typeof part.text === "string") {
          return [part.text];
        }
        if (part.type === "refusal" && typeof part.refusal === "string") {
          return [part.refusal];
        }
        return [];
      });
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}