import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Drawer,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Splitter,
  Spin,
  Tabs,
  Typography,
  message,
} from "antd";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { agentsApi } from "../../../api/modules/agents";
import { chatApi } from "../../../api/modules/chat";
import { knowledgeApi } from "../../../api/modules/knowledge";
import ProjectAutomationPanel from "./components/ProjectAutomationPanel";
import ProjectChatPanel, {
  type ProjectChatAutoAttachRequest,
  type ProjectChatMode,
} from "./components/ProjectChatPanel";
import ProjectKnowledgePanel from "./components/ProjectKnowledgePanel";
import ProjectKnowledgeOutputsPanel from "./components/ProjectKnowledgeOutputsPanel";
import ProjectKnowledgeProcessingPanel from "./components/ProjectKnowledgeProcessingPanel";
import ProjectKnowledgeSignalsPanel from "./components/ProjectKnowledgeSignalsPanel";
import ProjectKnowledgeSourcesPanel from "./components/ProjectKnowledgeSourcesPanel";
import ProjectKnowledgeSettingsPanel from "./components/ProjectKnowledgeSettingsPanel";
import {
  getProjectKnowledgeSemanticDescription,
  getProjectKnowledgeSemanticReasonLabel,
} from "./utils/projectKnowledgePipelineUi";
import ProjectOverviewCard from "./components/ProjectOverviewCard";
import ProjectUploadModal from "./components/ProjectUploadModal";
import ProjectWorkbenchPanel from "./components/ProjectWorkbenchPanel";
import ProjectMetricsPanel from "./components/ProjectMetricsPanel";
import ProjectEvidencePanel from "./components/ProjectEvidencePanel";
import useArtifactSelectionGuards from "./hooks/useArtifactSelectionGuards";
import useProjectChatEnsureController from "./hooks/useProjectChatEnsureController";
import useProjectChatFocusEffects from "./hooks/useProjectChatFocusEffects";
import useProjectDetailBootstrap from "./hooks/useProjectDetailBootstrap";
import usePreferredProjectWorkspaceChat from "./hooks/usePreferredProjectWorkspaceChat";
import useProjectDesignChatController from "./hooks/useProjectDesignChatController";
import useLeaveConfirmGuard from "./hooks/useLeaveConfirmGuard";
import useOpenUploadQuery from "./hooks/useOpenUploadQuery";
import useProjectRealtimeController from "./hooks/useProjectRealtimeController";
import useProjectUploadController from "./hooks/useProjectUploadController";
import {
  type ProjectKnowledgeHeaderSignals,
  type ProjectKnowledgeProcessingMode,
  useProjectKnowledgeState,
} from "./hooks/useProjectKnowledgeState";
import {
  buildAttachDraftPrompt,
  buildAutoAttachAnalysisPrompt,
  buildImplementationAdvancePrompt,
  buildPromotionDraftPrompt,
  buildValidationRoundPrompt,
} from "./utils/projectChatPrompts";
import {
  isIgnoredProjectFile,
  resolveArtifactSelectionPath,
  isPreviewablePath,
  selectSeedSourceFiles,
} from "./utils/projectFileSelectionUtils";
import {
  buildProjectIdCandidates,
  matchesRouteProject,
} from "./utils/projectIdUtils";
import {
  buildProjectRequestCandidates,
  resolveProjectRequestCandidate,
} from "./utils/projectRequestResolver";
import {
  buildProjectLayoutStorageKey,
  type KnowledgeDockTabKey,
  parseProjectLayoutPrefs,
  type ProjectDetailLayoutPrefs,
  type ProjectStageKey,
  type TreeDisplayMode,
} from "./utils/projectLayoutPrefs";
import type { ProjectFileFilterKey } from "./utils/filtering";
import { computeProjectFileInventorySummary, isRecentlyUpdatedFile } from "./utils/metrics";
import { isBuiltInProjectFile } from "./utils/builtInFiles";
import type {
  AgentProjectSummary,
  AgentProjectFileInfo,
  AgentProjectFileQueryRequest,
  AgentProjectFileQuerySummary,
  AgentProjectFileSummary,
  AgentProjectFileTreeNode,
  ProjectPipelineArtifactRecord,
  ProjectPipelineNextAction,
  ProjectPipelineRunDetail,
  ProjectPipelineRunSummary,
  ProjectPipelineTemplateInfo,
  PlatformFlowTemplateInfo,
  AgentSummary,
} from "../../../api/types/agents";
import type {
  KnowledgeTaskProgress,
  MemifyJobStatus,
  ProjectKnowledgePipelineState,
  QualityLoopJobStatus,
} from "../../../api/types";
import type { ChatSpec } from "../../../api/types/chat";
import { useAgentStore } from "../../../stores/agentStore";
import styles from "./index.module.less";

const { Text } = Typography;

const LEFT_PANE_EXPANDED_SIZE = 440;
const LEFT_PANE_MIN_SIZE = 320;
const WORKBENCH_PANE_DEFAULT_SIZE = 620;
const WORKBENCH_PANE_MIN_SIZE = 360;
const CHAT_PANE_DEFAULT_SIZE = 520;
const CHAT_PANE_MIN_SIZE = 420;
const KNOWLEDGE_DOCK_DEFAULT_SIZE = 320;
const KNOWLEDGE_DOCK_MIN_SIZE = 240;
const KNOWLEDGE_DOCK_COLLAPSED_SIZE = 52;
const KNOWLEDGE_DOCK_COLLAPSE_KEY = "knowledge";
const PROJECT_TREE_AUTO_RESTORE_SHALLOW_DEPTH = 2;
const PROJECT_TREE_AUTO_RESTORE_MAX_DEEP_KEYS = 12;

const DEFAULT_KNOWLEDGE_HEADER_SIGNALS: ProjectKnowledgeHeaderSignals = {
  indexedRatio: 0,
  documentCount: 0,
  chunkCount: 0,
  sentenceCount: 0,
  sentenceWithEntitiesCount: 0,
  entityMentionsCount: 0,
  avgEntitiesPerSentence: 0,
  avgEntityCharRatio: 0,
  relationCount: 0,
  entityCount: 0,
  relationNormalizationCoverage: 0,
  entityCanonicalCoverage: 0,
  lowConfidenceRatio: 0,
  missingEvidenceRatio: 0,
  relationNormalizationThreshold: 0,
  entityCanonicalThreshold: 0,
  lowConfidenceThreshold: 0,
  missingEvidenceThreshold: 0,
  qualityAssessmentScore: 0,
};

type RuntimeTaskDetail = MemifyJobStatus | QualityLoopJobStatus | ProjectKnowledgePipelineState | null;

const STAGE_FILTERS: Record<ProjectStageKey, ProjectFileFilterKey[]> = {
  source: ["original", "intermediate", "artifact"],
  knowledge: ["markdown", "text", "script", "otherType"],
  output: ["agent", "skill", "flow", "case"],
  builtin: ["builtin"],
};

function resolveStageFromFilter(filter: ProjectFileFilterKey | ""): ProjectStageKey {
  if (!filter) {
    return "source";
  }
  if (STAGE_FILTERS.knowledge.includes(filter)) {
    return "knowledge";
  }
  if (STAGE_FILTERS.output.includes(filter)) {
    return "output";
  }
  if (STAGE_FILTERS.builtin.includes(filter)) {
    return "builtin";
  }
  return "source";
}

function buildProjectFilesQueryFromViewState(params: {
  activeStage: ProjectStageKey;
  selectedMetricFilter: ProjectFileFilterKey | "";
  searchQuery?: string;
}): AgentProjectFileQueryRequest {
  const base: AgentProjectFileQueryRequest = {
    include_ignored: false,
    sort_by: "path",
    sort_order: "asc",
    offset: 0,
    limit: 5000,
    include_builtin: false,
  };

  const { activeStage, selectedMetricFilter } = params;
  const normalizedSearch = String(params.searchQuery || "").trim();
  if (normalizedSearch) {
    base.search = normalizedSearch;
  }

  if (selectedMetricFilter === "builtin" || activeStage === "builtin") {
    return {
      ...base,
      include_builtin: true,
      stages: ["builtin"],
    };
  }

  switch (selectedMetricFilter) {
    case "original":
    case "intermediate":
    case "artifact":
      return {
        ...base,
        stages: [selectedMetricFilter],
      };
    case "markdown":
      return {
        ...base,
        content_types: ["markdown"],
      };
    case "text":
      return {
        ...base,
        content_types: ["text"],
      };
    case "script":
      return {
        ...base,
        content_types: ["script"],
      };
    case "otherType":
      return {
        ...base,
        content_types: ["other"],
      };
    case "agent":
      return {
        ...base,
        path_prefix: ".agent/",
      };
    case "skill":
      return {
        ...base,
        path_prefix: ".skills/",
      };
    case "flow":
    case "case":
      return {
        ...base,
        path_prefix: "pipelines/",
      };
    default:
      break;
  }

  if (activeStage === "source") {
    return {
      ...base,
      stages: ["original", "intermediate", "artifact"],
    };
  }

  return base;
}

function getRuntimeTaskKey(task: KnowledgeTaskProgress): string {
  return String(task.job_id || task.task_id || `${task.task_type || "task"}:${task.updated_at || ""}`);
}

function getRuntimeTaskLabel(taskType: string | undefined, translate: (key: string, fallback: string) => string): string {
  switch (String(taskType || "")) {
    case "project_pipeline":
      return translate("copaw.projects.knowledge.runtimeTaskProjectPipeline", "Project Pipeline");
    case "memify":
      return translate("copaw.projects.knowledge.runtimeTaskMemify", "Graph Build");
    case "quality_loop":
      return translate("copaw.projects.knowledge.runtimeTaskQualityLoop", "Quality Loop");
    case "history_backfill":
      return translate("copaw.projects.knowledge.runtimeTaskHistoryBackfill", "History Backfill");
    default:
      return translate("copaw.projects.knowledge.runtimeTaskGeneric", "Knowledge Task");
  }
}

function getRuntimeTaskStage(task: {
  stage_message?: string;
  current_stage?: string;
  stage?: string;
  status?: string;
} | null | undefined): string {
  return String(
    task?.stage_message || task?.current_stage || task?.stage || task?.status || "",
  ).trim();
}

function getRuntimeTaskPercent(task: {
  percent?: number;
  progress?: number;
} | null | undefined): number | null {
  if (typeof task?.percent === "number" && Number.isFinite(task.percent)) {
    return Math.max(0, Math.min(100, Math.round(task.percent)));
  }
  if (typeof task?.progress === "number" && Number.isFinite(task.progress)) {
    return Math.max(0, Math.min(100, Math.round(task.progress * 100)));
  }
  return null;
}

function formatQuantizationStageLabel(
  stage: string | null | undefined,
  translate: (key: string, fallback: string) => string,
): string {
  const normalized = String(stage || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized === "l1") {
    return translate("copaw.projects.knowledge.processing.quantStageL1", "Sources");
  }
  if (normalized === "l2") {
    return translate("copaw.projects.knowledge.processing.quantStageL2", "Structured");
  }
  if (normalized === "l3") {
    return translate("copaw.projects.knowledge.processing.quantStageL3", "Enhanced");
  }
  return normalized.toUpperCase();
}

function getRuntimeBadgeStatus(status: string): "processing" | "success" | "warning" | "error" | "default" {
  if (["running", "indexing", "graphifying", "pending", "queued"].includes(status)) {
    return "processing";
  }
  if (["succeeded", "completed"].includes(status)) {
    return "success";
  }
  if (status === "failed") {
    return "error";
  }
  if (status === "idle") {
    return "default";
  }
  return "warning";
}

