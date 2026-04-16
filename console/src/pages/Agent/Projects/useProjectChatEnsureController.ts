import { useCallback } from "react";
import { chatApi } from "../../../api/modules/chat";
import type { AgentProjectSummary } from "../../../api/types/agents";
import type { ChatSpec } from "../../../api/types/chat";

interface UseProjectChatEnsureControllerParams {
  selectedProject?: AgentProjectSummary;
  routeWorkspaceChatId?: string;
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

function pickLeafChatCandidates(chats: ChatSpec[]): ChatSpec[] {
  const parentIds = new Set(chats.map((chat) => chat.session_id).filter(Boolean) as string[]);
  const leaves = chats.filter((chat) => !parentIds.has(chat.id));
  return leaves.length > 0 ? leaves : chats;
}

function pickWorkspaceChatFromCandidates(params: {
  chats: ChatSpec[];
  projectId: string;
  routeWorkspaceChatId?: string;
  preferredWorkspaceChatId?: string;
}): string {
  const directCandidates = [
    params.routeWorkspaceChatId || "",
    params.preferredWorkspaceChatId || "",
  ]
    .map((item) => item.trim())
    .filter(Boolean);

  for (const candidateId of Array.from(new Set(directCandidates))) {
    const matched = params.chats.find((chat) => chat.id === candidateId);
    if (matched && isProjectWorkspaceRelatedChat(matched, params.projectId)) {
      return matched.id;
    }
  }

  const related = collectWorkspaceChatCandidates(params.chats, params.projectId);
  if (related.length === 0) {
    return "";
  }
  const leafCandidates = pickLeafChatCandidates(related);
  const sorted = sortChatsForRestore(leafCandidates);
  return sorted[0]?.id || "";
}

export default function useProjectChatEnsureController({
  selectedProject,
  routeWorkspaceChatId,
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
        const restoredChatId = pickWorkspaceChatFromCandidates({
          chats,
          projectId: selectedProject.id,
          routeWorkspaceChatId,
          preferredWorkspaceChatId: selectedProject.preferred_workspace_chat_id || "",
        });
        if (restoredChatId) {
          setWorkspaceFocusChatId(restoredChatId);
          setError("");
          return restoredChatId;
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
    routeWorkspaceChatId,
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
