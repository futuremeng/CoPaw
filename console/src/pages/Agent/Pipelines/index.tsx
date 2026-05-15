import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Drawer, Empty, Input, Modal, Select, Spin, Tag, Typography, message } from "antd";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { agentsApi } from "../../../api/modules/agents";
import { providerApi } from "../../../api/modules/provider";
import { agentApi } from "../../../api/modules/agent";
import { chatApi } from "../../../api/modules/chat";
import { knowledgeApi } from "../../../api/modules/knowledge";
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
  ProjectPipelineRunDetail,
  ProjectPipelineRunStep,
  PipelineValidationError,
  ProjectPipelineTemplateStep,
  ProjectPipelineRunSummary,
  ProjectPipelineTemplateInfo,
  RpaTemplatePackageDocument,
} from "../../../api/types/agents";
import type { ActiveModelsInfo, ProviderInfo } from "../../../api/types/provider";
import type { AgentsRunningConfig } from "../../../api/types/agent";
import type { ChatSpec } from "../../../api/types/chat";
import type { ProjectKnowledgeProcessingMode, ProjectKnowledgeSyncState } from "../../../api/types/knowledge";
import { useAgentStore } from "../../../stores/agentStore";
import { deriveBuiltinProjectKnowledgeStages } from "./builtinStages.ts";
import styles from "./index.module.less";

const { Title, Text } = Typography;
const { TextArea } = Input;

type TemplateItem = ProjectPipelineTemplateInfo & {
  projectId: string;
  projectName: string;
  sourceScope?: PipelineSourceKind;
  projectCreatedTime?: string;
};

type RunItem = ProjectPipelineRunSummary & {
  projectId: string;
  projectName: string;
};

type PipelineManagementData = {
  templates: TemplateItem[];
};

type PersistedPipelineDraftState = {
  version: 1;
  templates: TemplateItem[];
  draftPipelineKeys: string[];
  selectedPipelineKey: string;
  selectedCurrentVersion: string;
  selectedCompareVersion: string;
  sourceFilter: "all" | "independent" | "project" | "builtin";
  draftNewVersionSteps: ProjectPipelineTemplateStep[];
  draftParseStatus: "idle" | "ready" | "error";
  draftParseError: string;
};

type PipelineSourceKind = "independent" | "project" | "builtin";