function formatRuntimeTimestamp(value: string | null | undefined, locale: string): string {
  if (!value) {
    return "";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(locale || undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function getCurrentAgent(
  agents: AgentSummary[],
  selectedAgent: string,
): AgentSummary | undefined {
  return agents.find((agent) => agent.id === selectedAgent);
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function toProjectFileInfo(node: AgentProjectFileTreeNode): AgentProjectFileInfo {
  return {
    filename: node.filename,
    path: node.path,
    size: node.size,
    modified_time: node.modified_time,
  };
}

function buildProjectFilesByPath(
  files: AgentProjectFileInfo[],
): Record<string, AgentProjectFileInfo> {
  const next: Record<string, AgentProjectFileInfo> = {};
  for (const file of files) {
    next[file.path] = file;
  }
  return next;
}

function mergeProjectTreeNodesByPath(
  current: Record<string, AgentProjectFileInfo>,
  nodes: AgentProjectFileTreeNode[],
): Record<string, AgentProjectFileInfo> {
  if (nodes.length === 0) {
    return current;
  }
  const next = { ...current };
  for (const node of nodes) {
    if (!node.is_directory) {
      next[node.path] = toProjectFileInfo(node);
    }
  }
  return next;
}

function statusTagColor(status: string): string {
  switch (status) {
    case "running":
      return "processing";
    case "succeeded":
      return "success";
    case "completed":
      return "success";
    case "failed":
      return "error";
    case "pending":
      return "default";
    default:
      return "blue";
  }
}

function formatRunTimeLabel(raw: string): string {
  if (!raw) {
    return "-";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  const hh = String(parsed.getHours()).padStart(2, "0");
  const mm = String(parsed.getMinutes()).padStart(2, "0");
  const ss = String(parsed.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

function buildProjectWorkspaceSummary(params: {
  projectName: string;
  projectDescription: string;
  workspaceDir: string;
}): string {
  const safeDescription = params.projectDescription.trim() || "暂无项目简介";
  return [
    `项目：${params.projectName}`,
    `简介：${safeDescription}`,
    `工作区：${params.workspaceDir || "-"}`,
  ].join("\n");
}

function buildProjectWorkspaceChatPath(projectId: string, chatId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/chat/${encodeURIComponent(chatId)}`;
}

function normalizeProjectTreeKey(path: string): string {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+|\/+$/g, "")
    .trim();
}

function normalizeProjectTreeKeys(paths: string[]): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const normalized = normalizeProjectTreeKey(path);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

function getProjectTreeDepth(path: string): number {
  return normalizeProjectTreeKey(path).split("/").filter(Boolean).length;
}

function buildProjectAncestorDirectoryPaths(path: string): string[] {
  const normalizedPath = normalizeProjectTreeKey(path);
  if (!normalizedPath) {
    return [];
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length <= 1) {
    return [];
  }

  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

function mergeExpandedProjectTreeKeys(current: string[], extra: string[]): string[] {
  const next = normalizeProjectTreeKeys([...current, ...extra]);
  if (next.length === current.length && next.every((item, index) => item === current[index])) {
    return current;
  }
  return next;
}

function budgetRestoredProjectTreeKeys(paths: string[], selectedFilePath: string): string[] {
  const normalizedKeys = normalizeProjectTreeKeys(paths);
  if (normalizedKeys.length === 0) {
    return normalizedKeys;
  }

  const selectedAncestors = buildProjectAncestorDirectoryPaths(selectedFilePath);
  const selectedAncestorSet = new Set(selectedAncestors);
  const shallowKeys = normalizedKeys.filter(
    (path) => getProjectTreeDepth(path) <= PROJECT_TREE_AUTO_RESTORE_SHALLOW_DEPTH,
  );
  const deepKeys = normalizedKeys
    .filter((path) => getProjectTreeDepth(path) > PROJECT_TREE_AUTO_RESTORE_SHALLOW_DEPTH)
    .sort((left, right) => {
      const leftSelected = selectedAncestorSet.has(left) ? 0 : 1;
      const rightSelected = selectedAncestorSet.has(right) ? 0 : 1;
      if (leftSelected !== rightSelected) {
        return leftSelected - rightSelected;
      }

      const depthDelta = getProjectTreeDepth(left) - getProjectTreeDepth(right);
      if (depthDelta !== 0) {
        return depthDelta;
      }

      return left.localeCompare(right);
    })
    .slice(0, PROJECT_TREE_AUTO_RESTORE_MAX_DEEP_KEYS);

  return mergeExpandedProjectTreeKeys(shallowKeys, [...selectedAncestors, ...deepKeys]);
}

function isSucceededStatus(status: string): boolean {
  return status === "succeeded" || status === "completed";
}

function toTimestamp(raw?: string | null): number {
  if (!raw) {
    return 0;
  }
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function pickLatestRecentUpdatePath(summary: AgentProjectFileSummary | null | undefined): string {
  return String(summary?.recent_updates?.[0]?.path || "").trim();
}

function normalizeProjectPath(path: string): string {
  return String(path || "").trim().replace(/\\/g, "/").replace(/^\//, "");
}

function resolveCharStatsArtifactPath(
  selectedFilePath: string,
  files: AgentProjectFileInfo[],
): string {
  const normalized = normalizeProjectPath(selectedFilePath);
  if (!normalized) {
    return "";
  }
  const fileName = normalized.split("/").pop() || "";
  const stem = fileName.replace(/\.[^.]+$/, "");
  if (!stem) {
    return "";
  }

  const prefix = `.knowledge/interlinear/${stem}.snapshot_`;
  const candidates = files
    .map((item) => normalizeProjectPath(item.path))
    .filter((item) => item.startsWith(prefix) && item.endsWith(".char-stats.json"));

  if (candidates.length === 0) {
    return "";
  }

  // Snapshot 文件名内含时间戳，按倒序取最新。
  candidates.sort((left, right) => right.localeCompare(left));
  return candidates[0];
}

function resolveNerStructuredArtifactPath(
  selectedFilePath: string,
  files: AgentProjectFileInfo[],
): string {
  const normalized = normalizeProjectPath(selectedFilePath);
  if (!normalized) {
    return "";
  }
  const fileName = normalized.split("/").pop() || "";
  const stem = fileName.replace(/\.[^.]+$/, "");
  if (!stem) {
    return "";
  }

  const prefix = `.knowledge/ner/${stem}.snapshot_`;
  const candidates = files
    .map((item) => normalizeProjectPath(item.path))
    .filter((item) => item.startsWith(prefix) && item.endsWith(".ner.json"));

  if (candidates.length === 0) {
    return "";
  }

  candidates.sort((left, right) => right.localeCompare(left));
  return candidates[0];
}

function countFromRecord(record: Record<string, number> | undefined, key: string): number {
  return Math.max(0, Number(record?.[key] || 0));
}

function buildVisibleSummaryFromQuerySummary(
  querySummary: AgentProjectFileQuerySummary,
  files: AgentProjectFileInfo[],
) {
  const totalFiles = Math.max(0, Number(querySummary.total_matched || querySummary.returned || 0));
  const totalFileBytes = files.reduce((sum, item) => sum + Math.max(0, Number(item.size || 0)), 0);
  const averageFileBytes = totalFiles > 0 ? totalFileBytes / totalFiles : 0;
  const nowMs = Date.now();
  const recentlyUpdatedFiles = files.reduce(
    (sum, item) => sum + (isRecentlyUpdatedFile(item.modified_time, nowMs) ? 1 : 0),
    0,
  );

  return {
    totalFiles,
    originalFiles: countFromRecord(querySummary.stage_counts, "original"),
    intermediateFiles: countFromRecord(querySummary.stage_counts, "intermediate"),
    artifactFiles: countFromRecord(querySummary.stage_counts, "artifact"),
    knowledgeMetrics: {
      totalFiles,
      markdownFiles: countFromRecord(querySummary.content_type_counts, "markdown"),
      textFiles: countFromRecord(querySummary.content_type_counts, "text"),
      scriptFiles: countFromRecord(querySummary.content_type_counts, "script"),
      otherTypeFiles: countFromRecord(querySummary.content_type_counts, "other"),
      recentlyUpdatedFiles,
      averageFileBytes,
      totalFileBytes,
    },
  };
}

export default function ProjectDetailPage() {
  const { t, i18n } = useTranslation();
  const translateWithFallback = useCallback(
    (key: string, fallback: string) => t(key, fallback),
    [t],
  );
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId, chatId } = useParams<{ projectId?: string; chatId?: string }>();
  const { selectedAgent, agents, setAgents } = useAgentStore();
  const routeProjectId = useMemo(
    () => (projectId ? decodeURIComponent(projectId) : ""),
    [projectId],
  );
  const routeWorkspaceChatId = useMemo(
    () => (chatId ? decodeURIComponent(chatId) : ""),
    [chatId],
  );

  const [loading, setLoading] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [error, setError] = useState("");
  const [projects, setProjects] = useState<AgentProjectSummary[]>([]);

  const [resolvedProjectRequestId, setResolvedProjectRequestId] = useState("");
  const [projectFiles, setProjectFiles] = useState<AgentProjectFileInfo[]>([]);
  const [projectFilesQuerySummary, setProjectFilesQuerySummary] =
    useState<AgentProjectFileQuerySummary | null>(null);
  const [projectTreeNodes, setProjectTreeNodes] = useState<AgentProjectFileTreeNode[]>([]);
  const [projectFileSummary, setProjectFileSummary] = useState<AgentProjectFileSummary | null>(null);
  const [knownProjectFilesByPath, setKnownProjectFilesByPath] =
    useState<Record<string, AgentProjectFileInfo>>({});
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [treeExpandedKeys, setTreeExpandedKeys] = useState<string[]>([]);
  const [staleProjectTreeDirectoryPaths, setStaleProjectTreeDirectoryPaths] = useState<string[]>([]);
  const [latestUpdatedFilePath, setLatestUpdatedFilePath] = useState("");
  const [workbenchSyncNotice, setWorkbenchSyncNotice] = useState<{
    changedPaths: string[];
    updatedAt: number;
  } | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [charStatsContent, setCharStatsContent] = useState("");
  const [nerStructuredContent, setNerStructuredContent] = useState("");
  const [filesLoading, setFilesLoading] = useState(false);
  const [projectTreeLoading, setProjectTreeLoading] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);

  const [pipelineTemplates, setPipelineTemplates] = useState<
    ProjectPipelineTemplateInfo[]
  >([]);
  const [pipelineRuns, setPipelineRuns] = useState<ProjectPipelineRunSummary[]>(
    [],
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [runDetail, setRunDetail] = useState<ProjectPipelineRunDetail | null>(
    null,
  );
  const [pipelineLoading, setPipelineLoading] = useState(false);
  const [createRunLoading, setCreateRunLoading] = useState(false);
  const [platformTemplates, setPlatformTemplates] = useState<PlatformFlowTemplateInfo[]>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [selectedPlatformTemplateId, setSelectedPlatformTemplateId] = useState("");
  const [runFocusChatId, setRunFocusChatId] = useState("");
  const [workspaceFocusChatId, setWorkspaceFocusChatId] = useState("");
  const [designFocusChatId, setDesignFocusChatId] = useState("");
  const [manualRecoverOpen, setManualRecoverOpen] = useState(false);
  const [manualRecoverLoading, setManualRecoverLoading] = useState(false);
  const [manualRecoverCandidates, setManualRecoverCandidates] = useState<ChatSpec[]>([]);
  const [manualRecoverChatId, setManualRecoverChatId] = useState("");
  const [chatStarting, setChatStarting] = useState(false);
  const [projectAgentContext, setProjectAgentContext] = useState("");
  const [selectedStepId, setSelectedStepId] = useState("");
  const [deletingProject, setDeletingProject] = useState(false);
  const [deletingProjectPaths, setDeletingProjectPaths] = useState<string[]>([]);
  const [automationDrawerOpen, setAutomationDrawerOpen] = useState(false);
  const [autoAttachRequest, setAutoAttachRequest] = useState<ProjectChatAutoAttachRequest | null>(null);
  const [selectedAttachPaths, setSelectedAttachPaths] = useState<string[]>([]);
  const [sendingSelectedFiles, setSendingSelectedFiles] = useState(false);
  const [autoAnalyzeOnAttach, setAutoAnalyzeOnAttach] = useState(true);
  const [activeStage, setActiveStage] = useState<ProjectStageKey>("source");
  const [knowledgeModuleCollapsed, setKnowledgeModuleCollapsed] = useState(false);
  const [knowledgeDockTab, setKnowledgeDockTab] = useState<KnowledgeDockTabKey>("explore");
  const effectiveKnowledgeDockTab = knowledgeDockTab === "ner" ? "processing" : knowledgeDockTab;
  const [knowledgeProcessingFocusMode, setKnowledgeProcessingFocusMode] = useState<ProjectKnowledgeProcessingMode | "">("");
  const [knowledgeProcessingFocusStage, setKnowledgeProcessingFocusStage] = useState<"tokenize" | "ner" | "syntax" | "cor" | "">("");
  const [knowledgeProcessingFocusScope, setKnowledgeProcessingFocusScope] = useState<"global" | "source" | "">("");
  const [knowledgeProcessingFocusToken, setKnowledgeProcessingFocusToken] = useState(0);
  const [projectKnowledgeIncludeGlobal] = useState(true);
  const [knowledgeHeaderSignals, setKnowledgeHeaderSignals] =
    useState<ProjectKnowledgeHeaderSignals>(DEFAULT_KNOWLEDGE_HEADER_SIGNALS);
  const [runtimeSignalTooltipOpen, setRuntimeSignalTooltipOpen] = useState(false);
  const [runtimeSignalLoading, setRuntimeSignalLoading] = useState(false);
  const [runtimeSignalDetails, setRuntimeSignalDetails] =
    useState<Record<string, RuntimeTaskDetail>>({});
  const [pendingKnowledgeQuery, setPendingKnowledgeQuery] = useState("");
  const [selectedMetricFilter, setSelectedMetricFilter] = useState<ProjectFileFilterKey | "">("");
  const [projectFileSearchQuery, setProjectFileSearchQuery] = useState("");
  const deferredProjectFileSearchQuery = useDeferredValue(projectFileSearchQuery);
  const [treeDisplayMode, setTreeDisplayMode] = useState<TreeDisplayMode>("filter");
  const [leftPaneSize, setLeftPaneSize] = useState(LEFT_PANE_EXPANDED_SIZE);
  const [workbenchPaneSize, setWorkbenchPaneSize] = useState(WORKBENCH_PANE_DEFAULT_SIZE);
  const [chatPaneSize, setChatPaneSize] = useState(CHAT_PANE_DEFAULT_SIZE);
  const [knowledgeDockSize, setKnowledgeDockSize] = useState(KNOWLEDGE_DOCK_DEFAULT_SIZE);
  const runFocusChatIdRef = useRef("");
  const workspaceFocusChatIdRef = useRef("");
  const designFocusChatIdRef = useRef("");
  const projectFilesLoadKeyRef = useRef("");
  const projectFilesViewLoadKeyRef = useRef("");
  const runRestoreAttemptKeyRef = useRef("");
  const automationDrawerAutoOpenKeyRef = useRef("");
  const pipelineManualActivationRef = useRef(false);
  const layoutPrefsLoadedRef = useRef(false);
  const workspaceResizeFrameRef = useRef<number | null>(null);
  const knowledgeDockResizeFrameRef = useRef<number | null>(null);
  const pendingWorkspaceSizesRef = useRef<number[] | null>(null);
  const pendingKnowledgeDockSizesRef = useRef<number[] | null>(null);
  const knowledgeWatchLeaseRef = useRef<{
    agentId: string;
    projectId: string;
    leaseId: string;
  } | null>(null);

  const currentAgent = useMemo(
    () => getCurrentAgent(agents, selectedAgent),
    [agents, selectedAgent],
  );

  const selectedProject = useMemo(
    () => projects.find((project) => matchesRouteProject(project, routeProjectId)),
    [projects, routeProjectId],
  );

  const projectFilesQueryBody = useMemo(
    () => buildProjectFilesQueryFromViewState({
      activeStage,
      selectedMetricFilter,
      searchQuery: deferredProjectFileSearchQuery,
    }),
    [activeStage, deferredProjectFileSearchQuery, selectedMetricFilter],
  );

  const projectFilesQuerySignature = useMemo(
    () => JSON.stringify(projectFilesQueryBody),
    [projectFilesQueryBody],
  );

  const projectKnowledgeState = useProjectKnowledgeState({
    agentId: currentAgent?.id || "",
    projectId: selectedProject?.id || "",
    projectName: selectedProject?.name || "",
    includeGlobal: projectKnowledgeIncludeGlobal,
    onSignalsChange: setKnowledgeHeaderSignals,
    eagerSourceLoad:
      knowledgeDockTab === "sources"
      || effectiveKnowledgeDockTab === "processing"
      || knowledgeDockTab === "health"
      || knowledgeDockTab === "settings",
    eagerExploreLoad: knowledgeDockTab === "explore",
  });

  useEffect(() => {
    setKnowledgeHeaderSignals(DEFAULT_KNOWLEDGE_HEADER_SIGNALS);
    setPendingKnowledgeQuery("");
    setRuntimeSignalTooltipOpen(false);
    setRuntimeSignalLoading(false);
    setRuntimeSignalDetails({});
  }, [selectedProject?.id]);

  useEffect(() => {
    const agentId = currentAgent?.id || "";
    const activeProjectId = selectedProject?.id || "";
    if (!agentId || !activeProjectId) {
      return;
    }

    let disposed = false;

    void agentsApi.acquireProjectKnowledgeWatchLease(agentId, activeProjectId)
      .then((payload) => {
        const leaseId = String(payload?.lease_id || "").trim();
        if (!leaseId) {
          return;
        }
        if (disposed) {
          void agentsApi.releaseProjectKnowledgeWatchLease(agentId, activeProjectId, leaseId).catch(() => undefined);
          return;
        }
        knowledgeWatchLeaseRef.current = {
          agentId,
          projectId: activeProjectId,
          leaseId,
        };
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      const currentLease = knowledgeWatchLeaseRef.current;
      if (!currentLease) {
        return;
      }
      if (currentLease.agentId !== agentId || currentLease.projectId !== activeProjectId) {
        return;
      }
      knowledgeWatchLeaseRef.current = null;
      void agentsApi.releaseProjectKnowledgeWatchLease(
        currentLease.agentId,
        currentLease.projectId,
        currentLease.leaseId,
      ).catch(() => undefined);
    };
  }, [currentAgent?.id, selectedProject?.id]);

  useEffect(() => {
    const agentId = currentAgent?.id;
    const projectId = selectedProject?.id;
    if (!agentId || !projectId) {
      setProjectAgentContext("");
      return;
    }
    let cancelled = false;
    void (async () => {
      const results = await Promise.allSettled([
        agentsApi.readProjectFile(agentId, projectId, ".agent/AGENTS.md"),
        agentsApi.readProjectFile(agentId, projectId, ".agent/PROJECT.md"),
      ]);
      if (cancelled) {
        return;
      }
      const parts: string[] = [];
      if (results[0].status === "fulfilled" && results[0].value?.content) {
        parts.push(`=== .agent/AGENTS.md ===\n${results[0].value.content}`);
      }
      if (results[1].status === "fulfilled" && results[1].value?.content) {
        parts.push(`=== .agent/PROJECT.md ===\n${results[1].value.content}`);
      }
      setProjectAgentContext(parts.join("\n\n"));
    })();
    return () => {
      cancelled = true;
    };
  }, [currentAgent?.id, selectedProject?.id]);

  const fetchRuntimeSignalDetails = useCallback(async () => {
    if (!selectedProject?.id || !projectKnowledgeState.activeKnowledgeTasks.length) {
      setRuntimeSignalDetails({});
      return;
    }
    setRuntimeSignalLoading(true);
    try {
      const entries = await Promise.all(
        projectKnowledgeState.activeKnowledgeTasks.map(async (task) => {
          const taskKey = getRuntimeTaskKey(task);
          try {
            if (task.task_type === "quality_loop" && task.job_id) {
              return [
                taskKey,
                await knowledgeApi.getQualityLoopJobStatus(task.job_id, {
                  projectId: selectedProject.id,
                }),
              ] as const;
            }
            if (task.task_type === "memify" && task.job_id) {
              return [
                taskKey,
                await knowledgeApi.getMemifyJobStatus(task.job_id, {
                  projectId: selectedProject.id,
                }),
              ] as const;
            }
            if (task.task_type === "project_pipeline") {
              return [taskKey, projectKnowledgeState.syncState] as const;
            }
          } catch {
            return [taskKey, null] as const;
          }
          return [taskKey, null] as const;
        }),
      );
      setRuntimeSignalDetails(Object.fromEntries(entries));
    } finally {
      setRuntimeSignalLoading(false);
    }
  }, [projectKnowledgeState.activeKnowledgeTasks, projectKnowledgeState.syncState, selectedProject?.id]);

  const runtimeSignalValue = useMemo(() => {
    const primaryTask = projectKnowledgeState.activeKnowledgeTask;
    if (!primaryTask) {
      return t("copaw.projects.knowledge.runtimeStatusIdle");
    }
    const taskLabel = getRuntimeTaskLabel(primaryTask.task_type, translateWithFallback);
    const percent = getRuntimeTaskPercent(primaryTask);
    const stageLabel = getRuntimeTaskStage(primaryTask);
    const quantizationStage = primaryTask.task_type === "project_pipeline"
      ? formatQuantizationStageLabel(projectKnowledgeState.syncState?.quantization_stage, translateWithFallback)
      : "";
    return [
      taskLabel,
      typeof percent === "number" ? `${percent}%` : stageLabel,
      quantizationStage ? `${t("copaw.projects.knowledge.syncQuantizationStage")}: ${quantizationStage}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }, [projectKnowledgeState.activeKnowledgeTask, projectKnowledgeState.syncState?.quantization_stage, t, translateWithFallback]);

  const runtimeSignalTooltipContent = useMemo(() => {
    const activeTasks = projectKnowledgeState.activeKnowledgeTasks;
    if (!activeTasks.length) {
      return (
        <div className={styles.knowledgeRuntimeTooltip}>
          <Text type="secondary">
            {t("copaw.projects.knowledge.runtimeStatusNoDetails")}
          </Text>
        </div>
      );
    }

    return (
      <div className={styles.knowledgeRuntimeTooltip}>
        <div className={styles.knowledgeRuntimeTooltipHeader}>
          <Text strong>{t("copaw.projects.knowledge.signalRuntimeStatus")}</Text>
          <Text type="secondary">
            {t("copaw.projects.knowledge.runtimeStatusTaskCount", {
              count: activeTasks.length,
            })}
          </Text>
        </div>
        {runtimeSignalLoading ? <Spin size="small" /> : null}
        <div className={styles.knowledgeRuntimeTooltipList}>
          {activeTasks.map((task) => {
            const taskKey = getRuntimeTaskKey(task);
            const detail = runtimeSignalDetails[taskKey];
            const liveTask = detail || task;
            const stageLabel = getRuntimeTaskStage(liveTask) || getRuntimeTaskStage(task);
            const percent = getRuntimeTaskPercent(liveTask) ?? getRuntimeTaskPercent(task);
            const current = typeof (liveTask as { current?: number }).current === "number"
              ? (liveTask as { current?: number }).current
              : task.current;
            const total = typeof (liveTask as { total?: number }).total === "number"
              ? (liveTask as { total?: number }).total
              : task.total;
            const updatedAt = formatRuntimeTimestamp(
              (liveTask as { updated_at?: string | null }).updated_at || task.updated_at,
              i18n.language,
            );
            const warnings = Array.isArray((liveTask as { warnings?: string[] }).warnings)
              ? (liveTask as { warnings?: string[] }).warnings || []
              : task.warnings || [];
            const errorText = String(
              (liveTask as { error?: string | null }).error
                || ((detail as ProjectKnowledgePipelineState | null)?.last_error ?? "")
                || task.error
                || "",
            ).trim();
            const qualityLoopDetail = task.task_type === "quality_loop"
              ? (detail as QualityLoopJobStatus | null)
              : null;
            const projectPipelineDetail = task.task_type === "project_pipeline"
              ? ((detail as ProjectKnowledgePipelineState | null) || projectKnowledgeState.syncState || null)
              : null;
            const semanticEngine = projectPipelineDetail?.semantic_engine;
            const quantizationStageLabel = formatQuantizationStageLabel(
              projectPipelineDetail?.quantization_stage,
              translateWithFallback,
            );
            const semanticReasonLabel = getProjectKnowledgeSemanticReasonLabel(semanticEngine, t);
            const semanticDescription = getProjectKnowledgeSemanticDescription(semanticEngine, t);
            const scoreBefore = typeof qualityLoopDetail?.score_before === "number"
              ? qualityLoopDetail.score_before
              : null;
            const scoreAfter = typeof qualityLoopDetail?.score_after === "number"
              ? qualityLoopDetail.score_after
              : null;
            const delta = typeof qualityLoopDetail?.delta === "number"
              ? qualityLoopDetail.delta
              : null;
            const stopReason = String(qualityLoopDetail?.stop_reason || "").trim();
            const changedCount = typeof projectPipelineDetail?.changed_count === "number"
              ? projectPipelineDetail.changed_count
              : null;

            return (
              <div className={styles.knowledgeRuntimeTooltipItem} key={taskKey}>
                <div className={styles.knowledgeRuntimeTooltipTitle}>
                  <Text strong>{getRuntimeTaskLabel(task.task_type, translateWithFallback)}</Text>
                  <Badge
                    status={getRuntimeBadgeStatus(String(task.status || ""))}
                    text={String(task.status || "")}
                  />
                </div>
                {stageLabel ? (
                  <Text className={styles.knowledgeRuntimeTooltipStage}>{stageLabel}</Text>
                ) : null}
                <div className={styles.knowledgeRuntimeTooltipMeta}>
                  {typeof percent === "number" ? (
                    <Text type="secondary">
                      {t("copaw.projects.knowledge.runtimeStatusProgress")}: {percent}%
                    </Text>
                  ) : null}
                  {typeof current === "number" && typeof total === "number" ? (
                    <Text type="secondary">{`${current}/${total}`}</Text>
                  ) : null}
                  {updatedAt ? (
                    <Text type="secondary">
                      {t("copaw.projects.knowledge.runtimeStatusUpdatedAt")}: {updatedAt}
                    </Text>
                  ) : null}
                  {typeof changedCount === "number" ? (
                    <Text type="secondary">
                      {t("copaw.projects.knowledge.syncChangedCount", { count: changedCount })}
                    </Text>
                  ) : null}
                  {quantizationStageLabel ? (
                    <Text type="secondary">
                      {t("copaw.projects.knowledge.syncQuantizationStage")}: {quantizationStageLabel}
                    </Text>
                  ) : null}
                  {scoreBefore !== null && scoreAfter !== null ? (
                    <Text type="secondary">{`${Math.round((scoreBefore ?? 0) * 100)} -> ${Math.round((scoreAfter ?? 0) * 100)}`}</Text>
                  ) : null}
                  {delta !== null ? (
                    <Text type="secondary">
                      {t("copaw.projects.knowledge.runtimeStatusScoreDelta")}: {(delta ?? 0) >= 0 ? "+" : ""}{Math.round((delta ?? 0) * 100)}
                    </Text>
                  ) : null}
                </div>
                {stopReason ? (
                  <Text type="secondary">
                    {t("copaw.projects.knowledge.runtimeStatusStopReason")}: {stopReason}
                  </Text>
                ) : null}
                {warnings.length ? (
                  <Text type="secondary">
                    {t("copaw.projects.knowledge.runtimeStatusWarnings")}: {warnings.join("; ")}
                  </Text>
                ) : null}
                {semanticEngine ? (
                  <Text type="secondary">
                    {t("copaw.projects.knowledge.semanticEngineStatus")}: {semanticReasonLabel}
                    {semanticDescription ? `. ${semanticDescription}` : ""}
                  </Text>
                ) : null}
                {errorText ? (
                  <Text type="danger">
                    {t("copaw.projects.knowledge.runtimeStatusError")}: {errorText}
                  </Text>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }, [
    i18n.language,
    projectKnowledgeState.activeKnowledgeTasks,
    projectKnowledgeState.syncState,
    runtimeSignalDetails,
    runtimeSignalLoading,
    t,
    translateWithFallback,
  ]);

  const leaveConfirmText = useMemo(
    () =>
      t(
        "projects.leaveConfirm",
        "你有可能误触跳转。确定要离开当前项目页面吗？",
      ),
    [t],
  );

  const effectiveProjectFiles = useMemo(() => {
    if (projectFiles.length === 0) {
      return Object.values(knownProjectFilesByPath).sort((left, right) =>
        left.path.localeCompare(right.path),
      );
    }
    return Object.values({
      ...buildProjectFilesByPath(projectFiles),
      ...knownProjectFilesByPath,
    }).sort((left, right) => left.path.localeCompare(right.path));
  }, [knownProjectFilesByPath, projectFiles]);

  const artifactRecords = useMemo<ProjectPipelineArtifactRecord[]>(() => {
    if (runDetail?.artifact_records?.length) {
      return runDetail.artifact_records.filter((item) => isPreviewablePath(item.path));
    }

    return effectiveProjectFiles
      .filter((file) => isPreviewablePath(file.path))
      .map((file) => ({
        artifact_id: `source:${file.path}`,
        path: file.path,
        name: file.filename || file.path,
        kind: "source",
        format: file.path.split(".").pop() || "bin",
        human_readable: true,
        run_id: selectedRunId || "",
        producer_step_id: null,
        producer_step_name: null,
        consumer_step_ids: [],
        consumer_step_names: [],
        created_at: file.modified_time,
      }));
  }, [effectiveProjectFiles, runDetail?.artifact_records, selectedRunId]);

  const relatedArtifactPathsForSelectedStep = useMemo(() => {
    if (!selectedStepId) {
      return new Set<string>();
    }
    return new Set(
      artifactRecords
        .filter(
          (item) =>
            item.producer_step_id === selectedStepId ||
            item.consumer_step_ids.includes(selectedStepId),
        )
        .map((item) => item.path),
    );
  }, [artifactRecords, selectedStepId]);

  const selectedArtifactRecord = useMemo(
    () => artifactRecords.find((item) => item.path === selectedFilePath),
    [artifactRecords, selectedFilePath],
  );

  const highlightedStepIds = useMemo(() => {
    const ids = new Set<string>();
    if (selectedStepId) {
      ids.add(selectedStepId);
    }
    if (selectedArtifactRecord?.producer_step_id) {
      ids.add(selectedArtifactRecord.producer_step_id);
    }
    for (const consumerStepId of selectedArtifactRecord?.consumer_step_ids || []) {
      ids.add(consumerStepId);
    }
    return ids;
  }, [selectedArtifactRecord, selectedStepId]);

  const selectedRunSummary = useMemo(
    () =>
      pipelineRuns.find(
        (run) => run.id === selectedRunId && run.template_id === selectedTemplateId,
      ),
    [pipelineRuns, selectedRunId, selectedTemplateId],
  );

  const runsForSelectedTemplate = useMemo(
    () =>
      pipelineRuns.filter(
        (run) => !selectedTemplateId || run.template_id === selectedTemplateId,
      ),
    [pipelineRuns, selectedTemplateId],
  );

  const activeRunTemplate = useMemo(() => {
    if (!selectedTemplateId) {
      return pipelineTemplates[0];
    }
    return (
      pipelineTemplates.find((item) => item.id === selectedTemplateId) ||
      pipelineTemplates[0]
    );
  }, [pipelineTemplates, selectedTemplateId]);

  const selectedTemplate = useMemo(
    () => pipelineTemplates.find((item) => item.id === selectedTemplateId),
    [pipelineTemplates, selectedTemplateId],
  );

  const currentStepIds = useMemo(
    () =>
      (runDetail?.steps?.map((step) => step.id) || activeRunTemplate?.steps?.map((step) => step.id) || []).filter(
        Boolean,
      ),
    [activeRunTemplate?.steps, runDetail?.steps],
  );

  const stepContractById = useMemo(() => {
    const mapping = new Map<string, ProjectPipelineTemplateInfo["steps"][number]>();
    for (const item of activeRunTemplate?.steps || []) {
      mapping.set(item.id, item);
    }
    return mapping;
  }, [activeRunTemplate?.steps]);

  const activeRunChatId = useMemo(
    () => runFocusChatId || runDetail?.focus_chat_id || selectedRunSummary?.focus_chat_id || "",
    [runDetail?.focus_chat_id, runFocusChatId, selectedRunSummary?.focus_chat_id],
  );

  const activeWorkspaceChatId = useMemo(() => workspaceFocusChatId, [workspaceFocusChatId]);

  const activeDesignChatId = useMemo(() => designFocusChatId, [designFocusChatId]);

  const projectChatMode = useMemo<ProjectChatMode>(() => {
    if (selectedRunId) {
      return "run";
    }
    if (activeDesignChatId) {
      return "design";
    }
    return "workspace";
  }, [activeDesignChatId, selectedRunId]);

  useEffect(() => {
    if (!selectedProject?.id || !activeWorkspaceChatId) {
      return;
    }
    if (projectChatMode !== "workspace") {
      return;
    }
    const expectedPath = buildProjectWorkspaceChatPath(selectedProject.id, activeWorkspaceChatId);
    if (location.pathname !== expectedPath) {
      navigate(expectedPath, { replace: true });
    }
  }, [
    activeWorkspaceChatId,
    location.pathname,
    navigate,
    projectChatMode,
    selectedProject?.id,
  ]);

  const runProgress = useMemo(() => {
    if (!runDetail) {
      return { total: 0, completed: 0, running: 0, pending: 0 };
    }
    const total = runDetail.steps.length;
    const completed = runDetail.steps.filter(
      (step) => step.status === "succeeded" || step.status === "completed",
    ).length;
    const running = runDetail.steps.filter((step) => step.status === "running").length;
    const pending = runDetail.steps.filter((step) => step.status === "pending").length;
    return { total, completed, running, pending };
  }, [runDetail]);

  const latestRunForSelectedTemplate = useMemo(() => {
    if (runsForSelectedTemplate.length === 0) {
      return null;
    }
    const sorted = [...runsForSelectedTemplate].sort((a, b) =>
      toTimestamp(b.updated_at || b.created_at) -
      toTimestamp(a.updated_at || a.created_at),
    );
    return sorted[0] || null;
  }, [runsForSelectedTemplate]);

  const succeededRunCountForSelectedTemplate = useMemo(
    () => runsForSelectedTemplate.filter((item) => isSucceededStatus(item.status)).length,
    [runsForSelectedTemplate],
  );

  const knownProjectFilePaths = useMemo(
    () => new Set(Object.keys(knownProjectFilesByPath)),
    [knownProjectFilesByPath],
  );

  const projectFileCount = useMemo(
    () => projectFileSummary?.visible_files ?? effectiveProjectFiles.filter((file) => !isBuiltInProjectFile(file.path)).length,
    [effectiveProjectFiles, projectFileSummary?.visible_files],
  );

  const visibleProjectFiles = useMemo(
    () => effectiveProjectFiles.filter((item) => !isBuiltInProjectFile(item.path)),
    [effectiveProjectFiles],
  );

  const visibleProjectSummary = useMemo(
    () => projectFilesQuerySummary
      ? buildVisibleSummaryFromQuerySummary(projectFilesQuerySummary, projectFiles)
      : computeProjectFileInventorySummary(visibleProjectFiles),
    [projectFiles, projectFilesQuerySummary, visibleProjectFiles],
  );

  const flushWorkspaceResize = useCallback((sizes: number[]) => {
    if (sizes.length !== 3) {
      return;
    }
    const [nextLeftSize, nextWorkbenchSize, nextChatSize] = sizes;
    setLeftPaneSize(nextLeftSize);
    setWorkbenchPaneSize(nextWorkbenchSize);
    setChatPaneSize(nextChatSize);
  }, []);

  const handleWorkspaceResize = useCallback((sizes: number[]) => {
    pendingWorkspaceSizesRef.current = sizes;
    if (workspaceResizeFrameRef.current !== null) {
      return;
    }
    workspaceResizeFrameRef.current = window.requestAnimationFrame(() => {
      workspaceResizeFrameRef.current = null;
      const nextSizes = pendingWorkspaceSizesRef.current;
      pendingWorkspaceSizesRef.current = null;
      if (nextSizes) {
        flushWorkspaceResize(nextSizes);
      }
    });
  }, [flushWorkspaceResize]);

  const handleWorkspaceResizeEnd = useCallback((sizes: number[]) => {
    if (workspaceResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(workspaceResizeFrameRef.current);
      workspaceResizeFrameRef.current = null;
    }
    pendingWorkspaceSizesRef.current = null;
    flushWorkspaceResize(sizes);
  }, [flushWorkspaceResize]);

  const flushKnowledgeDockResize = useCallback((sizes: number[]) => {
    if (sizes.length !== 2) {
      return;
    }
    const nextDockSize = sizes[1];
    if (Number.isFinite(nextDockSize) && nextDockSize > 0) {
      setKnowledgeDockSize(nextDockSize);
    }
  }, []);

  const handleKnowledgeDockResize = useCallback((sizes: number[]) => {
    pendingKnowledgeDockSizesRef.current = sizes;
    if (knowledgeDockResizeFrameRef.current !== null) {
      return;
    }
    knowledgeDockResizeFrameRef.current = window.requestAnimationFrame(() => {
      knowledgeDockResizeFrameRef.current = null;
      const nextSizes = pendingKnowledgeDockSizesRef.current;
      pendingKnowledgeDockSizesRef.current = null;
      if (nextSizes) {
        flushKnowledgeDockResize(nextSizes);
      }
    });
  }, [flushKnowledgeDockResize]);

  const handleKnowledgeDockResizeEnd = useCallback((sizes: number[]) => {
    if (knowledgeDockResizeFrameRef.current !== null) {
      window.cancelAnimationFrame(knowledgeDockResizeFrameRef.current);
      knowledgeDockResizeFrameRef.current = null;
    }
    pendingKnowledgeDockSizesRef.current = null;
    flushKnowledgeDockResize(sizes);
  }, [flushKnowledgeDockResize]);

  useEffect(() => {
    return () => {
      if (workspaceResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(workspaceResizeFrameRef.current);
        workspaceResizeFrameRef.current = null;
      }
      if (knowledgeDockResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(knowledgeDockResizeFrameRef.current);
        knowledgeDockResizeFrameRef.current = null;
      }
      pendingWorkspaceSizesRef.current = null;
      pendingKnowledgeDockSizesRef.current = null;
    };
  }, []);

  const handleKnowledgeDockCollapseChange = useCallback((activeKey: string | string[]) => {
    const nextExpanded = Array.isArray(activeKey)
      ? activeKey.includes(KNOWLEDGE_DOCK_COLLAPSE_KEY)
      : activeKey === KNOWLEDGE_DOCK_COLLAPSE_KEY;

    setKnowledgeModuleCollapsed(!nextExpanded);
  }, []);

  const projectWorkspaceSummary = useMemo(
    () => buildProjectWorkspaceSummary({
      projectName: selectedProject?.name || routeProjectId || "-",
      projectDescription: selectedProject?.description || "",
      workspaceDir: selectedProject?.workspace_dir || currentAgent?.workspace_dir || "",
    }),
    [
      currentAgent?.workspace_dir,
      routeProjectId,
      selectedProject?.description,
      selectedProject?.name,
      selectedProject?.workspace_dir,
    ],
  );

  const priorityFilePaths = useMemo(
    () => selectSeedSourceFiles(effectiveProjectFiles.map((item) => item.path)),
    [effectiveProjectFiles],
  );

  const selectedRunAllStepsSucceeded = useMemo(() => {
    if (!runDetail || runDetail.steps.length === 0) {
      return false;
    }
    return runDetail.steps.every((step) => isSucceededStatus(step.status));
  }, [runDetail]);

  const selectedRunEvidenceCoverage = useMemo(() => {
    if (!runDetail || runDetail.steps.length === 0) {
      return false;
    }
    return runDetail.steps.every((step) => (step.evidence || []).length > 0);
  }, [runDetail]);

  const hasTwoSucceededRuns = succeededRunCountForSelectedTemplate >= 2;
  const canPromoteToTemplateDraft =
    hasTwoSucceededRuns && selectedRunAllStepsSucceeded && selectedRunEvidenceCoverage;

  const verificationGateSummary = useMemo(
    () =>
      [
        `连续成功>=2: ${hasTwoSucceededRuns ? "yes" : "no"}`,
        `当前运行步骤全成功: ${selectedRunAllStepsSucceeded ? "yes" : "no"}`,
        `当前运行证据覆盖: ${selectedRunEvidenceCoverage ? "yes" : "no"}`,
      ].join("; "),
    [hasTwoSucceededRuns, selectedRunAllStepsSucceeded, selectedRunEvidenceCoverage],
  );

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await agentsApi.listAgents();
      setAgents(data.agents);
    } catch (err) {
      console.error("failed to load agent projects", err);
      setError(
        t(
          "projects.loadFailed",
          "Failed to load projects for the current agent.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [setAgents, t]);

  const loadAgentProjects = useCallback(async (agentId: string) => {
    if (!agentId) {
      setProjects([]);
      return;
    }

    setProjectsLoading(true);
    setError("");
    try {
      const items = await agentsApi.listAgentProjects(agentId);
      setProjects(items);
    } catch (err) {
      console.error("failed to load project list", err);
      setProjects([]);
      setError(
        t(
          "projects.loadFailed",
          "Failed to load projects for the current agent.",
        ),
      );
    } finally {
      setProjectsLoading(false);
    }
  }, [t]);

  const loadProjectFiles = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
    options?: { preserveSelection?: boolean },
  ): Promise<string> => {
    setFilesLoading(true);
    const preserveSelection = Boolean(options?.preserveSelection);
    const previousSelection = preserveSelection ? selectedFilePath : "";
    if (!preserveSelection) {
      setSelectedFilePath("");
      setFileContent("");
    }
    const projectIds = buildProjectRequestCandidates(project, {
      preferredProjectRequestId: resolvedProjectRequestId,
      routeProjectId,
    });
    try {
      const resolved = await resolveProjectRequestCandidate({
        projectRequestIds: projectIds,
        retryCount: 1,
        retryDelayMs: 300,
        loader: async (projectRequestId) => agentsApi.queryProjectFiles(
          agentId,
          projectRequestId,
          projectFilesQueryBody,
        ),
      });
      const queryResponse = resolved.value;
      const filteredFiles = queryResponse.items
        .map((item) => ({
          filename: item.filename,
          path: item.path,
          size: item.size,
          modified_time: item.modified_time,
          stage: item.stage,
          content_type: item.content_type,
          builtin: item.builtin,
          ignored: item.ignored,
        }));
      setProjectFiles(filteredFiles);
      setProjectFilesQuerySummary(queryResponse.summary || null);
      // Keep a superset cache so selection does not get invalidated by transient file-tree filters.
      setKnownProjectFilesByPath((prev) => ({
        ...prev,
        ...buildProjectFilesByPath(filteredFiles),
      }));
      setResolvedProjectRequestId(resolved.projectRequestId);
      const preservedFile = previousSelection
        ? filteredFiles.find((item) => item.path === previousSelection)
        : undefined;
      const rootLevelDefaultFile = filteredFiles.find((item) => (
        !item.path.includes("/") && isPreviewablePath(item.path)
      ));
      const defaultFile = filteredFiles.find((item) =>
        isPreviewablePath(item.path),
      );
      const nextSelectedPath = preservedFile?.path || rootLevelDefaultFile?.path || defaultFile?.path || "";
      if (nextSelectedPath) {
        setSelectedFilePath(nextSelectedPath);
      }
      setError((prev) => (
        prev === t("projects.loadFilesFailed") ? "" : prev
      ));
      return resolved.projectRequestId;
    } catch (err) {
      console.error("failed to load project files", err);
      setProjectFiles([]);
      setProjectFilesQuerySummary(null);
      setError(
        t("projects.loadFilesFailed"),
      );
      return "";
    } finally {
      setFilesLoading(false);
    }
  }, [projectFilesQueryBody, resolvedProjectRequestId, routeProjectId, selectedFilePath, t]);

  const loadProjectTreeDirectory = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
    dirPath = "",
    preferredProjectRequestId = "",
  ): Promise<AgentProjectFileTreeNode[]> => {
    const projectIds = buildProjectRequestCandidates(project, {
      preferredProjectRequestId: preferredProjectRequestId || resolvedProjectRequestId,
      routeProjectId,
    });

    const resolved = await resolveProjectRequestCandidate({
      projectRequestIds: projectIds,
      loader: async (projectRequestId) => agentsApi.listProjectFileTree(
        agentId,
        projectRequestId,
        dirPath,
      ),
    });
    const visibleNodes = resolved.value.filter((item) => !isIgnoredProjectFile(item.path));
    setKnownProjectFilesByPath((prev) => mergeProjectTreeNodesByPath(prev, visibleNodes));
    setResolvedProjectRequestId(resolved.projectRequestId);
    return visibleNodes;
  }, [resolvedProjectRequestId, routeProjectId]);

  const loadProjectFileSummary = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
    preferredProjectRequestId = "",
  ) => {
    const projectIds = buildProjectRequestCandidates(project, {
      preferredProjectRequestId: preferredProjectRequestId || resolvedProjectRequestId,
      routeProjectId,
    });

    const resolved = await resolveProjectRequestCandidate({
      projectRequestIds: projectIds,
      loader: async (projectRequestId) => agentsApi.getProjectFileSummary(agentId, projectRequestId),
    });
    setProjectFileSummary(resolved.value);
    setLatestUpdatedFilePath((prev) => pickLatestRecentUpdatePath(resolved.value) || prev || "");
    setResolvedProjectRequestId(resolved.projectRequestId);
    return resolved.value;
  }, [resolvedProjectRequestId, routeProjectId]);

  const loadProjectTreeRoot = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
    preferredProjectRequestId = "",
  ) => {
    setProjectTreeLoading(true);
    try {
      const nodes = await loadProjectTreeDirectory(agentId, project, "", preferredProjectRequestId);
      setProjectTreeNodes(nodes);

      if (!selectedFilePath) {
        const previewPath = nodes.find(
          (item) => !item.is_directory && isPreviewablePath(item.path),
        )?.path || "";

        if (previewPath) {
          setSelectedFilePath((prev) => prev || previewPath);
        }
      }
    } catch (err) {
      console.error("failed to load project tree root", err);
      setProjectTreeNodes([]);
    } finally {
      setProjectTreeLoading(false);
    }
  }, [loadProjectTreeDirectory, selectedFilePath]);

  const {
    bootstrapProjectDetailData,
    handleRefreshProjectFiles,
  } = useProjectDetailBootstrap({
    currentAgent,
    selectedProject,
    loadProjectFiles,
    loadProjectTreeRoot,
    loadProjectFileSummary,
  });

  const {
    uploadModalOpen,
    setUploadModalOpen,
    uploadingFiles,
    pendingUploads,
    setPendingUploads,
    uploadTargetDir,
    setUploadTargetDir,
    uploadMode,
    setUploadMode,
    resetUploadState,
    handleUploadFiles,
  } = useProjectUploadController({
    currentAgent,
    selectedProject,
    resolvedProjectRequestId,
    setResolvedProjectRequestId,
    onUploadCompleted: handleRefreshProjectFiles,
  });

  const uploadModalHint = useMemo(() => {
    if (selectedRunId) {
      return `${t("projects.upload.batchHint", { runId: selectedRunId })} ${t("projects.upload.batchBehaviorHint")}`;
    }
    return `${t("projects.upload.defaultHint")} ${t("projects.upload.batchBehaviorHint")}`;
  }, [selectedRunId, t]);

  const openProjectUploadModal = useCallback(() => {
    setPendingUploads([]);
    setUploadTargetDir("");
    setUploadMode("files");
    setUploadModalOpen(true);
  }, [setPendingUploads, setUploadTargetDir, setUploadMode, setUploadModalOpen]);

  const openRunBatchUploadModal = useCallback(() => {
    setPendingUploads([]);
    setUploadTargetDir(selectedRunId ? `original/batches/${selectedRunId}` : "original/batches/manual");
    setUploadMode("files");
    setUploadModalOpen(true);
  }, [selectedRunId, setPendingUploads, setUploadTargetDir, setUploadMode, setUploadModalOpen]);

  const shouldBlockLeave = useMemo(() => {
    const runInProgress = runDetail?.status === "running" || runDetail?.status === "pending";
    const designSessionActive = Boolean(designFocusChatId && !selectedRunId);

    return Boolean(
      selectedAttachPaths.length > 0 ||
      pendingUploads.length > 0 ||
      deletingProjectPaths.length > 0 ||
      uploadModalOpen ||
      importModalOpen ||
      sendingSelectedFiles ||
      uploadingFiles ||
      chatStarting ||
      createRunLoading ||
      runInProgress ||
      designSessionActive,
    );
  }, [
    chatStarting,
    createRunLoading,
    deletingProjectPaths.length,
    designFocusChatId,
    importModalOpen,
    pendingUploads.length,
    runDetail?.status,
    selectedAttachPaths.length,
    selectedRunId,
    sendingSelectedFiles,
    uploadModalOpen,
    uploadingFiles,
  ]);
  useLeaveConfirmGuard({ enabled: shouldBlockLeave, confirmText: leaveConfirmText });

  const loadFileContent = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
    filePath: string,
  ) => {
    setContentLoading(true);
    setFileContent("");
    try {
      const resolved = await resolveProjectRequestCandidate({
        projectRequestIds: buildProjectRequestCandidates(project, {
          preferredProjectRequestId: resolvedProjectRequestId,
          routeProjectId,
        }),
        loader: async (projectRequestId) => agentsApi.readProjectFile(
          agentId,
          projectRequestId,
          filePath,
        ),
      });
      setFileContent(resolved.value.content);
      setResolvedProjectRequestId(resolved.projectRequestId);
    } catch (err) {
      console.error("failed to load project file content", err);
      setFileContent(
        t(
          "projects.previewLoadFailed",
          "Unable to preview this file. It might be binary or inaccessible.",
        ),
      );
    } finally {
      setContentLoading(false);
    }
  }, [resolvedProjectRequestId, routeProjectId, t]);

  const fetchProjectFileSnippet = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
    filePath: string,
  ): Promise<string> => {
    const resolved = await resolveProjectRequestCandidate({
      projectRequestIds: buildProjectRequestCandidates(project, {
        preferredProjectRequestId: resolvedProjectRequestId,
        routeProjectId,
      }),
      loader: async (projectRequestId) => agentsApi.readProjectFile(
        agentId,
        projectRequestId,
        filePath,
      ),
    });
    setResolvedProjectRequestId(resolved.projectRequestId);
    return (resolved.value.content || "")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 1200);
  }, [resolvedProjectRequestId, routeProjectId]);

  const loadRunDetail = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
    runId: string,
  ) => {
    try {
      const resolved = await resolveProjectRequestCandidate({
        projectRequestIds: buildProjectRequestCandidates(project, {
          preferredProjectRequestId: resolvedProjectRequestId,
          routeProjectId,
        }),
        loader: async (projectRequestId) => agentsApi.getProjectPipelineRun(
          agentId,
          projectRequestId,
          runId,
        ),
      });
      setRunDetail(resolved.value);
      setResolvedProjectRequestId(resolved.projectRequestId);
      if (resolved.value.artifacts.length > 0) {
        setSelectedFilePath((prev) => prev || resolved.value.artifacts[0]);
      }
    } catch (err) {
      console.error("failed to load pipeline run detail", err);
      setRunDetail(null);
      setError(
        t("projects.pipeline.loadRunFailed"),
      );
    }
  }, [resolvedProjectRequestId, routeProjectId, t]);

  const loadPipelineContext = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
  ) => {
    setPipelineLoading(true);
    try {
      const resolved = await resolveProjectRequestCandidate({
        projectRequestIds: buildProjectRequestCandidates(project, {
          preferredProjectRequestId: resolvedProjectRequestId,
          routeProjectId,
        }),
        loader: async (projectRequestId) => Promise.all([
          agentsApi.listProjectPipelineTemplates(agentId, projectRequestId),
          agentsApi.listProjectPipelineRuns(agentId, projectRequestId),
        ]),
      });
      const [templates, runs] = resolved.value;
      setResolvedProjectRequestId(resolved.projectRequestId);
      setError("");
      setPipelineTemplates(templates);
      setPipelineRuns(runs);

      if (templates.length > 0) {
        setSelectedTemplateId((prev) =>
          templates.some((item) => item.id === prev) ? prev : templates[0].id,
        );
      } else {
        setSelectedTemplateId("");
      }

      if (runs.length > 0) {
        setSelectedRunId((prev) => (runs.some((item) => item.id === prev) ? prev : ""));
      } else {
        setSelectedRunId("");
        setRunDetail(null);
      }
    } catch (err) {
      console.error("failed to load pipeline context", err);
      setPipelineTemplates([]);
      setPipelineRuns([]);
      setSelectedTemplateId("");
      setSelectedRunId("");
      setRunDetail(null);
      setError(
        `${t("projects.pipeline.loadFailed")} ${(err as Error)?.message || ""}`.trim(),
      );
    } finally {
      setPipelineLoading(false);
    }
  }, [resolvedProjectRequestId, routeProjectId, t]);

  const handleRealtimeFileTreeInvalidated = useCallback((payload?: {
    changedPaths: string[];
    changedDirs: string[];
    changedPathsTruncated: boolean;
    reason: string;
    fileSummary?: AgentProjectFileSummary;
  }) => {
    if (payload?.fileSummary) {
      setProjectFileSummary(payload.fileSummary);
    }
    // Keep realtime scoped to knowledge-side health signals; file/workbench sync stays manual.
  }, []);

  const handleRealtimePipelineInvalidated = useCallback(() => {
    // Keep realtime as a lightweight signal channel; pipeline refresh stays manual.
  }, []);

  const handleAssistantTurnCompleted = useCallback(() => {
    // Assistant completion no longer triggers project file/pipeline auto-refresh.
  }, []);

  const handleOpenImportModal = useCallback(async () => {
    if (!currentAgent) {
      return;
    }
    setImportLoading(true);
    try {
      const templates = await agentsApi.listPlatformFlowTemplates(currentAgent.id);
      setPlatformTemplates(templates);
      setSelectedPlatformTemplateId((prev) => {
        if (prev && templates.some((item) => item.id === prev)) {
          return prev;
        }
        return templates[0]?.id || "";
      });
      setImportModalOpen(true);
    } catch (err) {
      console.error("failed to load platform templates", err);
      message.error(
        t("projects.pipeline.loadGlobalFailed"),
      );
    } finally {
      setImportLoading(false);
    }
  }, [currentAgent, t]);

  const handleImportPlatformTemplate = useCallback(async () => {
    if (!currentAgent || !selectedProject || !selectedPlatformTemplateId) {
      return;
    }

    setImportLoading(true);

    try {
      const resolved = await resolveProjectRequestCandidate({
        projectRequestIds: buildProjectRequestCandidates(selectedProject, {
          preferredProjectRequestId: resolvedProjectRequestId,
          routeProjectId,
        }),
        loader: async (projectRequestId) => agentsApi.importPlatformTemplateIntoProject(
          currentAgent.id,
          projectRequestId,
          { platform_template_id: selectedPlatformTemplateId },
        ),
      });
      setResolvedProjectRequestId(resolved.projectRequestId);

      await loadPipelineContext(currentAgent.id, selectedProject);
      setSelectedTemplateId(resolved.value.id);
      setImportModalOpen(false);
      message.success(
        t("projects.pipeline.importGlobalSuccess"),
      );
    } catch (err) {
      console.error("failed to import global template", err);
      message.error(
        t("projects.pipeline.importGlobalFailed"),
      );
    } finally {
      setImportLoading(false);
    }
  }, [
    currentAgent,
    loadPipelineContext,
    resolvedProjectRequestId,
    selectedPlatformTemplateId,
    selectedProject,
    routeProjectId,
    t,
  ]);

  const pollPipelineRun = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
    runId: string,
  ) => {
    try {
      const resolved = await resolveProjectRequestCandidate({
        projectRequestIds: buildProjectRequestCandidates(project, {
          preferredProjectRequestId: resolvedProjectRequestId,
          routeProjectId,
        }),
        loader: async (projectRequestId) => Promise.all([
          agentsApi.listProjectPipelineRuns(agentId, projectRequestId),
          agentsApi.getProjectPipelineRun(agentId, projectRequestId, runId),
        ]),
      });
      const [runs, detail] = resolved.value;
      setPipelineRuns(runs);
      setRunDetail(detail);
      setResolvedProjectRequestId(resolved.projectRequestId);
    } catch (err) {
      console.error("failed to poll pipeline run", err);
    }
  }, [resolvedProjectRequestId, routeProjectId]);

  const handleSwitchToRunFocusChat = useCallback((params: {
    runId: string;
    projectRequestId?: string;
  }) => {
    if (!selectedProject) {
      return;
    }

    const prevFocusChatId = runFocusChatIdRef.current;
    if (prevFocusChatId) {
      void chatApi
        .clearChatMeta(prevFocusChatId, {
          user_id: "default",
          channel: "console",
        })
        .catch(() => {});
    }

    setRunFocusChatId("");
    void chatApi.createChat({
      name: `[focus] ${selectedProject.name}`,
      session_id: `project-run-${params.runId}`,
      user_id: "default",
      channel: "console",
      meta: {
        focus_type: "project_run",
        focus_id: selectedProject.id,
        project_id: selectedProject.id,
        project_request_id: params.projectRequestId || selectedProject.id,
        run_id: params.runId,
        focus_path: `projects/${selectedProject.id}`,
      },
    }).then((chat) => {
      setRunFocusChatId(chat.id);
    }).catch((err) => {
      console.warn("[focus] failed to create project focus chat", err);
    });
  }, [selectedProject]);

  const handleCreateRun = useCallback(async () => {
    if (!currentAgent || !selectedProject || !selectedTemplateId) {
      return;
    }
    setCreateRunLoading(true);
    try {
      const resolved = await resolveProjectRequestCandidate({
        projectRequestIds: buildProjectRequestCandidates(selectedProject, {
          preferredProjectRequestId: resolvedProjectRequestId,
          routeProjectId,
        }),
        loader: async (projectRequestId) => agentsApi.createProjectPipelineRun(
          currentAgent.id,
          projectRequestId,
          {
            template_id: selectedTemplateId,
            parameters: {
              input_scope: "all_original",
              input_scope_policy: "default_if_no_batch_upload",
            },
          },
        ),
      });
      const run = resolved.value;
      const requestProjectId = resolved.projectRequestId;
      setResolvedProjectRequestId(requestProjectId);

      await loadPipelineContext(currentAgent.id, selectedProject);
      setSelectedRunId(run.id);
      setRunDetail(run);
      handleSwitchToRunFocusChat({
        runId: run.id,
        projectRequestId: requestProjectId || selectedProject.id,
      });
    } catch (err) {
      console.error("failed to create pipeline run", err);
      setError(
        t("projects.pipeline.createRunFailed"),
      );
    } finally {
      setCreateRunLoading(false);
    }
  }, [currentAgent, handleSwitchToRunFocusChat, loadPipelineContext, resolvedProjectRequestId, routeProjectId, selectedProject, selectedTemplateId, t]);

  const {
    handleEnsureRunChat,
    handleEnsureWorkspaceChat,
  } = useProjectChatEnsureController({
    selectedProject,
    routeWorkspaceChatId,
    selectedRunId,
    activeRunChatId,
    workspaceFocusChatId,
    resolvedProjectRequestId,
    runFocusChatIdRef,
    workspaceFocusChatIdRef,
    setRunFocusChatId,
    setWorkspaceFocusChatId,
    setChatStarting,
    setError,
    startFailedText: t("projects.chat.startFailed"),
  });

  const { handleEnsureDesignChat } = useProjectDesignChatController({
    activeDesignChatId,
    currentAgent,
    selectedProject,
    selectedTemplateId,
    selectedTemplateName: selectedTemplate?.name || selectedProject?.name || "",
    selectedTemplateVersion: selectedTemplate?.version || "0",
    resolvedProjectRequestId,
    projectFiles: effectiveProjectFiles,
    designFocusChatIdRef,
    setDesignFocusChatId,
    setChatStarting,
    setError,
    startFailedText: t("projects.chat.startFailed"),
  });

  const {
    preferredWorkspaceChatId,
    applyWorkspaceChatFocus,
    syncPreferredWorkspaceChatBinding,
    resetPreferredWorkspaceChatBinding,
  } = usePreferredProjectWorkspaceChat({
    currentAgentId: currentAgent?.id,
    selectedProject,
    routeWorkspaceChatId,
    workspaceFocusChatId,
    activeWorkspaceChatId,
    activeDesignChatId,
    selectedRunId,
    setSelectedRunId,
    setSelectedStepId,
    setRunDetail,
    setRunFocusChatId,
    setDesignFocusChatId,
    setWorkspaceFocusChatId,
  });

  const navigateToWorkspaceChat = useCallback((chatIdValue: string, replace = false) => {
    if (!selectedProject?.id || !chatIdValue) {
      return;
    }
    const targetPath = buildProjectWorkspaceChatPath(selectedProject.id, chatIdValue);
    if (location.pathname === targetPath) {
      return;
    }
    navigate(targetPath, { replace });
  }, [location.pathname, navigate, selectedProject?.id]);

  const selectWorkspaceChatSession = useCallback((chatIdValue: string, replace = false) => {
    applyWorkspaceChatFocus(chatIdValue);
    navigateToWorkspaceChat(chatIdValue, replace);
  }, [applyWorkspaceChatFocus, navigateToWorkspaceChat]);

  const selectDesignChatSession = useCallback((chatId: string) => {
    setRunFocusChatId("");
    setWorkspaceFocusChatId("");
    setDesignFocusChatId(chatId);
  }, []);

  const selectRunChatSession = useCallback((chatId: string) => {
    setRunFocusChatId(chatId);
  }, []);

  const handleStartWorkspaceChat = useCallback(() => {
    setDesignFocusChatId("");
    void (async () => {
      const createdChatId = await handleEnsureWorkspaceChat(true);
      if (createdChatId) {
        navigateToWorkspaceChat(createdChatId);
      }
    })();
  }, [handleEnsureWorkspaceChat, navigateToWorkspaceChat]);

  const handleStartDesignChat = useCallback(() => {
    setWorkspaceFocusChatId("");
    void handleEnsureDesignChat(true);
  }, [handleEnsureDesignChat]);

  const handleStartRunChat = useCallback(() => {
    void handleEnsureRunChat(true);
  }, [handleEnsureRunChat]);

  const ensureVisibleProjectChat = useCallback(async (): Promise<string> => {
    if (projectChatMode === "run") {
      return activeRunChatId || handleEnsureRunChat(false);
    }
    if (projectChatMode === "design") {
      return activeDesignChatId || handleEnsureDesignChat(false, true);
    }
    return activeWorkspaceChatId || handleEnsureWorkspaceChat(false);
  }, [
    activeDesignChatId,
    activeRunChatId,
    activeWorkspaceChatId,
    handleEnsureDesignChat,
    handleEnsureRunChat,
    handleEnsureWorkspaceChat,
    projectChatMode,
  ]);

  const prepareDraftInChat = useCallback(async (params: {
    ensureChat: () => Promise<string>;
    request: ProjectChatAutoAttachRequest;
    successText: string;
  }): Promise<boolean> => {
    const chatId = await params.ensureChat();
    if (!chatId) {
      message.error(t("projects.chat.startFailed"));
      return false;
    }

    setAutoAttachRequest(params.request);
    message.success(params.successText);
    return true;
  }, [t]);

  const loadManualRecoverCandidates = useCallback(async () => {
    setManualRecoverLoading(true);
    try {
      const chats = await chatApi.listChats({
        user_id: "default",
        channel: "console",
      });
      const sorted = [...chats].sort((a, b) =>
        toTimestamp(b.updated_at || b.created_at) -
        toTimestamp(a.updated_at || a.created_at),
      );
      setManualRecoverCandidates(sorted);
    } catch (err) {
      console.error("failed to load recoverable chats", err);
      setManualRecoverCandidates([]);
      setError(
        t("projects.chat.manualRecoverListFailed", "Failed to load history chats."),
      );
    } finally {
      setManualRecoverLoading(false);
    }
  }, [setError, t]);

  const handleOpenManualRecoverDialog = useCallback(async () => {
    if (!selectedProject) {
      return;
    }
    setManualRecoverOpen(true);
    setManualRecoverChatId("");
    await loadManualRecoverCandidates();
  }, [loadManualRecoverCandidates, selectedProject]);

  const handleConfirmManualRecover = useCallback(async () => {
    if (!selectedProject || !manualRecoverChatId) {
      return;
    }
    setManualRecoverLoading(true);
    try {
      const fallbackChats =
        manualRecoverCandidates.length > 0
          ? manualRecoverCandidates
          : await chatApi.listChats({ user_id: "default", channel: "console" });
      const target = fallbackChats.find((chat) => chat.id === manualRecoverChatId);
      if (!target) {
        throw new Error("recover_chat_not_found");
      }

      const targetMeta =
        target.meta && typeof target.meta === "object"
          ? (target.meta as Record<string, unknown>)
          : {};

      await chatApi.updateChat(target.id, {
        meta: {
          ...targetMeta,
          focus_type: "project_workspace",
          focus_id: selectedProject.id,
          project_id: selectedProject.id,
          project_request_id: resolvedProjectRequestId || selectedProject.id,
          focus_path: `projects/${selectedProject.id}`,
          recovered_by: "manual_project_rebind",
          recovered_at: new Date().toISOString(),
        },
      });

      selectWorkspaceChatSession(target.id);
      await syncPreferredWorkspaceChatBinding(target.id);
      setManualRecoverOpen(false);
      message.success(
        t("projects.chat.manualRecoverSuccess", "Chat linked to current project."),
      );
    } catch (err) {
      console.error("failed to manually recover project chat", err);
      message.error(
        t("projects.chat.manualRecoverFailed", "Failed to recover chat binding."),
      );
    } finally {
      setManualRecoverLoading(false);
    }
  }, [
    manualRecoverCandidates,
    manualRecoverChatId,
    resolvedProjectRequestId,
    selectWorkspaceChatSession,
    selectedProject,
    syncPreferredWorkspaceChatBinding,
    t,
  ]);

  useProjectChatFocusEffects({
    runFocusChatId,
    workspaceFocusChatId,
    designFocusChatId,
    setRunFocusChatId,
    runDetailFocusChatId: runDetail?.focus_chat_id,
    selectedRunSummaryFocusChatId: selectedRunSummary?.focus_chat_id,
    runFocusChatIdRef,
    workspaceFocusChatIdRef,
    designFocusChatIdRef,
    runRestoreAttemptKeyRef,
    currentAgentId: currentAgent?.id,
    selectedProjectId: selectedProject?.id,
    selectedRunId,
    activeRunChatId,
    pipelineLoading,
    chatStarting,
    setError,
  });

  const realtimeConnectionState = useProjectRealtimeController({
    agentId: currentAgent?.id,
    projectId: selectedProject?.id,
    onFileTreeInvalidated: handleRealtimeFileTreeInvalidated,
    onPipelineInvalidated: handleRealtimePipelineInvalidated,
  });

  const realtimeConnectionText = useMemo(() => {
    if (realtimeConnectionState.status === "connected") {
      return t("projects.realtime.connected", "Realtime connected");
    }
    if (realtimeConnectionState.status === "reconnecting") {
      return t("projects.realtime.reconnecting", "Realtime reconnecting");
    }
    if (realtimeConnectionState.status === "degraded") {
      return t("projects.realtime.degraded", "Realtime degraded");
    }
    if (realtimeConnectionState.status === "paused") {
      return t("projects.realtime.paused", "Realtime paused");
    }
    return t("projects.realtime.connecting", "Realtime connecting");
  }, [realtimeConnectionState.status, t]);

  const showRealtimeHealthNotice =
    realtimeConnectionState.status === "reconnecting"
    || realtimeConnectionState.status === "degraded";

  useEffect(() => {
    if (!currentAgent) {
      void loadAgents();
      setProjects([]);
      return;
    }
    void loadAgentProjects(currentAgent.id);
  }, [currentAgent, loadAgentProjects, loadAgents]);

  useEffect(() => {
    if (!selectedFilePath) {
      return;
    }
    const ancestorKeys = buildProjectAncestorDirectoryPaths(selectedFilePath);
    if (ancestorKeys.length === 0) {
      return;
    }
    setTreeExpandedKeys((prev) => mergeExpandedProjectTreeKeys(prev, ancestorKeys));
  }, [selectedFilePath]);

  useEffect(() => {
    if (!projectFileSummary) {
      return;
    }
    setLatestUpdatedFilePath(pickLatestRecentUpdatePath(projectFileSummary));
  }, [projectFileSummary]);

  useEffect(() => {
    setResolvedProjectRequestId("");
    setProjectFiles([]);
    setProjectFilesQuerySummary(null);
    setProjectTreeNodes([]);
    setProjectFileSummary(null);
    setKnownProjectFilesByPath({});
    setSelectedFilePath("");
    setTreeExpandedKeys([]);
    setStaleProjectTreeDirectoryPaths([]);
    setLatestUpdatedFilePath("");
    setWorkbenchSyncNotice(null);
    setFileContent("");
    setPipelineTemplates([]);
    setPipelineRuns([]);
    setSelectedTemplateId("");
    setSelectedRunId("");
    setSelectedStepId("");
    setRunDetail(null);
    setRunFocusChatId("");
    setWorkspaceFocusChatId("");
    setDesignFocusChatId("");
    projectFilesLoadKeyRef.current = "";
    projectFilesViewLoadKeyRef.current = "";
    resetUploadState();
    setSelectedAttachPaths([]);
    setSendingSelectedFiles(false);
    runRestoreAttemptKeyRef.current = "";
    pipelineManualActivationRef.current = false;
    resetPreferredWorkspaceChatBinding();
  }, [resetPreferredWorkspaceChatBinding, resetUploadState, routeProjectId]);

  useEffect(() => {
    layoutPrefsLoadedRef.current = false;
    const storageKey = buildProjectLayoutStorageKey(routeProjectId);
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = parseProjectLayoutPrefs(raw);
      const restoredSelectedTreeFilePath = normalizeProjectTreeKey(parsed.selectedTreeFilePath);
      const restoredTreeExpandedKeys = budgetRestoredProjectTreeKeys(
        parsed.treeExpandedKeys,
        restoredSelectedTreeFilePath,
      );
      setActiveStage(parsed.activeStage);
      setKnowledgeModuleCollapsed(parsed.knowledgeModuleCollapsed);
      setKnowledgeDockTab(parsed.knowledgeDockTab);
      setSelectedMetricFilter(parsed.selectedMetricFilter);
      setProjectFileSearchQuery("");
      setTreeDisplayMode(parsed.treeDisplayMode);
      setTreeExpandedKeys(restoredTreeExpandedKeys);
      setSelectedFilePath(restoredSelectedTreeFilePath);
      setLeftPaneSize(Math.max(parsed.leftPaneSize, LEFT_PANE_MIN_SIZE));
      setWorkbenchPaneSize(Math.max(parsed.workbenchPaneSize, WORKBENCH_PANE_MIN_SIZE));
      setChatPaneSize(Math.max(parsed.chatPaneSize, CHAT_PANE_MIN_SIZE));
      setKnowledgeDockSize(Math.max(parsed.knowledgeDockSize, KNOWLEDGE_DOCK_MIN_SIZE));
    } catch {
      const parsed = parseProjectLayoutPrefs(null);
      setActiveStage(parsed.activeStage);
      setKnowledgeModuleCollapsed(parsed.knowledgeModuleCollapsed);
      setKnowledgeDockTab(parsed.knowledgeDockTab);
      setSelectedMetricFilter(parsed.selectedMetricFilter);
      setProjectFileSearchQuery("");
      setTreeDisplayMode(parsed.treeDisplayMode);
      setTreeExpandedKeys(parsed.treeExpandedKeys);
      setSelectedFilePath(parsed.selectedTreeFilePath);
      setLeftPaneSize(Math.max(parsed.leftPaneSize, LEFT_PANE_MIN_SIZE));
      setWorkbenchPaneSize(Math.max(parsed.workbenchPaneSize, WORKBENCH_PANE_MIN_SIZE));
      setChatPaneSize(Math.max(parsed.chatPaneSize, CHAT_PANE_MIN_SIZE));
      setKnowledgeDockSize(Math.max(parsed.knowledgeDockSize, KNOWLEDGE_DOCK_MIN_SIZE));
    } finally {
      layoutPrefsLoadedRef.current = true;
    }
  }, [routeProjectId]);

  useEffect(() => {
    if (!selectedMetricFilter) {
      return;
    }
    const nextStage = resolveStageFromFilter(selectedMetricFilter);
    if (nextStage !== activeStage) {
      setActiveStage(nextStage);
    }
  }, [activeStage, selectedMetricFilter]);

  useEffect(() => {
    if (!layoutPrefsLoadedRef.current) {
      return;
    }
    const storageKey = buildProjectLayoutStorageKey(routeProjectId);
    const payload: ProjectDetailLayoutPrefs = {
      leftPanelCollapsed: false,
      activeStage,
      knowledgeModuleCollapsed,
      knowledgeDockTab,
      selectedMetricFilter,
      treeDisplayMode,
      treeExpandedKeys,
      selectedTreeFilePath: selectedFilePath,
      leftPaneSize,
      workbenchPaneSize,
      chatPaneSize,
      knowledgeDockSize,
    };
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // Ignore storage quota and privacy mode errors.
    }
  }, [
    activeStage,
    chatPaneSize,
    knowledgeDockTab,
    knowledgeModuleCollapsed,
    knowledgeDockSize,
    leftPaneSize,
    routeProjectId,
    selectedMetricFilter,
    selectedFilePath,
    treeDisplayMode,
    treeExpandedKeys,
    workbenchPaneSize,
  ]);

  useOpenUploadQuery({
    pathname: location.pathname,
    search: location.search,
    navigate,
    onOpenUpload: openProjectUploadModal,
  });

  useArtifactSelectionGuards({
    selectedStepId,
    setSelectedStepId,
    currentStepIds,
    selectedFilePath,
    setSelectedFilePath,
    relatedArtifactPathsForSelectedStep,
    artifactRecords,
    filesLoading,
    knownProjectFilePaths,
    projectFiles: effectiveProjectFiles,
  });

  useEffect(() => {
    if (!currentAgent || !selectedProject) {
      return;
    }
    const loadKey = `${currentAgent.id}:${selectedProject.id}`;
    if (projectFilesLoadKeyRef.current === loadKey) {
      return;
    }
    projectFilesLoadKeyRef.current = loadKey;
    projectFilesViewLoadKeyRef.current = `${loadKey}:${projectFilesQuerySignature}`;
    void bootstrapProjectDetailData(currentAgent.id, selectedProject, { preserveSelection: true });
  }, [bootstrapProjectDetailData, currentAgent, projectFilesQuerySignature, selectedProject]);

  useEffect(() => {
    if (!currentAgent || !selectedProject) {
      return;
    }
    const baseLoadKey = `${currentAgent.id}:${selectedProject.id}`;
    if (projectFilesLoadKeyRef.current !== baseLoadKey) {
      return;
    }
    const viewLoadKey = `${baseLoadKey}:${projectFilesQuerySignature}`;
    if (projectFilesViewLoadKeyRef.current === viewLoadKey) {
      return;
    }
    projectFilesViewLoadKeyRef.current = viewLoadKey;
    void loadProjectFiles(currentAgent.id, selectedProject, { preserveSelection: true });
  }, [currentAgent, loadProjectFiles, projectFilesQuerySignature, selectedProject]);

  useEffect(() => {
    if (!currentAgent || !selectedProject) {
      return;
    }
    if (pipelineLoading || pipelineTemplates.length > 0 || pipelineRuns.length > 0) {
      return;
    }
    const allowManualStageLoad =
      pipelineManualActivationRef.current && activeStage === "output";
    if (!automationDrawerOpen && !allowManualStageLoad) {
      return;
    }
    void loadPipelineContext(currentAgent.id, selectedProject);
  }, [
    activeStage,
    automationDrawerOpen,
    currentAgent,
    loadPipelineContext,
    pipelineLoading,
    pipelineRuns.length,
    pipelineTemplates.length,
    selectedProject,
  ]);

  useEffect(() => {
    if (!currentAgent || !selectedProject || !selectedFilePath) {
      return;
    }
    if (!isPreviewablePath(selectedFilePath)) {
      setContentLoading(false);
      setFileContent(
        t(
          "projects.previewLoadFailed",
          "Unable to preview this file. It might be binary or inaccessible.",
        ),
      );
      return;
    }
    void loadFileContent(currentAgent.id, selectedProject, selectedFilePath);
  }, [currentAgent, selectedProject, selectedFilePath, loadFileContent, t]);

  useEffect(() => {
    if (!currentAgent || !selectedProject || !selectedFilePath) {
      setCharStatsContent("");
      return;
    }

    const charStatsPath = resolveCharStatsArtifactPath(selectedFilePath, effectiveProjectFiles);
    if (!charStatsPath) {
      setCharStatsContent("");
      return;
    }

    let disposed = false;
    setCharStatsContent("");

    const load = async () => {
      try {
        const resolved = await resolveProjectRequestCandidate({
          projectRequestIds: buildProjectRequestCandidates(selectedProject, {
            preferredProjectRequestId: resolvedProjectRequestId,
            routeProjectId,
          }),
          loader: async (projectRequestId) => agentsApi.readProjectFile(
            currentAgent.id,
            projectRequestId,
            charStatsPath,
          ),
        });
        if (disposed) {
          return;
        }
        setResolvedProjectRequestId(resolved.projectRequestId);
        setCharStatsContent(resolved.value.content || "");
      } catch {
        if (!disposed) {
          setCharStatsContent("");
        }
      }
    };

    void load();

    return () => {
      disposed = true;
    };
  }, [
    currentAgent,
    effectiveProjectFiles,
    resolvedProjectRequestId,
    routeProjectId,
    selectedFilePath,
    selectedProject,
  ]);

  useEffect(() => {
    if (!currentAgent || !selectedProject || !selectedFilePath) {
      setNerStructuredContent("");
      return;
    }

    const nerPath = resolveNerStructuredArtifactPath(selectedFilePath, effectiveProjectFiles);
    if (!nerPath) {
      setNerStructuredContent("");
      return;
    }

    let disposed = false;
    setNerStructuredContent("");

    const load = async () => {
      try {
        const resolved = await resolveProjectRequestCandidate({
          projectRequestIds: buildProjectRequestCandidates(selectedProject, {
            preferredProjectRequestId: resolvedProjectRequestId,
            routeProjectId,
          }),
          loader: async (projectRequestId) => agentsApi.readProjectFile(
            currentAgent.id,
            projectRequestId,
            nerPath,
          ),
        });
        if (disposed) {
          return;
        }
        setResolvedProjectRequestId(resolved.projectRequestId);
        setNerStructuredContent(resolved.value.content || "");
      } catch {
        if (!disposed) {
          setNerStructuredContent("");
        }
      }
    };

    void load();

    return () => {
      disposed = true;
    };
  }, [
    currentAgent,
    effectiveProjectFiles,
    resolvedProjectRequestId,
    routeProjectId,
    selectedFilePath,
    selectedProject,
  ]);

  useEffect(() => {
    if (!selectedTemplateId) {
      setSelectedRunId("");
      setRunDetail(null);
      return;
    }

    if (runsForSelectedTemplate.length === 0) {
      setSelectedRunId("");
      setRunDetail(null);
      return;
    }

    const hasPreferredWorkspaceChat = Boolean(
      preferredWorkspaceChatId,
    );

    setSelectedRunId((prev) =>
      runsForSelectedTemplate.some((item) => item.id === prev)
        ? prev
        : hasPreferredWorkspaceChat
          ? ""
          : runsForSelectedTemplate[0].id,
    );
  }, [
    preferredWorkspaceChatId,
    runsForSelectedTemplate,
    selectedTemplateId,
  ]);

  useEffect(() => {
    if (!selectedRunId) {
      setRunDetail(null);
      automationDrawerAutoOpenKeyRef.current = "";
    }
  }, [selectedRunId]);

  useEffect(() => {
    if (!selectedRunId) {
      return;
    }
    const runStatus = runDetail?.status || selectedRunSummary?.status || "";
    if (runStatus !== "running" && runStatus !== "failed") {
      return;
    }

    const autoOpenKey = `${selectedRunId}:${runStatus}`;
    if (automationDrawerAutoOpenKeyRef.current === autoOpenKey) {
      return;
    }
    automationDrawerAutoOpenKeyRef.current = autoOpenKey;
    setAutomationDrawerOpen(true);
  }, [
    runDetail?.status,
    selectedRunId,
    selectedRunSummary?.status,
  ]);

  useEffect(() => {
    if (!currentAgent || !selectedProject || !selectedRunId) {
      return;
    }
    void loadRunDetail(currentAgent.id, selectedProject, selectedRunId);
  }, [currentAgent, selectedProject, selectedRunId, loadRunDetail]);

  useEffect(() => {
    if (!currentAgent || !selectedProject || !selectedRunId) {
      return;
    }

    const runStatus = runDetail?.status || selectedRunSummary?.status;
    if (runStatus !== "running" && runStatus !== "pending") {
      return;
    }

    const timer = window.setInterval(() => {
      void pollPipelineRun(currentAgent.id, selectedProject, selectedRunId);
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    currentAgent,
    selectedProject,
    selectedRunId,
    runDetail?.status,
    selectedRunSummary?.status,
    pollPipelineRun,
  ]);

  const handleSelectStep = useCallback((stepId: string) => {
    setSelectedStepId((prev) => (prev === stepId ? "" : stepId));
  }, []);

  const handleDeleteProject = useCallback(async () => {
    if (!currentAgent || !selectedProject) {
      return;
    }

    setDeletingProject(true);
    try {
      await agentsApi.deleteProject(currentAgent.id, selectedProject.id);
      message.success(
        t("projects.deleteSuccess", {
          name: selectedProject.name || selectedProject.id,
        }),
      );
      await loadAgents();
      navigate("/projects");
    } catch (err) {
      console.error("failed to delete project", err);
      message.error(t("projects.deleteFailed"));
    } finally {
      setDeletingProject(false);
    }
  }, [currentAgent, loadAgents, navigate, selectedProject, t]);

  const normalizeProjectArtifactPath = useCallback((inputPath: string): string => {
    let nextPath = String(inputPath || "").trim().replace(/\\/g, "/");
    if (!nextPath) {
      return "";
    }

    // 兼容 file:// URL
    if (nextPath.startsWith("file://")) {
      nextPath = nextPath.replace(/^file:\/\//, "");
    }

    const workspaceDir = String(selectedProject?.workspace_dir || "").trim().replace(/\\/g, "/");
    if (workspaceDir) {
      const workspacePrefix = workspaceDir.endsWith("/") ? workspaceDir : `${workspaceDir}/`;
      if (nextPath === workspaceDir) {
        nextPath = "";
      } else if (nextPath.startsWith(workspacePrefix)) {
        nextPath = nextPath.slice(workspacePrefix.length);
      }
    }

    const projectIdCandidates = buildProjectIdCandidates(selectedProject);
    for (const candidate of projectIdCandidates) {
      const normalizedCandidate = String(candidate || "").trim();
      if (!normalizedCandidate) {
        continue;
      }
      const prefix = `projects/${normalizedCandidate}/`;
      if (nextPath.startsWith(prefix)) {
        nextPath = nextPath.slice(prefix.length);
        break;
      }
    }

    return nextPath.replace(/^\.\//, "").replace(/^\/+/, "");
  }, [selectedProject]);

  const handleSelectArtifactFile = useCallback(async (path: string) => {
    setWorkbenchSyncNotice(null);
    const normalizedPath = normalizeProjectArtifactPath(path);
    if (!normalizedPath) {
      return;
    }

    const parentDirPath = (() => {
      const lastSlashIndex = normalizedPath.lastIndexOf("/");
      if (lastSlashIndex <= 0) {
        return "";
      }
      return normalizedPath.slice(0, lastSlashIndex);
    })();

    if (currentAgent && selectedProject) {
      const treeProbePath = parentDirPath;
      try {
        const children = await loadProjectTreeDirectory(
          currentAgent.id,
          selectedProject,
          treeProbePath,
        );
        if (!parentDirPath) {
          setSelectedFilePath(normalizedPath);
          return;
        }
        const selection = resolveArtifactSelectionPath(treeProbePath, children);
        const expandedDirectoryPath = selection.expandedDirectoryPath;
        if (typeof expandedDirectoryPath === "string" && expandedDirectoryPath.length > 0) {
          setTreeExpandedKeys((prev) => mergeExpandedProjectTreeKeys(prev, [expandedDirectoryPath]));
        }
        if (parentDirPath) {
          setSelectedFilePath(normalizedPath);
          return;
        }
        if (selection.selectedPath) {
          setSelectedFilePath(selection.selectedPath);
          return;
        }
        if (children.length >= 0) {
          return;
        }
      } catch {
        // The path is likely a file rather than a directory.
      }
    }

    setSelectedFilePath(normalizedPath);
  }, [currentAgent, loadProjectTreeDirectory, normalizeProjectArtifactPath, selectedProject]);

  const handleLocateArtifactFile = useCallback(async (path: string) => {
    const normalizedPath = normalizeProjectArtifactPath(path);
    if (!normalizedPath) {
      return;
    }

    // 定位链路：先写过滤条件触发文件树查询，再选中文件触发预览。
    const filterKeyword = normalizedPath.split("/").pop() || normalizedPath;
    setProjectFileSearchQuery(filterKeyword);

    await handleSelectArtifactFile(normalizedPath);
  }, [handleSelectArtifactFile, normalizeProjectArtifactPath]);

  const handleAttachArtifactToChat = useCallback((path: string) => {
    setSelectedAttachPaths((prev) =>
      prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path],
    );
  }, [
    setSelectedAttachPaths,
  ]);

  const normalizeTreeNodeName = useCallback((value: string): string => {
    const next = String(value || "").trim();
    if (!next || next === "." || next === "..") {
      return "";
    }
    if (next.includes("/") || next.includes("\\")) {
      return "";
    }
    return next;
  }, []);

  const remapPathWithPrefix = useCallback((path: string, sourcePath: string, targetPath: string): string => {
    if (path === sourcePath) {
      return targetPath;
    }
    const sourcePrefix = `${sourcePath}/`;
    if (path.startsWith(sourcePrefix)) {
      return `${targetPath}${path.slice(sourcePath.length)}`;
    }
    return path;
  }, []);

  const performCreateProjectTreeDirectory = useCallback(async (
    parentPath: string,
    directoryName: string,
  ) => {
    if (!currentAgent || !selectedProject) {
      return;
    }

    const normalizedParent = normalizeProjectArtifactPath(parentPath);
    const normalizedName = normalizeTreeNodeName(directoryName);
    if (!normalizedName) {
      message.warning(t("projects.invalidDirectoryName", "Invalid folder name"));
      return;
    }
    const targetPath = normalizedParent ? `${normalizedParent}/${normalizedName}` : normalizedName;

    setDeletingProjectPaths((prev) => (
      prev.includes(targetPath) ? prev : [...prev, targetPath]
    ));

    let preferredProjectRequestId = resolvedProjectRequestId;

    try {
      const resolved = await resolveProjectRequestCandidate({
        projectRequestIds: buildProjectRequestCandidates(selectedProject, {
          preferredProjectRequestId,
          routeProjectId,
        }),
        loader: async (projectRequestId) => {
          await agentsApi.createProjectDirectory(
            currentAgent.id,
            projectRequestId,
            { path: targetPath },
          );
          return undefined;
        },
      });
      preferredProjectRequestId = resolved.projectRequestId;
      setResolvedProjectRequestId(resolved.projectRequestId);

      if (normalizedParent) {
        setTreeExpandedKeys((prev) => mergeExpandedProjectTreeKeys(prev, [normalizedParent]));
        setStaleProjectTreeDirectoryPaths((prev) => (
          prev.includes(normalizedParent) ? prev : [...prev, normalizedParent]
        ));
      }

      await handleRefreshProjectFiles();
      message.success(
        t("projects.createDirectorySuccess", "Created folder: {{path}}", { path: targetPath }),
      );
    } catch (err) {
      console.error("failed to create project directory", err);
      message.error(t("projects.createDirectoryFailed", "Failed to create folder"));
    } finally {
      setDeletingProjectPaths((prev) => prev.filter((path) => path !== targetPath));
    }
  }, [
    currentAgent,
    handleRefreshProjectFiles,
    normalizeProjectArtifactPath,
    normalizeTreeNodeName,
    resolvedProjectRequestId,
    routeProjectId,
    selectedProject,
    setResolvedProjectRequestId,
    t,
  ]);

  const performRenameProjectTreePath = useCallback(async (
    sourcePath: string,
    isDirectory: boolean,
    nextName: string,
    targetPathOverride?: string,
    conflictStrategy: "fail_if_exists" | "overwrite" = "fail_if_exists",
    options?: { refresh?: boolean; showMessage?: boolean; showErrorMessage?: boolean },
  ) => {
    const classifyMoveError = (err: unknown): {
      reason: "conflict" | "unsafe" | "permission" | "notFound" | "other";
      detail: string;
    } => {
      const status = Number((err as { response?: { status?: number } })?.response?.status || 0);
      const detail = String(
        (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
        || (err as { message?: unknown })?.message
        || "",
      ).trim();
      const normalizedDetail = detail.toLowerCase();

      if (
        status === 409
        || normalizedDetail.includes("exist")
        || normalizedDetail.includes("conflict")
      ) {
        return { reason: "conflict", detail };
      }
      if (
        status === 400
        && (
          normalizedDetail.includes("unsafe")
          || normalizedDetail.includes("invalid")
          || normalizedDetail.includes("path")
        )
      ) {
        return { reason: "unsafe", detail };
      }
      if (status === 403 || normalizedDetail.includes("permission") || normalizedDetail.includes("forbidden")) {
        return { reason: "permission", detail };
      }
      if (status === 404 || normalizedDetail.includes("not found")) {
        return { reason: "notFound", detail };
      }
      return { reason: "other", detail };
    };

    if (!currentAgent || !selectedProject) {
      return { ok: false, reason: "other" as const, detail: "missing context" };
    }
    const normalizedSourcePath = normalizeProjectArtifactPath(sourcePath);
    const normalizedName = normalizeTreeNodeName(nextName);
    if (!normalizedSourcePath || !normalizedName) {
      message.warning(t("projects.invalidName", "Invalid name"));
      return { ok: false, reason: "unsafe" as const, detail: "invalid path or name" };
    }

    const slashIndex = normalizedSourcePath.lastIndexOf("/");
    const parentPath = slashIndex >= 0 ? normalizedSourcePath.slice(0, slashIndex) : "";
    const normalizedTargetOverride = normalizeProjectArtifactPath(targetPathOverride || "");
    const targetPath = normalizedTargetOverride || (parentPath ? `${parentPath}/${normalizedName}` : normalizedName);
    if (targetPath === normalizedSourcePath) {
      return { ok: true };
    }

    const shouldRefresh = options?.refresh !== false;
    const shouldShowMessage = options?.showMessage !== false;
    const shouldShowErrorMessage = options?.showErrorMessage !== false;

    setDeletingProjectPaths((prev) => (
      prev.includes(normalizedSourcePath) ? prev : [...prev, normalizedSourcePath]
    ));

    let preferredProjectRequestId = resolvedProjectRequestId;

    try {
      const resolved = await resolveProjectRequestCandidate({
        projectRequestIds: buildProjectRequestCandidates(selectedProject, {
          preferredProjectRequestId,
          routeProjectId,
        }),
        loader: async (projectRequestId) => {
          await agentsApi.moveProjectPath(currentAgent.id, projectRequestId, {
            source_path: normalizedSourcePath,
            target_path: targetPath,
            conflict_strategy: conflictStrategy,
          });
          return undefined;
        },
      });
      preferredProjectRequestId = resolved.projectRequestId;
      setResolvedProjectRequestId(resolved.projectRequestId);

      setSelectedAttachPaths((prev) => {
        const remapped = prev.map((path) => remapPathWithPrefix(path, normalizedSourcePath, targetPath));
        return Array.from(new Set(remapped));
      });

      setTreeExpandedKeys((prev) => {
        const remapped = prev.map((path) => remapPathWithPrefix(path, normalizedSourcePath, targetPath));
        return Array.from(new Set(remapped));
      });

      setKnownProjectFilesByPath((prev) => {
        const next: Record<string, AgentProjectFileInfo> = {};
        for (const [path, info] of Object.entries(prev)) {
          const remappedPath = remapPathWithPrefix(path, normalizedSourcePath, targetPath);
          next[remappedPath] = {
            ...info,
            path: remappedPath,
          };
        }
        return next;
      });

      setSelectedFilePath((prev) => remapPathWithPrefix(prev, normalizedSourcePath, targetPath));
      setLatestUpdatedFilePath((prev) => remapPathWithPrefix(prev, normalizedSourcePath, targetPath));

      if (parentPath) {
        setStaleProjectTreeDirectoryPaths((prev) => (
          prev.includes(parentPath) ? prev : [...prev, parentPath]
        ));
      }

      if (shouldRefresh) {
        await handleRefreshProjectFiles();
      }
      if (shouldShowMessage) {
        message.success(
          isDirectory
            ? t("projects.renameDirectorySuccess", "Renamed folder to: {{path}}", { path: targetPath })
            : t("projects.renameFileSuccess", "Renamed file to: {{path}}", { path: targetPath }),
        );
      }
      return { ok: true };
    } catch (err) {
      console.error("failed to rename project path", err);
      const failure = classifyMoveError(err);
      if (shouldShowErrorMessage) {
        message.error(
          isDirectory
            ? t("projects.renameDirectoryFailed", "Failed to rename folder")
            : t("projects.renameFileFailed", "Failed to rename file"),
        );
      }
      return {
        ok: false,
        reason: failure.reason,
        detail: failure.detail,
      };
    } finally {
      setDeletingProjectPaths((prev) => prev.filter((path) => path !== normalizedSourcePath));
    }
  }, [
    currentAgent,
    handleRefreshProjectFiles,
    normalizeProjectArtifactPath,
    normalizeTreeNodeName,
    remapPathWithPrefix,
    resolvedProjectRequestId,
    routeProjectId,
    selectedProject,
    setResolvedProjectRequestId,
    t,
  ]);

  const handleRequestMoveProjectTreePath = useCallback((
    sourcePath: string,
    sourceIsDirectory: boolean,
    targetDirPath: string,
  ) => {
    const normalizedSourcePath = normalizeProjectArtifactPath(sourcePath);
    const normalizedTargetDir = normalizeProjectArtifactPath(targetDirPath);
    if (!normalizedSourcePath) {
      return;
    }
    const sourceName = normalizedSourcePath.split("/").filter(Boolean).pop() || "";
    if (!sourceName) {
      return;
    }
    const targetPath = normalizedTargetDir ? `${normalizedTargetDir}/${sourceName}` : sourceName;
    if (targetPath === normalizedSourcePath) {
      return;
    }
    const targetExists = Boolean(knownProjectFilesByPath[targetPath]);

    const executeMove = async (strategy: "fail_if_exists" | "overwrite") => {
      await performRenameProjectTreePath(
        normalizedSourcePath,
        sourceIsDirectory,
        sourceName,
        targetPath,
        strategy,
      );
    };

    const openMoveConfirm = () => {
      Modal.confirm({
        title: sourceIsDirectory
          ? t("projects.moveDirectoryTitle", "Move folder")
          : t("projects.moveFileTitle", "Move file"),
        content: t(
          "projects.moveConfirmDescription",
          "Move {{source}} to {{target}}?",
          { source: normalizedSourcePath, target: targetPath },
        ),
        okText: t("common.confirm", "Confirm"),
        cancelText: t("common.cancel", "Cancel"),
        onOk: async () => {
          await executeMove("fail_if_exists");
        },
      });
    };

    if (targetExists) {
      Modal.confirm({
        title: t("projects.moveConflictTitle", "Target already exists"),
        content: t(
          "projects.moveConflictDescription",
          "{{target}} already exists. Overwrite it?",
          { target: targetPath },
        ),
        okText: t("common.overwrite", "Overwrite"),
        cancelText: t("common.cancel", "Cancel"),
        okButtonProps: { danger: true },
        onOk: async () => {
          await executeMove("overwrite");
        },
      });
      return;
    }

    openMoveConfirm();
  }, [knownProjectFilesByPath, normalizeProjectArtifactPath, performRenameProjectTreePath, t]);

  const handleRequestCreateProjectTreeDirectory = useCallback((parentPath: string) => {
    const normalizedParent = normalizeProjectArtifactPath(parentPath);
    let nextName = "new-folder";

    Modal.confirm({
      title: t("projects.createDirectoryTitle", "Create folder"),
      content: (
        <Input
          autoFocus
          defaultValue={nextName}
          placeholder={t("projects.createDirectoryPlaceholder", "Folder name")}
          onChange={(event) => {
            nextName = event.target.value;
          }}
        />
      ),
      okText: t("common.create", "Create"),
      cancelText: t("common.cancel", "Cancel"),
      onOk: async () => {
        const normalizedName = normalizeTreeNodeName(nextName);
        if (!normalizedName) {
          message.warning(t("projects.invalidDirectoryName", "Invalid folder name"));
          return Promise.reject(new Error("invalid directory name"));
        }
        await performCreateProjectTreeDirectory(normalizedParent, normalizedName);
        return undefined;
      },
    });
  }, [normalizeProjectArtifactPath, normalizeTreeNodeName, performCreateProjectTreeDirectory, t]);

  const handleRequestRenameProjectTreePath = useCallback((path: string, isDirectory: boolean) => {
    const normalizedPath = normalizeProjectArtifactPath(path);
    if (!normalizedPath) {
      return;
    }
    const defaultName = normalizedPath.split("/").filter(Boolean).pop() || "";
    let nextName = defaultName;

    Modal.confirm({
      title: isDirectory
        ? t("projects.renameDirectoryTitle", "Rename folder")
        : t("projects.renameFileTitle", "Rename file"),
      content: (
        <Input
          autoFocus
          defaultValue={defaultName}
          placeholder={t("projects.renamePlaceholder", "New name")}
          onChange={(event) => {
            nextName = event.target.value;
          }}
        />
      ),
      okText: t("common.rename", "Rename"),
      cancelText: t("common.cancel", "Cancel"),
      onOk: async () => {
        const normalizedName = normalizeTreeNodeName(nextName);
        if (!normalizedName) {
          message.warning(t("projects.invalidName", "Invalid name"));
          return Promise.reject(new Error("invalid path name"));
        }
        const slashIndex = normalizedPath.lastIndexOf("/");
        const parentPath = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex) : "";
        const targetPath = parentPath ? `${parentPath}/${normalizedName}` : normalizedName;
        if (targetPath === normalizedPath) {
          return undefined;
        }

        const targetExists = Boolean(knownProjectFilesByPath[targetPath]);
        if (!targetExists) {
          await performRenameProjectTreePath(normalizedPath, isDirectory, normalizedName);
          return undefined;
        }

        return new Promise<void>((resolve, reject) => {
          Modal.confirm({
            title: t("projects.renameConflictTitle", "Target already exists"),
            content: t(
              "projects.renameConflictDescription",
              "{{target}} already exists. Overwrite it?",
              { target: targetPath },
            ),
            okText: t("common.overwrite", "Overwrite"),
            cancelText: t("common.cancel", "Cancel"),
            okButtonProps: { danger: true },
            onOk: async () => {
              await performRenameProjectTreePath(
                normalizedPath,
                isDirectory,
                normalizedName,
                targetPath,
                "overwrite",
              );
              resolve();
            },
            onCancel: () => {
              reject(new Error("rename overwrite cancelled"));
            },
          });
        });
      },
    });
  }, [
    knownProjectFilesByPath,
    normalizeProjectArtifactPath,
    normalizeTreeNodeName,
    performRenameProjectTreePath,
    t,
  ]);

  const performDeleteProjectTreePath = useCallback(async (
    normalizedPath: string,
    isDirectory: boolean,
    options?: { refresh?: boolean; showMessage?: boolean },
  ) => {
    if (!currentAgent || !selectedProject || !normalizedPath) {
      return;
    }

    setDeletingProjectPaths((prev) => (
      prev.includes(normalizedPath) ? prev : [...prev, normalizedPath]
    ));

    let preferredProjectRequestId = resolvedProjectRequestId;

    const shouldRefresh = options?.refresh !== false;
    const shouldShowMessage = options?.showMessage !== false;

    try {
      const resolved = await resolveProjectRequestCandidate({
        projectRequestIds: buildProjectRequestCandidates(selectedProject, {
          preferredProjectRequestId,
          routeProjectId,
        }),
        loader: async (projectRequestId) => {
          await agentsApi.deleteProjectPath(
            currentAgent.id,
            projectRequestId,
            normalizedPath,
          );
          return undefined;
        },
      });
      preferredProjectRequestId = resolved.projectRequestId;
      setResolvedProjectRequestId(resolved.projectRequestId);

      const removedPrefix = `${normalizedPath}/`;
      setSelectedAttachPaths((prev) =>
        prev.filter((path) => path !== normalizedPath && !path.startsWith(removedPrefix)),
      );

      setKnownProjectFilesByPath((prev) => {
        const next: Record<string, AgentProjectFileInfo> = {};
        for (const [path, info] of Object.entries(prev)) {
          if (path === normalizedPath || path.startsWith(removedPrefix)) {
            continue;
          }
          next[path] = info;
        }
        return next;
      });

      if (
        selectedFilePath === normalizedPath
        || selectedFilePath.startsWith(removedPrefix)
      ) {
        setSelectedFilePath("");
        setFileContent("");
        setCharStatsContent("");
        setNerStructuredContent("");
      }

      if (
        latestUpdatedFilePath === normalizedPath
        || latestUpdatedFilePath.startsWith(removedPrefix)
      ) {
        setLatestUpdatedFilePath("");
      }

      if (shouldRefresh) {
        await handleRefreshProjectFiles();
      }
      if (shouldShowMessage) {
        message.success(
          isDirectory
            ? t("projects.deleteDirectorySuccess", "Deleted folder: {{path}}", { path: normalizedPath })
            : t("projects.deleteFileSuccess", "Deleted file: {{path}}", { path: normalizedPath }),
        );
      }
    } catch (err) {
      console.error("failed to delete project path", err);
      message.error(
        isDirectory
          ? t("projects.deleteDirectoryFailed", "Failed to delete folder")
          : t("projects.deleteFileFailed", "Failed to delete file"),
      );
    } finally {
      setDeletingProjectPaths((prev) => prev.filter((path) => path !== normalizedPath));
    }
  }, [
    currentAgent,
    handleRefreshProjectFiles,
    latestUpdatedFilePath,
    resolvedProjectRequestId,
    routeProjectId,
    selectedFilePath,
    selectedProject,
    setResolvedProjectRequestId,
    t,
  ]);

  const handleRequestDeleteProjectTreePath = useCallback((path: string, isDirectory: boolean) => {
    const normalizedPath = normalizeProjectArtifactPath(path);
    if (!normalizedPath) {
      return;
    }

    Modal.confirm({
      title: isDirectory
        ? t("projects.deleteFileTreeDirectoryConfirmTitle", "Delete folder?")
        : t("projects.deleteFileTreeFileConfirmTitle", "Delete file?"),
      content: t(
        "projects.deleteFileTreeConfirmDescription",
        "This action is irreversible and will permanently delete {{path}}.",
        { path: normalizedPath },
      ),
      okText: t("common.delete", "Delete"),
      cancelText: t("common.cancel", "Cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        await performDeleteProjectTreePath(normalizedPath, isDirectory);
      },
    });
  }, [normalizeProjectArtifactPath, performDeleteProjectTreePath, t]);

  const handleRequestDeleteSelectedProjectFiles = useCallback((paths: string[]) => {
    const normalizedPaths = Array.from(new Set(
      (paths || [])
        .map((item) => normalizeProjectArtifactPath(item))
        .filter((item) => Boolean(item)),
    ));
    if (normalizedPaths.length === 0) {
      return;
    }

    Modal.confirm({
      title: t("projects.deleteSelectedFilesConfirmTitle", "Delete selected files?"),
      content: t(
        "projects.deleteSelectedFilesConfirmDescription",
        "This will permanently delete {{count}} selected files.",
        { count: normalizedPaths.length },
      ),
      okText: t("common.delete", "Delete"),
      cancelText: t("common.cancel", "Cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        let deletedCount = 0;
        for (const path of normalizedPaths) {
          await performDeleteProjectTreePath(path, false, { refresh: false, showMessage: false });
          deletedCount += 1;
        }
        await handleRefreshProjectFiles();
        message.success(
          t("projects.deleteSelectedFilesSuccess", "Deleted {{count}} files", {
            count: deletedCount,
          }),
        );
      },
    });
  }, [handleRefreshProjectFiles, normalizeProjectArtifactPath, performDeleteProjectTreePath, t]);

  const handleRequestMoveSelectedProjectFiles = useCallback((paths: string[]) => {
    const normalizedPaths = Array.from(new Set(
      (paths || [])
        .map((item) => normalizeProjectArtifactPath(item))
        .filter((item) => Boolean(item)),
    ));
    if (normalizedPaths.length === 0) {
      return;
    }

    let nextTargetDirectory = "";

    const executeBatchMove = async (targetDir: string, strategy: "fail_if_exists" | "overwrite") => {
      const plans = normalizedPaths
        .map((sourcePath) => {
          const sourceName = sourcePath.split("/").filter(Boolean).pop() || "";
          if (!sourceName) {
            return null;
          }
          const targetPath = targetDir ? `${targetDir}/${sourceName}` : sourceName;
          if (targetPath === sourcePath) {
            return null;
          }
          return { sourcePath, sourceName, targetPath };
        })
        .filter((item): item is { sourcePath: string; sourceName: string; targetPath: string } => Boolean(item));

      if (plans.length === 0) {
        message.warning(t("projects.moveSelectedNoop", "No files need moving"));
        return;
      }

      const targetPathCount = new Map<string, number>();
      for (const plan of plans) {
        targetPathCount.set(plan.targetPath, (targetPathCount.get(plan.targetPath) || 0) + 1);
      }
      const duplicateTargets = Array.from(targetPathCount.entries())
        .filter(([, count]) => count > 1)
        .map(([targetPath]) => targetPath);
      if (duplicateTargets.length > 0) {
        message.warning(
          t(
            "projects.moveSelectedDuplicateTargets",
            "Multiple selected files would map to the same target name. Please rename before moving.",
          ),
        );
        return;
      }

      let successCount = 0;
      const failedItems: Array<{
        path: string;
        reason: "conflict" | "unsafe" | "permission" | "notFound" | "other";
        detail: string;
      }> = [];

      for (const plan of plans) {
        const moved = await performRenameProjectTreePath(
          plan.sourcePath,
          false,
          plan.sourceName,
          plan.targetPath,
          strategy,
          { refresh: false, showMessage: false, showErrorMessage: false },
        );
        if (moved?.ok) {
          successCount += 1;
        } else {
          failedItems.push({
            path: plan.sourcePath,
            reason: moved?.reason || "other",
            detail: moved?.detail || "",
          });
        }
      }

      await handleRefreshProjectFiles();

      if (successCount > 0) {
        message.success(
          t("projects.moveSelectedFilesSuccess", "Moved {{count}} files", {
            count: successCount,
          }),
        );
      }
      if (failedItems.length > 0) {
        message.error(
          t("projects.moveSelectedFilesFailedSummary", "Failed to move {{count}} files", {
            count: failedItems.length,
          }),
        );

        const groupedFailures = failedItems.reduce<Record<string, { paths: string[]; details: string[] }>>((acc, item) => {
          const key = item.reason;
          if (!acc[key]) {
            acc[key] = { paths: [], details: [] };
          }
          acc[key].paths.push(item.path);
          if (item.detail) {
            acc[key].details.push(item.detail);
          }
          return acc;
        }, {});

        const reasonLabel = (reason: string): string => {
          switch (reason) {
            case "conflict":
              return t("projects.moveFailureReasonConflict", "Name conflict");
            case "unsafe":
              return t("projects.moveFailureReasonUnsafe", "Invalid path");
            case "permission":
              return t("projects.moveFailureReasonPermission", "Permission denied");
            case "notFound":
              return t("projects.moveFailureReasonNotFound", "Source not found");
            default:
              return t("projects.moveFailureReasonOther", "Other errors");
          }
        };

        const reasonSuggestion = (reason: string): string => {
          switch (reason) {
            case "conflict":
              return t(
                "projects.moveFailureSuggestionConflict",
                "建议：先重命名冲突文件，或改用覆盖模式后重试。",
              );
            case "unsafe":
              return t(
                "projects.moveFailureSuggestionUnsafe",
                "建议：检查目标路径，避免 ..、绝对路径或非法字符。",
              );
            case "permission":
              return t(
                "projects.moveFailureSuggestionPermission",
                "建议：确认当前工作区写权限，或切换到可写目录。",
              );
            case "notFound":
              return t(
                "projects.moveFailureSuggestionNotFound",
                "建议：刷新文件树后重试，确认源文件未被删除或移动。",
              );
            default:
              return t(
                "projects.moveFailureSuggestionOther",
                "建议：查看错误详情并重试；若持续失败请检查后端日志。",
              );
          }
        };

        const failureReportText = Object.entries(groupedFailures)
          .map(([reason, group]) => {
            const header = `${reasonLabel(reason)} (${group.paths.length})`;
            const suggestion = reasonSuggestion(reason);
            const pathLines = group.paths.map((path) => `- ${path}`).join("\n");
            const sampleDetail = group.details[0]
              ? t("projects.moveFailureSampleError", "示例错误：{{detail}}", {
                detail: group.details[0],
              })
              : "";
            return [header, suggestion, pathLines, sampleDetail].filter(Boolean).join("\n");
          })
          .join("\n\n");

        Modal.warning({
          title: t("projects.moveSelectedFilesFailedDetailTitle", "Some files could not be moved"),
          content: (
            <div style={{ maxHeight: 260, overflow: "auto" }}>
              <div style={{ marginBottom: 8 }}>
                <Button
                  size="small"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(failureReportText);
                      message.success(t("projects.moveFailureReportCopied", "Failure report copied"));
                    } catch {
                      message.error(t("projects.moveFailureReportCopyFailed", "Failed to copy report"));
                    }
                  }}
                >
                  {t("projects.copyFailureReport", "Copy Failure Report")}
                </Button>
              </div>
              {Object.entries(groupedFailures).map(([reason, group]) => (
                <div key={reason} style={{ marginBottom: 8 }}>
                  <Text strong>{`${reasonLabel(reason)} (${group.paths.length})`}</Text>
                  <div>
                    <Text type="secondary">{reasonSuggestion(reason)}</Text>
                  </div>
                  {group.paths.slice(0, 8).map((path) => (
                    <div key={`${reason}:${path}`}>{path}</div>
                  ))}
                  {group.paths.length > 8 ? (
                    <Text type="secondary">
                      {t("projects.moveSelectedFilesFailedDetailMore", "...and {{count}} more", {
                        count: group.paths.length - 8,
                      })}
                    </Text>
                  ) : null}
                  {group.details.length > 0 ? (
                    <div>
                      <Text type="secondary">
                        {t("projects.moveFailureSampleError", "示例错误：{{detail}}", {
                          detail: group.details[0],
                        })}
                      </Text>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ),
          okText: t("common.confirm", "Confirm"),
        });
      }
    };

    Modal.confirm({
      title: t("projects.moveSelectedFilesTitle", "Move selected files"),
      content: (
        <Input
          autoFocus
          defaultValue={nextTargetDirectory}
          placeholder={t("projects.moveSelectedTargetPlaceholder", "Target folder (leave empty for root)")}
          onChange={(event) => {
            nextTargetDirectory = event.target.value;
          }}
        />
      ),
      okText: t("common.move", "Move"),
      cancelText: t("common.cancel", "Cancel"),
      onOk: async () => {
        const normalizedTargetDir = normalizeProjectArtifactPath(nextTargetDirectory || "");
        const conflicts = normalizedPaths.filter((sourcePath) => {
          const sourceName = sourcePath.split("/").filter(Boolean).pop() || "";
          if (!sourceName) {
            return false;
          }
          const targetPath = normalizedTargetDir ? `${normalizedTargetDir}/${sourceName}` : sourceName;
          return targetPath !== sourcePath && Boolean(knownProjectFilesByPath[targetPath]);
        });

        if (conflicts.length === 0) {
          await executeBatchMove(normalizedTargetDir, "fail_if_exists");
          return;
        }

        return new Promise<void>((resolve, reject) => {
          Modal.confirm({
            title: t("projects.moveConflictTitle", "Target already exists"),
            content: t(
              "projects.moveSelectedConflictDescription",
              "{{count}} files conflict at target location. Overwrite all?",
              { count: conflicts.length },
            ),
            okText: t("common.overwrite", "Overwrite"),
            cancelText: t("common.cancel", "Cancel"),
            okButtonProps: { danger: true },
            onOk: async () => {
              await executeBatchMove(normalizedTargetDir, "overwrite");
              resolve();
            },
            onCancel: () => {
              reject(new Error("batch move overwrite cancelled"));
            },
          });
        });
      },
    });
  }, [
    handleRefreshProjectFiles,
    knownProjectFilesByPath,
    normalizeProjectArtifactPath,
    performRenameProjectTreePath,
    t,
  ]);

  const handleProjectAutoKnowledgeSinkChange = useCallback((enabled: boolean) => {
    if (!selectedProject) {
      return;
    }
    setProjects((prev) => prev.map((project) => (
      project.id === selectedProject.id
        ? { ...project, project_auto_knowledge_sink: enabled }
        : project
    )));
  }, [selectedProject]);

  const handleSendSelectedFilesToChat = useCallback(async () => {
    if (!currentAgent || !selectedProject || selectedAttachPaths.length === 0) {
      return;
    }

    setSendingSelectedFiles(true);
    try {
      const targetChatId = await ensureVisibleProjectChat();
      if (!targetChatId) {
        message.error(t("projects.chat.startFailed"));
        return;
      }

      const selectedFiles = selectedAttachPaths.map((path) => {
        const fileInfo = knownProjectFilesByPath[path]
          || effectiveProjectFiles.find((file) => file.path === path);
        return {
          path,
          size: fileInfo?.size || 0,
        };
      });

      const fileContexts = autoAnalyzeOnAttach
        ? await Promise.all(
            selectedFiles.slice(0, 4).map(async (item) => {
              try {
                const excerpt = await fetchProjectFileSnippet(
                  currentAgent.id,
                  selectedProject,
                  item.path,
                );
                return {
                  path: item.path,
                  excerpt,
                };
              } catch {
                return {
                  path: item.path,
                  excerpt: "[文件内容暂不可读取，请先基于文件名和现有上下文分析]",
                };
              }
            }),
          )
        : [];

      await prepareDraftInChat({
        ensureChat: async () => targetChatId,
        request: {
          id: `manual-batch-draft-${Date.now()}`,
          mode: "draft",
          note: autoAnalyzeOnAttach
            ? buildAutoAttachAnalysisPrompt({
                projectName: selectedProject.name,
                workspaceDir:
                  selectedProject.workspace_dir || currentAgent.workspace_dir || "",
                fileNames: selectedFiles.map((item) => item.path),
                selectedRunId,
                fileContexts,
              })
            : buildAttachDraftPrompt({
                projectName: selectedProject.name,
                workspaceDir:
                  selectedProject.workspace_dir || currentAgent.workspace_dir || "",
                selectedRunId,
                selectedFiles,
              }),
        },
        successText: t(
          "projects.chat.attachDraftReady",
          "Prepared selected file context in the chat input box.",
        ),
      });
      setSelectedAttachPaths([]);
    } catch (err) {
      console.error("failed to send selected files to chat", err);
      message.error(
        t("projects.chat.autoAttachFailed"),
      );
    } finally {
      setSendingSelectedFiles(false);
    }
  }, [
    ensureVisibleProjectChat,
    currentAgent,
    fetchProjectFileSnippet,
    effectiveProjectFiles,
    knownProjectFilesByPath,
    prepareDraftInChat,
    selectedAttachPaths,
    selectedProject,
    selectedRunId,
    t,
    autoAnalyzeOnAttach,
  ]);

  const handlePrepareImplementationDraft = useCallback(async () => {
    if (!selectedProject) {
      return;
    }

    void prepareDraftInChat({
      ensureChat: () => handleEnsureDesignChat(false, true),
      request: {
        id: `flow-impl-${Date.now()}`,
        mode: "draft",
        note: buildImplementationAdvancePrompt({
          projectName: selectedProject.name,
          templateName: selectedTemplate?.name || "draft",
          templateId: selectedTemplateId || "draft",
          runCount: runsForSelectedTemplate.length,
          latestRunStatus: latestRunForSelectedTemplate?.status || "",
          gateSummary: verificationGateSummary,
        }),
      },
      successText: t(
        "projects.chat.implDraftReady",
        "Implementation prompt has been prepared in the design chat input.",
      ),
    });
  }, [
    handleEnsureDesignChat,
    latestRunForSelectedTemplate?.status,
    prepareDraftInChat,
    runsForSelectedTemplate.length,
    selectedProject,
    selectedTemplate?.name,
    selectedTemplateId,
    t,
    verificationGateSummary,
  ]);

  const handlePrepareValidationDraft = useCallback(async () => {
    if (!selectedProject) {
      return;
    }
    if (!selectedRunId) {
      message.warning(
        t(
          "projects.pipeline.validationNeedRun",
          "Please start or select one run before preparing a validation prompt.",
        ),
      );
      return;
    }

    void prepareDraftInChat({
      ensureChat: () => handleEnsureRunChat(false),
      request: {
        id: `flow-validate-${Date.now()}`,
        mode: "draft",
        note: buildValidationRoundPrompt({
          projectName: selectedProject.name,
          runId: selectedRunId,
          templateName: selectedTemplate?.name || selectedTemplateId || "draft",
          gateSummary: verificationGateSummary,
        }),
      },
      successText: t(
        "projects.chat.validationDraftReady",
        "Validation prompt has been prepared in the run chat input.",
      ),
    });
  }, [
    handleEnsureRunChat,
    prepareDraftInChat,
    selectedProject,
    selectedRunId,
    selectedTemplate?.name,
    selectedTemplateId,
    t,
    verificationGateSummary,
  ]);

  const handlePreparePromotionDraft = useCallback(async () => {
    if (!selectedProject || !selectedTemplateId || !selectedRunId) {
      return;
    }

    void prepareDraftInChat({
      ensureChat: () => handleEnsureDesignChat(false, true),
      request: {
        id: `flow-promote-${Date.now()}`,
        mode: "draft",
        note: buildPromotionDraftPrompt({
          projectName: selectedProject.name,
          templateName: selectedTemplate?.name || selectedTemplateId,
          templateId: selectedTemplateId,
          runId: selectedRunId,
        }),
      },
      successText: t(
        "projects.chat.promotionDraftReady",
        "Promotion draft prompt has been prepared in the design chat input.",
      ),
    });
  }, [
    handleEnsureDesignChat,
    prepareDraftInChat,
    selectedProject,
    selectedRunId,
    selectedTemplate?.name,
    selectedTemplateId,
    t,
  ]);

  const handleApplyNextAction = useCallback(async (action: ProjectPipelineNextAction) => {
    if (!selectedProject) {
      return;
    }

    if (action.target_step_id) {
      setSelectedStepId(action.target_step_id);
    }

    const prompt = (action.suggested_prompt || "").trim() || [
      `项目：${selectedProject.name}`,
      `动作：${action.title}`,
      action.description,
      action.target_step_id ? `目标步骤：${action.target_step_id}` : "",
      "请直接给出最小闭环动作，并说明是否需要重跑。",
    ].filter(Boolean).join("\n");

    void prepareDraftInChat({
      ensureChat: () => (
        selectedRunId
          ? handleEnsureRunChat(false)
          : handleEnsureDesignChat(false, true)
      ),
      request: {
        id: `next-action-${action.id}-${Date.now()}`,
        mode: "draft",
        note: prompt,
      },
      successText: t(
        "projects.pipeline.nextActionReady",
      ),
    });
  }, [
    handleEnsureDesignChat,
    handleEnsureRunChat,
    prepareDraftInChat,
    selectedProject,
    selectedRunId,
    t,
  ]);

  const handleExecuteNextAction = useCallback(async (action: ProjectPipelineNextAction) => {
    if (!currentAgent || !selectedProject || !selectedRunId || !action.target_step_id) {
      return;
    }
    const targetStepId = action.target_step_id;

    try {
      const resolved = await resolveProjectRequestCandidate({
        projectRequestIds: buildProjectRequestCandidates(selectedProject, {
          preferredProjectRequestId: resolvedProjectRequestId,
          routeProjectId,
        }),
        loader: async (projectRequestId) => agentsApi.retryProjectPipelineRun(
          currentAgent.id,
          projectRequestId,
          selectedRunId,
          {
            step_id: targetStepId,
            note: action.title,
          },
        ),
      });
      const continuedRun = resolved.value;
      const requestProjectId = resolved.projectRequestId;
      setResolvedProjectRequestId(requestProjectId);

      await loadPipelineContext(currentAgent.id, selectedProject);
      setSelectedRunId(continuedRun.id);
      setRunDetail(continuedRun);
      setSelectedStepId(targetStepId);
      handleSwitchToRunFocusChat({
        runId: continuedRun.id,
        projectRequestId: requestProjectId || selectedProject.id,
      });
      message.success(
        t(
          "projects.pipeline.executeActionSuccess",
          { stepId: targetStepId },
        ),
      );

      if (!requestProjectId) {
        return;
      }
    } catch (err) {
      console.error("failed to execute next action", err);
      message.error(
        t(
          "projects.pipeline.executeActionFailed",
        ),
      );
    }
  }, [
    currentAgent,
    handleSwitchToRunFocusChat,
    loadPipelineContext,
    resolvedProjectRequestId,
    routeProjectId,
    selectedProject,
    selectedRunId,
    t,
  ]);

  const handleChatAutoAttachHandled = useCallback((payload: { id: string }) => {
    window.requestAnimationFrame(() => {
      setAutoAttachRequest((prev) => (prev?.id === payload.id ? null : prev));
    });
  }, []);

  const handleOpenManualRecoverDialogFromChat = useCallback(() => {
    void handleOpenManualRecoverDialog();
  }, [handleOpenManualRecoverDialog]);

  const handleAssistantTurnCompletedFromChat = useCallback(() => {
    void handleAssistantTurnCompleted();
  }, [handleAssistantTurnCompleted]);

  const handleKnowledgeRequestedQueryHandled = useCallback(() => {
    setPendingKnowledgeQuery("");
  }, []);

  const handleKnowledgeOpenOutputs = useCallback(() => {
    setKnowledgeDockTab("outputs");
  }, []);

  const handleKnowledgeOpenSettings = useCallback(() => {
    setKnowledgeDockTab("settings");
  }, []);

  useEffect(() => {
    if (knowledgeDockTab === "ner") {
      setKnowledgeDockTab("processing");
    }
  }, [knowledgeDockTab]);

  const handleKnowledgeOpenProcessing = useCallback((
    mode?: ProjectKnowledgeProcessingMode,
    stage?: "tokenize" | "ner" | "syntax" | "cor",
    sourceId?: string,
    scope?: "global" | "source",
  ) => {
    setKnowledgeDockTab("processing");
    if (sourceId) {
      projectKnowledgeState.setSelectedSourceId(sourceId);
    }
    setKnowledgeProcessingFocusScope(scope || (sourceId ? "source" : "global"));
    setKnowledgeProcessingFocusMode(mode || "nlp");
    setKnowledgeProcessingFocusStage(stage || "");
    setKnowledgeProcessingFocusToken((prev) => prev + 1);
  }, [projectKnowledgeState]);

  const handleKnowledgeRunSuggestedQuery = useCallback((query: string) => {
    setPendingKnowledgeQuery(query);
    setKnowledgeDockTab("explore");
  }, []);

  const handleRuntimeSignalTooltipOpenChange = useCallback((open: boolean) => {
    setRuntimeSignalTooltipOpen(open);
    if (open) {
      void fetchRuntimeSignalDetails();
    }
  }, [fetchRuntimeSignalDetails]);

  const projectChatPanelNode = useMemo(() => (
    <ProjectChatPanel
      projectFileCount={projectFileCount}
      chatMode={projectChatMode}
      selectedRunId={selectedRunId}
      chatStarting={chatStarting}
      activeWorkspaceChatId={activeWorkspaceChatId}
      activeDesignChatId={activeDesignChatId}
      activeRunChatId={activeRunChatId}
      autoAttachRequest={autoAttachRequest}
      onAutoAttachHandled={handleChatAutoAttachHandled}
      onStartWorkspaceChat={handleStartWorkspaceChat}
      onStartDesignChat={handleStartDesignChat}
      onStartRunChat={handleStartRunChat}
      onSelectWorkspaceHistoryChat={selectWorkspaceChatSession}
      onSelectDesignHistoryChat={selectDesignChatSession}
      onSelectRunHistoryChat={selectRunChatSession}
      onOpenManualRecoverDialog={handleOpenManualRecoverDialogFromChat}
      onAssistantTurnCompleted={handleAssistantTurnCompletedFromChat}
        projectAgentContext={projectAgentContext}
      />
    ), [
      activeDesignChatId,
      activeRunChatId,
      activeWorkspaceChatId,
      autoAttachRequest,
      chatStarting,
      handleAssistantTurnCompletedFromChat,
      handleChatAutoAttachHandled,
      handleOpenManualRecoverDialogFromChat,
      handleStartDesignChat,
      handleStartRunChat,
      handleStartWorkspaceChat,
      projectAgentContext,
      projectChatMode,
      projectFileCount,
      selectWorkspaceChatSession,
      selectDesignChatSession,
      selectRunChatSession,
      selectedRunId,
    ]);

  const knowledgeDockTabItems = useMemo(() => {
    if (!selectedProject) {
      return [];
    }

    return [
      {
        key: "explore",
        label: t("projects.knowledgeDock.tabExplore", "Explore"),
        children: (
          <ProjectKnowledgePanel
            projectId={selectedProject.id}
            projectName={selectedProject.name}
            knowledgeState={projectKnowledgeState}
            requestedQuery={pendingKnowledgeQuery}
            onRequestedQueryHandled={handleKnowledgeRequestedQueryHandled}
            onOpenOutputs={handleKnowledgeOpenOutputs}
            onOpenProcessing={handleKnowledgeOpenProcessing}
          />
        ),
      },
      {
        key: "sources",
        label: t("projects.knowledgeDock.tabSources", "Sources"),
        children: (
          <ProjectKnowledgeSourcesPanel
            knowledgeState={projectKnowledgeState}
            projectFiles={effectiveProjectFiles}
            onOpenProcessingForSource={(sourceId) => {
              handleKnowledgeOpenProcessing("nlp", "tokenize", sourceId, "source");
            }}
          />
        ),
      },
      {
        key: "processing",
        label: t("projects.knowledgeDock.tabProcessing", "Processing"),
        children: (
          <ProjectKnowledgeProcessingPanel
            knowledgeState={projectKnowledgeState}
            projectFiles={effectiveProjectFiles}
            onOpenSettings={handleKnowledgeOpenSettings}
            onSelectArtifactPath={handleLocateArtifactFile}
            focusedMode={knowledgeProcessingFocusMode || undefined}
            focusedStage={knowledgeProcessingFocusStage || undefined}
            focusedScope={knowledgeProcessingFocusScope || undefined}
            focusToken={knowledgeProcessingFocusToken}
          />
        ),
      },
      {
        key: "outputs",
        label: t("projects.knowledgeDock.tabOutputs", "Outputs"),
        children: (
          <ProjectKnowledgeOutputsPanel
            knowledgeState={projectKnowledgeState}
            onRunSuggestedQuery={handleKnowledgeRunSuggestedQuery}
            onSelectArtifactPath={handleLocateArtifactFile}
          />
        ),
      },
      {
        key: "health",
        label: t("projects.knowledgeDock.tabHealth", "Health"),
        children: (
          <ProjectKnowledgeSignalsPanel
            knowledgeState={projectKnowledgeState}
            knowledgeHeaderSignals={knowledgeHeaderSignals}
            realtimeConnectionStatus={realtimeConnectionState.status}
            realtimeConnectionText={realtimeConnectionText}
            realtimeReconnectAttempt={realtimeConnectionState.reconnectAttempt}
            showRealtimeConnectionNotice={showRealtimeHealthNotice}
            runtimeSignalValue={runtimeSignalValue}
            runtimeSignalTooltipContent={runtimeSignalTooltipContent}
            runtimeSignalTooltipOpen={runtimeSignalTooltipOpen}
            onRuntimeSignalTooltipOpenChange={handleRuntimeSignalTooltipOpenChange}
            onRunSuggestedQuery={handleKnowledgeRunSuggestedQuery}
          />
        ),
      },
      {
        key: "settings",
        label: t("projects.knowledgeDock.tabSettings", "Settings"),
        children: (
          <ProjectKnowledgeSettingsPanel
            agentId={currentAgent?.id}
            projectId={selectedProject.id}
            projectAutoKnowledgeSink={selectedProject.project_auto_knowledge_sink !== false}
            syncState={projectKnowledgeState.syncState}
            onProjectAutoKnowledgeSinkChange={handleProjectAutoKnowledgeSinkChange}
          />
        ),
      },
    ];
  }, [
    currentAgent?.id,
    effectiveProjectFiles,
    handleLocateArtifactFile,
    handleKnowledgeOpenOutputs,
    handleKnowledgeOpenProcessing,
    handleKnowledgeOpenSettings,
    handleKnowledgeRequestedQueryHandled,
    handleKnowledgeRunSuggestedQuery,
    handleProjectAutoKnowledgeSinkChange,
    handleRuntimeSignalTooltipOpenChange,
    knowledgeHeaderSignals,
    pendingKnowledgeQuery,
    knowledgeProcessingFocusMode,
    knowledgeProcessingFocusStage,
    knowledgeProcessingFocusScope,
    knowledgeProcessingFocusToken,
    projectKnowledgeState,
    runtimeSignalTooltipContent,
    runtimeSignalTooltipOpen,
    runtimeSignalValue,
    realtimeConnectionState.reconnectAttempt,
    realtimeConnectionState.status,
    realtimeConnectionText,
    selectedProject,
    showRealtimeHealthNotice,
    t,
  ]);

  return (
    <div className={styles.agentsPage}>
      <div className={styles.header}>
        <div>
          <div className={styles.pathTitleRow}>
            <div className={styles.pathBreadcrumb}>
              <span className={styles.pathParent}>{t("projects.path.workspace")}</span>
              <span className={styles.pathSeparator}>/</span>
              <Button
                type="link"
                size="small"
                className={styles.pathParentLink}
                onClick={() => navigate("/projects")}
              >
                {t("projects.path.project")}
              </Button>
              <span className={styles.pathSeparator}>/</span>
              <span className={styles.pathCurrent}>
                {selectedProject?.name || t("projects.path.projectSpace", "Project Space")}
              </span>
            </div>
          </div>
          <Text type="secondary" className={styles.description}>
            {t(
              "projects.detailDescription",
              "围绕目标与资料协作推进项目，自动化按需启用。",
            )}
            <span className={styles.descriptionDivider}> | </span>
            {t("projects.workspacePath")}: {" "}
            {selectedProject?.workspace_dir ||
              currentAgent?.workspace_dir ||
              t("projects.noAgent")}
          </Text>
        </div>
        <div className={styles.headerActions}>
          {selectedProject ? (
            <>
              <Button size="small" onClick={openProjectUploadModal}>
                {t("projects.upload.button")}
              </Button>
              <Popconfirm
                title={t(
                  "projects.deleteConfirmTitleWithName",
                  "Delete project {{name}}?",
                  { name: selectedProject.name || selectedProject.id },
                )}
                description={t(
                  "projects.deleteConfirmDescription",
                  "This action is irreversible and will permanently delete {{name}} and all project files.",
                  { name: selectedProject.name || selectedProject.id },
                )}
                okText={t("common.delete", "Delete")}
                cancelText={t("common.cancel", "Cancel")}
                okButtonProps={{ danger: true, loading: deletingProject }}
                onConfirm={() => void handleDeleteProject()}
              >
                <Button size="small" danger loading={deletingProject}>
                  {t("common.delete", "Delete")}
                </Button>
              </Popconfirm>
            </>
          ) : null}
          <Button size="small" onClick={() => void loadAgents()} loading={loading}>
            {t("common.refresh", "Refresh")}
          </Button>
        </div>
      </div>

      {error && <Alert type="error" showIcon message={error} />}

      {loading && !currentAgent ? (
        <div className={styles.centerState}>
          <Spin />
        </div>
      ) : !currentAgent ? (
        <Empty description={t("projects.noAgent")} />
      ) : projectsLoading ? (
        <div className={styles.centerState}>
          <Spin />
        </div>
      ) : projects.length === 0 ? (
        <Empty description={t("projects.noProjects")} />
      ) : !selectedProject ? (
        <Card>
          <Empty
            description={t("projects.notFound")}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <Button onClick={() => navigate("/projects")}>
              {t("projects.backToList")}
            </Button>
          </Empty>
        </Card>
      ) : (
        <>
          <div className={styles.content}>
            <Splitter
              layout="vertical"
              className={styles.contentSplitter}
              onResize={handleKnowledgeDockResize}
              onResizeEnd={handleKnowledgeDockResizeEnd}
            >
              <Splitter.Panel min={420}>
                <Splitter
                  className={styles.workspaceSplitter}
                  onResize={handleWorkspaceResize}
                  onResizeEnd={handleWorkspaceResizeEnd}
                >
                  <Splitter.Panel
                    size={leftPaneSize}
                    min={LEFT_PANE_MIN_SIZE}
                    defaultSize={LEFT_PANE_EXPANDED_SIZE}
                  >
                    <div className={styles.splitterPanel}>
                        <div className={styles.columnLeft}>
                        <div className={styles.columnStack}>
                          <ProjectOverviewCard
                            selectedProject={selectedProject}
                            projectFileCount={projectFileCount}
                            pipelineTemplateCount={pipelineTemplates.length}
                            pipelineRunCount={pipelineRuns.length}
                            projectWorkspaceSummary={projectWorkspaceSummary}
                            projectFiles={effectiveProjectFiles}
                            projectFileSummary={projectFileSummary}
                            projectVisibleSummary={visibleProjectSummary}
                            projectTreeNodes={projectTreeNodes}
                            projectTreeLoading={projectTreeLoading}
                            priorityFilePaths={priorityFilePaths}
                            selectedFilePath={selectedFilePath}
                            expandedKeys={treeExpandedKeys}
                            staleDirectoryPaths={staleProjectTreeDirectoryPaths}
                            selectedAttachPaths={selectedAttachPaths}
                            treeFilterQuery={projectFileSearchQuery}
                            onTreeFilterQueryChange={setProjectFileSearchQuery}
                            activeStage={activeStage}
                            selectedMetricFilter={selectedMetricFilter}
                            onMetricFilterChange={setSelectedMetricFilter}
                            treeDisplayMode={treeDisplayMode}
                            onTreeDisplayModeChange={setTreeDisplayMode}
                            onExpandedKeysChange={setTreeExpandedKeys}
                            onConsumeStaleDirectoryPaths={(paths) => {
                              if (paths.length === 0) {
                                return;
                              }
                              setStaleProjectTreeDirectoryPaths((prev) =>
                                prev.filter((item) => !paths.includes(item)));
                            }}
                            onRefreshProjectFiles={handleRefreshProjectFiles}
                            latestUpdatedFilePath={latestUpdatedFilePath}
                            onRefreshProjectTreeDirectory={(path) => {
                              if (!currentAgent || !selectedProject) {
                                return Promise.resolve([]);
                              }
                              return loadProjectTreeDirectory(currentAgent.id, selectedProject, path);
                            }}
                            projectFilesRefreshing={filesLoading || projectTreeLoading}
                            treeOnly
                            onUploadFiles={openProjectUploadModal}
                            onLoadProjectTreeChildren={(path) => {
                              if (!currentAgent || !selectedProject) {
                                return Promise.resolve([]);
                              }
                              return loadProjectTreeDirectory(currentAgent.id, selectedProject, path);
                            }}
                            onSelectFileFromTree={(path) => {
                              void handleSelectArtifactFile(path);
                            }}
                            onSelectLatestUpdatedFile={(path) => {
                              void handleSelectArtifactFile(path);
                            }}
                            onAttachArtifactToChat={(path) => {
                              void handleAttachArtifactToChat(path);
                            }}
                            onRequestMoveTreePath={handleRequestMoveProjectTreePath}
                            onRequestCreateChildDirectory={handleRequestCreateProjectTreeDirectory}
                            onRequestRenameTreePath={handleRequestRenameProjectTreePath}
                            onRequestDeleteTreePath={handleRequestDeleteProjectTreePath}
                            onRequestDeleteSelectedFilePaths={handleRequestDeleteSelectedProjectFiles}
                            onRequestMoveSelectedFilePaths={handleRequestMoveSelectedProjectFiles}
                            onRequestMoveSelectedFilePaths={handleRequestMoveSelectedProjectFiles}
                            onRequestSetSelectedFilePaths={(paths) => {
                              const normalizedPaths = Array.from(new Set(
                                (paths || [])
                                  .map((item) => normalizeProjectArtifactPath(item))
                                  .filter((item) => Boolean(item)),
                              ));
                              setSelectedAttachPaths(normalizedPaths);
                            }}
                            deletingTreePaths={deletingProjectPaths}
                          />
                        </div>
                      </div>
                    </div>
                  </Splitter.Panel>

                  <Splitter.Panel
                    size={workbenchPaneSize}
                    min={WORKBENCH_PANE_MIN_SIZE}
                    defaultSize={WORKBENCH_PANE_DEFAULT_SIZE}
                  >
                    <div className={styles.splitterPanel}>
                      <div className={styles.columnRight}>
                        <div className={styles.rightWorkbenchPrimary}>
                          <ProjectWorkbenchPanel
                            agentId={currentAgent?.id}
                            projectId={selectedProject?.id}
                            syncNotice={workbenchSyncNotice}
                            filesLoading={filesLoading}
                            contentLoading={contentLoading}
                            artifactRecords={artifactRecords}
                            selectedArtifactRecord={selectedArtifactRecord}
                            selectedFilePath={selectedFilePath}
                            knownProjectFilesByPath={knownProjectFilesByPath}
                            projectFiles={effectiveProjectFiles}
                            fileContent={fileContent}
                            charStatsContent={charStatsContent}
                            nerStructuredContent={nerStructuredContent}
                            selectedAttachPaths={selectedAttachPaths}
                            autoAnalyzeOnAttach={autoAnalyzeOnAttach}
                            sendingSelectedFiles={sendingSelectedFiles}
                            knowledgeState={projectKnowledgeState}
                            onToggleAutoAnalyze={setAutoAnalyzeOnAttach}
                            onSendSelectedFilesToChat={() => {
                              void handleSendSelectedFilesToChat();
                            }}
                            onDismissSyncNotice={() => {
                              setWorkbenchSyncNotice(null);
                            }}
                            formatBytes={formatBytes}
                          />
                        </div>
                      </div>
                    </div>
                  </Splitter.Panel>

                  <Splitter.Panel
                    size={chatPaneSize}
                    min={CHAT_PANE_MIN_SIZE}
                    defaultSize={CHAT_PANE_DEFAULT_SIZE}
                  >
                    <div className={styles.splitterPanel}>
                      {projectChatPanelNode}
                    </div>
                  </Splitter.Panel>
                </Splitter>
              </Splitter.Panel>

              <Splitter.Panel
                size={knowledgeModuleCollapsed ? KNOWLEDGE_DOCK_COLLAPSED_SIZE : knowledgeDockSize}
                min={knowledgeModuleCollapsed ? KNOWLEDGE_DOCK_COLLAPSED_SIZE : KNOWLEDGE_DOCK_MIN_SIZE}
                max="52%"
                defaultSize={KNOWLEDGE_DOCK_DEFAULT_SIZE}
              >
                <div className={`${styles.splitterPanel} ${styles.knowledgeDockSplitterPanel}`}>
                  <div className={styles.knowledgeModuleShell}>
                    <Collapse
                      destroyOnHidden
                      className={styles.knowledgeModuleCollapse}
                      activeKey={knowledgeModuleCollapsed ? [] : [KNOWLEDGE_DOCK_COLLAPSE_KEY]}
                      onChange={handleKnowledgeDockCollapseChange}
                      items={[
                        {
                          key: KNOWLEDGE_DOCK_COLLAPSE_KEY,
                          label: (
                            <span>{t("projects.knowledgePanelTitle")}</span>
                          ),
                          children: (
                            <div className={styles.knowledgeDockBody}>
                              <Tabs
                                className={styles.knowledgeDockTabs}
                                activeKey={effectiveKnowledgeDockTab}
                                tabPosition="left"
                                destroyOnHidden
                                onChange={(key) => setKnowledgeDockTab(key as KnowledgeDockTabKey)}
                                items={knowledgeDockTabItems}
                              />
                            </div>
                          ),
                        },
                      ]}
                    />
                  </div>
                </div>
              </Splitter.Panel>
            </Splitter>
          </div>

          <Drawer
            title={t("projects.automationDrawer.title")}
            placement="right"
            width="min(80vw, 1280px)"
            open={automationDrawerOpen}
            onClose={() => setAutomationDrawerOpen(false)}
            destroyOnHidden
          >
            {automationDrawerOpen ? (
              <div className={styles.automationDrawerBody}>
              <ProjectAutomationPanel
                selectedRunStatus={selectedRunSummary?.status}
                selectedTemplateId={selectedTemplateId}
                selectedRunId={selectedRunId}
                selectedProjectExists={Boolean(selectedProject)}
                pipelineTemplates={pipelineTemplates}
                pipelineLoading={pipelineLoading}
                pipelineRuns={pipelineRuns}
                runsForSelectedTemplate={runsForSelectedTemplate}
                activeRunTemplate={activeRunTemplate}
                runDetail={runDetail}
                runProgress={runProgress}
                stepContractById={stepContractById}
                selectedStepId={selectedStepId}
                highlightedStepIds={highlightedStepIds}
                createRunLoading={createRunLoading}
                importLoading={importLoading}
                importModalOpen={importModalOpen}
                selectedPlatformTemplateId={selectedPlatformTemplateId}
                platformTemplates={platformTemplates}
                verificationGateSummary={verificationGateSummary}
                canPromoteToTemplateDraft={canPromoteToTemplateDraft}
                onUploadFiles={openRunBatchUploadModal}
                onOpenImportModal={() => {
                  void handleOpenImportModal();
                }}
                onCreateRun={() => {
                  void handleCreateRun();
                }}
                onStartAutomation={handleStartDesignChat}
                onPrepareImplementationDraft={() => {
                  void handlePrepareImplementationDraft();
                }}
                onPrepareValidationDraft={() => {
                  void handlePrepareValidationDraft();
                }}
                onPreparePromotionDraft={() => {
                  void handlePreparePromotionDraft();
                }}
                onFocusNextActionStep={(stepId) => {
                  setSelectedStepId(stepId);
                }}
                onApplyNextAction={(action) => {
                  void handleApplyNextAction(action);
                }}
                onExecuteNextAction={(action) => {
                  void handleExecuteNextAction(action);
                }}
                onSelectTemplateId={setSelectedTemplateId}
                onSelectRunId={setSelectedRunId}
                onSelectStep={handleSelectStep}
                onCloseImportModal={() => setImportModalOpen(false)}
                onImportPlatformTemplate={() => {
                  void handleImportPlatformTemplate();
                }}
                onSelectPlatformTemplateId={setSelectedPlatformTemplateId}
                formatRunTimeLabel={formatRunTimeLabel}
                statusTagColor={statusTagColor}
              />

              <Tabs
                className={styles.automationDrawerTabs}
                destroyOnHidden
                items={[
                  {
                    key: "metrics",
                    label: t("projects.metrics"),
                    children: (
                      <ProjectMetricsPanel
                        currentAgentId={currentAgent?.id}
                        selectedProjectRequestId={resolvedProjectRequestId || selectedProject?.id || ""}
                        runDetail={runDetail}
                        selectedRunId={selectedRunId}
                        pipelineRuns={pipelineRuns}
                        runProgress={runProgress}
                        statusTagColor={statusTagColor}
                        formatRunTimeLabel={formatRunTimeLabel}
                        onSelectArtifactPath={(path) => {
                          handleLocateArtifactFile(path);
                          setAutomationDrawerOpen(false);
                        }}
                      />
                    ),
                  },
                  {
                    key: "timeline",
                      label: t("projects.pipeline.timeline"),
                    children: (
                      <ProjectEvidencePanel
                        runDetail={runDetail}
                        showTimeline={true}
                        showEvidence={false}
                      />
                    ),
                  },
                  {
                    key: "evidence",
                    label: t("projects.evidence"),
                    children: (
                      <ProjectEvidencePanel
                        runDetail={runDetail}
                        showTimeline={false}
                        showEvidence={true}
                      />
                    ),
                  },
                ]}
              />
              </div>
            ) : null}
          </Drawer>

          <ProjectUploadModal
            open={uploadModalOpen}
            uploadingFiles={uploadingFiles}
            pendingUploads={pendingUploads}
            uploadTargetDir={uploadTargetDir}
            uploadMode={uploadMode}
            uploadHint={uploadModalHint}
            onChangeUploadTargetDir={setUploadTargetDir}
            onChangePendingUploads={setPendingUploads}
            onChangeUploadMode={setUploadMode}
            onUpload={() => {
              void handleUploadFiles();
            }}
            onCancel={() => setUploadModalOpen(false)}
          />

          <Modal
            title={t("projects.chat.manualRecoverTitle", "手动恢复对话关联")}
            open={manualRecoverOpen}
            onCancel={() => setManualRecoverOpen(false)}
            onOk={() => {
              void handleConfirmManualRecover();
            }}
            okButtonProps={{
              disabled: !manualRecoverChatId,
              loading: manualRecoverLoading,
            }}
            confirmLoading={manualRecoverLoading}
            okText={t("projects.chat.manualRecoverConfirm", "关联并切换")}
            cancelText={t("common.cancel", "Cancel")}
          >
            <Text type="secondary">
              {t(
                "projects.chat.manualRecoverHint",
                "若自动恢复失败，可从历史会话中选择一个并绑定到当前项目。",
              )}
            </Text>
            <div style={{ marginTop: 12 }}>
              <Select
                style={{ width: "100%" }}
                showSearch
                loading={manualRecoverLoading}
                placeholder={t("projects.chat.manualRecoverPlaceholder", "选择历史对话")}
                optionFilterProp="label"
                value={manualRecoverChatId || undefined}
                onChange={(value) => setManualRecoverChatId(value)}
                options={manualRecoverCandidates.map((chat) => ({
                  value: chat.id,
                  label:
                    `${chat.name || t("chat.newChat", "New Chat")} · ${chat.id.slice(0, 8)} · ` +
                    `${formatRunTimeLabel(chat.updated_at || chat.created_at || "")}`,
                }))}
              />
            </div>
            <div
              style={{
                marginTop: 12,
                maxHeight: 220,
                overflow: "auto",
                border: "1px solid var(--ant-color-border-secondary)",
                borderRadius: 8,
                padding: 8,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {manualRecoverCandidates.slice(0, 40).map((chat) => (
                <Button
                  key={chat.id}
                  size="small"
                  type={manualRecoverChatId === chat.id ? "primary" : "text"}
                  onClick={() => setManualRecoverChatId(chat.id)}
                  style={{ textAlign: "left", justifyContent: "flex-start" }}
                >
                  {(chat.name || t("chat.newChat", "New Chat"))}
                  {" · "}
                  {chat.id.slice(0, 8)}
                </Button>
              ))}
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}
