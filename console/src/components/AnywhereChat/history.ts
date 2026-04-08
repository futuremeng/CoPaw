import type { IAgentScopeRuntimeWebUISession } from "@agentscope-ai/chat";
import { chatApi } from "../../api/modules/chat";
import sessionApi from "../../pages/Chat/sessionApi";
import type { ChatHistory, ChatSpec, Message } from "../../api/types";

const CHAT_HISTORY_PAGE_SIZE = 100;
const RUNNING_EMPTY_HISTORY_RETRY_COUNT = 20;
const RUNNING_EMPTY_HISTORY_RETRY_DELAY_MS = 500;
const INTERNAL_AUTO_CONTINUE_PROMPT =
  "请继续上一条回答，不要重复已输出内容，从中断处接着写，直到完整结束。";

type StableMessageIdentity = {
  id?: unknown;
  message_id?: unknown;
};

function extractTextFromChatContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => extractTextFromChatContent(item))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text.trim();
    }
    if (record.content !== undefined) {
      return extractTextFromChatContent(record.content);
    }
  }

  return "";
}

function normalizeMessageRole(role: unknown): string {
  return typeof role === "string" ? role.trim().toLowerCase() : "";
}

export function isUserRole(role: unknown): boolean {
  const normalized = normalizeMessageRole(role);
  return normalized === "user" || normalized === "human";
}

function isInternalAutoContinueUserMessage(message: Message): boolean {
  if (!isUserRole(message?.role)) {
    return false;
  }
  return extractTextFromChatContent(message?.content) === INTERNAL_AUTO_CONTINUE_PROMPT;
}

function filterInternalAutoContinueUserMessages(messages: Message[]): Message[] {
  return messages.filter((message) => !isInternalAutoContinueUserMessage(message));
}

function collectSessionLineageIds(chats: ChatSpec[], sessionId: string): string[] {
  const chatById = new Map(chats.map((chat) => [chat.id, chat]));
  const lineage: string[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = sessionId;

  while (currentId && chatById.has(currentId) && !visited.has(currentId)) {
    visited.add(currentId);
    lineage.push(currentId);
    currentId = chatById.get(currentId)?.session_id || undefined;
  }

  return lineage.reverse();
}

function getStableMessageId(message: StableMessageIdentity): string | null {
  const id = message.id;
  if (typeof id === "string" && id.trim()) {
    return id.trim();
  }

  const messageId = message.message_id;
  if (typeof messageId === "string" && messageId.trim()) {
    return messageId.trim();
  }

  return null;
}

function mergeMessagesByStableId<T extends object>(messages: T[]): T[] {
  const merged: T[] = [];
  const indexById = new Map<string, number>();

  for (const message of messages) {
    const stableId = getStableMessageId(message as StableMessageIdentity);
    if (!stableId) {
      merged.push(message);
      continue;
    }

    const existingIndex = indexById.get(stableId);
    if (existingIndex === undefined) {
      indexById.set(stableId, merged.length);
      merged.push(message);
      continue;
    }

    merged[existingIndex] = message;
  }

  return merged;
}

export function getHistoryMessages(history: ChatHistory | null | undefined): Message[] {
  return Array.isArray(history?.messages) ? history.messages : [];
}

export function getLastVisibleUserState(history: ChatHistory | null | undefined): {
  stableId: string;
  text: string;
} | null {
  const messages = getHistoryMessages(history);
  const tailMessage = messages.length > 0 ? messages[messages.length - 1] : undefined;
  if (!isUserRole(tailMessage?.role)) {
    return null;
  }

  const text = extractTextFromChatContent(tailMessage?.content);
  if (!text) {
    return null;
  }

  return {
    stableId: getStableMessageId((tailMessage || {}) as StableMessageIdentity) || text,
    text,
  };
}

export function removeLastVisibleUserMessage(
  history: ChatHistory | null | undefined,
): ChatHistory | null | undefined {
  if (!history) {
    return history;
  }

  const messages = getHistoryMessages(history);
  if (messages.length === 0) {
    return history;
  }

  let targetIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isUserRole(messages[index]?.role)) {
      targetIndex = index;
      break;
    }
  }

  if (targetIndex < 0) {
    return history;
  }

  const nextMessages = messages.filter((_, index) => index !== targetIndex);
  return {
    ...history,
    messages: nextMessages,
    total: nextMessages.length,
    has_more: false,
  };
}

