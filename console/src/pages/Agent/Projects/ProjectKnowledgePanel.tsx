import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Select,
  Space,
  Spin,
  Switch,
  Typography,
  message,
} from "antd";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import api, { type GraphQueryResponse } from "../../../api";
import type { KnowledgeSourceItem } from "../../../api/types";
import { agentsApi } from "../../../api/modules/agents";
import { recordsToVisualizationData } from "../Knowledge/graphQuery";
import {
  appendUniqueContextLine,
  buildPathContextLine,
} from "../Knowledge/pathContext";
import { GraphQueryResults, GraphVisualization } from "../Knowledge/graphVisualization";
import styles from "./index.module.less";

interface ProjectKnowledgePanelProps {
  agentId?: string;
  projectId: string;
  projectName: string;
  projectWorkspaceDir: string;
  projectAutoKnowledgeSink: boolean;
  onProjectAutoKnowledgeSinkChange?: (enabled: boolean) => void;
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

type ProjectKnowledgeInsightAction = "register" | "manualSink" | "query" | "healthy";

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
  const navigate = useNavigate();
  const [queryText, setQueryText] = useState("");
  const [queryMode, setQueryMode] = useState<"template" | "cypher">("template");
  const [includeGlobal, setIncludeGlobal] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GraphQueryResponse | null>(null);
  const [activeGraphNodeId, setActiveGraphNodeId] = useState<string | null>(null);
  const [autoSinkEnabled, setAutoSinkEnabled] = useState(
    props.projectAutoKnowledgeSink !== false,
  );
  const [updatingAutoSink, setUpdatingAutoSink] = useState(false);
  const [manualSinking, setManualSinking] = useState(false);
  const [memifyJobId, setMemifyJobId] = useState("");
  const [memifyStatus, setMemifyStatus] = useState<string>("");
  const [memifyError, setMemifyError] = useState("");
  const [registering, setRegistering] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [sourceRegistered, setSourceRegistered] = useState(false);
  const [projectSource, setProjectSource] = useState<KnowledgeSourceItem | null>(null);
  const [projectSources, setProjectSources] = useState<KnowledgeSourceItem[]>([]);
  const [trendRangeDays, setTrendRangeDays] = useState<7 | 30>(7);
  const [trendSnapshots, setTrendSnapshots] = useState<ProjectKnowledgeTrendSnapshot[]>([]);
  const autoSinkTriggerRef = useRef("");

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
      setProjectSource(matched);
      setSourceRegistered(Boolean(matched));
    } catch {
      setProjectSources([]);
      setSourceRegistered(false);
      setProjectSource(null);
    } finally {
      setSourceLoaded(true);
    }
  }, [projectSourceId, props.projectId]);

  const indexedAtLabel = useMemo(() => {
    const raw = projectSource?.status?.indexed_at;
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
  }, [projectSource?.status?.indexed_at]);

  useEffect(() => {
    void loadProjectSourceStatus();
  }, [loadProjectSourceStatus]);

  useEffect(() => {
    setTrendSnapshots(loadTrendSnapshots(props.projectId));
  }, [props.projectId]);

  useEffect(() => {
    setAutoSinkEnabled(props.projectAutoKnowledgeSink !== false);
  }, [props.projectAutoKnowledgeSink]);

  const handleRegisterProjectSource = useCallback(async () => {
    const location = (props.projectWorkspaceDir || "").trim();
    if (!location) {
      message.error(t("projects.knowledge.sourcePathMissing"));
      return;
    }
    try {
      setRegistering(true);
      await api.upsertKnowledgeSource({
        id: projectSourceId,
        name: `Project Workspace: ${props.projectName || props.projectId}`,
        type: "directory",
        location,
        content: "",
        enabled: true,
        recursive: true,
        project_id: props.projectId,
        tags: ["project", `project:${props.projectId}`, "scope:project"],
        summary: `Project-scoped knowledge source for ${props.projectName || props.projectId}`,
      }, {
        projectId: props.projectId,
      });
      await api.indexKnowledgeSource(projectSourceId, {
        projectId: props.projectId,
      });
      message.success(t("projects.knowledge.sourceRegisterSuccess"));
      await loadProjectSourceStatus();
    } catch (err) {
      const messageText =
        err instanceof Error ? err.message : t("projects.knowledge.sourceRegisterFailed");
      message.error(messageText);
    } finally {
      setRegistering(false);
    }
  }, [
    loadProjectSourceStatus,
    projectSourceId,
    props.projectId,
    props.projectName,
    props.projectWorkspaceDir,
    autoSinkEnabled,
    t,
  ]);

  const handleRetryIndex = useCallback(async () => {
    try {
      setRetrying(true);
      await api.indexKnowledgeSource(projectSourceId, {
        projectId: props.projectId,
      });
      message.success(t("projects.knowledge.retryIndexSuccess"));
      await loadProjectSourceStatus();
    } catch (err) {
      const messageText =
        err instanceof Error ? err.message : t("projects.knowledge.retryIndexFailed");
      message.error(messageText);
    } finally {
      setRetrying(false);
    }
  }, [loadProjectSourceStatus, projectSourceId, t]);

  const handleToggleAutoSink = useCallback(async (enabled: boolean) => {
    if (!props.agentId) {
      message.error(t("projects.knowledge.autoSinkAgentMissing"));
      return;
    }
    try {
      setUpdatingAutoSink(true);
      await agentsApi.updateProjectKnowledgeSink(props.agentId, props.projectId, {
        project_auto_knowledge_sink: enabled,
      });
      setAutoSinkEnabled(enabled);
      props.onProjectAutoKnowledgeSinkChange?.(enabled);
      message.success(
        enabled
          ? t("projects.knowledge.autoSinkEnabled")
          : t("projects.knowledge.autoSinkDisabled"),
      );
    } catch (err) {
      const messageText = err instanceof Error ? err.message : t("projects.knowledge.autoSinkUpdateFailed");
      message.error(messageText);
    } finally {
      setUpdatingAutoSink(false);
    }
  }, [props.agentId, props.projectId, props.onProjectAutoKnowledgeSinkChange, t]);

  const handleManualSink = useCallback(async () => {
    if (!sourceRegistered) {
      message.warning(t("projects.knowledge.sourceNotRegistered"));
      return;
    }
    try {
      setManualSinking(true);
      setMemifyError("");
      const response = await api.startMemifyJob({
        pipeline_type: "project-manual",
        dataset_scope: [projectSourceId],
        idempotency_key: `${props.projectId}:manual:${Date.now()}`,
        project_id: props.projectId,
      });
      setMemifyJobId(response.job_id);
      message.success(t("projects.knowledge.manualSinkStarted"));
    } catch (err) {
      const messageText = err instanceof Error ? err.message : t("projects.knowledge.manualSinkFailed");
      setMemifyError(messageText);
      message.error(messageText);
    } finally {
      setManualSinking(false);
    }
  }, [projectSourceId, props.projectId, sourceRegistered, t]);

  useEffect(() => {
    if (!memifyJobId) {
      return;
    }
    let disposed = false;
    const timer = window.setInterval(() => {
      void api.getMemifyJobStatus(memifyJobId, { projectId: props.projectId })
        .then((status) => {
          if (disposed) {
            return;
          }
          setMemifyStatus(status.status);
          setMemifyError((status.error || "").trim());
          if (status.status === "succeeded" || status.status === "failed") {
            window.clearInterval(timer);
            void loadProjectSourceStatus();
          }
        })
        .catch(() => {
          // keep polling on transient failures
        });
    }, 2000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [loadProjectSourceStatus, memifyJobId]);

  useEffect(() => {
    if (!autoSinkEnabled || !sourceRegistered) {
      return;
    }
    const indexedAt = (projectSource?.status?.indexed_at || "").trim();
    if (!indexedAt) {
      return;
    }
    const triggerKey = `${projectSourceId}:${indexedAt}`;
    if (autoSinkTriggerRef.current === triggerKey) {
      return;
    }
    autoSinkTriggerRef.current = triggerKey;
    void api.startMemifyJob({
      pipeline_type: "project-auto",
      dataset_scope: [projectSourceId],
      idempotency_key: `${props.projectId}:auto:${triggerKey}`,
      project_id: props.projectId,
    }).then((response) => {
      setMemifyJobId(response.job_id);
    }).catch(() => {
      // best-effort auto trigger
    });
  }, [autoSinkEnabled, projectSource?.status?.indexed_at, projectSourceId, props.projectId, sourceRegistered]);

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
    if (!sourceRegistered) {
      return "register";
    }
    if (quantMetrics.indexedRatio < 1 || quantMetrics.documentCount <= 0 || quantMetrics.chunkCount <= 0) {
      return "manualSink";
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
    if (insightAction === "register") {
      return "projects.knowledge.insightNeedRegister";
    }
    if (insightAction === "manualSink") {
      return "projects.knowledge.insightNeedManualSink";
    }
    if (insightAction === "query") {
      return "projects.knowledge.insightNeedExplore";
    }
    return "projects.knowledge.insightHealthy";
  }, [insightAction]);

  const handleInsightAction = useCallback(() => {
    if (insightAction === "register") {
      void handleRegisterProjectSource();
      return;
    }
    if (insightAction === "manualSink") {
      void handleManualSink();
      return;
    }
    if (insightAction === "query") {
      setQueryText(suggestedQuery);
      void handleQuery(suggestedQuery);
    }
  }, [
    handleManualSink,
    handleQuery,
    handleRegisterProjectSource,
    insightAction,
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

      <div className={styles.projectKnowledgeSourceRow}>
        <Badge
          status={sourceRegistered ? "success" : "default"}
          text={
            sourceLoaded
              ? sourceRegistered
                ? t("projects.knowledge.sourceRegistered")
                : t("projects.knowledge.sourceNotRegistered")
              : t("common.loading", "Loading")
          }
        />
        <Button
          size="small"
          type={sourceRegistered ? "default" : "primary"}
          loading={registering}
          onClick={() => {
            void handleRegisterProjectSource();
          }}
        >
          {sourceRegistered
            ? t("projects.knowledge.sourceReindex")
            : t("projects.knowledge.sourceRegister")}
        </Button>
      </div>

      <div className={styles.projectKnowledgeMetaRow}>
        <Typography.Text type="secondary">
          {t("projects.knowledge.sourceId")} {projectSourceId}
        </Typography.Text>
        <Typography.Text type="secondary">
          {t("projects.knowledge.lastIndexed")} {indexedAtLabel}
        </Typography.Text>
      </div>

      <Space wrap>
        <Button
          size="small"
          onClick={() => {
            navigate(`/knowledge?focus_source=${encodeURIComponent(projectSourceId)}`);
          }}
        >
          {t("projects.knowledge.openKnowledge")}
        </Button>
        <Space size={6}>
          <Typography.Text type="secondary">
            {t("projects.knowledge.autoSinkLabel")}
          </Typography.Text>
          <Switch
            checked={autoSinkEnabled}
            loading={updatingAutoSink}
            onChange={(checked) => {
              void handleToggleAutoSink(checked);
            }}
          />
        </Space>
        <Button
          size="small"
          loading={manualSinking}
          disabled={!sourceRegistered}
          onClick={() => {
            void handleManualSink();
          }}
        >
          {t("projects.knowledge.manualSink")}
        </Button>
      </Space>

      {sourceRegistered ? (
        <div className={styles.projectKnowledgeOpsRow}>
          <Typography.Text type="secondary">
            {t("projects.knowledge.docCount", {
              count: projectSource?.status?.document_count ?? 0,
            })}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t("projects.knowledge.chunkCount", {
              count: projectSource?.status?.chunk_count ?? 0,
            })}
          </Typography.Text>
        </div>
      ) : null}

      <div className={styles.projectKnowledgeTrendSection}>
        <div className={styles.projectKnowledgeTrendHeader}>
          <Typography.Text strong>
            {t("projects.knowledge.signalsTitle")}
          </Typography.Text>
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

        {filteredTrendSnapshots.length > 1 ? (
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
        ) : (
          <Typography.Text type="secondary">
            {t("projects.knowledge.trendNotEnough")}
          </Typography.Text>
        )}

        <div className={styles.projectKnowledgeInsightBox}>
          <Typography.Text strong>{t("projects.knowledge.insightTitle")}</Typography.Text>
          <Typography.Text type="secondary">{t(insightMessageKey)}</Typography.Text>
          <Space wrap className={styles.projectKnowledgeInsightActions}>
            {insightAction !== "healthy" ? (
              <Button
                size="small"
                type="primary"
                loading={insightAction === "manualSink" && manualSinking}
                onClick={handleInsightAction}
              >
                {insightAction === "register"
                  ? t("projects.knowledge.actionRegisterSource")
                  : insightAction === "manualSink"
                    ? t("projects.knowledge.actionRunManualSink")
                    : t("projects.knowledge.actionRunSuggestedQuery")}
              </Button>
            ) : null}
            <Button
              size="small"
              onClick={() => {
                void loadProjectSourceStatus();
              }}
            >
              {t("projects.knowledge.actionRefreshSignals")}
            </Button>
          </Space>
        </div>
      </div>

      {projectSource?.status?.error ? (
        <Alert
          type="error"
          showIcon
          message={t("projects.knowledge.indexError")}
          description={projectSource.status.error}
          action={
            <Button
              size="small"
              danger
              loading={retrying}
              onClick={() => {
                void handleRetryIndex();
              }}
            >
              {t("projects.knowledge.retryIndex")}
            </Button>
          }
        />
      ) : null}

      <div className={styles.projectKnowledgeControls}>
        <Space wrap>
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
        <Space wrap>
          <Checkbox
            checked={includeGlobal}
            onChange={(event) => setIncludeGlobal(event.target.checked)}
          >
            {t("projects.knowledge.includeGlobal")}
          </Checkbox>
          <Button
            disabled={!result}
            onClick={() => {
              setError("");
              setResult(null);
              setActiveGraphNodeId(null);
            }}
          >
            {t("projects.knowledge.reset")}
          </Button>
        </Space>
      </div>

      {error ? <Alert type="error" showIcon message={error} /> : null}
      {memifyJobId ? (
        <Alert
          type={memifyStatus === "failed" ? "error" : "info"}
          showIcon
          message={t("projects.knowledge.sinkJob")}
          description={`${memifyJobId} · ${memifyStatus || "pending"}${memifyError ? ` · ${memifyError}` : ""}`}
        />
      ) : null}

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
