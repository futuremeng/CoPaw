import { Alert, Button, Progress, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";
import type {
  ProjectKnowledgeModeState,
  ProjectKnowledgeState,
} from "./useProjectKnowledgeState";

interface ProjectKnowledgeProcessingPanelProps {
  knowledgeState: ProjectKnowledgeState;
  onOpenSettings?: () => void;
}

function modeLabel(
  mode: ProjectKnowledgeModeState["mode"],
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (mode === "fast") {
    return t("projects.knowledge.processing.fast", "极速模式");
  }
  if (mode === "nlp") {
    return t("projects.knowledge.processing.nlp", "NLP 模式");
  }
  return t("projects.knowledge.processing.agentic", "多智能体模式");
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

  const modeName = (mode: string | null | undefined): string => {
    if (mode === "fast" || mode === "nlp" || mode === "agentic") {
      return modeLabel(mode, t);
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
              "projects.knowledge.processingHint",
              "三条知识加工轨道并行推进，由 CoPaw 统一调度资源；当前消费端会自动选择最佳可用产物。",
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
          "极速模式优先保障预览，NLP 在中等预算下补齐结构化产物，多智能体模式在空闲资源下持续推进；消费端固定按 多智能体 -> NLP -> 极速 自动降级。",
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

      <div className={styles.projectKnowledgeModeGrid}>
        {props.knowledgeState.processingModes.map((mode) => (
          <div
            key={mode.mode}
            className={`${styles.projectKnowledgeModeCard} ${activeMode === mode.mode ? styles.projectKnowledgeModeCardActive : ""}`}
          >
            <div className={styles.projectKnowledgeModeHeader}>
              <div>
                <Typography.Text strong>{modeLabel(mode.mode, t)}</Typography.Text>
                <div className={styles.projectKnowledgeModeMeta}>
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

            <div className={styles.projectKnowledgeModeMetrics}>
              <div className={styles.projectKnowledgeModeMetric}>
                <Typography.Text type="secondary">{t("projects.knowledge.signalDocuments", "Documents")}</Typography.Text>
                <Typography.Text strong>{mode.documentCount}</Typography.Text>
              </div>
              <div className={styles.projectKnowledgeModeMetric}>
                <Typography.Text type="secondary">{t("projects.knowledge.signalChunks", "Chunks")}</Typography.Text>
                <Typography.Text strong>{mode.chunkCount}</Typography.Text>
              </div>
              <div className={styles.projectKnowledgeModeMetric}>
                <Typography.Text type="secondary">{t("projects.knowledge.entities", "Entities")}</Typography.Text>
                <Typography.Text strong>{mode.entityCount}</Typography.Text>
              </div>
              <div className={styles.projectKnowledgeModeMetric}>
                <Typography.Text type="secondary">{t("projects.knowledge.signalRelations", "Relations")}</Typography.Text>
                <Typography.Text strong>{mode.relationCount}</Typography.Text>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}