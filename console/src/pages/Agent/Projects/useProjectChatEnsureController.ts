import { useCallback } from "react";
import { chatApi } from "../../../api/modules/chat";
import type { AgentProjectSummary } from "../../../api/types/agents";

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
