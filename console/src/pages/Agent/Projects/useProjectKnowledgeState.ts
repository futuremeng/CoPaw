import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import api, { type GraphQueryResponse, getApiToken, getApiUrl } from "../../../api";
import type { KnowledgeSourceItem, ProjectKnowledgeSyncState } from "../../../api/types";
import {
  getProjectKnowledgeSyncAlertDescription,
  getProjectKnowledgeSyncAlertType,
} from "./projectKnowledgeSyncUi";

export interface ProjectKnowledgeHeaderSignals {
  indexedRatio: number;
  documentCount: number;
  chunkCount: number;
  relationCount: number;
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
  relationCount: number;
}

export type ProjectKnowledgeInsightAction = "settings" | "query" | "healthy";

export interface ProjectKnowledgeState {
  projectSourceId: string;
  sourceLoaded: boolean;
  sourceRegistered: boolean;
  projectSources: KnowledgeSourceItem[];
  syncState: ProjectKnowledgeSyncState | null;
  quantMetrics: ProjectKnowledgeMetrics;
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
}

interface UseProjectKnowledgeStateParams {
  projectId: string;
  projectName: string;
  graphResult?: GraphQueryResponse | null;
  onSignalsChange?: (signals: ProjectKnowledgeHeaderSignals) => void;
}

interface ProjectKnowledgeUiPrefs {
  trendExpanded: boolean;
}

const PROJECT_TREND_STORAGE_PREFIX = "copaw.project.knowledge.trend.v1";
const PROJECT_KNOWLEDGE_UI_PREFS_PREFIX = "copaw.project.knowledge.ui.v1";
const DAY_MS = 24 * 60 * 60 * 1000;

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

export function useProjectKnowledgeState(
  params: UseProjectKnowledgeStateParams,
): ProjectKnowledgeState {
  const { t } = useTranslation();
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [projectSources, setProjectSources] = useState<KnowledgeSourceItem[]>([]);
  const [trendRangeDays, setTrendRangeDays] = useState<7 | 30>(7);
  const [trendSnapshots, setTrendSnapshots] = useState<ProjectKnowledgeTrendSnapshot[]>([]);
  const [trendExpanded, setTrendExpanded] = useState(true);
  const [syncState, setSyncState] = useState<ProjectKnowledgeSyncState | null>(null);
  const refreshReasonRef = useRef("");

  const projectSourceId = useMemo(() => {
    const safeId = params.projectId
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return `project-${safeId || "default"}-workspace`;
  }, [params.projectId]);

  const loadProjectSourceStatus = useCallback(async () => {
    try {
      const response = await api.listKnowledgeSources({ projectId: params.projectId });
      setProjectSources(response.sources || []);
    } catch {
      setProjectSources([]);
    } finally {
      setSourceLoaded(true);
    }
  }, [params.projectId]);

  useEffect(() => {
    if (!params.projectId) {
      setProjectSources([]);
      setSourceLoaded(false);
      return;
    }
    void loadProjectSourceStatus();
  }, [loadProjectSourceStatus, params.projectId]);

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
    if (!syncState) {
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
  }, [loadProjectSourceStatus, syncState]);

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
    () => projectSources.some((source) => source.id === projectSourceId),
    [projectSourceId, projectSources],
  );

  const quantMetrics = useMemo(() => {
    const totalSources = projectSources.length;
    const indexedSources = projectSources.filter((item) => item.status.indexed).length;
    const indexedRatio = totalSources > 0 ? indexedSources / totalSources : 0;
    const documentCount = projectSources.reduce(
      (sum, item) => sum + Math.max(0, item.status.document_count || 0),
      0,
    );
    const chunkCount = projectSources.reduce(
      (sum, item) => sum + Math.max(0, item.status.chunk_count || 0),
      0,
    );
    const relationCount = Math.max(
      params.graphResult?.records?.length || 0,
      getSyncRelationCount(syncState),
    );
    return {
      totalSources,
      indexedSources,
      indexedRatio,
      documentCount,
      chunkCount,
      relationCount,
    };
  }, [params.graphResult?.records?.length, projectSources, syncState]);

  const syncAlertType = useMemo(
    () => getProjectKnowledgeSyncAlertType(syncState),
    [syncState],
  );

  const syncAlertDescription = useMemo(() => {
    if (!syncState) {
      return "";
    }
    return getProjectKnowledgeSyncAlertDescription(syncState, t);
  }, [syncState, t]);

  useEffect(() => {
    params.onSignalsChange?.({
      indexedRatio: quantMetrics.indexedRatio,
      documentCount: quantMetrics.documentCount,
      chunkCount: quantMetrics.chunkCount,
      relationCount: quantMetrics.relationCount,
    });
  }, [
    params.onSignalsChange,
    quantMetrics.chunkCount,
    quantMetrics.documentCount,
    quantMetrics.indexedRatio,
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

  const suggestedQuery = useMemo(() => {
    const projectLabel = params.projectName || params.projectId;
    return `Summarize key entities, modules, and relations in project ${projectLabel}`;
  }, [params.projectId, params.projectName]);

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

  return {
    projectSourceId,
    sourceLoaded,
    sourceRegistered,
    projectSources,
    syncState,
    quantMetrics,
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
  };
}