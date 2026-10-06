import type { AgentProjectFileInfo } from "../../../../api/types/agents";

export type ProjectKnowledgeFilterKey =
  | "markdown"
  | "text"
  | "script"
  | "otherType";

const TEXT_FILE_EXTENSIONS = new Set([
  "txt",
  "csv",
  "json",
  "yaml",
  "yml",
  "xml",
  "html",
  "htm",
  "rtf",
  "toml",
  "ini",
  "sql",
]);

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx"]);
const SCRIPT_EXTENSIONS = new Set(["py"]);

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function extensionOf(path: string): string {
  const normalized = normalizePath(path);
  const fileName = normalized.split("/").pop() || "";
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1) : "";
}

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(path));
}

export function isTextPath(path: string): boolean {
  return TEXT_FILE_EXTENSIONS.has(extensionOf(path));
}

export function isScriptPath(path: string): boolean {
  return SCRIPT_EXTENSIONS.has(extensionOf(path));
}

function resolveContentType(file: Pick<AgentProjectFileInfo, "path" | "content_type">): ProjectKnowledgeFilterKey {
  if (file.content_type === "markdown") {
    return "markdown";
  }
  if (file.content_type === "text") {
    return "text";
  }
  if (file.content_type === "script") {
    return "script";
  }
  if (file.content_type === "other") {
    return "otherType";
  }
  if (isMarkdownPath(file.path)) {
    return "markdown";
  }
  if (isTextPath(file.path)) {
    return "text";
  }
  if (isScriptPath(file.path)) {
    return "script";
  }
  return "otherType";
}

export function matchesProjectKnowledgeFilter(
  filter: ProjectKnowledgeFilterKey,
  file: Pick<AgentProjectFileInfo, "path" | "modified_time" | "content_type">,
): boolean {
  return resolveContentType(file) === filter;
}

export function formatFileSize(bytes: number): string {
  const safeBytes = Math.max(0, Math.round(bytes));
  if (safeBytes < 1024) {
    return `${safeBytes} B`;
  }
  const kb = safeBytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}
