import { Button, Card, Tag, Typography } from "antd";
import { useTranslation } from "react-i18next";
import type { AgentProjectSummary } from "../../../api/types/agents";
import styles from "./index.module.less";

const { Text } = Typography;

interface ProjectOverviewCardProps {
  selectedProject?: AgentProjectSummary;
  projectFileCount: number;
  pipelineTemplateCount: number;
  pipelineRunCount: number;
  projectWorkspaceSummary: string;
  onStartCollaboration: () => void;
  onUploadFiles: () => void;
}

export default function ProjectOverviewCard({
  selectedProject,
  projectFileCount,
  pipelineTemplateCount,
  pipelineRunCount,
  projectWorkspaceSummary,
  onStartCollaboration,
  onUploadFiles,
}: ProjectOverviewCardProps) {
  const { t } = useTranslation();

  return (
    <Card
      title={<span className={styles.sectionTitle}>{t("projects.overview", "Overview")}</span>}
      styles={{ body: { padding: 12 } }}
      extra={
        <Text type="secondary" className={styles.panelExtraText}>
          {selectedProject?.status || t("projects.statusActive", "active")}
        </Text>
      }
    >
      <div className={styles.scrollContainer}>
        <div className={styles.overviewSection}>
          <div className={styles.subSectionTitle}>{t("projects.summary", "Project Summary")}</div>
          <div className={styles.overviewDescription}>
            {selectedProject?.description || t("projects.noDescription", "No description")}
          </div>
        </div>

        {(selectedProject?.tags || []).length > 0 && (
          <div className={styles.overviewSection}>
            <div className={styles.subSectionTitle}>{t("projects.tags", "Tags")}</div>
            <div className={styles.overviewTags}>
              {selectedProject?.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </div>
          </div>
        )}

        <div className={styles.metricSummaryGrid}>
          <div className={styles.metricSummaryCard}>
            <div className={styles.itemMeta}>{t("projects.files", "Files")}</div>
            <div className={styles.metricSummaryValue}>{projectFileCount}</div>
          </div>
          <div className={styles.metricSummaryCard}>
            <div className={styles.itemMeta}>{t("projects.automation.flows", "Flows")}</div>
            <div className={styles.metricSummaryValue}>{pipelineTemplateCount}</div>
          </div>
          <div className={styles.metricSummaryCard}>
            <div className={styles.itemMeta}>{t("projects.runs", "Runs")}</div>
            <div className={styles.metricSummaryValue}>{pipelineRunCount}</div>
          </div>
          <div className={styles.metricSummaryCard}>
            <div className={styles.itemMeta}>{t("projects.updated", "Updated")}</div>
            <div className={styles.metricSummaryValue}>
              {selectedProject?.updated_time ? selectedProject.updated_time.slice(5, 10) : "-"}
            </div>
          </div>
        </div>

        <div className={styles.overviewSection}>
          <div className={styles.subSectionTitle}>{t("projects.workspaceSummary", "Workspace Snapshot")}</div>
          <pre className={styles.overviewSummary}>{projectWorkspaceSummary}</pre>
        </div>

        <div className={styles.overviewActions}>
          <Button type="primary" onClick={onStartCollaboration}>
            {t("projects.chat.startCollaboration", "Start project collaboration")}
          </Button>
          <Button onClick={onUploadFiles}>{t("projects.upload.button", "Upload Files")}</Button>
        </div>
      </div>
    </Card>
  );
}