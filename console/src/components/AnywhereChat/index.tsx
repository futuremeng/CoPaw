import {
  AgentScopeRuntimeWebUI,
  WelcomePrompts,
  Stream,
  type IAgentScopeRuntimeWebUIOptions,
  type IAgentScopeRuntimeWebUIRef,
} from "@agentscope-ai/chat";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Empty, Modal, Popover, Spin, Tooltip, message } from "antd";
import { CopyOutlined, DashboardOutlined, DeleteOutlined, FileMarkdownOutlined } from "@ant-design/icons";
import { SparkAttachmentLine, SparkHistoryLine, SparkNewChatFill } from "@agentscope-ai/icons";
import { useTranslation } from "react-i18next";
import defaultConfig, { getDefaultConfig } from "../../pages/Chat/OptionsPanel/defaultConfig";
import ModelSelector from "../../pages/Chat/ModelSelector";
import sessionApi from "../../pages/Chat/sessionApi";
import { chatApi } from "../../api/modules/chat";
import { providerApi } from "../../api/modules/provider";
import { agentApi } from "../../api/modules/agent";
import { buildAuthHeaders } from "../../api/authHeaders";
import { getApiUrl } from "../../api/config";
import { useTheme } from "../../contexts/ThemeContext";
import { useAgentStore } from "../../stores/agentStore";
import AgentScopeRuntimeResponseBuilder from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/Response/Builder.js";
import { AgentScopeRuntimeRunStatus } from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/types.js";
import type {
  ActiveModelsInfo,
  AgentsRunningConfig,
  ChatSpec,
  ChatHistory,
  Message,
  ChatRuntimeStatus,
  ProviderInfo,
} from "../../api/types";
import {
  deriveRuntimeStatusSnapshot,
  formatTokenCount,
  mergeRuntimeStatusSnapshot,
} from "../../utils/chatRuntimeStatus";
import { IconButton } from "@agentscope-ai/design";
import {
  copyText,
  extractCopyableText,
  toDisplayUrl,
} from "../../pages/Chat/utils";
import {
  extractRenderableAssistantText,
  materializeThinkingOnlyFallback,
} from "../../utils/runtimeResponseFallback";
import {
  getLastVisibleUserState,
  loadMergedRawChatHistory,
  loadMergedRuntimeSession,
  removeLastVisibleUserMessage,
} from "./history";
import styles from "./index.module.less";

type SessionContext = {
  session_id?: string;
  user_id?: string;
  channel?: string;
};

type ChatInputItem = {
  session?: SessionContext;
  content?: unknown[];
  role?: string;
  [key: string]: unknown;
};

type SenderConfigShape = {
  sender?: Record<string, unknown>;
};

type WelcomePrompt = {
  value: string;
};

type WelcomeConfigShape = {
  greeting?: string;
  description?: string;
  prompts?: WelcomePrompt[];
};

const RUNTIME_STATUS_RETRY_DELAY_MS = 1500;
const RUNTIME_STATUS_MAX_RETRIES = 2;

interface AnywhereChatProps {
  sessionId: string;
  hostClassName?: string;
  inputPlaceholder?: string;
  welcomeGreeting?: string;
  welcomeDescription?: string;
  welcomePrompts?: string[];
  welcomePromptsWhenEmpty?: string[];
  welcomePromptClickBehavior?: "submit" | "append";
  onNewChat?: () => void;
  onSelectHistoryChat?: (chatId: string) => void;
  historyMenuActionLabel?: string;
  onHistoryMenuAction?: () => void;
  onAssistantTurnCompleted?: (payload: {
    text: string;
    response: Record<string, unknown> | null;
  }) => void;
  autoAttachRequest?: {
    id: string;
    mode?: "submit" | "draft";
    fileName?: string;
    content?: string;
    mimeType?: string;
    files?: Array<{
      fileName: string;
      content: string;
      mimeType?: string;
    }>;
    note?: string;
  } | null;
  onAutoAttachHandled?: (payload: {
    id: string;
    ok: boolean;
    error?: string;
  }) => void;
}

type StreamResponseData = {
  status?: string;
  output?: Array<{
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
      [key: string]: unknown;
    }>;
  }>;
};

type CopyableResponse = {
  output?: Array<{
    role?: string;
    content?:
      | string
      | Array<{
          type?: string;
          text?: string;
          refusal?: string;
          [key: string]: unknown;
        }>;
  }>;
};

type AttachmentTriggerProps = {
  disabled?: boolean;
};

type CommandSuggestion = {
  command: string;
  value: string;
  description: string;
};

const CHAT_ATTACHMENT_MAX_MB = 10;

function renderSuggestionLabel(command: string, description: string) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{command}</span>
      <span style={{ opacity: 0.75 }}>{description}</span>
    </div>
  );
}

function extractUserTextFromInput(input?: ChatInputItem): string {
  if (!input || !Array.isArray(input.content)) return "";

  return input.content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const typed = part as { type?: string; text?: string };
      if (typed.type === "text" && typeof typed.text === "string") {
        return [typed.text.trim()];
      }
      return [];
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function getStableOutputMessageId(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const id = (message as { id?: unknown }).id;
  if (typeof id === "string" && id.trim()) {
    return id.trim();
  }

  const messageId = (message as { message_id?: unknown }).message_id;
  if (typeof messageId === "string" && messageId.trim()) {
    return messageId.trim();
  }

  return null;
}

function dedupeOutputMessagesByStableId<T>(messages: T[]): T[] {
  const deduped: T[] = [];
  const indexById = new Map<string, number>();

  for (const message of messages) {
    const stableId = getStableOutputMessageId(message);
    if (!stableId) {
      deduped.push(message);
      continue;
    }

    const existingIndex = indexById.get(stableId);
    if (existingIndex === undefined) {
      indexById.set(stableId, deduped.length);
      deduped.push(message);
      continue;
    }

    // Streamed "thinking" updates can resend the same message id; keep latest.
    deduped[existingIndex] = message;
  }

  return deduped;
}

function sanitizeStreamEventPayload(rawData: string): string {
  if (!rawData || rawData === "[DONE]") {
    return rawData;
  }

  try {
    const parsed = JSON.parse(rawData) as unknown;

    const sanitizeNode = (node: unknown): [unknown, boolean] => {
      if (Array.isArray(node)) {
        let changed = false;
        const items = node.map((item) => {
          const [nextItem, itemChanged] = sanitizeNode(item);
          if (itemChanged) {
            changed = true;
          }
          return nextItem;
        });
        return [items, changed];
      }

      if (!node || typeof node !== "object") {
        return [node, false];
      }

      const record = node as Record<string, unknown>;
      let changed = false;
      const next: Record<string, unknown> = { ...record };

      for (const [key, value] of Object.entries(record)) {
        if (key === "output" && Array.isArray(value) && value.length > 1) {
          const deduped = dedupeOutputMessagesByStableId(value);
          if (deduped.length !== value.length) {
            next[key] = deduped;
            changed = true;
            continue;
          }
        }

        const [nextValue, valueChanged] = sanitizeNode(value);
        if (valueChanged) {
          next[key] = nextValue;
          changed = true;
        }
      }

      return [changed ? next : node, changed];
    };

    const [sanitized, changed] = sanitizeNode(parsed);
    if (!changed) {
      return rawData;
    }

    return JSON.stringify(sanitized);
  } catch {
    return rawData;
  }
}

function sanitizeConsoleChatSseStream(
  source: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const splitNextEvent = (input: string): [string, string] | null => {
    const lfBoundary = input.indexOf("\n\n");
    const crlfBoundary = input.indexOf("\r\n\r\n");

    if (lfBoundary === -1 && crlfBoundary === -1) {
      return null;
    }

    const useCrLf =
      crlfBoundary !== -1 &&
      (lfBoundary === -1 || crlfBoundary < lfBoundary);
    const boundary = useCrLf ? crlfBoundary : lfBoundary;
    const sepLength = useCrLf ? 4 : 2;
    const frame = input.slice(0, boundary);
    const rest = input.slice(boundary + sepLength);

    return [frame, rest];
  };

  const transformFrame = (frame: string): string => {
    if (!frame) {
      return frame;
    }

    const lines = frame.split(/\r?\n/);
    const dataIndexes: number[] = [];
    const dataValues: string[] = [];

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.startsWith("data:")) {
        continue;
      }
      dataIndexes.push(i);
      dataValues.push(line.slice(5).trimStart());
    }

    if (dataIndexes.length === 0) {
      return frame;
    }

    const rawData = dataValues.join("\n");
    const sanitized = sanitizeStreamEventPayload(rawData);
    if (sanitized === rawData) {
      return frame;
    }

    const firstDataIndex = dataIndexes[0];
    lines[firstDataIndex] = `data: ${sanitized}`;

    // Collapse additional data lines into the first one to avoid
    // duplicated payload fragments after sanitization.
    for (let i = dataIndexes.length - 1; i >= 1; i -= 1) {
      lines.splice(dataIndexes[i], 1);
    }

    return lines.join("\n");
  };

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const reader = source.getReader();
      let buffer = "";

      const pump = (): void => {
        void reader.read().then(({ done, value }) => {
          if (done) {
            buffer += decoder.decode();
            if (buffer.length > 0) {
              controller.enqueue(
                encoder.encode(`${transformFrame(buffer)}\n\n`),
              );
            }
            controller.close();
            return;
          }

          buffer += decoder.decode(value, { stream: true });

          let eventParts = splitNextEvent(buffer);
          while (eventParts) {
            const [frame, rest] = eventParts;
            buffer = rest;
            controller.enqueue(
              encoder.encode(`${transformFrame(frame)}\n\n`),
            );
            eventParts = splitNextEvent(buffer);
          }

          pump();
        }).catch((error) => {
          controller.error(error);
        });
      };

      pump();
    },
  });
}

