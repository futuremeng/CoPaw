import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Popconfirm,
  Spin,
  Typography,
  message,
} from "antd";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { agentsApi } from "../../../api/modules/agents";
import { chatApi } from "../../../api/modules/chat";
import ProjectAutomationPanel from "./ProjectAutomationPanel";
import ProjectChatPanel, { type ProjectChatAutoAttachRequest } from "./ProjectChatPanel";
import ProjectOverviewCard from "./ProjectOverviewCard";
import ProjectUploadModal from "./ProjectUploadModal";
import ProjectWorkbenchPanel from "./ProjectWorkbenchPanel";
import useArtifactSelectionGuards from "./useArtifactSelectionGuards";
import useProjectChatEnsureController from "./useProjectChatEnsureController";
import useProjectChatFocusEffects from "./useProjectChatFocusEffects";
import useProjectDesignChatController from "./useProjectDesignChatController";
import useLeaveConfirmGuard from "./useLeaveConfirmGuard";
import useOpenUploadQuery from "./useOpenUploadQuery";
import useProjectUploadController from "./useProjectUploadController";
import type {
  AgentProjectSummary,
  AgentProjectFileInfo,
  ProjectPipelineArtifactRecord,
  ProjectPipelineRunDetail,
  ProjectPipelineRunSummary,
  ProjectPipelineTemplateInfo,
  PlatformFlowTemplateInfo,
  AgentSummary,
} from "../../../api/types/agents";
import { useAgentStore } from "../../../stores/agentStore";
import styles from "./index.module.less";

const { Title, Text } = Typography;

function getCurrentAgent(
  agents: AgentSummary[],
  selectedAgent: string,
): AgentSummary | undefined {
  return agents.find((agent) => agent.id === selectedAgent);
}

function projectDirNameFromMetadata(metadataFile: string): string {
  const normalized = metadataFile.replace(/\\/g, "/").trim();
  if (!normalized) {
    return "";
  }
  const segments = normalized.split("/").filter(Boolean);
  return segments.length >= 2 ? segments[segments.length - 2] : "";
}

function buildProjectIdCandidates(project?: AgentProjectSummary): string[] {
  if (!project) {
    return [];
  }
  const candidates = [project.id, projectDirNameFromMetadata(project.metadata_file)]
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(candidates));
}

