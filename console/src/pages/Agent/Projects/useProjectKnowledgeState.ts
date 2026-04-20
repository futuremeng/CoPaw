import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import api, { type GraphQueryResponse, getApiToken, getApiUrl } from "../../../api";
import type {
  GraphQueryRecord,
  KnowledgeTaskProgress,
  KnowledgeSourceContent,
  KnowledgeSourceItem,
  ProjectKnowledgeGlobalMetricsPayload,
  ProjectKnowledgeModeMetricsPayload,
  ProjectKnowledgeOutputResolutionPayload,
  ProjectKnowledgeModeOutputPayload,
  ProjectKnowledgeProcessingSchedulerPayload,
  ProjectKnowledgeProcessingModeStatePayload,
  ProjectKnowledgeSyncState,
  QualityLoopJobStatus,
} from "../../../api/types";
import {
  getProjectKnowledgeSyncAlertDescription,
  getProjectKnowledgeSyncAlertType,
} from "./projectKnowledgeSyncUi";

type ProjectGraphQueryMode = "template" | "cypher";

export interface ProjectKnowledgeHeaderSignals {
  indexedRatio: number;
  documentCount: number;
  chunkCount: number;
  sentenceCount: number;
  sentenceWithEntitiesCount: number;
  entityMentionsCount: number;
  avgEntitiesPerSentence: number;
  avgEntityCharRatio: number;
  relationCount: number;
  entityCount: number;
  relationNormalizationCoverage: number;
  entityCanonicalCoverage: number;
  lowConfidenceRatio: number;
  missingEvidenceRatio: number;
  relationNormalizationThreshold: number;
  entityCanonicalThreshold: number;
  lowConfidenceThreshold: number;
  missingEvidenceThreshold: number;
  qualityAssessmentScore: number;
}

export interface ProjectKnowledgeTrendSnapshot {
  ts: number;
  indexedRatio: number;
  documentCount: number;
  chunkCount: number;
  relationCount: number;
}

export interface ProjectKnowledgeMetrics {
  totalSources: number;
  indexedSources: number;
  indexedRatio: number;
  documentCount: number;
  chunkCount: number;
  sentenceCount: number;
  sentenceWithEntitiesCount: number;
  entityMentionsCount: number;
  avgEntitiesPerSentence: number;
  avgEntityCharRatio: number;
  relationCount: number;
  entityCount: number;
  relationNormalizationCoverage: number;
  entityCanonicalCoverage: number;
  lowConfidenceRatio: number;
  missingEvidenceRatio: number;
  relationNormalizationThreshold: number;
  entityCanonicalThreshold: number;
  lowConfidenceThreshold: number;
  missingEvidenceThreshold: number;
  qualityAssessmentScore: number;
}

export type ProjectKnowledgeProcessingMode = "fast" | "nlp" | "agentic";

export interface ProjectKnowledgeModeState {
  mode: ProjectKnowledgeProcessingMode;
  status: "idle" | "queued" | "running" | "ready" | "failed";
  available: boolean;
  progress: number | null;
  stage: string;
  summary: string;
  lastUpdatedAt: string;
  runId: string;
  jobId: string;
  documentCount: number;
  chunkCount: number;
  entityCount: number;
  relationCount: number;
  qualityScore: number | null;
}

export interface ProjectKnowledgeOutputResolution {
  activeMode: ProjectKnowledgeProcessingMode;
  availableModes: ProjectKnowledgeProcessingMode[];
  fallbackChain: ProjectKnowledgeProcessingMode[];
  reasonCode?: string;
  reason: string;
  skippedModes?: Array<{
    mode: ProjectKnowledgeProcessingMode;
    status: ProjectKnowledgeModeState["status"];
    reasonCode: string;
    reason: string;
  }>;
}

export interface ProjectKnowledgeProcessingScheduler {
  strategy: "parallel";
  modeOrder: ProjectKnowledgeProcessingMode[];
  runningModes: ProjectKnowledgeProcessingMode[];
  queuedModes: ProjectKnowledgeProcessingMode[];
  readyModes: ProjectKnowledgeProcessingMode[];
  failedModes: ProjectKnowledgeProcessingMode[];
  nextMode: ProjectKnowledgeProcessingMode | null;
  consumptionMode: ProjectKnowledgeProcessingMode;
  reason: string;
}

export interface ProjectKnowledgeModeArtifact {
  kind: string;
  label: string;
  path: string;
}

export interface ProjectKnowledgeModeOutput {
  mode: ProjectKnowledgeProcessingMode;
  source: string;
  summaryLines: string[];
  artifacts: ProjectKnowledgeModeArtifact[];
}

export type ProjectKnowledgeInsightAction = "settings" | "query" | "healthy";

export interface ProjectKnowledgeState {
  projectSourceId: string;
  sourceLoaded: boolean;
  sourceRegistered: boolean;
  projectSources: KnowledgeSourceItem[];
  selectedSourceId: string;
  setSelectedSourceId: (value: string) => void;
  sourceContentById: Record<string, KnowledgeSourceContent>;
  sourceContentLoadingById: Record<string, boolean>;
  loadSourceContent: (
    sourceId: string,
    options?: { force?: boolean },
  ) => Promise<KnowledgeSourceContent | null>;
  syncState: ProjectKnowledgeSyncState | null;
  activeKnowledgeTasks: KnowledgeTaskProgress[];
  activeKnowledgeTask: KnowledgeTaskProgress | null;
  latestQualityLoopJob?: QualityLoopJobStatus | null;
  memifyEnabled: boolean;
  processingModes: ProjectKnowledgeModeState[];
  activeOutputResolution: ProjectKnowledgeOutputResolution;
  processingScheduler: ProjectKnowledgeProcessingScheduler;
  modeOutputs: Record<ProjectKnowledgeProcessingMode, ProjectKnowledgeModeOutput>;
  quantMetrics: ProjectKnowledgeMetrics;
  graphQueryText: string;
  setGraphQueryText: (value: string) => void;
  graphQueryMode: ProjectGraphQueryMode;
  setGraphQueryMode: (value: ProjectGraphQueryMode) => void;
  graphQueryTopK: number;
  setGraphQueryTopK: (value: number) => void;
  graphNeedsRefresh: boolean;
  markGraphNeedsRefresh: () => void;
  graphLoading: boolean;
  graphError: string;
  graphResult: GraphQueryResponse | null;
  relationRecords: GraphQueryRecord[];
  relationKeywordSeed: string;
  setRelationKeywordSeed: (value: string) => void;
  activeGraphNodeId: string | null;
  setActiveGraphNodeId: (value: string | null) => void;
  runGraphQuery: (
    overrideQuery?: string,
    overrideMode?: ProjectGraphQueryMode,
    overrideTopK?: number,
    overrideOutputMode?: ProjectKnowledgeProcessingMode,
  ) => Promise<void>;
  startProcessingMode: (
    mode: ProjectKnowledgeProcessingMode,
    options?: { force?: boolean; trigger?: string },
  ) => Promise<void>;
  processingLaunchMode: ProjectKnowledgeProcessingMode | null;
  resetGraphQuery: () => void;
  trendRangeDays: 7 | 30;
  setTrendRangeDays: (value: 7 | 30) => void;
  trendExpanded: boolean;
  setTrendExpanded: (value: boolean | ((prev: boolean) => boolean)) => void;
  filteredTrendSnapshots: ProjectKnowledgeTrendSnapshot[];
  trendDocumentPath: string;
  trendChunkPath: string;
  trendDelta: {
    documentDelta: number;
    chunkDelta: number;
    relationDelta: number;
  };
  syncAlertType: "info" | "warning" | "error" | "success";
  syncAlertDescription: string;
  suggestedQuery: string;
  insightAction: ProjectKnowledgeInsightAction;
  insightMessageKey: string;
  loadProjectSourceStatus: () => Promise<void>;
  semanticBySourceId: Record<string, { subject?: string; summary?: string; keywords?: string[] }>;
  semanticLoadingBySourceId: Record<string, boolean>;
  loadSourceSemantic: (sourceId: string) => Promise<void>;
}

interface UseProjectKnowledgeStateParams {
  projectId: string;
  projectName: string;
  includeGlobal?: boolean;
  onSignalsChange?: (signals: ProjectKnowledgeHeaderSignals) => void;
  eagerSourceLoad?: boolean;
  eagerExploreLoad?: boolean;
}

interface ProjectKnowledgeUiPrefs {
  trendExpanded: boolean;
}

const PROJECT_TREND_STORAGE_PREFIX = "copaw.project.knowledge.trend.v1";
const PROJECT_KNOWLEDGE_UI_PREFS_PREFIX = "copaw.project.knowledge.ui.v1";
const DAY_MS = 24 * 60 * 60 * 1000;
const PROJECT_GRAPH_QUERY_TOP_K = 200;

const ACTIVE_KNOWLEDGE_STATUSES = new Set([
  "pending",
  "running",
  "queued",
  "indexing",
  "graphifying",
]);

