import { Alert, Button, Select, Space, Typography } from "antd";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";
import type { ProjectKnowledgeState } from "./useProjectKnowledgeState";

interface ProjectKnowledgeSignalsPanelProps {
  knowledgeState: ProjectKnowledgeState;
  onOpenSettings?: () => void;
  onRunSuggestedQuery?: (query: string) => void;
}

export default function ProjectKnowledgeSignalsPanel(
  props: ProjectKnowledgeSignalsPanelProps,
) {
  const { t } = useTranslation();
  const { knowledgeState } = props;

  return (
    <div className={styles.projectKnowledgeWorkbench}>
      <div className={styles.projectKnowledgeTabHeader}>
        <div>
          <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
            {t("projects.knowledgeDock.tabHealth", "Health")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {t(knowledgeState.insightMessageKey)}
          </Typography.Text>
        </div>
        <div className={styles.projectKnowledgeTabActions}>
          {knowledgeState.insightAction === "settings" ? (
            <Button size="small" type="primary" onClick={props.onOpenSettings}>
              {t("projects.knowledge.actionOpenSettings", "Open settings")}
            </Button>
          ) : null}
          {knowledgeState.insightAction === "query" ? (
            <Button
              size="small"
              type="primary"
              onClick={() => props.onRunSuggestedQuery?.(knowledgeState.suggestedQuery)}
            >
              {t("projects.knowledge.actionRunSuggestedQuery")}
            </Button>
          ) : null}
          <Button size="small" onClick={() => void knowledgeState.loadProjectSourceStatus()}>
            {t("projects.knowledge.actionRefreshSignals")}
          </Button>
        </div>
      </div>

      <div className={styles.projectKnowledgeSignalGrid}>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalDocuments")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.documentCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalChunks")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.chunkCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalCoverage", "Coverage")}</Typography.Text>
          <Typography.Text strong>
            {Math.round(knowledgeState.quantMetrics.indexedRatio * 100)}%
          </Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalRelations")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.relationCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.entities", "实体数")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.entityCount}</Typography.Text>
        </div>
      </div>

      {knowledgeState.syncState
        && (
          knowledgeState.syncState.status !== "idle"
          || Boolean(knowledgeState.syncState.last_error)
          || Boolean(knowledgeState.syncState.last_finished_at)
        ) ? (
          <Alert
            type={knowledgeState.syncAlertType}
            showIcon
            message={t("projects.knowledge.sinkJob", "Knowledge Sync")}
            description={knowledgeState.syncAlertDescription}
          />
        ) : null}

      <div className={styles.projectKnowledgeTrendSection}>
        <div className={styles.projectKnowledgeTrendHeader}>
          <Typography.Text strong>
            {t("projects.knowledge.signalsTitle")}
          </Typography.Text>
          <Space size={6} wrap>
            <Select
              size="small"
              value={knowledgeState.trendRangeDays}
              options={[
                { value: 7, label: t("projects.knowledge.trendRange7d") },
                { value: 30, label: t("projects.knowledge.trendRange30d") },
              ]}
              onChange={(value) => knowledgeState.setTrendRangeDays(value as 7 | 30)}
              style={{ width: 96 }}
            />
            <Button
              size="small"
              type="text"
              onClick={() => knowledgeState.setTrendExpanded((prev) => !prev)}
            >
              {knowledgeState.trendExpanded
                ? t("common.collapse", "Collapse")
                : t("common.expand", "Expand")}
            </Button>
          </Space>
        </div>

        {knowledgeState.trendExpanded && knowledgeState.filteredTrendSnapshots.length > 1 ? (
          <div className={styles.projectKnowledgeTrendChart}>
            <svg viewBox="0 0 300 70" preserveAspectRatio="none">
              <path d={knowledgeState.trendDocumentPath} fill="none" stroke="#1677ff" strokeWidth="2" />
              <path d={knowledgeState.trendChunkPath} fill="none" stroke="#13c2c2" strokeWidth="2" />
            </svg>
            <div className={styles.projectKnowledgeTrendLegend}>
              <span>{t("projects.knowledge.signalDocuments")}</span>
              <span>{t("projects.knowledge.signalChunks")}</span>
            </div>
          </div>
        ) : knowledgeState.trendExpanded ? (
          <Typography.Text type="secondary">
            {t("projects.knowledge.trendNotEnough")}
          </Typography.Text>
        ) : null}

        <div className={styles.projectKnowledgeTrendDeltaRow}>
          <Typography.Text type="secondary">
            {t("projects.knowledge.signalDocuments")}: {t("projects.knowledge.signalDelta", { value: knowledgeState.trendDelta.documentDelta })}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t("projects.knowledge.signalChunks")}: {t("projects.knowledge.signalDelta", { value: knowledgeState.trendDelta.chunkDelta })}
          </Typography.Text>
          <Typography.Text type="secondary">
            {t("projects.knowledge.signalRelations")}: {t("projects.knowledge.signalDelta", { value: knowledgeState.trendDelta.relationDelta })}
          </Typography.Text>
        </div>
      </div>
    </div>
  );
}
