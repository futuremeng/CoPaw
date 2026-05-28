import { useCallback, useMemo } from "react";
import { agentsApi } from "../../../../api/modules/agents";

interface ProjectAgentFacade {
  listAgents: () => ReturnType<typeof agentsApi.listAgents>;
  listAgentProjects: (agentId: string) => ReturnType<typeof agentsApi.listAgentProjects>;
  acquireProjectKnowledgeWatchLease: (
    agentId: string,
    projectId: string,
  ) => ReturnType<typeof agentsApi.acquireProjectKnowledgeWatchLease>;
  releaseProjectKnowledgeWatchLease: (
    agentId: string,
    projectId: string,
    leaseId: string,
  ) => ReturnType<typeof agentsApi.releaseProjectKnowledgeWatchLease>;
  deleteProject: (agentId: string, projectId: string) => ReturnType<typeof agentsApi.deleteProject>;
}

export default function useProjectAgentFacade(): ProjectAgentFacade {
  const listAgents = useCallback(() => agentsApi.listAgents(), []);

  const listAgentProjects = useCallback((agentId: string) =>
    agentsApi.listAgentProjects(agentId), []);

  const acquireProjectKnowledgeWatchLease = useCallback((agentId: string, projectId: string) =>
    agentsApi.acquireProjectKnowledgeWatchLease(agentId, projectId), []);

  const releaseProjectKnowledgeWatchLease = useCallback((agentId: string, projectId: string, leaseId: string) =>
    agentsApi.releaseProjectKnowledgeWatchLease(agentId, projectId, leaseId), []);

  const deleteProject = useCallback((agentId: string, projectId: string) =>
    agentsApi.deleteProject(agentId, projectId), []);

  return useMemo(() => ({
    listAgents,
    listAgentProjects,
    acquireProjectKnowledgeWatchLease,
    releaseProjectKnowledgeWatchLease,
    deleteProject,
  }), [
    acquireProjectKnowledgeWatchLease,
    deleteProject,
    listAgentProjects,
    listAgents,
    releaseProjectKnowledgeWatchLease,
  ]);
}
