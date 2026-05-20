import { getApiUrl } from "../config";
import { request } from "../request";
import type {
  KnowledgeBulkIndexResult,
  KnowledgeConfig,
  KnowledgeHistoryBackfillRunResponse,
  KnowledgeHistoryBackfillStatus,
  KnowledgeRestoreResponse,
  KnowledgeIndexResult,
  KnowledgeClearResponse,
  KnowledgeSearchResponse,
  KnowledgeSourceContent,
  KnowledgeSourceSpec,
  KnowledgeSourcesResponse,
  GraphQueryResponse,
  KnowledgeTasksSnapshot,
  MemifyJobStatus,
  MemifyStartRequest,
  MemifyStartResponse,
  QualityLoopJobStatus,
  QualityLoopJobsListResponse,
  QualityLoopStartRequest,
  QualityLoopStartResponse,
  ProjectKnowledgeFileAnalysisStatsResponse,
  ProjectKnowledgeStepStatsStepId,
  ProjectKnowledgeStepStatsResponse,
  ProjectKnowledgeSourceScanStatsResponse,
  ProjectKnowledgePipelineRunRequest,
  ProjectKnowledgePipelineRunResponse,
  ProjectKnowledgePipelineState,
} from "../types";

const withProjectId = (path: string, projectId?: string) => {
  const normalized = (projectId || "").trim();
  if (!normalized) {
    return path;
  }
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}project_id=${encodeURIComponent(normalized)}`;
};

const withLimit = (path: string, limit?: number) => (
  typeof limit === "number"
    ? `${path}?limit=${encodeURIComponent(String(limit))}`
    : path
);

export const knowledgeApi = {
  getKnowledgeConfig: () => request<KnowledgeConfig>("/knowledge/config"),

  updateKnowledgeConfig: (payload: KnowledgeConfig) =>
    request<KnowledgeConfig>("/knowledge/config", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  listKnowledgeSources: (options?: { projectId?: string; includeSemantic?: boolean }) =>
    request<KnowledgeSourcesResponse>(
      withProjectId(
        options?.includeSemantic
          ? "/knowledge/sources?include_semantic=true"
          : "/knowledge/sources",
        options?.projectId,
      ),
    ),

  getProjectStepStats: <TStepId extends ProjectKnowledgeStepStatsStepId>(
    stepId: TStepId,
    projectId: string,
    options?: { limit?: number },
  ) =>
    request<ProjectKnowledgeStepStatsResponse<TStepId>>(
      withProjectId(
        withLimit(`/knowledge/project-stats/${encodeURIComponent(stepId)}`, options?.limit),
        projectId,
      ),
    ),

  getProjectFileAnalysisStats: (projectId: string, options?: { limit?: number }) =>
    knowledgeApi.getProjectStepStats("build_chunks", projectId, options) as Promise<ProjectKnowledgeFileAnalysisStatsResponse>,

  getProjectSourceScanStats: (projectId: string, options?: { limit?: number }) =>
    knowledgeApi.getProjectStepStats("snapshot_raw", projectId, options) as Promise<ProjectKnowledgeSourceScanStatsResponse>,

  upsertKnowledgeSource: (
    payload: KnowledgeSourceSpec,
    options?: { projectId?: string },
  ) =>
    request<KnowledgeSourceSpec>(
      withProjectId("/knowledge/sources", options?.projectId),
      {
      method: "PUT",
      body: JSON.stringify(payload),
      },
    ),

  uploadKnowledgeFile: async (sourceId: string, file: File) => {
    const formData = new FormData();
    formData.append("source_id", sourceId);
    formData.append("file", file);

    const response = await fetch(getApiUrl("/knowledge/upload/file"), {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Upload failed: ${response.status} ${response.statusText}${
          text ? ` - ${text}` : ""
        }`,
      );
    }
    return (await response.json()) as { location: string; filename: string };
  },

  uploadKnowledgeDirectory: async (
    sourceId: string,
    files: Array<{ file: File; relativePath: string }>,
  ) => {
    const formData = new FormData();
    formData.append("source_id", sourceId);
    files.forEach(({ file, relativePath }) => {
      formData.append("files", file);
      formData.append("relative_paths", relativePath);
    });

    const response = await fetch(getApiUrl("/knowledge/upload/directory"), {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Upload failed: ${response.status} ${response.statusText}${
          text ? ` - ${text}` : ""
        }`,
      );
    }
    return (await response.json()) as { location: string; file_count: number };
  },

  deleteKnowledgeSource: (sourceId: string, options?: { projectId?: string }) =>
    request<{ deleted: boolean; source_id: string }>(
      withProjectId(
        `/knowledge/sources/${encodeURIComponent(sourceId)}`,
        options?.projectId,
      ),
      {
        method: "DELETE",
      },
    ),

  clearKnowledge: (params?: { removeSources?: boolean; projectId?: string }) =>
    request<KnowledgeClearResponse>(
      withProjectId(
        `/knowledge/clear?confirm=true&remove_sources=${
          params?.removeSources === false ? "false" : "true"
        }`,
        params?.projectId,
      ),
      {
        method: "DELETE",
      },
    ),

  indexKnowledgeSource: (sourceId: string, options?: { projectId?: string }) =>
    request<KnowledgeIndexResult>(
      withProjectId(
        `/knowledge/sources/${encodeURIComponent(sourceId)}/index`,
        options?.projectId,
      ),
      {
        method: "POST",
      },
    ),

  indexAllKnowledgeSources: (options?: { projectId?: string }) =>
    request<KnowledgeBulkIndexResult>(withProjectId("/knowledge/index", options?.projectId), {
      method: "POST",
    }),

  getKnowledgeHistoryBackfillStatus: () =>
    request<KnowledgeHistoryBackfillStatus>("/knowledge/history-backfill/status"),

  getKnowledgeTasksSnapshot: (options?: { projectId?: string }) =>
    request<KnowledgeTasksSnapshot>(
      withProjectId("/knowledge/tasks/snapshot", options?.projectId),
    ),

  runNlpTaskDemo: (
    taskKey: string,
    payload: {
      text?: string;
      tokens?: string[];
      texts?: string[];
      tokens_batch?: string[][];
      request_id?: string;
    },
  ) =>
    request<{
      task_key: string;
      request_id: string;
      status: string;
      reason_code: string;
      reason: string;
      result: unknown;
      raw_result?: unknown;
      pretty_print?: string;
      resolved_model: string;
      strategy_mode: string;
      detected_style: string;
      detection_score: number;
      matched_rules: string[];
      fallback_used: boolean;
      duration_ms: number;
      model_cache_path?: string;
      runtime_python_executable?: string;
      effective_task_model_id?: string;
      preload_status?: string;
      sidecar_elapsed_ms?: number;
      sidecar_trace_elapsed_ms?: number;
      sidecar_execution_path?: string;
      sidecar_execution_detail?: string;
      sidecar_trace_stage_ms?: Record<string, number>;
    }>(`/knowledge/tasks/${encodeURIComponent(taskKey)}/run`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  runKnowledgeHistoryBackfillNow: () =>
    request<KnowledgeHistoryBackfillRunResponse>("/knowledge/history-backfill/run", {
      method: "POST",
    }),

  getKnowledgeSourceContent: (sourceId: string, options?: { projectId?: string }) =>
    request<KnowledgeSourceContent>(
      withProjectId(
        `/knowledge/sources/${encodeURIComponent(sourceId)}/content`,
        options?.projectId,
      ),
    ),

  searchKnowledge: (params: {
    query: string;
    limit?: number;
    sourceIds?: string[];
    sourceTypes?: string[];
    scopeType?: "agent" | "project";
    scopeId?: string;
    projectScope?: string[];
    includeGlobal?: boolean;
    projectId?: string;
  }) => {
    const searchParams = new URLSearchParams({
      q: params.query,
      limit: String(params.limit ?? 10),
    });
    if (params.sourceIds?.length) {
      searchParams.set("source_ids", params.sourceIds.join(","));
    }
    if (params.sourceTypes?.length) {
      searchParams.set("source_types", params.sourceTypes.join(","));
    }
    if (params.scopeType) {
      searchParams.set("scope_type", params.scopeType);
    }
    if (params.scopeId) {
      searchParams.set("scope_id", params.scopeId);
    }
    if (params.projectScope?.length) {
      searchParams.set("project_scope", params.projectScope.join(","));
    }
    if (params.includeGlobal !== undefined) {
      searchParams.set("include_global", String(params.includeGlobal));
    }
    return request<KnowledgeSearchResponse>(
      withProjectId(`/knowledge/search?${searchParams.toString()}`, params.projectId),
    );
  },

  graphQuery: (params: {
    query: string;
    mode?: "template" | "cypher";
    outputMode?: "fast" | "nlp" | "agentic";
    datasetScope?: string[];
    scopeType?: "agent" | "project";
    scopeId?: string;
    topK?: number;
    timeoutSec?: number;
    projectScope?: string[];
    includeGlobal?: boolean;
    projectId?: string;
  }) => {
    const searchParams = new URLSearchParams({
      q: params.query,
      mode: params.mode ?? "template",
      top_k: String(params.topK ?? 10),
      timeout_sec: String(params.timeoutSec ?? 20),
    });
    if (params.outputMode) {
      searchParams.set("output_mode", params.outputMode);
    }
    if (params.datasetScope?.length) {
      searchParams.set("dataset_scope", params.datasetScope.join(","));
    }
    if (params.scopeType) {
      searchParams.set("scope_type", params.scopeType);
    }
    if (params.scopeId) {
      searchParams.set("scope_id", params.scopeId);
    }
    if (params.projectScope?.length) {
      searchParams.set("project_scope", params.projectScope.join(","));
    }
    if (params.includeGlobal !== undefined) {
      searchParams.set("include_global", String(params.includeGlobal));
    }
    return request<GraphQueryResponse>(
      withProjectId(`/knowledge/graph-query?${searchParams.toString()}`, params.projectId),
    );
  },

  startMemifyJob: (payload?: MemifyStartRequest) =>
    request<MemifyStartResponse>(
      withProjectId("/knowledge/memify/jobs", payload?.project_id),
      {
      method: "POST",
      body: JSON.stringify({
        pipeline_type: payload?.pipeline_type ?? "full",
        dataset_scope: payload?.dataset_scope ?? [],
        idempotency_key: payload?.idempotency_key ?? "",
        dry_run: payload?.dry_run ?? false,
        project_id: payload?.project_id ?? "",
      }),
      },
    ),

  getMemifyJobStatus: (jobId: string, options?: { projectId?: string }) =>
    request<MemifyJobStatus>(
      withProjectId(
        `/knowledge/memify/jobs/${encodeURIComponent(jobId)}`,
        options?.projectId,
      ),
    ),

  startQualityLoop: (payload?: QualityLoopStartRequest) =>
    request<QualityLoopStartResponse>(
      withProjectId("/knowledge/quality-loop/run", payload?.project_id),
      {
        method: "POST",
        body: JSON.stringify({
          max_rounds: payload?.max_rounds ?? 3,
          dry_run: payload?.dry_run ?? false,
          dataset_scope: payload?.dataset_scope ?? [],
        }),
      },
    ),

  getQualityLoopJobStatus: (jobId: string, options?: { projectId?: string }) =>
    request<QualityLoopJobStatus>(
      withProjectId(
        `/knowledge/quality-loop/jobs/${encodeURIComponent(jobId)}`,
        options?.projectId,
      ),
    ),

  listQualityLoopJobs: (options?: {
    projectId?: string;
    activeOnly?: boolean;
    limit?: number;
  }) =>
    request<QualityLoopJobsListResponse>(
      withProjectId(
        `/knowledge/quality-loop/jobs?active_only=${options?.activeOnly ? "true" : "false"}&limit=${Math.max(1, Math.min(50, Number(options?.limit) || 10))}`,
        options?.projectId,
      ),
    ),

  getProjectKnowledgePipelineStatus: (options: { projectId: string }) =>
    request<ProjectKnowledgePipelineState>(
      withProjectId("/knowledge/project-pipeline/status", options.projectId),
    ),

  runProjectKnowledgePipeline: (payload: ProjectKnowledgePipelineRunRequest) =>
    request<ProjectKnowledgePipelineRunResponse>(
      withProjectId("/knowledge/project-pipeline/run", payload.projectId),
      {
        method: "POST",
        body: JSON.stringify({
          trigger: payload.trigger ?? "manual",
          changed_paths: payload.changedPaths ?? [],
          force: payload.force ?? false,
          processing_mode: payload.processingMode ?? "agentic",
          quantization_stage: payload.quantizationStage ?? null,
          idempotency_key: payload.idempotencyKey ?? "",
        }),
      },
    ),

  downloadKnowledgeBackup: async (options?: { projectId?: string }): Promise<Blob> => {
    const response = await fetch(getApiUrl(withProjectId("/knowledge/backup", options?.projectId)), {
      method: "GET",
    });
    if (!response.ok) {
      throw new Error(
        `Knowledge backup failed: ${response.status} ${response.statusText}`,
      );
    }
    return await response.blob();
  },

  downloadKnowledgeSourceBackup: async (
    sourceId: string,
    options?: { projectId?: string },
  ): Promise<Blob> => {
    const response = await fetch(
      getApiUrl(
        withProjectId(
          `/knowledge/backup/${encodeURIComponent(sourceId)}`,
          options?.projectId,
        ),
      ),
      {
        method: "GET",
      },
    );
    if (!response.ok) {
      throw new Error(
        `Knowledge source backup failed: ${response.status} ${response.statusText}`,
      );
    }
    return await response.blob();
  },

  restoreKnowledgeBackup: async (
    file: File,
    replaceExisting = true,
    options?: { projectId?: string },
  ): Promise<KnowledgeRestoreResponse> => {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(
      getApiUrl(
        withProjectId(
          `/knowledge/restore?replace_existing=${replaceExisting ? "true" : "false"}`,
          options?.projectId,
        ),
      ),
      {
        method: "POST",
        body: formData,
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Knowledge restore failed: ${response.status} ${response.statusText}${
          text ? ` - ${text}` : ""
        }`,
      );
    }
    return (await response.json()) as KnowledgeRestoreResponse;
  },
};