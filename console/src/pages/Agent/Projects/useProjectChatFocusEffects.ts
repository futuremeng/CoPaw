import { useEffect } from "react";

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
  resolveLatestRunBoundChatId: () => Promise<string>;
  setError: (value: string) => void;
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
  resolveLatestRunBoundChatId,
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
    resolveLatestRunBoundChatId,
    runRestoreAttemptKeyRef,
    selectedProjectId,
    selectedRunId,
    setError,
    setRunFocusChatId,
  ]);
}