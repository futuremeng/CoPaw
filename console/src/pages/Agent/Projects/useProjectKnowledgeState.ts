import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import api, { type GraphQueryResponse, getApiToken, getApiUrl } from "../../../api";
import type {
  GraphQueryRecord,
  KnowledgeTaskProgress,
  KnowledgeSourceContent,
  KnowledgeSourceItem,
  KnowledgeSourceSemanticStatus,
  ProjectKnowledgeGlobalMetricsPayload,
  ProjectKnowledgeModeMetricsPayload,
  ProjectKnowledgeOutputResolutionPayload,
  ProjectKnowledgeModeOutputPayload,
  ProjectKnowledgeQuantizationStage,
  ProjectKnowledgeProcessingSchedulerPayload,
  ProjectKnowledgeProcessingModeStatePayload,
  ProjectKnowledgeSyncState,
  QualityLoopJobStatus,
} from "../../../api/types";
import { filterGraphQuerySourceRecords } from "../Knowledge/graphQuery";
import {
  getProjectKnowledgeQuantizationStage,
  prioritizeProjectKnowledgeArtifacts,
  getProjectKnowledgeSemanticSummary,
  getProjectKnowledgeSyncAlertDescription,
  getProjectKnowledgeSyncAlertType,
} from "./projectKnowledgeSyncUi";

type ProjectGraphQueryMode = "template" | "cypher";

const ALL_GRAPH_QUERY_TOKEN = "*";
const MIN_ALL_GRAPH_QUERY_TOP_K = 5000;

