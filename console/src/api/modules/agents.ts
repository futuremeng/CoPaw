import { request } from "../request";
import { getApiUrl } from "../config";
import { buildAuthHeaders } from "../authHeaders";
import type {
  AgentListResponse,
  AgentProfileConfig,
  CreateAgentRequest,
  AgentProfileRef,
  AgentsSquareSourcesPayload,
  AgentsSquareSourceSpec,
  ValidateSquareSourceResponse,
  AgentSquareItemsResponse,
  ImportAgentSquareRequest,
  ImportAgentSquareResponse,
  AgentProjectFileInfo,
  AgentProjectFileContent,
  AgentProjectFileSummary,
  AgentProjectSummary,
  ProjectArtifactProfile,
  AgentProjectFileTreeNode,
  CloneProjectRequest,
  CreateProjectRequest,
  DeleteProjectResponse,
  PromoteProjectArtifactRequest,
  PromoteProjectArtifactResponse,
  UpdateProjectArtifactDistillModeRequest,
  UpdateProjectKnowledgeSinkRequest,
  UpdateProjectWorkspaceChatBindingRequest,
  AutoDistillProjectSkillsDraftRequest,
  DistillProjectSkillsDraftResponse,
  ConfirmProjectSkillStableResponse,
  AgentPipelineDraftInfo,
  PipelineSaveStreamEvent,
  ProjectPipelineTemplateInfo,
  PlatformFlowTemplateInfo,
  PlatformTemplateVersionRecord,
  ProjectFlowInstanceInfo,
  ImportPlatformTemplateRequest,
  PublishProjectTemplateRequest,
  ProjectPipelineTemplateStep,
  ProjectPipelineRunSummary,
  ProjectPipelineRunDetail,
  CreateProjectPipelineRunRequest,
  RetryProjectPipelineRunRequest,
  ReorderAgentsResponse,
} from "../types/agents";
import type { MdFileInfo, MdFileContent } from "../types/workspace";

