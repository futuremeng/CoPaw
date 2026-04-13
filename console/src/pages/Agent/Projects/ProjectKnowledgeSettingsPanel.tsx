import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
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
              : t("projects.knowledge.settingsHint", "Control project knowledge registration and sync behavior.")}
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

      <div className={styles.projectKnowledgeSettingsActions}>
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

        <Button
          size="small"
          loading={manualSinking}
          onClick={() => {
            void handleManualSink();
          }}
        >
          {t("projects.knowledge.manualSink")}
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
            ? t("projects.knowledge.sourceReindex")
            : t("projects.knowledge.sourceRegister")}
        </Button>
      </div>

      <div className={styles.projectKnowledgeSettingsRowCompact}>
        <Checkbox
          checked={includeGlobal}
          onChange={(event) => onIncludeGlobalChange(event.target.checked)}
        >
          {t("projects.knowledge.includeGlobal")}
        </Checkbox>

        {sourceRegistered ? (
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
        ) : null}
      </div>

      <div className={styles.projectKnowledgeMetaRowCompact}>
        <Typography.Text type="secondary" ellipsis={{ tooltip: `${t("projects.knowledge.sourceId")} ${projectSourceId}` }}>
          {t("projects.knowledge.sourceId")} {projectSourceId}
        </Typography.Text>
        <Typography.Text type="secondary">
          {t("projects.knowledge.lastIndexed")} {indexedAtLabel}
        </Typography.Text>
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
