import { useEffect } from "react";
import { chatApi } from "../../../api/modules/chat";
import type { ChatSpec } from "../../../api/types/chat";

interface UseProjectChatFocusEffectsParams {
  runFocusChatId: string;
  workspaceFocusChatId: string;
  designFocusChatId: string;
  setRunFocusChatId: (value: string | ((prev: string) => string)) => void;
  runDetailFocusChatId?: string | null;
  selectedRunSummaryFocusChatId?: string | null;
  runFocusChatIdRef: React.MutableRefObject<string>;
  workspaceFocusChatIdRef: React.MutableRefObject<string>;
  designFocusChatIdRef: React.MutableRefObject<string>;
  runRestoreAttemptKeyRef: React.MutableRefObject<string>;
  currentAgentId?: string;
  selectedProjectId?: string;
  selectedRunId: string;
  activeRunChatId: string;
  pipelineLoading: boolean;
  chatStarting: boolean;
  setError: (value: string) => void;
}

function getMetaString(meta: Record<string, unknown> | undefined, key: string): string {
  const value = meta?.[key];
  return typeof value === "string" ? value : "";
}

function sortChatsForRestore<T extends ChatSpec>(chats: T[]): T[] {
  const toMillis = (chat: ChatSpec): number => {
    const updatedTs = chat.updated_at ? Date.parse(chat.updated_at) : 0;
    if (Number.isFinite(updatedTs) && updatedTs > 0) {
      return updatedTs;
    }
    const createdTs = chat.created_at ? Date.parse(chat.created_at) : 0;
    return Number.isFinite(createdTs) ? createdTs : 0;
  };

  return [...chats].sort((a, b) => {
    const aRunning = a.status === "running";
    const bRunning = b.status === "running";
    if (aRunning !== bRunning) {
      // Prefer non-running chats to avoid restoring into empty-running sessions.
      return aRunning ? 1 : -1;
    }
    return toMillis(b) - toMillis(a);
  });
}

export default function useProjectChatFocusEffects({
  runFocusChatId,
  workspaceFocusChatId,
  designFocusChatId,
  setRunFocusChatId,
  runDetailFocusChatId,
  selectedRunSummaryFocusChatId,
  runFocusChatIdRef,
  workspaceFocusChatIdRef,
  designFocusChatIdRef,
  runRestoreAttemptKeyRef,
  currentAgentId,
  selectedProjectId,
  selectedRunId,
  activeRunChatId,
  pipelineLoading,
  chatStarting,
  setError,
}: UseProjectChatFocusEffectsParams) {
  useEffect(() => {
    runFocusChatIdRef.current = runFocusChatId;
  }, [runFocusChatId, runFocusChatIdRef]);

  useEffect(() => {
    workspaceFocusChatIdRef.current = workspaceFocusChatId;
  }, [workspaceFocusChatId, workspaceFocusChatIdRef]);

  useEffect(() => {
    designFocusChatIdRef.current = designFocusChatId;
  }, [designFocusChatId, designFocusChatIdRef]);

  useEffect(() => {
    const fallbackChatId = runDetailFocusChatId || selectedRunSummaryFocusChatId || "";
    if (fallbackChatId && fallbackChatId !== runFocusChatId) {
      setRunFocusChatId(fallbackChatId);
    }
  }, [
    runDetailFocusChatId,
    runFocusChatId,
    selectedRunSummaryFocusChatId,
    setRunFocusChatId,
  ]);

  useEffect(() => {
    if (!currentAgentId || !selectedProjectId || !selectedRunId) {
      return;
    }
    if (activeRunChatId || pipelineLoading || chatStarting) {
      return;
    }

    const restoreKey = `${currentAgentId}:${selectedProjectId}:${selectedRunId}`;
    if (runRestoreAttemptKeyRef.current === restoreKey) {
      return;
    }
    runRestoreAttemptKeyRef.current = restoreKey;

    let cancelled = false;
    const resolveLatestRunBoundChatId = async (): Promise<string> => {
      const chats = await chatApi.listChats({ user_id: "default", channel: "console" });
      const matched = chats.filter((chat) => {
        const meta =
          chat.meta && typeof chat.meta === "object"
            ? (chat.meta as Record<string, unknown>)
            : undefined;
        const metaType = getMetaString(meta, "focus_type");
        const metaRunId = getMetaString(meta, "run_id");
        const metaProjectId = getMetaString(meta, "project_id");
        if (metaType !== "project_run" || metaRunId !== selectedRunId) {
          return false;
        }
        if (metaProjectId && metaProjectId !== selectedProjectId) {
          return false;
        }
        return true;
      });

      if (matched.length === 0) {
        const sessionPrefix = `project-run-${selectedRunId}-`;
        const bySession = chats.filter((chat) =>
          (chat.session_id || "").startsWith(sessionPrefix),
        );
        if (bySession.length > 0) {
          const sorted = sortChatsForRestore(bySession);
          return sorted[0]?.id || "";
        }
      }

      if (matched.length === 0) {
        return "";
      }

      const sorted = sortChatsForRestore(matched);
      return sorted[0]?.id || "";
    };

    void resolveLatestRunBoundChatId()
      .then((restoredChatId) => {
        if (cancelled || !restoredChatId) {
          return;
        }
        setRunFocusChatId((prev) => (prev || restoredChatId));
        setError("");
      })
      .catch(() => {
        // Keep silent for passive restore checks.
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeRunChatId,
    chatStarting,
    currentAgentId,
    pipelineLoading,
    runRestoreAttemptKeyRef,
    selectedProjectId,
    selectedRunId,
    setError,
    setRunFocusChatId,
  ]);
}