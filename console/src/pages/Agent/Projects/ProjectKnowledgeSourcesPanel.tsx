import { InfoCircleOutlined } from "@ant-design/icons";
import { Table, Tooltip, Typography } from "antd";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";
import { buildProjectKnowledgeSourcesRecentHistorySectionsFromState } from "./projectKnowledgeRecentHistoryModel";
import { getTriggerModeLabel, getProcessingStatusLabel } from "./projectKnowledgeSyncUi";
import type { ProjectKnowledgeState } from "./useProjectKnowledgeState";

interface ProjectKnowledgeSourcesPanelProps {
  knowledgeState: ProjectKnowledgeState;
}

export default function ProjectKnowledgeSourcesPanel(props: ProjectKnowledgeSourcesPanelProps) {
  const { t } = useTranslation();
  const { knowledgeState } = props;
  const recentHistorySections = buildProjectKnowledgeSourcesRecentHistorySectionsFromState(t, knowledgeState);
  const changedFiles = knowledgeState.changedFilesNormalized || [];

  const changedFilesColumns = [
    {
      title: t("copaw.projects.knowledge.columnPath", "Path"),
      dataIndex: "path",
      key: "path",
      width: "40%",
      render: (text: string) => (
        <Typography.Text ellipsis title={text}>
          {text}
        </Typography.Text>
      ),
    },
    {
      title: t("copaw.projects.knowledge.columnTriggerMode", "Launch Mode"),
      dataIndex: "trigger_mode",
      key: "trigger_mode",
      width: "20%",
      render: (mode?: string) => getTriggerModeLabel(t, mode),
    },
    {
      title: t("copaw.projects.knowledge.columnProcessingStatus", "Processing Status"),
      dataIndex: "processing_status",
      key: "processing_status",
      width: "20%",
      render: (status?: string) => getProcessingStatusLabel(t, status),
    },
    {
      title: t("copaw.projects.knowledge.columnDetectedAt", "Detected"),
      dataIndex: "detected_at",
      key: "detected_at",
      width: "20%",
      render: (time?: string) => {
        if (!time) return "-";
        const date = new Date(time);
        return (
          <Tooltip title={time}>
            <Typography.Text type="secondary">
              {date.toLocaleString()}
            </Typography.Text>
          </Tooltip>
        );
      },
    },
  ];

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

      {changedFiles.length > 0 && (
        <div className={styles.projectKnowledgeHistoryStrip}>
          <div className={styles.projectKnowledgeHistoryHeader}>
            <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
              {t("copaw.projects.knowledge.changedFiles", "Changed Files")}
            </Typography.Title>
            <Typography.Text type="secondary">
              {t("copaw.projects.knowledge.changedFilesHint", `${changedFiles.length} files detected`)}
            </Typography.Text>
          </div>
          <Table
            columns={changedFilesColumns}
            dataSource={changedFiles.map((file, idx) => ({ ...file, key: file.path || idx }))}
            pagination={{ pageSize: 10, simple: true }}
            size="small"
            bordered={false}
          />
        </div>
      )}

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
