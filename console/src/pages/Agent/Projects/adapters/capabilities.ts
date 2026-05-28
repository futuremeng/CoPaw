import type { ProjectWorkspaceCapabilities } from "./types";

const DEFAULT_READONLY_PATH_RULES = [
  "intermediate/",
  "output/",
  ".pipelines/",
];

export const PROJECT_SCOPED_CAPABILITIES: ProjectWorkspaceCapabilities = {
  supportsStages: true,
  supportsContentTypes: true,
  supportsPathPrefix: true,
  supportsWatch: false,
  supportsEtag: false,
  supportsDirectoryOps: true,
  supportsUploadRelativePath: true,
  readonlyPathRules: DEFAULT_READONLY_PATH_RULES,
};

export const WORKSPACE_SCOPED_CAPABILITIES: ProjectWorkspaceCapabilities = {
  supportsStages: false,
  supportsContentTypes: false,
  supportsPathPrefix: true,
  supportsWatch: true,
  supportsEtag: true,
  supportsDirectoryOps: false,
  supportsUploadRelativePath: false,
  readonlyPathRules: DEFAULT_READONLY_PATH_RULES,
};

export function isPathReadonly(path: string, rules?: string[]): boolean {
  const normalized = String(path || "").replace(/\\/g, "/").replace(/^\.\//, "");
  const effectiveRules = Array.isArray(rules) && rules.length > 0
    ? rules
    : DEFAULT_READONLY_PATH_RULES;
  return effectiveRules.some((prefix) => normalized.startsWith(prefix));
}
