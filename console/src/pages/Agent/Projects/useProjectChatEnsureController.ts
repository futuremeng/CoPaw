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

function isProjectWorkspaceRelatedChat(chat: ChatSpec, projectId: string): boolean {
  const meta =
    chat.meta && typeof chat.meta === "object"
      ? (chat.meta as Record<string, unknown>)
      : undefined;
  const focusType = getMetaString(meta, "focus_type");
  const projectMetaId =
    getMetaString(meta, "project_id") || getMetaString(meta, "project_request_id");
  const focusPath = getMetaString(meta, "focus_path");
  const sessionPrefix = `project-workspace-${projectId}-`;

  if (focusType === "project_workspace") {
    return !projectMetaId || projectMetaId === projectId;
  }

  if ((chat.session_id || "").startsWith(sessionPrefix)) {
    return true;
  }

  if (projectMetaId && projectMetaId === projectId) {
    return true;
  }

  if (focusPath === `projects/${projectId}`) {
    return true;
  }

  return false;
}

function collectWorkspaceChatCandidates(chats: ChatSpec[], projectId: string): ChatSpec[] {
  const parentChats = chats.filter((chat) =>
    isProjectWorkspaceRelatedChat(chat, projectId),
  );
  const parentIds = new Set(parentChats.map((chat) => chat.id));

  const childrenByParent = new Map<string, ChatSpec[]>();
  for (const chat of chats) {
    if (!chat.session_id) {
      continue;
    }
    const children = childrenByParent.get(chat.session_id) || [];
    children.push(chat);
    childrenByParent.set(chat.session_id, children);
  }

  const relatedIds = new Set(parentIds);
  const queue = [...parentIds];
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

  return chats.filter((chat) => relatedIds.has(chat.id));
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

  return [...chats].sort((a, b) => toMillis(b) - toMillis(a));
}

async function pickChatWithHistory(chats: ChatSpec[]): Promise<string> {
  for (const chat of chats.slice(0, 20)) {
    try {
      const history = await chatApi.getChat(chat.id, { limit: 1 });
      if ((history.messages || []).length > 0) {
        return chat.id;
      }
    } catch {
      // Skip invalid/unavailable chats and continue fallback scan.
    }
  }
  return chats[0]?.id || "";
}

function pickLeafChatCandidates(chats: ChatSpec[]): ChatSpec[] {
  const parentIds = new Set(chats.map((chat) => chat.session_id).filter(Boolean) as string[]);
  const leaves = chats.filter((chat) => !parentIds.has(chat.id));
  return leaves.length > 0 ? leaves : chats;
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
          return metaType === "project_workspace" && isProjectWorkspaceRelatedChat(chat, selectedProject.id);
        });

        if (matched.length > 0) {
          const candidates = collectWorkspaceChatCandidates(chats, selectedProject.id);
          const leafCandidates = pickLeafChatCandidates(candidates.length > 0 ? candidates : matched);
          const sorted = sortChatsForRestore(leafCandidates);
          const restoredChatId = await pickChatWithHistory(sorted);
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
          const sorted = sortChatsForRestore(bySession);
          const restoredChatId = await pickChatWithHistory(sorted);
          if (restoredChatId) {
            setWorkspaceFocusChatId(restoredChatId);
            setError("");
            return restoredChatId;
          }
        }

        const related = collectWorkspaceChatCandidates(chats, selectedProject.id);
        if (related.length > 0) {
          const leafCandidates = pickLeafChatCandidates(related);
          const sorted = sortChatsForRestore(leafCandidates);
          const restoredChatId = await pickChatWithHistory(sorted);
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
