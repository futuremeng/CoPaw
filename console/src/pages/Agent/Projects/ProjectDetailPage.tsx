import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Modal,
  Popconfirm,
  Select,
  Spin,
  Tabs,
  Typography,
  message,
} from "antd";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { agentsApi } from "../../../api/modules/agents";
import { chatApi } from "../../../api/modules/chat";
import ProjectAutomationPanel from "./ProjectAutomationPanel";
import ProjectChatPanel, {
  type ProjectChatAutoAttachRequest,
  type ProjectChatMode,
} from "./ProjectChatPanel";
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
import useProjectUploadController from "./useProjectUploadController";
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
import type {
  AgentProjectSummary,
  AgentProjectFileInfo,
  ProjectPipelineArtifactRecord,
  ProjectPipelineNextAction,
  ProjectPipelineRunDetail,
  ProjectPipelineRunSummary,
  ProjectPipelineTemplateInfo,
  PlatformFlowTemplateInfo,
  AgentSummary,
} from "../../../api/types/agents";
import type { ChatSpec } from "../../../api/types/chat";
import { useAgentStore } from "../../../stores/agentStore";
import styles from "./index.module.less";

const { Text } = Typography;

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

function isBuiltInProjectFile(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  const fileName = normalized.split("/").pop() || "";
  if (fileName === "project.md" || fileName === "heartbeat.md") {
    return true;
  }
  return false;
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
  const runFocusChatIdRef = useRef("");
  const workspaceFocusChatIdRef = useRef("");
  const designFocusChatIdRef = useRef("");
  const runRestoreAttemptKeyRef = useRef("");
  const automationDrawerAutoOpenKeyRef = useRef("");

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

  const automationSummaryText = useMemo(() => {
    if (pipelineLoading) {
      return t("projects.automationSummary.loading");
    }
    if (!selectedTemplateId) {
      return t("projects.automationSummary.noTemplate");
    }
    if (!selectedRunSummary) {
      return t("projects.automationSummary.noRun");
    }
    return t("projects.automationSummary.latest", {
      runId: selectedRunSummary.id,
      status: selectedRunSummary.status || "unknown",
    });
  }, [pipelineLoading, selectedRunSummary, selectedTemplateId, t]);

  const projectFileCount = useMemo(
    () => projectFiles.filter((file) => !isBuiltInProjectFile(file.path)).length,
    [projectFiles],
  );

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
    () => selectSeedSourceFiles(projectFiles.map((item) => item.path)),
    [projectFiles],
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
          const filteredFiles = files.filter(
            (item) => !isIgnoredProjectFile(item.path),
          );
          setProjectFiles(filteredFiles);
          setResolvedProjectRequestId(projectRequestId);
          const defaultFile = filteredFiles.find((item) =>
            isPreviewablePath(item.path),
          );
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
        t("projects.loadFilesFailed"),
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
    loadProjectFiles,
  });

  const uploadModalHint = useMemo(() => {
    if (selectedRunId) {
      return `${t("projects.upload.batchHint", { runId: selectedRunId })} ${t("projects.upload.batchBehaviorHint")}`;
    }
    return `${t("projects.upload.defaultHint")} ${t("projects.upload.batchBehaviorHint")}`;
  }, [selectedRunId, t]);

  const openProjectUploadModal = useCallback(() => {
    setPendingUploads([]);
    setUploadTargetDir("original");
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
    projectFiles,
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
    void handleEnsureWorkspaceChat(true);
  }, [handleEnsureWorkspaceChat]);

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

      applyWorkspaceChatFocus(target.id);
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
    applyWorkspaceChatFocus,
    manualRecoverCandidates,
    manualRecoverChatId,
    resolvedProjectRequestId,
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
    resetPreferredWorkspaceChatBinding();
  }, [resetPreferredWorkspaceChatBinding, resetUploadState, routeProjectId]);

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
    projectFiles,
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
    setSelectedFilePath(path);
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
      const targetChatId = await ensureVisibleProjectChat();
      if (!targetChatId) {
        message.error(t("projects.chat.startFailed"));
        return;
      }

      const selectedFiles = selectedAttachPaths.map((path) => {
        const fileInfo = projectFiles.find((file) => file.path === path);
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
    projectFiles,
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
        <div className={styles.content}>
          <div className={styles.columnLeft}>
            <div className={styles.columnStack}>
              <ProjectOverviewCard
                selectedProject={selectedProject}
                projectFileCount={projectFileCount}
                pipelineTemplateCount={pipelineTemplates.length}
                pipelineRunCount={pipelineRuns.length}
                projectWorkspaceSummary={projectWorkspaceSummary}
                projectFiles={projectFiles}
                priorityFilePaths={priorityFilePaths}
                selectedFilePath={selectedFilePath}
                selectedAttachPaths={selectedAttachPaths}
                hideBuiltInFiles={hideBuiltInFiles}
                onUploadFiles={openProjectUploadModal}
                onSelectFileFromTree={(path) => {
                  void handleSelectArtifactFile(path);
                }}
                onAttachArtifactToChat={(path) => {
                  void handleAttachArtifactToChat(path);
                }}
                onToggleHideBuiltInFiles={setHideBuiltInFiles}
              />

              <Card
                size="small"
                title={t("projects.automationDrawer.title")}
                className={styles.automationSummaryCard}
                extra={(
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => setAutomationDrawerOpen(true)}
                  >
                    {t("projects.automationDrawer.open")}
                  </Button>
                )}
              >
                <div className={styles.automationSummaryMeta}>
                  <Text type="secondary">{automationSummaryText}</Text>
                  <Text type="secondary">
                    {t("projects.automationSummary.counts", {
                      templateCount: pipelineTemplates.length,
                      runCount: pipelineRuns.length,
                    })}
                  </Text>
                </div>
              </Card>
            </div>
          </div>

          <div className={styles.columnRight}>
            <ProjectWorkbenchPanel
              projectLabel={selectedProject?.id || routeProjectId}
              filesLoading={filesLoading}
              contentLoading={contentLoading}
              artifactRecords={artifactRecords}
              selectedArtifactRecord={selectedArtifactRecord}
              selectedFilePath={selectedFilePath}
              projectFiles={projectFiles}
              fileContent={fileContent}
              selectedAttachPaths={selectedAttachPaths}
              autoAnalyzeOnAttach={autoAnalyzeOnAttach}
              sendingSelectedFiles={sendingSelectedFiles}
              onToggleAutoAnalyze={setAutoAnalyzeOnAttach}
              onSendSelectedFilesToChat={() => {
                void handleSendSelectedFilesToChat();
              }}
              formatBytes={formatBytes}
            />
          </div>

          <div className={styles.columnChat}>
            <ProjectChatPanel
              projectFileCount={projectFileCount}
              chatMode={projectChatMode}
              selectedRunId={selectedRunId}
              chatStarting={chatStarting}
              activeWorkspaceChatId={activeWorkspaceChatId}
              activeDesignChatId={activeDesignChatId}
              activeRunChatId={activeRunChatId}
              autoAttachRequest={autoAttachRequest}
              onAutoAttachHandled={(payload) => {
                window.requestAnimationFrame(() => {
                  setAutoAttachRequest((prev) => (prev?.id === payload.id ? null : prev));
                });
              }}
              onStartWorkspaceChat={handleStartWorkspaceChat}
              onStartDesignChat={handleStartDesignChat}
              onStartRunChat={handleStartRunChat}
              onSelectWorkspaceHistoryChat={applyWorkspaceChatFocus}
              onSelectDesignHistoryChat={selectDesignChatSession}
              onSelectRunHistoryChat={selectRunChatSession}
              onOpenManualRecoverDialog={() => {
                void handleOpenManualRecoverDialog();
              }}
            />
          </div>

          <Drawer
            title={t("projects.automationDrawer.title")}
            placement="right"
            width="min(80vw, 1280px)"
            open={automationDrawerOpen}
            onClose={() => setAutomationDrawerOpen(false)}
            destroyOnHidden={false}
          >
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
                items={[
                  {
                    key: "metrics",
                    label: t("projects.metrics"),
                    children: (
                      <ProjectMetricsPanel
                        runDetail={runDetail}
                        runProgress={runProgress}
                        statusTagColor={statusTagColor}
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
        </div>
      )}
    </div>
  );
}
