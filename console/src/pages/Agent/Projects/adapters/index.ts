import { createProjectScopedAdapter } from "./projectScopedAdapter";
import { createWorkspaceScopedAdapter } from "./workspaceScopedAdapter";
import { normalizeProjectApiError } from "../utils/projectApiError";
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
  return normalizeProjectApiError(error);
}

export * from "./capabilities";
export * from "./types";