export interface ProjectKnowledgeHeaderSignals {
  indexedRatio: number;
  documentCount: number;
  chunkCount: number;
  sentenceCount: number;
  charCount?: number;
  tokenCount?: number;
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
  charCount?: number;
  tokenCount?: number;
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

export interface ProjectKnowledgeMetricsMeta {
  source: string;
  updatedAt: string;
  sourceId: string;
  sourceStatsUpdatedAt: string;
}

export type ProjectKnowledgeProcessingMode = "fast" | "nlp" | "agentic";
export type ProjectKnowledgeRealtimeChannel = "project-sync" | "tasks";
export type ProjectKnowledgeRealtimeChannelStatus = "idle" | "connecting" | "open" | "reconnecting";

export interface ProjectKnowledgeModeState {
  mode: ProjectKnowledgeProcessingMode;
  status: "idle" | "queued" | "running" | "ready" | "failed" | "blocked";
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
  corReadyChunkCount?: number;
  corClusterCount?: number;
  corReplacementCount?: number;
  corEffectiveChunkCount?: number;
  corReadyChunkRatio?: number;
  corEffectiveChunkRatio?: number;
  corReasonCode?: string;
  corReason?: string;
  nerReadyChunkCount?: number;
  nerEntityCount?: number;
  syntaxReadyChunkCount?: number;
  syntaxSentenceCount?: number;
  syntaxTokenCount?: number;
  syntaxRelationCount?: number;
  l2TotalChunks?: number;
  corDoneChunks?: number;
  nerDoneChunks?: number;
  syntaxDoneChunks?: number;
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

export interface ProjectKnowledgeProcessingCompareDelta {
  entityDelta: number;
  relationDelta: number;
}

export interface ProjectKnowledgeProcessingFreshness {
  stale: boolean;
  staleModes: ProjectKnowledgeProcessingMode[];
  staleSources: ProjectKnowledgeRealtimeChannel[];
  channelStatus: Record<ProjectKnowledgeRealtimeChannel, ProjectKnowledgeRealtimeChannelStatus>;
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
  processingCompareModes: ProjectKnowledgeModeState[];
  processingCompareDelta: ProjectKnowledgeProcessingCompareDelta;
  processingFreshness: ProjectKnowledgeProcessingFreshness;
  outputModes: ProjectKnowledgeModeState[];
  outputResolution: ProjectKnowledgeOutputResolution;
  processingScheduler: ProjectKnowledgeProcessingScheduler;
  modeOutputs: Record<ProjectKnowledgeProcessingMode, ProjectKnowledgeModeOutput>;
  quantMetrics: ProjectKnowledgeMetrics;
  quantMetricsMeta?: ProjectKnowledgeMetricsMeta | null;
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
  graphRelationTypeFilters: string[];
  setGraphRelationTypeFilters: (value: string[]) => void;
  graphEntityTypeFilters: string[];
  setGraphEntityTypeFilters: (value: string[]) => void;
  graphRelationTypeOptions: string[];
  graphEntityTypeOptions: string[];
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
    options?: { force?: boolean; trigger?: string; quantizationStage?: ProjectKnowledgeQuantizationStage },
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
  semanticBySourceId: Record<string, { subject?: string; summary?: string; keywords?: string[]; semanticStatus?: KnowledgeSourceSemanticStatus }>;
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
const HIGH_ORDER_OUTPUT_MODES: ProjectKnowledgeProcessingMode[] = ["agentic", "nlp"];
const PROCESSING_STALE_AFTER_MS = 15_000;

const ACTIVE_KNOWLEDGE_STATUSES = new Set([
  "pending",
  "running",
  "queued",
  "indexing",
  "graphifying",
]);

function mergeSemanticSummaryIntoStage(
  baseStage: string,
  semanticSummary?: string,
  semanticStatus?: string,
): string {
  const normalizedStage = String(baseStage || "").trim();
  const normalizedSummary = String(semanticSummary || "").trim();
  const normalizedStatus = String(semanticStatus || "").trim().toLowerCase();
  if (!normalizedSummary || normalizedStatus === "ready") {
    return normalizedStage;
  }
  if (!normalizedStage) {
    return normalizedSummary;
  }
  if (normalizedStage.includes(normalizedSummary)) {
    return normalizedStage;
  }
  return `${normalizedStage} · ${normalizedSummary}`;
}

function activeKnowledgeTaskPriority(task: KnowledgeTaskProgress): number {
  const type = String(task.task_type || "").trim().toLowerCase();
  if (type === "quality_loop") {
    return 0;
  }
  if (type === "memify") {
    return 1;
  }
  if (type === "project_sync") {
    return 2;
  }
  if (type === "history_backfill") {
    return 3;
  }
  return 9;
}

export function getActiveKnowledgeTasks(tasks: KnowledgeTaskProgress[]): KnowledgeTaskProgress[] {
  const priority = (task: KnowledgeTaskProgress): number => {
    return activeKnowledgeTaskPriority(task);
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

export function pickActiveKnowledgeTask(tasks: KnowledgeTaskProgress[]): KnowledgeTaskProgress | null {
  const active = getActiveKnowledgeTasks(tasks);
  return active[0] || null;
}

function parseTimestampMs(value: string): number | null {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function filterGraphQueryRecordsBySourceId(
  records: GraphQueryRecord[],
  sourceId?: string,
): GraphQueryRecord[] {
  const target = String(sourceId || "").trim();
  if (!target) {
    return records;
  }
  return (records || []).filter((record) => String(record.source_id || "").trim() === target);
}

export function applySourceFilterToGraphQueryResponse(
  response: GraphQueryResponse,
  sourceId?: string,
): GraphQueryResponse {
  const filtered = filterGraphQueryRecordsBySourceId(response.records || [], sourceId);
  return {
    ...response,
    records: filtered,
    summary: `Filtered ${filtered.length} of ${(response.records || []).length} graph records by source.`,
    provenance: {
      ...(response.provenance || {}),
      source_filter_id: String(sourceId || "").trim(),
      source_filter_mode: String(sourceId || "").trim() ? "selected_source" : "all_sources",
      source_filter_baseline_record_count: (response.records || []).length,
    },
  };
}

function isModeStatusStale(mode: ProjectKnowledgeModeState): boolean {
  if (mode.status !== "running" && mode.status !== "queued") {
    return false;
  }
  const updatedMs = parseTimestampMs(mode.lastUpdatedAt);
  if (updatedMs === null) {
    return false;
  }
  return Date.now() - updatedMs >= PROCESSING_STALE_AFTER_MS;
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
  const l2Metrics = syncState?.l2_metrics;
  if (l2Metrics && typeof l2Metrics === "object") {
    const l2RelationCount = (l2Metrics as { syntax_relation_count?: unknown }).syntax_relation_count;
    if (Number.isFinite(Number(l2RelationCount))) {
      return Number(l2RelationCount);
    }
  }
  const indexResult = syncState?.last_result?.index;
  if (indexResult && typeof indexResult === "object") {
    const syntaxRelationCount = (indexResult as { syntax_relation_count?: unknown }).syntax_relation_count;
    if (Number.isFinite(Number(syntaxRelationCount))) {
      return Number(syntaxRelationCount);
    }
  }
  const memify = syncState?.last_result?.memify;
  if (!memify || typeof memify !== "object") {
    return 0;
  }
  const relationCount = (memify as { relation_count?: unknown }).relation_count;
  return Number.isFinite(Number(relationCount)) ? Number(relationCount) : Number(relationCount || 0);
}

function getSyncNodeCount(syncState: ProjectKnowledgeSyncState | null): number {
  const l2Metrics = syncState?.l2_metrics;
  if (l2Metrics && typeof l2Metrics === "object") {
    const l2EntityCount = (l2Metrics as { ner_entity_count?: unknown }).ner_entity_count;
    if (Number.isFinite(Number(l2EntityCount))) {
      return Number(l2EntityCount);
    }
  }
  const indexResult = syncState?.last_result?.index;
  if (indexResult && typeof indexResult === "object") {
    const nerEntityCount = (indexResult as { ner_entity_count?: unknown }).ner_entity_count;
    if (Number.isFinite(Number(nerEntityCount))) {
      return Number(nerEntityCount);
    }
  }
  const memify = syncState?.last_result?.memify;
  if (!memify || typeof memify !== "object") {
    return 0;
  }
  const nodeCount = (memify as { node_count?: unknown }).node_count;
  return Number.isFinite(Number(nodeCount)) ? Number(nodeCount) : Number(nodeCount || 0);
}

function getSyncIndexCount(
  syncState: ProjectKnowledgeSyncState | null,
  key: "document_count" | "chunk_count" | "sentence_count" | "char_count" | "token_count",
): number {
  const indexResult = syncState?.last_result?.index;
  if (!indexResult || typeof indexResult !== "object") {
    return 0;
  }
  const rawValue = (indexResult as Record<string, unknown>)[key];
  return Number.isFinite(Number(rawValue)) ? Number(rawValue) : Number(rawValue || 0);
}

function getSyncIndexMetric(
  syncState: ProjectKnowledgeSyncState | null,
  key: string,
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
    || value === "blocked"
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

type ProjectKnowledgeCountMetricKey =
  | "document_count"
  | "chunk_count"
  | "sentence_count"
  | "char_count"
  | "token_count";

interface ProjectKnowledgeSourceQuantBaseMetrics {
  totalSources: number;
  indexedSources: number;
  indexedRatio: number;
  documentCount: number;
  chunkCount: number;
  sentenceCount: number;
  charCount: number;
  tokenCount: number;
}

function hasBackendGlobalCountMetric(
  syncState: ProjectKnowledgeSyncState | null,
  key: ProjectKnowledgeCountMetricKey,
): boolean {
  const payload = syncState?.global_metrics;
  if (!payload || typeof payload !== "object") {
    return false;
  }
  return normalizeNullableNumber(payload[key]) !== null;
}

function sumSourceMetric(
  projectSources: KnowledgeSourceItem[],
  key: ProjectKnowledgeCountMetricKey,
): number {
  return projectSources.reduce(
    (sum, item) => sum + Math.max(0, normalizeNumber(item.status?.[key])),
    0,
  );
}

function resolveCountMetric(
  syncState: ProjectKnowledgeSyncState | null,
  sourceTotal: number,
  key: ProjectKnowledgeCountMetricKey,
): number {
  if (hasBackendGlobalCountMetric(syncState, key)) {
    return getBackendGlobalMetricNumber(syncState, key);
  }
  return Math.max(sourceTotal, getSyncIndexCount(syncState, key));
}

export function deriveSourceQuantBaseMetrics(
  projectSources: KnowledgeSourceItem[],
  sourceRegistered: boolean,
  syncState: ProjectKnowledgeSyncState | null,
): ProjectKnowledgeSourceQuantBaseMetrics {
  const totalSources = projectSources.length;
  // indexed 仅代表 Interlinear 工件存在，统计已与后端一致
  const indexedSources = projectSources.filter((item) => item.status.indexed).length;

  const sourceDocumentCount = sumSourceMetric(projectSources, "document_count");
  const sourceChunkCount = sumSourceMetric(projectSources, "chunk_count");
  const sourceSentenceCount = sumSourceMetric(projectSources, "sentence_count");
  const sourceCharCount = sumSourceMetric(projectSources, "char_count");
  const sourceTokenCount = sumSourceMetric(projectSources, "token_count");

  const documentCount = resolveCountMetric(syncState, sourceDocumentCount, "document_count");
  const chunkCount = resolveCountMetric(syncState, sourceChunkCount, "chunk_count");
  const sentenceCount = resolveCountMetric(syncState, sourceSentenceCount, "sentence_count");
  const charCount = resolveCountMetric(syncState, sourceCharCount, "char_count");
  const tokenCount = resolveCountMetric(syncState, sourceTokenCount, "token_count");

  const hasIndexedSignal = documentCount > 0
    || chunkCount > 0
    || getSyncIndexCount(syncState, "document_count") > 0
    || getSyncIndexCount(syncState, "chunk_count") > 0;
  const effectiveTotalSources = totalSources > 0
    ? totalSources
    : (sourceRegistered || hasIndexedSignal ? 1 : 0);
  const effectiveIndexedSources = totalSources > 0
    ? Math.max(indexedSources, hasIndexedSignal ? 1 : 0)
    : (hasIndexedSignal ? 1 : 0);
  const indexedRatio = effectiveTotalSources > 0
    ? effectiveIndexedSources / effectiveTotalSources
    : 0;

  return {
    totalSources: effectiveTotalSources,
    indexedSources: effectiveIndexedSources,
    indexedRatio,
    documentCount,
    chunkCount,
    sentenceCount,
    charCount,
    tokenCount,
  };
}

function parseBackendProcessingModes(
  syncState: ProjectKnowledgeSyncState | null,
): ProjectKnowledgeModeState[] | null {
  const payload = syncState?.processing_modes;
  if (!Array.isArray(payload) || payload.length === 0) {
    return null;
  }

  const parsed = payload
    .map((item): ProjectKnowledgeModeState | null => {
      const modePayload = item as ProjectKnowledgeProcessingModeStatePayload;
      if (!isProcessingMode(modePayload.mode)) {
        return null;
      }
      const modeMetric = getBackendModeMetric(syncState, modePayload.mode);
      const l2Progress = syncState?.l2_progress;
      const l2Metrics = syncState?.l2_metrics;
      const isNlpMode = modePayload.mode === "nlp";
      const next: ProjectKnowledgeModeState = {
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
        corReadyChunkCount: isNlpMode
          ? Math.max(
            normalizeNumber(modeMetric?.cor_ready_chunk_count),
            normalizeNumber(l2Metrics?.cor_ready_chunk_count),
          )
          : normalizeNumber(modeMetric?.cor_ready_chunk_count),
        corClusterCount: isNlpMode
          ? Math.max(
            normalizeNumber(modeMetric?.cor_cluster_count),
            normalizeNumber(l2Metrics?.cor_cluster_count),
          )
          : normalizeNumber(modeMetric?.cor_cluster_count),
        corReplacementCount: isNlpMode
          ? Math.max(
            normalizeNumber(modeMetric?.cor_replacement_count),
            normalizeNumber(l2Metrics?.cor_replacement_count),
          )
          : normalizeNumber(modeMetric?.cor_replacement_count),
        corEffectiveChunkCount: isNlpMode
          ? Math.max(
            normalizeNumber(modeMetric?.cor_effective_chunk_count),
            normalizeNumber(l2Metrics?.cor_effective_chunk_count),
          )
          : normalizeNumber(modeMetric?.cor_effective_chunk_count),
        corReadyChunkRatio: normalizeNullableNumber(modeMetric?.cor_ready_chunk_ratio) ?? undefined,
        corEffectiveChunkRatio: normalizeNullableNumber(modeMetric?.cor_effective_chunk_ratio) ?? undefined,
        corReasonCode: String(modeMetric?.cor_reason_code || "").trim(),
        corReason: String(modeMetric?.cor_reason || "").trim(),
        nerReadyChunkCount: isNlpMode
          ? Math.max(
            normalizeNumber(modeMetric?.ner_ready_chunk_count),
            normalizeNumber(l2Metrics?.ner_ready_chunk_count),
          )
          : normalizeNumber(modeMetric?.ner_ready_chunk_count),
        nerEntityCount: isNlpMode
          ? Math.max(
            normalizeNumber(modeMetric?.ner_entity_count),
            normalizeNumber(l2Metrics?.ner_entity_count),
          )
          : normalizeNumber(modeMetric?.ner_entity_count),
        syntaxReadyChunkCount: isNlpMode
          ? Math.max(
            normalizeNumber(modeMetric?.syntax_ready_chunk_count),
            normalizeNumber(l2Metrics?.syntax_ready_chunk_count),
          )
          : normalizeNumber(modeMetric?.syntax_ready_chunk_count),
        syntaxSentenceCount: isNlpMode
          ? Math.max(
            normalizeNumber(modeMetric?.syntax_sentence_count),
            normalizeNumber(l2Metrics?.syntax_sentence_count),
          )
          : normalizeNumber(modeMetric?.syntax_sentence_count),
        syntaxTokenCount: isNlpMode
          ? Math.max(
            normalizeNumber(modeMetric?.syntax_token_count),
            normalizeNumber(l2Metrics?.syntax_token_count),
          )
          : normalizeNumber(modeMetric?.syntax_token_count),
        syntaxRelationCount: isNlpMode
          ? Math.max(
            normalizeNumber(modeMetric?.syntax_relation_count),
            normalizeNumber(l2Metrics?.syntax_relation_count),
          )
          : normalizeNumber(modeMetric?.syntax_relation_count),
        l2TotalChunks: isNlpMode ? normalizeNumber(l2Progress?.total_chunks) : undefined,
        corDoneChunks: isNlpMode ? normalizeNumber(l2Progress?.cor_done_chunks) : undefined,
        nerDoneChunks: isNlpMode ? normalizeNumber(l2Progress?.ner_done_chunks) : undefined,
        syntaxDoneChunks: isNlpMode ? normalizeNumber(l2Progress?.syntax_done_chunks) : undefined,
      };
      return next;
    })
    .filter((item): item is ProjectKnowledgeModeState => item !== null);

  return parsed.length > 0 ? parsed : null;
}

function parseBackendOutputResolution(
  syncState: ProjectKnowledgeSyncState | null,
  processingModes: ProjectKnowledgeModeState[],
): ProjectKnowledgeOutputResolution | null {
  const payload = syncState?.output_resolution as ProjectKnowledgeOutputResolutionPayload | undefined;
  if (!payload) {
    return null;
  }

  const outputModes = processingModes.filter((item) => item.mode === "nlp" || item.mode === "agentic");
  if (outputModes.length === 0 || (payload.active_mode !== "nlp" && payload.active_mode !== "agentic")) {
    return null;
  }

  const availableModes = Array.isArray(payload.available_modes)
    ? payload.available_modes.filter((mode): mode is ProjectKnowledgeProcessingMode => mode === "nlp" || mode === "agentic")
    : [];
  const fallbackChain: ProjectKnowledgeProcessingMode[] = Array.isArray(payload.fallback_chain)
    ? payload.fallback_chain.filter((mode): mode is ProjectKnowledgeProcessingMode => mode === "nlp" || mode === "agentic")
    : HIGH_ORDER_OUTPUT_MODES;
  const activeMode = outputModes.some((item) => item.mode === payload.active_mode)
    ? payload.active_mode
    : outputModes[0]?.mode || "agentic";
  const skippedModes = Array.isArray(payload.skipped_modes)
    ? payload.skipped_modes
      .filter((item) => item?.mode === "nlp" || item?.mode === "agentic")
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
  outputResolution: ProjectKnowledgeOutputResolution,
): ProjectKnowledgeProcessingScheduler | null {
  const payload = syncState?.output_scheduler as ProjectKnowledgeProcessingSchedulerPayload | undefined;
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
    : outputResolution.activeMode;

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
  outputResolution: ProjectKnowledgeOutputResolution,
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

  let reason = `当前按 ${outputResolution.activeMode} 输出消费。`;
  if (runningModes.length > 0) {
    reason = `当前正在推进 ${runningModes.join(" / ")}，消费侧继续读取 ${outputResolution.activeMode}。`;
  } else if (queuedModes.length > 0) {
    reason = `当前无活跃执行，下一条待推进轨道为 ${queuedModes[0]}。`;
  } else if (readyModes.length > 0) {
    reason = `当前无待执行轨道，直接消费最佳可用输出 ${outputResolution.activeMode}。`;
  }

  return {
    strategy: "parallel",
    modeOrder,
    runningModes,
    queuedModes,
    readyModes,
    failedModes,
    nextMode,
    consumptionMode: outputResolution.activeMode,
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
      artifacts: prioritizeProjectKnowledgeArtifacts(
        Array.isArray(item?.artifacts)
          ? item.artifacts
            .map((artifact) => ({
              kind: String(artifact.kind || "").trim(),
              label: String(artifact.label || "").trim(),
              path: String(artifact.path || "").trim(),
            }))
            .filter((artifact) => artifact.path)
          : [],
      ),
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
    && left.charCount === right.charCount
    && left.tokenCount === right.tokenCount
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
  const [graphBaseResult, setGraphBaseResult] = useState<GraphQueryResponse | null>(null);
  const [graphResult, setGraphResult] = useState<GraphQueryResponse | null>(null);
  const [graphRelationTypeFilters, setGraphRelationTypeFilters] = useState<string[]>([]);
  const [graphEntityTypeFilters, setGraphEntityTypeFilters] = useState<string[]>([]);
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
  const [projectSyncChannelStatus, setProjectSyncChannelStatus] =
    useState<ProjectKnowledgeRealtimeChannelStatus>("idle");
  const [tasksChannelStatus, setTasksChannelStatus] =
    useState<ProjectKnowledgeRealtimeChannelStatus>("idle");
  const [semanticBySourceId, setSemanticBySourceId] = useState<Record<string, { subject?: string; summary?: string; keywords?: string[]; semanticStatus?: KnowledgeSourceSemanticStatus }>>({});
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
            semanticStatus: match.semantic_status,
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
    const payload = syncState?.output_resolution as ProjectKnowledgeOutputResolutionPayload | undefined;
    if (payload && (payload.active_mode === "nlp" || payload.active_mode === "agentic")) {
      return payload.active_mode;
    }
    return "agentic";
  }, [syncState]);

  const allGraphQueryTopK = useMemo(() => Math.max(
    MIN_ALL_GRAPH_QUERY_TOP_K,
    getSyncRelationCount(syncState),
    getSyncEnrichmentMetric(syncState, "edge_count"),
  ), [syncState]);

  const buildLocalFilteredGraphResult = useCallback((
    baseResult: GraphQueryResponse,
    filterText: string,
    relationTypeFilters: string[],
    entityTypeFilters: string[],
    sourceId: string,
  ): GraphQueryResponse => {
    const normalizedFilter = String(filterText || "").trim();
    const sourceScopedRecords = filterGraphQueryRecordsBySourceId(baseResult.records || [], sourceId);
    const filteredRecords = filterGraphQuerySourceRecords(sourceScopedRecords, normalizedFilter, {
      relationTypes: relationTypeFilters,
      entityTypes: entityTypeFilters,
    });
    return {
      ...baseResult,
      records: filteredRecords,
      summary: normalizedFilter
        ? `Filtered ${filteredRecords.length} of ${sourceScopedRecords.length} graph records.`
        : `Loaded ${sourceScopedRecords.length} graph records for local explore.`,
      provenance: {
        ...baseResult.provenance,
        baseline_record_count: sourceScopedRecords.length,
        filter_text: normalizedFilter,
        relation_type_filters: relationTypeFilters,
        entity_type_filters: entityTypeFilters,
        source_filter_id: sourceId,
        filter_mode: "local",
      },
    };
  }, []);

  const markGraphNeedsRefresh = useCallback(() => {
    setGraphNeedsRefresh(true);
  }, []);

  const runGraphQuery = useCallback(async (
    overrideQuery?: string,
    overrideMode?: ProjectGraphQueryMode,
    overrideTopK?: number,
    overrideOutputMode?: ProjectKnowledgeProcessingMode,
  ) => {
    const rawQuery = overrideQuery ?? graphQueryText;
    const query = rawQuery.trim();
    const mode = overrideMode ?? graphQueryMode;
    const outputMode = overrideOutputMode ?? defaultOutputModeForQuery;
    if (!params.projectId) {
      setGraphError(t("projects.knowledge.emptyQuery"));
      return;
    }
    if (mode === "cypher" && !query) {
      setGraphError(t("projects.knowledge.emptyQuery"));
      return;
    }

    setGraphLoading(true);
    setGraphError("");
    try {
      if (mode === "template") {
        const baseResponse = await api.graphQuery({
          query: ALL_GRAPH_QUERY_TOKEN,
          mode,
          topK: Math.max(
            allGraphQueryTopK,
            Number(overrideTopK ?? graphQueryTopK) || PROJECT_GRAPH_QUERY_TOP_K,
          ),
          outputMode,
          datasetScope: selectedSourceId ? [selectedSourceId] : undefined,
          timeoutSec: 20,
          projectScope: [params.projectId],
          includeGlobal: params.includeGlobal,
          projectId: params.projectId,
        });
        const filteredResponse = buildLocalFilteredGraphResult(
          baseResponse,
          query,
          graphRelationTypeFilters,
          graphEntityTypeFilters,
          selectedSourceId,
        );
        setGraphQueryText(rawQuery);
        setGraphQueryMode(mode);
        setGraphBaseResult(baseResponse);
        setGraphResult(filteredResponse);
      } else {
        const response = await api.graphQuery({
          query,
          mode,
          topK: Math.max(
            20,
            Number(overrideTopK ?? graphQueryTopK) || PROJECT_GRAPH_QUERY_TOP_K,
          ),
          outputMode,
          datasetScope: selectedSourceId ? [selectedSourceId] : undefined,
          timeoutSec: 20,
          projectScope: [params.projectId],
          includeGlobal: params.includeGlobal,
          projectId: params.projectId,
        });
        const sourceFilteredResponse = applySourceFilterToGraphQueryResponse(
          response,
          selectedSourceId,
        );
        setGraphQueryText(query);
        setGraphQueryMode(mode);
        setGraphBaseResult(response);
        setGraphResult(sourceFilteredResponse);
      }
      setActiveGraphNodeId(null);
      setGraphNeedsRefresh(false);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : t("projects.knowledge.queryFailed");
      setGraphError(messageText);
    } finally {
      setGraphLoading(false);
    }
  }, [allGraphQueryTopK, buildLocalFilteredGraphResult, defaultOutputModeForQuery, graphEntityTypeFilters, graphQueryMode, graphQueryText, graphQueryTopK, graphRelationTypeFilters, params.includeGlobal, params.projectId, selectedSourceId, t]);

  useEffect(() => {
    if (!graphBaseResult) {
      return;
    }
    if (graphQueryMode === "template") {
      setGraphResult(
        buildLocalFilteredGraphResult(
          graphBaseResult,
          graphQueryText,
          graphRelationTypeFilters,
          graphEntityTypeFilters,
          selectedSourceId,
        ),
      );
      return;
    }
    setGraphResult(applySourceFilterToGraphQueryResponse(graphBaseResult, selectedSourceId));
  }, [
    applySourceFilterToGraphQueryResponse,
    buildLocalFilteredGraphResult,
    graphBaseResult,
    graphEntityTypeFilters,
    graphQueryMode,
    graphQueryText,
    graphRelationTypeFilters,
    selectedSourceId,
  ]);

  const startProcessingMode = useCallback(async (
    mode: ProjectKnowledgeProcessingMode,
    options?: { force?: boolean; trigger?: string; quantizationStage?: ProjectKnowledgeQuantizationStage },
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
        quantizationStage: options?.quantizationStage ?? getProjectKnowledgeQuantizationStage(mode),
      });
      setSyncState(response.state);
    } finally {
      setProcessingLaunchMode(null);
    }
  }, [params.projectId]);

  const resetGraphQuery = useCallback(() => {
    setGraphError("");
    setGraphBaseResult(null);
    setGraphResult(null);
    setGraphRelationTypeFilters([]);
    setGraphEntityTypeFilters([]);
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
    setGraphBaseResult(null);
    setGraphResult(null);
    setGraphRelationTypeFilters([]);
    setGraphEntityTypeFilters([]);
    setProcessingLaunchMode(null);
    setRelationKeywordSeed("");
    setActiveGraphNodeId(null);
    setActiveKnowledgeTasks([]);
    setActiveKnowledgeTask(null);
    setLatestQualityLoopJob(null);
    setProjectSyncChannelStatus("idle");
    setTasksChannelStatus("idle");
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
      setProjectSyncChannelStatus("idle");
      return;
    }
    let disposed = false;
    let reconnectTimer: number | null = null;
    let activeSocket: WebSocket | null = null;

    const connect = () => {
      if (disposed) {
        return;
      }
      setProjectSyncChannelStatus((prev) => (prev === "idle" ? "connecting" : "reconnecting"));
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
        ws.onopen = () => {
          if (disposed) {
            return;
          }
          setProjectSyncChannelStatus("open");
        };
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
          setProjectSyncChannelStatus("reconnecting");
          reconnectTimer = window.setTimeout(() => {
            connect();
          }, 1500);
        };
      } catch {
        // ignore websocket construction failure in unsupported env
        setProjectSyncChannelStatus("reconnecting");
      }
    };

