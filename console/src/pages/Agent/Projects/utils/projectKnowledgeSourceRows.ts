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
  category: "document" | "structured" | "image";
}

const DOCUMENT_EXTENSIONS = new Set([
  "md",
  "mdx",
  "txt",
  "markdown",
  "rst",
  "log",
]);

const STRUCTURED_EXTENSIONS = new Set([
  "json",
  "jsonl",
  "ndjson",
  "geojson",
]);

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tiff",
  "tif",
  "svg",
]);

const EXCLUDED_SOURCE_EXTENSIONS = new Set(["pdf"]);

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

function extensionOf(path: string): string {
  const normalized = normalizePath(path).toLowerCase();
  const fileName = normalized.split("/").pop() || "";
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1) : "";
}

export function classifyKnowledgeSourceCategory(path: string): "document" | "structured" | "image" {
  const extension = extensionOf(path);
  if (STRUCTURED_EXTENSIONS.has(extension)) {
    return "structured";
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  return "document";
}

export function isExcludedKnowledgeSourcePath(path: string): boolean {
  const extension = extensionOf(path);
  return EXCLUDED_SOURCE_EXTENSIONS.has(extension);
}

function resolveContentTypeLabel(file: AgentProjectFileInfo): string {
  const extension = extensionOf(String(file.path || file.filename || ""));
  if (STRUCTURED_EXTENSIONS.has(extension)) {
    return extension.toUpperCase();
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return extension.toUpperCase();
  }
  return formatFileLabel(file.content_type || "other");
}

export function buildKnowledgeSourceRows(files: AgentProjectFileInfo[]): ProjectKnowledgeSourceRow[] {
  return files
    .filter((file) => !file.ignored && !isBuiltInKnowledgeSource(file))
    .filter((file) => !isExcludedKnowledgeSourcePath(String(file.path || file.filename || "")))
    .map((file, index) => ({
      key: `${file.path || file.filename || index}`,
      path: normalizePath(file.path || file.filename),
      title: file.filename || file.path || `${index}`,
      stage: formatFileLabel(file.stage || "other"),
      contentType: resolveContentTypeLabel(file),
      size: Math.max(0, Number(file.size || 0)),
      modifiedTime: String(file.modified_time || "").trim(),
      category: classifyKnowledgeSourceCategory(String(file.path || file.filename || "")),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function normalizeKnowledgeSourcePath(value?: string | null): string {
  return normalizePath(value);
}
