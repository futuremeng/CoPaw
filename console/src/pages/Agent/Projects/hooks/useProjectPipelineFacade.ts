import { useCallback, useMemo } from "react";
import { agentsApi } from "../../../../api/modules/agents";
import type {
  CreateProjectPipelineRunRequest,
  ImportPlatformTemplateRequest,
  RetryProjectPipelineRunRequest,
} from "../../../../api/types/agents";

interface ProjectPipelineFacade {
  listProjectPipelineTemplates: (agentId: string, projectId: string) => ReturnType<typeof agentsApi.listProjectPipelineTemplates>;
  listPlatformFlowTemplates: (agentId: string) => ReturnType<typeof agentsApi.listPlatformFlowTemplates>;
  importPlatformTemplateIntoProject: (
    agentId: string,
    projectId: string,
    body: ImportPlatformTemplateRequest,
  ) => ReturnType<typeof agentsApi.importPlatformTemplateIntoProject>;
  listProjectPipelineRuns: (agentId: string, projectId: string) => ReturnType<typeof agentsApi.listProjectPipelineRuns>;
  getProjectPipelineRun: (
    agentId: string,
    projectId: string,
    runId: string,
  ) => ReturnType<typeof agentsApi.getProjectPipelineRun>;
  createProjectPipelineRun: (
    agentId: string,
    projectId: string,
    body: CreateProjectPipelineRunRequest,
  ) => ReturnType<typeof agentsApi.createProjectPipelineRun>;
  retryProjectPipelineRun: (
    agentId: string,
    projectId: string,
    runId: string,
    body: RetryProjectPipelineRunRequest,
  ) => ReturnType<typeof agentsApi.retryProjectPipelineRun>;
}

export default function useProjectPipelineFacade(): ProjectPipelineFacade {
  const listProjectPipelineTemplates = useCallback((agentId: string, projectId: string) =>
    agentsApi.listProjectPipelineTemplates(agentId, projectId), []);

  const listPlatformFlowTemplates = useCallback((agentId: string) =>
    agentsApi.listPlatformFlowTemplates(agentId), []);

  const importPlatformTemplateIntoProject = useCallback((
    agentId: string,
    projectId: string,
    body: ImportPlatformTemplateRequest,
  ) => agentsApi.importPlatformTemplateIntoProject(agentId, projectId, body), []);

  const listProjectPipelineRuns = useCallback((agentId: string, projectId: string) =>
    agentsApi.listProjectPipelineRuns(agentId, projectId), []);

  const getProjectPipelineRun = useCallback((agentId: string, projectId: string, runId: string) =>
    agentsApi.getProjectPipelineRun(agentId, projectId, runId), []);

  const createProjectPipelineRun = useCallback((
    agentId: string,
    projectId: string,
    body: CreateProjectPipelineRunRequest,
  ) => agentsApi.createProjectPipelineRun(agentId, projectId, body), []);

  const retryProjectPipelineRun = useCallback((
    agentId: string,
    projectId: string,
    runId: string,
    body: RetryProjectPipelineRunRequest,
  ) => agentsApi.retryProjectPipelineRun(agentId, projectId, runId, body), []);

  return useMemo(() => ({
    listProjectPipelineTemplates,
    listPlatformFlowTemplates,
    importPlatformTemplateIntoProject,
    listProjectPipelineRuns,
    getProjectPipelineRun,
    createProjectPipelineRun,
    retryProjectPipelineRun,
  }), [
    createProjectPipelineRun,
    getProjectPipelineRun,
    importPlatformTemplateIntoProject,
    listPlatformFlowTemplates,
    listProjectPipelineRuns,
    listProjectPipelineTemplates,
    retryProjectPipelineRun,
  ]);
}
