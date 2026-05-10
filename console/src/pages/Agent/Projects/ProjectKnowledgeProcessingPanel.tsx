import { useEffect, useRef, useState } from "react";
import { Button, Progress, Segmented, Tag, Tooltip, Typography } from "antd";
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
  getProjectKnowledgeQuantizationStage,
  getProjectKnowledgeSemanticSummary,
  prioritizeProjectKnowledgeArtifacts,
} from "./projectKnowledgeSyncUi";
import type { ProjectKnowledgeQuantizationStage } from "../../../api/types";
import ProjectKnowledgeNerPanel from "./ProjectKnowledgeNerPanel";

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

function allowedQuantizationStages(
  mode: ProjectKnowledgeModeState["mode"],
): ProjectKnowledgeQuantizationStage[] {
  if (mode === "nlp") {
    return ["l2"];
  }
  return ["l3"];
}

function quantizationStageLabel(
  stage: ProjectKnowledgeQuantizationStage,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  if (stage === "l1") {
    return t("projects.knowledge.processing.quantStageL1", "L1");
  }
  if (stage === "l2") {
    return t("projects.knowledge.processing.quantStageL2", "L2");
  }
  return t("projects.knowledge.processing.quantStageL3", "L3");
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
  key: ProjectKnowledgeNlpStageKey;
  title: string;
  optional?: boolean;
  status: "ready" | "running" | "pending" | "unavailable";
  subtitle: string;
  reason?: string;
  metrics: Array<{ key: string; label: string; value: string | number }>;
}> {
  if (mode.mode !== "nlp") {
    return [];
  }

  const totalChunks = Math.max(
    0,
    Number(mode.l2TotalChunks || mode.chunkCount || 0),
  );
  const stageDoneLabel = t("projects.knowledge.processing.stageDoneChunks", "已处理标准化文档数");
  const formatDone = (done: number): string | number => (
    totalChunks > 0 ? `${Math.max(0, done)}/${totalChunks}` : Math.max(0, done)
  );
  const resolveStageStatus = (
    readyCount: number,
    doneCount: number,
    optional = false,
  ): "ready" | "running" | "pending" | "unavailable" => {
    if (readyCount > 0) {
      if (mode.status === "running" && totalChunks > 0 && doneCount < totalChunks) {
        return "running";
      }
      return "ready";
    }
    if (optional) {
      const reasonCode = String(mode.corReasonCode || "").trim();
      const corUnavailable = reasonCode.length > 0
        && reasonCode !== "HANLP2_TASK_READY"
        && reasonCode !== "HANLP2_COREF_HEURISTIC_READY"
        && mode.status !== "running"
        && mode.status !== "queued";
      if (corUnavailable) {
        return "unavailable";
      }
    }
    if (mode.status === "running") {
      return "running";
    }
    return "pending";
  };
  const corDone = Number(mode.corDoneChunks || mode.corReadyChunkCount || 0);
  const nerDone = Number(mode.nerDoneChunks || mode.nerReadyChunkCount || 0);
  const syntaxDone = Number(mode.syntaxDoneChunks || mode.syntaxReadyChunkCount || 0);
  const corReady = Number(mode.corReadyChunkCount || 0);
  const nerReady = Number(mode.nerReadyChunkCount || 0);
  const syntaxReady = Number(mode.syntaxReadyChunkCount || 0);

  return [
    {
      key: "ner",
      title: t("projects.knowledge.processing.nerStage", "NER"),
      status: resolveStageStatus(nerReady, nerDone),
      subtitle: t("projects.knowledge.processing.requiredStageLabel", "必需阶段"),
      reason: "",
      metrics: [
        {
          key: "doneChunks",
          label: stageDoneLabel,
          value: formatDone(nerDone),
        },
        {
          key: "readyChunks",
          label: t("projects.knowledge.processing.readyChunks", "就绪标准化文档数"),
          value: nerReady,
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
      status: resolveStageStatus(syntaxReady, syntaxDone),
      subtitle: t("projects.knowledge.processing.requiredStageLabel", "必需阶段"),
      reason: "",
      metrics: [
        {
          key: "doneChunks",
          label: stageDoneLabel,
          value: formatDone(syntaxDone),
        },
        {
          key: "readyChunks",
          label: t("projects.knowledge.processing.readyChunks", "就绪标准化文档数"),
          value: syntaxReady,
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
          key: "posCount",
          label: t("projects.knowledge.processing.syntaxPosCount", "词性标注数"),
          value: mode.syntaxPosCount || 0,
        },
        {
          key: "posTagTypes",
          label: t("projects.knowledge.processing.syntaxPosTagTypeCount", "词性标签种类数"),
          value: mode.syntaxPosTagTypeCount || 0,
        },
        {
          key: "posCoverageSyntax",
          label: t("projects.knowledge.processing.posCoverageSyntax", "词性覆盖率(语法分词口径)"),
          value: formatPercent(Number(mode.posCoverageOnSyntaxTokens || 0)),
        },
        {
          key: "posCoverageDocument",
          label: t("projects.knowledge.processing.posCoverageDocument", "词性覆盖率(文档分词口径)"),
          value: formatPercent(Number(mode.posCoverageOnDocumentTokens || 0)),
        },
        {
          key: "relations",
          label: t("projects.knowledge.processing.syntaxRelations", "句法关系数"),
          value: mode.syntaxRelationCount || 0,
        },
      ],
    },
    {
      key: "cor",
      title: t("projects.knowledge.processing.corStage", "COR"),
      optional: true,
      status: resolveStageStatus(corReady, corDone, true),
      subtitle: t("projects.knowledge.processing.optionalStageLabel", "备用阶段"),
      reason: mode.corReason || mode.corReasonCode || "",
      metrics: [
        {
          key: "doneChunks",
          label: stageDoneLabel,
          value: formatDone(corDone),
        },
        {
          key: "readyChunks",
          label: t("projects.knowledge.processing.readyChunks", "就绪标准化文档数"),
          value: corReady,
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
  ];
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
    quantMetrics: ProjectKnowledgeState["quantMetrics"];
    t: ReturnType<typeof useTranslation>["t"];
  },
): ProjectKnowledgeLayerRow[] {
  const { l2Mode, l3Mode, quantMetrics, t } = params;
  const hasL3Outputs = modeHasIndependentOutputs(l3Mode);
  const l3Running = l3Mode?.status === "running" || l3Mode?.status === "queued";
  const l3Ready = Boolean(l3Mode && hasL3Outputs && l3Mode.status === "ready");
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
            label: t("projects.knowledge.processing.syntaxTokens", "Token 数"),
            value: l2TokenCount,
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
          },
          {
            label: t("projects.knowledge.processing.posCoverageDocument", "词性覆盖率(文档分词口径)"),
            value: l2PosCoverage,
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
          },
          {
            label: t("projects.knowledge.processing.syntaxRelations", "句法关系数"),
            value: l2SyntaxRelations,
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
          },
          {
            label: t("projects.knowledge.processing.readyChunks", "就绪标准化文档数"),
            value: l2NerReadyChunks,
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
          },
          {
            label: t("projects.knowledge.processing.auditRound", "审计轮次"),
            value: l3Mode?.auditRound
              ? `#${l3Mode.auditRound}`
              : l3Mode?.runId || t("projects.knowledge.processing.metricUnavailable", "未产出"),
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

function formatTraceMetricValue(value: unknown): string | number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.length;
  }
  if (value == null) {
    return "—";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatTraceMetricLabel(
  key: string,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const normalized = String(key || "").trim().toLowerCase();
  if (normalized === "document_count") {
    return t("projects.knowledge.documents", "文档数");
  }
  if (normalized === "entity_count" || normalized === "ner_entity_count") {
    return t("projects.knowledge.entities", "实体数");
  }
  if (normalized === "relation_count" || normalized === "syntax_relation_count") {
    return t("projects.knowledge.signalRelations", "关系数");
  }
  if (normalized === "syntax_token_count") {
    return t("projects.knowledge.processing.syntaxTokens", "Token 数");
  }
  if (normalized === "syntax_pos_count") {
    return t("projects.knowledge.processing.syntaxPosCount", "词性标注数");
  }
  if (normalized === "syntax_pos_tag_type_count") {
    return t("projects.knowledge.processing.syntaxPosTagTypeCount", "词性标签种类数");
  }
  if (normalized === "pos_coverage_on_syntax_tokens") {
    return t("projects.knowledge.processing.posCoverageSyntax", "词性覆盖率(语法分词口径)");
  }
  if (normalized === "pos_coverage_on_document_tokens") {
    return t("projects.knowledge.processing.posCoverageDocument", "词性覆盖率(文档分词口径)");
  }
  if (normalized === "quality_score") {
    return t("projects.knowledge.processing.qualityScore", "质量分");
  }
  if (normalized === "chunk_count" || normalized === "total_chunks") {
    return t("projects.knowledge.chunkCount", "Chunk 数");
  }
  return key;
}

function selectTraceMetricEntries(metrics: Record<string, unknown>): Array<[string, unknown]> {
  const entries = Object.entries(metrics || {});
  if (entries.length <= 4) {
    return entries;
  }

  const preferredOrder = [
    "document_count",
    "entity_count",
    "relation_count",
    "quality_score",
    "ner_entity_count",
    "syntax_relation_count",
    "chunk_count",
    "total_chunks",
    "ner_ready_chunk_count",
    "syntax_ready_chunk_count",
    "cor_ready_chunk_count",
  ];
  const picked = new Map<string, unknown>();
  for (const key of preferredOrder) {
    if (Object.prototype.hasOwnProperty.call(metrics, key)) {
      picked.set(key, metrics[key]);
    }
    if (picked.size >= 4) {
      break;
    }
  }
  if (picked.size < 4) {
    for (const [key, value] of entries) {
      if (!picked.has(key)) {
        picked.set(key, value);
      }
      if (picked.size >= 4) {
        break;
      }
    }
  }
  return Array.from(picked.entries());
}

function extractTraceStageReason(stage: {
  status?: string;
  metrics?: Record<string, unknown>;
  summary?: string;
}): string {
  const metrics = stage.metrics || {};
  const reasonCandidates = [
    metrics.reason,
    metrics.reason_code,
    metrics.cor_reason,
    metrics.cor_reason_code,
    metrics.semantic_reason,
    metrics.semantic_reason_code,
  ];
  for (const candidate of reasonCandidates) {
    const text = String(candidate || "").trim();
    if (text) {
      return text;
    }
  }
  if (stage.status === "failed" || stage.status === "blocked") {
    return String(stage.summary || "").trim();
  }
  return "";
}

function formatArtifactLabel(artifact: { label?: string; kind?: string; path?: string }): string {
  const path = String(artifact.path || "").trim();
  const baseName = path ? path.split("/").filter(Boolean).pop() || path : "";
  const label = String(artifact.label || "").trim() || String(artifact.kind || "").trim();
  if (label && baseName) {
    return `${label} · ${baseName}`;
  }
  return label || baseName || "artifact";
}

export default function ProjectKnowledgeProcessingPanel(
  props: ProjectKnowledgeProcessingPanelProps,
) {
  const { t } = useTranslation();
  const [selectedStages, setSelectedStages] = useState<Record<string, ProjectKnowledgeQuantizationStage>>({
    nlp: "l2",
    agentic: "l3",
  });
  const launchMode = props.knowledgeState.processingLaunchMode;
  const visibleModes = props.knowledgeState.processingCompareModes.filter(
    (mode) => mode.mode === "nlp" || mode.mode === "agentic",
  );
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
  const layerRows = buildKnowledgeLayerRows({
    l2Mode,
    l3Mode,
    quantMetrics: props.knowledgeState.quantMetrics,
    t,
  });
  const latestRequestedMode = props.knowledgeState.syncState?.latest_requested_mode;
  const activeQuantizationStage = String(props.knowledgeState.syncState?.quantization_stage || "").trim().toLowerCase();
  const pipelineTraceStages = props.knowledgeState.syncState?.pipeline_trace?.stages || [];
  const modeCardRefs = useRef<Partial<Record<ProjectKnowledgeModeState["mode"], HTMLDivElement | null>>>({});
  const nlpStageRefs = useRef<Partial<Record<ProjectKnowledgeNlpStageKey, HTMLDivElement | null>>>({});
  const [showNerDiagnostics, setShowNerDiagnostics] = useState(false);
  const [focusedModeHighlight, setFocusedModeHighlight] = useState<ProjectKnowledgeModeState["mode"] | "">("");
  const [focusedStageHighlight, setFocusedStageHighlight] = useState<ProjectKnowledgeNlpStageKey | "">("");
  const focusHighlightTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!props.focusedMode) {
      return;
    }
    const card = modeCardRefs.current[props.focusedMode];
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [props.focusToken, props.focusedMode]);

  useEffect(() => {
    if (props.focusedMode !== "nlp" || !props.focusedStage) {
      return;
    }
    const stageCard = nlpStageRefs.current[props.focusedStage];
    if (stageCard) {
      stageCard.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [props.focusToken, props.focusedMode, props.focusedStage]);

  useEffect(() => {
    if (!props.focusToken || !props.focusedMode) {
      return;
    }
    setFocusedModeHighlight(props.focusedMode);
    setFocusedStageHighlight(props.focusedMode === "nlp" ? (props.focusedStage || "") : "");
    if (focusHighlightTimerRef.current) {
      window.clearTimeout(focusHighlightTimerRef.current);
    }
    focusHighlightTimerRef.current = window.setTimeout(() => {
      setFocusedModeHighlight("");
      setFocusedStageHighlight("");
      focusHighlightTimerRef.current = null;
    }, 1600);
    return () => {
      if (focusHighlightTimerRef.current) {
        window.clearTimeout(focusHighlightTimerRef.current);
        focusHighlightTimerRef.current = null;
      }
    };
  }, [props.focusToken, props.focusedMode, props.focusedStage]);

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
              <Typography.Text strong>{formatModeCountValue(l3Mode, l3Mode?.entityCount || 0, t)}</Typography.Text>
            </div>
            <div className={styles.projectKnowledgeSignalCard}>
              <Typography.Text type="secondary">{t("projects.knowledge.processing.l3Relations", "L3 关系数")}</Typography.Text>
              <Typography.Text strong>{formatModeCountValue(l3Mode, l3Mode?.relationCount || 0, t)}</Typography.Text>
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
                        <Typography.Text type="secondary">{metric.label}</Typography.Text>
                        <Typography.Text strong>{metric.value}</Typography.Text>
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

        <div className={styles.projectKnowledgeProcessingCompareGrid}>
          {visibleModes.map((mode) => {
            const disabledReason = launchDisabledReason(mode, props.knowledgeState, t);
            const launchDisabled = Boolean(disabledReason) && launchMode !== mode.mode;
            const staleStatus = staleModes.has(mode.mode);
            const stageOptions = allowedQuantizationStages(mode.mode);
            const selectedStage = selectedStages[mode.mode] ?? getProjectKnowledgeQuantizationStage(mode.mode);
            const currentLaunchStage = latestRequestedMode === mode.mode
              ? activeQuantizationStage as ProjectKnowledgeQuantizationStage | ""
              : "";
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
            const entityValue = formatEntityValue(mode, t);
            const highlightValue = isL3
              ? mode.qualityScore != null
                ? `${Math.round(mode.qualityScore * 100)}%`
                : t("projects.knowledge.processing.qualityPending", "待增强")
              : t("projects.knowledge.processing.structureReady", "结构化基线");

            return (
              <div
                key={mode.mode}
                ref={(node) => {
                  modeCardRefs.current[mode.mode] = node;
                }}
                className={`${styles.projectKnowledgeModeCard} ${styles.projectKnowledgeProcessingCompareCard} ${focusedModeHighlight === mode.mode ? styles.projectKnowledgeFocusPulse : ""}`}
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
                    <Typography.Text type="secondary">{t("projects.knowledge.documents", "文档数")}</Typography.Text>
                    <Typography.Text strong>{mode.documentCount || 0}</Typography.Text>
                  </div>
                  <div className={styles.projectKnowledgeModeMetric}>
                    <Typography.Text type="secondary">{t("projects.knowledge.entities", "实体数")}</Typography.Text>
                    <Typography.Text strong>
                      {typeof entityValue === "number"
                        ? formatModeCountValue(mode, entityValue, t)
                        : entityValue}
                    </Typography.Text>
                  </div>
                  <div className={styles.projectKnowledgeModeMetric}>
                    <Typography.Text type="secondary">{t("projects.knowledge.signalRelations", "关系数")}</Typography.Text>
                    <Typography.Text strong>{formatModeCountValue(mode, displayRelationCount(mode), t)}</Typography.Text>
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
                  <div className={styles.projectKnowledgeNlpFlow}>
                    <div className={styles.projectKnowledgeNlpFlowHeader}>
                      <Typography.Text strong>
                        {t("projects.knowledge.processing.nlpFlowTitle", "NLP 三阶段流程")}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {t("projects.knowledge.processing.nlpFlowHint", "NER 与 Syntax 达标即可产出，COR 作为第三阶段备用增强。")}
                      </Typography.Text>
                    </div>
                    <div className={styles.projectKnowledgeNlpFlowTrack}>
                      {nlpStageStats.map((section) => (
                        <div
                          key={section.key}
                          ref={(node) => {
                            nlpStageRefs.current[section.key] = node;
                          }}
                          className={`${styles.projectKnowledgeProcessingStageCard} ${styles.projectKnowledgeNlpFlowStage} ${section.optional ? styles.projectKnowledgeNlpFlowStageOptional : ""} ${focusedModeHighlight === "nlp" && focusedStageHighlight === section.key ? styles.projectKnowledgeFocusPulse : ""}`}
                        >
                          <div className={styles.projectKnowledgeNlpFlowStageHeader}>
                            <div>
                              <Typography.Text strong>{section.title}</Typography.Text>
                              <div className={styles.projectKnowledgeModeMeta}>
                                <Tag color={nlpStageTagColor(section.status)}>
                                  {nlpStageStatusLabel(section.status, t)}
                                </Tag>
                                <Tag bordered={false}>{section.subtitle}</Tag>
                              </div>
                            </div>
                          </div>
                          <div className={styles.projectKnowledgeProcessingStageMetrics}>
                            {section.metrics.map((metric) => (
                              <div key={`${section.key}-${metric.key}`} className={styles.projectKnowledgeProcessingStageMetric}>
                                <Typography.Text type="secondary">{metric.label}</Typography.Text>
                                <Typography.Text strong>{metric.value}</Typography.Text>
                              </div>
                            ))}
                          </div>
                          {section.reason && section.status !== "ready" ? (
                            <Typography.Text type="secondary">
                              {t("projects.knowledge.processing.stageReason", "原因")}: {section.reason}
                            </Typography.Text>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {pipelineTraceStages.length ? (
                  <div className={styles.projectKnowledgeNlpFlow}>
                    <div className={styles.projectKnowledgeNlpFlowHeader}>
                      <Typography.Text strong>
                        {t("projects.knowledge.processing.pipelineTraceTitle", "加工证据链")}
                      </Typography.Text>
                      <Typography.Text type="secondary">
                        {t("projects.knowledge.processing.pipelineTraceHint", "展示各层中间产物、摘要与落盘痕迹。")}
                      </Typography.Text>
                    </div>
                    <div className={styles.projectKnowledgeNlpFlowTrack}>
                      {pipelineTraceStages.map((stage) => (
                        <div
                          key={`${stage.key}-${stage.label}`}
                          className={`${styles.projectKnowledgeProcessingStageCard} ${styles.projectKnowledgeNlpFlowStage}`}
                        >
                          {(() => {
                            const stageReason = extractTraceStageReason({
                              status: stage.status,
                              metrics: stage.metrics,
                              summary: stage.summary,
                            });
                            return stageReason ? (
                              <Typography.Text type="secondary">
                                {t("projects.knowledge.processing.stageReason", "原因")}: {stageReason}
                              </Typography.Text>
                            ) : null;
                          })()}
                          <div className={styles.projectKnowledgeNlpFlowStageHeader}>
                            <div>
                              <Typography.Text strong>{stage.label}</Typography.Text>
                              <div className={styles.projectKnowledgeModeMeta}>
                                <Tag color={statusColor(stage.status)}>{statusLabel(stage.status, t)}</Tag>
                                <Tag bordered={false}>
                                  {stage.optional
                                    ? t("projects.knowledge.processing.optionalStage", "可选")
                                    : t("projects.knowledge.processing.requiredStageLabel", "必需阶段")}
                                </Tag>
                              </div>
                            </div>
                          </div>

                          <Typography.Paragraph type="secondary" className={styles.projectKnowledgeModeSummary}>
                            {stage.summary}
                          </Typography.Paragraph>

                          {Array.isArray(stage.summary_lines) && stage.summary_lines.length ? (
                            <div className={styles.projectKnowledgeProcessingArtifacts}>
                              {stage.summary_lines.slice(0, 3).map((line) => (
                                <Tag key={`${stage.key}-${line}`} bordered={false}>
                                  {line}
                                </Tag>
                              ))}
                            </div>
                          ) : null}

                          <div className={styles.projectKnowledgeProcessingStageMetrics}>
                            {selectTraceMetricEntries(stage.metrics || {}).map(([metricKey, metricValue]) => (
                              <div key={`${stage.key}-${metricKey}`} className={styles.projectKnowledgeProcessingStageMetric}>
                                <Typography.Text type="secondary">{formatTraceMetricLabel(metricKey, t)}</Typography.Text>
                                <Typography.Text strong>{formatTraceMetricValue(metricValue)}</Typography.Text>
                              </div>
                            ))}
                          </div>

                          {Array.isArray(stage.artifacts) && stage.artifacts.length ? (
                            <div className={styles.projectKnowledgeProcessingArtifacts}>
                              {stage.artifacts.slice(0, 3).map((artifact) => (
                                <Tooltip
                                  key={`${stage.key}-${artifact.kind}-${artifact.path}`}
                                  title={artifact.path || artifact.label || artifact.kind}
                                >
                                  <Tag bordered={false}>
                                    {formatArtifactLabel(artifact)}
                                  </Tag>
                                </Tooltip>
                              ))}
                            </div>
                          ) : (
                            <Typography.Text type="secondary">
                              {t("projects.knowledge.processing.noArtifacts", "当前阶段暂无可见落盘工件")}
                            </Typography.Text>
                          )}
                        </div>
                      ))}
                    </div>
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

                <div className={styles.projectKnowledgeNlpFlow}>
                  <div className={styles.projectKnowledgeNlpFlowHeader}>
                    <Typography.Text strong>
                      {t("projects.knowledge.processing.nerDiagnosticsTitle", "NER 诊断")}
                    </Typography.Text>
                    <Button size="small" onClick={() => setShowNerDiagnostics((prev) => !prev)}>
                      {showNerDiagnostics
                        ? t("projects.knowledge.processing.collapse", "收起")
                        : t("projects.knowledge.processing.expand", "展开")}
                    </Button>
                  </div>
                  {showNerDiagnostics ? (
                    <div className={styles.projectKnowledgeProcessingNerEmbed}>
                      <ProjectKnowledgeNerPanel knowledgeState={props.knowledgeState} />
                    </div>
                  ) : null}
                </div>

                <div className={styles.projectKnowledgeProcessingCardFooter}>
                  <div className={styles.projectKnowledgeProcessingLaunchControls}>
                    <div className={styles.projectKnowledgeProcessingStageSelector}>
                      <Typography.Text type="secondary">
                        {t("projects.knowledge.processing.quantStageLabel", "量化阶段")}
                      </Typography.Text>
                      <Segmented
                        size="small"
                        value={selectedStage}
                        options={stageOptions.map((stage) => ({
                          label: quantizationStageLabel(stage, t),
                          value: stage,
                        }))}
                        onChange={(value) => {
                          setSelectedStages((prev) => ({
                            ...prev,
                            [mode.mode]: value as ProjectKnowledgeQuantizationStage,
                          }));
                        }}
                      />
                    </div>
                    <Tooltip title={launchDisabled ? disabledReason : ""}>
                      <span title={launchDisabled ? disabledReason : undefined}>
                        <Button
                          size="small"
                          type="default"
                          loading={launchMode === mode.mode}
                          disabled={launchDisabled}
                          onClick={() => void props.knowledgeState.startProcessingMode(mode.mode, {
                            quantizationStage: selectedStage,
                          })}
                        >
                          {actionLabel(mode.mode, t)}
                        </Button>
                      </span>
                    </Tooltip>
                    {currentLaunchStage ? (
                      <Typography.Text type="secondary">
                        {t("projects.knowledge.processing.currentQuantStage", "当前发起阶段")}: {quantizationStageLabel(currentLaunchStage, t)}
                      </Typography.Text>
                    ) : null}
                  </div>
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
                "L2 提供实体与关系的结构化基础，L3 通过智能体对 NLP 结果进行审计增强与质量提升。",
              )}
            </Typography.Text>
          </div>
        ) : null}
      </div>
    </div>
  );
}