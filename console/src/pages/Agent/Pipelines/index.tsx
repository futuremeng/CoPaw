import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Empty, Modal, Select, Spin, Tag, Typography, message } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { agentsApi } from "../../../api/modules/agents";
import { providerApi } from "../../../api/modules/provider";
import { agentApi } from "../../../api/modules/agent";
import { chatApi } from "../../../api/modules/chat";
import AnywhereChat from "../../../components/AnywhereChat";
import sessionApi from "../../Chat/sessionApi";
import {
  buildPipelineDesignBindingKey,
  buildPipelineDesignBootstrapPrompt,
  buildPipelineDesignChatPath,
  buildPipelineDesignEditContextPrompt,
} from "../../../utils/pipelineDesign";
import {
  buildInitialStepProposalPrompt,
  buildIncrementalStepGenerationPrompt,
  buildIncrementalStepEditPrompt,
  buildJsonRepairPrompt,
  parseStepProposalFromAIResponse,
  parseStepFromAIResponse,
  parseStepOperationFromAIResponse,
} from "../../../utils/pipelineStepGeneration";
import {
  derivePipelineExecutionBudget,
} from "../../../utils/pipelineModelBudget";
import { trackNavigation } from "../../../utils/navigationTelemetry";
import type {
  AgentProjectSummary,
  AgentSummary,
  PipelineValidationError,
  ProjectPipelineTemplateStep,
  ProjectPipelineRunSummary,
  ProjectPipelineTemplateInfo,
} from "../../../api/types/agents";
import type { ActiveModelsInfo, ProviderInfo } from "../../../api/types/provider";
import type { AgentsRunningConfig } from "../../../api/types/agent";
import type { ChatSpec } from "../../../api/types/chat";
import { useAgentStore } from "../../../stores/agentStore";
import styles from "./index.module.less";

const { Title, Text } = Typography;

type TemplateItem = ProjectPipelineTemplateInfo & {
  projectId: string;
  projectName: string;
};

type RunItem = ProjectPipelineRunSummary & {
  projectId: string;
  projectName: string;
};

type PipelineManagementData = {
  templates: TemplateItem[];
  runs: RunItem[];
};

type PersistedPipelineDraftState = {
  version: 1;
  templates: TemplateItem[];
  draftPipelineKeys: string[];
  selectedPipelineKey: string;
  selectedCurrentVersion: string;
  selectedCompareVersion: string;
  sourceFilter: "all" | "independent" | "project";
  draftNewVersionSteps: ProjectPipelineTemplateStep[];
  draftParseStatus: "idle" | "ready" | "error";
  draftParseError: string;
};

type PipelineGroup = {
  key: string;
  id: string;
  name: string;
  description: string;
  versions: ProjectPipelineTemplateInfo[];
  projects: { id: string; name: string }[];
  source: "independent" | "project";
};

type StepDiffItem = {
  id: string;
  kind: "added" | "removed" | "changed" | "unchanged";
  current?: { name: string; kind: string; description: string };
  compare?: { name: string; kind: string; description: string };
  changedFields: string[];
};

type EditChatTarget = {
  pipelineId: string;
  pipelineName: string;
  version: string;
  isEmptyNodes: boolean;
  description?: string;
  steps?: ProjectPipelineTemplateStep[];
  source?: "independent" | "project";
};

type PipelineSaveConflictInfo = {
  expectedRevision: number;
  currentRevision: number;
  currentContentHash: string;
};

type PipelineChatBindingMeta = {
  focus_type: "pipeline_edit";
  focus_binding_key: string;
  focus_id: string;
  focus_path: string;
  focus_scope: "independent" | "project";
  focus_flow_memory_path?: string;
  // Legacy compatibility fields
  binding_type: "pipeline_edit";
  pipeline_binding_key: string;
  pipeline_id: string;
  pipeline_name: string;
  pipeline_version: string;
  pipeline_scope: "independent" | "project";
  agent_id: string;
  flow_memory_path?: string;
};

type IncrementalGenerationState = {
  active: boolean;
  mode: "create" | "modify";
  createStage: "ask_strategy" | "stepwise" | "proposal" | "await_confirm" | "applying";
  createStrategy: "stepwise" | "plan_then_refine" | null;
  plannedSteps: ProjectPipelineTemplateStep[];
  totalStepsExpected: number;
  currentStep: number;
  userRequirements: string;
  lastUserRequest: string;
  lastSyntheticPrompt: string;
  operationsApplied: number;
  parseRetryCount: number;
  /** Revision number of the last successfully applied step operation; used for failure recovery. */
  lastSuccessfulRevision?: number;
};

type PipelinePageTestHooks = {
  activateIncrementalModify: (overrides?: Partial<IncrementalGenerationState>) => void;
  completeAssistantTurn: (text: string) => Promise<void>;
  getDraftStepIds: () => string[];
};

declare global {
  interface Window {
    __COPAW_ENABLE_TEST_HOOKS__?: boolean;
    __COPAW_PIPELINES_TEST__?: PipelinePageTestHooks;
  }
}

const INDEPENDENT_PIPELINE_SCOPE_ID = "__independent__";
const PIPELINE_DRAFT_STORAGE_PREFIX = "copaw:pipelines:drafts:";

const CREATE_PLAN_CONFIRM_PATTERN =
  /^(确认|确认创建|确认执行|开始创建|开始执行|开始吧|同意|可以|没问题|好|ok|okay|yes|confirm|approved|looks good|go ahead|proceed)\b/i;

const CREATE_STRATEGY_STEPWISE_PATTERN =
  /(一个节点一个节点|逐个节点|逐步添加|边做边加|step by step|one by one|逐节点)/i;

const CREATE_STRATEGY_PLAN_PATTERN =
  /(一次性|整体规划|先规划|先出方案|先做完节点规划|plan first|proposal first|整体方案|先整体后细化)/i;

function inferStepCountFromRequirements(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;

  const explicitCount = normalized.match(/(?:包含以下|包含|共|共计)?\s*(\d+)\s*个步骤/);
  if (explicitCount) {
    return Math.max(1, Number(explicitCount[1]) || 0);
  }

  const numberedSteps = normalized.match(/第\s*\d+\s*步/g);
  if (numberedSteps && numberedSteps.length > 0) {
    return numberedSteps.length;
  }

  return 4;
}

function isCreatePlanConfirmed(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  if (CREATE_PLAN_CONFIRM_PATTERN.test(normalized)) return true;
  if (normalized.includes("确认") && (normalized.includes("流程") || normalized.includes("节点"))) {
    return true;
  }
  if (normalized.includes("confirm") && (normalized.includes("plan") || normalized.includes("steps"))) {
    return true;
  }
  return false;
}

function detectCreateStrategy(
  text: string,
): "stepwise" | "plan_then_refine" | null {
  const normalized = text.trim();
  if (!normalized) return null;
  if (CREATE_STRATEGY_STEPWISE_PATTERN.test(normalized)) return "stepwise";
  if (CREATE_STRATEGY_PLAN_PATTERN.test(normalized)) return "plan_then_refine";
  return null;
}

function buildCreateStrategySelectionPrompt(userRequirements: string): string {
  return [
    "你想做的流程主题已收到：",
    userRequirements || "（未提供）",
    "",
    "请二选一确认创建策略：",
    "1) 一个节点一个节点加（逐步生成并写入）",
    "2) 一次性做完节点规划，再逐个改并写入",
    "",
    "请直接回复“1”或“2”，也可以回复“逐节点”或“先规划”。",
  ].join("\n");
}

function extractTextFromChatContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => extractTextFromChatContent(item))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text.trim();
    }
    if (record.content !== undefined) {
      return extractTextFromChatContent(record.content);
    }
  }

  return "";
}

function mergeTemplateUpdate(
  items: TemplateItem[],
  updated: ProjectPipelineTemplateInfo,
): TemplateItem[] {
  return items.map((item) => {
    if (item.id !== updated.id) {
      return item;
    }

    return {
      ...item,
      ...updated,
    };
  });
}

function isIncrementalUserMessage(
  latestUserMessage: string,
  workflow: IncrementalGenerationState,
): boolean {
  const normalized = latestUserMessage.trim();
  if (!normalized) return false;
  if (normalized === workflow.lastSyntheticPrompt.trim()) return false;
  if (workflow.active && normalized === workflow.lastUserRequest.trim()) return false;
  return normalized !== workflow.lastSyntheticPrompt.trim();
}

function getPipelineDraftStorageKey(agentId: string): string {
  return `${PIPELINE_DRAFT_STORAGE_PREFIX}${agentId}`;
}

function readPipelineDraftState(agentId: string): PersistedPipelineDraftState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(getPipelineDraftStorageKey(agentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedPipelineDraftState;

    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.templates)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writePipelineDraftState(agentId: string, state: PersistedPipelineDraftState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getPipelineDraftStorageKey(agentId), JSON.stringify(state));
  } catch {
    // Ignore localStorage quota or serialization failures.
  }
}

function clearPipelineDraftState(agentId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(getPipelineDraftStorageKey(agentId));
  } catch {
    // Ignore storage cleanup failures.
  }
}

function getTemplateSourceKind(item: TemplateItem): "independent" | "project" {
  return item.projectId === INDEPENDENT_PIPELINE_SCOPE_ID ? "independent" : "project";
}

function buildPipelineGroupKey(
  templateId: string,
  source: "independent" | "project",
): string {
  return `${templateId}::${source}`;
}

async function loadPipelineManagementData(
  agentId: string,
  projectList: AgentProjectSummary[],
  independentScopeLabel: string,
): Promise<PipelineManagementData> {
  const [perProject, agentTemplates] = await Promise.all([
    Promise.all(
      projectList.map(async (project) => {
        const [templatesResult, runsResult] = await Promise.allSettled([
          agentsApi.listProjectPipelineTemplates(agentId, project.id),
          agentsApi.listProjectPipelineRuns(agentId, project.id),
        ]);

        return {
          project,
          templates:
            templatesResult.status === "fulfilled"
              ? templatesResult.value
              : [],
          runs: runsResult.status === "fulfilled" ? runsResult.value : [],
        };
      }),
    ),
    agentsApi.listAgentPipelineTemplates(agentId).catch(() => []),
  ]);

  const templates: TemplateItem[] = [
    ...agentTemplates.map((tpl) => ({
      ...tpl,
      projectId: INDEPENDENT_PIPELINE_SCOPE_ID,
      projectName: independentScopeLabel,
    })),
    ...perProject.flatMap((item) =>
      item.templates.map((tpl) => ({
        ...tpl,
        projectId: item.project.id,
        projectName: item.project.name,
      })),
    ),
  ];

  const runs: RunItem[] = perProject
    .flatMap((item) =>
      item.runs.map((run) => ({
        ...run,
        projectId: item.project.id,
        projectName: item.project.name,
      })),
    )
    .sort((a, b) =>
      (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at),
    );

  return { templates, runs };
}

