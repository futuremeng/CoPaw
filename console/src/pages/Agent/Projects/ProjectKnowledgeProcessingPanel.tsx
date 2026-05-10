import { Button, Tag, Tooltip, Typography } from "antd";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";
import type {
  ProjectKnowledgeProcessingFreshness,
  ProjectKnowledgeModeState,
  ProjectKnowledgeState,
} from "./useProjectKnowledgeState";
import type { ProjectKnowledgeModeMetricsPayload } from "../../../api/types";

type ProjectKnowledgeNlpStageKey = "ner" | "syntax" | "cor";
type ProjectKnowledgeLayerKey =
  | "dataPreprocess"
  | "lexical"
  | "phrase"
  | "syntax"
  | "semantic"
  | "pragmatic";
type ProjectKnowledgeLayerStatus = "ready" | "running" | "pending" | "unavailable";

interface ProjectKnowledgeLayerCellMetric {
  label: string;
  value: string | number;
  evidencePath?: string;
}

interface ProjectKnowledgeLayerCell {
  status: ProjectKnowledgeLayerStatus;
  summary: string;
  reason?: string;
  metrics: ProjectKnowledgeLayerCellMetric[];
}

interface ProjectKnowledgeLayerRow {
  key: ProjectKnowledgeLayerKey;
  title: string;
  description: string;
  l2: ProjectKnowledgeLayerCell;
  l3: ProjectKnowledgeLayerCell;
}

interface ProjectKnowledgeProcessingPanelProps {
  knowledgeState: ProjectKnowledgeState;
  onOpenSettings?: () => void;
  onSelectArtifactPath?: (path: string) => void | Promise<void>;
  focusedMode?: ProjectKnowledgeModeState["mode"];
  focusedStage?: ProjectKnowledgeNlpStageKey;
  focusToken?: number;
}

function modeHasIndependentOutputs(mode: ProjectKnowledgeModeState | null): boolean {
  if (!mode) {
    return false;
  }
  return mode.available || mode.entityCount > 0 || mode.relationCount > 0 || mode.qualityScore != null;
}

function displayEntityCount(mode: ProjectKnowledgeModeState | null): number {
  if (!mode) {
    return 0;
  }
  if (mode.mode === "nlp") {
    return Math.max(0, Number(mode.nerEntityCount || mode.entityCount || 0));
  }
  return Math.max(0, Number(mode.entityCount || 0));
}

function formatEntityValue(
  mode: ProjectKnowledgeModeState | null,
  t: ReturnType<typeof useTranslation>["t"],
): string | number {
  if (!mode) {
    return 0;
  }
  const value = displayEntityCount(mode);
  if (mode.mode !== "nlp") {
    return value;
  }
  if (value > 0) {
    return value;
  }
  if (mode.status === "running" || mode.status === "queued") {
    return t("projects.knowledge.processing.metricPending", "生成中");
  }
  const readyCount = Math.max(0, Number(mode.nerReadyChunkCount || 0));
  if (readyCount <= 0) {
    return t("projects.knowledge.processing.metricUnavailable", "未产出");
  }
  return value;
}

