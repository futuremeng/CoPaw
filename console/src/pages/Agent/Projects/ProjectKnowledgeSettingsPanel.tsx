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
import { useNavigate } from "react-router-dom";
import api from "../../../api";
import type { KnowledgeSourceItem, ProjectKnowledgeSyncState } from "../../../api/types";
import { agentsApi } from "../../../api/modules/agents";
import { knowledgeApi } from "../../../api/modules/knowledge";
import styles from "./index.module.less";
import { useTranslation } from "react-i18next";
import {
  getProjectKnowledgeQuantizationStage,
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
  syncState: ProjectKnowledgeSyncState | null;
  onIncludeGlobalChange: (checked: boolean) => void;
  onProjectAutoKnowledgeSinkChange?: (enabled: boolean) => void;
}

export default function ProjectKnowledgeSettingsPanel(
  props: ProjectKnowledgeSettingsPanelProps,
) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    agentId,
    projectId,
    projectName,
    projectWorkspaceDir,
    projectAutoKnowledgeSink,
    includeGlobal,
    syncState,
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
      message.error(t("copaw.projects.knowledge.sourcePathMissing"));
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
      message.success(t("copaw.projects.knowledge.sourceRegisterSuccess"));
      await loadProjectSourceStatus();
    } catch (err) {
      const messageText =
        err instanceof Error ? err.message : t("copaw.projects.knowledge.sourceRegisterFailed");
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
      message.success(t("copaw.projects.knowledge.retryIndexSuccess"));
      await loadProjectSourceStatus();
    } catch (err) {
      const messageText =
        err instanceof Error ? err.message : t("copaw.projects.knowledge.retryIndexFailed");
      message.error(messageText);
    } finally {
      setRetrying(false);
    }
  }, [loadProjectSourceStatus, projectId, projectSourceId, t]);

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
      const messageText = err instanceof Error ? err.message : t("copaw.projects.knowledge.autoSinkUpdateFailed");
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
          ? t("copaw.projects.knowledge.memifyEnabled")
          : t("copaw.projects.knowledge.memifyDisabled"),
      );
      if (enabled && (projectWorkspaceDir || "").trim()) {
        try {
          await api.runProjectKnowledgeSync({
            projectId,
            trigger: "memify-enabled",
            force: true,
            processingMode: "nlp",
            quantizationStage: getProjectKnowledgeQuantizationStage("nlp"),
          });
          // syncState will be updated via WebSocket in the hook
        } catch {
          // best-effort: sync trigger failure is non-fatal
        }
      }
    } catch (err) {
      const messageText = err instanceof Error ? err.message : t("copaw.projects.knowledge.memifyUpdateFailed");
      message.error(messageText);
    } finally {
      setMemifyUpdating(false);
    }
  }, [projectId, projectWorkspaceDir, t]);

  const handleManualSink = useCallback(async () => {
    if (!(projectWorkspaceDir || "").trim()) {
      message.error(t("copaw.projects.knowledge.sourcePathMissing"));
      return;
    }
    try {
      setManualSinking(true);
      await api.runProjectKnowledgeSync({
        projectId,
        trigger: "manual-panel",
        force: true,
        processingMode: "agentic",
        quantizationStage: getProjectKnowledgeQuantizationStage("agentic"),
      });
      // syncState will be updated via WebSocket in the hook
      message.success(t("copaw.projects.knowledge.manualSinkStarted"));
    } catch (err) {
      const messageText = err instanceof Error ? err.message : t("copaw.projects.knowledge.manualSinkFailed");
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

  const syncOperationSummary = useMemo(() => {
    if (!syncState) {
      return null;
    }
    const operationId = String(syncState.operation_id || "").trim();
    const idempotencyKey = String(syncState.idempotency_key || "").trim();
    if (!operationId && !idempotencyKey) {
      return null;
    }
    const deduplicated = syncState.deduplicated === true;
    const action = String(syncState.last_action || "").trim();
    const quantizationStage = String(syncState.quantization_stage || "").trim().toUpperCase();
    const updatedAtRaw = String(syncState.operation_updated_at || "").trim();
    let updatedAt = "";
    if (updatedAtRaw) {
      const parsed = new Date(updatedAtRaw);
      if (Number.isNaN(parsed.getTime())) {
        updatedAt = updatedAtRaw;
      } else {
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, "0");
        const d = String(parsed.getDate()).padStart(2, "0");
        const hh = String(parsed.getHours()).padStart(2, "0");
        const mm = String(parsed.getMinutes()).padStart(2, "0");
        const ss = String(parsed.getSeconds()).padStart(2, "0");
        updatedAt = `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
      }
    }
    return {
      operationId,
      idempotencyKey,
      deduplicated,
      action,
      quantizationStage,
      updatedAt,
    };
  }, [syncState]);

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
  const showSidecarHint = semanticReasonCode.startsWith("HANLP_SIDECAR_");
  const semanticSidecarHint = useMemo(() => {
    if (!showSidecarHint) {
      return [] as string[];
    }
    return [
      t("copaw.projects.knowledge.semanticSidecarHintEnable"),
      t("copaw.projects.knowledge.semanticSidecarHintInstall"),
      t("copaw.projects.knowledge.semanticSidecarHintOffline"),
      t("copaw.projects.knowledge.semanticSidecarHintVerify"),
    ];
  }, [showSidecarHint, t]);

  return (
    <div className={styles.projectKnowledgeWorkbench}>
      <div>
        <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
          {t("projects.knowledgeDock.tabSettings", "Settings")}
        </Typography.Title>
        <Typography.Text type="secondary">
          {syncState?.status && syncState.status !== "idle"
            ? syncAlertDescription
            : t("copaw.projects.knowledge.settingsHint")}
        </Typography.Text>
      </div>
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

      <section className={styles.projectKnowledgeLayerSection}>
        <div className={styles.projectKnowledgeLayerHeader}>
          <Typography.Text strong>
            {t("copaw.projects.knowledge.layerIndexTitle")}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t("copaw.projects.knowledge.layerIndexDesc")}
          </Typography.Text>
        </div>

        <div className={styles.projectKnowledgeSettingsActions}>
          <Space size={6}>
            <Typography.Text type="secondary">
              {t("copaw.projects.knowledge.autoSyncLabel")}
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
            {t("copaw.projects.knowledge.manualSink")}
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
              ? t("copaw.projects.knowledge.sourceReindex")
              : t("copaw.projects.knowledge.sourceRegister")}
          </Button>
        </div>

        <Typography.Text type="secondary">{t("copaw.projects.knowledge.sourceVisibilityHint")}</Typography.Text>

        <div className={styles.projectKnowledgeSettingsRowCompact}>
          <Space size={10} className={styles.projectKnowledgeStatsInline}>
            <Typography.Text type="secondary">
              {t("copaw.projects.knowledge.docCount", {
                count: projectSource?.status?.document_count ?? 0,
              })}
            </Typography.Text>
            <Typography.Text type="secondary">
              {t("copaw.projects.knowledge.chunkCount", {
                count: projectSource?.status?.chunk_count ?? 0,
              })}
            </Typography.Text>
          </Space>
        </div>

        <div className={styles.projectKnowledgeMetaRowCompact}>
          <Typography.Text type="secondary" ellipsis={{ tooltip: `${t("copaw.projects.knowledge.sourceId")} ${projectSourceId}` }}>
            {t("copaw.projects.knowledge.sourceId")} {projectSourceId}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t("copaw.projects.knowledge.lastIndexed")} {indexedAtLabel}
          </Typography.Text>
        </div>
      </section>

      <Divider className={styles.projectKnowledgeLayerDivider} />

      <section className={styles.projectKnowledgeLayerSection}>
        <div className={styles.projectKnowledgeLayerHeader}>
          <Typography.Text strong>
            {t("copaw.projects.knowledge.layerGraphTitle")}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t("copaw.projects.knowledge.layerGraphDesc")}
          </Typography.Text>
        </div>

        <div className={styles.projectKnowledgeSettingsActions}>
          <Space size={6}>
            <Typography.Text type="secondary">
              {t("copaw.projects.knowledge.memifyLabel")}
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
                {t("copaw.projects.knowledge.entities")}: {memifyStats.nodeCount}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t("copaw.projects.knowledge.signalRelations")}: {memifyStats.relationCount}
              </Typography.Text>
              <Typography.Text type="secondary">
                {t("copaw.projects.knowledge.entityCoverage")}: {entityCoverageLabel}
              </Typography.Text>
            </Space>
          </div>
        ) : null}

        {!memifyStats.hasStats && memifyEnabled ? (
          <Typography.Text type="secondary">
            {t("copaw.projects.knowledge.entityStatsHint")}
          </Typography.Text>
        ) : null}

        {semanticStatus ? (
          <Alert
            type={semanticAlertType}
            showIcon
            message={`${t("copaw.projects.knowledge.semanticEngineStatus")}: ${semanticReasonLabel}`}
            description={(
              <div>
                <div>{semanticDescription}</div>
                {showSidecarHint ? (
                  <div style={{ marginTop: 8 }}>
                    <Typography.Text strong>
                      {t("copaw.projects.knowledge.semanticSidecarHintTitle")}
                    </Typography.Text>
                    <div style={{ marginTop: 4 }}>
                      {semanticSidecarHint.map((line) => (
                        <div key={line}>
                          <Typography.Text type="secondary">{line}</Typography.Text>
                        </div>
                      ))}
                    </div>
                    <Button
                      type="link"
                      style={{ paddingInline: 0, marginTop: 8 }}
                      onClick={() => navigate("/nlp")}
                    >
                      {t("copaw.projects.knowledge.openNlpSettings")}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          />
        ) : null}
      </section>

      <details className={styles.projectKnowledgeCompatDetails}>
        <summary className={styles.projectKnowledgeCompatSummary}>
          {t("copaw.projects.knowledge.compatSettingsTitle")}
        </summary>
        <div className={styles.projectKnowledgeCompatBody}>
          <Checkbox
            checked={includeGlobal}
            onChange={(event) => onIncludeGlobalChange(event.target.checked)}
          >
            {t("copaw.projects.knowledge.includeGlobal")}
          </Checkbox>
          <Typography.Text type="secondary">
            {t("copaw.projects.knowledge.includeGlobalHint")}
          </Typography.Text>
        </div>
      </details>

      {projectSource?.status?.error ? (
        <Alert
          type="error"
          showIcon
          message={t("copaw.projects.knowledge.indexError")}
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
              {t("copaw.projects.knowledge.retryIndex")}
            </Button>
          }
        />
      ) : null}

      {syncState && Boolean(syncState.last_error) ? (
        <Alert
          type={syncAlertType}
          showIcon
          message={t("copaw.projects.knowledge.sinkJob")}
          description={syncAlertDescription}
        />
      ) : null}

      {syncOperationSummary ? (
        <div className={styles.projectKnowledgeMetaRowCompact}>
          <Typography.Text type="secondary">
            {t("copaw.projects.knowledge.syncOperationId")}: {" "}
            {syncOperationSummary.operationId
              ? (
                <Typography.Text
                  copyable={{ text: syncOperationSummary.operationId }}
                >
                  {syncOperationSummary.operationId}
                </Typography.Text>
              )
              : "-"}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t("copaw.projects.knowledge.syncIdempotencyKey")}: {" "}
            {syncOperationSummary.idempotencyKey
              ? (
                <Typography.Text
                  copyable={{ text: syncOperationSummary.idempotencyKey }}
                >
                  {syncOperationSummary.idempotencyKey}
                </Typography.Text>
              )
              : "-"}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t("copaw.projects.knowledge.syncDeduplicated")}: {syncOperationSummary.deduplicated ? t("common.yes", "Yes") : t("common.no", "No")}
            {syncOperationSummary.action
              ? ` · ${t("copaw.projects.knowledge.syncLastAction")}: ${syncOperationSummary.action}`
              : ""}
            {syncOperationSummary.quantizationStage
              ? ` · ${t("copaw.projects.knowledge.syncQuantizationStage")}: ${syncOperationSummary.quantizationStage}`
              : ""}
          </Typography.Text>
          {syncOperationSummary.updatedAt ? (
            <Typography.Text type="secondary">
              {t("copaw.projects.knowledge.syncOperationUpdatedAt")}: {syncOperationSummary.updatedAt}
            </Typography.Text>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
