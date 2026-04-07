import { useCallback, useEffect, useMemo, useRef } from "react";
import { agentsApi } from "../../../api/modules/agents";
import type {
  AgentProjectSummary,
  ProjectPipelineRunDetail,
} from "../../../api/types/agents";

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

interface UsePreferredProjectWorkspaceChatParams {
  currentAgentId?: string;
  selectedProject?: AgentProjectSummary;
  workspaceFocusChatId: string;
  activeWorkspaceChatId: string;
  activeDesignChatId: string;
  selectedRunId: string;
  chatStarting: boolean;
  handleEnsureWorkspaceChat: () => Promise<string>;
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
  chatStarting,
  handleEnsureWorkspaceChat,
  setSelectedRunId,
  setSelectedStepId,
  setRunDetail,
  setRunFocusChatId,
  setDesignFocusChatId,
  setWorkspaceFocusChatId,
}: UsePreferredProjectWorkspaceChatParams) {
  const persistedWorkspaceChatIdRef = useRef("");
  const workspaceAutoInitProjectKeyRef = useRef("");

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

    workspaceAutoInitProjectKeyRef.current = selectedProject.id;

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
    workspaceAutoInitProjectKeyRef.current = "";
  }, []);

  useEffect(() => {
    if (!preferredWorkspaceChatId) {
      return;
    }
    persistedWorkspaceChatIdRef.current = preferredWorkspaceChatId;
    applyWorkspaceChatFocus(preferredWorkspaceChatId);
  }, [applyWorkspaceChatFocus, preferredWorkspaceChatId]);

  useEffect(() => {
    if (!currentAgentId || !selectedProject?.id || !workspaceFocusChatId) {
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
    currentAgentId,
    selectedProject?.id,
    syncPreferredWorkspaceChatBinding,
    workspaceFocusChatId,
  ]);

  useEffect(() => {
    if (!selectedProject?.id) {
      return;
    }
    if (preferredWorkspaceChatId) {
      return;
    }
    if (selectedRunId || activeWorkspaceChatId || activeDesignChatId || chatStarting) {
      return;
    }

    const autoInitKey = selectedProject.id;
    if (workspaceAutoInitProjectKeyRef.current === autoInitKey) {
      return;
    }
    workspaceAutoInitProjectKeyRef.current = autoInitKey;

    void handleEnsureWorkspaceChat().then((chatId) => {
      if (!chatId) {
        workspaceAutoInitProjectKeyRef.current = "";
      }
    });
  }, [
    activeDesignChatId,
    activeWorkspaceChatId,
    chatStarting,
    handleEnsureWorkspaceChat,
    preferredWorkspaceChatId,
    selectedProject?.id,
    selectedRunId,
  ]);

  return {
    preferredWorkspaceChatId,
    applyWorkspaceChatFocus,
    syncPreferredWorkspaceChatBinding,
    resetPreferredWorkspaceChatBinding,
  };
}