function formatLocalDateTime(raw?: string): string {
  if (!raw) {
    return "";
  }
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) {
    return raw;
  }
  return new Date(ts).toLocaleString([], {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getChatMeta(chat?: ChatSpec): Record<string, unknown> | undefined {
  return chat?.meta && typeof chat.meta === "object"
    ? (chat.meta as Record<string, unknown>)
    : undefined;
}

function getMetaString(
  meta: Record<string, unknown> | undefined,
  key: string,
): string {
  const value = meta?.[key];
  return typeof value === "string" ? value : "";
}

function getChatScope(chat?: ChatSpec, parent?: ChatSpec) {
  const meta = getChatMeta(chat) || getChatMeta(parent);
  return {
    focusType: getMetaString(meta, "focus_type"),
    projectId:
      getMetaString(meta, "project_id") ||
      getMetaString(meta, "project_request_id"),
    runId: getMetaString(meta, "run_id"),
    focusPath: getMetaString(meta, "focus_path"),
    bindingKey:
      getMetaString(meta, "focus_binding_key") ||
      getMetaString(meta, "pipeline_binding_key"),
  };
}

function toTimestamp(raw?: string | null): number {
  if (!raw) {
    return 0;
  }
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function collectDescendantChatIds(chats: ChatSpec[], seedIds: string[]): Set<string> {
  const childrenByParent = new Map<string, ChatSpec[]>();
  for (const chat of chats) {
    if (!chat.session_id) {
      continue;
    }
    const children = childrenByParent.get(chat.session_id) || [];
    children.push(chat);
    childrenByParent.set(chat.session_id, children);
  }

  const relatedIds = new Set(seedIds);
  const queue = [...seedIds];
  while (queue.length > 0) {
    const currentId = queue.shift() as string;
    const children = childrenByParent.get(currentId) || [];
    for (const child of children) {
      if (relatedIds.has(child.id)) {
        continue;
      }
      relatedIds.add(child.id);
      queue.push(child.id);
    }
  }

  return relatedIds;
}

function resolveChatScopeFromAncestors(chats: ChatSpec[], chat?: ChatSpec) {
  const chatById = new Map(chats.map((item) => [item.id, item]));
  let current = chat;

  while (current) {
    const scope = getChatScope(current);
    if (scope.focusType || scope.projectId || scope.runId || scope.bindingKey || scope.focusPath) {
      return scope;
    }
    if (!current.session_id) {
      break;
    }
    current = chatById.get(current.session_id);
  }

  return getChatScope(chat);
}

function isFinalResponseStatus(status?: string): boolean {
  return (
    status === AgentScopeRuntimeRunStatus.Completed ||
    status === AgentScopeRuntimeRunStatus.Failed ||
    status === AgentScopeRuntimeRunStatus.Canceled
  );
}

function hasRenderableOutput(response: StreamResponseData): boolean {
  const normalized = materializeThinkingOnlyFallback(response);
  if (response.status === AgentScopeRuntimeRunStatus.Failed) {
    return true;
  }

  return (
    normalized.output?.some((message) => (message.content?.length ?? 0) > 0) ??
    false
  );
}

function extractAssistantText(response: StreamResponseData | null): string {
  return extractRenderableAssistantText(response);
}

function extractRawMarkdownText(response: CopyableResponse): string {
  const normalized = materializeThinkingOnlyFallback(
    response as CopyableResponse & StreamResponseData,
  );
  const textBlocks: string[] = [];

  for (const message of normalized.output || []) {
    if (typeof message.content === "string") {
      textBlocks.push(message.content);
      continue;
    }

    if (!Array.isArray(message.content)) continue;

    for (const part of message.content) {
      if (part.type === "text" && typeof part.text === "string") {
        textBlocks.push(part.text);
        continue;
      }

      if (part.type === "refusal" && typeof part.refusal === "string") {
        textBlocks.push(part.refusal);
        continue;
      }
    }
  }

  return textBlocks.join("\n\n").trim();
}

function stripMarkdownSyntax(markdown: string): string {
  if (!markdown) {
    return "";
  }
  return markdown
    .replace(/```([\s\S]*?)```/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\(([^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_{1,2}([^_]+)_{1,2}/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export default function AnywhereChat({
  sessionId,
  hostClassName = "pipeline-anywhere-chat-host",
  inputPlaceholder,
  welcomeGreeting,
  welcomeDescription,
  welcomePrompts,
  welcomePromptsWhenEmpty,
  welcomePromptClickBehavior = "submit",
  onNewChat,
  onSelectHistoryChat,
  historyMenuActionLabel,
  onHistoryMenuAction,
  onAssistantTurnCompleted,
  autoAttachRequest,
  onAutoAttachHandled,
}: AnywhereChatProps) {
  const isComposingRef = useRef(false);
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { selectedAgent } = useAgentStore();
  const [refreshKey, setRefreshKey] = useState(0);
  const [providerList, setProviderList] = useState<ProviderInfo[]>([]);
  const [activeModels, setActiveModels] = useState<ActiveModelsInfo | null>(null);
  const [runningConfig, setRunningConfig] = useState<AgentsRunningConfig | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatHistory | null>(null);
  const [runtimeStatusFromApi, setRuntimeStatusFromApi] = useState<ChatRuntimeStatus | null>(null);
  const [runtimeStatusOpen, setRuntimeStatusOpen] = useState(false);
  const [historyPopoverOpen, setHistoryPopoverOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyChats, setHistoryChats] = useState<ChatSpec[]>([]);
  const [currentChatName, setCurrentChatName] = useState("");
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const [lastRuntimeStatusUpdatedAt, setLastRuntimeStatusUpdatedAt] = useState<number | null>(null);
  const [runtimeStatusError, setRuntimeStatusError] = useState<string | null>(null);
  const [transientMessages, setTransientMessages] = useState<Message[]>([]);
  const [recoveredTailUserDraft, setRecoveredTailUserDraft] = useState("");
  const [isDeletingTailUser, setIsDeletingTailUser] = useState(false);
  const [tailUserActionHost, setTailUserActionHost] = useState<HTMLElement | null>(null);
  const [tailUserActionMessageId, setTailUserActionMessageId] = useState("");
  const chatRef = useRef<IAgentScopeRuntimeWebUIRef>(null);
  const runtimeStatusRequestInFlight = useRef(false);
  const sessionIdRef = useRef(sessionId);
  const backendSessionIdRef = useRef(sessionId);
  const runtimeStatusRetryTimerRef = useRef<number | null>(null);
  const runtimeStatusRetryCountRef = useRef(0);
  const handledAutoAttachIdRef = useRef("");
  const recoveredTailUserKeyRef = useRef("");
  const dismissedTailUserKeyRef = useRef("");

  useEffect(() => {
    const isAnywhereChatInput = (eventTarget: EventTarget | null): boolean => {
      const target = eventTarget as HTMLElement | null;
      if (!target) return false;
      if (target.tagName !== "TEXTAREA") return false;
      return Boolean(target.closest(".copaw-chat-anywhere-layout"));
    };

    const handleCompositionStart = (event: CompositionEvent) => {
      if (!isAnywhereChatInput(event.target)) return;
      isComposingRef.current = true;
    };

    const handleCompositionEnd = (event: CompositionEvent) => {
      if (!isAnywhereChatInput(event.target)) return;
      // Safari on macOS may dispatch keydown right after compositionend.
      setTimeout(() => {
        isComposingRef.current = false;
      }, 200);
    };

    const suppressImeEnter = (event: KeyboardEvent) => {
      if (!isAnywhereChatInput(event.target)) return;
      const composingEvent = event as KeyboardEvent & { isComposing?: boolean };
      if (event.key === "Enter" && !event.shiftKey) {
        if (composingEvent.isComposing || isComposingRef.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };

    document.addEventListener("compositionstart", handleCompositionStart, true);
    document.addEventListener("compositionend", handleCompositionEnd, true);
    document.addEventListener("keydown", suppressImeEnter, true);

    return () => {
      document.removeEventListener("compositionstart", handleCompositionStart, true);
      document.removeEventListener("compositionend", handleCompositionEnd, true);
      document.removeEventListener("keydown", suppressImeEnter, true);
    };
  }, []);

  const getInputRoot = useCallback((): HTMLElement | null => {
    return document.querySelector(`.${hostClassName}`) as HTMLElement | null;
  }, [hostClassName]);

  const getInputTextarea = useCallback((): HTMLTextAreaElement | null => {
    const root = getInputRoot();
    return root?.querySelector("textarea") as HTMLTextAreaElement | null;
  }, [getInputRoot]);

  const setDraftInputValue = useCallback(
    (nextValue: string, shouldFocus = true) => {
    const textArea = getInputTextarea();
    if (!textArea) {
      return false;
    }
    const prototype = Object.getPrototypeOf(textArea) as {
      value?: PropertyDescriptor;
    };
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor?.set) {
      descriptor.set.call(textArea, nextValue);
    } else {
      textArea.value = nextValue;
    }
    textArea.dispatchEvent(new Event("input", { bubbles: true }));
    if (shouldFocus) {
      textArea.focus();
    }
    return true;
  }, [getInputTextarea]);

  const appendPromptToDraftInput = useCallback((promptText: string) => {
    const textArea = getInputTextarea();
    if (!textArea) {
      return;
    }
    const current = (textArea.value || "").trim();
    const nextValue = current
      ? `${current}\n\n${promptText}`
      : promptText;
    setDraftInputValue(nextValue);
  }, [getInputTextarea, setDraftInputValue]);

  const resolveCurrentChatName = useCallback(
    (chats: ChatSpec[]): string => {
      const current = chats.find((chat) => chat.id === sessionId);
      return (current?.name || current?.session_id || current?.id || "").trim()
        || t("chat.newChat", "New Chat");
    },
    [sessionId, t],
  );

  const loadCurrentChatName = useCallback(async () => {
    try {
      const chats = await chatApi.listChats({ user_id: "default", channel: "console" });
      const current = chats.find((chat) => chat.id === sessionId);
      backendSessionIdRef.current = current?.session_id || sessionId;
      setCurrentChatName(resolveCurrentChatName(chats));
    } catch {
      backendSessionIdRef.current = sessionId;
      setCurrentChatName(t("chat.newChat", "New Chat"));
    }
  }, [resolveCurrentChatName, sessionId, t]);

  const loadHistoryChats = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const chats = await chatApi.listChats({ user_id: "default", channel: "console" });
      setCurrentChatName(resolveCurrentChatName(chats));
      const current = chats.find((chat) => chat.id === sessionId);
      backendSessionIdRef.current = current?.session_id || sessionId;
      const currentScope = resolveChatScopeFromAncestors(chats, current);
      const currentWorkspaceRootIds = chats
        .filter((chat) => {
          const scope = getChatScope(chat);
          return (
            currentScope.focusType === "project_workspace" &&
            scope.focusType === "project_workspace" &&
            (!currentScope.projectId || scope.projectId === currentScope.projectId)
          );
        })
        .map((chat) => chat.id);
      const currentWorkspaceRelatedIds = collectDescendantChatIds(
        chats,
        currentWorkspaceRootIds,
      );

      const filtered = chats.filter((chat) => {
        const parent = chat.session_id
          ? chats.find((item) => item.id === chat.session_id)
          : undefined;
        const scope = getChatScope(chat, parent);

        if (currentScope.focusType === "project_workspace") {
          return (
            currentWorkspaceRelatedIds.has(chat.id) ||
            currentWorkspaceRelatedIds.has(chat.session_id || "")
          );
        }
        if (currentScope.focusType === "project_run") {
          return (
            scope.focusType === "project_run" &&
            (!currentScope.runId || scope.runId === currentScope.runId) &&
            (!currentScope.projectId || !scope.projectId || scope.projectId === currentScope.projectId)
          );
        }
        if (currentScope.focusType === "pipeline_edit") {
          return (
            scope.focusType === "pipeline_edit" &&
            (!currentScope.bindingKey || scope.bindingKey === currentScope.bindingKey)
          );
        }
        if (currentScope.bindingKey) {
          return scope.bindingKey === currentScope.bindingKey;
        }
        if (current?.session_id) {
          const basePrefix = current.session_id.replace(/-\d+$/, "");
          return (chat.session_id || "").startsWith(basePrefix);
        }
        return true;
      });

      filtered.sort((a, b) => {
        const aTs = toTimestamp(a.updated_at) || toTimestamp(a.created_at);
        const bTs = toTimestamp(b.updated_at) || toTimestamp(b.created_at);
        return bTs - aTs;
      });

      setHistoryChats(
        filtered.filter(
          (chat, index, array) => array.findIndex((item) => item.id === chat.id) === index,
        ),
      );
    } catch (error) {
      console.warn("AnywhereChat: failed to load history chats", error);
      backendSessionIdRef.current = sessionId;
      setHistoryChats([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [resolveCurrentChatName, sessionId]);

  const updateTransientMessages = useCallback((messages: Message[]) => {
    setTransientMessages(messages);
    setLastRuntimeStatusUpdatedAt(Date.now());
  }, []);

  const loadRuntimeInputs = useCallback(async () => {
    try {
      const [providers, activeModelConfig, runtimeConfig] = await Promise.all([
        providerApi.listProviders(),
        providerApi.getActiveModels(),
        agentApi.getAgentRunningConfig(),
      ]);
      setProviderList(Array.isArray(providers) ? providers : []);
      setActiveModels(activeModelConfig ?? null);
      setRunningConfig(runtimeConfig ?? null);
    } catch (error) {
      console.warn("AnywhereChat: failed to load runtime inputs", error);
      setProviderList([]);
      setActiveModels(null);
      setRunningConfig(null);
    }
  }, []);

  const loadChatHistory = useCallback(async () => {
    if (!sessionId) {
      setChatHistory(null);
      return;
    }
    const requestedSessionId = sessionId;
    try {
      const history = await loadMergedRawChatHistory(requestedSessionId);
      if (sessionIdRef.current !== requestedSessionId) {
        return;
      }

      const tailUserState = getLastVisibleUserState(history);

      if (tailUserState) {
        const recoverKey = `${requestedSessionId}:${tailUserState.stableId}`;
        recoveredTailUserKeyRef.current = recoverKey;
        setRecoveredTailUserDraft(tailUserState.text);

        if (dismissedTailUserKeyRef.current === recoverKey) {
          setChatHistory(removeLastVisibleUserMessage(history) as ChatHistory | null);
        } else {
          setChatHistory(history);
        }
      } else {
        setRecoveredTailUserDraft("");
        setChatHistory(history);
      }

      setRuntimeStatusError(null);
      setLastRuntimeStatusUpdatedAt(Date.now());
    } catch (error) {
      console.warn("AnywhereChat: failed to load chat history", error);
      if (sessionIdRef.current !== requestedSessionId) {
        return;
      }
      setRuntimeStatusError(
        error instanceof Error ? error.message : t("chat.runtimeStatusUnknownError", "未知错误"),
      );
      setChatHistory(null);
    }
  }, [sessionId, t]);

  const clearRuntimeStatusRetry = useCallback(() => {
    if (runtimeStatusRetryTimerRef.current !== null) {
      window.clearTimeout(runtimeStatusRetryTimerRef.current);
      runtimeStatusRetryTimerRef.current = null;
    }
  }, []);

  const loadRuntimeStatus = useCallback(async (): Promise<ChatRuntimeStatus | null> => {
    if (!sessionId) {
      setRuntimeStatusFromApi(null);
      return null;
    }
    if (runtimeStatusRequestInFlight.current) {
      return null;
    }
    const requestedSessionId = sessionId;
    runtimeStatusRequestInFlight.current = true;
    try {
      const snapshot = await chatApi.getRuntimeStatus(requestedSessionId);
      if (sessionIdRef.current !== requestedSessionId) {
        return null;
      }
      setRuntimeStatusFromApi(snapshot ?? null);
      setRuntimeStatusError(null);
      setLastRuntimeStatusUpdatedAt(Date.now());
      return snapshot ?? null;
    } catch (error) {
      console.warn("AnywhereChat: failed to load runtime status", error);
      if (sessionIdRef.current !== requestedSessionId) {
        return null;
      }
      setRuntimeStatusError(
        error instanceof Error ? error.message : t("chat.runtimeStatusUnknownError", "未知错误"),
      );
      setRuntimeStatusFromApi(null);
      return null;
    } finally {
      runtimeStatusRequestInFlight.current = false;
    }
  }, [sessionId, t]);

  const loadRuntimeStatusWithRetry = useCallback(async () => {
    clearRuntimeStatusRetry();
    const snapshot = await loadRuntimeStatus();
    const shouldRetry =
      runtimeStatusOpen &&
      sessionIdRef.current === sessionId &&
      !isChatStreaming &&
      !!snapshot &&
      snapshot.snapshot_source === "empty_baseline" &&
      runtimeStatusRetryCountRef.current < RUNTIME_STATUS_MAX_RETRIES;

    if (!shouldRetry) {
      return snapshot;
    }

    runtimeStatusRetryCountRef.current += 1;
    runtimeStatusRetryTimerRef.current = window.setTimeout(() => {
      void loadRuntimeStatusWithRetry();
    }, RUNTIME_STATUS_RETRY_DELAY_MS);
    return snapshot;
  }, [clearRuntimeStatusRetry, isChatStreaming, loadRuntimeStatus, runtimeStatusOpen, sessionId]);

  const copyAsText = useCallback(async (response: CopyableResponse) => {
    const payload = extractCopyableText(response) || stripMarkdownSyntax(extractRawMarkdownText(response));
    if (!payload) {
      message.warning(t("common.nothingToCopy", "No copyable content."));
      return;
    }
    try {
      await copyText(payload);
      message.success(t("common.copiedText", "Text copied"));
    } catch {
      message.error(t("common.copyTextFailed", "Failed to copy text"));
    }
  }, [t]);

  const copyAsMarkdown = useCallback(async (response: CopyableResponse) => {
    const raw = extractRawMarkdownText(response);
    const payload = raw || extractAssistantText(response as StreamResponseData | null);
    if (!payload) {
      message.warning(t("common.nothingToCopy", "No copyable content."));
      return;
    }
    try {
      await copyText(payload);
      message.success(t("common.copiedMarkdown", "Markdown copied"));
    } catch {
      message.error(t("common.copyMarkdownFailed", "Failed to copy Markdown"));
    }
  }, [t]);

  const handleFileUpload = useCallback(
    async (options: {
      file: File;
      onSuccess: (body: { url?: string; thumbUrl?: string }) => void;
      onError?: (e: Error) => void;
      onProgress?: (e: { percent?: number }) => void;
    }) => {
      const { file, onSuccess, onError, onProgress } = options;
      try {
        const sizeMb = file.size / 1024 / 1024;
        if (sizeMb >= CHAT_ATTACHMENT_MAX_MB) {
          message.error(
            t("chat.attachments.fileSizeExceeded", {
              limit: CHAT_ATTACHMENT_MAX_MB,
              size: sizeMb.toFixed(2),
              defaultValue: `File size exceeds ${CHAT_ATTACHMENT_MAX_MB} MB (current ${sizeMb.toFixed(2)} MB).`,
            }),
          );
          onError?.(new Error(`File size exceeds ${CHAT_ATTACHMENT_MAX_MB}MB`));
          return;
        }

        const res = await chatApi.uploadFile(file);
        onProgress?.({ percent: 100 });
        onSuccess({ url: chatApi.filePreviewUrl(res.url) });
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    },
    [t],
  );

  useEffect(() => {
    sessionIdRef.current = sessionId;
    backendSessionIdRef.current = sessionId;
    recoveredTailUserKeyRef.current = "";
    dismissedTailUserKeyRef.current = "";
    setRecoveredTailUserDraft("");
    clearRuntimeStatusRetry();
    runtimeStatusRetryCountRef.current = 0;
    void loadCurrentChatName();
    setRefreshKey((prev) => prev + 1);
    setChatHistory(null);
    setRuntimeStatusFromApi(null);
    setRuntimeStatusError(null);
    setTransientMessages([]);

  }, [clearRuntimeStatusRetry, loadCurrentChatName, sessionId]);

  useEffect(() => {
    if (!autoAttachRequest?.id) {
      return;
    }
    if (handledAutoAttachIdRef.current === autoAttachRequest.id) {
      return;
    }

    let cancelled = false;

    const waitFor = async (ms: number) =>
      new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), ms);
      });

    const waitForDraftInputReady = async (
      draftText: string,
      attempts = 12,
      intervalMs = 80,
    ): Promise<boolean> => {
      for (let i = 0; i < attempts; i += 1) {
        if (cancelled) {
          return false;
        }
        if (setDraftInputValue(draftText, false)) {
          return true;
        }
        await waitFor(intervalMs);
      }
      return false;
    };

    const waitForChatRefReady = async (
      attempts = 12,
      intervalMs = 80,
    ): Promise<boolean> => {
      for (let i = 0; i < attempts; i += 1) {
        if (cancelled) {
          return false;
        }
        if (chatRef.current) {
          return true;
        }
        await waitFor(intervalMs);
      }
      return false;
    };

    const attach = async () => {
      try {
        const mode = autoAttachRequest.mode || "submit";
        if (mode === "draft") {
          const draftText =
            autoAttachRequest.note ||
            "I attached files as context. Please review them and wait for my next instruction.";

          if (await waitForDraftInputReady(draftText)) {
            handledAutoAttachIdRef.current = autoAttachRequest.id;
            onAutoAttachHandled?.({
              id: autoAttachRequest.id,
              ok: true,
            });
            return;
          }

          throw new Error("chat_input_not_found");
        }

        const sourceFiles = Array.isArray(autoAttachRequest.files) && autoAttachRequest.files.length > 0
          ? autoAttachRequest.files
          : autoAttachRequest.fileName && autoAttachRequest.content
            ? [{
                fileName: autoAttachRequest.fileName,
                content: autoAttachRequest.content,
                mimeType: autoAttachRequest.mimeType,
              }]
            : [];

        if (sourceFiles.length === 0) {
          throw new Error("auto_attach_no_files");
        }

        const uploadedFiles = await Promise.all(
          sourceFiles.map(async (source, index) => {
            const file = new File([source.content], source.fileName, {
              type: source.mimeType || "text/plain",
            });
            const uploaded = await chatApi.uploadFile(file);
            const uploadUrl = chatApi.filePreviewUrl(uploaded.url);

            return {
              uid: `${autoAttachRequest.id}-${index}`,
              name: source.fileName,
              status: "done" as const,
              type: source.mimeType || "text/plain",
              size: file.size,
              file_id: uploaded.stored_name || uploaded.url,
              response: {
                url: uploadUrl,
              },
            };
          }),
        );

        if (!(await waitForChatRefReady())) {
          throw new Error("chat_input_not_ready");
        }

        const chat = chatRef.current;
        if (!chat) {
          throw new Error("chat_input_not_ready");
        }

        chat.input.submit({
          query:
            autoAttachRequest.note ||
            `Please use the attached files as the current context and infer the likely task intent.`,
          fileList: uploadedFiles,
        });

        handledAutoAttachIdRef.current = autoAttachRequest.id;
        onAutoAttachHandled?.({
          id: autoAttachRequest.id,
          ok: true,
        });
      } catch (error) {
        onAutoAttachHandled?.({
          id: autoAttachRequest.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    void attach();

    return () => {
      cancelled = true;
    };
  }, [
    autoAttachRequest,
    onAutoAttachHandled,
    setDraftInputValue,
  ]);

  useEffect(() => {
    void loadRuntimeInputs();

    const handleModelSwitched = () => {
      void loadRuntimeInputs();
    };

    window.addEventListener("model-switched", handleModelSwitched);
    return () => {
      window.removeEventListener("model-switched", handleModelSwitched);
    };
  }, [loadRuntimeInputs]);

  useEffect(() => {
    void loadChatHistory();
  }, [loadChatHistory, sessionId]);

  const lastVisibleUserState = useMemo(() => {
    return getLastVisibleUserState(chatHistory);
  }, [chatHistory]);

  const isLastVisibleMessageUser = Boolean(lastVisibleUserState);

  const lastVisibleUserMessageId = lastVisibleUserState?.stableId || "";

  const executeRestoreTailUserDraft = useCallback(async () => {
    if (
      !sessionId
      || !recoveredTailUserDraft
      || !recoveredTailUserKeyRef.current
      || isDeletingTailUser
    ) {
      return;
    }

    setIsDeletingTailUser(true);
    try {
      const result = await chatApi.deleteTailUserMessage(sessionId);
      if (!result?.deleted) {
        throw new Error(
          t(
            "chat.deleteLastUserFailed",
            "Failed to delete the last user message.",
          ),
        );
      }

      dismissedTailUserKeyRef.current = recoveredTailUserKeyRef.current;
      setChatHistory((previousHistory) => {
        return removeLastVisibleUserMessage(previousHistory) as ChatHistory | null;
      });
      const visibleLastUserMessage = chatRef.current?.messages
        .getMessages()
        .slice()
        .reverse()
        .find((message) => message.role === "user");
      if (visibleLastUserMessage?.id) {
        chatRef.current?.messages.removeMessage({ id: visibleLastUserMessage.id });
      }
      sessionApi.removeLastUserMessage(sessionId);
      const resolvedSessionId = sessionApi.getRealIdForSession(sessionId);
      if (resolvedSessionId && resolvedSessionId !== sessionId) {
        sessionApi.removeLastUserMessage(resolvedSessionId);
      }
      setDraftInputValue(result.removed_text || recoveredTailUserDraft);
      setRecoveredTailUserDraft("");
      setTailUserActionHost(null);
      setTailUserActionMessageId("");
      await loadChatHistory();
      if (runtimeStatusOpen) {
        runtimeStatusRetryCountRef.current = 0;
        await loadRuntimeStatusWithRetry();
      }
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : t(
              "chat.deleteLastUserFailed",
              "Failed to delete the last user message.",
            ),
      );
      throw error;
    } finally {
      setIsDeletingTailUser(false);
    }
  }, [
    isDeletingTailUser,
    loadChatHistory,
    loadRuntimeStatusWithRetry,
    recoveredTailUserDraft,
    runtimeStatusOpen,
    sessionId,
    setDraftInputValue,
    t,
  ]);

  const handleRestoreTailUserDraft = useCallback(() => {
    if (!recoveredTailUserDraft || isDeletingTailUser) {
      return;
    }

    Modal.confirm({
      title: t("chat.confirmDeleteLastUserTitle", "确认删除最后一条用户消息"),
      okText: t("common.confirm", "Confirm"),
      cancelText: t("common.cancel", "Cancel"),
      okButtonProps: { danger: true },
      width: 640,
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "rgba(0,0,0,0.45)" }}>
              {t("chat.messageIdLabel", "消息 ID")}
            </span>
            <div
              style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                fontSize: 12,
                wordBreak: "break-all",
              }}
            >
              {tailUserActionMessageId || t("chat.unknownMessageId", "unknown")}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "rgba(0,0,0,0.45)" }}>
              {t("chat.messageContentLabel", "消息内容")}
            </span>
            <div
              style={{
                maxHeight: 240,
                overflow: "auto",
                padding: 12,
                borderRadius: 8,
                background: "rgba(0,0,0,0.03)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                lineHeight: 1.6,
              }}
            >
              {recoveredTailUserDraft}
            </div>
          </div>
        </div>
      ),
      onOk: async () => {
        try {
          await executeRestoreTailUserDraft();
        } catch {
          // executeRestoreTailUserDraft already shows the user-facing error.
        }
      },
    });
  }, [
    executeRestoreTailUserDraft,
    isDeletingTailUser,
    recoveredTailUserDraft,
    t,
    tailUserActionMessageId,
  ]);

  useEffect(() => {
    if (!isLastVisibleMessageUser || !recoveredTailUserDraft) {
      setTailUserActionHost(null);
      return;
    }

    const root = getInputRoot();
    if (!root) {
      setTailUserActionHost(null);
      return;
    }

    const resolveHost = () => {
      const candidates = Array.from(
        root.querySelectorAll<HTMLElement>('[data-role="user"][id^="msg_"]'),
      ).filter((node) => node.offsetParent !== null);
      const target = candidates
        .map((node) => ({
          node,
          rect: node.getBoundingClientRect(),
        }))
        .filter(({ rect }) => rect.bottom > 0)
        .sort((left, right) => {
          if (left.rect.top !== right.rect.top) {
            return right.rect.top - left.rect.top;
          }
          return right.rect.bottom - left.rect.bottom;
        })[0]?.node || null;
      const host =
        target?.querySelector<HTMLElement>(":scope > .copaw-bubble-content-wrapper")
        || target;
      setTailUserActionHost(host || null);
    };

    resolveHost();

    const observer = new MutationObserver(() => {
      resolveHost();
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
    });

    window.addEventListener("resize", resolveHost);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resolveHost);
    };
  }, [
    chatHistory?.messages,
    getInputRoot,
    isLastVisibleMessageUser,
    recoveredTailUserDraft,
  ]);

  useEffect(() => {
    setTailUserActionMessageId(lastVisibleUserMessageId);
  }, [lastVisibleUserMessageId]);

  useEffect(() => {
    if (!runtimeStatusOpen) {
      clearRuntimeStatusRetry();
      runtimeStatusRetryCountRef.current = 0;
      return;
    }

    runtimeStatusRetryCountRef.current = 0;
    void loadRuntimeStatusWithRetry();

    return () => {
      clearRuntimeStatusRetry();
    };
  }, [
    clearRuntimeStatusRetry,
    loadRuntimeStatusWithRetry,
    runtimeStatusOpen,
    sessionId,
  ]);

  const transientHistory = useMemo<ChatHistory | null>(
    () =>
      transientMessages.length > 0
        ? {
            messages: transientMessages,
            status: isChatStreaming ? "running" : chatHistory?.status,
            total: transientMessages.length,
          }
        : null,
    [chatHistory?.status, isChatStreaming, transientMessages],
  );

  const fallbackHistory = useMemo<ChatHistory | null>(() => {
    if (!transientMessages.length) {
      return chatHistory;
    }
    return {
      ...chatHistory,
      messages: [...(chatHistory?.messages || []), ...transientMessages],
      total: (chatHistory?.messages?.length || 0) + transientMessages.length,
    };
  }, [chatHistory, transientMessages]);

  const runtimeStatus = useMemo(() => {
    if (runtimeStatusFromApi) {
      return mergeRuntimeStatusSnapshot(runtimeStatusFromApi, {
        providers: providerList,
        activeModels,
        runningConfig,
        chatHistory: transientHistory,
      }, {
        expectedAgentId: selectedAgent || null,
        expectedChatId: sessionId || null,
        expectedSnapshotStage: "pre_model_call",
      });
    }

    return deriveRuntimeStatusSnapshot({
      providers: providerList,
      activeModels,
      runningConfig,
      chatHistory: fallbackHistory,
    });
  }, [
    activeModels,
    fallbackHistory,
    providerList,
    runningConfig,
    runtimeStatusFromApi,
    selectedAgent,
    sessionId,
    transientHistory,
  ]);

  const runtimeStatusMeta = runtimeStatusFromApi || runtimeStatus;

  const singleSessionApi = useMemo(
    () => ({
      getSessionList: async () => {
        if (!sessionId) return [];
        try {
          const mergedSession = await loadMergedRuntimeSession(sessionId);
          return mergedSession ? [mergedSession] : [];
        } catch {
          return [];
        }
      },
      getSession: async () => {
        if (!sessionId) {
          throw new Error("session id missing");
        }
        const mergedSession = await loadMergedRuntimeSession(sessionId);
        if (mergedSession) {
          return mergedSession;
        }
        return sessionApi.getSession(sessionId);
      },
      createSession: async (session: Partial<{ id: string }>) => {
        if (sessionId) {
          try {
            const current = await sessionApi.getSession(sessionId);
            return [current];
          } catch {
            return [];
          }
        }
        return sessionApi.createSession(session);
      },
      updateSession: sessionApi.updateSession.bind(sessionApi),
      removeSession: sessionApi.removeSession.bind(sessionApi),
    }),
    [sessionId],
  );

  const customFetch = useCallback(
    async (data: {
      input?: ChatInputItem[];
      signal?: AbortSignal;
      session_id?: string;
      user_id?: string;
      channel?: string;
    }) => {
      if (!sessionId) {
        return new Response(JSON.stringify({ error: "session id missing" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...buildAuthHeaders(),
      };

      const input = data.input || [];
      const lastInput = input.slice(-1);
      const session = lastInput[0]?.session || {};
      const optimisticText = extractUserTextFromInput(lastInput[0]);
      const optimisticContent = lastInput[0]?.content;
      const pendingUserMessage: Message | null =
        optimisticText || Array.isArray(optimisticContent)
          ? {
              role: String(lastInput[0]?.role || "user"),
              content: Array.isArray(optimisticContent)
                ? optimisticContent
                : optimisticText,
            }
          : null;
      if (optimisticText) {
        dismissedTailUserKeyRef.current = "";
        setRecoveredTailUserDraft("");
        sessionApi.setLastUserMessage(sessionId, optimisticText);
        const resolvedSessionId = sessionApi.getRealIdForSession(sessionId);
        if (resolvedSessionId && resolvedSessionId !== sessionId) {
          sessionApi.setLastUserMessage(resolvedSessionId, optimisticText);
        }
      }

      let backendSessionId = backendSessionIdRef.current || sessionId;
      if (!backendSessionId || backendSessionId === sessionId) {
        try {
          const chats = await chatApi.listChats({ user_id: "default", channel: "console" });
          const current = chats.find((chat) => chat.id === sessionId);
          backendSessionId = current?.session_id || backendSessionId;
          backendSessionIdRef.current = backendSessionId;
        } catch {
          backendSessionId = backendSessionIdRef.current || sessionId;
        }
      }

      const response = await fetch(getApiUrl("/console/chat"), {
        method: "POST",
        headers,
        signal: data.signal,
        body: JSON.stringify({
          input: lastInput,
          session_id: backendSessionId || data.session_id || session?.session_id || "",
          user_id: data.user_id || session?.user_id || "default",
          channel: data.channel || session?.channel || "console",
          stream: true,
        }),
      });

      setIsChatStreaming(true);
      updateTransientMessages(pendingUserMessage ? [pendingUserMessage] : []);

      if (!response.ok || !response.body || !onAssistantTurnCompleted) {
        setIsChatStreaming(false);
        updateTransientMessages([]);
        return response;
      }

      const sanitizedStream = sanitizeConsoleChatSseStream(response.body);
      const [uiStream, cacheStream] = sanitizedStream.tee();
      void (async () => {
        const responseBuilder = new AgentScopeRuntimeResponseBuilder({
          id: "",
          status: AgentScopeRuntimeRunStatus.Created,
          created_at: 0,
        });
        let latestRenderable: StreamResponseData | null = null;

        try {
          for await (const chunk of Stream({ readableStream: cacheStream })) {
            let chunkData: unknown;
            try {
              chunkData = JSON.parse(chunk.data);
            } catch {
              continue;
            }

            const responseData = responseBuilder.handle(
              chunkData as never,
            ) as unknown as StreamResponseData;
            const renderableResponse = materializeThinkingOnlyFallback(responseData);

            if (hasRenderableOutput(renderableResponse)) {
              latestRenderable = JSON.parse(
                JSON.stringify(renderableResponse),
              ) as StreamResponseData;

              const partialAssistantText = extractAssistantText(latestRenderable);
              updateTransientMessages(
                [
                  pendingUserMessage,
                  partialAssistantText
                    ? {
                        role: "assistant",
                        content: partialAssistantText,
                      }
                    : null,
                ].filter(Boolean) as Message[],
              );
            }

            if (!isFinalResponseStatus(responseData.status)) {
              continue;
            }

            const finalPayload = latestRenderable || renderableResponse;
            onAssistantTurnCompleted({
              text: extractAssistantText(finalPayload),
              response: finalPayload as Record<string, unknown>,
            });
            setIsChatStreaming(false);
            await loadChatHistory();
            if (runtimeStatusOpen) {
              runtimeStatusRetryCountRef.current = 0;
              await loadRuntimeStatusWithRetry();
            }
            updateTransientMessages([]);
            break;
          }
        } catch (error) {
          setIsChatStreaming(false);
          updateTransientMessages([]);
          console.warn("AnywhereChat stream side-channel parse failed", error);
        }
      })();

      return new Response(uiStream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
    [
      loadChatHistory,
      loadRuntimeStatusWithRetry,
      onAssistantTurnCompleted,
      runtimeStatusOpen,
      sessionId,
      updateTransientMessages,
    ],
  );

  const options = useMemo(() => {
    const i18nConfig = getDefaultConfig(t);
    const senderConfig = (i18nConfig as SenderConfigShape).sender || {};
    const commandSuggestions: CommandSuggestion[] = [
      {
        command: "/clear",
        value: "clear",
        description: t("chat.commands.clear.description"),
      },
      {
        command: "/compact",
        value: "compact",
        description: t("chat.commands.compact.description"),
      },
      {
        command: "/approve",
        value: "approve",
        description: t("chat.commands.approve.description"),
      },
      {
        command: "/deny",
        value: "deny",
        description: t("chat.commands.deny.description"),
      },
    ];
    const welcomeConfig = (i18nConfig.welcome || {}) as WelcomeConfigShape;
    const selectedPromptValues = welcomePromptsWhenEmpty || welcomePrompts || [];
    const prompts =
      Array.isArray(selectedPromptValues) && selectedPromptValues.length > 0
        ? selectedPromptValues.map((value) => ({ value }))
        : (welcomeConfig.prompts || []);

    const handleBeforeSubmit = async () => {
      if (isComposingRef.current) return false;
      return true;
    };

    const renderWelcome =
      welcomePromptClickBehavior === "append"
        ? (props: {
            greeting?: string;
            avatar?: string;
            description?: string;
            prompts?: Array<{ value: string }>;
          }) => (
            <WelcomePrompts
              greeting={props.greeting}
              avatar={props.avatar}
              description={props.description}
              prompts={(props.prompts || []).map((item) => ({
                value: item.value,
                label: item.value,
              }))}
              onClick={(query) => {
                appendPromptToDraftInput(query);
              }}
            />
          )
        : undefined;

    return {
      ...i18nConfig,
      theme: {
        ...defaultConfig.theme,
        darkMode: isDark,
        leftHeader: null,
        rightHeader: null,
      },
      sender: {
        ...senderConfig,
        beforeSubmit: handleBeforeSubmit,
        allowSpeech: true,
        attachments: {
          trigger: function (props: AttachmentTriggerProps) {
            return (
              <Tooltip title={t("chat.attachments.tooltip", "Attach files")}> 
                <IconButton
                  disabled={props?.disabled}
                  icon={<SparkAttachmentLine />}
                  bordered={false}
                />
              </Tooltip>
            );
          },
          accept: "*/*",
          customRequest: handleFileUpload,
        },
        placeholder: inputPlaceholder || senderConfig.placeholder,
        suggestions: commandSuggestions.map((item) => ({
          label: renderSuggestionLabel(item.command, item.description),
          value: item.value,
        })),
      },
      welcome: {
        ...welcomeConfig,
        nick: "CoPaw",
        avatar:
          "https://gw.alicdn.com/imgextra/i2/O1CN01pyXzjQ1EL1PuZMlSd_!!6000000000334-2-tps-288-288.png",
        greeting: welcomeGreeting || welcomeConfig.greeting,
        description: welcomeDescription || welcomeConfig.description,
        prompts,
        render: renderWelcome,
      },
      session: {
        multiple: false,
        api: singleSessionApi,
      },
      api: {
        ...defaultConfig.api,
        fetch: customFetch,
        replaceMediaURL: (url: string) => toDisplayUrl(url),
        cancel(data: { session_id?: string }) {
          const chatIdForStop = data?.session_id || sessionId;
          if (chatIdForStop) {
            void chatApi.stopConsoleChat(chatIdForStop).catch((err) => {
              console.error("stopConsoleChat failed:", err);
              message.error(t("chat.stopFailed", "Failed to stop chat."));
            });
          }
        },
      },
      actions: {
        list: [
          {
            key: "copy-text",
            icon: (
              <span
                key="copy-text-action-icon"
                title={`${t("chat.copyText", "复制文本")} · ${t("chat.copyTextHint", "纯文本，不含格式")}`}
              >
                <CopyOutlined />
              </span>
            ),
            onClick: ({ data }: { data: CopyableResponse }) => {
              void copyAsText(data);
            },
          },
          {
            key: "copy-markdown",
            icon: (
              <span
                key="copy-md-action-icon"
                title={`${t("chat.copyMarkdown", "复制原始Markdown")} · ${t("chat.copyMarkdownHint", "保留Markdown格式")}`}
                className={styles.markdownCopyBadge}
              >
                <FileMarkdownOutlined />
                <span className={styles.markdownCopyBadgeText}>
                  {t("chat.copyMarkdownShortLabel", "MD")}
                </span>
              </span>
            ),
            onClick: ({ data }: { data: CopyableResponse }) => {
              void copyAsMarkdown(data);
            },
          },
        ],
        replace: true,
      },
    } as unknown as IAgentScopeRuntimeWebUIOptions;
  }, [
    copyAsMarkdown,
    copyAsText,
    customFetch,
    handleFileUpload,
    inputPlaceholder,
    isDark,
    appendPromptToDraftInput,
    sessionId,
    singleSessionApi,
    t,
    welcomeDescription,
    welcomeGreeting,
    welcomePromptClickBehavior,
    welcomePrompts,
    welcomePromptsWhenEmpty,
  ]);

  const runtimeStatusContent = useMemo(() => {
    const systemItems = runtimeStatus.breakdown.filter((item) => item.section === "system");
    const userItems = runtimeStatus.breakdown.filter((item) => item.section === "user");
    const hasFrontendLiveContribution = transientMessages.length > 0;
    const hasPreciseBackendSnapshot = runtimeStatusFromApi?.snapshot_source === "runtime_push";
    const hasEmptyBackendBaseline = runtimeStatusFromApi?.snapshot_source === "empty_baseline";
    const snapshotAgentLabel = runtimeStatusMeta.agent_id || t("chat.runtimeStatusFrontendLive", "frontend-live");
    const snapshotChatLabel = runtimeStatusMeta.chat_id || t("chat.runtimeStatusFrontendLive", "frontend-live");
    const snapshotScopeLabel = runtimeStatusMeta.scope_level || "unknown";
    const snapshotStageLabel = runtimeStatusMeta.snapshot_stage || "unknown";
    const snapshotSourceRawLabel = runtimeStatusMeta.snapshot_source || "unknown";
    const samplingStatusLabel = runtimeStatusError
      ? t("chat.runtimeStatusError", "采集异常")
      : hasEmptyBackendBaseline
        ? t("chat.runtimeStatusWaitingBackend", "等待后端采样")
        : lastRuntimeStatusUpdatedAt
        ? t("chat.runtimeStatusHealthy", "采集正常")
        : t("chat.runtimeStatusPending", "等待首次采样");
    const samplingStatusColor = runtimeStatusError
      ? "#ff7875"
      : hasEmptyBackendBaseline
        ? "#faad14"
        : lastRuntimeStatusUpdatedAt
        ? "#95de64"
        : "rgba(255,255,255,0.5)";
    const statusSourceLabel = hasPreciseBackendSnapshot
      ? hasFrontendLiveContribution
        ? t("chat.runtimeStatusHybrid", "后端 + 前端实时")
        : t("chat.runtimeStatusPrecise", "后端精确统计")
      : hasEmptyBackendBaseline
        ? t("chat.runtimeStatusEstimatedPendingBackend", "前端估算（等待后端采样）")
      : t("chat.runtimeStatusEstimated", "前端估算");
    const statusSourceColor = hasPreciseBackendSnapshot
      ? hasFrontendLiveContribution
        ? "#69b1ff"
        : "#95de64"
      : hasEmptyBackendBaseline
        ? "#faad14"
      : "#faad14";
    const lastUpdatedLabel = lastRuntimeStatusUpdatedAt
      ? new Date(lastRuntimeStatusUpdatedAt).toLocaleTimeString([], {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      : t("chat.runtimeStatusPending", "等待首次采样");

    const renderItem = (label: string, tokens: number, ratio: number) => (
      <div
        key={label}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          gap: 8,
          alignItems: "center",
          fontSize: 12,
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.88)" }}>{label}</span>
        <span style={{ color: "rgba(255,255,255,0.6)" }}>{formatTokenCount(tokens)}</span>
        <span style={{ color: "rgba(255,255,255,0.88)" }}>{(ratio * 100).toFixed(1)}%</span>
      </div>
    );

    const renderMetaRow = (label: string, value: string, testId: string) => (
      <div
        key={label}
        style={{
          display: "grid",
          gridTemplateColumns: "92px 1fr",
          gap: 8,
          alignItems: "start",
          fontSize: 11,
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.5)" }}>{label}</span>
        <span
          data-testid={testId}
          style={{
            color: "rgba(255,255,255,0.82)",
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            wordBreak: "break-all",
          }}
        >
          {value}
        </span>
      </div>
    );

    return (
      <div style={{ width: 340, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 0.6 }}>
            {t("chat.runtimeStatusWindow", "上下文窗口")}
          </span>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 18, fontWeight: 600, color: "#fff" }}>
              {formatTokenCount(runtimeStatus.used_tokens)}/{formatTokenCount(runtimeStatus.context_window_tokens)} {t("chat.runtimeStatusTokens", "个令牌")}
            </span>
            <span style={{ fontSize: 18, fontWeight: 700, color: runtimeStatus.used_ratio >= 0.8 ? "#ff7875" : "#95de64" }}>
              {(runtimeStatus.used_ratio * 100).toFixed(1)}%
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.min(100, runtimeStatus.used_ratio * 100)}%`,
                height: "100%",
                background: runtimeStatus.used_ratio >= 0.8 ? "#ff7875" : "linear-gradient(90deg, #69b1ff, #95de64)",
              }}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(255,255,255,0.72)" }}>
            <span>{t("chat.runtimeStatusReserved", "保留用于响应")}</span>
            <span>{formatTokenCount(runtimeStatus.reserved_response_tokens)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "rgba(255,255,255,0.72)" }}>
            <span>{t("chat.runtimeStatusRemaining", "剩余可用")}</span>
            <span>{formatTokenCount(runtimeStatus.remaining_tokens)}</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 0.6 }}>
            {t("chat.runtimeStatusSystem", "System")}
          </span>
          {systemItems.map((item) => renderItem(item.label, item.tokens, item.ratio))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 0.6 }}>
            {t("chat.runtimeStatusUserContext", "User Context")}
          </span>
          {userItems.map((item) => renderItem(item.label, item.tokens, item.ratio))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgba(255,255,255,0.5)" }}>
          <span>{runtimeStatus.profile_label}</span>
          <span>{runtimeStatus.model_id || runtimeStatus.provider_id || "unknown"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>
            {t("chat.runtimeStatusSource", "统计来源")}
          </span>
          <span
            style={{
              color: statusSourceColor,
              fontWeight: 600,
            }}
          >
            {statusSourceLabel}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>
            {t("chat.runtimeStatusUpdatedAt", "上次更新时间")}
          </span>
          <span style={{ color: "rgba(255,255,255,0.72)" }}>
            {lastUpdatedLabel}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11 }}>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>
            {t("chat.runtimeStatusSampling", "采集状态")}
          </span>
          <span
            title={runtimeStatusError || undefined}
            style={{ color: samplingStatusColor }}
          >
            {samplingStatusLabel}
          </span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: 0.6 }}>
            {t("chat.runtimeStatusSnapshotMeta", "Snapshot Boundary")}
          </span>
          {renderMetaRow(t("chat.runtimeStatusSnapshotSource", "后端源"), snapshotSourceRawLabel, "runtime-status-meta-source")}
          {renderMetaRow(t("chat.runtimeStatusSnapshotStage", "采样阶段"), snapshotStageLabel, "runtime-status-meta-stage")}
          {renderMetaRow(t("chat.runtimeStatusSnapshotScope", "归属层级"), snapshotScopeLabel, "runtime-status-meta-scope")}
          {renderMetaRow(t("chat.runtimeStatusSnapshotAgent", "Agent"), snapshotAgentLabel, "runtime-status-meta-agent")}
          {renderMetaRow(t("chat.runtimeStatusSnapshotChat", "Chat"), snapshotChatLabel, "runtime-status-meta-chat")}
        </div>
      </div>
    );
  }, [
    lastRuntimeStatusUpdatedAt,
    runtimeStatus,
    runtimeStatusError,
    runtimeStatusFromApi,
    runtimeStatusMeta,
    transientMessages,
    t,
  ]);

  const runtimeTriggerTone = runtimeStatusError
    ? "#ff7875"
    : runtimeStatusFromApi?.snapshot_source === "empty_baseline"
      ? "#faad14"
      : lastRuntimeStatusUpdatedAt
      ? "#95de64"
      : isDark
        ? "rgba(255,255,255,0.88)"
        : "rgba(0,0,0,0.88)";

  const runtimeTriggerLabel = runtimeStatusError
    ? t("chat.runtimeStatusErrorShort", "异常")
    : runtimeStatusFromApi?.snapshot_source === "empty_baseline"
      ? t("chat.runtimeStatusPendingShort", "等待")
      : lastRuntimeStatusUpdatedAt
      ? t("chat.runtimeStatusHealthyShort", "正常")
      : t("chat.runtimeStatusPendingShort", "等待");

  const historyPopoverContent = useMemo(() => {
    if (historyLoading) {
      return (
        <div style={{ display: "flex", justifyContent: "center", padding: "16px 8px" }}>
          <Spin size="small" />
        </div>
      );
    }

    if (historyChats.length === 0) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("chat.historyEmpty", "No history chats")}
        />
      );
    }

    return (
      <div className={styles.historyPopover}>
        {historyChats.map((chat) => {
          const title = (chat.name || chat.session_id || chat.id || "").trim() || t("chat.untitled", "Untitled chat");
          const updatedAt = formatLocalDateTime(chat.updated_at || chat.created_at || "");
          const isActive = chat.id === sessionId;
          return (
            <Button
              key={chat.id}
              type={isActive ? "primary" : "text"}
              style={{ justifyContent: "flex-start", height: "auto", paddingBlock: 8, textAlign: "left" }}
              onClick={() => {
                if (!onSelectHistoryChat) {
                  message.warning(
                    t(
                      "chat.historySwitchUnavailable",
                      "Current page does not support switching history chats.",
                    ),
                  );
                  return;
                }
                onSelectHistoryChat(chat.id);
                setHistoryPopoverOpen(false);
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    width: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {title}
                </span>
                <span style={{ fontSize: 11, opacity: 0.72 }}>
                  {updatedAt || t("chat.unknownTime", "Unknown time")}
                </span>
              </div>
            </Button>
          );
        })}
        {onHistoryMenuAction ? (
          <>
            <div
              style={{
                borderTop: "1px solid var(--ant-color-border-secondary)",
                marginTop: 8,
                paddingTop: 8,
              }}
            >
              <Button
                type="link"
                size="small"
                style={{ width: "100%", textAlign: "left", paddingInline: 0 }}
                onClick={() => {
                  onHistoryMenuAction();
                  setHistoryPopoverOpen(false);
                }}
              >
                {historyMenuActionLabel || t("projects.chat.manualRecover", "手动恢复对话关联")}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    );
  }, [
    historyChats,
    historyLoading,
    historyMenuActionLabel,
    onHistoryMenuAction,
    onSelectHistoryChat,
    sessionId,
    t,
  ]);

  return (
    <div
      className={`${hostClassName} copaw-chat-anywhere-layout ${styles.anywhereLayout}`}
    >
      <div
        className={`copaw-chat-anywhere-header ${styles.header}`}
      >
        <div className={styles.headerLeft}>
          <span className={styles.chatName} title={currentChatName}>
            {currentChatName || t("chat.newChat", "New Chat")}
          </span>
        </div>
        <div className={styles.headerRight}>
          <ModelSelector />
          <Popover
            trigger="click"
            placement="bottomRight"
            open={runtimeStatusOpen}
            onOpenChange={(open) => {
              setRuntimeStatusOpen(open);
            }}
            content={runtimeStatusContent}
            styles={{
              body: {
                borderRadius: 12,
                background: isDark ? "rgba(20,22,28,0.96)" : "rgba(20,22,28,0.96)",
                boxShadow: "0 16px 48px rgba(0,0,0,0.24)",
                padding: 14,
              },
            }}
          >
            <Button
              data-testid="runtime-status-trigger"
              size="small"
              type="text"
              aria-label={t("chat.runtimeStatus", "运行状态")}
              title={runtimeStatusError || undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.12)",
                background: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)",
                color: runtimeTriggerTone,
                paddingInline: 10,
              }}
            >
              <DashboardOutlined />
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                {(runtimeStatus.used_ratio * 100).toFixed(1)}%
              </span>
              <span style={{ fontSize: 11, fontWeight: 500 }}>
                {runtimeTriggerLabel}
              </span>
            </Button>
          </Popover>
          <Tooltip title={t("chat.newChat", "New Chat")} mouseEnterDelay={0.3}>
            <IconButton
              bordered={false}
              icon={<SparkNewChatFill />}
              onClick={onNewChat}
              aria-label={t("chat.newChat", "New Chat")}
            />
          </Tooltip>
          <Popover
            trigger="click"
            placement="bottomRight"
            open={historyPopoverOpen}
            onOpenChange={(open) => {
              setHistoryPopoverOpen(open);
              if (open) {
                void loadHistoryChats();
              }
            }}
            content={historyPopoverContent}
          >
            <Tooltip title={t("chat.historyChat", "History Chats")} mouseEnterDelay={0.3}>
              <IconButton
                bordered={false}
                icon={<SparkHistoryLine />}
                aria-label={t("chat.historyChat", "History Chats")}
              />
            </Tooltip>
          </Popover>
        </div>
      </div>
      <div
        className={`copaw-chat-anywhere-chat ${styles.chatArea}`}
      >
        <AgentScopeRuntimeWebUI
          ref={chatRef}
          key={`${sessionId}-${refreshKey}`}
          options={options}
        />
        {isLastVisibleMessageUser && recoveredTailUserDraft && tailUserActionHost
          ? createPortal(
              <div className={styles.lastUserActionRow}>
                <Button
                  size="small"
                  type="text"
                  icon={<DeleteOutlined />}
                  onClick={handleRestoreTailUserDraft}
                  loading={isDeletingTailUser}
                >
                  {t("chat.deleteLastUserAndRestoreDraft", "删除")}
                </Button>
              </div>,
              tailUserActionHost,
            )
          : null}
      </div>
    </div>
  );
}