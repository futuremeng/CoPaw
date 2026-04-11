import { Button, Card, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";
import type { ProjectKnowledgeState } from "./useProjectKnowledgeState";

interface ProjectKnowledgeInsightsPanelProps {
  knowledgeState: ProjectKnowledgeState;
  onOpenSettings?: () => void;
  onRunSuggestedQuery?: (query: string) => void;
}

export default function ProjectKnowledgeInsightsPanel(
  props: ProjectKnowledgeInsightsPanelProps,
) {
  const { t } = useTranslation();
  const { knowledgeState, onOpenSettings, onRunSuggestedQuery } = props;

  return (
    <Card
      size="small"
      title={t("projects.knowledgeDock.tabInsights", "Insights")}
      className={styles.projectKnowledgeCard}
    >
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <div className={styles.projectKnowledgeInsightBar}>
          <Typography.Text type="secondary">{t(knowledgeState.insightMessageKey)}</Typography.Text>
          <Space wrap className={styles.projectKnowledgeInsightActions}>
            {knowledgeState.insightAction === "settings" ? (
              <Button size="small" type="primary" onClick={onOpenSettings}>
                {t("projects.knowledge.actionOpenSettings", "Open settings")}
              </Button>
            ) : null}
            {knowledgeState.insightAction === "query" ? (
              <Button
                size="small"
                type="primary"
                onClick={() => onRunSuggestedQuery?.(knowledgeState.suggestedQuery)}
              >
                {t("projects.knowledge.actionRunSuggestedQuery")}
              </Button>
            ) : null}
          </Space>
        </div>

        <div className={styles.projectKnowledgeSignalGrid}>
          <div className={styles.projectKnowledgeSignalCard}>
            <Typography.Text type="secondary">
              {t("projects.knowledge.signalDocuments")}
            </Typography.Text>
            <Typography.Text strong>{knowledgeState.quantMetrics.documentCount}</Typography.Text>
          </div>
          <div className={styles.projectKnowledgeSignalCard}>
            <Typography.Text type="secondary">
              {t("projects.knowledge.signalChunks")}
            </Typography.Text>
            <Typography.Text strong>{knowledgeState.quantMetrics.chunkCount}</Typography.Text>
          </div>
          <div className={styles.projectKnowledgeSignalCard}>
            <Typography.Text type="secondary">
              {t("projects.knowledge.signalRelations")}
            </Typography.Text>
            <Typography.Text strong>{knowledgeState.quantMetrics.relationCount}</Typography.Text>
          </div>
          <div className={styles.projectKnowledgeSignalCard}>
            <Typography.Text type="secondary">
              {t("projects.knowledge.insightSuggestedQuery", "Suggested query")}
            </Typography.Text>
            <Typography.Text>{knowledgeState.suggestedQuery}</Typography.Text>
          </div>
        </div>
      </Space>
    </Card>
  );
}