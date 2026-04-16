import { useCallback, useEffect, useMemo, useRef } from "react";
import { agentsApi } from "../../../api/modules/agents";
import { chatApi } from "../../../api/modules/chat";
import type {
  AgentProjectSummary,
  ProjectPipelineRunDetail,
} from "../../../api/types/agents";
import type { ChatSpec } from "../../../api/types/chat";

function workspaceChatPreferenceKey(projectId: string): string {
  return `project-workspace-chat-preferred:${projectId}`;
}

function readPreferredWorkspaceChatId(projectId: string): string {
  if (!projectId) {
    return "";
  }
  try {
    return window.localStorage.getItem(workspaceChatPreferenceKey(projectId)) || "";
  } catch {
    return "";
  }
}

function writePreferredWorkspaceChatId(projectId: string, chatId: string): void {
  if (!projectId || !chatId) {
    return;
  }
  try {
    window.localStorage.setItem(workspaceChatPreferenceKey(projectId), chatId);
  } catch {
    // Ignore storage failures.
  }
}

async function persistPreferredWorkspaceChatId(params: {
  currentAgentId: string;
  projectId: string;
  chatId: string;
}): Promise<void> {
  if (!params.currentAgentId || !params.projectId) {
    return;
  }
  await agentsApi.updateProjectWorkspaceChatBinding(
    params.currentAgentId,
    params.projectId,
    { preferred_workspace_chat_id: params.chatId || "" },
  );
}

function getMetaString(meta: Record<string, unknown> | undefined, key: string): string {
  const value = meta?.[key];
  return typeof value === "string" ? value : "";
}