function getActiveKnowledgeTasks(tasks: KnowledgeTaskProgress[]): KnowledgeTaskProgress[] {
  const priority = (task: KnowledgeTaskProgress): number => {
    const type = String(task.task_type || "");
    if (type === "project_sync") {
      return 0;
    }
    if (type === "memify") {
      return 1;
    }
    if (type === "history_backfill") {
      return 2;
    }
    if (type === "quality_loop") {
      return 3;
    }
    return 9;
  };

  return tasks
    .filter((task) => ACTIVE_KNOWLEDGE_STATUSES.has(String(task.status || "")))
    .sort((left, right) => {
      const p = priority(left) - priority(right);
      if (p !== 0) {
        return p;
      }
      return String(right.updated_at || "").localeCompare(String(left.updated_at || ""));
    });
}

function pickActiveKnowledgeTask(tasks: KnowledgeTaskProgress[]): KnowledgeTaskProgress | null {
  const active = getActiveKnowledgeTasks(tasks);
  return active[0] || null;
}

function uiPrefsStorageKey(projectId: string): string {
  return `${PROJECT_KNOWLEDGE_UI_PREFS_PREFIX}.${projectId || "default"}`;
}

function loadUiPrefs(projectId: string): ProjectKnowledgeUiPrefs {
  const fallback: ProjectKnowledgeUiPrefs = { trendExpanded: true };
  try {
    const raw = window.localStorage.getItem(uiPrefsStorageKey(projectId));
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<ProjectKnowledgeUiPrefs>;
    return {
      trendExpanded:
        typeof parsed.trendExpanded === "boolean"
          ? parsed.trendExpanded
          : fallback.trendExpanded,
    };
  } catch {
    return fallback;
  }
}

function saveUiPrefs(projectId: string, prefs: ProjectKnowledgeUiPrefs): void {
  try {
    window.localStorage.setItem(uiPrefsStorageKey(projectId), JSON.stringify(prefs));
  } catch {
    // Ignore localStorage quota or availability issues.
  }
}

function trendStorageKey(projectId: string): string {
  return `${PROJECT_TREND_STORAGE_PREFIX}.${projectId}`;
}

