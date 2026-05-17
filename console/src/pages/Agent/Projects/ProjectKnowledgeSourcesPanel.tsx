import { InfoCircleOutlined } from "@ant-design/icons";
import { Tooltip, Typography } from "antd";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";
import { buildProjectKnowledgeSourcesRecentHistorySectionsFromState } from "./projectKnowledgeRecentHistoryModel";
import type { ProjectKnowledgeState } from "./useProjectKnowledgeState";

interface ProjectKnowledgeSourcesPanelProps {
  knowledgeState: ProjectKnowledgeState;
}

export default function ProjectKnowledgeSourcesPanel(props: ProjectKnowledgeSourcesPanelProps) {
  const { t } = useTranslation();
  const { knowledgeState } = props;
  const recentHistorySections = buildProjectKnowledgeSourcesRecentHistorySectionsFromState(t, knowledgeState);

  return (
    <div className={styles.projectKnowledgeWorkbench}>
      <div className={styles.projectKnowledgeTabHeader}>
        <div>
          <div className={styles.projectKnowledgeSectionTitleRow}>
            <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
              {t("projects.knowledgeDock.tabSources", "Sources")}
            </Typography.Title>
            <Tooltip title={t("copaw.projects.knowledge.sourcesRoleHint")}>
              <InfoCircleOutlined className={styles.projectKnowledgeHintIcon} />
            </Tooltip>
          </div>
        </div>
      </div>

      <div className={styles.projectKnowledgeSignalGrid}>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("copaw.projects.knowledge.signalDocuments")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.documentCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("copaw.projects.knowledge.signalSnapshots")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.snapshotCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("copaw.projects.knowledge.signalChunks")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.chunkCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">
            {t("copaw.projects.knowledge.signalSentences")}
            <span title="基于 interlinear 工件逐句统计">🛈</span>
          </Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.sentenceCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">
            {t("copaw.projects.knowledge.signalTokens")}
            <span title="基于轻量化工件分词统计">🛈</span>
          </Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.tokenCount || 0}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">
            {t("copaw.projects.knowledge.signalCharacters")}
            <span title="基于 interlinear 工件逐句统计">🛈</span>
          </Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.charCount || 0}</Typography.Text>
        </div>
      </div>

      {recentHistorySections.map((section) => (
        <div key={section.key} className={styles.projectKnowledgeHistoryStrip}>
          <div className={styles.projectKnowledgeHistoryHeader}>
            <Typography.Text strong>
              {section.title}
            </Typography.Text>
            <Typography.Text type="secondary">
              {section.hint}
            </Typography.Text>
          </div>
          <div className={styles.projectKnowledgeHistoryList}>
            {section.items.map((item) => (
              <div key={item.key} className={styles.projectKnowledgeHistoryItem}>
                <Typography.Text strong>
                  {item.timestamp}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {item.summary}
                </Typography.Text>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