type PipelineGroup = {
  key: string;
  id: string;
  name: string;
  description: string;
  versions: ProjectPipelineTemplateInfo[];
  projects: { id: string; name: string; createdTime?: string }[];
  source: PipelineSourceKind;
  groupProjectId?: string;
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
  source?: PipelineSourceKind;
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
  focus_scope: PipelineSourceKind;
  focus_flow_memory_path?: string;
  // Legacy compatibility fields
  binding_type: "pipeline_edit";
  pipeline_binding_key: string;
  pipeline_id: string;
  pipeline_name: string;
  pipeline_version: string;
  pipeline_scope: PipelineSourceKind;
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
const BUILTIN_PIPELINE_SCOPE_ID = "__builtin__";
const PIPELINE_DRAFT_STORAGE_PREFIX = "copaw:pipelines:drafts:";
const BUILTIN_KNOWLEDGE_PIPELINE_TEMPLATE_ID = "builtin-knowledge-processing-v1";
const INITIAL_VISIBLE_RUNS = 30;
const LOAD_MORE_RUNS_STEP = 10;
const LEGACY_PROJECT_KNOWLEDGE_STEP_IDS = new Set([
  "file_analysis",
  "source_scan",
  "ner",
  "cor",
  "syntax",
  "quality_review",
]);
const CANONICAL_PROJECT_KNOWLEDGE_STEPS: ProjectPipelineTemplateStep[] = [
  {
    id: "snapshot_raw",
    name: "Raw Snapshot",
    kind: "ingest",
    description: "Create a versioned snapshot of each source file into .knowledge/raw, recording file hash, mtime, and byte size.",
  },
  {
    id: "build_chunks",
    name: "Build Chunks",
    kind: "transform",
    description: "Split raw snapshots into semantic chunks (paragraphs / sections) and write chunk payloads to .knowledge/chunks.",
  },
  {
    id: "build_interlinear",
    name: "Build Interlinear",
    kind: "transform",
    description: "Normalise each raw snapshot into sentence-per-line interlinear text files (.knowledge/interlinear) for downstream NLP stages.",
  },
  {
    id: "tokenize",
    name: "Tokenize",
    kind: "transform",
    description: "Run word segmentation on interlinear files and write token sequences to .knowledge/tokenize.",
  },
  {
    id: "pos_tagging",
    name: "POS Tagging",
    kind: "transform",
    description: "Assign part-of-speech tags to each token using tokenize output; write POS sequences to .knowledge/pos.",
  },
  {
    id: "syntax_parse",
    name: "Syntax Parse",
    kind: "transform",
    description: "Build dependency parse trees from tokenize output and write syntax artifacts to .knowledge/syntax.",
  },
  {
    id: "semantic_role_labeling",
    name: "Semantic Role Labeling",
    kind: "transform",
    description: "Identify predicates and annotate semantic role arguments from tokenize output; write SRL artifacts to .knowledge/srl.",
  },
];

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

function getTemplateSourceKind(item: TemplateItem): PipelineSourceKind {
  if (item.sourceScope) {
    return item.sourceScope;
  }
  if (item.projectId === INDEPENDENT_PIPELINE_SCOPE_ID) return "independent";
  if (item.projectId === BUILTIN_PIPELINE_SCOPE_ID) return "builtin";
  if (item.projectId) return "project";
  const normalizedTags = (item.tags || [])
    .map((tag) => String(tag || "").trim().toLowerCase())
    .filter(Boolean);
  const declaredBuiltin = normalizedTags.includes("builtin") || Boolean(item.system_owned && item.builtin_kind);
  const publishedFromProject = Boolean(String(item.source_project_id || "").trim());
  if (declaredBuiltin && !publishedFromProject) return "builtin";
  return "project";
}

function shouldDisplayCanonicalProjectKnowledgeSteps(
  templateId: string,
  steps: ProjectPipelineTemplateStep[],
): boolean {
  if (templateId !== BUILTIN_KNOWLEDGE_PIPELINE_TEMPLATE_ID || steps.length === 0) {
    return false;
  }

  const stepIds = steps.map((step) => String(step.id || "").trim().toLowerCase());
  const hasLegacyOnlyStep = stepIds.some((id) => LEGACY_PROJECT_KNOWLEDGE_STEP_IDS.has(id));
  const alreadyCanonical = stepIds.includes("snapshot_raw") && stepIds.includes("semantic_role_labeling");
  return hasLegacyOnlyStep && !alreadyCanonical;
}

function resolveDisplaySteps(
  templateId: string,
  steps: ProjectPipelineTemplateStep[],
): ProjectPipelineTemplateStep[] {
  if (!shouldDisplayCanonicalProjectKnowledgeSteps(templateId, steps)) {
    return steps;
  }
  return CANONICAL_PROJECT_KNOWLEDGE_STEPS;
}

function pickTemplatePathField(template: TemplateItem | null): string {
  if (!template) return "";
  const raw = template as unknown as Record<string, unknown>;
  const keys = ["md_relative_path", "md_path", "template_path", "template_file", "file_path", "path"];
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function isProjectDerivedBuiltinKnowledgeTemplate(item: {
  id: string;
  projectId: string;
  system_owned?: boolean;
  builtin_kind?: string;
}): boolean {
  return (
    item.id === BUILTIN_KNOWLEDGE_PIPELINE_TEMPLATE_ID
    && item.projectId !== INDEPENDENT_PIPELINE_SCOPE_ID
    && item.projectId !== BUILTIN_PIPELINE_SCOPE_ID
    && Boolean(item.system_owned)
    && item.builtin_kind === "knowledge-processing"
  );
}

function buildPipelineGroupKey(
  templateId: string,
  source: PipelineSourceKind,
  projectId?: string,
): string {
  const normalizedProjectId = String(projectId || "").trim();
  if (
    source === "project"
    && templateId === BUILTIN_KNOWLEDGE_PIPELINE_TEMPLATE_ID
    && normalizedProjectId
  ) {
    return `${templateId}::${source}::${normalizedProjectId}`;
  }
  return `${templateId}::${source}`;
}

async function loadPipelineManagementData(
  agentId: string,
  projectList: AgentProjectSummary[],
  independentScopeLabel: string,
  builtinScopeLabel: string,
  projectScopeLabel: string,
): Promise<PipelineManagementData> {
  const [perProject, agentTemplates, platformTemplates] = await Promise.all([
    Promise.all(
      projectList.map(async (project) => {
        const templatesResult = await Promise.allSettled([
          agentsApi.listProjectPipelineTemplates(agentId, project.id),
        ]);

        return {
          project,
          templates:
            templatesResult[0].status === "fulfilled"
              ? templatesResult[0].value
              : [],
        };
      }),
    ),
    agentsApi.listAgentPipelineTemplates(agentId).catch(() => []),
    agentsApi.listPlatformFlowTemplates(agentId).catch(() => []),
  ]);

  const templates: TemplateItem[] = [
    ...agentTemplates.map((tpl) => ({
      ...tpl,
      projectId: INDEPENDENT_PIPELINE_SCOPE_ID,
      projectName: independentScopeLabel,
      sourceScope: "independent" as const,
      projectCreatedTime: "",
    })),
    ...platformTemplates.map((tpl) => {
      const normalizedTags = (tpl.tags || [])
        .map((tag) => String(tag || "").trim().toLowerCase())
        .filter(Boolean);
      const declaredBuiltin = normalizedTags.includes("builtin") || Boolean(tpl.system_owned && tpl.builtin_kind);
      const publishedFromProject = Boolean(String(tpl.source_project_id || "").trim());
      if (declaredBuiltin && !publishedFromProject) {
        return {
          ...tpl,
          projectId: BUILTIN_PIPELINE_SCOPE_ID,
          projectName: builtinScopeLabel,
          sourceScope: "builtin" as const,
          projectCreatedTime: "",
        };
      }

      const sourceProjectId = String(tpl.source_project_id || "").trim();
      const resolvedProject = projectList.find((project) => project.id === sourceProjectId);
      return {
        ...tpl,
        projectId: sourceProjectId || "__project_general__",
        projectName: resolvedProject?.name || projectScopeLabel,
        sourceScope: "project" as const,
        projectCreatedTime: resolvedProject?.created_time || "",
      };
    }),
    ...perProject.flatMap((item) =>
      item.templates.map((tpl) => ({
        ...tpl,
        projectId: item.project.id,
        projectName: item.project.name,
        sourceScope: "project" as const,
        projectCreatedTime: item.project.created_time || "",
      })),
    ),
  ];

  return { templates };
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

function buildRunIdentity(run: RunItem): string {
  return `${run.projectId}:${run.id}`;
}

function runTimeValue(run: RunItem): number {
  const value = Date.parse(run.updated_at || run.created_at || "");
  return Number.isFinite(value) ? value : 0;
}

function formatStepDuration(step: ProjectPipelineRunStep): string {
  const metricsDuration = Number((step.metrics as Record<string, unknown> | undefined)?.duration_sec);
  if (Number.isFinite(metricsDuration) && metricsDuration > 0) {
    return `${metricsDuration.toFixed(2)}s`;
  }
  const started = step.started_at ? Date.parse(step.started_at) : NaN;
  const ended = step.ended_at ? Date.parse(step.ended_at) : NaN;
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) {
    return "-";
  }
  return `${((ended - started) / 1000).toFixed(2)}s`;
}

function templateMtimeValue(value: unknown): number {
  const raw = Number(value || 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  // Some backends return seconds, others milliseconds.
  return raw < 1_000_000_000_000 ? raw * 1000 : raw;
}

function isoTimeValue(value: unknown): number {
  if (typeof value !== "string" || !value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
  scope: PipelineSourceKind;
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
  const { selectedAgent, agents, setAgents, setSelectedAgent } = useAgentStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [runsByPipelineKey, setRunsByPipelineKey] = useState<Record<string, RunItem[]>>({});
  const [runsLoadedKeys, setRunsLoadedKeys] = useState<Record<string, boolean>>({});
  const [runsLoadingKeys, setRunsLoadingKeys] = useState<Record<string, boolean>>({});
  const [runsErrorByKey, setRunsErrorByKey] = useState<Record<string, string>>({});
  const [runDetailsByKey, setRunDetailsByKey] = useState<Record<string, ProjectPipelineRunDetail>>({});
  const [runsVisibleLimitByPipelineKey, setRunsVisibleLimitByPipelineKey] = useState<Record<string, number>>({});
  const [selectedRunKey, setSelectedRunKey] = useState("");
  const [selectedRunStepId, setSelectedRunStepId] = useState("");
  const [stepDetailDrawerOpen, setStepDetailDrawerOpen] = useState(false);
  const [selectedRunDetailLoadingKey, setSelectedRunDetailLoadingKey] = useState("");
  const [selectedRunDetailErrorByKey, setSelectedRunDetailErrorByKey] = useState<Record<string, string>>({});
  const [selectedPipelineKey, setSelectedPipelineKey] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "independent" | "project" | "builtin">("all");
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
  const [newVersionNodesExpanded, setNewVersionNodesExpanded] = useState(false);
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
  const [selectedBuiltinProjectId, setSelectedBuiltinProjectId] = useState("");
  const [builtinProcessingMode, setBuiltinProcessingMode] = useState<ProjectKnowledgeProcessingMode>("agentic");
  const [builtinSyncState, setBuiltinSyncState] = useState<ProjectKnowledgeSyncState | null>(null);
  const [builtinSyncLoading, setBuiltinSyncLoading] = useState(false);
  const [builtinRunLoading, setBuiltinRunLoading] = useState(false);
  const [projectBuiltinRunDetail, setProjectBuiltinRunDetail] = useState<ProjectPipelineRunDetail | null>(null);
  const [projectBuiltinRunDetailLoading, setProjectBuiltinRunDetailLoading] = useState(false);
  const [rpaImportModalOpen, setRpaImportModalOpen] = useState(false);
  const [rpaImportJson, setRpaImportJson] = useState("");
  const [rpaImportTemplateId, setRpaImportTemplateId] = useState("");
  const [rpaImporting, setRpaImporting] = useState(false);
  const [rpaExportModalOpen, setRpaExportModalOpen] = useState(false);
  const [rpaExportJson, setRpaExportJson] = useState("");
  const [rpaExporting, setRpaExporting] = useState(false);
  const [rpaExportFileName, setRpaExportFileName] = useState("rpa-template-package.json");
  const [rpaExportAuthor, setRpaExportAuthor] = useState("");
  const [rpaExportTags, setRpaExportTags] = useState("");
  const [rpaExportNote, setRpaExportNote] = useState("");

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

  const independentScopeLabel = t("pipelines.independentScope");
  const builtinScopeLabel = t("pipelines.builtin", "Built-in");
  const projectScopeLabel = t("pipelines.project", "Project");

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
      setLoading(true);
      setError("");

      try {
        const availableAgentsResponse = agents.length > 0 ? agents : await agentsApi.listAgents();
        const availableAgents = Array.isArray(availableAgentsResponse)
          ? availableAgentsResponse
          : availableAgentsResponse.agents;
        if (!mounted) return;
        setAgents(availableAgents);

        const effectiveAgentId = selectedAgent || availableAgents[0]?.id || "default";
        if (!selectedAgent) {
          setSelectedAgent(effectiveAgentId);
        }

        const agent = getCurrentAgent(availableAgents, effectiveAgentId);
        const projectList = agent?.projects ?? [];
        const data = await loadPipelineManagementData(
          effectiveAgentId,
          projectList,
          independentScopeLabel,
          builtinScopeLabel,
          projectScopeLabel,
        );

        if (!mounted) return;

        const persisted = readPipelineDraftState(effectiveAgentId);
        const persistedTemplates = (persisted?.templates || []).filter(
          (item) => item.projectId === INDEPENDENT_PIPELINE_SCOPE_ID,
        );
        const mergedTemplates = [...persistedTemplates, ...data.templates.filter((item) => {
          const key = buildPipelineGroupKey(item.id, getTemplateSourceKind(item), item.projectId);
          return !persistedTemplates.some(
            (draftItem) => buildPipelineGroupKey(draftItem.id, getTemplateSourceKind(draftItem), draftItem.projectId) === key,
          );
        })];

        const restoredDraftKeys = (persisted?.draftPipelineKeys || []).filter((key) =>
          mergedTemplates.some(
            (item) => buildPipelineGroupKey(item.id, getTemplateSourceKind(item), item.projectId) === key,
          ),
        );

        setTemplates(mergedTemplates);
        setRunsByPipelineKey({});
        setRunsLoadedKeys({});
        setRunsLoadingKeys({});
        setRunsErrorByKey({});
        setRunDetailsByKey({});
        setRunsVisibleLimitByPipelineKey({});
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

    void load();

    return () => {
      mounted = false;
    };
  }, [agents, builtinScopeLabel, independentScopeLabel, projectScopeLabel, selectedAgent, setAgents, setSelectedAgent, t]);

  useEffect(() => {
    if (loading || templates.length > 0) {
      return;
    }

    const fallbackAgentId = selectedAgent || agents[0]?.id || "default";
    if (!fallbackAgentId) {
      return;
    }

    const loadFallbackTemplates = async () => {
      try {
        const [agentTemplates, platformTemplates] = await Promise.all([
          agentsApi.listAgentPipelineTemplates(fallbackAgentId).catch(() => []),
          agentsApi.listPlatformFlowTemplates(fallbackAgentId).catch(() => []),
        ]);
        setTemplates([
          ...agentTemplates.map((tpl) => ({
            ...tpl,
            projectId: INDEPENDENT_PIPELINE_SCOPE_ID,
            projectName: independentScopeLabel,
            sourceScope: "independent" as const,
            projectCreatedTime: "",
          })),
          ...platformTemplates.map((tpl) => {
            const normalizedTags = (tpl.tags || [])
              .map((tag) => String(tag || "").trim().toLowerCase())
              .filter(Boolean);
            const declaredBuiltin = normalizedTags.includes("builtin") || Boolean(tpl.system_owned && tpl.builtin_kind);
            const publishedFromProject = Boolean(String(tpl.source_project_id || "").trim());
            if (declaredBuiltin && !publishedFromProject) {
              return {
                ...tpl,
                projectId: BUILTIN_PIPELINE_SCOPE_ID,
                projectName: builtinScopeLabel,
                sourceScope: "builtin" as const,
                projectCreatedTime: "",
              };
            }

            const sourceProjectId = String(tpl.source_project_id || "").trim();
            const resolvedProject = projects.find((project) => project.id === sourceProjectId);
            return {
              ...tpl,
              projectId: sourceProjectId || "__project_general__",
              projectName: resolvedProject?.name || projectScopeLabel,
              sourceScope: "project" as const,
              projectCreatedTime: resolvedProject?.created_time || "",
            };
          }),
        ]);
        setRunsByPipelineKey({});
        setRunsLoadedKeys({});
        setRunsLoadingKeys({});
        setRunsErrorByKey({});
        setRunDetailsByKey({});
        setRunsVisibleLimitByPipelineKey({});
      } catch (err) {
        console.warn("failed to load fallback pipeline templates", err);
      }
    };

    void loadFallbackTemplates();
  }, [agents, builtinScopeLabel, independentScopeLabel, loading, projectScopeLabel, projects, selectedAgent, templates.length]);

  useEffect(() => {
    designChatSessionIdRef.current = designChatSessionId;
  }, [designChatSessionId]);

  const pipelineGroups = useMemo<PipelineGroup[]>(() => {
    const filteredTemplates = templates.filter((item) => {
      const sourceKind = getTemplateSourceKind(item);
      if (sourceFilter === "independent") return sourceKind === "independent";
      if (sourceFilter === "project") return sourceKind === "project";
      if (sourceFilter === "builtin") {
        return sourceKind === "builtin";
      }
      return true;
    });

    const map = new Map<string, TemplateItem[]>();
    filteredTemplates.forEach((item) => {
      const groupKey = buildPipelineGroupKey(item.id, getTemplateSourceKind(item), item.projectId);
      if (!map.has(groupKey)) {
        map.set(groupKey, []);
      }
      map.get(groupKey)?.push(item);
    });

    return Array.from(map.entries())
      .map(([groupKey, items]) => {
        const versionsByKey = new Map<string, ProjectPipelineTemplateInfo>();
        const projectMap = new Map<string, { id: string; name: string; createdTime?: string }>();

        items.forEach((item) => {
          const versionKey = normalizeVersion(item.version);
          if (!versionsByKey.has(versionKey)) {
            versionsByKey.set(versionKey, {
              id: item.id,
              name: item.name,
              version: item.version,
              description: item.description,
              steps: item.steps,
              tags: item.tags,
              system_owned: item.system_owned,
              builtin_kind: item.builtin_kind,
              entrypoint: item.entrypoint,
              source_project_id: item.source_project_id,
              source_project_template_id: item.source_project_template_id,
              source_project_template_version: item.source_project_template_version,
              revision: item.revision,
              content_hash: item.content_hash,
              md_mtime: item.md_mtime,
              validation_errors: item.validation_errors,
              compilation_status: item.compilation_status,
            });
          }
          if (!projectMap.has(item.projectId)) {
            projectMap.set(item.projectId, {
              id: item.projectId,
              name: item.projectName,
              createdTime: item.projectCreatedTime,
            });
          }
        });

        const versions = Array.from(versionsByKey.values()).sort((a, b) =>
          compareSemverDesc(a.version, b.version),
        );

        const source: PipelineGroup["source"] = getTemplateSourceKind(items[0]);
        const groupProjectId = projectMap.size === 1
          ? Array.from(projectMap.values())[0].id
          : undefined;

        return {
          key: groupKey,
          id: items[0].id,
          name: items[0].name,
          description: items[0].description,
          versions,
          projects: Array.from(projectMap.values()),
          source,
          groupProjectId,
        };
      })
      .sort((a, b) => {
        const aLatestMtime = Math.max(...a.versions.map((item) => templateMtimeValue(item.md_mtime)));
        const bLatestMtime = Math.max(...b.versions.map((item) => templateMtimeValue(item.md_mtime)));
        const aHasTime = aLatestMtime > 0;
        const bHasTime = bLatestMtime > 0;

        if (aHasTime !== bHasTime) {
          return aHasTime ? -1 : 1;
        }

        if (aLatestMtime !== bLatestMtime) {
          return bLatestMtime - aLatestMtime;
        }

        const aProjectCreatedLatest = Math.max(...a.projects.map((item) => isoTimeValue(item.createdTime)));
        const bProjectCreatedLatest = Math.max(...b.projects.map((item) => isoTimeValue(item.createdTime)));
        if (aProjectCreatedLatest !== bProjectCreatedLatest) {
          return bProjectCreatedLatest - aProjectCreatedLatest;
        }

        const nameCmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        if (nameCmp !== 0) return nameCmp;
        return a.source.localeCompare(b.source);
      });
  }, [sourceFilter, templates]);

  const selectedPipeline = useMemo(
    () => pipelineGroups.find((item) => item.key === selectedPipelineKey),
    [pipelineGroups, selectedPipelineKey],
  );

  const selectedIsBuiltinProjectKnowledgePipeline = useMemo(() => {
    if (!selectedPipeline) return false;
    const selectedVersion = selectedPipeline.versions.find(
      (version) => normalizeVersion(version.version) === selectedCurrentVersion,
    ) || selectedPipeline.versions[0];
    if (!selectedVersion) return false;

    const normalizedTags = (selectedVersion.tags || [])
      .map((tag) => String(tag || "").trim().toLowerCase())
      .filter(Boolean);
    return (
      selectedPipeline.source === "builtin"
      && (
        selectedVersion.builtin_kind === "project-knowledge-governance"
        || (
          normalizedTags.includes("builtin")
          && normalizedTags.includes("project")
          && normalizedTags.includes("knowledge")
        )
      )
    );
  }, [selectedCurrentVersion, selectedPipeline]);

  const selectedIsProjectBuiltinKnowledgeWorkflowPipeline = useMemo(() => {
    if (!selectedPipeline) return false;
    const selectedVersion = selectedPipeline.versions.find(
      (version) => normalizeVersion(version.version) === selectedCurrentVersion,
    ) || selectedPipeline.versions[0];
    if (!selectedVersion) return false;

    return (
      selectedPipeline.source === "project"
      && selectedPipeline.id === BUILTIN_KNOWLEDGE_PIPELINE_TEMPLATE_ID
      && Boolean(selectedVersion.system_owned)
      && selectedVersion.builtin_kind === "knowledge-processing"
    );
  }, [selectedCurrentVersion, selectedPipeline]);

  useEffect(() => {
    if (selectedBuiltinProjectId) return;
    const firstProjectId = projects[0]?.id || "";
    if (firstProjectId) {
      setSelectedBuiltinProjectId(firstProjectId);
    }
  }, [projects, selectedBuiltinProjectId]);

  useEffect(() => {
    if (!selectedIsProjectBuiltinKnowledgeWorkflowPipeline) return;
    const allowedProjects = selectedPipeline?.projects || [];
    if (allowedProjects.length === 0) {
      if (selectedBuiltinProjectId) {
        setSelectedBuiltinProjectId("");
      }
      return;
    }
    if (!allowedProjects.some((item) => item.id === selectedBuiltinProjectId)) {
      setSelectedBuiltinProjectId(allowedProjects[0].id);
    }
  }, [selectedBuiltinProjectId, selectedIsProjectBuiltinKnowledgeWorkflowPipeline, selectedPipeline]);

  const loadRunsForPipeline = useCallback(async (
    pipeline: PipelineGroup,
    options?: { force?: boolean },
  ) => {
    if (!selectedAgent) {
      return;
    }

    const force = Boolean(options?.force);
    const key = pipeline.key;
    if (!force && (runsLoadedKeys[key] || runsLoadingKeys[key])) {
      return;
    }

    if (pipeline.source !== "project") {
      setRunsByPipelineKey((prev) => ({ ...prev, [key]: [] }));
      setRunsLoadedKeys((prev) => ({ ...prev, [key]: true }));
      setRunsLoadingKeys((prev) => ({ ...prev, [key]: false }));
      setRunsErrorByKey((prev) => ({ ...prev, [key]: "" }));
      setRunsVisibleLimitByPipelineKey((prev) => ({
        ...prev,
        [key]: prev[key] || INITIAL_VISIBLE_RUNS,
      }));
      return;
    }

    setRunsLoadingKeys((prev) => ({ ...prev, [key]: true }));
    setRunsErrorByKey((prev) => ({ ...prev, [key]: "" }));

    try {
      const projectMap = new Map(pipeline.projects.map((item) => [item.id, item.name]));
      const results = await Promise.allSettled(
        pipeline.projects.map((project) =>
          agentsApi.listProjectPipelineRuns(selectedAgent, project.id)
            .then((projectRuns) => ({
              projectId: project.id,
              projectName: project.name,
              runs: projectRuns,
            })),
        ),
      );

      const dedupedRuns = new Map<string, RunItem>();
      results.forEach((result) => {
        if (result.status !== "fulfilled") {
          return;
        }
        result.value.runs
          .filter((run) => run.template_id === pipeline.id)
          .forEach((run) => {
            const normalizedRun: RunItem = {
              ...run,
              projectId: result.value.projectId,
              projectName: result.value.projectName || projectMap.get(result.value.projectId) || result.value.projectId,
            };
            const runKey = buildRunIdentity(normalizedRun);
            const existing = dedupedRuns.get(runKey);
            if (!existing || runTimeValue(normalizedRun) >= runTimeValue(existing)) {
              dedupedRuns.set(runKey, normalizedRun);
            }
          });
      });

      const nextRuns = Array.from(dedupedRuns.values()).sort((a, b) => runTimeValue(b) - runTimeValue(a));
      setRunsByPipelineKey((prev) => ({ ...prev, [key]: nextRuns }));
      setRunsLoadedKeys((prev) => ({ ...prev, [key]: true }));
      setRunsVisibleLimitByPipelineKey((prev) => ({
        ...prev,
        [key]: prev[key] || INITIAL_VISIBLE_RUNS,
      }));
    } catch (err) {
      console.warn("failed to load project pipeline runs", err);
      setRunsErrorByKey((prev) => ({
        ...prev,
        [key]: t("pipelines.loadRunsFailed", "Failed to load pipeline runs."),
      }));
    } finally {
      setRunsLoadingKeys((prev) => ({ ...prev, [key]: false }));
    }
  }, [runsLoadedKeys, runsLoadingKeys, selectedAgent, t]);

  const refreshBuiltinSyncState = useCallback(async () => {
    if (!selectedIsBuiltinProjectKnowledgePipeline || !selectedBuiltinProjectId) {
      setBuiltinSyncState(null);
      return;
    }
    setBuiltinSyncLoading(true);
    try {
      const state = await knowledgeApi.getProjectKnowledgeSyncStatus({
        projectId: selectedBuiltinProjectId,
      });
      setBuiltinSyncState(state);
    } catch (err) {
      console.warn("failed to load builtin project knowledge pipeline state", err);
      setBuiltinSyncState(null);
    } finally {
      setBuiltinSyncLoading(false);
    }
  }, [selectedBuiltinProjectId, selectedIsBuiltinProjectKnowledgePipeline]);

  useEffect(() => {
    if (!selectedIsBuiltinProjectKnowledgePipeline || !selectedBuiltinProjectId) {
      setBuiltinSyncState(null);
      return;
    }
    void refreshBuiltinSyncState();
    const timer = window.setInterval(() => {
      void refreshBuiltinSyncState();
    }, 3000);
    return () => {
      window.clearInterval(timer);
    };
  }, [refreshBuiltinSyncState, selectedBuiltinProjectId, selectedIsBuiltinProjectKnowledgePipeline]);

  const handleRunBuiltinProjectKnowledgePipeline = useCallback(async () => {
    if (!selectedBuiltinProjectId || builtinRunLoading) {
      return;
    }
    setBuiltinRunLoading(true);
    try {
      await knowledgeApi.runProjectKnowledgeSync({
        projectId: selectedBuiltinProjectId,
        trigger: "pipelines_builtin",
        force: true,
        processingMode: builtinProcessingMode,
      });
      message.success(
        t("pipelines.builtinRunStarted", "Built-in project knowledge pipeline started."),
      );
      await refreshBuiltinSyncState();
    } catch (err) {
      console.error("failed to run built-in project knowledge pipeline", err);
      message.error(
        t("pipelines.builtinRunFailed", "Failed to start built-in project knowledge pipeline."),
      );
    } finally {
      setBuiltinRunLoading(false);
    }
  }, [
    builtinProcessingMode,
    builtinRunLoading,
    refreshBuiltinSyncState,
    selectedBuiltinProjectId,
    t,
  ]);

  const handleRetryBuiltinProjectKnowledgePipeline = useCallback(async () => {
    if (!selectedBuiltinProjectId || builtinRunLoading) {
      return;
    }
    setBuiltinRunLoading(true);
    try {
      await knowledgeApi.runProjectKnowledgeSync({
        projectId: selectedBuiltinProjectId,
        trigger: "pipelines_builtin_retry",
        force: true,
        processingMode: builtinProcessingMode,
        quantizationStage: builtinSyncState?.quantization_stage,
      });
      message.success(
        t("pipelines.builtinRetryStarted", "Built-in project knowledge pipeline retry started."),
      );
      await refreshBuiltinSyncState();
    } catch (err) {
      console.error("failed to retry built-in project knowledge pipeline", err);
      message.error(
        t("pipelines.builtinRetryFailed", "Failed to retry built-in project knowledge pipeline."),
      );
    } finally {
      setBuiltinRunLoading(false);
    }
  }, [
    builtinProcessingMode,
    builtinRunLoading,
    builtinSyncState?.quantization_stage,
    refreshBuiltinSyncState,
    selectedBuiltinProjectId,
    t,
  ]);

  const projectBuiltinLatestRun = useMemo(() => {
    if (!selectedIsProjectBuiltinKnowledgeWorkflowPipeline || !selectedBuiltinProjectId || !selectedPipeline) {
      return null;
    }
    const projectBuiltinPipelineKey = buildPipelineGroupKey(
      selectedPipeline.id,
      "project",
      selectedBuiltinProjectId,
    );
    const candidates = (runsByPipelineKey[projectBuiltinPipelineKey] || [])
      .filter(
        (item) => item.projectId === selectedBuiltinProjectId && item.template_id === selectedPipeline.id,
      )
      .sort((a, b) => runTimeValue(b) - runTimeValue(a));
    return candidates[0] || null;
  }, [runsByPipelineKey, selectedBuiltinProjectId, selectedIsProjectBuiltinKnowledgeWorkflowPipeline, selectedPipeline]);

  useEffect(() => {
    if (!selectedIsProjectBuiltinKnowledgeWorkflowPipeline || !selectedAgent || !selectedBuiltinProjectId || !projectBuiltinLatestRun) {
      setProjectBuiltinRunDetail(null);
      return;
    }

    let cancelled = false;
    setProjectBuiltinRunDetailLoading(true);
    agentsApi
      .getProjectPipelineRun(selectedAgent, selectedBuiltinProjectId, projectBuiltinLatestRun.id)
      .then((detail) => {
        if (!cancelled) {
          setProjectBuiltinRunDetail(detail);
        }
      })
      .catch((err) => {
        console.warn("failed to load project builtin pipeline run detail", err);
        if (!cancelled) {
          setProjectBuiltinRunDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setProjectBuiltinRunDetailLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectBuiltinLatestRun, selectedAgent, selectedBuiltinProjectId, selectedIsProjectBuiltinKnowledgeWorkflowPipeline]);

  const projectBuiltinRunProgress = useMemo(() => {
    if (!projectBuiltinRunDetail || projectBuiltinRunDetail.steps.length === 0) {
      return null;
    }
    const doneCount = projectBuiltinRunDetail.steps.filter((step) =>
      ["succeeded", "completed", "skipped"].includes(String(step.status || "").toLowerCase()),
    ).length;
    return Math.round((doneCount / projectBuiltinRunDetail.steps.length) * 100);
  }, [projectBuiltinRunDetail]);

  const projectBuiltinCurrentStage = useMemo(() => {
    if (!projectBuiltinRunDetail || projectBuiltinRunDetail.steps.length === 0) {
      return "-";
    }
    const runningStep = projectBuiltinRunDetail.steps.find(
      (step) => String(step.status || "").toLowerCase() === "running",
    );
    if (runningStep) {
      return runningStep.name || runningStep.id;
    }
    const failedStep = projectBuiltinRunDetail.steps.find(
      (step) => String(step.status || "").toLowerCase() === "failed",
    );
    if (failedStep) {
      return failedStep.name || failedStep.id;
    }
    const lastDoneStep = [...projectBuiltinRunDetail.steps]
      .reverse()
      .find((step) => ["succeeded", "completed", "skipped"].includes(String(step.status || "").toLowerCase()));
    return lastDoneStep?.name || lastDoneStep?.id || "-";
  }, [projectBuiltinRunDetail]);

  const projectBuiltinLastError = useMemo(() => {
    if (!projectBuiltinRunDetail) return "";
    const failedStep = projectBuiltinRunDetail.steps.find(
      (step) => String(step.status || "").toLowerCase() === "failed",
    );
    if (!failedStep) return "";
    const metrics = failedStep.metrics as Record<string, unknown>;
    const metricError = typeof metrics?.error === "string"
      ? metrics.error
      : typeof metrics?.message === "string"
        ? metrics.message
        : "";
    if (metricError) {
      return metricError;
    }
    if (Array.isArray(failedStep.evidence) && failedStep.evidence.length > 0) {
      return failedStep.evidence[0];
    }
    return failedStep.name || failedStep.id;
  }, [projectBuiltinRunDetail]);

  const handleRunProjectBuiltinKnowledgeWorkflowPipeline = useCallback(async () => {
    if (!selectedAgent || !selectedBuiltinProjectId || builtinRunLoading || !selectedPipeline) {
      return;
    }
    setBuiltinRunLoading(true);
    try {
      await agentsApi.createProjectPipelineRun(selectedAgent, selectedBuiltinProjectId, {
        template_id: selectedPipeline.id,
      });
      message.success(
        t("pipelines.projectBuiltinRunStarted", "Built-in project pipeline run started."),
      );
      await loadRunsForPipeline(selectedPipeline, { force: true });
    } catch (err) {
      console.error("failed to run project builtin knowledge workflow", err);
      message.error(
        t("pipelines.projectBuiltinRunFailed", "Failed to start built-in project pipeline run."),
      );
    } finally {
      setBuiltinRunLoading(false);
    }
  }, [builtinRunLoading, loadRunsForPipeline, selectedAgent, selectedBuiltinProjectId, selectedPipeline, t]);

  const handleRetryProjectBuiltinKnowledgeWorkflowPipeline = useCallback(async () => {
    if (!selectedAgent || !selectedBuiltinProjectId || !projectBuiltinLatestRun || builtinRunLoading || !selectedPipeline) {
      return;
    }
    setBuiltinRunLoading(true);
    try {
      await agentsApi.retryProjectPipelineRun(
        selectedAgent,
        selectedBuiltinProjectId,
        projectBuiltinLatestRun.id,
        { note: "retry from pipelines" },
      );
      message.success(
        t("pipelines.projectBuiltinRetryStarted", "Built-in project pipeline retry started."),
      );
      await loadRunsForPipeline(selectedPipeline, { force: true });
    } catch (err) {
      console.error("failed to retry project builtin knowledge workflow", err);
      message.error(
        t("pipelines.projectBuiltinRetryFailed", "Failed to retry built-in project pipeline run."),
      );
    } finally {
      setBuiltinRunLoading(false);
    }
  }, [
    builtinRunLoading,
    loadRunsForPipeline,
    projectBuiltinLatestRun,
    selectedAgent,
    selectedBuiltinProjectId,
    selectedPipeline,
    t,
  ]);

  const currentTemplate = useMemo(() => {
    if (!selectedPipeline) return null;
    return (
      selectedPipeline.versions.find(
        (item) => normalizeVersion(item.version) === selectedCurrentVersion,
      ) || selectedPipeline.versions[0] || null
    );
  }, [selectedCurrentVersion, selectedPipeline]);

  const currentTemplateDisplaySteps = useMemo(() => {
    if (!currentTemplate) return [];
    return resolveDisplaySteps(currentTemplate.id, currentTemplate.steps || []);
  }, [currentTemplate]);

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
          (!selectedPipeline.groupProjectId || item.projectId === selectedPipeline.groupProjectId) &&
          normalizeVersion(item.version) === selectedCurrentVersion,
      ) || null
    );
  }, [selectedCurrentVersion, selectedPipeline, templates]);

  const selectedPipelineFilePath = useMemo(() => {
    const explicitPath = pickTemplatePathField(selectedTemplateItem);
    if (explicitPath) {
      return explicitPath;
    }

    if (!selectedPipeline) {
      return "";
    }

    if (selectedPipeline.source === "builtin") {
      return `src/qwenpaw/app/pipelines/${selectedPipeline.id}.json`;
    }

    if (selectedPipeline.source === "project") {
      const projectId = String(
        selectedPipeline.groupProjectId
        || selectedBuiltinProjectId
        || selectedPipeline.projects[0]?.id
        || "",
      ).trim() || "<project-id>";
      return `projects/${projectId}/.pipelines/templates/${selectedPipeline.id}.json`;
    }

    return `${buildPipelineWorkspaceRelativePath(selectedPipeline.id)}/pipeline.md`;
  }, [selectedBuiltinProjectId, selectedPipeline, selectedTemplateItem]);

  const selectedIsDraft = useMemo(() => {
    if (!selectedPipeline) return false;
    return draftPipelineKeys.includes(selectedPipeline.key);
  }, [draftPipelineKeys, selectedPipeline]);

  const selectedPipelineEditable = useMemo(() => {
    if (!selectedPipeline || !currentTemplate) return false;
    return (
      selectedPipeline.source !== "builtin"
      && !currentTemplate.system_owned
    );
  }, [currentTemplate, selectedPipeline]);

  const builtinRuntimeStages = useMemo(
    () => deriveBuiltinProjectKnowledgeStages(builtinSyncState),
    [builtinSyncState],
  );

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
        builtinScopeLabel,
        projectScopeLabel,
      );
      setTemplates(data.templates);
      setRunsByPipelineKey({});
      setRunsLoadedKeys({});
      setRunsLoadingKeys({});
      setRunsErrorByKey({});
      setRunDetailsByKey({});
      setRunsVisibleLimitByPipelineKey({});
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

      message.success(t("pipelines.conflictRefreshed"));
    } catch (error) {
      console.error("failed to refresh pipelines after conflict", error);
      message.error(t("pipelines.conflictRefreshFailed"));
    }
  }, [
    builtinScopeLabel,
    conflictLocalDraftBackup,
    independentScopeLabel,
    projectScopeLabel,
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
    message.success(t("pipelines.conflictLocalRestored"));
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
    message.success(t("pipelines.conflictRemoteApplied"));
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
    message.success(t("pipelines.conflictMerged"));
  }, [conflictLocalDraftBackup, conflictRemoteDraftBackup, t]);

  const requestCloseEditMode = () => {
    if (!selectedIsDraft) {
      closeEditMode();
      return;
    }

    Modal.confirm({
      title: t("pipelines.unsavedDraftTitle"),
      content: t(
        "pipelines.unsavedExitConfirm",
        "当前流程草稿尚未保存，退出编辑后改动可能丢失。是否继续？",
      ),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
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
      title: t("pipelines.unsavedDraftTitle"),
      content: t(
        "pipelines.unsavedSwitchConfirm",
        "当前流程草稿尚未保存，切换流程后改动可能丢失。是否继续切换？",
      ),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      onOk: () => {
        closeEditMode();
        setSelectedPipelineKey(nextPipelineKey);
        setSelectedCompareVersion("");
      },
    });
  };

  const requestLoadSelectedPipelineRuns = useCallback((force = false) => {
    if (!selectedPipeline) {
      return;
    }
    void loadRunsForPipeline(selectedPipeline, { force });
  }, [loadRunsForPipeline, selectedPipeline]);

  const handleLoadMoreRuns = useCallback(() => {
    if (!selectedPipeline) {
      return;
    }
    setRunsVisibleLimitByPipelineKey((prev) => ({
      ...prev,
      [selectedPipeline.key]: (prev[selectedPipeline.key] || INITIAL_VISIBLE_RUNS) + LOAD_MORE_RUNS_STEP,
    }));
  }, [selectedPipeline]);

  const handleSelectRun = useCallback((run: RunItem) => {
    const runKey = buildRunIdentity(run);
    setSelectedRunKey(runKey);
    setSelectedRunStepId("");
    setStepDetailDrawerOpen(false);
    setSelectedRunDetailErrorByKey((prev) => {
      if (!prev[runKey]) {
        return prev;
      }
      const next = { ...prev };
      delete next[runKey];
      return next;
    });

    if (!selectedAgent || runDetailsByKey[runKey] || selectedRunDetailLoadingKey === runKey) {
      return;
    }

    setSelectedRunDetailLoadingKey(runKey);
    void agentsApi
      .getProjectPipelineRun(selectedAgent, run.projectId, run.id)
      .then((detail) => {
        setRunDetailsByKey((prev) => ({
          ...prev,
          [runKey]: detail,
        }));
        setSelectedRunDetailErrorByKey((prev) => {
          if (!prev[runKey]) {
            return prev;
          }
          const next = { ...prev };
          delete next[runKey];
          return next;
        });
      })
      .catch(() => {
        setSelectedRunDetailErrorByKey((prev) => ({
          ...prev,
          [runKey]: t("pipelines.runDetailLoadFailed", "Failed to load run details. Click to retry."),
        }));
      })
      .finally(() => {
        setSelectedRunDetailLoadingKey((prev) => (prev === runKey ? "" : prev));
      });
  }, [runDetailsByKey, selectedAgent, selectedRunDetailLoadingKey, t]);

  const handleOpenRunStep = useCallback((stepId: string) => {
    setSelectedRunStepId(stepId);
    setStepDetailDrawerOpen(true);
  }, []);

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

  const allLoadedRuns = useMemo(
    () => Object.values(runsByPipelineKey).flat(),
    [runsByPipelineKey],
  );

  const hasAnyRunsLoaded = useMemo(
    () => Object.values(runsLoadedKeys).some(Boolean),
    [runsLoadedKeys],
  );

  const runningCount = useMemo(
    () => allLoadedRuns.filter((run) => run.status === "running").length,
    [allLoadedRuns],
  );

  const selectedRunsLoaded = useMemo(
    () => (selectedPipeline ? Boolean(runsLoadedKeys[selectedPipeline.key]) : false),
    [runsLoadedKeys, selectedPipeline],
  );

  const selectedRunsLoading = useMemo(
    () => (selectedPipeline ? Boolean(runsLoadingKeys[selectedPipeline.key]) : false),
    [runsLoadingKeys, selectedPipeline],
  );

  const selectedRunsError = useMemo(
    () => (selectedPipeline ? (runsErrorByKey[selectedPipeline.key] || "") : ""),
    [runsErrorByKey, selectedPipeline],
  );

  const selectedRunsVisibleLimit = useMemo(() => {
    if (!selectedPipeline) {
      return INITIAL_VISIBLE_RUNS;
    }
    return runsVisibleLimitByPipelineKey[selectedPipeline.key] || INITIAL_VISIBLE_RUNS;
  }, [runsVisibleLimitByPipelineKey, selectedPipeline]);

  const selectedPipelineRuns = useMemo(() => {
    if (!selectedPipeline || selectedPipeline.source !== "project") {
      return [];
    }
    return runsByPipelineKey[selectedPipeline.key] || [];
  }, [runsByPipelineKey, selectedPipeline]);

  const visibleRuns = useMemo(() => {
    if (!selectedPipeline || selectedPipeline.source !== "project") {
      return [];
    }
    return selectedPipelineRuns.slice(0, selectedRunsVisibleLimit);
  }, [selectedPipeline, selectedPipelineRuns, selectedRunsVisibleLimit]);

  const latestRun = useMemo(() => visibleRuns[0] || null, [visibleRuns]);

  const latestRunKey = useMemo(
    () => (latestRun ? buildRunIdentity(latestRun) : ""),
    [latestRun],
  );

  const latestRunDetail = useMemo(
    () => (latestRunKey ? runDetailsByKey[latestRunKey] || null : null),
    [latestRunKey, runDetailsByKey],
  );

  const hasMoreRuns = useMemo(
    () => selectedPipelineRuns.length > visibleRuns.length,
    [selectedPipelineRuns.length, visibleRuns.length],
  );

  const latestRunSummaryItems = useMemo(() => {
    if (!latestRun || !latestRunDetail) {
      return [];
    }
    const durationValue =
      typeof latestRunDetail.observability?.duration_sec === "number"
        ? `${latestRunDetail.observability.duration_sec.toFixed(2)}s`
        : "-";
    const passedChecks = latestRunDetail.convergence?.passed_checks ?? 0;
    const totalChecks = latestRunDetail.convergence?.total_checks ?? 0;
    const scoreValue = Number.isFinite(latestRunDetail.convergence?.score)
      ? latestRunDetail.convergence.score.toFixed(2)
      : "-";
    const checksRateValue = totalChecks > 0
      ? `${Math.round((passedChecks / totalChecks) * 100)}% (${passedChecks}/${totalChecks})`
      : "-";
    const rpaActionsValue = Number(latestRunDetail.observability?.rpa_actions_executed || 0);
    const rpaFailuresValue = Number(latestRunDetail.observability?.rpa_stop_condition_failures || 0);
    const rpaDurationMs = Number(latestRunDetail.observability?.rpa_action_duration_ms_total || 0);
    const rpaDurationValue = Number.isFinite(rpaDurationMs) && rpaDurationMs > 0
      ? `${rpaDurationMs.toFixed(1)}ms`
      : "-";
    return [
      {
        label: t("pipelines.latestRunStatus"),
        value: latestRun.status || "-",
      },
      {
        label: t("pipelines.latestRunScore"),
        value: scoreValue,
      },
      {
        label: t("pipelines.latestRunDuration"),
        value: durationValue,
      },
      {
        label: t("pipelines.latestRunChecksRate"),
        value: checksRateValue,
      },
      {
        label: t("pipelines.latestRunUpdatedAt"),
        value: latestRun.updated_at || latestRun.created_at || "-",
      },
      {
        label: t("pipelines.latestRunRpaActions"),
        value: rpaActionsValue > 0 ? String(rpaActionsValue) : "-",
      },
      {
        label: t("pipelines.latestRunRpaStopFailures"),
        value: rpaFailuresValue > 0 ? String(rpaFailuresValue) : "0",
      },
      {
        label: t("pipelines.latestRunRpaDuration"),
        value: rpaDurationValue,
      },
    ];
  }, [latestRun, latestRunDetail, t]);

  const selectedRunItem = useMemo(
    () => (selectedRunKey ? selectedPipelineRuns.find((run) => buildRunIdentity(run) === selectedRunKey) || null : null),
    [selectedPipelineRuns, selectedRunKey],
  );

  const selectedRunDetail = useMemo(
    () => (selectedRunKey ? runDetailsByKey[selectedRunKey] || null : null),
    [runDetailsByKey, selectedRunKey],
  );

  const selectedRunLoading = useMemo(
    () => selectedRunDetailLoadingKey === selectedRunKey,
    [selectedRunDetailLoadingKey, selectedRunKey],
  );

  const selectedRunError = useMemo(
    () => (selectedRunKey ? selectedRunDetailErrorByKey[selectedRunKey] || "" : ""),
    [selectedRunDetailErrorByKey, selectedRunKey],
  );

  const selectedRunStep = useMemo(
    () => (selectedRunDetail && selectedRunStepId
      ? selectedRunDetail.steps.find((step) => step.id === selectedRunStepId) || null
      : null),
    [selectedRunDetail, selectedRunStepId],
  );

  useEffect(() => {
    if (!selectedPipeline || selectedPipeline.source !== "project") {
      return;
    }
    if (runsLoadedKeys[selectedPipeline.key] || runsLoadingKeys[selectedPipeline.key]) {
      return;
    }
    void loadRunsForPipeline(selectedPipeline);
  }, [loadRunsForPipeline, runsLoadedKeys, runsLoadingKeys, selectedPipeline]);

  useEffect(() => {
    if (!selectedPipeline || selectedPipeline.source !== "project") {
      return;
    }
    setRunsVisibleLimitByPipelineKey((prev) => {
      if (prev[selectedPipeline.key] === INITIAL_VISIBLE_RUNS) {
        return prev;
      }
      return {
        ...prev,
        [selectedPipeline.key]: INITIAL_VISIBLE_RUNS,
      };
    });
  }, [selectedPipeline]);

  useEffect(() => {
    setSelectedRunKey("");
    setSelectedRunStepId("");
    setStepDetailDrawerOpen(false);
    setSelectedRunDetailLoadingKey("");
    setSelectedRunDetailErrorByKey({});
  }, [selectedPipeline?.key]);

  useEffect(() => {
    if (!selectedAgent || !selectedPipeline || selectedPipeline.source !== "project" || !selectedRunsLoaded) {
      return;
    }

    const targets = visibleRuns
      .slice(0, 10)
      .filter((run) => !runDetailsByKey[buildRunIdentity(run)]);
    if (targets.length === 0) {
      return;
    }

    let cancelled = false;
    void Promise.allSettled(
      targets.map((run) =>
        agentsApi
          .getProjectPipelineRun(selectedAgent, run.projectId, run.id)
          .then((detail) => ({ run, detail })),
      ),
    ).then((results) => {
      if (cancelled) return;
      const patch: Record<string, ProjectPipelineRunDetail> = {};
      results.forEach((result) => {
        if (result.status !== "fulfilled") return;
        patch[buildRunIdentity(result.value.run)] = result.value.detail;
      });
      if (Object.keys(patch).length > 0) {
        setRunDetailsByKey((prev) => ({ ...prev, ...patch }));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [runDetailsByKey, selectedAgent, selectedPipeline, selectedRunsLoaded, visibleRuns]);

  useEffect(() => {
    if (!selectedAgent) return;

    const draftTemplates = templates.filter((item) =>
      draftPipelineKeys.includes(buildPipelineGroupKey(item.id, getTemplateSourceKind(item), item.projectId)),
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
      const designScope = targetScope === "builtin" ? "project" : targetScope;
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
        scope: designScope,
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
            t("pipelines.boundSessionRestored"),
          );
          return;
        }
      }

      const bindingMeta = buildPipelineChatBindingMeta({
        pipelineId: normalizedTarget.pipelineId,
        pipelineName: normalizedTarget.pipelineName,
        version: normalizedTarget.version,
        scope: normalizedTarget.source === "builtin"
          ? "project"
          : (normalizedTarget.source || "independent"),
        agentId: selectedAgent,
        flowMemoryPath:
          flowMemoryRelativePath ||
          (normalizedTarget.pipelineId && normalizedTarget.pipelineId !== "unknown"
            ? buildPipelineFlowMemoryRelativePath(normalizedTarget.pipelineId)
            : undefined),
      });

      const created = await chatApi.createChat({
        name: t("pipelines.designSessionName"),
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
          t("pipelines.boundSessionCreated"),
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
      message.warning(t("pipelines.noAgent"));
      return;
    }

    const now = Date.now();
    const draftId = `pipeline-${now}`;
    const draftVersion = "0.1.0";
    const draftTemplate: TemplateItem = {
      id: draftId,
      name: t("pipelines.newPipelineName"),
      version: draftVersion,
      description: t("pipelines.newPipelineDescription"),
      steps: [],
      projectId: INDEPENDENT_PIPELINE_SCOPE_ID,
      projectName: t("pipelines.independentScope"),
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

  const applyImportedRpaTemplate = useCallback((imported: ProjectPipelineTemplateInfo) => {
    const importedKey = buildPipelineGroupKey(imported.id, "independent");
    setTemplates((prev) => {
      let replaced = false;
      const next = prev.map((item) => {
        if (
          item.id === imported.id
          && item.projectId === INDEPENDENT_PIPELINE_SCOPE_ID
          && getTemplateSourceKind(item) === "independent"
        ) {
          replaced = true;
          return {
            ...item,
            ...imported,
            projectId: INDEPENDENT_PIPELINE_SCOPE_ID,
            projectName: independentScopeLabel,
            sourceScope: "independent" as const,
            projectCreatedTime: "",
          };
        }
        return item;
      });

      if (!replaced) {
        next.unshift({
          ...imported,
          projectId: INDEPENDENT_PIPELINE_SCOPE_ID,
          projectName: independentScopeLabel,
          sourceScope: "independent" as const,
          projectCreatedTime: "",
        });
      }

      return next;
    });
    setDraftPipelineKeys((prev) => prev.filter((key) => key !== importedKey));
    setSourceFilter("independent");
    setSelectedPipelineKey(importedKey);
    setSelectedCurrentVersion(normalizeVersion(imported.version || "0.1.0"));
    setSelectedCompareVersion("");
  }, [independentScopeLabel]);

  const handleImportBuiltinRpaTemplate = useCallback(async () => {
    if (!selectedAgent) {
      message.warning(t("pipelines.noAgent"));
      return;
    }
    setRpaImporting(true);
    try {
      const pkg = await agentsApi.getBuiltinEbookRpaTemplatePackage(selectedAgent);
      const imported = await agentsApi.importRpaTemplate(selectedAgent, {
        package: pkg,
      });
      applyImportedRpaTemplate(imported);
      message.success(
        t(
          "pipelines.rpaImportBuiltinSuccess",
          { name: imported.name || imported.id },
        ),
      );
    } catch (error) {
      console.error("failed to import builtin rpa template", error);
      message.error(
        t("pipelines.rpaImportBuiltinFailed"),
      );
    } finally {
      setRpaImporting(false);
    }
  }, [applyImportedRpaTemplate, selectedAgent, t]);

  const handleConfirmImportRpaJson = useCallback(async () => {
    if (!selectedAgent) {
      message.warning(t("pipelines.noAgent"));
      return;
    }

    const raw = rpaImportJson.trim();
    if (!raw) {
      message.warning(
        t("pipelines.rpaImportJsonEmpty"),
      );
      return;
    }

    let parsed: RpaTemplatePackageDocument;
    try {
      parsed = JSON.parse(raw) as RpaTemplatePackageDocument;
    } catch {
      message.error(
        t("pipelines.rpaImportJsonInvalid"),
      );
      return;
    }

    setRpaImporting(true);
    try {
      const imported = await agentsApi.importRpaTemplate(selectedAgent, {
        package: parsed,
        target_template_id: rpaImportTemplateId.trim() || undefined,
      });
      applyImportedRpaTemplate(imported);
      setRpaImportModalOpen(false);
      setRpaImportJson("");
      setRpaImportTemplateId("");
      message.success(
        t(
          "pipelines.rpaImportJsonSuccess",
          { name: imported.name || imported.id },
        ),
      );
    } catch (error) {
      console.error("failed to import rpa package json", error);
      message.error(
        t("pipelines.rpaImportJsonFailed"),
      );
    } finally {
      setRpaImporting(false);
    }
  }, [applyImportedRpaTemplate, rpaImportJson, rpaImportTemplateId, selectedAgent, t]);

  const handleExportSelectedPipelineAsRpaJson = useCallback(async () => {
    if (!selectedAgent || !selectedTemplateItem || !selectedPipeline) {
      message.warning(t("pipelines.noAgent"));
      return;
    }
    if (selectedPipeline.source !== "independent") {
      message.warning(
        t("pipelines.rpaExportIndependentOnly"),
      );
      return;
    }

    setRpaExporting(true);
    try {
      const normalizedTags = rpaExportTags
        .split(/[，,\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
      const payload = await agentsApi.exportPipelineTemplateAsRpaPackage(
        selectedAgent,
        selectedTemplateItem.id,
        {
          author: rpaExportAuthor.trim() || undefined,
          note: rpaExportNote.trim() || undefined,
          tags: normalizedTags.length > 0 ? normalizedTags : undefined,
        },
      );
      setRpaExportJson(`${JSON.stringify(payload, null, 2)}\n`);
      const safeTemplateId = String(selectedTemplateItem.id || "rpa-template").trim() || "rpa-template";
      setRpaExportFileName(`${safeTemplateId}.rpa-template.json`);
      setRpaExportModalOpen(true);
      message.success(
        t("pipelines.rpaExportSuccess"),
      );
    } catch (error) {
      console.error("failed to export rpa package", error);
      message.error(
        t("pipelines.rpaExportFailed"),
      );
    } finally {
      setRpaExporting(false);
    }
  }, [rpaExportAuthor, rpaExportNote, rpaExportTags, selectedAgent, selectedPipeline, selectedTemplateItem, t]);

  const handleCopyExportedRpaJson = useCallback(async () => {
    const text = rpaExportJson.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(rpaExportJson);
      message.success(
        t("pipelines.rpaExportCopySuccess"),
      );
    } catch {
      message.warning(
        t("pipelines.rpaExportCopyFailed"),
      );
    }
  }, [rpaExportJson, t]);

  const handleDownloadExportedRpaJson = useCallback(() => {
    const payload = rpaExportJson.trim();
    if (!payload) {
      return;
    }
    try {
      const blob = new Blob([rpaExportJson], { type: "application/json;charset=utf-8" });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = rpaExportFileName || "rpa-template-package.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      message.success(
        t("pipelines.rpaExportDownloadSuccess"),
      );
    } catch {
      message.error(
        t("pipelines.rpaExportDownloadFailed"),
      );
    }
  }, [rpaExportFileName, rpaExportJson, t]);

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
          const key = buildPipelineGroupKey(item.id, getTemplateSourceKind(item), item.projectId);
          return draftPipelineKeys.includes(key) && key !== savedDraftKey;
        },
      );
      const preservedDraftKeys = draftPipelineKeys.filter((key) => key !== savedDraftKey);

      const hasStreamFailure = false;
      const streamFailureStatusCode = 0;
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
        content: t("pipelines.saveDraftPending"),
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
              const payload = event.payload || {};
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
        builtinScopeLabel,
        projectScopeLabel,
      );

      setTemplates([...preservedDraftTemplates, ...data.templates]);
      setRunsByPipelineKey({});
      setRunsLoadedKeys({});
      setRunsLoadingKeys({});
      setRunsErrorByKey({});
      setRunDetailsByKey({});
      setRunsVisibleLimitByPipelineKey({});
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
      message.success(t("pipelines.saveDraftSuccess"));
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
      message.error(t("pipelines.saveDraftFailed"));
    } finally {
      setDraftSaving(false);
    }
  };

  const handleEnterEditMode = async () => {
    if (!selectedPipeline || !currentTemplate) {
      message.warning(t("pipelines.selectPipelineFirst"));
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
          t("pipelines.incrementalProposalEmpty"),
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
            t("pipelines.incrementalStepSaved", {
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
          t("pipelines.incrementalGenerationDone"),
        );
      } catch (error) {
        console.error("failed to apply confirmed pipeline proposal", error);
        setDraftParseStatus("error");
        setDraftParseError(t("pipelines.stepSaveFailed"));
        setIncrementalGeneration((prev) => ({
          ...prev,
          createStage: "await_confirm",
          parseRetryCount: 0,
        }));
        message.error(t("pipelines.stepSaveFailed"));
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
          ? t("pipelines.strategyStepwise")
          : t("pipelines.strategyPlanThenRefine");

      try {
        sessionApi.setLastUserMessage(designChatSessionId, strategyInput);
        await chatApi.startConsoleChat({
          sessionId: designChatSessionId,
          prompt: strategyInput,
          userId: "default",
          channel: "console",
        });
        message.info(
          t("pipelines.strategySelectedHint", {
            strategy: strategyLabel,
          }),
        );
      } catch (error) {
        console.error("failed to submit strategy selection", error);
        message.error(
          t("pipelines.strategySubmitFailed"),
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
        t("pipelines.reenterTopicHint"),
      );
    } catch (error) {
      console.error("failed to request topic re-entry", error);
      message.warning(
        t("pipelines.reenterTopicFailed"),
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
            t("pipelines.incrementalTopicCaptured"),
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
          t("pipelines.incrementalEditStart"),
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
              t("pipelines.incrementalGenerationStart"),
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
            t("pipelines.incrementalProposalStart"),
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
              t("pipelines.incrementalGenerationDone"),
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
                t("pipelines.stepParseRepairing"),
              );
              return;
            }

            setDraftParseStatus("error");
            setDraftParseError(parsed.error || t("pipelines.stepParseFailed"));
            message.warning(
              parsed.error || t("pipelines.stepParseFailed"),
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
              t("pipelines.incrementalStepSaved", {
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
            setDraftParseError(t("pipelines.stepSaveFailed"));
            message.error(t("pipelines.stepSaveFailed"));
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
                t("pipelines.stepParseRepairing"),
              );
              return;
            }

            setDraftParseStatus("error");
            setDraftParseError(parsedProposal.error || t("pipelines.stepParseFailed"));
            message.warning(
              parsedProposal.error || t("pipelines.stepParseFailed"),
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
                t("pipelines.incrementalProposalRefresh"),
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
            parsed.message || t("pipelines.incrementalEditDone"),
          );
          return;
        }

        if (parsed.success && parsed.needsUserInput) {
          setIncrementalGeneration((prev) => ({
            ...prev,
            active: false,
          }));
          message.info(
            parsed.message || t("pipelines.incrementalNeedsUserInput"),
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
              t("pipelines.stepParseRepairing"),
            );
            return;
          }

          setIncrementalGeneration((prev) => ({
            ...prev,
            active: false,
          }));
          setDraftParseStatus("error");
          setDraftParseError(parsed.error || t("pipelines.stepParseFailed"));
          message.warning(parsed.error || t("pipelines.stepParseFailed"));
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
              ? t("pipelines.incrementalDeleteApplied")
              : t("pipelines.incrementalEditApplied"),
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
          setDraftParseError(t("pipelines.stepSaveFailed"));
          message.error(t("pipelines.stepSaveFailed"));
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
                {t("pipelines.diffOldValue")}
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
                {t("pipelines.diffNewValue")}
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
            {t("pipelines.title")}
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
              { value: "all", label: t("pipelines.sourceFilterAll") },
              { value: "independent", label: t("pipelines.sourceFilterIndependent") },
              { value: "project", label: t("pipelines.sourceFilterProject") },
              { value: "builtin", label: t("pipelines.builtin", "Built-in") },
            ]}
          />
          <Button
            data-testid="pipeline-open-design-chat"
            loading={designChatStarting}
            disabled={designChatStarting}
            onClick={() => void handleCreatePipelineAndEnterEdit()}
          >
            {t("pipelines.create")}
          </Button>
          <Button
            loading={rpaImporting}
            disabled={rpaImporting || !selectedAgent}
            onClick={() => void handleImportBuiltinRpaTemplate()}
          >
            {t("pipelines.rpaImportBuiltinAction")}
          </Button>
          <Button
            disabled={rpaImporting || !selectedAgent}
            onClick={() => setRpaImportModalOpen(true)}
          >
            {t("pipelines.rpaImportJsonAction")}
          </Button>
          <Button type="primary" onClick={() => navigate("/projects")}>
            {t("pipelines.openProjects")}
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
            {t("pipelines.totalTemplates")}
          </Text>
          <div className={styles.metricValue}>{templates.length}</div>
        </Card>
        <Card size="small" className={styles.metricCard}>
          <Text className={styles.metricLabel}>
            {t("pipelines.totalRuns")}
          </Text>
          <div className={styles.metricValue}>{hasAnyRunsLoaded ? allLoadedRuns.length : "-"}</div>
        </Card>
        <Card size="small" className={styles.metricCard}>
          <Text className={styles.metricLabel}>
            {t("pipelines.runningRuns")}
          </Text>
          <div className={styles.metricValue}>{hasAnyRunsLoaded ? runningCount : "-"}</div>
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
              description={t("pipelines.noAgent")}
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
              title={t("pipelines.library")}
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
                    const isProjectBuiltinKnowledge =
                      item.source === "project"
                      && item.versions.some((version) => isProjectDerivedBuiltinKnowledgeTemplate({
                        id: item.id,
                        projectId: item.groupProjectId || item.projects[0]?.id || "",
                        system_owned: version.system_owned,
                        builtin_kind: version.builtin_kind ?? undefined,
                      }));
                    const derivedProjectId = item.groupProjectId || item.projects[0]?.id || "-";
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
                          {isProjectBuiltinKnowledge ? (
                            <>
                              <Tag color="purple">{t("pipelines.builtin", "Built-in")}</Tag>
                              <Tag color="blue">{`Project:${derivedProjectId}`}</Tag>
                            </>
                          ) : (
                            <Tag color={item.source === "independent" ? "cyan" : item.source === "project" ? "gold" : "purple"}>
                              {item.source === "independent"
                                ? t("pipelines.independent")
                                : item.source === "project"
                                  ? t("pipelines.project")
                                  : t("pipelines.builtin", "Built-in")}
                            </Tag>
                          )}
                          {draftPipelineKeys.includes(item.key) ? (
                            <Tag color="warning">
                              {t("pipelines.draftBadge")}
                            </Tag>
                          ) : null}
                        </div>
                        <Text type="secondary">{item.description || item.id}</Text>
                        <Text type="secondary" className={styles.helperText}>
                          {t("pipelines.versionCount", {
                            count: item.versions.length,
                          })}
                        </Text>
                        <Text type="secondary" className={styles.helperText}>
                          {t("pipelines.usedIn", {
                            count: item.projects.length,
                          })}
                        </Text>
                        {isProjectBuiltinKnowledge ? (
                          <Text type="secondary" className={styles.helperText}>
                            {`Derived from project: ${derivedProjectId}`}
                          </Text>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card
              title={t("pipelines.nodes")}
              className={styles.columnCard}
              extra={
                <div className={styles.nodesActions}>
                  {selectedIsBuiltinProjectKnowledgePipeline ? (
                    <>
                      <Select
                        size="small"
                        className={styles.versionSelect}
                        value={selectedBuiltinProjectId || undefined}
                        placeholder={t("pipelines.projectLabel", { name: "" })}
                        options={projects.map((project) => ({
                          label: project.name,
                          value: project.id,
                        }))}
                        onChange={(value) => setSelectedBuiltinProjectId(value)}
                      />
                      <Select
                        size="small"
                        className={styles.versionSelect}
                        value={builtinProcessingMode}
                        options={[
                          { label: "Fast", value: "fast" },
                          { label: "NLP", value: "nlp" },
                          { label: "Agentic", value: "agentic" },
                        ]}
                        onChange={(value) => setBuiltinProcessingMode(value as ProjectKnowledgeProcessingMode)}
                      />
                      <Button
                        size="small"
                        loading={builtinRunLoading}
                        disabled={builtinRunLoading || !selectedBuiltinProjectId}
                        onClick={() => void handleRunBuiltinProjectKnowledgePipeline()}
                      >
                        {t("pipelines.run", "Run")}
                      </Button>
                      <Button
                        size="small"
                        loading={builtinRunLoading}
                        disabled={builtinRunLoading || !selectedBuiltinProjectId}
                        onClick={() => void handleRetryBuiltinProjectKnowledgePipeline()}
                      >
                        {t("pipelines.retry", "Retry")}
                      </Button>
                    </>
                  ) : selectedIsProjectBuiltinKnowledgeWorkflowPipeline ? (
                    <>
                      <Select
                        size="small"
                        className={styles.versionSelect}
                        value={selectedBuiltinProjectId || undefined}
                        placeholder={t("pipelines.projectLabel", { name: "" })}
                        options={(selectedPipeline?.projects || []).map((project) => ({
                          label: project.name,
                          value: project.id,
                        }))}
                        onChange={(value) => setSelectedBuiltinProjectId(value)}
                      />
                      <Button
                        size="small"
                        loading={builtinRunLoading}
                        disabled={builtinRunLoading || !selectedBuiltinProjectId || !selectedAgent}
                        onClick={() => void handleRunProjectBuiltinKnowledgeWorkflowPipeline()}
                      >
                        {t("pipelines.run", "Run")}
                      </Button>
                      <Button
                        size="small"
                        loading={builtinRunLoading}
                        disabled={builtinRunLoading || !selectedBuiltinProjectId || !projectBuiltinLatestRun || !selectedAgent}
                        onClick={() => void handleRetryProjectBuiltinKnowledgeWorkflowPipeline()}
                      >
                        {t("pipelines.retry", "Retry")}
                      </Button>
                    </>
                  ) : null}
                  <Select
                    size="small"
                    className={styles.versionSelect}
                    value={selectedCurrentVersion || undefined}
                    placeholder={t("pipelines.currentVersion")}
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
                  <Button
                    size="small"
                    loading={rpaExporting}
                    disabled={
                      rpaExporting
                      || !selectedAgent
                      || !selectedTemplateItem
                      || selectedPipeline?.source !== "independent"
                    }
                    onClick={() => void handleExportSelectedPipelineAsRpaJson()}
                  >
                    {t("pipelines.rpaExportAction")}
                  </Button>
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
                          {t("pipelines.saveDraft")}
                        </Button>
                      ) : null}
                      <Button
                        size="small"
                        onClick={requestCloseEditMode}
                      >
                        {t("pipelines.exitEdit")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="small"
                      type="primary"
                      loading={designChatStarting}
                      disabled={!currentTemplate || designChatStarting || !selectedPipelineEditable}
                      onClick={() => void handleEnterEditMode()}
                    >
                      {t("pipelines.enterEdit")}
                    </Button>
                  )}
                </div>
              }
            >
              {selectedPipeline ? (
                <div className={styles.list} style={{ marginBottom: 12 }}>
                  <div className={styles.listItemStatic}>
                    <div className={styles.listItemHeader}>
                      <Text strong>{t("pipelines.templatePath", "Template Path")}</Text>
                    </div>
                    <Text type="secondary">{selectedPipelineFilePath || "-"}</Text>
                  </div>
                </div>
              ) : null}
              {selectedIsBuiltinProjectKnowledgePipeline ? (
                <div className={styles.list} style={{ marginBottom: 12 }}>
                  <div className={styles.listItemStatic}>
                    <div className={styles.listItemHeader}>
                      <Text strong>{t("pipelines.builtinRuntime", "Runtime Status")}</Text>
                      <Tag color={statusTagColor(String(builtinSyncState?.status || "idle"))}>
                        {String(builtinSyncState?.status || "idle")}
                      </Tag>
                      {builtinSyncLoading ? <Tag>{t("common.loading", "Loading")}</Tag> : null}
                    </div>
                    <Text type="secondary">
                      {t("pipelines.projectLabel", {
                        name: projects.find((item) => item.id === selectedBuiltinProjectId)?.name || selectedBuiltinProjectId || "-",
                      })}
                    </Text>
                    <Text type="secondary" className={styles.helperText}>
                      {t("pipelines.currentStage", "Stage")}: {String(builtinSyncState?.current_stage || builtinSyncState?.stage || "idle")}
                    </Text>
                    <Text type="secondary" className={styles.helperText}>
                      {t("pipelines.progress", "Progress")}: {Number(builtinSyncState?.progress || 0)}%
                    </Text>
                    {builtinSyncState?.last_error ? (
                      <Text type="danger" className={styles.helperText}>
                        {t("pipelines.lastError", "Last error")}: {builtinSyncState.last_error}
                      </Text>
                    ) : null}
                  </div>
                  {builtinRuntimeStages.map((stage) => (
                    <div key={stage.key} className={styles.listItemStatic}>
                      <div className={styles.listItemHeader}>
                        <Text strong>{stage.label}</Text>
                        <Tag color={statusTagColor(stage.status)}>{stage.status}</Tag>
                      </div>
                      {stage.legacyMapped ? (
                        <Text type="secondary" className={styles.helperText}>
                          {t(
                            "pipelines.builtinLegacyMapping",
                            "Mapped from legacy NLP sub-stages",
                          )}
                        </Text>
                      ) : null}
                      <Text type="secondary" className={styles.helperText}>
                        {t("pipelines.progress", "Progress")}: {stage.progress == null ? "-" : `${stage.progress}%`}
                      </Text>
                      <Text type="secondary" className={styles.helperText}>
                        {t("pipelines.summary", "Summary")}: {stage.summary || "-"}
                      </Text>
                    </div>
                  ))}
                </div>
              ) : selectedIsProjectBuiltinKnowledgeWorkflowPipeline ? (
                <div className={styles.list} style={{ marginBottom: 12 }}>
                  <div className={styles.listItemStatic}>
                    <div className={styles.listItemHeader}>
                      <Text strong>{t("pipelines.latestRun", "Latest Run")}</Text>
                      <Tag color={statusTagColor(String(projectBuiltinLatestRun?.status || "idle"))}>
                        {String(projectBuiltinLatestRun?.status || "idle")}
                      </Tag>
                      {projectBuiltinRunDetailLoading ? <Tag>{t("common.loading", "Loading")}</Tag> : null}
                    </div>
                    <Text type="secondary">
                      {t("pipelines.projectLabel", {
                        name:
                          selectedPipeline?.projects.find((item) => item.id === selectedBuiltinProjectId)?.name
                          || selectedBuiltinProjectId
                          || "-",
                      })}
                    </Text>
                    <Text type="secondary" className={styles.helperText}>
                      {t("pipelines.updatedAt", "Updated")}: {projectBuiltinLatestRun?.updated_at || projectBuiltinLatestRun?.created_at || "-"}
                    </Text>
                    <Text type="secondary" className={styles.helperText}>
                      {t("pipelines.currentStage", "Stage")}: {projectBuiltinCurrentStage}
                    </Text>
                    <Text type="secondary" className={styles.helperText}>
                      {t("pipelines.progress", "Progress")}: {projectBuiltinRunProgress == null ? "-" : `${projectBuiltinRunProgress}%`}
                    </Text>
                    {projectBuiltinLastError ? (
                      <Text type="danger" className={styles.helperText}>
                        {t("pipelines.lastError", "Last error")}: {projectBuiltinLastError}
                      </Text>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {!currentTemplate ? (
                <Empty
                  description={t(
                    "pipelines.selectPipeline",
                    "Select a pipeline to view nodes.",
                  )}
                />
              ) : currentTemplateDisplaySteps.length === 0 ? (
                <Empty
                  description={t(
                    "pipelines.emptyNodes",
                    "No nodes in this pipeline version.",
                  )}
                />
              ) : (
                <div className={styles.list}>
                  {currentTemplateDisplaySteps.map((step) => (
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

            {editMode && (
            <Card
              title={t("pipelines.newVersionNodes")}
              className={styles.columnCard}
              extra={
                <div className={styles.newVersionActions}>
                  <Button
                    type="text"
                    size="small"
                    onClick={() => setNewVersionNodesExpanded((prev) => !prev)}
                  >
                    {newVersionNodesExpanded
                      ? t("pipelines.collapseNewVersionNodes", "Collapse")
                      : t("pipelines.expandNewVersionNodes", "Expand")}
                  </Button>
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
                        ? t("pipelines.diffViewFull")
                        : t("pipelines.diffViewChangedOnly")}
                    </Button>
                  ) : null}
                  {editMode && draftParseStatus === "ready" && realtimeDraftDiffItems.length > 0 ? (
                    <Button size="small" onClick={toggleAllDraftDiffDetails}>
                      {allDraftDiffExpanded
                        ? t("pipelines.diffCollapseAll")
                        : t("pipelines.diffExpandAll")}
                    </Button>
                  ) : null}
                  <Select
                    size="small"
                    className={styles.versionSelect}
                    value={selectedCompareVersion || undefined}
                    allowClear
                    placeholder={t("pipelines.compareVersion")}
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
              {newVersionNodesExpanded && editMode && (saveStreamEvents.length > 0 || saveStreamError) ? (
                <div className={styles.saveStreamPanel}>
                  <Text type="secondary" className={styles.saveStreamTitle}>
                    {t("pipelines.saveStreamTimeline")}
                  </Text>
                  {saveStreamEvents.map((item, index) => (
                    <Text key={`${item.event}-${item.ts}-${index}`} type="secondary" className={styles.saveStreamItem}>
                      {new Date(item.ts).toLocaleTimeString()} · {item.event}
                      {item.detail ? ` · ${item.detail}` : ""}
                    </Text>
                  ))}
                  {saveStreamError ? (
                    <Text type="danger" className={styles.saveStreamError}>
                      {t("pipelines.saveStreamError", {
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
                        {t("pipelines.conflictTitle")}
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
                        {t("pipelines.conflictRefresh")}
                      </Button>
                      {conflictRemoteDraftBackup.length > 0 ? (
                        <Button size="small" onClick={() => void handleUseRemoteDraftAfterConflict()}>
                          {t("pipelines.conflictUseRemote")}
                        </Button>
                      ) : null}
                      {conflictMergeAvailable ? (
                        <Button size="small" onClick={() => void handleMergeDraftAfterConflict()}>
                          {t("pipelines.conflictMerge")}
                        </Button>
                      ) : null}
                      {conflictRestoreAvailable ? (
                        <Button size="small" onClick={() => void handleRestoreLocalDraftAfterConflict()}>
                          {t("pipelines.conflictRestoreLocal")}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {newVersionNodesExpanded && editMode && draftParseStatus === "ready" && draftNewVersionSteps.length > 0 ? (
                <>
                  <Text type="secondary" className={styles.draftStatusText}>
                    {t("pipelines.draftRealtimeReady")}
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
                              ? t("pipelines.diffAdded")
                              : item.kind === "removed"
                                ? t("pipelines.diffRemoved")
                                : item.kind === "changed"
                                  ? t("pipelines.diffChanged")
                                  : t("pipelines.diffUnchanged")}
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
                                  ? t("pipelines.diffDetailHide")
                                  : t("pipelines.diffDetailShow")}
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
                            {t("pipelines.diffFields", {
                              fields: item.changedFields.join(", "),
                            })}
                          </Text>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </>
              ) : newVersionNodesExpanded && editMode && draftParseStatus === "error" ? (
                <Empty description={draftParseError || t("pipelines.draftParseError")} />
              ) : newVersionNodesExpanded && editMode ? (
                <Empty
                  description={t(
                    "pipelines.draftRealtimeHint",
                    "当右侧编辑对话修改流程 Markdown 工作文件后，这里会根据后端 draft 自动更新。",
                  )}
                />
              ) : newVersionNodesExpanded && !compareTemplate ? (
                <Empty
                  description={t(
                    "pipelines.selectNewVersion",
                    "Select a version as the new draft to compare with current nodes.",
                  )}
                />
              ) : newVersionNodesExpanded && newVersionDiffItems.length === 0 ? (
                <Empty
                  description={t(
                    "pipelines.noDiff",
                    "No diff available for this version pair.",
                  )}
                />
              ) : newVersionNodesExpanded ? (
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
                            ? t("pipelines.diffAdded")
                            : item.kind === "removed"
                              ? t("pipelines.diffRemoved")
                              : item.kind === "changed"
                                ? t("pipelines.diffChanged")
                                : t("pipelines.diffUnchanged")}
                        </Tag>
                      </div>
                      <Text type="secondary">{item.id}</Text>
                      <Text type="secondary" className={styles.helperText}>
                        {item.current?.description || item.compare?.description || "-"}
                      </Text>
                      {item.kind === "changed" && item.changedFields.length > 0 && (
                        <Text type="secondary" className={styles.helperText}>
                          {t("pipelines.diffFields", {
                            fields: item.changedFields.join(", "),
                          })}
                        </Text>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <Empty description={t("pipelines.newVersionNodesCollapsed", "Collapsed")} />
              )}
            </Card>
            )}

            <Card
              title={editMode ? t("pipelines.editChat") : t("pipelines.recentRuns")}
              className={`${styles.columnCard} ${editMode ? styles.chatColumn : ""}`}
              extra={
                editMode && designChatSessionId ? (
                  <Button size="small" onClick={() => navigate(`/chat/${designChatSessionId}`)}>
                    {t("pipelines.openInFullChat")}
                  </Button>
                ) : !editMode && selectedPipeline?.source === "project" ? (
                  <Button
                    size="small"
                    loading={selectedRunsLoading}
                    onClick={() => requestLoadSelectedPipelineRuns(selectedRunsLoaded)}
                  >
                    {selectedRunsLoaded
                      ? t("common.refresh")
                      : t("pipelines.loadRuns", "Load Runs")}
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
                              ? t("pipelines.incrementalProgress", {
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
                              {t("pipelines.confirmAndCreate")}
                            </Button>
                          ) : incrementalGeneration.createStage === "ask_strategy" ? (
                            <div style={{ display: "flex", gap: 8 }}>
                              <Button
                                size="small"
                                onClick={() => void handleSelectCreateStrategyByButton("stepwise")}
                              >
                                {t("pipelines.strategyStepwise")}
                              </Button>
                              <Button
                                size="small"
                                type="primary"
                                onClick={() => void handleSelectCreateStrategyByButton("plan_then_refine")}
                              >
                                {t("pipelines.strategyPlanThenRefine")}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                        {incrementalGeneration.userRequirements ? (
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                            <Text type="secondary" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {t("pipelines.topicSummaryLabel")}: {incrementalGeneration.userRequirements}
                            </Text>
                            <Button size="small" type="link" onClick={() => void handleEditCreateTopic()}>
                              {t("pipelines.editTopic")}
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
                        onSelectHistoryChat={(chatId) => {
                          setDesignChatSessionId(chatId);
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
              ) : selectedPipeline?.source !== "project" ? (
                <Empty
                  description={t(
                    "pipelines.runsProjectOnly",
                    "Runs are available for project pipelines only.",
                  )}
                />
              ) : !selectedRunsLoaded ? (
                <Empty
                  description={t(
                    "pipelines.runsOnDemandHint",
                    "Runs are loaded on demand. Click Load Runs to fetch execution records.",
                  )}
                />
              ) : selectedRunsLoading && visibleRuns.length === 0 ? (
                <div className={styles.loadingWrap}>
                  <Spin size="large" />
                </div>
              ) : selectedRunsError && visibleRuns.length === 0 ? (
                <Empty description={selectedRunsError} />
              ) : visibleRuns.length === 0 ? (
                <Empty
                  description={t(
                    "pipelines.emptyRuns",
                    "No pipeline runs yet.",
                  )}
                />
              ) : (
                <div className={styles.list}>
                  <div className={styles.latestRunSummary}>
                    <div className={styles.latestRunSummaryHeader}>
                      <Text strong>{t("pipelines.latestRunSummary")}</Text>
                      <Tag color={statusTagColor(latestRun?.status || "pending")}>
                        {latestRun?.status || "-"}
                      </Tag>
                    </div>
                    <Text type="secondary" className={styles.helperText}>
                      {t("pipelines.projectLabel", {
                        name: latestRun?.projectName || "-",
                      })}
                    </Text>
                    {latestRunDetail ? (
                      <div className={styles.latestRunSummaryMetrics}>
                        {latestRunSummaryItems.map((item) => (
                          <div key={item.label} className={styles.latestRunSummaryMetric}>
                            <Text type="secondary" className={styles.latestRunSummaryLabel}>
                              {item.label}
                            </Text>
                            <Text>{item.value}</Text>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={styles.latestRunSummaryLoading}>
                        <Spin size="small" />
                        <Text type="secondary">
                          {t("pipelines.latestRunLoading")}
                        </Text>
                      </div>
                    )}
                    {hasMoreRuns ? (
                      <div className={styles.loadMoreWrap}>
                        <Button size="small" onClick={handleLoadMoreRuns}>
                          {t("pipelines.loadMoreRuns", "加载更多")}
                        </Button>
                        <Text type="secondary" className={styles.helperText}>
                          {t("pipelines.visibleRunsCount", {
                            visible: visibleRuns.length,
                            total: selectedPipelineRuns.length,
                            defaultValue: `Showing ${visibleRuns.length} / ${selectedPipelineRuns.length}`,
                          })}
                        </Text>
                      </div>
                    ) : null}
                  </div>
                  {visibleRuns.map((run) => {
                    const runKey = buildRunIdentity(run);
                    const detail = runDetailsByKey[runKey];
                    const observability = detail?.observability;
                    const durationValue =
                      typeof observability?.duration_sec === "number"
                        ? `${observability.duration_sec.toFixed(2)}s`
                        : "-";
                    const rpaActions = Number(observability?.rpa_actions_executed || 0);
                    const rpaStopFailures = Number(observability?.rpa_stop_condition_failures || 0);
                    const isSelected = selectedRunKey === runKey;
                    return (
                    <div
                      key={runKey}
                      role="button"
                      tabIndex={0}
                      className={`${styles.listItem} ${isSelected ? styles.selected : ""}`}
                      onClick={() => handleSelectRun(run)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleSelectRun(run);
                        }
                      }}
                    >
                      <div className={styles.listItemHeader}>
                        <Text strong>{run.template_id}</Text>
                        <Tag color={statusTagColor(run.status)}>{run.status}</Tag>
                      </div>
                      <Text type="secondary">
                        {t("pipelines.projectLabel", {
                          name: run.projectName,
                        })}
                      </Text>
                      <Text type="secondary" className={styles.helperText}>
                        {run.updated_at || run.created_at}
                      </Text>
                      {observability ? (
                        <>
                          <Text type="secondary" className={styles.helperText}>
                            {t("pipelines.currentStage", "Stage")}: {observability.stage || "-"}
                          </Text>
                          <Text type="secondary" className={styles.helperText}>
                            {t("pipelines.duration", "Duration")}: {durationValue}
                          </Text>
                          <Text type="secondary" className={styles.helperText}>
                            {t("pipelines.errorClass", "Error class")}: {observability.error_class || "-"}
                          </Text>
                          <Text type="secondary" className={styles.helperText}>
                            {t("pipelines.latestRunRpaActions")}: {rpaActions > 0 ? rpaActions : "-"}
                          </Text>
                          <Text type="secondary" className={styles.helperText}>
                            {t("pipelines.latestRunRpaStopFailures")}: {rpaStopFailures}
                          </Text>
                        </>
                      ) : null}
                      <div className={styles.runActions}>
                        <Button
                          size="small"
                          type="link"
                          className={styles.runLink}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSourceFilter("project");
                            setSelectedPipelineKey(
                              buildPipelineGroupKey(run.template_id, "project", run.projectId),
                            );
                            setSelectedCompareVersion("");
                          }}
                        >
                          {t("pipelines.focusPipeline")}
                        </Button>
                        <Button
                          size="small"
                          type="link"
                          className={styles.runLink}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate("/projects");
                          }}
                        >
                          {t("pipelines.goToProjects")}
                        </Button>
                      </div>
                    </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {!editMode ? (
              <Card
                title={selectedRunItem
                  ? `${t("pipelines.runDetails")} · ${selectedRunItem.template_id}`
                  : t("pipelines.runDetails")}
                className={styles.columnCard}
              >
                {selectedPipeline?.source !== "project" ? (
                  <Empty
                    description={t(
                      "pipelines.runsProjectOnly",
                      "Runs are available for project pipelines only.",
                    )}
                  />
                ) : !selectedRunsLoaded ? (
                  <Empty
                    description={t(
                      "pipelines.selectRunToView",
                      "Select a run to view details.",
                    )}
                  />
                ) : !selectedRunKey || !selectedRunItem ? (
                  <Empty
                    description={t(
                      "pipelines.selectRunToView",
                      "Select a run to view details.",
                    )}
                  />
                ) : (
                  <div className={styles.list}>
                    <div className={styles.runDetailPanel}>
                      <div className={styles.runDetailPanelHeader}>
                        <div className={styles.runDetailPanelHeaderMain}>
                          <Text strong>{selectedRunItem.template_id}</Text>
                          <Text type="secondary" className={styles.helperText}>
                            {t("pipelines.projectLabel", { name: selectedRunItem.projectName })}
                          </Text>
                        </div>
                        <Tag color={statusTagColor(selectedRunItem.status)}>{selectedRunItem.status}</Tag>
                      </div>

                      {!selectedRunDetail && selectedRunLoading ? (
                        <div className={styles.latestRunSummaryLoading}>
                          <Spin size="small" />
                          <Text type="secondary">
                            {t("pipelines.runDetailLoading", "Loading run details...")}
                          </Text>
                        </div>
                      ) : !selectedRunDetail && selectedRunError ? (
                        <div className={styles.runDetailContent}>
                          <Text type="danger">{selectedRunError}</Text>
                          <Button size="small" onClick={() => handleSelectRun(selectedRunItem)}>
                            {t("common.retry", "Retry")}
                          </Button>
                        </div>
                      ) : selectedRunDetail ? (
                        <div className={styles.runDetailContent}>
                          <div className={styles.detailGroup}>
                            <Text strong className={styles.detailGroupTitle}>
                              {t("pipelines.baseInfo", "Base Info")}
                            </Text>
                            <div className={styles.detailSection}>
                              <Text strong className={styles.detailLabel}>{t("pipelines.runId")}</Text>
                              <Text type="secondary">{selectedRunDetail.id}</Text>
                            </div>
                            <div className={styles.detailSection}>
                              <Text strong className={styles.detailLabel}>{t("pipelines.createdAt")}</Text>
                              <Text type="secondary">{selectedRunDetail.created_at}</Text>
                            </div>
                            <div className={styles.detailSection}>
                              <Text strong className={styles.detailLabel}>{t("pipelines.updatedAt")}</Text>
                              <Text type="secondary">{selectedRunDetail.updated_at}</Text>
                            </div>
                          </div>

                          {selectedRunDetail.observability ? (
                            <div className={styles.detailGroup}>
                              <Text strong className={styles.detailGroupTitle}>
                                {t("pipelines.observability")}
                              </Text>
                              <div className={styles.detailSection}>
                                <Text strong className={styles.detailLabel}>{t("pipelines.stage")}</Text>
                                <Text type="secondary">{selectedRunDetail.observability.stage || "-"}</Text>
                              </div>
                              <div className={styles.detailSection}>
                                <Text strong className={styles.detailLabel}>{t("pipelines.duration", "Duration")}</Text>
                                <Text type="secondary">
                                  {typeof selectedRunDetail.observability.duration_sec === "number"
                                    ? `${selectedRunDetail.observability.duration_sec.toFixed(2)}s`
                                    : "-"}
                                </Text>
                              </div>
                              <div className={styles.detailSection}>
                                <Text strong className={styles.detailLabel}>{t("pipelines.errorClass")}</Text>
                                <Text type="secondary">{selectedRunDetail.observability.error_class || "-"}</Text>
                              </div>
                              <div className={styles.detailSection}>
                                <Text strong className={styles.detailLabel}>{t("pipelines.latestRunRpaActions")}</Text>
                                <Text type="secondary">{Number(selectedRunDetail.observability.rpa_actions_executed || 0) || "-"}</Text>
                              </div>
                              <div className={styles.detailSection}>
                                <Text strong className={styles.detailLabel}>{t("pipelines.latestRunRpaStopFailures")}</Text>
                                <Text type="secondary">{Number(selectedRunDetail.observability.rpa_stop_condition_failures || 0)}</Text>
                              </div>
                              <div className={styles.detailSection}>
                                <Text strong className={styles.detailLabel}>{t("pipelines.latestRunRpaDuration")}</Text>
                                <Text type="secondary">
                                  {typeof selectedRunDetail.observability.rpa_action_duration_ms_total === "number"
                                    ? `${selectedRunDetail.observability.rpa_action_duration_ms_total.toFixed(1)}ms`
                                    : "-"}
                                </Text>
                              </div>
                              <div className={styles.detailSection}>
                                <Text strong className={styles.detailLabel}>{t("pipelines.rpaActionBreakdown")}</Text>
                                <Text type="secondary">
                                  {Object.entries(selectedRunDetail.observability.rpa_action_count_by_kind || {})
                                    .map(([kind, count]) => `${kind}:${count}`)
                                    .join(", ") || "-"}
                                </Text>
                              </div>
                            </div>
                          ) : null}

                          {selectedRunDetail.convergence ? (
                            <div className={styles.detailGroup}>
                              <Text strong className={styles.detailGroupTitle}>
                                {t("pipelines.convergence", "Convergence")}
                              </Text>
                              <div className={styles.detailSection}>
                                <Text strong className={styles.detailLabel}>{t("pipelines.convergenceScore")}</Text>
                                <Text type="secondary">{selectedRunDetail.convergence.score || "-"}</Text>
                              </div>
                              <div className={styles.detailSection}>
                                <Text strong className={styles.detailLabel}>{t("pipelines.convergenceChecks")}</Text>
                                <Text type="secondary">
                                  {selectedRunDetail.convergence.passed_checks}/{selectedRunDetail.convergence.total_checks}
                                </Text>
                              </div>
                            </div>
                          ) : null}

                          <div className={styles.detailGroup}>
                            <Text strong className={styles.detailGroupTitle}>
                              {t("pipelines.stepDetails", "Step Details")} ({selectedRunDetail.steps.length})
                            </Text>
                            {selectedRunDetail.steps.length === 0 ? (
                              <Text type="secondary" className={styles.helperText}>
                                {t("pipelines.emptyStepDetails", "No step details available.")}
                              </Text>
                            ) : (
                              <div className={styles.runStepList}>
                                {selectedRunDetail.steps.map((step) => {
                                  const outputKeys = Object.keys(step.outputs || {});
                                  const metricKeys = Object.keys(step.metrics || {});
                                  return (
                                    <div
                                      key={step.id}
                                      role="button"
                                      tabIndex={0}
                                      className={styles.runStepCard}
                                      onClick={() => handleOpenRunStep(step.id)}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter" || event.key === " ") {
                                          event.preventDefault();
                                          handleOpenRunStep(step.id);
                                        }
                                      }}
                                    >
                                      <div className={styles.listItemHeader}>
                                        <Text strong>{step.name || step.id}</Text>
                                        <div className={styles.runStepTags}>
                                          <Tag color="blue">{step.kind || "-"}</Tag>
                                          <Tag color={statusTagColor(step.status || "pending")}>{step.status || "-"}</Tag>
                                        </div>
                                      </div>
                                      <Text type="secondary" className={styles.helperText}>{step.id}</Text>
                                      <Text type="secondary" className={styles.helperText}>{step.description || "-"}</Text>
                                      <div className={styles.runStepMetaRow}>
                                        <Text type="secondary" className={styles.helperText}>
                                          {t("pipelines.duration", "Duration")}: {formatStepDuration(step)}
                                        </Text>
                                        <Text type="secondary" className={styles.helperText}>
                                          {t("pipelines.dependsOn", "Depends on")}: {step.depends_on?.length ? step.depends_on.join(", ") : "-"}
                                        </Text>
                                      </div>
                                      <div className={styles.runStepMetaRow}>
                                        <Text type="secondary" className={styles.helperText}>
                                          {t("pipelines.outputs", "Outputs")}: {outputKeys.length ? outputKeys.join(", ") : "-"}
                                        </Text>
                                        <Text type="secondary" className={styles.helperText}>
                                          {t("pipelines.metrics", "Metrics")}: {metricKeys.length ? metricKeys.join(", ") : "-"}
                                        </Text>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                )}
              </Card>
            ) : null}

            <Drawer
              title={(
                <div className={styles.runDetailDrawerTitleWrap}>
                  <div className={styles.runDetailDrawerTitleTop}>
                    <Text strong>{selectedRunStep?.name || t("pipelines.stepDetails", "Step Details")}</Text>
                    {selectedRunStep ? (
                      <Tag color={statusTagColor(selectedRunStep.status || "pending")}>{selectedRunStep.status || "-"}</Tag>
                    ) : null}
                  </div>
                  <Text type="secondary" className={styles.helperText}>
                    {selectedRunStep?.id || "-"}
                  </Text>
                </div>
              )}
              open={stepDetailDrawerOpen && !editMode && Boolean(selectedRunStep)}
              onClose={() => setStepDetailDrawerOpen(false)}
              placement="right"
              width={520}
              className={styles.runDetailDrawer}
            >
              {!selectedRunStep ? (
                <Empty description={t("pipelines.selectStepToView", "Select a step to view details.")} />
              ) : (
                <div className={styles.runDetailContent}>
                  <div className={styles.detailGroup}>
                    <Text strong className={styles.detailGroupTitle}>
                      {t("pipelines.stepBaseInfo", "Step Base Info")}
                    </Text>
                    <div className={styles.detailSection}>
                      <Text strong className={styles.detailLabel}>
                        {t("pipelines.stepId", "Step ID")}
                      </Text>
                      <Text type="secondary">{selectedRunStep.id}</Text>
                    </div>
                    <div className={styles.detailSection}>
                      <Text strong className={styles.detailLabel}>
                        {t("pipelines.name", "Name")}
                      </Text>
                      <Text type="secondary">{selectedRunStep.name || "-"}</Text>
                    </div>
                    <div className={styles.detailSection}>
                      <Text strong className={styles.detailLabel}>
                        {t("pipelines.kind", "Kind")}
                      </Text>
                      <Text type="secondary">{selectedRunStep.kind || "-"}</Text>
                    </div>
                    <div className={styles.detailSection}>
                      <Text strong className={styles.detailLabel}>
                        {t("pipelines.status")}
                      </Text>
                      <Tag color={statusTagColor(selectedRunStep.status || "pending")}>{selectedRunStep.status || "-"}</Tag>
                    </div>
                    <div className={styles.detailSection}>
                      <Text strong className={styles.detailLabel}>
                        {t("pipelines.duration", "Duration")}
                      </Text>
                      <Text type="secondary">{formatStepDuration(selectedRunStep)}</Text>
                    </div>
                  </div>
                  <div className={styles.detailGroup}>
                    <Text strong className={styles.detailGroupTitle}>
                      {t("pipelines.schedule", "Schedule")}
                    </Text>
                    <div className={styles.detailSection}>
                      <Text strong className={styles.detailLabel}>{t("pipelines.startedAt", "Started")}</Text>
                      <Text type="secondary">{selectedRunStep.started_at || "-"}</Text>
                    </div>
                    <div className={styles.detailSection}>
                      <Text strong className={styles.detailLabel}>{t("pipelines.endedAt", "Ended")}</Text>
                      <Text type="secondary">{selectedRunStep.ended_at || "-"}</Text>
                    </div>
                    <div className={styles.detailSection}>
                      <Text strong className={styles.detailLabel}>{t("pipelines.dependsOn", "Depends on")}</Text>
                      <Text type="secondary">{selectedRunStep.depends_on?.length ? selectedRunStep.depends_on.join(", ") : "-"}</Text>
                    </div>
                  </div>

                  <div className={styles.detailGroup}>
                    <Text strong className={styles.detailGroupTitle}>
                      {t("pipelines.stepDescription", "Description")}
                    </Text>
                    <Text type="secondary">{selectedRunStep.description || "-"}</Text>
                  </div>

                  <div className={styles.detailGroup}>
                    <Text strong className={styles.detailGroupTitle}>
                      {t("pipelines.inputs", "Inputs")}
                    </Text>
                    <pre className={styles.detailJsonBlock}>{JSON.stringify(selectedRunStep.inputs || {}, null, 2)}</pre>
                  </div>

                  <div className={styles.detailGroup}>
                    <Text strong className={styles.detailGroupTitle}>
                      {t("pipelines.outputs", "Outputs")}
                    </Text>
                    <pre className={styles.detailJsonBlock}>{JSON.stringify(selectedRunStep.outputs || {}, null, 2)}</pre>
                  </div>

                  <div className={styles.detailGroup}>
                    <Text strong className={styles.detailGroupTitle}>
                      {t("pipelines.metrics", "Metrics")}
                    </Text>
                    <pre className={styles.detailJsonBlock}>{JSON.stringify(selectedRunStep.metrics || {}, null, 2)}</pre>
                  </div>

                  <div className={styles.detailGroup}>
                    <Text strong className={styles.detailGroupTitle}>
                      {t("pipelines.evidence", "Evidence")}
                    </Text>
                    {selectedRunStep.evidence?.length ? (
                      <div className={styles.runStepEvidenceList}>
                        {selectedRunStep.evidence.map((item, index) => (
                          <Text key={`${selectedRunStep.id}-evidence-${index}`} type="secondary" className={styles.helperText}>
                            {item}
                          </Text>
                        ))}
                      </div>
                    ) : (
                      <Text type="secondary">-</Text>
                    )}
                  </div>
                </div>
              )}
            </Drawer>

            <Modal
              title={t("pipelines.rpaImportModalTitle")}
              open={rpaImportModalOpen}
              onCancel={() => {
                if (rpaImporting) return;
                setRpaImportModalOpen(false);
              }}
              onOk={() => void handleConfirmImportRpaJson()}
              okButtonProps={{ loading: rpaImporting }}
              okText={t("pipelines.rpaImportModalConfirm")}
              cancelText={t("common.cancel")}
              destroyOnClose
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Text type="secondary">
                  {t("pipelines.rpaImportModalHint")}
                </Text>
                <Input
                  value={rpaImportTemplateId}
                  onChange={(event) => setRpaImportTemplateId(event.target.value)}
                  placeholder={t("pipelines.rpaImportTargetIdPlaceholder")}
                />
                <TextArea
                  value={rpaImportJson}
                  onChange={(event) => setRpaImportJson(event.target.value)}
                  autoSize={{ minRows: 10, maxRows: 18 }}
                  placeholder={t("pipelines.rpaImportJsonPlaceholder")}
                />
              </div>
            </Modal>

            <Modal
              title={t("pipelines.rpaExportModalTitle")}
              open={rpaExportModalOpen}
              onCancel={() => {
                if (rpaExporting) return;
                setRpaExportModalOpen(false);
              }}
              footer={[
                <Button
                  key="regenerate"
                  onClick={() => void handleExportSelectedPipelineAsRpaJson()}
                  loading={rpaExporting}
                  disabled={!selectedAgent || !selectedTemplateItem}
                >
                  {t("pipelines.rpaExportRegenerateAction")}
                </Button>,
                <Button
                  key="download"
                  onClick={handleDownloadExportedRpaJson}
                  disabled={!rpaExportJson.trim()}
                >
                  {t("pipelines.rpaExportDownloadAction")}
                </Button>,
                <Button
                  key="copy"
                  onClick={() => void handleCopyExportedRpaJson()}
                  disabled={!rpaExportJson.trim()}
                >
                  {t("pipelines.rpaExportCopyAction")}
                </Button>,
                <Button
                  key="close"
                  type="primary"
                  onClick={() => setRpaExportModalOpen(false)}
                >
                  {t("common.close", "关闭")}
                </Button>,
              ]}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Text type="secondary">
                  {t("pipelines.rpaExportModalHint")}
                </Text>
                <Input
                  value={rpaExportAuthor}
                  onChange={(event) => setRpaExportAuthor(event.target.value)}
                  placeholder={t("pipelines.rpaExportAuthorPlaceholder")}
                />
                <Input
                  value={rpaExportTags}
                  onChange={(event) => setRpaExportTags(event.target.value)}
                  placeholder={t("pipelines.rpaExportTagsPlaceholder")}
                />
                <Input
                  value={rpaExportNote}
                  onChange={(event) => setRpaExportNote(event.target.value)}
                  placeholder={t("pipelines.rpaExportNotePlaceholder")}
                />
                <TextArea
                  value={rpaExportJson}
                  readOnly
                  autoSize={{ minRows: 12, maxRows: 20 }}
                />
              </div>
            </Modal>
          </div>
        )}
      </div>
    </div>
  );
}