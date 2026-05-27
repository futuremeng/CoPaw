import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Space,
  Switch,
  Typography,
  message,
} from "antd";
import api from "../../../../api";
import type { KnowledgeSourceItem, ProjectKnowledgePipelineState } from "../../../../api/types";
import { agentsApi } from "../../../../api/modules/agents";
import styles from "../index.module.less";
import { useTranslation } from "react-i18next";
import {
  getProjectKnowledgePipelineAlertDescription,
  getProjectKnowledgePipelineAlertType,
} from "../utils/projectKnowledgePipelineUi";
import { parseErrorDetail } from "../../../../utils/error";

interface ProjectKnowledgeSettingsPanelProps {
  agentId?: string;
  projectId: string;
  projectAutoKnowledgeSink: boolean;
  syncState: ProjectKnowledgePipelineState | null;
  onProjectAutoKnowledgeSinkChange?: (enabled: boolean) => void;
}

export default function ProjectKnowledgeSettingsPanel(
  props: ProjectKnowledgeSettingsPanelProps,
) {
  const { t } = useTranslation();
  const {
    agentId,
    projectId,
    projectAutoKnowledgeSink,
    syncState,
    onProjectAutoKnowledgeSinkChange,
  } = props;

  const [updatingAutoSink, setUpdatingAutoSink] = useState(false);
  const [runningFlowCommand, setRunningFlowCommand] = useState<"pause" | "resume" | "cancel" | "">("");
  const [autoSinkEnabled, setAutoSinkEnabled] = useState(
    projectAutoKnowledgeSink !== false,
  );
  const [updatingRegistration, setUpdatingRegistration] = useState(false);
  const [sourceLoaded, setSourceLoaded] = useState(false);
  const [sourceRegistered, setSourceRegistered] = useState(false);
  const [projectSource, setProjectSource] = useState<KnowledgeSourceItem | null>(null);

  const projectSourceId = useMemo(() => {
    const safeId = projectId
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return `project-${safeId || "default"}-workspace`;
  }, [projectId]);

  const loadProjectSourceStatus = useCallback(async () => {
    try {
      const response = await api.listKnowledgeSources({ projectId });
      const matched = response.sources.find((source) => source.id === projectSourceId) || null;
      setProjectSource(matched);
      setSourceRegistered(Boolean(matched));
    } catch {
      setProjectSource(null);
      setSourceRegistered(false);
    } finally {
      setSourceLoaded(true);
    }
  }, [projectId, projectSourceId]);

  useEffect(() => {
    void loadProjectSourceStatus();
  }, [loadProjectSourceStatus]);

  useEffect(() => {
    setAutoSinkEnabled(projectAutoKnowledgeSink !== false);
  }, [projectAutoKnowledgeSink]);

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

  const handleToggleAutoSink = useCallback(async (enabled: boolean) => {
    if (!agentId) {
      message.error(t("copaw.projects.knowledge.autoSinkAgentMissing"));
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
          ? t("copaw.projects.knowledge.autoSinkEnabled")
          : t("copaw.projects.knowledge.autoSinkDisabled"),
      );
    } catch (err) {
      const messageText = err instanceof Error
        ? err.message
        : t("copaw.projects.knowledge.autoSinkUpdateFailed");
      message.error(messageText);
    } finally {
      setUpdatingAutoSink(false);
    }
  }, [agentId, onProjectAutoKnowledgeSinkChange, projectId, t]);

  const handleToggleKnowledgeRegistration = useCallback(async (enabled: boolean) => {
    if (!agentId) {
      message.error(t("copaw.projects.knowledge.autoSinkAgentMissing"));
      return;
    }

    const previousRegistered = sourceRegistered;
    const previousSource = projectSource;
    setSourceRegistered(enabled);
    if (!enabled) {
      setProjectSource(null);
    }

    try {
      setUpdatingRegistration(true);
      await agentsApi.updateProjectKnowledgeRegistration(agentId, projectId, {
        project_agent_knowledge_registered: enabled,
      });
      message.success(
        enabled
          ? t("copaw.projects.knowledge.sourceRegisterSuccess")
          : t(
            "copaw.projects.knowledge.sourceUnregisterSuccess",
            "Project knowledge source unregistered",
          ),
      );
      await loadProjectSourceStatus();
    } catch (err) {
      const messageText = err instanceof Error
        ? err.message
        : t(
          "copaw.projects.knowledge.sourceRegistrationUpdateFailed",
          "Failed to update project knowledge registration",
        );
      const endpointUnavailable = /404|405|not\s*found|knowledge-registration/i.test(messageText);
      if (!enabled && endpointUnavailable) {
        try {
          await api.deleteKnowledgeSource(projectSourceId, { projectId });
          message.success(
            t(
              "copaw.projects.knowledge.sourceUnregisterSuccess",
              "Project knowledge source unregistered",
            ),
          );
          await loadProjectSourceStatus();
          return;
        } catch {
          // fall through to unified error handling
        }
      }

      setSourceRegistered(previousRegistered);
      setProjectSource(previousSource);
      message.error(messageText);
    } finally {
      setUpdatingRegistration(false);
    }
  }, [
    agentId,
    loadProjectSourceStatus,
    projectSource,
    projectSourceId,
    projectId,
    sourceRegistered,
    t,
  ]);

  const syncAlertType = useMemo(
    () => getProjectKnowledgePipelineAlertType(syncState),
    [syncState],
  );

  const syncAlertDescription = useMemo(() => {
    if (!syncState) {
      return "";
    }
    return getProjectKnowledgePipelineAlertDescription(syncState, t);
  }, [syncState, t]);

  const flowRunId = String(syncState?.flow_run_id || "").trim();
  const recentControlCommand = String(syncState?.recent_control_command || "").trim().toLowerCase();

  const handleFlowCommand = useCallback(async (commandType: "pause" | "resume" | "cancel") => {
    setRunningFlowCommand(commandType);
    try {
      await api.commandProjectKnowledgePipeline({
        projectId,
        commandType,
        payload: { reason: "project-settings-panel" },
      });
      message.success(
        commandType === "pause"
          ? t("copaw.projects.knowledge.control.pauseSuccess", "Pipeline paused")
          : commandType === "resume"
            ? t("copaw.projects.knowledge.control.resumeSuccess", "Pipeline resumed")
            : t("copaw.projects.knowledge.control.cancelSuccess", "Pipeline cancelled"),
      );
    } catch (err) {
      const detail = parseErrorDetail(err) as { message?: unknown; recovery_hint?: unknown; error_code?: unknown } | null;
      const messageText = String(detail?.message || (err instanceof Error ? err.message : "")).trim()
        || t("copaw.projects.knowledge.control.commandFailed", "Pipeline control command failed");
      const recoveryHint = String(detail?.recovery_hint || "").trim();
      const errorCode = String(detail?.error_code || "").trim();
      message.error(
        recoveryHint
          ? `${messageText} (${recoveryHint})`
          : errorCode
            ? `${messageText} (${errorCode})`
            : messageText,
      );
    } finally {
      setRunningFlowCommand("");
    }
  }, [projectId, t]);

  return (
    <div className={styles.projectKnowledgeWorkbench}>
      <div>
        <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
          {t("projects.knowledgeDock.tabSettings", "Settings")}
        </Typography.Title>
        <Typography.Text type="secondary">
          {t(
            "copaw.projects.knowledge.settingsCoreHint",
            "Only two controls are kept here: document processing for new source files, and project document registration for RAG chunk queries.",
          )}
        </Typography.Text>
      </div>

      <section className={styles.projectKnowledgeLayerSection}>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Space align="start" style={{ justifyContent: "space-between", width: "100%" }}>
            <div>
              <Typography.Text strong>
                {t(
                  "copaw.projects.knowledge.autoWorkflowTitle",
                  "Auto document workflow for new source files",
                )}
              </Typography.Text>
              <br />
              <Typography.Text type="secondary">
                {t(
                  "copaw.projects.knowledge.autoWorkflowDesc",
                  "Default OFF. When enabled, only newly added document files in this project trigger processing.",
                )}
              </Typography.Text>
            </div>
            <Switch
              checked={autoSinkEnabled}
              loading={updatingAutoSink}
              onChange={(checked) => {
                void handleToggleAutoSink(checked);
              }}
            />
          </Space>

          <Space align="start" style={{ justifyContent: "space-between", width: "100%" }}>
            <div>
              <Typography.Text strong>
                {t(
                  "copaw.projects.knowledge.registerAsAgentKnowledgeTitle",
                  "Register as project document source",
                )}
              </Typography.Text>
              <br />
              <Typography.Text type="secondary">
                {t(
                  "copaw.projects.knowledge.registerAsAgentKnowledgeDesc",
                  "Default OFF. When enabled, this project's document chunks are included in RAG knowledge queries.",
                )}
              </Typography.Text>
            </div>
            <Switch
              checked={sourceRegistered}
              loading={updatingRegistration}
              onChange={(checked) => {
                void handleToggleKnowledgeRegistration(checked);
              }}
            />
          </Space>

          <Badge
            status={sourceRegistered ? "success" : "default"}
            text={
              sourceLoaded
                ? sourceRegistered
                  ? t("copaw.projects.knowledge.sourceRegistered")
                  : t("copaw.projects.knowledge.sourceNotRegistered")
                : t("common.loading", "Loading")
            }
          />

          <Typography.Text type="secondary">
            {t("copaw.projects.knowledge.sourceId")} {projectSource?.id || projectSourceId}
          </Typography.Text>

          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Typography.Text strong>
              {t("copaw.projects.knowledge.control.title", "Pipeline control")}
            </Typography.Text>
            <Typography.Text type="secondary">
              {flowRunId
                ? t(
                  "copaw.projects.knowledge.control.flowRunLabel",
                  `Flow run: ${flowRunId}`,
                )
                : t(
                  "copaw.projects.knowledge.control.flowRunMissing",
                  "Flow run id is not available yet. Commands may fail until a run is bridged.",
                )}
            </Typography.Text>
            <Space wrap>
              <Button
                onClick={() => {
                  void handleFlowCommand("pause");
                }}
                loading={runningFlowCommand === "pause"}
                disabled={runningFlowCommand !== "" || recentControlCommand === "pause"}
              >
                {t("copaw.projects.knowledge.control.pause", "Pause")}
              </Button>
              <Button
                onClick={() => {
                  void handleFlowCommand("resume");
                }}
                loading={runningFlowCommand === "resume"}
                disabled={runningFlowCommand !== "" || recentControlCommand === "resume"}
              >
                {t("copaw.projects.knowledge.control.resume", "Resume")}
              </Button>
              <Button
                danger
                onClick={() => {
                  void handleFlowCommand("cancel");
                }}
                loading={runningFlowCommand === "cancel"}
                disabled={runningFlowCommand !== "" || recentControlCommand === "cancel"}
              >
                {t("copaw.projects.knowledge.control.cancel", "Cancel")}
              </Button>
            </Space>
          </Space>
        </Space>
      </section>

      {syncState && Boolean(syncState.last_error) ? (
        <Alert
          type={syncAlertType}
          showIcon
          message={t("copaw.projects.knowledge.pipelineJob")}
          description={syncAlertDescription}
        />
      ) : null}
    </div>
  );
}
