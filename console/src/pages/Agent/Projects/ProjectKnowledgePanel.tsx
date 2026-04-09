import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Space,
  Spin,
  Typography,
  message,
} from "antd";
import { useTranslation } from "react-i18next";
import api, { type GraphQueryResponse } from "../../../api";
import { recordsToVisualizationData } from "../Knowledge/graphQuery";
import { GraphQueryResults, GraphVisualization } from "../Knowledge/graphVisualization";
import styles from "./index.module.less";

interface ProjectKnowledgePanelProps {
  projectId: string;
  projectName: string;
}

const PROJECT_GRAPH_TOP_K = 12;
const PROJECT_GRAPH_TIMEOUT_SEC = 20;

export default function ProjectKnowledgePanel(props: ProjectKnowledgePanelProps) {
  const { t } = useTranslation();
  const [queryText, setQueryText] = useState("");
  const [includeGlobal, setIncludeGlobal] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<GraphQueryResponse | null>(null);

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
          mode: "template",
          topK: PROJECT_GRAPH_TOP_K,
          timeoutSec: PROJECT_GRAPH_TIMEOUT_SEC,
          projectScope: [props.projectId],
          includeGlobal,
        });
        setResult(response);
      } catch (err) {
        const messageText =
          err instanceof Error ? err.message : t("projects.knowledge.queryFailed");
        setError(messageText);
        message.error(messageText);
      } finally {
        setLoading(false);
      }
    },
    [includeGlobal, props.projectId, queryText, t],
  );

  const visualizationData = useMemo(() => {
    if (!result) {
      return null;
    }
    return recordsToVisualizationData(result.records, result.summary, result.provenance);
  }, [result]);

  return (
    <Card
      size="small"
      title={t("projects.knowledge.title")}
      className={styles.projectKnowledgeCard}
    >
      <Typography.Text type="secondary">
        {t("projects.knowledge.hint", {
          project: props.projectName || props.projectId,
        })}
      </Typography.Text>

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
        <Space wrap>
          <Checkbox
            checked={includeGlobal}
            onChange={(event) => setIncludeGlobal(event.target.checked)}
          >
            {t("projects.knowledge.includeGlobal")}
          </Checkbox>
          <Button
            disabled={!result}
            onClick={() => {
              setError("");
              setResult(null);
            }}
          >
            {t("projects.knowledge.reset")}
          </Button>
        </Space>
      </div>

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
        <div className={styles.projectKnowledgeResults}>
          <GraphQueryResults
            records={result.records}
            summary={result.summary}
            warnings={result.warnings}
            provenance={result.provenance}
            query={queryText}
            loading={loading}
            onRefresh={() => {
              void handleQuery();
            }}
          />
          {visualizationData ? <GraphVisualization data={visualizationData} loading={loading} /> : null}
        </div>
      ) : null}
    </Card>
  );
}