async function loadPagedChatHistory(chatId: string): Promise<ChatHistory> {
  const fetchAllPages = async (): Promise<ChatHistory> => {
    const allMessages: Message[] = [];
    let offset = 0;
    let latestStatus: "idle" | "running" = "idle";
    let leafHistory: ChatHistory | null = null;

    while (true) {
      const history = await chatApi.getChat(chatId, {
        offset,
        limit: CHAT_HISTORY_PAGE_SIZE,
      });
      leafHistory = history;
      latestStatus = history.status ?? latestStatus;

      const pageMessages = filterInternalAutoContinueUserMessages(
        Array.isArray(history.messages) ? history.messages : [],
      );
      allMessages.push(...pageMessages);

      const hasMoreByFlag = history.has_more === true;
      const hasMoreByTotal =
        typeof history.total === "number"
          ? offset + pageMessages.length < history.total
          : false;
      const hasMore = hasMoreByFlag || hasMoreByTotal;

      if (!hasMore || pageMessages.length === 0) {
        break;
      }

      offset += pageMessages.length;
    }

    return {
      ...(leafHistory || { messages: [] }),
      messages: allMessages,
      status: latestStatus,
      total: allMessages.length,
      has_more: false,
    };
  };

  let history = await fetchAllPages();

  for (
    let i = 0;
    i < RUNNING_EMPTY_HISTORY_RETRY_COUNT
      && history.status === "running"
      && history.messages.length === 0;
    i += 1
  ) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, RUNNING_EMPTY_HISTORY_RETRY_DELAY_MS);
    });
    history = await fetchAllPages();
  }

  return history;
}

export async function loadMergedRawChatHistory(sessionId: string): Promise<ChatHistory | null> {
  const chats = await chatApi.listChats({ user_id: "default", channel: "console" });
  const lineageIds = collectSessionLineageIds(chats, sessionId);
  const histories: ChatHistory[] = [];

  for (const lineageId of lineageIds.length > 0 ? lineageIds : [sessionId]) {
    try {
      const history = await loadPagedChatHistory(lineageId);
      histories.push(history);
    } catch {
      // Skip missing segments; continue merging the remaining chain.
    }
  }

  if (histories.length === 0) {
    return null;
  }

  const mergedMessages = mergeMessagesByStableId(
    histories.flatMap((history) => history.messages || []),
  );
  const lastHistory = histories[histories.length - 1];

  return {
    ...lastHistory,
    messages: mergedMessages,
    total: mergedMessages.length,
    has_more: false,
  };
}

export async function loadMergedRuntimeSession(
  sessionId: string,
): Promise<IAgentScopeRuntimeWebUISession | null> {
  const chats = await chatApi.listChats({ user_id: "default", channel: "console" });
  const lineageIds = collectSessionLineageIds(chats, sessionId);
  const sessions: IAgentScopeRuntimeWebUISession[] = [];

  for (const lineageId of lineageIds.length > 0 ? lineageIds : [sessionId]) {
    try {
      const session = await sessionApi.getSession(lineageId);
      sessions.push(session);
    } catch {
      // Skip missing segments; continue merging the remaining chain.
    }
  }

  if (sessions.length === 0) {
    return null;
  }

  const mergedMessages = mergeMessagesByStableId(
    sessions.flatMap((session) =>
      Array.isArray(session.messages)
        ? (JSON.parse(
            JSON.stringify(session.messages),
          ) as IAgentScopeRuntimeWebUISession["messages"])
        : [],
    ),
  );
  const leafSession = sessions[sessions.length - 1] as IAgentScopeRuntimeWebUISession & {
    realId?: string;
    meta?: Record<string, unknown>;
  };

  return {
    ...leafSession,
    id: leafSession.id || sessionId,
    messages: mergedMessages,
  };
}