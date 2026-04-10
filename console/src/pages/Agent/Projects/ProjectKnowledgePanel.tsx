import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Select,
  Space,
  Spin,
  Typography,
  message,
} from "antd";
import { useTranslation } from "react-i18next";
import api, { type GraphQueryResponse } from "../../../api";
import type { KnowledgeSourceItem } from "../../../api/types";
import { recordsToVisualizationData } from "../Knowledge/graphQuery";
import {
  appendUniqueContextLine,
  buildPathContextLine,
} from "../Knowledge/pathContext";
import { GraphQueryResults, GraphVisualization } from "../Knowledge/graphVisualization";
import styles from "./index.module.less";

interface ProjectKnowledgePanelProps {
  includeGlobal?: boolean;
  onIncludeGlobalChange?: (checked: boolean) => void;
  projectId: string;
  projectName: string;
  onOpenSettings?: () => void;
}

const PROJECT_GRAPH_TOP_K = 12;
const PROJECT_GRAPH_TIMEOUT_SEC = 20;
const PROJECT_TREND_STORAGE_PREFIX = "copaw.project.knowledge.trend.v1";
const DAY_MS = 24 * 60 * 60 * 1000;

interface ProjectKnowledgeTrendSnapshot {
  ts: number;
  indexedRatio: number;
  documentCount: number;
  chunkCount: number;
  relationCount: number;
}

type ProjectKnowledgeInsightAction = "settings" | "query" | "healthy";

interface ProjectKnowledgeUiPrefs {
  trendExpanded: boolean;
  queryExpanded: boolean;
  resultExpanded: boolean;
}

const PROJECT_KNOWLEDGE_UI_PREFS_PREFIX = "copaw.project.knowledge.ui.v1";

function uiPrefsStorageKey(projectId: string): string {
  return `${PROJECT_KNOWLEDGE_UI_PREFS_PREFIX}.${projectId || "default"}`;
}

