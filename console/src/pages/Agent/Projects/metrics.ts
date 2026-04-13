import type { AgentProjectFileInfo } from "../../../api/types/agents";

export interface ProjectKnowledgeMetrics {
  totalFiles: number;
  markdownFiles: number;
  textFiles: number;
  scriptFiles: number;
  otherTypeFiles: number;
  recentlyUpdatedFiles: number;
  averageFileBytes: number;
  totalFileBytes: number;
}

export interface ProjectFileInventorySummary {
  totalFiles: number;
  originalFiles: number;
  intermediateFiles: number;
  artifactFiles: number;
  knowledgeMetrics: ProjectKnowledgeMetrics;
}

export type ProjectKnowledgeMetricKey =
  | "markdown"
  | "text"
  | "script"
  | "otherType"
  | "average"
  | "total"
  | "totalFiles";

export type ProjectKnowledgeFilterKey =
  | "markdown"
  | "text"
  | "script"
  | "otherType";

const PROJECT_KNOWLEDGE_FILTER_KEYS: ProjectKnowledgeFilterKey[] = [
  "markdown",
  "text",
  "script",
  "otherType",
];

export function isProjectKnowledgeFilterKey(value: string): value is ProjectKnowledgeFilterKey {
  return PROJECT_KNOWLEDGE_FILTER_KEYS.includes(value as ProjectKnowledgeFilterKey);
}

export function getProjectKnowledgeFilterKeyFromMetric(
  metricKey: ProjectKnowledgeMetricKey,
): ProjectKnowledgeFilterKey | undefined {
  switch (metricKey) {
    case "markdown":
      return "markdown";
    case "text":
      return "text";
    case "script":
      return "script";
    case "otherType":
      return "otherType";
    default:
      return undefined;
  }
}

export interface QuantAssessment {
  tone: "neutral" | "positive" | "warning";
  status: "healthy" | "attention" | "neutral";
}

export interface QuantStatusLabel {
  i18nKey: string;
  defaultLabel: string;
}

export interface QuantReason {
  key:
    | "markdownPresent"
    | "markdownMissing"
    | "textPresent"
    | "textMissing"
    | "scriptPresent"
    | "scriptMissing"
    | "otherTypePresent"
    | "otherTypeMissing"
    | "neutralInfo";
  params?: Record<string, number | string>;
}

export interface ProjectKnowledgeCardModel {
  key: ProjectKnowledgeMetricKey;
  labelI18nKey: string;
  defaultLabel: string;
  value: string | number;
  filterKey?: ProjectKnowledgeFilterKey;
  assessment: QuantAssessment;
  reason: QuantReason;
}

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

export function isOtherTypePath(path: string): boolean {
  return !isMarkdownPath(path) && !isTextPath(path) && !isScriptPath(path);
}

function isArtifactPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === "output" || normalized.startsWith("output/");
}

function isOriginalInputPath(path: string): boolean {
  const normalized = normalizePath(path);
  return normalized === "original" || normalized.startsWith("original/");
}

function isIntermediatePath(path: string): boolean {
  const normalized = normalizePath(path);
  return (
    normalized.startsWith("intermediate/")
    || normalized.startsWith("data/")
    || normalized.startsWith("metadata/")
    || normalized.startsWith("cross-book/")
    || normalized.startsWith("term-candidates/")
    || normalized.startsWith("review/")
  );
}

function isRecentlyUpdated(modifiedTime: string, nowMs: number): boolean {
  const modifiedMs = Date.parse(modifiedTime);
  if (Number.isNaN(modifiedMs)) {
    return false;
  }
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  return nowMs - modifiedMs <= sevenDaysMs;
}

export function isRecentlyUpdatedFile(modifiedTime: string, nowMs: number = Date.now()): boolean {
  return isRecentlyUpdated(modifiedTime, nowMs);
}