// Multi-agent management API
export const agentsApi = {
  // List all agents
  listAgents: () => request<AgentListResponse>("/agents"),

  // Get agent details
  getAgent: (agentId: string) =>
    request<AgentProfileConfig>(`/agents/${agentId}`),

  // Create new agent
  createAgent: (agent: CreateAgentRequest) =>
    request<AgentProfileRef>("/agents", {
      method: "POST",
      body: JSON.stringify(agent),
    }),

  // Update agent configuration
  updateAgent: (agentId: string, agent: AgentProfileConfig) =>
    request<AgentProfileConfig>(`/agents/${agentId}`, {
      method: "PUT",
      body: JSON.stringify(agent),
    }),

  // Delete agent
  deleteAgent: (agentId: string) =>
    request<{ success: boolean; agent_id: string }>(`/agents/${agentId}`, {
      method: "DELETE",
    }),

  // Persist ordered agent ids
  reorderAgents: (agentIds: string[]) =>
    request<ReorderAgentsResponse>("/agents/order", {
      method: "PUT",
      body: JSON.stringify({ agent_ids: agentIds }),
    }),

  // Toggle agent enabled state
  toggleAgentEnabled: (agentId: string, enabled: boolean) =>
    request<{ success: boolean; agent_id: string; enabled: boolean }>(
      `/agents/${agentId}/toggle`,
      {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      },
    ),

  // Agent workspace files
  listAgentFiles: (agentId: string) =>
    request<MdFileInfo[]>(`/agents/${agentId}/files`),

  readAgentFile: (agentId: string, filename: string) =>
    request<MdFileContent>(
      `/agents/${agentId}/files/${encodeURIComponent(filename)}`,
    ),

  writeAgentFile: (agentId: string, filename: string, content: string) =>
    request<{ written: boolean; filename: string }>(
      `/agents/${agentId}/files/${encodeURIComponent(filename)}`,
      {
        method: "PUT",
        body: JSON.stringify({ content }),
      },
    ),

  // Agent memory files
  listAgentMemory: (agentId: string) =>
    request<MdFileInfo[]>(`/agents/${agentId}/memory`),

  // Agent project files
  listProjectFiles: (agentId: string, projectId: string) =>
    request<AgentProjectFileInfo[]>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/files`,
    ),

  listProjectFileTree: (
    agentId: string,
    projectId: string,
    dirPath = "",
  ) =>
    request<AgentProjectFileTreeNode[]>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/file-tree?dir_path=${encodeURIComponent(dirPath)}`,
    ),

  getProjectFileSummary: (agentId: string, projectId: string) =>
    request<AgentProjectFileSummary>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/summary`,
    ),

  getProjectFilesMetadata: (
    agentId: string,
    projectId: string,
    paths: string[],
  ) =>
    request<AgentProjectFileInfo[]>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/files/metadata`,
      {
        method: "POST",
        body: JSON.stringify({ paths }),
      },
    ),

  cloneProject: (agentId: string, projectId: string, body?: CloneProjectRequest) =>
    request<AgentProjectSummary>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/clone`,
      {
        method: "POST",
        body: JSON.stringify(body || {}),
      },
    ),

  createProject: (agentId: string, body: CreateProjectRequest) =>
    request<AgentProjectSummary>(
      `/agents/${agentId}/projects`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  getProjectArtifactProfile: (agentId: string, projectId: string) =>
    request<ProjectArtifactProfile>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/artifact-profile`,
    ),

  updateProjectArtifactProfile: (
    agentId: string,
    projectId: string,
    body: ProjectArtifactProfile,
  ) =>
    request<AgentProjectSummary>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/artifact-profile`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    ),

  updateProjectArtifactDistillMode: (
    agentId: string,
    projectId: string,
    body: UpdateProjectArtifactDistillModeRequest,
  ) =>
    request<AgentProjectSummary>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/artifact-distill-mode`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    ),

  updateProjectWorkspaceChatBinding: (
    agentId: string,
    projectId: string,
    body: UpdateProjectWorkspaceChatBindingRequest,
  ) =>
    request<AgentProjectSummary>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/workspace-chat-binding`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    ),

  updateProjectKnowledgeSink: (
    agentId: string,
    projectId: string,
    body: UpdateProjectKnowledgeSinkRequest,
  ) =>
    request<AgentProjectSummary>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/knowledge-sink`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    ),

  promoteProjectSkillArtifact: (
    agentId: string,
    projectId: string,
    artifactId: string,
    body?: PromoteProjectArtifactRequest,
  ) =>
    request<PromoteProjectArtifactResponse>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/artifacts/skills/${encodeURIComponent(artifactId)}/promote`,
      {
        method: "POST",
        body: JSON.stringify(body || {}),
      },
    ),

  autoDistillProjectSkillsDraft: (
    agentId: string,
    projectId: string,
    body?: AutoDistillProjectSkillsDraftRequest,
  ) =>
    request<DistillProjectSkillsDraftResponse>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/artifacts/skills/distill-draft`,
      {
        method: "POST",
        body: body ? JSON.stringify(body) : undefined,
      },
    ),

  confirmProjectSkillStable: (
    agentId: string,
    projectId: string,
    artifactId: string,
  ) =>
    request<ConfirmProjectSkillStableResponse>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/artifacts/skills/${encodeURIComponent(artifactId)}/confirm-stable`,
      {
        method: "POST",
      },
    ),

  deleteProject: (agentId: string, projectId: string) =>
    request<DeleteProjectResponse>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}`,
      {
        method: "DELETE",
      },
    ),

  readProjectFile: (agentId: string, projectId: string, filePath: string) =>
    request<AgentProjectFileContent>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/files/${filePath
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/")}`,
    ),

  uploadProjectFile: async (
    agentId: string,
    projectId: string,
    file: File,
    targetDir = "original",
  ) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("target_dir", targetDir);

    const response = await fetch(
      getApiUrl(`/agents/${agentId}/projects/${encodeURIComponent(projectId)}/files/upload`),
      {
        method: "POST",
        headers: buildAuthHeaders(),
        body: formData,
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Upload project file failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ""}`,
      );
    }
    return response.json() as Promise<AgentProjectFileInfo>;
  },

  listAgentPipelineTemplates: (agentId: string) =>
    request<ProjectPipelineTemplateInfo[]>(
      `/agents/${agentId}/pipelines/templates`,
    ),

  saveAgentPipelineTemplate: (
    agentId: string,
    templateId: string,
    body: ProjectPipelineTemplateInfo,
    options?: { expectedRevision?: number },
  ) =>
    request<ProjectPipelineTemplateInfo>(
      `/agents/${agentId}/pipelines/templates/${encodeURIComponent(templateId)}${
        options?.expectedRevision !== undefined
          ? `?expectedRevision=${encodeURIComponent(String(options.expectedRevision))}`
          : ""
      }`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    ),

  saveAgentPipelineTemplateStream: async (
    agentId: string,
    templateId: string,
    body: ProjectPipelineTemplateInfo,
    onEvent: (event: PipelineSaveStreamEvent) => void,
    options?: { expectedRevision?: number; signal?: AbortSignal },
  ) => {
    const query =
      options?.expectedRevision !== undefined
        ? `?expectedRevision=${encodeURIComponent(String(options.expectedRevision))}`
        : "";
    const response = await fetch(
      getApiUrl(`/agents/${agentId}/pipelines/templates/${encodeURIComponent(templateId)}/save/stream${query}`),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders(),
        },
        body: JSON.stringify(body),
        signal: options?.signal,
      },
    );

    if (!response.ok || !response.body) {
      const text = await response.text();
      throw new Error(text || `SSE save failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let eventBreak = buffer.indexOf("\n\n");
      while (eventBreak >= 0) {
        const rawEvent = buffer.slice(0, eventBreak);
        buffer = buffer.slice(eventBreak + 2);

        const line = rawEvent
          .split("\n")
          .find((item) => item.startsWith("data:"));
        if (line) {
          const payload = line.slice(5).trim();
          if (payload) {
            onEvent(JSON.parse(payload) as PipelineSaveStreamEvent);
          }
        }

        eventBreak = buffer.indexOf("\n\n");
      }
    }
  },

  getPipelineDraft: (agentId: string, templateId: string) =>
    request<AgentPipelineDraftInfo>(
      `/agents/${agentId}/pipelines/templates/${encodeURIComponent(templateId)}/draft`,
    ),

  ensurePipelineDraft: (
    agentId: string,
    templateId: string,
    body: ProjectPipelineTemplateInfo,
  ) =>
    request<AgentPipelineDraftInfo>(
      `/agents/${agentId}/pipelines/templates/${encodeURIComponent(templateId)}/draft/ensure`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  listProjectPipelineTemplates: (agentId: string, projectId: string) =>
    request<ProjectPipelineTemplateInfo[]>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/pipelines/templates`,
    ),

  listPlatformFlowTemplates: (agentId: string) =>
    request<PlatformFlowTemplateInfo[]>(
      `/agents/${agentId}/pipelines/platform/templates`,
    ),

  listPlatformTemplateVersions: (agentId: string, templateId: string) =>
    request<PlatformTemplateVersionRecord[]>(
      `/agents/${agentId}/pipelines/platform/templates/${encodeURIComponent(templateId)}/versions`,
    ),

  importPlatformTemplateIntoProject: (
    agentId: string,
    projectId: string,
    body: ImportPlatformTemplateRequest,
  ) =>
    request<ProjectFlowInstanceInfo>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/pipelines/platform/import`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  publishProjectTemplateToPlatform: (
    agentId: string,
    projectId: string,
    templateId: string,
    body: PublishProjectTemplateRequest,
  ) =>
    request<PlatformFlowTemplateInfo>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/pipelines/templates/${encodeURIComponent(templateId)}/publish-platform`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  listProjectPipelineRuns: (agentId: string, projectId: string) =>
    request<ProjectPipelineRunSummary[]>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/pipelines/runs`,
    ),

  getProjectPipelineRun: (agentId: string, projectId: string, runId: string) =>
    request<ProjectPipelineRunDetail>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/pipelines/runs/${encodeURIComponent(runId)}`,
    ),

  createProjectPipelineRun: (
    agentId: string,
    projectId: string,
    body: CreateProjectPipelineRunRequest,
  ) =>
    request<ProjectPipelineRunDetail>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/pipelines/runs`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  retryProjectPipelineRun: (
    agentId: string,
    projectId: string,
    runId: string,
    body: RetryProjectPipelineRunRequest,
  ) =>
    request<ProjectPipelineRunDetail>(
      `/agents/${agentId}/projects/${encodeURIComponent(projectId)}/pipelines/runs/${encodeURIComponent(runId)}/retry`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),

  // Pipeline step operations (add/update/delete individual steps)
  addOrUpdatePipelineStep: async (
    agentId: string,
    templateId: string,
    step: ProjectPipelineTemplateStep,
    operation: "add" | "update" = "update",
    options?: { expectedRevision?: number; signal?: AbortSignal },
  ) => {
    const query = new URLSearchParams();
    query.set("operation", operation);
    if (options?.expectedRevision !== undefined) {
      query.set("expectedRevision", String(options.expectedRevision));
    }
    const queryStr = query.toString();
    return request<ProjectPipelineTemplateInfo>(
      `/agents/${agentId}/pipelines/templates/${encodeURIComponent(templateId)}/steps${queryStr ? "?" + queryStr : ""}`,
      {
        method: "POST",
        body: JSON.stringify(step),
        signal: options?.signal,
      },
    );
  },

  deletePipelineStep: async (
    agentId: string,
    templateId: string,
    stepId: string,
    options?: { expectedRevision?: number; signal?: AbortSignal },
  ) => {
    const query = new URLSearchParams();
    if (options?.expectedRevision !== undefined) {
      query.set("expectedRevision", String(options.expectedRevision));
    }
    const queryStr = query.toString();
    return request<ProjectPipelineTemplateInfo>(
      `/agents/${agentId}/pipelines/templates/${encodeURIComponent(templateId)}/steps/${encodeURIComponent(stepId)}${queryStr ? "?" + queryStr : ""}`,
      {
        method: "DELETE",
        signal: options?.signal,
      },
    );
  },

  /**
   * Unified step operation: routes add/update to the POST endpoint and
   * delete to the DELETE endpoint. Simplifies call sites in the page layer.
   */
  applyStepOperation: async (
    agentId: string,
    templateId: string,
    operation: "add" | "update" | "delete",
    stepOrId: ProjectPipelineTemplateStep | string,
    options?: { expectedRevision?: number; signal?: AbortSignal },
  ): Promise<ProjectPipelineTemplateInfo> => {
    if (operation === "delete") {
      const stepId = typeof stepOrId === "string" ? stepOrId : (stepOrId as ProjectPipelineTemplateStep).id;
      const query = new URLSearchParams();
      if (options?.expectedRevision !== undefined) {
        query.set("expectedRevision", String(options.expectedRevision));
      }
      const queryStr = query.toString();
      return request<ProjectPipelineTemplateInfo>(
        `/agents/${agentId}/pipelines/templates/${encodeURIComponent(templateId)}/steps/${encodeURIComponent(stepId)}${queryStr ? "?" + queryStr : ""}`,
        { method: "DELETE", signal: options?.signal },
      );
    }
    const step = stepOrId as ProjectPipelineTemplateStep;
    const query = new URLSearchParams();
    query.set("operation", operation);
    if (options?.expectedRevision !== undefined) {
      query.set("expectedRevision", String(options.expectedRevision));
    }
    const queryStr = query.toString();
    return request<ProjectPipelineTemplateInfo>(
      `/agents/${agentId}/pipelines/templates/${encodeURIComponent(templateId)}/steps${queryStr ? "?" + queryStr : ""}`,
      { method: "POST", body: JSON.stringify(step), signal: options?.signal },
    );
  },

  // Agents Square
  getSquareSources: () =>
    request<AgentsSquareSourcesPayload>("/agents/square/sources"),

  getSquareDefaultSources: () =>
    request<AgentsSquareSourcesPayload>("/agents/square/sources/defaults"),

  resetSquareSources: () =>
    request<AgentsSquareSourcesPayload>("/agents/square/sources/reset", {
      method: "POST",
    }),

  updateSquareSources: (payload: AgentsSquareSourcesPayload) =>
    request<AgentsSquareSourcesPayload>("/agents/square/sources", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  validateSquareSource: (payload: AgentsSquareSourceSpec) =>
    request<ValidateSquareSourceResponse>("/agents/square/sources/validate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  getSquareItems: (refresh = false) =>
    request<AgentSquareItemsResponse>(
      `/agents/square/items?refresh=${refresh ? "true" : "false"}`,
    ),

  importSquareAgent: (payload: ImportAgentSquareRequest) =>
    request<ImportAgentSquareResponse>("/agents/square/import", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
