import { Alert, Button, Progress, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";
import type {
  ProjectKnowledgeModeState,
  ProjectKnowledgeState,
} from "./useProjectKnowledgeState";
import {
  getProjectKnowledgeModeLabel,
  getProjectKnowledgeModeLevel,
  getProjectKnowledgeModeRouteHint,
} from "./projectKnowledgeSyncUi";

interface ProjectKnowledgeProcessingPanelProps {
  knowledgeState: ProjectKnowledgeState;
  onOpenSettings?: () => void;
}

function launchDisabledReason(
  mode: ProjectKnowledgeModeState,
  knowledgeState: ProjectKnowledgeState,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (!knowledgeState.sourceRegistered) {
    return t("projects.knowledge.processing.needSource", "需要先注册项目知识源");
  }
  if (knowledgeState.processingLaunchMode && knowledgeState.processingLaunchMode !== mode.mode) {
    return t("projects.knowledge.processing.otherLaunchInFlight", "另一个模式正在发起，请稍候");
  }
  if (mode.status === "running") {
    return t("projects.knowledge.processing.modeRunning", "当前模式正在运行");
  }
  if (mode.status === "queued") {
    return t("projects.knowledge.processing.modeQueued", "当前模式已在队列中");
  }
  if (mode.mode !== "fast" && !knowledgeState.memifyEnabled) {
    return t("projects.knowledge.processing.needMemify", "需要先在 Settings 中启用实体抽取");
  }
  return "";
}

function statusColor(status: ProjectKnowledgeModeState["status"]): string {
  if (status === "ready") {
    return "success";
  }
  if (status === "running") {
    return "processing";
  }
  if (status === "queued") {
    return "gold";
  }
  if (status === "failed") {
    return "error";
  }
  return "default";
}

function statusLabel(
  status: ProjectKnowledgeModeState["status"],
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (status === "ready") {
    return t("projects.knowledge.processing.statusReady", "就绪");
  }
  if (status === "running") {
    return t("projects.knowledge.processing.statusRunning", "运行中");
  }
  if (status === "queued") {
    return t("projects.knowledge.processing.statusQueued", "排队中");
  }
  if (status === "failed") {
    return t("projects.knowledge.processing.statusFailed", "失败");
  }
  return t("projects.knowledge.processing.statusIdle", "空闲");
}

export default function ProjectKnowledgeProcessingPanel(
  props: ProjectKnowledgeProcessingPanelProps,
) {
  const { t } = useTranslation();
  const activeMode = props.knowledgeState.activeOutputResolution.activeMode;
  const scheduler = props.knowledgeState.processingScheduler;
  const launchMode = props.knowledgeState.processingLaunchMode;

  const modeName = (mode: string | null | undefined): string => {
    if (mode === "fast" || mode === "nlp" || mode === "agentic") {
      return getProjectKnowledgeModeLabel(mode, t);
    }
    return t("projects.knowledge.processing.none", "暂无");
  };

  return (
    <div className={styles.projectKnowledgeWorkbench}>
      <div className={styles.projectKnowledgeTabHeader}>
        <div>
          <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
            {t("projects.knowledgeDock.tabProcessing", "Processing")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t(
              "projects.knowledge.processingRoleHint",
              "这里只展示三层加工路线、调度状态与可运行性，不展示来源清单与最终产物详情。",
            )}
          </Typography.Text>
        </div>
        <div className={styles.projectKnowledgeTabActions}>
          <Button size="small" onClick={() => void props.knowledgeState.loadProjectSourceStatus()}>
            {t("projects.knowledge.actionRefreshSignals", "Refresh")}
          </Button>
          <Button size="small" type="primary" onClick={props.onOpenSettings}>
            {t("projects.knowledge.actionOpenSettings", "Open settings")}
          </Button>
        </div>
      </div>

      <Alert
        type="info"
        showIcon
        message={t("projects.knowledge.processing.schedulerTitle", "统一调度策略")}
        description={t(
          "projects.knowledge.processing.schedulerDescription",
          "三层路线并行推进：L1 极速保障可用预览，L2 NLP 提供结构化图谱，L3 多智能体持续做高质量加工；消费端固定按 L3 -> L2 -> L1 自动降级。",
        )}
      />

      <div className={styles.projectKnowledgeSignalGrid}>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.processing.currentConsumption", "当前消费")}</Typography.Text>
          <Typography.Text strong>{modeName(scheduler.consumptionMode)}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.processing.runningModes", "运行中")}</Typography.Text>
          <Typography.Text strong>{scheduler.runningModes.length > 0 ? scheduler.runningModes.map((mode) => modeName(mode)).join(" / ") : t("projects.knowledge.processing.none", "暂无")}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.processing.queuedModes", "排队中")}</Typography.Text>
          <Typography.Text strong>{scheduler.queuedModes.length > 0 ? scheduler.queuedModes.map((mode) => modeName(mode)).join(" / ") : t("projects.knowledge.processing.none", "暂无")}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.processing.nextMode", "下一优先")}</Typography.Text>
          <Typography.Text strong>{modeName(scheduler.nextMode)}</Typography.Text>
        </div>
      </div>

      <Alert
        type="info"
        showIcon
        message={t("projects.knowledge.processing.schedulerRuntimeTitle", "当前调度状态")}
        description={scheduler.reason}
      />

      <div className={styles.projectKnowledgeProcessingStack}>
        {props.knowledgeState.processingModes.map((mode) => (
          (() => {
            const disabledReason = launchDisabledReason(mode, props.knowledgeState, t);
            const launchDisabled = Boolean(disabledReason) && launchMode !== mode.mode;
            return (
          <div
            key={mode.mode}
            className={`${styles.projectKnowledgeModeCard} ${styles.projectKnowledgeProcessingLane} ${activeMode === mode.mode ? styles.projectKnowledgeModeCardActive : ""}`}
          >
            <div className={styles.projectKnowledgeModeHeader}>
              <div>
                <Typography.Text strong>{getProjectKnowledgeModeLabel(mode.mode, t)}</Typography.Text>
                <div className={styles.projectKnowledgeModeMeta}>
                  <Tag>{getProjectKnowledgeModeLevel(mode.mode)}</Tag>
                  <Tag color={statusColor(mode.status)}>{statusLabel(mode.status, t)}</Tag>
                  {activeMode === mode.mode ? (
                    <Tag color="blue">{t("projects.knowledge.outputs.currentSource", "当前消费来源")}</Tag>
                  ) : null}
                </div>
              </div>
              <Typography.Text type="secondary">
                {mode.available
                  ? t("projects.knowledge.processing.available", "可用")
                  : t("projects.knowledge.processing.unavailable", "未就绪")}
              </Typography.Text>
            </div>

            <Typography.Text type="secondary">{getProjectKnowledgeModeRouteHint(mode.mode, t)}</Typography.Text>

            <Typography.Paragraph type="secondary" className={styles.projectKnowledgeModeSummary}>
              {mode.summary}
            </Typography.Paragraph>

            {typeof mode.progress === "number" ? (
              <Progress percent={mode.progress} size="small" status={mode.status === "failed" ? "exception" : "active"} />
            ) : null}

            <div className={styles.projectKnowledgeModeDetails}>
              <Typography.Text type="secondary">{mode.stage}</Typography.Text>
              {mode.lastUpdatedAt ? (
                <Typography.Text type="secondary">
                  {t("projects.knowledge.runtimeStatusUpdatedAt", "Updated")}: {mode.lastUpdatedAt}
                </Typography.Text>
              ) : null}
              {mode.runId ? (
                <Typography.Text type="secondary">Run: {mode.runId}</Typography.Text>
              ) : null}
              {mode.jobId ? (
                <Typography.Text type="secondary">Job: {mode.jobId}</Typography.Text>
              ) : null}
            </div>

            <div className={styles.projectKnowledgeTabActions}>
              <Button
                size="small"
                type={mode.mode === activeMode ? "primary" : "default"}
                loading={launchMode === mode.mode}
                disabled={launchDisabled}
                onClick={() => void props.knowledgeState.startProcessingMode(mode.mode)}
              >
                {mode.mode === "fast"
                  ? t("projects.knowledge.processing.runFast", "运行极速预览")
                  : mode.mode === "nlp"
                    ? t("projects.knowledge.processing.runNlp", "运行 NLP 结构化")
                    : t("projects.knowledge.processing.runAgentic", "运行多智能体")}
              </Button>
            </div>

            {disabledReason ? (
              <Typography.Text type="secondary">{disabledReason}</Typography.Text>
            ) : null}
          </div>
            );
          })()
        ))}
      </div>
    </div>
  );
}