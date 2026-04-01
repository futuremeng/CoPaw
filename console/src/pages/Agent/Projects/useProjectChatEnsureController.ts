import { useCallback } from "react";
import { chatApi } from "../../../api/modules/chat";
import type { AgentProjectSummary } from "../../../api/types/agents";
import type { ChatSpec } from "../../../api/types/chat";

interface UseProjectChatEnsureControllerParams {
  selectedProject?: AgentProjectSummary;
  selectedRunId: string;
  activeRunChatId: string;
  workspaceFocusChatId: string;
  resolvedProjectRequestId: string;
  runFocusChatIdRef: React.MutableRefObject<string>;
  workspaceFocusChatIdRef: React.MutableRefObject<string>;
  setRunFocusChatId: (value: string) => void;
  setWorkspaceFocusChatId: (value: string) => void;
  setChatStarting: (value: boolean) => void;
  setError: (value: string) => void;
  startFailedText: string;
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
      return aRunning ? 1 : -1;
    }
    return toMillis(b) - toMillis(a);
  });
}

export default function useProjectChatEnsureController({
  selectedProject,
  selectedRunId,
  activeRunChatId,
  workspaceFocusChatId,
  resolvedProjectRequestId,
  runFocusChatIdRef,
  workspaceFocusChatIdRef,
  setRunFocusChatId,
  setWorkspaceFocusChatId,
  setChatStarting,
  setError,
  startFailedText,
}: UseProjectChatEnsureControllerParams) {
  const handleEnsureRunChat = useCallback(async (forceNew = false): Promise<string> => {
    if (!selectedProject || !selectedRunId) {
      return "";
    }

    if (!forceNew && activeRunChatId) {
      return activeRunChatId;
    }

    setChatStarting(true);
    try {
      const previousChatId = runFocusChatIdRef.current;
      if (forceNew && previousChatId) {
        void chatApi
          .clearChatMeta(previousChatId, {
            user_id: "default",
            channel: "console",
          })
          .catch(() => {});
      }

      const created = await chatApi.createChat({
        name: `[focus] ${selectedProject.name}`,
        session_id: `project-run-${selectedRunId}-${Date.now()}`,
        user_id: "default",
        channel: "console",
        meta: {
          focus_type: "project_run",
          focus_id: selectedProject.id,
          project_id: selectedProject.id,
          project_request_id: resolvedProjectRequestId || selectedProject.id,
          run_id: selectedRunId,
          focus_path: `projects/${selectedProject.id}`,
        },
      });

      setRunFocusChatId(created.id);
      setError("");
      return created.id;
    } catch (err) {
      console.error("failed to create project run chat", err);
      setError(startFailedText);
      return "";
    } finally {
      setChatStarting(false);
    }
  }, [
    activeRunChatId,
    resolvedProjectRequestId,
    runFocusChatIdRef,
    selectedProject,
    selectedRunId,
    setChatStarting,
    setError,
    setRunFocusChatId,
    startFailedText,
  ]);

  const handleEnsureWorkspaceChat = useCallback(async (forceNew = false): Promise<string> => {
    if (!selectedProject) {
      return "";
    }

    if (!forceNew && workspaceFocusChatId) {
      return workspaceFocusChatId;
    }

    setChatStarting(true);
    try {
      if (!forceNew) {
        const chats = await chatApi.listChats({
          user_id: "default",
          channel: "console",
        });
        const matched = chats.filter((chat) => {
          const meta =
            chat.meta && typeof chat.meta === "object"
              ? (chat.meta as Record<string, unknown>)
              : undefined;
          const metaType = getMetaString(meta, "focus_type");
          const metaProjectId = getMetaString(meta, "project_id");
          if (metaType !== "project_workspace") {
            return false;
          }
          return !metaProjectId || metaProjectId === selectedProject.id;
        });

        if (matched.length > 0) {
          const restoredChatId = sortChatsForRestore(matched)[0]?.id || "";
          if (restoredChatId) {
            setWorkspaceFocusChatId(restoredChatId);
            setError("");
            return restoredChatId;
          }
        }

        const sessionPrefix = `project-workspace-${selectedProject.id}-`;
        const bySession = chats.filter((chat) =>
          (chat.session_id || "").startsWith(sessionPrefix),
        );
        if (bySession.length > 0) {
          const restoredChatId = sortChatsForRestore(bySession)[0]?.id || "";
          if (restoredChatId) {
            setWorkspaceFocusChatId(restoredChatId);
            setError("");
            return restoredChatId;
          }
        }
      }

      const previousChatId = workspaceFocusChatIdRef.current;
      if (forceNew && previousChatId) {
        void chatApi
          .clearChatMeta(previousChatId, {
            user_id: "default",
            channel: "console",
          })
          .catch(() => {});
      }

      const created = await chatApi.createChat({
        name: `[project] ${selectedProject.name}`,
        session_id: `project-workspace-${selectedProject.id}-${Date.now()}`,
        user_id: "default",
        channel: "console",
        meta: {
          focus_type: "project_workspace",
          focus_id: selectedProject.id,
          project_id: selectedProject.id,
          project_request_id: resolvedProjectRequestId || selectedProject.id,
          focus_path: `projects/${selectedProject.id}`,
        },
      });

      setWorkspaceFocusChatId(created.id);
      setError("");
      return created.id;
    } catch (err) {
      console.error("failed to create project workspace chat", err);
      setError(startFailedText);
      return "";
    } finally {
      setChatStarting(false);
    }
  }, [
    resolvedProjectRequestId,
    selectedProject,
    setChatStarting,
    setError,
    setWorkspaceFocusChatId,
    startFailedText,
    workspaceFocusChatId,
    workspaceFocusChatIdRef,
  ]);

  return {
    handleEnsureRunChat,
    handleEnsureWorkspaceChat,
  };
}
