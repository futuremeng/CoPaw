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
    GraphQueryResults: React.ComponentType<any>;
    GraphVisualization: React.ComponentType<any>;
  };
}

export default function ProjectKnowledgePanel(props: ProjectKnowledgePanelProps) {
  const { t } = useTranslation();
  const handledRequestedQueryRef = useRef("");

  const GraphQueryResultsComponent =
    props.graphComponents?.GraphQueryResults ?? GraphQueryResults;
  const GraphVisualizationComponent =
    props.graphComponents?.GraphVisualization ?? GraphVisualization;

  useEffect(() => {
    const requestedQuery = (props.requestedQuery || "").trim();
    if (!requestedQuery || handledRequestedQueryRef.current === requestedQuery) {
      return;
    }
    handledRequestedQueryRef.current = requestedQuery;
    props.knowledgeState.setGraphQueryText(requestedQuery);
    void props.knowledgeState.runGraphQuery(
      requestedQuery,
      props.knowledgeState.graphQueryMode,
    );
    props.onRequestedQueryHandled?.();
  }, [props]);

  const visualizationData = useMemo(() => {
    if (!props.knowledgeState.graphResult) {
      return null;
    }
    return recordsToVisualizationData(
      props.knowledgeState.graphResult.records,
      props.knowledgeState.graphResult.summary,
      props.knowledgeState.graphResult.provenance,
    );
  }, [props.knowledgeState.graphResult]);

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
                activeNodeId={props.knowledgeState.activeGraphNodeId}
                onActiveNodeChange={props.knowledgeState.setActiveGraphNodeId}
                onNodeClick={(node) => props.knowledgeState.setActiveGraphNodeId(node.id)}
                onInsightFocusChange={(payload) => {
                  props.knowledgeState.setRelationKeywordSeed(payload.active ? payload.keyword : "");
                  if (payload.active && payload.keyword.trim()) {
                    props.onOpenRelations?.();
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