function dayToken(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function loadTrendSnapshots(projectId: string): ProjectKnowledgeTrendSnapshot[] {
  try {
    const raw = window.localStorage.getItem(trendStorageKey(projectId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as ProjectKnowledgeTrendSnapshot[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => Number.isFinite(item.ts))
      .sort((a, b) => a.ts - b.ts)
      .slice(-90);
  } catch {
    return [];
  }
}

function saveTrendSnapshots(projectId: string, snapshots: ProjectKnowledgeTrendSnapshot[]): void {
  try {
    window.localStorage.setItem(
      trendStorageKey(projectId),
      JSON.stringify(snapshots.slice(-90)),
    );
  } catch {
    // Ignore localStorage quota or availability issues.
  }
}

function upsertTrendSnapshot(
  snapshots: ProjectKnowledgeTrendSnapshot[],
  next: ProjectKnowledgeTrendSnapshot,
): ProjectKnowledgeTrendSnapshot[] {
  if (!snapshots.length) {
    return [next];
  }
  const token = dayToken(next.ts);
  const copied = [...snapshots];
  const sameDayIndex = copied.findIndex((item) => dayToken(item.ts) === token);
  if (sameDayIndex >= 0) {
    copied[sameDayIndex] = next;
    return copied.sort((a, b) => a.ts - b.ts);
  }
  copied.push(next);
  return copied.sort((a, b) => a.ts - b.ts).slice(-90);
}

function isSameSnapshotValue(
  left: ProjectKnowledgeTrendSnapshot,
  right: ProjectKnowledgeTrendSnapshot,
): boolean {
  return (
    left.indexedRatio === right.indexedRatio
    && left.documentCount === right.documentCount
    && left.chunkCount === right.chunkCount
    && left.relationCount === right.relationCount
  );
}

function buildSparklinePath(values: number[], width: number, height: number): string {
  if (!values.length) {
    return "";
  }
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const step = values.length > 1 ? width / (values.length - 1) : 0;

  return values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function getSyncRelationCount(syncState: ProjectKnowledgeSyncState | null): number {
  const memify = syncState?.last_result?.memify;
  if (!memify || typeof memify !== "object") {
    return 0;
  }
  const relationCount = (memify as { relation_count?: unknown }).relation_count;
  return Number.isFinite(Number(relationCount)) ? Number(relationCount) : Number(relationCount || 0);
}

function getSyncNodeCount(syncState: ProjectKnowledgeSyncState | null): number {
  const memify = syncState?.last_result?.memify;
  if (!memify || typeof memify !== "object") {
    return 0;
  }
  const nodeCount = (memify as { node_count?: unknown }).node_count;
  return Number.isFinite(Number(nodeCount)) ? Number(nodeCount) : Number(nodeCount || 0);
}

function getSyncIndexCount(
  syncState: ProjectKnowledgeSyncState | null,
  key: "document_count" | "chunk_count" | "sentence_count",
): number {
  const indexResult = syncState?.last_result?.index;
  if (!indexResult || typeof indexResult !== "object") {
    return 0;
  }
  const rawValue = (indexResult as Record<string, unknown>)[key];
  return Number.isFinite(Number(rawValue)) ? Number(rawValue) : Number(rawValue || 0);
}

function getSyncEnrichmentMetric(
  syncState: ProjectKnowledgeSyncState | null,
  key: string,
): number {
  const memify = syncState?.last_result?.memify;
  if (!memify || typeof memify !== "object") {
    return 0;
  }
  const enrichment = (memify as { enrichment_metrics?: unknown }).enrichment_metrics;
  if (!enrichment || typeof enrichment !== "object") {
    return 0;
  }
  const rawValue = (enrichment as Record<string, unknown>)[key];
  return Number.isFinite(Number(rawValue)) ? Number(rawValue) : Number(rawValue || 0);
}

function getSyncMemifyMetric(
  syncState: ProjectKnowledgeSyncState | null,
  key: string,
): number {
  const memify = syncState?.last_result?.memify;
  if (!memify || typeof memify !== "object") {
    return 0;
  }
  const rawValue = (memify as Record<string, unknown>)[key];
  return Number.isFinite(Number(rawValue)) ? Number(rawValue) : Number(rawValue || 0);
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, numerator / denominator));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getWorkflowRunMeta(syncState: ProjectKnowledgeSyncState | null): Record<string, unknown> {
  const workflowRun = syncState?.last_result?.workflow_run;
  if (!workflowRun || typeof workflowRun !== "object") {
    return {};
  }
  return workflowRun as Record<string, unknown>;
}

function isProcessingMode(
  value: unknown,
): value is ProjectKnowledgeProcessingMode {
  return value === "fast" || value === "nlp" || value === "agentic";
}

function normalizeModeStatus(
  value: unknown,
): ProjectKnowledgeModeState["status"] {
  return value === "queued"
    || value === "running"
    || value === "ready"
    || value === "failed"
    || value === "idle"
    ? value
    : "idle";
}

function normalizeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() && Number.isFinite(Number(value))
      ? Number(value)
      : 0;
}

function normalizeNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() && Number.isFinite(Number(value))
      ? Number(value)
      : null;
}

function getBackendModeMetric(
  syncState: ProjectKnowledgeSyncState | null,
  mode: ProjectKnowledgeProcessingMode,
): ProjectKnowledgeModeMetricsPayload | null {
  const payload = syncState?.mode_metrics;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const raw = payload[mode];
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return raw as ProjectKnowledgeModeMetricsPayload;
}

function getBackendModeMetricNumber(
  syncState: ProjectKnowledgeSyncState | null,
  mode: ProjectKnowledgeProcessingMode,
  key: keyof ProjectKnowledgeModeMetricsPayload,
): number {
  return normalizeNumber(getBackendModeMetric(syncState, mode)?.[key]);
}

function getBackendModeMetricNullableNumber(
  syncState: ProjectKnowledgeSyncState | null,
  mode: ProjectKnowledgeProcessingMode,
  key: keyof ProjectKnowledgeModeMetricsPayload,
): number | null {
  return normalizeNullableNumber(getBackendModeMetric(syncState, mode)?.[key]);
}

function getBackendGlobalMetricNumber(
  syncState: ProjectKnowledgeSyncState | null,
  key: keyof ProjectKnowledgeGlobalMetricsPayload,
): number {
  return normalizeNumber(syncState?.global_metrics?.[key]);
}

function parseBackendProcessingModes(
  syncState: ProjectKnowledgeSyncState | null,
): ProjectKnowledgeModeState[] | null {
  const payload = syncState?.processing_modes;
  if (!Array.isArray(payload) || payload.length === 0) {
    return null;
  }

  const parsed = payload
    .map((item) => {
      const modePayload = item as ProjectKnowledgeProcessingModeStatePayload;
      if (!isProcessingMode(modePayload.mode)) {
        return null;
      }
      return {
        mode: modePayload.mode,
        status: normalizeModeStatus(modePayload.status),
        available: Boolean(modePayload.available),
        progress: normalizeNullableNumber(modePayload.progress),
        stage: String(modePayload.stage || "").trim(),
        summary: String(modePayload.summary || "").trim(),
        lastUpdatedAt: String(modePayload.last_updated_at || "").trim(),
        runId: String(modePayload.run_id || "").trim(),
        jobId: String(modePayload.job_id || "").trim(),
        documentCount: normalizeNumber(modePayload.document_count),
        chunkCount: normalizeNumber(modePayload.chunk_count),
        entityCount: normalizeNumber(modePayload.entity_count),
        relationCount: normalizeNumber(modePayload.relation_count),
        qualityScore: normalizeNullableNumber(modePayload.quality_score),
      } satisfies ProjectKnowledgeModeState;
    })
    .filter((item): item is ProjectKnowledgeModeState => Boolean(item));

  return parsed.length > 0 ? parsed : null;
}

function parseBackendOutputResolution(
  syncState: ProjectKnowledgeSyncState | null,
  processingModes: ProjectKnowledgeModeState[],
): ProjectKnowledgeOutputResolution | null {
  const payload = syncState?.active_output_resolution as ProjectKnowledgeOutputResolutionPayload | undefined;
  if (!payload || !isProcessingMode(payload.active_mode)) {
    return null;
  }

  const availableModes = Array.isArray(payload.available_modes)
    ? payload.available_modes.filter(isProcessingMode)
    : [];
  const fallbackChain: ProjectKnowledgeProcessingMode[] = Array.isArray(payload.fallback_chain)
    ? payload.fallback_chain.filter(isProcessingMode)
    : ["agentic", "nlp", "fast"];
  const activeMode = processingModes.some((item) => item.mode === payload.active_mode)
    ? payload.active_mode
    : processingModes[0]?.mode || "fast";
  const skippedModes = Array.isArray(payload.skipped_modes)
    ? payload.skipped_modes
      .filter((item) => isProcessingMode(item?.mode))
      .map((item) => ({
        mode: item.mode,
        status: normalizeModeStatus(item.status),
        reasonCode: String(item.reason_code || "").trim() || "UNKNOWN",
        reason: String(item.reason || "").trim(),
      }))
    : [];

  return {
    activeMode,
    availableModes,
    fallbackChain,
    reasonCode: String(payload.reason_code || "").trim() || "UNKNOWN",
    reason: String(payload.reason || "").trim(),
    skippedModes,
  };
}

function parseBackendProcessingScheduler(
  syncState: ProjectKnowledgeSyncState | null,
  processingModes: ProjectKnowledgeModeState[],
  activeOutputResolution: ProjectKnowledgeOutputResolution,
): ProjectKnowledgeProcessingScheduler | null {
  const payload = syncState?.processing_scheduler as ProjectKnowledgeProcessingSchedulerPayload | undefined;
  if (!payload || payload.strategy !== "parallel") {
    return null;
  }

  const modeOrder: ProjectKnowledgeProcessingMode[] = Array.isArray(payload.mode_order)
    ? payload.mode_order.filter(isProcessingMode)
    : ["agentic", "nlp", "fast"];
  const runningModes = Array.isArray(payload.running_modes)
    ? payload.running_modes.filter(isProcessingMode)
    : [];
  const queuedModes = Array.isArray(payload.queued_modes)
    ? payload.queued_modes.filter(isProcessingMode)
    : [];
  const readyModes = Array.isArray(payload.ready_modes)
    ? payload.ready_modes.filter(isProcessingMode)
    : [];
  const failedModes = Array.isArray(payload.failed_modes)
    ? payload.failed_modes.filter(isProcessingMode)
    : [];
  const nextMode = isProcessingMode(payload.next_mode) ? payload.next_mode : null;
  const consumptionMode = processingModes.some((item) => item.mode === payload.consumption_mode)
    ? payload.consumption_mode
    : activeOutputResolution.activeMode;

  return {
    strategy: "parallel",
    modeOrder,
    runningModes,
    queuedModes,
    readyModes,
    failedModes,
    nextMode,
    consumptionMode,
    reason: String(payload.reason || "").trim(),
  };
}

function deriveProcessingScheduler(
  processingModes: ProjectKnowledgeModeState[],
  activeOutputResolution: ProjectKnowledgeOutputResolution,
): ProjectKnowledgeProcessingScheduler {
  const modeOrder: ProjectKnowledgeProcessingMode[] = ["agentic", "nlp", "fast"];
  const runningModes = modeOrder.filter(
    (mode) => processingModes.find((item) => item.mode === mode)?.status === "running",
  );
  const queuedModes = modeOrder.filter(
    (mode) => processingModes.find((item) => item.mode === mode)?.status === "queued",
  );
  const readyModes = modeOrder.filter(
    (mode) => processingModes.find((item) => item.mode === mode)?.status === "ready",
  );
  const failedModes = modeOrder.filter(
    (mode) => processingModes.find((item) => item.mode === mode)?.status === "failed",
  );
  const nextMode = modeOrder.find((mode) => {
    const status = processingModes.find((item) => item.mode === mode)?.status;
    return status === "queued" || status === "idle";
  }) || null;

  let reason = `当前按 ${activeOutputResolution.activeMode} 输出消费。`;
  if (runningModes.length > 0) {
    reason = `当前正在推进 ${runningModes.join(" / ")}，消费侧继续读取 ${activeOutputResolution.activeMode}。`;
  } else if (queuedModes.length > 0) {
    reason = `当前无活跃执行，下一条待推进轨道为 ${queuedModes[0]}。`;
  } else if (readyModes.length > 0) {
    reason = `当前无待执行轨道，直接消费最佳可用输出 ${activeOutputResolution.activeMode}。`;
  }

  return {
    strategy: "parallel",
    modeOrder,
    runningModes,
    queuedModes,
    readyModes,
    failedModes,
    nextMode,
    consumptionMode: activeOutputResolution.activeMode,
    reason,
  };
}

function parseBackendModeOutputs(
  syncState: ProjectKnowledgeSyncState | null,
): Record<ProjectKnowledgeProcessingMode, ProjectKnowledgeModeOutput> | null {
  const payload = syncState?.mode_outputs;
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const modes: ProjectKnowledgeProcessingMode[] = ["fast", "nlp", "agentic"];
  const parsed = {} as Record<ProjectKnowledgeProcessingMode, ProjectKnowledgeModeOutput>;
  for (const mode of modes) {
    const item = payload[mode] as ProjectKnowledgeModeOutputPayload | undefined;
    parsed[mode] = {
      mode,
      source: String(item?.source || "").trim(),
      summaryLines: Array.isArray(item?.summary_lines)
        ? item.summary_lines.map((entry) => String(entry || "").trim()).filter(Boolean)
        : [],
      artifacts: Array.isArray(item?.artifacts)
        ? item.artifacts
          .map((artifact) => ({
            kind: String(artifact.kind || "").trim(),
            label: String(artifact.label || "").trim(),
            path: String(artifact.path || "").trim(),
          }))
          .filter((artifact) => artifact.path)
        : [],
    };
  }
  return parsed;
}

function deriveModeOutputs(
  processingModes: ProjectKnowledgeModeState[],
): Record<ProjectKnowledgeProcessingMode, ProjectKnowledgeModeOutput> {
  return {
    fast: {
      mode: "fast",
      source: "indexed-preview",
      summaryLines: [
        `Documents: ${processingModes.find((item) => item.mode === "fast")?.documentCount || 0}`,
        `Chunks: ${processingModes.find((item) => item.mode === "fast")?.chunkCount || 0}`,
      ],
      artifacts: [],
    },
    nlp: {
      mode: "nlp",
      source: "graph-artifacts",
      summaryLines: [
        `Entities: ${processingModes.find((item) => item.mode === "nlp")?.entityCount || 0}`,
        `Relations: ${processingModes.find((item) => item.mode === "nlp")?.relationCount || 0}`,
      ],
      artifacts: [],
    },
    agentic: {
      mode: "agentic",
      source: "workflow-artifacts",
      summaryLines: [
        `Run: ${processingModes.find((item) => item.mode === "agentic")?.runId || ""}`,
        `Status: ${processingModes.find((item) => item.mode === "agentic")?.status || "idle"}`,
      ],
      artifacts: [],
    },
  };
}

function normalizeProjectId(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function isSameHeaderSignals(
  left: ProjectKnowledgeHeaderSignals,
  right: ProjectKnowledgeHeaderSignals,
): boolean {
  return (
    left.indexedRatio === right.indexedRatio
    && left.documentCount === right.documentCount
    && left.chunkCount === right.chunkCount
    && left.sentenceCount === right.sentenceCount
    && left.sentenceWithEntitiesCount === right.sentenceWithEntitiesCount
    && left.entityMentionsCount === right.entityMentionsCount
    && left.avgEntitiesPerSentence === right.avgEntitiesPerSentence
    && left.avgEntityCharRatio === right.avgEntityCharRatio
    && left.relationCount === right.relationCount
    && left.entityCount === right.entityCount
    && left.relationNormalizationCoverage === right.relationNormalizationCoverage
    && left.entityCanonicalCoverage === right.entityCanonicalCoverage
    && left.lowConfidenceRatio === right.lowConfidenceRatio
    && left.missingEvidenceRatio === right.missingEvidenceRatio
    && left.relationNormalizationThreshold === right.relationNormalizationThreshold
    && left.entityCanonicalThreshold === right.entityCanonicalThreshold
    && left.lowConfidenceThreshold === right.lowConfidenceThreshold
    && left.missingEvidenceThreshold === right.missingEvidenceThreshold
    && left.qualityAssessmentScore === right.qualityAssessmentScore
  );
}

export function useProjectKnowledgeState(
  params: UseProjectKnowledgeStateParams,
): ProjectKnowledgeState {
  const { t } = useTranslation();
  const { onSignalsChange } = params;
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [projectSources, setProjectSources] = useState<KnowledgeSourceItem[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [sourceContentById, setSourceContentById] = useState<Record<string, KnowledgeSourceContent>>({});
  const [sourceContentLoadingById, setSourceContentLoadingById] =
    useState<Record<string, boolean>>({});
  const [graphQueryText, setGraphQueryText] = useState("");
  const [graphQueryMode, setGraphQueryMode] = useState<ProjectGraphQueryMode>("template");
  const [graphQueryTopK, setGraphQueryTopK] = useState(PROJECT_GRAPH_QUERY_TOP_K);
  const [graphNeedsRefresh, setGraphNeedsRefresh] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState("");
  const [graphResult, setGraphResult] = useState<GraphQueryResponse | null>(null);
  const [memifyEnabled, setMemifyEnabled] = useState(false);
  const [processingLaunchMode, setProcessingLaunchMode] = useState<ProjectKnowledgeProcessingMode | null>(null);
  const [relationKeywordSeed, setRelationKeywordSeed] = useState("");
  const [activeGraphNodeId, setActiveGraphNodeId] = useState<string | null>(null);
  const [trendRangeDays, setTrendRangeDays] = useState<7 | 30>(7);
  const [trendSnapshots, setTrendSnapshots] = useState<ProjectKnowledgeTrendSnapshot[]>([]);
  const [trendExpanded, setTrendExpanded] = useState(true);
  const [syncState, setSyncState] = useState<ProjectKnowledgeSyncState | null>(null);
  const [activeKnowledgeTasks, setActiveKnowledgeTasks] = useState<KnowledgeTaskProgress[]>([]);
  const [activeKnowledgeTask, setActiveKnowledgeTask] = useState<KnowledgeTaskProgress | null>(null);
  const [latestQualityLoopJob, setLatestQualityLoopJob] = useState<QualityLoopJobStatus | null>(null);
  const [semanticBySourceId, setSemanticBySourceId] = useState<Record<string, { subject?: string; summary?: string; keywords?: string[] }>>({});
  const [semanticLoadingBySourceId, setSemanticLoadingBySourceId] = useState<Record<string, boolean>>({});
  const refreshReasonRef = useRef("");
  const graphRefreshReasonRef = useRef("");
  const defaultExploreTokenRef = useRef("");
  const lastSignalsRef = useRef<ProjectKnowledgeHeaderSignals | null>(null);

  const projectSourceId = useMemo(() => {
    const safeId = params.projectId
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return `project-${safeId || "default"}-workspace`;
  }, [params.projectId]);

  const loadProjectSourceStatus = useCallback(async () => {
    if (!params.projectId) {
      setProjectSources([]);
      setSourceLoaded(false);
      return;
    }
    try {
      const response = await api.listKnowledgeSources({ projectId: params.projectId });
      const currentProjectId = normalizeProjectId(params.projectId);
      const scopedSources = (response.sources || []).filter((source) => (
        normalizeProjectId(source.project_id) === currentProjectId
      ));
      setProjectSources(scopedSources);
    } catch {
      setProjectSources([]);
    } finally {
      setSourceLoaded(true);
    }
  }, [params.projectId]);

  const loadSourceContent = useCallback(async (
    sourceId: string,
    options?: { force?: boolean },
  ) => {
    const normalizedSourceId = sourceId.trim();
    if (!normalizedSourceId || !params.projectId) {
      return null;
    }
    if (!options?.force && sourceContentById[normalizedSourceId]) {
      return sourceContentById[normalizedSourceId];
    }

    setSourceContentLoadingById((prev) => ({
      ...prev,
      [normalizedSourceId]: true,
    }));
    try {
      const response = await api.getKnowledgeSourceContent(normalizedSourceId, {
        projectId: params.projectId,
      });
      setSourceContentById((prev) => ({
        ...prev,
        [normalizedSourceId]: response,
      }));
      return response;
    } catch {
      return null;
    } finally {
      setSourceContentLoadingById((prev) => ({
        ...prev,
        [normalizedSourceId]: false,
      }));
    }
  }, [params.projectId, sourceContentById]);

  const loadSourceSemantic = useCallback(async (sourceId: string) => {
    const normalizedSourceId = sourceId.trim();
    if (!normalizedSourceId || !params.projectId) {
      return;
    }
    if (semanticBySourceId[normalizedSourceId] || semanticLoadingBySourceId[normalizedSourceId]) {
      return;
    }
    setSemanticLoadingBySourceId((prev) => ({ ...prev, [normalizedSourceId]: true }));
    try {
      const response = await api.listKnowledgeSources({
        projectId: params.projectId,
        includeSemantic: true,
      });
      const match = (response.sources || []).find((source) => source.id === normalizedSourceId);
      if (match) {
        setSemanticBySourceId((prev) => ({
          ...prev,
          [normalizedSourceId]: {
            subject: match.subject,
            summary: match.summary,
            keywords: match.keywords,
          },
        }));
      }
    } catch {
      // best-effort semantic fetch
    } finally {
      setSemanticLoadingBySourceId((prev) => ({ ...prev, [normalizedSourceId]: false }));
    }
  }, [params.projectId, semanticBySourceId, semanticLoadingBySourceId]);

  useEffect(() => {
    let cancelled = false;
    void api.getKnowledgeConfig()
      .then((config) => {
        if (!cancelled) {
          setMemifyEnabled(Boolean(config.memify_enabled));
        }
      })
      .catch(() => {
        // best-effort config load
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedSourceId) {
      void loadSourceSemantic(selectedSourceId);
    }
  }, [loadSourceSemantic, selectedSourceId]);

  const defaultOutputModeForQuery = useMemo<ProjectKnowledgeProcessingMode>(() => {
    const payload = syncState?.active_output_resolution as ProjectKnowledgeOutputResolutionPayload | undefined;
    if (payload && isProcessingMode(payload.active_mode)) {
      return payload.active_mode;
    }
    return "fast";
  }, [syncState]);

  const markGraphNeedsRefresh = useCallback(() => {
    setGraphNeedsRefresh(true);
  }, []);

  const runGraphQuery = useCallback(async (
    overrideQuery?: string,
    overrideMode?: ProjectGraphQueryMode,
    overrideTopK?: number,
    overrideOutputMode?: ProjectKnowledgeProcessingMode,
  ) => {
    const query = (overrideQuery ?? graphQueryText).trim();
    const mode = overrideMode ?? graphQueryMode;
    const outputMode = overrideOutputMode ?? defaultOutputModeForQuery;
    if (!query || !params.projectId) {
      setGraphError(t("projects.knowledge.emptyQuery"));
      return;
    }

    setGraphLoading(true);
    setGraphError("");
    try {
      const response = await api.graphQuery({
        query,
        mode,
        topK: Math.max(
          20,
          Number(overrideTopK ?? graphQueryTopK) || PROJECT_GRAPH_QUERY_TOP_K,
        ),
        outputMode,
        timeoutSec: 20,
        projectScope: [params.projectId],
        includeGlobal: params.includeGlobal,
        projectId: params.projectId,
      });
      setGraphQueryText(query);
      setGraphQueryMode(mode);
      setGraphResult(response);
      setActiveGraphNodeId(null);
      setGraphNeedsRefresh(false);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : t("projects.knowledge.queryFailed");
      setGraphError(messageText);
    } finally {
      setGraphLoading(false);
    }
  }, [defaultOutputModeForQuery, graphQueryMode, graphQueryText, graphQueryTopK, params.includeGlobal, params.projectId, t]);

  const startProcessingMode = useCallback(async (
    mode: ProjectKnowledgeProcessingMode,
    options?: { force?: boolean; trigger?: string },
  ) => {
    if (!params.projectId) {
      return;
    }
    setProcessingLaunchMode(mode);
    try {
      const response = await api.runProjectKnowledgeSync({
        projectId: params.projectId,
        trigger: options?.trigger ?? `processing-panel:${mode}`,
        force: options?.force ?? true,
        processingMode: mode,
      });
      setSyncState(response.state);
    } finally {
      setProcessingLaunchMode(null);
    }
  }, [params.projectId]);

  const resetGraphQuery = useCallback(() => {
    setGraphError("");
    setGraphResult(null);
    setActiveGraphNodeId(null);
    setGraphNeedsRefresh(false);
  }, []);

  useEffect(() => {
    setSelectedSourceId("");
    setSourceContentById({});
    setSourceContentLoadingById({});
    setGraphQueryText("");
    setGraphQueryMode("template");
    setGraphQueryTopK(PROJECT_GRAPH_QUERY_TOP_K);
    setGraphNeedsRefresh(false);
    setGraphLoading(false);
    setGraphError("");
    setGraphResult(null);
    setProcessingLaunchMode(null);
    setRelationKeywordSeed("");
    setActiveGraphNodeId(null);
    setActiveKnowledgeTasks([]);
    setActiveKnowledgeTask(null);
    setLatestQualityLoopJob(null);
    setSemanticBySourceId({});
    setSemanticLoadingBySourceId({});
    defaultExploreTokenRef.current = "";
    graphRefreshReasonRef.current = "";
  }, [params.projectId]);

  useEffect(() => {
    if (!params.projectId) {
      setLatestQualityLoopJob(null);
      return;
    }
    let cancelled = false;
    const loadLatestQualityLoop = async () => {
      try {
        const response = await api.listQualityLoopJobs({
          projectId: params.projectId,
          activeOnly: false,
          limit: 5,
        });
        if (cancelled) {
          return;
        }
        const items = Array.isArray(response.items) ? response.items : [];
        const latest = items.find((item) =>
          ["running", "pending", "succeeded", "failed"].includes(String(item.status || ""))
        ) || null;
        setLatestQualityLoopJob(latest);
      } catch {
        if (!cancelled) {
          setLatestQualityLoopJob(null);
        }
      }
    };
    void loadLatestQualityLoop();
    return () => {
      cancelled = true;
    };
  }, [params.projectId, syncState?.last_finished_at, activeKnowledgeTask?.updated_at]);

  useEffect(() => {
    if (!params.projectId) {
      setProjectSources([]);
      setSourceLoaded(false);
      return;
    }
    if (!params.eagerSourceLoad) {
      setProjectSources([]);
      setSourceLoaded(false);
      return;
    }
    void loadProjectSourceStatus();
  }, [loadProjectSourceStatus, params.eagerSourceLoad, params.projectId]);

  useEffect(() => {
    if (selectedSourceId && projectSources.some((source) => source.id === selectedSourceId)) {
      return;
    }
    setSelectedSourceId(projectSources[0]?.id || "");
  }, [projectSources, selectedSourceId]);

  useEffect(() => {
    if (!params.projectId) {
      setSyncState(null);
      return;
    }
    let cancelled = false;
    void api.getProjectKnowledgeSyncStatus({ projectId: params.projectId })
      .then((state) => {
        if (!cancelled) {
          setSyncState(state);
        }
      })
      .catch(() => {
        // best-effort status preload
      });
    return () => {
      cancelled = true;
    };
  }, [params.projectId]);

  useEffect(() => {
    if (!params.projectId) {
      setActiveKnowledgeTasks([]);
      setActiveKnowledgeTask(null);
      return;
    }
    let cancelled = false;
    void api.getKnowledgeTasksSnapshot({ projectId: params.projectId })
      .then((snapshot) => {
        if (!cancelled) {
          const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks : [];
          const activeTasks = getActiveKnowledgeTasks(tasks);
          setActiveKnowledgeTasks(activeTasks);
          setActiveKnowledgeTask(pickActiveKnowledgeTask(tasks));
        }
      })
      .catch(() => {
        // best-effort task preload
      });
    return () => {
      cancelled = true;
    };
  }, [params.projectId]);

  useEffect(() => {
    if (!params.projectId || typeof WebSocket === "undefined") {
      return;
    }
    let disposed = false;
    let reconnectTimer: number | null = null;
    let activeSocket: WebSocket | null = null;

    const connect = () => {
      if (disposed) {
        return;
      }
      try {
        const baseUrl = getApiUrl("/knowledge/project-sync/ws");
        const wsUrl = new URL(baseUrl, window.location.origin);
        wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
        wsUrl.searchParams.set("project_id", params.projectId);
        wsUrl.searchParams.set("interval_ms", "1000");
        const token = getApiToken();
        if (token) {
          wsUrl.searchParams.set("token", token);
        }

        const ws = new WebSocket(wsUrl.toString());
        activeSocket = ws;
        ws.onmessage = (event) => {
          if (disposed) {
            return;
          }
          try {
            const payload = JSON.parse(event.data || "{}");
            const nextState = payload?.state;
            if (!nextState || typeof nextState !== "object") {
              return;
            }
            setSyncState(nextState as ProjectKnowledgeSyncState);
          } catch {
            // ignore malformed websocket messages
          }
        };
        ws.onclose = () => {
          if (disposed) {
            return;
          }
          reconnectTimer = window.setTimeout(() => {
            connect();
          }, 1500);
        };
      } catch {
        // ignore websocket construction failure in unsupported env
      }
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      if (activeSocket) {
        if (activeSocket.readyState === WebSocket.CONNECTING) {
          activeSocket.onopen = () => {
            activeSocket?.close();
          };
        } else if (activeSocket.readyState === WebSocket.OPEN) {
          activeSocket.close();
        }
      }
    };
  }, [params.projectId]);

  useEffect(() => {
    if (!params.projectId || typeof WebSocket === "undefined") {
      return;
    }
    let disposed = false;
    let reconnectTimer: number | null = null;
    let activeSocket: WebSocket | null = null;

    const connect = () => {
      if (disposed) {
        return;
      }
      try {
        const baseUrl = getApiUrl("/knowledge/tasks/ws");
        const wsUrl = new URL(baseUrl, window.location.origin);
        wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
        wsUrl.searchParams.set("project_id", params.projectId);
        wsUrl.searchParams.set("interval_ms", "1000");
        const token = getApiToken();
        if (token) {
          wsUrl.searchParams.set("token", token);
        }

        const ws = new WebSocket(wsUrl.toString());
        activeSocket = ws;
        ws.onmessage = (event) => {
          if (disposed) {
            return;
          }
          try {
            const payload = JSON.parse(event.data || "{}");
            const snapshot = payload?.snapshot;
            const tasks = Array.isArray(snapshot?.tasks)
              ? (snapshot.tasks as KnowledgeTaskProgress[])
              : [];
            const activeTasks = getActiveKnowledgeTasks(tasks);
            setActiveKnowledgeTasks(activeTasks);
            setActiveKnowledgeTask(pickActiveKnowledgeTask(tasks));
          } catch {
            // ignore malformed websocket messages
          }
        };
        ws.onclose = () => {
          if (disposed) {
            return;
          }
          reconnectTimer = window.setTimeout(() => {
            connect();
          }, 1500);
        };
      } catch {
        // ignore websocket construction failure in unsupported env
      }
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      if (activeSocket) {
        if (activeSocket.readyState === WebSocket.CONNECTING) {
          activeSocket.onopen = () => {
            activeSocket?.close();
          };
        } else if (activeSocket.readyState === WebSocket.OPEN) {
          activeSocket.close();
        }
      }
    };
  }, [params.projectId]);

  useEffect(() => {
    if (!syncState) {
      return;
    }
    if (!params.eagerSourceLoad) {
      return;
    }
    const refreshReason = `${syncState.status}:${syncState.last_finished_at || ""}:${syncState.latest_job_id || ""}`;
    if (refreshReasonRef.current === refreshReason) {
      return;
    }
    refreshReasonRef.current = refreshReason;
    if (["pending", "queued", "indexing", "graphifying", "succeeded", "failed"].includes(syncState.status)) {
      void loadProjectSourceStatus();
    }
  }, [loadProjectSourceStatus, params.eagerSourceLoad, syncState]);

  const suggestedQuery = useMemo(() => {
    const projectLabel = params.projectName || params.projectId;
    return `List as many entities and relationships as possible from project ${projectLabel}, then summarize key clusters and links`;
  }, [params.projectId, params.projectName]);

  useEffect(() => {
    if (!params.projectId || !params.eagerExploreLoad) {
      return;
    }
    const defaultToken = `${params.projectId}:${String(params.includeGlobal)}:${suggestedQuery}`;
    if (defaultExploreTokenRef.current === defaultToken || graphLoading || graphResult) {
      return;
    }
    defaultExploreTokenRef.current = defaultToken;
    setGraphQueryText((prev) => prev.trim() || suggestedQuery);
    void runGraphQuery(suggestedQuery, "template");
  }, [graphLoading, graphResult, params.eagerExploreLoad, params.includeGlobal, params.projectId, runGraphQuery, suggestedQuery]);

  useEffect(() => {
    const finishToken = syncState?.last_finished_at || "";
    if (!finishToken || graphRefreshReasonRef.current === finishToken || !graphQueryText.trim()) {
      return;
    }
    graphRefreshReasonRef.current = finishToken;
    setGraphNeedsRefresh(true);
  }, [graphQueryText, syncState?.last_finished_at]);

  useEffect(() => {
    setTrendSnapshots(loadTrendSnapshots(params.projectId));
  }, [params.projectId]);

  useEffect(() => {
    const prefs = loadUiPrefs(params.projectId);
    setTrendExpanded(prefs.trendExpanded);
  }, [params.projectId]);

  useEffect(() => {
    saveUiPrefs(params.projectId, { trendExpanded });
  }, [params.projectId, trendExpanded]);

  const sourceRegistered = useMemo(
    () => (
      projectSources.some((source) => source.id === projectSourceId)
      || syncState?.latest_source_id === projectSourceId
    ),
    [projectSourceId, projectSources, syncState?.latest_source_id],
  );

  const quantMetrics = useMemo(() => {
    const latestRound = Array.isArray(latestQualityLoopJob?.rounds)
      ? latestQualityLoopJob.rounds[latestQualityLoopJob.rounds.length - 1] as Record<string, unknown> | undefined
      : undefined;
    const latestRoundAfter = latestRound && typeof latestRound.after === "object"
      ? latestRound.after as Record<string, unknown>
      : null;
    const totalSources = projectSources.length;
    const indexedSources = projectSources.filter((item) => item.status.indexed).length;
    const sourceDocumentCount = projectSources.reduce(
      (sum, item) => sum + Math.max(0, item.status.document_count || 0),
      0,
    );
    const sourceChunkCount = projectSources.reduce(
      (sum, item) => sum + Math.max(0, item.status.chunk_count || 0),
      0,
    );
    const sourceSentenceCount = projectSources.reduce(
      (sum, item) => sum + Math.max(0, item.status.sentence_count || 0),
      0,
    );
    const fallbackDocumentCount = getSyncIndexCount(syncState, "document_count");
    const fallbackChunkCount = getSyncIndexCount(syncState, "chunk_count");
    const fallbackSentenceCount = getSyncIndexCount(syncState, "sentence_count");
    const effectiveTotalSources = totalSources > 0 ? totalSources : (sourceRegistered ? 1 : 0);
    const effectiveIndexedSources = totalSources > 0
      ? indexedSources
      : (fallbackDocumentCount > 0 || fallbackChunkCount > 0 ? 1 : 0);
    const indexedRatio = effectiveTotalSources > 0
      ? effectiveIndexedSources / effectiveTotalSources
      : 0;
    const documentCount = totalSources > 0 ? sourceDocumentCount : fallbackDocumentCount;
    const chunkCount = totalSources > 0 ? sourceChunkCount : fallbackChunkCount;
    const sentenceCount = totalSources > 0 ? sourceSentenceCount : fallbackSentenceCount;
    const sentenceWithEntitiesCount = getSyncMemifyMetric(syncState, "sentence_with_entities_count");
    const entityMentionsCount = getSyncMemifyMetric(syncState, "entity_mentions_count");
    const avgEntitiesPerSentence = getSyncMemifyMetric(syncState, "avg_entities_per_sentence");
    const avgEntityCharRatio = getSyncMemifyMetric(syncState, "avg_entity_char_ratio");
    const relationCount = Math.max(
      graphResult?.records?.length || 0,
      getSyncRelationCount(syncState),
      toFiniteNumber(latestRoundAfter?.relation_count, 0),
    );
    const graphEntityCount = new Set(
      (graphResult?.records || []).flatMap((record) => [record.subject, record.object])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ).size;
    const entityCount = Math.max(graphEntityCount, getSyncNodeCount(syncState));
    const effectiveEntityCount = Math.max(entityCount, toFiniteNumber(latestRoundAfter?.entity_count, 0));
    const activeEnrichmentMetrics = (activeKnowledgeTask?.enrichment_metrics || {}) as Record<string, unknown>;

    const edgeCount = Math.max(
      getSyncEnrichmentMetric(syncState, "edge_count"),
      toFiniteNumber(activeEnrichmentMetrics.edge_count, 0),
      relationCount,
    );
    const nodeCount = Math.max(
      getSyncEnrichmentMetric(syncState, "node_count"),
      toFiniteNumber(activeEnrichmentMetrics.node_count, 0),
      effectiveEntityCount,
    );

    const relationNormalizedCount = Math.max(
      getSyncEnrichmentMetric(syncState, "relation_normalized_count"),
      toFiniteNumber(activeEnrichmentMetrics.relation_normalized_count, 0),
    );
    const entityCanonicalizedCount = Math.max(
      getSyncEnrichmentMetric(syncState, "entity_canonicalized_count"),
      toFiniteNumber(activeEnrichmentMetrics.entity_canonicalized_count, 0),
    );
    const lowConfidenceEdges = Math.max(
      getSyncEnrichmentMetric(syncState, "low_confidence_edges"),
      toFiniteNumber(activeEnrichmentMetrics.low_confidence_edges, 0),
    );
    const missingEvidenceEdges = Math.max(
      getSyncEnrichmentMetric(syncState, "missing_evidence_edges"),
      toFiniteNumber(activeEnrichmentMetrics.missing_evidence_edges, 0),
    );

    const relationNormalizationCoverage = safeRatio(relationNormalizedCount, edgeCount);
    const entityCanonicalCoverage = safeRatio(entityCanonicalizedCount, nodeCount);
    const lowConfidenceRatio = safeRatio(lowConfidenceEdges, edgeCount);
    const missingEvidenceRatio = safeRatio(missingEvidenceEdges, edgeCount);

    const reflectedRelationNormalizationCoverage = toFiniteNumber(
      latestRoundAfter?.relation_normalization_coverage,
      relationNormalizationCoverage,
    );
    const reflectedEntityCanonicalCoverage = toFiniteNumber(
      latestRoundAfter?.entity_canonical_coverage,
      entityCanonicalCoverage,
    );
    const reflectedLowConfidenceRatio = toFiniteNumber(
      latestRoundAfter?.low_confidence_ratio,
      lowConfidenceRatio,
    );
    const reflectedMissingEvidenceRatio = toFiniteNumber(
      latestRoundAfter?.missing_evidence_ratio,
      missingEvidenceRatio,
    );

    const relationScale = Math.log10(Math.max(10, relationCount));
    const entityScale = Math.log10(Math.max(10, effectiveEntityCount));
    const relationNormalizationThreshold = clamp(0.48 + relationScale * 0.08, 0.5, 0.82);
    const entityCanonicalThreshold = clamp(0.45 + entityScale * 0.08, 0.48, 0.8);
    const lowConfidenceThreshold = clamp(0.28 - relationScale * 0.03, 0.12, 0.28);
    const missingEvidenceThreshold = clamp(0.3 - relationScale * 0.03, 0.15, 0.3);

    const normalizedQualityScores = [
      safeRatio(reflectedRelationNormalizationCoverage, relationNormalizationThreshold),
      safeRatio(reflectedEntityCanonicalCoverage, entityCanonicalThreshold),
      lowConfidenceThreshold > 0
        ? clamp(1 - (reflectedLowConfidenceRatio / lowConfidenceThreshold), 0, 1)
        : 0,
      missingEvidenceThreshold > 0
        ? clamp(1 - (reflectedMissingEvidenceRatio / missingEvidenceThreshold), 0, 1)
        : 0,
    ];
    const qualityAssessmentScore = normalizedQualityScores.reduce((sum, item) => sum + item, 0)
      / normalizedQualityScores.length;

    return {
      totalSources: effectiveTotalSources,
      indexedSources: effectiveIndexedSources,
      indexedRatio,
      documentCount,
      chunkCount,
      sentenceCount,
      sentenceWithEntitiesCount,
      entityMentionsCount,
      avgEntitiesPerSentence,
      avgEntityCharRatio,
      relationCount,
      entityCount: effectiveEntityCount,
      relationNormalizationCoverage: reflectedRelationNormalizationCoverage,
      entityCanonicalCoverage: reflectedEntityCanonicalCoverage,
      lowConfidenceRatio: reflectedLowConfidenceRatio,
      missingEvidenceRatio: reflectedMissingEvidenceRatio,
      relationNormalizationThreshold,
      entityCanonicalThreshold,
      lowConfidenceThreshold,
      missingEvidenceThreshold,
      qualityAssessmentScore,
    };
  }, [
    activeKnowledgeTask?.enrichment_metrics,
    graphResult?.records,
    latestQualityLoopJob?.rounds,
    projectSources,
    sourceRegistered,
    syncState,
  ]);

  const syncAlertType = useMemo(
    () => getProjectKnowledgeSyncAlertType(syncState),
    [syncState],
  );

  const processingModes = useMemo<ProjectKnowledgeModeState[]>(() => {
    const backendModes = parseBackendProcessingModes(syncState);
    if (backendModes) {
      return backendModes;
    }

    const workflowRunMeta = getWorkflowRunMeta(syncState);
    const workflowRunId = String(
      workflowRunMeta.run_id || (syncState as Record<string, unknown> | null)?.latest_workflow_run_id || "",
    ).trim();
    const workflowStatus = String(workflowRunMeta.status || "").trim().toLowerCase();
    const activeTaskType = String(activeKnowledgeTask?.task_type || "").trim().toLowerCase();
    const syncPercent = typeof syncState?.percent === "number"
      ? Math.max(0, Math.min(100, Math.round(syncState.percent)))
      : typeof syncState?.progress === "number"
        ? Math.max(0, Math.min(100, Math.round(syncState.progress * 100)))
        : null;
    const fastDocumentCount = Math.max(
      getBackendModeMetricNumber(syncState, "fast", "document_count"),
      getBackendGlobalMetricNumber(syncState, "document_count"),
      quantMetrics.documentCount,
    );
    const fastChunkCount = Math.max(
      getBackendModeMetricNumber(syncState, "fast", "chunk_count"),
      getBackendGlobalMetricNumber(syncState, "chunk_count"),
      quantMetrics.chunkCount,
    );
    const nlpEntityCount = Math.max(
      getBackendModeMetricNumber(syncState, "nlp", "entity_count"),
      getSyncNodeCount(syncState),
      getSyncEnrichmentMetric(syncState, "node_count"),
    );
    const nlpRelationCount = Math.max(
      getBackendModeMetricNumber(syncState, "nlp", "relation_count"),
      getSyncRelationCount(syncState),
      getSyncEnrichmentMetric(syncState, "edge_count"),
    );
    const agenticEntityCount = Math.max(
      getBackendModeMetricNumber(syncState, "agentic", "entity_count"),
      normalizeNumber(workflowRunMeta.entity_count),
      normalizeNumber(workflowRunMeta.final_entity_count),
    );
    const agenticRelationCount = Math.max(
      getBackendModeMetricNumber(syncState, "agentic", "relation_count"),
      normalizeNumber(workflowRunMeta.relation_count),
      normalizeNumber(workflowRunMeta.final_relation_count),
    );
    const agenticQualityScore = getBackendModeMetricNullableNumber(syncState, "agentic", "quality_score")
      ?? normalizeNullableNumber(
        workflowRunMeta.quality_score
        ?? workflowRunMeta.final_quality_score,
      );

    const fastAvailable = fastDocumentCount > 0 || fastChunkCount > 0;
    const nlpAvailable = nlpEntityCount > 0 || nlpRelationCount > 0;
    const agenticAvailable = ["succeeded", "completed"].includes(workflowStatus);
    const latestUpdatedAt = String(
      latestQualityLoopJob?.updated_at
      || syncState?.last_finished_at
      || syncState?.updated_at
      || "",
    ).trim();

    const fastStatus: ProjectKnowledgeModeState["status"] = !fastAvailable && syncState?.status === "failed"
      ? "failed"
      : ["project_sync", "history_backfill"].includes(activeTaskType)
        ? "running"
        : fastAvailable
          ? "ready"
          : sourceRegistered
            ? "queued"
            : "idle";
    const nlpStatus: ProjectKnowledgeModeState["status"] = !nlpAvailable && String(syncState?.status || "") === "failed"
      ? "failed"
      : ["memify", "quality_loop"].includes(activeTaskType)
        ? "running"
        : nlpAvailable
          ? "ready"
          : fastAvailable
            ? "queued"
            : "idle";
    const agenticStatus: ProjectKnowledgeModeState["status"] = ["running", "pending", "queued"].includes(workflowStatus)
      ? (workflowStatus === "queued" ? "queued" : "running")
      : ["failed", "blocked", "cancelled"].includes(workflowStatus)
        ? "failed"
        : agenticAvailable
          ? "ready"
          : nlpAvailable
            ? "queued"
            : "idle";

    return [
      {
        mode: "fast",
        status: fastStatus,
        available: fastAvailable,
        progress: fastStatus === "running" ? syncPercent : null,
        stage: fastStatus === "running"
          ? String(syncState?.stage_message || syncState?.current_stage || "Building fast preview")
          : fastAvailable
            ? "Fast preview ready"
            : "Waiting for source indexing",
        summary: fastAvailable
          ? "秒级预览，优先保障可用性。"
          : "基础索引尚未就绪，无法提供极速预览。",
        lastUpdatedAt: String(syncState?.last_finished_at || syncState?.updated_at || "").trim(),
        runId: "",
        jobId: String(syncState?.latest_job_id || "").trim(),
        documentCount: fastDocumentCount,
        chunkCount: fastChunkCount,
        entityCount: 0,
        relationCount: 0,
        qualityScore: null,
      },
      {
        mode: "nlp",
        status: nlpStatus,
        available: nlpAvailable,
        progress: nlpStatus === "running" ? syncPercent : null,
        stage: nlpStatus === "running"
          ? String(activeKnowledgeTask?.stage_message || activeKnowledgeTask?.current_stage || "Building NLP artifacts")
          : nlpAvailable
            ? "NLP graph artifacts ready"
            : "Waiting for graph extraction",
        summary: nlpAvailable
          ? "中等复杂度知识产物，可作为多智能体结果的回退层。"
          : "图谱与结构化产物尚未形成。",
        lastUpdatedAt: latestUpdatedAt,
        runId: "",
        jobId: String(activeKnowledgeTask?.job_id || syncState?.latest_job_id || "").trim(),
        documentCount: fastDocumentCount,
        chunkCount: fastChunkCount,
        entityCount: nlpEntityCount,
        relationCount: nlpRelationCount,
        qualityScore: null,
      },
      {
        mode: "agentic",
        status: agenticStatus,
        available: agenticAvailable,
        progress: agenticStatus === "running" ? syncPercent : null,
        stage: agenticStatus === "running"
          ? String(syncState?.stage_message || syncState?.current_stage || "Running multi-agent workflow")
          : agenticAvailable
            ? "Multi-agent outputs ready"
            : workflowRunId
              ? "Workflow run exists but outputs are incomplete"
              : "Waiting for multi-agent workflow scheduling",
        summary: agenticAvailable
          ? "最高质量产物层，优先作为知识消费来源。"
          : "长耗时深加工轨道，产物缺失时将自动降级。",
        lastUpdatedAt: String(workflowRunMeta.updated_at || latestUpdatedAt || "").trim(),
        runId: workflowRunId,
        jobId: String(syncState?.latest_job_id || "").trim(),
        documentCount: fastDocumentCount,
        chunkCount: fastChunkCount,
        entityCount: agenticEntityCount,
        relationCount: agenticRelationCount,
        qualityScore: agenticQualityScore,
      },
    ];
  }, [
    activeKnowledgeTask?.current_stage,
    activeKnowledgeTask?.job_id,
    activeKnowledgeTask?.stage_message,
    activeKnowledgeTask?.task_type,
    latestQualityLoopJob?.updated_at,
    quantMetrics.chunkCount,
    quantMetrics.documentCount,
    sourceRegistered,
    syncState,
  ]);

  const activeOutputResolution = useMemo<ProjectKnowledgeOutputResolution>(() => {
    const backendResolution = parseBackendOutputResolution(syncState, processingModes);
    if (backendResolution) {
      return backendResolution;
    }

    const availableModes = processingModes
      .filter((mode) => mode.available)
      .map((mode) => mode.mode);
    const fallbackChain: ProjectKnowledgeProcessingMode[] = ["agentic", "nlp", "fast"];

    if (availableModes.includes("agentic")) {
      return {
        activeMode: "agentic",
        availableModes,
        fallbackChain,
        reasonCode: "HIGHEST_LAYER_READY",
        reason: "多智能体产物可用，当前使用最高质量输出。",
        skippedModes: [],
      };
    }
    if (availableModes.includes("nlp")) {
      return {
        activeMode: "nlp",
        availableModes,
        fallbackChain,
        reasonCode: "FALLBACK_TO_NLP",
        reason: "多智能体产物缺失，已自动降级到 NLP 产物。",
        skippedModes: [
          {
            mode: "agentic",
            status: processingModes.find((item) => item.mode === "agentic")?.status || "idle",
            reasonCode: "OUTPUT_NOT_READY",
            reason: "多智能体产物未就绪。",
          },
        ],
      };
    }
    return {
      activeMode: "fast",
      availableModes,
      fallbackChain,
      reasonCode: "FALLBACK_TO_FAST",
      reason: "高阶产物尚不可用，当前回退到极速预览。",
      skippedModes: [
        {
          mode: "agentic",
          status: processingModes.find((item) => item.mode === "agentic")?.status || "idle",
          reasonCode: "OUTPUT_NOT_READY",
          reason: "多智能体产物未就绪。",
        },
        {
          mode: "nlp",
          status: processingModes.find((item) => item.mode === "nlp")?.status || "idle",
          reasonCode: "OUTPUT_NOT_READY",
          reason: "NLP 产物未就绪。",
        },
      ],
    };
  }, [processingModes, syncState]);

  const processingScheduler = useMemo<ProjectKnowledgeProcessingScheduler>(() => {
    const backendScheduler = parseBackendProcessingScheduler(
      syncState,
      processingModes,
      activeOutputResolution,
    );
    if (backendScheduler) {
      return backendScheduler;
    }
    return deriveProcessingScheduler(processingModes, activeOutputResolution);
  }, [activeOutputResolution, processingModes, syncState]);

  const modeOutputs = useMemo<Record<ProjectKnowledgeProcessingMode, ProjectKnowledgeModeOutput>>(() => {
    const backendModeOutputs = parseBackendModeOutputs(syncState);
    if (backendModeOutputs) {
      return backendModeOutputs;
    }
    return deriveModeOutputs(processingModes);
  }, [processingModes, syncState]);

  const syncAlertDescription = useMemo(() => {
    const activeTaskText = activeKnowledgeTask
      ? [
          String(activeKnowledgeTask.stage_message || activeKnowledgeTask.current_stage || activeKnowledgeTask.task_type || "").trim(),
          typeof activeKnowledgeTask.percent === "number"
            ? `${Math.max(0, Math.min(100, activeKnowledgeTask.percent))}%`
            : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "";

    if (!syncState) {
      return activeTaskText;
    }
    const syncText = getProjectKnowledgeSyncAlertDescription(syncState, t);
    if (!activeTaskText || activeKnowledgeTask?.task_type === "project_sync") {
      return syncText;
    }
    return [syncText, activeTaskText].filter(Boolean).join(" · ");
  }, [activeKnowledgeTask, syncState, t]);

  useEffect(() => {
    if (!onSignalsChange) {
      return;
    }
    const nextSignals = {
      indexedRatio: quantMetrics.indexedRatio,
      documentCount: quantMetrics.documentCount,
      chunkCount: quantMetrics.chunkCount,
      sentenceCount: quantMetrics.sentenceCount,
      sentenceWithEntitiesCount: quantMetrics.sentenceWithEntitiesCount,
      entityMentionsCount: quantMetrics.entityMentionsCount,
      avgEntitiesPerSentence: quantMetrics.avgEntitiesPerSentence,
      avgEntityCharRatio: quantMetrics.avgEntityCharRatio,
      relationCount: quantMetrics.relationCount,
      entityCount: quantMetrics.entityCount,
      relationNormalizationCoverage: quantMetrics.relationNormalizationCoverage,
      entityCanonicalCoverage: quantMetrics.entityCanonicalCoverage,
      lowConfidenceRatio: quantMetrics.lowConfidenceRatio,
      missingEvidenceRatio: quantMetrics.missingEvidenceRatio,
      relationNormalizationThreshold: quantMetrics.relationNormalizationThreshold,
      entityCanonicalThreshold: quantMetrics.entityCanonicalThreshold,
      lowConfidenceThreshold: quantMetrics.lowConfidenceThreshold,
      missingEvidenceThreshold: quantMetrics.missingEvidenceThreshold,
      qualityAssessmentScore: quantMetrics.qualityAssessmentScore,
    };
    const previousSignals = lastSignalsRef.current;
    if (previousSignals && isSameHeaderSignals(previousSignals, nextSignals)) {
      return;
    }
    lastSignalsRef.current = nextSignals;
    onSignalsChange(nextSignals);
  }, [
    quantMetrics.entityCanonicalThreshold,
    onSignalsChange,
    quantMetrics.entityCount,
    quantMetrics.entityCanonicalCoverage,
    quantMetrics.chunkCount,
    quantMetrics.sentenceCount,
    quantMetrics.sentenceWithEntitiesCount,
    quantMetrics.entityMentionsCount,
    quantMetrics.avgEntitiesPerSentence,
    quantMetrics.avgEntityCharRatio,
    quantMetrics.documentCount,
    quantMetrics.indexedRatio,
    quantMetrics.lowConfidenceThreshold,
    quantMetrics.lowConfidenceRatio,
    quantMetrics.missingEvidenceThreshold,
    quantMetrics.missingEvidenceRatio,
    quantMetrics.qualityAssessmentScore,
    quantMetrics.relationNormalizationThreshold,
    quantMetrics.relationNormalizationCoverage,
    quantMetrics.relationCount,
  ]);

  useEffect(() => {
    setTrendSnapshots((prev) => {
      const now = Date.now();
      const token = dayToken(now);
      const existingToday = prev.find((item) => dayToken(item.ts) === token);
      const nextEntry: ProjectKnowledgeTrendSnapshot = {
        ts: existingToday?.ts || now,
        indexedRatio: quantMetrics.indexedRatio,
        documentCount: quantMetrics.documentCount,
        chunkCount: quantMetrics.chunkCount,
        relationCount: quantMetrics.relationCount,
      };

      if (existingToday && isSameSnapshotValue(existingToday, nextEntry)) {
        return prev;
      }

      const next = upsertTrendSnapshot(prev, nextEntry);
      saveTrendSnapshots(params.projectId, next);
      return next;
    });
  }, [
    params.projectId,
    quantMetrics.chunkCount,
    quantMetrics.documentCount,
    quantMetrics.indexedRatio,
    quantMetrics.relationCount,
  ]);

  const filteredTrendSnapshots = useMemo(() => {
    const since = Date.now() - trendRangeDays * DAY_MS;
    return trendSnapshots.filter((item) => item.ts >= since);
  }, [trendRangeDays, trendSnapshots]);

  const trendDocumentPath = useMemo(() => {
    return buildSparklinePath(
      filteredTrendSnapshots.map((item) => item.documentCount),
      300,
      70,
    );
  }, [filteredTrendSnapshots]);

  const trendChunkPath = useMemo(() => {
    return buildSparklinePath(
      filteredTrendSnapshots.map((item) => item.chunkCount),
      300,
      70,
    );
  }, [filteredTrendSnapshots]);

  const trendDelta = useMemo(() => {
    if (filteredTrendSnapshots.length < 2) {
      return {
        documentDelta: 0,
        chunkDelta: 0,
        relationDelta: 0,
      };
    }
    const first = filteredTrendSnapshots[0];
    const last = filteredTrendSnapshots[filteredTrendSnapshots.length - 1];
    return {
      documentDelta: last.documentCount - first.documentCount,
      chunkDelta: last.chunkCount - first.chunkCount,
      relationDelta: last.relationCount - first.relationCount,
    };
  }, [filteredTrendSnapshots]);

  const relationRecords = useMemo(
    () => graphResult?.records || [],
    [graphResult?.records],
  );

  const insightAction = useMemo<ProjectKnowledgeInsightAction>(() => {
    if (
      !sourceRegistered
      || quantMetrics.indexedRatio < 1
      || quantMetrics.documentCount <= 0
      || quantMetrics.chunkCount <= 0
    ) {
      return "settings";
    }
    if (trendDelta.relationDelta <= 0) {
      return "query";
    }
    return "healthy";
  }, [
    quantMetrics.chunkCount,
    quantMetrics.documentCount,
    quantMetrics.indexedRatio,
    sourceRegistered,
    trendDelta.relationDelta,
  ]);

  const insightMessageKey = useMemo(() => {
    if (insightAction === "settings") {
      return "projects.knowledge.insightNeedRegister";
    }
    if (insightAction === "query") {
      return "projects.knowledge.insightNeedExplore";
    }
    return "projects.knowledge.insightHealthy";
  }, [insightAction]);

  const knowledgeState = useMemo<ProjectKnowledgeState>(() => ({
    projectSourceId,
    sourceLoaded,
    sourceRegistered,
    projectSources,
    selectedSourceId,
    setSelectedSourceId,
    sourceContentById,
    sourceContentLoadingById,
    loadSourceContent,
    syncState,
    activeKnowledgeTasks,
    activeKnowledgeTask,
    latestQualityLoopJob,
    memifyEnabled,
    processingModes,
    activeOutputResolution,
    processingScheduler,
    modeOutputs,
    quantMetrics,
    graphQueryText,
    setGraphQueryText,
    graphQueryMode,
    setGraphQueryMode,
    graphQueryTopK,
    setGraphQueryTopK,
    graphNeedsRefresh,
    markGraphNeedsRefresh,
    graphLoading,
    graphError,
    graphResult,
    relationRecords,
    relationKeywordSeed,
    setRelationKeywordSeed,
    activeGraphNodeId,
    setActiveGraphNodeId,
    runGraphQuery,
    startProcessingMode,
    processingLaunchMode,
    resetGraphQuery,
    trendRangeDays,
    setTrendRangeDays,
    trendExpanded,
    setTrendExpanded,
    filteredTrendSnapshots,
    trendDocumentPath,
    trendChunkPath,
    trendDelta,
    syncAlertType,
    syncAlertDescription,
    suggestedQuery,
    insightAction,
    insightMessageKey,
    loadProjectSourceStatus,
    semanticBySourceId,
    semanticLoadingBySourceId,
    loadSourceSemantic,
  }), [
    activeGraphNodeId,
    activeKnowledgeTask,
    activeKnowledgeTasks,
    activeOutputResolution,
    filteredTrendSnapshots,
    graphError,
    graphLoading,
    graphQueryMode,
    graphQueryText,
    graphQueryTopK,
    graphNeedsRefresh,
    graphResult,
    insightAction,
    insightMessageKey,
    latestQualityLoopJob,
    memifyEnabled,
    loadProjectSourceStatus,
    loadSourceContent,
    loadSourceSemantic,
    modeOutputs,
    processingModes,
    processingScheduler,
    projectSourceId,
    projectSources,
    quantMetrics,
    relationKeywordSeed,
    relationRecords,
    markGraphNeedsRefresh,
    resetGraphQuery,
    runGraphQuery,
    startProcessingMode,
    processingLaunchMode,
    selectedSourceId,
    semanticBySourceId,
    semanticLoadingBySourceId,
    sourceContentById,
    sourceContentLoadingById,
    sourceLoaded,
    sourceRegistered,
    suggestedQuery,
    syncAlertDescription,
    syncAlertType,
    syncState,
    trendChunkPath,
    trendDelta,
    trendDocumentPath,
    trendExpanded,
    trendRangeDays,
  ]);

  return knowledgeState;
}