function statusTagColor(status: string): string {
  switch (status) {
    case "running":
      return "processing";
    case "succeeded":
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

function getCurrentAgent(
  agents: AgentSummary[],
  selectedAgent: string,
): AgentSummary | undefined {
  return agents.find((agent) => agent.id === selectedAgent);
}

function buildPipelineEntrySessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeVersion(version: string): string {
  return version.trim() || "0";
}

function getMetaString(meta: Record<string, unknown> | undefined, key: string): string {
  const value = meta?.[key];
  return typeof value === "string" ? value : "";
}

function buildPipelineWorkspaceRelativePath(pipelineId: string): string {
  return `pipelines/workspaces/${pipelineId}`;
}

function buildPipelineChatBindingMeta(params: {
  pipelineId: string;
  pipelineName: string;
  version: string;
  scope: "independent" | "project";
  agentId?: string;
  flowMemoryPath?: string;
}): PipelineChatBindingMeta {
  const normalizedVersion = normalizeVersion(params.version);
  const bindingKey = buildPipelineDesignBindingKey({
    pipelineId: params.pipelineId,
    version: normalizedVersion,
  });
  const focusPath = buildPipelineWorkspaceRelativePath(params.pipelineId);
  return {
    focus_type: "pipeline_edit",
    focus_binding_key: bindingKey,
    focus_id: params.pipelineId,
    focus_path: focusPath,
    focus_scope: params.scope,
    focus_flow_memory_path: params.flowMemoryPath,
    // Legacy compatibility fields
    binding_type: "pipeline_edit",
    pipeline_binding_key: bindingKey,
    pipeline_id: params.pipelineId,
    pipeline_name: params.pipelineName,
    pipeline_version: normalizedVersion,
    pipeline_scope: params.scope,
    agent_id: params.agentId || "unknown",
    flow_memory_path: params.flowMemoryPath,
  };
}

function buildPipelineFlowMemoryRelativePath(pipelineId: string): string {
  return `${buildPipelineWorkspaceRelativePath(pipelineId)}/flow-memory.md`;
}

function extractPipelineConflictInfo(detail: unknown): PipelineSaveConflictInfo | null {
  if (!detail || typeof detail !== "object") return null;
  const obj = detail as Record<string, unknown>;
  if (obj.code !== "pipeline_revision_conflict") return null;
  const expectedRevision = Number(obj.expected_revision || 0);
  const currentRevision = Number(obj.current_revision || 0);
  const currentContentHash = typeof obj.current_content_hash === "string"
    ? obj.current_content_hash
    : "";
  return {
    expectedRevision,
    currentRevision,
    currentContentHash,
  };
}

function extractPipelineDetailFromError(error: unknown): Record<string, unknown> | null {
  const text = error instanceof Error ? error.message : String(error);
  const marker = " - ";
  const idx = text.indexOf(marker);
  if (idx < 0) return null;
  const maybeJson = text.slice(idx + marker.length).trim();
  try {
    const parsed = JSON.parse(maybeJson) as Record<string, unknown>;
    const detail = parsed.detail;
    if (detail && typeof detail === "object") {
      return detail as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function stepsFingerprint(steps: ProjectPipelineTemplateStep[]): string {
  return JSON.stringify(
    steps.map((step) => ({
      id: step.id,
      name: step.name,
      kind: step.kind,
      description: step.description || "",
    })),
  );
}

function mergeDraftStepsByStepId(
  remoteSteps: ProjectPipelineTemplateStep[],
  localSteps: ProjectPipelineTemplateStep[],
): ProjectPipelineTemplateStep[] {
  const localMap = new Map(localSteps.map((step) => [step.id, step] as const));

  const merged: ProjectPipelineTemplateStep[] = [];

  // Keep remote order as baseline, then overlay local edits for matching ids.
  remoteSteps.forEach((remoteStep) => {
    const localStep = localMap.get(remoteStep.id);
    if (localStep) {
      merged.push({
        ...remoteStep,
        name: localStep.name || remoteStep.name,
        kind: localStep.kind || remoteStep.kind,
        description: localStep.description || remoteStep.description,
      });
      localMap.delete(remoteStep.id);
      return;
    }
    merged.push(remoteStep);
  });

  // Append local-only steps that do not exist remotely.
  localMap.forEach((localOnly) => {
    merged.push(localOnly);
  });

  return merged;
}

function compareSemverDesc(a: string, b: string): number {
  const parsePart = (value: string): number => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  };

  const partsA = normalizeVersion(a)
    .split(".")
    .map((part) => parsePart(part.replace(/[^0-9]/g, "")));
  const partsB = normalizeVersion(b)
    .split(".")
    .map((part) => parsePart(part.replace(/[^0-9]/g, "")));

  const length = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (partsB[i] || 0) - (partsA[i] || 0);
    if (diff !== 0) return diff;
  }
  return normalizeVersion(b).localeCompare(normalizeVersion(a), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function stepComparable(step: { name: string; kind: string; description: string }): string {
  return `${step.name}|${step.kind}|${step.description}`;
}

type DiffFieldKey = "name" | "kind" | "description";

type InlineDiffToken = {
  text: string;
  changed: boolean;
};

function getStepFieldValue(
  step: StepDiffItem["current"] | StepDiffItem["compare"],
  field: DiffFieldKey,
): string {
  if (!step) return "-";
  const value = step[field];
  return value && value.trim() ? value : "-";
}

function tokenizeInlineDiff(value: string): string[] {
  if (!value) return [];
  return value.split(/(\s+)/).filter((part) => part.length > 0);
}

function buildInlineDiffTokens(
  oldValue: string,
  newValue: string,
): { oldTokens: InlineDiffToken[]; newTokens: InlineDiffToken[] } {
  if (oldValue === newValue) {
    return {
      oldTokens: [{ text: oldValue || "-", changed: false }],
      newTokens: [{ text: newValue || "-", changed: false }],
    };
  }

  const oldWords = tokenizeInlineDiff(oldValue);
  const newWords = tokenizeInlineDiff(newValue);

  if (oldWords.length === 0 || newWords.length === 0) {
    return {
      oldTokens: [{ text: oldValue || "-", changed: true }],
      newTokens: [{ text: newValue || "-", changed: true }],
    };
  }

  const m = oldWords.length;
  const n = newWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      if (oldWords[i] === newWords[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const oldMatched = new Array(m).fill(false);
  const newMatched = new Array(n).fill(false);

  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldWords[i] === newWords[j]) {
      oldMatched[i] = true;
      newMatched[j] = true;
      i += 1;
      j += 1;
      continue;
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return {
    oldTokens: oldWords.map((text, idx) => ({ text, changed: !oldMatched[idx] })),
    newTokens: newWords.map((text, idx) => ({ text, changed: !newMatched[idx] })),
  };
}

function buildChangedOnlyText(tokens: InlineDiffToken[]): string {
  const changedWords = tokens
    .filter((token) => token.changed)
    .map((token) => token.text.trim())
    .filter((token) => token.length > 0);

  return changedWords.length > 0 ? changedWords.join(" ") : "-";
}

function buildStepDiff(
  currentSteps: ProjectPipelineTemplateInfo["steps"],
  compareSteps: ProjectPipelineTemplateInfo["steps"],
): StepDiffItem[] {
  const currentMap = new Map(currentSteps.map((item) => [item.id, item]));
  const compareMap = new Map(compareSteps.map((item) => [item.id, item]));

  const result: StepDiffItem[] = [];

  currentSteps.forEach((step) => {
    const compareStep = compareMap.get(step.id);
    if (!compareStep) {
      result.push({
        id: step.id,
        kind: "added",
        current: {
          name: step.name,
          kind: step.kind,
          description: step.description,
        },
        changedFields: [],
      });
      return;
    }

    const changedFields: string[] = [];
    if (step.name !== compareStep.name) changedFields.push("name");
    if (step.kind !== compareStep.kind) changedFields.push("kind");
    if (step.description !== compareStep.description) changedFields.push("description");

    result.push({
      id: step.id,
      kind:
        stepComparable({
          name: step.name,
          kind: step.kind,
          description: step.description,
        }) ===
        stepComparable({
          name: compareStep.name,
          kind: compareStep.kind,
          description: compareStep.description,
        })
          ? "unchanged"
          : "changed",
      current: {
        name: step.name,
        kind: step.kind,
        description: step.description,
      },
      compare: {
        name: compareStep.name,
        kind: compareStep.kind,
        description: compareStep.description,
      },
      changedFields,
    });
  });

  compareSteps.forEach((step) => {
    if (currentMap.has(step.id)) return;
    result.push({
      id: step.id,
      kind: "removed",
      compare: {
        name: step.name,
        kind: step.kind,
        description: step.description,
      },
      changedFields: [],
    });
  });

  return result;
}

export default function PipelinesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { selectedAgent, agents, setAgents } = useAgentStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [selectedPipelineKey, setSelectedPipelineKey] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "independent" | "project">("all");
  const [selectedCurrentVersion, setSelectedCurrentVersion] = useState("");
  const [selectedCompareVersion, setSelectedCompareVersion] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [designChatStarting, setDesignChatStarting] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [designChatSessionId, setDesignChatSessionId] = useState("");
  const designChatSessionIdRef = useRef("");
  const [editTargetKey, setEditTargetKey] = useState("");
  const [editGuidePlaceholder, setEditGuidePlaceholder] = useState("");
  const [editWelcomeMode, setEditWelcomeMode] = useState<"default" | "init">("default");
  const [draftPipelineKeys, setDraftPipelineKeys] = useState<string[]>([]);
  const [draftNewVersionSteps, setDraftNewVersionSteps] = useState<ProjectPipelineTemplateStep[]>([]);
  const [draftParseStatus, setDraftParseStatus] = useState<"idle" | "ready" | "error">("idle");
  const [draftParseError, setDraftParseError] = useState("");
  const [expandedDraftDiffKeys, setExpandedDraftDiffKeys] = useState<string[]>([]);
  const [draftDiffViewMode, setDraftDiffViewMode] = useState<"changedOnly" | "full">("changedOnly");
  const [lastDraftMdMtime, setLastDraftMdMtime] = useState(0);
  const [saveStreamEvents, setSaveStreamEvents] = useState<Array<{ event: string; ts: number; detail: string }>>([]);
  const [saveStreamError, setSaveStreamError] = useState("");
  const [saveValidationErrors, setSaveValidationErrors] = useState<PipelineValidationError[]>([]);
  const [saveConflictInfo, setSaveConflictInfo] = useState<PipelineSaveConflictInfo | null>(null);
  const [conflictLocalDraftBackup, setConflictLocalDraftBackup] = useState<ProjectPipelineTemplateStep[]>([]);
  const [conflictRemoteDraftBackup, setConflictRemoteDraftBackup] = useState<ProjectPipelineTemplateStep[]>([]);
  const [conflictRestoreAvailable, setConflictRestoreAvailable] = useState(false);
  const [conflictMergeAvailable, setConflictMergeAvailable] = useState(false);
  const [incrementalGeneration, setIncrementalGeneration] = useState<IncrementalGenerationState>({
    active: false,
    mode: "create",
    createStage: "ask_strategy",
    createStrategy: null,
    plannedSteps: [],
    totalStepsExpected: 0,
    currentStep: 1,
    userRequirements: "",
    lastUserRequest: "",
    lastSyntheticPrompt: "",
    operationsApplied: 0,
    parseRetryCount: 0,
  });
  const [providerList, setProviderList] = useState<ProviderInfo[]>([]);
  const [activeModels, setActiveModels] = useState<ActiveModelsInfo | null>(null);
  const [runningConfig, setRunningConfig] = useState<AgentsRunningConfig | null>(null);

  const pipelineExecutionBudget = useMemo(
    () =>
      derivePipelineExecutionBudget({
        providers: providerList,
        activeModels,
        runningConfig,
      }),
    [activeModels, providerList, runningConfig],
  );

  const currentAgent = useMemo(
    () => getCurrentAgent(agents, selectedAgent),
    [agents, selectedAgent],
  );

  const projects = useMemo<AgentProjectSummary[]>(
    () => currentAgent?.projects ?? [],
    [currentAgent?.projects],
  );

  const independentScopeLabel = t("pipelines.independentScope", "独立流程");

  useEffect(() => {
    let mounted = true;

    const loadExecutionBudgetInputs = async () => {
      try {
        const [providers, activeModelConfig, runtimeConfig] = await Promise.all([
          providerApi.listProviders(),
          providerApi.getActiveModels(),
          agentApi.getAgentRunningConfig(),
        ]);
        if (!mounted) return;
        setProviderList(Array.isArray(providers) ? providers : []);
        setActiveModels(activeModelConfig ?? null);
        setRunningConfig(runtimeConfig ?? null);
      } catch (error) {
        console.warn("failed to load pipeline execution budget inputs", error);
        if (!mounted) return;
        setProviderList([]);
        setActiveModels(null);
        setRunningConfig(null);
      }
    };

    void loadExecutionBudgetInputs();

    const handleModelSwitched = () => {
      void loadExecutionBudgetInputs();
    };

    window.addEventListener("model-switched", handleModelSwitched);
    return () => {
      mounted = false;
      window.removeEventListener("model-switched", handleModelSwitched);
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      if (!selectedAgent) return;

      setLoading(true);
      setError("");

      try {
        let availableAgents = agents;
        if (availableAgents.length === 0) {
          const listResp = await agentsApi.listAgents();
          availableAgents = listResp.agents;
          if (mounted) setAgents(listResp.agents);
        }

        const agent = getCurrentAgent(availableAgents, selectedAgent);
        const projectList = agent?.projects ?? [];
        const data = await loadPipelineManagementData(
          selectedAgent,
          projectList,
          independentScopeLabel,
        );

        if (!mounted) return;

        const persisted = readPipelineDraftState(selectedAgent);
        const persistedTemplates = (persisted?.templates || []).filter(
          (item) => item.projectId === INDEPENDENT_PIPELINE_SCOPE_ID,
        );
        const mergedTemplates = [...persistedTemplates, ...data.templates.filter((item) => {
          const key = buildPipelineGroupKey(item.id, getTemplateSourceKind(item));
          return !persistedTemplates.some(
            (draftItem) => buildPipelineGroupKey(draftItem.id, getTemplateSourceKind(draftItem)) === key,
          );
        })];

        const restoredDraftKeys = (persisted?.draftPipelineKeys || []).filter((key) =>
          mergedTemplates.some(
            (item) => buildPipelineGroupKey(item.id, getTemplateSourceKind(item)) === key,
          ),
        );

        setTemplates(mergedTemplates);
        setRuns(data.runs);
        setDraftPipelineKeys(restoredDraftKeys);

        if (persisted && restoredDraftKeys.length > 0) {
          setSourceFilter(persisted.sourceFilter || "independent");
          if (persisted.selectedPipelineKey) {
            setSelectedPipelineKey(persisted.selectedPipelineKey);
          }
          if (persisted.selectedCurrentVersion) {
            setSelectedCurrentVersion(persisted.selectedCurrentVersion);
          }
          if (persisted.selectedCompareVersion) {
            setSelectedCompareVersion(persisted.selectedCompareVersion);
          }
          setDraftNewVersionSteps(persisted.draftNewVersionSteps || []);
          setDraftParseStatus(persisted.draftParseStatus || "idle");
          setDraftParseError(persisted.draftParseError || "");
            message.info(
              t(
                "pipelines.localDraftRestored",
                "已恢复本地未保存草稿。",
              ),
            );
        }
      } catch (err) {
        console.error("failed to load pipeline management data", err);
        if (mounted) {
          setError(
            t(
              "pipelines.loadFailed",
              "Failed to load pipeline management data.",
            ),
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, [agents, independentScopeLabel, selectedAgent, setAgents, t]);

  useEffect(() => {
    designChatSessionIdRef.current = designChatSessionId;
  }, [designChatSessionId]);

  const pipelineGroups = useMemo<PipelineGroup[]>(() => {
    const filteredTemplates = templates.filter((item) => {
      const isIndependent = item.projectId === INDEPENDENT_PIPELINE_SCOPE_ID;
      if (sourceFilter === "independent") return isIndependent;
      if (sourceFilter === "project") return !isIndependent;
      return true;
    });

    const map = new Map<string, TemplateItem[]>();
    filteredTemplates.forEach((item) => {
      const groupKey = buildPipelineGroupKey(item.id, getTemplateSourceKind(item));
      if (!map.has(groupKey)) {
        map.set(groupKey, []);
      }
      map.get(groupKey)?.push(item);
    });

    return Array.from(map.entries())
      .map(([groupKey, items]) => {
        const versionsByKey = new Map<string, ProjectPipelineTemplateInfo>();
        const projectMap = new Map<string, { id: string; name: string }>();

        items.forEach((item) => {
          const versionKey = normalizeVersion(item.version);
          if (!versionsByKey.has(versionKey)) {
            versionsByKey.set(versionKey, {
              id: item.id,
              name: item.name,
              version: item.version,
              description: item.description,
              steps: item.steps,
            });
          }
          if (!projectMap.has(item.projectId)) {
            projectMap.set(item.projectId, {
              id: item.projectId,
              name: item.projectName,
            });
          }
        });

        const versions = Array.from(versionsByKey.values()).sort((a, b) =>
          compareSemverDesc(a.version, b.version),
        );

        const source: PipelineGroup["source"] = getTemplateSourceKind(items[0]);

        return {
          key: groupKey,
          id: items[0].id,
          name: items[0].name,
          description: items[0].description,
          versions,
          projects: Array.from(projectMap.values()),
          source,
        };
      })
      .sort((a, b) => {
        const nameCmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        if (nameCmp !== 0) return nameCmp;
        return a.source.localeCompare(b.source);
      });
  }, [sourceFilter, templates]);

  const selectedPipeline = useMemo(
    () => pipelineGroups.find((item) => item.key === selectedPipelineKey),
    [pipelineGroups, selectedPipelineKey],
  );

  const currentTemplate = useMemo(() => {
    if (!selectedPipeline) return null;
    return (
      selectedPipeline.versions.find(
        (item) => normalizeVersion(item.version) === selectedCurrentVersion,
      ) || selectedPipeline.versions[0] || null
    );
  }, [selectedCurrentVersion, selectedPipeline]);

  const compareTemplate = useMemo(() => {
    if (!selectedPipeline || !selectedCompareVersion) return null;
    return (
      selectedPipeline.versions.find(
        (item) => normalizeVersion(item.version) === selectedCompareVersion,
      ) || null
    );
  }, [selectedCompareVersion, selectedPipeline]);

  const selectedTemplateItem = useMemo(() => {
    if (!selectedPipeline || !selectedCurrentVersion) return null;
    return (
      templates.find(
        (item) =>
          item.id === selectedPipeline.id &&
          getTemplateSourceKind(item) === selectedPipeline.source &&
          normalizeVersion(item.version) === selectedCurrentVersion,
      ) || null
    );
  }, [selectedCurrentVersion, selectedPipeline, templates]);

  const selectedIsDraft = useMemo(() => {
    if (!selectedPipeline) return false;
    return draftPipelineKeys.includes(selectedPipeline.key);
  }, [draftPipelineKeys, selectedPipeline]);

  const hasUnsavedDrafts = draftPipelineKeys.length > 0;

  useEffect(() => {
    if (!hasUnsavedDrafts) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = t(
        "pipelines.unsavedLeaveWarning",
        "当前有未保存的流程草稿，离开后将丢失。",
      );
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasUnsavedDrafts, t]);

  const clearFocusMeta = useCallback(async (chatId: string) => {
    if (!chatId) return;
    try {
      await chatApi.clearChatMeta(chatId, {
        user_id: "default",
        channel: "console",
      });
    } catch {
      // Ignore cleanup failures on page leave.
    }
  }, []);

  useEffect(() => {
    return () => {
      const sessionId = designChatSessionIdRef.current;
      if (sessionId) {
        void clearFocusMeta(sessionId);
      }
    };
  }, [clearFocusMeta]);

  const closeEditMode = () => {
    const prevChatId = designChatSessionId;
    setEditMode(false);
    setDesignChatSessionId("");
    setEditTargetKey("");
    setEditGuidePlaceholder("");
    setEditWelcomeMode("default");
    setDraftNewVersionSteps([]);
    setDraftParseStatus("idle");
    setDraftParseError("");
    setExpandedDraftDiffKeys([]);
    setLastDraftMdMtime(0);
    setSaveStreamEvents([]);
    setSaveStreamError("");
    setSaveValidationErrors([]);
    setSaveConflictInfo(null);
    setConflictLocalDraftBackup([]);
    setConflictRemoteDraftBackup([]);
    setConflictRestoreAvailable(false);
    setConflictMergeAvailable(false);
    setIncrementalGeneration({
      active: false,
      mode: "create",
      createStage: "ask_strategy",
      createStrategy: null,
      plannedSteps: [],
      totalStepsExpected: 0,
      currentStep: 1,
      userRequirements: "",
      lastUserRequest: "",
      lastSyntheticPrompt: "",
      operationsApplied: 0,
      parseRetryCount: 0,
    });
    if (prevChatId) {
      void clearFocusMeta(prevChatId);
    }
  };

  const handleRefreshAfterConflict = useCallback(async () => {
    if (!selectedAgent || !selectedTemplateItem) {
      return;
    }
    try {
      const data = await loadPipelineManagementData(
        selectedAgent,
        projects,
        independentScopeLabel,
      );
      setTemplates(data.templates);
      setRuns(data.runs);
      const remoteDraft = await agentsApi.getPipelineDraft(selectedAgent, selectedTemplateItem.id);
      if (remoteDraft.steps && remoteDraft.steps.length > 0) {
        setDraftNewVersionSteps(remoteDraft.steps);
        setDraftParseStatus("ready");
        setDraftParseError("");
        setExpandedDraftDiffKeys([]);
        setLastDraftMdMtime(remoteDraft.md_mtime || 0);
        setConflictRemoteDraftBackup(remoteDraft.steps);
      }

      const hasLocalBackup = conflictLocalDraftBackup.length > 0;
      const hasRemoteBackup = (remoteDraft.steps || []).length > 0;
      const localFingerprint = hasLocalBackup
        ? stepsFingerprint(conflictLocalDraftBackup)
        : "";
      const remoteFingerprint = stepsFingerprint(remoteDraft.steps || []);
      setConflictRestoreAvailable(
        hasLocalBackup && localFingerprint !== remoteFingerprint,
      );
      setConflictMergeAvailable(
        hasLocalBackup && hasRemoteBackup && localFingerprint !== remoteFingerprint,
      );

      message.success(t("pipelines.conflictRefreshed", "已刷新到最新流程版本，请检查后重试保存。"));
    } catch (error) {
      console.error("failed to refresh pipelines after conflict", error);
      message.error(t("pipelines.conflictRefreshFailed", "刷新流程失败，请稍后重试。"));
    }
  }, [
    conflictLocalDraftBackup,
    independentScopeLabel,
    projects,
    selectedAgent,
    selectedTemplateItem,
    t,
  ]);

  const handleRestoreLocalDraftAfterConflict = useCallback(() => {
    if (conflictLocalDraftBackup.length === 0) {
      return;
    }
    setDraftNewVersionSteps(conflictLocalDraftBackup);
    setDraftParseStatus("ready");
    setDraftParseError("");
    setExpandedDraftDiffKeys([]);
    setConflictRestoreAvailable(false);
    message.success(t("pipelines.conflictLocalRestored", "已恢复本地草稿，请确认后重新保存。"));
  }, [conflictLocalDraftBackup, t]);

  const handleUseRemoteDraftAfterConflict = useCallback(() => {
    if (conflictRemoteDraftBackup.length === 0) {
      return;
    }
    setDraftNewVersionSteps(conflictRemoteDraftBackup);
    setDraftParseStatus("ready");
    setDraftParseError("");
    setExpandedDraftDiffKeys([]);
    setConflictRestoreAvailable(true);
    setConflictMergeAvailable(false);
    message.success(t("pipelines.conflictRemoteApplied", "已采用远端草稿。"));
  }, [conflictRemoteDraftBackup, t]);

  const handleMergeDraftAfterConflict = useCallback(() => {
    if (conflictRemoteDraftBackup.length === 0 || conflictLocalDraftBackup.length === 0) {
      return;
    }
    const merged = mergeDraftStepsByStepId(
      conflictRemoteDraftBackup,
      conflictLocalDraftBackup,
    );
    setDraftNewVersionSteps(merged);
    setDraftParseStatus("ready");
    setDraftParseError("");
    setExpandedDraftDiffKeys([]);
    setConflictRestoreAvailable(true);
    setConflictMergeAvailable(false);
    message.success(t("pipelines.conflictMerged", "已按 step_id 合并本地与远端草稿。"));
  }, [conflictLocalDraftBackup, conflictRemoteDraftBackup, t]);

  const requestCloseEditMode = () => {
    if (!selectedIsDraft) {
      closeEditMode();
      return;
    }

    Modal.confirm({
      title: t("pipelines.unsavedDraftTitle", "存在未保存草稿"),
      content: t(
        "pipelines.unsavedExitConfirm",
        "当前流程草稿尚未保存，退出编辑后改动可能丢失。是否继续？",
      ),
      okText: t("common.confirm", "确认"),
      cancelText: t("common.cancel", "取消"),
      onOk: () => {
        closeEditMode();
      },
    });
  };

  const requestSelectPipeline = (nextPipelineKey: string) => {
    if (!(editMode && selectedIsDraft && selectedPipelineKey !== nextPipelineKey)) {
      setSelectedPipelineKey(nextPipelineKey);
      setSelectedCompareVersion("");
      return;
    }

    Modal.confirm({
      title: t("pipelines.unsavedDraftTitle", "存在未保存草稿"),
      content: t(
        "pipelines.unsavedSwitchConfirm",
        "当前流程草稿尚未保存，切换流程后改动可能丢失。是否继续切换？",
      ),
      okText: t("common.confirm", "确认"),
      cancelText: t("common.cancel", "取消"),
      onOk: () => {
        closeEditMode();
        setSelectedPipelineKey(nextPipelineKey);
        setSelectedCompareVersion("");
      },
    });
  };

  const newVersionDiffItems = useMemo(
    () =>
      compareTemplate && currentTemplate
        ? buildStepDiff(compareTemplate.steps, currentTemplate.steps)
        : [],
    [compareTemplate, currentTemplate],
  );

  const realtimeDraftDiffItems = useMemo(
    () =>
      currentTemplate && draftNewVersionSteps.length > 0
        ? buildStepDiff(draftNewVersionSteps, currentTemplate.steps)
        : [],
    [currentTemplate, draftNewVersionSteps],
  );

  const draftDiffDetailKeys = useMemo(
    () => realtimeDraftDiffItems.map((item) => `${item.kind}:${item.id}`),
    [realtimeDraftDiffItems],
  );

  const allDraftDiffExpanded = useMemo(
    () =>
      draftDiffDetailKeys.length > 0 &&
      draftDiffDetailKeys.every((key) => expandedDraftDiffKeys.includes(key)),
    [draftDiffDetailKeys, expandedDraftDiffKeys],
  );

  const runningCount = useMemo(
    () => runs.filter((run) => run.status === "running").length,
    [runs],
  );

  const visibleRuns = useMemo(() => {
    const base = selectedPipeline
      ? selectedPipeline.source === "project"
        ? runs.filter((run) => run.template_id === selectedPipeline.id)
        : []
      : runs;
    return base.slice(0, 30);
  }, [runs, selectedPipeline]);

  useEffect(() => {
    if (!selectedAgent) return;

    const draftTemplates = templates.filter((item) =>
      draftPipelineKeys.includes(buildPipelineGroupKey(item.id, getTemplateSourceKind(item))),
    );

    if (draftTemplates.length === 0) {
      clearPipelineDraftState(selectedAgent);
      return;
    }

    writePipelineDraftState(selectedAgent, {
      version: 1,
      templates: draftTemplates,
      draftPipelineKeys,
      selectedPipelineKey,
      selectedCurrentVersion,
      selectedCompareVersion,
      sourceFilter,
      draftNewVersionSteps,
      draftParseStatus,
      draftParseError,
    });
  }, [
    draftNewVersionSteps,
    draftParseError,
    draftParseStatus,
    draftPipelineKeys,
    selectedAgent,
    selectedCompareVersion,
    selectedCurrentVersion,
    selectedPipelineKey,
    sourceFilter,
    templates,
  ]);

  useEffect(() => {
    if (pipelineGroups.length === 0) {
      setSelectedPipelineKey("");
      setSelectedCurrentVersion("");
      setSelectedCompareVersion("");
      return;
    }

    if (!pipelineGroups.some((item) => item.key === selectedPipelineKey)) {
      setSelectedPipelineKey(pipelineGroups[0].key);
    }
  }, [pipelineGroups, selectedPipelineKey]);

  useEffect(() => {
    if (!selectedPipeline) {
      setSelectedCurrentVersion("");
      setSelectedCompareVersion("");
      return;
    }

    const versions = selectedPipeline.versions;
    if (versions.length === 0) {
      setSelectedCurrentVersion("");
      setSelectedCompareVersion("");
      return;
    }

    if (!versions.some((item) => normalizeVersion(item.version) === selectedCurrentVersion)) {
      setSelectedCurrentVersion(normalizeVersion(versions[0].version));
    }

    if (
      selectedCompareVersion &&
      !versions.some((item) => normalizeVersion(item.version) === selectedCompareVersion)
    ) {
      setSelectedCompareVersion("");
    }
  }, [selectedCompareVersion, selectedCurrentVersion, selectedPipeline]);

  useEffect(() => {
    if (selectedCompareVersion && selectedCompareVersion === selectedCurrentVersion) {
      setSelectedCompareVersion("");
    }
  }, [selectedCompareVersion, selectedCurrentVersion]);

  const resolveBoundChat = useCallback(
    async (bindingKey: string): Promise<ChatSpec | null> => {
      const chats = await chatApi.listChats({ user_id: "default", channel: "console" });
      const matched = chats.filter((chat) => {
        const meta =
          chat.meta && typeof chat.meta === "object"
            ? (chat.meta as Record<string, unknown>)
            : undefined;
        const metaType = getMetaString(meta, "focus_type") || getMetaString(meta, "binding_type");
        const metaKey = getMetaString(meta, "focus_binding_key") || getMetaString(meta, "pipeline_binding_key");
        const metaAgentId = getMetaString(meta, "agent_id");

        if (metaType !== "pipeline_edit" || metaKey !== bindingKey) {
          return false;
        }
        if (selectedAgent && metaAgentId && metaAgentId !== selectedAgent) {
          return false;
        }
        return true;
      });

      if (matched.length === 0) return null;

      const toMillis = (value?: string | null): number => {
        if (!value) return 0;
        const ts = Date.parse(value);
        return Number.isFinite(ts) ? ts : 0;
      };

      matched.sort((a, b) => {
        const tsA = toMillis(a.updated_at) || toMillis(a.created_at);
        const tsB = toMillis(b.updated_at) || toMillis(b.created_at);
        return tsB - tsA;
      });

      return matched[0] || null;
    },
    [selectedAgent],
  );

  const handleOpenDesignChat = async (
    withEditMode = false,
    target?: EditChatTarget,
    options?: { forceNewSession?: boolean },
  ) => {
    const previousSessionId = designChatSessionId;
    setDesignChatStarting(true);
    try {
      const source = "pipelines_page" as const;
      const targetPipelineName = target?.pipelineName || selectedPipeline?.name || selectedPipeline?.id || "unknown";
      const targetVersion = normalizeVersion(target?.version || currentTemplate?.version || "latest");
      const targetScope = target?.source || selectedPipeline?.source || "independent";
      const targetDescription = target?.description || currentTemplate?.description || "";
      const targetSteps = (target?.steps && target.steps.length > 0)
        ? target.steps
        : (currentTemplate?.steps && currentTemplate.steps.length > 0)
          ? currentTemplate.steps
          : [];
      const isEmptyNodes = target?.isEmptyNodes ?? (targetSteps.length === 0);
      const normalizedTarget: EditChatTarget = {
        pipelineId: target?.pipelineId || selectedPipeline?.id || "unknown",
        pipelineName: targetPipelineName,
        version: targetVersion,
        isEmptyNodes,
        description: targetDescription,
        steps: targetSteps,
        source: targetScope,
      };
      const defaultMdRelativePath = `${buildPipelineWorkspaceRelativePath(normalizedTarget.pipelineId)}/pipeline.md`;
      let mdRelativePath = defaultMdRelativePath;
      let flowMemoryRelativePath = "";
      if (withEditMode && selectedAgent && normalizedTarget.pipelineId !== "unknown") {
        try {
          const draftInfo = await agentsApi.ensurePipelineDraft(
            selectedAgent,
            normalizedTarget.pipelineId,
            {
              id: normalizedTarget.pipelineId,
              name: targetPipelineName,
              version: targetVersion,
              description: targetDescription,
              steps: targetSteps,
            },
          );
          mdRelativePath = draftInfo.md_relative_path || defaultMdRelativePath;
          flowMemoryRelativePath = draftInfo.flow_memory_relative_path || "";
          setLastDraftMdMtime(draftInfo.md_mtime || 0);
        } catch {
          setLastDraftMdMtime(0);
        }
      }
      const targetKey = buildPipelineDesignBindingKey({
        pipelineId: normalizedTarget.pipelineId,
        version: normalizedTarget.version,
      });

      const seedTask = withEditMode
        ? `编辑已有流程: ${targetPipelineName} (${targetVersion})\n请先分析当前节点并给出可执行的改造建议。`
        : undefined;
      const editGuide = t(
        isEmptyNodes
          ? "pipelines.editInputPlaceholderInit"
          : "pipelines.editInputPlaceholder",
        isEmptyNodes
          ? "这是一个新流程，请先定义目标、关键步骤和完成标准，我会帮你生成首版节点草案。"
          : "围绕当前流程 {{name}} ({{version}}) 描述你的改造目标，例如：新增校验节点、调整重试策略、优化输出结构。",
        {
          name: targetPipelineName,
          version: targetVersion,
        },
      );
      const editPlaceholder = buildPipelineDesignEditContextPrompt({
        agentId: selectedAgent,
        source,
        scope: targetScope,
        pipelineId: normalizedTarget.pipelineId,
        pipelineName: targetPipelineName,
        version: targetVersion,
        description: targetDescription,
        mdRelativePath,
        flowMemoryRelativePath,
        steps: targetSteps,
      });
      const editGuideWithContext = `${editGuide}\n\n${editPlaceholder}`;

      if (withEditMode && !options?.forceNewSession) {
        const reusedInMemory =
          designChatSessionId && editTargetKey === targetKey
            ? ({
                id: designChatSessionId,
                session_id: designChatSessionId,
                user_id: "default",
                channel: "console",
              } as ChatSpec)
            : null;

        const restored = reusedInMemory || (await resolveBoundChat(targetKey));
        if (restored) {
          setDesignChatSessionId(restored.id);
          const prefilledDraft: ProjectPipelineTemplateStep[] = [];
          setDraftNewVersionSteps(prefilledDraft);
          setDraftParseStatus(prefilledDraft.length > 0 ? "ready" : "idle");
          setDraftParseError("");
          setExpandedDraftDiffKeys([]);
          setEditMode(true);
          setEditTargetKey(targetKey);
          setEditWelcomeMode(isEmptyNodes ? "init" : "default");
          setEditGuidePlaceholder(editGuideWithContext);
          setIncrementalGeneration({
            active: false,
            mode: "create",
            createStage: "ask_strategy",
            createStrategy: null,
            plannedSteps: [],
            totalStepsExpected: 0,
            currentStep: 1,
            userRequirements: "",
            lastUserRequest: "",
            lastSyntheticPrompt: "",
            operationsApplied: 0,
            parseRetryCount: 0,
          });
          message.success(
            t("pipelines.boundSessionRestored", "已恢复流程绑定会话。"),
          );
          return;
        }
      }

      const bindingMeta = buildPipelineChatBindingMeta({
        pipelineId: normalizedTarget.pipelineId,
        pipelineName: normalizedTarget.pipelineName,
        version: normalizedTarget.version,
        scope: normalizedTarget.source || "independent",
        agentId: selectedAgent,
        flowMemoryPath:
          flowMemoryRelativePath ||
          (normalizedTarget.pipelineId && normalizedTarget.pipelineId !== "unknown"
            ? buildPipelineFlowMemoryRelativePath(normalizedTarget.pipelineId)
            : undefined),
      });

      const created = await chatApi.createChat({
        name: t("pipelines.designSessionName", "Pipeline Design"),
        session_id: buildPipelineEntrySessionId(),
        user_id: "default",
        channel: "console",
        meta: withEditMode ? bindingMeta : {},
      });

      if (
        withEditMode &&
        options?.forceNewSession &&
        previousSessionId &&
        previousSessionId !== created.id
      ) {
        void clearFocusMeta(previousSessionId);
      }

      setDesignChatSessionId(created.id);
      if (withEditMode) {
        const prefilledDraft: ProjectPipelineTemplateStep[] = [];
        setDraftNewVersionSteps(prefilledDraft);
        setDraftParseStatus(prefilledDraft.length > 0 ? "ready" : "idle");
        setDraftParseError("");
        setExpandedDraftDiffKeys([]);
        setEditMode(true);
        setEditTargetKey(targetKey);
        setEditWelcomeMode(isEmptyNodes ? "init" : "default");
        setEditGuidePlaceholder(editGuideWithContext);
        setIncrementalGeneration({
          active: false,
          mode: "create",
          createStage: "ask_strategy",
          createStrategy: null,
          plannedSteps: [],
          totalStepsExpected: 0,
          currentStep: 1,
          userRequirements: "",
          lastUserRequest: "",
          lastSyntheticPrompt: "",
          operationsApplied: 0,
          parseRetryCount: 0,
        });
        message.success(
          t("pipelines.boundSessionCreated", "已创建流程绑定会话。"),
        );
        return;
      }

      const bootstrapPrompt = buildPipelineDesignBootstrapPrompt({
        source,
        agentId: selectedAgent,
        seedTask,
      });

      // Cache the bootstrap prompt so Chat page can show a local user bubble
      // before backend persistence catches up.
      sessionApi.setLastUserMessage(created.id, bootstrapPrompt);
      if (created.session_id) {
        sessionApi.setLastUserMessage(created.session_id, bootstrapPrompt);
      }

      await chatApi.startConsoleChat({
        sessionId: created.session_id || created.id,
        prompt: bootstrapPrompt,
        userId: created.user_id || "default",
        channel: created.channel || "console",
      });

      const to = buildPipelineDesignChatPath(created.id);
      trackNavigation({
        source: "pipelines.handleOpenDesignChat",
        from: "/pipelines",
        to,
        reason: "start-pipeline-design-chat-inline",
      });
    } catch (error) {
      console.error("failed to start pipeline design chat", error);
      message.error(
        t(
          "pipelines.startChatFailed",
          "Failed to start pipeline design chat. Please try again.",
        ),
      );
    } finally {
      setDesignChatStarting(false);
    }
  };

  const handleCreatePipelineAndEnterEdit = async () => {
    if (!selectedAgent) {
      message.warning(t("pipelines.noAgent", "No active agent selected."));
      return;
    }

    const now = Date.now();
    const draftId = `pipeline-${now}`;
    const draftVersion = "0.1.0";
    const draftTemplate: TemplateItem = {
      id: draftId,
      name: t("pipelines.newPipelineName", "新流程"),
      version: draftVersion,
      description: t("pipelines.newPipelineDescription", "待补充流程说明"),
      steps: [],
      projectId: INDEPENDENT_PIPELINE_SCOPE_ID,
      projectName: t("pipelines.independentScope", "独立流程"),
    };

    const draftGroupKey = buildPipelineGroupKey(draftTemplate.id, "independent");
    setTemplates((prev) => [draftTemplate, ...prev]);
    setDraftPipelineKeys((prev) => Array.from(new Set([draftGroupKey, ...prev])));
    setSourceFilter("independent");
    setSelectedPipelineKey(draftGroupKey);
    setSelectedCurrentVersion(normalizeVersion(draftTemplate.version));
    setSelectedCompareVersion("");

    await handleOpenDesignChat(true, {
      pipelineId: draftTemplate.id,
      pipelineName: draftTemplate.name,
      version: draftTemplate.version,
      isEmptyNodes: true,
      description: draftTemplate.description,
      steps: draftTemplate.steps,
      source: "independent",
    });
  };

  const handleSaveDraftPipeline = async () => {
    if (!selectedAgent || !selectedTemplateItem) {
      return;
    }

    const templateId = (selectedTemplateItem.id || "").trim();
    const safeTemplateId = templateId
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || `pipeline-${Date.now()}`;

    const effectiveSteps =
      draftParseStatus === "ready" && draftNewVersionSteps.length > 0
        ? draftNewVersionSteps
        : (selectedTemplateItem.steps || []);

    const templateDoc = {
      id: safeTemplateId,
      name: selectedTemplateItem.name || safeTemplateId,
      version: selectedTemplateItem.version || "0.1.0",
      description: selectedTemplateItem.description || "",
      steps: effectiveSteps,
    };

    setDraftSaving(true);
    const saveToastKey = "pipelines-save-stream";
    try {
      const savedDraftId = selectedTemplateItem.id;
      const savedDraftKey = buildPipelineGroupKey(savedDraftId, "independent");
      const preservedDraftTemplates = templates.filter(
        (item) => {
          const key = buildPipelineGroupKey(item.id, getTemplateSourceKind(item));
          return draftPipelineKeys.includes(key) && key !== savedDraftKey;
        },
      );
      const preservedDraftKeys = draftPipelineKeys.filter((key) => key !== savedDraftKey);

      let hasStreamFailure = false;
      let streamFailureStatusCode = 0;
      let streamFailureDetail = "";
      let streamFailureDetailRaw: unknown = null;
      let streamReachedDone = false;
      setSaveStreamEvents([]);
      setSaveStreamError("");
      setSaveValidationErrors([]);
      setSaveConflictInfo(null);
      setConflictLocalDraftBackup([]);
      setConflictRemoteDraftBackup([]);
      setConflictRestoreAvailable(false);
      setConflictMergeAvailable(false);

      message.loading({
        key: saveToastKey,
        content: t("pipelines.saveDraftPending", "正在校验并保存流程..."),
        duration: 0,
      });

      try {
        await agentsApi.saveAgentPipelineTemplateStream(
          selectedAgent,
          safeTemplateId,
          {
            id: safeTemplateId,
            name: templateDoc.name,
            version: templateDoc.version,
            description: templateDoc.description,
            steps: templateDoc.steps,
          },
          (event) => {
            const detailText =
              typeof event.payload?.detail === "string"
                ? event.payload.detail
                : event.payload?.detail
                  ? JSON.stringify(event.payload.detail)
                  : "";
            setSaveStreamEvents((prev) => [
              ...prev.slice(-7),
              { event: event.event, ts: Date.now(), detail: detailText },
            ]);

            if (event.event === "saved") {
              message.loading({
                key: saveToastKey,
                content: t("pipelines.saveDraftSaved", "保存成功，正在刷新数据..."),
                duration: 0,
              });
            } else if (event.event === "validation_failed" || event.event === "save_failed") {
              const payload = event.payload || {};
              hasStreamFailure = true;
              streamFailureStatusCode = Number(payload.status_code || 0) || 500;
              streamFailureDetail =
                typeof payload.detail === "string"
                  ? payload.detail
                  : payload.detail
                    ? JSON.stringify(payload.detail)
                    : "";
              streamFailureDetailRaw = payload.detail;
              setSaveStreamError(streamFailureDetail || `${streamFailureStatusCode}`);

              const detailObj = payload.detail;
              if (detailObj && typeof detailObj === "object") {
                const maybeErrors = (detailObj as { errors?: unknown }).errors;
                if (Array.isArray(maybeErrors)) {
                  const normalized = maybeErrors.filter(
                    (item): item is PipelineValidationError =>
                      Boolean(item) && typeof item === "object" &&
                      typeof (item as { error_code?: unknown }).error_code === "string",
                  );
                  setSaveValidationErrors(normalized);
                }
              }
            } else if (event.event === "done") {
              streamReachedDone = true;
            }
          },
          {
            expectedRevision: selectedTemplateItem.revision,
          },
        );
      } catch (streamError) {
        // Fallback to non-stream save path if SSE is interrupted.
        console.warn("pipeline save stream failed, fallback to direct save", streamError);
        await agentsApi.saveAgentPipelineTemplate(
          selectedAgent,
          safeTemplateId,
          {
            id: safeTemplateId,
            name: templateDoc.name,
            version: templateDoc.version,
            description: templateDoc.description,
            steps: templateDoc.steps,
          },
          {
            expectedRevision: selectedTemplateItem.revision,
          },
        );
        streamReachedDone = true;
      }

      if (hasStreamFailure) {
        const conflictInfo = extractPipelineConflictInfo(streamFailureDetailRaw);
        if (conflictInfo) {
          setSaveConflictInfo(conflictInfo);
          setConflictLocalDraftBackup(draftNewVersionSteps);
          setConflictRemoteDraftBackup([]);
          setConflictMergeAvailable(false);
        }
        throw new Error(`${streamFailureStatusCode || 500} ${streamFailureDetail}`.trim());
      }

      if (!streamReachedDone) {
        throw new Error("Save stream ended unexpectedly");
      }

      const data = await loadPipelineManagementData(
        selectedAgent,
        projects,
        independentScopeLabel,
      );

      setTemplates([...preservedDraftTemplates, ...data.templates]);
      setRuns(data.runs);
      setDraftPipelineKeys(preservedDraftKeys);
      setSourceFilter("independent");
      setSelectedPipelineKey(buildPipelineGroupKey(safeTemplateId, "independent"));
      setSelectedCurrentVersion(normalizeVersion(templateDoc.version));
      setSelectedCompareVersion("");
      setDraftNewVersionSteps([]);
      setDraftParseStatus("idle");
      setDraftParseError("");
      setExpandedDraftDiffKeys([]);
      setLastDraftMdMtime(0);
      setSaveStreamError("");
      setSaveValidationErrors([]);
      setSaveConflictInfo(null);
      setConflictLocalDraftBackup([]);
      setConflictRemoteDraftBackup([]);
      setConflictRestoreAvailable(false);
      setConflictMergeAvailable(false);

      message.destroy(saveToastKey);
      message.success(t("pipelines.saveDraftSuccess", "流程已保存"));
    } catch (error) {
      console.error("failed to save draft pipeline", error);
      message.destroy(saveToastKey);
      const detailObj = extractPipelineDetailFromError(error);
      const parsedConflictInfo = extractPipelineConflictInfo(detailObj);
      if (parsedConflictInfo) {
        setSaveConflictInfo(parsedConflictInfo);
        setConflictLocalDraftBackup(draftNewVersionSteps);
        setConflictRemoteDraftBackup([]);
        setConflictMergeAvailable(false);
      }
      if (!saveStreamError) {
        setSaveStreamError(String(error));
      }
      message.error(t("pipelines.saveDraftFailed", "保存流程失败，请重试。"));
    } finally {
      setDraftSaving(false);
    }
  };

  const handleEnterEditMode = async () => {
    if (!selectedPipeline || !currentTemplate) {
      message.warning(t("pipelines.selectPipelineFirst", "Please select a pipeline first."));
      return;
    }

    const isEmptyNodes = (currentTemplate.steps?.length || 0) === 0;
    setEditWelcomeMode(isEmptyNodes ? "init" : "default");
    setEditGuidePlaceholder(
      t(
        isEmptyNodes
          ? "pipelines.editInputPlaceholderInit"
          : "pipelines.editInputPlaceholder",
        isEmptyNodes
          ? "这是一个新流程，请先定义目标、关键步骤和完成标准，我会帮你生成首版节点草案。"
          : "围绕当前流程 {{name}} ({{version}}) 描述你的改造目标，例如：新增校验节点、调整重试策略、优化输出结构。",
        {
          name: selectedPipeline.name || selectedPipeline.id || "unknown",
          version: currentTemplate.version || "latest",
        },
      ),
    );

    await handleOpenDesignChat(true, {
      pipelineId: selectedPipeline.id,
      pipelineName: selectedPipeline.name || selectedPipeline.id,
      version: currentTemplate.version || "latest",
      isEmptyNodes,
      description: currentTemplate.description || "",
      steps: currentTemplate.steps || [],
      source: selectedPipeline.source,
    });
  };

  const applyConfirmedCreatePlan = useCallback(
    async (confirmedRequest?: string) => {
      if (!selectedAgent) return;

      const activePipelineId = selectedPipeline?.id || selectedTemplateItem?.id || "";
      if (!activePipelineId) return;

      const plannedSteps = incrementalGeneration.plannedSteps;
      if (!plannedSteps || plannedSteps.length === 0) {
        setIncrementalGeneration((prev) => ({
          ...prev,
          active: false,
        }));
        message.warning(
          t("pipelines.incrementalProposalEmpty", "当前没有可写入的节点方案，请先重新生成。"),
        );
        return;
      }

      try {
        setIncrementalGeneration((prev) => ({
          ...prev,
          createStage: "applying",
          currentStep: 1,
          parseRetryCount: 0,
          lastUserRequest: confirmedRequest || prev.lastUserRequest,
        }));

        let expectedRevision = incrementalGeneration.lastSuccessfulRevision ?? selectedTemplateItem?.revision;
        let latestSteps = draftNewVersionSteps.length > 0
          ? draftNewVersionSteps
          : (selectedTemplateItem?.steps || currentTemplate?.steps || []);

        for (let index = 0; index < plannedSteps.length; index += 1) {
          const step = plannedSteps[index];
          const operation = latestSteps.some((item) => item.id === step.id) ? "update" : "add";
          const updated = await agentsApi.addOrUpdatePipelineStep(
            selectedAgent,
            activePipelineId,
            step,
            operation,
            {
              expectedRevision,
            },
          );

          expectedRevision = updated.revision;
          latestSteps = updated.steps || [];

          setTemplates((prev) => mergeTemplateUpdate(prev, updated));
          setDraftNewVersionSteps(updated.steps || []);
          setDraftParseStatus("ready");
          setDraftParseError("");
          setExpandedDraftDiffKeys([]);
          setIncrementalGeneration((prev) => ({
            ...prev,
            currentStep: index + 1,
            operationsApplied: index + 1,
            lastSuccessfulRevision: updated.revision,
          }));

          message.success(
            t("pipelines.incrementalStepSaved", "已生成第 {{current}} / {{total}} 步。", {
              current: index + 1,
              total: plannedSteps.length,
            }),
          );
        }

        setIncrementalGeneration((prev) => ({
          ...prev,
          active: false,
          createStage: "ask_strategy",
          createStrategy: null,
          plannedSteps: [],
          parseRetryCount: 0,
        }));
        setEditWelcomeMode("default");
        message.success(
          t("pipelines.incrementalGenerationDone", "流程节点已逐步生成完成。"),
        );
      } catch (error) {
        console.error("failed to apply confirmed pipeline proposal", error);
        setDraftParseStatus("error");
        setDraftParseError(t("pipelines.stepSaveFailed", "节点保存失败，请检查后重试。"));
        setIncrementalGeneration((prev) => ({
          ...prev,
          createStage: "await_confirm",
          parseRetryCount: 0,
        }));
        message.error(t("pipelines.stepSaveFailed", "节点保存失败，请检查后重试。"));
      }
    },
    [
      currentTemplate?.steps,
      draftNewVersionSteps,
      incrementalGeneration.lastSuccessfulRevision,
      incrementalGeneration.plannedSteps,
      selectedAgent,
      selectedPipeline?.id,
      selectedTemplateItem?.id,
      selectedTemplateItem?.revision,
      selectedTemplateItem?.steps,
      t,
    ],
  );

  const handleSelectCreateStrategyByButton = useCallback(
    async (strategy: "stepwise" | "plan_then_refine") => {
      if (!designChatSessionId || !editMode || !incrementalGeneration.active || incrementalGeneration.mode !== "create") {
        return;
      }

      if (incrementalGeneration.createStage !== "ask_strategy") {
        return;
      }

      const strategyInput = strategy === "stepwise" ? "1" : "2";
      const strategyLabel =
        strategy === "stepwise"
          ? t("pipelines.strategyStepwise", "一个节点一个节点加")
          : t("pipelines.strategyPlanThenRefine", "先整体规划再逐个改");

      try {
        sessionApi.setLastUserMessage(designChatSessionId, strategyInput);
        await chatApi.startConsoleChat({
          sessionId: designChatSessionId,
          prompt: strategyInput,
          userId: "default",
          channel: "console",
        });
        message.info(
          t("pipelines.strategySelectedHint", "已选择：{{strategy}}，正在进入对应创建路径。", {
            strategy: strategyLabel,
          }),
        );
      } catch (error) {
        console.error("failed to submit strategy selection", error);
        message.error(
          t("pipelines.strategySubmitFailed", "提交策略失败，请重试或直接输入 1 / 2。"),
        );
      }
    },
    [
      designChatSessionId,
      editMode,
      incrementalGeneration.active,
      incrementalGeneration.createStage,
      incrementalGeneration.mode,
      t,
    ],
  );

  const handleEditCreateTopic = useCallback(async () => {
    if (!designChatSessionId || !editMode) {
      return;
    }

    setIncrementalGeneration((prev) => ({
      ...prev,
      active: false,
      mode: "create",
      createStage: "ask_strategy",
      createStrategy: null,
      plannedSteps: [],
      totalStepsExpected: 0,
      currentStep: 1,
      userRequirements: "",
      lastUserRequest: "",
      lastSyntheticPrompt: "",
      operationsApplied: 0,
      parseRetryCount: 0,
      lastSuccessfulRevision: undefined,
    }));

    const prompt = t(
      "pipelines.reenterTopicPrompt",
      "请重新描述你想创建的流程主题，我会先记录主题，再让你选择创建策略。",
    );

    try {
      sessionApi.setLastUserMessage(designChatSessionId, prompt);
      await chatApi.startConsoleChat({
        sessionId: designChatSessionId,
        prompt,
        userId: "default",
        channel: "console",
      });
      message.info(
        t("pipelines.reenterTopicHint", "已切换到主题重填模式，请输入新的流程主题。"),
      );
    } catch (error) {
      console.error("failed to request topic re-entry", error);
      message.warning(
        t("pipelines.reenterTopicFailed", "请直接在输入框重新描述流程主题。"),
      );
    }
  }, [designChatSessionId, editMode, t]);

  const handleAssistantTurnCompleted = useCallback(
    async (payload: { text: string; response: Record<string, unknown> | null }) => {
      if (!editMode) return;

      const activePipelineId = selectedPipeline?.id || selectedTemplateItem?.id || "";
      const activePipelineName =
        selectedPipeline?.name || selectedTemplateItem?.name || activePipelineId || "unknown";

      if (!selectedAgent || !activePipelineId || !designChatSessionId) {
        return;
      }

      const fetchLatestUserRequest = async (): Promise<string> => {
        const history = await chatApi.getChat(designChatSessionId, { limit: 20 });
        const lastUserMessage = [...(history.messages || [])]
          .reverse()
          .find((item) => item.role === "user");
        return extractTextFromChatContent(lastUserMessage?.content);
      };

      const dispatchSyntheticPrompt = async (prompt: string) => {
        sessionApi.setLastUserMessage(designChatSessionId, prompt);
        await chatApi.startConsoleChat({
          sessionId: designChatSessionId,
          prompt,
          userId: "default",
          channel: "console",
        });
      };

      const startIncrementalWorkflow = async (
        mode: "create" | "modify",
        userRequest: string,
        steps: ProjectPipelineTemplateStep[],
      ) => {
        if (mode === "create") {
          const totalStepsExpected = inferStepCountFromRequirements(userRequest);
          const firstPrompt = buildCreateStrategySelectionPrompt(userRequest);

          setIncrementalGeneration({
            active: true,
            mode,
            createStage: "ask_strategy",
            createStrategy: null,
            plannedSteps: [],
            totalStepsExpected,
            currentStep: 1,
            userRequirements: userRequest,
            lastUserRequest: userRequest,
            lastSyntheticPrompt: firstPrompt,
            operationsApplied: 0,
            parseRetryCount: 0,
          });

          message.info(
            t("pipelines.incrementalTopicCaptured", "已记录流程主题，请先选择创建策略。"),
          );
          await dispatchSyntheticPrompt(firstPrompt);
          return;
        }

        const firstPrompt = buildIncrementalStepEditPrompt(
          activePipelineId,
          activePipelineName,
          steps,
          userRequest,
          0,
          pipelineExecutionBudget,
        );

        setIncrementalGeneration({
          active: true,
          mode,
          createStage: "ask_strategy",
          createStrategy: null,
          plannedSteps: [],
          totalStepsExpected: steps.length,
          currentStep: 1,
          userRequirements: userRequest,
          lastUserRequest: userRequest,
          lastSyntheticPrompt: firstPrompt,
          operationsApplied: 0,
          parseRetryCount: 0,
        });

        message.info(
          t("pipelines.incrementalEditStart", "开始按节点逐步应用这次修改请求。"),
        );
        await dispatchSyntheticPrompt(firstPrompt);
      };

      if (incrementalGeneration.active && incrementalGeneration.mode === "create") {
        if (incrementalGeneration.createStage === "ask_strategy") {
          const latestUserRequest = await fetchLatestUserRequest();

          if (!isIncrementalUserMessage(latestUserRequest, incrementalGeneration)) {
            return;
          }

          const detectedStrategy =
            latestUserRequest.trim() === "1"
              ? "stepwise"
              : latestUserRequest.trim() === "2"
                ? "plan_then_refine"
                : detectCreateStrategy(latestUserRequest);

          if (!detectedStrategy) {
            const strategyPrompt = buildCreateStrategySelectionPrompt(
              incrementalGeneration.userRequirements,
            );
            await dispatchSyntheticPrompt(strategyPrompt);
            setIncrementalGeneration((prev) => ({
              ...prev,
              parseRetryCount: 0,
              lastUserRequest: latestUserRequest,
              lastSyntheticPrompt: strategyPrompt,
            }));
            message.info(
              t(
                "pipelines.incrementalStrategyChooseHint",
                "请先选择策略：回复 1（逐节点）或 2（先规划后逐个改）。",
              ),
            );
            return;
          }

          if (detectedStrategy === "stepwise") {
            const effectiveSteps = draftNewVersionSteps.length > 0
              ? draftNewVersionSteps
              : (selectedTemplateItem?.steps || currentTemplate?.steps || []);
            const totalStepsExpected = inferStepCountFromRequirements(
              `${incrementalGeneration.userRequirements}\n${latestUserRequest}`,
            );
            const firstPrompt = buildIncrementalStepGenerationPrompt(
              activePipelineId,
              activePipelineName,
              {
                totalStepsExpected,
                stepsGenerated: effectiveSteps.length,
                currentStep: 1,
                isComplete: false,
              },
              effectiveSteps,
              incrementalGeneration.userRequirements,
              pipelineExecutionBudget,
            );

            setIncrementalGeneration((prev) => ({
              ...prev,
              createStage: "stepwise",
              createStrategy: "stepwise",
              plannedSteps: [],
              totalStepsExpected,
              currentStep: 1,
              parseRetryCount: 0,
              lastUserRequest: latestUserRequest,
              lastSyntheticPrompt: firstPrompt,
            }));

            message.info(
              t("pipelines.incrementalGenerationStart", "已切换到逐步生成模式，开始生成第 1 步。"),
            );
            await dispatchSyntheticPrompt(firstPrompt);
            return;
          }

          const proposalPrompt = buildInitialStepProposalPrompt(
            activePipelineId,
            activePipelineName,
            incrementalGeneration.userRequirements,
            pipelineExecutionBudget,
          );
          setIncrementalGeneration((prev) => ({
            ...prev,
            createStage: "proposal",
            createStrategy: "plan_then_refine",
            plannedSteps: [],
            totalStepsExpected: inferStepCountFromRequirements(incrementalGeneration.userRequirements),
            currentStep: 1,
            parseRetryCount: 0,
            lastUserRequest: latestUserRequest,
            lastSyntheticPrompt: proposalPrompt,
          }));

          message.info(
            t("pipelines.incrementalProposalStart", "先生成一个节点组合初步方案，确认后再逐个写入流程。"),
          );
          await dispatchSyntheticPrompt(proposalPrompt);
          return;
        }

        if (incrementalGeneration.createStage === "stepwise") {
          const parsed = parseStepFromAIResponse(payload.text || "");

          if (parsed.success && parsed.complete) {
            setIncrementalGeneration((prev) => ({
              ...prev,
              active: false,
              createStage: "ask_strategy",
              createStrategy: null,
              plannedSteps: [],
            }));
            setEditWelcomeMode("default");
            message.success(
              t("pipelines.incrementalGenerationDone", "流程节点已逐步生成完成。"),
            );
            return;
          }

          if (!parsed.success || !parsed.step) {
            if (incrementalGeneration.parseRetryCount < pipelineExecutionBudget.maxParseRetryCount) {
              const repairPrompt = buildJsonRepairPrompt(
                "create",
                payload.text || "",
                parsed.error,
              );
              await dispatchSyntheticPrompt(repairPrompt);
              setIncrementalGeneration((prev) => ({
                ...prev,
                parseRetryCount: prev.parseRetryCount + 1,
                lastSyntheticPrompt: repairPrompt,
              }));
              message.info(
                t("pipelines.stepParseRepairing", "模型返回格式不稳定，正在请求一次更严格的 JSON 重试。"),
              );
              return;
            }

            setDraftParseStatus("error");
            setDraftParseError(parsed.error || t("pipelines.stepParseFailed", "无法解析节点 JSON。"));
            message.warning(
              parsed.error || t("pipelines.stepParseFailed", "无法解析节点 JSON。"),
            );
            return;
          }

          try {
            const existingStepIds = new Set(draftNewVersionSteps.map((step) => step.id));
            const operation = existingStepIds.has(parsed.step.id) ? "update" : "add";
            const updated = await agentsApi.addOrUpdatePipelineStep(
              selectedAgent,
              activePipelineId,
              parsed.step,
              operation,
              {
                expectedRevision: incrementalGeneration.lastSuccessfulRevision ?? selectedTemplateItem?.revision,
              },
            );

            setTemplates((prev) => mergeTemplateUpdate(prev, updated));
            setDraftNewVersionSteps(updated.steps || []);
            setDraftParseStatus("ready");
            setDraftParseError("");
            setExpandedDraftDiffKeys([]);
            setIncrementalGeneration((prev) => ({
              ...prev,
              parseRetryCount: 0,
              lastSuccessfulRevision: updated.revision,
            }));

            const generatedCount = (updated.steps || []).length;
            const nextStepNumber = generatedCount + 1;
            const totalSteps = incrementalGeneration.totalStepsExpected;

            message.success(
              t("pipelines.incrementalStepSaved", "已生成第 {{current}} / {{total}} 步。", {
                current: Math.min(generatedCount, totalSteps),
                total: totalSteps,
              }),
            );

            if (generatedCount >= totalSteps) {
              setIncrementalGeneration((prev) => ({
                ...prev,
                active: false,
                createStage: "ask_strategy",
                createStrategy: null,
                plannedSteps: [],
              }));
              setEditWelcomeMode("default");
              return;
            }

            const nextPrompt = buildIncrementalStepGenerationPrompt(
              activePipelineId,
              activePipelineName,
              {
                totalStepsExpected: totalSteps,
                stepsGenerated: generatedCount,
                currentStep: nextStepNumber,
                isComplete: false,
              },
              updated.steps || [],
              incrementalGeneration.userRequirements,
              pipelineExecutionBudget,
            );

            await dispatchSyntheticPrompt(nextPrompt);

            setIncrementalGeneration((prev) => ({
              ...prev,
              currentStep: nextStepNumber,
              parseRetryCount: 0,
              lastSyntheticPrompt: nextPrompt,
            }));
            return;
          } catch (error) {
            console.error("failed to save incremental pipeline step", error);
            setDraftParseStatus("error");
            setDraftParseError(t("pipelines.stepSaveFailed", "节点保存失败，请检查后重试。"));
            message.error(t("pipelines.stepSaveFailed", "节点保存失败，请检查后重试。"));
            return;
          }
        }

        if (incrementalGeneration.createStage === "proposal") {
          const parsedProposal = parseStepProposalFromAIResponse(payload.text || "");

          if (!parsedProposal.success || !parsedProposal.steps || parsedProposal.steps.length === 0) {
            if (incrementalGeneration.parseRetryCount < pipelineExecutionBudget.maxParseRetryCount) {
              const repairPrompt = buildJsonRepairPrompt(
                "proposal",
                payload.text || "",
                parsedProposal.error,
              );
              await dispatchSyntheticPrompt(repairPrompt);
              setIncrementalGeneration((prev) => ({
                ...prev,
                parseRetryCount: prev.parseRetryCount + 1,
                lastSyntheticPrompt: repairPrompt,
              }));
              message.info(
                t("pipelines.stepParseRepairing", "模型返回格式不稳定，正在请求一次更严格的 JSON 重试。"),
              );
              return;
            }

            setDraftParseStatus("error");
            setDraftParseError(parsedProposal.error || t("pipelines.stepParseFailed", "无法解析节点 JSON。"));
            message.warning(
              parsedProposal.error || t("pipelines.stepParseFailed", "无法解析节点 JSON。"),
            );
            return;
          }

          const proposalSteps = parsedProposal.steps;

          setIncrementalGeneration((prev) => ({
            ...prev,
            createStage: "await_confirm",
            plannedSteps: proposalSteps,
            totalStepsExpected: proposalSteps.length,
            currentStep: 1,
            parseRetryCount: 0,
          }));
          setDraftParseStatus("idle");
          setDraftParseError("");
          setExpandedDraftDiffKeys([]);
          message.info(
            t(
              "pipelines.incrementalProposalReady",
              "节点组合初步方案已生成，请回复“确认创建流程”后按节点逐个写入。",
            ),
          );
          return;
        }

        if (incrementalGeneration.createStage === "await_confirm") {
          const latestUserRequest = await fetchLatestUserRequest();

          if (!isCreatePlanConfirmed(latestUserRequest)) {
            if (isIncrementalUserMessage(latestUserRequest, incrementalGeneration)) {
              const refreshedPrompt = buildInitialStepProposalPrompt(
                activePipelineId,
                activePipelineName,
                latestUserRequest,
                pipelineExecutionBudget,
              );
              await dispatchSyntheticPrompt(refreshedPrompt);
              setIncrementalGeneration((prev) => ({
                ...prev,
                createStage: "proposal",
                plannedSteps: [],
                currentStep: 1,
                totalStepsExpected: inferStepCountFromRequirements(latestUserRequest),
                parseRetryCount: 0,
                userRequirements: latestUserRequest,
                lastUserRequest: latestUserRequest,
                lastSyntheticPrompt: refreshedPrompt,
              }));
              message.info(
                t("pipelines.incrementalProposalRefresh", "已根据你的补充重新生成节点组合方案。"),
              );
            } else {
              message.info(
                t(
                  "pipelines.incrementalProposalConfirmHint",
                  "请先确认方案，回复“确认创建流程”后开始逐节点写入。",
                ),
              );
            }
            return;
          }

          await applyConfirmedCreatePlan(latestUserRequest);
          return;
        }

        return;
      }

      if (incrementalGeneration.active && incrementalGeneration.mode === "modify") {
        const parsed = parseStepOperationFromAIResponse(payload.text || "");

        if (parsed.success && parsed.complete) {
          setIncrementalGeneration((prev) => ({
            ...prev,
            active: false,
          }));
          message.success(
            parsed.message || t("pipelines.incrementalEditDone", "节点级修改已完成。"),
          );
          return;
        }

        if (parsed.success && parsed.needsUserInput) {
          setIncrementalGeneration((prev) => ({
            ...prev,
            active: false,
          }));
          message.info(
            parsed.message || t("pipelines.incrementalNeedsUserInput", "继续修改前需要你补充一些信息。"),
          );
          return;
        }

        if (!parsed.success || !parsed.operation) {
          if (incrementalGeneration.parseRetryCount < pipelineExecutionBudget.maxParseRetryCount) {
            const repairPrompt = buildJsonRepairPrompt(
              "modify",
              payload.text || "",
              parsed.error,
            );
            await dispatchSyntheticPrompt(repairPrompt);
            setIncrementalGeneration((prev) => ({
              ...prev,
              parseRetryCount: prev.parseRetryCount + 1,
              lastSyntheticPrompt: repairPrompt,
            }));
            message.info(
              t("pipelines.stepParseRepairing", "模型返回格式不稳定，正在请求一次更严格的 JSON 重试。"),
            );
            return;
          }

          setIncrementalGeneration((prev) => ({
            ...prev,
            active: false,
          }));
          setDraftParseStatus("error");
          setDraftParseError(parsed.error || t("pipelines.stepParseFailed", "无法解析节点 JSON。"));
          message.warning(parsed.error || t("pipelines.stepParseFailed", "无法解析节点 JSON。"));
          return;
        }

        try {
          const stepOrId: Parameters<typeof agentsApi.applyStepOperation>[3] =
            parsed.operation === "delete" ? (parsed.stepId || "") : parsed.step!;
          const updated = await agentsApi.applyStepOperation(
            selectedAgent,
            activePipelineId,
            parsed.operation,
            stepOrId,
            { expectedRevision: incrementalGeneration.lastSuccessfulRevision ?? selectedTemplateItem?.revision },
          );

          const nextOperationsApplied = incrementalGeneration.operationsApplied + 1;

          setTemplates((prev) => mergeTemplateUpdate(prev, updated));
          setDraftNewVersionSteps(updated.steps || []);
          setDraftParseStatus("ready");
          setDraftParseError("");
          setExpandedDraftDiffKeys([]);
          setIncrementalGeneration((prev) => ({
            ...prev,
            parseRetryCount: 0,
          }));

          message.success(
            parsed.operation === "delete"
              ? t("pipelines.incrementalDeleteApplied", "已删除 1 个节点，继续处理剩余变更。")
              : t("pipelines.incrementalEditApplied", "已应用 1 个节点级修改，继续处理剩余变更。"),
          );

          // Check operation budget before continuing auto-loop
          if (nextOperationsApplied >= pipelineExecutionBudget.maxAutoOperations) {
            setIncrementalGeneration((prev) => ({
              ...prev,
              active: false,
              operationsApplied: nextOperationsApplied,
              parseRetryCount: 0,
              lastSuccessfulRevision: updated.revision,
            }));
            message.info(
              t(
                "pipelines.operationBudgetExhausted",
                "已自动应用 {{count}} 次变更，请确认当前结果后继续。",
                { count: nextOperationsApplied },
              ),
            );
            return;
          }

          const nextPrompt = buildIncrementalStepEditPrompt(
            activePipelineId,
            activePipelineName,
            updated.steps || [],
            incrementalGeneration.userRequirements,
            nextOperationsApplied,
            pipelineExecutionBudget,
          );

          await dispatchSyntheticPrompt(nextPrompt);

          setIncrementalGeneration((prev) => ({
            ...prev,
            currentStep: prev.currentStep + 1,
            totalStepsExpected: updated.steps?.length || prev.totalStepsExpected,
            operationsApplied: nextOperationsApplied,
            parseRetryCount: 0,
            lastSuccessfulRevision: updated.revision,
            lastSyntheticPrompt: nextPrompt,
          }));
          return;
        } catch (error) {
          console.error("failed to save incremental pipeline edit", error);
          setIncrementalGeneration((prev) => ({
            ...prev,
            active: false,
          }));
          setDraftParseStatus("error");
          setDraftParseError(t("pipelines.stepSaveFailed", "节点保存失败，请检查后重试。"));
          message.error(t("pipelines.stepSaveFailed", "节点保存失败，请检查后重试。"));
          return;
        }
      }

      if (!incrementalGeneration.active) {
        try {
          const userRequirements = await fetchLatestUserRequest();

          if (isIncrementalUserMessage(userRequirements, incrementalGeneration)) {
            const steps = draftNewVersionSteps.length > 0
              ? draftNewVersionSteps
              : (selectedTemplateItem?.steps || currentTemplate?.steps || []);
            const mode: "create" | "modify" =
              editWelcomeMode === "init" || steps.length === 0 ? "create" : "modify";

            await startIncrementalWorkflow(mode, userRequirements, steps);
            return;
          }
        } catch (error) {
          console.warn("failed to bootstrap incremental pipeline workflow", error);
        }
      }

      void agentsApi
        .getPipelineDraft(selectedAgent, activePipelineId)
        .then((draftInfo) => {
          if (draftInfo.validation_errors && draftInfo.validation_errors.length > 0) {
            const firstError = draftInfo.validation_errors[0];
            setSaveValidationErrors(draftInfo.validation_errors);
            message.warning(
              t(
                "pipelines.draftValidationFailed",
                "流程 Markdown 校验失败：{{detail}}",
                { detail: firstError.message || firstError.error_code || "unknown error" },
              ),
            );
            return;
          }

          const mdMtime = draftInfo.md_mtime || 0;
          if (mdMtime <= lastDraftMdMtime) {
            return;
          }

          setLastDraftMdMtime(mdMtime);
          if (!draftInfo.steps || draftInfo.steps.length === 0) {
            return;
          }

          setDraftNewVersionSteps(draftInfo.steps);
          setDraftParseStatus("ready");
          setDraftParseError("");
          setExpandedDraftDiffKeys([]);
        })
        .catch(() => {
          // Ignore when draft markdown does not exist yet.
        });
    },
    [
      applyConfirmedCreatePlan,
      designChatSessionId,
      draftNewVersionSteps,
      editMode,
      editWelcomeMode,
      incrementalGeneration,
      lastDraftMdMtime,
      currentTemplate?.steps,
      selectedAgent,
      selectedPipeline?.id,
      selectedPipeline?.name,
      selectedTemplateItem?.id,
      selectedTemplateItem?.name,
      selectedTemplateItem?.revision,
      selectedTemplateItem?.steps,
      pipelineExecutionBudget,
      t,
    ],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!import.meta.env.DEV) return;
    if (!window.__COPAW_ENABLE_TEST_HOOKS__) return;

    window.__COPAW_PIPELINES_TEST__ = {
      activateIncrementalModify: (overrides = {}) => {
        setIncrementalGeneration((prev) => ({
          ...prev,
          active: true,
          mode: "modify",
          totalStepsExpected:
            overrides.totalStepsExpected ??
            draftNewVersionSteps.length ??
            selectedTemplateItem?.steps?.length ??
            prev.totalStepsExpected,
          currentStep: overrides.currentStep ?? 1,
          userRequirements: overrides.userRequirements ?? "delete the selected step",
          lastUserRequest: overrides.lastUserRequest ?? "delete the selected step",
          lastSyntheticPrompt: overrides.lastSyntheticPrompt ?? "",
          operationsApplied: overrides.operationsApplied ?? 0,
          parseRetryCount: overrides.parseRetryCount ?? 0,
        }));
      },
      completeAssistantTurn: (text: string) =>
        handleAssistantTurnCompleted({
          text,
          response: null,
        }),
      getDraftStepIds: () => draftNewVersionSteps.map((step) => step.id),
    };

    return () => {
      delete window.__COPAW_PIPELINES_TEST__;
    };
  }, [draftNewVersionSteps, handleAssistantTurnCompleted, selectedTemplateItem?.steps]);

  const toggleDraftDiffDetails = useCallback((key: string) => {
    setExpandedDraftDiffKeys((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key],
    );
  }, []);

  const toggleAllDraftDiffDetails = useCallback(() => {
    setExpandedDraftDiffKeys(allDraftDiffExpanded ? [] : draftDiffDetailKeys);
  }, [allDraftDiffExpanded, draftDiffDetailKeys]);

  const renderDiffTokenText = useCallback(
    (
      tokens: InlineDiffToken[],
      changedClassName: string,
      neutralClassName: string,
    ) => {
      if (draftDiffViewMode === "changedOnly") {
        return (
          <span className={changedClassName}>{buildChangedOnlyText(tokens)}</span>
        );
      }

      return tokens.map((token, tokenIndex) => (
        <span
          key={`${token.text}-${tokenIndex}`}
          className={token.changed ? changedClassName : neutralClassName}
        >
          {token.text}
        </span>
      ));
    },
    [draftDiffViewMode],
  );

  const renderDiffPair = useCallback(
    (detailKey: string, field: DiffFieldKey, oldValue: string, newValue: string) => {
      const tokenDiff = buildInlineDiffTokens(oldValue, newValue);

      return (
        <div key={`${detailKey}-${field}`} className={styles.diffDetailRow}>
          <Text strong>{field}</Text>
          <div className={styles.diffPairGrid}>
            <div className={`${styles.diffPairColumn} ${styles.diffPairOld}`}>
              <Text type="secondary" className={styles.diffPairLabel}>
                {t("pipelines.diffOldValue", "旧值")}
              </Text>
              <Text className={styles.diffOldText}>
                {renderDiffTokenText(
                  tokenDiff.oldTokens,
                  styles.diffTokenRemoved,
                  styles.diffTokenNeutral,
                )}
              </Text>
            </div>
            <div className={`${styles.diffPairColumn} ${styles.diffPairNew}`}>
              <Text type="secondary" className={styles.diffPairLabel}>
                {t("pipelines.diffNewValue", "新值")}
              </Text>
              <Text className={styles.diffNewText}>
                {renderDiffTokenText(
                  tokenDiff.newTokens,
                  styles.diffTokenAdded,
                  styles.diffTokenNeutral,
                )}
              </Text>
            </div>
          </div>
        </div>
      );
    },
    [renderDiffTokenText, t],
  );

  useEffect(() => {
    setExpandedDraftDiffKeys((prev) =>
      prev.filter((key) => draftDiffDetailKeys.includes(key)),
    );
  }, [draftDiffDetailKeys]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <Title level={3} className={styles.title}>
            {t("pipelines.title", "Pipelines")}
          </Title>
          <Text className={styles.subtitle}>
            {t(
              "pipelines.description",
              "Manage reusable pipeline definitions across projects, then validate and tune in Projects.",
            )}
          </Text>
        </div>
        <div className={styles.actions}>
          <Select
            size="small"
            value={sourceFilter}
            style={{ width: 180 }}
            onChange={(value) => setSourceFilter(value)}
            options={[
              { value: "all", label: t("pipelines.sourceFilterAll", "全部来源") },
              { value: "independent", label: t("pipelines.sourceFilterIndependent", "仅独立模板") },
              { value: "project", label: t("pipelines.sourceFilterProject", "仅项目模板") },
            ]}
          />
          <Button
            data-testid="pipeline-open-design-chat"
            loading={designChatStarting}
            disabled={designChatStarting}
            onClick={() => void handleCreatePipelineAndEnterEdit()}
          >
            {t("pipelines.create", "新建")}
          </Button>
          <Button type="primary" onClick={() => navigate("/projects")}>
            {t("pipelines.openProjects", "Open Projects to Run")}
          </Button>
        </div>
      </div>

      {projects.length === 0 ? (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Text type="secondary">
            {t(
              "pipelines.noProjectsIndependentHint",
              "当前没有项目，但你仍可新建与编辑独立流程草稿。需要落盘时请先创建项目。",
            )}
          </Text>
        </Card>
      ) : null}

      <div className={styles.metrics}>
        <Card size="small" className={styles.metricCard}>
          <Text className={styles.metricLabel}>
            {t("pipelines.totalTemplates", "Template Variants")}
          </Text>
          <div className={styles.metricValue}>{templates.length}</div>
        </Card>
        <Card size="small" className={styles.metricCard}>
          <Text className={styles.metricLabel}>
            {t("pipelines.totalRuns", "Total Runs")}
          </Text>
          <div className={styles.metricValue}>{runs.length}</div>
        </Card>
        <Card size="small" className={styles.metricCard}>
          <Text className={styles.metricLabel}>
            {t("pipelines.runningRuns", "Running")}
          </Text>
          <div className={styles.metricValue}>{runningCount}</div>
        </Card>
      </div>

      <div className={styles.content}>
        {loading ? (
          <div className={styles.loadingWrap}>
            <Spin size="large" />
          </div>
        ) : error ? (
          <Card>
            <Text type="danger">{error}</Text>
          </Card>
        ) : !currentAgent ? (
          <Card>
            <Empty
              description={t("pipelines.noAgent", "No active agent selected.")}
            />
          </Card>
        ) : projects.length === 0 && templates.length === 0 ? (
          <Card>
            <Empty
              description={t(
                "pipelines.noProjects",
                "No projects found for the current agent.",
              )}
            />
          </Card>
        ) : (
          <div className={styles.columns}>
            <Card
              title={t("pipelines.library", "Pipeline Library")}
              className={styles.columnCard}
            >
              {pipelineGroups.length === 0 ? (
                <Empty
                  description={t(
                    "pipelines.emptyTemplates",
                    "No pipeline templates found yet.",
                  )}
                />
              ) : (
                <div className={styles.list}>
                  {pipelineGroups.map((item) => {
                    const selected = item.key === selectedPipelineKey;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className={`${styles.listItem} ${selected ? styles.selected : ""}`}
                        onClick={() => requestSelectPipeline(item.key)}
                      >
                        <div className={styles.listItemHeader}>
                          <Text strong>{item.name}</Text>
                          <Tag>{item.versions.length}</Tag>
                          <Tag color={item.source === "independent" ? "cyan" : "gold"}>
                            {item.source === "independent"
                              ? t("pipelines.sourceIndependent", "独立")
                              : t("pipelines.sourceProject", "项目")}
                          </Tag>
                          {draftPipelineKeys.includes(item.key) ? (
                            <Tag color="warning">
                              {t("pipelines.draftBadge", "未保存")}
                            </Tag>
                          ) : null}
                        </div>
                        <Text type="secondary">{item.description || item.id}</Text>
                        <Text type="secondary" className={styles.helperText}>
                          {t("pipelines.versionCount", "Versions: {{count}}", {
                            count: item.versions.length,
                          })}
                        </Text>
                        <Text type="secondary" className={styles.helperText}>
                          {t("pipelines.usedIn", "Used in {{count}} projects", {
                            count: item.projects.length,
                          })}
                        </Text>
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card
              title={t("pipelines.nodes", "Current Nodes")}
              className={styles.columnCard}
              extra={
                <div className={styles.nodesActions}>
                  <Select
                    size="small"
                    className={styles.versionSelect}
                    value={selectedCurrentVersion || undefined}
                    placeholder={t("pipelines.currentVersion", "Current version")}
                    options={(selectedPipeline?.versions || []).map((item) => ({
                      label: item.version || "0",
                      value: normalizeVersion(item.version),
                    }))}
                    onChange={(value) => {
                      setSelectedCurrentVersion(value);
                      if (value === selectedCompareVersion) {
                        setSelectedCompareVersion("");
                      }
                    }}
                  />
                  {editMode ? (
                    <>
                      {selectedIsDraft ? (
                        <Button
                          size="small"
                          type="primary"
                          loading={draftSaving}
                          disabled={draftSaving}
                          onClick={() => void handleSaveDraftPipeline()}
                        >
                          {t("pipelines.saveDraft", "保存")}
                        </Button>
                      ) : null}
                      <Button
                        size="small"
                        onClick={requestCloseEditMode}
                      >
                        {t("pipelines.exitEdit", "Exit Edit")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="small"
                      type="primary"
                      loading={designChatStarting}
                      disabled={!currentTemplate || designChatStarting}
                      onClick={() => void handleEnterEditMode()}
                    >
                      {t("pipelines.enterEdit", "Edit Pipeline")}
                    </Button>
                  )}
                </div>
              }
            >
              {!currentTemplate ? (
                <Empty
                  description={t(
                    "pipelines.selectPipeline",
                    "Select a pipeline to view nodes.",
                  )}
                />
              ) : currentTemplate.steps.length === 0 ? (
                <Empty
                  description={t(
                    "pipelines.emptyNodes",
                    "No nodes in this pipeline version.",
                  )}
                />
              ) : (
                <div className={styles.list}>
                  {currentTemplate.steps.map((step) => (
                    <div key={step.id} className={styles.listItemStatic}>
                      <div className={styles.listItemHeader}>
                        <Text strong>{step.name}</Text>
                        <Tag color="blue">{step.kind}</Tag>
                      </div>
                      <Text type="secondary">{step.id}</Text>
                      <Text type="secondary" className={styles.helperText}>
                        {step.description || "-"}
                      </Text>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card
              title={t("pipelines.newVersionNodes", "New Version Nodes")}
              className={styles.columnCard}
              extra={
                <div className={styles.newVersionActions}>
                  {editMode && draftParseStatus === "ready" && realtimeDraftDiffItems.length > 0 ? (
                    <Button
                      size="small"
                      onClick={() =>
                        setDraftDiffViewMode((prev) =>
                          prev === "changedOnly" ? "full" : "changedOnly",
                        )
                      }
                    >
                      {draftDiffViewMode === "changedOnly"
                        ? t("pipelines.diffViewFull", "显示全文")
                        : t("pipelines.diffViewChangedOnly", "只看变化")}
                    </Button>
                  ) : null}
                  {editMode && draftParseStatus === "ready" && realtimeDraftDiffItems.length > 0 ? (
                    <Button size="small" onClick={toggleAllDraftDiffDetails}>
                      {allDraftDiffExpanded
                        ? t("pipelines.diffCollapseAll", "收起全部")
                        : t("pipelines.diffExpandAll", "展开全部")}
                    </Button>
                  ) : null}
                  <Select
                    size="small"
                    className={styles.versionSelect}
                    value={selectedCompareVersion || undefined}
                    allowClear
                    placeholder={t("pipelines.compareVersion", "Select history version")}
                    options={(selectedPipeline?.versions || [])
                      .filter((item) => normalizeVersion(item.version) !== selectedCurrentVersion)
                      .map((item) => ({
                        label: item.version || "0",
                        value: normalizeVersion(item.version),
                      }))}
                    onChange={(value) => setSelectedCompareVersion(value || "")}
                  />
                </div>
              }
            >
              {editMode && (saveStreamEvents.length > 0 || saveStreamError) ? (
                <div className={styles.saveStreamPanel}>
                  <Text type="secondary" className={styles.saveStreamTitle}>
                    {t("pipelines.saveStreamTimeline", "保存事件")}
                  </Text>
                  {saveStreamEvents.map((item, index) => (
                    <Text key={`${item.event}-${item.ts}-${index}`} type="secondary" className={styles.saveStreamItem}>
                      {new Date(item.ts).toLocaleTimeString()} · {item.event}
                      {item.detail ? ` · ${item.detail}` : ""}
                    </Text>
                  ))}
                  {saveStreamError ? (
                    <Text type="danger" className={styles.saveStreamError}>
                      {t("pipelines.saveStreamError", "保存失败：{{detail}}", {
                        detail: saveStreamError,
                      })}
                    </Text>
                  ) : null}
                  {saveValidationErrors.length > 0 ? (
                    <div className={styles.validationErrorList}>
                      {saveValidationErrors.map((item, index) => (
                        <div key={`${item.error_code}-${item.field_path}-${index}`} className={styles.validationErrorItem}>
                          <Text type="danger" className={styles.validationErrorTitle}>
                            {item.error_code} · {item.field_path || "unknown_field"}
                          </Text>
                          <Text type="secondary" className={styles.validationErrorText}>
                            {item.message}
                          </Text>
                          {item.step_id ? (
                            <Text type="secondary" className={styles.validationErrorText}>
                              step_id: {item.step_id}
                            </Text>
                          ) : null}
                          {item.suggestion ? (
                            <Text type="secondary" className={styles.validationErrorText}>
                              suggestion: {item.suggestion}
                            </Text>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {saveConflictInfo ? (
                    <div className={styles.conflictPanel}>
                      <Text type="warning" className={styles.conflictTitle}>
                        {t("pipelines.conflictTitle", "检测到并发冲突")}
                      </Text>
                      <Text type="secondary" className={styles.validationErrorText}>
                        {t(
                          "pipelines.conflictDetail",
                          "本地预期 revision={{expected}}，远端当前 revision={{current}}。",
                          {
                            expected: saveConflictInfo.expectedRevision,
                            current: saveConflictInfo.currentRevision,
                          },
                        )}
                      </Text>
                      {saveConflictInfo.currentContentHash ? (
                        <Text type="secondary" className={styles.validationErrorText}>
                          hash: {saveConflictInfo.currentContentHash}
                        </Text>
                      ) : null}
                      <Button size="small" onClick={() => void handleRefreshAfterConflict()}>
                        {t("pipelines.conflictRefresh", "刷新后重试")}
                      </Button>
                      {conflictRemoteDraftBackup.length > 0 ? (
                        <Button size="small" onClick={() => void handleUseRemoteDraftAfterConflict()}>
                          {t("pipelines.conflictUseRemote", "采用远端草稿")}
                        </Button>
                      ) : null}
                      {conflictMergeAvailable ? (
                        <Button size="small" onClick={() => void handleMergeDraftAfterConflict()}>
                          {t("pipelines.conflictMerge", "按 step_id 合并")}
                        </Button>
                      ) : null}
                      {conflictRestoreAvailable ? (
                        <Button size="small" onClick={() => void handleRestoreLocalDraftAfterConflict()}>
                          {t("pipelines.conflictRestoreLocal", "恢复本地草稿")}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {editMode && draftParseStatus === "ready" && draftNewVersionSteps.length > 0 ? (
                <>
                  <Text type="secondary" className={styles.draftStatusText}>
                    {t("pipelines.draftRealtimeReady", "已根据最新对话更新节点草稿")}
                  </Text>
                  <div className={styles.list}>
                    {realtimeDraftDiffItems.map((item) => (
                      <div key={`draft-${item.kind}-${item.id}`} className={styles.listItemStatic}>
                        <div className={styles.listItemHeader}>
                          <Text strong>{item.current?.name || item.compare?.name || item.id}</Text>
                          <Tag
                            color={
                              item.kind === "added"
                                ? "success"
                                : item.kind === "removed"
                                  ? "error"
                                  : item.kind === "changed"
                                    ? "warning"
                                    : "default"
                            }
                          >
                            {item.kind === "added"
                              ? t("pipelines.diffAdded", "Added")
                              : item.kind === "removed"
                                ? t("pipelines.diffRemoved", "Removed")
                                : item.kind === "changed"
                                  ? t("pipelines.diffChanged", "Changed")
                                  : t("pipelines.diffUnchanged", "Unchanged")}
                          </Tag>
                          {item.current?.kind ? <Tag color="processing">{item.current.kind}</Tag> : null}
                        </div>
                        <Text type="secondary">{item.id}</Text>
                        <Text type="secondary" className={styles.helperText}>
                          {item.current?.description || item.compare?.description || "-"}
                        </Text>
                        {(() => {
                          const detailKey = `${item.kind}:${item.id}`;
                          const expanded = expandedDraftDiffKeys.includes(detailKey);
                          return (
                            <>
                              <Button
                                type="link"
                                size="small"
                                className={styles.diffDetailToggle}
                                onClick={() => toggleDraftDiffDetails(detailKey)}
                              >
                                {expanded
                                  ? t("pipelines.diffDetailHide", "收起详情")
                                  : t("pipelines.diffDetailShow", "查看详情")}
                              </Button>
                              {expanded ? (
                                <div className={styles.diffDetailPanel}>
                                  {item.kind === "changed" ? (
                                    item.changedFields.map((field) => {
                                      const typedField = field as DiffFieldKey;
                                      return renderDiffPair(
                                        detailKey,
                                        typedField,
                                        getStepFieldValue(item.compare, typedField),
                                        getStepFieldValue(item.current, typedField),
                                      );
                                    })
                                  ) : item.kind === "added" ? (
                                    (["name", "kind", "description"] as DiffFieldKey[]).map((field) => {
                                      return renderDiffPair(
                                        detailKey,
                                        field,
                                        "-",
                                        getStepFieldValue(item.current, field),
                                      );
                                    })
                                  ) : (
                                    (["name", "kind", "description"] as DiffFieldKey[]).map((field) => {
                                      return renderDiffPair(
                                        detailKey,
                                        field,
                                        getStepFieldValue(item.compare, field),
                                        "-",
                                      );
                                    })
                                  )}
                                </div>
                              ) : null}
                            </>
                          );
                        })()}
                        {item.kind === "changed" && item.changedFields.length > 0 ? (
                          <Text type="secondary" className={styles.helperText}>
                            {t("pipelines.diffFields", "Changed: {{fields}}", {
                              fields: item.changedFields.join(", "),
                            })}
                          </Text>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </>
              ) : editMode && draftParseStatus === "error" ? (
                <Empty description={draftParseError || t("pipelines.draftParseError", "节点草稿解析失败")} />
              ) : editMode ? (
                <Empty
                  description={t(
                    "pipelines.draftRealtimeHint",
                    "当右侧编辑对话修改流程 Markdown 工作文件后，这里会根据后端 draft 自动更新。",
                  )}
                />
              ) : !compareTemplate ? (
                <Empty
                  description={t(
                    "pipelines.selectNewVersion",
                    "Select a version as the new draft to compare with current nodes.",
                  )}
                />
              ) : newVersionDiffItems.length === 0 ? (
                <Empty
                  description={t(
                    "pipelines.noDiff",
                    "No diff available for this version pair.",
                  )}
                />
              ) : (
                <div className={styles.list}>
                  {newVersionDiffItems.map((item) => (
                    <div key={`${item.kind}-${item.id}`} className={styles.listItemStatic}>
                      <div className={styles.listItemHeader}>
                        <Text strong>{item.current?.name || item.compare?.name || item.id}</Text>
                        <Tag
                          color={
                            item.kind === "added"
                              ? "success"
                              : item.kind === "removed"
                                ? "error"
                                : item.kind === "changed"
                                  ? "warning"
                                  : "default"
                          }
                        >
                          {item.kind === "added"
                            ? t("pipelines.diffAdded", "Added")
                            : item.kind === "removed"
                              ? t("pipelines.diffRemoved", "Removed")
                              : item.kind === "changed"
                                ? t("pipelines.diffChanged", "Changed")
                                : t("pipelines.diffUnchanged", "Unchanged")}
                        </Tag>
                      </div>
                      <Text type="secondary">{item.id}</Text>
                      <Text type="secondary" className={styles.helperText}>
                        {item.current?.description || item.compare?.description || "-"}
                      </Text>
                      {item.kind === "changed" && item.changedFields.length > 0 && (
                        <Text type="secondary" className={styles.helperText}>
                          {t("pipelines.diffFields", "Changed: {{fields}}", {
                            fields: item.changedFields.join(", "),
                          })}
                        </Text>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card
              title={editMode ? t("pipelines.editChat", "Pipeline Edit Chat") : t("pipelines.recentRuns", "Recent Runs")}
              className={`${styles.columnCard} ${editMode ? styles.chatColumn : ""}`}
              extra={
                editMode && designChatSessionId ? (
                  <Button size="small" onClick={() => navigate(`/chat/${designChatSessionId}`)}>
                    {t("pipelines.openInFullChat", "Open Full Chat")}
                  </Button>
                ) : undefined
              }
              styles={editMode ? { body: { padding: 0, height: "calc(100% - 56px)", overflow: "hidden" } } : undefined}
            >
              {editMode ? (
                designChatStarting ? (
                  <div className={styles.chatLoadingWrap}>
                    <Spin size="large" />
                  </div>
                ) : designChatSessionId ? (
                  <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                    {editWelcomeMode === "init" && incrementalGeneration.active && incrementalGeneration.mode === "create" ? (
                      <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(5, 5, 5, 0.06)", display: "flex", flexDirection: "column", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                          <Text type="secondary">
                            {incrementalGeneration.createStage === "applying"
                              ? t("pipelines.incrementalProgress", "逐步生成中：第 {{current}} / {{total}} 步", {
                                current: incrementalGeneration.currentStep,
                                total: incrementalGeneration.totalStepsExpected,
                              })
                              : incrementalGeneration.createStage === "ask_strategy"
                                ? t(
                                  "pipelines.incrementalChooseStrategyBanner",
                                  "第 2 步：请选择创建策略（1 逐节点 / 2 先规划后逐个改）。",
                                )
                                : incrementalGeneration.createStage === "stepwise"
                                  ? t(
                                    "pipelines.incrementalStepwiseBanner",
                                    "逐节点模式进行中：每次生成并写入 1 个节点。",
                                  )
                                  : incrementalGeneration.createStage === "proposal"
                                    ? t(
                                      "pipelines.incrementalProposalBuildingBanner",
                                      "正在生成节点组合方案，请稍候确认。",
                                    )
                              : t(
                                "pipelines.incrementalProposalAwaitConfirm",
                                "节点组合方案已就绪（{{count}} 个节点），确认后将逐个写入。",
                                { count: incrementalGeneration.plannedSteps.length },
                              )}
                          </Text>
                          {incrementalGeneration.createStage === "await_confirm" ? (
                            <Button
                              size="small"
                              type="primary"
                              onClick={() => void applyConfirmedCreatePlan("确认创建流程")}
                            >
                              {t("pipelines.confirmAndCreate", "确认并创建节点")}
                            </Button>
                          ) : incrementalGeneration.createStage === "ask_strategy" ? (
                            <div style={{ display: "flex", gap: 8 }}>
                              <Button
                                size="small"
                                onClick={() => void handleSelectCreateStrategyByButton("stepwise")}
                              >
                                {t("pipelines.strategyStepwise", "逐节点添加")}
                              </Button>
                              <Button
                                size="small"
                                type="primary"
                                onClick={() => void handleSelectCreateStrategyByButton("plan_then_refine")}
                              >
                                {t("pipelines.strategyPlanThenRefine", "先规划后逐个改")}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                        {incrementalGeneration.userRequirements ? (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                            <Text type="secondary" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {t("pipelines.topicSummaryLabel", "流程主题")}: {incrementalGeneration.userRequirements}
                            </Text>
                            <Button size="small" type="link" onClick={() => void handleEditCreateTopic()}>
                              {t("pipelines.editTopic", "编辑主题")}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div style={{ minHeight: 0, flex: 1 }}>
                      <AnywhereChat
                        sessionId={designChatSessionId}
                        onNewChat={() => {
                          void handleOpenDesignChat(true, undefined, {
                            forceNewSession: true,
                          });
                        }}
                        onAssistantTurnCompleted={handleAssistantTurnCompleted}
                        inputPlaceholder={editGuidePlaceholder || undefined}
                        welcomeGreeting={t(
                          editWelcomeMode === "init"
                            ? "pipelines.editWelcomeGreetingInit"
                            : "pipelines.editWelcomeGreeting",
                          editWelcomeMode === "init"
                            ? "你要做一个关于什么的流程？先告诉我流程目标与场景。"
                            : "流程编辑助手已就绪，你想先改哪一步？",
                        )}
                        welcomeDescription={t(
                          editWelcomeMode === "init"
                            ? "pipelines.editWelcomeDescriptionInit"
                            : "pipelines.editWelcomeDescription",
                          editWelcomeMode === "init"
                            ? [
                              "先用一句话描述：你要做一个关于什么的流程。",
                              "收到主题后，我会引导你选择创建策略：逐节点添加，或先整体规划再逐个修改。",
                              "无论哪种策略，节点都会在通过校验后即时写回流程草稿。",
                            ].join("\n")
                            : "我会基于当前流程结构给出节点级修改建议，并帮助你整理可执行的改造方案。",
                        )}
                        welcomePrompts={
                          editWelcomeMode === "init"
                            ? []
                            : [
                              t(
                                "pipelines.editWelcomePrompt1",
                                "分析当前流程瓶颈，并直接修改流程 Markdown 工作文件落实优化建议。",
                              ),
                              t(
                                "pipelines.editWelcomePrompt2",
                                "我要改这个流程：新增校验节点、调整重试策略，并把变更写回流程 Markdown。",
                              ),
                            ]
                        }
                      />
                    </div>
                  </div>
                ) : (
                  <Empty
                    description={t(
                      "pipelines.chatPanelHint",
                      "Start a design chat to iterate without leaving this page.",
                    )}
                  />
                )
              ) : visibleRuns.length === 0 ? (
                <Empty
                  description={t(
                    "pipelines.emptyRuns",
                    "No pipeline runs yet.",
                  )}
                />
              ) : (
                <div className={styles.list}>
                  {visibleRuns.map((run) => (
                    <div key={run.id} className={styles.listItemStatic}>
                      <div className={styles.listItemHeader}>
                        <Text strong>{run.template_id}</Text>
                        <Tag color={statusTagColor(run.status)}>{run.status}</Tag>
                      </div>
                      <Text type="secondary">
                        {t("pipelines.projectLabel", "Project: {{name}}", {
                          name: run.projectName,
                        })}
                      </Text>
                      <Text type="secondary" className={styles.helperText}>
                        {run.updated_at || run.created_at}
                      </Text>
                      <div className={styles.runActions}>
                        <Button
                          size="small"
                          type="link"
                          className={styles.runLink}
                          onClick={() => {
                            setSourceFilter("project");
                            setSelectedPipelineKey(
                              buildPipelineGroupKey(run.template_id, "project"),
                            );
                            setSelectedCompareVersion("");
                          }}
                        >
                          {t("pipelines.focusPipeline", "Focus Pipeline")}
                        </Button>
                        <Button
                          size="small"
                          type="link"
                          className={styles.runLink}
                          onClick={() => navigate("/projects")}
                        >
                          {t("pipelines.goToProjects", "Go to Projects")}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}