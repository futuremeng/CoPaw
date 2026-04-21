import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Divider,
  Space,
  Switch,
  Typography,
  message,
} from "antd";
import api, { getApiToken, getApiUrl } from "../../../api";
import type { KnowledgeSourceItem, ProjectKnowledgeSyncState } from "../../../api/types";
import { agentsApi } from "../../../api/modules/agents";
import { knowledgeApi } from "../../../api/modules/knowledge";
import styles from "./index.module.less";
import { useTranslation } from "react-i18next";
import {
  getProjectKnowledgeSemanticDescription,
  getProjectKnowledgeSemanticReasonLabel,
  getProjectKnowledgeSyncAlertDescription,
  getProjectKnowledgeSyncAlertType,
} from "./projectKnowledgeSyncUi";

interface ProjectKnowledgeSettingsPanelProps {
  agentId?: string;
  projectId: string;
  projectName: string;
  projectWorkspaceDir: string;
  projectAutoKnowledgeSink: boolean;
  includeGlobal: boolean;
  onIncludeGlobalChange: (checked: boolean) => void;
  onProjectAutoKnowledgeSinkChange?: (enabled: boolean) => void;
}

export default function ProjectKnowledgeSettingsPanel(
  props: ProjectKnowledgeSettingsPanelProps,
) {
  const { t } = useTranslation();
  const {
    agentId,
    projectId,
    projectName,
    projectWorkspaceDir,
    projectAutoKnowledgeSink,
    includeGlobal,
    onIncludeGlobalChange,
    onProjectAutoKnowledgeSinkChange,
  } = props;
  const [updatingAutoSink, setUpdatingAutoSink] = useState(false);
  const [autoSinkEnabled, setAutoSinkEnabled] = useState(
    projectAutoKnowledgeSink !== false,
  );
  const [registering, setRegistering] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [manualSinking, setManualSinking] = useState(false);
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [sourceRegistered, setSourceRegistered] = useState(false);
  const [projectSource, setProjectSource] = useState<KnowledgeSourceItem | null>(null);
  const [syncState, setSyncState] = useState<ProjectKnowledgeSyncState | null>(null);
  const [memifyEnabled, setMemifyEnabled] = useState(false);
  const [memifyUpdating, setMemifyUpdating] = useState(false);

  const projectSourceId = useMemo(() => {
    const safeId = projectId
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return `project-${safeId || "default"}-workspace`;
  }, [projectId]);

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

  const loadProjectSourceStatus = useCallback(async () => {
    try {
      const response = await api.listKnowledgeSources({
        projectId,
        includeSemantic: true,
      });
      const matched = response.sources.find((source) => source.id === projectSourceId) || null;
      setProjectSource(matched);
      setSourceRegistered(Boolean(matched));
    } catch {
      setSourceRegistered(false);
      setProjectSource(null);
    } finally {
      setSourceLoaded(true);
    }
  }, [projectSourceId, projectId]);

  useEffect(() => {
    void loadProjectSourceStatus();
  }, [loadProjectSourceStatus]);

  useEffect(() => {
    const loadKnowledgeConfig = async () => {
      try {
        const config = await knowledgeApi.getKnowledgeConfig();
        setMemifyEnabled(Boolean(config.memify_enabled));
      } catch {
        // best-effort config load
      }
    };
    void loadKnowledgeConfig();
  }, []);

  useEffect(() => {
    setAutoSinkEnabled(projectAutoKnowledgeSink !== false);
  }, [projectAutoKnowledgeSink]);

  useEffect(() => {
    let cancelled = false;
    void api.getProjectKnowledgeSyncStatus({ projectId })
      .then((state) => {
        if (!cancelled) {
          setSyncState(state);
        }
      })
      .catch(() => {
        // best-effort initial status load
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (typeof WebSocket === "undefined") {
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
        wsUrl.searchParams.set("project_id", projectId);
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
        // ignore websocket construction failure in unsupported environments
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
  }, [projectId]);

  useEffect(() => {
    if (!syncState) {
      return;
    }
    if (syncState.latest_source_id !== projectSourceId) {
      return;
    }
    if (!["pending", "indexing", "graphifying", "succeeded", "failed"].includes(syncState.status)) {
      return;
    }
    void loadProjectSourceStatus();
  }, [loadProjectSourceStatus, projectSourceId, syncState]);

  const handleRegisterProjectSource = useCallback(async () => {
    const location = (projectWorkspaceDir || "").trim();
    if (!location) {
      message.error(t("projects.knowledge.sourcePathMissing"));
      return;
    }
    try {
      setRegistering(true);
      await api.upsertKnowledgeSource({
        id: projectSourceId,
        name: `Project Workspace: ${projectName || projectId}`,
        type: "directory",
        location,
        content: "",
        enabled: true,
        recursive: true,
        project_id: projectId,
        tags: ["project", `project:${projectId}`, "scope:project"],
        summary: `Project-scoped knowledge source for ${projectName || projectId}`,
      }, {
        projectId,
      });
      await api.indexKnowledgeSource(projectSourceId, {
        projectId,
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
    projectId,
    projectName,
    projectWorkspaceDir,
    t,
  ]);

  const handleRetryIndex = useCallback(async () => {
    try {
      setRetrying(true);
      await api.indexKnowledgeSource(projectSourceId, {
        projectId,
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
  }, [loadProjectSourceStatus, projectId, projectSourceId, t]);

  const handleToggleAutoSink = useCallback(async (enabled: boolean) => {
    if (!agentId) {
      message.error(t("projects.knowledge.autoSinkAgentMissing"));
      return;
    }
    try {
      setUpdatingAutoSink(true);
      await agentsApi.updateProjectKnowledgeSink(agentId, projectId, {
        project_auto_knowledge_sink: enabled,
      });
      setAutoSinkEnabled(enabled);
      onProjectAutoKnowledgeSinkChange?.(enabled);
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
  }, [agentId, onProjectAutoKnowledgeSinkChange, projectId, t]);

  const handleToggleMemify = useCallback(async (enabled: boolean) => {
    try {
      setMemifyUpdating(true);
      const config = await knowledgeApi.getKnowledgeConfig();
      config.memify_enabled = enabled;
      await knowledgeApi.updateKnowledgeConfig(config);
      setMemifyEnabled(enabled);
      message.success(
        enabled
          ? t("projects.knowledge.memifyEnabled", "Entity extraction enabled")
          : t("projects.knowledge.memifyDisabled", "Entity extraction disabled"),
      );
      if (enabled && (projectWorkspaceDir || "").trim()) {
        try {
          const response = await api.runProjectKnowledgeSync({
            projectId,
            trigger: "memify-enabled",
            force: true,
            processingMode: "nlp",
          });
          setSyncState(response.state);
        } catch {
          // best-effort: sync trigger failure is non-fatal
        }
      }
    } catch (err) {
      const messageText = err instanceof Error ? err.message : t("projects.knowledge.memifyUpdateFailed", "Failed to update entity extraction setting");
      message.error(messageText);
    } finally {
      setMemifyUpdating(false);
    }
  }, [projectId, projectWorkspaceDir, t]);

  const handleManualSink = useCallback(async () => {
    if (!(projectWorkspaceDir || "").trim()) {
      message.error(t("projects.knowledge.sourcePathMissing"));
      return;
    }
    try {
      setManualSinking(true);
      const response = await api.runProjectKnowledgeSync({
        projectId,
        trigger: "manual-panel",
        force: true,
        processingMode: "agentic",
      });
      setSyncState(response.state);
      message.success(t("projects.knowledge.manualSinkStarted"));
    } catch (err) {
      const messageText = err instanceof Error ? err.message : t("projects.knowledge.manualSinkFailed");
      message.error(messageText);
    } finally {
      setManualSinking(false);
    }
  }, [projectId, projectWorkspaceDir, t]);

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

  const memifyStats = useMemo(() => {
    const empty = {
      nodeCount: 0,
      relationCount: 0,
      sentenceCount: 0,
      sentenceWithEntitiesCount: 0,
      hasStats: false,
    };

    const lastResult = syncState?.last_result;
    if (!lastResult || typeof lastResult !== "object") {
      return empty;
    }

    const memify = (lastResult as Record<string, unknown>).memify;
    if (!memify || typeof memify !== "object") {
      return empty;
    }

    const payload = memify as Record<string, unknown>;
    const readNumber = (value: unknown) => {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      return 0;
    };

    const nodeCount = readNumber(payload.node_count);
    const relationCount = readNumber(payload.relation_count);
    const sentenceCount = readNumber(payload.sentence_count);
    const sentenceWithEntitiesCount = readNumber(payload.sentence_with_entities_count);
    const hasStats =
      nodeCount > 0 || relationCount > 0 || sentenceCount > 0 || sentenceWithEntitiesCount > 0;

    return {
      nodeCount,
      relationCount,
      sentenceCount,
      sentenceWithEntitiesCount,
      hasStats,
    };
  }, [syncState]);

  const entityCoverageLabel = useMemo(() => {
    if (memifyStats.sentenceCount <= 0) {
      return "-";
    }
    const ratio = (memifyStats.sentenceWithEntitiesCount / memifyStats.sentenceCount) * 100;
    return `${ratio.toFixed(1)}%`;
  }, [memifyStats.sentenceCount, memifyStats.sentenceWithEntitiesCount]);

  const semanticStatus = syncState?.semantic_engine ?? projectSource?.semantic_status;
  const semanticAlertType = semanticStatus?.status === "error"
    ? "error"
    : semanticStatus?.status === "unavailable"
      ? "warning"
      : semanticStatus?.status === "idle"
        ? "info"
      : "success";
  const semanticReasonLabel = getProjectKnowledgeSemanticReasonLabel(semanticStatus, t);
  const semanticDescription = getProjectKnowledgeSemanticDescription(semanticStatus, t);
  const semanticReasonCode = String(semanticStatus?.reason_code || "").trim().toUpperCase();
  const showSidecarHint = semanticReasonCode.startsWith("HANLP2_SIDECAR_");
  const semanticSidecarHint = useMemo(() => {
    if (!showSidecarHint) {
      return [] as string[];
    }
    return [
      t(
        "projects.knowledge.semanticSidecarHintEnable",
        "1. Set COPAW_HANLP_SIDECAR_ENABLED=1 and point COPAW_HANLP_SIDECAR_PYTHON to a dedicated Python 3.9 interpreter.",
      ),
      t(
        "projects.knowledge.semanticSidecarHintInstall",
        "2. Install HanLP into that sidecar environment with: <sidecar-python> -m pip install hanlp",
      ),
      t(
        "projects.knowledge.semanticSidecarHintOffline",
        "3. Optional for offline use: set COPAW_HANLP_HOME and preload ~/.hanlp plus ~/.cache/huggingface.",
      ),
      t(
        "projects.knowledge.semanticSidecarHintVerify",
        "4. Run qwenpaw doctor to verify the HanLP sidecar before rerunning project sync.",
      ),
    ];
  }, [showSidecarHint, t]);

  return (
    <div className={styles.projectKnowledgeWorkbench}>
      <div className={styles.projectKnowledgeTabHeader}>
        <div>
          <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
            {t("projects.knowledgeDock.tabSettings", "Settings")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {syncState?.status && syncState.status !== "idle"
              ? syncAlertDescription
              : t("projects.knowledge.settingsHint", "Configure project knowledge indexing and extraction.")}
          </Typography.Text>
        </div>
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
      </div>

      <section className={styles.projectKnowledgeLayerSection}>
        <div className={styles.projectKnowledgeLayerHeader}>
          <Typography.Text strong>
            {t("projects.knowledge.layerIndexTitle", "Layer 1: Document Chunking & Indexing")}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t("projects.knowledge.layerIndexDesc", "Raw project files are chunked first. Every chunk keeps source path for bidirectional traceability.")}
          </Typography.Text>
        </div>

        <div className={styles.projectKnowledgeSettingsActions}>
          <Space size={6}>
            <Typography.Text type="secondary">
              {t("projects.knowledge.autoSyncLabel", "Auto Sync")}
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
            onClick={() => {
              void handleManualSink();
            }}
          >
            {t("projects.knowledge.manualSink", "Run Sync")}
          </Button>

          <Button
            size="small"
            type={sourceRegistered ? "default" : "primary"}
            loading={registering}
            onClick={() => {
              void handleRegisterProjectSource();
            }}
          >
            {sourceRegistered
              ? t("projects.knowledge.sourceReindex", "Reindex")
              : t("projects.knowledge.sourceRegister", "Register Source")}
          </Button>
        </div>

        <div className={styles.projectKnowledgeSettingsRowCompact}>
          <Space size={10} className={styles.projectKnowledgeStatsInline}>
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
          </Space>
        </div>

        <div className={styles.projectKnowledgeMetaRowCompact}>
          <Typography.Text type="secondary" ellipsis={{ tooltip: `${t("projects.knowledge.sourceId")} ${projectSourceId}` }}>
            {t("projects.knowledge.sourceId")} {projectSourceId}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t("projects.knowledge.lastIndexed")} {indexedAtLabel}
          </Typography.Text>
        </div>
      </section>

      <Divider className={styles.projectKnowledgeLayerDivider} />

      <section className={styles.projectKnowledgeLayerSection}>
        <div className={styles.projectKnowledgeLayerHeader}>
          <Typography.Text strong>
            {t("projects.knowledge.layerGraphTitle", "Layer 2: Entity & Relation Extraction")}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t("projects.knowledge.layerGraphDesc", "Entities and relations are extracted from chunks, then linked back to source documents.")}
          </Typography.Text>
        </div>

        <div className={styles.projectKnowledgeSettingsActions}>
          <Space size={6}>
            <Typography.Text type="secondary">
              {t("projects.knowledge.memifyLabel", "Entity Extraction")}
            </Typography.Text>
            <Switch
              checked={memifyEnabled}
              loading={memifyUpdating}
              onChange={(checked) => {
                void handleToggleMemify(checked);
              }}
            />
          </Space>
        </div>

        {memifyEnabled ? (
          <div className={styles.projectKnowledgeSettingsRowCompact}>
            <Space size={10} className={styles.projectKnowledgeStatsInline}>
              <Typography.Text type="secondary">
                {t("projects.knowledge.entities", "Entities")}: {memifyStats.nodeCount}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t("projects.knowledge.signalRelations", "Relations")}: {memifyStats.relationCount}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t("projects.knowledge.entityCoverage", "Entity Coverage")}: {entityCoverageLabel}
              </Typography.Text>
            </Space>
          </div>
        ) : null}

        {!memifyStats.hasStats && memifyEnabled ? (
          <Typography.Text type="secondary">
            {t("projects.knowledge.entityStatsHint", "Run a sync once to generate entity and relation stats.")}
          </Typography.Text>
        ) : null}

        {semanticStatus ? (
          <Alert
            type={semanticAlertType}
            showIcon
            message={`${t("projects.knowledge.semanticEngineStatus", "Semantic Engine")}: ${semanticReasonLabel}`}
            description={(
              <div>
                <div>{semanticDescription}</div>
                {showSidecarHint ? (
                  <div style={{ marginTop: 8 }}>
                    <Typography.Text strong>
                      {t("projects.knowledge.semanticSidecarHintTitle", "HanLP sidecar setup")}
                    </Typography.Text>
                    <div style={{ marginTop: 4 }}>
                      {semanticSidecarHint.map((line) => (
                        <div key={line}>
                          <Typography.Text type="secondary">{line}</Typography.Text>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          />
        ) : null}
      </section>

      <details className={styles.projectKnowledgeCompatDetails}>
        <summary className={styles.projectKnowledgeCompatSummary}>
          {t("projects.knowledge.compatSettingsTitle", "Compatibility Settings")}
        </summary>
        <div className={styles.projectKnowledgeCompatBody}>
          <Checkbox
            checked={includeGlobal}
            onChange={(event) => onIncludeGlobalChange(event.target.checked)}
          >
            {t("projects.knowledge.includeGlobal", "Include global knowledge during query")}
          </Checkbox>
          <Typography.Text type="secondary">
            {t("projects.knowledge.includeGlobalHint", "This option affects query scope and will be moved to query controls in a later iteration.")}
          </Typography.Text>
        </div>
      </details>

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

      {syncState && Boolean(syncState.last_error) ? (
        <Alert
          type={syncAlertType}
          showIcon
          message={t("projects.knowledge.sinkJob", "Knowledge Sync")}
          description={syncAlertDescription}
        />
      ) : null}
    </div>
  );
}
