import { Button, Progress, Tag, Tooltip, Typography } from "antd";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";
import type {
  ProjectKnowledgeModeState,
  ProjectKnowledgeState,
} from "./useProjectKnowledgeState";
import {
  getProjectKnowledgeModeLabel,
  getProjectKnowledgeModeRouteHint,
  getProjectKnowledgeSemanticSummary,
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
  const semanticEngine = knowledgeState.syncState?.semantic_engine;
  if (
    mode.mode === "nlp"
    && semanticEngine
    && semanticEngine.status !== "ready"
    && getProjectKnowledgeSemanticSummary(semanticEngine, t)
  ) {
    return getProjectKnowledgeSemanticSummary(semanticEngine, t);
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

function actionLabel(
  mode: ProjectKnowledgeModeState["mode"],
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (mode === "nlp") {
    return t("projects.knowledge.processing.runNlp", "运行 NLP 结构化");
  }
  return t("projects.knowledge.processing.runAgentic", "运行多智能体");
}

export default function ProjectKnowledgeProcessingPanel(
  props: ProjectKnowledgeProcessingPanelProps,
) {
  const { t } = useTranslation();
  const launchMode = props.knowledgeState.processingLaunchMode;
  const visibleModes = props.knowledgeState.processingCompareModes;
  const l2Mode = visibleModes.find((mode) => mode.mode === "nlp") || null;
  const l3Mode = visibleModes.find((mode) => mode.mode === "agentic") || null;
  const l2Output = l2Mode ? props.knowledgeState.modeOutputs[l2Mode.mode] : null;
  const l3Output = l3Mode ? props.knowledgeState.modeOutputs[l3Mode.mode] : null;
  const { entityDelta, relationDelta } = props.knowledgeState.processingCompareDelta;

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
              "这里只展示 L2 与 L3 的处理进度，重点聚焦实体与关系的构建、增强与呈现。",
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

      <div className={styles.projectKnowledgeSignalGrid}>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.processing.l2Entities", "L2 实体数")}</Typography.Text>
          <Typography.Text strong>{l2Mode?.entityCount || 0}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.processing.l2Relations", "L2 关系数")}</Typography.Text>
          <Typography.Text strong>{l2Mode?.relationCount || 0}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.processing.l3Entities", "L3 实体数")}</Typography.Text>
          <Typography.Text strong>{l3Mode?.entityCount || 0}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.processing.l3Relations", "L3 关系数")}</Typography.Text>
          <Typography.Text strong>{l3Mode?.relationCount || 0}</Typography.Text>
        </div>
      </div>

      <div className={styles.projectKnowledgeProcessingCompareGrid}>
        {visibleModes.map((mode) => {
          const disabledReason = launchDisabledReason(mode, props.knowledgeState, t);
          const launchDisabled = Boolean(disabledReason) && launchMode !== mode.mode;
          const progress = typeof mode.progress === "number"
            ? mode.progress
            : mode.status === "ready"
              ? 100
              : mode.status === "queued"
                ? 0
                : null;
          const isL3 = mode.mode === "agentic";
          const output = props.knowledgeState.modeOutputs[mode.mode];
          const highlightValue = isL3
            ? mode.qualityScore != null
              ? `${Math.round(mode.qualityScore * 100)}%`
              : t("projects.knowledge.processing.qualityPending", "待增强")
            : t("projects.knowledge.processing.structureReady", "结构化基线");

          return (
            <div
              key={mode.mode}
              className={`${styles.projectKnowledgeModeCard} ${styles.projectKnowledgeProcessingCompareCard}`}
            >
              <div className={styles.projectKnowledgeModeHeader}>
                <div>
                  <Typography.Text strong>{getProjectKnowledgeModeLabel(mode.mode, t)}</Typography.Text>
                  <div className={styles.projectKnowledgeModeMeta}>
                    <Tag color={statusColor(mode.status)}>{statusLabel(mode.status, t)}</Tag>
                    <Tag>{isL3 ? "L3" : "L2"}</Tag>
                  </div>
                </div>
                <Typography.Text type="secondary">
                  {isL3
                    ? t("projects.knowledge.processing.compareL3Label", "多智能体增强")
                    : t("projects.knowledge.processing.compareL2Label", "实体关系抽取")}
                </Typography.Text>
              </div>

              <Typography.Text type="secondary">{getProjectKnowledgeModeRouteHint(mode.mode, t)}</Typography.Text>

              {progress !== null ? (
                <Progress percent={progress} size="small" status={mode.status === "failed" ? "exception" : mode.status === "ready" ? "success" : "active"} />
              ) : null}

              <div className={styles.projectKnowledgeModeDetails}>
                <Typography.Text>{mode.stage}</Typography.Text>
                {mode.lastUpdatedAt ? (
                  <Typography.Text type="secondary">
                    {t("projects.knowledge.runtimeStatusUpdatedAt", "Updated")}: {mode.lastUpdatedAt}
                  </Typography.Text>
                ) : null}
                {isL3 && mode.runId ? (
                  <Typography.Text type="secondary">Run: {mode.runId}</Typography.Text>
                ) : null}
              </div>

              <div className={styles.projectKnowledgeModeMetrics}>
                <div className={styles.projectKnowledgeModeMetric}>
                  <Typography.Text type="secondary">{t("projects.knowledge.entities", "实体数")}</Typography.Text>
                  <Typography.Text strong>{mode.entityCount}</Typography.Text>
                </div>
                <div className={styles.projectKnowledgeModeMetric}>
                  <Typography.Text type="secondary">{t("projects.knowledge.signalRelations", "关系数")}</Typography.Text>
                  <Typography.Text strong>{mode.relationCount}</Typography.Text>
                </div>
                <div className={styles.projectKnowledgeModeMetric}>
                  <Typography.Text type="secondary">
                    {isL3
                      ? t("projects.knowledge.processing.qualityScore", "质量分")
                      : t("projects.knowledge.processing.processingFocus", "处理焦点")}
                  </Typography.Text>
                  <Typography.Text strong>{highlightValue}</Typography.Text>
                </div>
                <div className={styles.projectKnowledgeModeMetric}>
                  <Typography.Text type="secondary">
                    {isL3
                      ? t("projects.knowledge.processing.enhancementDelta", "相对 L2 增量")
                      : t("projects.knowledge.processing.artifactSummary", "核心产物")}
                  </Typography.Text>
                  <Typography.Text strong>
                    {isL3
                      ? t("projects.knowledge.processing.deltaSummary", "+{{entities}} 实体 / +{{relations}} 关系", {
                        entities: entityDelta,
                        relations: relationDelta,
                      })
                      : output?.artifacts?.[0]?.label || t("projects.knowledge.processing.entityGraphArtifact", "实体关系图谱")}
                  </Typography.Text>
                </div>
              </div>

              <Typography.Paragraph type="secondary" className={styles.projectKnowledgeModeSummary}>
                {mode.summary}
              </Typography.Paragraph>

              {output?.artifacts?.length ? (
                <div className={styles.projectKnowledgeProcessingArtifacts}>
                  {output.artifacts.slice(0, 2).map((artifact) => (
                    <Tag key={`${mode.mode}-${artifact.path}`} bordered={false}>
                      {artifact.label}
                    </Tag>
                  ))}
                </div>
              ) : null}

              <div className={styles.projectKnowledgeProcessingCardFooter}>
                <Tooltip title={launchDisabled ? disabledReason : ""}>
                  <span title={launchDisabled ? disabledReason : undefined}>
                    <Button
                      size="small"
                      type="default"
                      loading={launchMode === mode.mode}
                      disabled={launchDisabled}
                      onClick={() => void props.knowledgeState.startProcessingMode(mode.mode)}
                    >
                      {actionLabel(mode.mode, t)}
                    </Button>
                  </span>
                </Tooltip>
                {disabledReason ? (
                  <Typography.Text type="secondary">{disabledReason}</Typography.Text>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {(l2Output || l3Output) ? (
        <div className={styles.projectKnowledgeProcessingCompareNote}>
          <Typography.Text type="secondary">
            {t(
              "projects.knowledge.processing.compareNote",
              "L2 提供实体与关系的结构化基础，L3 在此基础上继续做多智能体增强与质量提升。",
            )}
          </Typography.Text>
        </div>
      ) : null}
    </div>
  );
}