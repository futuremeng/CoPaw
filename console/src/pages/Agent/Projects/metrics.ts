import type { AgentProjectFileInfo } from "../../../api/types/agents";

export interface ProjectKnowledgeMetrics {
  totalFiles: number;
  knowledgeCandidateFiles: number;
  markdownFiles: number;
  textLikeFiles: number;
  artifactFiles: number;
  recentlyUpdatedFiles: number;
  averageFileBytes: number;
  totalFileBytes: number;
}

export type ProjectKnowledgeMetricKey =
  | "knowledgeCandidates"
  | "markdown"
  | "textLike"
  | "artifact"
  | "recent"
  | "average"
  | "total"
  | "totalFiles";

export type ProjectKnowledgeFilterKey =
  | "knowledgeCandidates"
  | "markdown"
  | "textLike"
  | "recent";

const PROJECT_KNOWLEDGE_FILTER_KEYS: ProjectKnowledgeFilterKey[] = [
  "knowledgeCandidates",
  "markdown",
  "textLike",
  "recent",
];

export function isProjectKnowledgeFilterKey(value: string): value is ProjectKnowledgeFilterKey {
  return PROJECT_KNOWLEDGE_FILTER_KEYS.includes(value as ProjectKnowledgeFilterKey);
}

export function getProjectKnowledgeFilterKeyFromMetric(
  metricKey: ProjectKnowledgeMetricKey,
): ProjectKnowledgeFilterKey | undefined {
  switch (metricKey) {
    case "knowledgeCandidates":
      return "knowledgeCandidates";
    case "markdown":
      return "markdown";
    case "textLike":
      return "textLike";
    case "recent":
      return "recent";
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
    | "knowledgeCandidateLow"
    | "knowledgeCandidateHealthy"
    | "textDensityLow"
    | "textDensityHealthy"
    | "recentUpdatesLow"
    | "recentUpdatesHealthy"
    | "artifactPresent"
    | "artifactMissing"
    | "markdownPresent"
    | "markdownMissing"
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

const KNOWLEDGE_EXTENSIONS = new Set([
  "md",
  "mdx",
  "txt",
  "pdf",
  "doc",
  "docx",
  "rtf",
  "csv",
  "json",
  "yaml",
  "yml",
  "xml",
  "html",
  "htm",
]);

const TEXT_LIKE_EXTENSIONS = new Set([
  ...KNOWLEDGE_EXTENSIONS,
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "sh",
  "sql",
  "toml",
  "ini",
  "css",
  "scss",
  "less",
]);

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx"]);

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function extensionOf(path: string): string {
  const normalized = normalizePath(path);
  const fileName = normalized.split("/").pop() || "";
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1) : "";
}

export function isKnowledgeCandidatePath(path: string): boolean {
  return KNOWLEDGE_EXTENSIONS.has(extensionOf(path));
}

export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(path));
}

export function isTextLikePath(path: string): boolean {
  return TEXT_LIKE_EXTENSIONS.has(extensionOf(path));
}

