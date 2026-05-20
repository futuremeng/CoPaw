import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Badge,
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

interface ProjectKnowledgeSettingsPanelProps {
  agentId?: string;
  projectId: string;
  projectName: string;
  projectWorkspaceDir: string;
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
    projectName,
    projectWorkspaceDir,
    projectAutoKnowledgeSink,
    syncState,
    onProjectAutoKnowledgeSinkChange,
  } = props;

  const [updatingAutoSink, setUpdatingAutoSink] = useState(false);
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
    const location = (projectWorkspaceDir || "").trim();
    if (enabled && !location) {
      message.error(t("copaw.projects.knowledge.sourcePathMissing"));
      return;
    }

    try {
      setUpdatingRegistration(true);
      if (enabled) {
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
        await api.indexKnowledgeSource(projectSourceId, { projectId });
        message.success(t("copaw.projects.knowledge.sourceRegisterSuccess"));
      } else {
        await api.deleteKnowledgeSource(projectSourceId, { projectId });
        message.success(
          t(
            "copaw.projects.knowledge.sourceUnregisterSuccess",
            "Project knowledge source unregistered",
          ),
        );
      }
      await loadProjectSourceStatus();
    } catch (err) {
      const messageText = err instanceof Error
        ? err.message
        : t(
          "copaw.projects.knowledge.sourceRegistrationUpdateFailed",
          "Failed to update project knowledge registration",
        );
      message.error(messageText);
    } finally {
      setUpdatingRegistration(false);
    }
  }, [
    loadProjectSourceStatus,
    projectId,
    projectName,
    projectSourceId,
    projectWorkspaceDir,
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

  return (
    <div className={styles.projectKnowledgeWorkbench}>
      <div>
        <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
          {t("projects.knowledgeDock.tabSettings", "Settings")}
        </Typography.Title>
        <Typography.Text type="secondary">
          {t(
            "copaw.projects.knowledge.settingsCoreHint",
            "Only two controls are kept here: auto workflow for new source files, and project knowledge registration for RAG chunk queries.",
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
                  "Auto workflow for new source files",
                )}
              </Typography.Text>
              <br />
              <Typography.Text type="secondary">
                {t(
                  "copaw.projects.knowledge.autoWorkflowDesc",
                  "Default OFF. When enabled, only newly added source files in this project trigger processing.",
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
                  "Register as agent knowledge source",
                )}
              </Typography.Text>
              <br />
              <Typography.Text type="secondary">
                {t(
                  "copaw.projects.knowledge.registerAsAgentKnowledgeDesc",
                  "Default OFF. When enabled, this project's chunks are included in RAG knowledge queries.",
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
