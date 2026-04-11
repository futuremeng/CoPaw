import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Select,
  Space,
  Spin,
  Typography,
  message,
} from "antd";
import { useTranslation } from "react-i18next";
import api, { type GraphQueryResponse } from "../../../api";
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
  includeGlobal?: boolean;
  projectId: string;
  projectName: string;
  knowledgeState: ProjectKnowledgeState;
  requestedQuery?: string;
  onRequestedQueryHandled?: () => void;
  graphComponents?: {
    GraphQueryResults: React.ComponentType<any>;
    GraphVisualization: React.ComponentType<any>;
  };
}

interface ProjectKnowledgeUiPrefs {
  queryExpanded: boolean;
  resultExpanded: boolean;
}

const PROJECT_GRAPH_TOP_K = 12;
const PROJECT_GRAPH_TIMEOUT_SEC = 20;
const PROJECT_KNOWLEDGE_UI_PREFS_PREFIX = "copaw.project.knowledge.ui.v1";

function uiPrefsStorageKey(projectId: string): string {
  return `${PROJECT_KNOWLEDGE_UI_PREFS_PREFIX}.${projectId || "default"}`;
}

function loadUiPrefs(projectId: string): ProjectKnowledgeUiPrefs {
  const fallback: ProjectKnowledgeUiPrefs = {
    queryExpanded: true,
    resultExpanded: true,
  };
  try {
    const raw = window.localStorage.getItem(uiPrefsStorageKey(projectId));
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<ProjectKnowledgeUiPrefs>;
    return {
      queryExpanded:
        typeof parsed.queryExpanded === "boolean"
          ? parsed.queryExpanded
          : fallback.queryExpanded,
      resultExpanded:
        typeof parsed.resultExpanded === "boolean"
          ? parsed.resultExpanded
          : fallback.resultExpanded,
    };
  } catch {
    return fallback;
  }
}

function saveUiPrefs(projectId: string, prefs: ProjectKnowledgeUiPrefs): void {
  try {
    window.localStorage.setItem(uiPrefsStorageKey(projectId), JSON.stringify(prefs));
  } catch {
    // Ignore localStorage quota or availability issues.
  }
}

