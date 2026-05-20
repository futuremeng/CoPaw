import type { AgentProjectFileInfo } from "../../../../api/types/agents";
import { isBuiltInProjectFile } from "./builtInFiles";

export interface ProjectKnowledgeSourceRow {
  key: string;
  path: string;
  title: string;
  stage: string;
  contentType: string;
  size: number;
  modifiedTime: string;
}

function normalizePath(value?: string | null): string {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function formatFileLabel(value?: string | null): string {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "-";
  }
  return normalized
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function isBuiltInKnowledgeSource(file: AgentProjectFileInfo): boolean {
  if (typeof file.builtin === "boolean") {
    return file.builtin;
  }
  return isBuiltInProjectFile(file.path || file.filename || "");
}

export function buildKnowledgeSourceRows(files: AgentProjectFileInfo[]): ProjectKnowledgeSourceRow[] {
  return files
    .filter((file) => !file.ignored && !isBuiltInKnowledgeSource(file))
    .map((file, index) => ({
      key: `${file.path || file.filename || index}`,
      path: normalizePath(file.path || file.filename),
      title: file.filename || file.path || `${index}`,
      stage: formatFileLabel(file.stage || "other"),
      contentType: formatFileLabel(file.content_type || "other"),
      size: Math.max(0, Number(file.size || 0)),
      modifiedTime: String(file.modified_time || "").trim(),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function normalizeKnowledgeSourcePath(value?: string | null): string {
  return normalizePath(value);
}