function displayRelationCount(mode: ProjectKnowledgeModeState | null): number {
  if (!mode) {
    return 0;
  }
  if (mode.mode === "nlp") {
    return Math.max(0, Number(mode.syntaxRelationCount || mode.relationCount || 0));
  }
  return Math.max(0, Number(mode.relationCount || 0));
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

function formatPercent(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value * 100)))}%`;
}

function resolveEvidencePathByKey(
  evidencePaths: Record<string, string>,
  key: string,
): string {
  const path = String(evidencePaths[key] || "").trim();
  return path;
}

function mapModeToLayerStatus(
  mode: ProjectKnowledgeModeState | null,
  ready: boolean,
  unavailable = false,
): ProjectKnowledgeLayerStatus {
  if (unavailable) {
    return "unavailable";
  }
  if (ready) {
    return mode?.status === "running" || mode?.status === "queued" ? "running" : "ready";
  }
  if (mode?.status === "running" || mode?.status === "queued") {
    return "running";
  }
  return "pending";
}

function buildKnowledgeLayerRows(
  params: {
    l2Mode: ProjectKnowledgeModeState | null;
    l3Mode: ProjectKnowledgeModeState | null;
    l2EvidencePaths: Record<string, string>;
    l3EvidencePaths: Record<string, string>;
    quantMetrics: ProjectKnowledgeState["quantMetrics"];
    entityDelta: number;
    relationDelta: number;
    t: ReturnType<typeof useTranslation>["t"];
  },
): ProjectKnowledgeLayerRow[] {
  const {
    l2Mode,
    l3Mode,
    l2EvidencePaths,
    l3EvidencePaths,
    quantMetrics,
    entityDelta,
    relationDelta,
    t,
  } = params;
  const hasL3Outputs = modeHasIndependentOutputs(l3Mode);
  const l3Running = l3Mode?.status === "running" || l3Mode?.status === "queued";
  const l3Ready = Boolean(l3Mode && hasL3Outputs && l3Mode.status === "ready");
  const l2DocumentCount = Math.max(0, Number(l2Mode?.documentCount || 0));
  const l2TokenCount = Math.max(0, Number(l2Mode?.syntaxTokenCount || quantMetrics.tokenCount || 0));
  const l2PosCount = Math.max(0, Number(l2Mode?.syntaxPosCount || 0));
  const l2PosCoverage = formatPercent(Number(l2Mode?.posCoverageOnDocumentTokens || 0));
  const l2SyntaxRelations = Math.max(0, Number(l2Mode?.syntaxRelationCount || 0));
  const l2SyntaxSentences = Math.max(0, Number(l2Mode?.syntaxSentenceCount || 0));
  const l2NerEntities = Math.max(0, Number(l2Mode?.nerEntityCount || 0));
  const l2NerReadyChunks = Math.max(0, Number(l2Mode?.nerReadyChunkCount || 0));
  const l3Quality = l3Mode?.qualityScore != null
    ? `${Math.round(Number(l3Mode.qualityScore) * 100)}%`
    : t("projects.knowledge.processing.metricPending", "生成中");

  const buildL3Cell = (
    summaryKey: string,
    summaryFallback: string,
    metrics: ProjectKnowledgeLayerCellMetric[],
    reason?: string,
  ): ProjectKnowledgeLayerCell => ({
    status: mapModeToLayerStatus(l3Mode, l3Ready, false),
    summary: l3Ready
      ? t(summaryKey, summaryFallback)
      : l3Running
        ? t("projects.knowledge.processing.l3AuditRunning", "多智能体审计运行中")
        : t("projects.knowledge.processing.l3AuditPending", "等待多智能体增强产物"),
    reason,
    metrics,
  });

  return [
    {
      key: "dataPreprocess",
      title: t("projects.knowledge.processing.layerDataPreprocessTitle", "数据层与预处理层"),
      description: t(
        "projects.knowledge.processing.layerDataPreprocessDesc",
        "以 inlinear 为输入基础，完成分词标准化并建立后续分析入口。",
      ),
      l2: {
        status: mapModeToLayerStatus(l2Mode, l2TokenCount > 0),
        summary: t("projects.knowledge.processing.layerDataPreprocessL2", "inlinear 分词已纳入 L2 精确计量"),
        metrics: [
          {
            label: t("projects.knowledge.documents", "文档数"),
            value: l2DocumentCount,
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "document_count"),
          },
          {
            label: t("projects.knowledge.processing.syntaxTokens", "Token 数"),
            value: l2TokenCount,
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "syntax_token_count"),
          },
        ],
      },
      l3: buildL3Cell(
        "projects.knowledge.processing.layerDataPreprocessL3",
        "审计预处理完整性与输入一致性",
        [
          {
            label: t("projects.knowledge.processing.auditStatus", "审计状态"),
            value: l3Ready
              ? t("projects.knowledge.processing.stageReady", "已就绪")
              : l3Running
                ? t("projects.knowledge.processing.stageRunning", "运行中")
                : t("projects.knowledge.processing.stagePending", "待执行"),
            evidencePath: resolveEvidencePathByKey(l3EvidencePaths, "audit_status"),
          },
        ],
      ),
    },
    {
      key: "lexical",
      title: t("projects.knowledge.processing.layerLexicalTitle", "词汇层次"),
      description: t(
        "projects.knowledge.processing.layerLexicalDesc",
        "聚焦分词与词性标注，反映词法处理覆盖度与稳定性。",
      ),
      l2: {
        status: mapModeToLayerStatus(l2Mode, l2PosCount > 0),
        summary: t("projects.knowledge.processing.layerLexicalL2", "分词与词性已进入 L2 精确统计"),
        metrics: [
          {
            label: t("projects.knowledge.processing.syntaxPosCount", "词性标注数"),
            value: l2PosCount,
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "syntax_pos_count"),
          },
          {
            label: t("projects.knowledge.processing.posCoverageDocument", "词性覆盖率(文档分词口径)"),
            value: l2PosCoverage,
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "pos_coverage_on_document_tokens"),
          },
        ],
      },
      l3: buildL3Cell(
        "projects.knowledge.processing.layerLexicalL3",
        "审计词法质量与异常分布",
        [
          {
            label: t("projects.knowledge.processing.auditFocus", "审计焦点"),
            value: t("projects.knowledge.processing.auditFocusLexical", "词性一致性/异常词分布"),
            evidencePath: resolveEvidencePathByKey(l3EvidencePaths, "audit_focus"),
          },
        ],
      ),
    },
    {
      key: "phrase",
      title: t("projects.knowledge.processing.layerPhraseTitle", "短语层次"),
      description: t(
        "projects.knowledge.processing.layerPhraseDesc",
        "短语边界与短语类型识别能力，当前以占位状态呈现。",
      ),
      l2: {
        status: mapModeToLayerStatus(l2Mode, false, true),
        summary: t("projects.knowledge.processing.layerPhraseL2", "短语层指标待实现"),
        reason: "PHRASE_LAYER_NOT_IMPLEMENTED",
        metrics: [
          {
            label: t("projects.knowledge.processing.stageReason", "原因"),
            value: "PHRASE_LAYER_NOT_IMPLEMENTED",
          },
        ],
      },
      l3: {
        status: mapModeToLayerStatus(l3Mode, false, true),
        summary: t("projects.knowledge.processing.layerPhraseL3", "短语层审计占位，等待底层能力接入"),
        reason: "PHRASE_LAYER_NOT_IMPLEMENTED",
        metrics: [
          {
            label: t("projects.knowledge.processing.auditStatus", "审计状态"),
            value: t("projects.knowledge.processing.stageUnavailable", "不可用"),
          },
        ],
      },
    },
    {
      key: "syntax",
      title: t("projects.knowledge.processing.layerSyntaxTitle", "句法层次"),
      description: t(
        "projects.knowledge.processing.layerSyntaxDesc",
        "面向句法依存关系与句子结构化，提供关系构建的基础。",
      ),
      l2: {
        status: mapModeToLayerStatus(l2Mode, l2SyntaxRelations > 0),
        summary: t("projects.knowledge.processing.layerSyntaxL2", "句法结构化指标已进入 L2"),
        metrics: [
          {
            label: t("projects.knowledge.processing.syntaxSentences", "句子数"),
            value: l2SyntaxSentences,
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "syntax_sentence_count"),
          },
          {
            label: t("projects.knowledge.processing.syntaxRelations", "句法关系数"),
            value: l2SyntaxRelations,
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "syntax_relation_count"),
          },
        ],
      },
      l3: buildL3Cell(
        "projects.knowledge.processing.layerSyntaxL3",
        "审计句法关系一致性与结构完整性",
        [
          {
            label: t("projects.knowledge.processing.auditFocus", "审计焦点"),
            value: t("projects.knowledge.processing.auditFocusSyntax", "依存关系一致性"),
            evidencePath: resolveEvidencePathByKey(l3EvidencePaths, "audit_focus"),
          },
        ],
      ),
    },
    {
      key: "semantic",
      title: t("projects.knowledge.processing.layerSemanticTitle", "语义层次"),
      description: t(
        "projects.knowledge.processing.layerSemanticDesc",
        "关注上下文语义角色与实体语义关联，支撑知识图谱语义质量。",
      ),
      l2: {
        status: mapModeToLayerStatus(l2Mode, l2NerEntities > 0 || l2NerReadyChunks > 0),
        summary: t("projects.knowledge.processing.layerSemanticL2", "NER 语义抽取作为 L2 核心计量"),
        metrics: [
          {
            label: t("projects.knowledge.processing.nerEntities", "识别实体数"),
            value: l2NerEntities,
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "ner_entity_count"),
          },
          {
            label: t("projects.knowledge.processing.readyChunks", "就绪标准化文档数"),
            value: l2NerReadyChunks,
            evidencePath: resolveEvidencePathByKey(l2EvidencePaths, "ner_ready_chunk_count"),
          },
        ],
      },
      l3: buildL3Cell(
        "projects.knowledge.processing.layerSemanticL3",
        "审计语义冲突并增强实体关系一致性",
        [
          {
            label: t("projects.knowledge.processing.auditFocus", "审计焦点"),
            value: t("projects.knowledge.processing.auditFocusSemantic", "语义冲突/实体归一"),
            evidencePath: resolveEvidencePathByKey(l3EvidencePaths, "audit_focus"),
          },
        ],
      ),
    },
    {
      key: "pragmatic",
      title: t("projects.knowledge.processing.layerPragmaticTitle", "语用与推理层次"),
      description: t(
        "projects.knowledge.processing.layerPragmaticDesc",
        "结合上下文与多智能体协作进行高阶推理、审计与知识增强。",
      ),
      l2: {
        status: "pending",
        summary: t("projects.knowledge.processing.layerPragmaticL2", "该层由 L3 负责，L2 仅保留占位说明"),
        metrics: [
          {
            label: t("projects.knowledge.processing.layerOwner", "负责层"),
            value: "L3",
          },
        ],
      },
      l3: {
        status: mapModeToLayerStatus(l3Mode, l3Ready),
        summary: l3Ready
          ? t("projects.knowledge.processing.layerPragmaticL3", "多智能体推理增强已产出可消费结果")
          : l3Running
            ? t("projects.knowledge.processing.l3ReasoningRunning", "多智能体推理增强运行中")
            : t("projects.knowledge.processing.l3ReasoningPending", "等待多智能体推理增强结果"),
        metrics: [
          {
            label: t("projects.knowledge.processing.qualityScore", "质量分"),
            value: l3Quality,
            evidencePath: resolveEvidencePathByKey(l3EvidencePaths, "quality_score"),
          },
          {
            label: t("projects.knowledge.processing.auditRound", "审计轮次"),
            value: l3Mode?.auditRound
              ? `#${l3Mode.auditRound}`
              : l3Mode?.runId || t("projects.knowledge.processing.metricUnavailable", "未产出"),
            evidencePath: resolveEvidencePathByKey(l3EvidencePaths, "audit_round"),
          },
          {
            label: t("projects.knowledge.processing.enhancementDelta", "相对 L2 增量"),
            value: hasL3Outputs
              ? t("projects.knowledge.processing.deltaSummary", "+{{entities}} 实体 / +{{relations}} 关系", {
                entities: entityDelta,
                relations: relationDelta,
              })
              : t("projects.knowledge.processing.outputPendingLong", "等待形成独立增强结果"),
            evidencePath: resolveEvidencePathByKey(l3EvidencePaths, "enhancement_delta"),
          },
        ],
      },
    },
  ];
}

