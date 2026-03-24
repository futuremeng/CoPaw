import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { useLocation } from "react-router-dom";
import type { IAgentScopeRuntimeWebUIRef } from "@agentscope-ai/chat";
import api from "../../api";
import sessionApi from "./sessionApi";
import { trackNavigation } from "../../utils/navigationTelemetry";
import {
  buildPipelineDesignBootstrapPrompt,
  clearPipelineDesignBootstrap,
  clearPipelineDesignHandoff,
  hasPipelineDesignAutostarted,
  hasPipelineDesignHandoff,
  markPipelineDesignAutostarted,
  readPipelineDesignBootstrap,
} from "../../utils/pipelineDesign";

type ChatStatus = "idle" | "running";

interface UsePipelineChatHandoffParams {
  chatId?: string;
  selectedAgent: string;
  chatRef: RefObject<IAgentScopeRuntimeWebUIRef | null>;
  pipelineOpportunityMuteUntilRef: MutableRefObject<number>;
}

interface UsePipelineChatHandoffResult {
  chatStatus: ChatStatus;
  setChatStatus: (status: ChatStatus) => void;
  setReconnectStreaming: (value: boolean) => void;
}

export function usePipelineChatHandoff({
  chatId,
  selectedAgent,
  chatRef,
  pipelineOpportunityMuteUntilRef,
}: UsePipelineChatHandoffParams): UsePipelineChatHandoffResult {
  const location = useLocation();
  const [chatStatus, setChatStatus] = useState<ChatStatus>("idle");
  const [, setReconnectStreaming] = useState(false);
  const reconnectTriggeredForRef = useRef<string | null>(null);
  const autoPipelinePromptingRef = useRef<string | null>(null);
  const prevChatIdRef = useRef<string | undefined>(undefined);
  const isPipelineEntryRef = useRef(false);

  useEffect(() => {
    const isPipelineEntry = !!chatId && hasPipelineDesignHandoff(chatId);
    isPipelineEntryRef.current = isPipelineEntry;

    if (!chatId || chatId === "undefined" || chatId === "null") {
      setChatStatus("idle");
      return;
    }

    const realId = sessionApi.getRealIdForSession(chatId) ?? chatId;

    let cancelled = false;
    let inFlight = false;
    let attempt = 0;
    const maxAttempts = isPipelineEntry ? 20 : 1;

    const readStatus = async () => {
      if (inFlight || cancelled) return false;
      inFlight = true;
      attempt += 1;
      try {
        const res = await api.getChat(realId);
        const status = (res.status as ChatStatus) ?? "idle";
        if (!cancelled) {
          setChatStatus(status);
        }
        return status === "running";
      } catch {
        if (!cancelled) {
          setChatStatus("idle");
        }
        return false;
      } finally {
        inFlight = false;
      }
    };

    let timer: number | null = null;
    void readStatus().then((isRunning) => {
      if (!isPipelineEntry || isRunning || cancelled) {
        return;
      }
      timer = window.setInterval(() => {
        if (attempt >= maxAttempts) {
          if (timer) window.clearInterval(timer);
          return;
        }
        void readStatus().then((runningNow) => {
          if (runningNow && timer) {
            window.clearInterval(timer);
          }
        });
      }, 300);
    });

    return () => {
      cancelled = true;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, [chatId]);

  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      reconnectTriggeredForRef.current = null;
    }
    if (!chatId || chatStatus !== "running") return;
    if (reconnectTriggeredForRef.current === chatId) return;

    reconnectTriggeredForRef.current = chatId;
    if (isPipelineEntryRef.current) {
      trackNavigation({
        source: "chat.pipelineEntryReconnect",
        from: location.pathname + location.search,
        to: `/chat/${chatId}`,
        reason: "pipeline-autostart-reconnect-priority",
      });
    }

    setReconnectStreaming(true);
    sessionApi.triggerReconnectSubmit();
  }, [chatId, chatStatus, location.pathname, location.search]);

  useEffect(() => {
    if (!chatId) return;
    if (!hasPipelineDesignHandoff(chatId)) return;
    if (hasPipelineDesignAutostarted(chatId)) return;
    if (autoPipelinePromptingRef.current === chatId) return;

    const bootstrapPrompt =
      readPipelineDesignBootstrap(chatId) ||
      buildPipelineDesignBootstrapPrompt({
        source: "pipelines_page",
        agentId: selectedAgent,
      });

    autoPipelinePromptingRef.current = chatId;
    pipelineOpportunityMuteUntilRef.current = Date.now() + 60 * 1000;
    let attempts = 0;
    const maxAttempts = 120;

    const timer = window.setInterval(() => {
      attempts += 1;
      const submit = chatRef.current?.input?.submit;
      if (submit) {
        submit({ query: bootstrapPrompt });
        clearPipelineDesignBootstrap(chatId);
        clearPipelineDesignHandoff(chatId);
        markPipelineDesignAutostarted(chatId);
        autoPipelinePromptingRef.current = null;
        window.clearInterval(timer);
        return;
      }

      if (attempts >= maxAttempts) {
        clearPipelineDesignBootstrap(chatId);
        clearPipelineDesignHandoff(chatId);
        autoPipelinePromptingRef.current = null;
        window.clearInterval(timer);
      }
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [chatId, chatRef, pipelineOpportunityMuteUntilRef, selectedAgent]);

  return {
    chatStatus,
    setChatStatus,
    setReconnectStreaming,
  };
}