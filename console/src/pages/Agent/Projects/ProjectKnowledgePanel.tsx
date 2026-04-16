import { Suspense, lazy, memo, useEffect, useMemo, useRef } from "react";
import {
  Alert,
  Empty,
  Input,
  Select,
  Spin,
  Typography,
  message,
} from "antd";
import { useTranslation } from "react-i18next";
import { recordsToVisualizationData } from "../Knowledge/graphQuery";
import { parseEdgeStrength } from "../Knowledge/graphVisualizationData";
import {
  appendUniqueContextLine,
  buildPathContextLine,
} from "../Knowledge/pathContext";
import styles from "./index.module.less";
import type { ProjectKnowledgeState } from "./useProjectKnowledgeState";

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
    return recordsToVisualizationData(
      graphResult.records,
      graphResult.summary,
      graphResult.provenance,
    );
  }, [graphResult]);

  const maxByEntity = useMemo(
    () => Math.max(20, quantMetrics.entityCount || 200),
    [quantMetrics.entityCount],
  );

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
        <Input.Search
          value={props.knowledgeState.graphQueryText}
          onChange={(event) => props.knowledgeState.setGraphQueryText(event.target.value)}
          onSearch={(value) => {
            if (!value.trim()) {
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
      {props.knowledgeState.graphNeedsRefresh ? (
        <Alert
          type="warning"
          showIcon
          message={t("projects.knowledge.refreshPending", "参数已变更，等待手动刷新")}
          description={t("projects.knowledge.refreshPendingHint", "请点击图谱区域右上角 Refresh 以应用最新设置。")}
        />
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
                  if (props.knowledgeState.graphQueryText.trim()) {
                    void props.knowledgeState.runGraphQuery(undefined, undefined, next);
                  }
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