function nlpStageTagColor(
  status: "ready" | "running" | "pending" | "unavailable",
): string {
  if (status === "ready") {
    return "success";
  }
  if (status === "running") {
    return "processing";
  }
  if (status === "unavailable") {
    return "default";
  }
  return "gold";
}

function nlpStageStatusLabel(
  status: "ready" | "running" | "pending" | "unavailable",
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (status === "ready") {
    return t("projects.knowledge.processing.stageReady", "已就绪");
  }
  if (status === "running") {
    return t("projects.knowledge.processing.stageRunning", "运行中");
  }
  if (status === "unavailable") {
    return t("projects.knowledge.processing.stageUnavailable", "不可用");
  }
  return t("projects.knowledge.processing.stagePending", "待执行");
}

export default function ProjectKnowledgeProcessingPanel(
  props: ProjectKnowledgeProcessingPanelProps,
) {
  const { t } = useTranslation();
  const visibleModes = props.knowledgeState.processingCompareModes.filter(
    (mode) => mode.mode === "nlp" || mode.mode === "agentic",
  );
  const hasStaleProcessing = props.knowledgeState.processingFreshness.stale;
  const l2Mode = visibleModes.find((mode) => mode.mode === "nlp") || null;
  const l3Mode = visibleModes.find((mode) => mode.mode === "agentic") || null;
  const modeMetricsPayload = (props.knowledgeState.syncState?.mode_metrics || {}) as Partial<Record<string, ProjectKnowledgeModeMetricsPayload>>;
  const l2EvidencePaths = (modeMetricsPayload.nlp?.evidence_paths || {}) as Record<string, string>;
  const l3EvidencePaths = (modeMetricsPayload.agentic?.evidence_paths || {}) as Record<string, string>;
  const { entityDelta, relationDelta } = props.knowledgeState.processingCompareDelta;
  const staleTooltip = describeStaleSources(props.knowledgeState.processingFreshness, t);
  const layerRows = buildKnowledgeLayerRows({
    l2Mode,
    l3Mode,
    l2EvidencePaths,
    l3EvidencePaths,
    quantMetrics: props.knowledgeState.quantMetrics,
    entityDelta,
    relationDelta,
    t,
  });

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
                "Processing 仅展示 L2 精确计量与 L3 多智能体审计增强，不再承载 L1 展示。",
              )}
            </Typography.Text>
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

      <div className={styles.projectKnowledgeProcessingScrollBody}>
        <div className={styles.projectKnowledgeProcessingStickySummary}>
          <div className={styles.projectKnowledgeSignalGrid}>
            <div className={styles.projectKnowledgeSignalCard}>
              <Typography.Text type="secondary">{t("projects.knowledge.processing.l2Entities", "NER 实体数")}</Typography.Text>
              <Typography.Text strong>{formatEntityValue(l2Mode, t)}</Typography.Text>
            </div>
            <div className={styles.projectKnowledgeSignalCard}>
              <Typography.Text type="secondary">{t("projects.knowledge.processing.l2Relations", "Syntax 句法关系数")}</Typography.Text>
              <Typography.Text strong>{displayRelationCount(l2Mode)}</Typography.Text>
            </div>
            <div className={styles.projectKnowledgeSignalCard}>
              <Typography.Text type="secondary">{t("projects.knowledge.processing.l3Entities", "L3 实体数")}</Typography.Text>
              <Typography.Text strong>
                {l3Mode && !modeHasIndependentOutputs(l3Mode)
                  ? t("projects.knowledge.processing.outputPending", "未产出")
                  : (l3Mode?.entityCount || 0)}
              </Typography.Text>
            </div>
            <div className={styles.projectKnowledgeSignalCard}>
              <Typography.Text type="secondary">{t("projects.knowledge.processing.l3Relations", "L3 关系数")}</Typography.Text>
              <Typography.Text strong>
                {l3Mode && !modeHasIndependentOutputs(l3Mode)
                  ? t("projects.knowledge.processing.outputPending", "未产出")
                  : (l3Mode?.relationCount || 0)}
              </Typography.Text>
            </div>
          </div>
        </div>

        <div className={styles.projectKnowledgeLayerMatrix}>
          <div className={styles.projectKnowledgeLayerMatrixHeader}>
            <Typography.Text strong>
              {t("projects.knowledge.processing.layerDimension", "知识计量六层")}
            </Typography.Text>
            <Typography.Text strong>
              {t("projects.knowledge.processing.layerL2Column", "L2 精确量化")}
            </Typography.Text>
            <Typography.Text strong>
              {t("projects.knowledge.processing.layerL3Column", "L3 审计增强")}
            </Typography.Text>
          </div>
          {layerRows.map((row) => (
            <div key={row.key} className={styles.projectKnowledgeLayerMatrixRow}>
              <div className={styles.projectKnowledgeLayerMatrixDimension}>
                <Typography.Text strong>{row.title}</Typography.Text>
                <Typography.Text type="secondary">{row.description}</Typography.Text>
              </div>
              {[row.l2, row.l3].map((cell, index) => (
                <div key={`${row.key}-${index}`} className={styles.projectKnowledgeLayerMatrixCell}>
                  <div className={styles.projectKnowledgeModeMeta}>
                    <Tag color={nlpStageTagColor(cell.status)}>{nlpStageStatusLabel(cell.status, t)}</Tag>
                  </div>
                  <Typography.Text>{cell.summary}</Typography.Text>
                  <div className={styles.projectKnowledgeProcessingStageMetrics}>
                    {cell.metrics.map((metric) => (
                      <div key={`${row.key}-${index}-${metric.label}`} className={styles.projectKnowledgeProcessingStageMetric}>
                        <div className={styles.projectKnowledgeProcessingStageMetricMain}>
                          <Typography.Text type="secondary">{metric.label}</Typography.Text>
                          <Typography.Text strong>{metric.value}</Typography.Text>
                        </div>
                        <Button
                          type="link"
                          size="small"
                          disabled={!metric.evidencePath || !props.onSelectArtifactPath}
                          style={{ paddingInline: 0, height: "auto" }}
                          onClick={() => {
                            if (!metric.evidencePath || !props.onSelectArtifactPath) {
                              return;
                            }
                            void props.onSelectArtifactPath(metric.evidencePath);
                          }}
                        >
                          {t("projects.knowledge.processing.viewEvidence", "查看证据")}
                        </Button>
                      </div>
                    ))}
                  </div>
                  {cell.reason ? (
                    <Typography.Text type="secondary">
                      {t("projects.knowledge.processing.stageReason", "原因")}: {cell.reason}
                    </Typography.Text>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}