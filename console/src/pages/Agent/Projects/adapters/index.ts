import { createProjectScopedAdapter } from "./projectScopedAdapter";
import { createWorkspaceScopedAdapter } from "./workspaceScopedAdapter";
import type {
  ProjectWorkspaceAdapter,
  ProjectWorkspaceAdapterError,
  ProjectWorkspaceScope,
} from "./types";

interface CreateProjectWorkspaceAdapterOptions {
  scope: ProjectWorkspaceScope;
  agentId?: string;
  projectId?: string;
}

export function createProjectWorkspaceAdapter(
  options: CreateProjectWorkspaceAdapterOptions,
): ProjectWorkspaceAdapter {
  if (options.scope === "project") {
    if (!options.agentId || !options.projectId) {
      throw new Error("agentId and projectId are required for project-scoped adapter.");
    }
    return createProjectScopedAdapter({
      agentId: options.agentId,
      projectId: options.projectId,
    });
  }

  return createWorkspaceScopedAdapter();
}

export function normalizeAdapterError(error: unknown): ProjectWorkspaceAdapterError {
  if (error instanceof Error) {
    const status = Number((error as Error & { status?: number }).status || 0) || undefined;
    return {
      status,
      message: error.message || "Unknown adapter error",
    };
  }
  return {
    message: String(error || "Unknown adapter error"),
  };
}

export * from "./capabilities";
export * from "./types";