export default function ProjectKnowledgePanel(props: ProjectKnowledgePanelProps) {
  const { t } = useTranslation();
  const [queryText, setQueryText] = useState("");
  const [queryMode, setQueryMode] = useState<"template" | "cypher">("template");
  const [internalIncludeGlobal] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GraphQueryResponse | null>(null);
  const [activeGraphNodeId, setActiveGraphNodeId] = useState<string | null>(null);
  const [queryExpanded, setQueryExpanded] = useState(true);
  const [resultExpanded, setResultExpanded] = useState(true);
  const handledSyncFinishRef = useRef("");
  const handledRequestedQueryRef = useRef("");

  const includeGlobal = props.includeGlobal ?? internalIncludeGlobal;
  const GraphQueryResultsComponent =
    props.graphComponents?.GraphQueryResults ?? GraphQueryResults;
  const GraphVisualizationComponent =
    props.graphComponents?.GraphVisualization ?? GraphVisualization;

  useEffect(() => {
    const prefs = loadUiPrefs(props.projectId);
    setQueryExpanded(prefs.queryExpanded);
    setResultExpanded(prefs.resultExpanded);
  }, [props.projectId]);

  useEffect(() => {
    saveUiPrefs(props.projectId, {
      queryExpanded,
      resultExpanded,
    });
  }, [props.projectId, queryExpanded, resultExpanded]);

  const handleQuery = useCallback(
    async (overrideQuery?: string) => {
      const query = (overrideQuery ?? queryText).trim();
      if (!query) {
        message.warning(t("projects.knowledge.emptyQuery"));
        return;
      }

      try {
        setLoading(true);
        setError("");
        const response = await api.graphQuery({
          query,
          mode: queryMode,
          topK: PROJECT_GRAPH_TOP_K,
          timeoutSec: PROJECT_GRAPH_TIMEOUT_SEC,
          projectScope: [props.projectId],
          includeGlobal,
          projectId: props.projectId,
        });
        setResult(response);
        setActiveGraphNodeId(null);
        setResultExpanded(true);
      } catch (err) {
        const messageText =
          err instanceof Error ? err.message : t("projects.knowledge.queryFailed");
        setError(messageText);
        message.error(messageText);
      } finally {
        setLoading(false);
      }
    },
    [includeGlobal, props.projectId, queryMode, queryText, t],
  );

  useEffect(() => {
    const finishToken = props.knowledgeState.syncState?.last_finished_at || "";
    if (!finishToken || handledSyncFinishRef.current === finishToken) {
      return;
    }
    handledSyncFinishRef.current = finishToken;
    if ((queryText || "").trim()) {
      void handleQuery();
    }
  }, [handleQuery, props.knowledgeState.syncState?.last_finished_at, queryText]);

  useEffect(() => {
    const requestedQuery = (props.requestedQuery || "").trim();
    if (!requestedQuery || handledRequestedQueryRef.current === requestedQuery) {
      return;
    }
    handledRequestedQueryRef.current = requestedQuery;
    setQueryText(requestedQuery);
    setQueryExpanded(true);
    setResultExpanded(true);
    void handleQuery(requestedQuery);
    props.onRequestedQueryHandled?.();
  }, [handleQuery, props.onRequestedQueryHandled, props.requestedQuery]);

  const visualizationData = useMemo(() => {
    if (!result) {
      return null;
    }
    return recordsToVisualizationData(result.records, result.summary, result.provenance);
  }, [result]);

  return (
    <Card
      size="small"
      title={(
        <div className={styles.projectKnowledgeCardHeader}>
          <Typography.Text strong className={styles.projectKnowledgeCardTitle}>
            {t("projects.knowledgeDock.tabExplore", "Explore")}
          </Typography.Text>
        </div>
      )}
      className={styles.projectKnowledgeCard}
    >
      <Typography.Text type="secondary">
        {t("projects.knowledge.hint", {
          project: props.projectName || props.projectId,
        })}
      </Typography.Text>

      <div className={styles.projectKnowledgeQueryHeader}>
        <Space size={6} wrap>
          <Typography.Text type="secondary">
            {t("projects.knowledge.queryMode")}
          </Typography.Text>
          <Select
            size="small"
            value={queryMode}
            onChange={(value) => setQueryMode(value as "template" | "cypher")}
            options={[
              { label: t("projects.knowledge.queryModeTemplate"), value: "template" },
              { label: t("projects.knowledge.queryModeCypherMvp"), value: "cypher" },
            ]}
            style={{ width: 160 }}
          />
        </Space>
        <Button
          size="small"
          type="text"
          onClick={() => setQueryExpanded((prev) => !prev)}
        >
          {queryExpanded ? t("common.collapse", "Collapse") : t("common.expand", "Expand")}
        </Button>
      </div>

      {queryExpanded ? (
        <div className={styles.projectKnowledgeControls}>
          <Input.Search
            value={queryText}
            onChange={(event) => setQueryText(event.target.value)}
            onSearch={(value) => {
              void handleQuery(value);
            }}
            placeholder={t("projects.knowledge.queryPlaceholder")}
            enterButton={t("projects.knowledge.query")}
            loading={loading}
            allowClear
          />
          <Button
            size="small"
            disabled={!result}
            onClick={() => {
              setError("");
              setResult(null);
              setActiveGraphNodeId(null);
            }}
          >
            {t("projects.knowledge.reset")}
          </Button>
        </div>
      ) : null}

      {error ? <Alert type="error" showIcon message={error} /> : null}

      {loading && !result ? (
        <div className={styles.projectKnowledgeEmpty}>
          <Spin />
        </div>
      ) : null}

      {!loading && !result ? (
        <div className={styles.projectKnowledgeEmpty}>
          <Empty description={t("projects.knowledge.emptyResult")} />
        </div>
      ) : null}

      {result ? (
        <div className={styles.projectKnowledgeResultHeader}>
          <Typography.Text type="secondary">{t("projects.knowledge.query")}</Typography.Text>
          <Button
            size="small"
            type="text"
            onClick={() => setResultExpanded((prev) => !prev)}
          >
            {resultExpanded ? t("common.collapse", "Collapse") : t("common.expand", "Expand")}
          </Button>
        </div>
      ) : null}

      {result && resultExpanded ? (
        <div className={styles.projectKnowledgeResults}>
          <Suspense fallback={<div className={styles.projectKnowledgeEmpty}><Spin size="small" /></div>}>
            <GraphQueryResultsComponent
              records={result.records}
              summary={result.summary}
              warnings={result.warnings}
              provenance={result.provenance}
              query={queryText}
              loading={loading}
              activeNodeId={activeGraphNodeId}
              onRecordClick={setActiveGraphNodeId}
              onRefresh={() => {
                void handleQuery();
              }}
            />
            {visualizationData ? (
              <GraphVisualizationComponent
                data={visualizationData}
                loading={loading}
                activeNodeId={activeGraphNodeId}
                onActiveNodeChange={setActiveGraphNodeId}
                onNodeClick={(node) => setActiveGraphNodeId(node.id)}
                onUsePathContext={(pathSummary, runNow) => {
                  const contextLine = buildPathContextLine(pathSummary);
                  setQueryText((prev) => {
                    const nextQuery = appendUniqueContextLine(prev, contextLine);
                    if (runNow) {
                      setQueryExpanded(true);
                      setResultExpanded(true);
                      void handleQuery(nextQuery);
                    }
                    return nextQuery;
                  });
                }}
              />
            ) : null}
          </Suspense>
        </div>
      ) : null}
    </Card>
  );
}