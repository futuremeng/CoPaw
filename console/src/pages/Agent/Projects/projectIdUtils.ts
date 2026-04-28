import type { AgentProjectSummary } from "../../../api/types/agents";

export function projectDirNameFromMetadata(metadataFile: string): string {
  const normalized = metadataFile.replace(/\\/g, "/").trim();
  if (!normalized) {
    return "";
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 2) {
    return "";
  }

  const metadataParentDir = segments[segments.length - 2];
  if (metadataParentDir.toLowerCase() !== ".agent") {
    return metadataParentDir;
  }

  // Metadata commonly lives at <projectId>/.agent/PROJECT.md.
  return segments.length >= 3 ? segments[segments.length - 3] : "";
}

export function buildProjectIdCandidates(project?: AgentProjectSummary): string[] {
  if (!project) {
    return [];
  }
  const candidates = [project.id, projectDirNameFromMetadata(project.metadata_file)]
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(candidates));
}

export function matchesRouteProject(
  project: AgentProjectSummary,
  routeProjectId: string,
): boolean {
  return buildProjectIdCandidates(project).includes(routeProjectId);
}
