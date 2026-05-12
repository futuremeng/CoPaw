import { Typography } from "antd";
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
          <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
            {t("projects.knowledgeDock.tabSources", "Sources")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t(
              "projects.knowledge.sourcesRoleHint",
              "Sources（L1 基线，已对齐 interlinear 工件）—— L1 状态与统计字段全部基于 interlinear/轻量化工件，包含文档数、切片数、句子数、轻量词数、字数。indexed 字段仅代表 interlinear 工件存在。",
            )}
          </Typography.Text>
        </div>
      </div>

      <div className={styles.projectKnowledgeSignalGrid}>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalDocuments")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.documentCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalSnapshots", "Snapshots")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.snapshotCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalChunks")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.chunkCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">
            {t("projects.knowledge.signalSentences", "Sentences")}
            <span title="基于 interlinear 工件逐句统计">🛈</span>
          </Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.sentenceCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">
            {t("projects.knowledge.signalTokens", "Lightweight Tokens")}
            <span title="基于轻量化工件分词统计">🛈</span>
          </Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.tokenCount || 0}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">
            {t("projects.knowledge.signalCharacters", "Characters")}
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
