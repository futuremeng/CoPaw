import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Drawer,
  Empty,
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
import ProjectAutomationPanel from "./ProjectAutomationPanel";
import ProjectChatPanel, {
  type ProjectChatAutoAttachRequest,
  type ProjectChatMode,
} from "./ProjectChatPanel";
import ProjectKnowledgePanel from "./ProjectKnowledgePanel";
import ProjectKnowledgeOutputsPanel from "./ProjectKnowledgeOutputsPanel";
import ProjectKnowledgeProcessingPanel from "./ProjectKnowledgeProcessingPanel";
import ProjectKnowledgeSignalsPanel from "./ProjectKnowledgeSignalsPanel";
import ProjectKnowledgeSourcesPanel from "./ProjectKnowledgeSourcesPanel";
import ProjectKnowledgeSettingsPanel from "./ProjectKnowledgeSettingsPanel";
import {
  getProjectKnowledgeSemanticDescription,
  getProjectKnowledgeSemanticReasonLabel,
} from "./projectKnowledgeSyncUi";
import ProjectOverviewCard from "./ProjectOverviewCard";
import ProjectUploadModal from "./ProjectUploadModal";
import ProjectWorkbenchPanel from "./ProjectWorkbenchPanel";
import ProjectMetricsPanel from "./ProjectMetricsPanel";
import ProjectEvidencePanel from "./ProjectEvidencePanel";
import useArtifactSelectionGuards from "./useArtifactSelectionGuards";
import useProjectChatEnsureController from "./useProjectChatEnsureController";
import useProjectChatFocusEffects from "./useProjectChatFocusEffects";
import usePreferredProjectWorkspaceChat from "./usePreferredProjectWorkspaceChat";
import useProjectDesignChatController from "./useProjectDesignChatController";
import useLeaveConfirmGuard from "./useLeaveConfirmGuard";
import useOpenUploadQuery from "./useOpenUploadQuery";
import useProjectRealtimeController, {
  type ProjectRealtimeConnectionStatus,
} from "./useProjectRealtimeController";
import useProjectUploadController from "./useProjectUploadController";
import {
  type ProjectKnowledgeHeaderSignals,
  useProjectKnowledgeState,
} from "./useProjectKnowledgeState";
import {
  buildAttachDraftPrompt,
  buildAutoAttachAnalysisPrompt,
  buildImplementationAdvancePrompt,
  buildPromotionDraftPrompt,
  buildValidationRoundPrompt,
} from "./projectChatPrompts";
import {
  isIgnoredProjectFile,
  isPreviewablePath,
  selectSeedSourceFiles,
} from "./projectFileSelectionUtils";
import {
  buildProjectIdCandidates,
  matchesRouteProject,
} from "./projectIdUtils";
import {
  buildProjectLayoutStorageKey,
  type KnowledgeDockTabKey,
  parseProjectLayoutPrefs,
  type ProjectDetailLayoutPrefs,
  type ProjectStageKey,
  type TreeDisplayMode,
} from "./projectLayoutPrefs";
import type { ProjectFileFilterKey } from "./filtering";
import { computeProjectFileInventorySummary } from "./metrics";
import { isBuiltInProjectFile } from "./builtInFiles";
import type {
  AgentProjectSummary,
  AgentProjectFileInfo,
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
  ProjectKnowledgeSyncState,
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
const PROJECT_FILES_DEFER_MS = 420;
const INITIAL_PROJECT_FILES_IDLE_TIMEOUT_MS = 1200;
const ASSISTANT_TURN_REALTIME_FALLBACK_MS = 900;
const PROJECT_TREE_PREFETCH_DIR_LIMIT = 3;
const PROJECT_TREE_PREVIEW_DIR_PRIORITY = [
  "original",
  "intermediate",
  "output",
  "pipelines",
  ".agent",
  ".skills",
];

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

type RuntimeTaskDetail = MemifyJobStatus | QualityLoopJobStatus | ProjectKnowledgeSyncState | null;

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

function getRuntimeTaskKey(task: KnowledgeTaskProgress): string {
  return String(task.job_id || task.task_id || `${task.task_type || "task"}:${task.updated_at || ""}`);
}

function getRuntimeTaskLabel(taskType: string | undefined, translate: (key: string, fallback: string) => string): string {
  switch (String(taskType || "")) {
    case "project_sync":
      return translate("projects.knowledge.runtimeTaskProjectSync", "Project Sync");
    case "memify":
      return translate("projects.knowledge.runtimeTaskMemify", "Graph Build");
    case "quality_loop":
      return translate("projects.knowledge.runtimeTaskQualityLoop", "Quality Loop");
    case "history_backfill":
      return translate("projects.knowledge.runtimeTaskHistoryBackfill", "History Backfill");
    default:
      return translate("projects.knowledge.runtimeTaskGeneric", "Knowledge Task");
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

function reconcileProjectFilesByPath(
  current: Record<string, AgentProjectFileInfo>,
  files: AgentProjectFileInfo[],
  requestedPaths: string[],
): Record<string, AgentProjectFileInfo> {
  const next = { ...current };
  for (const path of requestedPaths) {
    delete next[path];
  }
  for (const file of files) {
    next[file.path] = file;
  }
  return next;
}

function reconcileProjectFilesList(
  current: AgentProjectFileInfo[],
  files: AgentProjectFileInfo[],
  requestedPaths: string[],
): AgentProjectFileInfo[] {
  const requestedPathSet = new Set(requestedPaths);
  const next = new Map<string, AgentProjectFileInfo>();
  for (const file of current) {
    if (!requestedPathSet.has(file.path)) {
      next.set(file.path, file);
    }
  }
  for (const file of files) {
    next.set(file.path, file);
  }
  return Array.from(next.values()).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
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

function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
}

function buildProjectWorkspaceChatPath(projectId: string, chatId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/chat/${encodeURIComponent(chatId)}`;
}

function compareProjectTreePreviewPriority(
  left: AgentProjectFileTreeNode,
  right: AgentProjectFileTreeNode,
): number {
  const leftIndex = PROJECT_TREE_PREVIEW_DIR_PRIORITY.indexOf(
    normalizeProjectPath(left.path),
  );
  const rightIndex = PROJECT_TREE_PREVIEW_DIR_PRIORITY.indexOf(
    normalizeProjectPath(right.path),
  );
  const normalizedLeft = leftIndex >= 0 ? leftIndex : PROJECT_TREE_PREVIEW_DIR_PRIORITY.length;
  const normalizedRight = rightIndex >= 0 ? rightIndex : PROJECT_TREE_PREVIEW_DIR_PRIORITY.length;
  if (normalizedLeft !== normalizedRight) {
    return normalizedLeft - normalizedRight;
  }
  return left.path.localeCompare(right.path);
}

function isProjectPipelineTemplatePath(path: string): boolean {
  const normalized = normalizeProjectPath(path);
  return normalized.startsWith("pipelines/templates/");
}

function isProjectPipelineRunPath(path: string): boolean {
  const normalized = normalizeProjectPath(path);
  return normalized.startsWith("pipelines/runs/");
}

function getProjectPipelineRunIdFromPath(path: string): string {
  const normalized = normalizeProjectPath(path);
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length < 3 || segments[0] !== "pipelines" || segments[1] !== "runs") {
    return "";
  }
  return segments[2] || "";
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

function getRealtimeBadgeStatus(status: ProjectRealtimeConnectionStatus) {
  if (status === "connected") {
    return "success" as const;
  }
  if (status === "degraded") {
    return "warning" as const;
  }
  if (status === "paused" || status === "idle") {
    return "default" as const;
  }
  return "processing" as const;
}

function shouldShowRealtimeStatus(status: ProjectRealtimeConnectionStatus): boolean {
  return status === "reconnecting" || status === "degraded";
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
  const [error, setError] = useState("");

  const [resolvedProjectRequestId, setResolvedProjectRequestId] = useState("");
  const [projectFiles, setProjectFiles] = useState<AgentProjectFileInfo[]>([]);
  const [projectTreeNodes, setProjectTreeNodes] = useState<AgentProjectFileTreeNode[]>([]);
  const [projectFileSummary, setProjectFileSummary] = useState<AgentProjectFileSummary | null>(null);
  const [knownProjectFilesByPath, setKnownProjectFilesByPath] =
    useState<Record<string, AgentProjectFileInfo>>({});
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [workbenchSyncNotice, setWorkbenchSyncNotice] = useState<{
    changedPaths: string[];
    updatedAt: number;
  } | null>(null);
  const [fileContent, setFileContent] = useState("");
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
  const [selectedStepId, setSelectedStepId] = useState("");
  const [deletingProject, setDeletingProject] = useState(false);
  const [automationDrawerOpen, setAutomationDrawerOpen] = useState(false);
  const [autoAttachRequest, setAutoAttachRequest] = useState<ProjectChatAutoAttachRequest | null>(null);
  const [selectedAttachPaths, setSelectedAttachPaths] = useState<string[]>([]);
  const [sendingSelectedFiles, setSendingSelectedFiles] = useState(false);
  const [autoAnalyzeOnAttach, setAutoAnalyzeOnAttach] = useState(true);
  const [activeStage, setActiveStage] = useState<ProjectStageKey>("source");
  const [knowledgeModuleCollapsed, setKnowledgeModuleCollapsed] = useState(false);
  const [knowledgeDockTab, setKnowledgeDockTab] = useState<KnowledgeDockTabKey>("explore");
  const [projectKnowledgeIncludeGlobal, setProjectKnowledgeIncludeGlobal] = useState(true);
  const [knowledgeHeaderSignals, setKnowledgeHeaderSignals] =
    useState<ProjectKnowledgeHeaderSignals>(DEFAULT_KNOWLEDGE_HEADER_SIGNALS);
  const [runtimeSignalTooltipOpen, setRuntimeSignalTooltipOpen] = useState(false);
  const [runtimeSignalLoading, setRuntimeSignalLoading] = useState(false);
  const [runtimeSignalDetails, setRuntimeSignalDetails] =
    useState<Record<string, RuntimeTaskDetail>>({});
  const [pendingKnowledgeQuery, setPendingKnowledgeQuery] = useState("");
  const [selectedMetricFilter, setSelectedMetricFilter] = useState<ProjectFileFilterKey | "">("");
  const [treeDisplayMode, setTreeDisplayMode] = useState<TreeDisplayMode>("filter");
  const [leftPaneSize, setLeftPaneSize] = useState(LEFT_PANE_EXPANDED_SIZE);
  const [workbenchPaneSize, setWorkbenchPaneSize] = useState(WORKBENCH_PANE_DEFAULT_SIZE);
  const [chatPaneSize, setChatPaneSize] = useState(CHAT_PANE_DEFAULT_SIZE);
  const [knowledgeDockSize, setKnowledgeDockSize] = useState(KNOWLEDGE_DOCK_DEFAULT_SIZE);
  const runFocusChatIdRef = useRef("");
  const workspaceFocusChatIdRef = useRef("");
  const designFocusChatIdRef = useRef("");
  const projectFilesRefreshTimerRef = useRef<number | null>(null);
  const assistantTurnFileSyncTimerRef = useRef<number | null>(null);
  const assistantTurnPipelineSyncTimerRef = useRef<number | null>(null);
  const lastFileTreeInvalidationAtRef = useRef(0);
  const lastPipelineInvalidationAtRef = useRef(0);
  const realtimeConnectionStatusRef = useRef<ProjectRealtimeConnectionStatus>("idle");
  const runRestoreAttemptKeyRef = useRef("");
  const automationDrawerAutoOpenKeyRef = useRef("");
  const pipelineManualActivationRef = useRef(false);
  const layoutPrefsLoadedRef = useRef(false);
  const workspaceResizeFrameRef = useRef<number | null>(null);
  const knowledgeDockResizeFrameRef = useRef<number | null>(null);
  const pendingWorkspaceSizesRef = useRef<number[] | null>(null);
  const pendingKnowledgeDockSizesRef = useRef<number[] | null>(null);

  const currentAgent = useMemo(
    () => getCurrentAgent(agents, selectedAgent),
    [agents, selectedAgent],
  );

  const projects = useMemo(
    () => currentAgent?.projects ?? [],
    [currentAgent?.projects],
  );

  const selectedProject = useMemo(
    () => projects.find((project) => matchesRouteProject(project, routeProjectId)),
    [projects, routeProjectId],
  );

  const projectKnowledgeState = useProjectKnowledgeState({
    projectId: selectedProject?.id || "",
    projectName: selectedProject?.name || "",
    includeGlobal: projectKnowledgeIncludeGlobal,
    onSignalsChange: setKnowledgeHeaderSignals,
    eagerSourceLoad:
      knowledgeDockTab === "sources"
      || knowledgeDockTab === "processing"
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
            if (task.task_type === "project_sync") {
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
      return t("projects.knowledge.runtimeStatusIdle", "Idle");
    }
    const taskLabel = getRuntimeTaskLabel(primaryTask.task_type, translateWithFallback);
    const percent = getRuntimeTaskPercent(primaryTask);
    const stageLabel = getRuntimeTaskStage(primaryTask);
    return [
      taskLabel,
      typeof percent === "number" ? `${percent}%` : stageLabel,
    ]
      .filter(Boolean)
      .join(" · ");
  }, [projectKnowledgeState.activeKnowledgeTask, t, translateWithFallback]);

  const runtimeSignalTooltipContent = useMemo(() => {
    const activeTasks = projectKnowledgeState.activeKnowledgeTasks;
    if (!activeTasks.length) {
      return (
        <div className={styles.knowledgeRuntimeTooltip}>
          <Text type="secondary">
            {t("projects.knowledge.runtimeStatusNoDetails", "No active knowledge task.")}
          </Text>
        </div>
      );
    }

    return (
      <div className={styles.knowledgeRuntimeTooltip}>
        <div className={styles.knowledgeRuntimeTooltipHeader}>
          <Text strong>{t("projects.knowledge.signalRuntimeStatus", "Runtime")}</Text>
          <Text type="secondary">
            {t("projects.knowledge.runtimeStatusTaskCount", "{{count}} active", {
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
                || ((detail as ProjectKnowledgeSyncState | null)?.last_error ?? "")
                || task.error
                || "",
            ).trim();
            const qualityLoopDetail = task.task_type === "quality_loop"
              ? (detail as QualityLoopJobStatus | null)
              : null;
            const projectSyncDetail = task.task_type === "project_sync"
              ? (detail as ProjectKnowledgeSyncState | null)
              : null;
            const semanticEngine = projectSyncDetail?.semantic_engine;
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
            const changedCount = typeof projectSyncDetail?.changed_count === "number"
              ? projectSyncDetail.changed_count
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
                      {t("projects.knowledge.runtimeStatusProgress", "Progress")}: {percent}%
                    </Text>
                  ) : null}
                  {typeof current === "number" && typeof total === "number" ? (
                    <Text type="secondary">{`${current}/${total}`}</Text>
                  ) : null}
                  {updatedAt ? (
                    <Text type="secondary">
                      {t("projects.knowledge.runtimeStatusUpdatedAt", "Updated")}: {updatedAt}
                    </Text>
                  ) : null}
                  {typeof changedCount === "number" ? (
                    <Text type="secondary">
                      {t("projects.knowledge.syncChangedCount", "Changed files: {{count}}", { count: changedCount })}
                    </Text>
                  ) : null}
                  {scoreBefore !== null && scoreAfter !== null ? (
                    <Text type="secondary">{`${Math.round((scoreBefore ?? 0) * 100)} -> ${Math.round((scoreAfter ?? 0) * 100)}`}</Text>
                  ) : null}
                  {delta !== null ? (
                    <Text type="secondary">
                      {t("projects.knowledge.runtimeStatusScoreDelta", "Score delta")}: {(delta ?? 0) >= 0 ? "+" : ""}{Math.round((delta ?? 0) * 100)}
                    </Text>
                  ) : null}
                </div>
                {stopReason ? (
                  <Text type="secondary">
                    {t("projects.knowledge.runtimeStatusStopReason", "Stop reason")}: {stopReason}
                  </Text>
                ) : null}
                {warnings.length ? (
                  <Text type="secondary">
                    {t("projects.knowledge.runtimeStatusWarnings", "Warnings")}: {warnings.join("; ")}
                  </Text>
                ) : null}
                {semanticEngine ? (
                  <Text type="secondary">
                    {t("projects.knowledge.semanticEngineStatus", "Semantic Engine")}: {semanticReasonLabel}
                    {semanticDescription ? `. ${semanticDescription}` : ""}
                  </Text>
                ) : null}
                {errorText ? (
                  <Text type="danger">
                    {t("projects.knowledge.runtimeStatusError", "Error")}: {errorText}
                  </Text>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    );
  }, [i18n.language, projectKnowledgeState.activeKnowledgeTasks, runtimeSignalDetails, runtimeSignalLoading, t, translateWithFallback]);

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
    () => computeProjectFileInventorySummary(visibleProjectFiles),
    [visibleProjectFiles],
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

  const loadProjectFiles = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
    options?: { preserveSelection?: boolean },
  ) => {
    setFilesLoading(true);
    const preserveSelection = Boolean(options?.preserveSelection);
    const previousSelection = preserveSelection ? selectedFilePath : "";
    if (!preserveSelection) {
      setSelectedFilePath("");
      setFileContent("");
    }
    const projectIds = buildProjectIdCandidates(project);
    let loaded = false;
    try {
      for (const projectRequestId of projectIds) {
        try {
          const files = await agentsApi.listProjectFiles(agentId, projectRequestId);
          const filteredFiles = files.filter(
            (item) => !isIgnoredProjectFile(item.path),
          );
          setProjectFiles(filteredFiles);
          setKnownProjectFilesByPath(buildProjectFilesByPath(filteredFiles));
          setResolvedProjectRequestId(projectRequestId);
          const preservedFile = previousSelection
            ? filteredFiles.find((item) => item.path === previousSelection)
            : undefined;
          const defaultFile = filteredFiles.find((item) =>
            isPreviewablePath(item.path),
          );
          const nextSelectedPath = preservedFile?.path || defaultFile?.path || "";
          if (nextSelectedPath) {
            setSelectedFilePath(nextSelectedPath);
          }
          loaded = true;
          break;
        } catch {
          // Try next id candidate.
        }
      }

      if (!loaded) {
        throw new Error("project_files_not_found");
      }
    } catch (err) {
      console.error("failed to load project files", err);
      setProjectFiles([]);
      setError(
        t("projects.loadFilesFailed"),
      );
    } finally {
      setFilesLoading(false);
    }
  }, [selectedFilePath, t]);

  const loadProjectTreeDirectory = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
    dirPath = "",
  ): Promise<AgentProjectFileTreeNode[]> => {
    const projectIds = [resolvedProjectRequestId, ...buildProjectIdCandidates(project)]
      .map((item) => item.trim())
      .filter(Boolean);
    const uniqueProjectIds = Array.from(new Set(projectIds));

    for (const projectRequestId of uniqueProjectIds) {
      try {
        const nodes = await agentsApi.listProjectFileTree(
          agentId,
          projectRequestId,
          dirPath,
        );
        const visibleNodes = nodes.filter((item) => !isIgnoredProjectFile(item.path));
        setKnownProjectFilesByPath((prev) => mergeProjectTreeNodesByPath(prev, visibleNodes));
        setResolvedProjectRequestId(projectRequestId);
        return visibleNodes;
      } catch {
        // Try next candidate id.
      }
    }

    throw new Error("project_file_tree_not_found");
  }, [resolvedProjectRequestId]);

  const loadProjectFileSummary = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
  ) => {
    const projectIds = [resolvedProjectRequestId, ...buildProjectIdCandidates(project)]
      .map((item) => item.trim())
      .filter(Boolean);
    const uniqueProjectIds = Array.from(new Set(projectIds));

    for (const projectRequestId of uniqueProjectIds) {
      try {
        const summary = await agentsApi.getProjectFileSummary(agentId, projectRequestId);
        setProjectFileSummary(summary);
        setResolvedProjectRequestId(projectRequestId);
        return summary;
      } catch {
        // Try next candidate id.
      }
    }

    throw new Error("project_file_summary_not_found");
  }, [resolvedProjectRequestId]);

  const loadProjectFilesMetadata = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
    paths: string[],
  ) => {
    const requestedPaths = Array.from(
      new Set(
        paths
          .map((item) => item.trim())
          .filter((item) => item && !isIgnoredProjectFile(item)),
      ),
    );
    if (requestedPaths.length === 0) {
      return [] as AgentProjectFileInfo[];
    }

    const projectIds = [resolvedProjectRequestId, ...buildProjectIdCandidates(project)]
      .map((item) => item.trim())
      .filter(Boolean);
    const uniqueProjectIds = Array.from(new Set(projectIds));

    for (const projectRequestId of uniqueProjectIds) {
      try {
        const files = await agentsApi.getProjectFilesMetadata(
          agentId,
          projectRequestId,
          requestedPaths,
        );
        const filteredFiles = files.filter((item) => !isIgnoredProjectFile(item.path));
        setResolvedProjectRequestId(projectRequestId);
        return filteredFiles;
      } catch {
        // Try next candidate id.
      }
    }

    throw new Error("project_file_metadata_not_found");
  }, [resolvedProjectRequestId]);

  const applyProjectFilesMetadataPatch = useCallback((
    requestedPaths: string[],
    files: AgentProjectFileInfo[],
  ) => {
    if (requestedPaths.length === 0) {
      return;
    }
    setKnownProjectFilesByPath((prev) =>
      reconcileProjectFilesByPath(prev, files, requestedPaths),
    );
    setProjectFiles((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      return reconcileProjectFilesList(prev, files, requestedPaths);
    });
  }, []);

  const scheduleProjectFilesRefresh = useCallback((
    agentId: string,
    project: AgentProjectSummary,
    options?: { preserveSelection?: boolean },
    delay = PROJECT_FILES_DEFER_MS,
  ) => {
    if (projectFilesRefreshTimerRef.current !== null) {
      window.clearTimeout(projectFilesRefreshTimerRef.current);
    }
    projectFilesRefreshTimerRef.current = window.setTimeout(() => {
      projectFilesRefreshTimerRef.current = null;
      void loadProjectFiles(agentId, project, options);
    }, delay);
  }, [loadProjectFiles]);

  const loadProjectTreeRoot = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
  ) => {
    setProjectTreeLoading(true);
    try {
      const nodes = await loadProjectTreeDirectory(agentId, project, "");
      setProjectTreeNodes(nodes);

      if (!selectedFilePath) {
        const previewDirs = nodes
          .filter((item) => item.is_directory && item.child_count > 0)
          .sort(compareProjectTreePreviewPriority)
          .slice(0, PROJECT_TREE_PREFETCH_DIR_LIMIT);
        let previewPath = "";
        for (const dir of previewDirs) {
          try {
            const children = await loadProjectTreeDirectory(agentId, project, dir.path);
            const previewableChild = children.find(
              (item) => !item.is_directory && isPreviewablePath(item.path),
            );
            if (previewableChild) {
              previewPath = previewableChild.path;
              break;
            }
          } catch {
            // best-effort prefetch only
          }
        }

        if (!previewPath) {
          previewPath = nodes.find(
            (item) => !item.is_directory && isPreviewablePath(item.path),
          )?.path || "";
        }

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

  const handleRefreshProjectFiles = useCallback(async () => {
    if (!currentAgent || !selectedProject) {
      return;
    }

    const agentId = currentAgent.id;
    const project = selectedProject;
    await Promise.allSettled([
      loadProjectFiles(agentId, project, { preserveSelection: true }),
      loadProjectTreeRoot(agentId, project),
      loadProjectFileSummary(agentId, project),
    ]);
  }, [currentAgent, loadProjectFileSummary, loadProjectFiles, loadProjectTreeRoot, selectedProject]);

  const {
    uploadModalOpen,
    setUploadModalOpen,
    uploadingFiles,
    pendingUploads,
    setPendingUploads,
    uploadTargetDir,
    setUploadTargetDir,
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
    setUploadModalOpen(true);
  }, [setPendingUploads, setUploadTargetDir, setUploadModalOpen]);

  const openRunBatchUploadModal = useCallback(() => {
    setPendingUploads([]);
    setUploadTargetDir(selectedRunId ? `original/batches/${selectedRunId}` : "original/batches/manual");
    setUploadModalOpen(true);
  }, [selectedRunId, setPendingUploads, setUploadTargetDir, setUploadModalOpen]);

  const shouldBlockLeave = useMemo(() => {
    const runInProgress = runDetail?.status === "running" || runDetail?.status === "pending";
    const designSessionActive = Boolean(designFocusChatId && !selectedRunId);

    return Boolean(
      selectedAttachPaths.length > 0 ||
      pendingUploads.length > 0 ||
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
    const projectIds = [resolvedProjectRequestId, ...buildProjectIdCandidates(project)]
      .map((item) => item.trim())
      .filter(Boolean);
    const uniqueProjectIds = Array.from(new Set(projectIds));
    try {
      let loaded = false;
      for (const projectRequestId of uniqueProjectIds) {
        try {
          const data = await agentsApi.readProjectFile(
            agentId,
            projectRequestId,
            filePath,
          );
          setFileContent(data.content);
          setResolvedProjectRequestId(projectRequestId);
          loaded = true;
          break;
        } catch {
          // Try next id candidate.
        }
      }
      if (!loaded) {
        throw new Error("project_file_content_not_found");
      }
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
  }, [resolvedProjectRequestId, t]);

  const fetchProjectFileSnippet = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
    filePath: string,
  ): Promise<string> => {
    const projectIds = [resolvedProjectRequestId, ...buildProjectIdCandidates(project)]
      .map((item) => item.trim())
      .filter(Boolean);
    const uniqueProjectIds = Array.from(new Set(projectIds));

    for (const projectRequestId of uniqueProjectIds) {
      try {
        const data = await agentsApi.readProjectFile(
          agentId,
          projectRequestId,
          filePath,
        );
        setResolvedProjectRequestId(projectRequestId);
        const normalized = (data.content || "")
          .replace(/\r\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        return normalized.slice(0, 1200);
      } catch {
        // Try next candidate id.
      }
    }

    throw new Error("project_file_content_not_found");
  }, [resolvedProjectRequestId]);

  const loadRunDetail = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
    runId: string,
  ) => {
    const projectIds = [resolvedProjectRequestId, ...buildProjectIdCandidates(project)]
      .map((item) => item.trim())
      .filter(Boolean);
    const uniqueProjectIds = Array.from(new Set(projectIds));
    try {
      let loaded = false;
      for (const projectRequestId of uniqueProjectIds) {
        try {
          const detail = await agentsApi.getProjectPipelineRun(
            agentId,
            projectRequestId,
            runId,
          );
          setRunDetail(detail);
          setResolvedProjectRequestId(projectRequestId);
          if (detail.artifacts.length > 0) {
            setSelectedFilePath((prev) => prev || detail.artifacts[0]);
          }
          loaded = true;
          break;
        } catch {
          // Try next id candidate.
        }
      }
      if (!loaded) {
        throw new Error("project_run_not_found");
      }
    } catch (err) {
      console.error("failed to load pipeline run detail", err);
      setRunDetail(null);
      setError(
        t("projects.pipeline.loadRunFailed"),
      );
    }
  }, [resolvedProjectRequestId, t]);

  const loadPipelineContext = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
  ) => {
    setPipelineLoading(true);
    const projectIds = buildProjectIdCandidates(project);
    try {
      let templates: ProjectPipelineTemplateInfo[] = [];
      let runs: ProjectPipelineRunSummary[] = [];
      let loaded = false;

      for (const projectRequestId of projectIds) {
        try {
          const [templateData, runData] = await Promise.all([
            agentsApi.listProjectPipelineTemplates(agentId, projectRequestId),
            agentsApi.listProjectPipelineRuns(agentId, projectRequestId),
          ]);
          templates = templateData;
          runs = runData;
          setResolvedProjectRequestId(projectRequestId);
          loaded = true;
          break;
        } catch {
          // Try next id candidate.
        }
      }

      if (!loaded) {
        throw new Error("project_pipeline_context_not_found");
      }

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
  }, [t]);

  const loadProjectPipelineRuns = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
  ) => {
    setPipelineLoading(true);
    const projectIds = [resolvedProjectRequestId, ...buildProjectIdCandidates(project)]
      .map((item) => item.trim())
      .filter(Boolean);
    const uniqueProjectIds = Array.from(new Set(projectIds));
    try {
      for (const projectRequestId of uniqueProjectIds) {
        try {
          const runs = await agentsApi.listProjectPipelineRuns(agentId, projectRequestId);
          setPipelineRuns(runs);
          setResolvedProjectRequestId(projectRequestId);
          setError("");
          return runs;
        } catch {
          // Try next candidate id.
        }
      }
      throw new Error("project_pipeline_runs_not_found");
    } catch (err) {
      console.error("failed to load pipeline runs", err);
      setPipelineRuns([]);
      setError(
        `${t("projects.pipeline.loadFailed")} ${(err as Error)?.message || ""}`.trim(),
      );
      return [] as ProjectPipelineRunSummary[];
    } finally {
      setPipelineLoading(false);
    }
  }, [resolvedProjectRequestId, t]);

  const handleRealtimeFileTreeInvalidated = useCallback(async (payload?: {
    changedPaths: string[];
    reason: string;
    fileSummary?: AgentProjectFileSummary;
  }) => {
    if (!currentAgent || !selectedProject) {
      return;
    }
    lastFileTreeInvalidationAtRef.current = Date.now();
    if (payload?.fileSummary) {
      setProjectFileSummary(payload.fileSummary);
    } else {
      void loadProjectFileSummary(currentAgent.id, selectedProject).catch((err) => {
        console.error("failed to load project file summary", err);
        setProjectFileSummary(null);
      });
    }
    const changedPaths = Array.from(
      new Set(
        (payload?.changedPaths || [])
          .map((item) => item.trim())
          .filter((item) => item && !isIgnoredProjectFile(item)),
      ),
    );
    if (
      changedPaths.length > 0
      && (!selectedFilePath || !changedPaths.includes(selectedFilePath))
    ) {
      setWorkbenchSyncNotice({
        changedPaths,
        updatedAt: Date.now(),
      });
    }
    const shouldPatchIncrementally = Boolean(
      payload
      && payload.reason !== "resync"
      && changedPaths.length > 0,
    );
    let patchedIncrementally = false;

    if (shouldPatchIncrementally) {
      await Promise.all([
        loadProjectTreeRoot(currentAgent.id, selectedProject),
        loadProjectFilesMetadata(currentAgent.id, selectedProject, changedPaths)
          .then((files) => {
            applyProjectFilesMetadataPatch(changedPaths, files);
            patchedIncrementally = true;
          })
          .catch((err) => {
            console.error("failed to patch project file metadata", err);
          }),
      ]);
    } else {
      await loadProjectTreeRoot(currentAgent.id, selectedProject);
    }

    if (!patchedIncrementally) {
      scheduleProjectFilesRefresh(currentAgent.id, selectedProject, {
        preserveSelection: true,
      });
    }
    const shouldRefreshSelectedContent = Boolean(
      selectedFilePath
      && isPreviewablePath(selectedFilePath)
      && (
        !payload
        || payload.reason === "resync"
        || changedPaths.length === 0
        || changedPaths.includes(selectedFilePath)
      ),
    );
    if (shouldRefreshSelectedContent) {
      setWorkbenchSyncNotice((prev) => {
        if (!prev) {
          return prev;
        }
        return changedPaths.includes(selectedFilePath) ? null : prev;
      });
      await loadFileContent(currentAgent.id, selectedProject, selectedFilePath);
    }
  }, [applyProjectFilesMetadataPatch, currentAgent, loadFileContent, loadProjectFileSummary, loadProjectFilesMetadata, loadProjectTreeRoot, scheduleProjectFilesRefresh, selectedFilePath, selectedProject]);

  const handleRealtimePipelineInvalidated = useCallback(async (_payload?: {
    changedPaths: string[];
    reason: string;
  }) => {
    if (!currentAgent || !selectedProject) {
      return;
    }
    lastPipelineInvalidationAtRef.current = Date.now();
    const changedPaths = Array.from(
      new Set(
        (_payload?.changedPaths || [])
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
    const templateChanged = Boolean(
      !_payload
      || _payload.reason === "resync"
      || changedPaths.length === 0
      || changedPaths.some((item) => isProjectPipelineTemplatePath(item))
      || changedPaths.some((item) => !isProjectPipelineRunPath(item)),
    );

    if (templateChanged) {
      await loadPipelineContext(currentAgent.id, selectedProject);
      if (selectedRunId) {
        await loadRunDetail(currentAgent.id, selectedProject, selectedRunId);
      }
      return;
    }

    const runs = await loadProjectPipelineRuns(currentAgent.id, selectedProject);
    const changedRunIds = Array.from(
      new Set(
        changedPaths
          .map((item) => getProjectPipelineRunIdFromPath(item))
          .filter(Boolean),
      ),
    );

    if (
      selectedRunId
      && runs.some((item) => item.id === selectedRunId)
      && (changedRunIds.length === 0 || changedRunIds.includes(selectedRunId))
    ) {
      await loadRunDetail(currentAgent.id, selectedProject, selectedRunId);
    }
  }, [currentAgent, loadPipelineContext, loadProjectPipelineRuns, loadRunDetail, selectedProject, selectedRunId]);

  const handleAssistantTurnCompleted = useCallback(async () => {
    if (!currentAgent || !selectedProject) {
      return;
    }

    if (assistantTurnFileSyncTimerRef.current !== null) {
      window.clearTimeout(assistantTurnFileSyncTimerRef.current);
      assistantTurnFileSyncTimerRef.current = null;
    }
    if (assistantTurnPipelineSyncTimerRef.current !== null) {
      window.clearTimeout(assistantTurnPipelineSyncTimerRef.current);
      assistantTurnPipelineSyncTimerRef.current = null;
    }

    const isRealtimeLikelyToDeliver =
      realtimeConnectionStatusRef.current === "connected"
      || realtimeConnectionStatusRef.current === "connecting"
      || realtimeConnectionStatusRef.current === "reconnecting";

    const performFileFallbackSync = () => {
      void Promise.all([
        loadProjectFileSummary(currentAgent.id, selectedProject).catch(() => null),
        loadProjectTreeRoot(currentAgent.id, selectedProject),
      ]).then(async () => {
        scheduleProjectFilesRefresh(currentAgent.id, selectedProject, {
          preserveSelection: true,
        }, 120);

        if (selectedFilePath && isPreviewablePath(selectedFilePath)) {
          await loadFileContent(currentAgent.id, selectedProject, selectedFilePath);
        }

      });
    };

    const performPipelineFallbackSync = () => {
      void loadPipelineContext(currentAgent.id, selectedProject).then(async () => {
        if (selectedRunId) {
          await loadRunDetail(currentAgent.id, selectedProject, selectedRunId);
        }
      });
    };

    if (isRealtimeLikelyToDeliver) {
      const completedAt = Date.now();
      assistantTurnFileSyncTimerRef.current = window.setTimeout(() => {
        assistantTurnFileSyncTimerRef.current = null;
        const fileTreeDelivered = lastFileTreeInvalidationAtRef.current >= completedAt;
        if (!fileTreeDelivered) {
          performFileFallbackSync();
        }
      }, ASSISTANT_TURN_REALTIME_FALLBACK_MS);
      assistantTurnPipelineSyncTimerRef.current = window.setTimeout(() => {
        assistantTurnPipelineSyncTimerRef.current = null;
        const pipelineDelivered = lastPipelineInvalidationAtRef.current >= completedAt;
        if (!pipelineDelivered) {
          performPipelineFallbackSync();
        }
      }, ASSISTANT_TURN_REALTIME_FALLBACK_MS);
      return;
    }

    performFileFallbackSync();
    performPipelineFallbackSync();
  }, [
    currentAgent,
    loadFileContent,
    loadPipelineContext,
    loadProjectFileSummary,
    loadProjectTreeRoot,
    loadRunDetail,
    scheduleProjectFilesRefresh,
    selectedFilePath,
    selectedProject,
    selectedRunId,
  ]);

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
    const projectIds = [resolvedProjectRequestId, ...buildProjectIdCandidates(selectedProject)]
      .map((item) => item.trim())
      .filter(Boolean);
    const uniqueProjectIds = Array.from(new Set(projectIds));

    try {
      let importedTemplateId = "";
      let imported = false;

      for (const projectRequestId of uniqueProjectIds) {
        try {
          const result = await agentsApi.importPlatformTemplateIntoProject(
            currentAgent.id,
            projectRequestId,
            { platform_template_id: selectedPlatformTemplateId },
          );
          setResolvedProjectRequestId(projectRequestId);
          importedTemplateId = result.id;
          imported = true;
          break;
        } catch {
          // Try next candidate id.
        }
      }

      if (!imported) {
        throw new Error("import_platform_template_failed");
      }

      await loadPipelineContext(currentAgent.id, selectedProject);
      if (importedTemplateId) {
        setSelectedTemplateId(importedTemplateId);
      }
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
    t,
  ]);

  const pollPipelineRun = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
    runId: string,
  ) => {
    const projectIds = [resolvedProjectRequestId, ...buildProjectIdCandidates(project)]
      .map((item) => item.trim())
      .filter(Boolean);
    const uniqueProjectIds = Array.from(new Set(projectIds));
    try {
      for (const projectRequestId of uniqueProjectIds) {
        try {
          const [runs, detail] = await Promise.all([
            agentsApi.listProjectPipelineRuns(agentId, projectRequestId),
            agentsApi.getProjectPipelineRun(agentId, projectRequestId, runId),
          ]);
          setPipelineRuns(runs);
          setRunDetail(detail);
          setResolvedProjectRequestId(projectRequestId);
          return;
        } catch {
          // Try next id candidate.
        }
      }
    } catch (err) {
      console.error("failed to poll pipeline run", err);
    }
  }, [resolvedProjectRequestId]);

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
    const projectIds = [resolvedProjectRequestId, ...buildProjectIdCandidates(selectedProject)]
      .map((item) => item.trim())
      .filter(Boolean);
    const uniqueProjectIds = Array.from(new Set(projectIds));
    try {
      let run: ProjectPipelineRunDetail | null = null;
      let requestProjectId = "";
      for (const projectRequestId of uniqueProjectIds) {
        try {
          run = await agentsApi.createProjectPipelineRun(
            currentAgent.id,
            projectRequestId,
            {
              template_id: selectedTemplateId,
              parameters: {
                input_scope: "all_original",
                input_scope_policy: "default_if_no_batch_upload",
              },
            },
          );
          requestProjectId = projectRequestId;
          setResolvedProjectRequestId(projectRequestId);
          break;
        } catch {
          // Try next id candidate.
        }
      }

      if (!run) {
        throw new Error("project_pipeline_run_create_failed");
      }

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
  }, [currentAgent, handleSwitchToRunFocusChat, loadPipelineContext, resolvedProjectRequestId, selectedProject, selectedTemplateId, t]);

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

  useEffect(() => {
    realtimeConnectionStatusRef.current = realtimeConnectionState.status;
  }, [realtimeConnectionState.status]);

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

  const showRealtimeStatus = shouldShowRealtimeStatus(realtimeConnectionState.status);

  useEffect(() => {
    if (!currentAgent) {
      void loadAgents();
    }
  }, [currentAgent, loadAgents]);

  useEffect(() => {
    if (projectFilesRefreshTimerRef.current !== null) {
      window.clearTimeout(projectFilesRefreshTimerRef.current);
      projectFilesRefreshTimerRef.current = null;
    }
    if (assistantTurnFileSyncTimerRef.current !== null) {
      window.clearTimeout(assistantTurnFileSyncTimerRef.current);
      assistantTurnFileSyncTimerRef.current = null;
    }
    if (assistantTurnPipelineSyncTimerRef.current !== null) {
      window.clearTimeout(assistantTurnPipelineSyncTimerRef.current);
      assistantTurnPipelineSyncTimerRef.current = null;
    }
    setResolvedProjectRequestId("");
    setProjectFiles([]);
    setProjectTreeNodes([]);
    setProjectFileSummary(null);
    setKnownProjectFilesByPath({});
    setSelectedFilePath("");
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
      setActiveStage(parsed.activeStage);
      setKnowledgeModuleCollapsed(parsed.knowledgeModuleCollapsed);
      setKnowledgeDockTab(parsed.knowledgeDockTab);
      setSelectedMetricFilter(parsed.selectedMetricFilter);
      setTreeDisplayMode(parsed.treeDisplayMode);
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
      setTreeDisplayMode(parsed.treeDisplayMode);
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
    treeDisplayMode,
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
    void loadProjectTreeRoot(currentAgent.id, selectedProject);

    let cancelled = false;
    let fileTimer: number | null = null;
    const idleCallback = (window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    }).requestIdleCallback;
    const cancelIdleCallback = (window as Window & {
      cancelIdleCallback?: (handle: number) => void;
    }).cancelIdleCallback;
    let fileIdleHandle: number | null = null;

    const loadDeferredProjectFiles = () => {
      if (cancelled) {
        return;
      }
      scheduleProjectFilesRefresh(currentAgent.id, selectedProject, {
        preserveSelection: true,
      });
    };

    if (typeof idleCallback === "function") {
      fileIdleHandle = idleCallback(loadDeferredProjectFiles, {
        timeout: INITIAL_PROJECT_FILES_IDLE_TIMEOUT_MS,
      });
    } else {
      fileTimer = window.setTimeout(
        loadDeferredProjectFiles,
        INITIAL_PROJECT_FILES_IDLE_TIMEOUT_MS,
      );
    }

    return () => {
      cancelled = true;
      if (projectFilesRefreshTimerRef.current !== null) {
        window.clearTimeout(projectFilesRefreshTimerRef.current);
        projectFilesRefreshTimerRef.current = null;
      }
      if (assistantTurnFileSyncTimerRef.current !== null) {
        window.clearTimeout(assistantTurnFileSyncTimerRef.current);
        assistantTurnFileSyncTimerRef.current = null;
      }
      if (assistantTurnPipelineSyncTimerRef.current !== null) {
        window.clearTimeout(assistantTurnPipelineSyncTimerRef.current);
        assistantTurnPipelineSyncTimerRef.current = null;
      }
      if (fileTimer !== null) {
        window.clearTimeout(fileTimer);
      }
      if (fileIdleHandle !== null && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(fileIdleHandle);
      }
    };
  }, [currentAgent, selectedProject, loadProjectTreeRoot, scheduleProjectFilesRefresh]);

  useEffect(() => {
    if (!currentAgent || !selectedProject || projectFileSummary) {
      return;
    }
    if (
      realtimeConnectionState.status === "connected"
      || realtimeConnectionState.status === "connecting"
      || realtimeConnectionState.status === "reconnecting"
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void loadProjectFileSummary(currentAgent.id, selectedProject).catch((err) => {
        console.error("failed to load project file summary", err);
        setProjectFileSummary(null);
      });
    }, 400);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    currentAgent,
    loadProjectFileSummary,
    projectFileSummary,
    realtimeConnectionState.status,
    selectedProject,
  ]);

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

  const handleSelectArtifactFile = useCallback((path: string) => {
    setWorkbenchSyncNotice(null);
    setSelectedFilePath(path);
  }, []);

  const handleAttachArtifactToChat = useCallback((path: string) => {
    setSelectedAttachPaths((prev) =>
      prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path],
    );
  }, [
    setSelectedAttachPaths,
  ]);

  const handleProjectAutoKnowledgeSinkChange = useCallback((enabled: boolean) => {
    if (!currentAgent || !selectedProject) {
      return;
    }
    const nextAgents = agents.map((agent) => {
      if (agent.id !== currentAgent.id) {
        return agent;
      }
      return {
        ...agent,
        projects: (agent.projects || []).map((project) => (
          project.id === selectedProject.id
            ? { ...project, project_auto_knowledge_sink: enabled }
            : project
        )),
      };
    });
    setAgents(nextAgents);
  }, [agents, currentAgent, selectedProject, setAgents]);

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

    const projectIds = [resolvedProjectRequestId, ...buildProjectIdCandidates(selectedProject)]
      .map((item) => item.trim())
      .filter(Boolean);
    const uniqueProjectIds = Array.from(new Set(projectIds));

    try {
      let continuedRun: ProjectPipelineRunDetail | null = null;
      let requestProjectId = "";
      for (const projectRequestId of uniqueProjectIds) {
        try {
          continuedRun = await agentsApi.retryProjectPipelineRun(
            currentAgent.id,
            projectRequestId,
            selectedRunId,
            {
              step_id: action.target_step_id,
              note: action.title,
            },
          );
          requestProjectId = projectRequestId;
          setResolvedProjectRequestId(projectRequestId);
          break;
        } catch {
          // Try next candidate id.
        }
      }

      if (!continuedRun) {
        throw new Error("project_pipeline_run_retry_failed");
      }

      await loadPipelineContext(currentAgent.id, selectedProject);
      setSelectedRunId(continuedRun.id);
      setRunDetail(continuedRun);
      setSelectedStepId(action.target_step_id);
      handleSwitchToRunFocusChat({
        runId: continuedRun.id,
        projectRequestId: requestProjectId || selectedProject.id,
      });
      message.success(
        t(
          "projects.pipeline.executeActionSuccess",
          { stepId: action.target_step_id },
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
          />
        ),
      },
      {
        key: "sources",
        label: t("projects.knowledgeDock.tabSources", "Sources"),
        children: (
          <ProjectKnowledgeSourcesPanel
            knowledgeState={projectKnowledgeState}
          />
        ),
      },
      {
        key: "processing",
        label: t("projects.knowledgeDock.tabProcessing", "Processing"),
        children: (
          <ProjectKnowledgeProcessingPanel
            knowledgeState={projectKnowledgeState}
            onOpenSettings={handleKnowledgeOpenSettings}
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
            projectName={selectedProject.name}
            projectWorkspaceDir={
              selectedProject.workspace_dir || currentAgent?.workspace_dir || ""
            }
            projectAutoKnowledgeSink={selectedProject.project_auto_knowledge_sink !== false}
            includeGlobal={projectKnowledgeIncludeGlobal}
            onIncludeGlobalChange={setProjectKnowledgeIncludeGlobal}
            onProjectAutoKnowledgeSinkChange={handleProjectAutoKnowledgeSinkChange}
          />
        ),
      },
    ];
  }, [
    currentAgent?.id,
    currentAgent?.workspace_dir,
    handleKnowledgeOpenOutputs,
    handleKnowledgeOpenSettings,
    handleKnowledgeRequestedQueryHandled,
    handleKnowledgeRunSuggestedQuery,
    handleProjectAutoKnowledgeSinkChange,
    handleRuntimeSignalTooltipOpenChange,
    knowledgeHeaderSignals,
    pendingKnowledgeQuery,
    projectKnowledgeIncludeGlobal,
    projectKnowledgeState,
    runtimeSignalTooltipContent,
    runtimeSignalTooltipOpen,
    runtimeSignalValue,
    selectedProject,
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
                {selectedProject?.name || t("projects.path.projectSpace")}
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
          {showRealtimeStatus ? (
            <div className={styles.realtimeStatusRow}>
              <Badge
                status={getRealtimeBadgeStatus(realtimeConnectionState.status)}
                text={realtimeConnectionText}
              />
              {realtimeConnectionState.reconnectAttempt > 0 ? (
                <Text type="secondary" className={styles.realtimeStatusMeta}>
                  {t("projects.realtime.retryingAttempt", "Attempt {{count}}", {
                    count: realtimeConnectionState.reconnectAttempt,
                  })}
                </Text>
              ) : null}
            </div>
          ) : null}
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
                            selectedAttachPaths={selectedAttachPaths}
                            activeStage={activeStage}
                            selectedMetricFilter={selectedMetricFilter}
                            onMetricFilterChange={setSelectedMetricFilter}
                            treeDisplayMode={treeDisplayMode}
                            onTreeDisplayModeChange={setTreeDisplayMode}
                            onRefreshProjectFiles={handleRefreshProjectFiles}
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
                            onAttachArtifactToChat={(path) => {
                              void handleAttachArtifactToChat(path);
                            }}
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
                            syncNotice={workbenchSyncNotice}
                            filesLoading={filesLoading}
                            contentLoading={contentLoading}
                            artifactRecords={artifactRecords}
                            selectedArtifactRecord={selectedArtifactRecord}
                            selectedFilePath={selectedFilePath}
                            knownProjectFilesByPath={knownProjectFilesByPath}
                            projectFiles={effectiveProjectFiles}
                            fileContent={fileContent}
                            selectedAttachPaths={selectedAttachPaths}
                            autoAnalyzeOnAttach={autoAnalyzeOnAttach}
                            sendingSelectedFiles={sendingSelectedFiles}
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
                      <div className={styles.columnChat}>
                        {projectChatPanelNode}
                      </div>
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
                                activeKey={knowledgeDockTab}
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
                          handleSelectArtifactFile(path);
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
            uploadHint={uploadModalHint}
            onChangeUploadTargetDir={setUploadTargetDir}
            onChangePendingUploads={setPendingUploads}
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
