import type { AgentProjectFileTreeNode } from "../../../../api/types/agents";
import type { AgentProjectFileSummary } from "../../../../api/types/agents";

export type ProjectWorkspaceScope = "project" | "workspace";

export type ProjectWorkspaceChangeType = "added" | "modified" | "deleted";

export interface ProjectWorkspaceWatchEvent {
  change: ProjectWorkspaceChangeType;
  path: string;
  source: ProjectWorkspaceScope;
}

export interface ProjectWorkspaceFileItem {
  filename: string;
  path: string;
  size: number;
  modifiedTime: string;
  stage?: "original" | "intermediate" | "artifact" | "builtin" | "other";
  contentType?: "markdown" | "text" | "script" | "other";
  builtin?: boolean;
  ignored?: boolean;
  readonly?: boolean;
}

export interface ProjectWorkspaceQueryInput {
  search?: string;
  pathPrefix?: string;
  stages?: string[];
  contentTypes?: string[];
  includeBuiltin?: boolean | null;
  includeIgnored?: boolean;
  sortBy?: "path" | "modified_time" | "size";
  sortOrder?: "asc" | "desc";
  offset?: number;
  limit?: number;
}

export interface ProjectWorkspaceQueryOutput {
  items: ProjectWorkspaceFileItem[];
  summary: {
    totalMatched: number;
    returned: number;
    offset: number;
    limit: number;
    builtinCount?: number;
    ignoredCount?: number;
    stageCounts?: Record<string, number>;
    contentTypeCounts?: Record<string, number>;
  };
  queryMeta?: Record<string, unknown>;
}

export interface ProjectWorkspaceReadOutput {
  content: string;
  status?: number;
  etag?: string;
  truncated?: boolean;
}

export interface ProjectWorkspaceWriteOutput {
  path: string;
  size?: number;
}

export interface ProjectWorkspaceMoveOutput {
  success: boolean;
  sourcePath: string;
  targetPath: string;
  isDirectory: boolean;
}

export interface ProjectWorkspaceDeleteOutput {
  success: boolean;
  path: string;
  isDirectory: boolean;
}

export interface ProjectWorkspaceMkdirOutput {
  success: boolean;
  path: string;
  existed?: boolean;
}

export interface ProjectWorkspaceCapabilities {
  supportsStages: boolean;
  supportsContentTypes: boolean;
  supportsPathPrefix: boolean;
  supportsWatch: boolean;
  supportsEtag: boolean;
  supportsDirectoryOps: boolean;
  supportsUploadRelativePath: boolean;
  readonlyPathRules?: string[];
}

export interface ProjectWorkspaceAdapterError {
  status?: number;
  message: string;
  code?: string;
}

export interface ProjectWorkspaceAdapter {
  getScope: () => ProjectWorkspaceScope;
  getCapabilities: () => ProjectWorkspaceCapabilities;
  queryFiles: (input: ProjectWorkspaceQueryInput) => Promise<ProjectWorkspaceQueryOutput>;
  getFileSummary: () => Promise<AgentProjectFileSummary>;
  listTree: (dirPath?: string) => Promise<AgentProjectFileTreeNode[]>;
  readText: (path: string) => Promise<ProjectWorkspaceReadOutput>;
  writeText: (path: string, content: string) => Promise<ProjectWorkspaceWriteOutput>;
  getBinaryUrl: (path: string) => string;
  mkdir: (path: string) => Promise<ProjectWorkspaceMkdirOutput>;
  move: (
    sourcePath: string,
    targetPath: string,
    conflictStrategy?: "fail_if_exists" | "overwrite",
  ) => Promise<ProjectWorkspaceMoveOutput>;
  remove: (path: string, isDirectory?: boolean) => Promise<ProjectWorkspaceDeleteOutput>;
  upload: (file: File, targetDir?: string, relativePath?: string) => Promise<void>;
  watch: (subscriber: (events: ProjectWorkspaceWatchEvent[]) => void) => () => void;
}
