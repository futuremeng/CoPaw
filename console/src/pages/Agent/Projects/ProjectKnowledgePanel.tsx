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

export default function ProjectKnowledgePanel(props: ProjectKnowledgePanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [queryText, setQueryText] = useState("");
  const [queryMode, setQueryMode] = useState<"template" | "cypher">("template");
  const [includeGlobal, setIncludeGlobal] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GraphQueryResponse | null>(null);
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
      const response = await api.listKnowledgeSources();
      const matched = response.sources.find((source) => source.id === projectSourceId) || null;
      setProjectSource(matched);
      setSourceRegistered(Boolean(matched));
    } catch {
      setSourceRegistered(false);
      setProjectSource(null);
    } finally {
      setSourceLoaded(true);
    }
  }, [projectSourceId]);

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
      });
      await api.indexKnowledgeSource(projectSourceId);
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
      await api.indexKnowledgeSource(projectSourceId);
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
      void api.getMemifyJobStatus(memifyJobId)
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
        });
        setResult(response);
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
            onRefresh={() => {
              void handleQuery();
            }}
          />
          {visualizationData ? <GraphVisualization data={visualizationData} loading={loading} /> : null}
        </div>
      ) : null}
    </Card>
  );
}