    connect();

    return () => {
      disposed = true;
      setProjectSyncChannelStatus("idle");
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
      setTasksChannelStatus("idle");
      return;
    }
    let disposed = false;
    let reconnectTimer: number | null = null;
    let activeSocket: WebSocket | null = null;

    const connect = () => {
      if (disposed) {
        return;
      }
      setTasksChannelStatus((prev) => (prev === "idle" ? "connecting" : "reconnecting"));
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
        ws.onopen = () => {
          if (disposed) {
            return;
          }
          setTasksChannelStatus("open");
        };
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
          setTasksChannelStatus("reconnecting");
          reconnectTimer = window.setTimeout(() => {
            connect();
          }, 1500);
        };
      } catch {
        // ignore websocket construction failure in unsupported env
        setTasksChannelStatus("reconnecting");
      }
    };

    connect();

    return () => {
      disposed = true;
      setTasksChannelStatus("idle");
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
    const defaultToken = `${params.projectId}:${String(params.includeGlobal)}:all-records`;
    if (defaultExploreTokenRef.current === defaultToken || graphLoading || graphBaseResult) {
      return;
    }
    defaultExploreTokenRef.current = defaultToken;
    setGraphQueryText((prev) => prev);
    void runGraphQuery("", "template");
  }, [graphBaseResult, graphLoading, params.eagerExploreLoad, params.includeGlobal, params.projectId, runGraphQuery]);

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
    const sourceBaseMetrics = deriveSourceQuantBaseMetrics(projectSources, sourceRegistered, syncState);
    const {
      totalSources,
      indexedSources,
      indexedRatio,
      documentCount,
      chunkCount,
      sentenceCount,
      charCount,
      tokenCount,
    } = sourceBaseMetrics;
    const sentenceWithEntitiesCount = getSyncMemifyMetric(syncState, "sentence_with_entities_count");
    const entityMentionsCount = getSyncMemifyMetric(syncState, "entity_mentions_count");
    const avgEntitiesPerSentence = getSyncMemifyMetric(syncState, "avg_entities_per_sentence");
    const avgEntityCharRatio = getSyncMemifyMetric(syncState, "avg_entity_char_ratio");
    const relationCount = getSyncRelationCount(syncState);
    const entityCount = getSyncNodeCount(syncState);
    const effectiveEntityCount = entityCount;
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
      totalSources,
      indexedSources,
      indexedRatio,
      documentCount,
      chunkCount,
      sentenceCount,
      charCount,
      tokenCount,
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
    graphBaseResult?.records,
    latestQualityLoopJob?.rounds,
    projectSources,
    sourceRegistered,
    syncState,
  ]);

  const quantMetricsMeta = useMemo<ProjectKnowledgeMetricsMeta | null>(() => {
    const payload = syncState?.global_metrics;
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const source = String(payload.metrics_source || "").trim();
    const updatedAt = String(payload.metrics_updated_at || "").trim();
    const sourceId = String(payload.source_id || "").trim();
    const sourceStatsUpdatedAt = String(payload.source_stats_updated_at || "").trim();
    if (!source && !updatedAt && !sourceId && !sourceStatsUpdatedAt) {
      return null;
    }
    return {
      source,
      updatedAt,
      sourceId,
      sourceStatsUpdatedAt,
    };
  }, [syncState?.global_metrics]);

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
    );
    const nlpRelationCount = Math.max(
      getBackendModeMetricNumber(syncState, "nlp", "relation_count"),
      getSyncRelationCount(syncState),
    );
    const nlpCorReadyChunkCount = Math.max(
      getBackendModeMetricNumber(syncState, "nlp", "cor_ready_chunk_count"),
      normalizeNumber(syncState?.l2_metrics?.cor_ready_chunk_count),
      getSyncIndexMetric(syncState, "cor_ready_chunk_count"),
    );
    const nlpCorClusterCount = Math.max(
      getBackendModeMetricNumber(syncState, "nlp", "cor_cluster_count"),
      normalizeNumber(syncState?.l2_metrics?.cor_cluster_count),
      getSyncIndexMetric(syncState, "cor_cluster_count"),
    );
    const nlpCorReplacementCount = Math.max(
      getBackendModeMetricNumber(syncState, "nlp", "cor_replacement_count"),
      normalizeNumber(syncState?.l2_metrics?.cor_replacement_count),
      getSyncIndexMetric(syncState, "cor_replacement_count"),
    );
    const nlpCorEffectiveChunkCount = Math.max(
      getBackendModeMetricNumber(syncState, "nlp", "cor_effective_chunk_count"),
      normalizeNumber(syncState?.l2_metrics?.cor_effective_chunk_count),
      getSyncIndexMetric(syncState, "cor_effective_chunk_count"),
    );
    const nlpNerReadyChunkCount = Math.max(
      getBackendModeMetricNumber(syncState, "nlp", "ner_ready_chunk_count"),
      normalizeNumber(syncState?.l2_metrics?.ner_ready_chunk_count),
      0,
    );
    const nlpNerEntityCount = Math.max(
      getBackendModeMetricNumber(syncState, "nlp", "ner_entity_count"),
      normalizeNumber(syncState?.l2_metrics?.ner_entity_count),
      0,
    );
    const nlpSyntaxReadyChunkCount = Math.max(
      getBackendModeMetricNumber(syncState, "nlp", "syntax_ready_chunk_count"),
      normalizeNumber(syncState?.l2_metrics?.syntax_ready_chunk_count),
      0,
    );
    const nlpSyntaxSentenceCount = Math.max(
      getBackendModeMetricNumber(syncState, "nlp", "syntax_sentence_count"),
      normalizeNumber(syncState?.l2_metrics?.syntax_sentence_count),
      0,
    );
    const nlpSyntaxTokenCount = Math.max(
      getBackendModeMetricNumber(syncState, "nlp", "syntax_token_count"),
      normalizeNumber(syncState?.l2_metrics?.syntax_token_count),
      0,
    );
    const nlpSyntaxRelationCount = Math.max(
      getBackendModeMetricNumber(syncState, "nlp", "syntax_relation_count"),
      normalizeNumber(syncState?.l2_metrics?.syntax_relation_count),
      0,
    );
    const l2TotalChunks = normalizeNumber(syncState?.l2_progress?.total_chunks);
    const l2CorDoneChunks = normalizeNumber(syncState?.l2_progress?.cor_done_chunks);
    const l2NerDoneChunks = normalizeNumber(syncState?.l2_progress?.ner_done_chunks);
    const l2SyntaxDoneChunks = normalizeNumber(syncState?.l2_progress?.syntax_done_chunks);
    const nlpCorReadyChunkRatio = getBackendModeMetricNullableNumber(syncState, "nlp", "cor_ready_chunk_ratio")
      ?? normalizeNullableNumber(getSyncIndexMetric(syncState, "cor_ready_chunk_ratio"));
    const nlpCorEffectiveChunkRatio = getBackendModeMetricNullableNumber(syncState, "nlp", "cor_effective_chunk_ratio")
      ?? normalizeNullableNumber(getSyncIndexMetric(syncState, "cor_effective_chunk_ratio"));
    const agenticEntityCount = 0;
    const agenticRelationCount = 0;
    const agenticQualityScore = null;

    const fastAvailable = fastDocumentCount > 0 || fastChunkCount > 0;
    const nlpAvailable = nlpEntityCount > 0 || nlpRelationCount > 0;
    const agenticAvailable = false;
    const semanticSummary = getProjectKnowledgeSemanticSummary(syncState?.semantic_engine, t);
    const semanticStatus = String(syncState?.semantic_engine?.status || "").trim();
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
        stage: mergeSemanticSummaryIntoStage(
          nlpStatus === "running"
            ? String(activeKnowledgeTask?.stage_message || activeKnowledgeTask?.current_stage || "Building NLP artifacts")
            : nlpAvailable
              ? "NLP graph artifacts ready"
              : "Waiting for graph extraction",
          semanticSummary,
          semanticStatus,
        ),
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
        corReadyChunkCount: nlpCorReadyChunkCount,
        corClusterCount: nlpCorClusterCount,
        corReplacementCount: nlpCorReplacementCount,
        corEffectiveChunkCount: nlpCorEffectiveChunkCount,
        corReadyChunkRatio: nlpCorReadyChunkRatio ?? undefined,
        corEffectiveChunkRatio: nlpCorEffectiveChunkRatio ?? undefined,
        nerReadyChunkCount: nlpNerReadyChunkCount,
        nerEntityCount: nlpNerEntityCount,
        syntaxReadyChunkCount: nlpSyntaxReadyChunkCount,
        syntaxSentenceCount: nlpSyntaxSentenceCount,
        syntaxTokenCount: nlpSyntaxTokenCount,
        syntaxRelationCount: nlpSyntaxRelationCount,
        l2TotalChunks,
        corDoneChunks: l2CorDoneChunks,
        nerDoneChunks: l2NerDoneChunks,
        syntaxDoneChunks: l2SyntaxDoneChunks,
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
    t,
  ]);

  const outputModes = useMemo<ProjectKnowledgeModeState[]>(
    () => HIGH_ORDER_OUTPUT_MODES
      .map((mode) => processingModes.find((item) => item.mode === mode) || null)
      .filter((item): item is ProjectKnowledgeModeState => Boolean(item)),
    [processingModes],
  );

  const outputResolution = useMemo<ProjectKnowledgeOutputResolution>(() => {
    const backendResolution = parseBackendOutputResolution(syncState, processingModes);
    if (backendResolution) {
      return backendResolution;
    }

    const availableModes = outputModes
      .filter((mode) => mode.available)
      .map((mode) => mode.mode);
    const fallbackChain: ProjectKnowledgeProcessingMode[] = HIGH_ORDER_OUTPUT_MODES;

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
      activeMode: "agentic",
      availableModes,
      fallbackChain,
      reasonCode: "HIGH_ORDER_PENDING",
      reason: "高阶输出尚未就绪，当前保持 L2/L3 输出视角并等待深加工产物生成。",
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
  }, [outputModes, processingModes, syncState]);

  const processingScheduler = useMemo<ProjectKnowledgeProcessingScheduler>(() => {
    const backendScheduler = parseBackendProcessingScheduler(
      syncState,
      processingModes,
      outputResolution,
    );
    if (backendScheduler) {
      return backendScheduler;
    }
    return deriveProcessingScheduler(processingModes, outputResolution);
  }, [outputResolution, processingModes, syncState]);

  const processingCompareModes = useMemo<ProjectKnowledgeModeState[]>(
    () => ["nlp", "agentic"]
      .map((mode) => processingModes.find((item) => item.mode === mode) || null)
      .filter((item): item is ProjectKnowledgeModeState => Boolean(item)),
    [processingModes],
  );

  const processingCompareDelta = useMemo<ProjectKnowledgeProcessingCompareDelta>(() => {
    const l2Mode = processingCompareModes.find((item) => item.mode === "nlp") || null;
    const l3Mode = processingCompareModes.find((item) => item.mode === "agentic") || null;

    return {
      entityDelta: l2Mode && l3Mode ? Math.max(0, l3Mode.entityCount - l2Mode.entityCount) : 0,
      relationDelta: l2Mode && l3Mode ? Math.max(0, l3Mode.relationCount - l2Mode.relationCount) : 0,
    };
  }, [processingCompareModes]);

  const processingFreshness = useMemo<ProjectKnowledgeProcessingFreshness>(() => {
    const staleModeStates = processingCompareModes.filter((mode) => isModeStatusStale(mode));
    const staleModes = staleModeStates.map((mode) => mode.mode);
    const staleSources: ProjectKnowledgeRealtimeChannel[] = [];
    const hasQueuedOrRunningModes = staleModeStates.some(
      (mode) => mode.status === "running" || mode.status === "queued",
    );

    if (staleModes.length > 0 && projectSyncChannelStatus !== "open") {
      staleSources.push("project-sync");
    }
    if (hasQueuedOrRunningModes && tasksChannelStatus !== "open") {
      staleSources.push("tasks");
    }

    return {
      stale: staleModes.length > 0,
      staleModes,
      staleSources,
      channelStatus: {
        "project-sync": projectSyncChannelStatus,
        tasks: tasksChannelStatus,
      },
    };
  }, [processingCompareModes, projectSyncChannelStatus, tasksChannelStatus]);

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
      charCount: quantMetrics.charCount,
      tokenCount: quantMetrics.tokenCount,
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
    quantMetrics.charCount,
    quantMetrics.sentenceCount,
    quantMetrics.sentenceWithEntitiesCount,
    quantMetrics.entityMentionsCount,
    quantMetrics.avgEntitiesPerSentence,
    quantMetrics.avgEntityCharRatio,
    quantMetrics.documentCount,
    quantMetrics.indexedRatio,
    quantMetrics.tokenCount,
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

  const graphRelationTypeOptions = useMemo(
    () => Array.from(new Set(
      (graphBaseResult?.records || [])
        .map((record) => String(record.predicate || "").trim())
        .filter(Boolean),
    )).sort(),
    [graphBaseResult?.records],
  );

  const graphEntityTypeOptions = useMemo(
    () => Array.from(new Set(
      (graphBaseResult?.records || [])
        .flatMap((record) => [record.subject_type, record.object_type])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    )).sort(),
    [graphBaseResult?.records],
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
    processingCompareModes,
    processingCompareDelta,
    processingFreshness,
    outputModes,
    outputResolution,
    processingScheduler,
    modeOutputs,
    quantMetrics,
    quantMetricsMeta,
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
    graphRelationTypeFilters,
    setGraphRelationTypeFilters,
    graphEntityTypeFilters,
    setGraphEntityTypeFilters,
    graphRelationTypeOptions,
    graphEntityTypeOptions,
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
    filteredTrendSnapshots,
    graphError,
    graphEntityTypeFilters,
    graphEntityTypeOptions,
    graphLoading,
    graphQueryMode,
    graphQueryText,
    graphQueryTopK,
    graphNeedsRefresh,
    graphRelationTypeFilters,
    graphRelationTypeOptions,
    graphResult,
    insightAction,
    insightMessageKey,
    latestQualityLoopJob,
    memifyEnabled,
    loadProjectSourceStatus,
    loadSourceContent,
    loadSourceSemantic,
    modeOutputs,
    outputModes,
    outputResolution,
    processingCompareDelta,
    processingCompareModes,
    processingFreshness,
    processingModes,
    processingScheduler,
    projectSourceId,
    projectSources,
    quantMetrics,
    quantMetricsMeta,
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