function loadUiPrefs(projectId: string): ProjectKnowledgeUiPrefs {
  const fallback: ProjectKnowledgeUiPrefs = {
    trendExpanded: true,
    queryExpanded: true,
    resultExpanded: true,
  };
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
      queryExpanded:
        typeof parsed.queryExpanded === "boolean"
          ? parsed.queryExpanded
          : fallback.queryExpanded,
      resultExpanded:
        typeof parsed.resultExpanded === "boolean"
          ? parsed.resultExpanded
          : fallback.resultExpanded,
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

export default function ProjectKnowledgePanel(props: ProjectKnowledgePanelProps) {
  const { t } = useTranslation();
  const [queryText, setQueryText] = useState("");
  const [queryMode, setQueryMode] = useState<"template" | "cypher">("template");
  const [internalIncludeGlobal] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GraphQueryResponse | null>(null);
  const [activeGraphNodeId, setActiveGraphNodeId] = useState<string | null>(null);
  const [sourceRegistered, setSourceRegistered] = useState(false);
  const [projectSources, setProjectSources] = useState<KnowledgeSourceItem[]>([]);
  const [trendRangeDays, setTrendRangeDays] = useState<7 | 30>(7);
  const [trendSnapshots, setTrendSnapshots] = useState<ProjectKnowledgeTrendSnapshot[]>([]);
  const [trendExpanded, setTrendExpanded] = useState(true);
  const [queryExpanded, setQueryExpanded] = useState(true);
  const [resultExpanded, setResultExpanded] = useState(true);

  const includeGlobal = props.includeGlobal ?? internalIncludeGlobal;

  const projectSourceId = useMemo(() => {
    const safeId = props.projectId
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return `project-${safeId || "default"}-workspace`;
  }, [props.projectId]);

  const loadProjectSourceStatus = useCallback(async () => {
    try {
      const response = await api.listKnowledgeSources({
        projectId: props.projectId,
      });
      setProjectSources(response.sources || []);
      const matched = response.sources.find((source) => source.id === projectSourceId) || null;
      setSourceRegistered(Boolean(matched));
    } catch {
      setProjectSources([]);
      setSourceRegistered(false);
    } finally {
      // no-op
    }
  }, [projectSourceId, props.projectId]);

  useEffect(() => {
    void loadProjectSourceStatus();
  }, [loadProjectSourceStatus]);

  useEffect(() => {
    setTrendSnapshots(loadTrendSnapshots(props.projectId));
  }, [props.projectId]);

  useEffect(() => {
    const prefs = loadUiPrefs(props.projectId);
    setTrendExpanded(prefs.trendExpanded);
    setQueryExpanded(prefs.queryExpanded);
    setResultExpanded(prefs.resultExpanded);
  }, [props.projectId]);

  useEffect(() => {
    saveUiPrefs(props.projectId, {
      trendExpanded,
      queryExpanded,
      resultExpanded,
    });
  }, [props.projectId, queryExpanded, resultExpanded, trendExpanded]);

  const handleQuery = useCallback(
    async (overrideQuery?: string) => {
      const query = (overrideQuery ?? queryText).trim();
      if (!query) {
        message.warning(t("projects.knowledge.emptyQuery"));
        return;
      }

      try {
        setLoading(true);
        setError("");
        const response = await api.graphQuery({
          query,
          mode: queryMode,
          topK: PROJECT_GRAPH_TOP_K,
          timeoutSec: PROJECT_GRAPH_TIMEOUT_SEC,
          projectScope: [props.projectId],
          includeGlobal,
          projectId: props.projectId,
        });
        setResult(response);
        setActiveGraphNodeId(null);
        setResultExpanded(true);
      } catch (err) {
        const messageText =
          err instanceof Error ? err.message : t("projects.knowledge.queryFailed");
        setError(messageText);
        message.error(messageText);
      } finally {
        setLoading(false);
      }
    },
    [includeGlobal, props.projectId, queryMode, queryText, t],
  );

  const visualizationData = useMemo(() => {
    if (!result) {
      return null;
    }
    return recordsToVisualizationData(result.records, result.summary, result.provenance);
  }, [result]);

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
    const relationCount = result?.records?.length || 0;
    return {
      totalSources,
      indexedSources,
      indexedRatio,
      documentCount,
      chunkCount,
      relationCount,
    };
  }, [projectSources, result?.records]);

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
      saveTrendSnapshots(props.projectId, next);
      return next;
    });
  }, [
    props.projectId,
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
    const projectLabel = props.projectName || props.projectId;
    return `Summarize key entities, modules, and relations in project ${projectLabel}`;
  }, [props.projectId, props.projectName]);

  const insightAction = useMemo<ProjectKnowledgeInsightAction>(() => {
    if (!sourceRegistered || quantMetrics.indexedRatio < 1 || quantMetrics.documentCount <= 0 || quantMetrics.chunkCount <= 0) {
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

  const handleInsightAction = useCallback(() => {
    if (insightAction === "settings") {
      props.onOpenSettings?.();
      return;
    }
    if (insightAction === "query") {
      setQueryText(suggestedQuery);
      setQueryExpanded(true);
      setResultExpanded(true);
      void handleQuery(suggestedQuery);
    }
  }, [
    handleQuery,
    insightAction,
    props.onOpenSettings,
    suggestedQuery,
  ]);

  return (
    <Card
      size="small"
      title={t("projects.knowledge.title")}
      className={styles.projectKnowledgeCard}
    >
      <Typography.Text type="secondary">
        {t("projects.knowledge.hint", {
          project: props.projectName || props.projectId,
        })}
      </Typography.Text>

      <div className={styles.projectKnowledgeTrendSection}>
        <div className={styles.projectKnowledgeTrendHeader}>
          <Typography.Text strong>
            {t("projects.knowledge.signalsTitle")}
          </Typography.Text>
          <Space size={6} wrap>
            <Select
              size="small"
              value={trendRangeDays}
              options={[
                { value: 7, label: t("projects.knowledge.trendRange7d") },
                { value: 30, label: t("projects.knowledge.trendRange30d") },
              ]}
              onChange={(value) => setTrendRangeDays(value as 7 | 30)}
              style={{ width: 96 }}
            />
            <Button
              size="small"
              onClick={() => {
                void loadProjectSourceStatus();
              }}
            >
              {t("projects.knowledge.actionRefreshSignals")}
            </Button>
            <Button
              size="small"
              type="text"
              onClick={() => setTrendExpanded((prev) => !prev)}
            >
              {trendExpanded ? t("common.collapse", "Collapse") : t("common.expand", "Expand")}
            </Button>
          </Space>
        </div>

        <div className={styles.projectKnowledgeSignalGrid}>
          <div className={styles.projectKnowledgeSignalCard}>
            <Typography.Text type="secondary">
              {t("projects.knowledge.signalIndexedCoverage")}
            </Typography.Text>
            <Typography.Text strong>
              {Math.round(quantMetrics.indexedRatio * 100)}%
            </Typography.Text>
          </div>
          <div className={styles.projectKnowledgeSignalCard}>
            <Typography.Text type="secondary">
              {t("projects.knowledge.signalDocuments")}
            </Typography.Text>
            <Typography.Text strong>{quantMetrics.documentCount}</Typography.Text>
            <Typography.Text type="secondary">
              {t("projects.knowledge.signalDelta", { value: trendDelta.documentDelta })}
            </Typography.Text>
          </div>
          <div className={styles.projectKnowledgeSignalCard}>
            <Typography.Text type="secondary">
              {t("projects.knowledge.signalChunks")}
            </Typography.Text>
            <Typography.Text strong>{quantMetrics.chunkCount}</Typography.Text>
            <Typography.Text type="secondary">
              {t("projects.knowledge.signalDelta", { value: trendDelta.chunkDelta })}
            </Typography.Text>
          </div>
          <div className={styles.projectKnowledgeSignalCard}>
            <Typography.Text type="secondary">
              {t("projects.knowledge.signalRelations")}
            </Typography.Text>
            <Typography.Text strong>{quantMetrics.relationCount}</Typography.Text>
            <Typography.Text type="secondary">
              {t("projects.knowledge.signalDelta", { value: trendDelta.relationDelta })}
            </Typography.Text>
          </div>
        </div>

        {trendExpanded && filteredTrendSnapshots.length > 1 ? (
          <div className={styles.projectKnowledgeTrendChart}>
            <svg viewBox="0 0 300 70" preserveAspectRatio="none">
              <path d={trendDocumentPath} fill="none" stroke="#1677ff" strokeWidth="2" />
              <path d={trendChunkPath} fill="none" stroke="#13c2c2" strokeWidth="2" />
            </svg>
            <div className={styles.projectKnowledgeTrendLegend}>
              <span>{t("projects.knowledge.signalDocuments")}</span>
              <span>{t("projects.knowledge.signalChunks")}</span>
            </div>
          </div>
        ) : trendExpanded ? (
          <Typography.Text type="secondary">
            {t("projects.knowledge.trendNotEnough")}
          </Typography.Text>
        ) : null}

        <div className={styles.projectKnowledgeInsightBar}>
          <Typography.Text type="secondary">{t(insightMessageKey)}</Typography.Text>
          <Space wrap className={styles.projectKnowledgeInsightActions}>
            {insightAction !== "healthy" ? (
              <Button
                size="small"
                type="primary"
                onClick={handleInsightAction}
              >
                {insightAction === "settings"
                  ? t("projects.knowledge.actionOpenSettings", "Open settings")
                  : t("projects.knowledge.actionRunSuggestedQuery")}
              </Button>
            ) : null}
          </Space>
        </div>
      </div>

      <div className={styles.projectKnowledgeQueryHeader}>
        <Space size={6} wrap>
          <Typography.Text type="secondary">
            {t("projects.knowledge.queryMode")}
          </Typography.Text>
          <Select
            size="small"
            value={queryMode}
            onChange={(value) => setQueryMode(value as "template" | "cypher")}
            options={[
              { label: t("projects.knowledge.queryModeTemplate"), value: "template" },
              { label: t("projects.knowledge.queryModeCypherMvp"), value: "cypher" },
            ]}
            style={{ width: 160 }}
          />
        </Space>
        <Button
          size="small"
          type="text"
          onClick={() => setQueryExpanded((prev) => !prev)}
        >
          {queryExpanded ? t("common.collapse", "Collapse") : t("common.expand", "Expand")}
        </Button>
      </div>

      {queryExpanded ? (
        <div className={styles.projectKnowledgeControls}>
          <Input.Search
            value={queryText}
            onChange={(event) => setQueryText(event.target.value)}
            onSearch={(value) => {
              void handleQuery(value);
            }}
            placeholder={t("projects.knowledge.queryPlaceholder")}
            enterButton={t("projects.knowledge.query")}
            loading={loading}
            allowClear
          />
          <Button
            size="small"
            disabled={!result}
            onClick={() => {
              setError("");
              setResult(null);
              setActiveGraphNodeId(null);
            }}
          >
            {t("projects.knowledge.reset")}
          </Button>
        </div>
      ) : null}

      {error ? <Alert type="error" showIcon message={error} /> : null}

      {loading && !result ? (
        <div className={styles.projectKnowledgeEmpty}>
          <Spin />
        </div>
      ) : null}

      {!loading && !result ? (
        <div className={styles.projectKnowledgeEmpty}>
          <Empty description={t("projects.knowledge.emptyResult")} />
        </div>
      ) : null}

      {result ? (
        <div className={styles.projectKnowledgeResultHeader}>
          <Typography.Text type="secondary">{t("projects.knowledge.query")}</Typography.Text>
          <Button
            size="small"
            type="text"
            onClick={() => setResultExpanded((prev) => !prev)}
          >
            {resultExpanded ? t("common.collapse", "Collapse") : t("common.expand", "Expand")}
          </Button>
        </div>
      ) : null}

      {result && resultExpanded ? (
        <div className={styles.projectKnowledgeResults}>
          <GraphQueryResults
            records={result.records}
            summary={result.summary}
            warnings={result.warnings}
            provenance={result.provenance}
            query={queryText}
            loading={loading}
            activeNodeId={activeGraphNodeId}
            onRecordClick={setActiveGraphNodeId}
            onRefresh={() => {
              void handleQuery();
            }}
          />
          {visualizationData ? (
            <GraphVisualization
              data={visualizationData}
              loading={loading}
              activeNodeId={activeGraphNodeId}
              onActiveNodeChange={setActiveGraphNodeId}
              onNodeClick={(node) => setActiveGraphNodeId(node.id)}
              onUsePathContext={(pathSummary, runNow) => {
                const contextLine = buildPathContextLine(pathSummary);
                setQueryText((prev) => {
                  const nextQuery = appendUniqueContextLine(prev, contextLine);
                  if (runNow) {
                    setQueryExpanded(true);
                    setResultExpanded(true);
                    void handleQuery(nextQuery);
                  }
                  return nextQuery;
                });
              }}
            />
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