function isArtifactPath(path: string): boolean {
  const normalized = normalizePath(path);
  return (
    normalized.startsWith("skills/")
    || normalized.startsWith("scripts/")
    || normalized.startsWith("flows/")
    || normalized.startsWith("cases/")
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
  nowMs: number = Date.now(),
): boolean {
  switch (filter) {
    case "knowledgeCandidates":
      return isKnowledgeCandidatePath(file.path);
    case "markdown":
      return isMarkdownPath(file.path);
    case "textLike":
      return isTextLikePath(file.path);
    case "recent":
      return isRecentlyUpdatedFile(file.modified_time, nowMs);
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
  const nowMs = Date.now();
  const totalFiles = files.length;
  const totalFileBytes = files.reduce((sum, file) => sum + Math.max(0, file.size || 0), 0);
  const averageFileBytes = totalFiles > 0 ? totalFileBytes / totalFiles : 0;
  const knowledgeCandidateFiles = files.filter((file) => isKnowledgeCandidatePath(file.path)).length;
  const markdownFiles = files.filter((file) => isMarkdownPath(file.path)).length;
  const textLikeFiles = files.filter((file) => isTextLikePath(file.path)).length;
  const artifactFiles = files.filter((file) => isArtifactPath(file.path)).length;
  const recentlyUpdatedFiles = files.filter((file) => isRecentlyUpdatedFile(file.modified_time, nowMs)).length;

  return {
    totalFiles,
    knowledgeCandidateFiles,
    markdownFiles,
    textLikeFiles,
    artifactFiles,
    recentlyUpdatedFiles,
    averageFileBytes,
    totalFileBytes,
  };
}

export function getProjectKnowledgeQuantAssessment(
  key: ProjectKnowledgeMetricKey,
  metrics: ProjectKnowledgeMetrics,
): QuantAssessment {
  switch (key) {
    case "knowledgeCandidates":
      if (metrics.totalFiles === 0) {
        return { tone: "neutral", status: "neutral" };
      }
      return metrics.knowledgeCandidateFiles > 0
        ? { tone: "positive", status: "healthy" }
        : { tone: "warning", status: "attention" };
    case "markdown":
      return metrics.markdownFiles > 0
        ? { tone: "positive", status: "healthy" }
        : { tone: "neutral", status: "neutral" };
    case "textLike":
      if (metrics.totalFiles === 0) {
        return { tone: "neutral", status: "neutral" };
      }
      return metrics.textLikeFiles / metrics.totalFiles >= 0.5
        ? { tone: "positive", status: "healthy" }
        : { tone: "warning", status: "attention" };
    case "artifact":
      return metrics.artifactFiles > 0
        ? { tone: "positive", status: "healthy" }
        : { tone: "neutral", status: "neutral" };
    case "recent":
      if (metrics.totalFiles === 0) {
        return { tone: "neutral", status: "neutral" };
      }
      return metrics.recentlyUpdatedFiles > 0
        ? { tone: "positive", status: "healthy" }
        : { tone: "warning", status: "attention" };
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
    case "knowledgeCandidates":
      if (metrics.totalFiles === 0) {
        return { key: "neutralInfo" };
      }
      return metrics.knowledgeCandidateFiles > 0
        ? {
            key: "knowledgeCandidateHealthy",
            params: { count: metrics.knowledgeCandidateFiles },
          }
        : { key: "knowledgeCandidateLow" };
    case "markdown":
      return metrics.markdownFiles > 0
        ? { key: "markdownPresent", params: { count: metrics.markdownFiles } }
        : { key: "markdownMissing" };
    case "textLike":
      if (metrics.totalFiles === 0) {
        return { key: "neutralInfo" };
      }
      return metrics.textLikeFiles / metrics.totalFiles >= 0.5
        ? {
            key: "textDensityHealthy",
            params: { count: metrics.textLikeFiles, total: metrics.totalFiles },
          }
        : {
            key: "textDensityLow",
            params: { count: metrics.textLikeFiles, total: metrics.totalFiles },
          };
    case "artifact":
      return metrics.artifactFiles > 0
        ? { key: "artifactPresent", params: { count: metrics.artifactFiles } }
        : { key: "artifactMissing" };
    case "recent":
      if (metrics.totalFiles === 0) {
        return { key: "neutralInfo" };
      }
      return metrics.recentlyUpdatedFiles > 0
        ? {
            key: "recentUpdatesHealthy",
            params: { count: metrics.recentlyUpdatedFiles },
          }
        : { key: "recentUpdatesLow" };
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
      key: "knowledgeCandidates",
      labelI18nKey: "projects.quantKnowledgeCandidates",
      defaultLabel: "Knowledge Candidates",
      value: metrics.knowledgeCandidateFiles,
    },
    {
      key: "markdown",
      labelI18nKey: "projects.quantMarkdownFiles",
      defaultLabel: "Markdown Files",
      value: metrics.markdownFiles,
    },
    {
      key: "textLike",
      labelI18nKey: "projects.quantTextLikeFiles",
      defaultLabel: "Text-like Files",
      value: metrics.textLikeFiles,
    },
    {
      key: "artifact",
      labelI18nKey: "projects.quantArtifactFiles",
      defaultLabel: "Artifact Files",
      value: metrics.artifactFiles,
    },
    {
      key: "recent",
      labelI18nKey: "projects.quantRecentlyUpdated",
      defaultLabel: "Updated in 7d",
      value: metrics.recentlyUpdatedFiles,
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
