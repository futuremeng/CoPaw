import { agentsApi } from "../../../../api/modules/agents";
import type { AgentProjectFileQueryRequest } from "../../../../api/types/agents";
import {
  PROJECT_SCOPED_CAPABILITIES,
  isPathReadonly,
} from "./capabilities";
import type {
  ProjectWorkspaceAdapter,
  ProjectWorkspaceQueryInput,
  ProjectWorkspaceQueryOutput,
} from "./types";

interface ProjectScopedAdapterOptions {
  agentId: string;
  projectId: string;
}

function toProjectQueryBody(input: ProjectWorkspaceQueryInput): AgentProjectFileQueryRequest {
  const body: AgentProjectFileQueryRequest = {
    include_ignored: input.includeIgnored ?? false,
    sort_by: input.sortBy ?? "path",
    sort_order: input.sortOrder ?? "asc",
    offset: input.offset ?? 0,
    limit: input.limit ?? 5000,
  };

  if (input.search) {
    body.search = input.search;
  }
  if (input.pathPrefix) {
    body.path_prefix = input.pathPrefix;
  }
  if (Array.isArray(input.stages) && input.stages.length > 0) {
    body.stages = input.stages as AgentProjectFileQueryRequest["stages"];
  }
  if (Array.isArray(input.contentTypes) && input.contentTypes.length > 0) {
    body.content_types = input.contentTypes as AgentProjectFileQueryRequest["content_types"];
  }
  if (input.includeBuiltin !== undefined) {
    body.include_builtin = input.includeBuiltin;
  }

  return body;
}

function toProjectQueryOutput(input: ProjectWorkspaceQueryOutput): ProjectWorkspaceQueryOutput {
  return input;
}

export function createProjectScopedAdapter(options: ProjectScopedAdapterOptions): ProjectWorkspaceAdapter {
  const { agentId, projectId } = options;

  return {
    getScope: () => "project",
    getCapabilities: () => PROJECT_SCOPED_CAPABILITIES,
    queryFiles: async (input) => {
      const payload = await agentsApi.queryProjectFiles(agentId, projectId, toProjectQueryBody(input));
      return toProjectQueryOutput({
        items: payload.items.map((item) => ({
          filename: item.filename,
          path: item.path,
          size: item.size,
          modifiedTime: item.modified_time,
          stage: item.stage,
          contentType: item.content_type,
          builtin: item.builtin,
          ignored: item.ignored,
          readonly: isPathReadonly(item.path, PROJECT_SCOPED_CAPABILITIES.readonlyPathRules),
        })),
        summary: {
          totalMatched: payload.summary.total_matched,
          returned: payload.summary.returned,
          offset: payload.summary.offset,
          limit: payload.summary.limit,
          builtinCount: payload.summary.builtin_count,
          ignoredCount: payload.summary.ignored_count,
          stageCounts: payload.summary.stage_counts,
          contentTypeCounts: payload.summary.content_type_counts,
        },
        queryMeta: {
          search: payload.query_meta.search,
          pathPrefix: payload.query_meta.path_prefix,
          stages: payload.query_meta.stages,
          contentTypes: payload.query_meta.content_types,
          includeBuiltin: payload.query_meta.include_builtin,
          includeIgnored: payload.query_meta.include_ignored,
          sortBy: payload.query_meta.sort_by,
          sortOrder: payload.query_meta.sort_order,
        },
      });
    },
    getFileSummary: async () => agentsApi.getProjectFileSummary(agentId, projectId),
    listTree: async (dirPath = "") => agentsApi.listProjectFileTree(agentId, projectId, dirPath),
    readText: async (path) => {
      const payload = await agentsApi.readProjectFile(agentId, projectId, path);
      return { content: payload.content || "" };
    },
    writeText: async () => {
      throw new Error("Project scoped adapter does not support direct file writes yet.");
    },
    getBinaryUrl: (path) => agentsApi.getProjectBinaryFileUrl(agentId, projectId, path),
    mkdir: async (path) => {
      const payload = await agentsApi.createProjectDirectory(agentId, projectId, { path });
      return {
        success: payload.success,
        path: payload.path,
        existed: payload.existed,
      };
    },
    move: async (sourcePath, targetPath, conflictStrategy = "fail_if_exists") => {
      const payload = await agentsApi.moveProjectPath(agentId, projectId, {
        source_path: sourcePath,
        target_path: targetPath,
        conflict_strategy: conflictStrategy,
      });
      return {
        success: payload.success,
        sourcePath: payload.source_path,
        targetPath: payload.target_path,
        isDirectory: payload.is_directory,
      };
    },
    remove: async (path, isDirectory = false) => {
      const payload = await agentsApi.deleteProjectPath(agentId, projectId, path);
      return {
        success: payload.success,
        path: payload.path,
        isDirectory: payload.is_directory ?? isDirectory,
      };
    },
    upload: async (file, targetDir = "", relativePath = "") => {
      await agentsApi.uploadProjectFile(agentId, projectId, file, targetDir, relativePath);
    },
    watch: () => {
      // Project-level realtime watch is currently disabled in the page layer.
      return () => undefined;
    },
  };
}