export function matchesProjectKnowledgeFilter(
  filter: ProjectKnowledgeFilterKey,
  file: Pick<AgentProjectFileInfo, "path" | "modified_time">,
): boolean {
  switch (filter) {
    case "markdown":
      return isMarkdownPath(file.path);
    case "text":
      return isTextPath(file.path);
    case "script":
      return isScriptPath(file.path);
    case "otherType":
      return isOtherTypePath(file.path);
    default:
      return false;
  }
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

export function computeProjectKnowledgeMetrics(
  files: AgentProjectFileInfo[],
): ProjectKnowledgeMetrics {
  return computeProjectFileInventorySummary(files).knowledgeMetrics;
}

export function computeProjectFileInventorySummary(
  files: AgentProjectFileInfo[],
): ProjectFileInventorySummary {
  const nowMs = Date.now();
  const totalFiles = files.length;
  let totalFileBytes = 0;
  let markdownFiles = 0;
  let textFiles = 0;
  let scriptFiles = 0;
  let otherTypeFiles = 0;
  let artifactFiles = 0;
  let recentlyUpdatedFiles = 0;
  let originalFiles = 0;
  let intermediateFiles = 0;

  for (const file of files) {
    totalFileBytes += Math.max(0, file.size || 0);
    if (isMarkdownPath(file.path)) {
      markdownFiles += 1;
    }
    if (isTextPath(file.path)) {
      textFiles += 1;
    }
    if (isScriptPath(file.path)) {
      scriptFiles += 1;
    }
    if (isOtherTypePath(file.path)) {
      otherTypeFiles += 1;
    }
    if (isArtifactPath(file.path)) {
      artifactFiles += 1;
    }
    if (isRecentlyUpdatedFile(file.modified_time, nowMs)) {
      recentlyUpdatedFiles += 1;
    }
    if (isOriginalInputPath(file.path)) {
      originalFiles += 1;
    } else if (isIntermediatePath(file.path)) {
      intermediateFiles += 1;
    }
  }

  const averageFileBytes = totalFiles > 0 ? totalFileBytes / totalFiles : 0;

  return {
    totalFiles,
    originalFiles,
    intermediateFiles,
    artifactFiles,
    knowledgeMetrics: {
      totalFiles,
      markdownFiles,
      textFiles,
      scriptFiles,
      otherTypeFiles,
      recentlyUpdatedFiles,
      averageFileBytes,
      totalFileBytes,
    },
  };
}

export function getProjectKnowledgeQuantAssessment(
  key: ProjectKnowledgeMetricKey,
  metrics: ProjectKnowledgeMetrics,
): QuantAssessment {
  switch (key) {
    case "markdown":
      return metrics.markdownFiles > 0
        ? { tone: "positive", status: "healthy" }
        : { tone: "neutral", status: "neutral" };
    case "text":
      return metrics.textFiles > 0
        ? { tone: "positive", status: "healthy" }
        : { tone: "neutral", status: "neutral" };
    case "script":
      return metrics.scriptFiles > 0
        ? { tone: "positive", status: "healthy" }
        : { tone: "neutral", status: "neutral" };
    case "otherType":
      return metrics.otherTypeFiles > 0
        ? { tone: "positive", status: "healthy" }
        : { tone: "neutral", status: "neutral" };
    case "average":
    case "total":
    case "totalFiles":
    default:
      return { tone: "neutral", status: "neutral" };
  }
}

export function getProjectKnowledgeQuantReason(
  key: ProjectKnowledgeMetricKey,
  metrics: ProjectKnowledgeMetrics,
): QuantReason {
  switch (key) {
    case "markdown":
      return metrics.markdownFiles > 0
        ? { key: "markdownPresent", params: { count: metrics.markdownFiles } }
        : { key: "markdownMissing" };
    case "text":
      return metrics.textFiles > 0
        ? { key: "textPresent", params: { count: metrics.textFiles } }
        : { key: "textMissing" };
    case "script":
      return metrics.scriptFiles > 0
        ? { key: "scriptPresent", params: { count: metrics.scriptFiles } }
        : { key: "scriptMissing" };
    case "otherType":
      return metrics.otherTypeFiles > 0
        ? { key: "otherTypePresent", params: { count: metrics.otherTypeFiles } }
        : { key: "otherTypeMissing" };
    default:
      return { key: "neutralInfo" };
  }
}

export function getProjectKnowledgeQuantStatusLabel(
  status: QuantAssessment["status"],
): QuantStatusLabel {
  switch (status) {
    case "healthy":
      return {
        i18nKey: "projects.quantStatusHealthy",
        defaultLabel: "Healthy",
      };
    case "attention":
      return {
        i18nKey: "projects.quantStatusAttention",
        defaultLabel: "Needs attention",
      };
    case "neutral":
    default:
      return {
        i18nKey: "projects.quantStatusNeutral",
        defaultLabel: "No signal",
      };
  }
}

export function buildProjectKnowledgeCardModels(
  metrics: ProjectKnowledgeMetrics,
): ProjectKnowledgeCardModel[] {
  const base: Array<{
    key: ProjectKnowledgeMetricKey;
    labelI18nKey: string;
    defaultLabel: string;
    value: string | number;
  }> = [
    {
      key: "markdown",
      labelI18nKey: "projects.quantMarkdownFiles",
      defaultLabel: "Markdown",
      value: metrics.markdownFiles,
    },
    {
      key: "text",
      labelI18nKey: "projects.quantTextFiles",
      defaultLabel: "文本文件",
      value: metrics.textFiles,
    },
    {
      key: "script",
      labelI18nKey: "projects.quantScriptFiles",
      defaultLabel: "脚本 (.py)",
      value: metrics.scriptFiles,
    },
    {
      key: "otherType",
      labelI18nKey: "projects.quantOtherTypeFiles",
      defaultLabel: "其他类型",
      value: metrics.otherTypeFiles,
    },
    {
      key: "average",
      labelI18nKey: "projects.quantAvgFileSize",
      defaultLabel: "Avg File Size",
      value: formatFileSize(metrics.averageFileBytes),
    },
    {
      key: "total",
      labelI18nKey: "projects.quantTotalSize",
      defaultLabel: "Total File Size",
      value: formatFileSize(metrics.totalFileBytes),
    },
    {
      key: "totalFiles",
      labelI18nKey: "projects.files",
      defaultLabel: "Files",
      value: metrics.totalFiles,
    },
  ];

  return base.map((item) => ({
    ...item,
    filterKey: getProjectKnowledgeFilterKeyFromMetric(item.key),
    assessment: getProjectKnowledgeQuantAssessment(item.key, metrics),
    reason: getProjectKnowledgeQuantReason(item.key, metrics),
  }));
}
