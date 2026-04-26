import {
  AgentScopeRuntimeWebUI,
  IAgentScopeRuntimeWebUIOptions,
  type IAgentScopeRuntimeWebUISession,
  type IAgentScopeRuntimeWebUIMessage,
  type IAgentScopeRuntimeWebUIRef,
  Stream,
} from "@agentscope-ai/chat";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Empty, Modal, Popover, Result, Spin, Switch, Tooltip } from "antd";
import { useAppMessage } from "../../hooks/useAppMessage";
import { ExclamationCircleOutlined, SettingOutlined } from "@ant-design/icons";
import {
  SparkAttachmentLine,
  SparkCopyLine,
  SparkHistoryLine,
  SparkNewChatFill,
} from "@agentscope-ai/icons";
import { usePlugins } from "../../plugins/PluginContext";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import sessionApi from "./sessionApi";
import defaultConfig, { getDefaultConfig } from "./OptionsPanel/defaultConfig";
import { chatApi } from "../../api/modules/chat";
import { agentApi } from "../../api/modules/agent";
import { buildAuthHeaders } from "../../api/authHeaders";
import { getApiUrl } from "../../api/config";
import { providerApi } from "../../api/modules/provider";
import type { AgentsRunningConfig } from "../../api/types";
import type { ProviderInfo, ModelInfo } from "../../api/types";
import ModelSelector from "./ModelSelector";
import { useTheme } from "../../contexts/ThemeContext";
import { useAgentStore } from "../../stores/agentStore";
import AgentScopeRuntimeResponseBuilder from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/Response/Builder.js";
import { AgentScopeRuntimeRunStatus } from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/AgentScopeRuntime/types.js";
import { trackNavigation } from "../../utils/navigationTelemetry";
import { useChatAnywhereInput } from "@agentscope-ai/chat/lib/AgentScopeRuntimeWebUI/core/Context/ChatAnywhereInputContext.js";
import styles from "./index.module.less";
import { IconButton } from "@agentscope-ai/design";
import {
  toDisplayUrl,
  copyText,
  extractCopyableText,
  buildModelError,
  normalizeContentUrls,
  extractUserMessageText,
  extractTextFromMessage,
  setTextareaValue,
  type RuntimeLoadingBridgeApi,
} from "./utils";
import { materializeThinkingOnlyFallback } from "../../utils/runtimeResponseFallback";
import { shouldAutoContinueResponse } from "../../utils/chatAutoContinue";

type CopyableContent = {
  type?: string;
  text?: string;
  refusal?: string;
};

type CopyableMessage = {
  role?: string;
  content?: string | CopyableContent[];
};

type CopyableResponse = {
  output?: CopyableMessage[];
};

type RuntimeUiMessage = IAgentScopeRuntimeWebUIMessage & {
  msgStatus?: string;
  role?: string;
  cards?: Array<{
    code: string;
    data: unknown;
  }>;
  history?: boolean;
};

type StreamResponseData = {
  status?: string;
  output?: Array<{
    content?: unknown[];
  }>;
};

const CHAT_ATTACHMENT_MAX_MB = 10;
const AUTO_CONTINUE_MAX_ATTEMPTS = 2;
const AUTO_CONTINUE_MIN_INCREMENT_CHARS = 32;

interface SessionInfo {
  session_id?: string;
  user_id?: string;
  channel?: string;
}

type SessionContext = {
  session_id?: string;
  user_id?: string;
  channel?: string;
};

type ChatInputContentPart = {
  type?: string;
  text?: string;
  image_url?: string;
  file_url?: string;
  audio_url?: string;
  video_url?: string;
  data?: string;
  [key: string]: unknown;
};

type ChatInputItem = {
  session?: SessionContext;
  content?: ChatInputContentPart[];
  [key: string]: unknown;
};

type RequestInputMessage = ChatInputItem & {
  role?: string;
};

type BizParams = Record<string, unknown> & {
  reconnect?: boolean;
  continue_mode?: boolean;
  auto_continue?: boolean;
};

type CustomFetchData = {
  input?: ChatInputItem[];
  biz_params?: BizParams;
  signal?: AbortSignal;
  reconnect?: boolean;
  session_id?: string;
  user_id?: string;
  channel?: string;
};

type AttachmentTriggerProps = {
  disabled?: boolean;
};

type SenderConfigShape = {
  sender?: Record<string, unknown>;
};

interface CustomWindow extends Window {
  currentSessionId?: string;
  currentUserId?: string;
  currentChannel?: string;
}

declare const window: CustomWindow;

interface CommandSuggestion {
  command: string;
  value: string;
  description: string;
}

type HeaderSession = Pick<IAgentScopeRuntimeWebUISession, "id" | "name"> & {
  createdAt?: string | null;
  created_at?: string | null;
  updatedAt?: string | null;
  updated_at?: string | null;
};

const DEFAULT_CHAT_TITLE = "New Chat";
const HEADER_TITLE_TARGET_LEN = 20;

