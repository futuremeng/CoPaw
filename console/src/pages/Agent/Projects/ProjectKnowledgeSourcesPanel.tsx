import { Badge, Button, Empty, Spin, Typography } from "antd";
import { useEffect, useMemo } from "react";
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
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

export default function ProjectKnowledgeSourcesPanel(props: ProjectKnowledgeSourcesPanelProps) {
  const { t } = useTranslation();
  const { knowledgeState, onOpenSettings } = props;

  const sortedSources = useMemo(
    () => [...knowledgeState.projectSources].sort((left, right) => left.name.localeCompare(right.name)),
    [knowledgeState.projectSources],
  );

  useEffect(() => {
    if (!knowledgeState.selectedSourceId && sortedSources[0]) {
      knowledgeState.setSelectedSourceId(sortedSources[0].id);
    }
  }, [knowledgeState, sortedSources]);

  useEffect(() => {
    if (!knowledgeState.selectedSourceId) {
      return;
    }
    if (knowledgeState.sourceContentById[knowledgeState.selectedSourceId]) {
      return;
    }
    if (knowledgeState.sourceContentLoadingById[knowledgeState.selectedSourceId]) {
      return;
    }
    void knowledgeState.loadSourceContent(knowledgeState.selectedSourceId);
  }, [knowledgeState]);

  const selectedSource = sortedSources.find((source) => source.id === knowledgeState.selectedSourceId) || null;
  const selectedSourceContent = selectedSource
    ? knowledgeState.sourceContentById[selectedSource.id]
    : undefined;
  const selectedSourceLoading = selectedSource
    ? Boolean(knowledgeState.sourceContentLoadingById[selectedSource.id])
    : false;

  return (
    <div className={styles.projectKnowledgeWorkbench}>
      <div className={styles.projectKnowledgeTabHeader}>
        <div>
          <Typography.Title level={5} className={styles.projectKnowledgeSectionTitle}>
            {t("projects.knowledgeDock.tabSources", "Sources")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {knowledgeState.sourceRegistered
              ? t("projects.knowledge.sourceRegistered")
              : t("projects.knowledge.sourceNotRegistered")}
          </Typography.Text>
        </div>
        <div className={styles.projectKnowledgeTabActions}>
          <Button size="small" onClick={() => void knowledgeState.loadProjectSourceStatus()}>
            {t("projects.knowledge.actionRefreshSignals", "Refresh")}
          </Button>
          {!knowledgeState.sourceRegistered ? (
            <Button size="small" type="primary" onClick={onOpenSettings}>
              {t("projects.knowledge.actionOpenSettings", "Open settings")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className={styles.projectKnowledgeSignalGrid}>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.totalSources", "Sources")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.totalSources}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.indexedSources", "Indexed")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.indexedSources}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalDocuments")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.documentCount}</Typography.Text>
        </div>
        <div className={styles.projectKnowledgeSignalCard}>
          <Typography.Text type="secondary">{t("projects.knowledge.signalChunks")}</Typography.Text>
          <Typography.Text strong>{knowledgeState.quantMetrics.chunkCount}</Typography.Text>
        </div>
      </div>

      {sortedSources.length ? (
        <div className={styles.projectKnowledgeWorkbenchSplit}>
          <div className={styles.projectKnowledgePrimaryPanel}>
            <div className={styles.projectKnowledgePanelHeader}>
              <Typography.Text strong>{t("projects.knowledge.sourceList", "Source List")}</Typography.Text>
              <Typography.Text type="secondary">{sortedSources.length}</Typography.Text>
            </div>
            <div className={styles.projectKnowledgeSelectableList}>
              {sortedSources.map((source) => {
                const active = source.id === knowledgeState.selectedSourceId;
                return (
                  <button
                    key={source.id}
                    type="button"
                    className={`${styles.projectKnowledgeSelectableItem} ${active ? styles.projectKnowledgeSelectableItemActive : ""}`}
                    onClick={() => knowledgeState.setSelectedSourceId(source.id)}
                  >
                    <div className={styles.projectKnowledgeSelectableItemHeader}>
                      <Typography.Text strong>{source.name}</Typography.Text>
                      <Badge
                        status={source.status.indexed ? "success" : "default"}
                        text={source.status.indexed
                          ? t("projects.knowledge.signalIndexed", "Indexed")
                          : t("projects.knowledge.signalPending", "Pending")}
                      />
                    </div>
                    <Typography.Text type="secondary">{source.location || "-"}</Typography.Text>
                    <div className={styles.projectKnowledgeMetaLine}>
                      <span>{t("projects.knowledge.signalDocuments")}: {source.status.document_count || 0}</span>
                      <span>{t("projects.knowledge.signalChunks")}: {source.status.chunk_count || 0}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className={styles.projectKnowledgeSecondaryPanel}>
            <div className={styles.projectKnowledgePanelHeader}>
              <div>
                <Typography.Text strong>
                  {selectedSource?.name || t("projects.knowledge.sourceDetail", "Source Detail")}
                </Typography.Text>
                {selectedSource ? (
                  <Typography.Paragraph type="secondary" className={styles.projectKnowledgeInlineDescription}>
                    {selectedSource.location || "-"}
                  </Typography.Paragraph>
                ) : null}
              </div>
              {selectedSource ? (
                <Button
                  size="small"
                  onClick={() => {
                    void knowledgeState.loadSourceContent(selectedSource.id, { force: true });
                  }}
                >
                  {t("projects.knowledge.actionRefreshSignals", "Refresh")}
                </Button>
              ) : null}
            </div>
            {selectedSource ? (
              <div className={styles.projectKnowledgePanelBody}>
                <div className={styles.projectKnowledgeMetaLine}>
                  <span>{t("projects.knowledge.sourceIndexedAt", "Indexed at")}: {formatIndexedAt(selectedSource.status.indexed_at)}</span>
                  <span>{t("projects.knowledge.signalDocuments")}: {selectedSourceContent?.document_count ?? selectedSource.status.document_count ?? 0}</span>
                  <span>{t("projects.knowledge.signalChunks")}: {selectedSourceContent?.chunk_count ?? selectedSource.status.chunk_count ?? 0}</span>
                </div>
                {selectedSourceLoading ? (
                  <div className={styles.projectKnowledgeEmpty}><Spin /></div>
                ) : selectedSourceContent?.documents?.length ? (
                  <div className={styles.projectKnowledgeDocumentList}>
                    {selectedSourceContent.documents.map((document) => (
                      <div key={document.path} className={styles.projectKnowledgeDocumentCard}>
                        <Typography.Text strong>{document.title || document.path}</Typography.Text>
                        <Typography.Text type="secondary">{document.path}</Typography.Text>
                        <Typography.Paragraph ellipsis={{ rows: 3, expandable: true, symbol: t("common.expand", "Expand") }}>
                          {document.text || t("projects.knowledge.sourceDocumentEmpty", "No extracted content.")}
                        </Typography.Paragraph>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={styles.projectKnowledgeEmpty}>
                    <Empty description={t("projects.knowledge.sourceContentEmpty", "No indexed documents yet.")} />
                  </div>
                )}
              </div>
            ) : (
              <div className={styles.projectKnowledgeEmpty}>
                <Empty description={t("projects.knowledge.sourceEmpty", "No project knowledge sources yet.")} />
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.projectKnowledgeEmpty}>
          <Empty description={t("projects.knowledge.sourceEmpty", "No project knowledge sources yet.")} />
        </div>
      )}
    </div>
  );
}
