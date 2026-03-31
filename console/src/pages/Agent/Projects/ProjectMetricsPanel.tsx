import { Empty, Tag } from "antd";
import { useTranslation } from "react-i18next";
import type { ProjectPipelineRunDetail } from "../../../api/types/agents";
import styles from "./index.module.less";

interface RunProgressSummary {
  total: number;
  completed: number;
  running: number;
  pending: number;
}

interface ProjectMetricsPanelProps {
  runDetail: ProjectPipelineRunDetail | null;
  runProgress: RunProgressSummary;
  statusTagColor: (status: string) => string;
}

export default function ProjectMetricsPanel({
  runDetail,
  runProgress,
  statusTagColor,
}: ProjectMetricsPanelProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.previewBody}>
      {!runDetail ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("projects.pipeline.noRun", "No run")}
        />
      ) : (
        <div className={styles.metricPanel}>
          <div className={styles.metricSummaryGrid}>
            <div className={styles.metricSummaryCard}>
              <div className={styles.itemMeta}>Total Steps</div>
              <div className={styles.metricSummaryValue}>{runProgress.total}</div>
            </div>
            <div className={styles.metricSummaryCard}>
              <div className={styles.itemMeta}>Completed</div>
              <div className={styles.metricSummaryValue}>{runProgress.completed}</div>
            </div>
            <div className={styles.metricSummaryCard}>
              <div className={styles.itemMeta}>Running</div>
              <div className={styles.metricSummaryValue}>{runProgress.running}</div>
            </div>
            <div className={styles.metricSummaryCard}>
              <div className={styles.itemMeta}>Pending</div>
              <div className={styles.metricSummaryValue}>{runProgress.pending}</div>
            </div>
          </div>
          {runDetail.steps.map((step) => {
            const entries = Object.entries(step.metrics || {});
            return (
              <div key={step.id} className={styles.metricBlock}>
                <div className={styles.itemTitleRow}>
                  <span className={styles.itemTitle}>{step.name}</span>
                  <Tag color={statusTagColor(step.status)}>{step.status}</Tag>
                </div>
                {entries.length === 0 ? (
                  <div className={styles.itemMeta}>No metrics</div>
                ) : (
                  entries.map(([key, value]) => (
                    <div key={key} className={styles.itemMeta}>
                      {key}: {String(value)}
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}