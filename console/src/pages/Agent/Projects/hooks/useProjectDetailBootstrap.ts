import { useCallback } from "react";
import type { AgentProjectSummary, AgentSummary } from "../../../../api/types/agents";

interface UseProjectDetailBootstrapParams {
  currentAgent?: AgentSummary;
  selectedProject?: AgentProjectSummary;
  loadProjectFiles: (
    agentId: string,
    project: AgentProjectSummary,
    options?: { preserveSelection?: boolean },
  ) => Promise<string>;
  loadProjectTreeRoot: (
    agentId: string,
    project: AgentProjectSummary,
    preferredProjectRequestId?: string,
  ) => Promise<void>;
  loadProjectFileSummary: (
    agentId: string,
    project: AgentProjectSummary,
    preferredProjectRequestId?: string,
  ) => Promise<unknown>;
}

export default function useProjectDetailBootstrap({
  currentAgent,
  selectedProject,
  loadProjectFiles,
  loadProjectTreeRoot,
  loadProjectFileSummary,
}: UseProjectDetailBootstrapParams) {
  const bootstrapProjectDetailData = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
    options?: { preserveSelection?: boolean },
  ) => {
    const preserveSelection = options?.preserveSelection ?? true;
    const projectRequestId = await loadProjectFiles(agentId, project, { preserveSelection });
    if (!projectRequestId) {
      return;
    }
    await Promise.allSettled([
      loadProjectTreeRoot(agentId, project, projectRequestId),
      loadProjectFileSummary(agentId, project, projectRequestId),
    ]);
  }, [loadProjectFileSummary, loadProjectFiles, loadProjectTreeRoot]);

  const handleRefreshProjectFiles = useCallback(async () => {
    if (!currentAgent || !selectedProject) {
      return;
    }

    await bootstrapProjectDetailData(currentAgent.id, selectedProject, { preserveSelection: true });
  }, [bootstrapProjectDetailData, currentAgent, selectedProject]);

  return {
    bootstrapProjectDetailData,
    handleRefreshProjectFiles,
  };
}
