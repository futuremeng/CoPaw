import { Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Alert,
  Button,
  Empty,
  Input,
  Select,
  Spin,
  Tag,
  Typography,
  message,
} from "antd";
import { useTranslation } from "react-i18next";
import {
  limitGraphVisualizationRecords,
  recordsToVisualizationData,
} from "../Knowledge/graphQuery";
import { parseEdgeStrength } from "../Knowledge/graphVisualizationData";
import {
  appendUniqueContextLine,
  buildPathContextLine,
} from "../Knowledge/pathContext";
import {
  formatGraphEntityTypeLabel,
  formatGraphRelationTypeLabel,
} from "./projectKnowledgeFilterLabels";
import styles from "./index.module.less";
import type { ProjectKnowledgeProcessingMode, ProjectKnowledgeState } from "./useProjectKnowledgeState";

type ProjectKnowledgeNlpStageKey = "ner" | "syntax" | "cor";

const GraphQueryResults = lazy(async () => {
  const module = await import("../Knowledge/graphVisualization");
  return { default: module.GraphQueryResults };
});

const GraphVisualization = lazy(async () => {
  const module = await import("../Knowledge/graphVisualization");
  return { default: module.GraphVisualization };
});

interface ProjectKnowledgePanelProps {
  projectId: string;
  projectName: string;
  knowledgeState: ProjectKnowledgeState;
  requestedQuery?: string;
  onRequestedQueryHandled?: () => void;
  onOpenOutputs?: () => void;
  onOpenProcessing?: (
    mode?: ProjectKnowledgeProcessingMode,
    stage?: ProjectKnowledgeNlpStageKey,
  ) => void;
  graphComponents?: {
    GraphQueryResults: React.ComponentType<Record<string, unknown>>;
    GraphVisualization: React.ComponentType<Record<string, unknown>>;
  };
}

