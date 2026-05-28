import { useCallback, useMemo } from "react";
import {
  createProjectWorkspaceAdapter,
  normalizeAdapterError,
  type ProjectWorkspaceAdapter,
  type ProjectWorkspaceAdapterError,
  type ProjectWorkspaceDeleteOutput,
  type ProjectWorkspaceMkdirOutput,
  type ProjectWorkspaceMoveOutput,
  type ProjectWorkspaceQueryInput,
  type ProjectWorkspaceQueryOutput,
  type ProjectWorkspaceReadOutput,
  type ProjectWorkspaceWatchEvent,
  type ProjectWorkspaceWriteOutput,
} from "../adapters";
import type { AgentProjectFileSummary } from "../../../../api/types/agents";

interface UseProjectWorkspaceFacadeParams {
  agentId?: string;
  projectId?: string;
  scope?: "project" | "workspace";
}

interface ProjectWorkspaceFacade {
  adapter: ProjectWorkspaceAdapter | null;
  getProjectAdapter: (projectIdOverride?: string) => ProjectWorkspaceAdapter | null;
  queryFiles: (input: ProjectWorkspaceQueryInput) => Promise<ProjectWorkspaceQueryOutput>;
  getFileSummary: () => Promise<AgentProjectFileSummary>;
  listTree: (dirPath?: string) => ReturnType<ProjectWorkspaceAdapter["listTree"]>;
  readText: (path: string) => Promise<ProjectWorkspaceReadOutput>;
  writeText: (path: string, content: string) => Promise<ProjectWorkspaceWriteOutput>;
  mkdir: (path: string) => Promise<ProjectWorkspaceMkdirOutput>;
  move: (
    sourcePath: string,
    targetPath: string,
    conflictStrategy?: "fail_if_exists" | "overwrite",
  ) => Promise<ProjectWorkspaceMoveOutput>;
  remove: (path: string, isDirectory?: boolean) => Promise<ProjectWorkspaceDeleteOutput>;
  upload: (file: File, targetDir?: string, relativePath?: string) => Promise<void>;
  watch: (subscriber: (events: ProjectWorkspaceWatchEvent[]) => void) => () => void;
  getBinaryUrl: (path: string) => string;
  normalizeError: (error: unknown) => ProjectWorkspaceAdapterError;
}

function createUnavailableError(): Error {
  return new Error("Project workspace adapter is unavailable.");
}

export default function useProjectWorkspaceFacade(
  params: UseProjectWorkspaceFacadeParams,
): ProjectWorkspaceFacade {
  const { agentId, projectId, scope = "project" } = params;

  const adapter = useMemo(() => {
    if (scope === "project") {
      if (!agentId || !projectId) {
        return null;
      }
      return createProjectWorkspaceAdapter({
        scope,
        agentId,
        projectId,
      });
    }
    return createProjectWorkspaceAdapter({ scope });
  }, [agentId, projectId, scope]);

  const getProjectAdapter = useCallback((projectIdOverride = ""): ProjectWorkspaceAdapter | null => {
    if (scope !== "project") {
      return adapter;
    }
    if (!agentId) {
      return null;
    }
    const effectiveProjectId = String(projectIdOverride || projectId || "").trim();
    if (!effectiveProjectId) {
      return null;
    }
    return createProjectWorkspaceAdapter({
      scope: "project",
      agentId,
      projectId: effectiveProjectId,
    });
  }, [adapter, agentId, projectId, scope]);

  const queryFiles = useCallback(async (input: ProjectWorkspaceQueryInput) => {
    if (!adapter) {
      throw createUnavailableError();
    }
    return adapter.queryFiles(input);
  }, [adapter]);

  const listTree = useCallback(async (dirPath = "") => {
    if (!adapter) {
      throw createUnavailableError();
    }
    return adapter.listTree(dirPath);
  }, [adapter]);

  const getFileSummary = useCallback(async () => {
    if (!adapter) {
      throw createUnavailableError();
    }
    return adapter.getFileSummary();
  }, [adapter]);

  const readText = useCallback(async (path: string) => {
    if (!adapter) {
      throw createUnavailableError();
    }
    return adapter.readText(path);
  }, [adapter]);

  const writeText = useCallback(async (path: string, content: string) => {
    if (!adapter) {
      throw createUnavailableError();
    }
    return adapter.writeText(path, content);
  }, [adapter]);

  const mkdir = useCallback(async (path: string) => {
    if (!adapter) {
      throw createUnavailableError();
    }
    return adapter.mkdir(path);
  }, [adapter]);

  const move = useCallback(async (
    sourcePath: string,
    targetPath: string,
    conflictStrategy?: "fail_if_exists" | "overwrite",
  ) => {
    if (!adapter) {
      throw createUnavailableError();
    }
    return adapter.move(sourcePath, targetPath, conflictStrategy);
  }, [adapter]);

  const remove = useCallback(async (path: string, isDirectory = false) => {
    if (!adapter) {
      throw createUnavailableError();
    }
    return adapter.remove(path, isDirectory);
  }, [adapter]);

  const upload = useCallback(async (file: File, targetDir = "", relativePath = "") => {
    if (!adapter) {
      throw createUnavailableError();
    }
    return adapter.upload(file, targetDir, relativePath);
  }, [adapter]);

  const watch = useCallback((subscriber: (events: ProjectWorkspaceWatchEvent[]) => void) => {
    if (!adapter) {
      return () => undefined;
    }
    return adapter.watch(subscriber);
  }, [adapter]);

  const getBinaryUrl = useCallback((path: string) => {
    if (!adapter) {
      throw createUnavailableError();
    }
    return adapter.getBinaryUrl(path);
  }, [adapter]);

  return useMemo(() => ({
    adapter,
    getProjectAdapter,
    queryFiles,
    getFileSummary,
    listTree,
    readText,
    writeText,
    mkdir,
    move,
    remove,
    upload,
    watch,
    getBinaryUrl,
    normalizeError: normalizeAdapterError,
  }), [
    adapter,
    getBinaryUrl,
    getFileSummary,
    getProjectAdapter,
    listTree,
    mkdir,
    move,
    queryFiles,
    readText,
    remove,
    upload,
    watch,
    writeText,
  ]);
}
