import { Alert, Badge, Button, Card, Empty, Space, Typography } from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import styles from "./index.module.less";
import type { ProjectKnowledgeState } from "./useProjectKnowledgeState";

interface ProjectKnowledgeSourcesPanelProps {
  knowledgeState: ProjectKnowledgeState;
  onOpenSettings?: () => void;
}

function formatIndexedAt(raw?: string | null): string {
  if (!raw) {
    return "-";
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  const hh = String(parsed.getHours()).padStart(2, "0");
  const mm = String(parsed.getMinutes()).padStart(2, "0");
  const ss = String(parsed.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

export default function ProjectKnowledgeSourcesPanel(
  props: ProjectKnowledgeSourcesPanelProps,
) {
  const { t } = useTranslation();
  const { knowledgeState, onOpenSettings } = props;

  const sortedSources = useMemo(
    () => [...knowledgeState.projectSources].sort((left, right) => left.name.localeCompare(right.name)),
    [knowledgeState.projectSources],
  );

  return (
    <Card
      size="small"
      title={t("projects.knowledgeDock.tabSources", "Sources")}
      className={styles.projectKnowledgeCard}
    >
      <Space direction="vertical" size={8} style={{ width: "100%" }}>
        <div className={styles.projectKnowledgeInsightBar}>
          <Typography.Text type="secondary">
            {knowledgeState.sourceRegistered
              ? t("projects.knowledge.sourceRegistered")
              : t("projects.knowledge.sourceNotRegistered")}
          </Typography.Text>
          <Space wrap>
            <Badge
              status={knowledgeState.sourceRegistered ? "success" : "default"}
              text={knowledgeState.sourceLoaded
                ? `${knowledgeState.quantMetrics.indexedSources}/${knowledgeState.quantMetrics.totalSources}`
                : t("common.loading", "Loading")}
            />
            {!knowledgeState.sourceRegistered ? (
              <Button size="small" type="primary" onClick={onOpenSettings}>
                {t("projects.knowledge.actionOpenSettings", "Open settings")}
              </Button>
            ) : null}
          </Space>
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

        {sortedSources.length ? (
          <div className={styles.projectKnowledgeSignalGrid}>
            {sortedSources.map((source) => (
              <div key={source.id} className={styles.projectKnowledgeSignalCard}>
                <Typography.Text strong>{source.name}</Typography.Text>
                <Typography.Text type="secondary">{source.location || "-"}</Typography.Text>
                <Badge
                  status={source.status.indexed ? "success" : "default"}
                  text={source.status.indexed
                    ? t("projects.knowledge.signalIndexed", "Indexed")
                    : t("projects.knowledge.signalPending", "Pending")}
                />
                <Typography.Text type="secondary">
                  {t("projects.knowledge.signalDocuments")}: {source.status.document_count || 0}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {t("projects.knowledge.signalChunks")}: {source.status.chunk_count || 0}
                </Typography.Text>
                <Typography.Text type="secondary">
                  {t("projects.knowledge.sourceIndexedAt", "Indexed at")}: {formatIndexedAt(source.status.indexed_at)}
                </Typography.Text>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.projectKnowledgeEmpty}>
            <Empty description={t("projects.knowledge.sourceEmpty", "No project knowledge sources yet.")} />
          </div>
        )}
      </Space>
    </Card>
  );
}