function formatLocalDateTime(raw?: string | null): string {
  if (!raw) return "";
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return raw;
  return new Date(ts).toLocaleString([], {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function trimSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function clipReadableTitle(raw: string, maxLen = HEADER_TITLE_TARGET_LEN): string {
  const text = trimSingleLine(raw);
  if (!text) return "";
  if (text.length <= maxLen) return text;

  const window = text.slice(0, maxLen + 1);
  const punctPositions = ["。", "！", "？", "；", ".", "!", "?", ";", ",", "，", "、"]
    .map((token) => window.lastIndexOf(token))
    .filter((idx) => idx >= 0);
  const lastPunct = punctPositions.length > 0 ? Math.max(...punctPositions) : -1;
  if (lastPunct >= Math.floor(maxLen * 0.6)) {
    return window.slice(0, lastPunct + 1).trim();
  }

  const lastSpace = window.lastIndexOf(" ");
  if (lastSpace >= Math.floor(maxLen * 0.6)) {
    return window.slice(0, lastSpace).trim();
  }

  return text.slice(0, maxLen).trim();
}

function extractUserTextFromSessionMessages(
  messages: unknown,
): string {
  if (!Array.isArray(messages)) return "";

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as {
      role?: string;
      content?: unknown;
      cards?: Array<{ data?: { input?: Array<{ content?: unknown }> } }>;
    };
    if (message?.role !== "user") continue;

    if (typeof message.content === "string") {
      const plain = trimSingleLine(message.content);
      if (plain) return plain;
    }

    if (Array.isArray(message.content)) {
      const fromContent = trimSingleLine(extractUserMessageText({ content: message.content }));
      if (fromContent) return fromContent;
    }

    const cardInputContent = message.cards?.[0]?.data?.input?.[0]?.content;
    if (typeof cardInputContent === "string") {
      const fromCard = trimSingleLine(cardInputContent);
      if (fromCard) return fromCard;
    }
    if (Array.isArray(cardInputContent)) {
      const fromCard = trimSingleLine(extractUserMessageText({ content: cardInputContent }));
      if (fromCard) return fromCard;
    }
  }

  return "";
}

function renderSuggestionLabel(command: string, description: string) {
  return (
    <div className={styles.suggestionLabel}>
      <span className={styles.suggestionCommand}>{command}</span>
      <span className={styles.suggestionDescription}>{description}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_USER_ID = "default";
const DEFAULT_CHANNEL = "console";

// ---------------------------------------------------------------------------
// Custom hooks
// ---------------------------------------------------------------------------

/** Handle IME composition events to prevent premature Enter key submission. */
function useIMEComposition(isChatActive: () => boolean) {
  const isComposingRef = useRef(false);

  useEffect(() => {
    const handleCompositionStart = () => {
      if (!isChatActive()) return;
      isComposingRef.current = true;
    };

    const handleCompositionEnd = () => {
      if (!isChatActive()) return;
      // Small delay for Safari on macOS, which fires keydown after
      // compositionend within the same event loop tick.  Keep this as
      // short as possible so fast typists who hit Space+Enter in quick
      // succession are not blocked.
      setTimeout(() => {
        isComposingRef.current = false;
      }, 50);
    };

    const suppressImeEnter = (e: KeyboardEvent) => {
      if (!isChatActive()) return;
      const target = e.target as HTMLElement;
      const composingEvent = e as KeyboardEvent & { isComposing?: boolean };
      if (target?.tagName === "TEXTAREA" && e.key === "Enter" && !e.shiftKey) {
        // e.isComposing is the standard flag; isComposingRef covers the
        // post-compositionend grace period needed by Safari.
        if (isComposingRef.current || Boolean(composingEvent.isComposing)) {
          e.stopPropagation();
          e.stopImmediatePropagation();
          e.preventDefault();
          return false;
        }
      }
    };

    document.addEventListener("compositionstart", handleCompositionStart, true);
    document.addEventListener("compositionend", handleCompositionEnd, true);
    // Listen on both keydown (Safari) and keypress (legacy) in capture phase.
    document.addEventListener("keydown", suppressImeEnter, true);
    document.addEventListener("keypress", suppressImeEnter, true);

    return () => {
      document.removeEventListener(
        "compositionstart",
        handleCompositionStart,
        true,
      );
      document.removeEventListener(
        "compositionend",
        handleCompositionEnd,
        true,
      );
      document.removeEventListener("keydown", suppressImeEnter, true);
      document.removeEventListener("keypress", suppressImeEnter, true);
    };
  }, [isChatActive]);

  return isComposingRef;
}

/** Fetch and track multimodal capabilities for the active model. */
function useMultimodalCapabilities(
  refreshKey: number,
  locationPathname: string,
  isChatActive: () => boolean,
  selectedAgent: string,
) {
  const [multimodalCaps, setMultimodalCaps] = useState<{
    supportsMultimodal: boolean;
    supportsImage: boolean;
    supportsVideo: boolean;
  }>({ supportsMultimodal: false, supportsImage: false, supportsVideo: false });

  const fetchMultimodalCaps = useCallback(async () => {
    try {
      const [providers, activeModels] = await Promise.all([
        providerApi.listProviders(),
        providerApi.getActiveModels({
          scope: "effective",
          agent_id: selectedAgent,
        }),
      ]);
      const activeProviderId = activeModels?.active_llm?.provider_id;
      const activeModelId = activeModels?.active_llm?.model;
      if (!activeProviderId || !activeModelId) {
        setMultimodalCaps({
          supportsMultimodal: false,
          supportsImage: false,
          supportsVideo: false,
        });
        return;
      }
      const provider = (providers as ProviderInfo[]).find(
        (p) => p.id === activeProviderId,
      );
      if (!provider) {
        setMultimodalCaps({
          supportsMultimodal: false,
          supportsImage: false,
          supportsVideo: false,
        });
        return;
      }
      const allModels: ModelInfo[] = [
        ...(provider.models ?? []),
        ...(provider.extra_models ?? []),
      ];
      const model = allModels.find((m) => m.id === activeModelId);
      setMultimodalCaps({
        supportsMultimodal: model?.supports_multimodal ?? false,
        supportsImage: model?.supports_image ?? false,
        supportsVideo: model?.supports_video ?? false,
      });
    } catch {
      setMultimodalCaps({
        supportsMultimodal: false,
        supportsImage: false,
        supportsVideo: false,
      });
    }
  }, [selectedAgent]);

  // Fetch caps on mount and whenever refreshKey changes
  useEffect(() => {
    fetchMultimodalCaps();
  }, [fetchMultimodalCaps, refreshKey]);

  // Also poll caps when navigating back to chat
  useEffect(() => {
    if (isChatActive()) {
      fetchMultimodalCaps();
    }
  }, [locationPathname, fetchMultimodalCaps, isChatActive]);

  // Listen for model-switched event from ModelSelector
  useEffect(() => {
    const handler = () => {
      fetchMultimodalCaps();
    };
    window.addEventListener("model-switched", handler);
    return () => window.removeEventListener("model-switched", handler);
  }, [fetchMultimodalCaps]);

  return multimodalCaps;
}

function cloneRuntimeMessages(
  messages: RuntimeUiMessage[],
): RuntimeUiMessage[] {
  return JSON.parse(JSON.stringify(messages)) as RuntimeUiMessage[];
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

function extractAssistantTextFromResponse(
  response: StreamResponseData | null,
): string {
  if (!response?.output?.length) {
    return "";
  }

  const chunks: string[] = [];
  for (const message of response.output) {
    if (!Array.isArray(message?.content)) {
      continue;
    }
    for (const part of message.content as Array<Record<string, unknown>>) {
      const text =
        typeof part?.text === "string"
          ? part.text
          : typeof part?.refusal === "string"
            ? part.refusal
            : "";
      if (text) {
        chunks.push(text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function buildAssistantTailFingerprint(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(-240);
}

function getResponseCardData(
  message?: RuntimeUiMessage,
): StreamResponseData | null {
  const responseCard = message?.cards?.find(
    (card) => card.code === "AgentScopeRuntimeResponseCard",
  );

  if (!responseCard?.data) {
    return null;
  }

  return cloneValue(responseCard.data as StreamResponseData);
}

function getStreamingAssistantMessageId(
  messages: RuntimeUiMessage[],
): string | null {
  return (
    [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" &&
          (message.msgStatus === "generating" ||
            (message.cards?.length ?? 0) === 0),
      )?.id ||
    [...messages].reverse().find((message) => message.role === "assistant")
      ?.id ||
    null
  );
}

function useMessageHistoryNavigation(
  chatRef: React.RefObject<IAgentScopeRuntimeWebUIRef | null>,
  isChatActive: () => boolean,
  isComposingRef: React.RefObject<boolean>,
) {
  const historyIndexRef = useRef<number>(-1);
  const draftRef = useRef<string>("");

  const getUserMessagesWithText = useCallback((): string[] => {
    if (!chatRef.current?.messages?.getMessages) return [];

    const allMessages = chatRef.current.messages.getMessages();
    if (!Array.isArray(allMessages)) return [];

    return allMessages
      .filter((msg) => msg.role === "user")
      .map((msg) => extractTextFromMessage(msg))
      .filter((text) => text.trim().length > 0);
  }, [chatRef]);

  interface MessageResult {
    index: number;
    text: string;
  }

  const findMessageInDirection = useCallback(
    (
      messages: string[],
      startIndex: number,
      direction: 1 | -1,
    ): MessageResult | null => {
      const MAX_LOOKUP = 100;
      let lookupIndex = startIndex;
      let steps = 0;

      while (
        lookupIndex >= 0 &&
        lookupIndex < messages.length &&
        steps < MAX_LOOKUP
      ) {
        const messageText = messages[messages.length - 1 - lookupIndex];
        if (messageText) {
          return { index: lookupIndex, text: messageText };
        }
        lookupIndex += direction;
        steps += 1;
      }

      return null;
    },
    [],
  );

  const isSuggestionPopupOpen = (textarea: HTMLTextAreaElement): boolean =>
    textarea.value.startsWith("/");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isChatActive()) return;

      const target = e.target as HTMLElement;
      const isChatSender =
        target?.tagName === "TEXTAREA" &&
        target?.closest('[class*="sender"]') !== null;

      if (!isChatSender) return;
      const composingEvent = e as KeyboardEvent & { isComposing?: boolean };
      if (isComposingRef.current || composingEvent.isComposing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const textarea = target as HTMLTextAreaElement;
      const hasSelection = textarea.selectionStart !== textarea.selectionEnd;
      if (hasSelection) return;

      const userMessages = getUserMessagesWithText();

      if (e.key === "ArrowUp") {
        if (isSuggestionPopupOpen(textarea)) return;

        const cursorPosition = textarea.selectionStart || 0;
        const textBeforeCursor = textarea.value.substring(0, cursorPosition);
        const lineBreaks = textBeforeCursor.split("\n").length - 1;
        if (lineBreaks > 0) return;

        if (userMessages.length === 0) return;

        if (historyIndexRef.current === -1) {
          draftRef.current = textarea.value;
        }

        const startIndex = historyIndexRef.current + 1;
        const messageText = findMessageInDirection(userMessages, startIndex, 1);

        if (messageText) {
          e.preventDefault();
          historyIndexRef.current = messageText.index;
          setTextareaValue(textarea, messageText.text);
        }
      } else if (e.key === "ArrowDown") {
        if (historyIndexRef.current < 0) return;

        const cursorPosition = textarea.selectionStart || 0;
        const textAfterCursor = textarea.value.substring(cursorPosition);
        if (textAfterCursor.includes("\n")) return;

        const startIndex = historyIndexRef.current - 1;
        const messageText = findMessageInDirection(
          userMessages,
          startIndex,
          -1,
        );

        if (messageText) {
          e.preventDefault();
          historyIndexRef.current = messageText.index;
          setTextareaValue(textarea, messageText.text);
        } else {
          e.preventDefault();
          historyIndexRef.current = -1;
          setTextareaValue(textarea, draftRef.current);
        }
      }
    };

    const handleFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      const isChatSender =
        target?.tagName === "TEXTAREA" &&
        target?.closest('[class*="sender"]') !== null;

      if (isChatSender) {
        historyIndexRef.current = -1;
        draftRef.current = "";
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocus, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocus, true);
    };
  }, [
    isChatActive,
    isComposingRef,
    getUserMessagesWithText,
    findMessageInDirection,
  ]);
}

function RuntimeLoadingBridge({
  bridgeRef,
}: {
  bridgeRef: { current: RuntimeLoadingBridgeApi | null };
}) {
  const { setLoading, getLoading } = useChatAnywhereInput(
    (value: {
      setLoading?: (loading: boolean | string) => void;
      getLoading?: () => boolean | string;
    }) =>
      ({
        setLoading: value.setLoading,
        getLoading: value.getLoading,
      }) as RuntimeLoadingBridgeApi,
  );

  useEffect(() => {
    if (!setLoading || !getLoading) {
      bridgeRef.current = null;
      return;
    }

    bridgeRef.current = {
      setLoading,
      getLoading,
    };

    return () => {
      if (bridgeRef.current?.setLoading === setLoading) {
        bridgeRef.current = null;
      }
    };
  }, [getLoading, setLoading, bridgeRef]);

  return null;
}

function extractLatestUserText(input: ChatInputItem[] = []): string {
  const latest = input[input.length - 1];
  const content = latest?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item?.type === "text" && typeof item?.text === "string")
    .map((item) => item.text as string)
    .join("\n")
    .trim();
}

function shouldSuggestPipelineOpportunity(text: string): boolean {
  if (!text) return false;
  if (text.length < 16) return false;
  const patterns = [
    /多步|流程|pipeline|管线/i,
    /批量|自动化|反复|复用/i,
    /抽取|对齐|校验|分析|报告/i,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

function isPipelineDesignBootstrapText(text: string): boolean {
  if (!text) return false;
  return (
    text.includes("pipeline-create-guide") ||
    text.includes("我想创建一个新的 Pipeline") ||
    text.includes("模板设计模式") ||
    text.includes("I want to create a new Pipeline")
  );
}

function buildPipelineOpportunityInlineHint(): string {
  return [
    "",
    "[PipelineDesignHint]",
    "当前场景是模板设计模式，不是任务执行。不要搜索真实文件、不要扫描目录。",
    "请按 4 项槽位补齐：流程用途、输入来源、期望产物、步骤线索；若用户已提供则不要重复追问。",
    "如果当前会话已绑定流程 Markdown 工作文件，请优先直接修改该 Markdown 文件，不要输出 JSON 草稿。",
    "继续在当前会话中迭代，不要要求用户切换到新会话。",
  ].join("\n");
}

type ReconnectableSession = {
  sessionId?: string;
  userId?: string;
  channel?: string;
  messages?: RuntimeUiMessage[];
};

export default function ChatPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { isDark } = useTheme();
  const chatId = useMemo(() => {
    const match = location.pathname.match(/^\/chat\/(.+)$/);
    return match?.[1];
  }, [location.pathname]);
  const [showModelPrompt, setShowModelPrompt] = useState(false);
  const { selectedAgent } = useAgentStore();
  const { toolRenderConfig } = usePlugins();
  const [refreshKey, setRefreshKey] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historySessions, setHistorySessions] = useState<HeaderSession[]>([]);
  const [currentChatNameOverride, setCurrentChatNameOverride] = useState("");
  const [autoContinueEnabled, setAutoContinueEnabled] = useState<boolean>(true);
  const [runningConfigSnapshot, setRunningConfigSnapshot] =
    useState<AgentsRunningConfig | null>(null);
  const [savingAutoContinue, setSavingAutoContinue] = useState(false);
  const [, setChatStatus] = useState<"idle" | "running">("idle");
  const [, setReconnectStreaming] = useState(false);
  const runtimeLoadingBridgeRef = useRef<RuntimeLoadingBridgeApi | null>(null);
  const { message } = useAppMessage();
  const autoContinueEnabledRef = useRef(autoContinueEnabled);
  const autoContinueAttemptsRef = useRef<Record<string, number>>({});
  const autoContinueInFlightRef = useRef<Record<string, boolean>>({});
  const autoContinueTailRef = useRef<Record<string, string>>({});

  const isChatActiveRef = useRef(false);
  isChatActiveRef.current =
    location.pathname === "/" || location.pathname.startsWith("/chat");

  const isChatActive = useCallback(() => isChatActiveRef.current, []);

  // Use custom hooks for better separation of concerns
  const isComposingRef = useIMEComposition(isChatActive);
  const multimodalCaps = useMultimodalCapabilities(
    refreshKey,
    location.pathname,
    isChatActive,
    selectedAgent,
  );

  const lastSessionIdRef = useRef<string | null>(null);
  const reconnectAttemptedSessionIdRef = useRef<string | null>(null);
  /** Tracks the stale auto-selected session ID that was skipped on init, so we can suppress its late-arriving onSessionSelected callback. */
  const staleAutoSelectedIdRef = useRef<string | null>(null);
  const chatIdRef = useRef(chatId);
  const navigateRef = useRef(navigate);
  const pendingNavigationTargetRef = useRef<string | null>(null);
  const chatRef = useRef<IAgentScopeRuntimeWebUIRef>(null);

  useMessageHistoryNavigation(chatRef, isChatActive, isComposingRef);
  chatIdRef.current = chatId;
  navigateRef.current = navigate;

  useEffect(() => {
    autoContinueEnabledRef.current = autoContinueEnabled;
  }, [autoContinueEnabled]);

  useEffect(() => {
    let cancelled = false;
    const loadRunningConfig = async () => {
      try {
        const runtimeConfig = await agentApi.getAgentRunningConfig();
        if (!cancelled) {
          setRunningConfigSnapshot(runtimeConfig ?? null);
          setAutoContinueEnabled(runtimeConfig?.auto_continue_enabled ?? true);
        }
      } catch {
        if (!cancelled) {
          setRunningConfigSnapshot(null);
          setAutoContinueEnabled(true);
        }
      }
    };

    void loadRunningConfig();
    return () => {
      cancelled = true;
    };
  }, [selectedAgent]);

  const handleAutoContinueToggle = useCallback(
    async (checked: boolean) => {
      if (!runningConfigSnapshot || savingAutoContinue) {
        return;
      }

      setSavingAutoContinue(true);
      try {
        const savedConfig = await agentApi.updateAgentRunningConfig({
          ...runningConfigSnapshot,
          auto_continue_enabled: checked,
        });
        setRunningConfigSnapshot(savedConfig);
        setAutoContinueEnabled(savedConfig?.auto_continue_enabled ?? checked);
        message.success(
          checked
            ? t("chat.autoContinue.enabled", "自动继续生成已开启")
            : t("chat.autoContinue.disabled", "自动继续生成已关闭"),
        );
      } catch (error) {
        message.error(
          error instanceof Error
            ? error.message
            : t("agentConfig.saveFailed", "配置保存失败"),
        );
      } finally {
        setSavingAutoContinue(false);
      }
    },
    [message, runningConfigSnapshot, savingAutoContinue, t],
  );

  const scheduleReplaceNavigation = useCallback((target: string) => {
    pendingNavigationTargetRef.current = target;
    queueMicrotask(() => {
      if (pendingNavigationTargetRef.current !== target) {
        return;
      }
      pendingNavigationTargetRef.current = null;
      navigateRef.current(target, { replace: true });
    });
  }, []);

  useEffect(() => {
    sessionApi.setChatRef(chatRef);
    return () => sessionApi.setChatRef(null);
  }, []);

  // Tell sessionApi which session to put first in getSessionList, so the library's
  // useMount auto-selects the correct session without an extra getSession round-trip.
  useEffect(() => {
    if (chatId && sessionApi.preferredChatId !== chatId) {
      sessionApi.preferredChatId = chatId;
    }
  }, [chatId]);

  // Register session API event callbacks for URL synchronization

  useEffect(() => {
    sessionApi.onSessionIdResolved = (realId) => {
      if (!isChatActiveRef.current) return;
      // Update URL when realId is resolved, regardless of current chatId
      // (chatId may be undefined if URL was cleared in onSessionCreated)
      lastSessionIdRef.current = realId;
      scheduleReplaceNavigation(`/chat/${realId}`);
    };

    sessionApi.onSessionRemoved = (removedId) => {
      if (!isChatActiveRef.current) return;
      // Clear URL when current session is removed
      // Check if removed session matches current session (by realId or sessionId)
      const currentRealId = sessionApi.getRealIdForSession(
        chatIdRef.current || "",
      );
      if (chatIdRef.current === removedId || currentRealId === removedId) {
        lastSessionIdRef.current = null;
        trackNavigation({
          source: "chat.onSessionRemoved",
          from: `/chat/${removedId}`,
          to: "/chat",
          reason: "removed-current-session",
        });
        scheduleReplaceNavigation("/chat");
      }
    };

    sessionApi.onSessionSelected = (
      sessionId: string | null | undefined,
      realId: string | null,
    ) => {
      if (!isChatActiveRef.current) return;
      // Update URL when session is selected and different from current
      const targetId = realId || sessionId;
      if (!targetId) return;

      // If a preferred chatId from the URL exists and no navigation has happened yet,
      // skip the library's initial auto-selection (always first session).
      // ChatSessionInitializer will apply the correct selection afterward.
      if (
        chatIdRef.current &&
        lastSessionIdRef.current === null &&
        targetId !== chatIdRef.current
      ) {
        lastSessionIdRef.current = targetId;
        // Record the stale ID so its delayed getSession callback is also suppressed.
        staleAutoSelectedIdRef.current = targetId;
        return;
      }

      // Suppress the stale getSession callback that arrives after the correct session loads.
      if (
        staleAutoSelectedIdRef.current &&
        staleAutoSelectedIdRef.current === targetId
      ) {
        staleAutoSelectedIdRef.current = null;
        return;
      }

      if (targetId !== lastSessionIdRef.current) {
        lastSessionIdRef.current = targetId;
        scheduleReplaceNavigation(`/chat/${targetId}`);
      }
    };

    sessionApi.onSessionCreated = () => {
      if (!isChatActiveRef.current) return;
      // Clear URL when creating new session, wait for realId resolution to update
      lastSessionIdRef.current = null;
      scheduleReplaceNavigation("/chat");
    };

    return () => {
      sessionApi.onSessionIdResolved = null;
      sessionApi.onSessionRemoved = null;
      sessionApi.onSessionSelected = null;
      sessionApi.onSessionCreated = null;
    };
  }, [scheduleReplaceNavigation]);

  // Setup multimodal capabilities tracking via custom hook

  // Refresh chat when selectedAgent changes, preserving last active chat per agent
  const { setLastChatId, getLastChatId } = useAgentStore();
  const prevSelectedAgentRef = useRef(selectedAgent);
  useEffect(() => {
    const prevAgent = prevSelectedAgentRef.current;
    if (prevAgent !== selectedAgent && prevAgent !== undefined) {
      // Save current chat ID for the agent we're leaving
      const currentChatId =
        chatIdRef.current || lastSessionIdRef.current || undefined;
      if (currentChatId && prevAgent) {
        setLastChatId(prevAgent, currentChatId);
      }

      // Restore last chat ID for the agent we're switching to
      const restored = getLastChatId(selectedAgent);
      if (restored) {
        navigateRef.current(`/chat/${restored}`, { replace: true });
        sessionApi.preferredChatId = restored;
      } else {
        navigateRef.current("/chat", { replace: true });
      }
      lastSessionIdRef.current = null;

      setRefreshKey((prev) => prev + 1);
    }
    prevSelectedAgentRef.current = selectedAgent;
  }, [selectedAgent, setLastChatId, getLastChatId]);

  const getSessionListWrapped = useCallback(async () => {
    const sessions = await sessionApi.getSessionList();
    const currentChatId = chatIdRef.current;

    if (currentChatId) {
      const idx = sessions.findIndex((s) => s.id === currentChatId);
      if (idx > 0) {
        return [
          sessions[idx],
          ...sessions.slice(0, idx),
          ...sessions.slice(idx + 1),
        ];
      }
    }

    return sessions;
  }, []);

  const getSessionWrapped = useCallback(async (sessionId: string) => {
    const currentChatId = chatIdRef.current;

    if (
      isChatActiveRef.current &&
      sessionId &&
      sessionId !== lastSessionIdRef.current &&
      sessionId !== currentChatId
    ) {
      const urlId = sessionApi.getRealIdForSession(sessionId) ?? sessionId;
      lastSessionIdRef.current = urlId;
      trackNavigation({
        source: "chat.getSessionWrapped",
        from: currentChatId ? `/chat/${currentChatId}` : "/chat",
        to: `/chat/${urlId}`,
        reason: "sync-session-selection",
        meta: {
          requestedSessionId: sessionId,
        },
      });
      scheduleReplaceNavigation(`/chat/${urlId}`);
    }

    return sessionApi.getSession(sessionId);
  }, [scheduleReplaceNavigation]);

  const createSessionWrapped = useCallback(
    async (session: Partial<{ id: string }>) => {
    const result = await sessionApi.createSession(session);
    const newSessionId = session?.id || result[0]?.id;
    if (isChatActiveRef.current && newSessionId) {
      lastSessionIdRef.current = newSessionId;
      trackNavigation({
        source: "chat.createSessionWrapped",
        from: chatIdRef.current ? `/chat/${chatIdRef.current}` : "/chat",
        to: `/chat/${newSessionId}`,
        reason: "create-new-session",
      });
      scheduleReplaceNavigation(`/chat/${newSessionId}`);
    }
    return result;
    },
    [scheduleReplaceNavigation],
  );

  const wrappedSessionApi = useMemo(
    () => ({
      getSessionList: getSessionListWrapped,
      getSession: getSessionWrapped,
      createSession: createSessionWrapped,
      updateSession: sessionApi.updateSession.bind(sessionApi),
      removeSession: sessionApi.removeSession.bind(sessionApi),
    }),
    [createSessionWrapped, getSessionListWrapped, getSessionWrapped],
  );

  const loadHistorySessions = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const sessions = (await getSessionListWrapped()) as HeaderSession[];
      setHistorySessions(Array.isArray(sessions) ? sessions : []);
    } catch {
      setHistorySessions([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [getSessionListWrapped]);

  const currentChatName = useMemo(() => {
    const current = historySessions.find((item) => item.id === chatId);
    const baseName = (current?.name || "").trim();
    if (currentChatNameOverride) {
      return currentChatNameOverride;
    }
    if (!baseName || baseName === DEFAULT_CHAT_TITLE) {
      return t("chat.newChat", "New Chat");
    }
    return clipReadableTitle(baseName, HEADER_TITLE_TARGET_LEN);
  }, [chatId, currentChatNameOverride, historySessions, t]);

  const handleStartNewChat = useCallback(async () => {
    const localId = String(Date.now());
    await createSessionWrapped({ id: localId });
    setHistoryOpen(false);
    void loadHistorySessions();
  }, [createSessionWrapped, loadHistorySessions]);

  useEffect(() => {
    void loadHistorySessions();
  }, [chatId, loadHistorySessions]);

  useEffect(() => {
    setCurrentChatNameOverride("");
  }, [chatId]);

  useEffect(() => {
    let cancelled = false;

    const hydrateCurrentTitle = async () => {
      if (!chatId) {
        setCurrentChatNameOverride("");
        return;
      }

      const current = historySessions.find((item) => item.id === chatId);
      const baseName = (current?.name || "").trim();
      const baseNameUsable =
        baseName &&
        baseName !== DEFAULT_CHAT_TITLE &&
        baseName.length >= Math.floor(HEADER_TITLE_TARGET_LEN * 0.6);

      if (baseNameUsable) {
        setCurrentChatNameOverride(clipReadableTitle(baseName, HEADER_TITLE_TARGET_LEN));
        return;
      }

      try {
        const session = (await sessionApi.getSession(chatId)) as { messages?: unknown };
        if (cancelled) return;
        const userText = extractUserTextFromSessionMessages(session?.messages);
        setCurrentChatNameOverride(
          userText
            ? clipReadableTitle(userText, HEADER_TITLE_TARGET_LEN)
            : clipReadableTitle(baseName || t("chat.newChat", "New Chat"), HEADER_TITLE_TARGET_LEN),
        );
      } catch {
        if (cancelled) return;
        setCurrentChatNameOverride(clipReadableTitle(baseName || t("chat.newChat", "New Chat"), HEADER_TITLE_TARGET_LEN));
      }
    };

    void hydrateCurrentTitle();

    return () => {
      cancelled = true;
    };
  }, [chatId, historySessions, t]);

  const copyResponse = useCallback(
    async (response: CopyableResponse) => {
      try {
        await copyText(extractCopyableText(response));
        message.success(t("common.copied"));
      } catch {
        message.error(t("common.copyFailed"));
      }
    },
    [message, t],
  );

  const persistSessionMessages = useCallback(
    async (sessionId: string, messages: RuntimeUiMessage[]) => {
      if (!sessionId) return;
      await sessionApi.updateSession({
        id: sessionId,
        messages: cloneRuntimeMessages(messages),
      });
    },
    [],
  );

  const releaseStaleLoadingState = useCallback((sessionId: string) => {
    const activeChatId = chatIdRef.current;
    const realSessionId = sessionApi.getRealIdForSession(sessionId);
    const isBackgroundSession =
      activeChatId !== sessionId && activeChatId !== realSessionId;

    if (!isBackgroundSession) {
      return;
    }

    if (sessionApi.hasLiveMessagesForSession(activeChatId)) {
      return;
    }

    runtimeLoadingBridgeRef.current?.setLoading?.(false);
  }, []);

  const persistStreamSession = useCallback(
    (sessionId: string, readableStream: ReadableStream<Uint8Array>) => {
      const initialMessages = cloneRuntimeMessages(
        (chatRef.current?.messages.getMessages() as RuntimeUiMessage[]) || [],
      );
      const assistantMessageId =
        getStreamingAssistantMessageId(initialMessages) ||
        `stream-${sessionId}`;
      const responseBuilder = new AgentScopeRuntimeResponseBuilder({
        id: "",
        status: AgentScopeRuntimeRunStatus.Created,
        created_at: 0,
      });

      void (async () => {
        let cachedMessages = initialMessages;
        let hasStreamActivity = false;
        let didReleaseLoading = false;

        try {
          for await (const chunk of Stream({ readableStream })) {
            let chunkData: unknown;
            try {
              chunkData = JSON.parse(chunk.data);
            } catch {
              continue;
            }

            hasStreamActivity = true;
            const responseData = responseBuilder.handle(
              chunkData as never,
            ) as StreamResponseData;
            const renderableResponse = materializeThinkingOnlyFallback(responseData);
            const isFinalChunk = isFinalResponseStatus(responseData.status);
            const existingAssistantMessage = cachedMessages.find(
              (message) => message.id === assistantMessageId,
            );
            const previousResponseData = getResponseCardData(
              existingAssistantMessage,
            );

            let nextResponseData: StreamResponseData | null = null;
            if (hasRenderableOutput(renderableResponse)) {
              nextResponseData = cloneValue(renderableResponse);
            } else if (isFinalChunk && previousResponseData) {
              nextResponseData = {
                ...previousResponseData,
                status: responseData.status ?? previousResponseData.status,
              };
            }

            if (nextResponseData) {
              const assistantMessage: RuntimeUiMessage = {
                ...(existingAssistantMessage || {
                  id: assistantMessageId,
                  role: "assistant",
                }),
                id: assistantMessageId,
                role: "assistant",
                cards: [
                  {
                    code: "AgentScopeRuntimeResponseCard",
                    data: nextResponseData,
                  },
                ],
                msgStatus: isFinalChunk ? "finished" : "generating",
              };

              const assistantIndex = cachedMessages.findIndex(
                (message) => message.id === assistantMessageId,
              );
              cachedMessages =
                assistantIndex >= 0
                  ? [
                      ...cachedMessages.slice(0, assistantIndex),
                      assistantMessage,
                      ...cachedMessages.slice(assistantIndex + 1),
                    ]
                  : [...cachedMessages, assistantMessage];

              await persistSessionMessages(sessionId, cachedMessages);
            }

            if (!isFinalChunk) {
              continue;
            }

            releaseStaleLoadingState(sessionId);
            didReleaseLoading = true;
          }
        } catch (error) {
          console.error("Failed to persist background chat stream:", error);
        } finally {
          if (hasStreamActivity && !didReleaseLoading) {
            releaseStaleLoadingState(sessionId);
          }
        }
      })();
    },
    [persistSessionMessages, releaseStaleLoadingState],
  );

  const reconnectRunningSession = useCallback(async (
    chatSessionId: string,
    session: ReconnectableSession,
  ) => {
      const reconnectSessionId = session.sessionId || window.currentSessionId || "";
      if (!chatSessionId || !reconnectSessionId) {
        return false;
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...buildAuthHeaders(),
      };
      const currentMessages =
        (chatRef.current?.messages.getMessages() as RuntimeUiMessage[]) || [];
      const initialMessages = cloneRuntimeMessages(
        currentMessages.length > 0 ? currentMessages : session.messages || [],
      );
      const assistantMessageId =
        getStreamingAssistantMessageId(initialMessages) ||
        `reconnect-${chatSessionId}`;
      const responseBuilder = new AgentScopeRuntimeResponseBuilder({
        id: "",
        status: AgentScopeRuntimeRunStatus.Created,
        created_at: 0,
      });

      setChatStatus("running");
      setReconnectStreaming(true);
      runtimeLoadingBridgeRef.current?.setLoading?.(true);

      try {
        const res = await fetch(getApiUrl("/console/chat"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            reconnect: true,
            session_id: reconnectSessionId,
            user_id: session.userId ?? window.currentUserId ?? DEFAULT_USER_ID,
            channel: session.channel ?? window.currentChannel ?? DEFAULT_CHANNEL,
          }),
        });

        if (!res.ok || !res.body) {
          if (res.status === 404) {
            try {
              const payload = await res.clone().json();
              if (payload?.detail === "No running chat for this session") {
                setChatStatus("idle");
                runtimeLoadingBridgeRef.current?.setLoading?.(false);
                return true;
              }
            } catch {
              // Ignore parse failures and allow caller to retry later.
            }
          }
          return false;
        }

        let cachedMessages = initialMessages;
        let reachedTerminalState = false;

        for await (const chunk of Stream({ readableStream: res.body })) {
          let chunkData: unknown;
          try {
            chunkData = JSON.parse(chunk.data);
          } catch {
            continue;
          }

          const responseData = responseBuilder.handle(
            chunkData as never,
          ) as StreamResponseData;
          const renderableResponse = materializeThinkingOnlyFallback(responseData);
          const isFinalChunk = isFinalResponseStatus(responseData.status);
          const existingAssistantMessage = cachedMessages.find(
            (message) => message.id === assistantMessageId,
          );
          const previousResponseData = getResponseCardData(
            existingAssistantMessage,
          );

          let nextResponseData: StreamResponseData | null = null;
          if (hasRenderableOutput(renderableResponse)) {
            nextResponseData = cloneValue(renderableResponse);
          } else if (isFinalChunk && previousResponseData) {
            nextResponseData = {
              ...previousResponseData,
              status: responseData.status ?? previousResponseData.status,
            };
          }

          if (!nextResponseData) {
            continue;
          }

          const assistantMessage: RuntimeUiMessage = {
            ...(existingAssistantMessage || {
              id: assistantMessageId,
              role: "assistant",
            }),
            id: assistantMessageId,
            role: "assistant",
            cards: [
              {
                code: "AgentScopeRuntimeResponseCard",
                data: nextResponseData,
              },
            ],
            msgStatus: isFinalChunk ? "finished" : "generating",
          };

          const assistantIndex = cachedMessages.findIndex(
            (message) => message.id === assistantMessageId,
          );
          cachedMessages =
            assistantIndex >= 0
              ? [
                  ...cachedMessages.slice(0, assistantIndex),
                  assistantMessage,
                  ...cachedMessages.slice(assistantIndex + 1),
                ]
              : [...cachedMessages, assistantMessage];

          if (chatIdRef.current === chatSessionId) {
            chatRef.current?.messages.updateMessage(cloneValue(assistantMessage));
          }

          await persistSessionMessages(chatSessionId, cachedMessages);

          if (isFinalChunk) {
            reachedTerminalState = true;
            setChatStatus("idle");
            runtimeLoadingBridgeRef.current?.setLoading?.(false);
          }
        }

        if (!reachedTerminalState) {
          setChatStatus("idle");
          runtimeLoadingBridgeRef.current?.setLoading?.(false);
        }

        return true;
      } catch (error) {
        console.error("Failed to reconnect chat stream:", error);
        return false;
      } finally {
        setReconnectStreaming(false);
      }
    }, [persistSessionMessages]);

  useEffect(() => {
    if (!chatId) {
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let didRefreshHydratedMessages = false;
    const maxAttempts = 24;
    const intervalMs = 1500;

    const pollSessionHydration = async () => {
      if (cancelled) {
        return;
      }

      attempts += 1;

      try {
        const session = await sessionApi.getSession(chatId);
        const messages = (session.messages as RuntimeUiMessage[] | undefined) || [];
        const uiMessages =
          (chatRef.current?.messages.getMessages() as RuntimeUiMessage[]) || [];
        const hasAssistantMessage = messages.some(
          (message) => message.role === "assistant",
        );
        const hasUiLiveMessage = uiMessages.some(
          (message) => message.msgStatus === "generating",
        );
        const isRunning =
          (session as { status?: "idle" | "running" }).status === "running";
        const isIdle =
          (session as { status?: "idle" | "running" }).status === "idle";

        if (isRunning) {
          runtimeLoadingBridgeRef.current?.setLoading?.(true);

          if (
            reconnectAttemptedSessionIdRef.current !== chatId &&
            !hasUiLiveMessage
          ) {
            reconnectAttemptedSessionIdRef.current = chatId;
            void reconnectRunningSession(chatId, {
              sessionId: (session as ReconnectableSession).sessionId,
              userId: (session as ReconnectableSession).userId,
              channel: (session as ReconnectableSession).channel,
              messages,
            }).then((connected) => {
              if (!connected) {
                reconnectAttemptedSessionIdRef.current = null;
              }
            });
          }
        }

        if (hasAssistantMessage && !didRefreshHydratedMessages) {
          didRefreshHydratedMessages = true;

          if (attempts > 1) {
            setRefreshKey((prev) => prev + 1);
          }
        }

        if (isIdle) {
          reconnectAttemptedSessionIdRef.current = null;
          runtimeLoadingBridgeRef.current?.setLoading?.(false);
          return;
        }
      } catch {
        // Ignore transient polling failures and continue retrying.
      }

      if (!cancelled && attempts < maxAttempts) {
        setTimeout(() => {
          void pollSessionHydration();
        }, intervalMs);
      }
    };

    void pollSessionHydration();

    const loadingBridge = runtimeLoadingBridgeRef.current;
    return () => {
      cancelled = true;
      reconnectAttemptedSessionIdRef.current = null;
      loadingBridge?.setLoading?.(false);
    };
  }, [chatId, reconnectRunningSession]);

  const customFetch = useCallback(
    async (data: CustomFetchData): Promise<Response> => {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...buildAuthHeaders(),
      };

      const shouldReconnect =
        data.reconnect || data.biz_params?.reconnect === true;
      const reconnectSessionId =
        data.session_id ?? window.currentSessionId ?? "";
      if (shouldReconnect && reconnectSessionId) {
        setReconnectStreaming(true);
        const res = await fetch(getApiUrl("/console/chat"), {
          method: "POST",
          headers,
          body: JSON.stringify({
            reconnect: true,
            session_id: reconnectSessionId,
            user_id: data.user_id ?? window.currentUserId ?? "default",
            channel: data.channel ?? window.currentChannel ?? "console",
          }),
        });

        // Reconnect has a small race window: status endpoint can still read
        // "running" while the stream task has just finished.
        // Backend then returns 404 "No running chat for this session".
        // Treat it as a benign idle transition instead of surfacing an error.
        if (!res.ok || !res.body) {
          setChatStatus("idle");
          setReconnectStreaming(false);

          if (res.status === 404) {
            try {
              const payload = await res.clone().json();
              if (payload?.detail === "No running chat for this session") {
                return new Response(
                  JSON.stringify({
                    status: AgentScopeRuntimeRunStatus.Completed,
                    output: [],
                  }),
                  {
                    status: 200,
                    headers: { "Content-Type": "application/json" },
                  },
                );
              }
            } catch {
              // Ignore parse errors and keep original response below.
            }
          }

          return res;
        }
        const onStreamEnd = () => {
          setChatStatus("idle");
          setReconnectStreaming(false);
        };
        const stream = res.body;
        const transformed = new ReadableStream({
          start(controller) {
            const reader = stream.getReader();
            function pump() {
              reader.read().then(({ done, value }) => {
                if (done) {
                  controller.close();
                  onStreamEnd();
                  return;
                }
                controller.enqueue(value);
                return pump();
              });
            }
            pump();
          },
        });
        return new Response(transformed, {
          headers: res.headers,
          status: res.status,
        });
      }

      try {
        const activeModels = await providerApi.getActiveModels({
          scope: "effective",
          agent_id: selectedAgent,
        });
        if (
          !activeModels?.active_llm?.provider_id ||
          !activeModels?.active_llm?.model
        ) {
          setShowModelPrompt(true);
          return buildModelError();
        }
      } catch {
        setShowModelPrompt(true);
        return buildModelError();
      }

      const { input = [], biz_params } = data;
      const isAutoContinueRequest =
        biz_params?.continue_mode === true || biz_params?.auto_continue === true;
      const latestUserText = extractLatestUserText(input);
      const bootstrapText = isPipelineDesignBootstrapText(latestUserText);
      const shouldInlinePipelineGuide =
        !bootstrapText && shouldSuggestPipelineOpportunity(latestUserText);

      if (shouldInlinePipelineGuide) {
        const now = Date.now();
        const cooldownKey = "copaw.pipeline.opportunity.lastAt";
        const lastAt = Number(localStorage.getItem(cooldownKey) || "0");
        if (now - lastAt > 30 * 60 * 1000) {
          localStorage.setItem(cooldownKey, String(now));
        }
      }

      const session: SessionInfo = input[input.length - 1]?.session || {};
      const lastInput = input.slice(-1);
      const lastMsg = lastInput[0];
      const rewrittenInput =
        lastMsg?.content && Array.isArray(lastMsg.content)
          ? [
              {
                ...lastMsg,
                content: [
                  ...lastMsg.content.map(normalizeContentUrls),
                  ...(shouldInlinePipelineGuide
                    ? [
                        {
                          type: "text",
                          text: buildPipelineOpportunityInlineHint(),
                        },
                      ]
                    : []),
                ],
              },
            ]
          : lastInput;

      const requestBody = {
        input: rewrittenInput,
        session_id: window.currentSessionId || session?.session_id || "",
        user_id: window.currentUserId || session?.user_id || DEFAULT_USER_ID,
        channel: window.currentChannel || session?.channel || DEFAULT_CHANNEL,
        stream: true,
        ...biz_params,
      };

      if (requestBody.session_id && !isAutoContinueRequest) {
        autoContinueAttemptsRef.current[requestBody.session_id] = 0;
        autoContinueInFlightRef.current[requestBody.session_id] = false;
      }

      const backendChatId =
        sessionApi.getRealIdForSession(requestBody.session_id) ??
        chatIdRef.current ??
        requestBody.session_id;
      if (backendChatId) {
        const userText = (rewrittenInput as RequestInputMessage[])
          .filter(
            (message): message is RequestInputMessage => message.role === "user",
          )
          .map(extractUserMessageText)
          .join("\n")
          .trim();
        if (userText) {
          if (requestBody.session_id) {
            sessionApi.setLastUserMessage(requestBody.session_id, userText);
          }
          sessionApi.setLastUserMessage(backendChatId, userText);
        }
      }

      const response = await fetch(getApiUrl("/console/chat"), {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: data.signal,
      });

      if (!response.ok || !response.body || !requestBody.session_id) {
        return response;
      }

      const [uiStream, cacheStream] = response.body.tee();
      const [uiReadable, monitorStream] = uiStream.tee();
      persistStreamSession(requestBody.session_id, cacheStream);

      void (async () => {
        const responseBuilder = new AgentScopeRuntimeResponseBuilder({
          id: "",
          status: AgentScopeRuntimeRunStatus.Created,
          created_at: 0,
        });

        let sawFinalChunk = false;
        let lastStatus: string | undefined;
        let latestRenderable: StreamResponseData | null = null;

        try {
          for await (const chunk of Stream({ readableStream: monitorStream })) {
            let chunkData: unknown;
            try {
              chunkData = JSON.parse(chunk.data);
            } catch {
              continue;
            }

            const responseData = responseBuilder.handle(
              chunkData as never,
            ) as StreamResponseData;
            const renderableResponse = materializeThinkingOnlyFallback(responseData);
            lastStatus = responseData.status;
            if (hasRenderableOutput(renderableResponse)) {
              latestRenderable = cloneValue(renderableResponse);
            }
            if (isFinalResponseStatus(responseData.status)) {
              sawFinalChunk = true;
            }
          }
        } catch {
          // Ignore monitor-side stream/parser errors.
        }

        const currentSessionId = window.currentSessionId || "";
        if (
          !autoContinueEnabledRef.current ||
          !requestBody.session_id ||
          requestBody.session_id !== currentSessionId
        ) {
          return;
        }

        const assistantText = extractAssistantTextFromResponse(latestRenderable);
        const shouldContinue = shouldAutoContinueResponse({
          status: lastStatus,
          sawFinalChunk,
          assistantText,
        });
        const tail = buildAssistantTailFingerprint(assistantText);
        const previousTail = autoContinueTailRef.current[requestBody.session_id] || "";

        if (!shouldContinue) {
          autoContinueAttemptsRef.current[requestBody.session_id] = 0;
          autoContinueTailRef.current[requestBody.session_id] = tail;
          return;
        }

        const attempts = autoContinueAttemptsRef.current[requestBody.session_id] || 0;
        if (attempts >= AUTO_CONTINUE_MAX_ATTEMPTS) {
          return;
        }

        if (
          isAutoContinueRequest &&
          tail &&
          previousTail &&
          tail.length >= previousTail.length &&
          tail.slice(-AUTO_CONTINUE_MIN_INCREMENT_CHARS) ===
            previousTail.slice(-AUTO_CONTINUE_MIN_INCREMENT_CHARS)
        ) {
          return;
        }

        if (autoContinueInFlightRef.current[requestBody.session_id]) {
          return;
        }

        autoContinueAttemptsRef.current[requestBody.session_id] = attempts + 1;
        autoContinueInFlightRef.current[requestBody.session_id] = true;
        autoContinueTailRef.current[requestBody.session_id] = tail;

        message.info(
          t(
            "chat.autoContinue.triggered",
            "检测到回答可能未完成，已自动继续生成。",
          ),
        );

        try {
          const continueResponse = await fetch(getApiUrl("/console/chat"), {
            method: "POST",
            headers,
            body: JSON.stringify({
              input: [],
              session_id: requestBody.session_id,
              user_id: requestBody.user_id,
              channel: requestBody.channel,
              stream: true,
              continue_mode: true,
              auto_continue: true,
            }),
          });
          if (!continueResponse.ok || !continueResponse.body) {
            return;
          }

          // Drive the continuation stream into the live chat UI directly,
          // the same way reconnectRunningSession does — persistStreamSession
          // only saves to storage and never calls chatRef.current?.messages.updateMessage,
          // so the user would see the toast but no actual output.
          const acSessionId = requestBody.session_id;
          const acInitialMessages = cloneRuntimeMessages(
            (chatRef.current?.messages.getMessages() as RuntimeUiMessage[]) || [],
          );
          const acAssistantMessageId = `ac-${acSessionId}-${Date.now()}`;
          const acResponseBuilder = new AgentScopeRuntimeResponseBuilder({
            id: "",
            status: AgentScopeRuntimeRunStatus.Created,
            created_at: 0,
          });

          setChatStatus("running");
          runtimeLoadingBridgeRef.current?.setLoading?.(true);

          let acCachedMessages = acInitialMessages;
          let acReachedTerminal = false;

          try {
            for await (const chunk of Stream({ readableStream: continueResponse.body })) {
              let acChunkData: unknown;
              try {
                acChunkData = JSON.parse(chunk.data);
              } catch {
                continue;
              }

              const acResponseData = acResponseBuilder.handle(
                acChunkData as never,
              ) as StreamResponseData;
              const acRenderable = materializeThinkingOnlyFallback(acResponseData);
              const acIsFinal = isFinalResponseStatus(acResponseData.status);

              const acExistingMsg = acCachedMessages.find(
                (m) => m.id === acAssistantMessageId,
              );
              const acPrevData = getResponseCardData(acExistingMsg);

              let acNextData: StreamResponseData | null = null;
              if (hasRenderableOutput(acRenderable)) {
                acNextData = cloneValue(acRenderable);
              } else if (acIsFinal && acPrevData) {
                acNextData = {
                  ...acPrevData,
                  status: acResponseData.status ?? acPrevData.status,
                };
              }

              if (!acNextData) {
                continue;
              }

              const acAssistantMsg: RuntimeUiMessage = {
                ...(acExistingMsg || { id: acAssistantMessageId, role: "assistant" }),
                id: acAssistantMessageId,
                role: "assistant",
                cards: [
                  {
                    code: "AgentScopeRuntimeResponseCard",
                    data: acNextData,
                  },
                ],
                msgStatus: acIsFinal ? "finished" : "generating",
              };

              const acMsgIdx = acCachedMessages.findIndex(
                (m) => m.id === acAssistantMessageId,
              );
              acCachedMessages =
                acMsgIdx >= 0
                  ? [
                      ...acCachedMessages.slice(0, acMsgIdx),
                      acAssistantMsg,
                      ...acCachedMessages.slice(acMsgIdx + 1),
                    ]
                  : [...acCachedMessages, acAssistantMsg];

              if (chatIdRef.current === acSessionId) {
                chatRef.current?.messages.updateMessage(cloneValue(acAssistantMsg));
              }

              await persistSessionMessages(acSessionId, acCachedMessages);

              if (acIsFinal) {
                acReachedTerminal = true;
                setChatStatus("idle");
                runtimeLoadingBridgeRef.current?.setLoading?.(false);
              }
            }
          } finally {
            if (!acReachedTerminal) {
              setChatStatus("idle");
              runtimeLoadingBridgeRef.current?.setLoading?.(false);
            }
          }
        } finally {
          autoContinueInFlightRef.current[requestBody.session_id] = false;
        }
      })();

      return new Response(uiReadable, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
    [message, persistSessionMessages, persistStreamSession, selectedAgent, setChatStatus, setReconnectStreaming, t],
  );

  const handleFileUpload = useCallback(
    async (options: {
      file: File;
      onSuccess: (body: { url?: string; thumbUrl?: string }) => void;
      onError?: (e: Error) => void;
      onProgress?: (e: { percent?: number }) => void;
    }) => {
      const { file, onSuccess, onError, onProgress } = options;
      try {
        // Warn when model has no multimodal support
        if (!multimodalCaps.supportsMultimodal) {
          message.warning(t("chat.attachments.multimodalWarning"));
        } else if (
          multimodalCaps.supportsImage &&
          !multimodalCaps.supportsVideo &&
          !file.type.startsWith("image/")
        ) {
          // Warn (not block) when only image is supported
          message.warning(t("chat.attachments.imageOnlyWarning"));
        }
        const sizeMb = file.size / 1024 / 1024;
        const isWithinLimit = sizeMb < CHAT_ATTACHMENT_MAX_MB;

        if (!isWithinLimit) {
          message.error(
            t("chat.attachments.fileSizeExceeded", {
              limit: CHAT_ATTACHMENT_MAX_MB,
              size: sizeMb.toFixed(2),
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
    [message, multimodalCaps, t],
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
      {
        command: "/mission",
        value: "mission",
        description: t("chat.commands.mission.description"),
      },
      {
        command: "/skills",
        value: "skills",
        description: t("chat.commands.skills.description"),
      },
    ];

    const handleBeforeSubmit = async () => {
      if (isComposingRef.current) return false;
      return true;
    };

    return {
      ...i18nConfig,
      theme: {
        ...defaultConfig.theme,
        darkMode: isDark,
        leftHeader: {
          ...defaultConfig.theme.leftHeader,
        },
        rightHeader: (
          <>
            <RuntimeLoadingBridge bridgeRef={runtimeLoadingBridgeRef} />
            <span className={styles.headerChatName} title={currentChatName}>
              {currentChatName}
            </span>
            <span style={{ flex: 1 }} />
            <ModelSelector />
            <Popover
              trigger="click"
              placement="bottomRight"
              content={
                <div style={{ minWidth: 280 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>
                    {t("chat.autoContinue.title", "自动继续生成")}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                  >
                    <span>
                      {t(
                        "chat.autoContinue.switchLabel",
                        "检测到回答中断时自动续写",
                      )}
                    </span>
                    <Switch
                      checked={autoContinueEnabled}
                      onChange={handleAutoContinueToggle}
                      size="small"
                      disabled={!runningConfigSnapshot || savingAutoContinue}
                      loading={savingAutoContinue}
                    />
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      color: "rgba(0, 0, 0, 0.45)",
                      fontSize: 12,
                      lineHeight: 1.4,
                    }}
                  >
                    {t(
                      "chat.autoContinue.help",
                      "默认最多自动续写 2 次，避免循环续写。",
                    )}
                  </div>
                </div>
              }
            >
              <Tooltip
                title={t("chat.autoContinue.title", "自动继续生成")}
                mouseEnterDelay={0.3}
              >
                <IconButton
                  bordered={false}
                  icon={<SettingOutlined />}
                  aria-label={t("chat.autoContinue.title", "自动继续生成")}
                />
              </Tooltip>
            </Popover>
            <Tooltip title={t("chat.newChat", "New Chat")} mouseEnterDelay={0.3}>
              <IconButton
                bordered={false}
                icon={<SparkNewChatFill />}
                onClick={() => {
                  void handleStartNewChat();
                }}
                aria-label={t("chat.newChat", "New Chat")}
              />
            </Tooltip>
            <Popover
              trigger="click"
              placement="bottomRight"
              open={historyOpen}
              onOpenChange={(open) => {
                setHistoryOpen(open);
                if (open) {
                  void loadHistorySessions();
                }
              }}
              content={
                historyLoading ? (
                  <div style={{ display: "flex", justifyContent: "center", padding: "16px 8px" }}>
                    <Spin size="small" />
                  </div>
                ) : historySessions.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t("chat.historyEmpty", "No history chats")}
                  />
                ) : (
                  <div className={styles.headerHistoryPopover}>
                    {historySessions.map((session) => {
                      const title = (session.name || session.id || "").trim() || t("chat.untitled", "Untitled chat");
                      const updatedAt = formatLocalDateTime(
                        session.updatedAt || session.updated_at || session.createdAt || session.created_at,
                      );
                      const isActive = session.id === chatId;
                      return (
                        <Button
                          key={session.id}
                          type={isActive ? "primary" : "text"}
                          style={{
                            width: "100%",
                            justifyContent: "flex-start",
                            height: "auto",
                            paddingBlock: 8,
                            textAlign: "left",
                          }}
                          onClick={() => {
                            scheduleReplaceNavigation(`/chat/${session.id}`);
                            setHistoryOpen(false);
                          }}
                        >
                          <div className={styles.headerHistoryItem}>
                            <span className={styles.headerHistoryTitle}>{title}</span>
                            <span className={styles.headerHistoryTime}>
                              {updatedAt || t("chat.unknownTime", "Unknown time")}
                            </span>
                          </div>
                        </Button>
                      );
                    })}
                  </div>
                )
              }
            >
              <Tooltip title={t("chat.historyChat", "History Chats")} mouseEnterDelay={0.3}>
                <IconButton
                  bordered={false}
                  icon={<SparkHistoryLine />}
                  aria-label={t("chat.historyChat", "History Chats")}
                />
              </Tooltip>
            </Popover>
          </>
        ),
      },
      welcome: {
        ...i18nConfig.welcome,
        nick: "QwenPaw",
        avatar:
          "https://gw.alicdn.com/imgextra/i2/O1CN01pyXzjQ1EL1PuZMlSd_!!6000000000334-2-tps-288-288.png",
      },
      sender: {
        ...senderConfig,
        beforeSubmit: handleBeforeSubmit,
        allowSpeech: true,
        attachments: {
          trigger: function (props: AttachmentTriggerProps) {
            const tooltipKey = multimodalCaps.supportsMultimodal
              ? multimodalCaps.supportsImage && !multimodalCaps.supportsVideo
                ? "chat.attachments.tooltipImageOnly"
                : "chat.attachments.tooltip"
              : "chat.attachments.tooltipNoMultimodal";
            return (
              <Tooltip title={t(tooltipKey, { limit: CHAT_ATTACHMENT_MAX_MB })}>
                <IconButton
                  disabled={props?.disabled}
                  icon={<SparkAttachmentLine />}
                  bordered={false}
                />
              </Tooltip>
            );
          },
          customRequest: handleFileUpload,
        },
        placeholder: t("chat.inputPlaceholder"),
        suggestions: commandSuggestions.map((item) => ({
          label: renderSuggestionLabel(item.command, item.description),
          value: item.value,
        })),
      },
      session: {
        multiple: true,
        // Keep built-in list visible to preserve current fallback behavior.
        hideBuiltInSessionList: false,
        api: wrappedSessionApi,
      },
      api: {
        ...defaultConfig.api,
        fetch: customFetch,
        replaceMediaURL: (url: string) => {
          return toDisplayUrl(url);
        },
        cancel(data: { session_id: string }) {
          const chatIdForStop = data?.session_id
            ? sessionApi.getRealIdForSession(data.session_id) ?? data.session_id
            : "";
          if (chatIdForStop) {
            chatApi.stopConsoleChat(chatIdForStop).then(
              () => setChatStatus("idle"),
              (err) => {
                console.error("stopConsoleChat failed:", err);
              },
            );
          }
        },
        async reconnect(data: { session_id: string; signal?: AbortSignal }) {
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
            ...buildAuthHeaders(),
          };

          return fetch(getApiUrl("/console/chat"), {
            method: "POST",
            headers,
            body: JSON.stringify({
              reconnect: true,
              session_id: window.currentSessionId || data.session_id,
              user_id: window.currentUserId || DEFAULT_USER_ID,
              channel: window.currentChannel || DEFAULT_CHANNEL,
            }),
            signal: data.signal,
          });
        },
      },
      customToolRenderConfig:
        Object.keys(toolRenderConfig).length > 0 ? toolRenderConfig : undefined,
      actions: {
        list: [
          {
            key: "copy",
            icon: (
              <span key="copy-action-icon" title={t("common.copy")}>
                <SparkCopyLine />
              </span>
            ),
            onClick: ({ data }: { data: CopyableResponse }) => {
              void copyResponse(data);
            },
          },
        ],
        replace: true,
      },
    } as unknown as IAgentScopeRuntimeWebUIOptions;
  }, [
    wrappedSessionApi,
    customFetch,
    copyResponse,
    handleFileUpload,
    t,
    isDark,
    isComposingRef,
    multimodalCaps,
    setChatStatus,
    currentChatName,
    handleStartNewChat,
    historyLoading,
    historyOpen,
    historySessions,
    loadHistorySessions,
    chatId,
    scheduleReplaceNavigation,
    autoContinueEnabled,
    handleAutoContinueToggle,
    runningConfigSnapshot,
    savingAutoContinue,
    toolRenderConfig,
  ]);

  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div className={styles.chatMessagesArea}>
        <AgentScopeRuntimeWebUI
          ref={chatRef}
          key={refreshKey}
          options={options}
        />
      </div>

      <Modal
        open={showModelPrompt}
        closable={false}
        footer={null}
        width={480}
        styles={{
          content: isDark
            ? { background: "#1f1f1f", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }
            : undefined,
        }}
      >
        <Result
          icon={<ExclamationCircleOutlined style={{ color: "#faad14" }} />}
          title={
            <span
              style={{ color: isDark ? "rgba(255,255,255,0.88)" : undefined }}
            >
              {t("modelConfig.promptTitle")}
            </span>
          }
          subTitle={
            <span
              style={{ color: isDark ? "rgba(255,255,255,0.55)" : undefined }}
            >
              {t("modelConfig.promptMessage")}
            </span>
          }
          extra={[
            <Button key="skip" onClick={() => setShowModelPrompt(false)}>
              {t("modelConfig.skipButton")}
            </Button>,
            <Button
              key="configure"
              type="primary"
              icon={<SettingOutlined />}
              onClick={() => {
                setShowModelPrompt(false);
                trackNavigation({
                  source: "chat.modelPrompt",
                  from: location.pathname,
                  to: "/models",
                  reason: "configure-model-from-chat",
                });
                navigate("/models");
              }}
            >
              {t("modelConfig.configureButton")}
            </Button>,
          ]}
        />
      </Modal>
    </div>
  );
}