function ProjectKnowledgePanel(props: ProjectKnowledgePanelProps) {
  const { t } = useTranslation();
  const handledRequestedQueryRef = useRef("");
  const {
    graphComponents,
    knowledgeState,
    onOpenProcessing,
    onOpenOutputs,
    onRequestedQueryHandled,
    requestedQuery,
  } = props;
  const {
    graphQueryMode,
    graphResult,
    quantMetrics,
    runGraphQuery,
    setGraphQueryText,
  } = knowledgeState;

  const GraphQueryResultsComponent =
    graphComponents?.GraphQueryResults ?? GraphQueryResults;
  const GraphVisualizationComponent =
    graphComponents?.GraphVisualization ?? GraphVisualization;

  useEffect(() => {
    const normalizedRequestedQuery = (requestedQuery || "").trim();
    if (!normalizedRequestedQuery || handledRequestedQueryRef.current === normalizedRequestedQuery) {
      return;
    }
    handledRequestedQueryRef.current = normalizedRequestedQuery;
    setGraphQueryText(normalizedRequestedQuery);
    void runGraphQuery(
      normalizedRequestedQuery,
      graphQueryMode,
    );
    onRequestedQueryHandled?.();
  }, [
    graphQueryMode,
    onRequestedQueryHandled,
    requestedQuery,
    runGraphQuery,
    setGraphQueryText,
  ]);

  const visualizationData = useMemo(() => {
    if (!graphResult) {
      return null;
    }
    const visualizationRecords = limitGraphVisualizationRecords(
      graphResult.records,
      knowledgeState.graphQueryTopK,
    );
    return recordsToVisualizationData(
      visualizationRecords,
      graphResult.summary,
      graphResult.provenance,
    );
  }, [graphResult, knowledgeState.graphQueryTopK]);

  const maxByEntity = useMemo(
    () => Math.max(20, quantMetrics.entityCount || 200),
    [quantMetrics.entityCount],
  );

  const sourceOptions = useMemo(() => (
    knowledgeState.projectSources.map((source) => ({
      value: source.id,
      label: String(source.name || source.id || "").trim() || source.id,
    }))
  ), [knowledgeState.projectSources]);

  const effectiveSourceId = String(
    knowledgeState.selectedSourceId || sourceOptions[0]?.value || "",
  ).trim();

  const selectedSource = useMemo(() => (
    knowledgeState.projectSources.find((source) => source.id === effectiveSourceId)
    || null
  ), [effectiveSourceId, knowledgeState.projectSources]);

  const isSyncRunning = useMemo(() => {
    const status = String(knowledgeState.syncState?.status || "").trim().toLowerCase();
    return status === "pending" || status === "running" || status === "indexing" || status === "graphifying";
  }, [knowledgeState.syncState?.status]);

  const l1Status = useMemo(() => {
    // L1 状态已完全基于 interlinear 工件存在性
    if (!selectedSource) {
      return "missing";
    }
    // indexed 仅代表 interlinear 工件存在
    if (selectedSource.status?.indexed) {
      return "ready";
    }
    if (isSyncRunning) {
      return "running";
    }
    return "idle";
  }, [isSyncRunning, selectedSource]);

  const l2Mode = useMemo(() => (
    knowledgeState.processingCompareModes.find((mode) => mode.mode === "nlp")
    || knowledgeState.processingModes.find((mode) => mode.mode === "nlp")
    || null
  ), [knowledgeState.processingCompareModes, knowledgeState.processingModes]);

  const l3Mode = useMemo(() => (
    knowledgeState.processingCompareModes.find((mode) => mode.mode === "agentic")
    || knowledgeState.processingModes.find((mode) => mode.mode === "agentic")
    || null
  ), [knowledgeState.processingCompareModes, knowledgeState.processingModes]);

  const formatLayerStatus = useCallback((status: string) => {
    if (status === "ready") {
      return {
        text: t("projects.knowledge.processing.statusReady", "Ready"),
        color: "success",
      } as const;
    }
    if (status === "running") {
      return {
        text: t("projects.knowledge.processing.statusRunning", "Running"),
        color: "processing",
      } as const;
    }
    if (status === "queued") {
      return {
        text: t("projects.knowledge.processing.statusQueued", "Queued"),
        color: "gold",
      } as const;
    }
    if (status === "blocked") {
      return {
        text: t("projects.knowledge.processing.statusBlocked", "Blocked"),
        color: "orange",
      } as const;
    }
    if (status === "failed") {
      return {
        text: t("projects.knowledge.processing.statusFailed", "Failed"),
        color: "error",
      } as const;
    }
    if (status === "missing") {
      return {
        text: t("projects.knowledge.processing.statusMissing", "Missing"),
        color: "default",
      } as const;
    }
    return {
      text: t("projects.knowledge.processing.statusIdle", "Idle"),
      color: "default",
    } as const;
  }, [t]);

  const layerStatusItems = useMemo(() => {
    const l1 = formatLayerStatus(l1Status);
    const l2 = formatLayerStatus(String(l2Mode?.status || "idle").trim().toLowerCase());
    const l3 = formatLayerStatus(String(l3Mode?.status || "idle").trim().toLowerCase());
    return [
      {
        key: "l1",
        label: t("projects.knowledge.layerL1", "L1"),
        ...l1,
      },
      {
        key: "l2",
        label: t("projects.knowledge.layerL2", "L2"),
        ...l2,
      },
      {
        key: "l3",
        label: t("projects.knowledge.layerL3", "L3"),
        ...l3,
      },
    ];
  }, [formatLayerStatus, l1Status, l2Mode?.status, l3Mode?.status, t]);

  const knowledgeSnapshotCards = useMemo(() => {
    const metrics = knowledgeState.quantMetrics;
    return [
      {
        key: "documents",
        label: t("projects.knowledge.metricDocuments", "文档数"),
        value: metrics.documentCount || 0,
        hint: `${metrics.snapshotCount || 0} snapshots`,
      },
      {
        key: "chunks",
        label: t("projects.knowledge.metricChunks", "Chunk 数"),
        value: metrics.chunkCount || 0,
        hint: t("projects.knowledge.metricChunkHint", "切块是后续实体与句法的输入层"),
      },
      {
        key: "sentences",
        label: t("projects.knowledge.metricSentences", "句子数"),
        value: metrics.sentenceCount || 0,
        hint: `${metrics.sentenceWithEntitiesCount || 0} sentences with entities`,
      },
      {
        key: "entities",
        label: t("projects.knowledge.metricEntities", "实体 / 关系"),
        value: `${metrics.entityCount || 0} / ${metrics.relationCount || 0}`,
        hint: t("projects.knowledge.metricEntityHint", "当前图谱可见性与抽取质量的核心指标"),
      },
    ];
  }, [knowledgeState.quantMetrics, t]);

  const pipelineStageTags = useMemo(() => {
    const stages = knowledgeState.syncState?.pipeline_trace?.stages || [];
    return stages.slice(0, 3).map((stage) => ({
      key: `${stage.key}-${stage.label}`,
      label: stage.label,
      status: String(stage.status || "idle").trim().toLowerCase(),
      summary: stage.summary,
    }));
  }, [knowledgeState.syncState?.pipeline_trace?.stages]);

  const diagnosticsIssues = useMemo(() => {
    const issues: Array<{
      key: string;
      level: "warning" | "error";
      text: string;
      targetMode?: ProjectKnowledgeProcessingMode;
      targetStage?: ProjectKnowledgeNlpStageKey;
    }> = [];
    const l2ChunkCount = Math.max(0, Number(l2Mode?.chunkCount || quantMetrics.chunkCount || 0));
    const nlpStatus = String(l2Mode?.status || "idle").trim().toLowerCase();
    const nlpBusy = nlpStatus === "running" || nlpStatus === "queued";
    const nerReadyChunks = Math.max(0, Number(l2Mode?.nerReadyChunkCount || 0));
    const syntaxReadyChunks = Math.max(0, Number(l2Mode?.syntaxReadyChunkCount || 0));
    const corReadyChunks = Math.max(0, Number(l2Mode?.corReadyChunkCount || 0));
    const corReason = String(l2Mode?.corReason || l2Mode?.corReasonCode || "").trim();

    if ((nlpStatus === "failed" || nlpStatus === "blocked") && String(l2Mode?.summary || "").trim()) {
      issues.push({
        key: "nlp-blocked",
        level: "error",
        targetMode: "nlp",
        text: t("projects.knowledge.gapNlpBlocked", "NLP 主流程异常：{{reason}}", {
          reason: String(l2Mode?.summary || "").trim(),
        }),
      });
    }

    if (nlpBusy && l2ChunkCount > 0 && (nerReadyChunks <= 0 || syntaxReadyChunks <= 0)) {
      issues.push({
        key: "nlp-pending",
        level: "warning",
        targetMode: "nlp",
        targetStage: "ner",
        text: t("projects.knowledge.gapNlpPending", "NLP 处理中：NER/Syntax 关键产物尚未就绪"),
      });
    }

    if (!nlpBusy && l2ChunkCount > 0 && nerReadyChunks <= 0) {
      issues.push({
        key: "ner-empty",
        level: "error",
        targetMode: "nlp",
        targetStage: "ner",
        text: t("projects.knowledge.gapNerEmpty", "NER 未产出可用结果（0/{{documents}} 标准化文档）", {
          documents: l2ChunkCount,
        }),
      });
    }

    if (!nlpBusy && l2ChunkCount > 0 && syntaxReadyChunks <= 0) {
      issues.push({
        key: "syntax-empty",
        level: "warning",
        targetMode: "nlp",
        targetStage: "syntax",
        text: t("projects.knowledge.gapSyntaxEmpty", "Syntax 未产出可用结果（0/{{documents}} 标准化文档）", {
          documents: l2ChunkCount,
        }),
      });
    }

    if (!nlpBusy && l2ChunkCount > 0 && corReadyChunks <= 0 && corReason) {
      issues.push({
        key: "cor-unavailable",
        level: "warning",
        targetMode: "nlp",
        targetStage: "cor",
        text: t("projects.knowledge.gapCorUnavailable", "COR 不可用：{{reason}}", {
          reason: corReason,
        }),
      });
    }

    const nlpTraceStage = (knowledgeState.syncState?.pipeline_trace?.stages || [])
      .find((stage) => stage.key === "nlp");
    const nlpStageMetrics = nlpTraceStage?.metrics;
    const graphDocCount = typeof nlpStageMetrics?.document_graph_count === "number"
      ? nlpStageMetrics.document_graph_count
      : typeof nlpStageMetrics?.graph_document_count === "number"
        ? nlpStageMetrics.graph_document_count
        : null;
    if (!nlpBusy && graphDocCount === 0 && (quantMetrics.documentCount || 0) > 0) {
      issues.push({
        key: "graphify-empty",
        level: "warning",
        targetMode: "nlp",
        text: t("projects.knowledge.gapGraphifyEmpty", "Graphify 文档图为空：document_count=0"),
      });
    }

    return issues;
  }, [knowledgeState.syncState?.pipeline_trace?.stages, l2Mode, quantMetrics.chunkCount, quantMetrics.documentCount, t]);

  const diagnosticsAlertType = useMemo(() => (
    diagnosticsIssues.some((item) => item.level === "error") ? "error" : "warning"
  ), [diagnosticsIssues]);

  const activeEntityDetail = useMemo(() => {
    const nodeId = knowledgeState.activeGraphNodeId;
    if (!nodeId || !visualizationData) {
      return null;
    }
    const nodeMap = new Map(visualizationData.nodes.map((n) => [n.id, n]));
    const nodeLabel = nodeMap.get(nodeId)?.label || nodeId;
    const outgoing = visualizationData.edges
      .filter((e) => e.source === nodeId)
      .map((e) => ({
        edgeId: e.id,
        label: e.label,
        nodeId: e.target,
        nodeLabel: nodeMap.get(e.target)?.label || e.target,
        strength: parseEdgeStrength(e.confidence),
      }))
      .sort((a, b) => b.strength - a.strength);
    const incoming = visualizationData.edges
      .filter((e) => e.target === nodeId)
      .map((e) => ({
        edgeId: e.id,
        label: e.label,
        nodeId: e.source,
        nodeLabel: nodeMap.get(e.source)?.label || e.source,
        strength: parseEdgeStrength(e.confidence),
      }))
      .sort((a, b) => b.strength - a.strength);
    return { nodeId, nodeLabel, outgoing, incoming };
  }, [knowledgeState.activeGraphNodeId, visualizationData]);

  const queryControls = (
    <div className={styles.projectKnowledgeQueryTop}>
      <div className={styles.projectKnowledgeExploreSourcePanel}>
        <div className={styles.projectKnowledgeSourceRow}>
          <Typography.Text type="secondary">
            {t("projects.knowledge.dataSource", "Data Source")}
          </Typography.Text>
          <Select
            size="small"
            value={effectiveSourceId || undefined}
            classNames={{ popup: { root: styles.projectKnowledgeSelectDropdown } }}
            options={sourceOptions}
            placeholder={t("projects.knowledge.dataSourceSelect", "Select source")}
            onChange={(value) => {
              const next = String(value || "").trim();
              knowledgeState.setSelectedSourceId(next);
              if (next) {
                void knowledgeState.loadSourceSemantic(next);
                void knowledgeState.loadSourceContent(next);
              }
            }}
            style={{ minWidth: 220 }}
          />
        </div>
        <div className={styles.projectKnowledgeLayerStatusRow}>
          {layerStatusItems.map((item) => (
            <div key={item.key} className={styles.projectKnowledgeLayerStatusItem}>
              <Typography.Text type="secondary">{item.label}</Typography.Text>
              <Tag color={item.color}>{item.text}</Tag>
            </div>
          ))}
        </div>
      </div>
      {props.knowledgeState.graphNeedsRefresh ? (
        <Alert
          className={styles.projectKnowledgeQueryNotice}
          type="warning"
          showIcon
          message={t("projects.knowledge.refreshPending", "参数已变更，等待手动刷新")}
          description={t("projects.knowledge.refreshPendingHint", "请点击图谱区域右上角 Refresh 以应用最新设置。")}
        />
      ) : null}
      <div className={styles.projectKnowledgeControls}>
        <Select
          size="small"
          value={props.knowledgeState.graphQueryMode}
          classNames={{ popup: { root: styles.projectKnowledgeSelectDropdown } }}
          onChange={(value) => props.knowledgeState.setGraphQueryMode(value as "template" | "cypher")}
          options={[
            { label: t("projects.knowledge.queryModeTemplate"), value: "template" },
            { label: t("projects.knowledge.queryModeCypherMvp"), value: "cypher" },
          ]}
          style={{ width: 160 }}
        />
        <Select
          mode="multiple"
          size="small"
          value={props.knowledgeState.graphEntityTypeFilters}
          classNames={{ popup: { root: styles.projectKnowledgeSelectDropdown } }}
          onChange={(value) => props.knowledgeState.setGraphEntityTypeFilters((value as string[]).map(String))}
          options={props.knowledgeState.graphEntityTypeOptions.map((item) => ({
            label: formatGraphEntityTypeLabel(item, (key, defaultValue) => t(key, defaultValue)),
            value: item,
          }))}
          placeholder={t("projects.knowledge.entityTypeFilter", "Entity type filter (shows all by default)")}
          allowClear
          maxTagCount="responsive"
          style={{ minWidth: 180 }}
        />
        <Select
          mode="multiple"
          size="small"
          value={props.knowledgeState.graphRelationTypeFilters}
          classNames={{ popup: { root: styles.projectKnowledgeSelectDropdown } }}
          onChange={(value) => props.knowledgeState.setGraphRelationTypeFilters((value as string[]).map(String))}
          options={props.knowledgeState.graphRelationTypeOptions.map((item) => ({
            label: formatGraphRelationTypeLabel(item, (key, defaultValue) => t(key, defaultValue)),
            value: item,
          }))}
          placeholder={t("projects.knowledge.relationTypeFilter", "Relation type filter (shows all by default)")}
          allowClear
          maxTagCount="responsive"
          style={{ minWidth: 220 }}
        />
        <Input.Search
          value={props.knowledgeState.graphQueryText}
          onChange={(event) => props.knowledgeState.setGraphQueryText(event.target.value)}
          onSearch={(value) => {
            if (!value.trim() && props.knowledgeState.graphQueryMode === "cypher") {
              message.warning(t("projects.knowledge.emptyQuery"));
              return;
            }
            void props.knowledgeState.runGraphQuery(value);
          }}
          placeholder={t("projects.knowledge.queryPlaceholder")}
          enterButton={t("projects.knowledge.query")}
          loading={props.knowledgeState.graphLoading}
          allowClear
        />
      </div>
    </div>
  );

  return (
    <div className={`${styles.projectKnowledgeWorkbench} ${styles.projectKnowledgeWorkbenchCompact}`}>
      {props.knowledgeState.graphError ? (
        <Alert type="error" showIcon message={props.knowledgeState.graphError} />
      ) : null}

      <div className={styles.projectKnowledgeSignalGrid}>
        {knowledgeSnapshotCards.map((card) => (
          <div key={card.key} className={styles.projectKnowledgeSignalCard}>
            <Typography.Text type="secondary">{card.label}</Typography.Text>
            <Typography.Text strong>{card.value}</Typography.Text>
            <Typography.Text type="secondary">{card.hint}</Typography.Text>
          </div>
        ))}
      </div>

      {diagnosticsIssues.length ? (
        <Alert
          className={styles.projectKnowledgeQueryNotice}
          type={diagnosticsAlertType}
          showIcon
          message={t("projects.knowledge.gapSummaryTitle", "量化缺口摘要")}
          description={(
            <div>
              {diagnosticsIssues.map((item) => (
                <div key={item.key}>
                  {item.text}
                  {item.targetMode && onOpenProcessing ? (
                    <Button
                      type="link"
                      size="small"
                      onClick={() => onOpenProcessing(item.targetMode, item.targetStage)}
                    >
                      {t("projects.knowledge.openProcessingAction", "查看 Processing")}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        />
      ) : null}

      {pipelineStageTags.length ? (
        <div className={styles.projectKnowledgeLayerStatusRow}>
          {pipelineStageTags.map((stage) => (
            <div key={stage.key} className={styles.projectKnowledgeLayerStatusItem}>
              <Typography.Text type="secondary">{stage.label}</Typography.Text>
              <Tag
                color={
                  stage.status === "ready"
                    ? "success"
                    : stage.status === "failed"
                      ? "error"
                      : stage.status === "blocked"
                        ? "orange"
                        : stage.status === "running"
                          ? "processing"
                          : "default"
                }
              >
                {stage.summary}
              </Tag>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.projectKnowledgeWorkbenchSplit}>
        <div className={`${styles.projectKnowledgePrimaryPanel} ${styles.projectKnowledgeSurfaceFlat} ${styles.projectKnowledgeExplorePane}`}>
          {props.knowledgeState.graphLoading && !visualizationData ? (
            <div className={styles.projectKnowledgeEmpty}><Spin /></div>
          ) : visualizationData ? (
            <Suspense fallback={<div className={styles.projectKnowledgeEmpty}><Spin size="small" /></div>}>
              <GraphVisualizationComponent
                compact
                hideEntityDetail
                frameless
                data={visualizationData}
                loading={props.knowledgeState.graphLoading}
                topK={props.knowledgeState.graphQueryTopK}
                minTopK={20}
                maxTopK={maxByEntity}
                onTopKChange={(value) => {
                  const next = Math.max(20, Math.min(maxByEntity, Math.round(value)));
                  props.knowledgeState.setGraphQueryTopK(next);
                }}
                onTopKCommit={(value) => {
                  const next = Math.max(20, Math.min(maxByEntity, Math.round(value)));
                  props.knowledgeState.setGraphQueryTopK(next);
                  if (props.knowledgeState.graphQueryMode === "cypher" && !props.knowledgeState.graphQueryText.trim()) {
                    return;
                  }
                  void props.knowledgeState.runGraphQuery(undefined, undefined, next);
                }}
                activeNodeId={props.knowledgeState.activeGraphNodeId}
                onActiveNodeChange={props.knowledgeState.setActiveGraphNodeId}
                onNodeClick={(node) => props.knowledgeState.setActiveGraphNodeId(node.id)}
                onInsightFocusChange={(payload) => {
                  props.knowledgeState.setRelationKeywordSeed(payload.active ? payload.keyword : "");
                  if (payload.active && payload.keyword.trim()) {
                    onOpenOutputs?.();
                  }
                }}
                onUsePathContext={(pathSummary, runNow) => {
                  const contextLine = buildPathContextLine(pathSummary);
                  const nextQuery = appendUniqueContextLine(
                    props.knowledgeState.graphQueryText,
                    contextLine,
                  );
                  props.knowledgeState.setGraphQueryText(nextQuery);
                  if (runNow) {
                    void props.knowledgeState.runGraphQuery(nextQuery);
                  }
                }}
              />
            </Suspense>
          ) : (
            <div className={styles.projectKnowledgeEmpty}>
              <Empty description={t("projects.knowledge.emptyResult")} />
            </div>
          )}
        </div>

        <div className={`${styles.projectKnowledgeSecondaryPanel} ${styles.projectKnowledgeSurfaceFlat} ${styles.projectKnowledgeExplorePane} ${activeEntityDetail ? styles.projectKnowledgeQuerySplitPanel : ""}`}>
          {activeEntityDetail ? (
            <div className={styles.projectKnowledgeEntityDetailCol}>
              <div className={styles.projectKnowledgeEntityDetailHeader}>
                <Typography.Text strong>
                  {t("knowledge.graphQuery.entityDetail", "Entity Detail")}
                </Typography.Text>
                <Typography.Text type="secondary">{activeEntityDetail.nodeLabel}</Typography.Text>
              </div>
              <div className={styles.projectKnowledgeEntityDetailBody}>
                <div className={styles.projectKnowledgeEntitySection}>
                  <Typography.Text type="secondary">
                    {t("knowledge.graphQuery.outgoing", "Outgoing")} ({activeEntityDetail.outgoing.length})
                  </Typography.Text>
                  <div className={styles.projectKnowledgeEntityRelationList}>
                    {activeEntityDetail.outgoing.slice(0, 8).map((item) => (
                      <button
                        key={item.edgeId}
                        type="button"
                        className={styles.projectKnowledgeEntityRelationItem}
                        onClick={() => props.knowledgeState.setActiveGraphNodeId(item.nodeId)}
                      >
                        <span className={styles.projectKnowledgeEntityRelationLabel}>{item.label}</span>
                        <span className={styles.projectKnowledgeEntityRelationTarget}>{item.nodeLabel}</span>
                        <span className={styles.projectKnowledgeEntityRelationStrength}>{Math.round(item.strength * 100)}%</span>
                      </button>
                    ))}
                    {!activeEntityDetail.outgoing.length ? (
                      <Typography.Text type="secondary" className={styles.projectKnowledgeEntityEmpty}>
                        {t("knowledge.graphQuery.none", "None")}
                      </Typography.Text>
                    ) : null}
                  </div>
                </div>
                <div className={styles.projectKnowledgeEntitySection}>
                  <Typography.Text type="secondary">
                    {t("knowledge.graphQuery.incoming", "Incoming")} ({activeEntityDetail.incoming.length})
                  </Typography.Text>
                  <div className={styles.projectKnowledgeEntityRelationList}>
                    {activeEntityDetail.incoming.slice(0, 8).map((item) => (
                      <button
                        key={item.edgeId}
                        type="button"
                        className={styles.projectKnowledgeEntityRelationItem}
                        onClick={() => props.knowledgeState.setActiveGraphNodeId(item.nodeId)}
                      >
                        <span className={styles.projectKnowledgeEntityRelationTarget}>{item.nodeLabel}</span>
                        <span className={styles.projectKnowledgeEntityRelationLabel}>{item.label}</span>
                        <span className={styles.projectKnowledgeEntityRelationStrength}>{Math.round(item.strength * 100)}%</span>
                      </button>
                    ))}
                    {!activeEntityDetail.incoming.length ? (
                      <Typography.Text type="secondary" className={styles.projectKnowledgeEntityEmpty}>
                        {t("knowledge.graphQuery.none", "None")}
                      </Typography.Text>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <div className={styles.projectKnowledgeQueryCol}>
            {props.knowledgeState.graphLoading && !props.knowledgeState.graphResult ? (
              <div className={styles.projectKnowledgeExploreQueryPane}>
                {queryControls}
                <div className={styles.projectKnowledgeEmpty}><Spin /></div>
              </div>
            ) : props.knowledgeState.graphResult ? (
              <Suspense fallback={<div className={styles.projectKnowledgeEmpty}><Spin size="small" /></div>}>
                <GraphQueryResultsComponent
                  compact
                  frameless
                  title={t("projects.knowledge.query", "查询")}
                  queryHeader={queryControls}
                  records={props.knowledgeState.graphResult.records}
                  summary={props.knowledgeState.graphResult.summary}
                  warnings={props.knowledgeState.graphResult.warnings}
                  provenance={props.knowledgeState.graphResult.provenance}
                  query={props.knowledgeState.graphQueryText}
                  loading={props.knowledgeState.graphLoading}
                  activeNodeId={props.knowledgeState.activeGraphNodeId}
                  onRecordClick={props.knowledgeState.setActiveGraphNodeId}
                  onRefresh={() => {
                    void props.knowledgeState.runGraphQuery();
                  }}
                />
              </Suspense>
            ) : (
              <div className={styles.projectKnowledgeExploreQueryPane}>
                {queryControls}
                <div className={styles.projectKnowledgeEmpty}>
                  <Empty description={t("projects.knowledge.emptyResult")} />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(ProjectKnowledgePanel);
