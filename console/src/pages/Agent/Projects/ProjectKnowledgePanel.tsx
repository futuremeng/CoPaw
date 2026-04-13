import { Suspense, lazy, useEffect, useMemo, useRef } from "react";
import {
  Alert,
  Empty,
  Input,
  Select,
  Spin,
  message,
} from "antd";
import { useTranslation } from "react-i18next";
import { recordsToVisualizationData } from "../Knowledge/graphQuery";
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
  onOpenRelations?: () => void;
  graphComponents?: {
    GraphQueryResults: React.ComponentType<Record<string, unknown>>;
    GraphVisualization: React.ComponentType<Record<string, unknown>>;
  };
}

export default function ProjectKnowledgePanel(props: ProjectKnowledgePanelProps) {
  const { t } = useTranslation();
  const handledRequestedQueryRef = useRef("");
  const lastAutoMaxTopKRef = useRef<number | null>(null);
  const {
    graphComponents,
    knowledgeState,
    onOpenRelations,
    onRequestedQueryHandled,
    projectId,
    requestedQuery,
  } = props;

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
    knowledgeState.setGraphQueryText(normalizedRequestedQuery);
    void knowledgeState.runGraphQuery(
      normalizedRequestedQuery,
      knowledgeState.graphQueryMode,
    );
    onRequestedQueryHandled?.();
  }, [
    knowledgeState,
    onRequestedQueryHandled,
    requestedQuery,
  ]);

  const visualizationData = useMemo(() => {
    if (!knowledgeState.graphResult) {
      return null;
    }
    return recordsToVisualizationData(
      knowledgeState.graphResult.records,
      knowledgeState.graphResult.summary,
      knowledgeState.graphResult.provenance,
    );
  }, [knowledgeState.graphResult]);

  const maxByEntity = useMemo(
    () => Math.max(20, knowledgeState.quantMetrics.entityCount || 200),
    [knowledgeState.quantMetrics.entityCount],
  );

  useEffect(() => {
    lastAutoMaxTopKRef.current = null;
  }, [projectId]);

  useEffect(() => {
    const current = knowledgeState.graphQueryTopK;
    const prevAuto = lastAutoMaxTopKRef.current;
    const shouldAutoFollow = prevAuto === null || current === prevAuto;
    if (!shouldAutoFollow || current === maxByEntity) {
      return;
    }
    knowledgeState.setGraphQueryTopK(maxByEntity);
    lastAutoMaxTopKRef.current = maxByEntity;
  }, [knowledgeState, maxByEntity]);

  const queryControls = (
    <div className={styles.projectKnowledgeQueryTop}>
      <div className={styles.projectKnowledgeControls}>
        <Select
          size="small"
          value={props.knowledgeState.graphQueryMode}
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

      <div className={styles.projectKnowledgeWorkbenchSplit}>
        <div className={`${styles.projectKnowledgePrimaryPanel} ${styles.projectKnowledgeSurfaceFlat} ${styles.projectKnowledgeExplorePane}`}>
          {props.knowledgeState.graphLoading && !visualizationData ? (
            <div className={styles.projectKnowledgeEmpty}><Spin /></div>
          ) : visualizationData ? (
            <Suspense fallback={<div className={styles.projectKnowledgeEmpty}><Spin size="small" /></div>}>
              <GraphVisualizationComponent
                compact
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
                    onOpenRelations?.();
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

        <div className={`${styles.projectKnowledgeSecondaryPanel} ${styles.projectKnowledgeSurfaceFlat} ${styles.projectKnowledgeExplorePane}`}>
          {props.knowledgeState.graphLoading && !props.knowledgeState.graphResult ? (
            <div className={styles.projectKnowledgeExploreQueryPane}>
              {queryControls}
              <div className={styles.projectKnowledgeEmpty}><Spin /></div>
            </div>
          ) : props.knowledgeState.graphResult ? (
            <Suspense fallback={<div className={styles.projectKnowledgeEmpty}><Spin size="small" /></div>}>
              <GraphQueryResultsComponent
                compact
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
  );
}