function matchesRouteProject(project: AgentProjectSummary, routeProjectId: string): boolean {
  return buildProjectIdCandidates(project).includes(routeProjectId);
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

function isPreviewablePath(path: string): boolean {
  if (!path) {
    return false;
  }
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith(".")) {
    return false;
  }
  if (normalized.split("/").some((part) => part.startsWith("."))) {
    return false;
  }
  return true;
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

function isTextSourcePath(path: string): boolean {
  const normalized = path.toLowerCase();
  return (
    normalized.endsWith(".md") ||
    normalized.endsWith(".markdown") ||
    normalized.endsWith(".mdx") ||
    normalized.endsWith(".txt")
  );
}

function selectSeedSourceFiles(paths: string[]): string[] {
  const unique = Array.from(new Set(paths.map((item) => item.trim()).filter(Boolean)));
  const textFiles = unique.filter((item) => isTextSourcePath(item));
  const fallback = textFiles.length > 0 ? textFiles : unique;
  const prioritized = [...fallback].sort((a, b) => {
    const aPriority = a.includes("/data/") || a.includes("/raw/") ? 0 : 1;
    const bPriority = b.includes("/data/") || b.includes("/raw/") ? 0 : 1;
    if (aPriority !== bPriority) {
      return aPriority - bPriority;
    }
    return a.localeCompare(b);
  });
  return prioritized.slice(0, 4);
}

function buildProjectWorkspaceSummary(params: {
  projectName: string;
  projectDescription: string;
  workspaceDir: string;
  sourceFiles: string[];
}): string {
  const seedFiles = selectSeedSourceFiles(params.sourceFiles);
  const fileLines = seedFiles.length
    ? seedFiles.map((file, index) => `${index + 1}. ${file}`).join("\n")
    : "- 暂无已索引的项目资料";
  const safeDescription = params.projectDescription.trim() || "暂无项目简介";
  return [
    `项目：${params.projectName}`,
    `简介：${safeDescription}`,
    `工作区：${params.workspaceDir || "-"}`,
    "优先资料：",
    fileLines,
  ].join("\n");
}

function inferMimeTypeByPath(path: string): string {
  const normalized = path.toLowerCase();
  if (normalized.endsWith(".md") || normalized.endsWith(".markdown") || normalized.endsWith(".mdx")) {
    return "text/markdown";
  }
  if (normalized.endsWith(".txt")) {
    return "text/plain";
  }
  if (normalized.endsWith(".json")) {
    return "application/json";
  }
  return "text/plain";
}

function isBuiltInProjectFile(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  const fileName = normalized.split("/").pop() || "";
  if (fileName === "project.md" || fileName === "heartbeat.md") {
    return true;
  }
  return false;
}

function buildAutoAttachAnalysisPrompt(params: {
  projectName: string;
  fileNames: string[];
  selectedRunId?: string;
}): string {
  const fileList = params.fileNames
    .slice(0, 8)
    .map((name, index) => `${index + 1}. ${name}`)
    .join("\n");
  const modeHint = params.selectedRunId
    ? "这些文件与当前运行上下文相关。"
    : "这些文件与当前项目设计上下文相关。";
  return [
    `我刚刚附加了 ${params.fileNames.length} 个项目文件，请合并分析。`,
    `项目：${params.projectName}`,
    modeHint,
    "文件列表：",
    fileList,
    "请先根据文件名和内容猜测我最可能的目标或需求，再用 2-4 条要点总结你的判断和建议下一步。",
    "如果信息不足，最后只补一个简短澄清问题；如果已经足够，就直接继续分析。",
  ].join("\n");
}

function buildAttachDraftPrompt(params: {
  projectName: string;
  selectedRunId?: string;
  selectedFiles: Array<{ path: string; size: number }>;
}): string {
  const modeHint = params.selectedRunId
    ? `当前运行：${params.selectedRunId}`
    : "当前上下文：流程设计";
  const fileList = params.selectedFiles
    .map((item, index) => `${index + 1}. ${item.path} (${item.size} bytes)`)
    .join("\n");
  return [
    `我已选择 ${params.selectedFiles.length} 个项目文件作为上下文。`,
    `项目：${params.projectName}`,
    modeHint,
    "文件列表：",
    fileList,
  ].join("\n");
}

function isSucceededStatus(status: string): boolean {
  return status === "succeeded" || status === "completed";
}

function toTimestamp(raw?: string): number {
  if (!raw) {
    return 0;
  }
  const ts = Date.parse(raw);
  return Number.isFinite(ts) ? ts : 0;
}

function buildImplementationAdvancePrompt(params: {
  projectName: string;
  templateName: string;
  templateId: string;
  runCount: number;
  latestRunStatus: string;
  gateSummary: string;
}): string {
  return [
    `我们继续以“对话驱动”方式推进项目流程构建。项目：${params.projectName}`,
    `当前流程：${params.templateName} (${params.templateId})`,
    `当前运行数：${params.runCount}，最近一次运行状态：${params.latestRunStatus || "none"}`,
    `验证门槛现状：${params.gateSummary}`,
    "请你输出下一轮实施计划（不是最终模板），要求：",
    "1) 仅调整最小必要步骤；",
    "2) 对每一步明确 inputs / outputs / depends_on / retry_policy；",
    "3) 说明本轮要验证的假设与成功判定；",
    "4) 最后给出‘我下一步该点击什么（Run / Attach / 继续对话）’。",
  ].join("\n");
}

function buildValidationRoundPrompt(params: {
  projectName: string;
  runId: string;
  templateName: string;
  gateSummary: string;
}): string {
  return [
    `请基于当前运行做一次“验证导向”复盘。项目：${params.projectName}`,
    `运行：${params.runId}，流程：${params.templateName}`,
    `当前门槛状态：${params.gateSummary}`,
    "请输出：",
    "1) 通过项 / 失败项（逐步列出）；",
    "2) 每个失败项的最小修复动作；",
    "3) 是否建议立即重跑；若是，给出重跑前必须修改的项；",
    "4) 用一句话判断：是否已到‘可吸收为模板’时机。",
  ].join("\n");
}

function buildPromotionDraftPrompt(params: {
  projectName: string;
  templateName: string;
  templateId: string;
  runId: string;
}): string {
  return [
    `我们准备把已验证成果吸收为模板草案。项目：${params.projectName}`,
    `目标模板：${params.templateName} (${params.templateId})，依据运行：${params.runId}`,
    "请输出结构化模板草案（不是解释文），要求：",
    "1) 仅保留已验证通过的步骤；",
    "2) 每步必须含 id/name/kind/inputs/outputs/depends_on/input_bindings/retry_policy；",
    "3) 标注本次吸收剔除的步骤及原因；",
    "4) 最后给一段简短变更摘要，便于我人工确认后保存。",
  ].join("\n");
}

const INLINE_FULL_MAX_BYTES = 32 * 1024;
const INLINE_TRUNCATE_MAX_BYTES = 256 * 1024;
const INLINE_TRUNCATE_HEAD_CHARS = 8000;
const INLINE_TRUNCATE_TAIL_CHARS = 4000;
const INLINE_TOTAL_CHAR_BUDGET = 20000;

export default function ProjectDetailPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId?: string }>();
  const { selectedAgent, agents, setAgents } = useAgentStore();
  const routeProjectId = useMemo(
    () => (projectId ? decodeURIComponent(projectId) : ""),
    [projectId],
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [resolvedProjectRequestId, setResolvedProjectRequestId] = useState("");
  const [projectFiles, setProjectFiles] = useState<AgentProjectFileInfo[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [hideBuiltInFiles, setHideBuiltInFiles] = useState(true);
  const [fileContent, setFileContent] = useState("");
  const [filesLoading, setFilesLoading] = useState(false);
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
  const [chatStarting, setChatStarting] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState("");
  const [deletingProject, setDeletingProject] = useState(false);
  const [autoAttachRequest, setAutoAttachRequest] = useState<ProjectChatAutoAttachRequest | null>(null);
  const [selectedAttachPaths, setSelectedAttachPaths] = useState<string[]>([]);
  const [sendingSelectedFiles, setSendingSelectedFiles] = useState(false);
  const [autoAnalyzeOnAttach, setAutoAnalyzeOnAttach] = useState(true);
  const runFocusChatIdRef = useRef("");
  const workspaceFocusChatIdRef = useRef("");
  const designFocusChatIdRef = useRef("");
  const runRestoreAttemptKeyRef = useRef("");

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

  const leaveConfirmText = useMemo(
    () =>
      t(
        "projects.leaveConfirm",
        "你有可能误触跳转。确定要离开当前项目页面吗？",
      ),
    [t],
  );

  const artifactRecords = useMemo<ProjectPipelineArtifactRecord[]>(() => {
    if (runDetail?.artifact_records?.length) {
      return runDetail.artifact_records.filter((item) => isPreviewablePath(item.path));
    }

    return projectFiles
      .filter((file) => isPreviewablePath(file.path))
      .filter((file) => !hideBuiltInFiles || !isBuiltInProjectFile(file.path))
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
  }, [hideBuiltInFiles, projectFiles, runDetail?.artifact_records, selectedRunId]);

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

  const visibleArtifactRecords = useMemo(() => {
    if (!selectedStepId) {
      return artifactRecords;
    }
    return artifactRecords.filter((item) => relatedArtifactPathsForSelectedStep.has(item.path));
  }, [artifactRecords, relatedArtifactPathsForSelectedStep, selectedStepId]);

  const groupedArtifactRecords = useMemo(
    () => [
      {
        key: "source",
        title: t("projects.artifacts.source", "Source Files"),
        items: visibleArtifactRecords.filter((item) => item.kind === "source"),
      },
      {
        key: "intermediate",
        title: t("projects.artifacts.intermediate", "Intermediate Artifacts"),
        items: visibleArtifactRecords.filter((item) => item.kind === "intermediate"),
      },
      {
        key: "final",
        title: t("projects.artifacts.final", "Final Outputs"),
        items: visibleArtifactRecords.filter((item) => item.kind === "final"),
      },
    ].filter((group) => group.items.length > 0),
    [t, visibleArtifactRecords],
  );

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

  const projectFileCount = useMemo(
    () => projectFiles.filter((file) => !isBuiltInProjectFile(file.path)).length,
    [projectFiles],
  );

  const projectWorkspaceSummary = useMemo(
    () => buildProjectWorkspaceSummary({
      projectName: selectedProject?.name || routeProjectId || "-",
      projectDescription: selectedProject?.description || "",
      workspaceDir: selectedProject?.workspace_dir || currentAgent?.workspace_dir || "",
      sourceFiles: projectFiles.map((item) => item.path),
    }),
    [
      currentAgent?.workspace_dir,
      projectFiles,
      routeProjectId,
      selectedProject?.description,
      selectedProject?.name,
      selectedProject?.workspace_dir,
    ],
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
  ) => {
    setFilesLoading(true);
    setSelectedFilePath("");
    setFileContent("");
    const projectIds = buildProjectIdCandidates(project);
    let loaded = false;
    try {
      for (const projectRequestId of projectIds) {
        try {
          const files = await agentsApi.listProjectFiles(agentId, projectRequestId);
          setProjectFiles(files);
          setResolvedProjectRequestId(projectRequestId);
          const defaultFile = files.find((item) => isPreviewablePath(item.path));
          if (defaultFile) {
            setSelectedFilePath(defaultFile.path);
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
        t("projects.loadFilesFailed", "Failed to load files for this project."),
      );
    } finally {
      setFilesLoading(false);
    }
  }, [t]);

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
    buildProjectIdCandidates,
    loadProjectFiles,
  });

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

  const fetchProjectFileContent = useCallback(async (
    agentId: string,
    project: AgentProjectSummary,
    filePath: string,
  ): Promise<string> => {
    if (selectedFilePath === filePath && fileContent) {
      return fileContent;
    }

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
        return data.content;
      } catch {
        // Try next id candidate.
      }
    }

    throw new Error("project_file_content_not_found");
  }, [fileContent, resolvedProjectRequestId, selectedFilePath]);

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
          if (detail.artifacts.length > 0 && !selectedFilePath) {
            setSelectedFilePath(detail.artifacts[0]);
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
        t("projects.pipeline.loadRunFailed", "Failed to load pipeline run detail."),
      );
    }
  }, [resolvedProjectRequestId, selectedFilePath, t]);

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
        `${t("projects.pipeline.loadFailed", "Failed to load pipeline templates and runs.")} ${(err as Error)?.message || ""}`.trim(),
      );
    } finally {
      setPipelineLoading(false);
    }
  }, [t]);

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
        t("projects.pipeline.loadGlobalFailed", "Failed to load global pipeline templates."),
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
        t("projects.pipeline.importGlobalSuccess", "Global template imported to current project."),
      );
    } catch (err) {
      console.error("failed to import global template", err);
      message.error(
        t("projects.pipeline.importGlobalFailed", "Failed to import global template."),
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
            { template_id: selectedTemplateId },
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

      const prevFocusChatId = runFocusChatIdRef.current;
      if (prevFocusChatId) {
        void chatApi
          .clearChatMeta(prevFocusChatId, {
            user_id: "default",
            channel: "console",
          })
          .catch(() => {});
      }
      void chatApi.createChat({
        name: `[focus] ${selectedProject.name}`,
        session_id: `project-run-${run.id}`,
        user_id: "default",
        channel: "console",
        meta: {
          focus_type: "project_run",
          focus_id: selectedProject.id,
          project_id: selectedProject.id,
          project_request_id: requestProjectId || selectedProject.id,
          run_id: run.id,
          focus_path: `projects/${selectedProject.id}`,
        },
      }).then((chat) => {
        setRunFocusChatId(chat.id);
      }).catch((err) => {
        console.warn("[focus] failed to create project focus chat", err);
      });
    } catch (err) {
      console.error("failed to create pipeline run", err);
      setError(
        t("projects.pipeline.createRunFailed", "Failed to start pipeline run."),
      );
    } finally {
      setCreateRunLoading(false);
    }
  }, [currentAgent, loadPipelineContext, resolvedProjectRequestId, selectedProject, selectedTemplateId, t]);

  const {
    handleEnsureRunChat,
    handleEnsureWorkspaceChat,
  } = useProjectChatEnsureController({
    selectedProject,
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
    startFailedText: t("projects.chat.startFailed", "Failed to start project chat."),
  });

  const { handleEnsureDesignChat } = useProjectDesignChatController({
    activeDesignChatId,
    currentAgent,
    selectedProject,
    selectedTemplateId,
    selectedTemplateName: selectedTemplate?.name || selectedProject?.name || "",
    selectedTemplateVersion: selectedTemplate?.version || "0",
    resolvedProjectRequestId,
    projectFiles,
    designFocusChatIdRef,
    setDesignFocusChatId,
    setChatStarting,
    setError,
    startFailedText: t("projects.chat.startFailed", "Failed to start project chat."),
  });

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

  useEffect(() => {
    if (!currentAgent) {
      void loadAgents();
    }
  }, [currentAgent, loadAgents]);

  useEffect(() => {
    setResolvedProjectRequestId("");
    setProjectFiles([]);
    setSelectedFilePath("");
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
  }, [resetUploadState, routeProjectId]);

  useOpenUploadQuery({
    pathname: location.pathname,
    search: location.search,
    navigate,
    onOpenUpload: () => setUploadModalOpen(true),
  });

  useArtifactSelectionGuards({
    selectedStepId,
    setSelectedStepId,
    currentStepIds,
    selectedFilePath,
    setSelectedFilePath,
    relatedArtifactPathsForSelectedStep,
    artifactRecords,
  });

  useEffect(() => {
    if (!currentAgent || !selectedProject) {
      return;
    }
    void loadProjectFiles(currentAgent.id, selectedProject);
    void loadPipelineContext(currentAgent.id, selectedProject);
  }, [currentAgent, selectedProject, loadProjectFiles, loadPipelineContext]);

  useEffect(() => {
    if (!currentAgent || !selectedProject || !selectedFilePath) {
      return;
    }
    void loadFileContent(currentAgent.id, selectedProject, selectedFilePath);
  }, [currentAgent, selectedProject, selectedFilePath, loadFileContent]);

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

    setSelectedRunId((prev) =>
      runsForSelectedTemplate.some((item) => item.id === prev)
        ? prev
        : runsForSelectedTemplate[0].id,
    );
  }, [runsForSelectedTemplate, selectedTemplateId]);

  useEffect(() => {
    if (!selectedRunId) {
      setRunDetail(null);
    }
  }, [selectedRunId]);

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
        t("projects.deleteSuccess", "Project deleted: {{name}}", {
          name: selectedProject.name || selectedProject.id,
        }),
      );
      await loadAgents();
      navigate("/projects");
    } catch (err) {
      console.error("failed to delete project", err);
      message.error(t("projects.deleteFailed", "Failed to delete project."));
    } finally {
      setDeletingProject(false);
    }
  }, [currentAgent, loadAgents, navigate, selectedProject, t]);

  const handleSelectArtifactFile = useCallback((path: string) => {
    setSelectedFilePath(path);
  }, []);

  const buildAttachContentBySize = useCallback((params: {
    path: string;
    fileName: string;
    size: number;
    content: string;
  }): string => {
    const { path, fileName, size, content } = params;
    if (size <= INLINE_FULL_MAX_BYTES) {
      return content;
    }

    if (size <= INLINE_TRUNCATE_MAX_BYTES) {
      const head = content.slice(0, INLINE_TRUNCATE_HEAD_CHARS);
      const tail = content.slice(-INLINE_TRUNCATE_TAIL_CHARS);
      return [
        `[Truncated file for context window control]`,
        `file: ${fileName}`,
        `path: ${path}`,
        `size: ${size} bytes`,
        `--- HEAD ---`,
        head,
        `--- TAIL ---`,
        tail,
      ].join("\n");
    }

    return [
      `[Large file metadata only to avoid context overflow]`,
      `file: ${fileName}`,
      `path: ${path}`,
      `size: ${size} bytes`,
      `note: use this file name/path as reference and request focused extraction if needed.`,
    ].join("\n");
  }, []);

  const handleAttachArtifactToChat = useCallback((path: string) => {
    setSelectedAttachPaths((prev) =>
      prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path],
    );
  }, [
    setSelectedAttachPaths,
  ]);

  const handleSendSelectedFilesToChat = useCallback(async () => {
    if (!currentAgent || !selectedProject || selectedAttachPaths.length === 0) {
      return;
    }

    setSendingSelectedFiles(true);
    try {
      if (selectedRunId) {
        await handleEnsureRunChat();
      } else {
        await handleEnsureDesignChat();
      }

      if (!autoAnalyzeOnAttach) {
        const selectedFiles = selectedAttachPaths.map((path) => {
          const fileInfo = projectFiles.find((file) => file.path === path);
          return {
            path,
            size: fileInfo?.size || 0,
          };
        });
        setAutoAttachRequest({
          id: `manual-batch-draft-${Date.now()}`,
          mode: "draft",
          note: buildAttachDraftPrompt({
            projectName: selectedProject.name,
            selectedRunId,
            selectedFiles,
          }),
        });
        message.success(
          t(
            "projects.chat.attachDraftReady",
            "Prepared selected file context in the chat input box.",
          ),
        );
        setSelectedAttachPaths([]);
        return;
      }

      const filesPayload: Array<{ fileName: string; content: string; mimeType?: string }> = [];
      let remainingChars = INLINE_TOTAL_CHAR_BUDGET;

      for (const path of selectedAttachPaths) {
        const fileInfo = projectFiles.find((file) => file.path === path);
        const fileName = path.split("/").pop() || "project-file.txt";
        const size = fileInfo?.size || 0;

        if (remainingChars <= 0) {
          filesPayload.push({
            fileName,
            content: buildAttachContentBySize({ path, fileName, size, content: "" }),
            mimeType: "text/plain",
          });
          continue;
        }

        if (size > INLINE_TRUNCATE_MAX_BYTES) {
          filesPayload.push({
            fileName,
            content: buildAttachContentBySize({ path, fileName, size, content: "" }),
            mimeType: "text/plain",
          });
          remainingChars = Math.max(0, remainingChars - 300);
          continue;
        }

        const rawContent = await fetchProjectFileContent(currentAgent.id, selectedProject, path);
        const prepared = buildAttachContentBySize({ path, fileName, size, content: rawContent });
        const finalContent =
          prepared.length <= remainingChars
            ? prepared
            : `${prepared.slice(0, Math.max(800, remainingChars))}\n\n[Trimmed by total context budget]`;
        filesPayload.push({
          fileName,
          content: finalContent,
          mimeType: inferMimeTypeByPath(path),
        });
        remainingChars = Math.max(0, remainingChars - finalContent.length);
      }

      setAutoAttachRequest({
        id: `manual-batch-${Date.now()}`,
        mode: "submit",
        files: filesPayload,
        note: buildAutoAttachAnalysisPrompt({
          projectName: selectedProject.name,
          fileNames: filesPayload.map((item) => item.fileName),
          selectedRunId,
        }),
      });

      message.success(
        t("projects.chat.autoAttachBatchSent", "Queued {{count}} selected file(s) for chat.", {
          count: filesPayload.length,
        }),
      );
      setSelectedAttachPaths([]);
    } catch (err) {
      console.error("failed to send selected files to chat", err);
      message.error(
        t("projects.chat.autoAttachFailed", "Failed to attach selected file to chat."),
      );
    } finally {
      setSendingSelectedFiles(false);
    }
  }, [
    buildAttachContentBySize,
    currentAgent,
    fetchProjectFileContent,
    handleEnsureDesignChat,
    handleEnsureRunChat,
    projectFiles,
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

    const chatId = await handleEnsureDesignChat(false, true);
    if (!chatId) {
      message.error(t("projects.chat.startFailed", "Failed to start project chat."));
      return;
    }

    setAutoAttachRequest({
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
    });
    message.success(
      t(
        "projects.chat.implDraftReady",
        "Implementation prompt has been prepared in the design chat input.",
      ),
    );
  }, [
    handleEnsureDesignChat,
    latestRunForSelectedTemplate?.status,
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

    const chatId = await handleEnsureRunChat(false);
    if (!chatId) {
      message.error(t("projects.chat.startFailed", "Failed to start project chat."));
      return;
    }

    setAutoAttachRequest({
      id: `flow-validate-${Date.now()}`,
      mode: "draft",
      note: buildValidationRoundPrompt({
        projectName: selectedProject.name,
        runId: selectedRunId,
        templateName: selectedTemplate?.name || selectedTemplateId || "draft",
        gateSummary: verificationGateSummary,
      }),
    });
    message.success(
      t(
        "projects.chat.validationDraftReady",
        "Validation prompt has been prepared in the run chat input.",
      ),
    );
  }, [
    handleEnsureRunChat,
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

    const chatId = await handleEnsureDesignChat(false, true);
    if (!chatId) {
      message.error(t("projects.chat.startFailed", "Failed to start project chat."));
      return;
    }

    setAutoAttachRequest({
      id: `flow-promote-${Date.now()}`,
      mode: "draft",
      note: buildPromotionDraftPrompt({
        projectName: selectedProject.name,
        templateName: selectedTemplate?.name || selectedTemplateId,
        templateId: selectedTemplateId,
        runId: selectedRunId,
      }),
    });
    message.success(
      t(
        "projects.chat.promotionDraftReady",
        "Promotion draft prompt has been prepared in the design chat input.",
      ),
    );
  }, [
    handleEnsureDesignChat,
    selectedProject,
    selectedRunId,
    selectedTemplate?.name,
    selectedTemplateId,
    t,
  ]);

  return (
    <div className={styles.agentsPage}>
      <div className={styles.header}>
        <div>
          <Title level={4} className={styles.title}>
            {t("projects.detailTitle", "Project Detail")}
          </Title>
          <Text type="secondary" className={styles.description}>
            {t(
              "projects.detailDescription",
              "Inspect artifacts, pipeline runs, and execution evidence for this project.",
            )}
          </Text>
        </div>
        <div className={styles.headerActions}>
          {selectedProject ? (
            <>
              <Button size="small" onClick={() => setUploadModalOpen(true)}>
                {t("projects.upload.button", "Upload Files")}
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

      <div className={styles.workspaceInfo}>
        <p className={styles.workspacePath}>
          {t("projects.workspacePath", "Workspace Path")}: {" "}
          {selectedProject?.workspace_dir ||
            currentAgent?.workspace_dir ||
            t("projects.noAgent", "No agent is currently available.")}
        </p>
      </div>

      {loading && !currentAgent ? (
        <div className={styles.centerState}>
          <Spin />
        </div>
      ) : !currentAgent ? (
        <Empty description={t("projects.noAgent", "No agent is currently available.")} />
      ) : projects.length === 0 ? (
        <Empty description={t("projects.noProjects", "No projects in this workspace yet.")} />
      ) : !selectedProject ? (
        <Card>
          <Empty
            description={t("projects.notFound", "Project not found in current workspace")}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          >
            <Button onClick={() => navigate("/projects")}>
              {t("projects.backToList", "Back to project list")}
            </Button>
          </Empty>
        </Card>
      ) : (
        <div className={styles.content}>
          <div className={styles.columnLeft}>
            <ProjectOverviewCard
              selectedProject={selectedProject}
              projectFileCount={projectFileCount}
              pipelineTemplateCount={pipelineTemplates.length}
              pipelineRunCount={pipelineRuns.length}
              projectWorkspaceSummary={projectWorkspaceSummary}
              onStartCollaboration={() => {
                setDesignFocusChatId("");
                void handleEnsureWorkspaceChat(true);
              }}
              onUploadFiles={() => setUploadModalOpen(true)}
            />
          </div>

          <div className={styles.columnMiddle}>
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
              onBackToList={() => navigate("/projects")}
              onUploadFiles={() => setUploadModalOpen(true)}
              onOpenImportModal={() => {
                void handleOpenImportModal();
              }}
              onCreateRun={() => {
                void handleCreateRun();
              }}
              onStartAutomation={() => {
                setWorkspaceFocusChatId("");
                void handleEnsureDesignChat(true);
              }}
              onPrepareImplementationDraft={() => {
                void handlePrepareImplementationDraft();
              }}
              onPrepareValidationDraft={() => {
                void handlePrepareValidationDraft();
              }}
              onPreparePromotionDraft={() => {
                void handlePreparePromotionDraft();
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

            <ProjectUploadModal
              open={uploadModalOpen}
              uploadingFiles={uploadingFiles}
              pendingUploads={pendingUploads}
              uploadTargetDir={uploadTargetDir}
              onChangeUploadTargetDir={setUploadTargetDir}
              onChangePendingUploads={setPendingUploads}
              onUpload={() => {
                void handleUploadFiles();
              }}
              onCancel={() => setUploadModalOpen(false)}
            />

          </div>

          <div className={styles.columnRight}>
            <ProjectWorkbenchPanel
              projectLabel={selectedProject?.id || routeProjectId}
              filesLoading={filesLoading}
              contentLoading={contentLoading}
              hideBuiltInFiles={hideBuiltInFiles}
              artifactRecords={artifactRecords}
              groupedArtifactRecords={groupedArtifactRecords}
              selectedArtifactRecord={selectedArtifactRecord}
              selectedFilePath={selectedFilePath}
              selectedStepId={selectedStepId}
              relatedArtifactPathsForSelectedStep={relatedArtifactPathsForSelectedStep}
              projectFiles={projectFiles}
              fileContent={fileContent}
              selectedAttachPaths={selectedAttachPaths}
              autoAnalyzeOnAttach={autoAnalyzeOnAttach}
              sendingSelectedFiles={sendingSelectedFiles}
              runDetail={runDetail}
              runProgress={runProgress}
              onToggleHideBuiltInFiles={setHideBuiltInFiles}
              onClearArtifactFocus={() => {
                setSelectedStepId("");
                setSelectedFilePath("");
              }}
              onSelectArtifactFile={(path) => {
                void handleSelectArtifactFile(path);
              }}
              onAttachArtifactToChat={(path) => {
                void handleAttachArtifactToChat(path);
              }}
              onSelectStep={handleSelectStep}
              onToggleAutoAnalyze={setAutoAnalyzeOnAttach}
              onSendSelectedFilesToChat={() => {
                void handleSendSelectedFilesToChat();
              }}
              statusTagColor={statusTagColor}
              formatBytes={formatBytes}
            />
          </div>

          <div className={styles.columnChat}>
            <ProjectChatPanel
              selectedRunId={selectedRunId}
              chatStarting={chatStarting}
              activeWorkspaceChatId={activeWorkspaceChatId}
              activeDesignChatId={activeDesignChatId}
              activeRunChatId={activeRunChatId}
              autoAttachRequest={autoAttachRequest}
              onAutoAttachHandled={(payload) => {
                setAutoAttachRequest((prev) => (prev?.id === payload.id ? null : prev));
              }}
              onStartWorkspaceChat={() => {
                setDesignFocusChatId("");
                void handleEnsureWorkspaceChat(true);
              }}
              onStartDesignChat={() => {
                setWorkspaceFocusChatId("");
                void handleEnsureDesignChat(true);
              }}
              onStartRunChat={() => {
                void handleEnsureRunChat(true);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
