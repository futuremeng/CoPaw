import { Button, Progress, Tag, Tooltip, Typography } from "antd";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";
import type {
  ProjectKnowledgeProcessingFreshness,
  ProjectKnowledgeModeState,
  ProjectKnowledgeState,
} from "./useProjectKnowledgeState";
import {
  getProjectKnowledgeModeLabel,
  getProjectKnowledgeModeRouteHint,
  getProjectKnowledgeSemanticSummary,
  prioritizeProjectKnowledgeArtifacts,
} from "./projectKnowledgeSyncUi";

interface ProjectKnowledgeProcessingPanelProps {
  knowledgeState: ProjectKnowledgeState;
  onOpenSettings?: () => void;
}

function modeHasIndependentOutputs(mode: ProjectKnowledgeModeState | null): boolean {
  if (!mode) {
    return false;
  }
  return mode.available || mode.entityCount > 0 || mode.relationCount > 0 || mode.qualityScore != null;
}

function formatModeCountValue(
  mode: ProjectKnowledgeModeState | null,
  value: number,
  t: ReturnType<typeof useTranslation>["t"],
): string | number {
  if (mode?.mode === "agentic" && !modeHasIndependentOutputs(mode)) {
    return t("projects.knowledge.processing.outputPending", "未产出");
  }
  return value;
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
  if (mode.status === "blocked") {
    return mode.summary || mode.stage || t("projects.knowledge.processing.modeBlocked", "当前模式被前置条件阻塞");
  }
  if (mode.mode !== "fast" && !knowledgeState.memifyEnabled) {
    return t("projects.knowledge.processing.needMemify", "需要先在 Settings 中启用实体抽取");
  }
  const semanticEngine = knowledgeState.syncState?.semantic_engine;
  if (
    mode.mode === "nlp"
    && !mode.available
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
  if (status === "blocked") {
    return "orange";
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
  if (status === "blocked") {
    return t("projects.knowledge.processing.statusBlocked", "阻塞中");
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

function describeL1Hint(
  knowledgeState: ProjectKnowledgeState,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (!knowledgeState.sourceRegistered) {
    return t(
      "projects.knowledge.processing.l1HintNeedSource",
      "L1 基础索引尚未注册，请先在 Settings 注册项目知识源。",
    );
  }

  const indexedSources = Math.max(0, knowledgeState.quantMetrics.indexedSources || 0);
  const totalSources = Math.max(0, knowledgeState.quantMetrics.totalSources || 0);
  if (totalSources > 0 && indexedSources < totalSources) {
    return `${t(
      "projects.knowledge.processing.l1HintProgressPrefix",
      "L1 基础索引进度",
    )} ${indexedSources}/${totalSources}，${t(
      "projects.knowledge.processing.l1HintProgressSuffix",
      "详细状态请看 Sources / Signals。",
    )}`;
  }

  return t(
    "projects.knowledge.processing.l1HintReady",
    "L1 基础索引状态请看 Sources / Signals；Processing 这里聚焦 L2 / L3 深加工。",
  );
}

function describeStaleSources(
  freshness: ProjectKnowledgeProcessingFreshness,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (freshness.staleSources.length === 0) {
    return t(
      "projects.knowledge.processing.staleHint",
      "最近 15 秒未收到新的运行快照，当前处理状态可能已过期。",
    );
  }

  const sourceLabels = freshness.staleSources.map((source) => (
    source === "project-sync"
      ? t("projects.knowledge.processing.channelProjectSync", "project-sync 通道")
      : t("projects.knowledge.processing.channelTasks", "tasks 通道")
  ));
  const sourceSummary = sourceLabels.length > 1
    ? sourceLabels.join(" / ")
    : sourceLabels[0];
  const primaryStatus = freshness.channelStatus[freshness.staleSources[0]];
  const statusLabel = primaryStatus === "connecting"
    ? t("projects.knowledge.processing.channelConnecting", "连接中")
    : t("projects.knowledge.processing.channelReconnecting", "重连中");

  return `${sourceSummary}${statusLabel}，${t(
    "projects.knowledge.processing.staleHintSuffix",
    "最近 15 秒未收到新的运行快照，当前处理状态可能已过期。",
  )}`;
}

function describeInlineStaleHint(
  freshness: ProjectKnowledgeProcessingFreshness,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (freshness.staleSources.length === 0) {
    return t(
      "projects.knowledge.processing.staleInlineHint",
      "等待新的运行快照，当前展示可能落后于实际执行状态。",
    );
  }

  const sourceLabels = freshness.staleSources.map((source) => (
    source === "project-sync"
      ? t("projects.knowledge.processing.channelProjectSync", "project-sync 通道")
      : t("projects.knowledge.processing.channelTasks", "tasks 通道")
  ));
  const sourceSummary = sourceLabels.length > 1
    ? sourceLabels.join(" / ")
    : sourceLabels[0];
  const primaryStatus = freshness.channelStatus[freshness.staleSources[0]];
  const statusLabel = primaryStatus === "connecting"
    ? t("projects.knowledge.processing.channelConnecting", "连接中")
    : t("projects.knowledge.processing.channelReconnecting", "重连中");

  return `${sourceSummary}${statusLabel}，${t(
    "projects.knowledge.processing.staleInlineHintSuffix",
    "等待新的运行快照，当前展示可能落后于实际执行状态。",
  )}`;
}

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`;
}

function describeCorBenefit(
  mode: ProjectKnowledgeModeState,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (mode.mode !== "nlp") {
    return "";
  }
  const readyChunks = Math.max(0, Number(mode.corReadyChunkCount || 0));
  const corReasonCode = String(mode.corReasonCode || "").trim();
  const corReason = String(mode.corReason || "").trim();
  const corUnavailable = readyChunks <= 0
    && corReasonCode.length > 0
    && corReasonCode !== "HANLP2_TASK_READY"
    && mode.status !== "running"
    && mode.status !== "queued";
  if (corUnavailable) {
    return t(
      "projects.knowledge.processing.corBenefitUnavailable",
      "COR 不可用：{{reason}}",
      { reason: corReason || corReasonCode },
    );
  }
  if (readyChunks <= 0 && (!mode.available || mode.status === "running" || mode.status === "queued" || mode.status === "blocked")) {
    return t("projects.knowledge.processing.corBenefitPending", "收益评估生成中");
  }
  const replacementCount = Math.max(0, Number(mode.corReplacementCount || 0));
  const totalChunks = Math.max(0, Number(mode.chunkCount || 0));
  const effectiveChunks = Math.max(0, Number(mode.corEffectiveChunkCount || 0));
  const coverage = totalChunks > 0
    ? readyChunks / totalChunks
    : Number(mode.corReadyChunkRatio || 0);
  const hitRatio = readyChunks > 0
    ? effectiveChunks / readyChunks
    : Number(mode.corEffectiveChunkRatio || 0);

  return t(
    "projects.knowledge.processing.corBenefitSummary",
    "+{{replacements}} 次替换 / 覆盖 {{coverage}} / 命中 {{hitRatio}}",
    {
      replacements: replacementCount,
      coverage: formatPercent(coverage),
      hitRatio: formatPercent(hitRatio),
    },
  );
}

function buildNlpStageStats(
  mode: ProjectKnowledgeModeState,
  t: ReturnType<typeof useTranslation>["t"],
): Array<{
  key: string;
  title: string;
  metrics: Array<{ key: string; label: string; value: string | number }>;
}> {
  if (mode.mode !== "nlp") {
    return [];
  }

  const totalChunks = Math.max(
    0,
    Number(mode.l2TotalChunks || mode.chunkCount || 0),
  );
  const stageDoneLabel = t("projects.knowledge.processing.stageDoneChunks", "已处理块数");
  const formatDone = (done: number): string | number => (
    totalChunks > 0 ? `${Math.max(0, done)}/${totalChunks}` : Math.max(0, done)
  );

  return [
    {
      key: "cor",
      title: t("projects.knowledge.processing.corStage", "COR"),
      metrics: [
        {
          key: "doneChunks",
          label: stageDoneLabel,
          value: formatDone(Number(mode.corDoneChunks || mode.corReadyChunkCount || 0)),
        },
        {
          key: "readyChunks",
          label: t("projects.knowledge.processing.readyChunks", "就绪块数"),
          value: mode.corReadyChunkCount || 0,
        },
        {
          key: "clusters",
          label: t("projects.knowledge.processing.corClusters", "聚类数"),
          value: mode.corClusterCount || 0,
        },
        {
          key: "replacements",
          label: t("projects.knowledge.processing.corReplacements", "替换数"),
          value: mode.corReplacementCount || 0,
        },
      ],
    },
    {
      key: "ner",
      title: t("projects.knowledge.processing.nerStage", "NER"),
      metrics: [
        {
          key: "doneChunks",
          label: stageDoneLabel,
          value: formatDone(Number(mode.nerDoneChunks || mode.nerReadyChunkCount || 0)),
        },
        {
          key: "readyChunks",
          label: t("projects.knowledge.processing.readyChunks", "就绪块数"),
          value: mode.nerReadyChunkCount || 0,
        },
        {
          key: "entities",
          label: t("projects.knowledge.processing.nerEntities", "识别实体数"),
          value: mode.nerEntityCount || 0,
        },
      ],
    },
    {
      key: "syntax",
      title: t("projects.knowledge.processing.syntaxStage", "Syntax"),
      metrics: [
        {
          key: "doneChunks",
          label: stageDoneLabel,
          value: formatDone(Number(mode.syntaxDoneChunks || mode.syntaxReadyChunkCount || 0)),
        },
        {
          key: "readyChunks",
          label: t("projects.knowledge.processing.readyChunks", "就绪块数"),
          value: mode.syntaxReadyChunkCount || 0,
        },
        {
          key: "sentences",
          label: t("projects.knowledge.processing.syntaxSentences", "句子数"),
          value: mode.syntaxSentenceCount || 0,
        },
        {
          key: "tokens",
          label: t("projects.knowledge.processing.syntaxTokens", "Token 数"),
          value: mode.syntaxTokenCount || 0,
        },
        {
          key: "relations",
          label: t("projects.knowledge.processing.syntaxRelations", "句法关系数"),
          value: mode.syntaxRelationCount || 0,
        },
      ],
    },
  ];
}

export default function ProjectKnowledgeProcessingPanel(
  props: ProjectKnowledgeProcessingPanelProps,
) {
  const { t } = useTranslation();
  const launchMode = props.knowledgeState.processingLaunchMode;
  const visibleModes = props.knowledgeState.processingCompareModes;
  const staleModes = new Set(props.knowledgeState.processingFreshness.staleModes);
  const hasStaleProcessing = props.knowledgeState.processingFreshness.stale;
  const l2Mode = visibleModes.find((mode) => mode.mode === "nlp") || null;
  const l3Mode = visibleModes.find((mode) => mode.mode === "agentic") || null;
  const l2Output = l2Mode ? props.knowledgeState.modeOutputs[l2Mode.mode] : null;
  const l3Output = l3Mode ? props.knowledgeState.modeOutputs[l3Mode.mode] : null;
  const l3HasIndependentOutputs = modeHasIndependentOutputs(l3Mode);
  const { entityDelta, relationDelta } = props.knowledgeState.processingCompareDelta;
  const staleTooltip = describeStaleSources(props.knowledgeState.processingFreshness, t);
  const staleInlineHint = describeInlineStaleHint(props.knowledgeState.processingFreshness, t);
  const l1Hint = describeL1Hint(props.knowledgeState, t);

  return (
    <div className={`${styles.projectKnowledgeWorkbench} ${styles.projectKnowledgeProcessingWorkbench}`}>
      <div className={styles.projectKnowledgeTabHeader}>
        <div>
          <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
            {t("projects.knowledgeDock.tabProcessing", "Processing")}
          </Typography.Title>
          <div className={styles.projectKnowledgeModeMeta}>
            <Typography.Text type="secondary">
              {t(
                "projects.knowledge.processingRoleHint",
                "这里只展示 L2 与 L3 的处理进度，重点聚焦实体与关系的构建、增强与呈现。",
              )}
            </Typography.Text>
            <Typography.Text type="secondary">{l1Hint}</Typography.Text>
            {hasStaleProcessing ? (
              <Tooltip title={staleTooltip}>
                <Tag color="orange">
                  {t("projects.knowledge.processing.staleTag", "状态可能已过期")}
                </Tag>
              </Tooltip>
            ) : null}
          </div>
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
          <Typography.Text strong>{formatModeCountValue(l3Mode, l3Mode?.entityCount || 0, t)}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.processing.l3Relations", "L3 关系数")}</Typography.Text>
          <Typography.Text strong>{formatModeCountValue(l3Mode, l3Mode?.relationCount || 0, t)}</Typography.Text>
        </div>
      </div>

      <div className={styles.projectKnowledgeProcessingScrollBody}>
        <div className={styles.projectKnowledgeProcessingCompareGrid}>
          {visibleModes.map((mode) => {
            const disabledReason = launchDisabledReason(mode, props.knowledgeState, t);
            const launchDisabled = Boolean(disabledReason) && launchMode !== mode.mode;
            const staleStatus = staleModes.has(mode.mode);
            const progress = typeof mode.progress === "number"
              ? mode.progress
              : mode.status === "ready"
                ? 100
                : mode.status === "queued"
                  ? 0
                  : null;
            const isL3 = mode.mode === "agentic";
            const output = props.knowledgeState.modeOutputs[mode.mode];
            const prioritizedArtifacts = prioritizeProjectKnowledgeArtifacts(output?.artifacts || []);
            const corBenefitSummary = describeCorBenefit(mode, t);
            const nlpStageStats = buildNlpStageStats(mode, t);
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
                      {staleStatus ? (
                        <Tooltip
                          title={t(
                            "projects.knowledge.processing.staleModeHint",
                            "该模式的运行状态尚未收到最新快照，建议手动刷新或等待连接恢复。",
                          )}
                        >
                          <Tag color="orange">
                            {t("projects.knowledge.processing.staleShort", "快照过期")}
                          </Tag>
                        </Tooltip>
                      ) : null}
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
                  <Progress percent={progress} size="small" status={mode.status === "failed" || mode.status === "blocked" ? "exception" : mode.status === "ready" ? "success" : "active"} />
                ) : null}

                <div className={styles.projectKnowledgeModeDetails}>
                  <Typography.Text>{mode.stage}</Typography.Text>
                  {mode.lastUpdatedAt ? (
                    <Typography.Text type="secondary">
                      {t("projects.knowledge.runtimeStatusUpdatedAt", "Updated")}: {mode.lastUpdatedAt}
                    </Typography.Text>
                  ) : null}
                  {staleStatus ? (
                    <Typography.Text type="secondary">
                      {staleInlineHint}
                    </Typography.Text>
                  ) : null}
                  {isL3 && mode.runId ? (
                    <Typography.Text type="secondary">Run: {mode.runId}</Typography.Text>
                  ) : null}
                </div>

                <div className={styles.projectKnowledgeModeMetrics}>
                  <div className={styles.projectKnowledgeModeMetric}>
                    <Typography.Text type="secondary">{t("projects.knowledge.entities", "实体数")}</Typography.Text>
                    <Typography.Text strong>{formatModeCountValue(mode, mode.entityCount, t)}</Typography.Text>
                  </div>
                  <div className={styles.projectKnowledgeModeMetric}>
                    <Typography.Text type="secondary">{t("projects.knowledge.signalRelations", "关系数")}</Typography.Text>
                    <Typography.Text strong>{formatModeCountValue(mode, mode.relationCount, t)}</Typography.Text>
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
                        : mode.mode === "nlp"
                          ? t("projects.knowledge.processing.corBenefit", "COR 收益")
                          : t("projects.knowledge.processing.artifactSummary", "核心产物")}
                    </Typography.Text>
                    <Typography.Text strong>
                      {isL3
                        ? l3HasIndependentOutputs
                          ? t("projects.knowledge.processing.deltaSummary", "+{{entities}} 实体 / +{{relations}} 关系", {
                            entities: entityDelta,
                            relations: relationDelta,
                          })
                          : t("projects.knowledge.processing.outputPendingLong", "等待形成独立增强结果")
                        : mode.mode === "nlp"
                          ? corBenefitSummary
                          : prioritizedArtifacts[0]?.label || t("projects.knowledge.processing.entityGraphArtifact", "实体关系图谱")}
                    </Typography.Text>
                  </div>
                </div>

                <Typography.Paragraph type="secondary" className={styles.projectKnowledgeModeSummary}>
                  {mode.summary}
                </Typography.Paragraph>

                {nlpStageStats.length ? (
                  <div className={styles.projectKnowledgeProcessingStageGrid}>
                    {nlpStageStats.map((section) => (
                      <div key={section.key} className={styles.projectKnowledgeProcessingStageCard}>
                        <Typography.Text strong>{section.title}</Typography.Text>
                        <div className={styles.projectKnowledgeProcessingStageMetrics}>
                          {section.metrics.map((metric) => (
                            <div key={`${section.key}-${metric.key}`} className={styles.projectKnowledgeProcessingStageMetric}>
                              <Typography.Text type="secondary">{metric.label}</Typography.Text>
                              <Typography.Text strong>{metric.value}</Typography.Text>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}

                {prioritizedArtifacts.length ? (
                  <div className={styles.projectKnowledgeProcessingArtifacts}>
                    {prioritizedArtifacts.slice(0, 2).map((artifact) => (
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
    </div>
  );
}