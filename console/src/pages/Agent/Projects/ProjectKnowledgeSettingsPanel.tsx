import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Space,
  Switch,
  Typography,
  message,
} from "antd";
import api from "../../../api";
import type { KnowledgeSourceItem } from "../../../api/types";
import { agentsApi } from "../../../api/modules/agents";
import styles from "./index.module.less";
import { useTranslation } from "react-i18next";

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
  const [memifyJobId, setMemifyJobId] = useState("");
  const [memifyStatus, setMemifyStatus] = useState<string>("");
  const [memifyError, setMemifyError] = useState("");

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
    setAutoSinkEnabled(projectAutoKnowledgeSink !== false);
  }, [projectAutoKnowledgeSink]);

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
        idempotency_key: `${projectId}:manual:${Date.now()}`,
        project_id: projectId,
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
  }, [projectId, projectSourceId, sourceRegistered, t]);

  useEffect(() => {
    if (!memifyJobId) {
      return;
    }
    let disposed = false;
    const timer = window.setInterval(() => {
      void api.getMemifyJobStatus(memifyJobId, { projectId })
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
  }, [loadProjectSourceStatus, memifyJobId, projectId]);

  return (
    <Card
      size="small"
      title={t("projects.knowledgeDock.tabSettings", "Settings")}
      className={styles.projectKnowledgeSettingsCard}
    >
      <div className={styles.projectKnowledgeSettingsRow}>
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

      <div className={styles.projectKnowledgeSettingsRow}>
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
      </div>

      <Checkbox
        checked={includeGlobal}
        onChange={(event) => onIncludeGlobalChange(event.target.checked)}
      >
        {t("projects.knowledge.includeGlobal")}
      </Checkbox>

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

      {memifyJobId ? (
        <Alert
          type={memifyStatus === "failed" ? "error" : "info"}
          showIcon
          message={t("projects.knowledge.sinkJob")}
          description={`${memifyJobId} · ${memifyStatus || "pending"}${memifyError ? ` · ${memifyError}` : ""}`}
        />
      ) : null}
    </Card>
  );
}