function toTimestamp(raw?: string | null): number {
  if (!raw) {
    return 0;
  }
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
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

function collectDescendantChats(chats: ChatSpec[], rootIds: string[]): ChatSpec[] {
  if (rootIds.length === 0) {
    return [];
  }

  const childrenByParent = new Map<string, ChatSpec[]>();
  for (const chat of chats) {
    if (!chat.session_id) {
      continue;
    }
    const siblings = childrenByParent.get(chat.session_id) || [];
    siblings.push(chat);
    childrenByParent.set(chat.session_id, siblings);
  }

  const relatedIds = new Set(rootIds.filter(Boolean));
  const queue = [...relatedIds];
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

function pickLeafChatCandidates(chats: ChatSpec[]): ChatSpec[] {
  const parentIds = new Set(chats.map((chat) => chat.session_id).filter(Boolean) as string[]);
  const leaves = chats.filter((chat) => !parentIds.has(chat.id));
  return leaves.length > 0 ? leaves : chats;
}

function sortChatsForRestore<T extends ChatSpec>(chats: T[]): T[] {
  return [...chats].sort(
    (a, b) =>
      toTimestamp(b.updated_at || b.created_at) -
      toTimestamp(a.updated_at || a.created_at),
  );
}

async function pickChatWithHistory(chats: ChatSpec[]): Promise<string> {
  for (const chat of chats.slice(0, 10)) {
    try {
      const history = await chatApi.getChat(chat.id, { limit: 1 });
      if ((history.messages || []).length > 0) {
        return chat.id;
      }
    } catch {
      // Ignore unreadable chats and continue scanning recent candidates.
    }
  }

  return chats[0]?.id || "";
}

async function resolvePreferredOrLatestWorkspaceChat(params: {
  projectId: string;
  preferredChatId: string;
}): Promise<{ chatId: string; preferredValid: boolean }> {
  if (!params.projectId) {
    return { chatId: "", preferredValid: false };
  }

  const chats = await chatApi.listChats({ user_id: "default", channel: "console" });
  const related = chats.filter((chat) => isProjectWorkspaceRelatedChat(chat, params.projectId));

  const preferredChatId = params.preferredChatId.trim();
  if (preferredChatId) {
    const preferredChat = chats.find((chat) => chat.id === preferredChatId);
    if (preferredChat && isProjectWorkspaceRelatedChat(preferredChat, params.projectId)) {
      const descendantPool = collectDescendantChats(chats, [preferredChat.id]);
      const preferredCandidates = pickLeafChatCandidates(
        descendantPool.length > 0 ? descendantPool : [preferredChat],
      );
      const preferredResolvedChatId = await pickChatWithHistory(
        sortChatsForRestore(preferredCandidates),
      );
      return {
        chatId: preferredResolvedChatId || preferredChatId,
        preferredValid: true,
      };
    }
  }

  if (related.length === 0) {
    return { chatId: "", preferredValid: false };
  }

  const relatedLeaves = pickLeafChatCandidates(related);
  const resolvedChatId = await pickChatWithHistory(sortChatsForRestore(relatedLeaves));

  return { chatId: resolvedChatId, preferredValid: false };
}

interface UsePreferredProjectWorkspaceChatParams {
  currentAgentId?: string;
  selectedProject?: AgentProjectSummary;
  workspaceFocusChatId: string;
  activeWorkspaceChatId: string;
  activeDesignChatId: string;
  selectedRunId: string;
  setSelectedRunId: (value: string) => void;
  setSelectedStepId: (value: string) => void;
  setRunDetail: (value: ProjectPipelineRunDetail | null) => void;
  setRunFocusChatId: (value: string) => void;
  setDesignFocusChatId: (value: string) => void;
  setWorkspaceFocusChatId: (value: string) => void;
}

export default function usePreferredProjectWorkspaceChat({
  currentAgentId,
  selectedProject,
  workspaceFocusChatId,
  activeWorkspaceChatId,
  activeDesignChatId,
  selectedRunId,
  setSelectedRunId,
  setSelectedStepId,
  setRunDetail,
  setRunFocusChatId,
  setDesignFocusChatId,
  setWorkspaceFocusChatId,
}: UsePreferredProjectWorkspaceChatParams) {
  const persistedWorkspaceChatIdRef = useRef("");

  const preferredWorkspaceChatId = useMemo(() => {
    if (!selectedProject?.id) {
      return "";
    }
    return (
      (selectedProject.preferred_workspace_chat_id || "").trim() ||
      readPreferredWorkspaceChatId(selectedProject.id)
    );
  }, [selectedProject?.id, selectedProject?.preferred_workspace_chat_id]);

  const applyWorkspaceChatFocus = useCallback((chatId: string) => {
    if (!selectedProject?.id || !chatId) {
      return;
    }

    setSelectedRunId("");
    setSelectedStepId("");
    setRunDetail(null);
    setRunFocusChatId("");
    setDesignFocusChatId("");
    setWorkspaceFocusChatId(chatId);
  }, [
    selectedProject?.id,
    setDesignFocusChatId,
    setRunDetail,
    setRunFocusChatId,
    setSelectedRunId,
    setSelectedStepId,
    setWorkspaceFocusChatId,
  ]);

  const syncPreferredWorkspaceChatBinding = useCallback(async (chatId: string) => {
    if (!selectedProject?.id || !chatId) {
      return;
    }
    writePreferredWorkspaceChatId(selectedProject.id, chatId);
    if (!currentAgentId) {
      return;
    }
    await persistPreferredWorkspaceChatId({
      currentAgentId,
      projectId: selectedProject.id,
      chatId,
    });
  }, [currentAgentId, selectedProject?.id]);

  const resetPreferredWorkspaceChatBinding = useCallback(() => {
    persistedWorkspaceChatIdRef.current = "";
  }, []);

  const createProjectWorkspaceChat = useCallback(async (): Promise<string> => {
    if (!selectedProject?.id) {
      return "";
    }
    const created = await chatApi.createChat({
      name: `[project] ${selectedProject.name || selectedProject.id}`,
      session_id: `project-workspace-${selectedProject.id}-${Date.now()}`,
      user_id: "default",
      channel: "console",
      meta: {
        focus_type: "project_workspace",
        focus_id: selectedProject.id,
        project_id: selectedProject.id,
        project_request_id: selectedProject.id,
        focus_path: `projects/${selectedProject.id}`,
      },
    });
    return created?.id || "";
  }, [selectedProject?.id, selectedProject?.name]);

  useEffect(() => {
    if (!selectedProject?.id || !workspaceFocusChatId) {
      return;
    }
    if (persistedWorkspaceChatIdRef.current === workspaceFocusChatId) {
      return;
    }

    persistedWorkspaceChatIdRef.current = workspaceFocusChatId;
    void syncPreferredWorkspaceChatBinding(workspaceFocusChatId).catch((err) => {
      console.warn("failed to persist preferred workspace chat binding", err);
    });
  }, [
    selectedProject?.id,
    syncPreferredWorkspaceChatBinding,
    workspaceFocusChatId,
  ]);

  useEffect(() => {
    if (!selectedProject?.id) {
      return;
    }
    if (selectedRunId || activeDesignChatId || activeWorkspaceChatId) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const preferredCandidate = preferredWorkspaceChatId.trim();
      try {
        const resolved = await resolvePreferredOrLatestWorkspaceChat({
          projectId: selectedProject.id,
          preferredChatId: preferredCandidate,
        });
        if (cancelled) {
          return;
        }

        if (resolved.chatId) {
          persistedWorkspaceChatIdRef.current = resolved.chatId;
          applyWorkspaceChatFocus(resolved.chatId);
          if (!resolved.preferredValid || resolved.chatId !== preferredCandidate) {
            void syncPreferredWorkspaceChatBinding(resolved.chatId).catch(() => {
              // Ignore passive binding sync failures.
            });
          }
          return;
        }

        const createdChatId = await createProjectWorkspaceChat();
        if (!cancelled && createdChatId) {
          persistedWorkspaceChatIdRef.current = createdChatId;
          applyWorkspaceChatFocus(createdChatId);
          void syncPreferredWorkspaceChatBinding(createdChatId).catch(() => {
            // Ignore passive binding sync failures.
          });
          return;
        }
      } catch {
        if (!cancelled) {
          try {
            const createdChatId = await createProjectWorkspaceChat();
            if (createdChatId) {
              persistedWorkspaceChatIdRef.current = createdChatId;
              applyWorkspaceChatFocus(createdChatId);
              void syncPreferredWorkspaceChatBinding(createdChatId).catch(() => {
                // Ignore passive binding sync failures.
              });
            }
          } catch {
            // Keep passive; next state change will retry recovery.
          }
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeDesignChatId,
    activeWorkspaceChatId,
    applyWorkspaceChatFocus,
    createProjectWorkspaceChat,
    preferredWorkspaceChatId,
    selectedProject?.id,
    selectedRunId,
    syncPreferredWorkspaceChatBinding,
  ]);

  return {
    preferredWorkspaceChatId,
    applyWorkspaceChatFocus,
    syncPreferredWorkspaceChatBinding,
    resetPreferredWorkspaceChatBinding,
  };
}