import { buildProjectIdCandidates } from "./projectIdUtils";
import type { AgentProjectSummary } from "../../../../api/types/agents";

export function buildProjectRequestCandidates(project: AgentProjectSummary, params?: {
  preferredProjectRequestId?: string;
  routeProjectId?: string;
}): string[] {
  return [
    params?.preferredProjectRequestId || "",
    params?.routeProjectId || "",
    ...buildProjectIdCandidates(project),
  ]
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function resolveProjectRequestCandidate<T>(params: {
  projectRequestIds: string[];
  loader: (projectRequestId: string) => Promise<T>;
  retryCount?: number;
  retryDelayMs?: number;
}): Promise<{ projectRequestId: string; value: T }> {
  const uniqueProjectRequestIds = Array.from(new Set(
    params.projectRequestIds.map((item) => item.trim()).filter(Boolean),
  ));
  const retryCount = Math.max(0, params.retryCount || 0);
  const retryDelayMs = Math.max(0, params.retryDelayMs || 0);
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    for (const projectRequestId of uniqueProjectRequestIds) {
      try {
        const value = await params.loader(projectRequestId);
        return { projectRequestId, value };
      } catch (error) {
        lastError = error;
      }
    }

    if (attempt < retryCount && retryDelayMs > 0) {
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, retryDelayMs);
      });
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("project_request_not_found");
}
