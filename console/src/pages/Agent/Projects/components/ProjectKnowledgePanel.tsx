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
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  limitGraphVisualizationRecords,
  recordsToVisualizationData,
} from "../../Knowledge/graphQuery";
import { parseEdgeStrength } from "../../Knowledge/graphVisualizationData";
import {
  appendUniqueContextLine,
  buildPathContextLine,
} from "../../Knowledge/pathContext";
import {
  formatGraphEntityTypeLabel,
  formatGraphRelationTypeLabel,
} from "../utils/projectKnowledgeFilterLabels";
import { buildProjectKnowledgeLatestSummaryModelFromState } from "../utils/projectKnowledgeLatestSummaryModel";
import styles from "../index.module.less";
import type { ProjectKnowledgeProcessingMode, ProjectKnowledgeState } from "../hooks/useProjectKnowledgeState";

type ProjectKnowledgeNlpStageKey = "tokenize" | "ner" | "syntax" | "cor";

const GraphQueryResults = lazy(async () => {
  const module = await import("../../Knowledge/graphVisualization");
  return { default: module.GraphQueryResults };
});

const GraphVisualization = lazy(async () => {
  const module = await import("../../Knowledge/graphVisualization");
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

function resolvePipelineStageLabel(
  stage: { key?: string | null; label?: string | null; label_key?: string | null },
  t: TFunction,
): string {
  const explicitKey = String(stage.label_key || "").trim();
  if (explicitKey) {
    const fallback = String(stage.label || stage.key || "").trim() || explicitKey;
    return t(explicitKey, fallback);
  }

  const stageKey = String(stage.key || "").trim();
  if (stageKey === "fast" || stageKey === "nlp" || stageKey === "agentic") {
    return t(`copaw.projects.knowledge.pipelineStage.${stageKey}`, String(stage.label || "").trim() || stageKey);
  }

  return String(stage.label || stageKey).trim();
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

  const nlpMode = useMemo(() => (
    knowledgeState.processingCompareModes.find((mode) => mode.mode === "nlp")
    || knowledgeState.processingModes.find((mode) => mode.mode === "nlp")
    || null
  ), [knowledgeState.processingCompareModes, knowledgeState.processingModes]);

  const agenticMode = useMemo(() => (
    knowledgeState.processingCompareModes.find((mode) => mode.mode === "agentic")
    || knowledgeState.processingModes.find((mode) => mode.mode === "agentic")
    || null
  ), [knowledgeState.processingCompareModes, knowledgeState.processingModes]);

  const formatLayerStatus = useCallback((status: string) => {
    if (status === "ready") {
      return {
        text: t("copaw.projects.knowledge.processing.statusReady"),
        color: "success",
      } as const;
    }
    if (status === "running") {
      return {
        text: t("copaw.projects.knowledge.processing.statusRunning"),
        color: "processing",
      } as const;
    }
    if (status === "queued") {
      return {
        text: t("copaw.projects.knowledge.processing.statusQueued"),
        color: "gold",
      } as const;
    }
    if (status === "blocked") {
      return {
        text: t("copaw.projects.knowledge.processing.statusBlocked"),
        color: "orange",
      } as const;
    }
    if (status === "failed") {
      return {
        text: t("copaw.projects.knowledge.processing.statusFailed"),
        color: "error",
      } as const;
    }
    if (status === "missing") {
      return {
        text: t("copaw.projects.knowledge.processing.statusMissing"),
        color: "default",
      } as const;
    }
    return {
      text: t("copaw.projects.knowledge.processing.statusIdle"),
      color: "default",
    } as const;
  }, [t]);

  const layerStatusItems = useMemo(() => {
    const l1 = formatLayerStatus(l1Status);
    const l2 = formatLayerStatus(String(nlpMode?.status || "idle").trim().toLowerCase());
    const l3 = formatLayerStatus(String(agenticMode?.status || "idle").trim().toLowerCase());
    return [
      {
        key: "l1",
        label: t("copaw.projects.knowledge.layerL1"),
        ...l1,
      },
      {
        key: "l2",
        label: t("copaw.projects.knowledge.layerL2"),
        ...l2,
      },
      {
        key: "l3",
        label: t("copaw.projects.knowledge.layerL3"),
        ...l3,
      },
    ];
  }, [formatLayerStatus, l1Status, nlpMode?.status, agenticMode?.status, t]);

  const knowledgeSnapshotCards = useMemo(() => {
    const metrics = knowledgeState.quantMetrics;
    return [
      {
        key: "documents",
        label: t("copaw.projects.knowledge.metricDocuments"),
        value: metrics.documentCount || 0,
        hint: `${metrics.snapshotCount || 0} snapshots`,
      },
      {
        key: "chunks",
        label: t("copaw.projects.knowledge.metricChunks"),
        value: metrics.chunkCount || 0,
        hint: t("copaw.projects.knowledge.metricChunkHint"),
      },
      {
        key: "sentences",
        label: t("copaw.projects.knowledge.metricSentences"),
        value: metrics.sentenceCount || 0,
        hint: `${metrics.sentenceWithEntitiesCount || 0} sentences with entities`,
      },
      {
        key: "entities",
        label: t("copaw.projects.knowledge.metricEntities"),
        value: `${metrics.entityCount || 0} / ${metrics.relationCount || 0}`,
        hint: t("copaw.projects.knowledge.metricEntityHint"),
      },
    ];
  }, [knowledgeState.quantMetrics, t]);

  const latestSummaryModel = useMemo(() => buildProjectKnowledgeLatestSummaryModelFromState(t, knowledgeState), [
    knowledgeState.fileAnalysisStats?.latest,
    knowledgeState.outputResolution.activeMode,
    knowledgeState.projectStepStats.build_interlinear?.latest,
    knowledgeState.projectStepStats.tokenize?.latest,
    knowledgeState.projectStepStats.pos_tagging?.latest,
    knowledgeState.projectStepStats.syntax_parse?.latest,
    knowledgeState.projectStepStats.semantic_role_labeling?.latest,
    knowledgeState.sourceScanStats?.latest,
    t,
  ]);

  const pipelineStageTags = useMemo(() => {
    const stages = knowledgeState.syncState?.pipeline_trace?.stages || [];
    return stages.slice(0, 3).map((stage) => ({
      key: `${stage.key}-${stage.label}`,
      label: resolvePipelineStageLabel(stage, t),
      status: String(stage.status || "idle").trim().toLowerCase(),
      summary: stage.summary,
    }));
  }, [knowledgeState.syncState?.pipeline_trace?.stages, t]);

  const diagnosticsIssues = useMemo(() => {
    const issues: Array<{
      key: string;
      level: "warning" | "error";
      text: string;
      targetMode?: ProjectKnowledgeProcessingMode;
      targetStage?: ProjectKnowledgeNlpStageKey;
    }> = [];
    const l2ChunkCount = Math.max(0, Number(nlpMode?.chunkCount || quantMetrics.chunkCount || 0));
    const nlpStatus = String(nlpMode?.status || "idle").trim().toLowerCase();
    const nlpBusy = nlpStatus === "running" || nlpStatus === "queued";
    const nerReadyChunks = Math.max(0, Number(nlpMode?.nerReadyChunkCount || 0));
    const syntaxReadyChunks = Math.max(0, Number(nlpMode?.syntaxReadyChunkCount || 0));
    const corReadyChunks = Math.max(0, Number(nlpMode?.corReadyChunkCount || 0));
    const corReason = String(nlpMode?.corReason || nlpMode?.corReasonCode || "").trim();

    if ((nlpStatus === "failed" || nlpStatus === "blocked") && String(nlpMode?.summary || "").trim()) {
      issues.push({
        key: "nlp-blocked",
        level: "error",
        targetMode: "nlp",
        text: t("copaw.projects.knowledge.gapNlpBlocked", {
          reason: String(nlpMode?.summary || "").trim(),
        }),
      });
    }

    if (nlpBusy && l2ChunkCount > 0 && (nerReadyChunks <= 0 || syntaxReadyChunks <= 0)) {
      issues.push({
        key: "nlp-pending",
        level: "warning",
        targetMode: "nlp",
        targetStage: "ner",
        text: t("copaw.projects.knowledge.gapNlpPending"),
      });
    }

    if (!nlpBusy && l2ChunkCount > 0 && nerReadyChunks <= 0) {
      issues.push({
        key: "ner-empty",
        level: "error",
        targetMode: "nlp",
        targetStage: "ner",
        text: t("copaw.projects.knowledge.gapNerEmpty", {
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
        text: t("copaw.projects.knowledge.gapSyntaxEmpty", {
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
        text: t("copaw.projects.knowledge.gapCorUnavailable", {
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
        text: t("copaw.projects.knowledge.gapGraphifyEmpty"),
      });
    }

    return issues;
  }, [knowledgeState.syncState?.pipeline_trace?.stages, nlpMode, quantMetrics.chunkCount, quantMetrics.documentCount, t]);

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
            {t("copaw.projects.knowledge.dataSource")}
          </Typography.Text>
          <Select
            size="small"
            value={effectiveSourceId || undefined}
            classNames={{ popup: { root: styles.projectKnowledgeSelectDropdown } }}
            options={sourceOptions}
            placeholder={t("copaw.projects.knowledge.dataSourceSelect")}
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
          message={t("copaw.projects.knowledge.refreshPending")}
          description={t("copaw.projects.knowledge.refreshPendingHint")}
        />
      ) : null}
      <div className={styles.projectKnowledgeControls}>
        <Select
          size="small"
          value={props.knowledgeState.graphQueryMode}
          classNames={{ popup: { root: styles.projectKnowledgeSelectDropdown } }}
          onChange={(value) => props.knowledgeState.setGraphQueryMode(value as "template" | "cypher")}
          options={[
            { label: t("copaw.projects.knowledge.queryModeTemplate"), value: "template" },
            { label: t("copaw.projects.knowledge.queryModeCypherMvp"), value: "cypher" },
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
          placeholder={t("copaw.projects.knowledge.entityTypeFilter")}
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
          placeholder={t("copaw.projects.knowledge.relationTypeFilter")}
          allowClear
          maxTagCount="responsive"
          style={{ minWidth: 220 }}
        />
        <Input.Search
          value={props.knowledgeState.graphQueryText}
          onChange={(event) => props.knowledgeState.setGraphQueryText(event.target.value)}
          onSearch={(value) => {
            if (!value.trim() && props.knowledgeState.graphQueryMode === "cypher") {
              message.warning(t("copaw.projects.knowledge.emptyQuery"));
              return;
            }
            void props.knowledgeState.runGraphQuery(value);
          }}
          placeholder={t("copaw.projects.knowledge.queryPlaceholder")}
          enterButton={t("copaw.projects.knowledge.query")}
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

      {latestSummaryModel.workflowParts.length ? (
        <Alert
          className={styles.projectKnowledgeQueryNotice}
          type="info"
          showIcon
          message={t("copaw.projects.knowledge.latestWorkflowSummary")}
          description={latestSummaryModel.workflowParts.join(" · ")}
        />
      ) : null}

      {diagnosticsIssues.length ? (
        <Alert
          className={styles.projectKnowledgeQueryNotice}
          type={diagnosticsAlertType}
          showIcon
          message={t("copaw.projects.knowledge.gapSummaryTitle")}
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
                      {t("copaw.projects.knowledge.openProcessingAction")}
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
              <Empty description={t("copaw.projects.knowledge.emptyResult")} />
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
                  title={t("copaw.projects.knowledge.query")}
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
                  <Empty description={t("copaw.projects.knowledge.emptyResult")} />
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
